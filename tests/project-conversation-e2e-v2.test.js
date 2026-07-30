// Project Conversation E2E Test v2 — 5 Complex Projects (Real LLM)
// P5 DesktopAgent (plan-only), P6 NAS DupeFinder, P7 MidPoint Jira Connector,
// P8 Domácí Účetnictví, P9 GitLab CI Analyzer
// Run: node tests/project-conversation-e2e-v2.test.js
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import {
  TestRunner, checkOllama, createExecutor, cleanDB, initProjectDir, resolveTestProjectPath,
  walkFiles, buildLoop, specLoop, runTests,
  allTranscripts, totalPassed, totalFailed, allFailures, globalStart, elapsed,
  ProjectPhase, MilestoneStatus, CheckpointMode,
  getBuildProgress, computeLifecycleProgress, formatMilestoneTable,
  lifecycleRepo, msRepo, roadmapVersions, crRepo, driftChecks,
  projects, conversations, messagesRepo, lifecycleHandoffState, db,
  handleLifecycleBuildDetected, handleLifecycleInput,
  getLcState, setLcState, clearLcState, initLifecycleStateDb,
  callLLM,
} from './e2e-harness.js';


// ═════════════════════════════════════════════════════════════════════════════
// P5: DesktopAgent — Mobile → AI Agent → Desktop Control (PLAN ONLY, Czech)
// Concept: Mobile phone sends task → AI agent plans → desktop agent executes
// (GUI automation, API calls, shell commands) → result back to mobile.
// Core: mobile is frontend to PC backend, NOT separate entities.
// ═════════════════════════════════════════════════════════════════════════════

