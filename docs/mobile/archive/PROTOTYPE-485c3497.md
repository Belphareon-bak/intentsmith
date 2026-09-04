> **Archiv.** Tohle je implementační popis prototypu ve stavu `485c3497`,
> zachovaný proto, že dokládá, co bylo v tu chvíli postavené a ověřené.
> **Není to aktuální stav** — ten je v [FINAL-PROTOTYPE.md](../FINAL-PROTOTYPE.md).
> Konkrétně tu chybí lifecycle hardening, systémový zámek a fail-closed podpis,
> které přišly později.

# Prototyp mobilní aplikace — co to je, co to dokáže, co ne

Větev `wp/mobile-prototype-20260817`. Postaveno na `integration/mobile-alpha-20260812`.

Prototyp odpovídá na jednu otázku: **dojde ťuknutí na telefonu až ke stroji?**
Odpověď je ano a je vyfocená — `prototype-evidence/`.

---

## 1. Co přibylo

| | Bylo | Je |
|---|---|---|
| **Approvaly** | fronta se nikdy nenaplnila (`F-100`, chyběl producent) | běh o approval požádá, **čeká na odpověď** a podle ní jedná |
| **Schránka** | kanál registrovaný a fail-closed, capability nikdo nedržel | S1 projektor (`DR-013 A`) — devět vět, žádný obsah |
| **Průběh běhu** | rozhodnuto, nepostaveno | `CoreEvent` → S1 ukazatele v existující schránce |
| **Aplikace v telefonu** | web na `127.0.0.1:3336` | podepsané APK, Capacitor nad **stejným** klientem |
| **Token** | `localStorage` (`MR-22` `PARTIAL`) | Android Keystore, zapečetěný zámkem |
| **Zámek** | nebyl (`MR-23` `PARTIAL`) | PIN, zamyká se při odchodu na pozadí, `FLAG_SECURE` |

Nic z toho nesahá na kontrakt: prototyp běží na **zmrazených 13 routách**.

---

## 2. Jak to spustit

```bash
# 1. Demo databáze (nikdy ne ostrá — skript to odmítne)
npm run mobile:seed -- --db /tmp/is-demo.db

# 2. Gateway
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on npm run mobile:gateway

# 3. Telefon připojený USB, ladění povolené
npm run mobile:android:keystore   # jednou; vyrobí interní podpisový klíč
npm run mobile:android:build      # podepsané release APK
npm run mobile:android:run        # tunel + instalace + spuštění

# 4. Párovací kód — approvaly nejsou ve výchozích scopech, musí se vyžádat
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node scripts/mobile-pair.js \
  --scopes read:capabilities,read:chat,write:chat,read:notifications,write:notifications,read:approvals,write:approvals

# 5. ★ Běh, který se zeptá telefonu a čeká na odpověď
npm run mobile:demo -- --db /tmp/is-demo.db
```

`npm run mobile:android:doctor` řekne, co z toho stojí a co ne, aniž by cokoli
měnil.

**Jak se telefon k počítači dostane.** `adb reverse tcp:3336 tcp:3336` otevře
port **na telefonu** a svede ho kabelem sem. Gateway se dál váže jen na
loopback — z jejího pohledu spojení přichází z loopbacku, což už povoluje.
Do Wi-Fi se nevystavuje nic a `G0-R032` (vzdálený listener za M6) se nehýbe.

---

## 3. ★ Use case, krok za krokem

1. `mobile-demo-run.js` začne běh, ohlásí `run.started` a `run.progress`.
2. Dojde k efektu, který neudělá bez svolení: zápis souboru. Razí approval —
   přes `createMobileApproval`, takže **okno je `DR-011`** (lokálně 5 minut),
   otisk se počítá tady a vazba na běh a operaci je povinná.
3. Do schránky jde S1 ukazatel: *„Čeká rozhodnutí"*. Cesta ven, ne obsah.
4. Telefon ukáže frontu, odpočet z **serverového** času a popis (S2, za
   `read:approvals`).
5. Ťuknutí na **Schválit** pošle `POST /m1/approvals/:id/decide` s otiskem.
6. Běh — **v jiném procesu** — uvidí rozhodnutí na řádku a **teprve pak** zapíše
   soubor. Zamítnutí soubor nevytvoří. Nikdo neodpoví → okno se zavře a běh to
   řekne; z ticha se nikdy nestane souhlas.

Vyfoceno: `prototype-evidence/02-approval-ceka.png`,
`03-rozhodnuti.png`, `04-schranka-s1.png`.

---

## 4. Proč zrovna takhle

**Producent nesmí razit sám.** Kdyby si approval uměl vyrobit kdokoli, `DR-011`
by bylo doporučení. Proto jediná cesta do `mobile_approvals` vede přes autoritu
a producent je jen její volající.

**Zrcadlo nese ukazatel, ne obsah.** `MD-08` říká, že mobilní notifikace je S1
bez obsahu, a popis approvalu je S2. Kdyby text notifikace šel poskládat z
parametrů, dřív nebo později by v něm skončila cesta k souboru. Text proto
pochází z tabulky devíti vět a **žádný parametr do něj nevede**. Test to zkouší
tím, že producentovi předhodí PIN, cestu a diff — a pak je hledá v uloženém
řádku.

