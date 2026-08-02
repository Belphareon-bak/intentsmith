# Inventura #4 — Konverzace a persistence

**Schopnost:** #4 (pořadí 3) · **Datum:** 2026-08-02 · **Commit:** `17a8b9a8`

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.

## 1. Rozsah

| Soubor | Řádků | Role |
|---|---:|---|
| `src/chat/conversation-store.js` | 766 | DB vrstva konverzací, tahů, souhrnů, session state |
| `src/chat/context-budget.js` | 352 | rozpočet kontextového okna |
| `src/chat/context-compact.js` | 226 | komprese historie |
| `src/chat/context-init.js` | 143 | inicializace kontextu |
| `src/chat/ltm-context.js` | 186 | injekce dlouhodobé paměti |
| `src/chat/export-pipeline.js` | 517 | export konverzací |
| `src/chat/response-finalizer.js` | 153 | finalizace odpovědi |
| **Celkem** | **2 343** | |

## 2. Naměřeno

| Sada | Výsledek |
|---|---|
| `chat-persistence` | **35 passed** |
| `session-context` | **66 passed** |
| `context-builder` / `-delta` / `-engine` / `-optimizer` / `-compact-model-ctx` | **106 passed** celkem |
| `chat-export-budget` | **FAIL** — chybí Python PDF runtime |
| `export-pdf-docx` | **FAIL** — totéž |

Ověřeno i za běhu serveru: založení konverzace přes `POST /api/conversations`,
zápis tahů, načtení historie. Funguje.

`ConversationStore` má **19 veřejných metod** — `ensureConversation`,
`appendTurn`, `getRecentTurns`, `buildHistoryContext`, `buildHandlerHistory`,
`getEstimatedTokens`, `setSummary`, `getSummary`, `saveSessionState`,
`loadSessionState` a další.

## 3. Seznam 1 — dobré, použije se

| Co | Proč |
|---|---|
| **`ConversationStore` jako jediná brána k historii** | Jedna třída, jasné API, prepared statements. Žádný handler nesahá na tabulky přímo. |
| **Souhrny s ukotvením** | `setSummary(id, summary, upToMsgId)` váže souhrn ke konkrétní zprávě — komprese historie neztrácí návaznost. |
| **Session state oddělený od konverzace** | `saveSessionState` / `loadSessionState` / `deleteSessionState` — stav dialogu žije mimo obsah zpráv. |
| **Rozpočet kontextu jako samostatná vrstva** | 4 moduly (`budget`, `compact`, `init`, `delta`) mimo store i mimo handlery. 106 zelených asercí. |
| **`getEstimatedTokens`** | Odhad tokenů je v modelu dat, ne dohadovaný v handleru. |
| **Odolnost proti české diakritice** | Vlastní sada `conv-czech-nodiacritics` — problém, který C3 řešilo cíleně. |

## 4. Seznam 2 — zbytečné

Nic prokazatelně zbytečného jsem nenašel. Všech sedm modulů je zapojených
a pokrytých testy.

## 5. Seznam 3 — nejasné

| # | Zjištění | Otázka |
|---|---|---|
| **K-1** | **Export vyžaduje Python PDF runtime** instalovaný samostatným skriptem `scripts/install-pdf-runtime.sh`. Obě exportní sady jsou v registru `offline`/`ollama:false`, takže prerekvizita není nikde deklarovaná. Totéž jako `EX-6`. | Deklarovat prerekvizitu a přeřadit na `BLOCKED`, nebo runtime doinstalovat v `install.sh`? |
| **K-2** | **`export-pipeline.js` (517 ř.) je v této schopnosti**, ale export do PDF/DOCX je jiná starost než persistence konverzace. | Patří export sem, nebo je to samostatná (nízkoprioritní) schopnost? |
| **K-3** | **`conversation-store.js` nemá vlastní testovou sadu.** Pokrývá ho `chat-persistence` (35 asercí) a nepřímo dalších 7 sad. | Stačí to, nebo si 766 řádků jediné brány k historii zaslouží vlastní sadu? |
| **K-4** | **`ltm-context.js` (186 ř.)** injektuje dlouhodobou paměť, ale LTM samo je schopnost #15. | Je injekce součástí #4, nebo #15? |

## 6. Co inventura nenašla

- Žádný handler nesahající na tabulky konverzací mimo store.
- Žádná neotestovaná kontextová vrstva — všechny čtyři moduly mají sady.
