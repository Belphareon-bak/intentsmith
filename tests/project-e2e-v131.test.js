// Project E2E Tests v131 — 3 Complex Projects (Real LLM)
// PA: Mobile-to-PC Agent (plan-only verification)
// PB: NAS Duplicate Finder (full product)
// PC: MidPoint Jira Assets Connector (full product)
// Run: node tests/project-e2e-v131.test.js [a|b|c|all]

import fs from 'fs';
import path from 'path';

import {
  TestRunner, checkOllama, createExecutor, cleanDB, initProjectDir, walkFiles, buildLoop, specLoop, runTests,
  allTranscripts, totalPassed, totalFailed, allFailures, globalStart, elapsed,
  ProjectPhase, MilestoneStatus, CheckpointMode,
  getBuildProgress, computeLifecycleProgress, formatMilestoneTable,
  lifecycleRepo, msRepo, roadmapVersions, crRepo, driftChecks,
  projects, conversations, messagesRepo, lifecycleHandoffState, db,
  handleLifecycleBuildDetected, handleLifecycleInput,
  getLcState, setLcState, clearLcState, initLifecycleStateDb,
  callLLM,
  // v134: Validation utilities
  validateProjectSyntax, validateProjectSemantics,
  checkFileSubstantive, detectProjectMocks, validateJsImportResolution,
  extractJsExports,
} from './e2e-harness.js';


// ═════════════════════════════════════════════════════════════════════════════
// PA: Mobile-to-PC Agent — Plan-Only Verification
// Architecture: mobile → AI agent → desktop agent → result back to mobile
// ═════════════════════════════════════════════════════════════════════════════

