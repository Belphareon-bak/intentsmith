# 005 — D-4: retry policy modelového connectoru v1

- **typ:** DECIDE
- **WP:** WP-M1-MODEL
- **rail:** R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R6 REVERSIBILITY
- **vzniklo při:** `src/llm/gateway.js:callWithPolicy()` a `tests/m1-model-contract.test.js`

## Evidence na stole

Legacy `callWithAuth()` používá konfiguraci `config.ollama.retries` a má devatenáct
existujících konzumentů s různými fallbacky. Connector v1 naproti tomu potřebuje
právě jeden přiřaditelný provider effect pro jeden `ModelRequest`. Focused fake
test předal `retries: 99` a naměřil přesně jedno volání `fetch`; stejné pravidlo
platilo pro HTTP 404/500/503 i odmítnuté spojení.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — jeden pokus pouze pro connector v1 | `callWithPolicy()` vynutí `retries: 1`; legacy cesta se nemění | Přesný jeden effect a snadno čitelná latence; dočasná odlišnost dvou policy cest | Současný stav: `src/llm/gateway.js`, `tests/m1-model-contract.test.js`; adaptér v `src/llm/cre-bridge.js` jej pouze použije |
| B — zachovat legacy retry i pro v1 | Každý request může vytvořit až konfigurovaný počet provider pokusů | Menší rozdíl proti legacy, ale jeden connector request už není jeden effect a failure latency se násobí | Změnit `src/llm/gateway.js:callWithPolicy()` a nejméně šest asercí v `tests/m1-model-contract.test.js` |
| C — sjednotit celý produkt na jeden pokus | `callWithAuth()` i v1 přestanou retryovat | Nejjednodušší model, ale mění chování devatenácti legacy konzumentů bez jejich acceptance evidence | `src/llm/gateway.js`, nejméně 19 konzumentů a jejich focused/integration testy; mimo tento WP |

## Vzatý default a proč

Varianta **A**. Je nejvratnější a o legacy produktu tvrdí nejméně: nové pravidlo
je uzavřené v jedné nové policy funkci, zatímco všechny současné konzumenty
ponechává beze změny.

## Šev

`src/llm/gateway.js:callWithPolicy()`.

## Cena přepnutí, když operátor rozhodne jinak

Přepnutí na B mění jeden produkční soubor a `tests/m1-model-contract.test.js`;
adaptér `src/llm/cre-bridge.js` se nemění. Přepnutí na C není lokální změna:
vyžaduje inventuru a focused evidence všech devatenácti legacy konzumentů, proto
není vratným defaultem tohoto WP.

## Rozhodnutí operátora — 2026-08-08

**Potvrzena varianta A.** Jeden `ModelRequest` v1 smí vytvořit právě jeden
provider attempt. Devatenáct legacy konzumentů `callWithAuth()` si dočasně
ponechává svou stávající retry policy; sjednocení celého produktu bez jejich
acceptance evidence není součástí M1.
