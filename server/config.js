import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = join(ROOT, 'public');
export const TMP_DIR = join(ROOT, 'tmp');
export const BIN_DIR = join(ROOT, 'bin');

const isWin = process.platform === 'win32';

/**
 * Resolve an external binary in priority order:
 *   1. explicit env override (YTDLP_PATH / FFMPEG_PATH)
 *   2. bundled ./bin/ folder  -- how the Windows setup script installs it
 *   3. whatever is on PATH    -- how Termux / apt / brew install it
 * Returns null when nothing is found; check-deps.js turns that into a readable error.
 */
export function resolveBinary(name, envVar) {
  const override = process.env[envVar];
  if (override && existsSync(override)) return override;

  for (const candidate of isWin ? [`${name}.exe`, `${name}.cmd`, name] : [name]) {
    const local = join(BIN_DIR, candidate);
    if (existsSync(local)) return local;
  }

  try {
    const probe = isWin ? 'where' : 'which';
    const out = execFileSync(probe, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return null;
}

export const config = {
  /**
   * gallery-dl, if it happens to be installed. Never required: the image provider
   * chain skips this step when it is absent, which is what keeps the install story
   * for someone on a phone as short as it is.
   */
  gallerydl: resolveBinary('gallery-dl', 'GALLERYDL_PATH'),

  host: process.env.HOST || '127.0.0.1',

  /**
   * Universal mode: hand any http(s) link to yt-dlp instead of only the listed sites.
   *
   * Off unless `UNIVERSAL=1` is set, and that default is deliberate. The allowlist is
   * this project's security boundary, not a feature list -- it is what guarantees that
   * a page in another tab cannot walk the local server through yt-dlp's thousand-odd
   * extractors. Turning this on trades that guarantee for reach.
   *
   * What does *not* change when it is on, because those are the defences that still
   * hold: no shell, argv arrays only, `--` before the URL, the loopback bind, and the
   * Host check. A universal link is still parsed by `new URL`, still restricted to
   * http and https, and still refused if it names a site in LOCKED.
   */
  universal: process.env.UNIVERSAL === '1',

  /**
   * Where a post's pictures are looked for, in order, until one provider returns some.
   *
   * Three exist and none of them is required:
   *
   * - `scrape` reads the page itself -- og:image, twitter:image, JSON-LD, then plain
   *   <img> tags. No extra program, and it is the one that covers an ordinary website
   *   or a forum thread. It cannot see a page that builds itself in the browser.
   * - `ytdlp` asks the downloader we already have for the poster frame or cover art.
   *   One picture, never a carousel, but it works wherever yt-dlp works.
   * - `gallerydl` shells out to gallery-dl, which is the specialist: Instagram
   *   carousels, Pinterest, Reddit galleries, Tumblr photosets, Weibo, Xiaohongshu.
   *   Used only if it is installed; absent, the chain simply moves on.
   *
   * The order is a preference, not a ranking of quality -- put `gallerydl` first if you
   * have it and mostly grab social posts. Set `IMAGE_PROVIDERS=scrape` to pin it to one.
   */
  imageProviders: (process.env.IMAGE_PROVIDERS || 'gallerydl,scrape,ytdlp')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  /** How many pictures one post may contribute, so a 400-image board cannot run away. */
  maxImagesPerJob: Number(process.env.MAX_IMAGES) > 0 ? Number(process.env.MAX_IMAGES) : 60,

  /**
   * Hostnames allowed in addition to loopback, comma separated.
   *
   * Empty by default, and that default is the safe one: without this the server only
   * answers requests addressed to a loopback name, which is what stops a hostile page
   * from pointing its own domain at 127.0.0.1 and talking to this API (DNS rebinding).
   *
   * Set it only when deliberately exposing the server through a tunnel, and set it to
   * the exact tunnel hostname -- never to '*'. Exposing this server puts a downloader
   * on the public internet under your address; treat it as temporary.
   *
   *   PUBLIC_HOST=abc-def.trycloudflare.com npm start
   */
  publicHosts: (process.env.PUBLIC_HOST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  port: Number(process.env.PORT) || 3000,

  get ytdlp() { return resolveBinary('yt-dlp', 'YTDLP_PATH'); },
  get ffmpeg() { return resolveBinary('ffmpeg', 'FFMPEG_PATH'); },

  // Limits. Deliberately conservative -- this thing runs on a phone.
  //
  // Overridable because one situation genuinely needs more: a room of people taking
  // turns against a single machine, where two at a time means most of them waiting. The
  // default stays low so the phone case is unchanged unless someone asks for otherwise.
  maxConcurrentJobs: Math.max(1, Number(process.env.MAX_JOBS) || 2),
  infoTimeoutMs: 45_000,
  downloadTimeoutMs: 30 * 60_000,
  maxRequestBodyBytes: 8 * 1024,

  // Cleanup timings -- see the cleanup contract in CLAUDE.md.
  abandonGraceMs: 15_000,      // SSE closed while running -> kill + purge after this
  completedTtlMs: 10 * 60_000, // finished file nobody fetched -> purge after this
  sweepIntervalMs: 60_000,
};
