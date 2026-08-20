# 047 — Fresh exact-path/worktree supersession pro poslední M1/H0 source checkout

- **typ:** exact four-doc governance-only supersession; žádný runtime, helper,
  private, target/admin, evidence, sudo, process-control ani push efekt
- **stav subjectu:** DRAFT_PENDING_FRESH_REVIEW_A_B / NO_OPERATIONAL_AUTHORITY /
  REPORT_ABSENT
- **integrationRef:** integration/m1-consolidated-20260810
- **baseRevision / B47:**
  b013bd6fe28c691953ea2d9daa925435b479d8d4
- **baseTree / paths:**
  78cd0daf4451c42de4e2dbd668d21500c1bd5fdf / 1632
- **D044 ruling:** B / P0=1 / IDENTITY_UNIVERSE_DRIFT /
  AUTHORITY_INVALID / BOTH_DOCS_VOTES_NO_VOTE
- **D045 ruling:** REVIEW_B_CHANGES_REQUIRED / P0=0 / P1=1 /
  INCIDENT_CHRONOLOGY_DRIFT / NO_VOTE
- **D046 ruling:** REVIEW_B_CHANGES_REQUIRED / P0=0 / P1=2 /
  EXACT_PATH_AND_REQUIRED_WORKTREE_ROW_DRIFT / NO_VOTE

D047 nic nemaže ani zpětně neopravuje. Začíná přímo z canonical B44,
zachovává D044 side-DAG/report a D045+D046 staged kandidáty jako immutable
historical nonauthority a vytváří vlastní fresh docs, reviews, DAG, namespace
a případnou pozdější operaci. D047 přebírá pouze static technický design D044,
nikdy její vote, PASS, tree, token, materialized bytes ani holder state.

## 1. Canonical B47 je exact B44

Canonical local ref integration/m1-consolidated-20260810 ukazuje na
b013bd6fe28c691953ea2d9daa925435b479d8d4. Jeho parent je
deb5a306568cc6c5247c5f4714be07198f20d94e, tree
78cd0daf4451c42de4e2dbd668d21500c1bd5fdf a tracked path count 1632.
Poslední canonical reflog entry zůstává D043 premature ff-only z
c38e1b24849521b41025e70a37bf0219466c9d1e na B44 v
2026-08-20T01:55:56+02:00. Žádný D044 commit v canonical reflogu není.

D043 docs/DAG/metadata zůstávají validní, dual-reviewed a local canonical.
Premature promotion je ROOT_PREMATURE_CANONICAL_FF / NO_OPERATIONAL_VOTE;
D043 source operation neběžela pod validní authority. B44 je immutable base
D47, nikoli rollback target.

## 2. D044 je preserved historical nonauthority

Exact D044 side objects jsou:

| Node | Commit | Ordered parents | Tree | Paths |
|---|---|---|---|---:|
| S44 | 2a21ee8c9e49db174abef4fa34b373f72929b1e7 | [B44] | ed21c3fae16730d465d77be0f9cd7ee383b0fd1e | 1634 |
| E_A44 | 66cdb0fdbf27b2e21a62161131a711d59f416cad | [S44] | 7dc8c8549075cbffad67400095db63755e9efe14 | 1635 |
| C44 | a43c0ecc6e37fc4042ba4d531f8656268798f5c7 | [B44,E_A44] | 7dc8c8549075cbffad67400095db63755e9efe14 | 1635 |
| E_B44 | d4a49cabaecf027d3c009b634a03f1d49897ce6f | [C44] | 6bc9a15ed0ee58b302b115fdcb1ff1e7e1fae4d2 | 1635 |

D044 frozen subject manifest byl compact JSON 877 bytes/1 LF se SHA-256
9a2d41b5cfa40f20d0699ac1b5a0ce50d56942f8142f6688c8dea7934533191e.
Jeho exact rows byly:

