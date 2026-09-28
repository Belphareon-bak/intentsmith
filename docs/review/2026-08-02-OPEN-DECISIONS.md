# Rozhodnutí ke schválení

**2026-08-02** · `6a3fcef9` · adresát: operátor

> Verze 3. Verze 1 vydávala za nálezy věci, které už jsou v `SYSTEM-MAP.md`.
> Verze 2 to opravila, ale rozhodnutí byla nerozhodnutelná — chyběla čísla.
> Tahle verze doplňuje, **co se děje dnes, co která varianta znamená a co stojí.**
> Doměření změnilo čtyři z devíti závěrů; u `R3` zrušilo celé rozhodnutí.

---

## 0. Co je odkud

`SYSTEM-MAP.md` už obsahuje: nesoulad adresářů a schopností včetně mapování
(`R1`), pět nedeklarovaných prerekvizit (`R4`), rozložení `offline`/`model`
(`R3`), token streaming a rehydrate (`R5`). **Tenhle dokument to neobjevil —
převádí zaznamenaný stav na volbu.** `SYSTEM-MAP.md` popisuje a výslovně
nerozhoduje; to je jeho role.

Nové z tohoto průchodu je: **16 faktických odpovědí** (§1), **nález o mrtvém
kódu** (§2) a **čísla v §3**, která bez doměření nebyla nikde.

---

## 1. Zodpovězeno bez tebe — 16 položek

| # | Otázka | Zjištění |
|---|---|---|
| **G-3** | Kdo používá `LEGACY_DIRECT`? | Jediné místo: `routes/expertises.js:255`. |
| **X-2** | Dva executory — stará a nová cesta? | Ne, dvě cesty, obě živé: `tool-executor.js` = chat, `c3-tool-executor.js` = build. |
| **A-2** | Jeden orchestrátor, nebo dva? | Dva, žije jeden. `architect/orchestrator.js` přes `routes/architect.js`. `planner/multi-agent.js` ne — §2. |
| **A-4** | Co edituje `editor.js`? | `EditorLLM`, izolovaný, volaný jen z Orchestratoru po splnění gates. |
| **CI-2** | `perf-analyzer.js` — výkon čeho? | Analyzovaného kódu, ne C3. Advisory, neblokuje milníky. |
| **E-3** | 18 vs 15 expertíz | Tři navíc nejsou v `expertise-layer.js` — od specialistů. Potvrzuje `E-1`. |
| **T-3** | Proč `npm-audit.js` mimo registr? | Obaluje `spawnSync` s timeouty a stropem 2 MB. |
| **S-1** | Krok `shell` vs. zákaz shellu | Není díra: whitelist, sandbox na workspace, 120 s timeout. Zákaz `bash` v `AGENTS.md` platí pro agenta, ne produkt. |
| **L-3** | Tři „quality" | `quality-score` = spojité skóre, není blocker; `quality-gate` = syntax check před R1; `quality-gate-v2` = post-processing chatu. |
| **W-2** | Rehydrate — vada? | Vědomý stub, `ws-server.js:241`: *„full DB validation in Phase 1.2"*. |
| **X-3** | Web search k nástrojům? | `tool-executor.js` je jediný konzument. |
| **W-1, PA-3, CI-3** | | Bezpečnost odložená §9 / pozorování. |

---

## 2. Nález — `multi-agent.js` se nikdy nespustil

396 řádků, žádný konzument v produkci. `git log -S "multiAgentBuild(" --all`
vrací **jediný commit** — ten, který soubor přidal. Nebyl odpojen refaktorem,
**nikdy zapojený nebyl**.

`docs/ARCHITECTURE.md` ho přitom vede jako *„Phase I (Governance) · 100 % ·
… multi-agent"* a `tests/multi-agent.test.js` je zelený. Dokumentace tvrdí
hotovo, test svítí, produkt to nevolá.

---

# 3. Rozhodnutí

---

## `R1` — Adresáře vs. schopnosti

### Co se děje dnes

`SYSTEM-MAP.md` vede závazné mapování schopnost → soubory a u pěti schopností
musí psát „**mimo**" nebo „**+**", protože adresář neodpovídá:

```
#11 Execution  = patch/ + executor/ + planner/execution-loop.js + planner/error-normalizer.js
#10 Lifecycle  = planner/ MIMO soubory patřící #11 a #13
#13 Governance = architect/ + planner/architecture-guardian.js
#7  Expertizy  = expertises/ MIMO specialist-runtime, scenario-engine, knowledge-base
#8  Specialisté (mimo základ) = specialists/ + 1 516 ř. v expertises/
```

`src/planner/` je domovem tří schopností. Celkem ~6 771 řádků leží jinde.

### Co to stojí — **doměřeno, a je to levnější, než jsem tvrdil**

Kolik souborů odkazuje na kandidáty přesunu:

| Modul | Ř. | Odkazuje na něj |
|---|---:|---:|
| `architecture-guardian.js` | 658 | **1 soubor** |
| `debug-agent.js` | 508 | **1 soubor** |
| `web-search.js` | 937 | 2 soubory |
| `error-normalizer.js` | 483 | 3 soubory |
| `ltm-context.js` | 186 | 3 soubory |
| `execution-loop.js` | 968 | 4 soubory |
| `agent-wizard.js` | 671 | 4 soubory |

Ve verzi 2 jsem psal o „jednorázově velkém diffu". **Není to pravda.** Přesun
`architecture-guardian.js` znamená `git mv` a opravu jednoho importu. Celý
přesun je řádově **18 souborů s upraveným importem**, ne stovky.

### Varianty

| | Co se udělá | Cena |
|---|---|---|
| **A** | `git mv` všech sedmi modulů do adresářů podle schopností, oprava ~18 importů. | Půl dne. Rozbije `git blame` u 6 771 řádků. |
| **B** | Nic. Mapování zůstává v `SYSTEM-MAP.md`. | Nula. Hranice žije jen v dokumentu, tedy se zase rozejde. |
| **C** | Přesune se vždy jen to, co patří k právě řešené schopnosti. | Rozloženo do 20 kroků, každý pár minut. |

### → Navrhuju `A`

Ve verzi 2 jsem navrhoval `C` s odůvodněním, že velký přesun je drahý.
**Po změření to odůvodnění neplatí** — 18 importů není drahé. A `C` má vadu,
kterou jsem podcenil: `src/planner/` je sdílený třemi schopnostmi, takže
při práci na #11 se stejně musí sáhnout na hranici #10 a #13. Postupný přesun
tedy neznamená 20 malých kroků, ale tři propletené.

> **Protiargument:** #1 i #2 došly do PASS, aniž se přesunul jediný soubor.
> To je empirický důkaz, že nesoulad PASS neblokuje — a moje věta „bez hranice
> není PASS" tím padá. Kdo tomu věří, zvolí `B` a ušetří i těch 18 importů.
> **Kde protiargument končí:** #1 a #2 jsou shodou okolností jediné dvě
> schopnosti, jejichž kód rozstřelený *není*. Zkouška přijde u #11.
>
> **Druhý protiargument, věcný:** `git blame` na 6 771 řádcích je skutečná
> ztráta, pokud se v tomhle kódu ještě bude hledat historie. `git log --follow`
> to částečně řeší, `git blame` ne.

---

## `R2` — Kdy se dělí velký soubor

### Co se děje dnes

Tvoje dva precedenty jdou proti sobě:

| Soubor | Ř. | Rozhodnutí | Odůvodnění |
|---|---:|---|---|
| `cre-decision.js` | 4 196 | **nedělit** (`C-4`) | soudržnost rozhodovací logiky |
| `system.js` | 1 621 | **rozdělit** (`N-6`) | 36 rout napříč GPU, úložištěm, modely |

**Menší soubor se dělí, větší ne.** Řádky tedy kritérium nejsou — ale žádné
jiné napsané není.

Čeká na to: `registry.js` (5 094 ř. / 213 nástrojů), #6 jako celek (20 400 ř.),
`lifecycle-build.js` (2 138), `expertise-layer.js` (1 682).

### Varianty

