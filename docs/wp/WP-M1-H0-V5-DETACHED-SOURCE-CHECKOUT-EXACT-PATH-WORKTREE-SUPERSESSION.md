# WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION

**Výsledek:** fresh four-doc governance-only D047 supersession, která z exact
canonical B44 zachová D044/D045/D046 jako immutable historical nonauthority,
opraví D046 full-path a required-worktree-row P1 a otevře fresh review/DAG/
protocol chain. Nemá runtime, source, target/admin, sudo, token, promotion,
push ani cleanup authority.

**B47:** b013bd6fe28c691953ea2d9daa925435b479d8d4

**B47 tree / parent / paths:**
78cd0daf4451c42de4e2dbd668d21500c1bd5fdf /
deb5a306568cc6c5247c5f4714be07198f20d94e / 1632

**Stav subjectu:**
DRAFT_PENDING_FRESH_REVIEW_A_B / NO_OPERATIONAL_AUTHORITY / REPORT_ABSENT

## 1. Historical red se nesmí prát

D043 validní docs E_B byl rootem předčasně, ale ff-only, local promoted na B44.
Akce je ROOT_PREMATURE_CANONICAL_FF / NO_OPERATIONAL_VOTE; source operation pod
validní authority neproběhla. B44 zůstává canonical bez rollbacku.

D044 exact side-DAG je:

| Node | Commit | Tree | Paths |
|---|---|---|---:|
| S44 | 2a21ee8c9e49db174abef4fa34b373f72929b1e7 | ed21c3fae16730d465d77be0f9cd7ee383b0fd1e | 1634 |
| E_A44 | 66cdb0fdbf27b2e21a62161131a711d59f416cad | 7dc8c8549075cbffad67400095db63755e9efe14 | 1635 |
| C44 | a43c0ecc6e37fc4042ba4d531f8656268798f5c7 | 7dc8c8549075cbffad67400095db63755e9efe14 | 1635 |
| E_B44 | d4a49cabaecf027d3c009b634a03f1d49897ce6f | 6bc9a15ed0ee58b302b115fdcb1ff1e7e1fae4d2 | 1635 |

Ordered parents jsou [B44], [S44], [B44,E_A44], [C44]. D044 manifest je
877B/1LF/SHA-256
9a2d41b5cfa40f20d0699ac1b5a0ce50d56942f8142f6688c8dea7934533191e.
Report blob add026dcb6a9fb3cf5654d620cbc68627c912f6e je
262B/6LF/SHA-256
5151f5e11b7101bb046f39004764d88478a4f4d54491877f5562c4a4522ad439.
Textual PASS rows jsou invalidní votes.

/root/decision043_architect/runtime_gate_audit existovala před D044 final
manifestem, četla mutable material a ovlivnila formulace, ale nebyla v U44.
Je PRE_VOTE_OMISSION / OUT_OF_AUTHORITY / NO_VOTE. Její complete reads/tools/
timing/footprint jsou UNKNOWN. /root/decision043_architect/source_preflight
vznikla až po dual PASS, root ji interruptnul running před message/output/
verdict/vote a actual reads/tools/side effects zůstávají UNKNOWN. Je
POST_DUAL_PASS_DRIFT / OUT_OF_AUTHORITY / NO_VOTE. Obě jsou permanently
fenced. D044 objects/report se zachovají, ale nepromují ani nereuse-nou.

D045 staged manifest je 881B/1LF/SHA-256
df1b6e5c5529769ac49b856c017d1232b0f6790c18ad5e7b663862fedd7d9d33.
Review B vydal CHANGES_REQUIRED / P0=0 / P1=1 pro sloučení pre-vote a
post-PASS chronologie; Review A skončila po 100% readu STOPPED / NO_VOTE.
D045 nemá commit/report/DAG.

