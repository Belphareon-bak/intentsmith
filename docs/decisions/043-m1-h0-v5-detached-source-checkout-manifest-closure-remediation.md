# 043 — Manifest closure a folded privileged runtime gate pro poslední M1/H0 běh

- **typ:** exact four-doc governance-only remediation; žádný tracked helper,
  runtime, private, evidence, process-control ani push efekt
- **stav subjectu:** `REMEDIATED_PENDING_FRESH_PRECOMMIT_REVIEWS / NO_OPERATIONAL_AUTHORITY`
- **integrationRef:** `integration/m1-consolidated-20260810`
- **baseRevision / B43:**
  `f5a4c6931fccbeb5601c1c54ea04bd70c17215bd`
- **baseTree / paths:**
  `80344421559cbbaeaf37ea569341f37d71cf7afd` / `1629`
- **výsledek až po Review A+B a post-E_B materializaci:** právě jeden final
  manual operation smí v jednom root-held supervisoru fresh zachytit a svázat
  privileged system/FS/Git closure a případně provést přesně dvě write children;
  pouze complete post-verifier PASS může být source-checkout evidence

D042 má docs Review A+B `PASS` a její report-only `E_B` je B43. To dokazuje
jen čtyřcestný dokumentační subject/candidate. B43 není canonical promotion,
source-checkout PASS, runtime PASS ani M1/H0 DONE. D043 nenavazuje retryem na
žádný dřívější operational token. Nahrazuje samostatný capability-only
prerequisite jedním folded `runtimeGateBinding` uvnitř jediného final manual
operation. Readability, all-UID `/proc` úplnost, Git readiness, oba write
efekty i poststate tak sdílejí jeden supervisor, jeden transcript, jeden
deadline a jeden terminal state machine.

## 1. Immutable B43 a pravdivý predecessor stav

B43 má jediného parenta
`88e2d841bb5e780608c570686e0f67c6e844c938`, strom
`80344421559cbbaeaf37ea569341f37d71cf7afd` a právě 1 629 tracked cest.
Tyto D042 artefakty jsou immutable:

| Artefakt | Git blob | SHA-256 obsahu | Bytes |
|---|---|---|---:|
| Decision042 | `5210051f9164831893964a2f3bb35b53084b38f8` | `a5565094e694ebf47fd83128e30dc0a2d268e4d9ee7f3e5b8bc5c153b585e59b` | 80 858 |
| Decision042 WP | `7a07d9044bda895127e18f76b4f5c29e10f30868` | `335af8048626ef140d98abf6d8bfc933ed8b8fb324a8dd7cb978177c221984cc` | 32 024 |
| D042 Review-B report | `c9e5df75b1777c2eaa2d76e32d70aec6645687ed` | `475914dc14a44a62e417b1960b551167633fd7f37d07ec55f364017859f033de` | 262 |

D042 report má právě šest LF-terminated řádků:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: 2a37131366c6992c56e8abf4f1f39982d27dbd40
subjectHead: 0237b47bc4b0ae0be2c59cca8a09659164f08201
reviewA.verdict: PASS
candidateHead: 88e2d841bb5e780608c570686e0f67c6e844c938
reviewB.verdict: PASS
```

Přesný stav D042 je `E_B EXISTS / DOCS REVIEW A+B PASS / UNPROMOTED /
NO SOURCE PASS / NO RUNTIME`. Její post-E_B konstruktorový návrh neposkytl
úspěšný operational handoff; pozdější D043 scratch capability experiments jsou
oddělené non-evidence. Neexistuje
oprávnění doplnit jejich chybějící výstupy, přepsat blocked/non-evidence na
PASS ani z absence targetu odvodit nulový common-Git, atime či broker efekt.

D041 zůstává terminal `BLOCKED / INCOMPLETE`: readiness token byl spotřebován,
attempt/launch `1/true`, první Git child postrádal immediate CLI
`--no-optional-locks`, CREATE/VERIFY byly `CANCELLED_UNISSUED`, promotion a
create zůstaly `0/false`, lease closed/no handoff a retry je zakázaný. D038 a
D039 zůstávají vlastní terminal incidenty. D043 žádný z těchto tokenů,
holderů, lease, baseline, committerů, lock reasonů ani transcriptů nerecykluje.
D042 oddělený readiness holder-transfer, fixed V4.2 P/D/B chain, jeho
pre-materialized/null credential projections a samostatné rootWrite hashes jsou
rovněž `SUPERSEDED_FOR_OPERATION`; D043 přebírá jen níže znovu vyslovené
substantivní invariants. Přechod na jeden root-held supervisor a dynamický
same-run binding je explicitní změna autority, ne tvrzení byte parity s D042.

## 2. Scope subjectu a zakázané efekty

Subject smí měnit právě:

```text
docs/decisions/043-m1-h0-v5-detached-source-checkout-manifest-closure-remediation.md
docs/execution/m1-batch.md
docs/wp/README.md
docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-MANIFEST-CLOSURE-REMEDIATION.md
```

Reserved report zůstává na B43 i subjectu absent:

```text
docs/execution/runs/wp-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-report.md
```

Zakázané jsou tracked executable/helper/source, temp/cache/pyc, private,
evidence/seal, target/admin, process signal/control, Git object write, commit
během authoringu, push/tag/release/history rewrite a jakýkoli runtime nebo
privilege command. Jediná index-write výjimka je explicitní initial/remedial
`git add --` právě čtyř owned docs; auditní index mutation zůstává zakázaná.
Běžné read-only audity mohou mít kernel atime efekt; silnější zero-effect claim
se nevydává.

## 3. Nový namespace, autorita a jediný manual run

D043 je nový namespace, nikoli D042 retry:

```text
D043-PRIVILEGED-OPERATION-01
D043-RUNTIME-GATE-BINDING-01
D043-CREATE-01
D043-VERIFY-01
D043-H0V5-MANIFEST-CLOSURE-LEASE-01
```

Sole issuer je `/root`. Final manual command issue je irrevocable consumption
boundary: token se mění `UNMINTED -> CONSUMED_SINGLE_USE` ještě před loaderem.
Selhání sudo/PAM/NSS/env, loaderu, bootstrap watchdogu, dispatcheru, prvního
readu nebo jakékoli pozdější fáze je proto terminalní výsledek téhož jediného
attemptu. Není dovoleno retry, partial repair, cleanup, prune, unlock,
alternate target ani nový token.

Exact sorted 56-entry operational universe `U43` je exact U42 plus sedm nových
identit:

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
/root/v5_formal_preseal_review
/root/v5_materializer
```

