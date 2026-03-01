// v89 — Project Welcome Generator
// ══════════════════════════════════════════════════════════════════════════════
//
// Template-based welcome messages for project creation/open.
// No LLM calls — pure string assembly from project state.
// Max ~600 chars per welcome. No empty sections.
//
// ══════════════════════════════════════════════════════════════════════════════

import { PhaseStatus, StateType } from './project-state-reader.js';

// ─── New project welcome ────────────────────────────────────────────────────

/**
 * Generate welcome message for a newly created project.
 *
 * @param {{ name: string, description?: string, type?: string }} opts
 * @returns {string}
 */
export function generateNewProjectWelcome({ name, description, type }) {
  const parts = [];

  parts.push(`Založil jsi nový projekt **${name}**${type ? ` (${type})` : ''}.`);

  if (description) {
    parts.push(description.length > 150 ? description.substring(0, 150) + '...' : description);
  }

  parts.push('');
  parts.push('Připravil jsem základní strukturu. Doporučuji workflow:');
  parts.push('1. **Specifikace** — upřesníme požadavky');
  parts.push('2. **Plánování** — vygeneruji roadmapu');
  parts.push('3. **Implementace** — psaní kódu');
  parts.push('4. **Review** — finalizace');
  parts.push('');
  parts.push('→ **Začít specifikací**');
  parts.push('→ Prostě mi řekni s čím potřebuješ pomoct');

  return parts.join('\n');
}

// ─── Existing project welcome ───────────────────────────────────────────────

/**
 * Generate welcome message for an opened existing project.
 * Content varies by stateType and phaseStatus.
 *
 * @param {Object} state — from readProjectState()
 * @returns {string}
 */
export function generateExistingProjectWelcome(state) {
  switch (state.stateType) {
    case StateType.FULL:
      return _welcomeFull(state);
    case StateType.HYBRID:
      return _welcomeHybrid(state);
    case StateType.FOREIGN:
      return _welcomeForeign(state);
    case StateType.EMPTY:
      return _welcomeEmpty(state);
    default:
      return _welcomeForeign(state);
  }
}

// ─── FULL: C3 README + C3 ROADMAP ──────────────────────────────────────────

function _welcomeFull(state) {
  if (state.phaseStatus === PhaseStatus.COMPLETED) {
    return _welcomeFullCompleted(state);
  }

  const parts = [];
  parts.push(`Otevřel jsi projekt **${state.name}**.`);

  if (state.summary && state.summary !== 'Projekt bez popisu') {
    parts.push(state.summary);
  }

  parts.push('');

  if (state.currentPhase) {
    parts.push(`📊 **Aktuální fáze:** ${state.currentPhase}`);
  }

  if (state.completedPhases.length > 0) {
    parts.push(`✅ ${state.completedPhases.join(', ')}`);
  }

  if (state.pendingPhases.length > 0) {
    parts.push(`⬜ ${state.pendingPhases.join(', ')}`);
  }

  if (state.stack.length > 0) {
    parts.push(`Stack: ${state.stack.join(', ')}`);
  }

  parts.push('');

  if (state.currentPhase) {
    parts.push(`→ **Navázat na ${state.currentPhase}**`);
  }
  parts.push('→ Vygenerovat detailní plán');
  parts.push('→ Auditovat projekt');

  return parts.join('\n');
}

function _welcomeFullCompleted(state) {
  const parts = [];
  parts.push(`Projekt **${state.name}** má všechny fáze dokončené.`);

  if (state.summary && state.summary !== 'Projekt bez popisu') {
    parts.push(state.summary);
  }

  parts.push('');
  parts.push('→ **Spustit nový cyklus**');
  parts.push('→ Auditovat architekturu');
  parts.push('→ Přidat nové milníky');

  return parts.join('\n');
}

// ─── HYBRID: Mix of C3 and foreign/missing ──────────────────────────────────

function _welcomeHybrid(state) {
  const parts = [];
  parts.push(`Otevřel jsi projekt **${state.name}**.`);

  if (state.summary && state.summary !== 'Projekt bez popisu') {
    parts.push(state.summary);
  }

  parts.push('');

  // Specific notes about what's missing/foreign
  const notes = [];
  if (state.hasReadme && !state.hasC3Structure) {
    notes.push('README existuje ale není ve standardním C3 formátu.');
  }
  if (!state.hasReadme) {
    notes.push('Projekt nemá README.');
  }
  if (!state.hasRoadmap) {
    notes.push('Projekt nemá ROADMAP.');
  }
  if (state.hasRoadmap && !state.hasC3Structure) {
    notes.push('ROADMAP nemá C3 strukturu.');
  }
  if (notes.length > 0) {
    parts.push(notes.join(' '));
  }

  // Show phases if available
  if (state.currentPhase) {
    parts.push(`📊 **Fáze:** ${state.currentPhase}`);
  }

  parts.push('');
  parts.push('→ **Vytvořit/aktualizovat projektové soubory**');
  parts.push('→ Pomoct s implementací');
  parts.push('→ Analyzovat aktuální stav');

  return parts.join('\n');
}

// ─── FOREIGN: Both exist but neither is C3-generated ────────────────────────

function _welcomeForeign(state) {
  const parts = [];
  parts.push(`Otevřel jsi projekt **${state.name}**. Přečetl jsem existující soubory.`);

  if (state.summary && state.summary !== 'Projekt bez popisu') {
    parts.push(state.summary);
  }

  if (state.stack.length > 0) {
    parts.push(`Stack: ${state.stack.join(', ')}`);
  }

  parts.push('');
  parts.push('→ **Vytvořit C3 strukturu** (README + ROADMAP) — zachovám existující obsah');
  parts.push('→ Prostě mi řekni s čím potřebuješ pomoct');

  return parts.join('\n');
}

// ─── EMPTY: Neither README nor ROADMAP ──────────────────────────────────────

function _welcomeEmpty(state) {
  const parts = [];
  parts.push(`Otevřel jsi projekt **${state.name}**, ale neobsahuje README ani ROADMAP.`);

  if (state.stack.length > 0) {
    parts.push(`Detekovaný stack: ${state.stack.join(', ')}`);
  }

  parts.push('');
  parts.push('→ **Vytvořit README + ROADMAP + analyzovat stack**');
  parts.push('→ Popsat co projekt dělá a já vytvořím dokumentaci');

  return parts.join('\n');
}

export default { generateNewProjectWelcome, generateExistingProjectWelcome };
