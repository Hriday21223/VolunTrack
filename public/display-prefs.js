// Applies this device's display preferences (theme, text size, high contrast,
// easy-read font)
// to <html> before the first paint. Loaded as a plain, render-blocking script
// in index.html's <head>: the prerendered pages (/login, /help, /terms, …)
// show their HTML before the app bundle runs, so waiting for main.jsx would
// flash the default size first. It is a file rather than an inline script
// because the CSP allows only 'self' scripts. Keep in step with
// src/hooks/useDisplayPrefs.js and src/hooks/useTheme.js.
(function () {
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (e) {
      return fallback
    }
  }
  var html = document.documentElement
  html.classList.toggle('dark', read('voluntrack:theme', 'dark') === 'dark')
  var size = read('voluntrack:text-size', 'default')
  if (size === 'large' || size === 'xlarge') html.setAttribute('data-text-size', size)
  if (read('voluntrack:contrast', 'normal') === 'high') html.setAttribute('data-contrast', 'high')
  if (read('voluntrack:font', 'default') === 'easy') html.setAttribute('data-font', 'easy')
})()