Každý holder používá exact sorted `U43` bez sebe, tedy 55 exclusions.
Chybějící, extra, duplicitní nebo nevyřazená identity je blocker. Žádná další
D043 identity není přípustná bez nového docs supersession.

Exact live role map je:

| Role | Identity |
|---|---|
| writer | `/root/decision040_driver_writer` |
| contract a short-launcher auditor | `/root/decision040_driver_writer/d043_doc_contract` |
| nonvoting precommit scope auditor | `/root/decision040_driver_writer/d043_precommit_audit_a` |
| source architect/materializer | `/root/decision043_architect` |
| one-time docs remedial patcher sub-role | `/root/decision043_architect` |
| Review A a adversary | `/root/decision043_architect/decision043_adversary` |
| Review B, mount a packet reviewer | `/root/mount_stack_reviewer` |
| sole issuer/promoter/creator | `/root` |
| prewrite holder | `/root/v5_d043_prewrite_runtime_verifier` |
| distinct post-create verifier | `/root/v5_d043_source_checkout_verifier` |

Writer je fenced po immutable S43 handoffu a Review A po E_A. Review B je
fenced po E_B. Contract/short-launcher auditor zůstává jen pro svůj explicitní
post-E_B audit a pak se fence-ne. One-time docs remedial patcher sub-role se po
final restage tohoto repinu permanentně fence-ne od další Git/docs mutace.
Stejná identita smí poté pokračovat pouze jako scratch source
architect/materializer bez docs Git a tato source role se fence-ne až po exact
post-E_B immutable materialization handoffu; tehdy se fence-ne celá identita.
Prewrite holder se fence-ne po `ROOT_ENTERED` transferu a root po předání
complete poststate distinct post-create verifieru. Fenced role se nesmí
reaktivovat k Git, governed FS/proc, private, runtime ani process-control
accessu. D042 holder stav a tokeny se nerecyklují.

Writer během mutable self-review chybně spustil child
`/root/decision040_driver_writer/d043_precommit_audit_a` dřív, než byl v U43.
Child viděl nejméně mutable Decision počty 447→521 LF, WP 151→152 LF a později
invalidovaný vector Decision `161d53e7…`, batch `3b5e50fd…`, README
`fb0dd501…`, WP `7db447df…`. Po governance STOP byl přerušen bez verdictu.
Jeho exact command/check transcript a případný atime efekt jsou
`ABSENT/UNKNOWN`; current four-path scope neukazuje žádnou jeho tracked změnu.
Incident je `NONVOTING_SELF_AUDIT / NO_VOTE / NOT_REVIEW_A` a identita je nyní
v U43 jen proto, že už existovala a četla. Nesmí být reaktivována. Formální
Review A smí vydat pouze declared adversary identity a Review B pouze declared
mount/packet reviewer identity z tabulky výše.

Po původním freeze navíc root během nonvoting self-checku porušil zákaz Git
object write. Exact cwd byl
`/home/belphareon/worktrees/is-m1-h0-v5-detached-source-checkout-manifest-closure-remediation-20260819-writer`
a shell command měl exact bytes:

```text
git diff --cached --check && git diff --check && git rev-parse HEAD^{tree} && git rev-list --count HEAD && git ls-tree -r --name-only $(git write-tree) | wc -l
```

Command neměl explicitní env assignments/prefix ani `--no-optional-locks`; full
ambient env bytes jsou `NOT_RETAINED/UNKNOWN`. Exact stdout byl:

```text
80344421559cbbaeaf37ea569341f37d71cf7afd
1016
1631
```

Stderr byl exact empty a exit code `0`. Command start/end time jsou
`NOT_RETAINED/UNKNOWN`; pozorované filesystem mtimes níže uvedených pěti nových
loose tree objektů leží pouze v intervalu
`2026-08-20 00:27:18.236924548–00:27:18.237924566 +0200` a nesmějí být vydávány
za command timestamp:

```text
580d3c17de97b41e38a55a2deff5e2b632301060
8d82e4a42cf44822e381ed5aaf465aa120a45df4
1f88d73a2c81fc0c1079fb4688f7ce7f913b06a9
3e229db73b931044dcf3d63ce5dbecc15b2ae0f4
d742035f3267b0dddd4f179c05d9ef23a7c55aef
```

