# WP-M1-MODEL-TERMINAL-FAILOVER — terminal automatic failover and restore

**Typ:** zapisující M1 runtime-authority WP · **Slot:** jediný writer v
izolovaném disk-backed worktree

**Rozhodnutí:** [006/D+](../decisions/006-m1-model-auto-rebind-l0.md),
[015/A](../decisions/015-m1-model-failover-proof-policy.md),
[020/E](../decisions/020-m1-model-failover-opt-in-surface.md),
[024/A](../decisions/024-m1-proof-issuer-provenance.md) a
`M1-CLOSEOUT-X1`

**sourceEvidenceRevision:** `6c36607421c013dd27f41e35853009bcaa0b5b51`

**baseRevision:** promoted exact `G8` =
`e876becb62dce9a6ccf61057a489e63d5bb62be3`. Tento one-file governance
amendment `G9` musí být jeho direct child, projít nezávislým review a být
promován výhradně canonical fast-forwardem `G8 -> G9`; teprve exact full SHA
`G9` je Phase A report base.

**integrationRef:** `integration/m1-consolidated-20260810`

**Branch:** `wp/m1-model-terminal-failover-20260812`

**Phase A implementation review/promotion refs:**

- Review A: `evidence/m1-model-terminal-failover-review-a-20260812`;
- merge queue: `queue/m1-model-terminal-failover-promotion-20260812`;
- Review B: `evidence/m1-model-terminal-failover-review-b-20260812`;
- report: `docs/execution/runs/wp-m1-model-terminal-failover-20260812-report.md`.

**Phase B execution review/promotion refs:**

- measured report subject:
  `evidence/m1-model-terminal-failover-execution-subject-20260812`;
- Review A: `evidence/m1-model-terminal-failover-execution-review-a-20260812`;
- merge queue: `queue/m1-model-terminal-failover-execution-promotion-20260812`;
- Review B: `evidence/m1-model-terminal-failover-execution-review-b-20260812`;
- report: tentýž Phase A report, rozšířený byte-prefix-preserving obálkou.

**Stav:** `ACTIVATED / PHASE_A_PRODUCTION_REMEDIATION`. 026 a oba sériové 029
subjecty jsou na exact canonical tipu promovány s Review A/B PASS. Production
tree byl od S4 = `e59217e7c99cf4ccbbd6366b51262793032a36a1` přes L2 byteově
zmrazený. L2 = `e6ecc068724a03ebcebf278e4de0ed374a02038d` zachoval očekávaně RED
mutation control, policy prošla 41/0 a schema 27/0, ale repository skončilo
20/1. Jde o production defect v manual-supersede eligibility po desired update,
proto Review A zůstává `CHANGES_REQUIRED`, test-only stabilization lane je
`STOP` a šest dalších sad plus mobile late-insertion zůstalo `NOT RUN`. G9 ani
autorizace P1 nejsou důkazem opravy, celého bounded programu, nového proofu, GPU
residency nebo Gate 1 PASS.

## 1. Uživatelský výsledek

Po explicitním opt-inu může runtime pro jednu roli použít pouze operátorem
připnutý, lokálně instalovaný fallback s exact requested name, canonical name
a digestem. Aktivace vyžaduje fresh same-role digest-bound proof. Durable intent
předchází runtime effectu a úspěch vznikne až po exact runtime finalize
receiptu. Nula, více, stale nebo nezpůsobilý target skončí `INCONCLUSIVE` bez
binding, provider, config nebo broadcast effectu.

Po návratu exact desired name+digest+revision smí proběhnout nejvýše jeden
restore s fresh desired proofem. Restore failure ponechá fallback aktivní jako
degraded. User binding incident atomicky superseduje a pozdní restore zakáže.
Startup přijme pouze exact active lineage; uncertain commit se reconciliuje
podle exact generation a nikdy blind replayem ani jiným kandidátem.

## 2. Přesný allowlist

**Source:**

- nový `src/db/migrations/2026_08_12_065_model_failover_target.js`;
- `src/db/model-policy.js`;
- `src/upgrade/model-failover.js`;
- `src/upgrade/model-failover-coordinator.js`;
- `src/upgrade/model-binding-application.js`;
- `src/upgrade/model-failover-proof-policy.js`;
- `src/upgrade/upgrade-manager.js`;
- `src/server.js`;
- `scripts/run-model-failover-candidate-measurement.js`;
- `scripts/issue-model-failover-proof.js`;
- nový `scripts/apply-model-failover-target.js`.

**Testy, bez nové suite a bez registry změny:**

