# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-READ-CONSTRUCTOR-REMEDIATION

**Výsledek:** exact four-doc governance-only náhrada terminal D041 read
constructoru. Po Review A+B vznikne post-E_B byte-exact V4.2 composition nad
fixed V4.1 authority profilem, dispatcherem, bootstrapem a outer operation
manifestem. Dva independent same-FD ELF
audity a oba exact `rootWriteChain.materializationAudits` musí dát PASS; teprve
potom smí právě jeden fresh readiness run použít
P→D→B→outer wrapper a případně odemknout nepřerušený
promotion→CREATE→fresh-post-verifier řetěz.

**B42:** `2a37131366c6992c56e8abf4f1f39982d27dbd40`

**B42 tree / paths:** `86baaefd1d2eee454c8882733292a2cb0716c9de` /
`1626`

**Stav subjectu:** `FROZEN_FOR_PRECOMMIT_AUDITS /
NO_OPERATIONAL_AUTHORITY`

## 1. Immutable D041 red a nový rozsah

D041 Decision/WP/report zůstávají byte-immutable:

| Artefakt | Blob | SHA-256 | Bytes |
|---|---|---|---:|
| Decision041 | `f40f056c7539bef8cbf67a56fc7c4329a6ebf881` | `21a8655ca9d5e03b200c70278d735b08d39ced67e5dbcbae973b59f09e61a3e6` | 27 569 |
| WP041 | `def68dd58eb2f9c691a7c83d1b5ab4832402d6fc` | `1e7526ed9a98c061f8ea8d5ba654d7b2b8a584c21292974405a1257f53732b89` | 13 188 |
| report041 | `f341cad2a5dadba21d51e37a66180c6736339a8c` | `31be98a754f789ef63d4a01e597b0d119b39b23176b9f96ef35b0a129c00f7a6` | 262 |

D041 docs Review A+B PASS není operational PASS. Její readiness token je
`CONSUMED`, attempt/launch `1`/`true`, outcome `BLOCKED / INCOMPLETE`.
První scoped child měl READ15+CONFIG15 a env `GIT_OPTIONAL_LOCKS=0`, ale argv
bylo `/usr/bin/git -C ...`; immediate `--no-optional-locks` chybělo. Full argv,
stdout, stderr a terminal artifact jsou `ABSENT/UNKNOWN`. CREATE/VERIFY jsou
`CANCELLED_UNISSUED`, lease closed/no handoff, promotion/create `0`/`false`,
target/admin absent a nebyl pozorován runtime/private/push efekt. Retry je
zakázaný.

Adversary plain `git status --short --branch` před D042 je pouze
`PRELEASE_D042_NON_EVIDENCE`; optional index refresh je `UNKNOWN`. Fresh
baseline musí začít od nuly.

První precommit Review-A audit je `PRECOMMIT_REVIEW_A_NON_EVIDENCE`.
V writer cwd spustil
`GIT_OPTIONAL_LOCKS=0 git --no-optional-locks write-tree` a dostal stdout
`eb1b3c5a1348387efb15ef17d13ef65dcc084c1e` + LF, ale neměl pre-command
object/index pin. Possible shared tree-object creation i index cache-tree
mutation jsou `UNKNOWN`; exit/signal/stderr/session jsou `ABSENT/UNKNOWN`.
Audit se zastavil bez PASS/P0/P1. OID není freeze pin ani operational evidence;
D042 token/lease zůstaly nevydané. Cleanup/object deletion/index rollback jsou
zakázané.

Live source je pouze B37 `df1863439b6ad83abf41396ba8063e5bffaa599e`, tree
`1f0e730a46a94a7f741b2dbf47426458b8125a97`, 1 614 paths. Canonical pre-op
je `c38e1b24849521b41025e70a37bf0219466c9d1e`, tree
`0b0cdff832b18cb75fcfd0ed2ed42e0701cc5a7e`; target je fixed
`/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343`.

WP smí měnit jen čtyři docs paths uvedené v §7. Zakázané jsou tracked helper,
temp/private/evidence/seal, process control/cleanup, runtime/import, Git push,
tag, release a history rewrite.

## 2. Ruling A, U42 a fresh namespace

Ruling A přijímá jako required roots of trust současný task runner, již načtený
pinned `/bin/dash` a fenced local filesystem. Builtin preflight rozpozná
accidental drift 22 loader variables, potom `env -i` vytvoří exact clean B/D
environment. Ruling výslovně nedokazuje malicious-preload resistance ani
path-swap/revert resistance; obojí je `NOT_PROVEN_OUT_OF_SCOPE`.

