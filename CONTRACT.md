# IntentSmith — pravidla vývoje

**Verze:** 2 · **Datum:** 2026-08-03 · **Vlastník:** operátor

> Tento dokument je **jediný zdroj pravdy pro pravidla vývoje**. Kde si jakýkoli
> jiný dokument v repozitáři odporuje s tímto, platí tento.
>
> Produktový cíl určuje [`PRODUCT.md`](PRODUCT.md), evoluční rozhodnutí
> [`DIRECTION.md`](DIRECTION.md), pořadí [`ROADMAP.md`](ROADMAP.md) a změřený
> stav [`SYSTEM-MAP.md`](SYSTEM-MAP.md). `AGENTS.md` a `CLAUDE.md` jsou pouze
> vstupní ukazatele; `docs/convergence/*` je historická/release evidence.

---

## 1. Východisko — evoluce funkčního produktu

C3 je funkční produkt, nikoliv greenfield baseline. IntentSmith jej evolučně
zpřesňuje, zpevňuje a doplňuje. Funkční části se zachovávají, dokud měření nebo
uživatelský scénář neprokáže konkrétní přínos opravy či náhrady. Historický
rozbor a čísla jsou v `DIRECTION.md`. Dynamická měření a průběžné statusy patří
do `SYSTEM-MAP.md`; tento kontrakt může uchovat jen řídicí rozhodnutí nebo
pojmenovaný blocker, který mění způsob práce.

Z toho plynou čtyři pravidla:

1. nejprve pozorovat produkt a skutečný call graph, teprve potom měnit;
2. nepřepisovat fungující část jen proto, že existuje novější knihovna;
3. náhrada musí prokázat přidanou funkci, kvalitu, bezpečnost nebo nižší cenu;
4. objem testů, dokumentů ani commitů není důkaz výsledku.

---

## 2. Vrstvy

Ne fáze. Fáze se projdou a zapomenou; tohle platí trvale a běží souběžně.

| | Vrstva | Co to je |
|---|---|---|
| **L0** | Release invarianty a vývojové rails | Co musí platit pro release a co žádná změna nesmí dále oslabit. Otevřené zděděné porušení se přizná a opraví před releasem. |
| **L1** | Zelená linie | Scénáře, které musí fungovat vždy. Běží při každé změně. Roste o jeden scénář za každou dokončenou schopnost. Cíl je běh v řádu vteřin — zatím **neověřeno**, dnešní deterministická sada běží minuty. |
| **L2** | Schopnosti | Vertikální user journeys v ohraničených WP; nezávislé WP mohou podle DAG běžet paralelně. |
| **L3** | Kvalita jako číslo | p95 latence, chybovost, přesnost intentů, počet regresí. Měřeno průběžně. |
| **L4** | Evoluce | Výměny a upgrady. Sahá se jen na to, co je za stabilním rozhraním z L0. |

### L0 — invarianty

Prvních deset je zděděný technický kontrakt. Poslední tři jsou produktová
autorita. Invariant může být `VERIFIED`, `UNVERIFIED`, `PARTIAL` nebo
`OPEN_VIOLATION`; pouze první stav znamená prokázané splnění. Aktuální stav je
výhradně v `SYSTEM-MAP.md`, ne v tomto kontraktu. Žádná změna nesmí otevřené
porušení rozšířit nebo vydat za zelené a M6 vyžaduje všech třináct bez
otevřeného porušení.

1. CRE je jediná autorita — žádná zpráva ji neobejde.
2. `mergeExpertisePrompt()` je čistá funkce — žádné side effects.
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1/pokus.
4. 5D capability vector je `{reasoning, creativity, determinism, riskTolerance, verbosity}` 0–100.
5. QGv2 je deterministický a idempotentní — žádné LLM volání, žádné nové věty.
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback při selhání.
7. Execution loop: max 8 iterací.
8. Specialista je soběstačný — žádný `import ../../src/` z balíčku, vše přes
   schválenou registrační hranici.
9. Model upgrade nikdy neupgraduje sám — discovery nemění konfiguraci.
10. Legacy listener nikdy neopustí loopback, dokud neexistuje oddělená ověřená hranice.
11. Každý významný externí nebo stav měnící efekt zůstává pod autoritou
    uživatele: má původ, omezený rozsah, odpovídající approval a auditní stopu.
