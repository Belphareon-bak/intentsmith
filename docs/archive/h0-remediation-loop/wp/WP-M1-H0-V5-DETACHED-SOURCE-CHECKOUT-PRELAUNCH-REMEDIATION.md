# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELAUNCH-REMEDIATION

**Výsledek:** docs-only náhrada spotřebované D038 prelaunch authority. Po
vlastním Review A+B dovolí jediný nový create run a navazující verifier run pod
nepřerušeným exclusive all-Git-access lease; žádný private nebo runtime effect.

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision / B39:** `9205a906602cbd6e9a0e6cf3ebe8d30ed06113c2`

**baseTree:** `1e7441e8593369cd23899a83750cb16f1c05212f`

**Stav:** `D038_BLOCKED_BEFORE_ATTEMPT_CONSUMED / D039_PENDING_REVIEW /
PRIVATE_REPAIR_HOLD / NO_RUNTIME_AUTHORITY`

## 1. Vstup a exact red incident

Decision038 R2 byla promoted na B39, ale její operational authority skončila
terminal ještě před final snapshotem a před launch. Immutable record je:

| Pole | Exact hodnota |
|---|---|
| `operationalState` | `BLOCKED_BEFORE_ATTEMPT` |
| `authorityConsumed` | `true` |
| `failedGate` | `PRELAUNCH_EXTERNAL_COMMON_GIT_READ_OUTSIDE_EXACT_NO_WRITE_ENVELOPE_AND_EXCLUSIVE_WRITER_WINDOW` |
| `commandAttemptCount` | `0` |
| `orchestratorGoIssued` | `true` |
| `creatorGoReceived` | `true` |
| `finalCreateLaunchGo` | `false` |
| `launch` | `false` |
| `creatorPhase` | `BEFORE_SNAPSHOT` |
| `creatorPostGoCommandCount` | `0` |
| `finalPreflightSnapshot` | absent |
| `creatorObservation` | absent |
| `verifiedSourceHandoff` | absent |
| `verifierTaskOutcome` / `contractualVerifierRun` | `BLOCKED` / `NO_RUN` |
| findings | `F38-14-OPTIONAL-LOCKS-READ-WRITES-INDEX`, `F38-13-MISSING-OPAQUE-OR-UNVERIFIED-HANDOFF` |
| `explicitWriteObserved` | `false` |
| `absenceOfOptionalIndexRefreshProved` | `false` |
| `canonicalIndexMutation` | `UNKNOWN` |
| target/admin/private/runtime/push effects | `none` |
| `provisionalDigestsAreEvidence` | `false` |

Creator nespustil create argv. Target/admin zůstaly absent a nebyl pozorován
private, evidence, runner, runtime, seal, push, cleanup, prune nebo repair
effect. External Git read ale nebyl pod exact no-write envelopem, takže absence
optional index refreshu není prokázaná. `effects=NONE_OBSERVED` se proto nesmí
povýšit na byte-immutability claim. Všechny provisional manifesty nebo digesty
jsou `NON_EVIDENCE`; D039 je nesmí převzít jako snapshot nebo handoff.
Exact task `/root/v5_d038_source_checkout_verifier` po root orchestration GO a
před snapshotem použil ambientní `git rev-parse`, `git status` a `git show`.
Creator activation GO přijal, ale zůstal `BEFORE_SNAPSHOT`, provedl zero
post-GO commands a final create-launch GO zůstal false. Command facts se
zachovávají; jejich outputs nejsou evidence.

D038 prelaunch failure její jedinou authority spotřeboval. Toto WP není retry,
reopen ani continuation D038. Teprve promoted D039 vytvoří nový token:

    EXACTLY_ONE_D039_D037_EB_DETACHED_SOURCE_WORKTREE_CREATE_ATTEMPT

## 2. Immutable pins a exact inheritance

Promoted D038 inputs jsou:

