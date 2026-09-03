/**
 * The only module in this project that spawns a process.
 *
 * Every argument list is built here from validated inputs and passed to execFile/spawn
 * as an array -- there is no shell, no string concatenation, and therefore no shell
 * quoting to get wrong. Routes call these functions; routes never import child_process.
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { guardProxyUrl } from './lib/guard-proxy.js';
import { formatInfo, pictureQuality } from './lib/validate.js';
import { scrapeImages } from './lib/scrape.js';
import { scrapeVideo } from './lib/videosrc.js';
import { downloadImages, convertArgs, isJpeg } from './lib/gallery.js';
import { imagesToPdf } from './lib/pdf.js';
import { createLineSplitter, parseLine } from './lib/progress.js';
import { ERR, coded } from './lib/errors.js';

/** Fixed output basename: metadata titles become the *download* name, never a path. */
const OUTPUT_BASENAME = 'media';

class MissingBinaryError extends Error {
  constructor(name) {
    super(`${name} is not installed.`);
    this.code = ERR.NO_BINARY;
    this.detail = name;
  }
}

function requireYtdlp() {
  const bin = config.ytdlp;
  if (!bin) throw new MissingBinaryError('yt-dlp');
  return bin;
}

/** Args shared by every invocation. */
function baseArgs() {
  const args = [
    '--no-playlist',        // a link inside a playlist means "this one video"
    '--no-warnings',
    '--no-color',
    '--no-mtime',
    '--retries', '3',
    '--socket-timeout', '15',
  ];
  if (config.ffmpeg) args.push('--ffmpeg-location', config.ffmpeg);
  return args;
}

/**
 * The impersonation target used when a site refuses the default client.
 *
 * "chrome" asks yt-dlp for the newest Chrome profile curl_cffi carries, so this does
 * not pin a version that will age out of the bundle.
 */
export const IMPERSONATE = 'chrome';

/**
 * Was this failure a refusal of the client itself?
 *
 * Narrow on purpose. A 403 means the server understood the request and declined it,
 * which is what fingerprint blocking looks like; a 404 or a parse failure means
 * something else entirely and retrying would only cost time.
 */
export function looksBlocked(stderr) {
  return /HTTP Error 403|403: Forbidden|Got error: 403/i.test(String(stderr || ''));
}

/** @returns {string[]} argv for a metadata-only probe. Exported for tests. */
export function buildInfoArgs(url, { proxy } = {}) {
  const args = [...baseArgs(), '--dump-single-json', '--skip-download'];
  // Before the `--` guard, never after: the URL stays the last word and can never be
  // read as a flag.
  if (proxy) args.push('--proxy', proxy);
  return [...args, '--', url];
}

/**
 * @returns {string[]} argv for an actual download. Exported for tests -- this is the
 * function most likely to be edited later, and the format selector is easy to get
 * subtly wrong.
 */
export function buildDownloadArgs({ url, format, quality = 'best', dir }) {
  const entry = formatInfo(format);
  if (!entry) throw coded(ERR.BAD_FORMAT);

  const args = [
    ...baseArgs(),
    '--newline',
    // Fixed, space-free template consumed by lib/progress.js.
    '--progress-template',
    'LZPROG %(progress.downloaded_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(progress.fragment_index)s %(progress.fragment_count)s',
    '--paths', dir,
    '--output', `${OUTPUT_BASENAME}.%(ext)s`,
  ];

  if (entry.kind === 'image') {
    // No media is fetched at all -- only the poster frame or cover art that came back
    // with the metadata. The conversion is deliberately *not* handed to
    // --convert-thumbnails: its ThumbnailsConvertor fails outright against ffmpeg 8
    // ("Preprocessing: Conversion failed!"), because the image2 muxer now treats a
    // single un-numbered output as an error rather than a warning. convertImage below
    // does the same job with the flag that ffmpeg 8 wants.
    args.push('--skip-download', '--write-thumbnail');
  } else if (entry.kind === 'audio') {
    args.push('--extract-audio', '--audio-format', entry.id);
    // Only meaningful for a lossy encoder; WAV and FLAC ignore it.
    if (entry.lossy) args.push('--audio-quality', '0');
  } else {
    // Prefer streams the container can hold as-is, so the merge is a remux rather than a
    // re-encode; every selector falls back progressively so an odd source still produces
    // something playable.
    const cap = quality === 'best' ? '' : `[height<=${quality}]`;
    args.push(
      '--format', entry.select.split('{cap}').join(cap),
      '--merge-output-format', entry.id,
    );
  }

  args.push('--', url);
  return args;
}

