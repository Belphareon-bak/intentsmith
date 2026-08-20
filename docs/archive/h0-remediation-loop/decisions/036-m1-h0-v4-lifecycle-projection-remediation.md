# 036 — zmrazené H0 V4 projection selhání a jediná V5 lifecycle remediation

- **typ:** prospective docs-only failure binding a one-shot V5 static
  remediation
- **stav V4:** `STATIC_BYTES_SEALED / REVIEW_A_CHANGES_REQUIRED /
  REVIEW_B_PASS / AGGREGATE_CHANGES_REQUIRED / NO_STATIC_PASS / NO_RUNTIME /
  DO_NOT_EXECUTE / NO_ACCEPTANCE / NO_RETRY`
- **stav amendmentu:** `DOCS_ONLY_ONE_SHOT_V5_STATIC_REMEDIATION /
  NO_RUNTIME_AUTHORITY / NO_ACCEPTANCE_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision:**
  `ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5`
- **baseTree:**
  `f9f8fb84246c1fb86ba89017cdf176ce5a4577f0`
- **předchůdce:**
  [035](035-m1-h0-v3-worker-quiescence-remediation.md)
- **WP:**
  [WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION](../wp/WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION.md)
- **rezervovaný report:**
  `docs/execution/runs/wp-m1-h0-v4-lifecycle-projection-remediation-20260818-report.md`

Promovaná decision 035 dovolila právě jednu V4 non-clobber statickou
materializaci. Autorita je spotřebovaná jediným birth-time-honest sealed
rootem níže. V4 neprovedla runtime ani live effect a její byte closure je
integritně validní. Dvě oddělené static review ale skončily divergentně:
Review A vydala `CHANGES_REQUIRED` a Review B vydala
`PASS`. Požadavek dvou nezávislých PASS proto není splněn a
červený Review A finding zastavuje V4 bez ohledu na lokální PASS druhého
reviewera.

Tento amendment zachovává oba verdicty bez jejich slučování nebo přeznačení,
canonical-boundne společný root cause
`COMMON_MODE_NORMATIVE_PROJECTION_DRIFT` a definuje pouze
prospective V5 static contract. Scope není oprava diagramu. V5 musí svázat
`CLIENT_QUIESCED` napříč pozitivním callgraphem, plan-side
lifecycle a phase kontraktem, receipt semantic contracts a key lists,
strategy projekcemi, manifestem, static/acceptance/operator receipts,
skutečnou AST dominancí a budgetem odvozeným ze source.

Ani decision 036, její review, promotion, V5 materializace nebo static review
nepovolují H0 runtime, SSH/logout změnu, systemd, service, `/run`,
display, Ollamu, GPU, model, T3, Q4, Gate 1 ani downstream effect.

## 1. Byte-exact zmrazené V4

Jediný V4 root je:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v4-20260818T013800Z.sws2y8cf

Filesystem birth time rootu je
`2026-08-18 03:38:00.748753695 +0200`, tedy
`2026-08-18T01:38:00.748753695Z`. Sekundová část přesně odpovídá
literal `T013800Z` v basename. Root je proto birth-time-honest;
nejde o dřívější problém nepodloženého literal času.

Root, `plan/`, `runner/`, `strategy/` a
`evidence/` jsou mode `0700`, UID/GID
`1000/1000`, nlink `1` a device `30`.
Exact file closure je:

| Relativní cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-v4-plan.json` | `98379e4672881947fd9f557351746aff878b8e7df7a47f361f41346565690a1a` | 66 788 | `0400` |
| `plan/h0-v4-plan.sha256` | `830d62fc36419b5d5982ac56dd79dc68d25495eff750fe7ce5df12a332291cc0` | 82 | `0400` |
| `runner/run-h0-v4.py` | `534332e88ce78aa01278307e627dc41b8b3227002e270b328ba29e148b8c5651` | 514 518 | `0500` |
| `runner/run-h0-v4.sha256` | `396d6efa6ddf82888aca7611f399405102c73a636d45fd7d5400afd36d11303a` | 79 | `0400` |
| `strategy/rustdesk-v4-strategy.json` | `3d2ae8d1b300b2a2df637a84d39adceb048d4ca44c233c39b29e7b56028fc056` | 21 089 | `0400` |
| `strategy/rustdesk-v4-strategy.sha256` | `020397b5c93bf3975c938c61c09de14de699acc183f8c4656ace00105414a45b` | 92 | `0400` |
| `materialization-manifest.json` | `1c5450bdcc0c1265db970ff6764be3f79e281054df06208bbc7d1585715956d2` | 4 987 | `0400` |
| `materialization-manifest.sha256` | `080aad3238ec136ea3a0351c730bce44ef810e61297ab50acfa9e61c8ed72650` | 96 | `0400` |

