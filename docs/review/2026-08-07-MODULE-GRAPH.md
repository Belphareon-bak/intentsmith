# Modulový graf `src/**` a mapa švů

**Zadání:** [`docs/wp/P6-MODULE-GRAPH.md`](../wp/P6-MODULE-GRAPH.md)
**Revision:** `13701b2a500feac94d13322433721125793c4587` · **Datum:** 2026-08-07
**Měřidlo v době běhu:** [`2026-08-07-module-graph.mjs`](2026-08-07-module-graph.mjs) ·
**Data:** [`2026-08-07-MODULE-GRAPH.json`](2026-08-07-MODULE-GRAPH.json)
**Adresát:** operátor · vlastník budoucího kontraktového registru · `WP-M3-BOUNDARY`

**Současný autoritativní vstup:** [`scripts/module-graph.mjs`](../../scripts/module-graph.mjs).
Datovaná cesta výše zůstává spustitelným wrapperem, takže historická reprodukce
nepotřebuje jiný parser.

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Je to vstup rozhodnutí. Nerozhoduje disposition — ta je podle `CONTRACT.md §7`
> operátorská. Report neoznačuje žádný modul za mrtvý; označuje ho za
> **nedosažitelný z deklarovaného vstupu**, což je měřený fakt, ne verdikt.

---

## Shrnutí pro rozhodnutí

Graf je spočítaný, ne odhadnutý: **407 modulů, 992 vnitřních hran**. Tři věci
z něj vycházejí a každá se dá přeměřit jedním příkazem.

**1. Pětina stromu nevisí na produkčním vstupu.** Z `src/server.js` a
z dynamicky načítaných migrací je dosažitelných 345 modulů. Zbylých **62
(20 942 řádků)** ne. Nejde o šum: 37 z nich má napsaný test a žádnou produkční
cestu — mezi nimi 18 modulů `src/code-intel/**` (6 000 řádků). Test je tam,
uživatelská cesta ne. To je přesně tvar, který `CONTRACT.md §5` odmítá počítat
jako důkaz schopnosti.

**2. Deklarované hranice se míjejí se skutečnými.** Repozitář má 11 barrel
souborů `index.js` — konvenční „tudy dovnitř". Přes ně vede **11 hran**, kolem
nich **97**. Deklarovaná hranice tedy existuje, ale skoro nikdo jí neprochází;
u `src/executor/index.js` a `src/chat/safety/index.js` je poměr 0 : 8 a 0 : 1.
Tohle je stejný vzorec jako `L8-2` z P2 — kontrakt na papíře, nula vynucení.

**3. Nejsilnější kontrakt v repozitáři nikdo nedeklaroval a je přitom nejlevnější.**
`src/core/logger.js` má 184 konzumentů — 45 % všech modulů. Celý konzumovaný
povrch je **jediný symbol** `logger` (179× `import { logger }`, 5× přejmenovaně).
Naproti tomu `src/db/database.js` má 26 vnitřních a 29 vnějších konzumentů
a **17 různých symbolů**. Ta druhá je skutečně široká hranice; ta první je
široká jen v počtu volajících.

Vedle toho graf odpovídá na jednu otevřenou otázku `CONTRACT.md §9` daty:
**chat pipeline je jeden 21modulový cyklus**, který navíc vtahuje
`src/executor/tool-executor.js` a `src/specialists/specialist-loader.js`.
„Rozdělení #6" proto dnes nelze provést po částech — buď se rozetne cyklus,
nebo se nedělí nic.

### Nálezy