async function testP5_DesktopAgent() {
  const t = new TestRunner('P5: DesktopAgent (plan-only)');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P5: DesktopAgent — Mobile → AI → Desktop (PLAN ONLY)             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p5-desktopagent-e2e';
  const projectPath = resolveTestProjectPath('P5-DesktopAgent-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const PROJECT_NAME = 'DesktopAgent E2E';
  const PROJECT_DESC = 'Mobile → AI → Desktop Agent — plan-only E2E test';
  const project = projects.getOrCreate(PROJECT_NAME, projectPath, PROJECT_DESC);
  const projectId = Number(project.id);
  t.convId = `e2e-p5-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P5 — Plan Only (Real LLM)');

  const executor = createExecutor(projectPath, 'Python + TypeScript + system automation');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request — explain the concept with real-world article context ──
    const msg1 = t.userTurn(
      'Mám nápad na aplikaci: "DesktopAgent" — systém kde mobil slouží jako ' +
      'frontend pro ovládání desktopu přes AI agenta. Princip je takovej: ' +
      'uživatel na mobilu řekne co chce (textově nebo hlasem), AI agent na PC ' +
      'to rozloží na kroky a provede to — spustí programy, kliká v GUI, volá API, ' +
      'spouští shell příkazy. Výsledek se pošle zpět na mobil. ' +
      'Klíčový je, že mobil a PC NEJSOU oddělené entity — mobil je jen remote ' +
      'frontend k PC backendu. Vše běží na jednom stroji, mobil jen ovládá. ' +
      'Inspirace: Claude Desktop Agent (computer use), ale zjednodušeně a lokálně. ' +
      'Tech stack: Python backend (FastAPI), TypeScript mobilní frontend (PWA), ' +
      'WebSocket pro real-time komunikaci, Ollama pro AI, pyautogui pro GUI automatizaci.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm lifecycle ──
    const msg2 = t.userTurn('jo');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-7: Detailed spec — architecture deep dive ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Core architecture
      'Architektura: PC backend je FastAPI server (port 8765) s WebSocket endpointem. ' +
      'Mobil se připojí přes WS a posílá textové příkazy. Backend má 3 vrstvy: ' +
      '1) Task Parser — AI (Ollama) rozloží uživatelský požadavek na atomické kroky, ' +
      '2) Action Engine — vykoná kroky: screenshot (pillow), GUI click/type (pyautogui), ' +
      'shell exec (subprocess), file operations, web API calls (httpx), ' +
      '3) Result Reporter — pošle výsledek (text + screenshoty) zpět na mobil. ' +
      'Bezpečnost: whitelist povolených akcí, PIN autentizace, jen lokální síť.',

      // Round 2: Task decomposition detail
      'Task Parser musí být chytrej — příklad: "Otevři Firefox a jdi na gmail" → ' +
      '[{"action":"launch","target":"firefox"},{"action":"wait","condition":"window_title_contains:Firefox"},' +
      '{"action":"navigate","url":"https://gmail.com"}]. ' +
      'Action types: launch (spustí program), click (x,y nebo element), type (text), ' +
      'key (keyboard shortcut), screenshot (celá obrazovka nebo oblast), ' +
      'shell (příkaz), wait (podmínka), notify (zpráva na mobil). ' +
      'AI musí generovat validní JSON plan — použij structured output z Ollama.',

      // Round 3: Mobile frontend
      'Mobilní frontend je PWA (Progressive Web App) — TypeScript + Preact + Workbox. ' +
      'UI: chat-like interface kde uživatel píše příkazy, systém odpovídá s výsledky ' +
      'a screenshoty. Offline schopnost: fronta příkazů. Voice input přes Web Speech API. ' +
      'Notifikace přes Push API když je task hotový a mobil je zamčený. ' +
      'Settings: server IP (auto-discover přes mDNS/zeroconf), PIN, akční whitelist.',

      // Round 4: Safety and error handling
      'Bezpečnost je kritická — agent nesmí udělat nic destruktivního bez potvrzení! ' +
      'Tier systém: T0 (auto) = screenshot, read file, status check. ' +
      'T1 (confirm) = launch app, navigate, type text. ' +
      'T2 (explicit approve) = shell commands, file delete, system settings. ' +
      'T3 (blocked) = format disk, shutdown, install software, network config. ' +
      'Každá akce má timeout (default 30s), rollback kde je to možný (undo). ' +
      'Audit log: všechny akce logované do SQLite s timestampem a výsledkem.',

      // Round 5: Generate spec
      'Ano, vygeneruj specifikaci. Design decisions: FastAPI (alt: Flask, aiohttp), ' +
      'pyautogui (alt: xdotool, pynput), Preact PWA (alt: React, native app), ' +
      'WebSocket (alt: SSE, polling), SQLite audit log (alt: flat file, PostgreSQL). ' +
      'Architecture: monorepo — backend/ (Python), mobile/ (TypeScript PWA), ' +
      'shared/ (protocol types). Communication: JSON over WebSocket.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 8: Spec revision — add screen streaming ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg8 = t.userTurn(
        'Ještě jedna věc — chci aby mobil mohl volitelně streamovat screen z PC. ' +
        'Ne pořád, jen když si o to řekne (tlačítko "Živý náhled"). Implementace: ' +
        'MJPEG stream z Pythonu (pillow screenshot → jpeg → HTTP multipart). ' +
        'Nízká priorita ale musí být v plánu.'
      );
      const resp8 = await handleLifecycleInput(msg8, context);
      t.systemTurn('SPEC revision', resp8);

      // Answer follow-ups
      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 3) {
        const msg = t.userTurn(
          'MJPEG stream na separátním HTTP endpointu /stream, FPS max 5 (úspora CPU), ' +
          'resolution 1280x720 downscaled. Aktivuje se jen na request, automaticky ' +
          'se vypne po 60s bez vieweru.'
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

    // ── Turn 9-10: Plan review — VALIDATE PLAN QUALITY (no build) ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 4, 'Roadmap ≥4 milestones (complex project)', `got: ${milestones.length}`);

      // Validate milestone content quality
      const msNames = milestones.map(m => m.title || m.description || '').join(' ').toLowerCase();
      t.check(
        /websocket|ws|komunikac|communicat/.test(msNames),
        'Plan mentions WebSocket/communication'
      );
      t.check(
        /gui|pyautogui|automa|desktop|action/.test(msNames),
        'Plan mentions GUI automation/actions'
      );
      t.check(
        /mobil|pwa|frontend|client/.test(msNames),
        'Plan mentions mobile/PWA frontend'
      );
      t.check(
        /bezpe[čc]|secur|safe|tier|whitelist/.test(msNames),
        'Plan mentions security/safety'
      );

      // Check milestone count is reasonable for this scope
      t.check(milestones.length <= 8, 'Roadmap ≤8 milestones (not over-split)', `got: ${milestones.length}`);

      // Verify each milestone has meaningful description
      for (const ms of milestones) {
        const desc = ms.description || ms.title || '';
        t.check(desc.length >= 10, `Milestone ${ms.id} has description (${desc.length} chars)`);
      }

      // Check that spec was saved
      if (lifecycleId) {
        const lc = lifecycleRepo.getById(lifecycleId);
        t.check(lc?.spec_text?.length > 100, 'Spec text saved', `got: ${lc?.spec_text?.length || 0} chars`);
      }

      // DO NOT approve — this is plan-only test. Verify plan quality was the goal.
      console.log('\n    ── P5: PLAN-ONLY test complete — NOT entering BUILD ──');
      console.log(`    Milestones: ${milestones.length}`);
      for (const ms of milestones) {
        console.log(`      ${ms.id}: ${(ms.title || ms.description || '').substring(0, 80)}`);
      }
    }

    t.check(t.turnNum >= 10, 'Turns: ≥10', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P5: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P6: NAS DupeFinder — Duplicate File Finder with Light GUI (Czech, Full Build)
// Finds duplicate files on NAS/local disk by hash, size, name patterns.
// Light web GUI for configuration and review.
// ═════════════════════════════════════════════════════════════════════════════

async function testP6_NASDupeFinder() {
  const t = new TestRunner('P6: NAS DupeFinder');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P6: NAS DupeFinder — Duplicate File Finder (Python + Web GUI)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p6-dupefinder-e2e';
  const projectPath = resolveTestProjectPath('P6-DupeFinder-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const project = projects.getOrCreate('NAS DupeFinder E2E', projectPath, 'Duplicate file finder with web GUI — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p6-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P6 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Python CLI + Flask web GUI');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request ──
    const msg1 = t.userTurn(
      'Potřebuju nástroj na hledání duplicitních souborů na NASu. Mám Synology s 8TB ' +
      'dat a chci najít duplikáty, porovnat je a bezpečně smazat kopie. Nechci žádný ' +
      'cloud řešení — čistě lokální Python tool. Porovnání primárně přes SHA-256 hash, ' +
      'ale taky chci možnost hledat podobné soubory (stejné jméno, podobná velikost). ' +
      'K tomu lehký web GUI kde vidím výsledky, můžu je procházet a rozhodnout co smazat.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('ano');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-5: Spec ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Scanner architecture
      'Scanner musí být efektivní — na 8TB dat nemůžu hashovat všechno najednou! ' +
      'Strategie: 1) Nejdřív seskupit soubory podle velikosti (stejná velikost = potenciální duplikát). ' +
      '2) Skupiny s 2+ soubory → partial hash (prvních 4KB + posledních 4KB). ' +
      '3) Partial hash match → full SHA-256 hash. ' +
      'Tímhle eliminuješ 95% souborů po kroku 1 a 99% po kroku 2. ' +
      'Výsledky ukládat do SQLite databáze (scan_results.db): files tabulka ' +
      '(path, size, partial_hash, full_hash, modified_at, scan_id), duplicates tabulka ' +
      '(group_id, file_id, is_original). Scan běží v threadpool (concurrent.futures) ' +
      'pro I/O paralelismus. Progress reporting přes callback.',

      // Round 2: Web GUI
      'Web GUI: Flask na portu 5555. Stránky: ' +
      '1) Dashboard — spustit nový scan (vybrat adresář, exclude patterns), zobrazit historii scanů. ' +
      '2) Výsledky — tabulka skupin duplikátů: group_id, počet souborů, celková velikost, ' +
      'náhled (pokud je to obrázek). U každé skupiny radio button pro "originál" a checkboxy ' +
      'pro "smazat". Filtrování: min velikost, typ souboru, adresář. ' +
      '3) Akce — hromadné smazání vybraných, přesun do koše (trash adresář), dry-run mode. ' +
      '4) Nastavení — exclude patterns (node_modules, .git, thumbs), min file size, max depth. ' +
      'Frontend: plain HTML + CSS + vanilla JS (žádný React), htmx pro interaktivitu.',

      // Round 3: Generate spec
      'Generuj specifikaci. Design decisions: Python (alt: Rust, Go — ale chci rychlej vývoj), ' +
      'Flask (alt: FastAPI — ale nepotřebuju async, stačí sync), SQLite (alt: JSON — ale 8TB = miliony souborů), ' +
      'SHA-256 (alt: xxHash — rychlejší ale SHA je standard), htmx (alt: React — overkill pro tohle). ' +
      'CLI interface taky: `dupefinder scan /mnt/nas --exclude "*.tmp" --min-size 1MB` ' +
      'a `dupefinder report --format json|csv|html`. Architecture: src/scanner.py (core), ' +
      'src/db.py (SQLite), src/web/ (Flask app), src/cli.py (Click CLI).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Turn 6: Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg6 = t.userTurn('schvaluji');
      const resp6 = await handleLifecycleInput(msg6, context);
      t.systemTurn('SPEC → PLAN', resp6);
    }

    // ── Turn 7: Plan review — reject, then approve ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      // Reject: scanner should be first milestone, not DB
      const msgReject = t.userTurn(
        'Přehoď pořadí — nejdřív chci funkční scanner jako standalone CLI (bez GUI, bez DB, ' +
        'výstup do stdout/JSON), ať ho můžu otestovat na malým adresáři. Teprve pak DB a GUI.'
      );
      const respReject = await handleLifecycleInput(msgReject, context);
      t.systemTurn('PLAN revision', respReject);

      // Approve revised plan
      if (getLcState(SESSION_ID)?.phase === 'PLAN_REVIEW') {
        try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

        const msgApprove = t.userTurn('schvaluji');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('PLAN → BUILD', respApprove);
      }
    }

    // ── Turns 8-20: Build with debugging ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 30,
      rejectFirst: true,
      rejectMessage: 'V scanner.py chybí ošetření symlinků — na NASu jich je spousta a bez toho se to zacyklí. Přidej follow_symlinks=False a detekci cyklických odkazů.',
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);
    t.check(buildResult.rejected, 'BUILD: milestone rejection tested');

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 3, 'Files: ≥3 generated', `got: ${allFiles.length}`);
    const hasPy = allFiles.some(f => f.endsWith('.py'));
    t.check(hasPy, 'Files: Python files present');

    // Check for scanner-related content
    const pyFiles = allFiles.filter(f => f.endsWith('.py'));
    let hasHashLogic = false;
    for (const f of pyFiles) {
      try {
        const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
        if (/sha256|hashlib|hash/i.test(content)) hasHashLogic = true;
      } catch {}
    }
    t.check(hasHashLogic, 'Code: contains hash/SHA-256 logic');

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P6: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P7: MidPoint Jira Assets Connector — Java ConnId (English, Full Build)
// Enterprise identity management connector: MidPoint ↔ Jira Assets REST API
// ═════════════════════════════════════════════════════════════════════════════

async function testP7_MidPointJiraConnector() {
  const t = new TestRunner('P7: MidPoint Jira Assets Connector');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P7: MidPoint Jira Assets Connector — Java ConnId (English)       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p7-midpoint-jira-e2e';
  const projectPath = resolveTestProjectPath('P7-MidPointJira-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  // ── Pre-populate: Jira Assets API response example ──
  console.log('\n  ─── Scaffolding Jira Assets API example data ───');

  const jiraExample = {
    values: [
      {
        workspaceId: 'c3b613a4-cb99-49be-a708-6cbf7358fcac',
        globalId: 'c3b613a4-cb99-49be-a708-6cbf7358fcac:102230',
        id: '102230',
        label: 'Kontrola_OPD',
        objectKey: 'II-102230',
        objectType: {
          id: '502', name: 'Sdílené adresáře', type: 0,
          objectSchemaId: '5', schemaLabel: 'IT Infrastruktura',
        },
        attributes: [
          {
            id: '4630', objectTypeAttributeId: '4630',
            objectAttributeValues: [{ displayValue: 'Kontrola_OPD', searchValue: 'Kontrola_OPD' }],
          },
          {
            id: '4810', objectTypeAttributeId: '4810',
            objectAttributeValues: [{
              displayValue: 'fs-brno-01', searchValue: 'fs-brno-01',
              referencedType: 1,
              referencedObject: {
                id: '100521', label: 'fs-brno-01', objectKey: 'II-100521',
                objectType: { id: '483', name: 'NAS / File Server' },
              },
            }],
          },
        ],
      },
      {
        workspaceId: 'c3b613a4-cb99-49be-a708-6cbf7358fcac',
        globalId: 'c3b613a4-cb99-49be-a708-6cbf7358fcac:100890',
        id: '100890',
        label: 'app-srv-prod-01',
        objectKey: 'II-100890',
        objectType: {
          id: '491', name: 'Virtual Guest', type: 0,
          objectSchemaId: '5', schemaLabel: 'IT Infrastruktura',
        },
        attributes: [
          {
            id: '4630', objectTypeAttributeId: '4630',
            objectAttributeValues: [{ displayValue: 'app-srv-prod-01', searchValue: 'app-srv-prod-01' }],
          },
          {
            id: '4701', objectTypeAttributeId: '4701',
            objectAttributeValues: [{ displayValue: '192.168.10.50', searchValue: '192.168.10.50' }],
          },
          {
            id: '4703', objectTypeAttributeId: '4703',
            objectAttributeValues: [{ displayValue: 'Running', searchValue: 'Running' }],
          },
        ],
      },
    ],
  };

  const scaffoldFiles = {
    'docs/jira-assets-response-example.json': JSON.stringify(jiraExample, null, 2),

    'docs/API-NOTES.md': `# Jira Assets REST API Notes

## Base URL
\`https://api.atlassian.com/jsm/assets/workspace/{workspaceId}/v1/\`

## Authentication
- API token: Basic auth with email + API token
- OAuth 2.0 (3LO) for production integrations

## Key Endpoints
- \`GET /object/aql\` — AQL query (Assets Query Language)
- \`GET /object/{id}\` — Get single object
- \`POST /object/create\` — Create object
- \`PUT /object/{id}\` — Update object
- \`DELETE /object/{id}\` — Delete object
- \`GET /objecttype/{id}/attributes\` — Get attribute definitions
- \`GET /objectschema/list\` — List schemas

## Object Structure
- Each object belongs to an objectType within an objectSchema
- Attributes are typed: text, number, date, reference (to another object), select, etc.
- Referenced objects create a graph (e.g., VM → Host Server → Rack → Datacenter)
- objectKey format: "{SCHEMA_PREFIX}-{ID}" (e.g., "II-102230")

## AQL Examples
- \`objectType = "Virtual Guest"\` — all VMs
- \`objectType = "Virtual Guest" AND Status = "Running"\`
- \`Name LIKE "prod"\` — name contains "prod"

## Pagination
- \`?startAt=0&maxResults=50\` on list endpoints
- Response: \`{ values: [...], total: N, startAt: 0, maxResults: 50, isLast: boolean }\`
`,

    'docs/CONNID-NOTES.md': `# ConnId Framework Notes (for MidPoint Connectors)

## Overview
ConnId is the connector framework used by MidPoint (Evolveum) for identity provisioning.
A connector implements SPI interfaces to connect MidPoint to an external resource.

## Key Interfaces
- \`Connector\` — main entry point, implements lifecycle (init, dispose, test)
- \`SchemaOp\` — returns schema of the resource (object classes, attributes)
- \`SearchOp<Filter>\` — search/list objects
- \`CreateOp\` — create new objects
- \`UpdateOp\` / \`UpdateDeltaOp\` — modify existing objects
- \`DeleteOp\` — delete objects
- \`TestOp\` — test connection to resource

## Configuration
- \`@ConfigurationClass\` annotation on config bean
- Properties: endpoint URL, auth credentials, workspace ID, schema ID, etc.

## Object Model
- \`ObjectClass\` — maps to Jira objectType (e.g., "Virtual_Guest")
- \`Uid\` — unique identifier (Jira object ID)
- \`Name\` — display name (Jira label)
- \`ConnectorObject\` — set of attributes
- \`Attribute\` — name + values, typed

## Build
- Maven project, Java 17+
- Deploy as JAR to MidPoint \`icf-connectors/\` directory
- \`pom.xml\` with connid-framework dependency

## Best Practices
- Paginate all list operations
- Cache schema/objectType metadata (changes rarely)
- Handle Jira API rate limits (429 → retry with backoff)
- Map Jira references to ConnId \`Uid\` for associations
- Support incremental sync via \`updated\` timestamp filtering
`,
  };

  for (const [filePath, content] of Object.entries(scaffoldFiles)) {
    const fullPath = path.join(projectPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  try {
    execFileSync('git', ['add', '-A'], { cwd: projectPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'docs: Jira Assets API example + ConnId notes'], {
      cwd: projectPath, stdio: 'pipe',
    });
  } catch { /* ignore */ }

  console.log(`    Scaffolded ${Object.keys(scaffoldFiles).length} reference files`);

  // Register project
  const project = projects.getOrCreate('MidPoint Jira Connector E2E', projectPath,
    'Java ConnId connector for Jira Assets — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p7-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P7 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Java 17 with Maven (ConnId Framework)');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request (English, enterprise tone) ──
    const msg1 = t.userTurn(
      'I need to build a MidPoint ConnId connector for Jira Service Management Assets. ' +
      'The connector should allow MidPoint to provision and reconcile IT infrastructure ' +
      'objects (servers, VMs, network devices, shared directories) stored in Jira Assets. ' +
      'Check the docs/ folder — I\'ve included an API response example and notes about ' +
      'both the Jira Assets REST API and the ConnId framework. The connector needs to ' +
      'support full CRUD: create, read/search, update, delete objects across any object type. ' +
      'Java 17, Maven build, following Evolveum coding conventions.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('yes');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-6: Spec — enterprise detail ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Connector architecture
      'The connector should implement these ConnId operations: SchemaOp (dynamic schema ' +
      'from Jira objectTypes), SearchOp with AQL filter translation, CreateOp, UpdateDeltaOp ' +
      '(attribute-level delta updates), DeleteOp, TestOp (verify API connectivity + permissions). ' +
      'Configuration properties: jiraBaseUrl, workspaceId, apiToken, email, defaultSchemaId, ' +
      'pageSize (default 50), connectTimeout (10s), readTimeout (30s). ' +
      'Package: com.evolveum.connector.jira.assets. ' +
      'Maven artifact: connector-jira-assets, group: com.evolveum.connector.',

      // Round 2: Object mapping
      'Object class mapping: each Jira objectType becomes a ConnId ObjectClass. ' +
      'Naming: objectType.name with spaces replaced by underscores (e.g., "Virtual Guest" → "Virtual_Guest"). ' +
      'Attribute mapping: Jira attributes → ConnId attributes. Types: ' +
      'text → String, number → Integer/Double, date → Long (epoch), boolean → Boolean, ' +
      'reference → Uid (referenced object ID), select → String (enum values). ' +
      'Special attributes: __UID__ = Jira object id, __NAME__ = Jira label. ' +
      'References are critical — a VM references its Host, which references a Rack. ' +
      'The connector must resolve reference attributes as ConnId associations.',

      // Round 3: Search and pagination
      'SearchOp: translate ConnId Filter to Jira AQL. Mapping: ' +
      'EqualsFilter → "attr = value", ContainsFilter → "attr LIKE value", ' +
      'StartsWithFilter → "attr STARTSWITH value", AndFilter/OrFilter → AND/OR. ' +
      'Pagination: use startAt/maxResults, iterate until isLast=true. ' +
      'ResultsHandler pattern: call handler.handle(connectorObject) for each result. ' +
      'Return false from handle() → stop iteration (MidPoint got enough). ' +
      'Rate limiting: detect HTTP 429, extract Retry-After header, wait and retry (max 3).',

      // Round 4: Generate spec
      'Generate the specification. Design decisions: ' +
      'Java 17 (required by MidPoint 4.8+), Maven (standard for ConnId), ' +
      'OkHttp (alt: Apache HttpClient — OkHttp is lighter), Jackson (alt: Gson — Jackson ' +
      'is MidPoint standard). Architecture: ' +
      'src/main/java/com/evolveum/connector/jira/assets/ — ' +
      'JiraAssetsConnector.java (main), JiraAssetsConfiguration.java (config), ' +
      'JiraAssetsFilterTranslator.java (AQL), JiraClient.java (HTTP), ' +
      'ObjectTypeCache.java (schema cache), AttributeMapper.java (type mapping). ' +
      'Tests: JUnit 5 with WireMock for API mocking.',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg = t.userTurn('approve');
      const resp = await handleLifecycleInput(msg, context);
      t.systemTurn('SPEC → PLAN', resp);
    }

    // ── Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('approve');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 30,
      rejectFirst: true,
      rejectMessage: 'The JiraClient is missing retry logic for HTTP 429 rate limits. Add exponential backoff with Retry-After header support.',
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);
    t.check(buildResult.rejected, 'BUILD: milestone rejection tested');

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 (docs + generated)', `got: ${allFiles.length}`);

    // Check for Java files
    const hasJava = allFiles.some(f => f.endsWith('.java'));
    t.check(hasJava, 'Files: Java files present');

    // Check for Maven POM
    const hasPom = allFiles.some(f => f.endsWith('pom.xml'));
    t.check(hasPom, 'Files: pom.xml present');

    // Check for ConnId-related content
    const javaFiles = allFiles.filter(f => f.endsWith('.java'));
    let hasConnIdImport = false;
    for (const f of javaFiles) {
      try {
        const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
        if (/connid|identityconnectors|ConnectorClass|SchemaOp|SearchOp/i.test(content)) {
          hasConnIdImport = true;
        }
      } catch {}
    }
    t.check(hasConnIdImport, 'Code: contains ConnId framework references');

    // Verify scaffolded docs still exist
    t.check(fs.existsSync(path.join(projectPath, 'docs/jira-assets-response-example.json')),
      'Preserve: API example exists');
    t.check(fs.existsSync(path.join(projectPath, 'docs/CONNID-NOTES.md')),
      'Preserve: ConnId notes exist');

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P7: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P8: Domácí Účetnictví — Double-Entry Bookkeeping (Czech, Full Build)
// Simple home accounting: chart of accounts, journal entries, balance sheet,
// income statement. Python Flask + SQLite + htmx frontend.
// ═════════════════════════════════════════════════════════════════════════════

async function testP8_DomaciUcetnictvi() {
  const t = new TestRunner('P8: Domácí Účetnictví');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P8: Domácí Účetnictví — Double-Entry Bookkeeping (Python)        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p8-ucetnictvi-e2e';
  const projectPath = resolveTestProjectPath('P8-Ucetnictvi-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  const project = projects.getOrCreate('Domácí Účetnictví E2E', projectPath,
    'Double-entry bookkeeping system — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p8-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P8 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Python Flask + SQLite + htmx');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request ──
    const msg1 = t.userTurn(
      'Chci si vytvořit jednoduchý systém domácího účetnictví. Podvojné účetnictví — ' +
      'jako v reálu, ale zjednodušený pro domácnost. Účtový rozvrh (aktiva, pasiva, ' +
      'výnosy, náklady), účetní deník (journal entries kde debety = kredity), ' +
      'rozvaha a výsledovka. Python Flask backend, SQLite, a htmx frontend. ' +
      'Nechci Excel, chci pořádný systém s kontrolou integrity (suma MD = suma D).'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('jo');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-5: Spec ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Data model — accounting fundamentals
      'Účtový rozvrh (chart of accounts): hierarchická struktura. Třídy: ' +
      '1xx Aktiva (Běžný účet 211, Pokladna 221, Byt 031, Auto 022), ' +
      '2xx Pasiva (Hypotéka 461, Kreditka 231), ' +
      '5xx Náklady (Potraviny 501, Energie 502, Nájem 518, Pohonné hmoty 503, Zábava 504), ' +
      '6xx Výnosy (Výplata 611, Brigáda 612, Úroky 662). ' +
      'DB model: accounts (id, code, name, type ENUM(ASSET,LIABILITY,EXPENSE,REVENUE), ' +
      'parent_id, is_active). journal_entries (id, date, description, created_at). ' +
      'journal_lines (id, entry_id, account_id, amount_debit, amount_credit). ' +
      'CONSTRAINT: pro každý entry musí SUM(debit) = SUM(credit). ' +
      'Trigger nebo CHECK constraint v SQLite.',

      // Round 2: UI + Reports
      'Flask routes: /accounts (CRUD účtů), /journal (nový zápis, seznam zápisů), ' +
      '/reports/balance-sheet (rozvaha — aktiva vs pasiva k datu), ' +
      '/reports/income-statement (výsledovka — výnosy minus náklady za období). ' +
      'htmx: formuláře s inline validací, dynamické přidávání řádků journal entry ' +
      '(hx-post, hx-swap), live balance check (debety - kredity se musí = 0). ' +
      'Import: CSV import z bankovního výpisu (parsování Fio, ČSOB, KB formátů). ' +
      'Předvolby: opakující se transakce (měsíční nájem, výplata) — šablony.',

      // Round 3: Generate spec
      'Generuj specifikaci. Klíčové: podvojné účetnictví MUSÍ být konzistentní — ' +
      'žádný entry nesmí být uložený pokud MD ≠ D. To je základ. ' +
      'Design: Flask (alt: Django — moc těžký), SQLite (alt: PostgreSQL — overkill), ' +
      'htmx (alt: React — nepotřebuju SPA, htmx stačí). ' +
      'Architecture: app.py (Flask), models.py (SQLAlchemy ORM — tady jo, účetnictví ' +
      'potřebuje transakce), templates/ (Jinja2 + htmx), static/ (CSS).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Approve spec ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msg = t.userTurn('schvaluji');
      const resp = await handleLifecycleInput(msg, context);
      t.systemTurn('SPEC → PLAN', resp);
    }

    // ── Plan review — approve directly ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('schvaluji');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build ──
    const buildResult = await buildLoop(t, SESSION_ID, context, { maxRounds: 25 });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 3, 'Files: ≥3 generated', `got: ${allFiles.length}`);
    const hasPy = allFiles.some(f => f.endsWith('.py'));
    t.check(hasPy, 'Files: Python files present');

    // Check for accounting-specific content
    const pyFiles = allFiles.filter(f => f.endsWith('.py'));
    let hasAccountingLogic = false;
    for (const f of pyFiles) {
      try {
        const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
        if (/debit|credit|journal|balance|ledger|account/i.test(content)) {
          hasAccountingLogic = true;
        }
      } catch {}
    }
    t.check(hasAccountingLogic, 'Code: contains accounting logic (debit/credit/journal)');

    // Check for HTML templates
    const hasHTML = allFiles.some(f => f.endsWith('.html'));
    t.check(hasHTML, 'Files: HTML templates present');

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P8: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// P9: GitLab CI Pipeline Analyzer — Node.js CLI (English, Full Build)
// Reads .gitlab-ci.yml, analyzes pipeline structure, detects anti-patterns,
// generates optimization report. Tests DevOps domain knowledge.
// ═════════════════════════════════════════════════════════════════════════════

async function testP9_GitLabCIAnalyzer() {
  const t = new TestRunner('P9: GitLab CI Analyzer');
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  P9: GitLab CI Pipeline Analyzer — Node.js CLI (English)          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const SESSION_ID = 'p9-gitlab-ci-e2e';
  const projectPath = resolveTestProjectPath('P9-GitLabCI-E2E');
  initProjectDir(projectPath);
  cleanDB(projectPath);

  // ── Pre-populate: example .gitlab-ci.yml with anti-patterns ──
  console.log('\n  ─── Scaffolding example GitLab CI files ───');

  const scaffoldFiles = {
    'examples/bad-pipeline.yml': `# Example pipeline with common anti-patterns
stages:
  - validate
  - lint
  - test
  - build
  - package
  - deploy-staging
  - integration-test
  - deploy-production
  - smoke-test

variables:
  DOCKER_IMAGE: node:18

validate:
  stage: validate
  script:
    - echo "Validating..."
  # Anti-pattern: no cache, reinstalls deps every time

lint:
  stage: lint
  script:
    - npm install
    - npm run lint
  # Anti-pattern: npm install without cache

test:unit:
  stage: test
  script:
    - npm install
    - npm run test:unit
  # Anti-pattern: npm install AGAIN (should use cache from lint)

test:integration:
  stage: test
  script:
    - npm install
    - npm run test:integration
    - sleep 10  # Anti-pattern: hardcoded sleep
  # Anti-pattern: no retry on flaky integration tests

build:
  stage: build
  script:
    - npm install
    - npm run build
    - docker build -t myapp:$CI_COMMIT_SHA .
  # Anti-pattern: npm install 4th time, no docker layer caching

package:
  stage: package
  script:
    - docker push myapp:$CI_COMMIT_SHA
  only:
    - main
  # Anti-pattern: separate stage just for docker push (could merge with build)

deploy-staging:
  stage: deploy-staging
  script:
    - kubectl apply -f k8s/staging/
  environment:
    name: staging
  only:
    - main
  # Missing: no rollback strategy, no health check

deploy-production:
  stage: deploy-production
  script:
    - kubectl apply -f k8s/production/
  environment:
    name: production
  when: manual
  only:
    - main
  # Anti-pattern: no approval gate, just manual trigger
  # Missing: no canary/blue-green, no rollback

smoke-test:
  stage: smoke-test
  script:
    - curl -f https://myapp.example.com/health
  only:
    - main
  # Anti-pattern: after deploy — if this fails, broken code is already live
`,

    'examples/good-pipeline.yml': `# Well-structured pipeline for comparison
stages:
  - prepare
  - quality
  - build
  - deploy

.node-cache: &node-cache
  cache:
    key: \${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
      - .npm/

prepare:deps:
  stage: prepare
  <<: *node-cache
  script:
    - npm ci --cache .npm --prefer-offline

lint:
  stage: quality
  <<: *node-cache
  needs: [prepare:deps]
  script:
    - npm run lint

test:
  stage: quality
  <<: *node-cache
  needs: [prepare:deps]
  script:
    - npm run test
  retry:
    max: 2
    when: runner_system_failure
  artifacts:
    reports:
      junit: test-results.xml
    when: always

build:
  stage: build
  <<: *node-cache
  needs: [lint, test]
  script:
    - npm run build
    - docker build --cache-from myapp:latest -t myapp:$CI_COMMIT_SHA .
  services:
    - docker:dind

deploy:
  stage: deploy
  needs: [build]
  script:
    - helm upgrade --install myapp ./chart --set image.tag=$CI_COMMIT_SHA
  environment:
    name: production
  when: manual
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`,
  };

  for (const [filePath, content] of Object.entries(scaffoldFiles)) {
    const fullPath = path.join(projectPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  try {
    execFileSync('git', ['add', '-A'], { cwd: projectPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'examples: good and bad pipeline YAMLs for analysis'], {
      cwd: projectPath, stdio: 'pipe',
    });
  } catch { /* ignore */ }

  console.log(`    Scaffolded ${Object.keys(scaffoldFiles).length} example files`);

  // Register project
  const project = projects.getOrCreate('GitLab CI Analyzer E2E', projectPath,
    'GitLab CI pipeline analyzer CLI — E2E test');
  const projectId = Number(project.id);
  t.convId = `e2e-p9-${Date.now()}`;
  conversations.getOrCreate(t.convId, projectId, 'P9 — Full Lifecycle (Real LLM)');

  const executor = createExecutor(projectPath, 'Node.js CLI application');
  const context = { sessionId: SESSION_ID, executor, projectPath };
  let lifecycleId = null;

  try {
    // ── Turn 1: Build request ──
    const msg1 = t.userTurn(
      'I want to build a CLI tool that analyzes .gitlab-ci.yml files and detects ' +
      'anti-patterns, inefficiencies, and security issues. Think of it as a linter ' +
      'for CI/CD pipelines. It should parse the YAML, build a dependency graph of jobs, ' +
      'and run a set of rules against it. Output: structured report with severity levels, ' +
      'descriptions, and fix suggestions. Check the examples/ folder — I have a "bad" ' +
      'pipeline and a "good" one for reference. Node.js, no TypeScript, minimal deps.'
    );
    const resp1 = handleLifecycleBuildDetected(msg1, { intent: 'BUILD' }, context);
    t.systemTurn('PROPOSED', resp1);
    t.check(resp1?.content?.length > 20, 'T1: got substantive proposal');

    // ── Turn 2: Confirm ──
    const msg2 = t.userTurn('yes');
    const resp2 = await handleLifecycleInput(msg2, context);
    t.systemTurn('SPEC', resp2);

    const state2 = getLcState(SESSION_ID);
    t.check(state2?.phase === 'SPEC', 'T2: state is SPEC', `got: ${state2?.phase}`);
    lifecycleId = state2?.lifecycleId;

    // ── Turns 3-5: Spec ──
    const specRounds = await specLoop(t, SESSION_ID, context, [
      // Round 1: Rule engine
      'The analyzer should have a pluggable rule engine. Each rule is a module that: ' +
      '1) has an ID (e.g., "no-cache"), severity (error/warning/info), and description. ' +
      '2) receives the parsed pipeline AST + job dependency graph. ' +
      '3) returns findings: { ruleId, severity, jobName?, message, suggestion }. ' +
      'Rules I want in v1: ' +
      '- no-cache: job installs deps without cache configuration ' +
      '- duplicate-install: same package manager command in multiple jobs ' +
      '- no-retry-flaky: test jobs without retry policy ' +
      '- too-many-stages: pipeline has >6 stages (merge some) ' +
      '- hardcoded-sleep: script contains "sleep N" (use retry/polling instead) ' +
      '- deploy-without-rollback: deploy job has no rollback strategy ' +
      '- test-after-deploy: smoke/integration test runs after production deploy ' +
      '- missing-artifacts: test job doesn\'t publish test reports ' +
      '- broad-only-rules: only/except used instead of rules (deprecated) ' +
      '- no-needs-graph: jobs don\'t use "needs" (forced serial execution)',

      // Round 2: Output formats
      'Output formats: ' +
      '1) Console (default): colored table with severity icons, job names, rule IDs. ' +
      '2) JSON: machine-readable for CI integration (exit code 1 if errors found). ' +
      '3) Markdown: for PR comments (GitLab supports markdown in CI output). ' +
      '4) SARIF: for code scanning integration (bonus, low priority). ' +
      'CLI: `cicheck analyze .gitlab-ci.yml [--format json|md|sarif] [--severity error] ' +
      '[--ignore no-cache,broad-only-rules] [--config .cicheck.yml]`. ' +
      'Config file (.cicheck.yml): disable rules, set custom severity, ignore specific jobs.',

      // Round 3: Generate spec
      'Generate the spec. Deps: js-yaml (YAML parsing), chalk (colors), ' +
      'commander (CLI). That\'s it — 3 deps, no framework bloat. ' +
      'Architecture: src/parser.js (YAML → AST + job graph), src/rules/ (one file per rule), ' +
      'src/engine.js (load rules, run against AST), src/formatters/ (console, json, markdown), ' +
      'src/cli.js (commander entry point), src/config.js (load .cicheck.yml). ' +
      'Design decisions: js-yaml (alt: yaml — js-yaml is more battle-tested), ' +
      'commander (alt: yargs — commander is lighter), chalk (alt: kleur — chalk is standard).',
    ]);

    t.check(
      getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW',
      'SPEC_REVIEW reached',
      `got: ${getLcState(SESSION_ID)?.phase}`
    );

    // ── Spec revision: add rule for Docker layer caching ──
    if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
      const msgRev = t.userTurn(
        'Add one more rule: "no-docker-cache" — detects docker build commands without ' +
        '--cache-from flag. This is huge for build times. Also, the parser should handle ' +
        'YAML anchors and extends (GitLab\'s !reference tag) properly.'
      );
      const respRev = await handleLifecycleInput(msgRev, context);
      t.systemTurn('SPEC revision', respRev);

      let revRound = 0;
      while (getLcState(SESSION_ID)?.phase === 'SPEC' && revRound < 2) {
        const msg = t.userTurn(
          'The YAML anchor handling: js-yaml resolves anchors automatically, but ' +
          'GitLab extends: (.template) needs custom merge logic. Parse extends first, ' +
          'merge inherited keys, then run rules on the resolved job definitions.'
        );
        const resp = await handleLifecycleInput(msg, context);
        t.systemTurn(`SPEC revision round ${revRound + 1}`, resp);
        revRound++;
      }

      if (getLcState(SESSION_ID)?.phase === 'SPEC_REVIEW') {
        const msgApprove = t.userTurn('approve');
        const respApprove = await handleLifecycleInput(msgApprove, context);
        t.systemTurn('SPEC → PLAN', respApprove);
      }
    }

    // ── Plan review ──
    const planState = getLcState(SESSION_ID);
    t.check(planState?.phase === 'PLAN_REVIEW', 'PLAN_REVIEW reached', `got: ${planState?.phase}`);

    if (planState?.phase === 'PLAN_REVIEW' && lifecycleId) {
      const milestones = msRepo.listByLifecycle(lifecycleId);
      t.check(milestones.length >= 3, 'Roadmap ≥3 milestones', `got: ${milestones.length}`);

      try { db.prepare('UPDATE milestones SET test_strategy = NULL WHERE lifecycle_id = ?').run(lifecycleId); } catch {}

      const msgPlan = t.userTurn('approve');
      const respPlan = await handleLifecycleInput(msgPlan, context);
      t.systemTurn('PLAN → BUILD', respPlan);
    }

    // ── Build with rejection ──
    const buildResult = await buildLoop(t, SESSION_ID, context, {
      maxRounds: 30,
      rejectFirst: true,
      rejectMessage: 'The parser doesn\'t handle "extends:" keyword — it just ignores template jobs starting with a dot. You need to resolve extends before running rules, otherwise inherited cache/retry settings won\'t be detected.',
    });
    t.check(buildResult.completed >= 2, 'BUILD: ≥2 milestones completed', `got: ${buildResult.completed}`);
    t.check(buildResult.rejected, 'BUILD: milestone rejection tested');

    // ── Final verification ──
    const allFiles = walkFiles(projectPath);
    t.check(allFiles.length >= 5, 'Files: ≥5 (examples + generated)', `got: ${allFiles.length}`);

    const hasJS = allFiles.some(f => f.endsWith('.js'));
    t.check(hasJS, 'Files: JavaScript files present');

    // Check for YAML/rule-related content
    const jsFiles = allFiles.filter(f => f.endsWith('.js'));
    let hasRuleLogic = false;
    let hasYAMLParsing = false;
    for (const f of jsFiles) {
      try {
        const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
        if (/rule|severity|finding|anti.?pattern/i.test(content)) hasRuleLogic = true;
        if (/yaml|yml|parse|stage|job/i.test(content)) hasYAMLParsing = true;
      } catch {}
    }
    t.check(hasRuleLogic, 'Code: contains rule/severity/finding logic');
    t.check(hasYAMLParsing, 'Code: contains YAML/pipeline parsing');

    // Verify scaffolded examples still exist
    t.check(fs.existsSync(path.join(projectPath, 'examples/bad-pipeline.yml')),
      'Preserve: bad-pipeline.yml exists');
    t.check(fs.existsSync(path.join(projectPath, 'examples/good-pipeline.yml')),
      'Preserve: good-pipeline.yml exists');

    // Check package.json exists
    const hasPkgJson = allFiles.some(f => f === 'package.json');
    t.check(hasPkgJson, 'Files: package.json present');

    t.check(t.turnNum >= 12, 'Turns: ≥12', `got: ${t.turnNum}`);

  } catch (err) {
    console.error(`\nFATAL P9: ${err.message}\n${err.stack}`);
    t.check(false, 'FATAL', err.message);
  }

  t.summary();
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN — Run All 5 Projects Sequentially
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Project Conversation E2E v2 — 5 Complex Projects (Real LLM)');
  console.log('  P5 DesktopAgent (plan-only), P6 DupeFinder, P7 MidPoint,');
  console.log('  P8 Účetnictví, P9 GitLab CI');
  console.log('══════════════════════════════════════════════════════════════════════');

  await runTests('P5-P9 Projects', [
    testP5_DesktopAgent,
    testP6_NASDupeFinder,
    testP7_MidPointJiraConnector,
    testP8_DomaciUcetnictvi,
    testP9_GitLabCIAnalyzer,
  ], '5projects-v2');
}

main();
