# 033 — H0 V1 static failure a jediná V2 remediation

- **typ:** prospective docs-only failure binding a one-shot static remediation
- **stav V1:**
  `STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE / NO_ACCEPTANCE`
- **stav amendmentu:**
  `DOCS_ONLY_STATIC_REMEDIATION / NO_RUNTIME_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision:**
  `859c913bd69e339f2778f03bc0036ae55bb82037`
- **baseTree:** `f9814703f06ed0e7f78af2c677e308c9181c1940`
- **předchůdce:**
  [`032`](032-m1-closeout-authority-gap-reconciliation.md)
- **WP:**
  [`WP-M1-H0-STATIC-REMEDIATION`](../wp/WP-M1-H0-STATIC-REMEDIATION.md)
- **rezervovaný report:**
  `docs/execution/runs/wp-m1-h0-static-remediation-20260817-report.md`

Decision 032 dovolilo po své promotion materializovat a staticky zreviewovat
právě jeden nový plán `H0 / HEADLESS_NO_MODEL_BASELINE_ONCE`. Toto povolení je
spotřebované V1 rootem níže. Dvě nezávislá statická review skončila
`CHANGES_REQUIRED` ještě před runtime. V1 se proto nesmí spustit, přijmout,
opravit in-place ani přeznačit na PASS.

Tento amendment nejprve pouze zapisuje červený V1 výsledek do canonical Git
historie. Až jeho vlastní Review A, candidate Review B a canonical promotion
smějí odemknout přesně jednu novou non-clobber **statickou** V2 materializaci.
Nejde o H0 runtime retry a nevzniká tím T3, Gate 1 ani jiná downstream authority.

## 1. Byte-exact V1 a absence runtime

Jediný V1 root je:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-20260817T165236Z.c6rKZuEG
```

Root vznikl jako non-clobber adresář na device `30`, inode `13657894`, mode
`0700`, UID/GID `1000/1000`; birth time je
`2026-08-17 18:52:40.831973419 +0200`. První materializer před přerušením
vytvořil pouze tento root a prázdné podadresáře. Další dva materializační
pokusy byly zastaveny bez druhého rootu. Následná práce pokračovala výhradně v
tomto jediném rootu; tato lineage se nesmí skrýt ani vydat za dva plány.

Sealed V1 snapshot je:

| Cesta relativně k rootu | SHA-256 | Bytes | Mode |
|---|---|---:|---:|
| `plan/h0-plan.json` | `6a25cac18e41f066f3d9a2f638b9c95b64a3c3588f842578acfa87ad513bd664` | 23 199 | `0400` |
| `plan/h0-plan.sha256` | `1d32b1222c3f766265df2508daec802c0e8c72cd982a5c2652c802bd215b78ea` | 79 | `0400` |
| `runner/run-h0.py` | `0afbae84d37b99bd9f5effc32aac44c1397a0d4555011393ce40b75cb3a9a302` | 88 761 | `0500` |
| `runner/run-h0.sha256` | `ee722c1feb30f1d39d5f668f7d6de4ca1ba92003724e6def00d5872195a2b6c9` | 76 | `0400` |
| `materialization-manifest.json` | `afcda074e6b25373d93a127355d17b6751e4808c7c95c3e81077693149303219` | 2 522 | `0400` |

Adresáře `plan/`, `runner/` a `evidence/` jsou mode `0700`; všechny uvedené
soubory i adresáře jsou UID/GID `1000/1000`, regular file/directory podle role,
bez symlinků a s link count `1`. `evidence/` byl při obou review a při tomto
reconciliation prázdný. Nebyl vyvolán žádný runner mode, `systemd-run`,
`systemctl isolate/start/stop/kill`, Ollama/provider request, NVIDIA/model/T3
effect ani H0 sample. Výsledek je přesně:

```text
V1_STATIC_REVIEW: CHANGES_REQUIRED
V1_RUNTIME: NOT_RUN
V1_EFFECTS: NONE
V1_ACCEPTANCE: NOT_ISSUED
V1_DISPOSITION: DO_NOT_EXECUTE
DECISION_032_ONE_PLAN_ALLOWANCE: CONSUMED
```

Vnitřní V1 string `MATERIALIZED_AWAITING_EXACT_OPERATOR_ACCEPTANCE` je pouze
status privátního plánu. Neprokazuje canonical receipt ani operátorskou
akceptaci a po červených review nesmí být přijat.

## 2. Dvě nezávislá `CHANGES_REQUIRED` review

V1 posoudili dva revieweři odděleně od writera:

| Review | Scope | Sealed artifact | SHA-256 | Verdict |
|---|---|---|---|---|
| `/root/h0_static_review_final` | formal static regression, closure, AST a fail-closed invariants | `/home/belphareon/.local/share/intentsmith-private/m1-h0-v1-static-review-a-20260817T182513Z/review-result.json` | `10ce987f3ccb25375232f2c7a34ef5f18179d4c2b396e3c64ba2a38a56593005` | `CHANGES_REQUIRED` |
| `/root/h0_callgraph_review_final` | skutečný launcher/unit/post/restore/evidence call graph | `/home/belphareon/.local/share/intentsmith-private/m1-h0-v1-callgraph-review-b-20260817T182513Z/review-result.json` | `8ad1b70cb19ba7bb5637e4ddcf73020ec54b38b5f94ab60bd1fb5aed0465009c` | `CHANGES_REQUIRED` |

