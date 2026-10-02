import { DatabaseSync } from 'node:sqlite';
import { initialize } from './schema.js';
import { searchRows } from './query.js';

export function openStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  initialize(db);

  return {
    add(row) {
      if (!row || typeof row !== 'object') throw new Error('Invalid row');
      const { sku, name, quantity, priceCents } = row;
      if (sku == null || name == null || quantity == null || priceCents == null) {
        throw new Error('Missing required fields: sku, name, quantity, priceCents');
      }
      const stmt = db.prepare(
        'INSERT INTO books (sku, name, quantity, priceCents) VALUES (?, ?, ?, ?)'
      );
      const result = stmt.run(sku, name, quantity, priceCents);
      return {
        id: Number(result.lastInsertRowid),
        sku,
        name,
        quantity,
        priceCents
      };
    },

    get(id) {
      const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
      const row = stmt.get(Number(id));
      if (!row) return null;
      return {
        id: Number(row.id),
        sku: row.sku,
        name: row.name,
        quantity: Number(row.quantity),
        priceCents: Number(row.priceCents)
      };
    },

    list() {
      const stmt = db.prepare('SELECT * FROM books ORDER BY id ASC');
      const rows = stmt.all();
      return rows.map((r) => ({
        id: Number(r.id),
        sku: r.sku,
        name: r.name,
        quantity: Number(r.quantity),
        priceCents: Number(r.priceCents)
      }));
    },

    search(query) {
      const rows = this.list();
      return searchRows(rows, query);
    },

    update(id, patch) {
      if (!patch || typeof patch !== 'object') throw new Error('Invalid patch');
      const existing = this.get(Number(id));
      if (!existing) throw new Error(`Book with id ${id} not found`);

      const fields = [];
      const values = [];
      for (const key of ['sku', 'name', 'quantity', 'priceCents']) {
        if (patch[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(patch[key]);
        }
      }

      if (fields.length === 0) return existing;

      values.push(Number(id));
      const stmt = db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`);
      stmt.run(...values);
      return this.get(Number(id));
    },

    remove(id) {
      const existing = this.get(Number(id));
      if (!existing) throw new Error(`Book with id ${id} not found`);
      const stmt = db.prepare('DELETE FROM books WHERE id = ?');
      stmt.run(Number(id));
      return true;
    },

    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    close() {
      db.close();
    }
  };
}
