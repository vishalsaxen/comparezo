const { seedCategories } = require('./categories');

// The app starts with categories only. Products come from the "Add products" admin page,
// server/catalog.json (loaded on every start) and the store feeds. Nothing here is sample data.
function seed(db) {
  return seedCategories(db);
}

module.exports = { seed };
