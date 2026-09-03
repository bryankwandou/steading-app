/**
 * Job registry and lifecycle.
 *
 * A job owns exactly one temp directory and exactly one child process, and it is the
 * single place where either is destroyed. Read the cleanup contract in CLAUDE.md before
 * changing anything here.
 */

import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { config } from '../config.js';
import { startDownload, killTree, killTreeSync } from '../ytdlp.js';
import { createJobDir, purgeDir, purgeDirSync, sweepOrphansSync, installExitHooks } from './cleanup.js';
import { safeFilename } from './validate.js';
import { ERR, coded } from './errors.js';

/** @type {Map<string, Job>} */
const jobs = new Map();

const TERMINAL = new Set(['done', 'error', 'canceled']);

function newId() {
  return randomBytes(8).toString('hex'); // 16 hex chars -- matches validateJobId
}

export function countActive() {
  let n = 0;
  for (const job of jobs.values()) if (!TERMINAL.has(job.state)) n += 1;
  return n;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

/** The shape sent to the client. Never leaks absolute paths. */
export function publicView(job) {
  return {
    id: job.id,
    state: job.state,
    phase: job.phase,
    percent: job.percent,
    downloaded: job.downloaded,
    total: job.total,
    speed: job.speed,
    eta: job.eta,
    format: job.format,
    filename: job.filename,
    size: job.size,
    // `code` is what the UI renders (translated); `detail` is optional raw context.
    code: job.code,
    detail: job.detail,
  };
}

function broadcast(job, event = 'update') {
  const payload = `event: ${event}\ndata: ${JSON.stringify(publicView(job))}\n\n`;
  for (const res of job.subscribers) {
    try { res.write(payload); } catch { job.subscribers.delete(res); }
  }
}

/**
 * THE purge path. Every terminal state and every abandonment routes through here, so
 * "did this job clean up?" has exactly one answer to check.
 */
async function finalize(job, { state, code = null, detail = null }) {
  if (job.purged) return;

  clearTimeout(job.abandonTimer);
  clearTimeout(job.ttlTimer);
  job.abandonTimer = null;
  job.ttlTimer = null;

  // Kill the whole tree and WAIT for it. Purging while yt-dlp or its ffmpeg child is
  // still writing does not just fail -- the directory gets recreated behind us, which
  // is exactly how a leak survives a cancel.
  if (job.child) {
    try { await killTree(job.child); } catch { /* fall through to the purge anyway */ }
  }
  job.child = null;

  job.state = state;
  job.code = code;
  job.detail = detail;
  job.purged = true;

  await purgeDir(job.dir);
  job.dir = null;
  job.file = null;

  broadcast(job, state === 'done' ? 'done' : 'failed');
  for (const res of job.subscribers) { try { res.end(); } catch { /* noop */ } }
  job.subscribers.clear();

  // Keep the record briefly so a late poll gets a real answer instead of a 404.
  setTimeout(() => jobs.delete(job.id), 60_000).unref?.();
}

/** Success path: the file has been streamed to the client, so the temp dir can go. */
export async function completeAndPurge(job) {
  await finalize(job, { state: 'done' });
}

export async function cancelJob(job, code = ERR.CANCELED) {
  if (TERMINAL.has(job.state)) return;
  await finalize(job, { state: 'canceled', code });
}

/**
 * Start a job. Resolves as soon as the child is spawned -- the download itself runs in
 * the background and is observed over SSE.
 */
export async function createJob({ url, format, quality, title, guard = false }) {
  if (countActive() >= config.maxConcurrentJobs) {
    throw coded(ERR.TOO_MANY_JOBS, { status: 429, detail: String(config.maxConcurrentJobs) });
  }

  const id = newId();
  const dir = await createJobDir(id);

  /** @typedef {ReturnType<typeof createJob>} Job */
  const job = {
    id,
    url,
    format,
    quality,
    dir,
    file: null,
    filename: safeFilename(title, format),
    size: null,
    state: 'running',
    phase: 'extracting',
    percent: null,
    downloaded: null,
    total: null,
    speed: null,
    eta: null,
    code: null,
    detail: null,
    purged: false,
    child: null,
    subscribers: new Set(),
    abandonTimer: null,
    ttlTimer: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  let handle;
  try {
    handle = await startDownload({
      url,
      format,
      quality,
      dir,
      // Unlisted hosts go through the loopback proxy, which resolves the name and
      // connects to that address itself -- so there is no second lookup to poison
      // between the check and the fetch.
      guard,
      // Every process the job owns is reported here, so a cancel arriving during the
      // image conversion kills ffmpeg rather than a yt-dlp that has already exited.
      onChild: (child) => { if (!TERMINAL.has(job.state)) job.child = child; },
      onEvent: (event) => {
        if (TERMINAL.has(job.state)) return;
        if (event.phase) job.phase = event.phase;
        if (event.type === 'progress') {
          job.percent = event.percent;
          job.downloaded = event.downloaded;
          job.total = event.total;
          job.speed = event.speed;
          job.eta = event.eta;
        }
        broadcast(job);
      },
    });
  } catch (err) {
    // Spawn failed outright (missing binary). Clean up before rethrowing.
    await finalize(job, { state: 'error', code: err.code || ERR.SERVER_ERROR, detail: err.detail ?? null });
    throw err;
  }

  job.child = handle.child;

  handle.done
    .then(async ({ file }) => {
      if (TERMINAL.has(job.state)) return; // canceled while finishing
      job.file = file;
      job.child = null;
      try {
        job.size = (await stat(file)).size;
      } catch {
        job.size = null;
      }
      job.state = 'ready';
      job.phase = 'ready';
      job.percent = 100;
      broadcast(job, 'ready');

      // The client should now fetch the file. If it never does, do not keep the bytes.
      job.ttlTimer = setTimeout(() => {
        finalize(job, { state: 'error', code: ERR.FILE_EXPIRED });
      }, config.completedTtlMs);
      job.ttlTimer.unref?.();
    })
    .catch(async (err) => {
      if (TERMINAL.has(job.state)) return; // already canceled; its message wins
      await finalize(job, {
        state: err.code === ERR.CANCELED ? 'canceled' : 'error',
        code: err.code || ERR.SERVER_ERROR,
        detail: err.detail ?? null,
      });
    });

  return job;
}

/**
 * A polling client is still a client.
 *
 * The abandon timer exists to reclaim a job whose browser went away, and it is armed
 * when the last SSE subscriber detaches. But a client behind a buffering proxy drops
 * SSE deliberately and polls instead, which from here looks identical to a closed tab.
 * Every status read therefore counts as presence and pushes the deadline back, so a
 * job someone is actively watching is never reclaimed out from under them.
 */
export function touchJob(job) {
  if (!job || TERMINAL.has(job.state) || !job.abandonTimer) return;
  clearTimeout(job.abandonTimer);
  job.abandonTimer = setTimeout(() => {
    finalize(job, { state: 'canceled', code: ERR.CLIENT_GONE });
  }, config.abandonGraceMs);
  job.abandonTimer.unref?.();
}

/** Attach an SSE response to a job. Returns a detach function. */
export function subscribe(job, res) {
  job.subscribers.add(res);

  // A client that reattaches within the grace window cancels the abandonment.
  if (job.abandonTimer) {
    clearTimeout(job.abandonTimer);
    job.abandonTimer = null;
  }

  return () => {
    job.subscribers.delete(res);
    if (job.subscribers.size > 0 || TERMINAL.has(job.state)) return;

    if (job.state === 'running') {
      // Browser closed mid-download. Give a flaky mobile connection a chance to come
      // back before killing the work and reclaiming the disk.
      job.abandonTimer = setTimeout(() => {
        finalize(job, { state: 'canceled', code: ERR.CLIENT_GONE });
      }, config.abandonGraceMs);
      job.abandonTimer.unref?.();
    }
    // state === 'ready' is left alone: the client detaches from SSE precisely because
    // it is about to fetch the file. The completedTtl timer covers the case where it
    // never does.
  };
}

/** Periodic backstop for anything the per-job timers somehow missed. */
export function startSweeper() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (TERMINAL.has(job.state)) continue;
      const age = now - job.createdAt;
      if (age > config.downloadTimeoutMs + 60_000) {
        finalize(job, { state: 'error', code: ERR.JOB_EXPIRED });
      }
    }
  }, config.sweepIntervalMs);
  timer.unref?.();
  return timer;
}

/** Called once at boot from index.js. */
export function initJobSystem() {
  sweepOrphansSync();
  startSweeper();
  installExitHooks(() => {
    for (const job of jobs.values()) {
      killTreeSync(job.child);
      purgeDirSync(job.dir);
    }
    jobs.clear();
  });
}

export { jobs, TERMINAL };
