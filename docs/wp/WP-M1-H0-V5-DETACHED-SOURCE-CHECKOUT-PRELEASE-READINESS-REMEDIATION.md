# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELEASE-READINESS-REMEDIATION

**Výsledek:** exact four-doc governance-only náhrada terminal D040 prelease
authority. Po external-only odstranění persistent open-CWD konfliktů proběhne
právě jeden fresh bounded readiness run z cwd `/`; pouze jeho complete
`PRELEASE_READY` handoff dovolí stejným lease root promotion→CREATE a distinct
post-create verifier closure.

**B41:** `d0a1c91c76eea039dddf428e57cd758c26a9c81f`

**B41 tree / paths:** `5c09b012ebc06556217022d15d25873511c3a8af` /
`1623`

**Stav subjectu:** `FROZEN_FOR_PRECOMMIT_AUDITS /
NO_OPERATIONAL_AUTHORITY`

## 1. Immutable incident a supersession

D040 Review A+B docs jsou PASS, ale final baseline je
`NOT_READY / OPERATIONAL_RUN_NOT_STARTED`. Raw machine `failedGate` je
`ABSENT/UNKNOWN`; normalized failure reason je
`PERSISTENT_RELEVANT_OPEN_CWD_CONFLICTS`, protože conflicts nesplnily požadovaný
`no-open-handle/exclusive-all-linked-worktrees` gate. D040 E_B/tree jsou
`d0a1c91c76eea039dddf428e57cd758c26a9c81f` /
`5c09b012ebc06556217022d15d25873511c3a8af`. Její Decision/WP/report blob jsou
`7f8893ac1fa62b6b0f2a608da39bbdc2b0f92f61`,
`0df49aa1c56841136c33666cf359474e91f6de0b`,
`2a71811f34e249ca632c1ab482c2f0917d5e9393`; content SHA jsou
`15fe95c651d9eda554f922b27a3767989e4de8d4b986e00df20a837988802494`,
`ef05b22a169ce54a53772a1b15f1eec4000d1c3bc9ffebc66d434555b3ccb1fd`,
`ee8928dec031e5d04fb911e08d497d8077ecdb8e44b3276c74d5ca5a3a84207c`.
Tyto tři paths se nesmějí editovat.

Ignored-aware status měl exact 52 bytes/SHA
`a53322e2815a423a74fe1de3fca2b37b49b142eaa6efe9c411916ac2f192c9ac`
a NUL-terminated entries `.env`, `.intentsmith-artifacts/`, `node_modules/`.
Incident baseline/component/transcript SHA jsou:

```text
baseline 11d6bc4b7d9e8b8104255842be193f19a9a087a2df4f3988be490e0c1b6d5a6e
commonFull bfe051d27943c0ea518518a3591a335da77d3110b794276e9babb8aa0d8b25e8
commonStable ad98a8e439c4a5a735877dd10c72ba2ba9a5cd06693cabd287d3ec07231d892c
objects d07404e5e7a28d85f724f4f84728981e0c33cd468599f36c144e1234863a4a95
preexistingWorktreesStable 6ffed39239a432cf500997fd02d65b7aa9fed2e5b1c1e65a0c6591f63b4b5fa0
canonicalFull ad2db6476b1a75895ca4e71ba4d78eb7c6aaac11c0c1b78082ebcaa125e7d95f
canonicalStable c99871c9de7691f65a5d456e7ecbbd762a927a6f2f6d1193967b4e60cfef9b67
private 769d879acbce7990ee0eed385a7b1ca06337a41f0ffc30cb485e3bc4da75047b
red a89fa13c040ac19d74e660cd4ab72491ace9f119cd62230b04e1b18e60d05ab5
transcript61 ad6d82955efc582edb83161b19a6ca1fb14a82eac58c4a5fcfb9147f08d54f0b
```

