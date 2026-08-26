# M3 — společná operátorská review matice

- **Stav:** `6 REVIEW_PASSED / 1 RE_REVIEW_READY / REVIEW_PENDING`
- **Přijatý M2 base:** `9f8a70196c6677f0542852c133a6b3d37093b039`
- **Původní reviewed source:** `07f2510cb7dc6a07ff7aece7c4d3863a27ca3205`
- **Section 7 product fix:** `7708519e7ac8774660ed4098834afbe26c82d1ee`
- **Ověřený evidence source:** `abd7c594e0d8afe2433f97470c5185ecf264f727`
- **Section 7 re-review range:** `07f2510c..abd7c594`
- **Větev:** `codex/m3-integration-20260825`
- **Push:** neproveden
- **Review autorita:** operátor projektu; lokální Opus se nepoužívá

Operátorské review přijalo oddíly 1–6 a vrátilo oddíl 7 kvůli živé legacy
agent effect cestě. Doporučená varianta B je implementovaná. Zbývá pouze
re-review oddílu 7; zelený test ani implementační commit jej sám nenahrazuje.

## Společný protokol

1. Ověř candidate SHA a čistotu worktree.
2. Trasuj skutečný produkční call graph až k emitovanému nebo persistovanému
   výsledku; nespoléhej jen na manifest a unit test.
3. Kontroluj aktuální bytes na candidate, protože pozdější integrační opravy
   mohly změnit starší řez.
4. Spouštěj jen uvedené offline/isolated suites; GPU a Ollama nejsou potřeba.
5. U blockeru uveď severity, `file:line`, reprodukci a acceptance condition.
6. M3 se neuzavírá, dokud není 7/7 `REVIEW_PASSED` a integrační evidence nemá
   nový non-PASS.

## Přehled

| # | Oddíl | Hlavní provenance | Stav |
|---:|---|---|---|
| 1 | L0-8 strict injection a enforcement | `a0d46903..b278a0ab` | `REVIEW_PASSED` |
| 2 | ExtensionManifest/Context a lifecycle | `6238d6b1..52cc0d76` | `REVIEW_PASSED` |
| 3 | Expertise extension | `cc721f54..a1e6b1f8` | `REVIEW_PASSED` |
| 4 | Governed skill | `381011d0..13f645d1` | `REVIEW_PASSED` |
| 5 | Code-review specialist | `f35391a3..b278a0ab` | `REVIEW_PASSED` |
| 6 | Project-health agent | `f484ef76..b278a0ab` | `REVIEW_PASSED` |
| 7 | Integrační effect closure, baseline a MCP disposition | `07f2510c..abd7c594` | `RE_REVIEW_READY` |

## 1. L0-8 strict injection a enforcement

**Vlastněné bajty:** `specialists/*`, `src/specialists/specialist-boundary.js`,
`scripts/specialist-boundary-ratchet.mjs`, loader registration context a
odpovídající boundary/legacy compatibility testy.

**Kontrola:** žádný specialista neimportuje `src/**`; `ToolAdapter` a registry
jsou explicitní capability; scanner je rekurzivní; symlink/computed/escaped
import, effectful builtin, third-party bare import, `fetch`, `eval`, `Function`
a process-effect API selžou closed. Ověř, že čisté `path/url/crypto` použití a
relativní package importy zůstávají dostupné.

```bash
git diff 9f8a7019..ad23c278 -- specialists src/specialists \
  scripts/specialist-boundary-ratchet.mjs tests/specialist-boundary-ratchet.test.js
node scripts/run-suites.js --suite=IS-T1-TESTS-SPECIALIST-BOUNDARY-RATCHET-TEST,IS-T1-TESTS-ACCOUNTANT-SELF-CONTAINED-TEST --log-level=warn
```

Přiznaná hranice: scanner není hostile-code runtime sandbox. Rozhodni, zda je
pro podporované M3 balíčky dostatečný, nebo vrať konkrétní bypass jako
`CHANGES_REQUESTED`.

## 2. ExtensionManifest/Context a lifecycle

**Vlastněné bajty:** `contracts/m3/extension-v1.js`,
`src/specialists/specialist-loader.js`, specialist routes/marketplace bridge a
host capability wiring.

**Kontrola:** exact key/version/kind/core contract, canonical order, required a
optional capability, chybějící required fail-closed, extension nemůže podstrčit
host capability; install je disabled, enable je samostatný; disable/remove
odmítne busy; tombstone přežije discovery; explicit reinstall spustí pending
migrace, ale sám neroutuje; uninstall odpojí expertise a nenechá pending efekt.

```bash
git diff 9f8a7019..ad23c278 -- contracts/m3 src/specialists \
  src/routes/specialists.js src/marketplace/package-installer.js
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-EXTENSION-CONTRACT-V1-TEST,IS-T1-TESTS-SPECIALIST-LOADER-TEST --log-level=warn
```

## 3. Expertise extension

**Vlastněné bajty:** `src/extensions/expertise-extension-service.js`, expertise
handler/routes/server wiring a E2E 83.

**Kontrola:** durable exact manifest identity, instalace bez routing efektu,
enable/disable/remove, konflikt s built-in, stale digest a restart, měřitelný
rozdíl výběru i user-visible definice bez nové effect authority.