- `tests/m1-model-policy.test.js`;
- `tests/m1-model-failover-schema.test.js`;
- `tests/m1-model-failover-repository.test.js`;
- `tests/m1-model-failover-coordinator.test.js`;
- `tests/m1-model-binding-application.test.js`;
- `tests/m1-model-failover-proof-policy.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js`;
- `tests/m1-model-failover-proof-issuer.test.js`;
- `tests/schema-migrations.test.js`.

Review A report smí jako report-only `A_EA` vytvořit pouze výše rezervovaný run
report. Po immutable source subjectu není dovolena jiná docs/source/test změna.

**Zakázané:** routes, HTTP/WS connector, Studio/mobile/chat/quality, generic
settings nebo portability změna, `src/db/user-settings.js`,
`src/db/settings-portability.js`, migrace 046/062/064, model profiles nebo
validation suites, package/lock, registry, user DB/config a jiné uživatelské
soubory. Zakázaný je pull, delete, stop, unload, implicitní rebind, external
network, nová dependency a změna auth/access/trusted-local hranice.

## 3. Target, CAS a migrace 065

Migrace 065 je jediná aditivní schema změna a zavádí versioned per-role target
autoritu a append-only target event. Target obsahuje requested name, canonical
name, exact lowercase 64hex digest, revision, actor, čas a poslední event.
Jediný writer je typed CAS seam v `src/db/model-policy.js`; caller dodává
expected target revision a celý exact target nebo explicitní clear. Missing/
extra pole, canonical mismatch, stale revision nebo neinstalled/ambiguous
artifact selžou před mutací. Set/replace navíc vyžaduje policy ON a úplnou
eligibility; explicitní clear je přípustný i při policy OFF.

Backup/import target nepřenáší a destination jej zachová. Veřejný 029
`SERVER_SETTINGS_V1` reset zachová exact request, response, obě existující CAS,
route i auth hranici; nepřidává `expectedTargetRevision`. Tentýž existující
`BEGIN IMMEDIATE` nejdřív validuje settings+policy CAS, potom pod získaným lockem
načte a atomicky vyčistí všechny owned targety společně se settings a policy,
nebo necommitne nic. Reset tedy vyhrává: update commitnutý před resetem se
vyčistí, stale pre-reset target operace po resetu prohraje na policy/CAS a nový
target smí nastavit jen nově přijatá explicitní operátorská akce po resetu.

Reset nesmí provést post-commit clear, druhou transakci, runtime/provider efekt
ani přidat target-clear/second audit event. Celý reset má přesně jednu již
existující `GLOBAL_RESET` lineage/event. Pouze obyčejný target set/replace/clear
vlastní právě jeden append-only target event. Migrace defaultuje na žádný target
a neodvozuje jej z proof ledgeru, installed modelů, configu ani legacy settings.
„Nejnovější proof vyhrává“ je zakázaná sémantika.

Ordinál 065 je rezervovaný z union census canonical
`6c36607421c013dd27f41e35853009bcaa0b5b51` a mobile ref
`2aeaa5028d9caf731f6a51f1f6df78a5f548c511`, jejichž merge-base je
`8366eb085415149f49e04bd9e788104c4c3ec1f8`. Mobile 055–060 musí být před
source commitem znovu vloženy do disposable již migrované DB; 046/062/064 se
nesmějí opakovat ani měnit a data se nesmějí ztratit.

## 4. Terminal lifecycle a jediný runtime owner

Repository rozšíří existující claim/CAS stav o exact terminal přechody
`ACTIVATED`, `REAPPLIED`, `RESTORED`, `FAILED`, `SUPERSEDED_BY_USER` a
`DEGRADED_PROOF_EXPIRED`. Claim je role/revision/episode/operation/policy-bound;
vítězství claimu samo není runtime success. Každý terminal writer znovu ověří
target, desired revision, exact inventory digest, live proof, policy/version,
claim a nepřeskočenou row/generation CAS.

`model-binding-application.js` zůstává jediným runtime apply/finalize ownerem.
Failover koordinátor dostane frozen least-authority port, ne plný repository,
provider ani arbitrary binding API. Aktivace a restore používají durable
intent → exact provider/runtime effect → operation-bound finalize receipt.
Pozdní nebo nejasný finalize vytvoří typovaný reconciliation stav; retry smí
pouze přečíst exact generation a uzavřít stejnou operaci. Provider effect ani
alternativní target se neopakuje.

