import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
};

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Runs one static file server per site, each bound to loopback on the port
 * that tor maps its onion service to.
 *
 * Note these servers are reachable by anyone who can hit the .onion address,
 * so request handling is deliberately conservative: GET/HEAD only, and every
 * resolved path is confirmed to stay inside the site directory.
 */
export class SiteServerManager {
  constructor() {
    // id -> { server, port, root }
    this.servers = new Map();
  }

  isServing(id) {
    return this.servers.has(id);
  }

  servingIds() {
    return [...this.servers.keys()];
  }

  async start(id, root, port) {
    if (this.servers.has(id)) return;

    // Resolve once up front; every request is checked against this prefix.
    const rootReal = await fsp.realpath(root);

    const server = http.createServer((req, res) => {
      this._handle(req, res, rootReal).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use`)
          : err,
      );
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    // Replace the startup handler with a lasting one so a later socket error
    // cannot take the whole process down.
    server.on('error', () => {});
    this.servers.set(id, { server, port, root: rootReal });
  }

  async _handle(req, res, rootReal) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }

    // The URL is parsed against a dummy origin purely to strip query/hash.
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
      return;
    }

    // path.join normalises away any ../ segments, and the realpath check
    // below catches symlinks that point outside the site directory.
    const candidate = path.join(rootReal, pathname);
    let target = candidate;

    let stat;
    try {
      stat = await fsp.stat(target);
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        stat = await fsp.stat(target);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>404</title><h1>404 Not Found</h1>');
      return;
    }

    let realTarget;
    try {
      realTarget = await fsp.realpath(target);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    if (realTarget !== rootReal && !realTarget.startsWith(rootReal + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    const headers = {
      'Content-Type': contentType(realTarget),
      'Content-Length': stat.size,
      // Onion sites are served over Tor's own encrypted transport; these just
      // keep the served content from being sniffed or framed elsewhere.
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(realTarget);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  async stop(id) {
    const entry = this.servers.get(id);
    if (!entry) return;
    this.servers.delete(id);
    await new Promise((resolve) => {
      entry.server.close(resolve);
      // close() waits for keep-alive connections to drain, which can hang;
      // closeAllConnections forces them shut immediately.
      entry.server.closeAllConnections?.();
    });
  }

  async stopAll() {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }
}
