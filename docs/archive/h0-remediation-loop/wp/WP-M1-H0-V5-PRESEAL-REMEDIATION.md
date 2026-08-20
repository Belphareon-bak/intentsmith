# WP-M1-H0-V5-PRESEAL-REMEDIATION

**Výsledek:** canonical docs-only binding V5 preseal red snapshotu a jediná
prospective oprava tří core files ve stejném rootu.

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** `d9070abc2e29550db1d689ae48f8c4c33f9869eb`

**baseTree:** `becad95a2e177a6a8de7fac5958a35fed5dc57b0`

**Stav:** `V5_PRESEAL_CHANGES_REQUIRED / UNSEALED / DO_NOT_EXECUTE /
DOCS_ONLY_REMEDIATION_PENDING_REVIEW / NO_RUNTIME_AUTHORITY`

## 1. Vstup a hranice

Decision 036 materializoval právě jeden birth-time-honest V5 root, ale fresh
formální preseal našel deterministický P1 a vydal `CHANGES_REQUIRED`. Podle
D036:459–462 a 551–556 to spotřebovalo one-shot authority a zastavilo edit i
seal. Tento WP proto nejprve vytváří standardní docs review DAG; do promoted
`E_B_H0V5R` je private repair `HOLD`.

Formální review: `/root/v5_formal_preseal_review`, `P0=0/P1=1`, no recorder,
no import/run/effect. Shadow audit: `P0=0/P1=5`. Aggregate je red, ne hlasování.

## 2. Exact frozen subject evidence

Sole root:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74

Birth time je exact `2026-08-18T08:32:50.000727718Z`; root a čtyři poddirs
jsou `0700`, uid/gid `1000/1000`, nlink `1`. Evidence je empty; digesty,
manifest a seal absent.