12. Žádná tichá odchozí komunikace: background síť je opt-in; explicitní
    síťové schopnosti jsou mediované a auditované.
13. Učení samo nesmí rozšířit oprávnění, změnit kód nebo konfiguraci ani
    přenést projektová data přes hranici bez explicitního opt-inu.

---

## 3. Postup u schopnosti — hloubka až po důkazu

Proces nemá před implementací vyrobit stovky papírových záznamů. Pracuje ve
dvou hloubkách.

### Lehký obraz celého produktu

Pro každou ze 22 schopností stačí:

1. jedna věta „co uživatel udělá a co se stane";
2. nejvyšší dosažený stupeň důkazu podle §5;
3. případný příznak `BROKEN` a odkaz na pozorování.

Tím vznikne společný obraz a dependency DAG, nikoliv předstíraná detailní
znalost. Sedmidimenzionální inventura ani cílový redesign se pro schopnost,
která nebyla skutečně spuštěná, nevymýšlí.

### Hluboká práce ve schváleném Work Package

Schopnost se rozpracuje do hloubky teprve tehdy, když je na řadě podle DAG a
existuje runtime pozorování. Pak následuje:

1. **Spuštění a měření.** Nejdřív uživatelský scénář, prerekvizity, latence,
   data a efekty. Čtení kódu samo nestačí.
2. **Hluboká inventura.** Moduly, funkce, principy, konektory, data, efekty,
   hranice a případná učící smyčka. Výstup: zachovat / zlepšit / nahradit či
   vyřadit / rozhodnout.
3. **Schválené chování.** Operátor schválí pozorovatelné věty a případná
   rozhodnutí o scope před implementací.
4. **Malý vertikální přírůstek.** Implementace, focused pozitivní i negativní
   test a uživatelsky viditelná demonstrace nebo L3 číslo.
5. **Akceptace.** Důkaz z čerstvého klonu na pojmenovaném commitu a aktualizace
   mapy schopností.

Schopnosti na různých větvích mohou postupovat souběžně podle §6. Uvnitř jedné
schopnosti se uvedené pořadí nepřeskakuje.

---

## 4. Pravidlo chování

> Chování je krátká věta o tom, co musí platit **na hranici, kde to zažívá
> uživatel**. Modulový test je doplněk; není náhradou za request, UI nebo jiný
> skutečný vstup do produktu.

- seznam se tvoří až ze spuštěné reality a schvaluje jej operátor;
- každé schválené chování má pojmenovaný důkaz, který při rozbití zčervená;
- existující testy se nejdřív mapují, nepřepisují automaticky;
- chyba nalezená za provozu přidá regresní chování;
- preventivní bezpečnostní, recovery a datové chování smí vzniknout z threat
  modelu, i když k incidentu ještě nedošlo;
- test bez vazby na chování se nepočítá jako důkaz schopnosti;
- zlepšit / nahradit / vyřadit se plánuje až pro `RUNTIME_VERIFIED` schopnost.

Dobré:

> „Na `kolik je hodin?` přijde odpověď s aktuálním časem, bez volání modelu,
> do 100 ms přes skutečný chat request."

Špatné:

> „`decide()` volá `classifyDeterministic()` před LLM."

---

## 5. Stav schopnosti a výsledek běhu

Tyto dvě osy se nesmějí míchat.

### Žebřík ověření schopnosti

| Stav | Co je skutečně prokázáno |
|---|---|
| `EXISTS` | Kód a vstupní bod byly nalezeny; existuje jedna věta uživatelského chování. |
| `RUNTIME_VERIFIED` | Schopnost byla s reálnými prerekvizitami spuštěna a pozorována. |
| `USER_JOURNEY_VERIFIED` | Skutečný uživatelský scénář včetně relevantní negativní cesty prošel. |
| `ACCEPTED` / `PASS` | Všechna schválená chování prošla z čerstvého klonu na pojmenovaném commitu a operátor je přijal. |

`BROKEN` je samostatný příznak, ne pátá příčka. `DORMANT`, `DEAD`, `RETAIN`,
`IMPROVE`, `REPLACE`, `RETIRE` a `DEFER` jsou disposition, nikoliv důkaz.

### Výsledek konkrétního testu nebo běhu

