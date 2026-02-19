# CLAUDE.md - C.3 Agent Development Context

**Verze:** v65.7
**Datum:** 2026-02-19
**Projekt:** ~/Projects/c3-agent-wip

---

## Aktualni stav

C.3 Agent je plne funkcni conversational AI platforma s:
- **CRE** (Conversational Reasoning Engine) — single-authority decision engine s **CRE Gatekeeper** audit trail (v64.0)
- **Expert System** (v63) — 15 built-in expertu s 5D capability profily, multi-expertise merge engine, enforcement pipeline, execution trace observability
- **Quality Gate v2** (v62.3+) — deterministicky post-processing pipeline: structural fix, SK→CZ transliterator (~160 regexu), LinkGuard, content enforcement
- **Agent Platform** — deterministicke worker agenty se zdroji, podminkami, triggery, notifikacemi + **Agent Builder Wizard (v65.5)**
- **Project Lifecycle** — milnikove rizeni projektu s crash recovery + **project context injection (v65.4)** + **lifecycle session routing fix (v65.6)** + **real LLM E2E test (v65.7)**
- **Product Modules** (v65.7) — Setup Wizard (first-run + API), Auto-updater (background checker), License system (3 tiers + feature gates)
- **C3 Studio IDE** — Theia 1.65.2, custom panely, linked sessions, expertise wizard, agent builder wizard
- **WebSocket Bridge** — IDE ↔ Backend WS bridge s feature negotiation, session routing, file watcher

### Branch: `master`

### Zdrojovy kod

| Adresar | Radky | Soubory | Popis |
|---------|-------|---------|-------|
| src/chat/ | 24,588 | 59 | Konverzacni pipeline (CRE, handlers, quality, synthesis) |
| src/experts/ | 7,515 | 17 | Expert system (merge engine, 5D capabilities, enforcement) |
| src/agents/ | 6,510 | 14 | Agent platform (runner, scheduler, conditions, triggers) |
| src/planner/ | 4,754 | 13 | Project lifecycle (workflow, build, milestones) |
| src/ui/ | 4,552 | 2 | Web UI (architect.js) |
| src/architect/ | 4,002 | 13 | Code generation pipeline |
| src/executor/ | 3,438 | 8 | Tool execution (circuit breaker, shell security) |
| src/notifications/ | 2,956 | 16 | Notification pipeline (email, telegram, ntfy, trust) |
| src/routes/ | 2,899 | 7 | HTTP API routes |
| src/llm/ | 2,722 | 6 | LLM gateway, Ollama client, web search |
| src/db/ | 2,056 | 7 | Database, migrations, schema |
| src/memory/ | 1,360 | 3 | Long-term memory, preferences |
| src/domains/ | 1,179 | 7 | Domain recipes (CI/CD, monitoring, infra) |
| src/ws-bridge/ | 913 | 5 | WebSocket bridge (IDE transport) |
| src/channels/ | 841 | 3 | Channel adapters (CLI, Web, API) |
| src/server.js | 855 | 1 | Express HTTP server |
| ostatni | 1,476 | 7 | core, licensing, packaging, setup, tools, config |
| **Celkem** | **73,706** | **188** | |

### Database

54 tabulek (vcetne FTS), 5 migraci, prepared statements.

### Testovaci pokryti

| Sada | Pocet | Stav |
|------|-------|------|
| CRE Comprehensive | 401 | pass |
| Quality Sprint Q | 125 | pass |
| v583 Tier1 | 94 | pass |
| Fixes v582 | 92 | pass |
| Lifecycle Handoff | 83 | pass |
| Lifecycle DB | 71 | pass |
| Chat Fixes | 58 | pass |
| Chat Pipeline | 52 | pass |
| Chat Output Quality | 45 | pass |
| CRE Gatekeeper | 43 | pass |
| Modules | 23 | pass |
| Lifecycle unit | 103 | pass |
| Design Tests | 100 | pass |
| Sprint D | 21 | pass |
| Expert A/B (A7) | 5 (LLM) | pass (5/5 win/tie) |
| Lifecycle Real LLM (C3) | 10 (LLM) | pass |
| E2E Quality Deep | 36 (LLM) | 89-97% |
| Chat Quality | 33 (LLM) | 32/33 |
| **Deterministicke celkem** | **~1400+** | **pass** |

