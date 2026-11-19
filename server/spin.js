// Spin to win on Super Saver Deals.
//
// The shopper proves their mobile number with a Firebase phone OTP in the browser. The browser then
// sends us the Firebase ID token, and we check it here with firebase-admin (the same service account
// that saves data to Firestore). Only a verified number can spin, and the number is kept in the
// spin_players table, which firestore-sync.js copies to Firestore (comparezo/main/spin_players).
const crypto = require('node:crypto');

// Checks Firebase ID tokens. Returns { connected, verify(token) -> { uid, phone } }.
function createPhoneAuth({ credentials = null } = {}) {
  if (!credentials) return { connected: false, async verify() { throw new Error('Phone sign-in is not set up on the server.'); } };
  let auth = null;
  const getAuth = () => {
    if (!auth) {
      const admin = require('firebase-admin');
      const app = admin.initializeApp({ credential: admin.credential.cert(credentials) }, `comparezo-auth-${Date.now()}`);
      auth = app.auth();
    }
    return auth;
  };
  return {
    connected: true,
    projectId: credentials.project_id,
    async verify(token) {
      const t = await getAuth().verifyIdToken(token);
      return { uid: t.uid, phone: t.phone_number || null };
    },
  };
}

// FIREBASE_SERVICE_ACCOUNT holds the service account JSON, as-is or base64 (see firestore-sync.js).
function phoneAuthFromEnv(env = process.env) {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return createPhoneAuth();
  try {
    return createPhoneAuth({ credentials: JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) });
  } catch { return createPhoneAuth(); }
}

// The browser's Firebase config (apiKey, authDomain, projectId, appId). On Firebase Hosting the page
// reads /__/firebase/init.json itself; this is for pages served by Render. Set FIREBASE_WEB_CONFIG to
// the config object from Firebase console > Project settings > Your apps (JSON).
function webConfigFromEnv(env = process.env) {
  const raw = (env.FIREBASE_WEB_CONFIG || '').trim();
  if (!raw) return null;
  try {
    const c = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return c && c.apiKey ? { apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId } : null;
  } catch { return null; }
}

// Today's date in India (YYYY-MM-DD), so "one spin a day" resets at midnight IST.
const indiaDay = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

// Records a spin for a verified phone number. `deals` are the deals on the wheel (from /api/deals).
// One spin per number per day: a second try the same day gets back the deal it already won.
function createSpins(db, { random = n => crypto.randomInt(n), now = () => new Date() } = {}) {
  const get = db.prepare('SELECT * FROM spin_players WHERE phone = ?');
  const insert = db.prepare(`INSERT INTO spin_players (phone, uid, consent_at, first_at, last_at, last_day, spins, last_deal_id, last_deal_title)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const update = db.prepare(`UPDATE spin_players SET uid = ?, last_at = ?, last_day = ?, spins = spins + 1, last_deal_id = ?, last_deal_title = ? WHERE phone = ?`);
  return {
    spin({ phone, uid, deals }) {
      const at = now();
      const day = indiaDay(at);
      const stamp = at.toISOString();
      const row = get.get(phone);
      if (row && row.last_day === day) return { already: true, dealId: row.last_deal_id };
      const index = random(deals.length);
      const deal = deals[index];
      if (row) update.run(uid, stamp, day, deal.id, deal.title, phone);
      else insert.run(phone, uid, stamp, stamp, stamp, day, deal.id, deal.title);
      return { already: false, index, dealId: deal.id };
    },
    list: () => db.prepare('SELECT phone, first_at, last_at, spins, last_deal_title FROM spin_players ORDER BY last_at DESC').all(),
  };
}

module.exports = { createPhoneAuth, phoneAuthFromEnv, webConfigFromEnv, createSpins, indiaDay };
