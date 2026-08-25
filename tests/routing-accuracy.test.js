import './helpers/isolated-test-db.js';

// Routing Accuracy Test — Pattern Layer Measurement
// ══════════════════════════════════════════════════════════════════════════════
//
// Measures precision, recall, and tool accuracy of the specialist pattern layer.
// Uses the REAL accountant-cz specialist (not mocks).
// No LLM calls — purely deterministic pattern matching + ToolAdapter execution.
//
// Groups:
//   A) Clearly tax (8 queries) — expect match + correct tool
//   B) Borderline (6 queries) — match or null both valid
//   C) Non-tax (6 queries) — expect null (false positives = bad)
//
// Statuses:
//   ok      — tool matched AND executed successfully
//   clarify — tool matched but needs more params (counts as match for recall)
//   null    — no pattern match OR execution failure
//
// Decision thresholds:
//   Recall (A) ≥ 90%    — pattern catches known tax queries
//   Precision (C) ≥ 95% — pattern doesn't fire on non-tax
//   Tool accuracy (A) ≥ 90% — correct tool selected
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Setup ──────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS specialists (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'domain',
      status TEXT NOT NULL DEFAULT 'installed'
        CHECK (status IN ('installed', 'enabled', 'disabled')),
      manifest_json TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now')),
      enabled_at TEXT,
      disabled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
      migration_name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    )
  `);

  return db;
}

// ─── Test Cases ─────────────────────────────────────────────────────────────

// Group A: Clearly tax — expect match + correct tool
const GROUP_A = [
  {
    id: 1,
    input: 'Kolik zaplatím daní z příjmu 850000 Kč?',
    expectedTool: 'accountant.tax_calculator',
    description: 'income tax query with amount',
  },
  {
    id: 2,
    input: 'Vypočítej DPH z částky 12000 Kč',
    expectedTool: 'accountant.vat_calculator',
    description: 'VAT calculation with amount',
  },
  {
    id: 3,
    input: 'Kdy je termín podání daňového přiznání?',
    expectedTool: 'accountant.deadline_checker',
    description: 'deadline query',
  },
  {
    id: 4,
    input: 'Spočítej čistou mzdu při hrubé 45000 Kč',
    expectedTool: 'accountant.salary_calculator',
    description: 'net salary from gross',
  },
  {
    id: 5,
    input: 'Porovnej OSVČ a s.r.o. při příjmu 1200000',
    expectedTool: 'accountant.compare_tax_entities',
    description: 'entity comparison',
  },
  {
    id: 6,
    input: 'Kolik je minimální záloha na sociální OSVČ?',
    expectedTool: 'accountant.tax_calculator',
    description: 'social insurance OSVČ minimum',
  },
  {
    id: 7,
    input: 'DPH z 10000 Kč snížená sazba',
    expectedTool: 'accountant.vat_calculator',
    description: 'VAT with reduced rate',
  },
  {
    id: 8,
    input: 'Daňové odvody ze 100000 jako živnostník',
    expectedTool: 'accountant.tax_calculator',
    description: 'tax deductions from amount as OSVČ',
  },
];

// Group B: Borderline — match or null both valid
const GROUP_B = [
  {
    id: 9,
    input: 'Mám živnost, kolik musím odvádět?',
    description: 'vague OSVČ query (no amount)',
  },
  {
    id: 10,
    input: 'Co musím řešit na finančním úřadě?',
    description: 'general tax office question',
  },
  {
    id: 11,
    input: 'Jaké odvody se platí?',
    description: 'general deductions question',
  },
  {
    id: 12,
    input: 'Co znamená paušální daň?',
    description: 'informational question about flat tax',
  },
  {
    id: 13,
    input: 'Jak fungují daně u zaměstnance?',
    description: 'informational question about employee taxes',
  },
  {
    id: 14,
    input: 'Vyplatí se paušální výdaje nebo skutečné náklady?',
    description: 'comparison question (no amount)',
  },
];

// Group C: Non-tax — expect null
const GROUP_C = [
  {
    id: 15,
    input: 'Kolik je 850000 krát 0.15?',
    expectedTool: null,
    description: 'math calculation (not tax)',
  },
  {
    id: 16,
    input: 'Co je inflace?',
    expectedTool: null,
    description: 'economics question',
  },
  {
    id: 17,
    input: 'Jak napsat fakturu?',
    expectedTool: null,
    description: 'invoice question',
  },
  {
    id: 18,
    input: 'Co je DPH v Německu?',
    expectedTool: null,
    description: 'foreign VAT question (false positive risk)',
  },
  {
    id: 19,
    input: 'Jak funguje progresivní zdanění v USA?',
    expectedTool: null,
    description: 'foreign tax system question',
  },
  {
    id: 20,
    input: 'Jak optimalizovat cashflow firmy?',
    expectedTool: null,
    description: 'general business question',
  },
];

// ─── Boot Real Specialist ───────────────────────────────────────────────────

const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

const db = createTestDb();
const runtime = new SpecialistRuntime();
const loader = new SpecialistLoader(db, runtime, {
  baseDir: path.join(PROJECT_ROOT, 'specialists'),
});

await loader.boot();

if (!runtime.isSpecialist('accountant')) {
  console.error('FATAL: accountant specialist not registered after boot');
  process.exit(1);
}

// ─── Run Tests ──────────────────────────────────────────────────────────────

console.log('\n══ Routing Accuracy Test ══\n');

// Metrics
let aMatched = 0;      // pattern matched (ok OR clarify)
let aCorrectTool = 0;  // correct tool selected
let aClarify = 0;      // needed clarification
let aTotal = GROUP_A.length;

let bMatched = 0;
let bClarify = 0;
let bTotal = GROUP_B.length;

let cMatched = 0; // false positives (ok OR clarify counts)
let cTotal = GROUP_C.length;

// ── Group A ──────────────────────────────────────────────────────────────────

console.log('── Group A: Clearly Tax (expect match + correct tool) ──\n');

for (const tc of GROUP_A) {
  const result = await runtime.tryToolExecution('accountant', tc.input);

  if (result) {
    if (result.status === 'clarify') {
      // Clarify counts as match (pattern worked, just needs more params)
      aMatched++;
      aClarify++;
      const toolOk = result.toolType === tc.expectedTool;
      if (toolOk) aCorrectTool++;
      const icon = toolOk ? '🔸' : '⚠️';
      const toolNote = toolOk ? '' : ` (expected ${tc.expectedTool})`;
      console.log(`  ${icon} ${tc.id}. ${result.toolType} → clarify [${result.missingParams.join(', ')}]${toolNote}`);
      console.log(`     input: "${tc.input}"`);
      console.log(`     params: ${JSON.stringify(result.params)}`);
    } else {
      aMatched++;
      const toolOk = result.toolType === tc.expectedTool;
      if (toolOk) aCorrectTool++;
      const icon = toolOk ? '✅' : '⚠️';
      const toolNote = toolOk ? '' : ` (expected ${tc.expectedTool})`;
      console.log(`  ${icon} ${tc.id}. ${result.toolType}${toolNote}`);
      console.log(`     input: "${tc.input}"`);
      console.log(`     params: ${JSON.stringify(result.params)}`);
      if (result.duration !== undefined) {
        console.log(`     duration: ${result.duration}ms`);
      }
    }
  } else {
    console.log(`  ❌ ${tc.id}. null (MISS — expected ${tc.expectedTool})`);
    console.log(`     input: "${tc.input}"`);
  }
  console.log();
}

// ── Group B ──────────────────────────────────────────────────────────────────

console.log('── Group B: Borderline (match or null both valid) ──\n');

for (const tc of GROUP_B) {
  const result = await runtime.tryToolExecution('accountant', tc.input);

  if (result) {
    bMatched++;
    if (result.status === 'clarify') {
      bClarify++;
      console.log(`  🔸 ${tc.id}. ${result.toolType} → clarify [${result.missingParams.join(', ')}]`);
      console.log(`     input: "${tc.input}"`);
      console.log(`     params: ${JSON.stringify(result.params)}`);
    } else {
      console.log(`  ⚠️  ${tc.id}. ${result.toolType} (borderline match)`);
      console.log(`     input: "${tc.input}"`);
      console.log(`     params: ${JSON.stringify(result.params)}`);
    }
  } else {
    console.log(`  ⚠️  ${tc.id}. null (borderline miss)`);
    console.log(`     input: "${tc.input}"`);
  }
  console.log();
}

// ── Group C ──────────────────────────────────────────────────────────────────

console.log('── Group C: Non-tax (expect null) ──\n');

for (const tc of GROUP_C) {
  const result = await runtime.tryToolExecution('accountant', tc.input);

  if (result) {
    cMatched++;
    if (result.status === 'clarify') {
      console.log(`  ❌ ${tc.id}. ${result.toolType} → clarify [${result.missingParams.join(', ')}] (FALSE POSITIVE)`);
    } else {
      console.log(`  ❌ ${tc.id}. ${result.toolType} (FALSE POSITIVE)`);
    }
    console.log(`     input: "${tc.input}"`);
    console.log(`     params: ${JSON.stringify(result.params)}`);
    console.log(`     description: ${tc.description}`);
  } else {
    console.log(`  ✅ ${tc.id}. null`);
    console.log(`     input: "${tc.input}"`);
  }
  console.log();
}

// ── Summary ──────────────────────────────────────────────────────────────────

const recall = aTotal > 0 ? (aMatched / aTotal * 100).toFixed(1) : 'N/A';
const toolAccuracy = aMatched > 0 ? (aCorrectTool / aMatched * 100).toFixed(1) : 'N/A';
const precision = cTotal > 0 ? ((cTotal - cMatched) / cTotal * 100).toFixed(1) : 'N/A';

console.log('══════════════════════════════════════════════════════');
console.log('                    SUMMARY');
console.log('══════════════════════════════════════════════════════');
console.log();
console.log(`  Group A — Clearly Tax:`);
console.log(`    Recall:        ${aMatched}/${aTotal} = ${recall}%`);
console.log(`    Tool accuracy: ${aCorrectTool}/${aMatched > 0 ? aMatched : aTotal} = ${toolAccuracy}%`);
console.log(`    Clarify:       ${aClarify} queries`);
console.log();
console.log(`  Group B — Borderline:`);
console.log(`    Matched:       ${bMatched}/${bTotal} (informational only)`);
console.log(`    Clarify:       ${bClarify} queries`);
console.log();
console.log(`  Group C — Non-tax:`);
console.log(`    Precision:     ${cTotal - cMatched}/${cTotal} = ${precision}%`);
console.log(`    False pos:     ${cMatched} queries`);
console.log();

// Decision thresholds
const recallOk = aMatched / aTotal >= 0.90;
const precisionOk = (cTotal - cMatched) / cTotal >= 0.95;
const toolAccOk = aMatched > 0 && aCorrectTool / aMatched >= 0.90;

console.log('── Decision Thresholds ──');
console.log(`  Recall ≥ 90%:        ${recallOk ? '✅ PASS' : '❌ FAIL'} (${recall}%)`);
console.log(`  Precision ≥ 95%:     ${precisionOk ? '✅ PASS' : '❌ FAIL'} (${precision}%)`);
console.log(`  Tool accuracy ≥ 90%: ${toolAccOk ? '✅ PASS' : '❌ FAIL'} (${toolAccuracy}%)`);
console.log();

if (recallOk && precisionOk && toolAccOk) {
  console.log('  → Pattern layer READY for CRE hint implementation');
} else {
  console.log('  → Pattern layer needs improvement before CRE hint');
  if (!recallOk) console.log('    - Expand pattern coverage (recall too low)');
  if (!precisionOk) console.log('    - Tighten patterns (false positives)');
  if (!toolAccOk) console.log('    - Fix tool selection (wrong tool matched)');
}

console.log('\n══════════════════════════════════════════════════════\n');

db.close();

process.exitCode = recallOk && precisionOk && toolAccOk ? 0 : 1;
