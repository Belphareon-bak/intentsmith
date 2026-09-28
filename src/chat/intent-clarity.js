import { createHash } from 'node:crypto';

// Only core-issued, source-bound evidence may accompany a chat tool request.
const evidence = new WeakMap();
const ROLES = new Set(['action', 'target', 'quantity', 'value', 'unit', 'negation', 'scope', 'recipient']);
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
const bounded = (value, max = 512) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const word = char => !!char && /[\p{L}\p{N}_]/u.test(char);
const question = (reason, text, options = []) => ({ kind: 'clarify', reason, slot: 'intent_meaning', question: text, options });

// Exact source offsets and Unicode word boundaries, never substring evidence.
function citations(input, source) {
  const spans = [];
  for (let start = input.indexOf(source); start >= 0; start = input.indexOf(source, start + 1)) {
    const end = start + source.length;
    if (!(word(source[0]) && word(input[start - 1])) && !(word(source.at(-1)) && word(input[end]))) spans.push({ start, end, source });
  }
  return spans;
}

export function literalFileTargets(input, { includeNumericSuffixes = false } = {}) {
  input = String(input);
  const otherTargets = [...input.matchAll(/https?:\/\/[^\s„“"']+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
  return [...input.matchAll(/(?<![\p{L}\d_./@-])(?:[\p{L}\d_/-][\p{L}\d_./-]*\.[\p{L}\d_-]+|\.[\p{L}\d_-]+)(?![\p{L}\d_/-])/gu)]
    .map(match => ({ start: match.index, end: match.index + match[0].length, source: match[0] }))
    .filter(span => !otherTargets.some(other => other.start <= span.start && other.end >= span.end))
    // Bare decimal/version literals have no filename extension. Explicit paths
    // and dotfiles retain their literal meaning, including numeric basenames.
    .filter(span => includeNumericSuffixes || span.source.includes('/') || span.source.startsWith('.') || !/\.\d+(?:\.\d+)*$/u.test(span.source));
}

function nonNegativeWord(source) {
  return /^(?:nebo|nebot|nej[\p{L}]*|nez|nekdo|neco|nekde|nekdy|nekam|nekolik|nech(?:am|as|a|ame|ate|aji|at|al[\p{L}]*|ej[\p{L}]*|te)|new(?:er|est)?|next|need(?:s|ed|ing)?|net(?:work(?:s|ing)?|flix|beans)?)$/u.test(fold(source));
}
function targetSpans(input) {
  return [...literalFileTargets(input, { includeNumericSuffixes: true }), ...[...input.matchAll(/https?:\/\/[^\s„“"']+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }))];
}
function negations(input) {
  const explicit = [...input.matchAll(/(?<![\p{L}\d_])(?:not|never|without|do\s+not|dont|[\p{L}]+n['’]t|ne|nikdy|nechci)(?![\p{L}\d_])/giu)];
  // Czech ne- is productive and can follow the object or an adversative clause.
  // This conservative scan gates action proposals, not informational chat.
  const prefixed = [...input.matchAll(/(?<![\p{L}\d_])ne[\p{L}]+(?![\p{L}\d_])/giu)];
  const targets = targetSpans(input);
  const spans = new Map();
  for (const [matches, uncertain] of [[explicit, false], [prefixed, true]]) {
    for (const match of matches) {
      const span = { start: match.index, end: match.index + match[0].length, source: match[0], uncertain };
      const key = `${span.start}:${span.end}`;
      if (!nonNegativeWord(span.source) && !targets.some(target => covers(target, span)) && !spans.has(key)) spans.set(key, span);
    }
  }
  return [...spans.values()];
}
function validNegationDecisions(input, decisions = []) {
  if (!Array.isArray(decisions)) return [];
  return decisions.filter(span => span && typeof span.prohibited === 'boolean' && Number.isInteger(span.start) && Number.isInteger(span.end)
    && input.slice(span.start, span.end) === span.source && citations(input, span.source).some(c => c.start === span.start && c.end === span.end));
}
function prohibitions(input, slots, decisions = []) {
  const scanned = negations(input), targets = targetSpans(input);
  const proposed = slots.filter(slot => slot.role === 'negation').flatMap(slot => citations(input, slot.source))
    .filter(span => !nonNegativeWord(span.source) && !targets.some(target => covers(target, span))
      && !scanned.some(candidate => covers(span, candidate)))
    .map(span => ({ ...span, uncertain: true }));
  const choices = validNegationDecisions(input, decisions);
  return [...scanned, ...proposed].flatMap(span => {
    const choice = choices.find(c => c.start === span.start && c.end === span.end && c.source === span.source);
    return choice?.prohibited === false ? [] : [{ ...span, confirmed: choice?.prohibited === true }];
  });
}
function assessProhibition(input, slots, decisions) {
  const negative = prohibitions(input, slots, decisions);
  const unresolved = negative.find(span => !span.confirmed && (span.uncertain
    || !slots.some(slot => slot.role === 'negation' && citations(input, slot.source).some(c => covers(c, span)))));
  if (!negative.some(span => span.confirmed) && unresolved) {
    const occurrences = citations(input, unresolved.source);
    const occurrence = occurrences.length > 1 ? ` (${occurrences.findIndex(span => span.start === unresolved.start) + 1}. výskyt)` : '';
    return { ...question('negation_unverified', `Je „${unresolved.source}“${occurrence} v tomto požadavku zákaz akce? Vyber „je to zákaz“, nebo „není to zákaz“. Zatím nic nespouštím.`, ['je to zákaz', 'není to zákaz']),
      negationChoice: true, unresolvedSpan: { start: unresolved.start, end: unresolved.end, source: unresolved.source, role: 'negation' } };
  }
  if (negative.length) return { kind: 'no_effect', reason: 'explicit_negation', answer: 'Rozpoznal jsem zákaz akce a tento požadavek nespouštím. Pokud chceš provést jinou část, zadej ji samostatně.' };
  return null;
}

function protectedLiterals(input) {
  const patterns = [/[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu, /(?<![\p{L}\d_])[+-]?\d+(?:[.,]\d+)?\s*[%°]?/gu];
  return [...literalFileTargets(input), ...patterns.flatMap(pattern => [...input.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].trimEnd().length, source: match[0].trimEnd() })))];
}
const covers = (outer, inner) => outer.start <= inner.start && outer.end >= inner.end;
function safeSuperseded(input, spans, forbidden) {
  return spans.filter(span => span && span.role !== 'negation' && Number.isInteger(span.start) && Number.isInteger(span.end)
    && input.slice(span.start, span.end) === span.source && citations(input, span.source).some(c => c.start === span.start && c.end === span.end)
    && !forbidden.some(neg => neg.start < span.end && neg.end > span.start));
}
function reference(input, slot, index) {
  const matches = citations(input, slot.source);
  return matches.length === 1 ? { ...matches[0], role: slot.role, index } : null;
}

/** Model labels never issue a user's decision about a source span. */
export function assessIntentClarity(input, understanding, { supersededSpans = [], negationDecisions = [] } = {}) {
  input = String(input);
  if (!understanding || understanding.version !== 1 || !['information', 'action'].includes(understanding.kind)
      || !Array.isArray(understanding.slots) || understanding.slots.length > 24
      || !Array.isArray(understanding.ambiguities) || understanding.ambiguities.length > 8) {
    return question('meaning_unverified', 'Nemám ověřenou interpretaci požadavku. Upřesni prosím zamýšlenou akci, její cíl a případné hodnoty. Zatím nic nespouštím.');
  }
  const slots = understanding.slots;
  for (const slot of slots) {
    if (understanding.kind === 'information' && slot && !['target', 'recipient'].includes(slot.role)) continue;
    if (!slot || !ROLES.has(slot.role) || !bounded(slot.name, 80) || !bounded(slot.source) || !bounded(slot.value) || !citations(input, slot.source).length) {
      return question('source_not_grounded', 'Interpretace obsahuje údaj, který nemohu doložit celým citátem z původního zadání. Upřesni prosím přesný cíl a parametry akce. Zatím nic nespouštím.');
    }
  }
  const negative = prohibitions(input, slots, negationDecisions);
  if (understanding.kind === 'action') {
    const prohibition = assessProhibition(input, slots, negationDecisions);
    if (prohibition) return prohibition;
  }
  for (const [index, slot] of slots.entries()) {
    // A wording summary in an explanation grants no effect authority. Literal
    // identity remains mandatory for actions and concrete read/recipient targets.
    const citedFiles = slot.role === 'target' ? literalFileTargets(slot.source) : [];
    const exactFile = citedFiles.length === 1 && citedFiles[0].source === slot.value
      && literalFileTargets(input).some(file => file.source === slot.value);
    if (slot.source !== slot.value && !exactFile && (understanding.kind === 'action' || ['target', 'recipient'].includes(slot.role))) return { ...question('material_meaning_changed', `V zadání je „${slot.source}“, interpretace uvádí „${slot.value}“. Co má platit pro ${slot.name}? Zatím nic nespouštím.`, [slot.source, slot.value]), unresolvedSpan: reference(input, slot, index) };
  }
  for (const ambiguity of understanding.ambiguities) {
    if (!ambiguity || !bounded(ambiguity.slot, 80) || !bounded(ambiguity.question) || !Array.isArray(ambiguity.options)
        || ambiguity.options.length < 2 || ambiguity.options.length > 4 || !ambiguity.options.every(option => bounded(option, 160))) return question('ambiguity_invalid', 'Význam požadavku zůstává nejasný. Upřesni prosím akci, cíl a hodnoty; zatím nic nespouštím.');
  }
  if (understanding.kind === 'action') {
    if (!slots.some(slot => slot.role === 'action')) return question('action_missing', 'Jakou konkrétní akci chceš provést? Zatím nic nespouštím.');
    const superseded = safeSuperseded(input, supersededSpans, negative);
    const omitted = protectedLiterals(input).find(literal => !slots.some(slot => citations(input, slot.source).some(c => covers(c, literal))) && !superseded.some(c => covers(c, literal)));
    if (omitted) return question('material_value_omitted', `V interpretaci chybí údaj „${omitted.source}“. Jak má být v požadované akci použit? Zatím nic nespouštím.`);
  }
  if (understanding.ambiguities.length) {
    const first = understanding.ambiguities[0];
    const matching = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.name === first.slot && slot.role !== 'negation');
    return { ...question('meaning_ambiguous', `${first.question} Zatím nic nespouštím.`, first.options), unresolvedSpan: matching.length === 1 ? reference(input, matching[0].slot, matching[0].index) : null };
  }
  return null;
}

export function latestAssistantContent(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (!(entry.response?.tag?.speaker === 'system' || entry.role === 'assistant' || entry.speaker === 'system')) continue;
    const metadata = entry.response?.tag?.metadata ?? entry.metadata ?? {};
    if (entry.isSummary || metadata.intentContentEligible !== true) continue;
    const content = entry.response?.content || entry.content;
    if (typeof content === 'string' && content) return content;
  }
  return null;
}

/** One explicitly quoted literal; preserve its bytes and never guess among two. */
export function literalWriteContent(input, fileTarget) {
  const quoted = [...String(input).matchAll(/"((?:\\.|[^"\\])*)"|„([^“]*)“|‘([^’]*)’|'([^']*)'/gu)]
    .map(match => match.slice(1).find(value => value !== undefined))
    .filter(value => value !== fileTarget);
  return quoted.length === 1 ? quoted[0] : null;
}

export function issueIntentEvidence(source, classification, understanding, fixedParameters = {}, { negationDecisions = [] } = {}) {
  const token = Object.freeze({});
  const snapshot = structuredClone({ source, classification, understanding, fixedParameters,
    negationDecisions: validNegationDecisions(source, negationDecisions) });
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
  if (!metadata?.intentSource || !metadata?.clarificationText) return { source: input, supersededSpans: [] };
  const answer = fold(input).replace(/[.!?]+$/u, '').trim();
  if (/^(?:ne|zrus|zrusit|stop|cancel|nechci|nic)$/u.test(answer)) return { cancelled: true };
  if (/^(?:ano|jo|ok|yes|potvrzuji|schvaluji)$/u.test(answer)) return { unresolved: true, question: metadata.clarificationText, options: metadata.clarificationOptions || [] };
  const selected = (metadata.clarificationOptions || []).find(option => fold(option) === answer);
  if (!selected) return { source: input, supersededSpans: [] };
  const span = metadata.unresolvedSpan;
  if (metadata.negationChoice === true && span) {
    const choices = validNegationDecisions(metadata.intentSource, metadata.intentNegationDecisions || []);
    const choice = validNegationDecisions(metadata.intentSource, [{ ...span, prohibited: fold(selected) === 'je to zakaz' }]);
    if (!choice.length) return { unresolved: true, question: metadata.clarificationText, options: metadata.clarificationOptions };
    return { source: metadata.intentSource, supersededSpans: metadata.intentSupersededSpans || [],
      negationDecisions: [...choices.filter(c => c.start !== span.start || c.end !== span.end), ...choice] };
  }
  const supersededSpans = span ? safeSuperseded(metadata.intentSource, [span], prohibitions(metadata.intentSource, metadata.intentUnderstanding?.slots || [], metadata.intentNegationDecisions || [])) : [];
  return { source: `${metadata.intentSource}\n\nVýslovné upřesnění uživatele: ${input}`, supersededSpans,
    negationDecisions: validNegationDecisions(metadata.intentSource, metadata.intentNegationDecisions || []),
    resolvedGpuQuantity: metadata.gpuQuantityPending === true };
}

// Actual typed M2 fields. Generated code/SQL have no implicit chat binding.
const TOOL_FIELDS = {
  'file.read': { path: ['target'] }, 'file.list': { path: ['target'] },
  'file.write': { path: ['target'], content: ['value', 'scope'] },
  'code.execute': { code: ['value'], language: ['unit', 'value'] },
  'database.query': { query: ['value'], database: ['target'] },
  'web.search': { query: ['value', 'scope'] },
  'web.scrape': { url: ['target'], query: ['value', 'scope'], maxLength: ['value'] },
  'local.date': { query: [] }, 'local.calendar': { query: [] }, 'local.math': { query: [] },
};
export function verifyToolIntent(token, toolId, input, { effectful = false, deriveSearchQuery } = {}) {
  if (!token) return null; // Explicit typed callers still use their own M2 authority.
  const proof = evidence.get(token);
  const mismatch = () => ({ reason: 'tool_intent_mismatch', message: `Parametry nástroje ${toolId} nemohu doložit ověřeným zadáním. Nic nespouštím.` });
  if (!proof || !input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return mismatch();
  if (effectful && prohibitions(proof.source, proof.understanding.slots, proof.negationDecisions).length) return mismatch();
  if (effectful && proof.understanding.kind !== 'action') return mismatch();
  const intent = proof.classification?.intent;
  const expected = { FILE_WRITE: ['file.write'], FILE_READ: ['file.read', 'file.list'], FILE_EXPLAIN: ['file.read'], SHELL: ['code.execute'], SEARCH: ['web.search', 'web.scrape'], REPORT: ['web.search', 'web.scrape', 'database.query'], CODE: ['code.execute', 'file.read', 'file.write'], LOCAL: ['local.date', 'local.calendar', 'local.math'] }[intent] || [];
  if (!expected.includes(toolId) && !proof.fixedParameters?.[toolId]) return mismatch();
  const fields = TOOL_FIELDS[toolId];
  if (!fields || Object.keys(input).length !== Object.keys(fields).length || Object.keys(input).some(key => !(key in fields))) return mismatch();
  const slots = proof.understanding.slots;
  const preservesQuery = value => typeof value === 'string'
    && protectedLiterals(proof.source).every(literal => citations(value, literal.source).length)
    && slots.filter(slot => slot.role !== 'action').every(slot => citations(value, slot.value).length);
  for (const [key, roles] of Object.entries(fields)) {
    const value = input[key];
    const fixed = proof.fixedParameters?.[toolId];
    if (fixed && Object.hasOwn(fixed, key)) { if (value !== fixed[key]) return mismatch(); else continue; }
    if (value === null && ['language', 'database'].includes(key) && !slots.some(slot => slot.name === key || (key === 'database' && slot.role === 'target'))) continue;
    if (key === 'maxLength' && value === 10_000) continue; // Core default, no semantic change.
    if (key === 'query' && (toolId.startsWith('web.') || toolId.startsWith('local.'))
        && (value === proof.source || (toolId === 'web.search' && deriveSearchQuery && value === deriveSearchQuery(proof.source) && preservesQuery(value)))) continue;
    if (key === 'content' && typeof value === 'string' && value.length > 0 && citations(proof.source, value).length) continue;
    if (!slots.some(slot => roles.includes(slot.role) && (value === slot.value || (key === 'maxLength' && Number.isSafeInteger(value) && String(value) === slot.value)) && slot.source === slot.value && citations(proof.source, slot.source).length)) return mismatch();
  }
  return null;
}

// Deterministic GPU fallback retained from 9203266f. It runs before the model,
// including if the model would call an operation "information".
export function assessGpuIntent(input, { resolvedGpuQuantity = false, negationDecisions = [] } = {}) {
  const text = fold(input);
  if (!/\b(?:gpu|gup|grafik(?:a|y|u|ou)|grafick(?:a|e|ou|ych)?\s+kart(?:a|u|y|ou)|graphics?\s+card)\b/u.test(text)) return null;
  const change = /\b(?:sniz|snizte|snizit|nastav|nastavte|nastavit|omez|omezte|omezit|zmen|zmente|zmenit|uprav|upravte|upravit|set|reduce|lower|limit|undervolt)\b/u;
  const info = /^(?:prosim\s+|please\s+)?(?:jak|co|proc|vysvetli|popis|napis|naprogramuj|navrhni|analyzuj|porad|what|how|explain|write|describe|(?:muzes|muzete)\s+(?:mi\s+)?(?:rict|vysvetlit|popsat|poradit|ukazat))\b/u;
  const later = /\b(?:a|pak|potom|and|then)\s+(?:ted\s+)?(?:mi\s+)?(?:sniz|nastav|omez|zmen|uprav|set|reduce|lower|limit)\b/u;
  if (!resolvedGpuQuantity && info.test(text) && !later.test(text)) return null;
  if (prohibitions(input, [], negationDecisions).length) return { kind: 'no_effect', reason: 'negated_gpu_change', answer: 'Rozumím. Nastavení GPU neměním.' };
  if (!change.test(text)) return null;
  const unsupported = { kind: 'no_effect', reason: 'gpu_control_unavailable', answer: 'Požadavek na změnu nastavení GPU jsem rozpoznal, ale nemám ověřený nástroj, který by ji v IntentSmith provedl. Nic jsem nenastavil. Původní požadavek zůstává neprovedený.' };
  if (resolvedGpuQuantity) return unsupported;
  const percentages = [...text.matchAll(/[+\-]?\d+(?:[.,]\d+)?\s*%/gu)].map(match => Number(match[0].replace('%', '').replace(',', '.').trim()));
  if (percentages.some(value => !Number.isFinite(value) || value < 0 || value > 100)) return question('invalid_percentage', 'Procentní hodnota musí být v rozsahu 0–100 %. Jakou konkrétní hodnotu chceš? Celý požadavek zatím pozastavuji.');
  const voltage = /\b(?:napeti|voltaz|voltage|volt|voltu|voltech|undervolt)\b/u.test(text);
  const power = /\b(?:prikon|vykon|power|watt|wattu|wattech)\b/u.test(text);
  const half = /\b(?:na|o)\s+polovinu\b|\bhalf\b|\b50\s*%/u.test(text);
  if ((voltage && (power || half || percentages.length)) || (!voltage && !power)) return question('gpu_quantity_ambiguous', 'Napětí GPU a limit příkonu jsou různé veličiny. Myslíš napětí, nebo limit příkonu ve wattech? Celý požadavek zatím pozastavuji.', ['napětí', 'příkon']);
  return unsupported;
}
