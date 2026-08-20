# 037 — H0 V5 PRESEAL CHANGES_REQUIRED a jediná same-root core remediation

- **typ:** docs-only failure binding a bounded private-static remediation
- **stav:** `V5_PRESEAL_CHANGES_REQUIRED / UNSEALED / DO_NOT_EXECUTE /
  NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / I5:**
  `d9070abc2e29550db1d689ae48f8c4c33f9869eb`
- **baseTree:** `becad95a2e177a6a8de7fac5958a35fed5dc57b0`
- **předpoklad:** promovované decisions 033–036 a immutable V4 evidence
- **výsledek subjectu:** pouze authority k autentickému red recorderu a právě
  jedné opravě tří core souborů ve stejném existujícím V5 rootu; žádný runtime

## 1. Proč je nový decision nutný

Decision 036 dovolil jedinou V5 materializaci a před sealem vyžadoval distinct
independent review. Ten review skončil `CHANGES_REQUIRED`: řádky 459–462
decision 036 říkají, že red verdict zachová root unsealed, spotřebuje one-shot
authority a zastaví pokračování; řádky 551–556 stejnou hranici opakují jako
stop condition. D036 proto nedovoluje ani edit core, ani seal, ani druhý root.

Formální reviewer `/root/v5_formal_preseal_review` nad frozen core našel
deterministický P1. `validate_budget_contract()` používá tři jména
`client_safety_partial_show_calls`,
`client_safety_full_retry_show_calls` a
`client_safety_show_calls`, která jsou lokální pouze v jiné funkci
`recalculate_v5_budget_contract()`. Povinný budget observation proto skončí
`NameError` před control effectem. Reviewer vydal `CHANGES_REQUIRED`,
`P0=0 / P1=1`, runner neimportoval ani nespustil a recorder nevytvořil.

Následný read-only shadow audit uzavřel celý frozen snapshot jako
`P0=0 / P1=5`:

1. povinný budget validator má uvedené unresolved cross-scope reads;
2. embedded author result nepravdivě tvrdí source-derived maxima a jednotlivé
   provedení všech 26 mutací, zatímco externí helper převážně porovnává
   pomocné listy/dicty nebo tautologie a mutované core bytes relevantnímu
   checkeru nepředává;
3. runtime SHA dominance přeskakuje durable
   `outer-runtime-cleanup.json` mezi removal a postflight;
4. budoucí static receipt byte-hashuje opaque Review A/B artefakty, ale
   nereprezentuje ani nevynucuje required distinct reviewer identity;
5. one-root invariant důvěřuje plan booleanu a runner ve třech povinných
   hranicích neenumeruje private parent pro any-type V5 sibling.

Žádný finding se nesnižuje na author-tool incident ani na PASS. V5 je
`UNSEALED / CHANGES_REQUIRED / DO_NOT_EXECUTE` a tento decision nejprve musí
projít vlastním review/promotion DAG.

## 2. Exact frozen failure evidence

Existuje právě jeden V5 materialization root:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74

Jeho birth time je
`2026-08-18 10:32:50.000727718 +0200`, tedy exact
`2026-08-18T08:32:50.000727718Z`; basename `T083250Z` je birth-time-honest.
Root a `plan/`, `runner/`, `strategy/`, `evidence/` jsou `0700`, UID/GID
`1000/1000`, nlink `1`. `evidence/` je empty. Detached digesty,
materialization manifest, manifest digest, marker i seal neexistují.

| Core cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v5-plan.json` | `c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca` | 128 493 | `0400` |
| `runner/run-h0-v5.py` | `0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb` | 619 441 | `0500` |
| `strategy/rustdesk-v5-strategy.json` | `26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d` | 67 666 | `0400` |

Externí author helper `/tmp/v5_author_harness.py` měl při auditu SHA-256
`ffb861ff9ad65dfc223150f929f683ede2e9b70a7f788297357e07a7c4209c9a`.
Je non-authoritative tooling, není součást rootu ani durable proof. Jeho green
summary nesmí být použit jako preseal evidence.

## 3. Co tento decision dovoluje — a až po promotion

Promované `E_B_H0V5R` dovolí výhradně tento sled:

1. původní red reviewer vytvoří autentický durable external red recorder nad
   exact OLD snapshotem;
2. po jeho rehashi proběhne právě jedna bounded repair transaction nad třemi
   existujícími core paths v tomtéž rootu;
3. opravené core se zmrazí ve stavu
   `REPAIRED_IN_PLACE_AWAITING_FRESH_INDEPENDENT_PRESEAL_REVIEW_D037`;
4. nový distinct reviewer provede fresh preseal od nuly;
5. pouze exact `PRESEAL_READY` s `P0=0 / P1=0` znovu otevře původní D036 seal
   continuation.

Authority je přesně:

    EXACTLY_ONE_SAME_ROOT_THREE_CORE_REPAIR_TRANSACTION
    NO_SECOND_ROOT
    NO_SEAL_UNTIL_FRESH_PRESEAL_READY
    NO_RUNTIME_AUTHORITY

Nevzniká authority pro druhý root, cleanup/recreate, evidence write, detached
digest, manifest, seal, runner import/execute, `/run`, systemd/service,
SSH/logout, Ollamu, GPU/model, H0 runtime, retry, T3, Gate, push, tag, release
nebo history rewrite.

