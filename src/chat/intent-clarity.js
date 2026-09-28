import { createHash } from 'node:crypto';

// Only core-issued, source-bound evidence may accompany a chat tool request.
const evidence = new WeakMap();
const ROLES = new Set(['action', 'target', 'quantity', 'value', 'unit', 'negation', 'scope', 'recipient']);
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
const bounded = (value, max = 512) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const NEGATION_PATTERN = /\b(?:not|never|without|do\s+not|ne|nikdy|nechci|ne(?:pis|posil|maz|smaz|men|zmen|nastav|spust|sniz|zvys|uklad|uloz|prepis|odesil|odesli)[a-z]*)\b/gu;

const question = (reason, text, options = []) => ({ kind: 'clarify', reason, slot: 'intent_meaning', question: text, options });

// General language/literal syntax. No device or domain vocabulary.
function protectedLiterals(input) {
  const patterns = [
    /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu,
    /(?:^|\s)(?:[\p{L}\d_./-]+\.[\p{L}\d_-]+)(?=$|[\s,;!?])/gu,
    /[+-]?\d+(?:[.,]\d+)?\s*[%°]?/gu,
    NEGATION_PATTERN,
  ];
  return [...new Set(patterns.flatMap(pattern => [...fold(input).matchAll(pattern)].map(match => match[0].trim())))];
}

/** Validate a semantic proposal; material values must be copied from source. */
export function assessIntentClarity(input, understanding, { supersededSources = [] } = {}) {
  if (!understanding || understanding.version !== 1 || !['information', 'action'].includes(understanding.kind)
      || !Array.isArray(understanding.slots) || understanding.slots.length > 24
      || !Array.isArray(understanding.ambiguities) || understanding.ambiguities.length > 8) {
    return question('meaning_unverified', 'Nemám ověřenou interpretaci požadavku. Upřesni prosím zamýšlenou akci, její cíl a případné hodnoty. Zatím nic nespouštím.');
  }
  for (const slot of understanding.slots) {
    if (!slot || !ROLES.has(slot.role) || !bounded(slot.name, 80) || !bounded(slot.source)
        || !bounded(slot.value) || !String(input).includes(slot.source)) {
      return question('source_not_grounded', 'Interpretace obsahuje údaj, který nemohu doložit původním zadáním. Upřesni prosím přesný cíl a parametry akce. Zatím nic nespouštím.');
    }
    // Classifying a typo is allowed; rewriting the cited action is not.
    // Edit distance cannot distinguish a typo from an opposite action.
    if (slot.source !== slot.value) {
      return { ...question('material_meaning_changed', `V zadání je „${slot.source}“, interpretace uvádí „${slot.value}“. Co má platit pro ${slot.name}? Zatím nic nespouštím.`, [slot.source, slot.value]), unresolvedName: slot.name };
    }
  }
  for (const ambiguity of understanding.ambiguities) {
    if (!ambiguity || !bounded(ambiguity.slot, 80) || !bounded(ambiguity.question)
        || !Array.isArray(ambiguity.options) || ambiguity.options.length < 2 || ambiguity.options.length > 4
        || !ambiguity.options.every(option => bounded(option, 160))) {
      return question('ambiguity_invalid', 'Význam požadavku zůstává nejasný. Upřesni prosím akci, cíl a hodnoty; zatím nic nespouštím.');
    }
  }
  if (understanding.kind === 'action') {
    if (!understanding.slots.some(slot => slot.role === 'action')) return question('action_missing', 'Jakou konkrétní akci chceš provést? Zatím nic nespouštím.');
    const missingNegation = [...fold(input).matchAll(NEGATION_PATTERN)].map(match => match[0]).find(literal =>
      !understanding.slots.some(slot => slot.role === 'negation' && fold(slot.source).includes(literal))
      && !supersededSources.some(value => fold(value).includes(literal)));
    if (missingNegation) return question('negation_unverified', `V zadání je zákaz „${missingNegation}“, který interpretace nezachovává jako zákaz. Která akce je zakázaná? Zatím nic nespouštím.`);
    const omitted = protectedLiterals(input).find(literal => !understanding.slots.some(slot => fold(slot.source).includes(literal))
      && !supersededSources.some(value => fold(value).includes(literal)));
    if (omitted) return question('material_value_omitted', `V interpretaci chybí údaj „${omitted}“. Jak má být v požadované akci použit? Zatím nic nespouštím.`);
  }
  if (understanding.ambiguities.length) {
    const first = understanding.ambiguities[0];
    return { ...question('meaning_ambiguous', `${first.question} Zatím nic nespouštím.`, first.options), unresolvedName: first.slot };
  }
  if (understanding.kind === 'action' && understanding.slots.some(slot => slot.role === 'negation')) {
    return { kind: 'no_effect', reason: 'explicit_negation', answer: 'Rozpoznal jsem zákaz akce a tento požadavek nespouštím. Pokud chceš provést jinou část, zadej ji samostatně.' };
  }
  return null;
}

