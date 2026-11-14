// Keeps the SQLite data safe in Firebase Firestore.
//
// The app still reads and writes SQLite, which is fast and simple. Render's free plan wipes the
// disk on every restart, so this module mirrors each table into Firestore:
//   - on start, restore() copies everything from Firestore back into SQLite, and
//   - after each change, sync() writes only the rows that changed (and deletes removed rows).
// Each table is a sub-collection under one root document, e.g. comparezo/main/products/12.
const crypto = require('node:crypto');

// Every table worth keeping, with its primary key. Order matters for restore (parents first).
const TABLES = [
  ['category_sets', ['name']],
  ['categories', ['id']],
  ['products', ['id']],
  ['offers', ['id']],
  ['listings', ['id']],
  ['purchases', ['id']],
  ['feed_state', ['key']],
  ['feed_seen', ['store', 'external_id']],
  ['my_deals', ['id']],
  ['earnings_manual', ['network', 'month']],
];

const docId = (key, row) => key.length === 1 && Number.isInteger(row[key[0]])
  ? String(row[key[0]])
  : Buffer.from(JSON.stringify(key.map(k => row[k]))).toString('base64url');
const hash = row => crypto.createHash('sha1').update(JSON.stringify(row)).digest('base64');
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const tableExists = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

// A Firestore backend. `backend` has loadAll(table) -> [row] and write(table, sets, deletes).
function firestoreBackend({ credentials, root = 'comparezo/main' } = {}) {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ credential: credentials ? admin.credential.cert(credentials) : admin.credential.applicationDefault() }, `comparezo-${Date.now()}`);
  const fs = app.firestore();
  const rootDoc = fs.doc(root);
  return {
    name: `Firestore (${credentials ? credentials.project_id : 'default project'}, ${root})`,
    async loadAll(table) {
      const snap = await rootDoc.collection(table).get();
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    },
    async write(table, sets, deletes) {
      const col = rootDoc.collection(table);
      const ops = [...sets.map(([id, row]) => b => b.set(col.doc(id), row)), ...deletes.map(id => b => b.delete(col.doc(id)))];
      for (let i = 0; i < ops.length; i += 400) {   // Firestore allows 500 writes per batch
        const batch = fs.batch();
        ops.slice(i, i + 400).forEach(op => op(batch));
        await batch.commit();
      }
    },
  };
}

// Reads FIREBASE_SERVICE_ACCOUNT (the service account JSON, as-is or base64) or
// GOOGLE_APPLICATION_CREDENTIALS (a path to that file). Returns null when neither is set.
function backendFromEnv(env = process.env) {
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const root = (env.FIRESTORE_ROOT || 'comparezo/main').trim();
  if (raw) {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    let credentials;
    try { credentials = JSON.parse(json); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service account key file.'); }
    return firestoreBackend({ credentials, root });
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return firestoreBackend({ root });
  return null;
}

function createSync(db, backend, { log = console } = {}) {
  const synced = new Map();   // table -> Map(docId -> hash) of what Firestore holds
  let running = null;
  let again = false;
  let timer = null;

  // Copy everything from Firestore into SQLite. Returns the number of rows restored.
  async function restore() {
    const data = [];
    for (const [table, key] of TABLES) data.push([table, key, await backend.loadAll(table)]);
    let total = 0;
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      for (const [table, key, docs] of data) {
        const seen = new Map();
        synced.set(table, seen);
        if (!docs.length || !tableExists(db, table)) continue;
        const cols = columns(db, table);
        db.prepare(`DELETE FROM ${table}`).run();
        for (const { data: row } of docs) {
          const use = cols.filter(c => c in row);
          db.prepare(`INSERT INTO ${table} (${use.join(', ')}) VALUES (${use.map(() => '?').join(', ')})`).run(...use.map(c => row[c]));
          total++;
        }
        // Remember what Firestore holds, hashed the same way sync() will hash it.
        for (const row of db.prepare(`SELECT * FROM ${table}`).all()) seen.set(docId(key, { ...row }), hash({ ...row }));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
    return total;
  }

  async function syncOnce() {
    let written = 0;
    for (const [table, key] of TABLES) {
      if (!tableExists(db, table)) continue;
      const before = synced.get(table) || new Map();
      const now = new Map();
      const sets = [];
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const plain = { ...row };   // node:sqlite rows have a null prototype
        const id = docId(key, plain);
        const h = hash(plain);
        now.set(id, h);
        if (before.get(id) !== h) sets.push([id, plain]);
      }
      const deletes = [...before.keys()].filter(id => !now.has(id));
      if (sets.length || deletes.length) {
        await backend.write(table, sets, deletes);
        written += sets.length + deletes.length;
      }
      synced.set(table, now);
    }
    return written;
  }

  // Save changes now. Calls made while a save is running are folded into one more save.
  function sync() {
    if (running) { again = true; return running; }
    running = (async () => {
      let written = 0;
      try {
        do { again = false; written += await syncOnce(); } while (again);
        if (written) log.log(`Saved ${written} change${written === 1 ? '' : 's'} to Firestore.`);
        return written;
      } catch (e) {
        log.error('Saving to Firestore failed, will retry:', e.message);
        later(30_000);
        return 0;
      } finally { running = null; }
    })();
    return running;
  }

  // Save a moment after a change, so a burst of edits becomes one save.
  function later(ms = 1500) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sync(); }, ms);
    timer.unref?.();
  }

  return { restore, sync, later, name: backend.name };
}

module.exports = { createSync, backendFromEnv, firestoreBackend, TABLES };
