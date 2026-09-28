# M7 LAN/VPN transport admission — 2026-08-30

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_PENDING / LISTENER_ABSENT / SESSION_AUTHORITY_NOT_CONNECTED`

## Identita řezu

```text
base evidence HEAD    = 6d050aa846e1bb2f59754320c3a360f28bb1a5a2
product candidate     = bba4bbf3b9f1864863d53f6323caf455ecb5fc3f
candidate tree        = c4893246a88f98cf99d294b5e8af09b57d7ad6d7
review range          = 6d050aa8..bba4bbf3
branch                = codex/m7-mobile-contract-integration-20260829
upstream              = absent
push                  = not performed
```

Pozdější documentation-only commit leží mimo review range. Není to povolený M6
release-evidence commit a nesmí se zaměnit za nový produktový kandidát.
Jakýkoli další produktový nebo testový commit verdikt nad `bba4bbf3` ruší.

## Implementovaný milník

`src/remote/m7-transport-admission-policy.js` je odpojená, closure-brandovaná
admission policy pro budoucí dedicated M7 listener. Vstupní konfigurace musí
obsahovat konkrétní private LAN, CGNAT VPN nebo IPv6 ULA bind, exact HTTPS
origin a port, TLS 1.3 v obou směrech, vypnutý proxy trust a připnutou
`sha256:` SPKI identitu. Wildcard, loopback, link-local a public bind selžou.

Request admission používá jen socketem pozorovanou peer adresu. IPv4-mapped
IPv6 se kanonizuje na tutéž identitu; public, unspecified, invalidní a
nezónovaný link-local peer selže. Povrch je přesně sedm metod/cest mobilního
session kontraktu:

```text
GET  /remote/v1/health
POST /remote/v1/pairing/claim
POST /remote/v1/session/challenge
POST /remote/v1/session/open
POST /remote/v1/session/refresh
POST /remote/v1/session/revoke
POST /remote/v1/invoke
```

Admission vyžaduje TLS 1.3, HTTP/1.1, exact Host, metodu, cestu a canonical
Content-Length. Query, fragment, legacy `/api/*`, `/m1/*`, `/c3/ws`, bearer,
cookie, proxy/forwarded identita, duplicitní hlavičky, transfer encoding a
nadlimitní headers/body selžou před budoucí session/provider hranicí.

Peer rate-limit identita je domain-separated HMAC-SHA-256; raw IP ani pairing
claim se nevydávají. Pairing plán tvoří global, peer a peer+claim bucket
`30/600 s`, `5/600 s`, `5/600 s`; invocation plán je `60/min` pro trusted read
a `10/min` pro trusted mutation. Výstup nese autoritu
`DURABLE_RATE_LIMIT_CONSUMER_REQUIRED`, protože samotná policy counter
nespotřebovává.

## Důkaz odpojení

- modul neimportuje HTTP, HTTPS, TLS, server, WS ani M7 session authority;
- nevytváří server a nevolá `listen()`;
- `m7-core-composition.js` admission policy neimportuje;
- strukturální klon policy ani admission objektu není genuine;
- stav je `IMPLEMENTED_NOT_ACTIVE`;
- nebyl otevřen port, proveden síťový request ani připojeno zařízení.

Podmíněný review PASS session authority tím zůstává zachovaný: žádný listener
ji nekonzumuje.

## Focused a compatibility evidence

| Hranice | Výsledek |
|---|---|
| LAN/VPN transport admission | `8/8 PASS` |
| mobile remote session contract | `13/13 PASS` |
| M7 session authority | `11/11 PASS` |
| M6 candidate plan | `19/19 PASS` |
| M6 runtime evidence | `8/8 PASS` |
| M6 technical evidence | `8/8 PASS` |
| module-boundary ratchet | `13/13 PASS` |
| artifact boundary | `158/158 PASS` |
| nightly orchestrator self-test | PASS / exit 0 |
| harness exit contract | PASS / `102` temp roots, `123` DB roots |
| registry validation | valid / `498` programs |
| `git diff --check` před gate | PASS |

Aktuální registry má 498 programů: 404 ACTIVE, 79 BLOCKED a 15 HISTORICAL.
`ACTIVE + required` je 399. Profil `offline + database` má 338 programů
(`270 + 68`) a fingerprint
`7188ed916b1b59a822cb9999848c27f885323780716e3b24f78f8f4db3fdafaf`.
Omission sentinel odebere nový program z kopie plánu a musí dostat
`plan:required-program-uncovered`.

## Souvislý offline + database gate

```text
sourceRevision       = bba4bbf3b9f1864863d53f6323caf455ecb5fc3f
runId                = 2026-08-29T22-53-46-348Z
startedAt            = 2026-08-29T22:53:46.387Z
endedAt              = 2026-08-29T22:57:40.217Z
concurrency          = 1
result               = 338 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = 7188ed916b1b59a822cb9999848c27f885323780716e3b24f78f8f4db3fdafaf
inventoryFingerprint = ec690110fa9ebab24057bd44307f9cabfbbaf02571c16100c4aa65eaec267ee4
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = df1fa20522afc04c55c06bd9fe95bee95e834b2c824c91f961c67b9f82801356
```

Raw report:

`.intentsmith-artifacts/m7-transport-admission-offline-database-20260830/2026-08-29T22-53-46-348Z/report.json`

Gate explicitně povolil deklarované lokální toolchainy a připnutý existující
PDF runtime. Live chat/model, Ollama, GPU, network listener a fyzické zařízení
nebyly spuštěné.

## Operátorské vstupy před dalším produktovým blokem

### M7-TLS-01 — origin, bind a key custody

Je potřeba určit exact produkční origin, bind IP/port a způsob dodání
certifikátu, private key a SPKI pinu. Doporučení: dedicated host certificate,
private key mimo repo, SQLite, environment a artefakty, vlastněný službou s
módem `0600`; žádná build/test auto-generace. Bez tohoto vstupu nevznikne
produkční listener.

### M7-RATE-01 — durable limiter a HMAC key custody

Je potřeba určit durable store, stabilní HMAC key custody a retenční limity.
Doporučení: klíč v OS keyringu nebo service-owned `0600` souboru mimo repo,
SQLite a environment; SQLite smí držet jen opaque bucket digesty a bounded
countery, nikdy raw IP nebo claim.

### M7-NET-01 — interface a firewall

LAN/VPN-only směr je schválený. Chybí exact interface/bind/port a provozní
důkaz, že neexistuje public NAT, port-forward ani reverse proxy. Doporučení:
explicitní LAN nebo WireGuard/Tailscale IP a port `7443`, pokud operátor
neurčí jinak.

### M7-PAIR-01 — issuance pairing claimu

Je potřeba určit lokální UX, které smí jednorázový claim vydat. Doporučení:
pouze autentizovaná lokální Studio akce, pětiminutový single-use QR/kód,
nikdy remote self-issuance.

## Co není tvrzeno

Tento řez není `REVIEW_PASSED`, M7 acceptance ani M6 Gate 0. Neexistuje
listener, durable limiter, produkční certifikát/key, pairing issuance, startup
wiring, device test, release signing ani distribuce. M5/M6 offline receipts,
rotace, history disposition, demo, promotion, tag, publish a push neproběhly.
