# Nezávislé review — WP-M2-EFFECT, první řez (project-path authority)

- **Předmět:** `codex/m2-effect-20260823`, `44a9ba87..c3b882d0`
- **Reviewer:** nezávislý, mimo implementační stream
- **Datum:** 2026-08-23
- **Worktree:** `/home/belphareon/worktrees/is-m2-effect-20260823`
- **Verdikt:** `CHANGES_REQUESTED` — containment třída je uzavřená a doložená,
  ale řez přináší jednu neměřenou availability regresi (R2) a jednu záruku,
  která v produkčním call graphu není vidět (R1).

## 1. Co jsem přeověřil sám

Všechna tvrzení implementačního streamu jsem spustil znovu, ne převzal.

| Tvrzení | Výsledek |
|---|---|
| `tests/patch-engine.test.js` 66/66 | ✅ 66 passed, 0 failed |
| `tests/lifecycle-build.test.js` 84/84 | ✅ 84 passed, 0 failed |
| `tests/execution-loop.test.js` 58/58 | ✅ 58 passed, 0 failed |
| module boundary 13/13 | ✅ 13 passed — ale soubor je `tests/module-boundary-ratchet.test.js`; `tests/module-boundary.test.js` neexistuje (WP §6 jej pojmenovává nepřesně) |
| registry 397 programů, fingerprint `be1adcf9…` | ✅ `registryHash` v `report.json` souhlasí |
| gate 233 PASS / 3 FAIL / 2 BLOCKED | ✅ `statusCounts` souhlasí; FAIL/BLOCKED ID jsou přesně ta deklarovaná |
| baseline FAIL/BLOCKED = známé suite | ✅ `NIGHTLY-AUDIT-RUNNER-SELF-TEST`, `NIGHTLY-ORCHESTRATOR-SELF-TEST`, `VRAM-COORDINATION`; BLOCKED `CHAT-EXPORT-BUDGET`, `EXPORT-PDF-DOCX` |
| strom čistý, nic nepushnuto | ✅ `git status` prázdný, `git diff --check` čistý, branch bez remote |
| debug runtimy v karanténě | ✅ 4 adresáře v `/tmp/intentsmith-m2-debug-runtimes-20260823` |

Poznámka ke gate: celkový `verdict` reportu je `FAIL`, `exitCode: 1`. WP to
podává správně jako přijatou baseline, ale v handoffu to musí zaznít takto,
ne jako "gate prošel".

Testy nejsou tautologické. Sentinely mimo projekt se ověřují bajtově,
odmítnutý preview se kontroluje na nepřítomnost klíče `preview`, zachování
mode bitů se měří přes `statSync`. Race proby skutečně přehazují rodiče
a jejich provedení se asertuje (`assertEqual(swapped, true)`).

## 2. Vlastní nepřátelské sondy

Nad rámec dodaných testů jsem modul zkoušel přímo. Sondy potvrdily uzavření
deklarované třídy a odkryly tři chování, která dodaná sada nepokrývá.

Uzavřeno podle očekávání: absolutní cesta (POSIX i Win32 zápis), `..`,
NUL byte, prázdný vstup, `.` jako root, symlink ven, adresář jako cíl,
výměna rodiče po `open` i před `rename`, `EIO` zůstává `read_failed`,
po vynuceném selhání `rename` nezůstal žádný `.tmp` zbytek, a patch set
při přehození cíle uprostřed sady neposkvrnil sentinel a první soubor
vrátil zpět.

## 3. Nálezy

### R1 — HIGH — v produkčním call graphu není odmítnutí terminální

`src/executor/execution-loop.js:802-812` volá `previewPatch` na každý patch
a do `validPatches` pustí jen ty validní. `project_path_violation` skončí jako
`logger.warn` a patch se **tiše zahodí**. Pokud je v iteraci alespoň jeden
jiný validní patch, `applyPatchSet` proběhne, iterace se zaloguje jako
`applied` a milestone může skončit PASSED. Nikde se nezaznamená, že došlo
k pokusu o zápis mimo projekt.

