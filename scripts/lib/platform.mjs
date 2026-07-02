// Shared platform <-> asset-name mapping used by the binary build, the npm
// launcher/postinstall, and (mirrored in shell) the curl installer + brew
// formula. Keep the naming convention here in sync with scripts/install.sh and
// the Homebrew formula generated in .github/workflows/release.yml.

const OS_MAP = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCH_MAP = { arm64: 'arm64', x64: 'x64' };

/** Normalized { os, arch } for the current runtime. Throws if unsupported. */
export function osArch() {
  const os = OS_MAP[process.platform];
  let arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    throw new Error(
      `Unsupported platform: ${process.platform}/${process.arch}`
    );
  }
  // No native windows-arm64 build (Bun can't target it); Windows 11 on ARM
  // runs x64 binaries via its built-in emulation layer.
  if (os === 'windows' && arch === 'arm64') arch = 'x64';
  return { os, arch };
}

/** Release asset / binary file name for the current platform, e.g. justcode-darwin-arm64. */
export function assetName(target = osArch()) {
  const ext = target.os === 'windows' ? '.exe' : '';
  return `justcode-${target.os}-${target.arch}${ext}`;
}

/** Bun --compile target triple for the current platform, e.g. bun-darwin-arm64. */
export function bunTarget(target = osArch()) {
  return `bun-${target.os}-${target.arch}`;
}
