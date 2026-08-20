# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-TOOLCHAIN-REMEDIATION

**Výsledek:** exact four-doc governance-only D039 replacement. Review B
dokončí poslední baseline; sole executor `/root` pod exclusive lease ff-only
promuje D040 a exact worktree-add je při success bezprostředně následující Git
child. Root nevydává PASS; entire poststate vlastní distinct verifier.

**B40:** `c38e1b24849521b41025e70a37bf0219466c9d1e`

**B40 tree:** `0b0cdff832b18cb75fcfd0ed2ed42e0701cc5a7e`

**Stav subjectu:** `MINIMAL_CONTRACT_FROZEN_FOR_PRECOMMIT_AUDITS /
NO_OPERATIONAL_AUTHORITY`

Final minimal adversary ruling je
`BATCH_CLOSED / PASS / IMPLEMENTABLE / P0=0/P1=0`; subject commit stále čeká
na dva fresh zero-based precommit PASS.

## 1. Immutable red input

Promoted D039 decision/WP/report blobs jsou
`edefbc26a0ac4fa1dfc0645cff91be7b2572a4b5`,
`c89eb1043c00abfbbca5d7315385647cb87e7e3c`,
`a4c6cbc878f1c2ebb1b17858c6f3b3e104798632`; content SHA jsou
`a929b21cfe6e80ae9f6fcbff9548893a686395373ce28b6d9b31a7d095febb77`,
`0ab76b79187fef6f429e865d65737a3b43eb22ed46391172782de173598c3750`,
`b9ea97fd54bd0a04b0608d0c1c98ccb009c83faf61a2d59af96973e649cd4fd6`.

D039 terminal incident je `BLOCKED_BEFORE_ATTEMPT`, authority consumed, failed
gate `PRELAUNCH_GIT_READ_ENVELOPE_NOT_EXACT_D039`, CREATE issued/consumed,
count `0`, launch false, absent snapshot/GO/observation/handoff a VERIFY
`CANCELLED_UNISSUED/NO_RUN`. Toolcall 1 raw argv byl:

```text
/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 /usr/bin/git --no-optional-locks -C /home/belphareon/worktrees/is-m1-consolidated -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.attributesFile=/dev/null -c core.excludesFile=/dev/null -c commit.gpgSign=false ls-tree -r --name-only c38e1b24849521b41025e70a37bf0219466c9d1e -- docs/decisions
```

Měl 6 env a 5 config assignments; chyběly exact D039 LANG/TZ/prompt/askpass/
lazy-fetch/committer a 11 configs, allowed pořadí bylo wrong a
`commit.gpgSign=false` unauthorized. Wall time/exit/signal/stdout/stderr jsou
UNKNOWN. Pozdější `rg` ENOENT 2 624 bytes/SHA
`45d002f6da445c78835b5c8daacee2786162faceaf632c86891bd8e0f37268aa`
je superseded non-evidence.

## 2. Source/prestate a replacement boundary

B37 `df1863439b6ad83abf41396ba8063e5bffaa599e`, tree
`1f0e730a46a94a7f741b2dbf47426458b8125a97`, 1 614 paths, path SHA
`51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea`,
raw tree 151 786 bytes/SHA
`f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6`
zůstává sole live base. Target/admin jsou stejné absent D039 paths.
Private OLD/evidence/no-seal/red a common config/info/mount pins se nemění.

Toto WP selektivně zachovává D039 §2/§4 a inherited D038 §5.2–§5.5 protocols
a invariants plus terminal no-cleanup/no-retry jen s úplnou substitucí: D038
§5.4 preflight nahrazuje Review-B final baseline; creator immediate/final
captures nahrazují verifier captures před prvním/po posledním Git readu a
první verifier index je run-specific pin. Same-FD/no-follow stat/hash/parser/
mount pravidla i pozdější materializer boundaries zůstávají. D038 §5.5
canonical-unchanged větu nahrazuje pre-pinned exact B40→E_B fast-forward
canonical delta plus nový target/admin a nutná parent metadata; všechny
ostatní refs/objects/config/info/private/pre-existing worktree controls jsou
invariantní.

