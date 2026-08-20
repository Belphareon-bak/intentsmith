# WP-M1-H0-STATIC-REMEDIATION — canonical V1 failure a bounded V2 static remediation

**Typ:** docs-only governance subject; po promotion právě jedna private
non-clobber static materializace · **Slot:** jediný writer v izolovaném
disk-backed worktree

**Rozhodnutí:**
[`033`](../decisions/033-m1-h0-static-remediation.md)

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:**
`859c913bd69e339f2778f03bc0036ae55bb82037`

**Stav:**
`V1_STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE / NO_ACCEPTANCE`

## 1. Cíl a hranice

WP canonical byte-bindne jediný H0 V1 root, jeho prázdné evidence a dvě
nezávislá `CHANGES_REQUIRED` static review. Decision 032 one-plan allowance je
spotřebované; V1 se neopravuje ani nespouští. Teprve promoted docs receipt může
povolit jeden nový non-clobber V2 static root s opravami všech review nálezů.

Tento WP nemá H0 runtime, T3, Gate 1 ani jinou live authority. V2 materializace
je static subject pro další review, ne acceptance ani retry run.

## 2. Owned paths

Immutable subject `S_H0R` smí změnit přesně:

```text
docs/decisions/033-m1-h0-static-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-STATIC-REMEDIATION.md
```

V subjectu musí být absent:

```text
docs/execution/runs/wp-m1-h0-static-remediation-20260817-report.md
```

Po Review A smí report-only `E_A_H0R` vytvořit právě tuto rezervovanou cestu.
Po Review B smí `E_B_H0R` změnit pouze tentýž report appendem. Candidate nemění
subject blobs.

**Zakázané:** jakýkoli jiný tracked path, source/runtime/test/registry/package,
existující report, V1 private bytes, user DB/config, SSH/service/display/GPU/
Ollama/model/API effect, push/force-push/tag/release/history rewrite a cleanup
cizího worktree.

## 3. Exact V1 binding

Root:

```text
/home/belphareon/.local/share/intentsmith-private/m1-h0-headless-no-model-20260817T165236Z.c6rKZuEG
```

Povinné digests jsou:

```text
plan/h0-plan.json              6a25cac18e41f066f3d9a2f638b9c95b64a3c3588f842578acfa87ad513bd664
runner/run-h0.py               0afbae84d37b99bd9f5effc32aac44c1397a0d4555011393ce40b75cb3a9a302
materialization-manifest.json  afcda074e6b25373d93a127355d17b6751e4808c7c95c3e81077693149303219
```

Plný detached-file binding, sizes, modes, root lineage, review artefakty,
findings, dílčí PASS a false alarms jsou normativně v decision 033. `evidence/`
je prázdný, V1 runtime je `NOT_RUN`, efekt `NONE`, acceptance `NOT_ISSUED` a
disposition `DO_NOT_EXECUTE`.

## 4. Review a promotion DAG

```text
I1=859c913bd69e339f2778f03bc0036ae55bb82037
  -> S_H0R
  -> E_A_H0R (report-only independent Review A)
  -> C_H0R (merge current canonical integration + E_A_H0R)
  -> E_B_H0R (append-only report; independent Review B)
  -> canonical --ff-only promotion
  -> one V2 non-clobber static materialization
```

Review A i B jsou jiné identity než writer a znovu nezávisle ověří exact V1
bytes, empty evidence, oba sealed private review artefakty, všech dvanáct
aggregate blockerů, pozitivní dílčí kontroly i false alarms. Review B běží nad
exact immutable candidate, ověří ancestry a byte-identitu subjectu. Jakákoli
změna subject blobu po Review A ruší receipt.

