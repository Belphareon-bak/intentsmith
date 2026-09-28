# WP-M2-TOOL-CONTRACT-V1 — integrační evidence

- **oddíl:** M2 4/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`
- **integrační vstup:** `fa437d021e07728388eb61bbca88bcc98e208ddf`
- **product/test remediation revision:** `0eb4c285035e06d8e263f914220e483c31e83b33`
- **module-graph revision:** `e45ea3510810038f66a2342fff587f3c641d9893`
- **evidence-rails / gate revision:** `abf34f30dbf3673206828c523e2d61cb1a025eb9`
- **registry fingerprint:** `a5688cc420066eb048de511708a6ef9db5be933589ac7ee19d73c2a56c05f42e`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report zatím nedokládá `PINNED_V1`, `REVIEW_PASSED` ani M2 PASS. Dokládá
implementačně zelený typed tool connector na aktivní Studio/chat hranici a
čerstvý gate nad kandidátem. První dostupné Opus max review nenašlo produktový
blocker, ale vrátilo `CHANGES_REQUESTED` kvůli stale evidenci; oprava čeká na
nový úplný re-review.

## Dodaný řez

- strict `ToolRequest@1` a terminal `ToolResult@1` s canonical encodingem,
  schema identity, input/output digests, riskem, timeoutem a evidence refs;
- stable request/idempotency z trusted persistované turn identity a exact
  durable replay;
- append-only SQLite authority s jedním resultem na request, exact indexed
  identity checks a effectful-success gate nad durable EffectResult;
- migrace 074–077 pro durable request/result, exact append-only
  `ToolRequest` ↔ `EffectRequest` vazbu, execution fencing, terminal truth a
  atomickou invalidaci pending effect authority; SQLite odmítá křížové A/B
  přivázání i unlinked terminal ponechávající live effect;
- registry-owned překlad `file.write -> fs.write` a explicitní absence
  nepřesných providerů;
- aktivní Studio/chat singleton i běžný LOCAL file handler zapojené na durable
  broker; pending effect se po schválení settluje z durable vazby bez druhého
  workspace observe a reconnect nemění authority identitu;
- fail-closed web/database/unknown consumer proby, nulové handler/fetch calls a
  potlačený LLM fallback po authority denial, včetně mixed pure+denial batche;
- throw, hang, cancel a timeout v effect adapteru vždy vytvoří durable terminal;
  providerem nabídnutý output nemůže přepsat projekci canonical EffectResult;
- otevřený legacy circuit breaker už nepřeskočí broker: circuit-open pure výsledek
  se journaluje a effectful unavailable request stále končí v authority vrstvě;
- jedenáct nových a jedna odstraněná přesně auditovaná module edge bez růstu
  cyklů.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-tool-contract-v1` | 12/12 PASS |
| `m2-tool-broker-v1` | 33/33 PASS |
| `m2-tool-authority-repository` | 24/24 PASS |
| `m2-tool-production-consumer` | 22/22 PASS |
| `schema-migrations` | 38/38 PASS; 67 migrací |
| `m1-model-failover-schema` | 20/20 PASS; tip 077 / 67 migrací |
| `m2-effect-contract-v1` | 20/20 PASS |
| `m2-effect-authority-repository` | 41/41 PASS |
| `m2-effect-broker-v1` | 25/25 PASS |
| `m2-effect-execution-owner` | 5/5 PASS |
| `m2-effect-file-consumer` | 7/7 PASS |
| `m2-effect-file-runtime` | 6/6 PASS |
| `ws-bridge` | 87/87 PASS |
| `harness-exit-code` | PASS |
| `module-boundary-ratchet` | 13/13 PASS |
| `artifact-validation` | 154/154 PASS |

Navazující effect a ProjectContext contract/consumer sady byly během integrace
znovu spuštěny bez změny jejich non-PASS množiny. Do tohoto reportu nejsou
započteny jako důkaz Tool connectoru.

Registry po přepnutí remediovaných sad na nový `lastGreen`:

- `valid: true`;
- 411 runnable programů a 14 explicitních exclusions;
- fingerprint
  `a5688cc420066eb048de511708a6ef9db5be933589ac7ee19d73c2a56c05f42e`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Module graph baseline obsahuje 1 093 hran. Integrační writer přijal přesně 11
nových hran a zpřísnil jednu odstraněnou. Cykly zůstaly 3 a jejich membership
28 souborů.

