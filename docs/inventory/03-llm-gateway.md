# Inventura #3 — LLM gateway a role modelů

**Schopnost:** #3 (pořadí 5) · **Datum:** 2026-08-02 · **Commit:** `17a8b9a8`

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.

## 1. Rozsah

| Soubor | Řádků | Role |
|---|---:|---|
| `src/llm/web-search.js` | **937** | web search, fetch stránky, heuristiky |
| `src/llm/gateway.js` | 717 | `LLMGateway` singleton, retry, rate limit |
| `src/llm/prompts.js` | 315 | šablony promptů |
| `src/llm/cre-bridge.js` | 295 | `createPipelineLLM`, `createClassifierLLM` |
| `src/llm/client.js` | 275 | `extractJSON`, `extractCodeBlocks`, `extractModifiedFiles` |
| `src/llm/auth-types.js` | 263 | role, capability, tokeny, limity |
| `src/llm/model-ctx.js` | 141 | kontextové okno modelu |
| **Celkem** | **2 943** | |

## 2. Naměřeno

| | |
|---|---|
| `llm-gateway-runtime-signal` | **7 passed** |
| `model-ctx` | **6 passed** |
| `llm-integration`, `llm-integration-2` | profil `model` — bez Ollamy neproběhnou |
| Retry politika | `config.ollama.retries` = **3**, odstupy 2 s a 4 s |
| Selhání bez modelu | `LLM failed after 3 attempts: fetch failed`, celkem **~6 s** |

## 3. Seznam 1 — dobré, použije se

| Co | Proč |
|---|---|
| **Capability-scoped auth tokeny pro volající LLM** | `auth-types.js` definuje **12 rolí** (`CRE_DECISION`, `CRE_PLANNING`, `SYNTHESIZER`, `REFLECTOR`, `SKILL_RESOLVER`, `SKILL_EXECUTOR`, `TOOL_INTERNAL`, `WORKFLOW_*`, `LEGACY_DIRECT`), ke každé `RoleCapabilities` a `RoleTokenLimits`, plus `createAuthToken` / `validateAuthToken` / `hasCapability`. **Žádná část systému nemůže volat model mimo svou roli a limit.** Tohle je nejsilnější návrhový prvek celé schopnosti a v projektech téhle velikosti se vidí zřídka. |
| **Jediná brána `llmGateway`** | Jeden singleton, jedno místo pro retry, rate limit a timeouty. |
| **`cre-bridge.js` odděluje klasifikátor od pipeline** | `createClassifierLLM()` a `createPipelineLLM()` — dvě různá použití modelu mají různou konfiguraci, ne jednu společnou. |
| **Robustní parsování odpovědí** | `extractJSON`, `extractCodeBlocks`, `extractModifiedFiles` — model odpovídá nespolehlivě a klient s tím počítá. |
| **Odvození `num_ctx`** | Z VRAM s fallbackem, ne natvrdo. |
| **Čistá chyba místo pádu** | `LLM_PROVIDER_UNAVAILABLE`, `recoverable: true`. Ověřeno za běhu. |

## 4. Seznam 2 — zbytečné

Nic prokazatelně zbytečného. Sporné je níže.

## 5. Seznam 3 — nejasné

| # | Zjištění | Otázka |
|---|---|---|
| **G-1** | **`web-search.js` má 937 řádků — 32 % celé schopnosti** — a leží v `src/llm/`, ačkoli řeší web search, stahování stránek a heuristiky `needsExternalData()` / `needsWebSearch()` / `extractSearchQuery()`. S voláním modelu nesouvisí. Jediný konzument je `src/executor/tool-executor.js`. | Patří web search do #3, do nástrojů (#16), nebo je to samostatná schopnost? |
| **G-2** | **Retry 3× s odstupy 2 s a 4 s platí pro všechna volání stejně.** U klasifikace, která má regex fallback, to znamená 6 s čekání na něco, co skončí fallbackem. Totéž jako `C-1` v inventuře #2. | Odlišit retry politiku podle role? Role a jejich limity už v `auth-types.js` existují, takže je kam to pověsit. |
| **G-3** | **`LEGACY_DIRECT` je jednou z 12 rolí.** Název napovídá obcházení běžné cesty. | Kdo ji používá a má zůstat? |
| **G-4** | **Testové pokrytí gateway je 13 asercí** (`llm-gateway-runtime-signal` 7 + `model-ctx` 6) na 2 943 řádků. Zbytek je v profilu `model`, tedy bez Ollamy neběží. | Jde auth/capability vrstva otestovat deterministicky? Na rozdíl od CRE je to čistá logika bez modelu — vypadá to, že ano. |

## 6. Co inventura nenašla

- Žádnou cestu k modelu mimo `llmGateway` — invariant drží.
- Žádné volání bez auth tokenu.
- Žádnou cloudovou cestu: gateway mluví jen s `OLLAMA_URL`.

## 7. Runtime follow-up C2b — 2026-08-09

Historická tabulka výše zůstává snapshotem na `17a8b9a8`; současný runtime už
má podstatně širší deterministické pokrytí. Gateway je zapojená do
single-process `model-use-authority`: queued request model nerezervuje, shared
lease vzniká až po semaphore slotu a drží přes fetch, response body, retry i
delay. Aktivní mutace skončí před provider efektem a aktivní gateway zablokuje
delete před inventory.

Focused sada `m1-model-use-authority` má v tomto checkpointu 24 asercí a
`llm-gateway-runtime-signal` 7; tři cílené mutace zčervenaly. Současně byla
uzavřena starší timeoutová mezera mezi HTTP hlavičkami a dočtením těla. G-4 je
proto historicky překonané zjištění, nikoli současný počet testů. Jde zatím o
`FOCUSED_VERIFIED`, ne fresh-clone důkaz ani dokončený C2: binding cutover,
exact verify a VRAM disposition zůstávají otevřené.