| Artefakt | Git blob | SHA-256 obsahu |
|---|---|---|
| Decision038 | `e1aa161b20f8f29862af865f922b2ecc38f3e420` | `0e9e030fe1b35a4428abf49e925c60351c1ac9708cc8a25da31d2e1bf537df1c` |
| Decision038 WP | `a53189ce3498fb7a5a0cf379ee375a6d26eabe3d` | `660341e043d9712c27af210590467d59034447798e9b57924773e72140fb5239` |
| promoted report | `e28ace978edfd3ee8128b09aba6983c4926a83c0` | `06144e008ff952c6b5fe1dce1e4013d5b91b1c9fd6d0e87f0916fbee129c3b76` |

Decision038 decision, WP ani report se tímto subjectem needitují; jejich PASS
review je docs authority evidence, nikoli operational PASS.

Report exact připíná integration ref, base B37, subject
`f211f2678f9724011f62c2fd5060ef5e6d534d1a`, Review A PASS, candidate
`666ff9e65f95db7f81c7be28ddb3004b26e316b8` a Review B PASS.

Toto WP inkorporuje z exact Decision038 blobu výše právě §2, §3, §5.1–5.6 a
§6. §5.1 uzavírá celý pre-effect gate set a reference z §5.6; jeho D038
authority/consumption/scheduling semantics se explicitně nahrazují níže.
Všechny ostatní operational pins, typed envelopes, closures, negative semantics a
zákazy v těchto sekcích platí, kromě této úplné substitution table. Ostatní
D038 sekce zůstávají historical context a neimportují staré role, DAG, gates,
matrix, fixtures nebo author evidence:

| D038 pole / token | D039 náhrada |
|---|---|
| consumed D038 authority | nový one-shot D039 token z §1 po promotion |
| §5.1/§5.6 D038 authority, consumption a retry reference | jen D039 create token/counter/state machine z §4 a §6; D038 zůstává consumed s county `0` |
| §5.1 exclusive writer slot | fresh quiescence a active D039 all-Git lease už před create-token issuance až do terminal closure |
| promotion/report pin pro run | full promoted `E_B_H0V5SRC039` a D039 report; exact B39/tree a promoted D038 blob/report jsou ancestry inputs |
| writer | `/root/decision039_writer` |
| R2 Review A | `/root/decision039_review_a` |
| R2 Review B | `/root/decision039_review_b` |
| creator | `/root/v5_d039_source_checkout_materializer` |
| verifier | `/root/v5_d039_source_checkout_verifier` |
| committer name | `M1-D039-Worktree` |
| committer email | `m1-d039-worktree@localhost` |
| lock reason | `Decision039-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e` |
| `locked` control | 80 bytes / SHA-256 `6bac3e4ef2f06a0b87ce425a16362d35ee3e97fce3f2ef8e2647fa585c5d4959` |
| scheduling | one-shot tokens `D039-CREATE-01` a po creator success `D039-VERIFY-01` pod one-holder lease |
| verifier run state / `verifiedSourceHandoff.verdict` | přesně §4 třívětvá tabulka; handoff verdict jen `PASS\|CHANGES_REQUIRED`, `BLOCKED` jen task outcome s absent handoffem |
| exclusions | dva exact 24-entry sets z §3 |
| red state | §1 immutable incident; nikdy reusable input/PASS |
| acceptance, fixtures, DAG/report | toto WP a Decision039 |

Absence řádku znamená beze změny, nikoli volbu implementátora. Source je stále
Decision037 Review B `df1863439b6ad83abf41396ba8063e5bffaa599e`, tree
`1f0e730a46a94a7f741b2dbf47426458b8125a97`, 1 614 paths, path digest
`51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea`.
Raw tree je 151 786 bytes/SHA
`f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6`,
1 598 regular + 16 executable blobs a 355 directories. B39 ani D039 nesmí být
substituovány jako live source/static base.

Inkorporovaný §5.1 zachovává exact local B37/tree proof bez
replace/promisor/alternate, target/admin + non-symlink parent absence,
worktree-list/admin-alias/ref absence, common config/info/lock/before-manifest
gates, tree `.gitmodules`/`.gitattributes` a filter/fsmonitor/sparse checks i
jejich pre-effect pořadí. Vše se měří fresh až pod aktivním D039 lease.

