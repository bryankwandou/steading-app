/**
 * Steading -- HTTP entry point.
 *
 * Routes only: parse, validate, delegate, respond. No child_process here (that lives in
 * ytdlp.js) and no fs.rm here (that lives in cleanup.js, called through jobs.js).
 */

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { config } from './config.js';
import { serveStatic } from './static.js';
import { fetchInfo, probeVersion, probeExtractorCount, warmVersions } from './ytdlp.js';
import {
  validateUrl, validateFormat, validateQuality, validateJobId, safeFilename, SUPPORTED_PLATFORMS,
  FORMAT_KINDS, formatInfo,
} from './lib/validate.js';
import {
  createJob, getJob, subscribe, cancelJob, completeAndPurge, publicView, initJobSystem, countActive,
  touchJob,
} from './lib/jobs.js';
import { ERR, FALLBACK } from './lib/errors.js';

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

/**
 * Every API failure has the same shape: a stable code the client translates, an English
 * fallback for anything that is not a Steading client, and optional raw detail.
 */
const fail = (res, status, code, detail = null) =>
  json(res, status, { code, error: FALLBACK[code] || code, detail });

/** Read a small JSON body. Anything oversized is refused before it is buffered. */
function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > config.maxRequestBodyBytes) {
      return rejectPromise(Object.assign(new Error(FALLBACK.body_too_large), { status: 413, code: ERR.BODY_TOO_LARGE }));
    }

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxRequestBodyBytes) {
        rejectPromise(Object.assign(new Error(FALLBACK.body_too_large), { status: 413, code: ERR.BODY_TOO_LARGE }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectPromise(Object.assign(new Error(FALLBACK.bad_json), { status: 400, code: ERR.BAD_JSON }));
      }
    });
    req.on('error', rejectPromise);
  });
}

/**
 * The server binds to loopback, but a phone on a shared network can still have other
 * apps on it. A same-origin check on state-changing requests keeps a random page in
 * another tab from driving this API.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isLocalHostname(hostname) {
  return LOOPBACK.has(hostname)
    || hostname === config.host
    // Explicitly opted in via PUBLIC_HOST, for tunnelled demos. Off unless set.
    || config.publicHosts.includes(hostname);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetch from our own page sends no Origin
  try {
    return isLocalHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * DNS rebinding defence.
 *
 * A hostile page can point its own domain at 127.0.0.1 and then talk to this server as
 * same-origin -- the Origin check above would pass, because the origin *is* its own.
 * What it cannot do is forge the Host header, so anything that did not arrive addressed
 * to a loopback name is refused outright.
 */
function hostAllowed(req) {
  const host = req.headers.host;
  if (!host) return false;
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  return isLocalHostname(hostname.toLowerCase());
}

/* ------------------------------------------------------------------ routes */

async function handleInfo(req, res) {
  const body = await readJsonBody(req);

  const url = validateUrl(body.url, { universal: config.universal });
  if (!url.ok) return fail(res, 400, url.code, url.detail ?? null);

  try {
    const info = await fetchInfo(url.url);
    if (info.isLive) return fail(res, 400, ERR.IS_LIVE);
    return json(res, 200, {
      ...info,
      url: url.url,
      platform: url.platform,
      platformLabel: url.platformLabel,
      // Either the whole site is audio-only, or this particular item turned out to have
      // no video stream. The UI treats both the same way.
      audioOnly: url.audioOnly || !info.hasVideo,
    });
  } catch (err) {
    return fail(res, err.code === ERR.NO_BINARY ? 503 : 422, err.code || ERR.SERVER_ERROR, err.detail ?? null);
  }
}

