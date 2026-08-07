# P4 — route/WS auth matrix

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Adresát:** agent, který povede `WP-M5-AUTH`
**Důvod:** ROADMAP `§9` říká doslova, že `WP-M5-AUTH` **nejprve sepíše skutečný
route/WS matrix** a teprve pak zavede jediný fail-closed guard. Ten soupis je
read-only práce — nemusí čekat na writer slot.

---

## 1. Otázka, na kterou sonda odpovídá

Které povrchy dnes produkt vystavuje, čím je každý z nich chráněný, a kde by
jediný globální guard **rozbil loopback development mode**. Bez posledního bodu
se guard buď nezavede, nebo se zavede a zablokuje vlastní vývoj.

## 2. Co je už ověřeno (nepřeměřovat)

**Tvar routování.** Není to Express middleware chain. `src/server.js:1091`
vytváří `http.createServer` a route moduly vracejí **objekty**
`{'GET /api/foo': handler}`, které se na `src/server.js:804-844` slijí spreadem
do jedné tabulky. Praktický důsledek: **globální middleware, kam by se guard
pověsil, neexistuje** — je jen jedno místo dispatche. To je pro `WP-M5-AUTH`
spíš dobrá zpráva, ale mění tvar řešení.

**Rozsah.** V `src/routes/*.js` (17 souborů) je **264** klíčů tvaru
`'METHOD /cesta'`. Mimo ně stojí ještě nejméně dva zdroje route:
`createTrustRoutes` (`src/notifications/trust-api.js`, registrace
`src/server.js:878`) a agents API (`src/agents/api.js`).

**Co dnes chrání co:**

| Vrstva | Kde | Co dělá |
|---|---|---|
| Local access boundary | `src/server.js:1091-1125`, `evaluateLegacyLocalAccess()` | Odmítne request mimo loopback/origin/capability → 403 `LEGACY_LOCAL_ACCESS_REQUIRED`. Platí na **všechny** HTTP requesty |
| WS verifyClient | `src/ws-bridge/ws-server.js:117`, `createLegacyWebSocketVerifyClient()` | Totéž pro WS handshake |
| `requireAuth()` | `src/routes/security.js:20-38` | Per-route. Localhost bypass v dev módu, jinak `C3_ADMIN_TOKEN`. Použito **jen** v `security.js`, 7× |
| Agents admin token | `src/agents/api.js:18, 384, 400, 420` | Vlastní kontrola `C3_ADMIN_TOKEN`, mimo `requireAuth()` |
| `validateApiToken()` | `src/routes/security.js:270` | **Definovaná, exportovaná, nikde nevolaná.** Komentář na řádku 261 sám říká „for middleware integration" |

**Tohle je ta věc, kterou musí matrix vyjasnit:** dnešní ochrana není „chybějící
auth". Je to **jedna hraniční kontrola pro celý povrch** plus dvě ostrůvkové
kontroly navíc. Bezpečnost tedy dnes stojí a padá s tím, že hranice drží
loopback (L0-10) — přesně jak to popisuje `CONTRACT.md §9`. Matrix má říct, co
zbude, až se ta jediná podmínka odstraní.

## 3. Postup

1. **Vyjmenovat všechny route klíče** ze všech zdrojů — `src/routes/*.js`,
   `trust-api.js`, `agents/api.js` a cokoli dalšího, co se registruje do téže
   tabulky. Číslo 264 je vstupní odhad z grepu, ne výsledek.
2. **Pro každý klíč zaznamenat:** modul, HTTP metodu, jestli jde o operaci
   čtoucí nebo měnící stav, jaký efekt může způsobit (souborový zápis, spuštění
   procesu, odchozí volání, změna konfigurace), a která z vrstev v `§2` ho dnes
   chrání.
3. **Označit route, kde by fail-closed guard rozbil dev mode.** To jsou ty,
   které dnes fungují jen díky localhost bypassu. Bez tohoto sloupce je matrix
   pro implementaci nepoužitelný.
4. **Zmapovat WS povrch samostatně.** `verifyClient` chrání **handshake**, ne
   jednotlivé zprávy. Vyjmenovat typy zpráv z `src/ws-bridge/protocol.js` a
   u každé určit, jestli může vyvolat stav měnící efekt. Zpráva, která to umí
   a projde jen handshake kontrolou, je ekvivalent neautentizované route.
5. **Ověřit, jestli `validateApiToken()` je použitelný tak, jak je.** Jeho
   podpis, zdroj tokenů a životní cyklus. Pokud by ho globální guard musel
   stejně přepsat, je to zjištění, které mění zadání `WP-M5-AUTH`.
6. **Negativní kontrola.** Podle `CONTRACT.md §5` u bezpečnostních claimů:
   vzít vzorek route ze všech kategorií z bodu 2 a **skutečně** proti běžícímu
   produktu ověřit, co se stane bez credentials a z ne-loopback origin.
   Deklarace v kódu není důkaz chování.

## 4. Výstup

Jediný soubor: **`docs/review/2026-08-07-AUTH-MATRIX.md`**

Povinné sekce:

1. **Route matrix** — úplná tabulka: klíč, modul, mění stav ano/ne, možný efekt,
   dnešní ochrana, rozbil by fail-closed guard dev mode ano/ne.
2. **WS matrix** — typ zprávy, možný efekt, dnešní ochrana.
3. **Ostrůvkové kontroly** — kde se dnes autorizuje mimo hlavní hranici a proč.
4. **Stav `validateApiToken()`** — použitelný / vyžaduje přepis, s odůvodněním.
5. **Negativní kontrola** — vzorek, přesné příkazy, pozorované odpovědi,
   verdikt podle `CONTRACT.md §5`.
6. **Návrh tvaru guardu** — kam by v dnešním dispatchi patřil a jaké kategorie
   by rozlišoval. Návrh, ne implementace.

## 5. Hranice

- žádný zápis mimo výstupní soubor;
- **nezavádět** guard, middleware ani `validateApiToken()` do dispatche — to je
  `WP-M5-AUTH` a je to zapisující práce vlastněná jedním vlastníkem;
- neměnit `C3_ADMIN_TOKEN` ani žádnou konfiguraci mimo dočasné lokální prostředí
  negativní kontroly;
- žádné hodnoty tokenů v reportu.

## 6. Stop condition

Zastavit a eskalovat, pokud:

- se najde route nebo WS zpráva, která projde **mimo** `evaluateLegacyLocalAccess()`
  — to znamená, že jediná dnešní hranice má díru, a je to bezpečnostní nález
  s přednostní eskalací, ne řádek v tabulce;
- negativní kontrola ukáže, že non-loopback origin projde — to je přímé porušení
  L0-10 a zastavuje sondu;
- se ukáže, že fail-closed guard nelze zavést bez změny veřejné sémantiky
  connectoru — pak to podle `CONTRACT.md §7` potřebuje operátorský souhlas
  a matrix má tu otázku pojmenovat, ne ji vyřešit.

## 7. Ověření, že sonda doběhla pravdivě

```bash
grep -rhoE "'(GET|POST|PUT|DELETE|PATCH) [^']+'" src/routes/*.js | wc -l   # 264 na vstupní revizi
grep -rn "requireAuth\|validateApiToken" src/ --include="*.js"
```

Matrix, který má méně řádků než první příkaz, musí každý chybějící klíč
vysvětlit. Matrix bez sekce negativní kontroly je deklarace, ne důkaz.
