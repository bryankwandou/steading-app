#!/usr/bin/env bash
# Steading -- one-shot setup for macOS and Linux.
# Usage:  bash scripts/setup-unix.sh
#
# Termux has its own script (setup-termux.sh) because its package manager and paths are
# nothing like a desktop Linux; this one covers macOS, Debian/Ubuntu, Fedora and Arch.
set -e

echo ""
echo "  Steading -- setup"
echo ""

# ------------------------------------------------------------------ detect

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(uname -s)" = "Darwin" ]; then
  FLAVOUR="macos"
elif have apt-get; then
  FLAVOUR="debian"
elif have dnf; then
  FLAVOUR="fedora"
elif have pacman; then
  FLAVOUR="arch"
else
  FLAVOUR="unknown"
fi

echo "  system: $FLAVOUR"
echo ""

# The two things Steading cannot run without. Node is checked separately because the
# advice when it is missing is different on every system.
NEEDED=""
have yt-dlp || NEEDED="$NEEDED yt-dlp"
have ffmpeg || NEEDED="$NEEDED ffmpeg"

if [ -z "$NEEDED" ]; then
  echo "  [1/2] yt-dlp and ffmpeg are already installed"
else
  echo "  [1/2] installing:$NEEDED"
  case "$FLAVOUR" in
    macos)
      if ! have brew; then
        echo ""
        echo "  Homebrew is not installed. Install it first:"
        echo '    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        echo ""
        exit 1
      fi
      # shellcheck disable=SC2086
      brew install $NEEDED
      ;;
    debian)
      sudo apt-get update
      # Debian's yt-dlp package lags badly and a stale yt-dlp is the single most common
      # cause of "this suddenly stopped working", so it comes from pip instead.
      # shellcheck disable=SC2086
      for pkg in $NEEDED; do
        if [ "$pkg" = "yt-dlp" ]; then
          sudo apt-get install -y python3-pip
          pip3 install --user -U --break-system-packages yt-dlp 2>/dev/null \
            || pip3 install --user -U yt-dlp
        else
          sudo apt-get install -y "$pkg"
        fi
      done
      ;;
    fedora)
      # shellcheck disable=SC2086
      sudo dnf install -y $NEEDED
      ;;
    arch)
      # shellcheck disable=SC2086
      sudo pacman -S --needed --noconfirm $NEEDED
      ;;
    *)
      echo ""
      echo "  Could not recognise this system's package manager."
      echo "  Install these by hand, then run this script again:$NEEDED"
      echo ""
      exit 1
      ;;
  esac
fi

if ! have node; then
  echo ""
  echo "  Node.js 18 or newer is missing. Install it, then run this script again:"
  case "$FLAVOUR" in
    macos)  echo "    brew install node" ;;
    debian) echo "    sudo apt-get install -y nodejs npm" ;;
    fedora) echo "    sudo dnf install -y nodejs" ;;
    arch)   echo "    sudo pacman -S nodejs" ;;
    *)      echo "    https://nodejs.org/en/download" ;;
  esac
  echo ""
  exit 1
fi

echo ""
echo "  [2/2] checking"
cd "$(dirname "$0")/.."
node scripts/check-deps.js

cat <<'TXT'

  Done.

  Start the server:   npm start
  Then open:          http://localhost:3000

  Nothing was added to your PATH and no service was installed. Steading runs only
  while that command is running, and only on this machine.

TXT