```bash
git diff 9f8a7019..ad23c278 -- src/extensions/expertise-extension-service.js \
  src/chat/handlers/expertise.js src/routes/expertises.js tests/m3-expertise-extension.test.js \
  tests/e2e/83-m3-expertise-extension.e2e.js
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-EXPERTISE-EXTENSION-TEST,IS-T3-E2E-83-M3-EXPERTISE-EXTENSION --log-level=warn
```

## 4. Governed skill

**Vlastněné bajty:** `skills/m3-project-note.json`, skill registry/runner/steps,
`src/skills/m2-effect-authority.js`, M2 tool/effect adapter follow-up a chat
skill/pre-handler hranice.

**Kontrola:** typed inputs, fixní/proměnné kroky, template/prompt, tool choice,
checkpoint, approval a quality/output criteria; trigger je deterministický;
write nemá FS API; exact effect identity, single-use grant, actor binding,
reconnect idempotence, cancel terminal a nulový legacy shell process efekt.

```bash
git diff 9f8a7019..ad23c278 -- skills/m3-project-note.json src/skills \
  src/chat/handlers/skill.js src/chat/handlers/pre-handler.js \
  src/tools/m2-tool-broker.js src/tools/m2-tool-effect-adapter.js
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-SKILL-EFFECT-AUTHORITY-TEST,IS-T1-TESTS-M2-TOOL-BROKER-V1-TEST --log-level=warn
```

Přiznaná race hranice musí zůstat `EFFECT_EXECUTION_IN_DOUBT`, nikdy false
success.

## 5. Code-review specialist

**Vlastněné bajty:** `specialists/code-reviewer`,
`src/extensions/specialist-project-context.js`, specialist runtime/chat handler,
loader a E2E 84.

**Kontrola:** Studio/chat selection skutečně routuje na specialistu; invocation
token je single-use a vázaný na project/conversation/message/tool; ProjectContext
má exact limity/revision; output je deterministický, strukturovaný a zachová
provenance; disabled/removed/stale/budget/error cesty nemají model fallback ani
vedlejší efekt; full lifecycle přežije discovery a reinstall.

```bash
git diff 9f8a7019..ad23c278 -- specialists/code-reviewer \
  src/extensions/specialist-project-context.js src/chat/handlers/specialist.js \
  src/expertises/specialist-runtime.js tests/m3-code-review-specialist.test.js \
  tests/e2e/84-m3-code-review-specialist.e2e.js
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-CODE-REVIEW-SPECIALIST-TEST,IS-T3-E2E-84-M3-CODE-REVIEW-SPECIALIST --log-level=warn
```

## 6. Project-health agent

**Vlastněné bajty:** `agent-extensions/project-health`, agent extension/context
services, project-health source, runner/repository/scheduler/routes/Studio panel
a E2E 64.

**Kontrola:** manifest/digest/project identity, opaque single-use ProjectContext
token, baseline versus changed trigger, durable revision/provenance bez raw
obsahu, viditelná escaped notifikace, disabled/removal inertnost, run order a
správná notification repository signatura. Negativně ověř HTTP/webhook/model a
non-in-app action policy.

```bash
git diff 9f8a7019..ad23c278 -- agent-extensions src/extensions/agent-* \
  src/agents src/routes/agents.js tests/m3-project-health-agent.test.js \
  tests/e2e/64-m3-project-health-agent.e2e.js
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-PROJECT-HEALTH-AGENT-TEST,IS-T3-E2E-64-M3-PROJECT-HEALTH-AGENT --log-level=warn
```

## 7. Integrační effect closure, baseline a MCP disposition

**Vlastněné bajty:** celý M3 range, module baseline/registry/harness změny,
decision 031 a sjednocený closeout report.

**Kontrola re-review:** legacy non-extension agent mutátory vracejí přesný
typovaný HTTP 410 bez čtení requestu; startup už neregistruje example agenty;
scheduler v produkci spustí pouze instanci, kterou znovu ověří
`AgentExtensionService.resolveExecution`. Native install/run/enable/disable/remove
cesty zůstávají funkční pod `/api/agent-extensions`. Zvlášť ověř interpolovaný
webhook payload z původního nálezu: retired handler se jeho bajtů nesmí dotknout.

Integrační stav: module baseline 1 150 hran, 3 cykly/28 souborů, registry 438
s fingerprintem `ca2aa642e8e433ea484a2c20c42f3f8aa045b2b4b906548f417a5185265ed54f`
a úplný běh `268 PASS / 2 FAIL / 2 BLOCKED` bez nového non-PASS.

```bash
git diff --check
node scripts/validate-test-registry.js --json
node scripts/run-suites.js --suite=IS-T1-TESTS-M3-LEGACY-AGENT-SURFACE-RETIREMENT-TEST,IS-T1-TESTS-SCHEDULER-TEST,IS-T3-E2E-08-AGENTS,IS-T3-E2E-63-AGENT-EXECUTION,IS-T3-E2E-64-M3-PROJECT-HEALTH-AGENT --log-level=warn
node tests/module-boundary-ratchet.test.js
node tests/schema-migrations.test.js
node tests/artifact-validation.test.js
```

## Výstup review

Vrať pouze re-review verdict oddílu 7 a souhrnný stav. Bez nálezů je
požadovaný tvar:

```text
Oddíl 7: REVIEW_PASSED
M3: REVIEW_PASSED
Legacy-agent scope disposition: mutační legacy surface je fail-closed retired;
native M3 extension cesta zůstává jedinou spustitelnou agent authority.
```

Tento výstup ještě musí integrátor zapsat do finální closeout authority; samotný
review text bez přesné candidate identity M3 neuzavírá.
