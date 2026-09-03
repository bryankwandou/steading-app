import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrl, validateFormat, validateQuality, validateJobId, safeFilename,
  SUPPORTED_PLATFORMS, FORMAT_KINDS, FORMATS,
} from '../server/lib/validate.js';

test('accepts a link from every supported platform', () => {
  // One link per platform, so adding a row to the table without teaching the validator
  // about its hosts fails here rather than in front of a user.
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://music.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.tiktok.com/@user/video/123', 'tiktok'],
    ['https://vt.tiktok.com/ZSabc/', 'tiktok'],
    ['https://www.instagram.com/reel/Cabc/', 'instagram'],
    ['https://www.facebook.com/watch/?v=123', 'facebook'],
    ['https://fb.watch/abc/', 'facebook'],
    ['https://www.twitch.tv/videos/123', 'twitch'],
    ['https://clips.twitch.tv/AbcDef', 'twitch'],
    ['https://vimeo.com/123456', 'vimeo'],
    ['https://www.dailymotion.com/video/x8abc', 'dailymotion'],
    ['https://dai.ly/x8abc', 'dailymotion'],
    ['https://www.reddit.com/r/videos/comments/abc/x/', 'reddit'],
    ['https://v.redd.it/abc123', 'reddit'],
    ['https://www.pinterest.com/pin/123/', 'pinterest'],
    ['https://pin.it/abc', 'pinterest'],
    ['https://www.snapchat.com/spotlight/abc', 'snapchat'],
    ['https://bsky.app/profile/a.bsky.social/post/abc', 'bluesky'],
    ['https://example.tumblr.com/post/123', 'tumblr'],
    ['https://t.me/channel/123', 'telegram'],
    ['https://vk.com/video-1_2', 'vk'],
    ['https://vkvideo.ru/video-1_2', 'vk'],
    ['https://weibo.com/1234/ABCdef', 'weibo'],
    ['https://www.xiaohongshu.com/explore/abc', 'xiaohongshu'],
    ['https://xhslink.com/abc', 'xiaohongshu'],
    ['https://www.bilibili.com/video/BV1abc', 'bilibili'],
    ['https://b23.tv/abc', 'bilibili'],
    ['https://kick.com/someone/videos/abc', 'kick'],
    ['https://odysee.com/@channel/video', 'odysee'],
    ['https://rumble.com/v6r1abc-a-video.html', 'rumble'],
    ['https://soundcloud.com/artist/track', 'soundcloud'],
    ['https://artist.bandcamp.com/track/name', 'bandcamp'],
    ['https://www.mixcloud.com/user/show/', 'mixcloud'],
  ];
  for (const [url, platform] of cases) {
    const r = validateUrl(url);
    assert.equal(r.ok, true, `expected ${url} to pass`);
    assert.equal(r.platform, platform);
  }

  const covered = new Set(cases.map(([, platform]) => platform));
  assert.deepEqual(
    SUPPORTED_PLATFORMS.map((p) => p.id).filter((id) => !covered.has(id)), [],
    'every platform in the table needs a link in this test',
  );
});

test('audio-only sites are flagged as such, and only those', () => {
  const audio = SUPPORTED_PLATFORMS.filter((p) => p.audio).map((p) => p.id);
  assert.deepEqual(audio, ['soundcloud', 'bandcamp', 'mixcloud']);

  assert.equal(validateUrl('https://soundcloud.com/artist/track').audioOnly, true);
  assert.equal(validateUrl('https://youtu.be/abc').audioOnly, false);
});

test('a site we recognise but do not support is named rather than shrugged at', () => {
  for (const [url, label] of [['https://x.com/a/status/1', 'X'], ['https://www.threads.net/@a/post/1', 'Threads']]) {
    const r = validateUrl(url);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'url_site_locked');
    assert.equal(r.detail, label, 'the detail carries the site name for the message');
  }
});

test('universal mode is off unless asked for, and never unlocks a locked site', () => {
  const unlisted = 'https://example.com/v/1';

  assert.equal(validateUrl(unlisted).ok, false, 'the allowlist is the default');
  assert.equal(validateUrl(unlisted).code, 'url_unsupported_site');

  const anySite = validateUrl(unlisted, { universal: true });
  assert.equal(anySite.ok, true);
  assert.equal(anySite.platform, 'other');
  assert.equal(anySite.platformLabel, 'example.com', 'the label is the parsed hostname');
  assert.equal(anySite.audioOnly, false);

  // Universal means "any site", not "any string": every check that runs before the
  // allowlist still runs, so the shape of a URL is policed exactly as before.
  const refused = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com/x',
    '',
    'https://example.com/a\u0000b',
    `https://example.com/${'x'.repeat(3000)}`,
  ];
  for (const value of refused) {
    assert.equal(
      validateUrl(value, { universal: true }).ok, false,
      `universal mode let through ${JSON.stringify(value).slice(0, 40)}`,
    );
  }

  // A site we already know cannot work stays named rather than being tried anyway.
  const locked = validateUrl('https://x.com/a/status/1', { universal: true });
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'url_site_locked');
});

