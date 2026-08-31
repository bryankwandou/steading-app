import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  buildInfoArgs, buildDownloadArgs, normalizeInfo, classifyError, findOutputFile,
} from '../server/ytdlp.js';

test('info args are metadata-only', () => {
  const args = buildInfoArgs('https://youtu.be/abc');
  assert.ok(args.includes('--dump-single-json'));
  assert.ok(args.includes('--skip-download'));
  assert.ok(args.includes('--no-playlist'));
});

test('every argv ends with -- followed by the url, so a url can never look like a flag', () => {
  for (const args of [
    buildInfoArgs('--exec=rm -rf /'),
    buildDownloadArgs({ url: '--exec=rm -rf /', format: 'mp4', dir: '/tmp/x' }),
  ]) {
    assert.equal(args.at(-1), '--exec=rm -rf /');
    assert.equal(args.at(-2), '--');
  }
});

test('mp3 args request audio extraction and never a video merge', () => {
  const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'mp3', dir: '/tmp/x' });
  assert.ok(args.includes('--extract-audio'));
  assert.equal(args[args.indexOf('--audio-format') + 1], 'mp3');
  assert.ok(!args.includes('--merge-output-format'));
});

test('every audio format extracts audio, and only the lossy ones set a quality', () => {
  // --audio-quality is a lossy encoder setting. WAV and FLAC ignore it, and passing a
  // flag that cannot apply invites the next reader to believe it does.
  for (const [format, wantsQuality] of [['mp3', true], ['m4a', true], ['opus', true], ['wav', false], ['flac', false]]) {
    const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format, dir: '/tmp/x' });
    assert.ok(args.includes('--extract-audio'), `${format} does not extract audio`);
    assert.equal(args[args.indexOf('--audio-format') + 1], format);
    assert.equal(args.includes('--audio-quality'), wantsQuality, `${format} has the wrong quality flag`);
    assert.ok(!args.includes('--merge-output-format'), `${format} asked for a merge`);
  }
});

test('every video format merges into its own container', () => {
  for (const format of ['mp4', 'mkv', 'webm']) {
    const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format, quality: '720', dir: '/tmp/x' });
    assert.equal(args[args.indexOf('--merge-output-format') + 1], format);

    const selector = args[args.indexOf('--format') + 1];
    // Every branch that names a video stream must carry the cap, or a fallback quietly
    // hands back the 4K copy the user did not ask for.
    for (const branch of selector.split('/')) {
      if (branch === 'bv*+ba' || branch === 'b') continue; // the deliberate last resort
      assert.match(branch, /\[height<=720\]/, `${format}: "${branch}" is missing the cap`);
    }
    assert.ok(!args.includes('--extract-audio'), `${format} asked for audio extraction`);
  }
});

test('image formats fetch no media at all, only the picture that came with it', () => {
  for (const format of ['jpg', 'png', 'webp']) {
    const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format, dir: '/tmp/x' });
    assert.ok(args.includes('--skip-download'), `${format} would download the media`);
    assert.ok(args.includes('--write-thumbnail'));
    // The conversion is ours, not yt-dlp's: --convert-thumbnails fails against ffmpeg 8.
    assert.ok(!args.includes('--convert-thumbnails'), `${format} handed the conversion to yt-dlp`);
    assert.ok(!args.includes('--format'), `${format} sent a stream selector`);
    assert.ok(!args.includes('--extract-audio'));
    assert.ok(!args.includes('--merge-output-format'));
  }
});

test('an unknown format never reaches an argv', () => {
  assert.throws(() => buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'avi', dir: '/tmp/x' }));
});

test('mp4 best does not cap height', () => {
  const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'mp4', quality: 'best', dir: '/tmp/x' });
  const selector = args[args.indexOf('--format') + 1];
  assert.ok(!selector.includes('height'));
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4');
});

test('mp4 with a quality caps height in every fallback branch', () => {
  const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'mp4', quality: '720', dir: '/tmp/x' });
  const selector = args[args.indexOf('--format') + 1];
  const branches = selector.split('/');
  assert.ok(branches.length >= 3);
  // Last branch is the unconditional safety net; every branch before it is capped.
  for (const b of branches.slice(0, -2)) assert.ok(b.includes('[height<=720]'), `uncapped branch: ${b}`);
});

test('output goes to the job dir under a fixed basename', () => {
  const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'mp4', dir: '/tmp/job1' });
  assert.equal(args[args.indexOf('--paths') + 1], '/tmp/job1');
  assert.equal(args[args.indexOf('--output') + 1], 'media.%(ext)s');
});

test('progress template matches what the parser expects', () => {
  const args = buildDownloadArgs({ url: 'https://youtu.be/abc', format: 'mp4', dir: '/tmp/x' });
  const tpl = args[args.indexOf('--progress-template') + 1];
  assert.ok(tpl.startsWith('LZPROG '));
  assert.equal(tpl.split(' ').length, 7);
});

test('normalizeInfo picks the fields the UI needs', () => {
  const info = normalizeInfo({
    title: 'A Song',
    channel: 'Someone',
    duration: 213.7,
    thumbnail: 'https://i.ytimg.com/x.jpg',
    extractor_key: 'Youtube',
    formats: [
      { vcodec: 'avc1', height: 1080 },
      { vcodec: 'avc1', height: 360 },
      { vcodec: 'none', acodec: 'mp4a' },
    ],
  });
  assert.equal(info.title, 'A Song');
  assert.equal(info.uploader, 'Someone');
  assert.equal(info.duration, 214);
  assert.deepEqual(info.qualities, ['best', '1080', '720', '480', '360']);
});

test('normalizeInfo rejects a non-http thumbnail and survives a sparse blob', () => {
  const info = normalizeInfo({ thumbnail: 'javascript:alert(1)' });
  assert.equal(info.thumbnail, null);
  assert.equal(info.title, null);
  assert.deepEqual(info.qualities, ['best']);
});

test('classifyError maps common failures to stable codes', () => {
  assert.equal(classifyError('ERROR: Video unavailable').code, 'content_gone');
  assert.equal(classifyError('ERROR: Private video. Sign in').code, 'private_content');
  assert.equal(classifyError('ERROR: [youtube] socket timed out').code, 'network');
  assert.equal(classifyError('ERROR: not available in your country').code, 'geo_blocked');
  assert.equal(classifyError('ERROR: something nobody predicted').code, 'download_failed');
});

test('classifyError keeps the raw line as detail, stripped of prefixes', () => {
  const { detail } = classifyError('ERROR: [youtube] Video unavailable');
  assert.equal(detail, 'Video unavailable', 'the ERROR: prefix and one [extractor] tag are stripped');
});

test('findOutputFile ignores fragments and part files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-'));
  try {
    for (const name of ['media.f137.mp4', 'media.f140.m4a', 'media.mp4.part', 'media.mp4']) {
      await writeFile(join(dir, name), 'x');
    }
    assert.equal(basename(await findOutputFile(dir, 'mp4')), 'media.mp4');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOutputFile falls back when the extension differs from the request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-'));
  try {
    await writeFile(join(dir, 'media.webm'), 'x');
    assert.equal(basename(await findOutputFile(dir, 'mp4')), 'media.webm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOutputFile throws when nothing usable exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lz-'));
  try {
    await writeFile(join(dir, 'media.mp4.part'), 'x');
    await assert.rejects(() => findOutputFile(dir, 'mp4'), (err) => err.code === 'no_output_file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