### E2E Quality Deep — aktualni stav (2026-02-19)

| Kategorie | Stav | Poznamka |
|-----------|------|----------|
| S: Vyhledavani | 89% (8/9) | S1 flaky (zavisle na search API) |
| R: Reportovani | 100% (6/6) | Stabilni |
| F: Fakta | 100% (9/9) | Stabilni |
| T: Technicka expertiza | 75% (9/12) | T1, T7 depth; T12 CZ jazyk |
| **Celkem** | **89%** | Deterministicke fixy hotove, zbyva LLM variance |

---

## Architektura

```
User Input
  |
  v
ChatController.handle()
  |
  v
ConversationHandler
  |-- Lifecycle intercept (SPEC/BUILD/REVIEW)
  |     |-- getLcStateByProject() RAM lookup (v65.6 — sessionId mismatch fix)
  |     |-- DB fallback for state restoration
  |-- Agent Wizard intercept (B9)
  |-- CRE classifyIntent() --> LOCAL | CONVERSATIONAL | SEARCH | DESIGN | CREATIVE | BUILD | CODE
  |-- Expert handler (single or merged multi-expertise)
  |     |-- mergeExpertisePrompt() (pure function, max 3 expertises)
  |     |-- LLM generation (with merged prompt + temperature)
  |     |-- ExpertEnforcer (retry with temp decay, strict mode)
  |     |-- enforceCapabilities() (5D drift detection)
  |     |-- logLlmExecution() (prompt hash, latency, tokens)
  |-- Tool execution (TOOL_CALL)
  |     |-- sanitizeSearchQuery() → canonicalizeQuery()
  |     |-- Circuit breaker (per-session, 5 failures / 30s reset)
  |     |-- Auto-retry (retryable failures, max 1)
  |-- LLM synthesis (synthesis.js)
  |     |-- Quality pre-processing (relevance, trust, confidence)
  |     |-- Prompt construction (language FIRST, intent contracts)
  |     |-- Retry loop (MAX_RETRIES=1): link check → fluff → D6 → language → QGv2 score
  |-- Quality Gate v2 (quality-gate-v2.js)
  |     |-- Layer 1: Structural Fix (JSON leak, whitespace, CJK)
  |     |-- Layer 2: Language Fix (SK→CZ transliterator ~160 rules + unconditional strip)
  |     |-- Layer 3: Intent Guarantees (LinkGuard, FACTUAL numbers, REPORT length)
  |     |-- Layer 4: Content Enforcement (zombie/sparse detection — flag only)
  |
  v
Response (text + metadata + executionTraceId)
```

### CRE Intent Routing

| Intent | Handler | Popis |
|--------|---------|-------|
| LOCAL | Deterministic | Cas, datum, kalkulacka, konverze |
| CONVERSATIONAL | LLM synthesis | Bezna konverzace |
| SEARCH | WebSearch + synthesis | Fresh data dotazy |
| DESIGN | Design pipeline | Strukturovane navrhy (SessionState lifecycle) |
| CREATIVE | LLM synthesis | Pribehy, basne, kreativni obsah |
| BUILD | Planner pipeline | Stavba projektu |
| CODE | LLM synthesis | Inline kod (bez projektu) |

### Quality Gate v2 Pipeline (deterministicky, bez LLM)

```
LLM Output
  |
  v
Layer 1: Structural Fix
  |-- JSON leak extraction (response = raw JSON → extract .content)
  |-- Whitespace normalization (3+ newlines → 2)
  |-- CJK character contamination strip
  |
  v
Layer 2: Language Fix (only for lang=cs)
  |-- 2a. detectSlovakContamination() → if >=2 markers:
  |       mechanicalSlovakToCzech(text, aggressive=count>=3)
  |       ~160 regex rules + 6 aggressive suffix patterns
  |-- 2b. Unconditional SK strip (always runs):
  |       Characters: l→l, o→u
  |       Words: co→co, nie je→neni, mozno→mozna, nejaky→nejaky, ...
  |-- 2c. Detect remaining EN/Cyrillic issues (flag only)
  |
  v
Layer 3: Intent Guarantees
  |-- LinkGuard: SEARCH + <2 links → inject sourceUrls deterministically
  |-- FACTUAL: must contain >=1 number
  |-- REPORT: must have >=200 chars content
  |
  v
Layer 4: Content Enforcement (flag only)
  |-- Zombie detection ("Jako jazykovy model...", "I apologize...")
  |-- Sparse content (<20 chars)
  |
  v
Score (0-100), Severity (NONE/LOW/MEDIUM/HIGH), Flags
```

