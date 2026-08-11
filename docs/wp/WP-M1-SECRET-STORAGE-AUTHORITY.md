# WP-M1-SECRET-STORAGE-AUTHORITY — verified env transfer a exact scrub

**Typ:** zapisující M1 credential/storage-authority WP · **Slot:** jediný writer
v izolovaném disk-backed worktree

**Rozhodnutí:**
[`026/A + X1 + M1-CLOSEOUT-X1`](../decisions/026-m1-secret-storage-authority.md)

**sourceEvidenceRevision:**
`0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** promoted exact governance commit `G`, který vznikne jako
sibling P0 z `ea21bf3e2f8a54e1cbf93430cdb52037957a63c8`; jeho exact SHA zapíše až
unikátní run report. `sourceEvidenceRevision` není jeho náhrada

**Branch:** `wp/m1-secret-storage-authority-20260811`

**Worktree:** `/home/belphareon/worktrees/is-m1-secret-storage-authority`

**Stav:** `ACTIVE / SETUP_P0_CHECKPOINT_PUSHED /
REST_IMPLEMENTATION_NOT_STARTED` — 025, 027 a 028 jsou
`PROMOTED / REVIEW A+B PASS`; 028 promotion tip a aktivační source evidence je
`0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`. Finding 011 zůstává `OPEN`, Gate
1 `BLOCKED`; první P0 source ancestor je
`3bb35bbb32063dd058ab35872668d645fe9ff106`. 029 nezačne před přijetím 026
candidate.

## 1. Uživatelský výsledek

Po dokončení budou retained notification credentials a private destinations
čtené pouze z own process environment nebo exact canonical
`<project-root>/.env`. Aplikace je nebude umět persistovat jako default config
přes HTTP, WS, generic settings, Setup ani runtime config setter. Status vrátí
pouze configured/source pro přesných dvanáct klíčů; raw, masked ani odvozenou
hodnotu nevrátí. Explicitní manual test/send HTTP request však smí nést vlastní
caller-supplied ephemeral destination.

Každá existující legacy hodnota dostane explicitní operátorskou akci
`TRANSFER`, `EXPORT` nebo `PURGE`. Exact source se scrubne až po ověřeném
canonical readbacku, verified mode-0600 exportu nebo explicitním purge.
Konflikt, stale source nebo nejednoznačné mapování skončí beze změny; unknown
data se zachovají.

Oddělený pushed source commit
`3bb35bbb32063dd058ab35872668d645fe9ff106` na P0 branch uzavřel Setup P0:
čtyři efektové Setup POSTy dostaly strict explicit admin-token auth, repeated
`/api/setup/complete` skončí před efektem a bounded writer přestal odvozovat
target z cwd. Další writer smí začít zbytek 026 až po nezávislém review a
promotion `G` a jeho normálním merge do existující P0 branch. Celý WP má jeden
finální immutable subject `S` a společné Review A/B.

Raw legacy `localStorage['paiass_settings']` nikdy nepřejde přes HTTP, WS ani
nový loopback connector. Operátor použije offline file/receipt flow. Cena
přijatého úzkého core scope je výslovná: po retirementu emitteru a bez nového
recipient env key nebude `NotificationEmitter`-generovaný automatický
lifecycle/worker email bridge v core 1.0 konfigurovatelný. Explicitní
`AgentRunner` notify action i `POST /api/notifications/test` a
`POST /api/notifications/send` s caller-supplied recipientem zůstávají.

026 vlastní notification configuration authority, ne globální vymazání všech
historických či per-delivery destinations. Channel/log/digest tabulky a
persisted agent notify/webhook definitions zůstávají explicitním M5-DATA nebo
typed-agent residualem; finální 026 je nesmí popsat jako globálně scrubnuté.
`generic/settings/import` responses zůstávají redacted; caller-supplied
destination v explicitním delivery requestu není oprávnění ji persistovat ani
důkaz globální absence private destinations.

## 2. Povolené a zakázané cesty

**Povolené runtime/source cesty:**

- `.env.example` pouze pro prázdné canonical keys a bezpečný mode-0600
  operátorský postup; žádná skutečná hodnota;
- nový `src/security/root-environment-file.js` jako jediný pure/synchronous
  safe read/patch/readback seam exact project-root `.env`;
- nový `src/security/strict-admin-auth.js` s jediným pure
  `createStrictAdminTokenGuard({ expectedToken })`; startup-captured exact token,
  žádný dev/localhost bypass ani Security-route behavior change;
- `src/runtime-environment.js` pouze pro rozšíření pre-load own-presence
  snapshotu, canonical dvanáctiklíčové notification authority a zachování
  immutable 028 webhook signer/status parity;
- nový `scripts/migrate-notification-authority.js` jako jediný explicitní
  lokální census/transfer/export/purge/scrub command;
- `scripts/start-workers.js` a `src/server.js` pouze pro injection stejné
  startup authority, Setup canonical root, emitter retirement a pravdivý
  retained-channel status. Existing agents-disabled blanket smí vyjmout jen
  exact `GET /api/notifications/config` status a inertní pre-parse
  `POST /api/notifications/config` 410; send/test/verify/channels behavior při
  `agents=false` zůstává stejné;
- `src/setup/wizard.js` obsahuje dokončený P0 checkpoint na oddělené P0 branch v
  exact commitu `3bb35bbb32063dd058ab35872668d645fe9ff106`, nikoli v aktuálním G
  sibling tree. Po merge promoted `G` do P0 branch se smí post-P0 změnit jen pro
  delegaci canonical four-key `.env` operací do shared
  `root-environment-file.js` seamu a retirement notification
  credential/destination leaves z `DEFAULT_SETUP`/`createDefaultSetup()`.
  Existing well-formed legacy leaves se dál validují a zachovají do explicitní
  migrační akce; strict admin-token guard, route responses, durable
  already-complete refusal a completion behavior jsou byte-semanticky
  invariantní;
- `src/db/user-settings.js` pouze pro exact legacy census/scrub transaction a
  odstranění zbývajícího notification repository writeru/exportu;
- `src/routes/notifications.js` pouze pro exact 12-key configured/source GET,
  pre-parse POST 410 a odstranění DB/runtime emitter config cesty;
- `src/notifications/index.js`, `src/notifications/service.js` a
  `src/notifications/e2e-verify.js` pouze pro read-only startup authority,
  odstranění runtime config setteru a cutover direct verifieru na canonical
  keys;
- `src/notifications/emitter.js` a `src/planner/lifecycle-build.js` pouze pro
  úplný production retirement automatického DB-configured lifecycle/worker
  email bridge a jeho injection/call seamů;
- `src/notifications/channels/email.js`,
  `src/notifications/channels/telegram.js` a
  `src/notifications/channels/push.js` pouze pro injected immutable authority a
  odstranění ambientního/živého config setteru; channel support policy z 027 se
  nemění;
- `src/notifications/channels/webhook.js` pouze pro required own injected `url`
  string včetně `""`; absence nebo non-string injection selže fail-closed a
  ambientní `C3_WEBHOOK_URL` fallback je vždy zakázaný. 028 HMAC, secret status,
  Security response a signing semantics jsou zakázané měnit;
- `src/ui/architect/architect.html` a `src/ui/architect/architect.js` pouze pro
  offline input/receipt workflow nad exact `paiass_settings` paths; žádný raw
  network transport;
- existující `tests/m1-settings-notification-authority.test.js`,
  `tests/m1-notification-credential-scope.test.js` a
  `tests/m1-studio-client.test.js`, bez nového top-level programu a bez růstu
  jejich počtů `4`, `2`, `128`;
- existující `tests/notifications.test.js`, `tests/workers-phase-b.test.js`,
  `tests/push-channel.test.js` a `tests/e2e-notifications.test.js` pouze pro
  compatibility alignment/source audit. Nejsou pátým subject-gate programem;
  network-free část smí běžet jen pod samostatným již přijatým envelope a
  external E2E zůstává `NOT RUN / BLOCKED`;
- `tests/e2e/12-notifications.e2e.js` pouze pro mechanický source-contract
  update; program zůstává `NOT RUN / BLOCKED`;
- `docs/NOTIFICATIONS.md` pro pravdivý runtime/API popis a
  `docs/CHANGELOG.md` jako release note s tvrdým automatic-email důsledkem;
- `docs/API-REFERENCE.md` a `docs/WS-PROTOCOL.md` pouze pro mechanické srovnání
  veřejného source kontraktu;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` jako jediný
  source-progress dokument;
