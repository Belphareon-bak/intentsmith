# 006 — automatický model rebind zůstává blokovaný rozhodnutím L0-9

- **typ:** BLOCK
- **stav rozhodnutí:** D+ SCHVÁLENO; B3-IDENTITY, B3-PROFILE, FAILOVER SETTINGS, STORAGE, CLAIM RECOVERY, MANUAL BINDING LINEAGE A DETECTION COORDINATOR IMPLEMENTOVÁNY, AKTIVACE OTEVŘENÁ
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
expired-claim recovery, manual supersede, runtime apply, opt-in consumer,
startup koordinátor nebo scheduler. Pětiminutový claim je prozatím pouze
ohraničený storage lease, nikoli schválený limit modelové validace. Žádný runtime
modul repository nekonzumuje a L0-9 se nemění. Focused důkaz je
`IS-T1-TESTS-M1-MODEL-FAILOVER-REPOSITORY-TEST`.

## Implementační stav B3-FAILOVER claim recovery — 2026-08-08

Migrace 047 doplňuje databázovou autoritu pro `CLAIM_EXPIRED`: event projde
jen nad přesnou rolí, desired revision, episode, row version, operation,
policy, stavem a digestem živého claimu, jehož expiry byla striktně překročena.
Rovnost `now == expiresAt` je stále live. Repository metoda `expireClaim()` v
jednom `BEGIN IMMEDIATE` vloží audit a plným CAS vyčistí operation, tajný token,
kind i oba časy; chyba projection rollbackne i event. Přesný retry vrací
`ALREADY_EXPIRED` bez nového eventu a read API ani chyba tajný token nevydají.

Dva skutečné worker thready načetly stejný pre-expiry snapshot přes dvě WAL
connections. Po bariéře vznikl právě jeden `EXPIRED`, jeden
`ALREADY_EXPIRED`, právě jeden společný expiry event a žádný `SQLITE_BUSY`.
Následný nový claim používá běžný soutěžní CAS. Expire a nový claim jsou
záměrně dvě transakce: po crashi může stav zůstat dočasně bez claimu a při
soutěži může vyhrát jiný worker. Jde o safe release-then-compete, nikoli
same-worker atomic reclaim. RESTORE/REAPPLY expiry dostanou vlastní focused
fixture až s terminal state writerem; dnes přes veřejné repository ještě není
aktivní stav dosažitelný.

Recovery stále neaktivuje model, provider, Ollamu, GPU, config ani scheduler.
Call-graph audit navíc prokázal, že legacy validation rows nejsou digest-bound
PASS autorita a repozitář nemá schválené role-suite prahy ani proof TTL. Tyto
hodnoty nejsou domyšlené: rozhodnutí 015 drží issuance vypnuté a dovoluje
pokračovat pouze measurement-only runnerem. L0-9 se nemění.

## Implementační stav B3-FAILOVER measurement policy — 2026-08-08

Nový `src/upgrade/model-failover-proof-policy.js` fail-closed pinuje raw bytes
a délku `model-profiles.js` a `validation-suites.js`, znovu odvozuje přesnou
mapu 7 rolí na 5 suit a 36 ordered test IDs a používá verzovaný canonical JSON
`sorted-key-json-utf8-v1`. Každá role dostane deterministický
`measurementContractSha256`; tento hash ale není `role_contract_sha256`
způsobilého proofu a nemůže aktivovat failover.

Vratný default 015/C drží `issuanceEnabled=false`, role-specific score/count
prahy i proof TTL `null`. Policy neprovádí DB, model, provider, Ollama, GPU,
config, broadcast ani síťový efekt. Focused offline sada je registrovaná jako
`IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-POLICY-TEST`.

V okamžiku checkpointu 12 ještě chyběl izolovaný fresh-child runner,
parentem odvozená autorita kandidáta i exact prompt/options/result artifact;
checkpointy 13 a 14 tyto measurement-only mezery níže uzavírají. Před issuance
dál chybí operátorsky schválené prahy a TTL, aditivní vazba immutable artefaktu
na proof a terminální recheck aktuální policy/version/hash. Legacy
`ValidationRunner` není proof authority. L0-9 se nemění.

## Implementační stav B3-FAILOVER measurement runner — 2026-08-08

`scripts/run-model-failover-measurement.js` spouští jednu policy-odvozenou
role suite v čerstvém Node procesu. Startup odmítá zděděné Node flagy a neznámé
environment klíče, provider je omezený na exaktní vlastní IPv4 loopback origin
a síťový allowlist obsahuje pouze `GET /api/tags` a `POST /api/chat`. Runner
zachytí úplné requesty i response bytes, skutečný randomizovaný reasoning prompt
a grading context; před i po běhu znovu ověří policy a inventory digest.

