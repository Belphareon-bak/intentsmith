# WP-M1-SETTINGS-NOTIFICATION-CLOBBER — F-A ochrana notification nastavení

**Typ:** zapisující P1 data-integrity repair · **Slot:** jeden writer v
izolovaném worktree

**sourceEvidenceRevision:** `fc86b718e3872176a644ec296e7c6b98c2f5dba3`

**baseRevision:** `fc86b718e3872176a644ec296e7c6b98c2f5dba3`

**integrationRef:** `integration/m1-consolidated-20260810`

**Stav:** `ACTIVE` — operátor F-A výslovně schválil 2026-08-10; tento
aktivační commit musí být před prvním writer commitem.

## 1. Uživatelský výsledek

Uložení obecných nastavení nesmí odstranit ani vrátit na starší hodnotu devět
notification nastavení, která vlastní `POST /api/notifications/config`.
Současně se nesmí změnit dnešní maskování SMTP hesla ani běžné ukládání
ostatních obecných nastavení.

## 2. Vlastněné a zakázané cesty

**Povolené:**

- `src/db/user-settings.js`;
- `src/routes/misc.js` a `src/routes/notifications.js`;
- nový `tests/m1-settings-notification-authority.test.js`;
- aditivní registrace v `tests/registry.json`, mechanicky regenerovaný
  `docs/convergence/TEST-REGISTRY.md` a odpovídající počty v `README.md`;
- tento WP, `docs/wp/README.md`, Finding 011, `ROADMAP.md`, `SYSTEM-MAP.md` a
  unikátní
  `docs/execution/runs/wp-m1-settings-notification-clobber-20260810-report.md`.

**Zakázané:**

- migrace, změna `GET /api/settings`, portable schema/import/reset, generic
  revision/CAS cutover a secret storage;
- `/architect`, Studio, mobile, Electron, GPU/Ollama a externí síť;
- změna veřejné sémantiky notification polí nebo feature flags;
- oprava F-B či ostatních checkpointů Findingu 011 v témže subjectu.

## 3. Vlastník cesty a connector

Jediný mutation connector je `updateUserSettings()` v
`src/db/user-settings.js`; čtení i zápis proběhnou v jednom
`BEGIN IMMEDIATE`. Stejný modul vlastní přesnou mapu těchto devíti klíčů:

`c3.notif.emailEnabled`, `c3.notif.smtpHost`, `c3.notif.smtpPort`,
`c3.notif.smtpUser`, `c3.notif.smtpPass`, `c3.notif.smtpFrom`,
`c3.notif.emailRecipient`, `c3.notif.emailOnLifecycle` a
`c3.notif.emailOnWorker`.

Generic mutation je server-side top-level merge. Všechny přítomné notification
klíče ze generic payloadu ignoruje a zachová jejich hodnotu z aktuálního
transakčního snapshotu. Notification route smí měnit jen uvedenou mapu;
maskovací hodnota `*****` zachová existující SMTP heslo.

## 4. Pořadí efektů

1. route načte a validuje request body;
2. model-automation sanitizace a notification ownership filtr proběhnou před
   persistence;
3. `updateUserSettings()` získá write reservation před čtením aktuálního
   dokumentu, aplikuje pouze vlastněnou změnu a commitne celý snapshot;
4. teprve po durable commitu se zavolá stávající runtime feature/channel
   aktualizace;
5. odpověď generic route smí uvést názvy ignorovaných protected klíčů, nikdy
   jejich hodnoty.

Neplatný body vrací stabilní `400`; malformed nebo pre-commit DB chyba
stabilní `503`. Raw `err.message` se na veřejnou hranici nevydává. Selhání
runtime aktualizace po commitu nesmí tvrdit, že persistence selhala: vrátí
degraded `200` s `runtimeApplied:false` a typovaným kódem, bez protected hodnot.

## 5. Redukovaný důkaz

Jeden focused soubor má pouze čtyři logické testy:

1. notification save a následný partial generic save zachová všech devět
   hodnot byte-for-byte;
2. stale generic snapshot po novějším notification commitu nesmí novější
   hodnoty přepsat;
3. dvě WAL connections s disjunktní notification/generic změnou neztratí ani
   jednu stranu a generic odpověď neobsahuje protected hodnoty;
4. malformed persisted JSON nebo vynucená DB chyba skončí stabilním non-2xx a
   raw řádek zůstane byteově beze změny; post-commit runtime chyba vrátí
   pravdivý degraded úspěch bez tajemství.

Review musí ověřit skutečný route call graph; další kombinatorické testy se
nepřidávají, pokud neodhalí nový samostatný kontrakt.

## 6. Stop condition

Dotčená část se zastaví při potřebě měnit schema/migraci, generic read,
reset/import kontrakt, notification pole nebo connector jiného WP. Nález mimo
tyto tři runtime soubory se zapíše do Findingu 011 a F-A pokračuje, pokud je
nezávislý.

## 7. Ověřovací příkazy

```bash
node tests/m1-settings-notification-authority.test.js
node tests/m1-model-settings.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Artifact validation se spustí jednou na immutable subjectu nebo merge
candidate, ne po každé editaci. Široké produktové, GPU/Ollama a Electron sady
do F-A nepatří.

## 8. Výstup a omezení

Výstupem je immutable subject nad uvedeným base, focused pozitivní i negativní
důkaz a standardní Review A/B obálka. F-A uzavírá jen potvrzený clobber devíti
notification klíčů. Generic secret-bearing GET, revision/CAS, další RMW writery,
F-B reset a oddělená secret authority zůstávají Finding 011 a Gate 1 zůstává
`BLOCKED`.
