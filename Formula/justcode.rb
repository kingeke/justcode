# Homebrew formula for JustCode.
#
# Installs the prebuilt, self-contained binary (the Bun runtime is embedded),
# so there is no Node/Bun dependency. Host this in a tap repo named
# `homebrew-just-code`, then:
#
#   brew tap kingeke/just-code
#   brew install justcode
#
# On each release, update `version` and the per-arch `url`/`sha256` to point at
# the GitHub release assets (sha256 of each `justcode-darwin-<arch>` binary).
class Justcode < Formula
  desc "Interactive terminal coding assistant CLI"
  homepage "https://github.com/kingeke/just-code"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kingeke/just-code/releases/download/v0.1.0/justcode-darwin-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/kingeke/just-code/releases/download/v0.1.0/justcode-darwin-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/kingeke/just-code/releases/download/v0.1.0/justcode-linux-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/kingeke/just-code/releases/download/v0.1.0/justcode-linux-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install Dir["*"].first => "justcode"
  end

  test do
    assert_match "JustCode CLI", shell_output("#{bin}/justcode --help")
  end
end
