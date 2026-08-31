/**
 * Temp directory lifecycle.
 *
 * This module exists because a leaked tmp/<jobId>/ folder is the one failure mode that
 * silently fills a phone's storage. Everything that creates a directory under tmp/ must
 * come through here, and every terminal job state must call purgeDir().
 */

import { rm, mkdir } from 'node:fs/promises';
import { rmSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TMP_DIR } from '../config.js';

/** Guard: never delete anything that is not inside tmp/. */
function assertInsideTmp(dir) {
  const target = resolve(dir);
  const base = resolve(TMP_DIR);
  if (target === base || !target.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) {
    throw new Error(`refusing to remove path outside tmp/: ${target}`);
  }
  return target;
}

export function ensureTmpRoot() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

export async function createJobDir(jobId) {
  ensureTmpRoot();
  const dir = join(TMP_DIR, jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Remove a job directory. Safe to call repeatedly and safe to call on a directory that
 * never existed -- terminal paths should not have to know which happened.
 *
 * Windows keeps a handle briefly after a child process dies, so a first rm can throw
 * EBUSY/EPERM; the retry options in node:fs handle that without us reimplementing it.
 */
export async function purgeDir(dir) {
  if (!dir) return;
  try {
    const target = assertInsideTmp(dir);
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  } catch (err) {
    // Cleanup must never be the reason a request fails. Log and move on.
    console.warn(`[cleanup] could not remove ${dir}: ${err.message}`);
  }
}

/** Synchronous variant, used only from exit handlers where async has no chance to run. */
export function purgeDirSync(dir) {
  if (!dir) return;
  try {
    rmSync(assertInsideTmp(dir), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* exiting anyway */
  }
}

/**
 * Boot-time sweep: anything under tmp/ predates this process, so it is orphaned by
 * definition -- a power loss, a kill -9, or Termux being swiped away.
 */
export function sweepOrphansSync() {
  ensureTmpRoot();
  let removed = 0;
  for (const entry of readdirSync(TMP_DIR, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    purgeDirSync(join(TMP_DIR, entry.name));
    removed += 1;
  }
  if (removed) console.log(`[cleanup] removed ${removed} orphaned job folder(s) from a previous run`);
  return removed;
}

/**
 * Register exit hooks. `onExit` is where the job registry kills children and purges
 * live jobs; it must be synchronous.
 */
export function installExitHooks(onExit) {
  let done = false;
  const run = (signal) => {
    if (done) return;
    done = true;
    try { onExit(); } catch (err) { console.warn(`[cleanup] exit hook: ${err.message}`); }
    if (signal) process.exit(0);
  };

  process.on('SIGINT', () => run('SIGINT'));
  process.on('SIGTERM', () => run('SIGTERM'));
  process.on('SIGHUP', () => run('SIGHUP'));
  process.on('beforeExit', () => run(null));
  process.on('uncaughtException', (err) => {
    console.error('[fatal]', err);
    run('SIGTERM');
  });
}

