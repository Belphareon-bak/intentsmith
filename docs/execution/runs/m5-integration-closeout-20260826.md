# M5 — integrační closeout kandidáta

- **Stav:** `IMPLEMENTATION_GREEN / OPERATOR_REMEDIATION_REQUIRED / REVIEW_PENDING / M3_GATE_OPEN`
- **Technický base:** `1276e5ce0add7afec74ea2cd3983891da5425612`
- **Integrační candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Review range:** `1276e5ce..94ea4ea7`
- **Větev:** `codex/m5-integration-20260826`
- **Upstream/push:** žádný / neproveden

Tento dokument uzavírá implementační a integrační přípravu všech devíti M5 Work
Packages. Není to nezávislé review ani M5 acceptance. Operátorská privacy
remediation a M3 oddíl 7 zůstávají samostatné vstupní brány.

## Dodané bloky

| Work Package | Product | Module baseline | Evidence | Stav |
|---|---|---|---|---|
| PACKAGE | `ce6b8276` | — | `97ed2eab` | `IMPLEMENTATION_GREEN` |
| DATA | `7ccb5f80` | `17c84cfd` | `8df20c52` | `IMPLEMENTATION_GREEN` |
| AUTH | `2aa0f8d7` | `7793931d` | `e8daf4d6` | `IMPLEMENTATION_GREEN` |
| PROCESS | `f979641c` | `bba01ebf` | `a54526a5` | `IMPLEMENTATION_GREEN` |
| OBSERVE | `44e74ae1` | `08d5a23a` | `9480155a` | `IMPLEMENTATION_GREEN` |
| OUTBOUND | `07b8155c` | `e8892d7a` | `8af05d14` | `IMPLEMENTATION_GREEN` |
| PERF | `fbca096e` | — | `c11ba7c2` | `IMPLEMENTATION_GREEN` |
| REMOTE-PORT + CONDITIONAL-SURFACES | `9abf672c` | `f8fc13e3` | `c7dd91d3` | `IMPLEMENTATION_GREEN` |
| PRIVACY | `a92b9fde` | `a699b436` | `550abcd2` | `IMPLEMENTATION_GREEN / OPERATOR_REMEDIATION_REQUIRED` |

Commit `94ea4ea7` je samostatný test-harness hardening: čtyři M5 root programy
dostaly statický isolated-DB bootstrap a meta-test nyní připíná všech 119
database-reachable root testů. Nezměnil produktovou autoritu ani module graph.

## M5 focused panel

| Program | Výsledek |
|---|---:|
| `m5-install-profile` | 9/9 PASS |
| `m5-data-restore` | 9/9 PASS |
| `m5-global-auth` | 10/10 PASS |
| `m5-process-hardening` | 11/11 PASS |
| `m5-observability` | 5/5 PASS |
| `m5-outbound-policy` | 7/7 PASS |
| `m5-performance-budget` | 9/9 PASS |
| `m5-remote-core-adapter` | 11/11 PASS |
| `m5-conditional-surfaces` | 8/8 PASS |
| `m5-privacy-remediation` | 13/13 PASS |
| **Celkem** | **92/92 PASS** |

Navazující compatibility evidence: harness meta-test PASS; artifact validace
154/154; module ratchet 13/13; schema 38/38; model-failover schema 20/20;
routes 119/119; WebSocket 87/87. Registry validuje 456 programů, z toho 359
`ACTIVE`, 81 `BLOCKED` a 16 `HISTORICAL`, s fingerprintem
`58d598df9765c376d31dadad69bfd81785230adbc802b7454f02c7b8d8637f5c`.
Module graph má 1 184 exact hran, 3 cykly a 28 souborů v cyklech. Schema má 152
tabulek a 77 aplikovaných migrací; migration fingerprint je
`39d26b2493fc7e42ceef5c83b5a31c518b3c900d71b56168570c9421b37bc4de`.

## Úplný deterministický gate

Gate běžel z čistého source `94ea4ea715d0019f66b47a039872aefbee2a9daa`:

- run ID `2026-08-26T17-42-16-084Z`;
- report SHA-256
  `f62c604e8d3a56ec180026267a19dd7e61192f06d3376588fa6ce1b5c38fca7f`;
- `284 PASS / 2 FAIL / 2 BLOCKED`;
- `verdict: FAIL`, `exitCode: 1`.

Jediné non-PASS jsou přesně zděděné:

| ID | Stav |
|---|---|
| `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` | FAIL |
| `IS-T3-TESTS-VRAM-COORDINATION-TEST` | FAIL |
| `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` | BLOCKED |
| `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` | BLOCKED |

Před tímto autoritativním během vznikl diagnostický run
`2026-08-26T17-36-00-002Z` s pátým FAIL v harness meta-testu. Příčinou nebyla
produktová regrese, ale 14 zachovaných direct-test runtime stromů po starších
neúspěšných přímých bězích. Byly ověřené jako user-owned generované testovací
artefakty a odstraněné; následný čistý gate výše je autoritativní. Tato
diagnostická odchylka není vydávána za PASS.

## Privacy pravda a otevřené operátorské kroky

Current-tree scanner na čistém product commitu prošel 1 835 trackovaných
souborů bez nálezu. Nečetl osobní obsah ani neemitoval secret values. Všech 13
známých incident objektů je ale stále dosažitelných v historii, takže verdict
je pravdivě `PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE`, nikoli privacy PASS.

M5 nelze přijmout, dokud operátor:

1. skutečně neprovede a přes transportní user authority nepotvrdí všech osm
   kategorií rotace;
2. nezvolí a nedokončí history disposition `retain`, `rewrite`, nebo
   `new_root` včetně pravdivého visibility receipt;
3. nevrátí review verdict všech devíti oddílů proti exact candidate;
4. samostatně neuzavře M3 oddíl 7.

Nebyl proveden secret rotation, history rewrite, force push, běžný push ani
zásah do cizího checkoutu, GPU nebo Ollama procesu.
