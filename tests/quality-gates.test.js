import './helpers/isolated-test-db.js';

// Test 7: Quality Gate Enforcement — "Can the engine say NO?"
// ══════════════════════════════════════════════════════════════════════════════
//
// This test SHOULD INITIALLY FAIL.
//
// Purpose: verify the engine rejects low-quality artifacts.
// Each failing assertion = a missing quality gate that must be added.
//
// Quality gates tested:
//   QG1: Spec without design_decisions → reject
//   QG2: Spec goals without success_criteria → reject
//   QG3: Spec requirements without acceptance_test → reject
//   QG4: Roadmap milestones without acceptance_criteria → reject
//   QG5: Roadmap milestones without test_strategy → reject
//   QG6: Change impact analysis without required fields → reject
//   QG7: Spec design_decisions without alternatives_considered → reject
//   QG8: Roadmap without requirements_coverage → reject
//
// ══════════════════════════════════════════════════════════════════════════════

import { validateSpec } from '../src/planner/lifecycle-spec.js';
import { validateDependencies } from '../src/planner/lifecycle-planning.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

// ─── Minimal valid spec (baseline) ──────────────────────────────────────────

function makeValidSpec() {
  return {
    title: 'Klíčenka — Encrypted Password Manager CLI',
    goals: [
      { id: 'G1', description: 'Store passwords encrypted at rest', priority: 'MUST', success_criteria: 'AES-256-GCM encrypted file on disk, verified with openssl' },
      { id: 'G2', description: 'Retrieve passwords by key name', priority: 'MUST', success_criteria: 'klicenka get <key> prints password to stdout in <100ms' },
      { id: 'G3', description: 'Cross-platform CLI (Linux, macOS)', priority: 'SHOULD', success_criteria: 'CI passes on ubuntu-latest and macos-latest' },
    ],
    requirements: {
      functional: [
        { id: 'R1', description: 'Store key-value encrypted entries', goal_id: 'G1', acceptance_test: 'klicenka set test 123 → klicenka get test → "123"' },
        { id: 'R2', description: 'List all stored keys', goal_id: 'G2', acceptance_test: 'klicenka list → shows "test" after set' },
        { id: 'R3', description: 'Delete entries by key', goal_id: 'G2', acceptance_test: 'klicenka delete test → klicenka get test → error' },
        { id: 'R4', description: 'Master password authentication', goal_id: 'G1', acceptance_test: 'Wrong password → "Authentication failed"' },
        { id: 'R5', description: 'Export vault as encrypted backup', goal_id: 'G1', acceptance_test: 'klicenka export → .enc file, importable on another machine' },
      ],
      non_functional: [
        { id: 'NF1', category: 'security', description: 'AES-256-GCM encryption', metric: 'No plaintext in vault file (verified with strings command)' },
        { id: 'NF2', category: 'performance', description: 'Startup under 500ms', metric: 'time klicenka get test < 0.5s' },
        { id: 'NF3', category: 'portability', description: 'No native dependencies', metric: 'npm install without node-gyp compilation' },
      ],
    },
    tech_stack: {
      languages: ['Node.js 22'],
      frameworks: ['commander 12'],
      tools: ['better-sqlite3', 'node:crypto'],
      rationale: 'Node.js for cross-platform CLI, better-sqlite3 for embedded storage',
    },
    design_decisions: [
      {
        id: 'DD1',
        decision: 'Encryption algorithm',
        chosen: 'AES-256-GCM',
        alternatives_considered: ['ChaCha20-Poly1305', 'XSalsa20'],
        rationale: 'AES-256-GCM has hardware acceleration on modern CPUs, ChaCha is better for mobile but not our target',
      },
      {
        id: 'DD2',
        decision: 'Key derivation function',
        chosen: 'Argon2id',
        alternatives_considered: ['scrypt', 'PBKDF2'],
        rationale: 'Argon2id is memory-hard (resists GPU attacks), PBKDF2 is legacy, scrypt is viable but less configurable',
      },
    ],
    risks: [
      { id: 'RISK1', description: 'Vault corruption on crash during write', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Atomic write with temp file + rename' },
      { id: 'RISK2', description: 'Master password forgotten', severity: 'HIGH', likelihood: 'MEDIUM', mitigation: 'Recovery key printed on first setup' },
      { id: 'RISK3', description: 'Argon2 not available on all platforms', severity: 'MEDIUM', likelihood: 'LOW', mitigation: 'Fallback to scrypt with warning' },
    ],
    acceptance_criteria: [
      'klicenka set/get/list/delete work end-to-end',
      'Vault file is encrypted (no plaintext visible)',
      'Master password required for all operations',
      'CI green on Linux and macOS',
    ],
  };
}

// ─── Minimal valid milestone (baseline) ──────────────────────────────────────

function makeValidMilestone() {
  return {
    id: 'ms-1',
    title: 'Core Vault Engine',
    description: 'Implement encrypted storage with AES-256-GCM + Argon2id KDF',
    dependencies: [],
    estimated_loc: 600,
    estimated_files: 4,
    estimated_complexity: 'HIGH',
    goals_addressed: ['G1'],
    requirements_addressed: ['R1', 'R4'],
    risk: {
      description: 'Argon2 binding compatibility',
      mitigation: 'Fallback to scrypt',
      fallback: 'Use PBKDF2 as last resort',
    },
    test_strategy: {
      type: 'unit',
      description: 'Test encrypt/decrypt round-trip, KDF params, error cases',
      specific_tests: [
        'encrypt → decrypt returns original plaintext',
        'wrong password → throws AuthenticationError',
        'corrupted ciphertext → throws IntegrityError',
      ],
      expected_test_count: 8,
    },
    acceptance_criteria: [
      'encrypt(key, value, password) → ciphertext (not plaintext)',
      'decrypt(ciphertext, password) → original value',
      'wrong password → clear error, no data leak',
    ],
    deliverables: ['src/vault/engine.js', 'src/vault/kdf.js', 'tests/vault.test.js'],
  };
}

// ─── Minimal valid change impact (baseline) ──────────────────────────────────

function makeValidChangeImpact() {
  return {
    affected_milestones: ['ms-3'],
    impact: {
      milestones_to_add: [{ title: 'Key Rotation', estimated_loc: 400 }],
      milestones_to_remove: [],
      milestones_to_modify: [{ id: 'ms-3', changes: 'Add re-encryption support' }],
      effort_delta: '+1 milestone, ~400 LOC',
      risk_level: 'MEDIUM',
    },
    feasibility: 'FEASIBLE',
    recommendation: 'Approve — key rotation is important for security hygiene',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Test 7: Quality Gate Enforcement — "Can the engine say NO?"');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ─── BASELINE: valid spec passes ────────────────────────────────────────
  console.log('\n═══ BASELINE ═══════════════════════════════════════════════════════');

  const validSpec = makeValidSpec();
  const baseline = validateSpec(validSpec);
  check(baseline.valid === true, 'BL.1: valid spec passes validation',
    baseline.valid ? '' : `errors: ${baseline.errors.join('; ')}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG1: Spec WITHOUT design_decisions should be REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG1: SPEC — design_decisions REQUIRED ══════════════════════════');

  const specNoDD = makeValidSpec();
  delete specNoDD.design_decisions;
  const qg1 = validateSpec(specNoDD);
  check(qg1.valid === false,
    'QG1.1: spec without design_decisions is INVALID',
    `got valid=${qg1.valid}`);
  check(qg1.errors?.some(e => /design.decision/i.test(e)),
    'QG1.2: error message mentions design_decisions',
    `errors: ${qg1.errors?.join('; ') || 'none'}`);

  // Empty array = still invalid (must have at least 1)
  const specEmptyDD = makeValidSpec();
  specEmptyDD.design_decisions = [];
  const qg1b = validateSpec(specEmptyDD);
  check(qg1b.valid === false,
    'QG1.3: spec with empty design_decisions[] is INVALID',
    `got valid=${qg1b.valid}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG2: Spec goals WITHOUT success_criteria should be REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG2: SPEC — goals.success_criteria REQUIRED ═══════════════════');

  const specNoSC = makeValidSpec();
  specNoSC.goals = specNoSC.goals.map(g => {
    const { success_criteria, ...rest } = g;
    return rest;
  });
  const qg2 = validateSpec(specNoSC);
  check(qg2.valid === false,
    'QG2.1: spec with goals missing success_criteria is INVALID',
    `got valid=${qg2.valid}`);
  check(qg2.errors?.some(e => /success.criteria/i.test(e)),
    'QG2.2: error message mentions success_criteria',
    `errors: ${qg2.errors?.join('; ') || 'none'}`);

  // One goal without, others with = still invalid
  const specPartialSC = makeValidSpec();
  delete specPartialSC.goals[1].success_criteria;
  const qg2b = validateSpec(specPartialSC);
  check(qg2b.valid === false,
    'QG2.3: spec with one goal missing success_criteria is INVALID',
    `got valid=${qg2b.valid}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG3: Spec requirements WITHOUT acceptance_test should be REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG3: SPEC — requirements.acceptance_test REQUIRED ══════════════');

  const specNoAT = makeValidSpec();
  specNoAT.requirements.functional = specNoAT.requirements.functional.map(r => {
    const { acceptance_test, ...rest } = r;
    return rest;
  });
  const qg3 = validateSpec(specNoAT);
  check(qg3.valid === false,
    'QG3.1: spec with requirements missing acceptance_test is INVALID',
    `got valid=${qg3.valid}`);
  check(qg3.errors?.some(e => /acceptance.test/i.test(e)),
    'QG3.2: error message mentions acceptance_test',
    `errors: ${qg3.errors?.join('; ') || 'none'}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG4: Roadmap milestones WITHOUT acceptance_criteria — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG4: ROADMAP — milestone.acceptance_criteria REQUIRED ══════════');

  // Try to import validateRoadmap — it should exist
  let validateRoadmap;
  try {
    const planning = await import('../src/planner/lifecycle-planning.js');
    validateRoadmap = planning.validateRoadmap;
  } catch { /* ignore */ }

  if (typeof validateRoadmap === 'function') {
    const roadmapNoAC = {
      milestones: [
        { ...makeValidMilestone(), acceptance_criteria: undefined },
        { ...makeValidMilestone(), id: 'ms-2', title: 'CLI Interface', dependencies: ['ms-1'] },
      ],
    };
    const qg4 = validateRoadmap(roadmapNoAC);
    check(qg4.valid === false,
      'QG4.1: milestone without acceptance_criteria is INVALID',
      `got valid=${qg4?.valid}`);
    check(qg4.errors?.some(e => /acceptance.criteria/i.test(e)),
      'QG4.2: error mentions acceptance_criteria',
      `errors: ${qg4?.errors?.join('; ') || 'none'}`);
  } else {
    check(false,
      'QG4.1: validateRoadmap() function EXISTS in lifecycle-planning.js',
      'function not found — no roadmap quality validation exists');
    check(false,
      'QG4.2: validateRoadmap() checks acceptance_criteria',
      'function not found');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QG5: Roadmap milestones WITHOUT test_strategy — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG5: ROADMAP — milestone.test_strategy REQUIRED ════════════════');

  if (typeof validateRoadmap === 'function') {
    const roadmapNoTS = {
      milestones: [
        { ...makeValidMilestone(), test_strategy: undefined },
      ],
    };
    const qg5 = validateRoadmap(roadmapNoTS);
    check(qg5.valid === false,
      'QG5.1: milestone without test_strategy is INVALID',
      `got valid=${qg5?.valid}`);
    check(qg5.errors?.some(e => /test.strategy/i.test(e)),
      'QG5.2: error mentions test_strategy',
      `errors: ${qg5?.errors?.join('; ') || 'none'}`);
  } else {
    check(false,
      'QG5.1: validateRoadmap() checks test_strategy per milestone',
      'validateRoadmap function not found');
    check(false,
      'QG5.2: error mentions test_strategy',
      'validateRoadmap function not found');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QG6: Change impact WITHOUT required fields — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG6: CHANGE — impact analysis quality REQUIRED ═════════════════');

  let validateChangeImpact;
  try {
    const change = await import('../src/planner/lifecycle-change.js');
    validateChangeImpact = change.validateChangeImpact;
  } catch { /* ignore */ }

  if (typeof validateChangeImpact === 'function') {
    // Impact with no affected_milestones
    const emptyImpact = {
      affected_milestones: [],
      impact: {},
      feasibility: undefined,
    };
    const qg6 = validateChangeImpact(emptyImpact);
    check(qg6.valid === false,
      'QG6.1: change impact with no affected_milestones is INVALID',
      `got valid=${qg6?.valid}`);

    // Impact with no risk_level
    const noRisk = makeValidChangeImpact();
    delete noRisk.impact.risk_level;
    const qg6b = validateChangeImpact(noRisk);
    check(qg6b.valid === false,
      'QG6.2: change impact without risk_level is INVALID',
      `got valid=${qg6b?.valid}`);

    // Impact with no feasibility
    const noFeasibility = makeValidChangeImpact();
    delete noFeasibility.feasibility;
    const qg6c = validateChangeImpact(noFeasibility);
    check(qg6c.valid === false,
      'QG6.3: change impact without feasibility is INVALID',
      `got valid=${qg6c?.valid}`);
  } else {
    check(false,
      'QG6.1: validateChangeImpact() function EXISTS in lifecycle-change.js',
      'function not found — no change impact quality validation exists');
    check(false,
      'QG6.2: validateChangeImpact() checks risk_level',
      'function not found');
    check(false,
      'QG6.3: validateChangeImpact() checks feasibility',
      'function not found');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QG7: Design decisions WITHOUT alternatives_considered — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG7: SPEC — design_decisions.alternatives REQUIRED ═════════════');

  const specDDnoAlt = makeValidSpec();
  specDDnoAlt.design_decisions = [
    {
      id: 'DD1',
      decision: 'Use AES-256-GCM',
      chosen: 'AES-256-GCM',
      // NO alternatives_considered!
      rationale: 'Because it is good',
    },
  ];
  const qg7 = validateSpec(specDDnoAlt);
  check(qg7.valid === false,
    'QG7.1: design_decision without alternatives_considered is INVALID',
    `got valid=${qg7.valid}`);
  check(qg7.errors?.some(e => /alternative/i.test(e)),
    'QG7.2: error mentions alternatives',
    `errors: ${qg7.errors?.join('; ') || 'none'}`);

  // Only 1 alternative = not a real choice
  const specDDoneAlt = makeValidSpec();
  specDDoneAlt.design_decisions = [
    {
      id: 'DD1',
      decision: 'Use AES-256-GCM',
      chosen: 'AES-256-GCM',
      alternatives_considered: ['AES-256-GCM'], // only the chosen one = no real alternative
      rationale: 'Because it is good',
    },
  ];
  const qg7b = validateSpec(specDDoneAlt);
  check(qg7b.valid === false,
    'QG7.3: design_decision with only chosen option as alternative is INVALID',
    `got valid=${qg7b.valid}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG8: Roadmap WITHOUT requirements_coverage — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG8: ROADMAP — requirements_coverage REQUIRED ══════════════════');

  if (typeof validateRoadmap === 'function') {
    const roadmapNoCoverage = {
      milestones: [makeValidMilestone()],
      // NO requirements_coverage field
    };
    const qg8 = validateRoadmap(roadmapNoCoverage);
    check(qg8.valid === false,
      'QG8.1: roadmap without requirements_coverage is INVALID',
      `got valid=${qg8?.valid}`);

    // requirements_coverage with uncovered items = warning, not rejection
    const roadmapUncovered = {
      milestones: [makeValidMilestone()],
      requirements_coverage: {
        covered: ['R1', 'R4'],
        uncovered: ['R2', 'R3', 'R5'],
        rationale_for_uncovered: '',  // empty rationale = invalid
      },
    };
    const qg8b = validateRoadmap(roadmapUncovered);
    check(qg8b.valid === false,
      'QG8.2: roadmap with uncovered requirements and no rationale is INVALID',
      `got valid=${qg8b?.valid}`);
  } else {
    check(false,
      'QG8.1: validateRoadmap() checks requirements_coverage',
      'validateRoadmap function not found');
    check(false,
      'QG8.2: validateRoadmap() rejects uncovered requirements without rationale',
      'validateRoadmap function not found');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QG9: Spec acceptance_criteria REQUIRED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG9: SPEC — acceptance_criteria REQUIRED ═══════════════════════');

  const specNoAC = makeValidSpec();
  delete specNoAC.acceptance_criteria;
  const qg9 = validateSpec(specNoAC);
  check(qg9.valid === false,
    'QG9.1: spec without acceptance_criteria is INVALID',
    `got valid=${qg9.valid}`);

  const specEmptyAC = makeValidSpec();
  specEmptyAC.acceptance_criteria = [];
  const qg9b = validateSpec(specEmptyAC);
  check(qg9b.valid === false,
    'QG9.2: spec with empty acceptance_criteria is INVALID',
    `got valid=${qg9b.valid}`);

  // ═══════════════════════════════════════════════════════════════════════
  // QG10: Non-functional requirements WITHOUT metric — REJECTED
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══ QG10: SPEC — NF requirements.metric REQUIRED ═══════════════════');

  const specNFnoMetric = makeValidSpec();
  specNFnoMetric.requirements.non_functional = [
    { id: 'NF1', category: 'security', description: 'Must be secure' },
    { id: 'NF2', category: 'performance', description: 'Must be fast' },
    { id: 'NF3', category: 'portability', description: 'Must be portable' },
  ];
  const qg10 = validateSpec(specNFnoMetric);
  check(qg10.valid === false,
    'QG10.1: NF requirement without metric is INVALID',
    `got valid=${qg10.valid}`);
  check(qg10.errors?.some(e => /metric/i.test(e)),
    'QG10.2: error mentions missing metric',
    `errors: ${qg10.errors?.join('; ') || 'none'}`);

  // ═══ Summary ═══════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Quality Gates: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log(`\n  EXPECTED FAILURES (missing quality gates to implement):`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.detail}`);
    }
  }

  if (failed === 0) {
    console.log('\n  ALL QUALITY GATES ENFORCED — engine can say NO!');
  }

  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