- unikátní
  `docs/execution/runs/wp-m1-secret-storage-authority-20260811-report.md` smí
  poprvé vzniknout až v report-only `E_A` po Review A.

Setup P0 první commit je podmnožina allowlistu: nový
`src/security/strict-admin-auth.js`, `src/setup/wizard.js`, nezbytné wiring v
`src/server.js`, existující notification-scope test a Finding 011. Existující
Security `requireAuth` s dev-localhost semantics se neimportuje, nemění ani
nevydává za strict Setup autoritu.

Toto M1-CLOSEOUT-X1 rozšíření allowlistu přistane vlastním docs-only governance
commitem `G` jako sibling P0 z exact rodiče
`ea21bf3e2f8a54e1cbf93430cdb52037957a63c8`. `G` projde vlastním nezávislým
review a promotion před dalším source writerem a nesmí se přimíchat do
implementačního subjectu. Každý následný subject má nezávislého reviewera
(`writer != reviewer`); vyjmenované compatibility cesty výše už další allowlist
rozhodnutí nepotřebují.

**Zakázané:**

- všechny schema migrace, nová DB tabulka, keyring, encryption nebo nová
  dependency;
- `src/routes/security.js`, decision/WP 028 nebo jakákoli změna jeho exact
  Security response/status/signer/410 semantics; webhook výjimka výše je pouze
  URL injection fallback, ne změna 028;
