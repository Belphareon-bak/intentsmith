# M5 — second-review remediation closeout

- **Stav:** `5/9 REVIEW_PASSED / 4/9 RE_REVIEW_READY / ACCEPTANCE_BLOCKED / M6_GATE_CLOSED`
- **Technický base:** `1276e5ce0add7afec74ea2cd3983891da5425612`
- **Product candidate:** `816a2a4c8a95b49d46f06b94b56feb64c8a40c90`
- **Product tree:** `db31c29870cb5f6916a28117f6ac8f55476d9388`
- **Evidence source:** `6e7cd7410c83826c88d6d65f6af2ae29fc5df3e6`
- **Review range:** `1276e5ce..816a2a4c`
- **Větev:** `codex/m5-integration-20260826`
- **Upstream/push:** žádný / neproveden

Tento packet odpovídá na druhé technické review, které ponechalo pět oddílů
`REVIEW_PASSED` a znovu otevřelo DATA, AUTH, PERF a PRIVACY sedmi nálezy.
Všech sedm nálezů je implementačně opraveno, ale tento dokument není nezávislý
re-review a nepovyšuje čtyři opravené oddíly na `REVIEW_PASSED`.

## Opravené bloky

| Oddíl | Commit | Oprava | Negativní důkaz | Stav |
|---|---|---|---|---|
| DATA | `c3170a12` | shared Linux `flock` drží skutečnou životnost SQLite connection, exclusive lease celý restore | opener/restore interleaving se nesmí překrýt; lease se uvolní až po close | `RE_REVIEW_READY` |
| DATA | `c3170a12` | produkční `fuser` používá self-probe a nejednoznačný exit 1 je fail-closed | no-holder je prokázaný zvlášť; diagnostic/permission/unknown blokuje | `RE_REVIEW_READY` |
| AUTH | `dc6e9b12` | local WS credential má tri-state `absent/valid/ambiguous` a guard zachová celý transportní credential set | malformed local + admin i dvě local identity končí 400 před identity binding | `RE_REVIEW_READY` |
| PERF | `b020ee19` | `M5PerformanceEvidence@3` + raw v2 váže `measured` na raw GPU measurement a ostatní stavy na census receipt | forged `measured` bez measurement a foreign-activity bez censu selžou | `RE_REVIEW_READY` |
| PERF | `b020ee19` | RSS je povinné kladné měření; `/proc` chyba ani chybějící `VmRSS` už nejsou nula | unreadable/missing/zero RSS je typed measurement failure | `RE_REVIEW_READY` |
| PRIVACY | `b15090a4` | veřejná privacy writer factory byla odstraněna; privátní mint je uvnitř credential-validating global transport auth a SQL writer přijme jen přesnou branded subject identitu se shodným actor ID | přímý SQL INSERT, syntaktický subject a klon legitimního subjectu selžou | `RE_REVIEW_READY / OPERATOR_REMEDIATION_REQUIRED` |
| PRIVACY | `b15090a4` | historie používá exact ref census + `rev-list`, se stabilitou refs před/po, a disposition-aware verdict | dangling objekt po rewrite není reachable; falešná declared disposition končí mismatch | `RE_REVIEW_READY / OPERATOR_REMEDIATION_REQUIRED` |

Module-baseline commit `6e7cd741` přijímá jedinou novou deklarovanou hranu
`privacy-authority-validation -> global-auth-policy`; graph má 1 187 hran,
3 cykly a 28 souborů v cyklech.

## Focused a průřezové testy

| Program | Výsledek |
|---|---:|
| `m5-install-profile` | 10/10 PASS |
| `m5-data-restore` | 17/17 PASS |
| `m5-global-auth` | 12/12 PASS |
| `m5-process-hardening` | 8/8 PASS |
| `m5-observability` | 7/7 PASS |
| `m5-outbound-policy` | 10/10 PASS |
| `m5-performance-budget` | 17/17 PASS |
| `m5-remote-core-adapter` | 12/12 PASS |
| `m5-conditional-surfaces` | 9/9 PASS |
| `m5-privacy-remediation` | 17/17 PASS |
| **Celkem** | **119/119 PASS** |

Navíc prošlo storage 34/34, WebSocket 87/87, schema 38/38, routes 119/119,
artifact 154/154, module ratchet 13/13 a repository hygiene nad 1 853 tracked
cestami. Registry má 456 programů a fingerprint
`58d598df9765c376d31dadad69bfd81785230adbc802b7454f02c7b8d8637f5c`.

