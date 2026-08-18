# 040 — Minimální promotion-to-create remediation po spotřebované D039

- **typ:** exact four-doc governance-only operational remediation; žádný
  tracked executable/helper a žádná private/runtime authority
- **stav subjectu:** `MINIMAL_CONTRACT_FROZEN_FOR_PRECOMMIT_AUDITS /
  NO_OPERATIONAL_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B40:**
  `c38e1b24849521b41025e70a37bf0219466c9d1e`
- **baseTree:** `0b0cdff832b18cb75fcfd0ed2ed42e0701cc5a7e`
- **výsledek až po Review A+B:** Review B dokončí poslední baseline a je
  fenced; sole executor `/root` pod jedním lease ff-only promuje D040 a při
  exit `0` spustí exact worktree-add jako bezprostředně následující Git child;
  celý poststate od nuly posoudí distinct verifier

Final minimal adversary ruling je `BATCH_CLOSED / PASS / IMPLEMENTABLE /
P0=0/P1=0`. Tento verdikt potvrzuje návrh kontraktu, nikoli subject review,
operational run nebo source checkout PASS. Subject se nesmí commitnout před
dvěma fresh zero-based precommit audity.

## 1. Důvod a minimální princip

Decision039 byla řádně promoted na B40. Její operational run ale spotřeboval
jedinou authority prvním Git readem, který neodpovídal exact D039 envelope.
Create command se nespustil a target/admin zůstaly absent. D039 se nesmí
retryovat, reopenovat ani reinterpretovat jako unconsumed.

První návrh D040 se pokusil odstranit ad-hoc command assembly tracked Python
driverem. Jeho audit ukázal, že bezpečně znovu implementovat celý Git/filesystem
closure engine by rozšířilo attack surface a oddálilo M1. Tento směr je
abandoned před subjectem: žádný driver path není v D040 allowlistu, nic se
neimportuje do canonical a partial source není operational input ani evidence.

Finální minimální model přesouvá poslední pre-effect baseline do Review B.
Po jeho task-channel handoffu nesmí root znovu objevovat stav. Root aktivuje
exclusive lease, provede jedinou ff-only canonical promotion a při success
vydá CREATE; exact `git worktree add` je **velmi další Git child**, bez
intervening Git nebo direct common-metadata readu. Command nemá `--force`,
branch creation ani cleanup path. Persistent detected target/admin conflict
musí skončit nonzero; jakýkoli external access/race je ale sám terminal lease
violation bez ohledu na command exit a exit `0` neprokazuje jeho absenci. Root
pouze zachová command outcome; celý post-create closure a verdict vlastní
distinct verifier.

## 2. Exact B40, D039 promotion a live source

B40 má 1 620 tracked paths. Immutable promoted D039 inputs jsou:

| Artefakt | Git blob | SHA-256 obsahu | Bytes |
|---|---|---|---:|
| Decision039 | `edefbc26a0ac4fa1dfc0645cff91be7b2572a4b5` | `a929b21cfe6e80ae9f6fcbff9548893a686395373ce28b6d9b31a7d095febb77` | 35 551 |
| Decision039 WP | `c89eb1043c00abfbbca5d7315385647cb87e7e3c` | `0ab76b79187fef6f429e865d65737a3b43eb22ed46391172782de173598c3750` | 25 189 |
| promoted D039 report | `a4c6cbc878f1c2ebb1b17858c6f3b3e104798632` | `b9ea97fd54bd0a04b0608d0c1c98ccb009c83faf61a2d59af96973e649cd4fd6` | 262 |

Report má právě:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 9205a906602cbd6e9a0e6cf3ebe8d30ed06113c2
subjectHead: ea5d0ca92e5c96288cf99315c13b477d53071a85
reviewA.verdict: PASS
candidateHead: 707940ecf294d9746c04221e6deb2064ab52cd56
reviewB.verdict: PASS
```

D039 decision/WP/report se needitují. Jejich docs PASS není operational PASS.
Live static/source base zůstává výhradně Decision037 Review B:

