# 034 — zmrazené H0 V2 selhání a jediná V3 static remediation

- **typ:** prospective docs-only failure binding a one-shot V3 static
  remediation
- **stav V2:**
  `STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE / NO_ACCEPTANCE`
- **stav amendmentu:**
  `DOCS_ONLY_V3_STATIC_REMEDIATION / NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision:**
  `61bf4729af159000d1b2e9200c1a7d6d72f8df5e`
- **baseTree:** `2c403d87bc9badc4abc0ef6240bb7a5592de1f81`
- **předchůdce:**
  [`033`](033-m1-h0-static-remediation.md)
- **WP:**
  [`WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION`](../wp/WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION.md)
- **rezervovaný report:**
  `docs/execution/runs/wp-m1-h0-v2-mount-namespace-remediation-20260817-report.md`

Promovaná decision 033 dovolila přesně jednu V2 non-clobber static
materializaci. Tato autorita je spotřebovaná jediným rootem níže. Materializace
zůstala částečná a nezapečetěná; dva nezávislí revieweři následně našli
strukturálně nedosažitelný normal-PASS cleanup a další neuzavřené evidence
invarianty. V2 se proto nesmí doplnit, sealnout, přijmout ani spustit.

Tento amendment pouze canonical-boundne pravdivý červený výsledek a vymezí
opravený kandidátní kontrakt. Až jeho vlastní independent Review A, candidate
Review B a canonical fast-forward promotion smějí povolit právě jednu novou
non-clobber **statickou** V3 materializaci. Decision 034 sama nepovoluje H0
runtime, SSH/logout, systemd, service, `/run`, display, Ollama, GPU, model, T3,
Q4, Gate 1 ani downstream effect.

## 1. Byte-exact zmrazené V2

Jediný V2 root je:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-v2-20260817T192545Z.ecpyfuh7
```

Root vznikl 2026-08-17 v `21:25:45.178499369 +0200` na device `30`, inode
`13668118`, mode `0700`, UID/GID `1000/1000`, nlink `1`. Jeho čtyři přímé
podadresáře `plan/`, `runner/`, `strategy/` a `evidence/` jsou directory mode
`0700`, UID/GID `1000/1000`, nlink `1`, bez symlink traversal. Zmrazený file
set je přesně:

| Cesta relativně k rootu | SHA-256 | Bytes | Mode | UID/GID | nlink |
|---|---|---:|---:|---:|---:|
| `runner/run-h0-v2.py` | `395e41c5da40bd40a02ff49ac010eb054a9022b97ade7a6432b77bb243c99b4a` | 251 722 | `0664` | `1000/1000` | `1` |
| `strategy/rustdesk-strategy.json` | `59b91db84fb4b7d5758039844cd077bedd3696080365fdf28a466abc41f7221d` | 8 606 | `0664` | `1000/1000` | `1` |

`plan/` i `evidence/` jsou prázdné. Neexistuje V2 plán, detached plan/runner/
strategy digest, materialization manifest, detached manifest digest, seal,
runtime receipt ani acceptance receipt. Oba files zůstaly pracovní mode `0664`;
nikdy nebyly vydány za sealed `0400/0500` artefakty. Nebyl spuštěn runner mode,
import ani compile s runtime side effectem, `systemd-run`, `systemctl`, service,
target, signal, Ollama/provider request, NVIDIA sample, model ani T3 subprocess.

Výsledek je přesně:

```text
V2_STATIC_REVIEW: CHANGES_REQUIRED_UNSEALED
V2_RUNTIME: NOT_RUN
V2_EFFECTS: NONE
V2_ACCEPTANCE: NOT_ISSUED
V2_DISPOSITION: DO_NOT_CONTINUE
DECISION_033_V2_MATERIALIZATION_ALLOWANCE: CONSUMED
PLAN: ABSENT
MATERIALIZATION_MANIFEST: ABSENT
SEAL: ABSENT
```

V2 root a oba files jsou od tohoto freeze evidence. Nesmějí se chmodnout,
doplňovat, přejmenovat, mazat ani opravit in-place. Shodný source v jiné cestě
není pokračování V2 a nevytváří retry authority.

