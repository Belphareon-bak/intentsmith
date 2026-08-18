# Jak si mobilní aplikaci zkusit — i bez backendu

Praktický runbook pro kanonický prototyp na větvi
`wp/mobile-prototype-20260817`. Aktuální stav, cesta k APK, důkazy a prod-ready
mezery jsou výhradně v [FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md).

Tento návod obslouží stejný klient ve webovém prohlížeči i v Android shellu.
Demo běh si o approval **řekne a počká**; bez něj zůstane fronta prázdná,
protože producent zatím není zapojený do skutečného core effectu.

---

## Co jde bez běžícího IntentSmithu a co ne

Gateway je **samostatný proces**. Čte konverzace přímo ze SQLite a **sám servíruje
i webového klienta**, takže na čtení žádný backend nepotřebuje. Legacy server
(`C3_URL`, výchozí `127.0.0.1:3335`) je potřeba jen na **odeslání zprávy**.

| Funkce | Bez backendu |
|---|---|
| Párování zařízení | ✅ |
| Seznam konverzací, čtení historie, stránkování (`MR-05`) | ✅ |
| Přehled, trust bar, stavy cache, zamčení podle scope | ✅ |
| Žurnál operací, obrazovka rozřešení (`MS-20`) | ✅ |
| **Odeslat zprávu** | ❌ — `upstream: unreachable`, aplikace to řekne rovnou |
| Approvaly s reálným obsahem | ✅ jen v demu — `npm run mobile:demo` je vyrobí přes authority component; produkční F-100 seam zůstává otevřený |
| Schránka s ukazateli běhu | ✅ jen v demu — S1 projektor `DR-013 A`, tentýž demo běh |

Neběžící backend se **nemaskuje**: `GET /m1/health` vrací
`upstream: "unreachable"` s důvodem a composer se zamkne s vysvětlením. To je
záměr, ne rozbitý stav — nefunkční odeslání se nesmí tvářit jako odeslané.

---

## Postup

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
npm ci --offline
npm --prefix mobile-app ci --offline

# 1. Demo databáze — nikdy ne ta ostrá; skript to odmítne.
npm run mobile:seed -- --db /tmp/is-demo.db

# 2. Gateway (v jednom terminálu)
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node src/mobile-gateway.js

# 3. Párovací QR (v druhém terminálu). Approval scopes jsou pro demo povinné.
#    C3_MOBILE_PAIRING=on tu musí být znovu: kill switch se čte v každém
#    procesu, takže bez něj skript kód nevydá — a skončí exit 0, takže je to
#    ticho, ne chyba.
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node scripts/mobile-pair.js \
  --scopes read:capabilities,read:chat,write:chat,read:notifications,write:notifications,read:approvals,write:approvals

# 4. Volitelně: běh, který se zeptá na approval a čeká na odpověď
node scripts/mobile-demo-run.js --db /tmp/is-demo.db
```

Approvaly **nejsou ve výchozích scopech**. Příkaz výše je proto žádá
explicitně; nejmenší dostatečný scope je záměr (`P-8`), ne opomenutí.

V prohlížeči pak otevři `http://127.0.0.1:3336` a vlož kód. V Android aplikaci
nejdřív proveď USB postup v další sekci a kód vlož tam. Kód je
**jednorázový** — po použití je spotřebovaný a další běh `mobile-pair.js` vydá
nový.

Seed vytvoří tři konverzace záměrně: **240 zpráv**, 8 zpráv a prázdnou.

> **Pozor na slovo „stránka".** Neznamená obrazovku. Aplikace si od serveru
> nebere celou historii najednou, ale **po dávkách po 50 zprávách**; téhle dávce
> se v dokumentaci říká stránka. Na obrazovku se vejdou tak tři až pět zpráv
> a scrolluje se úplně normálně.
>
> Konverzace o 240 zprávách = 5 dávek, takže si vynutí donačítání. Ta o 8
> zprávách se vejde do jedné dávky a je hned celá. Demo, kde by každá konverzace
> byla na jednu dávku, by o donačítání nedokázalo nic.

---

## Android aplikace přes USB

Kanonický prototyp používá jen `adb reverse`: Android otevře svůj
`127.0.0.1:3336` a USB kabelem jej přivede ke gateway na počítači. Gateway se
dál váže jen na loopback; žádný port se neotevře do Wi-Fi.

```bash
# Jen kontrola, nic nemění
npm run mobile:android:doctor

# Jednou, pokud ještě neexistuje interní prototypový klíč
npm run mobile:android:keystore

# Build, adb reverse, instalace a spuštění
npm run mobile:android:build
npm run mobile:android:run
```

Příkaz `run` vyžaduje připojený a autorizovaný Android device nebo emulátor.
Interní klíč ani výsledné APK nejsou release signing. Vzdálený listener,
Tailscale/VPN a `C3_MOBILE_ALLOW_REMOTE` nejsou podporovaná cesta tohoto
prototypu.

---

## Co si při zkoušení všímat

`MR-05` je nové, takže tohle je to zajímavé:

1. Otevři **Dlouhou konverzaci** — musí naskočit na **nejnovější** zprávě, ne na
   začátku historie.
2. **Scrolluj nahoru** — starší zprávy se dotáhnou samy, jako v jakémkoli chatu.
   Pozice čtení se přitom nesmí hnout.
3. Scrolluj až na úplný začátek — musí se objevit **„Začátek konverzace"**, ne
   nekonečné donačítání.
4. U **Krátké konverzace** musí být „Začátek konverzace" hned; nesmí nabízet
   načtení něčeho, co neexistuje.
5. Vypni gateway a scrolluj dál — okraj okna musí říct **„Starší zprávy vyžadují
   připojení"**, nikdy nesmí utnout historii mlčky.

---

## Známá omezení, ať je nehlásíš jako vady

| | |
|---|---|
| Odpověď přijde najednou, netéče po tocích | Token streaming neexistuje (`PLAN.md` §3) |
| Vlastní obrazovka průběhu / agent log chybí | `MR-07` je `BLOCKED_BY_CONTRACT`; demo ukazuje jen S1 indikátory ve schránce |
| Hledání chybí | `MR-10` je `BLOCKED_BY_CONTRACT` |
| Projekty chybí | `MR-14` čeká na `DR-008` a Gate 1 |
| Notifikace nedorazí do spící aplikace | Push (`N-1`) není; schránka je pull. Naplnit ji umí `npm run mobile:demo` |
| ~~Na 200 % písma se nic nezvětší~~ | **Už neplatí.** Stylesheet byl převedený 2026-08-11 a `mobile-browser-a11y` to měří v prohlížeči |
| Nové spárování = nový `deviceId` | Staré operace z nového zařízení nejsou vidět |