- **PASS** — ověřované tvrzení v daném prostředí prošlo.
- **FAIL** — tvrzení neplatí; nesnižuje se na „většinou funguje".
- **BLOCKED** — běh narazil na konkrétní deklarovanou prerekvizitu; není zelený.
- **NOT RUN / NAPSÁNO** — běh neproběhl; je slabší než `BLOCKED` a není důkaz.

Prerekvizity se deklarují. Registry metadata jsou ale pouze deklarace: u
offline, bezpečnostních a efektových claimů se podle rizika přidává empirická
izolace nebo negativní kontrola.

---

## 6. Závislosti, Work Packages a paralelní práce

Pořadí neurčuje lineární seznam, ale dependency DAG v `ROADMAP.md`. Sériová je
integrační páteř a změna jednoho connectoru; nezávislé větve se smějí řešit
paralelně.

### Work Package je jednotka zapisující práce

Každý WP má pouze:

- uživatelský výsledek a rozsah;
- vlastněné cesty a connector;
- vstupní revision a závislosti;
- demonstraci, pozitivní a negativní test;
- stop condition a přesný ověřovací příkaz.

Další board, registr ani evidence framework se pro běžný WP nezakládá. Stav se
udržuje v roadmapě a příslušné inventuře.

### Kdy může práce běžet souběžně

Paralelní zapisující WP jsou povolené, pouze když:

1. nemají nevyřešenou dependency edge;
2. mají disjunktní zapisované cesty;
3. nemění tentýž connector ani jeho sémantiku;
4. mají jasný způsob předání a integrační pořadí;
5. modelové/GPU běhy se na jedné RTX 3090 spouštějí sériově;
6. každý má vlastní branch a vlastní checkout.

Connector mění jediný vlastník. Konzumenti pracují proti připnuté verzi a po
změně musí znovu projít boundary testy. Doporučený strop jsou tři paralelní
zapisující WP; read-only průzkum může běžet vedle nich.

#### Vlastnictví má dvě úrovně

Vlastnictví se určuje zvlášť pro projekt a zvlášť pro checkout:

- **Projekt:** nejvýše tři zapisující WP, každý s explicitně přidělenými
  cestami a connectorem;
- **Checkout:** právě jeden zapisující vlastník v jednom worktree, vždy.

Dvě větve v jednom checkoutu nejsou paralelní práce, jen střídání v čase.
Skutečně souběžný WP je ta výslovná potřeba, která opravňuje vznik dalšího
worktree. Ten je efemérní: vzniká po explicitním schválení, žije jen po dobu
svého WP a po integraci se odstraní.

#### Standardní branch, review a merge queue

Paralelní práce používá běžný Git model, nikoli sdílený checkout:

1. Integrátor vlastní čistou canonical `integration/<batch>` branch a její
   worktree. Přesný ref je pojmenovaný v aktivním batch/roadmap záznamu; nikdy
   se neodvozuje implicitně z právě otevřeného checkoutu. Feature kód se v
   tomto checkoutu přímo nepíše.
2. Každý WP větví z aktuálního přijatého integration SHA do vlastní branch a
   vlastního disk-backed worktree. `sourceEvidenceRevision` označuje historický
   strom, nad kterým vznikla analýza; `baseRevision` je skutečný integrační SHA,
   z něhož se větví. Tyto hodnoty se nesmějí zaměnit.
3. Writer vytvoří čistý immutable **subject commit `S`** s implementací a
   focused pozitivním i negativním důkazem. Statický WP ani unikátní run report
   v `S` nepředstírá vlastní SHA. Nezávislý Review A ověří `S` proti exact base,
   allowlistu, connectoru, dependencies a registry rezervacím. Změna `S`
   review ruší.
4. Po Review A vznikne přímý **report-only evidence commit `E_A`**, který do
   unikátního run reportu zapíše pojmenovaný integration ref, `baseRevision`,
   exact `subjectHead=S` a výsledek Review A. `E_A` nezapisuje vlastní SHA;
   jeho jediný parent `S` a jediná změněná cesta — report — jsou strojový důkaz
   obálky. Samostatný metadata gate ověří tuto vazbu a není rekurzivně
   zapisován do obálky, kterou právě kontroluje.
