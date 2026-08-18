# 035 — zmrazené H0 V3 selhání a jediná V4 worker/seal remediation

- **typ:** prospective docs-only failure binding a one-shot V4 static
  remediation
- **stav V3:** `STATIC_BYTES_SEALED / REVIEW_A_CHANGES_REQUIRED /
  REVIEW_B_CHANGES_REQUIRED / NO_STATIC_PASS / NO_RUNTIME / DO_NOT_EXECUTE /
  NO_ACCEPTANCE / NO_RETRY`
- **stav amendmentu:**
  `DOCS_ONLY_ONE_SHOT_V4_STATIC_REMEDIATION / NO_RUNTIME_AUTHORITY /
  NO_ACCEPTANCE_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision:**
  `6feed197f524dbe885e12e1dcd31d996777d4a13`
- **baseTree:** `5c324f2d21c9e1a40a2008a1eab92d93df8c6da5`
- **předchůdce:**
  [`034`](034-m1-h0-v2-mount-namespace-remediation.md)
- **WP:**
  [`WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION`](../wp/WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION.md)
- **rezervovaný report:**
  `docs/execution/runs/wp-m1-h0-v3-worker-quiescence-remediation-20260818-report.md`

Promovaná decision 034 dovolila právě jednu V3 non-clobber statickou
materializaci. Tato autorita je spotřebovaná jediným sealed rootem níže.
Materializace neprovedla runtime ani live effect a její byte closure je
integritně validní, ale dvě oddělené source/AST review skončily
`CHANGES_REQUIRED`. V3 se proto nesmí přijmout, spustit ani opravit in-place.

Tento amendment canonical-boundne pravdivý červený výsledek a definuje pouze
prospective V4 static contract. Až vlastní independent Review A, candidate
Review B a canonical fast-forward promotion tohoto amendmentu smějí povolit
právě jednu novou non-clobber **statickou** V4 materializaci. Decision 035
sama nepovoluje H0 runtime, SSH/logout, systemd, service, `/run`, display,
Ollama, GPU, model, T3, Q4, Gate 1 ani downstream effect.

## 1. Byte-exact zmrazené V3

Jediný V3 root je:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v3-20260817T214721Z.f41t4nd1
```

Root je mode `0700`, UID/GID `1000/1000`, nlink `1`, device `30`, inode
`13840261`. Jeho přímé podadresáře `plan/`, `runner/`, `strategy/` a
`evidence/` jsou mode `0700`, UID/GID `1000/1000`, nlink `1`, device `30` a
mají inodes `13840262`, `13840263`, `13840264` a `13840265`. Exact file set je:

