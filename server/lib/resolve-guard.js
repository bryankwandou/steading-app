/**
 * Refuse an unlisted host that resolves onto this machine's own network.
 *
 * `isPrivateHost()` in validate.js reads the hostname as typed, which stops somebody
 * pasting `http://192.168.1.1/` but not `http://intranet.example.com/` whose DNS answers
 * with 192.168.1.1. That second shape is the one worth caring about over the /live
 * tunnel, where anyone with the link can drive this: a name they control, pointed
 * wherever they like inside the network the app happens to be running in.
 *
 * Separate from validate.js on purpose. That module is synchronous and shared with the
 * browser, where no DNS resolver exists; this needs `await` and Node. Keeping them apart
 * means the browser copy stays a pure function and the two cannot drift into pretending
 * to offer the same guarantee.
 *
 * What this does NOT close, and should not be described as closing:
 *
 *   - **Redirects.** yt-dlp follows them, and a public host may redirect to a private
 *     one. Only the address typed in is resolved here.
 *   - **The gap between checking and fetching.** DNS can change in between, and yt-dlp
 *     resolves the name again for itself. Closing that means pinning the address and
 *     handing yt-dlp the IP, which it has no clean way to accept.
 *
 * So this raises the cost of the attack rather than removing it. Worth having, worth
 * being accurate about.
 */

import { lookup } from 'node:dns/promises';
import { isPrivateHost } from './validate.js';

/**
 * @param {string} hostname
 * @returns {Promise<boolean>} true when the name points anywhere on a private network,
 *   and true as well when it cannot be resolved at all -- an address that does not
 *   answer is not one worth spawning a subprocess for.
 */
export async function resolvesPrivately(hostname) {
  // A literal address was already judged by isPrivateHost(); resolving it says nothing new.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return isPrivateHost(hostname);
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return true;
  }

  if (!addresses.length) return true;

  // Every answer has to be public. One private address among several is enough to
  // refuse: a resolver handing back both is exactly how this gets smuggled through.
  return addresses.some(({ address }) => isPrivateHost(address));
}
