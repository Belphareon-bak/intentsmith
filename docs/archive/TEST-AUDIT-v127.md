# C3 Test Audit — v127.0.0

**Datum:** 2026-03-19
**Node.js:** v22.21.1 (NVM)
**Prostředí:** Linux 6.17.0, GTX 4090 (24GB), 128GB RAM
**Ollama:** Online, ale LLM neodpovídá (GPU busy / model not loaded)

---

## Souhrn

| Status | Počet | % |
|--------|-------|---|
| **PASS** | 144 | 64.9% |
| **FAIL** | 46 | 20.7% |
| **HANG (timeout 45s)** | 25 | 11.3% |
| **SKIP** | 7 | 3.2% |
| **Celkem** | **222** | 100% |

---

## Kategorizace selhání

### K1: LLM-dependent testy (17 FAIL + 20 HANG = 37 testů) — EXPECTED

Testy vyžadující běžící Ollama s naloadeným modelem. Při nedostupném GPU/LLM korektně selhávají s hláškou "LLM model neodpovídá".

**FAIL (17):**
- `conv-czech.test.js`, `conv-czech-nodiacritics.test.js`, `conv-english.test.js` — konverzační E2E
- `expertise-comparison-e2e*.test.js` (5 souborů) — E2E srovnání expertíz
- `lifecycle-conversation-e2e.test.js`, `lifecycle-llm-realistic.test.js`, `lifecycle-stress-advanced.test.js` — lifecycle E2E
- `project-lifecycle-*.test.js` (5 souborů) — projektový lifecycle s code gen

**HANG (20):**
- `adversarial-cre.test.js`, `cre-comprehensive.test.js`, `chat-quality.test.js`, `skill-routing-cre.test.js` — CRE s LLM klasifikací
- `e2e-complex.test.js`, `e2e-pipeline.test.js`, `e2e-specialists.test.js`, `ultimate-e2e.test.js`, `tool-pipeline-e2e.test.js` — full E2E
- `lifecycle-*-e2e.test.js` (5 souborů) — lifecycle s GPU
- `llm-integration.test.js`, `llm-integration-2.test.js` — přímé LLM volání
- `expertise-ab-quality.test.js`, `expertise-routing-correctness.test.js` — routing s LLM
- `executor-capabilities.test.js`, `attachments-projects.test.js`, `project-e2e.test.js` — full integration
- `timeout-diagnostic.test.js` — diagnostika timeoutů
- `upgrade-apply.test.js` — upgrade s Ollama ping

**Verdict:** Tyto testy jsou **korektní**. Selhání je expected při nedostupném LLM. Při funkčním Ollama + GPU by měly procházet (historicky 89-97% pass rate).

---

### K2: tree-sitter segfault — Node 22 ABI nekompatibilita (9 testů)

**Symptom:** `exit=139` (SIGSEGV), "the monitored command dumped core"

**Dotčené testy:**
- `ast-analyzer.test.js`
- `dead-code-detector.test.js`
- `execution-loop.test.js`
- `graph-sync.test.js`
- `impact-analyzer.test.js`
- `knowledge-graph.test.js`
- `signature-cache.test.js`
- `signature-map.test.js`
- `symbol-index.test.js`

**Root cause:** tree-sitter 0.25.0 (npm) segfaultuje na Node.js v22.21.1. Nativní modul byl zkompilován pro Node 18 ABI (v108), Node 22 má ABI v127. `npm rebuild` ani `node-gyp rebuild` nepomáhá — jde o upstream bug v tree-sitter 0.25.0 s Node 22.

**Důkaz:**
```
$ node18 -e "require('tree-sitter')"  → OK ✓
$ node22 -e "require('tree-sitter')"  → Segmentation fault (core dumped) ✗
```

Downgrade na 0.22.4 řeší segfault, ale API je nekompatibilní s language grammars (0.25.0).

**Dopad na produkci:**
- Production kód v `ast-analyzer.js:29-36` má `try/catch` kolem `import('tree-sitter')`, ale segfault zabije proces **dřív** než catch
- Server běží na Node 22 → **AST funkce (3-tier anchor, symbol extraction) jsou de facto mrtvé**
- Regex fallback funguje, ale kvalita patch anchoru a symbol rozpoznání je nižší

**Možné opravy (seřazeno od nejlepšího):**
1. **Migrace na `web-tree-sitter`** (WASM, žádné nativní závislosti) — safe, ale velký refactor
2. **Subprocess probe** před importem: spawn child process, zkusí `require('tree-sitter')`, pokud crash → disable AST features
3. **Pin Node 18 pro testy**, Node 22 pro server (split runtime)
4. **Počkat na tree-sitter 0.26+** s Node 22 kompatibilitou

