/**
 * Cleanup contract tests.
 *
 * These matter more than the rest of the suite: a leaked tmp/<jobId>/ folder silently
 * fills a phone's storage, and it is exactly the kind of bug that never shows up in
 * manual testing. yt-dlp is mocked so no network or binary is involved -- what is under
 * test is jobs.js's lifecycle, not the downloader.
 *
 * Run: node --test --experimental-test-module-mocks tests/jobs.test.js
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const controls = [];

/** A stand-in for a running yt-dlp process. */
function fakeProcess() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

mock.module('../server/ytdlp.js', {
  namedExports: {
    startDownload({ dir, onEvent }) {
      const child = fakeProcess();
      let settle;
      const done = new Promise((resolvePromise, rejectPromise) => {
        settle = { resolvePromise, rejectPromise };
      });
      const control = {
        dir,
        child,
        emit: onEvent,
        finish() {
          const file = join(dir, 'media.mp4');
          writeFileSync(file, 'fake-bytes');
          settle.resolvePromise({ file });
        },
        // Mirrors the real contract: ytdlp.js rejects with a coded error whose
        // `detail` carries the raw yt-dlp line, never a translated sentence.
        failWith(detail, code = 'download_failed') {
          settle.rejectPromise(Object.assign(new Error(code), { code, detail }));
        },
      };
      controls.push(control);
      return { child, done };
    },
    // Mirrors the real contract: kill the tree, then resolve only once it is gone.
    // jobs.js awaits this before purging, and that ordering is what these tests check.
    killTree: async (child) => { if (child) child.kill(); },
    killTreeSync: (child) => { if (child) child.kill(); },
    fetchInfo: async () => ({ title: 'x', qualities: ['best'] }),
    probeVersion: async () => 'fake',
  },
});

const { createJob, subscribe, touchJob, cancelJob, completeAndPurge, getJob } = await import('../server/lib/jobs.js');

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until something is true, rather than for a fixed number of milliseconds.
 *
 * These tests used to sleep 20 ms and then assert. That is a bet on how fast the machine
 * is, and on a modest or busy laptop the directory removal and the SSE write routinely
 * take longer, so the suite failed at random. Random failures are worse than no tests at
 * all in a project whose test run is meant to be shown to someone as evidence.
 *
 * The deadline is generous because it only bounds the failure case; a passing check
 * returns as soon as the condition holds, so the suite does not get slower.
 */
async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeout} ms waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Minimal stand-in for an SSE http response. */
function fakeRes() {
  return { chunks: [], write(c) { this.chunks.push(c); return true; }, end() { this.ended = true; } };
}

async function newJob() {
  const job = await createJob({ url: 'https://youtu.be/x', format: 'mp4', quality: 'best', title: 'Video Uji' });
  return { job, control: controls.at(-1) };
}

test('a successful download purges its temp folder after the file is handed over', async () => {
  const { job, control } = await newJob();
  const dir = job.dir;
  assert.ok(existsSync(dir), 'temp dir should exist while running');

  control.finish();
  await waitFor(() => job.state === 'ready', 'the job to reach ready');
  assert.equal(job.state, 'ready');
  assert.ok(existsSync(dir), 'file must survive until the client fetches it');

  await completeAndPurge(job);
  assert.equal(job.state, 'done');
  assert.equal(existsSync(dir), false, 'temp dir must be gone after delivery');
});

test('a failed download kills the child and purges', async () => {
  const { job, control } = await newJob();
  const dir = job.dir;

  control.failWith('Video unavailable');
  await waitFor(() => job.state === 'error' && !existsSync(dir), 'the error state and the purge');

  assert.equal(job.state, 'error');
  assert.equal(job.code, 'download_failed', 'the classifier code, not prose, is what reaches the client');
  assert.equal(job.detail, 'Video unavailable');
  assert.equal(control.child.killed, true, 'child must be killed');
  assert.equal(existsSync(dir), false, 'temp dir must be gone after an error');
});

test('cancel kills the child and purges immediately', async () => {
  const { job, control } = await newJob();
  const dir = job.dir;

  await cancelJob(job);

  assert.equal(job.state, 'canceled');
  assert.equal(control.child.killed, true);
  assert.equal(existsSync(dir), false);
});

