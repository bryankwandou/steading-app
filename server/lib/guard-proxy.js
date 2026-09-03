/**
 * A loopback proxy that refuses to connect anywhere private.
 *
 * The checks in resolve-guard.js and redirect-guard.js both share one weakness they
 * cannot fix from where they stand: they look, and then yt-dlp goes and looks again for
 * itself. Between those two moments a resolver can answer differently, and every guard
 * upstream is bypassed. That gap is not closable by checking harder -- only by making
 * the check and the connection the same act.
 *
 * So yt-dlp is pointed at this, and this is what actually opens the socket. It resolves
 * the name, refuses every private answer, and then connects **to the address it just
 * resolved** rather than to the name. There is no second lookup to poison, and because
 * every hop of a redirect comes back through here as a fresh request or CONNECT, the
 * chain is enforced too rather than merely inspected.
 *
 * TLS is untouched. An https target arrives as CONNECT and this pipes bytes without
 * reading them, so certificates are still checked end to end by yt-dlp against the real
 * hostname. This never becomes a man in the middle; it is a gate on where the tunnel is
 * allowed to terminate.
 *
 * Bound to 127.0.0.1 on an ephemeral port, started on first use and shared. It carries
 * no credentials and proxies nothing it was not asked for.
 */

import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isPrivateHost } from './validate.js';

/** Resolve a name and hand back an address only if every answer is public. */
async function safeAddress(hostname) {
  if (isPrivateHost(hostname)) return null;

  // A literal address needs no lookup; isPrivateHost already judged it.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return { address: hostname, family: hostname.includes(':') ? 6 : 4 };
  }

  let answers;
  try {
    answers = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }

  // One private answer among several is enough to refuse: a resolver returning both is
  // exactly how this gets smuggled past a check that only reads the first.
  if (!answers.length || answers.some((a) => isPrivateHost(a.address))) return null;

  return answers[0];
}

let server = null;
let starting = null;

/**
 * @returns {Promise<string>} the proxy URL to hand to yt-dlp, e.g. http://127.0.0.1:53219
 */
export function guardProxyUrl() {
  if (server) return Promise.resolve(`http://127.0.0.1:${server.address().port}`);
  if (starting) return starting;

  starting = new Promise((resolvePromise, rejectPromise) => {
    const proxy = createServer();

    // Plain http. The absolute-form request line carries the target.
    proxy.on('request', async (req, res) => {
      let target;
      try {
        target = new URL(req.url);
      } catch {
        res.writeHead(400).end();
        return;
      }

      const picked = await safeAddress(target.hostname);
      if (!picked) {
        res.writeHead(403).end();
        return;
      }

      const upstream = httpRequest({
        host: picked.address,          // the address, not the name: no second lookup
        port: Number(target.port) || 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...req.headers, host: target.host },
        setHost: false,
      }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      });

      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(upstream);
    });

    // https, and anything else tunnelled. The hostname is in the CONNECT line; the
    // bytes after it are opaque, which is what keeps TLS end to end.
    proxy.on('connect', async (req, clientSocket, head) => {
      const [rawHost, rawPort] = req.url.split(':');
      const picked = await safeAddress(rawHost);
      if (!picked) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }

      const upstream = netConnect(Number(rawPort) || 443, picked.address, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });

      const drop = () => { try { upstream.destroy(); } catch { /* already gone */ } try { clientSocket.destroy(); } catch { /* already gone */ } };
      upstream.on('error', drop);
      clientSocket.on('error', drop);
    });

    proxy.on('error', rejectPromise);

    proxy.listen(0, '127.0.0.1', () => {
      server = proxy;
      proxy.unref();   // never the reason the process stays alive
      resolvePromise(`http://127.0.0.1:${proxy.address().port}`);
    });
  });

  return starting;
}

/** For tests, and for a clean shutdown. */
export function stopGuardProxy() {
  const running = server;
  server = null;
  starting = null;
  return new Promise((r) => (running ? running.close(r) : r()));
}

export { safeAddress };