Všechny files jsou regular, UID/GID `1000/1000`, nlink
`1`. Review A zaznamenává self-excluding closure SHA-256
`6d56a8fe9eeb2d52a8c6c57c6913a67aed1bbcaf3b17321fc85b88249078ad1d`;
Review B zaznamenává identické exact osmifile identities, a váže tedy stejné
subject bytes.
Detached digests, modes, owners, sizes a hashes prošly read-only kontrolou.
`evidence/` je přesně prázdné. V4 runner nebyl reviewery importován
ani spuštěn a nevznikl systemd, service, display, Ollama, NVIDIA, model nebo
T3 effect.

Výsledek je přesně:

    V4_STATIC_REVIEW_A: CHANGES_REQUIRED
    V4_STATIC_REVIEW_B: PASS
    V4_AGGREGATE_STATIC_ACCEPTANCE: CHANGES_REQUIRED
    V4_RUNTIME: NOT_RUN
    V4_EFFECTS: NONE
    V4_ACCEPTANCE: NOT_ISSUED
    V4_DISPOSITION: DO_NOT_EXECUTE
    DECISION_035_V4_MATERIALIZATION_ALLOWANCE: CONSUMED

Root a všech osm files jsou immutable failure evidence. Nesmějí se chmodnout,
doplňovat, přesealnout, přejmenovat, mazat ani opravovat in-place. Shodný
source v jiné cestě není pokračování V4 a nevytváří runtime nebo retry
authority.

## 2. Dvě independent review a divergentní verdikty

### 2.1 Review A — závazný červený finding

Recorder root:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-v4-static-review-a-20260818T064220Z.J2w5S1mD

Reviewer je `/root/h0_static_adversary`, designation
`FORMAL_V4_STATIC_REVIEW_A` a verdict
`CHANGES_REQUIRED`. Exact tří-souborová closure je:

| Relativní cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `review-result.json` | `78cb70f8da2c3ad3282faad96c42afd68fa23da9bbbf75b8c05f9e57368f320e` | 10 743 | `0400` |
| `artifact-manifest.json` | `4c952bf4b112f653c3e4e8bce236e463bcc53a90e7e12486e6d99dbfe3d9e62a` | 1 595 | `0400` |
| `artifact-manifest.sha256` | `76422188d2c9836f035c2a5cf1916a78f9f58a97e66df20dd197fba069e0b9d6` | 89 | `0400` |

### 2.2 Review B — zachovaný omezený PASS

Recorder root:

    /home/belphareon/.local/share/intentsmith-private/m1-h0-v4-static-review-b-20260818T065226Z.002bfeb8

Reviewer je `/root/v4_static_review_b`, designation
`FORMAL_INDEPENDENT_V4_STATIC_REVIEW_B` a verdict
`PASS`. Exact tří-souborová closure je:

| Relativní cesta | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `review-result.json` | `5fe12c1f3f4babb5e9ab93bf0d91398bee965f2585c13f14f50c66e6768581c6` | 15 035 | `0400` |
| `artifact-manifest.json` | `ca66c8a61fd80b43f243be25ca42f198f59e8af10c86e115309b01e7536a0257` | 1 721 | `0400` |
| `artifact-manifest.sha256` | `8ab259a11d41220550748e400b1cd8c5992bffc4da21059f6c2b7206a4ce92f8` | 89 | `0400` |

Oba recorder roots jsou mode `0700`; všechny tři files v každém
rootu jsou regular mode `0400`, UID/GID `1000/1000`,
nlink `1`. Manifesty self-excludují manifest a detached digest,
přesně pinují jediný result a oba review vážou stejnou V4 closure.

Review B PASS se nemaže ani zpětně nepřeznačuje. Prokázal mimo jiné skutečný
runner AST lifecycle, jediný main-owned Popen, bounded poll/reap, one-way seal,
mount split a source-derived číselný budget v rozsahu své metody. Současně
přijal source/plan/strategy projection match jako dostatečný a neporovnal
self-consistent osmiprvkovou projekci s exact pozitivní sekvencí decision 035.
Review A tento normativní rozpor nalezl. Dvě PASS byly povinná konjunkce;
`PASS + CHANGES_REQUIRED = AGGREGATE_CHANGES_REQUIRED`, nikoli
většinový PASS.

## 3. Root cause: COMMON_MODE_NORMATIVE_PROJECTION_DRIFT

Promoted decision 035 na exact base
`ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5`, řádky
`335–344`, vyžaduje jednu pozitivní cestu od main-owned startu až
po immediate exit. V4 plan a strategy místo ní nesou byte-identickou
osmiprvkovou V3-style mapu:

    ["unit-post-terminal","systemd-run-wait-return","outer-terminal-proof","outer-host-rmdir","outer-final-proof","outer-ollama-ps-2","seal","absolute-last-marker"]

