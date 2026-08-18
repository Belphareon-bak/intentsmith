# 041 — Fresh prelease readiness po D040 `NOT_READY` a identity driftu

- **typ:** exact four-doc governance-only operational remediation; žádný
  tracked executable/helper, process-control ani private/runtime authority
- **stav subjectu:** `FROZEN_FOR_PRECOMMIT_AUDITS / NO_OPERATIONAL_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B41:**
  `d0a1c91c76eea039dddf428e57cd758c26a9c81f`
- **baseTree:** `5c09b012ebc06556217022d15d25873511c3a8af`
- **výsledek až po Review A+B:** právě jeden fresh readiness run smí po
  external-only odstranění konfliktů recompute-nout celý prelease stav; pouze
  complete `PRELEASE_READY` dovolí nepřerušený transfer lease na `/root`,
  exact ff-only promotion D041, next-Git-child CREATE a fresh D041 post-verifier

D040 docs Review A+B jsou `PASS`, ale její final operational baseline je
`NOT_READY`. Navíc první identita mimo exact U40 vznikla ještě před aktivací
D040 lease. D040 je proto definitivně
`SUPERSEDED_BEFORE_LEASE / TERMINAL_STOP /
PRELEASE_IDENTITY_UNIVERSE_DRIFT`; není dovoleno ji retryovat ani po pozdějším
zmizení historických PIDů. D041 vytváří nový namespace a jedinou novou
one-shot authority. Subject sám žádnou operational authority nevydává.

## 1. Immutable B41 a byte-preserved D040

B41 má právě 1 623 tracked paths. Je to D040 Review-B evidence commit s
jediným parentem `f9c9388ee570f636af5aa5a3f55f34413e55d953` a stromem
`5c09b012ebc06556217022d15d25873511c3a8af`.

Tyto tři D040 artefakty jsou immutable a D041 je nesmí editovat:

| Artefakt | Git blob | SHA-256 obsahu | Bytes |
|---|---|---|---:|
| Decision040 | `7f8893ac1fa62b6b0f2a608da39bbdc2b0f92f61` | `15fe95c651d9eda554f922b27a3767989e4de8d4b986e00df20a837988802494` | 31 882 |
| Decision040 WP | `0df49aa1c56841136c33666cf359474e91f6de0b` | `ef05b22a169ce54a53772a1b15f1eec4000d1c3bc9ffebc66d434555b3ccb1fd` | 17 247 |
| D040 Review-B report | `2a71811f34e249ca632c1ab482c2f0917d5e9393` | `ee8928dec031e5d04fb911e08d497d8077ecdb8e44b3276c74d5ca5a3a84207c` | 262 |

D040 report má právě šest LF-terminated řádků:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: c38e1b24849521b41025e70a37bf0219466c9d1e
subjectHead: 2fe0c22680c486fe73ddda8643ae29f08621c18b
reviewA.verdict: PASS
candidateHead: f9c9388ee570f636af5aa5a3f55f34413e55d953
reviewB.verdict: PASS
```

Tyto PASS verdicty dokazují pouze D040 docs/candidate. Nejsou
`PRELEASE_READY`, CREATE PASS, source-checkout PASS ani runtime evidence.

Live static/source base zůstává výhradně Decision037 Review B:

| Pole | Exact hodnota |
|---|---|
| B37 | `df1863439b6ad83abf41396ba8063e5bffaa599e` |
| tree | `1f0e730a46a94a7f741b2dbf47426458b8125a97` |
| tracked paths | `1614` |
| JSON+LF path-set SHA-256 | `51a56c8acf7641fd3931e3b7c3cd10e41c54bf2e4c85ad1a51d4e906dc9ec0ea` |
| raw `ls-tree` bytes/SHA | `151786` / `f58eaf76cb26cdcdae343ebaea8830b51d4130e15a437148c8e6ea6904109ff6` |