- `src/ws-bridge/**`; SMTP injection je už promovaně retired a feature-only
  contract se znovu neotvírá;
- dormant `src/notifications/channels/ntfy.js`; jeho produkční import/registrace
  je stop condition;
- generic settings v2, portable backup/import schema, `/api/reset`,
  factory-delete nebo standalone `chats/` semantics;
- nový recipient env key, nový Slack/Discord/SMS env kontrakt, implementace
  Slack/Discord/SMS nebo zápis `C3_ENABLE_NOTIFICATION_*`;
- tichý rename `C3_NTFY_URL` na `C3_NTFY_SERVER`, parsing `SMTP_URL` nebo
  odvozování `EMAIL_TO` do nové autority;
- přenos raw localStorage value přes HTTP, WS, loopback server, URL, log,
  clipboard automatiku, in-app raw download nebo testovací network seam;
- full forensic wipe SQLite freepages/WAL/starých backupů nebo tvrzení o
  secret recovery; to patří M5-DATA;
- mobile, Electron source/build/journey, GPU, Ollama, externí síť, skutečný
  outbound channel nebo celý produktový test;
- `tests/registry.json`, nový testovací program, registry/baseline count bump,
  package/lockfile nebo generated build output;
- další změna tohoto statického WP, decision 026, decision 028,
  `docs/wp/README.md`, `ROADMAP.md` nebo `SYSTEM-MAP.md` po samostatném
  M1-CLOSEOUT-X1 docs-only amendment commitu. Source progress patří pouze do
  Findingu 011 a report-only evidence.

## 3. První checkpoint — Setup P0 dokončen

Aktuální base už má bounded writer a před route registration volá
`setupWizard.load()`. P0 tyto garance zachová a zesílí; nesmí je falešně
nahrazovat historickým whole-file writerem.

### Canonical writer

`writeEnvFile()` nesmí mít cwd-relative default ani akceptovat libovolný caller
target. Exact target je `path.join(projectRoot, '.env')`, kde `projectRoot` je
tentýž canonical root jako v `runtime-environment.js`. CLI spuštěné z jiného cwd
i HTTP complete zapisují stejný soubor.

Writer dál smí měnit jen `OLLAMA_URL`, `C3_LANG`, `C3_DB_PATH` a
`C3_LICENSE_KEY`. Existing target musí být regular, owner-owned, single-link,
exact mode `0600`, opened no-follow; update používá same-directory exclusive
mode-0600 temp, fsync, identity recheck, atomic publish, directory fsync a exact
readback. Absent target vznikne exclusive/no-follow mode `0600`. Duplicate
owned key, malformed/multiline dotenv, NUL/CR/LF/U+2028/U+2029 v nové hodnotě,
symlink, foreign owner, multi-link nebo wrong mode skončí typovaně beze změny.