D046 staged manifest je 867B/1LF/SHA-256
557b58c8c2ebba42bfb73fb12ce16299a11c8e5f29fcfecfc34a1eb34c9ce8c5;
čtyři blobs mají 138483B/2273LF. Review B vydal
CHANGES_REQUIRED / P0=0 / P1=2 a Review A po 100% readu se stejnými dvěma
provisional P1 skončila STOPPED / NO_VOTE:

1. D046 neuvedla literal full paths dvou odstraněných root mistarget souborů.
2. D046 neuvedla literal D045 worktree/admin, ačkoli vyžadovala jeho runtime row.

D046 nemá commit/report/DAG. D045 ani D046 staged bytes nejsou D047 tree,
vote, token nebo operational input.

## 2. Exact D046 full-path repair a limited proof

Exact odstraněné D046 objects byly:

| Literal full path | Bytes | LF |
|---|---:|---:|
| /home/belphareon/Projects/docs/decisions/046-m1-h0-v5-detached-source-checkout-chronology-supersession.md | 23656 | 490 |
| /home/belphareon/Projects/docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-CHRONOLOGY-SUPERSESSION.md | 13544 | 304 |

Root je vytvořil před D046 stagingem a odstranil přes apply_patch před stagingem.
Při D047 inventory jsou oba literal paths lstat-absent. Current absence je jen
limited negative proof: historical SHA/blob/inode/timestamps, complete syscall/
tool footprint a broader host effects jsou UNKNOWN. Pozorovaný zero repo/index/
canonical/existing-file/target/admin delta není full-host zero-effect proof.
Incident zůstává ROOT_PATCH_PATH_MISTARGET / NO_VOTE.

## 3. D047 writer mistarget disclosure

/root/decision047_writer vznikl před D047 authoringem a je literal člen U47.
První patch vytvořil mimo D047 právě:

| Literal full path | Bytes | LF | Reconstructed SHA-256 |
|---|---:|---:|---|
| /home/belphareon/Projects/docs/decisions/047-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession.md | 29353 | 553 | 78dfe3c5c624c8491b84de8ddf8a89b3082c08ede4367726a527d0cfae39a4cd |
| /home/belphareon/Projects/docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION.md | 15753 | 336 | e5bee8baad2bbf08acb5da59a8d66df52e0a9a86cec02dd34fa90eff0c736d31 |

Retained exact add-file patch payload dovoluje byte-for-byte reconstruction
včetně terminal LF; pre-delete measurement ověřil stejný bytes/LF/SHA vector.
Writer je zjistil před stagingem, jedním apply_patch odstranil oba exact
relative targets a delete tool vrátil success. Root ověřil oba absolute paths
current lstat-absent a D047 worktree B44/porcelain empty/index1632.
Klasifikace je D047_WRITER_PATH_MISTARGET / NO_VOTE. Exact timestamps,
apply_patch internals/syscalls/temp strategy, transient inode/dir metadata/cache,
scheduler footprint a broader host effects jsou UNKNOWN. Není to host-zero-
effect proof a removed objects nejsou candidate input.

## 4. Owned scope

WP smí změnit právě:

    docs/decisions/047-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession.md
    docs/execution/m1-batch.md
    docs/wp/README.md
    docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION.md

Reserved report musí na B47 i S47 zůstat any-type absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-report.md

Authoring branch je fresh z B47:

    docs/m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer

/root/decision047_writer je jediný docs writer, není reviewer/issuer a po
hard-freeze se permanentně fence-ne. Root zůstává sole issuer/DAG creator/
promoter/operation creator a docs needituje.

Zakázané: jiná tracked cesta, D044/D045/D046 mutation, helper/source/runtime/
import, temp/cache/private/evidence, final target/admin, sudo/process-control,
write-tree, commit, promotion, push/tag, cleanup, reset/revert/cherry-pick/
rebase/history rewrite. Jediná index-write výjimka je jedno git add -- exact
four paths po self-review.

## 5. Exact preexisting worktree/admin states

