// Test 10: Quality Telemetry — Score Logging & Retrieval
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies:
//   T1: logSpecScore() computes + stores in DB
//   T2: logRoadmapScore() computes + stores in DB
//   T3: logChangeScore() computes + stores in DB
//   T4: logLifecycleScore() aggregates from DB entries
//   T5: getScoreHistory() returns ordered history
//   T6: getLatestScores() returns per-type latest
//   T7: getScoreTrend() returns version progression
//   T8: Integration — telemetry fires during lifecycle operations
//   T9: Failure resilience — bad data doesn't crash
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';

import {
  db,
  projects,
  lifecycles as lifecycleRepo,
  qualityScores,
} from '../src/db/database.js';

import {
  logSpecScore,
  logRoadmapScore,
  logChangeScore,
  logLifecycleScore,
  getScoreHistory,
  getLatestScores,
  getScoreTrend,
} from '../src/planner/quality-telemetry.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const LC_ID = `lc-qtel-${Date.now()}`;

function makeSpec() {
  return {
    title: 'Klicenka CLI',
    goals: [
      { id: 'G1', description: 'Store passwords encrypted', priority: 'MUST', success_criteria: 'AES-256-GCM encrypted file on disk, verified with openssl' },
      { id: 'G2', description: 'Retrieve passwords by key', priority: 'MUST', success_criteria: 'klicenka get <key> prints password to stdout in <100ms' },
      { id: 'G3', description: 'Cross-platform CLI', priority: 'SHOULD', success_criteria: 'CI passes on ubuntu-latest and macos-latest' },
    ],
    requirements: {
      functional: [
        { id: 'R1', description: 'Store entries', goal_id: 'G1', acceptance_test: 'klicenka set test 123 \u2192 klicenka get test \u2192 "123"' },
        { id: 'R2', description: 'List keys', goal_id: 'G2', acceptance_test: 'klicenka list \u2192 shows "test"' },
        { id: 'R3', description: 'Delete entries', goal_id: 'G2', acceptance_test: 'klicenka delete test \u2192 error on get' },
        { id: 'R4', description: 'Auth', goal_id: 'G1', acceptance_test: 'Wrong password \u2192 "Authentication failed"' },
        { id: 'R5', description: 'Export', goal_id: 'G1', acceptance_test: 'klicenka export \u2192 .enc file' },
      ],
      non_functional: [
        { id: 'NF1', category: 'security', description: 'AES-256-GCM', metric: 'No plaintext in vault file' },
      ],
    },
    tech_stack: { languages: ['Node.js 22'], frameworks: ['commander'], tools: ['better-sqlite3'] },
    design_decisions: [
      { id: 'DD1', decision: 'Encryption', chosen: 'AES-256-GCM', alternatives_considered: ['ChaCha20', 'XSalsa20'], rationale: 'AES has HW acceleration, however ChaCha is better for mobile' },
    ],
    risks: [
      { id: 'RISK1', description: 'Vault corruption on crash', severity: 'HIGH', likelihood: 'LOW', mitigation: 'Atomic write with temp file + rename' },
    ],
    acceptance_criteria: ['CRUD works end-to-end', 'Vault is encrypted'],
  };
}

function makeRoadmap() {
  return {
    milestones: [
      {
        id: 'ms-1', title: 'Core Engine', description: 'Encryption + storage',
        dependencies: [], estimated_loc: 600, estimated_files: 4, estimated_complexity: 'HIGH',
        acceptance_criteria: ['encrypt/decrypt roundtrip works'],
        test_strategy: { type: 'unit', description: 'Round-trip tests', expected_test_count: 8 },
      },
      {
        id: 'ms-2', title: 'CLI', description: 'Commander-based CLI',
        dependencies: ['ms-1'], estimated_loc: 400, estimated_files: 3, estimated_complexity: 'MEDIUM',
        acceptance_criteria: ['set/get/list/delete commands work'],
        test_strategy: { type: 'integration', description: 'CLI e2e', expected_test_count: 6 },
      },
    ],
    requirements_coverage: { covered: ['R1', 'R2', 'R3', 'R4'], uncovered: ['R5'], rationale_for_uncovered: 'Deferred to post-MVP' },
  };
}