---

## Klicove soubory

### CRE Decision Engine
```
src/chat/cre-decision.js          # ~2900 radku — klasifikace intentu, patterns, typo normalizace
src/chat/cre-decision-types.js    # CREDecision ADT, DecisionType, IntentType
  # v64.0: overrideDecision(), logIntercept(), bindAuditDb()
  # cre_override_log tabulka — audit trail vsech bypassu
src/chat/cre-routing-patches.js   # CRE routing patches (SHELL negative lookahead etc.)
```

### Chat Pipeline
```
src/chat/controller.js             # ChatController (~1870 radku) — vstupni bod pro chat
src/chat/handlers/conversation.js  # ConversationHandler (~778 radku) — routing, lifecycle intercept, DESIGN session
src/chat/handlers/clarification.js # Clarification resolution (v64.0 Gatekeeper)
src/chat/handlers/expert.js        # Expert handler (~869 radku) — single + merge path, enforcement, trace
src/chat/handlers/decisions.js     # Shared decision sub-handlers (~1329 radku) — enrichSearchQuery, followup
src/chat/handlers/lifecycle-router.js   # Lifecycle router (~672 radku) — SPEC/BUILD/REVIEW message handling
src/chat/handlers/lifecycle-state.js    # Lifecycle state (~166 radku) — RAM map, getLcStateByProject(), preload
src/chat/handlers/build-handoff.js      # BUILD handoff (~553 radku)
src/chat/handlers/agent-wizard.js       # Agent creation wizard (~671 radku) (B9)
src/chat/handlers/design.js             # Design pipeline (~634 radku)
src/chat/handlers/utils/synthesis.js    # LLM synteza (~1085 radku) + Output Gate (D6) + retry loop
src/chat/handlers/utils/followup.js     # Follow-up detection (v64.0 Gatekeeper)
src/chat/handlers/utils/quality.js      # Quality evaluators (~541 radku) — fluff, hedging, sections
src/chat/handlers/utils/language-enforcement.js  # SK→CZ transliterator (~559 radku) ~160 rules, EN/Cyrillic detekce
src/chat/handlers/utils/language.js     # detectLanguage() (~505 radku) — CZ/SK/EN/DE/PL disambiguace
src/chat/handlers/utils/project-context-prompt.js # Project context injection (v65.4)
src/chat/handlers/utils/response-sanitizer.js    # CJK strip, response cleanup
src/chat/handlers/utils/output-gate.js  # D6 response validation
src/chat/conversation-store.js     # Session persistence (~636 radku) (SQLite)
src/chat/export-pipeline.js        # Chat export (DOCX, PDF)
```

### Quality Pipeline (v62.3+)
```
src/chat/quality/quality-gate-v2.js    # QGv2 — 4-layer deterministic pipeline
src/chat/quality/quality-pipeline.js   # Orchestrator — wraps QGv2 with logging
src/chat/quality/drift-guard.js        # Drift guard (language drift detection)
src/chat/quality/confidence-scaling.js # Confidence calculation (source trust, relevance)
src/chat/quality/relevance-filter.js   # Tool result relevance scoring
src/chat/quality/source-trust.js       # Source trust weighting (official/media/community)
src/chat/quality/creative-depth.js     # Creative depth scoring
src/chat/quality/index.js              # Quality module exports
```

