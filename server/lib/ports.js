import net from 'node:net';

// Sit high in the ephemeral range to stay clear of anything the user is
// likely to be running locally.
const MIN_PORT = 41000;
const MAX_PORT = 45000;

function probe(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find a loopback port that is both free right now and not already claimed by
 * one of our sites. `taken` covers sites that exist but are not currently
 * serving, which a bind probe alone would report as available.
 */
export async function allocatePort(taken = new Set()) {
  for (let port = MIN_PORT; port <= MAX_PORT; port += 1) {
    if (taken.has(port)) continue;
    if (await probe(port)) return port;
  }
  throw new Error(`No free port available in range ${MIN_PORT}-${MAX_PORT}`);
}

export async function isPortFree(port) {
  return probe(port);
}

/**
 * Validate a user-supplied port. Unlike `allocatePort` this is not limited to
 * MIN_PORT-MAX_PORT — the range only exists to keep automatic picks out of the
 * user's way — but privileged ports are refused because the app is not
 * expected to run as root, and `taken` still applies so two sites cannot
 * claim the same local port.
 */
export async function claimPort(port, taken = new Set()) {
  if (!Number.isInteger(port)) {
    throw Object.assign(new Error('Port must be a whole number'), { status: 400 });
  }
  if (port < 1024 || port > 65535) {
    throw Object.assign(new Error('Port must be between 1024 and 65535'), { status: 400 });
  }
  if (taken.has(port)) {
    throw Object.assign(new Error(`Port ${port} is already used by another site`), { status: 409 });
  }
  if (!(await probe(port))) {
    throw Object.assign(new Error(`Port ${port} is already in use on this machine`), {
      status: 409,
    });
  }
  return port;
}