async function handleCreateJob(req, res) {
  const body = await readJsonBody(req);

  const url = validateUrl(body.url, { universal: config.universal });
  if (!url.ok) return fail(res, 400, url.code, url.detail ?? null);
  const format = validateFormat(body.format);
  if (!format.ok) return fail(res, 400, format.code);
  // The kind decides which vocabulary applies: 720 means something for a video and
  // nothing for a photo, and vice versa for "balanced".
  const quality = validateQuality(body.quality, format.kind);
  if (!quality.ok) return fail(res, 400, quality.code);

  // Refused here rather than left to yt-dlp: on an audio-only site the video selector
  // falls through to the best audio track and the job would 'succeed', handing back an
  // audio file named .mp4. Cheap to check, because the platform table already knows.
  // Only video is refused -- an audio-only site still has cover art to save as an image.
  if (format.kind === 'video' && url.audioOnly) return fail(res, 400, ERR.VIDEO_NOT_AVAILABLE);

  try {
    const job = await createJob({
      url: url.url,
      format: format.format,
      quality: quality.quality,
      title: body.title,
    });
    return json(res, 201, publicView(job));
  } catch (err) {
    return fail(res, err.status || (err.code === ERR.NO_BINARY ? 503 : 500), err.code || ERR.SERVER_ERROR, err.detail ?? null);
  }
}

function handleEvents(req, res, id) {
  const job = getJob(id);
  if (!job) return fail(res, 404, ERR.JOB_NOT_FOUND);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Current state first, so a reconnecting client is never out of date.
  res.write(`event: update\ndata: ${JSON.stringify(publicView(job))}\n\n`);

  const detach = subscribe(job, res);

  // Comment frames keep intermediaries and mobile radios from dropping an idle stream.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closing */ }
  }, 15_000);
  ping.unref?.();

  const close = () => {
    clearInterval(ping);
    detach();
  };
  req.on('close', close);
  res.on('close', close);
}

