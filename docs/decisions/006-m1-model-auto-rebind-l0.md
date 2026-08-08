# 006 — automatický model rebind zůstává blokovaný rozhodnutím L0-9

- **typ:** BLOCK
- **stav rozhodnutí:** D+ SCHVÁLENO; B3-IDENTITY, B3-PROFILE, FAILOVER SETTINGS AUTHORITY A STORAGE SCHEMA IMPLEMENTOVÁNY, AKTIVACE OTEVŘENÁ
- **WP:** WP-M1-MODEL
- **rail:** R1 USER_AUTHORITY, R3 OBSERVABLE_BEHAVIOR, R6 REVERSIBILITY
- **vzniklo při:** read-only call-graph kontrole `src/upgrade/model-registry.js:checkBindingIntegrity()`

## Evidence na stole

Model registry umí při periodické kontrole nahradit chybějící role binding a
zapsat jej do persistentních overrides. To je přesně oblast L0-9: změna modelu
bez potvrzení uživatele není povolena. WP-M1-MODEL smí ověřit a zpřesnit request
hranici, ale nesmí změnit L0 invariant ani online upgrade automatiku.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — fail closed a vyžádat approval | Kontrola pouze navrhne rebind; persistentní změna čeká na vlastníka | Odpovídá L0-9, ale potřebuje approval connector, který M1 nevlastní | `src/upgrade/model-registry.js`, approval hranice a nové negativní/restart testy |
| B — zachovat automatický rebind | Periodická kontrola smí změnit binding bez operátora | Porušuje aktuální L0-9 | Žádná implementační cena, ale vyžaduje výslovnou změnu `CONTRACT.md` operátorem |
| C — periodickou kontrolu vypnout | Žádná automatická oprava ani návrh | Bez neautorizované změny, ale ztráta self-healing chování | `src/upgrade/model-registry.js`, startup/periodic testy a provozní dokumentace |

## Vzatý default a proč

Žádný. Dotčená část je **BLOCK**. Současný gateway checkpoint se automatického
rebindu nedotýká a pokračuje nezávisle.

## Šev

Po operátorském rozhodnutí je technický šev
`src/upgrade/model-registry.js:checkBindingIntegrity()`. Rozhodnutí samotné ale
mění L0, proto nesmí být přijato autonomně.

## Cena přepnutí, když operátor rozhodne jinak

Varianta A vyžaduje nejméně model registry, nový approval adaptér a tři negativní
scénáře (bez approval, expirovaný approval, restart). Varianta C mění model
registry a jeho startup/periodic acceptance testy. Varianta B nemá legitimní
implementační cestu bez operátorské změny kontraktu.

## Rozhodnutí operátora — 2026-08-08: D+

Operátor schválil cílový směr **auditovaný dočasný local failover**, nikoli
nevyžádaný upgrade. `desired binding` zůstává uživatelskou konfigurací;
`active failover` je samostatný dočasný stav. L0-9 se nezmění, dokud není celý
níže uvedený kontrakt implementovaný a negativně prokázaný.

### Proč se současná cesta nesmí pouze zapnout

- `checkBindingIntegrity()`, `isBound()`, `getBoundRoles()`, overview,
  `deleteModel()` i `runAutoCleanup()` používají exact-name porovnání. Bare
  jméno `deepseek-r1-32b` se proto neshoduje s Ollama identitou
  `deepseek-r1-32b:latest`. Pre-check a následný `deleteModel()` guard jsou dvě
  vrstvy se stejnou exact-name slepotou. Přímé `runAutoCleanup()` nebo budoucí
  oprava jeho settings authority tak mohou skutečně smazat přiřazený model.
  Dnešní periodický enable path je latentní z jiného důvodu: čte neexistující
  `user_settings.key/value` a chybu polkne.
- Stejná chyba vstupuje do recommendation a validačních lookupů. Po vzniku
  validačních skóre může být role falešně vyhodnocena jako rozvázaná a dostat
  jiný model.