### 3.1 Canonical task registry

Identity se nesmí odvozovat jen z Git autora, chatu nebo prose designation.
Decision037 exact rezervuje tyto task identity:

| Role | Exact task |
|---|---|
| Decision037 writer a coordinator | `/root` |
| Decision036 writer | `/root/decision036_writer` |
| Decision037 Review A | `/root/decision037_review_a` |
| Decision037 Review B | `/root/decision037_review_b` |
| původní formal red reviewer | `/root/v5_formal_preseal_review` |
| same-root repair materializer | `/root/v5_materializer` |
| fresh repaired-core preseal reviewer | `/root/v5_d037_fresh_preseal_review` |
| post-seal Review A | `/root/v5_d037_postseal_review_a` |
| post-seal Review B | `/root/v5_d037_postseal_review_b` |

Decision037 writer, Review A a Review B jsou tři různé identity; obě review
začnou od nuly a nesdílejí author checker state. Identity collision zastaví
candidate i promotion. Budoucí repaired plan parser čte tento exact registry z
promoted Decision037 bytes a porovnává jej se structured recorder/static
receipt poli; Git author nebo chat label není náhradní zdroj.

## 4. Autentický red recorder před prvním editem

Po promotion a před chmod/edit musí původní identity
`/root/v5_formal_preseal_review` vytvořit právě jeden birth-time-honest external
recorder pod owner-only private parentem. Basename je exact
`m1-h0-v5-preseal-red-review-d037-YYYYMMDDTHHMMSSZ.<suffix>`, kde UTC sekunda
je skutečný birth second a suffix má právě osm `[a-z0-9]`; any-type prefix
absence se ověří těsně před jediným exclusive mkdir. Root je `0700`; obsahuje
právě tři regular files `0400`, UID/GID `1000/1000`, nlink `1`:

- `review-result.json`;
- `artifact-manifest.json`;
- `artifact-manifest.sha256`.

`review-result.json` je strict duplicate-key-free canonical JSON s exact
`schemaVersion=1`, kind
`H0_V5_D037_FORMAL_PRESEAL_RED_REVIEW_RESULT`, designation
`FORMAL_V5_PRESEAL_REVIEW_D036_RED_PRESERVED_BY_D037`, role
`independent-preseal-red-recorder` a exact váže:

- reviewer task `/root/v5_formal_preseal_review`, designation a roli;
- I5/tree, sole V5 root path, birth time a root/subdir identity;
- všechny tři OLD core paths, SHA-256, bytes, modes, uid/gid/nlink;
- empty evidence a absenci detached/manifest/seal;
- `verdict=CHANGES_REQUIRED`, `p0Count=0`, `p1Count=1`;
- finding `P1-BUDGET-CROSS-SCOPE-NAME` včetně producer/consumer callsites a
  deterministického pre-effect dopadu;
- promoted `E_B_H0V5R` commit/tree, Decision037 decision/WP SHA, exact four
  subject blobs, report path/blob/SHA/bytes a celý I5/S/E_A/C/E_B DAG;
- `runnerImportedOrInvoked=false`, `runtimeEffects=NONE` a nulovou další
  authority.

`artifact-manifest.json` má exact `schemaVersion=1`, kind
`H0_V5_D037_FORMAL_PRESEAL_RED_ARTIFACT_MANIFEST`, váže result file, recorder
root/birth a exact closure a self-excluduje sebe a svůj detached digest.
`artifact-manifest.sha256` exact váže manifest. Pokud původní reviewer není
dostupný, prefix už any-type existuje, bytes nebo identity nesedí, recorder už
existuje, nebo se kdokoli pokouší autorství napodobit, workflow se zastaví.
Chat message není durable recorder.

## 5. Jediná bounded same-root repair transaction

Po exact red recorder gate smí repair materializer změnit pouze:

    plan/h0-v5-plan.json
    runner/run-h0-v5.py
    strategy/rustdesk-v5-strategy.json

Root i čtyři podadresáře musí zůstat stejná zařízení/inody. Core soubory musí
zůstat na stejných paths, bez symlinku a s nlink `1`; before identity se
zaznamená před otevřením a after identity po finálním fsync. Dočasné otevření
mode je omezené na plan/strategy `0600` a runner `0700`; finální modes jsou
znovu `0400`, `0500`, `0400`. Partial failure spotřebuje repair authority,
zachová root unsealed a nedovolí druhý pokus.

Repair nesmí vytvořit čtvrtý core file, sidecar, cache, bytecode, temp ve V5
rootu ani evidence artifact. Author tooling musí být mimo root, nesmí runner
importovat/spustit a není authority. Všechny OLD a NEW SHA/bytes/modes,
inode/stat přechody a tooling failures se zachovají v handoffu a fresh preseal
resultu.

### 5.1 Budget validator a undefined-name gate

Source-derived calculator vrátí partial/full/combined safety-show facts ve
svém calculated objektu, nebo je validator nezávisle lokálně odvodí z exact
source structure. `validate_budget_contract()` nesmí mít unresolved global
load. External no-import AST + `symtable` gate musí prokázat nulové undefined
names ve všech reachable validator funkcích.

Fresh interprocedural derivation musí reprodukovat exception/finally maximum
`1 + 13 = 14`, client quiescence `255 s`, command maxima, phase sums a všechny
strict inequalities před porovnáním s plan contractem. Literal nebo expected
map není source derivace.