První result má 4 282 bytes, druhý 3 324 bytes; oba jsou mode `0400`. Jejich
non-clobber recorder bundles dále vážou:

| Review root | Manifest SHA-256 / bytes | Detached-file SHA-256 / bytes |
|---|---|---|
| `m1-h0-v1-static-review-a-20260817T182513Z` | `c7cd55e82090adb55261a346a1ee190429f42851693a5cf9428499c982f59e0a` / 847 | `17fa9b98e56687f2e617664b3801fb02d655ddd327a181134a34fbc359f5f13a` / 89 |
| `m1-h0-v1-callgraph-review-b-20260817T182513Z` | `1cf7ee7153ef31aa21d193b740c5bb19a0e0147e0d8d9b0f99f071b63f4c2ef9` / 859 | `35f3f27132ed7658f0ceac4220a675f274e57d688da338a767bcc7340189da58` / 89 |

Oba roots jsou mode `0700`; jejich tři files mode `0400`, UID/GID
`1000/1000`, nlink `1`. Closure, declared result digest a detached manifest
digest byly znovu ověřené. JSON klasifikace je přesně
`RECORDED_BY_COORDINATOR_FROM_INDEPENDENT_REVIEW_MESSAGE_NOT_SELF_AUTHORITY`:
recorder `/root` pouze non-clobber zachytil zprávy původních nezávislých
reviewerů uvedených v tabulce. Recorder bundle sám nevyrábí review ani effect
authority. Suffixy `review-a`/`review-b` v private root names jsou identifikace
dvou V1 static review záznamů; nejsou canonical Review A/B tohoto amendmentu.
Reviewer message timestamps nejsou v recorder záznamu vystavené a nesmějí se
domýšlet.

### 2.1 Aggregate blocker allowlist

Oba červené verdicty a všechny nálezy zůstávají zachované. V2 musí opravit
každý bod a nové review jej musí znovu napadnout:

1. Privátní acceptance self-claim neověřuje canonical řetězec
   `S -> E_A -> C -> E_B -> promotion`; V1 dovoluje odvodit autoritu ze svých
   vlastních bytes.
2. Přímý `post` může přes `emergency_restore` provést `graphical.target` a
   service efekty bez acceptance, identity vlastní jednotky a validního
   prestate.
3. Před isolate neexistuje jeden kumulativní, bezprostředně znovu změřený gate;
   dílčí preflighty mohou mezi kontrolou a efektem zestárnout.
4. Outer safety stop spoléhá na jméno jednotky. Nepinuje vlastní
   `InvocationID`, exact `ExecStart`/`ExecStopPost` argv, cgroup a PID
   start-time identity ani neověřuje post-stop liveness.
5. Restore unit/binary/service piny se ověřují až po možném effectu, takže
   restore cesta není před isolate prokázaná.
6. Measurement PASS může vzniknout před seal/restore a osiřet; failure closure
   navíc mylně podmiňuje pravdivé uzavření dostupností post-run API.
7. Outcome původně označený `PRE_EFFECT` může následovat effectful restore a
   zůstat bez pravdivé reclassifikace.
8. Full-root closure se kontroluje až post-effect a manifest není sám runtime
   navázaný na vnější canonical/review receipt.
9. Running Python interpreter a skutečně prováděný runner nejsou před efektem
   úplně svázané přes `/proc/self/exe`, otevřený FD, inode/dev/start identity a
   hash.
10. NVIDIA `pmon` parser může malformed řádek `0 -` vyložit jako prázdný
    compute list.
11. Pinned RustDesk unit obsahuje broad `ExecStop=/usr/bin/pkill -f ...` a
    `KillMode=mixed`; `systemctl stop rustdesk.service` proto neřeší PID reuse,
    argv/cgroup TOCTOU ani whole-cgroup identity. To zároveň odporuje obecnému
    forbidden-text tvrzení, přestože runner sám přímý `pkill` nespouští.
12. Kombinace timeoutů `3300/3600` a `720/900` není skutečný horní bound;
    vnější čekání může skončit dřív než vnitřní práce a restore/finalizace.

### 2.2 Co staticky prošlo

Červený verdict nemaže pozitivní dílčí důkazy. Obě review potvrdila sealed
snapshot digests/modes/pins, syntakticky validní Python a AST omezení, nejvýše
dva vzájemně výlučné outer `ollama ps` call sites v runtime call graphu, nula
headless provider/model/T3 requestů, žádný shell a žádný přímý runner `pkill`,
`chown`, `safe.directory` ani source `chmod`, non-clobber `O_EXCL/O_NOFOLLOW`
lifecycle, vazbu SSH na `Service=sshd` + ancestry a požadované target states v
každém sample. Statická kontrola také připnula pozorovaný `pkill` symlink a
resolved binary a vyjmenovala matching non-RustDesk command lines; tím ale
neuzavřela atomický kill radius ani TOCTOU broad `ExecStop`. Tyto PASS body
nejsou aggregate PASS a V1 neodemykají.

