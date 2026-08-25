# WP-M2-CODE-PROJECT-CONTEXT-V1

**Typ:** větší paralelní Work Package pro coworkera

**Stav:** `PINNED_V1 / IMPLEMENTATION_GREEN / OPERATOR_REVIEW_PENDING`

**Contract-review base:** `c4ffb2de` — poslední commit této linie před M2
implementací, který otevírá M2 po P0 closeoutu

**Inspekční revision:** `b00df959`

**Produkční implementační base:** `44a9ba87` — čistý M1 closeout,
`ROADMAP.md` zde vede M1 jako `ACCEPTED / GATE_2_PASS`; tato branch je jeho
přímý potomek

**Nahrazený blocker:** původní review zjistilo divergenci
`c4ffb2de...44a9ba87` => `113 101`. Implementace proto nevzniká mergem těchto
tipů: schválený contract commit byl čistě přenesen na nový branch přímo z
`44a9ba87`.

**Autorita:** `ROADMAP.md` §6 `WP-M2-CODE`; `CONTRACT.md` §7

## 1. Proč je tento proud paralelní

**Uživatelský výsledek:** uživatel položí `CODE_ANALYSIS` dotaz nad otevřeným
projektem a model dostane pouze deterministický, revision-bound kontext z tohoto
projektu. Legitimizované `empty`, změněná revision, chybný scope, timeout a
cancel jsou na skutečné consumer hranici rozlišitelné a žádná z těchto větví se
nevydá za jinou.

`ROADMAP.md` dovoluje `WP-M2-CODE` běžet vedle `WP-M2-EFFECT`, protože
project-context connector neprovádí write, exec, network ani Git efekt.
Veřejný tvar, pozorovatelné chování a Containment V1 disposition v §7 operátor
schválil 2026-08-23. M1 base `44a9ba87` nyní splňuje vstupní podmínku a tento
samostatný produkční branch smí implementovat výhradně povolený scope v §4.

Closeout autoritu nyní vlastní Decision 030. Veřejný
`ProjectContextQuery/Snapshot@1` je mechanicky `PINNED_V1`; finální verdikt nad
přesnými integračními bajty vydá operátor. Dřívější Opus review záznamy jsou
historická evidence, nikoli aktuální acceptance podmínka.

Balík je disjunktní od GPU/model hunta i od path-authority proudu. Contract
review zůstává zachovaný na původní větvi; produkční větev vznikla přímo z
M1 closeoutu a nese přenesený contract commit. `eb22d10c` není base tohoto WP,
protože jeho path-authority řez stále čeká na nezávislý re-review. Jediná
plánovaná integrační kolize je append-only rezervace nových test suite ID.

WP ovlivňuje tyto trvalé rails:

- **R2 LOCAL_FIRST:** provider nemá network, Git/exec ani cross-project čtení;
- **R3 OBSERVABLE_BEHAVIOR:** důkaz vede přes skutečný `CODE_ANALYSIS` consumer;
- **R4 MEASURED_QUALITY:** manifest cost a retrieval quality mají měřený
  baseline/tripwire, ne pouze tvrzení;
- **R5 MODULAR_BOUNDARIES:** consumer používá jediný verzovaný connector a
  legacy interní retrieval stack je z jeho call graphu odstraněný;
- **R7 PRIVACY_AND_LEARNING_SCOPE:** každá item nese project scope, revision,
  content digest a provenance.

## 2. Doložené závady a hranice containmentu

Na `b00df959`:

- `src/chat/handlers/code-analysis.js` čte globální `symbolIndex` a
  `knowledgeGraph` bez project bindingu;
- `src/code-intel/symbol-index.js` drží jediný `_projectPath` a exportuje
  singleton;
- `src/code-intel/knowledge-graph.js` umí při souběhu vrátit právě probíhající
  build bez ověření požadovaného projektu;
- `src/code-intel/context-builder.js` nevrací workspace revision ani per-file
  content provenance;
- `src/code-intel/code-search.js` drží wall-clock TTL cache a vybírá
  `rg`/`grep` přes `execFile`;
- `src/code-intel/file-discovery.js` drží globální 60s Git-recency cache, která
  není klíčovaná projektem, používá `Date.now()`, spouští `git log` přes
  `execFile` a dává tomuto signálu váhu `0.15` v pořadí výsledků;
