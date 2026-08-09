# WP-M1-BOUNDARY-RATCHET — ratchet modulového grafu

**Typ:** zapisující WP · **Slot:** druhý zapisující vlastník, **efemérní worktree na disku**
**Vstupní revision:** governance commit, který toto zadání poprvé trackuje — viz §0
**Adresát:** nová session, writer 2 · integrátor ráno
**Souběžný WP:** [`WP-M1-BINDING-REPOSITORY`](WP-M1-BINDING-REPOSITORY.md) v hlavním checkoutu

Toto je zadání, ne stav. Stav je podle `CONTRACT.md §6` v `ROADMAP.md`.
Procesní rámec a kritéria vyhodnocení: [`2026-08-08-PARALLEL-PILOT.md`](../review/2026-08-08-PARALLEL-PILOT.md).

**Aktualizace po integraci:** původní výsledek je v `5332d30e`; follow-up
hardening začíná `e2dcecd3`. Zachovává pair-based sémantiku, ale deduplikuje
statickou/dynamickou kolizi po normalizaci, rozlišuje exit `1` (drift) a `2`
(nástroj/vstup), přesouvá autoritativní scanner do `scripts/` a přidává
integrátorský baseline writer se schema v2 provenance. Historický datovaný
scanner zůstává kompatibilitním wrapperem.

---

## 0. Vstupní brána — nezačínat dřív

**Nezakládej worktree a nepiš ani řádek, dokud neplatí všechno:**

1. Existuje **governance commit** obsahující `CONTRACT.md §6` a `ROADMAP.md §12`
   v přijatém znění. Jeho SHA je vstupní revision tohoto WP. Větev založená
   dřív by vznikla pod pravidly, která ji neopravňují existovat.
2. `git status` v hlavním checkoutu je čistý.
3. Operátor přidělil `capabilityId` podle §2 (`C3-027`).

Worktree se zakládá **na disku**, ne v `/tmp` — ten je na tomto stroji tmpfs.
`/tmp/intentsmith-docs-20260807` se nerecykluje, patří dokumentační větvi.

```bash
git worktree add ~/worktrees/is-boundary-ratchet -b wp/m1-boundary-ratchet <governance-sha>
```

---

## 1. Uživatelský výsledek

Zavlečení nové P6-viditelné importní hrany mezi soubory `src/**` přestane být
neviditelné. Po tomto WP existuje spustitelný checker, který na libovolném SHA
řekne, jestli modulový graf oproti připnutému baseline **narostl**, a pokud ano,
vypíše přesné `from → to` dvojice, které přibyly.

Ratchet **nerozhoduje** o architektuře a nic nepřepisuje. Je to měřidlo
s prahem.

## 2. Vlastněné a zakázané cesty

| | |
|---|---|
| **Vlastněné** | `scripts/module-boundary-ratchet.mjs` · `scripts/module-graph.mjs` · kompatibilitní `docs/review/2026-08-07-module-graph.mjs` · `tests/module-boundary-ratchet.test.js` · `tests/fixtures/module-boundary/**` |
| **Registry** | pouze **přidání** jednoho záznamu do `tests/registry.json` |
| **Generovaný** | branch-local `docs/convergence/TEST-REGISTRY.md` (integrátor ho na merge SHA zahodí a regeneruje) |
| **Výstup sond** | `docs/review/2026-08-09-LIFECYCLE-PARITY.md`, `docs/review/2026-08-09-IMPORT-CENSUS.md` |
| **Zakázané** | `src/**` · existující záznamy, `schemaVersion` a `exclusions` v registry · `CONTRACT.md` · `ROADMAP.md` · `SYSTEM-MAP.md` · `README.md` · `docs/execution/**` · `docs/decisions/**`; změnu přijatého pilotního dokumentu smí provést jen operátorem výslovně schválený integrační follow-up |

**Rezervace registry záznamu** (zapiš současně s testem, ne dřív — validátor
odmítá registrovanou cestu bez existujícího runnable programu):

