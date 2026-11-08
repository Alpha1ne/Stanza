// Sets the saved theme before the page paints, so there is no flash of the wrong colours.
// Kept as its own file so the Content-Security-Policy can forbid inline scripts.
try {
  var saved = localStorage.getItem('stanza-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) {}
