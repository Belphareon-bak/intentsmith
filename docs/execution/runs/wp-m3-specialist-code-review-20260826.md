# WP-M3-SPECIALIST — governed code-review journey

- **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`
- **Product revisions:** `f35391a320cd98e077a0cb7e587a78297dc3ea1e`,
  `5135a09a8ecfeebbc359d4aeb9707084a2c38556`, `52cc0d76`, `b278a0ab`
- **Větev:** `codex/m3-integration-20260825`
- **Push:** neproveden
- **Review:** záměrně odloženo do společného operátorského review M3

Tento řez uzavírá první povinnou M3 cestu jednoho code-review specialisty od
výběru ve Studiu/chatu přes projektově vázaný Code Intelligence dotaz a
strukturovaný tool result až po deterministicky viditelnou odpověď. Neoznačuje
M3 za přijaté a nenahrazuje operátorské review.

## Autorita a produkční cesta

- loader vlastní injekci capabilities a extension balíček ji nemůže přepsat;
- core vytvoří jednorázový opaque invocation token vázaný na specialistu,
  nástroj, projekt, konverzaci, persisted user message a abort signal;
- `code-intel.project-context.v1` provede pouze M2 `ProjectContext` query s
  explicitními limity 16 souborů, 64 KiB a 16 000 tokenů;
- code-review tool analyzuje jen vrácené položky, zachová path/line/provenance a
  nálezy řadí deterministicky podle severity, cesty a řádku;
- handler nevstupuje do modelové cesty. Uživatel obdrží strukturované nálezy,
  zdrojovou evidenci, přiznání omezení a evidence expertizy;
- chybějící projekt, stale/disabled specialista, nesouhlas persisted identity,
  překročení rozpočtu, opakované použití tokenu nebo chyba toolu selžou closed;
- aktivní specialistický výběr má přednost před sticky project chat routou;
  legacy `/chat` vrací stejná metadata a session state jako websocket cesta.

Čerstvý server E2E současně odhalil, že create-project handler zapisoval
`projects.status = 'SPEC'`, ačkoli toto pole je archive authority. Oprava nechává
stav projektu aktivní a lifecycle fázi nadále vlastní `project_lifecycles.phase`.
Runner dostal dvě lifecycle opravy: ruší svůj timeout po startu serveru a při
cleanup čeká na skutečný exit child procesu místo kontroly `child.killed`.

## Ověření

| Důkaz | Výsledek |
|---|---|
| `tests/m3-code-review-specialist.test.js` | 4/4 PASS |
| `tests/e2e/84-m3-code-review-specialist.e2e.js` | 5/5 PASS |
| `tests/e2e/04-projects.e2e.js` | 13/13 PASS |
| `tests/specialist-runtime.test.js` | 23/23 PASS |
| `tests/specialist-loader.test.js` | 294/294 PASS |
| `tests/specialist-handler.test.js` | 20/20 PASS |
| `tests/session-context.test.js` | 66/66 PASS |
| `tests/m2-project-context-retrieval.test.js` | 9/9 PASS |
| `tests/m3-extension-contract-v1.test.js` | 14/14 PASS |
| `tests/specialist-boundary-ratchet.test.js` | 12/12 PASS |
| `tests/routing-accuracy.test.js` | recall 8/8, precision 6/6, tool accuracy 8/8; exit 0 |
| `tests/harness-exit-code.test.js` | PASS; 114 DB-reachable root tests protected, mutation rejected |
| `tests/module-boundary-ratchet.test.js` | 13/13 PASS |
| registry validace | 437 programů, `72bc64e6a6d8710ffd718ccb419b5106aa2637ae108eb92a8cef7442fa18bc97` |
| module graph | 1 148 hran, 3 cykly / 28 souborů v cyklech |
| `git diff --check` | PASS |

Aktuální společný non-gate server run `2026-08-25T23-08-49-411Z` zahrnul tuto
sadu a skončil 5/5 suites, 32/32 steps PASS na source `ad23c278...`. Report
pravdivě nese `gateEvidence: false`; není vydáván za Gate 0.

Dvě nové modulové hrany byly přijaty jednotlivě proti přesným párům:

- `src/extensions/specialist-project-context.js -> src/code-intel/project-context-provider.js`
- `src/specialists/specialist-loader.js -> src/extensions/specialist-project-context.js`

Baseline připíná výhradně product revision `f35391a3`; follow-up nemění importní
graf. Počet cyklů ani cyclic membership nevzrostly.

## Opravený false-green

Aktivní required suite `routing-accuracy.test.js` dříve při 87,5% recall pouze
vypsala FAIL a skončila exitem 0. Follow-up `5135a09a` doplnil přesný pattern pro
minimální OSVČ zálohu a navázal exit code na všechny tři prahy. Výsledek je nyní
100%/100%/100%; harness census byl po přidání dvou M3 production-path suites
explicitně znovu přezkoumán a připnut na 114.

## Přiznané hranice

- E2E je lokální a deterministický, bez sítě, modelu, GPU a Ollamy; v tomto WP
  nebyl žádný z těchto prostředků použit.
- Analyzer pracuje pouze nad bounded snippet snapshotem a není náhradou plného
  compiler/AST review; tuto hranici říká i uživatelský výstup.
- Disable, remove, stale identita i explicitní reinstall jsou fail-closed
  pokryté. Durable tombstone brání samovolnému resurrection při discovery;
  reinstall zůstane disabled do samostatného enable a busy operace se odmítne.
- Rekurzivní scanner nyní odmítá i effectful builtin, third-party bare a známé
  ambientní API. Je to statická supported-package hranice, ne hostile-code
  runtime sandbox.
- Sjednocený closeout je hotový, ale operátorské review stále čeká. Stav proto
  zůstává `IMPLEMENTATION_GREEN / REVIEW_PENDING`.
