/**
 * Steading UI. One module, one state object, no framework.
 *
 * No string in this file is user-facing prose. Anything the user reads comes from
 * i18n.js, and every message the UI is currently showing is stored in `state.message`
 * as {key, vars} rather than as rendered text -- otherwise switching language mid-error
 * would leave the old language frozen on screen.
 */

import { api, ApiError } from './api.js';
import {
  LANGUAGES, t, tError, setLanguage, detectLanguage, getLanguage, onLanguageChange, applyStatic,
} from './i18n.js';
import { initTheme, toggleTheme, resolvedTheme, onThemeChange } from './theme.js';

const $ = (id) => document.getElementById(id);

const el = {
  form: $('url-form'),
  url: $('url'),
  paste: $('paste'),
  fetchBtn: $('fetch'),
  lang: $('lang'),
  theme: $('theme'),
  preview: $('preview'),
  thumbWrap: $('thumb-wrap'),
  thumb: $('thumb'),
  title: $('title'),
  submeta: $('submeta'),
  seg: $('seg'),
  segButtons: document.querySelectorAll('.seg-btn'),
  typeWrap: $('type-wrap'),
  type: $('type'),
  qualityWrap: $('quality-wrap'),
  pictureWrap: $('picture-wrap'),
  picture: $('picture'),
  pictureNow: $('picture-now'),
  quality: $('quality'),
  download: $('download'),
  progress: $('progress'),
  phase: $('phase'),
  percent: $('percent'),
  bar: document.querySelector('.bar'),
  barFill: $('bar-fill'),
  stats: $('stats'),
  cancel: $('cancel'),
  message: $('message'),
  dot: $('server-status'),
  serverText: $('server-text'),
  supports: $('supports'),
  supportsText: $('supports-text'),
  supportsToggle: $('supports-toggle'),
  supportsChecked: $('supports-checked'),
};

const state = {
  info: null,
  /** 'video' | 'audio' | 'image' -- which segment is selected. */
  kind: 'video',
  /** The chosen format id within each kind, so switching back restores the last pick. */
  chosen: { video: 'mp4', audio: 'mp3', image: 'jpg' },
  quality: 'best',
  // Where the picture slider sits. Defaults to the best step rather than the middle:
  // quietly degrading a picture nobody asked to degrade is the wrong way round, and
  // moving left is one gesture.
  picture: 'original',
  jobId: null,
  unwatch: null,
  /** @type {{key: string, vars?: object, kind: string}|null} */
  message: null,
  /** Last progress frame, replayed on a language change. */
  lastProgress: null,
  /** Last health result, replayed on a language change. */
  health: undefined,
  /** True while a download is starting or running, so labels re-render correctly. */
  downloading: false,
  checking: false,
  /** Whether the "works with" line is showing every site or only the first few. */
  supportsExpanded: false,
};

const EM_DASH = '—';

/* ------------------------------------------------------------------ helpers */

function bytes(n) {
  if (!Number.isFinite(n)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Show a message by key, remembering it so a language switch can re-render it. */
function say(key, { vars, kind = '' } = {}) {
  state.message = key ? { key, vars, kind } : null;
  paintMessage();
}

/** Show a message that is already a finished string (a translated server error). */
function sayText(text, kind = '') {
  state.message = text ? { text, kind } : null;
  paintMessage();
}

function paintMessage() {
  const m = state.message;
  if (!m) {
    el.message.hidden = true;
    el.message.textContent = '';
    el.message.className = 'message';
    return;
  }
  el.message.textContent = m.text ?? t(m.key, m.vars);
  el.message.className = `message${m.kind ? ` is-${m.kind}` : ''}`;
  el.message.hidden = false;
}

function clearMessage() { say(''); }

/** Render an ApiError in the current language. */
function sayApiError(err) {
  if (err instanceof ApiError && err.code) return sayText(tError(err.code, err.detail), 'error');
  if (err instanceof ApiError && err.status) return say('error.http', { vars: { status: err.status }, kind: 'error' });
  sayText(tError('server_error'), 'error');
}

function busy(button, isBusy, key) {
  button.disabled = isBusy;
  if (key) button.textContent = t(key);
}

/* --------------------------------------------------------------------- chrome */

function buildLanguageMenu() {
  const fragment = document.createDocumentFragment();
  for (const { code, name } of LANGUAGES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name; // endonym, deliberately not translated
    fragment.append(option);
  }
  el.lang.replaceChildren(fragment);
}

el.lang.addEventListener('change', () => { setLanguage(el.lang.value); });

el.theme.addEventListener('click', () => {
  toggleTheme();
  paintThemeLabel();
});

/** The label describes what the button will do next, not what is showing now. */
function paintThemeLabel() {
  const next = resolvedTheme() === 'dark' ? 'nav.theme.light' : 'nav.theme.dark';
  el.theme.setAttribute('aria-label', t(next));
  el.theme.setAttribute('title', t(next));
}

onThemeChange(paintThemeLabel);

/* -------------------------------------------------------------------- step 1 */

el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      el.url.value = text.trim();
      el.url.focus();
    }
  } catch {
    // Clipboard permission denied or unsupported -- typing still works.
    el.url.focus();
    say('url.clipboardDenied');
  }
});

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = el.url.value.trim();
  if (!url) {
    el.url.setAttribute('aria-invalid', 'true');
    el.url.focus();
    return;
  }
  el.url.removeAttribute('aria-invalid');

  clearMessage();
  resetProgress();
  el.preview.hidden = true;
  state.checking = true;
  busy(el.fetchBtn, true, 'action.checking');

  try {
    state.info = await api.info(url);
    renderPreview(state.info);
  } catch (err) {
    el.url.setAttribute('aria-invalid', 'true');
    sayApiError(err);
  } finally {
    state.checking = false;
    busy(el.fetchBtn, false, 'action.check');
  }
});

