/**
 * Pictures a page publishes about itself through oEmbed.
 *
 * This is the link that reaches the places a scraper cannot, and the reason it exists is
 * worth recording precisely. Instagram assembles its post pages in the browser and hands
 * anyone not signed in an empty shell: measured at 616 KB containing no `og:image`, no
 * `.jpg` address anywhere in it, and a single `<img>` tag. Reading that HTML finds
 * genuinely nothing, and every one of the 28 addresses it does yield is interface
 * furniture that fails to fetch as a picture. The same post answers an oEmbed request
 * with 9 KB of plain JSON carrying the caption, the author and a working image address.
 *
 * The valuable half is not the site list below -- it is discovery. oEmbed is a published
 * standard, and a page that follows it names its own endpoint in a `<link>` tag. One
 * implementation therefore covers every site that plays by the rules, which is the
 * honest version of "support hundreds of platforms": one standard rather than one
 * dependency per site.
 *
 * Its limit is real and is not disguised anywhere it is used: oEmbed returns the single
 * representative picture, so a carousel of fourteen photos comes back as its cover. One
 * picture is worth having. Calling it the whole post would not be.
 */

import { isFetchable } from './scrape.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_JSON_BYTES = 512 * 1024;

/**
 * Endpoints that have to be known in advance, because these pages do not advertise one.
 *
 * Deliberately short. Discovery covers everything that follows the standard, and a
 * hard-coded table is a maintenance debt that grows quietly -- exactly the shape of
 * problem that "install a package per site" would have created at a hundred times the
 * size.
 */
const KNOWN = [
  [/^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i, 'https://www.instagram.com/api/v1/oembed/?url='],
  [/^https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\//i, 'https://publish.twitter.com/oembed?url='],
  [/^https?:\/\/(www\.)?flickr\.com\/photos\//i, 'https://www.flickr.com/services/oembed/?format=json&url='],
  [/^https?:\/\/(www\.)?tiktok\.com\/@/i, 'https://www.tiktok.com/oembed?url='],
];

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
}

/** Where this page's oEmbed document lives, or null. Discovery first, table second. */
function endpointFor(pageUrl, html) {
  if (html) {
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = (attr(tag, 'rel') || '').toLowerCase();
      const type = (attr(tag, 'type') || '').toLowerCase();
      if (rel.includes('alternate') && type.includes('json+oembed')) {
        const href = attr(tag, 'href');
        if (href) {
          try { return new URL(href, pageUrl).href; } catch { /* malformed href */ }
        }
      }
    }
  }

  for (const [pattern, prefix] of KNOWN) {
    if (pattern.test(pageUrl)) return prefix + encodeURIComponent(pageUrl);
  }
  return null;
}

/**
 * Picture URLs from a page's oEmbed document.
 *
 * Returns an empty array rather than throwing when there is no endpoint or the request
 * fails: this is one link in a chain, and a link that cannot help should step aside
 * rather than end the request.
 *
 * @param {string} pageUrl
 * @param {{html?: string, timeoutMs?: number}} [options] `html` is the already-fetched
 *   page, when the caller has one, so discovery costs no second request.
 * @returns {Promise<string[]>}
 */
export async function oembedPictures(pageUrl, { html = null, timeoutMs = 15_000 } = {}) {
  const endpoint = endpointFor(pageUrl, html);
  if (!endpoint || !(await isFetchable(endpoint))) return [];

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let data;
  try {
    const res = await fetch(endpoint, {
      signal: control.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) return [];

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_JSON_BYTES) return [];
    // Some endpoints answer as text/plain, so the parse is the real content check.
    data = JSON.parse(buf.toString('utf8'));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const out = [];
  if (typeof data?.thumbnail_url === 'string' && /^https?:\/\//i.test(data.thumbnail_url)) {
    out.push(data.thumbnail_url);
  }

  // A few providers put the picture only inside the embed markup they hand back.
  if (typeof data?.html === 'string') {
    for (const tag of data.html.match(/<img\b[^>]*>/gi) ?? []) {
      const src = attr(tag, 'src');
      if (src && /^https?:\/\//i.test(src) && !out.includes(src)) out.push(src);
    }
  }

  return out;
}
