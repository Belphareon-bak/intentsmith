# Inventura #22 — effect authority trace pro M2

**Read-only stopa P1** · **2026-08-08** · zdrojový base
`2a59637e806b1ec5dac6de35b970eee54e1764b0` · ověřeno beze změny
trasovaných souborů na `b9c97ce4`

## Otázka a rozsah

Tato inventura sleduje skutečný call graph tří stávajících schopností:

- #11 execution, patch, test, Git a rollback;
- #16 chatové nástroje, registr 153 nástrojů a lifecycle executor;
- #13 architecture governance.

Cílem není implementovat M2. Cílem je zjistit, kde dnes vzniká diskový,
procesní, síťový a Git efekt, co jej autorizuje, co se stane při
cancel/timeout/restartu a jaký minimální connector musí budoucí
`WP-M2-EFFECT` vlastnit.

P1 nic nespouštěla proti síti, modelu, GPU ani Electronu a neupravila
produkční kód. Podrobné nálezy jsou v
`docs/findings/001-m2-effect-authority-gaps.md`.

## Souhrnný verdikt

IntentSmith dnes nemá jedinou effect authority hranici. Authority je
rozptýlená mezi:

- lifecycle milestone approval;
- interní auto-approval workflow plánu;
- CRE rozhodnutí před chatovým nástrojem;
- metadata v registru nástrojů;
- scope limiter a architecture governance, které v části cest pouze varují;
- lokální timeout promises, které neprokazují ukončení skutečného efektu.

Nejrizikovější kombinace je aktivní patch path bez containmentu, scope
guard pokračující po porušení a procesový, nedurable rollback. M2 proto nemá
začínat rozšířením registru nástrojů. Nejprve musí vzniknout kanonická
hranice efektu, exact approval a pravdivý terminální výsledek.

## #11 — lifecycle, patch, test, Git a rollback

### Skutečný tok

```text
POST /api/lifecycle/* nebo chat lifecycle
  -> ProjectLifecycle
  -> approveMilestonePlan()
  -> executeMilestone()
  -> WorkflowOrchestrator.start()
  -> interní auto-approval workflow plánu
  -> test/build přes C3ToolExecutor
  -> při chybě runFixLoop()
  -> previewPatch() / applyPatchSet()
  -> filesystem write
  -> checkpoint
  -> volitelně git add -A, commit a tag
```

### Evidence

- HTTP routy registruje `src/server.js:798-810`.
- Milestone approval přijímá jen `lifecycleId` a `milestoneId` v
  `src/routes/expertises.js:598-615`.
- Workflow vytvoří vlastní `AWAITING_APPROVAL` plán v
  `src/planner/workflow.js:630-657`; lifecycle jej schválí interně v
  `src/planner/lifecycle-build.js:543-546`.
- `milestone.test_strategy` jde do shell executor přes
  `src/planner/lifecycle-build.js:1097-1135`.
- `runFixLoop()` je volán bez `options.graph` v
  `src/planner/lifecycle-build.js:627-649,702-725`; scope limiter je podmíněn
  graphem v `src/executor/execution-loop.js:557-571`.
- Patch write používá tmp + rename v `src/patch/patch-engine.js:41-100`,
  ale cesta před tím nemá project containment.
- Git commit provede `git add -A` v `src/architect/git.js:79-103`.

### Důsledek

Schválení není vázáno na přesný patch, příkaz, workspace revision ani
Git diff. Timeout plánování nepokrývá následné efekty a rollback nelze po
restartu obnovit.

## #16 — tři oddělené tool mechanismy

### Mechanismy

1. `src/executor/tool-executor.js` — aktivní chatový executor.
2. `src/tools/registry.js` — 153 deklarovaných nástrojů a jejich metadata.
3. `src/executor/c3-tool-executor.js` — lifecycle, test a build executor.

Nejsou složené za jedním authority portem.

### Aktivní chatový tok

```text
src/chat/handlers/decisions.js
  -> ToolExecutor.execute()
  -> vestavěný handler
  -> searchWeb(), fetchPage(), filesystem nebo jiný adaptér
```

Evidence:

- přímé volání je v `src/chat/handlers/decisions.js:277-287,335-347,423-443`;
- `ToolExecutor.execute()` kontroluje druh rozhodnutí a existenci toolu, ne
  exact approval grant: `src/executor/tool-executor.js:570-620`;
- server předává registry services v `src/server.js:429-453`, ale aktivní
  chat search volá přímo `searchWeb()` v
  `src/executor/tool-executor.js:974-982`;
- síťové originy a fetch jsou v `src/llm/web-search.js:25-33,71-105,
  178-225,299-319`;
- scrape přijímá libovolnou HTTP(S) URL v
  `src/executor/tool-executor.js:1090-1130`.

### Registr 153 nástrojů

`requiresConfirmation`, `permissions`, `isSafe()` a `riskAssessment()` jsou
metadata/query API. `get()` vrací executable objekt
(`src/tools/registry.js:4892-4904`) a trasování nenašlo produkční obecný
dispatcher, který by metadata před každým `execute()` fail-closed vynucoval.

Registr je proto dormant capability debt, ne důkaz 153 aktivních bezpečně
zprostředkovaných nástrojů.

## #13 — governance je post-effect observation

### Skutečný tok

```text
workflow/test/patch efekty
  -> validateArchitecture()
  -> guardian audit
  -> API surface diff
  -> text do promptu checkpoint modelu
  -> canPassMilestone() rozhoduje podle checkpointu, scope a testů
```