Conflicts byly `/usr/bin/yes` PID `1856386`–`1856389`, uid 1000, start
`2026-08-12 22:56:28`, timezone `CEST`, parent user-systemd, cgroup
`app-code-1440411.scope`, cwd
`/home/belphareon/worktrees/is-mobile-alpha`; idle parent-Konsole `/bin/bash`
PID `2108159`, uid 1000, start `2026-08-13 01:11:55`, timezone
`ABSENT/UNKNOWN`, no children, cgroup `UNKNOWN`, cwd
`/home/belphareon/Projects/intentsmith`; adb fork-server PID `2716498`, uid
1000, start `2026-08-17 23:03:14`, timezone `ABSENT/UNKNOWN`, parent
user-systemd, cgroup `app-code-2134440.scope`, cwd
`/home/belphareon/worktrees/is-mobile-prototype-codex`.

První outside-U40 identity `/root/decision041_architect` vznikla před D040
lease. D040 je proto
`SUPERSEDED_BEFORE_LEASE / TERMINAL_STOP /
PRELEASE_IDENTITY_UNIVERSE_DRIFT`. Historické D040 CREATE/VERIFY zůstávají
`UNMINTED`, promotion/create `0`/`false`, lease never activated a authority
`FORECLOSED_UNCONSUMED`. D040 se nesmí retryovat ani recyklovat.

WP nemá kill/pkill/signal/cgroup/systemd/ADB/Konsole/chdir/FD/worktree cleanup
authority. Cleanup je external-only. Zmizení známých PIDů není readiness
evidence.

`/root/decision040_review_b` je od `NOT_READY` permanentně fenced: žádný
follow-up/reactivation/read; v U41 je jen excluded historical identity.

## 2. Live source a fresh D041 namespace

Live source je jen B37 `df1863439b6ad83abf41396ba8063e5bffaa599e`, tree
`1f0e730a46a94a7f741b2dbf47426458b8125a97`, 1 614 paths. Target/admin jsou:

```text
/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
/home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
```

Canonical zůstává před operational runem
`c38e1b24849521b41025e70a37bf0219466c9d1e`.

Fresh identifiers jsou `D041-PRELEASE-READINESS-01`, `D041-CREATE-01`,
`D041-VERIFY-01` a lease
`D041-H0V5-DETACHED-SOURCE-CHECKOUT-LEASE-01`. Committer je
`M1-D041-Worktree` / `m1-d041-worktree@localhost`; reason je
`Decision041-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e`.

| Input | Elements / bytes | SHA-256 |
|---|---:|---|
| CREATE14 | `14` / `339` | `c4bdf8db268a75474aa066ed8ad6782cda5bb748947704b1b24fb918dacc5205` |
| READ15 | `15` / `362` | `938f6d523967cfcc9789f2369ce90945bd13edd43ebe046dd3eac1ff6ab4be74` |
| CONFIG15 | `15` / `393` | `e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085` |
| CREATE argv | `59` / `1171` | `5d0a37198ba277c2b74081c132d6badd14f0d8bc4a41566478f5833e60874a51` |
| promotion template | `53` / `953` | `2fa17f2b2453ebbba32c3d3c1bf6f51b1ac7d82d7893682c05d7a1df84620cd8` |
| lock reason+LF | `1` / `80` | `6a7aca0e88869ffab2f605f019eb3509de29ad83100a5a9784b687e48afdaa24` |

Promotion template končí jedinou substitucí
`<full-E_B_H0V5SRC041-sha>`; fully substituted compact JSON+LF má 968 bytes a
readiness handoff připne jeho actual SHA. CREATE je exact 59-element
`umask 077` + `env -i` + CREATE14 + Git/CONFIG15 + no-force detached locked
worktree add na fixed target/B37. READ15 přidává `GIT_OPTIONAL_LOCKS=0` před
D041 committer a všechny Git reads mají `/usr/bin/git --no-optional-locks`.

## 3. U41, reviewers a exact exclusions

Live roles: writer `/root/decision041_writer`, adversary
`/root/decision041_adversary`, architect `/root/decision041_architect`, Review A
`/root/decision041_review_a`, Review B `/root/decision041_review_b`, sole
issuer/promoter/creator `/root`, readiness
`/root/v5_d041_prelease_readiness_verifier` a post-create
`/root/v5_d040_source_checkout_verifier`.

Exact `U41` je exact D040 U40 plus právě:

```text
/root/decision041_adversary
/root/decision041_architect
/root/decision041_review_a
/root/decision041_review_b
/root/decision041_writer
/root/v5_d041_prelease_readiness_verifier
```

