# Audit vynucení — má deklarovaný kontrakt mechanismus, a kdy zafungoval?

**Zadání:** [`docs/wp/P7-ENFORCEMENT-AUDIT.md`](../wp/P7-ENFORCEMENT-AUDIT.md)
**Revision:** `13701b2a500feac94d13322433721125793c4587` · **Datum:** 2026-08-07
**Adresát:** operátor · vlastník M6 (validační matice třinácti invariantů)
**Navazuje na:** [`MODULE-GRAPH`](2026-08-07-MODULE-GRAPH.md) (švy),
[`L0-8-BOUNDARY`](2026-08-07-L0-8-BOUNDARY.md) (`L8-2` jako precedent)

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Je to vstup rozhodnutí. Neprohlašuje žádný invariant za splněný ani porušený —
> autoritou o stavu invariantů zůstává `SYSTEM-MAP.md`. Audit se ptá o patro
> níž: *čím* by se to poznalo.

---

## Shrnutí pro rozhodnutí

**Registr testů deklaruje 357 programů, 342 z nich značí jako `required`, a
u žádného z nich není zapsaný poslední zelený běh.** Pole `lastGreen` má každá
suita, validátor (`scripts/test-registry.js:279-280`) kontroluje, že v něm jsou
klíče `commit` a `artifact` — a nekontroluje, že v nich něco je. Ve všech 357
případech jsou `null`. 81 suit je ve stavu `BLOCKED`.

Otázka „kdy naposledy zafungoval" tedy nemá pro **žádný** deklarovaný kontrakt
v tomto repozitáři strojově zjistitelnou odpověď. To není nález o jednom guardu;
to je nález o měřidle, kterým se má M6 řídit.

Vedle toho má vynucení v repozitáři čtyři různé tvary a jen jeden z nich je
vynucení:

| Třída | Co to je | Instance |
|---|---|---|
| **A — fail-closed guard** | porušení shodí proces nebo operaci | L0-10 (úplné), L0-1 (téměř úplné), L0-6 (částečné) |
| **B — default místo meze** | číslo z invariantu je výchozí hodnota, kterou lze přepsat bez kontroly | **L0-3, L0-7** |
| **C — guard bez dosahu** | mechanismus existuje, ale strukturálně porušení nevidí | **L0-8** (`L8-2`) |
| **D — bez mechanismu** | invariant nemá kód ani test, který by zčervenal | **L0-11, L0-13** |

Pátý tvar stojí stranou a je nejzajímavější: **L0-5 dnes platí měřením, ne
vynucením.** Z grafu P6 vede z `src/chat/quality/**` šestnáct hran a **nula**
do `src/llm/**` — QGv2 skutečně nevolá model. Nic ale nebrání šestnáctou hranu
přidat; „žádné LLM volání" je v kódu napsané jako komentář
(`quality-pipeline.js:11`), ne jako kontrola.

### Nálezy

| ID | Nález | Kde |
|---|---|---|
| `EN-1` | 357 registrovaných suit, 342 `required`, **0 se zapsaným posledním zeleným během**; validátor kontroluje tvar pole, ne obsah | §2 |
| `EN-2` | 81 suit ve stavu `BLOCKED` uvnitř těch 342 `required` | §2 |
| `EN-3` | L0-7 „max 8 iterací" je `parseInt(process.env.C3_MAX_LOOP_ITERATIONS \|\| '8')` bez horního clampu — invariant je default, ne mez | §4.2 |
| `EN-4` | L0-3 „max 2 retries" je přepsatelné parametrem `options.maxRetries` bez kontroly; dnes to nikdo nedělá, takže invariant platí shodou okolností | §4.2 |
| `EN-5` | L0-5 platí měřením (0 hran `quality → llm`), vynucené není; graf z P6 by z toho udělal kontrolu za jeden řádek | §4.4 |
| `EN-6` | Švy z P6 — route tabulka, `ctx`, barrel `index.js` — nemají **žádný** vynucovací mechanismus; jediný, který existoval, byl `L8-2` a ten vypisoval nulu | §5 |

---

## 1. Metoda a její hranice

