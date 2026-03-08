// Lifecycle E2E Test — Klíčenka (Credential Vault) — Real LLM (v91)
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario with REAL Ollama LLM calls. Full lifecycle WITH:
//   - Spec revision (key rotation requirement)
//   - Roadmap revision (milestone split)
//   - Milestone rejection (prepared statements feedback)
//   - Change management (add CLI)
//   - Quality assertions (spec, roadmap, documentation)
//
// Flow:
//   PROPOSED → SPEC → SPEC_REVIEW (revise → approve)
//   → PLAN_REVIEW (revise → approve) → BUILD (reject → approve → ms-1)
//   → CHANGE (add CLI) → BUILD (ms-2, ms-3, ...) → COMPLETED
//   → Quality verification (spec, roadmap, docs, files, git)
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Models: deepseek-r1:32b, qwen3.5:27b, qwen3.5:27b
//   - Expected duration: 20-40 minutes
//
// Run: node tests/lifecycle-klicenka-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  getBuildProgress,
  computeLifecycleProgress,
  formatMilestoneTable,
} from '../src/planner/index.js';

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  changeRequests as crRepo,
  driftChecks,
  projects,
  conversations,
  messages as messagesRepo,
  lifecycleHandoffState,
  db,
} from '../src/db/database.js';

import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
} from '../src/chat/handlers/lifecycle-handoff.js';

import { getLcState, setLcState, clearLcState, initLifecycleStateDb } from '../src/chat/handlers/lifecycle-state.js';
import { callLLM } from '../src/planner/workflow.js';

// ─── Test Infra ─────────────────────────────────────────────────────────────

const transcript = [];
let turnNum = 0;
let passed = 0;
let failed = 0;
const failures = [];
const startTime = Date.now();
let _convId = null; // set during test setup