### 1.1 Zachované draft/tooling incidenty

Červený výsledek neskrývá ani bezpečně zastavené draft incidenty:

- první pre-`mkdir` gate nesprávně očekával directory nlink `2`; na tomto
  filesystemu mají dotčené directory nlink `1`. Gate se zastavil ještě před
  vznikem rootu a byl opraven před jedinou materializací;
- jeden checker použil `jq -r` a přidal LF; byl opraven na byte-preserving
  čtení před porovnáním a strategy bytes se tím nezměnily;
- první AST kontrola pracovního restore chunku našla syntaktickou chybu kolem
  `sorted(generator, key=...)`; šlo o source-only draft, nikoli spuštěný kód,
  a chyba byla před zmrazeným SHA odstraněna;
- runner prošel více pre-seal opravami. Žádný dílčí AST/source PASS proto
  není V2 aggregate PASS a neoslabuje finální `CHANGES_REQUIRED_UNSEALED`.

## 2. Dvě nezávislá contract review a jejich recorder bundles

V2 posoudily dvě identity oddělené od writera:

| Reviewer | Scope | Verdict | Recorder result / SHA-256 / bytes |
|---|---|---|---|
| `/root/h0_static_adversary` | frozen source, skutečný call graph a evidence closure | `CHANGES_REQUIRED_UNSEALED` | `m1-h0-v2-contract-review-a-20260817T205608Z/review-result.json` / `f44110c087cc51c10478916eafcf66ae65fda541e77859f86a82df54b53595d4` / 2 443 |
| `/root/systemd_contract_audit` | lokální systemd/rmdir contract a cleanup reachability | `CHANGES_REQUIRED` | `m1-h0-v2-contract-review-b-20260817T205608Z/review-result.json` / `c949fbf85bb1c9fe1e9bfd191fe4c293e5ee46894e1bf5229ac022dd789c51b1` / 2 622 |

