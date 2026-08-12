#!/usr/bin/env bash
#
# Install TorControl as a systemd service on a Debian-based machine
# (Ubuntu, Debian, Raspberry Pi OS).
#
# Safe to re-run: every step checks the current state before changing it.
# Run with --dry-run first to see exactly what would happen.
#
set -euo pipefail

# ---------------------------------------------------------------- settings

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="torcontrol"
NODE_MIN_MAJOR=18
APP_PORT="${PORT:-3000}"
TOR_CONTROL_PORT="${TOR_CONTROL_PORT:-9151}"

DRY_RUN=0
ASSUME_YES=0
ENABLE_LINGER=1
INSTALL_DEPS=1

# ------------------------------------------------------------------ output

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

info()  { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()    { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()   { printf '%s fail%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
step()  { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '     %s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$*"
  else
    "$@"
  fi
}

usage() {
  cat <<EOF
${BOLD}TorControl service installer${RESET}

Usage: $0 [options]

Options:
  -n, --dry-run       Show what would be done without changing anything
  -y, --yes           Do not prompt for confirmation
      --no-linger     Skip enable-linger; the service then runs only while
                      you are logged in (no reboot survival)
      --no-deps       Do not install tor/node via apt; fail if missing
      --port PORT     HTTP port for the web UI (default: $APP_PORT)
      --uninstall     Remove the service (see also uninstall-service.sh)
  -h, --help          Show this help

Run without options for a normal install. Nothing here needs to run as root;
you will be prompted for sudo only to install packages and enable linger.
EOF
}

# -------------------------------------------------------------- arg parsing

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run)  DRY_RUN=1 ;;
    -y|--yes)      ASSUME_YES=1 ;;
    --no-linger)   ENABLE_LINGER=0 ;;
    --no-deps)     INSTALL_DEPS=0 ;;
    --port)        shift; APP_PORT="${1:?--port needs a value}" ;;
    --uninstall)   exec "$REPO_DIR/scripts/uninstall-service.sh" ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  printf '\n%s%s%s [y/N] ' "$BOLD" "$1" "$RESET"
  read -r reply </dev/tty || return 1
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ------------------------------------------------------- preflight: identity

step "Checking the environment"

[ "$(id -u)" -eq 0 ] && die "Do not run this as root. Run as the user that should own the service; it will ask for sudo only where needed."

TARGET_USER="$(id -un)"
TARGET_UID="$(id -u)"
ok "Installing for user ${BOLD}${TARGET_USER}${RESET} (uid $TARGET_UID)"

# ---------------------------------------------------------- preflight: distro

[ -r /etc/os-release ] || die "/etc/os-release not found; this does not look like a Linux distro I can provision."
# shellcheck disable=SC1091
. /etc/os-release

case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "*|*" ubuntu "*|*" raspbian "*) ;;
  *) die "This script targets Debian-based systems (found ID=${ID:-?}). Install manually or adapt the unit file." ;;
esac
ok "Distro: ${PRETTY_NAME:-${ID:-unknown}} ($(dpkg --print-architecture 2>/dev/null || uname -m))"

# ---------------------------------------------------------- preflight: systemd

command -v systemctl >/dev/null 2>&1 || die "systemctl not found. This installer requires systemd."
[ -d /usr/lib/systemd/user ] || [ -d /lib/systemd/user ] || die "systemd user units are not supported on this system."

# systemctl --user needs a running user bus. Over SSH on a fresh box this is
# usually present, but it is missing in containers and some minimal images.
if ! systemctl --user is-system-running >/dev/null 2>&1; then
  if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
    warn "XDG_RUNTIME_DIR is unset — the systemd user bus is not reachable from this shell."
    warn "This usually means you are in a container or a bare 'su' shell."
    warn "Try logging in over SSH as $TARGET_USER, or run: export XDG_RUNTIME_DIR=/run/user/$TARGET_UID"
  fi
  die "Cannot talk to the systemd user instance. See the warnings above."
fi
ok "systemd user instance is reachable"

# -------------------------------------------------------- preflight: repo files

