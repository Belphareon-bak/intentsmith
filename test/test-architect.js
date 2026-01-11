/**
 * C.3 Architect Mode Tests
 * 
 * Testuje:
 * 1. Intent Detection (regex patterns)
 * 2. Gates (code, switch, complete)
 * 3. WIP Guard
 * 4. Confidence handling
 * 5. ReviewerLLM confidenceImpact
 * 
 * Spuštění: node test/test-architect.js
 */

import { strict as assert } from 'assert';

// ═══════════════════════════════════════════════════════════════════════════
// Test Framework
// ═══════════════════════════════════════════════════════════════════════════

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('\n🧪 C.3 Architect Mode Tests\n');
  console.log('═'.repeat(60));
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}`);
      failed++;
    }
  }
  
  console.log('═'.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Intent Detection Tests
// ═══════════════════════════════════════════════════════════════════════════

const INTENT_PATTERNS = {
  APPROVE_TO_CODE: [
    /^(ok|ano|yes|jo|jasně|jasne|sure)\s*[,.]?\s*(generuj|jdi|go)/i,
    /^generuj\s*(kód|kod|code)?/i,
    /^jdi\s+do\s+(kódu|kodu|code)/i,
    /^(go|start)\s*(coding|code)?/i,
    /^implementuj/i,
  ],
  QUERY_STATUS: [
    /^(stav|status|progress)/i,
    /^(jak|kde)\s+(jsme|to vypadá)/i,
    /^(ukaž|ukaz|show)\s+(stav|status|progress)/i,
    /^co\s+(zbývá|zbyva|chybí|chybi)/i,
  ],
  SWITCH_BLOCK: [
    /^(přejdi|prejdi|jdi)\s+(na|k)\s+(.+)/i,
    /^switch\s+(to\s+)?(.+)/i,
    /^\d{2}-[a-z-]+/i,
  ],
  SET_BLOCKER: [
    /^(problém|problem|blocker|stuck)/i,
    /^(nefunguje|nefungovalo|broken)/i,
    /^(zasekl|zasekli)\s+(jsem se|jsme se)/i,
  ],
  COMPLETE_BLOCK: [
    /^(hotovo|done|dokončeno|dokonceno|complete)/i,
    /^(označ|oznac|mark)\s+(jako\s+)?(hotovo|done|complete)/i,
    /^(uzavři|uzavri|close)\s+(blok|block)/i,
  ],
  REQUEST_DEFINITION: [
    /^(navrhni|vytvoř|vytvor|create)\s+(definici|definition)/i,
    /^(co|jak)\s+(by\s+)?(měla?|mela?)\s+(být|byt|obsahovat)/i,
  ],
  QUERY_CONFIDENCE: [
    /^(jaká|jaka|kolik)\s+(je\s+)?(confidence|jistota|důvěra)/i,
    /^confidence\??$/i,
  ],
};

function detectIntent(message) {
  const trimmed = message.trim();
  
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return intent;
      }
    }
  }
  
  return 'CONVERSATION';
}

// Intent Detection Tests
test('Intent: "generuj" → APPROVE_TO_CODE', () => {
  assert.equal(detectIntent('generuj'), 'APPROVE_TO_CODE');
});

test('Intent: "generuj kód" → APPROVE_TO_CODE', () => {
  assert.equal(detectIntent('generuj kód'), 'APPROVE_TO_CODE');
});

test('Intent: "ok, generuj" → APPROVE_TO_CODE', () => {
  assert.equal(detectIntent('ok, generuj'), 'APPROVE_TO_CODE');
});

test('Intent: "ano, jdi do kódu" → APPROVE_TO_CODE', () => {
  assert.equal(detectIntent('ano, jdi do kódu'), 'APPROVE_TO_CODE');
});

test('Intent: "implementuj" → APPROVE_TO_CODE', () => {
  assert.equal(detectIntent('implementuj'), 'APPROVE_TO_CODE');
});

test('Intent: "stav" → QUERY_STATUS', () => {
  assert.equal(detectIntent('stav'), 'QUERY_STATUS');
});

test('Intent: "status" → QUERY_STATUS', () => {
  assert.equal(detectIntent('status'), 'QUERY_STATUS');
});

test('Intent: "jak jsme" → QUERY_STATUS', () => {
  assert.equal(detectIntent('jak jsme'), 'QUERY_STATUS');
});

test('Intent: "co zbývá" → QUERY_STATUS', () => {
  assert.equal(detectIntent('co zbývá'), 'QUERY_STATUS');
});

test('Intent: "přejdi na 01-auth" → SWITCH_BLOCK', () => {
  assert.equal(detectIntent('přejdi na 01-auth'), 'SWITCH_BLOCK');
});

test('Intent: "jdi k 02-api" → SWITCH_BLOCK', () => {
  assert.equal(detectIntent('jdi k 02-api'), 'SWITCH_BLOCK');
});

test('Intent: "01-database" → SWITCH_BLOCK', () => {
  assert.equal(detectIntent('01-database'), 'SWITCH_BLOCK');
});

test('Intent: "problém" → SET_BLOCKER', () => {
  assert.equal(detectIntent('problém'), 'SET_BLOCKER');
});

test('Intent: "nefunguje" → SET_BLOCKER', () => {
  assert.equal(detectIntent('nefunguje'), 'SET_BLOCKER');
});

test('Intent: "zasekl jsem se" → SET_BLOCKER', () => {
  assert.equal(detectIntent('zasekl jsem se'), 'SET_BLOCKER');
});

test('Intent: "hotovo" → COMPLETE_BLOCK', () => {
  assert.equal(detectIntent('hotovo'), 'COMPLETE_BLOCK');
});

test('Intent: "done" → COMPLETE_BLOCK', () => {
  assert.equal(detectIntent('done'), 'COMPLETE_BLOCK');
});

test('Intent: "označ jako hotovo" → COMPLETE_BLOCK', () => {
  assert.equal(detectIntent('označ jako hotovo'), 'COMPLETE_BLOCK');
});

test('Intent: "navrhni definici" → REQUEST_DEFINITION', () => {
  assert.equal(detectIntent('navrhni definici'), 'REQUEST_DEFINITION');
});

test('Intent: "confidence?" → QUERY_CONFIDENCE', () => {
  assert.equal(detectIntent('confidence?'), 'QUERY_CONFIDENCE');
});

test('Intent: "jaká je confidence" → QUERY_CONFIDENCE', () => {
  assert.equal(detectIntent('jaká je confidence'), 'QUERY_CONFIDENCE');
});

test('Intent: "ahoj, jak se máš?" → CONVERSATION', () => {
  assert.equal(detectIntent('ahoj, jak se máš?'), 'CONVERSATION');
});

test('Intent: "vysvětli mi architekturu" → CONVERSATION', () => {
  assert.equal(detectIntent('vysvětli mi architekturu'), 'CONVERSATION');
});

// ═══════════════════════════════════════════════════════════════════════════
// Gate Tests
// ═══════════════════════════════════════════════════════════════════════════

const GateResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARN: 'WARN',
};

function checkCodeGate(state) {
  const reasons = [];
  
  // Must have current block
  if (!state.current?.path) {
    reasons.push('Není vybrán žádný blok');
  }
  
  // Confidence threshold
  if (state.definitionConfidence < 0.7) {
    reasons.push(`Confidence ${(state.definitionConfidence * 100).toFixed(0)}% < 70%`);
  }
  
  // No blocker
  if (state.blocker) {
    reasons.push(`Aktivní blocker: ${state.blocker.description}`);
  }
  
  // Must be in architect mode
  if (state.mode !== 'architect') {
    reasons.push(`Nesprávný mode: ${state.mode}`);
  }
  
  return {
    result: reasons.length === 0 ? GateResult.PASS : GateResult.FAIL,
    reasons,
  };
}

function checkSwitchGate(state, targetPath) {
  const reasons = [];
  
  // Check scope lock
  if (state.scopeLock && state.scopeLock !== targetPath.split('/')[0]) {
    reasons.push(`Scope lock na ${state.scopeLock}, nelze přejít na ${targetPath}`);
  }
  
  return {
    result: reasons.length === 0 ? GateResult.PASS : GateResult.FAIL,
    reasons,
  };
}

function checkCompleteGate(state) {
  const reasons = [];
  
  // Must have current block
  if (!state.current?.path) {
    reasons.push('Není vybrán žádný blok');
  }
  
  // Must not be already done
  if (state.current?.done) {
    reasons.push('Blok je již označen jako hotový');
  }
  
  return {
    result: reasons.length === 0 ? GateResult.PASS : GateResult.FAIL,
    reasons,
  };
}

// Code Gate Tests
test('CodeGate: PASS when all conditions met', () => {
  const state = {
    mode: 'architect',
    current: { path: '01-auth' },
    definitionConfidence: 0.8,
    blocker: null,
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.PASS);
  assert.equal(result.reasons.length, 0);
});

test('CodeGate: FAIL when no current block', () => {
  const state = {
    mode: 'architect',
    current: null,
    definitionConfidence: 0.8,
    blocker: null,
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.FAIL);
  assert.ok(result.reasons.some(r => r.includes('Není vybrán')));
});

test('CodeGate: FAIL when confidence < 70%', () => {
  const state = {
    mode: 'architect',
    current: { path: '01-auth' },
    definitionConfidence: 0.5,
    blocker: null,
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.FAIL);
  assert.ok(result.reasons.some(r => r.includes('50%')));
});

test('CodeGate: FAIL when blocker active', () => {
  const state = {
    mode: 'architect',
    current: { path: '01-auth' },
    definitionConfidence: 0.8,
    blocker: { description: 'API není dostupné' },
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.FAIL);
  assert.ok(result.reasons.some(r => r.includes('blocker')));
});

test('CodeGate: FAIL when wrong mode', () => {
  const state = {
    mode: 'coder',
    current: { path: '01-auth' },
    definitionConfidence: 0.8,
    blocker: null,
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.FAIL);
  assert.ok(result.reasons.some(r => r.includes('mode')));
});

test('CodeGate: FAIL with multiple reasons', () => {
  const state = {
    mode: 'review',
    current: null,
    definitionConfidence: 0.3,
    blocker: { description: 'test' },
  };
  const result = checkCodeGate(state);
  assert.equal(result.result, GateResult.FAIL);
  assert.ok(result.reasons.length >= 3);
});

// Switch Gate Tests
test('SwitchGate: PASS when no scope lock', () => {
  const state = { scopeLock: null };
  const result = checkSwitchGate(state, '02-api');
  assert.equal(result.result, GateResult.PASS);
});

test('SwitchGate: PASS when switching within locked scope', () => {
  const state = { scopeLock: '01-auth' };
  const result = checkSwitchGate(state, '01-auth/login');
  assert.equal(result.result, GateResult.PASS);
});

test('SwitchGate: FAIL when switching outside locked scope', () => {
  const state = { scopeLock: '01-auth' };
  const result = checkSwitchGate(state, '02-api');
  assert.equal(result.result, GateResult.FAIL);
});

// Complete Gate Tests
test('CompleteGate: PASS when current block not done', () => {
  const state = {
    current: { path: '01-auth', done: false },
  };
  const result = checkCompleteGate(state);
  assert.equal(result.result, GateResult.PASS);
});

test('CompleteGate: FAIL when no current block', () => {
  const state = { current: null };
  const result = checkCompleteGate(state);
  assert.equal(result.result, GateResult.FAIL);
});

test('CompleteGate: FAIL when already done', () => {
  const state = {
    current: { path: '01-auth', done: true },
  };
  const result = checkCompleteGate(state);
  assert.equal(result.result, GateResult.FAIL);
});

// ═══════════════════════════════════════════════════════════════════════════
// WIP Guard Tests
// ═══════════════════════════════════════════════════════════════════════════

class MockGitManager {
  constructor() {
    this.lastWIPCommit = null;
  }
  
  async commitWIP(blockPath) {
    this.lastWIPCommit = `abc123-${blockPath}`;
    return { success: true };
  }
  
  hasWIPSafepoint() {
    return !!this.lastWIPCommit;
  }
  
  getWIPCommit() {
    return this.lastWIPCommit;
  }
  
  clearWIPMarker() {
    this.lastWIPCommit = null;
  }
}

test('WIPGuard: hasWIPSafepoint false initially', () => {
  const git = new MockGitManager();
  assert.equal(git.hasWIPSafepoint(), false);
});

test('WIPGuard: hasWIPSafepoint true after commitWIP', async () => {
  const git = new MockGitManager();
  await git.commitWIP('01-auth');
  assert.equal(git.hasWIPSafepoint(), true);
});

test('WIPGuard: getWIPCommit returns commit hash', async () => {
  const git = new MockGitManager();
  await git.commitWIP('01-auth');
  assert.ok(git.getWIPCommit().includes('01-auth'));
});

test('WIPGuard: clearWIPMarker resets state', async () => {
  const git = new MockGitManager();
  await git.commitWIP('01-auth');
  git.clearWIPMarker();
  assert.equal(git.hasWIPSafepoint(), false);
  assert.equal(git.getWIPCommit(), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Confidence Impact Tests
// ═══════════════════════════════════════════════════════════════════════════

const Verdict = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
};

function normalizeConfidenceImpact(impact, verdict, issues = []) {
  // If LLM provided valid impact, use it (clamped)
  if (typeof impact === 'number' && !isNaN(impact)) {
    return Math.max(-0.2, Math.min(0.1, impact));
  }
  
  // Calculate from verdict and issues
  let calculated = 0;
  
  switch (verdict) {
    case Verdict.PASS:
      calculated = 0.05;
      break;
    case Verdict.WARN:
      calculated = -0.05;
      break;
    case Verdict.FAIL:
      calculated = -0.15;
      break;
  }
  
  // Adjust for critical issues
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  calculated -= criticalCount * 0.05;
  
  return Math.max(-0.2, Math.min(0.1, calculated));
}

function applyConfidenceImpact(currentConfidence, impact) {
  return Math.max(0, Math.min(1, currentConfidence + impact));
}

test('ConfidenceImpact: PASS verdict gives positive impact', () => {
  const impact = normalizeConfidenceImpact(undefined, Verdict.PASS);
  assert.ok(impact > 0);
});

test('ConfidenceImpact: WARN verdict gives negative impact', () => {
  const impact = normalizeConfidenceImpact(undefined, Verdict.WARN);
  assert.ok(impact < 0);
});

test('ConfidenceImpact: FAIL verdict gives larger negative impact', () => {
  const warnImpact = normalizeConfidenceImpact(undefined, Verdict.WARN);
  const failImpact = normalizeConfidenceImpact(undefined, Verdict.FAIL);
  assert.ok(failImpact < warnImpact);
});

test('ConfidenceImpact: respects LLM-provided value', () => {
  const impact = normalizeConfidenceImpact(0.08, Verdict.PASS);
  assert.equal(impact, 0.08);
});

test('ConfidenceImpact: clamps to max 0.1', () => {
  const impact = normalizeConfidenceImpact(0.5, Verdict.PASS);
  assert.equal(impact, 0.1);
});

test('ConfidenceImpact: clamps to min -0.2', () => {
  const impact = normalizeConfidenceImpact(-0.5, Verdict.FAIL);
  assert.equal(impact, -0.2);
});

test('ConfidenceImpact: critical issues reduce impact', () => {
  const noIssues = normalizeConfidenceImpact(undefined, Verdict.WARN, []);
  const withCritical = normalizeConfidenceImpact(undefined, Verdict.WARN, [
    { severity: 'critical' },
  ]);
  assert.ok(withCritical < noIssues);
});

test('ConfidenceImpact: apply clamps result to 0-1', () => {
  assert.equal(applyConfidenceImpact(0.95, 0.1), 1.0);
  assert.equal(applyConfidenceImpact(0.05, -0.2), 0);
});

test('ConfidenceImpact: apply works with normal values', () => {
  assert.equal(applyConfidenceImpact(0.7, 0.05), 0.75);
  assert.equal(applyConfidenceImpact(0.7, -0.1), 0.6);
});

// ═══════════════════════════════════════════════════════════════════════════
// Immutable Input Tests
// ═══════════════════════════════════════════════════════════════════════════

function makeImmutable(data) {
  return JSON.parse(JSON.stringify(data));
}

test('Immutable: primitive string preserved', () => {
  const original = 'test definition';
  const immutable = makeImmutable(original);
  assert.equal(immutable, original);
});

test('Immutable: object is deep copied', () => {
  const original = { a: 1, b: { c: 2 } };
  const immutable = makeImmutable(original);
  
  // Modify original
  original.b.c = 999;
  
  // Immutable should be unchanged
  assert.equal(immutable.b.c, 2);
});

test('Immutable: array is deep copied', () => {
  const original = [{ name: 'file1' }, { name: 'file2' }];
  const immutable = makeImmutable(original);
  
  // Modify original
  original[0].name = 'modified';
  
  // Immutable should be unchanged
  assert.equal(immutable[0].name, 'file1');
});

test('Immutable: null handled', () => {
  const immutable = makeImmutable(null);
  assert.equal(immutable, null);
});

test('Immutable: empty array handled', () => {
  const immutable = makeImmutable([]);
  assert.deepEqual(immutable, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// Verdict Normalization Tests
// ═══════════════════════════════════════════════════════════════════════════

function normalizeVerdict(verdict) {
  const v = (verdict || '').toUpperCase();
  if (v === 'PASS' || v === 'OK' || v === 'APPROVED') return Verdict.PASS;
  if (v === 'FAIL' || v === 'FAILED' || v === 'REJECTED') return Verdict.FAIL;
  return Verdict.WARN;
}

test('Verdict: "PASS" → PASS', () => {
  assert.equal(normalizeVerdict('PASS'), Verdict.PASS);
});

test('Verdict: "pass" (lowercase) → PASS', () => {
  assert.equal(normalizeVerdict('pass'), Verdict.PASS);
});

test('Verdict: "OK" → PASS', () => {
  assert.equal(normalizeVerdict('OK'), Verdict.PASS);
});

test('Verdict: "APPROVED" → PASS', () => {
  assert.equal(normalizeVerdict('APPROVED'), Verdict.PASS);
});

test('Verdict: "FAIL" → FAIL', () => {
  assert.equal(normalizeVerdict('FAIL'), Verdict.FAIL);
});

test('Verdict: "FAILED" → FAIL', () => {
  assert.equal(normalizeVerdict('FAILED'), Verdict.FAIL);
});

test('Verdict: "REJECTED" → FAIL', () => {
  assert.equal(normalizeVerdict('REJECTED'), Verdict.FAIL);
});

test('Verdict: "WARN" → WARN', () => {
  assert.equal(normalizeVerdict('WARN'), Verdict.WARN);
});

test('Verdict: unknown → WARN (default)', () => {
  assert.equal(normalizeVerdict('something'), Verdict.WARN);
});

test('Verdict: null → WARN (default)', () => {
  assert.equal(normalizeVerdict(null), Verdict.WARN);
});

test('Verdict: undefined → WARN (default)', () => {
  assert.equal(normalizeVerdict(undefined), Verdict.WARN);
});

// ═══════════════════════════════════════════════════════════════════════════
// Editor Intent Tests
// ═══════════════════════════════════════════════════════════════════════════

// Add EDIT_FILE patterns to INTENT_PATTERNS for testing
INTENT_PATTERNS['EDIT_FILE'] = [
  /^(uprav|edit|modifikuj|zm[eě][nň]).*(soubor|file)/i,
  /^(oprav|fix|patch).*(soubor|file|kód|code)/i,
  /^(p[řr]idej|append|prepend).*(do|to).*(soubor|file)/i,
  /^(refaktor|refactor)/i,
];

test('Intent: "uprav soubor src/api.js" → EDIT_FILE', () => {
  assert.equal(detectIntent('uprav soubor src/api.js'), 'EDIT_FILE');
});

test('Intent: "edit file config.js" → EDIT_FILE', () => {
  assert.equal(detectIntent('edit file config.js'), 'EDIT_FILE');
});

test('Intent: "oprav kód v auth.js" → EDIT_FILE', () => {
  assert.equal(detectIntent('oprav kód v auth.js'), 'EDIT_FILE');
});

test('Intent: "fix file server.js" → EDIT_FILE', () => {
  assert.equal(detectIntent('fix file server.js'), 'EDIT_FILE');
});

test('Intent: "refaktor" → EDIT_FILE', () => {
  assert.equal(detectIntent('refaktor'), 'EDIT_FILE');
});

test('Intent: "přidej do souboru" → EDIT_FILE', () => {
  assert.equal(detectIntent('přidej do souboru'), 'EDIT_FILE');
});

// ═══════════════════════════════════════════════════════════════════════════
// Editor Modification Tests
// ═══════════════════════════════════════════════════════════════════════════

function applyModification(currentContent, modification) {
  switch (modification.type) {
    case 'replace':
      return modification.content;
    
    case 'patch':
      if (!currentContent.includes(modification.search)) {
        throw new Error(`Search string not found`);
      }
      return currentContent.replace(modification.search, modification.replace);
    
    case 'append':
      return currentContent + modification.content;
    
    case 'prepend':
      return modification.content + currentContent;
    
    default:
      throw new Error(`Unknown modification type: ${modification.type}`);
  }
}

test('Editor: replace replaces entire content', () => {
  const result = applyModification('old content', { type: 'replace', content: 'new content' });
  assert.equal(result, 'new content');
});

test('Editor: patch replaces search string', () => {
  const result = applyModification('hello world', { type: 'patch', search: 'world', replace: 'universe' });
  assert.equal(result, 'hello universe');
});

test('Editor: patch throws when search not found', () => {
  try {
    applyModification('hello world', { type: 'patch', search: 'foo', replace: 'bar' });
    assert.fail('Should throw');
  } catch (err) {
    assert.ok(err.message.includes('not found'));
  }
});

test('Editor: append adds to end', () => {
  const result = applyModification('line1\n', { type: 'append', content: 'line2\n' });
  assert.equal(result, 'line1\nline2\n');
});

test('Editor: prepend adds to start', () => {
  const result = applyModification('line2\n', { type: 'prepend', content: 'line1\n' });
  assert.equal(result, 'line1\nline2\n');
});

test('Editor: unknown type throws', () => {
  try {
    applyModification('content', { type: 'unknown', content: 'x' });
    assert.fail('Should throw');
  } catch (err) {
    assert.ok(err.message.includes('Unknown'));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Run Tests
// ═══════════════════════════════════════════════════════════════════════════

runTests();