Target, admin a canonical checkout jsou stále exact:

```text
/home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
/home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
/home/belphareon/worktrees/is-m1-consolidated
```

Canonical před operational runem zůstává
`c38e1b24849521b41025e70a37bf0219466c9d1e`; B41 není canonical promotion.
Target/admin byly při D040 baseline absent. D041 readiness je musí ověřit
fresh; historická absence sama není prelease důkaz.

## 2. Authoritative D040 `NOT_READY` incident

D040 Review B po evidence commitu dokončil final no-write baseline. Výsledek
je `NOT_READY / OPERATIONAL_RUN_NOT_STARTED`. Raw machine `failedGate` je
`ABSENT/UNKNOWN`; task-channel evidence žádný machine key/value nevydala.
Normalized failure reason je `PERSISTENT_RELEVANT_OPEN_CWD_CONFLICTS`:
persistent open-CWD conflicts nesplnily požadovaný
`no-open-handle/exclusive-all-linked-worktrees` gate.

| Pole | Exact hodnota |
|---|---|
| D040 E_B / tree | `d0a1c91c76eea039dddf428e57cd758c26a9c81f` / `5c09b012ebc06556217022d15d25873511c3a8af` |
| lease | prepared, nikdy neaktivovaný |
| promotion count / launch | `0` / `false` |
| CREATE / VERIFY | oba `UNMINTED` |
| create count / launch | `0` / `false` |
| target / admin | absent / absent |
| D040 authority v okamžiku baseline | unconsumed; žádný operational child |
| ignored-aware status | 52 bytes / `a53322e2815a423a74fe1de3fca2b37b49b142eaa6efe9c411916ac2f192c9ac` |

Exact ignored-aware status bytes byly tři NUL-terminated entries
`!! .env`, `!! .intentsmith-artifacts/` a `!! node_modules/` v tomto pořadí.

Final baseline/transcript piny jsou:

| Stream | SHA-256 |
|---|---|
| baseline | `11d6bc4b7d9e8b8104255842be193f19a9a087a2df4f3988be490e0c1b6d5a6e` |
| commonFull | `bfe051d27943c0ea518518a3591a335da77d3110b794276e9babb8aa0d8b25e8` |
| commonStable | `ad98a8e439c4a5a735877dd10c72ba2ba9a5cd06693cabd287d3ec07231d892c` |
| objects | `d07404e5e7a28d85f724f4f84728981e0c33cd468599f36c144e1234863a4a95` |
| preexistingWorktreesStable | `6ffed39239a432cf500997fd02d65b7aa9fed2e5b1c1e65a0c6591f63b4b5fa0` |
| canonicalFull | `ad2db6476b1a75895ca4e71ba4d78eb7c6aaac11c0c1b78082ebcaa125e7d95f` |
| canonicalStable | `c99871c9de7691f65a5d456e7ecbbd762a927a6f2f6d1193967b4e60cfef9b67` |
| private | `769d879acbce7990ee0eed385a7b1ca06337a41f0ffc30cb485e3bc4da75047b` |
| authentic red | `a89fa13c040ac19d74e660cd4ab72491ace9f119cd62230b04e1b18e60d05ab5` |
| transcript61 | `ad6d82955efc582edb83161b19a6ca1fb14a82eac58c4a5fcfb9147f08d54f0b` |

Relevant persistent open-CWD conflicts byly:

| PID | executable/role | uid / start / timezone | parent | cgroup | cwd |
|---:|---|---|---|---|---|
| `1856386`–`1856389` | `/usr/bin/yes` | `1000` / `2026-08-12 22:56:28` / `CEST` | user-systemd | `app-code-1440411.scope` | `/home/belphareon/worktrees/is-mobile-alpha` |
| `2108159` | idle `/bin/bash` | `1000` / `2026-08-13 01:11:55` / `ABSENT/UNKNOWN` | Konsole; no children | `UNKNOWN` | `/home/belphareon/Projects/intentsmith` |
| `2716498` | adb fork-server | `1000` / `2026-08-17 23:03:14` / `ABSENT/UNKNOWN` | user-systemd | `app-code-2134440.scope` | `/home/belphareon/worktrees/is-mobile-prototype-codex` |