[ -f "$REPO_DIR/server/index.js" ] || die "server/index.js not found under $REPO_DIR — run this from inside the TorControl checkout."
[ -f "$REPO_DIR/package.json" ]    || die "package.json not found under $REPO_DIR"
ok "Project root: $REPO_DIR"

# ------------------------------------------------------------- dependencies

step "Checking dependencies"

APT_UPDATED=0
apt_install() {
  local pkg="$1"
  if [ "$INSTALL_DEPS" -eq 0 ]; then
    die "$pkg is required but missing, and --no-deps was given."
  fi
  if [ "$APT_UPDATED" -eq 0 ]; then
    info "Running apt-get update (sudo)"
    run sudo apt-get update -qq
    APT_UPDATED=1
  fi
  info "Installing $pkg (sudo)"
  run sudo apt-get install -y -qq "$pkg"
}

# --- tor -------------------------------------------------------------------
if command -v tor >/dev/null 2>&1; then
  ok "tor present: $(tor --version 2>/dev/null | head -1 | cut -d' ' -f1-3)"
else
  warn "tor is not installed"
  confirm "Install the 'tor' package with apt?" || die "tor is required. Install it and re-run."
  apt_install tor
  if [ "$DRY_RUN" -eq 0 ]; then
    command -v tor >/dev/null 2>&1 || die "tor still not found after install."
    ok "tor installed"
  fi
fi

# The distro package starts a system-wide tor on boot. We do not need it (the
# app runs its own instance) but leaving it alone is harmless, so only mention
# it rather than changing the user's system.
if systemctl is-enabled tor >/dev/null 2>&1; then
  info "A system-wide tor service is enabled. TorControl runs its own separate"
  info "instance on port $TOR_CONTROL_PORT, so the two do not conflict."
fi

# --- node ------------------------------------------------------------------
# Debian/Ubuntu ship Node versions that are far too old on older releases
# (Ubuntu 22.04 -> 12.x, Debian bullseye -> 12.x). Detect and route around it.
node_major() {
  local n="${1:-}"
  [ -n "$n" ] || return 1
  "$n" --version 2>/dev/null | sed -n 's/^v\([0-9]\{1,\}\)\..*/\1/p'
}

NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "$(command -v nodejs 2>/dev/null || true)" \
  /usr/bin/node /usr/local/bin/node
do
  [ -n "$candidate" ] && [ -x "$candidate" ] || continue
  major="$(node_major "$candidate" || true)"
  if [ -n "$major" ] && [ "$major" -ge "$NODE_MIN_MAJOR" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -n "$NODE_BIN" ]; then
  ok "node $( "$NODE_BIN" --version ) at $NODE_BIN"
else
  existing="$(command -v node 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    warn "Found node $($existing --version 2>/dev/null || echo '?') — too old (need >= v${NODE_MIN_MAJOR})."
  else
    warn "node is not installed."
  fi

  apt_major=""
  if [ "$INSTALL_DEPS" -eq 1 ]; then
    apt_major="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/{print $2}' | sed -n 's/^\([0-9]\{1,\}\)\..*/\1/p')"
  fi

  if [ -n "$apt_major" ] && [ "$apt_major" -ge "$NODE_MIN_MAJOR" ]; then
    info "The distro provides nodejs $apt_major.x, which is new enough."
    confirm "Install nodejs from apt?" || die "node >= $NODE_MIN_MAJOR is required."
    apt_install nodejs
    NODE_BIN="$(command -v node || command -v nodejs || true)"
  else
    warn "The distro's nodejs${apt_major:+ ($apt_major.x)} is older than v${NODE_MIN_MAJOR}."
    cat <<EOF

  TorControl needs Node.js ${NODE_MIN_MAJOR}+. Install it one of these ways, then re-run:

    ${BOLD}NodeSource${RESET} (system-wide, recommended for a dedicated machine):
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs

    ${BOLD}nvm${RESET} (per-user, no root):
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      exec \$SHELL -l && nvm install 22

