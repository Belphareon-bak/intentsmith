# C.3 Agent - Changelog v26.1 (JSON Contract Edition)

**Datum:** 2025-01-08
**Typ:** Major feature release + quality fix

## 🔴 Kritické opravy (v26.1)

### Model názvy
```json
// PŘED (špatně)
"CODE": "qwen25-coder-32b:latest"

// PO (správně)
"CODE": "qwen2.5-coder:32b"
```

### D2 = CODE (stejný model)
D2 MUSÍ být stejný model jako CODE, jinak se rozbije styl a architektura.

### JSON Contracts
Každá role má nyní TVRDÝ JSON contract - žádný "soft text".

---

## 🎯 Hlavní změny

### 0. JSON Contracts (NOVÉ v v26.1)
Každá role má POVINNÝ JSON výstup:

**THINKER:**
```json
{
  "unclear_points": [],
  "assumptions_needed": [],
  "hidden_risks": [],
  "recommend_clarify": true|false
}
```

**ANALYZER:**
```json
{
  "state": "CLARIFY|READY",
  "clarify_questions": [],
  "acceptance_criteria": [{"id": "AC-1", "description": "...", "test_hint": "..."}],
  "risk_level": "LOW|MEDIUM|HIGH"
}
```

**D1 Plan:**
```json
{
  "overview": "...",
  "architecture": {"pattern": "...", "description": "..."},
  "components": [{"file": "/abs/path", "purpose": "...", "exports": [], "dependencies": []}],
  "edge_cases": [{"case": "...", "handling": "..."}],
  "acceptance_criteria_mapping": {"AC-1": ["file:function"]}
}
```

**DESIGN_AUDIT:**
```json
{
  "verdict": "APPROVE|REDESIGN",
  "critical_flaws": [{"flaw": "...", "impact": "...", "location": "..."}],
  "required_changes": []
}
```

**R2A:**
```json
{
  "verdict": "PASS|FAIL",
  "ac_results": [{"id": "AC-1", "status": "PASS|FAIL", "reason": "..."}],
  "fix_required": []
}
```

**R2B (jen HIGH risk):**
```json
{
  "verdict": "PASS|FAIL",
  "vulnerabilities": [{"type": "...", "description": "...", "severity": "..."}],
  "crash_scenarios": []
}
```

### 1. Acceptance Criteria jako GATE
- AC jsou POVINNÉ (min 2)
- R2A kontroluje splnění KAŽDÉHO AC
- Pokud AC chybí, ANALYZER je musí vygenerovat

### 2. Risk-based R2B
- R2B (adversarial) běží POUZE při `risk_level: "HIGH"`
- LOW/MEDIUM → přeskočí R2B → šetří tokeny

### 3. D1 Model Change
**Problém:** deepseek-r1 ignoroval strukturovaný formát plánu
**Řešení:** D1 nyní používá qwen2.5:32b

```json
// Před (v25)
"D1": "deepseek-r1-32b:latest"

// Po (v26)
"D1": "qwen2.5:32b"
```

### 2. Nový DESIGN_AUDIT krok
**Problém:** Plány měly architektonické díry které se projevily až při implementaci
**Řešení:** Nový DESIGN_AUDIT krok (deepseek-r1) zpochybňuje plán PŘED user confirmation

```
D1 (plan) → DESIGN_AUDIT → [REDESIGN loop max 2x] → User confirms
```

**DESIGN_AUDIT kontroluje:**
- Chybějící komponenty
- Architektonické problémy
- Edge cases v designu
- Bezpečnostní díry

### 3. R2 Split (R2.a + R2.b)
**Problém:** R2 dělal příliš mnoho věcí najednou
**Řešení:** Rozdělení na dva specializované review kroky

| Role | Model | Zaměření |
|------|-------|----------|
| R2.a | qwen2.5:32b | Intent review - soulad s plánem |
| R2.b | deepseek-r1 | Adversarial - edge cases, security |

**Klíčové pravidlo:** R2.b NEPOSKYTUJE návrhy řešení!

### 4. Upravený Fix Flow
**Před (v25):**
```
R2 FAIL → D2 → CODE → R2
```

**Po (v26):**
```
R2.a FAIL → D2 → CODE → R2.a
R2.b FAIL → D2 → CODE → R2.a (NOT R2.b!)
```

Opravy jdou vždy zpět na R2.a aby se ověřil soulad s plánem.

---

## 📦 Změněné soubory