Všech pět má Git type `tree` a tvoří jeden unreachable staged-tree graph:
`1f88d73a…` root → `3e229db7…` docs → `8d82e4a4…` decisions,
`580d3c17…` execution a `d742035f…` wp. Pozorovaný index, worktree, refs a
reflogy se nezměnily; common-Git object store se změnil.
Root self-check je `NONVOTING/NO_VOTE`. Declared adversary později přiznal
opakované zakázané vyvolání. Recovered self-history potvrzuje exact stejný cwd,
`tools.exec_command` default shell/login a žádný explicitní shell/login/env.
Exact `cmd` bytes byly, s LF mezi zobrazenými řádky:

```text
git rev-parse HEAD HEAD^{tree} HEAD^ && git ls-tree -r --name-only HEAD | wc -l
git status --porcelain=v1 --untracked-files=all
git diff --name-status
git diff --cached --name-status
git diff --cached --numstat
git diff --cached --stat
git diff --cached --check
printf 'unstaged-bytes='; git diff --binary | wc -c
printf 'cached-paths='; git diff --cached --name-only | wc -l
printf 'staged-tree-paths='; git write-tree 2>/dev/null | xargs git ls-tree -r --name-only | wc -l
```

Nebyl použit explicitní env, `GIT_OPTIONAL_LOCKS` ani
`--no-optional-locks`. Forbidden segment je exact poslední pipeline;
jen stderr procesu `git write-tree` byl explicitně přesměrován do `/dev/null`.
Tool adapter uchoval pouze jeden sloučený `output` string; rozdělení jeho bytes
mezi stdout a stderr je `UNKNOWN`. Exact retained combined output je:

```text
f5a4c6931fccbeb5601c1c54ea04bd70c17215bd
80344421559cbbaeaf37ea569341f37d71cf7afd
88e2d841bb5e780608c570686e0f67c6e844c938
1629
A  docs/decisions/043-m1-h0-v5-detached-source-checkout-manifest-closure-remediation.md
M  docs/execution/m1-batch.md
M  docs/wp/README.md
A  docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-MANIFEST-CLOSURE-REMEDIATION.md
A	docs/decisions/043-m1-h0-v5-detached-source-checkout-manifest-closure-remediation.md
M	docs/execution/m1-batch.md
M	docs/wp/README.md
A	docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-MANIFEST-CLOSURE-REMEDIATION.md
548	0	docs/decisions/043-m1-h0-v5-detached-source-checkout-manifest-closure-remediation.md
23	2	docs/execution/m1-batch.md
2	1	docs/wp/README.md
165	0	docs/wp/WP-M1-H0-V5-DETACHED-SOURCE-CHECKOUT-MANIFEST-CLOSURE-REMEDIATION.md
 ...source-checkout-manifest-closure-remediation.md | 548 +++++++++++++++++++++
 docs/execution/m1-batch.md                         |  25 +-
 docs/wp/README.md                                  |   3 +-
 ...SOURCE-CHECKOUT-MANIFEST-CLOSURE-REMEDIATION.md | 165 +++++++
 4 files changed, 738 insertions(+), 3 deletions(-)
unstaged-bytes=0
cached-paths=4
staged-tree-paths=1631
```

Raw string je ASCII, má 1165 bytes, 24 LF, terminal LF a SHA-256
`d2ed904678cac28a6f8b928054c397957a5f7e8f16738293e0b75d07009913a2`;
tabulkové řádky výše obsahují literal HT `0x09`. Underlying `exit_code`,
`wall_time_seconds`, `session_id`, `chunk_id` a `original_token_count` nebyly
z adapteru emitovány ani retained, takže whole-command exit i timing zůstávají
`NOT_RETAINED/UNKNOWN`. Další persistent object creation nenastala, protože pět
výše uvedených tree objektů už existovalo; jeho docs Review A je přesto
`NO_VOTE`.

Těchto pět objektů se nemaže ani neuklízí. Final runtime readiness musí jejich
exact OID/type/path/content vector explicitně přijmout jako retained preexisting
common-Git stav a svázat jej s fresh full common-Git prestate; missing, type,
path nebo content drift blokuje před root enter. Původní root/adversary audity
nejsou review evidence a oba declared formal reviewers po tomto repinu startují
fresh zero-based.

Fixed agent-thread limit znemožnil reaktivovat původního writera
`/root/decision040_driver_writer`. Sole issuer `/root` proto poprvé jednorázově
povolil `/root/decision043_architect` aplikovat consolidated two-P1 docs opravu
a nastagovat pouze stejné čtyři cesty. Původní writer zůstává autorem four-doc
subjectu; architect není formal docs reviewer. Po repinu s manifestem
`a33b5504d9d4e3b0a9a98518041b2cb2d31c5d7f7e49f30eac671b97a1c5b206` byla
jeho docs-patcher sub-role deklarována jako fenced.

Když byla před formal vote recovered exact adversary self-history, tento a33b
repin i jeho fence assertion byly invalidovány. Root navzdory tomu kvůli fixed
agent-thread limitu již fenced docs-patcher sub-roli znovu aktivoval. Toto
nebylo compliant: je to exact
`ROOT_GOVERNANCE_REMEDIAL_REACTIVATION / NO_VOTE`, nepřináší formal review a
nesmí se vydávat za dodržení původního fence. Celý root-authorized consolidated
turn je omezen pouze na factual incident correction ve stejných čtyřech docs a
exact three-finding scratch source-leaf repair; leaf část probíhá pod odlišnou,
dosud aktivní source architect/materializer rolí a neuděluje docs práva.
Effective permanent fence docs-patcher sub-role se proto posouvá na final
restage tohoto repinu; od něj nesmí tato sub-role znovu provést Git/docs mutaci
ani být reaktivována. Source architect/materializer identita zůstává poté
aktivní jen pro scratch source/materialization bez docs Git do post-E_B exact
immutable materialization handoffu, kdy se fence-ne celá identita. U43 zůstává
`56` a každý holder má 55 exclusions. Review A a Review B smějí vydat jen dvě
declared identity z role mapy výše a obě musí znovu číst celý repin od byte
zero.

