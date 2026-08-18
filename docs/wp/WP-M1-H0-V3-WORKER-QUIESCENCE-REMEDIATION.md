# WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION — V3 freeze a jediný V4 worker/seal amendment

**Typ:** docs-only governance subject; po promotion právě jedna private
non-clobber V4 static materializace · **Slot:** jediný writer v izolovaném
disk-backed worktree

**Rozhodnutí:**
[`035`](../decisions/035-m1-h0-v3-worker-quiescence-remediation.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`6feed197f524dbe885e12e1dcd31d996777d4a13`

**baseTree:**
`5c324f2d21c9e1a40a2008a1eab92d93df8c6da5`

**Stav:**
`DOCS_ONLY_ONE_SHOT_V4_STATIC_REMEDIATION / NO_RUNTIME_AUTHORITY /
NO_ACCEPTANCE_AUTHORITY`

## 1. Výsledek a hranice

WP canonical byte-bindne jediný sealed V3 root, jeho prázdné runtime evidence,
premature-seal workflow incident a dvě independent `CHANGES_REQUIRED` review.
Decision 034 one-shot V3 materialization authority je spotřebovaná; V3 je
immutable failure evidence a nesmí se editovat, přijmout nebo spustit.

Subject přijme pouze prospective V4 contract: identity capture má jediného
main-ownera bez background threadu; každý identity-poll child je reapnutý před
dalším pollem nebo safety stopem a `systemd-run --wait` client je po inner
`unit-post` receiptu nebo abnormal safety stopu terminal+reapnutý vždy před
outer result/rmdir/sealem. Terminal seal je jednosměrná fáze bez
publish-capable catch nebo post-digest návratu. Mount split z decision 034
zůstává beze změny.

Tento WP nemá H0 runtime, SSH/logout, `/run`, service/display,
Ollama/GPU/model, Q4, T3, Gate 1 ani acceptance authority. Jeho Review A/B
posuzují pouze docs amendment, ne budoucí V4 bytes.

## 2. Owned paths a reserved report

Immutable subject `S_H0Q` smí změnit přesně:

```text
docs/decisions/035-m1-h0-v3-worker-quiescence-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION.md
```

V subjectu musí být absent:

```text
docs/execution/runs/wp-m1-h0-v3-worker-quiescence-remediation-20260818-report.md
```

Po Review A smí report-only `E_A_H0Q` vytvořit právě tuto rezervovanou cestu.
Po Review B smí `E_B_H0Q` změnit pouze tentýž report appendem. Candidate
nemění subject blobs.

**Zakázané:** jakýkoli jiný tracked path, source/runtime/test/registry/package,
existující report, V1/V2/V3 private bytes, user DB/config, SSH/logout, service,
target, display, `/run`, Ollama/provider, NVIDIA/GPU/model/T3/API effect,
push/force-push/tag/release/history rewrite a cleanup cizího worktree.

## 3. Exact V3 failure binding

Root:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v3-20260817T214721Z.f41t4nd1
```

Povinné primární piny jsou:

```text
plan/h0-v3-plan.json
  sha256 = de8299d80b4267cdd2a9d1e58c1c6554068538c94c4fbdcf4c7f05cf50f25986
  bytes  = 64076
  mode   = 0400

runner/run-h0-v3.py
  sha256 = 4a2414687eaa9ccd1a31692fe154d8ed8c84df264d65f1e97dc34ab465c17b9a
  bytes  = 381784
  mode   = 0500

strategy/rustdesk-v3-strategy.json
  sha256 = 99c73d2eca250e2498366777598ce283bf20f1c99788e37ad5a9c8d529360709
  bytes  = 14620
  mode   = 0400

materialization-manifest.json
  sha256 = 5f4ab9b6f457bba04031976ec55b95fc44919b17bd0af05d80c177805be07d51
  bytes  = 4987
  mode   = 0400
```

WP ověří i čtyři exact detached digest files uvedené v decision 035. Root i
`plan/runner/strategy/evidence` jsou mode `0700`; všechny files UID/GID
`1000/1000`, nlink `1`. `evidence/` je empty a runtime child/drop-in absent.
V3 runtime je `NOT_RUN`, effects `NONE`, acceptance `NOT_ISSUED` a disposition
`DO_NOT_EXECUTE`.

## 4. Independent review evidence

Review A recorder:

```text
root     = m1-h0-v3-static-review-a-20260818T003212Z.Eh5IEyu1
reviewer = /root/h0_static_adversary
verdict  = CHANGES_REQUIRED
result   = cc50bdcaa7cdc33a33dd061b3771a3ef2c3be561f32d1ea9795d0d97a1a751bb
manifest = f771435e9d225652fe22b6dce6b6157a0c5eb2ffae720ae930c2147409f9e45b
detached = 7d2525d57b36ec3362caf8ba8753e0f49fb4b04f1e0142361b3ff8dda117adb2
```

Review B recorder:

```text
root     = m1-h0-v3-static-review-b-20260818T003212Z.8RVcn5Wq
reviewer = /root/h0_bundle_writer2/v3_delta_audit
verdict  = CHANGES_REQUIRED
result   = aa92f15e112713a2ea766e61561094b6f8fc58866c7200c8c8fca98cf9d57e27
manifest = c88820957ddeac5ff7ec19b2573f9ac3f1c4fdb872dac09e915883608065a08f
detached = 3214ac3aede32f9539f3222c4994886b39ac7aeba029d28196a9c84d8df28ed5
```

Oba roots jsou `0700`, exact tři files `0400`, UID/GID `1000/1000`, nlink1;
closure a detached digest jsou validní. Recorder není reviewer ani authority.
Review B task je hierarchicky child pod materializer namespace, ale byl
samostatný read-only audit bez editace/importu/effectu. Review A/B tohoto WP
musí tuto roli výslovně adjudikovat; nevyhovující independence znamená
`CHANGES_REQUIRED`, ne automatické prominutí.

## 5. Potvrzené blockery a exact remediation

### 5.1 Worker-liveness blocker

V3 spouští non-daemon identity worker a po bounded `join(10|70)` může dál
pokračovat s `thread.is_alive()==true`. Failure path přesto může publikovat
terminal receipt a seal, zatímco worker provádí `systemctl show` a mění shared
capture. PASS je fail-closed, ale failure closure není quiescent.

V4 nesmí mít background thread/executor/shared capture. Exact `systemd-run
--wait` client vlastní main outer přes připnutý asynchronous `Popen`; polling
je sériový a každý poll child je před dalším pollem nebo safety stopem reapnutý.
Normal cesta nejprve nechá `unit-post` publikovat
`EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`, potom čekající client vrátí a outer jej
`wait()`/reapne. Abnormal cesta zastaví polling, reapne poll child, smí provést
exact identity-gated safety stop potřebný k ukončení jednotky a až poté bounded
terminate/nejvýše jeden kill + `wait()`/reap clienta. Exact
`CLIENT_QUIESCED` receipt musí dominovat outer result/rmdir/seal, nikoli causal
inner `unit-post` nebo safety stop. Neprokázaná quiescence znamená partial
evidence plus `OUTCOME_UNSEALED/UNKNOWN`, bez manifestu/digestu/markeru.

### 5.2 Post-digest návrat blocker

V3 může po digest fsync selhat na markeru, spadnout do širokého outer catch,
publikovat další evidence a zkusit druhý seal. V4 musí dokončit veškeré checks,
recovery a receipts před terminal-seal entry. Terminal seal není obalený
publish-capable catch/finally. Po manifestu smí následovat jen digest, marker,
marker vzniká přímo mode `0400`, následuje fsync a immediate exit; chyba nechá
unsealed/unknown partial evidence bez dalšího callu nebo zápisu.

### 5.3 Zachovaný mount split

Decision 034 zůstává floor: `ProtectSystem=strict`, právě dva
`ReadWritePaths`, exact 43-byte drop-in, inner restore/unlink/fsync/reload a
non-PASS `EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`; outer až po wait/reap a exact
terminal proofu provede same-inode dirfd rmdir + parent fsync + final proof.
Exact V4 filename je
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v4.conf`.
Broad parent RW, `+`, parent FD pass, `RuntimeDirectory`, helper/second unit,
namespace escape, unmount nebo hidden retry jsou zakázané.

## 6. Povinná V4 review matrix

Review A i B tohoto WP ověří, že decision 035 beze ztráty obsahuje:

1. V3 immutable sealed freeze, empty evidence, no runtime a premature-seal
   incident;
2. oba red recorder bindings včetně role/independence disclosure;
3. actual worker call graph a fakt, že nejde o false-PASS, nýbrž failure-seal
   blocker;
4. post-digest catch/publish/reseal call graph;
5. zákaz background thread/executor/shared capture a jediný main-owned client;
6. poll-child reap před safety stopem a client wait/reap po unit-post nebo
   abnormal safety stopu, vždy před outer result/rmdir/sealem;
7. `UNSEALED/UNKNOWN` bez manifestu/digestu při neprokázané quiescence;
8. jednosměrnou terminal-seal fázi mimo publish-capable catch/finally;
9. exact manifest→digest→marker→fsync→exit pořadí a žádný post-digest call;
10. inherited decision 033 floor a celý decision 034 V3-01 až V3-25 matrix;
11. source/AST-only negative fixtures pro liveness, signal, timeout, marker
    failure, catch edge, seal retry, mount split a budget;
12. nezávislý V4 budget recalculation z nového call graphu včetně async
    clientu, reap/safety/failure closure a terminal writes;
13. exact four-path DAG/report envelope a jediný non-clobber V4 static root;
14. nulovou runtime/acceptance/T3/Gate 1 authority.

Review docs WP nesmí být vydáno za budoucí V4 static PASS. V4 private review
později každý bod skutečně ověří nad immutable V4 bytes.

## 7. Review a promotion DAG

```text
I3=6feed197f524dbe885e12e1dcd31d996777d4a13
  -> S_H0Q
  -> E_A_H0Q (report-only independent Review A)
  -> C_H0Q (merge current canonical integration + E_A_H0Q)
  -> E_B_H0Q (append-only independent Review B)
  -> canonical --ff-only promotion
  -> one V4 non-clobber static materialization
```

Report A obsahuje přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 6feed197f524dbe885e12e1dcd31d996777d4a13
subjectHead: <full S_H0Q>
reviewA.verdict: PASS
```

Report B pouze připojí:

```text
candidateHead: <full C_H0Q>
reviewB.verdict: PASS
```

`CHANGES_REQUIRED/BLOCKED` nevytvoří candidate, promotion ani V4 authority.
Candidate zachová subject blobs; Review B ověří ancestry, ordered parents,
report byte identity a nulový source/runtime/private-artifact delta.

## 8. Jediný povolený materializační effect a další stop

Až promoted `E_B_H0Q` dovolí právě jedno první non-clobber `mkdir` nového V4
rootu s prefixem `m1-h0-headless-no-model-v4-`. Target musí být absent, private
parent real owner-only directory a materializer před prvním zápisem znovu ověří
canonical commit/tree/report DAG, čistý checkout a V3/review bytes. První root
spotřebuje authority i při partial failure; partial se zachová a druhý
nevznikne.

Materializer zapisuje jen static V4 bytes a prázdné `evidence/`. V4 následně
potřebuje dvě nové independent static review a vlastní
`S_V4 -> E_A_V4 -> C_V4 -> E_B_V4 -> promotion`. Teprve potom může vzniknout
fresh SSH/logout/all-system GUI-absence preflight, exact GUI-saved user block a
oddělený promoted `S_ACC` receipt. Immediate same-boot/no-drift gate předchází
nejvýše jednomu H0 pokusu. H0 výsledek stále vyžaduje independent result review
a canonical binding; teprve accepted H0 PASS dovolí nové samostatné T3
rozhodnutí.

Zastavit při driftu, reportu v subjectu, jiné cestě, neúplném review bindingu,
nečistém checkoutu, chybějící review identitě, druhém V4 rootu, V3 změně,
background workeru, post-digest návratu nebo jakémkoli runtime/live effectu.

## 9. Focused writer verification

Před commitem `S_H0Q`:

```text
git diff --no-renames --name-only I3..S_H0Q = exact four-path allowlist
reserved report path absent in S_H0Q
no unresolved placeholder outside explicit report-schema metavariables
V3 root/file hashes, sizes, modes, detached digests and empty evidence = 035
both recorder roots/result/manifest/detached hashes and modes = 035
actual worker and post-digest call graphs = independently reread
V4 matrix + negative fixtures + inherited 033/034 floor = lossless
node tests/artifact-validation.test.js = PASS (151/151 expected)
node scripts/validate-test-registry.js --json = PASS
  (382 tracked programs + 8 exclusions expected)
node tests/repository-hygiene.test.js = PASS
git diff --check = PASS
git status --porcelain=v1 --untracked-files=all = empty after commit
```

Tyto testy jsou docs/static evidence. Nespouštějí V3/V4 runner, Python import,
systemd, service, `/run`, Ollamu, GPU/model ani T3.
