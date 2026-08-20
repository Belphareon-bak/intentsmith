# 039 — Prelaunch remediation detached source checkoutu po spotřebované D038

- **typ:** docs-only operational remediation bez private nebo runtime authority
- **stav:** `D038_BLOCKED_BEFORE_ATTEMPT_CONSUMED / D039_PENDING_REVIEW /
  PRIVATE_REPAIR_HOLD / NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B39:**
  `9205a906602cbd6e9a0e6cf3ebe8d30ed06113c2`
- **baseTree:** `1e7441e8593369cd23899a83750cb16f1c05212f`
- **výsledek po promotion:** nová, právě jedna D039 source-create authority;
  žádný retry ani znovupoužití spotřebované D038 authority

## 1. Proč je nový decision nutný

Decision038 R2 byla řádně reviewovaná a canonical promovovaná. Její jediný
operational run však skončil ještě před final preflight snapshotem. Během
PREP po orchestration GO spustil exact task
`/root/v5_d038_source_checkout_verifier` ambientní common-Git reads mimo exact
no-write envelope a mimo požadovaný exclusive writer window. Creator GO přijal,
ale zůstal `BEFORE_SNAPSHOT`, po GO neprovedl žádný command a final
create-launch GO nevydal. `git worktree add` se nespustil a stav skončil
terminal `BLOCKED_BEFORE_ATTEMPT`.

Decision038 §5.1 říká, že i tento prelaunch failure její autoritu permanentně
spotřebuje. Target ani admin nevznikly, ale D038 se nesmí opakovat, obnovit,
reinterpretovat jako unconsumed ani použít k novému commandu. D039 je nový
canonical authority token. Přidává chybějící výhradní lease nad **veškerým**
common-Git přístupem a přesné oddělení creator/verifier runs. Nemění D037 live
static base, V5 private root ani žádný runtime stav.

## 2. Exact immutable base a inherited evidence

Canonical pre-subject stav je clean exact `B39`/tree z hlavičky a má 1 617
tracked paths. Decision038 promotion je jeho ancestor a její promoted bytes
jsou:

| Artefakt | Git blob | SHA-256 obsahu |
|---|---|---|
| Decision038 | `e1aa161b20f8f29862af865f922b2ecc38f3e420` | `0e9e030fe1b35a4428abf49e925c60351c1ac9708cc8a25da31d2e1bf537df1c` |
| Decision038 WP | `a53189ce3498fb7a5a0cf379ee375a6d26eabe3d` | `660341e043d9712c27af210590467d59034447798e9b57924773e72140fb5239` |
| promoted D038 report | `e28ace978edfd3ee8128b09aba6983c4926a83c0` | `06144e008ff952c6b5fe1dce1e4013d5b91b1c9fd6d0e87f0916fbee129c3b76` |

Decision038 decision, WP ani promoted report se v D039 subjectu needitují.
Jejich docs Review A+B PASS dokládá přijetí authority kontraktu, nikoli úspěch
pozdější operational operace.

Promoted report má přesně šest LF-terminated řádků:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: df1863439b6ad83abf41396ba8063e5bffaa599e
subjectHead: f211f2678f9724011f62c2fd5060ef5e6d534d1a
reviewA.verdict: PASS
candidateHead: 666ff9e65f95db7f81c7be28ddb3004b26e316b8
reviewB.verdict: PASS
```

Source revision zůstává promoted Decision037 Review B:

| Pole | Exact hodnota |
|---|---|
| source commit `B37` | `df1863439b6ad83abf41396ba8063e5bffaa599e` |
| source tree | `1f0e730a46a94a7f741b2dbf47426458b8125a97` |
| tracked paths | `1614` |
| canonical JSON+LF path-set SHA-256 | `51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea` |
| raw `ls-tree` bytes / SHA-256 | `151786` / `f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6` |
| regular / executable blobs | `1598` / `16` |
| derived parent directories | `355` |

Target a common-Git admin path jsou při pre-subject inventuře any-type absent:

    /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343