Plné recorder roots jsou:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-v2-contract-review-a-20260817T205608Z
/home/belphareon/.local/share/intentsmith-private/m1-h0-v2-contract-review-b-20260817T205608Z
```

Jejich closure je:

| Root | Manifest SHA-256 / bytes | Detached-file SHA-256 / bytes |
|---|---|---|
| review A recorder | `2a180d602a8537d28ad29a10a08d5bb7339ae9b027ded449752d857d8427cfc7` / 599 | `60c2d0ac771e634c0f8b4ac8c5770e50ebe10cd44e9ae12cbe9b6f8768dc2c00` / 89 |
| review B recorder | `268a801a40f0ade302bb7706229c79fc86e46b845d7f0043c71c0eb2f05aa0aa` / 599 | `902c7df9ea50cca451aad5d8db4eb27f38fdafe46f6f32bb8b0d29893b06918f` / 89 |

Oba recorder roots jsou mode `0700`; jejich tři files jsou mode `0400`,
UID/GID `1000/1000`, nlink `1`. Manifest closure, declared result digest a
detached manifest digest prošly read-only kontrolou.

Recorder `/root` **není reviewer ani authority**. Oba result JSON mají přesnou
klasifikaci
`RECORDED_BY_COORDINATOR_FROM_INDEPENDENT_REVIEW_MESSAGE_NOT_SELF_AUTHORITY`.
Recorder pouze non-clobber zachytil zprávy uvedených independent reviewerů;
nevyrábí PASS, acceptance, retry, runtime ani T3 authority.

### 2.1 Primární P0 — normal PASS cleanup je strukturálně nedosažitelný

Zmrazený V2 call graph nastaví transientu `ProtectSystem=strict`, jako
`ReadWritePaths` dovolí pouze evidence root a exact child
`/run/systemd/system/rustdesk.service.d` a stejný runner spustí jako
`ExecStopPost`. `ExecStopPost` potom zkouší odstranit tento child přes
`rmdir()`.

Přesná korekce dřívější hypotézy je: **`ExecStopPost` nesdílí filesystem
namespace s `ExecStart`; systemd pro každý managerem spuštěný proces vytvoří
nový namespace se stejnou unit policy.** Rozhodující lokální contract facts na
hostu se systemd `255.4-1ubuntu8.17` jsou:

- `/usr/share/man/man5/systemd.exec.5.gz`, lines 1535–1562:
  `ProtectSystem=strict` dělá celý filesystem kromě API subtree read-only a
  `ReadWritePaths` je exact výjimka;
- tentýž lokální manuál, lines 1893–1916: `ReadWritePaths` zakládá filesystem
  namespace a dovoluje write pouze v uvedené boundary;
- tentýž lokální manuál, lines 2780–2786: namespace vzniká individuálně pro
  každý proces spuštěný service managerem;
- `/usr/share/man/man2/rmdir.2.gz`, lines 41–48 a 110–112: odstranění
  mountpointu končí `EBUSY`, zápis do read-only filesystemu `EROFS`.

Z toho plyne úplný dvoupřípadový důkaz bez runtime effectu:

1. pokud je exact child writable mount boundary, `rmdir(child)` míří na
   mountpoint a nemůže projít (`EBUSY`);
2. pokud by child takovou boundary nebyl, odstranění directory entry mění
   read-only parent a nemůže projít (`EROFS`).

Coordinator navíc porovnal veřejný upstream tag `systemd-stable/v255`, soubor
`src/core/namespace.c`: lines 1405–1421 pro `MOUNT_READ_WRITE` z cesty vytvářejí
mountpoint, pokud jím ještě není, a lines 1543–1570 aplikují bind mount. Tento
source cross-check je pouze podpůrný. Lokální balík neposkytuje odpovídající
installed source identity, proto se zde **netvrdí**, že tyto upstream source
bytes jsou bytes spuštěného lokálního systemd. Autorita závěru stojí na
lokálně instalovaných man contractech a úplném dvoupřípadovém důkazu výše, ne
na source podobnosti ani na neprovedeném runtime namespace experimentu.

### 2.2 P1 — nezavřená evidence hranice

Review A zachovalo dalších pět samostatných blockerů:

1. `argvClass` effect receiptu je validovaný jen obecnou gramatikou, ne proti
   exact očekávané třídě konkrétního effectu;
2. `before` a `after` jsou kontrolované pouze jako JSON objekty, ne znovu
   odvozené proti exact pinům;
3. fixed receipt může odkazovat ledger result nejednoznačně; není vynucena
   právě jedna expected receipt → právě jeden expected result vazba;
4. třicet samples se kontroluje převážně jménem a `passed=true`, ne přes exact
   schema, sequence, attempt, plan, boot a celý expected obsah;
5. některé fixed receipts jsou vyžadovány pouze názvem a jejich plný kontrakt
   se ve final closure znovu nepřepočítá.

Tyto body samy stačí na `CHANGES_REQUIRED`, i kdyby P0 cleanup byl opraven.

### 2.3 Zakázané pseudo-opravy

V3 nesmí P0 obejít žádnou z těchto variant:

- broad `ReadWritePaths=/run/systemd/system` nebo jiný parent write grant;
- `+` command prefix pro `ExecStopPost`; lokální `systemd.service(5)` lines
  1743–1746 potvrzuje, že by obešel filesystem namespacing restrictions;
- předání parent directory FD/capability do transientu;
- `RuntimeDirectory=`, `BindPaths=` nebo manager-owned cleanup;
- helper unit, druhý transient nebo cleanup service;
- unmount/remount, `/proc/<pid>/root`, namespace escape nebo jiný host-root
  bypass;
- `systemd-run --collect` vydaný za filesystem cleanup.

Každá z těchto variant rozšiřuje authority, porušuje exact inode/fsync pořadí
nebo pouze přesouvá tentýž mountpoint problém. Vyžaduje nové operátorské
rozhodnutí; Decision 034 ji nepovoluje.

## 3. Jediná přijatelná V3 cleanup hranice

V3 zachová `ProtectSystem=strict`. Transient smí mít právě dva writable path
grants a žádný třetí:

```text
<exact V3 evidence directory>
/run/systemd/system/rustdesk.service.d
```

V3 drop-in cesta je přesně:

```text
/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v3.conf
```

Jeho payload zůstává exact 43 bytes, končí právě jedním LF a má SHA-256
`87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc`:

```text
[Service]
ExecStop=
KillMode=control-group
```

### 3.1 Co smí dokončit sandboxovaný `ExecStopPost`

Po ověření exact vlastní `ControlPID`, `InvocationID`, cgroup, argv,
interpreteru, runneru, planu, bootu a receipt lineage smí `ExecStopPost`:

1. uzavřít bounded restore pod stále načteným safe override;
2. před restore znovu navázat přesný digest a `oldIdentities` z
   `rustdesk-stop-result`, ne pouze historické prestate rows;
3. obnovit graphical target a exact pre-active services podle připnutého
   restore closure;
4. přes exact child dirfd ověřit a unlinknout pouze vlastní V3 drop-in;
5. fsyncnout child directory, provést bounded cleanup daemon-reload a
   prokázat original vendor config, `NeedDaemonReload=no` a obnovu služeb;
6. publikovat úplný ledger/fixed receipt a terminální stav přesně
   `EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR`.

Tento terminální stav **nikdy není PASS**. `ExecStopPost` nesmí odstranit
runtime directory, broad parent write, předávat parent FD, volat helper unit ani
publikovat `H0_PASS_DIAGNOSTIC_ONLY` nebo jinou zelenou variantu.

### 3.2 Co smí dokončit outer až po terminálu jednotky

Až po návratu exact `systemd-run --wait` a durable
`EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR` smí accepted outer v host namespace:

1. prokázat exact unit name + `InvocationID`, že jednotka je terminal/
   deactivated, `MainPID=0`, `ControlPID=0`, není job, cgroup, live/reused
   process ani jiná loaded H0 jednotka;
2. byte-bindnout `unit-post` receipt k exact ledger chainu a prokázat absent
   drop-in, obnovený vendor config, `NeedDaemonReload=no`, obnovené services a
   žádný RustDesk residual;
3. otevřít pinned parent a child přes dirfd + `O_NOFOLLOW`, znovu porovnat
   exact child dev/inode/owner/mode/nlink a prázdnost;
4. právě jednou zavolat host-namespace `rmdir(name, dir_fd=parentfd)`, fsyncnout
   parent a prokázat absenci exact child;
5. provést final original-state/no-residue proof, druhý a poslední strict
   `ollama ps`, úplnou ledger/fixed/sample revalidaci, manifest a detached
   digest;
6. teprve poté publikovat cryptographically manifest-bound final PASS marker
   jako absolutně poslední write.

Chybějící, drifted, ambiguous nebo unreadable receipt/path/unit/process/config
state znamená zachovat residual a uzavřít `FAIL` nebo `UNKNOWN/INCOMPLETE`.
Outer nesmí hádat, opakovat `rmdir`, spouštět druhou jednotku ani převést
`EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR` na PASS bez každého bodu výše.

## 4. V3 acceptance matrix

V3 musí zachovat všechny nepopřené bezpečnostní invarianty decision 033 a
navíc splnit každý následující řádek. Chybějící nebo neprokázaný řádek je
`CHANGES_REQUIRED`; název funkce, author test nebo self-claim není důkaz.

| ID | Povinný invariant |
|---|---|
| V3-01 | V2 root a bytes jsou immutable failure evidence; 034 promotion dovolí jediný nový non-clobber V3 static root, nikoli V2 continuation nebo runtime retry. |
| V3-02 | V3 plan/runner/strategy/detached digests/self-excluding manifest/root closure jsou sealed owner-only; `evidence/` je prázdný a plan nese `MATERIALIZED_AWAITING_STATIC_REVIEW / NO_RUNTIME_AUTHORITY`. |
| V3-03 | Direct `post` zůstává observation-only bez call-graph hrany k target/service/process/provider/model effectu; effectful `unit-post` začíná exact vlastní unit identity. |
| V3-04 | `ProtectSystem=strict` zůstává; `ReadWritePaths` je přesně evidence + exact child. Žádný broad parent, `+`, parent FD pass, `RuntimeDirectory`, bind/helper/second unit, unmount nebo namespace escape. |
| V3-05 | `unit-post` pouze unlinkne exact file, fsyncne child, reloadne a prokáže restore; končí exact non-PASS `EMPTY_RUNTIME_DIR_PENDING_OUTER_RMDIR` a nikdy nevolá child `rmdir`. |
| V3-06 | Outer může host-namespace rmdir až po `systemd-run --wait`, exact terminal/deactivated proofu, `MainPID=ControlPID=0`, no job/cgroup/process, exact receipt+ledger bindingu, absent file a original config proofu. |
| V3-07 | Rmdir je single-attempt přes pinned parent dirfd, same child inode a immediate empty/stat/open recheck; po úspěchu následuje parent fsync a exact absence proof. |
| V3-08 | Deferred signals a final marker nemají check→marker race: PASS eligibility, signal policy a reserve se uzavřou před sealem; po manifest+digest fsync už není žádný failure-capable check/effect/publish kromě jediného O_EXCL final markeru a fsync. Marker je absolutně poslední write; jeho absence je `OUTCOME_UNSEALED/UNKNOWN`, ne PASS. |
| V3-09 | Outer deadline má před transientem i po wait explicitní rezervu pro terminal proof, rmdir+parent fsync, final proof, druhý `ollama ps`, plnou revalidaci, manifest, detached digest, marker a failure closure. Každý child cap používá monotonic remaining-minus-reserve. |
| V3-10 | Effect ledger znovu odvozuje pro každý ordinal exact effect class, `argvClass`, argv hash, scope, counter, before/after pins, rc/timeout a previous hash; unmatched, duplicate, missing nebo extra intent/result je non-PASS. |
| V3-11 | Každý fixed receipt má exact schema a právě jednu obousměrnou vazbu na očekávaný ledger result; pouhá existence jména nebo hash v libovolném JSON nestačí. |
| V3-12 | Všech 30 samples se znovu validuje celé: exact filename/index/sequence/schema/attempt/plan/boot/time order, target state, GPU/NVIDIA parse, global RustDesk/display absence, old identities dead a no-model/no-T3 obsah. |
| V3-13 | SSH gate pinuje a znovu ověřuje celý launcher→session leader→root sshd řetězec: PID/PPID/start time/UID, exe path/dev/inode/hash/mode/owner/nlink, argv/cmdline hash/comm/cgroup a logind session tuple; žádná name-only nebo first-candidate volba. |
| V3-14 | Všechny restore/state variables, effect classification a recovery identity se inicializují před první možnou výjimkou uvnitř outer i inner `try/catch/finally`; výjimka v prestate/context/publication nesmí přeskočit state discovery a bounded cleanup. |
| V3-15 | State B — exact empty directory vznikl, ale override file prokazatelně nikdy nevznikl — má vlastní no-override cleanup. Exact inode/empty closure se odstraní v host namespace bez daemon-reload; unknown nebo nonempty state se zachová jako residual. |
| V3-16 | Vlastní unit residual proof ověří exact InvocationID, unit terminal/deactivated state, zero PIDs, no job/cgroup/process a absenci všech loaded H0 units; reused PID/unit nebo unreadable state je non-PASS. |
| V3-17 | RustDesk residual proof váže sole stop result, old identities a effect-result digest; před restore i po něm kontroluje exact service/global cgroup/process closure a nikdy nenahrazuje stop receipt prestate rows. |
| V3-18 | Classification je monotonic a konzistentní: runtime-dir/transient/drop-in/reload intent je `CONTROL_EFFECT_ATTEMPTED`; isolate/stop/start/restore je `EFFECT_ATTEMPTED`. Žádný pozdější restore ani missing receipt ji nesníží na `NO_LIVE_EFFECT/PRE_EFFECT`. |
| V3-19 | Effective transient proof porovná celý exact property set, ne subset: unit identity/type/lifecycle, ExecStart/ExecStopPost argv, empty ExecStop/Ex, network/fs/cgroup/kernel/personality/W^X hardening, exact two ReadWritePaths, environment, working directory, umask, timeouts, KillMode, fragment/drop-ins, InvocationID/PIDs/cgroup/job/delegate a `NeedDaemonReload`. Unknown/extra/misparsed hodnota blokuje effect. |
| V3-20 | Git gate ověří exact promoted canonical head/tree/033+034 blobs a čistý tracked/staged/untracked/ignored-in-scope stav bezprostředně před prvním control effectem a znovu uvnitř unit bezprostředně před isolate; mezi gate a effectem není subprocess, sleep, API ani publish. |
| V3-21 | Unit census zahrne všechny loaded H0-prefixed units ve všech active/failed/inactive stavech; před startem je povolena nula, během pouze exact own tuple a po wait opět nula. Exact-name-only dotaz nestačí. |
| V3-22 | Oba outer `ollama ps` používají strict grammar: exit `0`, empty stderr, exact accepted header/field count/encoding, žádný sentinel, duplicate, extra/malformed row ani neznámý model state. Empty znamená pouze přesně validní header + nula rows. |
| V3-23 | Graphical absence je system-wide, ne jen UID `1000`: loginctl/session/seat i global `/proc` scan odmítne jakoukoli X11/Wayland/graphical session nebo display/RustDesk GUI process libovolného UID; unreadable/ambiguous race je BLOCKED. |
| V3-24 | Strict NVIDIA parser, actual tool/interpreter/runner same-FD binding, full root closure, immediate cumulative pre-isolate gate, restore pre-pins, sole stop a no provider/model/T3 requests zůstávají nejméně tak přísné jako 033. |
| V3-25 | Nezávislý budget calculator znovu odvodí command maxima a worst-case z přesného V3 call graphu včetně outer cleanup/seal. Hodnoty V2 `2279/682` se nesmějí mechanicky převzít; oba V3 revieweři provedou vlastní recalculation a ověří strict inequalities. |

### 4.1 Úplný effective transient property proof

Řádek V3-19 znamená exact allowlist, ne výběr několika bezpečnostních polí.
Plan připne normalizaci a reviewer porovná minimálně tento celý set:

```text
Id=<exact own .service>
LoadState=loaded
Type=oneshot
IgnoreOnIsolate=yes
Restart=no
RemainAfterExit=no
ExecStart=<exact reviewed V3 runner execute argv>
ExecStopPost=<exact reviewed V3 runner unit-post argv>
ExecStop=
ExecStopEx=
IPAddressDeny=any
IPAddressAllow=
ReadWritePaths=<exact V3 evidence> /run/systemd/system/rustdesk.service.d
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
NoNewPrivileges=yes
RestrictAddressFamilies=AF_UNIX AF_NETLINK
ProtectControlGroups=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SuccessExitStatus=
KillMode=control-group
FragmentPath=/run/systemd/transient/<exact own .service>
DropInPaths=
Delegate=no
UMask=0077
WorkingDirectory=<exact sealed V3 root>
Environment=PYTHONDONTWRITEBYTECODE=1 LANG=C LC_ALL=C TZ=UTC
TimeoutStartUSec=<exact recalculated accepted value>
TimeoutStopUSec=<exact recalculated accepted value>
NeedDaemonReload=no
InvocationID=<exact accepted invocation>
ControlGroup=/system.slice/<exact own .service>
MainPID/ControlPID/ActiveState/SubState/Job=<exact phase-specific values>
```

Validator ověří i exact `systemd-run` argv, že žádný další property grant nebo
command prefix nebyl přidán, a že `systemctl show` parser neignoruje duplicate,
unknown nebo truncated property. Phase-specific hodnoty jsou zvlášť definované
pro execute, unit-post, post-wait terminal a final absent-unit proof.

### 4.2 Budget input inventory

Nezávislý V3 přepočet začíná úplným V2 command-class inventářem, aby žádná
třída nezmizela jen kvůli validatoru: Git `12×30 s`, `loginctl 39×5 s`, NVIDIA
`105×5 s`, `systemctl show 134×5 s`, `systemctl list-units 2×5 s`, outer
`ollama ps 2×20 s`, daemon-reload `3×45 s`, multi-user isolate `1×180 s`, sole
RustDesk stop `1×45 s`, graphical isolate `2×180 s`, RustDesk start `2×90 s`,
Ollama start `2×90 s`, own transient stop `1×120 s` a `systemd-run` právě `1`.

Tato čísla jsou **V2 audit input, ne automaticky přijaté V3 maxima**. Split
cleanup přidává post-wait terminal proof, host rmdir/fsync a final seal práci;
V3 plan proto zveřejní úplnou exact mapu bez missing/extra class, zdůvodní každý
delta proti inventáři a z call graphu znovu odvodí counters, per-call caps,
loop/sleep násobení, execute/post/outer bounds a všechny strict reserves.
Authorův JSON výpočet nestačí; oba static revieweři jej reprodukují nezávisle.

## 5. Povinné source/AST-only negativní fixtures

V3 review nesmí importovat ani spouštět runner. Dva nezávislí revieweři
použijí source/JSON/AST-only validátory a nejméně tyto mutační fixtures; každá
musí deterministicky zčervenat:

1. `ExecStopPost` volá `rmdir`, publikuje PASS nebo nemá exact terminal marker;
2. broad parent `ReadWritePaths`, třetí writable path, `+` prefix, parent FD,
   `RuntimeDirectory`, `BindPaths`, helper unit, unmount nebo namespace escape;
3. outer rmdir před wait/terminal proofem, wrong inode, nonempty child,
   chybějící parent fsync nebo opakovaný pokus;
4. deferred signal či vypršený reserve v libovolné finalization boundary a
   jakýkoli check/publish mezi manifest sealem a final markerem;
5. wrong/missing/duplicate ledger sequence, effect class, argvClass,
   before/after pin, hash-chain, fixed receipt nebo ledger-result binding;
6. sample se špatným indexem, schema, attempt/plan/boot, sequence, obsahem nebo
   pouze `passed=true` bez úplného kontraktu;
7. partial/name-only sshd identita, cizí/reused own unit, extra loaded H0 unit,
   chybějící exact RustDesk stop identities nebo CONTROL classification drift;
8. dirty Git po posledním gate, incomplete effective transient property,
   malformed/sentinel Ollama nebo NVIDIA output a graphical session jiného UID;
9. výjimka před restore initialization a state B bez override/fixed receipt;
10. nedostatečný outer seal reserve, missing child cap, loop bez započteného
    maxima nebo author budget neodpovídající nezávislému call-graph výpočtu.

Pozitivní source fixture musí současně prokázat právě jedinou cestu
`unit-post terminal -> wait -> terminal proof -> host rmdir -> final proof ->
second ps -> seal -> absolute-last marker`. Fixture PASS je pouze static
contract evidence, ne runtime authority.

## 6. Canonical amendment a jediná V3 materializace

V3 private filesystem materialization je effect. Smí vzniknout až v této
topologii:

```text
I2 = 61bf4729af159000d1b2e9200c1a7d6d72f8df5e
  -> S_H0M (exact čtyřcestný docs-only subject)
  -> E_A_H0M (reserved report-only independent Review A)
  -> C_H0M (merge current canonical integration + E_A_H0M)
  -> E_B_H0M (append-only independent Review B)
  -> integration/m1-consolidated-20260810 --ff-only promotion
  -> exactly one V3 non-clobber static materialization