Výstupem je kanonický privátní artifact `0400`, publikovaný non-clobber hard
linkem až po read-back validaci. Po odstranění staging jména se finální
namespace durable potvrdí directory fsyncem; consumer dál musí vyžadovat child
exit `0`. Artifact je výslovně `NOT_ISSUED`, neobsahuje proof ID a
nemění DB, binding, config ani broadcast. Parent musí kromě artifactu ověřit
exit `0`, přesně jednu summary, hash, délku a úplnou pětici pinů. Samotný
`sourceRevisionClaim` ani callerem vybraný provider/digest nejsou nezávislou
autoritou; tu musí dodat navazující parent/issuer. Focused offline důkaz je
`IS-T1-TESTS-M1-MODEL-FAILOVER-MEASUREMENT-TEST`.

## Implementační stav B3-FAILOVER parent acceptance — 2026-08-08

`scripts/run-model-failover-candidate-measurement.js` už nepřijímá provider,
digest ani source SHA od calleru. Provider origin čte z `config.ollama.baseUrl`;
exact observed name, canonical name a digest odvozuje ze striktního loopback
inventory. Před i těsně před publikací odmítne staged, tracked, untracked i
ignorované změny pod `src/`, `scripts/`, `tests/` a v `package.json`. Cizí
untracked práce pod `docs/` není součástí kandidátního zdroje a běh neblokuje.

Policy a child se nenačítají ze živého worktree, ale z privátního exportu
přesných mode-100644 blobů kandidátního HEAD. Export má před/po kontrolu
inventáře, hashů, módů, ownership a hardlinků. Parent přijme jen child exit 0,
nulový stderr, jednu přesnou summary, jediný soukromý mode-0400 artifact,
shodný inventory před/po a pětici role/model/digest/provider/revision pinů.
Výsledný read-only receipt má samostatný schema validator, který bez nezávisle
odvozených parent pinů vrací pouze `STRUCTURAL_ONLY`; self-consistent přepis
source, inventory, kandidáta a artifact hashe proto nemůže dostat silnější
verdikt. Parent validuje receipt proti zvlášť sestavené autoritě, před/po child
znovu ověří privátní run i source-export adresář a publikuje non-clobber s
finálním read-backem, `nlink=1` a directory fsync. Receipt stále zůstává
`NOT_ISSUED` a nevytváří proof, DB, binding, config ani broadcast efekt.

Focused offline důkaz je
`IS-T1-TESTS-M1-MODEL-FAILOVER-PARENT-ACCEPTANCE-TEST`. Nejde o GPU kvalifikaci
ani o změnu L0-9. Zděděné Node hooks parent odmítá před svými efekty; tento
kontrakt není OS sandbox a netvrdí, že cizí preload před zahájením Node procesu
nemohl udělat vlastní efekt.

Manual apply/rollback má hotový první ze dvou inertních checkpointů:
append-only storage lineage; atomické repository operace zůstávají otevřené.
Oba drží nebo musí držet `verified=0` bez skutečné verifikace a rollback
zapisovat jako nový stav, nikoli `DELETE`. Ani poté se
nesmí tvrdit runtime integrace: legacy `upgrade-manager.js`, chatová zpráva a
HTTP-only broadcast tvoří otevřený blocker s vlastníkem a termínem v
[`finding 008`](../findings/008-model-binding-commit-point-split.md).

## Implementační stav B3-FAILOVER manual binding lineage — 2026-08-08

Migrace `2026_08_08_048_model_binding_operations` přidává append-only journal
`model_binding_operations`. `USER_APPLY` i `USER_ROLLBACK` nesou request key,
exact předchozí a cílové name/canonical/digest tuple, očekávanou a commitnutou
revision, aktéra, policy a jediný shodný `DESIRED_CHANGED` event. Operace je
trvale `NOT_VERIFIED` a `NOT_APPLIED`; neobsahuje proof a nemůže tvrdit runtime
efekt. Rollback musí být přesným přímým obrácením konkrétního apply a druhý
rollback stejného apply databáze odmítne. Další manual apply musí jmenovat
operaci, která vytvořila aktuální revision.

