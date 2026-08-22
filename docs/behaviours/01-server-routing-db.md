# Chování #1 — Server, routing, DB, migrace

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: schváleno 2026-08-02; M1 aktivace doplněna 2026-08-22. Testy: `tests/capability-01-server-behaviours.test.js` — 14/14.**

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
| **B-15** | Produkční WS server ACKuje `m1-wire-v1` právě jednou jen klientovi, který jej explicitně nabídl; legacy klient jej nedostane. | ✅ |

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

Nejsou to chování, je to práce (inventura #1 §7).

| # | Úkol | Stav |
|---|---|---|
| 1 | Vyčlenit routy modelů/upgradů ze `system.js` (`N-1`, `N-6`) | **odloženo — viz níže** |
| 2 | Srovnat `skills.js` a `autonomy.js` (`N-7`) | ✅ hotovo |
| 3 | Smazat mrtvý komentář po v57 | ✅ hotovo |
| 4 | Sjednotit tři health routy | ✅ hotovo |
| 5 | Aktualizovat stav v `governor-v135-plan.md` | ✅ hotovo |

### Proč je úkol 1 odložený

Dva důvody, oba zjištěné až při pokusu o provedení:

1. **Rozsah je větší, než inventura uváděla — 23 rout z 36, ne 19.** Model,
   upgrade a proposals tvoří 64 % `system.js`.
2. **Řez není mechanický.** `createSystemRoutes` drží sdílený stav uvnitř
   továrny — `recomputeQueue` (Map), closure `enqueueUniverseRecompute`,
   `fetchShowWithStability`, `rawDb`, `dataDir` — a část ho používají obě
   skupiny rout. Rozdělení tedy znamená rozhodnout, kam který helper patří,
   ne přesunout bloky.

**Rozhodující důvod je ale třetí:** chování napsaná v tomto dokumentu pokrývají
*infrastrukturu* schopnosti #1 — start, routing, chyby, hranice. **Nepokrývají,
co těch 23 rout dělá.** Ty patří schopnostem #18a a #18b, které svým seznamem
chování zatím neprošly.

Přesunout je teď by znamenalo stěhovat 23 rout, jejichž funkci nic neověřuje —
přesně ten postup, který `CONTRACT.md` odmítá a proti kterému jsem argumentoval
u `X-1`.

**Spouštěč:** úkol se provede, až #18a (4. v pořadí) dostane svůj seznam chování.
Tím vznikne ochrana, která dnes chybí, a hranice mezi 18a a 18b bude popsaná
chováním, ne odhadem.