| Relativní cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v3-plan.json` | `de8299d80b4267cdd2a9d1e58c1c6554068538c94c4fbdcf4c7f05cf50f25986` | 64 076 | `0400` |
| `plan/h0-v3-plan.sha256` | `58d97ba2b14986011363c56b562b70cb80c8e1020d99d2ad0c52d93b506cc86` | 82 | `0400` |
| `runner/run-h0-v3.py` | `4a2414687eaa9ccd1a31692fe154d8ed8c84df264d65f1e97dc34ab465c17b9a` | 381 784 | `0500` |
| `runner/run-h0-v3.sha256` | `8e8544792d955a6a73c4a9cafc941e55f7084a7995ee834c7395b6db9147ec8d` | 79 | `0400` |
| `strategy/rustdesk-v3-strategy.json` | `99c73d2eca250e2498366777598ce283bf20f1c99788e37ad5a9c8d529360709` | 14 620 | `0400` |
| `strategy/rustdesk-v3-strategy.sha256` | `ec1b1716c1c8d90060d0231c8f4811ad6075e9b53342bb285a3d6b8760e6c188` | 92 | `0400` |
| `materialization-manifest.json` | `5f4ab9b6f457bba04031976ec55b95fc44919b17bd0af05d80c177805be07d51` | 4 987 | `0400` |
| `materialization-manifest.sha256` | `f93f51efbc5f9c36a1856a9a94dc0fabd75ee24ffff70263c90dce293d5c9fec` | 96 | `0400` |

Všechny files jsou regular, UID/GID `1000/1000`, nlink `1`. Detached digesty,
self-excluding manifest, modes, owners, sizes a hashes prošly read-only
kontrolou. `evidence/` je přesně prázdné. V3 runtime directory i drop-in jsou
absent. Runner nebyl independent reviewery importován ani spuštěn a nevznikl
systemd/service/display/Ollama/NVIDIA/model/T3 effect.

Výsledek je přesně:

```text
V3_STATIC_REVIEW_A: CHANGES_REQUIRED
V3_STATIC_REVIEW_B: CHANGES_REQUIRED
V3_RUNTIME: NOT_RUN
V3_EFFECTS: NONE
V3_ACCEPTANCE: NOT_ISSUED
V3_DISPOSITION: DO_NOT_EXECUTE
DECISION_034_V3_MATERIALIZATION_ALLOWANCE: CONSUMED
```

Root a všech osm files jsou immutable failure evidence. Nesmějí se chmodnout,
doplňovat, přesealnout, přejmenovat, mazat ani opravovat in-place. Shodný source
v jiné cestě není pokračování V3 a nevytváří runtime ani retry authority.

### 1.1 Premature-seal a auditní incidenty

Writer vydal final V3 seal dřív, než doběhl independent preseal audit. Core
plan/runner/strategy bytes přitom nedriftovaly a preseal→seal delta obsahoval
jen tři detached digesty, materialization manifest a jeho detached digest.
Jde o `PREMATURE_SEAL_WORKFLOW_INCIDENT`, ne o PASS ani o oprávnění ignorovat
pozdější finding. Protože sealed root je immutable, incident je zaznamenán v
review bundles a tomto novém canonical dokumentu, nikoli dopisem do V3.

V3 plán navíc zachovává dřívější author/tooling incidenty, včetně předčasného
mode `0500` pracovního runneru, následného znovuotevření před final sealem,
source/AST harness false alarmů a opravených draft chyb. Author green matrix
není independent review a oba red verdicty ji přebíjejí.

Při coordinatorově revalidaci review bundles první wrapper očekával shodný
classification string a jiný authority field shape; druhý wrapper měl chybnou
`jq` precedenci u `(.findings|length)`. Oba se zastavily fail-closed, nic
nezměnily a schema-aware rerun následně prošel. Jsou to auditní false alarmy,
nikoli artifact drift, a nezůstávají skryté.

První `apply_patch` pokus o tento WP byl parserem odmítnut, protože jediný
řádek add-file hunku neměl prefix `+`. Soubor ani partial edit nevznikly;
opravený hunk byl aplikován až po explicitní absence kontrole. Ani tento author
tooling failure se nevydává za artifact finding nebo se neskrývá.

Pozdější combined WP prose patch jednou minul exact wrapped context a byl
rovněž odmítnut bez byte změny. Writer nejprve přečetl numbered source a potom
aplikoval menší exact hunk. Tento context-miss je další transparentní tooling
failure, ne důvod přepsat nebo zamlčet red V3 evidence.

Read-only precommit content audit prvního draftu vrátil `CHANGES_REQUIRED`:
draft nesplnitelně požadoval reap čekajícího `systemd-run --wait` klienta před
inner `unit-post`, nechal stale V3→acceptance pořadí ve starší „aktuální“ batch
sekci a neurčil exact V4 drop-in filename. Commit nevznikl. Tento subject chyby
opravuje causal pořadím unit-post→client return/reap→outer closure, aktualizací
obou batch souhrnů a cestou `90-intentsmith-h0-v4.conf`; finding zůstává
transparentní author evidence, ne red verdict nad pozdějším immutable subjectem.

## 2. Dvě independent review a recorder bundles

V3 posoudily dvě od writera oddělené task identity:

| Review | Reviewer | Verdict | Recorder result / SHA-256 / bytes |
|---|---|---|---|
| A | `/root/h0_static_adversary` | `CHANGES_REQUIRED` | `m1-h0-v3-static-review-a-20260818T003212Z.Eh5IEyu1/review-result.json` / `cc50bdcaa7cdc33a33dd061b3771a3ef2c3be561f32d1ea9795d0d97a1a751bb` / 4 457 |
| B | `/root/h0_bundle_writer2/v3_delta_audit` | `CHANGES_REQUIRED` | `m1-h0-v3-static-review-b-20260818T003212Z.8RVcn5Wq/review-result.json` / `aa92f15e112713a2ea766e61561094b6f8fc58866c7200c8c8fca98cf9d57e27` / 5 412 |

Plné recorder roots jsou:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-v3-static-review-a-20260818T003212Z.Eh5IEyu1
/home/belphareon/.local/share/intentsmith-private/m1-h0-v3-static-review-b-20260818T003212Z.8RVcn5Wq
```