### Expert System (v63)
```
src/experts/expert-layer.js        # 15 built-in experts (~1838 radku), ExpertAgent, resolveInheritance()
src/experts/expert-store.js        # Expert config persistence + validation (~917 radku)
src/experts/expert-enforcement.js  # ExpertEnforcer: forbidden phrases, retry, strict mode
src/experts/merge-engine.js        # mergeExpertisePrompt() — 15.5-step pure function (~573 radku)
src/experts/merge-types.js         # MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError
src/experts/merge-compatibility.js # checkCompatibility() — 5D pairwise conflict detection
src/experts/capability-enforcer.js # Post-response 5D capability drift validation
src/experts/capability-mapping.js  # Capability vector → prompt/temperature/enforcement modifiers
```

### Agent Platform (Phase B)
```
src/agents/runner.js               # Execution engine (~1339 radku)
src/agents/scheduler.js            # Cron/interval scheduling
src/agents/repository.js           # SQLite CRUD (~662 radku)
src/agents/conditions.js           # Deterministic evaluator (~551 radku)
src/agents/triggers.js             # Edge detection
src/agents/multi-source.js         # Cross-source dedup, health tracking
src/agents/worker-configs.js       # Weather, realty, news templates
src/agents/schema.js               # Validation whitelist + normalizeAgentDefinition() (~619 radku)
src/agents/api.js                  # Agent API handlers (~857 radku)
```

### LLM + Tools
```
src/llm/gateway.js                # LLM Gateway (~535 radku) s auth tokeny
src/llm/client.js                 # Ollama klient
src/llm/cre-bridge.js             # CRE ↔ LLM bridge
src/llm/web-search.js             # Web search tool (~930 radku) (multi-provider, sparse/zero recovery)
src/llm/prompts.js                # System prompts
src/executor/tool-executor.js     # Tool executor (~1500 radku) (circuit breaker, sanitize, retry)
src/executor/c3-tool-executor.js  # C3 tool executor (~699 radku) (shell sandbox, file ops)
src/executor/query-canonicalizer.js # Query canonicalization
src/executor/shell-security.js     # Shell command security (path traversal, injection)
```

### Routes (HTTP API)
```
src/routes/projects.js            # Project routes (~967 radku) — CRUD, lifecycle/start, lifecycle/bind
src/routes/experts.js             # Expert routes (~788 radku) — CRUD, merge-preview, schema
src/routes/chat.js                # Chat routes — /api/chat, /api/conversations, export
src/routes/agents.js              # Agent routes — CRUD, dry-run, schema
src/routes/planner.js             # Planner routes — /api/planner, /api/build
src/routes/architect.js           # Architect routes — /api/architect
src/routes/misc.js                # Misc routes — /api/health, /api/logs, /api/reset
```

### Database
```
src/db/database.js                # SQLite schema (~1328 radku), 54 tabulek (vcetne FTS)
src/db/migrate.js                 # Migration runner — runMigrations(), getCurrentVersion()
src/db/migrations/                # 5 migracnich souboru (timestamp-based)
  # 001_baseline — core tables (projects, conversations, messages, agents, experts...)
  # 002_v57 — agent_seen_items_v57, notification_trust_actions_v57
  # 003_v63 — conversation_expertises, merge_audit_log, capability_drift_log, llm_execution_log
  # 004_v63_3 — execution_trace_id columns, execution_step, prompt_hash
  # 005_v64 — cre_override_log (Gatekeeper audit trail)
```

### WebSocket Bridge
```
src/ws-bridge/ws-server.js        # WS server — attachWebSocketServer(), handshake, channel routing
src/ws-bridge/session-adapter.js  # Session adapter — processChat(), handleControl(), handleTerminal()
src/ws-bridge/protocol.js         # Protocol constants — PROTOCOL_VERSION, Channel, message builders
src/ws-bridge/file-watcher.js     # File watcher — watchProject(), unwatchProject()
src/ws-bridge/index.js            # Public API exports
```

### Server
```
src/server.js                     # Express HTTP server (~855 radku), port 3335
  # Route mounting, middleware, CORS, static files
  # Feature flag gated lazy imports (agents, lifecycle, experts)
  # Scheduler init, preload active sessions + lifecycles
src/config.js                     # Konfigurace (~142 radku) — server, ollama, modely, feature flags
```

