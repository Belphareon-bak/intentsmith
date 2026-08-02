# Otevřená rozhodnutí — všech 22 schopností najednou

**2026-08-02** · `a606ac1c` · adresát: operátor
**Důvod vzniku:** rozhodnutí operátora — schopnost po schopnosti je neefektivní,
protože otázky se napříč inventurami opakují. Tenhle dokument je sesypává.

---

## Co z toho je vlastně otázka na tebe

Inventury vyprodukovaly **47 otevřených položek**. Po projití to vypadá takhle:

| | Počet |
|---|---:|
| **Faktické dotazy** — nepotřebovaly tebe, jen zjistit. Zodpovězeno níže v §1. | **16** |
| **Odložené podle `CONTRACT.md` §9** (bezpečnost) — nic nového | 4 |
| **Skutečná rozhodnutí** — §3 | **9** |
| z toho jedno nové, které inventury minuly (§2) | 1 |

Devět rozhodnutí místo 47 otázek. Většina inventurních položek jsou totiž
**instance téhož problému** — nejsou to nezávislé volby.

---

## 1. Zodpovězeno bez tebe

Ověřeno v kódu, ne odhadnuto. Uzavírám je, pokud neřekneš jinak.

| # | Otázka | Zjištění |
|---|---|---|
| **G-3** | Kdo používá roli `LEGACY_DIRECT`? | **Jediné místo:** `routes/expertises.js:255`. Ne rozeseté obcházení, jeden konkrétní volající. |
| **X-2** | Dva executory — stará a nová cesta? | **Ne, dvě různé cesty.** `tool-executor.js` obsluhuje chat (`server.js`, `handlers/decisions.js`), `c3-tool-executor.js` obsluhuje build (`lifecycle-build.js`). Obojí živé. |
| **A-2** | Jeden orchestrátor, nebo dva? | **Dva, a jen jeden žije.** `architect/orchestrator.js` je dosažitelný přes `routes/architect.js` → `architect/index.js`. `planner/multi-agent.js` **nemá v produkci konzumenta** — viz §2. |
| **A-4** | Co edituje `editor.js` v governance? | `EditorLLM` — izolovaný editor kódu bez kontextu konverzace, volaný **výhradně** z Orchestratoru po splnění gates. Patří k architect módu, ne k #11. |
| **CI-2** | `perf-analyzer.js` — výkon čeho? | **Analyzovaného kódu**, ne C3. Detekuje N+1 dotazy, neohraničené smyčky, sync-in-async. *Advisory only — neblokuje milníky.* |
| **E-3** | 18 expertíz vs. 15 v dokumentaci | Tři navíc (`sazeni`, `translator`, `code_reviewer`) **nejsou v `expertise-layer.js`** — pocházejí od specialistů. Potvrzuje `E-1`: hranice #7/#8 je opravdu rozmazaná. |
| **T-3** | Proč je `npm-audit.js` mimo registr? | Spouští `spawnSync` s vlastními timeouty a stropem výstupu (2 MB). Je to modul kolem procesu, ne deklarace nástroje. Důvod existuje. |
| **S-1** | Krok `shell` ve skills vs. zákaz shellu | **Není to díra.** `steps/shell.js` má **whitelist** (ne blacklist), sandbox na workspace cwd, 120 s timeout. Zákaz `bash` v `AGENTS.md` platí pro *agenta*, ne pro produkt — jiný subjekt. |
| **L-3** | Tři různé „quality" | Tři různé věci, jen špatně pojmenované: `quality-score.js` = spojité diagnostické skóre 0–1, **není blocker**; `quality-gate.js` = compile/syntax check mezi generováním a R1; `quality/quality-gate-v2.js` = post-processing chatové odpovědi. Nekolidují. |
| **W-2** | Rehydrate bez ověření — vada, nebo záměr? | **Vědomý stub.** `ws-server.js:241`: *„For now, acknowledge all — full DB validation in Phase 1.2"*. Nedodělek, ne přehlédnutí. Na loopbacku inertní. |
| **CI-3** | — | Nebyla otázka, bylo to pozorování. |
| **X-3** | Web search patří spíš k nástrojům? | Potvrzeno: `tool-executor.js` je jediný konzument `web-search.js`. Vstup do `R1`. |
| **W-1, PA-3, S-1(bezp.), EX-1(bezp. část)** | | Odložené podle `CONTRACT.md` §9. `EX-1` má provozní část v `R8`. |

