# WP-M1-SETTINGS-VERSIONED-AUTHORITY — verzovaný settings commit point

**Typ:** zapisující M1 data-integrity a public-connector WP · **Slot:** jediný
writer v izolovaném disk-backed worktree

**Rozhodnutí:**
[`025/A`](../decisions/025-m1-settings-versioned-authority.md)

**sourceEvidenceRevision:**
`68cd6a0d4b053fb789e10e2b95c0a7ce79858580`

**integrationRef:** `integration/m1-consolidated-20260810`

**baseRevision:** exact SHA tohoto aktivačního checkpointu zapíše unikátní run
report; statický WP podle `ROADMAP.md §12` nepředstírá SHA commitu, který jej
právě přidává

**Stav:** `ACTIVE / IMPLEMENTATION_NOT_STARTED` — operátor přijal 025/A a
pořadí `025 → 027 → 028 → 026 → 029` dne 2026-08-11. Finding 011 zůstává
`OPEN`, Gate 1 `BLOCKED` a Electron build je mimo tento WP.

## 1. Uživatelský výsledek

Uživatel načte redigovaná obecná nastavení s revision a uloží změnu pouze nad
revision, kterou skutečně viděl. Souběžně novější změna skončí stabilním `409`
bez tichého přepsání a bez automatického replay. Chyba DB nebo uloženého JSON
je typované non-2xx, nikdy falešné prázdné nastavení. Import a reset vracejí
stejnou redigovanou committed projekci.

Po převodu všech writerů a tří first-party consumerů přestane legacy
`GET/POST /api/settings` být druhou autoritou a vrátí stabilní `410` bez
mutace. Tento cutover je poslední runtime/source commit subjectu.

## 2. Povolené a zakázané cesty

**Povolené runtime/source cesty:**

- nová migrace
  `src/db/migrations/2026_08_10_064_user_settings_revision.js`, pouze pokud
  bezprostřední all-ref/all-worktree census znovu potvrdí volné číslo `064`;
- `src/db/user-settings.js` a `src/db/model-policy.js`; portable v2 artifact
  schema ani jeho jedenáct portable cest se nemění;
- `src/routes/misc.js`, `src/routes/notifications.js`,
  `src/routes/system.js` a `src/routes/security.js`;
- autoritativní Studio runtime
  `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`;
- `c3-ide/extensions/c3-center-views/lib/browser/center-views-module.js`;
- `src/ui/architect/architect.js`;
- existující `tests/m1-settings-notification-authority.test.js` se přestaví na
  jednu sdílenou settings-authority sadu se stále přesně čtyřmi top-level
  logickými testy a zachová F-A scénáře; pouze nutné kompatibilitní úpravy v
  `tests/m1-model-policy.test.js`, `tests/m1-studio-client.test.js`,
  `tests/schema-migrations.test.js` a
  `tests/e2e/11-memory.e2e.js`, pokud bez úpravy pravdivě selžou na novém
  connectoru; žádná z nich nedostane paralelní CAS matici;
- `scripts/studio-cdp-evidence.js`, `tests/studio-cdp-evidence.test.js` a
  `tests/studio-electron-boundary.e2e.js` pouze pro source-level cutover
  canonical settings endpointu; Electron se v tomto WP nespouští;
- pouze nutná metadata existujícího programu v `tests/registry.json`,
  mechanicky regenerovaný `docs/convergence/TEST-REGISTRY.md` a pouze
  odpovídající mechanický údaj v `README.md` nebo
  `tests/artifact-validation.test.js`; nový testovací program nevzniká;
- `docs/findings/011-user-settings-authority-and-secret-exposure.md` jako
  jediný přesný průběžný source-checkpoint dokument; každý source commit v něm
  aktualizuje vlastní 025 progress blok bez změny přijatého kontraktu;
- unikátní
  `docs/execution/runs/wp-m1-settings-versioned-authority-20260811-report.md`
  smí poprvé vytvořit až report-only `E_A` po Review A.

**Zakázané:**

- migrace `055`–`063`, mobilní soubory a přečíslování existující historie;
- secret transfer/storage, credential scope a webhook runtime autorita z
  rozhodnutí 027/028/026; 025 pouze převede dnešní webhook writer na společný
  commit point a dál jej vede jako otevřený secret-authority blocker;