```
id:          IS-T1-TESTS-MODULE-BOUNDARY-RATCHET-TEST
path:        tests/module-boundary-ratchet.test.js
argv:        ["node", "tests/module-boundary-ratchet.test.js"]
tier:        T1
fixture:     isolated-home
profile:     offline
timeoutMs:   120000
expectedDurationMs: 30000
requirements: network=none, database=false, server=false, ollama=false, gpu=false
required:    true
owner:       parallel pilot writer 2
state:       ACTIVE
capabilityId: C3-027
```

## 3. Connector

**Žádný.** Tento WP nemění ani nekonzumuje veřejný connector. Nulový překryv
s `WP-M1-BINDING-REPOSITORY`, který vlastní `ModelRequest/Result` v1.

## 4. Závislosti

Governance commit (§0). Nic jiného. Nečeká na GPU, síť ani na dokončení
souběžného WP.

## 5. Co je změřeno — nepřeměřovat

Autoritativní nástroj je `scripts/module-graph.mjs`; jde o relokovaný původní P6
scanner, ne druhou implementaci parseru. Je read-only vůči produktu: čte strom
a zapisuje jediný soubor, který dostane přes `--out`. Datovaný původní vstup
jen importuje tentýž soubor kvůli reprodukci starší evidence.

```bash
node scripts/module-graph.mjs . --out /tmp/graph.json
```

Vypíše `counts` na stdout a setříděný JSON do `--out`. Naměřeno na
pracovním stromu 2026-08-08:

| | |
|---|---|
| `srcFiles` | 416 |
| `internalEdges` | 1004 (static 808, dynamic 196) |
| `typeOnlyEdges` | 13 |
| `unresolvedSpecifiers` | 0 |
| `cycles` | **3** |
| `filesInCycles` | 28 |
| `unreachable` | 65 souborů, 23 493 LOC |

Pole `edges` je záměrně setříděné pole řetězců, takže `git diff` nad ním ukazuje
drift grafu, ne pořadí. Klíče výstupu: `meta`, `counts`, `fanIn`, `unreachable`,
`cycles`, `barrels`, `edges`.

Protocol 1 **nevidí** `import()` s vypočítanou cestou (10 míst), obsah template
literálů v `src/domains/scaffolds/**`, `<script src>` v HTML ani `.ts/.d.ts`.
Statickou a dynamickou syntaxi hlásí odděleně, ale ratchet ji záměrně
normalizuje na vlastnictví jedné `from → to` dvojice. Checker omezení čte ze
strukturovaného `graph.meta.limitations`; baseline proto už nepinuje byteově
shodnou větu.

## 6. Postup — tři fáze, sekvenčně v jednom checkoutu

### Fáze A — ratchet (jádro WP)

`scripts/module-boundary-ratchet.mjs`:

1. spustí měřidlo jako podproces do dočasného souboru a načte JSON —
   **neduplikuje jeho logiku**;
2. porovná `edges` proti připnutému baseline
   `tests/fixtures/module-boundary/baseline.json`;
3. **selže nenulovým exitem**, když:
   - přibyla hrana, která v baseline není,
   - přibyl cyklus nad připnuté 3 nebo se zvětšil `filesInCycles`;
4. **projde a nahlásí**, když hrana zmizela — ratchet smí jen utahovat; uvolnění
   baseline je vždy rozhodnutí integrátora, ne důsledek běhu;
5. vypíše delta jako přesné `from → to` dvojice.

**Tvrdá vlastnost:** baseline nesmí umět adresářovou výjimku ani glob. Přijímá
výhradně přesné dvojice. Checker musí glob v baseline **odmítnout jako neplatný
formát** — jinak by šel ratchet obejít jedním řádkem.

Původní branch baseline byl provizorní; první autoritativní stav připnul
integrátor v `5332d30e`. Schema v2 nyní vedle exact hran pinuje zdrojový commit,
jeho Git tree `src/**` a blob scanneru. Není self-referenční: následný commit,
který obsahuje jen vygenerovaný baseline, je potomkem připnutého zdroje.