| Soubor | Změna |
|--------|-------|
| `workflow-agent.js` | Nový workflow s DESIGN_AUDIT, R2.a, R2.b |
| `ollama-client.js` | Timeout config pro nové role |
| `role-model-binding.json` | Nové mapování (D1→qwen, +DESIGN_AUDIT, +R2A, +R2B) |

---

## 🔧 Nové role prompty

### DESIGN_AUDIT
```
Jsi DESIGN_AUDIT - kritický reviewer architektonických rozhodnutí.
Tvým úkolem je ZPOCHYBNIT plán a NAJÍT DÍRY.

PŘÍSTUP:
- Buď skeptický - hledej problémy, ne důvody proč to funguje
- Představ si nejhorší scénáře
- Mysli jako útočník/tester
```

### R2A_INTENT
```
Jsi R2.a - reviewer souladu s plánem.
ZKONTROLUJ:
1. Jsou VŠECHNY soubory z plánu implementovány?
2. Odpovídá struktura kódu plánu?
3. Jsou implementovány VŠECHNY funkce z plánu?

IGNORUJ (to zkontroluje R2.b):
- Edge cases
- Bezpečnostní problémy
```

### R2B_ADVERSARIAL
```
Jsi R2.b - adversarial reviewer.
Tvým úkolem je HLEDAT PROBLÉMY a zjistit CO SE ROZBIJE.

⚠️ KRITICKÉ: NEPOSKYTUJ NÁVRHY ŘEŠENÍ! Pouze identifikuj problémy.
```

---

## ⚙️ Konfigurace

### Nové timeouty (ollama-client.js)
```javascript
ROLE_TIMEOUTS = {
  THINKER: 120000,     // 2 min
  ANALYZER: 30000,     // 30s
  D1: 120000,          // 2 min (sníženo, qwen je rychlejší)
  DESIGN_AUDIT: 180000,// 3 min
  CODE: 300000,        // 5 min
  R2A: 60000,          // 1 min
  R2B: 120000,         // 2 min
  D2: 120000,          // 2 min
}
```

### Nové max_tokens (ollama-client.js)
```javascript
ROLE_MAX_TOKENS = {
  R2A: 2048,   // Kratší intent review
  R2B: 3072,   // Delší pro edge cases
}
```

---

## 📊 State Machine

```
INIT
  │
  ▼
CLARIFYING ◄──────────────────┐
  │                           │
  ▼                           │
PLANNING ◄────────────────┐   │
  │                       │   │
  ▼                       │   │
DESIGN_AUDITING ──REDESIGN┘   │
  │                           │
  ▼                           │
PLAN_REVIEW ──MODIFY──────────┘
  │
  ▼
IMPLEMENTING ◄────────────┐
  │                       │
  ▼                       │
REVIEWING_R2A ──FAIL──┐   │
  │                   │   │
  ▼                   ▼   │
REVIEWING_R2B      FIXING_D2
  │                   │
  │──FAIL─────────────┘
  │
  ▼
DONE
```

---

## 🚀 Upgrade z v25

```bash
# 1. Backup
cp orchestrator/agent/workflow-agent.js orchestrator/agent/workflow-agent.js.v25
cp orchestrator/llm/ollama-client.js orchestrator/llm/ollama-client.js.v25
cp orchestrator/config/role-model-binding.json orchestrator/config/role-model-binding.json.v25

# 2. Install
cp v26-design-audit/workflow-agent.js orchestrator/agent/
cp v26-design-audit/ollama-client.js orchestrator/llm/
cp v26-design-audit/role-model-binding.json orchestrator/config/

# 3. Restart
pkill -f "node.*server.js"
node orchestrator/server.js &

# 4. Test
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","workdir":"/tmp/test","message":"Hello"}' | jq .
```

---

## ✅ Očekávané výsledky

1. **Lepší plány** - DESIGN_AUDIT odhalí díry před implementací
2. **Cílenější review** - R2.a kontroluje intent, R2.b hledá problémy
3. **Kvalitnější opravy** - D2 dostává specifické problémy od R2.b
4. **Robustnější kód** - edge cases jsou odhaleny před DONE

---

## ⚠️ Breaking Changes

1. **R1 odstraněn** - nahrazen kombinací DESIGN_AUDIT + R2.b
2. **R2 odstraněn** - nahrazen R2A + R2B
3. **State names** - nové stavy: DESIGN_AUDITING, REVIEWING_R2A, REVIEWING_R2B

---

*Vytvořeno: 2025-01-08*
