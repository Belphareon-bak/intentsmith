# IntentSmith Mobile — ověření stavu 2026-10-10

**Verdict: HOST_GATE_GREEN / NEW_CHAT_GAP_REPRODUCED / DEVICE_NOT_RUN /
NOT_ACCEPTED.** Android aplikace existuje, klient i backendové M7 vrstvy mají
zelené lokální testy a aktuální Android sestavení prošlo. Pro běžné používání
z telefonu ale není dokončená: první zpráva nového chatu nemá backendovou
konverzaci, host nemá aktivní M7 VPN transport a fyzická release přejímka chybí.

## Přesný zdroj a postup

Autorita je explicitní požadavek operátora prověřit stav mobilní aplikace,
PRODUCT/DIRECTION a přijatá Decision 042. Scope je v
[WP-MOBILE-STATUS-AUDIT-20261010](../wp/WP-MOBILE-STATUS-AUDIT-20261010.md).
Nejde o opravu produktu, přijetí nového wire kontraktu nebo aktivaci služby.

1. Ověřen živý GitHub main `138e958be927df9835c091d3ad41d44b347e85b5`, IDE
   baseline `46337ee66f8788f9ca2f041c165d4e35b3f242cf` a oddělený provozní
   release `3c804a8a859a9f44efd200585795f5373e85fc3c` (PID `976926`).
2. Pokračování použilo existující vlastní checkout a novou větev
   `work/mobile-status-audit-20261010`, založenou na main a fast-forwardovanou
   na IDE baseline. Předchozí worker/specialist větev i její evidence zůstávají.
3. Testy, build i doplňkový probe běžely na čistém přesném source
   **`1acb5d6b9bbc180c2ceee9a16956f0894a7d0e03`**. WP commit přidává pouze
   dokumentaci. Mobilní produktové zdroje nebyly změněny.

`src/mobile/client` má shodný Git tree
`786443228cd9155945b66fcb607486d1b6b5616b` a `mobile-app/android` shodný tree
`6cf8c3823b16b84d2324ecae3fe4466728c66581` v auditu, IDE baseline i provozním
release. Výsledky tedy ověřují aktuální mobilní kód, nikoli starou větev
pojmenovanou `mobile-prototype`.

## Co čerstvě prošlo

| Kontrola | Výsledek | Hranice důkazu |
|---|---|---|
| Všech 47 ACTIVE C3-031/C3-032 programů přes izolovaný registry runner | **47/47 PASS**, 33 offline + 14 database; žádný BLOCKED/SKIPPED | Lokální klient, M7 kontrakty, piny, journal, pairing/lifecycle, TLS fixture a SQLite; nejde o fyzickou VPN |
| Standardní `npm run test:mobile` | **47/47 PASS** | Druhý běh standardního gate, zahrnuje browser accessibility |
| Registry reconciliation/validation | **PASS**, 603 runnable programů | Validita registru, nikoli provedení všech 603 programů |
| Artifact validation | **161/161 PASS**, 0 skipped | Stávající source/build/documentation guardy |
| Android Gradle `test lint :app:assembleDebug` | **BUILD SUCCESSFUL**, 29 s, 193 úloh | JDK 21, SDK 36, Gradle 8.14.3, Capacitor 8.5.0; hostové sestavení |
| Android JUnit | **5/5 debug + 5/5 release PASS** | V každé variantě 4 M7 canonical JSON testy a 1 template test; varianty nejsou deset různých scénářů |
| Android app lint | **0 errors / 16 warnings** | Warnings zůstávají, nejsou vydávané za bezchybný lint |
| Zabalený klient | **8/8 assetů bajtově shodných** | `app.js/css`, manifest, native client, runtime contract, UI adapter, remote-core a service worker |

Izolovaný runner doložil u všech 47 programů čistý přesný source HEAD a žádný
cleanup leak. Žádná produkční DB, modelová inference, živý IDE checkout,
listener, firewall ani cizí dlouhý soak nebyly těmito testy měněny.
Browser testy ověřují browser rendering/a11y, nenahrazují TalkBack na Androidu.