test('a listed site keeps its own label and flags in universal mode', () => {
  const r = validateUrl('https://soundcloud.com/a/b', { universal: true });
  assert.equal(r.platform, 'soundcloud');
  assert.equal(r.platformLabel, 'SoundCloud');
  assert.equal(r.audioOnly, true, 'the table still wins over the fallback');
});

test('assumes https for a scheme-less paste', () => {
  const r = validateUrl('youtube.com/watch?v=abc');
  assert.equal(r.ok, true);
  assert.match(r.url, /^https:\/\//);
});

test('rejects unsupported hosts', () => {
  for (const url of ['https://example.com/v/1', 'https://evil.test/123', 'https://notyoutube.com/x']) {
    assert.equal(validateUrl(url).ok, false, `expected ${url} to fail`);
  }
});

test('rejects a lookalike host that merely contains a supported name', () => {
  assert.equal(validateUrl('https://youtube.com.evil.tld/watch?v=1').ok, false);
  assert.equal(validateUrl('https://t.me.evil.tld/channel/1').ok, false);
  assert.equal(validateUrl('https://notsoundcloud.com/a/b').ok, false);
});

test('accepts a genuine subdomain', () => {
  assert.equal(validateUrl('https://m.youtube.com/watch?v=1').ok, true);
});

test('rejects non-http schemes and junk', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://youtube.com/x', 'javascript:alert(1)', '', '   ', null, 42]) {
    assert.equal(validateUrl(bad).ok, false, `expected ${String(bad)} to fail`);
  }
});

test('rejects control characters', () => {
  assert.equal(validateUrl('https://youtube.com/watch?v=a\nb').ok, false);
});

test('strips credentials and fragment', () => {
  const r = validateUrl('https://user:pw@youtube.com/watch?v=abc#frag');
  assert.equal(r.ok, true);
  assert.ok(!r.url.includes('user'));
  assert.ok(!r.url.includes('#frag'));
});

test('format validation reports the kind as well as the id', () => {
  assert.equal(validateFormat('mp4').format, 'mp4');
  assert.equal(validateFormat('MP3').format, 'mp3', 'case is normalized');
  assert.equal(validateFormat(' flac ').format, 'flac', 'surrounding space is trimmed');

  assert.equal(validateFormat('mkv').kind, 'video');
  assert.equal(validateFormat('wav').kind, 'audio');
  assert.equal(validateFormat('png').kind, 'image');
  assert.equal(validateFormat('mp4').mime, 'video/mp4');

  for (const bad of ['avi', 'exe', '', undefined, null, 7, '../mp4']) {
    assert.equal(validateFormat(bad).ok, false, `expected ${String(bad)} to be refused`);
  }
});

test('every offered format is one the validator accepts', () => {
  // FORMAT_KINDS is what /api/health publishes and what the UI builds its controls
  // from, so an id that appears there and is refused here would be an option that
  // cannot be chosen.
  const offered = FORMAT_KINDS.flatMap((g) => g.formats);
  assert.deepEqual([...offered].sort(), [...FORMATS].sort());

  for (const group of FORMAT_KINDS) {
    for (const id of group.formats) {
      const r = validateFormat(id);
      assert.equal(r.ok, true, `${id} is offered but refused`);
      assert.equal(r.kind, group.kind, `${id} is listed under the wrong kind`);
    }
  }
});

test('a format id is also its file extension', () => {
  // safeFilename(title, format) and findOutputFile(dir, format) both assume this.
  for (const id of FORMATS) {
    assert.ok(safeFilename('clip', id).endsWith(`.${id}`), `${id} does not survive as an extension`);
  }
});

test('quality validation defaults to best', () => {
  assert.equal(validateQuality(undefined).quality, 'best');
  assert.equal(validateQuality('720').quality, '720');
  assert.equal(validateQuality('4320').ok, false);
});

test('job id validation', () => {
  assert.equal(validateJobId('0123456789abcdef').ok, true);
  assert.equal(validateJobId('../../etc/passwd').ok, false);
  assert.equal(validateJobId('0123456789ABCDEF').ok, false);
  assert.equal(validateJobId('short').ok, false);
});