| Path | Mode | Blob | Bytes | LF | SHA-256 |
|---|---|---|---:|---:|---|
| docs/decisions/044-m1-h0-v5-detached-source-checkout-already-promoted-remediation.md | 100644 | 4b6f7c66b142770fdf6e1ca87a3398b8829b7b6d | 37715 | 734 | 61b2994295d6555b05a76ea02e5b313452aab982d7bb991d21835763fbd4d61e |
| docs/execution/m1-batch.md | 100644 | eb34622b2233d12f95e091fa9458aa7a58e73c45 | 73459 | 1241 | ec0772522fea9d499d8b662b10d91e306dc734bd4b6577504ae86d5c86ece632 |
| docs/wp/README.md | 100644 | 4e7a02429e30c8b6fbf1f7ed11be561b50a9d731 | 20168 | 138 | 95c2c55ecfbba0cd37b7a48d6bdb0cd83e157c6345291edd11d70c06cb2351e1 |
| docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-ALREADY-PROMOTED-REMEDIATION.md | 100644 | 57f46d726d1de28a84ffa6fb909c84dd8ec72007 | 12214 | 235 | 4059de9fe2ff71b1a10c91ae8e1bd20734583f821f51ae503f9baf06a882589e |

D044 report je mode 100644, blob add026dcb6a9fb3cf5654d620cbc68627c912f6e,
262 bytes/6 LF a SHA-256
5151f5e11b7101bb046f39004764d88478a4f4d54491877f5562c4a4522ad439.
Jeho preserved bytes jsou:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: b013bd6fe28c691953ea2d9daa925435b479d8d4
    subjectHead: 2a21ee8c9e49db174abef4fa34b373f72929b1e7
    reviewA.verdict: PASS
    candidateHead: a43c0ecc6e37fc4042ba4d531f8656268798f5c7
    reviewB.verdict: PASS

Textual PASS rows nejsou platné votes. U44 měla 58 sorted unique identities a
57 exclusions, ale neobsahovala:

    /root/decision043_architect/runtime_gate_audit
    /root/decision043_architect/source_preflight

runtime_gate_audit existovala před final manifestem 9a2d41b5, četla mutable
verifier/docs a její findings ovlivnily pozdější formulace. Formal vote
nevydala. Original spawn text/time, complete reads, exact tools a úplný
host/repo footprint jsou UNKNOWN. Jde o PRE_VOTE_OMISSION /
OUT_OF_AUTHORITY / NONVOTING / NO_VOTE / PERMANENTLY_FENCED; sama invaliduje
oba D044 votes.

source_preflight byla spawned až po D044 docs dual PASS. Spawn vrátil canonical
task path a root ji interruptnul ve stavu running; před interrupcí nevrátila
message, output, verdict ani vote. Task zakazoval edits/import/exec/live/Git a
parent ohlásil source beze změny, ale actual reads, byte ranges, tools, timing,
side effects a úplný footprint jsou UNKNOWN. Jde o POST_DUAL_PASS_DRIFT /
OUT_OF_AUTHORITY / NONVOTING / NO_VOTE / PERMANENTLY_FENCED.

D044 refs/objects/report se zachovají. E_B44 se nepromuje; nic se nemaže,
resetuje, revertuje, cherry-pickuje ani history-rewrite-ne. Current target/admin
absence není historical zero-attempt proof. Complete D044 materialization/token/
operation ledger není input; scratch, mint, issue, attempt, direct/internal
children a writes zůstávají NONAUTHORITY / NONREUSABLE / NO_PASS.

## 3. D045 staged historical nonauthority

D045 frozen staged manifest měl 881 bytes/1 LF a SHA-256
df1b6e5c5529769ac49b856c017d1232b0f6790c18ad5e7b663862fedd7d9d33.

| Path | Mode | Blob | Bytes | LF | SHA-256 |
|---|---|---|---:|---:|---|
| docs/decisions/045-m1-h0-v5-detached-source-checkout-identity-universe-supersession.md | 100644 | b5bd9097acc5aca7e438447663d2b45efa38d2cd | 23683 | 489 | 3581aed307821fb5ef7f4f7eeda3cd89a162f5e40dec03bc3d7ba7fbadf53ecb |
| docs/execution/m1-batch.md | 100644 | 100a438677a4e1c2dcf0ed26311083ae0a90a250 | 72868 | 1236 | 782b85ab2b9003dda0eca1ca355f961db034ea6edfc5641d8e690665d489ea6b |
| docs/wp/README.md | 100644 | 5b046c617e8fff38492ddcc6f5bb4c77c8d44c77 | 19992 | 138 | 58b6e823052171e147abaae94a5013f941dc94736fae6dd0e98746f85c173598 |
| docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-IDENTITY-UNIVERSE-SUPERSESSION.md | 100644 | 777706db9de72f484ea10a86250ae81ed132025c | 13578 | 303 | fed1edc51e52bcad1ab76422c1934e1e34546016014303766fb2f275d8c51183 |

