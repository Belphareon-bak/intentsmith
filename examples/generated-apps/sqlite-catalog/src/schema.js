export function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      priceCents INTEGER NOT NULL CHECK(priceCents >= 0)
    )
  `);
}