Target/admin/common checkout jsou exact:

    /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    /home/belphareon/worktrees/is-m1-consolidated

Target a admin jsou pre-subject absent. Common config je exact regular mode
`0664`, UID/GID `1000/1000`, nlink `1`, 10 775 bytes/SHA
`35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`.
Common `info/attributes` je absent; `info/exclude` je exact regular `0664`,
UID/GID `1000/1000`, nlink `1`, 400 bytes/SHA
`468044a7d11af1e2b923279d508e54ddac2298a018d3005b70d434bb4de11e53`
a obsahuje `/.worktree-archive/`. D038 parser/config.worktree/mount pins a
phase-bound same-FD protocols zůstávají exact.

Stejné target/admin pathy jsou záměrné: D038 fixed command nebyl launched, takže
nevznikl partial subtree. D039 je nový authority namespace, ne retry; alternate
path by jen změnil `.git`, `gitdir` a closure constants. Preflight presence
kteréhokoli pathu je terminal STOP bez cleanupu nebo přejmenování.

Frozen V5 root
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74`
zůstává evidence-empty a unsealed. OLD plan/runner/strategy SHA jsou
`c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca`,
`0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb`,
`26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d`.
Authentic red recorder result/manifest/digest SHA jsou
`da95531f261800d3f3262141a7e205680359ea3db6c2036c65816129f43d1aeb`,
`34c9b6af49cbdd2f24b0974207065ad00f86bcb560286e7054cd5ee6af268a0d`,
`3f279358c690c2f8d4773678d16442ac82d55210139a1d30e1be5063d195e75f`.

## 3. Exact roles a exclusions

Pět live roles je pairwise distinct: writer `/root/decision039_writer`, Review
A `/root/decision039_review_a`, Review B `/root/decision039_review_b`, creator
`/root/v5_d039_source_checkout_materializer` a verifier
`/root/v5_d039_source_checkout_verifier`. Read-only design tasks
`/root/decision039_architect` a `/root/decision039_adversary` jsou také distinct,
nemají operational authority a jsou excluded.

Creator exact sorted 24-entry exclusions, bez vlastního creator tasku:

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
    /root/v5_d037_fresh_preseal_review
    /root/v5_d037_postseal_review_a
    /root/v5_d037_postseal_review_b
    /root/v5_d038_source_checkout_materializer
    /root/v5_d038_source_checkout_verifier
    /root/v5_d039_source_checkout_verifier
    /root/v5_formal_preseal_review
    /root/v5_materializer

Verifier exact sorted 24-entry exclusions, bez vlastního verifier tasku a s
creator taskem:

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
    /root/v5_d037_fresh_preseal_review
    /root/v5_d037_postseal_review_a
    /root/v5_d037_postseal_review_b
    /root/v5_d038_source_checkout_materializer
    /root/v5_d038_source_checkout_verifier
    /root/v5_d039_source_checkout_materializer
    /root/v5_formal_preseal_review
    /root/v5_materializer

Pouze orchestrator identity source je závazný; Git author, PID nebo prose label
jej nenahrazuje.

## 4. Lease a state machine

Koordinátor `/root` nejprve zastaví/vyloučí všechny ostatní common-Git
consumers. Pak bez Git/direct-metadata readu založí fresh non-filesystem
`leaseGeneration` v `ISSUER_FENCE`; tato activation hranice nastane před
create-token issuance. Od ní do terminal closure nesmí žádný jiný task, včetně
`/root`, uživatelského shellu nebo design/review rolí, spustit Git read/write ani
přímo číst common `.git`, linked worktree admin, refs, objects, config nebo
index. Zakázané jsou i nevinně vypadající `status`, `log`, `rev-parse`,
`worktree list`, libgit2/JGit a monitoring přes Git. Task channel není Git
access.

Sekvence je exact:

1. jediný issuer `/root` ověří identity/exclusions a jedním atomickým přechodem
   vydá+aktivuje `D039-CREATE-01` a převede sole holdera issuer fence -> exact
   creator. Token byte-bindne ID, issuer, holder, creatorův sorted 24-entry set,
   `leaseGeneration`, full promoted `E_B_H0V5SRC039` head/tree/report pins,
   B37/tree, target/admin, exact create env+argv bytes/SHA a initial D039 count
   `0`;
2. fresh preflight prokáže exact identity/exclusions, D039 promotion, D038 red
   record, target/admin absence, private/common-Git pins a before manifests;
3. creator finalizuje byte-bound `finalPreflightSnapshot`; snapshot obsahuje
   všechny inkorporované D038 §5.1 gates/manifests, D039 promotion, D038 red,
   token/lease transcript a source/private/common-Git pins. Před final create GO
   je vlastní D039 `commandAttemptCount=0`, zatímco oba historické D038 county
   zůstávají navždy `0`;
4. GO nad complete snapshotem dovolí právě jeden fixed command a atomicky změní
   jen D039 command counter na `1`;
5. success postflight skončí verdict-free canonical `creatorObservation` a
   create token přejde do `CONSUMED`; creator zůstává fenced sole lease holder a
   předá bytes/SHA `/root` pouze task channel, bez holder gapu nebo dalšího
   Git/direct-metadata accessu;
6. teprve potom `/root` jedním all-or-nothing atomickým přechodem společně
   vydá+aktivuje `D039-VERIFY-01`, převede holdera creator -> exact verifier,
   creatorovi odebere access a úspěšně spawne+triggerne+aktivuje verifier task.
   Verify token byte-bindne ID, issuer, holder,
   verifierův sorted 24-entry set, stejnou `leaseGeneration`, full D039
   promotion head/tree/report pins, SHA canonical creator observation, exact
   no-write read env/config/root/tail/stdin contract a lease continuity. Pokud
   spawn/trigger/activation nelze dokončit, token se nevydá, lease se nepřevede,
   verifier zůstane unspawned a creator fenced až do terminal recordu; VERIFY
   pak přejde `UNMINTED -> CANCELLED_UNISSUED` s `NO_RUN`;
7. verifier vše recompute od nuly v jediném read-only runu. Complete handoff má
   verdict jen `PASS|CHANGES_REQUIRED`; `BLOCKED` je task outcome s absent
   handoff. Verify token se spotřebuje při každém terminal outcome a teprve pak
   se lease uzavře.

Verifier spawn, trigger i activation jsou zakázané před complete successful
canonical creator observation a smějí nastat jen uvnitř stejného all-or-nothing
atomického přechodu jako VERIFY issue+activation a creator-to-verifier lease
transfer. Pending `UNMINTED` verifier není spawned ani triggered. Exact
terminal state table je:

| Verify token / run terminal state | `verifierSpawned` | `verifierTaskOutcome` | `contractualVerifierRun` | `verifiedSourceHandoff` | Handoff verdict |
|---|---:|---|---|---|---|
| `CANCELLED_UNISSUED` | `false` | `BLOCKED` | `NO_RUN` | absent | none |
| `CONSUMED` po issued runu s pre/incomplete blockerem | `true` | `BLOCKED` | `INCOMPLETE_RUN` | absent | none |
| `CONSUMED` po complete auditu | `true` | `COMPLETED` | `COMPLETE_RUN` | present | `PASS\|CHANGES_REQUIRED` |

Cross-row kombinace, `BLOCKED` jako handoff verdict, spawned NO_RUN, unspawned
INCOMPLETE/COMPLETE run nebo handoff při blockeru jsou red.

Oba tokeny mají samostatný monotónní normal path
`UNMINTED -> ISSUED_AND_ACTIVATED -> CONSUMED` a jedinou pre-issuance terminal
větev `UNMINTED -> CANCELLED_UNISSUED`. Cancelled stav forecloses danou D039
authority navždy a není issuable/remintable. Při failure po lease activation,
ale před CREATE issuance se zruší oba dosud nevydané tokeny. Po CREATE issuance
se nevydaný VERIFY zruší při každém creator non-success nebo terminal failure
mezi creator success a atomickým VERIFY issuance nebo při nemožnosti atomicky
dokončit verifier spawn/trigger/activation. Issued CREATE prelaunch
failure se spotřebuje s D039 count `0` a
launch jej změní na `1`. Verify PASS, CHANGES_REQUIRED i BLOCKED spotřebují
issued verify token. Není povolen retry, jiný holder nebo non-atomic transfer.
Cancellation record byte-bindne token ID, lease generation, failed gate,
boundary, last holder, external-access count a foreclose reason. CREATE navíc
bindne D039 count `0`/`launch=false`; VERIFY creator terminal observation nebo
post-success pre-issuance gate a `contractualVerifierRun=NO_RUN`.

Readiness před `leaseGeneration` activation je mimo D039 operational run a smí
číst jen orchestration task/identity channel. Neprokázaná quiescence v této
fázi je `NOT_STARTED / TOKENS_UNMINTED / AUTHORITY_UNCONSUMED`, bez preflight
factu nebo evidence; po pozdější quiescence smí nastat jediný start a nejde o
operational retry. Lease activation je irreversible start boundary; každý
pozdější failure vede pouze do `CANCELLED_UNISSUED` nebo `CONSUMED`.

External access od lease activation, lease gap, druhý holder, neprokázaná quiescence, chybějící
snapshot nebo premature verifier je terminal a spotřebuje authority bez launch
či retry. Creator failure končí sekvenci; verifier pak má outcome `BLOCKED` a
contractual run `NO_RUN`.

## 5. Exact create/read contract

Create run nastaví `umask 077`, potom `exec /usr/bin/env -i` s exact fourteen
assignments: `PATH`, `LANG`, `LC_ALL`, `TZ`, `GIT_CONFIG_NOSYSTEM`,
`GIT_CONFIG_GLOBAL`, `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `SSH_ASKPASS`,
`SSH_ASKPASS_REQUIRE`, `GIT_NO_LAZY_FETCH`, `GIT_ATTR_NOSYSTEM`,
`GIT_COMMITTER_NAME=M1-D039-Worktree` a
`GIT_COMMITTER_EMAIL=m1-d039-worktree@localhost`. `HOME` i všechny neuvedené
keys jsou absent.

