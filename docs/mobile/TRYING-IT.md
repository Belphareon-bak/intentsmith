# Jak si mobilní aplikaci zkusit — i bez backendu

Krátký návod, ne dokument o architektuře. Ověřeno na `wp/mobile-refresh-20260809`.

> **Chceš to v telefonu, ne v prohlížeči?** Tenhle soubor popisuje web na
> `127.0.0.1:3336`. Podepsané APK, cestu telefon → gateway, Keystore a zámek
> má [PROTOTYPE.md](PROTOTYPE.md). Přibyl s ním i běh, který si o approval
> **řekne a počká** — bez něj zůstane fronta prázdná, protože ji nemá kdo
> naplnit.

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
| Approvaly s reálným obsahem | ✅ — `npm run mobile:demo` je vyrobí přes autoritu (`F-100`, producent) |
| Schránka s ukazateli běhu | ✅ — S1 projektor `DR-013 A`, tentýž demo běh |

Neběžící backend se **nemaskuje**: `GET /m1/health` vrací
`upstream: "unreachable"` s důvodem a composer se zamkne s vysvětlením. To je
záměr, ne rozbitý stav — nefunkční odeslání se nesmí tvářit jako odeslané.

---

## Postup

```bash
cd /home/belphareon/worktrees/is-mobile-refresh
npm ci --offline

# 1. Demo databáze — nikdy ne ta ostrá; skript to odmítne.
npm run mobile:seed -- --db /tmp/is-demo.db

# 2. Gateway (v jednom terminálu)
C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node src/mobile-gateway.js

# 3. Párovací QR (v druhém terminálu)
C3_DB_PATH=/tmp/is-demo.db node scripts/mobile-pair.js

# 4. Volitelně: běh, který se zeptá na approval a čeká na odpověď
node scripts/mobile-demo-run.js --db /tmp/is-demo.db
```

> Approvaly **nejsou ve výchozích scopech**. Aby je telefon viděl, chce to
> `mobile-pair.js --scopes …,read:approvals,write:approvals` — nejmenší
> dostatečný scope je záměr (`P-8`), ne opomenutí.

Pak otevři `http://127.0.0.1:3336` a naskenuj/vlož kód. Kód je **jednorázový** —
po použití je spotřebovaný a další běh `mobile-pair.js` vydá nový.

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

## Z telefonu na stejné síti

**Bez rozmyslu to nedělej.** Gateway se váže na loopback a vazbu mimo něj
odmítá, dokud nenastavíš `C3_MOBILE_ALLOW_REMOTE`. Ta pojistka tam je proto, že
vzdálený listener a produkční pairing jsou `LATER_GATE` za M6 (`G0-R032`,
ROADMAP §11) a hranice **není prověřená**.

Pro zkoušení na vlastním zařízení je bezpečnější cesta **port forward**, který
nic nevystavuje:

```bash
# z telefonu/druhého stroje přes SSH na tenhle stroj
ssh -L 3336:127.0.0.1:3336 <uživatel>@<stroj>
```

nebo Tailscale/VPN, kde je protistrana ověřená.

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
| Průběh běhu / agent log chybí | `MR-07` je `BLOCKED_BY_CONTRACT` |
| Hledání chybí | `MR-10` je `BLOCKED_BY_CONTRACT` |
| Projekty chybí | `MR-14` čeká na `DR-008` a Gate 1 |
| Notifikace nedorazí do spící aplikace | Push (`N-1`) není; schránka je pull. Naplnit ji umí `npm run mobile:demo` |
| Na 200 % písma se nic nezvětší | Klient je celý v px — otevřený nález (`WP-MOBILE-027-RESULT.md` §7) |
| Nové spárování = nový `deviceId` | Staré operace z nového zařízení nejsou vidět |