Same-FD audity čtou přes `O_RDONLY|O_CLOEXEC|O_NOFOLLOW`. `O_NOATIME` je
zakázané; atime effect je `POSSIBLE_UNKNOWN` a nevstupuje do pinned metadata.
Silnější zero-FS-effect nebo isolation claim je zakázaný.

Exact U42 je exact U41 42 entries plus právě:

```text
/root/decision042_adversary
/root/decision042_architect
/root/decision042_review_a
/root/decision042_review_b
/root/decision042_writer
/root/v5_d042_prelease_readiness_verifier
/root/v5_d042_source_checkout_verifier
```

U42 má 49 entries. Každý holder exclusion set je sorted U42 bez holdera a má
48 entries. Žádná osmá D042 identity není dovolena. Fresh post verifier je
distinct; starý D040/D041 verifier se nerecykluje. Writer/architect, poté oba
ELF auditoři, Review B a readiness verifier jsou po svém handoffu fenced.

Fresh identifiers jsou `D042-PRELEASE-READINESS-01`, `D042-CREATE-01`,
`D042-VERIFY-01` a lease
`D042-H0V5-DETACHED-SOURCE-CHECKOUT-LEASE-01`. Committer je
`M1-D042-Worktree` / `m1-d042-worktree@localhost`; reason je
`Decision042-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e`.

## 3. Final V4.2 constructor a fixed V4.1 P/D/B piny

Autoritativní chain je acyklický P→D→B→outer:

| Komponenta | Fixed bytes / LF | SHA-256 | Materialized rule |
|---|---:|---|---|
| P authority-profile source template, ASCII+terminal LF | `965` / `1` | `f6ff8e7630894d9bce12c8b679363140478a03f4dbe5f98624df83c4101a4005` | 16 exact fragments, final P+LF canonical; H_P |
| D dispatcher source template, ASCII+terminal LF | `25393` / `396` | `57ef77c0d57c7fe01b1140ffd5d3e0c5788b717e95c3369df419bd2d7a5b7735` | marker H_P → `25437` bytes; H_D |
| B bootstrap source template, ASCII+terminal LF | `1374` / `29` | `b46cda4ab7eaa879afdd2bad7330bfa20e575021835ba3f7f55f06297399394c` | marker H_D → `1417` bytes; H_B |
| outer-prelude decoded ASCII | `457` / `1` | `ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7` | no terminal LF, ends one space |
| syntax-checker source, ASCII+terminal LF | `524` / `15` | `7669c04df6531e25d8e01cc7498c63750182b16670a183b78b827df30dc32976` | compile-only D/B templates |

P má exact schema `d042-authority-profile-v4.1`, profile ID
`D042-AUTHORITY-PROFILE-01`, fixed Popen constructor a 16 unquoted markers v
pořadí:

```text
BASE DEV_NULL ELF_CLOSURES EXECUTABLES LIMITS LOADER_CONTROLS MODULE_BINDINGS
NATIVE_MAPPINGS OPERATIONS PATH_CONTROLS PHASES READ_ENV READ_ENV_ORDER RUNTIME
SCOPE_PREFIXES TOOLCHAIN_FILES
```

Každý marker before count je 1, každý after count 0. Fragment je canonical
sorted ensure-ASCII duplicate-free integer-only JSON bez LF, marker-free.
Final P+LF se musí parse/recanonicalize byte-identicky. P neobsahuje D/B hash
ani source; D obsahuje pouze H_P a B pouze H_D. Handoff hash je externí a
nevstupuje zpět do chainu.

Všechny V2/V3, P937/D21697/B1310, intermediate D21671/D25371, starý
prefix5/argv10/command, env-only/21-var prelude, P1024
`outerNativeClosures` a free `stdoutClass`/`exitCodes` profily jsou
`SUPERSEDED / NONAUTH / NON_EVIDENCE`.

Fixed command pins jsou:

| Input | Elements / bytes | SHA-256 |
|---|---:|---|
| CREATE14 compact JSON+LF | `14` / `339` | `bf983f755d42e425955cff687ee511a3d2b87cd3ef31fa06167b3ec591b87b31` |
| READ15 compact JSON+LF | `15` / `362` | `018d10533e68dfd261c22ceed97be36a41552866578870884dafdfa86d93a65c` |
| CONFIG15 compact JSON+LF | `15` / `393` | `e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085` |
| CREATE argv compact JSON+LF | `59` / `1171` | `823b80bc3ccdaa4ad4cabfdbd88c8f1aaa3f37db4715171b7a827d22876abc95` |
| promotion template compact JSON+LF | `53` / `953` | `713ae5d1d5cc33b0005409eb9ceaaf5c2822bab123c9ddfef057f11f153a16fe` |
| lock reason raw ASCII+LF | `1` / `80` | `ccde801e53e12750a1b5f247d2536e2a9f5fb68a5f7e82c14493195982a3d437` |
| direct template prefix compact JSON+LF | `34` / `532` | `5e8537759c0cf3d261a87d7cc2aa90f893ef69960bdef33d19813caa392eee69` |
| canonical-scope prefix compact JSON+LF | `34` / `558` | `8ef942022df77787cb9dbe471667331d4050c89eafdb52513d03074dbd1b51f2` |
| target-scope prefix compact JSON+LF | `34` / `582` | `9512c0562504f85bd64fce9849c86be5ba91ba104bcec200f5fd9bb5a7540439` |
| first readiness argv compact JSON+LF | `37` / `597` | `2cec3a8e4b400fa067e83d630354dcf4c542aaa000d8780514bd7aefdd266087` |
| first post argv compact JSON+LF | `37` / `621` | `ef01e71a1cd6183eefa852e66823027d7ce53c2e80dfa7be637f98aeaef0d1fa` |
| READ env in READ15 order, compact JSON+LF | `15 keys` / `392` | `b3f141f49a19a4f0471cc459b3216b99c94192501d9ef61fa295435cf2d75e15` |
| LIMITS JSON fragment without LF | `5 keys` / `120` | `d8a056b40661b77f99ceda71745ec65cd995f8b028b07eaef29fd38bd6a87c78` |

`b3f141…` váže insertion-order READ15 environment evidence, ne sorted
canonical `READ_ENV` fragment P. Ten se včetně vlastního hashe materializuje
až post-E_B; fixed bytes, values a pin se nemění.

`d8a056…` je canonical `LIMITS` fragment bez LF; terminal LF přidává až celý
materialized P, ne jednotlivý fragment.

Každý direct argv začíná `/usr/bin/git --no-optional-locks -C` exact scope a
15 ordered CONFIG15 pairs. READ15 má environmentový flag ve správném ordered
slotu; ani CLI ani env varianta nenahrazuje druhou. First tail je exact
`rev-parse --verify HEAD^{commit}`. Každý další full argv/expected result je
closed post-E_B operation; free-form tail je zakázaný.

Outer argv14 je env-i + `LC_ALL=C`, `PYTHONCOERCECLOCALE=0` + CPython 3.12
`-I -S -B -c` + materialized B/D/P + phase/ordinal. Prelude builtin odmítne
jakoukoli z 22 loader variables i s prázdnou hodnotou, pak `exec` exact
quote-all argv. Exact envelope: dash, cwd `/`, login/tty false, yield 30 000,
max output tokens 200 000, sandbox override omitted. Serializer fixture
`a'b'c` má raw 15 bytes bez terminal LF/SHA
`07b183fe9bb7cd881b3d421c2ff51b20edf48aa71f705bb45c85a0fa80cc4311`.

Compile-only syntax audit má argv12 compact JSON+LF 29 629/SHA
`66643956f062d3cf3aa79261cb0bda115271907d25e97928971fb4261b1cbf61`,
raw outer-prelude + quote-all command bez terminal LF 27 869/SHA
`bf558c9580e5bdd4f1017f9ccccd611bf881fcb444f5109935df176b076ee2d9`
a exact result exit0/no session/output `D:25393:396;B:1374:29` + LF. D/B se při
něm nespouštějí.

Marker argv14 pin fixture je tento exact compact JSON+LF:

```json
["/usr/bin/env","-i","LC_ALL=C","PYTHONCOERCECLOCALE=0","/usr/bin/python3.12","-I","-S","-B","-c","@@BOOTSTRAP_SOURCE@@","@@DISPATCHER_SOURCE@@","@@AUTHORITY_PROFILE_WITH_LF@@","@@PHASE@@","@@ORDINAL@@"]
```

Má 204 bytes/SHA
`82ed15e86a1c1e0c04ae2fe0babbc75e3eca1b9ab6963f5b0a75d153b2fa46a4`.
Je to byte pin fixture, nikoli free-form runtime tail.

