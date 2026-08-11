# WP-M1-WEBHOOK-SECRET-SEMANTICS — jediná pravdivá webhook HMAC autorita

**Typ:** zapisující M1 credential/runtime-authority WP · **Slot:** jediný writer
v izolovaném disk-backed worktree

**Rozhodnutí:**
[`028/A`](../decisions/028-m1-webhook-secret-semantics.md)

**sourceEvidenceRevision:**
`f19135871f148f69fcc9451307e87c34c1abfcbb`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** exact SHA aktivačního docs checkpointu obsahujícího tento WP
zapíše až unikátní run report; `sourceEvidenceRevision` není jeho náhrada

**Branch:** `wp/m1-webhook-secret-semantics-20260811`

**Worktree:** `/home/belphareon/worktrees/is-m1-webhook-secret-semantics`

**Stav:** `ACTIVE / IMPLEMENTATION_NOT_STARTED` — 027 je
`PROMOTED / REVIEW A+B PASS` na
`f19135871f148f69fcc9451307e87c34c1abfcbb`. Finding 011 zůstává `OPEN`, Gate 1
`BLOCKED`; 026 ani 029 nezačnou před přijetím 028 candidate.

## 1. Uživatelský výsledek

Po dokončení bude webhook HMAC secret výhradně operator-owned environment
hodnota. Authenticated Security status i skutečný HMAC signer použijí jedinou
immutable startup autoritu a budou pravdivě shodné. Status vrátí pouze boolean
`configured` a přesný source `PROCESS_ENV` nebo `ROOT_ENV_FILE`; nikdy nevrátí
secret, maskovaný fragment, prefix ani suffix.

Dnešní nefunkční aplikační generator skončí stabilním authenticated
`410 CREDENTIAL_SOURCE_READ_ONLY` před čtením body, DB zápisem, random generací
nebo runtime efektem. Autoritativní Studio Security panel přestane nabízet
regenerate akci a zobrazí pouze read-only source, configured stav a požadavek na
restart po operátorské změně.

WP nevytváří support claim pro retained webhook channel a nespouští skutečný
outbound webhook. Historická DB hodnota se zachová a ignoruje pro následný 026
verified transfer/exact scrub; 028 nevytváří env writer ani secret recovery.

## 2. Povolené a zakázané cesty

**Povolené runtime/source cesty:**

- `.env.example` pouze pro bezpečný mode-0600 creation návod a prázdnou
  dokumentaci `C3_WEBHOOK_SECRET`; žádný skutečný secret;
- nový `src/security/webhook-secret-authority.js` jako pure/synchronous safe
  root reader, provenance klasifikátor a frozen capability seam;
- `src/runtime-environment.js` pouze pro nahrazení implicitního `dotenv/config`
  explicitním exact-root loadem, pre-load capture a export jediného startup
  authority objektu;
- `src/server.js` pouze pro injection stejné authority do Security routes a
  notification pipeline před DB/listener/port-file/effect hranicí;
- `scripts/start-workers.js` pouze pro import téhož runtime bootstrapu a
  injection stejné authority před DB konstrukcí a notification channel
  konstrukcí;
- `src/notifications/index.js` pouze pro předání authority do default webhook
  factory; ostatní channel policy a factories se nemění;
- `src/notifications/channels/webhook.js` pouze pro odstranění raw
  `options.secret` a ambientního `process.env.C3_WEBHOOK_SECRET` fallbacku a
  použití injected authority při podpisu;
- `src/routes/security.js` pouze pro exact authenticated GET projection a
  authenticated pre-parse POST `410` bez DB/random/mask seamů;
- `src/db/user-settings.js` pouze pro odstranění produkčního
  `commitWebhookSecret`; legacy bytes, čtení, redakce, revision i ostatní
  repository metody se zachovají;
- autoritativní runtime
  `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js` pouze v
  Security `Webhook Secret` sub-surface;
- existující `tests/m1-settings-notification-authority.test.js`,
  `tests/m1-notification-credential-scope.test.js` a
  `tests/m1-studio-client.test.js` v přesném redukovaném programu níže;
