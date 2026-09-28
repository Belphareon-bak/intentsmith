# M5 operator review response — 18 findings

- **Stav:** `9/9 RE_REVIEW_READY / 0 REVIEW_PASSED`
- **Původní review candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Nový product candidate:** `034e00f58d35971ff390256f8eaf878361d33dde`
- **Review range:** `1276e5ce0add7afec74ea2cd3983891da5425612..034e00f58d35971ff390256f8eaf878361d33dde`
- **Evidence base:** `7020e4302a3a90997eca0d54052c14d4c40294a1`
- **Review autorita:** operátor projektu; lokální Opus nepoužit

Toto je implementační odpověď na původní verdict `CHANGES_REQUESTED`. Stav
každé položky níže znamená `IMPLEMENTED / RE_REVIEW_REQUIRED`, nikoli
`REVIEW_PASSED`.

## Matice nálezů a oprav

| ID | Severity | Oprava | Negativní důkaz |
|---|---|---|---|
| PACKAGE-1 | HIGH | `--verify-only` už nikdy nevstoupí do NVM větve; cizí Node major končí exit 1 | fake Node 20 + executable fake NVM, marker nevznikne |
| PACKAGE-2 | MEDIUM | Upgrade používá existující storage dokument, backup před shutdownem a skutečný `/api/health` | doc smoke ověřuje link, route i oba verify příkazy |
| DATA-1 | HIGH | Backup publikuje snapshot jen po exact kompletním `wal_checkpoint(TRUNCATE)` | `{busy:1, log:1, checkpointed:0}` skončí bez publikace |
| DATA-2 | HIGH | Restore vlastní celý DB/WAL/SHM file-set a před výměnou vytváří durable safety snapshot | stale novější WAL se po reopen nepřehraje |
| DATA-3 | HIGH | `/proc` a holder census mají `alive/dead/unknown`; unreadable je fail-closed | simulované EACCES zachová lock a zablokuje restore |
| DATA-4 | HIGH | Stale cleanup používá karanténu a opakované inode/token ověření | replacement live lock přežije interleaving |
| AUTH-1 | MEDIUM blocking | WS předává všechny transportní credentials a parser vrací `absent/valid/ambiguous` | mixed local+admin, duplicate bearer a malformed bearer jsou odmítnuty před identity binding |
| PROCESS-1 | HIGH | `process_terminated` vznikne jen po prokázané prázdné group; orphan/unknown drží outstanding fence | orphan provider nevytvoří termination event ani rollback |
| PROCESS-2 | HIGH | Úplný startup census guard běží i na approval/effect-start vstupech | existující plán nelze approve během incomplete censu |
| PROCESS-3 | HIGH | Restart recovery drží Linux pidfd od nového identity checku přes signal až po empty census | zdroj nemá detached numeric kill path; pidfd mismatch fail-close |
| OBSERVE-1 | MEDIUM blocking | `close` vždy volá `finalize(true)`; exact-once latch zůstává | `writableEnded=true`, close bez finish => active 0/completed 1/aborted 1; finish→close pouze jednou |
| OUTBOUND-1 | HIGH | I loopback transport používá `redirect: manual`; každá Location dostane nové rozhodnutí | loopback redirect na non-loopback je auditovaně odmítnut před druhým transportem |
| OUTBOUND-2 | HIGH | Discovery authority je privátní opaque module capability a wrapper váže exact endpoint/path/query/header/body/method | opsaný scope string a unrelated HF path s Authorization neprojdou |
| PERF-1 | HIGH | Evidence v2 váže commit/tree, raw SHA/bytes a baseline revision/path/blob/SHA; metriky čte ze zdrojů | forged zero candidate, missing/tampered raw, missing Git source, rebound SHA, ambiguity a clobber fail-close |
| REMOTE-1 | HIGH | Project result se váže na exact workspace revision, normalizovaný query a všechny budgety | foreign revision/query/budget je odmítnut |
| CONDITIONAL-1 | MEDIUM | Preflight i všech pět runtime startupů používají jeden normalizovaný manifest/predicate | whitespace updater config je shodně disabled a timer nevznikne |
| PRIVACY-1 | CRITICAL | Migrace 091 vyžaduje opaque transport writer capability přímo v SQL triggeru | self-consistent direct SQL INSERT všech rotations/history selže |
| PRIVACY-2 | HIGH | Scanner odvozuje roots z distribučního manifestu, čte exact HEAD bloby a odděluje scanned/content-read census | runtime roots a multiline credential fixture jsou nalezeny; tracked pre-read race není možný |

## Připnuté implementační bloky

- PACKAGE + OBSERVE: product `8be0094d`, evidence `89d563c0`;
- DATA: product `bcfa5c8d`, evidence `6e5f097a`;
- PROCESS: product `7a282a3f`, evidence `4f8402ed`;
- AUTH + OUTBOUND + REMOTE + CONDITIONAL: product `122b5df5`, evidence
  `b8915bf2`;
- PRIVACY: product `1f4d15e3`, module baseline `d3829643`, evidence
  `0fa41b39`;
- PERF: product `034e00f5`, evidence `7020e430`.

Všechny product commity jsou předci nového candidate `034e00f5`.

## Společné acceptance evidence

- M5 focused panel: `109/109 PASS`;
- final-candidate offline fresh clone, production build, health, deterministic
  chat a clean shutdown: PASS;
- PERF 5min raw: PASS, 1 498/1 498, 0 errors, raw SHA-256
  `c26cffa869e8d8434bb1f24f6e69de414a520e9c3cfdf213bf40a31fa3446be5`;
- registry: 456 programů, fingerprint
  `58d598df9765c376d31dadad69bfd81785230adbc802b7454f02c7b8d8637f5c`;
- module graph: 1 186 exact hran, 3 cykly, 28 files in cycles;
- schema 38/38, artifact 154/154, routes 119/119, WS 87/87;
- privacy: 1 851 scanned / 982 content-read / 0 current findings, ale 13/13
  history incident objektů stále reachable;
- full deterministic report `2026-08-26T20-10-46-163Z`, SHA-256
  `6df01f71cbee4b7f5dfd5a00bb187ab70517771e0873297bf31ca9bd35b477e2`:
  `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict: FAIL`, exit 1, exact inherited IDs.

## Požadovaný výstup re-review

```text
PACKAGE                 = REVIEW_PASSED | CHANGES_REQUESTED
DATA                    = REVIEW_PASSED | CHANGES_REQUESTED
AUTH                    = REVIEW_PASSED | CHANGES_REQUESTED
PROCESS                 = REVIEW_PASSED | CHANGES_REQUESTED
OBSERVE                 = REVIEW_PASSED | CHANGES_REQUESTED
OUTBOUND                = REVIEW_PASSED | CHANGES_REQUESTED
PERF                    = REVIEW_PASSED | CHANGES_REQUESTED
REMOTE + CONDITIONAL    = REVIEW_PASSED | CHANGES_REQUESTED
PRIVACY                 = REVIEW_PASSED | CHANGES_REQUESTED
M5_TECHNICAL_REVIEW     = REVIEW_PASSED pouze při 9/9
M5_ACCEPTANCE           = BLOCKED_PENDING_ROTATIONS_AND_HISTORY
M6_GATE                 = CLOSED
```

I při technickém `9/9 REVIEW_PASSED` zůstávají skutečné rotations/history
operátorskou bránou. Review nesmí přímým SQL insertem nebo test fixturem
vytvořit falešné receipts a nemá pushovat ani měnit historii.