WP úplně nahrazuje D039 §6 creator preflight, snapshot-GO,
creator→verifier machinery a D039 §8 creator observation. Creator je sole
`/root`; verifier `/root/v5_d040_source_checkout_verifier`. Žádný starý
token/task/driver/observation se nerecykluje.

## 3. Review B final baseline

Review B po evidence commitu a před fencingem exact no-write envelopem
byte-bindne D040 DAG/report/four blobs, canonical clean B40 + expected E_B,
B37 object closure, target/admin/ref/worktree/lock absence, common/private
before manifests, no relevant open-handle conflict, exact allowed
promotion+target/admin deltas, promotion/create commands, tokens,
lease/identities/exclusions. Pak se spolu se všemi ostatními consumers fenced;
Review-B worktree se nemaže ani neupravuje.

Incomplete baseline nebo quiescence znamená `NOT_STARTED / UNISSUED /
UNCONSUMED`; root nesmí dělat vlastní discovery/preflight Git ani direct
common-metadata read.

## 4. Promotion-to-create sequence

Lease pokrývá common Git/refs/objects/config/info/admin, všechny linked
worktrees, canonical, target/admin namespace a frozen private root. Před
promotion jsou CREATE/VERIFY `UNMINTED`; root drží sole lease. Exact promotion
argv template má 53 elements: `/usr/bin/env -i`, ordered CREATE14,
`/usr/bin/git -C` canonical, ordered CONFIG15 `-c` pairs a
`merge --ff-only --no-edit <full-E_B_H0V5SRC040-sha>`. Review B byte-bindne
fully substituted argv. Promotion nemá umask ani optional-lock suppression.

| Boundary | promotion count/launch/outcome | CREATE | VERIFY | create count/launch/outcome | Terminal rule |
|---|---|---|---|---|---|
| lease active před promotion spawn | `0` / `false` / absent | `UNMINTED` | `UNMINTED` | `0` / `false` / absent | live; promotion next Git child |
| known promotion launcher/pre-child failure | `0` / `false` / absent | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` / `false` / absent | terminal; no create/verifier |
| promotion dispatch/launch neprokazatelný | `UNKNOWN` / `UNKNOWN` / `UNKNOWN` | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` / `false` / absent | terminal; no create/verifier |
| promotion launch prokázán, outcome unknown | `1` / `true` / `UNKNOWN` | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` / `false` / absent | terminal; no create/verifier |
| promotion success před CREATE issue | `1` / `true` / exit0 no-signal | `UNMINTED` | `UNMINTED` | `0` / `false` / absent | live; jen task-channel issue |
| promotion success, known failure před CREATE issue | `1` / `true` / exit0 no-signal | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` / `false` / absent | terminal; no create/verifier |
| CREATE issued, před create child | `1` / `true` / exit0 no-signal | `ISSUED_AND_ACTIVATED` | `UNMINTED` | `0` / `false` / absent | live; create next Git child |
| CREATE issued, known pre-child spawn failure | `1` / `true` / exit0 no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `0` / `false` / `NO_RUN` | terminal; no subsequent create/verifier |
| create dispatch/launch neprokazatelný | `1` / `true` / exit0 no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `UNKNOWN` / `UNKNOWN` / `UNKNOWN` | terminal; no subsequent create/verifier |
| create launch prokázán, outcome unknown | `1` / `true` / exit0 no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `1` / `true` / `UNKNOWN` | terminal; no subsequent create/verifier |

`UNMINTED` je live-only; každý terminal nikdy nevydaný token je
`CANCELLED_UNISSUED`. Attempt/launch jsou `1`/`true` jen při prokázaném launchi,
`0`/`false` při known no-spawn a `UNKNOWN`/`UNKNOWN`, nelze-li hranici prokázat.
Unprovable outcome zůstává `UNKNOWN`; každá terminal řádka foreclose-ne
authority bez retry/cleanupu nebo následného create/verifier runu.