Review B vydal CHANGES_REQUIRED / P0=0 / P1=1, protože všechny čtyři blobs
sloučily pre-vote runtime_gate_audit a post-PASS source_preflight do jedné
pre-vote chronologie. Review A měla 100% read a provisional zero findings,
ale byla po B findingu interruptnuta před final verdictem: STOPPED / NO_VOTE.
D045 nemá commit/report/DAG a /root/decision044_writer zůstává fenced.

Exact D045 preexisting state:

| Pole | Exact hodnota |
|---|---|
| worktree | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-writer |
| common-Git admin | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-writer |
| HEAD | b013bd6fe28c691953ea2d9daa925435b479d8d4 |
| branch | docs/m1-h0-v5-detached-source-checkout-identity-universe-supersession-20260820-writer |
| semantic index | 1634 paths; exact df1b vector; staged A/M/M/A |
| worktree delta | unstaged=0; untracked=0 |

## 4. D046 staged historical nonauthority a exact P1 repairs

D046 frozen staged manifest má 867 bytes/1 LF a SHA-256
557b58c8c2ebba42bfb73fb12ce16299a11c8e5f29fcfecfc34a1eb34c9ce8c5.

| Path | Mode | Blob | Bytes | LF | SHA-256 |
|---|---|---|---:|---:|---|
| docs/decisions/046-m1-h0-v5-detached-source-checkout-chronology-supersession.md | 100644 | 86c6a6a29603f211d383e02729eb8f56bbaaf2d8 | 29286 | 553 | 2ffd8dc7272c3905c2b792c1760e7cad4d71e47de4e160b2cafe8a3ac7ef8adb |
| docs/execution/m1-batch.md | 100644 | aa9693e8603d524b1248f35f915b20f176da6c75 | 73479 | 1246 | 6a76ed4246590482f543f655a62fee657479c848bf5169ab3168003311e7fb33 |
| docs/wp/README.md | 100644 | fa133c2e66694b8d6bb3d066539c3da6392f5ab2 | 20019 | 138 | 4487bf6e5c980a88225acd072d7e76b6efb090b817bacc14e89a83a4b95375ab |
| docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-CHRONOLOGY-SUPERSESSION.md | 100644 | a257b62c3ece54fa3cbe1e2fd66a4fc22d29bf81 | 15699 | 336 | 27e3ff907a85ab0a89ae5868e9427ae2b4bd920d17a8022659bae31c61cb5c59 |

Aggregate je 138483 bytes/2273 LF. Review B vydal
CHANGES_REQUIRED / P0=0 / P1=2:

1. Decision046:144-152, R46-06 a WP:78-84 tvrdily exact two-path cleanup
   boundary, ale uvedly jen parent /home/belphareon/Projects/docs, generic
   Decision/WP labels a measurements. Ani jeden full deleted pathname nebyl
   v žádném D046 blobu; current absence nemohla identifikovat historical
   deleted objects.
2. Decision046:157-165 připnula D046 worktree/admin, ale D045 označila pouze
   generic D045 staged worktree. Žádný blob neobsahoval literal D045 worktree/
   admin, ačkoli future authority vyžadovala oba exact runtime rows.

Review A po 100% readu nezávisle měla stejné dva provisional P1, ale root ji
interruptnul před final verdictem: STOPPED / NO_VOTE. D046 nemá commit/report/
DAG a nedodává tree, vote, token ani operational input.

Exact dva D046 root mistarget objects byly:

| Klasifikace | Literal full path | Bytes | LF |
|---|---|---:|---:|
| removed Decision copy | /home/belphareon/Projects/docs/decisions/046-m1-h0-v5-detached-source-checkout-chronology-supersession.md | 23656 | 490 |
| removed WP copy | /home/belphareon/Projects/docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-CHRONOLOGY-SUPERSESSION.md | 13544 | 304 |

Root je vytvořil prvním mechanical add-file pokusem před D046 stagingem a
odstranil přes apply_patch před stagingem. Při current D047 inventory byly oba
literal paths lstat-absent. To je pouze current absence a omezený záporný
důkaz. Historical bytes nebyly zachovány; SHA, blob, inode, exact timestamps,
complete syscall/tool footprint a broader host effects jsou UNKNOWN.
Pozorovaný zero index/Git-object/canonical/existing-file/D044/D045/target/admin
delta není full-host zero-effect proof. Incident je
ROOT_PATCH_PATH_MISTARGET / NO_VOTE.

