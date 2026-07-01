# Homebrew formula for JustCode.
#
# Installs the prebuilt, self-contained binary (the Bun runtime is embedded),
# so there is no Node/Bun dependency. Host this in a tap repo named
# `homebrew-justcode`, then:
#
#   brew tap kingeke/justcode
#   brew install justcode
#
# On each release, update `version` and the per-arch `url`/`sha256` to point at
# the GitHub release assets (the sha256 of each binary). Intel macOS is not
# built (Bun can't cross-compile @opentui's native lib on that runner), so there
# is no darwin-x64 bottle.
class Justcode < Formula
  desc "Interactive terminal coding assistant CLI"
  homepage "https://github.com/kingeke/justcode"
  version "0.1.4"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kingeke/justcode/releases/download/v0.1.4/justcode-darwin-arm64"
      sha256 "4df93baf0dea6aa5d02259c97cbd3b40e0f9c2cd6fcb10e3586f7295e9e129f5"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/kingeke/justcode/releases/download/v0.1.4/justcode-linux-arm64"
      sha256 "fa5719f74d4b14a2c4e1eaaeceee9876efce137881d09a6508a8b3a3415fedad"
    end
    on_intel do
      url "https://github.com/kingeke/justcode/releases/download/v0.1.4/justcode-linux-x64"
      sha256 "7fc364696e94e95db05d0780883f2d9bb2d01f077f6d42f9419585462a660495"
    end
  end

  def install
    bin.install Dir["*"].first => "justcode"
  end

  test do
    assert_match "JustCode", shell_output("#{bin}/justcode --help")
  end
end
