# WP-M1-SECRET-STORAGE-AUTHORITY — verified env transfer a exact scrub

**Typ:** zapisující M1 credential/storage-authority WP · **Slot:** jediný writer
v izolovaném disk-backed worktree

**Rozhodnutí:**
[`026/A + X1`](../decisions/026-m1-secret-storage-authority.md)

**sourceEvidenceRevision:**
`0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** exact SHA aktivačního docs checkpointu obsahujícího tento WP
zapíše až unikátní run report; `sourceEvidenceRevision` není jeho náhrada

**Branch:** `wp/m1-secret-storage-authority-20260811`

**Worktree:** `/home/belphareon/worktrees/is-m1-secret-storage-authority`

**Stav:** `ACTIVE / IMPLEMENTATION_NOT_STARTED` — 025, 027 a 028 jsou
`PROMOTED / REVIEW A+B PASS`; 028 promotion tip a současný clean source evidence
je `0037d56a2fb63ae0c3a3863ce00b9083d838ba8b`. Finding 011 zůstává `OPEN`, Gate
1 `BLOCKED`; 029 nezačne před přijetím 026 candidate.

## 1. Uživatelský výsledek

Po dokončení budou retained notification credentials a private destinations
čtené pouze z own process environment nebo exact canonical
`<project-root>/.env`. Aplikace je nebude umět nastavit přes HTTP, WS, generic
settings, Setup ani runtime config setter. Status vrátí pouze configured/source
pro přesných dvanáct klíčů; raw, masked ani odvozenou hodnotu nevrátí.

Každá existující legacy hodnota dostane explicitní operátorskou akci
`TRANSFER`, `EXPORT` nebo `PURGE`. Exact source se scrubne až po ověřeném
canonical readbacku, verified mode-0600 exportu nebo explicitním purge.
Konflikt, stale source nebo nejednoznačné mapování skončí beze změny; unknown
data se zachovají.

První source commit uzavře Setup P0: čtyři efektové Setup POSTy dostanou strict
explicit admin-token auth, repeated `/api/setup/complete` skončí před efektem a
bounded writer přestane odvozovat target z cwd. Teprve po commitu, pushi a
focused ověření tohoto checkpointu smí writer začít zbytek 026. Celý WP má jeden
finální immutable subject `S` a společné Review A/B.

Raw legacy `localStorage['paiass_settings']` nikdy nepřejde přes HTTP, WS ani
nový loopback connector. Operátor použije offline file/receipt flow. Cena
přijatého úzkého core scope je výslovná: po retirementu emitteru a bez nového
recipient env key nebudou automatické lifecycle/worker e-maily v core 1.0
konfigurovatelné vůbec.

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
  retained-channel status;
- `src/setup/wizard.js` pouze pro první P0 checkpoint: canonical four-key
  bounded writer, strict explicit admin-token guard čtyř efektových POSTů,
  durable already-complete refusal a preservation legacy setup dat;
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
- `src/ui/architect/architect.html` a `src/ui/architect/architect.js` pouze pro
  offline input/receipt workflow nad exact `paiass_settings` paths; žádný raw
  network transport;
- existující `tests/m1-settings-notification-authority.test.js`,
  `tests/m1-notification-credential-scope.test.js` a
  `tests/m1-studio-client.test.js`, bez nového top-level programu a bez růstu
  jejich počtů `4`, `2`, `128`;
- `tests/e2e/12-notifications.e2e.js` pouze pro mechanický source-contract
  update; program zůstává `NOT RUN / BLOCKED`;
- `docs/NOTIFICATIONS.md` pro pravdivý runtime/API popis a
  `docs/CHANGELOG.md` jako release note s tvrdým automatic-email důsledkem;
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

**Zakázané:**

- všechny schema migrace, nová DB tabulka, keyring, encryption nebo nová
  dependency;
- `src/routes/security.js`, `src/notifications/channels/webhook.js`, decision/WP
  028 nebo jakákoli změna jeho exact Security response/status/signer/410
  semantics;
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
  clipboard automatiku nebo testovací network seam;
- full forensic wipe SQLite freepages/WAL/starých backupů nebo tvrzení o
  secret recovery; to patří M5-DATA;
- mobile, Electron source/build/journey, GPU, Ollama, externí síť, skutečný
  outbound channel nebo celý produktový test;
- `tests/registry.json`, nový testovací program, registry/baseline count bump,
  package/lockfile nebo generated build output;
- změna tohoto statického WP, decision 026, decision 028, `docs/wp/README.md`,
  `ROADMAP.md` nebo `SYSTEM-MAP.md` po aktivačním commitu. Source progress patří
  pouze do Findingu 011 a report-only evidence.

## 3. První checkpoint — Setup P0

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

### Povinné pořadí checkpointu

Writer nejdřív implementuje pouze P0 subset, rozšíří existující první
notification-scope případ, spustí níže uvedený redukovaný gate, udělá diff
census/check, vytvoří první source commit a pushne jeho branch. Až potom smí
otevřít ostatní allowlisted soubory. P0 se samostatně nepromuje; zůstává prvním
ancestor commitem jednoho finálního `S`.

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
nejsou enumerable, serializable ani veřejně dostupné. Root-file secret values
se nemusejí kopírovat do ambientního `process.env`; channel factories dostanou
injected snapshot.

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
keys a exact four-key Setup owner přes oddělené owner sady. Zachová foreign
bytes, odmítne duplicate owned/multiline/invalid value a používá safe atomic
mode-0600/no-follow publication a readback. Nikdy nezapisuje feature opt-iny.

## 5. Census, transfer/export/purge a exact scrub

Migrační command je lokální CLI, ne server route. Nejdřív read-only inventarizuje
všechny exact sources a vydá redigovaný plán bez hodnot. Každá nalezená položka
má source ID, exact path/key, SHA-256 value digest, classification a jednu
operátorem zvolenou akci `TRANSFER|EXPORT|PURGE`; absence volby blokuje apply.

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

DB scrub nikdy nepoužije prefix `c3.notif.*`. Exact důkaz musí vedle odstranění
výše vyjmenovaných cest připnout zachování safe generic preferences
`c3.notif.desktopEnabled`, `c3.notif.quietEnabled`, `c3.notif.quietFrom` a
`c3.notif.quietTo` i unknown dat. Setup `notifications.email.smtp` a
`notifications.email.to` odpovídají unmappable `SMTP_URL` a `EMAIL_TO`, takže
smějí jen do `EXPORT|PURGE`; direct transfer je zakázaný.
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

Nástroj netvrdí transakci napříč filesystémy a SQLite. Report pravdivě uvede
každý dokončený a zbývající stage. Logical live row a nově vytvořený export jsou
v scope; SQLite freepages/WAL, historické backupy a Git historie zůstávají
M5-DATA/privacy residual.

## 6. Offline localStorage receipt a automatic-email retirement

Architect pracuje pouze s legacy key `paiass_settings`; `c3-settings` není
credential blob. Raw offline input musí obsahovat exact preimage JSON bytes a
CLI jej přijme jen jako explicitní absolutní regular owner-owned single-link
mode-0600/no-follow file. Raw value nikdy nevstoupí do HTTP/WS/loopback API ani
logu.

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
`PAIASS_SETTINGS`, preimage SHA-256, sorted unique path IDs, akcí
`EXPORT|PURGE`, exact per-path SHA-256 digesty a při exportu export SHA-256.
Receipt neobsahuje raw value, prefix ani suffix.

Architect receipt načte výhradně lokálním file inputem. Před první změnou ověří
schema, exact source, seřazení/unikátnost paths, současný preimage digest a
interní digest každé named path proti receipt-bound potvrzení. Potom z
`paiass_settings` odstraní jen uvedené known nested paths, zachová všechny
unknown/non-secret siblings a zapíše nový blob. Malformed JSON, extra/unknown
path, stale preimage, digest mismatch, storage write failure nebo neúplný export
zachová původní bytes a skončí fail-closed. Re-apply stejného receipt po
úspěšném scrub je idempotentní success. Žádný broad `localStorage.clear()`.

Zároveň se odstraní `updateNotificationUserSettings`, repository
`commitNotification`, `NotificationRouter.updateChannelConfig`,
`EmailChannel.updateConfig` a production konstrukce/injection/call seamy
`NotificationEmitter`. DB credential ani private-recipient read nezůstane v
živém notification call graphu. Email channel smí zůstat retained/default-off
pro explicitní caller-supplied recipient.

Release docs musejí bez eufemismu uvést: **automatické lifecycle/worker e-maily
po 026 nejsou v core 1.0 konfigurovatelné vůbec**. Nevzniká `EMAIL_TO`,
`C3_TEST_EMAIL` ani jiný runtime recipient key. Tato ztráta configurability je
záměrný důsledek přijatého in-app-only core scope, ne skrytý regression PASS.

## 7. Source pořadí, focused důkaz a stop conditions

Exact source pořadí je:

1. Setup P0 subset podle §3 → focused gate → diff census/check → první commit a
   push;
2. canonical root reader/writer + immutable 12-key authority a exact status;
3. read-only census a explicitní transfer/export/purge apply stages;
4. DB/setup/env scrub a offline localStorage receipt apply;
5. HTTP/repository/runtime setter a automatic-emitter retirement;
6. source-only E2E compatibility, notifications docs, release note a Finding
   progress;
7. celý redukovaný gate, syntax/diff/hygiene, commit a push final `S`; potom je
   `S` immutable a jde do Review A.

P0 i mezilehlé checkpointy zůstávají ancestry final subjectu a samostatně se
neintegrují. Poslední source commit nesmí být report-only evidence. Report
vznikne až v `E_A`.

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

`tests/e2e/12-notifications.e2e.js` se nespouští a v reportu zůstane explicitně
`NOT RUN / BLOCKED`. E2E13 Security, Electron/build, GPU, Ollama, externí síť,
skutečný outbound a full-product test se nespouštějí.

Zastavit dotčenou část a eskalovat při potřebě:

- měnit cestu mimo allowlist, schema/migraci, reset/import nebo 028 Security
  semantics;
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
Setup P0 source commit (první ancestor, pushed, nepromovaný)
  -> další 026 source checkpointy
  -> immutable final subject S
  -> report-only E_A s Review A
  -> --no-ff merge candidate C na aktuálním integration base
  -> disk-backed --no-local Review B
  -> report-only E_B
  -> integrátorská promotion
```

Run report poprvé vznikne v `E_A` a pinuje `integrationRef`, exact
`baseRevision`, `subjectHead=S`, P0 commit a `reviewA.verdict`. `E_B` je přímý
potomek candidate a pouze doplní `candidateHead=C` a `reviewB.verdict`; report
nikdy neobsahuje SHA commitu, který jej právě zapisuje. Candidate runtime strom
se musí rovnat stromu `E_A` mimo report-only topologii. PASS 026 neznamená Gate
1 PASS: 029, standalone `chats/`, M5-DATA residualy a ostatní explicitní bloky
zůstávají otevřené.