function renderPreview(info) {
  el.title.textContent = info.title || t('media.untitled');

  const parts = [info.platformLabel, info.uploader, clock(info.duration)].filter(Boolean);
  el.submeta.textContent = parts.join(' · ');

  if (info.thumbnail) {
    el.thumb.src = info.thumbnail;
    el.thumb.alt = '';
    el.thumbWrap.classList.remove('is-empty');
  } else {
    el.thumb.removeAttribute('src');
    el.thumbWrap.classList.add('is-empty');
  }

  renderQualities(info);
  applyFormatAvailability(info);

  el.preview.hidden = false;
  el.download.focus({ preventScroll: true });
}

/**
 * SoundCloud, Bandcamp and Mixcloud never carry a moving picture, and neither does the
 * odd post elsewhere that turns out to be audio. Asking for MP4 there yields an audio
 * file wearing a .mp4 name, so the control moves itself to Audio and Video is disabled.
 * Image stays available: cover art is still a picture worth saving.
 *
 * The reason is said out loud as well: from the outside, a control that is simply dead
 * is indistinguishable from a broken one. The server refuses the same combination, so
 * this is the courtesy, not the guarantee.
 */
function applyFormatAvailability(info) {
  // Two different ways a kind can be unavailable, and they narrow by different amounts.
  //
  // audioOnly: the site or the item has no video stream, so video is out.
  // pictureOnly: yt-dlp could not read the page at all. That is not a failure any more
  //   -- an ordinary web page or forum thread is exactly what the picture providers
  //   were built for, and they do not use yt-dlp -- but there is no media stream to
  //   offer, so only pictures remain.
  const pictureOnly = Boolean(info.pictureOnly);
  const audioOnly = Boolean(info.audioOnly);

  for (const button of el.segButtons) {
    const kind = button.dataset.kind;
    button.disabled = pictureOnly ? kind !== 'image' : (kind === 'video' && audioOnly);
  }
  el.seg.classList.toggle('is-locked', pictureOnly || audioOnly);

  // Move off a segment that has just been disabled, rather than leaving the control
  // pointing at a choice that cannot be acted on.
  if (pictureOnly && state.kind !== 'image') {
    selectKind('image');
    say('format.pictureOnly');
  } else if (audioOnly && state.kind === 'video') {
    selectKind('audio');
    say('error.video_not_available');
  }
}

function renderQualities(info) {
  const previous = state.quality;
  const fragment = document.createDocumentFragment();
  for (const q of info.qualities) {
    const option = document.createElement('option');
    option.value = q;
    option.textContent = q === 'best' ? t('quality.best') : `${q}p`;
    fragment.append(option);
  }
  el.quality.replaceChildren(fragment);

  state.quality = info.qualities.includes(previous) ? previous : (info.qualities[0] ?? 'best');
  el.quality.value = state.quality;
}

/* -------------------------------------------------------------------- step 2 */

/** The format id currently selected: the kind's segment plus its type select. */
function currentFormat() {
  return state.chosen[state.kind];
}