EOF
    # Deliberately not piping a remote script to sudo bash on the user's
    # behalf — that decision should be theirs, made explicitly.
    die "Install Node.js >= $NODE_MIN_MAJOR and run this script again."
  fi
fi

[ "$DRY_RUN" -eq 1 ] && [ -z "$NODE_BIN" ] && NODE_BIN="/usr/bin/node"
NODE_BIN="$(readlink -f "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"

# nvm paths embed the version number and vanish on `nvm uninstall`, which would
# break the unit with a cryptic status=203/EXEC. Install a stable symlink and
# point the unit at that instead.
NODE_LINK="$HOME/.local/bin/torcontrol-node"
case "$NODE_BIN" in
  *"/.nvm/"*|*"/.volta/"*|*"/.fnm/"*|*"/.asdf/"*)
    warn "This node is managed by a version manager:"
    warn "  $NODE_BIN"
    warn "That path changes when you switch or remove Node versions, which would"
    warn "break the service. Using a stable symlink instead:"
    warn "  $NODE_LINK -> $NODE_BIN"
    warn "After upgrading Node, re-run this script to repoint it."
    run mkdir -p "$HOME/.local/bin"
    run ln -sfn "$NODE_BIN" "$NODE_LINK"
    NODE_EXEC="$NODE_LINK"
    ;;
  *)
    NODE_EXEC="$NODE_BIN"
    ;;
esac
ok "Service will run: $NODE_EXEC"

# ------------------------------------------------------------ app dependencies

step "Preparing the application"

if [ ! -d "$REPO_DIR/node_modules" ] || [ ! -d "$REPO_DIR/client/node_modules" ]; then
  info "Installing npm dependencies (this can take a few minutes on a Pi)"
  run env PATH="$(dirname "$NODE_BIN"):$PATH" npm --prefix "$REPO_DIR" install --no-audit --no-fund
  run env PATH="$(dirname "$NODE_BIN"):$PATH" npm --prefix "$REPO_DIR/client" install --no-audit --no-fund
else
  ok "npm dependencies already installed"
fi

# The service serves the built UI from client/dist, so it must exist.
if [ ! -f "$REPO_DIR/client/dist/index.html" ]; then
  info "Building the web UI"
  run env PATH="$(dirname "$NODE_BIN"):$PATH" npm --prefix "$REPO_DIR" run build
else
  ok "Web UI already built"
fi

# ---------------------------------------------------------------- unit file

step "Installing the systemd unit"

UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="$UNIT_DIR/${SERVICE_NAME}.service"

run mkdir -p "$UNIT_DIR"

# ReadWritePaths must cover everything the app writes: site content, the key
# store, and tor's DataDirectory.
UNIT_CONTENT="$(cat <<EOF
[Unit]
Description=TorControl - local Tor hidden service manager
Documentation=file://$REPO_DIR/README.md
After=network-online.target
Wants=network-online.target
# Rate limiting belongs in [Unit]; systemd ignores these under [Service].
# Without them a permanently broken start (port bound, tor missing) would
# restart forever.
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_EXEC server/index.js
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=TOR_CONTROL_PORT=$TOR_CONTROL_PORT

# Tor bootstrap can take a while on a slow link; give shutdown time to
# terminate the child tor cleanly rather than having it killed.
TimeoutStartSec=180
TimeoutStopSec=30
KillSignal=SIGINT
KillMode=mixed

Restart=on-failure
RestartSec=5

# Hardening. The app needs no privileges beyond its own files.
#
# Only directives that work in a *user* service are used here. Options that
# manipulate capabilities or kernel-level protections (ProtectKernelTunables,
# ProtectKernelModules, ProtectControlGroups, RestrictSUIDSGID) require
# privileges the user manager does not have and make the unit fail at startup
# with status=218/CAPABILITIES.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$REPO_DIR/sites $REPO_DIR/data $REPO_DIR/.tor-data
RestrictNamespaces=yes
LockPersonality=yes
# The app binds loopback TCP only; tor needs outbound IPv4/IPv6.
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=default.target
EOF
)"

