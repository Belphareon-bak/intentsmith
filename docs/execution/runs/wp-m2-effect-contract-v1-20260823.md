# WP-M2-EFFECT-CONTRACT-V1 — integrační evidence

- **oddíl:** M2 2/7
- **stav:** `IMPLEMENTATION_GREEN / REVIEW_BLOCKED_ACCOUNT_LIMIT`
- **integrační vstup:** `33cf221c3b772a1002311c8b1f71b67ad0d46cc9`
- **první product/test remediation:** `ad4d7eb3c066a76c9480f22b868f2f142cf755e8`
- **finální section head:** `fa437d021e07728388eb61bbca88bcc98e208ddf`
- **finální hardening revision:** `ba47da96ef7460335b5a4053605886e23c5f7924`
- **registry revision:** `fa437d021e07728388eb61bbca88bcc98e208ddf`
- **module-graph revision:** `fe594fb8`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden

Tento report nedokládá `PINNED_V1`, `REVIEW_PASSED` ani M2 PASS. Dokládá
zelenou implementaci canonical effect/approval authority a prvního skutečného
filesystem-write consumeru. Lokální Opus review s `--effort max` bylo spuštěno
nad přesným rozsahem, ale neprovedlo audit, protože CLI vrátilo
`You've hit your monthly spend limit`.

## Dodaný řez

- striktní `EffectRequest@1`, `EffectResult@1` a `ApprovalGrant@1` s
  byte-stabilním encodingem a povinnou grant identity v každém resultu;
- subject-bound issuer a canonical broker s atomickým consume + durable
  execution claimem;
- SQLite migrace 070–072, append-only audit a plný `sqlite_master` fingerprint
  `8813935b17a36ff9cbb94bd10ccc29a3a5f1688b1eaa3d7d4f7766fc9760f275`;
- owner identity přes boot ID/PID/process-start, fail-closed liveness a
  restart recovery do `IN_DOUBT` nebo jediného `orphaned` terminalu;
- idempotency z trusted persistované user-message identity a pending approval,
  který přežije websocket reconnect;
- odstranění přímého legacy `file.write`/`fs.write` obchvatu ve všech pozicích
  tool seznamu; odmítnutí se zachová jako `M2_EFFECT_AUTHORITY_REQUIRED` přes
  controller/M1/WS;
- filesystem provider s project-path authority, hardlink rejection, exact byte
  verification a fsync hranicí včetně existujícího parent directory;
- produkční runtime používá skutečný ProjectContext provider a registrovanou
  project revision.

## Adversariální review a opravy

Interní read-only coworker audit nad `33cf221c..33bcd33c` vrátil
`CHANGES_REQUIRED`. Nebyl vydáván za Opus review. Všech šest produktových
blokátorů a governance drift byly opraveny na `ad4d7eb3`:

1. canonical `file.write` a write mimo `tools[0]` nyní končí před executorem;
2. `EACCES`, `EIO`, malformed `/proc`, nekanonický boot ID a dříve neznámá
   owner identity už nejsou důkaz smrti;
3. commitnutý result zůstane dosažitelný při crash/DELETE okně a pending cleanup
   se opakuje na retry/startupu;
4. implicitní recursive mkdir byl odstraněn, takže pre-revalidation nemá
   directory-creation side effect;
5. post-write readback/compare failure nese applied changes a pending rollback;
6. cancel/timeout/orphan/invalid-evidence používají konzervativní rollback truth;
7. tento WP a report byly srovnány se skutečným broker/runtime/consumer scopem.

Navíc repository odmítá result, jehož `startedAt` předchází execution claimu.
Coworker re-review opraveného rozsahu běží; jeho výsledek nenahradí povinný
Opus verdict.

## Focused evidence

Assertion totals níže jsou obnovené cross-section revalidací na `d034df62`;
section-local registry a module facts zůstávají připnuté k `fa437d02`.

