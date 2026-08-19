# 042 — Byte-exact read constructor po terminalním D041 wrapper driftu

- **typ:** exact four-doc governance-only operational remediation; žádný
  tracked helper, private/runtime/process-control ani push efekt
- **stav subjectu:** `FROZEN_FOR_PRECOMMIT_AUDITS / NO_OPERATIONAL_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B42:**
  `2a37131366c6992c56e8abf4f1f39982d27dbd40`
- **baseTree:** `86baaefd1d2eee454c8882733292a2cb0716c9de`
- **výsledek až po Review A+B a post-E_B materializaci:** právě jeden fresh
  readiness run smí použít acyklický P→D→B→outer constructor V4.2; pouze jeho
  complete PASS dovolí nepřerušený ff-only promotion→CREATE→fresh D042
  post-verifier řetěz

D041 docs Review A+B jsou `PASS`, ale její jediný operational run je
`BLOCKED / INCOMPLETE` a terminal. První scoped Git child byl prokazatelně
spuštěn bez povinného bezprostředního CLI prvku `--no-optional-locks`.
D041 se nesmí retryovat ani přepsat na PASS. Toto rozhodnutí zavádí nový
namespace a byte-exact CPython constructor, který odděleně zachytí stdout,
stderr, exit i signal a vždy reapne child nebo uzavře stav jako unknown.
Subject sám žádnou operational authority nevydává.

## 1. Immutable B42, D041 artefakty a terminal incident

B42 má právě 1 626 tracked paths. Je to D041 Review-B evidence commit s
jediným parentem `11e0049951183866d7cc6e53dc80ea8c1275d96c` a stromem
`86baaefd1d2eee454c8882733292a2cb0716c9de`.

Tyto tři D041 artefakty jsou immutable a D042 je nesmí editovat:

| Artefakt | Git blob | SHA-256 obsahu | Bytes |
|---|---|---|---:|
| Decision041 | `f40f056c7539bef8cbf67a56fc7c4329a6ebf881` | `21a8655ca9d5e03b200c70278d735b08d39ced67e5dbcbae973b59f09e61a3e6` | 27 569 |
| Decision041 WP | `def68dd58eb2f9c691a7c83d1b5ab4832402d6fc` | `1e7526ed9a98c061f8ea8d5ba654d7b2b8a584c21292974405a1257f53732b89` | 13 188 |
| D041 Review-B report | `f341cad2a5dadba21d51e37a66180c6736339a8c` | `31be98a754f789ef63d4a01e597b0d119b39b23176b9f96ef35b0a129c00f7a6` | 262 |

D041 report má právě šest LF-terminated řádků:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: d0a1c91c76eea039dddf428e57cd758c26a9c81f
subjectHead: 3d584cf0e94f1c382286604cded220fa6df6136c
reviewA.verdict: PASS
candidateHead: 11e0049951183866d7cc6e53dc80ea8c1275d96c
reviewB.verdict: PASS
```

Tyto PASS verdicty dokazují jen D041 docs/candidate. Jediný D041 readiness
token je `CONSUMED`, attempt/launch jsou `1`/`true` a outcome je
`BLOCKED / INCOMPLETE`. První scoped Git child měl D041 READ15+CONFIG15 a
environmentový `GIT_OPTIONAL_LOCKS=0`, ale raw argv začínalo
`/usr/bin/git -C`; bezprostřední CLI prvek `--no-optional-locks` chyběl.
Verifier okamžitě zastavil. Full argv, stdout, stderr i terminal machine
artifact jsou `ABSENT/UNKNOWN`; nesmějí se domyslet z pozdější absence targetu.

D041 CREATE/VERIFY jsou `CANCELLED_UNISSUED`, lease je closed, handoff absent,
promotion/create counts jsou `0`/`0`, oba launch flags `false`, target i admin
zůstaly absent a nebyl pozorován private/runtime/push efekt. D041 je terminal
bez retry.

Před D042 provedl contract adversary plain `git status --short --branch`.
Výstup vypadal clean, ale optional index refresh nelze vyloučit. Tento read je
`PRELEASE_D042_NON_EVIDENCE`, jeho index effect je `UNKNOWN` a fresh D042
baseline jej nesmí přijmout jako důkaz. Nebyl pozorován explicitní efekt.

První precommit Review-A audit je rovněž invalidní non-evidence incident.
Reviewer v exact cwd
`/home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-read-constructor-remediation-20260818-writer`
spustil exact command
`GIT_OPTIONAL_LOCKS=0 git --no-optional-locks write-tree`; stdout byl exact
`eb1b3c5a1348387efb15ef17d13ef65dcc084c1e` + LF. Před commandem ale
neexistoval object-store ani index-byte/cache-tree pin. Možné vytvoření shared
common-Git tree objectu je proto `UNKNOWN` a možná změna index cache-tree
extension je `UNKNOWN`. Exit/signal/stderr/session nebyly v předané incident
evidenci byte-pinned a zůstávají `ABSENT/UNKNOWN`.

Tento stav je exact `PRECOMMIT_REVIEW_A_NON_EVIDENCE`: audit okamžitě skončil,
nevydal PASS/P0/P1 ani usable freeze pin. Vypsaný tree OID není přijatý staged
manifest, operational readiness, token attempt ani lease effect. D042 tokeny
zůstávají `UNMINTED` a operational run nezačal. Cleanup, object deletion,
index rollback nebo jiná pokusná náprava je zakázaná; incident zůstává
dohledatelný a další review musí začít fresh od nově serializovaného staged
content manifestu.

Live source zůstává výhradně B37
`df1863439b6ad83abf41396ba8063e5bffaa599e`, tree
`1f0e730a46a94a7f741b2dbf47426458b8125a97`, 1 614 paths. Canonical před
operational runem musí být exact
`c38e1b24849521b41025e70a37bf0219466c9d1e`, tree
`0b0cdff832b18cb75fcfd0ed2ed42e0701cc5a7e`. Fixed target je
`/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343`.

## 2. Bezpečnostní ruling A a přesná hranice tvrzení

Přijatý ruling je **A**. Rooty důvěry vynucené současným `exec_command` API
jsou: task runner, jeho již načtený a post-E_B připnutý `/bin/dash` a během
lease fenced lokální filesystem. Outer builtin preflight rozpozná náhodný
ambient drift 22 loader proměnných ještě před `exec`; `/usr/bin/env -i` pak
dává bootstrapu i dispatcheru přesně čisté prostředí.

Ruling A nedokazuje odolnost proti útočnému preloadu, který již před
preflightem kompromitoval načtený dash. Same-FD pre/post audit také nedokazuje,
že path-based exec použil držený inode proti útočnému transient swap→revert.
Obojí je explicitně `NOT_PROVEN_OUT_OF_SCOPE`; žádný silnější isolation claim
se nesmí vydat.

Normální `O_RDONLY` čtení může změnit atime. `O_NOATIME` je zakázané, atime se
nezahrnuje do pinned metadata a každý live audit hlásí
`POSSIBLE_UNKNOWN`, nikoli nulový filesystem efekt. Povolené jsou jen bounded
read-only same-FD reads exact post-E_B profile paths. Žádný Git subprocess,
write, temp/helper, process cleanup, private read/write ani runtime start není
součástí těchto auditů.

## 3. Exact U42, holders a fencing

Live D042 roles jsou writer `/root/decision042_writer`, Review A
`/root/decision042_review_a`, Review B `/root/decision042_review_b`, adversary
`/root/decision042_adversary`, architect `/root/decision042_architect`, sole
issuer/promoter/creator `/root`, readiness verifier
`/root/v5_d042_prelease_readiness_verifier` a distinct post-create verifier
`/root/v5_d042_source_checkout_verifier`.

Exact sorted 49-entry universe `U42` je:

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
/root/decision041_adversary
/root/decision041_architect
/root/decision041_review_a
/root/decision041_review_b
/root/decision041_writer
/root/decision042_adversary
/root/decision042_architect
/root/decision042_review_a
/root/decision042_review_b
/root/decision042_writer
/root/v5_d037_fresh_preseal_review
/root/v5_d037_postseal_review_a
/root/v5_d037_postseal_review_b
/root/v5_d038_source_checkout_materializer
/root/v5_d038_source_checkout_verifier
/root/v5_d039_source_checkout_materializer
/root/v5_d039_source_checkout_verifier
/root/v5_d040_source_checkout_materializer
/root/v5_d040_source_checkout_verifier
/root/v5_d041_prelease_readiness_verifier
/root/v5_d042_prelease_readiness_verifier
/root/v5_d042_source_checkout_verifier
/root/v5_formal_preseal_review
/root/v5_materializer
```

Každý holder používá sorted exclusion set `U42` bez sebe, tedy přesně 48
entries. Žádná osmá D042 identity není dovolena. Po post-E_B materializaci a
auditu jsou architect, writer, Review A a adversary fenced; Review B po final
handoffu fence-ne sebe. Readiness verifier po PASS handoffu fence-ne sebe.
Root po transferu na post-verifier už nic nečte. Fenced role se nereaktivuje
k Git/direct metadata/private/process accessu.

## 4. Fresh namespace, write příkazy a direct-read piny

Fresh identifiers jsou:

```text
D042-PRELEASE-READINESS-01
D042-CREATE-01
D042-VERIFY-01
D042-H0V5-DETACHED-SOURCE-CHECKOUT-LEASE-01
```

Committer je `M1-D042-Worktree` / `m1-d042-worktree@localhost`; lock reason je
`Decision042-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e`.

| Input | Elements / bytes | SHA-256 |
|---|---:|---|
| CREATE14 compact JSON+LF | `14` / `339` | `bf983f755d42e425955cff687ee511a3d2b87cd3ef31fa06167b3ec591b87b31` |
| READ15 compact JSON+LF | `15` / `362` | `018d10533e68dfd261c22ceed97be36a41552866578870884dafdfa86d93a65c` |
| CONFIG15 compact JSON+LF | `15` / `393` | `e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085` |
| CREATE argv compact JSON+LF | `59` / `1171` | `823b80bc3ccdaa4ad4cabfdbd88c8f1aaa3f37db4715171b7a827d22876abc95` |
| promotion template compact JSON+LF | `53` / `953` | `713ae5d1d5cc33b0005409eb9ceaaf5c2822bab123c9ddfef057f11f153a16fe` |
| lock reason raw ASCII+LF | `1` / `80` | `ccde801e53e12750a1b5f247d2536e2a9f5fb68a5f7e82c14493195982a3d437` |
| direct prefix template compact JSON+LF | `34` / `532` | `5e8537759c0cf3d261a87d7cc2aa90f893ef69960bdef33d19813caa392eee69` |
| canonical-scope direct prefix compact JSON+LF | `34` / `558` | `8ef942022df77787cb9dbe471667331d4050c89eafdb52513d03074dbd1b51f2` |
| target-scope direct prefix compact JSON+LF | `34` / `582` | `9512c0562504f85bd64fce9849c86be5ba91ba104bcec200f5fd9bb5a7540439` |
| first readiness direct argv compact JSON+LF | `37` / `597` | `2cec3a8e4b400fa067e83d630354dcf4c542aaa000d8780514bd7aefdd266087` |
| first post direct argv compact JSON+LF | `37` / `621` | `ef01e71a1cd6183eefa852e66823027d7ce53c2e80dfa7be637f98aeaef0d1fa` |
| READ env object in READ15 order, compact JSON+LF | `15 keys` / `392` | `b3f141f49a19a4f0471cc459b3216b99c94192501d9ef61fa295435cf2d75e15` |
| LIMITS canonical JSON fragment without LF | `5 keys` / `120` | `d8a056b40661b77f99ceda71745ec65cd995f8b028b07eaef29fd38bd6a87c78` |

Pin `b3f141…` je insertion-order READ15 environment evidence, nikoli hash
sorted canonical `READ_ENV` fragmentu P. Konkrétní sorted fragment a jeho hash
vzniknou až post-E_B v 16-fragment materializaci; bytes, values ani uvedený
fixed pin se tímto rozlišením nemění.

Pin `d8a056…` je přímo canonical `LIMITS` fragment bez LF. Terminal LF patří
až celému materialized P, nikoli jednotlivému fragmentu.

READ15 je ordered CREATE14 s `GIT_OPTIONAL_LOCKS=0` bezprostředně před D042
committer name/email. Direct prefix začíná vždy přesně
`/usr/bin/git`, `--no-optional-locks`, `-C`, exact absolute scope a poté 15
ordered CONFIG15 `-c` párů. Synthetic template používá exact literal
`<absolute-checkout>` pouze k recomputaci uvedeného template pinu; do live
operation se nikdy nedostane. První readiness i post operation mají tail
`rev-parse --verify HEAD^{commit}`. Všechny další tails jsou po E_B uzavřené
ve full operation manifestu; free-form tail construction za běhu je zakázaná.

Promotion template má jedinou phase-future substituci
`<full-E_B_H0V5SRC042-sha>`. CREATE command je fixed dash subshell: nastaví
process-local `umask 077`, provede exact 22-variable builtin preflight a jen
při clean výsledku přes `exec` spustí exact fixed argv59: `/usr/bin/env -i`
+ CREATE14 + `/usr/bin/git -C canonical` + CONFIG15 +
`worktree add --detach --checkout --no-guess-remote --lock --reason` na fixed
target a B37. Nemá force, branch, optional-lock suppression, cleanup, repair,
prune, unlock, alternate target ani retry. Promotion nemá umask a je pouze
`merge --ff-only --no-edit`.

Exact ordered promotion template je:

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
  "GIT_COMMITTER_NAME=M1-D042-Worktree",
  "GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost",
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
  "<full-E_B_H0V5SRC042-sha>"
]
```

