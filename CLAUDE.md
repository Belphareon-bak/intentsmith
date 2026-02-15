# CLAUDE.md - C.3 Agent Development Context

**Verze:** v65.5
**Datum:** 2026-02-15
**Projekt:** ~/Projects/c3-agent-wip

---

## Aktualni stav

C.3 Agent je plne funkcni conversational AI platforma s:
- **CRE** (Conversational Reasoning Engine) — single-authority decision engine s **CRE Gatekeeper** audit trail (v64.0)
- **Expert System** (v63) — 15 built-in expertu s 5D capability profily, multi-expertise merge engine, enforcement pipeline, execution trace observability
- **Quality Gate v2** (v62.3+) — deterministicky post-processing pipeline: structural fix, SK→CZ transliterator (~160 regexu), LinkGuard, content enforcement
- **Agent Platform** — deterministicke worker agenty se zdroji, podminkami, triggery, notifikacemi + **Agent Builder Wizard (v65.5)**
- **Project Lifecycle** — milnikove rizeni projektu s crash recovery + **project context injection (v65.4)**
- **C3 Studio IDE** — Theia 1.65.2, custom panely, linked sessions, expertise wizard, agent builder wizard

### Branch: `master`

### Testovaci pokryti

| Sada | Pocet | Stav |
|------|-------|------|
| CRE Comprehensive | 401 | pass |
| CRE Gatekeeper | 43 | pass |
| Schema Migrations | 26 | pass |
| Merge engine | 40 | pass |
| Expert system | 40 | pass |
| Expertise wizard | 38 | pass |
| Capability enforcer | 38 | pass |
| v583 Tier1 | 94 | pass |
| Notifications | 67 | pass |
| Workflow | 42 | pass |
| Trust Feedback | 34 | pass |
| Execution trace stress | 20 | pass |
| Merge compatibility | 16 | pass |
| Merge-enforcement integration | 15 | pass |
| Expert integration | 10 | pass |
| E2E Complex | 5 (43 checks) | pass |
| E2E Quality Deep | 36 (LLM) | 92-97% |
| IDE Sprint 1-7 | ~215 | pass |
| **Celkem** | **~1200+** | **pass** |

### E2E Quality Deep — aktualni stav (4 behy, 2026-02-15)

| Kategorie | Stav | Poznamka |
|-----------|------|----------|
| S: Vyhledavani | 78-100% | S1/S4 flaky (zavisle na search API) |
| R: Reportovani | 83-100% | R3 fixnuta SK kontaminace, LLM stub flaky |
| F: Fakta | 100% | Stabilni |
| T: Technicka expertiza | 83-100% | T11/T12 flaky (LLM non-determinism) |
| **Celkem** | **92-97%** | Deterministicke fixy hotove, zbyva LLM variance |

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
  |-- 2a. detectSlovakContamination() → if ≥2 markers:
  |       mechanicalSlovakToCzech(text, aggressive=count≥3)
  |       ~160 regex rules + 6 aggressive suffix patterns
  |-- 2b. Unconditional SK strip (always runs):
  |       Characters: ľ→l, ô→ů
  |       Words: čo→co, nie je→není, možno→možná, nejaký→nějaký, ...
  |-- 2c. Detect remaining EN/Cyrillic issues (flag only)
  |
  v
Layer 3: Intent Guarantees
  |-- LinkGuard: SEARCH + <2 links → inject sourceUrls deterministically
  |-- FACTUAL: must contain ≥1 number
  |-- REPORT: must have ≥200 chars content
  |
  v
Layer 4: Content Enforcement (flag only)
  |-- Zombie detection ("Jako jazykový model...", "I apologize...")
  |-- Sparse content (<20 chars)
  |
  v
Score (0-100), Severity (NONE/LOW/MEDIUM/HIGH), Flags
```

---

## Klicove soubory

### CRE Decision Engine
```
src/chat/cre-decision.js          # ~2400 radku — klasifikace intentu, patterns, typo normalizace
src/chat/cre-decision-types.js    # CREDecision ADT, DecisionType, IntentType
  # v64.0: overrideDecision(), logIntercept(), bindAuditDb()
  # cre_override_log tabulka — audit trail vsech bypassu
