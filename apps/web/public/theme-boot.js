/*
 * Applies the stored appearance before the first paint so a visitor who chose
 * light never sees a dark flash. This lives in a separate file because the
 * server's Content-Security-Policy forbids inline scripts.
 */
(function () {
  try {
    var stored = window.localStorage.getItem('subwatch-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'light';
    if (stored === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#060a13' : '#f7f3ea');
  } catch (error) {
    // Storage is unavailable; the markup already defaults to the light appearance.
  }
})();