---

## 2. Nový nález — 396 řádků mrtvého kódu v produkci

Inventury #10 i #13 uvádějí *„Zbytečné: nic prokazatelného"*. To neplatí.

**`src/planner/multi-agent.js` (396 ř.) nemá v produkci žádného konzumenta.**

```
multiAgentBuild, feasibilityGate, buildAgentPrompt, AgentRole
  → grep přes celé src/            : 0 výskytů mimo vlastní soubor
  → dynamické importy v planneru   : 0
  → jediný importér                : tests/multi-agent.test.js
```

Podstatné je, **co to je**: implementuje „multi-agent pipeline 5 rolí
(planner → builder → architect → critic → debugger)", kterou inventura #13
vede v seznamu **předností**. Přednost, která se nikdy nespustí.

Test `tests/multi-agent.test.js` je přitom zelený — testuje kód, který produkt
nevolá. To je přesně ten druh testové hmoty, kvůli které `CONTRACT.md` §1 říká,
že objem nic nedokazuje.

**Rozhodnutí je v `R7`.**

---

## 3. Devět rozhodnutí

### `R1` — Adresáře neodpovídají schopnostem · **největší cluster, 13 položek**

Sesypává: `G-1`, `X-1`, `X-3`, `L-2`, `A-1`, `M-1`, `E-1`, `K-4`, `PA-2`,
`Q-2`, `P-2`, `S-3`, `CI-1`.

Není to třináct problémů, je to jeden, viděný ze třinácti stran. Změřeno:

| Kód | Fyzicky v | Patří ke schopnosti | Ř. |
|---|---|---|---:|
| `execution-loop.js`, `error-normalizer.js` | `src/planner/` | #11 | 1 451 |
| `architecture-guardian.js` | `src/planner/` | #13 | 658 |
| `specialist-runtime`, `scenario-engine`, `knowledge-base` | `src/expertises/` | #8 *(mimo základ)* | 1 516 |
| `web-search.js` | `src/llm/` | #16 nebo vlastní | 937 |
| `agent-wizard.js` | `src/chat/handlers/` | #14 *(mimo základ)* | 671 |
| `debug-agent.js` | `src/code-intel/` | #14 nebo #11 | 508 |
| `model-profiles`, `model-registry` | `src/upgrade/` | #18a *(v základu)* | 844 |
| `ltm-context.js` | `src/chat/` | #15 | 186 |
| **Celkem** | | | **~6 771** |