function elapsed() {
  return `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
}

function userTurn(message) {
  turnNum++;
  transcript.push({ turn: turnNum, role: 'USER', content: message, time: elapsed() });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ USER │ ${elapsed()}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(message);
  if (_convId) try { messagesRepo.addMessage(_convId, 'user', message); } catch {}
  return message;
}

function systemTurn(phase, response) {
  turnNum++;
  const content = typeof response === 'string' ? response : (response?.content || JSON.stringify(response));
  transcript.push({ turn: turnNum, role: 'SYSTEM', phase, content, time: elapsed() });
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` TURN ${turnNum} │ SYSTEM │ Phase: ${phase} │ ${elapsed()}`);
  console.log(`${'─'.repeat(70)}`);
  const maxLen = 800;
  console.log(content?.substring(0, maxLen) + (content?.length > maxLen ? '\n  ...(truncated)' : ''));
  if (_convId) try { messagesRepo.addMessage(_convId, 'assistant', content); } catch {}
}

function check(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`    ✅ ${name}`);
  } else {
    failed++;
    console.log(`    ❌ ${name}: ${detail}`);
    failures.push({ name, detail });
  }
}

// ─── Ollama Health Check ────────────────────────────────────────────────────

async function checkOllama() {
  console.log('\n  ─── Ollama Health Check ───');
  try {
    const resp = await fetch('http://127.0.0.1:11434/api/tags');
    const data = await resp.json();
    const models = data.models?.map(m => m.name) || [];
    const required = ['deepseek-r1', 'qwen3.5'];
    let ok = true;
    for (const req of required) {
      const found = models.some(m => m.includes(req));
      if (!found) { ok = false; console.log(`    Missing model: ${req}`); }
    }
    console.log(`    Models: ${models.length} available`);
    return ok;
  } catch (e) {
    console.error(`    Ollama not available: ${e.message}`);
    return false;
  }
}

// ─── Real LLM Executor ─────────────────────────────────────────────────────

function createRealLLMExecutor(projectPath) {
  return {
    async start(request, metadata) {
      const msId = metadata.milestoneId;
      console.log(`\n    [EXECUTOR] ─── ${msId}: Real LLM Code Generation ───`);

      const milestone = msRepo.getMilestone(msId);
      let localPlan = milestone?.local_plan;
      if (typeof localPlan === 'string') {
        try { localPlan = JSON.parse(localPlan); } catch { localPlan = {}; }
      }
      if (!localPlan) localPlan = {};

      let files = localPlan.files || [];
      if (files.length === 0) {
        const fileMatches = [...request.matchAll(/- ([^\s(]+)\s*\((\w+)\):\s*(.+)/g)];
        for (const m of fileMatches) {
          files.push({ path: m[1], action: m[2], purpose: m[3] });
        }
      }

      for (const file of files) {
        const codePrompt = `You are implementing a file for a Node.js credential vault (c3-keychain).
The vault uses AES-256-GCM encryption, scrypt key derivation, better-sqlite3, and Express.

File: ${file.path}
Purpose: ${file.purpose || 'As described'}

Context:
${request}

Generate the COMPLETE file content. Output ONLY raw source code, NO markdown fences, NO explanation.`;

        console.log(`    [EXECUTOR]   Generating ${file.path}...`);
        const t0 = Date.now();
        try {
          const result = await callLLM('CODE', codePrompt);
          let content = result.content || '';
          content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '').trim();

          const fullPath = path.join(projectPath, file.path);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);

          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`    [EXECUTOR]   ✓ ${file.path} (${content.length} bytes, ${dt}s)`);
        } catch (err) {
          console.log(`    [EXECUTOR]   ✗ ${file.path}: ${err.message}`);
        }
      }

      try {
        execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
        execSync(`git commit -m "feat(${msId}): milestone implementation" --allow-empty`, {
          cwd: projectPath, stdio: 'pipe',
        });
      } catch { /* ignore */ }

      console.log(`    [EXECUTOR] ─── ${msId} complete ───\n`);
      return { state: 'COMPLETED', sessionId: `real-wf-${msId}` };
    },

    async approve(sessionId) {
      return { state: 'COMPLETED', sessionId };
    },
  };
}

// ─── DB Cleanup ─────────────────────────────────────────────────────────────

function cleanDB(projectPath) {
  // Only clean lifecycle data for THIS project's path — don't wipe everything
  try {
    const proj = db.prepare(`SELECT id FROM projects WHERE path = ?`).get(projectPath);
    if (proj) {
      const lcIds = db.prepare(`SELECT id FROM project_lifecycles WHERE project_id = ?`).all(proj.id).map(r => r.id);
      for (const lcId of lcIds) {
        for (const t of ['milestones', 'roadmap_versions', 'drift_checks', 'change_requests']) {
          try { db.prepare(`DELETE FROM ${t} WHERE lifecycle_id = ?`).run(lcId); } catch {}
        }
      }
      try { db.prepare(`DELETE FROM project_lifecycles WHERE project_id = ?`).run(proj.id); } catch {}
      try { db.prepare(`DELETE FROM lifecycle_handoff_state WHERE lifecycle_id IN (${lcIds.map(() => '?').join(',')})`)
        .run(...lcIds); } catch {}
    }
  } catch { /* first run — no data */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

function walkFiles(dir, base = dir) {
  const result = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) result.push(...walkFiles(fp, base));
      else result.push(path.relative(base, fp));
    }
  } catch { /* ignore */ }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Lifecycle E2E: Klíčenka (c3-keychain — Credential Vault)');
  console.log('  Mode: REAL LLM (Ollama) + Change Management');
  console.log('══════════════════════════════════════════════════════════════════════');

  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log('\n  Ollama not available — skipping test');
    process.exit(0);
  }

  const SESSION_ID = 'klicenka-e2e-real';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/Klicenka-E2E');
  fs.mkdirSync(projectPath, { recursive: true });

  cleanDB(projectPath);

  // Init git if not already a repo
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    execSync('git init', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  }

  // Register project + conversation in DB → visible in IDE
  const PROJECT_NAME = 'Klíčenka E2E';
  const PROJECT_DESC = 'Credential vault — E2E lifecycle test with change management (real LLM)';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  _convId = `e2e-klicenka-${Date.now()}`;
  conversations.getOrCreate(_convId, projectId, 'Klíčenka — Full Lifecycle + Change Management (Real LLM)');

  const executor = createRealLLMExecutor(projectPath);
  const context = { sessionId: SESSION_ID, executor, projectPath };

  let lifecycleId = null;
  let changeTriggered = false;

  try {
    // ═══ PHASE 1: Proposal ════════════════════════════════════════════════════

    console.log('\n\n═══ PHASE 1: Detection + Proposal ═══════════════════════════════════');

    const userMsg1 = userTurn(
      'Potřebuju vytvořit kompletní klíčenku pro C3 — bezpečné úložiště credentials ' +
      'a citlivých údajů. C3 agent bude ukládat API klíče, Ollama tokeny, SMTP hesla. ' +
      'Šifrování AES-256-GCM, master password s scrypt, REST API s bearer auth, ' +
      'SQLite (better-sqlite3) pro storage. Node.js + Express.'
    );

    const response1 = handleLifecycleBuildDetected(userMsg1, { intent: 'BUILD' }, context);
    systemTurn('PROPOSED', response1);

    check(response1?.content?.includes('lifecycle'), 'T1: response mentions lifecycle');
    const state1 = getLcState(SESSION_ID);
    check(state1?.phase === 'PROPOSED', 'T1: state is PROPOSED');

    // ═══ PHASE 2: SPEC ═══════════════════════════════════════════════════════

    console.log('\n\n═══ PHASE 2: SPEC — Real LLM Questions ══════════════════════════════');

    const userMsg2 = userTurn('ano');
    const response2 = await handleLifecycleInput(userMsg2, context);
    systemTurn('SPEC', response2);

    const state2 = getLcState(SESSION_ID);
    check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // Answer spec questions — adaptive loop
    const specAnswers = [
      'AES-256-GCM šifrování (authenticated encryption). REST server — C3 volá přes HTTP. ' +
      'Namespace oddělení: ollama, smtp, telegram, custom. ' +
      'Bearer token autentizace (KEYCHAIN_TOKEN env var). ' +
      'Master password přes scrypt (memory-hard, resistant to ASIC). ' +
      'SQLite single-file DB, WAL mode. Node.js crypto built-in, žádné externí crypto libs. ' +
      'Design decisions: Encryption: AES-256-GCM (chosen), alternatives: ChaCha20-Poly1305, AES-256-CBC. ' +
      'Hashing: scrypt (chosen), alternatives: bcrypt, argon2id. ' +
      'Database: SQLite/better-sqlite3 (chosen), alternatives: PostgreSQL, LevelDB.',

      'Vault class: get(ns, key), set(ns, key, value), list(ns?), delete(ns, key). ' +
      'Express endpoints: GET/POST/DELETE /api/credentials. ' +
      'Auth middleware: Bearer token z headeru, 401 bez tokenu, 403 neplatný. ' +
      'Klíč derivován on-demand, salt uložen v vault_meta tabulce. ' +
      'Architecture: layered (chosen), alternatives: microservices, plugin-based.',

      'Ano, vygeneruj specifikaci s těmito parametry. Pro každý design decision uveď alternativy.',
    ];

    let specRound = 0;
    while (getLcState(SESSION_ID)?.phase === 'SPEC' && specRound < 5) {
      const answer = specAnswers[Math.min(specRound, specAnswers.length - 1)];
      const msgSpec = userTurn(answer);
      const respSpec = await handleLifecycleInput(msgSpec, context);
      systemTurn(`SPEC round ${specRound + 1}`, respSpec);
      specRound++;
    }

    check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ═══ PHASE 3: Spec Revision + Quality + Approve ══════════════════════════

    console.log('\n\n═══ PHASE 3: Spec Revision + Quality Assertions + Approve ══════════');

    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      // 3a. Quality assertions on initial spec
      const specBeforeRevision = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
      if (specBeforeRevision) {
        check(
          (specBeforeRevision.goals || []).length >= 2,
          'T3-Q: spec has ≥2 goals',
          `got: ${(specBeforeRevision.goals || []).length}`
        );
        const frs = specBeforeRevision.requirements?.functional || [];
        check(frs.length >= 3, 'T3-Q: spec has ≥3 functional requirements', `got: ${frs.length}`);
        const frIds = frs.map(fr => fr.id).filter(Boolean);
        check(frIds.length === frs.length, 'T3-Q: every FR has an id', `${frIds.length}/${frs.length}`);
        check(new Set(frIds).size === frIds.length, 'T3-Q: FR IDs are unique');
        const dds = specBeforeRevision.design_decisions || [];
        check(dds.length >= 1, 'T3-Q: spec has ≥1 design decision', `got: ${dds.length}`);
        if (dds.length > 0) {
          const hasAlts = dds.some(d => (d.alternatives_considered || d.alternatives || []).length >= 1);
          check(hasAlts, 'T3-Q: at least one design decision has alternatives');
        }
      }

      // 3b. Send revision feedback — request key rotation requirement
      const revisionMsg = userTurn(
        'Chybí mi podpora pro rotaci klíčů. Přidej požadavek na automatickou rotaci API klíčů každých 90 dní.'
      );
      const revisionResp = await handleLifecycleInput(revisionMsg, context);
      systemTurn('SPEC revision', revisionResp);

      const afterRevisionPhase = getLcState(SESSION_ID)?.phase;
      check(
        afterRevisionPhase === 'SPEC' || afterRevisionPhase === 'SPEC_REVIEW',
        'T3-R: revision triggers SPEC or SPEC_REVIEW',
        `got: ${afterRevisionPhase}`
      );

      // 3c. Answer revision questions until back at SPEC_REVIEW
      let revisionRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revisionRound < 4) {
        const answer = userTurn(
          'Ano, automatická rotace klíčů každých 90 dní. Starý klíč zůstane platný 24h po rotaci. ' +
          'Notifikace přes callback URL při rotaci. Rotace jen pro namespace "api-keys".'
        );
        const resp = await handleLifecycleInput(answer, context);
        systemTurn(`SPEC revision round ${revisionRound + 1}`, resp);
        revisionRound++;
      }

      // 3d. Verify spec contains rotation requirement
      const specAfterRevision = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
      if (specAfterRevision) {
        const specStr = JSON.stringify(specAfterRevision).toLowerCase();
        check(
          specStr.includes('rotac') || specStr.includes('rotation') || specStr.includes('rotate'),
          'T3-R: revised spec mentions key rotation'
        );
      }

      // 3e. Approve revised spec
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const approveMsg = userTurn('schvaluji');
        const approveResp = await handleLifecycleInput(approveMsg, context);
        systemTurn('SPEC → PLAN_REVIEW', approveResp);
      }
    }

    // ═══ PHASE 4: Plan Review — Roadmap Revision + Quality ══════════════════

    console.log('\n\n═══ PHASE 4: PLAN_REVIEW — Roadmap Revision + Quality ══════════════');

    const stateRoadmap = getLcState(SESSION_ID);
    check(stateRoadmap?.phase === 'PLAN_REVIEW', 'T4: reached PLAN_REVIEW', `got: ${stateRoadmap?.phase}`);
    lifecycleId = stateRoadmap?.lifecycleId || lifecycleId;

    let milestonesBeforeRevision = 0;

    if (lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      milestonesBeforeRevision = milestones.length;
      check(milestones.length >= 3, 'T4-Q: roadmap has ≥3 milestones (v91 minimum)', `got: ${milestones.length}`);
      console.log(`    Milestones (initial):`);
      for (const m of milestones) {
        console.log(`      ${m.id}: ${m.title}`);
      }

      // 4a. Quality: check roadmap data
      const roadmapRow = roadmapVersions.getLatestRoadmap(lifecycleId);
      if (roadmapRow?.roadmap) {
        const rm = roadmapRow.roadmap;
        // Requirements coverage
        if (rm.requirements_coverage) {
          const coveredFRs = Object.keys(rm.requirements_coverage);
          check(coveredFRs.length >= 1, 'T4-Q: requirements_coverage has entries', `got: ${coveredFRs.length}`);
          console.log(`    Requirements coverage: ${coveredFRs.length} FRs mapped`);
        }

        // Last milestone covers testing/integration/docs
        const lastMs = (rm.milestones || [])[rm.milestones.length - 1];
        if (lastMs) {
          const lastText = (lastMs.title + ' ' + (lastMs.description || '')).toLowerCase();
          check(
            /test|integr|doc|kvalit|final/.test(lastText),
            'T4-Q: last milestone covers testing/integration/docs',
            `got: "${lastMs.title}"`
          );
        }
      }

      // Clear test_strategy
      try {
        db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
      } catch { /* ignore */ }
    }

    // 4b. Send roadmap revision — request split
    const reviseRoadmapMsg = userTurn(
      'Rozděl první milník na dva — zvlášť crypto core (šifrování, scrypt, vault) a zvlášť database layer (SQLite, schema, migrace).'
    );
    const reviseRoadmapResp = await handleLifecycleInput(reviseRoadmapMsg, context);
    systemTurn('PLAN revision', reviseRoadmapResp);

    // After revision, we should be back at PLAN_REVIEW with new roadmap
    if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestonesAfterRevision = msRepo.listByLifecycle(lifecycleId);
      console.log(`    Milestones after revision: ${milestonesAfterRevision.length} (was: ${milestonesBeforeRevision})`);
      for (const m of milestonesAfterRevision) {
        console.log(`      ${m.id}: ${m.title}`);
      }
      check(
        milestonesAfterRevision.length >= milestonesBeforeRevision,
        'T4-R: revision has ≥ previous milestone count',
        `before: ${milestonesBeforeRevision}, after: ${milestonesAfterRevision.length}`
      );

      // Clear test_strategy on new milestones
      try {
        db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
      } catch { /* ignore */ }
    }

    // 4c. Approve roadmap
    if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
      const approveRoadmapMsg = userTurn('schvaluji');
      const approveRoadmapResp = await handleLifecycleInput(approveRoadmapMsg, context);
      systemTurn('PLAN → BUILD', approveRoadmapResp);
    }

    // ═══ PHASE 5: BUILD — ms-1 (with milestone rejection) ══════════════════

    console.log('\n\n═══ PHASE 5: BUILD — First Milestone (with rejection) ══════════════');

    // 5a. Reject first milestone plan with feedback
    let rejectedOnce = false;
    let builtFirstMs = false;
    let firstMsBuildRounds = 0;
    while (firstMsBuildRounds < 12) {
      firstMsBuildRounds++;
      const state = getLcState(SESSION_ID);
      if (!state) break;

      if (state.phase === 'BUILD_MILESTONE_REVIEW') {
        // First time seeing BUILD_MILESTONE_REVIEW → reject with feedback
        if (!rejectedOnce) {
          rejectedOnce = true;
          const rejectMsg = userTurn('ne, chci aby to používalo prepared statements místo raw SQL queries');
          const rejectResp = await handleLifecycleInput(rejectMsg, context);
          systemTurn('BUILD rejection', rejectResp);

          const afterReject = getLcState(SESSION_ID)?.phase;
          check(
            afterReject === 'BUILD_MILESTONE_REVIEW',
            'T5-R: phase stays BUILD_MILESTONE_REVIEW after rejection',
            `got: ${afterReject}`
          );
          continue; // Next loop iteration — approve on next round
        }

        // Subsequent BUILD_MILESTONE_REVIEW → approve
        const msg = userTurn('ano');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn(`BUILD ${state.currentMilestoneId}`, resp);

        const msDb = msRepo.getMilestone(state.currentMilestoneId);
        if (msDb?.status === 'PASSED') {
          builtFirstMs = true;
          check(true, `BUILD: ${state.currentMilestoneId} PASSED`);
          break;
        }
      } else if (state.phase === 'BUILD') {
        const msg = userTurn('ano');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('BUILD continue', resp);
      } else if (state.phase === 'REVIEW') {
        const msg = userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('REVIEW', resp);
      } else {
        break;
      }
    }

    check(rejectedOnce, 'T5-R: milestone rejection was tested');
    check(builtFirstMs, 'T6: first milestone completed');

    // Verify crypto files exist
    const cryptoFiles = walkFiles(projectPath).filter(f =>
      f.includes('crypto') || f.includes('vault') || f.includes('encrypt') ||
      f.includes('auth') || f.includes('package.json')
    );
    check(cryptoFiles.length >= 1, 'T6: security-related files generated', `got: ${cryptoFiles.join(', ')}`);

    // ═══ PHASE 6: CHANGE — Add CLI ══════════════════════════════════════════

    console.log('\n\n═══ PHASE 6: CHANGE — Add CLI Management ════════════════════════════');

    // After first milestone, we should be at BUILD_MILESTONE_REVIEW for next milestone
    // Send change request instead of approving
    const changeState = getLcState(SESSION_ID);
    console.log(`    Pre-change phase: ${changeState?.phase}, ms: ${changeState?.currentMilestoneId}`);

    if (changeState?.phase === 'BUILD_MILESTONE_REVIEW' || changeState?.phase === 'BUILD') {
      const changeMsg = userTurn('změna: přidat CLI rozhraní pro správu credentials z terminálu (commander.js, příkazy get/set/list/delete)');
      const changeResp = await handleLifecycleInput(changeMsg, context);
      systemTurn('CHANGE proposal', changeResp);

      const changeStateAfter = getLcState(SESSION_ID);
      check(changeStateAfter?.phase === 'CHANGE', 'T7: state is CHANGE', `got: ${changeStateAfter?.phase}`);
      changeTriggered = true;

      // Approve change
      const approveChangeMsg = userTurn('ano');
      const approveChangeResp = await handleLifecycleInput(approveChangeMsg, context);
      systemTurn('CHANGE approved', approveChangeResp);

      const afterApproval = getLcState(SESSION_ID);
      check(afterApproval?.phase === 'BUILD', 'T8: back to BUILD after change', `got: ${afterApproval?.phase}`);

      // Verify roadmap version incremented
      if (lifecycleId) {
        const roadmapV = roadmapVersions.getLatestVersion(lifecycleId);
        check(roadmapV >= 2, 'T8: roadmap version ≥2 (change applied)', `got: ${roadmapV}`);

        // Verify change request in DB
        const allCR = crRepo.findByLifecycle ? crRepo.findByLifecycle.all(lifecycleId) : [];
        check(allCR.length >= 1, 'T8: change request exists in DB', `got: ${allCR.length}`);
        if (allCR.length > 0) {
          check(
            allCR[0].status === 'APPROVED' || allCR[0].status === 'APPLIED',
            'T8: change request APPROVED/APPLIED',
            `got: ${allCR[0].status}`
          );
        }

        // Clear test_strategy on new milestones
        try {
          db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
        } catch { /* ignore */ }
      }
    } else {
      console.log('    Skipping change test — unexpected phase');
    }

    // ═══ PHASE 7: BUILD — Remaining Milestones ══════════════════════════════

    console.log('\n\n═══ PHASE 7: BUILD — Remaining Milestones ═══════════════════════════');

    let completedMilestones = builtFirstMs ? 1 : 0;
    let buildRound = 0;
    const maxBuildRounds = 30;

    while (buildRound < maxBuildRounds) {
      buildRound++;
      const state = getLcState(SESSION_ID);
      if (!state) {
        console.log('    Lifecycle cleared — COMPLETED');
        break;
      }

      console.log(`    [Build round ${buildRound}] phase=${state.phase} ms=${state.currentMilestoneId || '-'}`);

      if (state.phase === 'BUILD_MILESTONE_REVIEW') {
        const msg = userTurn('ano');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn(`BUILD ${state.currentMilestoneId || ''}`, resp);

        if (state.currentMilestoneId) {
          const msDb = msRepo.getMilestone(state.currentMilestoneId);
          if (msDb?.status === 'PASSED') {
            completedMilestones++;
            check(true, `BUILD: ${state.currentMilestoneId} PASSED`);
          }
        }
      } else if (state.phase === 'BUILD') {
        const msg = userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('BUILD continue', resp);
      } else if (state.phase === 'REVIEW') {
        const msg = userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn('REVIEW', resp);
      } else if (state.phase === 'COMPLETED') {
        break;
      } else {
        console.log(`    Unexpected phase: ${state.phase}`);
        break;
      }
    }

    check(completedMilestones >= 2, 'BUILD: ≥2 milestones completed', `got: ${completedMilestones}`);

    // ═══ PHASE 8: Final Verification + Quality Assertions ═══════════════════

    console.log('\n\n═══ PHASE 8: Final Verification + Quality Assertions ═════════════════');

    // ─── 8a. Spec Quality ───
    console.log('\n  ─── Spec Quality ───');
    if (lifecycleId) {
      const finalSpec = lifecycleRepo.getSpec(lifecycleId);
      if (finalSpec) {
        const goals = finalSpec.goals || [];
        check(goals.length >= 3, 'SPEC-Q: ≥3 goals', `got: ${goals.length}`);

        const frs = finalSpec.requirements?.functional || [];
        check(frs.length >= 5, 'SPEC-Q: ≥5 functional requirements', `got: ${frs.length}`);

        const frIds = frs.map(fr => fr.id).filter(Boolean);
        check(frIds.length === frs.length, 'SPEC-Q: every FR has an id', `${frIds.length}/${frs.length}`);
        check(new Set(frIds).size === frIds.length, 'SPEC-Q: FR IDs are unique');

        const dds = finalSpec.design_decisions || [];
        check(dds.length >= 2, 'SPEC-Q: ≥2 design decisions', `got: ${dds.length}`);
        const ddsWithAlts = dds.filter(d => (d.alternatives_considered || d.alternatives || []).length >= 2);
        check(ddsWithAlts.length >= 1, 'SPEC-Q: ≥1 design decision with ≥2 alternatives', `got: ${ddsWithAlts.length}`);

        // Check key rotation was added by revision
        const specStr = JSON.stringify(finalSpec).toLowerCase();
        check(
          specStr.includes('rotac') || specStr.includes('rotation') || specStr.includes('rotate'),
          'SPEC-Q: key rotation requirement present (from revision)'
        );

        console.log(`    Goals: ${goals.length}, FRs: ${frs.length}, DDs: ${dds.length}`);
      } else {
        check(false, 'SPEC-Q: spec exists in DB');
      }
    }

    // ─── 8b. Roadmap Quality ───
    console.log('\n  ─── Roadmap Quality ───');
    if (lifecycleId) {
      const roadmapRow = roadmapVersions.getLatestRoadmap(lifecycleId);
      if (roadmapRow?.roadmap) {
        const rm = roadmapRow.roadmap;
        const rmMs = rm.milestones || [];
        check(rmMs.length >= 3, 'ROAD-Q: ≥3 milestones in final roadmap', `got: ${rmMs.length}`);

        // Requirements coverage
        const coverage = rm.requirements_coverage || {};
        const covKeys = Object.keys(coverage);
        check(covKeys.length >= 1, 'ROAD-Q: requirements_coverage present', `got: ${covKeys.length} entries`);

        // Each milestone has required fields
        let missingFields = 0;
        for (const m of rmMs) {
          if (!m.title) missingFields++;
          if (!m.description) missingFields++;
        }
        check(missingFields === 0, 'ROAD-Q: all milestones have title + description', `missing: ${missingFields}`);

        console.log(`    Milestones: ${rmMs.length}, Coverage: ${covKeys.length} FRs, Version: ${roadmapRow.version}`);
      }

      const allMs = msRepo.listByLifecycle(lifecycleId);
      console.log(`    DB milestones: ${allMs.length}`);
      for (const m of allMs) {
        console.log(`      ${m.id}: ${m.title} [${m.status}]`);
      }
    }

    // ─── 8c. Documentation Quality ───
    console.log('\n  ─── Documentation Quality ───');
    const readmePath = path.join(projectPath, 'README.md');
    const archPath = path.join(projectPath, 'ARCHITECTURE.md');

    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf-8');
      check(readme.length > 200, 'DOC-Q: README.md is substantive', `got: ${readme.length} chars`);
      check(
        /##\s*(Použití|Usage|Instalace|Installation|Spuštění|Getting Started)/i.test(readme),
        'DOC-Q: README has usage/install section'
      );
      check(
        /##\s*(Architektura|Architecture|Struktura|Components)/i.test(readme),
        'DOC-Q: README has architecture section'
      );
      check(
        /##\s*(Tech\s*[Ss]tack|Technologie)/i.test(readme),
        'DOC-Q: README has tech stack section'
      );
      console.log(`    README.md: ${readme.length} chars`);
    } else {
      check(false, 'DOC-Q: README.md exists');
    }

    if (fs.existsSync(archPath)) {
      const arch = fs.readFileSync(archPath, 'utf-8');
      check(arch.length > 100, 'DOC-Q: ARCHITECTURE.md is substantive', `got: ${arch.length} chars`);
      console.log(`    ARCHITECTURE.md: ${arch.length} chars`);
    } else {
      // Not a hard failure — depends on spec having architecture data
      console.log('    ARCHITECTURE.md: not generated (spec may lack architecture data)');
    }

    // ─── 8d. DB Verification ───
    console.log('\n  ─── DB Verification ───');
    if (lifecycleId) {
      const lcDb = lifecycleRepo.findById.get(lifecycleId);
      check(lcDb != null, 'DB: lifecycle record exists');
      check(lcDb?.phase === 'COMPLETED', 'DB: lifecycle phase is COMPLETED', `got: ${lcDb?.phase}`);

      const allMs = msRepo.listByLifecycle(lifecycleId);
      check(allMs.length >= 2, 'DB: ≥2 milestones', `got: ${allMs.length}`);
      if (changeTriggered) {
        check(allMs.length >= 3, 'DB: ≥3 milestones (2 original + 1 change)', `got: ${allMs.length}`);
      }

      const passedMs = allMs.filter(m => m.status === 'PASSED');
      check(passedMs.length >= 2, 'DB: ≥2 milestones PASSED', `got: ${passedMs.length}`);
    }

    // ─── 8e. Files ───
    console.log('\n  ─── File Tree ───');
    const allFiles = walkFiles(projectPath);
    console.log(`    Generated ${allFiles.length} files:`);
    for (const f of allFiles) {
      const size = fs.statSync(path.join(projectPath, f)).size;
      console.log(`      ${f} (${size} bytes)`);
    }

    check(allFiles.length >= 3, 'Files: ≥3 files generated', `got: ${allFiles.length}`);

    // Check for security-relevant files
    const hasJsFiles = allFiles.some(f => f.endsWith('.js'));
    const hasPackageJson = allFiles.some(f => f.includes('package.json'));
    check(hasJsFiles, 'Files: JavaScript files present');

    // Verify crypto code quality (if crypto file exists)
    const cryptoFile = allFiles.find(f => f.includes('crypto') || f.includes('encrypt'));
    if (cryptoFile) {
      const cryptoContent = fs.readFileSync(path.join(projectPath, cryptoFile), 'utf8');
      check(cryptoContent.length > 50, 'Security: crypto file is substantive');
      const hasEncryption = /aes|gcm|cipher|encrypt/i.test(cryptoContent);
      check(hasEncryption, 'Security: crypto file references encryption');
      const hasNoWeakAlgo = !/\bmd5\b|\bsha1\b/i.test(cryptoContent);
      check(hasNoWeakAlgo, 'Security: no weak hash algorithms');
    }

    // ─── 8f. Git ───
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 3, 'Git: ≥3 commits', `got: ${commits.length}`);
      for (const c of commits.slice(0, 10)) console.log(`      ${c}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Turn count — higher now with revision rounds
    check(turnNum >= 22, 'Turns: ≥22 conversation turns (incl. revisions)', `got: ${turnNum}`);

    // Project preserved for IDE visibility
    console.log(`\n  Project preserved at: ${projectPath}`);

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
    failures.push({ name: 'FATAL', detail: err.message });
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Klíčenka E2E (Real LLM): ${passed} passed, ${failed} failed`);
  console.log(`  Duration: ${totalTime}s | Turns: ${turnNum}`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    - ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  try {
    const transcriptDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, `transcript-klicenka-${Date.now()}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`  Transcript: ${transcriptPath}`);
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

runTest();