Jejich exact closure je:

| Root | Manifest SHA-256 / bytes | Detached-file SHA-256 / bytes |
|---|---|---|
| Review A recorder | `f771435e9d225652fe22b6dce6b6157a0c5eb2ffae720ae930c2147409f9e45b` / 1 448 | `7d2525d57b36ec3362caf8ba8753e0f49fb4b04f1e0142361b3ff8dda117adb2` / 89 |
| Review B recorder | `c88820957ddeac5ff7ec19b2573f9ac3f1c4fdb872dac09e915883608065a08f` / 1 461 | `3214ac3aede32f9539f3222c4994886b39ac7aeba029d28196a9c84d8df28ed5` / 89 |

Oba roots jsou mode `0700`; jejich tři files jsou mode `0400`, UID/GID
`1000/1000`, nlink `1`. Exact directory closure, declared result digest,
self-exclusions a detached manifest digest prošly schema-aware read-only
kontrolou.

Recorder `/root/h0_bundle_writer2` není reviewer ani authority. Review B je
samostatná read-only child-task identity pod jeho namespace; nevytvářela V3
bytes, neimportovala runner a neprovedla effect. Tuto hierarchii neskrýváme:
Review A i Review B tohoto decision WP musí výslovně ověřit, že oddělení rolí a
evidence odpovídá přijatým independent-review pravidlům. Pokud ne, výsledek je
`CHANGES_REQUIRED` a před candidate musí vzniknout další skutečně nezávislé
read-only V3 posouzení; recorder label nesmí chybějící nezávislost nahradit.

## 3. Potvrzené V3 blockery

### 3.1 Worker není povinně quiescent před failure sealem

Zmrazený runner na řádcích kolem `5051–5073` spustí non-daemon identity
worker. Větve kolem `5205–5229` a `5267–5342` provedou pouze bounded
`join(10|70)` a explicitně dovolí `thread.is_alive()==true`; poté stále
publikují terminal/systemd result a outer může dojít do
`publish_outer_result_and_seal`.

Worker nemá evidence-write capability, ale může dál vykonávat skutečný call
graph
`capture_transient_identity_once -> own_unit_properties -> spawn_reserved ->
subprocess.run(systemctl show)` a měnit sdílený `capture` po fixed-receipt
snapshotu nebo detached digestu. PASS větev `worker_alive` správně odmítá, takže
nejde o skrytý green outcome. Failure evidence však může být sealed, zatímco
check a sdílená mutace stále běží. To porušuje V3-08/V3-09 closure.

### 3.2 Po digestu vede exception cesta zpět k publishům

PASS terminal path fsyncne detached digest kolem řádků `6549–6552` a až potom
provádí O_EXCL marker write. Marker open/write/fsync může vyhodit výjimku.
`launch_mode` volá seal uvnitř širokého `try`; jeho `except` kolem řádku 7501
pak může znovu publikovat shared recovery, residual, druhý provider receipt,
postflight a nakonec volat další result/seal kolem řádku 7602.