Její canonical JSON s jedním finálním LF má SHA-256
`5d221939add7317d038056df5182a9dacf291fbed592926dd80d58df433cc816`.
Runner ji hardcoduje jako `POSITIVE_STATIC_CALLGRAPH` a
self-validace pouze vynucuje shodu se stejnou neúplnou konstantou. Strategy
projection digest pinuje tentýž hash. Self-consistency čtyř projekcí proto
neprokazuje shodu s upstream normativním kontraktem.

Mapa začíná až unit-post krokem. Neobsahuje main-owned client start, bounded
serial identity capture ani samostatný `CLIENT_QUIESCED` uzel.
Slučuje wait-return s lifecycle důkazem a nerozlišuje same-inode rmdir,
full closure, manifest, detached digest, marker, terminal directory fsync a
immediate exit jako jednotlivé dominanční body.

Rozpor je širší než stale graf:

- exact token `CLIENT_QUIESCED` má celý V4 plan
  `0` výskytů, strategy `0` a runner
  `28`;
- plan `passFixedReceiptKeyLists` nemá samostatný
  `systemd-run-client-quiesced.json` semantic key contract;
  položka `systemd-run-result.json` pouze vyjmenovává generické
  klíče `clientQuiescedReceipt` a
  `clientLifecycleClassification`, ale neurčuje jejich exact
  klasifikaci, hashovou vazbu, PID/start identitu, poll-child reap ani
  unit-post antecedent;
- `runtimeReceiptContract` neurčuje lifecycle semantic digest pro
  static, acceptance a operator receipt;
- `transientPhaseContract` popisuje systemd unit fáze, ale nemá
  explicitní klientskou lifecycle mapu od startu přes serial capture a
  wait/reap k `CLIENT_QUIESCED`;
- strategy pinuje pouze stale graph digest a neprojekuje uvedené receipt a
  phase semantics;
- runner přitom reálně vytváří
  `systemd-run-client-quiesced.json`, kontroluje exact
  `CLIENT_QUIESCED`, váže started/capture/unit-post receipt,
  vyžaduje PIDFD terminal observation a právě jeden wait/reap a bez tohoto
  důkazu blokuje outer closure.

Kód tedy vynucuje kritický invariant, o němž normativní plan a strategy mlčí.
Static review nemůže z takové dvojice prokázat, že runner dělá přesně to, co
plán slibuje. To je
`COMMON_MODE_NORMATIVE_PROJECTION_DRIFT`, ne kosmetický diagram a
ne důkaz, že skutečný V4 runner znovu obsahuje V3 worker race.

## 4. Jediný přijatelný V5 lifecycle-projection contract

V5 úzce opraví plan-side normativní projekci a její vynucení. Nesmí oslabit
žádný safety floor decision 033, mount split decision 034 ani worker,
quiescence a one-way seal kontrakt decision 035.

### 4.1 Exact pozitivní lifecycle

Normativní anchor je exact promoted
`docs/decisions/035-m1-h0-v3-worker-quiescence-remediation.md`
na base `ffe02f8c...`, řádky `335–344`, SHA-256
`7b7f627d97257cd5f187a55b28b011d0cd198a2ed4786bc88131fff9b8a00c09`.
V5 plan, runner a strategy musí obsahovat právě toto 15-node pole ve stejném
pořadí:

    ["main-owned-client-start","bounded-serial-identity-capture","unit-post-non-pass-terminal","systemd-run-return-plus-client-wait-reap","CLIENT_QUIESCED","outer-terminal-proof","same-inode-rmdir","final-proof","second-strict-ollama-ps","full-closure","one-way-manifest","detached-digest","absolute-last-marker","terminal-directory-fsync","immediate-exit"]

Canonical JSON je UTF-8, bez mezer, s přesně jedním final LF. Má 354 bytes a
SHA-256
`492645f2234b54f7e7421a10978292691b0358461852f9232e1dcf9cbf099d35`.
Alias, sloučení uzlů, vynechání, přeuspořádání, prose-only výskyt nebo pouze
recomputed digest jiné mapy neprojde.

### 4.2 Plan-side lifecycle, phase a receipt semantics

V5 plan musí mít samostatný normativní
`clientLifecycleContract`, který exact pole a jeho digest váže na
skutečný runner flow. Musí explicitně určit:

1. jediný main-owned `systemd-run --wait` Popen a jeho durable
   started receipt;
2. bounded serial identity capture, kde je každý poll child dokončen a reapnut
   před dalším pollem nebo safety stopem;
3. normal causal antecedent
   `UNIT_POST_EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`;
4. return, PIDFD terminal observation, přesně jeden accepted
   `wait()`/reap a uzavření pipes/selectoru;
5. samostatný durable receipt
   `systemd-run-client-quiesced.json` s exact kind
   `H0_V5_MAIN_OWNED_SYSTEMD_RUN_CLIENT_QUIESCED` a exact
   klasifikací `CLIENT_QUIESCED`;
