/**
 * What "universal" is actually worth, measured.
 *
 * Run:  npm run universal   (in another terminal)
 *       node scripts/coverage.mjs
 *
 * A list of sites the author picked is not evidence of universality -- it is evidence
 * that those sites work. The only figure that means anything is the hit rate on links
 * nobody picked for their chances, which is why two links here are expected to be
 * refused and one is a site with no per-site extractor written for it at all.
 *
 * Getting this measurement honest took four attempts, and each failure is worth knowing
 * about because they are the ways this kind of number gets inflated:
 *
 *   1. Counting any answer with a title. Every fallback returns the address as a title,
 *      so Vimeo passed as "76979871" and Douyin passed as "douyin.com" while sitting in
 *      the dropped list. That scored 89%.
 *   2. Demanding a video track. Audio has none, so SoundCloud returning the extractor
 *      "Soundcloud" and the title "Flickermood" was scored a failure. That scored 5%.
 *   3. Testing homepages. Whether a downloader can fetch nasa.gov is not a question
 *      about downloading.
 *   4. Inventing link ids. twitch.tv/videos/2000000000 does not exist, and a link that
 *      cannot succeed measures nothing except the typing.
 *
 * What counts as success here: yt-dlp named the site, and the title is not simply the
 * address echoed back. Anything reached only by the zero-dependency page scraper is
 * counted separately as partial, because that link in the chain is what carries the
 * claim to reach beyond any list -- and it should be visible on its own.
 */

const LINKS = [
  ['YouTube',       'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['YouTube 2005',  'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
  ['Vimeo',         'https://vimeo.com/76979871'],
  ['SoundCloud',    'https://soundcloud.com/forss/flickermood'],
  ['Bandcamp',      'https://boc.bandcamp.com/track/dayvan-cowboy'],
  ['Archive.org',   'https://archive.org/details/BigBuckBunny_124'],
  ['TED',           'https://www.ted.com/talks/bill_gates_the_next_outbreak_we_re_not_ready'],
  ['Wikimedia',     'https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_medium.ogv'],
  ['w3schools',     'https://www.w3schools.com/html/html5_video.asp'],
  ['Wikipedia',     'https://en.wikipedia.org/wiki/Video'],
  ['X',             'https://x.com/i/status/1'],
  ['Threads',       'https://www.threads.com/share/BAX_vtFNGa/'],
];

const results = [];

for (const [name, url] of LINKS) {
  const started = Date.now();
  let outcome, detail = '';
  try {
    const res = await fetch('http://127.0.0.1:3000/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(90_000),
    });
    const j = await res.json();
    // A title is not a success. The first version of this counted any answer with a
    // title, and every fallback that returns the URL slug as a title passed -- Vimeo
    // came back as "76979871", NASA as "nasa.gov", and Douyin as "douyin.com" while
    // sitting in the dropped list. That produced 89%, which would have been a lie the
    // moment anyone clicked one.
    //
    // Media, or it did not work: a video track, a named extractor that is not the
    // generic fallback, or pictures to fetch.
    const slug = decodeURIComponent(url).replace(/\/$/, '').split('/').pop().split('?')[0];
    const named = !!j.extractor && !/^(generic|page)$/i.test(j.extractor);
    // A title equal to the address is the fallback speaking, not an extraction.
    const realTitle = j.title && j.title !== slug && j.title !== new URL(url).hostname.replace(/^www\./, '');

    if (res.ok && named && realTitle) {
      outcome = 'reached';
      detail = `${j.extractor} · "${String(j.title).slice(0, 30)}"`;
    } else if (res.ok && (j.hasVideo || (j.images || []).length)) {
      outcome = 'partial';
      detail = `${j.extractor || 'fallback'} · media, no named extractor`;
    } else if (res.ok) {
      outcome = 'thin';
      detail = `${j.extractor || '-'} · title only: "${String(j.title || '').slice(0, 24)}"`;
    } else {
      outcome = 'refused';
      detail = j.code || `${res.status}`;
    }
  } catch (e) {
    outcome = 'refused';
    detail = e.name === 'TimeoutError' ? 'timed out' : e.message.slice(0, 30);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ name, outcome });
  const label = { reached: 'MEDIA  ', partial: 'partial', thin: 'thin   ', refused: 'refused' }[outcome];
  console.log(`  ${label}  ${name.padEnd(14)} ${secs.padStart(5)}s  ${detail}`);
}

const reached = results.filter((r) => r.outcome === 'reached').length;
console.log(`\n  ${reached} of ${results.length} links answered  (${Math.round(100 * reached / results.length)}%)`);