```

`S_H0M` smí změnit přesně:

```text
docs/decisions/034-m1-h0-v2-mount-namespace-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-V2-MOUNT-NAMESPACE-REMEDIATION.md
```

Rezervovaný report musí být v `S_H0M` absent. `E_A_H0M` jej vytvoří jako
jedinou změnu a obsahuje přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 61bf4729af159000d1b2e9200c1a7d6d72f8df5e
subjectHead: <full S_H0M>
reviewA.verdict: PASS
```

`C_H0M` má ordered parents `[current canonical integration, E_A_H0M]`, tree
byte-identický s `E_A_H0M`, všechny subject blobs nezměněné a prokazatelnou
`E_A_H0M` ancestry.
`E_B_H0M` smí pouze appendnout:

```text
candidateHead: <full C_H0M>
reviewB.verdict: PASS
```

Writer, Review A a Review B jsou různé identity. Obě review znovu ověří V2
root, recorder closures, lokální systemd contract, P0/P1 blocker set, přesný
allowlist, absence reportu a úplnost V3 matrix/fixtures. `CHANGES_REQUIRED`
nevytvoří candidate, promotion ani V3 authority.

Po promoted `E_B_H0M` smí materializer jednou non-clobber vytvořit nový root
pod exact owner-only parentem
`/home/belphareon/.local/share/intentsmith-private`. Basename začíná literal
`m1-h0-headless-no-model-v3-`, pokračuje skutečným UTC materialization time ve
formátu `YYYYMMDDTHHMMSSZ`, tečkou a přesně osmi kryptograficky náhodnými
znaky z `[a-z0-9]`. Před prvním `mkdir` musí prokázat absenci targetu, real
parent mode `0700` bez symlink traversal, čistý canonical exact promoted tip a
nezměněné V2/review bytes. Root vznikne exclusive mode `0700`, parent se
fsyncne a první vytvořený V3 root spotřebuje authority i při partial failure;
partial root se zachová a druhý V3 root nevznikne bez nového rozhodnutí.

