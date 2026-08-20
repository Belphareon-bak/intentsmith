# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-AUTHORITY

**Výsledek:** docs-only operational authority k jedinému create attemptu
nového, fixně pojmenovaného, locked detached source worktree na promoted
Decision037 Review B; žádný private core ani runtime effect.

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision / B37:** `df1863439b6ad83abf41396ba8063e5bffaa599e`

**baseTree:** `1f0e730a46a94a7f741b2dbf47426458b8125a97`

**Stav:** `R1_CHANGES_REQUIRED / SOURCE_CHECKOUT_AUTHORITY_R2_PENDING_REVIEW / PRIVATE_REPAIR_HOLD /
NO_RUNTIME_AUTHORITY`

## 1. Vstup a blocker

Decision037 §5.6 vyžaduje čistý detached source checkout na exact promoted
`B37`. Při pre-S-R2 inventuře jsou canonical, D037 Review B i D038 R2 writer
worktree branch-attached a detached count je nula. Po `S_H0V5SRC_R2` zůstanou
oba pre-existing B37 worktrees branch-attached. D037 nedává autoritu měnit common-Git worktree
metadata, takže `/root/v5_materializer` skončil `BLOCKED_BEFORE_TRANSACTION`
bez chmod/editu a jeho jediná same-root private repair authority zůstává
unconsumed.

Frozen V5 root je exact:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74

OLD core zůstává plan
`c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca`
/ 128 493 / `0400`, runner
`0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb`
/ 619 441 / `0500` a strategy
`26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d`
/ 67 666 / `0400`. Evidence je empty; detached digests, manifest, marker a seal
jsou absent.

Authentic red recorder je exact root
`/home/belphareon/.local/share/intentsmith-private/m1-h0-v5-preseal-red-review-d037-20260818T121226Z.hotln2oq`
s result/manifest/digest SHA-256
`da95531f261800d3f3262141a7e205680359ea3db6c2036c65816129f43d1aeb`,
`34c9b6af49cbdd2f24b0974207065ad00f86bcb560286e7054cd5ee6af268a0d` a
`3f279358c690c2f8d4773678d16442ac82d55210139a1d30e1be5063d195e75f`.

Failed R1 subject `S_H0V5SRC` je zachovaný jako
`704dfa70e5d1856d98308315e1f030eb952f8ccf`, tree
`b44d95c94aaf1ba5bc5419cdc01997689efe59cd`. Fresh historický
`/root/decision038_review_a` vydal `CHANGES_REQUIRED`, `P0=0/P1=2`:

1. `P1-01 POSTSTATE-READS-NOT-READONLY` — chyběly
   `GIT_OPTIONAL_LOCKS=0` a `--no-optional-locks`, takže read mohl zapsat index;
2. `P1-02 CHECKOUT-ATTRIBUTE-IGNORE-CLOSURE-INCOMPLETE` — nebyly připnuté
   info attributes/exclude, ignored streams ani full filesystem-vs-tree closure.

R1 report i `E_A_H0V5SRC` jsou absent; nevznikl candidate, Review B, promotion
ani authority. Live corrective governance používá výhradně `_R2` symboly.

## 2. Exact authority a owned paths

Po vlastním Review A/B a canonical promotion jsou jedinými operational tokeny:

    EXACTLY_ONE_D037_EB_DETACHED_SOURCE_WORKTREE_CREATE_ATTEMPT
    NO_EXISTING_WORKTREE_OR_BRANCH_MUTATION
    NO_PRIVATE_CORE_OR_RUNTIME_AUTHORITY
    NO_PUSH_TAG_RELEASE_HISTORY_REWRITE

Target, admin a common checkout jsou exact:

    target: /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    admin:  /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    common checkout: /home/belphareon/worktrees/is-m1-consolidated

Target i admin musí být bezprostředně před effectem any-type absent. Nevzniká
autorita detachnout, checkoutnout, move/remove/prune/repair/unlocknout,
recyklovat nebo jinak změnit libovolný existující worktree či branch. Partial
failure je terminal a spotřebuje attempt bez cleanupu nebo retry.
`--lock` je advisory Git admin lock, ne filesystem immutability proof; exclusive
writer, repeated same-FD stability a full closure zůstávají povinné.

