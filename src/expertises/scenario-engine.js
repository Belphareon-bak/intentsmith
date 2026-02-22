// D3: Scenario Engine — Multi-Step Guided Workflows for Specialists
// ══════════════════════════════════════════════════════════════════════════════
//
// Manages interactive scenarios: multi-turn guided data collection → tool
// execution → presentation. The user is walked through step by step.
//
// Architecture:
//   1. ScenarioRegistry  — stores scenario definitions, trigger detection
//   2. ScenarioRunner    — state machine per session (phase transitions)
//   3. ScenarioState     — runtime state for one active scenario
//
// Integration:
//   - conversation.js checks scenarioRunner.isActive(sessionId)
//   - If active, routes input to scenarioRunner.handleInput()
//   - If not active, expert handler checks scenarioRegistry.detectTrigger()
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Phases ──────────────────────────────────────────────────────────────────

export const ScenarioPhase = Object.freeze({
  INTRO: 'INTRO',
  COLLECTING: 'COLLECTING',
  COMPUTING: 'COMPUTING',
  PRESENTING: 'PRESENTING',
  RECOMMENDING: 'RECOMMENDING',
  ADJUSTING: 'ADJUSTING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

// ─── Scenario Definition ─────────────────────────────────────────────────────

/**
 * @typedef {Object} ScenarioStep
 * @property {string} id           - Step identifier (e.g. 'income')
 * @property {string|Object} question - Question text (string or { cs, en })
 * @property {Function} extract    - (input) => value | null
 * @property {boolean} [required]  - Is this step required? (default true)
 * @property {Function} [validate] - (value) => boolean
 * @property {string} [errorMessage] - Shown on validation failure
 * @property {Function} [skipIf]   - (collected) => boolean — skip this step
 * @property {*} [default]         - Default value (or function returning default)
 */

/**
 * @typedef {Object} ScenarioDefinition
 * @property {string} id            - Unique scenario ID
 * @property {string} specialistId  - Expert ID (e.g. 'accountant')
 * @property {string} name          - Human-readable name
 * @property {string} description   - What this scenario does
 * @property {string} introMessage  - Greeting shown when scenario starts
 * @property {RegExp[]} triggers    - Patterns that start this scenario
 * @property {ScenarioStep[]} steps - Ordered data collection steps
 * @property {Function} compute     - (collected) => Promise<Object> | Object
 * @property {Function} present     - (results, collected) => string
 * @property {string} [recommendPrompt] - Injected into expert prompt for recommendation
 */

// ─── Scenario Registry ───────────────────────────────────────────────────────

export class ScenarioRegistry {
  constructor() {
    /** @type {Map<string, ScenarioDefinition>} */
    this._scenarios = new Map();
    /** @type {Map<string, ScenarioDefinition[]>} specialistId → scenarios */
    this._bySpecialist = new Map();
  }

  /**
   * Register a scenario definition.
   */
  register(scenario) {
    if (!scenario.id) throw new Error('Scenario requires id');
    if (!scenario.specialistId) throw new Error('Scenario requires specialistId');
    if (!scenario.steps?.length) throw new Error('Scenario requires at least one step');
    if (!scenario.triggers?.length) throw new Error('Scenario requires triggers');

    this._scenarios.set(scenario.id, scenario);

    const list = this._bySpecialist.get(scenario.specialistId) || [];
    list.push(scenario);
    this._bySpecialist.set(scenario.specialistId, list);

    logger.debug('ScenarioEngine', `Registered scenario: ${scenario.id} for ${scenario.specialistId}`);
  }

  /**
   * Unregister all scenarios for a specialist.
   * @param {string} specialistId
   */
  unregisterBySpecialist(specialistId) {
    const scenarios = this._bySpecialist.get(specialistId) || [];
    for (const s of scenarios) {
      this._scenarios.delete(s.id);
    }
    this._bySpecialist.delete(specialistId);
    if (scenarios.length > 0) {
      logger.debug('ScenarioEngine', `Unregistered ${scenarios.length} scenario(s) for ${specialistId}`);
    }
  }

  /**
   * Get a scenario by ID.
   */
  getScenario(id) {
    return this._scenarios.get(id) || null;
  }

  /**
   * Get all scenarios for a specialist.
   */
  getScenarios(specialistId) {
    return this._bySpecialist.get(specialistId) || [];
  }

  /**
   * Detect if input triggers a scenario for the given specialist.
   * @returns {ScenarioDefinition | null}
   */
  detectTrigger(specialistId, input) {
    if (!input || input.length < 8) return null;

    const scenarios = this._bySpecialist.get(specialistId) || [];
    for (const scenario of scenarios) {
      if (scenario.triggers.some(p => p.test(input))) {
        return scenario;
      }
    }
    return null;
  }

  /**
   * List all registered scenario IDs.
   */
  getScenarioIds() {
    return [...this._scenarios.keys()];
  }
}

// ─── Scenario State ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} ScenarioState
 * @property {string} scenarioId
 * @property {string} specialistId
 * @property {string} phase
 * @property {number} currentStepIndex
 * @property {string[]} completedSteps
 * @property {Object} collected
 * @property {Object|null} toolResults
 * @property {number} retryCount
 * @property {string|null} lastParseError
 * @property {number} turnCount
 * @property {string} startedAt
 * @property {string} updatedAt
 */

// ─── Scenario Runner ─────────────────────────────────────────────────────────

export class ScenarioRunner {
  constructor(registry) {
    this.registry = registry;
    /** @type {Map<string, ScenarioState>} sessionId → state */
    this._sessions = new Map();
  }

  /**
   * Check if a session has an active scenario.
   */
  isActive(sessionId) {
    const state = this._sessions.get(sessionId);
    if (!state) return false;
    return state.phase !== ScenarioPhase.COMPLETED && state.phase !== ScenarioPhase.CANCELLED;
  }

  /**
   * Get active scenario state for a session.
   */
  getState(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  /**
   * Start a new scenario.
   * @returns {{ message: string, phase: string, scenarioId: string }}
   */
  start(sessionId, scenarioId) {
    const scenario = this.registry.getScenario(scenarioId);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

    const state = {
      scenarioId,
      specialistId: scenario.specialistId,
      phase: ScenarioPhase.INTRO,
      currentStepIndex: 0,
      completedSteps: [],
      collected: {},
      toolResults: null,
      retryCount: 0,
      lastParseError: null,
      turnCount: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._sessions.set(sessionId, state);

    logger.info('ScenarioEngine', `Started scenario ${scenarioId} for session ${sessionId}`);

    // Build intro + first question
    const firstStep = this._findNextStep(scenario, state);
    let message = scenario.introMessage || `Začínáme: ${scenario.name}`;

    if (firstStep) {
      state.phase = ScenarioPhase.COLLECTING;
      const question = this._getQuestionText(firstStep);
      message += `\n\n${question}`;
    }

    return { message, phase: state.phase, scenarioId };
  }

  /**
   * Handle user input during an active scenario.
   * @returns {{ message: string, phase: string, done: boolean, results?: Object }}
   */
  async handleInput(sessionId, input) {
    const state = this._sessions.get(sessionId);
    if (!state) return { message: 'Žádný aktivní scénář.', phase: 'IDLE', done: true };

    state.turnCount++;
    state.updatedAt = new Date().toISOString();
    const scenario = this.registry.getScenario(state.scenarioId);

    // Cancel command
    if (/^(?:zru[šs]|storno|cancel|stop|konec|quit)/i.test(input.trim())) {
      state.phase = ScenarioPhase.CANCELLED;
      this._sessions.delete(sessionId);
      logger.info('ScenarioEngine', `Scenario ${state.scenarioId} cancelled by user`);
      return { message: 'Scénář zrušen.', phase: ScenarioPhase.CANCELLED, done: true };
    }

    switch (state.phase) {
      case ScenarioPhase.INTRO:
      case ScenarioPhase.COLLECTING:
        return this._handleCollecting(state, scenario, input);

      case ScenarioPhase.PRESENTING:
        return this._handlePresenting(state, scenario, input);

      case ScenarioPhase.RECOMMENDING:
        return this._handleRecommending(state, scenario, input);

      case ScenarioPhase.ADJUSTING:
        return this._handleAdjusting(state, scenario, input);

      default:
        return { message: 'Scénář dokončen.', phase: state.phase, done: true };
    }
  }

  /**
   * Force-cancel a scenario.
   */
  cancel(sessionId) {
    const state = this._sessions.get(sessionId);
    if (state) {
      state.phase = ScenarioPhase.CANCELLED;
      this._sessions.delete(sessionId);
    }
  }

  /**
   * Get summary of active scenarios.
   */
  getActiveSessions() {
    const result = [];
    for (const [sessionId, state] of this._sessions) {
      if (state.phase !== ScenarioPhase.COMPLETED && state.phase !== ScenarioPhase.CANCELLED) {
        result.push({ sessionId, ...state });
      }
    }
    return result;
  }

  // ─── Phase Handlers ────────────────────────────────────────────────────

  _handleCollecting(state, scenario, input) {
    const step = scenario.steps[state.currentStepIndex];
    if (!step) {
      // No more steps — compute
      return this._runCompute(state, scenario);
    }

    // Extract value from input
    const extracted = step.extract(input);

    if (extracted == null || extracted === '') {
      state.retryCount++;
      if (state.retryCount >= 3) {
        // Use default if available, skip otherwise
        if (step.default != null) {
          const def = typeof step.default === 'function' ? step.default() : step.default;
          state.collected[step.id] = def;
          state.completedSteps.push(step.id);
          return this._advanceToNextStep(state, scenario,
            `Používám výchozí hodnotu: ${def}`);
        }
        if (!step.required) {
          state.completedSteps.push(step.id);
          return this._advanceToNextStep(state, scenario, 'Přeskakuji tento krok.');
        }
      }
      const errorMsg = step.errorMessage || 'Nepodařilo se rozpoznat odpověď. Zkuste to prosím znovu.';
      return { message: errorMsg, phase: ScenarioPhase.COLLECTING, done: false };
    }

    // Validate
    if (step.validate && !step.validate(extracted)) {
      const errorMsg = step.errorMessage || 'Neplatná hodnota. Zkuste to prosím znovu.';
      return { message: errorMsg, phase: ScenarioPhase.COLLECTING, done: false };
    }

    // Store
    state.collected[step.id] = extracted;
    state.completedSteps.push(step.id);
    state.retryCount = 0;

    return this._advanceToNextStep(state, scenario,
      `✓ ${step.id}: ${typeof extracted === 'object' ? JSON.stringify(extracted) : extracted}`);
  }

  _advanceToNextStep(state, scenario, ackMessage) {
    state.currentStepIndex++;

    // Find next non-skipped step
    const nextStep = this._findNextStep(scenario, state);
    if (!nextStep) {
      // All steps done → compute
      return this._runCompute(state, scenario, ackMessage);
    }

    // Update index to the found step
    state.currentStepIndex = scenario.steps.indexOf(nextStep);

    const question = this._getQuestionText(nextStep);
    const message = ackMessage ? `${ackMessage}\n\n${question}` : question;
    return { message, phase: ScenarioPhase.COLLECTING, done: false };
  }

  async _runCompute(state, scenario, ackMessage = '') {
    state.phase = ScenarioPhase.COMPUTING;

    try {
      const results = await scenario.compute(state.collected);
      state.toolResults = results;
      state.phase = ScenarioPhase.PRESENTING;

      const presentation = scenario.present(results, state.collected);
      const prefix = ackMessage ? `${ackMessage}\n\n` : '';
      return {
        message: `${prefix}${presentation}`,
        phase: ScenarioPhase.PRESENTING,
        done: false,
        results,
      };
    } catch (err) {
      logger.error('ScenarioEngine', `Compute failed for ${state.scenarioId}: ${err.message}`);
      state.phase = ScenarioPhase.CANCELLED;
      this._sessions.delete(state.scenarioId);
      return {
        message: `Chyba při výpočtu: ${err.message}`,
        phase: ScenarioPhase.CANCELLED,
        done: true,
      };
    }
  }

  _handlePresenting(state, scenario, input) {
    // Check if user wants recommendation
    if (/doporu[čc]|co\s+mi\s+doporu[čc]|co\s+rad[ií]|nejlep[šs][ií]|optim[áa]ln/i.test(input)) {
      state.phase = ScenarioPhase.RECOMMENDING;
      return {
        message: scenario.recommendPrompt || 'Na základě výsledků doporučuji:',
        phase: ScenarioPhase.RECOMMENDING,
        done: false,
        results: state.toolResults,
        recommendPrompt: scenario.recommendPrompt,
      };
    }

    // Check if user wants to adjust
    if (/zm[ěe]n|uprav|jin[áa]\s+[čc][áa]stk|p[řr]epo[čc][ií]t|znovu/i.test(input)) {
      state.phase = ScenarioPhase.ADJUSTING;
      return {
        message: 'Co chcete změnit? Zadejte novou hodnotu pro libovolný krok:\n' +
          scenario.steps.map((s, i) =>
            `  ${i + 1}. ${s.id}: ${state.collected[s.id] ?? '(nenastaveno)'}`
          ).join('\n'),
        phase: ScenarioPhase.ADJUSTING,
        done: false,
      };
    }

    // Otherwise, mark as done
    state.phase = ScenarioPhase.COMPLETED;
    this._sessions.delete(state.scenarioId);
    return {
      message: 'Děkuji za využití průvodce. Pokud máte další otázky, jsem tu pro vás.',
      phase: ScenarioPhase.COMPLETED,
      done: true,
      results: state.toolResults,
    };
  }

  _handleRecommending(state, scenario, input) {
    // After recommendation, scenario is done
    state.phase = ScenarioPhase.COMPLETED;
    const sessionId = [...this._sessions].find(([, s]) => s === state)?.[0];
    if (sessionId) this._sessions.delete(sessionId);

    return {
      message: 'Scénář dokončen. Pokud potřebujete další informace, ptejte se.',
      phase: ScenarioPhase.COMPLETED,
      done: true,
      results: state.toolResults,
    };
  }

  _handleAdjusting(state, scenario, input) {
    // Try to detect which step to adjust
    for (const step of scenario.steps) {
      const extracted = step.extract(input);
      if (extracted != null && extracted !== '') {
        state.collected[step.id] = extracted;
        // Re-compute
        return this._runCompute(state, scenario,
          `✓ Upraveno ${step.id}: ${typeof extracted === 'object' ? JSON.stringify(extracted) : extracted}`);
      }
    }

    // Check for step number
    const numMatch = input.match(/^\s*(\d+)\s*[.:]\s*(.*)/);
    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1;
      const stepValue = numMatch[2];
      if (idx >= 0 && idx < scenario.steps.length) {
        const step = scenario.steps[idx];
        const extracted = step.extract(stepValue);
        if (extracted != null) {
          state.collected[step.id] = extracted;
          return this._runCompute(state, scenario, `✓ Upraveno ${step.id}: ${extracted}`);
        }
      }
    }

    return {
      message: 'Nepodařilo se rozpoznat úpravu. Zadejte číslo kroku a novou hodnotu (např. "1: 900000").',
      phase: ScenarioPhase.ADJUSTING,
      done: false,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  _findNextStep(scenario, state) {
    for (let i = state.currentStepIndex; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      if (state.completedSteps.includes(step.id)) continue;
      if (step.skipIf && step.skipIf(state.collected)) {
        // Apply default for skipped steps
        if (step.default != null) {
          state.collected[step.id] = typeof step.default === 'function' ? step.default() : step.default;
        }
        state.completedSteps.push(step.id);
        continue;
      }
      return step;
    }
    return null;
  }

  _getQuestionText(step) {
    if (typeof step.question === 'string') return step.question;
    return step.question?.cs || step.question?.en || `Zadejte ${step.id}:`;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const scenarioRegistry = new ScenarioRegistry();
export const scenarioRunner = new ScenarioRunner(scenarioRegistry);

// ─── Built-in: Accountant Tax Optimization Scenario ──────────────────────────

scenarioRegistry.register({
  id: 'accountant.tax_optimization',
  specialistId: 'accountant',
  name: 'Optimalizace daňové struktury',
  description: 'Provede uživatele optimalizací daní — OSVČ vs s.r.o., paušální vs skutečné výdaje.',
  introMessage: 'Pomohu vám optimalizovat vaši daňovou strukturu. Postupně se vás zeptám na pár údajů a pak spočítám nejlepší variantu.',

  triggers: [
    /optimali[zs]ovat?\s+da[nň]/i,
    /jak[áa]\s+struktura\s+je\s+v[yý]hodn/i,
    /osv[čc]\s+nebo\s+s\.?\s?r\.?\s?o/i,
    /nejlep[šs][íi]\s+(?:da[nň]|zdan[ěe]n[ií])/i,
    /porovn[áa]n[ií]\s+da[nň]/i,
    /pr[ůu]vodce\s+da[nň]/i,
  ],

  steps: [
    {
      id: 'income',
      question: 'Jaký je váš očekávaný hrubý roční příjem? (například: 850 000 Kč nebo 850k)',
      extract: (input) => {
        let m = input.match(/(\d[\d\s,.]*\d)\s*[kK]/);
        if (m) return parseFloat(m[1].replace(/[\s,]/g, '')) * 1000;
        m = input.match(/(\d[\d\s,.]*\d?)\s*[mM]/);
        if (m) return parseFloat(m[1].replace(/[\s,]/g, '')) * 1000000;
        m = input.match(/(\d{1,3}(?:\s\d{3})+|\d{4,})/);
        if (m) return parseInt(m[1].replace(/\s/g, ''));
        m = input.match(/(\d+)/);
        if (m && parseInt(m[1]) >= 1000) return parseInt(m[1]);
        return null;
      },
      required: true,
      validate: (v) => v > 0 && v < 100_000_000,
      errorMessage: 'Prosím zadejte platnou roční částku (např. 850000 nebo 850k).',
    },
    {
      id: 'entity_type',
      question: 'Jak podnikáte nebo chcete podnikat?\n  1. OSVČ (živnostník)\n  2. s.r.o.\n  3. Chci porovnat obě varianty',
      extract: (input) => {
        if (/1|osv[čc]|[žz]ivnost/i.test(input)) return 'osvc';
        if (/2|s\.?\s?r\.?\s?o|sro/i.test(input)) return 'sro';
        if (/3|ob[eě]|porovn|v[šs]e/i.test(input)) return 'compare';
        return null;
      },
      required: true,
      errorMessage: 'Zvolte prosím 1 (OSVČ), 2 (s.r.o.) nebo 3 (porovnání).',
    },
    {
      id: 'expense_type',
      question: 'Jaké výdaje uplatňujete?\n  1. Paušální 60 % (obchod, služby)\n  2. Paušální 80 % (řemesla, zemědělství)\n  3. Skutečné výdaje',
      extract: (input) => {
        if (/1|60\s*%|obchod|slu[žz]b/i.test(input)) return 'flat_60';
        if (/2|80\s*%|[řr]emesl|zem[ěe]d/i.test(input)) return 'flat_80';
        if (/3|skute[čc]n|actual|re[áa]ln/i.test(input)) return 'actual';
        return null;
      },
      skipIf: (collected) => collected.entity_type === 'sro',
      required: false,
      default: 'flat_60',
    },
    {
      id: 'year',
      question: 'Pro jaký rok počítáme? (Enter = aktuální rok)',
      extract: (input) => {
        const m = input.match(/(202[3-9]|203[0-5])/);
        if (m) return parseInt(m[1]);
        // Accept empty/default signals
        if (/enter|v[ýy]choz|aktu[áa]ln|letos/i.test(input) || input.trim().length === 0) {
          return new Date().getFullYear();
        }
        return null;
      },
      required: false,
      default: () => Math.min(new Date().getFullYear(), 2025), // cap at supported years
    },
    {
      id: 'children',
      question: 'Kolik máte dětí, na které uplatňujete daňové zvýhodnění? (0 = žádné)',
      extract: (input) => {
        const m = input.match(/(\d+)/);
        if (m) return parseInt(m[0]);
        if (/[žz][áa]dn|ne|0|nic/i.test(input)) return 0;
        return null;
      },
      required: false,
      default: 0,
    },
  ],

  compute: async (collected) => {
    // Lazy-load tax tools
    const { calculateTax } = await import('./tools/tax-calc.js');
    const { compareTaxEntities } = await import('./tools/tax-calc.js');

    const baseParams = {
      gross_income: collected.income,
      year: collected.year || 2025,
      expense_type: collected.expense_type || 'flat_60',
      children: collected.children || 0,
    };

    const results = {};

    if (collected.entity_type === 'compare') {
      // Run comparison
      const comparison = compareTaxEntities(collected.income, {
        ...baseParams,
        entity_type: 'osvc',
      });
      results.comparison = comparison;
      results.osvc = calculateTax({ ...baseParams, entity_type: 'osvc' });
      results.sro = calculateTax({ ...baseParams, entity_type: 'sro' });
    } else {
      results[collected.entity_type] = calculateTax({
        ...baseParams,
        entity_type: collected.entity_type,
      });
    }

    return results;
  },

  present: (results, collected) => {
    const lines = ['## Výsledky daňové kalkulace\n'];
    const fmt = (n) => typeof n === 'number' ? n.toLocaleString('cs-CZ') : String(n);

    if (results.comparison?.success && results.comparison.result) {
      const cmp = results.comparison.result;
      lines.push(`**Příjem:** ${fmt(collected.income)} Kč | **Rok:** ${collected.year || 2025}`);
      lines.push('');
      lines.push('| Položka | OSVČ | s.r.o. |');
      lines.push('|---------|------|--------|');
      if (cmp.osvc && cmp.sro) {
        lines.push(`| Čistý příjem | ${fmt(cmp.osvc.net_income)} Kč | ${fmt(cmp.sro.net_income)} Kč |`);
        lines.push(`| Efektivní sazba | ${cmp.osvc.effective_rate}% | ${cmp.sro.effective_rate}% |`);
        lines.push(`| Celkové odvody | ${fmt(cmp.osvc.total_deductions)} Kč | ${fmt(cmp.sro.total_deductions)} Kč |`);
      }
      if (cmp.recommendation) {
        lines.push(`\n**Doporučení:** ${cmp.recommendation}`);
      }
    } else {
      // Single entity result
      const key = collected.entity_type;
      const r = results[key];
      if (r?.success && r.result) {
        const d = r.result;
        lines.push(`**${key.toUpperCase()}** | **Příjem:** ${fmt(collected.income)} Kč | **Rok:** ${collected.year || 2025}`);
        lines.push('');
        lines.push(`- Čistý příjem: **${fmt(d.net_income)} Kč**`);
        lines.push(`- Daň z příjmu: ${fmt(d.income_tax)} Kč`);
        lines.push(`- Sociální pojištění: ${fmt(d.social_insurance)} Kč`);
        lines.push(`- Zdravotní pojištění: ${fmt(d.health_insurance)} Kč`);
        lines.push(`- Efektivní sazba: **${d.effective_rate}%**`);
      }
    }

    lines.push('\n---');
    lines.push('Chcete se zeptat na detaily, upravit parametry, nebo dostat doporučení?');
    return lines.join('\n');
  },

  recommendPrompt: 'Na základě výpočtů doporuč uživateli optimální daňovou strukturu. Uveď konkrétní čísla z výsledků. Vysvětli proč je zvolená varianta výhodnější. Zmiň relevantní rizika a podmínky.',
});

export default { scenarioRegistry, scenarioRunner, ScenarioPhase };