Evidence:

- architecture check běží až po testech/fix loopu v
  `src/planner/lifecycle-build.js:770-807`;
- skóre pod 0,7 je warning a výjimky jsou non-blocking v `:773-788`;
- guardian/API chyby jsou non-blocking v `:790-807`;
- výsledky vstupují do modelového kontextu v `:820-830`;
- terminální predicate governance přímo nekontroluje v `:1195-1199`;
- `architecture-guardian.js:155-225` zapisuje regresi jen jako warning;
- `regression-predictor.js` počítá `shouldBlock`, ale trasování nenašlo
  produkčního konzumenta.

Governance tedy dnes neumí autorizovat ani deterministicky zastavit efekt před
jeho provedením.

## Orphan a recovery census

| Událost | Dnešní pozorovatelný stav | Mezera |
|---|---|---|
| user cancel lifecycle | smaže chatový state | workflow, proces, patch a DB mohou pokračovat |
| shell timeout/abort | pošle `SIGTERM` přímému PID a odmítne promise | potomci/process group nemusí skončit |
| timeout registered handleru | odmítne wrapper promise | skutečný handler může pokračovat |
| restart uprostřed workflow | session zůstane aktivní, nelze resume | bez terminalizace, cleanupu a revokace approvalu |
| neúspěšný fix loop | rollback jen u `diverging` | ostatní stop reasons mohou nechat změny |
| restart po patchi | backup byl jen v procesovém `Map` | recovery evidence je ztracena |

## Navrhovaný M2 connector — rozhodovací podklad

### `EffectRequest`

Povinná pole:

```json
{
  "schemaVersion": 1,
  "effectId": "stable unique id",
  "runId": "stable run id",
  "parentEffectId": null,
  "actor": { "type": "user|system|model|specialist", "id": "stable id" },
  "origin": {
    "surface": "http|ws|studio|skill|lifecycle",
    "sessionId": "transport id or null",
    "conversationId": "durability id or null",
    "projectId": "project id"
  },
  "kind": "fs.read|fs.write|fs.delete|process.exec|network.request|git.commit|git.push",
  "target": "discriminated target by kind",
  "payloadDigest": "sha256 of canonical effect payload",
  "workspaceRevision": "tree or workspace digest",
  "requiredCapability": "exact capability",
  "riskClass": "read|write|exec|network|destructive",
  "timeoutMs": 120000,
  "idempotencyKey": "stable key",
  "approvalGrantId": null,
  "createdAt": "ISO-8601"
}
```

`target` musí být uzavřený union:

- filesystem: canonical project root, relativní cesta a resolved realpath;
- process: binary, `argv[]`, canonical cwd, bez volného shell stringu;
- network: normalizovaná URL, metoda a redirect/DNS policy;
- Git: exact repo, exact path set a expected workspace revision.

Secret, body ani file content se do evidence nekopírují; connector nese jejich
digest a privátní reference.

### `EffectResult`

```json
{
  "schemaVersion": 1,
  "effectId": "same effect id",
  "terminalStatus": "succeeded|failed|cancelled|timed_out|killed|orphaned",
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "process": {
    "pid": null,
    "processGroupId": null,
    "startIdentity": null,
    "exitCode": null,
    "signal": null
  },
  "changes": {
    "paths": [],
    "beforeDigest": null,
    "afterDigest": null,
    "diffArtifact": null
  },
  "network": {
    "resolvedAddresses": [],
    "finalUrl": null,
    "status": null,
    "bytes": 0
  },
  "rollback": {
    "required": false,
    "status": "not_required|pending|succeeded|failed",
    "evidenceRef": null
  },
  "outputDigest": null,
  "errorCode": null,
  "evidenceRefs": [],
  "lateCompletionRejected": false
}
```

Každý `effectId` má právě jeden terminál. `cancelled` nebo `timed_out` se
nesmí vydat před potvrzeným ukončením/izolací efektu; jinak je pravdivý
stav `orphaned`.

### `ApprovalGrant`

```json
{
  "schemaVersion": 1,
  "grantId": "stable unique id",
  "subject": { "actorType": "user", "actorId": "authenticated identity" },
  "scope": {
    "runId": "exact run",
    "projectId": "exact project",
    "effectId": "exact effect",
    "kind": "exact kind",
    "payloadDigest": "exact request digest",
    "workspaceRevision": "exact pre-effect revision"
  },
  "constraints": {
    "allowedRealpaths": [],
    "allowedBinary": null,
    "allowedArgvDigest": null,
    "allowedOrigin": null,
    "maxBytes": null
  },
  "issuedAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "singleUse": true,
  "nonce": "random nonce",
  "consumedAt": null,
  "consumedByEffectId": null,
  "revokedAt": null,
  "revocationReason": null
}
```

Grant se musí atomicky spotřebovat před efektem. Změna payloadu nebo
workspace revision jej zneplatní; cancel, timeout, restart a ukončení runu jej
revokují.

## Doporučené pořadí `WP-M2-EFFECT`

1. Canonical path boundary a negativní traversal/symlink testy pro patch,
   dead-import stripping a tool filesystem.
2. Jediný `EffectRequest/Result` connector před write/exec/network/Git efekty.
3. Payload-bound, expirovatelný a single-use `ApprovalGrant`.
4. Process supervision s process group, potvrzeným terminálem a restart
   recovery.
5. Durable change journal a rollback k baseline včetně nových souborů.
6. Deterministický governance verdict před terminálním PASS.
7. Až potom napojit dormant registr 153 nástrojů.