Exact D046 preexisting state:

| Pole | Exact hodnota |
|---|---|
| worktree | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer |
| common-Git admin | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer |
| HEAD | b013bd6fe28c691953ea2d9daa925435b479d8d4 |
| branch | docs/m1-h0-v5-detached-source-checkout-chronology-supersession-20260820-writer |
| semantic index | 1634 paths; exact 557b vector; staged A/M/M/A |
| worktree delta | unstaged=0; untracked=0 |

## 5. D047 preauthoring path-mistarget incident

/root/decision047_writer byl vytvořen před D047 authoringem a je literal člen
U47. Jeho první apply_patch použil implicitní turn cwd místo explicitního
sibling-worktree prefixu a vytvořil právě dvě untracked copies mimo D047:

| Literal full path | Bytes | LF | Reconstructed SHA-256 |
|---|---:|---:|---|
| /home/belphareon/Projects/docs/decisions/047-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession.md | 29353 | 553 | 78dfe3c5c624c8491b84de8ddf8a89b3082c08ede4367726a527d0cfae39a4cd |
| /home/belphareon/Projects/docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION.md | 15753 | 336 | e5bee8baad2bbf08acb5da59a8d66df52e0a9a86cec02dd34fa90eff0c736d31 |

Retained exact add-file patch payload dovoluje byte-for-byte reconstruction
obou bodies včetně terminal LF; pre-delete measurement nad vytvořenými paths
ověřil stejný bytes/LF/SHA vector. Writer zjistil mistarget před stagingem a
jedním apply_patch odstranil exact relative targets:

    docs/decisions/047-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession.md
    docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION.md

Delete tool vrátil success. Root read-only ověřil oba literal absolute paths
current lstat-absent a D047 worktree exact B44/porcelain empty/index1632.

Klasifikace je D047_WRITER_PATH_MISTARGET / NO_VOTE. Known jsou ordered
create-detect-delete kroky, exact paths, reconstructed bytes/LF/SHA, delete
targets a current absence. UNKNOWN jsou exact wall-clock timestamps,
apply_patch syscalls/internal temp strategy, transient inode and parent-dir
ctime/mtime/atime/cache, scheduler/tool-internal footprint a broader host
effects. Nesmí vzniknout host-zero-effect claim. Removed objects nejsou
candidate input, vote, tree ani token.

## 6. D047 correct authoring scope a preexisting state

S47 smí měnit právě:

    docs/decisions/047-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession.md
    docs/execution/m1-batch.md
    docs/wp/README.md
    docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-EXACT-PATH-WORKTREE-SUPERSESSION.md

Reserved report zůstává na B47 i S47 any-type absent:

    docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-report.md

Correct D047 worktree vznikl před prvními correct candidate bytes z B44:

| Pole | Exact hodnota |
|---|---|
| worktree | /home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer |
| common-Git admin | /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer |
| HEAD | b013bd6fe28c691953ea2d9daa925435b479d8d4 |
| branch | docs/m1-h0-v5-detached-source-checkout-exact-path-worktree-supersession-20260820-writer |
| preauthoring semantic index | 1632 paths; clean |
| required hard-freeze state | 1634 paths; final D047 manifest; staged A/M/M/A; unstaged=0; untracked=0 |

/root/decision047_writer je jediný D047 docs writer, nonreviewer a nonissuer.
Po exact four-doc hard-freeze se permanentně fence-ne. Root zůstává sole
issuer, DAG creator, promoter a operation creator; D047 docs needituje.

Zakázané jsou jiné tracked cesty, D044/D045/D046 ref/object/report mutation,
source/helper/runtime/import, temp/cache/private/evidence, final target/admin,
sudo, process-control, write-tree, commit, promotion, push/tag, cleanup, reset,
revert, cherry-pick, rebase a history rewrite. Jediná index-write výjimka je
jedno git add -- exact four paths po self-review.

## 7. Fresh U47, role a namespace

Exact sorted closed U47 je exact U46 plus /root/decision047_writer. Má 61
unique entries:

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
    /root/decision040_driver_writer/d043_doc_contract
    /root/decision040_driver_writer/d043_precommit_audit_a
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
    /root/decision043_architect
    /root/decision043_architect/decision043_adversary
    /root/decision043_architect/runtime_gate_audit
    /root/decision043_architect/source_preflight
    /root/decision044_writer
    /root/decision047_writer
    /root/mount_stack_reviewer
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
    /root/v5_d043_prewrite_runtime_verifier
    /root/v5_d043_source_checkout_verifier
    /root/v5_d044_source_checkout_verifier
    /root/v5_formal_preseal_review
    /root/v5_materializer

