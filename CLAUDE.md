# CLAUDE.md - C.3 Agent Development Context

**Verze:** v36.9.0
**Datum:** 2026-01-24
**Projekt:** ~/Projects/c3-agent-wip

---

## 🎯 Aktuální stav

C.3 Agent prochází architektonickou konsolidací CRE (Conversational Reasoning Engine) z bypass-able chatu na single-authority decision engine.

### Aktivní branch

```bash
git checkout cre-v36.9
```

### Dokončené commity

| Commit | Verze | Popis | Testy |
|--------|-------|-------|-------|
| **COMMIT 1** | v36.7 | LLM Gateway Lockdown | 50 |
| **COMMIT 2** | v36.8 | Tool-First CREDecision Contract | 46 |
| **COMMIT 3** | v36.9 | ResponseRenderer + Single LLM Call | 29 |

### Celkem testů: 342 passing

---

## 📁 Klíčové soubory

### LLM Gateway (v36.7)
```
src/llm/auth-types.js      # LLMCallerRole, LLMCapability, createAuthToken()
src/llm/gateway.js         # Centrální LLMGateway singleton
src/llm/client.js          # Legacy wrapper (routes through gateway)
```

### CRE Decision Types + ResponseRenderer (v36.8-v36.9)
```
src/chat/cre-decision-types.js   # CREDecision ADT, validators
src/chat/response-renderer.js    # Full impl: static + synthesize + QualityGate (v36.9)
```

### Core CRE
```
src/chat/cre-v2.js              # Main CRE engine
src/chat/dialog-state-v2.js     # Dialog state management
src/chat/decision-matrix.js     # Decision rules
src/chat/capability-registry.js # Tool capabilities
src/chat/answer-quality-gate.js # Output sanitization
```

### Testy
```
src/tests/llm-gateway.test.js        # 50 tests
src/tests/cre-decision-types.test.js # 46 tests
src/tests/cre-v2.test.js             # 142 tests
src/tests/capability-truth.test.js   # 28 tests
src/tests/llm-enforcement.test.js    # 29 tests (v36.9)
src/tests/correction-enforcer.test.js # 27 tests
src/tests/cre-v36-e2e.test.js        # 20 tests
```

---

## 🔧 Zbývající commity

### COMMIT 4 — Real Capability Wiring (Safe Tools) — NEXT
```
feat(tools): safe http client + real capability execution
```

**Cíl:** Tools skutečně DĚLAJÍ věci, ne jen "mohu připravit dotaz".

**Nové soubory:**
- `src/tools/http-client.js` - SafeHttpClient s rate limiter + retry
- `src/tools/registry.js` - Tool implementations
- `src/tools/executor.js` - Tool executor with validation

**STOP-CONDITION:**
```bash
# "najdi mi auto" → HTTP request skutečně proběhne
# ŽÁDNÉ: "Mohu ti pomoci připravit dotaz"
```

---

### COMMIT 5 — Memory Policy + Human Gate
```
feat(safety): memory policy layer + human-in-the-loop gate
```

**Nové soubory:**
- `src/memory/policy.js` - MemoryPolicyLayer
- `src/safety/human-gate.js` - HumanGate with approval levels

**STOP-CONDITION:**
```bash
# fs.write / shell.exec → VŽDY projde HumanGate
# CRE → memory.read/write → POUZE přes policy
```

---

## 🚨 Klíčové kontrakty

### 1. LLM Gateway - capability-based auth (v36.9: STRICT by default)
```javascript
// SPRÁVNĚ:
const token = createAuthToken({
  role: 'CRE_DECISION',
  decisionId: uuid(),
  auditContext: { sessionId }
});
llmGateway.authorize(token);
try {
  const result = await llmGateway.call(prompt, { systemPrompt });
} finally {
  llmGateway.revoke();
}

// ŠPATNĚ (throws LLM_CALL_OUTSIDE_CRE):
await callOllama('CHAT', prompt);  // Throws unless ALLOW_LEGACY_LLM=1
```

### 2. CRE Decision - NO content string
```javascript
// ❌ ZAKÁZÁNO (validateDecision ODMÍTNE):
{ type: 'ANSWER', content: 'Nějaký text...' }

// ✅ SPRÁVNĚ:
{ type: 'ANSWER', template: 'factual_answer', data: {...} }
{ type: 'ANSWER', template: 'search_results', dataRef: 'step_1' }
```

### 3. RefusalReason - enum, NOT free text
```javascript
// ✅ SPRÁVNĚ:
refuse('CAPABILITY_NOT_AVAILABLE')
refuse('PERMISSION_DENIED')

// ❌ ŠPATNĚ:
refuse('Nemohu to udělat protože...')
```

---

## 🧪 Spuštění testů

```bash
cd ~/Projects/c3-agent-wip

# Všechny CRE testy (342)
node src/tests/llm-gateway.test.js && \
node src/tests/cre-decision-types.test.js && \
node src/tests/cre-v2.test.js && \
node src/tests/capability-truth.test.js && \
node src/tests/llm-enforcement.test.js && \
node src/tests/correction-enforcer.test.js && \
node src/tests/cre-v36-e2e.test.js

# Quick check
for f in src/tests/*.test.js; do
  echo "=== $f ==="
  node "$f" 2>&1 | grep -E "Passed:|Failed:"
done
```

---

## 🏗️ Architektura po v36.9

```
User → CRE.process() → CREDecision → ToolExecutor → ResponseRenderer → Text
                           │
                           ├─ TOOL_CALL → execute → results
                           ├─ ASK_USER → render slots question
                           ├─ REFUSE → render refusal with reason
                           ├─ ANSWER → template + data → render
                           └─ MULTI_STEP → execute steps → combine
```

**Klíčové principy:**
1. **LLM je TOOL, ne AUTHOR** - CRE decides, LLM executes specific task
2. **SINGLE SOURCE OF TRUTH** - CRE is sole authority
3. **TOOLS ARE PURE** - Tool receives instructions, returns data
4. **RESPONSE IS ASSEMBLED** - template + data + (optional) LLM synthesis
5. **PLANS, NOT TEXT** - CRE returns structure, never raw text

---

## 📊 Roadmap v36.x → v39.x

| Layer | Versions | Deliverable |
|-------|----------|-------------|
| **1. Consolidation** | v36.7-36.9 | CRE = single entry, real tools |
| **2. Memory** | v37.0-37.2 | Session + Long-term + Preferences |
| **3. Multi-step** | v38.0-38.3 | Planner/Executor, Error recovery |
| **4. Autonomy** | v39.0-39.3 | Goals, Safety, Self-correction, Copilot |

---

## 🔗 Odkazy

- **UI:** http://localhost:3335/architect
- **API:** http://localhost:3335/api/
- **Transcripts:** /mnt/transcripts/

---

## 📝 Poznámky pro pokračování

1. **Nejdřív testy** - před jakoukoliv změnou spusť existující testy
2. **Inkrementální změny** - jeden commit = jeden concern
3. **STOP-CONDITIONS** - každý commit má jasné kritérium dokončení
4. **Backward compatibility** - legacy code funguje přes wrappery

---

*Poslední aktualizace: 2026-01-24*
