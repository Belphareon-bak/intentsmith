# M5 — remediation integration closeout candidate

- **Stav:** `9/9 RE_REVIEW_READY / OPERATOR_REMEDIATION_REQUIRED / M6_GATE_CLOSED`
- **Technický base:** `1276e5ce0add7afec74ea2cd3983891da5425612`
- **Finální product candidate:** `034e00f58d35971ff390256f8eaf878361d33dde`
- **Evidence base:** `7020e4302a3a90997eca0d54052c14d4c40294a1`
- **Review range:** `1276e5ce..034e00f5`
- **Větev:** `codex/m5-integration-20260826`
- **Upstream/push:** žádný / neproveden

Tento dokument uzavírá implementační remediation všech 18 nálezů původního M5
review. Není to nezávislý re-review ani M5 acceptance. Osm skutečných rotací a
history disposition zůstávají operátorskou prací; M6 gate je zavřený.

## Remediation provenance

| Oddíl | Product remediation | Evidence | Stav |
|---|---|---|---|
| PACKAGE | `8be0094d` | final fresh clone níže | `RE_REVIEW_READY` |
| DATA | `bcfa5c8d` | `6e5f097a` | `RE_REVIEW_READY` |
| AUTH | `122b5df5` | `b8915bf2` | `RE_REVIEW_READY` |
| PROCESS | `7a282a3f` | `4f8402ed` | `RE_REVIEW_READY` |
| OBSERVE | `8be0094d` | `89d563c0` | `RE_REVIEW_READY` |
| OUTBOUND | `122b5df5` | `b8915bf2` | `RE_REVIEW_READY` |
| PERF | `034e00f5` | `7020e430` | `RE_REVIEW_READY` |
| REMOTE + CONDITIONAL | `122b5df5` | `b8915bf2` | `RE_REVIEW_READY` |
| PRIVACY | `1f4d15e3`, module baseline `d3829643` | `0fa41b39` | `RE_REVIEW_READY / OPERATOR_REMEDIATION_REQUIRED` |

M3 oddíl 7 byl přijat a formálně zapsán před tímto řezem. M5 jej znovu
neotevírá.

## Final-candidate PACKAGE fresh clone

Samostatný `git clone --no-local` byl detached na exact product
`034e00f58d35971ff390256f8eaf878361d33dde`. Použil vlastní HOME/XDG/TMP a
reflink kopii pouze lokálních cache. Příkaz
`./scripts/install.sh --profile=core --minimal --offline` skončil exit 0:

- `npm ci --offline` a frozen Yarn offline PASS;
- backend i Electron native ABI PASS;
- production Studio build a `STUDIO_M1_BUILD_CONSUMER_PASS`;
- instalační log neobsahuje registry URL, HTTP(S) ani Corepack download marker;
- install log SHA-256
  `353ed056333d1147f5fa945bf766b5960524a0c603a72aa82150e90154625129`;
- source po install/build zůstal čistý na exact SHA.

Následný production start nad izolovanou SQLite prošel skutečný
`GET /api/health` (`ok`) a deterministic `POST /api/chat` (`17*23 = 391`).
Health artifact SHA-256 je
`c13dbf9da81d40d2ad9b59173df9ba8cafa6284562a941046275c84c8c2a3113`,
chat artifact SHA-256
`4c9f4244ff832692c147fcc4e52bcf48003b7a0a62eeddd1022b474ffa1326a2`.
Shutdown skončil exit 0, obsahoval `Shutdown complete` a port file zmizel.

## Focused M5 panel

| Program | Výsledek |
|---|---:|
| `m5-install-profile` | 10/10 PASS |
| `m5-data-restore` | 13/13 PASS |
| `m5-global-auth` | 11/11 PASS |
| `m5-process-hardening` | 8/8 PASS |
| `m5-observability` | 7/7 PASS |
| `m5-outbound-policy` | 10/10 PASS |
| `m5-performance-budget` | 14/14 PASS |
| `m5-remote-core-adapter` | 12/12 PASS |
| `m5-conditional-surfaces` | 9/9 PASS |
| `m5-privacy-remediation` | 15/15 PASS |
| **Celkem** | **109/109 PASS** |