Foreign a notification bytes se zachovají; truthy filtering je nesmí odstranit.
Dosavadní explicitní clear prázdného setup-owned `C3_LICENSE_KEY` je povolený
jen jako named four-key semantics a není oprávněním k broad whole-file
rekonstrukci.

### Strict route auth a terminal completion

Před `parseBody()`, in-memory mutací, `fetch()` nebo filesystem efektem musejí
`POST /api/setup/ollama`, `/api/setup/language`, `/api/setup/license` a
`/api/setup/complete` vyžadovat explicitně nakonfigurovaný
startup-captured `C3_ADMIN_TOKEN` a timing-safe shodu s právě jednou z hlaviček
`X-Admin-Token` nebo `Authorization: Bearer`. Missing configured token, missing
presented token, mismatch, whitespace/malformed scheme, array-valued header,
duplicate/ambiguous hodnota nebo současně předané obě auth hlavičky vrátí exact
`403 {"ok":false,"code":"SETUP_ADMIN_AUTH_REQUIRED"}`; dev/localhost bypass
není. Error nesmí echoovat token. Pure
`createStrictAdminTokenGuard({ expectedToken })` vznikne v novém
`src/security/strict-admin-auth.js`; token zachytí při startup composition a
`createSetupRoutes` bez validní injected guard dependency fail-closed odmítne
všechny čtyři efektové POSTy. Existující Security guards a responses se nemění.

`POST /api/setup/notifications` zůstává inertní pre-parse
`410 {"ok":false,"code":"SETUP_NOTIFICATION_INPUT_RETIRED"}` a `GET
/api/setup/status` se nemění. P0 je nerozšiřuje o nový auth nebo response shape.

Authenticated `/api/setup/complete` znovu čte durable completion state před
prvním env/state efektem. Pokud je `completed === true`, exact response je:

```json
{"ok":false,"code":"SETUP_ALREADY_COMPLETE"}
```

se statusem `409`; `writeEnvFile()`, `complete()`, setup JSON, env bytes a
timestamp se nezmění. Malformed/unreadable existing setup state nesmí být
přepsaný defaults; skončí typovaně fail-closed. First completion dál zachová
well-formed legacy notification subdocument pro následný transfer.

### Dokončené pořadí checkpointu

Writer nejdřív implementoval pouze P0 subset, rozšířil existující první
notification-scope případ, spustil níže uvedený redukovaný gate, udělal diff
census/check a vytvořil a pushnul source commit
`3bb35bbb32063dd058ab35872668d645fe9ff106`. P0 se samostatně nepromuje;
zůstává prvním source ancestor commitem jednoho finálního `S`. Samostatný
docs-only `G` se po nezávislém review a promotion běžným merge commitem bez
rebase, cherry-picku nebo jiného rewrite připojí do existující P0 branch; exact
P0 SHA i ancestry zůstanou zachované. Ostatní allowlisted soubory smí další
writer otevřít až po tomto merge.

## 4. Canonical environment authority a status

Startup před dotenv populate zachytí own-presence i string hodnotu všech
dvanácti canonical keys:

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

Own process key vyhrává i jako `""`: source je `PROCESS_ENV` a
`configured=false`. Jinak hodnota pochází jen z exact root file, source je vždy
`ROOT_ENV_FILE` i při absent file/key a configured je pravda právě pro
non-empty string. Root file se přečte jednou přes safe regular/owner/mode-0600/
single-link/no-follow bounded reader. Startup authority je frozen a raw values
nejsou enumerable, serializable ani veřejně dostupné. Own process presence se
zachytí před root-file loadem a root-file values se do ambientního `process.env`
nekopírují. Email, Telegram, push, webhook, verifier, server i workers dostanou
tentýž injected frozen snapshot. Webhook musí dostat vlastní injected `url`
string včetně `""`; absent nebo non-string dependency selže fail-closed a
ambientní `C3_WEBHOOK_URL` fallback nikdy neexistuje.

Existující 028 `C3_WEBHOOK_SECRET` capability zůstane jediným HMAC signerem.
Jeho `status()` a stejnojmenný leaf notification mapy musejí vrátit byte-for-byte
shodný exact `{configured,source}` a po startu se nemění. `C3_WEBHOOK_URL` je
samostatná private destination. `GET /api/notifications/channels` zůstává pouze
policy/registration seznamem.

