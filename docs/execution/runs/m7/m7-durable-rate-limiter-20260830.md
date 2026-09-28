# M7 durable rate limiter — 2026-08-30

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_PENDING / LISTENER_ABSENT / PRODUCTION_KEY_CUSTODY_ABSENT`

## Identita řezu

```text
base evidence HEAD    = 4d6823a8d54b6be93d60b70e253a83d98371af2f
implementation commit = 2fbd13fb4f987e4ed848641906eef0f1c2bd38d7
product candidate     = b23f63d6832dbe5e315be17b63a8496fdf55bdf0
candidate tree        = 78cf9700657c0a3f3c09d765b1b903065d979272
review range          = 4d6823a8..b23f63d6
branch                = codex/m7-mobile-contract-integration-20260829
upstream              = absent
push                  = not performed
```

Tento report a review packet jsou pozdější documentation-only evidence mimo
review range. Nejsou povoleným M6 release-evidence commitem a nemění identitu
product candidate. Jakýkoli pozdější product nebo test commit verdikt nad
`b23f63d6` ruší.

## Implementovaný milník

`src/remote/m7-durable-rate-limiter.js` spotřebuje pouze closure-genuine plán,
který vydala `m7-transport-admission-policy.js`, a pouze přes closure-genuine
limiter receiver. Jeden plán obsahuje jeden až tři opaque HMAC bucket digesty;
raw IP, pairing claim ani HMAC klíč se do SQLite neukládají.

Všechny buckety jednoho requestu se načtou, vyhodnotí a případně zapíší v jedné
SQLite `IMMEDIATE` transakci. Denial žádný z requestových sibling counterů
nezvýší. Dva nezávislé procesy nad stejným file-backed SQLite mají jedinou
serializovanou autoritu: při limitu 10 dostalo dohromady přesně 10 allow a 10
deny a uložený counter skončil přesně na 10.

Fixed-window stav přežívá novou repository instanci i druhé SQLite spojení.
Návrat clocku, změna konfigurace aktivního okna, chybějící schema, storage
chyba a překročení absolutního row capu selžou typovaně a zavřeně. Po expiry
staré konfigurace smí genuine canonical plan řádek obnovit. Retence odstraňuje
jen okna starší než zadaný retention interval.

Migrace `2026_08_30_108_m7_durable_rate_limits.js` přidává jednu `WITHOUT
ROWID` tabulku a expiry index. Její exact schema fingerprint je:

```text
15dd94aedd35352cbc28cc442246710992fd8744ce690c6c54140a8c0b10042c
```

Fresh schema má 169 tabulek a 95 aplikovaných migrací. Upgrade oracle M1 i M6
runtime receipt jsou připnuté na skutečný nový tip 108.

## Důkaz odpojení

- limiter ani admission policy nevytvářejí server a nevolají `listen()`;
- limiter neimportuje server, route, WS, session authority ani capability
  provider;
- žádný produkční modul limiter nekonzumuje;
- stage je `IMPLEMENTED_NOT_ACTIVE`;
- nebyl vytvořen produkční HMAC klíč, otevřen port ani proveden network/device
  test.

Podmíněný `REVIEW_PASSED` session authority proto zůstává zachovaný: žádný
listener ji ani limiter nekonzumuje.

## Focused a strukturální evidence

| Hranice | Výsledek |
|---|---|
| durable rate limiter | `10/10 PASS` |
| LAN/VPN transport admission | `8/8 PASS` |
| schema migrations | `55/55 PASS` |
| M1 exact migration oracle | `20/20 PASS` |
| M6 runtime evidence | `8/8 PASS` |
| M6 technical evidence | `8/8 PASS` |
| M6 locked candidate plan | `19/19 PASS` |
| module-boundary ratchet | `13/13 PASS` |
| artifact boundary | `158/158 PASS` |
| nightly orchestrator self-test | PASS / exit 0 |
| registry validation | valid / `499` programs |
| `git diff --check` | PASS |

Module baseline přijal jedinou přesnou hranu
`src/remote/m7-durable-rate-limiter.js ->
src/remote/m7-transport-admission-policy.js`. Graph má 1 242 hran, 3 cykly a
28 souborů v cyklech; cyklická množina se nezvětšila.

Registry má 499 programů: 405 ACTIVE, 79 BLOCKED a 15 HISTORICAL.
`ACTIVE + required` je 400. Profil `offline + database` má 339 programů
(`270 + 69`) a fingerprint
`f2b34a8765fe5ec759586ea04d606e2166eeb022cb7b6d1936ba532bca3e750b`.
Omission sentinel nový limiter program z kopie plánu odebere a vyžaduje
`plan:required-program-uncovered`.

## Souvislý offline + database gate

```text
sourceRevision       = b23f63d6832dbe5e315be17b63a8496fdf55bdf0
runId                = 2026-08-29T23-21-36-593Z
startedAt            = 2026-08-29T23:21:36.629Z
endedAt              = 2026-08-29T23:25:38.386Z
concurrency          = 1
result               = 339 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = f2b34a8765fe5ec759586ea04d606e2166eeb022cb7b6d1936ba532bca3e750b
inventoryFingerprint = b152a242179f4061dcddb37b09276b73f9c5be9d2e3ad17df6283eef095d64ef
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = 1e19ab678f96e312379822e2596437e01b2b5b54c38b780ebdf2eaeee5700d80
```

Raw report:

`.intentsmith-artifacts/m7-durable-rate-limiter-offline-database-20260830/2026-08-29T23-21-36-593Z/report.json`

Gate explicitně povolil deklarované lokální toolchainy a existující připnutý
PDF runtime. Live chat/model, Ollama, GPU, server/listener, síť a fyzické
zařízení nebyly spuštěné.

## Zbývající operátorské vstupy

- `M7-TLS-01`: exact origin, bind IP/port a produkční certificate/private-key
  custody;
- `M7-RATE-01`: produkční HMAC key custody a potvrzení retention/capacity
  parametrů; SQLite store je implementovaný;
- `M7-NET-01`: exact LAN/VPN interface a firewall bez public NAT,
  port-forwardu nebo reverse proxy;
- `M7-PAIR-01`: lokální autentizované vydání jednorázového pairing claimu.

## Co není tvrzeno

Tento řez není `REVIEW_PASSED`, M7 acceptance ani M6 Gate 0. Neexistuje
listener, produkční certificate/key, pairing issuance, startup wiring, device
test, release signing ani distribuce. M5/M6 operátorské receipts, rotace,
history disposition, demo, promotion, tag, publish a push neproběhly.