| Pole | Exact hodnota |
|---|---|
| B37 | `df1863439b6ad83abf41396ba8063e5bffaa599e` |
| tree | `1f0e730a46a94a7f741b2dbf47426458b8125a97` |
| tracked paths | `1614` |
| JSON+LF path-set SHA-256 | `51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea` |
| raw `ls-tree` bytes/SHA | `151786` / `f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6` |
| modes/dirs | `1598` regular / `16` executable / `355` derived dirs |

Target/admin/canonical jsou exact:

```text
/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
/home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
/home/belphareon/worktrees/is-m1-consolidated
```

Target/admin jsou při D040 author inventuře absent. Review B je musí znovu
prokázat ve své final baseline; root je po handoffu už nečte.

Common config/info/mount, frozen V5 OLD triple/evidence/no-seal a authentic red
recorder zůstávají exact D039/D038 pins. V5 private root je
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74`,
birth `2026-08-18T08:32:50.000727718Z`; plan/runner/strategy SHA jsou
`c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca`,
`0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb`,
`26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d`.

## 3. Authoritative terminal D039 incident

| Pole | Exact hodnota |
|---|---|
| state / authority | `BLOCKED_BEFORE_ATTEMPT` / consumed |
| failed gate | `PRELAUNCH_GIT_READ_ENVELOPE_NOT_EXACT_D039` |
| CREATE | issued+activated, terminal consumed |
| count / launch | `0` / `false` |
| snapshot / create GO | absent / `false` |
| VERIFY | `CANCELLED_UNISSUED` / `NO_RUN` |
| toolcall ordinal | `1` |
| actual env / config counts | `6` / `5` (`4` allowed + unauthorized `commit.gpgSign=false`) |
| wall time / exit / signal / stdout / stderr | `UNKNOWN` |
| creator observation / verified handoff | absent / absent |
| target/admin/private/runtime/push | none observed |

Raw ordered argv byl:

```text
/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 /usr/bin/git --no-optional-locks -C /home/belphareon/worktrees/is-m1-consolidated -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.attributesFile=/dev/null -c core.excludesFile=/dev/null -c commit.gpgSign=false ls-tree -r --name-only c38e1b24849521b41025e70a37bf0219466c9d1e -- docs/decisions
```

Chyběly `LANG`, `TZ`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `SSH_ASKPASS`,
`SSH_ASKPASS_REQUIRE`, `GIT_NO_LAZY_FETCH`, D039 committer name/email a
expected `core.untrackedCache`, `core.splitIndex`, `core.sparseCheckout`,
`core.sparseCheckoutCone`, `submodule.recurse`, `maintenance.auto`, `gc.auto`,
`fetch.writeCommitGraph`, `protocol.allow`, `worktree.guessRemote`,
`checkout.workers`; allowed configy byly v chybném pořadí.

Pozdější toolcall 9 `rg` ENOENT a 2 624 bytes/SHA
`45d002f6da445c78835b5c8daacee2786162faceaf632c86891bd8e0f37268aa`
jsou `SUPERSEDED / NONCANONICAL / NON_EVIDENCE`. Canonical observation je
absent a všechna UNKNOWN pole zůstávají UNKNOWN.

## 4. Selective inheritance a explicit replacement

D040 selektivně inkorporuje z exact Decision039 blobu §2 a jeho §4 pouze pro
immutable B37/private/common pins a transitive D038 closure. Z Decision038
exact blobu zůstávají normativní §5.2–§5.5 create/read/index/info/config/admin/
FS-tree-blob protocols a invariants pouze s těmito úplnými substitucemi:

1. D038 §5.4 preflight boundary je nahrazena Review-B final baseline. Její
   creator-immediate a creator-final captures jsou nahrazeny verifier captures
   před prvním a po posledním verifier Git readu; root žádnou z nich neprovádí.
   První verifier index capture se stane run-specific pinem a druhá s ním musí
   být byte/stat-identická. Same-FD/no-follow `lstat/fstat`, stat fields,
   byte-count/SHA, typed config parser, absence `config.worktree` a mount pin
   zůstávají exact D038. Pozdější materializer before-first/after-last
   boundaries zůstávají beze změny a stále předcházejí private effectu.
2. D038 §5.5 canonical/common byte-identical věta je nahrazena jediným
   allowlistem změn: Review-B pre-pinned exact B40→E_B fast-forward canonical
   delta, nový exact target/admin subtree a parent directory metadata nutně
   změněná jejich vytvořením. Všechny ostatní refs, objects, config, info,
   private bytes a pre-existing worktree controls jsou byte/stat invariantní
   proti Review-B baseline.

Z D038 §5.6 zůstává pouze terminal no-cleanup/no-retry semantics.

**D040 výslovně neinkorporuje a úplně nahrazuje** D039 §6 creator preflight,
final snapshot/GO, creator→verifier token machinery a D039 §8 creator
observation. Neplatí žádná implicitní dědičnost starého creator tasku,
preflightu, snapshotu, driveru nebo handoffu.

| Staré pole | Exact D040 náhrada |
|---|---|
| consumed D039 authority | nový D040 promotion/create/verify sequence až po Review B PASS |
| D039 creator | sole creator/executor `/root` |
| D039 verifier | `/root/v5_d040_source_checkout_verifier` |
| creator preflight/final snapshot | final baseline + closure dokončí Review B před fencingem; root po handoffu nic znovu nečte |
| creator→verifier scheduling | root drží lease přes promotion+create; po exit0 předá holdera přímo verifierovi bez root post-readu |
| D039 CREATE/VERIFY tokeny | nové D040 tokens/states podle §6; staré zůstávají terminal |
| D039 committer | `M1-D040-Worktree` / `m1-d040-worktree@localhost` |
| D039 lock reason | `Decision040-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e` |
| `locked` control | 80 bytes/SHA `028d30b89eb63a591e00e4b6ec8549f7df51397d553800f3b9c9b33276a5f397` |
| root post-create evidence | pouze raw command outcome; žádný creator PASS/verdict ani inferred closure |
| entire poststate | distinct verifier recompute od nuly podle inherited D038 closure |
| target cleanup/retry | NONE; failure/partial se zachová frozen |
| tracked driver/helper | NONE; abandoned partial driver není subject ani operational input |

D037 B37 zůstává live base. B40, D040 subject/candidate/promotion jsou pouze
governance ancestry.

## 5. Review B final baseline a fencing boundary

Fresh Review B po vytvoření svého direct-child evidence commitu provede ještě
poslední read-only final baseline podle exact no-write envelope. Handoff musí
task-channelem byte-bindnout:

- D040 B40/S/E_A/C/E_B topology, trees, exact four subject paths a six-line
  report;
- canonical checkout exact B40, clean state a expected ff-only destination
  E_B;
- local B37 commit/tree/object closure bez replace/promisor/alternate;
- target/admin any-type absence, non-symlink parents, no worktree/ref/admin
  alias, zero relevant lock files a no relevant open-handle conflict;
- common config/info/mount typed pins a full common-Git/preexisting-worktree
  before manifest;
- expected canonical promotion delta allowlist a exact new target/admin delta
  allowlist;
- frozen private OLD/evidence/no-seal/red pins;
- exact promotion and create env/config/argv bytes, command order, counters,
  tokens, lease generation, root/verifier identities a exclusion sets.

Review B handoff není runtime PASS ani post-create evidence. Po complete
handoffu musí Review B a všichni ostatní Git/direct-common-metadata consumers
být fenced; Review-B worktree se nemaže ani neupravuje. Pokud baseline není
complete nebo fencing/quiescence nelze potvrdit jen orchestration channel,
D040 operational run je `NOT_STARTED`, tokeny unissued a authority unconsumed.
Root v této readiness fázi nesmí doplnit chybějící fakt vlastním
Git/direct-metadata readem.

## 6. Exact lease, promotion-to-create adjacency a tokens

Lease pokrývá common Git, refs, objects, config, info, všechny worktree admin
paths, všechny linked worktrees, canonical checkout, target/admin namespace,
frozen private root a Git i direct metadata/filesystem access všech ostatních
rolí. Před promotion jsou `D040-CREATE-01` i `D040-VERIFY-01` `UNMINTED` a
vlastní `promotionAttemptCount=0`, `commandAttemptCount=0`, `launch=false`.

Úplná pre-child stavová tabulka je:

| Boundary | `promotionAttemptCount` | `promotionLaunch` | promotion outcome | CREATE token | VERIFY token | `commandAttemptCount` | create `launch` | create outcome | authority/next action |
|---|---:|---:|---|---|---|---:|---:|---|---|
| lease active, před promotion spawn | `0` | `false` | absent | `UNMINTED` | `UNMINTED` | `0` | `false` | absent | live; exact promotion musí být next Git child |
| known promotion launcher/pre-child failure | `0` | `false` | absent | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` | `false` | absent | terminal; žádný create/verifier |
| promotion dispatch/launch nelze prokázat | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` | `false` | absent | terminal; žádný create/verifier |
| promotion launch prokázán, outcome neznámý | `1` | `true` | `UNKNOWN` | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` | `false` | absent | terminal; žádný create/verifier |
| promotion exact success, před CREATE issuance | `1` | `true` | exit `0`, no-signal | `UNMINTED` | `UNMINTED` | `0` | `false` | absent | live; smí následovat jen task-channel issuance |
| promotion success, known failure před CREATE issuance | `1` | `true` | exit `0`, no-signal | `CANCELLED_UNISSUED` | `CANCELLED_UNISSUED` | `0` | `false` | absent | terminal; žádný create/verifier |
| CREATE issued+activated, před create child | `1` | `true` | exit `0`, no-signal | `ISSUED_AND_ACTIVATED` | `UNMINTED` | `0` | `false` | absent | live; exact create musí být next Git child |
| CREATE issued, known pre-child spawn failure | `1` | `true` | exit `0`, no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `0` | `false` | `NO_RUN` | terminal; žádný subsequent create/verifier |
| create dispatch/launch nelze prokázat | `1` | `true` | exit `0`, no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | terminal; žádný subsequent create/verifier |
| create launch prokázán, outcome neznámý | `1` | `true` | exit `0`, no-signal | `CONSUMED` | `CANCELLED_UNISSUED` | `1` | `true` | `UNKNOWN` | terminal; žádný subsequent create/verifier |

