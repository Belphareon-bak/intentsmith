# Finding 011 — obecný `user_settings` povrch nemá jedinou writer/read autoritu

**Severity:** P1 · **stav:** OPEN · **owner:** navazující M1 settings-authority
security WP · **termín:** před Gate 1 exitem

## Co je doložené

Portable schema v2 řeší obsah stahovaného artifactu a atomický importní
commit. Neřeší ale celý živý `user_settings` povrch:

1. `GET /api/settings` vrací celý JSON řádek po odebrání pouze tří
   model-automation klíčů. Stejný `webhookSecret`, který dedikovaná security
   route vrací pouze jako `configured/masked` a chrání vlastním auth guardem,
   je proto přes generic GET dostupný jako plaintext povolenému lokálnímu
   klientovi. Stejná route navíc převádí DB/read/JSON parse chybu na
   autoritativní HTTP `200 {}`; reload po `DELIVERY_UNKNOWN` tak může odemknout
   klienta nad falešnými defaulty a pozdější generic save nad ostatními
   nechráněnými secret cestami.
2. Před 025 vracel úspěšný `POST /api/settings/import` celý commitnutý
   destination dokument, protože tehdejší Studio generic save jinak neuměl
   zachovat lokální hodnoty, které portable soubor nenese. Druhý atomický 025
   klientský checkpoint už vrací jen exact public projection a
   všechny tři first-party consumery přecházejí na tuto redigovanou odpověď;
   legacy route retirement a nezávislá review však ještě nejsou hotové.
3. Před F-A dělal generic POST whole-row replacement a notification writer
   samostatný read-modify-write. F-A převedl právě tuto dvojici na společný
   `BEGIN IMMEDIATE` merge seam. Foundation 025 následně převedl canonical-root
   storage, webhook a import/reset writery na jeden versioned repository commit
   point; importní request v druhém klientském checkpointu navíc nese
   explicitní `expectedRevision`. Původní raw webhook RMW je tedy historický
   vstupní nález, ne otevřená cesta v současném 025 subjectu. Legacy generic
   GET/POST zůstávají do posledního source commitu kompatibilitní výjimkou.
4. `/architect` legacy offline fallback uměl držet celý dokument v
   `localStorage`. Druhý 025 cutover checkpoint už tento blob nečte, nepřepisuje ani
   nemaže a na generic server posílá jen 17 vlastněných preference cest.
   Ověřený transfer/export/purge existujícího legacy blobu ale patří až 026;
   local-only secret storage proto zůstává otevřený residual.
5. Historické `/api/reset` aliasy resetují settings+policy, nikoli agenty,
   konverzace a paměť. Opravný WP proto v `/architect` deaktivoval nepravdivě
   popsanou „úplnou“ delete akci; skutečný factory-delete kontrakt neexistuje.

Loopback/origin boundary snižuje dosah, ale není náhradou route-level secret
authority: `NATIVE_LOOPBACK_CLIENT` bez Origin je podporovaný klientský typ.

## Proč se generic GET neopravuje izolovanou redakcí

Redakce readu bez dokončení writer authority by byla datově nebezpečná. F-A
chrání jen přesných devět notification klíčů; generic POST stále může zapsat či
smazat jiné secret-bearing cesty podle přijatého top-level payloadu. Stejně tak
oprava jednoho RMW writeru nezavírá závod s ostatními.

Bezpečný cutover musí spojit:

- typed/redacted read projection pro UI;
- server-side path-owned merge, který protected hodnoty bez explicitní typed
  route neumí nastavit ani smazat;
- revision/CAS nebo ekvivalentní stale-snapshot ochranu generic write;
- společný `BEGIN IMMEDIATE` mutation seam pro storage, webhook a notification
  writery;
- dedikované secret storage/routes a redigované import/reset responses;
- dvouconnection WAL testy import versus každý živý writer;
- oddělený, pravdivě pojmenovaný factory-delete kontrakt.

## Hranice současného repairu

`WP-M1-POLICY-PORTABLE-SECURITY` uzavírá pouze:

- default-deny v2 artifact;
- bezpečně projektovanou v1/raw kompatibilitu;
- zachování destination nonportable hodnot v importním transakčním snapshotu;
- exact commit-response validaci;
- odstranění alternativních raw export/import bypassů ve třech first-party UI
  consumers.

Netvrdí globální lost-update odolnost ani bezpečný obecný settings read.
Gate 1 proto zůstává `BLOCKED`, dokud tento finding nedostane vlastní bounded
WP, implementaci, negativní race důkazy a nezávislé review.

