#!/usr/bin/env sh
# JustCode uninstaller — removes the installed binary.
# Leaves ~/.justcode/.cache (and any other data) in place so a reinstall
# starts warm; delete ~/.justcode yourself for a full wipe.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kingeke/justcode/main/scripts/uninstall.sh | sh
#
# Environment overrides:
#   JUSTCODE_INSTALL  install directory used at install time (default: $HOME/.justcode/bin)
set -eu

INSTALL_DIR="${JUSTCODE_INSTALL:-$HOME/.justcode/bin}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }

removed=0
for bin in "$INSTALL_DIR/justcode" "$INSTALL_DIR/justcode.exe"; do
  if [ -f "$bin" ]; then
    rm -f "$bin"
    info "Removed $bin"
    removed=1
  fi
done

if [ "$removed" = "0" ]; then
  warn "no JustCode binary found in $INSTALL_DIR (set JUSTCODE_INSTALL if you installed elsewhere)"
  exit 0
fi

# Drop the bin dir if it's now empty; keep everything else under ~/.justcode.
rmdir "$INSTALL_DIR" 2>/dev/null || true

info "Done. Cache and data under $HOME/.justcode were left intact."
info "Your shell config may still add $INSTALL_DIR to PATH; that line is harmless, remove it if you like."