6. started receipt SHA, identity-capture terminal SHA, exact
   PID/starttime/executable/argv identitu, počet dokončených a reapnutých
   pollů, no-live-poll-child, terminal antecedent class a SHA
   `unit-post-result.json`, terminal/wait/reap a FD closure;
7. hashovou vazbu quiesced receiptu do
   `systemd-run-result.json` a každého downstream result,
   closure, manifest, static, acceptance a operator receiptu;
8. abnormal policy: pokud terminal identity, poll reap, client wait/reap,
   antecedent nebo kterákoli hashová vazba není exact, výsledek je pouze
   `OUTCOME_UNSEALED/UNKNOWN` a manifest/digest/marker jsou
   nedosažitelné.

Systemd unit phase contract z 035 zůstává zachován. Vedle něj musí plan a
strategy projektovat explicitní client lifecycle fáze nejméně
`MAIN_CLIENT_START`,
`SERIAL_IDENTITY_CAPTURE`, `UNIT_POST`,
`CLIENT_RETURN_WAIT_REAP`, `CLIENT_QUIESCED`,
`OUTER_TERMINAL_PROOF` a `POST_WAIT` v causálním
pořadí. Klientská mapa nesmí být nahrazena jen systemd property snapshotem.

Plan musí zavést
`lifecycleReceiptSemanticContracts`. Jeho
`passFixedReceiptKeyLists` musí obsahovat samostatné exact entries
alespoň pro client-started, identity-capture-terminal,
unit-post-result, systemd-run-client-quiesced a systemd-run-result receipts.
Key list je nutný, ale není dostačující: semantic contract současně připne
exact kind/classification, value constraints, antecedenty a SHA edges.

### 4.3 Strategy, manifest a budoucí receipts

V5 strategy musí losslessly projektovat:

- exact 15-node lifecycle a hash `492645f2...`;
- celý `clientLifecycleContract` a client phase map, nebo jejich
  canonical digests odvozené z exact plan objects;
- `lifecycleReceiptSemanticContracts` a
  `passFixedReceiptKeyLists` semantic projection;
- source-derived command/effect/lifecycle budget;
- všechny inherited mount, quiescence, no-background a one-way-seal
  invarianty.

Runner self-validation musí porovnat všechny uvedené exact projections s
planem a strategy. Nesmí přijmout self-consistent stale mapu jen proto, že
byly přepočteny její digesty.

Plan `runtimeReceiptContract` musí strukturovaně vyžadovat lifecycle array
SHA-256 a lifecycle-receipt-semantics SHA-256 v budoucím static receiptu,
runtime acceptance receiptu i operator blocku; absent, generic nebo odlišná
hodnota je fail-closed.

V5 materialization manifest musí byte-bindnout exact šest plan/runner/strategy
core a detached-digest files, preseal recorder, lifecycle array SHA-256,
client-lifecycle-contract SHA-256, lifecycle-receipt-semantics SHA-256,
phase-map SHA-256 a budget derivation SHA-256. Manifest sebe a svůj detached
digest explicitně self-excluduje; finální detached manifest digest uzavírá
exact osmifile materialization closure. Budoucí canonical static receipt,
runtime acceptance receipt, operator block a jejich detached digests musí
znovu pinnut stejné lifecycle hodnoty.
Operator block musí obsahovat explicitní exact lifecycle digest a tvrzení, že
outer result/rmdir/seal je autorizovatelný pouze po durable
`CLIENT_QUIESCED` receipt; obecné slovo wait nebo prose chat claim
není náhrada.

Žádná V5 plan/runner/strategy/manifest/static/acceptance/operator path, kind,
unit nebo drop-in identita nesmí omylem zůstat V4. Historické V1–V4 důkazy se
naopak zachovají jako explicitně historické piny.

### 4.4 Skutečná AST dominance, ne pouze constants

Author harness a oba post-seal revieweři musí runner bez importu nebo spuštění
parsovat ze source/AST a sledovat konkrétní call graph. Musí prokázat, že:

- main-owned client start dominuje serial capture;
- normal unit-post non-PASS receipt předchází client return/wait/reap;
- exact quiesced receipt vzniká až po dokončení a reapnutí všech poll children,
  PIDFD terminal observation, jednom wait/reap a ověření unit-post antecedentu;
- `CLIENT_QUIESCED` a jeho SHA edge dominují outer result,
  terminal proof, same-inode rmdir, final proof, druhý strict
  `ollama ps`, full closure a jediný terminal seal;
- one-way manifest, detached digest, marker, directory fsync a immediate exit
  nemají návrat do publish, check, effect, catch recovery nebo retry;
- kterákoli neprokázaná quiescence větev je dominována pryč od manifestu,
  digestu, markeru a outer rmdir.

Kontrola názvu funkce, výskytu tokenu, equality konstant nebo author PASS sama
není důkaz dominance.

### 4.5 Source-derived budget