Audit je **statický**. Sadu jsem nespustil a je to vědomé rozhodnutí, ne
opomenutí: `scripts/nightly-audit.js`, `scripts/test-registry.js` i
`tests/registry.json` měly během této relace jiného zapisujícího vlastníka
(`CONTRACT.md §6`). Běh by měřil pohyblivý cíl a sahal by na sdílený stav —
`data/c3.db`, porty, `.intentsmith-artifacts/`. Proto tento report **netvrdí
o žádném invariantu, že prošel nebo neprošel**; tvrdí, čím by se to poznalo.

Hloubka není u všech třinácti stejná a je u každého řádku označená:

- **trasováno** — našel jsem konkrétní místo v kódu a přečetl, co dělá při porušení;
- **lokalizováno** — vím, kde mechanismus je, ale nečetl jsem jeho chování do konce;
- **bez mechanismu** — hledal jsem a nenašel.

Nálezy o L0-8 a L0-11 přebírám z P2 a P4 a znovu je neměřím.

---

## 2. Registr testů jako mechanismus

`tests/registry.json` je nejblíž tomu, co by odpovědělo „kdy to naposledy
zafungovalo".

| Veličina | Hodnota |
|---|---|
| registrovaných suit | 357 |
| z toho `required` | 342 |
| stav `ACTIVE` / `BLOCKED` / `HISTORICAL` | 261 / **81** / 15 |
| profily `offline` / `model` / `server` / `database` / `soak` / `manual` | 178 / 84 / 36 / 26 / 18 / 15 |
| **suit se zapsaným `lastGreen.commit`** | **0** |

Nula není překlep ani chybějící pole. Pole tam je u všech 357 a validátor ho
vyžaduje — `scripts/test-registry.js:279-280` hlásí chybu, když `lastGreen`
neobsahuje klíče `commit` a `artifact`. Hodnota `{ commit: null, artifact: null }`
projde. Renderer (`:382-396`) pak umí prázdnou hodnotu vypsat do tabulky.
**Zapisovatele té hodnoty jsem v repozitáři nenašel** — grep na `lastGreen`
vrací validátor, renderer, generátor prázdných záznamů
(`reconcile-ffd-e2e-registry.js:113`) a dva testy, které si prázdnou hodnotu
staví jako fixture. Nic, co by po zeleném běhu zapsalo commit.

To je přesně vzorec `L8-2` o patro výš: aparát je zaveden, tvar hlídá, obsah ne.

`classificationBasis` registru navíc odkazuje na `3a6efa6e…`, tedy jinou revizi
než dnešní HEAD. Klasifikace je tedy platná k commitu, na kterém vznikla.

---

## 3. Třináct invariantů — mechanismus a jeho tvar

| # | Invariant | Mechanismus | Třída | Hloubka |
|---|---|---|---|---|
| 1 | CRE je jediná autorita | `assertDecision()` `cre-decision.js:4045` + `assertNoDirectAnswer()` `:4148` — obojí `throw` | **A** | trasováno |
| 2 | `mergeExpertisePrompt()` čistá funkce | `merge-engine.js:449-455` hlídá **vstupy** (`throw` na počet expertíz); čistotu samotnou nehlídá nic | vlastnost bez guardu | trasováno |
| 3 | max 2 retries, decay −0,1 | `ENFORCEMENT_CONFIG` `expertise-enforcement.js:22`; `:182` bere `options.maxRetries ?? …` | **B** | trasováno |
| 4 | 5D capability vektor | `capability-enforcer.js:345 enforceCapabilities()` vrací `violations`, **nehází** | advisory | lokalizováno |
| 5 | QGv2 deterministický, bez LLM | 0 hran `src/chat/quality/**` → `src/llm/**` (graf P6); v kódu jen komentář | platí měřením | trasováno |
| 6 | Patch engine: atomicky, rollback | `patch-engine.js:86-94` tmp + rename; backup store `patch-applier.js` | **A** (částečně) | lokalizováno |
| 7 | Execution loop max 8 iterací | `execution-loop.js:238,453` → `config.lifecycle.maxLoopIterations` → env | **B** | trasováno |
| 8 | Specialista neimportuje `src/**` | `specialist-loader.js:521-531` — čte jen `manifest.entry` | **C** | z P2 |
| 9 | Model upgrade neupgraduje sám | `config.js:30` `onlineDiscovery` default `false`; `_filterRuntimeGuardedCandidates()` | gate, netrasováno do konce | lokalizováno |
| 10 | Legacy listener neopustí loopback | `security/legacy-listener-policy.js` — allowlist `{127.0.0.1}`, `throw`, volané z `runtime-environment.js:23` i z bindu | **A — úplné** | trasováno |
| 11 | Efekt pod uživatelskou authority | approval route bez per-route kontroly; perzistentní audit efektů neexistuje | **D** | z P4 |
| 12 | Žádná tichá outbound | empirická negativní kontrola v okně 75 s (P3); trvalý gate neexistuje | měření, ne vynucení | z P3 |
| 13 | Učení nerozšiřuje authority | — | **D** | bez mechanismu |

