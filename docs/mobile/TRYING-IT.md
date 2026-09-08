# Jak ověřit současného mobilního kandidáta

Vývojový vstup je [README](README.md). Přesný candidate a výsledky tohoto řezu
uvádí [completion evidence](../execution/runs/mobile/mobile-completion-20260908.md).
Základem je M7 integrace `de0e81275afa381dd6a73afbb699bde47971b658`;
pracovní větev `work/mobile-completion-20260908`. Návod není release acceptance.

## Režimy se nesmějí zaměnit

| Režim | Co lze ověřit | Co z něj neplyne |
|---|---|---|
| Browser a řízené fixtures | Skutečný bundled DOM, CSS, klientské chování | AndroidKeyStore, fyzický TalkBack, live BE |
| `legacy-m1-dev` | Historický klient a development build | Produkční M7 ani fallback pro jeho výpadek |
| M7 VPN runtime v core | Existující TLS listener, session authority a server wiring | Aktivace, hotový mobilní consumer ani device journey |
| Debug-signed APK/AAB | Compile, lint a artifact binding | Podpis distribuovatelného releasu |

Tento checkout nemá spustitelnou prototypovou gateway ani package scripts
`mobile:seed`, `mobile:gateway`, `mobile:pair`. Neimportuj kvůli starému návodu
legacy server nebo migrace. Pouhé přepsání `C3_MOBILE_APP_URL` na HTTPS
nezmění `legacy-m1-dev` na M7 signed-session transport.

## Ověření ve vlastním checkoutu

Příkazy spouštěj z kořene vlastního checkoutu, bez souběžného writeru/runneru:

```bash
npm ci --offline --no-audit --no-fund
npm --prefix mobile-app ci --offline --no-audit --no-fund
LC_ALL=C npm run test:mobile
npm run test:registry
npm run test:deterministic
git diff --check
```

Offline cache musí obsahovat i Puppeteer Chromium. Chybějící runtime je
prerekvizita, nikoli PASS. Neměň gate na skip; případné síťové provisionování
odděl od samotného offline testu. Artefaktový adresář musí zůstat privátní
(0700); bootstrap si jej při prvním testu vytvoří sám.

## Android build

Verze určují lockfile a Gradle konfigurace: Capacitor 8.5.0, JDK 21,
SDK/target API 36, Gradle wrapper 8.14.3, AGP 8.13.0.
`JAVA_HOME` a `ANDROID_HOME` lze nastavit na vlastní toolchain; wrapper zde
používá výchozí `$HOME/toolchain/jdk21` a `$HOME/toolchain/android-sdk`.

Bez produkčního klíče vytvoř pouze explicitně označený lokální throwaway:

```bash
C3_MOBILE_ALLOW_DEBUG_SIGNING=yes-i-know npm run mobile:android:build
```

Wrapper provádí `cap sync`, generuje runtime konfiguraci, CSP a source manifest,
potom APK i AAB. Přímé `cap sync` + Gradle samo source manifest nepřipraví.
Build dočasně upraví network policy a po skončení ji obnoví; zkontroluj Git.

Signing-independent kontroly po synchronizaci assets:

```bash
(cd mobile-app/android && ./gradlew --offline --no-daemon :app:testDebugUnitTest :app:lintRelease)
```

Evidence se vytváří nad stejným čistým commitem jako build:

```bash
npm run mobile:android:evidence -- --allow-debug-signer
```

Generator používá i síťový `npm audit`; nejde o offline gate. Ověřuje oba
archivy, signery, metadata, source manifest, network policy a ukládá kopie
APK/AAB, SBOM a audit do `.intentsmith-artifacts/mobile-release/<short-SHA>/`.
`--allow-dirty` je pouze diagnostika: `THROWAWAY_DIRTY_SOURCE`, ověřený
`sourceRevision: null`, nikdy `releaseTransportReady: true`. SHA deklarované
uvnitř archivu není u dirty buildu ověřenou Git proveniencí.

Produkční podpis nepořizuj prototypovým `mobile:android:keystore`.
Pro skutečný release jsou nutné oddělené očekávané APK/AAB signer digesty
(`--expected-apk-signer-sha256`, `--expected-aab-signer-sha256`) a schválená
distribuce. Debug build nesmí být vydáván za produkční artefakt.

## M7 a fyzické ověření

[Decision 042](../decisions/042-m7-vpn-listener-and-pairing-authority.md)
vyžaduje konkrétní VPN rozhraní, HTTPS port 7443, TLS 1.3, SHA-256 SPKI pin,
systemd credential custody a podepsané session/invocations. Pairing vydává
autentizované lokální Studio; kód je single-use a platí pět minut.
Žádný fallback na HTTP, LAN, USB `/m1` nebo proxy.

`mobile:android:doctor`, `reverse` a `run` stále popisují historickou USB `/m1`
cestu, nikoli M7 setup. `doctor` může spustit lokální adb daemon. Těmito příkazy
nelze prokázat VPN readiness; jejich náhrada patří do connector integration.
Tento návod neaktivuje server, síť, credentials ani skutečné pairing.

Na tomto hostu 2026-09-08 byl dostupný Temurin 21.0.12+8, SDK 36/build-tools
36.0.0 a cached Gradle 8.14.3. `adb devices -l` neukázalo zařízení;
`ip -brief address` neukázalo VPN rozhraní. To jsou časově omezená pozorování,
nikoli nadčasové požadavky. Přítomná cache není důkaz úspěšného buildu.

Fyzický protokol [DEVICE-MATRIX-RUN](DEVICE-MATRIX-RUN.md) zůstává historickou
USB referencí. M7 matice musí navíc měřit SPKI mismatch, replay, session
expiry/revokaci a VPN výpadek. Dále pairing, process death/reboot, lock/wipe,
ambiguous mutation recovery, TalkBack, 200% font a soft keyboard.
Prázdné řádky zůstávají `NOT_RUN`; headless browser je nenahrazuje.

## Hranice převzetí novějšího UI

Donor `5cd14776` není kompatibilní jako celek: jeho `/m1` DTO a scope `memory`
nejsou B `stored_information`; settings i project detail mají jiný tvar.
B conversation list nemá donorový `projectId` filtr. Workers, specialisté a
správa zařízení potřebují BE-owned capability/operation kontrakty.
Převzetí obrazovky bez nich není hotová funkce. Chybějící data nesmějí být
prázdný úspěch a samotný scope nenahrazuje serverovou availability capability.