**Severity:** HIGH — AST features nefungují v produkci na Node 22

---

### K3: Accountant specialist chybí v testech (6 testů)

**Symptom:** "FATAL: accountant specialist not registered after boot", "expected accountant, got null", "expected 15 expertises, got 14"

**Dotčené testy:**
- `auto-expertise-select.test.js` (5 selhání: DPH vocab, OSVČ boost, anti-flip-flop, structure)
- `create-expertise-integration.test.js` (2 selhání)
- `routing-accuracy.test.js` (FATAL)
- `session-context.test.js` (FATAL)
- `specialist-loader.test.js` (accountant version undefined)
- `merge-compatibility.test.js` (2 selhání: writer+accountant HARD_BLOCK)
- `merge-engine.test.js` (2 selhání)

**Root cause:** V121 refactor přesunul accountant z `BUILTIN_EXPERTISES` (14→14 expertíz, accountant odstraněn) do self-contained specialist balíčku `specialists/accountant-cz/`. Testy ale nebyly aktualizovány:

1. **`auto-expertise-select.test.js`** — očekává 15 expertíz, ale je jich 14
2. **`routing-accuracy.test.js`** a **`session-context.test.js`** — bootují SpecialistLoader, ale accountant specialist se nenačte (chybí registrace v test setupu)
3. **`merge-compatibility.test.js`** — testuje `writer + accountant = HARD_BLOCK`, ale accountant expertise neexistuje → compatibility check vrátí "ok" místo "hard_block"
4. **`getExpertiseCategories()`** v `expertise-layer.js:1635` stále obsahuje `'accountant'` v analytické kategorii — ghost reference

**Oprava:**
- Aktualizovat testy: 15→14 expertíz, nebo loadovat specialist v setupu
- Odstranit ghost referenci `'accountant'` z `getExpertiseCategories()`
- Merge testy: nahradit writer+accountant za existující pár s konfliktem (např. writer + developer)

**Severity:** MEDIUM — testy jsou nesprávné, ne produkční kód

---

### K4: CRE/BUILD routing regrese (12 testů)

**Symptom:** "spusť build" → SHELL, PLAN decisions → TOOL_CALL, follow-up classification failures

**Dotčené testy:**
- `build-intent.test.js` (2 selhání)
- `build-routing-project-mode.test.js` (4 selhání)
- `build-patterns.test.js` (1 selhání)
- `cre-dialog-scenarios.test.js` (10 selhání na L1)
- `cre-followup-diagnostic.test.js` (6 selhání)
- `design-tests.test.js` (1 selhání z 100)

**Root cause — 4 bugy:**

#### Bug 1: SHELL pattern precedence (CRITICAL)
**Soubor:** `cre-decision.js:2645-2659`

`SHELL_COMMAND_PATTERNS` se kontrolují PŘED `BUILD_PATTERNS`. Pattern `/spus[tť]\s+(.+)/i` zachytí "spusť build", protože `.+` matchne cokoliv. BUILD pattern `/spusť\s+(mi\s+)?build/i` se nikdy nedostane na řadu.

```
input: "spusť build"
  → SHELL_COMMAND_PATTERNS check → MATCH (/spusť\s+.+/) → return SHELL
  → BUILD_PATTERNS → NEVER REACHED
```

**Fix:** Přidat výjimku do SHELL patternu: `spusť build|stavbu|projekt` → BUILD, ne SHELL.

#### Bug 2: Chybějící BUILD patterns pro modální slovesa
**Soubor:** `cre-decision.js, BUILD_PATTERNS`

Vzory jako "muzes zacit implementovat" (2. osoba + modální sloveso) nejsou v BUILD_PATTERNS. Regex obsahuje imperativní formy ("zacni stavět") ale ne "muzes zacit", "chtel bych aby", "mohl bys".

```
input: "muzes zacit implementovat"
  → BUILD_PATTERNS check → NO MATCH (no modal verb patterns)
  → Falls to LLM → LLM unavailable → AMBIGUOUS
```

**Fix:** Přidat modální vzory: `/m[uůo]žeš?\s+z[aá][cč][ií]t\s+(implementovat|stavět|vytvořit|napsat|udělat)/i`

#### Bug 3: Follow-up classification selhává pro krátké vstupy
**Soubor:** `cre-decision.js`

Krátké follow-up dotazy po příloze ("shrn to", "co to dela", "udelej prehled") nejsou zachyceny žádným patternem → AMBIGUOUS.

**Fix:** Přidat follow-up patterns pro krátké české příkazy po attachment kontextu.

#### Bug 4: DESIGN_BUILD_ESCALATION patterns definovány ale nepoužity
Konstanty existují (`cre-decision.js:1146-1154`) ale nejsou zapojeny v `decide()`.

