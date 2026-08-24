# WP-M2-TOOL-CONTRACT-V1 — integrační evidence

- **oddíl:** M2 4/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_BLOCKED_ACCOUNT_LIMIT`
- **integrační vstup:** `fa437d021e07728388eb61bbca88bcc98e208ddf`
- **product/test revision:** `8ec1351e988f3a179ba64934813910ce8300c5c0`
- **module-graph revision:** `8dce31d73eebe58430eeee35bdf5b3d048c067fd`
- **registry fingerprint:** `a67d451426b8fefa4e1e5287d5378e975fd36b7b8a87acc26f0108a5331483a0`
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
- registry-owned překlad `file.write -> fs.write` a explicitní absence
  nepřesných providerů;
- aktivní Studio/chat singleton zapojený na durable broker; standalone legacy
  instance zůstávají jen mimo tuto produkční call graph;
- fail-closed web/database/unknown consumer proby, nulové handler/fetch calls a
  potlačený LLM fallback po authority denial;
- osm přesně přijatých module edges bez růstu cyklů.

## Focused evidence

| Sada | Výsledek |
|---|---:|
| `m2-tool-contract-v1` | 11/11 PASS |
| `m2-tool-broker-v1` | 15/15 PASS |
| `m2-tool-authority-repository` | 9/9 PASS |
| `m2-tool-production-consumer` | 7/7 PASS |
| `schema-migrations` | 38/38 PASS; 64 migrací |
| `module-boundary-ratchet` | 13/13 PASS |
| `artifact-validation` | 151/151 PASS |

Navazující effect a ProjectContext contract/consumer sady byly během integrace
znovu spuštěny bez změny jejich non-PASS množiny. Do tohoto reportu nejsou
započteny jako důkaz Tool connectoru.

Registry po přidání čtyř programů:

- `valid: true`;
- 411 runnable programů a 14 explicitních exclusions;
- fingerprint
  `a67d451426b8fefa4e1e5287d5378e975fd36b7b8a87acc26f0108a5331483a0`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Module graph baseline obsahuje 1 081 hran. Přibylo osm explicitních tool
authority hran, cykly zůstaly 3 a jejich membership 28 souborů.

Artifact validace v první iteraci pravdivě skončila `149 PASS / 2 FAIL`, protože
README nesl starý registry count a SYSTEM-MAP starý `src/tools` census. Obě
zdrojově odvozené projekce byly opraveny na 411 programů a 8 tool modulů;
opakovaný běh prošel `151/151`.

## Review

- Opus byl spuštěn read-only nad rozsahem
  `fa437d021e07728388eb61bbca88bcc98e208ddf..8dce31d73eebe58430eeee35bdf5b3d048c067fd`
  s `--model opus --effort max`, bez write/network/GPU nástrojů;
- CLI skončilo exit 1 zprávou `You've hit your monthly spend limit`; stav je
  `REVIEW_BLOCKED_ACCOUNT_LIMIT`, nikoli verdict;
- interní coworker adversariální review stejného rozsahu běží a jeho nálezy se
  opraví, ale jeho případný PASS nenahradí Opus.

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
- Celý deterministický gate a artifact validace se připíchnou až na čistém
  evidenčním commitu; očekávaný celkový verdict zůstává pravdivě `FAIL` kvůli
  známé baseline, dokud konkrétní běh neprokáže opak.