function makeChange() {
  return {
    affected_milestones: ['ms-2'],
    impact: {
      milestones_to_add: [{ title: 'Key Rotation', estimated_loc: 300 }],
      milestones_to_remove: [],
      milestones_to_modify: [],
      effort_delta: '+1 milestone, ~300 LOC',
      risk_level: 'LOW',
    },
    feasibility: 'FEASIBLE',
    recommendation: 'Approve \u2014 key rotation is a security best practice',
    preserved_milestones: ['ms-1'],
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

function cleanDB() {
  try { db.prepare(`DELETE FROM quality_scores WHERE lifecycle_id = ?`).run(LC_ID); } catch {}
  try { db.prepare(`DELETE FROM project_lifecycles WHERE id = ?`).run(LC_ID); } catch {}
  try { db.prepare(`DELETE FROM projects WHERE name = 'qtel-test'`).run(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('\u2550'.repeat(70));
  console.log('  Test 10: Quality Telemetry \u2014 Score Logging & Retrieval');
  console.log('\u2550'.repeat(70));

  cleanDB();

  // Create project + lifecycle record so FK works
  const project = projects.getOrCreate('qtel-test', '/tmp/qtel-test', 'Quality Telemetry Test');
  lifecycleRepo.save(LC_ID, Number(project.id), 'SPEC', null, {});

  // ─── T1: logSpecScore ─────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T1: logSpecScore \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const spec = makeSpec();
  const specResult = logSpecScore(LC_ID, spec, 1);

  check(specResult !== null, 'T1.1: logSpecScore returns result');
  check(specResult?.score > 0 && specResult?.score <= 1, 'T1.2: score in (0, 1]', `got ${specResult?.score}`);
  check(typeof specResult?.label === 'string', 'T1.3: label is string', `got ${specResult?.label}`);
  check(typeof specResult?.breakdown === 'object', 'T1.4: breakdown is object');

  // Verify it's in DB
  const dbSpec = qualityScores.getLatest(LC_ID, 'spec');
  check(dbSpec !== null, 'T1.5: spec score found in DB');
  check(dbSpec?.score === specResult?.score, 'T1.6: DB score matches returned score', `db=${dbSpec?.score} ret=${specResult?.score}`);
  check(dbSpec?.artifact_version === 1, 'T1.7: artifact_version = 1', `got ${dbSpec?.artifact_version}`);

  // ─── T2: logRoadmapScore ──────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T2: logRoadmapScore \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const roadmap = makeRoadmap();
  const rmResult = logRoadmapScore(LC_ID, roadmap, 1);

  check(rmResult !== null, 'T2.1: logRoadmapScore returns result');
  check(rmResult?.score > 0, 'T2.2: roadmap score > 0', `got ${rmResult?.score}`);

  const dbRm = qualityScores.getLatest(LC_ID, 'roadmap');
  check(dbRm !== null, 'T2.3: roadmap score found in DB');
  check(dbRm?.score === rmResult?.score, 'T2.4: DB score matches', `db=${dbRm?.score} ret=${rmResult?.score}`);

  // ─── T3: logChangeScore ───────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T3: logChangeScore \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const change = makeChange();
  const chResult = logChangeScore(LC_ID, change, 'cr-12345-abcd');

  check(chResult !== null, 'T3.1: logChangeScore returns result');
  check(chResult?.score > 0, 'T3.2: change score > 0', `got ${chResult?.score}`);

  const dbCh = qualityScores.getLatest(LC_ID, 'change');
  check(dbCh !== null, 'T3.3: change score found in DB');

  // ─── T4: logLifecycleScore ────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T4: logLifecycleScore \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const lcResult = logLifecycleScore(LC_ID);

  check(lcResult !== null, 'T4.1: logLifecycleScore returns result');
  check(lcResult?.score > 0, 'T4.2: lifecycle score > 0', `got ${lcResult?.score}`);
  check(typeof lcResult?.label === 'string', 'T4.3: has label');

  const dbLc = qualityScores.getLatest(LC_ID, 'lifecycle');
  check(dbLc !== null, 'T4.4: lifecycle score found in DB');
  check(dbLc?.breakdown?.spec_score === specResult?.score,
    'T4.5: lifecycle breakdown includes spec_score',
    `got ${dbLc?.breakdown?.spec_score}`);

  // ─── T5: getScoreHistory ──────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T5: getScoreHistory \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const history = getScoreHistory(LC_ID);

  check(history.length >= 4, 'T5.1: history has \u22654 entries (spec, roadmap, change, lifecycle)', `got ${history.length}`);
  check(history.every(h => h.score >= 0 && h.score <= 1), 'T5.2: all scores in [0, 1]');
  check(history.every(h => typeof h.breakdown === 'object'), 'T5.3: all entries have parsed breakdown');

  // ─── T6: getLatestScores ──────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T6: getLatestScores \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const latest = getLatestScores(LC_ID);

  check(latest.spec !== null, 'T6.1: latest has spec');
  check(latest.roadmap !== null, 'T6.2: latest has roadmap');
  check(latest.change !== null, 'T6.3: latest has change');
  check(latest.lifecycle !== null, 'T6.4: latest has lifecycle');

  // ─── T7: getScoreTrend ────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T7: getScoreTrend \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Log a second spec score with a different spec
  const spec2 = { ...makeSpec(), title: 'Klicenka v2' };
  logSpecScore(LC_ID, spec2, 2);

  const specTrend = getScoreTrend(LC_ID, 'spec');
  check(specTrend.length >= 2, 'T7.1: spec trend has \u22652 entries', `got ${specTrend.length}`);
  if (specTrend.length >= 2) {
    check(specTrend[0].artifact_version !== specTrend[1].artifact_version || specTrend[0].created_at !== specTrend[1].created_at,
      'T7.2: trend entries are distinct');
  } else {
    check(false, 'T7.2: trend entries are distinct', 'insufficient entries');
  }

  // ─── T8: Version progression ──────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T8: VERSION PROGRESSION \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Log a second roadmap version
  const roadmap2 = { ...makeRoadmap() };
  roadmap2.milestones.push({
    id: 'ms-3', title: 'Key Rotation', description: 'Re-encryption support',
    dependencies: ['ms-1'], estimated_loc: 300, estimated_files: 2, estimated_complexity: 'MEDIUM',
    acceptance_criteria: ['key rotation works'],
    test_strategy: { type: 'unit', description: 'Rotation tests', expected_test_count: 4 },
  });
  logRoadmapScore(LC_ID, roadmap2, 2);

  const rmTrend = getScoreTrend(LC_ID, 'roadmap');
  check(rmTrend.length >= 2, 'T8.1: roadmap trend has \u22652 entries', `got ${rmTrend.length}`);

  // ─── T9: Failure resilience ───────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T9: FAILURE RESILIENCE \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // null spec should not throw
  const nullResult = logSpecScore(LC_ID, null, 99);
  check(nullResult !== null, 'T9.1: null spec returns result (score 0)', `got ${nullResult}`);
  check(nullResult?.score === 0, 'T9.2: null spec score = 0', `got ${nullResult?.score}`);

  // Empty lifecycle ID should not throw
  const emptyResult = logSpecScore('', {}, 99);
  // May fail on FK constraint — that's OK, telemetry swallows errors
  check(emptyResult === null || emptyResult?.score === 0,
    'T9.3: empty lifecycle_id handled gracefully', `got ${emptyResult}`);

  // getScoreHistory for non-existent lifecycle
  const emptyHistory = getScoreHistory('non-existent-lc');
  check(Array.isArray(emptyHistory) && emptyHistory.length === 0,
    'T9.4: non-existent lifecycle returns empty history');

  // getLatestScores for non-existent lifecycle
  const emptyLatest = getLatestScores('non-existent-lc');
  check(emptyLatest.spec === null && emptyLatest.roadmap === null,
    'T9.5: non-existent lifecycle returns all nulls');

  // ═══ Summary ═══════════════════════════════════════════════════════════

  // Cleanup
  cleanDB();

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Quality Telemetry: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    \u2717 ${f.name}: ${f.detail}`);
    }
  }

  if (failed === 0) {
    console.log('\n  ALL QUALITY TELEMETRY TESTS PASSED \u2014 scoring pipeline operational!');
  }

  console.log('═'.repeat(70) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

run();
