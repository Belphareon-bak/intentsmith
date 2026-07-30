// tests/e2e/97-project-build-quality.e2e.js — Iterative Project Build Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests C3's ability to plan, build, align, and test complete projects
// through iterative feedback cycles.
//
// Projects:
//   A1: TaskFlow (JS/Node — Express + SQLite + JWT)
//   A2: RecipeBook (Python — Flask + SQLite + Jinja2)
//   A3: LinkShortener (Go — net/http + SQLite)
//
// Dual-mode:
//   LITE (E2E_LOOP=1): Only A1, 1 iteration, <20 min
//   FULL (standalone):  All 3 projects, max 3 iterations each
//
// Expected duration: LITE ~15 min, FULL ~45 min
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

import { PROJECTS } from './_test-fixtures.js';
import {
  extractCodeBlocks, scorePlan, scoreCode, scoreAlignment,
  scoreTests, generateFeedback,
} from './_quality-evaluator.js';

await waitForServer();

const LITE = !!process.env.E2E_LOOP;
const MAX_ITERATIONS = LITE ? 1 : 3;
const ACTIVE_PROJECTS = LITE ? [PROJECTS[0]] : PROJECTS;
const TURN_TIMEOUT = LLM_TIMEOUT * 5;  // 300s per LLM turn

const created = [];
const results = {};

// ── Phase Runner ────────────────────────────────────────────────────────────

async function runProject(project) {
  const convId = await createConv(`build-quality-${project.id}`);
  created.push(convId);

  let planText = '';
  let codeBlocks = [];
  let testBlocks = [];
  let scores = { plan: 0, code: 0, align: 0, test: 0, composite: 0 };
  let iterations = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iterations = iter + 1;

    // ── Phase 1: Planning ──────────────────────────────────────────────
    if (scores.plan < 60 || iter === 0) {
      const planPrompt = iter === 0
        ? `Navrhni plán implementace pro tento projekt. Vypiš strukturovaný seznam kroků a souborů.\n\n${project.spec}`
        : generateFeedback('plan', { ...scores, _planText: planText }, codeBlocks, project.requirements);

      const r = await chatInConv(convId, planPrompt);
      planText = r.response;
      scores.plan = scorePlan(planText, project.requirements);
    }

    // ── Phase 2: Code Generation ───────────────────────────────────────
    if (scores.code < 50 || iter === 0) {
      const codePrompt = iter === 0
        ? `Na základě plánu nyní vypiš kompletní kód. Každý soubor v samostatném code bloku s názvem souboru. Žádné TODO, žádné placeholder, žádné zkratky.\n\n${project.spec}`
        : generateFeedback('code', scores, codeBlocks, project.requirements);

      const r = await chatInConv(convId, codePrompt);
      codeBlocks = extractCodeBlocks(r.response);
      scores.code = scoreCode(codeBlocks, project.lang, project.requirements);
    }

    // ── Phase 3: Alignment ─────────────────────────────────────────────
    scores.align = scoreAlignment(codeBlocks, planText, project.requirements);
    if (scores.align < 60 && iter < MAX_ITERATIONS - 1) {
      const alignPrompt = generateFeedback('alignment', scores, codeBlocks, project.requirements);
      const r = await chatInConv(convId, alignPrompt);
      // Re-extract code from the fix response
      const fixBlocks = extractCodeBlocks(r.response);
      if (fixBlocks.length > 0) codeBlocks = fixBlocks;
      scores.align = scoreAlignment(codeBlocks, planText, project.requirements);
      scores.code = scoreCode(codeBlocks, project.lang, project.requirements);
    }

    // ── Phase 4: Testing ───────────────────────────────────────────────
    if (scores.test < 50 || iter === 0) {
      const testPrompt = iter === 0
        ? 'Napiš kompletní testy pro vygenerovaný kód. Pokryj hlavní funkce i edge cases. Každý testovací soubor v code bloku.'
        : generateFeedback('test', scores, codeBlocks, project.requirements);

      const r = await chatInConv(convId, testPrompt);
      testBlocks = extractCodeBlocks(r.response);
      scores.test = scoreTests(testBlocks, codeBlocks);
    }

    // ── Composite Score ────────────────────────────────────────────────
    scores.composite = Math.round(
      scores.plan * 0.2 + scores.code * 0.3 + scores.align * 0.3 + scores.test * 0.2
    );

    if (scores.composite >= 70) break;

    // Find weakest phase for next iteration
    // (loop will re-run weak phases)
  }

  return { project: project.id, name: project.name, lang: project.lang, scores, iterations };
}

// ── Tests ───────────────────────────────────────────────────────────────────

try {
  for (const project of ACTIVE_PROJECTS) {
    suite(`Project Build Quality — ${project.id} ${project.name} (${project.lang})`);

    await testAsync(`${project.id}: iterative build cycle`, async () => {
      const result = await runProject(project);
      results[project.id] = result;

      // Log detail
      const s = result.scores;
      console.log(`    ${result.project} ${result.name} (${result.lang}): plan=${s.plan} code=${s.code} align=${s.align} test=${s.test} → ${s.composite} (${result.iterations} iter)`);

      assert(s.composite >= 50, `${result.project} composite score ${s.composite} < 50 (plan=${s.plan} code=${s.code} align=${s.align} test=${s.test})`);
    }, TURN_TIMEOUT * 6); // 4 phases × ~300s + retries

    await testAsync(`${project.id}: plan quality ≥40`, async () => {
      const r = results[project.id];
      assert(r, `${project.id} result missing`);
      assert(r.scores.plan >= 40, `plan score ${r.scores.plan} < 40`);
    });

    await testAsync(`${project.id}: code quality ≥40`, async () => {
      const r = results[project.id];
      assert(r, `${project.id} result missing`);
      assert(r.scores.code >= 40, `code score ${r.scores.code} < 40`);
    });

    await testAsync(`${project.id}: alignment quality ≥40`, async () => {
      const r = results[project.id];
      assert(r, `${project.id} result missing`);
      assert(r.scores.align >= 40, `alignment score ${r.scores.align} < 40`);
    });

    await testAsync(`${project.id}: test quality ≥30`, async () => {
      const r = results[project.id];
      assert(r, `${project.id} result missing`);
      assert(r.scores.test >= 30, `test score ${r.scores.test} < 30`);
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  suite('Project Build Quality — Summary');

  await testAsync('all projects reach composite ≥50', async () => {
    for (const id of Object.keys(results)) {
      assert(results[id].scores.composite >= 50, `${id} composite ${results[id].scores.composite} < 50`);
    }
  });

  // Print results table
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Project Build Quality — RESULTS');
  console.log('══════════════════════════════════════════════════════════');
  for (const r of Object.values(results)) {
    const s = r.scores;
    const icon = s.composite >= 70 ? '✅' : s.composite >= 50 ? '⚠️' : '❌';
    console.log(`  ${r.project} ${r.name} (${r.lang}): plan=${s.plan} code=${s.code} align=${s.align} test=${s.test} → ${s.composite} ${icon} (${r.iterations} iter)`);
  }
  console.log('══════════════════════════════════════════════════════════\n');

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

summary();
