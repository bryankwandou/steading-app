/**
 * Localization.
 *
 * Two languages ship inline -- English as the fallback every other language falls back
 * to, and Indonesian as the primary audience. Everything else lives in
 * /i18n/<code>.json and is fetched the first time it is selected, so the app shell
 * stays small on a phone. A missing key falls through to English rather than showing a
 * raw identifier; a missing file leaves the current language in place.
 *
 * Server error codes are keys here too. The backend sends `download_failed`, never a
 * sentence, which is why adding a language never touches server code.
 */

const STORAGE_KEY = 'steading.lang';

/**
 * The picker's contents. `name` is written in the language itself -- a user looking for
 * their language scans for the word they know, not its English exonym.
 */
export const LANGUAGES = [
  { code: 'id',    name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'en',    name: 'English',          dir: 'ltr' },
  { code: 'ms',    name: 'Bahasa Melayu',    dir: 'ltr' },
  { code: 'ar',    name: 'العربية',           dir: 'rtl' },
  { code: 'bn',    name: 'বাংলা',              dir: 'ltr' },
  { code: 'de',    name: 'Deutsch',          dir: 'ltr' },
  { code: 'es',    name: 'Español',          dir: 'ltr' },
  { code: 'fa',    name: 'فارسی',             dir: 'rtl' },
  { code: 'fil',   name: 'Filipino',         dir: 'ltr' },
  { code: 'fr',    name: 'Français',         dir: 'ltr' },
  { code: 'hi',    name: 'हिन्दी',              dir: 'ltr' },
  { code: 'it',    name: 'Italiano',         dir: 'ltr' },
  { code: 'ja',    name: '日本語',             dir: 'ltr' },
  { code: 'ko',    name: '한국어',             dir: 'ltr' },
  { code: 'nl',    name: 'Nederlands',       dir: 'ltr' },
  { code: 'pl',    name: 'Polski',           dir: 'ltr' },
  { code: 'pt',    name: 'Português',        dir: 'ltr' },
  { code: 'ru',    name: 'Русский',          dir: 'ltr' },
  { code: 'th',    name: 'ไทย',               dir: 'ltr' },
  { code: 'tr',    name: 'Türkçe',           dir: 'ltr' },
  { code: 'uk',    name: 'Українська',       dir: 'ltr' },
  { code: 'vi',    name: 'Tiếng Việt',       dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文',           dir: 'ltr' },
  { code: 'zh-TW', name: '繁體中文',           dir: 'ltr' },
];

const KNOWN = new Set(LANGUAGES.map((l) => l.code));

const en = {
  'app.description': 'A video and audio downloader that runs entirely on your own device.',

  'nav.language': 'Language',
  'nav.theme': 'Theme',
  'nav.theme.light': 'Switch to light theme',
  'nav.theme.dark': 'Switch to dark theme',

  'url.label': 'Link',
  'empty.title': 'What would you like to keep?',
  'empty.lede': 'Paste a link. The file is written straight to this computer, and nothing you paste leaves it.',
  'empty.canTitle': 'This copy can save',
  'url.placeholder': 'Paste any link — video, audio or photos',
  'url.hint': 'The server runs on this device. Nothing is sent anywhere.',
  'url.supports': "Works with {list}.",
  'url.supportsSome': 'Works with {list} and {n} more.',
  'url.supportsShowAll': 'See all',
  'url.supportsShowLess': 'See fewer',
  'url.universalOn': 'Universal mode is on, so any other link is tried too.',
  'url.universalCount': 'Universal mode is on, so all {n} sites yt-dlp knows are accepted.',
  'url.paste': 'Paste from clipboard',
  'url.clipboardDenied': 'Could not read the clipboard. Long-press the field and paste manually.',

  'action.check': 'Check link',
  'action.checking': 'Checking',
  'action.download': 'Download',
  'action.starting': 'Starting',
  'action.cancel': 'Cancel',

  'format.label': 'Format',
  'format.video': 'Video',
  'format.audio': 'Audio',
  'format.image': 'Photo',
  'format.pictureOnly': 'This link is not a video or a track, so only its pictures can be saved.',
  'format.type': 'Type',
  'quality.label': 'Quality',
  'picture.label': 'Picture quality',
  'picture.lighter': 'Smaller file',
  'picture.fuller': 'Original',
  'picture.tiny': 'Tiny',
  'picture.small': 'Small',
  'picture.balanced': 'Balanced',
  'picture.high': 'High',
  'picture.original': 'Original',
  'quality.best': 'Best available',

  'media.untitled': 'Untitled',

  'phase.extracting': 'Reading the link',
  'phase.downloading': 'Downloading',
  'phase.merging': 'Merging video and audio',
  'phase.converting': 'Converting to MP3',
  'phase.finishing': 'Finishing up',
  'phase.ready': 'Done',

  'progress.remaining': '{time} left',
  'progress.canceled': 'Download canceled.',
  'progress.saved': 'Saved to your device: {name}',
  'progress.savedSize': 'Saved to your device: {name} ({size})',

  'server.checking': 'checking the local server',
  'server.ok': 'local server running · yt-dlp {ytdlp}',
  'server.okFfmpeg': 'local server running · yt-dlp {ytdlp} · ffmpeg {ffmpeg}',
  'server.missing': 'yt-dlp is not installed — run: npm run check',
  'server.missingLong': 'yt-dlp is not installed on this device, so downloads cannot run yet. Run "npm run check" in a terminal for instructions.',
  'server.down': 'the local server is not responding',

  'error.body_too_large': 'That request was too large.',
  'error.bad_json': 'The request was malformed.',
  'error.bad_request_url': 'That request address was malformed.',
  'error.origin_rejected': 'That request came from somewhere this server does not trust.',
  'error.unknown_endpoint': 'Unknown endpoint.',
  'error.url_not_text': 'The link must be text.',
  'error.url_empty': 'Paste a link first.',
  'error.url_too_long': 'That link is too long.',
  'error.url_bad_chars': 'That link contains characters that are not valid.',
  'error.url_malformed': 'That does not look like a link.',
  'error.url_bad_scheme': 'Only http and https links are supported.',
  'error.url_unsupported_site': 'That site is not supported yet. The ones that do work are listed under the link box.',
  'error.url_site_locked': "{site} builds its posts in the browser and hides most of them behind a login, so a downloader is handed nothing to fetch. If the same video is also on one of the supported sites, paste that link instead.",
  'error.bad_format': 'The format must be MP4 or MP3.',
  'error.video_not_available': 'This link has no video track, only audio. Switch to MP3 to save it.',
  'error.bad_quality': 'That quality is not available.',
  'error.bad_job_id': 'Invalid job id.',
  'error.no_binary': 'yt-dlp is not installed. Run "npm run check" for instructions.',
  'error.info_timeout': 'The site took too long to answer.',
  'error.info_unreadable': 'Could not read any details from that link.',
  'error.is_live': 'Live streams are not supported yet.',
  'error.private_content': 'This is private or needs a login, so it cannot be downloaded.',
  'error.content_gone': 'Not found. It may have been removed, or the link may be wrong.',
  'error.geo_blocked': 'This is restricted to certain regions.',
  'error.network': 'Connection problem. Check your network and try again.',
  'error.download_failed': 'yt-dlp could not process this link.',
  'error.download_timeout': 'The download ran past its time limit.',
  'error.no_output_file': 'The download finished but the file could not be found.',
  'error.no_image': 'That link has no picture to save.',
  'error.too_many_jobs': 'Up to {n} downloads can run at once. Wait for one to finish.',
  'error.job_not_found': 'That download is no longer available.',
  'error.file_not_ready': 'The file is not ready yet.',
  'error.canceled': 'Download canceled.',
  'error.client_gone': 'The browser disconnected, so the download was stopped.',
  'error.file_expired': 'The file expired because it was never downloaded.',
  'error.job_expired': 'The download expired.',
  'error.server_error': 'Something went wrong on the local server.',
  'error.http': 'The server answered {status}.',
  'error.detail': 'Details: {detail}',
};

const id = {
  'app.description': 'Pengunduh video dan audio yang berjalan sepenuhnya di perangkat sendiri.',

  'nav.language': 'Bahasa',
  'nav.theme': 'Tema',
  'nav.theme.light': 'Ganti ke tema terang',
  'nav.theme.dark': 'Ganti ke tema gelap',

  'url.label': 'Tautan',
  'empty.title': 'Apa yang ingin Anda simpan?',
  'empty.lede': 'Tempel sebuah tautan. Berkasnya ditulis langsung ke komputer ini, dan apa pun yang Anda tempel tidak keluar dari sini.',
  'empty.canTitle': 'Salinan ini bisa menyimpan',
  'url.placeholder': 'Tempel tautan apa pun — video, audio, atau foto',
  'url.hint': 'Server berjalan di perangkat ini. Tidak ada data yang dikirim ke mana pun.',
  'url.supports': "Mendukung {list}.",
  'url.supportsSome': 'Mendukung {list} dan {n} situs lainnya.',
  'url.supportsShowAll': 'Lihat semua',
  'url.supportsShowLess': 'Ringkas',
  'url.universalOn': 'Mode universal aktif, jadi tautan lain pun tetap dicoba.',
  'url.universalCount': 'Mode universal aktif, jadi seluruh {n} situs yang dikenal yt-dlp diterima.',
  'url.paste': 'Tempel dari papan klip',
  'url.clipboardDenied': 'Tidak bisa membaca papan klip. Tekan lama kolom tautan lalu tempel manual.',

  'action.check': 'Cek tautan',
  'action.checking': 'Memeriksa',
  'action.download': 'Unduh',
  'action.starting': 'Memulai',
  'action.cancel': 'Batalkan',

  'format.label': 'Format',
  'format.video': 'Video',
  'format.audio': 'Audio',
  'format.image': 'Foto',
  'format.pictureOnly': 'Tautan ini bukan video atau lagu, jadi hanya gambarnya yang bisa disimpan.',
  'format.type': 'Tipe',
  'quality.label': 'Kualitas',
  'picture.label': 'Kualitas gambar',
  'picture.lighter': 'Berkas kecil',
  'picture.fuller': 'Asli',
  'picture.tiny': 'Sangat ringan',
  'picture.small': 'Ringan',
  'picture.balanced': 'Seimbang',
  'picture.high': 'Tinggi',
  'picture.original': 'Asli',
  'quality.best': 'Terbaik yang tersedia',

  'media.untitled': 'Tanpa judul',

  'phase.extracting': 'Membaca tautan',
  'phase.downloading': 'Mengunduh',
  'phase.merging': 'Menggabungkan video dan audio',
  'phase.converting': 'Mengonversi ke MP3',
  'phase.finishing': 'Merapikan berkas',
  'phase.ready': 'Selesai',

  'progress.remaining': 'sisa {time}',
  'progress.canceled': 'Unduhan dibatalkan.',
  'progress.saved': 'Tersimpan ke perangkat: {name}',
  'progress.savedSize': 'Tersimpan ke perangkat: {name} ({size})',

  'server.checking': 'memeriksa server lokal',
  'server.ok': 'server lokal aktif · yt-dlp {ytdlp}',
  'server.okFfmpeg': 'server lokal aktif · yt-dlp {ytdlp} · ffmpeg {ffmpeg}',
  'server.missing': 'yt-dlp belum terpasang — jalankan: npm run check',
  'server.missingLong': 'yt-dlp belum terpasang di perangkat ini, jadi unduhan belum bisa dijalankan. Jalankan "npm run check" di terminal untuk petunjuknya.',
  'server.down': 'server lokal tidak merespons',

  'error.body_too_large': 'Permintaan terlalu besar.',
  'error.bad_json': 'Permintaan tidak berbentuk benar.',
  'error.bad_request_url': 'Alamat permintaan tidak valid.',
  'error.origin_rejected': 'Permintaan datang dari asal yang tidak dipercaya server ini.',
  'error.unknown_endpoint': 'Endpoint tidak dikenal.',
  'error.url_not_text': 'Tautan harus berupa teks.',
  'error.url_empty': 'Tempel tautannya dulu.',
  'error.url_too_long': 'Tautannya terlalu panjang.',
  'error.url_bad_chars': 'Tautan mengandung karakter yang tidak valid.',
  'error.url_malformed': 'Itu sepertinya bukan tautan.',
  'error.url_bad_scheme': 'Hanya tautan http dan https yang didukung.',
  'error.url_unsupported_site': 'Situs ini belum didukung. Daftar situs yang bisa dipakai ada di bawah kolom tautan.',
  'error.url_site_locked': "{site} menyusun postingannya di dalam browser dan menyembunyikan sebagian besar di balik login, jadi tidak ada yang bisa diambil pengunduh. Kalau video yang sama juga ada di salah satu situs yang didukung, tempel tautan itu saja.",
  'error.bad_format': 'Format harus MP4 atau MP3.',
  'error.video_not_available': 'Tautan ini tidak punya jalur video, hanya audio. Pilih MP3 untuk menyimpannya.',
  'error.bad_quality': 'Kualitas itu tidak tersedia.',
  'error.bad_job_id': 'ID tugas tidak valid.',
  'error.no_binary': 'yt-dlp belum terpasang. Jalankan "npm run check" untuk petunjuknya.',
  'error.info_timeout': 'Situsnya terlalu lama merespons.',
  'error.info_unreadable': 'Tidak bisa membaca detail dari tautan ini.',
  'error.is_live': 'Siaran langsung belum didukung.',
  'error.private_content': 'Konten ini privat atau butuh login, jadi tidak bisa diunduh.',
  'error.content_gone': 'Tidak ditemukan. Mungkin sudah dihapus, atau tautannya salah.',
  'error.geo_blocked': 'Konten ini dibatasi untuk wilayah tertentu.',
  'error.network': 'Koneksi bermasalah. Periksa jaringan lalu coba lagi.',
  'error.download_failed': 'yt-dlp tidak bisa memproses tautan ini.',
  'error.download_timeout': 'Unduhan melebihi batas waktu.',
  'error.no_output_file': 'Unduhan selesai tetapi berkasnya tidak ditemukan.',
  'error.no_image': 'Tautan itu tidak punya gambar untuk disimpan.',
  'error.too_many_jobs': 'Maksimal {n} unduhan berjalan bersamaan. Tunggu salah satunya selesai.',
  'error.job_not_found': 'Unduhan itu sudah tidak tersedia.',
  'error.file_not_ready': 'Berkasnya belum siap.',
  'error.canceled': 'Unduhan dibatalkan.',
  'error.client_gone': 'Browser terputus, jadi unduhan dihentikan.',
  'error.file_expired': 'Berkas kedaluwarsa karena tidak pernah diunduh.',
  'error.job_expired': 'Unduhan kedaluwarsa.',
  'error.server_error': 'Terjadi kesalahan di server lokal.',
  'error.http': 'Server menjawab {status}.',
  'error.detail': 'Detail: {detail}',
};

/**
 * The two inline tables, exposed for the integrity test in tests/i18n.test.js.
 * English is the reference every other dictionary is checked against.
 */
export const BASE = { en, id };

/** Loaded dictionaries, keyed by language code. */
const loaded = new Map([['en', en], ['id', id]]);

const listeners = new Set();

let current = 'en';
let dict = en;

/** Best match for a browser tag: exact, then region-stripped, then a regional variant. */
function normalize(tag) {
  if (!tag) return null;
  if (KNOWN.has(tag)) return tag;

  const lower = String(tag).toLowerCase();
  for (const { code } of LANGUAGES) if (code.toLowerCase() === lower) return code;

  const base = lower.split('-')[0];
  if (KNOWN.has(base)) return base;

  // zh-HK and zh-MO read traditional; anything else Chinese gets simplified.
  if (base === 'zh') return /hant|tw|hk|mo/.test(lower) ? 'zh-TW' : 'zh-CN';
  if (base === 'in') return 'id'; // the pre-1989 code for Indonesian, still emitted
  if (base === 'tl') return 'fil';

  for (const { code } of LANGUAGES) if (code.split('-')[0] === base) return code;
  return null;
}

/** Stored choice, else the browser's preference order, else English. */
export function detectLanguage() {
  try {
    const saved = normalize(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch { /* private mode -- fall through to the browser preference */ }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = normalize(tag);
    if (match) return match;
  }
  return 'en';
}

async function load(code) {
  if (loaded.has(code)) return loaded.get(code);
  const res = await fetch(`/i18n/${encodeURIComponent(code)}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`missing dictionary: ${code}`);
  const table = await res.json();
  loaded.set(code, table);
  return table;
}

/**
 * Switch language. Resolves once the dictionary is in place and listeners have run, so
 * a caller can await it and know the DOM is consistent.
 */
export async function setLanguage(code) {
  const target = normalize(code) || 'en';
  let table;
  try {
    table = await load(target);
  } catch {
    return current; // keep what is on screen rather than flashing to English
  }

  current = target;
  dict = table;

  try { localStorage.setItem(STORAGE_KEY, target); } catch { /* not fatal */ }

  const meta = LANGUAGES.find((l) => l.code === target);
  document.documentElement.lang = target;
  document.documentElement.dir = meta?.dir ?? 'ltr';

  for (const fn of listeners) fn(target);
  return target;
}

export function getLanguage() {
  return current;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate. `{name}` placeholders are filled from `vars`.
 *
 * Substitution is plain string replacement and every call site assigns the result to
 * `textContent`, never `innerHTML` -- a video title from a remote site passes through
 * here, so it must never be able to become markup.
 */
export function t(key, vars) {
  let out = dict[key] ?? en[key];
  if (out === undefined) return key;
  if (!vars) return out;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

/** Translate a server error code, appending raw detail only when it adds something. */
export function tError(code, detail) {
  const key = `error.${code}`;
  const known = dict[key] ?? en[key];

  if (code === 'too_many_jobs') return t(key, { n: detail ?? 2 });
  // The site name comes from the validator's own table, never from user input.
  if (code === 'url_site_locked') return t(key, { site: detail ?? '' });
  if (known) return known;

  // An unrecognised code should still say something true rather than nothing.
  return detail ? t('error.detail', { detail }) : t('error.server_error');
}

/** Apply the current dictionary to every element carrying a data-i18n* attribute. */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    // Format: "placeholder:url.placeholder, aria-label:url.paste"
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
}