Root-write preimages jsou compact ASCII JSON+právě jeden terminal LF; code
block neobsahuje jiné whitespace. Pair-form environment je `NON_AUTHORITY`.

CREATE14 / `envOrdered`, 14/339/SHA
`bf983f755d42e425955cff687ee511a3d2b87cd3ef31fa06167b3ec591b87b31`:

```json
["PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost"]
```

Promotion prefix `argv[0:52]`, 52/925/SHA
`370477a7fd67586c461a12e2df40f017bd636f6b4d1e207f294c53665a9527f9`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","merge","--ff-only","--no-edit"]
```

Promotion template, 53/953/SHA
`713ae5d1d5cc33b0005409eb9ceaaf5c2822bab123c9ddfef057f11f153a16fe`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","merge","--ff-only","--no-edit","<full-E_B_H0V5SRC042-sha>"]
```

CREATE prefix `argv[0:56]`, 56/974/SHA
`c539b80e570c69a9a16e5ca311f90b764a8c7d4afca10aae9202cda84a6bcb6f`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","worktree","add","--detach","--checkout","--no-guess-remote","--lock","--reason"]
```

Fixed CREATE argv, 59/1171/SHA
`823b80bc3ccdaa4ad4cabfdbd88c8f1aaa3f37db4715171b7a827d22876abc95`:

```json
["/usr/bin/env","-i","PATH=/usr/bin:/bin","LANG=C","LC_ALL=C","TZ=UTC","GIT_CONFIG_NOSYSTEM=1","GIT_CONFIG_GLOBAL=/dev/null","GIT_TERMINAL_PROMPT=0","GIT_ASKPASS=/bin/false","SSH_ASKPASS=/bin/false","SSH_ASKPASS_REQUIRE=never","GIT_NO_LAZY_FETCH=1","GIT_ATTR_NOSYSTEM=1","GIT_COMMITTER_NAME=M1-D042-Worktree","GIT_COMMITTER_EMAIL=m1-d042-worktree@localhost","/usr/bin/git","-C","/home/belphareon/worktrees/is-m1-consolidated","-c","core.hooksPath=/dev/null","-c","core.attributesFile=/dev/null","-c","core.excludesFile=/dev/null","-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.splitIndex=false","-c","core.sparseCheckout=false","-c","core.sparseCheckoutCone=false","-c","submodule.recurse=false","-c","maintenance.auto=false","-c","gc.auto=0","-c","fetch.writeCommitGraph=false","-c","protocol.allow=never","-c","worktree.guessRemote=false","-c","checkout.workers=1","worktree","add","--detach","--checkout","--no-guess-remote","--lock","--reason","Decision042-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e","/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343","df1863439b6ad83abf41396ba8063e5bffaa599e"]
```

## 4. Post-E_B materializace a independent audits

Review B až po existenci E_B materializuje všech 16 fragmentů, profile P,
D/H_D, B/H_B, každý direct/outer operation a canonical task-channel handoff
schema `d042-materialization-handoff-v4.1`. Handoff exact root keys jsou
`authorityProfile,bootstrap,directOperations,dispatcher,elfAudits,
outerOperations,placeholderAudit,rootTrust,rootWriteChain,schema,
syntaxAudit,toolchainAudit`.

Každá direct row váže full argv/env/expected bytes; každá outer row full argv,
serialized command a exact envelope. Operations jsou contiguous ordered po
`readiness` a `post` phase. Handoff dále váže template/materialized hashes,
fragment pins, placeholder audit, fixed syntax audit, toolchain coverage a
exact ruling-A rootTrust record. Future concrete hodnoty se v subjectu
nefabrikují; vznikají pouze post-E_B a external handoff SHA není self-embedded.

`rootWriteChain` má exact keys `candidate,chain,create,createSerializer,
materializationAudits,promotion,promotionSerializer`. `candidate` má exact
`baseHead,canonicalRef,head,tree`: B42, integration ref a concrete E_B
head/tree; oba object IDs jsou lowercase 40-hex a tree musí být skutečný
`tree(head)`.

`promotionSerializer` je canonical compact sorted ASCII JSON+LF exact
939B/SHA `0ee25abc622228f9cb2e75d86ac39b1436dfde49db0651222a20297cec98b402`:
`{"algorithm":"PRELUDE457_PLUS_Q_ALL_SINGLE_QUOTE_V1","execBuiltin":true,"forbiddenVarCount":22,"join":"ASCII_SPACE","prefix":"case \"${GLIBC_TUNABLES+x}${LD_ASSUME_KERNEL+x}${LD_AUDIT+x}${LD_BIND_NOT+x}${LD_BIND_NOW+x}${LD_DEBUG+x}${LD_DEBUG_OUTPUT+x}${LD_DYNAMIC_WEAK+x}${LD_HWCAP_MASK+x}${LD_LIBRARY_PATH+x}${LD_ORIGIN_PATH+x}${LD_POINTER_GUARD+x}${LD_PREFER_MAP_32BIT_EXEC+x}${LD_PRELOAD+x}${LD_PROFILE+x}${LD_PROFILE_OUTPUT+x}${LD_SHOW_AUXV+x}${LD_TRACE_LOADED_OBJECTS+x}${LD_TRACE_PRELINKING+x}${LD_USE_LOAD_BIAS+x}${LD_VERBOSE+x}${LD_WARN+x}\" in '') ;; *) exit 125 ;; esac\nexec ","prefixBytes":457,"prefixSha256":"ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7","preflightExitCode":125,"preflightPlacement":"BEFORE_EXTERNAL_ENV","quoteReplacementBytes":[39,34,39,34,39],"suffix":"","templateCmdBytes":1407,"templateCmdSha256":"8d09cb5c331284101c458bad0ce652a56aab500975b6df9a1d9b3d2649a4de14","terminalLf":false}`.
q(s) obalí string ASCII apostrofy a nahradí všechny apostrofy exact bytes
`'"'"'`. Template cmd je PRELUDE457+Q_ALL(argv53), přesně
1 407B/1LF/no-terminal-LF/SHA
`8d09cb5c331284101c458bad0ce652a56aab500975b6df9a1d9b3d2649a4de14`;
materialized cmd má 1 422B a exact SHA vznikne post-E_B.
`createSerializer` je canonical compact sorted ASCII JSON+LF exact
704B/SHA `b212cae516543ef3fb5dce4d8b4e34e14d4cd1c204f94b557104584c5ac50213`:
`{"algorithm":"FIXED_DASH_SUBSHELL_WITH_PRELUDE457_V2","argvProjection":"AFTER_INDENTED_PRELUDE_REMOVE_BSLASH_LF_THEN_ASCII_SPACE_SPLIT_V1","cmdBytes":1734,"cmdSha256":"9009095a0ac6264fc5662386d5490d1732a45a162623a531a1092372b5b59fa1","execBuiltin":true,"forbiddenVarCount":22,"indentedPreludeBytes":461,"indentedPreludeSha256":"f1b64923300e4657db18a9faa0bf61cd75968f962f7dfee0a7867ef2a4e1f056","outerSubshell":true,"preflightExitCode":125,"preflightPlacement":"AFTER_UMASK_BEFORE_EXEC","preludeTransform":"PREFIX_EACH_LOGICAL_LINE_TWO_ASCII_SPACES_V1","sourcePreludeBytes":457,"sourcePreludeSha256":"ab8d23086400e4b4909488275d45a68cfbefb1ed6130e7f7b80229114c4523b7","terminalLf":true,"umaskOctal":"077"}`.
CREATE cmd je byte-for-byte Decision §4 fixed 1 734B/33LF/terminal-LF block,
SHA `9009095a0ac6264fc5662386d5490d1732a45a162623a531a1092372b5b59fa1`.
Header končí INDENTED_PRELUDE exact two spaces+`exec `; suffix je LF+`)`+LF.
Po odstranění všech backslash+LF a splitu payloadu na runs ASCII spaces bez
empty musí vzniknout argv59. Old 1 280B/9ee793… je
`SUPERSEDED_CONSTRUCTION_INPUT / NON_EXECUTABLE`; derived Q_ALL
1 184B/b82e… je `NON_AUTHORITY / PROHIBITED`.

