# Jak si mobilní aplikaci zkusit — i bez backendu

Krátký návod, ne dokument o architektuře. Ověřeno na `wp/mobile-refresh-20260809`.

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
| Approvaly s reálným obsahem | ❌ — nemá je kdo vytvořit (`F-100`) |

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
```

Pak otevři `http://127.0.0.1:3336` a naskenuj/vlož kód. Kód je **jednorázový** —
po použití je spotřebovaný a další běh `mobile-pair.js` vydá nový.

Seed vytvoří tři konverzace záměrně: **240 zpráv** (musí stránkovat), 8 zpráv
(nestránkuje) a prázdnou. Demo, kde se všechno vejde na stránku, o stránkování
nedokazuje nic.

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
| Notifikace se nenaplní | Produkční producent chybí (`F-111`/`F-014`) |
| Na 200 % písma se nic nezvětší | Klient je celý v px — otevřený nález (`WP-MOBILE-027-RESULT.md` §7) |
| Nové spárování = nový `deviceId` | Staré operace z nového zařízení nejsou vidět |