### 2.3 Zachované false alarms a review-tool chyby

Pro úplnost zůstávají zaznamenané i odmítnuté nálezy a chyby review příkazů:

- tři syntaktické výskyty `ollama ps` neznamenaly tři runtime volání; skutečný
  outer call graph dovoloval nejvýše dva a byly vzájemně výlučné;
- jeden Git glob vrátil prázdný výsledek, následná exact blob kontrola prošla;
- jeden `rg` běžel z nesprávného cwd;
- starý pre-seal `__pycache__` existoval během draftu, ale před sealed review
  byl odstraněn a není součástí V1 snapshotu;
- pomocné AST escaping a filesystem `%w` příkazy měly tooling chyby; po opravě
  nezměnily červené verdicty.

False alarms se nesmějí vydat za blocker ani použít k oslabení dvanácti
potvrzených nálezů.

## 3. Canonical receipt před jedinou V2 materializací

V2 private filesystem materialization je sama effect. Nesmí začít na tomto
subjectu ani po samotném Review A. Povinný Git řetězec je:

```text
I1 = 859c913bd69e339f2778f03bc0036ae55bb82037
  -> S_H0R (exact čtyřcestný docs-only subject)
  -> E_A_H0R (jediná report-only cesta; independent Review A)
  -> C_H0R (merge current canonical integration + E_A_H0R)
  -> E_B_H0R (stejný report, append-only independent Review B)
  -> integration/m1-consolidated-20260810 --ff-only promotion
  -> exactly one V2 non-clobber static materialization
```

`S_H0R` smí změnit přesně:

```text
docs/decisions/033-m1-h0-static-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-STATIC-REMEDIATION.md
```

Rezervovaný report v subjectu musí být absent. `E_A_H0R` jej vytvoří jako svou
jedinou změnu a zapíše pouze base/subject/Review-A receipt. `E_B_H0R` smí pouze
appendnout exact candidate a Review-B receipt; report nikdy nepíše SHA commitu,
který jej právě vytváří. Writer, Review A a Review B jsou různé identity;
candidate ani canonical se neposunou po `CHANGES_REQUIRED`.

První úspěšné non-clobber vytvoření V2 rootu spotřebuje celou V2 materializační
autoritu, i kdyby materializer následně selhal. Partial root zůstane zachovaný
a nevznikne sourozenecký retry bez nového canonical rozhodnutí. V1 root se
nikdy nemění.

## 4. Povinný V2 kontrakt

V2 je nový byte-exact static subject, ne edit V1. Před vlastním static review
musí mít status `MATERIALIZED_AWAITING_STATIC_REVIEW / NO_RUNTIME_AUTHORITY`;
nesmí tvrdit acceptance. Obsahuje plán, runner, detached digests, self-excluding
materialization manifest, explicitní root-entry closure a prázdný evidence
adresář. Následující body jsou všechny acceptance criteria, nikoli doporučení.

### 4.1 Vnější canonical a runtime receipt

- V2 materializer před prvním `mkdir` znovu ověří exact promoted
  `E_B_H0R`, jeho ancestry, report append a čistý canonical checkout.
- Budoucí runtime nesmí věřit private `accepted=true` ani CLI self-claimu.
  V2 musí posoudit dva nezávislí static revieweři. Oddělené budoucí canonical
  rozhodnutí pak musí byte-bindnout V2 plan, runner, celý root manifest, oba
  review artefakty a jejich verdicty přes nový immutable řetězec
  `S_V2 -> E_A_V2 -> C_V2 -> E_B_V2 -> canonical promotion`; private review
  self-claim ani shodný tree bez ancestry nestačí.
- Teprve po obou V2 static PASS a jejich canonical promotion může proběhnout
  čerstvý read-only preflight pro nový acceptance subject. Preflight musí
  prokázat právě živou remote tty s `sshd` ancestry a logind vazbou, dokončený
  graphical logout a absenci graphical session i out-of-service RustDesk GUI
  procesu. Uložení GUI stavu není strojově prokazatelný read-only fakt;
  operátor je musí výslovně deklarovat v novém exact acceptance blocku.
- Exact user block ani chat label není canonical effect receipt. Jeho detached
  digest, úplný V2/static-review binding, preflight snapshot a exact effect
  envelope musí projít vlastním tracked řetězcem
  `S_ACC -> E_A_ACC -> C_ACC -> E_B_ACC -> canonical --ff-only promotion`.
  Obě review obálky jsou report-only a nezávislé; runtime smí následovat až po
  promotion a bezprostředním no-drift revalidation gate.
- Decision 033 takové V2 review receipts, operátorský acceptance block ani
  runtime authority samo nevydává. `CHANGES_REQUIRED/BLOCKED` nemá retry
  autoritu a V1/032 receipt je pro V2 nepřenosný.

### 4.2 Přímý `post` je bez live effectu