`chain` má exact `authorizedChildCount,executorBytes,executorSha256,
executorSource,functionsExecIsolateCount,noInterveningChild,order,predicateIds,
rootRereadAllowed,validatedBeforeLeaseTransfer`; fixed values jsou `2`, `1`,
`true`, `["promotion","create"]`, `false`, `true`. Full exact ASCII
`executorSource` skutečně invoked, jeho byte count a lowercase SHA jsou future
`MATERIALIZE_POST_E_B`; subject je drží `ABSENT/UNMATERIALIZED`, final handoff
je musí mít concrete/marker-free a static call graph validovaný pre-token.
Exact ordered `predicateIds` v chain i obou audits jsou:

```json
["RW01_EB_TREE","RW02_PROMOTION_TEMPLATE","RW03_PROMOTION_BINDINGS","RW04_PROMOTION_PREFIX","RW05_PROMOTION_ENV","RW06_PROMOTION_ARGV","RW07_PROMOTION_CMD","RW08_CREATE_ARGV59","RW09_CREATE_PREFIX","RW10_CREATE_ENV14","RW11_CREATE_REASON","RW12_CREATE_CMD","RW13_ENVELOPES","RW14_EXECUTOR_CALLGRAPH","RW15_NO_REREAD"]
```

Promotion exact keys jsou `argv,argvBytes,argvSha256,bindings,cmd,cmdBytes,
cmdSha256,envelope,envBytes,envOrdered,envSha256,ordinal,prefix,prefixBytes,
prefixSha256,template,templateBytes,templateSha256`; ordinal `1`. Template je
embedded vector53 953/SHA `713ae5…`; prefix=`template[0:52]` 925/SHA
`370477…`; envOrdered=`template[2:16]` je 14-string vector 339/SHA `bf983f…`.
Bindings jsou ordered: exact
`{"index":18,"name":"canonicalPath","value":"/home/belphareon/worktrees/is-m1-consolidated"}`
a row exact keys `index,name,templateValue,value` s index52, name
`candidate.head`, templateValue `<full-E_B_H0V5SRC042-sha>` a concrete value
rovným candidate.head. Je to jediná replacement. Materialized argv53 i
PRELUDE457+Q_ALL cmd bytes/SHA jsou post-E_B; cmd má přesně 1 422B.