/** Pull the fields the UI actually renders out of yt-dlp's very large JSON blob. */
export function normalizeInfo(raw) {
  const heights = new Set();
  let video = false;
  for (const f of raw?.formats ?? []) {
    if (!f?.vcodec || f.vcodec === 'none') continue;
    video = true;
    if (Number.isFinite(f.height)) heights.add(f.height);
  }

  // A single-format response (a bare audio track, some short-form posts) has no
  // `formats` array at all, so the top-level codec is the only evidence there is.
  if (!video && typeof raw?.vcodec === 'string' && raw.vcodec !== 'none') video = true;

  const offered = ['1080', '720', '480', '360'].filter((q) => [...heights].some((h) => h >= Number(q)));

  return {
    // null, not a placeholder string: the client owns the "untitled" wording.
    title: (typeof raw?.title === 'string' && raw.title.trim()) || null,
    uploader: raw?.uploader || raw?.channel || raw?.uploader_id || null,
    duration: Number.isFinite(raw?.duration) ? Math.round(raw.duration) : null,
    thumbnail: typeof raw?.thumbnail === 'string' && /^https?:\/\//.test(raw.thumbnail) ? raw.thumbnail : null,
    extractor: raw?.extractor_key || raw?.extractor || null,
    isLive: Boolean(raw?.is_live),
    // Lets the UI grey out MP4 for a source that has no picture, instead of letting the
    // download run and hand back an audio file wearing an .mp4 name.
    hasVideo: video,
    qualities: ['best', ...offered],
  };
}

/**
 * Turn yt-dlp's stderr into a stable error code plus the raw line as `detail`.
 *
 * The raw line is kept because there is a long tail of extractor-specific failures no
 * classifier will ever cover, and a developer-readable line beats a shrug. It is shown
 * only under a translated heading, never as the whole message.
 *
 * @returns {{code: string, detail: string|null}}
 */
export function classifyError(stderr) {
  const line = String(stderr || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^ERROR/i.test(s))
    .pop() || String(stderr || '').trim().split(/\r?\n/).pop() || '';

  const msg = line.replace(/^ERROR[:\s]+/i, '').replace(/^\[[^\]]+\]\s*/, '').trim();

  // Order matters: "not available in your country" is geo, not a missing video, so the
  // region test runs before the generic unavailable test.
  if (/geo|country|region|not available in/i.test(msg)) return { code: ERR.GEO_BLOCKED, detail: msg };
  if (/private|login required|sign in|members-only|cookies|age.?restrict/i.test(msg)) {
    return { code: ERR.PRIVATE_CONTENT, detail: msg };
  }
  if (/unavailable|removed|deleted|404|not found|does not exist/i.test(msg)) {
    return { code: ERR.CONTENT_GONE, detail: msg };
  }
  if (/live event|is live|live stream/i.test(msg)) return { code: ERR.IS_LIVE, detail: msg };
  if (/timed out|timeout|network|resolve host|connection|unreachable|temporary failure/i.test(msg)) {
    return { code: ERR.NETWORK, detail: msg };
  }
  return { code: ERR.DOWNLOAD_FAILED, detail: msg || null };
}

/**
 * Metadata only -- no bytes of media are fetched.
 * @returns {Promise<object>} normalized info
 */