### 5.2 Pravdivé mutation evidence

False `PASS`, `allCasesExecutedIndividually=true` a
`derivedBeforeComparedToContract=true` se z core odstraní, pokud nebyly
skutečně prokázány. Přípustné jsou jen dvě pravdivé varianty:

- `NOT_RUN/UNVERIFIED`, bez PASS claimu; nebo
- non-authoritative author result, který pro každý z původních 26 fixtures
  skutečně vytvoří isolated byte-distinct runner/plan/strategy/closure mutant,
  zaznamená input SHA, mutant SHA a diff, spustí relevantní production-equivalent
  no-import checker a uloží jeho exact fail-closed reason.

Každý source mutant musí projít `ast.parse`, pokud fixture záměrně netestuje
syntaktickou vadu. JSON mutant je strict duplicate-key-free a je předán
stejnému projection/semantic checkeru jako pozitivní bytes. F09 má jednotlivé
subcases pro manifest, digest, marker a exit. F13 používá exact stale
osmiprvkovou V3 mapu a přepočítá všechny interní digests. F23 skutečně ověří
any-type sibling v izolovaném parentu. Author výsledek je i potom
non-authoritative; fresh reviewer všech 26 znovu vytvoří nezávisle.

### 5.3 Úplná cleanup SHA dominance

Canonical runtime chain je:

    systemd-run-client-quiesced.json
      -> systemd-run-result.json
      -> outer-terminal-proof.json
      -> outer-runtime-dir-removed.json
      -> outer-runtime-cleanup.json
      -> outer-postflight.json
      -> result-pending-seal.json
      -> artifact-manifest.json
      -> result.json

`outer-runtime-cleanup.json` dostane vlastní exact fixed key list a semantic
contract včetně kind/classification, accepted constants,
`clientQuiescedReceiptSha256` a
`outerRuntimeDirRemovedReceiptSha256`. Postflight nese
`outerRuntimeCleanupReceiptSha256`. Cleanup je v `runtimeShaDominance`, ordered
semantic tuple, runtime-quiesced loop, terminal closure a preseal downstream
loopu. Validator znovu načte durable raw bytes a ověří každý antecedent SHA;
transitive in-memory embedding ani classification/PASS samotné nestačí.

Canonical sorted required-key set pro `outer-runtime-cleanup.json` je exact:

    attemptId
    bootId
    classification
    clientQuiescedReceiptSha256
    clientSealEligibility
    issuesH0Pass
    kind
    outerRuntimeDirRemovedReceiptSha256
    passed
    planSha256
    removal
    retryAuthorized
    schemaVersion
    spawnState
    t3Authority
    terminalAuthority

Constant values jsou exact `schemaVersion=5`,
`kind=H0_V5_OUTER_RUNTIME_CLEANUP`,
`classification=POST_WAIT_TERMINAL_RUNTIME_DIRECTORY_REMOVED`, `passed=true`,
`issuesH0Pass=false`, `retryAuthorized=false` a `t3Authority=false`.
`attemptId/planSha256/bootId` se rovnají active plan contextu;
`clientSealEligibility.classification=CLIENT_QUIESCED`; SHA antecedents jsou
exact `clientQuiescedReceiptSha256 -> systemd-run-client-quiesced.json` a
`outerRuntimeDirRemovedReceiptSha256 -> outer-runtime-dir-removed.json`.
Canonical `outer-postflight.json` required-key set se rozšíří právě o
`outerRuntimeCleanupReceiptSha256`, který se rovná raw SHA tohoto cleanup
receiptu. Jakákoli další/chybějící key nebo odlišná constant value je red.

### 5.4 Reviewer identity jako strukturovaný kontrakt

Budoucí post-seal Review A/B artifact a static receipt musí reprezentovat
`schemaVersion`, `kind`, designation A/B, `reviewerTask`, roli,
`excludedReviewerTasks`, verdict a exact materialization/core/manifest/preseal
bindings. Fresh preseal recorder i final manifest vážou
`presealReviewerTask`.

Každá post-seal identity vytvoří právě jeden external owner-only recorder.
Basenames mají exact prefixy
`m1-h0-v5-postseal-review-a-d037-` a
`m1-h0-v5-postseal-review-b-d037-`, následované birth-honest UTC sekundou,
tečkou a osmi `[a-z0-9]`. Každý root je `0700` a obsahuje právě
`review-result.json`, `artifact-manifest.json`,
`artifact-manifest.sha256` mode `0400` s noncyclic self-excluding manifestem.
Root/file UID/GID je `1000/1000`, nlink `1`; prefix je any-type absent před
exclusive mkdir a recorder se neclobberuje ani nerecykluje.

Review A result má exact `schemaVersion=1`, kind
`H0_V5_D037_POSTSEAL_REVIEW_A_RESULT`, designation
`FORMAL_V5_D037_POSTSEAL_REVIEW_A`, role
`independent-postseal-reviewer-a` a reviewerTask
`/root/v5_d037_postseal_review_a`. Review B používá exact kind
`H0_V5_D037_POSTSEAL_REVIEW_B_RESULT`, designation
`FORMAL_V5_D037_POSTSEAL_REVIEW_B`, role
`independent-postseal-reviewer-b` a reviewerTask
`/root/v5_d037_postseal_review_b`.

