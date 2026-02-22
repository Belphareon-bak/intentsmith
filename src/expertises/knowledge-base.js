// D2: Knowledge Base — Versioned Fact Store for Specialists
// ══════════════════════════════════════════════════════════════════════════════
//
// Provides a DB-backed versioned fact store that replaces hardcoded constants.
// Each fact is scoped by domain + category + key + year and carries provenance
// metadata (source, confidence, verification status).
//
// Integration:
//   ToolExecutor injects a KnowledgeBase handle into tool context so tools
//   can query facts via kb.getFact('tax', 'income_tax', 'base_rate', 2025)
//   instead of importing static RATES constants.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── KnowledgeBase Class ─────────────────────────────────────────────────────

export class KnowledgeBase {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._stmts = null;
  }

  /** Lazy-prepare all statements (avoids issues if table doesn't exist yet). */
  _prepare() {
    if (this._stmts) return this._stmts;

    const db = this.db;
    this._stmts = {
      getFact: db.prepare(`
        SELECT * FROM knowledge_facts
        WHERE domain = ? AND category = ? AND key = ? AND year = ?
        LIMIT 1
      `),

      getFactNoYear: db.prepare(`
        SELECT * FROM knowledge_facts
        WHERE domain = ? AND category = ? AND key = ? AND year IS NULL
        LIMIT 1
      `),

      getCategory: db.prepare(`
        SELECT * FROM knowledge_facts
        WHERE domain = ? AND category = ? AND year = ?
        ORDER BY key
      `),

      getCategoryNoYear: db.prepare(`
        SELECT * FROM knowledge_facts
        WHERE domain = ? AND category = ? AND year IS NULL
        ORDER BY key
      `),

      listDomains: db.prepare(`
        SELECT DISTINCT domain FROM knowledge_facts ORDER BY domain
      `),

      listCategories: db.prepare(`
        SELECT DISTINCT category FROM knowledge_facts
        WHERE domain = ? ORDER BY category
      `),

      listYears: db.prepare(`
        SELECT DISTINCT year FROM knowledge_facts
        WHERE domain = ? AND year IS NOT NULL ORDER BY year
      `),

      upsertFact: db.prepare(`
        INSERT INTO knowledge_facts
          (domain, specialist_id, category, key, value, value_type,
           valid_from, valid_to, year, source, source_url,
           confidence, is_provisional, verified_at, verified_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain, category, key, year) DO UPDATE SET
          value = excluded.value,
          value_type = excluded.value_type,
          valid_from = excluded.valid_from,
          valid_to = excluded.valid_to,
          source = excluded.source,
          source_url = excluded.source_url,
          confidence = excluded.confidence,
          is_provisional = excluded.is_provisional,
          verified_at = excluded.verified_at,
          verified_by = excluded.verified_by,
          notes = excluded.notes,
          updated_at = CURRENT_TIMESTAMP
      `),

      deleteFact: db.prepare(`
        DELETE FROM knowledge_facts WHERE domain = ? AND category = ? AND key = ? AND year = ?
      `),

      countFacts: db.prepare(`
        SELECT COUNT(*) as count FROM knowledge_facts WHERE domain = ?
      `),

      countAll: db.prepare(`SELECT COUNT(*) as count FROM knowledge_facts`),

      checkFreshness: db.prepare(`
        SELECT category, key, confidence, is_provisional, verified_at,
               julianday('now') - julianday(verified_at) as days_since
        FROM knowledge_facts
        WHERE domain = ? AND category = ?
        ORDER BY key
      `),

      // Verification sources
      getSource: db.prepare(`SELECT * FROM knowledge_sources WHERE id = ?`),
      listSources: db.prepare(`SELECT * FROM knowledge_sources WHERE domain = ?`),
      upsertSource: db.prepare(`
        INSERT INTO knowledge_sources (id, name, domain, url, affects, keywords, check_frequency_days)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, url = excluded.url,
          affects = excluded.affects, keywords = excluded.keywords,
          check_frequency_days = excluded.check_frequency_days,
          updated_at = CURRENT_TIMESTAMP
      `),

      // Verification log
      logVerification: db.prepare(`
        INSERT INTO knowledge_verification_log
          (fact_id, source_id, action, old_value, new_value, triggered_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
    };

    return this._stmts;
  }

  // ─── Read API ────────────────────────────────────────────────────────────

  /**
   * Get a single fact value.
   * @param {string} domain - e.g. 'tax'
   * @param {string} category - e.g. 'income_tax'
   * @param {string} key - e.g. 'base_rate'
   * @param {number|null} year - fiscal year or null for non-year-scoped facts
   * @returns {*} Parsed value or null
   */
  getFact(domain, category, key, year = null) {
    const s = this._prepare();
    const row = year != null
      ? s.getFact.get(domain, category, key, year)
      : s.getFactNoYear.get(domain, category, key);
    if (!row) return null;
    return this._parseValue(row);
  }

  /**
   * Get all facts in a category as a key→value object.
   * @param {string} domain
   * @param {string} category
   * @param {number|null} year
   * @returns {Object} { key: value, ... } or empty object
   */
  getCategory(domain, category, year = null) {
    const s = this._prepare();
    const rows = year != null
      ? s.getCategory.all(domain, category, year)
      : s.getCategoryNoYear.all(domain, category);

    const result = {};
    for (const row of rows) {
      result[row.key] = this._parseValue(row);
    }
    return result;
  }

  /**
   * Get full rates object for a domain+year (reconstructs nested structure).
   * Returns a flat category→{key: value} map.
   * @param {string} domain
   * @param {number} year
   * @returns {Object} { income_tax: { base_rate: 0.15, ... }, social: { ... }, ... }
   */
  getRatesForYear(domain, year) {
    const categories = this.listCategories(domain);
    const result = { _meta: {} };

    for (const cat of categories) {
      if (cat === '_meta') {
        result._meta = this.getCategory(domain, '_meta', year);
        continue;
      }
      result[cat] = this.getCategory(domain, cat, year);
    }

    return result;
  }

  /**
   * List all distinct domains.
   * @returns {string[]}
   */
  listDomains() {
    return this._prepare().listDomains.all().map(r => r.domain);
  }

  /**
   * List all categories in a domain.
   * @returns {string[]}
   */
  listCategories(domain) {
    return this._prepare().listCategories.all(domain).map(r => r.category);
  }

  /**
   * List all years in a domain.
   * @returns {number[]}
   */
  listYears(domain) {
    return this._prepare().listYears.all(domain).map(r => r.year);
  }

  /**
   * Count facts in a domain (or all).
   * @param {string|null} domain
   * @returns {number}
   */
  count(domain = null) {
    const s = this._prepare();
    return domain
      ? s.countFacts.get(domain).count
      : s.countAll.get().count;
  }

  /**
   * Check freshness of facts in a category.
   * @param {string} domain
   * @param {string} category
   * @param {number} [toleranceDays=180]
   * @returns {{ stale: boolean, facts: Array, warnings: string[] }}
   */
  checkFreshness(domain, category, toleranceDays = 180) {
    const rows = this._prepare().checkFreshness.all(domain, category);
    const warnings = [];
    let stale = false;

    for (const row of rows) {
      if (row.days_since > toleranceDays) {
        stale = true;
        warnings.push(`${row.key}: verified ${Math.floor(row.days_since)}d ago (limit ${toleranceDays}d)`);
      }
      if (row.is_provisional) {
        warnings.push(`${row.key}: provisional value`);
      }
      if (row.confidence === 'medium' || row.confidence === 'low') {
        warnings.push(`${row.key}: confidence=${row.confidence}`);
      }
    }

    return { stale, facts: rows, warnings };
  }

  // ─── Write API ───────────────────────────────────────────────────────────

  /**
   * Upsert a single fact.
   * @param {Object} fact
   */
  setFact(fact) {
    const {
      domain, specialist_id = null, category, key,
      value, value_type = 'number',
      valid_from = null, valid_to = null, year = null,
      source = null, source_url = null,
      confidence = 'high', is_provisional = false,
      verified_at = null, verified_by = null, notes = null,
    } = fact;

    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);

    this._prepare().upsertFact.run(
      domain, specialist_id, category, key,
      serialized, value_type,
      valid_from, valid_to, year,
      source, source_url,
      confidence, is_provisional ? 1 : 0,
      verified_at, verified_by, notes,
    );
  }

  /**
   * Bulk insert facts (wrapped in a transaction).
   * @param {Object[]} facts
   */
  bulkSetFacts(facts) {
    const runBulk = this.db.transaction(() => {
      for (const fact of facts) {
        this.setFact(fact);
      }
    });
    runBulk();
    logger.info('KnowledgeBase', `Bulk inserted ${facts.length} facts`);
  }

  /**
   * Delete a fact.
   */
  deleteFact(domain, category, key, year) {
    this._prepare().deleteFact.run(domain, category, key, year);
  }

  // ─── Verification Sources ────────────────────────────────────────────────

  getSource(id) {
    const row = this._prepare().getSource.get(id);
    if (!row) return null;
    return { ...row, affects: JSON.parse(row.affects), keywords: JSON.parse(row.keywords) };
  }

  listSources(domain) {
    return this._prepare().listSources.all(domain).map(r => ({
      ...r, affects: JSON.parse(r.affects), keywords: JSON.parse(r.keywords),
    }));
  }

  setSource(source) {
    const { id, name, domain, url = null, affects = [], keywords = [], check_frequency_days = 30 } = source;
    this._prepare().upsertSource.run(
      id, name, domain, url,
      JSON.stringify(affects), JSON.stringify(keywords),
      check_frequency_days,
    );
  }

  // ─── Verification Log ────────────────────────────────────────────────────

  logVerification({ fact_id = null, source_id = null, action, old_value = null, new_value = null, triggered_by = null, notes = null }) {
    this._prepare().logVerification.run(fact_id, source_id, action, old_value, new_value, triggered_by, notes);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _parseValue(row) {
    switch (row.value_type) {
      case 'number': return Number(row.value);
      case 'boolean': return row.value === 'true' || row.value === '1';
      case 'json': {
        try { return JSON.parse(row.value); }
        catch { return row.value; }
      }
      default: return row.value;
    }
  }
}

// ─── Seed: Import tax rates from static RATES constant ──────────────────────

/**
 * Seed the knowledge base with accountant tax rates from the hardcoded RATES object.
 * Idempotent — uses upsert, safe to call multiple times.
 *
 * @param {KnowledgeBase} kb
 * @param {Object} RATES - The static RATES object from tax-rates.js
 */
export function seedTaxRates(kb, RATES) {
  const facts = [];

  for (const [yearStr, yearData] of Object.entries(RATES)) {
    const year = Number(yearStr);
    const meta = yearData._meta || {};

    for (const [category, catData] of Object.entries(yearData)) {
      if (category === '_meta') continue;
      if (typeof catData !== 'object') continue;

      for (const [key, value] of Object.entries(catData)) {
        let valueType = 'number';
        let serialized = value;

        if (typeof value === 'boolean') {
          valueType = 'boolean';
        } else if (typeof value === 'object') {
          valueType = 'json';
          serialized = value;
        } else if (typeof value === 'string') {
          valueType = 'string';
        }

        const isProvisional = meta.provisional?.some(p => p.startsWith(`${category}.${key}`)) || false;

        facts.push({
          domain: 'tax',
          specialist_id: 'accountant',
          category,
          key,
          value: serialized,
          value_type: valueType,
          valid_from: meta.valid_from || null,
          valid_to: meta.valid_to || null,
          year,
          source: meta.source || null,
          confidence: meta.confidence || 'high',
          is_provisional: isProvisional,
          verified_at: meta.verified_at || null,
          verified_by: 'import',
        });
      }
    }
  }

  kb.bulkSetFacts(facts);
  return facts.length;
}

// ─── Singleton (lazy, requires db) ──────────────────────────────────────────

let _instance = null;

/**
 * Get or create the KnowledgeBase singleton.
 * @param {import('better-sqlite3').Database} [db] - Pass db on first call
 * @returns {KnowledgeBase}
 */
export function getKnowledgeBase(db = null) {
  if (!_instance) {
    if (!db) throw new Error('KnowledgeBase: db required on first call');
    _instance = new KnowledgeBase(db);
  }
  return _instance;
}

export default { KnowledgeBase, seedTaxRates, getKnowledgeBase };