- `sync_settings`, `session-adapter`, SetupWizard a reset-scope změny 029;
- změna portable backup profilu, nové secret pole nebo vydání secret hodnoty
  v generic/import/reset odpovědi;
- stale/archivní Studio TypeScript, build output, mobile, Electron, GPU,
  Ollama, externí síť, nová závislost nebo release/Gate 0 aktivace;
- oprava jiného Findingu 011 residualu v tomto subjectu.
- změna tohoto statického WP, `docs/wp/README.md`, decision 025, `ROADMAP.md`
  nebo `SYSTEM-MAP.md` po aktivačním commitu; jejich merge-SHA status vlastní
  integrátor až po přijatém candidate.

## 3. Vlastněný connector a verze

WP vlastní `UserSettingsRepository v2` a veřejný connector:

```text
GET /api/settings/v2
  -> { revision, settings: EXACT_REDACTED_PROJECTION }

PUT /api/settings/v2
  <- { expectedRevision, patch }
  -> { revision, settings: EXACT_REDACTED_PROJECTION }
```

Revision je monotonic safe integer. Každý DB zápis používá jediný repository
commit point a `UPDATE ... WHERE id = 1 AND revision = expectedRevision`;
úspěch zvýší revision přesně o jedna. `GENERIC`, `NOTIFICATION`, `STORAGE`,
`WEBHOOK`, `IMPORT` a `RESET` jsou exact path owners. Generic projekce ani
generic patch neobsahují žádnou hodnotu non-`GENERIC` ownera; typed status
route zůstává jediný public read příslušné domény.

`GENERIC` není fallback pro neznámou cestu. Repository obsahuje konečný,
verzovaný allowlist přesných vlastních cest odvozený z živých writerů
chat-panelu a Architectu; notification credentials/private destinations,
`storage`, `webhookSecret`, model-policy klíče a každý dosud neznámý path jsou
non-`GENERIC`. Neznámá cesta dostane `UNOWNED` a request failne před mutací.
Existující neznámé destination hodnoty repository zachová, ale public v2 je
nevydá a generic patch je nesmí změnit. Exact allowlist pinuje table-driven
T2; přidání cesty je budoucí verzovaná změna connectoru, ne implicitní spread.

Model-policy import/reset zůstává vlastníkem své top-level transakce a volá jen
úzký in-transaction repository primitive. Žádný obecný raw callback se
neexportuje. Typed latest-snapshot writery se serializují pod stejným
`BEGIN IMMEDIATE`; stale generic klient se automaticky nereplayuje.

## 4. Source revision, závislosti a pořadí

- `sourceEvidenceRevision` je přijatý docs checkpoint
  `68cd6a0d4b053fb789e10e2b95c0a7ce79858580`;
- skutečný `baseRevision` je full SHA čistého aktivačního commitu obsahujícího
  tento WP; writer jej ověří před první editací a report-only `E_A` jej po
  Review A zapíše do unikátního run reportu;
- `integrationRef` je `integration/m1-consolidated-20260810` a před branch musí
  být clean, upstream-synchronní a obsahovat tento WP;
- závislost F-A je `PROMOTED / REVIEW A+B PASS`; rozhodnutí 025/A i N1–N5 jsou
  přijaté; 027/028/026/029 nezačnou před promotion 025;
- bezprostředně před vytvořením migrace a znovu před immutable subjectem se
  kontrolují všechny local i remote refs a filesystem všech registrovaných
  worktree včetně untracked migrací; `063` zůstává organizačně mobilní a
  jakýkoli cizí nárok na `064` je tvrdý stop;
- runner řadí celý timestamped filename, ne samotný ordinál. Migrace 064 proto
  nesmí záviset na `055`–`063`. Dnes oddělené mobile `055`–`060` musí na prvním
  společném merge candidate projít jako late insertion do DB, která už
  aplikovala `061/062/064`, bez opakování M1 migrací a bez ztráty dat. Budoucí
  mobile 063 ponese stejný samostatný důkaz;
- interní pořadí subjectu: schema/repository → pět writer rodin + v2 route →
  tři first-party consumery → legacy `410` jako **poslední runtime/source
  commit**. Po immutable `S` už nevznikne další runtime/source commit;
  následuje report-only `E_A`, merge candidate `C` a report-only `E_B`.

## 5. Malá demonstrace

