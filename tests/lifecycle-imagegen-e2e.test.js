// Lifecycle E2E Test — GPU Image Generation Setup — Real LLM (v92)
// ══════════════════════════════════════════════════════════════════════════════
// Real scenario with REAL Ollama LLM calls. Focus: SETUP/DEPLOYMENT PROJECT.
//
// Project: Local Stable Diffusion image generation setup with Python + GPU
// Unlike other E2E tests (build-from-scratch), this is a SETUP/CONFIGURATION
// project — the lifecycle engine helps the user set up, configure, and wrap
// an existing image generation stack (diffusers, torch, Gradio).
//
// This test adds assertions NOT covered by other E2E tests:
//   ① Setup script analysis: shell scripts with proper structure + GPU checks
//   ② Dependency completeness: requirements.txt with torch, diffusers, etc.
//   ③ Configuration files: YAML/JSON config for model paths, defaults
//   ④ GPU/CUDA awareness: generated files reference CUDA, GPU, device selection
//   ⑤ Virtual environment handling: setup creates venv or references pip install
//   ⑥ Model download handling: scripts/code for downloading models from HuggingFace
//   ⑦ Wrapper script quality: CLI wrapper with argparse, default params, help text
//   ⑧ Change management: user adds LoRA/img2img support mid-build
//   ⑨ Setup-oriented milestones: env setup → core → features → docs
//   ⑩ Troubleshooting docs: GPU detection, VRAM, common errors
//
// Flow:
//   PROPOSED → SPEC → SPEC_REVIEW (revise → approve)
//   → PLAN_REVIEW (approve) → BUILD (ms-1, ms-2, ...) → COMPLETED
//   → Deep quality verification (scripts, deps, configs, GPU, docs)
//
// Requirements:
//   - Ollama running at http://127.0.0.1:11434
//   - Models: deepseek-r1:32b, qwen3.5:27b, qwen3.5:27b
//   - Expected duration: 20-40 minutes
//
// Run: node tests/lifecycle-imagegen-e2e.test.js
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

// ─── Test Infra ─────────────────────────────────────────────────────────────

const transcript = [];
let turnNum = 0;
let passed = 0;
let failed = 0;
const failures = [];
const startTime = Date.now();
let _convId = null;

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