V3 materializer smí vytvořit pouze static plan/runner/strategy/detached
digests/self-excluding manifest/root closure a prázdný `evidence/`. Nesmí
spustit runner mode/import, systemd, service, `/run`, SSH/logout, Ollamu,
NVIDIA/GPU/model/T3 ani external API.

## 7. Co musí následovat před jakýmkoli runtime

Ani V3 materializace není acceptance. Povinná další hranice je:

```text
promoted 034
  -> exactly one V3 static materialization
  -> two independent V3 static reviews
  -> S_V3 -> E_A_V3 -> C_V3 -> E_B_V3 -> canonical promotion
  -> fresh SSH/logout + all-system graphical absence preflight
  -> exact operator block including GUI-saved declaration
  -> S_ACC -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical promotion
  -> immediate same-boot/no-drift revalidation
  -> at most one eligible H0 runtime attempt
  -> independent result review + canonical result binding
  -> only an accepted H0 PASS may unlock a separate new T3 authority decision
```

V3 reviews i canonical `S_V3` musí byte-bindnout celý V3 root, boot ID,
Decision 033+034 blobs, oba independent review artefakty a nezávislý budget
výpočet. Reboot nebo drift je blocker. Budoucí acceptance receipt musí přijmout
exact `/run` payload, cgroup-wide RustDesk signal radius, daemon-reloads,
graphical logout, disconnect/reconnect, outer post-unit rmdir, residual
FAIL/UNKNOWN semantics, diagnostic-only/no-T3/no-retry hranici a exact V3
digests. Chatový souhlas bez promoted tracked receipt není effect authority.