- `tests/e2e/13-security.e2e.js` pouze pro mechanickou kompatibilitní změnu
  očekávání POST na `410`; program zůstává `BLOCKED / NOT RUN` a není součástí
  focused evidence;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` jako jediný
  source-progress dokument;
- unikátní
  `docs/execution/runs/wp-m1-webhook-secret-semantics-20260811-report.md` smí
  poprvé vzniknout až v report-only `E_A` po Review A.

`GET /api/notifications/channels` v `src/routes/notifications.js` je
`POLICY-REGISTRATION-STATUS-ONLY-NOT-CREDENTIAL-STATUS`. Jeho dnešní
`configured` znamená registraci kanálu po 027 policy opt-inu; secret nečte a
nesmí být použit jako credential readiness evidence. V 028 se tato route ani
její response nemění. Jediným veřejným webhook credential statusem je
auth-guarded Security GET.

**Zakázané:**

- všechny migrace, nová tabulka, jiný DB secret store nebo schema změna;
- jakýkoli DB scrub/delete/transfer, env writer, setup writer, localStorage
  purge, export, import nebo recovery command;
- `src/routes/notifications.js`, WS `sync_settings`, Setup, notification config
  setter/read semantics nebo channel support policy;
- portable backup/import, `/api/reset`, factory-delete nebo standalone `chats/`
  semantics;
- změna `C3_WEBHOOK_URL`, recipient/private-destination autority, retry nebo
  outbound policy;
- raw secret injection, alternativní `options.secret`, runtime setter, rotate,
  clear, hot reload, one-time return nebo post-commit rollback/degraded větev;
- source enum `null`, unknown source hodnota, maskování, prefix/suffix nebo
  jakákoli další public response property;
- jiný Studio/Center Views/Architect/stale TypeScript povrch, mobile, Electron
  source/build/output nebo grafické úpravy;
- `tests/registry.json`, nový testovací program, nová per-secret suite, nová
  dependency nebo mechanická registry/baseline změna;
- skutečný webhook, externí síť, Electron journey, GPU, Ollama nebo celý
  produktový test;
- změna tohoto statického WP, decision 028, decision 027, `docs/wp/README.md`,
  `ROADMAP.md` nebo `SYSTEM-MAP.md` po aktivačním commitu; source progress patří
  jen do Findingu 011 a report-only evidence.

## 3. Vlastněný connector a provenance kontrakt

Aktivovaný kontrakt je:

```text
028-env-read-substrate: READ-ONLY-SUBSET-OF-ACCEPTED-026A
028-root-identity: EXACT-PROJECT-ROOT-DOTENV-INDEPENDENT-OF-CWD
028-root-source: SAFE-REGULAR-OWNER-OWNED-MODE-0600-NO-SYMLINK-TRAVERSAL
028-process-precedence: OWN-PRE-DOTENV-C3_WEBHOOK_SECRET-FIRST-EVEN-EMPTY
028-read-source: ALWAYS-PROCESS_ENV-IF-PRELOAD-OWN-ELSE-ROOT_ENV_FILE
028-configured: SELECTED-VALUE-LENGTH-GREATER-THAN-ZERO
028-authority-snapshot: ONE-IMMUTABLE-STARTUP-SNAPSHOT-SHARED-BY-STATUS-AND-SIGNER
028-notification-channel-list: POLICY-REGISTRATION-STATUS-ONLY-NOT-CREDENTIAL-STATUS
028-env-write-transfer-scrub: NONE-PENDING-026
028-legacy-db: PRESERVE-IGNORE-NO-NEW-WRITES-PENDING-026-EXACT-SCRUB
```

`projectRoot` je exact současný root
`path.resolve(dirname(fileURLToPath(import.meta.url)), '..')` z
`runtime-environment.js`; jediný file source je
`path.join(projectRoot, '.env')`. Loader nesmí použít `cwd`, implicitní dotenv
discovery ani `DOTENV_CONFIG_PATH`. Před file loadem zachytí
`Object.hasOwn(process.env, 'C3_WEBHOOK_SECRET')` i tehdejší hodnotu. Ostatní
dotenv keys načte z exact root souboru s dosavadní no-override prioritou process
environmentu; 028 nesmí měnit nesouvisející runtime env hodnoty.

Absent root file je validní. Existující file se před použitím otevře bez
symlink traversal a ověří jako regular, owner-owned a exact mode `0600`; identity
se po open znovu porovná. Unsafe nebo během čtení zaměněný target skončí
typovaně bez secret/path-value echo a před SQLite, logger outputem, server
listenerem, port-file writerem nebo notification konstrukcí/effectem. Tento WP
soubor pouze bezpečně čte; creation, patch, transfer, readback a scrub patří 026.

Výběr je přesný:

- pokud pre-load process env obsahovalo own `C3_WEBHOOK_SECRET`, selected value
  je právě tato hodnota a source je vždy `PROCESS_ENV`, i když je hodnota `""`;
- jinak selected value pochází pouze z parsed exact root file a source je vždy
  `ROOT_ENV_FILE`, i když soubor/key chybí nebo je hodnota `""`;
- `configured=true` právě tehdy, když je selected value string s
  `length > 0`; source není nikdy `null`.

Autorita je jeden frozen capability objekt. Veřejně zpřístupní jen frozen safe
status a signing operaci; raw selected value zůstane v privátní closure a nesmí
být enumerable, serializable, logovaná ani vrácená callerovi. Status route a
default webhook factory dostanou tentýž objekt. `WebhookChannel` nesmí přijmout
raw secret ani číst ambientní process env/file/DB. Změna process env nebo file
po konstrukci nemění status ani HMAC; změna se projeví pouze novým procesem a
novým snapshotem.

Auth guard Security routy zůstává. Exact GET success je pouze:

```json
{"configured":true,"source":"PROCESS_ENV"}
```

Boolean a source se samozřejmě řídí výše uvedenou maticí, ale response nemá
žádný třetí key. Exact authenticated POST odpověď je:

```json
{"ok":false,"code":"CREDENTIAL_SOURCE_READ_ONLY"}
```

se statusem `410`, před body parse/read, random generací, repository konstrukcí,
DB/revision změnou nebo runtime aktivací. Neautorizovaný request dál skončí
existujícím auth guardem a nesmí získat status ani source.

Studio Security sub-surface validuje přesný dvouklíčový GET contract. Zobrazí
configured ano/ne, přesný lidsky čitelný source a restart-required instrukci.
Odstraní masked fragment i `Regenerovat`/POST akci. Non-2xx, malformed JSON,
extra/missing key nebo unknown source se zobrazí fail-closed bez falešného
configured stavu a bez mutation retry.

## 4. Source revision, závislosti a pořadí

- source evidence je promotion tip 027
  `f19135871f148f69fcc9451307e87c34c1abfcbb`;
- 027 evidence: base `89de69202b7ed72937400a40ce0fbb91475aa926`,
  immutable subject `0ed3c0edf292acf8456e4dbc6bf0bb99ee01a2aa`, candidate
  `56a00c09ae66b4ebba0eedde81b53fafb816cefa`, Review A+B `PASS`;
- writer vychází až z clean, upstream-synchronního aktivačního docs commitu na
  `integration/m1-consolidated-20260810`; jeho full SHA je `baseRevision`;
- branch je `wp/m1-webhook-secret-semantics-20260811`, disk-backed worktree
  `/home/belphareon/worktrees/is-m1-webhook-secret-semantics`;
- 026/A je přijatý cílový environment kontrakt, ale 028 smí implementovat jen
  read/provenance/permission substrate nutný pro pravdivý status a signer;
- implementační pořadí subjectu je safe exact-root loader + immutable authority
  → server/worker/default factory injection → Security route/repository/channel
  cutover → Studio a focused compatibility evidence;
- poslední source commit nesmí být report ani docs-state update. Subject `S` je
  po předání Review A immutable;
- 026 nezačne před přijetím 028 candidate; 029 nezačne před přijetím 026.

## 5. Malá demonstrace

Table-driven demonstrace musí bez external network effectu prokázat:

| Pre-load own process key | Exact root file key | Výsledek |
|---|---|---|
| neprázdný | libovolný | `configured=true`, `source=PROCESS_ENV`, process value podepisuje |
| prázdný | neprázdný | `configured=false`, `source=PROCESS_ENV`, bez podpisu |
| absent | neprázdný | `configured=true`, `source=ROOT_ENV_FILE`, root value podepisuje |
| absent | prázdný nebo absent file/key | `configured=false`, `source=ROOT_ENV_FILE`, bez podpisu |
| libovolný | unsafe existující file | typed startup failure před DB/listener/effectem |
| po startu změněný process/file | původní safe snapshot | status i podpis beze změny do restartu |

Stejná sada seedne legacy DB secret odlišný od environment hodnoty a prokáže,
že status i deterministic HMAC vycházejí výhradně ze startup authority. Potom v
test fixture simuluje budoucí exact odstranění legacy key a prokáže stejný
výsledek. Produkční 028 žádný scrub neprovádí.

## 6. Focused pozitivní a negativní důkaz

Nevzniká nová suite ani registry program. Přidá se pouze jeden nový top-level
logický případ a ostatní důkaz se skládá do existujících případů:

1. existující settings-authority T2 se rozšíří o authenticated/pre-parse POST
   `410` bez body/DB/revision/random/runtime effectu, exact GET a odstraněný
   repository writer; počet top-level případů se nemění;
2. existující první notification-scope případ převezme table-driven
   provenance/permission/restart/HMAC/legacy-ignore matici včetně
   `cwd != projectRoot`; existující druhý případ přepíše historický pin
   „Security regenerate zachováno pro 028“ na nový read-only source contract;
3. jediný nový případ vznikne ve Studio VM: exact two-key GET, read-only
   source/restart text, žádný masked fragment, regenerate control ani POST;
   malformed/non-2xx/unknown source je fail-closed.

Existující settings-authority T3 WAL matice se mechanicky zmenší ze sedmi na
pět dvojic odstraněním přesně `generic → webhook` a `import → webhook`; tyto
řádky dnes volají retirementem rušený setter. Náhradní no-writer důkaz vlastní
T2 přes pre-parse `410` a nulovou změnu DB/revision. Top-level počet programu
zůstává čtyři.

Po změně zůstávají očekávané top-level počty `4/4` settings authority, `2/2`
notification scope a `128/128` Studio. BLOCKED
`tests/e2e/13-security.e2e.js` smí mechanicky očekávat nový `410`, ale report jej
výslovně uvede jako `NOT RUN / BLOCKED`; žádný runtime/E2E PASS se z jeho source
změny neodvozuje.

Registry zůstává byteově beze změny: 382 programů, 8 exclusions a fingerprint
`571ae1a90a4246c7037d56fe5fb786beb4b5c4aae3e61f163d5b6ffe14341d71`.
Testy používají temp filesystem, fake DB/effect seam a deterministic signing
input; nesmějí otevřít external network.

## 7. Stop condition a eskalace

Zastavit dotčenou část při potřebě:

- zavést env/DB/localStorage writer, transfer, scrub, purge, export/import nebo
  secret recovery;
- změnit accepted source enum, vracet source `null`, maskovaný/value fragment
  nebo další public response field;
- dovolit `cwd`, implicitní dotenv discovery, unsafe file, symlink traversal,
  non-owner nebo jiný než exact mode-0600 root source;
- číst secret po startu z ambientního process env, file či DB nebo předat raw
  secret jiným konstruktorem;
- měnit `GET /api/notifications/channels` na credential status nebo přidat jiný
  veřejný credential endpoint;
- měnit webhook destination/retry/outbound semantics nebo tvrdit support/delivery
  bez explicitního budoucího operátorského journey;
- scrubnout historický DB blob nebo tvrdit, že full SQLite backup už legacy
  secret nemůže obsahovat;
- přidat závislost, registry/baseline změnu, nový/pátý program, síťový test,
  mobile, Electron, GPU, Ollama nebo cestu mimo allowlist;
- nedoložit, že unsafe root file failne před SQLite/listener/port-file/effectem,
  nebo že server a workers používají tutéž authority jako signer;
- zjistit drift canonical integration base, konflikt ownershipu nebo cizí dirty
  změnu v source worktree.

Vada mimo allowlist se zapíše jako `FINDING` a neopraví se potají. Test se při
nálezu nemaže ani neoslabí. Finding 011 zůstává `OPEN` a Gate 1 `BLOCKED` i po
úspěšném 028; zavření vyžaduje nejméně 026 → 029 a všechny ostatní explicitní
residualy.

## 8. Přesné ověření a evidence DAG

Writer i Review B spouštějí pouze tyto čtyři programy:

```bash
set -euo pipefail
node tests/m1-settings-notification-authority.test.js
node tests/m1-notification-credential-scope.test.js
node tests/m1-studio-client.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Syntax se ověří pouze `node --check` nad změněnými JS soubory; nejde o pátý
testovací program. Immutable `S` i Review B vyžadují prázdný
`git status --porcelain=v1 --untracked-files=all`. Review B zopakuje stejný
redukovaný blok v disk-backed `git clone --no-local` s offline dependency
recovery podle locku. External network je blokovaný; Electron/build, GPU,
Ollama, outbound journey a celý produktový test sem nepatří.

