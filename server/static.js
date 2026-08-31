/**
 * Static file serving for public/.
 *
 * Small enough to keep hand-rolled: resolve, refuse traversal, set a MIME type, set a
 * cache policy, stream. No directory listings, no symlink following beyond what the
 * realpath check allows.
 */

import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { PUBLIC_DIR } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Cache policy. The service worker owns app-shell freshness, so the HTTP layer stays
 * conservative for anything that can change and generous only for icons.
 */
function cacheControl(pathname) {
  if (pathname.startsWith('/icons/')) return 'public, max-age=604800';
  if (pathname === '/sw.js' || pathname === '/') return 'no-cache';
  return 'no-cache';
}

export async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');

  // Reject traversal before touching the filesystem.
  if (relative.includes('\0') || relative.split(/[/\\]/).includes('..')) {
    res.writeHead(400).end('Bad request');
    return true;
  }

  const target = resolve(join(PUBLIC_DIR, relative));
  const base = resolve(PUBLIC_DIR);
  if (target !== base && !target.startsWith(base + sep)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  let info;
  try {
    const real = await realpath(target);
    if (real !== base && !real.startsWith(base + sep)) {
      res.writeHead(403).end('Forbidden');
      return true;
    }
    info = await stat(real);
  } catch {
    return false; // caller renders the 404
  }
  if (!info.isFile()) return false;

  const etag = `W/"${info.size}-${info.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(pathname) }).end();
    return true;
  }

  const ext = extname(target).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };

  // The page loads no third-party code and posts to nothing, so the policy can be
  // absolute. `img-src https:` is the one opening: thumbnails come from whatever CDN
  // the platform uses, and an <img> cannot execute anything.
  if (ext === '.html') {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "font-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "manifest-src 'self'",
    ].join('; ');
    headers['X-Frame-Options'] = 'DENY';
  }

  res.writeHead(200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  const stream = createReadStream(target);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
