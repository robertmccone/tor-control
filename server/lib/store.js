import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * JSON backed store for site metadata, including the onion private keys.
 *
 * ADD_ONION services are ephemeral: tor forgets them the moment it exits.
 * Persisting the key tor hands back on creation is what lets a site keep the
 * same .onion address across restarts.
 */
export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { sites: [] };
    // Serialises writes so two concurrent saves cannot interleave.
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { sites: Array.isArray(parsed.sites) ? parsed.sites : [] };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = { sites: [] };
      await this.save();
    }
    return this.data;
  }

  save() {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      // Write then rename so a crash mid-write cannot truncate the store.
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    return this.writeChain;
  }

  list() {
    return this.data.sites;
  }

  find(id) {
    return this.data.sites.find((site) => site.id === id) ?? null;
  }

  findByName(name) {
    const lowered = name.toLowerCase();
    return this.data.sites.find((site) => site.name.toLowerCase() === lowered) ?? null;
  }

  async add(site) {
    this.data.sites.push(site);
    await this.save();
    return site;
  }

  async update(id, patch) {
    const site = this.find(id);
    if (!site) return null;
    Object.assign(site, patch);
    await this.save();
    return site;
  }

  async remove(id) {
    const index = this.data.sites.findIndex((site) => site.id === id);
    if (index === -1) return null;
    const [removed] = this.data.sites.splice(index, 1);
    await this.save();
    return removed;
  }
}