V5 budget se odvodí z exact 15-node lifecycle, skutečných command/effect
callsites a všech normal i failure edges. Musí zahrnout client start,
každý serial poll a jeho reap, unit-post, return/wait/reap, bounded
terminate/nejvýše jeden kill, quiesced receipt publication, outer proof/rmdir,
final proof, druhý strict provider observation a local terminal writes.

Plan ani strategy nesmějí mechanicky převzít V4 maxima. Author calculator je
pouze pomocná evidence. Preseal reviewer i oba post-seal revieweři provedou
vlastní source-derived recalculation a strict inequalities. Změna lifecycle
edge musí změnit odvozený budget/projection nebo fail-closed zneplatnit
kontrakt.

### 4.6 Inherited safety floor

V5 znovu byte-bindne a losslessly zachová:

| Artifact | SHA-256 |
|---|---|
| `docs/decisions/033-m1-h0-static-remediation.md` | `a5ade62deead6b38c875ac1c67824e1306a845a25a80ea58547a9a9a1b7654c3` |
| `docs/decisions/034-m1-h0-v2-mount-namespace-remediation.md` | `14bf57948e8a0a3efa43598ac358173af2826507116f1319e480049fabb6cf0c` |
| `docs/decisions/035-m1-h0-v3-worker-quiescence-remediation.md` | `7b7f627d97257cd5f187a55b28b011d0cd198a2ed4786bc88131fff9b8a00c09` |

Zůstává exact 43-byte RustDesk payload SHA-256
`87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc`,
`ProtectSystem=strict`, právě dva ReadWritePaths, V5-specific
drop-in `/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v5.conf`
pod exact child, inner unlink/fsync/reload a non-PASS pending receipt, outer
single same-inode empty-dir rmdir až po terminal/quiesced proof, všechny
Git/SSH/session/Ollama/NVIDIA parsers, ledger/sample/fixed validation, zákaz
background workeru a one-way seal. V5 exact core filenames jsou
`plan/h0-v5-plan.json`, `runner/run-h0-v5.py` a
`strategy/rustdesk-v5-strategy.json`; exact kinds jsou
`H0_V5_STATIC_MATERIALIZATION_PLAN`,
`H0_V5_RUSTDESK_EXACT_STOP_STRATEGY` a pro manifest
`H0_V5_STATIC_MATERIALIZATION_MANIFEST`. Transient unit je odvozen jako
`intentsmith-m1-h0-v5-<UTC>-<suffix>.service` z jediného materialization
ID. Broad parent RW, prefix plus, parent FD pass, RuntimeDirectory,
helper/second unit, namespace escape, unmount, collect/reset-failed, hidden
retry nebo V4 continuation zůstávají zakázané.

## 5. V5 acceptance matrix

Každý řádek je povinný. Chybějící nebo neprokázaný řádek je
`CHANGES_REQUIRED`; author harness, prose nebo shodné digesty
nejsou náhrada.

| ID | Povinný invariant |
|---|---|
| V5-01 | V4 birth-time-honest sealed root a oba exact recordery zůstávají immutable; Review A CHANGES_REQUIRED a Review B PASS jsou zachované a aggregate je CHANGES_REQUIRED/DO_NOT_EXECUTE. |
| V5-02 | Právě jeden V5 root vznikne až po canonical promotion 036, je non-clobber, birth-time-honest, owner-only, evidence-empty a pouze `MATERIALIZED_AWAITING_INDEPENDENT_PRESEAL_REVIEW / NO_RUNTIME_AUTHORITY`. |
| V5-03 | Plan, runner a strategy nesou exact 15-node pozitivní pole, canonical-final-LF SHA-256 `492645f2...` a exact decision-035:335–344 anchor bez aliasu, sloučení nebo vynechání. |
| V5-04 | Plan `clientLifecycleContract` a explicitní client phase map popisují main-owned start, serial capture, unit-post, return/wait/reap, `CLIENT_QUIESCED` a downstream closure ve správném pořadí. |
| V5-05 | `lifecycleReceiptSemanticContracts` a `passFixedReceiptKeyLists` obsahují samostatný quiesced receipt, exact classification, identity, child-reap, unit-post antecedent a SHA vazby; key-only přítomnost nestačí. |
| V5-06 | Strategy, runner self-validation, manifest a budoucí static/acceptance/operator receipt projections byte-bindnou lifecycle, phases, receipt semantics a jejich digests; self-consistent stale mapa je odmítnuta. |
| V5-07 | Source/AST dominance prokazuje skutečný start→capture→unit-post→wait/reap→quiesced→outer closure→one-way seal tok; tokeny, názvy funkcí ani constant equality nejsou důkaz. |
| V5-08 | Neprokázaná identity, live poll child, unreadable/ambiguous client, chybný antecedent nebo hash vede pouze k `OUTCOME_UNSEALED/UNKNOWN`; outer rmdir a terminal files jsou nedosažitelné. |
| V5-09 | Command/effect/time budget je znovu odvozen ze source a exact lifecycle edges pro normal i failure cesty; nezávislé recalculations reprodukují maxima a strict inequalities. |
| V5-10 | Preseal independent hold bindne final core bytes před jakýmkoli sealem; materializer po READY pouze rehashne stejné core, vytvoří detached digests/self-excluding manifest a seal. |
| V5-11 | Dva navzájem i od writera/materializera/preseal reviewera odlišní post-seal revieweři znovu ověří celý root, 033–036, V4 red/PASS recordery, preseal recorder, matrix, 26 fixtures, AST a budget. |
| V5-12 | Decision 033 floor, decision 034 mount split a decision 035 worker/quiescence/one-way-seal safety zůstávají lossless; V5-specific path/kind/unit/drop-in identita nemá stale V4 hodnotu. |
| V5-13 | Všech 26 mandatory negativních fixtures níže fail-closed zčervená při své mutaci a pozitivní fixture prokáže právě exact 15-node cestu. |
| V5-14 | Decision 036, V5 materializace, preseal/static PASS ani canonical static receipt nevytváří runtime, retry, model, T3, Gate 1 nebo acceptance authority. |