## První repair F-A — promován, Review A+B PASS

Operátor 2026-08-10 schválil úzkou opravu potvrzené ztráty dat: generic
`POST /api/settings` whole-row replacementem uměl odstranit devět
`c3.notif.*` hodnot zapsaných notification routou. Promovaný
[`WP-M1-SETTINGS-NOTIFICATION-CLOBBER`](../wp/WP-M1-SETTINGS-NOTIFICATION-CLOBBER.md)
na base `fc86b718` má source implementaci, která centralizuje přesnou mapu
devíti klíčů, generic payload filtruje jen podle exact key a obě mutation cesty
vede přes `updateUserSettings()` s `BEGIN IMMEDIATE`. Generic runtime dostane
jen filtrovaný incoming patch, nikdy commitnutý dokument s notification
tajemstvím. Post-commit runtime chyba je pravdivý degraded `200`; malformed
input a pre-commit storage chyba mají stabilní `400`/`503` bez raw hodnot.
Focused route-level sada má 4/4 včetně skutečných dvou WAL writerů. Immutable
subject `ebe7ee20`, merge candidate `1a75188f` a oddělené Review A/B evidence
prošly; promotion evidence tip `8c7ff414` je zapsaný v
[`wp-m1-settings-notification-clobber-20260810-report.md`](../execution/runs/wp-m1-settings-notification-clobber-20260810-report.md).
F-A neřeší generic read, ostatní writery, CAS, secrets ani reset, takže Finding
011 zůstává `OPEN` a Gate 1 `BLOCKED`.

## Rozhodovací fronta S1–S5

Operátor 2026-08-11 přijal všech pět přesných variant A i jejich pořadí. Změny
zůstávají oddělené a každá vyžaduje vlastní subject, Review A i Review B:

| Pořadí | Rozhodnutí | Přijatá varianta | Co odemyká |
|---:|---|---|---|
| 1 | [025 — versioned settings a CAS](../decisions/025-m1-settings-versioned-authority.md) | A | revision, jeden repository commit point, redigovaný connector |
| 2 | [027 — podporované notification credentials](../decisions/027-m1-notification-credential-scope.md) | A | pravdivý core 1.0 support surface |
| 3 | [028 — webhook secret semantics](../decisions/028-m1-webhook-secret-semantics.md) | A | jedna env runtime/status autorita, retirement falešného setteru |
| 4 | [026 — secret storage authority](../decisions/026-m1-secret-storage-authority.md) | A | ověřený env transfer a odstranění credentials z aplikačních dat |
| 5 | [029 — settings reset scope](../decisions/029-m1-settings-reset-scope.md) | A | settings-only reset a ukončení legacy aliasu |

025 je `IN_PROGRESS / IMMUTABLE_SOURCE_READY / X1_AND_LATE_061_ACCEPTED / REVIEW_PENDING`;
026–029 zůstávají `ACCEPTED / IMPLEMENTATION_PENDING`. Závazná sekvence je
`025 → 027 → 028 → 026 → 029`; ostatní kroky začnou až po přijetí předchozího
candidate. Finding 011 zůstává `OPEN` a Gate 1 `BLOCKED`, dokud neprojdou
implementace a nezávislá review.

025 má nyní aktivovaný ohraničený
[`WP-M1-SETTINGS-VERSIONED-AUTHORITY`](../wp/WP-M1-SETTINGS-VERSIONED-AUTHORITY.md)
se source evidence `68cd6a0d`. Exact base je aktivační commit obsahující tento
WP, `55d32e14876964863b573bfd4b18086aaa46768d`. První source checkpoint
`f583ac941d5c7e17b7e70ada89ee421779bb9429` implementuje migraci 064,
repository commit point, v2 GET/PUT a převod backendových writerů. Druhý source
checkpoint `75a6497606f7055c06741d3992ed6bd6004b677a` atomicky převádí všechny
tři first-party consumery, import CAS a redigovanou import/reset odpověď.
Finální source diff už mění legacy `GET/POST /api/settings` na inertní `410`,
odstraňuje broad writer exporty a doplňuje jejich replacement evidence.
Operátor úzkou late-061 hranici níže výslovně přijal 2026-08-11; tento poslední
source commit je proto immutable `S / REVIEW_PENDING` a jeho full SHA připne
až report-only Review A evidence. Žádný dílčí checkpoint se samostatně
neintegruje.

