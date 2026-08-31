/**
 * Start the tunnel, then point getsteading.vercel.app/live at it.
 *
 * Written for a room where the people testing this can open a browser and nothing else:
 * not a file manager, not a downloaded file, not a terminal. Every route that ends in
 * "double-click the file" is closed to them, so the app has to already be running and
 * they have to reach it by typing an address -- the one thing they do know how to do.
 *
 * A quick tunnel gets a new random hostname each time it starts, which is useless when
 * an address has to be handed to twenty-five people in advance. So the address they are
 * given is the fixed one, and this points it at whatever hostname the tunnel got:
 *
 *   getsteading.vercel.app/live  ->  (today's tunnel)  ->  the app on this machine
 *
 * Everything downloaded goes through this machine's connection, which is the whole
 * reason it works: the platforms refuse hosting providers, not households.
 *
 * Run: npm run live
 *
 * Be clear about what this is while it runs. The address is public and it drives a
 * downloader on your machine, using your connection and your disk. Ctrl-C closes the
 * tunnel, the server, and leaves /live saying that the session has ended.
 */

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const HOSTED = resolve(APP, '..', 'steading-vercel');
const LIVE_PAGE = join(HOSTED, 'public', 'live.html');
const LIVE_STATUS = join(HOSTED, 'public', 'live-status.json');

const PORT = process.env.PORT || '3000';

function say(line) { console.log(`  ${line}`); }

/**
 * The page at /live.
 *
 * It carries the session address in a data attribute rather than a meta refresh, and
 * js/live.js checks that the address answers before moving anyone to it. A laptop that
 * went to sleep then produces a sentence instead of a browser connection error, which
 * matters when the audience reads any failure as the product failing.
 */
function livePage({ target }) {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Steading</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: light dark; --bg:#fff; --ink:#0d1526; --soft:#55637a; --accent:#1558c8 }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1220; --ink:#e9eefb; --soft:#a7b7cf; --accent:#5b9dff }
  }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--bg);
         color:var(--ink); padding:28px; text-align:center;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
  h1 { font-size:21px; font-weight:640; letter-spacing:-.02em; margin:0 0 10px }
  p { margin:0 0 8px; max-width:46ch }
  .muted { color:var(--soft); font-size:14px }
  a { color:var(--accent) }
  [hidden] { display:none !important }
</style>
</head>
<body data-target="${target || ''}">
<main>
  <section id="waiting"${target ? '' : ' hidden'}>
    <h1>Membuka Steading&hellip;</h1>
    <p>Opening Steading&hellip;</p>
    <p class="muted">Kalau halaman ini tidak berpindah sendiri, <a id="go" href="${target || '/'}">ketuk di sini</a>.<br>
    If this page does not move by itself, <a href="${target || '/'}">tap here</a>.</p>
  </section>

  <section id="dead"${target ? ' hidden' : ''}>
    <h1>Sesi ini sedang tidak dibuka</h1>
    <p>This session is not open right now.</p>
    <p class="muted">Steading berjalan di komputer penyaji, dan komputer itu sedang tidak menjalankannya.<br>
    Steading runs on the presenter&rsquo;s computer, and that computer is not running it at the moment.</p>
    <p class="muted"><a href="/">Kembali ke halaman utama</a> &middot; <a href="/">Back to the main page</a></p>
  </section>
</main>
<script type="module" src="/js/live.js"></script>
</body>
</html>
`;
}

function deploy(note) {
  say(note);
  const out = spawnSync('npx', ['vercel', 'deploy', '--prod', '--yes'], {
    cwd: HOSTED, encoding: 'utf8', shell: true, timeout: 420_000,
  });
  const url = (out.stdout || '').match(/https:\/\/getsteading-[a-z0-9]+-[a-z0-9-]+\.vercel\.app/)?.[0];
  if (!url) {
    say('Deploy gagal. /live tidak diperbarui.  /  Deploy failed; /live was not updated.');
    return false;
  }
  const alias = spawnSync('npx', ['vercel', 'alias', 'set', url, 'getsteading.vercel.app'], {
    cwd: HOSTED, encoding: 'utf8', shell: true, timeout: 180_000,
  });

  // Judged by exit code and by both streams, not by scanning stdout alone: the CLI
  // prints its success line to stderr, so the first version of this reported a failure
  // every single time while the alias was in fact live. A false alarm here is worse
  // than no message, because it sends the presenter to announce the wrong address.
  const both = `${alias.stdout || ''}${alias.stderr || ''}`;
  const ok = alias.status === 0 && !/error/i.test(both);

  if (ok) {
    say('getsteading.vercel.app/live diperbarui.');
  } else {
    const lastLine = both.trim().split(String.fromCharCode(10)).pop().trim();
    say(`Alias gagal dipasang. ${lastLine}`);
  }
  return ok;
}

/* ------------------------------------------------------------------- run */

console.log('');
console.log('  Steading  ·  sesi langsung  /  live session');
console.log('');

const cloudflared = resolveCloudflared();

say('Membuka tunnel…  /  Opening the tunnel…');

const tunnel = spawn(cloudflared, ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let host = null;
let server = null;

const watch = (chunk) => {
  const text = String(chunk);
  if (host) return;
  const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!found) return;

  host = found[0];
  say(`Tunnel   ${host}`);

  // The server refuses any Host it was not told about, so it starts only now, with this
  // exact hostname allowed and nothing wider.
  server = spawn(process.execPath, [join(APP, 'server', 'index.js')], {
    cwd: APP,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT,
      PUBLIC_HOST: new URL(host).hostname,
      // A room takes turns; two at a time would leave most of them waiting.
      MAX_JOBS: process.env.MAX_JOBS || '6',
    },
  });

  writeFileSync(LIVE_PAGE, livePage({ target: host }));
  writeFileSync(LIVE_STATUS, `${JSON.stringify({ active: true, opened: new Date().toISOString() }, null, 2)}
`);
  const ok = deploy('Mengarahkan /live ke tunnel…  /  Pointing /live at the tunnel…');

  console.log('');
  console.log('  ==========================================================');
  console.log('     Bagikan alamat ini  /  Share this address');
  console.log('');
  console.log('        https://getsteading.vercel.app/live');
  console.log('');
  console.log('     Alamat itu tetap. Tidak berubah antar sesi.');
  console.log('     That address is fixed. It does not change between sessions.');
  console.log('  ==========================================================');
  console.log('');
  if (!ok) say('Peringatan: /live belum menunjuk ke sini. Bagikan alamat tunnel di atas.');
  say('Ctrl-C menutup semuanya.  /  Ctrl-C closes everything.');
  console.log('');
};

tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);

function shutdown() {
  say('');
  say('Menutup sesi…  /  Closing the session…');
  try { server?.kill(); } catch { /* already gone */ }
  try { tunnel.kill(); } catch { /* already gone */ }

  // Leave /live saying the session ended rather than pointing at a dead tunnel.
  writeFileSync(LIVE_PAGE, livePage({ target: null }));
  writeFileSync(LIVE_STATUS, `${JSON.stringify({ active: false }, null, 2)}
`);
  deploy('Menutup /live…  /  Closing /live…');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* --------------------------------------------------------------- helpers */

function resolveCloudflared() {
  const local = join(APP, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const probe = spawnSync(local, ['--version'], { encoding: 'utf8' });
  if (!probe.error) return local;
  return 'cloudflared';
}