Proof expiry aktivní fallback náhle nepřepne. Stav se stane
`DEGRADED_PROOF_EXPIRED`, jednou se zaznamená/oznámí a blokuje nový
`ACTIVATE/REAPPLY`. Revalidation je pouze explicitní operator action,
`ONE_ROLE_ONE_DIGEST_SERIAL`; background renewal nevzniká.

## 5. Source closure a proof invalidace

Terminální změna `src/upgrade/model-failover.js` zneplatní jeho dnešní
raw-byte-pinned proof autoritu. Closure se nesmí odvodit jen z přímých importů:

```text
model-failover.js
  -> src/db/model-policy.js
       -> src/db/user-settings.js
       -> src/db/settings-portability.js
```

Poslední dvě cesty jsou read-only closure inputs a nejsou v allowlistu k
editaci. Candidate measurement, issuer i policy musejí exportovat a ověřit
úplnou transitivní closure exact HEAD blobů, jejich modes/bytes/digesty a čistý
candidate source. Jednořádková mobile closure oprava ani cherry-pick není
přípustná; mobile parita se dokazuje nad exact refy výše.

Po final source se operator-only vydají nové CHAT proofy jen pro exact desired
a fallback digest skutečně potřebné přijatým execution manifestem, nejvýše
dva. Conditional reissue je přípustný pouze při expiry nebo relevantním
source/digest driftu. Issuance sama nemění target, desired/active binding ani
runtime.

## 6. Commity, review a evidence fáze

Původní implementační plán zůstává rozdělený do čtyř malých slice commitů:

1. `S1` = `6bb0945c60a2699ae267f0f4afb071857d50683e` — migrace 065
   a typed target CAS/reset authority; jeho zachovaný review finding napravil
   independently reviewed direct child
   `5917ad4839493ab5d49f0464069c9d6b4f3d4015`;
2. `S2` = `e49de24d4e4ecd671cf7382921bbe01387343b52` — terminal
   repository/claim/CAS; jeho zachovaný `CHANGES_REQUIRED` napravil
   independently reviewed direct child `S2_R` =
   `2ca8c9b75dd9406b1cc050a3fc1b872302a58741`;
3. `S3` = `bbeed6a8501796aa5b6d44850b1d9e5b1530481e` — jediný runtime
   owner, coordinator a startup reconciliation; independent review skončil
   `CHANGES_REQUIRED`, protože changed runtime incarnation s
   `runtimeReceipt === null` může blind replaynout terminal effect;
4. `S4` = `e59217e7c99cf4ccbbd6366b51262793032a36a1` — úplná
   proof/source closure a production oprava S3 findingu jsou
   `STATIC REVIEW PASS / BOUNDED NOT RUN`; celý S4 zůstává
   `CHANGES_REQUIRED`, protože regresní test neprokázal exact oracle níže;
5. `S4_R` — test-only corrective commit, který směl změnit
   pouze `tests/m1-model-binding-application.test.js` a napravit tento jediný
   false-green důkaz; exact commit je
   `825a73a6c3f607aaa663b0c1ebc9f5a1babe07e7` a jeho Review A attempt zůstává
   `CHANGES_REQUIRED`;
6. `S4_R2` = `39c441afa2f4c926ab5acf279ce4650a17f15636` — test-only
   corrective commit změnil pouze `tests/m1-model-policy.test.js`; jeho
   mutation control byl očekávaně RED, ale Review A zůstává
   `CHANGES_REQUIRED` kvůli třem residual fixture selháním;
7. `S4_R3` = `69f2c204ba32f5be019004256973d28180c38b67` — test-only
   corrective commit změnil pouze `tests/m1-model-policy.test.js`; mutation
   control zůstal očekávaně RED a policy suite prošla 41/0, ale Review A
   zůstává `CHANGES_REQUIRED` na schema 23/4 a nedokončeném programu.

Zachovaný Review A attempt nad S4_R má tyto výsledky: první test log SHA-256
`48becd44783bc5fc5f1719ac2cfa787214ee36c93b1cb663aee9ecb951318556`,
119600 B; mutation-control log SHA-256
`09d83fcb37c2e40fc95070493eddf958879802d7913289c5be91bbff23f0260e`,
106 PASS a 1 expected FAIL, tedy kontrola RED; offline-install log SHA-256
`9d2559791d4c3f4574f520f6a7bd09a33cc2f02396f829fb86ad9900ad1d9b3b`.
`m1-model-policy` skončil `FAIL` 6/35: 32 testů sdílí driftlou fixture + 3
false/stale oracle = 35. Zbývajících osm sad a mobile late-insertion nebylo
spuštěno. Tento neúspěch ani jeho artefakty se nemažou a nevydávají za product
finding.

