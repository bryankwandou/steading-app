/**
 * Fetching a post's pictures, and turning them into one file.
 *
 * This module does the parts that are not process work: pulling image bytes down over
 * HTTP and deciding what is worth keeping. The spawning -- gallery-dl to find the
 * pictures, ffmpeg to normalise them -- stays in ytdlp.js, which is the one module
 * allowed to start a process. That split is why this file takes its converter as a
 * callback rather than reaching for child_process itself.
 *
 * Every URL that arrives here was written by whoever controls the page it came from, so
 * each one goes through `isFetchable` before a request is made. That check resolves DNS
 * and refuses private addresses, which is what stops a hostile post naming
 * `http://127.0.0.1:8080/admin` and having the server fetch it back as a "photo".
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isFetchable, UA } from './scrape.js';
import { ERR, coded } from './errors.js';

/** Nothing a post legitimately contains is bigger than this, and a hostile one might be. */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Below this an "image" is a tracking pixel or a spacer, whatever its filename said. */
const MIN_IMAGE_BYTES = 3 * 1024;

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif|bmp|tiff)$/i;

/**
 * Download one picture, or return null and let the caller carry on.
 *
 * A single dead URL in a list of twenty is normal -- a CDN expires, a signature fails --
 * and it is not a reason to fail the whole job. Failures are counted rather than thrown,
 * and only an empty result at the end is an error.
 */
async function fetchImage(url, timeoutMs) {
  if (!(await isFetchable(url))) return null;

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    // Trust the served type over the file extension: a URL ending .jpg that answers
    // with text/html is an error page, and ffmpeg would reject it later anyway.
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!IMAGE_TYPES.test(type)) return null;

    // Refuse an oversized body before reading it, when the server admits the length.
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_IMAGE_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_IMAGE_BYTES || buf.length > MAX_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download every picture in the list, in order, reporting progress as it goes.
 *
 * Sequential on purpose. Twenty parallel requests to one host is what a rate limiter is
 * built to notice, and the whole job is bounded by the slowest picture either way. It
 * also means the progress figures move steadily rather than in one jump at the end.
 *
 * @returns {Promise<string[]>} paths of the files written, in order
 */
export async function downloadImages(urls, { dir, onProgress, timeoutMs = 30_000 }) {
  const written = [];

  for (const [index, url] of urls.entries()) {
    onProgress?.({ done: index, total: urls.length });

    const buf = await fetchImage(url, timeoutMs);
    if (!buf) continue;

    // Numbered so the order the post used survives into the PDF. Padded so a
    // directory listing sorts the same way a human would read it.
    const name = `img-${String(written.length).padStart(3, '0')}.bin`;
    const path = join(dir, name);
    await writeFile(path, buf);
    written.push(path);
  }

  onProgress?.({ done: urls.length, total: urls.length });

  if (!written.length) throw coded(ERR.NO_IMAGE);
  return written;
}

/**
 * Work out the ffmpeg arguments that turn one downloaded picture into the JPEG the PDF
 * will embed.
 *
 * Kept here, next to the code that knows what the pictures are, rather than in the
 * process module -- ytdlp.js only has to run what this returns.
 *
 * `original` still converts anything that is not already a JPEG, because the PDF embeds
 * JPEG data directly and cannot carry a PNG. It converts at near-lossless quality, so
 * "original" stays an honest label: the only thing that changes is the container.
 *
 * @param {{from: string, to: string, quality: {reencode?: boolean, q?: number, max?: number|null}}} spec
 */
export function convertArgs({ from, to, quality }) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', from,
    // A still image, not a one-frame video. Without -update the image2 muxer wants a
    // numbered sequence, and on ffmpeg 8 that is an error rather than a warning.
    '-update', '1', '-frames:v', '1',
    // JPEG cannot carry an alpha channel, and a PNG with transparency fails without it.
    '-pix_fmt', 'yuv420p',
  ];

  // 2 is near-lossless on ffmpeg's mjpeg scale. Used for `original` as well, since
  // something has to be chosen and the point of that setting is to lose nothing visible.
  args.push('-q:v', String(quality.q ?? 2));

  if (quality.max) {
    // Fit inside a square of `max` on the longest edge, and never enlarge: the two
    // min() calls are what stop a small picture being upscaled into a bigger file for
    // no gain. -2 keeps the other edge proportional and even, which mjpeg requires.
    const m = quality.max;
    args.push('-vf', `scale='if(gt(iw,ih),min(iw,${m}),-2)':'if(gt(iw,ih),-2,min(ih,${m}))'`);
  }

  args.push(to);
  return args;
}

/** Whether the bytes are already a JPEG, in which case `original` can skip ffmpeg. */
export function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
