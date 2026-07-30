// tests/e2e/98-analysis-quality.e2e.js — Analysis & Diverse Task Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests C3's ability to analyze code, debug problems, complete
// projects, and generate tests — with iterative refinement.
//
// Tasks:
//   B1.1: JS Performance analysis     B2.1: JS Race condition debug
//   B1.2: Python Security review       B2.2: Python Memory leak debug
//   B1.3: Go Architecture review       B3.1: Express API completion
//                                       B3.2: Python CLI completion
//                                       B4.1: JS Test generation
//
// Dual-mode:
//   LITE (E2E_LOOP=1): 3 tasks (B1.1, B2.1, B3.1), 1 round
//   FULL (standalone):  All 8 tasks, max 3 rounds each
//
// Expected duration: LITE ~10 min, FULL ~30 min
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

import {
  B1_1_PERF_JS, B1_2_SECURITY_PY, B1_3_ARCH_GO,
  B2_1_RACE_JS, B2_2_MEMLEAK_PY,
  B3_1_EXPRESS_COMPLETION, B3_2_PYTHON_COMPLETION,
  B4_1_TEST_GEN,
} from './_test-fixtures.js';

import {
  scoreAnalysis, scoreDebug, scoreCompletion, scoreTestGeneration,
} from './_quality-evaluator.js';

await waitForServer();

const LITE = !!process.env.E2E_LOOP;
const MAX_ROUNDS = LITE ? 1 : 3;
const TURN_TIMEOUT = LLM_TIMEOUT * 4;  // 240s per LLM turn
const PASS_THRESHOLD = 60;  // % for analysis/debug tasks

const created = [];
const results = {};

// ── Analysis Runner (B1.*) ──────────────────────────────────────────────────

async function runAnalysis(fixture) {
  const convId = await createConv(`analysis-${fixture.id}`);
  created.push(convId);

  let cumulativeResponse = '';
  let bestScore = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let prompt;
    if (round === 0) {
      prompt = `${fixture.prompt}\n\n\`\`\`${fixture.lang}\n${fixture.code}\n\`\`\``;
    } else if (round === 1) {
      // Hint: focus on missed areas
      const missed = bestScore.missed;
      const areaHint = missed.length > 0
        ? `Zaměř se na: ${missed.join(', ')}.`
        : 'Hledej další problémy.';
      prompt = `Pokračuj v analýze. ${areaHint} Nenašel jsi všechny problémy.`;
    } else {
      // Direct hint
      const missed = bestScore.missed;
      prompt = `Podívej se znovu na kód. Zbývající problémy: ${missed.join(', ')}. Co konkrétně je špatně?`;
    }

    const r = await chatInConv(convId, prompt);
    cumulativeResponse += '\n' + r.response;

    const score = scoreAnalysis(cumulativeResponse, fixture.groundTruth);
    bestScore = score;

    if (score.found.length >= fixture.groundTruth.length * 0.6) break;
  }

  return {
    id: fixture.id,
    title: fixture.title,
    score: bestScore.score,
    found: bestScore.found,
    missed: bestScore.missed,
    total: bestScore.total,
    percent: Math.round(100 * bestScore.found.length / bestScore.total),
  };
}

// ── Debug Runner (B2.*) ─────────────────────────────────────────────────────

async function runDebug(fixture) {
  const convId = await createConv(`debug-${fixture.id}`);
  created.push(convId);

  let cumulativeResponse = '';
  let bestScore = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let prompt;
    if (round === 0) {
      prompt = `${fixture.prompt}\n\n\`\`\`${fixture.lang}\n${fixture.code}\n\`\`\``;
    } else {
      const missed = bestScore.missed;
      prompt = `Nepodařilo se najít všechny bugy. Zbývající problémy: ${missed.join(', ')}. Podívej se znovu na kód.`;
    }

    const r = await chatInConv(convId, prompt);
    cumulativeResponse += '\n' + r.response;

    const score = scoreDebug(cumulativeResponse, fixture.groundTruth);
    bestScore = score;

    if (score.found.length >= fixture.groundTruth.length) break;
  }

  return {
    id: fixture.id,
    title: fixture.title,
    score: bestScore.score,
    found: bestScore.found,
    missed: bestScore.missed,
    total: bestScore.total,
    percent: Math.round(100 * bestScore.found.length / bestScore.total),
  };
}

