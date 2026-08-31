/**
 * Finding the pictures on a page, without another program.
 *
 * This is the provider that covers an ordinary website or a forum thread -- the half of
 * "social media, forums, or just a normal web page" that no downloader specialises in.
 * It reads the HTML the server sends and takes the image URLs out of it, in the order a
 * page is most likely to have meant them:
 *
 *   1. `og:image` / `twitter:image` -- what the page itself nominates as its picture,
 *      and on a multi-image post there is often one tag per photo.
 *   2. JSON-LD `image` fields -- structured data, usually the same set, sometimes better.
 *   3. plain `<img>` -- the fallback, filtered hard, because a page is full of icons.
 *
 * What it cannot do is see a page that builds itself in the browser. Instagram sends an
 * almost empty document and fills it in with JavaScript; no amount of HTML parsing
 * reaches those photos. That is what the gallery-dl provider is for, and why the chain
 * exists rather than one clever function.
 *
 * There is no HTML parser here and there does not need to be: this looks for specific
 * tags and pulls one attribute out of each. A regex is the wrong tool for understanding
 * HTML and the right one for skimming it.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Enough of a browser to be served the real page; honest about what it is. */
const UA = 'Mozilla/5.0 (compatible; Steading/1.0; +local)';

const MAX_HTML_BYTES = 4 * 1024 * 1024;

/**
 * Addresses the server must never fetch on a page's say-so.
 *
 * This is the one genuinely dangerous thing about reading a remote page: every URL that
 * comes back is written by whoever controls that page, and Steading runs on a personal
 * machine with other things listening on it. A post could name
 * `http://127.0.0.1:8080/admin` or a cloud metadata address and have the server fetch it
 * and hand the bytes back as a "photo". So a scraped URL is resolved and its address is
 * checked before anything is fetched -- resolved, not merely pattern-matched, because a
 * public-looking hostname is free to have an A record pointing at 127.0.0.1.
 *
 * The same reasoning as `hostAllowed()` in index.js, pointed the other way: that one
 * stops the outside reaching in, this one stops the inside being reached out to.
 */
function isPrivateAddress(ip) {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    // IPv4 written inside an IPv6 address still has to face the IPv4 rules.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }

  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;      // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true;                     // multicast and reserved
  return false;
}

/** @returns {Promise<boolean>} whether this URL is safe for the server to fetch. */
export async function isFetchable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  try {
    // Every address the name resolves to has to pass, not just the first: a hostile name
    // can hand back one public address and one loopback and hope for a lucky pick.
    const addresses = await lookup(parsed.hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Fetch text, with a cap, so a hostile page cannot hand back a gigabyte. */
async function fetchHtml(url, timeoutMs) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(type)) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, MAX_HTML_BYTES).toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const attr = (tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
};

/** Meta tags whose content is a picture the page is nominating for itself. */
function fromMeta(html) {
  const out = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (key !== 'og:image' && key !== 'og:image:url'
      && key !== 'og:image:secure_url' && key !== 'twitter:image') continue;
    const content = attr(tag, 'content');
    if (content) out.push(content);
  }
  return out;
}

/**
 * JSON-LD `image` fields. The shape is wildly inconsistent in the wild -- a string, an
 * array of strings, an object with `url`, an array of those -- so this walks whatever it
 * finds rather than assuming one of them.
 */
function fromJsonLd(html) {
  const out = [];
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];

  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue; // malformed JSON-LD is extremely common and not our problem
    }

    const walk = (node, depth = 0) => {
      if (!node || depth > 6) return;
      if (typeof node === 'string') return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
      if (typeof node !== 'object') return;

      for (const [key, value] of Object.entries(node)) {
        if (key === 'image' || key === 'contentUrl' || key === 'thumbnailUrl') {
          const take = (v) => {
            if (typeof v === 'string') out.push(v);
            else if (Array.isArray(v)) v.forEach(take);
            else if (v && typeof v === 'object' && typeof v.url === 'string') out.push(v.url);
          };
          take(value);
        } else {
          walk(value, depth + 1);
        }
      }
    };
    walk(data);
  }
  return out;
}

/**
 * Names that are almost never the picture someone wanted: interface furniture, avatars,
 * tracking pixels. Wrong occasionally, and that is the right trade -- a PDF padded with
 * eleven copies of a site's logo is worse than one that missed a photo.
 */
const JUNK = /(sprite|icon|favicon|logo|avatar|badge|emoji|spacer|pixel|1x1|blank|placeholder|loading|thumb_?small)/i;

function fromImgTags(html) {
  const out = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    // srcset first: its last entry is usually the largest copy on offer.
    const srcset = attr(tag, 'srcset');
    if (srcset) {
      const best = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (best) { out.push(best); continue; }
    }
    // Lazy-loading pages leave the real address in a data- attribute and put a
    // placeholder in src, so those are worth more than src itself.
    const src = attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'src');
    if (src) out.push(src);
  }
  return out;
}

/**
 * Collect candidate picture URLs from a page.
 *
 * @param {string} pageUrl
 * @param {{timeoutMs?: number, limit?: number}} [options]
 * @returns {Promise<string[]>} absolute, de-duplicated, safe-to-fetch URLs
 */
export async function scrapeImages(pageUrl, { timeoutMs = 20_000, limit = 60 } = {}) {
  const html = await fetchHtml(pageUrl, timeoutMs);
  if (!html) return [];

  // Meta and JSON-LD are what the page nominated; <img> is a guess, so it goes last and
  // only its non-junk entries count.
  const candidates = [
    ...fromMeta(html),
    ...fromJsonLd(html),
    ...fromImgTags(html).filter((u) => !JUNK.test(u)),
  ];

  const seen = new Set();
  const absolute = [];
  for (const raw of candidates) {
    if (!raw || raw.startsWith('data:')) continue;
    let resolved;
    try {
      resolved = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    absolute.push(resolved);
    if (absolute.length >= limit * 3) break; // room to lose some to the address check
  }

  const safe = [];
  for (const url of absolute) {
    if (safe.length >= limit) break;
    // Sequential rather than parallel: this is a DNS lookup per URL against a list a
    // remote page controls the length of.
    if (await isFetchable(url)) safe.push(url);
  }
  return safe;
}

export { UA, isPrivateAddress };