| ID | Nález | Kde |
|---|---|---|
| `MG-1` | 62 modulů (20 942 řádků) není dosažitelných z `src/server.js`; 37 z nich má test a žádnou produkční cestu, z toho 18 v `src/code-intel/**` | §5 |
| `MG-2` | Barrel `index.js` je deklarovaná hranice s poměrem průchodů **11 : 97** ve prospěch obcházení; tři z 11 barrelů jsou samy nedosažitelné | §4.2 |
| `MG-3` | `src/channels/**` má vlastní kontraktový dokument a **nulový runtime** — 844 řádků, žádný konzument | §5.3 |
| `MG-4` | Chat pipeline je jediný cyklus 21 modulů přes tři adresáře; vtahuje `executor/tool-executor.js` a `specialists/specialist-loader.js` | §6 |
| `MG-5` | Čtyři `.d.ts` deklarace bez jakéhokoli type-checkeru v repozitáři; `llm/auth-types.js` má 12 konzumentů a 0 odkazů z testů | §3 |
| `MG-6` | `src/core/tracer-hooks.mjs` a `tracer-register.mjs` — `--import` hooky, které v celém stromu nic nespouští | §5.3 |
| `MG-7` | `src/expertises/tools/**` je bajtově identická kopie nástrojů specialisty bez jediného konzumenta — nezávislé potvrzení `L8-4` | §5.2 |

---

## 1. Jak se měřilo

Nástroj, dnes vlastněný jako `scripts/module-graph.mjs`, projde `src/**`, oddělí
kód od komentářů, posbírá `import` / `export … from` / `import()` s literálem a rozřeší relativní
specifikátory na soubory. Výstup je setříděný JSON, takže **drift se příště
přeměří `git diff`em**, ne dalším čtením.

### Deklarované vstupní body

Dosažitelnost nejde odvodit z grafu — vstup se musí prohlásit. Prohlášené jsou
dva a oba mají důvod v kódu:

| Vstup | Důvod |
|---|---|
| `src/server.js` | `package.json` → `main` |
| `src/db/migrations/**` (47 souborů) | `src/db/migrate.js:44-50` — `readdirSync` + `import()` |

Plus cokoliv, co importuje `bin/**` (jediná taková hrana je `bin/agentd.js` → `logger.js`). Migrace by bez druhého pravidla vyšly jako
mrtvé; nejsou — jen je nikdo neimportuje staticky.

### Co měřidlo nevidí — a proč to tentokrát nevadí

1. **`import()` s vypočítanou cestou** — 10 míst. Prošel jsem je ručně. Cíle
   uvnitř `src/**` mají jen dvě: `migrate.js` (pokryto pravidlem výše) a
   `server.js:79-86`, které zkouší tři literální cesty na `expertise-layer.js`
   (ten je dosažitelný i staticky, fan-in 6). Ostatní míří **mimo** `src/**` —
   `specialist-loader.js` a `specialist-runtime.js` na balíčky specialistů,
   `ast-analyzer.js:79` na npm gramatiky (`tree-sitter-*`). Seznam 62
   nedosažitelných modulů tím tedy není nahlodaný.
2. **Obsah template literálů se záměrně nečte.** `src/domains/scaffolds/**`
   generuje cizí projekty; jejich `import` řádky nejsou hrany tohoto grafu.
   Bez tohoto pravidla vzniklo 12 falešných hran na neexistující soubory
   (`./pages/Home`, `./App.vue`).
3. **`<script src>` v HTML.** Proto je `src/ui/**` klasifikované zvlášť jako
   `browser-asset`, ne jako mrtvé.

### Rozchod s čísly z 2026-08-07 ráno

V předchozí relaci jsem uvedl *405 souborů, 1195 hran, 87 bez konzumenta*.
Správně je **407 / 992 / 89**. Rozdíl není drift kódu — `src/**` je na
`13701b2a` beze změny proti `859230ac`. Rozdíl je metoda: dřívější číslo bylo
z hrubého grepu, počítalo textové výskyty včetně JSDoc typových referencí a
řádků uvnitř scaffold šablon a nerozlišovalo dvojí import téhož modulu.
Platí čísla z tohoto reportu, protože jdou přeměřit.

---

## 2. Číselný obraz

| Veličina | Hodnota |
|---|---|
| moduly v `src/**` (`.js` + 2 `.mjs`) | **407** |
| vnitřní hrany | **992** (796 statických, 196 `await import()`) |
| typové hrany (JSDoc `import()`) | 13 |
| nerozřešené relativní specifikátory | **0** |
| hrany zvenčí do `src/**` (testy, skripty, bin, specialisté) | 615 |
| moduly s nulovým fan-in | 89 |
| **dosažitelné z deklarovaných vstupů** | **345** |
| **nedosažitelné** | **62** · 20 942 řádků |
| cykly (SCC > 1) | 3 · dohromady 28 modulů |

