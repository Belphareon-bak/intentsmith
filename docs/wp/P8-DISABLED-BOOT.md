# P8 — disabled-boot sonda

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** operátor · vlastník `WP-M3-BOUNDARY` (krok B)
**Důvod:** podmínka 5 z [`2026-08-08-MODULE-INDEPENDENCE`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §2
je označená jako **hlavní přejímací kritérium celého směru a jako jediná
měřitelná dnes** — a přesto změřená není.

[`2026-08-08-PARALLEL-PILOT`](../review/2026-08-08-PARALLEL-PILOT.md) §4
výslovně uvádí „izolovaná disabled-boot sonda" mezi tím, co smí běžet vedle
bez zápisu do zdroje.

---

## 1. Otázka, na kterou sonda odpovídá

**Zmizí vypnutý modul z boot grafu, nebo jen z routingu?**

Cílové znění je ostré: *odpojený modul musí zmizet z boot grafu, ne z disku* —
z import grafu jádra, routingu, timerů a background jobů, session state,
pending confirmations, DB zápisů a externích efektů.

Druhá polovina: **jádro musí nastartovat bez Ollamy** a vracet
`LLM_PROVIDER_UNAVAILABLE`, ne selhat bootem.

## 2. Co je už změřeno — nepřeměřovat

Statická část odpovědi existuje a je to nález **V4**:

> `server.js:110-127` staticky importuje všechny route moduly bez ohledu na
> flagy; podmíněná je až registrace (`:816`). Pre-handler zná jména volitelných
> modulů natvrdo (`pre-handler.js:56/89/101`). Vypnutý modul zůstává v grafu
> jádra.

Sonda tedy **nemá znovu dokazovat, že statický import zůstává**. Má změřit
runtime důsledky: co vypnutý modul přesto udělá.

Dostupné flagy jsou v `src/config.js`: `C3_ENABLE_AGENTS`, `C3_ENABLE_LIFECYCLE`,
`C3_ENABLE_EXPERTISES`, `C3_ENABLE_TELEMETRY`, `C3_ENABLE_AUTONOMY` (opt-in,
default OFF), `C3_ENABLE_SKILLS`, `C3_ENABLE_COMFYUI`,
`C3_ENABLE_ONLINE_DISCOVERY` (opt-in, default OFF).

## 3. Postup

Pro každý flag ve stavu vypnuto, v **izolovaném runtime rootu** — prázdné
`HOME`/`XDG`/`TMP`, vlastní DB, vlastní projekty a output adresář, unikátní
port, bez zděděných tajemství — změř a zapiš:

| Co | Jak |
|---|---|
| route | výčet registrovaných cest po bootu; porovnat s baseline |
| timer / background job | inventura aktivních handles po bootu a po 90 s |
| session state | pole vztažená k vypnutému modulu v `SessionState` |
| pending confirmation | existence záznamu po bootu |
| DB zápis | diff schématu i obsahu proti čerstvé DB |
| externí efekt | odchozí spojení pod blokující instrumentací |
| import graf | přítomnost modulu v boot cestě z `server.js` |

Zvlášť změř **boot bez dostupné Ollamy**: obsadit volný port, zavřít ho
a přesměrovat na něj `config.ollama.baseUrl` — konfigurace není zmrazená a čte
se při každém volání. Ověř, že server nastartuje a modelová cesta vrací
`LLM_PROVIDER_UNAVAILABLE`.

> **Prerekvizitu si sonda musí vyrobit, ne předpokládat od prostředí.** Na tomto
> stroji Ollama běží; „test nedostupného modelu" bez obsazeného portu měří
> skutečné volání včetně nahrání modelu a je bezcenný.

## 4. Sonda nesmí předrozhodnout krok B ani R6

- **nezakládá** fake LLM adaptér ani nové injection rozhraní — to je
  implementační krok a předrozhodlo by R6;
- **nepíše** test do `tests/**` ani ho neregistruje. Krok B je zapisující práce
  vlastněná `WP-M3-BOUNDARY` a MODULE-INDEPENDENCE §6.3 bod 4 ho odkládá až za
  stabilizaci M1, protože sahá do composition rootu;
- **nemění** `src/**`, `src/config.js` ani `server.js`.

## 5. Výstup

Jediný soubor: **`docs/review/<datum>-DISABLED-BOOT.md`**

Obsahuje matici modul × sedm sledovaných ploch s hodnotami
`ČISTÝ` / `ZŮSTÁVÁ` / `NEMĚŘITELNÉ`, přesné reprodukční příkazy a oddělenou
sekci pro Ollama-less boot. Každé `ZŮSTÁVÁ` je vstup zadání kroku B; sonda z něj
nedělá finding ani vadu.

## 6. Hranice

- žádný zápis mimo výstupní soubor;
- vlastní checkout nebo explicitně izolovaný artifact root — sonda vytváří DB
  a stav, takže **není filesystem-read-only** a sdílený checkout použít nesmí;
- žádný GPU běh, žádná skutečná odchozí síť;
- neaktualizuje `ROADMAP.md` ani `SYSTEM-MAP.md`.

## 7. Stop condition

- **BLOCK** — vypnutí modulu shodí boot. To je produktová vada, ne výsledek
  sondy; zapiš `docs/findings/` s minimální reprodukcí a pokračuj dalším flagem.
- **BLOCK** — měření by vyžadovalo změnu `src/**`.
- **PARK** — plocha je neměřitelná bez nového nástroje. Zapiš `NEMĚŘITELNÉ`
  s větou proč; nestav nástroj.

## 8. Ověření, že sonda doběhla pravdivě

```bash
git status --short          # čistý strom mimo výstupní soubor
git diff --stat             # prázdné pro src/**, tests/**, config
```

Každý řádek matice musí mít v dokumentu příkaz, kterým se dá přeměřit. Řádek
bez příkazu se nepočítá.