Exact command je D038 command s pouze tabulkovými substitucemi: `/usr/bin/git`
v canonical checkoutu, patnáct původních `-c` overrides, `worktree add --detach
--checkout --no-guess-remote --lock`, exact reason
`Decision039-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e`,
exact target a exact B37. `--force`, branch, hook, filter, protocol, lazy fetch,
submodule, fsmonitor, split/sparse index, maintenance, GC, parallel checkout a
druhý command jsou zakázané. Creation nemá optional-lock suppression.

Každý Git read má exact D038 fifteen-key `env -i`, ale substituovanou D039
identity; navíc povinné `GIT_OPTIONAL_LOCKS=0` a `/usr/bin/git
--no-optional-locks`. Patnáct read `-c` overrideů i typed tails jsou exact D038.
Read root je pouze canonical nebo exact target. Každý invocation recorduje
env/argv/stdin, exit/signal a raw stdout/stderr bytes/SHA. Plain/ambient Git je
red.

Immediately after create a před prvním Git readem, after creator reads,
before/after verifier reads a před materializer private effectem platí celý
D038 same-FD index/info/config protocol. Expected lock payload je exact
substituted reason plus LF, 80 bytes/SHA
`6bac3e4ef2f06a0b87ce425a16362d35ee3e97fce3f2ef8e2647fa585c5d4959`.
Ostatní stable admin controls jsou D038-exact.