Rozdíl mezi „89 s nulovým fan-in" a „62 nedosažitelných" je poučný sám o sobě:
47 migrací má nulový fan-in a přitom běží, zatímco `src/chat/export/pdf-exporter.js`
fan-in **má** — jenže od modulu, který sám nikam nevede.

Adresáře podle velikosti a vnější vazby:

| Adresář | Souborů | Řádků | Odkazů zvenčí `src/**` |
|---|---|---|---|
| `src/chat` | 75 | 32 396 | 185 |
| `src/db` | 51 | 4 914 | 58 |
| `src/code-intel` | 33 | 11 667 | 52 |
| `src/planner` | 32 | 14 414 | 80 |
| `src/expertises` | 23 | 9 487 | 68 |
| `src/routes` | 17 | 7 481 | **3** |

Z 615 vnějších odkazů jich 603 pochází z `tests/**`, zbytek ze `scripts/` (6),
`e2e/` (3), `specialists/` (2) a `bin/` (1). Sloupec je tedy prakticky měřítkem
testového povrchu.

`src/routes/**` drží 272 definic endpointů (P4) a míří na něj tři odkazy —
`tests/marketplace.test.js`, `tests/multimedia.test.js`, `tests/ws-bridge.test.js`.
To není závěr tohoto reportu, jen jeho nejostřejší vedlejší číslo.

---

## 3. Fan-in žebříček — které moduly jsou de facto kontrakty

„Šířka" je počet různých symbolů, které si konzumenti z modulu berou. Modul
s vysokým fan-in a úzkým povrchem je levná hranice; s vysokým fan-in a širokým
povrchem drahá.

| Modul | Fan-in | Zvenčí | Šířka | Nejčastější symboly | Deklarovaná hranice |
|---|---|---|---|---|---|
| `src/core/logger.js` | **184** | 4 | **1** | `logger` (184) | `logger.d.ts` — nekontrolovaný |
| `src/config.js` | 33 | 11 | 2 | `config` (29) | ne |
| `src/db/database.js` | 26 | 29 | **17** | `milestones` (8), `lifecycles` (7), `db` (6) | ne |
| `src/chat/controller.js` | 19 | 12 | 6 | `ChatMode` (17), `ResponseTag` (16), `TaggedResponse` (16) | `controller.d.ts` — nekontrolovaný |
| `src/chat/cre-decision.js` | 15 | **39** | 12 | `creDecisionEngine` (10), `DecisionType` (8), `IntentType` (8) | ne (L0-1 je invariant, ne rozhraní) |
| `src/code-intel/knowledge-graph.js` | 13 | 10 | 5 | `fileNodeId` (6), `EdgeType` (6) | ne |
| `src/llm/auth-types.js` | 12 | 0 | 5 | `LLMCallerRole` (12), `createAuthToken` (11) | ne |
| `src/llm/gateway.js` | 11 | 2 | 2 | `callWithAuth` (11) | ne |
| `src/code-intel/code-analyzer.js` | 10 | 1 | 3 | `detectLanguage` (7) | ne |
| `src/db/migrate.js` | 10 | 1 | 3 | `hasColumn` (9) | ne |
| `src/planner/lifecycle.js` | 9 | 4 | 3 | `ProjectPhase` (5) | ne |
| `src/skills/steps/substitute.js` | 9 | 1 | 1 | `substitute` (9) | ne |
| `src/expertises/merge-types.js` | 7 | 3 | **11** | `MODULE_SECTIONS` (3), `MERGE_LIMITS` (3) | ne |
| `src/chat/safety/engine.js` | 7 | 1 | 4 | `SafetyAction` (5), `SafetyDomain` (5) | `safety/index.js` — obcházený |

Tři pozorování, která z tabulky nejsou vidět na první pohled:

- **`controller.js` je konzumovaný jako slovník, ne jako controller.** Třída
  `ChatController` má jednoho konzumenta; enumy `ChatMode`, `ResponseTag`,
  `TaggedResponse`, `ResponseSpeaker` po šestnácti. Skutečný kontrakt toho
  souboru je protokolový slovník odpovědi — a ten je zamíchaný do 1 000řádkového
  modulu uvnitř 21modulového cyklu (§6).
