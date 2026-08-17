# WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION — V2 freeze a jediný V3 static amendment

**Typ:** docs-only governance subject; po promotion právě jedna private
non-clobber V3 static materializace · **Slot:** jediný writer v izolovaném
disk-backed worktree

**Rozhodnutí:**
[`034`](../decisions/034-m1-h0-v2-mount-namespace-remediation.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`61bf4729af159000d1b2e9200c1a7d6d72f8df5e`

**baseTree:**
`2c403d87bc9badc4abc0ef6240bb7a5592de1f81`

**Stav:**
`DOCS_ONLY_V3_STATIC_REMEDIATION / NO_RUNTIME_AUTHORITY`

## 1. Výsledek a hranice

WP canonical byte-bindne jediný částečný V2 root, jeho nezapečetěný file set,
prázdný plan/evidence stav a dvě nezávislá `CHANGES_REQUIRED` contract review.
Decision 033 one-shot V2 materialization authority je spotřebovaná; V2 je
immutable failure evidence a nesmí se doplnit nebo spustit.

Subject přijme pouze prospective V3 contract: sandboxovaný `ExecStopPost`
dokončí restore, exact file unlink, child fsync, cleanup reload a publikuje
non-PASS `EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`; accepted outer smí teprve po
`systemd-run --wait` a exact terminal proofu provést host-namespace same-inode
empty rmdir, parent fsync, final proof, druhý `ollama ps`, seal a absolute-last
marker.

Tento WP nemá H0 runtime, SSH/logout, `/run`, service/display, Ollama/GPU/model,
Q4, T3, Gate 1 ani acceptance authority. Jeho Review A/B jsou review docs
amendmentu, ne review budoucích V3 bytes.

## 2. Owned paths a reserved report

Immutable subject `S_H0M` smí změnit přesně:

```text
docs/decisions/034-m1-h0-v2-mount-namespace-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION.md
```

V subjectu musí být absent:

```text
docs/execution/runs/wp-m1-h0-v2-mount-namespace-remediation-20260817-report.md
```

Po Review A smí report-only `E_A_H0M` vytvořit právě tuto rezervovanou cestu.
Po Review B smí `E_B_H0M` změnit pouze tentýž report appendem. Candidate
nemění subject blobs.

**Zakázané:** jakýkoli jiný tracked path, source/runtime/test/registry/package,
existující report, V1/V2 private bytes, user DB/config, SSH/logout, service,
target, display, `/run`, Ollama/provider, NVIDIA/GPU/model/T3/API effect,
push/force-push/tag/release/history rewrite a cleanup cizího worktree.

## 3. Exact V2 failure binding

Root:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v2-20260817T192545Z.ecpyfuh7
```

Povinné file piny jsou:

```text
runner/run-h0-v2.py
  sha256 = 395e41c5da40bd40a02ff49ac010eb054a9022b97ade7a6432b77bb243c99b4a
  bytes  = 251722
  mode   = 0664

strategy/rustdesk-strategy.json
  sha256 = 59b91db84fb4b7d5758039844cd077bedd3696080365fdf28a466abc41f7221d
  bytes  = 8606
  mode   = 0664
```

Root i `plan/runner/strategy/evidence` jsou mode `0700`, UID/GID `1000/1000`,
nlink `1`; files jsou regular, UID/GID `1000/1000`, nlink `1`. `plan/` a
`evidence/` jsou empty. Plan, detached digests, materialization manifest,
seal, runtime evidence a acceptance receipt jsou absent. V2 runtime je
`NOT_RUN`, efekty `NONE`, disposition `DO_NOT_CONTINUE`.

Decision 033 canonical blob nad base má SHA-256
`a5ade62deead6b38c875ac1c67824e1306a845a25a80ea58547a9a9a1b7654c3`.
Review A/B znovu ověří tento blob, promoted commit `61bf4729...`, V2 root a
absence všech nepovolených artefaktů. V2 se při review nechmoduje, neimportuje
a nemění.

## 4. Independent review evidence

Reviewer `/root/h0_static_adversary` v recorder rootu
`m1-h0-v2-contract-review-a-20260817T205608Z` vrátil
`CHANGES_REQUIRED_UNSEALED`; result SHA-256 je
`f44110c087cc51c10478916eafcf66ae65fda541e77859f86a82df54b53595d4`,
manifest `2a180d602a8537d28ad29a10a08d5bb7339ae9b027ded449752d857d8427cfc7`
a detached-file SHA-256
`60c2d0ac771e634c0f8b4ac8c5770e50ebe10cd44e9ae12cbe9b6f8768dc2c00`.

Reviewer `/root/systemd_contract_audit` v recorder rootu
`m1-h0-v2-contract-review-b-20260817T205608Z` vrátil `CHANGES_REQUIRED`;
result SHA-256 je
`c949fbf85bb1c9fe1e9bfd191fe4c293e5ee46894e1bf5229ac022dd789c51b1`,
manifest `268a801a40f0ade302bb7706229c79fc86e46b845d7f0043c71c0eb2f05aa0aa`
a detached-file SHA-256
`902c7df9ea50cca451aad5d8db4eb27f38fdafe46f6f32bb8b0d29893b06918f`.

Recorder `/root` není reviewer ani authority. Jeho bundles mají klasifikaci
`RECORDED_BY_COORDINATOR_FROM_INDEPENDENT_REVIEW_MESSAGE_NOT_SELF_AUTHORITY`;
roots jsou `0700`, všechny tři files `0400`, UID/GID `1000/1000`, nlink `1` a
closure/detached digest prošly read-only ověřením.

Obě review shodně blokují V2 normal PASS: každý systemd Exec dostává fresh
same-policy namespace. Exact-child `ReadWritePaths` je mount boundary, kterou
`rmdir` nemůže odstranit (`EBUSY`); bez této boundary by write do read-only
parentu pod `ProtectSystem=strict` skončil `EROFS`. Nejde o observed runtime
namespace claim. Autorita je lokální systemd 255 `systemd.exec(5)` a `rmdir(2)`
contract plus úplný dvoupřípadový důkaz. Coordinatorův upstream v255-stable
`namespace.c` cross-check je podpůrný a netvrdí identitu installed source.

Review A navíc zachovalo pět P1 mezer: exact `argvClass`, recomputed
before/after pins, unique fixed→ledger binding, full 30-sample validation a
full fixed-receipt contract. V3 musí opravit P0 i všech pět P1; žádný se nesmí
sloučit do prose PASS.

## 5. Přesný V3 static contract

V3 zachová exact 43-byte payload se SHA-256
`87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc` v
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v3.conf`:

```text
[Service]
ExecStop=
KillMode=control-group
```

Transient zachová `ProtectSystem=strict` a má právě dva `ReadWritePaths`:
exact V3 evidence directory a exact child
`/run/systemd/system/rustdesk.service.d`. Povolené rozdělení cleanupu je pouze:

```text
unit-post exact identity
  -> restore under override
  -> exact stop-result oldIdentities recheck
  -> exact drop-in unlink + child fsync
  -> cleanup reload + original-config/service proof
  -> EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR (NON-PASS)
  -> systemd-run --wait returns
  -> outer terminal/deactivated/no-job/no-cgroup/no-process proof
  -> exact receipt+ledger/file/config binding
  -> host same-inode empty dirfd rmdir + parent fsync
  -> final no-residue proof
  -> second strict ollama ps
  -> full evidence closure + seal + absolute-last marker
```

Zakázány jsou broad parent RW, `+` command, parent FD pass, `RuntimeDirectory`,
bind/helper/second unit, namespace escape, unmount/remount, V2 continuation a
jakýkoli hidden retry. Jakákoli nejistota zachová residual a končí
`FAIL/UNKNOWN/INCOMPLETE`, nikdy PASS.

## 6. Acceptance a negativní fixture matrix

Review A i B tohoto WP ověří, že Decision 034 beze ztráty obsahuje:

1. V2 immutable freeze, absence plan/manifest/seal/effectu a oba independent
   `CHANGES_REQUIRED` recorder bindings;
2. fresh same-policy namespace korekci, lokální man contract, EBUSY/EROFS
   proof a zákaz všech pseudo-oprav;
3. split `unit-post`/outer cleanup s exact terminal non-PASS markerem;
4. final deferred-signal/no check-marker race invariant a outer seal deadline
   reserve;
5. exact ledger `argvClass`, before/after, hash chain, unique fixed/result a
   plnou sample/fixed revalidaci;
6. celý pinned SSH/sshd/logind ancestry tuple bez name-only kandidáta;
7. všechny restore initialization uvnitř catch/finally a samostatný state-B
   no-override cleanup;
8. exact own-unit i RustDesk residualy, pre-restore stop-result identities a
   monotonic CONTROL/EFFECT classification;
9. úplný effective transient property set a immediate clean-Git gate;
10. census všech loaded H0 units, strict Ollama i NVIDIA grammar a all-system
    graphical session/process absence;
11. source/AST-only negativní fixtures pro každý bod a pozitivní jedinou
    cleanup cestu bez importu/spuštění runneru;
12. nezávislý budget recalculation nad změněným V3 call graphem včetně outer
    rmdir, final proof a seal; staré V2 `2279/682` není accepted výsledek.

V3 private review později musí každý detail skutečně ověřit nad frozen V3
bytes. Review tohoto docs WP pouze potvrzuje úplnost prospective kontraktu a
nesmí se vydat za V3 static PASS.

## 7. Review a promotion DAG

```text
I2=61bf4729af159000d1b2e9200c1a7d6d72f8df5e
  -> S_H0M
  -> E_A_H0M (report-only independent Review A)
  -> C_H0M (merge current canonical integration + E_A_H0M)
  -> E_B_H0M (append-only independent Review B)
  -> canonical --ff-only promotion
  -> one V3 non-clobber static materialization
```

Report A obsahuje přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 61bf4729af159000d1b2e9200c1a7d6d72f8df5e
subjectHead: <full S_H0M>
reviewA.verdict: PASS
```

Report B pouze připojí:

```text
candidateHead: <full C_H0M>
reviewB.verdict: PASS
```

`CHANGES_REQUIRED/BLOCKED` nevytvoří candidate/promotion ani V3 authority.
Candidate zachová subject blobs; Review B ověří ancestry, ordered parents,
report byte identity a nulový source/runtime/private artifact delta.

## 8. Jediný povolený materializační effect a další stop

Až promoted `E_B_H0M` dovolí právě jedno první non-clobber `mkdir` nového V3
rootu. Target musí být absent, private parent real owner-only directory a
materializer před prvním zápisem znovu ověří canonical commit/tree/report DAG,
čistý checkout a V2/review bytes. První root spotřebuje authority i při partial
failure; partial se zachová a druhý root nevznikne.

Materializer zapisuje jen static V3 bytes a prázdný `evidence/`. V3 následně
potřebuje dvě nové independent static review a vlastní
`S_V3 -> E_A_V3 -> C_V3 -> E_B_V3 -> promotion`. Teprve potom může vzniknout
fresh SSH/logout/all-system GUI-absence preflight, exact GUI-saved user block a
oddělený promoted `S_ACC` receipt. Immediate same-boot/no-drift gate předchází
nejvýše jednomu H0 pokusu. H0 výsledek stále vyžaduje independent result review
a canonical binding; teprve accepted H0 PASS dovolí nové samostatné T3
rozhodnutí.

Zastavit při driftu, placeholderu, reportu v subjectu, jiné cestě, neúplném
review bindingu, nečistém checkoutu, chybějící review identitě, druhém V3 rootu,
V2 změně, pseudo-opravě nebo jakémkoli runtime/live effectu.

## 9. Focused writer verification

Před commitem `S_H0M`:

```text
git diff --no-renames --name-only I2..S_H0M = exact four-path allowlist
reserved report path absent in S_H0M
no unresolved placeholder token in any subject blob
V2 root/file hashes, sizes, modes, emptiness and absences = decision 034
both recorder roots/result/manifest/detached hashes and modes = decision 034
local systemd/rmdir citations and two-case proof = independently rechecked
P0 + all five P1 + every V3 matrix/fixture item = lossless
node tests/artifact-validation.test.js = PASS (151/151 expected)
node scripts/validate-test-registry.js --json = PASS
  (382 tracked programs + 8 exclusions expected)
node tests/repository-hygiene.test.js = PASS
git diff --check = PASS
git status --porcelain=v1 --untracked-files=all = empty after commit
```

Tyto testy jsou docs/static evidence. Nespouštějí V2/V3 runner, Python import,
systemd, service, `/run`, Ollamu, GPU/model ani T3.