## 6. Povinných 26 source/AST-only negativních fixtures

Každý fixture pracuje bez importu nebo spuštění runneru a musí mutaci skutečně
aplikovat na izolované bytes. Pouhé hledání tokenu nebo kontrola definice
fixture není důkaz.

1. `V5-FIXTURE-01-OMIT_CLIENT_START`
2. `V5-FIXTURE-02-OMIT_SERIAL_CAPTURE`
3. `V5-FIXTURE-03-SWAP_UNIT_POST_AFTER_CLIENT_REAP`
4. `V5-FIXTURE-04-OMIT_WAIT_REAP`
5. `V5-FIXTURE-05-GENERIC_WAIT_RETURN_ALIASES_CLIENT_QUIESCED`
6. `V5-FIXTURE-06-CLIENT_QUIESCED_AFTER_OUTER_RESULT`
7. `V5-FIXTURE-07-RMDIR_BEFORE_CLIENT_QUIESCED`
8. `V5-FIXTURE-08-SEAL_BEFORE_FULL_CLOSURE`
9. `V5-FIXTURE-09-OMIT_MANIFEST_DIGEST_MARKER_OR_EXIT_NODE`
10. `V5-FIXTURE-10-PLAN_STRUCTURED_PATH_HAS_NO_CLIENT_QUIESCED`
11. `V5-FIXTURE-11-STRATEGY_STRUCTURED_PATH_HAS_NO_CLIENT_QUIESCED`
12. `V5-FIXTURE-12-PLAN_STRATEGY_RUNNER_PROJECTION_MISMATCH`
13. `V5-FIXTURE-13-SELF_CONSISTENT_STALE_V3_MAP_WITH_RECOMPUTED_DIGESTS`
14. `V5-FIXTURE-14-RAW_TOKEN_SPOOF_ONLY_IN_COMMENT_DISCLOSURE_OR_NEGATIVE_FIXTURE`
15. `V5-FIXTURE-15-SYSTEMD_RESULT_KEYS_PRESENT_CLASSIFICATION_WRONG`
16. `V5-FIXTURE-16-QUIESCED_CHILD_SHA_OR_UNIT_POST_ANTECEDENT_WRONG`
17. `V5-FIXTURE-17-TRANSIENT_UNIT_PHASES_PRESENT_CLIENT_PHASE_MAP_ABSENT`
18. `V5-FIXTURE-18-STATIC_RECEIPT_OMITS_LIFECYCLE_SHA`
19. `V5-FIXTURE-19-ACCEPTANCE_OR_OPERATOR_RECEIPT_OMITS_LIFECYCLE_SHA`
20. `V5-FIXTURE-20-BUDGET_MAP_NOT_DERIVED_FROM_LIFECYCLE_EDGES`
21. `V5-FIXTURE-21-STALE_V4_ROOT_FILENAME_UNIT_DROPIN_OR_KIND`
22. `V5-FIXTURE-22-PREMATURE_SEAL_WITHOUT_PRESEAL_READY`
23. `V5-FIXTURE-23-SECOND_V5_ROOT`
24. `V5-FIXTURE-24-POST_SEAL_CORE_DRIFT`
25. `V5-FIXTURE-25-AUTHOR_HARNESS_OR_CHAT_CLAIM_SUBSTITUTES_FOR_INDEPENDENT_REVIEW`
26. `V5-FIXTURE-26-DECISION036_OR_STATIC_RECEIPT_ISSUES_RUNTIME_RETRY_T3_OR_GATE_AUTHORITY`