/**
 * Select video, audio or image.
 *
 * Split out of the click handler because an audio-only source has to be able to move
 * the control itself, and both paths must leave the same state behind: a thumb that
 * agrees with `state.kind`, a type select listing that kind's formats, and a quality
 * select that exists only for video.
 *
 * The last type chosen inside each kind is remembered, so flipping to Audio to check
 * what is on offer and back again does not quietly reset MP4 to something else.
 */
function selectKind(kind) {
  state.kind = kind;
  el.seg.dataset.active = kind; // drives the sliding thumb
  for (const other of el.segButtons) {
    const on = other.dataset.kind === kind;
    other.classList.toggle('is-on', on);
    other.setAttribute('aria-checked', String(on));
  }

  renderTypes();
  renderPicture();
  // Only video has a height to cap; only pictures have a size to trade against it.
  el.qualityWrap.hidden = kind !== 'video';
  el.pictureWrap.hidden = kind !== 'image';
}

/**
 * Fill the type select from /api/health, so it can only ever offer formats the server
 * accepts. The labels are the format ids themselves, upper-cased -- MP4 and FLAC are
 * the same word in every language, and putting them through the dictionaries would
 * invite twenty-four chances to mistype one.
 */
function renderTypes() {
  const group = state.health?.formats?.find((g) => g.kind === state.kind);
  const ids = group?.formats ?? [];

  const fragment = document.createDocumentFragment();
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.toUpperCase();
    fragment.append(option);
  }
  el.type.replaceChildren(fragment);

  if (!ids.includes(state.chosen[state.kind])) state.chosen[state.kind] = ids[0] ?? state.chosen[state.kind];
  el.type.value = state.chosen[state.kind];
  el.typeWrap.hidden = ids.length < 2;
}

for (const button of el.segButtons) {
  button.addEventListener('click', () => selectKind(button.dataset.kind));
}

el.type.addEventListener('change', () => { state.chosen[state.kind] = el.type.value; });

el.quality.addEventListener('change', () => { state.quality = el.quality.value; });

/**
 * Build the picture slider from whatever steps the server published.
 *
 * The scale is ordered lightest-to-best on the server, so the slider index *is* the
 * position on that scale and no mapping table is needed here. Adding a step to the
 * server's table widens the slider on its own.
 */
function renderPicture() {
  const steps = state.health?.pictureQualities ?? [];
  if (!steps.length) return;

  el.picture.max = String(steps.length - 1);
  const at = steps.indexOf(state.picture);
  const index = at === -1 ? steps.length - 1 : at;
  el.picture.value = String(index);
  state.picture = steps[index];
  el.pictureNow.textContent = t(`picture.${state.picture}`);
}

el.picture.addEventListener('input', () => {
  const steps = state.health?.pictureQualities ?? [];
  state.picture = steps[Number(el.picture.value)] ?? 'original';
  el.pictureNow.textContent = t(`picture.${state.picture}`);
});

el.download.addEventListener('click', async () => {
  if (!state.info) return;

  clearMessage();
  state.downloading = true;
  busy(el.download, true, 'action.starting');

  try {
    const job = await api.createJob({
      url: state.info.url,
      format: currentFormat(),
      // Each kind speaks its own quality vocabulary; audio has none, so it sends the
      // video default, which the server accepts and ignores.
      quality: state.kind === 'video' ? state.quality
        : state.kind === 'image' ? state.picture
        : 'best',
      title: state.info.title,
    });
    startWatching(job.id);
  } catch (err) {
    sayApiError(err);
    state.downloading = false;
    busy(el.download, false, 'action.download');
  }
});

/* ------------------------------------------------------------------ progress */

function resetProgress() {
  state.unwatch?.();
  state.unwatch = null;
  state.jobId = null;
  state.lastProgress = null;
  el.progress.hidden = true;
  el.barFill.style.width = '';
  el.barFill.classList.add('is-indeterminate');
  el.barFill.classList.remove('is-done');
  el.stats.textContent = '';
  el.percent.textContent = EM_DASH;
  el.cancel.hidden = false;
}

function startWatching(id) {
  state.jobId = id;
  el.progress.hidden = false;
  el.phase.textContent = t('phase.extracting');

  state.unwatch = api.watch(id, {
    onUpdate: renderProgress,
    onReady: (job) => {
      renderProgress({ ...job, phase: 'ready', percent: 100 });
      el.barFill.classList.add('is-done');
      el.cancel.hidden = true;
      state.unwatch?.();
      state.unwatch = null;
      deliver(job);
    },
    onFailed: (job) => {
      sayText(tError(job.code || 'server_error', job.detail), 'error');
      resetProgress();
      state.downloading = false;
      busy(el.download, false, 'action.download');
    },
  });
}

