// Ledger Repository (DB Layer)
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure data access. NO business logic. Returns plain objects.
// All amounts stored in haléře (cents) — conversion is caller's responsibility.
//
// Soft-delete pattern: deleted_at IS NULL = active record.
// Audit trail: every update snapshots the old state to entry_history.
// Period locks: closed years reject addEntry/updateEntry/softDeleteEntry.
//
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';

export class LedgerRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._stmts = null;
  }

  // ─── Lazy Prepared Statements ───────────────────────────────────────────────

  _prepare() {
    if (this._stmts) return this._stmts;

    const db = this.db;
    this._stmts = {
      // ── Entity CRUD ──
      createEntity: db.prepare(`
        INSERT INTO entity_profiles
          (id, name, entity_type, vat_registered, tax_regime, flat_expense_category,
           main_or_secondary, children, spouse_credit, rates_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      getEntity: db.prepare(`SELECT * FROM entity_profiles WHERE id = ?`),

      updateEntity: db.prepare(`
        UPDATE entity_profiles SET
          name = ?, entity_type = ?, vat_registered = ?, tax_regime = ?,
          flat_expense_category = ?, main_or_secondary = ?, children = ?,
          spouse_credit = ?, rates_version = ?, updated_at = datetime('now')
        WHERE id = ?
      `),

      listEntities: db.prepare(`SELECT * FROM entity_profiles ORDER BY name`),

      deleteEntity: db.prepare(`DELETE FROM entity_profiles WHERE id = ?`),

      // ── Entry CRUD ──
      addEntry: db.prepare(`
        INSERT INTO financial_entries
          (entity_id, entry_type, amount_cents, vat_rate, vat_amount_cents,
           category, description, document_ref, is_tax_deductible,
           entry_date, period_year,
           supply_date, partner_dic, partner_name, document_number, vat_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      getEntry: db.prepare(`
        SELECT * FROM financial_entries WHERE id = ? AND deleted_at IS NULL
      `),

      getEntryIncDeleted: db.prepare(`
        SELECT * FROM financial_entries WHERE id = ?
      `),

      updateEntry: db.prepare(`
        UPDATE financial_entries SET
          entry_type = ?, amount_cents = ?, vat_rate = ?, vat_amount_cents = ?,
          category = ?, description = ?, document_ref = ?, is_tax_deductible = ?,
          entry_date = ?, period_year = ?,
          supply_date = ?, partner_dic = ?, partner_name = ?, document_number = ?, vat_type = ?,
          version = version + 1, updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL
      `),

      softDeleteEntry: db.prepare(`
        UPDATE financial_entries SET
          deleted_at = datetime('now'), version = version + 1
        WHERE id = ? AND deleted_at IS NULL
      `),

      // ── Entry Queries ──
      getEntriesByYear: db.prepare(`
        SELECT * FROM financial_entries
        WHERE entity_id = ? AND period_year = ? AND deleted_at IS NULL
        ORDER BY entry_date, id
      `),

      getEntriesByDateRange: db.prepare(`
        SELECT * FROM financial_entries
        WHERE entity_id = ? AND entry_date >= ? AND entry_date <= ? AND deleted_at IS NULL
        ORDER BY entry_date, id
      `),

      getEntriesByType: db.prepare(`
        SELECT * FROM financial_entries
        WHERE entity_id = ? AND period_year = ? AND entry_type = ? AND deleted_at IS NULL
        ORDER BY entry_date, id
      `),

      countEntriesByYear: db.prepare(`
        SELECT COUNT(*) as count FROM financial_entries
        WHERE entity_id = ? AND period_year = ? AND deleted_at IS NULL
      `),

      // ── Audit History ──
      insertHistory: db.prepare(`
        INSERT INTO entry_history (entry_id, snapshot_json) VALUES (?, ?)
      `),

      getHistory: db.prepare(`
        SELECT * FROM entry_history WHERE entry_id = ? ORDER BY id DESC
      `),

      // ── Calculation Runs ──
      saveRun: db.prepare(`
        INSERT INTO calculation_runs (id, entity_id, year, rates_version, input_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `),

      getRuns: db.prepare(`
        SELECT * FROM calculation_runs
        WHERE entity_id = ? AND year = ?
        ORDER BY rowid DESC
      `),

      getLatestRun: db.prepare(`
        SELECT * FROM calculation_runs
        WHERE entity_id = ? AND year = ?
        ORDER BY rowid DESC LIMIT 1
      `),

      // ── Period Locks ──
      lockPeriod: db.prepare(`
        INSERT INTO period_locks (entity_id, year, locked_by, calculation_run_id, notes)
        VALUES (?, ?, ?, ?, ?)
      `),

      unlockPeriod: db.prepare(`
        DELETE FROM period_locks WHERE entity_id = ? AND year = ?
      `),

      isLocked: db.prepare(`
        SELECT 1 FROM period_locks WHERE entity_id = ? AND year = ? LIMIT 1
      `),

      getLock: db.prepare(`
        SELECT * FROM period_locks WHERE entity_id = ? AND year = ?
      `),

      getLockedYears: db.prepare(`
        SELECT * FROM period_locks WHERE entity_id = ? ORDER BY year
      `),

      // ── Tax Losses ──
      upsertLoss: db.prepare(`
        INSERT INTO tax_losses (entity_id, origin_year, original_amount_cents, remaining_cents, expires_year)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entity_id, origin_year) DO UPDATE SET
          remaining_cents = excluded.remaining_cents
      `),

      getActiveLosses: db.prepare(`
        SELECT * FROM tax_losses
        WHERE entity_id = ? AND remaining_cents > 0 AND expires_year >= ?
        ORDER BY origin_year
      `),

      getLoss: db.prepare(`
        SELECT * FROM tax_losses WHERE entity_id = ? AND origin_year = ?
      `),

      updateLossRemaining: db.prepare(`
        UPDATE tax_losses SET remaining_cents = ? WHERE entity_id = ? AND origin_year = ?
      `),

      // ── VAT Periods ──
      createVATPeriod: db.prepare(`
        INSERT INTO vat_periods
          (entity_id, period_type, period_start, period_end, status, notes)
        VALUES (?, ?, ?, ?, 'open', ?)
      `),

      getVATPeriod: db.prepare(`
        SELECT * FROM vat_periods WHERE entity_id = ? AND period_start = ?
      `),

      closeVATPeriod: db.prepare(`
        UPDATE vat_periods SET
          status = 'submitted', submitted_at = datetime('now'),
          vat_return_json = ?, control_report_json = ?
        WHERE entity_id = ? AND period_start = ? AND status = 'open'
      `),

      getOpenVATPeriods: db.prepare(`
        SELECT * FROM vat_periods WHERE entity_id = ? AND status = 'open'
        ORDER BY period_start
      `),

      getVATPeriodsByYear: db.prepare(`
        SELECT * FROM vat_periods
        WHERE entity_id = ? AND period_start >= ? AND period_end <= ?
        ORDER BY period_start
      `),
    };

    return this._stmts;
  }

  // ─── Entity Operations ──────────────────────────────────────────────────────

  /**
   * Create a new entity profile.
   * @param {Object} data
   * @returns {{ id: string }} Created entity with id
   */
  createEntity(data) {
    const id = data.id || randomUUID();
    const {
      name, entity_type = 'osvc', vat_registered = 0,
      tax_regime = 'actual', flat_expense_category = null,
      main_or_secondary = 'main', children = 0,
      spouse_credit = 0, rates_version = '2025_v1',
    } = data;

    this._prepare().createEntity.run(
      id, name, entity_type, vat_registered ? 1 : 0,
      tax_regime, flat_expense_category,
      main_or_secondary, children, spouse_credit ? 1 : 0,
      rates_version,
    );

    return { id };
  }

  /**
   * Get entity by id.
   * @param {string} id
   * @returns {Object|null}
   */
  getEntity(id) {
    return this._prepare().getEntity.get(id) || null;
  }

  /**
   * Update entity profile.
   * @param {string} id
   * @param {Object} patch - fields to update
   */
  updateEntity(id, patch) {
    const existing = this.getEntity(id);
    if (!existing) throw new Error(`Entity not found: ${id}`);

    const merged = { ...existing, ...patch };
    this._prepare().updateEntity.run(
      merged.name, merged.entity_type, merged.vat_registered ? 1 : 0,
      merged.tax_regime, merged.flat_expense_category,
      merged.main_or_secondary, merged.children,
      merged.spouse_credit ? 1 : 0, merged.rates_version,
      id,
    );
  }

  /**
   * List all entities.
   * @returns {Object[]}
   */
  listEntities() {
    return this._prepare().listEntities.all();
  }

  /**
   * Permanently delete an entity and all its entries (CASCADE).
   * @param {string} id
   */
  deleteEntity(id) {
    this._prepare().deleteEntity.run(id);
  }

  // ─── Entry Operations ───────────────────────────────────────────────────────

  /**
   * Add a financial entry. Throws if the period is locked.
   * @param {string} entityId
   * @param {Object} data
   * @returns {{ id: number }}
   */
  addEntry(entityId, data) {
    const {
      entry_type, amount_cents, vat_rate = null, vat_amount_cents = null,
      category, description = null, document_ref = null,
      is_tax_deductible = 1, entry_date, period_year,
      supply_date = null, partner_dic = null, partner_name = null,
      document_number = null, vat_type = null,
    } = data;

    this._assertNotLocked(entityId, period_year);

    const result = this._prepare().addEntry.run(
      entityId, entry_type, amount_cents, vat_rate, vat_amount_cents,
      category, description, document_ref, is_tax_deductible ? 1 : 0,
      entry_date, period_year,
      supply_date, partner_dic, partner_name, document_number, vat_type,
    );

    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Get a single active entry by id.
   * @param {number} id
   * @returns {Object|null}
   */
  getEntry(id) {
    return this._prepare().getEntry.get(id) || null;
  }

  /**
   * Update an entry. Snapshots old state to history first. Throws if period is locked.
   * @param {number} id
   * @param {Object} patch - fields to update
   */
  updateEntry(id, patch) {
    const existing = this._prepare().getEntry.get(id);
    if (!existing) throw new Error(`Entry not found or deleted: ${id}`);

    this._assertNotLocked(existing.entity_id, existing.period_year);

    // Snapshot old state
    this._prepare().insertHistory.run(id, JSON.stringify(existing));

    const merged = { ...existing, ...patch };
    this._prepare().updateEntry.run(
      merged.entry_type, merged.amount_cents, merged.vat_rate, merged.vat_amount_cents,
      merged.category, merged.description, merged.document_ref,
      merged.is_tax_deductible ? 1 : 0, merged.entry_date, merged.period_year,
      merged.supply_date || null, merged.partner_dic || null,
      merged.partner_name || null, merged.document_number || null,
      merged.vat_type || null,
      id,
    );
  }

  /**
   * Soft-delete an entry. Snapshots old state to history first. Throws if period is locked.
   * @param {number} id
   */
  softDeleteEntry(id) {
    const existing = this._prepare().getEntry.get(id);
    if (!existing) throw new Error(`Entry not found or already deleted: ${id}`);

    this._assertNotLocked(existing.entity_id, existing.period_year);

    // Snapshot before delete
    this._prepare().insertHistory.run(id, JSON.stringify(existing));
    this._prepare().softDeleteEntry.run(id);
  }

  /**
   * Get all active entries for entity + year.
   * @param {string} entityId
   * @param {number} year
   * @returns {Object[]}
   */
  getEntriesByYear(entityId, year) {
    return this._prepare().getEntriesByYear.all(entityId, year);
  }

  /**
   * Get active entries in a date range.
   * @param {string} entityId
   * @param {string} from - YYYY-MM-DD
   * @param {string} to - YYYY-MM-DD
   * @returns {Object[]}
   */
  getEntriesByDateRange(entityId, from, to) {
    return this._prepare().getEntriesByDateRange.all(entityId, from, to);
  }

  /**
   * Get active entries by type for a year.
   * @param {string} entityId
   * @param {number} year
   * @param {string} entryType
   * @returns {Object[]}
   */
  getEntriesByType(entityId, year, entryType) {
    return this._prepare().getEntriesByType.all(entityId, year, entryType);
  }

  /**
   * Count active entries for entity + year.
   * @param {string} entityId
   * @param {number} year
   * @returns {number}
   */
  countEntries(entityId, year) {
    return this._prepare().countEntriesByYear.get(entityId, year).count;
  }

  /**
   * Get audit history for an entry.
   * @param {number} entryId
   * @returns {Object[]}
   */
  getEntryHistory(entryId) {
    return this._prepare().getHistory.all(entryId).map(r => ({
      ...r, snapshot: JSON.parse(r.snapshot_json),
    }));
  }

  // ─── Calculation Runs ───────────────────────────────────────────────────────

  /**
   * Save a calculation run for reproducibility.
   * @param {Object} data
   * @returns {{ id: string }}
   */
  saveCalculationRun(data) {
    const id = data.id || randomUUID();
    const { entity_id, year, rates_version, input, result } = data;

    this._prepare().saveRun.run(
      id, entity_id, year, rates_version,
      JSON.stringify(input), JSON.stringify(result),
    );

    return { id };
  }

  /**
   * Get calculation runs for entity + year.
   * @param {string} entityId
   * @param {number} year
   * @returns {Object[]}
   */
  getCalculationRuns(entityId, year) {
    return this._prepare().getRuns.all(entityId, year).map(r => ({
      ...r, input: JSON.parse(r.input_json), result: JSON.parse(r.result_json),
    }));
  }

  /**
   * Get the latest calculation run.
   * @param {string} entityId
   * @param {number} year
   * @returns {Object|null}
   */
  getLatestRun(entityId, year) {
    const row = this._prepare().getLatestRun.get(entityId, year);
    if (!row) return null;
    return { ...row, input: JSON.parse(row.input_json), result: JSON.parse(row.result_json) };
  }

  // ─── Period Locks ──────────────────────────────────────────────────────────

  /**
   * Lock a fiscal year period. Prevents entry modifications.
   * @param {string} entityId
   * @param {number} year
   * @param {{ locked_by?: string, calculation_run_id?: string, notes?: string }} [opts]
   */
  lockPeriod(entityId, year, opts = {}) {
    if (this.isPeriodLocked(entityId, year)) {
      throw new Error(`Period ${year} already locked for entity ${entityId}`);
    }
    const { locked_by = 'system', calculation_run_id = null, notes = null } = opts;
    this._prepare().lockPeriod.run(entityId, year, locked_by, calculation_run_id, notes);
  }

  /**
   * Unlock a fiscal year period. Allows entry modifications again.
   * @param {string} entityId
   * @param {number} year
   */
  unlockPeriod(entityId, year) {
    if (!this.isPeriodLocked(entityId, year)) {
      throw new Error(`Period ${year} is not locked for entity ${entityId}`);
    }
    this._prepare().unlockPeriod.run(entityId, year);
  }

  /**
   * Check if a period is locked.
   * @param {string} entityId
   * @param {number} year
   * @returns {boolean}
   */
  isPeriodLocked(entityId, year) {
    return !!this._prepare().isLocked.get(entityId, year);
  }

  /**
   * Get lock details for a period.
   * @param {string} entityId
   * @param {number} year
   * @returns {Object|null}
   */
  getPeriodLock(entityId, year) {
    return this._prepare().getLock.get(entityId, year) || null;
  }

  /**
   * Get all locked years for an entity.
   * @param {string} entityId
   * @returns {Object[]}
   */
  getLockedYears(entityId) {
    return this._prepare().getLockedYears.all(entityId);
  }

  // ─── Tax Losses ───────────────────────────────────────────────────────────

  /**
   * Record a tax loss for a year (§34 ZDP — uplatnění ztráty v 5 následujících letech).
   * @param {string} entityId
   * @param {number} originYear
   * @param {number} amountCents - loss amount in cents (positive number)
   */
  recordTaxLoss(entityId, originYear, amountCents) {
    this._prepare().upsertLoss.run(
      entityId, originYear, amountCents, amountCents, originYear + 5,
    );
  }

  /**
   * Get active (not fully used, not expired) tax losses.
   * @param {string} entityId
   * @param {number} currentYear
   * @returns {Object[]}
   */
  getActiveLosses(entityId, currentYear) {
    return this._prepare().getActiveLosses.all(entityId, currentYear);
  }

  /**
   * Get tax loss record for a specific origin year.
   * @param {string} entityId
   * @param {number} originYear
   * @returns {Object|null}
   */
  getTaxLoss(entityId, originYear) {
    return this._prepare().getLoss.get(entityId, originYear) || null;
  }

  /**
   * Reduce remaining loss amount (after applying to a year's tax base).
   * @param {string} entityId
   * @param {number} originYear
   * @param {number} newRemainingCents
   */
  updateLossRemaining(entityId, originYear, newRemainingCents) {
    this._prepare().updateLossRemaining.run(newRemainingCents, entityId, originYear);
  }

  // ─── VAT Periods ─────────────────────────────────────────────────────────

  /**
   * Create a VAT period (open).
   * @param {string} entityId
   * @param {{ period_type: string, period_start: string, period_end: string, notes?: string }} data
   * @returns {{ id: number }}
   */
  createVATPeriod(entityId, data) {
    const { period_type, period_start, period_end, notes = null } = data;
    const result = this._prepare().createVATPeriod.run(
      entityId, period_type, period_start, period_end, notes,
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Get a VAT period by entity and start date.
   * @param {string} entityId
   * @param {string} periodStart
   * @returns {Object|null}
   */
  getVATPeriod(entityId, periodStart) {
    return this._prepare().getVATPeriod.get(entityId, periodStart) || null;
  }

  /**
   * Close/submit a VAT period with computed data.
   * @param {string} entityId
   * @param {string} periodStart
   * @param {{ vatReturn: Object, controlReport: Object }} data
   */
  closeVATPeriod(entityId, periodStart, data) {
    const { vatReturn, controlReport } = data;
    const changes = this._prepare().closeVATPeriod.run(
      JSON.stringify(vatReturn), JSON.stringify(controlReport),
      entityId, periodStart,
    );
    if (changes.changes === 0) {
      throw new Error(`VAT period ${periodStart} not found or already closed for entity ${entityId}`);
    }
  }

  /**
   * Get all open VAT periods for an entity.
   * @param {string} entityId
   * @returns {Object[]}
   */
  getOpenVATPeriods(entityId) {
    return this._prepare().getOpenVATPeriods.all(entityId);
  }

  /**
   * Get VAT periods for a year range.
   * @param {string} entityId
   * @param {number} year
   * @returns {Object[]}
   */
  getVATPeriodsByYear(entityId, year) {
    return this._prepare().getVATPeriodsByYear.all(
      entityId, `${year}-01-01`, `${year}-12-31`,
    );
  }

  // ─── Bulk Operations ────────────────────────────────────────────────────────

  /**
   * Add multiple entries in a single transaction.
   * @param {string} entityId
   * @param {Object[]} entries
   * @returns {{ ids: number[] }}
   */
  addEntries(entityId, entries) {
    const ids = [];
    const run = this.db.transaction(() => {
      for (const entry of entries) {
        const { id } = this.addEntry(entityId, entry);
        ids.push(id);
      }
    });
    run();
    return { ids };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  /**
   * Assert that a period is not locked. Throws if locked.
   * @param {string} entityId
   * @param {number} year
   */
  _assertNotLocked(entityId, year) {
    if (this.isPeriodLocked(entityId, year)) {
      throw new Error(`Period ${year} is locked for entity ${entityId}. Unlock the period first.`);
    }
  }
}

export default LedgerRepository;