Exact `GET /api/notifications/config` success má jeden top-level key `sources`.
Jeho value má právě výše uvedených dvanáct own keys a každý leaf právě dva keys:

```json
{"configured":false,"source":"ROOT_ENV_FILE"}
```

Extra/missing key, `null` source, masked fragment, readiness bool, channel
support nebo raw value jsou zakázané. `C3_DESKTOP_NOTIFICATIONS`,
`C3_TEST_EMAIL`, `C3_NTFY_URL`, `SMTP_URL` a `EMAIL_TO` v response nejsou.
Exact POST response je pre-parse
`410 {"ok":false,"code":"CREDENTIAL_SOURCE_READ_ONLY"}` bez DB/revision,
emitter/cache nebo runtime effectu.

Canonical root writer smí patchovat jen výše uvedených dvanáct notification
keys a exact four-key Setup owner přes oddělené owner sady. Třetí owner set je
scrub-only a obsahuje přesně `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`NTFY_SERVER`, `NTFY_TOPIC`, `EMAIL_FROM`, `SMTP_URL`, `EMAIL_TO` a
`C3_NTFY_URL`: tyto aliases nikdy nevytváří ani nemění, pouze exact smaže po
verified action/readbacku. Writer zachová foreign bytes, odmítne duplicate
owned/multiline/invalid value a používá safe atomic mode-0600/no-follow
publication a readback. Nikdy nezapisuje feature opt-iny.

## 5. Census, transfer/export/purge a exact scrub

Migrační command je lokální CLI, ne server route. Read-only census smí běžet za
provozu; apply nezačne bez explicitní attestace, že server i workers jsou
zastavené. Census inventarizuje všechny exact sources a vydá jeden redigovaný
non-secret digest-bound manifest všech source actions bez hodnot. Každá nalezená
položka má source ID, exact path/key, SHA-256 value digest, classification a
jednu operátorem zvolenou akci `TRANSFER|EXPORT|PURGE`; operátor potvrzuje celý
manifest, ne jednotlivé řádky znovu. Absence volby blokuje apply a `PURGE` není
automatický default.

Source census zahrnuje:

- live `user_settings` document s neprefixovým exact setem: top-level
  `webhookSecret`; literal top-level `c3.notif.webhookSecret`; devět retired
  typed cest `c3.notif.emailEnabled`, `c3.notif.smtpHost`,
  `c3.notif.smtpPort`, `c3.notif.smtpUser`, `c3.notif.smtpPass`,
  `c3.notif.smtpFrom`, `c3.notif.emailRecipient`,
  `c3.notif.emailOnLifecycle`, `c3.notif.emailOnWorker`; a deset nested cest
  `notifications.emailAddresses`, `notifications.telegramToken`,
  `notifications.telegramChatId`, `notifications.slackWebhook`,
  `notifications.slackChannel`, `notifications.discordWebhook`,
  `notifications.webhookUrl`, `notifications.smsApiKey`,
  `notifications.smsSecret`, `notifications.smsPhone`;
- `<configured-dataDir>/c3-setup.json` s exact cestami
  `notifications.telegram.token`, `notifications.telegram.chatId`,
  `notifications.email.smtp`, `notifications.email.from`,
  `notifications.email.to`, `notifications.ntfy.topic` a
  `notifications.ntfy.server`; `.enabled` a unknown siblings nejsou scrub
  target;
- legacy `<configured-dataDir>/.env`, canonical root `.env` a každý historický
  cwd `.env` dodaný operátorem jako explicitní absolutní path; dnešní CLI cwd
  nesmí být heuristika. Files se deduplikují podle identity, ne jen názvu;
- direct legacy aliases `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NTFY_SERVER`,
  `NTFY_TOPIC`, `EMAIL_FROM` a DB/setup direct mappings;
- unmappable `SMTP_URL`, `EMAIL_TO` a `C3_NTFY_URL`, které smějí pouze
  `EXPORT|PURGE`, nikdy silent transfer/rename; census zahrne i jejich own
  process-environment presence včetně empty hodnoty;
- offline `PAIASS_SETTINGS` input podle §6.

Přímé nekolidující string mapování může plán doporučit jako `TRANSFER`.
Unsupported, unmappable a non-string hodnotu doporučí jako `EXPORT`; nikdy ji
implicitně nekoerzuje. Numeric `smtpPort` lze transferovat pouze tehdy, když
operátor do téhož manifestu vloží explicitní canonical decimal-string hodnotu
a její digest. Jinak smí jen `EXPORT|PURGE`.

DB scrub nikdy nepoužije prefix `c3.notif.*`. Exact důkaz musí vedle odstranění
výše vyjmenovaných cest připnout zachování safe generic preferences
`c3.notif.desktopEnabled`, `c3.notif.quietEnabled`, `c3.notif.quietFrom` a
`c3.notif.quietTo` i unknown dat. Setup `notifications.email.smtp` a
`notifications.email.to` odpovídají unmappable `SMTP_URL` a `EMAIL_TO`, takže
smějí jen do `EXPORT|PURGE`; direct transfer je zakázaný.
Nový/default Setup po úspěšné migraci nesmí žádný credential ani destination
leaf znovu vytvořit. Zachová `.enabled` a unknown siblings; legacy hodnoty před
jejich zvolenou akcí zůstávají. Úspěšný JSON scrub zachovává unknown hodnoty
sémanticky, nikoli původní whitespace nebo byte layout. Exact byte preservation
platí pro no-mutation failure a nedotčené env lines/files.
Own process alias CLI samo scrubnout neumí: po explicitním export/purge plánu
musí nový restart prokázat jeho absenci. Do té doby stage zůstává blokovaný a
nesmí smazat shodnou legacy kopii ani tvrdit completed scrub.

`TRANSFER` je povolen pouze do retained canonical key s jednoznačným mapováním.
Own process source má prioritu i prázdný; mismatch nebo empty shadow blokuje
scrub. File target musí být absent nebo exact-equal. Writer po publication znovu
použije canonical reader a ověří value digest, source, permissions a identity
před změnou legacy source.

`EXPORT` vyžaduje nový explicitní absolutní path. Command odmítne relative,
existing, symlink, foreign directory/owner a vytvoří exclusive/no-follow regular
single-link mode-0600 artifact, fsyncne file i directory a znovu ověří bytes a
digest. Export nesmí obsahovat unknown data nad exact zvoleným source/path
setem. `PURGE` vyžaduje explicitní source/path/value digest confirmation.

DB scrub běží v caller-owned `BEGIN IMMEDIATE`, ověří expected revision,
preimage a každý path digest před první mutací, smaže jen exact known selected
paths, zachová unknown keys a inkrementuje revision jednou. Updater/serialization
nebo SQLite write failure rollbackne celý blob i revision. Setup/env cleanup
ověří preimage/path digest těsně před safe atomic rewrite. Conflict/stale/failure
neprovádí partial scrub. Retry stejného completed planu je no-op success; změněný
source vyžaduje nový census a operátorskou volbu.

Nástroj netvrdí transakci napříč filesystémy a SQLite. Recovery je staged
roll-forward: nikdy neobnovuje secret do legacy source. Report pravdivě uvede
každý dokončený a zbývající stage. Logical live row a nově vytvořený export jsou
v scope; SQLite freepages/WAL, historické backupy a Git historie zůstávají
M5-DATA/privacy residual.

## 6. Offline localStorage receipt a automatic-email retirement

Architect pracuje pouze s legacy key `paiass_settings`; `c3-settings` není
credential blob. Raw offline input musí obsahovat exact UTF-8 preimage JSON
bytes a CLI jej přijme jen jako explicitní absolutní regular owner-owned
single-link mode-0600/no-follow file. Raw value nikdy nevstoupí do
HTTP/WS/loopback API ani URL, logu, clipboardu či in-app raw downloadu.

Sensitive paths jsou přesně:

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

CLI pro `EXPORT` nejdřív ověří nový mode-0600 artifact podle §5. Pro `PURGE`
vyžádá explicitní volbu. Potom vytvoří non-secret receipt schema
`INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V1` s exact source
`PAIASS_SETTINGS`, `preimageSha256`, `postimageSha256`, sorted unique path IDs,
jednou společnou akcí `EXPORT|PURGE`, exact per-path SHA-256 digesty a při
exportu export SHA-256. Jeden V1 receipt nesmí míchat akce. Mixed plán použije
ordered EXPORT receipt a až nad jeho exact postimage následný PURGE receipt.
Receipt neobsahuje raw value, prefix ani suffix.

Architect receipt načte výhradně lokálním file inputem. Před první změnou ověří
schema, exact source, seřazení/unikátnost paths, současný preimage digest a
interní digest každé named path proti receipt-bound potvrzení. Potom z
`paiass_settings` odstraní jen uvedené known nested paths, zachová všechny
unknown/non-secret siblings a zapíše nový blob. Malformed JSON, extra/unknown
path, stale preimage, digest mismatch, storage write failure nebo neúplný export
zachová původní bytes a skončí fail-closed. Re-apply stejného receipt po
úspěšném scrub je idempotentní success jen nad exact `postimageSha256`; jakýkoli
jiný stav je stale failure. Žádný broad `localStorage.clear()`.

Zároveň se odstraní `updateNotificationUserSettings`, repository
`commitNotification`, `NotificationRouter.updateChannelConfig`,
`EmailChannel.updateConfig` a production konstrukce/injection/call seamy
`NotificationEmitter`. DB credential ani default-config recipient read přes
tento bridge nezůstane v živém notification call graphu. Explicitní
caller-supplied recipient v `AgentRunner` notify action i manual
`POST /api/notifications/test` a `POST /api/notifications/send` zůstává; email
channel smí zůstat retained/default-off právě pro tyto explicitní delivery
cesty. Jejich request destination se nesmí změnit na persisted/default config.

Release docs musejí bez eufemismu uvést: **automatické lifecycle/worker e-maily
generované `NotificationEmitter` bridgem po 026 nejsou v core 1.0
konfigurovatelné vůbec**. Explicitní `AgentRunner` notify akce s
caller-supplied recipientem i manual test/send s caller-supplied destination
zůstávají. `generic/settings/import` responses zůstávají redacted. Nevzniká
`EMAIL_TO`, `C3_TEST_EMAIL` ani jiný runtime recipient key. Tato omezená ztráta
configurability je záměrný důsledek přijatého in-app-only core scope, ne skrytý
regression PASS.

`notification_channels_v57.recipient/config`,
`notification_log_v57.recipient`,
`notification_digest_buffer_v57.recipient` a persisted agent notify/webhook
definitions se tímto WP globálně nemažou. Jsou explicitně reportované jako
M5-DATA nebo typed-agent residual a nesmějí být použité k tvrzení, že 026
odstranil každou private destination ze všech aplikačních dat a logů.

## 7. Source pořadí, focused důkaz a stop conditions

Exact source pořadí je:

1. Setup P0 subset podle §3 → focused gate → diff census/check → první commit a
   push; tento krok je hotový na `3bb35bbb32063dd058ab35872668d645fe9ff106`;
2. samostatný docs-only M1-CLOSEOUT-X1 allowlist amendment `G` jako sibling P0
   z `ea21bf3e2f8a54e1cbf93430cdb52037957a63c8` → nezávislý review → governance
   promotion → normální merge `G` do existující P0 branch bez rewrite;
3. canonical root reader/writer + immutable 12-key authority a exact status;
4. read-only census a explicitní transfer/export/purge apply stages;
5. DB/setup/env scrub a offline localStorage receipt apply;
6. HTTP/repository/runtime setter a automatic-emitter retirement;
7. source-only E2E compatibility, notifications docs, release note a Finding
   progress;
8. celý redukovaný gate, syntax/diff/hygiene, commit a push final `S`; potom je
   `S` immutable a jde do Review A.

P0 i mezilehlé source checkpointy zůstávají ancestry final subjectu a
samostatně se neintegrují. Governance `G` se naopak reviewuje a promuje
samostatně; po merge je base final Review A, nikoli součást range `G..S`.
Poslední source commit nesmí být report-only evidence. Report vznikne až v
`E_A`.

Existující top-level testy se rozšíří bez růstu počtů:

1. settings authority `4/4`: exact status/POST no-writer, DB expected-revision
   scrub jen explicitního legacy setu, zachování čtyř safe `c3.notif.*`
   preferences a unknowns a updater/serialization/SQLite failure s byteově
   shodným durable blobem a revision;
2. notification credential scope `2/2`: Setup P0 auth-before-parse/effect pro
   čtyři POSTy, already-complete no-effect, cwd-independent canonical writer,
   exact 12-key precedence/readback, transfer/export/purge conflicts a nulový
   runtime setter/emitter call graph;
3. Studio VM `128/128`: offline receipt success, stale/malformed/write-failure
   byte preservation, exact known-path deletion, unknown preservation,
   idempotence a nulový fetch/WS/loopback raw transport;
4. registry validator: stále 382 programů, 8 exclusions, fingerprint
   `571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71`.

Compatibility soubory smějí dostat mechanický source alignment/audit, ale
nepřidávají pátý program do tohoto subject gate. Network-free část smí běžet
jen pod již explicitně přijatým samostatným envelope; external části zůstávají
`NOT RUN / BLOCKED`.

`tests/e2e/12-notifications.e2e.js` se nespouští a v reportu zůstane explicitně
`NOT RUN / BLOCKED`. E2E13 Security, Electron/build, GPU, Ollama, externí síť,
skutečný outbound a full-product test se nespouštějí.

Zastavit dotčenou část a eskalovat při potřebě:

- měnit cestu mimo allowlist, schema/migraci, reset/import nebo 028 Security
  semantics;
- přidat, zeslabit nebo obejít auth guard, access boundary či trusted-local
  kontrakt; oprava uvnitř již schváleného guardu je povolená, změna hranice ne;
- rozšířit agents-disabled výjimku za exact notification config GET a inertní
  config POST; send/test/verify/channels behavior je capability boundary;
- povolit Setup dev-loopback auth bypass nebo efekt před strict token checkem;
- pokračovat po failed Setup P0 gate bez jeho commitu/pushe;
- automaticky vybrat vítěze source conflict, parse `SMTP_URL`, rename
  `C3_NTFY_URL` nebo vytvořit recipient/unsupported env key;
- scrubnout source bez exact verified target/export/purge evidence;
- odeslat raw localStorage přes HTTP/WS/loopback nebo smazat celý storage blob;
- produkčně importovat dormant `ntfy.js`, změnit support claim nebo spustit
  network effect;
- přidat test program, měnit registry/fingerprint, spustit zakázaný drahý gate
  nebo zamlčet `BLOCKED`, partial či residual stav.

## 8. Přesné ověření a evidence DAG

Po Setup P0 commitu a znovu nad final source `S` writer spustí pouze:

```bash
set -euo pipefail
node tests/m1-settings-notification-authority.test.js
node tests/m1-notification-credential-scope.test.js
node tests/m1-studio-client.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Syntax se ověří pouze nad změněnými JS soubory; nejde o další testovací program.
Před P0 commitem i final `S` musí writer udělat exact path census proti
allowlistu a prázdný `git status --porcelain=v1 --untracked-files=all` po
commitu. Review B zopakuje stejný redukovaný blok v disk-backed
`git clone --no-local` s blokovanou sítí. To není Electron ani full-product
evidence.