# ProtectHome=read-only would block writes to the repo when it lives under
# /home, so the directories the app writes must exist before it starts and be
# listed in ReadWritePaths above.
run mkdir -p "$REPO_DIR/sites" "$REPO_DIR/data" "$REPO_DIR/.tor-data"
run chmod 700 "$REPO_DIR/.tor-data"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '     %s[dry-run]%s would write %s:\n\n' "$YELLOW" "$RESET" "$UNIT_PATH"
  printf '%s\n' "$UNIT_CONTENT" | sed 's/^/       /'
else
  if [ -f "$UNIT_PATH" ] && ! printf '%s\n' "$UNIT_CONTENT" | cmp -s - "$UNIT_PATH"; then
    info "Existing unit differs; backing it up to ${UNIT_PATH}.bak"
    cp "$UNIT_PATH" "${UNIT_PATH}.bak"
  fi
  printf '%s\n' "$UNIT_CONTENT" > "$UNIT_PATH"
  ok "Wrote $UNIT_PATH"
fi

run systemctl --user daemon-reload

# ------------------------------------------------------------------- linger

step "Configuring startup behaviour"

if [ "$ENABLE_LINGER" -eq 1 ]; then
  if [ "$(loginctl show-user "$TARGET_USER" -p Linger --value 2>/dev/null || echo no)" = "yes" ]; then
    ok "Linger already enabled — the service will start at boot"
  else
    info "Linger lets a user service run without an active login session."
    info "Without it, TorControl starts at login and stops at logout."
    if confirm "Enable linger for $TARGET_USER? (needs sudo)"; then
      run sudo loginctl enable-linger "$TARGET_USER"
      ok "Linger enabled — the service will start at boot"
    else
      ENABLE_LINGER=0
      warn "Skipped. The service will NOT survive logout or reboot."
      warn "Enable it later with: sudo loginctl enable-linger $TARGET_USER"
    fi
  fi
else
  warn "--no-linger given: the service starts at login, not at boot."
fi

# ------------------------------------------------------------------- enable

step "Starting the service"

run systemctl --user enable "$SERVICE_NAME"
run systemctl --user restart "$SERVICE_NAME"

if [ "$DRY_RUN" -eq 0 ]; then
  # Tor bootstrap takes 10-60s; poll the API rather than trusting that
  # Type=simple's instant "active" means the sites are actually reachable.
  info "Waiting for Tor to bootstrap (this can take up to a minute)…"
  reachable=0
  for _ in $(seq 1 60); do
    if ! systemctl --user is-active --quiet "$SERVICE_NAME"; then
      break
    fi
    status="$(curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/status" 2>/dev/null || true)"
    case "$status" in
      *'"status":"running"'*) reachable=1; break ;;
    esac
    sleep 2
  done

  echo
  if [ "$reachable" -eq 1 ]; then
    ok "TorControl is running"
    printf '\n  %sWeb UI:%s   http://127.0.0.1:%s\n' "$BOLD" "$RESET" "$APP_PORT"
    printf '  %sLogs:%s     journalctl --user -u %s -f\n' "$BOLD" "$RESET" "$SERVICE_NAME"
    printf '  %sStop:%s     systemctl --user stop %s\n' "$BOLD" "$RESET" "$SERVICE_NAME"
    printf '  %sRemove:%s   %s/scripts/uninstall-service.sh\n\n' "$BOLD" "$RESET" "$REPO_DIR"
    if [ "$ENABLE_LINGER" -eq 0 ]; then
      warn "Reminder: linger is off, so this will stop when you log out."
    fi
    printf '  %sNote:%s hidden services are published whenever this service runs,\n' "$YELLOW" "$RESET"
    printf '  including after a reboot, and they have no authentication.\n\n'
  else
    warn "The service did not report a running Tor within 120s."
    printf '\n  Check what happened:\n'
    printf '    systemctl --user status %s\n' "$SERVICE_NAME"
    printf '    journalctl --user -u %s -n 50 --no-pager\n\n' "$SERVICE_NAME"
    exit 1
  fi
else
  printf '\n%sDry run complete — nothing was changed.%s\n\n' "$BOLD" "$RESET"
fi