Každý holder používá exact sorted U47 bez sebe, tedy 60 exclusions. Missing,
extra, duplicate, alias, shortened identity nebo self entry je blocker.

| Role | Identity |
|---|---|
| D047 docs writer; nonreviewer; post-freeze fenced | /root/decision047_writer |
| fresh Review A/adversary | /root/decision043_architect/decision043_adversary |
| fresh Review B/post-create metadata/packet reviewer | /root/mount_stack_reviewer |
| source architect/materializer | /root/decision043_architect |
| sole issuer/DAG creator/promoter/operation creator | /root |
| distinct source verifier | /root/v5_d044_source_checkout_verifier |
| incident identity; fenced | /root/decision043_architect/runtime_gate_audit |
| incident identity; fenced | /root/decision043_architect/source_preflight |

Review A/B musí začít byte zero nad fresh S47/C47. Reuse identity není reuse
vote. Fresh namespace je:

    D047-PRIVILEGED-OPERATION-01
    D047-RUNTIME-GATE-BINDING-01
    D047-CREATE-01
    D047-VERIFY-01
    D047-H0V5-EXACT-PATH-WORKTREE-CLOSURE-LEASE-01

Jakýkoli D044-, D045- nebo D046-prefixed token, lease, holder, acceptance,
report, vote, tree nebo result field je stale a blokuje.

## 8. Mandatory D045/D046/D047 worktree rows

Future source materialization musí do existing readiness/post filesystem a
common-Git captures zahrnout právě tyto preexisting required rows, bez nového
direct child nebo změny 37/1 cardinality:

| Required row ID | Literal identity |
|---|---|
| FS47_D045_AUTHORING_WORKTREE | exact D045 worktree, HEAD, branch, semantic index, staged/unstaged/untracked state v §3 |
| FS47_D045_COMMON_GIT_ADMIN | exact D045 admin a branch-ref/index linkage v §3 |
| FS47_D046_AUTHORING_WORKTREE | exact D046 worktree, HEAD, branch, semantic index, staged/unstaged/untracked state v §4 |
| FS47_D046_COMMON_GIT_ADMIN | exact D046 admin a branch-ref/index linkage v §4 |
| FS47_D047_AUTHORING_WORKTREE | exact D047 worktree, HEAD, branch a final hard-freeze semantic state v §6 |
| FS47_D047_COMMON_GIT_ADMIN | exact D047 admin a branch-ref/index linkage v §6 |

Readiness vector A i post vector B musí obsahovat všech šest IDs. Pro každý row
platí A == B na literal path, type, stable identity, HEAD/ref/index semantics a
staged/unstaged/untracked vectoru. Missing, extra, duplicate, alias, generic
parent-only row, shortened path nebo A/B inequality fail-close blokuje. Těchto
šest rows není allowed final-operation delta a nesmí se skrýt, čistit,
přepisovat ani započítat jako direct child. Final external D047 handoff
manifest je jediný exact pin self-referential staged vectoru.

## 9. Fresh D047 docs DAG

D047 nezačíná na D044 E_B ani na D045/D046 indexu. B47 je exact B44 s 1632
paths. S47 má exact A/M/M/A a 1634 paths. Report přidá jednu cestu; E_A47,
C47 a E_B47 mají 1635 paths:

    B47/B44 -> S47 -> E_A47 -> C47 -> E_B47 -> future canonical --ff-only

- E_A47 je direct child S47 a přidá jen první čtyři report řádky;
- C47 má ordered parents [B47,E_A47] a exact E_A47 tree;
- E_B47 je direct child C47 a přidá jen poslední dva řádky;
- report je jediná změněná cesta E_A47/E_B47;
- Review A i B jsou fresh zero-based a vyžadují PASS / P0=0 / P1=0;
- distinct post-create metadata gate ověří parents, trees, path counts, report
  bytes, clean scope a required worktree rows;
- pouze jeho PASS dovolí rootovi future ff-only B47→E_B47.