**Odpověď je řádek, ne promise.** Gateway je vlastní proces. IDE má approvaly
v `Map` v paměti (`edit_request`), a takový approval telefon zodpovědět nemůže —
odpověď přijde jinam. `awaitDecision()` proto sleduje řádek. Vedlejší zisk:
přežije to restart gateway.

**Zámek zapečeťuje trezor, ne obrazovku.** Překryv sám o sobě je závěs: WebView
za ním pořád běží a pořád má token. `LockPolicy` proto při zamčení **odmítne
vydat přihlášení**, a překryv je jen ta viditelná polovina.

---

## 5. Co to neumí — ať to nehlásíš jako vadu

| | |
|---|---|
| Spící aplikace notifikaci nedostane | Push (`N-1`) není; schránka je pull |
| Odeslání zprávy potřebuje backend | `upstream: unreachable`, composer se zamkne a řekne proč |
| Průběh běhu nemá vlastní obrazovku | `MR-07` je `BLOCKED_BY_CONTRACT`; jede schránkou |
| Hledání, projekty, paměť, workeři, nastavení | Kontrakt v2, mimo prototyp |
| Přes Wi-Fi to nepoběží | Záměr. `adb reverse` nebo VPN; vzdálený listener je za M6 |
| Podepsáno interním klíčem | Prototyp. Do obchodu s ním nejde nic |
| Zámek nezachrání ukradený odemčený telefon navždy | Kupuje čas do revokace na počítači (`P-9`) |
| Na 200 % písma se nic nezvětší | Otevřený nález klienta (`WP-MOBILE-027-RESULT` §7) |

---

## 6. Důkazy

```
node tests/mobile-companion-producer.test.js      17 PASS
node tests/mobile-companion-e2e.test.js            5 PASS   (vlastní proces gateway + HTTP)
node tests/mobile-secure-credential.test.js       10 PASS
npm run test:mobile                               (mobilní brána, viz níže)
```

Na zařízení (Android 15, emulátor s KVM, `x86_64`, API 35):

| Co | Kde |
|---|---|
| aplikace běží proti gateway | `prototype-evidence/01-parovani.png` |
| approval s odpočtem `DR-011` | `02-approval-ceka.png` |
| obrazovka rozhodnutí s otiskem | `03-rozhodnuti.png` |
| S1 schránka — čtyři ukazatele bez obsahu | `04-schranka-s1.png` |
| „Úložiště přihlášení: **Android Keystore**" | `05-keystore.png` |
| zámek po návratu z pozadí | `06-zamek.png` |
| `FLAG_SECURE`: snímek obrazovky je černý | `07-flag-secure-screenshot.png` |

Po schválení na telefonu vznikl soubor, který by jinak neexistoval:

```
$ cat /tmp/is-demo-effect/ZAPSANO-PO-SCHVALENI.md
# Tenhle soubor vznikl schválením z telefonu
run: run-demo-msya5q9q
```

### Co je červené a proč to nepřebarvuju

`node scripts/module-boundary-ratchet.mjs` **selže** — a je poctivější to sem
napsat než to přebaselinovat:

```
MODULE_BOUNDARY_RATCHET_FAIL  baselineEdges=1048 currentEdges=1051 added=3
  ADDED src/notifications/index.js       -> src/notifications/channels/mobile.js
  ADDED src/mobile/companion-producer.js -> src/mobile/approval-authority.js
  ADDED src/mobile/companion-producer.js -> src/notifications/channels/mobile.js
```

První hrana **není moje**: přišla s `F-111` (registrace kanálu) a stejný FAIL
dostaneš i na nedotčeném `integration/mobile-alpha-20260812`. Zbylé dvě jsou
producent — a jsou to přesně ty dvě hrany, které musí existovat, aby razil přes
autoritu a psal přes fail-closed kanál.

Baseline je vedený jako **integration authority** (`baselineRevision=7916098e`,
`commitsBehind=62`). Přepsat ho `--write-baseline` na prototypové větvi by
zamázlo i tu cizí hranu a tvářilo se to jako přijetí, které nikdo neudělal.
Rebaseline patří k integraci, ne sem.

Poslední řádek tabulky je vtip jen zdánlivě: `07` je **černý obdélník**, a to je
ten důkaz. `FLAG_SECURE` znamená, že systém nemá co uložit do náhledu
posledních aplikací. Kvůli tomu má debug build vypínač
(`adb shell settings put global intentsmith_capture 1`), který se do release
buildu nekompiluje — ostatní snímky vznikly s ním.

---

## 7. Kam dál

1. **Přijetí `docs/decisions/024`** operátorem. Do té doby platí strop: producent
   se nespouští sám, volá ho jen demo skript a testy.
2. **Zapojení do reálného seamu** (`fs.write` v režimu `ask`). Tam je okno 30 s
   a `DR-011` žádá 5 minut — sjednocení oken je součást toho rozhodnutí.
3. **Push (`N-1`)**, aby zavřená aplikace o approvalu věděla. Dnes ho uvidí, až
   ji otevřeš — což je u pětiminutového okna málo.
4. Biometrika místo PINu, `BiometricPrompt` nad stejným `LockPolicy`.