### IDE (C3 Studio)
```
c3-ide/                           # C3 Studio IDE — Theia 1.65.2
c3-ide/extensions/c3-chat-panel/  # Chat panel + WS client + transport layer
c3-ide/extensions/c3-center-views/ # Center views + Expertise Wizard
c3-ide/extensions/c3-detail-panel/ # Detail panel s capability bars
c3-ide/docs/C3-STUDIO-IDE.md     # IDE dokumentace
c3-ide/docs/C3-STUDIO-ROADMAP.md # 5-phase integration roadmap
```

### Testy
```
# Deterministicke unit testy (bez Ollama) — 91 souborů, 41,480 radku
tests/cre-comprehensive.test.js      # 401 — CRE klasifikace
tests/quality-sprint-q.test.js       # 125 — Quality pipeline
tests/v583-tier1.test.js             # 94 — CRE regression
tests/fixes-v582.test.js             # 92 — Bug fix regression
tests/lifecycle-handoff.test.js      # 83 — Lifecycle handoff
tests/lifecycle-db.test.js           # 71 — Lifecycle DB
tests/chat-fixes.test.js             # 58 — Chat fixes
tests/chat-pipeline.test.js          # 52 — Chat pipeline
tests/chat-output-quality.test.js    # 45 — Output quality
tests/cre-gatekeeper.test.js         # 43 — CRE Gatekeeper audit trail
tests/lifecycle.test.js              # 103 — Lifecycle unit
tests/modules.test.js                # 23 — Module imports

# E2E testy (vyzaduji Ollama + GPU)
tests/e2e-quality-deep.cjs          # 36 testu — LLM quality across S/R/F/T categories
tests/chat-quality.test.js          # 33 testu — Konverzacni kvalita
tests/conv-czech.test.js            # CZ konverzace
tests/conv-english.test.js          # EN konverzace
```

---

## Spusteni

### Backend
```bash
cd ~/Projects/c3-agent-wip
# DULEZITE: Pouzij Node.js 22+ (nvm)
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
node src/server.js
# Server na http://127.0.0.1:3335
# Chat UI: http://127.0.0.1:3335/architect
# WS: ws://127.0.0.1:3335/c3/ws
```