Manual desired projection bez odpovídající operace se odmítne a migrace
fail-close zastaví databázi, která by již obsahovala manual projection bez
doložitelné lineage. Trigger váže přesný `OLD → NEW` přechod, takže starou
operation nelze přehrát nad novější revision; manual projection nelze přepsat
na legacy source, smazat ani obejít přes SQLite `INSERT OR REPLACE` při
`recursive_triggers=0`. Audit event nesmí nést incident row/episode ani
neprázdné details. Existující incident ve stavu DETECTED, s aktivním claimem i
ACTIVATED manual operation blokuje, dokud navazující repository nepřidá
atomický `SUPERSEDED_BY_USER`. Transaction failure fixture prokazuje nulový
orphan event, operation i projection. Focused sada je registrovaná jako
`IS-T1-TESTS-M1-MODEL-BINDING-STORAGE-TEST`.

Tento checkpoint nemění `model_overrides`, `upgrade_history`, `config.models`,
HTTP, chat ani `model_changed`. Neřeší aktivní incident: atomický
`SUPERSEDED_BY_USER` přechod a repository API jsou další checkpoint. Finding
008 proto zůstává `OPEN / ASSIGNED` až do jediné společné runtime aplikační
služby pro HTTP i chat.

## Implementační stav B3-FAILOVER manual supersede schema — 2026-08-09

Před migrací 049 byl v `684263e3` zaveden a v `af889e3b` samostatně
attestován fail-closed migrační preflight podle
[rozhodnutí 016](016-migration-identity-guard.md). Kompletní discovery a
validace identity proto proběhne před vznikem `schema_migrations` i před
kterýmkoli `up()`; migrace 049 už nepřistává bez tohoto guardu.

Migrace `2026_08_08_049_model_binding_manual_supersede` rozšiřuje pouze DB
autoritu. Manual operation nad incidentem je přípustná jen tehdy, když tatáž
transakce zapíše přesný desired event a operation, posune desired projekci,
přidá odpovídající `SUPERSEDED_BY_USER` event a terminálně aktualizuje přesný
původní `DETECTED` nebo `ACTIVATE`-claimed snapshot. Event i stav mají vlastní
negativní guard; neúplný zápis nedojde přes deferred foreign key do commitu.

Terminální `RESTORED` a `SUPERSEDED_BY_USER` projekce se nedají znovu otevřít
ani změnit. Tento checkpoint dovoluje pozdější auditovaný retirement jen pro
`SUPERSEDED_BY_USER`; kanonický tvar retirementu `RESTORED` není definovaný a
zůstává fail-closed. Přesná actor gramatika odpovídá JS kontraktu
`/^user:[^\s]+$/u` a duplicitní kořenový `DETECTED` event operaci blokuje.

Focused storage důkaz má pozitivní detected/claimed protějšek a negativně
pinuje chybějící operation, stale desired projection, incomplete commit,
změněný incident snapshot, terminální resurrection, duplicitní origin a actor
whitespace. Čtyři izolované mutace těchto guardů skončily pokaždé jedním
očekávaným selháním. Repository writer, runtime config, override, proof a
broadcast se tímto schema checkpointem nemění; finding 008 zůstává otevřený.

## Implementační stav B3-FAILOVER manual binding repository — 2026-08-09

`src/upgrade/model-failover.js` nyní vystavuje dvě inertní manual operace:
`recordUserBindingApply()` a `recordUserBindingRollback()`. Oba vstupy mají
exact allowlist; interní nebo neznámé pole končí
`MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED` ještě před zápisem. Repository
odvozuje operation/event identity, canonical target, previous tuple, revision,
policy, reason, čas i terminal supersede samo.

Jediná top-level `BEGIN IMMEDIATE` transakce zapíše desired event, append-only
operation, desired projection a případný `SUPERSEDED_BY_USER` event + state
CAS. Každý návrat zůstává `NOT_VERIFIED/NOT_APPLIED`; efektivní binding je
`PENDING_MANUAL` bez modelového jména a nové detection končí typovaným
`MODEL_FAILOVER_RUNTIME_BINDING_UNCONFIRMED`. Request-key replay je stabilní i
po restartu a rollback je nový přímý reversal konkrétního apply. Same-key a
different-key závody proběhly nad dvěma skutečnými WAL connections.

Manual operace smí supersedovat pouze přesný `DETECTED` snapshot bez claimu
nebo s úplným live ACTIVATE claimem. Aktivní failover se odmítne; validní
`FAILED` a `RESTORED` incidenty mají vlastní runtime-coordinator error code,
stavovou diagnostiku a explicitní retry prerequisite. Auditovaný
`SUPERSEDED_BY_USER` lze retireovat před pozdější apply i rollback, ale
injektovaná chyba v následujícím zápisu obnoví celý původní authority snapshot.
`RESTORED` se stále neretireuje.

