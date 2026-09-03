/**
 * Service worker.
 *
 * Scope is deliberately narrow: cache the app shell so the icon on the home screen
 * opens instantly and does not show a browser error when the Termux server happens to
 * be asleep. Everything under /api/ is network-only -- caching a download or a job's
 * state would be actively wrong.
 */

const VERSION = 'steading-app-6b3408fa1af2'; // rewritten by scripts/stamp-sw.js

const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/i18n.js',
  '/js/theme.js',
  '/js/boot-theme.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept the API: live progress, and a file transfer that must not be
  // buffered or replayed.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: try the network first so a running server always wins, fall back to
  // the cached shell when it is not up yet.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || offlinePage())),
    );
    return;
  }

  // Static assets: cache-first, refreshed in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

/**
 * Last resort when the shell was never cached and the server is down.
 *
 * This page cannot use i18n.js -- the dictionaries live on the server that is not
 * answering. So it says the same short thing in the two primary languages and leans on
 * the command itself, which is language-neutral. It respects the system theme for the
 * same reason: there is no stored preference to read from here.
 */
function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steading</title>
<style>
  :root{color-scheme:light dark;--bg:#fff;--ink:#0d1526;--soft:#55637a;--wash:#eff5ff;--line:#e6eaf1}
  @media (prefers-color-scheme:dark){
    :root{--bg:#0b1220;--ink:#e9eefb;--soft:#a7b7cf;--wash:#152743;--line:#1f2c43}
  }
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);
       font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
       padding:24px;text-align:center}
  h1{font-size:17px;font-weight:600;margin:0 0 8px;letter-spacing:-.015em}
  p{margin:0 0 4px;color:var(--soft);max-width:36ch}
  code{background:var(--wash);border:1px solid var(--line);padding:2px 6px;
       border-radius:5px;font-size:13px;color:var(--ink)}
</style>
<h1>Steading</h1>
<p>The local server is not running. Open a terminal in the Steading folder and run
<code>npm start</code>, then reopen this app.</p>
<p>Server lokal belum berjalan. Buka terminal di folder Steading, jalankan
<code>npm start</code>, lalu buka aplikasi ini lagi.</p>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