function runInfo(bin, url, impersonate, proxy) {
  const args = buildInfoArgs(url, { proxy });
  // Inserted before the `--` guard, never after it, so the URL is still the last word
  // and can never be read as a flag.
  const argv = impersonate ? [...args.slice(0, -2), '--impersonate', IMPERSONATE, ...args.slice(-2)] : args;

  return new Promise((settle) => {
    execFile(
      bin,
      argv,
      { timeout: config.infoTimeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => settle({ err, stdout, stderr }),
    );
  });
}

/**
 * Ask yt-dlp what is at this address.
 *
 * The primary source, and the best one: around 1,750 per-site extractors under a single
 * test suite. It is not the only one, which is the point of the chain below.
 */
async function ytdlpInfo(url, guard) {
  const bin = requireYtdlp();
  const proxy = guard ? await guardProxyUrl() : undefined;

  let { err, stdout, stderr } = await runInfo(bin, url, false, proxy);

  // A refusal of the client is worth one more try wearing a browser's fingerprint.
  // Measured on Rumble: the plain client gets 403, the impersonated one gets the video.
  if (err && !err.killed && looksBlocked(stderr)) {
    ({ err, stdout, stderr } = await runInfo(bin, url, true, proxy));
  }

  if (err) {
    if (err.killed) throw coded(ERR.INFO_TIMEOUT);
    const { code, detail } = classifyError(stderr);
    throw coded(code, { detail });
  }

  try {
    return normalizeInfo(JSON.parse(stdout));
  } catch {
    throw coded(ERR.INFO_UNREADABLE);
  }
}

/**
 * Ask streamlink instead.
 *
 * A wholly separate project with its own extractors, so the sites it knows and the sites
 * it fails on are a different set from yt-dlp's. That independence is the entire reason
 * it is here: a second implementation of the same idea is worth far more than a second
 * copy of the first one.
 *
 * Optional. A machine without it simply skips this link.
 */
function streamlinkInfo(url) {
  const bin = config.streamlink;
  if (!bin) return Promise.resolve(null);

  return new Promise((resolvePromise) => {
    execFile(bin, ['--json', '--', url], {
      timeout: 45_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    }, (err, stdout) => {
      if (!stdout) return resolvePromise(null);
      try {
        const data = JSON.parse(String(stdout));
        const names = Object.keys(data.streams || {});
        if (!names.length) return resolvePromise(null);

        // streamlink names streams by height ("720p", "best"); the numbers are what the
        // picker needs and the words are what it cannot use.
        const heights = names
          .map((n) => Number((n.match(/^(\d{3,4})p/) || [])[1]))
          .filter(Boolean)
          .sort((a, b) => b - a);

        resolvePromise({
          title: data.metadata?.title || null,
          uploader: data.metadata?.author || null,
          duration: null,
          thumbnail: null,
          extractor: 'streamlink',
          isLive: false,
          hasVideo: true,
          qualities: ['best', ...heights.map(String)],
        });
      } catch {
        resolvePromise(null);
      }
    });
  });
}

/**
 * Read the page itself.
 *
 * The last link, and the one that cannot be uninstalled: no binary, no package, nothing
 * to keep up to date. It will never get YouTube, and it will get the long tail that no
 * per-site extractor is ever written for.
 */
async function scrapedInfo(url) {
  const found = await scrapeVideo(url);
  if (!found) return null;

  return {
    title: found.title,
    uploader: null,
    duration: null,
    thumbnail: found.thumbnail,
    extractor: 'page',
    isLive: false,
    hasVideo: true,
    // Nothing on the page states a height, and inventing one would be a lie the picker
    // would then offer as a choice.
    qualities: ['best'],
    // Carried so the download path can fetch these directly rather than looking again.
    directSources: found.direct,
  };
}

/**
 * Try each configured source until one answers.
 *
 * The court's auditor called the single-source dependency a high risk and was right.
 * The chain is the answer to it: three independent implementations, none required, tried
 * in the order set by VIDEO_PROVIDERS. The suggested alternative -- hundreds of per-site
 * packages -- would have replaced one well-tested source with hundreds of unmaintained
 * ones, and put every one of them on a machine whose promise is that nothing untrusted
 * runs there.
 *
 * The first real error is kept: if every source fails, the reader should be told why the
 * best one failed, not that a page scraper found no video tag.
 *
 * @param {string} url
 * @param {{guard?: boolean}} [options] `guard` sends the request through the loopback
 *   proxy, which resolves the name and connects to that address itself.
 */
export async function fetchInfo(url, { guard = false } = {}) {
  const providers = {
    ytdlp: () => ytdlpInfo(url, guard),
    streamlink: () => streamlinkInfo(url),
    scrape: () => scrapedInfo(url),
  };

  let firstError = null;

  for (const name of config.videoProviders) {
    const provider = providers[name];
    if (!provider) continue; // an unknown name in the env var is ignored, not fatal

    try {
      const info = await provider();
      if (info) return info;
    } catch (err) {
      // A missing yt-dlp is a broken install, not an unsupported page: say so at once
      // rather than letting a scraper produce a confusing answer instead.
      if (err.code === ERR.NO_BINARY) throw err;
      firstError ??= err;
    }
  }

  throw firstError ?? coded(ERR.INFO_UNREADABLE);
}

/**
 * Start a download.
 *
 * Returns a handle rather than a bare promise so jobs.js can kill it. The caller owns
 * `dir` and is responsible for purging it -- this function never deletes anything, so
 * there is exactly one place (jobs.js) where cleanup can be reasoned about.
 *
 * `onChild` is called with every process the job owns -- yt-dlp first, and then the
 * ffmpeg that converts an image. The caller keeps only the current one, so a cancel
 * always has something live to kill.
 *
 * @returns {{child: import('node:child_process').ChildProcess, done: Promise<{file: string}>}}
 */
export async function startDownload(options) {
  // Resolved here rather than inside the attempt, so both attempts and the gallery path
  // see the same proxy and the address is settled before anything spawns.
  const proxy = options.guard ? await guardProxyUrl() : undefined;
  return startDownloadWith({ ...options, proxy });
}

function startDownloadWith(options) {
  // A multi-picture format is a different job entirely: no yt-dlp process, an HTTP
  // phase instead of a download phase, and a file assembled here rather than written
  // by the downloader. Dispatching on the format table keeps that knowledge out of
  // jobs.js, which only wants a { child, done } pair either way.
  if (formatInfo(options.format)?.multi) return startGallery(options);
  return startMediaDownload(options);
}

/**
 * One download attempt.
 *
 * Split out of startMediaDownload so the same wiring can be used twice: once plainly,
 * and once wearing a browser's fingerprint if the site refused the first one.
 */
function spawnAttempt({ url, format, quality, dir, onEvent, impersonate, proxy }) {
  const bin = requireYtdlp();
  const base = buildDownloadArgs({ url, format, quality, dir });
  const args = proxy ? [...base.slice(0, -2), '--proxy', proxy, ...base.slice(-2)] : base;
  // Before the `--` guard, never after, so the URL stays the last word and can never be
  // read as a flag.
  const argv = impersonate
    ? [...args.slice(0, -2), '--impersonate', IMPERSONATE, ...args.slice(-2)]
    : args;

  const child = spawn(bin, argv, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX, so killTree can signal yt-dlp *and* the ffmpeg it
    // spawns. Without this, killing yt-dlp leaves ffmpeg holding the temp files open.
    detached: process.platform !== 'win32',
  });

  let stderrTail = '';
  let sawError = null;

  const emit = (event) => { try { onEvent?.(event); } catch { /* listener errors are not ours */ } };

  const splitter = createLineSplitter((line) => {
    const parsed = parseLine(line);
    if (!parsed) return;
    if (parsed.type === 'error') sawError = parsed.message;
    if (parsed.type === 'progress' || parsed.type === 'phase') emit(parsed);
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => splitter.push(chunk));

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
    splitter.push(chunk);
  });

  const done = new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(coded(ERR.DOWNLOAD_TIMEOUT));
    }, config.downloadTimeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(err.code === 'ENOENT' ? new MissingBinaryError('yt-dlp') : err);
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      splitter.flush();

      if (signal) return rejectPromise(coded(ERR.CANCELED));
      if (code !== 0) {
        const raw = sawError || stderrTail;
        const classified = classifyError(raw);
        const failure = coded(classified.code, { detail: classified.detail });
        // Carried so the caller can decide on a retry without re-reading stderr, and
        // never for a cancel -- a killed process must stay killed.
        failure.blocked = looksBlocked(raw);
        return rejectPromise(failure);
      }

      try {
        const file = formatInfo(format)?.kind === 'image'
          ? await finishImage({ dir, format, onChild })
          : await findOutputFile(dir, format);
        resolvePromise({ file });
      } catch (err) {
        rejectPromise(err);
      }
    });
  });

  return { child, done };
}