5. `E_A` kandidáti vstupují **po jednom** do merge queue. Integrátor je přes
   `--no-ff` spojí s aktuálním integration tipem v dočasné queue branchi,
   mechanicky sjednotí povolené registry adice a regeneruje globální
   ledger/evidence. Výsledkem je immutable runtime **candidate `C`**. Semantic
   conflict se neřeší změnou chování v queue; vrací WP jako
   `CHANGES_REQUIRED`. Gate musí explicitně prokázat
   `git merge-base --is-ancestor E_A C`; stejné textové stromy z nesouvisejících
   historií nejsou evidence DAG.
6. Review B a integrační testy běží na přesném `C`. Po PASS vznikne přímý
   **report-only evidence commit `E_B`**, který zapíše `candidateHead=C` a
   výsledek Review B. `E_B` opět nezapisuje vlastní SHA; musí mít jediného
   parenta `C`, měnit pouze stejný run report a zachovat runtime/source tree.
   Až samostatný metadata gate ověří `E_B`, canonical integration branch se
   fast-forwardne na `E_B`. Další kandidát se skládá proti tomuto tipu.
7. Feature/worktree se odstraní až po důkazu, že přijatý `E_B` je dosažitelný z
   integration branche, evidence je zapsaná a neběží vlastněný proces.
   Neprokázané vlastnictví je `UNKNOWN`, ne oprávnění k úklidu.

Normativní gate obou report-only obálek je stejný; volající dosadí plné SHA a
jedinou report path. Každý víceřádkový shell gate v §8 začíná
`set -euo pipefail`; očekávaný nenulový exit zachytí explicitní `if`, ověří jeho
přesnou hodnotu i signaturu a teprve potom pokračuje. Pozdější zelený příkaz
nesmí maskovat dřívější selhání. Path allowlist i report-only obálka používají
`git diff --no-renames --name-only`; rename se pro autoritu vždy počítá jako
odstraněná původní a přidaná cílová cesta:

```bash
set -euo pipefail

verify_report_key() {
  local IS_REPORT_HEAD="$1"
  local IS_REPORT_PATH="$2"
  local IS_REPORT_KEY="$3"
  local IS_REPORT_EXPECTED="$4"
  test "$(git show "$IS_REPORT_HEAD:$IS_REPORT_PATH" | awk -v prefix="$IS_REPORT_KEY:" 'index($0, prefix) == 1 { n++ } END { print n + 0 }')" -eq 1 || return 1
  test "$(git show "$IS_REPORT_HEAD:$IS_REPORT_PATH" | rg -Fxc "$IS_REPORT_KEY: $IS_REPORT_EXPECTED")" -eq 1 || return 1
}

assert_report_absent() {
  local IS_REPORT_ENTRY
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  test -z "$IS_REPORT_ENTRY"
}

assert_report_blob() {
  local IS_REPORT_ENTRY IS_REPORT_MODE_TYPE
  IS_REPORT_ENTRY=$(git ls-tree "$1" -- "$2") || return 1
  IS_REPORT_MODE_TYPE=$(awk 'NF { n++; mode=$1; type=$2 } END { print n ":" mode ":" type }' <<<"$IS_REPORT_ENTRY") || return 1
  test "$IS_REPORT_MODE_TYPE" = '1:100644:blob'
}

assert_report_same() {
  local IS_LEFT_REPORT_BLOB IS_RIGHT_REPORT_BLOB
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  IS_LEFT_REPORT_BLOB=$(git rev-parse "$1:$3") || return 1
  IS_RIGHT_REPORT_BLOB=$(git rev-parse "$2:$3") || return 1
  test "$IS_LEFT_REPORT_BLOB" = "$IS_RIGHT_REPORT_BLOB"
}

assert_report_append() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    const expected = Buffer.concat([before, Buffer.from(`${lines.join("\n")}\n`)]);
    if (!expected.equals(after)) process.exit(1);
  ' "$@"
}

assert_report_extension() {
  assert_report_blob "$1" "$3" || return 1
  assert_report_blob "$2" "$3" || return 1
  node -e '
    const { execFileSync } = require("node:child_process");
    const [parent, head, path, ...lines] = process.argv.slice(1);
    const before = execFileSync("git", ["show", `${parent}:${path}`]);
    const after = execFileSync("git", ["show", `${head}:${path}`]);
    const suffix = Buffer.from(`${lines.join("\n")}\n`);
    if (before.length === 0 || before[before.length - 1] !== 10) process.exit(1);
    if (after.length <= before.length + suffix.length || after[after.length - 1] !== 10) process.exit(1);
    if (!after.subarray(0, before.length).equals(before)) process.exit(1);
    if (!after.subarray(after.length - suffix.length).equals(suffix)) process.exit(1);
    const payload = after.subarray(before.length, after.length - suffix.length);
    const payloadText = payload.toString("utf8");
    if (payload[payload.length - 1] !== 10 || !/[^\s]/u.test(payloadText)) process.exit(1);
    if (/(^|\n)[ \t]*phase[AB]\./u.test(payloadText)) process.exit(1);
  ' "$@"
}

verify_report_envelope() {
  local IS_ENVELOPE_PARENT="$1"
  local IS_ENVELOPE_HEAD="$2"
  local IS_ENVELOPE_REPORT="$3"
  local IS_ENVELOPE_PIN_KEY="$4"
  local IS_ENVELOPE_VERDICT_KEY="$5"
  test "$(git rev-list --parents -n 1 "$IS_ENVELOPE_HEAD" | wc -w)" -eq 2 || return 1
  test "$(git rev-parse "$IS_ENVELOPE_HEAD^")" = "$IS_ENVELOPE_PARENT" || return 1
  test "$(git diff --no-renames --name-only "$IS_ENVELOPE_PARENT" "$IS_ENVELOPE_HEAD")" = "$IS_ENVELOPE_REPORT" || return 1
  assert_report_blob "$IS_ENVELOPE_HEAD" "$IS_ENVELOPE_REPORT" || return 1
  git diff --check "$IS_ENVELOPE_PARENT" "$IS_ENVELOPE_HEAD" || return 1
  verify_report_key "$IS_ENVELOPE_HEAD" "$IS_ENVELOPE_REPORT" "$IS_ENVELOPE_PIN_KEY" "$IS_ENVELOPE_PARENT" || return 1
  verify_report_key "$IS_ENVELOPE_HEAD" "$IS_ENVELOPE_REPORT" "$IS_ENVELOPE_VERDICT_KEY" PASS || return 1
}
```

