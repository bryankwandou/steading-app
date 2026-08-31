/**
 * Send to Steading -- the whole extension.
 *
 * It opens a tab. That is the entire mechanism, and the reason is worth stating: an
 * extension *could* fetch http://127.0.0.1:3000/api/jobs directly, but that would mean
 * asking for host permission on the user's own machine, keeping a cross-origin channel
 * into the local server open on every page, and reimplementing the progress UI inside a
 * popup. Handing the link to the page that already exists costs one tab and asks for
 * nothing.
 *
 * `?url=` is not a new interface either: Steading already accepts it, because Android's
 * share sheet delivers shared links that way. This rides on the same entry point.
 */

const DEFAULT_PORT = 3000;

/** Steading binds to loopback, so the address is fixed apart from the port. */
async function steadingUrl(target) {
  let port = DEFAULT_PORT;
  try {
    const stored = await chrome.storage.sync.get({ port: DEFAULT_PORT });
    if (Number.isInteger(stored.port) && stored.port > 0 && stored.port < 65536) port = stored.port;
  } catch {
    /* storage unavailable in a private window -- the default is still right */
  }
  return `http://127.0.0.1:${port}/?url=${encodeURIComponent(target)}`;
}

/**
 * Only http(s) is worth sending. A chrome:// or file:// address would travel all the way
 * to the server just to be refused by the same check there.
 */
function usable(target) {
  return typeof target === 'string' && /^https?:\/\//i.test(target);
}

async function send(target) {
  if (!usable(target)) return;
  await chrome.tabs.create({ url: await steadingUrl(target) });
}

/* The toolbar button sends the page you are on. `tab.url` is populated for the active
   tab without any host permission, which is why none is requested. */
chrome.action.onClicked.addListener((tab) => { send(tab?.url); });

/* Right-clicking a link sends that link instead, which is what you want on a feed page
   where the tab's own address is the feed rather than the post. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'steading-link',
      title: 'Send link to Steading',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'steading-page',
      title: 'Send this page to Steading',
      contexts: ['page', 'video', 'audio', 'image'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  send(info.menuItemId === 'steading-link' ? info.linkUrl : (tab?.url ?? info.pageUrl));
});
