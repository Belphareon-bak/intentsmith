# 026 — credentials nesmějí žít v obecném settings dokumentu

- **typ:** secret storage, transfer a read/write autorita
- **stav:** `ACCEPTED 2026-08-11: A + X1 + M1-CLOSEOUT-X1 / WP_ACTIVE /
  SETUP_P0_CHECKPOINT_PUSHED / REST_IMPLEMENTATION_NOT_STARTED`; aktivní ohraničený
  [`WP-M1-SECRET-STORAGE-AUTHORITY`](../wp/WP-M1-SECRET-STORAGE-AUTHORITY.md)
  vychází ze source evidence
  `0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **závislosti:** 025, 027 a 028 jsou `PROMOTED / REVIEW A+B PASS`; 028 už
  odstranil falešný webhook setter a dodal immutable startup HMAC autoritu,
  takže 026 smí jako čtvrtý krok provést transfer a exact scrub

## Ověřený problém a aktuální baseline

Historické SMTP, Telegram, ntfy a webhook hodnoty i private destinations mohou
stále ležet v plaintextu v `user_settings`,
`<configured-dataDir>/c3-setup.json`, legacy `<configured-dataDir>/.env`,
historickém cwd `.env` nebo rendererovém `localStorage['paiass_settings']`.
Promované 025 je nevydává generic settings readem ani portable backupem,
promované 027 ukončilo nové WS/Setup/UI credential vstupy a promované 028 je pro
HMAC runtime ignoruje. Žádný z těchto kroků je ale nepřenesl, neexportoval,
nescruboval ani nepurgeoval.

Šestá mutation cesta nalezená před 027 už na aktuálním base nežije:
`src/ws-bridge/session-adapter.js` nepřijímá SMTP a `sync_settings` je omezený na
sedm exact boolean feature flags. Tím je pin `026-app-setter: NONE` pravdivý až
po retirementu zbývající notification HTTP/repository/runtime cesty v tomto
WP, nikoli jen díky názvu route.

Také Setup baseline se musí popsat aktuálně. Promované 027 už nahradilo původní
whole-file/truthy writer bounded patchem: `writeEnvFile()` dnes mění jen
`OLLAMA_URL`, `C3_LANG`, `C3_DB_PATH` a `C3_LICENSE_KEY`, zachovává cizí i
notification řádky a používá atomic mode-0600/no-follow publikaci. Server před
registrací rout volá `setupWizard.load()`, takže well-formed legacy notification
subdocument se při běžném load/save zachová. Před prvním source checkpointem
zůstávaly tři jiné P0 residualy:

- target byl `path.resolve(process.cwd(), '.env')`, nikoli exact canonical
  project root;
- čtyři efektové Setup POSTy neměly strict route-level admin-token guard;
- `/api/setup/complete` bylo registrované vždy a i po dokončení znovu volalo
  `writeEnvFile()` a `complete()`, tedy znovu mutovalo `.env`, setup JSON a
  completion timestamp.

První zdrojový checkpoint `3bb35bbb32063dd058ab35872668d645fe9ff106`
tyto tři P0 residualy uzavřel. Jde o pushnutý ancestor budoucího finálního
subjectu, nikoli o dokončený nebo promovaný 026: canonical notification
authority, transfer/export/purge, exact scrub a retirement ještě nezačaly.

Globální trusted-local origin/capability boundary je samostatná vrstva a
nenahrazuje explicitní route auth. Samotný loopback bind ani CORS nejsou
autorizací mutation endpointu.

## Varianty

### A — environment-only pro core 1.0 (přijato)

Externí credentials nevstupují do aplikační DB, WAL, generic/portable backupu,
HTTP/WS response, renderer state, localStorage ani logů. Kanonický file source
je exact `<project-root>/.env` odvozený z `runtime-environment.js`, nikdy cwd,
setup `<configured-dataDir>/.env` ani `DOTENV_CONFIG_PATH`. Existující own
process environment
má pro každý vlastněný key vyšší prioritu i jako prázdný string. File musí být
regular, owner-owned, single-link, exact mode `0600` a čtený/zapisovaný bez
symlink traversal; změna vyžaduje restart.

Kanonický notification credential/private-destination status má přesně těchto
dvanáct klíčů:

```text
C3_SMTP_HOST
C3_SMTP_PORT
C3_SMTP_USER
C3_SMTP_PASS
C3_SMTP_FROM
C3_TELEGRAM_BOT_TOKEN
C3_TELEGRAM_CHAT_ID
C3_NTFY_SERVER
C3_NTFY_TOPIC
C3_NTFY_TOKEN
C3_WEBHOOK_URL
C3_WEBHOOK_SECRET
```

`GET /api/notifications/config` vrací pouze exact mapu všech dvanácti položek
pod `sources`; každý leaf obsahuje právě boolean `configured` a exact
`source: "PROCESS_ENV" | "ROOT_ENV_FILE"`. Nevrací raw, maskovanou ani
odvozenou hodnotu a není channel readiness, registration, support ani delivery
claim. Leaf `C3_WEBHOOK_SECRET` musí být shodný s exact dvouklíčovým statusem
028. `C3_DESKTOP_NOTIFICATIONS` je behavior/policy key, nikoli credential;
`C3_TEST_EMAIL` je test-only recipient. Ani jeden do dvanáctičlenné mapy
nepatří. `POST /api/notifications/config` končí pre-parse stabilním
`410 CREDENTIAL_SOURCE_READ_ONLY` bez DB, runtime nebo cache effectu.

`C3_NTFY_URL` není tichý alias `C3_NTFY_SERVER`: dormant `ntfy.js` a direct
verifier historicky používají první key, zatímco registrovaný `push.js` používá
druhý. Přemapování by změnilo chování instalace. `C3_NTFY_URL`, `SMTP_URL` a
`EMAIL_TO` proto musejí projít stejným explicitním verified mode-0600 exportem
nebo operátorským purge a teprve potom exact scrubem; nikdy heuristic parserem
nebo silent rename.

### B — oddělený SQLite secret store, bez tvrzení o šifrování

Známé podporované secrets by se atomicky přesunuly z JSON do samostatné tabulky.
Přístup by měl jen typed repository; set/rotate/clear by mohly být ve Studiu a
runtime by četl stejnou autoritu při startu i po commitu. Zavírá generic leak,
ale nechrání před procesem, který čte celý SQLite soubor. Varianta nebyla
přijata.

### C — OS keyring nebo šifrovaný store

Silnější at-rest ochrana, ale přidává novou platformní/deployment autoritu,
recovery klíče a závislost. Bez samostatného threat modelu není bezpečné ji
improvizovat uvnitř M1. Varianta nebyla přijata.

## Přijaté X1 — explicitní transfer/export/purge

Legacy hodnoty se nesmažou potichu. Jednorázový lokální migrační příkaz nejdřív
udělá census a pro každou nalezenou exact položku vyžádá právě jednu akci
`TRANSFER`, `EXPORT` nebo `PURGE`:

- `TRANSFER` je povolen jen pro retained direct runtime key, pokud process
  precedence nekoliduje a canonical target je absent nebo byteově shodný;
  následuje safe write, readback a provenance ověření;
- `EXPORT` vytvoří nový explicitní absolutní regular owner-owned single-link
  mode-0600/no-follow artifact, fsyncne jej a ověří jeho digest/readback;
- `PURGE` vyžaduje explicitní operátorskou volbu exact source/path/digest;
- konflikt, nejednoznačné mapování, shadow prázdným process keyem, stale revision
  nebo změněný source digest blokuje scrub; nástroj nikdy sám nevybírá vítěze.

Postup je staged a idempotentní; netvrdí globální atomitu napříč SQLite,
filesystemem a rendererem. DB scrub běží pod `BEGIN IMMEDIATE` s expected
revision a exact path digesty, zachová unknown keys a při úspěchu inkrementuje
revision právě jednou. Není prefixový: jeho exact legacy set tvoří top-level
`webhookSecret`, literal top-level `c3.notif.webhookSecret`, všech devět
retired typed cest
`c3.notif.emailEnabled`, `c3.notif.smtpHost`, `c3.notif.smtpPort`,
`c3.notif.smtpUser`, `c3.notif.smtpPass`, `c3.notif.smtpFrom`,
`c3.notif.emailRecipient`, `c3.notif.emailOnLifecycle` a
`c3.notif.emailOnWorker` a těchto deset nested cest historického Architect
dokumentu:

```text
notifications.emailAddresses
notifications.telegramToken
notifications.telegramChatId
notifications.slackWebhook
notifications.slackChannel
notifications.discordWebhook
notifications.webhookUrl
notifications.smsApiKey
notifications.smsSecret
notifications.smsPhone
```

Safe generic preference `c3.notif.desktopEnabled`,
`c3.notif.quietEnabled`, `c3.notif.quietFrom` a `c3.notif.quietTo` se zachovají
stejně jako všechny unknown paths. Setup scrub vlastní pouze
`notifications.telegram.token`, `notifications.telegram.chatId`,
`notifications.email.smtp`, `notifications.email.from`,
`notifications.email.to`, `notifications.ntfy.topic` a
`notifications.ntfy.server`; `.enabled` a unknown siblings zachová.
`notifications.email.smtp` a `.to` jsou legacy `SMTP_URL`/`EMAIL_TO`, takže
smějí jen do `EXPORT|PURGE`, nikoli do heuristic transferu. Setup/env scrub
používá exact preimage/path digesty. Setup JSON scrub zachovává cizí a unknown
JSON hodnoty sémanticky, nikoli jejich původní whitespace nebo byte layout;
env scrub zachovává nedotčené foreign lines byteově. Exact byte preservation
platí při no-mutation failure. Každý zdroj se odstraní až po ověřeném
cíli/exportu nebo explicitním purge. Plné odstranění historických SQLite
freepages, WAL a starých disaster-recovery backupů se netvrdí; patří do
M5-DATA.

Legacy `<configured-dataDir>` se bere z explicitní konfigurace. Každý
historický cwd `.env` je samostatný explicitní absolutní operator-supplied
input; CLI jej nesmí odvozovat ze svého dnešního cwd. File sources se
deduplikují podle identity. Direct legacy aliasy s jednoznačným mapováním jsou
DB canonical cesty a
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NTFY_SERVER`, `NTFY_TOPIC` a
`EMAIL_FROM`. Unsupported Slack/Discord/SMS hodnoty a unmappable
`SMTP_URL`/`EMAIL_TO`/`C3_NTFY_URL` smějí pouze do verified exportu nebo
explicitního purge. Žádný nový Slack/Discord/SMS ani email-recipient env key
nevzniká a writer nikdy nezapisuje `C3_ENABLE_NOTIFICATION_*`.