Fixtures 1–9 dokazují exact pozitivní pořadí; 10–20 normativní plan/strategy,
receipt a budget binding; 21–24 non-clobber materialization a immutable seal;
25–26 nezávislost a authority hranici. Každý post-seal reviewer uvede
jednotlivý výsledek všech 26, ne pouze souhrnný počet.

## 7. Preseal hold, jediná V5 materializace a post-seal review

V5 private filesystem materialization je effect. Smí vzniknout až po
canonical promotion decision 036. Materializer před prvním mkdir znovu ověří
exact promoted tip/tree, čistý canonical checkout, unchanged V4 a oba review
recordery, private parent mode `0700` bez symlink traversal a
any-type absenci všech `m1-h0-headless-no-model-v5-*` roots.

Basename začíná literal
`m1-h0-headless-no-model-v5-`, pokračuje skutečným UTC birth time
ve formátu `YYYYMMDDTHHMMSSZ`, tečkou a přesně osmi
kryptograficky náhodnými znaky z `[a-z0-9]`. První vytvořený root
spotřebuje authority i při partial failure. Druhý V5 root, overwrite, reuse
V4 nebo cleanup partial rootu jsou zakázané bez nového decision.

Materializer nejprve vytvoří pouze owner-only root, prázdné
`evidence/` a final intended plan/runner/strategy core bytes. Před
preseal stopem nastaví root a všechny čtyři podadresáře na `0700`,
plan/strategy na final `0400` a runner na final `0500`; všechny
objekty musí být UID/GID `1000/1000`, nlink `1` a bez symlinků.
Potom se zastaví na
`MATERIALIZED_AWAITING_INDEPENDENT_PRESEAL_REVIEW`. Independent
preseal reviewer, odlišný od writera a materializera, provede read-only
source/JSON/AST audit celé čtrnáctibodové V5 matrix, všech 26 fixtures, exact
projections a vlastní budget. Jeho recorder mimo V5 root má root mode
`0700` a exact
tři regular files mode `0400`: `review-result.json`,
`artifact-manifest.json` a `artifact-manifest.sha256`. Result vydá
`PRESEAL_READY` pouze při nule P0/P1, byte-bindne všechny tři core
files včetně modes a výslovně nese nulovou runtime/acceptance/retry/T3/Gate
authority. `CHANGES_REQUIRED` zachová root unsealed, spotřebuje one-shot
authority a zastaví pokračování.

Teprve po exact `PRESEAL_READY` smí tentýž materializer znovu
rehashnout beze změny všechny core bytes a recorder. Jakýkoli drift zastaví
seal. Při shodě smí pouze vytvořit tři detached core digest files mode
`0400`, self-excluding materialization manifest mode `0400`
svazující preseal recorder a jeho detached digest a final manifest digest mode
`0400`. Nesmí změnit core bytes ani modes, spustit runner/import,
systemd, service, SSH/logout, Ollamu, GPU, model nebo T3. Premature seal je
terminální workflow failure, ne dodatečně omluvitelný incident.

Po sealu provedou dvě nové distinct post-seal identity Review A a Review B.
Každá musí být odlišná od writera, materializera, preseal reviewera i druhého
post-seal reviewera. Obě read-only byte-bindnou celý root, boot ID,
decisions 033–036, V4 root, oba divergentní V4 recordery, preseal recorder,
matrix, 26 fixtures, actual AST dominance a nezávislý budget. Runner
neimportují ani nespouštějí. Jakékoli `CHANGES_REQUIRED` znamená
`V5 DO_NOT_EXECUTE` a nevytváří static receipt candidate.

## 8. Canonical amendment DAG

Decision 036 používá tento exact řetězec:

    I4=ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5
      -> S_H0P
      -> E_A_H0P (reserved report-only independent Review A)
      -> C_H0P (merge current canonical integration + E_A_H0P)
      -> E_B_H0P (exact two-line append independent Review B)
      -> integration/m1-consolidated-20260810 --ff-only promotion
      -> at most one V5 inert static materialization

Immutable `S_H0P` smí změnit přesně:

    docs/decisions/036-m1-h0-v4-lifecycle-projection-remediation.md
    docs/execution/m1-batch.md
    docs/wp/README.md
    docs/wp/WP-M1-H0-V4-LIFECYCLE-PROJECTION-REMEDIATION.md

Rezervovaný report musí být v `S_H0P` absent.
`E_A_H0P` jej vytvoří jako jedinou změnu a obsahuje přesně:

    integrationRef: integration/m1-consolidated-20260810
    baseRevision: ffe02f8c23b3c208cf6420d8857b85ca1ccb54b5
    subjectHead: <full S_H0P>
    reviewA.verdict: PASS

`C_H0P` má ordered parents
`[current canonical integration, E_A_H0P]`, shodný report blob a
prokazatelnou `E_A_H0P` ancestry. Review B začíná od nuly nad exact
candidate a `E_B_H0P` smí k témuž reportu pouze byte-exact
připojit:

    candidateHead: <full C_H0P>
    reviewB.verdict: PASS