- **`.d.ts` existují čtyři a nekontroluje je nic.** `logger.d.ts`,
  `error-handler.d.ts`, `controller.d.ts`, `handlers/utils/types.d.ts`. V repozitáři
  není kořenový `tsconfig.json` ani `jsconfig.json`, `checkJs` se nevyskytuje a
  **žádný skript v `package.json` nespouští typovou kontrolu** (0 z 60+).
  Deklarace tedy existuje, důkaz její platnosti ne.
- **`auth-types.js` má 12 konzumentů a nula odkazů z testů.** Je to jediný modul
  v první dvanáctce s nulovým testovým povrchem — a přitom nese `LLMCallerRole`
  a `createAuthToken`, tedy identitu volajícího do LLM brány. Vazba na L0-11 je
  zřejmá; důkaz chybí.

---

## 4. Švy — deklarované versus skutečné

### 4.1 Deklarované hranice, kterými se prochází

| Šev | Kde je deklarovaný | Měření |
|---|---|---|
| route tabulka | `src/server.js:116-132` — factory funkce `createXRoutes()` | drží — všech 17 modulů `src/routes/**` je importovaných tam a nikde jinde v `src/**` |
| `ctx` pro specialisty | `src/specialists/specialist-loader.js:540` + `docs/SPECIALISTS.md` | **jedna hrana ho obchází** — `specialists/accountant-cz/adapters.js:12` importuje `ToolAdapter` přímo (L0-8, viz [L0-8-BOUNDARY](2026-08-07-L0-8-BOUNDARY.md)) |

Graf tuhle druhou položku potvrzuje nezávisle: `src/expertises/tool-adapter.js`
je jediný modul v `src/**`, jehož vnějším konzumentem je balíček specialisty.
Sonda P2 to našla grepem, P6 to našla z grafu — shodně.

### 4.2 Deklarované hranice, které se obcházejí

Barrel `index.js` je v tomhle repozitáři nejčastější způsob, jak říct „tudy
dovnitř". Poměr „přes barrel" : „přímo do vnitřku" měřený jen na hranách
zvenčí adresáře:

| Barrel | Přes barrel | Obchází ho | Poměr |
|---|---|---|---|
| `src/chat/handlers/utils/index.js` | 1 | **31** | 1 : 31 |
| `src/planner/index.js` | 3 | **20** | 1 : 7 |
| `src/chat/handlers/index.js` | 1 | **18** | 1 : 18 |
| `src/executor/index.js` | **0** | 8 | žádný průchod |
| `src/ws-bridge/index.js` | 1 | 7 | 1 : 7 |
| `src/chat/quality/index.js` | 1 | 6 | 1 : 6 |
| `src/notifications/index.js` | 1 | 5 | 1 : 5 |
| `src/architect/index.js` | 1 | 1 | 1 : 1 |
| `src/chat/safety/index.js` | **0** | 1 | žádný průchod |
| `src/channels/index.js`, `src/domains/index.js` | 0 | 0 | nic nevede ani dovnitř |

Celkem **11 : 97**. Tři z těch barrelů jsou přitom samy nedosažitelné (§5).

### 4.3 Vysoký fan-in bez jakékoli deklarované hranice

`logger.js` (184), `config.js` (33), `database.js` (26), `cre-decision.js` (15),
`auth-types.js` (12). U žádného z nich neexistuje dokument, který by říkal, co
je z něj veřejné a co ne, ani test, který by to hlídal. Změna kteréhokoli z nich
se dnes projeví až v běhu.

**Kandidáti na kontraktový registr jsou tímto vymezení: pět modulů z 407,**
ne 405 souborů. Které z nich kontrakt dostanou a v jakém pořadí, je rozhodnutí
operátora; graf jen říká, že mimo tuhle pětici a dvě deklarované hranice z §4.1
není v `src/**` nic s dost širokou vazbou, aby se to za kontrakt dalo považovat.

---

## 5. Nedosažitelné moduly — 62, tj. 20 942 řádků

### 5.1 Rozpad