Stejné pathy se používají proto, že D038 fixed command nikdy nebyl spuštěn a
žádný partial subtree neexistuje. Nejde o retry D038 tokenu, ale o nový D039
authority namespace; alternate path by bez bezpečnostního přínosu změnil
prospective `.git`, `gitdir` a closure constants. Pokud bude při D039 preflightu
kterýkoli path přítomný, následuje terminal STOP bez cleanupu nebo nového jména.

Common checkout je exact:

    /home/belphareon/worktrees/is-m1-consolidated

Common config je regular non-symlink mode `0664`, UID/GID `1000/1000`, nlink
`1`, 10 775 bytes a SHA-256
`35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`.
Common `info/attributes` je any-type absent. Common `info/exclude` je regular
non-symlink mode `0664`, UID/GID `1000/1000`, nlink `1`, 400 bytes a SHA-256
`468044a7d11af1e2b923279d508e54ddac2298a018d3005b70d434bb4de11e53`;
obsahuje active řádek `/.worktree-archive/`. Všechny D038 typed parser,
`config.worktree` absence a `/home`/`btrfs`/`noatime` mount pins zůstávají
normativní.

Frozen V5 root zůstává:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74

Jeho birth je `2026-08-18T08:32:50.000727718Z`; `evidence/` je empty a digest,
manifest, marker i seal jsou absent. OLD core je beze změny:

| Core | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v5-plan.json` | `c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca` | 128 493 | `0400` |
| `runner/run-h0-v5.py` | `0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb` | 619 441 | `0500` |
| `strategy/rustdesk-v5-strategy.json` | `26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d` | 67 666 | `0400` |

Authentic OLD-red recorder zůstává exact root
`/home/belphareon/.local/share/intentsmith-private/m1-h0-v5-preseal-red-review-d037-20260818T121226Z.hotln2oq`.
Jeho result/manifest/digest SHA-256 jsou
`da95531f261800d3f3262141a7e205680359ea3db6c2036c65816129f43d1aeb`,
`34c9b6af49cbdd2f24b0974207065ad00f86bcb560286e7054cd5ee6af268a0d`
a `3f279358c690c2f8d4773678d16442ac82d55210139a1d30e1be5063d195e75f`.

## 3. Exact terminal incident D038

Tento record je immutable red operational outcome, ne PASS evidence:

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
| `verifierTaskOutcome` | `BLOCKED` |
| `contractualVerifierRun` | `NO_RUN` |
| findings | `F38-14-OPTIONAL-LOCKS-READ-WRITES-INDEX`, `F38-13-MISSING-OPAQUE-OR-UNVERIFIED-HANDOFF` |
| `explicitWriteObserved` | `false` |
| `absenceOfOptionalIndexRefreshProved` | `false` |
| `canonicalIndexMutation` | `UNKNOWN` |
| target/admin/private/runtime/push effects | `none` |
| `provisionalDigestsAreEvidence` | `false` |

Creator neprovedl create argv, target/admin/private chmod/edit, runner import
nebo execution, evidence write, seal, runtime, push, tag, release, cleanup,
prune ani repair. `effects=NONE_OBSERVED` neznamená důkaz globální
byte-immutability: protože cizí Git read nebyl pod D038 exact envelopem a final
snapshot nevznikl, případný optional index refresh nelze zpětně vyloučit.
Proto zůstává `canonicalIndexMutation=UNKNOWN` i při
`explicitWriteObserved=false`.

Incidentní exact task `/root/v5_d038_source_checkout_verifier` před creator
snapshotem po root orchestration GO použil ambientní `git rev-parse`,
`git status` a `git show`. Root GO byl pouze activation/preparation GO, nikoli
final GO k fixed create launchi. Tyto command facts vysvětlují red gate; jejich
výstupy ani pozdější read-only digesty nejsou canonical prestate evidence a
nesmějí se recyklovat do D039 snapshotu.

Jakékoli předběžné manifesty, digesty nebo dílčí measurements z incidentu jsou
`PROVISIONAL / NON_EVIDENCE`; nesmí být použity jako final preflight snapshot,
creator observation, verifier handoff, D039 vstupní PASS ani materializer pin.
D039 vše měří fresh až uvnitř nového exclusive lease.

## 4. Inheritance exact D038 blobu a úplná substitution table

D039 normativně inkorporuje z Decision038 exact blobu
`e1aa161b20f8f29862af865f922b2ecc38f3e420` s content SHA-256
`0e9e030fe1b35a4428abf49e925c60351c1ac9708cc8a25da31d2e1bf537df1c`
právě jeho §2, §3, §5.1–5.6 a §6. §5.1 se inkorporuje kvůli úplnému
pre-effect gate setu a aby §5.6 neměl dangling reference; jeho D038 authority,
consumption a scheduling význam je explicitně nahrazen níže. Každý operational
požadavek, pin, zákaz a failure rule v těchto inkorporovaných sekcích platí beze
změny, pokud a pouze pokud jej následující tabulka explicitně nenahrazuje. Ostatní D038 sekce jsou
immutable historical context, nikoli implicitně převzatá D039 role, DAG,
acceptance, gate nebo author evidence. Žádná implicitní nebo prose-only
substituce není povolená.

| D038 pole / token | D039 náhrada |
|---|---|
| consumed D038 authority | nový token `EXACTLY_ONE_D039_D037_EB_DETACHED_SOURCE_WORKTREE_CREATE_ATTEMPT` po D039 promotion |
| §5.1/§5.6 `Decision038 authority`, prelaunch consumption a retry reference | pouze vlastní D039 create token/counter/state machine z §6 a §9; D038 authority zůstává navždy consumed a její county `0` |
| §5.1 exclusive common-Git writer slot | D039 lease se aktivuje po fresh quiescence **před** vydáním create tokenu a zakazuje veškerý external Git i direct common-metadata access až do terminal closure |
| D038 promotion/report pin pro operational run | full promoted `E_B_H0V5SRC039` a D039 report podle §12; exact B39 a promoted D038 blob/report zůstávají ancestry inputs |
| Decision038 writer | `/root/decision039_writer` |
| Decision038 R2 Review A | `/root/decision039_review_a` |
| Decision038 R2 Review B | `/root/decision039_review_b` |
| D038 creator | `/root/v5_d039_source_checkout_materializer` |
| D038 verifier | `/root/v5_d039_source_checkout_verifier` |
| create/read committer name | `M1-D039-Worktree` |
| create/read committer email | `m1-d039-worktree@localhost` |
| lock reason | `Decision039-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e` |
| `locked` control | 80 bytes, SHA-256 `6bac3e4ef2f06a0b87ce425a16362d35ee3e97fce3f2ef8e2647fa585c5d4959` |
| creator/verifier scheduling | exact one-shot tokens `D039-CREATE-01` a po jeho success `D039-VERIFY-01` pod nepřerušeným exclusive all-Git-access lease |
| verifier run state / `verifiedSourceHandoff.verdict` | přesně §6 třívětvá tabulka; handoff verdict je pouze `PASS\|CHANGES_REQUIRED`, `BLOCKED` je výhradně task outcome s absent handoffem |
| D038 exclusions | §5 exact D039 creator/verifier exclusions |
| D038 red state | immutable incident z §3; není prospective D039 state ani reusable authority |
| D038 matrix/fixtures | D039 matrix a fixtures z §10–11 |
| D038 docs DAG/report | D039 DAG a reserved report z §12 |

Beze změny zůstávají zejména source `B37`/tree, target/admin/common paths,
`umask 077`, exact fourteen-key create environment, patnáct create `-c`
overrideů, exact fifteen-key no-write read environment,
`GIT_OPTIONAL_LOCKS=0`, `--no-optional-locks`, patnáct read overrideů, typed read
tails, absent `HOME`, target/admin pre-absence, config/info/mount pins,
phase-bound same-FD index/info/config captures, known admin closure, detached
HEAD, empty ignored-aware streams, 1 614-path/tree/index/filesystem/blob/mode
closure, terminal no-cleanup/no-retry rules a nulová private/runtime/push
authority. Stable admin hashes z D038 platí beze změny kromě explicitně
substituovaného `locked` controlu.

Inkorporovaný §5.1 tím normativně zachovává také local B37 commit/tree proof bez
replace/promisor/alternate source; any-type target/admin absence a non-symlink
parent chain; worktree-list/admin-alias/ref absence; exact common config/info,
lock-file a before-manifest gates; absence tree `.gitmodules`/`.gitattributes`
a active filters/fsmonitor/sparse override; a přesné pořadí všech pre-effect
checks. D039 je všechny recompute fresh až uvnitř aktivního lease.

D038 source base se nesmí nahradit B39 ani D039 commitem. D037 `B37` zůstává
jediný live source/static base; B39 a D039 jsou governance ancestry.

## 5. Exact role identities a exclusion sets

Live D039 writer, Review A, Review B, creator a verifier jsou pairwise distinct:

| Role | Exact task |
|---|---|
| writer | `/root/decision039_writer` |
| Review A | `/root/decision039_review_a` |
| Review B | `/root/decision039_review_b` |
| creator | `/root/v5_d039_source_checkout_materializer` |
| verifier | `/root/v5_d039_source_checkout_verifier` |

Read-only design tasks `/root/decision039_architect` a
`/root/decision039_adversary` jsou distinct od všech live rolí, nemají
operational token a jsou v obou exclusion sets.

Creator má exact sorted 24-entry `excludedTasks`; vlastní creator task v něm
není:

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

Verifier má exact sorted 24-entry `excludedTasks`; vlastní verifier task je
vynechán a na jeho lexikografické pozici je creator:

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

Task identity pochází pouze z orchestration identity source. Git author, PID,
shell label, prose designation ani handoff field nejsou identity proof.

## 6. Exclusive all-Git-access lease a exact sequencing

Po canonical promotion D039 smí koordinátor spustit právě tuto linearizovanou
sekvenci:

1. `/root` zastaví nebo vyloučí každý jiný task, který by mohl číst nebo
   zapisovat shared common Git dir, kterýkoli linked worktree, refs, objects,
   config, index nebo worktree admin metadata. Pouze orchestration identity/task
   channel ověří exact creator exclusions a založí fresh non-filesystem
   `leaseGeneration` v `ISSUER_FENCE` stavu. Od této lease activation hranice,
   tedy už **před** vydáním create tokenu, je external Git/direct-metadata
   access zakázaný a count je `0`.
2. `/root` jako jediný issuer jedním atomickým orchestration přechodem vydá a
   aktivuje `D039-CREATE-01` a převede sole lease holdera z issuer fence na
   `/root/v5_d039_source_checkout_materializer`. Token record byte-bindne exact
   token ID, issuer, holder, creatorův sorted 24-entry exclusion set,
   `leaseGeneration`, full promoted `E_B_H0V5SRC039` head/tree/report
   path/blob/content SHA, B37/tree, target/admin, canonical exact create
   env+argv bytes/SHA a initial D039 `commandAttemptCount=0`.
3. Creator teprve po atomickém issue+activation začne fresh preflight. Drží
   lease po celý run. Při failure finalizuje terminal observation a token
   spotřebuje; dosud nevydaný verifier token atomicky přejde
   `UNMINTED -> CANCELLED_UNISSUED`. Při success creator dokončí
   verdict-free canonical `creatorObservation` a tím create token přejde do
   `CONSUMED`; creator přesto zůstává fenced sole lease holder a předá jeho
   bytes/SHA `/root` pouze task channel. Žádný Git/direct-metadata read ani
   holder gap při handoffu nenastane.
4. Pouze po complete successful creator observation provede `/root` jediný
   all-or-nothing atomický přechod, který společně vydá+aktivuje
   `D039-VERIFY-01`, převede sole holdera creator ->
   `/root/v5_d039_source_checkout_verifier`, creatorovi odebere access a
   úspěšně spawne+triggerne+aktivuje exact verifier task. Verify
   token byte-bindne exact token ID, issuer, holder, verifierův sorted 24-entry
   exclusion set, stejný `leaseGeneration`, full D039 promotion head/tree/report
   pins, SHA-256 canonical creator observation, exact fifteen-key no-write env,
   read config/root/tail/stdin contract a lease-continuity transcript. Pokud
   spawn/trigger/activation nelze dokončit, žádná část přechodu nenastane:
   token se nevydá, lease se nepřevede, verifier není spawned a creator zůstane
   fenced holderem do terminal recordu; VERIFY pak přejde
   `UNMINTED -> CANCELLED_UNISSUED` s `NO_RUN`.
5. Verifier provede právě jeden read-only run. Complete audit vydá
   `verifiedSourceHandoff` pouze s verdict vocabulary
   `PASS|CHANGES_REQUIRED`; pre-run nebo incomplete terminal blocker vydá jen
   `verifierTaskOutcome=BLOCKED` a handoff zůstává absent. Při libovolném
   terminal outcome se verify token spotřebuje bez remint/retry. Teprve potom
   `/root` uzavře lease generation a smí znovu otevřít external Git access.

Verifier task spawn, trigger i activation jsou zakázané před complete successful
canonical `creatorObservation` a smějí nastat pouze uvnitř téhož all-or-nothing
atomického přechodu jako verify-token issue+activation a creator-to-verifier
lease transfer. Dokud je verify token pending `UNMINTED`, verifier není spawned
ani triggered. Každý terminal verifier stav je právě jeden řádek:

| Verify token / run terminal state | `verifierSpawned` | `verifierTaskOutcome` | `contractualVerifierRun` | `verifiedSourceHandoff` | Handoff verdict |
|---|---:|---|---|---|---|
| `CANCELLED_UNISSUED` | `false` | `BLOCKED` | `NO_RUN` | absent | none |
| `CONSUMED` po issued runu s pre/incomplete blockerem | `true` | `BLOCKED` | `INCOMPLETE_RUN` | absent | none |
| `CONSUMED` po complete auditu | `true` | `COMPLETED` | `COMPLETE_RUN` | present | `PASS\|CHANGES_REQUIRED` |

Žádná kombinace mezi řádky, `BLOCKED` handoff verdict, spawned NO_RUN,
unspawned INCOMPLETE/COMPLETE run ani handoff při blockeru není povolená.

Oba tokeny mají oddělený monotónní stav. Normal path je
`UNMINTED -> ISSUED_AND_ACTIVATED -> CONSUMED`. Jediná terminal větev před
issuance je `UNMINTED -> CANCELLED_UNISSUED`; tento stav spotřebuje/forecloses
příslušnou D039 authority a je navždy non-issuable. Při terminal failure po
lease activation, ale před create issue+activation, přejdou takto **oba** dosud
nevydané tokeny. Po create issuance přejde verify token takto při každém creator
non-success i při libovolném terminal failure mezi complete creator observation
a atomickým verify issue+activation nebo při nemožnosti atomicky dokončit
verifier spawn/trigger/activation. Neexistuje
návrat, druhé vydání, remint, jiný holder ani transfer mimo popsaný atomický
creator-to-verifier přechod.
Každý cancellation record byte-bindne token ID, `leaseGeneration`, failed gate,
monotonic boundary, last holder, external-access count a důvod foreclose. CREATE
cancellation navíc připne D039 `commandAttemptCount=0` a `launch=false`; VERIFY
cancellation připne creator terminal observation, nebo post-success
pre-issuance failed gate, a `contractualVerifierRun=NO_RUN`.
Již issued create token se při libovolném prelaunch gate failure spotřebuje s
D039 count `0`, při launched success/failure s count `1`. Již issued verify
token se spotřebuje při PASS, CHANGES_REQUIRED i BLOCKED outcome; BLOCKED jej
neopravňuje remintnout.

Readiness před `leaseGeneration` activation je explicitně mimo D039 operational
run. Smí používat pouze orchestration task/identity channel, nikoli Git nebo
direct common-metadata access. Pokud z něj nelze prokázat quiescence, výsledek
je `NOT_STARTED / TOKENS_UNMINTED / AUTHORITY_UNCONSUMED`; žádný preflight fact,
digest ani PASS evidence nevzniká. Až po pozdější prokázané quiescence lze
provést právě jeden start; nejde o retry operational runu. Okamžik lease
activation je start a
irreversible consumption boundary: jakýkoli následný failure buď zruší dosud
nevydaný token přes `CANCELLED_UNISSUED`, nebo spotřebuje vydaný token přes
`CONSUMED`.

Lease zakazuje všem ostatním rolím včetně `/root`, docs reviewerů, starých
creator/verifier tasks i uživatelského shellu nejen Git write, ale také
`status`, `log`, `rev-parse`, `worktree list`, `cat-file`, libgit2/JGit access a
přímé čtení common `.git` metadata. Creator/verifier smějí jen D038-inherited
typed captures a exact Git envelopes. Orchestrator status polling během lease
nesmí sahat na Git; používá pouze task channel.

Před prvním creator Git readem musí token/lease observation obsahovat
`leaseHeld=true`, exact generation/issuer/holder, exact 24-entry exclusions,
activation monotonic boundary před token issuance a potvrzení nulového external
access countu. Jakýkoli external access, identity collision, lease gap,
concurrent holder nebo neprokázaná quiescence je terminal
`BLOCKED_BEFORE_ATTEMPT`, spotřebuje D039 authority a zakazuje launch.

Creator začne s vlastním D039 `commandAttemptCount=0`; D038
`commandAttemptCount=0` a `creatorPostGoCommandCount=0` zůstávají navždy
historické a nemění se.
Final preflight snapshot musí být complete a byte-bindnout D039 promotion,
D038 promotion+incident, source/private/common-Git pins, full lease/token
records a všechny inkorporované §5.1 pre-effect gates/manifests. Teprve
explicitní final create GO nad tímto snapshotem smí spustit
exact command; launch atomicky přepne pouze D039 command counter `0 -> 1`. Bez
complete snapshotu GO neexistuje. Žádný provisional digest se nesmí doplnit po
GO. Jakýkoli gate failure po vydání create tokenu jej spotřebuje s D039 count
`0`; token ani counter se nikdy nevrací zpět.

## 7. Exact D039 create a no-write read envelope

Jediný create effect v `D039-CREATE-01` je:

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
    GIT_COMMITTER_NAME=M1-D039-Worktree \
    GIT_COMMITTER_EMAIL=m1-d039-worktree@localhost \
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
      --reason Decision039-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

Environment má exact čtrnáct assignments a argv exact patnáct `-c` overrideů.
`HOME` ani jiný key není přítomný. Creation záměrně nemá
`GIT_OPTIONAL_LOCKS=0` ani `--no-optional-locks`; ty jsou povinné pro každý Git
read. `--force`, branch/ref creation, hook, filter, lazy fetch, protocol,
submodule, maintenance, GC, fsmonitor, split/sparse index, parallel checkout a
druhý command jsou zakázané.

Každý Git read creator/verifier/materializeru dědí D038 exact typed tail a
patnáct `-c` overrideů. Exact env má patnáct assignments:

    PATH=/usr/bin:/bin
    LANG=C
    LC_ALL=C
    TZ=UTC
    GIT_CONFIG_NOSYSTEM=1
    GIT_CONFIG_GLOBAL=/dev/null
    GIT_TERMINAL_PROMPT=0
    GIT_ASKPASS=/bin/false
    SSH_ASKPASS=/bin/false
    SSH_ASKPASS_REQUIRE=never
    GIT_NO_LAZY_FETCH=1
    GIT_ATTR_NOSYSTEM=1
    GIT_OPTIONAL_LOCKS=0
    GIT_COMMITTER_NAME=M1-D039-Worktree
    GIT_COMMITTER_EMAIL=m1-d039-worktree@localhost

Git executable prefix je vždy `/usr/bin/git --no-optional-locks`; read root je
jen canonical checkout nebo exact target. No-write invocation má stejné
patnáct config overrideů jako create argv. Target tails jsou přesně
`rev-parse --verify HEAD`, `rev-parse --verify HEAD^{tree}`,
`symbolic-ref -q HEAD`, ignored-aware `status`, tracked/stage/others/ignored
`ls-files`, exact B37 `ls-tree` a bounded `cat-file --batch` z D038. Každý
record byte-bindne env/argv/stdin/exit/signal/stdout/stderr. Plain nebo ambient
Git je red.

Expected `locked` payload je exact reason plus jeden LF, 80 bytes a SHA-256
`6bac3e4ef2f06a0b87ce425a16362d35ee3e97fce3f2ef8e2647fa585c5d4959`.
Ostatních pět D038 stable control hashes, allowed admin entry set, run-specific
index/reflog captures a celá checkout closure zůstávají exact. Successful
poststate je detached `B37`, exact tree, empty ignored-aware status i oba
others streams a zero mismatch/drift findings.

## 8. Creator observation, verifier handoff a materializer boundary

Successful creator vydá pouze non-filesystem `creatorObservation`. Kromě všech
selectively inherited D038 fields obsahuje D039 governance pins, celý §3 red incident,
canonical serialization a SHA-256 final preflight snapshotu, lease token/run
identity/generation/boundaries/exclusion-set bindings, nulový external access
count, create-token state transcript, D039 `commandAttemptCount=1`, exact
substituted create/read envelopes a changed locked proof.
Nemá verifier verdict a nesmí být uložen do repo, targetu ani private rootu.

Distinct verifier smí začít jen atomickým verify-token issue+activation a
creator-to-verifier lease transferem po complete creator success. Fresh od nuly zopakuje všechny D038 same-FD index/info/config,
Git semantic, ignored, admin, FS/tree/index/blob/mode a common-Git no-drift
proofs. Vlastní `verifiedSourceHandoff` byte-bindne creator observation i final
preflight snapshot, uvede `verifierTask`, verifier exclusions, verify-token
binding/state, lease continuity, zero external access, recomputed observations,
P0/P1/drift counts a odvozený verdict `PASS|CHANGES_REQUIRED`. Pouze `PASS` s
nulovými county je validní. `BLOCKED` je terminal task outcome s absent handoff,
nikoli třetí handoff verdict.

Teprve composite D039 creator observation + verifier-owned PASS může být předán
původnímu `/root/v5_materializer`. Ten před private chmod/edit znovu provede
D038 inherited two-boundary source/index/info/config/private/red revalidation.
D039 nevydává nový private transaction, retry, seal, runtime, H0 acceptance,
T3, Gate, push, tag ani release authority; pouze odemyká dosud nespotřebovanou
D037 same-root repair authority po validním source handoffu.

## 9. Terminal failure semantics

Failure po lease activation, ale před CREATE issuance, canceluje oba unissued
tokeny, forecloses jedinou D039 authority a zachová vlastní
`commandAttemptCount=0`/`launch=false`. Failure po CREATE issuance, ale před
final GO, spotřebuje issued CREATE s count `0`; po GO je D039 count nevratně
`1`. Historické D038 county zůstávají `0`. Nonzero exit, signal, race, partial
target, changed index/info/config/mount, wrong closure nebo jakýkoli extra Git
delta končí `STOP / FREEZE`. Verifier failure je stejně terminal.
Každý creator terminal outcome spotřebuje create token; každý verifier terminal
outcome spotřebuje verify token. Žádný token se neremintuje ani nepředává jiné
identity.

V žádném failure stavu se target/admin nemaže, neopravuje, nepruneuje,
neunlockuje ani nerecykluje; create, creator nebo verifier run se neopakuje a
private repair nezačne. Pokračování vyžaduje další canonical governance.
Failure observation vždy zachová exact failed phase, lease transcript,
count/launch, všechny dostupné stdout/stderr a partial filesystem/common-Git
observations bez povýšení provisional bytes na PASS evidence.

## 10. Decision039 acceptance matrix

1. `R39-01` — exact B39/tree a immutable D038 decision/WP/report blobs jsou připnuté.
2. `R39-02` — exact terminal D038 red observation a provisional non-evidence jsou zachované bez reclassifikace.
3. `R39-03` — exact four-path subject, reserved report, DAG a pairwise-distinct live/design registry jsou uzavřené.
4. `R39-04` — stejné target/admin jsou před D039 any-type absent; žádný cleanup, alternate path nebo reuse není povolený.
5. `R39-05` — nové oddělené create/verify tokeny, D039 counter a hard launch/activation barriers jsou exact.
6. `R39-06` — celý inherited D038 hardened create/read/index/info/config/blob contract platí s úplnými D039 overrides.
7. `R39-07` — jediný povolený effect je jeden nový detached locked worktree; ostatní Git/private/runtime state zůstává invariantní.
8. `R39-08` — nový creator observation a až následný nový verifier PASS jsou nutné; žádný D038 artefakt je nenahrazuje.
9. `R39-09` — evidence write, private repair, seal, runtime, import, push, tag a release authority zůstává NONE.
10. `R39-10` — D037 zůstává live base a jen verified D039 PASS handoff může znovu otevřít původního materializera.

## 11. Povinné negativní fixtures

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

Každá fixture musí selhat nezávisle. Poslední čtyři explicitně modelují
prelaunch incident: verifier nesmí předběhnout creator success, žádná D038
identity/authority se nerecykluje, red/provisional state se nepovýší a jediný
external read nebo write během lease je terminal. Author ani docs reviewer
fixtures nespouští proti live common Git nebo private rootu; používá jen
isolated synthetic bytes.

## 12. Canonical docs-only DAG a gates

Subject má exact allowlist:

1. `docs/decisions/039-m1-h0-v5-detached-source-checkout-prelaunch-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELAUNCH-REMEDIATION.md`

Reserved report je v B39 i subjectu absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-prelaunch-remediation-20260818-report.md

Povinný DAG je:

    B39
      -> S_H0V5SRC039
      -> E_A_H0V5SRC039
      -> C_H0V5SRC039
      -> E_B_H0V5SRC039
      -> integration/m1-consolidated-20260810 --ff-only

Review A je fresh `/root/decision039_review_a`. Jeho evidence commit je direct
child subjectu a mění jen reserved report exact čtyřmi LF-terminated řádky:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 9205a906602cbd6e9a0e6cf3ebe8d30ed06113c2
subjectHead: <full-S_H0V5SRC039-sha>
reviewA.verdict: PASS
```

