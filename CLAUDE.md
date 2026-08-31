# Steading

> Fast. Seamless. 100% Local.

Video & audio downloader for 25 sites -- YouTube, TikTok, Instagram, Facebook, Twitch,
Vimeo, Dailymotion, Reddit, Pinterest, Snapchat, Bluesky, Tumblr, Telegram, VK, Weibo,
Xiaohongshu, Bilibili, Kick, Odysee, SoundCloud, Bandcamp and
Mixcloud -- that runs entirely on the user's own machine or phone. No hosting, no accounts, no telemetry, no cloud round
trip. The frontend is a PWA installable to the home screen; the backend is a
zero-dependency Node HTTP server that drives `yt-dlp` and `ffmpeg`.

## Non-negotiables

1. **Zero npm dependencies.** `package.json` has an empty `dependencies` block and it
   stays that way. `npm install` on Termux is slow and fragile; a folder you can `node
   server/index.js` straight out of a `git clone` is far more robust. External tooling
   (`yt-dlp`, `ffmpeg`) ships as platform binaries, not npm packages.
2. **No build step.** Plain HTML + CSS + ES modules. Edit, refresh, done. App shell
   budget: under 80 KB uncompressed, excluding icons (currently ~76 KB, roughly a third
   of it comments). The budget was 70 KB and ~61 KB when the app offered two formats on
   four sites; eleven formats across three kinds, the collapsible site list and the
   universal-mode notice account for the rest, and none of it is dead — the shell was
   checked for unreferenced code and unused dictionary keys when the number moved.
   The number that actually matters is unchanged: it does **not grow with the language
   count** — only English and Indonesian are inline; the other 22 dictionaries are
   113 KB that never load unless someone picks one.
3. **One spawn site.** Only `server/ytdlp.js` may call `child_process`. Routes never
   touch it. This keeps the entire command-injection surface auditable in one file.
4. **Every temp file is owned by a job, and every job cleans up.** See the cleanup
   contract below — it is a hard requirement, not a nicety.
5. **The server never sends prose.** Every failure crosses the wire as a stable code
   from `server/lib/errors.js`; the client owns the wording. Adding a language must
   never require touching server code.
6. **No component hard-codes a colour.** Every colour is a token defined in both themes.
   A component that reaches for a literal is a dark-mode bug waiting to happen.

## Tech stack

| Layer     | Choice                                                        |
| --------- | ------------------------------------------------------------- |
| Backend   | Node.js >= 18, `node:http` / `node:child_process` / `node:fs`  |
| Frontend  | HTML + hand-written CSS + Vanilla JS (ES modules)              |
| Transport | JSON over `fetch`, live progress over Server-Sent Events       |
| External  | `yt-dlp` (extraction/download), `ffmpeg` (merge, MP3 encode)   |

## Folder layout

```
steading/
├── CLAUDE.md · README.md · package.json      dependencies: {}
├── server/
│   ├── index.js        HTTP routing, SSE, file streaming
│   ├── config.js       port, host, binary resolution, limits
│   ├── static.js       public/ server + MIME + cache headers
│   ├── ytdlp.js        THE ONLY module that spawns processes
│   └── lib/
│       ├── errors.js     THE error-code table (server side of i18n)
│       ├── validate.js   URL allowlist + format/quality validation
│       ├── progress.js   yt-dlp stdout -> structured progress events
│       ├── jobs.js       job registry, lifecycle, SSE fan-out
│       └── cleanup.js    tmp dir removal, sweeper, exit hooks
├── public/
│   ├── index.html · manifest.json · sw.js
│   ├── css/style.css                  light + dark tokens, one source of colour
│   ├── js/app.js · js/api.js
│   ├── js/i18n.js       dictionaries (en + id inline), lookup, language switching
│   ├── js/theme.js      light/dark/system, persistence, crossfade
│   ├── js/boot-theme.js blocking pre-paint theme guard (no inline script under CSP)
│   ├── i18n/<code>.json 22 lazy-loaded dictionaries
│   └── icons/
├── scripts/  check-deps.js · make-icons.js · share.js · publish-live.js
│            setup-termux.sh · setup-unix.sh · setup-windows.ps1
├── extension/  MV3 browser extension: one button, opens /?url=… No download logic.
└── tmp/      per-job scratch space, always transient
```

## How the local backend works

The server binds to `127.0.0.1:3000`. On a phone this runs inside Termux and you open
`http://localhost:3000` in Chrome on that same device. This matters: `localhost` counts
as a **secure context**, so Service Workers and "Add to Home Screen" work fully without
HTTPS or certificates.

