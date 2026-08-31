#!/usr/bin/env node
/**
 * Preflight check. Tells you exactly what is missing and how to install it on the
 * platform you are actually on -- rather than failing at the first download.
 */

import { execFile } from 'node:child_process';
import { config } from '../server/config.js';
import { probeVersion } from '../server/ytdlp.js';

/**
 * Can this ffmpeg actually produce an MP3?
 *
 * Reporting a version only proves a binary answered. MP3 needs the libmp3lame encoder,
 * and plenty of builds ship without it -- stripped distro packages, and the smaller
 * builds people reach for on a phone to save space. Such a build passes a version check
 * and then fails at the end of a download, which is the worst possible moment: the wait
 * has already been spent.
 *
 * So this encodes a tenth of a second of silence and looks at what comes back. No
 * network, no temp file, and quick even on a slow device.
 */
function canEncodeMp3(bin) {
  return new Promise((resolve) => {
    if (!bin) return resolve(false);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '0.1',
      '-c:a', 'libmp3lame',
      '-f', 'mp3', 'pipe:1',
    ];

    execFile(bin, args, { timeout: 60_000, windowsHide: true, encoding: 'buffer', maxBuffer: 1 << 20 },
      (err, stdout) => {
        // An MP3 frame starts with 0xFF 0xFB (or an ID3 header). Either means the
        // encoder ran; an empty or tiny output means it did not.
        resolve(!err && stdout?.length > 64);
      });
  });
}

const isWin = process.platform === 'win32';
const isTermux = Boolean(process.env.PREFIX?.includes('com.termux'));

const INSTALL = {
  termux: {
    'yt-dlp': 'pkg install python && pip install -U yt-dlp',
    ffmpeg: 'pkg install ffmpeg',
  },
  win32: {
    'yt-dlp': 'winget install yt-dlp.yt-dlp    (atau taruh yt-dlp.exe di folder bin/)',
    ffmpeg: 'winget install Gyan.FFmpeg',
  },
  linux: {
    'yt-dlp': 'pipx install yt-dlp    (atau: sudo apt install yt-dlp)',
    ffmpeg: 'sudo apt install ffmpeg',
  },
  darwin: {
    'yt-dlp': 'brew install yt-dlp',
    ffmpeg: 'brew install ffmpeg',
  },
};

const platformKey = isTermux ? 'termux' : isWin ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const hints = INSTALL[platformKey];

const rows = [
  { name: 'yt-dlp', path: config.ytdlp, flag: '--version', required: true },
  { name: 'ffmpeg', path: config.ffmpeg, flag: '-version', required: false },
];

console.log(`\n  Steading -- dependency check (${platformKey})\n`);

let missingRequired = false;

for (const row of rows) {
  const version = await probeVersion(row.path, row.flag);
  if (version) {
    console.log(`  [ok]  ${row.name.padEnd(8)} ${version}`);
    console.log(`        ${row.path}`);

    // Presence is not capability. Say which of the two is true, here, rather than
    // letting an MP3 request discover it after the download has finished.
    if (row.name === 'ffmpeg') {
      const mp3 = await canEncodeMp3(row.path);
      console.log(mp3
        ? '        MP3 encoding: works (libmp3lame)'
        : '        MP3 encoding: NOT available -- this build has no libmp3lame.');
      if (!mp3) {
        console.log('        MP4 downloads are unaffected; only MP3 will fail.');
        console.log(`        A full build fixes it: ${hints.ffmpeg}`);
      }
    }
  } else {
    if (row.required) missingRequired = true;
    console.log(`  [--]  ${row.name.padEnd(8)} not found${row.required ? '  (REQUIRED)' : '  (needed for MP3 and video merging)'}`);
    console.log(`        install with: ${hints[row.name]}`);
  }
  console.log('');
}

const node = Number(process.versions.node.split('.')[0]);
console.log(`  [${node >= 18 ? 'ok' : '--'}]  node     v${process.versions.node}${node >= 18 ? '' : '  (butuh v18 atau lebih baru)'}\n`);

if (missingRequired) {
  console.log('  yt-dlp is required. Once installed, run again: npm run check\n');
  process.exit(1);
}
console.log('  Ready. Run: npm start\n');