Pro `rootWriteChain` jsou normativní také následující compact ASCII JSON+LF
preimages. Vnitřní obsah každého code blocku končí právě jedním LF a nemá jiné
whitespace. Pair-form environment je `NON_AUTHORITY`; `envOrdered` je přesně
14-string CREATE14 vector.

CREATE14 / `envOrdered`, 14 elements, 339 bytes, SHA-256
`bf983f755d42e425955cff687ee511a3d2b87cd3ef31fa06167b3ec591b87b31`:

```json
["PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost"]
```

Promotion prefix `argv[0:52]`, 52 elements, 925 bytes, SHA-256
`370477a7fd67586c461a12e2df40f017bd636f6b4d1e207f294c53665a9527f9`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","merge","--ff-only","--no-edit"]
```

Promotion template, 53 elements, 953 bytes, SHA-256
`713ae5d1d5cc33b0005409eb9ceaaf5c2822bab123c9ddfef057f11f153a16fe`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","merge","--ff-only","--no-edit","<full-E_B_H0V5SRC042-sha>"]
```

CREATE prefix `argv[0:56]`, 56 elements, 974 bytes, SHA-256
`c539b80e570c69a9a16e5ca311f90b764a8c7d4afca10aae9202cda84a6bcb6f`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","worktree","add","--detach","--checkout","--no-guess-remote","--lock","--reason"]
```

Fixed CREATE argv, 59 elements, 1 171 bytes, SHA-256
`823b80bc3ccdaa4ad4cabfdbd88c8f1aaa3f37db4715171b7a827d22876abc95`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","worktree","add","--detach","--checkout","--no-guess-remote","--lock","--reason","Decision042-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e","/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343","df1863439b6ad83abf41396ba8063e5bffaa599e"]
```

Exact CREATE command je:

```bash
(
  umask 077
  case "${GLIBC_TUNABLES+x}${LD_ASSUME_KERNEL+x}${LD_AUDIT+x}${LD_BIND_NOT+x}${LD_BIND_NOW+x}${LD_DEBUG+x}${LD_DEBUG_OUTPUT+x}${LD_DYNAMIC_WEAK+x}${LD_HWCAP_MASK+x}${LD_LIBRARY_PATH+x}${LD_ORIGIN_PATH+x}${LD_POINTER_GUARD+x}${LD_PREFER_MAP_32BIT_EXEC+x}${LD_PRELOAD+x}${LD_PROFILE+x}${LD_PROFILE_OUTPUT+x}${LD_SHOW_AUXV+x}${LD_TRACE_LOADED_OBJECTS+x}${LD_TRACE_PRELINKING+x}${LD_USE_LOAD_BIAS+x}${LD_VERBOSE+x}${LD_WARN+x}" in '') ;; *) exit 125 ;; esac
  exec /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    LANG=C LC_ALL=C TZ=UTC \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
    SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
    GIT_NO_LAZY_FETCH=1 GIT_ATTR_NOSYSTEM=1 \
    GIT_COMMITTER_NAME=M1-D042-Worktree \
    GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost \
    /usr/bin/git -C /home/belphareon/worktrees/is-m1-consolidated \
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
      worktree add --detach --checkout --no-guess-remote --lock \
      --reason Decision042-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

## 5. Authoritative V4.2 composition a fixed V4.1 P/D/B templates

### 5.1 Authority profile template P

Normativní P template je ASCII, má terminal LF, přesně 965 bytes a SHA-256
`f6ff8e7630894d9bce12c8b679363140478a03f4dbe5f98624df83c4101a4005`.
Každý z 16 unquoted markerů se vyskytuje právě jednou:

```json
{"base":@@BASE@@,"decision":"D042","devNull":@@DEV_NULL@@,"elfClosures":@@ELF_CLOSURES@@,"executables":@@EXECUTABLES@@,"limits":@@LIMITS@@,"loaderControls":@@LOADER_CONTROLS@@,"moduleBindings":@@MODULE_BINDINGS@@,"nativeMappings":@@NATIVE_MAPPINGS@@,"operations":@@OPERATIONS@@,"pathControls":@@PATH_CONTROLS@@,"phases":@@PHASES@@,"popen":{"bufsize":-1,"closeFds":true,"creationflags":0,"cwd":"/","encoding":null,"errors":null,"executable":null,"extraGroups":null,"group":null,"passFds":[],"pipesize":-1,"preexecFn":null,"processGroup":null,"restoreSignals":true,"shell":false,"startNewSession":false,"startupinfo":null,"stderr":"PIPE","stdin":"/dev/null","stdout":"PIPE","text":false,"umask":-1,"universalNewlines":null,"user":null},"profileId":"D042-AUTHORITY-PROFILE-01","readEnv":@@READ_ENV@@,"readEnvOrder":@@READ_ENV_ORDER@@,"runtime":@@RUNTIME@@,"schema":"d042-authority-profile-v4.1","scopePrefixes":@@SCOPE_PREFIXES@@,"toolchainFiles":@@TOOLCHAIN_FILES@@}
```

P neobsahuje D/B hash ani jejich source. Marker order je přesně `BASE`,
`DEV_NULL`, `ELF_CLOSURES`, `EXECUTABLES`, `LIMITS`, `LOADER_CONTROLS`,
`MODULE_BINDINGS`, `NATIVE_MAPPINGS`, `OPERATIONS`, `PATH_CONTROLS`, `PHASES`,
`READ_ENV`, `READ_ENV_ORDER`, `RUNTIME`, `SCOPE_PREFIXES`, `TOOLCHAIN_FILES`.

### 5.2 Dispatcher template D

Normativní D template je ASCII s terminal LF, přesně 25 393 bytes, 396 LF a
SHA-256 `57ef77c0d57c7fe01b1140ffd5d3e0c5788b717e95c3369df419bd2d7a5b7735`.
Jediný 20-byte marker `@@AUTHORITY_SHA256@@` se vyskytuje jednou. Jeho source
je následující exact code block; čtyři architektonické chunky jsou spojeny bez
jediného vloženého nebo odebraného bytu:

```python
import base64,hashlib,json,os,re,stat,subprocess,sys
AUTHORITY_SHA256="@@AUTHORITY_SHA256@@"
WRAPPER_ENV={"LC_ALL":"C","PYTHONCOERCECLOCALE":"0"}
FORBIDDEN_LOADER_ENV=("GLIBC_TUNABLES","LD_ASSUME_KERNEL","LD_AUDIT","LD_BIND_NOT","LD_BIND_NOW","LD_DEBUG","LD_DEBUG_OUTPUT","LD_DYNAMIC_WEAK","LD_HWCAP_MASK","LD_LIBRARY_PATH","LD_ORIGIN_PATH","LD_POINTER_GUARD","LD_PREFER_MAP_32BIT_EXEC","LD_PRELOAD","LD_PROFILE","LD_PROFILE_OUTPUT","LD_SHOW_AUXV","LD_TRACE_LOADED_OBJECTS","LD_TRACE_PRELINKING","LD_USE_LOAD_BIAS","LD_VERBOSE","LD_WARN")
FLAG_NAMES=("debug","inspect","interactive","optimize","dont_write_bytecode","no_user_site","no_site","ignore_environment","verbose","bytes_warning","quiet","hash_randomization","isolated","dev_mode","utf8_mode","warn_default_encoding","safe_path","int_max_str_digits")
POPEN_PROFILE={"bufsize":-1,"closeFds":True,"creationflags":0,"cwd":"/","encoding":None,"errors":None,"executable":None,"extraGroups":None,"group":None,"passFds":[],"pipesize":-1,"preexecFn":None,"processGroup":None,"restoreSignals":True,"shell":False,"startNewSession":False,"startupinfo":None,"stderr":"PIPE","stdin":"/dev/null","stdout":"PIPE","text":False,"umask":-1,"universalNewlines":None,"user":None}
ROOT_KEYS=("base","decision","devNull","elfClosures","executables","limits","loaderControls","moduleBindings","nativeMappings","operations","pathControls","phases","popen","profileId","readEnv","readEnvOrder","runtime","schema","scopePrefixes","toolchainFiles")
class Reject(Exception):
 def __init__(self,code): self.code=code

def need(value,code):
 if not value: raise Reject(code)

def exact_keys(value,names,code): need(type(value) is dict and set(value)==set(names),code)

def no_number(_): raise Reject("PROFILE_NON_INTEGER_NUMBER")

def no_dups(pairs):
 out={}
 for key,value in pairs:
  need(type(key) is str and key not in out,"PROFILE_DUPLICATE_KEY")
  out[key]=value
 return out

def canonical(value): return (json.dumps(value,allow_nan=False,ensure_ascii=True,separators=(",",":"),sort_keys=True)+"\n").encode("ascii")

def digest_value(value): return hashlib.sha256(canonical(value)).hexdigest()

def sha(value): return type(value) is str and re.fullmatch(r"[0-9a-f]{64}",value) is not None

def commit(value): return type(value) is str and re.fullmatch(r"[0-9a-f]{40}",value) is not None

def clean_string(value): return type(value) is str and "\x00" not in value and "\r" not in value and "\n" not in value

