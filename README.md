# TorControl

A local web UI for creating and managing Tor v3 hidden services. Give a site a
name, click create, and get back a `.onion` address with a QR code — the folder,
starter page, port mapping and static file server are all set up for you.

Note: This project is mostly generated using Claude Code with little direct 
human programming.

## Requirements

- Node.js 18+
- The `tor` binary on `PATH` (`sudo apt install tor` on Debian/Ubuntu)

No root access is needed and nothing in `/etc/tor` is read or modified. The app
spawns its **own** private Tor instance on control port `9151` with a
`DataDirectory` inside the project, so a system-wide Tor keeps running
untouched.

The child Tor is started with `-f .tor-data/torrc --ignore-missing-torrc`, so it
never inherits `/etc/tor/torrc`. This matters: a distro torrc that declares a
`HiddenServiceDir` under `/var/lib/tor` (owned by `debian-tor`, mode `0700`)
cannot be read by an unprivileged user, and Tor would refuse to start at all.
Drop a `torrc` into `.tor-data/` if you want to pass extra options.

## Setup

```bash
npm run install:all
```

## Running

Development — Vite dev server with HMR, proxying `/api` to the backend:

```bash
npm run dev
# UI  http://127.0.0.1:5173
```

Production — build the UI, then serve everything from Node on one port:

```bash
npm run build
npm start
# UI  http://127.0.0.1:3000
```

On startup the app launches Tor, waits for it to bootstrap, and re-publishes
every previously created site. Bootstrapping takes 10–60 seconds on a cold
start; the UI shows live progress.

## How it works

| Piece | Role |
| --- | --- |
| `server/lib/tor-control.js` | Speaks the Tor control protocol over TCP |
| `server/lib/tor-process.js` | Spawns the private Tor child, cookie auth, bootstrap tracking |
| `server/lib/site-manager.js` | Ties together onion services, the store and file servers |
| `server/lib/site-server.js` | One static file server per site, bound to loopback |
| `server/lib/store.js` | Persists site metadata and onion private keys |
| `server/lib/ports.js` | Allocates a free local port in the 41000–45000 range |

Creating a site runs `ADD_ONION NEW:ED25519-V3 Port=80,127.0.0.1:<port>` on the
control port. Tor returns the service ID (the `.onion` address) and the private
key, which is saved to `data/sites.json` so the same address comes back after a
restart. Removing a site calls `DEL_ONION`.

## Persistence

`data/sites.json` holds the **onion private keys** and is written with `0600`
permissions. Anyone with that file can impersonate your hidden services — it is
gitignored, and should be backed up only somewhere you would keep secrets.

Site content lives in `sites/<slug>/`. Edit `index.html` there and the change is
served immediately; no restart needed.

## Notes and limits

- Hidden services are reachable **only while this app is running**. Stopping the
  app stops Tor, which unpublishes every site.
- A newly created service takes ~30–60 seconds to become reachable while its
  descriptor propagates to the Tor directory system. The address is valid
  immediately; give it a minute before assuming something is wrong.
- The static server handles `GET`/`HEAD` only and refuses to serve anything
  resolving outside a site's directory.
- The API binds to loopback and rejects requests with a non-local `Host` header.
  Do not expose it to a network.
- Deleting a site is permanent. The v3 onion address is derived from the key,
  and once the key is gone the address can never be recreated.

## Running as a service (optional)

On a Debian-based machine (Ubuntu, Debian, Raspberry Pi OS) you can install
TorControl as a **systemd user service** so it starts automatically:

```bash
./scripts/install-service.sh --dry-run   # see what it would do
./scripts/install-service.sh             # do it
```

The script is idempotent and asks before each system change. It verifies the
distro is Debian-based, installs `tor` if missing, checks for Node 18+ (the
distro package is too old on Ubuntu 22.04 and Debian bullseye — it prints
NodeSource/nvm instructions rather than installing a broken version), builds the
UI, writes the unit, and waits for Tor to bootstrap before reporting success.

Useful flags: `--no-linger` (start at login rather than at boot), `--no-deps`
(never touch apt), `--port N`, `-y` (no prompts).

```bash
systemctl --user status torcontrol
journalctl --user -u torcontrol -f
./scripts/uninstall-service.sh            # keeps your onion keys
./scripts/uninstall-service.sh --purge     # deletes them too
```

### What "survives reboot" requires

A user service normally stops at logout. Genuine boot survival needs **linger**,
which is the one step requiring sudo:

```bash
sudo loginctl enable-linger $USER
```

The installer prompts for this; decline it and the service is login-scoped.

### Consequences worth understanding

- **Your hidden services become reachable from boot**, without you logging in or
  opening the UI. The app has no authentication, so treat anything in `sites/`
  as public to whoever knows the address.
- If Node was installed via **nvm/volta/fnm/asdf**, its path contains a version
  number that changes on upgrade. The installer detects this and points the unit
  at a stable symlink (`~/.local/bin/torcontrol-node`); re-run the installer
  after upgrading Node to repoint it.
- The unit is sandboxed (`ProtectSystem=strict`, `ProtectHome=read-only`,
  `NoNewPrivileges`), with write access limited to `sites/`, `data/` and
  `.tor-data/`. Directives requiring privileges a user service lacks are
  deliberately omitted — they fail with `status=218/CAPABILITIES`.
- `Restart=on-failure` is rate-limited (5 starts / 300s) so a permanent fault
  such as a bound port fails cleanly instead of looping forever.

## Configuration

Environment variables, all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Backend HTTP port |
| `TOR_CONTROL_PORT` | `9151` | Control port for the private Tor instance |
| `SITES_DIR` | `./sites` | Where site folders are created |
| `TOR_DATA_DIR` | `./.tor-data` | Tor's DataDirectory |