Zachovaný Review A attempt nad S4_R2 má policy log SHA-256
`ace32d642a563eb848b2fe69804765abedf8e1358d3761290edc2bd47f786d84`,
112210 B, s výsledkem 38 PASS / 3 FAIL; mutation-control log SHA-256
`a4872293d0bc4f79839636898a5559a70c8642f5c260c148039031e02fe18a95`
je očekávaně RED; offline-install log SHA-256
`0105d732007ac430ec0aba5359b9767e9cbda559099d4889cbb3bd66dbb1930a`.
Zbývajících osm sad a mobile late-insertion nebylo spuštěno. Exact tři failure
jsou výhradně success `GLOBAL_RESET` fixture případy bez úplného migračního
plánu; nejde o production finding. Tento neúspěch ani artefakty se nemažou.

Zachovaný Review A attempt nad S4_R3 má offline-install log SHA-256
`dc1bf1385e408680dafd4b9b206bf2b42279fcef864956ed7fe0fac5a30eedea`,
946 B; mutation-control log SHA-256
`73ef529df8b7d93e0a1f07a93f09afc4edb4b7516bc1f9e2e2e9975173356b79`,
1647138 B, očekávaně RED; policy log SHA-256
`cd425569dd928035a09a57811ae3fb641fb01ecf1c24c411a3934696a256b77f`,
157437 B, 41 PASS / 0 FAIL; schema log SHA-256
`41d276c7d752ecc1ec199e47798df1c5b4a3b960695ad737172e5195e35cd72b`,
522245 B, 23 PASS / 4 FAIL. Zbývajících sedm sad a mobile late-insertion nebylo
spuštěno. Čtyři failure jsou pouze sedm stale, neukotvených regex očekávání nad
exact emitted prefixy `MODEL_FAILOVER_TERMINAL_INTENT_PROJECTION_MISMATCH`,
`MODEL_FAILOVER_TERMINAL_RECEIPT_PROJECTION_MISMATCH` a
`MODEL_FAILOVER_TERMINAL_EVENT_RECEIPT_MISMATCH`; nejde o production finding.
Neúspěch ani artefakty se nemažou.

Zachovaný fresh Review A attempt nad L2 =
`e6ecc068724a03ebcebf278e4de0ed374a02038d` má offline-install log SHA-256
`9d2559791d4c3f4574f520f6a7bd09a33cc2f02396f829fb86ad9900ad1d9b3b`,
943 B; mutation-control log SHA-256
`3c9b36157f9d0969fb77dc61c89a9bccc28d6ff058b378fafd4f0521210ce1bd`,
1647124 B, 106 PASS / 1 expected FAIL / 0 unexpected, tedy kontrola RED; policy
log SHA-256
`d0108323f4dbe14bd906b0f063296971363409d667c83ff8e77540139a404a5b`,
157437 B, 41 PASS / 0 FAIL; schema log SHA-256
`8eebe5fbe7a7226c717e36463b7609b37aed37d166ec636454ed6a2442ff5404`,
581546 B, 27 PASS / 0 FAIL; repository log SHA-256
`0106329a0faf2e1cf6740401b1d1d58c304e02eea8cde4361f944318165efb2f`,
355306 B, 20 PASS / 1 FAIL / 0 unexpected process errors. Zbývajících šest
sad a mobile late-insertion nebylo spuštěno. Failure prokazuje production
defect: manual supersede eligibility se po desired revision 1 -> 2 chybně váže
na mutable current desired singleton místo na immutable desired lineage
incidentu. Verdict je `CHANGES_REQUIRED`, test-only lane je `STOP` a tento
neúspěch ani jeho artefakty se nemažou.

### Phase-A TEST-ONLY STABILIZATION LANE

Per-commit „poslední corrective“ cap se nahrazuje jednou bounded lane. Od
immutable S4_R3 smí vzniknout nejvýše osm sekvenčních corrective children.
Každý child musí mít jediného parenta předchozího lane tipu a změnit právě jednu
z těchto devíti již existujících allowlistovaných cest:

- `tests/m1-model-policy.test.js`;
- `tests/m1-model-failover-schema.test.js`;
- `tests/m1-model-failover-repository.test.js`;
- `tests/m1-model-failover-coordinator.test.js`;
- `tests/m1-model-binding-application.test.js`;
- `tests/m1-model-failover-proof-policy.test.js`;
- `tests/m1-model-failover-parent-acceptance.test.js`;
- `tests/m1-model-failover-proof-issuer.test.js`;
- `tests/schema-migrations.test.js`.