src/chat/cre-routing-patches.js   # CRE routing patches (SHELL negative lookahead etc.)
```

### Chat Pipeline
```
src/chat/controller.js             # ChatController — vstupni bod pro chat
src/chat/handlers/conversation.js  # ConversationHandler — routing, DESIGN session
src/chat/handlers/clarification.js # Clarification resolution (v64.0 Gatekeeper)
src/chat/handlers/expert.js        # Expert handler — single + merge path, enforcement, trace
src/chat/handlers/decisions.js     # Shared decision sub-handlers (enrichSearchQuery, followup)
src/chat/handlers/utils/synthesis.js  # LLM synteza + Output Gate (D6) + retry loop
src/chat/handlers/utils/followup.js   # Follow-up detection (v64.0 Gatekeeper)
src/chat/handlers/utils/quality.js    # Quality evaluators (fluff, hedging, sections)
src/chat/handlers/utils/language-enforcement.js  # SK→CZ transliterator (~160 rules), EN/Cyrillic detekce
src/chat/handlers/utils/language.js  # detectLanguage() — CZ/SK/EN/DE/PL disambiguace
src/chat/handlers/utils/response-sanitizer.js    # CJK strip, response cleanup
src/chat/conversation-store.js     # Session persistence (SQLite)
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
src/experts/expert-layer.js        # 15 built-in experts, ExpertAgent, resolveInheritance()
src/experts/expert-store.js        # Expert config persistence + validation
src/experts/expert-enforcement.js  # ExpertEnforcer: forbidden phrases, retry, strict mode
src/experts/merge-engine.js        # mergeExpertisePrompt() — 15.5-step pure function
src/experts/merge-types.js         # MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError
src/experts/merge-compatibility.js # checkCompatibility() — 5D pairwise conflict detection
src/experts/capability-enforcer.js # Post-response 5D capability drift validation
src/experts/capability-mapping.js  # Capability vector → prompt/temperature/enforcement modifiers
```

### LLM + Tools
```
src/llm/gateway.js                # LLM Gateway s auth tokeny
src/llm/client.js                 # Ollama klient
src/llm/cre-bridge.js             # CRE ↔ LLM bridge
src/llm/web-search.js             # Web search tool (multi-provider, sparse/zero recovery)
src/executor/tool-executor.js     # Tool executor (circuit breaker, sanitize, retry)
src/executor/query-canonicalizer.js # Query canonicalization
src/executor/shell-security.js     # Shell command security (path traversal, injection)
```

### Database
```
src/db/database.js                # SQLite schema (28+ tables)
  # v63 tabulky: conversation_expertises, merge_audit_log,
  #              capability_drift_log, llm_execution_log
  # v64.0: cre_override_log (Gatekeeper audit trail)
src/db/migrations/                # 5 migracnich souboru (timestamp-based)
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

### Server
```
src/server.js                     # Express HTTP server, port 3335
  # Endpoints: /api/merge-preview, /api/expertise-schema,
  #            /api/expertise-wizard/test-prompt, /api/chat
src/config.js                     # Konfigurace (server, ollama, modely)
```

### Testy
```
# Unit testy (deterministicke, bez Ollama)
tests/cre-comprehensive.test.js      # 401 — CRE klasifikace
tests/cre-gatekeeper.test.js         # 43 — CRE Gatekeeper audit trail
tests/schema-migrations.test.js      # 26 — DB schema migrations
tests/merge-engine.test.js           # 40 — multi-expertise composition
tests/merge-compatibility.test.js    # 16 — 5D conflict detection
tests/merge-enforcement-integration.test.js # 15 — merge → enforcement pipeline
tests/capability-enforcer.test.js    # 38 — 5D evaluators, drift, strict, retry, trace
tests/execution-trace-stress.test.js # 20 — 3-expert merge + full trace reconstruction
tests/expertise-wizard.test.js       # 38 — validation, modules, capabilities
tests/expert-system.test.js          # 40 — single expert flow, built-in experts
tests/expert-integration.test.js     # 10 — expert + DB + handler pipeline

# E2E testy (vyzaduji Ollama + GPU)
tests/e2e-complex.test.js           # 5 testu (43 checks) — pipeline, merge, cancel, security
tests/e2e-quality-deep.cjs          # 36 testu — LLM quality across S/R/F/T categories
tests/conv-czech.test.js            # Konverzacni kvalita (CZ)
tests/conv-czech-nodiacritics.test.js # CZ bez diakritiky
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
```

