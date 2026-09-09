#!/usr/bin/env node
// Capability #2 — CRE: deterministic behaviour acceptance
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT.md §3 step 3, for the seven behaviours in
// docs/behaviours/02-cre.md that do not need a model. The seven that do are a
// separate model-profile suite.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { config } from '../src/config.js';
import { computeMath } from '../src/tools/local-computations.js';
import { BUILTIN_EXPERTISES } from '../src/expertises/expertise-layer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One attempt, no retry: C-04's bound. Six seconds today is three attempts at
// 2s and 4s against a refused connection; one attempt fails immediately.
const CLASSIFICATION_BOUND_MS = 2000;

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, label) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push(label); console.error(`  ❌ ${label}`); }
}

const cre = new CREDecisionEngine();

async function main() {
  console.log('\n══ Capability #2 — CRE deterministic behaviours ══\n');

  // ── C-01 / C-02 — LOCAL is classified and terminal, with no model call ─────
  // The engine is constructed with no LLM wired in, so any model call would
  // throw or hang rather than silently succeed.
  const clock = await cre.decide('kolik je hodin?');
  const math = await cre.decide('kolik je 17 * 23?');

  check(
    clock.intent === IntentType.LOCAL && math.intent === IntentType.LOCAL,
    'C-01 — a clock question and an arithmetic question classify as LOCAL',
  );
  check(
    clock.metadata?.localComputation === true && math.metadata?.localComputation === true,
    'C-01b — LOCAL answers are computed locally, not requested from a model',
  );
  check(
    clock.type === DecisionType.LOCAL && math.type === DecisionType.LOCAL
    && (clock.tools?.length ?? 0) === 0 && (math.tools?.length ?? 0) === 0,
    'C-02 — LOCAL is a terminal decision that calls no tool and no gateway',
  );

  const chainEngine = new CREDecisionEngine();
  let chainModelCalls = 0;
  chainEngine._llmClassifyIntent = async () => { chainModelCalls++; return null; };
  const chains = [['10 * 9 * 8', 720], ['2 + 3 * 4', 14], ['100 / 5 - 2?', 18]];
  const chainDecisions = [];
  for (const [input] of chains) chainDecisions.push(await chainEngine.decide(input));
  check(
    chainModelCalls === 0 && chainDecisions.every(decision => (
      decision.intent === IntentType.LOCAL && decision.type === DecisionType.LOCAL
      && decision.metadata?.handler === 'local.math'
      && decision.metadata?.classifiedBy === 'deterministic'
      && decision.tools.length === 0
    )) && chains.every(([input, expected]) => computeMath(input).answer === expected),
    'C-01c — complete integer expressions route to the existing local calculator without model calls',
  );
  check(
    ['byt 2+1', 'i7-14700K', 'verze 1+2+3', '10 * 9 * 8 položek',
      'x = 2 + 3 * 4', 'https://example.test/1/2/3', '1 + + 2 * 3', '2 ** 3 + 1']
      .every(input => chainEngine.classifyIntent(input) !== IntentType.LOCAL),
    'C-01d — numeric text, identifiers and unsupported expressions do not gain LOCAL authority',
  );

  // ── C-09e–h — cause vocabulary alone does not request code analysis ────
  const causeEngine = new CREDecisionEngine();
  let causeFallbackCalls = 0;
  causeEngine._llmClassifyIntent = async () => { causeFallbackCalls++; return null; };
  const ordinaryCauseInputs = [
    'Jaké jsou nejčastější příčiny bolesti zad u lidí kolem 35 let?',
    'Jaké jsou příčiny bolesti zad?',
    'Jaké jsou příčiny škod?',
    'Jaké jsou příčiny eroze půdy?',
    'What are common root causes of back pain?',
  ];
  const ordinaryCauseDecisions = [];
  for (const input of ordinaryCauseInputs) {
    ordinaryCauseDecisions.push(await causeEngine.decide(input));
  }
  check(
    ordinaryCauseInputs.every(input => causeEngine.classifyIntent(input) === IntentType.CONVERSATIONAL)
    && ordinaryCauseDecisions.every(decision => (
      decision.intent === IntentType.CONVERSATIONAL
      && decision.type === DecisionType.ANSWER && decision.tools.length === 0
    )),
    'C-09e — ordinary cause questions cannot acquire CODE_ANALYSIS through regex fallback',
  );
  const codeCauseInputs = [
    'Jaká je příčina této chyby v kódu?',
    'What is the root cause in this code?',
    'Příčiny pádu aplikace v kódu',
    'Root cause in parser code',
  ];
  const codeCauseDecisions = [];
  for (const input of codeCauseInputs) {
    codeCauseDecisions.push(await causeEngine.decide(input, {
      hasActiveProject: true, project: { id: 'cause-regression' },
    }));
  }
  check(
    codeCauseInputs.every(input => causeEngine.classifyIntent(input) === IntentType.CODE_ANALYSIS)
    && codeCauseDecisions.every(decision => (
      decision.intent === IntentType.CODE_ANALYSIS && decision.type === DecisionType.TOOL_CALL
    )) && causeFallbackCalls > 0,
    'C-09f — explicit code cause requests retain the existing CODE_ANALYSIS tool boundary',
  );
  check(
    causeEngine.classifyIntent('Přečti soubor src/main.js') === IntentType.FILE_READ
    && causeEngine.classifyIntent('Napiš obsah do souboru src/main.js') === IntentType.FILE_WRITE
    && causeEngine.classifyIntent('Spusť npm test') === IntentType.SHELL,
    'C-09g — cause qualification leaves explicit file and shell classification unchanged',
  );
  const classifiedCauseEngine = new CREDecisionEngine();
  let classifiedCauseCalls = 0;
  classifiedCauseEngine._llmClassifyIntent = async () => {
    classifiedCauseCalls++;
    return { intent: IntentType.SEARCH, confidence: 0.95 };
  };
  const classifiedCause = await classifiedCauseEngine.decide(ordinaryCauseInputs[0]);
  check(
    classifiedCauseCalls === 1 && classifiedCause.intent === IntentType.SEARCH
    && classifiedCause.type === DecisionType.TOOL_CALL,
    'C-09h — regex correction does not override an accepted SEARCH classification or tool authority',
  );

  // ── C-09 — a requested middleware snippet needs no project effect ────────
  const inlineCodeEngine = new CREDecisionEngine();
  let inlineCodeModelCalls = 0;
  inlineCodeEngine._llmClassifyIntent = async () => {
    inlineCodeModelCalls++;
    throw new Error('Explicit inline middleware must use deterministic classification');
  };
  const inlineCodeProjectEntries = readdirSync(process.env.C3_PROJECTS_DIR).sort();
  const developerContext = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.developer };
  const middlewareInputs = [
    'Napiš mi middleware pro JWT verifikaci v Express.js.',
    'Write middleware for JWT verification in Express.',
  ];
  const middlewareDecisions = [];
  for (const context of [{}, developerContext]) {
    for (const input of middlewareInputs) {
      middlewareDecisions.push(await inlineCodeEngine.decide(input, context));
    }
  }
  check(
    middlewareDecisions.every(decision => (
      decision.type === DecisionType.ANSWER && decision.intent === IntentType.CODE
      && decision.tools.length === 0 && decision.slots.length === 0
      && decision.metadata.noProjectRequired === true
      && decision.metadata.classifiedBy === 'deterministic'
    )),
    'C-09a — middleware snippets are CODE ANSWERs with or without developer expertise',
  );
  const projectMiddleware = await inlineCodeEngine.decide(middlewareInputs[0], {
    ...developerContext, hasActiveProject: true,
    project: { id: 'middleware-authority-check', path: process.env.C3_PROJECTS_DIR },
  });
  check(
    projectMiddleware.type === DecisionType.TOOL_CALL
      && projectMiddleware.intent === IntentType.CODE
      && projectMiddleware.tools.includes('file.write')
      && projectMiddleware.metadata.enforceSandbox === true
      && projectMiddleware.metadata.noProjectRequired === undefined,
    'C-09b — active project middleware retains its guarded tool decision',
  );
  const effectInputs = [
    ['Napiš middleware do souboru src/middleware.js', IntentType.FILE_WRITE],
    ['Přečti soubor src/middleware.js', IntentType.FILE_READ],
    ['Spusť middleware v terminálu', IntentType.SHELL],
  ];
  // These existing effect routes still ask the classifier before their regex
  // fallback. Exercise that fallback separately without allowing inference.
  const effectFallbackEngine = new CREDecisionEngine();
  let effectFallbackCalls = 0;
  effectFallbackEngine._llmClassifyIntent = async () => { effectFallbackCalls++; return null; };
  const effectDecisions = [];
  for (const [input] of effectInputs) {
    effectDecisions.push(await effectFallbackEngine.decide(input, developerContext));
  }
  check(
    effectDecisions.every((decision, index) => (
      decision.intent === effectInputs[index][1] && decision.type !== DecisionType.ANSWER
      && decision.metadata.noProjectRequired === undefined
    )),
    `C-09c — explicit file and shell fallbacks stay effect decisions (${effectFallbackCalls} classifier fallbacks)`,
  );
  check(
    inlineCodeModelCalls === 0
      && JSON.stringify(readdirSync(process.env.C3_PROJECTS_DIR).sort()) === JSON.stringify(inlineCodeProjectEntries),
    'C-09d — middleware decisions spend no model call and create no project artifact',
  );

  // ── C-03 — every decision carries its own provenance ──────────────────────
  check(
    typeof clock.metadata?.classifiedBy === 'string'
    && clock.metadata.classifiedBy.length > 0
    && typeof clock.confidence === 'number'
    && Number.isFinite(clock.metadata?.classificationTimeMs),
    'C-03 — a decision records classifiedBy, confidence and its classification time',
  );

  // ── C-04 — an unreachable model degrades fast and never throws ────────────
  // "napiš mi báseň" has no deterministic pattern, so it must go to the model,
  // find nothing listening, and fall back to regex.
  //
  // The unreachable model is made unreachable here rather than assumed from the
  // environment. This suite is registered offline, but run bare on a machine
  // where Ollama happens to be up it used to measure a live model call — 19.7 s
  // once the model had to load — and report it as a retry-policy failure.
  const closedPort = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const realOllamaUrl = config.ollama.baseUrl;
  config.ollama.baseUrl = `http://127.0.0.1:${closedPort}`;

  const deterministicConversationStarted = Date.now();
  const deterministicConversation = await Promise.all([
    cre.decide('OK'),
    cre.decide('Jak se máš?'),
    cre.decide('Co si myslíš o Pythonu?'),
    cre.decide('Kdo byl Albert Einstein?'),
    cre.decide('Jak funguje DNS?'),
    cre.decide('What is photosynthesis?'),
  ]);
  const deterministicConversationElapsed = Date.now() - deterministicConversationStarted;
  check(
    deterministicConversation.every(decision => (
      decision.intent === IntentType.CONVERSATIONAL
      && decision.type === DecisionType.ANSWER
      && decision.metadata?.classifiedBy === 'deterministic'
    )),
    'C-04a — explicit conversation and static-knowledge patterns take the deterministic ANSWER path',
  );
  check(
    deterministicConversationElapsed < CLASSIFICATION_BOUND_MS,
    `C-04a.1 — deterministic conversation does not wait on the model (${deterministicConversationElapsed} ms)`,
  );
  const ambiguousTechnologyTopic = await cre.decide('Python');
  check(
    ambiguousTechnologyTopic.intent === IntentType.AMBIGUOUS
      && ambiguousTechnologyTopic.type === DecisionType.ASK_USER
      && ambiguousTechnologyTopic.metadata?.classifiedBy === 'deterministic',
    'C-04a.2 — a bare technology topic stays ambiguous without spending a model call',
  );

  const started = Date.now();
  let threw = null;
  let fallback = null;
  try {
    fallback = await cre.decide('napiš mi báseň o podzimu');
  } catch (err) {
    threw = err;
  }
  const elapsed = Date.now() - started;
  config.ollama.baseUrl = realOllamaUrl;

  check(threw === null && fallback !== null, 'C-04 — an unreachable model never throws out of decide()');
  check(
    fallback?.intent !== undefined && fallback?.type !== undefined,
    'C-04b — an unreachable model still yields a decision through the regex fallback',
  );
  check(
    elapsed < CLASSIFICATION_BOUND_MS,
    `C-04c — classification does not wait on retries (${elapsed} ms, bound ${CLASSIFICATION_BOUND_MS} ms)`,
  );

  // C-07 - nothing reaches an answer without a CRE decision
  // Structural: every handler that answers must obtain a decision from the
  // engine, and the only sanctioned way past it is the audited intercept.
  const conversation = readFileSync(path.join(ROOT, 'src/chat/handlers/conversation.js'), 'utf8');
  const engine = readFileSync(path.join(ROOT, 'src/chat/cre-decision.js'), 'utf8');
  check(
    /creDecisionEngine\.decide\s*\(/.test(conversation),
    'C-07 - the conversation handler obtains its decision from the CRE engine',
  );
  check(
    /logIntercept\s*\(/.test(engine) && /overrideDecision\s*\(/.test(engine),
    'C-07b - the engine provides audited overrides so a bypass leaves a record',
  );

  // ── C-15 — a write without project authority is denied without a syscall ──
  // M2 removes the fallback output root: a write needs a registered project,
  // an authenticated subject and a separately approved EffectRequest.
  const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');

  const before = new Set(readdirSync(ROOT));
  const written = await handleFileWriteDecision(
    'ulož to',
    { metadata: { handler: 'file.write', filePath: null }, toJSON: () => ({}) },
    { history: [{ response: { content: 'obsah k uložení' } }] },
  );

  const strayFiles = readdirSync(ROOT).filter(name => !before.has(name));

  check(
    strayFiles.length === 0
    && written?.tag?.metadata?.securityBlocked === true
    && written?.tag?.metadata?.error === 'effect_authority_required',
    'C-15 — a write without project authority is denied and creates no file'
    + ` (stray in root: ${strayFiles.join(', ') || 'none'})`,
  );

  console.log(`\n══ RESULTS: ${pass} passed, ${fail} failed ══`);
  if (failures.length) {
    console.error('\n  FAILURES:');
    for (const f of failures) console.error(`    ❌ ${f}`);
  }
  console.log('');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