Report A obsahuje přesně:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 859c913bd69e339f2778f03bc0036ae55bb82037
subjectHead: <full S_H0R>
reviewA.verdict: PASS
```

Report B pouze připojí:

```text
candidateHead: <full C_H0R>
reviewB.verdict: PASS
```

`CHANGES_REQUIRED/BLOCKED` nevytvoří candidate/promotion ani V2 authority.

## 5. Jediný povolený V2 materializační effect

Až po ověření promoted `E_B_H0R` smí materializer jednou non-clobber vytvořit
nový private root s unikátní V2 identitou. Před prvním `mkdir` musí být target
absent a používá se `O_EXCL/O_NOFOLLOW`, owner-only modes, fsync a hardlink/
rename postup, který nikdy nepřepíše existující cestu.

První vytvořený V2 root spotřebuje authority i při partial failure. Partial
root se zachová, nevzniká druhý root a V1 zůstane byte-identický. V2 materializer
nespouští runner ani jeho mode, Python compile/import s side effects, systemd,
service, Ollamu, NVIDIA sample, provider/model/T3 ani external API.

V2 root před review obsahuje pouze reviewed-plan candidate, runner, detached
digests, materialization/root closure, samostatný bounded RustDesk strategy
artefakt a prázdný `evidence/`. Status je
`MATERIALIZED_AWAITING_STATIC_REVIEW / NO_RUNTIME_AUTHORITY`.

V2 musí posoudit dva nezávislí static revieweři. Jejich případné PASS artefakty
a exact V2 bytes musí následně projít novým canonical
`S_V2 -> E_A_V2 -> C_V2 -> E_B_V2 -> promotion`; ani tento WP, jeho Review
A/B, ani samotné private reviews budoucí runtime neautorizují.

V2 materializer zachytí tehdejší boot ID. Oba static reviews, `S_V2` promotion,
pozdější acceptance receipt a runtime musí bindnout tentýž boot; reboot nebo
drift blokuje pokračování. Boot/cgroup údaje z decision 033 jsou výslovně jen
datovaný 2026-08-17 design snapshot a budoucí preflight je musí znovu změřit.

## 6. V2 acceptance matrix

Review V2 musí všechny řádky vyhodnotit; jediný chybějící řádek znamená
`CHANGES_REQUIRED`:

| ID | Povinný invariant |
|---|---|
| V2-01 | runtime authority je vnější canonical receipt, nikdy private self-claim; 033 žádný runtime receipt nevydává |
| V2-02 | direct `post` nemá call-graph hranu k target/service/process/provider/model effectu |
| V2-03 | read-only G0 před control effectem a jeden cumulative gate znovu měří všechny preconditions bezprostředně před isolate; pozdější mismatch se pravdivě klasifikuje effectful |
| V2-04 | safety stop váže vlastní unit name + InvocationID + cgroup + exact ExecStart/ExecStopPost argv + PID start-time/exe a ověřuje post-liveness |
| V2-05 | restore target, pre-active services, fragments/drop-ins, binaries, properties a deadline jsou připnuté před efektem |
| V2-06 | measurement success zůstává pending; PASS vznikne až po restore/postflight/final seal a nemůže osiřet |
| V2-07 | první effect attempt monotonně mění outcome; effectful restore se nikdy nejmenuje PRE_EFFECT |
| V2-08 | failure closure se zapečetí i bez post API; neověřený provider je explicitní non-PASS field |
| V2-09 | accepted external digest váže celý root manifest; pre-effect walk odmítne undeclared file i nonempty evidence |
| V2-10 | `/proc/self/exe`, cmdline, actual runner FD/stat/hash a každý skutečný tool jsou navázané před efektem |
| V2-11 | strict NVIDIA parser odmítne `0 -`, sentinel, N/A, malformed, duplicate a neexistující PID jako empty |
| V2-12 | jeden monotonic deadline se správnými reserve inequalities a exact 45/180/90s child caps je skutečný horní controller bound |
| V2-13 | RustDesk používá pouze exact reviewed `/run` override `87f751ac…9dc`, sole stop, loaded-through-restore a exact cleanup/original-state proof; žádný `systemctl kill` ani inherited pkill |
| V2-14 | nula headless provider/model/T3 requestů; max dva outer `ollama ps` jsou pre a post-restore a non-PASS closure na nich nezávisí |

Podrobná normativní sémantika každého řádku je decision 033 §4. Reviewer musí
sledovat skutečný call graph a negativní větve, ne názvy funkcí nebo zelený
author test.

Budoucí effect eligibility má pevné pořadí:

```text
promoted 033
  -> exactly one V2 static materialization
  -> two independent V2 static reviews
  -> separate canonical S_V2 -> E_A_V2 -> C_V2 -> E_B_V2 -> promotion
  -> fresh live sshd/logind + completed graphical logout/session-absence preflight
  -> exact user block including explicit operator declaration that GUI state is saved
  -> S_ACC tracked receipt+detached digest
  -> E_A_ACC -> C_ACC -> E_B_ACC report-only reviews and canonical promotion
  -> immediate same-boot/no-drift revalidation
  -> at most one eligible H0 runtime attempt