Common `info/attributes` je pre/immediate/post/verifier/materializer any-type
absent. Common `info/exclude` je ve všech těchto fázích same-FD potvrzený regular
non-symlink mode `0664`, UID/GID `1000/1000`, nlink `1`, 400 bytes, SHA-256
`468044a7d11af1e2b923279d508e54ddac2298a018d3005b70d434bb4de11e53` a obsahuje
active `/.worktree-archive/`. Common config
`/home/belphareon/Projects/intentsmith/.git/config` je regular non-symlink mode
`0664`, UID/GID `1000/1000`, nlink `1`, exact 10 775 bytes/SHA
`35e602372a295fd0baad6eb1877837a17c6caec6845a7776cdff375daa40042f`.
Typed parser captured bytes odmítá `include`, `includeIf`, enabled
`extensions.worktreeConfig` a attributes/excludes/autocrlf/eol override; common
`config.worktree` je any-type absent. Config leží na `/home` filesystemu typu
`btrfs` a mount options musí ve všech phase captures obsahovat `noatime`.

## 3. Exact task registry

Všech pět rolí je pairwise distinct:

| Role | Exact task |
|---|---|
| writer | `/root/decision038_writer` |
| R2 Review A | `/root/decision038_r2_review_a` |
| R2 Review B | `/root/decision038_r2_review_b` |
| creator | `/root/v5_d038_source_checkout_materializer` |
| verifier | `/root/v5_d038_source_checkout_verifier` |

Creator exact sorted exclusions, bez vlastního tasku:

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
    /root/v5_d037_fresh_preseal_review
    /root/v5_d037_postseal_review_a
    /root/v5_d037_postseal_review_b
    /root/v5_d038_source_checkout_verifier
    /root/v5_formal_preseal_review
    /root/v5_materializer

Verifier používá stejný sorted set, ale verifier task je nahrazen creator
taskem `/root/v5_d038_source_checkout_materializer`. Creator != verifier se
ověří samostatně; pět live R2 rolí je pairwise distinct a R2 A/B jsou distinct
i od historických R1 A/B. Git author ani prose label není identity source.
Historický R1 A je executed red; historický R1 B nikdy neběžel. Oba zůstávají
excluded a nejsou live R2 reviewers.

## 4. One-shot create procedure

### 4.1 Pre-effect

Creator fresh připne promoted D038 R2 DAG a report, exact B37/tree,
target/admin absence a jediný common-Git writer slot. Zaznamená before manifest
common `HEAD`, config, packed refs, `refs/**`, object inventory, common index a
všech control files preexisting worktrees. Common config projde same-FD
protokolem z §4.4, odpovídá exact stat/10 775-byte/SHA pinu z §2, parser odmítne
všechny tam zakázané inputs, common `config.worktree` je absent a mount pin je
exact. Common info inputs odpovídají §2.
Neexistují relevantní lock files, `.gitmodules`, `.gitattributes`, filters,
alternates ani promisor/lazy-fetch authority. Každý Git read v tomto preflightu
už používá exact no-write envelope z §4.3; plain `git` je zakázaný.
System/global attribute controls nevypínají common `info/attributes` a
`core.excludesFile=/dev/null` nevypíná common `info/exclude`; proto jsou info
pins, ignored streams a full FS walk samostatné mandatory gates.

Před fixed-subshell launchem je `commandAttemptCount=0`. Jakýkoli prelaunch
failure končí `BLOCKED_BEFORE_ATTEMPT` s count `0`, ale permanentně uzavírá a
spotřebuje D038 authority; žádný recheck/retry/command bez nové governance.
Launch fixed subshellu je jediný přechod `commandAttemptCount: 0 -> 1`.

### 4.2 Exact effect

