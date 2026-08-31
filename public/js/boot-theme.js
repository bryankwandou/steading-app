/**
 * Runs before the stylesheet is applied, so the page never flashes the wrong theme.
 *
 * Loaded as a blocking classic script in <head> rather than inlined, because the page
 * is served with a strict `script-src 'self'` policy and inline script would need an
 * exception. It is deliberately tiny; anything deferred would paint too late.
 *
 * theme.js owns everything after this point.
 */
(function () {
  try {
    var saved = localStorage.getItem('steading.theme');
    var dark = saved === 'dark'
      || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* storage blocked -- the light default in the markup already applies */
  }
})();
