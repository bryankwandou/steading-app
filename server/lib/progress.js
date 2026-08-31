/**
 * Turn yt-dlp's stdout into structured progress events.
 *
 * We drive yt-dlp with an explicit --progress-template (see ytdlp.js) so the hot path
 * is a fixed, machine-readable line rather than the human-facing progress bar, which
 * changes shape between releases. The looser patterns below are a fallback and for the
 * post-processing phases, which do not go through the template.
 */

/** yt-dlp prints the literal string "NA" for values it does not know yet. */
function num(token) {
  if (token === undefined || token === null) return null;
  const t = String(token).trim();
  if (!t || t === 'NA' || t === 'None') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Phases the UI can render. Ordered by when they happen.
 *   extracting  -> resolving the page, picking formats
 *   downloading -> bytes moving
 *   merging     -> ffmpeg muxing video+audio into one mp4
 *   converting  -> ffmpeg encoding to mp3
 *   finishing   -> post-processing tail (thumbnail embed, metadata)
 */
export const PHASES = ['extracting', 'downloading', 'merging', 'converting', 'finishing'];

/**
 * Parse a single line of yt-dlp output.
 * @returns {null | {type:'progress'|'phase'|'destination'|'error', ...}}
 */
export function parseLine(line) {
  if (typeof line !== 'string') return null;
  const text = line.trim();
  if (!text) return null;

  // Our own template: LZPROG <downloaded> <total> <speed> <eta> <fragidx> <fragcount>
  if (text.startsWith('LZPROG')) {
    const [, downloaded, total, speed, eta, fragIndex, fragCount] = text.split(/\s+/);
    const done = num(downloaded);
    const size = num(total);

    let percent = null;
    if (size && size > 0 && done !== null) {
      percent = Math.max(0, Math.min(100, (done / size) * 100));
    } else {
      // Fragmented streams (HLS/DASH) often have no total size, but do report
      // fragment counts, which are a perfectly good progress signal.
      const idx = num(fragIndex);
      const count = num(fragCount);
      if (count && count > 0 && idx !== null) percent = Math.max(0, Math.min(100, (idx / count) * 100));
    }

    return {
      type: 'progress',
      phase: 'downloading',
      percent,
      downloaded: done,
      total: size,
      speed: num(speed),
      eta: num(eta),
    };
  }

  if (text.startsWith('[download] Destination:')) {
    return { type: 'destination', path: text.slice('[download] Destination:'.length).trim() };
  }
  if (text.startsWith('[Merger] Merging formats into')) {
    const m = text.match(/"([^"]+)"/);
    return { type: 'destination', path: m ? m[1] : null, phase: 'merging' };
  }
  if (text.startsWith('[ExtractAudio] Destination:')) {
    return { type: 'destination', path: text.slice('[ExtractAudio] Destination:'.length).trim(), phase: 'converting' };
  }

  if (/^\[(youtube|tiktok|instagram|facebook|generic)/i.test(text)) {
    return { type: 'phase', phase: 'extracting', detail: text };
  }
  if (text.startsWith('[Merger]')) return { type: 'phase', phase: 'merging', detail: text };
  if (text.startsWith('[ExtractAudio]')) return { type: 'phase', phase: 'converting', detail: text };
  if (/^\[(EmbedThumbnail|Metadata|VideoConvertor|FixupM3u8|FixupM4a|Fixup)/i.test(text)) {
    return { type: 'phase', phase: 'finishing', detail: text };
  }

  if (/^ERROR[:\s]/i.test(text)) {
    return { type: 'error', message: text.replace(/^ERROR[:\s]+/i, '').trim() };
  }

  return null;
}

/**
 * Stateful line splitter. yt-dlp output arrives in arbitrary chunks; this keeps the
 * partial tail until its newline shows up. Used once per job.
 */
export function createLineSplitter(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      // \r matters: without --newline yt-dlp redraws progress with carriage returns.
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop() ?? '';
      for (const part of parts) if (part.trim()) onLine(part);
    },
    flush() {
      if (buffer.trim()) onLine(buffer);
      buffer = '';
    },
  };
}

/** Human-readable helpers, shared with the frontend via /api/health? No -- server side only. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
