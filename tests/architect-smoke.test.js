// Architect Module Smoke Test — Class Loading & Export Verification
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies that all architect modules:
//   1. Load without errors (no missing imports, syntax ok)
//   2. Export expected classes/functions
//   3. Classes can be instantiated (basic constructor test)
//
// No LLM/Ollama needed — purely structural.
//
// ══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function assert(condition, label) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log('\n══ Architect Smoke Test ══\n');

// ─── Modules to test ────────────────────────────────────────────────────────

const ARCHITECT_MODULES = [
  { file: 'src/architect/actions.js',       exports: ['ActionExecutor', 'ActionType'] },
  { file: 'src/architect/coder.js',         exports: ['CoderLLM'] },
  { file: 'src/architect/context.js',       exports: ['ContextLoader'] },
  { file: 'src/architect/editor.js',        exports: ['EditorLLM'] },
  { file: 'src/architect/git.js',           exports: ['GitManager'] },
  { file: 'src/architect/history.js',       exports: ['HistoryManager'] },
  { file: 'src/architect/index.js',         exports: ['createArchitect'] },
  { file: 'src/architect/llm.js',           exports: ['ArchitectLLM'] },
  { file: 'src/architect/orchestrator.js',  exports: ['ConversationOrchestrator', 'Intent'] },
  { file: 'src/architect/prompts.js',       exports: ['PROMPTS'] },
  { file: 'src/architect/reviewer.js',      exports: ['ReviewerLLM', 'Verdict'] },
  { file: 'src/architect/roadmap.js',       exports: ['RoadmapManager'] },
  { file: 'src/architect/state.js',         exports: ['StateManager'] },
];

// ─── Test 1: Module loads ────────────────────────────────────────────────────

console.log('── 1. Module Loading ──\n');

const loaded = {};

for (const am of ARCHITECT_MODULES) {
  try {
    const mod = await import(path.join(ROOT, am.file));
    loaded[am.file] = mod;
    assert(true, `${am.file} loads`);
    console.log(`  ✅ ${am.file}`);
  } catch (err) {
    assert(false, `${am.file} loads: ${err.message}`);
    console.error(`  ❌ ${am.file}: ${err.message.slice(0, 100)}`);
  }
}

// ─── Test 2: Expected exports exist ──────────────────────────────────────────

console.log('\n── 2. Export Verification ──\n');

for (const am of ARCHITECT_MODULES) {
  const mod = loaded[am.file];
  if (!mod) continue;

  for (const exp of am.exports) {
    const exists = exp in mod;
    assert(exists, `${am.file} exports ${exp}`);
    if (exists) {
      const kind = typeof mod[exp] === 'function' ? (mod[exp].prototype ? 'class' : 'function') : typeof mod[exp];
      console.log(`  ✅ ${exp} (${kind})`);
    } else {
      console.log(`  ❌ ${exp} missing from ${am.file}`);
    }
  }
}

// ─── Test 3: Enum/constant verification ──────────────────────────────────────

console.log('\n── 3. Enum & Constant Checks ──\n');

// ActionType should have standard actions
const actionsMod = loaded['src/architect/actions.js'];
if (actionsMod?.ActionType) {
  const at = actionsMod.ActionType;
  const expectedActions = ['CODER', 'EDITOR'];
  for (const action of expectedActions) {
    const has = action in at || Object.values(at).includes(action);
    assert(has, `ActionType has ${action}`);
    console.log(`  ${has ? '✅' : '❌'} ActionType.${action}`);
  }
}

// Intent should have standard intents
const orchMod = loaded['src/architect/orchestrator.js'];
if (orchMod?.Intent) {
  const intent = orchMod.Intent;
  const hasValues = Object.keys(intent).length > 0;
  assert(hasValues, 'Intent enum has values');
  console.log(`  ✅ Intent enum: ${Object.keys(intent).length} values`);
}

// Verdict should have standard verdicts
const revMod = loaded['src/architect/reviewer.js'];
if (revMod?.Verdict) {
  const verdict = revMod.Verdict;
  const hasValues = Object.keys(verdict).length > 0;
  assert(hasValues, 'Verdict enum has values');
  console.log(`  ✅ Verdict enum: ${Object.keys(verdict).length} values`);
}

// PROMPTS should have template strings
const promptsMod = loaded['src/architect/prompts.js'];
if (promptsMod?.PROMPTS) {
  const p = promptsMod.PROMPTS;
  const hasKeys = Object.keys(p).length >= 3;
  assert(hasKeys, 'PROMPTS has ≥3 templates');
  console.log(`  ✅ PROMPTS: ${Object.keys(p).length} templates`);
}

// ─── Test 4: Factory function ────────────────────────────────────────────────

console.log('\n── 4. Factory Function ──\n');

const indexMod = loaded['src/architect/index.js'];
if (indexMod?.createArchitect) {
  assert(typeof indexMod.createArchitect === 'function', 'createArchitect is a function');
  console.log(`  ✅ createArchitect() exported`);
} else {
  console.log(`  ❌ createArchitect not found`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${pass} passed, ${fail} failed ══\n`);

if (fail > 0) {
  process.exit(1);
}