Jediný povolený command je následující fixed subshell; po `umask 077` jej
`exec` nahradí environment-clean Git childem:

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
    GIT_COMMITTER_NAME=M1-D038-Worktree \
    GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost \
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
      --reason Decision038-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

Git child env obsahuje pouze čtrnáct explicitních assignments výše; `HOME` a
všechny ostatní keys jsou absent. Argv má patnáct `-c` overrideů. Creation
záměrně neobsahuje `GIT_OPTIONAL_LOCKS=0` ani `--no-optional-locks`. `--force`, branch, hook, fsmonitor,
split/sparse index, submodule, maintenance, GC, protocol, lazy fetch, parallel
checkout a druhý attempt jsou zakázané.

### 4.3 Exact no-write Git-read envelope

Každý preflight/postflight/verifier/materializer Git read používá
`/usr/bin/env -i`, nemá `HOME` ani jiný key a má exact patnáct assignments:

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
    GIT_COMMITTER_NAME=M1-D038-Worktree
    GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost

Exact argv prefix každého readu je:

```text
/usr/bin/env -i \
  PATH=/usr/bin:/bin \
  LANG=C LC_ALL=C TZ=UTC \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
  SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
  GIT_NO_LAZY_FETCH=1 GIT_ATTR_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 \
  GIT_COMMITTER_NAME=M1-D038-Worktree \
  GIT_COMMITTER_EMAIL=m1-d038-worktree@localhost \
  /usr/bin/git --no-optional-locks \
    -C <EXACT_READ_ROOT> \
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
    <TYPED_READ_TAIL>
```

Read root je jen canonical checkout nebo po úspěšném effectu exact target.
Target proof tails jsou exact `rev-parse --verify HEAD`,
`rev-parse --verify HEAD^{tree}`, `symbolic-ref -q HEAD`,
`status --porcelain=v1 -z --untracked-files=all --ignored=matching`,
`ls-files -v -z --`, `ls-files --stage -z --`, oba ignored/nonignored
`ls-files --others` tails, `ls-tree -r -z --full-tree
df1863439b6ad83abf41396ba8063e5bffaa599e --` a
`cat-file --batch`. Ostatní DAG/ref/worktree reads mají předem typed argv pod
stejným envelopem. Plain Git, alias, pager, shell/glob a jakýkoli index refresh,
lock, hook, lazy fetch nebo jiný write jsou red.

Každý record obsahuje env/argv/stdin, exit/no-signal a raw stdout/stderr SHA.
Target reads mají exit `0`/empty stderr; jediná výjimka je detached
`symbolic-ref`, expected exit `1` a empty stdout/stderr. Batch stdin jsou exact
LF-terminated OIDy a framed stdout se parseuje beze zbytku.

### 4.4 Phase-bound index/info/config capture

Po create exit `0`/no-signal a před jakýmkoli Git readem creator path-lstatne a
právě jednou otevře admin `index` `O_RDONLY|O_NOFOLLOW|O_CLOEXEC`; na témže FD
provede `fstat -> count+SHA-256 stream do EOF -> fstat`, pak path znovu lstatne.
Path/FD device+inode a type/mode/uid/gid/nlink/size/mtime_ns/ctime_ns musí být
identical, `bytesRead==size`; atime se neporovnává. File je regular, UID/GID
`1000/1000`, nlink `1`; actual record je run-specific pin. Stejně ověří
`info/attributes` absent a
same-FD exact `info/exclude` pin z §2.

Common config se v preflightu, immediate fázi před prvním post-create Git readem
a creator-final fázi path-lstatne a otevře jednou
`O_RDONLY|O_NOFOLLOW|O_NOATIME|O_CLOEXEC`. Na témže FD proběhne
`fstat -> count+SHA-256 stream do EOF -> fstat`, nový path `lstat` a close.
Path/FD identity, type/mode/uid/gid/nlink/size/device/inode/mtime_ns/ctime_ns jsou
před/po i mezi fázemi exact; atime se neporovnává a `bytesRead==size`. Každý
record odpovídá §2 stat/bytes/SHA pinu, typed parser odmítne `include`,
`includeIf`, enabled `extensions.worktreeConfig` a zakázané core overrides,
common `config.worktree` zůstává absent a mount observation je exact
`/home`/`btrfs`/`noatime`.

