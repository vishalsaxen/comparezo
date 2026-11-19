// Spin to win: a popup on Super Saver Deals.
//
// The first time a shopper opens Super Saver Deals in a browser session, a wheel with 4 of the
// current deals pops up. Closing it (× or Esc or "See all deals") shows the deals page as usual.
// To spin, the shopper verifies their mobile number with a one-time code (Firebase phone sign-in).
// The server checks the Firebase token, saves the number in Firestore and picks the winning deal.
// It does not pop up again in the same session, or on a day this browser has already spun.
(() => {
  const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const SEEN_KEY = 'cz-spin-shown';     // sessionStorage: popup already shown this session
  const DAY_KEY = 'cz-spin-day';        // localStorage: India date of this browser's last spin
  const COLORS = [['#0f5a4f', '#ffffff'], ['#f2a516', '#14201d'], ['#1f7a6c', '#ffffff'], ['#f7c35a', '#14201d']];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (kind, key, val) => { try { const s = window[kind]; if (val === undefined) return s.getItem(key); s.setItem(key, val); } catch { return null; } };
  const indiaDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let config = null;      // { enabled, firebase }
  let auth = null;        // firebase.auth()
  let verifier = null;    // invisible reCAPTCHA
  let confirmation = null;
  let wheelDeals = [];
  let el = null;          // the popup
  let lastFocus = null;
  let spun = false;

  // Pick 4 different deals at random (fewer if there are fewer deals).
  function pickFour(deals) {
    const a = deals.filter(d => d && d.id && d.title && d.url);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, 4);
  }

  // Wrap a title onto at most `lines` lines of about `width` characters, with … when cut.
  function wrap(text, width, lines) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').map(w => w.length > width ? w.slice(0, width - 1) + '…' : w);
    const out = [];
    let i = 0;
    while (i < words.length && out.length < lines) {
      let line = words[i++];
      while (i < words.length && (line + ' ' + words[i]).length <= width) line += ' ' + words[i++];
      out.push(line);
    }
    if (i < words.length) out[lines - 1] = out[lines - 1].replace(/…$/, '').slice(0, width - 1).trimEnd() + '…';
    return out;
  }

  // The wheel as SVG. Segment i is centred at i*seg + seg/2 degrees, clockwise from the pointer (3 o'clock).
  function wheelSvg(deals) {
    const n = deals.length, seg = 360 / n, R = 150, C = 160;
    const pt = (deg, r) => [C + r * Math.cos(deg * Math.PI / 180), C + r * Math.sin(deg * Math.PI / 180)];
    const parts = deals.map((d, i) => {
      const [bg, fg] = COLORS[i % COLORS.length];
      const a0 = i * seg, a1 = a0 + seg, mid = a0 + seg / 2;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
      const path = n === 1 ? `<circle cx="${C}" cy="${C}" r="${R}" fill="${bg}"/>`
        : `<path d="M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${bg}" stroke="#fff" stroke-width="2"/>`;
      const lines = wrap(d.title, 15, 3);
      const storeLine = d.store ? `<tspan x="0" dy="0" font-weight="800" font-size="12">${esc(d.store.slice(0, 16))}</tspan>` : '';
      const tl = lines.map((l, k) => `<tspan x="0" dy="${k === 0 && !d.store ? 0 : 14}">${esc(l)}</tspan>`).join('');
      const total = (d.store ? 1 : 0) + lines.length;
      // Text runs along the segment's centre line, reading outwards, like the labels on a prize wheel.
      return `${path}<g transform="translate(${C} ${C}) rotate(${mid}) translate(86 0)"><text fill="${fg}" font-size="11.5" font-weight="700" text-anchor="middle" transform="translate(0 ${(-(total - 1) * 14) / 2 + 4})">${storeLine}${tl}</text></g>`;
    }).join('');
    return `<svg class="spin-wheel" viewBox="0 0 320 320" aria-hidden="true"><circle cx="${C}" cy="${C}" r="${R + 8}" fill="#fff"/>${parts}<circle cx="${C}" cy="${C}" r="44" fill="#fff" stroke="#14201d" stroke-opacity=".12" stroke-width="2"/></svg>`;
  }

  function build() {
    el = document.createElement('div');
    el.className = 'spin-backdrop';
    el.innerHTML = `
      <div class="spin-card" role="dialog" aria-modal="true" aria-labelledby="spinTitle">
        <button type="button" class="spin-close" aria-label="Close and see all deals">×</button>
        <div class="spin-wheel-box">
          <div class="spin-rotor">${wheelSvg(wheelDeals)}</div>
          <div class="spin-pointer" aria-hidden="true"></div>
          <div class="spin-hub" aria-hidden="true"><span class="wm"><span class="wm-c">Compare</span><span class="wm-st"><span class="wm-z">zo</span><span class="wm-e">E</span></span></span></div>
        </div>
        <div class="spin-side">
          <h2 id="spinTitle">Spin to win! <span aria-hidden="true">🎉</span></h2>
          <p class="spin-lede">Feeling lucky? Verify your mobile number and spin for one of today's Super Saver Deals.</p>

          <form class="spin-step" data-step="phone" novalidate>
            <label class="spin-phone"><span class="spin-cc">IN +91</span>
              <input id="spinPhone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" aria-label="Mobile number, 10 digits">
            </label>
            <label class="spin-consent"><input type="checkbox" id="spinConsent">
              <span>I agree that Comparezo may save my mobile number to verify me and send me deals. I can ask for it to be deleted any time at <a href="mailto:gizee@giazonest.com">gizee@giazonest.com</a>.</span></label>
            <button type="submit" class="btn spin-go" id="spinSend">Send OTP</button>
          </form>

          <form class="spin-step" data-step="code" novalidate hidden>
            <p class="spin-sent">We sent a 6-digit code to <b id="spinTo"></b>. <button type="button" class="spin-link" id="spinChange">Change number</button></p>
            <input id="spinCode" class="spin-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="6-digit code">
            <button type="submit" class="btn spin-go" id="spinVerify">Verify and spin</button>
          </form>

          <div class="spin-step" data-step="ready" hidden>
            <p class="spin-sent">Verified as <b id="spinAs"></b>. <button type="button" class="spin-link" id="spinOther">Use another number</button></p>
            <label class="spin-consent"><input type="checkbox" id="spinConsent2">
              <span>I agree that Comparezo may save my mobile number to verify me and send me deals. I can ask for it to be deleted any time at <a href="mailto:gizee@giazonest.com">gizee@giazonest.com</a>.</span></label>
            <button type="button" class="btn spin-go" id="spinNow">Try my luck</button>
          </div>

          <div class="spin-step spin-result" data-step="result" hidden aria-live="polite"></div>

          <p class="spin-msg" id="spinMsg" role="alert"></p>
          <button type="button" class="spin-link spin-skip" id="spinSkip">No thanks, show me all deals</button>
          <div id="spinCaptcha"></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    const $ = id => el.querySelector('#' + id);

    el.querySelector('.spin-close').addEventListener('click', close);
    $('spinSkip').addEventListener('click', close);
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {   // keep focus inside the popup
        const f = [...el.querySelectorAll('button, input, a[href]')].filter(x => x.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    $('spinPhone').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });
    $('spinCode').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    el.querySelector('[data-step="phone"]').addEventListener('submit', e => { e.preventDefault(); sendCode(); });
    el.querySelector('[data-step="code"]').addEventListener('submit', e => { e.preventDefault(); verifyCode(); });
    $('spinChange').addEventListener('click', () => step('phone'));
    $('spinOther').addEventListener('click', async () => { try { await auth.signOut(); } catch { /* ignore */ } step('phone'); });
    $('spinNow').addEventListener('click', () => {
      if (!$('spinConsent2').checked) return say('Please tick the box to agree, then spin.');
      spin(auth.currentUser);
    });
  }

  const q = id => el.querySelector('#' + id);
  function say(msg) { q('spinMsg').textContent = msg || ''; }
  function step(name) {
    el.querySelectorAll('.spin-step').forEach(s => { s.hidden = s.dataset.step !== name; });
    say('');
    const first = el.querySelector(`.spin-step[data-step="${name}"] input, .spin-step[data-step="${name}"] .btn`);
    if (first) first.focus();
  }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = ok; s.onerror = () => fail(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  async function firebaseAuth() {
    if (auth) return auth;
    await loadScript(FIREBASE_SDK + 'firebase-app-compat.js');
    await loadScript(FIREBASE_SDK + 'firebase-auth-compat.js');
    const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(config.firebase);
    auth = app.auth();
    auth.languageCode = 'en';
    await new Promise(ok => { const off = auth.onAuthStateChanged(() => { off(); ok(); }); });
    return auth;
  }
  function freshVerifier() {
    try { if (verifier) verifier.clear(); } catch { /* already gone */ }
    q('spinCaptcha').innerHTML = '';
    verifier = new window.firebase.auth.RecaptchaVerifier('spinCaptcha', { size: 'invisible' });
    return verifier;
  }

  // Plain-English messages for Firebase's error codes.
  function authError(e) {
    const code = (e && e.code) || '';
    const m = {
      'auth/invalid-phone-number': 'That mobile number does not look right. Please enter the 10 digits.',
      'auth/missing-phone-number': 'Please enter your 10-digit mobile number.',
      'auth/too-many-requests': 'Too many tries from this device. Please try again later.',
      'auth/quota-exceeded': 'We have sent too many codes today. Please try again tomorrow.',
      'auth/invalid-verification-code': 'That code is not right. Please check the SMS and try again.',
      'auth/code-expired': 'That code has expired. Please ask for a new one.',
      'auth/operation-not-allowed': 'Spin to win is still being set up. Please check back soon.',
      'auth/billing-not-enabled': 'Spin to win is still being set up. Please check back soon.',
      'auth/unauthorized-domain': 'Spin to win is still being set up for this address. Please check back soon.',
      'auth/captcha-check-failed': 'The security check failed. Please try again.',
      'auth/network-request-failed': 'No internet connection. Please check it and try again.',
    };
    // Show Firebase's own code in brackets so the owner can tell which setting is missing.
    const setup = {
      'auth/operation-not-allowed': 'Phone sign-in is off in Firebase',
      'auth/billing-not-enabled': 'Firebase needs the Blaze plan to send SMS',
      'auth/unauthorized-domain': 'this address is not in Firebase Authorized domains',
    }[code];
    if (setup) return `${m[code]} (${setup}: ${code})`;
    return m[code] || (e && e.message ? `Something went wrong: ${e.message}` : 'Something went wrong. Please try again.');
  }

  async function sendCode() {
    const num = q('spinPhone').value;
    if (!/^[6-9]\d{9}$/.test(num)) return say('Please enter a 10-digit Indian mobile number.');
    if (!q('spinConsent').checked) return say('Please tick the box to agree, then we can send the code.');
    const btn = q('spinSend');
    busy(btn, true, 'Sending…'); say('');
    try {
      await firebaseAuth();
      confirmation = await auth.signInWithPhoneNumber('+91' + num, freshVerifier());
      q('spinTo').textContent = '+91 ' + num.slice(0, 5) + ' ' + num.slice(5);
      q('spinCode').value = '';
      step('code');
    } catch (e) {
      say(authError(e));
      try { freshVerifier(); } catch { /* ignore */ }
    } finally { busy(btn, false, 'Send OTP'); }
  }

  async function verifyCode() {
    const code = q('spinCode').value;
    if (!/^\d{6}$/.test(code)) return say('Please enter the 6-digit code from the SMS.');
    const btn = q('spinVerify');
    busy(btn, true, 'Checking…'); say('');
    try {
      const cred = await confirmation.confirm(code);
      await spin(cred.user);
    } catch (e) { say(authError(e)); }
    finally { busy(btn, false, 'Verify and spin'); }
  }

  // Ask the server which deal won, then turn the wheel so that deal stops at the pointer.
  async function spin(user) {
    if (spun) return;
    say('');
    let data;
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/spin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ consent: true, deals: wheelDeals.map(d => d.id) }) });
      data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not spin. Please try again.');
    } catch (e) { return say(e.message); }
    spun = true;
    store('localStorage', DAY_KEY, indiaDay());
    el.querySelectorAll('.spin-step').forEach(s => { s.hidden = true; });
    q('spinSkip').hidden = true;
    const show = () => result(data);
    if (data.index < 0) return show();   // already spun today, and that deal is not on this wheel
    const seg = 360 / wheelDeals.length;
    const mid = data.index * seg + seg / 2;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const turns = reduced() ? 1 : 6;
    const rotor = el.querySelector('.spin-rotor');
    const ms = reduced() ? 600 : 4800;
    rotor.style.transition = `transform ${ms}ms cubic-bezier(.12,.72,.12,1)`;
    rotor.style.transform = `rotate(${turns * 360 + (360 - mid) + jitter}deg)`;
    setTimeout(show, ms + 200);
  }

  function result({ already, deal }) {
    const box = el.querySelector('[data-step="result"]');
    const url = deal ? ((deal.url.startsWith('/api/') ? (window.CZ_API || '') : '') + deal.url) : '';
    box.innerHTML = deal ? `
      <p class="spin-won">${already ? 'You have already spun today. Your deal:' : 'You won this deal!'}</p>
      <div class="spin-prize">
        <div class="spin-prize-t">${esc(deal.title)}</div>
        <div class="sub">${esc(deal.store || '')}</div>
        ${deal.code ? `<div class="spin-code-row">Code <span class="chip">${esc(deal.code)}</span><button type="button" class="spin-link" data-copy="${esc(deal.code)}">Copy</button></div>` : '<div class="sub">No code needed</div>'}
      </div>
      <div class="spin-actions"><a class="btn spin-go" href="${esc(url)}" target="_blank" rel="noopener sponsored">Get deal ↗</a>
      <button type="button" class="btn btn-ghost" data-close>See all deals</button></div>
      ${already ? '<p class="sub">You can spin again tomorrow.</p>' : ''}`
      : `<p class="spin-won">You have already spun today.</p><p class="sub">You can spin again tomorrow. Today's deals are all on the Super Saver Deals page.</p>
      <div class="spin-actions"><button type="button" class="btn spin-go" data-close>See all deals</button></div>`;
    box.hidden = false;
    box.querySelector('[data-close]').addEventListener('click', close);
    const copy = box.querySelector('[data-copy]');
    if (copy) copy.addEventListener('click', () => { navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.textContent = 'Copied'; }).catch(() => {}); });
    (box.querySelector('.btn') || box).focus();
  }

  function open() {
    store('sessionStorage', SEEN_KEY, '1');
    lastFocus = document.activeElement;
    build();
    document.documentElement.classList.add('spin-open');
    // If this browser already verified a number (Firebase remembers it), skip the code.
    firebaseAuth().then(a => {
      if (spun || !el) return;
      const u = a.currentUser;
      if (u && u.phoneNumber && !el.querySelector('[data-step="code"]:not([hidden])')) {
        q('spinAs').textContent = u.phoneNumber.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
        step('ready');
      }
    }).catch(() => { /* the phone step still works and shows the error on Send */ });
    setTimeout(() => { const i = q('spinPhone'); if (i && !i.closest('[hidden]')) i.focus(); }, 50);
  }

  function close() {
    if (!el) return;
    try { if (verifier) verifier.clear(); } catch { /* ignore */ }
    verifier = null;
    el.remove(); el = null;
    document.documentElement.classList.remove('spin-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Called by app.js when Super Saver Deals is shown and the deals have loaded.
  async function offer(deals) {
    if (el || spun) return;
    // ?spin in the address (e.g. /?spin#deals) always shows the wheel, so the owner can test it again.
    const force = /[?&]spin\b/.test(location.search);
    if (!force && (store('sessionStorage', SEEN_KEY) || store('localStorage', DAY_KEY) === indiaDay())) return;
    if (/[?&]nospin\b/.test(location.search)) return;
    wheelDeals = pickFour(deals || []);
    if (wheelDeals.length < 2) return;
    try {
      if (!config) {
        config = await (await fetch('/api/spin/config')).json();
        // On Firebase Hosting, the project's web config is served at /__/firebase/init.json.
        if (config.enabled && !config.firebase && window.CZ_API) {
          const r = await fetch('/__/firebase/init.json').catch(() => null);
          const c = r && r.ok ? await r.json().catch(() => null) : null;
          if (c && c.apiKey) config.firebase = c;
        }
      }
    } catch { return; }
    if (!config.enabled || !config.firebase) return;   // not set up yet: no popup
    // Wait for the shop shutter (gate.js) to roll up first, so the wheel is not hidden behind it.
    for (let i = 0; i < 150 && document.getElementById('gate'); i++) await new Promise(ok => setTimeout(ok, 200));
    if (document.getElementById('gate')) return;
    if (location.hash !== '#deals' || el) return;     // they left the tab meanwhile
    open();
  }

  window.czSpin = { offer, _wrap: wrap };
})();