Create exact keys jsou `argv,argvBytes,argvSha256,cmd,cmdBytes,cmdSha256,
envelope,envBytes,envOrdered,envSha256,ordinal,prefix,prefixBytes,prefixSha256,
reasonArgIndex,reasonBytes,reasonSha256,reasonWithLf`; ordinal `2`. Fixed
argv59 je 1 171/SHA `823b80…`, prefix=`argv[0:56]` 974/SHA `c539b8…`,
envOrdered=`argv[2:16]` je 14-string 339/SHA `bf983f…`. Index18 je canonical,
55 `--reason`, `reasonArgIndex=56`, index57 target, index58 B37. Literal reason
+ právě LF má 80B/SHA
`ccde801e53e12750a1b5f247d2536e2a9f5fb68a5f7e82c14493195982a3d437`.
Create cmd/bytes/SHA jsou exact 1 734B/33LF fixed block a projection.

Oba rows mají exact envelope
`{"login":false,"max_output_tokens":10000,"sandbox_permissions":"OMITTED","shell":"/bin/dash","tty":false,"workdir":"/","yield_time_ms":30000}`;
actual tool field `sandbox_permissions` je absent. `materializationAudits` jsou
právě dva ordered rows pro `/root/decision042_review_a` a
`/root/decision042_adversary`, každý exact `auditor,narrative,narrativeBytes,
narrativeSha256,predicateIds,verdict`. Future post-E_B retained UTF-8 narrative
uvádí observed values/counts/SHA pro všech 15 predicates, její byte count/hash
sedí a verdict je PASS. Oba validují před fence/token. Pre-populated/missing/
placeholder/single-review/disagreement/non-PASS znamená no token/no transfer.

RW predicates přesně ověří: candidate tree/base/ref; template53; bindings a
sole index52 replacement; promotion prefix/env/materialized argv; exact
promotion serializer, PRELUDE457, template a materialized cmd. U `RW07` znamená
set-even-empty reject kteréhokoli z 22 jmen známý launch a reap promotion shell
childa s exit `125`, ale nulový launch/count external promotion Git; CREATE i
VERIFY zůstávají `UNISSUED` a větev je terminal
`CLOSED_BLOCKED/NO_HANDOFF` bez retry nebo transferu. Dále ověří fixed
CREATE59/prefix/env/reason a exact CREATE serializer/block/preflight/projection/
umask. U `RW12` už je CREATE issued: stejný known-reaped exit `125` spotřebuje
CREATE token, prokazuje nulový launch/count CREATE Git, ponechá pravdivě
zaznamenanou předchozí promotion a VERIFY zůstane `UNISSUED`; větev je terminal
`CLOSED_BLOCKED/NO_HANDOFF` bez retry. Každý neprokázaný outcome nebo reap
kteréhokoli shell childa je `UNKNOWN_OPEN/NO_HANDOFF`. `RW13` navíc vyžaduje u
obou exact serializerů jejich exact builtin preflight před external
`/usr/bin/env` a byte-equal cmd i envelope v příslušném callsite. `RW14` dovolí
CREATE callsite jen po complete promotion exit `0`, no signal, no session a no
truncation; oba callsites dostanou pouze svůj exact cmd/envelope a mezi nimi
není tool/process/helper/read. No Git/FS reread smí použít jen fenced preimages.
`authorizedChildCount=2` je pre-exec authority; promotion failure má observed
count1 a CREATE `UNISSUED`.