### Prerekvizity
- Node.js 22+ (system node 18 NESTACI — potreba nvm)
- Ollama s modelem qwen2.5:32b (http://127.0.0.1:11434)
- SQLite (better-sqlite3)

### Testy
```bash
# Vsechny deterministicke (789+ testu)
node tests/modules.test.js
node tests/chat-fixes.test.js
node tests/chat-pipeline.test.js
node tests/cre-gatekeeper.test.js
node tests/chat-output-quality.test.js
node tests/v583-tier1.test.js
node tests/quality-sprint-q.test.js
node tests/fixes-v582.test.js
node tests/lifecycle.test.js
node tests/lifecycle-handoff.test.js
node tests/lifecycle-db.test.js

# E2E (vyzaduje Ollama + GPU)
node tests/e2e-quality-deep.cjs      # ~32-35/36 (89-97%), LLM-dependent
node tests/chat-quality.test.js      # ~32/33
```

---

## API Endpoints

### Chat
| Method | Path | Popis |
|--------|------|-------|
| POST | /api/chat | Hlavni chat endpoint |
| GET | /api/conversations | Seznam konverzaci |
| GET | /api/conversations/:id | Detail konverzace |
| DELETE | /api/conversations/:id | Smazat konverzaci |
| POST | /api/conversations/:id/export | Export (DOCX/PDF) |
| GET | /api/context | Kontextove info pro IDE |

### Projects
| Method | Path | Popis |
|--------|------|-------|
| GET | /api/projects | Seznam projektu |
| POST | /api/projects | Vytvorit projekt |
| GET | /api/projects/:id | Detail projektu |
| PUT | /api/projects/:id | Update projektu |
| DELETE | /api/projects/:id | Smazat projekt |
| POST | /api/projects/open-folder | Registrovat existujici slozku |
| POST | /api/projects/lifecycle/start | Spustit lifecycle (SPEC faze) |
| POST | /api/projects/lifecycle/bind | Navazat konverzaci na projekt |

### Agents
| Method | Path | Popis |
|--------|------|-------|
| GET | /api/agents | Seznam agentu |
| POST | /api/agents | Vytvorit agenta |
| GET | /api/agents/:id | Detail agenta |
| PUT | /api/agents/:id | Update agenta |
| DELETE | /api/agents/:id | Smazat agenta |
| POST | /api/agents/dry-run | Dry-run (validace + normalizace) |
| GET | /api/agents/schema | Agent schema (types, presets) |
| POST | /api/agents/:id/run | Manualni spusteni |

### Experts
| Method | Path | Popis |
|--------|------|-------|
| GET | /api/experts | Seznam expertu |
| POST | /api/experts | Vytvorit experta |
| GET | /api/experts/:id | Detail experta |
| PUT | /api/experts/:id | Update experta |
| DELETE | /api/experts/:id | Smazat experta |
| POST | /api/merge-preview | Preview merge dvou expertu |
| GET | /api/expertise-schema | Expert schema (capabilities, modules) |
| POST | /api/expertise-wizard/test-prompt | Test LLM s expert promptem |

### Trust & Notifications
| Method | Path | Popis |
|--------|------|-------|
| POST | /api/notifications/:id/feedback | Feedback (useful/not_useful) |
| GET | /api/trust/metrics | Trust metriky vsech agentu |
| GET | /api/trust/metrics/:agentId | Trust metriky jednoho agenta |
| POST | /api/trust/:agentId/unmute | Unmute agenta |
| POST | /api/trust/:agentId/reset | Reset feedback (dev) |

### Planner & Build
| Method | Path | Popis |
|--------|------|-------|
| POST | /api/planner/analyze | Analyza projektu |
| POST | /api/build/start | Spustit build |
| GET | /api/build/status | Status buildu |

### Setup Wizard (v65.7)
| Method | Path | Popis |
|--------|------|-------|
| GET | /api/setup/status | Stav setup wizardu |
| POST | /api/setup/ollama | Nastavit + overit Ollama URL |
| POST | /api/setup/language | Nastavit jazyk (cs/en) |
| POST | /api/setup/notifications | Nastavit notifikacni kanal |
| POST | /api/setup/license | Nastavit licencni klic |
| POST | /api/setup/complete | Dokoncit setup |

### License (v65.7)
| Method | Path | Popis |
|--------|------|-------|
| GET | /api/license/status | Tier, features, expiry, owner |

### Misc
| Method | Path | Popis |
|--------|------|-------|
| GET | / | Health check + version + setupComplete |
| GET | /api/health | Health check |
| GET | /api/logs | Aplikacni logy |
| GET | /api/logs/export | Export logu |
| POST | /api/reset | Reset nastaveni |
| POST | /api/autocomplete | Autocomplete pro IDE |

### WebSocket
| Path | Popis |
|------|-------|
| ws://host:3335/c3/ws | IDE WS bridge — channels: chat, control, terminal, workspace |

---

## Klicove kontrakty

### 1. CRE je jedina autorita
Vsechny chat zpravy prochazi CRE klasifikaci. Zadny bypass.

### 2. mergeExpertisePrompt() je cista funkce
15.5-krokovy algoritmus, frozen vystupy, zadne side effects. TraceId se pridava az v handleru pri persistenci.

### 3. ExpertEnforcer retry kontrakt
- Max 2 retries s temperature decay (0.1/attempt) a top_p decay (0.05/attempt)
- Strict mode: `hardFail=true` → response = null po vycerpani retries
- Retry audit trail s executionTraceId a executionStep

### 4. 5D Capability Vector
Kazdy expert ma profil: `{reasoning, creativity, determinism, riskTolerance, verbosity}` (0-100).
Merge engine pouziva weighted average pro capability modifiers.

### 5. ExecutionTrace kontrakt (v63.3)
- Jeden UUID per user turn — NEMENI se pri retry
- Propojuje: llm_execution_log → retryAudit → capability_drift_log → merge_audit_log
- Prompt SHA-256 hash pro determinism analyzu
- traceId v ResponseTag metadata jen za `context.debug` flag

### 6. QGv2 kontrakt (v62.3+)
- **Deterministicky** — zadne LLM volani, zadny retry, zadne nove vety
- **Idempotentni** — bezpecne spustit vicekrat
- **4 vrstvy:** structural → language → intent → content
- **Scoring:** 0-100 (output = issues only, raw = issues + fix penalties)
- **Unconditional SK strip:** l, o a kriticka SK slova se stripuji VZDY pro lang=cs

### 7. Output Gate (D6)
Kazda LLM odpoved projde quality gatem: fluff check, hedging check, language leak check.

### 8. ESM projekt
`package.json` ma `"type": "module"`. IDE soubory jsou .cjs (CommonJS v Theia kontextu).

### 9. CRE Gatekeeper (v64.0)
Zadne rozhodnuti nevznika mimo `CRE.decide()` nebo `CRE.overrideDecision()`.
Vsechny bypass pointy (35) routuji pres `overrideDecision()` (audit trail) nebo `logIntercept()` (pre-CRE stateful routes).
Kazdy override logovan do `cre_override_log` tabulky.

### 10. Lifecycle Session Routing (v65.6)
- `lifecycle/start` generuje korektni `lcId = lc-<timestamp>-<random>` (ne NULL)
- `getLcStateByProject(projectId)` RAM lookup pri sessionId mismatch
- State migrace z puvodniho sessionId na novy WS sessionId

### 11. Product Modules (v65.7)
- **Setup Wizard**: `SetupWizard` class v `src/setup/wizard.js`, first-run detection pres `isComplete()`, API routes pres `createSetupRoutes(wizard, deps)`
- **Auto-updater**: `startUpdateChecker(callback)` v `src/packaging/auto-updater.js`, aktivni jen pri `C3_UPDATE_REPO` env var, `stopUpdateChecker()` v shutdown
- **License**: `licenseManager` singleton v `src/licensing/license.js`, 3 tiers (FREE/PRO/ENTERPRISE), HW fingerprint, HMAC signing, FREE tier gatuje agent/worker routes (403)

---

## Zname problemy a omezeni

### LLM Variance (qwen2.5:32b)
- T1 ("mobilni app"): LLM obcas nevraci dostatecnou hloubku (~depth < 5)
- T7 ("motorky"): Podobny problem s depth u porovnani
- T12 ("React/Vue/Angular"): LLM obcas odpovi v EN misto CZ
- S1: Zavisle na search API dostupnosti — kdyz search tool nevrati vysledky, LinkGuard nemuze injektovat URL

### SK Kontaminace
- qwen2.5:32b ma tendency generovat slovensky misto cesky (sdileny corpus)
- Reseno v 3 vrstvach: system prompt instruction, synthesis retry, QGv2 mechanical transliterator
- Unconditional strip l/o + kritickych SK slov pridan pro edge cases pod detection threshold

### Language Detection
- `detectLanguage()` v language.js muze misklasifikovat CZ dotazy bez r/e/u jako SK
- Fixnuto pridanim CZ-unique words (jak, co, podle, proc, zda) do CZ patterns
- "si" presunuto z SK-only do shared CZ/SK

### better-sqlite3 segfaults
- Pri vysoke zatezi (paralelni LLM testy) muze native modul spadnout
- Fix: `npm rebuild better-sqlite3`

---

## Poznamky pro pokracovani

1. **Nejdriv testy** — pred jakoukoli zmenou spust existujici testy
2. **ESM** — `import/export`, IDE soubory `.cjs` (CommonJS)
3. **Ceska diakritika** — `\b` nefunguje s non-ASCII; pouzij `(?:\s|$|[?!.,;])` misto `\b`
4. **Ollama model** — `qwen2.5:32b` je vychozi model pro vsechny LLM volani
5. **Merge engine nedotykej** — `merge-engine.js` je cista funkce, zmeny jen v handleru
6. **Node.js 22+** — system node 18 nestaci, pouzij nvm: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"`
7. **E2E testy** — `e2e-quality-deep.cjs` je LLM-dependent, ocekavej 89-97% pass rate (ne 100%)
8. **package.json verze** — `"version": "65.5.0"` v package.json

---

*Posledni aktualizace: v65.7 (2026-02-19)*
