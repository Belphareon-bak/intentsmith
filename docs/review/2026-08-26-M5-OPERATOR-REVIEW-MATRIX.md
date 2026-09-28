# M5 — společná operátorská review matice

- **Stav:** `9 RE_REVIEW_READY / 0 REVIEW_PASSED / OPERATOR_REVIEW_PENDING`
- **Technický base:** `1276e5ce0add7afec74ea2cd3983891da5425612`
- **Přesný product candidate:** `034e00f58d35971ff390256f8eaf878361d33dde`
- **Evidence base:** `7020e4302a3a90997eca0d54052c14d4c40294a1`
- **Review range:** `1276e5ce..034e00f5`
- **Větev:** `codex/m5-integration-20260826`
- **Push:** neproveden
- **Review autorita:** operátor projektu; lokální Opus se nepoužívá

Implementační odpověď na všech 18 původních nálezů je v
[`2026-08-26-M5-OPERATOR-REVIEW-RESPONSE.md`](2026-08-26-M5-OPERATOR-REVIEW-RESPONSE.md).
M5 má devět skutečných Work Packages, proto má tato matice devět oddílů.
Všechny používají stejné candidate bytes. `REVIEW_PASSED` všech oddílů potvrdí
technický řez, ale samo neprovede osm rotací ani nevyřeší Git historii. M3
oddíl 7 už je samostatně přijatý; bez rotací a history disposition nesmí
vzniknout `M5 ACCEPTED`.

## Společný protokol

1. Ověřit exact candidate, čistý worktree, nulový upstream a žádný push.
2. Trasovat produkční call graph od transportu/CLI až k efektu, SQLite nebo
   emitované odpovědi; focused test ani mapping tabulka samy nestačí.
3. U každé autority zkusit replay, forged actor/identity, nekanonický payload,
   restart/race a přímý SQL nebo provider bypass, pokud existuje.
4. Nepoužívat internet, GPU ani Ollamu. PERF přebírá přesně připnutou fyzickou
   M1/M2 evidence a pravdivě označuje nový GPU běh jako neprovedený.
5. Raw integrační gate musí zůstat `FAIL`, exit `1`, s přesně dvěma FAIL a
   dvěma BLOCKED. Jakýkoli další non-PASS je blocker review.
6. Nález uvést se severity, `file:line`, reprodukcí, dopadem a podmínkou
   přijetí. Review nic nepushuje a neprovádí privacy remediation.

## Přehled

| # | Oddíl | Product provenance | Stav |
|---:|---|---|---|
| 1 | PACKAGE | `8be0094d` | `RE_REVIEW_READY` |
| 2 | DATA | `bcfa5c8d` | `RE_REVIEW_READY` |
| 3 | AUTH | `122b5df5` | `RE_REVIEW_READY` |
| 4 | PROCESS | `7a282a3f` | `RE_REVIEW_READY` |
| 5 | OBSERVE | `8be0094d` | `RE_REVIEW_READY` |
| 6 | OUTBOUND | `122b5df5` | `RE_REVIEW_READY` |
| 7 | PERF | `034e00f5` | `RE_REVIEW_READY` |
| 8 | REMOTE-PORT + CONDITIONAL-SURFACES | `122b5df5` | `RE_REVIEW_READY` |
| 9 | PRIVACY + integrační baseline | `1f4d15e3..034e00f5` | `RE_REVIEW_READY / OPERATOR_REMEDIATION_OPEN` |

## 1. PACKAGE

**Vlastněné bajty:** `scripts/install.sh`, `scripts/run.sh`, Docker disposition,
instalační dokumentace a `tests/m5-install-profile.test.js`.

**Kontrola:** core versus full profil; Node 22 a exact process toolchain;
read-only preflight před mutací; `--offline` bez Corepack/npm/Yarn/Ollama sítě;
chybějící optional PDF je v core pravdivě optional a ve full fail-closed;
Docker nesmí inzerovat podporovanou produkční cestu ani rozšířit listener.
Fresh-clone report musí skutečně vázat install, Electron ABI, Studio build,
health, deterministic chat a čistý shutdown.

```bash
git diff 1276e5ce..034e00f5 -- scripts/install.sh scripts/run.sh docker \
  docs/INSTALL.md tests/m5-install-profile.test.js
node tests/m5-install-profile.test.js
```

## 2. DATA

**Vlastněné bajty:** `src/core/db-backup.js`,
`src/core/database-restore-lock.js`, DB opener, offline restore CLI/route a
`tests/m5-data-restore.test.js`.