Sekvence je: complete task-channel handoff; exclusive lease holder `/root`;
one-shot ff-only promotion; při nonzero terminal cancellation; při exit0
issue+activate CREATE bez readu; exact worktree-add jako velmi další Git child;
count `0 -> 1`; žádný force/branch/alternate target; nonzero/partial STOP/FREEZE
bez retry/cleanup. Signal/timeout/unknown jsou stejná terminal větev. Exit0 je
pouze raw outcome; následuje atomický VERIFY issue + root-to-verifier transfer
bez root post-readu; verifier celý closure recompute fresh, spotřebuje token a
při každém outcome uzavře lease.

Jakýkoli intervening Git child, libgit2/JGit/direct common-metadata read,
non-ff update, race obcházený force, root PASS inference, premature verifier
nebo cleanup je terminal. Persistent detected target/admin conflict musí
skončit nonzero, ale jakýkoli external access/race je terminal lease violation
bez ohledu na exit; exit `0` jeho absenci neprokazuje.

## 5. Exact create/read closure

CREATE je D039 fixed command s D040 identity/lock substitution, `umask 077`,
14 env, 15 configs a no-force detached locked worktree add na same target/B37.
READ15/CREATE14/CONFIG15/create-argv pins jsou 362/339/393/1 171 bytes a SHA
`9fa5583b940dcc383b4e9c447d4eebf775d9c0dfe18a453e7d9df9467a6c1786`,
`7b0a49257e83acda1c0572297dc3ee4c382b31f05bd984f11e74d40eb037a987`,
`e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085`,
`f501bbf00c90079c8529ec256910041a2f20a6a208c1d8a7cdc0f6c1f59d5e92`.
Lock payload 80 bytes/SHA
`028d30b89eb63a591e00e4b6ec8549f7df51397d553800f3b9c9b33276a5f397`.

READ15 je CREATE14 s `GIT_OPTIONAL_LOCKS=0` vloženým bezprostředně před D040
committer name/email; každý read používá `/usr/bin/git --no-optional-locks` a
stejný ordered CONFIG15.

Verifier exact no-write read envelopem ověří D040 promotion/report, adjacency
transcript, detached B37/tree, ignored/status/others, stage/tree/path set,
1 614-leaf FS/blob/mode closure, same-FD index/info/config, admin controls,
common Git against Review-B baseline with only promotion+target/admin allowed,
a private no-touch. Complete mismatch je CHANGES_REQUIRED; incomplete audit je
BLOCKED s absent handoff. Pouze verifier-owned PASS odemyká materializer.

## 6. Roles, matrix a fixtures

Live roles jsou writer `/root/decision040_writer`, A/B
`/root/decision040_review_a` a `/root/decision040_review_b`, sole
issuer/promoter/creator `/root` a verifier
`/root/v5_d040_source_checkout_verifier`.

Exact sorted 36-entry `U40` je:

```text
/root
/root/decision036_review_a
/root/decision036_review_b
/root/decision036_writer
/root/decision037_review_a
/root/decision037_review_b
/root/decision038_r2_review_a
/root/decision038_r2_review_b
/root/decision038_review_a
/root/decision038_review_b
/root/decision038_writer
/root/decision039_adversary
/root/decision039_architect
/root/decision039_review_a
/root/decision039_review_b
/root/decision039_writer
/root/decision040_architect
/root/decision040_driver_adversary
/root/decision040_driver_completion_audit
/root/decision040_driver_writer
/root/decision040_minimal_adversary
/root/decision040_review_a
/root/decision040_review_b
/root/decision040_toolchain
/root/decision040_writer
/root/v5_d037_fresh_preseal_review
/root/v5_d037_postseal_review_a
/root/v5_d037_postseal_review_b
/root/v5_d038_source_checkout_materializer
/root/v5_d038_source_checkout_verifier
/root/v5_d039_source_checkout_materializer
/root/v5_d039_source_checkout_verifier
/root/v5_d040_source_checkout_materializer
/root/v5_d040_source_checkout_verifier
/root/v5_formal_preseal_review
/root/v5_materializer
```