`UNMINTED` je pouze live stav. Po lease activation používá každý terminal nikdy
nevydaný token `CANCELLED_UNISSUED`. Attempt/launch jsou `1`/`true` jen při
prokázaném child launchi, `0`/`false` při prokázaném no-spawn a
`UNKNOWN`/`UNKNOWN`, nelze-li launch hranici prokázat. Neprokazatelný outcome
zůstává `UNKNOWN`; nesmí se odvodit z absence outputu, targetu nebo admin
pathu. Každá terminal řádka foreclose-ne authority bez následného
create/verifier runu, retry nebo cleanupu.

Exact promotion argv template má 53 elements: `/usr/bin/env`, `-i`, ordered
CREATE14, `/usr/bin/git`, `-C`, exact canonical, každý CONFIG15 jako ordered
`-c` pair a tail `merge --ff-only --no-edit <full-E_B_H0V5SRC040-sha>`.
Nemá umask wrapper ani optional-lock suppression. Review B byte-bindne fully
substituted argv v PRELEASE_READY. Root jej spustí jako jediný promotion Git
child; CONFIG15 vypíná hooks, attrs/excludes overrides, fsmonitor, caches,
sparse/split index, recurse, maintenance, GC, fetch graph, protocol a remote
guessing.

Exact ordered 53-element template je následující JSON array; Review B nahradí
jediný angle-bracket element full E_B SHA a byte-bindne výsledné canonical
JSON+LF i skutečné argv:

```json
[
  "/usr/bin/env",
  "-i",
  "PATH=/usr/bin:/bin",
  "LANG=C",
  "LC_ALL=C",
  "TZ=UTC",
  "GIT_CONFIG_NOSYSTEM=1",
  "GIT_CONFIG_GLOBAL=/dev/null",
  "GIT_TERMINAL_PROMPT=0",
  "GIT_ASKPASS=/bin/false",
  "SSH_ASKPASS=/bin/false",
  "SSH_ASKPASS_REQUIRE=never",
  "GIT_NO_LAZY_FETCH=1",
  "GIT_ATTR_NOSYSTEM=1",
  "GIT_COMMITTER_NAME=M1-D040-Worktree",
  "GIT_COMMITTER_EMAIL=m1-d040-worktree@localhost",
  "/usr/bin/git",
  "-C",
  "/home/belphareon/worktrees/is-m1-consolidated",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "core.excludesFile=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "core.splitIndex=false",
  "-c",
  "core.sparseCheckout=false",
  "-c",
  "core.sparseCheckoutCone=false",
  "-c",
  "submodule.recurse=false",
  "-c",
  "maintenance.auto=false",
  "-c",
  "gc.auto=0",
  "-c",
  "fetch.writeCommitGraph=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "worktree.guessRemote=false",
  "-c",
  "checkout.workers=1",
  "merge",
  "--ff-only",
  "--no-edit",
  "<full-E_B_H0V5SRC040-sha>"
]
```

