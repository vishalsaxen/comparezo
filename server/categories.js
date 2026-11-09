// Categories and sub-categories live in the database, so they can be added,
// renamed, reordered or removed while the app is running (see /categories.html).
// The structure follows giazonest: a category holds a list of sub-categories,
// and "Other" always sorts last.

const STARTER = [
  ['Fashion & Clothing', ["Men's Wear", "Women's Wear", "Kids' Wear", 'Footwear', 'Bags & Accessories', 'Leather', 'Other']],
  ['Electronics', []],
  ['Mobiles', []],
  ['Kitchen', []],
  ['Home', []],
  ['Beauty', []],
];

const MAX_NAME = 40;

class CategoryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Fill an empty categories table. Returns true if it seeded anything.
function seedCategories(db) {
  if (db.prepare('SELECT COUNT(*) AS c FROM categories').get().c > 0) return false;
  const ins = db.prepare('INSERT INTO categories (name, parent_id, position) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    STARTER.forEach(([name, subs], i) => {
      const id = Number(ins.run(name, null, i).lastInsertRowid);
      subs.forEach((s, j) => ins.run(s, id, j));
    });
    // Data saved before this change used "Fashion" with no sub-category.
    for (const t of ['products', 'listings', 'purchases']) db.prepare(`UPDATE ${t} SET category = ? WHERE category = 'Fashion'`).run('Fashion & Clothing');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

const ORDER = "ORDER BY (name = 'Other'), position, id";

// [{ id, name, subcategories: [{ id, name }] }]
function categoryTree(db) {
  const subs = db.prepare(`SELECT id, name, parent_id FROM categories WHERE parent_id IS NOT NULL ${ORDER}`).all();
  return db.prepare(`SELECT id, name FROM categories WHERE parent_id IS NULL ${ORDER}`).all().map(c => ({
    id: c.id, name: c.name,
    subcategories: subs.filter(s => s.parent_id === c.id).map(s => ({ id: s.id, name: s.name })),
  }));
}

function findTop(db, name) {
  return name ? db.prepare('SELECT * FROM categories WHERE parent_id IS NULL AND name = ?').get(String(name)) : undefined;
}

// Checks a category / sub-category pair sent by a seller. Returns an error message, or null when it is valid.
function checkPair(db, category, subCategory) {
  const top = findTop(db, category);
  if (!top) return 'Pick a category.';
  const subs = db.prepare('SELECT name FROM categories WHERE parent_id = ?').all(top.id).map(s => s.name);
  if (subs.length && !subs.includes(subCategory)) return 'Pick a sub-category.';
  if (!subs.length && subCategory) return 'This category has no sub-categories.';
  return null;
}

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new CategoryError(400, 'Enter a name.');
  if (n.length > MAX_NAME) throw new CategoryError(400, `Keep the name under ${MAX_NAME} characters.`);
  return n;
}

function getOne(db, id) {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(id));
  if (!c) throw new CategoryError(404, 'Category not found.');
  return c;
}

function assertUnique(db, name, parentId, exceptId = 0) {
  const clash = db.prepare('SELECT id FROM categories WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(parentId || 0, name, exceptId);
  if (clash) throw new CategoryError(409, parentId ? `"${name}" is already a sub-category here.` : `"${name}" is already a category.`);
}

function addCategory(db, { name, parentId = null }) {
  name = cleanName(name);
  if (parentId != null) {
    const parent = getOne(db, parentId);
    if (parent.parent_id != null) throw new CategoryError(400, 'Sub-categories can only be added to a top-level category.');
    parentId = parent.id;
  }
  assertUnique(db, name, parentId);
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories WHERE COALESCE(parent_id, 0) = ?').get(parentId || 0).p;
  return getOne(db, db.prepare('INSERT INTO categories (name, parent_id, position) VALUES (?, ?, ?)').run(name, parentId, pos).lastInsertRowid);
}

// Rename, and carry the new name onto products, listings and purchase history that used the old one.
function renameCategory(db, id, name) {
  const c = getOne(db, id);
  name = cleanName(name);
  if (name === c.name) return c;
  assertUnique(db, name, c.parent_id, c.id);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, c.id);
    if (c.parent_id == null) {
      for (const t of ['products', 'listings', 'purchases']) db.prepare(`UPDATE ${t} SET category = ? WHERE category = ?`).run(name, c.name);
    } else {
      const parent = getOne(db, c.parent_id);
      for (const t of ['products', 'listings']) db.prepare(`UPDATE ${t} SET sub_category = ? WHERE category = ? AND sub_category = ?`).run(name, parent.name, c.name);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getOne(db, c.id);
}

// Move one place up (-1) or down (+1) among its siblings.
function moveCategory(db, id, step) {
  const c = getOne(db, id);
  const siblings = db.prepare(`SELECT id FROM categories WHERE COALESCE(parent_id, 0) = ? ${ORDER}`).all(c.parent_id || 0).map(s => s.id);
  const i = siblings.indexOf(c.id), j = i + (step < 0 ? -1 : 1);
  if (j < 0 || j >= siblings.length) return c;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  const set = db.prepare('UPDATE categories SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try { siblings.forEach((sid, k) => set.run(k, sid)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getOne(db, c.id);
}

// Delete a category (with its sub-categories) or a sub-category, but only when no product or listing uses it.
function deleteCategory(db, id) {
  const c = getOne(db, id);
  let used;
  if (c.parent_id == null) {
    used = ['products', 'listings'].reduce((n, t) => n + db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE category = ?`).get(c.name).c, 0);
  } else {
    const parent = getOne(db, c.parent_id);
    used = ['products', 'listings'].reduce((n, t) => n + db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE category = ? AND sub_category = ?`).get(parent.name, c.name).c, 0);
  }
  if (used) throw new CategoryError(409, `"${c.name}" is used by ${used} product${used === 1 ? '' : 's'} or listing${used === 1 ? '' : 's'}. Move them first, or rename it instead.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
  return { ok: true };
}

module.exports = { seedCategories, categoryTree, findTop, checkPair, addCategory, renameCategory, moveCategory, deleteCategory, CategoryError };