// ── Completion Runner (B3.*) ────────────────────────────────────────────────

async function runCompletion(fixture) {
  const convId = await createConv(`completion-${fixture.id}`);
  created.push(convId);

  let bestScore = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let prompt;
    if (round === 0) {
      prompt = `${fixture.prompt}\n\n\`\`\`${fixture.lang}\n${fixture.existingCode}\n\`\`\``;
    } else {
      const missing = fixture.requiredFeatures
        .filter(f => !f.keywords.some(kw => (bestScore?._response || '').toLowerCase().includes(kw.toLowerCase())))
        .map(f => f.description);
      prompt = `Některé požadavky nebyly splněny. Dokonči:\n${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nVypiš kompletní opravený kód.`;
    }

    const r = await chatInConv(convId, prompt);
    const score = scoreCompletion(r.response, fixture.existingCode, fixture.requiredFeatures);
    score._response = r.response;

    if (!bestScore || score.score > bestScore.score) bestScore = score;
    if (score.completeness >= 80 && score.preservation >= 70) break;
  }

  return {
    id: fixture.id,
    title: fixture.title,
    score: bestScore.score,
    preservation: bestScore.preservation,
    completeness: bestScore.completeness,
    consistency: bestScore.consistency,
  };
}

// ── Test Generation Runner (B4.*) ───────────────────────────────────────────

async function runTestGen(fixture) {
  const convId = await createConv(`testgen-${fixture.id}`);
  created.push(convId);

  const prompt = `${fixture.prompt}\n\n\`\`\`${fixture.lang}\n${fixture.code}\n\`\`\``;
  const r = await chatInConv(convId, prompt);
  const score = scoreTestGeneration(r.response, fixture.functions);

  return {
    id: fixture.id,
    title: fixture.title,
    score: score.score,
    coveredFunctions: score.coveredFunctions,
    totalFunctions: score.details.totalFunctions,
    edgeCases: score.edgeCases,
  };
}

// ── Task Registry ───────────────────────────────────────────────────────────

const ALL_TASKS = [
  { fixture: B1_1_PERF_JS,             runner: runAnalysis,    liteInclude: true },
  { fixture: B1_2_SECURITY_PY,         runner: runAnalysis,    liteInclude: false },
  { fixture: B1_3_ARCH_GO,             runner: runAnalysis,    liteInclude: false },
  { fixture: B2_1_RACE_JS,             runner: runDebug,       liteInclude: true },
  { fixture: B2_2_MEMLEAK_PY,          runner: runDebug,       liteInclude: false },
  { fixture: B3_1_EXPRESS_COMPLETION,   runner: runCompletion,  liteInclude: true },
  { fixture: B3_2_PYTHON_COMPLETION,    runner: runCompletion,  liteInclude: false },
  { fixture: B4_1_TEST_GEN,            runner: runTestGen,     liteInclude: false },
];

const ACTIVE_TASKS = LITE
  ? ALL_TASKS.filter(t => t.liteInclude)
  : ALL_TASKS;

// ── Tests ───────────────────────────────────────────────────────────────────