function startMediaDownload({ url, format, quality, dir, onEvent, onChild, proxy }) {
  const first = spawnAttempt({ url, format, quality, dir, onEvent, impersonate: false, proxy });

  const done = first.done.catch(async (err) => {
    if (!err?.blocked) throw err;

    // The site refused the client rather than the request. Try once more as a browser,
    // the same way fetchInfo does -- measured on Rumble, where the plain client gets a
    // 403 and the impersonated one gets the video.
    const second = spawnAttempt({ url, format, quality, dir, onEvent, impersonate: true, proxy });

    // Hand the new process over immediately: from here it is the one a cancel must kill.
    try { onChild?.(second.child); } catch { /* listener errors are not ours */ }

    return second.done;
  });

  return { child: first.child, done };
}


/**
 * Convert the picture yt-dlp wrote into the format that was asked for.
 *
 * yt-dlp names the thumbnail after the URL's extension, which is often a guess -- Reddit
 * hands back a JPEG at a .png address -- so the decision is made on what was requested,
 * not on what the source claimed. ffmpeg reads the content either way.
 *
 * The child is reported through `onChild` so a cancel arriving during the conversion can
 * still kill it. Skipping that would leave ffmpeg writing into a directory the purge is
 * about to remove, which is the exact leak the cleanup contract exists to prevent.
 *
 * @returns {Promise<string>} the converted file's path
 */