Regenerace není ruční editace JSONu. Na čistém Git stromu ji provádí pouze
explicitní `--write-baseline`; syntetický `--graph` odmítne. Přidané hrany se
nejprve jen vypíšou a zapisující průchod vyžaduje přesnou opakovanou volbu
`--accept-edge`. Růst cyklu writer nepřijme vůbec.

#### Ratchet je záměrně směrově slepý

Původní zadání mělo třetí selhací podmínku „zakázaná směrová hrana `core →
optional`". **Vypadla, protože ji nelze implementovat bez nepřijatého
rozhodnutí.** Ověřeno 2026-08-09:

- `R1` v [`2026-08-08-MODULE-INDEPENDENCE.md`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §6.1
  definuje jádro **doménově** — tabulka jmenuje `ExtensionManifest`,
  `PromptContribution`, auto-selection, store, wizard. Nejsou to cesty a tentýž
  dokument říká, že „není to přesun jednoho souboru" a patří to do
  `WP-M3-BOUNDARY`;
- `classify()` v měřidle (řádek 250) klasifikuje **dosažitelnost**
  (`browser-asset`, `bez-konzumenta`, `jen-testy`, `externi-vstup`), ne
  architektonickou vrstvu;
- P6 report §7 výslovně říká, že sonda **neurčuje, které švy dostanou
  kontrakt** — výběr je operátorský.

Odvodit mapu z jediné cestové věty „expertises jsou odpojitelný modul" by
znamenalo, že si checker architektonickou klasifikaci vymyslí, a předrozhodlo
by to `R3` i otevřené `L0-8`.

**Ratchet proto hlídá jen růst grafu, ne směr.** V rozsahu importů, které
měřidlo P6 umí rozpoznat, je to úplná záruka proti nepozorovanému růstu: nová
hrana neprojde bez povšimnutí bez ohledu na to, kudy vede. Směrové pravidlo se
přidá až nad přijatou cestovou mapou jádra — je to rozšíření tohoto checkeru,
ne jeho přepis. Zapiš tu chybějící mapu jako nález pro `WP-M3-BOUNDARY`;
**neřeš ji v tomto WP.**

### Fáze B — lifecycle parity sonda

Read-only vůči produkčnímu `src/**`. **Nezakládá fake LLM adaptér ani nové
injection rozhraní** — R6 je
`DEFERRED` do kroku E a sonda, která adaptér postaví, ho předrozhodne.

Zmapuj statický call graph čtyř ploch a rozdíly mezi nimi:
`src/planner/lifecycle.js` (DB singleton), `src/chat/handlers/lifecycle-router.js`,
`src/routes/expertises.js` (`POST /api/lifecycle/start`),
`src/routes/projects.js` (`POST /api/projects/lifecycle/start`).

Povolené jsou statický trace a negativní cesty, které končí **před** voláním
LLM. Live parity běh s Ollamou **ne** — GPU je sériové a drží ho souběžný WP.
Nedostupná Ollama se vykazuje jako pravdivé `BLOCKED`, nikdy jako fake.

Výstup: `docs/review/2026-08-09-LIFECYCLE-PARITY.md`.

### Fáze C — import/connector census (výplň)

Read-only inventura importů přes hranice modulů, jako podklad pro budoucí
`WP-M3-BOUNDARY`. Výstup: `docs/review/2026-08-09-IMPORT-CENSUS.md`.

Fáze C je výplň. Když dojde čas, neodevzdává se rozpracovaná — buď je hotová,
nebo v commitu není.

## 7. Demonstrace

`node scripts/module-boundary-ratchet.mjs` na čistém stromu projde s exit 0.
Syntetická fixture s jednou přidanou hranou selže a vypíše přesně tu jednu
dvojici. Demonstrace **nikdy nemění ani dočasně `src/**`**; stejný porovnávací
kód používá checker nad skutečným P6 výstupem i test nad fixture.

## 8. Testy

**Pozitivní:** aktuální strom projde; delta je prázdná.

**Negativní** — grafové delta případy používají syntetickou fixture; writer a
provenance případy izolovaný dočasný Git repozitář, nikdy skutečné `src/**`:

1. přidaná hrana → nenulový exit, přesná dvojice ve výpisu;
2. nový cyklus → nenulový exit;
3. odebraná hrana → exit 0 + hlášení „baseline lze utáhnout";
4. glob nebo adresářová výjimka v baseline → odmítnuto jako neplatný formát;
5. poškozený/chybějící baseline → fail-closed, ne tiché prázdné porovnání.
6. statická+dynamická forma stejné rozřešené dvojice → jedna normalizovaná
   hrana; nová dvojice se vypíše právě jednou;
7. schema v2 → revision/tree/scanner provenance se v Git checkoutu znovu
   ověří a připnutý tree musí reprodukovat přesný graf; chybějící/cizí commit
   nebo ručně přidaná hrana se starým source tree skončí exit `2`;
8. writer → migrace v1→v2, odmítnutí neodsouhlasené hrany bez zápisu a zápis
   až po přesné `--accept-edge`;
9. změna worktree nebo HEAD během scan okna → exit `2`, baseline byteově beze
   změny.

Směrový test v seznamu **není** a nemá se doplňovat — důvod je v §6, fáze A.

## 9. Stop condition

Zastav dotčenou část a zapiš to, když:

- ratchet by k průchodu potřeboval změnu v `src/**`;
- baseline by šlo srovnat jen adresářovou výjimkou;
- práce by vyžadovala rozhodnout, které soubory patří do jádra a které do
  odpojitelného modulu — ta mapa přijatá není a nevzniká tady;
- objeví se hrana mezi cestami, které nevlastní ani jeden ze dvou WP;
- fáze B by potřebovala fake adaptér, Ollamu nebo GPU;
- registry validátor hlásí konflikt na cizím záznamu.

Nezávislé části pokračují. **Nic z toho neřeš sám** — je to vstup pro ranní
integraci.

## 10. Ověřovací příkazy

```bash
node scripts/module-boundary-ratchet.mjs
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js
git diff --check
```

Všechny čtyři musí skončit exit 0 a **žádný nesmí sáhnout na síť, Ollamu ani GPU.**

Integrátorský rebaseline po schváleném delta:

```bash
# 1. pouze review; při ADDED nic nezapíše
node scripts/module-boundary-ratchet.mjs --write-baseline

# 2. až po review, jedna volba pro každou a pouze přijatou dvojici
node scripts/module-boundary-ratchet.mjs --write-baseline \
  --accept-edge "src/from.js -> src/to.js"
```

CLI vypisuje exit contract přes `node scripts/module-boundary-ratchet.mjs --help`.

## 11. Co se přes noc NESMÍ stát

- **Žádný merge do B3.** Integrace je ranní a sériová; rozlišení bootstrap
  driftu od neschválené změny od tvrdého selhání je rozhodnutí, ne krok skriptu.
- **Žádný rebaseline** s odůvodněním „je to uvnitř cizích cest".
- **Žádný zápis do `src/**`**, ani dočasný, který by zůstal v diffu.
- **Žádná úprava tří zmrazených pilotních dokumentů** v `docs/review/2026-08-08-*`.
- **Žádný squash**, pokud se přesto commituje víc kroků — evidence potřebuje DAG.

## 12. Výstup

Commity na `wp/m1-boundary-ratchet` s branch-local evidence: focused pozitivní
a negativní běh, přesný source SHA. Worktree zůstává stát do ranní integrace,
potom ho odstraní integrátor a ověří `git worktree list`.

Zaznamenej průběžně: čas startu, čas dokončení každé fáze, každou minutu, kterou
sis vyžádal od operátora. Slouží to k `T_recurring` a k oddělenému měření
operátorské pozornosti podle pilotního dokumentu §6.