Canonical sorted required keys každého A/B resultu jsou exact:

    authority
    coreFiles
    d036FixtureResults
    d036MatrixResults
    d037FocusedFixtureResults
    d037MatrixResults
    d037SubcaseResults
    designation
    excludedReviewerTasks
    kind
    materializationManifest
    materializationRoot
    p0Count
    p1Count
    promotedDecision037Commit
    promotedDecision037ReportBlobSha256
    promotedDecision037Tree
    readyPresealRecorder
    redPresealRecorder
    reviewerTask
    role
    runnerImportedOrInvoked
    runtimeEffects
    schemaVersion
    toolingFailures
    verdict

Exact `excludedReviewerTasks` pro A je sorted set:

    /root
    /root/decision036_writer
    /root/decision037_review_a
    /root/decision037_review_b
    /root/v5_d037_fresh_preseal_review
    /root/v5_d037_postseal_review_b
    /root/v5_formal_preseal_review
    /root/v5_materializer

Pro B je stejný set s
`/root/v5_d037_postseal_review_a` místo B. Vlastní validní task v jeho vlastním
exclusion setu není. `verdict` se odvozuje: pouze `P0=0/P1=0` dává `PASS`,
jinak exact `CHANGES_REQUIRED`. Každý red výsledek stále vytvoří authentic
durable recorder a terminálně blokuje tracked projection/static subject,
acceptance i runtime; finding se nikdy nezahodí ani nepřeznačí na PASS.

Každý result byte-bindne sealed materialization, OLD red a fresh READY
recordery a obsahuje per-row výsledky všech D036 `V5-01..14`, původních 26
fixtures, všech třinácti Decision037 matrix rows, focused parent `F01..F14` a všech 59 mandatory
subcases. Exact counts jsou `14/26/13/14/59`; missing, duplicate, aggregate-only
nebo inherited-only result je `CHANGES_REQUIRED`.

A manifest má exact `schemaVersion=1`, kind
`H0_V5_D037_POSTSEAL_REVIEW_A_ARTIFACT_MANIFEST`; B analogicky kind
`H0_V5_D037_POSTSEAL_REVIEW_B_ARTIFACT_MANIFEST`. Každý strict canonical
manifest váže result file/root/birth/closure, self-excluduje sebe a svůj
detached digest. `artifact-manifest.sha256` má exact grammar
`<64 lowercase hex><two spaces>artifact-manifest.json<LF>` a váže manifest.
Canonical manifest required keys jsou `schemaVersion`, `kind`, `recorderRoot`,
`birthTimeUtc`, `resultFile`, `files` a `selfReferentialExclusions`; `files`
obsahuje právě result, zatímco self-exclusions jsou právě manifest a digest.

Budoucí static-receipt subject vytvoří dvě tracked strict canonical JSON
projekce v exact paths
`docs/execution/runs/wp-m1-h0-v5-postseal-review-a-20260818.json` a
`docs/execution/runs/wp-m1-h0-v5-postseal-review-b-20260818.json`. Každá
byte-bindne svůj external recorder root, reviewerTask a všechny tři file
SHA/bytes/modes; nejde o opaque `.md`. Projection A/B má exact
`schemaVersion=1`, kind
`H0_V5_D037_TRACKED_POSTSEAL_REVIEW_A_PROJECTION` nebo
`H0_V5_D037_TRACKED_POSTSEAL_REVIEW_B_PROJECTION`, designation, reviewerTask,
exact exclusion set, derived verdict, per-row audit counts/results a complete
external recorder closure. Static receipt obsahuje
`reviewATask`, `reviewBTask`, `presealReviewerTask`, tracked projection SHA a
SHA všech tří external recorder files pro obě post-seal identity. Validator
parsuje schema a exact obsah; hash opaque prose nestačí. Vynutí:

- Review A != Review B;
- obě identity != D036 writer/materializer;
- obě identity != D037 writer/Review A/Review B;
- obě identity != repair materializer, původní red reviewer, fresh preseal
  reviewer a coordinator `/root`.

Reviewer identity se nedovozuje pouze z Git authora nebo chatového označení.
Canonical projection required keys jsou exact `schemaVersion`, `kind`,
`designation`, `reviewerTask`, `excludedReviewerTasks`, `verdict`,
`requiredAuditCounts`, `resultsSha256` a `externalRecorder`; unknown nebo
missing key je red.

### 5.5 Skutečná one-root enumerace

Runner otevře private parent přes directory FD bez symlink traversal, fstatem
sváže parent a any-type enumerací vyžaduje právě aktuální basename pro pattern
`m1-h0-headless-no-model-v5-*`. Kontrola proběhne při load, v G0 a znovu v
immediate gate těsně před prvním control effectem. Každá enumerace má
pre/post same-FD identity a rejectuje directory, regular file, symlink i jiný
filesystem type se matching basename. Plan boolean není důkaz.

Izolovaný focused test vytvoří current root placeholder a matching sibling ve
variantách directory/file/symlink; production-equivalent checker musí každou
variantu odmítnout. Test nikdy nemanipuluje live private parent.

### 5.6 Decision037 je nový live static base

