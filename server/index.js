import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TorProcess } from './lib/tor-process.js';
import { Store } from './lib/store.js';
import { SiteServerManager } from './lib/site-server.js';
import { SiteManager } from './lib/site-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT ?? 3000);
const CONTROL_PORT = Number(process.env.TOR_CONTROL_PORT ?? 9151);
const SITES_DIR = process.env.SITES_DIR ?? path.join(ROOT, 'sites');
const DATA_DIR = process.env.TOR_DATA_DIR ?? path.join(ROOT, '.tor-data');
const STORE_FILE = path.join(ROOT, 'data', 'sites.json');

const store = new Store(STORE_FILE);
const tor = new TorProcess({ dataDir: DATA_DIR, controlPort: CONTROL_PORT });
const servers = new SiteServerManager();
const manager = new SiteManager({ store, torProcess: tor, servers, sitesDir: SITES_DIR });

const app = express();
app.use(express.json({ limit: '64kb' }));

// This app drives a local Tor instance and serves local files, so it must
// never be exposed beyond loopback. Reject anything with an off-host Host
// header as a guard against DNS rebinding from a browser.
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const allowed = ['localhost', '127.0.0.1', '[::1]', '::1', ''];
  if (!allowed.includes(host)) {
    res.status(403).json({ error: 'Only local requests are allowed' });
    return;
  }
  next();
});

/* ---------------------------------------------------------------- events */

const sseClients = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(frame);
}

tor.on('status', (state) => broadcast('tor-status', state));
tor.on('log', (line) => broadcast('tor-log', { line }));

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');
  sseClients.add(res);

  res.write(`event: tor-status\ndata: ${JSON.stringify(tor.state)}\n\n`);

  // Proxies and browsers drop idle event streams; a periodic comment keeps
  // the connection alive without producing a client-visible event.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

/* ------------------------------------------------------------------- api */

function fail(res, err) {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? 'Unexpected error' });
}

app.get('/api/status', (req, res) => {
  res.json({
    tor: tor.state,
    sites: manager.listPublic(),
    logs: tor.logLines.slice(-50),
  });
});

app.get('/api/sites', (req, res) => {
  res.json({ sites: manager.listPublic() });
});

app.post('/api/sites', async (req, res) => {
  try {
    if (tor.status !== 'running') {
      throw Object.assign(new Error('Tor is not running yet'), { status: 409 });
    }
    const { name, serve, port } = req.body ?? {};
    // An omitted, null or blank port means "pick one for me".
    let requestedPort = null;
    if (port !== undefined && port !== null && port !== '') {
      requestedPort = Number(port);
      if (!Number.isInteger(requestedPort)) {
        throw Object.assign(new Error('Port must be a whole number'), { status: 400 });
      }
    }
    const result = await manager.create({
      name,
      serve: serve !== false,
      port: requestedPort,
    });
    broadcast('sites', { sites: manager.listPublic() });
    res.status(201).json(result);
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/sites/:id', async (req, res) => {
  try {
    // Query string values are strings, so compare explicitly.
    const deleteFiles = req.query.deleteFiles === 'true';
    const result = await manager.remove(req.params.id, { deleteFiles });
    broadcast('sites', { sites: manager.listPublic() });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/sites/:id/serving', async (req, res) => {
  try {
    const { serving } = req.body ?? {};
    if (typeof serving !== 'boolean') {
      throw Object.assign(new Error('`serving` must be a boolean'), { status: 400 });
    }
    const site = await manager.setServing(req.params.id, serving);
    broadcast('sites', { sites: manager.listPublic() });
    res.json({ site });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/tor/start', async (req, res) => {
  try {
    await tor.start();
    const restored = await manager.restoreAll();
    broadcast('sites', { sites: manager.listPublic() });
    res.json({ tor: tor.state, restored });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/tor/stop', async (req, res) => {
  try {
    await servers.stopAll();
    await tor.stop();
    broadcast('sites', { sites: manager.listPublic() });
    res.json({ tor: tor.state });
  } catch (err) {
    fail(res, err);
  }
});

// Serve the built client when it exists, so `npm start` alone works in
// production. In development Vite serves the UI and proxies /api here.
const clientDist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

/* --------------------------------------------------------------- startup */

async function main() {
  // Create the sites root up front so a fresh checkout is usable immediately.
  // SiteManager re-checks it on every write in case it disappears later.
  await manager.ensureSitesDir();
  await store.load();

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  TorControl API   http://127.0.0.1:${PORT}`);
    console.log(`  Sites directory  ${SITES_DIR}`);
    console.log(`  Tor data dir     ${DATA_DIR}\n`);
  });

  console.log('  Starting Tor…');
  try {
    await tor.start();
    console.log(`  Tor ready on control port ${CONTROL_PORT}`);
    const restored = await manager.restoreAll();
    const ok = restored.filter((r) => r.ok).length;
    if (restored.length) {
      console.log(`  Restored ${ok}/${restored.length} onion service(s)`);
      for (const entry of restored.filter((r) => !r.ok)) {
        console.warn(`    ! ${entry.name}: ${entry.error}`);
      }
    }
    broadcast('sites', { sites: manager.listPublic() });
  } catch (err) {
    // Keep the API up so the UI can show the error and offer a retry.
    console.error(`  Tor failed to start: ${err.message}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received, shutting down…`);
    // End the event streams before close(), otherwise the server waits on
    // these long-lived connections; closeAllConnections covers keep-alives.
    for (const res of sseClients) res.end();
    sseClients.clear();
    server.close();
    server.closeAllConnections?.();
    await servers.stopAll();
    await tor.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