| Sada | Výsledek |
|---|---:|
| `m2-effect-contract-v1` | 20/20 PASS |
| `m2-effect-authority-repository` | 43/43 PASS |
| `m2-effect-broker-v1` | 25/25 PASS |
| `m2-effect-execution-owner` | 5/5 PASS |
| `m2-effect-file-consumer` | 7/7 PASS |
| `m2-effect-file-runtime` | 6/6 PASS |
| `schema-migrations` | 38/38 PASS |
| `m1-model-failover-schema` | 20/20 PASS |
| `capability-02-cre-behaviours` | 10/10 PASS |
| `ws-bridge` | 87/87 PASS |
| `execution-loop` | 61/61 PASS |
| `module-boundary-ratchet` | 13/13 PASS |
| `artifact-validation` | 154/154 PASS |

`node scripts/validate-test-registry.js --json` na finálním section headu:

- `valid: true`;
- 407 runnable programů a 14 explicitních exclusions;
- fingerprint
  `0358b40c2442e268f3e384def8b2471b496d94a65b9a3b363c8f8753d53e16d3`;
- generovaný `docs/convergence/TEST-REGISTRY.md` je aktuální.

Module graph baseline obsahuje 1 073 hran; ratchet zachovává 3 cykly / 28
souborů a všech 13 sentinelů prošlo.

## Celý deterministický gate

První section-local běh na `334f2796` skončil pravdivě `FAIL`, `exitCode: 1`,
`241 PASS / 5 FAIL / 2 BLOCKED`. Vedle pěti známých baseline non-PASS ID tehdy
selhaly `harness-exit-code` a `patch-engine`; tento běh tedy není vydáván za
zelený section gate. Navazující hardening do `fa437d02` obě nové regrese
opravil, ale samostatný celý gate před otevřením oddílu 4 už spuštěn nebyl.

Aktuální integrační důkaz je celý čistý `offline,database` gate na
`d415e6d780a0cac931a28e59c7a51919aed79251`:

- run `2026-08-24T08-27-21-820Z`;
- report
  `.intentsmith-artifacts/test-runs/2026-08-24T08-27-21-820Z/report.json`;
- `verdict: FAIL`, `exitCode: 1`;
- `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- všech šest registrovaných `m2-effect-*` sad PASS, včetně per-suite clean
  source a leak-cleanup evidence;
- non-PASS ID jsou přesně známá baseline množina: dva export BLOCKED,
  `nightly-audit-runner-self-test`, `nightly-orchestrator-self-test` a
  `vram-coordination`.

Tento pozdější gate dokládá, že section hardening zůstal v kompletní M2
integraci bez nové produktové regrese; nepřepisuje historický červený běh ani
z něj nedělá section-local PASS.

Cross-section audit na čistém `d034df62` navíc přímo zopakoval všech šest
effect sad s aktuálními assertion totals 20/20, 43/43, 25/25, 5/5, 7/7 a 6/6
PASS. Direct-test runtime byl po doběhu prázdný.

## Review

- Připravený přesný source review range je
  `33cf221c3b772a1002311c8b1f71b67ad0d46cc9..fa437d021e07728388eb61bbca88bcc98e208ddf`;
- Opus příkaz používá `--model opus --effort max`, read-only
  `--permission-mode plan` a `--no-session-persistence`;
- výsledek pokusu: `REVIEW_BLOCKED_ACCOUNT_LIMIT`, žádný modelový verdict;
- interní coworker review první iterace: `CHANGES_REQUIRED`, opravy výše;
- při dostupnosti účtu se celý přesný rozsah reviduje znovu; každý nález se
  opraví a review opakuje až do `REVIEW_PASSED`.

## Omezení a navazující práce

- Kontrakt zůstává `CANDIDATE_V1` do Opus PASS.
- Node path API nezavírá hostile ABA interval; missing-parent writes se zde
  fail-closed odmítají. Dirfd/openat2 patří sandbox/execution oddílu.
- Synchronous filesystem provider nelze timerem přerušit uprostřed syscallu;
  pozdní/nejisté dokončení se proto eviduje konzervativně.
- Execution owner je v durable claim ledgeru, nikoli v event details.
- Tento oddíl uzavírá filesystem-write consumer, ne obecné ToolRequest,
  process/network/Git execution, lifecycle ani RemoteCorePort.
- GPU/model/Ollama běh, coworkerovy procesy ani cizí checkouty nebyly ukončeny
  nebo změněny.
