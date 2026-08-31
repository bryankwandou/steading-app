# Send to Steading

A toolbar button and a right-click item that hand the current page — or a link on it — to
Steading running on your own machine.

It is not a downloader. It opens `http://127.0.0.1:3000/?url=…` and lets the app you
already have do the work. That is why it asks for no host permissions, reads no page
content, and talks to no server of its own.

## Install

Steading must be running first (`npm start`); the extension only points at it.

**Chrome, Edge, Brave, Opera, Vivaldi**

1. Open `chrome://extensions` (`edge://extensions` on Edge).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this `extension/` folder.

**Firefox**

Firefox wants a background script rather than a service worker. Change the `background`
block in `manifest.json` to:

```json
"background": { "scripts": ["background.js"] }
```

then open `about:debugging` → **This Firefox** → **Load Temporary Add-on** and pick
`manifest.json`. A temporary add-on is removed when Firefox restarts; signing it for a
permanent install is a Mozilla account away and out of scope here.

**Safari** needs the extension converted into an Xcode project
(`xcrun safari-web-extension-converter extension/`) and an Apple developer account to
run it unsigned for more than a week. Not worth it unless you already have both.

## Use

- **Toolbar button** — sends the page you are on.
- **Right-click a link** → *Send link to Steading* — sends that link instead. This is the
  one you want on a feed, where the tab's own address is the feed rather than the post.

## A different port

If you start Steading with `PORT=3001 npm start`, set the same number in the extension's
options (`chrome://extensions` → *Details* → *Extension options*).

## What it does not do

It cannot download anything by itself, and it does not try. A browser extension has no
way to run yt-dlp or ffmpeg — that is precisely the work Steading's local server exists
to do. If Steading is not running, the tab it opens will simply fail to connect.