Preflight kontroluje own-presence `SMTP_URL`, `EMAIL_TO` a `C3_NTFY_URL` také
v process environment, včetně prázdné hodnoty. CLI nemůže změnit environment
svého parent procesu, takže takový source po zvolené akci `EXPORT|PURGE`
zůstává blokující, dokud nový restart výslovně neprokáže nepřítomnost klíče;
do té doby nesmí reportovat scrub ani smazat shodnou file/DB kopii.

## Přijaté X1 — offline localStorage, bez loopback connectoru

Jediným legacy credential blobem v rendereru je
`localStorage['paiass_settings']`; `localStorage['c3-settings']` drží jiný
settings povrch a není credential source tohoto WP. Exact sensitive paths jsou:

```text
notifications.emailAddresses
notifications.telegramToken
notifications.telegramChatId
notifications.slackWebhook
notifications.slackChannel
notifications.discordWebhook
notifications.webhookUrl
notifications.smsApiKey
notifications.smsSecret
notifications.smsPhone
```

Raw localStorage blob ani jeho credentials nikdy nejdou přes HTTP, WS, nový
loopback endpoint, URL, log, clipboard ani in-app raw download. CLI přijme pouze
explicitní absolutní exact UTF-8 offline input, který je regular, owner-owned,
single-link, mode `0600` a otevřený no-follow.
Po verified exportu nebo explicitním purge vydá pouze non-secret receipt vázaný
na source `PAIASS_SETTINGS`, preimage/postimage SHA-256, seřazené exact path
IDs, jednu společnou akci a případný export digest. Architect receipt použije
jen tehdy, když současný blob i všechny path digesty stále přesně sedí;
odstraní jen známé nested paths, zachová unknown/non-secret data a při
malformed/stale/failure zachová původní bytes. Opakované použití je idempotentní
jen nad exact postimage.

