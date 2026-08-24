# WP-M2-TOOL-CONTRACT-V1 — integrační evidence

- **oddíl:** M2 4/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_BLOCKED_ACCOUNT_LIMIT`
- **integrační vstup:** `fa437d021e07728388eb61bbca88bcc98e208ddf`
- **product/test remediation revision:** `a8a37b40d5e0ea6eedc8933449cbb23923a9d3f2`
- **module-graph revision:** `526824f72698c7cbeb84be87d12865409e61489e`
- **registry evidence revision:** `7547a9a59cbd57472aee2ff32bd1938405609080`
- **registry fingerprint:** `a5688cc420066eb048de511708a6ef9db5be933589ac7ee19d73c2a56c05f42e`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, `REVIEW_PASSED` ani M2 PASS. Dokládá
implementačně zelený typed tool connector na aktivní Studio/chat hranici.
Povinný Opus max audit nebyl proveden, protože CLI skončilo před čtením
repository na účtovém spend limitu.

## Dodaný řez

- strict `ToolRequest@1` a terminal `ToolResult@1` s canonical encodingem,
  schema identity, input/output digests, riskem, timeoutem a evidence refs;
- stable request/idempotency z trusted persistované turn identity a exact
  durable replay;
- append-only SQLite authority s jedním resultem na request, exact indexed
  identity checks a effectful-success gate nad durable EffectResult;
- migraci 075 s append-only exact `ToolRequest` ↔ `EffectRequest` vazbou;
  SQLite odmítá křížové A/B přivázání a repository přepočítá registry,
  request/result/link digests i všechny čtené projekce;
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
- tři nové a jedna odstraněná přesně auditovaná module edge bez růstu cyklů.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-tool-contract-v1` | 11/11 PASS |
| `m2-tool-broker-v1` | 19/19 PASS |
| `m2-tool-authority-repository` | 13/13 PASS |
| `m2-tool-production-consumer` | 11/11 PASS |
| `schema-migrations` | 38/38 PASS; 65 migrací |
| `m1-model-failover-schema` | 20/20 PASS; tip 075 / 65 migrací |
| `m2-effect-contract-v1` | 20/20 PASS |
| `m2-effect-authority-repository` | 41/41 PASS |
| `m2-effect-broker-v1` | 21/21 PASS |
| `m2-effect-execution-owner` | 5/5 PASS |
| `m2-effect-file-consumer` | 7/7 PASS |
| `m2-effect-file-runtime` | 6/6 PASS |
| `ws-bridge` | 87/87 PASS |
| `m1-model-failover-schema` | 20/20 PASS |
| `harness-exit-code` | PASS |
| `module-boundary-ratchet` | 13/13 PASS |
| `artifact-validation` | 151/151 PASS |

Navazující effect a ProjectContext contract/consumer sady byly během integrace
znovu spuštěny bez změny jejich non-PASS množiny. Do tohoto reportu nejsou
započteny jako důkaz Tool connectoru.

Registry po přepnutí remediovaných sad na nový `lastGreen`:

- `valid: true`;
- 411 runnable programů a 14 explicitních exclusions;
- fingerprint
  `a5688cc420066eb048de511708a6ef9db5be933589ac7ee19d73c2a56c05f42e`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Module graph baseline obsahuje 1 083 hran. Remediace přidala přesně hrany
`file -> tool-executor`, `pre-handler -> tool-executor` a
`tool-authority-repository -> tool-registry`; současně odstranila starou
`file -> effect-file-runtime`. Cykly zůstaly 3 a jejich membership 28 souborů.

Artifact validace po remediaci nejprve pravdivě skončila `150 PASS / 1 FAIL`,
protože rozšířený tool authority kód změnil zdrojově odvozený počet řádků.
`SYSTEM-MAP` byl přepočten na 8 JavaScript souborů / 7 625 řádků / 153
deklarací; opakovaný běh prošel `151/151`.

První celý gate na `637a5d97` skončil `245 PASS / 5 FAIL / 2 BLOCKED`.
Oproti baseline přibyly dva stale sentinely: harness čekal 105 místo 107
database-reachable root testů a M1 schema suite čekala tip 073/63 migrací místo
074/64. Po zdrojově odvozené opravě prošly standalone. Druhý gate měl ještě
`harness-exit-code` FAIL, protože v `.intentsmith-artifacts/direct-tests`
zůstaly mnou vytvořené runtime adresáře z ručních běhů. Byly beze ztráty
přesunuty do `/tmp/intentsmith-m2-direct-tests.90rxgL/direct-tests`; žádná cizí
data ani proces nebyly změněny.

## Celý deterministický gate po remediaci

První běh po migraci 075 pravdivě skončil `246 PASS / 4 FAIL / 2 BLOCKED`,
protože M1 schema sentinel stále připínal tip 074 a 64 migrací. Zdrojově
odvozený sentinel byl opraven na tip 075 / 65 a jeho standalone sada prošla
20/20. Autoritativní opakování na `d172cc0f`:

- run ID `2026-08-24T01-38-08-449Z`;
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

## Review

- Opus byl spuštěn read-only nad původním rozsahem
  `fa437d021e07728388eb61bbca88bcc98e208ddf..8dce31d73eebe58430eeee35bdf5b3d048c067fd`
  s `--model opus --effort max`, bez write/network/GPU nástrojů;
- CLI skončilo exit 1 zprávou `You've hit your monthly spend limit`; stav je
  `REVIEW_BLOCKED_ACCOUNT_LIMIT`, nikoli verdict;
- interní coworker review původně vrátil sedm nálezů: misbound/lživý effect
  success, settlement drift po approval, chybějící adapter terminály, produkční
  file bypass, mixed-batch synthesis, database bypass a čitelný SQL forge.
  Všechny mají nyní konkrétní produktovou opravu a negativní test. Následný
  self-audit navíc uzavřel circuit-breaker bypass před brokerem. Nezávislé
  re-review rozsahu `46d87d9f..a8a37b40` probíhá; ani jeho případný PASS
  nenahrazuje povinný Opus verdict.

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