Přímé spuštění `post` mimo exact vlastní transient unit smí jen fail-closed
zjistit stav a případně non-clobber zaznamenat, že live restore nebyl proveden.
Nesmí volat `isolate`, `start`, `stop`, `kill`, signalovat proces, měnit target,
service, session, síť, Ollamu ani GPU/model state. Effectful restore smí být
dostupný pouze vnitřnímu procesu exact přijaté jednotky s ověřeným
`InvocationID` a pre-effect journalem. Negativní static test prokáže, že direct
`post` nemá hranu k live-effect wrapperům.

### 4.3 Jeden bezprostřední kumulativní pre-isolate gate

Před jakýmkoli transient-unit, `/run` nebo daemon-reload effectem proběhne
read-only G0 nad canonical receipt, full V2 root closure, actual interpreter/
runner, Git/head/tree/UID-1000 isolation, fresh SSH/logout, target/service
prestate, restore pins, RustDesk identities, Ollama active/empty stav, GPU/
compute/display procesy, absencí jiné H0 jednotky a accepted resource/time
bounds. G0 mismatch je `BLOCKED_NO_LIVE_EFFECT`.

Vytvoření vlastní transient unit, instalace runtime drop-inu nebo první
daemon-reload monotonně mění classification na `CONTROL_EFFECT_ATTEMPTED`.
Uvnitř exact vlastní jednotky se potom bezprostředně před jediným isolate
effectem znovu v jednom kumulativním fail-fast snapshotu ověří **všechny** G0
preconditions plus vlastní unit identity a exact effective drop-in properties.
Mismatch po control effectu je `BLOCKED_AFTER_CONTROL_EFFECT`; spustí bounded
cleanup/original-state proof a nikdy se nepřeznačí na pre-effect. Mezi posledním
úspěšným kumulativním gate a isolate nesmí být jiný subprocess, sleep, API call
ani evidence publish.

### 4.4 Identita vlastní jednotky a safety stop

Outer launcher při vytvoření jednotky zachytí a před každým safety stopem
znovu porovná nejméně exact unit name, `InvocationID`, `ControlGroup`,
`ExecStart` i `ExecStopPost` argv, `MainPID`, `/proc/<pid>/stat` start time, exe
inode/dev/hash a cgroup membership. Jméno samo nestačí. Signal/stop je dovolen
jen při úplné shodě; mismatch je `SAFETY_STOP_IDENTITY_MISMATCH` bez signálu a
bez pokusu zasáhnout náhradní PID. Po stopu se ověří liveness původního
PID+start-time, původní InvocationID a cgroup. Osiřelá nebo znovupoužitá
identita je explicitní FAIL/BLOCKED evidence, nikdy success.

Safety stop vlastní H0 transient unit a stop `rustdesk.service` jsou dvě různé
autority. Ani jedna nesmí cílit podle samotného názvu, PID nebo argv substringu
a žádná se nesmí opakovat jako retry.

### 4.5 Restore je připnutý před prvním efektem

Ještě před isolate se zachytí a rehashne restore target, seznam přesně
pre-active služeb, všechny effective unit fragments/drop-ins/symlinky,
executable binaries, effective properties a ordered restore postup. Restore
nesmí použít byte-drifted fragment ani službu, která nebyla pre-active.
Neexistuje-li před efektem validní restore closure a dostatečný deadline
reserve, isolate se nespustí.

Piny rozlišují původní vendor stav, dočasný accepted override a očekávaný
post-cleanup vendor stav. Nestačí zjistit až při restore, že se unit fragment,
drop-in set, binary nebo pre-active service změnily. Každý cleanup smí odstranit
jen exact inode/hash vytvořený tímto během; cizí nebo drifted entry se zachová a
výsledek je `FAIL_RESTORE` s residual disclosure.

### 4.6 Žádný orphan PASS a pravdivá failure closure

Measurement success se zapisuje pouze jako
`MEASUREMENT_PASS_PENDING_RESTORE`; veřejný/sealed H0 PASS nesmí existovat před
úspěšným restore, postflightem a final evidence closure. Finální PASS se
publikuje non-clobber až jako poslední manifest-bound outcome.

Jakmile byl byť jen **pokus** o live effect, stav se monotonně mění z
`NO_LIVE_EFFECT` na `EFFECT_ATTEMPTED` a žádná pozdější restore větev jej nesmí
vrátit na `PRE_EFFECT`. Inner journal fsyncuje hranici před a po každém efektu;
outer closure z něj umí bez provider API uzavřít `RESTORE_FAILED`,
`POST_PROVIDER_UNVERIFIED`, `UNIT_DIED` nebo `OUTCOME_UNSEALED`. Druhý outer
`ollama ps` je nutný pro PASS, ale jeho chyba nesmí zabránit zapečetění
pravdivého non-PASS výsledku. Power loss, kernel failure a PID 1 failure nelze
absolutně zakrýt; případná chybějící closure zůstává `UNKNOWN/INCOMPLETE`, ne
PASS.

### 4.7 Full root closure a skutečný runtime executable před efektem

Budoucí canonical runtime receipt musí připnout digest V2
`materialization-manifest.json`, takže manifest není vlastní autoritou.
Pre-effect walk přes dirfd + `O_NOFOLLOW` porovná exact allowed root entries,
types, modes, UID/GID, device/inode/link count, bytes a SHA; `evidence/` musí
být před startem prázdný a nesmí existovat pycache, temp nebo undeclared file.