Production tree L1 a L2 je byte-identický se S4. L1 =
`dbb39d77bd3ce92e9921d1b2d49b8825e146cd80` změnil pouze
`tests/m1-model-failover-schema.test.js` přesně sedmi ukotvenými regex změnami.
L2 změnil pouze tutéž test path čtyřmi fixture/oracle opravami. Oba jsou
immutable přímí lane children a spotřebovali dva z nejvýše osmi povolených
children. L2 odkryl production defect, takže lane se podle své stop condition
zastavil; zbývajících šest children se nesmí použít před independently reviewed
P1.

Každý případný post-P1 lane child musí mít jediného parenta předchozího tipu,
změnit právě jednu cestu z allowlistu výše a vzniknout pouze jako přímá odpověď
na zachovaný fail-fast artefakt předchozího fresh Review A attemptu. Smí opravit
jen fixture, assertion nebo oracle tak, aby odpovídal již přijatému product
kontraktu. Je zakázané oslabit očekávání, přidat skip/quarantine, smazat případ
nebo snížit počet assertions/scénářů. Jeho production tree musí být
byte-identický s independently reviewed P1. Zakázaná je jakákoli source, docs,
registry, package/lock nebo nová test path. Independent reviewer staticky ověří
každý child a poté spustí nový fresh fail-fast Review A attempt. Lane se znovu
zastaví při dalším production findingu, potřebě scope/contract změny nebo po
vyčerpání zbývajících šesti children bez úplného PASS.

### Phase-A PRODUCTION REMEDIATION P1

G9 neobsahuje behavior a sám P1 neimplementuje. Až po independent review `PASS`
G9, canonical fast-forwardu a adopci M9 je autorizovaný právě jeden production
remediation child `P1`. P1 musí být direct child M9 a smí změnit právě tyto dvě
již allowlistované existující cesty:

- `src/db/migrations/2026_08_12_065_model_failover_target.js`;
- `tests/m1-model-failover-schema.test.js`.

Dosud nepromovaná migrace 065 se opraví in-place; nevznikne nový ordinal,
migrace ani cesta. Manual supersede eligibility musí přežít desired update
revision 1 -> 2. Prior model name a digest se odvodí výhradně z append-only
current-incident eventu; exact unique `DETECTED` origin a incident/current event
tuple zůstávají povinné. Prior canonical autorita má dvě phase-alternating
větve:

1. při admission, než je `NEW` operation viditelná, ji dodá exact singleton
   desired na `incident.desired_revision`; existující
   `trg_model_binding_operations_current_projection` současně fail-closed váže
   `NEW.previous_model_name`, `NEW.previous_canonical_name` a
   `NEW.previous_digest_sha256`;
2. po posunu singletonu ji dodá pouze immutable append-only přijatá
   `model_binding_operations` transition. Ta je způsobilá jen při exact shodě
   role, expected revision a previous model+digest s current incident eventem a
   committed revision, target, source, actor i desired-event lineage s novým
   desired singletonem.

Implementace smí použít `COALESCE` těchto dvou canonical zdrojů jen s povinnou
equality, jsou-li bezprostředně po operation insertu před desired update
přítomné oba; po update zůstává pouze immutable transition. Je zakázaná SQL
recanonicalizace, odstranění canonical kontroly nebo závislost eligibility view
na mutable starém-revision desired singletonu po jeho posunu.

Oprava musí zachovat fail-closed operation/event/state/supersede CAS, fencing
neuzavřeného terminal intentu, append-only audit, jedinou atomickou transakci a
prohru každého late finalize po vítězném supersede. Focused schema-test důkaz
musí obsahovat pozitivní případy pro incidenty `DETECTED`, `ACTIVATED`, `FAILED`
a unresolved intent. Negativní případy musí zahrnout forged old
model/digest/canonical nebo expected revision; transition target/source/actor/
desired-event mismatch; chybějící nebo chybný terminal supersede operation,
binding operation, event, role, episode, row-version nebo created-at;
preexisting terminal receipt; closed/ineligible state. Každý
musí abortnout a prokázat atomický rollback: desired zůstane na staré revision,
nevznikne nová operation, `DESIRED_CHANGED`/`SUPERSEDED` event ani supersede row
a incident+claim tuple zůstane beze změny. Po úspěšném supersede musí late
finalize abortnout typovaně `MODEL_FAILOVER_TERMINAL_SUPERSEDED`, zachovat novou
desired revision i již committed operation/event/supersede lineage a nevytvořit
terminal finalize receipt ani další state/event mutation. Existující
`tests/m1-model-failover-repository.test.js` zůstane byte-identický s L2 a jeho
dosavadní failing případ je povinný nezměněný pozitivní witness: expired
unresolved `ACTIVATE` -> atomický user supersede -> late finalize typovaně
`TERMINAL_SUPERSEDED`.