export function issueIntentEvidence(source, classification, understanding, fixedParameters = {}) {
  const token = Object.freeze({});
  const snapshot = structuredClone({ source, classification, understanding, fixedParameters });
  snapshot.digest = `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
  evidence.set(token, snapshot);
  return token;
}

export function getIntentEvidence(token) {
  const value = token && evidence.get(token);
  return value ? structuredClone(value) : null;
}

export function prepareClarificationInput(input, pending) {
  const metadata = pending?.metadata;
  if (!metadata?.intentSource || !metadata?.clarificationText) return { source: input, supersededSources: [] };
  const text = fold(input).replace(/[.!?]+$/u, '');
  if (/^(?:ne|zrus|zrusit|stop|cancel)$/u.test(text)) return { cancelled: true };
  const choices = metadata.clarificationOptions || [];
  const explicit = choices.find(option => option.trim() === String(input).trim());
  if (/^(?:ano|jo|ok|yes|potvrzuji|schvaluji)$/u.test(text)) return { unresolved: true, question: metadata.clarificationText, options: choices };
  if (!explicit) return { source: input, supersededSources: [] };
  return {
    source: `${metadata.intentSource}\n\nVýslovné upřesnění uživatele: ${input}`,
    supersededSources: (metadata.intentUnderstanding?.slots || []).filter(slot => slot.name === metadata.unresolvedName).map(slot => slot.source),
  };
}

/** Check typed parameters before the existing tool/effect authority sees them. */
export function verifyToolIntent(token, toolId, input, { effectful = false } = {}) {
  if (!token) return null; // Explicit typed callers retain their M2 authority.
  const proof = getIntentEvidence(token);
  if (!proof) return { reason: 'invalid_intent_evidence', message: 'Interpretace požadavku není ověřená.' };
  if (effectful && proof.understanding.kind !== 'action') return { reason: 'information_is_not_action', message: 'Informační dotaz neopravňuje ke změně stavu.' };
  const expected = { FILE_WRITE: ['file.write'], FILE_READ: ['file.read', 'file.list'], FILE_EXPLAIN: ['file.read'], SHELL: ['code.execute'] }[proof.classification?.intent];
  if (effectful && expected && !expected.includes(toolId)) return { reason: 'operation_changed', message: 'Vybraný nástroj mění původně rozpoznanou akci.' };
  const materialRoles = {
    path: ['target'], filePath: ['target'], target: ['target'],
    recipient: ['recipient'], address: ['recipient', 'target'], destination: ['recipient', 'target'],
    amount: ['value'], value: ['value'], unit: ['unit'], quantity: ['quantity'],
    command: ['action', 'value'], port: ['value'],
  };
  const seen = new WeakSet();
  const visit = (object, depth = 0) => {
    if (!object || typeof object !== 'object') return null;
    if (depth > 12 || seen.has(object)) return { reason: 'invalid_tool_input', message: 'Parametry nástroje nelze ověřit.' };
    seen.add(object);
    for (const [key, value] of Object.entries(object || {})) {
      if (value && typeof value === 'object') { const invalid = visit(value, depth + 1); if (invalid) return invalid; }
      else if (materialRoles[key] && value !== null && value !== undefined
          && proof.fixedParameters?.[toolId]?.[key] !== value
          && !proof.understanding.slots.some(slot => materialRoles[key].includes(slot.role) && slot.value === String(value))) {
        return { reason: 'tool_parameter_changed', message: `Parametr ${key} „${value}“ nemá oporu v ověřené interpretaci zadání.` };
      }
    }
    return null;
  };
  return visit(input);
}
