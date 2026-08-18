# 024 — Producenti mobilního companiona a nativní shell (prototyp)

- **typ:** implementační rozhodnutí pro prototyp; **nemění kontrakt `/m1`**
- **stav rozhodnutí:** ZAPSÁNO autorem prototypu 2026-08-18; čeká na přijetí
  operátorem. Do přijetí platí strop v §5
- **WP:** prototyp mobilní aplikace (větev `wp/mobile-prototype-20260817`)
- **navazuje na:** `F-100` (producent approvalů), `DR-013 A` (S1 mirror),
  `F-111`/`F-112` (fail-closed kanál), `MR-22`/`MR-23` (úložiště a zámek)

> **Bezpečnostní upřesnění po konsolidaci:** řádek 8 níže je v současné
> implementaci pouze `PARTIAL`. Credential je chráněný at rest, ale klient jej
> při bootu načte do JavaScriptové paměti a `onPause` tuto relaci ani aktivní
> requesty nevymaže. Před produkčním přijetím musí background provést session
> invalidaci, abort a epoch guard. Kanonický stav a úplný backlog jsou v
> [`FINAL-PROTOTYPE.md`](../mobile/FINAL-PROTOTYPE.md).

## Proč to vůbec vzniká jako rozhodnutí

`tests/mobile-approval-authority.test.js` končí testem, který **selže ve chvíli,
kdy někdo zapojí producenta approvalů, aniž by to rozhodnutí zapsal**. To byl
záměr: `createMobileApproval()` byl hotový a správný, ale nic ho nevolalo, a
zapojení emitoru rozšiřuje produkční povrch před M6 — což je release autorita,
ne rozhodnutí jednoho WP.

Tenhle dokument je ten zápis. Producent existuje, protože bez něj prototyp
nemůže ukázat ★ use case: prázdná fronta approvalů je k nerozeznání od klidné,
a to je přesně vada, kterou `F-111` popisuje na schránce.

## Co bylo rozhodnuto

| # | Rozhodnutí | Důvod |
|---|---|---|
| **1** | Producent žije v **`src/mobile/companion-producer.js`**, ne v routách | `handlers.js`, `gateway.js` a `server.js` zůstávají bez `createMobileApproval` — ratchet v testu drží dál a hlídá to, co hlídal |
| **2** | Approval se razí **výhradně** přes `createMobileApproval` | `DR-011` okno, počítaný otisk a povinná vazba jsou tím vlastností každého řádku, ne konvencí volajícího |
| **3** | S1 mirror má **uzavřený slovník** (`S1_VOCABULARY`, 9 položek) | `MD-08`: notifikace je S1 ukazatel bez obsahu. Text nejde parametrizovat — volající nemá jak obsah propašovat |
| **4** | Rozhodnutí se čeká **na řádku, ne na promise** | Gateway a jádro jsou různé procesy nad jedním SQLite. `awaitDecision()` proto vidí odpověď, kterou napsal jiný proces — tudy `F-100` uzavřít šlo, přes in-memory mapu `edit_request` ne |
| **5** | Ticho se hlásí jako ticho | `timeout` a `expired` jsou samostatné odpovědi; nikde se nemění na `approve` |
| **6** | Průběh běhu jede **stávající schránkou**, ne novou routou | `MR-07` je `BLOCKED_BY_CONTRACT`; prototyp běží na zmrazených 13 routách a nová `/m1/runs/:id/events` by je porušila |
| **7** | Nativní shell je **Capacitor nad servírovaným klientem** (`server.url`) | Klient zůstává jeden. Kdyby se assety balily do APK, vznikla by druhá kopie UI a gateway by musela otevřít CORS |
| **8** | Token jde do **Android Keystore** a zapečetí se zámkem | `MD-11` žádá `ST-SECURE` „výhradně"; prohlížeč ho nemá, proto byly `MR-22`/`MR-23` `PARTIAL`. Zámek vynucuje `LockPolicy` odmítnutím čtení, ne jen překrytím obrazovky |

## Co se tím **ne**rozhodlo

- **Nic z kontraktu v2.** Šest nových domén, `CoreEvent` v2 s diskriminovaným
  subjektem ani jedenáct otevřených nálezů se prototypu netýká.
- **Gate 0, Remote Beta, `G0-R032`.** Gateway se dál váže na loopback; cesta
  z telefonu je `adb reverse`, který nic nevystavuje.
- **Push (`N-1`).** Spící aplikace notifikaci nedostane. Schránka je pull.

## 5. Strop, dokud to operátor nepřijme

1. Producent se **nespouští sám**. Volá ho jen `scripts/mobile-demo-run.js`
   a testy; v `server.js` ani v gateway pro něj není žádné zapojení.
2. `MobileChannel` zůstává fail-closed a capability drží **jen** projektor.
3. Prototypová větev se **nemerguje do M1 linie** — mění `tests/registry.json`,
   o který se opírá běžící Gate 1 evidence (stejný důvod jako u
   `wp/mobile-refresh-20260809`).
4. Podpisový klíč v `mobile-app/keys/` je **interní prototypový**, git-ignorovaný.
   Do obchodu s ním nejde nic a nesmí se zaměnit za release ceremonii.

## 6. Co by přijetí odemklo

Zapojení `requestApproval()` do reálného seamu jádra (`fs.write` v režimu
`ask`, `src/ws-bridge/session-adapter.js`) — s tím, že tamní okno je 30 s
a `DR-011` žádá 5 minut, takže sjednocení oken je součást toho rozhodnutí,
ne jeho vedlejší efekt.