Evidence DAG je:

```text
ea21bf3e (společný rodič)
  |-- Setup P0 source commit 3bb35bbb (pushed, nepromovaný)
  `-- docs-only governance G
        -> nezávislý governance review a promotion
G + exact P0 branch
  -> normální merge commit bez rewrite (P0 SHA zůstává ancestor)
  -> další 026 source checkpointy
  -> immutable final subject S
  -> report-only E_A s nezávislým Review A G..S (writer != reviewer)
  -> --no-ff merge candidate C na aktuálním integration base
  -> disk-backed --no-local Review B
  -> report-only E_B
  -> integrátorská promotion
```

Run report poprvé vznikne v `E_A` a pinuje `integrationRef`, exact promoted
`baseRevision=G`, `subjectHead=S`, review range `G..S`, P0 commit, merge commit a
`reviewA.verdict`. Tím je `G` mimo source subject a exact P0 uvnitř jeho
ancestry. `E_B` je přímý potomek candidate a pouze doplní `candidateHead=C` a
`reviewB.verdict`; report nikdy neobsahuje SHA commitu, který jej právě zapisuje.
Candidate runtime strom se musí rovnat stromu `E_A` mimo report-only topologii.
PASS 026 neznamená Gate 1 PASS: 029, standalone `chats/`, M5-DATA residualy a
ostatní explicitní bloky zůstávají otevřené.
