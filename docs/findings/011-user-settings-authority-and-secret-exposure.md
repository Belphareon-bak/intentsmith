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
2. Úspěšný `POST /api/settings/import` vrací celý commitnutý destination
   dokument, protože dnešní Studio generic save jinak neumí zachovat lokální
   hodnoty, které portable soubor nenese.
3. Před F-A dělal generic POST whole-row replacement a notification writer
   samostatný read-modify-write. F-A převádí právě tuto dvojici na společný
   `BEGIN IMMEDIATE` merge seam. Storage, webhook a import ale stále nemají
   společný revision/CAS kontrakt; jejich starší snapshot může novější stav
   nadále přepsat. Konkrétně `src/routes/security.js` u
   `POST /api/security/webhook-secret` stále provádí raw read-modify-write a
   `INSERT OR REPLACE`; toto lost-update okno je known-open do 025, nikoli nový
   nález budoucího review.
4. `/architect` legacy offline fallback stále umí držet celý dokument v
   `localStorage`. Opravný WP zabránil tomu, aby stale snapshot přebil úspěšný
   server read nebo recovery commit, ale local-only secret storage nemá vlastní
   typed kontrakt.
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

025 je `IN_PROGRESS / FOUNDATION_IMPLEMENTED / REVIEW_PENDING`; 026–029 zůstávají
`ACCEPTED / IMPLEMENTATION_PENDING`. Závazná sekvence je
`025 → 027 → 028 → 026 → 029`; ostatní kroky začnou až po přijetí předchozího
candidate. Finding 011 zůstává `OPEN` a Gate 1 `BLOCKED`, dokud neprojdou
implementace a nezávislá review.

025 má nyní aktivovaný ohraničený
[`WP-M1-SETTINGS-VERSIONED-AUTHORITY`](../wp/WP-M1-SETTINGS-VERSIONED-AUTHORITY.md)
se source evidence `68cd6a0d`. Exact base je aktivační commit obsahující tento
WP, `55d32e14876964863b573bfd4b18086aaa46768d`. První source checkpoint nad
tímto basem implementuje migraci 064, repository commit point, v2 GET/PUT a
převod backendových writerů. Klientský cutover, import CAS a poslední legacy
`410` ještě implementované nejsou.

Import/reset v tomto mezilehlém checkpointu stále vrací legacy
`generalSettings`, včetně preserved nonportable secrets. Jejich redakce musí
přistát atomicky s cutoverem všech tří first-party consumerů v následujícím
source commitu; do té doby je známý leak výslovně otevřený a tento checkpoint
není backend cutover complete.

Call-graph census navíc našel samostatně spustitelný tracked `chats/` package,
jehož vlastní server stále obsahuje raw `INSERT OR REPLACE` a `DELETE`
settings cestu. Canonical root `src/server.js` tento package nespouští a 025
jej nemá v allowlistu, proto se potají neopravuje; zůstává
`PENDING-OWNER` a blokuje případné produktově globální tvrzení o nulových raw
writerech, nikoli tento canonical-root foundation checkpoint.

### 025 průběžný checkpoint — dvě izolované connector otázky

Read-only call-graph census sjednotil živé Studio a Architect settings povrchy
do 53 navržených kanonických `GENERIC` cest: 46 persisted preferences a sedm
feature booleans. Osm Architect aliasů má jednoznačné mapování:

- `/user/name` → `c3.account.displayName`;
- `/location/timezone` → `c3.account.timezone`;
- `/location/currency` → `c3.account.currency`;
- `/location/language` → `c3.language`;
- `/system/modelChat` → `c3.llm.chatModel`;
- `/system/modelCode` → `c3.llm.codeModel`;
- `/system/ollamaUrl` → `c3.llm.ollamaUrl`;
- `/system/maxTokens` → `c3.llm.contextWindow`.

Samostatnou autoritu dosud nemají private/effect cesty
`/user/{avatar,connectedAccounts,localAccount,sessionScope}`,
`/location/{city,country,units}`,
`/memory/{skills,customPrompt,saveHistory,saveContext,saveAttachments}` a
`/system/{runtime,lockConfig}`. Do rozhodnutí zůstávají `UNOWNED`: repository
je zachová, public v2 je nevydá a generic patch je nesmí vytvořit, změnit ani
smazat.

Druhá nejasnost je import CAS. Portable artifact schema je zmrazené a dnešní
import body neobsahuje settings revision, zatímco T3 požaduje stale import
`409`. Foundation proto zatím používá nejnovější snapshot uvnitř vlastněného
`BEGIN IMMEDIATE`; žádný nový header, wrapper ani query parametr si nevymýšlí.

Nepřijatá rozhodovací fronta:

```text
025-owner-map: PROPOSED-CANONICAL-53
025-architect-aliases: PROPOSED-MAP-8-TO-CANONICAL
025-private-effect-fields: PENDING
  A — DEDICATED-TYPED-OWNERS (doporučeno)
  B — EXPLICIT-GENERIC
  C — RETIRE-SERVER-PERSISTENCE
025-import-cas: PENDING
  A — EXPLICIT-EXPECTED-REVISION-OUTSIDE-PORTABLE-ARTIFACT (doporučeno)
  B — LATEST-SNAPSHOT-SERIALIZATION-BEZ-EXTERNÍHO-CAS
025-late-061-legacy-sanitization: PENDING-GOVERNANCE-CORRECTION
  A — CONDITIONAL-061-FIRST-ONLY-WHEN-LEGACY-MODEL-KEYS-EXIST (foundation default)
  B — CHANGE-OLD-061-TO-REVISION-AWARE (odmítnuto: přepis nasazené historie)
```

Tato fronta nemění přijaté 025/A a neblokuje migraci, repository, redigovanou
v2 route ani backend typed writery. Do jejího uzavření se neprovede Architect
cutover, stale-import acceptance ani poslední legacy `410`. Finding 011 i Gate
1 zůstávají `OPEN`/`BLOCKED`.

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
nejsou dotčeny. Před immutable `S` musí governance potvrdit tuto úzkou korekci
příliš široké věty WP; foundation checkpoint na ní nezastavuje další backend
a repository práci.

Foundation evidence na source stromu: sdílená authority sada zůstává přesně na
čtyřech top-level scénářích a prokazuje migraci, redakci v2, CAS success,
`UNOWNED` fail-close, stale `409` a zachování protected destination hodnot
(`4/4`). Model-policy kompatibilita je `36/36`, schema migration oracle
`38/38` a historická pre-064 settings sada `14/14`. Nejde o Review A ani o
immutable subject; 025 je stále `IN_PROGRESS`.

Ohraničené navazující položky: Architect a Center Views zatím nemají bounded
fetch timeout; raw compatibility objekt s vlastním `kind`/`schemaVersion` je
záměrně rezervovaný marker; recursive JSON validace potřebuje samostatný
depth/node/byte budget. Jde o availability/robustness práci stejného budoucího
settings-authority WP, nikoli důkaz bezpečnosti generic povrchu.