Candidate má ordered parents `[B39,E_A_H0V5SRC039]`, exact Review-A
tree a preserved subject/report blobs. Fresh `/root/decision039_review_b`
vytvoří direct child candidate a do téhož reportu připojí jen:

```text
candidateHead: <full-C_H0V5SRC039-sha>
reviewB.verdict: PASS
```

Pouze oba PASS a exact candidate dovolí canonical fast-forward. Findings,
`CHANGES_REQUIRED` nebo `BLOCKED` nevytvoří candidate, promotion ani source
authority. Push, tag, release a history rewrite jsou zakázané.

Před i po subject commitu musí projít exact B39/tree/clean writer, exact
four-path diff, absent report, D038 blob/report/incident pins, target/admin
absence, frozen private/red state, role/exclusion parity, matrix/fixture
once-only parity, substitution completeness, create/read env/config counts,
lease/sequence state machine, artifact validation `151/151`, registry
validation `382 + 8`, repository hygiene `PASS / 1619 subject paths` a
`git diff --check`.

## 13. Transparentní author evidence

Author provedl pouze read-only inventuru a docs edit v novém isolated writer
worktree přímo z exact B39. D038 terminal observation převzal jako immutable
orchestrator truth; provisional incident digesty nepoužil jako evidence.
Nevytvořil target/admin, nespustil create/read operational envelope, private
repair, runner, fixture proti live stavu ani runtime a nevydal report,
candidate, promotion nebo push.

Při bounded opravě cancellation/verifier state machine pět multi-file `apply_patch`
pokusy nenašly exact context a selhaly atomicky před zápisem. Následné split
patche uspěly; nevznikl partial docs stav ani common-Git target/admin,
private/runtime nebo remote effect. Tyto tooling failures nejsou gate evidence.

Jeden semantic re-auditor omylem přesměroval artifact-test stdout do exact
`/tmp/d039-final-artifact-audit.out` a tentýž exact temp file ve stejném commandu
odstranil. Gate poté zopakoval bez file outputu s výsledkem `151/151`. Repo,
common Git, target/admin, private root ani runtime se nezměnily; tento audit se
nepočítá jako pristine final attestation.

Pravdivý stav do úspěšné D039 promotion a pozdějších operational runs je:

    D038: BLOCKED_BEFORE_ATTEMPT / AUTHORITY_CONSUMED / NO_RETRY
    D039: DOCS SUBJECT PENDING INDEPENDENT REVIEW / NO OPERATIONAL RUN
    D037 PRIVATE REPAIR: BLOCKED_BEFORE_TRANSACTION / UNCONSUMED
    V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO_NOT_EXECUTE
    RUNTIME / ACCEPTANCE / T3 / GATES: NO_AUTHORITY
