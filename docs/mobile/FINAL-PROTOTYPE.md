# IntentSmith Mobile — kanonický prototyp a cesta k production-ready

**Datum konsolidace:** 2026-08-18

**Kanonická větev prototypu:** `wp/mobile-prototype-20260817`

**Runtime implementace a APK:** `HEAD` větve (hardening po konsolidaci —
lifecycle, systémový zámek, fail-closed podpis). Předchozí snapshot
`485c34977078a46cc397b9b3807f6a311fc906ba` je archivovaný v
[`archive/PROTOTYPE-485c3497.md`](archive/PROTOTYPE-485c3497.md).

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
| Zdroj runtime a APK | `HEAD` (hardening); předchozí `485c3497` v archivu |
| Vstupní mobile baseline | `2fcc2ff357238e4736a15a9e01affa14183e37ef` |
| APK | `mobile-app/android/app/build/outputs/apk/release/app-release.apk` |
| Absolutní cesta APK | `/home/belphareon/worktrees/is-mobile-prototype/mobile-app/android/app/build/outputs/apk/release/app-release.apk` |
| SHA-256 APK | `c22254de1b19cc0a558dc5c118e694311e60fb7766a3e55a3d7f9e4ea036856d` |
| Package | `cz.intentsmith.companion` |
| Podpis | interní RSA-4096; cert SHA-256 `9c8aafc3a480e0eccf8230e324fede05f3b3e6db62bd5aea75e539af1e5bf786` |
| Ověřená platforma | Android 15 emulátor, `x86_64`, API 35, KVM |
| Fyzický telefon | `NOT RUN` |
| Push / vzdálený listener | není součástí prototypu |

APK je interní artefakt pro USB demonstraci. Není to store build ani release
kandidát. Hash výše patří buildu z `HEAD`; každý další build ho změní, protože
APK není bit-reprodukovatelné (razítka, pořadí v zipu) — reprodukovatelnost je
položka `P1` v [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md), ne tvrzení
o dnešku. Kontrolovat se dá **podpis**, ne hash: cert SHA-256 výše je stabilní.

Nejkratší bezpečný postup je:

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
npm ci --offline
npm --prefix mobile-app ci --offline
npm run mobile:seed -- --db /tmp/is-demo.db

# Terminál 1 — gateway drží terminál obsazený, dokud běží.
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on npm run mobile:gateway
```

```bash
# Terminál 2 — telefon, párovací kód, běh
npm run mobile:android:run
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node scripts/mobile-pair.js \
  --scopes read:capabilities,read:chat,write:chat,read:notifications,write:notifications,read:approvals,write:approvals
