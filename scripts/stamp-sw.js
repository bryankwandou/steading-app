/**
 * Stamp the service worker's cache name with a hash of what it caches.
 *
 * The name was a fixed string, and that is a bug with a long reach: a returning visitor
 * gets the new index.html (navigations are network-first) but keeps the *old* app.js,
 * style.css and dictionaries, because static assets are cache-first and the activate
 * handler only deletes caches whose name differs from the current one. A name that never
 * changes means a cache that is never cleared. New markup then runs against old code and
 * old styles, which looks exactly like a broken page rather than a stale one -- and no
 * amount of redeploying fixes it, because every deploy carries the same name.
 *
 * Hashing the shell means the name changes precisely when something it serves changed,
 * and not otherwise, so returning visitors are not made to re-download for nothing.
 *
 * Run by `npm run package`.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'public', 'sw.js');

/** The paths sw.js pre-caches, read from sw.js itself so the two cannot disagree. */
export function shellPaths(source = readFileSync(SW, 'utf8')) {
  const block = source.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js: could not find the SHELL list');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** A hash over every shell file's content, plus sw.js's own logic. */
export function shellHash() {
  const source = readFileSync(SW, 'utf8');
  const hash = createHash('sha256');

  // sw.js without its version line, so stamping does not feed back into the hash.
  hash.update(source.replace(/const VERSION = '[^']*';/, ''));

  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

  for (const path of shellPaths(source).sort()) {
    // '/' and '/setup' are rewrites of real files; map them to what is on disk. The
    // check has to be isFile, not exists: '/' resolves to public/ itself, which exists.
    const candidates = [
      path === '/' ? '/index.html' : path,
      `${path}.html`,
    ];
    for (const candidate of candidates) {
      const file = join(ROOT, 'public', candidate.replace(/^\//, ''));
      if (isFile(file)) {
        hash.update(candidate);
        hash.update(readFileSync(file));
        break;
      }
    }
  }
  return hash.digest('hex').slice(0, 12);
}

export function currentVersion(source = readFileSync(SW, 'utf8')) {
  return source.match(/const VERSION = '([^']*)';/)?.[1] ?? null;
}

export function expectedVersion() {
  return `steading-app-${shellHash()}`;
}

export { SW };

// Running this file stamps; importing it does not.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const source = readFileSync(SW, 'utf8');
  const version = expectedVersion();
  const stamped = source.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
  if (!stamped.includes(version)) throw new Error('sw.js: no VERSION line to stamp');
  writeFileSync(SW, stamped);
  console.log(`  sw.js          ${version}`);
}