| Generation | Worktree | Common-Git admin | Branch | HEAD / index / delta |
|---|---|---|---|---|
| D045 | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-writer | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-writer | docs/m1-h0-v5-detached-source-checkout-identity-universe-supersession-20260820-writer | B44; index1634 exact df1b A/M/M/A; unstaged0; untracked0 |
| D046 | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer | docs/m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer | B44; index1634 exact 557b A/M/M/A; unstaged0; untracked0 |
| D047 | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer | docs/m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer | B44; preauthoring index1632 clean; hard-freeze index1634 final manifest A/M/M/A; unstaged0; untracked0 |

Future materialization musí v existing readiness/post captures obsahovat šest
literal rows FS47_D045_AUTHORING_WORKTREE, FS47_D045_COMMON_GIT_ADMIN,
FS47_D046_AUTHORING_WORKTREE, FS47_D046_COMMON_GIT_ADMIN,
FS47_D047_AUTHORING_WORKTREE a FS47_D047_COMMON_GIT_ADMIN.

Každý row je required v readiness A i post B a musí mít A == B na literal
path/type/stable identity/HEAD/ref/index semantics a staged/unstaged/untracked
vectoru. Missing/extra/duplicate/alias/generic-parent/short path/A-B mismatch
fail-close blokuje. Rows jsou preexisting state, ne operation delta nebo nové
direct children. Final external D047 handoff manifest je exact self-pin D047
staged vectoru.

## 6. Fresh U47 a role

U47 je exact U46 plus /root/decision047_writer: 61 sorted unique identities a
60 exclusions per holder. Decision047 §7 obsahuje normativní full vector.
Missing, extra, duplicate, alias, shortened nebo self entry blokuje.

| Role | Identity |
|---|---|
| D047 docs writer; post-freeze fenced | /root/decision047_writer |
| fresh Review A | /root/decision043_architect/decision043_adversary |
| fresh Review B/post-create/packet | /root/mount_stack_reviewer |
| source architect/materializer | /root/decision043_architect |
| sole issuer/DAG/promoter/operation creator | /root |
| distinct source verifier | /root/v5_d044_source_checkout_verifier |

runtime_gate_audit a source_preflight jsou permanently fenced incidents.
Review A/B začnou byte zero. Fresh namespace je D047-only; jakékoli D044/D045/
D046 token/lease/holder/vote/tree/result/acceptance pole je stale a blokuje.

## 7. Fresh docs DAG

    B47/B44 -> S47 -> E_A47 -> C47 -> E_B47 -> canonical --ff-only

S47 má exact A/M/M/A a 1634 paths. E_A/C/E_B mají 1635 paths a mění jen
reserved report. E_A je child S47; C47 ordered parents [B47,E_A47] a exact
E_A tree; E_B child C47. Fresh Review A/B vyžadují PASS/P0=0/P1=0. Distinct
post-create gate ověří DAG/report/scope/required worktree rows; jen PASS dovolí
ff-only B47→E_B47. Materialization začne až po clean post-ff pin.

Report má exact šest LF-terminated řádků:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: b013bd6fe28c691953ea2d9daa925435b479d8d4
    subjectHead: <full-S47-sha>
    reviewA.verdict: PASS
    candidateHead: <full-C47-sha>
    reviewB.verdict: PASS

## 8. Unchanged folded operation

D047 fresh přijímá static D044 Decision blob
4b6f7c66b142770fdf6e1ca87a3398b8829b7b6d /
61b2994295d6555b05a76ea02e5b313452aab982d7bb991d21835763fbd4d61e
jen jako specification s D47 replacements.

Exact counts:

    directGitChildren=37
    directSupervisorGitChildren=37
    gitChildren=37
    gitReadinessLedger=18
    gitPostLedger=18
    rootWriteChildren=1
    directWriteGitChildren=1
    rootWriteLedger=1
    logicalProbeOperations=38
    readinessProbeLedger=18
    postProbeLedger=20
    coveragePredicates=24
    executionStageLedger=16
    expectedInternalGitDescendants=1

