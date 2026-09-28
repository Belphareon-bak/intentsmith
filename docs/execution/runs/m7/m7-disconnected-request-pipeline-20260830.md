# M7 disconnected request-authority pipeline — 2026-08-30

**Stav:** `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_PENDING / NOT_ACTIVE / LISTENER_ABSENT`

## Identita řezu

```text
base reviewed evidence HEAD = f562bbe95c06ca62694ddbb24e100239f783714c
implementation commit       = 36d64906a15727cc576c915dcbeafaa3d7c724df
module baseline commit      = d5e43de5a1d28d79d235a29df2ac45dbd1201789
product candidate           = 5c185b0f88d05eac5f6c7d71d04b54c2eac6d67f
candidate tree              = 234d29ff31cfb0c428e1c661fe165c3472e7b567
review range                = f562bbe9..5c185b0f
branch                      = codex/m7-mobile-contract-integration-20260829
upstream                    = absent
push                        = not performed
```

Tento report a související review packet jsou pozdější evidence-only změny
mimo review range. Nejsou M6 release promotion evidencí. Jakýkoli další
produktový nebo testový commit ruší verdict vázaný na `5c185b0f`.

## Co je implementované

Nový `src/remote/m7-disconnected-request-pipeline.js` skládá dosud odpojené
M7 hranice v jediném pořadí:

```text
raw transport metadata + raw body bytes
  -> genuine transport admission
  -> trusted operation classification
  -> genuine durable multi-bucket limiter
  -> exact canonical JSON / fatal UTF-8 boundary
  -> signed durable session authority
  -> closure-private in-process capability provider
  -> exact RemoteResponseEnvelope@1
```

Pipeline nevlastní socket, listener, TLS private key, produkční HMAC klíč ani
server route. Přijme pouze closure-genuine admission policy, limiter a session
authority. Provider vzniká uvnitř factory a jeho authority resolver není
exportovaný. Admission a session konfigurace musí mít shodný exact HTTPS origin
a SPKI pin.

Všech sedm kontraktových cest má jedinou dispatch hranici. Health používá
prázdné tělo a exact `X-IntentSmith-Request-Id`; POST cesty tuto hlavičku
odmítají. Tělo se kopíruje z `Buffer`/`Uint8Array`, délka se váže na canonical
`Content-Length`, UTF-8 se dekóduje fatálně a JSON musí být přesně kanonické
bajty. Duplicitní klíče, trailing whitespace, nekanonické pořadí/čísla a
neplatné UTF-8 se nedostanou k session autoritě.

Neplatné canonical bodies jsou přesto účtované limiterem, aby parser nebyl
bezlimitní pre-auth cesta. Neznámý invocation se konzervativně účtuje jako
mutace. Pairing rate plán nikdy neukládá raw claim: pro validní tělo používá
digest claimu, pro nevalidní digest raw bajtů.

Invocation payload validuje provider před spotřebou session counteru a nonce.
Teprve potom closure-private bridge exact porovná capability, verzi, operaci,
payload a required scopes s podepsaným envelope. Session autorita následně
ověří Ed25519 podpis, expiry, revokaci, subject/device/session identity,
monotónní counter a single-use nonce v SQLite `IMMEDIATE` transakci. Jeden
pipeline instance současně pustí nejvýše jeden provider handler pro přesnou
session revision.

## Skutečně nalezená integrační vada

První pozitivní cesta odkryla chybu, kterou izolované review limiteru nemohlo
vidět. `session/challenge`, `session/open`, `session/refresh` a
`session/revoke` správně sdílejí bucket `session-control-peer`, ale limiter
původně ukládal do stejného řádku requestové `routeId`. Druhá z těchto cest
proto skončila falešným `M7_RATE_LIMIT_CONFIG_DRIFT`.

Oprava nepovoluje drift. Každý genuine bucket nyní nese stabilní
`configurationId`; limiter ji ukládá do existujícího `route_id` sloupce a
porovnává spolu s limit/window. Jednotlivé requesty si v decision dál drží svůj
routeId. Čtyři session-control cesty tak sdílejí právě jeden `30/min` bucket,
zatímco skutečná změna konfigurace aktivního okna stále fail-closed selže.
Schéma se neměnilo a zůstává na 95 migracích.

## Focused a strukturální evidence