Request flow:

1. Paste URL -> `POST /api/info` -> `yt-dlp -J` fetches **metadata only**, nothing is
   downloaded yet. Title, thumbnail, duration and available qualities come back, plus
   `audioOnly` when the source has no video stream to offer.
2. Choose MP4 or MP3 -> `POST /api/jobs` -> the server spawns `yt-dlp`, writing into
   `tmp/<jobId>/`.
3. `GET /api/jobs/:id/events` (SSE) streams real percentage, speed and ETA, including
   the ffmpeg merge / MP3 encode phase.
4. `GET /api/jobs/:id/file` streams the finished file as an attachment; the browser
   drops it in the device's Downloads folder, then the temp directory is purged.

**Why two phases instead of piping yt-dlp straight into the HTTP response:** merging
video+audio and encoding MP3 both need seekable output, which a pipe cannot provide.
A pipe also means no `Content-Length`, so a mobile browser shows no download progress.
The two-phase design keeps both. Nothing accumulates server-side either way.

## Cleanup contract

Temp directories are the one thing that can silently eat a phone's storage, so the
rules are explicit:

- **Success** — the temp dir is removed right after the file finishes streaming.
- **Client disappears mid-download** — when the SSE stream closes and the job is still
  running, a 15 s grace timer starts (survives a flaky-network reconnect). If nobody
  reattaches, the child process is killed and the temp dir is removed.
- **Error / cancel** — the child is killed with SIGKILL and the temp dir is removed in
  the same `finally` path. There is exactly one purge function; every terminal state
  routes through it.
- **Idle completed job** — a finished file nobody fetched is purged after 10 minutes.
- **Startup sweep** — on boot, `tmp/` is wiped of anything left by a previous run
  (power loss, `kill -9`, Termux swipe-away).
- **Exit hooks** — `SIGINT`, `SIGTERM` and `beforeExit` purge all live jobs
  synchronously.

Invariant to preserve when editing: **no code path may create a directory under `tmp/`
without registering it with a job**, because the sweeper and exit hooks only know about
registered jobs plus whole-directory wipes at boot.

## Supported sites

`PLATFORMS` in `server/lib/validate.js` is the single list. Everything downstream reads
it: `/api/health` publishes it, the UI's "works with" line renders it, and `validateUrl`
enforces it. **Adding a site is one row.** Nothing in the UI, the error table or the
dictionaries names a platform, so nothing else has to change -- and because the same
row is what the validator checks, the UI cannot advertise a site the server rejects.

Two rules the table encodes:

- **Only extractors that work without an account.** yt-dlp ships well over a thousand
  extractors; most of the ones left out need a signed-in cookie jar. X is the awkward
  case and sits in `LOCKED` rather than `PLATFORMS`: yt-dlp does carry a Twitter
  extractor, but it has needed cookies for most video posts since the guest API closed,
  and a row that fails on the majority of links is worse than an honest no. Threads has
  no extractor at all. `LOCKED` exists so those two are named and explained instead of
  being met with a generic "not supported".
- **`audio: true` marks a site with no video at all** (SoundCloud, Bandcamp, Mixcloud).
  An MP4 request against one is refused in `handleCreateJob`, because the format
  selector would otherwise fall through to the best audio track and hand back a file
  named `.mp4` with no picture in it. The UI disables the MP4 half of the segmented
  control for the same sources, using `audioOnly` from `/api/info` -- which is also true
  for a one-off item that turned out to have no video stream, not only for those three
  sites.

A short-link domain (`b23.tv`, `pin.it`, `xhslink.com`) is a separate registrable name,
so it needs its own entry; a subdomain does not, because a host matches as a subdomain
of any listed entry.

## Formats

`FORMAT_TABLE` in `server/lib/validate.js` is the list, and `id` doubles as the file
extension -- `safeFilename(title, format)` and `findOutputFile(dir, format)` both depend
on that, so keep them equal. `/api/health` publishes the ids grouped by kind and the UI
builds its controls from that, which is why an option the server would refuse cannot
appear in the picker.

| kind    | ids                             | how it is produced                          |
| ------- | ------------------------------- | ------------------------------------------- |
| `video` | mp4, mkv, webm                  | stream selector + `--merge-output-format`   |
| `audio` | mp3, m4a, opus, wav, flac       | `--extract-audio --audio-format`            |
| `image` | jpg, png, webp                  | `--write-thumbnail`, then our own ffmpeg    |

