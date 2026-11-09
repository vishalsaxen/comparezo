// Categories and sub-categories live in the database, so they can be added,
// renamed, reordered or removed while the app is running (see /categories.html).
// The structure follows GiaZoNest: a category holds sub-categories, a sub-category can
// hold types (sub-sub-categories), and "Other" always sorts last.

const STARTER = [
  ['Fashion & Clothing', ["Men's Wear", "Women's Wear", "Kids' Wear", 'Footwear', 'Bags & Accessories', 'Leather', 'Other']],
  ['Electronics', []],
  ['Mobiles', []],
  ['Kitchen', []],
  ['Home', []],
  ['Beauty', []],
];

// Starting category sets, oldest first. Each set is added once, the first time the app starts
// with it; deleting a category afterwards doesn't bring it back. To add more, append a new set.
const SETS = [
  ['starter', STARTER],
  ['giazonest', require('./category-sets/giazonest')],
];

const MAX_NAME = 40;

class CategoryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Add any starting category sets this database hasn't had yet. Returns true if it added anything.
function seedCategories(db) {
  db.exec('CREATE TABLE IF NOT EXISTS category_sets (name TEXT PRIMARY KEY, added_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const done = new Set(db.prepare('SELECT name FROM category_sets').all().map(r => r.name));
  // Databases from before sets were tracked already have the starter set.
  if (!done.size && db.prepare('SELECT COUNT(*) AS c FROM categories').get().c > 0) {
    db.prepare("INSERT INTO category_sets (name) VALUES ('starter')").run();
    done.add('starter');
  }
  const todo = SETS.filter(([name]) => !done.has(name));
  if (!todo.length) return false;

  const findTopId = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name = ? COLLATE NOCASE');
  const findSub = db.prepare('SELECT id FROM categories WHERE parent_id = ? AND name = ? COLLATE NOCASE');
  const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories WHERE COALESCE(parent_id, 0) = ?');
  const ins = db.prepare('INSERT INTO categories (name, parent_id, position) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const [setName, list] of todo) {
      for (const [name, subs] of list) {
        // A category that already exists keeps its place and gains any missing sub-categories.
        const id = findTopId.get(name)?.id ?? Number(ins.run(name, null, nextPos.get(0).p).lastInsertRowid);
        for (const entry of subs) {
          const [sub, types = []] = Array.isArray(entry) ? entry : [entry];
          const subId = findSub.get(id, sub)?.id ?? Number(ins.run(sub, id, nextPos.get(id).p).lastInsertRowid);
          for (const type of types) if (!findSub.get(subId, type)) ins.run(type, subId, nextPos.get(subId).p);
        }
      }
      db.prepare('INSERT INTO category_sets (name) VALUES (?)').run(setName);
    }
    // Data saved before sub-categories existed used "Fashion" with no sub-category.
    for (const t of ['products', 'listings', 'purchases']) db.prepare(`UPDATE ${t} SET category = ? WHERE category = 'Fashion'`).run('Fashion & Clothing');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

const ORDER = "ORDER BY (name = 'Other'), position, id";

// [{ id, name, subcategories: [{ id, name, types: [{ id, name }] }] }]
function categoryTree(db) {
  const kids = new Map();
  for (const r of db.prepare(`SELECT id, name, parent_id FROM categories WHERE parent_id IS NOT NULL ${ORDER}`).all()) {
    if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
    kids.get(r.parent_id).push(r);
  }
  const of = id => kids.get(id) || [];
  return db.prepare(`SELECT id, name FROM categories WHERE parent_id IS NULL ${ORDER}`).all().map(c => ({
    id: c.id, name: c.name,
    subcategories: of(c.id).map(s => ({ id: s.id, name: s.name, types: of(s.id).map(t => ({ id: t.id, name: t.name })) })),
  }));
}

// How deep a category is: 0 = category, 1 = sub-category, 2 = type.
function depthOf(db, c) {
  let d = 0;
  while (c.parent_id != null) { c = getOne(db, c.parent_id); d++; }
  return d;
}

// The names along a category's path, e.g. ['School & Education', 'Music', 'Sitar'].
function pathOf(db, c) {
  const names = [c.name];
  while (c.parent_id != null) { c = getOne(db, c.parent_id); names.unshift(c.name); }
  return names;
}

const LEVEL_COLS = ['category', 'sub_category', 'type'];
// SQL condition and arguments matching rows filed under this path (or anywhere below it).
function whereUnder(names) {
  return { sql: names.map((_, i) => `${LEVEL_COLS[i]} = ?`).join(' AND '), args: names };
}

function findTop(db, name) {
  return name ? db.prepare('SELECT * FROM categories WHERE parent_id IS NULL AND name = ?').get(String(name)) : undefined;
}

// Checks the category / sub-category / type a seller sent. Returns an error message, or null when it is valid.
function checkPath(db, category, subCategory, type) {
  const top = findTop(db, category);
  if (!top) return 'Pick a category.';
  const childOf = (id, name) => db.prepare('SELECT * FROM categories WHERE parent_id = ? AND name = ?').get(id, name);
  const hasKids = id => db.prepare('SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1').get(id);
  if (!hasKids(top.id)) return subCategory || type ? 'This category has no sub-categories.' : null;
  const sub = subCategory && childOf(top.id, subCategory);
  if (!sub) return 'Pick a sub-category.';
  if (!hasKids(sub.id)) return type ? 'This sub-category has no types.' : null;
  if (!type || !childOf(sub.id, type)) return 'Pick a type.';
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
  if (clash) throw new CategoryError(409, parentId ? `"${name}" is already listed here.` : `"${name}" is already a category.`);
}

function addCategory(db, { name, parentId = null }) {
  name = cleanName(name);
  if (parentId != null) {
    const parent = getOne(db, parentId);
    if (depthOf(db, parent) >= 2) throw new CategoryError(400, 'Types are the deepest level. Add it to a category or sub-category instead.');
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
    const names = pathOf(db, c), col = LEVEL_COLS[names.length - 1], w = whereUnder(names);
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, c.id);
    for (const t of names.length === 1 ? ['products', 'listings', 'purchases'] : ['products', 'listings']) {
      db.prepare(`UPDATE ${t} SET ${col} = ? WHERE ${w.sql}`).run(name, ...w.args);
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

// Delete a category, sub-category or type (with everything under it), but only when no product or listing uses it.
function deleteCategory(db, id) {
  const c = getOne(db, id);
  const w = whereUnder(pathOf(db, c));
  const used = ['products', 'listings'].reduce((n, t) => n + db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE ${w.sql}`).get(...w.args).c, 0);
  if (used) throw new CategoryError(409, `"${c.name}" is used by ${used} product${used === 1 ? '' : 's'} or listing${used === 1 ? '' : 's'}. Move them first, or rename it instead.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(c.id);
  return { ok: true };
}

module.exports = { seedCategories, categoryTree, findTop, checkPath, addCategory, renameCategory, moveCategory, deleteCategory, CategoryError };
