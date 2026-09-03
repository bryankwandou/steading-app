/**
 * URL and parameter validation.
 *
 * The allowlist is the security boundary: yt-dlp is a very capable tool and we only
 * ever hand it hosts we intend to support. Anything else is rejected before a process
 * is spawned.
 *
 * Failures return an error *code*, never prose -- see lib/errors.js.
 */

import { ERR } from './errors.js';

/**
 * The supported sites.
 *
 * Every entry corresponds to an extractor that ships with yt-dlp and works on public
 * content without an account. Adding a row here is the whole job of adding a platform:
 * the error wording, the "works with" line in the UI and /api/health all read this
 * table, so nothing else has to be edited and nothing can promise a site the validator
 * would reject.
 *
 * `audio: true` marks a site that only ever hosts audio. Those sites have no video
 * stream to select, so an MP4 request against one is refused up front rather than
 * producing a file with a .mp4 name and no picture in it.
 *
 * A host matches on equality or as a subdomain, so `redd.it` also covers `v.redd.it`
 * and `youtube.com` also covers `m.youtube.com`. Short-link domains are listed
 * separately because they are different registrable names, not subdomains.
 */
const PLATFORMS = [
  { id: 'youtube',      label: 'YouTube',      hosts: ['youtube.com', 'youtu.be'] },
  { id: 'tiktok',       label: 'TikTok',       hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'] },
  { id: 'instagram',    label: 'Instagram',    hosts: ['instagram.com', 'instagr.am', 'ddinstagram.com'] },
  { id: 'facebook',     label: 'Facebook',     hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  { id: 'twitch',       label: 'Twitch',       hosts: ['twitch.tv'] },
  { id: 'vimeo',        label: 'Vimeo',        hosts: ['vimeo.com'] },
  { id: 'dailymotion',  label: 'Dailymotion',  hosts: ['dailymotion.com', 'dai.ly'] },
  { id: 'reddit',       label: 'Reddit',       hosts: ['reddit.com', 'redd.it'] },
  { id: 'pinterest',    label: 'Pinterest',    hosts: ['pinterest.com', 'pin.it'] },
  { id: 'snapchat',     label: 'Snapchat',     hosts: ['snapchat.com'] },
  { id: 'bluesky',      label: 'Bluesky',      hosts: ['bsky.app'] },
  { id: 'tumblr',       label: 'Tumblr',       hosts: ['tumblr.com'] },
  { id: 'telegram',     label: 'Telegram',     hosts: ['t.me', 'telegram.me'] },
  { id: 'vk',           label: 'VK',           hosts: ['vk.com', 'vkvideo.ru'] },
  { id: 'weibo',        label: 'Weibo',        hosts: ['weibo.com', 'weibo.cn'] },
  { id: 'xiaohongshu',  label: 'Xiaohongshu',  hosts: ['xiaohongshu.com', 'xhslink.com'] },
  { id: 'bilibili',     label: 'Bilibili',     hosts: ['bilibili.com', 'b23.tv'] },
  { id: 'kick',         label: 'Kick',         hosts: ['kick.com'] },
  { id: 'odysee',       label: 'Odysee',       hosts: ['odysee.com', 'lbry.tv'] },
  { id: 'rumble',       label: 'Rumble',       hosts: ['rumble.com'] },
  { id: 'soundcloud',   label: 'SoundCloud',   hosts: ['soundcloud.com', 'snd.sc'], audio: true },
  { id: 'bandcamp',     label: 'Bandcamp',     hosts: ['bandcamp.com'], audio: true },
  { id: 'mixcloud',     label: 'Mixcloud',     hosts: ['mixcloud.com'], audio: true },
];

export const SUPPORTED_PLATFORMS = PLATFORMS.map(({ id, label, audio }) => (
  audio ? { id, label, audio: true } : { id, label }
));

/**
 * Sites people reasonably expect to work, which cannot.
 *
 * These render their posts entirely in the browser and hand a plain HTTP client nothing
 * at all -- no og: tags, no media URLs -- and they gate most posts behind a login. A
 * downloader would need a headless browser driving a signed-in session, which is a
 * different program from this one, and would mean holding someone's account credentials.
 *
 * They are listed so the rejection can name the site and say why, and point at the
 * platforms that do work. Recognising a site is not the same as supporting it: nothing
 * here ever reaches yt-dlp, so the allowlist is still the only way through.
 */
const LOCKED = [
  { label: 'Threads', hosts: ['threads.net', 'threads.com'] },
  // yt-dlp does carry a Twitter extractor, but it has needed a signed-in cookie jar for
  // most video posts since the guest API was closed, so it belongs here rather than in
  // PLATFORMS: a row that fails on the majority of links is worse than an honest no.
  { label: 'X',       hosts: ['x.com', 'twitter.com'] },
];

function matchLocked(hostname) {
  const host = hostname.toLowerCase().replace(/^www./, '');
  for (const site of LOCKED) {
    for (const h of site.hosts) {
      if (host === h || host.endsWith(`.${h}`)) return site;
    }
  }
  return null;
}

/**
 * The output formats.
 *
 * `id` doubles as the file extension -- `safeFilename(title, format)` relies on that,
 * and so does `findOutputFile`, which looks for `media.<id>`. Keep them equal.
 *
 * `kind` decides how the download is built and what the UI offers alongside it:
 *
 * - `video` merges a video and an audio stream, and is the only kind a quality applies
 *   to. The container decides which streams are worth preferring, which is why the
 *   format selector is per-entry rather than one string with the extension swapped in.
 * - `audio` re-encodes to a single track. `lossy` marks the ones where yt-dlp's
 *   `--audio-quality` means something; passing it to WAV or FLAC is merely ignored, but
 *   sending a flag that cannot apply invites the reader to believe it does.
 * - `image` downloads no media at all. It takes the poster frame or cover art that came
 *   back with the metadata and converts it, which is why it works on a site that hosts
 *   only audio -- cover art is a picture -- and why it needs no second binary.
 */
const FORMAT_TABLE = [
  { id: 'mp4',  kind: 'video', mime: 'video/mp4',        select: 'bv*{cap}[ext=mp4]+ba[ext=m4a]/bv*{cap}+ba/b{cap}/bv*+ba/b' },
  { id: 'mkv',  kind: 'video', mime: 'video/x-matroska', select: 'bv*{cap}+ba/b{cap}/bv*+ba/b' },
  { id: 'webm', kind: 'video', mime: 'video/webm',       select: 'bv*{cap}[ext=webm]+ba[ext=webm]/bv*{cap}+ba/b{cap}/bv*+ba/b' },

  { id: 'mp3',  kind: 'audio', mime: 'audio/mpeg', lossy: true },
  { id: 'm4a',  kind: 'audio', mime: 'audio/mp4',  lossy: true },
  { id: 'opus', kind: 'audio', mime: 'audio/opus', lossy: true },
  { id: 'wav',  kind: 'audio', mime: 'audio/wav' },
  { id: 'flac', kind: 'audio', mime: 'audio/flac' },

  { id: 'jpg',  kind: 'image', mime: 'image/jpeg' },
  { id: 'png',  kind: 'image', mime: 'image/png' },
  { id: 'webp', kind: 'image', mime: 'image/webp' },
  // `multi` is the whole difference between a picture and a post’s pictures. A single
  // image format saves one picture -- the cover, the poster frame, the first photo.
  // PDF gathers every picture in the post and binds them into one file, which is the
  // only honest answer to "a carousel of fourteen photos" when a job hands back one.
  { id: 'pdf',  kind: 'image', mime: 'application/pdf', multi: true },
];

export const FORMATS = FORMAT_TABLE.map((f) => f.id);

/** What the UI builds its controls from: the ids grouped by kind, in table order. */
export const FORMAT_KINDS = ['video', 'audio', 'image'].map((kind) => ({
  kind,
  formats: FORMAT_TABLE.filter((f) => f.kind === kind).map((f) => f.id),
}));

/** @returns {{id: string, kind: string, mime: string, lossy?: boolean, select?: string}|null} */
export function formatInfo(id) {
  return FORMAT_TABLE.find((f) => f.id === id) ?? null;
}

export const QUALITIES = ['best', '1080', '720', '480', '360'];

/**
 * How hard to squeeze a picture.
 *
 * A separate scale from video quality because it means something different: video
 * quality picks an existing stream, this one decides whether to re-encode at all.
 *
 * **Ordered lightest to best, and the order is load-bearing** -- the UI renders this as
 * a slider with "smaller file" at one end and "original" at the other, so an index into
 * this array is the slider's position. Inserting a step in the middle is fine; shuffling
 * them is not.
 *
 * `original` is not a setting so much as the absence of one: the JPEG that came off the
 * website is embedded byte for byte, so nothing is decoded, nothing is resampled, and
 * the result cannot be worse than the source. It is also the default, because quietly
 * degrading a picture nobody asked to degrade is the wrong way round -- the slider makes
 * going lighter one gesture, and fourteen photos in a PDF is exactly when someone
 * reaches for it.
 *
 * `q` is ffmpeg's mjpeg scale, where 2 is near-lossless and 31 is unpleasant; `max` caps
 * the longest edge in pixels and is skipped when the picture is already smaller.
 */
const PICTURE_QUALITY_TABLE = [
  { id: 'tiny',     q: 14, max: 1080 },
  { id: 'small',    q: 8,  max: 1440 },
  { id: 'balanced', q: 5,  max: 2048 },
  { id: 'high',     q: 2,  max: null },
  { id: 'original', reencode: false },
];

export const PICTURE_QUALITIES = PICTURE_QUALITY_TABLE.map((p) => p.id);

/** @returns {{id: string, reencode?: boolean, q?: number, max?: number|null}|null} */
export function pictureQuality(id) {
  return PICTURE_QUALITY_TABLE.find((p) => p.id === id) ?? null;
}

/** A host matches if it equals the entry or is a subdomain of it. */
function matchPlatform(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const p of PLATFORMS) {
    for (const h of p.hosts) {
      if (host === h || host.endsWith(`.${h}`)) return p;
    }
  }
  return null;
}

/**
 * @returns {{ok: true, url: string, platform: string, platformLabel: string,
 *            audioOnly: boolean}
 *          | {ok: false, code: string}}
 */
/**
 * @param {string} input
 * @param {{universal?: boolean}} [options] `universal` lets an unlisted host through --
 *   see config.universal for what that trades away, and what it does not.
 */
/**
 * Is this hostname somewhere on the machine's own network rather than out on the web?
 *
 * Only consulted for hosts that are not on the allowlist, so the listed sites are
 * unaffected -- this exists solely to keep universal mode pointed outward.
 *
 * Deliberately refuses names it cannot classify: a bare label with no dot is an intranet
 * name far more often than a site, and being wrong in that direction costs a rejected
 * paste rather than an internal service fetched by a stranger.
 *
 * This is not a complete defence and should not be described as one. A public hostname
 * whose DNS answers with 10.x still resolves after this check passes; catching that
 * needs resolution before the fetch, which is a different piece of work. What it does
 * close is the direct case, which is the one somebody types.
 */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  // Bracketed IPv6 arrives from new URL() without brackets, but be defensive.
  const bare = host.replace(/^\[|\]$/g, '');

  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;

  // Names that are internal by convention or by RFC.
  if (/\.(local|internal|intranet|localdomain|home|lan|corp|private)$/.test(bare)) return true;

  // A single label with no dot: intranet host, not a site.
  if (!bare.includes('.') && !bare.includes(':')) return true;

  // IPv6 loopback, link-local (fe80::/10) and unique local (fc00::/7).
  if (bare === '::1' || bare === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true;
  // An IPv4 address mapped into IPv6 still points where the IPv4 does.
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateHost(mapped[1]);

  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;

  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (v4.slice(1).some((n) => Number(n) > 255)) return true;   // not an address at all

  if (a === 0 || a === 127) return true;                        // this host
  if (a === 10) return true;                                    // private
  if (a === 172 && b >= 16 && b <= 31) return true;             // private
  if (a === 192 && b === 168) return true;                      // private
  if (a === 169 && b === 254) return true;                      // link-local, incl. metadata
  if (a === 100 && b >= 64 && b <= 127) return true;            // carrier-grade NAT
  if (a >= 224) return true;                                    // multicast and reserved

  return false;
}

export function validateUrl(input, { universal = false } = {}) {
  if (typeof input !== 'string') return { ok: false, code: ERR.URL_NOT_TEXT };

  const raw = input.trim();
  if (!raw) return { ok: false, code: ERR.URL_EMPTY };
  if (raw.length > 2048) return { ok: false, code: ERR.URL_TOO_LONG };

  // Control characters would be meaningless in a URL and are a classic injection probe.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, code: ERR.URL_BAD_CHARS };

  // Accept a bare "youtube.com/watch?v=..." paste by assuming https.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: ERR.URL_MALFORMED };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: ERR.URL_BAD_SCHEME };
  }

  const platform = matchPlatform(url.hostname);
  if (!platform) {
    const locked = matchLocked(url.hostname);
    // detail carries the site name so the message can name it; it is drawn from the
    // table above, never from the input, so nothing user-supplied reaches the UI.
    // A locked site stays locked in universal mode too: those two are not "unlisted",
    // they are known not to work, and letting them through would only spend a minute
    // to reach the same answer.
    if (locked) return { ok: false, code: ERR.URL_SITE_LOCKED, detail: locked.label };
    if (!universal) return { ok: false, code: ERR.URL_UNSUPPORTED_SITE };

    // Universal mode means an unlisted host reaches yt-dlp. It must still be a host out
    // on the web: without this, the app is a way to fetch whatever is listening inside
    // the network it runs in, which over the /live tunnel means anyone with the link.
    if (isPrivateHost(url.hostname)) return { ok: false, code: ERR.URL_UNSUPPORTED_SITE };
  }

  // Strip credentials and the fragment; neither is useful downstream.
  url.username = '';
  url.password = '';
  url.hash = '';

  return {
    ok: true,
    url: url.toString(),
    platform: platform?.id ?? 'other',
    // For an unlisted host the label is the hostname `new URL` parsed out -- not the
    // raw input, and never anything with a path or a query in it. It reaches the page
    // through textContent like every other string, so it cannot become markup.
    platformLabel: platform?.label ?? url.hostname.replace(/^www\./, ''),
    // Carried through so the job route can refuse video on an audio-only site without
    // paying for a second metadata probe. An unlisted host makes no such claim.
    audioOnly: Boolean(platform?.audio),
  };
}