Formal Review A pak na manifestu
`188679f11824f8f516bb3dcb5e980bcd4ce9d7d887d60cf4fc191bd7beec1212`
správně vydal `CHANGES_REQUIRED / P0=0 / P1=1 / NO_VOTE`: adapter retained
celý combined `output`, zatímco repin nepravdivě tvrdil, že předchozí output je
unknown a aggregate stderr empty. Permanentní architect docs-patcher fence
zůstal nedotčen. Sole issuer `/root` proto explicitně rozšířil jen vlastní
remedial scope na tuto poslední exact channel-boundary opravu ve stejných
čtyřech docs a restage; událost je
`ROOT_FINAL_EVIDENCE_CHANNEL_CORRECTION / NO_VOTE`, root není formal reviewer
a nesmí hlasovat. Žádný scratch source edit, pátá cesta, `write-tree` ani commit
do tohoto zásahu nepatří. Obě declared docs reviews restartují až na následném
novém manifestu od byte zero.

Jeden již načtený a operátorem attestovaný Bash spustí exact pinned one-line
command z cwd `/`. Privilege broker efekty sudo/PAM/NSS/audit/journal jsou
explicitně `EXTERNAL_BROKER_EFFECTS`, nikoli repo no-effect. Root loader musí
před non-builtin importem nebo governed readem ověřit exact incoming
`ruid/euid/suid=0`, `rgid/egid/sgid=0`, supplementary groups `(0,987)`, provést
`setgroups([])` a znovu ověřit empty groups. Bootstrap, dispatcher i verifier
pak přijímají pouze empty supplementary groups.

Bootstrap je root-held parent watchdog. Pod blokovanou signal maskou forkne
dispatcher, child provede `setsid`, pošle `SID_READY` a teprve exact GO otevře
operation. Watchdog vlastní PID/session, bounded stdout/stderr capture,
`killpg` a reap. Úspěch přepošle jen po complete canonical dispatcher frame,
exit 0, empty stderr, total reap a post-emit pending-signal check. Closed
watchdog failure, no-frame transport, external stop/resume, timeout, output
cap, signal, OOM nebo unreaped descendant jsou typed terminal outcomes; nikdy
PASS. Dispatcher vyžaduje `pid == sid == pgrp`. Všech 38 Git children dědí
dispatcher group, nepoužijí shell, `start_new_session` ani vlastní process
group a mají 1:1 typed ledger.

## 4. Folded `runtimeGateBinding`, ne standalone capability artefakt

Všechny samostatné D043 capability-only authority/templates/materializations,
manual commands, wrappers, protocols a jejich runtime výsledky jsou pro
operational gating:

```text
SUPERSEDED / NON_AUTHORITY / NON_EVIDENCE / TOKEN_UNMINTED /
ZERO_GIT / ZERO_ROOT_WRITE
```

Patří sem i bezpečně fail-closed diagnostické výsledky
`CAP_MOUNT_STACK_AMBIGUOUS`, `CAP_FILE_STREAM_CAP`, `CAP_FD_ENUM_CHURN`,
`CAP_FD_SET` a `CAP_TASK_IDENTITY_CHURN`. Smějí být zachovány jako provenance
designu, ale nejsou prerequisite PASS a nevyžadují další manual handoff.

Post-E_B materializace vytvoří jeden exact canonical
`d043-runtime-gate-binding-v1` objekt. Subject nesmí fabrikovat jeho budoucí
bytes/SHA. Objekt váže nejméně:

```text
authority-and-limits
bootstrap-watchdog
dispatcher
system-leaf
filesystem-leaf
phase-verifier
manual-loader-and-command
binary-and-native-pins
host-namespace-and-mount-policy
Git-read-and-root-write-constructors
result-and-terminal-schemas
```

Každá source/template/materialized hodnota má exact path, mode, bytes, LF a
SHA-256. Materialization je acyklická; vnitřní leaf hash jde jen směrem k
outer komponentě a žádný output neobsahuje self-hash. Dva independent
same-FD zero-based audity musí rekonstruovat celý chain, serializer, argv/env
aggregate, canonical schemas a negative fixtures. Jakýkoli mismatch znamená
`NO_OPERATIONAL_AUTHORITY`.

Tentýž supervisor dynamicky zachytí binary, native, namespace, `/proc` mount,
mount stack, filesystem roots a governed Git metadata. První complete gate je
před prvním Git childem. Druhý complete gate je exact EX09 po complete EX07 a
EX08 a bezprostředně před jediným přechodem `ROOT_ENTERED=false -> true`; musí
byte-identicky nebo podle exact declared stable projection potvrdit první
binding. Žádný root write není dosažitelný před druhým PASS. Post EX14 binding
zachytí final drift. Dynamic pin znamená point-in-time binding pro tento run,
nikoli self-authentication root toolchainu.

## 5. All-UID `/proc` point-observation closure