Focused test pokrývá exact input schema, no-op/replay, restart, append-only
rollback, skutečné WAL races, oba claim/apply ordery, detected i claimed
supersede, active/failed/restored blockery, malformed origin, schema bypass,
outer transaction a failure injection po každém durable statement. Tento
checkpoint nevytváří `model_overrides`, `upgrade_history`, proof, runtime
config ani `model_changed` a žádný runtime caller jej zatím nekonzumuje.
Sousední parent-acceptance fixture nyní umí vytvořit distinct kandidátní SHA i
nad čistým stromem, kde jsou oba pinované source bloby už identické; prázdný
fixture commit nemění byte-level source pin ani negativní drift kontroly.
Finding 008 proto zůstává otevřený pro sjednocení legacy HTTP/chat commit
pointu.

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

## Implementační stav B3-FAILOVER detection coordinator — 2026-08-09

Schválená D+ cesta nyní poprvé konzumuje `models.autoFailoverEnabled`, ale
stále neaktivuje fallback. `src/upgrade/model-failover-coordinator.js` sdílí
exact loopback provider s manual binding application a při jednom běhu provede
právě jeden strict `GET /api/tags`. Nastavení čte před provider efektem, po
inventory a bezprostředně před každým zápisem. Poslední autoritativní check je
navíc uvnitř stejné repository `BEGIN IMMEDIATE` transakce jako durable efekt,
takže souběžné vypnutí nemůže zanechat desired ani detection řádek. Missing,
malformed nebo DB-error settings a cokoli jiného než literal boolean `true`
skončí před inventory.

Celý inventory se validuje před prvním durable zápisem: musí být neprázdný,
každý řádek musí nést exact name, shodnou canonical identitu a lowercase
64hex digest a jedna canonical identita smí mít právě jeden artefakt. Runtime
mapa všech sedmi rolí se čte před i po snapshotu; drift znamená
`INCONCLUSIVE`. Prázdná či nedostupná Ollama proto nikdy neznamená, že sedm
modelů bylo odinstalováno.

Koordinátor smí provést pouze dvě durable operace:

1. pokud desired řádek neexistuje a runtime artefakt je přesně přítomný,
   idempotentně založí digest-bound `CONFIG_DEFAULT` baseline nebo
   `LEGACY_OVERRIDE` desired baseline podložený právě jedním operationless
   `LEGACY_UNVERIFIED` compatibility override;
2. pokud tentýž observable desired canonical+revision už existuje a canonical
   artefakt v neprázdném validním inventory chybí, idempotentně zapíše
   `DETECTED`.

Existující desired binding se automaticky nikdy neposouvá. Jiný canonical je
`AUTHORITY_DRIFT`; stejný canonical s jiným digestem je `DIGEST_DRIFT`, ne
`BOUND_MODEL_NOT_INSTALLED`. `USER_APPLY/USER_ROLLBACK`, nevysvětlený override,
chybějící digest-bound baseline a každý existující stav kromě přesného
unclaimed `DETECTED` zůstávají bez zápisu. Repository vstupy
`expectedAbsent:true` a `detectionOnly:true` zajišťují, že souběžný novější
desired nemůže být přepsán a terminální `SUPERSEDED_BY_USER` nemůže být tímto
callerem skrytě retireován.

Původní překryvný `setInterval(checkBindingIntegrity)` se spolknutou chybou je
nahrazen recursive single-flight schedulerem. První běh zůstává až po
dosavadním pětiminutovém delay; checkpoint tedy nepřidává nový startup
provider effect. Focused database sada
`IS-T1-TESTS-M1-MODEL-FAILOVER-COORDINATOR-TEST` pokrývá literal opt-in,
validaci celého snapshotu, config/legacy seed, restartovou idempotenci,
unseeded missing, digest/runtime drift, manual a terminal authority,
desired-revision race, dvě WAL connections, projection rollback a scheduler
single-flight.

Composition root předává dva frozen detection porty: pět repository metod a
jedinou inventory metodu; coordinator neuchovává referenci na plný
repository ani provider. Nemá proof, claim, candidate recommendation,
pull/delete, provider chat, runtime binding ani broadcast autoritu. L0-9 se
nemění; proof issuance a
terminal automatic activation/restore zůstávají blokované na rozhodnutí 015 a
navazující evidence.