To je přímý rozpor V3-08: po manifest+digest fsync smí následovat pouze jediný
final marker a jeho fsync. Chybějící marker musí zůstat
`OUTCOME_UNSEALED/UNKNOWN`; nesmí se vracet do evidence, checku, effectu ani
seal retry. Současně nelze certifikovat V3-25 worst-case budget, dokud může
background worker pokračovat souběžně.

## 4. Jediný přijatelný V4 remediation contract

V4 musí losslessly zachovat celý mount-namespace split z decision 034 a
všechny nepopřené safety invarianty decision 033. Decision 035 nahrazuje jen
V3 worker/finalization hranici popsanou níže.

### 4.1 Single-owner identity capture

V4 nesmí použít `threading.Thread`, executor ani jiný in-process background
worker pro identity capture, subprocess poll nebo shared mutable capture.
Povolený design je jeden main-owned asynchronous `Popen` pro exact
`systemd-run --wait`, jehož PID, argv, start time, FD a lifecycle vlastní
outer. Outer provádí bounded identity polling sériově přes jediný subprocess
wrapper a po každém pollu znovu ověří klientský process state.

Každý jednotlivý identity-poll subprocess musí být dokončen a reapnut před
dalším pollem, safety stopem nebo outer closure. Normal cesta zachovává
systemd causalitu: sandboxovaný `unit-post` nejprve publikuje durable non-PASS
`EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`; potom `systemd-run --wait` vrátí a
main-owned client je `wait()`/reapnut; teprve exact `CLIENT_QUIESCED` receipt
odemyká outer terminal proof, rmdir, result a seal.

Abnormal cesta nejprve zastaví další polling a reapne právě běžící poll child.
Pokud může existovat transient, smí poté provést exact identity-gated safety
stop nutný k ukončení jednotky a čekajícího `systemd-run` klienta. Následně v
přesně připnutém budgetu sváže client PID/start time/executable/argv, provede
bounded terminate, případně jediný bounded kill a vždy dokončí `wait()`/reap.
`CLIENT_QUIESCED` musí dominovat outer failure result a jakémukoli sealu; nemá
nesplnitelně předcházet inner `unit-post` receiptu ani safety stopu, který
ukončení klienta umožňuje.

Pokud klienta nebo poll child nelze v accepted boundu ukončit a reapnout,
runner smí zachovat už publikované partial receipts, ale výsledek je přesně
`OUTCOME_UNSEALED/UNKNOWN`: žádný manifest, detached digest ani final result
marker. `daemon=True`, ignorování liveness, sdílený dictionary, druhý
helper/worker nebo pouhý boolean claim nejsou oprava.

### 4.2 Jednosměrná terminal-seal fáze

Všechny effecty, recovery, checks, provider observations, budget/signal gates,
ledger/sample/fixed validation a failure receipts musí skončit před vstupem do
terminal-seal fáze. Volání terminal sealu musí být mimo každý `try`, `except`
nebo `finally`, jehož následná větev umí publish, check, effect nebo retry.

Po prvním write terminal manifestu jsou dovoleny jen předem odvozené bytes v
tomto pořadí:

```text
manifest write + fsync
  -> detached digest O_EXCL write + fsync
  -> single final marker direct-mode-0400 O_EXCL write + fsync
  -> directory fsync
  -> immediate process return/exit
```

V této fázi není subprocess, clock/deadline read, signal-state read, filesystem
re-enumeration, JSON reparse, effect, recovery, logging do evidence, catch
publish ani seal retry. Jakákoli výjimka po zahájení této sekvence pouze ukončí
proces nonzero; partial terminal files zůstanou immutable evidence a stav je
`OUTCOME_UNSEALED/UNKNOWN`, nikdy PASS ani sealed failure claim.

### 4.3 Inherited mount split a effect radius