---

## 4. Čtyři tvary vynucení

### 4.1 Třída A — jak vypadá vynucení, když existuje

`src/security/legacy-listener-policy.js` je v repozitáři jediný úplný případ a
stojí za to ho pojmenovat jako vzor:

- allowlist je **úzký a odůvodněný** — jediná položka `127.0.0.1`, s komentářem,
  proč tam symbolické hosty nejsou;
- porušení **hází** `Error` s kódem `C3_LEGACY_LISTENER_LOOPBACK_REQUIRED`,
  nevrací varování;
- kontrola i bind jsou **v jedné funkci** (`listenOnLegacyLoopback`), a soubor
  sám říká proč: *„prevents a future check/bind mismatch"*;
- volá se na dvou místech — při normalizaci prostředí (`runtime-environment.js:23`)
  a při startu serveru.

L0-1 je téměř tamtéž: `assertDecision()` hází i na zapomenuté `await`. Rozdíl je
v pokrytí — `assertDecision(` má v `src/**` 4 volání, volání `.decide(` mimo
samotný `cre-decision.js` je 5. Guard je skutečný, jeho aplikace není odvozená
ze systému, ale z toho, že si na něj autor call site vzpomněl.

### 4.2 Třída B — invariant napsaný jako default

Tohle je nález, který jsem nečekal a je systematický:

```js
// src/executor/execution-loop.js:238 a :453
const maxIter = config.lifecycle?.maxLoopIterations || 8;

// src/config.js:161
maxLoopIterations: parseInt(process.env.C3_MAX_LOOP_ITERATIONS || '8'),
```

Invariant L0-7 zní *„max 8 iterací"*. Kód říká *„osm, pokud nikdo neřekl jinak"*.
`C3_MAX_LOOP_ITERATIONS=100` invariant poruší tiše a nic to nezachytí — horní
clamp neexistuje a proměnná není v `.env.example`. Že dnes invariant platí, je
vlastnost konfigurace, ne kódu.

Totéž L0-3:

```js
// src/expertises/expertise-enforcement.js:182
this.#maxRetries = options.maxRetries ?? ENFORCEMENT_CONFIG.maxRetries;   // = 2
```

Kterýkoli volající může poslat vyšší číslo. Prošel jsem `src/**` a **žádný to
dnes nedělá** — invariant tedy platí, ale drží ho absence volajícího, ne kontrola.

Rozdíl proti třídě A je praktický: u L0-10 musí porušení někdo napsat do kódu a
proces spadne. U L0-3 a L0-7 stačí proměnná prostředí nebo jeden parametr a
neupozorní na to nic.

### 4.3 Třída C — guard bez dosahu

L0-8 je popsaný v P2 (`L8-2`) a znovu ho neměřím: guard v
`specialist-loader.js:521-531` čte pouze `manifest.entry`, takže na pěti
balíčcích vypíše nula varování, zatímco porušení v `adapters.js:12` trvá.

Pro tenhle audit je podstatné, že to **není ojedinělá chyba** — je to jeden
konec téhož spektra, na jehož druhém konci je `legacy-listener-policy.js`.
Rozdíl mezi nimi není v pečlivosti autora, ale v tom, že jeden guard kontroluje
přesně to místo, kde se porušení může stát, a druhý kontroluje místo vedle.

### 4.4 Invariant, který platí měřením