function convertImage({ from, to, onChild }) {
  const bin = config.ffmpeg;
  if (!bin) return Promise.reject(new MissingBinaryError('ffmpeg'));

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', from,
    // A still, not a one-frame video: without -update the image2 muxer wants a numbered
    // sequence, and on ffmpeg 8 that is fatal rather than the warning it used to be.
    '-update', '1', '-frames:v', '1',
  ];
  // JPEG cannot carry an alpha channel; without this a PNG with transparency fails.
  if (to.endsWith('.jpg')) args.push('-pix_fmt', 'yuv420p');
  args.push(to);

  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(bin, args, { timeout: 60_000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) return rejectPromise(coded(ERR.DOWNLOAD_FAILED, { detail: String(stderr || '').trim().split(/\r?\n/).pop() || null }));
      resolvePromise(to);
    });
    onChild?.(child);
  });
}

/**
 * Finish an image job: find whatever picture landed, and convert it if it is not already
 * the requested format.
 */
async function finishImage({ dir, format, onChild }) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((f) => f.isFile()).map((f) => f.name)
    .filter((n) => n.startsWith(`${OUTPUT_BASENAME}.`));

  if (!files.length) throw coded(ERR.NO_IMAGE);

  const target = `${OUTPUT_BASENAME}.${format}`;
  if (files.includes(target)) return join(dir, target);

  return convertImage({ from: join(dir, files[0]), to: join(dir, target), onChild });
}

/**
 * Locate the finished file. yt-dlp writes fragments and intermediate streams next to
 * the result (media.f137.mp4, media.temp.mp4, .part files), so we take the exact
 * `media.<ext>` match first and only then fall back to the largest plausible file.
 */
export async function findOutputFile(dir, format) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const exact = files.find((n) => n === `${OUTPUT_BASENAME}.${format}`);
  if (exact) return join(dir, exact);

  const candidates = files.filter(
    (n) => n.startsWith(`${OUTPUT_BASENAME}.`)
      && !n.endsWith('.part')
      && !n.endsWith('.ytdl')
      && !/\.f\d+\./.test(n)
      && !n.includes('.temp.'),
  );
  if (candidates.length === 1) return join(dir, candidates[0]);
  if (candidates.length > 1) {
    // Deterministic: shortest name wins, i.e. media.mp4 over media.something.mp4.
    candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return join(dir, candidates[0]);
  }

  throw coded(ERR.NO_OUTPUT_FILE);
}

/**
 * Kill a download and everything it spawned, then wait for the OS to actually reap it.
 *
 * This exists because of a bug found in testing: cancelling a job removed the temp
 * folder while yt-dlp (and the ffmpeg it had started) were still writing, so the
 * directory reappeared moments later and leaked. Killing the tree is only half the
 * fix -- the caller must also wait for the exit before deleting anything, which is why
 * this returns a promise.
 *
 * @returns {Promise<void>} resolves once the process is gone, or after a short cap.
 */
/* ========================================================== a post's pictures */

/**
 * Ask gallery-dl for the picture URLs in a post.
 *
 * `-g` prints one URL per line and downloads nothing, which is exactly the division of
 * labour we want: gallery-dl knows how to read a hundred sites' post formats, and this
 * project already has code that fetches a URL safely. Letting it write the files itself
 * would put a second downloader, with its own naming and its own rules, inside the job
 * directory.
 *
 * Returns an empty array rather than throwing when gallery-dl is missing or fails, so
 * the chain can simply move on to the next provider.
 */