- `tests/search-quality-a123.test.js` ověřuje fetch/retry/confidence utility,
  nikoli retrieval kvalitu `CODE_ANALYSIS`.

Důsledek: projekt A může dostat index/graf projektu B nebo snapshot smíchaný
ze dvou revision. Stejný projekt, revision a dotaz současně nemají zaručené
stejné pořadí, protože dnešní retrieval závisí na globální cache, Git historii
a wall-clock čase. Prázdný výsledek nerozlišuje legitimní `empty` od `stale`,
chybného scope nebo interní chyby.

Tento WP je vědomý **containment**, ne globální oprava singletonů. V1 consumer
odstraní celý dnešní retrieval stack ze svého produkčního call graphu. Provider
ani consumer nesmí importovat, volat nebo čekat na:

- `code-search.js`;
- `file-discovery.js` / `rankFiles`;
- `symbol-index.js`;
- `knowledge-graph.js`;
- `graph-retrieval.js`.

Závady a ostatní consumery těchto modulů zůstávají jako samostatný residual
risk a smějí se opravovat pouze v následném, výslovně rozšířeném WP.

## 3. Connector ke schválení

Vlastník WP připne JavaScriptový executable kontrakt
`ProjectContextQuery/Snapshot@1`. V1 nemá druhou ručně udržovanou JSON Schema
autoritu. Pokud ji bude potřebovat budoucí RemoteCore, vznikne jako jediný
normativní zdroj s generovaným JS validátorem nebo s povinným parity testem.

### 3.1 `ProjectContextQuery@1`

- `contract: 'ProjectContextQuery'` a `version: 1`, shodně s executable JS
  autoritou;
- `requestId`: stabilní identita dotazu, nevstupuje do `snapshotDigest`;
- `projectId`: kladné safe-integer `projects.id`, tedy stabilní registry-backed
  identita projektu;
- `canonicalRoot`: absolutní, již kanonická cesta; provider ji znovu porovná s
  `realpath()` cesty vyřešené výhradně přes registry `projectId`;
- `workspaceRevision`: očekávaná revision `wsr1:<sha256>`;
- `queryText`;
- pevné rozpočty `maxFiles`, `maxBytes`, `maxTokens`;
- cancellation a deadline přicházejí out-of-band jako invocation context,
  nikoli jako součást serializovaného dotazu nebo digestu.

`projectId` se nesmí odvozovat z `canonicalRoot`. Produkční resolver používá
registry `projects.findById`; `projectId A + canonicalRoot B`, nekanonický root
nebo symlink alias skončí `PROJECT_CONTEXT_INVALID_SCOPE`.

### 3.2 Kanonická normalizace dotazu

Provider odvodí `normalizedQuery` a `terms` jediným verzovaným algoritmem:

1. `queryText.normalize('NFC')`;
2. Unicode whitespace se zkolabuje na jednu ASCII mezeru a okraje se oříznou;
3. použije se ECMAScript `toLowerCase()`, nikdy locale-dependent
   `toLocaleLowerCase()`;
4. tokeny jsou výskyty `/[\p{L}\p{N}_]+/gu` v pořadí vstupu;
5. duplicitní tokeny se odstraní first-win, bez locale collatoru, stemmeru,
   synonym a wall-clock dat.

Pokud wire tvar nese také caller-supplied `terms`, validator vyžaduje jejich
byte-for-byte shodu s tímto odvozením; preferovaný V1 tvar je odvozuje pouze v
provideru. NFC/NFD ekvivalenty a stejná query s rozdílným locale prostředím
musí dát stejné terms, pořadí i `snapshotDigest`.

### 3.3 `workspaceRevision`

`workspaceRevision` není Git SHA, mtime, inode ani wall-clock hodnota:

```text
workspaceRevision = "wsr1:" + SHA256(canonicalManifest)
```

Provider současně vlastní read-only observation seam
`observeWorkspaceRevision({ projectId, canonicalRoot }, invocationContext)`.
Současný `CODE_ANALYSIS` caller žádnou revision nemá, proto ji nesmí hádat z Git
SHA ani z mtime. Nejdřív přes tento seam získá přesný token a následný
`ProjectContextQuery` jej použije jako optimistic-concurrency precondition.
Změna mezi observation a query je očekávaný `PROJECT_CONTEXT_STALE`, ne důvod k
tichému přijetí novějšího stromu. Observation používá stejné registry/root
ověření, manifest algoritmus, cancellation a deadline jako samotný query build.