- `assignModel()` předává `skipVerify: true`, ale `applyUpgrade()` tento option
  pro aktivaci nepoužívá. Nastaví `verified = true` v návratové hodnotě a logu
  bez ověření; `_persistOverride()` sloupec neuvede, takže DB použije
  `model_overrides.verified DEFAULT 1`. Auto-rebind caller následnou
  `_backgroundVerify()` nespouští. `upgrade_history` sloupec `verified` vůbec
  nemá, takže trvalá historie výsledek ověření neumí vyjádřit. Stav je tedy
  současně nepravdivý v override a neúplný v historii.
- Existující `model_overrides.previous_model` a rollback jsou užitečné, ale
  neoddělují požadovaný binding od dočasného failoveru a neumějí bezpečný
  automatický návrat po změně uživatelem.

### Schválený kontrakt D+

1. Nový jediný modul `src/upgrade/model-identity.js` vlastní kanonickou
   modelovou identitu pro integrity check,
   recommendation, validační a usage lookupy, `_validatingModel`, `isBound`,
   `getBoundRoles`, overview, `getUnusedOldModels()`, registry delete,
   `runAutoCleanup` i přímý fallback guard v `src/routes/system.js`. Pro
   presence porovnání platí
   `name == name:latest`; audit a ověření současně zachovávají přesný digest,
   protože obsah `:latest` se může změnit.
2. B3-IDENTITY nahradí i privátní `_normalizeModelName()` v
   `src/upgrade/upgrade-manager.js`. Současně musí `checkBindingIntegrity()`
   přejít na přesný `DETECTED/PROPOSED` výsledek bez `assignModel()` nebo jiné
   mutace. To platí před opravou aliasů, aby bezpečnější detekce neaktivovala
   dnešní dormantní auto-rebind.
3. Auto-failover vyžaduje předchozí explicitní opt-in policy
   `models.autoFailoverEnabled` v autoritativním JSON řádku
   `user_settings.id=1`, čteném i zapisovaném jediným helperem
   `src/db/user-settings.js`; default `false`. Missing/malformed data, DB chyba
   i restart fail-close. Broken `key/value` pattern se nesmí kopírovat a
   existující auto-cleanup settings se na tentýž helper převádějí až po přijetí
   B3-IDENTITY, aby oprava scheduleru nemohla předběhnout delete guardy.
4. Fallback musí být již lokálně nainstalovaný, čerstvě ověřený pro tutéž roli
   a vhodný podle role/capability. Cesta nesmí provést pull, delete ani externí
   síť a runtime guard musí fail-close.
5. Desired binding a active failover jsou persistentně oddělené. Záznam nese
   roli, desired i fallback model a digest, binding revision, policy version,
   actor `system:binding-integrity`, důvod, časy a stav minimálně
   `DETECTED | ACTIVATED | FAILED | RESTORED | SUPERSEDED_BY_USER`.
6. Audit nesmí tvrdit `verified: true`, pokud ověření neproběhlo. Selhání
   persistence, auditu nebo verify znamená nulovou změnu aktivního bindingu.
7. Po restartu zůstává desired i active stav pravdivý. Návrat původního modelu
   provede nejvýše jeden restore pouze tehdy, když uživatel mezitím binding
   nezměnil a binding revision i digest stále souhlasí.

### Minimální negativní důkaz před změnou L0-9

- rozdíl pouze `:latest` nikdy neaktivuje failover a kanonicky bound nebo právě
  validovaný model nelze smazat registry cestou, přímým route fallbackem ani
  auto-cleanem;
- B3-IDENTITY integrity check pro skutečně missing model vytvoří jen
  `DETECTED/PROPOSED` evidence a přesně nula override/assign/broadcast efektů;
- usage uložené pod configured bare identitou chrání tentýž installed
  `:latest` model před chybnou klasifikací „unused“;