Mezi voláním pro `E_A` a `E_B` je vždy povinné:

```bash
assert_report_absent <full-S-sha> <report-path>
assert_report_same <full-E_A-sha> <full-C-sha> <report-path>
git merge-base --is-ancestor <full-E_A-sha> <full-C-sha>
assert_report_append <full-C-sha> <full-E_B-sha> <report-path> \
  'candidateHead: <full-C-sha>' 'reviewB.verdict: PASS'
```

Jednofázový report používá exact jednořádkové klíče `integrationRef`,
`baseRevision`, `subjectHead`, `reviewA.verdict`, `candidateHead` a
`reviewB.verdict`. Dvoufázový report je prefixuje `phaseA.` nebo `phaseB.`.
Každý explicitní §8 gate zavolá `verify_report_key` nebo jeho ekvivalent pro
**každý** normativní klíč: na `E_A` pro všechny dosud povolené klíče a na
`E_B` znovu i pro všechny zachované klíče. Volný prose claim, odlišná hodnota,
jiné formátování nebo duplicitní pole proto neprojde.

Každý čtený report tree entry musí být právě jeden běžný `100644 blob`; symlink,
submodule nebo chybějící entry je chyba. Report na `C` musí mít stejný blob jako
na `E_A`. `E_B` smí k tomuto blobu pouze bajtově přesně připojit dva uvedené
metadata řádky. U dvoufázového reportu Phase B subject zachová celý přijatý
Phase A report jako byte prefix, připojí neprázdný měřený payload a zakončí jej
přesným provenance suffixem. Review A tím váže celý měřený
payload, ne pouze jeho klíče. Payload nesmí obsahovat žádný line-start v
rezervovaném namespace `phaseA.` ani `phaseB.`; tyto řádky vlastní pouze exact
provenance suffix a evidence obálky. Phase B `E_A` pak smí připojit pouze řádky
`subjectHead` a `reviewA.verdict`, `C` report zachová a Phase B `E_B` připojí
pouze `candidateHead` a `reviewB.verdict`. Každá fáze ověřuje newline na konci
rodičovského reportu; volné přepsání jiného prose nebo výsledku je
`CHANGES_REQUIRED` i tehdy, když exact klíče stále sedí.

