# M7 fresh retained APK/AAB evidence — 2026-08-29

**Stav:** `CURRENT_HOST_GREEN / THROWAWAY_DEBUG_SIGNED / REVIEW_PENDING /
NOT_DISTRIBUTABLE`

## Vazba

- exact product candidate: `f24ff9c9e032290d751306e7649430c50b1c5867`;
- product tree: `8838090d5218adc40e541689c156d26dea6d8cc2`;
- branch: `codex/m7-mobile-contract-integration-20260829`, bez upstreamu;
- build origin: `http://127.0.0.1:3336`;
- signer: výslovně povolený Android debug certifikát, SHA-256
  `4be471bc1064e2732735c18358ed1a118449c79a0f1ba3ff55d0b36bacb8951c`.

Produkční signing nebyl proveden ani autorizován. Tyto archivy jsou pouze
current-host důkaz sestavitelnosti a content bindingu; nesmějí se distribuovat.

## Skutečně vygenerované archivy

| Artefakt | Retained cesta | Bajty | SHA-256 |
|---|---|---:|---|
| APK | `.intentsmith-artifacts/mobile-release/f24ff9c9e032/IntentSmith-f24ff9c9e032-throwaway-debug-signed.apk` | 1 341 255 | `fbbf44a3ecf8cf6fe2078348e2f0941a41d66b959362098a705da6487a346029` |
| AAB | `.intentsmith-artifacts/mobile-release/f24ff9c9e032/IntentSmith-f24ff9c9e032-throwaway-debug-signed.aab` | 1 703 624 | `2f9bf0ff0a5a268be7502d25ede6388a46f6ce5f128d3d428bd0b250d9f070ac` |

Evidence manifest je
`.intentsmith-artifacts/mobile-release/f24ff9c9e032/manifest.json`, SHA-256
`f26470bd926a5e625554156412f530a28b66493479d0afae2adfb2ccf8da57ed`.
Obě `retainedPath` hodnoty existují a jejich samostatně přepočítané digesty
odpovídají manifestu; volatilní Gradle `artifacts[].path` se jako autorita
nepoužil.

## Nezávislé nativní pozorování

APK rozřešil network-security resource jako `res/8G.xml`, AAB přes bundletool
jako `res/xml/network_security_config.xml`. Obě odlišné cesty daly stejný
content digest:

```text
30d476e0e9c5af330541794a506690ce996ec81301808f2bedde19cb75891aa2
```

Oba archivy nesou exact source revision `f24ff9c9…`, application ID
`cz.intentsmith.companion`, version `1 / 1.0`, minSdk 24, targetSdk 36 a stejný
signer. Source manifest digest je
`e23132ceea2c4cffc500d2df0db2f0e84f1ca2af5c380eb0401111fd097db883`.
Runtime audit našel 0 produkčních zranitelností; SBOM je CycloneDX 1.5.

## Příkazy a výsledky

```text
C3_MOBILE_ALLOW_DEBUG_SIGNING=yes-i-know npm run mobile:android:build
  BUILD SUCCESSFUL; APK + AAB

npm run mobile:android:evidence -- --allow-debug-signer
  THROWAWAY_DEBUG_SIGNED; runtime audit 0

node --test tests/mobile-android-release.test.js
  15/15 PASS

node scripts/mobile-gate.js
  30/30 PASS

node tests/harness-exit-code.test.js
  122 database-reachable rootů chráněno; PASS

node tests/module-boundary-ratchet.test.js
  13/13 PASS

node tests/artifact-validation.test.js
  158/158 PASS
```

První harness běh pravdivě skončil FAIL na stale pinu `122 !== 121`. O-04
test byl nový database-reachable root; pin i důvod jsou opravené v
`f24ff9c9`. Nešlo o obarvení stejného běhu.

## Pravdivé blokátory

Evidence manifest stále uvádí:

- `M7_REMOTE_LISTENER_AUTH_PAIRING_AND_WIRE_TRANSPORT_NOT_IMPLEMENTED`;
- `CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED`.

`releaseTransportReady` je `false`. Fyzické zařízení, TalkBack matice,
produkční signer, store upload, distribuce, LAN/VPN listener, live LLM, Ollama
a GPU nebyly v tomto bloku spuštěné.