Normativní sekvence už nyní nemá volitelnou větev:

1. `/root` obdrží complete Review B handoff pouze task-channelem.
2. Orchestrator vyloučí všechny ostatní Git/direct-common-metadata consumers a
   atomicky aktivuje one-holder exclusive lease na `/root`.
3. Root spustí právě jeden exact 53-element canonical ff-only promotion child;
   launch mění `promotionAttemptCount 0 -> 1`. Žádný force/reset/checkout/rebase,
   merge commit, hook, fetch, maintenance, GC nebo history rewrite.
4. Pokud promotion exit není exact `0`/no-signal, CREATE/VERIFY zůstanou
   `CANCELLED_UNISSUED`, run je terminal a jejich issuance je navždy
   foreclosed; nic se neopravuje ani neopakuje.
5. Při exact promotion success root bez jediného intervening Git child,
   libgit2/JGit access nebo direct common-metadata readu issue+activate CREATE.
   Task-channel token transition a kontrola předchozího process outcome nejsou
   Git/direct metadata access.
6. Exact fixed `git worktree add` je velmi další Git child. Launch atomicky
   mění vlastní D040 create count `0 -> 1` a `launch=false -> true`; již
   issued+activated CREATE se při každém terminal outcome spotřebuje. Command nemá
   force, branch ani alternate target. Persistent detected target/admin
   conflict proto musí skončit nonzero; exit `0` sám absenci race neprokazuje.
7. Nonzero/signal/timeout/unknown/partial je terminal STOP/FREEZE bez retry,
   cleanup, prune, repair, unlock nebo alternate path. Root zachová raw process
   outcome.
8. Exit `0` vytváří pouze `CREATE_COMPLETED_UNVERIFIED` a dovolí atomický
   issue+activate `D040-VERIFY-01` + holder transfer root
   -> exact verifier. Root před transferem ani potom neprovede post-create
   Git/direct-metadata read a nevydá PASS.
9. Verifier v jediném read-only runu recompute celý poststate od nuly. Teprve
   jeho complete handoff může mít `PASS|CHANGES_REQUIRED`; blocker má task
   outcome `BLOCKED` a handoff absent. Token se vždy terminal spotřebuje a
   lease se při každém verifier outcome uzavře.

Promotion a CREATE jsou oddělené child outcomes, ale jejich Git-child
adjacency je hard invariant. Jakýkoli jiný Git child/read mezi nimi nebo jiný
external access/race je terminal lease violation bez ohledu na command exit,
even if outputs vypadají clean. Zákaz force/clobber omezuje effect surface, ale
exit `0` není důkaz absence external accessu ani race.

## 7. Exact create a verifier contracts

CREATE command zůstává D039 exact `umask 077` + `/usr/bin/env -i` + 14 env
assignments + `/usr/bin/git -C canonical` + 15 hardened `-c` pairs +
`worktree add --detach --checkout --no-guess-remote --lock --reason`, s jedinou
D040 committer/lock substitution, same target a B37. Canonical env/config/argv
pins jsou:

```bash
(
  umask 077
  exec /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    LANG=C LC_ALL=C TZ=UTC \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
    SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
    GIT_NO_LAZY_FETCH=1 \
    GIT_ATTR_NOSYSTEM=1 \
    GIT_COMMITTER_NAME=M1-D040-Worktree \
    GIT_COMMITTER_EMAIL=m1-d040-worktree@localhost \
    /usr/bin/git \
      -C /home/belphareon/worktrees/is-m1-consolidated \
      -c core.hooksPath=/dev/null \
      -c core.attributesFile=/dev/null \
      -c core.excludesFile=/dev/null \
      -c core.fsmonitor=false \
      -c core.untrackedCache=false \
      -c core.splitIndex=false \
      -c core.sparseCheckout=false \
      -c core.sparseCheckoutCone=false \
      -c submodule.recurse=false \
      -c maintenance.auto=false \
      -c gc.auto=0 \
      -c fetch.writeCommitGraph=false \
      -c protocol.allow=never \
      -c worktree.guessRemote=false \
      -c checkout.workers=1 \
      worktree add \
      --detach --checkout --no-guess-remote --lock \
      --reason Decision040-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

- READ15: 362 bytes/SHA
  `9fa5583b940dcc383b4e9c447d4eebf775d9c0dfe18a453e7d9df9467a6c1786`;
- CREATE14: 339 bytes/SHA
  `7b0a49257e83acda1c0572297dc3ee4c382b31f05bd984f11e74d40eb037a987`;
- CONFIG15: 393 bytes/SHA
  `e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085`;
- D040 create argv: 59 elements/1 171 bytes/SHA
  `f501bbf00c90079c8529ec256910041a2f20a6a208c1d8a7cdc0f6c1f59d5e92`.

READ15 je CREATE14 s `GIT_OPTIONAL_LOCKS=0` vloženým bezprostředně před D040
committer name/email; CONFIG15 zůstává ve stejném exact pořadí. Verifier každý
Git read provede exact READ15 + `/usr/bin/git --no-optional-locks` + CONFIG15
typed envelope. Fresh od nuly ověří promoted D040 DAG/report, root command
adjacency transcript, detached
B37/tree, ignored-aware clean streams, tracked/stage/tree equality, full
1 614-leaf FS/blob/executable closure, same-FD admin index/info/config before/
after, known controls včetně D040 lock, refs/objects/config/preexisting
worktrees proti Review-B baseline s pouze exact promotion + new target/admin
allowlist, a frozen private no-touch invariants.

Root command success je jen input fact `exit=0/no-signal`; verifier nesmí
převzít root self-verdict ani vynechat closure. Complete observable mismatch je
`CHANGES_REQUIRED`; audit, který nelze dokončit, je `BLOCKED` s absent handoff.

## 8. Identities, exclusions, acceptance a fixtures

Live roles jsou writer `/root/decision040_writer`, Review A
`/root/decision040_review_a`, Review B `/root/decision040_review_b`, sole
issuer/promoter/creator `/root` a verifier
`/root/v5_d040_source_checkout_verifier`.

Exact sorted 36-entry role universe `U40` je union obou D039 exclusion sets a
všech skutečných D040/superseded identities:

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

Root-holder exact sorted 35-entry exclusions jsou `U40 - {/root}`:

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

Verifier exact sorted 35-entry exclusions jsou
`U40 - {/root/v5_d040_source_checkout_verifier}`:

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

Superseded `/root/v5_d040_source_checkout_materializer` je pouze forbidden
identity. Nová identity mimo U40 před lease je terminal STOP.

### 8.1 Acceptance matrix

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

### 8.2 Negative fixtures

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

Každá fixture musí independently failnout. Docs author/reviewer je nespouští
proti live common Git/private rootu; modelují je jen isolated synthetic bytes.

## 9. Four-doc DAG a gates

Subject allowlist je exact:

1. `docs/decisions/040-m1-h0-v5-detached-source-checkout-toolchain-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-TOOLCHAIN-REMEDIATION.md`

Reserved report je B40+subject absent:

```text
docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-toolchain-remediation-20260818-report.md
```

DAG je `B40 -> S_H0V5SRC040 -> E_A_H0V5SRC040 -> C_H0V5SRC040 ->
E_B_H0V5SRC040 -> canonical --ff-only`. Review A direct child subjectu vytvoří
jen exact four-line report s integrationRef/B40/subjectHead/PASS. Candidate má
ordered parents `[B40,E_A]` a exact E_A tree. Review B direct child candidate
připojí jen candidateHead/PASS, potom dokončí §5 final baseline a handoff.

Report po Review B má právě těchto šest LF-terminated řádků a žádné další
pole; angle-bracket hodnoty se nahradí full 40-lowerhex commity dané fáze:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: c38e1b24849521b41025e70a37bf0219466c9d1e
subjectHead: <full-S_H0V5SRC040-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC040-sha>
reviewB.verdict: PASS
```