Writer, Review A a Review B jsou různé identity. Candidate zachová všechny
subject blobs; Review B ověří ordered parents, ancestry, exact four-path
allowlist, report byte identity, reserved schema a nulový source/runtime/private
artifact delta. `CHANGES_REQUIRED` nevytvoří candidate, promotion
ani V5 authority. Push, force-push, tag, release, history rewrite nebo
origin/main integrace nejsou tímto WP povolené.

## 9. Co musí následovat před jakýmkoli runtime

Ani dvě V5 static PASS nejsou runtime acceptance. Povinná další hranice je:

    promoted 036
      -> exactly one V5 preseal-reviewed static materialization
      -> two independent post-seal V5 static reviews
      -> S_V5 -> E_A_V5 -> C_V5 -> E_B_V5 -> canonical promotion
      -> fresh SSH/login/logout and all-system graphical absence preflight
      -> exact operator block including GUI-saved declaration and lifecycle SHA
      -> S_ACC -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical promotion
      -> immediate same-boot/no-drift revalidation
      -> at most one eligible H0 runtime attempt
      -> independent H0 result review + canonical result binding
      -> only an accepted H0 PASS may unlock a separate new T3 authority decision

Fresh SSH/preflight je read-only a může být diagnosticky ověřen dříve, ale
výsledek nesmí být vydán za V5 acceptance a drift/reboot jej před runtime
zneplatní. Žádná SSH konfigurace, účet nebo credential se tímto rozhodnutím
nesmí měnit.

## 10. Supersession, stop conditions a pravdivý stav

Decision 036 úzce nahrazuje pouze neúplnou V4 normative lifecycle projection,
její receipt semantics a budget binding. Nemění V4 source jako historical
evidence a neoslabuje 033/034/035.

Zastavit při driftu canonical base/tree, V4 nebo recorder bytes, reportu v
subjectu, jiné cestě, nečistém checkoutu, chybějícím reviewerovi, neúplném
anchoru, self-consistent stale mapě, chybějícím client phase/receipt semantics,
neodvozeném budgetu, preseal P0/P1, premature sealu, druhém V5 rootu,
post-seal driftu, `CHANGES_REQUIRED`, runner importu nebo jakémkoli
live/system/provider/model/T3 effectu.

Pravdivý stav do dalšího promoted kroku je:

    V1: STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE
    V2: STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE
    V3: STATIC_CHANGES_REQUIRED / SEALED / NO_RUNTIME / DO_NOT_EXECUTE
    V4: STATIC_CHANGES_REQUIRED / SEALED / REVIEW_B_PASS / NO_RUNTIME / DO_NOT_EXECUTE
    V5: NOT_MATERIALIZED / NO_RUNTIME_AUTHORITY until canonical 036 promotion
    B3 Phase B: STOPPED_T3_TERMINAL_FAILURE
    B4 / Gate 1 / B5 / B6 / Gate 2: BLOCKED

## 11. Transparentní tooling evidence

Při read-only inventuře writer nejprve zkusil neexistující zkrácené V4 cesty
`runner.py`, `plan.json`,
`strategy.json` a `manifest.json` přímo v rootu.
`sha256sum` skončil fail-closed na `ENOENT`; exact
enumeration následně použila skutečné nested paths a všechny piny výše
reprodukovala. Nic se nezměnilo.

První kombinované výpisy dlouhých `ROADMAP.md` a
`SYSTEM-MAP.md` byly transportně zkrácené. Writer je před zápisem
znovu přečetl kompletně v ohraničených ranges. Žádný claim tohoto decision
nestojí na zkráceném výstupu. Tyto author/tooling incidenty nejsou V4 artifact
finding ani důvod skrýt červené evidence.

První pokus o combined refinement patch se zastavil ještě před voláním
`apply_patch` na syntaktické chybě wrapperu
`Missing } in template expression`. Žádný hunk se neaplikoval a žádný
soubor se částečně nezměnil; opravený wrapper následně aplikoval celý exact
patch. Ani tento fail-closed tooling incident není artifact drift.

První structured content audit vrátil `FAIL`, protože jeho exact-count
kontrola správně našla boundary matrix ID podruhé v prose range zápisu, přestože
vlastní matrix měla všech čtrnáct řádků právě jednou. Před commitem byl prose
range nahrazen neambiguous slovním popisem a stejný audit se musí spustit
znovu. Červený mezivýsledek se nezapočítává jako PASS.

Fresh read-only precommit audit zmrazeného staged draftu vydal
`CHANGES_REQUIRED` se dvěma a jen dvěma dokumentačními findingy: stale
očekáváním hygiene countu a zkráceným preseal status aliasem. Oba jsou před
commitem opravené v exact subject paths; tento workflow finding není formal
Review A/B, static acceptance ani runtime authority.