Successful closure musí mít detached B37/tree, ignored-aware status a oba
others streams empty, exact H/path set, exact stage-0 tree equality, allowed
admin set, stable index/info/config, a independent no-follow FS/tree/index/blob
OID/bytes/executable-mode closure bez mismatchu. Common refs, objects, HEAD,
config, indices a všechny preexisting worktree controls jsou před/po identické;
povoleny jsou jen nový target/admin subtree a nutná parent metadata.

## 6. Handoff, materializer a stop

Creator observation je non-filesystem a bez verdictu. Obsahuje všechny
selectively inherited D038 fields plus D039 promotion, exact red incident,
final snapshot hash, create-token state, lease generation/holder/exclusions,
continuity/external-access count, D039 counter, substitutions a lock proof.
Verifier začne pouze atomickým verify-token issue+activation po creator success,
recompute vše fresh pod lease a vydá vlastní handoff byte-vázaný na snapshot,
creator observation, verify-token record a lease continuity. Handoff vocabulary
je pouze `PASS|CHANGES_REQUIRED`; PASS vyžaduje zero
P0/P1/drift/external-access counts. `BLOCKED` vytváří jen terminal task record a
handoff je absent.

Pouze composite verifier-owned PASS handoff se předá původnímu
`/root/v5_materializer`. Ten před private effectem provede celé D038 inherited
two-boundary source/index/info/config/private/red ověření. D039 sama nemění core,
evidence, seal ani runtime a nevydává další repair, retry, H0, T3, Gate,
push/tag/release authority.

