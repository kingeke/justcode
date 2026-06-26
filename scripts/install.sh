#!/usr/bin/env sh
# JustCode installer — downloads a prebuilt, self-contained binary.
# No Bun, Node, or package manager required: the binary embeds its runtime.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kingeke/just-code/main/scripts/install.sh | sh
#
# Environment overrides:
#   JUSTCODE_VERSION   release tag to install (default: latest, e.g. v0.1.0)
#   JUSTCODE_INSTALL   install directory (default: $HOME/.justcode/bin)
set -eu

REPO="kingeke/just-code"
INSTALL_DIR="${JUSTCODE_INSTALL:-$HOME/.justcode/bin}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Detect OS + arch and map to our release asset naming (must match
# scripts/lib/platform.mjs).
detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      err "unsupported OS: $os (use the npm install method on this platform)" ;;
  esac
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *)             err "unsupported architecture: $arch" ;;
  esac
  echo "justcode-${os}-${arch}"
}

# Resolve the version: explicit override, else the latest GitHub release tag.
resolve_version() {
  if [ "${JUSTCODE_VERSION:-}" != "" ]; then
    echo "$JUSTCODE_VERSION"
    return
  fi
  api="https://api.github.com/repos/${REPO}/releases/latest"
  if has curl; then
    curl -fsSL "$api" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
  elif has wget; then
    wget -qO- "$api" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
  fi
}

ASSET="$(detect_target)"
VERSION="$(resolve_version)"
[ -n "$VERSION" ] || err "could not determine latest version; set JUSTCODE_VERSION=vX.Y.Z"

URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
DEST="${INSTALL_DIR}/justcode"

info "Installing JustCode ${VERSION} (${ASSET}) to ${DEST}"
mkdir -p "$INSTALL_DIR"

if has curl; then
  curl -fsSL "$URL" -o "$DEST" || err "download failed: $URL"
elif has wget; then
  wget -qO "$DEST" "$URL" || err "download failed: $URL"
else
  err "need curl or wget to download the binary"
fi
chmod +x "$DEST"

if has justcode && [ "$(command -v justcode)" = "$DEST" ]; then
  info "Installed. Run 'justcode --help'."
else
  info "Installed to $DEST"
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) : ;;
    *)
      warn "$INSTALL_DIR is not on your PATH. Add it:"
      warn "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
      ;;
  esac
fi
