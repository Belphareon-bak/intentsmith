// E2E Test Harness v97 — Shared Infrastructure for Project E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
// Extracts ~250 lines of duplicated code from 3 test files:
//   - TestRunner (transcription, assertion counting)
//   - createExecutor (single-file LLM code generation + v97 code-cleaner pipeline)
//   - buildLoop / specLoop (adaptive lifecycle drivers)
//   - cleanDB / initProjectDir / walkFiles (setup helpers)
//   - checkOllama (model availability)
//   - main() runner (transcript saving, summary, exit code)
//
// Import: import { TestRunner, createExecutor, ... } from './e2e-harness.js';
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import {
  ProjectPhase,
  MilestoneStatus,
  CheckpointMode,
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
import { stripCodeFences, checkSyntax, repairCode, languagePromptSuffix } from '../src/planner/code-cleaner.js';
import { runQualityGate, runEnhancedValidation, resolveJsImport, extractJsExports } from '../src/planner/quality-gate.js';

// ─── Shared State ───────────────────────────────────────────────────────────

export const allTranscripts = {};
export let totalPassed = 0;
export let totalFailed = 0;
export const allFailures = [];
export const globalStart = Date.now();

export function elapsed(from = globalStart) {
  return `${((Date.now() - from) / 1000).toFixed(1)}s`;
}

// Re-export for test convenience
export {
  ProjectPhase, MilestoneStatus, CheckpointMode,
  getBuildProgress, computeLifecycleProgress, formatMilestoneTable,
  lifecycleRepo, msRepo, roadmapVersions, crRepo, driftChecks,
  projects, conversations, messagesRepo, lifecycleHandoffState, db,
  handleLifecycleBuildDetected, handleLifecycleInput,
  getLcState, setLcState, clearLcState, initLifecycleStateDb,
  callLLM,
};

// ─── TestRunner ─────────────────────────────────────────────────────────────

export class TestRunner {
  constructor(name) {
    this.name = name;
    this.transcript = [];
    this.turnNum = 0;
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
    this.convId = null;
    this.startTime = Date.now();
  }

  userTurn(message) {
    this.turnNum++;
    this.transcript.push({ turn: this.turnNum, role: 'USER', content: message, time: elapsed(this.startTime) });
    console.log(`\n${'─'.repeat(70)}`);
    console.log(` TURN ${this.turnNum} │ USER │ ${elapsed(this.startTime)}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(message);
    if (this.convId) try { messagesRepo.addMessage(this.convId, 'user', message); } catch {}
    return message;
  }

  systemTurn(phase, response) {
    this.turnNum++;
    const content = typeof response === 'string' ? response : (response?.content || JSON.stringify(response));
    this.transcript.push({ turn: this.turnNum, role: 'SYSTEM', phase, content, time: elapsed(this.startTime) });
    console.log(`\n${'─'.repeat(70)}`);
    console.log(` TURN ${this.turnNum} │ SYSTEM │ Phase: ${phase} │ ${elapsed(this.startTime)}`);
    console.log(`${'─'.repeat(70)}`);
    const maxLen = 800;
    console.log(content?.substring(0, maxLen) + (content?.length > maxLen ? '\n  ...(truncated)' : ''));
    if (this.convId) try { messagesRepo.addMessage(this.convId, 'assistant', content); } catch {}
  }

  check(condition, name, detail = '') {
    if (condition) {
      this.passed++;
      totalPassed++;
      console.log(`    ✅ ${name}`);
    } else {
      this.failed++;
      totalFailed++;
      console.log(`    ❌ ${name}: ${detail}`);
      this.failures.push({ name, detail });
      allFailures.push({ project: this.name, name, detail });
    }
  }

  summary() {
    const dt = elapsed(this.startTime);
    console.log(`\n  ─── ${this.name}: ${this.passed} passed, ${this.failed} failed │ ${this.turnNum} turns │ ${dt} ───`);
    if (this.failures.length > 0) {
      for (const f of this.failures) console.log(`    - ${f.name}: ${f.detail}`);
    }
    allTranscripts[this.name] = this.transcript;
  }
}

// ─── Ollama Health Check ────────────────────────────────────────────────────

export async function checkOllama() {
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

// ─── Real LLM Executor — v97: code-cleaner pipeline ────────────────────────
//
// Pipeline per file:
//   LLM generate (single file + language suffix)
//   → stripCodeFences
//   → write
//   → checkSyntax
//   → if FAIL: repairCode (snippet 2x → full-file 1x → accept)
//   → commit
//

export function createExecutor(projectPath, techHint = 'Node.js') {
  return {
    async start(request, metadata) {
      const msId = metadata.milestoneId;
      console.log(`\n    [EXECUTOR] ─── ${msId}: Real LLM Code Generation (v97) ───`);

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

      // v97: Single-file generation — one LLM call per file
      for (const file of files) {
        const ext = path.extname(file.path);
        const langSuffix = languagePromptSuffix(ext);

        const codePrompt = `You are implementing a file for a ${techHint} project.

File: ${file.path}
Purpose: ${file.purpose || 'As described'}

Context:
${request}

Generate the COMPLETE file content.
${langSuffix}`;

        console.log(`    [EXECUTOR]   Generating ${file.path}...`);
        const t0 = Date.now();
        try {
          // v97: temperature 0.1 for stable generation
          const result = await callLLM('CODE', codePrompt, null, { temperature: 0.1 });
          let content = result.content || '';

          // v97: Aggressive fence stripping + TS→JS transform
          content = stripCodeFences(content, ext);

          const fullPath = path.join(projectPath, file.path);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);

          // v97: Per-file syntax check + AST-guided repair
          try {
            checkSyntax(fullPath);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`    [EXECUTOR]   ✓ ${file.path} (${content.length} bytes, ${dt}s)`);
          } catch (syntaxErr) {
            console.log(`    [EXECUTOR]   ⚠ ${file.path} syntax error — attempting repair...`);
            const repairResult = await repairCode(content, syntaxErr.stderr || syntaxErr.message, fullPath, callLLM);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            if (repairResult.repaired) {
              console.log(`    [EXECUTOR]   ✓ ${file.path} repaired (tier: ${repairResult.tier}, ${repairResult.attempts} attempts, ${dt}s)`);
            } else {
              console.log(`    [EXECUTOR]   ✗ ${file.path} repair failed — accepting as-is (${dt}s)`);
            }
          }
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

// ─── DB + FS helpers ────────────────────────────────────────────────────────

export function cleanDB(projectPath) {
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
  } catch { /* first run */ }
  initLifecycleStateDb(lifecycleHandoffState, lifecycleRepo);
}

export function initProjectDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  // Clean stale files from previous runs (preserve .git)
  for (const entry of fs.readdirSync(dirPath)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(dirPath, '.git'))) {
    execSync('git init', { cwd: dirPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dirPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dirPath, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', { cwd: dirPath, stdio: 'pipe' });
  }
}

export function walkFiles(dir, base = dir) {
  const result = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) result.push(...walkFiles(fp, base));
      else result.push(path.relative(base, fp));
    }
  } catch { /* ignore */ }
  return result;
}

// ─── Adaptive build loop — drives lifecycle through BUILD→COMPLETED ─────────
// v97: Uses force-skip when blocked ≥3 times instead of plain "skip"
// v131: Track per-milestone attempts to auto-skip after 2 RETRY failures

export async function buildLoop(t, sessionId, context, opts = {}) {
  const { maxRounds = 30, rejectFirst = false, rejectMessage = '', maxMsRetries = 2 } = opts;
  let round = 0;
  let completed = 0;
  let rejected = false;
  let blockedSkips = 0;
  let lastResponse = '';
  const msAttempts = {}; // milestoneId → number of approval attempts

  while (round < maxRounds) {
    round++;
    const state = getLcState(sessionId);
    if (!state) { console.log('    Lifecycle cleared — COMPLETED'); break; }
    if (state.phase === 'COMPLETED') break;

    console.log(`    [Build round ${round}] phase=${state.phase} ms=${state.currentMilestoneId || '-'}`);

    // Detect blocked milestone loop (explicit text or repeated RETRY for same milestone)
    const isBlocked = typeof lastResponse === 'string' &&
      (lastResponse.includes('milníky jsou blokované') || lastResponse.includes('Milník zablokován'));

    if (state.phase === 'BUILD_MILESTONE_REVIEW') {
      const msId = state.currentMilestoneId;

      // v131: Check if this milestone has been retried too many times → auto-skip
      if (msId && (msAttempts[msId] || 0) >= maxMsRetries) {
        console.log(`    [Build] Milestone ${msId} failed ${msAttempts[msId]}× — auto-skipping`);
        // Force milestone to BLOCKED so the skip command is accepted by lifecycle router
        try { msRepo.updateStatus.run('BLOCKED', msId); } catch {}
        const msg = t.userTurn('skip');
        const resp = await handleLifecycleInput(msg, context);
        lastResponse = resp?.content || '';
        t.systemTurn(`BUILD auto-skip ${msId}`, resp);
        continue;
      }

      if (rejectFirst && !rejected) {
        rejected = true;
        const msg = t.userTurn(rejectMessage || 'Ne, tohle se mi nelíbí. Zkus to jinak.');
        const resp = await handleLifecycleInput(msg, context);
        lastResponse = resp?.content || '';
        t.systemTurn('BUILD rejection', resp);
        continue;
      }
      const msg = t.userTurn('ano');
      const resp = await handleLifecycleInput(msg, context);
      lastResponse = resp?.content || '';
      t.systemTurn(`BUILD ${msId || ''}`, resp);

      // Track attempts for this milestone
      if (msId) msAttempts[msId] = (msAttempts[msId] || 0) + 1;

      if (msId) {
        const msDb = msRepo.getMilestone(msId);
        if (msDb?.status === 'PASSED') {
          completed++;
          t.check(true, `BUILD: ${msId} PASSED`);
        }
      }
    } else if (state.phase === 'BUILD') {
      if (isBlocked) {
        blockedSkips++;
        // v97: After 2 blocked attempts, use force-skip to break deadlock
        const cmd = blockedSkips >= 2 ? 'force-skip' : 'skip';
        console.log(`    [Build] Detected blocked milestone — sending "${cmd}" (attempt #${blockedSkips})`);
        const msg = t.userTurn(cmd);
        const resp = await handleLifecycleInput(msg, context);
        lastResponse = resp?.content || '';
        t.systemTurn(`BUILD ${cmd}`, resp);
      } else {
        const msg = t.userTurn('pokračovat');
        const resp = await handleLifecycleInput(msg, context);
        lastResponse = resp?.content || '';
        t.systemTurn('BUILD continue', resp);
      }
    } else if (state.phase === 'REVIEW') {
      const msg = t.userTurn('pokračovat');
      const resp = await handleLifecycleInput(msg, context);
      lastResponse = resp?.content || '';
      t.systemTurn('REVIEW', resp);
    } else if (state.phase === 'PLANNING' || state.phase === 'PLAN_REVIEW') {
      // Handle stuck PLANNING (D1 roadmap gen failed) or unexpected PLAN_REVIEW
      const msg = t.userTurn('pokračovat');
      const resp = await handleLifecycleInput(msg, context);
      lastResponse = resp?.content || '';
      t.systemTurn(`${state.phase}`, resp);
    } else {
      console.log(`    Unexpected phase: ${state.phase} — breaking`);
      break;
    }
  }

  return { completed, rejected };
}

// ─── Spec answer loop — drives lifecycle through SPEC→SPEC_REVIEW ───────────

export async function specLoop(t, sessionId, context, answers) {
  let round = 0;
  while (getLcState(sessionId)?.phase === 'SPEC' && round < answers.length + 2) {
    const answer = answers[Math.min(round, answers.length - 1)];
    const msg = t.userTurn(answer);
    const resp = await handleLifecycleInput(msg, context);
    t.systemTurn(`SPEC round ${round + 1}`, resp);
    round++;
  }
  return round;
}

// ─── Main runner — orchestrates tests, saves transcripts, exits ─────────────

export async function runTests(testName, testFns, transcriptPrefix) {
  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log('\n  Ollama not available or missing models — aborting.');
    process.exit(0);
  }

  for (const fn of testFns) {
    await fn();
  }

  const totalTime = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log('\n\n══════════════════════════════════════════════════════════════════════');
  console.log(`  ${testName} — SUMMARY`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`  Duration: ${totalTime}s`);

  if (allFailures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of allFailures) {
      console.log(`    [${f.project}] ${f.name}: ${f.detail}`);
    }
  }

  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Save transcript
  const transcriptDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-transcripts');
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `transcript-${transcriptPrefix}-${Date.now()}.json`);
  fs.writeFileSync(transcriptPath, JSON.stringify(allTranscripts, null, 2));
  console.log(`  Transcript: ${transcriptPath}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

// ─── v134: Project Validation Utilities ─────────────────────────────────────
// Reusable validation functions for post-build quality assertions

/**
 * Run syntax validation on all project files via quality gate (full-project mode).
 * Returns { passed, results: [{file, passed, error, message}], summary }.
 */
export async function validateProjectSyntax(projectPath) {
  return runQualityGate(projectPath, {}, null, { mode: 'full-project' });
}

/**
 * Run semantic validation on all project files (non-empty, imports, mock detection).
 * Returns { errors: [{file, message, category}], warnings: [{file, message, category}] }.
 */
export async function validateProjectSemantics(projectPath) {
  return runEnhancedValidation(projectPath, null);
}

/**
 * Check that a file exists and has substantive content (>10 bytes, >0 non-comment lines).
 * Returns { exists, substantive, bytes, lines, nonCommentLines }.
 */
export function checkFileSubstantive(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, substantive: false, bytes: 0, lines: 0, nonCommentLines: 0 };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const lines = content.split('\n');
  const nonComment = lines.filter(l => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('*') && !t.startsWith('/*');
  });
  return {
    exists: true,
    substantive: bytes > 10 && nonComment.length > 0,
    bytes,
    lines: lines.length,
    nonCommentLines: nonComment.length,
  };
}

/**
 * Scan all project source files for mock/placeholder patterns.
 * Returns { files: [{file, mockLines, totalLines, ratio}], hasMockCode: boolean }.
 */
export function detectProjectMocks(projectPath) {
  const MOCK_RE = /\b(placeholder|mock|simulated|dummy|TODO|FIXME|HACK|stub|fake|sample data|example data|not implemented|in a full implementation|in real implementation)\b/i;
  const allFiles = walkFiles(projectPath);
  const sourceExts = new Set(['.js', '.ts', '.java', '.py', '.go', '.rs', '.c', '.cpp', '.cs']);
  const results = [];
  let totalMock = 0;
  let totalLines = 0;

  for (const relPath of allFiles) {
    const ext = path.extname(relPath);
    if (!sourceExts.has(ext)) continue;
    // Skip test files
    if (relPath.includes('/test/') || relPath.includes('/tests/') || relPath.includes('Test.java') || relPath.includes('.test.')) continue;

    try {
      const content = fs.readFileSync(path.join(projectPath, relPath), 'utf8');
      const lines = content.split('\n');
      const mockLines = lines.filter(l => MOCK_RE.test(l)).length;
      totalMock += mockLines;
      totalLines += lines.length;
      if (mockLines > 0) {
        results.push({ file: relPath, mockLines, totalLines: lines.length, ratio: mockLines / lines.length });
      }
    } catch { /* skip unreadable */ }
  }

  return {
    files: results,
    hasMockCode: totalMock > 0,
    totalMockLines: totalMock,
    totalSourceLines: totalLines,
    overallRatio: totalLines > 0 ? totalMock / totalLines : 0,
  };
}

/**
 * Verify that JS require/import targets actually resolve to existing files.
 * Returns { resolved: number, unresolved: [{file, target}] }.
 */
export function validateJsImportResolution(projectPath) {
  const allFiles = walkFiles(projectPath);
  const jsFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
  const REQUIRE_RE = /(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\))|(?:from\s+['"](\.[^'"]+)['"])/g;
  let resolved = 0;
  const unresolved = [];

  for (const relPath of jsFiles) {
    const fullPath = path.join(projectPath, relPath);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const dir = path.dirname(fullPath);
      let m;
      while ((m = REQUIRE_RE.exec(content)) !== null) {
        const target = m[1] || m[2];
        const resolvedPath = resolveJsImport(dir, target);
        if (resolvedPath) {
          resolved++;
        } else {
          unresolved.push({ file: relPath, target });
        }
      }
    } catch { /* skip */ }
  }

  return { resolved, unresolved };
}

// Re-export quality-gate helpers for direct use in tests
export { resolveJsImport, extractJsExports, runEnhancedValidation };