## Reprodukovaný funkční blocker: nový chat

Aktuální `src/mobile/client/app.js:5909` při `newChat()` vytvoří lokální
`m-*` ID a prázdný thread. Nepožádá backend o vytvoření konverzace.
`m7-ui-api-adapter.js:433` pak pro `/chat` volá pouze `conversation.execute`.
`m7-conversation-core-adapters.js:564` vyžaduje existující, aktivní a
autorizovaný řádek; bez něj vrátí `M7_CONVERSATION_ACCESS_DENIED`.
Aktuální native operation katalog neobsahuje `conversation.create`.

Doplňkový host probe skutečně zavolal exportované UI `newChat()`, použil
skutečný M7 UI adapter a capability provider nad privátní SQLite/journal.
Výsledek pro nové ID: **ACCESS_DENIED, žádný řádek konverzace, 0 volání
executorového handleru**; UI adapter chybu prezentuje jako status 503.
Po předvložení existující syntetické konverzace ve stejné sestavě prošel
pozitivní control jako `CONFIRMED` a handler byl zavolán právě jednou.

DOM, transport bridge a autorita byly výslovně fixtures. Probe neprovedl
skutečný native HTTPS, fyzické pairing ani modelový dialog. Důkaz rozlišuje
konkrétní chybějící vytvoření od obecné poruchy provideru. První pokus měl
neplatný pozitivní fixture výstup (`response.role` navíc); jeho log zůstává
uchovaný a není vydávaný za produktové selhání. Opravený control validuje
stejný M1 result tvar jako existující registrované testy.

To potvrzuje již známou mezeru z [Core/M7 handoffu 1. 10.](../mobile/CORE-M7-CAPABILITY-HANDOFF.md).
Zelené testy existujících konverzací první nové odeslání neuzavírají.
Řešení vyžaduje backendem vlastněnou typed create operaci a klientské zapojení,
s kontrolami scope, identity, replay, prvního odeslání a následné historie.
Tento audit kontrakt nerozšiřoval ani neobcházel přes development `/m1`.

## Skutečný host a fyzická přejímka

Čerstvá read-only inventura potvrdila:

- ADB je dostupné, **0 připojených zařízení**;
- **0 rozpoznaných VPN rozhraní**, žádný TCP listener `:7443`;
- provozní backend nemá nastavený `INTENTSMITH_M7_REMOTE_ENABLED`;
- oba očekávané systemd credential directories chybí;
- v audit checkoutu není `keystore.properties` s candidate signerem;
- obsah TLS/HMAC credentials ani signing key nebyl čten.

Fyzická [13 transport + 7 device/accessibility matice](../mobile/DEVICE-MATRIX-RUN.md)
zůstává **NOT_RUN**: AndroidKeyStore, systémový zámek, reboot/process death,
VPN doma/venku, pairing/revocation, replay, Doze, TalkBack a 200 % font/rotace
nebyly provedeny na telefonu. Historický scoped UI re-review
`429b779f` tuto fyzickou přejímku ani současný audit nepřijímá automaticky.

## Vzniklý APK a jeho omezení

- Balíček `cz.intentsmith.companion`, versionCode `1`, versionName `1.0`.
- Android package min API `24`, target/compile API `36`; produkční native
  M7 cesta podle runbooku vyžaduje API `29+`.
- **Android Debug signer**, ne candidate/release signer.
- Transport **`legacy-m1-dev`**, URL `http://127.0.0.1:3336`; nejde o M7 VPN
  kandidát. APK nebyl instalovaný ani spuštěný na telefonu.
- Velikost `7 705 094` bajtů; SHA-256
  `a3e5fa49d8f586d69385974e2237cc78694af24a4369242c1b5fd2c5eae3c3cf`.
- Android manifest i zabalený source manifest nesou exact source `1acb5d6b…`;
  source manifest bytes odpovídají vygenerovanému vstupu buildu.

