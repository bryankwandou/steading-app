#!/data/data/com.termux/files/usr/bin/bash
# Steading -- one-shot Termux setup.
# Usage:  bash scripts/setup-termux.sh
set -e

echo ""
echo "  Steading -- setup Termux"
echo ""

echo "  [1/4] memperbarui daftar paket"
pkg update -y >/dev/null 2>&1 || true

echo "  [2/4] memasang nodejs, python, ffmpeg"
pkg install -y nodejs python ffmpeg

echo "  [3/4] memasang yt-dlp"
pip install -U yt-dlp

echo "  [4/4] memeriksa hasil"
cd "$(dirname "$0")/.."
node scripts/check-deps.js

cat <<'TXT'

  Selesai.

  Start the server:     npm start
  Buka di Chrome HP:    http://localhost:3000
  Pasang sebagai app:   menu Chrome > Add to Home screen

  Catatan: biarkan Termux berjalan di latar belakang selama memakai Steading.
  So Android does not kill it, run once:              termux-wake-lock

TXT