Dvě skutečné WAL connections pracují nad jednou migrovanou SQLite databází.
Klient A načte revision, klient B commitne notification, storage nebo webhook
změnu a klient A zkusí stale generic/import zápis. B zůstane byteově zachována,
A dostane `409` a explicitní reload; žádný secret se neobjeví ve v2 read ani v
import/reset response.

V témže focused běhu projde aktuální CAS zápis, import a reset společně s
model-policy transakcí. Po cutoveru všechny tři skutečné client source soubory
volají v2/redigovanou odpověď a legacy route vrací `410` bez efektu.

## 6. Focused pozitivní a negativní důkaz

Existující focused `tests/m1-settings-notification-authority.test.js` se stane
sdílenou settings-authority sadou se stále přesně čtyřmi top-level logickými
testy:

1. migrace zachová existující JSON bytes nebo seedne chybějící singleton s
   revision `1`; DB guard před mutací odmítne `REPLACE`, `DELETE`, jiné `id` a
   update bez přesného `revision + 1`;
2. v2 read/write prokáže exact redigovanou projekci, CAS success, invalidní
   request, stale `409` s nulovou mutací, typed read failure a tabulkově legacy
   `GET/POST` `410` bez efektu;
3. reálná table-driven WAL matice provede generic i import versus
   notification/storage/webhook a import versus generic; žádná novější nebo
   cizím ownerem vlastněná hodnota se neztratí;
4. import/reset + model-policy rollbackují jako jedna transakce a source-level
   harness připne cutover chat-panelu, Architectu i Center Views včetně
   redigované committed response.

Existing compatibility sady se nerozšiřují o duplicitní matice. Metadata/path
gate ověří, že parent posledního `410` commitu už neobsahuje first-party legacy
call a immutable subject `S` je právě tento poslední source commit.

## 7. Stop condition a eskalace

Zastavit dotčenou část při kolizi migrace `064`, nové závislosti, potřebě měnit
portable artifact schema, secret authority, reset scope, WS/setup credential
writer, mobile/Electron nebo jiný veřejný connector než přesně přijatý v2.
Stejně tvrdý stop je neschopnost převést všech pět writer rodin a tři klienty v
jednom immutable subjectu nebo potřeba po `410` ještě měnit runtime/source.

Vada mimo allowlist se zapíše jako `FINDING` a neopraví se potají. Nejasnost,
která jde vratně izolovat za již pojmenovaným seamem, se zapíše do rozhodovací
fronty a ostatní nezávislá práce pokračuje. Test se při nálezu nesmaže ani
neoslabí. Finding 011 a Gate 1 zůstávají otevřené až do přijetí celé fronty.

## 8. Přesné ověření a evidence DAG

Writer během iterace a před commitem spustí jen redukovaný focused blok:

```bash
set -euo pipefail
node --check src/db/user-settings.js
node --check src/db/model-policy.js
node --check src/routes/misc.js
node --check src/routes/notifications.js
node --check src/routes/system.js
node --check src/routes/security.js
node tests/m1-settings-notification-authority.test.js
node tests/schema-migrations.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Dotčené existující compatibility sady a `artifact-validation` se spustí jednou
na immutable subjectu nebo merge candidate, nikoli po každé editaci. Teprve
immutable `S` a Review B navíc vyžadují prázdný
`git status --porcelain=v1 --untracked-files=all`. Review B zopakuje reduced
blok v disk-backed `git clone --no-local`. GPU/Ollama, Electron a externí
network testy sem nepatří.

Protože mobile `055`–`060` nejsou součástí tohoto base ani allowlistu, jejich
late-insertion test se nespouští napodobením nebo kopírováním do 025 subjectu.
Je povinným integračním gatem prvního společného candidate; do té doby zůstává
odpovídající Gate 1 migrační položka otevřená. Totéž platí pro budoucí 063.

Evidence DAG je:

```text
subject S (poslední source commit = legacy 410)
  -> report-only E_A s Review A
  -> merge candidate C na aktuálním integration base
  -> --no-local Review B
  -> report-only E_B
```

Run report pinuje `integrationRef`, exact `baseRevision`, `subjectHead=S`,
`reviewA.verdict`, `candidateHead=C` a `reviewB.verdict`. Statický WP se těmito
SHA po aktivaci nepřepisuje. Očekávaný výsledek je exit `0` uvedených příkazů,
prázdný porcelain a pravdivý stav `025 REVIEW_PENDING`; nejde o Gate 1 PASS.
