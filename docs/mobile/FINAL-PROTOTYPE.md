# IntentSmith Mobile — kanonický prototyp a cesta k production-ready

**Datum poslední aktualizace:** 2026-09-06

**Kanonická vývojová větev:** `mobile/master-prod-ready`

**Runtime implementace:** `HEAD` větve. Historický emulátorový APK snapshot
`485c34977078a46cc397b9b3807f6a311fc906ba` je archivovaný v
[`archive/PROTOTYPE-485c3497.md`](archive/PROTOTYPE-485c3497.md); není artefaktem
aktuálního API-36 checkoutu.

**Verdikt:** aktuální checkout je `IMPLEMENTED AND TESTED`, ale jeho API-36
binární build je `NOT RUN`; starší emulator journey zůstává historickým důkazem.
Fyzický telefon, fresh-clone reprodukce a production release jsou `NOT RUN` /
`NOT READY`.

Tento soubor je jediný aktuální stavový a rozhodovací rozcestník pro mobilní
prototyp. Návod k obsluze je v [TRYING-IT.md](TRYING-IT.md), historické
implementační vysvětlení přesměrovává sem z [PROTOTYPE.md](PROTOTYPE.md) a
raw obrazová evidence zůstává v [`prototype-evidence/`](prototype-evidence/).

> Tento dokument sjednocuje prototypové větve, ale nepřebíjí projektové
> autority [`PRODUCT.md`](../../PRODUCT.md), [`CONTRACT.md`](../../CONTRACT.md),
> [`DIRECTION.md`](../../DIRECTION.md), [`ROADMAP.md`](../../ROADMAP.md) ani
> [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md). Remote Companion je podle roadmapy
> samostatný M7 release. Rozhodnutí
> [024](../decisions/024-mobile-companion-producer-and-shell.md),
> [025](../decisions/025-approval-window-and-push.md),
> [026](../decisions/026-wireless-gateway-access.md) a
> [027](../decisions/027-single-writer-per-file.md) jsou **přijatá
> (2026-08-19)**. Přijetí ale nespouští producenta samo — `guardedWrite` se
> zapíná vložením závislostí (`setApprovalDeps`) a v produkčním kódu ho zatím
> nikdo nevkládá.

## 1. Jedna jasná cesta k dnešnímu prototypu

| Co | Kanonická hodnota |
|---|---|
| Worktree | konkrétní absolutní cesta není součástí produktu; použij kořen klonu |
| Větev | `mobile/master-prod-ready` |
| Zdroj runtime | `HEAD`; předchozí emulátorový APK `485c3497` je jen historický důkaz |
| Vstupní mobile baseline | `2fcc2ff357238e4736a15a9e01affa14183e37ef` |
| Aktuální verze | `0.1.0` / Android `versionCode 1000` z `mobile-app/release.json` |
| Aktuální APK/AAB | `NOT BUILT` — workflow i manifest jsou připravené, host nemá JDK 21 ani Android SDK 36 |
| Package | `cz.intentsmith.companion` |
| Podpis | interní RSA-4096; cert SHA-256 `9c8aafc3a480e0eccf8230e324fede05f3b3e6db62bd5aea75e539af1e5bf786` |
| Ověřená platforma | Android 15 emulátor, `x86_64`, API 35, KVM |
| Fyzický telefon | `NOT RUN` |
| Push / vzdálený listener | není součástí prototypu |

Historický APK je interní artefakt pro USB demonstraci. Není to store build ani
release kandidát pro aktuální větev. Nový artefakt se smí označit až po
API-36 buildu, ověření podpisu a device matici; starý hash ani certifikát se na
něj nepřenášejí.

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
| `wp/mobile-prototype-20260817` / `485c3497` | historický běžící vstup: producent approvalů, S1 projektor, indikátory `CoreEvent`, Android shell a manuálně ověřený emulator journey | není už kanonická větev; demo producent nevydáváme za zapojené produkční jádro |
| `codex/mobile-prototype-20260817` / implementace `fda3fc43`, výsledkový HEAD `78ca9f38` | referenční hardening: Capacitor 8, target API 36, přímý AndroidKeyStore AES-GCM, systémový `BiometricPrompt`, vyčištění JS session, abort/epoch guard a striktní build/install kontrola | nevydáváme jej za device-ověřený prototyp; jeho approval je syntetický a nemá producenty |

Bezpečnostní kandidát je tedy **zdroj pro port vybraných změn**, ne druhá
kanonická aplikace. Jeho úplný dobový protokol lze přečíst bez přepnutí větve:

```bash
git show 78ca9f38:docs/mobile/WP-MOBILE-ANDROID-PROTOTYPE-CODEX-20260817-RESULT.md
```

Větev `mobile/master-prod-ready` už tuto hybridní cestu realizuje po
samostatných checkpointech: zachovává mobilní gateway a klienta, balí kanonické
UI do Capacitor shellu a v `14be72b8` nahrazuje původní wrapper vlastním přímým
AndroidKeyStore trezorem. Aktuální binární a fyzický device journey však stále
neproběhl, takže jde o implementovaný kandidát, ne release verdict.

## 3. Pravdivý stav dnešního prototypu

| Oblast | Stav | Co bylo skutečně ověřeno | Hranice tvrzení |
|---|---|---|---|
| Párování a čtení SQLite | `EMULATOR VERIFIED` | párování, seznam konverzací, stránkovaná historie, přehled, trust bar a žurnál | pouze current-host emulátor; žádná fresh-clone ani fyzická device matice |
| ★ approval | `SEAM IMPLEMENTED` | telefon rozhodl durable approval a soubor vznikl; od 2026-08-19 vede přes `guardedWrite` i editační cesta jádra (`fs.write` v režimu `ask`), takže odpovědět může telefon, IDE i desktop | zapíná se vložením závislostí (`setApprovalDeps`), jinak platí původní chování; fyzický telefon `NOT RUN` |
| Approval authority | `COMPONENT IMPLEMENTED` | mint jde přes `createMobileApproval`, má výpočet otisku, vazbu a od `025` **předpoklad stavu cíle** místo okna; rozhodovací pravidla jsou v **jedné** sdílené funkci pro mobil i desktop | rozhodnutí 024–027 přijata 2026-08-19; `DR-011` v PLAN/DATA-MODEL/SCREENS ještě popisuje staré pětiminutové okno a je tím **zastaralé** |
| Notifikační schránka | `DEMO PRODUCER IMPLEMENTED` | uzavřený devítivětý S1 slovník bez obsahu, zobrazený na emulátoru | je to pull; bez push a bez zapojení do skutečného core lifecycle |
| Průběh běhu | `DEMO PROJECTION IMPLEMENTED` | demo mapuje `CoreEvent` do S1 indikátorů ve schránce | není vlastní run obrazovka ani produkční CoreEvent konektor |
| Android shell | `IMPLEMENTED AND STATICALLY TESTED`; current binary not rebuilt | Capacitor 8.4.3, minSdk 24, compile/target 36; canonical client is packaged in the APK and native HTTP transport keeps the gateway behind `/m1` without CORS widening | current API-36 binary and device journey remain unverified |
| Token at rest | `SOURCE TESTED; DEVICE TEST PENDING` | přímý `AndroidKeyStore` AES-256-GCM trezor, náhodné IV, AAD, atomické skupiny a vypnutý backup; nativní shell nikdy nepadá do `localStorage` | 12/12 invariantů a 19/19 klientských scénářů PASS; tři instrumentační testy jsou napsané, ale bez SDK/zařízení `NOT RUN`; mezi odemčením a zamčením kopie v JS paměti existuje |
| Background lock | `EMULATOR VERIFIED` | `onPause` zapečetí vault, pošle do stránky `intentsmithLock` (zahodí credential z paměti, zruší běžící requesty, zneplatní epochu) a zvedne překryv; pozdní odpověď je inertní | ověřeno na emulátoru a šesti testy; fyzický telefon `NOT RUN` |
| Odemčení | `EMULATOR VERIFIED` | systémový `BiometricPrompt` (otisk / obličej / PIN telefonu); po odemčení se stránka reloadne a čte z trezoru | vlastní PIN zůstává jen pro telefon **bez** zámku obrazovky; fyzická biometrie `NOT RUN` |
| APK a podpis | historical internal build verified; current build `NOT RUN` | cross-platform workflow před buildem kontroluje JDK 21/API 36, release bez klíče selže a ověření podpisu po buildu je povinné | `--debug-signing` je vědomý únik pro jednorázový build; žádná production key ceremony |
| Síť | `USB LOOPBACK ONLY` | `adb reverse` zachovává gateway na loopbacku | žádný vzdálený listener, VPN support claim, TLS ani push |
| Accessibility | `PARTIAL` | `mobile-browser-a11y` **22/22 PASS** ve skutečném Chromiu (ručně; v gate dál withheld) — kontrast, focus order, ohlášení trust baru čtečce **a růst se 200% písmem** | TalkBack na zařízení a fyzická AT matice zůstávají `NOT RUN`; jeden test sám pojmenovává sporné měření kontrastu popisků lišty |

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

