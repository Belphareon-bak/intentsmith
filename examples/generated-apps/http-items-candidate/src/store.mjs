/**
 * store.mjs
 * Synchronous SQLite-backed item store.
 */

import { DatabaseSync } from 'node:sqlite';
import { normalizeItemInput, normalizeBatchInput } from './validation.mjs';

/**
 * Creates a typed error for duplicate name conflicts.
 * @param {string} message - Error description.
 * @returns {Error}
 */
function createDuplicateNameError(message) {
  const err = new Error(message);
  err.status = 409;
  err.code = 'duplicate_name';
  return err;
}

/**
 * Creates a typed error for internal store failures.
 * @param {string} message - Error description.
 * @returns {Error}
 */
function createInternalError(message) {
  const err = new Error(message);
  err.status = 500;
  err.code = 'internal_error';
  return err;
}

/**
 * Maps a SQLite error to an application-level typed error.
 * @param {Error} original - The original error from node:sqlite.
 * @returns {Error} A typed application error.
 */
function mapSqliteError(original) {
  const msg = String(original.message || '');
  if (msg.includes('UNIQUE constraint failed')) {
    return createDuplicateNameError(msg);
  }
  // Fallback to internal error for other unexpected SQLite failures
  return createInternalError(msg);
}

/**
 * Creates a new item store backed by node:sqlite.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {{list: Function, get: Function, create: Function, replace: Function, remove: Function, createBatch: Function, close: Function}}
 */
export function createStore(dbPath) {
  const db = new DatabaseSync(dbPath);

  // Enable foreign keys (not strictly needed here but good practice)
  db.exec('PRAGMA foreign_keys = ON;');

  // Create table with STRICT and CHECK constraints as per API.md
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      quantity INTEGER NOT NULL,
      CHECK (id >= 1 AND id <= 9007199254740991),
      CHECK (name = trim(name, char(9) || char(10) || char(11) || char(12) || char(13) || char(32) || char(160) || char(5760) || char(8192) || char(8193) || char(8194) || char(8195) || char(8196) || char(8197) || char(8198) || char(8199) || char(8200) || char(8201) || char(8202) || char(8232) || char(8233) || char(8239) || char(8287) || char(12288) || char(65279))),
      CHECK (instr(name, char(0)) = 0),
      CHECK (length(name) >= 1 AND length(name) <= 80),
      CHECK (quantity >= 0 AND quantity <= 9007199254740991)
    ) STRICT
  `);

  const stmtList = db.prepare('SELECT id, name, quantity FROM items ORDER BY id ASC');
  const stmtGet = db.prepare('SELECT id, name, quantity FROM items WHERE id = ?');
  const stmtCreate = db.prepare('INSERT INTO items (name, quantity) VALUES (?, ?)');
  const stmtReplace = db.prepare('UPDATE items SET name = ?, quantity = ? WHERE id = ?');
  const stmtRemove = db.prepare('DELETE FROM items WHERE id = ?');

  return {
    /**
     * Lists all items ordered by ascending id.
     * @returns {Array<{id: number, name: string, quantity: number}>}
     */
    list() {
      try {
        const rows = stmtList.all();
        return rows.map(row => ({
          id: row.id,
          name: row.name,
          quantity: row.quantity
        }));
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /**
     * Gets a single item by id.
     * @param {number} id - The item ID.
     * @returns {{id: number, name: string, quantity: number}|null}
     */
    get(id) {
      try {
        const row = stmtGet.get(id);
        if (!row) return null;
        return {
          id: row.id,
          name: row.name,
          quantity: row.quantity
        };
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /**
     * Creates a new item.
     * @param {{name: string, quantity: number}} input - Canonical item input.
     * @returns {{id: number, name: string, quantity: number}} The created item with generated id.
     */
    create(input) {
      const normalized = normalizeItemInput(input);
      try {
        const result = stmtCreate.run(normalized.name, normalized.quantity);
        return {
          id: Number(result.lastInsertRowid),
          name: normalized.name,
          quantity: normalized.quantity
        };
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /**
     * Replaces an existing item.
     * @param {number} id - The item ID to replace.
     * @param {{name: string, quantity: number}} input - Canonical item input.
     * @returns {{id: number, name: string, quantity: number}|null} The updated item or null if not found.
     */
    replace(id, input) {
      const normalized = normalizeItemInput(input);
      try {
        // Check existence first to distinguish 404 from 409
        const existing = stmtGet.get(id);
        if (!existing) return null;

        const result = stmtReplace.run(normalized.name, normalized.quantity, id);
        if (result.changes === 0) {
          // Race condition or unexpected state
          return null;
        }

        return {
          id,
          name: normalized.name,
          quantity: normalized.quantity
        };
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /**
     * Removes an item by id.
     * @param {number} id - The item ID to remove.
     * @returns {boolean} True if removed, false if not found.
     */
    remove(id) {
      try {
        const result = stmtRemove.run(id);
        return result.changes > 0;
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /**
     * Creates a batch of items atomically.
     * @param {Array<{name: string, quantity: number}>} inputs - Array of canonical item inputs.
     * @returns {Array<{id: number, name: string, quantity: number}>} The created items in input order.
     */
    createBatch(inputs) {
      const normalizedItems = normalizeBatchInput({ items: inputs });

      // Pre-check for duplicates within the batch and against existing DB entries
      const namesInBatch = new Set();
      for (const item of normalizedItems) {
        if (namesInBatch.has(item.name)) {
          throw createDuplicateNameError('Duplicate name in batch');
        }
        namesInBatch.add(item.name);
      }

      // Check against DB
      const stmtCheck = db.prepare('SELECT 1 FROM items WHERE name = ?');
      for (const item of normalizedItems) {
        if (stmtCheck.get(item.name)) {
          throw createDuplicateNameError(`Duplicate name: ${item.name}`);
        }
      }

      try {
        db.exec('BEGIN TRANSACTION');
        const created = [];
        for (const item of normalizedItems) {
          const result = stmtCreate.run(item.name, item.quantity);
          created.push({
            id: Number(result.lastInsertRowid),
            name: item.name,
            quantity: item.quantity
          });
        }
        db.exec('COMMIT');
        return created;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw mapSqliteError(err);
      }
    },

    /**
     * Closes the database connection.
     */
    close() {
      db.close();
    }
  };
}
