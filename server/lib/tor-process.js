import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { TorControl } from './tor-control.js';

const BOOTSTRAP_TIMEOUT_MS = 120_000;

/**
 * Owns a private tor child process and an authenticated control connection to
 * it. We run our own instance rather than touching the system tor so the app
 * needs no root, no group membership and no changes to /etc/tor/torrc.
 */
export class TorProcess extends EventEmitter {
  constructor({ dataDir, controlPort = 9151 }) {
    super();
    this.dataDir = dataDir;
    this.controlPort = controlPort;
    this.child = null;
    this.control = null;
    this.status = 'stopped';
    this.bootstrapProgress = 0;
    this.bootstrapMessage = '';
    this.lastError = null;
    this.logLines = [];
  }

  get state() {
    return {
      status: this.status,
      bootstrapProgress: this.bootstrapProgress,
      bootstrapMessage: this.bootstrapMessage,
      controlPort: this.controlPort,
      lastError: this.lastError,
    };
  }

  _log(line) {
    this.logLines.push(line);
    // Keep the buffer bounded; the UI only ever shows the recent tail.
    if (this.logLines.length > 200) this.logLines.shift();
    this.emit('log', line);
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', this.state);
  }

  async start() {
    if (this.child) return;

    this.lastError = null;
    this._setStatus('starting');

    // Tor refuses to use a DataDirectory that is group or world accessible.
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.dataDir, 0o700);

    const args = [
      '--DataDirectory', this.dataDir,
      '--ControlPort', String(this.controlPort),
      '--CookieAuthentication', '1',
      // We only publish onion services, so we never need an outbound SOCKS
      // proxy of our own; the system tor keeps serving that role.
      '--SocksPort', '0',
      '--RunAsDaemon', '0',
      // Without this tor keeps running if our process dies unexpectedly.
      '--__OwningControllerProcess', String(process.pid),
    ];

    const child = spawn('tor', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this._log(line.trim());
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this._log(line.trim());
      }
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.control) {
        this.control.close();
        this.control = null;
      }
      this.bootstrapProgress = 0;
      if (this.status !== 'stopping' && this.status !== 'stopped') {
        this.lastError = `tor exited unexpectedly (code ${code}, signal ${signal})`;
      }
      this._setStatus('stopped');
    });

    child.on('error', (err) => {
      this.lastError =
        err.code === 'ENOENT'
          ? 'The `tor` binary was not found on PATH. Install tor and try again.'
          : err.message;
      this._setStatus('error');
    });

    try {
      await this._connectControl();
      await this._awaitBootstrap();
    } catch (err) {
      this.lastError = err.message;
      this._setStatus('error');
      await this.stop();
      throw err;
    }

    this._setStatus('running');
  }

  /**
   * The control port is not accepting connections the instant tor is spawned,
   * and the auth cookie is written slightly later still, so poll both.
   */
  async _connectControl() {
    const deadline = Date.now() + 30_000;
    const cookiePath = path.join(this.dataDir, 'control_auth_cookie');
    let lastErr = null;

    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error(this.lastError || 'tor exited before the control port was ready');
      }
      try {
        const cookie = await fs.readFile(cookiePath);
        const control = new TorControl({ port: this.controlPort });
        await control.connect();
        await control.authenticate(cookie.toString('hex'));
        await control.setEvents(['STATUS_CLIENT']);
        control.on('async-event', (lines) => this._onAsyncEvent(lines));
        control.on('error', (err) => this._log(`control error: ${err.message}`));
        this.control = control;
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error(`Could not reach the Tor control port: ${lastErr?.message ?? 'timed out'}`);
  }

  _onAsyncEvent(lines) {
    const first = lines[0] ?? '';
    if (!first.includes('BOOTSTRAP')) return;

    const progress = /PROGRESS=(\d+)/.exec(first);
    const summary = /SUMMARY="([^"]*)"/.exec(first);
    if (progress) this.bootstrapProgress = Number(progress[1]);
    if (summary) this.bootstrapMessage = summary[1];
    this.emit('status', this.state);
  }

  /**
   * Wait until tor reports a fully built circuit. GETINFO is polled rather
   * than relying only on the async event so we also catch the case where
   * bootstrap already completed before SETEVENTS took effect.
   */
  async _awaitBootstrap() {
    const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error(this.lastError || 'tor exited during bootstrap');
      }
      const phase = await this.control.getInfo('status/bootstrap-phase');
      if (phase) {
        const progress = /PROGRESS=(\d+)/.exec(phase);
        const summary = /SUMMARY="([^"]*)"/.exec(phase);
        if (progress) this.bootstrapProgress = Number(progress[1]);
        if (summary) this.bootstrapMessage = summary[1];
        this.emit('status', this.state);
        if (this.bootstrapProgress >= 100) return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Timed out waiting for Tor to bootstrap');
  }

  async stop() {
    const child = this.child;
    if (!child) {
      this._setStatus('stopped');
      return;
    }
    this._setStatus('stopping');

    if (this.control) {
      this.control.close();
      this.control = null;
    }

    await new Promise((resolve) => {
      // Escalate to SIGKILL if tor does not shut down promptly.
      const timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });

    this.child = null;
    this._setStatus('stopped');
  }
}