Runner se otevře přes `O_NOFOLLOW`, hashne z téhož FD a porovná fstat s
reviewed path stat a `/proc/self/fd`. Interpreter se ověří přes
`/proc/self/exe`, `/proc/self/cmdline`, inode/dev/link count/mode/UID/GID/bytes
a SHA proti accepted pinu. Stejně se před efektem ověří každý skutečně
spouštěný tool a unit fragment. Path-only nebo hash jiné kopie nestačí.

### 4.8 Strict NVIDIA parser

V2 nesmí interpretovat malformed/sentinel řádek jako prázdný procesní seznam.
Preferovaný machine-readable query výstup má exact počet polí a grammar; PID
musí být kladné celé číslo, memory nezáporné celé číslo a GPU UUID exact
accepted UUID. `0`, `-`, `N/A`, extra/chybějící pole, duplicate PID, neexistující
`/proc/<pid>` nebo neznámý řádek jsou `GPU_PARSE_BLOCKED/INCONCLUSIVE`, nikdy
compute count `0`. Použije-li se `pmon`, jeho header, sentinel a data grammar
mají oddělené parser paths a regresní fixture `0 -` musí fail-close.

### 4.9 Jeden pravdivý monotonic timeout budget

Plán deklaruje jediný monotonic total deadline a samostatně rezervuje safety
stop, restore, local failure closure a evidence seal. Každý child timeout je
`min(accepted_child_cap, remaining_deadline_minus_reserve)` a zahrnuje
terminate/kill/wait. Vnitřní max musí být menší než transient
`TimeoutStartSec`; outer wait musí být delší než unit timeout plus stop/closure
margin. Static validator musí matematicky odmítnout vztahy typu `3300 < 3600`
a `720 < 900`, loop-násobení i child bez timeoutu. Vypršení kterékoli vrstvy
vede k safety-stop/restore failure workflow a nemůže vytvořit PASS.

Minimální exact child caps jsou: každý daemon-reload `45 s` (nejvýše jeden
install reload a nejvýše dva cleanup reloads), RustDesk stop subprocess `45 s`
pro vendor `TimeoutStopSec=30 s`, následný inactive wait nejméně `45 s`, každý
graphical restore isolate `180 s` a každý accepted pre-active service start
`90 s`. Třicet samples se do boundu počítá včetně všech subprocessů a sleepů,
ne jako pouhých 30 sekund.

Plán musí strojově expandovat a ověřit alespoň tyto striktní nerovnosti:

```text
T_primary = T_preflight + 45_install_reload + T_isolate
          + 45_rustdesk_stop + T_inactive_wait + T_settle
          + T_all_30_samples + T_primary_restore_and_seal
TimeoutStartSec > T_primary
TimeoutStopSec > T_fallback_restore_and_local_failure_closure
T_outer_wait > TimeoutStartSec + TimeoutStopSec + T_outer_margin
```

`T_primary_restore_and_seal` zahrnuje graphical restore `180 s`, každý možný
pre-active service start `90 s`, všechny verification calls, až dva cleanup
reloads po `45 s` a evidence seal. Každé opakování ve větvi se násobí do
worst-case; fallback se nesmí schovat za primary budget.

Každý wrapper atomicky spotřebuje class counter **před** spawnem; overflow je
no-spawn failure. V2 accepted maxima jsou:

| Command class | Maximum | Per-call timeout / další pravidlo |
|---|---:|---|
| Git | 12 | `30 s` |
| `loginctl` | 39 | `5 s` |
| NVIDIA query | 105 | `5 s` |
| `systemctl show` | 134 | `5 s` |
| `systemctl list-units` | 2 | `5 s` |
| outer `ollama ps` | 2 | `20 s`; PASS vyžaduje přesně 2 |
| daemon-reload | 3 | `45 s`; install 1 + normal cleanup 1 + safety cleanup retry 1 |
| isolate multi-user | 1 | `180 s` |
| stop RustDesk | 1 | `45 s`; attempt spotřebuje autoritu |
| isolate graphical | 2 | `180 s` |
| start RustDesk | 2 | `90 s` |
| start Ollama | 2 | `90 s` |
| stop own transient | 1 | `120 s` |
| `systemd-run` | 1 | jediný exact transient start |

Poll loops mají `range(10)`, read timeout `5 s` a nejvýše devět sleepů na
loop; `/proc`/session walk má limit `2 s` a accepted cardinality. RustDesk stop
má 45s client cap a následný nejvýše desetiprvkový show poll s vlastním
59s worst-case; stop se neopakuje.

Nezávislý budget calculator nad skutečným V2 call graphem musí reprodukovat
`T_execute=2279 s` a `T_post=682 s`. Z nich plyne
`ceil(1.2 * T_execute)=2735 s` a `ceil(1.2 * T_post)=819 s`; accepted volby jsou
`TimeoutStartSec=3600`, `TimeoutStopSec=900` a outer wait `5000 s`, protože
musí být striktně větší než `3600 + 900 + 300 = 4800 s`. JSON label ani author
výpočet není důkaz; oba V2 revieweři maxima a inequalities z call graphu
nezávisle přepočítají.