`toolchainAudit` má exact keys `evidence,evidenceBytes,evidenceSha256`.
Evidence je canonical JSON+LF 266 bytes/SHA
`0505e283dc0f81d12084d5186a92b82eab56636b134afff189f3978d0e1b58e7`
a exact value
`{"atimeDisclosure":"POSSIBLE_UNKNOWN","checks":{"ambientLoaderFixturePass":true,"devNullReopenPass":true,"elfAuditPairPass":true,"moduleCoveragePass":true,"nativeMapCoveragePass":true,"sameFdPass":true,"symlinkCoveragePass":true},"schema":"d042-toolchain-audit-v1"}`.
`evidenceBytes` je integer, hash lowercase hex string a všech sedm checks musí
být boolean true před vytvořením PASS recordu.

Review A a adversary pak nezávisle rekonstruují všechny bytes a každý provede
právě jeden bounded live same-FD read-only ELF audit jen exact P paths, bez
Git/subprocess/write. Ověří four closures dash/env/git/python, loader cache,
preload absence, kompletní symlink chains, setid absence, file SHA a pre/post
fstat. Ordered audit rows jsou Review A a adversary, oba musí dát PASS.
Atime zůstává `POSSIBLE_UNKNOWN`. Two ELF PASS dovolí typed toolchain PASS;
oba exact `rootWriteChain.materializationAudits` musí samostatně dát PASS.
Potom jsou oba auditoři fenced; non-PASS token nevznikne.

## 5. One-shot readiness, promotion a post-verification

Po two ELF PASS + two root-write materialization PASS root task-channelem
mint+activate-ne jediný readiness token
a generation-1 lease na exact readiness verifier. Readiness phase proběhne v
jediném `functions.exec` isolate. Před childem validuje celý handoff/chain;
potom připouští pouze next contiguous outer ordinal. Každý direct/raw/helper
Git child má 1:1 orchestration ledger row. Skip/repeat/reorder/bypass/session/
truncation/noncanonical output je terminal BLOCKED.

D dispatcher používá exact Popen constructor se shell false, cwd `/`, exact
READ env a full argv. Zachytí oddělené stdout/stderr bytes+SHA+B64, exit/signal,
timeout, PID, reap a stage; otevře a před i po childovi ověří exact toolchain,
path controls a `/dev/null`. Expected match je pouze
`MATCHED_AWAITING_VERIFIER`, ne PASS. Neznámý launch/outcome/lease zůstává
UNKNOWN; nikdy se nedopočítá z absence targetu nebo procesu. Pre-Popen proven
no-child reject smí být `CLOSED_BLOCKED/NO_HANDOFF`. Každá Popen-enter,
missing/mixed/truncated/noncanonical/session/ledger nebo unproven-reap větev
je `UNKNOWN_OPEN/NO_HANDOFF`; close je dovoleno jen po complete accountingu
každého possible child jako no-child/reaped.

Complete readiness PASS převede stejný lease na root až po dual validation
exact `rootWriteChain`. Root bez rereadu v jediném isolate spustí exact
ordinal-1 ff-only promotion a pouze při exact exit0/no
signal/session spustí CREATE jako bezprostředně další Git child. Jakýkoli
non-PASS ruší další tokeny a D042 končí bez retry/cleanup/prune/unlock/alternate
targetu. CREATE exit0 je pouze `CREATE_COMPLETED_UNVERIFIED`.