### Prerekvizity
- Node.js 22+ (system node 18 NESTACI — potreba nvm)
- Ollama s modelem qwen2.5:32b (http://127.0.0.1:11434)
- SQLite (better-sqlite3)

### Testy
```bash
# CRE + Gatekeeper (444 testu)
node tests/cre-comprehensive.test.js
node tests/cre-gatekeeper.test.js

# Schema migrations (26 testu)
node tests/schema-migrations.test.js

# Expert system + merge engine (217 testu)
node tests/merge-engine.test.js
node tests/merge-compatibility.test.js
node tests/merge-enforcement-integration.test.js
node tests/capability-enforcer.test.js
node tests/execution-trace-stress.test.js
node tests/expertise-wizard.test.js
node tests/expert-system.test.js
node tests/expert-integration.test.js
node tests/notifications.test.js
node tests/workflow.test.js
node tests/trust-feedback.test.js

# E2E (vyzaduje Ollama + GPU)
node tests/e2e-complex.test.js       # 5/5, 43/43 checks
node tests/e2e-quality-deep.cjs      # ~34/36 (94%), LLM-dependent

# Konverzacni testy
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

---

## Klicove kontrakty

### 1. CRE je jedina autorita
Vsechny chat zpravy prochazi CRE klasifikaci. Zadny bypass.

### 2. mergeExpertisePrompt() je cista funkce
15.5-krokovy algoritmus, frozen vystupy, zadne side effects. TraceId se pridava az v handleru pri persistenci.

### 3. ExpertEnforcer retry kontrakt
- Max 2 retries s temperature decay (0.1/attempt) a top_p decay (0.05/attempt)
- Strict mode: `hardFail=true` → response = null po vyčerpani retries
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
- **Unconditional SK strip:** ľ, ô a kriticka SK slova se stripuji VZDY pro lang=cs

### 7. Output Gate (D6)
Kazda LLM odpoved projde quality gatem: fluff check, hedging check, language leak check.

### 8. ESM projekt
`package.json` ma `"type": "module"`. IDE soubory jsou .cjs (CommonJS v Theia kontextu).

### 9. CRE Gatekeeper (v64.0)
Zadne rozhodnuti nevznika mimo `CRE.decide()` nebo `CRE.overrideDecision()`.
Vsechny bypass pointy (35) routuji pres `overrideDecision()` (audit trail) nebo `logIntercept()` (pre-CRE stateful routes).
Kazdy override logovan do `cre_override_log` tabulky.

---

## Zname problemy a omezeni

### LLM Variance (qwen2.5:32b)
- R3 ("PC pro gaming"): LLM obcas vraci 4-vetny stub misto full reportu (~25% failure rate)
- T11 ("Linux vs Windows"): LLM obcas vynecha pozadovane koncepty (~50% failure rate)
- S1/S4: Zavisle na search API dostupnosti — kdyz search tool nevrati vysledky, LinkGuard nemuze injektovat URL

### SK Kontaminace
- qwen2.5:32b ma tendency generovat slovensky misto cesky (sdileny corpus)
- Reseno v 3 vrstvach: system prompt instruction, synthesis retry, QGv2 mechanical transliterator
- Unconditional strip ľ/ô + kritickych SK slov pridan pro edge cases pod detection threshold

### Language Detection
- `detectLanguage()` v language.js muze misklasifikovat CZ dotazy bez ř/ě/ů jako SK
- Fixnuto pridanim CZ-unique words (jak, co, podle, proc, zda) do CZ patterns
- "si" presunuto z SK-only do shared CZ/SK

---

## Poznamky pro pokracovani

1. **Nejdriv testy** — pred jakoukoli zmenou spust existujici testy
2. **ESM** — `import/export`, IDE soubory `.cjs` (CommonJS)
3. **Ceska diakritika** — `\b` nefunguje s non-ASCII; pouzij `(?:\s|$|[?!.,;])` misto `\b`
4. **Ollama model** — `qwen2.5:32b` je vychozi model pro vsechny LLM volani
5. **Merge engine nedotykej** — `merge-engine.js` je cista funkce, zmeny jen v handleru
6. **Node.js 22+** — system node 18 nestaci, pouzij nvm: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"`
7. **E2E testy** — `e2e-quality-deep.cjs` je LLM-dependent, ocekavej 92-97% pass rate (ne 100%)
8. **package.json verze** — `"version": "58.3.0"` je outdated, realna verze je v65.2

---

*Posledni aktualizace: v65.2 (2026-02-15)*
