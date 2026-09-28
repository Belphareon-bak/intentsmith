// ToolAdapter — Unified Tool Execution Contract
// ══════════════════════════════════════════════════════════════════════════════
//
// Base class for specialist tool adapters.
// Pipeline: validate → normalize → execute → validateResult
//
// Return statuses:
//   { status: 'ok',      data: {...} }                     — success
//   { status: 'ok',      data: {...}, meta: { warnings } } — success with warnings
//   { status: 'clarify', missingParams: ['entity_type'] }  — needs user input
//   { status: 'error',   error: '...', message: '...' }    — unrecoverable
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ToolAdapterConfig
 * @property {string[]} [required=[]]         — params that MUST be present
 * @property {Object}   [defaults={}]         — default values for optional params
 * @property {number[]} [supportedYears=null] — e.g. [2024, 2025]
 * @property {number}   [maxAmount=null]      — sanity cap (anti-extraction bug)
 */

export class ToolAdapter {
  /**
   * @param {ToolAdapterConfig} config
   */
  constructor(config = {}) {
    this.required = config.required || [];
    this.defaults = config.defaults || {};
    this.supportedYears = config.supportedYears || null;
    this.maxAmount = config.maxAmount ?? 1_000_000_000;
  }

  /**
   * Check that all required params are present.
   * @param {Object} params — extracted params
   * @returns {{ status: 'ok' } | { status: 'clarify', missingParams: string[] }}
   */
  validate(params) {
    const missing = this.required.filter(p => params[p] == null);
    if (missing.length) {
      return { status: 'clarify', missingParams: missing };
    }
    return { status: 'ok' };
  }

  /**
   * Apply defaults, year fallback, and sanity checks.
   * Override in subclass for tool-specific normalization.
   * @param {Object} params
   * @returns {Object} normalized params
   */
  normalize(params) {
    // Apply defaults (params override defaults)
    const normalized = { ...this.defaults, ...params };

    // Year fallback: use current if supported, otherwise latest supported
    if (this.supportedYears && !normalized.year) {
      const current = new Date().getFullYear();
      normalized.year = this.supportedYears.includes(current)
        ? current
        : Math.max(...this.supportedYears);
    }

    // Amount sanity check (anti-extraction bug guard)
    if (this.maxAmount) {
      for (const key of ['gross_income', 'amount', 'gross_salary']) {
        if (typeof normalized[key] === 'number' && normalized[key] > this.maxAmount) {
          return {
            _rejected: true,
            status: 'error',
            error: 'AMOUNT_UNREALISTIC',
            message: `Částka ${normalized[key]} je nerealisticky vysoká (možná chyba v parsování).`,
          };
        }
      }
    }

    return normalized;
  }

  /**
   * Execute the tool with normalized params.
   * Must be overridden by subclass.
   * @param {Object} params — validated + normalized
   * @returns {Object} tool result ({ success, result, error } or raw)
   */
  execute(params) {
    throw new Error('ToolAdapter.execute() not implemented');
  }

  /**
   * Post-execution sanity check. Override in subclass for tool-specific checks.
   * Called after execute() with normalized params and raw result.
   *
   * @param {Object} params — normalized params used for execution
   * @param {Object} result — unwrapped tool result data (after result?.result ?? result)
   * @returns {{ valid: true } | { valid: false, issues: Array<{field: string, message: string, severity: 'warn'|'error'}> }}
   */
  validateResult(params, result) {
    return { valid: true };
  }

  /**
   * Full pipeline: validate → normalize → execute → validateResult.
   * @param {Object} params — raw extracted params
   * @returns {{ status: 'ok', data: any } | { status: 'ok', data: any, meta: { warnings } } | { status: 'clarify', missingParams: string[] } | { status: 'error', error: string, message: string }}
   */
  run(params) {
    // 1. Validate
    const v = this.validate(params);
    if (v.status !== 'ok') return v;

    // 2. Normalize
    const normalized = this.normalize(params);

    // normalize() can reject (e.g. sanity check)
    if (normalized._rejected) {
      const { _rejected, ...rest } = normalized;
      return rest;
    }

    // 3. Execute
    try {
      const result = this.execute(normalized);

      // Standardize: check for explicit {success: false}
      if (result && typeof result === 'object' && 'success' in result && !result.success) {
        return { status: 'error', error: result.error, message: result.error };
      }

      const data = result?.result ?? result;

      // 4. Post-execution validation (sanity check)
      const validation = this.validateResult(normalized, data);
      if (!validation.valid) {
        const critical = validation.issues.filter(i => i.severity === 'error');
        if (critical.length > 0) {
          return {
            status: 'error',
            error: 'RESULT_SANITY_FAIL',
            message: critical.map(i => i.message).join('; '),
          };
        }
        // Non-critical warnings: return ok with meta.warnings
        return { status: 'ok', data, meta: { warnings: validation.issues } };
      }

      return { status: 'ok', data };
    } catch (err) {
      return { status: 'error', error: err.message, message: err.message };
    }
  }
}
