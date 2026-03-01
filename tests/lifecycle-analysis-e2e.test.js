// E2E Test — Existing Project Analysis (ai-log-analyzer) — Real LLM
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario: User opens existing ai-log-analyzer project and asks
// for analysis + improvement suggestions. Uses REAL Ollama LLM for:
//   1. Project context analysis (via analyzeExistingProject — deterministic)
//   2. Real LLM-generated improvement suggestions
//   3. Real LLM-generated project summary
//
// Also tests: project state reader, CRE classification, domain registry,
// file integrity, improvement candidates, DB registration.
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Model: qwen2.5:32b (CHAT role)
//   - Expected duration: 3-10 minutes
//
// Run: node tests/lifecycle-analysis-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import { isProjectScopeBuild } from '../src/chat/handlers/build-handoff.js';
import { domainRegistry, extractTags } from '../src/domains/index.js';
import { readProjectState, StateType } from '../src/chat/handlers/utils/project-state-reader.js';
import { analyzeExistingProject } from '../src/planner/lifecycle-analyzer.js';
import { callLLM } from '../src/planner/workflow.js';
import { projects, conversations, messages as messagesRepo, db } from '../src/db/database.js';

// ─── Test Infra ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const startTime = Date.now();
let turnNum = 0;
let _convId = null; // set during test setup

function elapsed() {
  return `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
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

function section(name) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name} │ ${elapsed()}`);
  console.log(`${'═'.repeat(70)}`);
}

