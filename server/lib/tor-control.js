import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Minimal client for the Tor control protocol (control-spec.txt).
 *
 * The protocol is line oriented over a plain TCP socket. Replies are a series
 * of lines each prefixed with a 3 digit status code; the separator character
 * after the code tells us whether more lines follow:
 *
 *   250-KEY=VALUE     '-' mid reply, more lines coming
 *   250+KEY=          '+' start of a multi line data block, ended by a lone '.'
 *   250 OK            ' ' final line of the reply
 *
 * Async events (650) can arrive at any time, including in the middle of
 * nothing, so they are dispatched separately from command replies.
 */
export class TorControl extends EventEmitter {
  constructor({ port = 9151, host = '127.0.0.1' } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.socket = null;
    this.buffer = '';
    // Replies are matched to commands in FIFO order: Tor answers control
    // commands strictly in the order they were issued.
    this.pending = [];
    this.currentReply = [];
    this.dataBlock = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setEncoding('utf8');

      const onError = (err) => {
        socket.removeListener('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        socket.removeListener('error', onError);
        this.socket = socket;
        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', (err) => this.emit('error', err));
        socket.on('close', () => {
          this.socket = null;
          // Fail anything still in flight so callers do not hang forever.
          const inFlight = this.pending.splice(0, this.pending.length);
          for (const { reject: rejectPending } of inFlight) {
            rejectPending(new Error('Tor control connection closed'));
          }
          this.emit('close');
        });
        resolve();
      };

      socket.once('error', onError);
      socket.once('connect', onConnect);
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    // Tor terminates every protocol line with CRLF.
    let index;
    while ((index = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this._onLine(line);
    }
  }

  _onLine(line) {
    // Inside a '+' data block every line is payload until a lone '.'.
    if (this.dataBlock) {
      if (line === '.') {
        this.currentReply.push(this.dataBlock.join('\n'));
        this.dataBlock = null;
      } else {
        // Dot-stuffing: a leading '.' in payload is escaped as '..'.
        this.dataBlock.push(line.startsWith('..') ? line.slice(1) : line);
      }
      return;
    }

    const code = line.slice(0, 3);
    const separator = line[3];
    const rest = line.slice(4);

    if (separator === '+') {
      this.dataBlock = [rest];
      return;
    }

    if (separator === '-') {
      this.currentReply.push(rest);
      return;
    }

    // ' ' terminates the reply.
    this.currentReply.push(rest);
    const lines = this.currentReply;
    this.currentReply = [];

    if (code === '650') {
      this.emit('async-event', lines);
      return;
    }

    const entry = this.pending.shift();
    if (!entry) return;

    if (code.startsWith('2')) {
      entry.resolve(lines);
    } else {
      entry.reject(new Error(`Tor control error ${code}: ${lines.join(' ')}`));
    }
  }

  send(command) {
    if (!this.socket) {
      return Promise.reject(new Error('Not connected to Tor control port'));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(`${command}\r\n`);
    });
  }

  /**
   * Authenticate with a hex encoded control auth cookie. We read the cookie
   * from disk ourselves rather than using SAFECOOKIE: the control port is
   * bound to loopback and the file is only readable by us, so the extra
   * challenge/response handshake buys nothing here.
   */
  async authenticate(cookieHex) {
    await this.send(`AUTHENTICATE ${cookieHex}`);
  }

  async setEvents(events) {
    await this.send(`SETEVENTS ${events.join(' ')}`);
  }

  /**
   * Create an onion service. Passing 'NEW:ED25519-V3' as the key asks Tor to
   * generate a fresh key and hand it back once, which we persist so the
   * service can be recreated with the same address after a restart.
   *
   * Returns { serviceId, privateKey } where privateKey is null when we
   * supplied an existing key (Tor only returns it on generation).
   */
  async addOnion({ key = 'NEW:ED25519-V3', ports = [] }) {
    const portArgs = ports
      .map(({ virtualPort, target }) => ` Port=${virtualPort},${target}`)
      .join('');
    const lines = await this.send(`ADD_ONION ${key}${portArgs}`);

    let serviceId = null;
    let privateKey = null;
    for (const line of lines) {
      if (line.startsWith('ServiceID=')) serviceId = line.slice('ServiceID='.length);
      if (line.startsWith('PrivateKey=')) privateKey = line.slice('PrivateKey='.length);
    }
    if (!serviceId) {
      throw new Error(`ADD_ONION did not return a ServiceID: ${lines.join(' ')}`);
    }
    return { serviceId, privateKey };
  }

  async delOnion(serviceId) {
    await this.send(`DEL_ONION ${serviceId}`);
  }

  async getInfo(key) {
    const lines = await this.send(`GETINFO ${key}`);
    const prefix = `${key}=`;
    for (const line of lines) {
      if (line.startsWith(prefix)) return line.slice(prefix.length);
    }
    return null;
  }

  close() {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}