async function testPA_MobileAgent() {
  const t = new TestRunner('PA: Mobile-to-PC Agent');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  PA: Mobile-to-PC AI Agent (Plan Verification Only)               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'pa-mobile-agent-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/PA-MobileAgent-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'Mobile-to-PC Agent E2E';
  const PROJECT_DESC = 'AI agent bridging mobile tasks to desktop execution — plan verification';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-pa-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'PA — Plan Verification (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js + Python + React Native');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Initial build request — detailed architecture vision ──
    const msg1 = t.userTurn(
      'Chci vytvořit systém, kde z mobilního telefonu budu moct zadávat úkoly AI agentovi, ' +
      'který běží na mém PC doma. Princip je jednoduchý:\n\n' +
      '1) Na mobilu mám appku (React Native), která se připojí na backend na PC\n' +
      '2) Zadám úkol v přirozeném jazyce — např. "najdi v mých dokumentech fakturu od O2 z ledna"\n' +
      '3) AI agent na PC naplánuje kroky (rozumění úkolu, dekompozice na akce)\n' +
      '4) Desktop agent vykonává — přistupuje k souborům, spouští příkazy, ovládá GUI\n' +
      '5) Výsledek se vrátí na mobil jako notifikace s odpovědí\n\n' +
      'DŮLEŽITÉ: mobilní app a PC backend NEJSOU oddělené entity, které se musí složitě dorozumívat. ' +
      'Mobil je jen tenký klient — veškerá logika běží na PC. Komunikace přes WebSocket, ' +
      'backend na PC exposed přes Tailscale/WireGuard VPN (žádný cloud). ' +
      'Desktop agent má 3 úrovně: 1) přímý API/filesystem přístup, ' +
      '2) shell příkazy, 3) GUI automatizace (screenshot + mouse/keyboard jako fallback). ' +
      'Celé v Node.js backend + Python pro AI/LLM integraci (Ollama local), ' +
      'React Native mobilní klient.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: entered SPEC phase', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-8: Detailed spec with pushback and constraints ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Architecture details + security
      'Detailnější architektura:\n' +
      '- Backend (Node.js, port 8420): WebSocket server + REST API pro stav. ' +
      'Autentizace přes pre-shared token (generovaný při prvním spárování). ' +
      'Rate limiting na 10 req/min per token.\n' +
      '- AI Engine (Python): FastAPI microservice na portu 8421, komunikuje s backendem přes HTTP. ' +
      'Používá Ollama (local LLM) pro rozumění úkolům a plánování. ' +
      'Task decomposition: úkol → list kroků → execution plan.\n' +
      '- Desktop Agent (Node.js): Executor modul s 3 vrstvami:\n' +
      '  L1: FileSystem + API (fs.readdir, fs.readFile, http requests)\n' +
      '  L2: Shell (child_process.exec s timeoutem 30s, sandbox přes firejail)\n' +
      '  L3: GUI automation (screenshot via xdotool/scrot, OCR přes tesseract, mouse/kbd events)\n' +
      '- Mobile (React Native): Minimální UI — chat interface, task list, notifications. ' +
      'Push notifikace přes Firebase Cloud Messaging nebo lokální WebSocket.\n' +
      '- Networking: Tailscale VPN mesh — mobil i PC ve stejné síti, bez port forwarding.',

      // Round 2: Pushback on complexity + task examples
      'Pozor — nechci overengineerovat. Nechci microservices orchestration, nechci Kubernetes, ' +
      'nechci message queue. Jednoduché řešení:\n' +
      '- Jeden Node.js process pro backend + desktop agent (ne oddělené služby)\n' +
      '- Python AI engine jako subprocess spouštěný z Node.js (ne separátní FastAPI server)\n' +
      '  → komunikace přes stdin/stdout JSON-RPC, ne HTTP\n' +
      '- Příklady úkolů, které musí zvládnout:\n' +
      '  "Najdi fakturu od O2 z ledna" → L1 (filesystem search)\n' +
      '  "Spusť backup script" → L2 (shell execution)\n' +
      '  "Otevři Chrome a jdi na mail" → L3 (GUI automation)\n' +
      '  "Kolik mám volného místa na disku?" → L2 (df -h)\n' +
      '  "Pošli email Petrovi s přílohou report.pdf" → L3 (GUI) nebo L1 (sendmail API)\n' +
      '- Každý task má stav: PENDING → PLANNING → EXECUTING → DONE/FAILED\n' +
      '- History: SQLite databáze s historií úkolů a výsledků.',

      // Round 3: Security model + constraints
      'Bezpečnostní model je kritický:\n' +
      '- NIKDY automaticky nespouštět destruktivní příkazy (rm -rf, format, dd)\n' +
      '- Whitelist povolených operací pro L2 (shell) — default: read-only\n' +
      '- L3 (GUI) vyžaduje explicitní souhlas uživatele na mobilu před každou akcí\n' +
      '- Konfigurace v YAML: allowed_paths (kde smí agent číst/psát), ' +
      'blocked_commands (seznam zakázaných příkazů), gui_auto_approve (true/false)\n' +
      '- Audit log: každá akce se loguje s timestampem, inputem a outputem\n' +
      '- Pairing: QR kód na PC → sken mobilem → exchange pre-shared key\n' +
      '- Token rotation: každých 30 dní nový token, graceful transition (starý platí ještě 24h)\n\n' +
      'Generuj specifikaci.',

      // Round 4: Technology decisions
      'Rozhodnutí o technologiích:\n' +
      '- Node.js 22+ (backend + desktop agent) — alt: Go, Rust, Python-only\n' +
      '- Python 3.11+ (AI engine, subprocess) — alt: Node.js LLM bindings, Rust\n' +
      '- React Native (mobil) — alt: Flutter, native Swift/Kotlin, PWA\n' +
      '- SQLite (task history, audit log) — alt: PostgreSQL, JSON files\n' +
      '- Ollama (local LLM) — alt: llama.cpp direct, vLLM, cloud API\n' +
      '- Tailscale (networking) — alt: WireGuard manual, Cloudflare Tunnel, ngrok\n' +
      '- xdotool + scrot (GUI automation) — alt: PyAutoGUI, Puppeteer, AT-SPI\n' +
      '- WebSocket (real-time comms) — alt: SSE, long-polling, gRPC\n\n' +
      'Architecture: monorepo — server/ (Node.js), ai/ (Python), mobile/ (React Native). ' +
      'Shared: protocol/ (JSON-RPC message types, TypeScript interfaces).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'Reached SPEC_REVIEW',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Spec revision: add task queue + offline mode ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgRev = t.userTurn(
        'Ještě dvě důležité věci:\n' +
        '1) Task queue — když zadám víc úkolů najednou, agent je řadí do fronty (FIFO). ' +
        'Priorita: urgent (přeskoč frontu), normal (FIFO), low (až bude čas). ' +
        'Můžu z mobilu měnit prioritu nebo cancelovat task v queue.\n' +
        '2) Offline resilience — když ztratím WiFi/VPN spojení, úkoly se uloží lokálně ' +
        'na mobilu a pošlou se při reconnectu. Agent na PC při disconnectu dokončí ' +
        'aktuální task ale nezačíná nový. Heartbeat: ping každých 15s, disconnect po 3 missed.'
      );
      const respRev = await handleLifecycleInput(msgRev, context);
      t.systemTurn('SPEC revision', respRev);

      // Answer follow-up if needed
      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 3) {
        const msg = t.userTurn(
          'Task queue je in-memory (backed SQLite pro persistence). ' +
          'Max queue depth: 50 tasks. Stale detection: task older than 1h auto-cancel. ' +
          'Offline buffer na mobilu: AsyncStorage, max 20 queued tasks.'
        );
        const resp = await handleLifecycleInput(msg, context);
        t.systemTurn(`SPEC revision round ${revRound + 1}`, resp);
        revRound++;
      }

      // Approve spec
      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('SPEC → PLAN', respApprove);
      }
    }

    // ── Retry planning if stuck ──
    let planRetries = 0;
    while (getLcState(SESSION_ID)?.phase === 'PLANNING' && planRetries < 3) {
      planRetries++;
      console.log(`    [Planning retry ${planRetries}] D1 roadmap generation failed — retrying`);
      const msg = t.userTurn('pokračovat');
      const resp = await handleLifecycleInput(msg, context);
      t.systemTurn(`PLANNING retry ${planRetries}`, resp);
    }

    // ── Plan review — THIS IS THE KEY PART: evaluate plan quality ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 4, 'Roadmap ≥4 milestones (complex project)', `got: ${milestones.length}`);

      // ── Quality assessment of the plan ──
      console.log('\n  ═══ PLAN QUALITY ASSESSMENT ═══');

      // Check milestone structure (note: files are generated at BUILD-time, not PLAN)
      for (const ms of milestones) {
        const plan = typeof ms.local_plan === 'string' ? JSON.parse(ms.local_plan || '{}') : (ms.local_plan || {});
        const files = plan.files || [];
        const scopeFiles = ms.scope_files || '';
        const hasStructure = files.length > 0 || scopeFiles.length > 0 || (ms.description || '').length > 30;
        console.log(`  [${ms.id}] ${ms.title || ms.id}`);
        console.log(`    Files: ${files.length}, Scope: ${scopeFiles || '-'}`);
        console.log(`    Description: ${(ms.description || '').slice(0, 120)}...`);

        t.check(hasStructure, `${ms.id}: has plan content (files/scope/description)`);
        t.check((ms.title || ms.description || '').length > 10, `${ms.id}: has meaningful description`);
      }

      // Verify plan covers key architecture components (check milestones + lifecycle spec)
      const lcRecord = lifecycleRepo.findById.get(lifecycleId);
      const specText = lcRecord?.spec_json || '';
      const allPlanText = [
        specText,
        ...milestones.map(ms => {
          const p = typeof ms.local_plan === 'string' ? ms.local_plan : JSON.stringify(ms.local_plan || {});
          return `${ms.title || ''} ${ms.description || ''} ${ms.scope_files || ''} ${p}`;
        }),
      ].join('\n').toLowerCase();

      // Core components that MUST be in the plan
      const requiredConcepts = [
        { name: 'WebSocket communication', patterns: ['websocket', 'ws', 'socket'] },
        { name: 'Task execution/agent', patterns: ['task', 'agent', 'executor', 'execute'] },
        { name: 'Mobile client', patterns: ['mobile', 'react native', 'app', 'client'] },
        { name: 'Security/auth', patterns: ['auth', 'token', 'security', 'pair', 'encrypt', 'vpn', 'tailscale', 'ssl', 'tls'] },
        { name: 'AI/LLM integration', patterns: ['llm', 'ollama', 'ai', 'model', 'plann'] },
      ];

      for (const concept of requiredConcepts) {
        const found = concept.patterns.some(p => allPlanText.includes(p));
        t.check(found, `Plan covers: ${concept.name}`, `patterns: ${concept.patterns.join(', ')}`);
      }

      // ── Now: Ask AI to evaluate the plan itself ──
      console.log('\n  ═══ AI SELF-EVALUATION OF PLAN ═══');
      const planSummary = milestones.map((ms, i) =>
        `Milestone ${i + 1}: ${ms.title || ms.id}\n  ${(ms.description || '').slice(0, 300)}\n  Files: ${ms.scope_files || '-'}`
      ).join('\n\n');

      const evalPrompt = `Jsi senior architekt. Zhodnoť tento plán pro projekt "Mobile-to-PC AI Agent":

${planSummary}

Projekt má umožnit: mobil zadá úkol → AI na PC naplánuje → desktop agent vykoná → výsledek zpět na mobil.
Architektura: Node.js backend + Python AI subprocess + React Native mobile, WebSocket, Tailscale VPN.
3 execution levels: L1 (filesystem/API), L2 (shell), L3 (GUI automation).

Hodnocení (odpověz ve formátu JSON):
{
  "score": 1-10,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "missing": ["..."],
  "verdict": "stručné shrnutí"
}`;

      try {
        const evalResult = await callLLM('D1', evalPrompt, null, { temperature: 0.2 });
        let evalContent = evalResult.content || '';
        // Strip think blocks
        evalContent = evalContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        console.log(`  AI Evaluation:\n${evalContent.slice(0, 1000)}`);

        // Try parse JSON from evaluation
        const jsonMatch = evalContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const eval_ = JSON.parse(jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
            t.check(eval_.score >= 6, `AI eval score ≥6`, `got: ${eval_.score}`);
            console.log(`  Score: ${eval_.score}/10`);
            console.log(`  Strengths: ${(eval_.strengths || []).join(', ')}`);
            console.log(`  Weaknesses: ${(eval_.weaknesses || []).join(', ')}`);
            console.log(`  Missing: ${(eval_.missing || []).join(', ')}`);
          } catch { console.log('  (JSON parse failed, raw eval above)'); }
        }
      } catch (err) {
        console.log(`  AI evaluation failed: ${err.message}`);
      }

      // ── Approve plan and proceed to BUILD ──
      console.log('\n  ═══ PLAN APPROVED — PROCEEDING TO BUILD ═══');

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build with full execution ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 35,
      maxMsRetries: 2,
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 generated', `got: ${allFiles.length}`);

    const hasJS = allFiles.some(f => f.endsWith('.js') || f.endsWith('.ts'));
    const hasPython = allFiles.some(f => f.endsWith('.py'));
    t.check(hasJS, 'Files: JavaScript/TypeScript present');

    // Check for key architecture concepts in generated code
    const codeFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.py'));
    let allCode = '';
    for (const f of codeFiles) {
      try { allCode += fs.readFileSync(path.join(projectPath, f), 'utf8'); } catch {}
    }
    const hasWS = allCode.includes('WebSocket') || allCode.includes('ws') || allCode.includes('socket');
    const hasTask = allCode.includes('task') || allCode.includes('Task') || allCode.includes('execute');
    t.check(hasWS || hasTask || allCode.length > 500, 'Code: substantive implementation');

    t.check(t.turnNum >= 12, 'Turns: ≥12 (rich conversation)', `got: ${t.turnNum}`);

    // ── v134: Domain-specific quality assertions ──
    console.log('\n  ═══ v134 QUALITY VALIDATION ═══');

    // PA-Q1: WebSocket server must be present and substantive
    const wsFile = codeFiles.find(f => /server|websocket|ws/i.test(f));
    if (wsFile) {
      const info = checkFileSubstantive(path.join(projectPath, wsFile));
      t.check(info.substantive && info.nonCommentLines >= 10,
        'PA-Q1: WebSocket server file is substantive', `${wsFile}: ${info.nonCommentLines} non-comment lines`);
    } else {
      t.check(false, 'PA-Q1: WebSocket server file exists', 'no server/websocket/ws file found');
    }

    // PA-Q2: Task execution logic
    const hasTaskExec = allCode.includes('PENDING') || allCode.includes('EXECUTING') || allCode.includes('PLANNING');
    const hasTaskStates = allCode.includes('task') && (allCode.includes('queue') || allCode.includes('execute') || allCode.includes('status'));
    t.check(hasTaskExec || hasTaskStates, 'PA-Q2: Task execution state machine present');

    // PA-Q3: Python/AI integration (subprocess or direct)
    const hasPythonInteg = allCode.includes('python') || allCode.includes('spawn') || allCode.includes('subprocess')
      || allCode.includes('ollama') || allCode.includes('Ollama') || allCode.includes('llm') || hasPython;
    t.check(hasPythonInteg, 'PA-Q3: Python/AI integration present');

    // PA-Q4: Mock detection
    const mocks = detectProjectMocks(projectPath);
    t.check(mocks.overallRatio < 0.15, 'PA-Q4: Mock ratio <15%',
      `${(mocks.overallRatio * 100).toFixed(1)}% (${mocks.totalMockLines}/${mocks.totalSourceLines} lines)`);

    // PA-Q5: JS import resolution (if JS files exist)
    if (allFiles.some(f => f.endsWith('.js'))) {
      const imports = validateJsImportResolution(projectPath);
      t.check(imports.unresolved.length === 0, 'PA-Q5: All JS imports resolve',
        imports.unresolved.map(u => `${u.file} → ${u.target}`).join(', '));
    }

  } catch (err) {
    console.error(`\nFATAL PA: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// PB: NAS Duplicate Finder — Full Product (Node.js + simple GUI)
// ═════════════════════════════════════════════════════════════════════════════

async function testPB_NasDupFinder() {
  const t = new TestRunner('PB: NAS Duplicate Finder');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  PB: NAS Duplicate Finder — Full Product (Node.js + Web GUI)       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'pb-nas-dupfinder-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/PB-NasDupFinder-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const project = projects.getOrCreate('NAS DupFinder E2E', projectPath, 'NAS duplicate file finder with web GUI — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-pb-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'PB — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js backend + vanilla HTML/JS frontend');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request ──
    const msg1 = t.userTurn(
      'Potřebuju nástroj na hledání duplicitních souborů na lokálním NASu. ' +
      'NAS je mountnutý jako /mnt/nas (SMB/NFS). Požadavky:\n\n' +
      '1) Skenování: rekurzivní procházení zadaných adresářů\n' +
      '2) Detekce duplicit různými strategiemi:\n' +
      '   - Přesná shoda (SHA-256 hash celého souboru)\n' +
      '   - Fuzzy match pro obrázky (perceptual hash — pHash)\n' +
      '   - Podobné názvy (Levenshtein distance ≤3)\n' +
      '   - Stejná velikost + první/poslední 4KB hash (rychlá pre-filter)\n' +
      '3) GUI: jednoduchý web server na localhost s přehledným UI\n' +
      '   - Konfigurace skenu (cesty, strategie, filtry)\n' +
      '   - Výsledky: skupiny duplicit, side-by-side porovnání\n' +
      '   - Akce: smazat, přesunout do koše, hardlink, symlink\n' +
      '   - Statistiky: kolik místa se ušetří\n' +
      '4) Žádný cloud, žádný Electron — čistý Node.js + HTML/CSS/JS frontend.\n\n' +
      'Tech stack: Node.js backend (Express), SQLite pro cache hashů, ' +
      'vanilla HTML/JS frontend (žádný React/Vue/Angular).'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: entered SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Spec rounds ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Detailed scanning + hashing
      'Skenování musí být rychlé — NAS má 4TB dat, miliony souborů. Optimalizace:\n' +
      '- Fáze 1: Rychlý scan — listuj soubory, zaznamenej velikost. Groupuj podle velikosti.\n' +
      '- Fáze 2: Pouze skupiny se stejnou velikostí → hash prvních 4KB (partial hash).\n' +
      '- Fáze 3: Pouze skupiny se stejným partial hashem → full SHA-256 hash.\n' +
      '- Cache: SQLite tabulka (path, size, mtime, partial_hash, full_hash, phash). ' +
      'Pokud se size+mtime nezměnily, použij cached hash.\n' +
      '- Parallel: worker_threads pro hashování (4 workery default, konfigurovatelné).\n' +
      '- Progress: WebSocket real-time updates do GUI (fáze, počet souborů, % hotovo).\n' +
      '- Filtry: min/max velikost, include/exclude glob patterns, skip hidden files (.*), ' +
      'skip symlinks, custom ignore list (.dupignore soubor v adresáři).\n' +
      '- pHash: sharp library pro resize obrázků na 8x8 grayscale, pak DCT. ' +
      'Hamming distance ≤5 = duplicita.',

      // Round 2: GUI details
      'GUI design:\n' +
      '- Single page app, server na portu 9090\n' +
      '- Tab 1 "Skenovat": zadej cesty (multi-input), vyber strategie (checkbox), ' +
      'nastav filtry, tlačítko "Spustit sken"\n' +
      '- Tab 2 "Výsledky": tabulka skupin duplicit, každá skupina expandovatelná. ' +
      'Pro obrázky: thumbnail preview. Pro textové soubory: diff preview. ' +
      'Checkbox pro výběr souborů k akci. Bulk akce: "Smaž vybrané", "Hardlink vybrané"\n' +
      '- Tab 3 "Historie": minulé skeny s výsledky, možnost re-skenovat\n' +
      '- Tab 4 "Nastavení": worker count, cache management, ignored paths\n' +
      '- Styl: tmavé téma, monospace fonty pro paths, zelená/červená pro safe/danger akce\n' +
      '- Responsive layout (CSS Grid), ale optimalizovaný pro desktop (wide screen).',

      // Round 3: Generate spec
      'Generuj specifikaci. Rozhodnutí:\n' +
      '- Node.js 22 (alt: Go, Rust, Python) — protože rychlý start, worker_threads pro paralelismus\n' +
      '- Express (alt: Fastify, Koa) — jednoduchý, osvědčený\n' +
      '- SQLite (alt: LevelDB, JSON files) — pro cache a historii\n' +
      '- sharp (alt: Jimp, ImageMagick CLI) — pro pHash obrázků\n' +
      '- vanilla HTML/JS (alt: React, Svelte) — zero build step, jednoduchý deploy\n' +
      '- worker_threads (alt: cluster, child_process) — shared memory, efektivní\n' +
      'Struktura: src/server.js, src/scanner.js, src/hasher.js (worker), ' +
      'src/cache.js, src/actions.js, public/index.html, public/app.js, public/style.css.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgApprove = t.userTurn('schvaluji');
      const respApprove = await handleLifecycleInput(msgApprove, context);
      t.systemTurn('SPEC → PLAN', respApprove);
    }

    // ── Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      // Approve plan
      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build with rejection ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 35,
      rejectFirst: true,
      rejectMessage: 'Hashovací worker musí podporovat graceful shutdown — ' +
        'když uživatel zruší sken, workery se musí čistě ukončit, ne zůstat viset. ' +
        'Přidej AbortController pattern do worker komunikace.',
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);
    t.check(buildResult.rejected, 'BUILD: milestone rejection tested');

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 generated', `got: ${allFiles.length}`);

    const hasJS = allFiles.some(f => f.endsWith('.js'));
    const hasHTML = allFiles.some(f => f.endsWith('.html'));
    const hasCSS = allFiles.some(f => f.endsWith('.css'));
    t.check(hasJS, 'Files: JavaScript present');
    t.check(hasHTML, 'Files: HTML present');

    // Check for key concepts in generated code
    const jsFiles = allFiles.filter(f => f.endsWith('.js'));
    let allCode = '';
    for (const f of jsFiles) {
      try { allCode += fs.readFileSync(path.join(projectPath, f), 'utf8'); } catch {}
    }
    const hasHashLogic = allCode.includes('sha256') || allCode.includes('SHA') || allCode.includes('createHash');
    const hasWorker = allCode.includes('Worker') || allCode.includes('worker_threads') || allCode.includes('worker');
    const hasSQLite = allCode.includes('sqlite') || allCode.includes('better-sqlite') || allCode.includes('database');
    t.check(hasHashLogic || allCode.includes('hash'), 'Code: hashing logic present');
    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

    // ── v134: Domain-specific quality assertions ──
    console.log('\n  ═══ v134 QUALITY VALIDATION ═══');

    // PB-Q1: Database schema must be duplicate-related (not malware/threat)
    const dbFile = jsFiles.find(f => /database|db|cache|sqlite/i.test(f));
    if (dbFile) {
      const dbCode = fs.readFileSync(path.join(projectPath, dbFile), 'utf8');
      const hasDupSchema = dbCode.includes('hash') || dbCode.includes('duplicate') || dbCode.includes('file_path')
        || dbCode.includes('file_size') || dbCode.includes('partial_hash') || dbCode.includes('phash');
      const hasMalwareSchema = dbCode.includes('threat_level') || dbCode.includes('malware') || dbCode.includes('virus');
      t.check(hasDupSchema, 'PB-Q1a: DB schema has duplicate-related columns');
      t.check(!hasMalwareSchema, 'PB-Q1b: DB schema has no malware/threat columns (wrong domain)');
    } else {
      t.check(false, 'PB-Q1: Database file exists', 'no database/db/cache file found');
    }

    // PB-Q2: API routes must call methods that database module actually exports
    const routeFile = jsFiles.find(f => /route|api/i.test(f));
    if (routeFile && dbFile) {
      const routeCode = fs.readFileSync(path.join(projectPath, routeFile), 'utf8');
      const dbCode = fs.readFileSync(path.join(projectPath, dbFile), 'utf8');
      const dbExports = extractJsExports(dbCode);
      // Find method calls on the db import in routes
      const calledMethods = [...routeCode.matchAll(/(?:db|database|cache)\.\s*(\w+)\s*\(/g)]
        .map(m => m[1]);
      const unknownCalls = calledMethods.filter(m =>
        !dbExports.includes(m) && !['prepare', 'run', 'get', 'all', 'exec', 'close'].includes(m)
      );
      t.check(unknownCalls.length === 0, 'PB-Q2: API routes call existing DB methods',
        unknownCalls.length > 0 ? `unknown: ${unknownCalls.join(', ')}` : '');
    }

    // PB-Q3: Hashing module must not be a trivial duplicate of another
    const hashFiles = jsFiles.filter(f => /hash|sha|phash/i.test(f));
    if (hashFiles.length >= 2) {
      const contents = hashFiles.map(f => fs.readFileSync(path.join(projectPath, f), 'utf8'));
      // Check they're not >80% identical (simple line-count + unique-line check)
      const lines0 = new Set(contents[0].split('\n').map(l => l.trim()).filter(l => l.length > 5));
      const lines1 = new Set(contents[1].split('\n').map(l => l.trim()).filter(l => l.length > 5));
      let overlap = 0;
      for (const l of lines0) if (lines1.has(l)) overlap++;
      const maxLines = Math.max(lines0.size, lines1.size);
      const dupeRatio = maxLines > 0 ? overlap / maxLines : 0;
      t.check(dupeRatio < 0.8, 'PB-Q3: Hash modules are not duplicates of each other',
        `${hashFiles.join(' vs ')}: ${(dupeRatio * 100).toFixed(0)}% overlap`);
    }

    // PB-Q4: Frontend must have scan configuration UI
    if (hasHTML) {
      const htmlFile = allFiles.find(f => f.endsWith('.html'));
      const htmlContent = fs.readFileSync(path.join(projectPath, htmlFile), 'utf8');
      const hasScanUI = htmlContent.includes('scan') || htmlContent.includes('Sken')
        || htmlContent.includes('start') || htmlContent.includes('path') || htmlContent.includes('directory');
      t.check(hasScanUI, 'PB-Q4: Frontend has scan configuration UI');
    }

    // PB-Q5: Mock detection
    const mocks = detectProjectMocks(projectPath);
    t.check(mocks.overallRatio < 0.15, 'PB-Q5: Mock ratio <15%',
      `${(mocks.overallRatio * 100).toFixed(1)}% (${mocks.totalMockLines}/${mocks.totalSourceLines} lines)`);

    // PB-Q6: JS import resolution
    const imports = validateJsImportResolution(projectPath);
    t.check(imports.unresolved.length === 0, 'PB-Q6: All JS imports resolve',
      imports.unresolved.map(u => `${u.file} → ${u.target}`).join(', '));

  } catch (err) {
    console.error(`\nFATAL PB: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// PC: MidPoint Jira Assets Connector — Full Product (Java ConnId)
// ═════════════════════════════════════════════════════════════════════════════

async function testPC_MidPointConnector() {
  const t = new TestRunner('PC: MidPoint Jira Assets Connector');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  PC: MidPoint Jira Assets Connector (Java ConnId Framework)        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'pc-midpoint-jira-e2e';
  const projectPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../projects/PC-MidPointJira-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  // Load the Jira Assets example data
  let jiraExample = '';
  try {
    const examplePath = '/home/belphareon/Downloads/Jira-Assets-response-example.json';
    if (fs.existsSync(examplePath)) {
      const raw = fs.readFileSync(examplePath, 'utf8');
      // Take first object as example (truncate for prompt size)
      const parsed = JSON.parse(raw);
      const firstObj = parsed.values?.[0];
      if (firstObj) {
        jiraExample = JSON.stringify(firstObj, null, 2).slice(0, 2000);
      }
    }
  } catch { jiraExample = '(example file not available)'; }

  const project = projects.getOrCreate('MidPoint Jira Assets E2E', projectPath,
    'ConnId connector for Jira Assets REST API — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-pc-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'PC — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Java 17 (Maven, ConnId 1.x framework)');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request with full context ──
    const msg1 = t.userTurn(
      'Potřebuju vytvořit nový ConnId konektor pro Evolveum MidPoint, který bude spravovat ' +
      'Jira Assets (dříve Insight) přes REST API. Konektor musí umět:\n\n' +
      '1) READ: Číst objekty z Jira Assets (GET /object/{id}, POST /object/aql pro query)\n' +
      '2) CREATE: Vytvářet nové objekty (POST /object/create)\n' +
      '3) UPDATE: Editovat existující objekty (PUT /object/{id})\n' +
      '4) DELETE: Mazat objekty (DELETE /object/{id})\n' +
      '5) SCHEMA: Automaticky detekovat schéma z objectType definitions\n\n' +
      'API autentizace: Basic Auth (email + API token pro Atlassian Cloud).\n' +
      'Base URL: https://api.atlassian.com/jsm/assets/workspace/{workspaceId}/v1/\n\n' +
      'Příklad dat z API (POST /object/aql):\n' +
      '```json\n' + jiraExample + '\n```\n\n' +
      'Konektor musí být kompatibilní s ConnId 1.x frameworkem (org.identityconnectors.framework). ' +
      'Java 17, Maven build, standardní ConnId structure. ' +
      'Reálně to je REST API klient zabalený do ConnId rozhraní — ' +
      'nic složitého, ale musí dodržet ConnId kontrakty (Connector, Configuration, ' +
      'CreateOp, UpdateOp, DeleteOp, SearchOp, SchemaOp, TestOp).'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: entered SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Spec rounds ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: ConnId architecture details
      'Detaily architektury ConnId konektoru:\n\n' +
      'Configuration class (JiraAssetsConfiguration):\n' +
      '- baseUrl (String): Atlassian workspace URL\n' +
      '- workspaceId (String): Assets workspace ID\n' +
      '- email (String): Atlassian account email\n' +
      '- apiToken (GuardedString): API token pro Basic Auth\n' +
      '- pageSize (int): default 50, max 500 pro AQL queries\n' +
      '- objectTypeId (String): which object type to manage (optional, default all)\n' +
      '- connectTimeout (int): ms, default 10000\n' +
      '- readTimeout (int): ms, default 30000\n\n' +
      'Connector class (JiraAssetsConnector) implements:\n' +
      '- Connector, CreateOp, UpdateDeltaOp, DeleteOp, SearchOp<Filter>, SchemaOp, TestOp\n' +
      '- REST client: HttpURLConnection nebo OkHttp (prefer HttpURLConnection — zero deps)\n' +
      '- JSON parsing: org.json (bundled) nebo Jackson\n' +
      '- Attribute mapping: Jira attribute → ConnId Attribute. ' +
      'Key je objectId, Name je objectKey (e.g. "II-102230"), label pro display.\n' +
      '- Paging: AQL supports startAt + maxResults. SearchOp paginates automatically.',

      // Round 2: Specific operations
      'Operace detailně:\n\n' +
      'SEARCH (SearchOp<Filter>):\n' +
      '- Bez filtru: list all objects přes POST /object/aql s query "objectTypeId = X"\n' +
      '- S filtrem: map ConnId filter → AQL query. Support: equals, contains, startsWith, ' +
      'AND, OR. UID filter → GET /object/{id} (single object fetch).\n' +
      '- Pagination: ResultsHandler callback, handle totalFilteredCount.\n\n' +
      'CREATE (CreateOp):\n' +
      '- Map ConnId attributes → Jira attributes JSON. POST /object/create.\n' +
      '- Return UID (objectId from response).\n' +
      '- Handle required attributes validation (Name is required).\n\n' +
      'UPDATE (UpdateDeltaOp):\n' +
      '- Map attribute deltas → Jira attribute update JSON. PUT /object/{id}.\n' +
      '- Handle referenced objects (objectTypeAttributeId → referencedObject).\n\n' +
      'DELETE:\n' +
      '- DELETE /object/{id}. Return void, throw UnknownUidException if 404.\n\n' +
      'SCHEMA:\n' +
      '- Fetch object types: GET /objecttype/flat. For each type, fetch attributes: ' +
      'GET /objecttypeattribute/{objectTypeId}.\n' +
      '- Map Jira attribute types → ConnId types (String, Integer, Boolean, etc).\n' +
      '- Referenced attributes → association or String (objectKey).\n\n' +
      'TEST:\n' +
      '- GET /config with Basic Auth header. If 200 → success, else throw.',

      // Round 3: Generate spec
      'Generuj specifikaci. Rozhodnutí:\n' +
      '- Java 17 (alt: Java 11, Kotlin, Groovy)\n' +
      '- Maven (alt: Gradle) — standard pro ConnId konektory\n' +
      '- HttpURLConnection (alt: OkHttp, Apache HttpClient) — zero external deps\n' +
      '- org.json (alt: Jackson, Gson) — lightweight JSON parsing\n' +
      '- ConnId 1.5.x (alt: ConnId 2.x which is experimental)\n\n' +
      'Maven structure:\n' +
      '  pom.xml\n' +
      '  src/main/java/com/evolveum/connector/jiraassets/\n' +
      '    JiraAssetsConfiguration.java\n' +
      '    JiraAssetsConnector.java\n' +
      '    rest/JiraAssetsClient.java\n' +
      '    rest/AqlQueryBuilder.java\n' +
      '    schema/SchemaTranslator.java\n' +
      '    util/AttributeMapper.java\n' +
      '  src/main/resources/\n' +
      '    com/evolveum/connector/jiraassets/Messages.properties\n' +
      '  src/test/java/com/evolveum/connector/jiraassets/\n' +
      '    JiraAssetsConnectorTest.java\n' +
      '    AqlQueryBuilderTest.java\n' +
      '    AttributeMapperTest.java',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgApprove = t.userTurn('schvaluji');
      const respApprove = await handleLifecycleInput(msgApprove, context);
      t.systemTurn('SPEC → PLAN', respApprove);
    }

    // ── Plan review with revision ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      // Reject plan — insist on proper error handling milestone
      const msgReject = t.userTurn(
        'Chybí mi milestone pro error handling a retry logiku. Jira API má rate limiting ' +
        '(429 Too Many Requests) a občas vrací 5xx. Potřebuju:\n' +
        '- Exponential backoff retry (3 attempts, 1s/2s/4s)\n' +
        '- Rate limit detection (429 header → wait Retry-After seconds)\n' +
        '- Connection pool (keep-alive)\n' +
        '- Proper ConnId exception mapping (ConnectionFailedException, ConnectorIOException, ' +
        'UnknownUidException, etc)\n' +
        'Přidej to do plánu.'
      );
      const respReject = await handleLifecycleInput(msgReject, context);
      t.systemTurn('PLAN revision', respReject);

      // Approve after revision
      if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
        try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('PLAN → BUILD', respApprove);
      }
    }

    // ── Build ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 35 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 generated', `got: ${allFiles.length}`);

    const hasJava = allFiles.some(f => f.endsWith('.java'));
    const hasPom = allFiles.some(f => f.endsWith('pom.xml'));
    t.check(hasJava, 'Files: Java files present');
    t.check(hasPom, 'Files: pom.xml present');

    // Check for ConnId patterns in generated Java code
    const javaFiles = allFiles.filter(f => f.endsWith('.java'));
    let allJavaCode = '';
    for (const f of javaFiles) {
      try { allJavaCode += fs.readFileSync(path.join(projectPath, f), 'utf8'); } catch {}
    }

    const hasConnIdImport = allJavaCode.includes('identityconnectors') || allJavaCode.includes('ConnId');
    const hasConnectorImpl = allJavaCode.includes('implements') && (
      allJavaCode.includes('Connector') || allJavaCode.includes('CreateOp') || allJavaCode.includes('SearchOp')
    );
    const hasConfig = allJavaCode.includes('Configuration') || allJavaCode.includes('ConfigurationProperty');
    t.check(hasJava && javaFiles.length >= 3, 'Code: ≥3 Java files', `got: ${javaFiles.length}`);
    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

    // ── v134: Domain-specific quality assertions ──
    console.log('\n  ═══ v134 QUALITY VALIDATION ═══');

    // PC-Q1: pom.xml must be non-empty and contain ConnId dependency
    const pomPath = path.join(projectPath, 'pom.xml');
    const pomInfo = checkFileSubstantive(pomPath);
    t.check(pomInfo.exists && pomInfo.substantive, 'PC-Q1a: pom.xml exists and is non-empty',
      `bytes: ${pomInfo.bytes}, non-comment lines: ${pomInfo.nonCommentLines}`);
    if (pomInfo.exists && pomInfo.substantive) {
      const pomContent = fs.readFileSync(pomPath, 'utf8');
      const hasConnIdDep = pomContent.includes('connector-framework') || pomContent.includes('identityconnectors')
        || pomContent.includes('connid');
      t.check(hasConnIdDep, 'PC-Q1b: pom.xml contains ConnId framework dependency');
      const hasMavenStructure = pomContent.includes('<project') && pomContent.includes('<groupId')
        && pomContent.includes('<artifactId');
      t.check(hasMavenStructure, 'PC-Q1c: pom.xml has valid Maven structure');
    }

    // PC-Q2: Connector must implement ConnId interfaces (not MidPoint-internal)
    t.check(hasConnIdImport, 'PC-Q2a: Uses ConnId framework imports (org.identityconnectors)');
    t.check(hasConnectorImpl, 'PC-Q2b: Implements ConnId operation interfaces');
    const hasMidPointInternal = allJavaCode.includes('com.evolveum.midpoint.provisioning')
      || allJavaCode.includes('com.evolveum.midpoint.prism')
      || allJavaCode.includes('com.evolveum.midpoint.schema');
    t.check(!hasMidPointInternal, 'PC-Q2c: No MidPoint-internal imports (connectors must not depend on MidPoint core)');

    // PC-Q3: One consistent package hierarchy
    const packageDecls = [...allJavaCode.matchAll(/^package\s+([a-z][\w.]*);/gm)].map(m => m[1]);
    const uniquePackages = [...new Set(packageDecls)];
    // All packages should share a common root (first 3 segments)
    if (uniquePackages.length >= 2) {
      const roots = uniquePackages.map(p => p.split('.').slice(0, 3).join('.'));
      const uniqueRoots = [...new Set(roots)];
      t.check(uniqueRoots.length <= 2, 'PC-Q3: Consistent package hierarchy (≤2 roots)',
        `roots: ${uniqueRoots.join(', ')}`);
    }

    // PC-Q4: No mock/placeholder implementations in main sources
    const mocks = detectProjectMocks(projectPath);
    t.check(mocks.overallRatio < 0.10, 'PC-Q4: Mock ratio <10% (Java connectors must be real)',
      `${(mocks.overallRatio * 100).toFixed(1)}% (${mocks.totalMockLines}/${mocks.totalSourceLines} lines)`);
    if (mocks.files.length > 0) {
      for (const mf of mocks.files) {
        console.log(`    Mock detected: ${mf.file} — ${mf.mockLines} lines (${(mf.ratio * 100).toFixed(0)}%)`);
      }
    }

    // PC-Q5: Configuration class with expected properties
    t.check(hasConfig, 'PC-Q5: Configuration class with @ConfigurationProperty annotations');
    const hasExpectedProps = allJavaCode.includes('baseUrl') || allJavaCode.includes('url')
      || allJavaCode.includes('apiToken') || allJavaCode.includes('token')
      || allJavaCode.includes('email') || allJavaCode.includes('username');
    t.check(hasExpectedProps, 'PC-Q5b: Configuration has connection properties (url/token/email)');

    // PC-Q6: REST client with actual HTTP operations
    const hasHttpClient = allJavaCode.includes('HttpURLConnection') || allJavaCode.includes('OkHttp')
      || allJavaCode.includes('HttpClient') || allJavaCode.includes('CloseableHttpResponse')
      || allJavaCode.includes('apache.http');
    t.check(hasHttpClient, 'PC-Q6: REST client uses real HTTP library');

  } catch (err) {
    console.error(`\nFATAL PC: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN — Run selected or all projects
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  const arg = process.argv[2] || 'all';

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Project E2E v131 — 3 Complex Projects (Real LLM)');
  console.log(`  Mode: ${arg}`);
  console.log('══════════════════════════════════════════════════════════════════════');

  const testMap = {
    a: [testPA_MobileAgent],
    b: [testPB_NasDupFinder],
    c: [testPC_MidPointConnector],
    all: [testPA_MobileAgent, testPB_NasDupFinder, testPC_MidPointConnector],
  };

  const tests = testMap[arg.toLowerCase()];
  if (!tests) {
    console.log(`Unknown argument: ${arg}. Use: a, b, c, or all`);
    process.exit(1);
  }

  await runTests(`v131 Projects (${arg})`, tests, `v131-${arg}`);
}

main();