| | Kritérium | Kdy se to pozná |
|---|---|---|
| **A** | Dělí se soubor, který obsluhuje víc než jednu **schopnost**. | Hned, z `SYSTEM-MAP.md`. |
| **B** | Dělí se, až když nejde napsat seznam chování, protože soubor dělá dvě nesouvisející věci. | Až v kroku 2 dané schopnosti. |
| **C** | Případ od případu. | — |

### → Navrhuju `A`

Ve verzi 2 jsem navrhoval `B`. Měním to, protože `B` má díru: `registry.js`
má 213 nástrojů **jedné** schopnosti, takže seznam chování #16 se nad ním
napsat dá — a `B` by tedy řeklo „nedělit", i když je to 5 094 řádků v jednom
souboru. `A` dává tutéž odpověď na oba tvé precedenty (`cre-decision.js` = jedna
schopnost → nedělit; `system.js` = čtyři schopnosti → dělit) a navíc se pozná
předem.

> **Protiargument:** `A` neřeší velikost vůbec. Podle `A` je `registry.js`
> v pořádku napořád, protože 213 nástrojů je jedna schopnost. Kdo chce
> u pětitisícového souboru nějakou brzdu, potřebuje k `A` ještě řádkový práh —
> a ten je hrubý a svévolný.
>
> **Druhý protiargument:** **dva body nejsou vzor.** Možná žádné pravidlo
> nepotřebuješ a případ od případu stojí jednu krátkou úvahu za rok.

---

## ~~`R3`~~ — zrušeno, rozhodnutí neexistuje

**Doměření premisu vyvrátilo.** Tvrdil jsem: *„QGv2 je deterministický
(L0-5), ale 11 z 24 sad má profil `model` → vada evidence."*

Ve skutečnosti je rozdělení **už hotové**:

| Skutečné unit testy QGv2 — všechny `offline` | Sady profilu `model` |
|---|---|
| `qg-idempotence` — `runQualityPipeline(runQualityPipeline(x)) === runQualityPipeline(x)` | `e2e/93-chat-response-quality` — *„Tier 3+: … responses are well-structured, accurate, genuinely useful"* |
| `quality-gate`, `quality-gates`, `quality-score` | `e2e/95-code-generation-quality`, `96`, `97`, `98`, `86`, `73`, `52`, `94` |
| `response-scorer`, `drift-detector` | `chat-quality`, `expertise-ab-quality` |
| `chat-output-quality`, `chat-search-quality`, `search-quality-a123`, `quality-sprint-q` | |