Precommit vyžaduje dva fresh zero-based audits `PASS/P0=0/P1=0`. Před/po
subject commit se ověří exact B40/tree/clean writer, four paths/report absence,
exact closed placeholder allowlist a counts, D039 red/raw parity,
inheritance/replacement, role/exclusion/matrix/fixture parity, command env/argv
hashes, promotion-create state machine,
target/admin/private prestate, artifact `151/151`, registry `382+8`, hygiene
`PASS/1622 subject paths` a `git diff --check`. Non-PASS nevytvoří candidate,
promotion ani operational authority. Push/tag/release/rewrite jsou zakázané.

Allowed angle-bracket metavariable occurrences jsou právě sedm: v Decision
token `full-E_B_H0V5SRC040-sha` dvakrát, `full-S_H0V5SRC040-sha` jednou a
`full-C_H0V5SRC040-sha` jednou; ve WP stejné tokeny právě jednou každý. Jiný
angle-bracket token nebo jiný počet je red.

## 10. Abandoned driver attempt a pravdivý stav

Oddělený `/root/decision040_driver_writer` vytvořil pouze partial uncommitted
source v isolated writer checkoutu. Completion audit snapshot
`b619d0f694a9e8153873d8bd66b6e273fe8c51b77c383049d2afc26cb2b080e6`
měl 119 197 bytes a stále P1/P0-equivalent blockers: bounded child I/O,
dirfd/openat closure, deterministic set ordering, prospective verifier
capacity, verifier mismatch vocabulary, promotion topology a common/private
manifest races. Pozdější unfinished edits nebyly frozen ani reviewované.

Prefreeze auditor navíc na dřívějším snapshotu s prefixem `ee6fc344` omylem
spustil `python3 -m py_compile`, čímž vznikl exact
`docs/execution/tools/__pycache__/m1-h0-v5-d039-source-checkout-driver.cpython-312.pyc`
86 011 bytes. Po inventuře odstranil jen tento pyc a empty cache dir; source
SHA zůstal unchanged. Tento transient artefakt ani audit nejsou pristine
evidence.

Fresh audit replacement tree nejprve zkusil helper `/usr/bin/rg` a obdržel
`ENOENT`, potom provedl stejné read-only patterns přes `/usr/bin/grep`. Nevznikl
žádný write ani coverage gap; incident je transparentní auditní fakt, ne PASS
evidence ani operational input.

První author aggregate Decision+WP `apply_patch` skončil context-verification
mismatch a provedl zero modifications. Opravený aggregate patch následně
landed celý; nevznikl partial patch ani repository/private/runtime effect.

Partial driver nebyl zkopírován do D040 docs writeru, staged, committed,
promoted, importován ani spuštěn v CREATE/VERIFY mode. Nemá authority a nesmí
být použit jako operational input. D040 subject zůstává exact four-doc.

Dokud nejsou oba fresh zero-based precommit audity PASS:

```text
D039: BLOCKED_BEFORE_ATTEMPT / AUTHORITY CONSUMED / NO RETRY
D040: UNCOMMITTED MINIMAL DRAFT / NO OPERATIONAL AUTHORITY
D037 PRIVATE REPAIR: BLOCKED_BEFORE_TRANSACTION / UNCONSUMED
V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO NOT EXECUTE
RUNTIME / ACCEPTANCE / T3 / GATES: NO AUTHORITY
```