D041 neposkytuje autoritu k `kill`, `pkill`, signálu, cgroup/systemd zásahu,
ADB/Konsole zásahu, `chdir`, uzavření FD, odstranění worktree ani jiné cleanup
akci. Konflikty smí odstranit pouze external user mimo tuto authority.
Samotné zmizení těchto historických PIDů nikdy není důkaz readiness: fresh
run musí znovu enumerovat system-wide cwd/root/fd/maps/locks a všechny jiné
relevantní handly.

`/root/decision040_review_b` je od vydání `NOT_READY` permanentně fenced.
Nesmí dostat follow-up, být reaktivován ani provést další Git/direct metadata,
private nebo process-state read; v U41 zůstává jen jako excluded historical
identity.

## 3. D040 terminal supersession a selective inheritance

První identity mimo exact D040 U40 byla
`/root/decision041_architect`. Vznikla před aktivací D040 lease, takže podle
D040 §8 nastal terminal identity drift. D040 konečný stav je:

```text
SUPERSEDED_BEFORE_LEASE / TERMINAL_STOP /
PRELEASE_IDENTITY_UNIVERSE_DRIFT
```

D040 CREATE/VERIFY zůstávají historicky `UNMINTED`, promotion/create counts
zůstávají `0`, launch flags `false` a lease nikdy nebyl aktivovaný. Authority je
`FORECLOSED_UNCONSUMED`: nebyla spotřebovaná childem, ale už ji nelze aktivovat.
Token, lease, committer, lock reason, baseline ani verifier handoff D040 se
nesmí recyklovat, přejmenovat na D041 nebo přijmout jako D041 evidence.

D041 selektivně inkorporuje D040 §4, §6 a §7 pouze jako algoritmus
promotion-to-create a post-create closure, s úplnou substitucí všech authority
identifikátorů podle §5 tohoto rozhodnutí. D040 Review-B final baseline se
nenahrazuje tvrzením; zůstává immutable red input. Jeho funkci pro nový run
přebírá jediný fresh D041 readiness verifier podle §6.

D040 Decision/WP/report, D039 terminal red, B37, common config/info/mount,
frozen private OLD/evidence/no-seal a authentic red recorder zůstávají
immutable pins. Private root zůstává
`/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v5-20260818T083250Z.56131a74`;
plan/runner/strategy SHA jsou
`c4764b58e9e8d492f5736e9195486a51d5352aa3de5999f6501a18c923b2c5ca`,
`0d02ddb9ab420ca785b3255ec50eb58fca5920d58811dc31a949b8c6a73505cb`
a `26898ebc89930c8319e028e983c008f326b2e06600181cf50d17096b54474a4d`.

## 4. Exact roles, U41 a fencing

Live D041 roles jsou writer `/root/decision041_writer`, Review A
`/root/decision041_review_a`, Review B `/root/decision041_review_b`, contract
adversary `/root/decision041_adversary`, architect
`/root/decision041_architect`, sole issuer/promoter/creator `/root`, one-shot readiness
verifier `/root/v5_d041_prelease_readiness_verifier` a post-create verifier
`/root/v5_d040_source_checkout_verifier`.