Three things here are easy to undo by accident:

- **Each video container carries its own selector**, because the streams worth preferring
  differ (mp4 wants an mp4/m4a pair so the merge is a remux; webm wants webm; mkv holds
  anything). The height cap is substituted into every branch that names a video stream --
  a branch that loses it quietly hands back the 4K copy nobody asked for, which is what
  the `every video format merges into its own container` test checks.
- **`--audio-quality` goes only to the lossy encoders.** WAV and FLAC ignore it, and a
  flag that cannot apply invites the next reader to believe it does.
- **Image conversion is ours, not yt-dlp's.** `--convert-thumbnails` fails outright
  against ffmpeg 8 ("Preprocessing: Conversion failed!"), because the image2 muxer now
  treats a single un-numbered output as an error rather than a warning. `convertImage()`
  in ytdlp.js passes `-update 1`, which is what ffmpeg 8 wants, and `-pix_fmt yuv420p`
  for jpg because JPEG cannot carry an alpha channel. It also means the picture yt-dlp
  saved as `media.png` can be a JPEG -- yt-dlp names it from the URL, ffmpeg reads the
  content -- so the conversion decision is made on what was *requested*, never on the
  name on disk.

An image job spawns a second process, so `startDownload` takes an `onChild` callback and
jobs.js keeps only the current one. Without it a cancel during the conversion would kill
a yt-dlp that had already exited and leave ffmpeg writing into a directory the purge was
about to remove -- the exact leak the cleanup contract exists to prevent.

## Localization

24 languages. English and Indonesian are compiled into `public/js/i18n.js`; the other
22 sit in `public/i18n/<code>.json` and are fetched the first time they are chosen, so
the app shell stays small on a phone. A missing key falls back to English rather than
rendering a raw identifier.

The important half is on the server: **no user-facing sentence exists in server code.**
Every failure is a code from `server/lib/errors.js` (`private_content`, `geo_blocked`,
`too_many_jobs`), sent as `{ code, error, detail }` where `error` is only an English
fallback for non-Steading clients and `detail` is optional raw context such as the
yt-dlp line. `classifyError()` in ytdlp.js maps stderr to those codes.

Consequences to preserve:

- Adding a language is one JSON file plus one row in `LANGUAGES`. No server change.
- Anything rendered from state must be re-renderable. The UI stores messages as
  `{key, vars}`, not as finished strings, so switching language mid-error updates the
  text that is already on screen. `repaintLanguage()` in app.js is the single place
  that replays all such state.
- `tests/i18n.test.js` enforces the invariants a reviewer cannot check by eye: key
  parity across all 24 dictionaries, identical `{placeholder}` sets, no prose left in
  English, and an entry for every code in `ERR`.
- Arabic and Persian set `dir="rtl"` on `<html>`. The layout is flex-based so it
  mirrors for free; only physically-offset items have RTL rules in the stylesheet.

## Theming

Three states, two stored values: `light`, `dark`, or no stored value at all, which
*is* the "follow the system" state. That is why absence is meaningful and must not be
normalized away — the OS switching at sunset should keep working until the user makes
an explicit choice.

- `public/js/boot-theme.js` is a blocking classic script in `<head>`. It stamps
  `data-theme` before the stylesheet paints, so a dark-mode phone never flashes white.
  It is a separate file rather than inline script because of the CSP.
- Colour transitions are enabled **only** during the 200 ms crossfade, via the
  `.theme-shifting` class. Leaving them on globally makes every unrelated hover lag by
  the same 200 ms, which is what a "janky" theme toggle usually is.
- `[hidden] { display: none !important; }` is load-bearing: the UA rule for `[hidden]`
  loses to any class that sets a display, and `.card` is `display: flex`.

## Reaching the server from outside

`npm run share` puts the server behind a Cloudflare quick tunnel. Two things had to
change for that to work, and both are worth keeping straight.

**PUBLIC_HOST.** `hostAllowed()` rejects any Host that is not a loopback name, which is
the DNS-rebinding defence and must stay. A tunnel arrives with a public Host, so
`config.publicHosts` lists extra hostnames that are also accepted. It is empty by
default and `scripts/share.js` sets it to the one hostname cloudflared just printed —
never a wildcard. A plain `npm start` is unchanged.

**SSE is not reliable through proxies.** Cloudflare buffers `text/event-stream`, so the
browser receives nothing and the progress bar sits frozen while the download actually
runs. `api.watch()` therefore runs a watchdog: if no frame arrives for five seconds it
abandons the stream and polls `GET /api/jobs/:id` instead.