def absolute(value): return clean_string(value) and value.startswith("/") and os.path.normpath(value)==value

def metadata(st):
 return {"ctimeNs":st.st_ctime_ns,"dev":st.st_dev,"gid":st.st_gid,"ino":st.st_ino,"mode":st.st_mode,"mtimeNs":st.st_mtime_ns,"size":st.st_size,"uid":st.st_uid}

def module_snapshot():
 out=[]
 for name,module in sorted(sys.modules.items()):
  spec=getattr(module,"__spec__",None)
  loader=getattr(spec,"loader",None) if spec is not None else None
  loader_name=None if loader is None else type(loader).__module__+"."+type(loader).__qualname__
  values={"cached":getattr(module,"__cached__",None),"file":getattr(module,"__file__",None),"loader":loader_name,"name":name,"origin":getattr(spec,"origin",None) if spec is not None else None}
  need(all(value is None or type(value) is str for value in values.values()),"MODULE_BINDING_TYPE")
  out.append(values)
 return out

def maps_snapshot():
 fd=os.open("/proc/self/maps",os.O_RDONLY|os.O_CLOEXEC)
 try:
  chunks=[]
  total=0
  while True:
   block=os.read(fd,65536)
   if not block: break
   total+=len(block)
   need(total<=2097152,"MAPS_TOO_LARGE")
   chunks.append(block)
 finally:
  os.close(fd)
 rows=[]
 for line in b"".join(chunks).decode("ascii","strict").splitlines():
  parts=line.split(None,5)
  need(len(parts)>=5,"MAPS_FORMAT")
  if len(parts)==5: path=""
  else: path=parts[5]
  if path.startswith("/") or path.startswith("["):
   need(" (deleted)" not in path,"MAPS_DELETED_FILE")
   rows.append({"dev":parts[3],"inode":int(parts[4]),"offset":parts[2],"path":path,"perms":parts[1]})
 rows.sort(key=lambda row:(row["path"],row["perms"],row["offset"],row["dev"],row["inode"]))
 return rows

def runtime_snapshot():
 flags={name:getattr(sys.flags,name) for name in FLAG_NAMES}
 return {"byteorder":sys.byteorder,"cacheTag":sys.implementation.cache_tag,"cwd":os.getcwd(),"defaultEncoding":sys.getdefaultencoding(),"environ":dict(sorted(os.environ.items())),"executable":sys.executable,"filesystemEncoding":sys.getfilesystemencoding(),"filesystemErrors":sys.getfilesystemencodeerrors(),"flags":flags,"implementation":sys.implementation.name,"version":[sys.version_info.major,sys.version_info.minor,sys.version_info.micro,sys.version_info.releaselevel,sys.version_info.serial]}

def validate_regular_entry(entry):
 exact_keys(entry,("ctimeNs","dev","gid","ino","mode","mtimeNs","path","sha256","size","uid"),"TOOLCHAIN_FILE_KEYS")
 need(absolute(entry["path"]) and sha(entry["sha256"]),"TOOLCHAIN_FILE_ID")
 for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid"): need(type(entry[key]) is int and entry[key]>=0,"TOOLCHAIN_FILE_META")
 need(stat.S_ISREG(entry["mode"]) and entry["mode"]&(stat.S_ISUID|stat.S_ISGID)==0,"TOOLCHAIN_NOT_SAFE_REGULAR")

