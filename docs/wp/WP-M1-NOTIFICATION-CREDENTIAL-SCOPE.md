# WP-M1-NOTIFICATION-CREDENTIAL-SCOPE — pravdivý core 1.0 notification surface

**Typ:** zapisující M1 capability/security-boundary WP · **Slot:** jediný writer
v izolovaném disk-backed worktree

**Rozhodnutí:**
[`027/A`](../decisions/027-m1-notification-credential-scope.md)

**sourceEvidenceRevision:**
`0322d468563875ecfd588ad6938c86bc7a7f80ed`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** exact SHA aktivačního docs checkpointu obsahujícího tento WP
zapíše až unikátní run report; `sourceEvidenceRevision` není jeho náhrada

**Branch:** `wp/m1-notification-credential-scope-20260811`

**Worktree:** `/home/belphareon/worktrees/is-m1-notification-credential-scope`

**Stav:** `ACTIVE / IMPLEMENTATION_NOT_STARTED` — 025 je
`PROMOTED / REVIEW A+B PASS` na `0322d468563875ecfd588ad6938c86bc7a7f80ed`.
Finding 011 zůstává `OPEN`, Gate 1 `BLOCKED`; 028/026/029 nezačnou před
přijetím 027 candidate.

## 1. Uživatelský výsledek

Po dokončení bude core 1.0 pravdivě podporovat pouze in-app notifications.
Email, Telegram, ntfy/push, webhook a desktop zůstanou v kódu jako retained
kandidáti bez support claimu. Bez explicitního exact env opt-inu se externí
channel ani nezaregistruje, ani neprovede effect. Slack, Discord a SMS zůstanou
`UNSUPPORTED` a nebudou mít aktivní produktový input.

WS klient pak nebude moci injektovat SMTP ani jiné
credential/private-destination hodnoty do živého runtime. `sync_settings` bude
atomický exact-allowlist connector pouze pro sedm boolean feature flags. Setup
ani UI nebudou přijímat nové notification credentials a existující legacy
hodnoty zůstanou beze změny pro následný ověřený transfer/scrub v 026.

## 2. Povolené a zakázané cesty

**Povolené runtime/source cesty:**

- `.env.example` pouze pro pět přesných default-off opt-inů;
- `src/core/feature-manager.js` pouze pro exact sedmiklíčovou boolean WS
  hranici;
- nový `src/notifications/channel-policy.js` jako jediný parser a policy seam;
- `src/notifications/index.js`, `src/notifications/service.js` a
  `src/notifications/e2e-verify.js` pouze pro registration/effect enforcement;
- `src/server.js` a `scripts/start-workers.js` pouze pro fail-fast bootstrap a
  channel construction/registration cutover;
- `src/ws-bridge/session-adapter.js` pouze pro retirement SMTP injection a
  atomický feature-only `sync_settings`;
- `src/setup/wizard.js` pouze pro retirement notification input/writeru,
  zachování legacy dat a bezpečný exact non-notification env patch/create;
- autoritativní chat-panel runtime
  `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` pouze v
  notification settings surface, nikoli Security webhook UI;
- `c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js`;
- přesně tři stale settings zdroje
  `c3-ide/extensions/c3-settings/src/browser/settings-module.ts`,
  `c3-ide/extensions/c3-settings/src/browser/settings-contribution.ts` a
  `c3-ide/extensions/c3-settings/src/common/settings-protocol.ts`;
- `src/ui/architect/architect.html` a `src/ui/architect/architect.js` pouze pro
  retirement zavádějících external credential/effect controls;