`canonicalManifest` obsahuje verzi algoritmu a file-filter policy, `projectId`
a všechny položky providerem pozorovatelného `ContextSourceSet@1`. Walk:

- nepoužívá Git ani externí proces;
- neprochází symlinky;
- normalizuje cesty na project-relative POSIX tvar;
- řadí jména bytewise bez locale collatoru;
- pro každý admissible regular file zapisuje délkově oddělenou cestu, typ a
  SHA-256 skutečných bajtů;
- zahrnuje dirty i untracked admissible soubory;
- pro deterministicky vyloučený binary/oversize typ zapisuje verzovaný sentinel;
- při unreadable položce, symlinku ven, překročení pevného scan ceilingu nebo
  neověřitelném typu selže explicitně; nevydá částečnou revision.

Executable autorita připíná `ContextFilePolicy@1`: nejvýše `1 MiB` na regular
file, hloubku `64`, `10 000` navštívených entries a `512 MiB` skutečně
hashovaných UTF-8 bajtů. Allowlist code/config/text přípon, explicitní basenames
a přesný seznam ignorovaných build/dependency adresářů jsou součástí kanonicky
serializovaného policy descriptoru v `project-context-manifest.js`; změna
kteréhokoli filtru tedy vyžaduje novou verzi policy a změní revision. Platný
UTF-8 text se hashuje celý. NUL/invalid-UTF-8 soubor, oversize soubor a interní
symlink mají verzovaný sentinel; symlink ven je scope error.

`maxFiles` je output budget, nikoli limit úplnosti manifestu. Scan ceiling je
samostatná provider policy; jeho překročení vrací
`PROJECT_CONTEXT_SCAN_LIMIT`, ne revision prvních N souborů.

Provider před sestavením ověří očekávanou revision, přečtené items sváže s
jejich content digests a po sestavení celý manifest spočítá znovu. Platí:

```text
expectedRevision === revisionBefore === revisionAfter
```

Jakákoli nerovnost, smazání nebo změna obsahu vrací
`PROJECT_CONTEXT_STALE` bez items. Stale chyba nese jak očekávanou, tak nově
pozorovanou revision, pokud ji lze úplně a bezpečně spočítat.

Read-only performance probe na inspekčním repu potvrdil řádově 1,7 tisíce
souborů a 76 MB: reviewer naměřil teplý raw `sha256sum` přibližně `0,068 s`;
nezávislý end-to-end probe nad `rg --files` včetně enumerace, řazení a hashování
naměřil `0,20 s` wall-clock pro 1 724 souborů / 76 025 013 bajtů. Jde o
rationale pro jednoduché dvojité content hashování, nikoli SLA. V1 nesmí tuto
cestu „optimalizovat“ mtime/inode cache bez nového contract review a
adversarial stale důkazu.

### 3.4 `ProjectContextSnapshot@1`

Transportní terminál používá M1 slovník:

```text
status = ok | cancelled | timeout | error
```

Pouze `status: ok` nese doménový výsledek:

```text
outcome = found | empty
```

Mapování je závazné:

| Situace | `status` | `outcome` / chyba |
|---|---|---|
| alespoň jedna položka | `ok` | `found` |
| úplný validní scan bez shody | `ok` | `empty` |
| změněná revision | `error` | `PROJECT_CONTEXT_STALE` |
| chybný project/root/path scope | `error` | `PROJECT_CONTEXT_INVALID_SCOPE` |
| povinný provider není připraven | `error` | `PROJECT_CONTEXT_NOT_READY` |
| první shoda se nevejde do budgetu | `error` | `PROJECT_CONTEXT_BUDGET_EXHAUSTED` |
| překročen scan ceiling | `error` | `PROJECT_CONTEXT_SCAN_LIMIT` |
| jiné interní selhání | `error` | `PROJECT_CONTEXT_INTERNAL` |
| deadline | `timeout` | `PROJECT_CONTEXT_TIMEOUT` |
| caller abort | `cancelled` | `PROJECT_CONTEXT_CANCELLED` |

Discriminovaná union musí vynutit:

- `found` právě tehdy, když `1 <= items.length <= maxFiles`;
- `empty` právě tehdy, když `items.length === 0`, scan je úplný a stabilní a
  neexistuje shoda zahozená jen proto, že se nevešla do budgetu;