Root exact exclusions jsou `U40 - {/root}` = 35 sorted entries:

```text
/root/decision036_review_a
/root/decision036_review_b
/root/decision036_writer
/root/decision037_review_a
/root/decision037_review_b
/root/decision038_r2_review_a
/root/decision038_r2_review_b
/root/decision038_review_a
/root/decision038_review_b
/root/decision038_writer
/root/decision039_adversary
/root/decision039_architect
/root/decision039_review_a
/root/decision039_review_b
/root/decision039_writer
/root/decision040_architect
/root/decision040_driver_adversary
/root/decision040_driver_completion_audit
/root/decision040_driver_writer
/root/decision040_minimal_adversary
/root/decision040_review_a
/root/decision040_review_b
/root/decision040_toolchain
/root/decision040_writer
/root/v5_d037_fresh_preseal_review
/root/v5_d037_postseal_review_a
/root/v5_d037_postseal_review_b
/root/v5_d038_source_checkout_materializer
/root/v5_d038_source_checkout_verifier
/root/v5_d039_source_checkout_materializer
/root/v5_d039_source_checkout_verifier
/root/v5_d040_source_checkout_materializer
/root/v5_d040_source_checkout_verifier
/root/v5_formal_preseal_review
/root/v5_materializer
```

Verifier exact exclusions jsou
`U40 - {/root/v5_d040_source_checkout_verifier}` = 35 sorted entries:

```text
/root
/root/decision036_review_a
/root/decision036_review_b
/root/decision036_writer
/root/decision037_review_a
/root/decision037_review_b
/root/decision038_r2_review_a
/root/decision038_r2_review_b
/root/decision038_review_a
/root/decision038_review_b
/root/decision038_writer
/root/decision039_adversary
/root/decision039_architect
/root/decision039_review_a
/root/decision039_review_b
/root/decision039_writer
/root/decision040_architect
/root/decision040_driver_adversary
/root/decision040_driver_completion_audit
/root/decision040_driver_writer
/root/decision040_minimal_adversary
/root/decision040_review_a
/root/decision040_review_b
/root/decision040_toolchain
/root/decision040_writer
/root/v5_d037_fresh_preseal_review
/root/v5_d037_postseal_review_a
/root/v5_d037_postseal_review_b
/root/v5_d038_source_checkout_materializer
/root/v5_d038_source_checkout_verifier
/root/v5_d039_source_checkout_materializer
/root/v5_d039_source_checkout_verifier
/root/v5_d040_source_checkout_materializer
/root/v5_formal_preseal_review
/root/v5_materializer
```

Superseded D040 source materializer zůstává forbidden. Identity mimo U40 před
lease je STOP.

### 6.1 Acceptance matrix

1. `R40-01` — B40, D039 terminal red a B37/source pins jsou exact a nezměněné.
2. `R40-02` — subject má právě čtyři docs paths; driver je forbidden/non-evidence.
3. `R40-03` — Review A+B, report-only DAG a final Review-B baseline jsou complete.
4. `R40-04` — exact 36-role universe, quiescence a nepřerušený scoped lease.
5. `R40-05` — exact ff-only promotion; create je úplně další Git child.
6. `R40-06` — CREATE14/CONFIG15/59-element argv a lock payload odpovídají pinům.
7. `R40-07` — root observation je verdict-free; token/count/unknown pole jsou pravdivá.
8. `R40-08` — distinct verifier recompute-ne celý target/admin/index/tree/blob/mode/common-Git/private closure přes READ15.
9. `R40-09` — failure zachová partial stav; žádný retry/cleanup/prune/unlock/reuse.
10. `R40-10` — private repair, evidence, seal, runtime, import, H0/T3/Gates, push/tag/release authority jsou NONE.