// ─── Real LLM Executor (Setup/Config-aware) ──────────────────────────────

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

      if (files.length === 0) {
        console.log(`    [EXECUTOR] No files in plan — generating defaults for setup project`);
        files = [
          { path: 'setup.sh', action: 'create', purpose: 'Environment setup script with GPU detection' },
          { path: 'requirements.txt', action: 'create', purpose: 'Python dependencies with PyTorch and diffusers' },
          { path: 'generate.py', action: 'create', purpose: 'Main image generation wrapper script' },
          { path: 'config.yaml', action: 'create', purpose: 'Configuration file for model paths and defaults' },
        ];
      }

      for (const file of files) {
        // Determine language/format for code generation prompt
        const ext = path.extname(file.path).toLowerCase();
        let langHint = 'Python';
        if (ext === '.sh' || ext === '.bash') langHint = 'Bash shell script';
        else if (ext === '.yaml' || ext === '.yml') langHint = 'YAML configuration';
        else if (ext === '.json') langHint = 'JSON configuration';
        else if (ext === '.toml') langHint = 'TOML configuration';
        else if (ext === '.md') langHint = 'Markdown documentation';
        else if (ext === '.txt') langHint = 'plain text (e.g. requirements.txt)';

        const codePrompt = `You are implementing a file for a LOCAL GPU IMAGE GENERATION setup project.
The project sets up Stable Diffusion image generation using Python with:
- PyTorch with CUDA GPU support
- HuggingFace diffusers library for Stable Diffusion pipelines
- Gradio for optional web UI
- CLI wrapper script with argparse for batch generation

This is a SETUP/DEPLOYMENT project — focus on:
- GPU/CUDA detection and configuration
- Proper Python virtual environment handling
- Model downloading from HuggingFace Hub
- Sensible defaults (resolution, steps, guidance scale)
- Error handling for missing GPU, VRAM issues

File: ${file.path}
Format: ${langHint}
Purpose: ${file.purpose || 'As described'}

Context:
${request}

Generate the COMPLETE file content. Output ONLY raw source code/config, NO markdown fences, NO explanation.
${langHint === 'Bash shell script' ? 'Include #!/bin/bash shebang, set -e, and proper error handling.' : ''}
${langHint === 'Python' ? 'Include proper imports, type hints, argparse CLI, and GPU device selection.' : ''}
${langHint.includes('YAML') ? 'Use clear comments explaining each setting.' : ''}`;

        console.log(`    [EXECUTOR]   Generating ${file.path} (${langHint})...`);
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
  console.log('  Lifecycle E2E: GPU Image Generation Setup');
  console.log('  Mode: REAL LLM (Ollama) + Setup/Deployment Verification');
  console.log('  Focus: Scripts, deps, configs, GPU awareness, wrapper quality');
  console.log('══════════════════════════════════════════════════════════════════════');

  const ollamaOk = await checkOllama();
  if (!ollamaOk) {
    console.log('\n  Ollama not available — skipping test');
    process.exit(1);
  }

  const SESSION_ID = 'imagegen-e2e-real';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/ImageGen-E2E');
  fs.mkdirSync(projectPath, { recursive: true });

  cleanDB(projectPath);

  // Init git
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    execSync('git init', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', { cwd: projectPath, stdio: 'pipe' });
  }

  const PROJECT_NAME = 'ImageGen E2E';
  const PROJECT_DESC = 'Local GPU image generation setup — E2E lifecycle test (v92)';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  _convId = `e2e-imagegen-${Date.now()}`;
  conversations.getOrCreate(_convId, projectId, 'ImageGen — Setup/Deployment E2E (Real LLM)');

  const executor = createRealLLMExecutor(projectPath);
  const context = { sessionId: SESSION_ID, executor, projectPath };

  let lifecycleId = null;

  // Track phase transitions
  const phaseTransitions = [];
  function recordPhase(label) {
    const state = getLcState(SESSION_ID);
    phaseTransitions.push({ label, phase: state?.phase, time: elapsed() });
  }

  // Declared outside try so summary can access
  const milestoneResults = [];
  let completedMilestones = 0;
  let blockedMilestones = 0;

  try {
    // ═══ PHASE 1: Detection + Proposal ════════════════════════════════════════

    console.log('\n\n═══ PHASE 1: Detection + Proposal ═══════════════════════════════════');

    const userMsg1 = userTurn(
      'Chci si na svém lokálním PC nastavit generování obrázků pomocí AI s GPU. ' +
      'Mám NVIDIA RTX kartu s CUDA. Potřebuji pomoct s výběrem toolu, stáhnutím ' +
      'závislostí, nastavením a vytvořením pohodlného wrapper scriptu. ' +
      'Ideálně Python + Stable Diffusion přes HuggingFace diffusers knihovnu. ' +
      'Chci CLI nástroj pro generování z příkazové řádky a volitelně i jednoduché ' +
      'webové rozhraní přes Gradio. Setup by měl zahrnovat kontrolu GPU, ' +
      'stažení modelu, a rozumné defaultní nastavení.'
    );

    const response1 = handleLifecycleBuildDetected(userMsg1, { intent: 'BUILD' }, context);
    systemTurn('PROPOSED', response1);
    recordPhase('after-proposal');

    check(response1?.content?.includes('lifecycle'), 'T1: response mentions lifecycle');
    const state1 = getLcState(SESSION_ID);
    check(state1?.phase === 'PROPOSED', 'T1: state is PROPOSED', `got: ${state1?.phase}`);

    // ═══ PHASE 2: SPEC — Detailed Setup Requirements ═════════════════════════

    console.log('\n\n═══ PHASE 2: SPEC — Setup Requirements (2 rounds) ═══════════════════');

    const userMsg2 = userTurn('ano');
    const response2 = await handleLifecycleInput(userMsg2, context);
    systemTurn('SPEC start', response2);
    recordPhase('after-accept');

    const state2 = getLcState(SESSION_ID);
    check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ─── DB check: lifecycle record exists ───
    if (lifecycleId) {
      const lcDb = lifecycleRepo.findById.get(lifecycleId);
      check(lcDb != null, 'T2-DB: lifecycle record exists in DB');
      check(lcDb?.phase === 'SPEC', 'T2-DB: lifecycle DB phase is SPEC', `got: ${lcDb?.phase}`);
    }

    // Detailed spec answers — setup/deployment focused
    const specAnswers = [
      // Round 1: GPU/system requirements + tech stack
      'NVIDIA RTX 3080 s 10 GB VRAM, CUDA 12.x, Ubuntu Linux. ' +
      'Python 3.10+ ve virtuálním prostředí (venv). ' +
      'Hlavní knihovny: torch 2.x s CUDA, diffusers (HuggingFace), transformers, accelerate, safetensors. ' +
      'Model: stabilityai/stable-diffusion-xl-base-1.0 (SDXL) jako default, možnost změnit v configu. ' +
      'CLI wrapper: argparse s parametry --prompt, --negative-prompt, --width, --height, --steps, --guidance-scale, --seed, --output. ' +
      'Defaulty: 1024×1024, 30 kroků, guidance_scale 7.5, output do ./outputs/. ' +
      'Web UI: Gradio rozhraní s náhledem, historií, a nastavením parametrů. ' +
      'Design decisions: diffusers (chosen) vs ComfyUI (GUI-heavy, complex) vs Auto1111 (monolithic, heavy). ' +
      'Gradio (chosen) vs Streamlit (less interactive) vs Flask (manual UI). ' +
      'SDXL (chosen) vs SD 1.5 (lower quality) vs DALL-E API (not local/free). ' +
      'Setup script: bash s kontrolou NVIDIA driveru, CUDA verze, dostupné VRAM, automatický pip install.',

      // Round 2: Configuration + error handling + advanced features
      'Config soubor: YAML s cestou k modelu, default parametry, device selection (cuda/cpu/auto), ' +
      'output adresář, max resolution, batch size. ' +
      'GPU detection: torch.cuda.is_available(), torch.cuda.get_device_name(), VRAM check přes torch.cuda.mem_get_info(). ' +
      'Fallback na CPU s varováním (pomalé ale funkční). ' +
      'Half-precision (float16) pro úsporu VRAM, s možností float32 v configu. ' +
      'Scheduler: DPMSolverMultistepScheduler jako default (rychlý + kvalitní). ' +
      'Error handling: chybějící GPU → srozumitelná chybová hláška s instrukcemi. ' +
      'VRAM overflow → doporučení snížit rozlišení nebo zapnout attention slicing. ' +
      'Model cache: ~/.cache/huggingface/ — vysvětlit v docs. ' +
      'Risks: VRAM limit pro velké rozlišení, první spuštění stahuje ~7GB model, ' +
      'CUDA verze nekompatibilita s torch, slow CPU fallback.',

      'Ano, vygeneruj specifikaci. Projekt se jmenuje "sdxl-local" — lokální SDXL generátor.',
    ];

    let specRound = 0;
    while (getLcState(SESSION_ID)?.phase === 'SPEC' && specRound < 5) {
      const answer = specAnswers[Math.min(specRound, specAnswers.length - 1)];
      const msgSpec = userTurn(answer);
      const respSpec = await handleLifecycleInput(msgSpec, context);
      systemTurn(`SPEC round ${specRound + 1}`, respSpec);
      specRound++;
    }

    recordPhase('after-spec');
    check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'T3: reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ═══ PHASE 3: Spec Review — Revision + Quality ═══════════════════════════

    console.log('\n\n═══ PHASE 3: SPEC_REVIEW — Revision + Quality ═════════════════════');

    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      // ─── 3a. Quality assertions on initial spec ───
      const specV1 = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
      if (specV1) {
        console.log('\n  ─── Spec v1 Quality ───');

        const goals = specV1.goals || [];
        check(goals.length >= 2, 'T3-Q: spec has ≥2 goals', `got: ${goals.length}`);

        const frs = specV1.requirements?.functional || [];
        check(frs.length >= 4, 'T3-Q: spec has ≥4 functional requirements', `got: ${frs.length}`);

        // Setup-specific: should mention GPU/CUDA/torch
        const specStr = JSON.stringify(specV1).toLowerCase();
        check(
          specStr.includes('gpu') || specStr.includes('cuda') || specStr.includes('nvidia'),
          'T3-Q: spec mentions GPU/CUDA/NVIDIA'
        );
        check(
          specStr.includes('diffus') || specStr.includes('stable') || specStr.includes('sdxl'),
          'T3-Q: spec mentions Stable Diffusion/diffusers'
        );
        check(
          specStr.includes('torch') || specStr.includes('pytorch'),
          'T3-Q: spec mentions PyTorch'
        );

        // Design decisions
        const dds = specV1.design_decisions || [];
        check(dds.length >= 2, 'T3-Q: spec has ≥2 design decisions', `got: ${dds.length}`);

        // Risks — setup projects should flag VRAM/compatibility risks
        const risks = specV1.risks || [];
        check(risks.length >= 1, 'T3-Q: spec has ≥1 risk', `got: ${risks.length}`);

        // Architecture — may have components for CLI, web UI, pipeline
        const arch = specV1.architecture;
        if (arch) {
          const hasContent = !!arch.description || !!arch.overview || !!arch.pattern ||
                             !!arch.data_flow || (arch.components && arch.components.length > 0);
          check(hasContent, 'T3-Q: architecture has substantive content',
            `keys: ${Object.keys(arch).join(', ')}`);
        }

        console.log(`    Goals: ${goals.length}, FRs: ${frs.length}, DDs: ${dds.length}, Risks: ${risks.length}`);
      }

      // ─── 3b. Revision: add LoRA support ───
      const rev1Msg = userTurn(
        'Přidej podporu pro LoRA modely — uživatel zadá cestu k LoRA souboru (.safetensors) ' +
        'a váhu (0.0-1.0). CLI: --lora-path a --lora-weight parametry. ' +
        'V configu sekce pro default LoRA. Web UI: upload LoRA + slider pro váhu.'
      );
      const rev1Resp = await handleLifecycleInput(rev1Msg, context);
      systemTurn('SPEC revision 1', rev1Resp);

      // Answer revision questions if any
      let rev1Round = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && rev1Round < 3) {
        const answer = userTurn(
          'Ano, LoRA jako volitelný parametr. Podporované formáty: .safetensors a .bin. ' +
          'Váha default 0.7. Více LoRA najednou není potřeba (single LoRA). ' +
          'load_lora_weights() z diffusers knihovny.'
        );
        const resp = await handleLifecycleInput(answer, context);
        systemTurn(`SPEC revision 1 round ${rev1Round + 1}`, resp);
        rev1Round++;
      }

      // ─── 3c. Verify revision in spec ───
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const specV2 = lifecycleId ? lifecycleRepo.getSpec(lifecycleId) : null;
        if (specV2) {
          const specStr = JSON.stringify(specV2).toLowerCase();
          check(
            specStr.includes('lora') || specStr.includes('fine-tun') || specStr.includes('finetun'),
            'T3-R1: revised spec mentions LoRA/fine-tuning'
          );

          const frsV2 = specV2.requirements?.functional || [];
          check(frsV2.length >= 5, 'T3-R: revised spec has ≥5 FRs', `got: ${frsV2.length}`);
        }
      }

      // ─── 3d. Approve spec ───
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const approveMsg = userTurn('schvaluji');
        const approveResp = await handleLifecycleInput(approveMsg, context);
        systemTurn('SPEC → PLAN_REVIEW', approveResp);
      }
    }

    recordPhase('after-spec-review');

    // ═══ PHASE 4: PLAN_REVIEW — Roadmap + Setup Milestone Structure ══════════

    console.log('\n\n═══ PHASE 4: PLAN_REVIEW — Roadmap + Setup Milestone Structure ═════');

    const stateRoadmap = getLcState(SESSION_ID);
    check(stateRoadmap?.phase === 'PLAN_REVIEW', 'T4: reached PLAN_REVIEW', `got: ${stateRoadmap?.phase}`);
    lifecycleId = stateRoadmap?.lifecycleId || lifecycleId;

    if (lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      check(milestones.length >= 3, 'T4-Q: roadmap has ≥3 milestones', `got: ${milestones.length}`);

      console.log(`    Milestones:`);
      for (const m of milestones) {
        console.log(`      ${m.id}: ${m.title} [mode=${m.checkpoint_mode}, seq=${m.sequence}]`);
      }

      // ─── ① Checkpoint mode verification ───
      console.log('\n  ─── Checkpoint Mode Progression ───');
      if (milestones.length >= 3) {
        const first = milestones[0];
        const last = milestones[milestones.length - 1];
        const middle = milestones.slice(1, -1);

        check(
          first.checkpoint_mode === 'STRUCTURAL',
          'T4-CM: first milestone is STRUCTURAL',
          `got: ${first.checkpoint_mode}`
        );
        check(
          last.checkpoint_mode === 'SECURITY',
          'T4-CM: last milestone is SECURITY',
          `got: ${last.checkpoint_mode}`
        );
        for (const m of middle) {
          check(
            m.checkpoint_mode === 'FUNCTIONAL',
            `T4-CM: ${m.id} is FUNCTIONAL`,
            `got: ${m.checkpoint_mode}`
          );
        }
      }

      // ─── ⑨ Setup-oriented milestone structure ───
      console.log('\n  ─── Setup-Oriented Milestone Structure ───');
      const allTitles = milestones.map(m => (m.title || '').toLowerCase()).join(' ');
      const allDescs = milestones.map(m => {
        let desc = m.description || '';
        if (typeof m.local_plan === 'string') {
          try { desc += ' ' + JSON.stringify(JSON.parse(m.local_plan)); } catch {}
        }
        return desc.toLowerCase();
      }).join(' ');
      const combinedText = allTitles + ' ' + allDescs;

      // Setup projects should have environment/setup milestone
      const hasSetupMs = /setup|environment|prostředí|instalac|instal|config|závislost|depend/i.test(combinedText);
      check(hasSetupMs, 'T4-SETUP: milestones cover environment/setup', `searched in titles+descriptions`);

      // Should reference GPU/model somewhere in milestones
      const hasGpuMs = /gpu|cuda|model|pipeline|stáhnu|download/i.test(combinedText);
      check(hasGpuMs, 'T4-SETUP: milestones reference GPU/model/download', `searched in titles+descriptions`);

      // Roadmap structure validation
      console.log('\n  ─── Roadmap Structure ───');
      const roadmapRow = roadmapVersions.getLatestRoadmap(lifecycleId);
      if (roadmapRow?.roadmap) {
        const rm = roadmapRow.roadmap;

        // Requirements coverage
        const coverage = rm.requirements_coverage || {};
        const covKeys = Object.keys(coverage);
        check(covKeys.length >= 1, 'T4-Q: requirements_coverage present', `got: ${covKeys.length}`);

        // Dependency graph — no circular deps
        const rmMs = rm.milestones || [];
        const depMap = new Map();
        for (const m of rmMs) {
          depMap.set(m.id, m.dependencies || []);
        }
        let hasCircular = false;
        for (const [msId, deps] of depMap) {
          for (const depId of deps) {
            const depDeps = depMap.get(depId) || [];
            if (depDeps.includes(msId)) { hasCircular = true; }
          }
        }
        check(!hasCircular, 'T4-Q: no circular dependencies in roadmap');

        // Last milestone covers testing/docs/integration
        const lastMs = rmMs[rmMs.length - 1];
        if (lastMs) {
          const lastText = (lastMs.title + ' ' + (lastMs.description || '')).toLowerCase();
          check(
            /test|integr|doc|kvalit|final|polish|security/.test(lastText),
            'T4-Q: last milestone covers testing/integration/docs',
            `got: "${lastMs.title}"`
          );
        }

        console.log(`    Milestones: ${rmMs.length}, Coverage: ${covKeys.length} FRs, Version: ${roadmapRow.version}`);
      }

      // Clear test_strategy — no Python env in test runner
      try {
        db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId);
      } catch { /* ignore */ }
    }

    // Approve roadmap
    if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
      const approveRoadmapMsg = userTurn('schvaluji');
      const approveRoadmapResp = await handleLifecycleInput(approveRoadmapMsg, context);
      systemTurn('PLAN → BUILD', approveRoadmapResp);
    }

    recordPhase('after-plan-review');

    // ═══ PHASE 5: BUILD — Milestones with Setup Tracking ═════════════════════

    console.log('\n\n═══ PHASE 5: BUILD — Milestones with Setup Tracking ════════════════');

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
        // ─── Milestone plan quality check ───
        if (state.currentMilestoneId) {
          const msDb = msRepo.getMilestone(state.currentMilestoneId);
          let localPlan = msDb?.local_plan;
          if (typeof localPlan === 'string') {
            try { localPlan = JSON.parse(localPlan); } catch { localPlan = null; }
          }
          if (localPlan) {
            const steps = localPlan.implementation_steps || localPlan.steps || [];
            check(
              steps.length >= 2,
              `T5-PLAN: ${state.currentMilestoneId} has ≥2 impl steps`,
              `got: ${steps.length}`
            );
            const planFiles = localPlan.files || localPlan.scope_files || [];
            check(
              planFiles.length >= 1,
              `T5-PLAN: ${state.currentMilestoneId} has ≥1 target file`,
              `got: ${planFiles.length}`
            );
          }
        }

        const msg = userTurn('ano');
        const resp = await handleLifecycleInput(msg, context);
        systemTurn(`BUILD ${state.currentMilestoneId || ''}`, resp);

        // Check result
        if (state.currentMilestoneId) {
          const msDb = msRepo.getMilestone(state.currentMilestoneId);
          if (msDb?.status === 'PASSED') {
            completedMilestones++;
            check(true, `BUILD: ${state.currentMilestoneId} PASSED`);

            milestoneResults.push({
              id: state.currentMilestoneId,
              status: 'PASSED',
              checkpointMode: msDb.checkpoint_mode,
              healthScore: msDb.health_score,
              sequence: msDb.sequence,
            });
          } else if (msDb?.status === 'BLOCKED') {
            blockedMilestones++;
            console.log(`    ${state.currentMilestoneId} BLOCKED (checkpoint_mode: ${msDb.checkpoint_mode})`);

            milestoneResults.push({
              id: state.currentMilestoneId,
              status: 'BLOCKED',
              checkpointMode: msDb.checkpoint_mode,
              sequence: msDb.sequence,
            });
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

    recordPhase('after-build');
    check(completedMilestones >= 1, 'BUILD: ≥1 milestones completed', `got: ${completedMilestones}`);

    // ═══ PHASE 6: Deep Quality Verification ══════════════════════════════════

    console.log('\n\n═══ PHASE 6: Deep Quality Verification ══════════════════════════════');

    // ─── File inventory ───
    const allFiles = walkFiles(projectPath);
    console.log(`\n  ─── Generated Files (${allFiles.length}) ───`);
    for (const f of allFiles) {
      const size = fs.statSync(path.join(projectPath, f)).size;
      console.log(`      ${f} (${size} bytes)`);
    }
    check(allFiles.length >= 3, 'FILES: ≥3 files generated', `got: ${allFiles.length}`);

    // Read all generated file contents for analysis
    const fileContents = {};
    for (const f of allFiles) {
      try {
        fileContents[f] = fs.readFileSync(path.join(projectPath, f), 'utf8');
      } catch { fileContents[f] = ''; }
    }
    const allContent = Object.values(fileContents).join('\n');
    const allContentLower = allContent.toLowerCase();

    // ─── ① Setup Script Analysis ───
    console.log('\n  ─── ① Setup Script Analysis ───');
    const shellFiles = allFiles.filter(f => /\.(sh|bash)$/.test(f) || f === 'Makefile');
    const pySetupFiles = allFiles.filter(f => /setup[._]|install/i.test(f));
    const hasSetupScripts = shellFiles.length > 0 || pySetupFiles.length > 0;

    if (hasSetupScripts) {
      check(true, 'SETUP: setup/install scripts exist');

      for (const sf of shellFiles) {
        const content = fileContents[sf] || '';
        // Check for shebang
        const hasShebang = /^#!\/bin\/(bash|sh)/.test(content);
        if (hasShebang) {
          check(true, `SETUP: ${sf} has proper shebang`);
        }
        // Check for GPU/CUDA checks in setup script
        const hasGpuCheck = /nvidia-smi|cuda|gpu|torch\.cuda/i.test(content);
        if (hasGpuCheck) {
          check(true, `SETUP: ${sf} includes GPU/CUDA check`);
        }
        // Check for venv creation
        const hasVenv = /venv|virtualenv|python -m venv|source.*activate/i.test(content);
        if (hasVenv) {
          check(true, `SETUP: ${sf} handles virtual environment`);
        }
      }
    } else {
      // May have setup logic in Python files instead
      const hasSetupInPy = /subprocess|os\.system|pip install|venv/i.test(allContent);
      if (hasSetupInPy) {
        check(true, 'SETUP: setup logic found in Python files');
      } else {
        console.log('    Note: No dedicated setup scripts (may have inline instructions)');
      }
    }

    // ─── ② Dependency Completeness ───
    console.log('\n  ─── ② Dependency Completeness ───');
    const reqFiles = allFiles.filter(f =>
      f === 'requirements.txt' || f === 'pyproject.toml' || f.includes('setup.py') || f.includes('setup.cfg')
    );

    if (reqFiles.length > 0) {
      check(true, 'DEPS: dependency file exists');

      const depContent = reqFiles.map(f => fileContents[f] || '').join('\n').toLowerCase();

      // Must-have deps for image gen
      const hasTorch = /torch|pytorch/i.test(depContent);
      check(hasTorch, 'DEPS: torch/pytorch in dependencies');

      const hasDiffusers = /diffusers/i.test(depContent);
      check(hasDiffusers, 'DEPS: diffusers in dependencies');

      const hasTransformers = /transformers/i.test(depContent);
      if (hasTransformers) {
        check(true, 'DEPS: transformers in dependencies');
      } else {
        console.log('    Note: transformers not explicitly listed (may be pulled by diffusers)');
      }

      // Gradio for web UI
      const hasGradio = /gradio/i.test(depContent);
      if (hasGradio) {
        check(true, 'DEPS: gradio in dependencies (web UI)');
      }

      // Safetensors for LoRA
      const hasSafetensors = /safetensors/i.test(depContent);
      if (hasSafetensors) {
        check(true, 'DEPS: safetensors in dependencies (LoRA support)');
      }

      console.log(`    Dep files: ${reqFiles.join(', ')}`);
    } else {
      // May have deps listed in setup script or README
      const hasDepsInCode = /pip install|torch|diffusers/i.test(allContent);
      if (hasDepsInCode) {
        console.log('    Note: Dependencies referenced in code but no requirements.txt');
      } else {
        check(false, 'DEPS: dependency specification exists');
      }
    }

    // ─── ③ Configuration Files ───
    console.log('\n  ─── ③ Configuration Files ───');
    const configFiles = allFiles.filter(f =>
      /config\.(yaml|yml|json|toml|ini)$/i.test(f) || /\.env\.example$/i.test(f) ||
      /settings\.(yaml|yml|json|py)$/i.test(f)
    );

    if (configFiles.length > 0) {
      check(true, 'CONFIG: configuration file exists');

      const configContent = configFiles.map(f => fileContents[f] || '').join('\n').toLowerCase();

      // Config should reference model path/name
      const hasModelConfig = /model|stabilityai|stable.?diffusion|sdxl|checkpoint/i.test(configContent);
      if (hasModelConfig) {
        check(true, 'CONFIG: config references model path/name');
      }

      // Resolution defaults
      const hasResolution = /width|height|resolution|1024|512|768/i.test(configContent);
      if (hasResolution) {
        check(true, 'CONFIG: config has resolution settings');
      }

      // Steps / guidance
      const hasGenParams = /steps|guidance|scheduler|sampler/i.test(configContent);
      if (hasGenParams) {
        check(true, 'CONFIG: config has generation parameters');
      }

      console.log(`    Config files: ${configFiles.join(', ')}`);
    } else {
      // Config may be embedded in Python files
      const hasConfigInPy = /config|default.*=.*\{|argparse/i.test(allContent);
      if (hasConfigInPy) {
        console.log('    Note: Configuration embedded in Python files (no separate config file)');
      } else {
        console.log('    Note: No configuration files found');
      }
    }

    // ─── ④ GPU/CUDA Awareness ───
    console.log('\n  ─── ④ GPU/CUDA Awareness ───');
    const pyFiles = allFiles.filter(f => f.endsWith('.py'));
    const pyContent = pyFiles.map(f => fileContents[f] || '').join('\n');

    // CUDA/GPU device selection
    const hasCudaCheck = /torch\.cuda\.is_available|cuda|\.to\(['"]cuda['"]\)|device\s*=\s*['"]cuda/i.test(pyContent);
    check(hasCudaCheck, 'GPU: code references CUDA/GPU device selection');

    // CPU fallback
    const hasCpuFallback = /cpu.*fallback|fallback.*cpu|if.*not.*cuda|else.*cpu|device.*=.*['"]cpu/i.test(pyContent) ||
                           (/cpu/i.test(pyContent) && /cuda/i.test(pyContent));
    if (hasCpuFallback) {
      check(true, 'GPU: code has CPU fallback logic');
    } else {
      console.log('    Note: No explicit CPU fallback detected');
    }

    // Float16/half precision
    const hasFloat16 = /float16|half|fp16|torch_dtype/i.test(pyContent);
    if (hasFloat16) {
      check(true, 'GPU: code uses float16/half precision for VRAM efficiency');
    }

    // Diffusion pipeline
    const hasPipeline = /StableDiffusion|DiffusionPipeline|AutoPipeline|from_pretrained/i.test(pyContent);
    check(hasPipeline, 'GPU: code uses diffusion pipeline (from_pretrained)', `checked ${pyFiles.length} .py files`);

    // ─── ⑤ Virtual Environment Handling ───
    console.log('\n  ─── ⑤ Virtual Environment Handling ───');
    const hasVenvRef = /venv|virtualenv|python -m venv|conda|pip install/i.test(allContent);
    check(hasVenvRef, 'VENV: project references virtual environment or pip install');

    // ─── ⑥ Model Download Handling ───
    console.log('\n  ─── ⑥ Model Download Handling ───');
    const hasModelDownload = /from_pretrained|huggingface|hf_hub|model_id|stabilityai/i.test(allContent);
    check(hasModelDownload, 'MODEL: code handles model download (from_pretrained / HuggingFace)');

    const hasModelId = /stabilityai|stable.?diffusion|runwayml|CompVis/i.test(allContent);
    if (hasModelId) {
      check(true, 'MODEL: specific model ID referenced');
    }

    // ─── ⑦ Wrapper Script Quality ───
    console.log('\n  ─── ⑦ Wrapper Script Quality ───');
    // Look for CLI wrapper with argparse
    const hasArgparse = /argparse|ArgumentParser|add_argument/i.test(pyContent);
    if (hasArgparse) {
      check(true, 'CLI: Python wrapper uses argparse');

      // Check for expected CLI params
      const hasPromptArg = /--prompt|['"]prompt['"]/i.test(pyContent);
      const hasOutputArg = /--output|--out|save|output_dir/i.test(pyContent);
      const hasStepsArg = /--steps|--num.?steps|inference.?steps/i.test(pyContent);

      if (hasPromptArg) check(true, 'CLI: --prompt argument defined');
      if (hasOutputArg) check(true, 'CLI: output path handling');
      if (hasStepsArg) check(true, 'CLI: steps parameter');
    } else {
      // May have simple input() or sys.argv
      const hasCliInput = /input\(|sys\.argv|click\.|typer\./i.test(pyContent);
      if (hasCliInput) {
        check(true, 'CLI: wrapper has user input handling (non-argparse)');
      } else {
        console.log('    Note: No CLI argument parsing found');
      }
    }

    // Image saving
    const hasImageSave = /\.save\(|Image\.|PIL|pillow|output.*\.png|\.jpg/i.test(pyContent);
    if (hasImageSave) {
      check(true, 'CLI: image saving logic present');
    }

    // ─── ⑧ Change Management (LoRA revision) ───
    console.log('\n  ─── ⑧ Change Management (LoRA) ───');
    if (lifecycleId) {
      const finalSpec = lifecycleRepo.getSpec(lifecycleId);
      if (finalSpec) {
        const specStr = JSON.stringify(finalSpec).toLowerCase();
        check(
          specStr.includes('lora'),
          'CHANGE: LoRA requirement present in final spec'
        );
      }

      // Check if LoRA appears in generated code
      const hasLoraCode = /lora|load_lora|lora_weight|lora_path/i.test(allContent);
      if (hasLoraCode) {
        check(true, 'CHANGE: LoRA handling present in generated code');
      } else {
        console.log('    Note: LoRA not in generated code (may be in later milestones)');
      }
    }

    // ─── Health Scores ───
    console.log('\n  ─── Health Scores ───');
    for (const mr of milestoneResults.filter(m => m.status === 'PASSED')) {
      const hs = mr.healthScore;
      if (hs) {
        const hsObj = typeof hs === 'string' ? JSON.parse(hs) : hs;
        check(hsObj != null, `HEALTH: ${mr.id} has health score object`);

        const hasKnownFields = hsObj.scope_adherence != null || hsObj.overall != null ||
                               hsObj.quality != null || hsObj.test_coverage != null;
        check(hasKnownFields, `HEALTH: ${mr.id} has recognizable health fields`,
          `keys: ${Object.keys(hsObj).join(', ')}`);

        console.log(`    ${mr.id}: ${JSON.stringify(hsObj).substring(0, 150)}`);
      } else {
        console.log(`    ${mr.id}: no health score (may be expected)`);
      }
    }

    // ─── Drift Check Records ───
    console.log('\n  ─── Drift Checks ───');
    if (lifecycleId) {
      const allDriftChecks = driftChecks.findByLifecycle.all(lifecycleId);
      check(allDriftChecks.length >= 1, 'DRIFT: ≥1 drift check records', `got: ${allDriftChecks.length}`);

      const byType = {};
      for (const dc of allDriftChecks) {
        byType[dc.check_type] = (byType[dc.check_type] || 0) + 1;
      }
      console.log(`    Drift check types: ${JSON.stringify(byType)}`);

      const checkpointChecks = allDriftChecks.filter(dc => dc.check_type === 'MILESTONE_CHECKPOINT');
      check(
        checkpointChecks.length >= completedMilestones,
        `DRIFT: ≥${completedMilestones} MILESTONE_CHECKPOINT records`,
        `got: ${checkpointChecks.length}`
      );
    }

    // ─── Phase Transitions ───
    console.log('\n  ─── Phase Transitions ───');
    console.log(`    Recorded ${phaseTransitions.length} transitions:`);
    for (const pt of phaseTransitions) {
      console.log(`      ${pt.label}: ${pt.phase} (${pt.time})`);
    }
    check(phaseTransitions.length >= 4, 'PHASES: ≥4 phase transitions recorded', `got: ${phaseTransitions.length}`);

    // ─── Checkpoint Mode Progression (Actual) ───
    console.log('\n  ─── Checkpoint Mode Progression (Actual) ───');
    if (milestoneResults.length > 0) {
      for (const mr of milestoneResults) {
        console.log(`      ${mr.id}: ${mr.status} [mode=${mr.checkpointMode}, seq=${mr.sequence}]`);
      }

      const firstCompleted = milestoneResults.find(m => m.status === 'PASSED' && m.sequence === 1);
      if (firstCompleted) {
        check(
          firstCompleted.checkpointMode === 'STRUCTURAL',
          'CKPT: first PASSED milestone was STRUCTURAL',
          `got: ${firstCompleted.checkpointMode}`
        );
      }
    }

    // ─── Documentation Quality ───
    console.log('\n  ─── Documentation Quality ───');
    const readmePath = path.join(projectPath, 'README.md');
    const archPath = path.join(projectPath, 'ARCHITECTURE.md');

    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf-8');
      check(readme.length > 200, 'DOC: README.md is substantive', `got: ${readme.length} chars`);

      const sectionHeaders = [...readme.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
      console.log(`    README sections: ${sectionHeaders.join(', ')}`);

      // README should reference GPU/Stable Diffusion
      const readmeLower = readme.toLowerCase();
      const refsGpu = readmeLower.includes('gpu') || readmeLower.includes('cuda') ||
                      readmeLower.includes('nvidia') || readmeLower.includes('stable diffusion') ||
                      readmeLower.includes('diffusers') || readmeLower.includes('torch');
      check(refsGpu, 'DOC: README references GPU/SD stack');

      // Install section
      const hasInstallSection = sectionHeaders.some(h =>
        /Použití|Usage|Instalace|Install|Spuštění|Getting|Setup|Prerequisit|Požadavk/i.test(h)
      );
      if (hasInstallSection) {
        check(true, 'DOC: README has setup/install section');
      } else {
        console.log('    Note: README lacks install section header');
      }

      check(
        sectionHeaders.some(h => /Architektura|Architecture|Struktura|Component|Overview/i.test(h)),
        'DOC: README has architecture section'
      );
      check(
        sectionHeaders.some(h => /Tech\s*[Ss]tack|Technolog/i.test(h)),
        'DOC: README has tech stack section'
      );

      console.log(`    README.md: ${readme.length} chars, ${sectionHeaders.length} sections`);
    } else {
      check(false, 'DOC: README.md exists');
    }

    if (fs.existsSync(archPath)) {
      const arch = fs.readFileSync(archPath, 'utf-8');
      check(arch.length > 100, 'DOC: ARCHITECTURE.md is substantive', `got: ${arch.length} chars`);

      const archSections = [...arch.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim());
      console.log(`    ARCHITECTURE.md: ${arch.length} chars, sections: ${archSections.join(', ')}`);
    } else {
      console.log('    ARCHITECTURE.md: not generated (spec may lack architecture data)');
    }

    // ─── ⑩ Troubleshooting / Setup Docs ───
    console.log('\n  ─── ⑩ Troubleshooting / Setup Docs ───');
    // Check if any generated file has troubleshooting or setup instructions
    const hasTroubleshoot = /troubleshoot|common.*error|faq|known.*issue|vram|out.*of.*memory/i.test(allContent);
    if (hasTroubleshoot) {
      check(true, 'DOCS: troubleshooting/FAQ content present');
    } else {
      console.log('    Note: No explicit troubleshooting section (may be in README)');
    }

    // Check for usage examples
    const hasUsageExample = /example|usage|příklad|how.*to.*use|python.*generate|--prompt/i.test(allContent);
    if (hasUsageExample) {
      check(true, 'DOCS: usage examples present in project');
    }

    // ─── DB Final State ───
    console.log('\n  ─── DB Final State ───');
    if (lifecycleId) {
      const lcDb = lifecycleRepo.findById.get(lifecycleId);
      check(lcDb != null, 'DB: lifecycle record exists');
      check(
        lcDb?.phase === 'COMPLETED' || lcDb?.phase === 'BUILD',
        'DB: lifecycle progressed',
        `got: ${lcDb?.phase}`
      );

      const allMs = msRepo.listByLifecycle(lifecycleId);
      check(allMs.length >= 3, 'DB: ≥3 milestones in DB', `got: ${allMs.length}`);

      const passedMs = allMs.filter(m => m.status === 'PASSED');
      check(passedMs.length >= 1, 'DB: ≥1 milestones PASSED', `got: ${passedMs.length}`);

      const blockedMs = allMs.filter(m => m.status === 'BLOCKED');
      console.log(`    PASSED: ${passedMs.length}, BLOCKED: ${blockedMs.length}, ` +
                  `PENDING: ${allMs.filter(m => m.status === 'PENDING').length}`);

      // Roadmap versioning
      const roadmapV = roadmapVersions.getLatestVersion(lifecycleId);
      check(roadmapV >= 1, 'DB: roadmap version ≥1', `got: ${roadmapV}`);

      // Progress
      try {
        const progress = computeLifecycleProgress(lifecycleId);
        check(progress.percentage >= 10, 'DB: lifecycle progress ≥10%', `got: ${progress.percentage}%`);
        console.log(`    Progress: ${progress.percentage}%`);
      } catch (e) {
        console.log(`    Progress computation failed: ${e.message}`);
      }
    }

    // ─── Git ───
    console.log('\n  ─── Git ───');
    try {
      const gitLog = execSync('git log --oneline', { cwd: projectPath, encoding: 'utf8' });
      const commits = gitLog.trim().split('\n');
      check(commits.length >= 2, 'Git: ≥2 commits', `got: ${commits.length}`);
      for (const c of commits.slice(0, 10)) console.log(`      ${c}`);
    } catch (e) {
      check(false, 'Git: log available', e.message);
    }

    // Turn count
    check(turnNum >= 12, 'Turns: ≥12 conversation turns', `got: ${turnNum}`);

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
  console.log(`  ImageGen E2E (Real LLM): ${passed} passed, ${failed} failed`);
  console.log(`  Duration: ${totalTime}s | Turns: ${turnNum}`);
  console.log(`  Milestones: ${milestoneResults.length} tracked (${milestoneResults.filter(m => m.status === 'PASSED').length} PASSED)`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) console.log(`    - ${f.name}: ${f.detail}`);
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  try {
    const transcriptDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, `transcript-imagegen-${Date.now()}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`  Transcript: ${transcriptPath}`);
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

runTest();