- `truncation.truncated === true` pouze u `found`;
- `workspaceRevision`, deterministicky seřazené `items`, `budget`,
  `truncation` a `snapshotDigest` u obou úspěšných outcomes;
- project-relative path, line span, content digest a provenance na každé item;
- `error` pouze u `error | timeout | cancelled`; tyto větve nenesou items ani
  úspěšný `snapshotDigest`;
- `PROJECT_CONTEXT_STALE` navíc nese
  `expectedRevision` a `observedRevision`; pokud úplné observed revision nelze
  získat, provider místo falešné hodnoty vrátí odpovídající interní/read chybu;
- žádný wall-clock údaj nevstupuje do `workspaceRevision` ani `snapshotDigest`.

`snapshotDigest` pokrývá verzi kontraktu a normalizace, `projectId`, přesnou
`workspaceRevision`, `normalizedQuery`, `terms`, rozpočty, ordered items včetně
content digests a truncation. `requestId`, log timing a wall-clock čas jsou
vyloučené.

### 3.5 Cold start

V1 nemá povinnou cache: bounded read-only snapshot sestaví na požádání a legacy
index/graf ignoruje. Studený legacy singleton proto není stav connectoru.
Pokud implementace později zavede povinný prebuilt provider, cold stav musí
vrátit `status: error`, `PROJECT_CONTEXT_NOT_READY`, nikdy `empty`, a stejné WP
musí určit vlastníka i cestu warm-upu.

### 3.6 Deterministický V1 retrieval

V1 retrieval používá pouze kanonický manifest, obsah a normalizované terms.
Nesmí číst Git historii, cache stáří, mtime, wall-clock čas, globální index ani
globální graf. Každé skóre a tie-break pravidlo musí být integer/rational nebo
jinak kanonicky serializovatelné; finální tie-break je bytewise project-relative
path.

Containment vědomě odstraňuje z `CODE_ANALYSIS`:

- Git-recency ranking;
- grafovou expanzi;
- O(1) symbol lookup z globálního indexu.

To je pozorovatelná produktová regrese/capability reduction, nikoli skrytý
implementační detail. Operátor ji 2026-08-23 přijal pouze jako bezpečnostní
mezikrok, ne jako cílový stav. §6 zavádí minimální retrieval-quality tripwire,
ale neprokazuje plnou paritu dnešního heuristického stacku ani nezachytí každý
pokles kvality odpovědi, který pocítí uživatel.

Project-bound obnova začíná hned po integraci tohoto containmentu samostatným
[`WP-M2-CODE-PROJECT-BOUND-SYMBOL-INDEX-V1`](WP-M2-CODE-PROJECT-BOUND-SYMBOL-INDEX-V1.md).
Grafová expanze následuje až po jeho akceptaci. Git-recency signál v dnešní
wall-clock/Git podobě se neobnovuje.

## 4. Povolené cesty

- `contracts/m2/project-context-v1.js`;
- `src/code-intel/project-context-*.js`;
- minimální consumer změna `src/chat/handlers/code-analysis.js`;
- `tests/m2-project-context-contract.test.js`;
- `tests/m2-project-context-boundary.test.js`;
- `tests/m2-project-context-consumer.test.js`;
- `tests/m2-project-context-retrieval.test.js`;
- `tests/fixtures/m2-project-context/**`;
- pouze čtyři předem rezervované nové `suites/<id>` v `tests/registry.json`;
- přesné fixture-program exclusions v `tests/registry.json` a mechanicky
  generovaný `docs/convergence/TEST-REGISTRY.md`;
- `tests/fixtures/module-boundary/baseline.json` pouze přes explicitní
  `module-boundary-ratchet --write-baseline --accept-edge` po čistém source
  commitu;
- unikátní branch report
  `docs/execution/runs/wp-m2-code-project-context-v1.md`.

Souhrnné dokumenty a generovaný registry report aktualizuje integrátor až po
merge.

Implementační větev tento původní deferral výslovně překonala: registry gate je
součástí acceptance a proto byl generovaný report aktualizován v témže řezu.
Nejde o ručně udržovanou druhou autoritu.

## 5. Zakázané cesty a závislosti

- `contracts/m2/project-context-v1.schema.json` jako druhá ručně udržovaná
  autorita;
