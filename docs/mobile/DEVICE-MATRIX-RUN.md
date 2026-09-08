# M7 fyzická VPN/device matice

**Stav: `NOT RUN`.** Tento soubor je protokol běhu, ne důkaz. PASS vznikne až
pozorováním přesně připnutého candidate-signed APK na fyzickém Android zařízení
API 29+ proti VPN-only TLS listeneru Decision 042. Emulátor, browser, USB
gateway ani prázdný řádek nejsou PASS.

## Identita běhu

```text
Datum a operátor:       ______________________________
Candidate SHA/tree:     ______________________________
APK SHA-256/signer:     ______________________________
AAB SHA-256/signer:     ______________________________
Source manifest SHA:    ______________________________
Telefon/model/API:      ______________________________
App version/code:       ______________________________
VPN interface/address:  ______________________________
Server origin/SPKI:     ______________________________
Evidence directory:     ______________________________  (0700)
```

Nezaznamenávej pairing code, private key, HMAC key, bearer/local capability,
auth headers ani obsah chatu. Textové logy před uložením rediguj; redakci
pojmenuj. Observation soubory mají mode `0600`.

## Povinných 13 runtime checků

ID a pořadí odpovídají `MobileM7RuntimeEvidence@1`. Každý řádek musí mít
`PASS` nebo `FAIL` a alespoň jeden konkrétní artifact ID.

| # | Check ID | Provedení a acceptance | Stav | Artifact ID |
|---:|---|---|---|---|
| 1 | `candidate-installed` | Android package, version, source revision, APK digest a signer sedí s kandidátem | ☐ PASS ☐ FAIL | |
| 2 | `logout-identity-wiped` | po logoutu zmizí session, pairing state, wrapped signing seed i doménová data; app žádnou mutaci nepodepíše | ☐ PASS ☐ FAIL | |
| 3 | `mutation-approval-roundtrip` | skutečný M2 approval se zobrazí; efekt před tapem nenastane; approve/reject zachová fingerprint a operation identity | ☐ PASS ☐ FAIL | |
| 4 | `offline-reconnect` | vypnout VPN za běhu a restartovat app; pairing zůstane, UI je offline, mutace jsou blokované; po návratu VPN health ověří server a data se znovu načtou | ☐ PASS ☐ FAIL | |
| 5 | `pairing-single-use` | lokální Studio vydá 5min claim; první claim uspěje, druhý pokus se stejným kódem je odmítnut a auditován | ☐ PASS ☐ FAIL | |
| 6 | `read-invocation-signed` | zachycený read request nese validní Ed25519 invocation proof; změna payloadu/signature je odmítnuta před core adapterem | ☐ PASS ☐ FAIL | |
| 7 | `server-restart-replay-fenced` | po restartu serveru opakovaný counter/nonce selže; nový monotónní request se stejným pairingem projde | ☐ PASS ☐ FAIL | |
| 8 | `session-open-signed` | OPEN challenge i request jsou podepsané a svázané s device/pairing/originem | ☐ PASS ☐ FAIL | |
| 9 | `session-refresh-signed` | REFRESH je podepsaný; stará revision je po dispatchi nepoužitelná a výpadek nechá jen resumable pairing | ☐ PASS ☐ FAIL | |
| 10 | `session-revoke-enforced` | revoke okamžitě odmítne další invocation a lokální logout zničí device signing authority | ☐ PASS ☐ FAIL | |
| 11 | `tls13-spki-accepted` | telefon přijme pouze TLS 1.3 server s build-pinned SPKI a přesným originem `:7443` | ☐ PASS ☐ FAIL | |
| 12 | `vpn-only-reachability` | listener je na exact VPN adrese; dostupný doma i mimo LAN jen přes VPN; LAN, loopback, wildcard a public ingress nejsou použitelné | ☐ PASS ☐ FAIL | |
| 13 | `wrong-spki-rejected` | build se stejným originem a úmyslně chybným SPKI pinem selže před HTTP; žádný redirect/proxy/browser-fetch fallback | ☐ PASS ☐ FAIL | |

Jediný FAIL znamená pravdivý červený evidence index. Nález neopravuj změnou
řádku; oprav produkt, zmraz nový kandidát a běh zopakuj.

## Povinná accessibility/device doplňková matice

Tyto body nejsou nahrazené třinácti transport checks a musí být součástí
release review:

| Scénář | Acceptance | Stav | Artifact ID |
|---|---|---|---|
| systémový zámek + biometrie | bez zámku se identity nevytvoří; Home/return vyžádá bezpečné odemčení | ☐ PASS ☐ FAIL | |
| recents snapshot | citlivý obsah je zakrytý přes `FLAG_SECURE` | ☐ PASS ☐ FAIL | |
| process death a reboot | wrapped identity přežije, plaintext key nikoli; session se bezpečně obnoví | ☐ PASS ☐ FAIL | |
| TalkBack | fokus, statusy a rozhodovací akce jsou smysluplně ohlášené | ☐ PASS ☐ FAIL | |
| 200 % font + rotace | obsah ani 48dp/56dp akce nejsou oříznuté nebo překryté | ☐ PASS ☐ FAIL | |
| airplane mode / Doze | cache je výslovně stale/offline a nic se automaticky znovu neodešle | ☐ PASS ☐ FAIL | |
| změna pairing identity | stará cache, journal ani draft se nevykreslí pod novým device ID | ☐ PASS ☐ FAIL | |

## Minimální evidence artefakty

Doporučená malá sada bez secrets:

- `candidate-package.txt`: redigovaný `adb shell dumpsys package` s version,
  source revision a signer pozorováním;
- `vpn-bind.txt`: exact `ip`/`ss` a firewall census před a po běhu;
- `session-audit.json`: export pouze relevantních M7 audit fields bez
  credentialů a payloadů;
- `device-journey.txt`: časová osa kroků a pozorovaných výsledků;
- `accessibility.txt`: TalkBack/font/rotation pozorování;
- podle potřeby redigované screenshoty, nikdy QR/pairing code.

Každý artifact dostane stabilní lowercase ID, relativní kanonickou cestu,
počet bajtů a SHA-256. Seznam artifactů i checků je seřazený. Index je přesně
jednořádkový kanonický JSON ukončený `\n`; produkční validator odmítá
pretty-print i změnu jediného bajtu.

## Po běhu

1. Přepočti digesty APK/AAB a všech observation souborů.
2. Vytvoř `MobileM7RuntimeEvidence@1` index; i FAIL řádky zachovej.
3. Spusť release evidence s `--runtime-evidence`, viz [TRYING-IT.md](TRYING-IT.md).
4. Ověř, že output vytvořil nový `<sha12>-<run>` adresář a nepřepsal starý.
5. Předej candidate SHA, celý privátní bundle a manifest nezávislému reviewerovi.

`runtimeEvidence.verified: true` znamená pouze, že kanonické bytes, vazby,
artefakty a všech 13 stavů prošly lokálním validátorem. Neznamená to
`REVIEW_PASSED`, M7 acceptance ani oprávnění k publish.