test('safeFilename strips path and reserved characters', () => {
  assert.equal(safeFilename('a/b\\c:d*e', 'mp4'), 'a b c d e.mp4');
  assert.equal(safeFilename('../../etc/passwd', 'mp3'), 'etc passwd.mp3');
  assert.equal(safeFilename('', 'mp4'), 'steading.mp4');
  assert.equal(safeFilename('   ...   ', 'mp4'), 'steading.mp4');
  assert.ok(safeFilename('x'.repeat(500), 'mp4').length <= 125);
});

test('universal mode never reaches the machine own network', () => {
  // With an allowlist the question never arose: only two dozen public video sites ever
  // reached yt-dlp. Universal mode removes that, and over the /live tunnel the app is
  // reachable by anyone with the link -- so an unguarded universal mode is a way for a
  // stranger to fetch whatever is listening inside the presenter's network.
  const internal = [
    'http://127.0.0.1:8080/x',
    'http://localhost/x',
    'http://192.168.1.1/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://169.254.169.254/latest/meta-data/',   // cloud metadata
    'http://[::1]/x',
    'http://router/',                              // single label: intranet name
    'http://nas.local/',
    'http://100.64.0.1/',                          // carrier-grade NAT
    'http://0.0.0.0/',
  ];

  for (const url of internal) {
    const r = validateUrl(url, { universal: true });
    assert.equal(r.ok, false, `universal mode accepted an internal address: ${url}`);
  }

  // And the point of universal mode still works.
  for (const url of ['https://some-unlisted-site.example/video', 'https://vimeo.com/123']) {
    assert.equal(validateUrl(url, { universal: true }).ok, true, `universal mode rejected ${url}`);
  }
});

test('a public name that resolves onto the local network is refused', async () => {
  // isPrivateHost() reads the hostname as typed, so it stops "192.168.1.1" and misses
  // "192.168.1.1.nip.io" -- an ordinary public name whose DNS answers with that same
  // private address. Over the /live tunnel that is the shape that matters: a name the
  // visitor controls, pointed wherever they like inside the network this runs in.
  const { resolvesPrivately } = await import('../server/lib/resolve-guard.js');
  const { isPrivateHost } = await import('../server/lib/validate.js');

  // The name itself looks entirely unremarkable.
  assert.equal(isPrivateHost('192.168.1.1.nip.io'), false,
    'the name alone should not look private -- that is the whole point');

  // Resolution is what gives it away. Skipped rather than failed when there is no DNS:
  // a machine with no network must not turn this into a red suite.
  let reachable = true;
  try {
    const { lookup } = await import('node:dns/promises');
    await lookup('archive.org');
  } catch {
    reachable = false;
  }
  if (!reachable) return;

  for (const host of ['192.168.1.1.nip.io', '127.0.0.1.nip.io', '10.0.0.1.nip.io']) {
    assert.equal(await resolvesPrivately(host), true, `${host} resolves privately and must be refused`);
  }

  // And a genuine public host still gets through.
  assert.equal(await resolvesPrivately('archive.org'), false, 'archive.org should be allowed');

  // A name that does not resolve at all is not worth spawning a subprocess for.
  assert.equal(await resolvesPrivately('definitely-not-a-real-host-9x8y7z.invalid'), true);
});

test('a redirect that lands on the local network is refused', async () => {
  // resolve-guard settles where the typed name points; it says nothing about where that
  // name forwards to. A public host can answer 302 with Location: http://192.168.1.1/,
  // and yt-dlp follows redirects, so the fetch would land inside the network anyway.
  //
  // The test brings its own redirector rather than reaching for one on the internet: a
  // suite that fails when a third party is down is a suite people learn to ignore.
  const { redirectsInward } = await import('../server/lib/redirect-guard.js');
  const { createServer } = await import('node:http');

  const TARGETS = {
    '/to-lan': 'http://192.168.1.1/admin',
    '/to-loopback': 'http://127.0.0.1:9/secret',
    '/to-metadata': 'http://169.254.169.254/latest/meta-data/',
    '/to-scheme': 'file:///etc/passwd',
    '/chain': '/to-lan',
    '/to-public': 'https://example.com/',
  };

  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (TARGETS[path]) {
      res.writeHead(302, { Location: TARGETS[path] });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html></html>');
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const path of ['/to-lan', '/to-loopback', '/to-metadata', '/to-scheme', '/chain']) {
      assert.equal(await redirectsInward(`${base}${path}`), true,
        `${path} forwards inward and must be refused`);
    }

    // A redirect to somewhere genuinely public is not the thing being stopped, and a
    // page that does not redirect at all must pass untouched.
    assert.equal(await redirectsInward(`${base}/plain`), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