- offline/prázdná Ollama není důkaz odinstalování;
- opt-in off, stale/missing score, špatná role, neinstalovaný kandidát,
  verify/runtime-guard/DB/audit failure znamenají nulovou mutaci;
- souběžné kontroly vytvoří nejvýše jeden efekt; restart zachová stav;
- uživatelská změna během failoveru zakáže pozdní restore;
- změněný digest pod stejným `:latest` vyžaduje nové ověření;
- žádný failover path nevolá pull, delete ani externí síť.

Nejbližší malý milestone B3-IDENTITY smí měnit jen
`src/upgrade/model-identity.js`, identity comparisons v
`model-registry.js`/`upgrade-manager.js`, přímý delete fallback v
`src/routes/system.js` a focused testy. Zároveň vypne dnešní mutaci integrity
checku. Persistentní B3-FAILOVER je samostatný navazující milestone nad
`src/db/user-settings.js`, novým `src/upgrade/model-failover.js`, přesnou DB
migrací pro desired/active/audit stav, `model-registry.js`, identity částmi
`upgrade-manager.js` a scheduler seamem v `src/server.js`. Tento rozhodovací
záznam jej nevydává za implementovaný.

## Implementační stav B3-FAILOVER settings authority — 2026-08-08

`src/db/user-settings.js` nyní vlastní striktní čtení JSON řádku
`user_settings.id=1` a transakční merge vlastněné `models` sekce. Missing row,
neplatný JSON, scalar/array dokument, neobjektová `models` sekce, string
`"true"` i DB chyba vracejí failover jako vypnutý; pouze literal boolean
`true` v platném dokumentu jej může povolit. Zápis zachová neznámé modelové
klíče i ostatní sekce a při validační nebo SQLite chybě původní blob nezmění.

Tento checkpoint cestu **neaktivuje**. Read-only call-graph audit potvrdil dvě
hranice, které se nesmějí obejít:

1. `/api/settings` v `src/routes/misc.js` stále nahrazuje celý JSON dokument a
   další routes mají vlastní merge writery. Přesměrování těchto writerů přes
   helper není v přesném B3 scope; do jeho rozhodnutí nelze tvrdit, že helper
   je jediným writerem celé tabulky.
2. `validation_suite_scores` váže score na jméno a suite, nikoli na digest.
   B3 musí provést čerstvou role-suite validaci mezi dvěma shodnými inventory
   digesty a uložit proof do vlastního auditu; `_verifyModel()` ping ani
   `artifactVerified:false` score samy nestačí.

Focused důkaz je registrovaná database sada
`IS-T1-TESTS-M1-MODEL-SETTINGS-TEST`. L0-9 se nemění a failover runtime zůstává
default-off.

## Implementační stav B3-FAILOVER storage schema — 2026-08-08

Migrace `2026_08_08_046_model_failover` zavádí čtyři oddělené autority:

- `model_desired_bindings` je versioned snapshot uživatelem požadovaného
  bindingu; `binding_revision` se neslučuje s CAS verzí incidentu;
- `model_failover_state` je pouze projekce otevřeného nebo uzavřeného incidentu
  s vlastním `row_version` a ohraničeným claimem;
- `model_failover_proofs` je append-only PASS evidence svázaná s rolí,
  odpovídající role suite, canonical modelem, přesným digestem, policy,
  deklarovanými score/count prahy, časovou platností a stejným before/after
  inventory;
- `model_failover_events` je append-only audit. Úspěšná aktivační, restore nebo
  reapply událost nesmí tvrdit `verified`, pokud neodkazuje na proof.