Exact sorted 42-entry universe `U41` je U40 plus právě šest D041 identities:

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
/root/v5_formal_preseal_review
/root/v5_materializer
```

Žádná sedmá D041 identity před uzavřením lease není dovolena. Superseded
`/root/v5_d040_source_checkout_materializer` zůstává pouze forbidden identity.

Každý holder používá exact 41-entry exclusion set, mechanicky definovaný takto:

- readiness holder: sorted `U41` bez
  `/root/v5_d041_prelease_readiness_verifier`;
- root holder: sorted `U41` bez `/root`;
- post-create holder: sorted `U41` bez
  `/root/v5_d040_source_checkout_verifier`.

Set musí být před každým transferem byte-materializovaný a count musí být
právě 41; set algebra není dovoleno rozšířit o ambientní identitu. Review B po
svém report-only commitu a static/candidate handoffu končí a je fenced. Před
readiness runem jsou fenced také writer, adversary a architect. Readiness po
handoffu fence-ne sebe; root po post-create transferu už nic nečte. Fenced role
se nesmí reaktivovat k Git/direct metadata, private nebo process-state accessu.

## 5. Fresh D041 namespace a exact command pins

Fresh authority identifikátory jsou:

```text
D041-PRELEASE-READINESS-01
D041-CREATE-01
D041-VERIFY-01
D041-H0V5-DETACHED-SOURCE-CHECKOUT-LEASE-01
```

Committer je `M1-D041-Worktree` / `m1-d041-worktree@localhost`; lock reason je
`Decision041-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e`.
Compact JSON+LF pins jsou:

| Input | Elements / bytes | SHA-256 |
|---|---:|---|
| CREATE14 | `14` / `339` | `c4bdf8db268a75474aa066ed8ad6782cda5bb748947704b1b24fb918dacc5205` |
| READ15 | `15` / `362` | `938f6d523967cfcc9789f2369ce90945bd13edd43ebe046dd3eac1ff6ab4be74` |
| CONFIG15 | `15` / `393` | `e14729066081dd6608f29e1fb13cfd589da19d1ae168f4b13847a2e546040085` |
| CREATE argv | `59` / `1171` | `5d0a37198ba277c2b74081c132d6badd14f0d8bc4a41566478f5833e60874a51` |
| promotion template | `53` / `953` | `2fa17f2b2453ebbba32c3d3c1bf6f51b1ac7d82d7893682c05d7a1df84620cd8` |
| locked payload reason+LF | `1` / `80` | `6a7aca0e88869ffab2f605f019eb3509de29ad83100a5a9784b687e48afdaa24` |

READ15 je CREATE14 s `GIT_OPTIONAL_LOCKS=0` vloženým bezprostředně před D041
committer name/email. CONFIG15 zůstává ordered exact D040 CONFIG15.

Promotion template má právě 53 elements: `/usr/bin/env -i`, ordered CREATE14,
`/usr/bin/git -C` canonical, každý CONFIG15 jako ordered `-c` pair a tail
`merge --ff-only --no-edit <full-E_B_H0V5SRC041-sha>`. Fully substituted
compact JSON+LF má 968 bytes; readiness handoff musí připnout jeho SHA-256 a
skutečné argv. Jediná substituce je poslední element.

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
  "GIT_COMMITTER_NAME=M1-D041-Worktree",
  "GIT_COMMITTER_EMAIL=m1-d041-worktree@localhost",
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
  "<full-E_B_H0V5SRC041-sha>"
]
```

CREATE je exact D040 59-element command se všemi D041 substitutions:

```bash
(
  umask 077
  exec /usr/bin/env -i \
    PATH=/usr/bin:/bin \
    LANG=C LC_ALL=C TZ=UTC \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false \
    SSH_ASKPASS=/bin/false SSH_ASKPASS_REQUIRE=never \
    GIT_NO_LAZY_FETCH=1 GIT_ATTR_NOSYSTEM=1 \
    GIT_COMMITTER_NAME=M1-D041-Worktree \
    GIT_COMMITTER_EMAIL=m1-d041-worktree@localhost \
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
      --reason Decision041-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e \
      /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343 \
      df1863439b6ad83abf41396ba8063e5bffaa599e
)
```

Command nemá force, branch creation, optional-lock suppression, cleanup,
prune, unlock, repair, alternate target ani retry. Promotion nemá umask.