NEW plan/runner/strategy exact připnou promoted `E_B_H0V5R` commit/tree,
všechny čtyři subject blobs, reserved report blob a celý I5/S/E_A/C/E_B DAG.
Pole `promotedDecision037Commit`, `promotedDecision037Tree`,
`promotedDecision037ReportBlobSha256` a
`runtimeReceiptContract.staticBaseMustEqualDecision037ReviewB` jsou povinná;
poslední pole má hodnotu exact full `E_B_H0V5R` commit SHA, nikdy boolean.
Samostatné `runtimeReceiptContract.staticBaseTree` a
`runtimeReceiptContract.staticBaseReportBlobSha256` nesou exact tree a report
SHA. D036 zůstává historical prerequisite, nikoli live base.

Source checkout pro repaired core je čistý detached checkout na promoted
`E_B_H0V5R`; tracked path count je 1 614 (I5 1 611 + dvě nové docs + report)
a canonical path-set SHA se odvodí až z exact promoted tree. D037 DAG se
coalescuje do existujících batched Git reads; command/effect budget se přesto
znovu odvodí, nikoli předpokládá.

Plan `presealHistory` immutable váže OLD triple a authentic red recorder. Fresh
PRESEAL_READY result a jeho self-excluding manifest vážou OLD triple, kompletní
red recorder a NEW core, nikoli vlastní budoucí manifest/digest SHA. Až
následný final materialization manifest váže complete tří-file closure obou
recorderů — starého red i nového ready — včetně rootů, reviewerTask a všech
file SHA. Red finding se přepisem core nesmaže a nevzniká self-hash cyklus.

## 6. Fresh preseal, seal a post-seal hranice

Fresh preseal provede nový task od nuly a musí být odlišný od původního red
reviewera, D036 writera/materializera, D037 writera/Review A/Review B, repair
materializera, coordinatora `/root` a budoucích post-seal A/B. Do verdictu je
read-only a runner neimportuje ani nespouští.

Jeho external recorder basename je exact
`m1-h0-v5-preseal-ready-review-d037-YYYYMMDDTHHMMSSZ.<suffix>` se skutečným
UTC birth second a osmi `[a-z0-9]`; any-type prefix je absent před jediným
exclusive mkdir. Root je `0700`, UID/GID `1000/1000`, nlink `1`, a obsahuje
exact tři regular files `0400` bez clobberu.

Result je strict canonical JSON s exact `schemaVersion=1`, kind
`H0_V5_D037_FRESH_PRESEAL_REVIEW_RESULT`, designation
`FORMAL_V5_D037_FRESH_PRESEAL_REVIEW`, role
`independent-preseal-ready-reviewer` a reviewerTask
`/root/v5_d037_fresh_preseal_review`. Verdict je `PRESEAL_READY` pouze při
`P0=0/P1=0`; jinak `CHANGES_REQUIRED`, který se durable zachová a workflow
zastaví. Manifest má exact `schemaVersion=1`, kind
`H0_V5_D037_FRESH_PRESEAL_ARTIFACT_MANIFEST`, váže result/root/birth a
self-excluduje sebe i detached digest; digest používá stejnou exact grammar
jako red recorder.

Exact sorted READY `excludedReviewerTasks` set je:

    /root
    /root/decision036_writer
    /root/decision037_review_a
    /root/decision037_review_b
    /root/v5_d037_postseal_review_a
    /root/v5_d037_postseal_review_b
    /root/v5_formal_preseal_review
    /root/v5_materializer

Canonical sorted READY result keys jsou exact `authority`, `baseRevision`,
`baseTree`, `designation`, `excludedReviewerTasks`, `focusedFixtureResults`,
`kind`, `materializationRoot`, `matrixResults`, `newCore`, `oldCore`,
`originalFixtureResults`, `p0Count`, `p1Count`, `promotedDecision037Commit`,
`promotedDecision037ReportBlobSha256`, `promotedDecision037Tree`,
`redRecorder`, `reviewerTask`, `role`, `runnerImportedOrInvoked`,
`runtimeEffects`, `schemaVersion`, `subcaseResults`, `toolingFailures`,
`verdict`. Exact READY manifest keys jsou `schemaVersion`, `kind`,
`recorderRoot`, `birthTimeUtc`, `resultFile`, `files` a
`selfReferentialExclusions`; `files` obsahuje právě result a self-exclusions
právě manifest a digest.

Result a self-excluding manifest bindnou exact NEW core a kompletní OLD red
recorder, ale nepožadují hash vlastního budoucího manifestu/digestu.
`PRESEAL_READY` vznikne pouze při `P0=0 / P1=0`, exact NEW core
SHA/bytes/modes, validním OLD+red history, všech D036 `14+26` a D037
`13+14+59` per-row výsledcích a nezávislém AST/budget proofu.

Jakýkoli red verdikt zachová root unsealed a terminálně zastaví 037 repair
workflow. Nevzniká další repair ani root. Teprve READY dovolí materializeru
rehashnout nezměněné core a oba recordery a pokračovat původním D036 sealem.
Seal nesmí měnit core; final manifest explicitně váže promoted 037, OLD red a
fresh ready recorder.

Po sealu následují dvě nové distinct post-seal review. Každá začne fresh od
nuly, nezávisle znovu vytvoří mutants a AST/budget/schema proof a nesmí převzít
author ani READY checker state. Teprve dvě PASS mohou
otevřít nový canonical static receipt subject. Ten musí větvit přímo z
promoted `E_B_H0V5R`; Decision037 sama static PASS, acceptance ani runtime
nevydává.