def open_regular(entry):
 flags=os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW
 fd=os.open(entry["path"],flags)
 before=os.fstat(fd)
 need(metadata(before)=={key:entry[key] for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid")},"TOOLCHAIN_PRE_META")
 h=hashlib.sha256()
 while True:
  block=os.read(fd,1048576)
  if not block: break
  h.update(block)
 after=os.fstat(fd)
 need(metadata(after)==metadata(before),"TOOLCHAIN_UNSTABLE")
 need(h.hexdigest()==entry["sha256"],"TOOLCHAIN_SHA")
 return fd

def validate_control(entry):
 need(type(entry) is dict and entry.get("state") in ("absent","symlink"),"PATH_CONTROL_STATE")
 if entry["state"]=="absent": exact_keys(entry,("path","state"),"PATH_CONTROL_ABSENT_KEYS")
 else:
  exact_keys(entry,("ctimeNs","dev","gid","ino","mode","mtimeNs","path","size","state","target","uid"),"PATH_CONTROL_LINK_KEYS")
  need(clean_string(entry["target"]),"PATH_CONTROL_TARGET")
  for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid"): need(type(entry[key]) is int and entry[key]>=0,"PATH_CONTROL_META")
  need(stat.S_ISLNK(entry["mode"]),"PATH_CONTROL_NOT_LINK")
 need(absolute(entry["path"]),"PATH_CONTROL_PATH")

def check_control(entry):
 try: current=os.lstat(entry["path"])
 except FileNotFoundError:
  need(entry["state"]=="absent","PATH_CONTROL_MISSING")
  return
 need(entry["state"]=="symlink","PATH_CONTROL_PRESENT")
 expected={key:entry[key] for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid")}
 need(metadata(current)==expected and os.readlink(entry["path"])==entry["target"],"PATH_CONTROL_DRIFT")

def devnull_open(entry):
 exact_keys(entry,("ctimeNs","dev","gid","ino","mode","mtimeNs","path","rdev","size","uid"),"DEVNULL_KEYS")
 need(entry["path"]=="/dev/null","DEVNULL_PATH")
 for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","rdev","size","uid"): need(type(entry[key]) is int and entry[key]>=0,"DEVNULL_META")
 fd=os.open("/dev/null",os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
 current=os.fstat(fd)
 expected={key:entry[key] for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid")}
 need(stat.S_ISCHR(current.st_mode) and metadata(current)==expected and current.st_rdev==entry["rdev"],"DEVNULL_DRIFT")
 return fd

def validate_profile(profile):
 exact_keys(profile,ROOT_KEYS,"PROFILE_ROOT_KEYS")
 need(profile["schema"]=="d042-authority-profile-v4.1" and profile["decision"]=="D042" and profile["profileId"]=="D042-AUTHORITY-PROFILE-01","PROFILE_ID")
 exact_keys(profile["base"],("branch42BaseHead","branch42BaseTree","candidateHead","candidateTree","canonicalHead","canonicalPath","canonicalTree","integrationRef","sourceHead","sourcePath","sourceTree","targetPath"),"BASE_KEYS")
 for key in ("branch42BaseHead","branch42BaseTree","candidateHead","candidateTree","canonicalHead","canonicalTree","sourceHead","sourceTree"): need(commit(profile["base"][key]),"BASE_OBJECT_ID")
 for key in ("canonicalPath","sourcePath","targetPath"): need(absolute(profile["base"][key]),"BASE_PATH")
 need(clean_string(profile["base"]["integrationRef"]),"BASE_REF")
 runtime=runtime_snapshot()
 need(runtime["cwd"]=="/" and runtime["executable"]=="/usr/bin/python3.12" and runtime["environ"]==WRAPPER_ENV and runtime["implementation"]=="cpython" and runtime["version"][:2]==[3,12],"RUNTIME_FIXED")
 flags=runtime["flags"]
 need(flags["isolated"]==1 and flags["no_site"]==1 and flags["no_user_site"]==1 and flags["ignore_environment"]==1 and flags["dont_write_bytecode"]==1 and flags["safe_path"],"RUNTIME_FLAGS")
 need(profile["runtime"]==runtime,"RUNTIME_DRIFT")
 need(profile["popen"]==POPEN_PROFILE,"POPEN_PROFILE_DRIFT")
 exact_keys(profile["limits"],("operationTimeoutMs","reapTimeoutMs","resultMaxBytes","stderrMaxBytes","stdoutMaxBytes"),"LIMIT_KEYS")
 limits=profile["limits"]
 for key in limits: need(type(limits[key]) is int,"LIMIT_TYPE")
 need(limits=={"operationTimeoutMs":10000,"reapTimeoutMs":2000,"resultMaxBytes":524288,"stderrMaxBytes":65536,"stdoutMaxBytes":262144},"LIMIT_VALUE")
 order=profile["readEnvOrder"]
 env=profile["readEnv"]
 need(type(order) is list and len(order)==15 and len(set(order))==15 and type(env) is dict and set(order)==set(env),"READ_ENV_SHAPE")
 for key in order: need(clean_string(key) and re.fullmatch(r"[A-Z][A-Z0-9_]*",key) is not None and clean_string(env[key]),"READ_ENV_VALUE")
 files=profile["toolchainFiles"]
 need(type(files) is list and 0<len(files)<=256 and sum(entry.get("size",0) for entry in files)<=536870912,"TOOLCHAIN_FILES")
 for entry in files: validate_regular_entry(entry)
 paths=[entry["path"] for entry in files]
 need(paths==sorted(paths) and len(paths)==len(set(paths)),"TOOLCHAIN_FILE_ORDER")
 controls=profile["pathControls"]
 need(type(controls) is list and len(controls)<=256,"PATH_CONTROLS")
 for entry in controls: validate_control(entry)
 control_paths=[entry["path"] for entry in controls]
 need(control_paths==sorted(control_paths) and len(control_paths)==len(set(control_paths)) and not set(control_paths)&set(paths),"PATH_CONTROL_ORDER")
 exact_keys(profile["executables"],("dash","env","git","python"),"EXECUTABLE_KEYS")
 expected_logical={"dash":"/bin/dash","env":"/usr/bin/env","git":"/usr/bin/git","python":"/usr/bin/python3.12"}
 for name,record in profile["executables"].items():
  exact_keys(record,("logicalPath","resolvedPath"),"EXECUTABLE_RECORD")
  need(record["logicalPath"]==expected_logical[name] and absolute(record["resolvedPath"]) and os.path.realpath(record["logicalPath"])==record["resolvedPath"] and record["resolvedPath"] in paths,"EXECUTABLE_DRIFT")
 loader=profile["loaderControls"]
 exact_keys(loader,("ambientForbiddenAbsent","cachePath","cacheResolvedPath","cleanExecEnv","defaultDirectories","forbiddenEnvironment","preloadPath","preloadState","resolutionPolicy"),"LOADER_KEYS")
 need(loader["ambientForbiddenAbsent"] is True and loader["cachePath"]=="/etc/ld.so.cache" and absolute(loader["cacheResolvedPath"]) and os.path.realpath(loader["cachePath"])==loader["cacheResolvedPath"] and loader["cacheResolvedPath"] in paths,"LOADER_CACHE")
 need(loader["preloadPath"]=="/etc/ld.so.preload" and loader["preloadState"]=="absent" and any(entry=={"path":"/etc/ld.so.preload","state":"absent"} for entry in controls),"LOADER_PRELOAD")
 need(loader["cleanExecEnv"]==[["LC_ALL","C"],["PYTHONCOERCECLOCALE","0"]] and loader["forbiddenEnvironment"]==list(FORBIDDEN_LOADER_ENV) and not set(FORBIDDEN_LOADER_ENV)&set(env),"LOADER_ENV")
 directories=loader["defaultDirectories"]
 need(type(directories) is list and 0<len(directories)<=32 and len(directories)==len(set(directories)) and all(absolute(path) for path in directories) and loader["resolutionPolicy"]=="GLIBC-D042-EXACT-V1","LOADER_SEARCH")
 closures=profile["elfClosures"]
 exact_keys(closures,("dash","env","git","python"),"ELF_CLOSURE_SET")
 for closure_name in ("dash","env","git","python"):
  closure=closures[closure_name]
  exact_keys(closure,("algorithm","executable","executableResolved","nodes"),"ELF_CLOSURE_KEYS")
  executable=profile["executables"][closure_name]
  need(closure["algorithm"]=="ELF64-LE-PT_INTERP-DYNAMIC-V2" and closure["executable"]==executable["logicalPath"] and closure["executableResolved"]==executable["resolvedPath"],"ELF_CLOSURE_ID")
  nodes=closure["nodes"]
  need(type(nodes) is list and 0<len(nodes)<=128,"ELF_NODES")
  node_paths=[]
  for node in nodes:
   exact_keys(node,("interpreter","needed","path","rpath","runpath","soname"),"ELF_NODE_KEYS")
   need(absolute(node["path"]) and node["path"] in paths and type(node["needed"]) is list and len(node["needed"])<=128,"ELF_NODE")
   node_paths.append(node["path"])
   need((node["soname"] is None or clean_string(node["soname"])) and type(node["rpath"]) is list and len(node["rpath"])<=32 and type(node["runpath"]) is list and len(node["runpath"])<=32 and all(clean_string(value) for value in node["rpath"]+node["runpath"]),"ELF_DYNAMIC_PATHS")
   interpreter=node["interpreter"]
   if interpreter is not None:
    exact_keys(interpreter,("path","resolvedPath"),"ELF_INTERPRETER_KEYS")
    need(absolute(interpreter["path"]) and absolute(interpreter["resolvedPath"]) and os.path.realpath(interpreter["path"])==interpreter["resolvedPath"],"ELF_INTERPRETER")
   pairs=[]
   for dep in node["needed"]:
    exact_keys(dep,("name","resolvedPath"),"ELF_DEP_KEYS")
    need(clean_string(dep["name"]) and "/" not in dep["name"] and absolute(dep["resolvedPath"]),"ELF_DEP")
    pairs.append((dep["name"],dep["resolvedPath"]))
   need(len(pairs)==len(set(pairs)),"ELF_DEP_DUPLICATE")
  need(node_paths==sorted(node_paths) and len(node_paths)==len(set(node_paths)) and closure["executableResolved"] in node_paths,"ELF_NODE_ORDER")
  for node in nodes:
   if node["interpreter"] is not None: need(node["interpreter"]["resolvedPath"] in node_paths,"ELF_INTERPRETER_OPEN")
   for dep in node["needed"]: need(dep["resolvedPath"] in node_paths,"ELF_CLOSURE_OPEN")
 modules=profile["moduleBindings"]
 need(type(modules) is list and len(modules)<=256 and modules==module_snapshot(),"MODULE_BINDING_DRIFT")
 mappings=profile["nativeMappings"]
 need(type(mappings) is list and len(mappings)<=512 and mappings==maps_snapshot(),"NATIVE_MAP_DRIFT")
 coverage=set(paths)|set(control_paths)
 for binding in modules:
  exact_keys(binding,("cached","file","loader","name","origin"),"MODULE_KEYS")
  for key in ("cached","file","origin"):
   value=binding[key]
   if type(value) is str and value.startswith("/"): need(value in coverage or os.path.realpath(value) in paths,"MODULE_UNPINNED_PATH")
 for mapping in mappings:
  exact_keys(mapping,("dev","inode","offset","path","perms"),"MAP_KEYS")
  if mapping["path"].startswith("/"): need(mapping["path"] in coverage or os.path.realpath(mapping["path"]) in paths,"MAP_UNPINNED_PATH")
 scopes=profile["scopePrefixes"]
 need(type(scopes) is list and len(scopes)==3,"SCOPE_COUNT")
 scope_map={}
 expected_scope_path={"canonical":profile["base"]["canonicalPath"],"source":profile["base"]["sourcePath"],"target":profile["base"]["targetPath"]}
 for scope in scopes:
  exact_keys(scope,("name","path","prefix","prefixSha256"),"SCOPE_KEYS")
  name=scope["name"]
  need(name in expected_scope_path and name not in scope_map and scope["path"]==expected_scope_path[name] and sha(scope["prefixSha256"]),"SCOPE_ID")
  prefix=scope["prefix"]
  need(type(prefix) is list and len(prefix)==34 and all(clean_string(x) for x in prefix),"PREFIX_SHAPE")
  need(prefix[:4]==["/usr/bin/git","--no-optional-locks","-C",scope["path"]],"PREFIX_HEAD")
  for index in range(4,34,2): need(prefix[index]=="-c" and prefix[index+1]!="","PREFIX_CONFIG")
  need(digest_value(prefix)==scope["prefixSha256"],"PREFIX_SHA")
  scope_map[name]=scope
 need(set(scope_map)==set(expected_scope_path),"SCOPE_SET")
 phases=profile["phases"]
 need(type(phases) is list and [item.get("name") for item in phases]==["readiness","post"],"PHASE_ORDER")
 phase_counts={}
 for item in phases:
  exact_keys(item,("count","name"),"PHASE_KEYS")
  need(type(item["count"]) is int and item["count"]>0,"PHASE_COUNT")
  phase_counts[item["name"]]=item["count"]
 operations=profile["operations"]
 need(type(operations) is list and len(operations)<=256 and len(operations)==sum(phase_counts.values()),"OPERATION_COUNT")
 expected_order=[]
 for phase in ("readiness","post"):
  expected_order.extend((phase,ordinal) for ordinal in range(1,phase_counts[phase]+1))
 actual_order=[]
 for operation in operations:
  exact_keys(operation,("argv","expected","ordinal","phase","scope"),"OPERATION_KEYS")
  phase=operation["phase"]
  ordinal=operation["ordinal"]
  scope=operation["scope"]
  need(phase in phase_counts and type(ordinal) is int and scope in scope_map,"OPERATION_ID")
  actual_order.append((phase,ordinal))
  argv=operation["argv"]
  prefix=scope_map[scope]["prefix"]
  need(type(argv) is list and len(argv)>len(prefix) and argv[:len(prefix)]==prefix and all(clean_string(value) for value in argv),"OPERATION_ARGV")
  expected=operation["expected"]
  exact_keys(expected,("exitCode","stderrBytes","stderrSha256","stdoutBytes","stdoutClass","stdoutSha256"),"EXPECTED_KEYS")
  need(type(expected["exitCode"]) is int and 0<=expected["exitCode"]<=255 and type(expected["stdoutBytes"]) is int and 0<=expected["stdoutBytes"]<=limits["stdoutMaxBytes"] and type(expected["stderrBytes"]) is int and 0<=expected["stderrBytes"]<=limits["stderrMaxBytes"],"EXPECTED_SIZE_EXIT")
  need(expected["stdoutClass"]=="exact-bytes-sha256-v1" and sha(expected["stdoutSha256"]) and sha(expected["stderrSha256"]),"EXPECTED_EXACT")
 need(actual_order==expected_order,"OPERATION_ORDER")
 return {(item["phase"],item["ordinal"]):item for item in operations}

def parse_profile(raw_text):
 need(type(raw_text) is str,"PROFILE_ARG_TYPE")
 raw=raw_text.encode("ascii","strict")
 need(len(raw)<=4194304 and raw.endswith(b"\n") and hashlib.sha256(raw).hexdigest()==AUTHORITY_SHA256,"PROFILE_AUTHORITY")
 profile=json.loads(raw.decode("ascii"),object_pairs_hook=no_dups,parse_float=no_number,parse_constant=no_number)
 need(canonical(profile)==raw,"PROFILE_CANONICAL")
 return profile

def capture_fields(stdout,stderr,complete):
 return {"captureComplete":complete,"stderrB64":base64.b64encode(stderr).decode("ascii") if complete else None,"stderrBytes":len(stderr),"stderrSha256":hashlib.sha256(stderr).hexdigest(),"stdoutB64":base64.b64encode(stdout).decode("ascii") if complete else None,"stdoutBytes":len(stdout),"stdoutSha256":hashlib.sha256(stdout).hexdigest()}

def child_status(child):
 code=child.returncode
 return (code if type(code) is int and code>=0 else None,-code if type(code) is int and code<0 else None)

def contain(child,reap_seconds):
 try:
  if child.poll() is None: child.kill()
 except BaseException: pass
 try: child.wait(timeout=reap_seconds)
 except BaseException: return False
 return child.returncode is not None

def failure(code,state):
 returned=state["returned"]
 entered=state["entered"]
 child=state["child"]
 if returned:
  reaped=child is not None and child.returncode is not None
  launch=True
  git=True
 elif entered:
  reaped="UNKNOWN"
  launch="UNKNOWN"
  git="UNKNOWN"
 else:
  reaped="NOT_APPLICABLE"
  launch=False
  git=False
 result={"authoritySha256":AUTHORITY_SHA256,"code":code,"commandLaunch":launch,"gitExec":git,"leaseState":"CLOSED_BLOCKED" if reaped is True or reaped=="NOT_APPLICABLE" else "UNKNOWN_OPEN","reaped":reaped,"schema":"d042-wrapper-result-v4.1","stage":state["stage"],"status":"BLOCKED"}
 if returned and child is not None and child.returncode is not None:
  exit_code,signal_number=child_status(child)
  result.update({"childPid":child.pid,"exitCode":exit_code,"signal":signal_number})
 if state["captured"] is not None:
  result.update(capture_fields(state["captured"][0],state["captured"][1],state["captureComplete"]))
 return result

def execute():
 state={"captureComplete":False,"captured":None,"child":None,"entered":False,"returned":False,"stage":"validation"}
 held=[]
 devfd=None
 limits={"reapTimeoutMs":1000,"resultMaxBytes":4194304}
 try:
  need(len(sys.argv)==4,"RUNTIME_ARG_COUNT")
  profile=parse_profile(sys.argv[1])
  operations=validate_profile(profile)
  limits=profile["limits"]
  phase=sys.argv[2]
  ordinal_text=sys.argv[3]
  need(phase in ("readiness","post") and re.fullmatch(r"[1-9][0-9]*",ordinal_text) is not None,"RUNTIME_SELECTOR")
  key=(phase,int(ordinal_text))
  need(key in operations,"RUNTIME_ORDINAL")
  operation=operations[key]
  state["stage"]="toolchain-precheck"
  need(hasattr(os,"O_NOFOLLOW"),"OPEN_FLAGS")
  for control in profile["pathControls"]: check_control(control)
  for entry in profile["toolchainFiles"]: held.append((entry,open_regular(entry)))
  devfd=devnull_open(profile["devNull"])
  argv=list(operation["argv"])
  env={name:profile["readEnv"][name] for name in profile["readEnvOrder"]}
  state["stage"]="popen-constructor"
  state["entered"]=True
  child=subprocess.Popen(args=argv,bufsize=-1,executable=None,stdin=devfd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=None,close_fds=True,shell=False,cwd="/",env=env,universal_newlines=None,startupinfo=None,creationflags=0,restore_signals=True,start_new_session=False,pass_fds=(),user=None,group=None,extra_groups=None,encoding=None,errors=None,text=False,umask=-1,pipesize=-1,process_group=None)
  state["child"]=child
  state["returned"]=True
  state["stage"]="communicate"
  timed_out=False
  try:
   stdout,stderr=child.communicate(timeout=limits["operationTimeoutMs"]/1000)
  except subprocess.TimeoutExpired:
   timed_out=True
   child.kill()
   stdout,stderr=child.communicate(timeout=limits["reapTimeoutMs"]/1000)
  state["captured"]=(stdout,stderr)
  state["captureComplete"]=True
  need(child.returncode is not None,"CHILD_NOT_REAPED")
  state["stage"]="toolchain-postcheck"
  for entry,fd in held:
   need(metadata(os.fstat(fd))=={key:entry[key] for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid")},"HELD_FILE_DRIFT")
   probe=open_regular(entry)
   os.close(probe)
  for control in profile["pathControls"]: check_control(control)
  current_dev=os.fstat(devfd)
  expected_dev={key:profile["devNull"][key] for key in ("ctimeNs","dev","gid","ino","mode","mtimeNs","size","uid")}
  need(stat.S_ISCHR(current_dev.st_mode) and metadata(current_dev)==expected_dev and current_dev.st_rdev==profile["devNull"]["rdev"],"DEVNULL_HELD_DRIFT")
  probe=devnull_open(profile["devNull"])
  os.close(probe)
  complete=len(stdout)<=limits["stdoutMaxBytes"] and len(stderr)<=limits["stderrMaxBytes"]
  exit_code,signal_number=child_status(child)
  expected=operation["expected"]
  predicate=complete and not timed_out and signal_number is None and exit_code==expected["exitCode"] and len(stdout)==expected["stdoutBytes"] and hashlib.sha256(stdout).hexdigest()==expected["stdoutSha256"] and len(stderr)==expected["stderrBytes"] and hashlib.sha256(stderr).hexdigest()==expected["stderrSha256"]
  result_code="TIMEOUT_REAPED" if timed_out else ("CAPTURE_LIMIT_EXCEEDED" if not complete else ("EXPECTED_MATCH" if predicate else "EXPECTED_MISMATCH"))
  result={"authoritySha256":AUTHORITY_SHA256,"argv":argv,"argvSha256":digest_value(argv),"childPid":child.pid,"code":result_code,"commandLaunch":True,"envOrdered":[[name,env[name]] for name in profile["readEnvOrder"]],"envSha256":digest_value([[name,env[name]] for name in profile["readEnvOrder"]]),"exitCode":exit_code,"expected":expected,"gitExec":True,"leaseState":"REAPED_AWAITING_VERIFIER" if predicate else "CLOSED_BLOCKED","operation":{"ordinal":operation["ordinal"],"phase":operation["phase"],"scope":operation["scope"]},"profileId":profile["profileId"],"reaped":True,"schema":"d042-wrapper-result-v4.1","signal":signal_number,"stage":"complete","status":"MATCHED_AWAITING_VERIFIER" if predicate else "BLOCKED","timedOut":timed_out}
  result.update(capture_fields(stdout,stderr,complete))
  return result,limits["resultMaxBytes"]
 except Reject as error:
  if state["returned"] and state["child"] is not None and state["child"].returncode is None:
   if contain(state["child"],limits["reapTimeoutMs"]/1000): state["stage"]+="-contained"
  return failure(error.code,state),limits["resultMaxBytes"]
 except BaseException:
  if state["returned"] and state["child"] is not None and state["child"].returncode is None:
   if contain(state["child"],limits["reapTimeoutMs"]/1000): state["stage"]+="-contained"
  return failure("UNEXPECTED_EXCEPTION",state),limits["resultMaxBytes"]
 finally:
  if devfd is not None:
   try: os.close(devfd)
   except BaseException: pass
  for _,fd in held:
   try: os.close(fd)
   except BaseException: pass

def write_all(blob):
 while blob:
  count=os.write(1,blob)
  if count<=0: os._exit(121)
  blob=blob[count:]

try:
 result,result_limit=execute()
 blob=canonical(result)
 if len(blob)>result_limit:
  state={"captured":None,"captureComplete":False,"child":None,"entered":True,"returned":True,"stage":"result-limit"}
  blob=canonical({"authoritySha256":AUTHORITY_SHA256,"code":"RESULT_LIMIT_EXCEEDED","commandLaunch":"UNKNOWN","gitExec":"UNKNOWN","leaseState":"UNKNOWN_OPEN","reaped":"UNKNOWN","schema":"d042-wrapper-result-v4.1","stage":"result-limit","status":"BLOCKED"})
 write_all(blob)
except BaseException:
 os._exit(122)
os._exit(0)
```

### 5.3 Bootstrap template B

Normativní B template je ASCII s terminal LF, přesně 1 374 bytes, 29 LF a
SHA-256 `b46cda4ab7eaa879afdd2bad7330bfa20e575021835ba3f7f55f06297399394c`.
Jediný 21-byte marker `@@DISPATCHER_SHA256@@` se vyskytuje jednou:

```python
import hashlib,os,sys
DISPATCHER_SHA256="@@DISPATCHER_SHA256@@"
EXPECTED_ENV={"LC_ALL":"C","PYTHONCOERCECLOCALE":"0"}
VALIDATION=b'{"code":"BOOTSTRAP_VALIDATION","commandLaunch":false,"gitExec":false,"leaseState":"CLOSED_NO_CHILD","reaped":"NOT_APPLICABLE","schema":"d042-wrapper-result-v4.1","stage":"bootstrap","status":"BLOCKED"}\n'
EXECVE=b'{"code":"BOOTSTRAP_EXECVE_EXCEPTION","commandLaunch":"UNKNOWN","gitExec":"UNKNOWN","leaseState":"UNKNOWN_OPEN","reaped":"UNKNOWN","schema":"d042-wrapper-result-v4.1","stage":"bootstrap","status":"BLOCKED"}\n'
def write_all(blob):
 while blob:
  count=os.write(1,blob)
  if count<=0: os._exit(123)
  blob=blob[count:]

def stop(blob):
 write_all(blob)
 os._exit(0)

flags=sys.flags
if len(sys.argv)!=5 or sys.executable!="/usr/bin/python3.12" or os.getcwd()!="/" or dict(os.environ)!=EXPECTED_ENV or flags.isolated!=1 or flags.no_site!=1 or flags.no_user_site!=1 or flags.ignore_environment!=1 or flags.dont_write_bytecode!=1 or not flags.safe_path:
 stop(VALIDATION)
try:
 dispatcher=sys.argv[1]
 raw=dispatcher.encode("ascii","strict")
except BaseException:
 stop(VALIDATION)
if hashlib.sha256(raw).hexdigest()!=DISPATCHER_SHA256:
 stop(VALIDATION)
try:
 os.execve("/usr/bin/python3.12",["/usr/bin/python3.12","-I","-S","-B","-c",dispatcher,sys.argv[2],sys.argv[3],sys.argv[4]],EXPECTED_ENV)
except BaseException:
 stop(EXECVE)
```

### 5.4 Outer prelude, serializer a argv14

Outer prelude je JSON-dekódovaná hodnota následujícího stringu; dekódované
ASCII má přesně 457 bytes, jeden LF, žádný terminal LF, končí jedinou ASCII
mezerou a má SHA-256
`ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7`:

```json
"case \"${GLIBC_TUNABLES+x}${LD_ASSUME_KERNEL+x}${LD_AUDIT+x}${LD_BIND_NOT+x}${LD_BIND_NOW+x}${LD_DEBUG+x}${LD_DEBUG_OUTPUT+x}${LD_DYNAMIC_WEAK+x}${LD_HWCAP_MASK+x}${LD_LIBRARY_PATH+x}${LD_ORIGIN_PATH+x}${LD_POINTER_GUARD+x}${LD_PREFER_MAP_32BIT_EXEC+x}${LD_PRELOAD+x}${LD_PROFILE+x}${LD_PROFILE_OUTPUT+x}${LD_SHOW_AUXV+x}${LD_TRACE_LOADED_OBJECTS+x}${LD_TRACE_PRELINKING+x}${LD_USE_LOAD_BIAS+x}${LD_VERBOSE+x}${LD_WARN+x}\" in '') ;; *) exit 125 ;; esac\nexec "
```

Forbidden-name vector je exact 22-name compact JSON+LF, 372 bytes/SHA
`3d4f59f8526d25692e8e70d47363cc1cef41bbd31aeecc6e09c0dbbcec0f1e3e`.
Outer argv14 je ordered `/usr/bin/env`, `-i`, `LC_ALL=C`,
`PYTHONCOERCECLOCALE=0`, `/usr/bin/python3.12`, `-I`, `-S`, `-B`, `-c`,
materialized B, materialized D, materialized P+LF, phase a ordinal. Jeho first
nine-element prefix compact JSON+LF je 99 bytes/SHA
`50cc4d78e0fbeda9a9986be325154cce87132eecb458b9946dee764c43a3bf34`.
Marker argv14 compact JSON+LF je 204 bytes/SHA
`82ed15e86a1c1e0c04ae2fe0babbc75e3eca1b9ab6963f5b0a75d153b2fa46a4`.
Jeho exact literal pin fixture je:

```json
["/usr/bin/env","-i","LC_ALL=C","PYTHONCOERCECLOCALE=0","/usr/bin/python3.12","-I","-S","-B","-c","@@BOOTSTRAP_SOURCE@@","@@DISPATCHER_SOURCE@@","@@AUTHORITY_PROFILE_WITH_LF@@","@@PHASE@@","@@ORDINAL@@"]
```

Těchto pět marker strings je pouze byte-reproducible argv pin fixture. Live
argv se post-E_B sestaví z materialized B, D, P+LF, phase a ordinal values;
fixture sama není P/D/B placeholder source ani runtime tail.

Serializer quote-ne každý argv element POSIX single quotes, uvnitř nahrazuje
každý apostrof exact pěti-byte sekvencí ASCII `39,34,39,34,39` a spojuje jedinou mezerou;
nesmí použít operator, redirect, glob ani eval. Raw serialized marker command
(outer prelude + quote-all argv, bez terminal LF) je 658 bytes/SHA
`295e9c40c9ee6b4e8c3c593d1dee19db90c0f410b64206a260db24c41e306fe8`.
Fixture `a'b'c` se serializuje na raw 15 bytes bez terminal LF/SHA
`07b183fe9bb7cd881b3d421c2ff51b20edf48aa71f705bb45c85a0fa80cc4311`.
Exact tool envelope je shell `/bin/dash`, `login=false`, workdir `/`,
`tty=false`, `yield_time_ms=30000`, `max_output_tokens=200000` a žádný
`sandbox_permissions` field.

### 5.5 Compile-only syntax evidence

Checker je ASCII s terminal LF, 524 bytes, 15 LF a SHA-256
`7669c04df6531e25d8e01cc7498c63750182b16670a183b78b827df30dc32976`:

```python
import sys
try:
 if len(sys.argv)!=3: raise ValueError("ARGC")
 out=[]
 for label,source in zip(("D","B"),sys.argv[1:]):
  raw=source.encode("ascii","strict")
  compile(source,"<D042_"+label+"_V41_AST>","exec",1024,True)
  compile(source,"<D042_"+label+"_V41_CODE>","exec",0,True)
  out.append(label+":"+str(len(raw))+":"+str(source.count("\n")))
except BaseException as exc:
 sys.stdout.write("FAIL:"+type(exc).__name__+"\n")
 sys.stdout.flush()
 raise SystemExit(1)
sys.stdout.write(";".join(out)+"\n")
sys.stdout.flush()
```

Exact syntax argv12 je env-i + CPython isolated/no-site/no-bytecode + checker +
D template + B template. Jeho compact JSON+LF je 29 629 bytes/SHA
`66643956f062d3cf3aa79261cb0bda115271907d25e97928971fb4261b1cbf61`.
Outer-prelude + quote-all raw command bez terminal LF je 27 869 bytes,
441 LF/SHA
`bf558c9580e5bdd4f1017f9ccccd611bf881fcb444f5109935df176b076ee2d9`.
Historický compile-only výsledek je exact exit `0`, no session, combined output
`D:25393:396;B:1374:29` + LF; D ani B source se nespustil.

### 5.6 Materialization chain a superseded návrhy

Po E_B se každý P marker textově nahradí canonical sorted `ensure_ascii`
JSON fragmentem bez LF. Fragment nesmí obsahovat žádný marker byte, parser je
duplicate-free/integer-only a final P+LF se musí canonical reserializovat
byte-identicky. Jeho SHA je H_P. D marker se nahradí 64 lowercase hex H_P:
výsledek má 25 437 bytes a SHA H_D. B marker se nahradí H_D: výsledek má 1 417
bytes a SHA H_B. Teprve potom vznikají direct/outer argv a command piny.
Závislost je striktně acyklická P→D→B→outer; final handoff SHA je externí a
nikdy se nevkládá zpět do některého předka.

Všechny V2/V3 a všechny předfinální V4 varianty jsou
`SUPERSEDED / NONAUTH / NON_EVIDENCE`: P 937, D 21 697 končící hash prefixem
`a4034`, B 1 310 končící `53e8`, intermediate D 21 671 končící `bb2a`, D
25 371 končící `1b4d`, staré prefix5/argv10/command, env-only nebo 21-variable
prelude, P 1 024 s `outerNativeClosures` a profily dovolující free
`stdoutClass` nebo `exitCodes`. Autoritativní P/D/B/outer read-constructor bytes
a piny zůstávají V4.1; autoritativní root-write composition je V4.2. Starší
root-write serializer/command variants jsou
`SUPERSEDED / NONAUTH / NON_EVIDENCE`.

## 6. Post-E_B materializace, handoff a dva live ELF audity

Konkrétní fragment bytes/SHA, E_B/tree, expected raw outputs, P/H_P, D/H_D,
B/H_B, operation argv/command piny a audit rows vzniknou výhradně
`MATERIALIZE_POST_E_B`. Subject žádnou budoucí hodnotu nefabrikuje.

Review B vytvoří 16 fragmentů v §5.1 pořadí. Každý je canonical ASCII JSON bez
LF, marker-free a má task-channel pin. D validator je úplnou normativní schema
autoritou: base váže B42, candidate, canonical, B37 a paths; runtime váže
CPython 3.12 isolated state; Popen je exact; LIMITS jsou exact; READ env/order,
scope prefixes, phases a contiguous operations jsou closed; toolchain files,
path controls, `/dev/null`, four ELF closures, module bindings a native maps
jsou úplně pokryté.

Canonical compact sorted duplicate-free integer-only handoff+LF má schema
`d042-materialization-handoff-v4.1` a exact root keys:

```text
authorityProfile bootstrap directOperations dispatcher elfAudits
outerOperations placeholderAudit rootTrust rootWriteChain schema
syntaxAudit toolchainAudit
```

- `authorityProfile`: exact keys `bytes,fragmentPins,sha256,templateBytes,
  templateSha256`; `fragmentPins` má 16 rows v marker order, každý exact
  `bytes,marker,name,sha256`, bytes/hash nad fragment JSON bez LF.
- `dispatcher` a `bootstrap`: exact keys `materializedBytes,
  materializedSha256,templateBytes,templateSha256`.
- každý `directOperations` row: `argv,argvBytes,argvSha256,envOrdered,
  envSha256,expected,ordinal,phase,scope`.
- každý `outerOperations` row: `argv,argvBytes,argvSha256,cmd,cmdBytes,
  cmdSha256,envelope,ordinal,phase`; envelope je exact
  `login=false,max_output_tokens=200000,sandbox_permissions=OMITTED,
  shell=/bin/dash,tty=false,workdir=/,yield_time_ms=30000` a omitted field se
  skutečně neposílá.
- `placeholderAudit`: `bootstrapAfter,bootstrapBefore,dispatcherAfter,
  dispatcherBefore,profileAfterTotal,profileBefore`; 16 before rows mají
  `count,marker`, všechny before counts `1`, všechny after counts `0`.
- `rootWriteChain`: exact keys `candidate,chain,create,createSerializer,
  materializationAudits,promotion,promotionSerializer`.
  `candidate` má exact keys `baseHead,canonicalRef,head,tree`.
  `baseHead` je B42, `canonicalRef` je exact integration ref a concrete
  lowercase 40-hex `head,tree` vážou E_B; `tree` musí být skutečný Git tree
  objekt `head`.
- `promotionSerializer` je canonical compact sorted ASCII JSON+LF exact
  939B/SHA `0ee25abc622228f9cb2e75d86ac39b1436dfde49db0651222a20297cec98b402`:
  `{"algorithm":"PRELUDE457_PLUS_Q_ALL_SINGLE_QUOTE_V1","execBuiltin":true,"forbiddenVarCount":22,"join":"ASCII_SPACE","prefix":"case \"${GLIBC_TUNABLES+x}${LD_ASSUME_KERNEL+x}${LD_AUDIT+x}${LD_BIND_NOT+x}${LD_BIND_NOW+x}${LD_DEBUG+x}${LD_DEBUG_OUTPUT+x}${LD_DYNAMIC_WEAK+x}${LD_HWCAP_MASK+x}${LD_LIBRARY_PATH+x}${LD_ORIGIN_PATH+x}${LD_POINTER_GUARD+x}${LD_PREFER_MAP_32BIT_EXEC+x}${LD_PRELOAD+x}${LD_PROFILE+x}${LD_PROFILE_OUTPUT+x}${LD_SHOW_AUXV+x}${LD_TRACE_LOADED_OBJECTS+x}${LD_TRACE_PRELINKING+x}${LD_USE_LOAD_BIAS+x}${LD_VERBOSE+x}${LD_WARN+x}\" in '') ;; *) exit 125 ;; esac\nexec ","prefixBytes":457,"prefixSha256":"ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7","preflightExitCode":125,"preflightPlacement":"BEFORE_EXTERNAL_ENV","quoteReplacementBytes":[39,34,39,34,39],"suffix":"","templateCmdBytes":1407,"templateCmdSha256":"8d09cb5c331284101c458bad0ce652a56aab500975b6df9a1d9b3d2649a4de14","terminalLf":false}`.
  Funkce q(s) přidá ASCII apostrof před i za string a nahradí každý apostrof
  exact bytes `'"'"'`. Template `cmd` je PRELUDE457 + q všech argv53
  elementů spojených jednou ASCII mezerou: 1 407B/1LF/no-terminal-LF/SHA
  `8d09cb5c331284101c458bad0ce652a56aab500975b6df9a1d9b3d2649a4de14`.
  Neobsahuje jiný operator ani redirect. Materialized cmd je 1 422B a jeho
  exact bytes/SHA vzniknou pouze post-E_B.
- `createSerializer` je canonical compact sorted ASCII JSON+LF exact
  704B/SHA `b212cae516543ef3fb5dce4d8b4e34e14d4cd1c204f94b557104584c5ac50213`:
  `{"algorithm":"FIXED_DASH_SUBSHELL_WITH_PRELUDE457_V2","argvProjection":"AFTER_INDENTED_PRELUDE_REMOVE_BSLASH_LF_THEN_ASCII_SPACE_SPLIT_V1","cmdBytes":1734,"cmdSha256":"9009095a0ac6264fc5662386d5490d1732a45a162623a531a1092372b5b59fa1","execBuiltin":true,"forbiddenVarCount":22,"indentedPreludeBytes":461,"indentedPreludeSha256":"f1b64923300e4657db18a9faa0bf61cd75968f962f7dfee0a7867ef2a4e1f056","outerSubshell":true,"preflightExitCode":125,"preflightPlacement":"AFTER_UMASK_BEFORE_EXEC","preludeTransform":"PREFIX_EACH_LOGICAL_LINE_TWO_ASCII_SPACES_V1","sourcePreludeBytes":457,"sourcePreludeSha256":"ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7","terminalLf":true,"umaskOctal":"077"}`.
  CREATE `cmd` je byte-for-byte 1 734B/33LF/terminal-LF block v §4, SHA
  `9009095a0ac6264fc5662386d5490d1732a45a162623a531a1092372b5b59fa1`.
  Header je `(`+LF+two spaces+`umask 077`+LF+INDENTED_PRELUDE, jenž
  končí exact two spaces+`exec `; suffix je LF+`)`+LF. Payload mezi nimi
  po odstranění všech backslash+LF a splitu na runs ASCII spaces bez empty
  elementu musí být byte-equal fixed argv59. Old 1 280B/SHA
  `9ee79306bb0902b416b249fb2507e306d4d18a0d3c0642144ebfd8cd0a88c077`
  je `SUPERSEDED_CONSTRUCTION_INPUT / NON_EXECUTABLE`; derived 1 184B/SHA
  `b82e599d281b9eaa2063086a76fe4208eaa85cdaffed77d08265426810d20a3a`
  je `NON_AUTHORITY / PROHIBITED`.
- `chain` má exact keys `authorizedChildCount,executorBytes,executorSha256,
  executorSource,functionsExecIsolateCount,noInterveningChild,order,
  predicateIds,rootRereadAllowed,validatedBeforeLeaseTransfer`.
  Fixed values jsou `authorizedChildCount=2`, `functionsExecIsolateCount=1`,
  `noInterveningChild=true`, ordered `order=["promotion","create"]`,
  `rootRereadAllowed=false` a `validatedBeforeLeaseTransfer=true`.
  `executorSource` je full exact ASCII `functions.exec` source skutečně
  spuštěný; `executorBytes` je jeho nonnegative byte count a
  `executorSha256` lowercase 64-hex. Tyto tři hodnoty jsou záměrně
  `ABSENT/UNMATERIALIZED` v subjectu a vzniknou jen `MATERIALIZE_POST_E_B`.
  Final handoff je musí mít concrete, marker-free a static call graph musí být
  validovaný před tokenem.
- Exact ordered `predicateIds` v `chain` i obou audit rows je:

  ```json
  ["RW01_EB_TREE","RW02_PROMOTION_TEMPLATE","RW03_PROMOTION_BINDINGS","RW04_PROMOTION_PREFIX","RW05_PROMOTION_ENV","RW06_PROMOTION_ARGV","RW07_PROMOTION_CMD","RW08_CREATE_ARGV59","RW09_CREATE_PREFIX","RW10_CREATE_ENV14","RW11_CREATE_REASON","RW12_CREATE_CMD","RW13_ENVELOPES","RW14_EXECUTOR_CALLGRAPH","RW15_NO_REREAD"]
  ```

- `promotion` má exact keys `argv,argvBytes,argvSha256,bindings,cmd,cmdBytes,
  cmdSha256,envelope,envBytes,envOrdered,envSha256,ordinal,prefix,prefixBytes,
  prefixSha256,template,templateBytes,templateSha256`; ordinal je integer `1`.
  `template` je §4 vector53 953/SHA `713ae5…`; `prefix=template[0:52]` je exact
  vector52 925/SHA `370477…`; `envOrdered=template[2:16]` je exact 14-string
  vector 339/SHA `bf983f…`. `bindings` jsou dva ordered rows. První je exact
  `{"index":18,"name":"canonicalPath","value":"/home/belphareon/worktrees/is-m1-consolidated"}`;
  druhý má exact keys `index,name,templateValue,value`, fixed index `52`, name
  `candidate.head`, templateValue `<full-E_B_H0V5SRC042-sha>` a concrete value
  byte-equal `candidate.head`. Jde o jedinou template replacement. Materialized
  `argv` má 53 elements, `argv[18]` je canonical path, `argv[52]` je concrete
  candidate head a jeho canonical compact JSON+LF bytes/hash vzniknou post-E_B.
  `cmd`/bytes/hash jsou post-E_B PRELUDE457+Q_ALL serialization tohoto exact
  argv; cmd má přesně 1 422B/1LF/no-terminal-LF a future SHA.
- `create` má exact keys `argv,argvBytes,argvSha256,cmd,cmdBytes,cmdSha256,
  envelope,envBytes,envOrdered,envSha256,ordinal,prefix,prefixBytes,
  prefixSha256,reasonArgIndex,reasonBytes,reasonSha256,reasonWithLf`; ordinal je
  integer `2`. `argv` je fixed §4 vector59 1 171/SHA `823b80…`;
  `prefix=argv[0:56]` je exact vector56 974/SHA `c539b8…` a
  `envOrdered=argv[2:16]` je stejný 14-string vector 339/SHA `bf983f…`.
  `argv[18]` je canonical path, `argv[55]` je `--reason`, zero-based
  `reasonArgIndex=56`, `argv[57]` je target path a `argv[58]` je B37 source
  head. `reasonWithLf` je literal reason string plus právě jeden LF;
  `reasonBytes=80` a `reasonSha256` je
  `ccde801e53e12750a1b5f247d2536e2a9f5fb68a5f7e82c14493195982a3d437`.
  CREATE `cmd`/bytes/hash jsou exact 1 734B/33LF
  `createSerializer` block, nikoli Q_ALL.
- Obě write rows mají exact envelope
  `{"login":false,"max_output_tokens":10000,"sandbox_permissions":"OMITTED","shell":"/bin/dash","tty":false,"workdir":"/","yield_time_ms":30000}`;
  `sandbox_permissions` je jen literal evidence value a skutečný tool field se
  neposílá.
- `materializationAudits` jsou právě dva ordered rows pro
  `/root/decision042_review_a` a `/root/decision042_adversary`, každý exact
  keys `auditor,narrative,narrativeBytes,narrativeSha256,predicateIds,verdict`.
  `narrative` je retained exact UTF-8 preimage s observed values/counts/SHA pro
  všech 15 predicates, `narrativeBytes`/`narrativeSha256` vážou přesné UTF-8
  bytes a verdict je `PASS`. Narratives a jejich piny jsou future
  `MATERIALIZE_POST_E_B`; subject je nepředvyplňuje. Pre-populated value,
  placeholder, missing field, single reviewer, disagreement nebo non-PASS
  znamená no token/no transfer. Oba auditoři validují před fence a tokenem.
- Predicates mají exact význam: `RW01` ověří candidate head/tree/base/ref a
  `tree==tree(head)`; `RW02` template53; `RW03` oba bindings a jedinou index52
  replacement; `RW04` promotion prefix52; `RW05` promotion env14; `RW06`
  materialized argv53; `RW07` exact promotion serializer, PRELUDE457, template
  a materialized cmd. U `RW07` znamená set-even-empty reject kteréhokoli z 22
  jmen známý launch a reap promotion shell childa s exit `125`, ale nulový
  launch/count external promotion Git; CREATE i VERIFY zůstávají `UNISSUED` a
  větev je terminal `CLOSED_BLOCKED/NO_HANDOFF` bez retry nebo transferu.
  `RW08` ověří fixed CREATE argv59; `RW09` CREATE prefix56; `RW10` CREATE env14;
  `RW11` reason index a reason+LF; `RW12` exact CREATE serializer a 1 734B
  block/preflight/projection/umask. U `RW12` už je CREATE issued: stejný
  known-reaped exit `125` spotřebuje CREATE token, prokazuje nulový launch/count
  CREATE Git, ponechá pravdivě zaznamenanou předchozí promotion a VERIFY zůstane
  `UNISSUED`; větev je terminal `CLOSED_BLOCKED/NO_HANDOFF` bez retry. Každý
  neprokázaný outcome nebo reap kteréhokoli shell childa je
  `UNKNOWN_OPEN/NO_HANDOFF`. `RW13` navíc vyžaduje u obou exact serializerů
  jejich exact builtin preflight před external `/usr/bin/env` a byte-equal cmd
  i envelope v příslušném callsite. `RW14` dovolí CREATE callsite jen po
  complete promotion exit `0`, no signal, no session a no truncation; oba
  callsites dostanou pouze svůj exact cmd/envelope a mezi nimi není
  tool/process/helper/read. `RW15` zakáže Git/FS reread a dovolí jen fenced
  preimages. `authorizedChildCount=2` je pre-exec authority; promotion failure
  znamená observed ledger count `1` a CREATE `UNISSUED`.
- `syntaxAudit` je exact fixed PASS podle úplné JSON hodnoty níže: váže argv,
  checker, command, exact combined output, exit 0, no source execution,
  session absent a template LF D396/B29.
- `toolchainAudit`: exact keys `evidence,evidenceBytes,evidenceSha256`.
  `evidence` je exact typed object uvedený níže, `evidenceBytes` je integer
  `266` a `evidenceSha256` je lowercase hex SHA-256
  `0505e283dc0f81d12084d5186a92b82eab56636b134afff189f3978d0e1b58e7`.
  Record smí vzniknout pouze po skutečném PASS všech sedmi boolean checks;
  false, missing, non-boolean, extra key nebo self-assertion je non-PASS.
- `rootTrust` je exact ruling-A record: atime `POSSIBLE_UNKNOWN`, detects jen
  accidental ambient loader and stable-path drift, runner/dash/fenced FS jsou
  trusted roots a malicious-preload i swap-revert resistance jsou
  `NOT_PROVEN_OUT_OF_SCOPE`.

Exact fixed `syntaxAudit` hodnota je:

```json
{"argvBytes":29629,"argvSha256":"66643956f062d3cf3aa79261cb0bda115271907d25e97928971fb4261b1cbf61","checkerBytes":524,"checkerSha256":"7669c04df6531e25d8e01cc7498c63750182b16670a183b78b827df30dc32976","cmdBytes":27869,"cmdSha256":"bf558c9580e5bdd4f1017f9ccccd611bf881fcb444f5109935df176b076ee2d9","combinedOutput":"D:25393:396;B:1374:29\n","exitCode":0,"noSourceExecution":true,"sessionPresent":false,"status":"PASS","templateLineFeeds":{"bootstrap":29,"dispatcher":396}}
```

Exact `rootTrust` hodnota je:

```json
{"atimeEffect":"POSSIBLE_UNKNOWN","detects":"ACCIDENTAL_AMBIENT_LOADER_AND_STABLE_PATH_DRIFT_ONLY","fencedFilesystem":"TRUSTED_ROOT","initialDash":"TRUSTED_ROOT","maliciousPreloadResistance":"NOT_PROVEN_OUT_OF_SCOPE","ruling":"A","runner":"TRUSTED_ROOT","swapRevertResistance":"NOT_PROVEN_OUT_OF_SCOPE"}
```

Exact `toolchainAudit.evidence` canonical JSON+LF preimage je 266 bytes/SHA
`0505e283dc0f81d12084d5186a92b82eab56636b134afff189f3978d0e1b58e7`:

```json
{"atimeDisclosure":"POSSIBLE_UNKNOWN","checks":{"ambientLoaderFixturePass":true,"devNullReopenPass":true,"elfAuditPairPass":true,"moduleCoveragePass":true,"nativeMapCoveragePass":true,"sameFdPass":true,"symlinkCoveragePass":true},"schema":"d042-toolchain-audit-v1"}
```

Před mintem readiness tokenu Review A a adversary nezávisle rekonstruují
P/D/B/outer bytes a každý provede právě jeden bounded read-only same-FD live
ELF audit pouze exact P paths, bez Git/subprocess/write. Ordered audit rows jsou
Review A a potom adversary, každý exact
`auditor,closureSha256,fileVectorSha256,normalizedClosures,outcome,pathCount,
paths` a outcome `PASS`. Oba ověří dash/env/git/python closures, loader cache,
preload absence, celé symlink chains, setid absence, before/after fstat a file
hashy. Jakýkoli rozdíl je non-PASS; atime disclosure zůstává
`POSSIBLE_UNKNOWN`. Two ELF PASS dovolí typed `toolchainAudit` PASS; oba exact
`rootWriteChain.materializationAudits` PASS jsou samostatná povinná podmínka.
Teprve po two ELF PASS + two root-write materialization PASS se oba auditoři
fence-nou a může vzniknout token.

## 7. One-shot dispatcher, ledger a readiness state model

Každá phase (`readiness`, `post`) smí mít právě jeden `functions.exec` isolate.
Před prvním nested childem isolate byte-validuje celý handoff, P→D→B chain,
placeholder counts, syntax evidence, phase, contiguous ordinals a exact outer
rows. Potom připustí jen velmi další exact ordinal. Každý scoped/raw/helper Git
child musí mít 1:1 contiguous ledger row; bypass, repeat, skip, reorder, unknown
scope nebo runtime tail construction je `BLOCKED`.

Každý nested `exec_command` dostane pouze exact outer `cmd` a envelope. Session,
truncation, missing raw output, nonzero outer exit nebo noncanonical wrapper
result jsou terminal. Wrapper result zvlášť nese child PID, exact argv/env,
stdout/stderr bytes+SHA+B64, exit/signal, timeout, reap, stage a lease state.
Matched expected bytes jsou jen `MATCHED_AWAITING_VERIFIER`, nikdy PASS.
Dispatcher aggregate a orchestration ledger musí mít shodný count/order/hash i
raw result pro každý ordinal. Mixed, partial nebo chybějící evidence je
`BLOCKED`; launch/outcome, který nelze prokázat, zůstává `UNKNOWN`.

Readiness má právě jeden attempt po post-E_B handoffu, dvou ELF PASS a dvou
root-write materialization audit PASS:

| Boundary | readiness token | attempt / launch / outcome | CREATE / VERIFY | lease / next action |
|---|---|---|---|---|
| preissue | `UNMINTED` | `0` / `false` / absent | `UNMINTED` / `UNMINTED` | inactive |
| issued, před first outer child | `ISSUED_ACTIVE` | `0` / `false` / absent | `UNMINTED` / `UNMINTED` | generation 1; next child fixed |
| reject před vstupem do Popen, proven no child | `CONSUMED` | `0` / `false` / `BLOCKED/NO_RUN` | oba `CANCELLED_UNISSUED` | `CLOSED_BLOCKED/NO_HANDOFF`; terminal |
| Popen-enter exception nebo launch/reap unproven | `CONSUMED` | `UNKNOWN` / `UNKNOWN` / `UNKNOWN` | oba `CANCELLED_UNISSUED` | `UNKNOWN_OPEN/NO_HANDOFF`; terminal |
| missing/mixed/truncated/noncanonical/session/ledger drift | `CONSUMED` | `UNKNOWN` / `UNKNOWN` / `BLOCKED/INCOMPLETE` | oba `CANCELLED_UNISSUED` | `UNKNOWN_OPEN/NO_HANDOFF`; terminal |
| Git launch known, outcome nebo reap unknown | `CONSUMED` | `1` / `true` / `UNKNOWN` | oba `CANCELLED_UNISSUED` | `UNKNOWN_OPEN/NO_HANDOFF`; terminal |
| complete mismatch/drift, všechny possible children proven no-child/reaped | `CONSUMED` | exact observed / `BLOCKED` nebo `NOT_READY` | oba `CANCELLED_UNISSUED` | `CLOSED_BLOCKED/NO_HANDOFF`; terminal |
| complete clean closure | `CONSUMED-PASS` | `1` / `true` / `PRELEASE_READY/COMPLETE` | oba `UNMINTED` | same lease transferred to root |

Každý non-PASS spotřebuje readiness token, zruší nevydané CREATE/VERIFY,
ale lease se smí označit `CLOSED_BLOCKED` pouze před Popen s proven no child
nebo když complete evidence účtuje každý possible child jako no-child/reaped.
Každá unproven, missing, mixed, truncated, noncanonical, session, ledger,
Popen-unknown nebo unreaped větev zůstává `UNKNOWN_OPEN/NO_HANDOFF`; nesmí být
později přepsána na closed. D042 je i tak terminal bez poll/retry. Absence
procesu, targetu, outputu nebo admin pathu nesmí změnit UNKNOWN na známý stav.

## 8. Promotion, CREATE a fresh post-verifier

Concrete `rootWriteChain` je po E_B nezávisle validovaný při materializaci a
readiness verifierem ještě před lease transferem. Potom se complete readiness
handoff atomicky převede na `/root`; root už handoff ani Git/libgit2/JGit/direct
common metadata/private/process stav znovu nečte. V jediném
`functions.exec` boundary a exact one-isolate chain spustí ordinal `1` ff-only
promotion; pouze při
exit `0`, no signal, no session a complete raw outcome spustí exact CREATE jako
ordinal `2` bezprostředně další Git child. Žádný intervening child, nested tool
ani read mezi nimi. Promotion failure má observed ledger count `1`; CREATE
zůstane `UNISSUED`, i když authorized chain obsahuje dva možné child slots.

Každý promotion non-PASS/unknown ruší CREATE/VERIFY bez create. Issued CREATE
se při každém terminal outcome spotřebuje. Nonzero/signal/timeout/unknown/race
je terminal STOP/FREEZE bez retry, cleanup, prune, unlock, repair nebo alternate
target. CREATE exit `0` znamená pouze `CREATE_COMPLETED_UNVERIFIED`.

Teprve exact CREATE exit `0` dovolí issue+activate `D042-VERIFY-01` a atomický
holder transfer na fresh `/root/v5_d042_source_checkout_verifier`. Root nemá
post-read ani PASS authority. Post verifier použije post phase téhož exact
materialized handoffu se schema ID `d042-materialization-handoff-v4.1` a
autoritativní V4.2 `rootWriteChain` composition a jedním isolate fresh
recompute-ne promoted D042
DAG/report, root command adjacency, detached B37/tree, ignored/status/stage,
1 614-leaf filesystem/blob/mode closure, same-FD admin/index/info/config,
common refs/objects/pre-existing worktrees proti readiness baseline s pouze
promotion+target/admin allowlistem a private no-touch. Každý ordinal projde
stejným wrapperem a 1:1 ledgerem.

Complete mismatch je `CHANGES_REQUIRED`; incomplete nebo unprovable audit je
`BLOCKED` s absent PASS handoffem. VERIFY token se vždy spotřebuje, ale
`VERIFY_INCOMPLETE` je vždy `UNKNOWN_OPEN/NO_HANDOFF`. Complete verifier
`BLOCKED` smí lease uzavřít jen když každý possible child je prokázaně
no-child/reaped; jinak zůstává `UNKNOWN_OPEN/NO_HANDOFF`. Pouze distinct
post-verifier-owned complete PASS s úplným child accountingem uzavře lease a
odemyká dosud unconsumed D037 same-root private repair. D042 sama core
neopravuje, nesealuje a nevydává H0/runtime/T3 nebo release authority.

## 9. Acceptance matrix a negative fixtures

1. `R42-01` — D041 terminal red, adversary plain-status a invalidní precommit Review-A write-tree non-evidence jsou zachované bez launderingu.
2. `R42-02` — exact B42/scope/DAG/report/counts a immutable D041 artefakty sedí.
3. `R42-03` — exact U42=49, holder exclusions=48, fencing a distinct post-verifier sedí.
4. `R42-04` — fresh D042 tokeny, lease, committer a lock reason sedí.
5. `R42-05` — canonical acyclic P→D→B→outer templates, piny a post-E_B substitution sedí.
6. `R42-06` — ruling A, 22-variable builtin preflight a env-i bootstrap jsou explicitní bez silnějšího claimu.
7. `R42-07` — four ELF closures, cache/preload/symlink/setid, dva live ELF audity a typed toolchain preimage sedí.
8. `R42-08` — closed full argv, READ15, contiguous operations a exact expected bytes sedí.
9. `R42-09` — D/B/outer/envelope/marker-vector/syntax piny a compile-only evidence sedí.
10. `R42-10` — raw streams, signal, timeout, reap, UNKNOWN_OPEN taxonomy a ledger jsou úplné.
11. `R42-11` — rootWriteChain váže E_B a atomic readiness→promotion→CREATE→fresh-post transfer.
12. `R42-12` — atime je truthful a neexistuje silnější isolation ani unauthorized effect claim.

1. `F42-01-MISSING-IMMEDIATE-NO-OPTIONAL-LOCKS-CLI`
2. `F42-02-CONFIG-REORDER-OMISSION-OR-DUPLICATE`
3. `F42-03-GIT-OPTIONAL-LOCKS-ENV-DRIFT`
4. `F42-04-READ15-ORDER-OR-MAP-DRIFT`
5. `F42-05-ORDINAL-PHASE-SCOPE-SKIP-REPEAT-OR-REORDER`
6. `F42-06-RAW-TAIL-HASH-SHELL-INJECTION-OR-MULTIAPOSTROPHE-DRIFT`
7. `F42-07-PDB-CYCLE-MARKER-HASH-CANONICAL-OR-SELF-BINDING`
8. `F42-08-LOADER-VAR-SET-EVEN-EMPTY-ENV-I-OR-BOOTSTRAP-DRIFT`
9. `F42-09-TOOLCHAIN-LOADER-ELF-SYMLINK-SETID-OR-AUDIT-DRIFT`
10. `F42-10-O-NOATIME-COUNT-MAPS-DEVNULL-OR-COVERAGE-DRIFT`
11. `F42-11-EXPECTED-RAW-EXIT-SIGNAL-STDOUT-OR-STDERR-PREDICATE-DRIFT`
12. `F42-12-POPEN-STAGE-CONSTRUCTOR-LAUNCH-OR-FAILURE-TAXONOMY-DRIFT`
13. `F42-13-TIMEOUT-UNREAPED-CHILD-OR-OPEN-LEASE-LAUNDERED`
14. `F42-14-MIXED-TRUNCATED-SESSION-NONCANONICAL-BYPASS-OR-LEDGER-DRIFT`
15. `F42-15-FRESH-BASELINE-CANONICAL-SOURCE-TARGET-PRIVATE-OR-HANDOFF-MISMATCH`
16. `F42-16-PROMOTION-CREATE-POSTVERIFY-NONPASS-RETRY-OR-DONE-LAUNDERING`

Dosavadní author F16/heredoc výsledek je přesně
`TASK_CHANNEL_CLAIM / NOT_BYTE_REPRODUCIBLE / NON_EVIDENCE`: jeho preimages a
harness nebyly subjectem byte-vázané a nesmí se vydávat za PASS. Negative
matrix je pouze authoring-freeze governance evidence: dva independent
zero-based static reviews frozen subjectu musí každý vydat narrative
`PASS/P0=0/P1=0` nebo `CHANGES_REQUIRED`. Nejde o executable fixture proof,
nevzniká žádný fixture manifest a tato evidence není runtime-token input.
Author gates nespouštějí dispatcher source, Git child, live toolchain audit ani
operational run. Dva live ELF audity jsou autorizované až post-E_B a před token
mintem.

Fixture 14 navíc odmítá precommit audit, který místo read-only staged-content
rekonstrukce použije `write-tree`, `hash-object -w`, `update-index` nebo jiný
object/index-mutating příkaz a jeho výstup následně vydává za evidence.

## 10. Exact four-doc DAG, report a gates

Subject allowlist je exact:

1. `docs/decisions/042-m1-h0-v5-detached-source-checkout-read-constructor-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-READ-CONSTRUCTOR-REMEDIATION.md`

Reserved report je na B42 i subjectu absent:

```text
docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-read-constructor-remediation-20260818-report.md
```

DAG je `B42 → S_H0V5SRC042 → E_A_H0V5SRC042 → C_H0V5SRC042 →
E_B_H0V5SRC042 → canonical --ff-only`. Candidate má ordered parents
`[B42,E_A]` a exact E_A tree. Review A direct child subjectu vytvoří jen exact
four-line report; Review B direct child candidate připojí jen dvě řádky.

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 2a37131366c6992c56e8abf4f1f39982d27dbd40
subjectHead: <full-S_H0V5SRC042-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC042-sha>
reviewB.verdict: PASS
```

Subject má 1 628 paths; E_A/C/E_B po přidání reportu mají 1 629. Dva fresh
zero-based precommit audity musí dát `PASS/P0=0/P1=0`. Gates ověří exact
B42/tree/clean writer, exact four paths/report absence, D041 immutable bytes,
terminal incident/non-evidence, U42/exclusions, P/D/B/prelude/checker byte
reconstruction, fixed pins, negative-matrix static-review rules, placeholder rules, artifact
validation, registry, hygiene a `git diff --check`.

Po každém subject editu writer znovu vytvoří external task-channel freeze
manifest jako compact JSON array+LF: čtyři path-sorted rows, každý s key order
exact `path,mode,blob,bytes,sha256`. SHA-256 celého serializovaného payloadu je
jediný staged-content review pin. Kvůli self-reference se nevkládá do subjectu.
Revieweři jej ověří pouze no-write čtením index entries a staged blobů pod
oběma optional-lock suppressions; `write-tree`, object write a index mutation
jsou zakázané. Jakýkoli edit nebo staged-byte drift manifest invaliduje.

Phase-future metavariable counts v tomto Decision jsou exact: S jednou, C
jednou a E_B čtyřikrát. Fixed syntax-checker compile filenames a direct-prefix
template literal jsou byte-pinned source literals, nikoli unresolved
phase-future hodnoty. P/D/B používají pouze exact `@@...@@` marker scheme;
post-E_B placeholder audit vyžaduje before counts 1 a after counts 0. Jiný
phase-future metavariable je red.

Non-PASS nevytvoří candidate ani operational authority. Push, tag, release,
force, rebase, cherry-pick, amend, history rewrite, private/evidence/seal,
runtime/import, H0/T3/Gates authority jsou zakázané.

Dokud nejsou oba fresh precommit audity PASS:

```text
D041: TERMINAL BLOCKED / INCOMPLETE / NO RETRY
D042: UNCOMMITTED FROZEN SUBJECT / NO OPERATIONAL AUTHORITY
D037 PRIVATE REPAIR: BLOCKED_BEFORE_TRANSACTION / UNCONSUMED
V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO NOT EXECUTE
RUNTIME / ACCEPTANCE / T3 / GATES: NO AUTHORITY
```
