/**
 * Start the server with the allowlist lifted.
 *
 * A one-line wrapper rather than an npm script, because setting an environment variable
 * inline is written three different ways on Windows, macOS and Termux, and the audience
 * for this project includes people running it on a phone. `node` behaves the same on
 * all three.
 *
 * Read server/config.js before using this. Lifting the allowlist trades away the
 * guarantee that a page in another tab cannot walk this server through yt-dlp's whole
 * extractor tree; every other defence stays exactly as it was.
 */

process.env.UNIVERSAL = '1';

await import('../server/index.js');