Failure po lease activation, ale před CREATE issuance, převede oba unissued
tokeny do `CANCELLED_UNISSUED`, forecloses D039 authority, zachová D039 count
`0` a `launch=false`. Failure po CREATE issuance, ale před final GO, spotřebuje
issued CREATE přes `CONSUMED` s count `0`; po GO jej spotřebuje s count `1`.
Nevydaný VERIFY se v obou creator non-success větvích canceluje; issued VERIFY
se při vlastním failure spotřebuje a je terminal.
Target/admin/partial se nikdy nemaže,
nepruneuje, neopravuje, neunlockuje ani nerecykluje a žádný run se neopakuje.
Failure observation zachová exact phase, lease, count, stdout/stderr a dostupné
partial observations bez jejich povýšení na PASS.

## 7. Acceptance matrix

1. `R39-01` — exact B39/tree a immutable D038 decision/WP/report blobs.
2. `R39-02` — exact terminal D038 red observation a provisional non-evidence.
3. `R39-03` — exact four-path subject, report, DAG a pairwise-distinct live/design registry.
4. `R39-04` — stejné target/admin jsou pre-D039 absent; žádný cleanup, alternate path ani reuse.
5. `R39-05` — nové oddělené create/verify tokeny, D039 counter a hard barriers.
6. `R39-06` — celý D038 hardened create/read/index/info/config/blob contract s exact D039 overrides.
7. `R39-07` — jediný effect je nový detached locked worktree; ostatní Git/private/runtime state invariantní.
8. `R39-08` — nový creator observation a až následný verifier PASS; žádný D038 artefakt je nenahrazuje.
9. `R39-09` — evidence write, private repair, seal, runtime, import, push, tag a release authority NONE.
10. `R39-10` — D037 zůstává live base; jen verified D039 PASS znovu otevře materializer.

## 8. Negative fixtures