Ověřeno navíc grepem: `state` ani `pathAuthority` nemá **žádného konzumenta**
mimo dva produkující moduly. Rozlišené výsledky dnes existují jen pro testy.

To přímo koliduje s WP §1 „Odmítnutí je pojmenovaný neúspěch, ne falešný
úspěch." Uvnitř enginu to platí. Na hranici, kterou uživatel vidí, ne.

Nejde o novou díru — je to tvar `P1-FX-002` — ale znamená to, že hlavní
uživatelský přínos řezu zatím není doručený. Minimum: violation musí být
terminální pro iteraci a musí projít do `iterationLog` a evidence.

### R2 — HIGH — dead-import cleanup mění pět dříve neškodných stavů na BLOCKED

Přímá sonda proti `_testInternals.stripDeadImports`:

| Vstup v `scope_files` | Nový výsledek | Staré chování |
|---|---|---|
| absolutní cesta | `project_path_violation` | `path.join` → neexistuje → `continue` |
| adresář | `project_path_violation` (`not_regular_file`) | `EISDIR` → `continue` |
| visící symlink | `read_failed` (`ELOOP`) | `ELOOP` → `continue` |
| nečitelný soubor (`EACCES`) | `read_failed` | `EACCES` → `continue` |
| 2+ soubory ke stripnutí | `multi_file_atomicity_required` | oba se stripnuly |

Každý z těchto výsledků jde do `handleMilestoneFailure` → retry → **BLOCKED**.

Dvě věci to dělají závažným:

1. `scope_files` píše model. `lifecycle-prompts.js:291` je popisuje jako
   „all files this milestone is allowed to touch". Absolutní cesta nebo
   adresář v tomto seznamu je běžný modelový výstup. Dřív to byl no-op,
   teď to zablokuje milestone.
2. Tahle větev se volá jen z `out_of_scope_only`, což je samo o sobě
   **recovery** větev z v135.1. Řez tedy proměnil best-effort zotavení
   v tvrdý blocker.

U `multi_file_atomicity_required` navíc platí, že částečný strip není únik
z projektu, jen neatomická změna. Fail-closed je u write authority obhajitelné,
tady ale nekupuje nic v třídě containmentu a stojí to recovery cestu.

Žádný test tuto regresi nepokrývá, takže ji gate ani zachytit nemohl.
Tvrzení „žádná nová produktová regrese" platí pro měřenou plochu, ne pro tuhle.

### R3 — MEDIUM — canonical cíl se nikdy nesrovná s deklarovaným jménem

Ověřeno: `allowed.js` jako symlink na `secret.js` uvnitř projektu.
`applyPatch(patch('allowed.js'), root)` vrátí `success: true, state: 'written'`
a změní se **`secret.js`**. Symlink zůstane symlinkem.

Všechno po proudu klíčuje na `patch.file`: `_validatePatchScope` (scope limiter
v119), `saveBackup`, `iterMem.filesModified`, `lastIterationFiles`,
architecture a API contract kontroly. Scope invariant se tedy obejde
a changelog pojmenuje jiný soubor, než jaký se změnil.

Nový modul tuhle divergenci `patch.file` vs `read.target.real` sám zavádí
a nikde ji nehlásí. Levná oprava: odmítnout nebo aspoň vykázat případ, kdy
`read.target.relativePath` neodpovídá normalizovanému `patch.file`.

### R4 — MEDIUM — hardlink obchází realpath containment na čtecí straně

Ověřeno: `link(<mimo projekt>/outside-secret.js, <projekt>/hard.js)`.
`readProjectFile` vrátí obsah souboru mimo projekt, který pak teče do
validace, preview a do modelového kontextu. Zápis neuteče — `rename` nahradí
položku v adresáři, inode mimo projekt zůstal ověřeně nezměněný.