### Co našlo nezávislé review (2026-08-19) a co s tím je

Review připnuté na `5f5ffba2` našlo osm nálezů, tři z nich `P0`. **Všechny jsou
opravené**, ale jeden z nich se opravit úplně nedá a je poctivější to napsat než
to zamlčet:

| # | Nález | Stav |
|---|---|---|
| 1 | `TOCTOU` mezi ověřením a zápisem | **zúženo** — poslední ověření je teď těsně před zápisem; zbytek viz níže |
| 2 | zápis po ztrátě lease | **opraveno** — fencing přes id zámku, selhání heartbeatu zápis zakáže |
| 3 | chyba čtení se vydávala za neexistující soubor | **opraveno** — `absent` smí znamenat jen `ENOENT`, ostatní je neověřitelné |
| 4 | „ghost approval" bez terminálního stavu | **opraveno** — `2026_08_19_068_mobile_approval_lifecycle`, `invalidated`/`cancelled` + důvod |
| 5 | dvě rozhodovací autority | **opraveno** — jedna sdílená funkce pro pravidla, transport zůstává každé ploše vlastní |
| 6 | rozpadlá kanonická dokumentace | **opraveno** — tenhle soubor |
| 7 | identita cíle jen lexikální (symlink) | **opraveno** — kanonický cíl přes `realpath` pro zámek, předpoklad i zápis |
| 8 | desktopová `S2` odpověď bez `no-store` | **opraveno** |

**Co u nálezu 1 zbývá a proč.** Mezi „přečti a porovnej" a „zapiš" zůstává
štěrbina řádově mikrosekund, protože zápis souboru na POSIXu není
compare-and-swap. Zavřít ji nejde zúžením — jde jen tím, že **všichni**
zapisovatelé půjdou přes jednu mediační vrstvu (verzované úložiště nebo
broker). To je rozhodnutí o síle slibu, ne oprava, a patří do `P1`:

> **Dnešní slib:** dva agenti IntentSmithu si nesáhnou na týž soubor (zámek) a
> změna, která proběhne kdykoli **do poslední kontroly**, zápis zastaví
> (předpoklad). **Neslibuje se**, že externí zapisovatel nemůže trefit
> mikrosekundu mezi poslední kontrolou a zápisem.

Tři sondy z review jsou převedené na regresní testy
(`tests/guarded-write.test.js` §6), takže se ty tři cesty nemůžou vrátit tiše.

## 4. Důkazy, které dnes existují

Na runtime snapshotu a znovu po dokumentační konsolidaci prošlo:

- `npm run test:mobile`: **36/36 aktivních mobilních programů PASS** (bylo 31/31 před approval balíkem);
- `mobile-browser-a11y`: **22/22 PASS** při ručním spuštění — prerekvizita se
  doinstaluje jedním příkazem (`npx puppeteer browsers install chrome`).
  V gate zůstává **withheld**: stav `BLOCKED` je vlastnost registru, ne mého
  stroje, a gate schválně nesonduje prostředí. Aby se ten výsledek počítal,
  musí někdo přeřadit sadu na `ACTIVE` a přijmout tím, že Chromium je napříště
  povinná prerekvizita gate — to je rozhodnutí implementátora registru;
- `tests/mobile-companion-producer.test.js`: **24 PASS**;
- `tests/file-write-lock.test.js`: **16 PASS**, `tests/guarded-write.test.js`:
  **13 PASS**, `tests/desktop-approval-surface.test.js`: **10 PASS**,
  `tests/ide-durable-approval.test.js`: **7 PASS**;
- `tests/mobile-companion-e2e.test.js`: **5 PASS** přes vlastní gateway proces a HTTP;
- `tests/mobile-secure-credential.test.js`: **19 PASS** (credential, downgrade a lifecycle hranice);
- Android `lintRelease`: **0 errors / 21 warnings**;
- `tests/artifact-validation.test.js`: **151/151 PASS**;
- registry: **409 programů** (`311 ACTIVE`, `83 BLOCKED`, `15 HISTORICAL`),
  9 explicitních support-module exclusions;
- repository hygiene: **PASS**, 1 687 trackovaných cest včetně tohoto dokumentu;
- current-host emulátor: pairing → demo run → approval → durable decision →
  soubor po schválení, a po hardeningu znovu celé včetně cyklu
  pozadí → `BiometricPrompt` → device credential → reload → funkční relace;
  obrazová evidence je v [`prototype-evidence/`](prototype-evidence/).

