# IntentSmith Mobile — kanonický prototyp a cesta k production-ready

**Datum konsolidace:** 2026-08-18

**Kanonická větev prototypu:** `wp/mobile-prototype-20260817`

**Runtime implementace a APK:** `485c34977078a46cc397b9b3807f6a311fc906ba`

**Verdikt:** `CURRENT-HOST EMULATOR JOURNEY VERIFIED`; fyzický telefon,
fresh-clone reprodukce a production release jsou `NOT RUN` / `NOT READY`.

Tento soubor je jediný aktuální stavový a rozhodovací rozcestník pro mobilní
prototyp. Návod k obsluze je v [TRYING-IT.md](TRYING-IT.md), historické
implementační vysvětlení přesměrovává sem z [PROTOTYPE.md](PROTOTYPE.md) a
raw obrazová evidence zůstává v [`prototype-evidence/`](prototype-evidence/).

> Tento dokument sjednocuje prototypové větve, ale nepřebíjí projektové
> autority [`PRODUCT.md`](../../PRODUCT.md), [`CONTRACT.md`](../../CONTRACT.md),
> [`DIRECTION.md`](../../DIRECTION.md), [`ROADMAP.md`](../../ROADMAP.md) ani
> [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md). Remote Companion je podle roadmapy
> samostatný M7 release. Implementační rozhodnutí
> [024](../decisions/024-mobile-companion-producer-and-shell.md) stále čeká na
> přijetí operátorem.

## 1. Jedna jasná cesta k dnešnímu prototypu

| Co | Kanonická hodnota |
|---|---|
| Worktree | `/home/belphareon/worktrees/is-mobile-prototype` |
| Větev | `wp/mobile-prototype-20260817` |
| Zdroj runtime a APK | `485c34977078a46cc397b9b3807f6a311fc906ba` |
| Vstupní mobile baseline | `2fcc2ff357238e4736a15a9e01affa14183e37ef` |
| APK | `mobile-app/android/app/build/outputs/apk/release/app-release.apk` |
| Absolutní cesta APK | `/home/belphareon/worktrees/is-mobile-prototype/mobile-app/android/app/build/outputs/apk/release/app-release.apk` |
| SHA-256 APK | `3b669cea68967b2fbe7d76d99a7de31715fdd8457bc3f7c72d681acde675d10b` |
| Package | `cz.intentsmith.companion` |
| Podpis | interní RSA-4096; cert SHA-256 `9c8aafc3a480e0eccf8230e324fede05f3b3e6db62bd5aea75e539af1e5bf786` |
| Ověřená platforma | Android 15 emulátor, `x86_64`, API 35, KVM |
| Fyzický telefon | `NOT RUN` |
| Push / vzdálený listener | není součástí prototypu |

APK je interní artefakt pro USB demonstraci. Není to store build ani release
kandidát. Jeho hash a podpis patří přesně implementačnímu commitu výše; pozdější
dokumentační commit obsah aplikace nemění.