Reserved report má exact šest LF-terminated řádků:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: b013bd6fe28c691953ea2d9daa925435b479d8d4
    subjectHead: <full-S47-sha>
    reviewA.verdict: PASS
    candidateHead: <full-C47-sha>
    reviewB.verdict: PASS

D044 report se nekopíruje. D045/D046 nemají commit ani report a jejich staged
bytes nejsou D47 tree/authority input.

## 10. Final folded operation zůstává 37/1

Po validní D047 promotion a fresh post-ff materialization je final canonical
prestate exact future E_B47/tree/report/1635 paths. D047 normativně znovu
přijímá pouze static design z exact D044 Decision blobu
4b6f7c66b142770fdf6e1ca87a3398b8829b7b6d se SHA-256
61b2994295d6555b05a76ea02e5b313452aab982d7bb991d21835763fbd4d61e,
s replacementy D47 pro base/DAG/report/U47/role/namespace/row closure. Jde o
specification input, nikdy vote/PASS/tree/token/materialized byte/evidence.

Exact cardinality zůstává:

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

EX01–EX09 ověří exact promoted E_B47 a required preexisting rows. EX10_ROOT_BATCH
obsahuje právě jeden effectful direct child RW01_CREATE; promotion/noop/read
root row neexistuje. Po EX09 není read/import/discovery/sleep/child/external gap
před Popen. EX11–EX16 uzavřou inherited post closure. Direct order je R01–R18,
RW01_CREATE, P01–P18. Logical DR01–DR18 + DP01–DP20 zůstává 38; DP20 je pure
join, ne child.

CV01 je CV01_D047_DAG; CV07 je
CV07_CANONICAL_ALREADY_PROMOTED_STABILITY bez root row; CV08
CV08_TARGET_IDENTITY vlastní jediný rootRowId=RW01_CREATE; CV24 odkazuje na
nové CV01/CV07. CV02–CV06 a CV09–CV24 zachovají D044 substantivní význam a
coverage je exact 1:1.

CREATE dědí exact D038/D043 constructor:

    source commit: df1863439b6ad83abf41396ba8063e5bffaa599e
    source tree:   1f0e730a46a94a7f741b2dbf47426458b8125a97
    target:        /home/belphareon/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    admin:         /home/belphareon/Projects/intentsmith/.git/worktrees/is-m1-h0-v5-d037-repair-source-eb-df186343
    lock reason:   Decision038-authorized-detached-source-df1863439b6ad83abf41396ba8063e5bffaa599e

Child má uid/gid 1000/1000, supplementary groups [], umask 0077 a exact closed
16-key env/config/stdin/cwd/timeout/reap/result. Pinned Git 2.43 smí mít jeden
expected internal worktree-add reset-hard descendant; není direct child ani
reset authority. Target/admin musí být any-type absent v každém prewrite
capture. Partial failure se neuklízí, neretryuje ani nepřesměruje.

## 11. Short launcher, ARG_MAX, acyclic authority a truthful TCB

Uživatel dostane jediný ASCII one-line paste bez physical LF, max 4096 bytes.
Attested Bash spustí pinned isolated CPython stage-0. Zakázané jsou direct
python path, bash file, source, eval, heredoc/long paste a cat substitution.
Stage-0 same-FD přes O_NOFOLLOW|O_NONBLOCK před compile/exec ověří owner/mode/
nlink/size/SHA/stat transportu. Transport drží a stejně ověří root loader a
předá jeho bytes jako sudo Python -c.

Stage-0 i root-loader ASCII Python -c payload mají každý max 131071 bytes,
tedy 131072 včetně NUL; max+1 blokuje. Exact transport-owned transport→sudo
execve účtuje ordered argv/env ASCII bytes včetně NUL a env =, pointer table
(argc+envc+2)*pointerWidth a vyžaduje strict:

    outerArgvEnvAccountedBytes + 65536 < runtimeScArgMax

Equality blokuje. runtimeScArgMax je fresh host measurement připnuté external
protokolem; guessed nebo stale scalar blokuje. Interní sudo→env/PAM/
SUDO_COMMAND environment je EXTERNAL_BROKER_TCB, nikoli exact verifier-
reconstructed env. Modeled known duplication vyžaduje explicitní conservative
upper bound před 65536 margin. Root loader ověří resuid/resgid root, incoming
groups (0,987), dropne na [] před import/read a same-FD připne B/D/A.

Materialization je acyklická:

    pre-frozen source/static pins -> A -> D -> B -> root-loader -> transport
      -> stage-0 -> command -> external protocol