Hlavička modulu deklaruje jako zbytkovou mezeru pouze nepřátelský ABA závod.
Hardlink read exposure je druhá zbytková mezera a musí být napsaná stejně
poctivě. Uzavře ji buď kontrola `st_nlink > 1`, nebo cílový
`openat2`/`RESOLVE_*` broker.

### R5 — LOW/MEDIUM — kbelíky důvodů míchají typ souboru s porušením hranice

`not_regular_file` (adresář) se hlásí jako `project_path_violation`, tedy
stavem pro pokus o únik. Visící symlink spadne přes `ELOOP` do `read_failed`.

WP §5.6 správně trvá na tom, že běžné `EIO` se nesmí maskovat jako security
incident. Platí to i obráceně: stav typu souboru se nesmí maskovat **jako**
security incident. Doporučuji samostatné `not_a_file` a `symlink_unresolvable`.

### R6 — LOW — `applyPatchSet` nepropaguje `state` z apply fáze

Ověřeno sondou: selhání v preflight/read fázi nastaví `state` na úrovni sady,
ale porušení vzniklé uvnitř per-patch smyčky nechá `state` na sadě
`undefined` (per-file `results[i].state` nastavený je). Nekonzistentní
s deklarovanou taxonomií výsledků.

### R7 — INFO — boundary commit nese i dvě nesouvisející změny

`b523a47f` „accept M2 path authority edges" zároveň odebral
`response-finalizer.js -> quality/improvement-loops.js` a
`-> llm/cre-bridge.js`. Ověřeno, že tyto importy skutečně neexistují, jde
tedy o legitimní integrator-owned tightening ze zastaralé baseline.
Ale s M2 to nesouvisí a commit message to nezmiňuje.

## 4. Co review potvrzuje jako dobré

- Lexikální i symlink únikovou třídu z `P1-FX-001` a `P1-FX-003` modul
  skutečně uzavírá a doklad je reprodukovatelný.
- Descriptor-pinned read s dev/ino kontrolou po čtení je správně postavený:
  bajty se vrátí až po důkazu, že jméno i inode pořád ukazují na totéž.
- Zachování mode bitů přes `fchmod` na už otevřeném temp souboru je správné
  řešení umask problému, ne obcházení.
- Úklid temp souborů po selhání je úplný, ověřeno vynuceným selháním `rename`.
- Preflight rollbacku před spotřebováním backupu je správné pořadí.
- Přiznání ABA závodu v hlavičce modulu i ve stop condition WP je poctivé
  a nemělo by se pod tlakem změkčovat.

## 5. Podmínky pro `REVIEW_PASSED` tohoto řezu

1. **R2** — vrátit dead-import cleanupu degradaci místo blokace pro
   ne-containment stavy (chybějící, adresář, nečitelný, nerozřešitelný
   symlink), nebo doložit rozhodnutí, že blokace je záměr, a přidat testy,
   které ten záměr uzamknou. Absolutní cesta ze `scope_files` potřebuje
   explicitní rozhodnutí, protože pochází od modelu.
2. **R1** — `project_path_violation` musí být terminální pro iteraci
   execution loopu a musí se dostat do evidence, ne jen do warn logu.
3. **R3** — vykázat nebo odmítnout rozpor mezi deklarovaným jménem
   a canonical cílem.
4. **R4** — dopsat hardlink read exposure mezi přiznaná omezení modulu.
5. R5 a R6 jsou vhodné k dořešení, nejsou blokující.

Do splnění 1–4 zůstává stav řezu `FIRST_SLICE_VERIFIED / REVIEW_CHANGES_REQUESTED`.
Nic v tomto review nemění fakt, že `WP-M2-EFFECT` jako celek zůstává otevřený:
`EffectRequest/Result` a `ApprovalGrant` jsou dál `NOT_PINNED` a approval
authority, durable rollback, cancellation/restart, process/network/Git mediace,
audit i skutečný uživatelský journey nejsou tímto řezem dotčené.