npm run mobile:demo -- --db /tmp/is-demo.db
```

Bez kroku s `mobile-pair.js` se aplikace zastaví na párovací obrazovce a nemá
co zadat; approvaly navíc **nejsou ve výchozích scopech** (`P-8`), takže je
příkaz žádá výslovně. Podrobnosti a co si při klikání všímat jsou v
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
| Token at rest | `PARTIAL` | credential je v Keystore-backed encrypted preferences; backup je vypnutý; JS kopie se při zamčení zahazuje | [`EncryptedSharedPreferences` je deprecated](https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences); mezi odemčením a zamčením kopie v JS paměti existuje |
| Background lock | `EMULATOR VERIFIED` | `onPause` zapečetí vault, pošle do stránky `intentsmithLock` (zahodí credential z paměti, zruší běžící requesty, zneplatní epochu) a zvedne překryv; pozdní odpověď je inertní | ověřeno na emulátoru a šesti testy; fyzický telefon `NOT RUN` |
| Odemčení | `EMULATOR VERIFIED` | systémový `BiometricPrompt` (otisk / obličej / PIN telefonu); po odemčení se stránka reloadne a čte z trezoru | vlastní PIN zůstává jen pro telefon **bez** zámku obrazovky; fyzická biometrie `NOT RUN` |
| APK a podpis | `INTERNAL BUILD VERIFIED` | release build **selže**, když chybí podpisový klíč; interní podpis ověřen `apksigner` | `-PallowDebugSigning=true` je vědomý únik pro jednorázový build; žádná release key ceremony |
| Síť | `USB LOOPBACK ONLY` | `adb reverse` zachovává gateway na loopbacku | žádný vzdálený listener, VPN support claim, TLS ani push |
| Accessibility | `BLOCKED` | automatická browser sada má deklarovanou chybějící Chromium prerekvizitu | 200% text, TalkBack a fyzická AT matice nejsou PASS |

Nejdůležitější upřesnění proti staršímu popisu: po approval v demu provádí
`scripts/mobile-demo-run.js` přímý `fs.writeFileSync`. Pořadí je správné — efekt
nastane až po souhlasu — ale není to skutečný executor/effect broker. Proto je
produkční F-100 integrace stále otevřená.

### Co změnil hardening po konsolidaci

Tři výhrady z porovnávacího review byly oprávněné a jsou zapracované, ne
odargumentované:

1. **Zámek zapečeťoval trezor, ale ne stránku.** WebView si po bootu drží
   credential v paměti a překryv na to nesahá. `onPause` teď posílá do stránky
   `intentsmithLock`: credential z paměti zmizí, běžící requesty se zruší a
   epocha se posune, takže odpověď, která dorazí po zamčení, se zahodí místo
   aby překreslila zamčenou relaci. Šest testů v
   `tests/mobile-secure-credential.test.js` drží každou z těch vlastností zvlášť.
2. **Vlastní PIN byl slabší než zámek, který telefon už má.** Primární cesta je
   teď systémový `BiometricPrompt` s `DEVICE_CREDENTIAL`; aplikační PIN zůstává
   výhradně pro telefon bez zámku obrazovky a obrazovka nastavení říká, který
   z nich platí. Zrušený prompt neodemyká a **nepropadá** na slabší PIN.
3. **Release build mohl tiše podepsat debug klíčem.** Teď bez klíče selže.

Čtvrtou vadu našel až běh na emulátoru, ne čtení kódu: aplikace se zamykala i
**před spárováním**, takže první obrazovkou po instalaci byl systémový prompt
hlídající prázdnou schránku. Zámek se teď zapíná až když je co chránit.

## 4. Důkazy, které dnes existují

Na runtime snapshotu a znovu po dokumentační konsolidaci prošlo:

- `npm run test:mobile`: **27/27 aktivních mobilních programů PASS**;
- `mobile-browser-a11y`: **BLOCKED** na deklarované Chromium prerekvizitě;
- `tests/mobile-companion-producer.test.js`: **17 PASS**;
- `tests/mobile-companion-e2e.test.js`: **5 PASS** přes vlastní gateway proces a HTTP;
- `tests/mobile-secure-credential.test.js`: **17 PASS** (10 úložiště + 7 lifecycle);
- Android `lintRelease`: **0 errors / 21 warnings**;
- `tests/artifact-validation.test.js`: **151/151 PASS**;
- registry: **405 programů** (`307 ACTIVE`, `83 BLOCKED`, `15 HISTORICAL`),
  9 explicitních support-module exclusions;
- repository hygiene: **PASS**, 1 687 trackovaných cest včetně tohoto dokumentu;
- current-host emulátor: pairing → demo run → approval → durable decision →
  soubor po schválení, a po hardeningu znovu celé včetně cyklu
  pozadí → `BiometricPrompt` → device credential → reload → funkční relace;
  obrazová evidence je v [`prototype-evidence/`](prototype-evidence/).

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
   Dvě věci, které z 024 vypadly jako samostatná rozhodnutí, protože nejsou
   implementační: [025 — jak dlouho approval čeká a jak se o něm dozvíš](../decisions/025-approval-window-and-push.md)
   a [026 — přístup k gateway bez kabelu](../decisions/026-wireless-gateway-access.md).
2. **Zapojit skutečný effect seam.** `requestApproval()` musí volat reálná
   authority před skutečným efektem; efekt musí mít idempotenci, cancel,
   timeout, restart/recovery, audit a stav `UNKNOWN` při nejasném výsledku.
   Přímý demo zápis nesmí být produkční cesta.
3. ~~**Uzavřít lifecycle session.**~~ **HOTOVO** — `intentsmithLock`, abort
   běžících requestů, epoch guard a wipe JS credentialu; testy v
   `tests/mobile-secure-credential.test.js` §5. Zbývá potvrdit na fyzickém
   telefonu.
4. ~~**Systémový zámek.**~~ **HOTOVO** — `BiometricPrompt` s
   `DEVICE_CREDENTIAL`; aplikační PIN jen jako fallback bez zámku obrazovky.
5. ~~**Fail-closed podpis.**~~ **HOTOVO** — release bez klíče selže.
6. **Zbytek shellu na podporovanou řadu.** Zůstává Capacitor **6** (npm dnes
   vede `8.5.0`, takže jsme dvě major verze pozadu a mimo
   [support policy](https://capacitorjs.com/docs/main/reference/support-policy)),
   `compileSdk`/`targetSdk` **34**, `minSdk` **22** a
   [`server.url`](https://capacitorjs.com/docs/config), který je určený pro live
   reload a **nesmí se omylem stát store runtime**. Dál zůstává
   `EncryptedSharedPreferences` místo přímého AndroidKeyStore. Postup a rizika
   jsou v [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md) §3.
   > Zabalení UI do APK není jen build volba: klient by pak běžel z
   > `http://localhost` a mluvil na `127.0.0.1:3336` cross-origin, takže by
   > gateway musela otevřít **CORS**, které dnes záměrně nemá. Je to
   > bezpečnostní rozhodnutí, ne konfigurace.
