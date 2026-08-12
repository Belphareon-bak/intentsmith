# WP-M1-MODEL-TERMINAL-FAILOVER — terminal automatic failover and restore

**Typ:** zapisující M1 runtime-authority WP · **Slot:** jediný writer v
izolovaném disk-backed worktree

**Rozhodnutí:** [006/D+](../decisions/006-m1-model-auto-rebind-l0.md),
[015/A](../decisions/015-m1-model-failover-proof-policy.md),
[020/E](../decisions/020-m1-model-failover-opt-in-surface.md),
[024/A](../decisions/024-m1-proof-issuer-provenance.md) a
`M1-CLOSEOUT-X1`

**sourceEvidenceRevision:** `6c36607421c013dd27f41e35853009bcaa0b5b51`

**baseRevision:** promoted exact `G6` =
`66e65bf9e326770d945192acfdc305d4b5784164`. Tento one-file governance
amendment `G7` musí být jeho direct child, projít nezávislým review a být
promován výhradně canonical fast-forwardem `G6 -> G7`; teprve exact full SHA
`G7` je Phase A report base.

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

**Stav:** `ACTIVATED / PHASE_A_S4_R2_CHANGES_REQUIRED`. 026 a oba sériové 029
subjecty jsou na exact canonical tipu promovány s Review A/B PASS. S1 až S4_R
zůstávají immutable. S4_R2 =
`39c441afa2f4c926ab5acf279ce4650a17f15636` zachoval očekávaně RED mutation
control, ale jeho Review A attempt skončil `CHANGES_REQUIRED`:
`m1-model-policy` měl 38 PASS / 3 FAIL a dalších osm sad plus mobile
late-insertion zůstalo `NOT RUN`. Exact residual cause jsou tři úspěšné
`GLOBAL_RESET` testy, které používají zkrácenou `createPolicySchema` fixture
místo úplného migračního plánu; jde pouze o test fixture drift bez nového
production findingu. G7 ani adopce S4_R2 nejsou důkazem opravy, celého bounded
programu, nového proofu, GPU residency nebo Gate 1 PASS.

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
7. `S4_R3` — právě jeden poslední test-only corrective commit; smí změnit pouze
   `tests/m1-model-policy.test.js`. Ve třech success `GLOBAL_RESET` případech
   přibližně na řádcích 1377, 1421 a 1961 musí použít úplné
   `await runMigrations(db)` místo `createPolicySchema`; explicit reset sync
   test se změní na async `testAsync`. Migrace 065 se nesmí globálně vrátit do
   legacy fixture a žádná jiná změna není povolená.

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

Source/test historie má se S4_R2 osm fyzických implementačních commitů: S1,
S1_R, S2, S2_R, S3, S4, S4_R a S4_R2. `S4_R3` je devátý a poslední fyzický
commit; nesmí obsahovat production source ani jinou cestu. Historie se
nerebasuje, nesquashuje ani nepřepisuje a S3, S4, S4_R, S4_R2, findingy i
neúspěšné verdicty zůstávají dohledatelné. S4_R3 nerozšiřuje production
behavior, allowlist, auth/access/trusted-local hranici, produkt ani veřejný
connector.

Adopce amendmentu zachová již existující source commity i refy beze změny:

1. `G7` je one-file docs-only direct child exact `G6`; po independent `PASS`
   se canonical integration posune pouze fast-forwardem `G6 -> G7`;
2. S4_R2 a jeho `CHANGES_REQUIRED` Review A attempt zůstávají immutable;
3. governance adoption merge `M7` má ordered parents exact `[G7,S4_R2]`; jeho
   WP blob je byte-identický s G7 a všechny non-WP cesty jsou byte-identické se
   S4_R2. M7 nesmí obsahovat behavior, source, test ani jinou docs změnu;
4. S4_R3 je direct child M7 a mění pouze exact test path výše. Existující
   `wp/m1-model-terminal-failover-20260812` smí fast-forwardovat přes M7 a
   S4_R3; S4_R2 ani žádný starší commit se nepřepisuje.

Phase A Review A posuzuje exact `G7..S4_R3`; writer není reviewer. Po S4_R3
nesmí přistát žádná další source, test ani governance-doc změna; jedinou tracked
výjimkou je rezervovaný report. `A_EA` je report-only direct child S4_R3 a
obsahuje exact `phaseA.integrationRef`, `phaseA.baseRevision=G7`,
`phaseA.subjectHead` a `phaseA.reviewA.verdict`. Candidate `A_C` má ordered
parents exact `[G7,A_EA]`, strom byte-identický s `A_EA`; `A_EB` je direct
child `A_C` a byte-exact připojí pouze `phaseA.candidateHead` a
`phaseA.reviewB.verdict`. Teprve metadata gate dovolí fast-forward canonical
integration na `A_EB`.

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
G6 -> G7 -> canonical governance amendment
G6 + S4_R -> M6([G6,S4_R]) -> S4_R2(CHANGES_REQUIRED)
G7 + S4_R2 -> M7([G7,S4_R2]) -> S4_R3 -> A_EA
G7 + A_EA -> A_C([G7,A_EA]) -> A_EB -> canonical Phase A
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