Nejkratší bezpečný postup je:

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
npm ci --offline
npm --prefix mobile-app ci --offline
npm run mobile:seed -- --db /tmp/is-demo.db
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on npm run mobile:gateway
npm run mobile:android:run
```

Párování a ★ approval demonstrace jsou rozepsané v
[TRYING-IT.md](TRYING-IT.md). Gateway zůstává na `127.0.0.1:3336`; telefon se k
ní dostane jen přes USB `adb reverse`. Nic se nevystavuje do Wi-Fi.

## 2. Co znamená „nejlepší z obou“

Vznikly dva nezávislé kandidáty. Jejich celé větve se nemají mechanicky slít:
obě mění shell, klienta, lockfile a registry jiným způsobem. Správný výsledný
směr je selektivní integrace jejich silných vrstev.

| Zdroj | Co z něj bereme | Co z něj neděláme |
|---|---|---|
| `wp/mobile-prototype-20260817` / `485c3497` | kanonický dnes spustitelný prototyp; producent approvalů, S1 projektor, indikátory `CoreEvent`, Android shell a manuálně ověřený emulator journey | demo producent nevydáváme za zapojené produkční jádro a PIN shell za finální security boundary |
| `codex/mobile-prototype-20260817` / implementace `fda3fc43`, výsledkový HEAD `78ca9f38` | referenční hardening: Capacitor 8, target API 36, přímý AndroidKeyStore AES-GCM, systémový `BiometricPrompt`, vyčištění JS session, abort/epoch guard a striktní build/install kontrola | nevydáváme jej za device-ověřený prototyp; jeho approval je syntetický a nemá producenty |

Bezpečnostní kandidát je tedy **zdroj pro port vybraných změn**, ne druhá
kanonická aplikace. Jeho úplný dobový protokol lze přečíst bez přepnutí větve:

```bash
git show 78ca9f38:docs/mobile/WP-MOBILE-ANDROID-PROTOTYPE-CODEX-20260817-RESULT.md
```

Výsledná prod cesta má zachovat běžící producenty a pozorovaný journey z
`485c3497`, ale nahradit nebo zpevnit shell podle bezpečnostních vlastností z
`fda3fc43`. Takový hybridní kód **zatím nevznikl**; tento dokument jej
definuje jako následující integrační WP, nikoli jako hotovou skutečnost.

## 3. Pravdivý stav dnešního prototypu

| Oblast | Stav | Co bylo skutečně ověřeno | Hranice tvrzení |
|---|---|---|---|
| Párování a čtení SQLite | `EMULATOR VERIFIED` | párování, seznam konverzací, stránkovaná historie, přehled, trust bar a žurnál | pouze current-host emulátor; žádná fresh-clone ani fyzická device matice |
| ★ approval | `DEMO JOURNEY VERIFIED` | telefon rozhodl durable approval a demo po schválení vytvořilo soubor | producenta volají jen testy a `mobile-demo-run.js`; skutečný core effect seam jej nevolá |
| Approval authority | `COMPONENT IMPLEMENTED` | mint jde přes `createMobileApproval`, má výpočet otisku, vazbu a pětiminutové okno | rozhodnutí 024 čeká na přijetí; nejde o přijatou produkční authority |
| Notifikační schránka | `DEMO PRODUCER IMPLEMENTED` | uzavřený devítivětý S1 slovník bez obsahu, zobrazený na emulátoru | je to pull; bez push a bez zapojení do skutečného core lifecycle |
| Průběh běhu | `DEMO PROJECTION IMPLEMENTED` | demo mapuje `CoreEvent` do S1 indikátorů ve schránce | není vlastní run obrazovka ani produkční CoreEvent konektor |
| Android shell | `EMULATOR VERIFIED` | instalace/launch, gateway přes `adb reverse`, background lock a `FLAG_SECURE` | Capacitor 6, minSdk 22, compile/target 34 a servírované UI přes `server.url` jsou prototypová konfigurace |
| Token at rest | `PARTIAL` | credential je v Keystore-backed encrypted preferences; backup je vypnutý | [`EncryptedSharedPreferences` je deprecated](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences) a token se při bootu načte do JS paměti |
| Background lock | `PARTIAL` | `onPause` schová WebView a zamkne vault; po PINu proběhne reload | již načtený JS token se při `onPause` nevymaže a aktivní requesty se neabortují; úplná lifecycle revokace není prokázaná |
| Odemčení | `PROTOTYPE ONLY` | vlastní PIN, limit pokusů a wipe cesta | bez systémové biometrie/device credentialu a bez fyzického testu |
| APK a podpis | `INTERNAL BUILD VERIFIED` | konkrétní APK má interní podpis a ověřený hash | build umí fallback na debug podpis a kontrola podpisu ve skriptu není fail-closed; žádná release key ceremony |
| Síť | `USB LOOPBACK ONLY` | `adb reverse` zachovává gateway na loopbacku | žádný vzdálený listener, VPN support claim, TLS ani push |
| Accessibility | `BLOCKED` | automatická browser sada má deklarovanou chybějící Chromium prerekvizitu | 200% text, TalkBack a fyzická AT matice nejsou PASS |

Nejdůležitější upřesnění proti starému popisu: po approval v demu provádí
`scripts/mobile-demo-run.js` přímý `fs.writeFileSync`. Pořadí je správné — efekt
nastane až po souhlasu — ale není to skutečný executor/effect broker. Proto je
produkční F-100 integrace stále otevřená.

## 4. Důkazy, které dnes existují

Na runtime snapshotu a znovu po dokumentační konsolidaci prošlo:

- `npm run test:mobile`: **27/27 aktivních mobilních programů PASS**;
- `mobile-browser-a11y`: **BLOCKED** na deklarované Chromium prerekvizitě;
- `tests/mobile-companion-producer.test.js`: **17 PASS**;
- `tests/mobile-companion-e2e.test.js`: **5 PASS** přes vlastní gateway proces a HTTP;
- `tests/mobile-secure-credential.test.js`: **10 PASS**;
- Android `lintRelease`: **0 errors / 21 warnings**;
- `tests/artifact-validation.test.js`: **151/151 PASS**;
- registry: **405 programů** (`307 ACTIVE`, `83 BLOCKED`, `15 HISTORICAL`),
  9 explicitních support-module exclusions;
- repository hygiene: **PASS**, 1 687 trackovaných cest včetně tohoto dokumentu;
- current-host emulátor: pairing → demo run → approval → durable decision →
  soubor po schválení; obrazová evidence je v
  [`prototype-evidence/`](prototype-evidence/).

Tyto výsledky nejsou release verdict. Chybí fresh-checkout attestace root i
`mobile-app` instalace/buildu, fyzický telefon a nezávislá akceptace.

### Otevřený červený boundary gate

`node scripts/module-boundary-ratchet.mjs` zůstává **FAIL**:

```text
baselineEdges=1048 currentEdges=1051 added=3
src/notifications/index.js       -> src/notifications/channels/mobile.js
src/mobile/companion-producer.js -> src/mobile/approval-authority.js
src/mobile/companion-producer.js -> src/notifications/channels/mobile.js
```

První hrana je zděděná z mobile baseline, dvě další jsou nové producentské
hrany. Baseline se na prototypové větvi nepřepisuje. Integrátor musí hrany
samostatně přijmout, odmítnout nebo změnit architekturu; do té doby není gate
zelený.

## 5. Co přesně chybí do production-ready

„Production-ready“ zde znamená Remote Companion release podle M7 roadmapy, ne
jen APK, které lze nainstalovat. Následující položky jsou povinné a jejich
`NOT RUN`, `PARTIAL` nebo `BLOCKED` stav se nesmí přepsat na PASS.

### P0 — uzavřít pravdivý interní prototyp

1. **Rozhodnout 024.** Operátor přijme nebo odmítne producenta, S1 slovník,
   durable čekání a shell hranici. Bez přijetí zůstává producent demo-only.
2. **Zapojit skutečný effect seam.** `requestApproval()` musí volat reálná
   authority před skutečným efektem; efekt musí mít idempotenci, cancel,
   timeout, restart/recovery, audit a stav `UNKNOWN` při nejasném výsledku.
   Přímý demo zápis nesmí být produkční cesta.
3. **Selektivně portovat bezpečný shell.** Použít podporovanou Capacitor řadu
   (současná v6 je podle [oficiální support policy](https://capacitorjs.com/docs/main/reference/support-policy)
   end-of-support), aktuální Android target, přímý AndroidKeyStore, systémový
   `BiometricPrompt`/device credential a zabalené UI nebo jinou explicitně
   schválenou produkční konfiguraci. Capacitor dokumentuje
   [`server.url`](https://capacitorjs.com/docs/config) pro live reload; nesmí se
   omylem stát store runtime.
4. **Uzavřít lifecycle session.** Při backgroundu vymazat chráněnou JS relaci,
   zastavit poll/requesty, zvýšit session epoch a odmítnout pozdní odpovědi;
   po odemčení znovu načíst scopes, health a reconciliation před vykreslením
   cache.
5. **Provést fyzický device journey.** Alespoň jeden podporovaný telefon:
   install, pairing, Keystore persistence po process death, approval approve i
   reject/expire, Home/recents/lock, gateway outage a odpojení USB.
6. **Rozhodnout boundary delta.** Integrátor zkontroluje tři hrany a až poté
   změní baseline nebo implementaci. Červený ratchet se nesmí umlčet.

### P1 — interní pilot s bezpečnou distribucí

1. **Reprodukovatelný build z čistého checkoutu:** root i Android závislosti z
   lockfilů, přesná JDK/SDK/Gradle verze, jeden artefakt, applicationId,
   versionCode a signer ověřené fail-closed.
2. **Signing bez fallbacku:** oddělený interní/release flavor, chráněný klíč a
   heslo, rotace, záloha a dokumentované vlastnictví. Release nesmí potichu
   spadnout na debug key.
3. **Revokace a ztracené zařízení:** desktop musí okamžitě zrušit device token,
   aktivní granty a session; aplikace musí stav zjistit a lokálně credential
   odstranit.
4. **Push s explicitní policy:** spící aplikace musí dostat bezpečný S1
   ukazatel, nebo produkt musí pravdivě deklarovat pull-only omezení. Push
   potřebuje consent, outbound policy, credential scope, retry a audit.
5. **Datová hranice:** rozhodnout šifrování WebView/cache dat at rest,
   retention, logout wipe, backup/device-transfer a diagnostické logy bez S2/S3
   obsahu.
6. **Accessibility a zařízení:** 200% font, TalkBack, kontrast, focus order,
   malý displej, rotace, soft keyboard, offline/reconnect a vybraná OS matice.
7. **Supply chain:** dependency audit, supported-version policy, SBOM/licence a
   postup pro bezpečnostní aktualizace.

### P2 — skutečný Remote Companion release

1. Core 1.0 musí dodat přijatý a implementovaný `RemoteCorePort`; mobilní
   release podle roadmapy následuje až po M6.
2. Oddělený vzdálený listener, autentizované pairing, device scope, expiry,
   revokace a audit musí mít pozitivní i negativní boundary test.
3. Legacy `/api/*` ani `/c3/ws` nesmějí být přes vzdálenou cestu dostupné jako
   bypass.
4. Projekty, konverzace, settings, stored information, approvals,
   notifications a typed runtime events musí běžet přes verzovaný kompatibilní
   kontrakt s pravdivým degraded/offline chováním.
5. Release kandidát musí z fresh clone projít fyzickou device maticí, security
   review, data/recovery round-tripem, dlouhým během a operátorskou demonstrací.

Grafika a finální vizuální polish přicházejí až po P0/P1 funkčnosti, rozložení,
accessibility a bezpečnostních hranicích.

## 6. Doporučené pořadí následující práce

```text
přijetí / odmítnutí rozhodnutí 024
  → malý hybridní WP z runtime 485c3497
      → reálný effect seam + producer
      → port lifecycle/Keystore/BiometricPrompt hardeningu z fda3fc43
      → podporovaný Android/Capacitor build
  → fyzický USB device journey a negativní cesty
  → integrátorské boundary review
  → interní pilot
  → až po RemoteCorePort/M6 samostatný M7 remote release
```

Nevhodná zkratka je merge celých dvou prototypových větví. Bezpečnější je
vzít `485c3497` jako běžící základ a portovat po jednotlivých vlastnostech s
focused testem a device důkazem.

## 7. Dokumentační autorita a úklid

| Soubor / skupina | Role od této konsolidace |
|---|---|
| `FINAL-PROTOTYPE.md` | jediný aktuální mobilní stav, kanonická cesta a prod-ready backlog |
| `TRYING-IT.md` | pouze praktický runbook; nesmí duplikovat stavové verdikty |
| `PROTOTYPE.md` | stabilní legacy odkaz sem, nikoli druhá verze pravdy |
| `docs/decisions/024-*` | čekající implementační rozhodnutí a strop producenta |
| `prototype-evidence/` | point-in-time obrazová evidence z emulátoru |
| `WP-MOBILE-*`, `PLAN.md`, `SCREENS.md`, `UI-DESIGN.md`, návrh kontraktu v2 | historické návrhy, WP evidence nebo budoucí scope; nejsou aktuální stavový souhrn |

Historické soubory se nemažou: dokazují, co bylo navrženo a ověřeno. Rozkol se
odstraňuje jasnou autoritou, ne zničením evidence. Worktrees a větve jsou také
zachované; jejich odstranění je samostatná destruktivní operace a není součástí
tohoto úklidu.

## 8. Akceptační checklist pro označení „prod-ready“

- [ ] Rozhodnutí 024 je operátorem uzavřené.
- [ ] Approval producer je zapojený do skutečného core effectu, ne jen dema.
- [ ] Background revokuje JS session a aktivní requesty; late response je inertní.
- [ ] Použitá Capacitor/Android řada je podporovaná a production konfigurace
      nenačítá vývojový server.
- [ ] Build je reprodukovatelný z čistého checkoutu a podpis je fail-closed.
- [ ] Fyzický telefon prošel approve/reject/expire, outage, restart a lost-device scénáři.
- [ ] Accessibility a podporovaná device/OS matice jsou PASS.
- [ ] Boundary ratchet je přijatý integrátorem, ne pouze přebaselinovaný.
- [ ] Push nebo deklarovaný pull-only model má přijatou bezpečnostní a provozní policy.
- [ ] `RemoteCorePort`, oddělený listener, pairing, revokace a legacy-bypass
      negativní test jsou PASS.
- [ ] Fresh-clone release artefakt odpovídá testovanému commitu a operátor jej
      přijal po skutečné demonstraci.

Dokud není zaškrtnutý celý seznam, správné označení je **interní mobilní
prototyp**, ne production-ready aplikace.
