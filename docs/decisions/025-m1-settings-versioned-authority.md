# 025 — obecná settings cesta potřebuje verzovaný read/write a stale-write autoritu

- **typ:** veřejný connector a datová autorita
- **stav:** `ACCEPTED 2026-08-11: A / IMPLEMENTATION_PENDING`; implementaci
  aktivuje až ohraničený WP založený z přijatého docs checkpointu
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **předpoklad:** F-A je `PROMOTED / REVIEW A+B PASS`

## Ověřený problém

`GET /api/settings` vrací téměř celý JSON dokument, včetně hodnot, které mají
vlastní maskovanou route. Chybu DB nebo JSON převádí na autoritativní `200 {}`.
`POST /api/settings` po F-A bezpečně top-level mergeuje a chrání devět
notification klíčů, ale nemá revision ani compare-and-swap. Storage, webhook,
import a reset stále používají jiné mutation cesty. Stale klient proto může
přepsat novější hodnotu a klient neumí odlišit skutečné prázdné nastavení od
selhání čtení.

Samotná migrace s revision nestačí: dnešní raw `INSERT OR REPLACE` a `DELETE`
by revision obešly nebo rozbily. Revision, repository seam a cutover všech
živých writerů musí vzniknout v jednom reviewovaném subjectu.

Známé otevřené okno před 025 je explicitní: `POST
/api/security/webhook-secret` v `src/routes/security.js` stále provádí vlastní
raw read-modify-write a `INSERT OR REPLACE` mimo F-A transakční seam. Je to
součást již otevřeného Findingu 011, ne nový nález pro Review A.

## Varianty

### A — nový versioned connector, následné ukončení legacy cesty (přijato)

- `GET /api/settings/v2` vrací exact redigovanou public projekci a revision;
  generic projekce neobsahuje hodnotu žádného `NOTIFICATION`, `WEBHOOK`,
  `STORAGE` ani jiného non-`GENERIC` ownera; jejich jediný public read je
  příslušná typed status route;
- `PUT /api/settings/v2` vyžaduje exact `expectedRevision` a server-owned
  patch; stale revision vrátí `409`, bez automatického retry/replay;
- DB/read/parse chyba je typované non-2xx, nikdy `200 {}`;
- import a reset vracejí stejnou redigovanou committed projekci;
- všechny mutation rodiny používají jediný repository commit point;
- po cutoveru všech tří first-party klientů vrátí legacy
  `GET/POST /api/settings` stabilní `410` bez mutace.

Je to nejlépe vratné na connector seam, ale schema a CAS cutover musí být
atomický: do jednoho immutable subjectu patří repository, všech pět writer
rodin, generic HTTP a všichni tři first-party consumery — chat-panel Studio,
Architect i Center Views. Jinak revision pouze dekoruje druhou živou autoritu.
Po `410` je návrat možný jedinou route mapou, ne datovou migrací.

### B — změnit stávající `/api/settings` in-place

Méně rout, ale starý klient dostane nový tvar a CAS povinnost bez negotiation.
Chyba v pořadí nasazení rozbije každé ukládání nastavení. Nedoporučeno.

### C — ponechat legacy adaptér trvale

Nejméně okamžitého breakage, ale raw read/write zůstane druhou autoritou a
Finding 011 se nezavře. Nedoporučeno pro Gate 1.

## Implementační hranice po přijetí

Subject smí rezervovat migraci `064` až po novém all-worktree/all-ref census;
`063` zůstává organizačně mobilní. Migrace zachová existující JSON bytes,
seedne chybějící singleton a přidá monotonic revision. DB guard odmítne
`REPLACE`, `DELETE`, jiné `id` i update bez přesného `revision + 1`. Tentýž
subject převede generic, notification, storage, webhook a model-policy
import/reset mutation na jediný top-level `BEGIN IMMEDIATE` seam, zavede exact
path owners (`GENERIC`, `NOTIFICATION`, `STORAGE`, `WEBHOOK`, `IMPORT`,
`RESET`) a převede chat-panel Studio i Architect na CAS. Center Views se v
témže subjectu převede na redigovanou backup/import committed response; tím
jsou pokryti všichni tři first-party consumery. Model-policy zůstane vlastníkem
své top-level transakce a použije úzký in-transaction primitive, ne nested
transaction. Legacy `410` přistane až po klientském cutoveru, ale ve stejném
reviewovaném subjectu. Musí být posledním runtime/source commitem WP: jeho
parent už obsahuje migraci, repository, všech pět writer rodin, settings v2 a
cutover všech tří first-party consumerů. Po tomto commitu smějí následovat jen
report-only evidence commity `E_A`/`E_B`; merge queue nikdy neintegruje
mezilehlý kompatibilní strom.

Testovací objem: jedna sdílená table-driven settings-authority sada, nejvýše
čtyři logické testy: (T1) migration preserve/seed a DB rejection
`REPLACE`/`DELETE`/non-`+1`; (T2) v2 CAS success/stale, typed read failure a
legacy `410`; (T3) reálná table-driven WAL matice generic i import versus
notification/storage/webhook a import versus generic; (T4) import/reset +
model-policy společný rollback a cutover tří klientů. Další rozhodnutí ji
rozšiřují, nezakládají paralelní duplikáty.
Metadata/path gate navíc bez pátého behavior testu ověří, že parent posledního
`410` source commitu už nemá žádný first-party legacy call a že immutable `S`
je právě tento cutover commit.

## Přijatý potvrzovací blok

```text
025: A
025-connector: VERSIONED-SETTINGS-V2
025-read: EXACT-REDACTED-PROJECTION
025-write: EXPECTED-REVISION-CAS
025-stale: HTTP-409-NO-AUTOMATIC-REPLAY
025-read-failure: TYPED-NON-2XX-NEVER-EMPTY-200
025-legacy: CUTOVER-THEN-410
025-legacy-order: FINAL-SOURCE-COMMIT-AFTER-ALL-THREE-CLIENT-CUTOVERS
025-migration: 064-AFTER-FRESH-CENSUS
025-atomicity: SCHEMA-REPOSITORY-ALL-WRITERS-AND-FIRST-PARTY-CLIENTS
025-pre-cutover-known-open: WEBHOOK-RAW-RMW-INSERT-OR-REPLACE
025-review: OWN-SUBJECT-REVIEW-A-AND-B
```