`src/planner/` je dnes domovem tří schopností. Adresář `src/upgrade/` obsahuje
základ i nadstavbu. **Čtyři z osmi řádků jsou kód nízkoprioritní schopnosti
uvnitř základní** — to je ten vzor, který jsi už jednou rozhodl u `N-1` (#18).

**Proč to není kosmetika:** `CONTRACT.md` §3 zakazuje začít schopnost bez
inventury a §5 definuje PASS na úrovni schopnosti. Když schopnost nemá hranici,
nemá ani PASS. U #11 dnes nejde říct, co je „všechna chování #11", protože 1 451
řádků leží jinde.

| Varianta | Cena |
|---|---|
| **A — adresář = schopnost** | Přesunout ~6 771 řádků do adresářů podle schopností. Jednorázově velký diff, ale hranice pak drží samy. Riziko: rozbité importy, git blame. |
| **B — mapa místo přesunu** | Nechat kód a vést mapování v `SYSTEM-MAP.md`. Nulový diff. Cena: hranice je jen v dokumentu, tedy se zase rozejde. |
| **C — přesunout jen tam, kde to překáží** | Hýbe se, až když schopnost přijde na řadu a hranice brání psát chování. Rozloží náklad v čase. Cena: dočasně nekonzistentní strom. |

### `R2` — Kdy se velký soubor dělí

Sesypává: `P-1` (#6, 20 400 ř.), `E-2` (`expertise-layer` 1 682), `L-1`
(`lifecycle-build` 2 138), `T-1` (`registry.js` 5 094 / 213 nástrojů), `N-6`.

Precedent už máš dvojí a **jde proti sobě**: u `C-4` jsi rozhodl `cre-decision.js`
(4 196 ř.) **nedělit** — soudržnost rozhodovací logiky je důvod nechat to
pohromadě. U `N-6` jsi rozhodl `system.js` (1 621 ř.) **rozdělit**.

Chybí kritérium. Bez něj se u každého velkého souboru budeme ptát znovu.

| Varianta | |
|---|---|
| **A — kritérium podle soudržnosti** | Dělí se, když soubor obsluhuje víc než jednu schopnost (`system.js` ano, `cre-decision.js` ne). Řádky nerozhodují. |
| **B — kritérium podle chování** | Dělí se, až když seznam chování nejde napsat, protože soubor dělá dvě nesouvisející věci. Dělení řídí `CONTRACT.md` §3, ne estetika. |
| **C — případ od případu** | Beze změny. Cena: opakuje se ta samá diskuse. |

### `R3` — Co se dá odtrhnout od modelu

Sesypává: `Q-1` (#5: 11 z 24 sad `model`, přitom QGv2 je deterministický —
invariant L0-5), `L-4` (#10: 19 z 47 `model`), `G-4` (#3: auth vrstva je čistá
logika, měla by jít bez Ollamy).

U `C-2` jsi rozhodl, že **CRE se od modelu neodtrhává** — tam to dává smysl,
CRE je LLM-first. **Ale QGv2 model volat nesmí** (L0-5), takže 11 sad profilu
`model` je buď zbytečná prerekvizita, nebo tam testují něco jiného, než tvrdí.

Dnes to znamená: největší schopnosti nejde ověřit bez GPU.

| Varianta | |
|---|---|
| **A — rozdělit sady** | Deterministické jádro zvlášť, „kvalita nad reálným výstupem modelu" zvlášť. To druhé je L3 metrika, ne akceptační test. |
| **B — nechat** | Cena: #5, #10 a #3 nepůjdou do PASS bez Ollamy. |

### `R4` — Nedeklarované prerekvizity · `K-1` + `EX-6`

Pět sad potřebuje Python PDF runtime nebo Go v izolovaném PATH a **v registru
mají `offline` / `ollama:false`**. Z čerstvého klonu projde 194 z 199, ne 199.

Podle `CONTRACT.md` §5 je nedeklarovaná prerekvizita **vada evidence**.

| Varianta | |
|---|---|
| **A — deklarovat a přeřadit na `BLOCKED`** | Čísla začnou být pravdivá. „199 deterministických" klesne na 194. |
| **B — doinstalovat runtime v `install.sh`** | Prerekvizita zmizí, čísla zůstanou. Cena: instalace ztěžkne o Python toolchain. |
| **C — obojí** | Deklarovat teď, doinstalovat později. |

### `R5` — Co je v rozsahu 1.0

Pět samostatných otázek, každá krátká:

| # | Věc | Ř. | Otázka |
|---|---|---:|---|
| `W-3` | **Token streaming** | — | `onLLMToken` je konzument bez producenta („reserved for future use"). Odpověď přijde až celá. **Ovlivňuje vnímanou rychlost víc než cokoli jiného.** Do 1.0? |
| `W-4` | **`c3-ide/` (Theia/Electron)** | nezměřeno | Vlastní inventura, nebo se 1.0 opře o web UI `/architect`? `G0-R030` ho pro Gate 1 blokuje. |
| `A-3` | **`roadmap.js`** | 325 | C3 umí generovat roadmapu analyzovaného projektu. V rozsahu? |
| `K-2` | **`export-pipeline.js`** | 517 | Export do PDF/DOCX je jiná starost než persistence konverzace. Vlastní (nízkoprioritní) schopnost? |
| `PA-1` | **`preferences.js`** | 715 | Největší soubor #15, ale preference nejsou paměť. Rozdělit jako #18? |

### `R6` — #6 potřebuje vlastní hlubší inventuru · `P-4`, `P-3`

Inventura #6 je **vědomě mělčí** než ostatní — 20 400 řádků a 46 souborů se
strukturálním průchodem vyčerpat nedá. Sám jsem tam napsal, že to chce
samostatný úkol.

#6 je **7. v pořadí** podle `CONTRACT.md` §6. Buď se hlubší inventura udělá,
než na ni dojde řada, nebo se pořadí změní.

### `R7` — Mrtvý `multi-agent.js` · nový nález, viz §2

| Varianta | |
|---|---|
| **A — smazat** | 396 ř. kódu + jeho test. Nejmenší strom, nejmenší lež v testech. |
| **B — zapojit** | Pipeline 5 rolí je hodnotná, jen ji nikdo nevolá. Zjistit, proč se přestala volat, a vrátit ji do BUILD cesty. |
| **C — nechat** | Cena: zelený test kódu, který produkt nevolá. Přesně to, co `CONTRACT.md` §1 vytýká. |

### `R8` — `EX-1` blokuje merge mobilní větve · **P0**

Beze změny od minula, jen ať to nezapadne: mobilní větev definuje `G0-R021`
jako neautentizované RCE, trunk pod týmž ID vede něco jiného, a
`GATE0-RISK-IMPACT.json` na to nemá entry. **Merge v současné podobě shodí
`G0-C9`, a tím celý Gate 0.** Návrh opravy (přejmenovat na `G0-R032` + hotová
JSON entry) leží v `docs/review/2026-08-01-STATE-AND-VERIFICATION.md`.

### `R9` — #18b: 9 470 řádků, které si nikdo nevyžádal

Z inventury mimo základ. Zaznamenávám, protože je to největší jednotlivá
položka „co je zbytečné" v celém projektu a inventura ji označila za hlavního
kandidáta:

- **~1 475 řádků síťových klientů** (`whatllm-client`, `registry-client`,
  `online-discovery`) chodí na internet hledat modely. **V local-first produktu
  je to jediná část, která z principu volá ven.**
- `model-universe-store.js` má **1 919 řádků** — největší soubor v `src/upgrade/`.
- Invariant L0-9 drží (nikdy neupgraduje sám), takže to není riziko. Je to objem.

Otázka: zůstává #18b v produktu 1.0, nebo se vyřadí?

---

## 4. Co navrhuju

Kdyby to bylo na mně:

| # | Návrh | Proč |
|---|---|---|
| `R1` | **C** — přesouvat, až když hranice překáží | Velký přesun teď by zdržel a nic neprokázal. Ale `B` samotné se zase rozejde, takže mapování musí být v `SYSTEM-MAP.md` a přesun povinný ve chvíli, kdy schopnost přijde na řadu. |
| `R2` | **B** — dělí se, až když nejde napsat seznam chování | Váže dělení na `CONTRACT.md` §3 místo na estetiku. Sedí na oba tvé precedenty: `cre-decision.js` seznam chování unesl (14 vět), `system.js` ne. |
| `R3` | **A** — rozdělit sady | U QGv2 je to skoro jistě vada evidence: L0-5 zakazuje LLM volání, takže `model` profil tam nemá co dělat. |
| `R4` | **C** — deklarovat teď, instalovat později | Pravdivá čísla hned, náklad na toolchain až s releasem. |
| `R5` | streaming **ano**, `c3-ide` **ne** | Streaming je jediná položka, kterou uživatel pozná okamžitě. IDE je vlastní build s vlastními riziky. Zbytek (`A-3`, `K-2`, `PA-1`) mimo 1.0. |
| `R6` | udělat hlubší inventuru **dřív**, než dojde řada | Jinak se #6 zasekne na sedmém místě. |
| `R7` | **A** — smazat | Když se pipeline bude chtít, historie gitu ji vrátí. Zelený test mrtvého kódu je horší než chybějící funkce. |
| `R9` | vyřadit síťovou část z 1.0 | Local-first produkt nemá mít jedinou nutnou cestu ven kvůli funkci, kterou si nikdo nevyžádal. |

---

## 5. Co to odblokuje

Po zodpovězení jde psát seznamy chování pro **všech 20 zbývajících schopností**
naráz, protože zbývající otázky jsou už jen uvnitř jednotlivých schopností —
ne mezi nimi.

Hotové: **#1 PASS** (13/13), **#2 PASS** (10/10 + 9/9).