V4 zachová exact 43-byte payload se SHA-256
`87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc`,
`ProtectSystem=strict` a právě dva `ReadWritePaths`: exact V4 evidence directory
a exact child `/run/systemd/system/rustdesk.service.d`. Exact V4 drop-in je
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v4.conf`.
`unit-post` smí pouze restore, exact drop-in unlink, child fsync, cleanup
reload, original-state proof a non-PASS
`EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`. Outer host rmdir smí následovat pouze
po wait/reap, terminal/no-unit/no-PID/job/cgroup proofu a exact receipt bindingu.

Broad parent RW, `+`, parent FD pass, `RuntimeDirectory`, helper/second unit,
namespace escape, unmount, V3 continuation a hidden retry zůstávají zakázané.

Canonical inherited lineage na base `6feed197...` je byte-pinned takto:

| Artifact | SHA-256 |
|---|---|
| `docs/decisions/033-m1-h0-static-remediation.md` | `a5ade62deead6b38c875ac1c67824e1306a845a25a80ea58547a9a9a1b7654c3` |
| `docs/decisions/034-m1-h0-v2-mount-namespace-remediation.md` | `14bf57948e8a0a3efa43598ac358173af2826507116f1319e480049fabb6cf0c` |
| `docs/wp/WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION.md` | `b23086a1acb13549f42d8dbaec88fcfa7bb662499ed335596c54104c75048985` |
| `docs/execution/runs/wp-m1-h0-v2-mount-namespace-remediation-20260817-report.md` | `46b8e19049a7a37406f4477562fc2327ab281e9a1c32dbfaedf8563964319465` |

V4 plan a oba revieweři musí tyto source bytes znovu ověřit spolu s promoted
035 blobem. Pozdější ref nebo podobný prose není náhrada exact object lineage.

### 4.4 Budget a evidence

V4 plan odvodí command maxima, child caps, sequential polling duration,
safety-stop/reap reserve, restore/final-proof reserve a local terminal-write
reserve z přesného V4 call graphu. Staré V3 hodnoty se nesmějí mechanicky
převzít. Author calculator je pouze evidence; oba independent V4 revieweři
provedou vlastní výpočet a ověří strict inequalities včetně všech failure cest.

Effect ledger, fixed receipts, 30 samples, exact before/after, `argvClass`,
hash chain, full transient property set, strict Git/SSH/loginctl/Ollama/NVIDIA
parsers a all-system graphical absence zůstávají nejméně tak přísné jako v
decision 034.

## 5. V4 acceptance matrix a source fixtures

Každý řádek je povinný. Chybějící nebo neprokázaný řádek je
`CHANGES_REQUIRED`; název funkce ani author PASS není důkaz.

| ID | Povinný invariant |
|---|---|
| V4-01 | V3 root a review bundles jsou immutable failure evidence; první V4 root vznikne až po promoted 035 a spotřebuje jedinou materializační autoritu. |
| V4-02 | V4 static closure je owner-only, self-excluding manifest-bound a má exact empty `evidence/`; stav je pouze `MATERIALIZED_AWAITING_STATIC_REVIEW / NO_RUNTIME_AUTHORITY`. |
| V4-03 | Source/AST call graph neobsahuje `threading.Thread`, executor ani in-process background worker; identity capture má jediného main-ownera. |
| V4-04 | Exact `systemd-run --wait` client je main-owned `Popen`; každý poll child je reapnut před dalším pollem/safety stopem a client je terminal+reapnut po unit-post nebo abnormal safety stopu, vždy před outer result/rmdir/seal. |
| V4-05 | Unreaped, unreadable nebo ambiguous client vede k `OUTCOME_UNSEALED/UNKNOWN`; seal/manifest/digest/marker jsou nedosažitelné. |
| V4-06 | Všechny mutable closure kroky dominují jedinému vstupu do terminal-seal fáze; seal není uvnitř publish-capable `try/except/finally`. |
| V4-07 | Po manifest write následují jen digest, marker, fsync a immediate exit; žádný check/effect/read/publish/retry ani catch návrat není dosažitelný. |
| V4-08 | Marker failure nechá partial terminal evidence a nonzero exit bez dalšího zápisu; nikdy nevyrobí PASS ani druhý seal. |
| V4-09 | Failure outcome smí být sealed pouze po úplné quiescence a closure; jinak zůstane explicitně unsealed/unknown. |
| V4-10 | Nezávislý calculator reprodukuje exact maximum každé command/effect třídy a všechny worst-case success/failure/reap/seal časy. |
| V4-11 | Decision 034 V3-01 až V3-25 a decision 033 floor zůstávají beze ztráty, kromě zde výslovně nahrazené capture/seal architektury. |
| V4-12 | Mount split, same-inode outer rmdir, exact payload a dva ReadWritePaths zůstávají beze změny. |
| V4-13 | Dvě independent V4 static review byte-bindnou celý root, 033/034/035, oba V3 red review artefakty, boot a vlastní budget výpočet. |
| V4-14 | Static PASS ani canonical receipt nevytváří acceptance/runtime/T3/Gate 1 authority; ty mají pozdější samostatný řetězec. |

Povinné source/AST-only negativní fixtures bez importu nebo spuštění runneru:

1. injected background thread/executor nebo shared mutable capture;
2. bounded join/poll skončí živým klientem a přesto existuje cesta k sealu;
3. signal nebo timeout během identity capture vede k unreaped clientu;
4. outer result, rmdir nebo seal před client wait/reap proofem; inner unit-post a exact abnormal safety stop zůstávají v causal pořadí;
5. exception po manifestu nebo digestu vede do publish-capable catch;
6. marker O_EXCL/write/fsync failure vede k checku, publishu nebo retry;
7. druhý seal callsite nebo návrat z terminal fáze do outer recovery;
8. nedostatečný reap/failure/local-seal reserve nebo nepočítaný poll;
9. broad RW/pseudo-fix, inner rmdir nebo outer rmdir před exact terminálem;
10. ztráta kteréhokoli zděděného V3-01 až V3-25 invariantního gate.

Pozitivní fixture musí prokázat právě jednu cestu:

```text
main-owned client start
  -> bounded serial identity capture
  -> unit-post non-PASS terminal
  -> systemd-run return + client wait/reap + CLIENT_QUIESCED
  -> outer terminal proof + same-inode rmdir
  -> final proof + second strict ps + full closure
  -> one-way manifest -> digest -> marker -> immediate exit