Import/reset v commitnutém foundation checkpointu historicky vracel legacy
`generalSettings`, včetně preserved nonportable secrets. Checkpoint `75a64976`
už tento leak odstraňuje společně s cutoverem všech tří first-party consumerů;
bez finálního `410` commitu a nezávislých Review A/B ale celý 025 subject stále
není přijatý backend cutover.

Call-graph census navíc našel samostatně spustitelný tracked `chats/` package,
jehož vlastní server stále obsahuje raw `INSERT OR REPLACE` a `DELETE`
settings cestu. Canonical root `src/server.js` tento package nespouští a 025
jej nemá v allowlistu, proto se potají neopravuje; zůstává
`PENDING-OWNER` a blokuje případné produktově globální tvrzení o nulových raw
writerech, nikoli tento canonical-root foundation checkpoint.

### 025 průběžný checkpoint — zvolené vratné connector hranice

Read-only call-graph census sjednotil živé Studio a Architect settings povrchy
do 46 kanonických persisted `GENERIC` preferences. Sedm `c3.features.*` cest
z generic authority vypadlo: jejich jedinou autoritou zůstávají typed
runtime-only `/api/features` routes a `config.features` při startu. Persistovat
je zároveň do `user_settings` by bez startup hydration a retirementu dnešních
feature writerů vytvořilo druhou pravdu. Případná durable feature autorita je
proto samostatné budoucí rozhodnutí. Osm Architect aliasů má jednoznačné
mapování:

- `/user/name` → `c3.account.displayName`;
- `/location/timezone` → `c3.account.timezone`;
- `/location/currency` → `c3.account.currency`;
- `/location/language` → `c3.language`;
- `/system/modelChat` → `c3.llm.chatModel`;
- `/system/modelCode` → `c3.llm.codeModel`;
- `/system/ollamaUrl` → `c3.llm.ollamaUrl`;
- `/system/maxTokens` → `c3.llm.contextWindow`.

Private/effect cesty
`/user/{avatar,connectedAccounts,localAccount,sessionScope}`,
`/location/{city,country,units}`,
`/memory/{skills,customPrompt,saveHistory,saveContext,saveAttachments}` a
`/system/{runtime,lockConfig}` zůstávají `UNOWNED` a čekají na dedicated typed
owners: repository je zachová, public v2 je nevydá a generic patch je nesmí
vytvořit, změnit ani smazat. Architect cutover proto používá jen osm aliasů a
devět přímo vlastněných `appearance`/`output` cest; nikdy neodesílá celý
private/effect `settingsState`.

Druhá hranice je import CAS. Portable artifact schema zůstává byteově zmrazené;
revision proto nese pouze connector wrapper
`{backup:<artifact>,expectedRevision:N}`. Repository ji porovná pod
caller-owned `BEGIN IMMEDIATE` před první mutací. Stale stav vrací typované
`409 USER_SETTINGS_REVISION_CONFLICT`; žádný klient jej automaticky
nepřehrává.

Zvolený implementační blok pro nezávislé review:

```text
025-owner-map: CANONICAL-46-PREFERENCES
025-feature-authority: TYPED-RUNTIME-ONLY-NOT-GENERIC
025-architect-aliases: MAP-8-TO-CANONICAL
025-private-effect-fields: DEDICATED-TYPED-OWNERS-PENDING
025-import-cas: EXPLICIT-EXPECTED-REVISION-OUTSIDE-PORTABLE-ARTIFACT
025-import-conflict: 409-NO-AUTOMATIC-REPLAY
025-late-061-legacy-sanitization: CONDITIONAL-061-FIRST-ONLY-WHEN-LEGACY-MODEL-KEYS-EXIST
025-late-061-status: ACCEPTED-2026-08-11
025-X1: ACCEPTED-HISTORICAL-READER-ONLY
025-X1a: RETAIN-ALL-6-READER-TESTS
025-X1b: SQLITE-WRITE-FAILURE-IN-EXISTING-4-CASE-AUTHORITY
```

Tento blok konkretizuje přijaté 025/A nejmenším vratným způsobem a podléhá
Review A/B celého subjectu. Operátor přijal X1 dne 2026-08-11 s podmínkou
zachovat všech šest reader testů a přesunout jednu skutečnou commit-failure
garanci do existující čtyřpřípadové authority sady. Poslední legacy `410` je
proto připraven až po atomickém cutoveru Studio, Architect a Center Views.
Finding 011 i Gate 1 zůstávají `OPEN`/`BLOCKED`.

