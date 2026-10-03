// Apply the saved theme before first paint to avoid a flash.
try {
  const t = localStorage.getItem('fgc-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage unavailable */ }
