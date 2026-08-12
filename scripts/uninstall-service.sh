#!/usr/bin/env bash
#
# Remove the TorControl systemd user service.
#
# By default this only removes the service. Site content and the onion private
# keys are left alone, because deleting them destroys .onion addresses that can
# never be recovered. Pass --purge to remove those too.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="torcontrol"

PURGE=0
DISABLE_LINGER=0
ASSUME_YES=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

info() { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s fail%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
${BOLD}TorControl service uninstaller${RESET}

Usage: $0 [options]

Options:
      --purge            Also delete site content and the onion private keys.
                         ${RED}This permanently destroys your .onion addresses.${RESET}
      --disable-linger   Also run 'sudo loginctl disable-linger'. Only do this
                         if no other user service of yours relies on linger.
  -y, --yes              Do not prompt for confirmation
  -h, --help             Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --purge)          PURGE=1 ;;
    --disable-linger) DISABLE_LINGER=1 ;;
    -y|--yes)         ASSUME_YES=1 ;;
    -h|--help)        usage; exit 0 ;;
    *)                die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  printf '\n%s%s%s [y/N] ' "$BOLD" "$1" "$RESET"
  read -r reply </dev/tty || return 1
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

[ "$(id -u)" -eq 0 ] && die "Do not run this as root; run it as the user that owns the service."

UNIT_PATH="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

info "Stopping and disabling $SERVICE_NAME"
systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true

if [ -f "$UNIT_PATH" ]; then
  rm -f "$UNIT_PATH"
  ok "Removed $UNIT_PATH"
else
  warn "No unit file at $UNIT_PATH (already removed?)"
fi
rm -f "${UNIT_PATH}.bak"

systemctl --user daemon-reload
systemctl --user reset-failed "$SERVICE_NAME" 2>/dev/null || true
ok "systemd reloaded"

if [ "$DISABLE_LINGER" -eq 1 ]; then
  if confirm "Disable linger for $(id -un)? Other user services may depend on it."; then
    sudo loginctl disable-linger "$(id -un)" && ok "Linger disabled"
  fi
fi

# Tor's DataDirectory holds no onion keys (those live in data/sites.json), so
# it is always safe to remove.
if [ -d "$REPO_DIR/.tor-data" ]; then
  rm -rf "$REPO_DIR/.tor-data"
  ok "Removed Tor data directory"
fi

if [ "$PURGE" -eq 1 ]; then
  echo
  warn "--purge will delete:"
  warn "  $REPO_DIR/data   (onion private keys)"
  warn "  $REPO_DIR/sites  (site content)"
  warn "Your .onion addresses cannot be recovered afterwards."
  if confirm "Permanently delete site data and onion keys?"; then
    rm -rf "$REPO_DIR/data" "$REPO_DIR/sites"
    ok "Site data and keys deleted"
  else
    info "Kept site data and keys"
  fi
else
  echo
  info "Site content and onion keys were kept:"
  info "  $REPO_DIR/data   (onion private keys)"
  info "  $REPO_DIR/sites  (site content)"
  info "Re-running install-service.sh will republish the same .onion addresses."
  info "Use --purge to delete them instead."
fi

printf '\n%sUninstall complete.%s\n\n' "$BOLD" "$RESET"