Toto rozdělení je záměrné: commit nemůže bez nekonečné self-reference obsahovat
vlastní SHA ani review svého vlastního obsahu. Report proto pinuje reviewnuté
rodiče `S` a `C`; mechanická obálka je dokázaná Git parentem a exact path gate.

#### Jednorázová recovery výjimka pro chats evidence obálku 2026-08-12

Operátor přijal
[`M1-CHAT-EVIDENCE-RECOVERY-X1 + X1-a + X1-b`](docs/decisions/030-m1-chats-evidence-envelope-recovery.md)
výhradně pro invalidní historical evidence commit
`I=39776f1e90e425bd91a7be707edc556a299869bd` nad
`C_CHAT=578876dd77c68df4bdcf6239383fa782b649f843`. `I` je direct child
`C_CHAT` a mění jediný report, ale před povinnými dvěma metadata řádky přidal
25 řádků narativu. Proto neprojde byte-exact `assert_report_append` a nesmí být
použit jako platný `E_B`, i když oba povinné klíče na jeho konci mají správné
hodnoty.

Povinná jednorázová recovery topologie je:

```text
C_CHAT
├── I -> G_REC -------------------┐
└── X (correct E_B_CHAT) ---------┴-> R_REC
```

- `G_REC` je vlastní docs-only governance commit, direct child `I`, který
  verbatim uchová 25řádkový narativ mimo run report a projde nezávislým review
  před vznikem `X`; `writer != reviewer`;
- `X` má jediného parenta exact `C_CHAT`, mění pouze původní chats report a
  musí mít correct report blob
  `04b839db53abcbce510a9d57d7b750f20e2c6f9d` a root tree
  `118a7b5007cfcb75baad0ce894b2e3bbd5517e72`; standardní
  `assert_report_append C_CHAT X` nad exact dvěma řádky musí projít;
- corrected behavior Review B se neopakuje, protože candidate, runtime/source
  a již pozorovaný corrected attempt se nemění; recovery smí spustit jen Git
  metadata, path, blob a tree gates;
- `R_REC` je merge commit s exact parent order `[G_REC, X]`. Jeho report je
  byte-identický s `X`; každý non-report path je byte-identický s `G_REC`.
  Invalidní 27řádkový report blob z `I` nesmí být v resulting tree;
- integration se posune pouze fast-forwardem `I -> G_REC -> R_REC`. `I`
  zůstane dosažitelné jako invalid historical evidence; rebase, cherry-pick,
  amend, force-push a history rewrite jsou zakázané;
- pouze metadata-ověřený a canonical fast-forward promováný `R_REC` je
  přípustný base následného settings resetu.

Tato výjimka nevytváří obecný alternativní evidence proces. Neoslabuje
`assert_report_append`, nedovoluje volný prose v `E_B` a neopravňuje budoucí
vadnou obálku k reconciliation merge bez nového explicitního operátorského
rozhodnutí. Přesný allowlist, verbatim payload, parent gates a resource hranice
jsou v
[`WP-M1-CHATS-EVIDENCE-RECOVERY`](docs/wp/WP-M1-CHATS-EVIDENCE-RECOVERY.md).

Invalidovaný první pilot prokázal porušení pravidla jednoho writera v jednom
checkoutu. Nezakázal izolované branches/worktrees; ty zůstávají standardem pro
WP s disjunktními cestami, connectory a vyřešenými dependencies.

#### Sdílený checkout jen pro prokazatelně read-only běhy

Souběžné operace smějí sdílet checkout pouze tehdy, jsou-li prokazatelně
filesystem-read-only. Jakýkoli běh, který vytváří artefakty, cache, DB,
generovaný dokument nebo jiný stav, používá vlastní checkout nebo explicitně
izolovaný externí artifact root.

Není to preventivní opatrnost. Sdílený worktree už jednou vyvolal dirty-tree
race a zneplatnil jinak platný report na shodném SHA — viz `ROADMAP.md` §4,
„Aktuální evidence“. Efemérní worktree se zakládá na disku, ne v `/tmp`; ten je
na referenčním stroji tmpfs.

#### Měřený dokument patří integračnímu SHA

Sériové mergování samo neopravuje význam měřených dokumentů. Větev změří
baseline na svém SHA a po spojení už popisuje jiný strom, i když textový merge
proběhl čistě. Proto:

- WP zapisuje vlastní report do unikátní cesty přes `E_A`/`E_B` a s přesným
  měřeným subject/candidate SHA; report nikdy netvrdí SHA commitu, který jej
  právě zapisuje;
- `ROADMAP.md`, `SYSTEM-MAP.md`, generovaný `docs/convergence/TEST-REGISTRY.md`
  a souhrnný stav aktualizuje integrační vlastník na merge SHA;
- evidence tvoří DAG, ne jeden přepsaný výsledek: `S -> E_A -> C -> E_B`.
  Merge candidate `C` je proto preferovaný před squashem; rebase nebo
  cherry-pick po vydání evidence vytvoří nové SHA a důkaz se musí přivázat
  znovu.

Rozsah důkazu podle úrovně: větev focused pozitivní a negativní test; merge
commit dotčené boundary/integration testy obou WP; milestone fresh-clone
journey na pojmenovaném SHA; release celý required Gate 0 řetěz podle §8. Běžný
merge nespouští celý release řetěz — Gate 0 platí u releasu, ne při vývoji.

#### Řízená výjimka: `tests/registry.json`

Registry je jediný soubor, který paralelní WP nutně sdílejí: validátor odmítá
každý runnable test, který v něm není, a současně vyžaduje aktuální generovaný
dokument. Branch-local zelená evidence tedy bez zápisu do registru neexistuje.
Vlastnictví je zde na úrovni `suites/<id>`:

- paralelní WP smí pouze **přidávat** nové záznamy s předem rezervovaným
  unikátním `suite.id` a `path`;
- nesmí měnit schéma, `exclusions` ani existující záznam;
- záznam píše větev, ne integrátor — jinak commit odkazuje na test, který
  v okamžiku vydání evidence není registrovaný;
- integrátor při merge provede sjednocení záznamů, generovaný
  `TEST-REGISTRY.md` vždy zahodí ve prospěch regenerace z výsledného registru
  a spustí validátor.

Validátor už hlídá duplicitní `id` i `path`, takže ztracený nebo zdvojený
záznam merge gate zachytí. Rozdělení registru na fragmenty je pozdější
optimalizace, ne podmínka paralelismu.

### Rozsah 1.0

Specialisté a agenti nejsou mimo produkt: 1.0 musí dodat jejich platformu a
jeden skutečný E2E scénář každého typu. Notifikace, marketplace, media a
upgrade automatika vstupují do práce podle závislosti konkrétního user journey,
nikoliv jen podle adresáře. Setup wizard, OpenCode a Serena nejsou kritická
cesta 1.0. Přesný rozsah a milníky určuje `PRODUCT.md` a `ROADMAP.md`.

---

## 7. Kontrakt pro agenta

Agent řídí větev. Operátor řídí projekt a určuje tento kontrakt.

**Agent smí bez ptaní:**
- provést read-only průzkum schopnosti nebo connectoru potřebný pro aktivní WP;
- implementovat malý přírůstek uvnitř schváleného WP a jeho vlastněných cest;
- opravit chybu, která shodila L1;
- doplnit chování jako regresi po nalezené chybě.

**Agent si musí vyžádat souhlas:**
- produktovou disposition zachovat / nahradit / vyřadit, pokud nebyla
  schválená v aktivním WP;
- seznam uživatelských chování a veřejný connector před implementací;
- změnu dependency DAG nebo rozsahu release;
- výměnu jakékoli části za open source;
- cokoli, co mění L0.

**Agent nesmí:**
- zahájit hlubokou implementaci bez runtime pozorování a vymezeného WP;
- zapisovat souběžně do cizích cest nebo měnit connector vlastněný jiným WP;
- zapsat nedokončenou schopnost jako hotovou;
- založit dokument, který nemá adresáta a důvod;
- snížit, přeskočit nebo umlčet test kvůli zelené;
- spouštět attestační řetěz jako součást běžného vývoje.

**Každý dokončený WP má demonstrovatelný výsledek** — je vidět v UI,
uživatelském journey nebo v čísle z L3. Jednotlivý prerequisite commit může
zavést connector contract, boundary test, migraci, packaging/recovery krok,
authority dokument nebo bezpečnostní opravu; musí ale být nezbytný pro
pojmenovaný WP, focused ověřený a nesmí se vydávat za dokončený produktový
výsledek sám o sobě.

---

## 8. Gate 0 platí u releasu, ne při vývoji