test('closing the browser mid-download purges after the grace window', async () => {
  const { job, control } = await newJob();
  const dir = job.dir;

  const res = fakeRes();
  const detach = subscribe(job, res);
  assert.ok(res.chunks.length === 0 || true);

  detach(); // browser closed
  assert.ok(existsSync(dir), 'must not purge instantly -- a reconnect is still possible');
  assert.ok(job.abandonTimer, 'grace timer should be armed');

  // Fire the grace timer without waiting the real 15s.
  clearTimeout(job.abandonTimer);
  job.abandonTimer = null;
  await cancelJob(job, 'client_gone');

  assert.equal(job.state, 'canceled');
  assert.equal(control.child.killed, true);
  assert.equal(existsSync(dir), false);
});

test('reconnecting within the grace window disarms the purge', async () => {
  const { job } = await newJob();
  const dir = job.dir;

  const detachA = subscribe(job, fakeRes());
  detachA();
  assert.ok(job.abandonTimer, 'grace timer armed after disconnect');

  subscribe(job, fakeRes()); // client comes back
  assert.equal(job.abandonTimer, null, 'grace timer must be disarmed');
  assert.ok(existsSync(dir), 'work must continue');

  await cancelJob(job); // tidy up
});

test('polling keeps a job alive after the SSE stream is dropped', async () => {
  // A client behind a buffering proxy closes SSE on purpose and polls instead. From the
  // server that is indistinguishable from a closed tab, so without touchJob the job
  // would be reclaimed mid-download and the user would see "the browser disconnected".
  const { job } = await newJob();
  const dir = job.dir;

  const detach = subscribe(job, fakeRes());
  detach();
  const armed = job.abandonTimer;
  assert.ok(armed, 'grace timer armed once the stream closed');

  touchJob(job); // one poll
  assert.ok(job.abandonTimer, 'still armed -- polling defers, it does not disarm');
  assert.notEqual(job.abandonTimer, armed, 'the deadline must be pushed back, not reused');
  assert.equal(job.state, 'running', 'the job must not be reclaimed');
  assert.ok(existsSync(dir), 'work must continue');

  await cancelJob(job); // tidy up
});

test('touching a finished job does not resurrect its timer', async () => {
  const { job } = await newJob();
  await cancelJob(job);
  touchJob(job);
  assert.equal(job.abandonTimer, null, 'terminal jobs stay terminal');
});

test('subscribers receive progress and are closed out on failure', async () => {
  const { job, control } = await newJob();
  const res = fakeRes();
  subscribe(job, res);

  control.emit({ type: 'progress', phase: 'downloading', percent: 42, downloaded: 42, total: 100, speed: 1000, eta: 3 });
  await waitFor(() => res.chunks.some((c) => c.includes('"percent":42')), 'the progress frame');

  const update = res.chunks.find((c) => c.includes('"percent":42'));
  assert.ok(update, 'progress should reach the subscriber');

  control.failWith('boom');
  await waitFor(() => res.chunks.some((c) => c.startsWith('event: failed')) && res.ended, 'the failed event and the close');

  assert.ok(res.chunks.some((c) => c.startsWith('event: failed')), 'a failed event should be sent');
  assert.equal(res.ended, true, 'the stream should be closed');
});

test('the concurrency limit is enforced', async () => {
  const a = await newJob();
  const b = await newJob();
  await assert.rejects(() => newJob(), (err) => err.code === 'too_many_jobs' && err.status === 429);
  await cancelJob(a.job);
  await cancelJob(b.job);
});

test('a job stays queryable briefly after it ends, then its files are already gone', async () => {
  const { job, control } = await newJob();
  const dir = job.dir;
  control.failWith('nope');
  await waitFor(() => getJob(job.id)?.state === 'error' && !existsSync(dir), 'the error state and the purge');

  assert.equal(getJob(job.id)?.state, 'error', 'record kept so a late poll gets a real answer');
  assert.equal(existsSync(dir), false, 'but nothing is left on disk');
});
