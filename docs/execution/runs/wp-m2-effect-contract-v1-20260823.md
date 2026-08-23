# WP-M2-EFFECT-CONTRACT-V1 — branch evidence

- **stav řezu:** `CANDIDATE_V1 / REVIEW_REQUIRED`
- **vstupní revision:** `8f31e34f`
- **ověřená source revision:** `8bef4cfc982a90c8fcd043f8c1b4fc2e78ed6448`
- **větev:** `codex/m2-effect-contract-v1-20260823`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, hotový effect broker ani M2 PASS.
Dokládá executable kandidátní kontrakt a durable repository/ledger. Studio,
transporty, tools, lifecycle ani jiný effect-capable consumer na nový šev ještě
nejsou připojené. Repository je interní persistence seam a předpokládá trusted
issuer; autentizace approvalu a generování nonce patří do navazujícího brokeru.

## Dodaný řez

- striktní `EffectRequest@1`, `EffectResult@1` a `ApprovalGrant@1` s
  byte-stabilním kanonickým encodingem;
- uzavřené filesystem/process/network/Git targety, kind-bound risk class a
  přesná effect/grant scope;
- immutable request a terminal result, expirovatelný/revokovatelný single-use
  grant a append-only authority audit;
- SQLite migration 070 s databázově vynucenou identitou, append-only ochranou
  a právě jedním přechodem grantu do `CONSUMED` nebo `REVOKED`;
- atomické consume pod `BEGIN IMMEDIATE`, včetně důkazu přes dvě samostatná
  SQLite spojení;
- dvě nové append-only registry položky.

## Focused evidence na `8bef4cfc`

| Příkaz | Výsledek |
|---|---:|
| `node tests/m2-effect-contract-v1.test.js` | 17 PASS / 0 FAIL |
| `node tests/m2-effect-authority-repository.test.js` | 17 PASS / 0 FAIL |
| `node tests/schema-migrations.test.js` | 38 PASS / 0 FAIL; 60 migrací |
| `node tests/m1-model-failover-schema.test.js` | 20 PASS / 0 FAIL |
| `node tests/module-boundary-ratchet.test.js` | 13 PASS / 0 FAIL |
| `node tests/harness-exit-code.test.js` | PASS |
| `git diff --check` | PASS |

Negativní matice zahrnuje unknown fields, traversal/outside/alias target,
target-kind mismatch, falešný risk class, nekanonické timestampy, změnu
schváleného requestu, cizí scope, pre-issue/expired/revoked/consumed grant,
dva consume pokusy přes dvě DB spojení, restart persistence, konfliktní druhý
terminal a přímé SQL přepsání/smazání/identity drift.

## Registry evidence

`node scripts/validate-test-registry.js --json` skončil správně červeně:

- `valid: false`, `exitCode: 1`;
- 399 runnable programů, 9 explicitních exclusions;
- fingerprint `0602d66e71691b855afd51c17d41745901956c026fdfb7179ece7ad6bbb663b0`;
- jediná chyba: `docs/convergence/TEST-REGISTRY.md` je stale.

Generovaný `docs/convergence/TEST-REGISTRY.md`, root README counts a souhrnný
stav podle `CONTRACT.md` patří integračnímu SHA. Na této paralelní větvi nebyly
ručně přegenerované ani vydávané za PASS.

## Deterministický branch gate

Finální běh:

- příkaz: `npm run test:deterministic` (`offline,database`; bez model/Ollama/GPU
  profilu);
- run: `2026-08-23T21-03-59-472Z`;
- report:
  `.intentsmith-artifacts/test-runs/2026-08-23T21-03-59-472Z/report.json`;
- source revision: `8bef4cfc982a90c8fcd043f8c1b4fc2e78ed6448`;
- `verdict: FAIL`, `exitCode: 1`;
- 234 PASS / 4 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED.

Přijatá baseline na předchozím řezu byla 233 PASS / 3 FAIL / 2 BLOCKED. Všech
pět původních non-PASS ID zůstalo nezměněných:

- `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST` — FAIL;
- `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` — FAIL;
- `IS-T3-TESTS-VRAM-COORDINATION-TEST` — FAIL;
- `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` — BLOCKED;
- `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` — BLOCKED.

Nové registry sady přidaly dva PASS. Jediný nový non-PASS je
`IS-T1-TESTS-ARTIFACT-VALIDATION`: 150/151 assertions prošlo a selhal pouze
root README registry-count oracle, který čeká integrátorovu projekci 399
programů. To není přepsáno na PASS a před integrací se musí uzavřít na merge
SHA spolu s generovaným registry dokumentem.

První běh na `6f10176b` měl 232 PASS / 6 FAIL / 2 BLOCKED. Odhalil navíc
zastaralý migration-tip oracle a ignorovaný runtime z dřívějšího
infrastrukturního pádu. Oracle je opravený v `8bef4cfc`; oba přesně identifikované
runtime adresáře byly po kontrole otevřených handlů přesunuty do koše. Finální
gate potvrdil návrat obou sad do PASS.

## Podmínky dalšího postupu

1. Nezávislé review musí auditovat rozsah `8f31e34f..8bef4cfc`; teprve review
   smí rozhodnout o `PINNED_V1`.
2. Integrátor po merge přegeneruje `docs/convergence/TEST-REGISTRY.md`, opraví
   root README counts a znovu spustí registry/artifact gate na merge SHA.
3. Navazující implementační blok má přidat broker/issuer boundary a připojit
   první skutečný filesystem-write consumer; bez toho není varianta 011/C
   end-to-end uzavřená.
4. GPU/model/Ollama běh ani coworkerův checkout či procesy tento řez nespouštěl,
   neukončoval ani neupravoval.