- změny `src/code-intel/code-search.js`, `file-discovery.js`, `symbol-index.js`,
  `knowledge-graph.js`, `graph-retrieval.js` a jejich obejití dynamickým importem;
- `PRODUCT.md`, `DIRECTION.md`, `CONTRACT.md`, `ROADMAP.md`, `SYSTEM-MAP.md`,
  `.project/**`;
- `src/executor/**`, `src/patch/**`, `src/planner/**`, `src/tools/**`,
  `src/skills/**`, `src/approvals/**`;
- `src/upgrade/**`, `src/eval/**`, model/GPU skripty a testy;
- Studio, WebSocket, mobilní klient, databázové migrace;
- existující registry záznamy, registry schema a exclusions;
- filesystem writes, network, model calls, Git a jiné subprocessy v provideru;
- cizí checkouty, procesy a stavové dokumenty.

## 6. Acceptance, retrieval baseline a negativní důkazy

1. Stejný project, `workspaceRevision` a semanticky stejná normalizovaná query
   dvakrát vrátí stejné outcome, pořadí, items a `snapshotDigest`.
2. Fixture projekty A/B mají rozdílné canary; query A nikdy nevrátí B.
3. Reálný `CODE_ANALYSIS` consumer používá výhradně snapshot provider a
   neimportuje ani nevolá legacy retrieval stack vyjmenovaný v §2.
4. Snapshot nese přesnou revision a per-file content provenance; změna během
   sestavení nikdy nevydá smíšený snapshot.
5. Produkční consumer získá očekávanou revision výhradně přes
   `observeWorkspaceRevision`; Git SHA, mtime ani caller-supplied náhradní token
   nejsou fallback.
6. Rozpočty jsou deterministické a fail-closed; první relevantní item, který se
   nevejde, není `empty`.
7. Focused journey používá fake/injected LLM a nespouští Ollamu, GPU ani síť.
8. NFC/NFD česká diakritika, rozdílné locale prostředí a různé Unicode
   whitespace varianty mají kanonicky očekávané terms a digest.
9. Provider respektuje `AbortSignal` a deadline mezi walk/read/hash kroky;
   timeout/cancel nemůže být přepsán pozdním `ok`.
10. Operátor výslovně rozhodl disposition capability reduction podle §7.

### Retrieval-quality tripwire

`tests/m2-project-context-retrieval.test.js` používá commitnutý fixture projekt
s nejméně třemi reprezentativními dotazy, relevantními soubory, lexikálními
decoys a cross-project canary. Pro každý dotaz commitnutý oracle určí:

- exact `mustIncludeInTopK` a hodnotu `K`;
- nejvyšší povolenou pozici každého povinného souboru;
- zakázané canary paths/content;
- očekávané deterministické pořadí při shodném score;
- minimální line-span/content canary, který dokazuje užitečný kontext, ne jen
  správný název souboru.

Test musí vyžadovat `100 %` splnění commitnutých `mustIncludeInTopK` pravidel a
`0` zakázaných canary. Oracle nesmí být generovaný z výstupu legacy retrievalu
v témže běhu. Změna oraclu je contract-review změna, ne automatická aktualizace
goldenu. Tento tripwire hlídá přijaté minimum, nikoli tvrzení o plné kvalitativní
paritě s odstraněným Git/graph/symbol stackem.

**Přijaté omezení evidence:** tři fixture dotazy jsou CI podlaha, ne parita.
Automatizace tohoto WP nezachytí každý uživatelsky vnímaný pokles kvality
`CODE_ANALYSIS`. První širší signál přijde z operátorské demonstrace a reálné
uživatelské zpětné vazby po integraci. Do té doby se výsledek smí označit jako
contract/focused ověřený, nikoli jako plná retrieval-quality parita nebo
`ACCEPTED/PASS` celé schopnosti #12.

Negativní sady musí pokrýt:

- nejdřív naplnit starý globální index/graf projektem B, pak dotazovat A;
- souběžné dotazy A/B;
- přímý i dynamický import každé zakázané legacy retrieval závislosti;
- absolutní cestu, `..`, symlink ven a `projectId`/root mismatch;
- očekávanou starou revision a změnu souboru během sestavení =>
  `PROJECT_CONTEXT_STALE` s přesným `expectedRevision` a novým
  `observedRevision`, bez items;
