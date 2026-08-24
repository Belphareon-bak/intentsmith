# WP-M2-EXECUTION-V1 — odpověď na Opus max review

- **review verdict:** `CHANGES_REQUESTED`
- **fix commit:** `5d9b53c050d78525d9effc3e439d75afbe6e910a`
- **stav odpovědi:** `FIX_IMPLEMENTED / RE_REVIEW_REQUIRED`

## F1 uzavření

- Result contract i governance přijímají validní
  `afterRevision === beforeRevision`; exact after-images a Git evidence zůstávají
  vázané beze změny.
- Runtime validuje tvar každé revision observation, ale její změnu už nepoužívá
  jako náhradní důkaz zápisu. Produkční exact byte/mode readback zůstává proof.
- Po-write Git/revision observer failure je zachycen a zaznamenán jako durable
  non-success. Bez Git commitu se aplikované cesty exact rollbackují. Po již
  provedeném commitu vzniká poctivý durable `orphaned` s committed Git evidence
  a bez předstíraného rollbacku.
- Recovery dovoluje validní nezměněnou revision a dokončí committed exact state
  jako success.
- Produkční test mění `deploy.cfg` přes skutečný `observeWorkspaceRevision` a
  dokazuje okamžitý durable success. SIGKILL test nyní používá stejnou
  ne-manifestovou cestu a dokazuje generation-2 success bez focused rerunu.
- Celý lifecycle navíc mění `src/deploy.cfg`, projde governance, approval,
  bubblewrap, Git, receipt a terminal s nezměněnou revision.

## F2 uzavření

- Celý index se načítá jedním
  `git ls-files --stage -z --`; NUL records se exact rozdělí podle cest a jejich
  raw bytes dále tvoří index digest.
- Cizí regular file se otevírá `O_NOFOLLOW`, hash se počítá proudově přes jeden
  znovupoužitelný 64KiB buffer a před/po snapshot váže dev, inode, mode, size,
  mtime i ctime. Změna během čtení je typed `EXACT_GIT_BASELINE_CHANGED`; jiné
  lstat/open/read chyby jsou typed `ExactGitError`, nikoli raw Node error.
- Registrovaný test vytváří 3000 untracked cest, měří méně než 1 s a přes argv
  wrapper asertuje právě jedno batched `ls-files`.
- Další test hashoval 200MB sparse cizí soubor, změnil bajt uprostřed a prokázal
  změnu foreign dirt digestu při méně než 50MB RSS delta. Celá 12-testová sada
  pod `/usr/bin/time` dokončila za 1,50 s s absolutním Node max RSS 74 108 KiB;
  soubor samotný nikdy není celý resident.

## Čerstvé ověření

| Sada | Výsledek |
|---|---:|
| execution contract | 22/22 PASS |
| execution authority | 13/13 PASS |
| project change runtime | 14/14 PASS |
| process supervision | 13/13 PASS |
| exact Git preservation | 12/12 PASS |
| effect authority | 43/43 PASS |
| governance evaluator | 20/20 PASS |
| lifecycle application service | 5/5 PASS |
| artifact validation | 154/154 PASS |
| module boundary ratchet | 13/13 PASS |
| schema migrations | 38/38 PASS; 69 migrací |
| M1 failover schema | 20/20 PASS |

Registry zůstává validní: 428 runnable programů, 14 exclusions, fingerprint
`54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

Čerstvý celý gate je source-bound na fix commit:

- run `2026-08-24T09-49-09-778Z`;
- report `.intentsmith-artifacts/test-runs/2026-08-24T09-49-09-778Z/report.json`;
- report SHA-256 `c83b9341dd6ab641116b6c7ffcefc6cb50ef2a85042f03c7956294a910e5567f`;
- `verdict: FAIL`, `exitCode: 1`;
- `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesně stejných pět baseline non-PASS ID, žádné M2 non-PASS.

Tato odpověď není self-review PASS. Oddíl zůstává `RE_REVIEW_REQUIRED`, dokud
lokální Opus nad přesnými současnými bajty nevrátí `REVIEW_PASSED`.