A47 obsahuje static policy/caps/formule/field names, exact frozen system-leaf
SHA-256 8c3081b88af6538fa9079042747d700340cc80b872d7ca06ef1c17e3e12134da,
future filesystem-leaf/phase-verifier source SHA až po jejich vlastní hard-
freeze+dual PASS a approved static/native pins. Mutable future hash není
authority. A47 nesmí pinnut actual derived D/B nebo later loader/transport/
stage0/command/protocol value. Component pinuje jen frozen inner bytes;
external protocol jako jediný váže actual component bytes/LF/SHA, argv/env,
accounting, runtime SC_ARG_MAX a final command.

System leaf je PINNED_SYSTEM_PROBE_TCB: same-isolate producer fail-closed
vynucuje cumulative A+B limits a vydává per-sweep/per-round commitments.
Verifier nezávisle kontroluje exported schema, typed generations/tombstones,
terminal later sweep/census, unresolved=0, exact policy/selectedLimits a
recompute relevantJoin. Bez neexportovaných preimages/counter ledgeru netvrdí
FULL_HASH_RECOMPUTED ani CUMULATIVE_LIMITS_INDEPENDENTLY_SUMMED.

## 12. Pre/post delta a terminal truth

Operation nesmí změnit canonical E_B47 head/ref/tree/index/reflog/objects,
config/info, private roots ani žádný existing worktree/admin. Readiness i post
musí obsahovat všech šest FS47 required rows a pro každý A == B. Generic
worktree census bez literal path/HEAD/branch/index/staged/unstaged/untracked
closure nestačí.

Allowed delta je pouze exact new final target subtree, exact named common-Git
admin subtree, expected parent metadata, target index/log a worktree census +1
detached/clean/locked entry. Retained five-tree vector zůstává v exact
admission order:

    1f88d73a2c81fc0c1079fb4688f7ce7f913b06a9
    3e229db73b931044dcf3d63ce5dbecc15b2ae0f4
    580d3c17de97b41e38a55a2deff5e2b632301060
    8d82e4a42cf44822e381ed5aaf465aa120a45df4
    d742035f3267b0dddd4f179c05d9ef23a7c55aef

Jeden fresh D047 token, jeden run, žádný retry. Před ROOT_ENTERED je
dispatcher-static incomplete BLOCKED, complete-known mismatch NOT_READY a
unknown prewrite UNKNOWN_OPEN. Jakákoli exception/watchdog/incomplete/unknown
po ROOT_ENTERED je VERIFY_INCOMPLETE / CLOSED_FREEZE. Pouze complete post
mismatch je CHANGES_REQUIRED; pouze complete zero-finding distinct verifier
smí vydat PASS.

Docs, report, promotion, materialization, readiness, CREATE exit0 ani historical
PASS string nejsou source/M1/H0/runtime/T3/Gate DONE.

## 13. Acceptance R47

1. R47-01 — canonical B44/tree/1632 a D043 premature ff disclosure jsou exact.
2. R47-02 — D044 DAG, 9a2 manifest, report bytes a invalid PASS history jsou exact.
3. R47-03 — runtime_gate_audit pre-vote a source_preflight post-PASS chronology
   i UNKNOWN boundary jsou exact.
4. R47-04 — D045 df1b vector, Review B P1=1, stopped A a NO_VOTE jsou exact.
5. R47-05 — D046 557b vector, Review B P1=2, stopped A a NO_VOTE jsou exact.
6. R47-06 — oba D046 full mistarget paths, bytes/LF, current absence limited
   proof a UNKNOWN fields jsou exact.
7. R47-07 — D047 writer mistarget paths, reconstructed bytes/LF/SHA, delete,
   absence, UNKNOWN boundary a NO_VOTE jsou exact.
8. R47-08 — D045/D046/D047 exact worktree/admin/branch/HEAD/index/staged/
   unstaged/untracked rows mají readiness/post presence a A == B.