L0-5 *„QGv2 je deterministický, žádné LLM volání"*. Graf z P6 dává přímou
odpověď: z `src/chat/quality/**` vede 16 hran, z toho **0** do `src/llm/**`.
Invariant dnes platí a dá se to doložit jedním příkazem.

Vynucení to ale není. V kódu je tvrzení napsané jako komentář
(`quality-pipeline.js:11`: *„All operations are deterministic — no LLM calls"*)
a první `import` gateway ho zruší, aniž by cokoli zčervenalo. Zároveň je to
nejlevnější mezera v celém tomto reportu: tvrzení *„množina hran z `quality/**`
do `llm/**` je prázdná"* je kontrola nad artefaktem, který už existuje.

Neimplementuju ji — nový trvalý mechanismus je podle `CONTRACT.md §12` aparát a
patří do rozhodnutí, ne do sondy.

---

## 5. Švy z P6 — co je vynucuje

| Šev | Deklarace | Vynucení |
|---|---|---|
| route tabulka (17 modulů, 272 endpointů) | `server.js:116-132` + `docs/API-REFERENCE.md` | žádné — duplicitní klíč tiše přebije jiný (P4, `AM-1`) |
| `ctx` pro specialisty | `specialist-loader.js:540` + `docs/SPECIALISTS.md` | `L8-2` — guard bez dosahu |
| barrel `index.js` (11 souborů) | konvence | žádné — poměr průchodů 11 : 97 |
| `.d.ts` (4 soubory) | typová deklarace | žádné — v repozitáři není `tsconfig.json` ani `jsconfig.json` a 0 z 60+ npm skriptů spouští typovou kontrolu |

Čtyři deklarované hranice, jeden vynucovací mechanismus, a ten měří vedle.
Tohle je `EN-6` a je to zároveň odpověď na otázku, proč se nástroje specialisty
mohly zdvojit, aniž si toho něco všimlo.

---

## 6. Co audit nerozhodl

- **neprohlašuje žádný invariant za splněný ani porušený.** Stav je v
  `SYSTEM-MAP.md`; audit se ptá na mechanismus, ne na výsledek;
- **nezavádí žádnou kontrolu.** Tři z nálezů (`EN-3`, `EN-4`, `EN-5`) mají
  levné řešení, ale trvalý mechanismus je podle `CONTRACT.md §12` aparát a
  vyžaduje rozhodnutí operátora;
- **neběžel žádný test.** Viz §1 — harness měl jiného vlastníka. Jakmile bude
  volný, „kdy naposledy zafungoval" se dá pro 178 `offline` suit zjistit jedním
  během;
- **nemění `M6`.** Jen ukazuje, že validační matice třinácti invariantů se dnes
  nemá o co opřít: pole pro důkaz existuje a je prázdné.

---

## 7. Ověření

```bash
# EN-1, EN-2 — registr
node -e "const s=require('./tests/registry.json').suites;
  console.log('suit',s.length,'required',s.filter(x=>x.required).length,
  'lastGreen',s.filter(x=>x.lastGreen&&x.lastGreen.commit).length,
  'BLOCKED',s.filter(x=>x.state==='BLOCKED').length)"     # 357 342 0 81

# kdo zapisuje lastGreen
grep -rn "lastGreen" --include="*.js" scripts/ tests/ src/    # validátor, renderer, fixture — žádný zapisovatel

# EN-3 — mez versus default
grep -n "maxLoopIterations" src/config.js src/executor/execution-loop.js
grep -rn "C3_MAX_LOOP_ITERATIONS" .env.example                # bez výskytu

# EN-4 — přepsatelné retries a nula volajících
grep -n "maxRetries" src/expertises/expertise-enforcement.js
grep -rn "maxRetries:" --include="*.js" src/ | grep -v expertise-enforcement   # prázdné

# EN-5 — QGv2 nevolá model
node -e "const g=require('./docs/review/2026-08-07-MODULE-GRAPH.json');
  const q=g.edges.filter(e=>e.startsWith('src/chat/quality/'));
  console.log(q.length, q.filter(e=>e.includes(' -> src/llm/')).length)"       # 16 0

# třída A jako vzor
grep -n "LOOPBACK_HOSTS\|throw" src/security/legacy-listener-policy.js
```