**Kontrola:** V2 manifest váže exact payload hashes a migration identity;
backup je immutable a atomický; automatický restore vlastní pouze SQLite;
archival-only code/config se nesmí automaticky zapsat. Online/open DB, live
lease, corruption, extra/missing payload, unknown migration a legacy V1 musí
skončit před replacementem. PID bez Linux start identity není authority.
Ověřit skutečný backup -> damage -> offline restore -> byte i logical compare.

```bash
git diff 1276e5ce..034e00f5 -- src/core/db-backup.js \
  src/core/database-restore-lock.js src/db/database.js \
  scripts/restore-state-backup.js src/routes/system.js tests/m5-data-restore.test.js
node tests/m5-data-restore.test.js
node tests/storage-architecture.test.js
```

## 3. AUTH

**Vlastněné bajty:** `src/security/global-auth-policy.js`, server HTTP/WS
wiring, session adapter a `tests/m5-global-auth.test.js`.

**Kontrola:** guard musí běžet po exact route matchi a před každým handlerem;
veřejné jsou pouze tři přesné GET health/root klíče. Production nesmí mít
native-loopback bypass. Studio capability, admin token a API scopes nesmí
splývat; mixed credentials fail-close. WS musí provést tutéž transportní
autoritu před session creation a actor nesmí pocházet z body, chat ani control
payloadu. Read token nesmí projít write handlerem.

```bash
git diff 1276e5ce..034e00f5 -- src/security/global-auth-policy.js \
  src/server.js src/ws-bridge tests/m5-global-auth.test.js
node tests/m5-global-auth.test.js
node tests/ws-bridge.test.js
```

## 4. PROCESS

**Vlastněné bajty:** `process-sandbox-provider.js`, `process-recovery.js`,
execution repository/runtime a `tests/m5-process-hardening.test.js`.

**Kontrola:** exact `prlimit` musí instalovat konečné stropy před durable start
authority; jeho absence nesmí spustit target. Restart smí signalizovat pouze po
shodě boot ID, `/proc` start time, leader PID a PGID. PID reuse, missing leader
s live group, unreadable identity a cizí process group musí zůstat bez signálu.
Recovery census musí být prázdný před file/Git recovery; nejistota blokuje
rollback i terminál a startup retry nesmí mezitím otevřít lifecycle.

```bash
git diff 1276e5ce..034e00f5 -- src/execution/process-sandbox-provider.js \
  src/execution/process-recovery.js src/execution/project-change-runtime.js \
  src/execution/execution-authority-repository.js tests/m5-process-hardening.test.js
node tests/m5-process-hardening.test.js
```

## 5. OBSERVE

**Vlastněné bajty:** `src/observability/production-observability.js`, health a
diagnostics wiring a `tests/m5-observability.test.js`.

**Kontrola:** server request ID vzniká na hranici a známé operation/lifecycle/
run identity se jen validovaně korelují. Completion se finalizuje právě jednou
i při abortu. Taxonomy musí být deterministická a bounded ledger nesmí přijmout
payload, error string ani credential. Všechny public health aliasy používají
stejný handler a pravdivě degradují při nečitelné DB nebo neúplném recovery
censu; detailní diagnostics zůstává autentizovaný.

```bash
git diff 1276e5ce..034e00f5 -- src/observability/production-observability.js \
  src/server.js src/routes/misc.js tests/m5-observability.test.js
node tests/m5-observability.test.js
node tests/routes-smoke.test.js
```

## 6. OUTBOUND

**Vlastněné bajty:** migrace 089, outbound repository/policy, server startup a
všichni přepojení network consumers.

**Kontrola:** process-wide guard musí být instalovaný před optional/background
službami. Loopback zůstává lokální; externí request bez exact surface a scope
se durably denyne před transportem. Jediná podporovaná external plocha je
model metadata discovery s přesným HTTPS originem a GET/HEAD; redirect,
vypnutý opt-in nebo chybějící audit fail-close. DB nesmí obsahovat URL
path/query, headers, body ani credential values a audit musí být append-only.

```bash
git diff 1276e5ce..034e00f5 -- \
  src/db/migrations/2026_08_26_089_m5_outbound_audit.js \
  src/network src/server.js src/upgrade tests/m5-outbound-policy.test.js
node tests/m5-outbound-policy.test.js
node tests/outbound-network-optin.test.js
```

## 7. PERF

**Vlastněné bajty:** `contracts/m5/performance-v2.js`, performance evaluator,
artifact store, measurement script, report a `tests/m5-performance-budget.test.js`.

**Kontrola:** evidence a budget jsou exact a content-addressed; p95 je
nearest-rank, každá chyba má nulový budget a missing/rebound baseline fail-close.
Oddělit raw nové CPU měření od připnuté M1/M2 model/Studio/lifecycle/VRAM
evidence. Ověřit 40 HTTP, 40 ProjectContext a pětiminutový soak včetně error
rate a RSS; netvrdit throughput, 24h soak ani nový GPU PASS. Cizí Ollama aktivita
musí nový GPU běh blokovat bez ukončení procesu.