> **Rozhodnutí operátora, 2026-08-02.** Tohle je ta věta, na které stojí celý
> zbytek kapitoly: **Gate 0 se uplatňuje výhradně při releasu. Během vývoje
> neplatí.** Ne „uplatňuje se mírněji", ne „uplatňuje se u důležitých změn" —
> **neplatí.**

### Proč to bylo nutné vyslovit

Gate 0 má pravidlo *„jakákoli změna stromu ruší kandidátní verdikt"*. To je
správné pro certifikaci releasu a **fatální pro vývoj**, protože znamená, že
nelze zároveň vyvíjet a být certifikovaný. Proces tím **trestá produktovou
práci a odměňuje práci na aparátu.**

Změřeno na vlastní historii (`DIRECTION.md` §0): 177 commitů za 4 dny a poměr
aparátu k produktu zhruba **5 : 1**. Aparát fungoval — jen měřil prázdný pokoj.

### Co z toho konkrétně plyne

| Dosud | Nově |
|---|---|
| Gate 0 attestace u každé změny | **Attestace jen u releasu.** Denní režim = L1 zelená |
| „Jakákoli změna stromu ruší kandidáta" jako provozní režim | **Platí výhradně pro release kandidáta.** Při vývoji se kandidát neřeší |
| Attestační řetěz `C→E→R→A` ve smyčce | Spouští se **při releasu**, ne jako součást běžné práce |
| Fingerprint registru zapečetěný v Gate 0 policy | **Rozchod s ním při vývoji není vada.** `nightly-orchestrator-self-test` proto padá očekávaně; obnovení řetězce je release práce |
| Gate 1 jako 30 nezávislých důkazních řízení | Schopnosti podle §6, v pořadí daném závislostmi |
| Evidence generovaná devítifázovým producerem | Producer zůstává pro release; vývoj běží na L1 |
| `AGENTS.md` jako vlastní pravidla vývoje | Tento dokument. `AGENTS.md` a `CLAUDE.md` jsou shodné vstupní ukazatele |

### Co Gate 0 naopak zůstává

Ruší se **ceremonie, ne výstup.** Inventář — registr testových programů, matice
schopností, disposition, registr rizik — je živý majetek a mapa projektu, kterou
C3 nikdy nemělo. Udržuje se dál.

**Test, jestli je pravidlo aplikované správně:** brzdí mě právě teď Gate 0
v produktové práci? Pokud ano, aplikuju ho špatně.

---

## 9. Odložená rozhodnutí

### Bezpečnost a credentials — před release, ne jako odbočka od základu

**Rozhodnutí operátora, 2026-08-01.** Bezpečnost, credentials a privacy incident
`P-001`..`P-003` se řeší **až budou základní věci odladěné**. Nezastavují M0–M4,
ale jsou tvrdou podmínkou production-ready milníku M5 a release M6.

Zůstávají v evidenci, aby se na ně nezapomnělo:

- `P-001`..`P-003` — privátní materiál je v současném stromu kontejnovaný,
  v git historii zůstává dosažitelný. Rotace credentialů a rozhodnutí o historii
  vyžadují akci operátora, dokud se to neudělá, expozice trvá;
- `G0-R018` — legacy listener zůstává na loopbacku, což je invariant L0-10.
  Dokud platí, není z toho aktivní riziko;
- nezapojený `validateApiToken()` a chybějící globální auth guard patří do téhož
  balíku a řeší se s ním.

Nic z toho nebrání lokální produktové práci v M0–M4, dokud drží loopback. Nic z
toho se nesmí přenést jako otevřený blocker přes M5.

### Přijaté, ale ještě neimplementované

- **L0-8 specialist boundary:** decision
  [`019`](docs/decisions/019-l0-8-specialist-boundary.md) přijalo strict
  injection a samostatný specialistický ratchet. Porušení trvá do integrace
  `WP-M3-L0-8-ENFORCEMENT` a `WP-M3-L0-8-INJECTION`; capability #8 tím ještě
  nebude hotová.

### Zbývá rozhodnout

- **Rozdělení #6** (chat pipeline) — vyplyne z hluboké runtime inventury.
- **Osud legacy web UI** `/architect` — není cílové UI, ale disposition není schválená.
- **#18b upgrade automatika** — background síť je vypnutá; zůstává rozhodnout
  dlouhodobé retain/defer/retire.
