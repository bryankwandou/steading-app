/** Thin wrapper over the local API. Nothing here knows about the DOM or about wording. */

/**
 * Failures carry the server's error *code*, not its prose. The UI translates it.
 * `message` is set to the English fallback purely so a thrown error is readable in the
 * console; nothing renders it.
 */
export class ApiError extends Error {
  constructor({ code, detail = null, status = 0, message }) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.code = code || null;
    this.detail = detail;
    this.status = status;
  }
}

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // The local server went away mid-request; there is no HTTP status to report.
    throw new ApiError({ code: 'server_error', status: 0 });
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }

  if (!res.ok) {
    throw new ApiError({
      code: data?.code,
      detail: data?.detail ?? null,
      status: res.status,
      message: data?.error,
    });
  }
  return data;
}

export const api = {
  health: () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()),

  info: (url) => postJson('/api/info', { url }),

  createJob: ({ url, format, quality, title }) => postJson('/api/jobs', { url, format, quality, title }),

  cancel: (id) => fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => {}),

  fileUrl: (id) => `/api/jobs/${id}/file`,

  /**
   * Subscribe to a job's progress.
   *
   * SSE is the fast path and the only one used on a plain local connection. But this
   * server is sometimes reached through a tunnel, and several proxies -- Cloudflare
   * among them -- buffer `text/event-stream` instead of forwarding each frame. The
   * download still runs; the browser just never hears about it, and the user watches a
   * progress bar that never moves.
   *
   * So a watchdog runs alongside: if no frame arrives for a few seconds while the job
   * is still going, the stream is abandoned and the same job is polled instead. Polling
   * is plain GETs, which nothing buffers.
   *
   * @returns {() => void} unsubscribe -- closing the stream is what tells the server
   *          the client is gone, so callers must always call it.
   */
  watch(id, { onUpdate, onReady, onFailed }) {
    const SILENCE_MS = 5000;
    const POLL_MS = 1000;

    let stopped = false;
    let source = null;
    let poller = null;
    let watchdog = null;
    let lastFrameAt = Date.now();

    const stop = () => {
      stopped = true;
      clearInterval(watchdog);
      clearInterval(poller);
      source?.close();
      source = null;
    };

    // Terminal states must fire exactly once, whichever transport saw them first.
    const settle = (handler, job) => {
      if (stopped) return;
      stop();
      handler(job);
    };

    const route = (job) => {
      if (stopped) return;
      lastFrameAt = Date.now();
      if (job.state === 'ready') return settle(onReady, job);
      if (job.state === 'error' || job.state === 'canceled') return settle(onFailed, job);
      onUpdate(job);
    };

    const startPolling = () => {
      if (poller || stopped) return;
      source?.close();
      source = null;
      poller = setInterval(async () => {
        if (stopped) return;
        try {
          const res = await fetch(`/api/jobs/${id}`, { cache: 'no-store' });
          if (res.status === 404) return settle(onFailed, { code: 'job_not_found' });
          route(await res.json());
        } catch { /* transient -- the next tick retries */ }
      }, POLL_MS);
    };

    const parse = (handler) => (event) => {
      lastFrameAt = Date.now();
      let data;
      try { data = JSON.parse(event.data); } catch { return; /* malformed frame */ }
      handler(data);
    };

    source = new EventSource(`/api/jobs/${id}/events`);
    source.addEventListener('update', parse(onUpdate));
    source.addEventListener('ready', parse((job) => settle(onReady, job)));
    // 'failed' covers error and cancel. 'done' arrives only after the file has already
    // been handed over, so there is nothing left for the UI to do with it.
    source.addEventListener('failed', parse((job) => settle(onFailed, job)));

    // EventSource retries on its own; the server's grace window is sized for that.
    source.onerror = () => { /* transient -- let it reconnect */ };

    watchdog = setInterval(() => {
      if (!stopped && !poller && Date.now() - lastFrameAt > SILENCE_MS) startPolling();
    }, 1000);

    return stop;
  },
};