### 4.10 RustDesk exact dočasný bounded override

Současný vendor unit fragment s broad
`ExecStop=/usr/bin/pkill -f "rustdesk --"` a `KillMode=mixed` se nesmí zastavit
bez override. Ani `systemctl kill` není bypass: po úspěšně nastartované službě
může systemd při následném stop lifecycle stále spustit `ExecStop`. Zakázané
jsou proto přímý `systemctl kill`, `pkill`, `killall`, name/glob/argv-substring
kill i obyčejný stop pod původním unit configem.

Jediný V2 strategy candidate, který smí dva independent static revieweři
posuzovat jako budoucí effect envelope, používá přesně:

```text
path: /run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v2.conf
bytes: 43
sha256: 87f751ac676773104bbc400e38208057d4d12f8a702b8aeb4ae965984b00a9dc
payload:
[Service]
ExecStop=
KillMode=control-group
```

Payload končí jedním LF. Parent cesta i drop-in musí být před během absent.
Accepted outer ještě před transientem non-clobber publikuje
`runtime-dir-intent`, znovu prokáže absenci exact parentu i file a dovolí
vytvořit pouze exact prázdný directory root:root `0755`. Předá jeho dev/inode;
žádný existující adresář se nepřevezme. Transient s `ProtectSystem=strict`
dostane jedinou dodatečnou write výjimku
`ReadWritePaths=/run/systemd/system/rustdesk.service.d`, nikoli broad parent.

Inner nejprve fsyncne `override-intent`, potom přes parent dirfd a
`O_NOFOLLOW|O_CREAT|O_EXCL` vytvoří exact file root:root `0644`, nlink `1`,
provede full write, `fchmod`, file fsync, readback/hash/stat a directory fsync.
Následuje právě jeden install daemon-reload. Před isolate musí effective proof
prokázat:

```text
FragmentPath = původní pinned vendor fragment
DropInPaths = právě exact V2 drop-in a nic jiného
ExecStop = empty
ExecStopEx = empty
ExecStopPost = empty
KillMode = control-group
NeedDaemonReload = no
ActiveState = active
MainPID = exact live reviewed identity
ControlPID = 0
Delegate = no
```

V2 materializer musí zachytit tehdejší exact boot ID. Oba V2 static review
artefakty, celý `S_V2` řetězec, budoucí `S_ACC` receipt i runtime musí vázat
tentýž boot ID; reboot nebo drift mezi kterýmikoli z těchto kroků je blocker,
ne důvod převzít nový boot pod starou autoritou. Decision 033 samotné není
trvale navázané na jeden live boot.

Datovaný read-only **design snapshot z 2026-08-17**, nikoli budoucí preflight,
pozoroval boot ID `3e98f3d0-e8df-4ce3-b13d-cf1f5eeeba9f` a v exact
`rustdesk.service` cgroup čtyři tasky: main `rustdesk --service`, child
`/usr/bin/sudo ... --server`, RustDesk `--server` a RustDesk `--tray`,
`populated=1`, bez child cgroup. Tento snapshot odůvodňuje, proč KillMode
`control-group` záměrně přijímá signalizaci všech tasků exact service cgroup,
ne jen RustDesk executable; nesmí se vydávat za pozdější live stav.
`/usr/bin/sudo` je accepted design pin a musí být ve V2 tool/process allowlistu
se SHA-256
`136f2e48b0295b9fc595b8259cf2411ac43f27ddbfe02b956649ddaa2e92b9fa`,
mode `4755`, root:root, 277 936 bytes, device `31`, inode `1861601`, nlink `1`;
V2 materializer a každý pozdější no-drift gate jej musí znovu ověřit.

Po isolate se tentýž effective proof a všechny RustDesk PID/start-time/exe/
argv/cgroup identity ověří podruhé bezprostředně před jediným
`systemctl stop rustdesk.service`. Stop se smí vyvolat nejvýše jednou; timeout,
unknown nebo failure tuto jedinou stop autoritu spotřebuje a nesmí vést k
retry. Následuje bounded inactive wait a důkaz empty service cgroup i nulových
globálních RustDesk/display procesů před samples.

Pre-stop gate je obousměrný a dvakrát stabilní: každý globální exact RustDesk
identity i každý proces, jehož full cmdline patří do vendor `rustdesk --`
universe, musí být v exact service cgroup; současně každý rekurzivní cgroup PID
musí mít stabilní ancestry k exact MainPID a executable v plan allowlistu.
Tuple zahrnuje PID, start time, UID, exe path/dev/inode/hash, argv0, comm,
cmdline hash a cgroup. `Delegate=no` a buď nulový child cgroup, nebo úplně
vyčíslený subtree jsou povinné. Mismatch nebo race zastaví běh před stopem.

Post-stop proof vyžaduje rc `0`, `inactive/dead`, MainPID `0`, ControlPID `0`,
žádný job, cgroup absent nebo rekurzivně empty s `populated=0`, všechny staré
PID/start identity mrtvé a tři stabilní empty global scans. Global i cgroup
scan se opakuje v každém ze 30 samples a těsně před restore. Unreadable proc,
race, orphan, PID reuse nebo fallback jsou non-PASS. Jde o observed proof na
daném hostu, nikoli absolutní ochranu proti souběžnému privilegovanému aktérovi.