async function handleFile(req, res, id) {
  const job = getJob(id);
  if (!job) return fail(res, 404, ERR.JOB_NOT_FOUND);
  if (job.state === 'error' || job.state === 'canceled') return fail(res, 409, job.code || ERR.SERVER_ERROR, job.detail ?? null);
  if (job.state !== 'ready' || !job.file) return fail(res, 409, ERR.FILE_NOT_READY);

  const filename = job.filename || safeFilename(basename(job.file), job.format);
  const headers = {
    'Content-Type': formatInfo(job.format)?.mime ?? 'application/octet-stream',
    // Both forms: the plain one for old parsers, the UTF-8 one for real titles.
    'Content-Disposition':
      `attachment; filename="${filename.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (job.size) headers['Content-Length'] = job.size;

  res.writeHead(200, headers);

  const stream = createReadStream(job.file);
  let finished = false;

  const settle = (ok) => {
    if (finished) return;
    finished = true;
    // Purge on both paths. A half-sent file is worth less than the storage it occupies,
    // and the user can simply retry.
    completeAndPurge(job).catch(() => {});
    if (!ok) res.destroy();
  };

  stream.on('error', () => settle(false));
  res.on('close', () => settle(res.writableEnded));
  stream.pipe(res);
}

async function handleCancel(res, id) {
  const job = getJob(id);
  if (!job) return fail(res, 404, ERR.JOB_NOT_FOUND);
  await cancelJob(job);
  return json(res, 200, { ok: true });
}

/**
 * The one origin allowed to ask whether this app is running.
 *
 * Named in full rather than matched by pattern: a wildcard here would let any page on
 * the internet enumerate what is listening on the visitor's own machine.
 */
const SETUP_ORIGIN = 'https://getsteading.vercel.app';

function isSetupOrigin(req) {
  return req.headers.origin === SETUP_ORIGIN;
}

async function handleHealth(res) {
  const [ytdlpVersion, ffmpegVersion, extractors] = await Promise.all([
    probeVersion(config.ytdlp),
    probeVersion(config.ffmpeg, '-version'),
    probeExtractorCount(),
  ]);
  return json(res, 200, {
    // Whether downloads can work is decided by yt-dlp being present, not by how fast it
    // can recite its version. Treating a slow answer as "missing" sent people off to
    // reinstall something they already had.
    ok: Boolean(config.ytdlp),
    ytdlp: ytdlpVersion,
    ffmpeg: ffmpegVersion ? ffmpegVersion.replace(/^ffmpeg version /, '').split(' ')[0] : null,
    activeJobs: countActive(),
    platforms: SUPPORTED_PLATFORMS,
    // The UI says so out loud rather than silently accepting links the listed set does
    // not cover; someone should be able to tell which mode they are in.
    universal: config.universal,
    // What universal mode actually buys, as a number rather than a promise. Null until
    // the startup probe finishes, which the UI treats as "not known yet".
    extractors,
    // The UI builds its format controls from this rather than from a copy of the table,
    // so a format the server does not accept can never appear as an option.
    formats: FORMAT_KINDS,
  });
}

/* ------------------------------------------------------------------ server */

const JOB_ROUTE = /^\/api\/jobs\/([a-f0-9]{16})(?:\/(events|file))?$/;

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return fail(res, 400, ERR.BAD_REQUEST_URL);
  }

  try {
    if (pathname.startsWith('/api/')) {
      if (!hostAllowed(req)) return fail(res, 403, ERR.ORIGIN_REJECTED);

      // The setup page needs to know whether this app is already running, so that
      // someone who has installed it is sent here instead of being offered the
      // installer again -- or worse, left pasting links into a page that cannot
      // download. Chrome refuses a public page any contact with a local address unless
      // the local side says yes, which is what these three headers do.
      //
      // Deliberately the narrowest opening that answers the question: one named origin,
      // one endpoint, and only the version strings behind it. No other route replies to
      // a cross-origin caller, and nothing here accepts input.
      if (pathname === '/api/health' && isSetupOrigin(req)) {
        res.setHeader('Access-Control-Allow-Origin', SETUP_ORIGIN);
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' });
          return res.end();
        }
      }

      if (req.method !== 'GET' && !sameOrigin(req)) return fail(res, 403, ERR.ORIGIN_REJECTED);

      if (pathname === '/api/health' && req.method === 'GET') return await handleHealth(res);
      if (pathname === '/api/info' && req.method === 'POST') return await handleInfo(req, res);
      if (pathname === '/api/jobs' && req.method === 'POST') return await handleCreateJob(req, res);

      const match = JOB_ROUTE.exec(pathname);
      if (match) {
        const id = validateJobId(match[1]);
        if (!id.ok) return fail(res, 400, id.code);

        if (match[2] === 'events' && req.method === 'GET') return handleEvents(req, res, id.id);
        if (match[2] === 'file' && req.method === 'GET') return await handleFile(req, res, id.id);
        if (!match[2] && req.method === 'GET') {
          const job = getJob(id.id);
          if (!job) return fail(res, 404, ERR.JOB_NOT_FOUND);
          // Reading the status proves someone is still watching; see touchJob.
          touchJob(job);
          return json(res, 200, publicView(job));
        }
        if (!match[2] && req.method === 'DELETE') return await handleCancel(res, id.id);
      }

      return fail(res, 404, ERR.UNKNOWN_ENDPOINT);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveStatic(req, res, pathname)) return;
      // Unknown path -> the app shell, so a deep link opened from the home screen works.
      if (!pathname.includes('.')) {
        if (await serveStatic(req, res, '/')) return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }

    res.writeHead(405, { Allow: 'GET, HEAD, POST, DELETE' }).end();
  } catch (err) {
    if (res.headersSent) return res.destroy();
    return fail(res, err.status || 500, err.code || ERR.SERVER_ERROR);
  }
});

// Long downloads must not be cut off by the default socket timeouts.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 72_000;

initJobSystem();

// Both version probes are slow enough on modest hardware to be worth starting now,
// so the first page load reads a cached answer instead of waiting for one.
warmVersions();

server.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log('');
  console.log('  Steading  ·  Fast. Seamless. 100% Local.');
  console.log(`  ${url}`);
  if (!config.ytdlp) console.log('  ! yt-dlp is not installed -- run: npm run check');
  else if (!config.ffmpeg) console.log('  ! ffmpeg is not installed -- MP3 and video merging will fail');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Start on another port, e.g. PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});

export { server };
