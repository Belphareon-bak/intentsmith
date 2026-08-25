# M2 — finální operátorská review matice

- **Stav:** `7 PINNED_V1 / 7 OF 7 OPERATOR_REVIEW_PASSED`
- **Větev:** `codex/m2-integration-20260824`
- **Přesný product target:** `c070ed7383e522fb58b53a799cbbc0e16c4b09a7`
- **Clean evidence gate revision:** `22f2fb6f228dea34ab0a6a698ef11582b6133c3b`
- **Base přijatého M1:** `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91`
- **Push:** neproveden
- **Autorita:** `docs/decisions/030-m2-closeout-authority.md`

Tato matice nahrazuje jako aktuální proces starší
`2026-08-24-M2-OPUS-MAX-REVIEW-MATRIX.md`. Starý dokument zůstává historickou
evidencí tehdejších pokusů a nálezů; Opus už není acceptance podmínka. Každý
finální verdict vydává operátor nad přesnými product bajty uvedenými výše.

## Společný review protokol

Pro každý oddíl:

1. ověř `git rev-parse HEAD` a dostupnost product targetu;
2. přečti skutečný diff a trasuj produkční call graph až k persistovanému nebo
   emitovanému výsledku; samotný WP nebo unit test nestačí;
3. zkontroluj aktuální bytes na product targetu, nejen historický provenance
   range — pozdější cross-section delta může změnit dřívější authority;
4. spusť uvedené bezpečné focused testy bez GPU/Ollamy a bez změny cizích
   checkoutů či procesů;
5. vrať právě `REVIEW_PASSED` nebo `CHANGES_REQUESTED`;
6. každý blocker uveď se severity, `file:line`, reprodukcí a konkrétní
   acceptance condition.

Mechanické `PINNED_V1`, focused green ani celý baseline-FAIL gate samy o sobě
nejsou review PASS.

## Přehled řezů

| # | Řez | Historická provenance | Finální stav |
|---:|---|---|---|
| 1 | project-path authority | `44a9ba87..7dc6a807` + pozdější hardening | `REVIEW_PASSED` |
| 2 | effect/approval authority | `33cf221c..fa437d02` + migrace 080–083/hardening | `REVIEW_PASSED` |
| 3 | ProjectContext | `44a9ba87..5e19b825` + integrační spotřebitelé | `REVIEW_PASSED` |
| 4 | ToolRequest/ToolResult | `fa437d02..a35805ee` + pozdější terminal fixes | `REVIEW_PASSED` |
| 5 | durable project execution | `a35805ee..da8698ff` + tři review hardening kola | `REVIEW_PASSED` |
| 6 | lifecycle/governance journey | `da8698ff..cb9058b4` + cross-section fixes | `REVIEW_PASSED` |
| 7 | RemoteCorePort contract-only | `cb9058b4..d034df62` + final pin | `REVIEW_PASSED` |

## 1. Project-path authority

**Aktuální vlastněné bajty:** `src/executor/project-path-authority.js`, path
části `src/executor/execution-loop.js`, `src/patch/patch-engine.js`, filesystem
provider a project-change konzumenti; odpovídající path/execution/effect testy.

**Povinná kontrola:** canonical-root containment, symlink a hardlink hranice,
descriptor-pinned read/write/delete, post-rename pravda, terminalita odmítnutí,
dead-import best-effort cleanup a to, že audit/report neztratí rozlišený stav.
Zahrň dřívější R1–R6 i N1–N3 disposition a ověř současné konzumenty, nikoli jen
primitive.

```bash
git diff 44a9ba87..c070ed73 -- src/executor/project-path-authority.js \
  src/executor/execution-loop.js src/patch/patch-engine.js \
  src/effects/filesystem-effect-provider.js src/execution/project-change-runtime.js
node tests/execution-loop.test.js
node tests/patch-engine.test.js
node tests/m2-effect-broker-v1.test.js
node tests/m2-execution-project-change.test.js
```

## 2. Effect a approval authority

**Aktuální vlastněné bajty:** `contracts/m2/effect-v1.js`, `src/effects/`,
effect DB prerequisite a migrace `070–073`, `077`, `080–083`; Studio/chat
filesystem consumer a Tool/Execution adaptery, které EffectResult čtou.