**Devět z jedenácti jsou E2E měření kvality produktu**, ne testy QGv2. Ty model
potřebují oprávněně — měří, jestli odpověď je dobrá, ne jestli je pipeline
idempotentní. Hypotéza `Q-1` v inventuře (*„pravděpodobně testují QGv2 nad
reálnými výstupy modelu"*) byla správná.

**Nic k rozhodnutí.** Jediné, co z toho plyne: těch devět E2E sad jsou metriky
**L3**, ne akceptační chování #5, takže do seznamu chování #5 nepatří.

---

## `R4` — Nedeklarované prerekvizity · **není to jedna věc, ale dvě**

### Co se děje dnes

Z čerstvého klonu projde 194 z 199. Pět sad, ale **ze dvou různých důvodů**:

| Sada | Příčina | Druh |
|---|---|---|
| `export-pdf-docx` | chybí Python PDF runtime (`scripts/install-pdf-runtime.sh`) | prerekvizita |
| `chat-export-budget` | totéž, 4 aserce | prerekvizita |
| `quality-gate` | `go` není dosažitelné v izolovaném PATH | prerekvizita |
| `multi-source-integration` | **exit 1, přestože všechny viditelné aserce projdou** | **neprošetřená vada** |
| `nightly-audit-runner-self-test` | **exit 1 na scénáři s `BLOCKED` model testem** | **neprošetřená vada** |

Ve verzi 2 jsem to vedl jako jedno rozhodnutí o deklaraci. **Dvě z pěti ale
nejsou prerekvizity** — je to sada, která hlásí selhání bez viditelné příčiny.
Ta se deklarací nespraví.

Proč to je vážné: `G0-C5` („každá required deterministická sada projde") je
nosné číslo Gate 0. Těch pět je `ACTIVE` a `required`, ne `BLOCKED`, takže
`G0-C7` — který pojmenovanou prerekvizitu vyžaduje jen u `BLOCKED` — tuhle
třídu chyby zachytit nemůže.

### Varianty pro tři prerekvizity

| | | Důsledek |
|---|---|---|
| **A** | Deklarovat a přeřadit na `BLOCKED` | Titulkové číslo klesne 199 → 196. Čísla začnou být pravdivá. |
| **B** | Doinstalovat Python a Go v `install.sh` | Číslo zůstane, instalace ztěžkne o dva toolchainy. |

Dvě vady se musí prošetřit tak jako tak — to není volba.

### → Navrhuju `A` + prošetřit ty dvě

> **Protiargument:** deklarace srazí číslo přesně ve chvíli, kdy se chystá merge
> a Gate 0 kandidát, a „194 z 199" se v tabulce čte hůř než „199 z 199".
> **Proč to přesto navrhuju:** 194 je pravda a `GATE-CRITERIA.md` si sám říká
> *„Evidence that cannot satisfy this contract from a fresh clone is not evidence."*

---

## `R5` — Rozsah 1.0

### `W-3` Token streaming — **doměřeno**

Dnes: `gateway.js:428` má **`stream: false` natvrdo**. `onLLMToken` existuje
na jednom místě (`session-adapter.js:297`) jako konzument **bez producenta**.

Zavést to znamená: gateway umí `stream: true` a parsuje NDJSON po částech →
`callWithAuth` propaguje částečné výsledky → handlery v #6 je umí předat →
`controller.js` je pošle do `ws-bridge` → `onLLMToken` konečně něco dostane.
**Sahá to do #3, #6 i #21** a žádná z nich nemá seznam chování.

**→ Navrhuju nedělat teď**, zapsat jako chování #21 (8. v pořadí).

> **Protiargument:** je to jediná položka, kterou uživatel pozná **okamžitě**.
> Produkt s 15 zelenými schopnostmi, kde odpověď přijde po deseti vteřinách
> vcelku, působí rozbitě bez ohledu na důkazy. Odklad na osmou pozici může
> znamenat měsíce.

### `W-4` `c3-ide/` — **→ Navrhuju mimo 1.0**, opřít se o `/architect` (ověřeno: 200, 74 KB)

> **Protiargument:** 32 rozšíření a Phase E na 85 % je hodně odvedené práce.
> Pro část uživatelů **je IDE ten produkt**, ne web UI.

### Zbytek — **→ Navrhuju nechat, nepřeřazovat**

`roadmap.js` (325 ř.), `export-pipeline.js` (517 ř.), `preferences.js` (715 ř.).
Přeřazení je přejmenování, ne zlepšení.

> **Protiargument u `preferences.js`:** je to stejný vzor jako #18 — dvě věci
> pod jedním jménem. Tam ses rozdělit rozhodl.
> **U `export-pipeline.js`:** je to jediný důvod prerekvizity z `R4`.

---

## `R6` — Hlubší inventura #6

Inventura #6 je vědomě mělčí — sám jsem do ní napsal, že 20 400 řádků a 46
souborů chce samostatný úkol. #6 je **7. v pořadí**, obsahuje routing, syntézu,
expertizy, lifecycle, soubory, skills, wizard i design.

**→ Navrhuju udělat hlubší průchod dřív, než na #6 dojde řada.** `CONTRACT.md`
§7 na to potřebuje tvůj souhlas, protože #6 teď na řadě není.

> **Protiargument:** je to práce dopředu na schopnost vzdálenou pět míst.
> Do té doby se kód změní a část průchodu zestárne. Levnější je dojít k #6
> normálně.

---

## `R7` — `multi-agent.js`

**→ Navrhuju smazat soubor i test.** Historie ukazuje, že zapojený nikdy nebyl,
takže „zapojit zpátky" není obnova, ale **nová funkce** — a ta patří do
rozhodnutí o rozsahu, ne do úklidu.

> **Protiargument:** 396 řádků implementuje feasibility gate, pět rolí a kritika
> s max 2 iteracemi opravy. `lifecycle-build.js` (2 138 ř.) staví dnes
> jednofázově a ta pipeline by mu měla co dát. **Kde to selhává:** „stačí
> zavolat" je odhad. Kód, který nikdy neběžel v produkci, není hotový — je
> nevyzkoušený. A zelený test nad ním aktivně lže o stavu produktu.

---

## `R8` — `EX-1` blokuje merge · **P0**

Mobilní větev definuje `G0-R021` jako neautentizované RCE, trunk pod týmž ID
vede něco jiného, `GATE0-RISK-IMPACT.json` na to nemá entry. Merge v současné
podobě shodí `G0-C9`, a tím celý Gate 0. Hotový návrh opravy (přejmenovat na
`G0-R032` + připravená JSON entry) leží v `2026-08-01-STATE-AND-VERIFICATION.md`.

**→ Navrhuju opravit jako součást jedné merge dávky.**

> **Protiargument:** žádný věcný. Volba je jen **kdy**.

---

## `R9` — #18b a síť · **přeformulováno, můj předchozí návrh nejde udělat**

### Co se děje dnes — doměřeno

Ve verzi 2 jsem navrhoval „kód nechat, síť vypnout". **Vypínač neexistuje.**
`server.js:1372` volá `upgradeManager.startPeriodicCheck()` **bez feature flagu**.
Env proměnné v `src/upgrade/` ladí jen limity (`C3_DISCOVERY_MAX_FAMILIES`,
`C3_REGISTRY_INDEX_TTL_MS`), nezapínají ani nevypínají.

Zpřesnění proti `SYSTEM-MAP.md`, které to popisuje jako „poll 5 min, jediná
cesta ven":

| Cyklus | Perioda | Kam sahá |
|---|---|---|
| **L1** — startup + poll | 5 minut | **lokální Ollama**, ven nejde |
| **L4/L5** — full cycle | **24 h ± 90 min** | `online-discovery`, `whatllm-client`, `registry-client` → **internet** |

Produkt tedy **volá ven jednou denně**, ne každých pět minut. Ale volá — a nejde
to vypnout jinak než zásahem do kódu.

### Varianty

| | | Cena |
|---|---|---|
| **A** | Přidat feature flag (default **off**), kód nechat | ~10 řádků. 9 470 ř. plochy zůstává v produktu neověřených. |
| **B** | Vyříznout 18b do pluginu / mimo repo | Velký zásah. Local-first produkt bez jediné cesty ven. |
| **C** | Nechat, jak je | Produkt volá ven bez souhlasu uživatele a bez možnosti to vypnout. |

### → Navrhuju `A`

Nejlevnější krok, který odstraní to podstatné: local-first produkt nemá volat
ven bez volby uživatele. `B` je správnější cíl, ale je to velká práce a nemusí
se dělat teď.

> **Protiargument:** „ponecháno, ale vypnuto" je nejhorší ze tří — platí se
> údržba a plocha, a nezískává se funkce. **Půlka rozhodnutí je způsob, jak ho
> neudělat.** Kdo tomu věří, jde rovnou na `B`.

---

## 4. Souhrn ke schválení

| # | Návrh | Změna proti verzi 2 |
|---|---|---|
| `R1` | **A** — přesunout teď | ⚠ bylo `C`; přesun je 18 importů, ne velký diff |
| `R2` | **A** — dělí se podle počtu schopností v souboru | ⚠ bylo `B`; `B` nechává `registry.js` navždy |
| `R3` | **zrušeno** | ⚠ premisa vyvrácena, rozdělení už existuje |
| `R4` | **A** + prošetřit 2 vady | ⚠ dvě z pěti nejsou prerekvizity |
| `R5` | streaming odložit · `c3-ide` mimo · zbytek nechat | — |
| `R6` | udělat hlubší inventuru #6 dřív | — |
| `R7` | smazat | — |
| `R8` | opravit v merge dávce | — |
| `R9` | **A** — přidat flag, default off | ⚠ „vypnout" dnes nejde, vypínač neexistuje |

Stačí `R1: A, R2: A, …`; kde chceš protiargument, napiš ho místo písmene.

Hotové: **#1 PASS** (13/13) · **#2 PASS** (10/10 + 9/9).
