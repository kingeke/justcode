#!/usr/bin/env sh
# JustCode installer — downloads a prebuilt, self-contained binary.
# No Bun, Node, or package manager required: the binary embeds its runtime.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kingeke/justcode/main/scripts/install.sh | sh
#
# Environment overrides:
#   JUSTCODE_VERSION         release tag to install (default: latest, e.g. v0.1.0)
#   JUSTCODE_INSTALL         install directory (default: $HOME/.justcode/bin)
#   JUSTCODE_NO_MODIFY_PATH  set to 1 to skip editing your shell config for PATH
set -eu

REPO="kingeke/justcode"
INSTALL_DIR="${JUSTCODE_INSTALL:-$HOME/.justcode/bin}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1" >&2; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Persist INSTALL_DIR onto PATH in the user's shell config so new terminals
# pick it up. Idempotent (appends at most once) and a no-op when the user opts
# out via JUSTCODE_NO_MODIFY_PATH=1. On success sets RC_FILE and returns 0;
# returns 1 when it declined/failed so the caller can print manual instructions.
RC_FILE=""
add_to_path() {
  [ "${JUSTCODE_NO_MODIFY_PATH:-}" = "1" ] && return 1

  case "$(basename "${SHELL:-}")" in
    zsh)  rc="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    bash) [ -f "$HOME/.bashrc" ] && rc="$HOME/.bashrc" || rc="$HOME/.bash_profile"
          line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    fish) rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
          line="fish_add_path \"$INSTALL_DIR\"" ;;
    *)    rc="$HOME/.profile"; line="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
  esac

  # Already configured in that file? Treat as success without duplicating.
  if [ -f "$rc" ] && grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
    RC_FILE="$rc"
    return 0
  fi

  mkdir -p "$(dirname "$rc")" || return 1
  {
    printf '\n# Added by the JustCode installer\n'
    printf '%s\n' "$line"
  } >> "$rc" 2>/dev/null || return 1
  RC_FILE="$rc"
  return 0
}

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
      if add_to_path; then
        info "Added $INSTALL_DIR to your PATH in $RC_FILE."
        info "Restart your terminal, or run: source \"$RC_FILE\""
      else
        warn "$INSTALL_DIR is not on your PATH. Add it:"
        warn "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
      fi
      ;;
  esac
fi