## Přijaté M1-CLOSEOUT-X1 — přesná hranice 026

026 vlastní globální **notification configuration authority**, nikoli globální
odstranění každé delivery destination nebo explicitního agent-action payloadu.
`NotificationEmitter`-generovaný automatický lifecycle/worker bridge se
retiruje. Explicitní `AgentRunner` notify akce i manual HTTP delivery přes
`POST /api/notifications/test` a `POST /api/notifications/send` smějí nést
caller-supplied recipient/destination. Jde o ephemeral explicitní delivery
input, nikoli default configuration authority ani oprávnění destination
persistovat. `generic/settings/import` responses zůstávají redacted; tato
výjimka nevytváří global no-private-destination claim.

Proto zůstávají přiznaným `M5-DATA / typed-agent` residualem zejména
`notification_channels_v57.recipient/config`,
`notification_log_v57.recipient`,
`notification_digest_buffer_v57.recipient` a persisted agent
notify/webhook definitions. 026 je nesmí vydat za globálně scrubnuté; jejich
retence, privacy erase a historické backupy mají samostatného vlastníka.

Všech dvanáct canonical keys se zachytí jednou při startupu. Own process
presence se zachytí před root-file loadem, root-file values se nekopírují do
ambientního `process.env` a email, Telegram, push, webhook, verifier, server i
workers dostanou stejnou frozen injected authority. Výslovná úzká allowlist
výjimka dovoluje změnit `src/notifications/channels/webhook.js` pouze tak, aby
vyžadoval vlastní injected `url` string včetně `""`; chybějící nebo non-string
injection selže fail-closed a žádná hodnota nikdy nespadne zpět na ambientní
`C3_WEBHOOK_URL`. 028 HMAC, secret status, Security response a signing semantics
zůstávají beze změny.