## 6. Exactly one fresh prelease readiness run

Readiness se smí spustit až po external user potvrzení, že konflikty odstranil,
nikdy jako poll. `/root` bez Git/direct metadata/process readu task-channelem
issue a activate-ne `D041-PRELEASE-READINESS-01`. Orchestrator v témž boundary
atomicky aktivuje exact D041 lease generation `1` a předá sole holdera exact
`/root/v5_d041_prelease_readiness_verifier`. Verifier i všechny jeho subprocessy
startují z exact neutral cwd `/`, používají absolutní paths a žádný child cwd
nesmí ležet pod common/worktree/private scope. První read spotřebuje jediný
pokus; každý Git read používá D041 READ15 +
`/usr/bin/git --no-optional-locks -C` exact checkout.

Verifier fresh od nuly a bounded způsobem recompute-ne:

1. D041 B/S/E_A/C/E_B topology, trees, exact four subject paths a six-line
   report; D040 immutable blobs/report a terminal supersession;
2. canonical exact `c38e1b24849521b41025e70a37bf0219466c9d1e`, clean expected
   ff-only destination E_B41 a fully substituted promotion argv;
3. local B37 commit/tree/object closure bez replace/promisor/alternate;
4. target/admin any-type absence, non-symlink parents, no alias/ref/worktree
   collision, zero relevant lock files a no relevant open-handle conflict;
5. system-wide `/proc` enumeration všech process cwd/root/fd/maps, open handles,
   locks, cgroups a relevant descendants; není dovoleno jen rechecknout známé
   historical PIDs;
6. common config/info/mount typed pins, refs/objects a full common-Git plus
   pre-existing-worktree before manifest;
7. frozen private OLD/evidence/no-seal/red pins bez private write;
8. exact D041 tokens, U41/exclusions/quiescence, CREATE14/READ15/CONFIG15,
   create/promotion argv a allowed canonical/target/admin delta manifests.

Použije inherited D040 canonical serializer a ordered transcript, ale vytvoří
nové component digesty a nový aggregate record count/digest. Historical D040
61-record transcript `ad6d82955efc582edb83161b19a6ca1fb14a82eac58c4a5fcfb9147f08d54f0b`
a všechny §2 component hashes jsou jen incident evidence, nikdy live baseline.
Nové task-channel baseline bytes jsou jediný before-state pro post-verifier.

Jeho poslední Git/direct metadata/process-state reads musí uzavřít complete
baseline; potom už provede jen task-channel handoff a fence. Handoff existuje
výhradně pro `PRELEASE_READY / COMPLETE`, byte-bindne celý baseline, fully
substituted E_B41 command a lease generation, spotřebuje readiness token jako
`CONSUMED-PASS` a atomicky fence-ne readiness holdera při transferu téhož
lease na root;
CREATE/VERIFY jsou dál `UNMINTED`. Observable mismatch je `NOT_READY`; audit,
který nelze dokončit, je `BLOCKED`; dispatch/launch/outcome/holder transfer,
který nelze prokázat, je `UNKNOWN`. V každém non-PASS/unknown outcome se
readiness token spotřebuje, CREATE/VERIFY jsou `CANCELLED_UNISSUED`, lease se
uzavře a D041 retry je navždy foreclosed. Partial/stale handoff je absent.

Readiness není monotonic wait, polling loop ani oprávnění čekat na zmizení PIDu.
Má právě jeden attempt a jeden terminal verdict.

### 6.1 Readiness state table