| Core | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v5-plan.json` | `c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca` | 128 493 | `0400` |
| `runner/run-h0-v5.py` | `0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb` | 619 441 | `0500` |
| `strategy/rustdesk-v5-strategy.json` | `26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d` | 67 666 | `0400` |

## 3. Pět povinných remediací

1. **Budget scope:** `validate_budget_contract()` musí číst source-derived
   partial/full/combined hodnoty z vlastního calculated objektu nebo je
   lokálně odvodit. AST+symtable potvrzuje nulové unresolved reachable names;
   nezávislý calculation stále dokazuje `1+13=14`, `255 s`, všechna maxima a
   inequalities.
2. **Author evidence:** false PASS/individual claims se odstraní. Případný
   author harness je non-authoritative a buď pravdivě `NOT_RUN`, nebo pro každý
   původní fixture vytvoří isolated byte mutant, předá jej relevantnímu
   production-equivalent checkeru a zaznamená input/mutant SHA, diff a exact
   rejection. Fresh reviewer vše opakuje.
3. **Cleanup SHA:** `outer-runtime-cleanup.json` získá exact key/semantic
   contract, quiesced + removed antecedenty a raw SHA edge do postflight;
   vstoupí do ordered dominance, terminal closure a seal preparation.

   Jeho canonical sorted required keys jsou exact `attemptId`, `bootId`,
   `classification`, `clientQuiescedReceiptSha256`, `clientSealEligibility`,
   `issuesH0Pass`, `kind`, `outerRuntimeDirRemovedReceiptSha256`, `passed`,
   `planSha256`, `removal`, `retryAuthorized`, `schemaVersion`, `spawnState`,
   `t3Authority`, `terminalAuthority`. Constant values jsou
   `schemaVersion=5`, `kind=H0_V5_OUTER_RUNTIME_CLEANUP`,
   `classification=POST_WAIT_TERMINAL_RUNTIME_DIRECTORY_REMOVED`,
   `passed=true`, `issuesH0Pass=false`, `retryAuthorized=false`,
   `t3Authority=false`. Context IDs a oba raw SHA antecedents jsou exact;
   postflight povinně nese `outerRuntimeCleanupReceiptSha256`.
4. **Reviewer identity:** post-seal A/B i fresh preseal mají structured
   `reviewerTask`/role/exclusions. Static receipt parser vynutí A != B a obě
   identity odlišné od všech writer/materializer/preseal rolí vyjmenovaných v
   decision 037.
5. **One root:** runner same-FD/dirfd enumeruje private parent při load, G0 a
   immediate pre-effect gate; právě current V5 basename je jediný matching
   any-type entry. Izolovaný test odmítá directory/file/symlink sibling.

## 4. Exact authority po promoted Decision037

Authority je pouze:

    EXACTLY_ONE_SAME_ROOT_THREE_CORE_REPAIR_TRANSACTION
    NO_SECOND_ROOT
    NO_SEAL_UNTIL_FRESH_PRESEAL_READY
    NO_RUNTIME_AUTHORITY

Canonical task registry je exact:

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

Decision037 writer, Review A a Review B jsou tři různé identity. Obě review
začínají fresh od nuly bez author checker state; kolize identity zastaví
candidate i promotion. Git author, chat label ani prose designation nejsou
autoritativní identity source.

Po promotion nejprve původní red reviewer vytvoří authentic external
recorder. Basename je exact
`m1-h0-v5-preseal-red-review-d037-YYYYMMDDTHHMMSSZ.<suffix>`, kde UTC sekunda
je actual birth second a suffix je osm `[a-z0-9]`; any-type prefix musí být
před exclusive mkdir absent. Root je `0700` a obsahuje exact tři regular
files `0400`: `review-result.json`, `artifact-manifest.json`,
`artifact-manifest.sha256`, UID/GID `1000/1000`, nlink `1`.

Result je strict canonical JSON s exact `schemaVersion=1`, kind
`H0_V5_D037_FORMAL_PRESEAL_RED_REVIEW_RESULT`, designation
`FORMAL_V5_PRESEAL_REVIEW_D036_RED_PRESERVED_BY_D037`, role
`independent-preseal-red-recorder`. Byte-bindne I5/tree, sole root, OLD
triple, formal `P1-BUDGET-CROSS-SCOPE-NAME`, `CHANGES_REQUIRED`, no
import/run/effect/authority a také promoted Decision037 E_B commit/tree,
Decision/WP SHA, four subject blobs, report path/blob/SHA/bytes a celý
I5/S/E_A/C/E_B DAG. Manifest má kind
`H0_V5_D037_FORMAL_PRESEAL_RED_ARTIFACT_MANIFEST`, exact closure a
self-excluduje sebe i detached digest. Bez původního autorství, exact schema,
D037 authority bindu nebo noncyclic manifestu se zastaví.

Pak jediná transaction smí změnit jen existující plan/runner/strategy paths.
Root/subdir inody zůstávají; temporary modes smí být jen `0600/0700/0600` a
finální `0400/0500/0400`. Evidence zůstává empty a nevzniká žádný čtvrtý file,
detached digest, manifest ani seal. Partial failure je terminální; cleanup,
retry a druhý root jsou zakázané.

NEW core status je
`REPAIRED_IN_PLACE_AWAITING_FRESH_INDEPENDENT_PRESEAL_REVIEW_D037`.
Plan `presealHistory` váže OLD triple a red recorder. Plan/runner/strategy
současně připnou exact promoted Decision037 E_B commit/tree/DAG/report a
pole `runtimeReceiptContract.staticBaseMustEqualDecision037ReviewB` má hodnotu
exact full E_B commit SHA, nikdy boolean. Samostatná pole připnou exact E_B
tree a report blob SHA; D036 je jen historical prerequisite.

## 5. Fresh preseal a další stop

Fresh reviewer je nový task distinct od původního red reviewera, D036/D037
writerů a reviewerů, repair materializera, coordinatora `/root` a budoucích
post-seal A/B. Runner neimportuje ani nespouští. Reviewer nezávisle vytvoří
D036 `14+26` a D037 `13+14+59` per-row výsledky, odvodí AST/budget a ověří
všechny exact schemas i SHA chains.

Fresh recorder basename je exact
`m1-h0-v5-preseal-ready-review-d037-YYYYMMDDTHHMMSSZ.<suffix>` s actual UTC
birth second a osmi `[a-z0-9]`; any-type prefix je absent před exclusive
mkdir. Root je `0700`, exact tři regular files jsou `0400`, UID/GID
`1000/1000`, nlink `1`, no-clobber. Result má exact `schemaVersion=1`, kind
`H0_V5_D037_FRESH_PRESEAL_REVIEW_RESULT`, designation
`FORMAL_V5_D037_FRESH_PRESEAL_REVIEW`, role
`independent-preseal-ready-reviewer` a task
`/root/v5_d037_fresh_preseal_review`. `PRESEAL_READY` je odvozen jen z
`P0=0/P1=0`; jinak durable `CHANGES_REQUIRED` a STOP. Manifest kind je exact
`H0_V5_D037_FRESH_PRESEAL_ARTIFACT_MANIFEST`, je self-excluding a detached
grammar je `<64 lowercase hex><two spaces>artifact-manifest.json<LF>`.

READY exclusion set je exact sorted `/root`, `/root/decision036_writer`,
`/root/decision037_review_a`, `/root/decision037_review_b`,
`/root/v5_d037_postseal_review_a`, `/root/v5_d037_postseal_review_b`,
`/root/v5_formal_preseal_review`, `/root/v5_materializer`; vlastní fresh task v
setu není.

READY result required keys jsou exact `authority`, `baseRevision`, `baseTree`,
`designation`, `excludedReviewerTasks`, `focusedFixtureResults`, `kind`,
`materializationRoot`, `matrixResults`, `newCore`, `oldCore`,
`originalFixtureResults`, `p0Count`, `p1Count`, `promotedDecision037Commit`,
`promotedDecision037ReportBlobSha256`, `promotedDecision037Tree`,
`redRecorder`, `reviewerTask`, `role`, `runnerImportedOrInvoked`,
`runtimeEffects`, `schemaVersion`, `subcaseResults`, `toolingFailures`,
`verdict`. READY manifest keys jsou exact `schemaVersion`, `kind`,
`recorderRoot`, `birthTimeUtc`, `resultFile`, `files`,
`selfReferentialExclusions`; files obsahují právě result a self-exclusions
právě manifest a digest.

Result a self-excluding manifest vážou OLD triple, complete red recorder a NEW
core; nesmějí předem vyžadovat SHA vlastního budoucího manifestu/digestu. Až
následný final materialization manifest váže všechny tři files complete red i
ready recorderu.

Po READY lze pouze rehashnout stejné core a oba recordery a pokračovat
původním D036 sealem. Potom jsou nutné dvě nové distinct post-seal review,
každá fresh od nuly s vlastními mutants a AST/budget/schema proofy; teprve dva
odvozené PASS pokračují.
Každá používá svůj owner-only three-file external recorder s exact prefixem
`m1-h0-v5-postseal-review-a-d037-` nebo
`m1-h0-v5-postseal-review-b-d037-`, birth-honest suffixem a structured
`reviewerTask`/role/exclusions. Budoucí static subject vytvoří exact tracked
canonical JSON projekce
`docs/execution/runs/wp-m1-h0-v5-postseal-review-a-20260818.json` a
`docs/execution/runs/wp-m1-h0-v5-postseal-review-b-20260818.json`, které
byte-bindnou external closures. Opaque `.md` nebo PASS string/hash nestačí.
Tento WP static receipt ani runtime acceptance nevydává.

Review A result má exact `schemaVersion=1`, kind
`H0_V5_D037_POSTSEAL_REVIEW_A_RESULT`, designation
`FORMAL_V5_D037_POSTSEAL_REVIEW_A`, role
`independent-postseal-reviewer-a` a task
`/root/v5_d037_postseal_review_a`; Review B používá exact kind
`H0_V5_D037_POSTSEAL_REVIEW_B_RESULT`, designation
`FORMAL_V5_D037_POSTSEAL_REVIEW_B`, role
`independent-postseal-reviewer-b` a task
`/root/v5_d037_postseal_review_b`. A exclusion set je sorted:
`/root`, `/root/decision036_writer`, `/root/decision037_review_a`,
`/root/decision037_review_b`, `/root/v5_d037_fresh_preseal_review`,
`/root/v5_d037_postseal_review_b`, `/root/v5_formal_preseal_review`,
`/root/v5_materializer`; B nahrazuje vlastní B task taskem A.

A/B result required keys jsou exact `authority`, `coreFiles`,
`d036FixtureResults`, `d036MatrixResults`, `d037FocusedFixtureResults`,
`d037MatrixResults`, `d037SubcaseResults`, `designation`,
`excludedReviewerTasks`, `kind`, `materializationManifest`,
`materializationRoot`, `p0Count`, `p1Count`, `promotedDecision037Commit`,
`promotedDecision037ReportBlobSha256`, `promotedDecision037Tree`,
`readyPresealRecorder`, `redPresealRecorder`, `reviewerTask`, `role`,
`runnerImportedOrInvoked`, `runtimeEffects`, `schemaVersion`,
`toolingFailures`, `verdict`.

Verdict je odvozený `PASS|CHANGES_REQUIRED`; pouze nula P0/P1 je PASS. Red
recorder se vždy durable zachová a blokuje projection/static/acceptance/runtime.
Každý result obsahuje per-row výsledky D036 `14+26` a D037 `13+14+59`; missing,
duplicate nebo aggregate-only výsledek je red. Manifest kinds jsou exact
`H0_V5_D037_POSTSEAL_REVIEW_A_ARTIFACT_MANIFEST` a
`H0_V5_D037_POSTSEAL_REVIEW_B_ARTIFACT_MANIFEST`; closure je owner-only,
no-clobber, self-excluding a používá exact detached grammar.
Manifest required keys jsou exact `schemaVersion`, `kind`, `recorderRoot`,
`birthTimeUtc`, `resultFile`, `files`, `selfReferentialExclusions`; files mají
právě result a self-exclusions právě manifest a digest.

Tracked projections mají exact `schemaVersion=1`, kinds
`H0_V5_D037_TRACKED_POSTSEAL_REVIEW_A_PROJECTION` a
`H0_V5_D037_TRACKED_POSTSEAL_REVIEW_B_PROJECTION`, designation, task, exact
exclusions, derived verdict, row results/counts a complete external closure.
Projection required keys jsou exact `schemaVersion`, `kind`, `designation`,
`reviewerTask`, `excludedReviewerTasks`, `verdict`, `requiredAuditCounts`,
`resultsSha256`, `externalRecorder`; unknown/missing key je red.

## 6. Acceptance matrix

1. `R37-01` — I5/tree, sole old root/triple/birth/empty evidence/no seal jsou exact.
2. `R37-02` — authentic red recorder původního reviewera vznikne před editem.
3. `R37-03` — jedna same-root three-core transaction zachová before/after evidence.
4. `R37-04` — no undefined budget names; fresh `1+13=14`/255/maxima/inequalities.
5. `R37-05` — všech čtrnáct D036 V5 matrix rows projde na NEW bytes.
6. `R37-06` — všech původních 26 isolated byte mutants jednotlivě zčervená.
7. `R37-07` — cleanup key/semantic/raw-SHA chain dominuje postflight/seal.
8. `R37-08` — structured reviewer identities a required inequalities jsou enforced.
9. `R37-09` — load/G0/pre-effect same-FD parent enumeration odmítá any sibling.
10. `R37-10` — NEW digests/paths/budget a promoted Decision037 live base jsou exact.
11. `R37-11` — fresh distinct preseal váže NEW core i OLD red history a je green.
12. `R37-12` — do READY není digest/manifest/seal/static/acceptance/runtime efekt.
13. `R37-13` — runtime/retry/model/T3/Gate/push/tag/release authority je NONE.

## 7. Focused negativní fixtures

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

## 8. Owned paths a Git evidence

Subject exact allowlist:

1. `docs/decisions/037-m1-h0-v5-preseal-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-PRESEAL-REMEDIATION.md`

Reserved report musí být absent v I5 i subjectu:

    docs/execution/runs/wp-m1-h0-v5-preseal-remediation-20260818-report.md

DAG je
`I5 -> S_H0V5R -> E_A_H0V5R -> C_H0V5R -> E_B_H0V5R -> canonical --ff-only`.
E_A mění pouze report a má exact čtyři standardní řádky. C má ordered parents
`[I5,E_A_H0V5R]`, tree/report exact E_A a preserved subject blobs. E_B mění
jen report exact appendem `candidateHead` a `reviewB.verdict: PASS`.

E_A smí vytvořit pouze fresh task `/root/decision037_review_a`; E_B pouze
fresh task `/root/decision037_review_b`. Oba jsou odlišné od sebe i od writera
`/root`; identity collision zastaví candidate/promotion a Git author ji
nenahrazuje.

`CHANGES_REQUIRED/BLOCKED` nevytvoří C, promotion ani private authority.

## 9. Writer/reviewer gates

Před subject commitem:

    exact I5/tree/clean writer worktree
    exact four paths; report absent; no unrelated diff
    frozen root/triple/birth/modes/evidence/no-seal/no-recorder exact
    formal P1 and shadow P0=0/P1=5 reproduced
    every Decision037 matrix ID exactly once in both normative docs
    every Decision037 focused-fixture ID exactly once in both normative docs
    every mandatory subcase ID exactly once in both normative docs
    canonical task registry and D037 three-task inequality exact
    node tests/artifact-validation.test.js -> 151/151
    node scripts/validate-test-registry.js --json -> 382 + 8
    node tests/repository-hygiene.test.js -> PASS / 1613 tracked paths
    git diff --check -> PASS

Tyto příkazy jsou docs/static a nesmějí importovat/spustit runner ani způsobit
private/runtime/provider efekt. Po commitu se celý gate opakuje.

## 10. Stop

Zastavit při driftu I5/root/OLD bytes, chybějícím autentickém recorderu,
nepravdivém author claimu, jiné core path, partial repairu, P0/P1, identity
kolizi, sibling rootu, evidence write, premature sealu nebo jakémkoli live
effectu. Druhý repair ani druhý V5 root nevzniká.

## 11. Transparentní authoring evidence

Dva delegované writer pokusy skončily po read-only inventuře před jakýmkoli
editem; subject napsal `/root`. Jeden read-only `sed` měl chybný range bez
`p`, vypsal error a opravený rerun nic nemutoval.

První independent precommit audit byl `CHANGES_REQUIRED`, `P0=0/P1=2`;
adversarial audit byl `CHANGES_REQUIRED`, `P0=0/P1=6`. Jejich identity,
self-hash, red-authority, post-seal schema, exact live-base a subcase findings
jsou v current draftu prospectively opraveny, ale autor je nesmí označit za
closed před fresh recheckem. Precommit checker vytvořil jen dva empty
`/tmp/d037-*-check.out`; nejsou repo/private evidence ani runtime effect.

Další zero-based recheck uzavřel původních šest tříd a našel forced-PASS red
loss (`P1=1`), literal cleanup/post-seal schema mezery (`P1=2`) a
READY/post-seal/SC09 determinismus (`P1=2`). Jeden multi-file `apply_patch`
nenašel WP context; další dva multi-hunk pokusy dopadly stejně. Všechny tři
atomicky nic nezměnily; malé exact hunks uspěly.
Current bytes potřebují nový trojí recheck před commitem.

Třetí fresh trojí recheck našel už jen exact-once drift způsobený matrix-range
shorthandem v Decisionu. Byl nahrazen prose bez ID; current bytes znovu
potřebují paritu, repo gate a bounded end-recheck.