U41 má 42 sorted entries. Readiness/root/post-create exclusion set je vždy
sorted U41 bez právě aktuálního holdera a má 41 entries. Žádná sedmá D041
identity není povolena. Review B po static/candidate handoffu je fenced;
operational baseline nevlastní.

## 4. One-shot readiness a holder transfer

Po E_B41 PASS a external user cleanup signálu `/root` bez Git/direct-FS readu
task-channelem issue+activate-ne právě `D041-PRELEASE-READINESS-01`.
Orchestrator v témž boundary aktivuje lease generation `1`, holder exact
readiness verifier. Všechny jeho subprocessy mají cwd exact `/`, absolutní
paths a každý Git read exact D041 READ15 envelope. Žádný child cwd nesmí být
pod common/worktree/private scope.

Jediný bounded fresh run recompute-ne D041+D040 DAG/report/bloby/path topology,
canonical head/tree/index/status/ignored, B37 closure, target/admin/ref/
worktree/lock absence, config/info/mount, common/objects/pre-existing worktrees,
private/red, exact U41/token/lease/command pins a system-wide relevant process
cwd/root/fd/mmap/open-handle set. Použije inherited canonical serializer a
ordered transcript, ale vydá nové component digesty plus aggregate record
count/digest. D040 61-record transcript a jeho component hashes jsou jen
historical incident evidence, nikdy live baseline.

Prescribed before/after captures uvnitř jediného auditu jsou povolené; polling,
wait-and-rescan, monotonic retry a druhý attempt ne. Final capture je poslední
metadata-derived input. Potom smí jen complete task-channel handoff
`PRELEASE_READY / COMPLETE`, který spotřebuje readiness token jako PASS,
tedy `CONSUMED-PASS`, fence-ne verifier a bez gapu převádí tentýž lease na
`/root`; CREATE/VERIFY
zůstávají `UNMINTED`.

Complete observed drift je `NOT_READY`; incomplete tool/permission/schema
audit `BLOCKED`; unprovable dispatch/launch/outcome/transfer `UNKNOWN`.
Každý non-PASS má absent handoff, consumed readiness token, closed lease,
CREATE/VERIFY `CANCELLED_UNISSUED` a terminal foreclosed D041 bez retry nebo
cleanupu.

## 5. Promotion→CREATE→post-verifier

Po complete handoffu root neprovádí self-preflight, Git/libgit2/JGit/direct
metadata ani process read. Exact D041 53-element promotion je next Git child a
smí udělat jen ff-only canonical B40→E_B41 delta. Každý failed/nonzero/signal/
timeout/unknown promotion outcome terminalně ruší nevydané CREATE/VERIFY.

Při exit `0`/no-signal root issue+activate-ne D041 CREATE a exact 59-element
worktree-add je velmi další Git child bez intervening accessu. Issued CREATE se
v každém terminal outcome spotřebuje. Nonzero/partial/race zachová stav bez
retry, cleanup, prune, unlock nebo alternate target. Exit `0` je pouze
`CREATE_COMPLETED_UNVERIFIED`.

Pouze create exit `0` dovolí issue+activate D041 VERIFY a atomic holder transfer
na existující `/root/v5_d040_source_checkout_verifier`. Ten nesmí použít nebo
přijmout D040 token/baseline/READ15; pod fresh D041 authority recompute-ne
promoted DAG/report, transcript/adjacency, detached B37, ignored/status/stage,
1 614-leaf filesystem/blob/mode closure, same-FD index/info/config controls,
common Git proti readiness baseline s exact promotion+target/admin allowlistem
a private no-touch. Root nevydává PASS.

Complete mismatch je `CHANGES_REQUIRED`; incomplete audit `BLOCKED` s absent
handoff. VERIFY se vždy spotřebuje a lease se uzavře. Pouze verifier-owned
PASS odemyká dosud unconsumed D037 private repair.

## 6. Acceptance matrix a fixtures

