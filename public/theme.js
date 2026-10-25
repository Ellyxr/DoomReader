// Apply the saved theme before first paint so dark mode doesn't flash white. Keep in sync with src/hooks/prefs.ts.
// A file of its own (not inline in index.html) so the Content-Security-Policy can forbid inline scripts.
try {
  var p = JSON.parse(localStorage.getItem('doomreader:prefs') || '{}')
  var t = p.theme || 'system'
  var d = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', d)
  document.documentElement.style.colorScheme = d ? 'dark' : 'light'
} catch {}