| Třída | Souborů | Řádků | Co to znamená |
|---|---|---|---|
| `jen-testy` | 37 | 12 551 | konzumentem je výhradně `tests/**` |
| `bez-konzumenta` | 22 | 3 682 | neimportuje je vůbec nikdo |
| `browser-asset` | 2 | 4 554 | `<script src>` z `architect.html` |
| `externi-vstup` | 1 | 155 | `tool-adapter.js` — hrana L0-8 |

### 5.2 `jen-testy` — test bez uživatelské cesty

| Adresář | Souborů | Řádků |
|---|---|---|
| `src/code-intel` | **18** | 6 000 |
| `src/expertises` | 9 | 3 011 |
| `src/planner` | 3 | 1 209 |
| `src/agents`, `src/notifications` | po 2 | 643 / 476 |
| `src/chat`, `src/domains`, `src/memory` | po 1 | 485 / 283 / 444 |

Osmnáct modulů `code-intel` (`context-engine`, `dead-code-detector`,
`debug-agent`, `exploration-agent`, `pattern-miner`, `refactor-agent`,
`risk-analyzer`, `semantic-index`, `perf-analyzer`, `regression-predictor`, …)
má každý svůj test a žádný produkční import. Ověřil jsem i řetězcové odkazy:
mimo `src/code-intel/**` se jejich jména vyskytují dvakrát, obojí v komentáři.
Část platformy je přitom zapojená — `src/planner` → `src/code-intel` má 16 hran —
takže tvrzení zní přesně takto: **zapojená je menšina, ne že není zapojené nic.**

Sem patří i pět nástrojů z P2 (`L8-4`), teď s nezávislým potvrzením:
`src/expertises/tools/{deadline-checker,salary-calc,tax-calc,vat-calc,tax-rates}.js`
jsou **bajtově identické** s `specialists/accountant-cz/tools/*` (shodné md5) a
žádný `specialist.json` na kopii v `src/**` neukazuje — všechny manifesty
odkazují `./tools/…` uvnitř balíčku. Šestý soubor `tax-rates-freshness.js`
(230 řádků) existuje jen v `src/**` a nemá kopii ani konzumenta.

### 5.3 `bez-konzumenta` — 22 souborů

| Skupina | Soubory | Řádků | Pozorování |
|---|---|---|---|
| `src/channels/**` | `index.js`, `types.js`, `cli-adapter.js` | 844 | celá „C.3 Channel Adapter Layer" — má vlastní kontrakt `docs/channels/CHANNEL_ADAPTER_CONTRACT.md` a nulový runtime |
| `src/domains/**` | 8 scaffoldů + 3 recepty | 1 545 | visí na `domains/index.js`, který je sám `jen-testy` |
| `src/core/tracer-*.mjs` | 2 | 194 | `--import` hooky; v celém stromu je nespouští nic — ani `package.json`, ani `systemd/`, ani `docker/` |
| `src/llm/prompts.js` | 1 | 316 | `PROMPTS` bez konzumenta; živý je jiný `PROMPTS` z `src/architect/prompts.js` |
| `src/executor/` | `index.js`, `health-monitor.js` | 361 | monitor je dosažitelný jen přes mrtvý barrel |
| `src/chat/safety/` | `index.js`, `integration.js` | 297 | `engine.js` běží (fan-in 7), integrační vrstva ne |
| `src/chat/export/export-extended.js` | 1 | 125 | viz níž |

**`export-extended.js` je poučný a nesmí se přečíst špatně.** Soubor v hlavičce
říká: *„Adds PDF and DOCX export to the existing export-pipeline.js. Integration:
1. Import this module…"* Ten import nikdo neudělal — ale PDF a DOCX export
**funguje**, protože `src/chat/export-pipeline.js:16-17` importuje
`pdf-exporter.js` a `docx-exporter.js` přímo. Mrtvý je návod, ne schopnost.
Kdyby report počítal jen fan-in, vyšlo by z toho „PDF export nemá cestu
k uživateli" — což by byla nepravda.

### 5.4 `browser-asset`

`src/ui/architect/architect.js` (3 758 řádků) a `c3-visibility.js` (796) jsou
načítané z `architect.html:1343-1344`. Nejsou mrtvé, jsou to soubory jiného
runtimu. Osud legacy UI `/architect` je otevřená položka `CONTRACT.md §9` —
tady je k ní jen změřená velikost: **4 554 řádků**.