Retained vývojový APK je lokálně
`.intentsmith-artifacts/mobile-status-audit-20261010/app-debug-1acb5d6b.apk`.
Produkční APK/AAB, signer custody a distribuční rozhodnutí jsou **NOT_DONE**.

## Praktický další postup a možné mezikroky

1. **Nejdřív dokončit vytvoření konverzace** v core/M7 connector WP a ověřit
   skutečný user flow „Nový chat → první zpráva → historie“ na přesném HEAD.
2. Pro provozní kandidát použít již přijatý VPN-only tvar Decision 042:
   schválený VPN origin/SPKI, systemd credentials a candidate signer. Potom
   sestavit a identitou svázat konkrétní APK/AAB.
3. Připojit fyzický Android API 29+ a provést celou 13+7 matici. Teprve její
   evidence a nezávislé review mohou posunout release přejímku.

Do té doby lze použít browser nebo debug APK k hodnocení obrazovek a
development kabelovou cestu k lokální diagnostice. Existující konverzace je
užitečný omezený integrační control. Tyto mezikroky nenahrazují nový chat,
produkční VPN ani fyzickou release přejímku. Nový alternativní klient nebo
veřejný ingress nejsou pro dokončení potřebné.

## Reprodukce a evidence

Pro registry běh byl vybrán přesný seznam všech ACTIVE C3-031/C3-032 ID
z `tests/registry.json`, serial `--concurrency=1`, run-id
`mobile-status-1acb5d6b-20261010`. Node `v24.21.0` byl první v PATH.
Přesný výběr, report/log SHA-256 a výsledky jsou v
[receipt](evidence/mobile-status-audit-20261010/receipt.json).

```bash
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
npm run test:mobile
npm run test:registry
node tests/artifact-validation.test.js
# Po synchronizaci vlastních Capacitor dependencies a generated assetů:
cd mobile-app/android
JAVA_HOME=/home/belphareon/toolchain/jdk21 \
ANDROID_HOME=/home/belphareon/toolchain/android-sdk \
ANDROID_SDK_ROOT=/home/belphareon/toolchain/android-sdk \
./gradlew --offline --no-daemon --max-workers=2 \
  -Dorg.gradle.jvmargs=-Xmx1024m test lint :app:assembleDebug
```

Čerstvé `npm ci --offline` nejprve selhalo kvůli chybějícímu cachovanému
`yauzl 2.10.0`. Následné `npm ci --prefer-offline --ignore-scripts` doplnilo
vlastní přesně lockované dependencies; sdílené/cizí `node_modules` se
neměnily. SDK/JDK jsou explicitní lokální piny uvedené v receipt. Build
nevytvořil žádnou změnu tracked source.

Předchozí celý offline/database běh worker auditu **416/416 PASS na `4defa69e`**
je oddělený důkaz a není nový plný gate source `1acb5d6b`. V této read-only
mobilní práci byla znovu provedena celá mobilní selekce a aktuální Android
build; žádný focused PASS není vydán za celkovou M7 nebo core acceptance.

Surové runner reporty/logy, probe a privátní testové DB zůstávají lokálně.
Retained APK, JUnit XML, lint XML a source manifest mají kopie pod
`.intentsmith-artifacts/mobile-status-audit-20261010/`. Tracked receipt
obsahuje jejich identitu a hashes, nikoli binární APK nebo provozní secrets.
Nezávislý review tohoto nového auditu nebyl proveden.

Čerstvý workspace report: 89 chráněných checkoutů, 0 bezpečně retirable;
nevznikl další worktree. Cleanup planner neměl žádný bezpečně odstranitelný
vlastní sandbox, sedm předchozích důkazních runtime kořenů zůstává chráněno.
607 cizích navržených sandboxů nebylo odstraněno. Audit capsule s APK,
JUnit/lint a manifestem je zachován s privátními režimy.
Předchozí worker auditní WP/report/receipt jsou zachované beze změny z
publikovaného `04436d00`, aby původní lokální odkazy dál fungovaly; jeho opravy
runtime se v této mobilní větvi nepřebíraly.