Po všech creator readech se index, info i config protokol opakuje a musí být
byte/stat identický s immediate/preflight. Verifier provede nové same-FD captures
před prvním i po posledním svém Git readu; materializer totéž před prvním i po
posledním revalidation Git readu, přičemž oba jeho records vzniknou před private
chmod/edit. Všechny captures musí navázat stejné index/info/config bytes,
invariantní stat fields, parser result, `config.worktree` absence a mount pin.
Replacement, refresh, mtime/ctime nebo info/config/mount drift je terminal.

### 4.5 Successful poststate a full closure

Exit je `0`, bez signálu. HEAD je exact B37, tree exact baseTree a HEAD je
detached. Raw enveloped
`status --porcelain=v1 -z --untracked-files=all --ignored=matching` je empty,
0 bytes, SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Raw enveloped nonignored
`ls-files --others --exclude-standard -z --` i ignored
`ls-files --others --ignored --exclude-standard -z --` jsou také 0 bytes se
stejným empty SHA-256.

`git ls-files -v -z --` má právě 1 614 sorted unique UTF-8 paths a všechny flags
jsou `H`. Po odebrání `H ` prefixu se paths serializují jako compact canonical
JSON array s jedním LF; exact SHA-256 je
`51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea`.

Exact stable control files:

| File | Bytes | SHA-256 |
|---|---:|---|
| target `.git` | 104 | `bc60b7bc82ca7b58d7c47557d2c0b7c1c9df458aef46c979dd9d26effb9d456e` |
| admin `HEAD` | 41 | `8f9e30bf8072fe837a13583a056dee64bb5ff87e87ff001321f14f8418a95bbe` |
| admin `ORIG_HEAD` | 41 | `8f9e30bf8072fe837a13583a056dee64bb5ff87e87ff001321f14f8418a95bbe` |
| admin `commondir` | 6 | `340ddcb67a6204f742cd1e28e5b462622dde7daaa8ee36001897196aacdc6d47` |
| admin `gitdir` | 75 | `6ea79e1e778da9ef8f18ec112bbe333d1230e4b02f1edd48cdeaa31b0a18dd33` |
| admin `locked` | 80 | `31fceca6b3e9b07a2c3973a39bd37d45ea36f1275bac0a1ed6a52f29608ac5b3` |

Admin closure je exact `HEAD`, `ORIG_HEAD`, `commondir`, `gitdir`, `index`,
`locked`, `logs/`, `logs/HEAD`; nic dalšího. Index/reflog bytes, inody, mtimes a
whole-admin digest nejsou prospective constants. Immediate index actual ze §4.4
je však run-specific pin a zůstává byte/stat-identický přes creator, verifier i
materializer. Vše je non-symlink a UID/GID `1000/1000`.

Full target closure je nezávislá na statusu i ignore pravidlech:

- raw enveloped B37 `ls-tree` má 151 786 bytes/SHA-256
  `f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6`,
  object format `sha1`, 1 614 blobů: 1 598 mode `100644`, 16 mode `100755`, a
  355 odvozených directories;
- enveloped stage-0 index manifest je exact stejný `(mode,oid,path)` set, bez
  nonzero stage, intent-to-add, skip/assume nebo extra entry;
- anchored no-follow FD walk obsahuje právě `.git`, 355 derived directories a
  1 614 regular tracked leaves; žádný symlink, extra/ignored file ani jiný type;
- každý leaf je UID/GID `1000/1000`, nlink `1`; tree `100644` má při exact
  `umask 077` actual `0600`, tree `100755` actual `0700`. Directory actual modes
  se zaznamenají a nesmí mít unsafe group/other nebo special bits;
- každý leaf má stable single-FD lstat/fstat/hash/fstat/lstat record bez identity
  nebo field driftu kromě atime; payload se hashuje Git framingem
  `blob <decimal-size>\0<payload>` na exact tree/index OID i SHA-256 a byteově porovná s raw
  Git blobem z enveloped `cat-file --batch` v deterministických dávkách nejvýše
  128 unique OIDů.

