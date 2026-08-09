# Paralelní vývoj — pravidla a první pilot

**Stav:** PŘIJATO OPERÁTOREM 2026-08-09. Normativní změny zavádí governance
commit, který tento dokument poprvé trackuje; jeho zdrojovým checkpointem je
`515fb6f7`, evidence parentem `eb7e78b8` a bezprostředním integračním parentem
`2ead4662`.

**Výsledek prvního běhu:** technický boundary ratchet prošel a větev byla
integrována merge commitem `5332d30e0ae90f347838ec3c634c700e565b66cc`.
Autoritativní exact-edge baseline pinuje právě tento merge parent: 1 004 hran,
3 cykly a 28 souborů v cyklech. Ekonomický/procesní pilot je **INVALIDOVANÝ**,
protože v ratchet checkoutu pracovali dva writeři. Z běhu se proto neodvozuje
kladné `T_net`; technický ratchet zůstává platný. Přesná incident evidence je
v [`IMPORT-CENSUS`](2026-08-09-IMPORT-CENSUS.md#pilotní-čas-a-procesní-incident).

Tento dokument nezavádí nový board ani evidence framework. Je to podklad
ke dvěma odděleným rozhodnutím:

1. povolit a změřit první pilot dvou skutečných zapisujících writerů;
2. zavést průběžný, směrově slepý boundary ratchet nad P6 grafem.

Ekonomický neúspěch pilotu smí ukončit režim dvou writerů. Sám o sobě neruší
ratchet, který dál chrání graf před nepozorovaným růstem.

---

## 1. Co se mění a co ne

Nemění se: dependency DAG, connector ownership, GPU serializace, Gate 0 jen
u releasu, strop tří paralelních zapisujících WP.

Mění se dvě formulace:

1. **Vlastnictví má dvě úrovně.** Projektově až tři zapisující WP; v jednom
   checkoutu vždy právě jeden zapisující vlastník. Dosavadní věta „jeden
   worktree znamená jednoho writera" byla správná jako fyzický fakt, ale
   nesprávně se četla jako projektový strop.
2. **Sdílený checkout je vyhrazen prokazatelně filesystem-read-only běhům.**
   Ne jen writerům — i běhům, které jen produkují artefakty.

Druhý bod není opatrnost. `ROADMAP.md` §4 už zaznamenává, že sdílený worktree
vyvolal dirty-tree race a zneplatnil report na jinak shodném SHA. To je
nejsilnější dostupný důkaz a pravidlo se opírá o něj, ne o teorii.

---

## 2. Podoba pilotu

Pilot testuje **právě jednu novou proměnnou: dva skutečné writery.** Connector,
GPU a runtime zůstávají oddělené, aby případné selhání šlo přiřadit.

| | Writer 1 | Writer 2 |
|---|---|---|
| WP | další explicitně rezervovaný **main-checkout WP** | **boundary ratchet** |
| Worktree | hlavní | efemérní, **na disku** |
| `src/**` | ano | **ne** |
| GPU / Ollama / síť | ano, sériově | **ne** |
| `tests/registry.json` | dle potřeby | jen nový záznam |
| Globální dokumenty | ne | ne |

Ratchet vlastní pouze nový checker, fixture, focused test, svou registry položku
a branch-local generovaný ledger. Přesná rezervace je v §2.1. Dokončený
`WP-M1-BINDING-REPOSITORY` (`515fb6f7`, evidence `eb7e78b8`) pouze otevřel
governance bránu; **nepočítá se jako souběžný writer**, protože skončil před
vznikem ratchet větve. Měření pilotu začíná teprve skutečným časovým překryvem
s dalším main-checkout WP, který před prvním zápisem deklaruje své cesty,
connector a integrační pořadí.

Tabulka říká, že globální dokumenty nemění ani jeden writer, zatímco pravidlo
v `CONTRACT.md` je přiděluje integrátorovi. Není to spor, je to role:

> Během překryvu B3 zapisuje jen své vlastněné source/test/report cesty.
> Globální dokumenty jsou zmrazené. Po spojení větví je na merge SHA aktualizuje
> stejný člověk v oddělené roli integrátora.

### Vstupní podmínky před založením druhého worktree

1. **Skutečně čistý `git status`, ne jen čisté tracked cesty.** `git worktree add`
   větví z commitu, takže při špinavém stromu by ratchet měřil strom, který
   necommitnutou práci neobsahuje, a integrátor by regeneroval dokumenty
   rozeditované ve vedlejším stromu. To je táž dirty-tree race, jen posunutá do
   hlavního worktree. Riziko není hypotetické: při psaní tohoto návrhu byly
   rozeditované mimo jiné `ROADMAP.md`, `SYSTEM-MAP.md`, `tests/registry.json`
   a `docs/convergence/TEST-REGISTRY.md` — přesně ty globální plochy, které má
   regenerovat integrátor.

   **Checkpoint k 2026-08-09:** B3 uzavřelo repository v `515fb6f7` a evidenci
   v `eb7e78b8`. Na tomto parentu zůstalo šest governance artefaktů
   (`2026-08-08-MODULE-INDEPENDENCE.md`, tento dokument, doprovodný `.patch`,
   obě zadání WP a index `docs/wp/README.md`). Pokud hlavní writer po
   `eb7e78b8` otevře další práci, musí ji před governance commitem znovu
   checkpointnout; šest governance cest samo o sobě není výjimka z clean-tree
   podmínky. Studio checkpoint tuto podmínku následně splnil v `2ead4662`.
2. **Pilot větví z governance commitu, ne z `eb7e78b8`.** Ratchet branch
   založená dřív by vznikla proti starému `CONTRACT.md`, ve kterém dvouúrovňové
   vlastnictví ani registry výjimka ještě neplatí — větev by tedy pracovala pod
   pravidly, která ji neopravňují existovat.
3. **Kořen efemérních worktrees je na disku**, ne v `/tmp` — ten je zde tmpfs
   (16 GB) a historicky už způsobil paměťový tlak.
4. **Rezervace ratchet WP podle §2.1 je zapsaná** dřív, než větev vznikne.
5. `/tmp/intentsmith-docs-20260807` se **nerecykluje** — patří dokumentační
   větvi s vlastní odloženou integrací.

### 2.1 Rezervace ratchet WP

Rezervace je součástí této specifikace, **ne předčasný záznam v
`tests/registry.json`** — validátor odmítá registrovanou cestu bez existujícího
runnable testu (`scripts/test-registry.js:297`). Registry záznam vloží větev
současně s testem.

| Položka | Hodnota |
|---|---|
| `suite.id` | `IS-T1-TESTS-MODULE-BOUNDARY-RATCHET-TEST` |
| test path | `tests/module-boundary-ratchet.test.js` |
| checker path | `scripts/module-boundary-ratchet.mjs` |
| fixture paths | `tests/fixtures/module-boundary/**` (včetně baseline `from → to` allowlistu) |
| allowed paths | výše uvedené + nový záznam v `tests/registry.json` + branch-local regenerovaný `docs/convergence/TEST-REGISTRY.md` |
| forbidden paths | `src/**`, existující registry záznamy, `schemaVersion`, `exclusions`, `CONTRACT.md`, `ROADMAP.md`, `SYSTEM-MAP.md`, `README.md`, `docs/execution/**` |
| connector | none |
| tier / profile / fixture | `T1` / `offline` / `isolated-home` |
| requirements | `network: none`, `database: false`, `server: false`, `ollama: false`, `gpu: false` |
| `capabilityId` | `C3-027` — přijatý catch-all pro architektonický test bez samostatné produktové capability |
| base SHA | **governance commit** (§8), doplní se při založení větve |

Plné zadání včetně tří fází, negativních testů a stop conditions:
[`WP-M1-BOUNDARY-RATCHET`](../wp/WP-M1-BOUNDARY-RATCHET.md). Směrové pravidlo
`core → optional` v něm **není** — přijatá cestová mapa jádra neexistuje a
checker si ji vymýšlet nesmí; ratchet proto hlídá jen růst grafu.

Checker **nepíše nový scanner** — konzumuje existující
[`2026-08-07-module-graph.mjs`](2026-08-07-module-graph.mjs).
Branch-local `TEST-REGISTRY.md` je nutný pro zelenou branch evidence, ale
integrátor jej na merge SHA zahodí a regeneruje z výsledného registru.

### Integrace

Integrátor sériově: mergne ratchet na B3 checkpoint (merge commit, ne squash),
sjednotí registry záznamy, regeneruje ledger a globální dokumenty, spustí
registry validaci a dotčené boundary testy **na merge SHA**, odstraní worktree,
vyhodnotí kritéria níže.

---

## 3. Ratchet: baseline patří integračnímu SHA

Baseline na ratchet větvi je pouze pracovní důkaz funkčnosti checkeru. **První
autoritativní baseline vzniká až po spojení s B3** — to už
[`2026-08-08-MODULE-INDEPENDENCE.md`](2026-08-08-MODULE-INDEPENDENCE.md) §6.3
bod 3 říká („baseline se připne k integračnímu SHA, ne k rozpracovanému
stromu"). Tento dokument to nemění, jen dopočítává, co z toho plyne pro
vyhodnocení pilotu.

Regrese ratchetu na merge SHA má tři různé významy a jen jeden je selhání:

### 3.1 Očekávaný bootstrap drift

B3 přidalo hrany **pouze** z předem deklarovaných vlastněných cest; každá nová
hrana je vypsaná jako přesná `from → to` dvojice a má odůvodnění v daném WP.
Nevznikl nový SCC/cyklus ani změna cizího connectoru. Ratchet v1 neposuzuje
směr vrstvy, protože přijatá cestová mapa `core / optional` ještě neexistuje.

Integrátor zkontroluje přesný delta seznam, přeměří graf na merge SHA a připne
nový exact `from → to` baseline. Je to očekávaná integrační práce a **započítává
se do `T_cost`**, nikoli do selhání.

### 3.2 Legitimní, ale neschválená architektonická změna

Hrana pochází z B3 cest, ale není v jeho deklarovaném dependency budgetu.
Integrace se **zastaví** a vyžádá explicitní rozšíření WP nebo rozhodnutí.
Není to technické selhání ratchetu — WP nesplnilo admission contract.

### 3.3 Tvrdé selhání pilotu

Ratchet najde hranu mimo vlastněné cesty obou WP, nový cyklus, neohlášenou
změnu connectoru, nebo je navrženo **široké oslabení allowlistu** místo
přesného odůvodnění.

> **Pojistka:** samotné „je to uvnitř B3 cest" nesmí automaticky povolit
> rebaseline. Jinak by každý vlastník obešel ratchet tím, že změní vlastní
> adresář. Allowlist se nikdy neopravuje širokou adresářovou výjimkou, jen
> přesnými `from → to` dvojicemi.

---

## 4. Co smí běžet vedle bez zápisu do zdroje

- izolovaná disabled-boot sonda;
- read-only review a import/connector analýza;
- **lifecycle parity sonda** — s omezeními níže.

### Lifecycle sonda nesmí předrozhodnout R6

R4, R5 a R6 jsou DEFERRED do kroku E a osud `/api/lifecycle/start` rozhodnutý
není. Sonda proto:

- **nezakládá nový fake LLM adaptér** ani nové injection rozhraní — to je
  implementační krok WP-E a jeho provedení by R6 předrozhodlo;
- měří pouze dnešní produkční vstupy a existující gateway;
- při nedostupné Ollamě vykáže pravdivé `BLOCKED` nebo deklarovanou chybu,
  nikdy náhradu fakem.

Sonda navíc není runtime read-only: může založit Git repo, DB data a lifecycle
stav. Běží nad disposable temp projektem, izolovanou DB, unikátním portem a se
zakázanými externími efekty.

Kvůli páté podmínce [`CONTRACT.md` §6](../../CONTRACT.md) nesmí plná parity
sonda využívající Ollamu běžet současně s modelovým během B3. Souběžně lze
dělat pouze statický call-graph trace, negativní cesty končící před LLM a
přípravu izolovaného live scénáře. **Plný live parity běh dostane sériový GPU
slot.**

---

## 5. Tvrdá kritéria neúspěchu

Pilot je neúspěšný při splnění **kteréhokoli** bodu, bez ohledu na ekonomiku:

1. vznikne neohlášený překryv produkčních cest nebo connectoru;
2. objeví se dirty-tree race nebo evidence bez jednoznačného source SHA;
3. ratchet spustí Ollamu/GPU nebo externí síť;
4. merge vyžaduje **změnu chování** jednoho WP, ne jen mechanické sjednocení
   registru;
5. ratchet odhalí hranu podle §3.3;
6. integrátor ztratí registry položku nebo musí ručně rozhodovat mezi dvěma
   různými významy;
7. po dokončení zůstane worktree, proces nebo významný artifact bez vlastníka.

Bod 5 nahrazuje dřívější formulaci „merge-boundary test odhalí neznámou
dependency mezi WP". Ta by označila za selhání i případ §3.1, tedy ratchet
dělající přesně svou práci.

---

## 6. Ekonomické vyhodnocení

Kategorie se určují **předem**, aby se po výsledku nepřesouvaly náklady mezi
košíky. Nejasný náklad se počítá jako opakovaný, dokud druhý běh neprokáže opak.

**`T_once` — jednorázové:** přijetí pravidla paralelismu; vytvoření diskového
kořene pro efemérní worktrees; první definice registry výjimky; implementace
ratchet mechanismu; vytvoření počátečního exact baseline a pilotní metriky.

**`T_recurring` — opakované:** vytvoření a odstranění každého worktree; případný
dependency bootstrap; synchronizace větve; řešení registry konfliktu a
regenerace ledgeru; přeměření a klasifikace graph delta; merge-boundary testy;
cleanup procesů a artefaktů.

```
T_net        = T_saved - T_recurring
payback_runs = ceil(T_once / T_net)     definováno pouze pro T_net > 0
```

Pro `T_net <= 0` je `payback_runs` nedefinované a vykazuje se jako `N/A` —
režim se v takovém případě nezaplatí nikdy a počítat návratnost nemá smysl.

Pilot je ekonomicky přínosný pouze pokud `T_net > 30 minut`, a současně nebyla
potřeba víc než dva integrační průchody a mimo deklarované registry/generated-doc
plochy nevznikl žádný ruční konflikt.

Tím dostáváme dvě oddělené odpovědi: zda každý další paralelní pár skutečně
šetří čas, a po kolika párech se zaplatí zavedení režimu.

### `T_saved` se měří jako zkrácení kritické cesty

Ne jako okno překryvu. Dva agentní writeři se překrývají, ale schvalovací
kapacita je jedna. Když operátor v okně překryvu přepíná kontext mezi dvěma WP,
překryv se do kalendáře nepromítne a vzorec by vykázal kladný `T_net`, přestože
doba do integrace se nezkrátila.

Proto se vedle `T_saved` zaznamená **operátorský čas na každém WP zvlášť**.
Pokud se ukáže, že bottleneck je review a ne psaní, je to nejcennější výstup
pilotu a mění prioritu z „víc writerů" na „levnější schvalování".

---

## 7. Vztah k ostatním dokumentům

- `CONTRACT.md` §6 — normativní pravidla (dvě úrovně vlastnictví, sdílený
  checkout, měřené dokumenty, registry výjimka). Mění governance commit.
- `ROADMAP.md` §12 — provozní shrnutí a odkaz sem. Mění governance commit.
- `ROADMAP.md` §5 — **governance balík se ho nedotýká.** Migrační guard prošel
  jako běžný B3 přírůstek s vlastní evidencí (`684263e3`, atestace `af889e3b`)
  a §5 do doloženého minulého času převedl vlastník B3 v `63e86293`. Vlastnictví
  §5 zůstává u WP-M1-MODEL.
- [`2026-08-07-MODULE-GRAPH.md`](2026-08-07-MODULE-GRAPH.md) §7 — přijetí
  ratchetu uzavírá jeho otevřenou podmínku pro nový průběžný aparát. Citace
  směřuje na skutečný `ROADMAP.md §12`, nikoli na neexistující
  `CONTRACT.md §12`.
- [`016-migration-identity-guard.md`](../decisions/016-migration-identity-guard.md)
  — přijaté rozhodnutí, commitnuté v `684263e3`. Není součástí tohoto balíku.
- [`WP-M1-BOUNDARY-RATCHET`](../wp/WP-M1-BOUNDARY-RATCHET.md) a
  [`WP-M1-BINDING-REPOSITORY`](../wp/WP-M1-BINDING-REPOSITORY.md) — zadání obou
  pilotních WP. Součástí balíku, protože bez nich pilot nemá co spustit.
- [`2026-08-08-MODULE-INDEPENDENCE.md`](2026-08-08-MODULE-INDEPENDENCE.md) §6.3
  a §7 — vlastnictví zápisu a pořadí ratchet / disabled-boot / krok C zůstávají
  beze změny.

---

## 8. Přijetí musí být atomické

Samostatná změna normativních dokumentů by vytvořila neúplný stav:
`ROADMAP.md` by odkazoval na netrackovaný rozhodovací podklad a zadání WP.

Přijetí je proto **jeden commit**, který obsahuje současně:

1. aplikovaný `CONTRACT.md` §6;
2. aplikovaný `ROADMAP.md` §12;
3. [`2026-08-08-MODULE-INDEPENDENCE.md`](2026-08-08-MODULE-INDEPENDENCE.md);
4. tento dokument s operátorským přijetím datovaným bez kruhového odkazu na
   SHA vlastního commitu;
5. [`WP-M1-BOUNDARY-RATCHET`](../wp/WP-M1-BOUNDARY-RATCHET.md),
   [`WP-M1-BINDING-REPOSITORY`](../wp/WP-M1-BINDING-REPOSITORY.md) a doplněný
   index `docs/wp/README.md`;
6. opravu citace P6 a přeměření rozsahu v `SYSTEM-MAP.md` na témže parentu;
7. doplněný index `docs/review/README.md`.

`.patch` se do commitu **nezahrnuje** — po aplikaci je redundantní a jeho
ponechání by vytvořilo druhý zdroj pravdy. Regenerační base je
`2ead4662e00d0b2e39bc03b9b2eb389e07be87e8`; uvnitř jeho historie zůstává
validovaný modelový source checkpoint
`515fb6f7409ea9ca916f88c1785a4ec032c3121b`.

Před commitem se přesně vyjmenované cesty stageují bez `git add -A`, kontroluje
se jejich staged diff a `git diff --check --cached`. Cizí runtime změna nebo
jiný netrackovaný soubor zavře clean-tree bránu i tehdy, když do governance
commitu nevstupuje.

Po tomto commitu je `git status` skutečně čistý: B3-owned cesty jsou commitnuté
do `eb7e78b8`, následný Studio checkpoint do `2ead4662` a governance artefakty
v tomto commitu.

### Post-integration disposition B3 scope odchylky

Integrační review 2026-08-09 potvrdilo, že B3 commity `63e86293` a `515fb6f7`
vedle vlastněného `ROADMAP.md §5` změnily také tehdy zmrazené `SYSTEM-MAP.md` a
ve druhém commitu `README.md`. Obsah odpovídá implementovanému repository
kontraktu, a proto je přijat jako `ACCEPTED_WITH_PROCESS_DEVIATION` bez přepisu
historie. Toto přijetí je jednorázová dispozice dokončeného překryvu, nikoli
uvolnění hard allowlistu pro další WP. Pravdivá technická evidence a přesný
rozsah odchylky jsou v `docs/execution/runs/wp-m1-model-report.md`.

### Ratchet je zároveň odpovědí na otevřený bod P6

`2026-08-07-MODULE-GRAPH.md` §7 říká, že průběžné hlídání driftu je nový aparát
podle provozního pravidla Work Packages a vyžaduje rozhodnutí, ne tichý commit.
Boundary ratchet je přesně ten průběžný aparát. **Přijetím tohoto balíku se
uzavírá i tento bod** — ne odvozeně, ale touto větou. Ratchet zůstává přijatý
i tehdy, kdy ekonomické vyhodnocení nedoporučí další paralelní pilot.

Teprve z governance commitu se zakládají oba pilotní směry:

- hlavní worktree: další explicitně rezervovaný WP s disjunktními cestami a
  connectorem;
- efemérní worktree na disku: [`WP-M1-BOUNDARY-RATCHET`](../wp/WP-M1-BOUNDARY-RATCHET.md).