P1 nesmí změnit auth/access/trusted-local hranici, route, veřejné API, request
ani response schema, schema ordinal, jinou source/test cestu, registry,
package/lock ani závislost. Nesmí rozšířit allowlist nebo zavést nový runtime
owner/effect. Writer smí předat pouze static evidence; independent reviewer musí
ověřit exact two-path diff, invariants a test-strength, než se obnoví fresh
Review A a případně zbývající test-only lane.

Adopce amendmentu zachová již existující source commity i refy beze změny:

1. `G9` je one-file docs-only direct child exact `G8`; po independent `PASS`
   se canonical integration posune pouze fast-forwardem `G8 -> G9`;
2. L1, L2 a L2 `CHANGES_REQUIRED` Review A attempt zůstávají immutable;
3. governance adoption merge `M9` má ordered parents exact `[G9,L2]`; jeho WP
   blob je byte-identický s G9 a všechny non-WP cesty jsou byte-identické s L2.
   M9 nesmí obsahovat behavior, source, test ani jinou docs změnu;
4. P1 je jediný direct child M9 s production změnou a přesně dvěma cestami
   vymezenými výše. Až po jeho independent static `PASS` smí navázat nejvýše
   šest zbývajících test-only lane children; poslední skutečně potřebný tip je
   `S_FINAL`;
5. existující `wp/m1-model-terminal-failover-20260812` smí fast-forwardovat přes
   M9, P1 a případnou zbývající lane. L2 ani žádný starší commit se nepřepisuje.

Phase A Review A posuzuje exact `G9..S_FINAL`; writer není reviewer. Po
S_FINAL nesmí přistát žádná další source, test ani governance-doc změna;
jedinou tracked výjimkou je rezervovaný report. `A_EA` je report-only direct
child S_FINAL a obsahuje exact `phaseA.integrationRef`,
`phaseA.baseRevision=G9`, `phaseA.subjectHead` a `phaseA.reviewA.verdict`.
Candidate `A_C` má ordered parents exact `[G9,A_EA]`, strom byte-identický s
`A_EA`; `A_EB` je direct child `A_C` a byte-exact připojí pouze
`phaseA.candidateHead` a `phaseA.reviewB.verdict`. Teprve metadata gate dovolí
fast-forward canonical integration na `A_EB`.

**Phase A — implementation evidence:** offline deterministic matrix,
source-closure, mobile late-insertion, report DAG a fresh clone. Nespouští GPU,
Ollamu proti skutečnému modelu ani user-data effect.

**Phase B — execution evidence:** začíná až po Phase A promotion a přijetí
jednoho digest-bound `M1-EXECUTION-MANIFEST`. Exact measurement revision musí
obsahovat `A_EB`; její tree, execution-manifest SHA-256 a digest každého raw
artefaktu jsou provenance. Jeden disposable file-backed DB/runtime smí provést
exact target/desired happy path proti lokální Ollamě a vydat potřebné proofy.
Failure/race matrix zůstává test-owned, user DB/config se nemění a failure
artefakty se zachovají.

`B_S` je report-only direct child exact measurement revision. Zachová celý
`A_EB` report byteově jako prefix, přidá neprázdný measured payload s exact
per-artifact SHA-256/byte length a zakončí jej exact-once klíči
`phaseB.integrationRef`, `phaseB.reportBaseRevision`,
`phaseB.measurementRevision`, `phaseB.measurementTree`,
`phaseB.executionManifestSha256` a `phaseB.artifactManifestSha256`. Payload
nesmí používat line-start namespace `phaseA.`/`phaseB.`. `B_EA` je direct child
`B_S` a připojí pouze `phaseB.subjectHead` a `phaseB.reviewA.verdict`.
Independent candidate `B_C` zachová report blob z `B_EA`; `B_EB` je direct
child `B_C` a připojí pouze `phaseB.candidateHead` a
`phaseB.reviewB.verdict`. Všechny obálky používají byte-exact
`assert_report_same`, `assert_report_append` nebo `assert_report_extension` z
`CONTRACT.md`; Phase B nesmí zpětně měnit Phase A prefix ani source tree.

