// Runs first on every page.
// 1. Works out where the API lives. On Render the page and the API share one address. On Firebase
//    Hosting (comparezo.web.app) the page is static, so API calls go to the Render server.
// 2. On the home page, shows the shop-shutter gate until the server answers and the first products
//    have loaded, then rolls it up. The free Render server sleeps when idle and can take up to a
//    minute to wake, so the gate keeps people company instead of a blank screen.
(() => {
  const RENDER = 'https://comparezo.onrender.com';
  const h = location.hostname;
  const sameOrigin = h === 'localhost' || h === '127.0.0.1' || h.endsWith('.onrender.com') || location.protocol === 'file:';
  const API = window.CZ_API = sameOrigin ? '' : RENDER;

  // Send /api/... requests to the API server.
  if (API) {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => realFetch(typeof url === 'string' && url.startsWith('/api/') ? API + url : url, opts);
  }

  const gate = document.getElementById('gate');
  const status = document.getElementById('gateStatus');
  const say = msg => { if (status) status.textContent = msg; };
  const started = Date.now();

  // Keep asking until the server sends real JSON back (a waking server can answer with an HTML page).
  async function waitForServer() {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      try {
        const r = await fetch('/api/categories', { cache: 'no-store', signal: ctl.signal });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) { await r.json(); return; }
      } catch { /* still waking */ } finally { clearTimeout(t); }
      const s = Math.round((Date.now() - started) / 1000);
      say(s < 8 ? 'Unlocking the shutter…' : s < 75 ? `Waking up the shop. This can take up to a minute on the free server (${s}s).` : 'Still opening. Thanks for waiting.');
      await new Promise(r => setTimeout(r, Math.min(1500 + attempt * 500, 4000)));
    }
  }
  window.czReady = waitForServer().then(() => {
    // Cuelinks script (turns store links into commission links) comes from the API server.
    const s = document.createElement('script');
    s.src = API + '/affiliate.js'; s.defer = true;
    document.body.appendChild(s);
  });

  // The home page calls this once its first products are on screen.
  window.czOpenGate = (error) => {
    if (!gate || gate.classList.contains('open')) return;
    if (error) { say(error); gate.classList.add('stuck'); return; }
    // Keep the shutter down a moment on fast loads so it doesn't flash.
    const wait = Math.max(0, 600 - (Date.now() - started));
    setTimeout(() => {
      gate.classList.add('open');
      gate.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('gated');
      gate.addEventListener('transitionend', () => gate.remove(), { once: true });
      setTimeout(() => gate.remove(), 2000);
    }, wait);
  };
})();