| Boundary | readiness token | attempt / launch / outcome | CREATE / VERIFY | lease / next action |
|---|---|---|---|---|
| E_B PASS, před external cleanup notification | `UNMINTED` | `0` / `false` / absent | `UNMINTED` / `UNMINTED` | inactive; žádný read |
| issued+activated, před verifier child | `ISSUED_AND_ACTIVATED` | `0` / `false` / absent | `UNMINTED` / `UNMINTED` | generation 1, readiness holder; child musí být next scoped access |
| known launcher/pre-child failure | `CONSUMED` | `0` / `false` / `NO_RUN` | `CANCELLED_UNISSUED` / `CANCELLED_UNISSUED` | closed; terminal |
| dispatch/launch nelze prokázat | `CONSUMED` | `UNKNOWN` / `UNKNOWN` / `UNKNOWN` | `CANCELLED_UNISSUED` / `CANCELLED_UNISSUED` | closed; terminal |
| launch prokázán, outcome nelze prokázat | `CONSUMED` | `1` / `true` / `UNKNOWN` | `CANCELLED_UNISSUED` / `CANCELLED_UNISSUED` | closed; terminal |
| complete observed conflict/drift | `CONSUMED` | `1` / `true` / `NOT_READY` | `CANCELLED_UNISSUED` / `CANCELLED_UNISSUED` | closed; terminal |
| incomplete tool/permission/schema audit | `CONSUMED` | `1` / `true` / `BLOCKED` | `CANCELLED_UNISSUED` / `CANCELLED_UNISSUED` | closed; terminal |
| complete clean closure | `CONSUMED-PASS` | `1` / `true` / `PRELEASE_READY/COMPLETE` | `UNMINTED` / `UNMINTED` | same generation 1 lease transferred to root; promotion next Git child |

`UNMINTED` je pouze live stav. Po issuance je readiness token při každém
terminal outcome spotřebovaný. Attempt/launch jsou `1`/`true` pouze při
prokázaném child launchi, `0`/`false` při prokázaném no-spawn a
`UNKNOWN`/`UNKNOWN`, když hranici nelze prokázat. Stav se nesmí odvozovat z
absence procesu, outputu, targetu nebo admin pathu.

## 7. Uninterrupted transfer, promotion, CREATE a post-verifier

Pouze complete task-channel `PRELEASE_READY` dovolí atomický holder transfer
readiness verifier → `/root` bez lease gapu. Root po handoffu nesmí provést
preflight, discovery, Git/libgit2/JGit read, direct common metadata/filesystem
read ani process inspection.

Root provede jediný exact 53-element ff-only promotion. Pokud launcher selže
před childem, launch je `false` a count `0`; při neprokazatelném dispatchi jsou
count/launch/outcome `UNKNOWN`; při prokázaném launchi je count `1` a launch
`true`. Každý nonzero, signal, timeout nebo unknown outcome je terminal,
CREATE/VERIFY jsou `CANCELLED_UNISSUED` a nic dalšího se nespustí.

Při exact promotion exit `0`/no-signal root issue+activate-ne
`D041-CREATE-01`; bez jediného intervening Git/direct metadata accessu musí být
exact CREATE velmi další Git child. Launch mění create count `0 → 1` a launch
`false → true`. Issued CREATE se při každém terminal outcome spotřebuje.
Nonzero/signal/timeout/unknown/partial/race je terminal STOP/FREEZE bez retry,
cleanup, prune, unlock nebo alternate target. Exit `0` vytváří pouze
`CREATE_COMPLETED_UNVERIFIED`; exit sám nedokazuje absenci external race.

Pouze exact create exit `0`/no-signal dovolí issue+activate
`D041-VERIFY-01` a atomický holder transfer `/root` → existující
`/root/v5_d040_source_checkout_verifier`. Tato identity nesmí přijmout D040
token ani D040 READ15; pro tento run používá výhradně fresh D041 token,
D041 READ15/CONFIG15, D041 committer/lock a D041 baseline. Root před transferem
ani potom neprovede post-read a nevydá PASS.