```text
G7 + S4_R2 -> M7([G7,S4_R2]) -> S4_R3(CHANGES_REQUIRED)
G7 -> G8 -> canonical; G8 + S4_R3 -> M8([G8,S4_R3])
M8 -> L1 -> L2(CHANGES_REQUIRED; production defect; test-only lane STOP)
G8 -> G9 -> canonical governance amendment
G9 + L2 -> M9([G9,L2]) -> P1 -> L3 -> ... -> L8(max) = S_FINAL -> A_EA
G9 + A_EA -> A_C([G9,A_EA]) -> A_EB -> canonical Phase A
accepted M1-EXECUTION-MANIFEST
measurementRevision(contains A_EB) -> B_S -> B_EA
current integration + B_EA -> B_C -> B_EB -> canonical Phase B
```

B4 se nesmí otevřít po samotném `A_EB`; odemyká jej až metadata-ověřený a
canonical fast-forward promováný `B_EB`.

## 7. T3 resource envelope

Je autorizovaný právě jeden registrovaný sériový T3 běh na RTX 3090 pro
`qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
`num_ctx=4096`, headroom nejméně `1024 MiB`, GPU residency `100 %` a fallback
zakázaný. Měří cold, warm, classify a mid-generation cancel. Preflight vyžaduje
prázdný `ollama ps` a žádný compute proces. Pull/delete/stop/unload/rebind jsou
zakázané; cleanup je pouze přirozená expiry. Historický `8192 FAIL` zůstává
zachovaný. Běhy jsou serializované, artefakty disk-backed mimo `/tmp` a po
každé fázi se ukončují pouze test-owned process groups.

### 7.1 Corrective T3 po doloženém headroom FAIL

První skutečný T3 běh nad exact `A_EB` skončil po úspěšných modelových
voláních typovaně `GPU_PILOT_POST_CALL_HEADROOM_UNSAFE`: preflight měl nula
načtených modelů, nula compute procesů a `22719 MiB` volné VRAM, model měl
exact digest a `100 %` residency, ale `f16` KV cache pro `num_ctx=4096`
zanechala pouze `188 MiB` místo požadovaných `1024 MiB`. Přirozená expiry
vrátila nula načtených modelů, nula compute procesů a `22740 MiB` volné VRAM.
Artefakt `m1-model-gpu-pilot.json` má SHA-256
`92befe7a3f5a4e28eedbbfd61c5abaaf32bab00c16d94ede00b76ed993abfb8e` a
nesmí být nahrazen, přepsán ani vydáván za PASS.

Je autorizovaný právě jeden nový corrective T3 běh se stejným modelem,
digestem, `num_ctx=4096`, prompt/cancel scénáři, `100 %` residency a limitem
`1024 MiB`, ale přes izolovaný test-owned loopback Ollama proces s
`OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_FLASH_ATTENTION=1`, jedním paralelním
requestem, jedním načteným modelem a zakázaným cloudem. Proces používá
existující lokální model store pouze pro čtení, vlastní privátní `HOME`,
exact `http://127.0.0.1:11434` a musí být po přirozené expiry ukončen. System
Ollama musí být před handoffem prázdná, jednou korektně zastavená a po
ukončení test-owned procesu znovu spuštěná z nezměněného unit souboru a
environmentu; žádný načtený model se tímto handoffem nesmí unloadnout.
Konfigurace služby a user data se nemění. Před corrective během musí být GPU
bez compute procesu; po běhu musí být system provider, test-owned provider i
GPU opět prázdné. Pull/delete/rebind a změna modelu, digestu,
contextu nebo acceptance limitu zůstávají zakázané. Corrective FAIL je
terminální pro B3 Phase B a nesmí se opakovat; corrective PASS zachovává oba
artefakty a dovoluje pokračovat přesně zbývající manifest-bound sekvencí bez
opakování již dokončeného credential apply.

První launcher corrective pokusu na samostatném portu skončil před provider
efektem stavem `BLOCKED` / `provider-not-exact-loopback-http`; jeho artefakt
SHA-256 je `2663c8de682d8b8a549ffe908c2aa4b296488b790be6c30badcae6fbe3f92196`
a zůstává zachovaný. Tento pre-effect BLOCKED launcher není corrective T3
behavior run. Je povolen právě jeden následný běh přes výše uvedený exact-port
handoff; jeho FAIL/BLOCKED je terminální a bez dalšího pokusu.

### 7.2 Terminální výsledek Phase B