## 8. Supersession a stop conditions

Decision 034 pro V3 úzce nahrazuje pouze ty části 033 §4.10–4.11, které
požadovaly odstranění exact runtime directory v `ExecStopPost` nebo dovolovaly
outer cleanup jen tehdy, když transient prokazatelně nevznikl. V3 používá
split cleanup z §3 této decision. Všechny ostatní 033 safety, no-model,
no-T3, identity, restore, timeout, evidence a independent-review požadavky
zůstávají minimálním floor a smějí se pouze zpřísnit.

Zastavit při driftu V2/review bytes, incomplete P0/P1 bindingu, reportu v
subjectu, path/DAG driftu, nečistém checkoutu, chybějícím independent
reviewerovi, `CHANGES_REQUIRED`, V3 materializaci před promotion, druhém nebo
overwriting V3 rootu, in-place V2 změně, kterékoli zakázané pseudo-opravě,
runtime importu nebo live/system/provider/model/T3 effectu.

Pravdivý stav do dalšího promoted kroku je:

```text
V1: STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE
V2: STATIC_CHANGES_REQUIRED_UNSEALED / NO_RUNTIME / DO_NOT_CONTINUE
V3: NOT_MATERIALIZED until canonical 034 promotion
B3 Phase B: STOPPED_T3_TERMINAL_FAILURE
B4 / Gate 1 / B5 / B6 / Gate 2: BLOCKED
```