## 7. Decision037 acceptance matrix

Každý řádek je mandatory a chybějící důkaz je `CHANGES_REQUIRED`:

1. `R37-01` — exact I5/tree, sole birth-time-honest unsealed root, OLD triple,
   empty evidence a absence seal/recorder jsou byte-bound;
2. `R37-02` — authentic durable red recorder původního reviewera existuje před
   prvním editem a zachovává formal P1 bez přeznačení;
3. `R37-03` — právě jedna transaction mění pouze tři core files ve stejném
   rootu a zachovává before/after identities i všechny failures;
4. `R37-04` — budget validator nemá unresolved name a fresh derivation
   reprodukuje `1+13=14`, `255 s`, maxima i inequalities;
5. `R37-05` — všech čtrnáct D036 V5 matrix řádků je znovu prokázáno na NEW
   bytes a author claim není náhrada;
6. `R37-06` — všech původních 26 mutací je jednotlivě aplikováno na isolated
   bytes a relevantní checker je odmítne exact reasonem;
7. `R37-07` — cleanup má key/semantic/raw-SHA chain až do postflight/seal;
8. `R37-08` — structured review/preseal identities a všechny required
   nerovnosti jsou projektované i runtime-validované;
9. `R37-09` — load/G0/immediate pre-effect same-FD enumerace prokazuje právě
   jediný live V5 root a any-type sibling je fail-closed;
10. `R37-10` — všechny changed projections/digests/source paths/budgets se
    regenerují z NEW triple a live static base je promoted Decision037;
11. `R37-11` — fresh distinct preseal váže NEW core i OLD red history a vydá
    READY pouze při `P0=0 / P1=0`;
12. `R37-12` — před READY neexistuje detached/manifest/seal/post-seal/static/
    acceptance/runtime efekt a další red workflow zastaví;
13. `R37-13` — authority zůstává NONE pro runtime, retry, model, T3, Gate,
    acceptance, push, tag, release a history rewrite.

## 8. Focused negativní fixtures navíc k původním 26

Každý je byte-distinct, isolated, no-import a musí zčervenat:

1. `R37-F01-UNRESOLVED-CROSS-SCOPE-SAFETY-NAME`
2. `R37-F02-PARTIAL-FULL-COMBINED-EDGE-MISSTATED`
3. `R37-F03-PROXY-FIXTURE-CLAIMS-INDIVIDUAL-EXECUTION`
4. `R37-F04-MUTATION-NOT-FED-TO-RELEVANT-CHECKER`
5. `R37-F05-CLEANUP-QUIESCED-SHA-MISSING-OR-WRONG`
6. `R37-F06-REMOVED-CLEANUP-POSTFLIGHT-ANTECEDENT-WRONG`
7. `R37-F07-CLEANUP-OMITTED-FROM-DOMINANCE-OR-SEAL-LOOP`
8. `R37-F08-OPAQUE-REVIEW-ARTIFACT-WITHOUT-IDENTITY-SCHEMA`
9. `R37-F09-REVIEWER-IDENTITY-COLLISION-OR-OMISSION`
10. `R37-F10-MISSING-FORGED-OR-MISMATCHED-RED-RECORDER`
11. `R37-F11-FOURTH-CORE-SECOND-ROOT-EVIDENCE-OR-REPAIR-RETRY`
12. `R37-F12-PREMATURE-SEAL-OR-SELF-ISSUED-PRESEAL-READY`
13. `R37-F13-STALE-D036-BASE-OR-OMITTED-D037-RED-BINDING`
14. `R37-F14-ANY-TYPE-SIBLING-ENUMERATION-BYPASS`

Parent result `14/14` je nutný, ale nestačí. Fresh reviewer musí vytvořit a
samostatně reportovat každý následující byte-distinct subcase; parametrizovaný
subcase má jeden výsledek pouze pro každou exact hodnotu výslovně určenou jeho
řádkem nebo příslušným A/B `excludedReviewerTasks` setem:

- `R37-SC01A-UNRESOLVED-LOAD` — unresolved validator name;
- `R37-SC01B-LITERAL-GLOBAL-INJECTION` — literal global maskuje derivaci;
- `R37-SC02A-PARTIAL-EDGE-OMITTED` — partial safety edge chybí;
- `R37-SC02B-FULL-EDGE-OMITTED` — full retry edge chybí;
- `R37-SC02C-COMBINED-EDGE-OMITTED` — combined maximum chybí;
- `R37-SC02D-THIRTEEN-MASQUERADES-AS-FOURTEEN` — `13` je vydáváno za `14`;
- `R37-SC03A-BOOLEAN-PROXY` — boolean proxy předstírá fixture;
- `R37-SC03B-NO-BYTE-MUTATION` — input a mutant SHA jsou stejné;
- `R37-SC03C-CHECKER-NOT-INVOKED` — relevantní checker nebyl spuštěn;
- `R37-SC04A-EXPECTED-GRAPH-ONLY-MUTATED` — source bytes zůstaly stejné;
- `R37-SC04B-COPIED-JSON-NOT-FED-TO-CHECKER` — mutated JSON checker nečetl;
- `R37-SC05A-CLEANUP-QUIESCED-SHA-MISSING` — cleanup field chybí;
- `R37-SC05B-CLEANUP-QUIESCED-SHA-WRONG-REHASHED` — wrong value má nový digest;
- `R37-SC05C-CLEANUP-SCHEMA-KEYSET-OR-CONSTANT-DRIFT` — literal cleanup contract se liší;
- `R37-SC06A-CLEANUP-REMOVED-SHA-MISSING` — removed antecedent chybí;
- `R37-SC06B-CLEANUP-REMOVED-SHA-WRONG` — removed antecedent je jiný;
- `R37-SC06C-POSTFLIGHT-CLEANUP-SHA-MISSING` — postflight edge chybí;
- `R37-SC06D-POSTFLIGHT-CLEANUP-SHA-WRONG` — postflight edge je jiný;
- `R37-SC07A-CLEANUP-OMITTED-SEMANTIC-TUPLE` — ordered tuple cleanup vynechá;
- `R37-SC07B-CLEANUP-OMITTED-RUNTIME-DOMINANCE` — dominance map jej vynechá;
- `R37-SC07C-CLEANUP-OMITTED-TERMINAL-LOOP` — terminal closure jej nečte;
- `R37-SC07D-CLEANUP-OMITTED-SEAL-LOOP` — seal preparation jej nečte;
- `R37-SC08A-REVIEW-SCHEMA-MISSING` — structured schema chybí;
- `R37-SC08B-REVIEWER-TASK-MISSING` — task identity chybí;
- `R37-SC08C-PASS-STRING-OR-HASH-ONLY` — opaque PASS nahrazuje parse;
- `R37-SC08D-POSTSEAL-FORCED-PASS` — red counts jsou přepsány na PASS;
- `R37-SC08E-POSTSEAL-RED-RECORDER-DROPPED` — red result není durable zachován;
- `R37-SC09A-POSTSEAL-A-EQUALS-B` — A a B mají stejný task;
- `R37-SC09B-POSTSEAL-A-COLLIDES-EXCLUDED` — A koliduje postupně s každým excluded taskem;
- `R37-SC09C-POSTSEAL-B-COLLIDES-EXCLUDED` — B koliduje postupně s každým excluded taskem;
- `R37-SC09D-MANIFEST-OMITS-PRESEAL-TASK` — manifest task nebinduje;
- `R37-SC09E-STATIC-RECEIPT-OMITS-REVIEW-TASKS` — static receipt identity vynechá;
- `R37-SC10A-RED-RECORDER-MISSING` — authentic recorder neexistuje;
- `R37-SC10B-RED-REVIEWER-TASK-FORGED` — task identity je napodobená;
- `R37-SC10C-RED-OLD-TRIPLE-MISMATCH` — frozen subject se liší;
- `R37-SC10D-RED-D037-AUTHORITY-MISMATCH` — promoted commit/tree/report/DAG se liší;
- `R37-SC10E-RED-CLOSURE-TAMPER` — result, manifest nebo digest je změněn;
- `R37-SC11A-FOURTH-CORE-PATH` — repair vytvoří čtvrtý core file;
- `R37-SC11B-SECOND-V5-ROOT` — existuje další matching any-type root;
- `R37-SC11C-EVIDENCE-WRITE` — evidence přestane být empty;
- `R37-SC11D-REPAIR-RETRY-AFTER-PARTIAL` — po partial následuje retry;
- `R37-SC11E-CLEANUP-OR-RECREATE` — původní root/path je smazán či nahrazen;
- `R37-SC12A-DETACHED-DIGEST-BEFORE-READY` — detached vznikne před authority;
- `R37-SC12B-MANIFEST-BEFORE-READY` — manifest nebo jeho digest vznikne před authority;
- `R37-SC12C-MARKER-OR-SEAL-BEFORE-READY` — marker/seal předběhne review;
- `R37-SC12D-SELF-ISSUED-READY` — materializer sám vydá PRESEAL_READY;
- `R37-SC12E-READY-SCHEMA-KIND-OR-PREFIX-DRIFT` — READY schema nebo birth prefix se liší;
- `R37-SC13A-STALE-D036-LIVE-BASE` — D036 zůstane live static base;
- `R37-SC13B-D037-COMMIT-TREE-REPORT-MISSING` — exact promoted pins chybí;
- `R37-SC13C-D037-DAG-OMITTED` — promoted topology není ověřena;
- `R37-SC13D-OLD-RED-HISTORY-OMITTED` — presealHistory red recorder vynechá;
- `R37-SC13E-BOOLEAN-INSTEAD-OF-EXACT-BASE-SHA` — equality je jen truthy flag;
- `R37-SC14A-MATCHING-DIRECTORY-SIBLING` — sibling je directory;
- `R37-SC14B-MATCHING-REGULAR-FILE-SIBLING` — sibling je regular file;
- `R37-SC14C-MATCHING-SYMLINK-SIBLING` — sibling je symlink;
- `R37-SC14D-MATCHING-OTHER-TYPE-SIBLING` — sibling má jiný filesystem type;
- `R37-SC14E-LOAD-ENUMERATION-OMITTED` — load check chybí;
- `R37-SC14F-G0-ENUMERATION-OMITTED` — G0 check chybí;
- `R37-SC14G-IMMEDIATE-ENUMERATION-OMITTED` — pre-effect check chybí.

Každý řádek nese vlastní input SHA, mutant SHA, mutation description, checker
identity a exact fail-closed reason. Jeden úspěšný disjunkt nesmí zastoupit
ostatní.