function renderProgress(job) {
  state.lastProgress = job;

  const phaseKey = `phase.${job.phase}`;
  el.phase.textContent = t(phaseKey) === phaseKey ? t('phase.downloading') : t(phaseKey);

  if (Number.isFinite(job.percent) && job.percent !== null) {
    el.barFill.classList.remove('is-indeterminate');
    el.barFill.style.width = `${job.percent.toFixed(1)}%`;
    el.percent.textContent = `${Math.round(job.percent)}%`;
    el.bar.setAttribute('aria-valuenow', String(Math.round(job.percent)));
  } else {
    el.barFill.classList.add('is-indeterminate');
    el.barFill.style.width = '';
    el.percent.textContent = EM_DASH;
    el.bar.removeAttribute('aria-valuenow');
  }

  const bits = [];
  if (job.downloaded) bits.push(job.total ? `${bytes(job.downloaded)} / ${bytes(job.total)}` : bytes(job.downloaded));
  if (job.speed) bits.push(`${bytes(job.speed)}/s`);
  if (Number.isFinite(job.eta) && job.eta !== null) bits.push(t('progress.remaining', { time: clock(job.eta) }));
  el.stats.textContent = bits.filter(Boolean).join('  ·  ');
}

/**
 * Hand the finished file to the browser. A hidden anchor with `download` is what makes
 * a mobile browser write straight to the device's Downloads folder; navigating the top
 * window instead would tear down the page on some Android builds.
 */
function deliver(job) {
  const link = document.createElement('a');
  link.href = api.fileUrl(job.id);
  link.download = job.filename || '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();

  if (job.size) {
    say('progress.savedSize', { vars: { name: job.filename, size: bytes(job.size) }, kind: 'ok' });
  } else {
    say('progress.saved', { vars: { name: job.filename }, kind: 'ok' });
  }
  state.downloading = false;
  busy(el.download, false, 'action.download');

  // The server purges its temp copy as soon as the transfer completes.
  setTimeout(() => { el.progress.hidden = true; }, 1200);
}

el.cancel.addEventListener('click', async () => {
  if (!state.jobId) return;
  const id = state.jobId;
  resetProgress();
  state.downloading = false;
  busy(el.download, false, 'action.download');
  say('progress.canceled');
  await api.cancel(id);
});

/* -------------------------------------------------------------------- boot */

async function checkServer() {
  try {
    state.health = await api.health();
  } catch {
    state.health = null;
  }
  paintServerStatus();
  paintSupported();
  // The format list and the picture scale both travel with health, so neither control
  // can be built before this point.
  renderTypes();
  renderPicture();

  if (state.health && !state.health.ok) say('server.missingLong', { kind: 'error' });
}

/**
 * Name the supported sites before anyone types, not after they get it wrong.
 *
 * The list comes from /api/health, which builds it from the same table the validator
 * enforces, so this line cannot promise a site the server would reject. Intl.ListFormat
 * joins the names the way the current language does it ("dan" versus "and"), which a
 * hand-written separator in 24 dictionaries would get wrong somewhere.
 *
 * Two dozen names is a paragraph rather than a hint, so only the first few are printed
 * and the rest sit behind a count. The threshold is "more than one hidden": putting a
 * single remaining name behind a control that costs a tap is worse than printing it.
 */
const SUPPORTS_COLLAPSED = 5;

function joinNames(names, type) {
  try {
    return new Intl.ListFormat(getLanguage(), { style: 'long', type }).format(names);
  } catch {
    return names.join(', '); // Intl.ListFormat is very widely supported, but not universally
  }
}

