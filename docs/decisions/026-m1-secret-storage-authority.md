# 026 — credentials nesmějí žít v obecném settings dokumentu

- **typ:** secret storage, transfer a read/write autorita
- **stav:** `ACCEPTED 2026-08-11: A + X1 / WP_ACTIVE /
  IMPLEMENTATION_NOT_STARTED`; aktivní ohraničený
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
subdocument se při běžném load/save zachová. Otevřený P0 je jiný:

- target je stále `path.resolve(process.cwd(), '.env')`, nikoli exact canonical
  project root;
- čtyři efektové Setup POSTy nemají strict route-level admin-token guard;
- `/api/setup/complete` je registrované vždy a i po dokončení znovu volá
  `writeEnvFile()` a `complete()`, tedy znovu mutuje `.env`, setup JSON a
  completion timestamp.

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
používá exact preimage/path digesty a zachovává cizí bytes. Každý zdroj se
odstraní až po ověřeném cíli/exportu nebo explicitním purge. Plné odstranění
historických SQLite freepages, WAL a starých disaster-recovery backupů se
netvrdí; patří do M5-DATA.

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
loopback endpoint nebo log. CLI přijme pouze explicitní absolutní offline input,
který je regular, owner-owned, single-link, mode `0600` a otevřený no-follow.
Po verified exportu nebo explicitním purge vydá pouze non-secret receipt vázaný
na source `PAIASS_SETTINGS`, preimage SHA-256, seřazené exact path IDs, akci a
případný export digest. Architect receipt použije jen tehdy, když současný blob
i všechny path digesty stále přesně sedí; odstraní jen známé nested paths,
zachová unknown/non-secret data a při malformed/stale/failure zachová původní
bytes. Opakované použití je idempotentní.

## Setup P0 — první source commit před zbytkem 026

První commit uvnitř subjectu musí uzavřít Setup P0 a být commitnutý a pushnutý
dřív, než writer začne měnit ostatní 026 cesty:

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

P0 je první checkpoint jednoho finálního subjectu, ne samostatně promovaný
náhradní WP. Po jeho focused ověření následuje zbytek 026; immutable final `S`
se předá Review A až po dokončení celého allowlistu.

## Tvrdý core 1.0 důsledek pro automatický e-mail

Retirement DB config writeru a `NotificationEmitter` spolu se zákazem nového
recipient env key znamená přesně toto: **automatické lifecycle/worker e-maily
po 026 nebudou v core 1.0 konfigurovatelné vůbec**. `EmailChannel` smí zůstat
jen jako default-off retained/unclaimed kandidát pro explicitní opt-in a
caller-supplied recipient; nevytváří automatický email support claim. Stejná
věta musí být natvrdo v release notes, ne až v 1.0 discovery.

## Implementační a důkazní hranice

U A nevzniká schema migrace ani nový secret store. Vznikne safe canonical root
read/write seam, bounded lokální transfer/export/purge command, status-only GET,
pre-parse 410 POST, exact DB/setup/env/localStorage scrub, retirement zbývajících
aplikačních setterů a emitteru a pravdivá dokumentace. `GET
/api/notifications/channels` zůstává policy/registration stavem, nikoli
credential statusem.

Testovací objem zůstává ve čtyřech existujících programech: settings authority
`4/4`, notification credential scope `2/2`, Studio VM `128/128` a registry
validator s 382 programy / 8 exclusions a fingerprintem
`571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71`.
Případy se rozšíří table-driven bez nové suite a bez růstu top-level počtů.
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
026-localstorage-receipt: NONSECRET-PREIMAGE-AND-PATH-DIGEST-BOUND
026-private-destinations: REDACT-FROM-GENERIC-AND-IMPORT-RESPONSE
026-setup-p0-order: FIRST-SOURCE-COMMIT-BEFORE-REST-026
026-setup-p0-env-writer: NO-CWD-RELATIVE-WHOLE-FILE-ENV-WRITE + CANONICAL-PATH-ONLY + MODE-0600-NOFOLLOW + NO-TRUTHY-FILTER-DELETION
026-setup-p0-auth: REQUIRE-AUTH + REFUSE-WHEN-SETUP-ALREADY-COMPLETE
026-setup-p0-auth-detail: STARTUP-CAPTURED-STRICT-ADMIN-TOKEN-BEFORE-FOUR-EFFECTFUL-POSTS + 403-SETUP-ADMIN-AUTH-REQUIRED + NO-DEV-LOCALHOST-BYPASS
026-auto-email: LIFECYCLE-WORKER-EMAILS-NOT-CONFIGURABLE-IN-CORE-1.0
026-disaster-recovery: M5-DATA-SEPARATE-CONTRACT
026-review: ONE-FINAL-SUBJECT-REVIEW-A-AND-B
```
