// Lifecycle E2E Test — Klíčenka (Credential Vault) — Real LLM
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario with REAL Ollama LLM calls. Full lifecycle WITH change management:
//   PROPOSED → SPEC → SPEC_REVIEW → PLAN_REVIEW → BUILD (ms-1)
//   → CHANGE (add CLI) → BUILD (ms-2, ms-3) → COMPLETED
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Models: deepseek-r1:32b, qwen2.5-coder:32b, qwen2.5:32b
//   - Expected duration: 15-30 minutes
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
    const required = ['deepseek-r1', 'qwen2.5-coder', 'qwen2.5'];
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

function cleanDB() {
  for (const t of ['lifecycle_handoff_state', 'drift_checks', 'change_requests',
                    'milestones', 'roadmap_versions', 'project_lifecycles']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
  try { db.prepare(`DELETE FROM projects WHERE path LIKE '/tmp/%'`).run(); } catch { /* ignore */ }
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

  cleanDB();

  const SESSION_ID = 'klicenka-e2e-real';
  const projectPath = `/tmp/lc-klicenka-real-${Date.now()}`;
  fs.mkdirSync(projectPath, { recursive: true });
  execSync('git init', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });

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

    // ═══ PHASE 3: Approve Spec ══════════════════════════════════════════════

    console.log('\n\n═══ PHASE 3: Approve Spec ═══════════════════════════════════════════');

    // Approve spec directly (no revision — klíčenka test focuses on change management)
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const approveMsg = userTurn('schvaluji');
      const approveResp = await handleLifecycleInput(approveMsg, context);
      systemTurn('SPEC → PLAN_REVIEW', approveResp);
    }

    // ═══ PHASE 4: Plan Review — Roadmap ══════════════════════════════════════

    console.log('\n\n═══ PHASE 4: PLAN_REVIEW — Real Roadmap ═════════════════════════════');

    const stateRoadmap = getLcState(SESSION_ID);
    check(stateRoadmap?.phase === 'PLAN_REVIEW', 'T4: reached PLAN_REVIEW', `got: ${stateRoadmap?.phase}`);
    lifecycleId = stateRoadmap?.lifecycleId || lifecycleId;

    if (lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      check(milestones.length >= 2, 'T4: roadmap has ≥2 milestones', `got: ${milestones.length}`);
      console.log(`    Milestones:`);
      for (const m of milestones) {
        console.log(`      ${m.id}: ${m.title}`);
      }

      // Clear test_strategy
      try {
        db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
      } catch { /* ignore */ }
    }

    // Roadmap discussion turn (extra quality turn)
    const discussMsg = userTurn(
      'Jaké milníky zahrnuje roadmapa? Pokud crypto core + REST API jsou oddělené milníky, schvaluji.'
    );
    const discussResp = await handleLifecycleInput(discussMsg, context);
    systemTurn('PLAN discussion', discussResp);

    // If that was interpreted as revision, we might have a new roadmap
    // If it stayed in PLAN_REVIEW, approve
    if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
      const approveRoadmapMsg = userTurn('schvaluji');
      const approveRoadmapResp = await handleLifecycleInput(approveRoadmapMsg, context);
      systemTurn('PLAN → BUILD', approveRoadmapResp);
    }

    // ═══ PHASE 5: BUILD — ms-1 ══════════════════════════════════════════════

    console.log('\n\n═══ PHASE 5: BUILD — First Milestone ════════════════════════════════');

    // Build first milestone (crypto core)
    let builtFirstMs = false;
    let firstMsBuildRounds = 0;
    while (firstMsBuildRounds < 10) {
      firstMsBuildRounds++;
      const state = getLcState(SESSION_ID);
      if (!state) break;

      if (state.phase === 'BUILD_MILESTONE_REVIEW') {
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

    // ═══ PHASE 8: Final Verification ══════════════════════════════════════════

    console.log('\n\n═══ PHASE 8: Final Verification ══════════════════════════════════════');

    // DB
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

    // Files
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

    // Git
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 3, 'Git: ≥3 commits', `got: ${commits.length}`);
      for (const c of commits.slice(0, 10)) console.log(`      ${c}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Turn count
    check(turnNum >= 18, 'Turns: ≥18 conversation turns', `got: ${turnNum}`);

    // Cleanup
    if (process.env.KEEP_PROJECT || failed > 0) {
      console.log(`\n  Project preserved at: ${projectPath}`);
    } else {
      try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { /* ignore */ }
      console.log(`  Cleaned up (KEEP_PROJECT=1 to preserve)`);
    }

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
    const transcriptPath = `/tmp/transcript-klicenka-${Date.now()}.json`;
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`  Transcript: ${transcriptPath}`);
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

runTest();
