# C3-Agent Sprint 1+2+3+4 — Cumulative Delivery
## v55.2 → v56.1

### Jak nasadit
Rozbal ZIP do kořene C3 projektu. Struktura odpovídá `src/` layoutu.

```
c3-sprint4/
├── src/
│   ├── server.js                        ← REPLACE (export endpoint + chat-ui route)
│   ├── chat/
│   │   ├── context-budget.js            ← NEW (token budgeting per intent)
│   │   ├── export-pipeline.js           ← NEW (MD/HTML/TXT export)
│   │   ├── chat.html                    ← NEW (Chat UI)
│   │   ├── controller.js                ← REPLACE (Sprint 3)
│   │   ├── conversation-store.js        ← REPLACE (+ summary persistence)
│   │   ├── ltm-context.js               ← EXISTING
│   │   └── handlers/
│   │       ├── decisions.js             ← REPLACE (Sprint 2)
│   │       └── utils/
│   │           ├── language.js          ← Sprint 1
│   │           ├── search-metrics.js    ← Sprint 1
│   │           └── synthesis.js         ← Sprint 2
│   └── llm/
│       └── web-search.js               ← Sprint 1
└── tests/
    ├── chat-search-quality.test.js      ← Sprint 1 (43 testů)
    ├── chat-synthesis-hardening.test.js ← Sprint 2 (22 testů)
    ├── chat-persistence.test.js         ← Sprint 3 (35 testů)
    └── chat-export-budget.test.js       ← Sprint 4 (44 testů)
```

### Sprint 4 — co se změnilo

#### 4A: Context Budgeting (`context-budget.js`)

Token budgeting per intent — nahrazuje hardcoded `buildHandlerHistory(id, 10)`:

| Intent | History budget | Search budget | LTM budget |
|--------|---------------|---------------|------------|
| CONVERSATIONAL | 2000 tok | — | 500 tok |
| CREATIVE | 3000 tok | — | 300 tok |
| SEARCH | 500 tok | 3000 tok | 200 tok |
| REPORT | 300 tok | 5000 tok | 200 tok |
| CODE | 1500 tok | — | 500 tok |

**Algoritmus:**
1. CRE rozhodne intent (budgeting intent NEOVLIVŇUJE)
2. `buildBudgetedContext()` načte turny z DB
3. Naplní verbatim turny od nejnovějšího do budgetu
4. Pokud starší turny existují → lazy summarization
5. LTM trimován na budget

**Lazy summarization:**
- Sumarizuje jen při překročení budgetu
- Summary uložena do DB (cache, NE náhrada)
- Stale detection: `summary_up_to_msg_id` trackuje pokrytí
- Failure = graceful degradation (pokračuj bez summary)

#### 4B: Export Pipeline (`export-pipeline.js`)

Deterministická transformace — NE LLM intent:

| Formát | Výstup |
|--------|--------|
| MD | Markdown s headery, metadata, oddělovači |
| HTML | Styled HTML s CSS (user/assistant barvy) |
| TXT | Plain text, žádné formátování |

**Scopes:**
- `conversation` — všechny turny (default)
- `last` — poslední assistant turn
- `summary` — summary + posledních 5 turnů

**Command detection:**
```
"ulož to jako markdown"  → export MD
"exportuj do HTML"       → export HTML
"save as txt"            → export TXT
"napiš mi report"       → NE export (normální request)
```

**API:**
```
POST /api/export
  { conversation_id, format: "md"|"html"|"txt", scope: "conversation"|"last" }
  → { filename, download_url, size, turn_count }

GET /api/artifacts/:filename  (existující endpoint)
```

#### 4C: Chat UI (`chat.html`)

Minimální single-file UI (vanilla JS, žádný framework):
- Message list s markdown-like formátováním
- Conversation sidebar
- Export buttons (MD/HTML/TXT)
- Mode badge + confidence u odpovědí
- Loading indicator (typing dots)
- Error handling

**Přístup:** `GET /chat-ui`

#### Summary Persistence (v `conversation-store.js`)

Nové metody:
- `setSummary(convId, summary, upToMsgId)` — uložení
- `getSummary(convId)` → `{ summary, upToMsgId } | null`
- In-memory mode pro testy

### Invarianty Sprint 4

- ✅ Budget per intent, ne fixní 10 turnů
- ✅ Budget NEOVLIVŇUJE CRE routing (aplikuje se PO rozhodnutí)
- ✅ Summary je cache, NE náhrada za DB turns
- ✅ Export je deterministická transformace, NE LLM intent
- ✅ Export NEOBSAHUJE interní metadata (confidence, gate logs)
- ✅ UI funguje bez frameworku (vanilla JS)
- ✅ Summarization failure = graceful degradation
- ✅ HTML export escapuje nebezpečný obsah (XSS)

### Verifikace

```bash
# Všechny testy (247 total, 0 failures)
node --experimental-vm-modules tests/chat-pipeline.test.js           # T1-T5: 52
node --experimental-vm-modules tests/chat-output-quality.test.js     # T6: 51
node --experimental-vm-modules tests/chat-search-quality.test.js     # T7+T8.3: 43
node --experimental-vm-modules tests/chat-synthesis-hardening.test.js # T8: 22
node --experimental-vm-modules tests/chat-persistence.test.js        # T9: 35
node --experimental-vm-modules tests/chat-export-budget.test.js      # T10: 44
```

### Out of scope (záměrně)

- ❌ PDF export (puppeteer dependency — Sprint 5+)
- ❌ WebSocket streaming
- ❌ Multi-user auth
- ❌ LTM write pipeline (fact extraction)
- ❌ Controller integration (CRE→budget→handler sekvence) — připraveno, čeká na Sprint 5