DB trigger odmítne active failover, pokud proof nesouhlasí v roli, canonical
jménu, digestu, policy nebo době ověření. Stejné kontroly platí před zapsáním
append-only `ACTIVATED`, `REAPPLIED` a `RESTORED` auditu; úspěšný fallback
event navíc musí odpovídat skutečnému desired bindingu. Projection smí
odkazovat jen na event shodný v roli, revision, episode, row version a stavu.
Samostatný `active_event_id` vždy koření aktivní fallback v terminal
`ACTIVATED/REAPPLIED` eventu; `last_event_id` může být novější claim pouze když
state současně nese shodný claim kind, operation a čas. Každý úspěšný terminal
event navíc vyžaduje živý claim stejné role, desired revision, episode,
operation, policy a nepřeskočené CAS verze; claim musí platit i v okamžiku
terminal eventu.
Schema má samostatný `FAILED` stav s pojmenovanou failure phase; absence řádku
znamená, že pro roli není evidovaný incident, nikoli implicitní zelený stav.

Jde záměrně jen o storage checkpoint. Focused důkaz je registrovaná database
sada `IS-T1-TESTS-M1-MODEL-FAILOVER-SCHEMA-TEST`.

## Implementační stav B3-FAILOVER repository/CAS — 2026-08-08

`src/upgrade/model-failover.js` nyní vlastní inertní repository pro tři
operace: observační desired binding, první detection a ohraničený claim typu
`ACTIVATE`, `RESTORE` nebo `REAPPLY`. Každý zápis běží přes
`transaction.immediate()` a auditní event se s projekcí commitne nebo rollbackne
atomicky. Dva skutečné worker thready nad dvěma SQLite connections prokázaly v
obou pořadích právě jednoho claim winnera, jednoho typovaného stale losera a
nulový orphan audit. Claim token je vrácen pouze vítězi a read API jej rediguje.

Clock i event/episode/operation/token identity vlastní repository; pokus calleru
je dodat se odmítne. `USER_APPLY` a `USER_ROLLBACK` zůstávají fail-closed,
protože bez jedné transakce nad `model_overrides`, desired revision a
`SUPERSEDED_BY_USER` by audit lhal o skutečném uživatelském bindingu. SQLite
busy, identity collision, storage-contract violation a corrupt event JSON mají
odlišné typované chyby.

Tento checkpoint stále neobsahuje proof runner ani terminal transition,
expired-claim renew/reclaim, manual supersede, runtime apply, opt-in consumer,
startup koordinátor nebo scheduler. Pětiminutový claim je prozatím pouze
ohraničený storage lease, nikoli schválený limit modelové validace; repository
se proto nesmí zapojit do proof runneru, dokud recovery nevznikne. Žádný runtime
modul repository nekonzumuje a L0-9 se nemění. Focused důkaz je
`IS-T1-TESTS-M1-MODEL-FAILOVER-REPOSITORY-TEST`.

## Implementační stav B3-IDENTITY — 2026-08-08

Sdílený `src/upgrade/model-identity.js` nyní vlastní konzervativní presence
identitu pro schválené binding, registry, validation/usage, recommendation,
upgrade-manager a direct-route cesty. `name` a `name:latest` jsou stejné;
explicitní jiné tagy, dash/colon heuristiky a quantization varianty zůstávají
různé. Exact provider name se nepřepisuje a name-only validační řádek nese
`artifactVerified: false`, protože digest-bound validace patří až do
B3-FAILOVER.

`checkBindingIntegrity()` vrací strukturované `COMPLETE | INCONCLUSIVE` a
`DETECTED | PROPOSED` findings. Nevolá assign, override ani broadcast. Prázdná
nebo nedostupná Ollama je `INCONCLUSIVE`, nikoli důkaz odinstalování.

Focused důkaz je `tests/m1-model-identity.test.js`; jeho mutation probes
samostatně zčervenaly při odstranění canonical comparatoru, obnovení assignu v
integrity a odstranění vnějšího auto-clean binding guardu. Širší tvrzení o
atomickém delete však zůstává otevřené: chatový cleanup má vlastní direct
provider delete a závod mezi seznamem a efektem. Viz
[`finding 006`](../findings/006-model-cleanup-bypasses-registry-guard.md).
Nezávislý review navíc oddělil retention-time chybu mimo identity scope jako
[`finding 007`](../findings/007-model-cleanup-timestamp-ordering.md).