```bash
git diff 1276e5ce..034e00f5 -- contracts/m5/performance-v2.js \
  src/observability/performance-budget.js \
  src/observability/performance-artifact-store.js scripts/measure-m5-performance.js \
  tests/m5-performance-budget.test.js docs/execution/runs/m5-perf-remediation-20260826.md
node tests/m5-performance-budget.test.js
```

## 8. REMOTE-PORT + CONDITIONAL-SURFACES

**Vlastněné bajty:** remote adapter contract/implementation, conditional
release authority, server startup a dva M5 testy.

**Kontrola:** adapter musí použít byte-identický M2 descriptor/hello/
negotiation; dostupné jsou pouze `conversations@1` a `projects@1`. Zbývajících
pět capability vrací exact unavailable, bez downgrade. Invocation znovu váže
digests, verzi, operation, request a result identity. Fyzická hranice je jen
in-process: žádný listener, pairing, auth nebo DB/legacy bridge. Release set
defaultně podporuje pouze model discovery; notifications, marketplace,
ComfyUI a updater jsou unsupported a explicitní production enable musí
zastavit startup.

```bash
git diff 1276e5ce..034e00f5 -- contracts/m5/remote-core-adapter-v1.js \
  src/remote/remote-core-port-adapter.js src/release/conditional-surfaces.js \
  tests/m5-remote-core-adapter.test.js tests/m5-conditional-surfaces.test.js
node tests/m5-remote-core-adapter.test.js
node tests/m5-conditional-surfaces.test.js
```

## 9. PRIVACY + integrační baseline

**Vlastněné bajty:** privacy contract, migrace 090+091, repository/validation,
transport route, tree/history scanner, settings boundary, Studio cleanup,
environment-only secret consumers, harness fix a closeout evidence.

**Kontrola:** migration i všechny HTTP/WS/settings cesty musí odstranit nebo
odmítnout i nested credential keys bez logování values. Receipt authority je
append-only, actor pouze z transportu, kategorie/čas/visibility jsou exact a
replay typed konflikt. Scanner nečte citlivé trackované soubory, nevypisuje
object IDs ani matched values a dirty tree odmítá. Current tree má nula nálezů,
ale 13/13 známých history objektů zůstává dosažitelných. Ověřit, že stav je
stále 0/8 rotací a bez history receipt; test nesmí tuto skutečnost falšovat.

Evidence source `7020e430` má raw gate `284 PASS / 2 FAIL / 2 BLOCKED`,
`verdict: FAIL`, exit `1`. Jediné non-PASS:

- `nightly-orchestrator-self-test` — FAIL;
- `vram-coordination` — FAIL;
- `chat-export-budget` — BLOCKED;
- `export-pdf-docx` — BLOCKED.

```bash
git diff 1276e5ce..034e00f5 -- contracts/m5/privacy-remediation-v1.js \
  src/db/migrations/2026_08_26_090_m5_privacy_authority.js \
  src/db/migrations/2026_08_26_091_m5_privacy_writer_authority.js \
  src/security/privacy-authority-repository.js src/security/privacy-scan.js \
  src/security/user-settings-privacy.js src/routes/privacy.js \
  tests/m5-privacy-remediation.test.js tests/harness-exit-code.test.js
node tests/m5-privacy-remediation.test.js
node scripts/scan-m5-privacy.js
npm run test:registry
node tests/module-boundary-ratchet.test.js
node tests/schema-migrations.test.js
node tests/artifact-validation.test.js
```

## Výstup review

Požadovaný technický verdict bez blockeru:

```text
Oddíl 1: REVIEW_PASSED
Oddíl 2: REVIEW_PASSED
Oddíl 3: REVIEW_PASSED
Oddíl 4: REVIEW_PASSED
Oddíl 5: REVIEW_PASSED
Oddíl 6: REVIEW_PASSED
Oddíl 7: REVIEW_PASSED
Oddíl 8: REVIEW_PASSED
Oddíl 9: REVIEW_PASSED
M5 technical review: REVIEW_PASSED
M5 acceptance: PENDING_OPERATOR_ROTATIONS_AND_HISTORY
```

Jakýkoli `CHANGES_REQUESTED` nechává příslušný oddíl otevřený. Ani `9/9
REVIEW_PASSED` neopravňuje integrátora sám rotovat tajemství, přepisovat
historii nebo pushovat. M3 oddíl 7 už je samostatně `REVIEW_PASSED` a zapsaný.