FS entry set, tree/index equality, per-file OID/execute parity i raw blob
equality mají canonical aggregate digest a zero mismatch counts. Clean status
ani H/path digest žádnou z těchto proofs nenahrazuje.

Všechny phase-bound common config captures, refs, packed refs, objects, common
HEAD/index, info inputs a všechny preexisting worktrees musí být byte-identické.
Jediné
povolené nové paths jsou target subtree, named admin subtree a nový worktree
list entry; parent directory metadata se smí změnit jen jejich vytvořením.

## 5. Handoff a stop

Creator vytvoří pouze orchestrator `creatorObservation`, nikdy filesystem
artefact ani verdict. Obsahuje promoted D038 R2 head/tree/report pins;
`creatorTask` a creator exclusions; `commandAttemptCount=1`; `umask=0077`;
canonical hashes exact create/read envelopes a všechny typed read invocations;
exit/no-signal a raw create stdout/stderr SHA; pre-absence;
target/admin/common paths; target, `.git` a exact admin
closure; immediate/final same-FD index stat/hash; pre/immediate/final info pins;
pre/immediate/final common-config path/FD stat/hash/stat captures, parser result,
`config.worktree` absence a `/home`/`btrfs`/`noatime` mount proof;
HEAD/tree/detached, ignored-aware status a oba zero others streams;
count/path/flags; tree/index/FS manifests, per-leaf actual mode/OID/blob proofs,
directory modes, batch transcripts, aggregate digests a zero mismatch counts;
všechny common-Git before/after digests;
`privateCoreTouched=false`, `runnerImportedOrExecuted=false`,
`runtimeEffects=false`, `push=false`.

Distinct verifier před prvním Git readem same-FD připne index/info/config, vše
fresh přepočítá pouze §4.3 envelopem, po posledním readu znovu prokáže
index/info/config identity, parser result, `config.worktree` absence a mount pin
a vytvoří vlastní
`verifiedSourceHandoff`, který byte-bindne creator observation a doplní
verifier-owned task, exclusions, vlastní before/after common-config same-FD
records a jejich cross-phase equality, recomputed observations, finding counts a
odvozený `PASS|CHANGES_REQUIRED`. Pouze composite creator observation +
verifier-owned `PASS` otevře handoff původnímu `/root/v5_materializer`. Ten
ještě před private chmod/edit same-FD rehashuje index/info/config, pouze §4.3
envelopem ověří celý source/tree/blob poststate, OLD core, red recorder,
same-root identity a D037 contract a znovu zachytí index/info/config. Oba
materializer records musí vzniknout před private effectem a být identické se
všemi předchozími. Drift zachová `BLOCKED_BEFORE_TRANSACTION`;
D038 sama nic v private rootu nemění.

Po fixed-subshell launchi je count nevratně `1`; nonzero/signal/race/partial/
wrong closure/extra Git delta spotřebuje attempt a končí `STOP/FREEZE`. No
cleanup, retry, prune, repair, unlock nebo private repair. Prelaunch failure se
řídí §4.1; oba stavy vyžadují novou governance.

Prelaunch failure vytvoří pouze non-filesystem `creatorFailureObservation` s
`authorityConsumed=true`, count `0`, `launch=false`, exact failed gate a poslední
complete common-config same-FD record nebo přesný config/stat/parser/mount gate,
na kterém capture selhal.
Postlaunch failure má count `1`, exit/signal/stdout/stderr, last completed phase
a observable partial target/admin/index/FS/common config/info/mount delta. Ani jeden failure record
není PASS handoff a nesmí spustit cleanup nebo private effect.

## 6. Acceptance matrix

