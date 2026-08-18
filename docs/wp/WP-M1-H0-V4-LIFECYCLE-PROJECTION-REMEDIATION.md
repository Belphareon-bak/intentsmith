# WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION — V4 freeze a jediný V5 lifecycle-projection amendment

**Typ:** docs-only governance subject; po promotion právě jedna private
non-clobber V5 static materializace · **Slot:** jediný writer v izolovaném
disk-backed worktree

**Rozhodnutí:**
[036](../decisions/036-m1-h0-v4-lifecycle-projection-remediation.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5`

**baseTree:**
`f9f8fb84246c1fb86ba89017cdf176ce5a4577f0`

**Stav:** `DOCS_ONLY_ONE_SHOT_V5_STATIC_REMEDIATION /
V4_AGGREGATE_CHANGES_REQUIRED / NO_RUNTIME_AUTHORITY /
NO_ACCEPTANCE_AUTHORITY`

## 1. Výsledek a hranice

WP canonical byte-bindne jediný birth-time-honest sealed V4 root a dvě
independent static review. Review A je
`CHANGES_REQUIRED`, Review B je `PASS`; oba výsledky
zůstávají pravdivé a povinná konjunkce je
`AGGREGATE_CHANGES_REQUIRED`. Decision 035 one-shot V4
materialization authority je spotřebovaná. V4 je immutable failure evidence,
nesmí se editovat, přijmout ani spustit.

Subject přijme pouze prospective V5 contract pro root cause
`COMMON_MODE_NORMATIVE_PROJECTION_DRIFT`. V4 runner actual source
vynucuje `CLIENT_QUIESCED`, ale plan a strategy tento exact token
neobsahují a společně s runner self-validací pinují stale osmiprvkovou
positive mapu. V5 musí opravit celý plan-side lifecycle binding, ne jen
diagram: positive graph, lifecycle/phase contracts, receipt semantic contracts
a key lists, strategy projections, manifest/static/acceptance/operator
receipts, actual AST dominance a source-derived budget.

Tento WP nemá H0 runtime, retry, SSH mutation, `/run`, systemd,
service/display, Ollama/GPU/model, Q4, T3, Gate 1 ani acceptance authority.
Jeho Review A/B posuzují pouze docs amendment, ne budoucí V5 bytes.

## 2. Owned paths a reserved report

Immutable subject `S_H0P` smí změnit přesně:

    docs/decisions/036-m1-h0-v4-lifecycle-projection-remediation.md
    docs/execution/m1-batch.md
    docs/wp/README.md
    docs/wp/WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION.md

V subjectu musí být absent:

    docs/execution/runs/wp-m1-h0-v4-lifecycle-projection-remediation-20260818-report.md

Po Review A smí report-only `E_A_H0P` vytvořit právě tuto
rezervovanou cestu. Po Review B smí `E_B_H0P` změnit pouze tentýž
report exact dvouřádkovým appendem. Candidate nemění subject blobs.

**Zakázané:** jakýkoli jiný tracked path, source/runtime/test/registry/package,
existující report, V1/V2/V3/V4 private bytes, user DB/config, SSH/logout,
service, target, display, `/run`, Ollama/provider,
NVIDIA/GPU/model/T3/API effect, push/force-push/tag/release/history rewrite a
cleanup cizího worktree.

## 3. Exact V4 failure binding

Root:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v4-20260818T013800Z.sws2y8cf

Birth time `2026-08-18T01:38:00.748753695Z` přesně odpovídá
sekundovému basename tokenu `T013800Z`. Root,
`plan/runner/strategy/evidence` jsou mode `0700`,
UID/GID `1000/1000`, nlink `1`, device
`30`. Povinné primární piny jsou:

    plan/h0-v4-plan.json
      sha256 = 98379e4672881947fd9f557351746aff878b8e7df7a47f361f41346565690a1a
      bytes  = 66788
      mode   = 0400

    runner/run-h0-v4.py
      sha256 = 534332e88ce78aa01278307e627dc41b8b3227002e270b328ba29e148b8c5651
      bytes  = 514518
      mode   = 0500

    strategy/rustdesk-v4-strategy.json
      sha256 = 3d2ae8d1b300b2a2df637a84d39adceb048d4ca44c233c39b29e7b56028fc056
      bytes  = 21089
      mode   = 0400

    materialization-manifest.json
      sha256 = 1c5450bdcc0c1265db970ff6764be3f79e281054df06208bbc7d1585715956d2
      bytes  = 4987
      mode   = 0400

WP ověří i čtyři detached digest files:

| Path | SHA-256 | Bytes |
|---|---|---:|
| `plan/h0-v4-plan.sha256` | `830d62fc36419b5d5982ac56dd79dc68d25495eff750fe7ce5df12a332291cc0` | 82 |
| `runner/run-h0-v4.sha256` | `396d6efa6ddf82888aca7611f399405102c73a636d45fd7d5400afd36d11303a` | 79 |
| `strategy/rustdesk-v4-strategy.sha256` | `020397b5c93bf3975c938c61c09de14de699acc183f8c4656ace00105414a45b` | 92 |
| `materialization-manifest.sha256` | `080aad3238ec136ea3a0351c730bce44ef810e61297ab50acfa9e61c8ed72650` | 96 |

Všechny files jsou regular UID/GID `1000/1000`, nlink
`1`; detached files jsou mode `0400`. Self-excluding
closure SHA-256 je
`6d56a8fe9eeb2d52a8c6c57c6913a67aed1bbcaf3b17321fc85b88249078ad1d`.
`evidence/` je empty. Runtime je `NOT_RUN`, effects
`NONE`, acceptance `NOT_ISSUED` a disposition
`DO_NOT_EXECUTE`.

## 4. Independent review evidence

Review A:

    root      = /home/belphareon/.local/share/intentsmith-private/m1-h0-v4-static-review-a-20260818T064220Z.J2w5S1mD
    reviewer  = /root/h0_static_adversary
    verdict   = CHANGES_REQUIRED
    result    = 78cb70f8da2c3ad3282faad96c42afd68fa23da9bbbf75b8c05f9e57368f320e / 10743
    manifest  = 4c952bf4b112f653c3e4e8bce236e463bcc53a90e7e12486e6d99dbfe3d9e62a / 1595
    detached  = 76422188d2c9836f035c2a5cf1916a78f9f58a97e66df20dd197fba069e0b9d6 / 89

Review B:

    root      = /home/belphareon/.local/share/intentsmith-private/m1-h0-v4-static-review-b-20260818T065226Z.002bfeb8
    reviewer  = /root/v4_static_review_b
    verdict   = PASS
    result    = 5fe12c1f3f4babb5e9ab93bf0d91398bee965f2585c13f14f50c66e6768581c6 / 15035
    manifest  = ca66c8a61fd80b43f243be25ca42f198f59e8af10c86e115309b01e7536a0257 / 1721
    detached  = 8ab259a11d41220550748e400b1cd8c5992bffc4da21059f6c2b7206a4ce92f8 / 89

Oba roots jsou `0700`, exact tři files `0400`,
UID/GID `1000/1000`, nlink `1`. Obě result identity
byte-bindnou tentýž V4 root. Review B PASS se zachovává jako omezený verdikt
jeho metody; Review A blocker je reálný a povinný two-PASS gate proto selhal.
Žádný majority vote, author harness nebo coordinator claim jej nesmí přepsat.

## 5. Potvrzený blocker a exact V5 remediation

### 5.1 Common-mode projection drift

V4 plan a strategy mají shodný graph:

    ["unit-post-terminal","systemd-run-wait-return","outer-terminal-proof","outer-host-rmdir","outer-final-proof","outer-ollama-ps-2","seal","absolute-last-marker"]

Canonical JSON + final LF SHA-256 je
`5d221939add7317d038056df5182a9dacf291fbed592926dd80d58df433cc816`.
Runner hardcoduje stejnou mapu a self-validace ji porovnává se stejným
planem/strategy. Tato self-consistency začíná až krokem 3 povinného toku
decision 035:335–344.

Exact token counts jsou plan `0`, strategy `0`, runner
`28` pro `CLIENT_QUIESCED`. Plan nemá samostatný
quiesced receipt semantic contract/key-list entry ani client lifecycle phase
mapu. Generic key names v systemd resultu neurčují classification, hash,
identity, child reap nebo unit-post antecedent. Runner je přitom vynucuje.
Jde o code-versus-normative-contract divergence, ne pouze stale kresbu.

### 5.2 Exact 15-node anchor

V5 musí plan/runner/strategy byteově pinnut:

    ["main-owned-client-start","bounded-serial-identity-capture","unit-post-non-pass-terminal","systemd-run-return-plus-client-wait-reap","CLIENT_QUIESCED","outer-terminal-proof","same-inode-rmdir","final-proof","second-strict-ollama-ps","full-closure","one-way-manifest","detached-digest","absolute-last-marker","terminal-directory-fsync","immediate-exit"]

Canonical UTF-8 JSON bez mezer, s jedním final LF, má 354 bytes a SHA-256
`492645f2234b54f7e7421a10978292691b0358461852f9232e1dcf9cbf099d35`.
Anchor je exact promoted decision 035 na base `ffe02f8c...`,
řádky 335–344, file SHA-256
`7b7f627d97257cd5f187a55b28b011d0cd198a2ed4786bc88131fff9b8a00c09`.

### 5.3 Povinné strukturované projekce

Plan musí mít explicitní `clientLifecycleContract`, client phase
mapu a `lifecycleReceiptSemanticContracts`. Poslední jmenovaný
spolu s `passFixedReceiptKeyLists` připne samostatné receipts pro
client started, serial capture terminal, unit-post antecedent, exact
`systemd-run-client-quiesced.json` a systemd result.

Quiesced semantic contract musí vázat exact V5 kind,
`classification=CLIENT_QUIESCED`, started/capture/unit-post SHA,
PID/starttime/executable/argv identitu, completed-and-reaped poll count,
no-live-child, PIDFD terminal observation, právě jeden wait/reap, pipes,
selector a FD closure. Systemd result a všechny downstream closure/manifest
receipts musí vázat exact quiesced receipt SHA.

Strategy projektuje exact lifecycle, phases, receipt semantics, key lists a
jejich canonical digests. Runner self-validace je porovná s oběma dokumenty a
současně source/AST prokazuje skutečnou dominanci. Manifest, static receipt,
acceptance receipt a operator block znovu pinují lifecycle a semantic digests.
Prose-only token, comment, negative fixture nebo self-consistent stale map s
přepočteným digestem je explicitně odmítnut.

Plan `runtimeReceiptContract` musí mít povinná exact lifecycle SHA pole
pro static receipt, acceptance receipt a operator block. Materialization
manifest bindne šest plan/runner/strategy core a detached files, preseal
recorder a všechny lifecycle/receipt/phase/budget digests, self-excluduje sebe
a svůj detached digest; finální detached manifest digest uzavírá osmifile
closure.

### 5.4 Actual AST a budget

Source/AST bez importu musí sledovat konkrétní
start→serial capture→unit-post→return/wait/reap→quiesced→outer proof→rmdir→
final proof→second ps→closure→manifest→digest→marker→directory fsync→exit tok.
Exact quiesced proof dominuje outer result/rmdir/seal. Neprokázaná quiescence
je pouze `OUTCOME_UNSEALED/UNKNOWN`, bez outer rmdir a terminal
files.

Budget se znovu odvodí ze všech actual normal/failure callsites a lifecycle
edges včetně bounded poll children, wait/reap, terminate/nejvýše jednoho kill,
receipt publication a terminal writes. Převzetí V4 čísel bez derivace,
key-only count nebo calculator bez nezávislého source rechecku neprojde.

### 5.5 Inherited floor

V5 losslessly zachová:

- decision 033 SHA-256
  `a5ade62deead6b38c875ac1c67824e1306a845a25a80ea58547a9a9a1b7654c3`;
- decision 034 SHA-256
  `14bf57948e8a0a3efa43598ac358173af2826507116f1319e480049fabb6cf0c`;
- decision 035 SHA-256
  `7b7f627d97257cd5f187a55b28b011d0cd198a2ed4786bc88131fff9b8a00c09`;
- exact payload SHA-256
  `87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc`,
  strict two-path mount split, inner pending cleanup a outer same-inode rmdir;
- no-background ownership, full quiescence, one-way terminal seal a veškerý
  Git/SSH/session/provider/GPU/ledger/sample safety floor.

V5-specific core jsou `plan/h0-v5-plan.json`,
`runner/run-h0-v5.py` a `strategy/rustdesk-v5-strategy.json`;
exact kinds jsou `H0_V5_STATIC_MATERIALIZATION_PLAN`,
`H0_V5_RUSTDESK_EXACT_STOP_STRATEGY`,
`H0_V5_STATIC_MATERIALIZATION_MANIFEST` a
`H0_V5_MAIN_OWNED_SYSTEMD_RUN_CLIENT_QUIESCED`; unit se odvozuje jako
`intentsmith-m1-h0-v5-<UTC>-<suffix>.service` a drop-in je exact
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v5.conf`.
Tyto identity nesmějí zůstat V4.
Historické V1–V4 piny se zachovají jen jako explicitní historical evidence.

## 6. Povinná V5 review matrix

Review A i B tohoto docs WP ověří, že decision 036 beze ztráty obsahuje:

1. `V5-01` — immutable birth-time-honest V4 closure, oba
   divergentní recordery a aggregate red disposition;
2. `V5-02` — jediný canonical-authorized non-clobber,
   birth-time-honest, owner-only, evidence-empty V5 root bez runtime authority;
3. `V5-03` — exact 15-node array, decision-035:335–344 anchor a
   canonical-final-LF SHA `492645f2...`;
4. `V5-04` — plan-side client lifecycle contract a explicitní phase
   map od main-owned startu po quiesced/outer closure;
5. `V5-05` — samostatný quiesced semantic receipt/key list, exact
   classification, identity, child reap, antecedent a SHA edges;
6. `V5-06` — shodné strategy/runner/manifest/static/acceptance/
   operator projections a odmítnutí self-consistent stale mapy;
7. `V5-07` — skutečná AST dominance, ne token/function/constant
   proxy;
8. `V5-08` — unknown/unreaped/mismatched větev je unsealed a bez
   outer rmdir/terminal files;
9. `V5-09` — source-derived normal/failure command/effect/time
   budget a independent strict inequalities;
10. `V5-10` — independent preseal hold nad final core bytes,
    rehash-before-seal a žádný premature seal;
11. `V5-11` — dvě distinct post-seal review identity oddělené od
    writera, materializera, preseal reviewera i navzájem;
12. `V5-12` — lossless 033/034/035 floor a nulová stale V4
    produkční identita;
13. `V5-13` — všech 26 fixtures jednotlivě fail-closed a exact
    positive fixture;
14. `V5-14` — nulová runtime/retry/model/T3/Gate/acceptance
    authority.

Review docs WP nesmí být vydáno za budoucí V5 static PASS.

## 7. Povinných 26 negativních fixtures

1. `V5-FIXTURE-01-OMIT_CLIENT_START`
2. `V5-FIXTURE-02-OMIT_SERIAL_CAPTURE`
3. `V5-FIXTURE-03-SWAP_UNIT_POST_AFTER_CLIENT_REAP`
4. `V5-FIXTURE-04-OMIT_WAIT_REAP`
5. `V5-FIXTURE-05-GENERIC_WAIT_RETURN_ALIASES_CLIENT_QUIESCED`
6. `V5-FIXTURE-06-CLIENT_QUIESCED_AFTER_OUTER_RESULT`
7. `V5-FIXTURE-07-RMDIR_BEFORE_CLIENT_QUIESCED`
8. `V5-FIXTURE-08-SEAL_BEFORE_FULL_CLOSURE`
9. `V5-FIXTURE-09-OMIT_MANIFEST_DIGEST_MARKER_OR_EXIT_NODE`
10. `V5-FIXTURE-10-PLAN_STRUCTURED_PATH_HAS_NO_CLIENT_QUIESCED`
11. `V5-FIXTURE-11-STRATEGY_STRUCTURED_PATH_HAS_NO_CLIENT_QUIESCED`
12. `V5-FIXTURE-12-PLAN_STRATEGY_RUNNER_PROJECTION_MISMATCH`
13. `V5-FIXTURE-13-SELF_CONSISTENT_STALE_V3_MAP_WITH_RECOMPUTED_DIGESTS`
14. `V5-FIXTURE-14-RAW_TOKEN_SPOOF_ONLY_IN_COMMENT_DISCLOSURE_OR_NEGATIVE_FIXTURE`
15. `V5-FIXTURE-15-SYSTEMD_RESULT_KEYS_PRESENT_CLASSIFICATION_WRONG`
16. `V5-FIXTURE-16-QUIESCED_CHILD_SHA_OR_UNIT_POST_ANTECEDENT_WRONG`
17. `V5-FIXTURE-17-TRANSIENT_UNIT_PHASES_PRESENT_CLIENT_PHASE_MAP_ABSENT`
18. `V5-FIXTURE-18-STATIC_RECEIPT_OMITS_LIFECYCLE_SHA`
19. `V5-FIXTURE-19-ACCEPTANCE_OR_OPERATOR_RECEIPT_OMITS_LIFECYCLE_SHA`
20. `V5-FIXTURE-20-BUDGET_MAP_NOT_DERIVED_FROM_LIFECYCLE_EDGES`
21. `V5-FIXTURE-21-STALE_V4_ROOT_FILENAME_UNIT_DROPIN_OR_KIND`
22. `V5-FIXTURE-22-PREMATURE_SEAL_WITHOUT_PRESEAL_READY`
23. `V5-FIXTURE-23-SECOND_V5_ROOT`
24. `V5-FIXTURE-24-POST_SEAL_CORE_DRIFT`
25. `V5-FIXTURE-25-AUTHOR_HARNESS_OR_CHAT_CLAIM_SUBSTITUTES_FOR_INDEPENDENT_REVIEW`
26. `V5-FIXTURE-26-DECISION036_OR_STATIC_RECEIPT_ISSUES_RUNTIME_RETRY_T3_OR_GATE_AUTHORITY`

Každý fixture je source/JSON/AST-only, aplikuje skutečnou izolovanou mutaci a
musí být jednotlivě reportován. Raw token search ani author summary se
nepočítají.

## 8. Preseal, post-seal a jediný materializační effect

Až promoted `E_B_H0P` dovolí právě jedno první non-clobber mkdir
V5 rootu pod owner-only private parentem. Basename nese skutečný UTC birth
time a osm random znaků. Any-type glob absence, exact canonical tip/tree,
clean checkout a unchanged V4/review bytes musí být ověřeny těsně před mkdir.
První root spotřebuje autoritu i při partial failure.

Materializer vytvoří pouze final intended core plan/runner/strategy bytes a
prázdné evidence, nastaví final root/subdir `0700`, plan/strategy
`0400` a runner `0500`, potom se zastaví. Distinct read-only
preseal reviewer vydá owner-only `PRESEAL_READY` recorder s rootem
`0700` a exact třemi files `review-result.json`,
`artifact-manifest.json`, `artifact-manifest.sha256` mode
`0400` pouze při nule P0/P1 a po jednotlivém ověření
matrix/fixtures/AST/budget. Recorder byte-bindne core bytes i modes a nese
nulovou další authority. Red verdict zachová root unsealed a zakáže druhý
root.

Po READY materializer exact core rehashne. Bez byte driftu smí pouze vytvořit
detached digests a self-excluding manifest vázající preseal recorder, vše mode
`0400`, a final seal. Core bytes ani modes už nesmí měnit. Premature
seal, post-review core drift nebo druhý root jsou `CHANGES_REQUIRED`.

Po sealu následují dvě nové distinct read-only Review A/B, oddělené od writera,
materializera, preseal reviewera a navzájem. Obě byte-bindnou celý root,
decisions 033–036, V4/recorders/preseal, matrix, fixtures, AST a vlastní
budget. Runner neimportují ani nespouštějí. Teprve dvě PASS mohou pokračovat
do samostatného canonical
`S_V5 -> E_A_V5 -> C_V5 -> E_B_V5` static receipt chain.

## 9. Review a promotion DAG decision 036

    I4=ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5
      -> S_H0P
      -> E_A_H0P (report-only independent Review A)
      -> C_H0P (merge current canonical integration + E_A_H0P)
      -> E_B_H0P (two-line append-only independent Review B)
      -> canonical --ff-only promotion
      -> at most one V5 inert static materialization

Report A obsahuje přesně:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5
    subjectHead: <full S_H0P>
    reviewA.verdict: PASS

Report B pouze připojí:

    candidateHead: <full C_H0P>
    reviewB.verdict: PASS

`C_H0P` má ordered parents
`[current canonical integration, E_A_H0P]`, report byte-identický s
`E_A_H0P` a prokazatelnou ancestry. Candidate zachová subject
blobs. `CHANGES_REQUIRED/BLOCKED` nevytvoří candidate, promotion
ani V5 authority.

## 10. Stop a další hranice

V5 materializer zapisuje jen static private bytes a preseal/final closure;
nemá runtime autoritu. Po dvou post-seal PASS musí nejprve vzniknout canonical
static receipt. Následují fresh SSH/logout/all-system GUI-absence preflight,
exact GUI-saved operator block s lifecycle SHA, samostatný promoted acceptance
receipt a immediate same-boot/no-drift gate. Teprve potom smí vzniknout
nejvýše jeden H0 pokus. H0 výsledek stále potřebuje independent result review
a canonical binding; teprve accepted H0 PASS dovolí samostatné T3 rozhodnutí.

Zastavit při driftu, reportu v subjectu, jiné cestě, neúplném V4 bindingu,
nečistém checkoutu, stale graphu, prose-only tokenu, chybějícím receipt/phase
contractu, neodvozeném budgetu, preseal red, premature sealu, druhém V5 rootu,
post-seal driftu, chybějícím reviewerovi nebo jakémkoli runtime/live effectu.

## 11. Focused writer verification

Před commitem `S_H0P`:

    git diff --no-renames --name-only I4..S_H0P = exact four-path allowlist
    reserved report path absent in S_H0P
    no unresolved placeholder outside explicit report-schema metavariables
    V4 root/file hashes, sizes, modes, birth time and empty evidence = 036
    both recorder roots/result/manifest/detached hashes and modes = 036
    stale graph SHA, exact token counts and 15-node target SHA reproduced
    all fourteen V5 matrix IDs and all 26 fixture IDs occur exactly once
    node tests/artifact-validation.test.js = PASS (151/151 expected)
    node scripts/validate-test-registry.js --json = PASS
      (382 tracked programs + 8 exclusions expected)
    node tests/repository-hygiene.test.js = executable PASS / 1610 tracked paths expected
      (HEAD 1608 + exact two newly tracked docs)
    git diff --check = PASS
    git status --porcelain=v1 --untracked-files=all = empty after commit

Tyto testy jsou docs/static evidence. Nespouštějí V4/V5 runner, Python import,
systemd, service, `/run`, Ollamu, GPU/model ani T3.

## 12. Transparentní author tooling incidents

První read-only `sha256sum` použil čtyři zkrácené neexistující V4
root-level cesty a skončil `ENOENT`. Exact nested enumeration byla
potom úspěšná a nic nezměnila. První kombinované výpisy dlouhých roadmap/system
map dokumentů byly transportně truncated; writer je před zápisem přečetl znovu
v úplných bounded ranges. Tyto chyby neskrývají failure evidence a nejsou
subject artifact finding.

První combined refinement patch se kvůli wrapper syntax
`Missing } in template expression` zastavil před samotným
`apply_patch`; žádný hunk ani partial edit nevznikl. Opravený wrapper
potom aplikoval exact celý patch.

První structured content audit vrátil `FAIL` na duplicitním výskytu dvou
boundary matrix ID v prose range zápisu. Matrix samotná byla úplná; prose range
byl před commitem odstraněn a audit se opakuje. Tento red author check se
nevydává za PASS.
