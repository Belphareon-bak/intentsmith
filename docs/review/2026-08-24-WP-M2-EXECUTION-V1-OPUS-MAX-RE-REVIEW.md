# WP-M2-EXECUTION-V1 — Claude Opus max re-review

- **oddíl:** M2 5/7
- **reviewer:** lokální Claude Opus, `--model opus --effort max`
- **režim:** read-only `--permission-mode plan --no-session-persistence`
- **review head:** `0260bcb9e566c5d738f50bc2c8f2cf689827c168`
- **section-5 product commit:** `5d9b53c050d78525d9effc3e439d75afbe6e910a`
- **verdict:** `CHANGES_REQUESTED`
- **původní modelový výstup:** `/home/belphareon/.claude/plans/perform-an-independent-read-only-functional-sunset.md`
- **SHA-256 původního výstupu:** `8e1d07feef1cf94cca1c91b6dc67aa62c719f2fe5948fcc4f32eadfbdadd90e4`

Opus přímými sondami uzavřel oba předchozí nálezy F1 a F2. Re-review přesto
není PASS, protože našel dvě nové HIGH false-success/terminality hrany.

## Potvrzená uzavření

- Produkční `deploy.cfg` s reálným `observeWorkspaceRevision` okamžitě skončil
  durable `succeeded` se stejnou revision a bez rollbacku. Post-write observer
  failure skončil durable `failed` s exact rollbackem.
- 3000 untracked cest: 50 ms a právě jeden
  `git ls-files --stage -z --`; 200MB soubor měl bounded RSS a změnu digestu po
  byte flipu; 2 GiB + 4096 B dokončilo bez raw erroru; I/O error byl typed
  `ExactGitError`.
- Sandbox probe znovu potvrdil seccomp/no-new-privileges/nulové capabilities,
  neviditelný outside root, read-only projekt/kořen a nulový host socket effect.
- Gate report byl přepočítán jako pravdivý `FAIL / 260 PASS / 3 FAIL /
  2 BLOCKED`, se všemi 27 M2 programy PASS.

## B1 HIGH — type swap mohl skončit false success

Po forward write readbacku už runtime před parent terminalem nekontroloval exact
after-images. Focused test proto mohl nahradit cílovou cestu symlinkem; Git
observer viděl očekávanou target dirty cestu, nikoli foreign dirt. Opus přímo
reprodukoval `terminalStatus: succeeded` pro manifestové `src/app.js` i
ne-manifestové `deploy.cfg`, přestože cesta ukazovala na neschválený outside
obsah.

Acceptance: symlink, adresář ani jiný non-regular/type-changed target mezi
readbackem a terminalem nesmí skončit success. Výsledek musí být durable
non-success a foreign inode/content musí zůstat nedotčené, pro manifestovou i
ne-manifestovou cestu, s commitem i bez něj.

## B2 HIGH — rollback/recovery type swap vyhazoval bez terminalu

`rollbackApplied` a `recoverOnly` volaly `readProjectFileBytes` mimo catch.
Adresář vracel `not_regular_file`, symlink `canonical_target_mismatch`; první
run nezapsal result a každý restart vyhodil znovu. Regular foreign byte drift
přitom správně terminalizoval.

Acceptance: první run i každý restart musí pro directory/symlink replacement
vrátit stejný durable non-success bez výjimky. Produkční
`recoverIncompleteSmallProjectChanges()` musí census dokončit.

## Neblokující pozorování

- Předchozí repo-local review dokument měl chybný dlouhý hash commitu
  `61e09d47`; správný je `61e09d47298c3d24b0bb7ba6fef7f2940553ec49`.
- Tři host-toolchain sady jsou poctivě v `soak` a výchozí gate je nepokrývá;
  přímé běhy byly zelené.
- Dřívější 20ms supervisor grace, absent `--new-session` a bwrap diagnostická
  nejednoznačnost zůstávají neblokující.

Odpověď je v
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-RE-REVIEW-RESPONSE.md`.