function llmTurn(role, response) {
  turnNum++;
  const content = typeof response === 'string' ? response : (response?.content || '');
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` LLM TURN ${turnNum} │ ${role} │ ${elapsed()}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(content.substring(0, 600) + (content.length > 600 ? '\n  ...(truncated)' : ''));
  if (_convId) try { messagesRepo.addMessage(_convId, 'assistant', content); } catch {}
}

// ─── Ollama Health Check ────────────────────────────────────────────────────

async function checkOllama() {
  try {
    const resp = await fetch('http://127.0.0.1:11434/api/tags');
    const data = await resp.json();
    const models = data.models?.map(m => m.name) || [];
    const hasChatModel = models.some(m => m.includes('qwen2.5'));
    check(hasChatModel, 'Ollama: CHAT model available');
    return hasChatModel;
  } catch (e) {
    console.error(`    Ollama not available: ${e.message}`);
    return false;
  }
}

// ─── Simulated ai-log-analyzer project files ────────────────────────────────

const AI_LOG_README = `# AI Log Analyzer

Automated log analysis system for production Kubernetes clusters.

## Stack

- **Language:** Python 3.11
- **Sources:** Elasticsearch (K8s error logs)
- **Detection:** P93/CAP percentile-based spike detection (statistical, no ML)
- **Storage:** PostgreSQL (ailog_peak schema)
- **Notifications:** Microsoft Teams, Confluence
- **Deployment:** Kubernetes CronJobs (Helm chart)

## Pipeline

6-phase detection pipeline:
1. **Phase A** — Parse & normalize log entries
2. **Phase B** — Measure & compute EWMA baselines
3. **Phase C** — Detect spikes (P93 + CAP fallback)
4. **Phase D** — Score severity (0-100 weighted)
5. **Phase E** — Classify error categories
6. **Phase F** — Report & notify

## Running

\`\`\`bash
# Regular 15-min analysis
python scripts/regular_phase.py

# Daily backfill
python scripts/backfill_phase.py

# Weekly threshold recalc
python scripts/weekly_recalc.py
\`\`\`

## Configuration

All configuration via environment variables (see \`config/.env.example\`).
`;

const AI_LOG_ROADMAP = `# AI Log Analyzer — Roadmap

## Fáze

| Fáze | Status | Popis |
|------|--------|-------|
| v1 — Core Pipeline | ✅ Hotovo | 6-phase detection, P93 scoring |
| v2 — Registry | ✅ Hotovo | Known errors YAML, fingerprinting |
| v3 — PostgreSQL | ✅ Hotovo | DB storage, migrations, audit |
| v4 — Notifications | ✅ Hotovo | Teams, Confluence publishing |
| v5 — K8s Deploy | ✅ Hotovo | Helm chart, CronJobs, init job |
| v6 — Incident Analysis | 🔄 Probíhá | Causal inference, timeline, fix recommender |
`;

const AI_LOG_REQUIREMENTS = `psycopg2-binary
python-dotenv
requests
pyyaml
`;

const AI_LOG_MAIN_PY = `from scripts.pipeline.orchestrator import run_pipeline
import sys

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'regular'
    run_pipeline(mode)
`;

const AI_LOG_ORCHESTRATOR = `"""Pipeline orchestrator — runs 6-phase detection."""

from scripts.pipeline.phase_a import parse_logs
from scripts.pipeline.phase_b import compute_baselines
from scripts.pipeline.phase_c import detect_spikes
from scripts.pipeline.phase_d import score_severity
from scripts.pipeline.phase_e import classify_errors
from scripts.pipeline.phase_f import generate_report

def run_pipeline(mode='regular'):
    """Run full detection pipeline."""
    logs = parse_logs(mode)
    baselines = compute_baselines(logs)
    spikes = detect_spikes(logs, baselines)
    scored = score_severity(spikes)
    classified = classify_errors(scored)
    report = generate_report(classified)
    return report
`;

const AI_LOG_PEAK_DETECTION = `"""P93 percentile spike detection with CAP fallback."""

import math

def detect_p93(values, threshold_pct=93):
    """Detect values above P93 percentile."""
    if not values:
        return []
    sorted_vals = sorted(values)
    idx = math.ceil(len(sorted_vals) * threshold_pct / 100) - 1
    threshold = sorted_vals[min(idx, len(sorted_vals) - 1)]
    return [v for v in values if v > threshold]

def cap_fallback(values, window=7):
    """CAP (Cumulative Anomaly Pattern) fallback for sparse data."""
    if len(values) < window:
        return []
    recent = values[-window:]
    avg = sum(recent) / len(recent)
    std = (sum((v - avg)**2 for v in recent) / len(recent)) ** 0.5
    cap_threshold = avg + 2 * std
    return [v for v in recent if v > cap_threshold]
`;

const AI_LOG_DOCKERFILE = `FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
`;

const AI_LOG_HELM_CHART = `apiVersion: v2
name: ai-log-analyzer
description: Automated log analysis for K8s clusters
type: application
version: 6.1.0
appVersion: "6.1.0"
`;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════════

async function runTest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  E2E: Existing Project Analysis (ai-log-analyzer)');
  console.log('  Mode: REAL LLM (Ollama)');
  console.log('══════════════════════════════════════════════════════════════════════');

  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log('\n  Ollama not available — skipping test');
    process.exit(0);
  }

  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/AI-Log-Analyzer-E2E');

  try {
    // ═══ SETUP: Create simulated project ═════════════════════════════════════

    section('SETUP: Populate ai-log-analyzer project');

    fs.mkdirSync(path.join(projectPath, 'scripts/pipeline'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'scripts/core'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'config'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'core'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'registry'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'k8s/templates'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, '.c3'), { recursive: true });

    fs.writeFileSync(path.join(projectPath, 'README.md'), AI_LOG_README);
    fs.writeFileSync(path.join(projectPath, 'ROADMAP.md'), AI_LOG_ROADMAP);
    fs.writeFileSync(path.join(projectPath, 'requirements.txt'), AI_LOG_REQUIREMENTS);
    fs.writeFileSync(path.join(projectPath, 'main.py'), AI_LOG_MAIN_PY);
    fs.writeFileSync(path.join(projectPath, 'scripts/pipeline/orchestrator.py'), AI_LOG_ORCHESTRATOR);
    fs.writeFileSync(path.join(projectPath, 'scripts/pipeline/__init__.py'), '');
    fs.writeFileSync(path.join(projectPath, 'scripts/core/peak_detection.py'), AI_LOG_PEAK_DETECTION);
    fs.writeFileSync(path.join(projectPath, 'scripts/core/__init__.py'), '');
    fs.writeFileSync(path.join(projectPath, 'Dockerfile'), AI_LOG_DOCKERFILE);
    fs.writeFileSync(path.join(projectPath, 'k8s/Chart.yaml'), AI_LOG_HELM_CHART);
    fs.writeFileSync(path.join(projectPath, 'config/.env.example'), 'ELASTICSEARCH_URL=http://localhost:9200\nPOSTGRES_DSN=postgresql://...\n');
    fs.writeFileSync(path.join(projectPath, 'registry/known_errors.yaml'), 'errors: []\n');
    fs.writeFileSync(path.join(projectPath, '.c3/project.json'), JSON.stringify({ type: 'general', lifecycle: 'SPEC' }));

    // Init git if not already a repo
    if (!fs.existsSync(path.join(projectPath, '.git'))) {
      execSync('git init', { cwd: projectPath, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    }
    execSync('git add -A', { cwd: projectPath, stdio: 'pipe' });
    try { execSync('git commit -m "ai-log-analyzer v6.1.0"', { cwd: projectPath, stdio: 'pipe' }); } catch { /* already committed */ }

    // Register project + conversation in DB → visible in IDE
    const PROJECT_NAME = 'AI Log Analyzer E2E';
    const PROJECT_DESC = 'Existing project analysis — E2E test (real LLM)';
    const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
    const projectId = Number(project.id);
    _convId = `e2e-analysis-${Date.now()}`;
    conversations.getOrCreate(_convId, projectId, 'AI Log Analyzer — Architecture Analysis (Real LLM)');

    const fileCount = execSync('find . -type f -not -path "./.git/*" | wc -l', {
      cwd: projectPath, encoding: 'utf8',
    }).trim();
    console.log(`    Created ${fileCount} files in ${projectPath}`);
    check(parseInt(fileCount) >= 10, 'Setup: ≥10 project files created');

    // ═══ TEST 1: Project State Reader ════════════════════════════════════════

    section('1. Project State Reader');

    const projectState = readProjectState(projectPath);

    check(projectState != null, 'T1: readProjectState returns non-null');
    check(projectState.hasReadme === true, 'T1: README detected');
    check(projectState.hasRoadmap === true, 'T1: ROADMAP detected');
    check(
      projectState.stateType === StateType.FOREIGN || projectState.stateType === StateType.HYBRID,
      'T1: stateType is FOREIGN or HYBRID',
      `got: ${projectState.stateType}`
    );

    const stackStr = JSON.stringify(projectState.stack || []).toLowerCase();
    check(stackStr.includes('python'), 'T1: Python detected in stack', `stack: ${stackStr}`);

    // ═══ TEST 2: CRE — Analysis ≠ Build ═════════════════════════════════════

    section('2. CRE Classification — Analysis ≠ Build');

    const analysisInputs = [
      'analyzuj tento projekt a navrhni zlepšení',
      'projdi kód a řekni mi co by šlo vylepšit',
      'chci kompletní analýzu projektu ai-log-analyzer',
      'podívej se na architekturu a dej mi doporučení',
      'analyze this project and suggest improvements',
    ];

    for (const input of analysisInputs) {
      const isBuild = isProjectScopeBuild(input);
      check(!isBuild, `T2: "${input.slice(0, 45)}..." → NOT build`);
    }

    const buildInputs = [
      'postav mi kompletní frontend a backend a MongoDB databáze',
      'vytvoř celý projekt od začátku s autentizací a API',
    ];

    for (const input of buildInputs) {
      const isBuild = isProjectScopeBuild(input);
      check(isBuild, `T2: "${input.slice(0, 45)}..." → IS build (sanity)`);
    }

    // ═══ TEST 3: Domain Registry ═════════════════════════════════════════════

    section('3. Domain Registry — Tag matching');

    const projectDesc = 'python log analyzer with elasticsearch monitoring kubernetes docker pipeline';
    const tags = extractTags(projectDesc);

    check(tags.includes('python'), 'T3: python tag extracted');
    check(tags.includes('monitoring'), 'T3: monitoring tag extracted');
    check(tags.includes('docker'), 'T3: docker tag extracted');
    check(tags.includes('kubernetes'), 'T3: kubernetes tag extracted');

    const { recipes, scaffolds } = domainRegistry.matchRequest(projectDesc);
    check(recipes.length > 0, 'T3: recipes found', `got: ${recipes.length}`);

    // ═══ TEST 4: Real LLM — Project Analysis ════════════════════════════════

    section('4. Real LLM — Project Context Analysis');

    console.log('    Running analyzeExistingProject (deterministic)...');
    const t0 = Date.now();
    const projectContext = await analyzeExistingProject(projectPath, null, null);
    const analysisDt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`    Analysis complete (${analysisDt}s, ${projectContext.length} chars)`);

    check(projectContext.length > 50, 'T4: analysis context is substantive', `got: ${projectContext.length} chars`);
    check(
      projectContext.includes('Python') || projectContext.includes('python') || projectContext.includes('.py'),
      'T4: analysis mentions Python'
    );

    llmTurn('ANALYZER', projectContext);

    // ═══ TEST 5: Real LLM — Improvement Suggestions ═════════════════════════

    section('5. Real LLM — Improvement Suggestions');

    const improvementPrompt = `You are analyzing an existing Python project for improvements.

Project context:
${projectContext}

README:
${AI_LOG_README}

Key files: main.py, scripts/pipeline/orchestrator.py, scripts/core/peak_detection.py, Dockerfile, k8s/Chart.yaml

List 5-8 specific, actionable improvement suggestions. For each:
- Category (testing, security, performance, code quality, devops, documentation)
- Current state (what's missing or weak)
- Recommended action
- Priority (HIGH/MEDIUM/LOW)

Output as JSON array of objects with keys: category, current_state, action, priority`;

    console.log('    Calling LLM for improvement suggestions...');
    const llmT0 = Date.now();
    const improvementResult = await callLLM('CHAT', improvementPrompt);
    const llmDt = ((Date.now() - llmT0) / 1000).toFixed(1);
    console.log(`    LLM response (${llmDt}s, ${improvementResult.content?.length || 0} chars)`);

    llmTurn('CHAT (improvements)', improvementResult.content);

    check(improvementResult.content?.length > 100, 'T5: LLM produced substantive response');

    // Check for expected improvement categories
    const content = improvementResult.content.toLowerCase();
    check(content.includes('test') || content.includes('pytest'), 'T5: mentions testing');
    check(
      content.includes('type') || content.includes('mypy') || content.includes('annotation') ||
      content.includes('lint') || content.includes('quality') || content.includes('logging') ||
      content.includes('security') || content.includes('error handling'),
      'T5: mentions code quality aspect (types/lint/security/logging)'
    );
    check(
      content.includes('ci') || content.includes('pipeline') || content.includes('github'),
      'T5: mentions CI/CD'
    );

    // ═══ TEST 6: Real LLM — Project Summary ═════════════════════════════════

    section('6. Real LLM — Project Summary');

    const summaryPrompt = `Summarize this Python project in 3-5 sentences. Include: purpose, tech stack, current development phase, and architecture overview.

README:
${AI_LOG_README}

ROADMAP:
${AI_LOG_ROADMAP}

Be concise and specific. Include concrete details like "P93 percentile detection" and "6-phase pipeline".`;

    console.log('    Calling LLM for project summary...');
    const summaryT0 = Date.now();
    const summaryResult = await callLLM('CHAT', summaryPrompt);
    const summaryDt = ((Date.now() - summaryT0) / 1000).toFixed(1);
    console.log(`    LLM response (${summaryDt}s)`);

    llmTurn('CHAT (summary)', summaryResult.content);

    check(summaryResult.content?.length > 50, 'T6: LLM produced summary');
    const summary = summaryResult.content.toLowerCase();
    check(summary.includes('log') || summary.includes('analyz'), 'T6: summary mentions log analysis');
    check(summary.includes('pipeline') || summary.includes('phase') || summary.includes('detection'),
      'T6: summary mentions pipeline/detection');
    check(summary.includes('kubernetes') || summary.includes('k8s') || summary.includes('docker'),
      'T6: summary mentions deployment');

    // ═══ TEST 7: Real LLM — Architecture Assessment ═════════════════════════

    section('7. Real LLM — Architecture Assessment');

    const archPrompt = `Assess the architecture of this project based on the code structure.

Orchestrator code:
${AI_LOG_ORCHESTRATOR}

Peak detection:
${AI_LOG_PEAK_DETECTION}

Dockerfile:
${AI_LOG_DOCKERFILE}

Evaluate:
1. Is the pipeline pattern well-structured? (YES/NO with brief reason)
2. Is the statistical detection approach sound? (P93 percentile + CAP fallback)
3. What's the main architectural risk?
4. Suggest one structural improvement.

Be specific and technical. Reference actual functions and patterns.`;

    console.log('    Calling LLM for architecture assessment...');
    const archT0 = Date.now();
    const archResult = await callLLM('CHAT', archPrompt);
    const archDt = ((Date.now() - archT0) / 1000).toFixed(1);
    console.log(`    LLM response (${archDt}s)`);

    llmTurn('CHAT (architecture)', archResult.content);

    check(archResult.content?.length > 100, 'T7: LLM produced architecture assessment');
    const arch = archResult.content.toLowerCase();
    check(
      arch.includes('pipeline') || arch.includes('orchestrator') || arch.includes('phase'),
      'T7: assessment references pipeline pattern'
    );
    check(
      arch.includes('p93') || arch.includes('percentile') || arch.includes('cap') || arch.includes('detection'),
      'T7: assessment references detection methods'
    );

    // ═══ TEST 8: File Integrity ══════════════════════════════════════════════

    section('8. File Integrity — Analysis preserves files');

    const filesToCheck = [
      'README.md', 'ROADMAP.md', 'requirements.txt', 'main.py',
      'scripts/pipeline/orchestrator.py', 'scripts/core/peak_detection.py',
      'Dockerfile', 'k8s/Chart.yaml',
    ];

    const gitStatus = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf8' }).trim();
    check(gitStatus === '', 'T8: git working tree clean', `got: "${gitStatus}"`);

    for (const f of filesToCheck) {
      const fp = path.join(projectPath, f);
      check(fs.existsSync(fp), `T8: ${f} still exists`);
    }

    // ═══ TEST 9: Improvement Candidates ══════════════════════════════════════

    section('9. Improvement Candidates — Structural gaps');

    const hasTests = fs.existsSync(path.join(projectPath, 'tests'));
    check(!hasTests || !fs.readdirSync(path.join(projectPath, 'tests')).some(f => f.endsWith('.py')),
      'T9: No test files (improvement: add pytest)');

    const reqs = fs.readFileSync(path.join(projectPath, 'requirements.txt'), 'utf8');
    check(!reqs.includes('=='), 'T9: No pinned versions (improvement: pin deps)');

    check(!fs.existsSync(path.join(projectPath, '.github/workflows')),
      'T9: No CI/CD (improvement: add GitHub Actions)');

    const dockerfile = fs.readFileSync(path.join(projectPath, 'Dockerfile'), 'utf8');
    check(!dockerfile.includes('AS builder'),
      'T9: No multi-stage Dockerfile (improvement: add build stage)');

    // ═══ TEST 10: Project DB Registration ════════════════════════════════════

    section('10. Project DB Registration');

    const dbProject = projects.findById.get(projectId);
    check(dbProject != null, 'T10: project registered in DB');
    check(dbProject?.name === 'AI Log Analyzer E2E', 'T10: project name correct');

    // Turn count
    check(turnNum >= 3, 'Turns: ≥3 LLM calls', `got: ${turnNum}`);

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
  console.log(`  Analysis E2E (Real LLM): ${passed} passed, ${failed} failed`);
  console.log(`  Duration: ${totalTime}s | LLM calls: ${turnNum}`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    - ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTest();