Rezervované refs jsou:

```text
wp/m1-webhook-secret-semantics-20260811
evidence/m1-webhook-secret-semantics-review-a-20260811
queue/m1-webhook-secret-semantics-promotion-20260811
evidence/m1-webhook-secret-semantics-review-b-20260811
```

Evidence DAG je:

```text
activation docs base B
  -> immutable subject S
  -> report-only E_A jako přímý potomek S
  -> --no-ff merge candidate C s parents B,E_A
  -> disk-backed --no-local Review B
  -> report-only E_B jako přímý potomek C
  -> integrátorský metadata gate a fast-forward promotion
```

Review A nezávisle ověří exact `B..S`, allowlist, call graph a celý redukovaný
gate. Teprve po `PASS` smí `E_A` poprvé vytvořit rezervovaný report a přesně
jednou zapsat:

```text
integrationRef: integration/m1-consolidated-20260810
baseRevision: <B>
subjectHead: <S>
reviewA.verdict: PASS
```

Candidate musí být no-ff merge nad exact aktivačním base, mít parents `B,E_A`,
obsahovat nezměněný report blob z `E_A` a mít `E_A` jako předka. Review B běží
nad exact `C`. `E_B` smí změnit pouze report a doplnit přesně:

```text
candidateHead: <C>
reviewB.verdict: PASS
```

Report nikdy neobsahuje SHA commitu, který jej právě zapisuje. Pokud Review A
vrátí `CHANGES_REQUIRED`, `E_A` nevznikne, původní subject/ref/historie zůstanou
immutable a oprava vznikne jako same-base sibling replacement s novým Review A.
PASS 028 neznamená Finding 011, Gate 1, Electron ani webhook support PASS.
