# WP-M2-EXECUTION-V1 — odpověď na Opus max re-review

- **review verdict:** `CHANGES_REQUESTED`
- **fix commit:** `816c5b1479064bd9c1b1ae529976f45b795ed0c9`
- **stav odpovědi:** `FIX_IMPLEMENTED / RE_REVIEW_REQUIRED`

## B1 uzavření

- Runtime má type-aware observation helper: path-authority výjimka se
  klasifikuje jako foreign evidence, nikdy jako úspěšný exact image.
- Exact after-image každé aplikované cesty se znovu čte až po Git a revision
  observerech a těsně před `terminal_prepared`; mismatch přechází do durable
  fail/rollback cesty.
- Registrovaný symlink test prochází čtyři kombinace: `src/app.js` a
  `deploy.cfg`, každá bez Git commitu i s commitem. Všechny vrátí durable
  `orphaned`, rollback `failed`, restart stejný immutable result a outside
  secret zůstane byte-exact nedotčený.
- Adresářový swap má samostatný test se stejnou durable terminalitou a
  zachováním foreign directory contentu.

## B2 uzavření

- `rollbackApplied`, `recoverOnly` i pre-write scan používají type-aware
  observation. Directory/symlink/canonical mismatch se stává foreign stavem;
  žádný z těchto readů už neunikne jako `ProjectPathError`.
- Recovery test vytváří durable consumed approval set, vymění target jednou za
  adresář a jednou za symlink, provede generation-2 takeover a v obou případech
  asertuje durable orphan. Další restart vrátí tentýž result bez efektu.
- Produkční lifecycle test provede type swap uvnitř focused procesu, okamžitě
  vytvoří execution i lifecycle orphan terminal, restartuje SQLite/service a
  dokazuje, že `recoverIncompleteSmallProjectChanges()` dokončí s prázdným
  recoverable setem a jediným durable terminalem.

## Čerstvé ověření

| Sada | Výsledek |
|---|---:|
| execution contract | 22/22 PASS |
| execution authority | 13/13 PASS |
| project change runtime | 17/17 PASS |
| process supervision | 13/13 PASS |
| exact Git preservation | 12/12 PASS |
| effect authority | 43/43 PASS |
| governance evaluator | 20/20 PASS |
| lifecycle application service | 6/6 PASS |
| artifact validation | 154/154 PASS |
| module boundary ratchet | 13/13 PASS |

Registry zůstává validní: 428 runnable programů, 14 exclusions, fingerprint
`54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

Čerstvý source-bound gate:

- source `816c5b1479064bd9c1b1ae529976f45b795ed0c9`;
- run `2026-08-24T10-19-26-305Z`;
- report `.intentsmith-artifacts/test-runs/2026-08-24T10-19-26-305Z/report.json`;
- report SHA-256 `de5653a15a4c936f6531ef15dcf9b29cfd382f721d0d2492f1a3f051325fb4b2`;
- `verdict: FAIL`, `exitCode: 1`;
- `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesně původních pět baseline non-PASS ID, žádné M2 non-PASS.

Dva předchozí ignorované 3GB gate run adresáře byly po nahrazení tímto během
odstraněny kvůli diskové kapacitě; jejich committed dokumentované SHA/counts
zůstávají, raw adresáře jsou obnovitelné opakováním. Aktuální run zůstává.

Tato odpověď není PASS. Celý section-5 scope musí znovu posoudit lokální Opus
nad současnými čistými bajty.
