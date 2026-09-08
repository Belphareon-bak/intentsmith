# Jak spustit M7 mobilního kandidáta

Tento runbook popisuje aktuální produkční cestu `remote-core-v1`: fyzický
Android telefon se připojuje přímo k dedikovanému TLS 1.3 listeneru přes VPN.
Nejde o release verdikt. Bez produkčních credentials, VPN bindu, candidate
signeru a vyplněné fyzické matice zůstává stav `RUNTIME_EVIDENCE_BLOCKED`.

Legacy `/m1` gateway přes `adb reverse` je nadále pouze vývojová cesta. Nesmí
se použít jako důkaz M7 transportu.

## 1. Bezpečný preflight

Pracuj z čistého checkoutu připnutého na kandidáta:

```bash
git status --short
git rev-parse HEAD
npm ci --offline
npm --prefix mobile-app ci --offline
npm run mobile:android:doctor
npm run test:mobile
npm run test:registry
```

Produkční M7 klient vyžaduje Android API 29+, JDK 21, Android SDK 36, Gradle
wrapper 8.14.3 a fyzický telefon se systémovým zámkem. Browser ani emulátor
nejsou autoritou pro AndroidKeyStore, SPKI pin, Doze nebo fyzickou VPN.

## 2. Připravit VPN listener bez jeho aktivace

Decision 042 vyžaduje jednu konkrétní VPN adresu, port `7443` a systemd
credentials. Server čte pouze tyto názvy:

| Credential | Obsah |
|---|---|
| `intentsmith-m7-tls-certificate.pem` | platný X.509 certifikát pro zvolený VPN origin |
| `intentsmith-m7-tls-private-key.pem` | odpovídající private key |
| `intentsmith-m7-rate-limit-hmac.bin` | přesně 32 náhodných bajtů |

Privátní key ani HMAC key nesmí být v repozitáři, SQLite, serverovém env,
argumentech, logu nebo evidence artefaktu. Produkční materiál se nevyrábí
buildem ani testem. Systemd unit musí materiál předat přes `LoadCredential=`
nebo `LoadCredentialEncrypted=` tak, aby proces dostal přesný adresář
`/run/credentials/intentsmith-m7.service` (system unit) nebo
`/run/user/<uid>/credentials/intentsmith-m7.service` (user unit).

Než unit spustíš, nezávisle si poznamenej:

```bash
ip -brief address show dev tailscale0
ss -ltnp
```

`tailscale0` nahraď schváleným `wg*` nebo `tun*`, pokud používáš jinou VPN.
Wi-Fi/LAN adresa, loopback, wildcard a veřejná adresa jsou zakázané.

Konfigurační env neobsahuje secrets:

```text
INTENTSMITH_M7_REMOTE_ENABLED=true
INTENTSMITH_M7_VPN_INTERFACE=tailscale0
INTENTSMITH_M7_BIND_ADDRESS=<exact-vpn-ip>
INTENTSMITH_M7_SERVER_ORIGIN=https://<vpn-name-or-ip>:7443
INTENTSMITH_M7_SERVER_SPKI_SHA256=sha256:<64-lowercase-hex>
```

Aktivace musí selhat, pokud interface/adresa zmizí, credential directory nebo
mode nesedí, certifikát neodpovídá key, SPKI digest nesedí nebo HMAC nemá 32
bajtů. Tento runbook sám systemd ani firewall nemění.

## 3. Postavit přesně připnutý Android kandidát

Server používá proměnnou `INTENTSMITH_M7_SERVER_SPKI_SHA256`, Android build
záměrně používá `C3_M7_SERVER_SPKI_PIN`. Hodnoty musí být bajtově stejné.

```bash
C3_MOBILE_TRANSPORT_MODE=remote-core-v1 \
C3_MOBILE_APP_URL=https://<vpn-name-or-ip>:7443 \
C3_M7_SERVER_SPKI_PIN=sha256:<64-lowercase-hex> \
npm run mobile:android:build
```

Release build bez externího `mobile-app/android/keystore.properties` a
candidate signing key selže. `npm run mobile:android:keystore` vytváří pouze
interní prototypový klíč a nesmí se použít pro release.

Na testovaný telefon instaluj přesně vzniklý APK; `remote-core-v1` nikdy
neotevírá `adb reverse`:

```bash
C3_MOBILE_TRANSPORT_MODE=remote-core-v1 npm run mobile:android:run
```

## 4. Vydat jednorázové párování

Listener musí být už úspěšně navázaný. Teprve potom se v lokálním Studiu stane
dostupnou autentizovaná route:

```text
POST /api/m7/remote/pairing/claims
{"scopes":[...seřazený explicitní seznam...]}
```

Route přijme výhradně skutečný `local-capability` user subject. Actor se
nepřebírá z body. Odpověď obsahuje single-use `intentsmith://pair?code=...`
claim s přesnou platností pět minut a `Cache-Control: no-store`. Kód nevydávej
na vzdáleném listeneru a neukládej ho do evidence.

## 5. Provést fyzickou matici

Postup a přesné názvy třinácti release checků jsou v
[DEVICE-MATRIX-RUN.md](DEVICE-MATRIX-RUN.md). Každý PASS/FAIL musí odkazovat na
alespoň jeden privátní observation artifact. Zakázané jsou zejména secrets,
pairing claim, private keys, HMAC key, auth headers a obsah uživatelského chatu.

Evidence directory musí být kanonický nesymlinkovaný adresář s mode `0700`;
index i artefakty musí mít mode `0600`. `MobileM7RuntimeEvidence@1` váže:

- candidate SHA a tree;
- přesný APK, AAB, oba signery a source manifest;
- origin, SPKI, descriptor a adapter manifest;
- fyzický device/API/build;
- přesně seřazenou množinu checků a content-addressed artefakty.

Červený, ale strukturálně validní záznam je pravdivá evidence a release dál
blokuje. Pretty-printed, nekanonický, symlinkovaný, world-readable, příliš velký
nebo změněný soubor fail-closed.

## 6. Vytvořit release evidence

Po fyzickém běhu musí být stejné APK/AAB stále v Gradle outputu. Evidence je
odmítne, pokud jejich bytes, signer, source revision nebo runtime binding
nesedí:

```bash
npm run mobile:android:evidence -- \
  --expected-apk-signer-sha256 <64-hex> \
  --expected-aab-signer-sha256 <64-hex> \
  --runtime-evidence /absolute/private/path/runtime-evidence.json
```

Výstup je non-clobbering adresář
`.intentsmith-artifacts/mobile-release/<sha12>-<run>/` s mode `0700`; kopie APK,
AAB a evidence soubory mají mode `0600`. Manifest nese retained paths i jejich
digesty. Samotná klasifikace `CANDIDATE_SIGNED_UNREVIEWED` není acceptance.

`--allow-dirty` je povolen jen společně s `--allow-debug-signer`, bez signer
pinů a bez runtime evidence. Takový výstup je throwaway důkaz sestavitelnosti,
nikoli kandidát.

## 7. Co zůstává externím gate

- systemd credential ceremony a skutečná aktivace unity;
- VPN/firewall pozorování bez public/LAN ingressu;
- candidate signing custody a distribuční rozhodnutí;
- fyzická matice včetně TalkBack/200 % fontu;
- nezávislé review přesného product candidate a evidence;
- M5/M6 operátorské receipts a release promotion.

Dokud tyto kroky neproběhnou, správný stav je
`IMPLEMENTATION_GREEN / REAL_VPN_DEVICE_EVIDENCE_BLOCKED / NOT_ACCEPTED`.