Tyto výsledky nejsou release verdict. Chybí fresh-checkout attestace root i
`mobile-app` instalace/buildu, fyzický telefon a nezávislá akceptace.

### Approval rovina — zapnutá od 2026-08-19

Zápis v cestě `FILE_WRITE` a nástroje `fs.write` se ptá a čeká; bez zapojené
rozhodovací roviny **nezapíše nic**. Celý záznam včetně toho, co **ne**platí, je
v [`WP-APPROVAL-PLANE-RESULT.md`](WP-APPROVAL-PLANE-RESULT.md).

### Boundary gate — zelený od 2026-08-19

`node scripts/module-boundary-ratchet.mjs` **PASS**. Reviewer schválil směry
závislostí a odmítl jedinou věc — pojmenování sdíleného jádra jako `src/mobile`.
Autorita se proto přesunula do `src/approvals/` a baseline se rebaselinoval
v `85d98215`:

```text
baselineEdges=1077 currentEdges=1075 added=0 removed=2 cycles=3 filesInCycles=28
```

Dvě hrany naopak **ubyly** (`effects.js` už nesahá na zámek ani atomický zápis
přímo). Utažení baseline na 1075 je rozhodnutí integrátora, ne podmínka gate —
ratchet propouští jen přírůstky.


## 5. Co přesně chybí do production-ready

„Production-ready“ zde znamená Remote Companion release podle M7 roadmapy, ne
jen APK, které lze nainstalovat. Následující položky jsou povinné a jejich
`NOT RUN`, `PARTIAL` nebo `BLOCKED` stav se nesmí přepsat na PASS.

### P0 — uzavřít pravdivý interní prototyp

1. ~~**Rozhodnout 024.**~~ **HOTOVO 2026-08-19** — operátor přijal 024 i
   navazující [025](../decisions/025-approval-window-and-push.md),
   [026](../decisions/026-wireless-gateway-access.md) a
   [027](../decisions/027-single-writer-per-file.md). Producent tím **není**
   spuštěný: přijetí potvrdilo tvar, zapojení je vázané na body 2 a P0-6.
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
6. **Zbytek shellu na podporovanou řadu.** **ČÁSTEČNĚ 2026-09-06** — checkout
   nyní pinne auditovaný Capacitor **8.4.3**, `compileSdk`/`targetSdk` **36**,
   `minSdk` **24**, Java 21 a vypnuté release WebView debug/logování. Binární
   build na tomto hostu neproběhl, protože chybí JDK/Android SDK. `server.url`
   byl odstraněn: APK balí přímo `src/mobile/client`, absolutní gateway origin
   se zapisuje do build assetu a Capacitor HTTP převádí `fetch` na nativní
   transport. Vzdálený cleartext build je odmítnut a gateway stále nepovoluje
   CORS. MM5-B v `14be72b8` odstranil deprecated Security Crypto wrapper:
   credential, PIN verifier i čítač pokusů jsou v přímém AES-GCM trezoru pod
   neexportovatelným AndroidKeyStore klíčem; korupce selže zavřeně a rozbitý
   nativní vault nikdy nepropadne do browserového úložiště. Formát, jednorázový
   reset prototypového vaultu, důkazy a non-claims jsou v
   [MM5-B review](reviews/MM5B-DIRECT-ANDROID-KEYSTORE.md).
   Postup a rizika jsou v [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md) §3.
   > Zabalení UI do APK vyžadovalo explicitní transportní hranici: bez nativního
   > transportu by prohlížeč vynutil CORS. „Oprava“ přes
   > `Access-Control-Allow-Origin: *` by otevřela bearer API libovolné stránce.
   > MM5-A proto používá nativní transport a serverovou hranici nemění; pinovaná
   > identita vzdálené protistrany zůstává podmínkou skutečného remote release.
   Build/doctor/install cesta je od MM6-B jeden Node CLI pro Windows, Linux i
   macOS. Ověření podpisu už nesmí selhat potichu; 11 regresí drží toolchain,
   náhodné interní heslo i explicitní debug escape. MM6-C přidal jedinou
   verzovací autoritu, současný signed APK+AAB build, CycloneDX SBOM a release
   manifest s commitem, endpointem, lockfilem, hashi artefaktů a signer
   certifikátem. Skutečný výstup zůstává `NOT RUN` bez toolchainu a klíče.
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
      → lifecycle/BiometricPrompt hardening (implementováno)
      → přímý AndroidKeyStore trezor (implementováno v MM5-B)
      → podporovaný Android/Capacitor zdrojový baseline (implementováno)
      → čistý binární build a device ověření (otevřeno)
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