| Hranice | Výsledek |
|---|---:|
| disconnected request pipeline | `7/7 PASS` |
| transport admission policy | `9/9 PASS` |
| durable rate limiter | `11/11 PASS` |
| session authority | `11/11 PASS` |
| core composition | `8/8 PASS` |
| mobile session contract | `13/13 PASS` |
| mobile provider contract | `14/14 PASS` |
| schema migrations | `55/55 PASS`, 95 migrací |
| M1 exact migration oracle | `20/20 PASS` |
| M6 locked candidate plan | `19/19 PASS` |
| module-boundary ratchet | `13/13 PASS` |
| artifact boundary | `158/158 PASS` |
| harness exit contract | PASS, 104 temp / 124 DB roots |
| nightly orchestrator self-test | PASS / exit 0 |
| registry validation | valid / 500 programů |
| `git diff --check` | PASS |

Pět přesných nových module hran bylo přijato bez růstu cyklů. Graph má 1 247
hran, 3 cykly a 28 souborů v cyklech. Registry má 500 programů: 406 ACTIVE,
79 BLOCKED a 15 HISTORICAL; `ACTIVE + required` je 401. Profil
`offline + database` obsahuje 340 programů (`270 + 70`) a fingerprint
`a7bbe1f71db2989bc32da23f9b30c3fd216fa3a175b02d15c311691fc8f0ff5e`.
Omission sentinel nový pipeline program z locked plánu odebere a vyžaduje
`plan:required-program-uncovered`.

Nový test je skutečný DB root. Harness census byl vědomě posunut `123 -> 124`;
všech 124 rootů importuje isolation bootstrap před produkční DB cestou a
mutation sentinel po odstranění bootstrap importu selže.

## Souvislý offline + database gate

První běh nad `e7dcac05` byl pravdivě červený:

```text
runId       = 2026-08-30T18-02-38-180Z
result      = 337 PASS / 1 FAIL / 2 BLOCKED
verdict     = FAIL / exit 1
reportSha256 = d3dc3b0299c0edfead4715fdcc3fe39ecd4b112eea76616b3cfb4561efd20b58
```

FAIL byl stale harness census `124 != 123`. Oba BLOCKED exporty vznikly tím,
že reprodukční příkaz neexportoval existující připnutý PDF interpreter; nebyla
to produktová chyba. Červený report zůstává zachovaný.

Finální čistý běh:

```text
sourceRevision       = 5c185b0f88d05eac5f6c7d71d04b54c2eac6d67f
runId                = 2026-08-30T18-07-59-345Z
startedAt            = 2026-08-30T18:07:59.381Z
endedAt              = 2026-08-30T18:12:08.405Z
concurrency          = 1
result               = 340 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = a7bbe1f71db2989bc32da23f9b30c3fd216fa3a175b02d15c311691fc8f0ff5e
inventoryFingerprint = 012de803d77c85193cd5627a6479c9895a6fac31c49b6e5bdd087c990c43af61
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = b6e4f44ae141ca6af1218cba0f5e64a9541bec80ef3c9822e327706eb1de4a08
```

Raw report:

`.intentsmith-artifacts/m7-disconnected-request-pipeline-offline-database-final-20260830/2026-08-30T18-07-59-345Z/report.json`

Gate explicitně otevřel pouze deklarované lokální toolchainy a existující
hash-locked PDF runtime. Live chat/model, Ollama, GPU, server, listener, síť a
fyzické zařízení nebyly spuštěné.

## Hranice tvrzení

- Pipeline je `IMPLEMENTED_NOT_ACTIVE`; žádný produkční consumer ani startup
  wiring neexistuje.
- In-flight fence je v tomto řezu vlastností jedné pipeline instance. Před
  aktivací musí listener composition prokázat právě jednu instance nebo přidat
  silnější shared authority.
- Chybí mapování typovaných pre-auth chyb na HTTP response/close behavior;
  patří listeneru.
- Neexistuje lokální Studio pairing issuance, certifikát, systemd credential,
  firewall evidence, Android transport ani fyzický device journey.
- Předchozí review limiteru, admission policy a session authority zůstávají
  historickým důkazem, ale současné změněné bytes potřebují nový verdict.
- M5/M6 receipts, rotace, history disposition, demo, Gate 0, promotion, tag,
  publish a push neproběhly.

## Operátorské vstupy před listenerem

Nadále čekají čtyři volby `M7-TLS-01`, `M7-RATE-01`, `M7-NET-01` a
`M7-PAIR-01`. Doporučená společná varianta zůstává: VPN-only bind na portu
7443, SPKI pin, TLS/HMAC klíče přes systemd credentials, 24h limiter retence s
capem 50 000 bucketů a pouze lokálně autentizovaný pětiminutový single-use
pairing QR/kód. Tento řez doporučení neaktivoval.