D041 požadovala system-wide cwd/root/fd/maps/open-handle/locks/cgroup a
relevant-descendant closure. B43 ale neobsahuje samostatný důkaz all-UID
úplnosti. D043 proto tuto substantivní hranici nově a výslovně definuje; nikdy
netvrdí, že ji dřívější docs nebo run už prokázaly.

Supervisor musí v host PID+mount+user namespace získat čitelný point sample
všech viditelných TGID a všech `/proc/<tgid>/task/<tid>` napříč UID. Každý
permission, `hidepid`, namespace, parser, cap, deadline, mount nebo unreadable
required-surface stav je `BLOCKED/INCOMPLETE`, ne clean. Přesný surface je:

```text
status, stat, cwd, root, fd, same-name fdinfo, leader maps, cgroup,
/proc/locks, mountinfo, namespace anchors and relevant descendant joins
```

Tvrzení je pouze bounded append-only point-observation closure. Neprokazuje
historickou ani continuous absence, neexistenci execu mezi dvěma syscally ani
full security-state continuity.

### 5.1 Task census

Observational task key je `(tgid,tid,starttime,appearanceOrdinal)`. Starttime
není globálně collision-free lifetime identity. Appearance začíná prvním
successfully coherent full-surface observation stejného
`(tgid,tid,starttime)` a se shodným stable core pokračuje přes další coherent
observations, dokud pozdější COMPLETE census neprokáže numerickou absenci.
Globálně incomplete round kvůli jiné tombstone sám appearance neuzavírá ani
nezvyšuje. Ordinal má tento exact stavový automat:

1. každý round fresh enumeruje všechny TGID/TID; cached census je zakázaný;
2. první successfully coherent presence trojklíče vytvoří nový ordinal pouze
   po complete full-surface scan, i když je globální round kvůli jiné task
   tombstone incomplete;
3. každá další coherent presence s exact stable-core parity reuse-ne tentýž
   ordinal. Incomplete globální round žádný coherent observed aktivní ani nový
   base neuzavře a nezvýší. Samotný reread nikdy ordinal nezvýší; změna live
   scheduler letters nebo live `FDSize` rovněž nevytváří nový appearance;
4. COMPLETE census round, který trojklíč neobsahuje, uzavře jeho appearance.
   Pozdější COMPLETE reappearance zvýší ordinal a před terminal acceptance
   vyžaduje nový complete full-surface scan;
5. incomplete/unresolved disappearance nepředstavuje observed absence ani
   nový appearance. Zůstává append-only tombstone, který může uzavřít až
   pozdější COMPLETE absence; unresolved terminal/cap/deadline vždy blokuje;
6. stable-core drift pro stejný observation scope, half-lifecycle, `X/x` nebo
   live/zombie mix blokuje a nesmí být přeznačen na nový appearance;
7. žádná dřívější observation, appearance ani tombstone se nevymaže při exit,
   PID reuse nebo churnu;
8. leader zombie je přijatelný jen se všemi čtyřmi status/stat endpoints `Z`,
   oběma `FDSize=0`, empty authoritative fd names, cwd/root ENOENT a exact
   parsed cgroup/maps/locks invariants;
9. terminal closure vyžaduje dvě fresh COMPLETE QUICK rounds bez nového
   appearance a bez unresolved disappearance. Canonical QUICK projection je
   exact list sorted podle `(tgid,tid,starttime,appearanceOrdinal)` s každým
   appearance key + stable core + typed lifecycle class.
   Projekce obou rounds musí být byte-identical. `status.State`, `stat.state` a
   `FDSize` z obou rounds jsou samostatně typed a committed, ale jsou z QUICK
   byte equality vyloučené; full surfaces se v QUICK rounds znovu nečtou.

Stable core je exact TGID/TID/starttime, NStgid/NSpid, UID4, GID4, groups,
`CapEff` a `CapAmb`. Není to důkaz full credential/security state, per-task
mount/user namespace continuity ani no-exec intervalu. Live pair může mít
rozdílný status/stat state pouze tehdy, když oba znaky patří do exact live
allowlistu `R,S,D,T,t,K,W,P,I`; `Z`, `X/x` a lifecycle transition používají
výše uvedená fail-closed pravidla.

### 5.2 FD terminal sweep

`/fd` je jediný authoritative sorted unique name set. `/fdinfo` directory se
otevře, ale nereaddiruje. Pro každý observed fd slot se provede target-before,
bounded complete same-name fdinfo strict parse, inode/correlation a
target-after. Každý sweep znovu skenuje všechny current slots, ne jen delta.

Append-only FD observation key zahrnuje task appearance, fd number, target
bytes, dev/inode/mount identity, flags a exact `scannerOwned` correlation.
Optional volatile `pos` nevstupuje do stable commitment; všechny ostatní
normalizované records se streamově domain-separated commitnou count/len/SHA.
Raw bytes length/SHA a required singleton fields se zachovají. Relevant target
pozorovaný v libovolném roundu zůstává relevantní navždy; pozdější absence jej
nesmí vyprat.

Nový slot, nový binding, unknown read, target drift, ABA/reuse nebo names A/B
delta vynutí další celý sweep v rámci stejného attemptu. První complete FD
sweep nikdy nesmí být terminalní; acceptance vyžaduje pozdější complete sweep
s exact `newGenerationCount=0`. Unknown vanished slot je uzavřen jen pozdější
complete absence observation; unknown v terminalním roundu blokuje. Fixed
point vyžaduje tento pozdější full quiet sweep, všechny accumulated observations
vyhodnocené `relevantJoin` a žádný unresolved row. Každý pokus o read, byte,
row, task, FD a transcript se účtuje proti fixed post-E_B caps;
deadline/cap/endless churn je terminal `BLOCKED`, ne retry.