- nový `tests/m1-notification-credential-scope.test.js`, pouze nutné
  kompatibilitní úpravy `tests/ws-bridge.test.js` a
  `tests/m1-studio-client.test.js`, registrace nového programu v
  `tests/registry.json`, mechanicky generovaný
  `docs/convergence/TEST-REGISTRY.md` a pouze mechanický count v `README.md`;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` jako
  jediný source-progress dokument;
- unikátní
  `docs/execution/runs/wp-m1-notification-credential-scope-20260811-report.md`
  smí poprvé vzniknout až v report-only `E_A` po Review A.

`src/notifications/feedback.js` je `DORMANT-NOT-ACTIVE-EFFECT-PATH`.
`src/notifications/channels/ntfy.js` je samostatně
`DORMANT-NOT-REGISTERED-NOT-COVERED`: obsahuje network-capable channel/factory,
ale přijatý source jej nikde produkčně neimportuje. Ani jedna cesta se v tomto
WP nemění nebo nevydává za pokrytou produkční cestu.

**Zakázané:**

- všechny `src/db/**`, migrace a jakákoli změna 025 settings authority;
- credential setter/read semantics v `src/routes/notifications.js`; patří 026;
- `src/routes/security.js` a Security webhook regenerate UI v chat panelu;
  patří 028;
- portable backup/import profil, reset nebo factory-delete semantics; patří
  029, případně secret recovery 026;
- secret transfer, scrub/delete, localStorage purge, credential/root-env merge
  autorita nebo změna priority process-env/root-env; patří 026. Výjimkou je
  pouze níže přesně omezený patch čtyř non-notification setup-owned klíčů,
  který všechny ostatní řádky zachová byteově;
- implementace Slacku, Discordu nebo SMS;
- mobile, Electron build/journey, GPU, Ollama, externí síť a outbound journey;
- nová závislost, build output a archivní/stale TypeScript mimo tři exact
  `c3-settings` cesty v allowlistu;
- nový testovací program nad limit níže nebo paralelní per-channel suite;
- změna tohoto statického WP, decision 027, `docs/wp/README.md`, `ROADMAP.md`
  nebo `SYSTEM-MAP.md` po aktivačním commitu; promotion status vlastní
  integrátor a report-only evidence.

## 3. Channel policy a opt-in kontrakt

Jediný source of truth je nový pure `channel-policy.js`. Vlastní přesnou mapu:

```text
email     <- C3_ENABLE_NOTIFICATION_EMAIL
telegram  <- C3_ENABLE_NOTIFICATION_TELEGRAM
push/ntfy <- C3_ENABLE_NOTIFICATION_PUSH
webhook   <- C3_ENABLE_NOTIFICATION_WEBHOOK
desktop   <- C3_ENABLE_NOTIFICATION_DESKTOP
```

`push` je jméno registrovaného channelu a `ntfy` je legacy jméno přímo
spustitelného verifieru stejné ntfy capability; oba proto sdílejí jediný
`C3_ENABLE_NOTIFICATION_PUSH` opt-in, nikoli dvě nezávislé autority. Dormant
`src/notifications/channels/ntfy.js` tím není aktivován ani pokryt.

Pouze literal string `"true"` zapíná capability. Unset a literal `"false"`
jsou OFF. Každá jiná definovaná hodnota je typovaná bootstrap chyba. Parser
nejdřív validuje celou pětici a teprve potom smí vzniknout router, channel,
server listener, worker nebo jiný notification effect seam; partial registrace
není přípustná.

Registration gate není jediná obrana. `NotificationRouter.send()`, test-channel
a přímo spustitelný `e2e-verify.js` musí před outbound effectem ověřit tutéž
policy. Disabled nebo neznámý externí channel končí typovaně bez fallbacku na
jiný externí channel. `in_app` zůstává lokální DB-only core cesta a žádný env
opt-in nepotřebuje.

Exact `"true"` pouze dovolí registration/effect cestu retained kandidáta.
Nevytváří credential autoritu, delivery proof ani support claim. Skutečný
outbound test vyžaduje samostatný explicitní operátorský journey a v 027 se
nespouští.

## 4. WS, Setup a UI kontrakt

`sync_settings` přijímá plain object obsahující pouze boolean hodnoty pod
přesně těmito sedmi klíči:

```text
c3.features.agents
c3.features.lifecycle
c3.features.expertises
c3.features.telemetry
c3.features.specialistTelemetry
c3.features.autonomy
c3.features.skills
```

Payload musí být neprázdný a každý own key i value se ověří před první
mutací. Unknown, inherited, mixed feature+credential nebo non-boolean payload
se odmítne atomicky: `changed=0`, feature stav beze změny, žádné
`updateChannelConfig`, cache invalidace ani jiný effect. Error response a log
smí obsahovat stabilní code, nikdy raw klíč/value payload nebo secret echo.

Setup hranice je containment před 026:

- `POST /api/setup/notifications` vrací stabilní `410` před `parseBody()` a
  nemění `wizard.config` ani filesystem;
- interactive CLI se na notifications neptá a nikdy nevytváří ani
  nepřepisuje legacy `data/.env`; při dokončení používá stejný bounded cwd
  `.env` patch jako HTTP cesta, takže Ollama/language schopnosti zůstávají;
- existující notification subdocument v `c3-setup.json` se při load/save
  zachová pro 026; 027 jej nescrubuje ani normalizací nemaže;
- CLI i HTTP setup complete smějí v existujícím cwd `.env` atomicky patchnout
  pouze exact setup-owned non-notification klíče `OLLAMA_URL`, `C3_LANG`,
  `C3_DB_PATH` a `C3_LICENSE_KEY`; notification a cizí řádky zachovají byteově
  a jejich hodnoty nevracejí ani nelogují;
- symlink, non-regular/foreign/multi-link target, duplicitní owned key nebo
  newline v nové hodnotě skončí typovaně bez změny; regular owned target se
  přepíše přes same-directory exclusive/no-follow temp, fsync a atomický
  replace se zachováním bezpečných metadat;
- absent target smí vzniknout exclusive/no-follow jako owner-only mode `0600`,
  pouze z těchto non-notification setup-owned hodnot; notification keys/values
  ani newline-injection se do něj nedostanou;
- nejde o canonical root-env autoritu ani transfer. DB, localStorage,
  `c3-setup.json`, historický `data/.env` a cwd `.env` se nemažou ani
  nepřenášejí.

Notification settings v autoritativním chat panelu, Center Views, Architect a
stale `c3-settings` přestanou nabízet externí channel toggle,
credential/private-destination input, test-send nebo falešný active status.
Mohou pravdivě zobrazit in-app jako jediný core 1.0 support a retained externí
kandidáty jako neovládanou operátorskou konfiguraci bez delivery claimu.
Chat-panel Security sekce `Webhook Secret` včetně regenerate akce se nemění;
její retirement je výhradně 028.

## 5. Source revision, závislosti a pořadí

- source evidence je promotion tip 025
  `0322d468563875ecfd588ad6938c86bc7a7f80ed`;
- writer vychází až z clean, upstream-synchronního aktivačního commitu na
  `integration/m1-consolidated-20260810`; jeho full SHA je `baseRevision`;
- branch je `wp/m1-notification-credential-scope-20260811`, disk-backed
  worktree `/home/belphareon/worktrees/is-m1-notification-credential-scope`;
- 025 je přijatá závislost: base `55d32e14876964863b573bfd4b18086aaa46768d`,
  subject `4f7f57422c525cc16d6cdffea41fc41d0df25001`, candidate
  `901bb6bad8db31304468c74391c93019f13f5a1e`, Review A+B `PASS`, promotion
  `0322d468563875ecfd588ad6938c86bc7a7f80ed`;
- implementační pořadí uvnitř subjectu je pure policy + bootstrap gate →
  všechny registration/effect seamy → WS/Setup containment → UI retirement
  → přesná evidence/registry;
- subject `S` je po Review A immutable. Následují pouze report-only evidence,
  merge candidate a Review B; 028 nezačíná před přijetím candidate.

## 6. Focused pozitivní a negativní důkaz

Nový `tests/m1-notification-credential-scope.test.js` má přesně dva
top-level logické testy:

1. table-driven channel/startup/setup matice: in-app je dostupný bez opt-inu;
   každý z pěti external flags je default-off, exact `"true"` dovolí jen svůj
   channel, `"false"` jej nechá vypnutý a invalidní hodnota zastaví bootstrap
   před konstrukcí/registrací/effectem; router/test/e2e direct bypass selže
   bez network callu. Setup notification route je `410` pre-parse, CLI
   nevytvoří `data/.env`; CLI i HTTP existing-env varianta změní pouze čtyři
   exact non-notification setup keys a zachová všechny ostatní řádky byteově,
   absent cwd target vznikne exclusive/no-follow mode-0600 bez notification
   hodnot;
2. WS/UI boundary: všech sedm exact boolean feature klíčů projde, zatímco
   unknown, credential, mixed a non-boolean payload skončí atomicky bez echo a
   effectu. Source fixtures přesně pinují odstranění zavádějících external
   controls ze čtyř UI ploch a současně zachování chat Security webhook UI
   pro 028.

Kompatibilitně se spustí existující `tests/ws-bridge.test.js` a
`tests/m1-studio-client.test.js`. Čtvrtým a posledním programem je
`node scripts/validate-test-registry.js --json`. Testy použijí fake
constructors/effect adapters a temp filesystem; nesmějí otevřít externí síť.
Žádný pátý program, per-channel suite, Electron, GPU nebo Ollama běh.

## 7. Stop condition a eskalace

Zastavit dotčenou část při potřebě:

- měnit DB, migraci, settings v2/CAS, portable backup nebo reset;
- definovat credential read/set/rotate, canonical root-env priority, merge,
  transfer, scrub, purge nebo localStorage cleanup;
- měnit webhook secret route nebo Security regenerate UI;
- implementovat Slack/Discord/SMS nebo tvrdit podporu retained external
  channelu bez outbound journey;
- povolit invalidní env hodnotu, partial registraci nebo effect bez policy
  checku;
- měnit existující env target jinak než exact čtyřklíčovým non-notification
  patchem nebo bezpečně neprokázat zachování ostatních řádků či
  exclusive/no-follow mode-0600 absent create;
- produkčně importovat či registrovat dormant
  `src/notifications/channels/ntfy.js`;
- přidat závislost, síťový test, pátý program, mobile, Electron nebo
  změnit cestu mimo allowlist.

Vada mimo allowlist se zapíše jako `FINDING` a neopraví se potají. Test se
při nálezu nemaže ani neoslabí. Finding 011 zůstává `OPEN` a Gate 1
`BLOCKED` i po úspěšném 027; zavření vyžaduje zbytek 028 → 026 → 029 a
ostatní explicitní residualy.

## 8. Přesné ověření a evidence DAG

Writer spouští pouze tyto čtyři programy a levné statické kontroly:

```bash
set -euo pipefail
node tests/m1-notification-credential-scope.test.js
node tests/ws-bridge.test.js
node tests/m1-studio-client.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Syntax se ověří pouze nad změněnými JS soubory; nejde o další testovací
program. Immutable `S` i Review B vyžadují prázdný
`git status --porcelain=v1 --untracked-files=all`. Review B zopakuje stejný
redukovaný blok v disk-backed `git clone --no-local`. Network je blokovaný;
Electron/build, GPU, Ollama, outbound journey a celý produktový test sem
nepatří.

Evidence DAG je:

```text
subject S
  -> report-only E_A s Review A
  -> --no-ff merge candidate C na aktuálním integration base
  -> disk-backed --no-local Review B
  -> report-only E_B
  -> integrátorská promotion
```

Run report vznikne poprvé v `E_A` a pinuje `integrationRef`, exact
`baseRevision`, `subjectHead=S` a `reviewA.verdict`. `E_B` je přímý potomek
candidate a pouze doplní `candidateHead=C` a `reviewB.verdict`; report nikdy
neobsahuje SHA commitu, který jej právě zapisuje. `S`, `E_A`, `C` i `E_B` jsou
samostatně dohledatelné a runtime strom candidate se musí rovnat stromu
`E_A` mimo report-only topologii. PASS 027 neznamená Gate 1 PASS.