/**
 * @returns {{ok: true, format: string, kind: string, mime: string}
 *          | {ok: false, code: string}}
 */
export function validateFormat(value) {
  const entry = formatInfo(typeof value === 'string' ? value.toLowerCase().trim() : '');
  return entry
    ? { ok: true, format: entry.id, kind: entry.kind, mime: entry.mime }
    : { ok: false, code: ERR.BAD_FORMAT };
}

/**
 * Validate a quality against the scale its kind actually uses.
 *
 * Video and pictures share one request field but not one vocabulary, so the kind has to
 * come in with the value -- otherwise "720" would be accepted for a JPEG and "balanced"
 * for an MP4, and both would be quietly ignored later.
 *
 * @param {unknown} value
 * @param {string} [kind] 'video' | 'audio' | 'image'
 */
export function validateQuality(value, kind = 'video') {
  const picture = kind === 'image';
  const fallback = picture ? 'original' : 'best';
  const allowed = picture ? PICTURE_QUALITIES : QUALITIES;

  if (value === undefined || value === null || value === '') return { ok: true, quality: fallback };
  const quality = String(value).toLowerCase().trim();
  return allowed.includes(quality)
    ? { ok: true, quality }
    : { ok: false, code: ERR.BAD_QUALITY };
}

/** Job ids come back from the client, so they get the same treatment as any input. */
export function validateJobId(value) {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value)
    ? { ok: true, id: value }
    : { ok: false, code: ERR.BAD_JOB_ID };
}

/**
 * Make a title safe as a filename on Windows, Android and Linux alike.
 *
 * Titles arrive from a remote site's metadata, so this is a trust boundary: the result
 * lands in a Content-Disposition header and in the user's Downloads folder. Path
 * separators, Windows-reserved characters and control characters all go.
 */
export function safeFilename(title, ext) {
  const base = String(title || 'steading')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')  // reserved on Windows
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '') // no leading/trailing dots or spaces
    .slice(0, 120)
    .trim();

  // CON, PRN, AUX, NUL, COM1-9, LPT1-9 are device names on Windows even with a suffix.
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? `${base}_` : base;

  return `${safe || 'steading'}.${ext}`;
}