`scannerOwned=true` lze použít pouze pro přesně korelované vlastní held FD.
Neznámý nebo recycled descriptor se nikdy nevyřadí. `/proc/locks` se načte a
parse dvakrát; relevant lock rows blokují přes exact dev+inode. Owner TGID/TID
se validuje jen tam, kde to vyžaduje explicitní zombie-owner policy, nikoli
obecným owner joinem. Maps se čtou přes leader se strict clone-VM proofem.
Cgroup je samostatně strict-parsed point evidence bez inode joinu. Relevant
join zpracuje cwd/root/fd/maps, dev+inode lock rows a všechny historické
observations přesně podle jejich typed schema.

## 6. Exact 16-stage execution manifest a 38 Git children

Operation má právě tento ordered manifest:

| Stage | Receipt | Význam |
|---|---|---|
| EX01 | `PRE_GIT_FS` | full no-follow FS/common/private/red baseline |
| EX02 | `PRE_GIT_SYSTEM` | all-UID system-last external-state gate |
| EX03 | `PRE_GIT_JOIN` | pure FS↔system relevant join |
| EX04 | `PRE_GIT_VERIFY` | pure pre-Git invariant verification |
| EX05 | `GIT_READINESS` | exactly R01–R18 read-only Git children |
| EX06 | `READINESS_FS` | repeat FS/common/index/config closure |
| EX07 | `READINESS_SYSTEM` | fresh all-UID system-last gate |
| EX08 | `READINESS_JOIN` | pure append-only relevant join |
| EX09 | `READINESS_VERIFY` | second runtimeGateBinding PASS; root enter guard |
| EX10 | `ROOT_BATCH` | exactly RW01 promotion then RW02 CREATE |
| EX11 | `POST_IMMEDIATE_FS` | first post-effect index/admin/config capture, no Git |
| EX12 | `GIT_POST` | exactly P01–P18 read-only Git children |
| EX13 | `POST_FINAL_FS` | full target/admin/common/private/red closure |
| EX14 | `POST_SYSTEM` | fresh all-UID system-last external-state gate |
| EX15 | `POST_JOIN` | pure accumulated relevant join |
| EX16 | `PURE_VERIFY` | no child/no read; final verifier verdict |

EX02, EX07 a EX14 jsou nové normativní D043 receipts, nikoli údajný dřívější
artifact. Každý musí mít complete all-UID closure. Vynechání, reorder, cached
reuse nebo partial read znamená no handoff.

Celkem vznikne právě 38 direct Git children: 18 readiness, 2 root-write a 18
post. Každý má unique stage/ordinal, exact argv/env/cwd/credentials, raw
stdout/stderr byte count+SHA, exit/signal, start/reap receipts a 1:1 logical
result. Žádný free-form tail, shell, implicit config, helper, retry ani child
mimo ledger.

RW01 a RW02 jsou jediné effectful Git children a jediné `rootWrite` children.
Supervisor je root, ale před jejich `Popen` musí child credentials být exact
uid/gid `1000/1000`, supplementary groups `[]`; parent ověří constructor i
child result. RW01 je ff-only promotion exact reviewed E_B D043 do canonical
integration checkoutu. RW02 je exact locked detached D037 source worktree
CREATE. Counter se inkrementuje před successful child launch; žádné second
launch, cleanup nebo repair.

Root batch je contiguous: po EX09 PASS nesmí být žádný read, import, pin
discovery, capability handoff ani external action mezi fixed RW01 a RW02 kromě
jejich typed result handling. Selhání RW01 brání RW02; selhání RW02 zachová
partial observable state a zastaví bez cleanupu.

## 7. FS, Git a source closure zděděná bez oslabení

D043 zachovává D038/D041/D042 substantivní invariants:

- canonical/source/target/admin exact paths a no-symlink parent chain;
- target/admin absent před write, private/evidence/seal bez read/write;
- typed READ environment i immediate CLI `--no-optional-locks`, CONFIG15 a
  closed tails;
- full common-Git before/after manifest, refs/objects/worktrees/index/config/
  info/reflog delta allowlist a no optional locks;
- first post-effect index/policy capture před jakýmkoli post Git readem;
- exact admin controls, target `.git`, detached HEAD a locked reason;
- exact 1 614 tracked leaves, 355 directories, stage-0 index/tree/blob/mode
  parity, uid/gid/mode/nlink=1 and Git-object byte closure;
- bounded batch cat-file verification bez raw payload retention přes cap;
- same-FD no-follow identity, mount-ID and btrfs+noatime proofs;
- creator observation bez verdictu a fresh verifier-owned final verdict;
- private/red/toolchain/common/index/config parity před/po;
- no runtime, evidence, seal, push, tag, cleanup, prune, unlock nebo alternate
  target effect.

Complete audit s bezpečně pozorovanými mismatches vydá
`CHANGES_REQUIRED` a handoff; incomplete infrastructure/read/cap/deadline/
unknown stav vydá `BLOCKED / INCOMPLETE_RUN` bez handoffu. Pouze complete zero
P0/P1/mismatch může vydat PASS. Žádný BLOCKED se nesmí převést na
CHANGES_REQUIRED nebo PASS kvůli času.