**Povinná kontrola:** exact request/grant/result binding, single-use consume a
execution claim v jedné transakci, restart ownership, žádný false success,
provider evidence, inactive-grant `cancelled` terminály, retry generation a
A-prime receipt read model. Ověř, že `timed_out` stále znamená možný běžící
provider, `foreign` nic nezapisuje a section-4/5 efekty receipt authority
nepřevezme.

```bash
git diff 33cf221c..c070ed73 -- contracts/m2/effect-v1.js src/effects \
  src/db/m2-effect-core-v073-prerequisite.js \
  src/db/migrations/2026_08_23_070_m2_effect_authority.js \
  src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js \
  src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js \
  src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js \
  src/db/migrations/2026_08_24_077_m2_effect_invalidations.js \
  src/db/migrations/2026_08_24_080_m2_effect_semantic_authority.js \
  src/db/migrations/2026_08_24_081_m2_effect_result_semantic_authority_v2.js \
  src/db/migrations/2026_08_25_082_m2_preexecution_approval_terminals.js \
  src/db/migrations/2026_08_25_083_m2_effect_rollback_receipts.js \
  tests/m2-effect-*.test.js
node tests/m2-effect-contract-v1.test.js
node tests/m2-effect-authority-repository.test.js
node tests/m2-effect-broker-v1.test.js
node tests/m2-effect-file-runtime.test.js
node tests/schema-migrations.test.js
```

## 3. ProjectContext

**Aktuální vlastněné bajty:** `contracts/m2/project-context-v1.js`,
`src/code-intel/project-context-*`, `src/chat/handlers/code-analysis.js`,
produkční context init a fixtures/tests.

**Povinná kontrola:** ID-only registry authority, canonical root, content
addressed `wsr1`, double revision check, cancellation/timeout/stale rozlišení,
deterministický manifest/retrieval budget a nulový import legacy globálních
symbol/graph/cache providerů do produkční CODE_ANALYSIS cesty. Potvrď, že
containment nepředstírá obnovu plánovaného symbol-index follow-upu.

```bash
git diff 44a9ba87..c070ed73 -- contracts/m2/project-context-v1.js \
  src/code-intel/project-context-manifest.js \
  src/code-intel/project-context-provider.js \
  src/code-intel/project-context-scope.js src/chat/handlers/code-analysis.js \
  tests/m2-project-context-*.test.js
node tests/m2-project-context-contract.test.js
node tests/m2-project-context-boundary.test.js
node tests/m2-project-context-retrieval.test.js
node tests/m2-project-context-consumer.test.js
```

## 4. ToolRequest a ToolResult

**Aktuální vlastněné bajty:** `contracts/m2/tool-v1.js`, `src/tools/m2-*`,
`src/executor/tool-executor.js`, migrace `074–077` a Studio/chat rozhodovací
konzumenti.

**Povinná kontrola:** registry-owned risk/schema/effect kind, durable request a
jediný immutable terminal, exact reconnect replay, Tool–Effect link, potlačení
LLM fallbacku po authority denial a nulový legacy handler před brokerem.
Nepodporované network/read/exec/database cesty musí být pravdivě unavailable,
ne implementované.

```bash
git diff fa437d02..c070ed73 -- contracts/m2/tool-v1.js src/tools \
  src/executor/tool-executor.js src/chat/handlers/decisions.js \
  src/db/migrations/2026_08_24_074_m2_tool_authority.js \
  src/db/migrations/2026_08_24_075_m2_tool_effect_links.js \
  src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js \
  src/db/migrations/2026_08_24_077_m2_effect_invalidations.js
node tests/m2-tool-contract-v1.test.js
node tests/m2-tool-authority-repository.test.js
node tests/m2-tool-broker-v1.test.js
node tests/m2-tool-production-consumer.test.js
```

## 5. Durable project execution

**Aktuální vlastněné bajty:** `contracts/m2/execution-v1.js`, migrace `078`,
`src/execution/` a potřebné effect/path primitives.