1. `F39-01-TARGET-ALREADY-EXISTS`
2. `F39-02-ADMIN-PATH-ALREADY-EXISTS`
3. `F39-03-DETACH-OR-REUSE-EXISTING-CANONICAL-OR-REVIEW-WORKTREE`
4. `F39-04-SYMBOLIC-HEAD-OR-BRANCH-CREATED`
5. `F39-05-WRONG-COMMIT-TREE-PATH-RELATIVE-FORCE-OR-GUESS-REMOTE`
6. `F39-06-UNCONSTRAINED-HOOKS-CONFIG-OR-ENVIRONMENT`
7. `F39-07-DIRTY-WRONG-COUNT-PATHSET-OR-NON-H-INDEX`
8. `F39-08-EXTRA-COMMON-GIT-REF-CONFIG-OBJECT-OR-PREEXISTING-WORKTREE-DELTA`
9. `F39-09-FAILURE-OR-PARTIAL-THEN-RETRY-CLEANUP-PRUNE-OR-REPAIR`
10. `F39-10-TASK-IDENTITY-COLLISION`
11. `F39-11-PRIVATE-EVIDENCE-RUNTIME-SEAL-IMPORT-OR-PUSH-EFFECT`
12. `F39-12-D039-SUBSTITUTED-AS-LIVE-BASE-OR-1614-PINS-CHANGED`
13. `F39-13-MISSING-OPAQUE-OR-UNVERIFIED-HANDOFF`
14. `F39-14-OPTIONAL-LOCKS-READ-WRITES-INDEX`
15. `F39-15-INFO-ATTRIBUTES-TRANSFORMS-CHECKOUT`
16. `F39-16-INFO-EXCLUDE-HIDES-EXTRA`
17. `F39-17-IGNORED-SCAN-OMITTED`
18. `F39-18-TARGET-BYTES-OR-EXEC-PARITY-DIFFERS-FROM-TREE`
19. `F39-19-VERIFIER-ACTIVATED-BEFORE-CREATOR-SUCCESS`
20. `F39-20-D038-TASK-TOKEN-OR-AUTHORITY-REUSED`
21. `F39-21-D038-RED-OBSERVATION-OMITTED-RECLASSIFIED-OR-PROVISIONAL-DIGEST-ACCEPTED`
22. `F39-22-EXTERNAL-COMMON-GIT-ACCESS-DURING-EXCLUSIVE-WINDOW`

Fixture model je isolated synthetic; author/reviewer nesmí incidenty vyvolávat
proti live common Git nebo private rootu. Každá fixture musí nezávisle selhat.

## 9. Owned paths, DAG a author gates

Subject exact allowlist:

1. `docs/decisions/039-m1-h0-v5-detached-source-checkout-prelaunch-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELAUNCH-REMEDIATION.md`

Reserved report je v B39 i subjectu absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-prelaunch-remediation-20260818-report.md

DAG je `B39 -> S_H0V5SRC039 -> E_A_H0V5SRC039 ->
C_H0V5SRC039 -> E_B_H0V5SRC039 -> canonical --ff-only`.
Review A direct child subjectu zapíše pouze four-line report s integrationRef,
B39, subjectHead a PASS. Candidate má ordered parents `[B39,E_A]`, exact E_A
tree a preserved blobs. Review B direct child candidate připojí jen
candidateHead a PASS. Roles jsou exact §3; non-PASS nevydává authority. Push,
tag, release a history rewrite jsou zakázané.

Před i po subject commitu musí projít exact B39/tree/clean isolated writer,
exact four paths/report absence, D038 immutable evidence+incident, target/admin
absence, frozen private/red state, inheritance/substitution parity, roles and
24-entry exclusions, all-Git lease state machine, ten matrix IDs a 22 fixture
IDs exactly once v Decision i WP, artifact validation `151/151`, registry
`382 + 8`, repository hygiene `PASS / 1619 subject paths` a `git diff --check`.

Author vytvoří jen docs subject. Operational command, synthetic fixtures proti
live stavu, target/admin/private/runtime, report, candidate, promotion a push
jsou `NOT_RUN / NOT_CREATED`.

Pět bounded multi-file `apply_patch` pokusů při cancellation/verifier refinementu
selhaly atomicky na context mismatch před zápisem; split patche uspěly bez
partial stavu. Incident neměl target/admin/private/runtime ani remote effect a
není verification evidence.

Jeden semantic re-auditor omylem přesměroval artifact-test stdout do exact
`/tmp/d039-final-artifact-audit.out` a tentýž exact temp file ve stejném commandu
odstranil. Potom gate zopakoval bez file outputu s výsledkem `151/151`. Repo,
common Git, target/admin, private root ani runtime se nezměnily; tento audit se
nepočítá jako pristine final attestation.