1. `R38-01` — exact B37/tree, clean four-path subject a absent report.
2. `R38-02` — authority gap a unchanged OLD/red/core/unconsumed repair.
3. `R38-03` — exact R2 DAG/report and live/historical identity separation.
4. `R38-04` — target/admin absence, exclusive writer and exact info/config pins.
5. `R38-05` — one exact create envelope plus universal no-write read envelope.
6. `R38-06` — immutable index, ignored streams, admin and full FS/tree/blob closure.
7. `R38-07` — no read/effect drift to existing worktree/index/info/ref/config/object/history.
8. `R38-08` — complete new proofs in verdict-free observation + verifier PASS.
9. `R38-09` — success/failure handoff truth and no private/runtime/push authority.
10. `R38-10` — D037 stays live base; verified handoff alone reopens materializer.

## 7. Negative fixtures

1. `F38-01-TARGET-ALREADY-EXISTS`
2. `F38-02-ADMIN-PATH-ALREADY-EXISTS`
3. `F38-03-DETACH-OR-REUSE-EXISTING-CANONICAL-OR-REVIEW-WORKTREE`
4. `F38-04-SYMBOLIC-HEAD-OR-BRANCH-CREATED`
5. `F38-05-WRONG-COMMIT-TREE-PATH-RELATIVE-FORCE-OR-GUESS-REMOTE`
6. `F38-06-UNCONSTRAINED-HOOKS-CONFIG-OR-ENVIRONMENT`
7. `F38-07-DIRTY-WRONG-COUNT-PATHSET-OR-NON-H-INDEX`
8. `F38-08-EXTRA-COMMON-GIT-REF-CONFIG-OBJECT-OR-PREEXISTING-WORKTREE-DELTA`
9. `F38-09-FAILURE-OR-PARTIAL-THEN-RETRY-CLEANUP-PRUNE-OR-REPAIR`
10. `F38-10-TASK-IDENTITY-COLLISION`
11. `F38-11-PRIVATE-EVIDENCE-RUNTIME-SEAL-IMPORT-OR-PUSH-EFFECT`
12. `F38-12-D038-SUBSTITUTED-AS-LIVE-BASE-OR-1614-PINS-CHANGED`
13. `F38-13-MISSING-OPAQUE-OR-UNVERIFIED-HANDOFF`
14. `F38-14-OPTIONAL-LOCKS-READ-WRITES-INDEX`
15. `F38-15-INFO-ATTRIBUTES-TRANSFORMS-CHECKOUT`
16. `F38-16-INFO-EXCLUDE-HIDES-EXTRA`
17. `F38-17-IGNORED-SCAN-OMITTED`
18. `F38-18-TARGET-BYTES-OR-EXEC-PARITY-DIFFERS-FROM-TREE`

Čtrnáctá fixture vyžaduje red za chybějící optional-lock controls nebo index
drift. Patnáctá přidá info attribute/transform, šestnáctá skryje extra leaf přes
info exclude, sedmnáctá vynechá nebo vrátí nonempty ignored stream a osmnáctá
změní raw payload/OID/execute parity při zdánlivě clean statusu. Každá musí
selhat nezávisle na porcelain clean výsledku.

Author je nad live common Git ani private rootem nespouští. Independent docs
reviews používají pouze read-only/synthetic modeling bez create effectu.

## 8. Owned docs paths a canonical DAG

Subject exact allowlist:

1. `docs/decisions/038-m1-h0-v5-detached-source-checkout-authority.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-AUTHORITY.md`

Reserved report je v B37 i subjectu absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-authority-20260818-report.md

DAG je
`B37 -> S_H0V5SRC_R2 -> E_A_H0V5SRC_R2 -> C_H0V5SRC_R2 -> E_B_H0V5SRC_R2 -> canonical
--ff-only`. R2 E_A je direct child R2 S a mění pouze report exact čtyřmi řádky
`integrationRef`, `baseRevision`, `subjectHead`, `reviewA.verdict: PASS`.
R2 candidate má ordered parents `[B37,E_A_H0V5SRC_R2]`, exact R2 E_A tree a
preserved blobs. R2 E_B je direct child R2 C a připojí pouze `candidateHead` a
`reviewB.verdict: PASS`.

