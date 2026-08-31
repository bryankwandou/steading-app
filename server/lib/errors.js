/**
 * Error codes.
 *
 * The server never sends prose the UI is expected to display verbatim. It sends a
 * stable code and an English fallback; the client owns the wording in whatever language
 * the user picked. Adding a language must never require touching the backend, and a
 * translator must never have to guess which of two similar sentences is which.
 *
 * Every code that reaches a client also has an entry in public/js/i18n.js. The test
 * suite asserts the two lists stay in sync.
 */

export const ERR = {
  // Request shape
  BODY_TOO_LARGE: 'body_too_large',
  BAD_JSON: 'bad_json',
  BAD_REQUEST_URL: 'bad_request_url',
  ORIGIN_REJECTED: 'origin_rejected',
  UNKNOWN_ENDPOINT: 'unknown_endpoint',

  // URL validation
  URL_NOT_TEXT: 'url_not_text',
  URL_EMPTY: 'url_empty',
  URL_TOO_LONG: 'url_too_long',
  URL_BAD_CHARS: 'url_bad_chars',
  URL_MALFORMED: 'url_malformed',
  URL_BAD_SCHEME: 'url_bad_scheme',
  URL_UNSUPPORTED_SITE: 'url_unsupported_site',
  // A site we recognise and deliberately do not support, as opposed to one we simply
  // do not know. Worth its own code because the answer is different: naming the site
  // and saying why is far more use than "not supported".
  URL_SITE_LOCKED: 'url_site_locked',

  // Parameter validation
  BAD_FORMAT: 'bad_format',
  // MP4 asked of a site that only ever hosts audio. Separate from BAD_FORMAT, which
  // means "that is not one of our two formats" -- here the format is valid, the source
  // simply has no picture, and the answer is to switch to MP3.
  VIDEO_NOT_AVAILABLE: 'video_not_available',
  BAD_QUALITY: 'bad_quality',
  BAD_JOB_ID: 'bad_job_id',

  // Extraction / download
  NO_BINARY: 'no_binary',
  INFO_TIMEOUT: 'info_timeout',
  INFO_UNREADABLE: 'info_unreadable',
  IS_LIVE: 'is_live',
  PRIVATE_CONTENT: 'private_content',
  CONTENT_GONE: 'content_gone',
  GEO_BLOCKED: 'geo_blocked',
  NETWORK: 'network',
  DOWNLOAD_FAILED: 'download_failed',
  DOWNLOAD_TIMEOUT: 'download_timeout',
  NO_OUTPUT_FILE: 'no_output_file',
  // Asked for a picture from something that came back without one.
  NO_IMAGE: 'no_image',

  // Job lifecycle
  TOO_MANY_JOBS: 'too_many_jobs',
  JOB_NOT_FOUND: 'job_not_found',
  FILE_NOT_READY: 'file_not_ready',
  CANCELED: 'canceled',
  CLIENT_GONE: 'client_gone',
  FILE_EXPIRED: 'file_expired',
  JOB_EXPIRED: 'job_expired',

  SERVER_ERROR: 'server_error',
};

/** English fallback, used only when a client has no entry for a code. */
export const FALLBACK = {
  body_too_large: 'Request too large.',
  bad_json: 'Request body is not valid JSON.',
  bad_request_url: 'Malformed request URL.',
  origin_rejected: 'Origin rejected.',
  unknown_endpoint: 'Unknown endpoint.',

  url_not_text: 'The link must be text.',
  url_empty: 'Paste a link first.',
  url_too_long: 'That link is too long.',
  url_bad_chars: 'That link contains invalid characters.',
  url_malformed: 'That does not look like a link.',
  url_bad_scheme: 'Only http and https links are supported.',
  url_unsupported_site: 'That site is not supported yet.',
  url_site_locked: 'That site cannot be downloaded from.',

  bad_format: 'Format must be mp4 or mp3.',
  video_not_available: 'That site hosts audio only. Choose MP3.',
  bad_quality: 'That quality is not available.',
  bad_job_id: 'Invalid job id.',

  no_binary: 'yt-dlp is not installed.',
  info_timeout: 'The site took too long to answer.',
  info_unreadable: 'Could not read metadata from that link.',
  is_live: 'Live streams are not supported yet.',
  private_content: 'This content is private or needs a login.',
  content_gone: 'Content not found. It may have been removed.',
  geo_blocked: 'This content is restricted in your region.',
  network: 'Network problem. Check your connection and try again.',
  download_failed: 'yt-dlp could not process this link.',
  download_timeout: 'The download ran past its time limit.',
  no_output_file: 'The download finished but the file is missing.',
  no_image: 'That link has no picture to save.',

  too_many_jobs: 'Too many downloads are already running.',
  job_not_found: 'That job no longer exists.',
  file_not_ready: 'The file is not ready yet.',
  canceled: 'Download canceled.',
  client_gone: 'The browser disconnected, so the download was stopped.',
  file_expired: 'The file expired because it was never downloaded.',
  job_expired: 'The job expired.',

  server_error: 'Something went wrong on the local server.',
};

/**
 * Build an Error carrying a code. `detail` is optional raw text (a yt-dlp line, a
 * count) that the client may interpolate; it is never required for a readable message.
 */
export function coded(code, { status, detail = null } = {}) {
  const err = new Error(FALLBACK[code] || code);
  err.code = code;
  if (status) err.status = status;
  if (detail) err.detail = detail;
  return err;
}

export const CODES = Object.values(ERR);