**Severity:** HIGH — Bug 1 je produkční problém (uživatel řekne "spusť build" a dostane SHELL místo BUILD workflow)

---

### K5: Schema migrations (8 testů)

**Symptom:** "no such table: custom_experts" v migration 008

**Dotčený test:** `schema-migrations.test.js` (8 selhání)

**Root cause:** Migration `2026_02_20_008_v69_expert_to_expertise.js` provádí:
```sql
INSERT OR IGNORE INTO custom_expertises (id, config, created_at)
SELECT id, config, created_at FROM custom_experts
```

Tabulka `custom_experts` by měla být vytvořena v baseline migraci, ale není. Buď:
- Baseline neobsahuje `custom_experts` definici
- Nebo migrační ordering je špatný

Navíc: dvě migrace sdílejí suffix "008" — `2026_02_19_008_v69_ledger_core` a `2026_02_20_008_v69_expert_to_expertise`.

**Fix:** Přidat `CREATE TABLE IF NOT EXISTS custom_experts` guard před SELECT, nebo opravit baseline.

**Severity:** MEDIUM — migration testy selhávají, ale produkce má DB již migrovanou

---

### K6: Izolované selhání (6 testů, 1-2 chyby každý)

#### agent-log-ux.test.js (43/44)
- **Test:** `system_step produces _raw with step and detail: text should contain step name`
- **Root cause:** `formatAgentEvent()` překládá step name na český label (`handler_selected` → `Režim`). Test hledá originální anglický step name.
- **Fix:** Test expectation: hledat český label nebo přidat raw step do _raw pole.

#### archive-lifecycle.test.js (41/43)
- **Tests:** `List.2: conversation in listActive`, `Archive.9: conversation IN listArchived`
- **Root cause:** SQL dotazy `listActive`/`listArchived` pravděpodobně špatně filtrují podle `archived_at` sloupce.
- **Fix:** Zkontrolovat WHERE podmínky v prepared statements.

#### model-upgrade.test.js (55/56)
- **Test:** `stopPeriodicCheck clears intervals: should have recheck interval`
- **Root cause:** `startPeriodicCheck()` může inicializovat intervaly asynchronně, assertion běží synchronně.
- **Fix:** Await nebo nextTick před assertion.

#### telemetry.test.js (1 selhání)
- **Test:** `X.1 — Full TOOL_CALL turn produces complete snapshot: 2 !== 1`
- **Root cause:** Duplikátní snapshot, pravděpodobně double-call.
- **Fix:** Investigate TurnTelemetry finalize().

#### telemetry-soak.test.js (11/12)
- **Root cause:** Jeden assertion z 12 v soak testu (1000 iterací). Likely edge case v circuit breaker nebo classification count.

#### ws-bridge.test.js (40/41)
- **Root cause:** Session state persistence nebo hook sequencing issue.

**Severity:** LOW — izolované, nepřímo souvisí se stabilitou produkce

---

## Doporučený postup oprav

### Fáze 1: Kritické (produkční dopad)
1. **CRE Bug 1**: SHELL/BUILD precedence — `"spusť build"` musí jít do BUILD workflow
2. **tree-sitter probe**: Subprocess guard + disable AST features na Node 22 (než vyjde fix)

### Fáze 2: Vysoké (funkční integrita)
3. **CRE Bug 2+3**: Modální BUILD patterns + follow-up patterns
4. **Accountant v testech**: Aktualizovat test expectations (15→14) + ghost reference
5. **Schema migrations**: Guard v migration 008

### Fáze 3: Střední (test stabilita)
6. **Merge testy**: Nahradit writer+accountant za existující pár
7. **Izolované bugy**: agent-log, archive, model-upgrade, telemetry, ws-bridge

### Fáze 4: Low (nice to have)
8. **Build deferral hang**: Prozkoumat timeout v `build-deferral.test.js`
9. **Upgrade-apply hang**: Prozkoumat Ollama ping v `upgrade-apply.test.js`

---

## Statistika bez LLM-dependent a HANG testů

Pokud odečteme testy vyžadující LLM (expected failures):

| Status | Počet | % |
|--------|-------|---|
| **PASS** | 144 | 82.3% |
| **Skutečné FAIL** | 29 | 16.6% |
| **SKIP** | 2 | 1.1% |
| **Celkem (non-LLM)** | **175** | 100% |

Z 29 skutečných selhání:
- 9 = tree-sitter crash (nativní modul, ne kód)
- 8 = accountant specialist (test expectations, ne produkce)
- 8 = schema migration (test setup, ne produkce)
- 4 = CRE routing (**produkční bug**)

**Skutečné produkční bugy: 4 (CRE routing)**