Artifact validace po remediaci nejprve pravdivě skončila `150 PASS / 1 FAIL`,
protože rozšířený tool authority kód změnil zdrojově odvozený počet řádků.
`SYSTEM-MAP` byl přepočten na 9 JavaScript souborů / 8 633 řádků / 153
deklarací. Po review přibyly sentinely pro exact migration manifest, počet
aplikovaných migrací a module-edge census; opakovaný běh prošel `154/154`.

První celý gate na `637a5d97` skončil `245 PASS / 5 FAIL / 2 BLOCKED`.
Oproti baseline přibyly dva stale sentinely: harness čekal 105 místo 107
database-reachable root testů a M1 schema suite čekala tip 073/63 migrací místo
074/64. Po zdrojově odvozené opravě prošly standalone. Druhý gate měl ještě
`harness-exit-code` FAIL, protože v `.intentsmith-artifacts/direct-tests`
zůstaly mnou vytvořené runtime adresáře z ručních běhů. Byly beze ztráty
přesunuty do `/tmp/intentsmith-m2-direct-tests.90rxgL/direct-tests`; žádná cizí
data ani proces nebyly změněny.

## Celý deterministický gate po remediaci

Autoritativní čistý běh na `abf34f30`, tedy po product, module-graph i
evidence-rails remediaci:

- run ID `2026-08-24T04-28-28-845Z`;
- `verdict: FAIL`, `exitCode: 1`;
- `247 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT / 0 SKIPPED`;
- všechny čtyři `m2-tool-*` programy PASS;
- non-PASS ID jsou přesně známá baseline množina:
  - `nightly-audit-runner-self-test` — FAIL;
  - `nightly-orchestrator-self-test` — FAIL;
  - `vram-coordination` — FAIL;
  - `chat-export-budget` — BLOCKED;
  - `export-pdf-docx` — BLOCKED.

Vyšší PASS count proti starému M1 reportu tvoří nově registrované zelené M2
effect, ProjectContext a Tool sady; celkový `FAIL` se nevydává za gate PASS.

Poslední cross-section gate na čistém
`0046cd9d76c19cb3160659b5caf56a32af5024c0` zopakoval všechny čtyři
`m2-tool-*` programy jako PASS. Report
`.intentsmith-artifacts/test-runs/2026-08-24T09-09-50-584Z/report.json` má
nad současnou kompletní M2 integrací stále přesně
`260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT`; non-PASS ID jsou stejných pět
baseline programů. Tento důkaz nemaže section-local historii ani chybějící
Opus re-review.

## Review

- Opus byl spuštěn read-only nad čistým `e45ea351` a rozsahem
  `fa437d021e07728388eb61bbca88bcc98e208ddf..e45ea351` s
  `--model opus --effort max`;
- verdict byl `CHANGES_REQUESTED`: žádný blocking defect v produkční tool
  authority cestě, ale stale gate, chybějící reservation evidence 076/077 a
  nepravdivé dokumentační počty;
- všechny tři evidence nálezy jsou opravené na `abf34f30`: exact 67-file
  migration manifest, `125 / 67`, `1 093`, aktuální focused čísla a nový čistý
  gate se stejnou baseline non-PASS množinou;
- konečný Opus max re-review opraveného kandidáta zatím neproběhl, proto tento
  report stále nesmí tvrdit `REVIEW_PASSED`.

## Test isolation poznámka

Při širší compatibility kontrole byl omylem spuštěn i
`tests/e2e-resilience.test.js`, který registry správně klasifikuje jako modelový
a jeho log ukázal tři LLM klasifikace. Nebyl použit jako offline evidence,
žádný GPU/Ollama proces ani konfigurace nebyly ukončeny či změněny a sada se
mimo koordinovaný modelový slot nebude opakovat.

## Omezení a navazující práce

- Funkční production adapter v tomto oddílu existuje pouze pro `file.write`.
- Web search/scrape, file read, code exec a database query jsou secure-unavailable
  před efektem. To je záměrná dočasná availability ztráta, ne dokončená funkce.
- Obecný sandbox, patch/Git/test/rollback, lifecycle a RemoteCorePort zůstávají
  v oddílech 5–7.
- Celý deterministický gate zůstává pravdivě `FAIL` kvůli výše uvedené známé
  baseline; oddíl 4 nepřidal nové non-PASS ID.
