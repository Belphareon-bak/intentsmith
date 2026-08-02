# Chování #1 — Server, routing, DB, migrace

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: schváleno 2026-08-02. Testy: `tests/capability-01-server-behaviours.test.js` — 13/13.**

> Každé chování je pozorovatelné zvenčí a má **právě jeden** test.
> Sloupec „dnes" je změřený stav, ne předpoklad.

---

## Start a databáze

| # | Chování | Dnes |
|---|---|---|
| **B-01** | Server se z čerstvého klonu spustí bez jakékoli konfigurace a odpoví na `GET /`. | ✅ |
| **B-02** | Na prázdné databázi se aplikují všechny migrace v pořadí; žádná neselže a žádná se nepřeskočí. | ✅ 47 / 0 skipped |
| **B-03** | Start nad již migrovanou databází neaplikuje žádnou migraci a nezmění schéma. | ✅ 0 aplikováno |
| **B-04** | Import databázového modulu bez `C3_DB_PATH` selže a nevytvoří žádný soubor. | ✅ |
| **B-05** | Po startu existuje port file s portem, na kterém server skutečně poslouchá. | ✅ |
| **B-06** | Fatální chyba při startu ukončí proces nenulovým exitem. | ✅ |
| **B-06b** | Fatální chyba při startu zavře databázi, kterou otevřela. | ✅ |
| **B-06c** | Neúspěšný start nechá běžící instanci a její port file nedotčené. | ✅ |

## Routing

| # | Chování | Dnes |
|---|---|---|
| **B-07** | Neexistující routa vrací 404 s JSON tělem. | ✅ |
| **B-08** | Parametrická routa předá dekódovaný parametr; nevalidní URL-encoding vrací 404, ne 500. | ✅ |

## Chyby

| # | Chování | Dnes |
|---|---|---|
| **B-09** | Nevalidní JSON v těle vrací 400. | ✅ |
| **B-10** | Tělo nad limit vrací 413 a sděluje limit. | ✅ `max 6MB` |
| **B-11** | Žádná chybová odpověď neobsahuje stack trace ani absolutní cestu k souboru. | ✅ |

## Hranice

| # | Chování | Dnes |
|---|---|---|
| **B-12** | Požadavek s cizím `Origin` je odmítnut dřív, než dosáhne handleru. | ✅ 403 |
| **B-13** | Konfigurace vedoucí k bindu mimo loopback start odmítne — nenulový exit, žádný listener. | ✅ wildcard i LAN |

## Degradace

| # | Chování | Dnes |
|---|---|---|
| **B-14** | Bez dostupného modelu server běží, čte data a LLM cesta vrací 503 `LLM_PROVIDER_UNAVAILABLE` s `recoverable: true`. | ✅ |

---

## Čeho se seznam vědomě nedotýká

- **Počtů jako asercí.** „47 migrací" a „95 tabulek" jsou dnešní snímek; test
  na konkrétní číslo by selhal při přidání 48. měřítka. `B-02` proto tvrdí
  *„všechny a žádná neselže"*, ne kolik jich je.
- **Výkonu.** 0,63 ms / 0,87 ms je změřené a zapsané v `SYSTEM-MAP.md`, ale
  jako chování by to byl křehký test závislý na stroji. Patří do L3.
- **Autentizace.** Odložena rozhodnutím operátora (`CONTRACT.md` §9).

---

## `R-1` — závod mezi inicializací a `listen()`, nikoli vada chování

**Oprava mého vlastního tvrzení.** V předchozí verzi tohoto dokumentu bylo
`B-06` formulováno jako *„fatální chyba nenaváže žádný další prostředek"*
a označeno za jedinou vadu. Při psaní testu se ukázalo, že to **není
testovatelné chování**.

Dvě pozorování téhož scénáře:

| Běh | Pořadí |
|---|---|
| 1 | `Fatal error` → `Database connection closed` → **`Model context initialized` o 6 ms později** |
| 2 | **`Model context initialized` o 8 ms dřív** → `EADDRINUSE` → `Fatal error` |

Inicializace kontextu modelu běží **souběžně s `listen()`** a vyhraje ten,
kdo doběhne dřív. Tvrzení „po fatální chybě se už nic neinicializuje" je tedy
**časový výsledek závodu, ne vlastnost systému** — a test na něj by byl flaky.

`B-06` proto bylo rozděleno na tři deterministická chování (`B-06`, `B-06b`,
`B-06c`), která platí bez ohledu na časování. Závod sám je zaznamenán zde
jako `R-1`:

- **Není to blocker.** V úspěšném startu se neprojeví a při selhání proces
  stejně skončí nenulovým exitem se zavřenou databází (`B-06`, `B-06b`).
- **Zůstává jako latentní nález.** Inicializace nad zavřeným spojením není
  správná, jen dnes neškodná.
- **Neopravuje se teď**, protože oprava znamená sekvencovat startovní
  inicializaci — zásah do `server.js` bez chování, které by ho chránilo.

**Poučení pro metodu:** seznam chování odhalil nejen mezeru v produktu, ale
i chybu ve vlastním zadání. Chování musí být deterministické; když je jeho
platnost otázkou milisekund, není to chování.

---

## Úkoly z inventury, které se udělají spolu s touto schopností

Nejsou to chování, je to práce (inventura #1 §7):

1. Vyčlenit 19 rout modelů/upgradů ze `system.js` (`N-1`, `N-6`)
2. Srovnat `skills.js` a `autonomy.js` — pryč s přístupem k DB v čase importu (`N-7`)
3. Smazat mrtvý komentář po v57 (`server.js:1201`)
4. Sjednotit tři health routy na jednu
5. Aktualizovat stav v `docs/governor-v135-plan.md`