Compatibility evidence: storage 34/34; M2 execution contract 22/22,
repository 14/14, owner 5/5, Git preservation 13/13, process supervision 13/13
a project-change 23/23; RemoteCorePort 17/17 + 10/10; schema 38/38; routes
119/119; WebSocket 87/87; artifact 154/154; module ratchet 13/13; harness
meta-test PASS. Module graph má exact 1 186 hran, 3 cykly a 28 souborů v
cyklech. Registry validuje 456 programů s fingerprintem
`58d598df9765c376d31dadad69bfd81785230adbc802b7454f02c7b8d8637f5c`.

## PERF authority a raw měření

`M5PerformanceEvidence@2` váže kandidát na exact commit/tree, raw artefakt na
SHA-256/byte count a inherited baselines na revision/path/Git blob/SHA-256.
Baseline hodnoty odvozuje exact parser z Git bajtů, caller je neposílá. Nový
pětiminutový run na product `034e00f5` skončil PASS:

- deterministic HTTP 40/40, p95 6,077 ms;
- ProjectContext 40/40, p95 34,614 ms;
- core soak 1 498/1 498, 300 000 ms, p95 15,246 ms, 0 chyb;
- raw SHA-256
  `c26cffa869e8d8434bb1f24f6e69de414a520e9c3cfdf213bf40a31fa3446be5`;
- existující cesta byla odmítnuta `EEXIST` bez změny bajtů.

24h soak, maximum throughput a nový fyzický GPU run zůstávají `NOT RUN`.

## Úplný deterministický gate

První diagnostický běh `2026-08-26T20-04-57-855Z` měl
`283 PASS / 3 FAIL / 2 BLOCKED`: harness meta-test našel šest dnešních
test-owned direct runtime adresářů. Byly přesunuty, nikoli smazány, do přesné
obnovitelné karantény
`.intentsmith-artifacts/quarantine/m5-closeout-direct-tests-20260826/`.
Diagnostický report není autoritativní.

Autoritativní druhý běh z čistého evidence source `7020e430`:

- run ID `2026-08-26T20-10-46-163Z`;
- report SHA-256
  `6df01f71cbee4b7f5dfd5a00bb187ab70517771e0873297bf31ca9bd35b477e2`;
- `284 PASS / 2 FAIL / 2 BLOCKED`;
- `verdict: FAIL`, `exitCode: 1`.

Jediné non-PASS jsou přesně zděděné:

| ID | Stav |
|---|---|
| `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` | FAIL |
| `IS-T3-TESTS-VRAM-COORDINATION-TEST` | FAIL |
| `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` | BLOCKED |
| `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` | BLOCKED |

Osm M5 programů dostupných v profilu `offline,database` je PASS; zbývající
AUTH (`server`) a PROCESS (`soak/toolchain`) programy prošly ve focused panelu.

## Privacy pravda a zbývající brány

Exact-HEAD scan na `7020e430` přečetl 982 distribuovaných content souborů z
1 851 scanovaných, našel 0 current-tree findings a nevydal secret value.
Všech 13/13 incident objektů zůstává dosažitelných, proto verdict je
`PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE`, nikoli privacy PASS.

M5 může být technicky `REVIEW_PASSED` až po operátorském re-review 9/9. Ani pak
není `ACCEPTED`, dokud nejsou skutečně dokončeny a autoritativně zapsány:

1. všech osm provider rotations;
2. zvolená history disposition `rewrite`, `new_root`, nebo vědomé `retain`;
3. post-disposition current-tree/history scan a případný re-review změněných
   product bytes.

Nebyl proveden rotation, history rewrite/new root, push, force push, internet,
GPU/Ollama běh ani zásah do cizího checkoutu či procesu.
