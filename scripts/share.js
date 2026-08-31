/**
 * Expose the local server on a public URL, for when someone has to verify this works
 * without installing anything.
 *
 * Order matters. The tunnel hostname is not known until cloudflared prints it, and the
 * server refuses any Host it was not told about, so the tunnel starts first and the
 * server is started afterwards with that exact hostname allowed.
 *
 * What this does NOT do is loosen anything permanently: PUBLIC_HOST is scoped to the
 * child process started here, so a plain `npm start` is still loopback-only.
 *
 * Run: npm run share
 *
 * Two things to be clear about before using it. The URL is public while it runs -- it
 * is a downloader anyone with the link can drive, using your connection and your disk.
 * And a quick tunnel gets a new random hostname every time, so share the URL after
 * starting, not before. Ctrl-C closes both.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const CLOUDFLARED = process.env.CLOUDFLARED || 'cloudflared';

const children = [];
let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(code), 300).unref?.();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('');
console.log('  Starting tunnel...');

const tunnel = spawn(CLOUDFLARED, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(tunnel);

tunnel.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\n  cloudflared is not installed.');
    console.error('  Windows : winget install Cloudflare.cloudflared');
    console.error('  Termux  : pkg install cloudflared');
    console.error('  macOS   : brew install cloudflared\n');
  } else {
    console.error('\n  Could not start cloudflared:', err.message, '\n');
  }
  shutdown(1);
});

let host = null;
let server = null;

function startServer(hostname) {
  console.log('');
  console.log('  Public URL   ', `https://${hostname}`);
  console.log('  Local URL    ', `http://127.0.0.1:${PORT}`);
  console.log('');
  console.log('  Anyone with that link can use this downloader while it is open.');
  console.log('  Ctrl-C closes the tunnel and the server together.');
  console.log('');

  server = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT), PUBLIC_HOST: hostname },
  });
  children.push(server);
  server.on('exit', (code) => shutdown(code ?? 0));
}

// cloudflared prints the assigned hostname to stderr.
const scan = (chunk) => {
  if (host) return;
  const match = String(chunk).match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i);
  if (!match) return;
  host = match[1];
  startServer(host);
};

tunnel.stdout.on('data', scan);
tunnel.stderr.on('data', scan);

tunnel.on('exit', (code) => {
  if (!host) {
    console.error(`\n  The tunnel exited before giving a URL (code ${code}).\n`);
  }
  shutdown(code ?? 0);
});