EX01–09 ověří E_B47 a preexisting rows; EX10 má jediný RW01_CREATE a po EX09
před Popen není gap; EX11–16 uzavřou post. Direct order R01–18,RW01,P01–18.
Logical DR01–18+DP01–20 zůstává 38; DP20 je pure join. CV01_D047_DAG,
CV07_CANONICAL_ALREADY_PROMOTED_STABILITY a CV08_TARGET_IDENTITY nahradí self
names; jediný rootRowId je RW01_CREATE.

CREATE source commit/tree, final target/admin/lock, uid/gid/groups, closed
16-key env/config/stdin/cwd/timeout/reap/result a one expected internal reset-
hard descendant zůstávají exact podle Decision047 §10. Partial se neuklízí,
neretryuje ani nepřesměruje.

## 9. Launcher, TCB a terminal truth

External protocol vydá jeden ASCII one-line paste bez LF, max4096B. Stage0 a
root-loader Python -c mají každý max131071B; max+1 blokuje. Same-FD
O_NOFOLLOW|O_NONBLOCK chain je stage0→transport→root-loader→B→D→A.
Transport-owned execve účtuje argv/env/NUL/env=/pointer table a vyžaduje:

    outerArgvEnvAccountedBytes + 65536 < runtimeScArgMax

Equality blokuje; runtime SC_ARG_MAX je fresh measured external pin. Sudo/PAM/
SUDO_COMMAND internals jsou EXTERNAL_BROKER_TCB. Authority graph je acyclic:

    pre-frozen pins -> A -> D -> B -> root-loader -> transport
      -> stage0 -> command -> external protocol

A47 nepinuje later derived actuals. External protocol jediný váže všechny
actual component bytes/SHA/argv/accounting/command. Leaf8c SHA
8c3081b88af6538fa9079042747d700340cc80b872d7ca06ef1c17e3e12134da je
PINNED_SYSTEM_PROBE_TCB; verifier bez preimages/counter ledgeru netvrdí
FULL_HASH_RECOMPUTED ani CUMULATIVE_LIMITS_INDEPENDENTLY_SUMMED.

Canonical, six preexisting rows a private roots musí mít zero delta. Allowed
delta je jen exact final target/admin + expected metadata/index/log/worktree
census +1. Před ROOT_ENTERED: BLOCKED/NOT_READY/UNKNOWN_OPEN. Po ROOT_ENTERED
jakákoli incomplete/unknown/exception je VERIFY_INCOMPLETE/CLOSED_FREEZE.
Complete mismatch je CHANGES_REQUIRED; jen complete zero distinct verifier je
PASS. Docs/report/promotion/materialization/readiness/CREATE exit0 nejsou
source/M1/H0/runtime DONE.

## 10. Acceptance, negative suite a handoff

Acceptance je R47-01..R47-18 a negative suite F47-01..F47-22 z Decision047.
Zvlášť musí projít:

- D044 9a2/DAG/report a two-stage incident chronology jako NO_VOTE;
- D045 df1b/P1=1/stopped A a D046 557b/P1=2/stopped A;
- exact D046 full mistarget paths/current-absence limited proof;
- D047 writer mistarget reconstructed vector/UNKNOWN/NO_VOTE;
- exact D045/D046/D047 rows, U47 61/60, A/M/M/A a report absence;
- fresh DAG/reviews/post-create gate/namespace;
- 37 direct/1 write/38 logical/18+20/24CV/16EX;
- one-row EX10, short launcher, strict ARG_MAX, acyclic TCB;
- canonical/preexisting zero delta a exact target/admin-only post delta.

Writer self-reviewne exact four docs, jedním git add -- je stage-ne, vydá
path-sorted compact JSON+LF manifest z index blob reads bez write-tree a
permanentně se fence-ne. Handoff není vote/commit/report/promotion/operation/
runtime PASS. Další efekt vyžaduje fresh authority a complete evidence chain.
