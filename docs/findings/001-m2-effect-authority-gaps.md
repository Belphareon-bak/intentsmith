# 001 — M2 effect authority gaps

- **Zdroj:** read-only stopa `P1 M2-EFFECT-TRACE`
- **Stav:** `OPEN`
- **Primární vlastník:** `WP-M2-EFFECT`
- **Vstupní inventura:** `docs/inventory/22-effect-authority-trace.md`

Tento ledger nesmí být interpretován jako tvrzení, že každá dormant cesta
je dnes vzdáleně dosažitelná. Odděluje aktivní produkční call graph od
neintegrovaného dluhu registru nástrojů. Nic z nálezů P1 neopravovala.

## Souhrn

| ID | Závažnost | Nález | Vlastník |
|---|---|---|---|
| P1-FX-001 | HIGH | Patch path nemá project containment. | M2-EFFECT |
| P1-FX-002 | HIGH | Scope limiter po porušení pokračuje; lifecycle jej často ani neaktivuje. | M2-EFFECT / M2-EXEC |
| P1-FX-003 | HIGH | Dead-import stripper má druhou traversal write cestu. | M2-EFFECT / M2-LIFECYCLE |
| P1-FX-004 | HIGH | Rollback je procesový, neúplný a nerecoverovatelný. | M2-EFFECT |
| P1-FX-005 | HIGH | Milestone timeout neruší vlastní build/fix/test efekty. | M2-EFFECT / M2-LIFECYCLE |
| P1-FX-006 | HIGH | Timeout/cancel může zanechat child proces nebo handler. | M2-EFFECT / M2-EXEC |
| P1-FX-007 | HIGH | Approval není exact, payload-bound ani single-use grant. | M2-EFFECT |
| P1-FX-008 | HIGH | Přímé lifecycle API ztrácí project path. | M2-LIFECYCLE |
| P1-FX-009 | HIGH | Auto-commit používá `git add -A` a může zahrnout cizí změny. | M2-EFFECT / M2-LIFECYCLE |
| P1-FX-010 | HIGH | Chybějící test strategy se může stát PASS. | M2-LIFECYCLE |
| P1-FX-011 | MEDIUM/HIGH | Governance je post-effect, fail-open observation. | M2-LIFECYCLE |
| P1-FX-012 | HIGH | Aktivní web search/scrape obchází effect authority a SSRF boundary. | M2-EFFECT / M2-TOOLS |
| P1-FX-013 | MEDIUM | Filesystem sandbox je lexikální a někdy vypnutý. | M2-EFFECT / M2-TOOLS |
| P1-FX-014 | MEDIUM | Metadata registru 153 nástrojů nejsou enforcement. | M2-TOOLS |
| P1-FX-015 | HIGH | Lifecycle cancel pouze skryje chatový state. | M2-LIFECYCLE |
| P1-FX-016 | MEDIUM | Restart zanechá aktivní workflow bez recovery. | M2-EFFECT / M2-LIFECYCLE |
| P1-FX-017 | LOW/MEDIUM | BLOCKED timeout zapisuje a čte rozdílná pole. | M2-LIFECYCLE |

## Evidence a acceptance směr

### P1-FX-001 — patch traversal

`path.resolve(projectRoot, patch.file)` se používá bez následné containment
kontroly v `src/patch/patch-engine.js:41-57,124-140,170-182,197-214`.
`src/patch/patch-validator.js:153-250` kontroluje strukturu, anchors a velikosti,
ne cestu.

**Acceptance:** absolutní, `..`, symlink a rename race případy skončí před
preview/write; evidence nese canonical root i resolved target.

### P1-FX-002 — scope limiter není authority

Porušení vytvoří warning nebo rozšíření scope v
`src/executor/execution-loop.js:783-798`, potom pokračuje apply v `:800-835`.
Lifecycle navíc nepředává graph (`src/planner/lifecycle-build.js:627-649,
702-725`), takže podmínka v `execution-loop.js:557-571` neběží.

**Acceptance:** každý write effect má explicitní canonical scope a porušení
je terminální před prvním write.

### P1-FX-003 — dead-import traversal

`scope_files` se spojuje s project rootem bez containmentu v
`src/planner/lifecycle-build.js:1773-1781` a přepisuje v `:1820-1823`.

**Acceptance:** stejná path authority jako patch engine; žádný druhý lokální
guard.

### P1-FX-004 — rollback není durable

Backup je procesový `Map` (`src/patch/patch-applier.js:20-57`). Nový soubor se
zálohuje jako prázdný obsah, opakovaný patch přepisuje baseline a rollback
celé iterace nastává jen u `diverging`
(`src/executor/execution-loop.js:868-894`).

**Acceptance:** durable journal před efektem, původní existence/mode/blob,
rollback všech neúspěšných stop reasons a restart recovery.

### P1-FX-005 — neúčinný milestone timeout

Signal vzniká v `src/planner/lifecycle-build.js:509-526`, ale
`WorkflowOrchestrator.start()` jej v `src/planner/workflow.js:353-405`
nekontroluje ani nepředává. Timer se ruší před approve/build v
`lifecycle-build.js:524-546`.

**Acceptance:** timeout pokrývá celý effect graph a terminál se nevydá, dokud
není efekt zastaven nebo pravdivě označen `orphaned`.

### P1-FX-006 — osiřelé procesy a handlery

