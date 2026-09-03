/**
 * Finding a video on a page without yt-dlp.
 *
 * The court's auditor was right that resting every platform on one project is a single
 * point of failure. The proposed remedy -- hundreds of per-site packages -- would have
 * made it worse: yt-dlp already *is* around 1,750 per-site extractors kept under one
 * test suite, and replacing that with hundreds of separately-maintained dependencies
 * trades one well-tested source for hundreds of rotting ones, on a machine whose whole
 * promise is that nothing untrusted runs on it.
 *
 * The remedy that does work is the one already used for pictures: a chain of independent
 * sources, none of them required. This is the third link in that chain for video, and
 * the important one, because it depends on nothing at all. If every binary on the
 * machine were removed tomorrow, this would still find the video on an ordinary page.
 *
 * It is deliberately modest. It reads what a page says about itself -- Open Graph, then
 * JSON-LD, then the <video> element -- and does not attempt to reverse-engineer a
 * player. It will not get YouTube. It will get a news site, a blog, a forum, a school
 * portal, a government page, a shop: the long tail that no per-site extractor is ever
 * written for, which between them are most of the web.
 */

import { isFetchable } from './scrape.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_HTML_BYTES = 4 * 1024 * 1024;

/** Containers a plain fetch can actually save. HLS and DASH are manifests, not files. */
const DIRECT = /\.(mp4|webm|m4v|mov|ogv)(\?|#|$)/i;
const MANIFEST = /\.(m3u8|mpd)(\?|#|$)/i;

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null;
}

/** Everything a page declares about itself in <meta>. */
function meta(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const value = attr(tag, 'content');
    if (key && value && !(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Video URLs the page points at, best first.
 *
 * og:video is what the page nominated for a preview, so it is trusted above a <video>
 * element, which on a modern page is as likely to be a muted background loop as the
 * thing anyone came for.
 */
function sources(html, base) {
  const found = [];
  const push = (raw) => {
    if (!raw) return;
    try {
      const abs = new URL(raw, base).href;
      if (!found.includes(abs)) found.push(abs);
    } catch { /* a malformed src is not worth a throw */ }
  };

  const m = meta(html);
  push(m['og:video:secure_url'] || m['og:video:url'] || m['og:video']);
  push(m['twitter:player:stream']);

  // JSON-LD VideoObject, which is what a site that cares about search results provides.
  for (const block of html.match(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    try {
      const stack = [JSON.parse(body)];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) stack.push(...node);
        else if (node && typeof node === 'object') {
          if (typeof node.contentUrl === 'string') push(node.contentUrl);
          if (typeof node.embedUrl === 'string') push(node.embedUrl);
          stack.push(...Object.values(node));
        }
      }
    } catch { /* malformed JSON-LD is extremely common and not our problem */ }
  }

  for (const tag of html.match(/<video\b[^>]*>|<source\b[^>]*>/gi) ?? []) {
    push(attr(tag, 'src') || attr(tag, 'data-src'));
  }

  return found;
}

/**
 * Read a page and report the video it declares, or null.
 *
 * Null rather than a throw: this is one link in a chain, and a link that cannot help
 * should step aside rather than end the request.
 *
 * @returns {Promise<null | {title: string|null, thumbnail: string|null, direct: string[], manifests: string[]}>}
 */
export async function scrapeVideo(url, { timeoutMs = 20_000 } = {}) {
  if (!(await isFetchable(url))) return null;

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let html;
  try {
    const res = await fetch(url, {
      signal: control.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_HTML_BYTES) return null;
    html = buf.toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const all = sources(html, url);
  const direct = all.filter((u) => DIRECT.test(u));
  const manifests = all.filter((u) => MANIFEST.test(u));
  if (!direct.length && !manifests.length) return null;

  const m = meta(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);

  return {
    title: (m['og:title'] || titleTag?.[1] || '').replace(/\s+/g, ' ').trim() || null,
    thumbnail: m['og:image'] || m['twitter:image'] || null,
    direct,
    manifests,
  };
}