## 9. Canonical docs-only subject a report DAG

Subject `S_H0V5R` je direct child I5 a má exact allowlist:

1. `docs/decisions/037-m1-h0-v5-preseal-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-PRESEAL-REMEDIATION.md`

Reserved report je v I5 i S absent:

    docs/execution/runs/wp-m1-h0-v5-preseal-remediation-20260818-report.md

Povinný DAG:

    I5
      -> S_H0V5R
      -> E_A_H0V5R
      -> C_H0V5R
      -> E_B_H0V5R
      -> canonical --ff-only

`E_A_H0V5R` je direct child S a mění pouze report, exact čtyři řádky:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: d9070abc2e29550db1d689ae48f8c4c33f9869eb
    subjectHead: <full-S_H0V5R-sha>
    reviewA.verdict: PASS

Commit může vzniknout pouze taskem `/root/decision037_review_a`, který začal
fresh od nuly a není `/root` ani `/root/decision037_review_b`.

`C_H0V5R` má ordered parents `[I5, E_A_H0V5R]`, je ancestry-bound, má
tree exact E_A a zachová subject/report blobs. `E_B_H0V5R` je direct child C,
mění pouze stejný report a připojí právě:

    candidateHead: <full-C_H0V5R-sha>
    reviewB.verdict: PASS

Commit může vzniknout pouze taskem `/root/decision037_review_b`, který začal
fresh od nuly a není `/root` ani `/root/decision037_review_a`. Orchestrator
task identity se porovná s canonical registry; Git author není náhradou.

`CHANGES_REQUIRED/BLOCKED` nevytvoří candidate, promotion, red recorder ani
private repair authority. Push, force-push, tag, release a rewrite nejsou
povolené.

## 10. Subject verification a stop conditions

Před subject commitem:

    exact HEAD I5 / tree / clean isolated writer worktree
    exact four-path diff; reserved report absent
    OLD root/triple/birth/modes/evidence-empty/no-seal/no-recorder reproduced
    formal P1 and shadow P0=0/P1=5 reproduced from bytes
    every Decision037 matrix ID occurs exactly once in Decision and WP
    every Decision037 focused-fixture ID occurs exactly once in Decision and WP
    every mandatory subcase ID occurs exactly once in Decision and WP
    canonical task registry and D037 writer/Review A/Review B inequality exact
    node tests/artifact-validation.test.js = PASS (151/151 expected)
    node scripts/validate-test-registry.js --json = PASS (382 + 8 expected)
    node tests/repository-hygiene.test.js = PASS (1613 subject paths expected)
    git diff --check = PASS

Tyto gates jsou docs/static. Nesmějí importovat/spustit V5 runner ani způsobit
private, runtime nebo provider efekt.

Zastavit při canonical driftu, odlišném rootu nebo OLD bytes, chybějícím red
recorderu, neautentickém reviewerovi, jiné core path, partial repairu, false
author claimu, kterémkoli P0/P1, druhém rootu, evidence write, premature sealu,
chybějící fresh reviewer identity nebo jakémkoli live effectu.

Pravdivý stav do promoted 037 je:

    V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO_NOT_EXECUTE
    PRIVATE_REPAIR: HOLD
    RUNTIME / ACCEPTANCE / RETRY / T3 / GATES: NO_AUTHORITY

## 11. Transparentní authoring evidence

Dva delegované writer pokusy provedly pouze read-only inventuru a před prvním
editem byly přerušeny; žádné bytes nevytvořily. Tento subject napsal task
`/root`. Jeden read-only `sed` příkaz měl chybný range bez `p`, vypsal error a
byl zopakován správně bez mutation.

První independent precommit audit uzavřel `CHANGES_REQUIRED`, `P0=0/P1=2`
(chybějící vlastní three-task inequality a ready-recorder self-hash cyklus).
Adversarial audit uzavřel `CHANGES_REQUIRED`, `P0=0/P1=6` a rozšířil scope o
D037 authority bind red recorderu, post-seal artifact schema, exact live-base
SHA a mandatory disjunct subcases. Aktuální bytes smějí být commitnuty pouze
po fresh rechecku obou auditů. Precommit checker při read-only diff-checku
vytvořil dva empty `/tmp/d037-*-check.out`; repo/private/runtime bytes to
nezměnilo a tyto soubory nejsou evidence.

Následný zero-based recheck uzavřel původních šest tříd, ale vydal další
`CHANGES_REQUIRED`: precommit `P0=0/P1=1` pro forced-PASS post-seal recorder,
adversarial `P0=0/P1=2` pro neúplné cleanup/post-seal schema a schema review
`P0=0/P1=2` pro READY/post-seal determinismus a příliš širokou SC09
parametrizaci. Tři multi-file/multi-hunk `apply_patch` pokusy pak fail-closed
nenašly exact WP context a každý atomicky nezměnil žádný soubor; oprava byla
rozdělena na malé exact hunks. Current bytes zůstávají uncommitted do dalšího
fresh trojího rechecku.

Třetí fresh trojí recheck uzavřel všechna schema/authority findings a našel
jediný exact-once textový drift: rozsahový shorthand duplikoval první matrix
identifier. Shorthand byl nahrazen prose bez ID; current bytes znovu vyžadují
paritu, repo gate a bounded end-recheck.