function galleryDlUrls(url) {
  const bin = config.gallerydl;
  if (!bin) return Promise.resolve([]);

  return new Promise((resolvePromise) => {
    execFile(bin, ['-g', '--', url], {
      timeout: 90_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    }, (err, stdout) => {
      if (err && !stdout) return resolvePromise([]);
      const urls = String(stdout).split(/\r?\n/)
        .map((line) => line.trim())
        // gallery-dl marks some lines with a leading character; take only plain URLs.
        .filter((line) => /^https?:\/\//i.test(line));
      resolvePromise(urls);
    });
  });
}

/** The poster frame or cover art yt-dlp knows about: one picture, never a carousel. */
function ytdlpThumbnail(url) {
  return fetchInfo(url)
    .then((info) => (info?.thumbnail ? [info.thumbnail] : []))
    .catch(() => []);
}

/**
 * Try each configured provider until one returns pictures.
 *
 * The order comes from config.imageProviders and is a preference rather than a ranking:
 * someone who mostly saves social carousels wants gallery-dl first, someone who mostly
 * saves forum threads wants the scraper first. None of the three is required, and a
 * provider that is not installed contributes nothing rather than failing the job.
 *
 * @returns {Promise<string[]>}
 */
async function collectImageUrls(url, emit) {
  const providers = {
    gallerydl: () => galleryDlUrls(url),
    scrape: () => scrapeImages(url, { limit: config.maxImagesPerJob }),
    ytdlp: () => ytdlpThumbnail(url),
  };

  for (const name of config.imageProviders) {
    const provider = providers[name];
    if (!provider) continue; // an unknown name in the env var is ignored, not fatal

    emit({ type: 'phase', phase: 'extracting' });
    const found = await provider();
    if (found.length) return found.slice(0, config.maxImagesPerJob);
  }
  return [];
}

/**
 * Run one ffmpeg conversion and resolve with the output path.
 *
 * Separate from convertImage() above because the argument list comes from gallery.js,
 * which is where the knowledge about picture quality lives; this only runs it.
 */
function runConvert(args, out, onChild) {
  const bin = config.ffmpeg;
  if (!bin) return Promise.reject(new MissingBinaryError('ffmpeg'));

  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(bin, args, { timeout: 120_000, windowsHide: true }, (err, _o, stderr) => {
      if (err) {
        return rejectPromise(coded(ERR.DOWNLOAD_FAILED, {
          detail: String(stderr || '').trim().split(/\r?\n/).pop() || null,
        }));
      }
      resolvePromise(out);
    });
    onChild?.(child);
  });
}

/**
 * A job that gathers every picture in a post and binds them into one PDF.
 *
 * Deliberately the same shape as a download job -- `{ child, done }` -- so jobs.js does
 * not need to know which kind it started. `child` is null to begin with because the
 * first phase is HTTP rather than a process; every process this job does start is
 * reported through onChild, so a cancel always has something live to kill.
 */
function startGallery({ url, format, quality, dir, onEvent, onChild }) {
  const emit = (event) => { try { onEvent?.(event); } catch { /* listener errors are not ours */ } };
  const picture = pictureQuality(quality) ?? pictureQuality('original');

  const done = (async () => {
    const urls = await collectImageUrls(url, emit);
    if (!urls.length) throw coded(ERR.NO_IMAGE);

    emit({ type: 'phase', phase: 'downloading' });
    const files = await downloadImages(urls, {
      dir,
      onProgress: ({ done: n, total }) => emit({
        type: 'progress',
        percent: total ? Math.round((n / total) * 100) : null,
        downloaded: n, total, speed: null, eta: null,
      }),
    });

    emit({ type: 'phase', phase: 'processing' });

    const pages = [];
    for (const [index, file] of files.entries()) {
      const bytes = await readFile(file);

      // `original` only re-encodes what a PDF cannot carry. A picture that arrived as a
      // JPEG goes in untouched, which is the entire point of that setting.
      if (picture.reencode === false && isJpeg(bytes)) {
        pages.push(bytes);
        continue;
      }

      const out = join(dir, `page-${String(index).padStart(3, '0')}.jpg`);
      await runConvert(convertArgs({ from: file, to: out, quality: picture }), out, onChild);
      pages.push(await readFile(out));
    }

    const pdf = imagesToPdf(pages);
    const target = join(dir, `${OUTPUT_BASENAME}.${format}`);
    await writeFile(target, pdf);
    return { file: target };
  })();

  return { child: null, done };
}

