import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { allocatePort } from './ports.js';
import { defaultIndexHtml } from './default-content.js';

/** Turn a display name into a safe directory name. */
export function slugify(name) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'site';
}

export function validateName(name) {
  if (typeof name !== 'string') return 'Name is required';
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length > 64) return 'Name must be 64 characters or fewer';
  if (!/^[\w \-.]+$/.test(trimmed)) {
    return 'Name may only contain letters, numbers, spaces, hyphens, underscores and dots';
  }
  return null;
}

/**
 * Coordinates the three pieces of state a site is made of: the onion service
 * inside tor, the row in the JSON store, and the local static file server.
 */
export class SiteManager {
  constructor({ store, torProcess, servers, sitesDir }) {
    this.store = store;
    this.tor = torProcess;
    this.servers = servers;
    this.sitesDir = sitesDir;
  }

  get control() {
    const control = this.tor.control;
    if (!control) throw new Error('Tor is not running');
    return control;
  }

  /** Ports claimed by existing sites, whether or not they are serving now. */
  _takenPorts() {
    return new Set(this.store.list().map((site) => site.port));
  }

  toPublic(site) {
    return {
      id: site.id,
      name: site.name,
      slug: site.slug,
      onion: site.serviceId ? `${site.serviceId}.onion` : null,
      url: site.serviceId ? `http://${site.serviceId}.onion` : null,
      port: site.port,
      dir: site.dir,
      serving: this.servers.isServing(site.id),
      published: Boolean(site.serviceId) && this.tor.status === 'running',
      createdAt: site.createdAt,
    };
  }

  listPublic() {
    return this.store.list().map((site) => this.toPublic(site));
  }

  /**
   * Make sure the root that holds every site directory exists. It can go
   * missing between runs — deleted by hand, wiped by the service uninstaller,
   * or simply never created on a fresh checkout — so this is checked before
   * any write rather than assumed at startup.
   */
  async ensureSitesDir() {
    await fs.mkdir(this.sitesDir, { recursive: true });
  }

  /**
   * Pick a directory for a new site, appending a counter if the slug is
   * already on disk so two similarly named sites cannot share content.
   */
  async _reserveDir(slug) {
    await this.ensureSitesDir();

    let candidate = slug;
    let counter = 2;
    for (;;) {
      const dir = path.join(this.sitesDir, candidate);
      try {
        // recursive:false is deliberate: EEXIST is how a slug collision is
        // detected, and recursive:true would silently reuse the directory.
        await fs.mkdir(dir, { recursive: false });
        return { dir, slug: candidate };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        candidate = `${slug}-${counter}`;
        counter += 1;
      }
    }
  }

  async create({ name, serve = true }) {
    const validationError = validateName(name);
    if (validationError) throw Object.assign(new Error(validationError), { status: 400 });

    const trimmed = name.trim();
    if (this.store.findByName(trimmed)) {
      throw Object.assign(new Error(`A site named "${trimmed}" already exists`), { status: 409 });
    }

    const { dir, slug } = await this._reserveDir(slugify(trimmed));
    const port = await allocatePort(this._takenPorts());
    const id = crypto.randomUUID();

    await fs.writeFile(path.join(dir, 'index.html'), defaultIndexHtml(trimmed), 'utf8');

    let serviceId;
    let privateKey;
    try {
      ({ serviceId, privateKey } = await this.control.addOnion({
        key: 'NEW:ED25519-V3',
        ports: [{ virtualPort: 80, target: `127.0.0.1:${port}` }],
      }));
    } catch (err) {
      // Roll back the directory so a failed create leaves nothing behind.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    const site = {
      id,
      name: trimmed,
      slug,
      dir,
      port,
      serviceId,
      privateKey,
      serve: Boolean(serve),
      createdAt: new Date().toISOString(),
    };

    try {
      await this.store.add(site);
    } catch (err) {
      // Without a persisted key this onion could never be recreated, so do
      // not leave it running in tor.
      await this.control.delOnion(serviceId).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    if (site.serve) {
      try {
        await this.servers.start(id, dir, port);
      } catch (err) {
        // The onion exists and is recorded; only local serving failed, so
        // surface it as a non-fatal state rather than undoing everything.
        await this.store.update(id, { serve: false });
        return { site: this.toPublic(this.store.find(id)), warning: err.message };
      }
    }

    return { site: this.toPublic(this.store.find(id)) };
  }

  async remove(id, { deleteFiles = false } = {}) {
    const site = this.store.find(id);
    if (!site) throw Object.assign(new Error('Site not found'), { status: 404 });

    await this.servers.stop(id);

    if (site.serviceId && this.tor.status === 'running' && this.tor.control) {
      // A missing onion is fine here: tor may have already dropped it, and
      // the user's intent is for it to be gone either way.
      await this.tor.control.delOnion(site.serviceId).catch(() => {});
    }

    await this.store.remove(id);

    if (deleteFiles) {
      // Confirm the recorded directory really is inside our sites root
      // before recursively deleting it.
      const resolved = path.resolve(site.dir);
      const root = path.resolve(this.sitesDir);
      if (resolved.startsWith(root + path.sep)) {
        await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
      }
    }

    return { id, filesDeleted: Boolean(deleteFiles) };
  }

  /**
   * Recreate a site's directory if it went missing, restoring the starter page
   * so the service answers with content instead of a bare 404.
   */
  async _ensureSiteDir(site) {
    await this.ensureSitesDir();
    await fs.mkdir(site.dir, { recursive: true });
    try {
      await fs.access(path.join(site.dir, 'index.html'));
    } catch {
      await fs.writeFile(
        path.join(site.dir, 'index.html'),
        defaultIndexHtml(site.name),
        'utf8',
      );
    }
  }

  async setServing(id, serving) {
    const site = this.store.find(id);
    if (!site) throw Object.assign(new Error('Site not found'), { status: 404 });

    if (serving) {
      await this._ensureSiteDir(site);
      await this.servers.start(id, site.dir, site.port);
    } else {
      await this.servers.stop(id);
    }
    await this.store.update(id, { serve: Boolean(serving) });
    return this.toPublic(this.store.find(id));
  }

  /**
   * Re-register every stored site with tor after a (re)start. Because we kept
   * each private key, the onion addresses come back unchanged.
   */
  async restoreAll() {
    const results = [];
    for (const site of this.store.list()) {
      try {
        if (!site.privateKey) {
          results.push({ id: site.id, name: site.name, ok: false, error: 'No stored private key' });
          continue;
        }
        const { serviceId } = await this.control.addOnion({
          key: site.privateKey,
          ports: [{ virtualPort: 80, target: `127.0.0.1:${site.port}` }],
        });
        if (serviceId !== site.serviceId) {
          await this.store.update(site.id, { serviceId });
        }
        if (site.serve && !this.servers.isServing(site.id)) {
          await this._ensureSiteDir(site);
          await this.servers.start(site.id, site.dir, site.port);
        }
        results.push({ id: site.id, name: site.name, ok: true });
      } catch (err) {
        results.push({ id: site.id, name: site.name, ok: false, error: err.message });
      }
    }
    return results;
  }
}
