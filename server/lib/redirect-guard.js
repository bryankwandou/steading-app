/**
 * Walk an unlisted link's redirects before anything is spawned for it.
 *
 * resolve-guard.js settles where the *typed* name points. It says nothing about where
 * that name sends you next: a perfectly ordinary public host can answer 302 with
 * `Location: http://192.168.1.1/`, and yt-dlp follows redirects, so the fetch lands
 * inside the network anyway. Over the /live tunnel that is a redirect somebody else
 * controls, aimed wherever they like.
 *
 * So each hop is checked the same way the first one was -- by name and by resolution --
 * before the URL is handed on.
 *
 * **This is advisory, and the reason matters.** yt-dlp makes its own requests and follows
 * its own redirects; nothing here can make it use the chain walked below. A server that
 * answers differently the second time still wins. What this removes is the plain case: a
 * link that reliably redirects inward is refused instead of fetched.
 *
 * A pre-flight that cannot complete does **not** refuse the download. Plenty of ordinary
 * sites reject HEAD, rate-limit, or simply time out, and turning every one of those into
 * a failed download would trade a large, certain loss for a small, uncertain gain. The
 * typed hostname has already been checked by then; this is the layer on top.
 */

import { resolvesPrivately } from './resolve-guard.js';
import { isPrivateHost } from './validate.js';

/** Enough to catch a chain, few enough that a redirect loop cannot stall a request. */
const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 6000;

/**
 * @param {string} startUrl
 * @returns {Promise<boolean>} true when some hop lands on a private address, and false
 *   both when the chain is clean and when it could not be walked at all.
 */
export async function redirectsInward(startUrl) {
  let current = startUrl;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
        headers: {
          // Some hosts answer 403 to an unadorned client and 3xx to a browser-shaped
          // one. The point is to see the redirect they would really serve.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        },
      });
    } catch {
      return false; // could not look; the typed host was already checked
    }

    if (res.status < 300 || res.status >= 400) return false; // chain ended, nothing inward

    const location = res.headers.get('location');
    if (!location) return false;

    let next;
    try {
      next = new URL(location, current); // Location may be relative
    } catch {
      return false;
    }

    // A redirect out of http(s) is not something to follow or to allow.
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return true;

    if (isPrivateHost(next.hostname)) return true;
    if (await resolvesPrivately(next.hostname)) return true;

    current = next.toString();
  }

  // Ran out of hops. A chain this long is not worth trusting either way, but refusing
  // legitimate long chains would cost more than it buys.
  return false;
}
