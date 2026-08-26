# M5 — response to second technical review

- **Aktuální review stav:** `5/9 REVIEW_PASSED / 4/9 RE_REVIEW_READY`
- **M5 technical review:** `CHANGES_REQUESTED`
- **M5 acceptance:** `BLOCKED`
- **M6 gate:** `CLOSED`
- **Product candidate:** `816a2a4c8a95b49d46f06b94b56feb64c8a40c90`
- **Product tree:** `db31c29870cb5f6916a28117f6ac8f55476d9388`
- **Review range:** `1276e5ce0add7afec74ea2cd3983891da5425612..816a2a4c8a95b49d46f06b94b56feb64c8a40c90`
- **Evidence source:** `6e7cd7410c83826c88d6d65f6af2ae29fc5df3e6`
- **Reviewer:** operátor projektu; lokální Opus nepoužit

Pět verdiktů z druhého review zůstává beze změny. DATA, AUTH, PERF a PRIVACY
mají implementované všechny požadované opravy a jsou připravené na re-review;
nejsou zde jednostranně označené jako `REVIEW_PASSED`.

## Požadovaný rozsah re-review

| Oddíl | Co ověřit | Připnutí |
|---|---|---|
| DATA | shared/exclusive OS lease přes skutečný DB/restore lifetime; `fuser` exit-1 self-probe a fail-closed unknown | `c3170a12`, candidate `816a2a4c` |
| AUTH | local WS tri-state, malformed/duplicate/mixed credential rejection před identity binding | `dc6e9b12`, candidate `816a2a4c` |
| PERF | evidence v3/raw v2 GPU measurement/census vazba; unreadable/zero RSS failure; exact 5min raw | `b020ee19`, candidate `816a2a4c` |
| PRIVACY | žádná veřejná writer mint factory; exact authenticated subject identity až na SQL boundary; refs-based disposition-aware reachability | `b15090a4`, baseline `6e7cd741`, candidate `816a2a4c` |

## Společná evidence

- focused M5 panel `119/119 PASS`;
- DATA 17/17 + storage 34/34;
- AUTH 12/12 + WebSocket 87/87;
- PERF 17/17 a exact five-minute PASS, raw SHA-256
  `c7a9805c097cc49f306af98f429c0e5e11b7b915c36ae89ebc0f39eda599eee4`;
- PRIVACY 17/17, exact product scan 1 853/983/0, refs reachability 13/13;
- schema 38/38, routes 119/119, artifact 154/154, module ratchet 13/13;
- registry 456, fingerprint
  `58d598df9765c376d31dadad69bfd81785230adbc802b7454f02c7b8d8637f5c`;
- exact-candidate offline fresh install/build, no-provider health/chat/shutdown PASS;
- full gate report `2026-08-26T21-57-25-661Z`, SHA-256
  `dd53e2b49bf3b57596e2fb9904c1d7a6b1db0d2a15a1be6c9b41e76cc89eed21`:
  `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict: FAIL`, exit 1, exact inherited IDs.

Detailní reprodukční a provozní evidence je v
[`m5-second-review-remediation-closeout-20260827.md`](../execution/runs/m5-second-review-remediation-closeout-20260827.md).

## Požadovaný verdict

```text
PACKAGE                 = REVIEW_PASSED (beze změny)
DATA                    = REVIEW_PASSED | CHANGES_REQUESTED
AUTH                    = REVIEW_PASSED | CHANGES_REQUESTED
PROCESS                 = REVIEW_PASSED (beze změny)
OBSERVE                 = REVIEW_PASSED (beze změny)
OUTBOUND                = REVIEW_PASSED (beze změny)
PERF                    = REVIEW_PASSED | CHANGES_REQUESTED
REMOTE + CONDITIONAL    = REVIEW_PASSED (beze změny)
PRIVACY                 = REVIEW_PASSED | CHANGES_REQUESTED
M5_TECHNICAL_REVIEW     = REVIEW_PASSED pouze při 9/9
M5_ACCEPTANCE           = BLOCKED_PENDING_ROTATIONS_AND_HISTORY
M6_GATE                 = CLOSED
```

Ani `9/9 REVIEW_PASSED` samo neuzavře M5. Osm provider rotations a history
disposition musí být skutečně provedené a zapsané transportně autentizovaným
operátorem; současný stav je 0/8, bez history receipt a 13/13 incident objektů
dosažitelných z deklarovaných refs.