Shell a Docker posílají `SIGTERM` jen přímému PID a promise hned odmítnou
(`src/executor/c3-tool-executor.js:294-347,385-456`). Timeout registrovaného
handleru pouze odmítne wrapper promise (`:652-691`).

**Acceptance:** process group/job object, potvrzený exit, eskalace kill,
start identity a restartový orphan census.

### P1-FX-007 — approval bez exact scope

HTTP approval nese jen lifecycle/milestone ID
(`src/routes/expertises.js:598-615`), chat používá obecné potvrzení
(`src/chat/handlers/lifecycle-router.js:593-606`) a workflow plán se schválí
interně (`src/planner/lifecycle-build.js:543-546`).

**Acceptance:** expirovatelný single-use `ApprovalGrant` vázaný na actor,
effect ID, payload digest, project a workspace revision; atomická consumption.

### P1-FX-008 — ztracená project path

`POST /api/lifecycle/start` vytváří lifecycle bez project path
(`src/routes/expertises.js:506-519`). `ProjectLifecycle` ji očekává pro
`GitManager` (`src/planner/lifecycle.js:85-107`), ale DB ji nepersistuje
(`src/db/database.js:1127-1166`; baseline migration `:292-301`). Git potom může
běžet s `cwd: undefined` (`src/architect/git.js:25-31`).

**Acceptance:** lifecycle se bez canonical project identity nevytvoří a po
restartu ji obnoví z durable recordu.

### P1-FX-009 — cizí změny v auto-commitu

`src/architect/git.js:79-103` používá `git add -A`. Commit/tag failure je
non-fatal (`src/planner/lifecycle-build.js:1481-1500`) a milestone může skončit
PASSED s `commitHash = null` (`:894-915`).

**Acceptance:** exact evidence-bound path set, předem připnutý workspace
digest, konflikt s cizí změnou fail-closed a commit failure není PASS.

### P1-FX-010 — PASS bez testu

Bez strategy je `allPassed: null` (`src/planner/lifecycle-build.js:1113-1115`),
checkpoint je instruován kvůli tomu nefailovat (`:812-815`) a terminální
predicate odmítá jen přesné `false` (`:1195-1199`).

**Acceptance:** chybějící povinný test plan je typed blocked/error, nikdy
implicitní PASS.

### P1-FX-011 — governance pouze varuje

Architecture, guardian, API breakage a regression findingy samy milestone
nezastaví. Chybějící/invalidní `ARCHITECTURE.json` je skipped se score 1.0,
undeclared vrstvy se ignorují a scan končí na 200 souborech
(`src/planner/architecture-check.js:150-218`).

**Acceptance:** deklarovaný deterministický pre-terminal verdict s explicitní
fail policy; modelový text není authority.

### P1-FX-012 — outbound bez brokeru a SSRF boundary

Aktivní search jde přímo přes `src/executor/tool-executor.js:974-982`.
Scrape kontroluje jen HTTP(S) prefix (`:1090-1130`) a
`src/llm/web-search.js:299-319` následuje redirect. Není zde jednotná policy
pro loopback/private/link-local, DNS rebinding, redirect target nebo
credentialed URL.

**Acceptance:** každý network effect přes broker; DNS i každý redirect se
znovu vyhodnotí proti exact policy a approval scope.

### P1-FX-013 — lexikální filesystem sandbox

Při chybějícím projektu nebo disabled sandboxu se cesta povolí
(`src/executor/tool-executor.js:437-444`). Kontrola používá `resolve/relative`,
ne realpath (`:446-486`), a write je přímý (`:1208-1247`).

**Acceptance:** canonical containment, symlink/race negativní testy a
fail-closed chybějící project authority.

### P1-FX-014 — registry metadata bez enforcement

Příklady dormant dluhu: `fs.write` má `requiresConfirmation:false`
(`src/tools/registry.js:293-315`), `shell.exec` skládá string pro `execSync`
(`:618-637`), Git skládá command string (`:574-588,1036-1101`) a `test.run`
nemá confirmation (`:3105-3133`).

**Acceptance:** registr se napojí až přes typed `ToolRequest -> EffectRequest`;
metadata bez enforcement se nesmí vykazovat jako bezpečnostní kontrola.

### P1-FX-015 — lifecycle cancel bez cancelu efektu

`cancel/stop` pouze volá `clearLcState(sessionId)` v
`src/chat/handlers/lifecycle-router.js:153-159`.

**Acceptance:** cancel má durable run identity, revokuje granty, propaguje se
do efektů a vrací pravdivý terminal až po supervision verdictu.

### P1-FX-016 — restart recovery

Po restartu jsou resumable jen `AWAITING_APPROVAL` a `CLARIFYING`; mid-pipeline
stav v `src/planner/workflow.js:451-515` vrací cannot-resume bez terminalizace,
cleanup nebo revokace.

**Acceptance:** startup census aktivních runů, terminalizace/orphan evidence,
revokace grantů a durable rollback/recovery.

### P1-FX-017 — neshodný BLOCKED timestamp

Failure zapisuje `local_plan._lastBlockedAt` a vrací `blockedAt`
(`src/planner/lifecycle-build.js:1531-1565`), ale timeout čte
`milestone._blockedAt` (`:1587-1594`).

**Acceptance:** jediné durable pole, schema test a restartový elapsed-time test.