### 6.2 Negative fixtures

1. `F40-01-FIFTH-PATH-DRIVER-STAGED-IMPORTED-OR-EXECUTED`
2. `F40-02-D039-RETRY-OR-RED-RECLASSIFIED`
3. `F40-03-REVIEW-B-BASELINE-MISSING-STALE-OR-UNBOUND`
4. `F40-04-IDENTITY-DRIFT-LEASE-GAP-OR-EXTERNAL-ACCESS`
5. `F40-05-NONEXACT-OR-FAILED-PROMOTION-FOLLOWED-BY-CREATE`
6. `F40-06-POST-PROMOTION-PREFLIGHT-DISCOVERY-OR-OTHER-GIT-CHILD`
7. `F40-07-CREATE-ENV-CONFIG-ARGV-FORCE-BRANCH-PATH-OR-HASH-DRIFT`
8. `F40-08-TARGET-ADMIN-RACE-REUSE-RETRY-CLEANUP-PRUNE-OR-UNLOCK`
9. `F40-09-ROOT-POSTREAD-PASS-CLAIM-OR-PREMATURE-VERIFIER`
10. `F40-10-READ15-OR-FULL-VERIFIER-CLOSURE-OMITTED`
11. `F40-11-COUNT-LAUNCH-EXIT-OR-UNKNOWN-LAUNDERED`
12. `F40-12-PRIVATE-EVIDENCE-SEAL-RUNTIME-IMPORT-PUSH-TAG-OR-RELEASE-EFFECT`

Každá fixture independently failne nad isolated synthetic bytes; žádný docs
reviewer ji nevyvolává proti live common Git/private rootu.

## 7. DAG/gates a abandoned driver

Subject exact four paths: Decision040, batch, README a toto WP. Reserved report
`docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-toolchain-remediation-20260818-report.md`
je absent. DAG je B40→S→E_A→C(ordered parents `[B40,E_A]`)→E_B→canonical
ff-only. Review B po report commit dokončí §3 handoff; report obsahuje jen exact
six lines.

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: c38e1b24849521b41025e70a37bf0219466c9d1e
subjectHead: <full-S_H0V5SRC040-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC040-sha>
reviewB.verdict: PASS
```

Dva fresh precommit audits musí dát PASS/P0=0/P1=0. Gates: B40/tree/clean,
four paths/report absent, exact closed placeholder allowlist/counts,
red/replacement/state parity, artifact 151/151, registry382+8, hygiene1622,
diff-check. Allowed angle-bracket occurrences jsou právě tři: v tomto WP tokeny
`full-E_B_H0V5SRC040-sha`, `full-S_H0V5SRC040-sha` a
`full-C_H0V5SRC040-sha` každý jednou; Decision má E_B dvakrát a S/C jednou.
Jiný token/počet je red. Non-PASS nic nepromuje; žádný push/tag/release/rewrite.

Abandoned isolated driver nebyl frozen/imported/staged/committed/promoted ani
spuštěn CREATE/VERIFY. Audit snapshot
`b619d0f694a9e8153873d8bd66b6e273fe8c51b77c383049d2afc26cb2b080e6`
měl 119 197 bytes a unresolved closure/I/O/vocabulary blockers. Dřívější
`py_compile` transientně vytvořil exact 86 011-byte pyc pod `__pycache__`, který
byl po inventuře odstraněn; není evidence. D040 nemá driver path ani helper.

Fresh audit replacement tree zaznamenal `/usr/bin/rg` `ENOENT` a použil
read-only `/usr/bin/grep` pro stejné patterns. Nevznikl write ani coverage gap;
incident není PASS evidence ani operational input.

První author aggregate Decision+WP `apply_patch` měl context mismatch a zero
modifications; opravený aggregate landed celý bez partial patch nebo
repository/private/runtime effectu.

Dokud nejsou oba audity PASS, D040 je frozen uncommitted subject bez
operational authority; D039 je terminal a V5 zůstává unsealed.