Repository foundation nevystavuje whole-document import writer: IMPORT přijímá
jen přesně validovanou portable projection a jedenáct cest mergeuje uvnitř
vlastněné transakce. Migrace 064 před mutací odmítá každý neznámý nebo neúplný
`user_settings` trigger set, po každém zápisu se committed row terminálně znovu
čte a jakákoli triggerem způsobená divergence rollbackuje.

Statický WP požaduje úplnou nezávislost 064 na 055–063. Pro jediný legacy stav,
ve kterém 061 ještě musí přes `JSON.parse`/`JSON.stringify` odstranit retired
`models.auto*`, by to vyžadovalo no-revision výjimku nebo trvalou kopii celého
settings blobu v trigger SQL. Foundation obě varianty fail-close odmítá: 064
před `ALTER TABLE` vyžádá nejdřív 061 pouze tehdy, když tyto klíče skutečně
existují. Bez nich je 064 → 061 bezpečný no-op a původní bytes i revision se
zachovají. Canonical base už 061 obsahuje; mobile 055–060 ani budoucí 063 tím
nejsou dotčeny. Operátor tuto úzkou korekci příliš široké věty WP přijal
2026-08-11. U poškozeného JSONu vrací `requiresLegacy061Sanitation()` `false`,
takže pořadová záruka platí pro well-formed dokumenty; poškozený blob se
zachová byteově beze změny a všechny produkční read/commit cesty nad ním
fail-close odmítnou autoritativní stav.

Aktuální final-source evidence: sdílená authority sada zůstává přesně na
čtyřech top-level scénářích a prokazuje migraci, redakci v2, CAS success,
`UNOWNED` fail-close, stale `409`, sedmiřádkovou WAL matici, atomický
import/reset a zachování protected destination hodnot. X1b navíc skutečným
SQLite `BEFORE UPDATE` abortem dokládá `503 USER_SETTINGS_DB_WRITE_FAILED` a
byteově shodný durable blob, revision i celý row snapshot (`4/4`). Původní F-A
terminal-reread garance zůstává ve stejném scénáři: následná
`AFTER UPDATE` divergence skončí `USER_SETTINGS_STORAGE_CONTRACT` a rollbackne
celý row snapshot. Historický
model-settings program nyní drží všech šest samostatných reader/fail-closed
testů (`6/6`) a neimportuje retired writery. Model-policy kompatibilita je
`36/36`, schema migration oracle `38/38` a registry zůstává 381 programů s
fingerprintem
`665461cccea8f691e6d609c381b21c7bd8b7b2b1ff9932fd4aad42b9552216e0`.
První final-source candidate `cf050caaf67331c59b7bcb519b6867f18a0ea244`
skončil v Review A jako `CHANGES_REQUIRED`: produkční 46cestný allowlist byl
správný, ale T2 pinoval jen jeho počet a zákaz feature prefixu, takže stejně
dlouhá záměna jedné cesty mohla zůstat false-green. Historie ani původní ref se
nepřepisují. Náhradní sibling subject nad stejným parentem doplňuje v témže T2
nezávislou exact 46-entry fixture, kontrolu unikátnosti a ponechává čtyři
top-level scénáře. Jeho full SHA smí poprvé připnout až report-only `E_A` po
opakovaném Review A; do té doby zůstává 025 `IN_PROGRESS / REVIEW_PENDING`.

Druhý atomický klientský checkpoint převádí chat-panel Studio,
Architect i Center Views, importní route a CDP/E2E source seams společně.
Focused důkazy jsou Studio VM `127/127`, model-policy `36/36`, authority `4/4`,
CDP evidence `59/59` a bezpečný Electron runner contract `16/16`; registry
zůstává 381 programů s fingerprintem
`665461cccea8f691e6d609c381b21c7bd8b7b2b1ff9932fd4aad42b9552216e0`.
Nezávislý průběžný call-graph review nenašel P0/P1 blocker, ale nejde o Review
A. Skutečný Electron ani runtime E2E běh nebyl spuštěn a není součástí tohoto
checkpointu.

Ohraničené navazující položky: Architect a Center Views zatím nemají bounded
fetch timeout; raw compatibility objekt s vlastním `kind`/`schemaVersion` je
záměrně rezervovaný marker; recursive JSON validace potřebuje samostatný
depth/node/byte budget. Jde o availability/robustness práci stejného budoucího
settings-authority WP, nikoli důkaz bezpečnosti generic povrchu.