R2 E_A smí vytvořit pouze `/root/decision038_r2_review_a`, R2 E_B pouze
`/root/decision038_r2_review_b`; oba jsou distinct od writera a všech operational
rolí. `CHANGES_REQUIRED/BLOCKED` nevytvoří candidate, promotion ani create
authority. Push, tag, release a rewrite jsou zakázané.

## 9. Verification a author truth

Před i po subject commitu:

    exact B37/tree/clean isolated writer
    exact four paths; report absent
    OLD core/red recorder/evidence/no-seal unchanged
    target/admin absent; no detached B37 worktree
    every matrix ID and all 18 fixture IDs exactly once in Decision and WP
    exact R2 tasks/historical exclusions/paths/control hashes
    exact create 14 env + 15 configs and read 15 env + 15 configs envelope
    phase-bound info/config pins, immutable same-FD index and complete FS/tree/blob closure
    artifact validation 151/151
    registry validation 382 + 8
    repository hygiene PASS / 1616 subject paths
    git diff --check PASS

R2 author vytvořil jen docs draft v isolated worktree přímo z B37. Create
command, poststate a
fixtures jsou `NOT_RUN / UNVERIFIED`; target/admin/private/runtime zůstávají
nedotčené. První structural precommit skončil `P0=0/P1=1`, první semantic
precommit `P0=0/P1=2`; jejich oprava prošla dvěma zero-based precommit audity,
ale committed R1 pak fresh Review A uzavřel `CHANGES_REQUIRED`, `P0=0/P1=2`,
findings `P1-01 POSTSTATE-READS-NOT-READONLY` a
`P1-02 CHECKOUT-ATTRIBUTE-IGNORE-CLOSURE-INCOMPLETE`; report/E_A zůstaly absent.

R2 `worktree add` uspěl, ale navazující verify command běžel z nesprávného cwd
a vrátil `fatal: not a git repository`; add se neopakoval a registrace byla
následně read-only ověřena. První seed `apply_patch` použil chybný relative path
a selhal atomicky před zápisem; opravený patch uspěl. Writer, coordinator i
contract-map auditor navíc před úplným zakódováním nového read envelope použili
plain `git status` v docs-authoring worktree. Contract-map auditor tehdy pouze po
příkazu zaznamenal prior pre-staging tuple inode `13981295`, size `183391` a
SHA-256 `5cd04a4f4ffcc41e689f0d60159fa268c096c6d578f2189b3637ffcd740521a1`;
pre-command digest neexistuje a tuple neprokazuje byte immutability. Pozdější
autorizovaný staging writer index nahradil. Writer index je non-normative a
vyloučený ze subject evidence; žádný current writer-index pin se zde netvrdí.
Jde o non-evidence tooling-method incident mimo reserved operational target/admin
a private root.

První fresh R2 precommit audity nad staged snapshotem skončily
`CHANGES_REQUIRED`: structural `P0=0/P1=1` našel self-referenční a po stagingu
nepravdivý current writer-index claim; semantic `P0=0/P1=2` potvrdil tentýž
finding a navíc chybějící explicitní common-config same-FD pin ve všech
creator/verifier/materializer fázích. Tento bounded patch opravuje pouze tyto dvě
třídy. R2 čeká na dvě nové zero-based precommit review a nesmí být zatím
commitnut.

Mechanická parity kontrola s Markdown fence regexem v JavaScript template
stringu skončila před shell launch přesně
`Script error: SyntaxError: Unexpected identifier 'bash$'`; nic nezměnila.
Jeden pozdější multi-file patch nenašel WP context a selhal atomicky; split
bounded patche uspěly bez partial stavu. Ani incident není evidence.
První stale-pattern scan s neescapovaným backtickem v double-quoted regexu Bash
zastavil na `unexpected EOF` před spuštěním `rg`; single-quoted recheck uspěl.
První freeze-inventory wrapper pak použil neescapovanou shell-array interpolaci
v JavaScript template literálu a skončil před shell launch přesně
`Script error: SyntaxError: Invalid or unexpected token`; nic nespustil ani
nezměnil.
