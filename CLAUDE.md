# CLAUDE.md - C.3 Agent Development Context

**Verze:** v63.3
**Datum:** 2026-02-14
**Projekt:** ~/Projects/c3-agent-wip

---

## Aktualni stav

C.3 Agent je plne funkcni conversational AI platforma s:
- **CRE** (Conversational Reasoning Engine) — single-authority decision engine
- **Expert System** (v63) — 15 built-in expertu s 5D capability profily, multi-expertise merge engine, enforcement pipeline, execution trace observability
- **Agent Platform** — deterministicke worker agenty se zdroji, podminkami, triggery, notifikacemi
- **Project Lifecycle** — milnikove rizeni projektu s crash recovery
- **C3 Studio IDE** — Theia 1.65.2, custom panely, linked sessions, wizard UI

### Branch: `master`

### Testovaci pokryti

| Sada | Pocet | Stav |
|------|-------|------|
| CRE Comprehensive | 401 | pass |
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
| E2E (framework) | 60 | pass |
| IDE Sprint 1-7 | ~215 | pass |
| **Celkem** | **~1130** | **pass** |

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
  |-- LLM synthesis + Output Gate (D6)
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

---

## Klicove soubory

### CRE Decision Engine
```
src/chat/cre-decision.js          # ~2400 radku — klasifikace intentu, patterns, typo normalizace
src/chat/cre-decision-types.js    # CREDecision ADT, DecisionType, IntentType
```

### Chat Pipeline
```
src/chat/controller.js             # ChatController — vstupni bod pro chat
src/chat/handlers/conversation.js  # ConversationHandler — routing, DESIGN session
src/chat/handlers/expert.js        # Expert handler — single + merge path, enforcement, trace
src/chat/handlers/decisions.js     # Shared decision sub-handlers
src/chat/handlers/utils/synthesis.js  # LLM synteza + Output Gate (D6)
src/chat/handlers/utils/quality.js    # Quality evaluators (fluff, hedging, sections)
src/chat/handlers/utils/language-enforcement.js  # SK→CZ preklad, EN detekce
src/chat/conversation-store.js     # Session persistence (SQLite)
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
src/llm/web-search.js             # Web search tool
src/executor/tool-executor.js     # Tool executor
```

### Database
```
src/db/database.js                # SQLite schema (28+ tables)
  # v63 tabulky: conversation_expertises, merge_audit_log,
  #              capability_drift_log, llm_execution_log
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
  #            /api/expertise-wizard/test-prompt
src/config.js                     # Konfigurace (server, ollama, modely)
```

### Testy
```
tests/merge-engine.test.js           # 40 — multi-expertise composition
tests/merge-compatibility.test.js    # 16 — 5D conflict detection
tests/merge-enforcement-integration.test.js # 15 — merge → enforcement pipeline
tests/capability-enforcer.test.js    # 38 — 5D evaluators, drift, strict, retry, trace
tests/execution-trace-stress.test.js # 20 — 3-expert merge + full trace reconstruction
tests/expertise-wizard.test.js       # 38 — validation, modules, capabilities
tests/expert-system.test.js          # 40 — single expert flow, built-in experts
tests/expert-integration.test.js     # 10 — expert + DB + handler pipeline
tests/cre-comprehensive.test.js      # 401 — CRE klasifikace
```

---

## Spusteni

### Backend
```bash
cd ~/Projects/c3-agent-wip
node src/server.js
# Server na http://127.0.0.1:3335
# Chat UI: http://127.0.0.1:3335/architect
```

### Prerekvizity
- Node.js 18+
- Ollama s modelem qwen2.5:32b (http://127.0.0.1:11434)
- SQLite (better-sqlite3)

### Testy
```bash
# Expert system + merge engine (217 testu)
node tests/merge-engine.test.js
node tests/merge-compatibility.test.js
node tests/merge-enforcement-integration.test.js
node tests/capability-enforcer.test.js
node tests/execution-trace-stress.test.js
node tests/expertise-wizard.test.js
node tests/expert-system.test.js
node tests/expert-integration.test.js

# CRE + core
node tests/cre-comprehensive.test.js
node tests/notifications.test.js
node tests/workflow.test.js
node tests/trust-feedback.test.js

# Konverzacni testy (vyzaduje Ollama + GPU)
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

### 6. Output Gate (D6)
Kazda LLM odpoved projde quality gatem: fluff check, hedging check, language leak check.

### 7. ESM projekt
`package.json` ma `"type": "module"`. IDE soubory jsou .cjs (CommonJS v Theia kontextu).

---

## Poznamky pro pokracovani

1. **Nejdriv testy** — pred jakoukoli zmenou spust existujici testy
2. **ESM** — `import/export`, IDE soubory `.cjs` (CommonJS)
3. **Ceska diakritika** — `\b` nefunguje s non-ASCII; pouzij `(?:\s|$|[?!.,;])` misto `\b`
4. **Ollama model** — `qwen2.5:32b` je vychozi model pro vsechny LLM volani
5. **Merge engine nedotykej** — `merge-engine.js` je cista funkce, zmeny jen v handleru

---

*Posledni aktualizace: 2026-02-14*