export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      resolvePromise();
    };

    child.once('exit', finish);
    child.once('close', finish);

    // Never let cleanup hang on a wedged process; the purge retries cover the rest.
    const cap = setTimeout(finish, 4000);
    cap.unref?.();

    try {
      if (process.platform === 'win32') {
        // Windows has no process groups we can signal; taskkill /T walks the tree.
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        // Negative pid = the whole process group created by detached: true.
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  });
}

/**
 * Synchronous tree kill, for exit handlers only -- once the event loop is winding down
 * there is no chance for the async version to finish.
 */
export function killTreeSync(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch {
    /* exiting anyway */
  }
}

/**
 * Used by check-deps.js and /api/health.
 * ffmpeg wants a single-dash `-version` and prints its banner to stderr, so the flag is
 * a parameter and both streams are considered.
 *
 * Asking yt-dlp its version is not cheap -- it loads its whole extractor tree first,
 * which measured 17 to 60 seconds on a low-powered laptop. The old ten second window
 * expired long before that, the answer came back null, and the status line reported
 * "yt-dlp is not installed" at someone who had it installed all along. So the window is
 * generous now, and an answer that does arrive is kept: a binary cannot change version
 * while the process that asked is still running.
 *
 * Only successes are cached. A timeout leaves the slot empty so a later call can try
 * again, rather than making one slow moment permanent.
 */
const versionCache = new Map();

export function probeVersion(bin, flag = '--version') {
  return new Promise((resolvePromise) => {
    if (!bin) return resolvePromise(null);
    if (versionCache.has(bin)) return resolvePromise(versionCache.get(bin));

    // execFile can throw before it ever runs -- an unspawnable path, or a .cmd/.bat,
    // which Node refuses without a shell. Left uncaught that rejects this promise and
    // takes down `npm run check` with a stack trace, in front of the one person who
    // most needs a plain sentence about what is missing. Unspawnable is just absent.
    try {
      execFile(bin, [flag], { timeout: 90_000, windowsHide: true }, (err, stdout, stderr) => {
        const first = String(stdout || stderr || '').trim().split(/\r?\n/)[0]?.trim();
        // ffmpeg exits non-zero on some builds while still printing a valid banner.
        const version = first && /\d/.test(first) ? first : (err ? null : first || null);
        if (version) versionCache.set(bin, version);
        resolvePromise(version);
      });
    } catch {
      resolvePromise(null);
    }
  });
}

/**
 * How many sites this yt-dlp can reach.
 *
 * Asked of the binary rather than written down, because the honest number is whatever
 * the installed copy actually ships -- it moves with every yt-dlp release, and a figure
 * hardcoded here would be a claim rather than a fact the moment someone updates.
 *
 * Only meaningful in universal mode: the allowlist is 22 of these by design. It is
 * reported either way so the difference between the two modes is a number the user can
 * see rather than a paragraph they have to trust.
 *
 * Listing the extractor tree is the slowest thing yt-dlp does -- it loads all of them --
 * so this is cached forever on success and warmed at startup, exactly like the versions.
 */
let extractorCount = null;

export function probeExtractorCount() {
  return new Promise((resolvePromise) => {
    if (extractorCount !== null) return resolvePromise(extractorCount);
    const bin = config.ytdlp;
    if (!bin) return resolvePromise(null);

    try {
      execFile(bin, ['--list-extractors'], {
        timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      }, (err, stdout) => {
        if (err) return resolvePromise(null);
        const count = String(stdout).split(/\r?\n/).filter((l) => l.trim()).length;
        if (count > 0) extractorCount = count;
        resolvePromise(extractorCount);
      });
    } catch {
      resolvePromise(null);
    }
  });
}

/**
 * Start the slow probes without waiting for them, so the first page load reads a cached
 * answer instead of paying the wait itself.
 */
export function warmVersions() {
  probeVersion(config.ytdlp).catch(() => {});
  probeVersion(config.ffmpeg, '-version').catch(() => {});
  probeExtractorCount().catch(() => {});
}

export { MissingBinaryError, OUTPUT_BASENAME };