---

## 6. Cykly — kde je modularita dnes nemožná

| SCC | Modulů | Obsah |
|---|---|---|
| 1 | **21** | `chat/controller.js` ↔ `chat/cre-decision.js` ↔ 17 handlerů + `executor/tool-executor.js` + `specialists/specialist-loader.js` |
| 2 | 5 | `chat/safety/engine.js` ↔ 4 politiky (`finance`, `general`, `health`, `law`) |
| 3 | 2 | `planner/index.js` ↔ `planner/lifecycle-build.js` |

SCC 1 je odpověď na otevřenou otázku „Rozdělení #6" v podobě, ve které se dá
rozhodovat: cyklus přesahuje tři adresáře a **vtahuje do sebe loader specialistů
a tool executor**. Žádný z těch 21 modulů nelze vyjmout samostatně; hranice chat
pipeline dnes není u `src/chat/`, ale kolem téhle jednadvacítky.

SCC 2 a 3 jsou lokální a levné — u obou jde o vzájemný import konstant.

### Kde se cykly schovávají

`await import()` s literálem drží **196 z 992 hran** (20 %) ve 46 souborech;
nejvíc `server.js` (25), `planner/lifecycle-build.js` (19),
`chat/handlers/pre-handler.js` (12), `routes/expertises.js` (12). Dynamický
import je legitimní vzor, ale zároveň jediný způsob, jak se v ESM cyklus přestane
projevovat při startu. Kolik z těch 196 je lazy-loading a kolik obcházení cyklu,
tento report neurčuje — je to měřitelné a patří to do rozhodnutí o §6.

---

## 7. Co sonda nerozhodla

- **nenavrhuje smazat nic.** 62 nedosažitelných modulů je vstup pro disposition
  `RETAIN` / `RETIRE` podle `CONTRACT.md §5`, kterou dělá operátor. Report
  nepoužil ani jednou slovo „mrtvý" jako verdikt;
- **neurčuje, které švy dostanou kontrakt.** §4.3 vymezuje pětici kandidátů;
  výběr a pořadí je operátorský;
- **nemění `L0-8`.** Potvrzuje P2 nezávislou metodou, nic víc;
- **neřeší `#6`.** Dodává tvar cyklu, který to rozhodnutí potřebuje;
- **nepřidává nic do L1.** Měřidlo není v `package.json` a nic ho nespouští
  automaticky. Jestli se má drift hlídat průběžně, je to nový aparát podle
  `ROADMAP.md §12` a vyžaduje rozhodnutí, ne tichý commit.

---

## 8. Ověření, že report sedí

```bash
# 1. přeměřit celý graf (přepíše JSON; na čisté revizi musí být diff prázdný)
node scripts/module-graph.mjs . --out docs/review/2026-08-07-MODULE-GRAPH.json
git diff --stat docs/review/2026-08-07-MODULE-GRAPH.json

# 2. fan-in logger.js: 179 + 5 = 184, žádný jiný tvar
grep -rn "import { logger } from '.*logger.js'" --include="*.js" src/ | wc -l        # 179
grep -rn "import { logger as [A-Za-z]* } from '.*logger.js'" --include="*.js" src/ | wc -l  # 5

# 3. duplicitní nástroje z §5.2
md5sum src/expertises/tools/*.js specialists/accountant-cz/tools/*.js | sort | uniq -w32 -d | wc -l  # 5

# 4. typová kontrola nad src/** neexistuje
find . -maxdepth 1 -name 'tsconfig.json' -o -maxdepth 1 -name 'jsconfig.json'       # prázdné
node -e "console.log(Object.values(require('./package.json').scripts).filter(v=>/tsc|type-check/.test(v)).length)"  # 0

# 5. PDF/DOCX export je zapojený (kontrola proti chybnému čtení §5.3)
grep -n "exporter.js" src/chat/export-pipeline.js                                   # řádky 16-17
```

Report je pravdivý jen tehdy, když bod 1 nechá JSON beze změny. Kterýkoli
rozchod znamená, že se strom mezitím pohnul — pak platí JSON, ne tabulky.