- binární, příliš velký, smazaný, nečitelný soubor a překročený scan ceiling;
- shodu, jejíž první item překročí byte/token budget =>
  `PROJECT_CONTEXT_BUDGET_EXHAUSTED`, nikdy `empty`;
- cold optional cache => provider fallback; cold mandatory cache =>
  `PROJECT_CONTEXT_NOT_READY`, nikdy `empty`;
- cancel a timeout včetně pozdního dokončení read/hash kroku;
- spies dokazující nula filesystem writes, network, model, Git a subprocess
  calls před předáním snapshotu consumerovi;
- skutečný consumer seam, ne pouze schema validator;
- mutační test, který do pořadí přidá `Date.now()`, locale collator nebo Git
  recency a musí shodit determinismus/retrieval tripwire.

## 7. Sedmé operátorské rozhodnutí — produktová disposition

**Stav:** `ACCEPTED_CONTAINMENT_V1` — operátor, 2026-08-23.

Operátor přijímá odstranění Git-recency rankingu, grafové expanze a globálního
O(1) symbol lookupu z `CODE_ANALYSIS` výměnou za project-bound,
content-addressed a deterministický connector, protože:

1. cross-project leak je izolační nekorektnost a přebíjí retrieval kvalitu;
2. rozšířená feature-parity varianta by leak ponechala živý po dobu podstatně
   většího WP;
3. `ContextSourceSet@1`, revision binding a kanonicky serializovatelné skóre
   dovolují schopnosti později vrátit bez změny veřejného connectoru;
4. capability reduction je ohraničená minimální CI quality floor;
5. operátor vědomě přijímá, že širší první feedback na kvalitu přijde od
   uživatele, nikoli z této CI podlahy.

Disposition tří odstraněných signálů není stejná:

- **Git-recency ranking:** `RETIRE_AS_DESIGNED`; váha `0.15` vázaná na Git
  historii, globální TTL cache a wall-clock je nondeterministický šum a v této
  podobě se nikdy nevrátí;
- **O(1) symbol lookup:** `P0 RESTORE PROJECT_BOUND`; je největší praktická
  ztráta pro dotazy „kde je X definované“ a vlastní jej okamžitý follow-up WP;
- **grafová expanze:** `P1 RESTORE PROJECT_BOUND`; následuje až po symbol indexu
  pro dotazy typu „co tohle rozbije“.

Containment V1 je mezikrok. Za cílový stav se nesmí vydat ani tehdy, když jeho
focused sady projdou.

## 8. Stop conditions

- branch přestane být přímým potomkem přijatého M1 base `44a9ba87` nebo bude
  jeho acceptance odvolaná novým autoritativním nálezem;
- caller nemá registry-backed project identity nebo přesnou revision;
- implementace vyžaduje effect/write/network/Git/exec connector;
- je nutné změnit globální L0 hranici, stavové dokumenty nebo cizí dirt;
- boundary test odhalí cross-project leak nebo smíšenou revision;
- retrieval tripwire nesplní commitnutý quality floor;
- řešení by muselo vrátit `empty` místo explicitního
  stale/scope/not-ready/budget/scan/internal terminálu;
- řešení vyžaduje ručně udržovat JS validator a JSON Schema jako dvě autority.

## 9. Přesné ověření

```bash
node tests/m2-project-context-contract.test.js
node tests/m2-project-context-boundary.test.js
node tests/m2-project-context-consumer.test.js
node tests/m2-project-context-retrieval.test.js
node tests/query-expander.test.js
node tests/code-search.test.js
node tests/file-discovery.test.js
node tests/symbol-index.test.js
node tests/knowledge-graph.test.js
node tests/context-builder.test.js
node scripts/module-boundary-ratchet.mjs
npm run test:deterministic
npm run test:registry
git diff --check
git status --short
```

První čtyři sady jsou acceptance evidence provideru. Následujících šest legacy
sad pouze dokazují, že containment nezměnil jejich vlastní moduly; neprokazují
retrieval kvalitu nového consumeru. `tests/search-quality-a123.test.js` zde není,
protože ověřuje fetch/retry/confidence utility a pro tento connector není
tripwire.

Modelové E2E `92-code-analysis-depth` do tohoto WP nepatří: je GPU/Ollama a
zůstává pravdivě `BLOCKED`, dokud GPU fronta není volná. Jeho absence nesmí být
prezentována jako produkční ověření kvalitativní parity.