## 8. Terminal state model

| Boundary | Token | Root write count | Výsledek |
|---|---|---:|---|
| před manual command issue | `UNMINTED` | 0 | žádná D043 authority |
| po issue, loader/watchdog/gate non-PASS | `CONSUMED_SINGLE_USE` | 0 | `BLOCKED/INCOMPLETE`, no retry |
| po EX09, před RW01 | `CONSUMED_SINGLE_USE` | 0 | `ROOT_ENTERED=true`, contiguous batch required |
| RW01 selže | `CONSUMED_SINGLE_USE` | 1 attempt | partial frozen, RW02 forbidden |
| RW01 PASS, RW02 selže | `CONSUMED_SINGLE_USE` | 2 attempts | partial target/admin observable, no cleanup |
| oba writes PASS, post incomplete | `CONSUMED_SINGLE_USE` | 2 attempts | `BLOCKED`, no handoff |
| complete post mismatches | `CONSUMED_SINGLE_USE` | 2 attempts | `CHANGES_REQUIRED`, handoff present |
| complete zero findings | `CONSUMED_SINGLE_USE` | 2 attempts | verifier PASS; teprve tento výsledek je usable |

Transport bez complete admitted frame po command issue je
`POSSIBLE_UNKNOWN / FREEZE`, ne nový attempt. Post-terminal delivery delay
nemění committed terminal state. External SIGKILL/OOM/kernel/proc/VFS failure
zůstává explicitní TCB/unknown, nikdy inferred PASS.

## 9. Acceptance requirements R43

1. `R43-01` — B43/tree/parent/path count a immutable D042 artefakty sedí;
   D042 je pravdivě E_B/docs-PASS, ale unpromoted/no-source/no-runtime.
2. `R43-02` — subject mění právě A/M/M/A, reserved report je absent,
   four-doc DAG/counts a U43=56/exclusions=55 jsou exact; writer-child i oba
   zakázané `write-tree` self-check incidenty jsou pravdivě disclosed/NO_VOTE,
   a33b fence violation je disclosed jako
   `ROOT_GOVERNANCE_REMEDIAL_REACTIVATION / NO_VOTE`; po final restage je
   docs-patcher sub-role permanentně fenced, zatímco source role zůstává bez
   docs Git aktivní jen do immutable materialization handoffu; retained
   five-tree vector je prestate-bound; manifest188679 Review A P1 a sole-issuer
   `ROOT_FINAL_EVIDENCE_CHANNEL_CORRECTION / NO_VOTE` jsou exact disclosed a
   po correction restage obě formal reviews znovu startují od byte zero.
3. `R43-03` — D038–D042 terminal/unknown/non-evidence se nelaunderují a D043
   používá fresh namespace bez retry/reuse.
4. `R43-04` — standalone capability chain je explicitně superseded a jediný
   final manual command má issue-time token consumption.
5. `R43-05` — loader normalizuje exact incoming root groups `(0,987)` na `[]`
   před import/read; watchdog/session/signal/reap/transport closure je total.
6. `R43-06` — post-E_B `runtimeGateBinding` je acyklický, byte-pinned, dvakrát
   independentně rekonstruovaný a druhý PASS dominuje jediný root enter.
7. `R43-07` — all-UID `/proc` visibility a required surfaces jsou complete,
   jinak fail-closed; claim je pouze point-observation closure.
8. `R43-08` — task census je starttime/appearance keyed, bounded a append-only;
   ordinal začíná coherent full scanem a reuse-ne se při další coherent
   presence s core parity i v globálně incomplete roundu; pouze complete
   absence→reappearance jej zvýší, zatímco unresolved absence/core drift
   blokuje; dvě canonical QUICK projections jsou fresh a byte-identical.
9. `R43-09` — FD sweep rescanuje všechny slots, koreluje same-name fdinfo,
   zachovává všechny observations a relevant-once vždy blokuje; první sweep
   není terminalní a pozdější complete sweep má `newGenerationCount=0`.
10. `R43-10` — EX01–EX16 jsou ordered; EX02/EX07/EX14 jsou fresh system-last
    gates a 38 Git children mají exact 1:1 ledger.
11. `R43-11` — právě RW01/RW02 jsou effectful/rootWrite, child credentials jsou
    1000/1000/groups-empty a root batch je contiguous.
12. `R43-12` — full canonical/source/target/admin/common/index/tree/blob/mode/
    nlink/private/red/mount closure a verifier taxonomy sedí.
13. `R43-13` — caps/deadline/output/memory/transcript počítají všechny attempts;
    churn/cap/unknown nikdy PASS ani retry.
14. `R43-14` — pouze complete verifier PASS je source evidence; subject/docs,
    materialization, readiness nebo write exit0 samy nejsou M1 DONE.

## 10. Negative fixtures F43