That fallback broke the cleanup contract the first time it was written, and the fix
matters. Dropping the SSE stream is exactly the signal `subscribe()` uses to decide the
browser is gone, so the job was reclaimed mid-download and the user was told "the
browser disconnected". `touchJob()` closes that hole: every status read pushes the
abandon deadline back, so a polling client counts as present. If you change either side
of this, keep the two tests named around polling in tests/jobs.test.js passing.

## Security

The threat model is a hostile page in another tab on the same device, not a remote
attacker — the server binds to loopback.

- **Allowlist before spawn.** Only hosts named in `PLATFORMS` reach yt-dlp. The table
  is the security boundary as well as the feature list, which is why adding a site is a
  row in it rather than a looser match.
- **Universal mode is the one way past that, and it is off by default.** `UNIVERSAL=1`
  makes `validateUrl` accept any http(s) host, which trades the guarantee above for
  reach: a page in another tab could then walk the local server through yt-dlp's
  thousand-odd extractors. Every other defence still stands and none of them were
  loosened to make it work -- no shell, argv arrays only, `--` before the URL, the
  loopback bind, the Host check, and every URL-shape check that runs before the
  allowlist. Sites in `LOCKED` stay locked, because those are known not to work rather
  than merely unlisted. The flag is threaded in as an argument (`validateUrl(input,
  { universal })`) rather than read from config inside validate.js, so the module stays
  pure and both modes are testable side by side.
- **No shell, ever.** Array argv only, built in one file, always `--` before the URL.
- **Host check, not just Origin.** A hostile domain can resolve to 127.0.0.1 and pass an
  Origin check because the origin is genuinely its own. It cannot forge `Host`, so
  `hostAllowed()` rejects anything not addressed to a loopback name. This is the
  defence against DNS rebinding and it must not be removed.
- **CSP** on HTML responses: `script-src 'self'`, no inline script, `frame-ancestors
  'none'`, `form-action 'none'`. `img-src` allows `https:` because thumbnails come
  from platform CDNs; an `<img>` cannot execute.
- **Titles are untrusted input.** They arrive from a remote site and end up in a
  `Content-Disposition` header and the user's filesystem, so `safeFilename()` strips
  path separators, Windows-reserved characters, control characters, and device names.
- **Interpolation is textContent only.** `t()` results are assigned to `textContent`,
  never `innerHTML`, so a hostile video title cannot become markup.

## Design direction

A single blue accent spent sparingly — primary button, progress line, focus ring,
nothing else. 10 px radii, 1 px borders instead of heavy shadows, progress as a 4 px
hairline rather than a fat pill, hand-written 1.5-stroke SVG icons. Single column,
`max-width: 560px`, mobile-first, 44 px touch targets, notch-safe insets.

The "works with" line under the input prints the first five site names and hides the
rest behind an inline count, because two dozen names is a paragraph rather than a hint.
The truncated form deliberately drops the "and" that `Intl.ListFormat` would add: a
conjunction claims the list has ended.

Light is white canvas with `#0D1526` ink and a `#1B6EF3` accent. Dark is blue-tinted
slate (`#0B1220`), never pure black, with the accent lifted to `#5B9DFF` so it still
reads as the accent against a dark ground. Every pairing meets WCAG AA; `--ink-faint`
is deliberately pinned at the faintest tone that still passes.

The two pieces of motion that earn their keep: the segmented control's thumb slides
between MP4 and MP3, and cards rise 5 px on entry. Both respect
`prefers-reduced-motion`.

Explicitly avoided, because they read as template output: gradient hero sections,
`rounded-3xl` cards with wide shadows, sparkle badges, emoji in UI copy.

## Testing

`npm test` runs `node --test --experimental-test-module-mocks tests/*.test.js` and
covers the modules with real logic: URL validation, the progress parser, the yt-dlp
argument builder, the job lifecycle and its cleanup contract (yt-dlp mocked), and
translation integrity across all 24 dictionaries.

Not covered by unit tests, and therefore verified by hand against a live URL whenever
this area changes: an actual MP4 and MP3 download end to end, and the two cleanup paths
that involve a real child process (cancel mid-download, and the browser disconnecting).
Both leave `tmp/` empty; that is the assertion that matters.

## Scope

MVP only. Deliberately left out: playlists, download history, subtitles, batch queues.
The app stays small; these can land later without reshaping anything above.