**Povinná kontrola:** úplná authority set před prvním efektem, durable
before-images, fencing/takeover, exact rollback při driftu, reálný argv-only
bubblewrap profil bez sítě/host socket efektu, PGID kill a exact-path Git přes
temporary index a CAS. Zopakuj kontroly dřívějších type-drift, revision-scope a
post-CAS `IN_DOUBT` nálezů; parent terminal nesmí zamlčet Git in-doubt stav.

```bash
git diff a35805ee..c070ed73 -- contracts/m2/execution-v1.js src/execution \
  src/db/migrations/2026_08_24_078_m2_execution_authority.js \
  tests/m2-execution-*.test.js
node tests/m2-execution-contract-v1.test.js
node tests/m2-execution-authority-repository.test.js
node tests/m2-execution-project-change.test.js
node tests/m2-execution-process-supervision.test.js
node tests/m2-execution-git-preservation.test.js
```

## 6. Lifecycle a governance journey

**Aktuální vlastněné bajty:** `contracts/m2/governance-v1.js`,
`contracts/m2/lifecycle-v1.js`, migrace `079`, `src/lifecycle/m2-*`, M2 routes,
server wiring a jediný Studio surface.

**Povinná kontrola:** strict proposal bez tolerantního model fallbacku,
pre-effect governance nad exact candidate material, approval exact actor/plan/
revision, jediná section-5 execution cesta, pravdivý cancel/restart terminal a
append-only success join. Legacy mutační lifecycle routes musí být v karanténě;
UI nesmí použít obecné „ano“ ani starý write/exec bypass.

```bash
git diff da8698ff..c070ed73 -- contracts/m2/governance-v1.js \
  contracts/m2/lifecycle-v1.js src/lifecycle src/routes/m2-lifecycle.js \
  src/server.js c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js \
  src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js
node tests/m2-governance-contract-v1.test.js
node tests/m2-governance-evaluator.test.js
node tests/m2-lifecycle-contract-v1.test.js
node tests/m2-lifecycle-authority-repository.test.js
node tests/m2-lifecycle-application-service.test.js
node tests/m2-lifecycle-routes.test.js
node tests/m2-lifecycle-surface-retirement.test.js
node tests/m2-lifecycle-studio-surface.test.js
node tests/m2-negotiated-lifecycle-quarantine.test.js
```

## 7. RemoteCorePort contract-only boundary

**Aktuální vlastněné bajty:** `contracts/m2/remote-core-port-v1.js`,
`src/remote/remote-core-port-unavailable.js`, threat model a dva remote testy.

**Povinná kontrola:** strict negotiation, exact sedm capability ID, žádná
self-asserted authority, explicit unavailable výsledky a nulový import DB,
routes, serveru nebo network runtime. Ověř, že legacy listener zůstává exact
numeric loopback a že M2 nikde netvrdí listener, pairing, autentizaci, device
scope ani vzdálený runtime.

```bash
git diff cb9058b4..c070ed73 -- contracts/m2/remote-core-port-v1.js \
  src/remote/remote-core-port-unavailable.js \
  docs/security/REMOTE-CORE-PORT-V1-THREAT-MODEL.md \
  tests/m2-remote-core-port-*.test.js src/server.js
node tests/m2-remote-core-port-contract-v1.test.js
node tests/m2-remote-core-port-boundary.test.js
node tests/routes-smoke.test.js
```

## Integrační closeout po 7/7

Operátorský verdict je zaznamenaný v
`2026-08-25-M2-OPERATOR-FINAL-REVIEW.md`. Review gate je splněný; následující
body jsou poslední integrační podmínky před M2 acceptance.

Po sedmi `REVIEW_PASSED` se ještě ověří:

- shoda všech verdictů s přesným product targetem;
- clean worktree a žádný neintegrovaný product commit;
- registry, module ratchet, schema, artifact a finální deterministic report;
- přesně nezměněný non-PASS baseline `3 FAIL / 2 BLOCKED`;
- pravdivé označení remote scope jako contract-only;
- žádný push bez výslovného pokynu.

Teprve potom lze ROADMAP změnit z
`IMPLEMENTATION_GREEN / OPERATOR_REVIEW_PENDING` na M2 acceptance.