9. R47-09 — exact A/M/M/A, report absence, U47=61/exclusions=60 a roles sedí.
10. R47-10 — fresh B47→S47→E_A47→C47→E_B47 DAG/reviews/report-only envelope.
11. R47-11 — pouze distinct post-create PASS dovolí ff-only a materialization.
12. R47-12 — fresh namespace nemá D044/D045/D046 vote/tree/token/result reuse.
13. R47-13 — exact 37 direct/1 write/38 logical/18+20/24 CV/16 EX.
14. R47-14 — CREATE source/target/admin/lock/env/credentials/no-retry jsou exact.
15. R47-15 — launcher, same-FD, 131071/max+1 a strict SC_ARG_MAX jsou exact.
16. R47-16 — authority graph je acyclic a outer actual pins nejsou v A47.
17. R47-17 — leaf8c TCB a exported preimage/counter boundary jsou truthful.
18. R47-18 — canonical/preexisting-row zero-delta a target/admin-only post
    delta jsou complete; pouze distinct D047 verifier PASS je usable.

## 14. Negative fixtures F47

1. F47-01-B47-CANONICAL-TREE-PATH-OR-REFLOG-DRIFT
2. F47-02-D044-DAG-REPORT-9A2-PIN-OR-HISTORY-LOSS
3. F47-03-D044-PASS-VOTE-SOURCE-MATERIALIZATION-TREE-OR-AUTHORITY-REUSE
4. F47-04-RUNTIME_GATE_AUDIT-PREVOTE-OR-SOURCE_PREFLIGHT-POSTPASS-DRIFT
5. F47-05-INCIDENT-UNKNOWN-AS-ZERO
6. F47-06-D045-DF1B-REVIEW-OR-WORKTREE-STATE-DRIFT
7. F47-07-D046-557B-REVIEW-OR-WORKTREE-STATE-DRIFT
8. F47-08-D046-MISTARGET-FULL-PATH-MEASUREMENT-ABSENCE-OR-UNKNOWN-DRIFT
9. F47-09-D047-WRITER-MISTARGET-SHA-DELETE-ABSENCE-UNKNOWN-OR-VOTE-DRIFT
10. F47-10-REQUIRED-WORKTREE-ROW-MISSING-EXTRA-ALIASED-DUPLICATE-OR-A-NE-B
11. F47-11-U47-NOT61-EXCLUSIONS-NOT60-EXTRA-SELF-OR-ROLE-DRIFT
12. F47-12-D047-WRITER-HIDDEN-VOTE-OR-POSTFREEZE-MUTATION
13. F47-13-D044-D045-D046-TOKEN-LEASE-HOLDER-RESULT-TREE-OR-ACCEPTANCE-REUSE
14. F47-14-D047-SCOPE-REPORT-DAG-PARENT-TREE-OR-PATHCOUNT-DRIFT
15. F47-15-NONFRESH-REVIEW-OR-PREMATURE-MATERIALIZATION
16. F47-16-OLD-38-DIRECT-2-WRITE-NOOP-EXTRA-READ-OR-ORDINAL-DRIFT
17. F47-17-CREATE-SOURCE-TARGET-ADMIN-LOCK-CREDENTIAL-RETRY-OR-CLEANUP-DRIFT
18. F47-18-LAUNCHER-TOCTOU-PAYLOAD-MAXPLUS1-OR-ARGMAX-DRIFT
19. F47-19-BROKER-OVERCLAIM-A-DERIVED-PIN-CYCLE-SELFHASH-OR-OUTER-EDGE
20. F47-20-SYSTEM-LEAF-PIN-POLICY-LIMIT-TOMBSTONE-OR-TCB-BOUNDARY-DRIFT
21. F47-21-CANONICAL-REFLOG-OBJECT-INDEX-CONFIG-INFO-OR-EXISTING-WORKTREE-DELTA
22. F47-22-BLOCKED-UNKNOWN-CHANGES_REQUIRED-DOCS-PROMOTION-CREATE-EXIT0-AS-PASS

Still-applicable D043/D044 substantive fixtures zůstávají fail-closed, ale
jejich acceptance IDs ani votes se nerecyklují. Synthetic fixture není live proof.

## 15. Handoff a claim boundary

/root/decision047_writer po self-review stage-ne exact four docs právě jednou
a vydá path-sorted compact JSON+LF manifest s path,mode,blob,bytes,sha256 pouze
z index entries/blob reads a bez write-tree. Pak se permanentně fence-ne. To je
candidate handoff, ne vote; rootova issuer role nevydává docs vote.

D047 docs mohou pouze otevřít fresh reviews/DAG. Neautorizují D044 promotion,
source materialization, token mint, manual command, CREATE, runtime produktu,
D037 repair, evidence seal, push, tag, cleanup ani M1 completion. Každý další
efekt vyžaduje exact pozdější authority a complete evidence chain.
