# Jak si mobilní kandidát zkusit

Praktický runbook pro větev `codex/mobile-prod-client-20260826`. Aktuální
verdikt a prod-ready mezery jsou v [FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md).
Tento návod není release evidence a nemění backendový kontrakt.

Android aplikace obsahuje podepsanou lokální kopii `src/mobile/client`.
Gateway poskytuje jen data; neservíruje JavaScript s přístupem k native vaultu.
Výchozí spojení je `127.0.0.1:3336` přes USB `adb reverse`.

## 1. Ověřit klienta bez backendových změn

    cd /home/belphareon/worktrees/is-mobile-prod-client-20260826
    npm ci
    npm --prefix mobile-app ci
    npm run test:mobile
    npm run test:registry

Samostatné nejdůležitější klientské programy:

    node --test tests/mobile-secure-credential.test.js
    node --test tests/mobile-browser-a11y.test.js
    node --test tests/mobile-android-release.test.js

Browser režim slouží k vývoji a accessibility testům. Nemá AndroidKeyStore a
není produkčním security boundary.

## 2. Android toolchain a release build

Požadavky kandidáta: JDK 21, Android SDK 36, Gradle wrapper 8.14.3 a
Capacitor 8.5.0.

    npm run mobile:android:doctor

Produkční release build je fail-closed. Bez `mobile-app/android/keystore.properties`
a klíče mimo repo musí skončit chybou:

    npm run mobile:android:build

Pro lokální důkaz sestavitelnosti lze použít explicitně označený debug signer;
takový APK/AAB se nesmí distribuovat:

    cd mobile-app
    npx cap sync android
    cd android
    ./gradlew --no-daemon \
      :app:testDebugUnitTest :app:lintRelease \
      :app:assembleRelease :app:bundleRelease \
      -PallowDebugSigning=true

Evidence nad hotovým artefaktem:

    cd /home/belphareon/worktrees/is-mobile-prod-client-20260826
    npm run mobile:android:evidence -- --allow-debug-signer --allow-dirty

Bez `--allow-debug-signer` evidence skript debug certifikát odmítne; bez
`--allow-dirty` odmítne připsat artefakt k necommitnutému HEAD. Ukládá
manifest, SHA-256 konkrétního APK/AAB, podpis, package/SDK badging, Gradle
dependencies, runtime audit, CycloneDX SBOM a licence do ignorovaného
`.intentsmith-artifacts/mobile-release/<commit>/`.

## 3. Interní USB journey se současnou prototypovou gateway

Následující kroky pouze spotřebovávají zmrazený prototypový `/m1` kontrakt.
Nejsou akceptací rozpracovaného M5/M6 ani implementací M7 transportu.
Telefon musí mít před pairingem nastavený systémový zámek obrazovky; klient
jinak kód neclaimne a native vault credential odmítne.

    npm run mobile:seed -- --db /tmp/is-demo.db

V terminálu 1:

    C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on npm run mobile:gateway

V terminálu 2:

    npm run mobile:android:reverse
    C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on npm run mobile:pair -- \
      --scopes read:capabilities,read:chat,write:chat,read:notifications,write:notifications,read:approvals,write:approvals

QR používá interní `intentsmith://pair?code=...` deep link a klient jednorázový
kód předvyplní. Webová fallback URL zůstává ve výstupu skriptu. Custom scheme
není verified App Link a je vhodné jen pro pilot; produkční discovery/pairing
musí dodat M7.

Pak lze nainstalovat/spustit již podepsaný interní build:

    npm run mobile:android:run

`run` otevře `adb reverse`, nainstaluje APK a spustí
`cz.intentsmith.companion`. Gateway zůstává na loopbacku a nic se neotevírá do
Wi-Fi.

## 4. Development build proti HTTPS gateway

Jen pro connector/pilot po potvrzení adresy:

    C3_MOBILE_APP_URL=https://mobile-gateway.example.internal \
      npm run mobile:android:build

Hodnota musí být čistý HTTP(S) origin bez credentials, path, query, fragmentu
nebo wildcard hostu. Cleartext mimo loopback vyžaduje explicitní
`C3_MOBILE_APP_ALLOW_CLEARTEXT=yes-i-know` a není produkční doporučení.
Build přepíše pouze generovaný `runtime-config.js` v Android assets a po buildu
vrátí trackovanou network policy do původního stavu.

## 5. Co na fyzickém telefonu ověřit

Použij [DEVICE-MATRIX-RUN.md](DEVICE-MATRIX-RUN.md). Minimálně:

1. pairing vložením i deep linkem a jednorázovost kódu;
2. Home/recents/process death/reboot a systémové odemčení;
3. approve, reject, expire/changed precondition a nejasný výsledek;
4. odpojení USB, gateway outage, airplane mode a reconnect;
5. revoke/logout wipe a nové pairing identity;
6. TalkBack, 200% font, rotaci, soft keyboard a malý displej.

Prázdný řádek nebo emulátor není PASS fyzické matice.

## 6. Známé produktové hranice

| Oblast | Současná pravda |
|---|---|
| Remote síť | `BLOCKED_ON_M7` — bez production listeneru/TLS identity |
| Párování | prototypový one-time code; custom scheme není verified App Link |
| Push | není; klient je pull-only |
| Projekty/search/typed run detail | čekají na autoritativní backendový kontrakt |
| Browser storage | vývojové, ne production secure |
| Signing/distribuce | bez produkční identity a store účtů |
| Fyzická matice | `NOT RUN` |
| Release review | `REVIEW_PENDING` |

Správné označení dnešního výsledku je `CLIENT_P1_IMPLEMENTATION_GREEN`, ne
`PROD_READY`.