1. `F43-01-D042-E_B-DOCS-PASS-LAUNDERED-AS-OPERATIONAL`
2. `F43-02-SCOPE-REPORT-DAG-PATHCOUNT-OR-BASE-DRIFT`
3. `F43-03-OLD-TOKEN-LEASE-HOLDER-COMMITTER-REASON-RETRY-REUSE-OR-DOCS-PATCHER-FENCE-REACTIVATION-HIDDEN`
4. `F43-04-STANDALONE-CAPABILITY-PREREQUISITE-OR-SECOND-MANUAL-RUN`
5. `F43-05-ROOT-IDENTITY-GROUP-DROP-LOADER-HASH-OR-SOURCE-SWAP-DRIFT`
6. `F43-06-WATCHDOG-SIGNAL-STOP-RESUME-PGID-REAP-OR-NOFRAME-GAP`
7. `F43-07-RUNTIME-BINDING-CYCLE-SELFHASH-BINARY-NS-MOUNT-OR-SOURCE-DRIFT`
8. `F43-08-CROSS-UID-HIDEPID-PERMISSION-NAMESPACE-OR-UNREADABLE-SURFACE`
9. `F43-09-TGID-TID-PID-REUSE-STARTTIME-COLLISION-OR-APPEARANCE-DROP`
10. `F43-10-ZOMBIE-EXIT-LIVE-STATE-FDSIZE-OR-CORE-ENDPOINT-LAUNDERING`
11. `F43-11-FD-ADD-REMOVE-ABA-REUSE-TARGET-DRIFT-OR-UNKNOWN-DISCARD`
12. `F43-12-HISTORICAL-RELEVANT-TARGET-REMOVED-FROM-ACCUMULATOR`
13. `F43-13-SCANNER-FD-MISCORRELATION-FDINFO-SKIP-OR-VOLATILE-COMMIT-DRIFT`
14. `F43-14-ENDLESS-CHURN-CAP-DEADLINE-OOM-OR-OUTPUT-AS-PASS`
15. `F43-15-EX02-EX07-EX14-SKIP-REORDER-CACHE-OR-NONSYSTEM-LAST`
16. `F43-16-GIT38-LEDGER-ARGV-ENV-CREDENTIAL-CHILD-COUNT-OR-ORDER-DRIFT`
17. `F43-17-ROOT-ENTER-BEFORE-SECOND-GATE-READ-BETWEEN-RW01-RW02-OR-THIRD-WRITE`
18. `F43-18-COMMON-INDEX-REFLOG-WORKTREE-ADMIN-TARGET-PRIVATE-OR-MOUNT-DRIFT`
19. `F43-19-NLINK-HARDLINK-MODE-OWNER-TREE-BLOB-OR-CATFILE-MISMATCH`
20. `F43-20-BLOCKED-UNKNOWN-CHANGES-REQUIRED-OR-PASS-TAXONOMY-LAUNDERING`
21. `F43-21-COHERENT-PRESENCE-IN-INCOMPLETE-GLOBAL-ROUND-OR-LIVE-DRIFT-CREATES-NEW-APPEARANCE`
22. `F43-22-REREAD-ALONE-INCREMENTS-APPEARANCE-ORDINAL`
23. `F43-23-COMPLETE-ABSENCE-REAPPEARANCE-REUSES-ORDINAL-OR-SKIPS-FULL-SCAN`
24. `F43-24-INCOMPLETE-DISAPPEARANCE-ALONE-BECOMES-ABSENCE-OR-UNRESOLVED-TERMINAL-PASS`
25. `F43-25-CORE-DRIFT-Z-LIVE-X-OR-QUICK-PROJECTION-LAUNDERING`

Každý fixture musí skončit před zakázaným efektem nebo zachovat přesně
pozorovanou partial state. F43-21 musí založit/reuse-nout ordinal pro coherent
full-scanned base i při unrelated globální incompleteness a zachovat jej při
pouze typed live-state/FDSize driftu; F43-22 nesmí ordinal změnit; F43-23 musí
přidat ordinal a nový full scan; F43-24 a F43-25 musí blokovat. Synthetic
fixture není live proof.

## 11. Four-doc DAG, report a gates

Subject `S43` má právě dvě additions a dvě modifications, tedy 1 631 paths.
Reserved report přidá jedinou další cestu; `E_A43`, `C43` a `E_B43` mají 1 632
paths. Exact DAG je:

```text
B43 -> S43 -> E_A43 -> C43 -> E_B43 -> canonical --ff-only
```

`E_A43` je direct child S43 a přidá jen první čtyři LF-terminated report
řádky. `C43` má ordered parents `[B43,E_A43]` a exact E_A43 tree. `E_B43` je
direct child C43 a přidá jen poslední dva report řádky:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: f5a4c6931fccbeb5601c1c54ea04bd70c17215bd
subjectHead: <full-S43-sha>
reviewA.verdict: PASS
candidateHead: <full-C43-sha>
reviewB.verdict: PASS
```

Po každém subject editu vzniká mimo tracked scope nový canonical compact
JSON+LF freeze manifest se čtyřmi path-sorted rows a exact keys
`path,mode,blob,bytes,sha256`. Review A i Review B jsou fresh zero-based,
distinct a musí dát `PASS / P0=0 / P1=0`. Audity smějí používat jen read-only
Git/index/blob operations s env i immediate CLI optional-lock suppression;
`write-tree`, object creation a index mutation jsou zakázané.

Původní freeze/review vector je incidenty invalidovaný. Opravený subject musí
mít nový manifest a obě declared reviews restartují od byte zero; root self-check,
opakovaný adversary invoke ani one-time remedial patcher nesmí hlasovat.

Po E_B se materializují dynamic component pins a exact manual packet. Dva
independent audity materializace a source callgraphu musí PASSnout před mintem
jediného tokenu. Jakýkoli non-PASS ponechá D043 `NO_OPERATIONAL_AUTHORITY` a
nevytvoří candidate run. Canonical branch se posune jen ff-only po metadata
gate E_B; runtime se nikdy nevydává za důkaz této docs integrace.
