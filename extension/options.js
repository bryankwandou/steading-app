const DEFAULT_PORT = 3000;

const input = document.getElementById('port');
const saved = document.getElementById('saved');

chrome.storage.sync.get({ port: DEFAULT_PORT }).then(({ port }) => {
  input.value = port;
});

let timer = null;

// Saved as you type rather than behind a button: there is one field, and a Save button
// you can forget to press is a worse failure than a write that happens twice.
input.addEventListener('input', () => {
  const port = Number(input.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    saved.textContent = 'Enter a port between 1 and 65535.';
    return;
  }

  clearTimeout(timer);
  timer = setTimeout(async () => {
    await chrome.storage.sync.set({ port });
    saved.textContent = `Saved. Links will open at 127.0.0.1:${port}.`;
  }, 250);
});