```

Budoucí exact user block a tracked `S_ACC` receipt musí byte-bindnout V2 plan,
root manifest, dva static PASS artefakty, promoted 033 commit/blob digest,
materialization boot ID a fresh preflight. Musí výslovně přijmout exact
43-byte drop-in na
`/run/systemd/system/rustdesk.service.d/90-intentsmith-h0-v2.conf`, jeho
root:root `0755/0644` non-clobber lifecycle, install/cleanup daemon-reloads,
target isolate, sole RustDesk stop, dočasné odpojení, restore/start a residual
failure semantics z decision 033 §4.9–4.13; výslovně také diagnostic-only,
no-T3 a no-retry. Preflight strojově prokazuje současnou SSH/logind vazbu,
completed logout/session absence, absent runtime path, original drop-in/
`NeedDaemonReload=no`, service/MainPID/cgroup/PID1/tool pins, empty Ollama/GPU a
absenci jiné H0 unit. Uložení GUI stavu deklaruje operátor, nikoli preflight.
Bez promoted `S_ACC` DAG a immediate no-drift gate jsou všechny efekty
zakázané. Runtime výsledek dále potřebuje vlastní canonical receipt binding a
nezávislý result review; samotné provedení není PASS.

## 7. Focused writer verification

Před commitem `S_H0R`:

```text
git diff --no-renames --name-only I1..S_H0R = exact four-path allowlist
reserved report path absent in S_H0R
no unresolved placeholder token in any subject blob
V1 plan/runner/manifest + detached digest hashes/modes/sizes = decision 033
V1 evidence directory entry count = 0
both reviewer-owned sealed artifacts hash/mode/path = decision 033
decision/WP blocker sets and V2 matrix are lossless
node tests/artifact-validation.test.js = PASS
node scripts/validate-test-registry.js --json = PASS
node tests/repository-hygiene.test.js = PASS
git diff --check = PASS
git status --porcelain=v1 --untracked-files=all = empty after commit
```

Tyto repository testy jsou docs/static evidence. Nespouští se runner,
`systemd-run`, `systemctl`, Ollama/provider, NVIDIA/model ani T3.

Review A/B navíc ověří report-only envelope, exact refs/parents/tree,
candidate clean state, immutable subject blobs a nulový source/runtime/private
artifact delta.

## 8. Stop conditions

Zastavit při V1/private review driftu, neúplném nebo nepravdivém nálezu,
placeholderu, reportu v subjectu, path/DAG driftu, nečistém nebo ownership
nejasném checkoutu, chybějícím nezávislém reviewerovi, `CHANGES_REQUIRED`,
V2 materializaci před promotion, druhém/overwriting V2 rootu, in-place V1
opravě, unsafe RustDesk strategii nebo live/system/provider/model/T3 effectu.

Verdicty zůstávají pravdivé:

```text
V1: STATIC_CHANGES_REQUIRED / NO_RUNTIME / DO_NOT_EXECUTE / NO_ACCEPTANCE
V2: NOT_MATERIALIZED until canonical promotion
B3 Phase B: STOPPED_T3_TERMINAL_FAILURE
B4 / Gate 1 / B5 / B6 / Gate 2: BLOCKED
```