```

## 6. Canonical amendment a jediná V4 materializace

V4 private filesystem materialization je effect. Smí vzniknout až v této
topologii:

```text
I3 = 6feed197f524dbe885e12e1dcd31d996777d4a13
  -> S_H0Q (exact čtyřcestný docs-only subject)
  -> E_A_H0Q (reserved report-only independent Review A)
  -> C_H0Q (merge current canonical integration + E_A_H0Q)
  -> E_B_H0Q (append-only independent Review B)
  -> integration/m1-consolidated-20260810 --ff-only promotion
  -> exactly one V4 non-clobber static materialization
```

`S_H0Q` smí změnit přesně:

```text
docs/decisions/035-m1-h0-v3-worker-quiescence-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-V3-WORKER-QUIESCENCE-REMEDIATION.md
```

Rezervovaný report musí být v `S_H0Q` absent. `E_A_H0Q` jej vytvoří jako
jedinou změnu a obsahuje přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 6feed197f524dbe885e12e1dcd31d996777d4a13
subjectHead: <full S_H0Q>
reviewA.verdict: PASS
```

`C_H0Q` má ordered parents `[current canonical integration, E_A_H0Q]`, tree
byte-identický s `E_A_H0Q`, všechny subject blobs nezměněné a prokazatelnou
`E_A_H0Q` ancestry. `E_B_H0Q` smí pouze appendnout:

```text
candidateHead: <full C_H0Q>
reviewB.verdict: PASS
```