Po migraci nesmí nový/default Setup znovu vytvořit notification credential ani
destination leaf. Zachová jen `.enabled` a unknown siblings; existující legacy
hodnoty se zachovají do jejich explicitně zvolené migrační akce. Úspěšný nested
Setup JSON scrub garantuje sémantickou, nikoli formátovací/byteovou ochranu
unknown JSON hodnot. Byte preservation platí pro no-mutation failure a
nedotčené env lines/files.

Post-P0 smí `src/setup/wizard.js` dostat jen dva mechanické follow-upy:
delegovat canonical root `.env` operace do jediného nového shared
`root-environment-file.js` seamu a odstranit notification credential/destination
leaves z `DEFAULT_SETUP`/`createDefaultSetup()`. Existing well-formed legacy
leaves se dál validují a zachovají do explicitní migrační akce. Strict guard,
route responses a completion behavior z P0 zůstávají byte-semanticky invariantní.

Agents-disabled blanket guard se globálně neruší. Vyjmout z něj lze pouze exact
`GET /api/notifications/config` jako status-only read a exact
`POST /api/notifications/config` jako inertní pre-parse 410. Send, test, verify
a channels behavior při `agents=false` zůstává stejné; širší výjimka by změnila
capability boundary a je autonomy stop.

Exact scrub-only legacy env owner set je:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
NTFY_SERVER
NTFY_TOPIC
EMAIL_FROM
SMTP_URL
EMAIL_TO
C3_NTFY_URL
```

Tyto legacy alias keys nástroj nikdy nevytváří ani nemění. Smí je pouze smazat
po verified transfer/export/purge a následné absence/readback attestaci.
Canonical target může vzniknout jen přes svůj samostatný dvanáctiklíčový owner;
`C3_NTFY_URL` se nikdy tiše nepřejmenuje.

Census smí být read-only za běžícího produktu. Apply vyžaduje explicitní
attestaci, že server i workers jsou zastavené, a jeden non-secret digest-bound
manifest všech source actions; operátor nepotvrzuje jednotlivé řádky znovu.
`PURGE` není automatický default. Přímé nekolidující string mapování lze
doporučit jako `TRANSFER`; unsupported, unmappable a non-string hodnotu jako
`EXPORT`. Numeric `smtpPort` se nepřetypuje implicitně: bez operátorem dodané
explicitní canonical decimal-string hodnoty svázané s manifest digestem smí
jen `EXPORT|PURGE`. Recovery je staged roll-forward a nikdy neobnovuje secret
do legacy source.

Jeden `INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V1` používá jednu společnou akci
`EXPORT` nebo `PURGE` pro všechny vyjmenované paths. Mixed výsledek se provede
jako ordered EXPORT receipt a teprve potom PURGE receipt. Každý receipt nese
`preimageSha256` i `postimageSha256`; re-apply uspěje pouze nad exact
postimage, jiný stav je stale failure. `localStorage.clear()` je zakázané.

Schválené mechanické allowlist rozšíření jsou `docs/API-REFERENCE.md`,
`docs/WS-PROTOCOL.md`, `tests/notifications.test.js`,
`tests/workers-phase-b.test.js`, `tests/push-channel.test.js` a
`tests/e2e-notifications.test.js`. Network-free části smějí běžet jen pod již
explicitně přijatým samostatným envelope; external E2E zůstává pravdivě
`NOT RUN / BLOCKED`. Toto rozšíření přistane samostatným docs-only governance
commitem před dalším source writerem a není součástí reviewovaného
implementačního subjectu.

Governance commit `G` vznikne jako sibling P0 z exact rodiče
`ea21bf3e2f8a54e1cbf93430cdb52037957a63c8`, projde vlastním nezávislým review
a promotion a potom se běžným merge commitem bez rewrite připojí do existující
P0 branch na `3bb35bbb32063dd058ab35872668d645fe9ff106`. P0 SHA a ancestry se
nesmějí přepsat. Finální Review A pinuje `baseRevision=G`, `subjectHead=S` a
range `G..S`; `G` tedy není uvnitř implementačního subjectu, zatímco P0 přes
merge zůstává jeho exact ancestor. P0 se samostatně nepromuje.

## Setup P0 — první source checkpoint dokončen před zbytkem 026

První commit uvnitř subjectu `3bb35bbb32063dd058ab35872668d645fe9ff106`
uzavřel Setup P0 a byl commitnutý a pushnutý dřív, než writer začal měnit
ostatní 026 cesty:

1. `writeEnvFile()` a jeho helper smějí patchnout jen exact canonical
   `<project-root>/.env`; cwd-relative target ani broad/truthy rekonstrukce,
   která zahodí foreign řádky, není povolena. Stávající bounded four-key writer a preservation garance se
   zachová a zesílí; truthy filtering nikdy nesmí odstranit foreign nebo
   notification řádku. Explicitní clear vlastněného prázdného
   `C3_LICENSE_KEY` zůstává samostatná čtyřklíčová setup semantics, ne broad
   truthy deletion.
2. Před parse, in-memory mutací, Ollama fetch nebo filesystem efektem vyžadují
   `POST /api/setup/ollama`, `/api/setup/language`, `/api/setup/license` a
   `/api/setup/complete` explicitní validní `C3_ADMIN_TOKEN`; neexistuje dev
   localhost bypass. Missing/mismatch skončí exact
   `403 {"ok":false,"code":"SETUP_ADMIN_AUTH_REQUIRED"}` bez token echo.
   Ambiguous, malformed, array-valued nebo současně předané auth hlavičky se
   odmítnou a chybějící guard dependency je fail-closed. Inertní pre-parse
   `POST /api/setup/notifications → 410 SETUP_NOTIFICATION_INPUT_RETIRED` a
   `GET /api/setup/status` se nemění.
3. Authenticated `/api/setup/complete` před prvním env/state efektem znovu
   ověří durable completion state. Pokud je setup už dokončený, vrátí exact
   `409 {"ok":false,"code":"SETUP_ALREADY_COMPLETE"}` a nezmění env bytes,
   setup JSON ani timestamp.

P0 je první source checkpoint jednoho finálního subjectu, ne samostatně
promovaný náhradní WP. Jeho dokončení neznamená dokončení 026. Po nezávislé
promotion governance `G` se `G` normálně mergne do P0 branch a teprve potom
následuje zbytek 026; immutable final `S` se předá Review A nad range `G..S` až
po dokončení celého allowlistu.

## Tvrdý core 1.0 důsledek pro automatický e-mail

Retirement DB config writeru a `NotificationEmitter` spolu se zákazem nového
recipient env key znamená přesně toto: **`NotificationEmitter`-generovaný
automatický lifecycle/worker email bridge po 026 nebude v core 1.0
konfigurovatelný vůbec**. `EmailChannel` smí zůstat jen jako default-off
retained/unclaimed kandidát pro explicitní caller-supplied recipient;
explicitní `AgentRunner` notify action a manual notification test/send zůstávají
pro caller-supplied destination, ale nevytvářejí automatický email support
claim. Stejná přesná hranice musí být natvrdo v release notes, ne až v 1.0
discovery.

## Implementační a důkazní hranice

U A nevzniká schema migrace ani nový secret store. Vznikne safe canonical root
read/write seam, bounded lokální transfer/export/purge command, status-only GET,
pre-parse 410 POST, exact DB/setup/env/localStorage scrub, retirement zbývajících
aplikačních setterů a emitteru a pravdivá dokumentace. `GET
/api/notifications/channels` zůstává policy/registration stavem, nikoli
credential statusem.

Implementační subject může použít výše schválenou úzkou webhook URL injection
výjimku a šest mechanických docs/test compatibility cest. Nemění tím 028 ani
nepřidává novou suite. Jiné rozšíření allowlistu zůstává stop condition.

Redukovaný důkaz zůstává ve čtyřech existujících programech: settings authority
`4/4`, notification credential scope `2/2`, Studio VM `128/128` a registry
validator s 382 programy / 8 exclusions a fingerprintem
`571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71`.
Případy se rozšíří table-driven bez nové suite a bez růstu top-level počtů.
Čtyři compatibility soubory dostanou jen mechanický source alignment/audit a
nepřidávají pátý subject-gate program. Network-free část smí běžet samostatně
jen pod již explicitně přijatým envelope; external části zůstávají
`NOT RUN / BLOCKED`.
`tests/e2e/12-notifications.e2e.js` smí dostat pouze source-contract update a
zůstává `NOT RUN / BLOCKED`; Electron, GPU, Ollama, externí síť a celý
produktový test se nespouštějí.

## Přijatý potvrzovací blok

```text
026: A
026-X1: ACCEPTED-OFFLINE-LOCALSTORAGE-NO-HTTP-WS-LOOPBACK
026-store: INSTALL-ROOT-DOTENV-MODE-0600
026-precedence: PROCESS-ENV-THEN-ROOT-ENV-FILE-OWN-EVEN-EMPTY
026-public-read: CONFIGURED-AND-EXACT-SOURCE-ONLY
026-notification-config-get: EXACT-12-KEY-CONFIGURED-SOURCE-ONLY
026-notification-config-post: PRE-PARSE-410-CREDENTIAL-SOURCE-READ-ONLY
026-generic-backup-log: NEVER-CONTAINS-SECRET-VALUE
026-app-setter: NONE-READ-ONLY-SOURCE
026-ws-sync-settings: SMTP-INJECTION-RETIRED
026-legacy-ws-credential-writer: RETIRED-BEFORE-TRANSFER
026-legacy: EXPLICIT-TRANSFER-OR-EXPORT-OR-PURGE-THEN-EXACT-SCRUB
026-legacy-sources: DB + SETUP-DATA-DOTENV
026-legacy-source-census: USER-SETTINGS-PAIASS-LOCALSTORAGE-C3-SETUP-JSON-DATA-DOTENV-CWD-DOTENV
026-legacy-unmappable: SMTP_URL-EMAIL_TO-C3_NTFY_URL-EXPORT-OR-PURGE
026-env-write: EXACT-OWNED-KEYS-ATOMIC-0600-NOFOLLOW-NO-NEWLINE
026-localstorage-source: PAIASS_SETTINGS-ONLY-NOT-C3-SETTINGS
026-localstorage-receipt: ONE-COMMON-ACTION-PREIMAGE-POSTIMAGE-AND-PATH-DIGEST-BOUND
026-localstorage-mixed: ORDERED-EXPORT-RECEIPT-THEN-PURGE-RECEIPT
026-private-destinations: REDACT-FROM-GENERIC-AND-IMPORT-RESPONSE
026-scope: GLOBAL-NOTIFICATION-CONFIG-AUTHORITY-NOT-HISTORICAL-DELIVERY-ERASE
026-m5-data-residual: CHANNEL-LOG-DIGEST-AND-AGENT-ACTION-DESTINATIONS
026-injection: FROZEN-STARTUP-AUTHORITY-NO-ROOT-FILE-AMBIENT-COPY
026-webhook-url-exception: REQUIRED-OWN-INJECTED-STRING-INCLUDING-EMPTY + NEVER-AMBIENT-FALLBACK + 028-SEMANTICS-UNCHANGED
026-env-alias-owner: EIGHT-KEY-DELETE-ONLY-NEVER-CREATE-OR-UPDATE
026-apply: SERVER-AND-WORKERS-STOPPED-DIGEST-BOUND-MANIFEST
026-purge-default: NEVER
026-smtp-port: EXPLICIT-DIGEST-BOUND-DECIMAL-STRING-OR-EXPORT-PURGE
026-recovery: STAGED-ROLL-FORWARD-NEVER-RESTORE-LEGACY-SECRET
026-setup-json-preservation: UNKNOWN-VALUES-SEMANTIC-NO-MUTATION-BYTES
026-setup-post-p0: SHARED-ROOT-WRITER-DELEGATION-PLUS-DEFAULT-SCHEMA-RETIREMENT
026-setup-p0-invariant: STRICT-GUARD-ROUTES-COMPLETION-BYTE-SEMANTICS
026-agents-disabled: EXEMPT-ONLY-CONFIG-GET-AND-INERT-CONFIG-POST
026-setup-p0-order: FIRST-SOURCE-COMMIT-BEFORE-REST-026
026-setup-p0-env-writer: NO-CWD-RELATIVE-WHOLE-FILE-ENV-WRITE + CANONICAL-PATH-ONLY + MODE-0600-NOFOLLOW + NO-TRUTHY-FILTER-DELETION
026-setup-p0-auth: REQUIRE-AUTH + REFUSE-WHEN-SETUP-ALREADY-COMPLETE
026-setup-p0-auth-detail: STARTUP-CAPTURED-STRICT-ADMIN-TOKEN-BEFORE-FOUR-EFFECTFUL-POSTS + 403-SETUP-ADMIN-AUTH-REQUIRED + NO-DEV-LOCALHOST-BYPASS
026-auto-email: NOTIFICATIONEMITTER-LIFECYCLE-WORKER-BRIDGE-NOT-CONFIGURABLE
026-explicit-delivery: AGENTRUNNER-PLUS-MANUAL-TEST-SEND-CALLER-SUPPLIED-DESTINATION-REMAINS
026-explicit-delivery-redaction: GENERIC-SETTINGS-IMPORT-RESPONSES-REMAIN-REDACTED-NO-GLOBAL-DESTINATION-ERASE-CLAIM
026-allowlist-amendment: OWN-DOCS-COMMIT-BEFORE-NEXT-SOURCE-WRITER
026-disaster-recovery: M5-DATA-SEPARATE-CONTRACT
026-review: ONE-FINAL-SUBJECT-REVIEW-A-AND-B-WRITER-NE-REVIEWER
```