Teprve potom vznikne D042 VERIFY a holder se převede na fresh
`/root/v5_d042_source_checkout_verifier`. Jeho single post isolate zopakuje
wrapper/ledger pro celý promoted DAG/report, root adjacency, detached B37,
1 614-leaf tree/index/filesystem/blob/mode closure, same-FD admin/config/info,
common Git exact delta a private no-touch. VERIFY se vždy spotřebuje, ale
`VERIFY_INCOMPLETE` je `UNKNOWN_OPEN/NO_HANDOFF`. Complete BLOCKED smí lease
uzavřít jen s complete no-child/reaped accountingem všech possible children;
jinak zůstává UNKNOWN_OPEN. Pouze complete PASS uzavře lease a odemyká
unconsumed D037 private repair.

## 6. Acceptance matrix a fixtures

1. `R42-01` — D041 red, plain-status a invalidní precommit write-tree non-evidence jsou zachované.
2. `R42-02` — B42/scope/DAG/report/counts a immutable D041 piny sedí.
3. `R42-03` — U42=49/exclusions=48/fencing/distinct post verifier sedí.
4. `R42-04` — D042 tokens/lease/committer/reason sedí.
5. `R42-05` — P→D→B→outer chain/templates/materialization je acyklický a exact.
6. `R42-06` — ruling A/preflight/env-i hranice je pravdivá.
7. `R42-07` — four ELF closures, cache/preload/symlink/setid, dva live ELF audity a typed toolchain preimage sedí.
8. `R42-08` — closed argv/READ15/expected bytes/operations sedí.
9. `R42-09` — D/B/outer/envelope/marker-vector/syntax bytes a piny sedí.
10. `R42-10` — raw streams/signal/reap/UNKNOWN_OPEN taxonomy/ledger jsou úplné.
11. `R42-11` — rootWriteChain a atomic promotion→CREATE→fresh post verifier jsou exact.
12. `R42-12` — atime/no-stronger-isolation/no-unauthorized-effect tvrzení sedí.

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

Dosavadní author F16/heredoc claim je
`TASK_CHANNEL_CLAIM / NOT_BYTE_REPRODUCIBLE / NON_EVIDENCE`; bez subject-bound
preimages/harnessu není PASS. Negative matrix je pouze authoring-freeze
governance evidence: dva independent zero-based static reviews frozen subjectu
musí vydat narrative `PASS/P0=0/P1=0` nebo `CHANGES_REQUIRED`. Není to
executable fixture proof, nevzniká fixture manifest a nejde o runtime-token
input. Author gate nespouští D/B source, Git child, live ELF audit ani
operational run.

Fixture 14 odmítne také precommit `write-tree`, object write, index-mutating
command nebo laundering jeho stdout jako staged-content evidence.

## 7. DAG, paths, report a gates

Subject exact four paths jsou Decision042, `docs/execution/m1-batch.md`,
`docs/wp/README.md` a toto WP. D041 Decision/WP/report nejsou subject. Reserved
report je na B42 i subjectu absent:

```text
docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-read-constructor-remediation-20260818-report.md
```

DAG je B42→S→E_A→C(ordered parents `[B42,E_A]`, tree=E_A)→E_B→canonical
ff-only. Review A vytvoří exact four-line report; Review B připojí jen dvě
řádky:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 2a37131366c6992c56e8abf4f1f39982d27dbd40
subjectHead: <full-S_H0V5SRC042-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC042-sha>
reviewB.verdict: PASS
```

Subject má 1 628 paths, report states 1 629. Dva fresh zero-based precommit
audity musí dát `PASS/P0=0/P1=0`. Gates ověří B42/tree/clean writer, exact four
paths/report absence, D041 immutable red, U42/exclusions, exact P/D/B/prelude/
checker extraction, fixed command pins, marker/phase-future metavariable
counts, negative-matrix static-review rules, artifact validation, registry, hygiene a
diff-check.

Po každém editu vznikne nový external compact JSON array+LF freeze manifest
čtyř path-sorted staged rows s key order exact `path,mode,blob,bytes,sha256`;
hash celého
payloadu se předá task-channelem a kvůli self-reference není v subjectu.
Review audit jej recompute-ne pouze no-write index/blob reads s env i CLI
optional-lock suppression. `write-tree`, object write a index mutation jsou
zakázané; drift invaliduje manifest.

Phase-future metavariables jsou v tomto WP exact S jednou, C jednou a E_B
dvakrát; žádný jiný není povolen. Konkrétní profile/operation/handoff hodnoty
jsou post-E_B task-channel data, ne subject placeholdery. Non-PASS nic
nepromuje a nevydává private/runtime/push authority.