Safe override zůstává načtený během celého headless měření i restore. Nejprve
se obnoví graphical target a všechny přesně pre-active služby; Ollama i
RustDesk se startují a ověří ještě pod override. Teprve potom se znovu ověří
exact drop-in inode/dev/hash/mode/owner/nlink, exact unlinkne file, fsyncne
directory, odstraní directory pouze při shodném accepted inode a empty closure,
fsyncne parent a provede cleanup daemon-reload. Finální original-state proof
musí prokázat žádné drop-ins, původní pinned broad `ExecStop`,
`KillMode=mixed`, `NeedDaemonReload=no` a obnovený service/process/cgroup
prestate. PASS nesmí vzniknout před tímto důkazem.

Explicitní recovery state machine je:

| Stav | Povinné chování |
|---|---|
| A — před `mkdir` | mismatch je `BLOCKED_PRE_EFFECT`; žádný systemd/config effect |
| B — vznikl jen exact prázdný dir | exact rmdir bez daemon-reload pouze pokud `.conf` prokazatelně nikdy nevznikl |
| C — file existuje, reload neprokázán | nikdy isolate/stop; remove, cleanup reload a original-state proof |
| D — safe effective config prokázán | override zůstává přes isolate, stop, samples i celý restore |
| E — stop attempted | sole stop je spotřebovaný i při timeout/unknown; bounded wait, restore a cleanup bez retry |
| F — file odstraněn, reload uncertain | právě jeden ExecStopPost cleanup-reload retry; file se nikdy znovu nevytváří |
| G — residual nebo config mismatch | `H0_FAIL_RESTORE`, exact residual disclosure, nikdy PASS |

Outer smí exact runtime directory odstranit sám pouze tehdy, když transient
prokazatelně nikdy nevznikl a inode/empty closure přesně odpovídají intentu.
Jinak recovery vlastní exact `ExecStopPost`. Install reload má maximum `1`,
cleanup reload maximum `2` včetně jediného F retry. Jakákoli zbylá path,
drop-in, `NeedDaemonReload=yes`, původní-config mismatch nebo neobnovená
service/process/cgroup identita je `H0_FAIL_RESTORE`. Kernel/PID1/power failure
může zanechat closure `UNKNOWN/INCOMPLETE`; nesmí být přepsaná na PASS.

### 4.11 Effect ledger, fixed evidence a PASS hranice

Každý effect má před spawnem vlastní O_EXCL mode-0400 root:root
`effect-NN-intent` receipt, který se fsyncne před efektem, a non-clobber result
po něm. Každý záznam nese schema, attempt/plan/boot identity, monotonic i real
time, class/ordinal/counters, argv class+hash, before/after pins, rc/timeout a
`previousReceiptSha256` hash-chain. Unmatched intent se zachová. Final ledger
znovu ověří exact počty, argv classes, hash-chain, unmatched intents, mode,
nlink a dirfd `NOFOLLOW/EXCL/fsync` closure; self-excluding manifest získá
vnější digest z canonical receipt.

Povinná fixed evidence names zahrnují alespoň:

```text
runtime-dir-intent
runtime-dir-created
runtime-override-intent
runtime-override-created
reload-installed
rustdesk-stop-intent
rustdesk-stop-result
rustdesk-no-orphans
override-remove-intent
override-removed
reload-restored
restore-state
gate-*
sample-*
result
```

Finální PASS vyžaduje normal install a normal cleanup reload bez safety retry,
právě jeden successful RustDesk stop, třicet úplných samples, no-orphans,
absent created drop-in i directory, původní no-dropin/vendor ExecStop/
`KillMode=mixed` config, obnovené GUI a pre-active služby, empty Ollama,
post-GPU/no-T3 gates, přesně dva outer `ollama ps` a úplnou sealed receipt
closure. Jakákoli recovery nebo secondary failure může být nejvýše
`RESTORED_WITH_FAILURE`, nikdy PASS.

### 4.12 Budoucí effect eligibility není současná authority

Decision 033 tímto úzce superseduje absolutní prospective zákaz unit/config
editu v decision 032 **jen jako definici kandidátního V2 effect envelope**.
Promoted 033 samo nepovoluje vytvořit `/run` directory/file, daemon-reload,
transient unit, isolate, stop/start, reconnect ani cleanup. Tyto globální efekty
musí po V2 two-review PASS a canonical `S_V2` promotion nejprve projít fresh
preflightem z §4.1 a novým exact user blockem. Operátor v něm výslovně potvrdí,
že GUI stav uložil, a přijme GUI logout, RustDesk disconnect/reconnect, exact
43-byte `/run` payload a non-clobber lifecycle, nejvýše tři daemon-reloads,
jediný multi-user isolate, jediný RustDesk stop bez retry a bounded
restore/cleanup. Block váže V2 plan/root manifest, oba static review artefakty,
promoted 033 commit i 033 blob digest, tehdejší boot ID a diagnostic-only
`no-model/no-T3/no-retry` hranici.