Exact-port corrective behavior run skončil bez retry terminálně `FAIL` ve fázi
`cold-answer`: gateway po `44999 ms` typovaně timeoutnul ještě před dokončením
první odpovědi. Jeho artefakt má SHA-256
`3e60814fcf87bb30bf763c852a3094a078d3ddd4cc74d92da8343e6b7f7487dc`.
Provider poté přirozeně přešel na nula načtených modelů a nula compute procesů;
test-owned proces byl ukončen a system Ollama obnovena aktivní a prázdná.
Aktuální raw unit soubor má SHA-256
`b15f3fd1b35239683c73eb5cbc4523693de453f08582c2ee7165315c0f893adc`
a mtime/ctime `2026-03-07 20:40:04.557722082 +0100`. Pre-handoff artefakt
`a7e9331b59584b7803552e96601309264876fb4f201a1a90ee24d1ac6fab3e6f`
je hash dynamického `systemctl show` projectionu včetně PID/start-time, nikoli
raw unit bytes; proto byte-identical pre/post raw-unit shoda není z bundle
nezávisle prokázaná. Nebyl spuštěn žádný unit-file edit příkaz.

Jednorázová neakceptační diagnostika navíc potvrdila, že vypnutí CUDA graphs
neřeší host resource envelope: exact model při `f16`, `num_ctx=4096` a `100 %`
residency dokončil jediný token až za `54836 ms` a ponechal pouze `179 MiB`
volné VRAM. M1 tedy na tomto jediném desktopem sdíleném RTX 3090 nemůže
současně splnit `44999 ms` cold gate a `1024 MiB` headroom bez headless GPU
handoffu nebo změny model/digest/acceptance kontraktu. Ani jedno není provedeno.

Credential apply byl před T3 proveden právě jednou, bez retry, s výsledkem
11 TRANSFER / 0 EXPORT / 0 PURGE. Reviewer provedl samostatný read-only
post-census a oznámil nula findings, ale jeho raw post-census artefakt není ve
failure bundle; tento bundle tedy nezávisle dokládá pouze apply output a
resulting canonical/historical environment a DB hashe uvedené v summary.
Disposable seed commitnul 60 migrací, policy revision 2 ON, CHAT
desired revision 1 a target revision 0; lokální seed runner následně chybně
očekával oracle `OBSERVED` místo skutečného `CREATED`, ale read-only postcheck
potvrdil committed exact stav a seed efekt se neopakoval. DESIRED/FALLBACK
proofy, target CAS, detection, ACTIVATE, RESTORE a celý B3 Phase-B report DAG
jsou kvůli terminálnímu T3 FAIL `NOT RUN`; B4 a Gate 1 zůstávají zamčené.

Privátní failure bundle
`m1-b3-phaseb-execution-20260812TXXXXXXZ.Q29oJSdh` má artifact manifest
V2 SHA-256 `122af434d4f492a385d91dfb05ca675eb9b5fee8fc25c3bb2e50b0a86a85dcaa`
a truth amendment SHA-256
`4a7507bfde1b6fed22ac2ed77ee50242484fb9cfd3f4b620f3590713710d8fe1`
a zachovává původní manifest SHA-256
`4422f21840218953f150b6de7f808567bb8893d64073a14be65e512e10868fb0`
a jeho původní nepřesný unit claim jako superseded evidence. V2 bundle
zachovává oba FAIL artefakty, pre-effect BLOCKED, credential výstup,
disposable seed/postcheck i diagnostiku. Tento výsledek není Phase-B PASS a
nesmí vytvořit `B_S`, `B_EA`, `B_C`, `B_EB` ani canonical Phase-B promotion.

## 8. Stop conditions a acceptance

Zastavit dotčenou část při nové veřejné capability/connectoru, změně L0,
auth/access/trusted-local hranice, external network effectu, potřebě
pull/delete/rebind, nevratném user-data zásahu, změně support claimu, nové
dependency nebo neřešitelném source conflictu. Vada uvnitř allowlistu se opraví
a nezávisle zreviewuje; rozšíření allowlistu vyžaduje vlastní dřívější docs
commit.

Acceptance vyžaduje exact target CAS a clear, zero-effect negativní matici,
single-winner races, proof expiry, user supersede, restart/rehydrate, uncertain
finalize reconciliation, exact desired restore, úplnou source closure, mobile
late insertion, Review A/B PASS a čistý candidate tree. Gate 1 zůstává
`BLOCKED`, dokud navíc nedoběhne B4 a jeho evidence; tento aktivační commit
sám neprokazuje žádný z těchto výsledků.
