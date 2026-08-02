# Chování #1 — Server, routing, DB, migrace

**`CONTRACT.md` §3 krok 2** · **2026-08-02** · `17a8b9a8`
**Stav: k schválení operátorem — před schválením se nepíše žádný test**

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
| **B-06** | **Fatální chyba při startu ukončí proces a nenaváže žádný další prostředek.** | ❌ **neplatí** |

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
| **B-11** | Žádná chybová odpověď neobsahuje stack trace ani absolutní cestu k souboru. | ⚠️ neověřeno |

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

## `B-06` — jediné chování, které dnes neplatí

Nalezeno při ověřování tohoto seznamu. Když start selže na obsazeném portu:

```
ERROR [C3:Process] Fatal error - shutting down {"message":"listen EADDRINUSE..."}
INFO  [C3:DB] Database connection closed
INFO  [C3:ModelCtx] Initialized qwen3.5:27b: num_ctx=8192      ← PO shutdownu
INFO  [C3:Server] Model context initialized
```

Inicializace pokračuje i poté, co fatální větev zavřela databázi. Proces
sice nakonec skončí, ale mezitím navazuje prostředky nad zavřeným spojením.

Není to blocker startu — v úspěšném případě se to neprojeví. Je to přesně ten
typ chování, který seznam chování odhaluje a který 142 000 řádků testů
minulo.

**Návrh:** `B-06` zůstane v seznamu jako platné chování a stane se **první
opravou v této schopnosti**. Test se napíše dřív než oprava.

---

## Úkoly z inventury, které se udělají spolu s touto schopností

Nejsou to chování, je to práce (inventura #1 §7):

1. Vyčlenit 19 rout modelů/upgradů ze `system.js` (`N-1`, `N-6`)
2. Srovnat `skills.js` a `autonomy.js` — pryč s přístupem k DB v čase importu (`N-7`)
3. Smazat mrtvý komentář po v57 (`server.js:1201`)
4. Sjednotit tři health routy na jednu
5. Aktualizovat stav v `docs/governor-v135-plan.md`