1. `R41-01` — D040 docs PASS + `NOT_READY` + outside-U40 terminal supersession preserved.
2. `R41-02` — B41=`d0a1c91c76eea039dddf428e57cd758c26a9c81f`, tree=`5c09b012ebc06556217022d15d25873511c3a8af`, 1 623 paths + exact four subject paths/report-only DAG.
3. `R41-03` — exact U41=42 and exclusions=41 with no seventh D041 identity.
4. `R41-04` — fresh D041 token/lease/committer/reason/READ15/CONFIG15/argv/lock pins.
5. `R41-05` — external-only process cleanup + exactly one fresh bounded readiness run.
6. `R41-06` — complete `PRELEASE_READY` and uninterrupted lease holder transfer readiness→root→post-verifier.
7. `R41-07` — exact ff-only E_B41 promotion and CREATE as next Git child.
8. `R41-08` — existing `/root/v5_d040_source_checkout_verifier` uses only D041-VERIFY-01/D041 READ15 and full closure.
9. `R41-09` — truthful count/launch/unknown terminal no retry/cleanup.
10. `R41-10` — no private/evidence/seal/runtime/import/push/tag/release authority.

1. `F41-01-D040-AUTHORITY-TOKEN-LEASE-COMMITTER-OR-LOCK-REUSED`
2. `F41-02-D040-NOT_READY-IDENTITY_DRIFT-OR-SUPERSESSION-LAUNDERED`
3. `F41-03-U41-SEVENTH-IDENTITY-ROLE-DRIFT-OR-FENCED-ROLE-REACTIVATED`
4. `F41-04-FIFTH-SUBJECT-PATH-OR-D040-DOC-REPORT-EDIT`
5. `F41-05-PROCESS-KILL-SIGNAL-CGROUP-CWD-FD-OR-WORKTREE-CLEANUP`
6. `F41-06-READINESS-POLL-MONOTONIC-RETRY-SECOND-ATTEMPT-OR-PID-DISAPPEARANCE-INFERENCE`
7. `F41-07-STALE-PARTIAL-HANDOFF-ROOT-SELF-PREFLIGHT-OR-LEASE-GAP`
8. `F41-08-D041-ENV-CONFIG-PROMOTION-CREATE-READ15-LOCK-OR-HASH-DRIFT`
9. `F41-09-FAILED-PROMOTION-FOLLOWED-BY-CREATE-INTERVENING-GIT-EXTERNAL-RACE-OR-NONFF`
10. `F41-10-D040-TOKEN-ACCEPTED-BY-POSTVERIFIER-OR-D041-CLOSURE-OMITTED`
11. `F41-11-COUNT-LAUNCH-EXIT-UNKNOWN-TOKEN-RETRY-CLEANUP-PRUNE-OR-UNLOCK-LAUNDERED`
12. `F41-12-PRIVATE-EVIDENCE-SEAL-RUNTIME-IMPORT-PUSH-TAG-OR-RELEASE-EFFECT`

Každá fixture independently failne pouze nad isolated synthetic bytes.

## 7. DAG, paths, report a gates

Subject exact four paths jsou Decision041, `docs/execution/m1-batch.md`,
`docs/wp/README.md` a toto WP. D040 Decision/WP/report nejsou subject. Reserved
report
`docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-prelease-readiness-remediation-20260818-report.md`
je na B41 i subjectu absent.

DAG je B41→S→E_A→C(ordered parents `[B41,E_A]`, tree=E_A)→E_B→canonical
ff-only. Review A vytvoří exact four-line report; Review B připojí jen dvě
řádky a potom je fenced:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: d0a1c91c76eea039dddf428e57cd758c26a9c81f
subjectHead: <full-S_H0V5SRC041-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC041-sha>
reviewB.verdict: PASS
```

Subject má 1 625 paths, reportový tree 1 626. Dva fresh zero-based precommit
audity musí dát `PASS/P0=0/P1=0`. Gates ověří B41/tree/clean writer, exact four
paths/report absence, preserved D040 blobs/report, incident/supersession,
U41/exclusions, matrix/fixtures, command-hash recomputation, placeholder
allowlist, artifact validation, registry, hygiene a diff-check.

Allowed placeholders jsou v tomto WP právě tři: E_B, S a C token každý jednou;
Decision má E_B dvakrát a S/C jednou. Non-PASS nic nepromuje. Private repair,
evidence, seal, runtime, import, H0/T3/Gates, push/tag/release/rewrite authority
jsou NONE.