function paintSupported() {
  const platforms = state.health?.platforms;
  if (!platforms?.length) {
    el.supports.hidden = true;
    return;
  }

  const names = platforms.map((p) => p.label);
  const universal = Boolean(state.health?.universal);
  const hidden = names.length - SUPPORTS_COLLAPSED;
  const collapsible = hidden > 1;
  const showingAll = state.supportsExpanded || !collapsible;

  if (universal) {
    // The headline fact changes with the mode. Leading with a truncated allowlist here
    // and appending the real answer produced a two-sentence line that made the reader
    // work out which one governed; in universal mode the count is the answer, and the
    // checked list is what the toggle is for.
    //
    // The count comes from the installed yt-dlp, so it is a fact rather than a claim.
    // Until that slow probe lands there is no number, and the sentence without one is
    // still true.
    const n = state.health.extractors;
    el.supportsText.textContent = n ? t('url.universalCount', { n }) : t('url.universalOn');
  } else {
    // "and" only closes a list that really has ended; a truncated one gets no
    // conjunction, because "YouTube, TikTok and Instagram" would claim those were all.
    el.supportsText.textContent = showingAll
      ? t('url.supports', { list: joinNames(names, 'conjunction') })
      : t('url.supportsSome', { list: joinNames(names.slice(0, SUPPORTS_COLLAPSED), 'unit'), n: hidden });
  }

  // In universal mode the toggle reveals the sites that were actually checked by hand,
  // which is a different and more useful thing than the first five names.
  const canToggle = universal || collapsible;
  el.supportsToggle.hidden = !canToggle;
  if (canToggle) {
    const open = universal ? state.supportsExpanded : showingAll;
    el.supportsToggle.textContent = t(open ? 'url.supportsShowLess' : 'url.supportsShowAll');
    el.supportsToggle.setAttribute('aria-expanded', String(open));
  }

  // The verified list lives in its own line when it is supplementary rather than the
  // headline, so the two facts never run together into one sentence.
  const showChecked = universal && state.supportsExpanded;
  el.supportsChecked.textContent = showChecked
    ? t('url.supports', { list: joinNames(names, 'conjunction') })
    : '';
  el.supportsChecked.hidden = !showChecked;

  el.supports.hidden = false;
}

el.supportsToggle.addEventListener('click', () => {
  state.supportsExpanded = !state.supportsExpanded;
  paintSupported();
});

function paintServerStatus() {
  const health = state.health;

  if (health === undefined) {
    el.dot.className = 'dot';
    el.serverText.textContent = t('server.checking');
    return;
  }
  if (health === null) {
    el.dot.className = 'dot is-bad';
    el.serverText.textContent = t('server.down');
    return;
  }
  if (!health.ok) {
    el.dot.className = 'dot is-bad';
    el.serverText.textContent = t('server.missing');
    return;
  }
  el.dot.className = 'dot is-ok';
  el.serverText.textContent = health.ffmpeg
    ? t('server.okFfmpeg', { ytdlp: health.ytdlp, ffmpeg: health.ffmpeg })
    : t('server.ok', { ytdlp: health.ytdlp });
}

/**
 * Re-render everything language-dependent.
 *
 * Static markup is handled by data-i18n attributes; the rest is state that was rendered
 * earlier and would otherwise be stranded in the previous language.
 */
function repaintLanguage() {
  applyStatic();
  paintThemeLabel();
  paintMessage();
  paintServerStatus();
  paintSupported();

  busy(el.fetchBtn, el.fetchBtn.disabled, state.checking ? 'action.checking' : 'action.check');
  busy(el.download, el.download.disabled, state.downloading ? 'action.starting' : 'action.download');

  if (state.info) {
    el.title.textContent = state.info.title || t('media.untitled');
    renderQualities(state.info);
  }
  renderTypes();
  renderPicture();
  if (state.lastProgress) renderProgress(state.lastProgress);

  el.lang.value = getLanguage();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}

// Leaving the page mid-download closes the SSE stream, which is the signal the server
// uses to reclaim the temp folder. Being explicit about it costs nothing.
window.addEventListener('pagehide', () => state.unwatch?.());

/**
 * Android share sheet. manifest.json registers Steading as a share target, so sharing
 * from the YouTube or TikTok app lands here as /?url=... -- or as /?text=... with the
 * link buried in a sentence, which is what those apps actually send.
 */
function consumeSharedLink() {
  const params = new URLSearchParams(location.search);
  const candidate = params.get('url') || params.get('text') || params.get('title');
  if (!candidate) return;

  const match = candidate.match(/https?:\/\/\S+/);
  const link = (match ? match[0] : candidate).trim();
  if (!link) return;

  el.url.value = link;
  // Clean the address bar so a reload does not re-trigger the same share.
  history.replaceState(null, '', location.pathname);
  el.form.requestSubmit();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is optional */ });
  });
}

async function boot() {
  initTheme();
  buildLanguageMenu();
  onLanguageChange(repaintLanguage);

  await setLanguage(detectLanguage());
  repaintLanguage();

  checkServer();
  consumeSharedLink();
}

boot();