try {
  // ── B1: Code Analysis ──────────────────────────────────────────────────
  const analysisTasks = ACTIVE_TASKS.filter(t => t.fixture.id.startsWith('B1'));
  if (analysisTasks.length > 0) {
    suite('Analysis Quality — Code Analysis');

    for (const task of analysisTasks) {
      await testAsync(`${task.fixture.id}: ${task.fixture.title}`, async () => {
        const result = await task.runner(task.fixture);
        results[result.id] = result;
        console.log(`    ${result.id} ${result.title}: ${result.found.length}/${result.total} found (${result.percent}%) → score ${result.score}`);
        assert(result.percent >= 50, `${result.id}: found ${result.percent}% < 50% (missed: ${result.missed.join(', ')})`);
      }, TURN_TIMEOUT * MAX_ROUNDS);
    }
  }

  // ── B2: Debugging ─────────────────────────────────────────────────────
  const debugTasks = ACTIVE_TASKS.filter(t => t.fixture.id.startsWith('B2'));
  if (debugTasks.length > 0) {
    suite('Analysis Quality — Debugging');

    for (const task of debugTasks) {
      await testAsync(`${task.fixture.id}: ${task.fixture.title}`, async () => {
        const result = await task.runner(task.fixture);
        results[result.id] = result;
        console.log(`    ${result.id} ${result.title}: ${result.found.length}/${result.total} bugs found (${result.percent}%)`);
        assert(result.found.length >= 1, `${result.id}: found 0 bugs out of ${result.total}`);
      }, TURN_TIMEOUT * MAX_ROUNDS);
    }
  }

  // ── B3: Completion ────────────────────────────────────────────────────
  const completionTasks = ACTIVE_TASKS.filter(t => t.fixture.id.startsWith('B3'));
  if (completionTasks.length > 0) {
    suite('Analysis Quality — Project Completion');

    for (const task of completionTasks) {
      await testAsync(`${task.fixture.id}: ${task.fixture.title}`, async () => {
        const result = await task.runner(task.fixture);
        results[result.id] = result;
        console.log(`    ${result.id} ${result.title}: preserve=${result.preservation}% complete=${result.completeness}% → score ${result.score}`);
        assert(result.score >= 40, `${result.id}: score ${result.score} < 40`);
      }, TURN_TIMEOUT * MAX_ROUNDS);
    }
  }

  // ── B4: Test Generation ───────────────────────────────────────────────
  const testGenTasks = ACTIVE_TASKS.filter(t => t.fixture.id.startsWith('B4'));
  if (testGenTasks.length > 0) {
    suite('Analysis Quality — Test Generation');

    for (const task of testGenTasks) {
      await testAsync(`${task.fixture.id}: ${task.fixture.title}`, async () => {
        const result = await task.runner(task.fixture);
        results[result.id] = result;
        console.log(`    ${result.id} ${result.title}: ${result.coveredFunctions}/${result.totalFunctions} funcs, ${result.edgeCases} edges → score ${result.score}`);
        assert(result.score >= 40, `${result.id}: score ${result.score} < 40`);
      }, TURN_TIMEOUT);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  suite('Analysis Quality — Summary');

  await testAsync('all tasks reach minimum score', async () => {
    for (const [id, r] of Object.entries(results)) {
      const score = r.score ?? r.percent ?? 0;
      assert(score >= 30, `${id} score ${score} < 30`);
    }
  });

  // Print results table
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Analysis Quality — RESULTS');
  console.log('══════════════════════════════════════════════════════════');
  for (const r of Object.values(results)) {
    const icon = (r.score ?? r.percent ?? 0) >= PASS_THRESHOLD ? '✅' : '⚠️';
    if (r.percent !== undefined) {
      console.log(`  ${r.id} ${r.title}: ${r.found?.length ?? '?'}/${r.total ?? '?'} found (${r.percent}%) ${icon}`);
    } else if (r.preservation !== undefined) {
      console.log(`  ${r.id} ${r.title}: preserve=${r.preservation}% complete=${r.completeness}% → ${r.score} ${icon}`);
    } else if (r.coveredFunctions !== undefined) {
      console.log(`  ${r.id} ${r.title}: ${r.coveredFunctions}/${r.totalFunctions} funcs, ${r.edgeCases} edges → ${r.score} ${icon}`);
    } else {
      console.log(`  ${r.id} ${r.title}: score=${r.score} ${icon}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════\n');

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

summary();