## Exact-candidate fresh clone

Samostatný `git clone --no-local --no-hardlinks` byl detached na exact product
`816a2a4c`. Použil izolované HOME/XDG/TMP a pouze reflink kopii lokálních
cache. `./scripts/install.sh --profile=core --minimal --offline` skončil exit 0:

- `npm ci --offline` a frozen Yarn offline PASS;
- backend i Electron native ABI PASS;
- production Studio webpack build a `STUDIO_M1_BUILD_CONSUMER_PASS`;
- source po install/build zůstal čistý na exact SHA.

První diagnostický production start omylem použil neúčinné jméno proměnné
`C3_OLLAMA_URL`. Provedl pouze read-only lokální Ollama inventory/model-context
requesty, žádnou generaci ani GPU práci; byl graceful ukončen a není použitý
jako no-provider důkaz.

Autoritativní druhý start použil `OLLAMA_URL=http://127.0.0.1:9`, vlastní DB a
vlastní port. Reálnou Ollamu nekontaktoval; `GET /api/health` vrátil HTTP 200 s
ready DB/recovery a deterministický chat `17*23` vrátil `391`. SIGINT zavřel
DB, zalogoval `Shutdown complete`, odstranil port file a clone zůstal čistý.
GPU compute census byl prázdný.

## PERF exact evidence

Pětiminutový runner běžel v exact clone s invalidním provider URL; neprovedl
model generation ani fyzické GPU měření. Raw v2 nese read-only GPU census:
`nvidia-smi` exit 0, nula compute procesů, `measurement: null` a stav
`not_run_not_requested`.

| Plocha | Výsledek |
|---|---:|
| deterministic HTTP | 40/40, p95 5,022 ms, 0 chyb |
| ProjectContext | 40/40, p95 32,769 ms, 0 chyb |
| deterministic soak | 1 498/1 498, 300 074 ms, p95 14,314 ms, 0 chyb |
| soak RSS | start 169,023 MiB, peak 171,859 MiB, end 154,613 MiB |

- raw: 25 544 B, SHA-256
  `c7a9805c097cc49f306af98f429c0e5e11b7b915c36ae89ebc0f39eda599eee4`;
- envelope: 10 901 B, SHA-256
  `71ec92f577de0fcd909008b8eb5dbcaf9fce65d393950b0e174a318b8b95c797`;
- evaluation: `PASS`, žádný failed check.

24h soak, maximum-throughput a nové fyzické GPU měření zůstávají `NOT RUN`.

## Úplný deterministický gate

První diagnostický běh měl `283 PASS / 3 FAIL / 2 BLOCKED`. Harness metatest
pravdivě našel dva sandboxy z přímého module-ratchet ověření. Oba byly
přesunuty, nikoli smazány, do obnovitelné karantény
`.intentsmith-artifacts/quarantine/m5-second-review-module-ratchet-direct-tests-20260826/`.
Samostatný harness metatest poté prošel.

Autoritativní opakování z evidence source `6e7cd741`:

- run ID `2026-08-26T21-57-25-661Z`;
- report SHA-256
  `dd53e2b49bf3b57596e2fb9904c1d7a6b1db0d2a15a1be6c9b41e76cc89eed21`;
- `284 PASS / 2 FAIL / 2 BLOCKED`;
- `verdict: FAIL`, `exitCode: 1`.

Jediné non-PASS jsou přesně zděděné:

| ID | Stav |
|---|---|
| `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` | FAIL |
| `IS-T3-TESTS-VRAM-COORDINATION-TEST` | FAIL |
| `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` | BLOCKED |
| `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` | BLOCKED |

Všech osm M5 programů dostupných v profilu `offline,database` je PASS.

## Privacy pravda a operátorský blokátor

Exact-product scan přečetl 983 distribuovaných content souborů z 1 853
tracked, našel 0 current-tree findings a nevydal secret hodnotu. Ref census
prokázal, že všech 13/13 incident objektů je stále dosažitelných. Bez declared
disposition je správný verdict
`PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`.

Rotation receipts jsou stále 0/8 a history receipt chybí. Nebyla provedena
rotace, history rewrite/new root/retain receipt, push, force push, internetová
operace, model generation ani fyzická GPU práce. M5 zůstává technicky
`CHANGES_REQUESTED` do operátorského re-review čtyř oddílů; i při 9/9 zůstane
acceptance blokovaná do skutečných rotací a history disposition.
