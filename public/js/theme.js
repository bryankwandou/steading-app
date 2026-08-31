/**
 * Theme.
 *
 * Three states, not two: light, dark, and "follow the system", which is the default and
 * the one most people actually want. The stored value is only ever 'light' or 'dark';
 * absence of a stored value *is* the system state, so the OS switching at sunset keeps
 * working until the user makes an explicit choice.
 *
 * The initial paint is handled by a tiny inline script in index.html -- by the time this
 * module loads, the correct theme is already on screen. Everything here is about the
 * switch afterwards.
 */

const STORAGE_KEY = 'steading.theme';
const ANIM_CLASS = 'theme-shifting';
const ANIM_MS = 200;

const query = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

let timer = null;

function stored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** What is actually on screen right now. */
export function resolvedTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The user's *preference*: 'light', 'dark', or 'system'. */
export function themePreference() {
  return stored() ?? 'system';
}

/**
 * Paint a theme.
 *
 * Colour transitions are switched on for the length of the crossfade and then switched
 * off again. Leaving them on permanently makes every unrelated hover and state change
 * lag by the same 200 ms, which is what a janky theme toggle usually is.
 */
function paint(theme, { animate }) {
  const root = document.documentElement;
  if (root.dataset.theme === theme && animate) return;

  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add(ANIM_CLASS);
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove(ANIM_CLASS), ANIM_MS);
  }

  root.dataset.theme = theme;
  // Tells the browser to match form controls, scrollbars and the caret to the theme.
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1220' : '#ffffff');

  for (const fn of listeners) fn(theme);
}

/** Flip to the opposite of what is currently showing, and remember it. */
export function toggleTheme() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  paint(next, { animate: true });
  return next;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  paint(stored() ?? (query.matches ? 'dark' : 'light'), { animate: false });

  // Only follow the system while the user has not overridden it.
  const follow = (event) => {
    if (stored() === null) paint(event.matches ? 'dark' : 'light', { animate: true });
  };
  if (query.addEventListener) query.addEventListener('change', follow);
  else query.addListener(follow); // older WebKit on iOS
}