Post-verifier jedním read-only runem recompute-ne celý inherited D040 closure:
promoted D041 DAG/report, exact root transcript a Git-child adjacency, detached
B37/tree, ignored-aware clean streams, stage/tree equality, 1 614-leaf
FS/blob/executable closure, same-FD no-follow admin index/info/config before i
after, known controls včetně D041 locked payload, refs/objects/config/common
Git/pre-existing worktrees proti readiness baseline jen s exact promotion +
target/admin delta, a private no-touch. Complete mismatch je
`CHANGES_REQUIRED`; incomplete audit je `BLOCKED` s absent handoff. VERIFY se
v každém outcome spotřebuje a lease se uzavře. Pouze verifier-owned PASS
odemyká původní D037 private materializer authority.

Jakýkoli external access/race během lease je terminal violation bez ohledu na
command exit. Fencing a holder transfer jsou task-channel fakta; nesmějí být
nahrazena root self-observation.

## 8. Acceptance matrix a negative fixtures

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

Negative fixtures jsou exact:

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

Každá fixture independently failne. Docs author/reviewer je modelují pouze nad
isolated synthetic bytes; nespouštějí je proti live processes/common Git/
private rootu.

## 9. Exact four-doc DAG, report a gates

Subject allowlist je exact:

1. `docs/decisions/041-m1-h0-v5-detached-source-checkout-prelease-readiness-remediation.md`
2. `docs/execution/m1-batch.md`
3. `docs/wp/README.md`
4. `docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-PRELEASE-READINESS-REMEDIATION.md`

Reserved report je na B41 i subjectu absent:

```text
docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-prelease-readiness-remediation-20260818-report.md
```

DAG je `B41 → S_H0V5SRC041 → E_A_H0V5SRC041 → C_H0V5SRC041 →
E_B_H0V5SRC041 → canonical --ff-only`. Review A direct child subjectu vytvoří
jen exact four-line report. Candidate má ordered parents `[B41,E_A]` a exact
E_A tree. Review B direct child candidate připojí jen dvě řádky; provede pouze
static/candidate audit a potom je fenced. Operational baseline vlastní až
one-shot readiness verifier.

Report po Review B má právě šest LF-terminated řádků:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: d0a1c91c76eea039dddf428e57cd758c26a9c81f
subjectHead: <full-S_H0V5SRC041-sha>
reviewA.verdict: PASS
candidateHead: <full-C_H0V5SRC041-sha>
reviewB.verdict: PASS
```

Subject má 1 625 paths; E_A/C/E_B po přidání reportu mají 1 626. Precommit
vyžaduje dva fresh zero-based audits `PASS/P0=0/P1=0`. Před/po subject commitu
se ověří exact B41/tree/clean writer, four paths/report absence, D040 immutable
bloby/report, incident/supersession/U41/matrix/fixture parity, exact placeholder
allowlist a command hash recomputation, artifact validation, registry, hygiene
a `git diff --check`.

Allowed angle-bracket metavariable occurrences jsou právě sedm: v Decision
token `full-E_B_H0V5SRC041-sha` dvakrát, `full-S_H0V5SRC041-sha` jednou a
`full-C_H0V5SRC041-sha` jednou; ve WP stejné tři tokeny právě jednou. Jiný
angle-bracket token nebo počet je red.

Non-PASS nevytvoří candidate ani operational authority. Push, tag, release,
force, rebase, cherry-pick, amend a history rewrite jsou zakázané.

Dokud nejsou oba fresh precommit audity PASS:

```text
D040: SUPERSEDED_BEFORE_LEASE / TERMINAL_STOP / FORECLOSED_UNCONSUMED
D041: UNCOMMITTED FROZEN SUBJECT / NO OPERATIONAL AUTHORITY
D037 PRIVATE REPAIR: BLOCKED_BEFORE_TRANSACTION / UNCONSUMED
V5: PRESEAL_CHANGES_REQUIRED / UNSEALED / DO NOT EXECUTE
RUNTIME / ACCEPTANCE / T3 / GATES: NO AUTHORITY
```
