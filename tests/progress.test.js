import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, createLineSplitter, formatBytes } from '../server/lib/progress.js';

test('parses a full progress line', () => {
  const r = parseLine('LZPROG 5242880 10485760 1048576 5 NA NA');
  assert.equal(r.type, 'progress');
  assert.equal(r.phase, 'downloading');
  assert.equal(r.percent, 50);
  assert.equal(r.downloaded, 5242880);
  assert.equal(r.total, 10485760);
  assert.equal(r.speed, 1048576);
  assert.equal(r.eta, 5);
});

test('handles NA totals by falling back to fragment counts', () => {
  const r = parseLine('LZPROG 1000 NA NA NA 3 12');
  assert.equal(r.type, 'progress');
  assert.equal(r.total, null);
  assert.equal(r.percent, 25);
});

test('percent is null when neither size nor fragments are known', () => {
  const r = parseLine('LZPROG 1000 NA NA NA NA NA');
  assert.equal(r.percent, null);
  assert.equal(r.downloaded, 1000);
});

test('percent never leaves 0..100', () => {
  assert.equal(parseLine('LZPROG 20 10 NA NA NA NA').percent, 100);
});

test('detects destinations for each phase', () => {
  assert.equal(parseLine('[download] Destination: /tmp/x/video.f137.mp4').path, '/tmp/x/video.f137.mp4');
  assert.equal(parseLine('[Merger] Merging formats into "/tmp/x/video.mp4"').path, '/tmp/x/video.mp4');
  assert.equal(parseLine('[ExtractAudio] Destination: /tmp/x/audio.mp3').phase, 'converting');
});

test('detects phases', () => {
  assert.equal(parseLine('[youtube] dQw4w9WgXcQ: Downloading webpage').phase, 'extracting');
  assert.equal(parseLine('[tiktok] 123: Downloading API JSON').phase, 'extracting');
  assert.equal(parseLine('[EmbedThumbnail] mp3 ok').phase, 'finishing');
});

test('detects errors', () => {
  const r = parseLine('ERROR: Video unavailable');
  assert.equal(r.type, 'error');
  assert.equal(r.message, 'Video unavailable');
});

test('ignores noise', () => {
  for (const line of ['', '   ', 'random chatter', null, undefined]) {
    assert.equal(parseLine(line), null);
  }
});

test('line splitter buffers partial chunks', () => {
  const seen = [];
  const s = createLineSplitter((l) => seen.push(l));
  s.push('LZPROG 1 2 3 4 NA NA\nLZPR');
  assert.deepEqual(seen, ['LZPROG 1 2 3 4 NA NA']);
  s.push('OG 5 6 7 8 NA NA\n');
  assert.equal(seen.length, 2);
  assert.equal(seen[1], 'LZPROG 5 6 7 8 NA NA');
});

test('line splitter handles carriage returns and flush', () => {
  const seen = [];
  const s = createLineSplitter((l) => seen.push(l));
  s.push('a\rb\r\nc');
  assert.deepEqual(seen, ['a', 'b']);
  s.flush();
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
  assert.equal(formatBytes(null), null);
});