7. **Provést fyzický device journey.** Alespoň jeden podporovaný telefon:
   install, pairing, Keystore persistence po process death, approval approve i
   reject/expire, Home/recents/lock, gateway outage a odpojení USB.
8. **Rozhodnout boundary delta.** Integrátor zkontroluje tři hrany a až poté
   změní baseline nebo implementaci. Červený ratchet se nesmí umlčet.
9. **Odsouhlasit S1 slovník jako produktový text.** Devět vět, které uživatel
   uvidí, dnes schválil kód. Patří to k přijetí 024, ne k implementaci.
10. **Popsat chování s víc zařízeními.** Dva spárované telefony: kdo rozhodl,
    co uvidí ten druhý, jak se chovají per-device receipty (`DR-012 A`) a co
    znamená „nic nečeká" na zařízení, které o approvalu nevědělo.

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
| `PROD-READY-HANDBOOK.md` | jak se každá položka `P0`–`P2` uzavírá: kritérium hotovosti, důkaz, vlastník, runbooky |
| `archive/PROTOTYPE-485c3497.md` | plný implementační popis snapshotu `485c3497`, zachovaný celý |
| `WP-MOBILE-*`, `PLAN.md`, `SCREENS.md`, `UI-DESIGN.md`, návrh kontraktu v2 | historické návrhy, WP evidence nebo budoucí scope; nejsou aktuální stavový souhrn |

Historické soubory se nemažou: dokazují, co bylo navrženo a ověřeno. Konsolidace
je proto **přesun, ne smazání** — text, který dřív žil v `PROTOTYPE.md`, je celý
v `archive/PROTOTYPE-485c3497.md`, aby pravidlo v tomhle odstavci platilo i pro
commit, který ho zavedl. Rozkol se odstraňuje jasnou autoritou, ne zničením
evidence. Worktrees a větve jsou také
zachované; jejich odstranění je samostatná destruktivní operace a není součástí
tohoto úklidu.

## 8. Akceptační checklist pro označení „prod-ready“

- [ ] Rozhodnutí 024 je operátorem uzavřené.
- [ ] Approval producer je zapojený do skutečného core effectu, ne jen dema.
- [x] Background revokuje JS session a aktivní requesty; late response je inertní. *(emulátor + 7 testů; fyzický telefon zbývá)*
- [x] Odemčení je systémový credential, ne vlastní PIN. *(emulátor; fyzická biometrie zbývá)*
- [ ] Použitá Capacitor/Android řada je podporovaná a production konfigurace
      nenačítá vývojový server.
- [ ] Build je reprodukovatelný z čistého checkoutu.
- [x] Podpis je fail-closed — release bez klíče selže.
- [ ] Fyzický telefon prošel approve/reject/expire, outage, restart a lost-device scénáři.
- [ ] Accessibility a podporovaná device/OS matice jsou PASS.
- [ ] Boundary ratchet je přijatý integrátorem, ne pouze přebaselinovaný.
- [ ] Push nebo deklarovaný pull-only model má přijatou bezpečnostní a provozní policy.
- [ ] S1 slovník je odsouhlasený jako produktový text, ne jen jako kód.
- [ ] Chování s víc spárovanými zařízeními je popsané a otestované.
- [ ] `RemoteCorePort`, oddělený listener, pairing, revokace a legacy-bypass
      negativní test jsou PASS.
- [ ] Fresh-clone release artefakt odpovídá testovanému commitu a operátor jej
      přijal po skutečné demonstraci.

Dokud není zaškrtnutý celý seznam, správné označení je **interní mobilní
prototyp**, ne production-ready aplikace. Jak se každá položka uzavírá — čím se
prokáže, kdo ji vlastní a co je „hotovo" — je v
[PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md).