Writer, Review A a Review B jsou různé identity. Obě review znovu ověří V3
root, oba recorder bundles, reviewer-role disclosure, konkrétní call graph,
exact allowlist, absence reportu, úplnost V4 matrix/fixtures a zákaz runtime.
`CHANGES_REQUIRED` nevytvoří candidate, promotion ani V4 authority.

Po promoted `E_B_H0Q` smí materializer jednou non-clobber vytvořit nový root
pod exact owner-only parentem
`/home/belphareon/.local/share/intentsmith-private`. Basename začíná literal
`m1-h0-headless-no-model-v4-`, pokračuje skutečným UTC materialization time ve
formátu `YYYYMMDDTHHMMSSZ`, tečkou a přesně osmi kryptograficky náhodnými znaky
z `[a-z0-9]`. Před prvním `mkdir` musí prokázat any-type glob absenci, real
parent mode `0700` bez symlink traversal, čistý canonical exact promoted tip a
nezměněné V3/review bytes. První vytvořený V4 root spotřebuje authority i při
partial failure; partial root se zachová a druhý nevznikne bez nového decision.

V4 materializer smí vytvořit pouze static plan/runner/strategy/detached
digests/self-excluding manifest/root closure a prázdné `evidence/`. Nesmí
spustit runner mode/import, systemd, service, `/run`, SSH/logout, Ollamu,
NVIDIA/GPU/model/T3 ani external API.

## 7. Co musí následovat před jakýmkoli runtime

Ani V4 materializace není acceptance. Povinná další hranice je:

```text
promoted 035
  -> exactly one V4 static materialization
  -> two independent V4 static reviews
  -> S_V4 -> E_A_V4 -> C_V4 -> E_B_V4 -> canonical promotion
  -> fresh SSH/logout + all-system graphical absence preflight
  -> exact operator block including GUI-saved declaration
  -> S_ACC -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical promotion
  -> immediate same-boot/no-drift revalidation
  -> at most one eligible H0 runtime attempt
  -> independent result review + canonical result binding
  -> only an accepted H0 PASS may unlock a separate new T3 authority decision
```

V4 reviews i canonical `S_V4` byte-bindnou celý V4 root, boot ID, decision
033+034+035 blobs, V3 red review artefakty a nezávislý budget výpočet. Reboot
nebo drift je blocker. Budoucí acceptance receipt musí přijmout exact `/run`
payload, cgroup-wide RustDesk signal radius, daemon-reloads, graphical logout,
disconnect/reconnect, outer post-unit rmdir, residual/unsealed UNKNOWN
semantiku, diagnostic-only/no-T3/no-retry hranici a exact V4 digests. Chatový
souhlas bez promoted tracked receipt není effect authority.

## 8. Supersession a stop conditions

Decision 035 úzce nahrazuje pouze V3 capture-worker a terminal-seal části,
které dovolily živý worker nebo návrat z post-digest výjimky do publish/retry.
Mount split decision 034 a ostatní 033/034 safety floor zůstávají závazné.

Zastavit při driftu V3/review bytes, nevyřešené reviewer-role nezávislosti,
reportu v subjectu, path/DAG driftu, nečistém checkoutu, chybějícím reviewerovi,
`CHANGES_REQUIRED`, V4 materializaci před promotion, druhém nebo overwriting V4
rootu, in-place V3 změně, background workeru, post-digest catch/retry,
runtime importu nebo jakémkoli live/system/provider/model/T3 effectu.

Pravdivý stav do dalšího promoted kroku je:

```text
V1: STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE
V2: STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE
V3: STATIC_CHANGES_REQUIRED / SEALED / NO_RUNTIME / DO_NOT_EXECUTE
V4: NOT_MATERIALIZED / NO_RUNTIME_AUTHORITY until canonical 035 promotion
B3 Phase B: STOPPED_T3_TERMINAL_FAILURE
B4 / Gate 1 / B5 / B6 / Gate 2: BLOCKED
```