Tento block se stane způsobilým effect receiptem teprve přes vlastní tracked
subject s canonical receipt dokumentem a detached digestem exact user blocku:

```text
fresh read-only preflight + exact user block
  -> S_ACC (tracked receipt + detached block digest; no runtime)
  -> E_A_ACC (report-only independent Review A)
  -> C_ACC (merge current canonical integration + E_A_ACC)
  -> E_B_ACC (append-only report; independent Review B)
  -> canonical --ff-only promotion
  -> immediate no-drift revalidation
  -> at most one eligible H0 runtime attempt
```

`S_ACC` musí vedle exact bytes a hashů zaznamenat preflight: live SSH ancestry
a logind, completed graphical logout/session absence, absent runtime drop-in
path, no drop-ins a `NeedDaemonReload=no`, exact service/MainPID/cgroup, PID1 a
tool pins, empty Ollama/GPU stav a absenci jiné H0 unit. Obě independent review
ověří receipt, detached digest, bounded effect call graph a nulový runtime před
promotion. No-drift gate před effectem znovu ověří stejný boot ID a všechny
machine-checkable piny; GUI saved-state zůstává exact operátorská deklarace.
Static `S_V2 -> E_A_V2 -> C_V2 -> E_B_V2` řetězec tento acceptance řetězec
nenahrazuje. V1/032 acceptance je nepřenosná a žádný runtime retry ani T3
authority nevzniká. Runtime výsledek stále vyžaduje samostatné canonical
receipt DAG binding a nezávislé result review; ani provedení samo není PASS.

### 4.13 Povinný V2 static review protocol

Každý ze dvou nezávislých V2 reviewerů pracuje bez importu či spuštění runneru;
povoleny jsou JSON/source/AST a read-only filesystem/Git kontroly. Reviewer
sleduje skutečný call graph a musí nezávisle doložit nejméně:

1. V1 je byte-identické, evidence empty, `CHANGES_REQUIRED_UNEXECUTED` a bez
   authority; promoted 033 existuje a vznikl jediný nový V2 root.
2. V2 plán váže canonical commit/tree, 033 blob i SHA-256, materialization-time
   boot ID, PID1 systemd, systemctl, unit, binary a `/usr/bin/sudo` piny;
   reviews ověří, že boot ID od materializace nedriftoval.
3. Drop-in má exact path, 43 bytes, final LF a digest; žádná jiná `/run`,
   `/etc` nebo `/usr` config cesta není writable.
4. AST má jeden `shell=False` wrapper, právě jeden RustDesk stop a multi-user
   isolate a žádný `pkill`, `killall`, `systemctl kill`, edit, set-property,
   revert, daemon-reexec nebo broad restore stop.
5. Dominance je fsynced stop-intent+counter -> safe override proof -> sole stop
   bez intervenujícího effectu; restore proof -> exact unlink/rmdir -> reload ->
   original-state proof.
6. Phase-aware DropIn verifier přijímá pouze očekávané stavy empty / sole exact
   / empty a transient má jen exact evidence directory plus precreated runtime
   directory jako `ReadWritePaths`, network deny a reviewed hardening.
7. Negativní fixtures pro extra drop-in, nonempty ExecStop, mixed KillMode v
   safe fázi, NeedDaemonReload, timeout, global orphan, PID reuse, residue,
   missing receipt, counter overflow, lost prestate a fallback nemohou vytvořit
   PASS.
8. Nezávislý calculator reprodukuje class maxima, `2279/682` a všechny timeout
   inequalities; digests, closure a modes obou review artefaktů jsou přesné.

Teprve dva PASS výsledky tohoto protokolu mohou vstoupit do budoucího
`S_V2 -> E_A_V2 -> C_V2 -> E_B_V2` static receipt. Static review ani jeho
promotion samy nevytvářejí effect authority; tu může podmíněně vytvořit až
oddělený promoted `S_ACC` řetězec z §4.12 bez boot/pin driftu.

## 5. Co tento amendment výslovně nepovoluje

Ani promoted 033 nepovoluje V1 edit/run/acceptance, H0 V2 runtime, direct-post
restore, systemd/service/display/session/process effect, SSH mutation,
Ollama/provider/network request, GPU/model load/unload, Q4, T3, proof/CAS,
credential/DB/config/user-data effect, B3 Phase-B continuation, B4, Gate 1, B5,
B6 ani Gate 2. Povolena je pouze jedna non-clobber V2 **static** materializace
po exact canonical promotion receiptu a její read-only independent review.

## 6. Stop conditions

`CHANGES_REQUIRED/BLOCKED` při chybějícím V1 review artefaktu, digest/mode/root
driftu, placeholderu v commitu, reportu přítomném v subjectu, path/DAG driftu,
Review-A/B ne-PASS, pokusu materializovat V2 před promotion, druhém V2 rootu,
in-place opravě V1, chybějícím kterémkoli V2 požadavku, nebezpečné RustDesk
strategii nebo jakémkoli live/runtime/model/T3/downstream effectu. Failure
evidence se zachová non-clobber; nic se nepřeznačuje zeleně.
