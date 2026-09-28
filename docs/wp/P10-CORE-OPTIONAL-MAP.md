# P10 — file-level cestová mapa `core / optional`

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** operátor · vlastník `WP-M3-BOUNDARY`
**Důvod:** krok **A2** z [`2026-08-08-MODULE-INDEPENDENCE`](../review/2026-08-08-MODULE-INDEPENDENCE.md) §7
(směrové pravidlo `core → optional` v ratchetu) závisí na `R1` **a přijaté
cestové mapě**. R1 je přijatý 2026-08-08; mapa neexistuje.

R1 sám to říká: *„je nutným vstupem cestové mapy, ale sám ještě neurčuje přesné
soubory pro směrové pravidlo."* Tuhle mezeru sonda zavírá.

---

## 1. Otázka, na kterou sonda odpovídá

**Který soubor v `src/**` patří do jádra a který do odpojitelného modulu?**

Přijaté znění R1 dává doménovou odpověď:

> Funkční jádro tvoří **Conversation/Chat, CRE a Project Lifecycle**. Jejich
> nutnou infrastrukturou jsou composition root, publikované core kontrakty,
> LLM gateway a aktivní model binding, project identity/scope, persistence
> kernel a effect/approval/audit boundary. **Expertises jsou odpojitelný
> modul**; jádro vlastní pouze obecnou extension a prompt-contribution hranici.

Sonda ji převádí na soubory. **Je to derivace z přijatého rozhodnutí, ne nové
rozhodnutí** — a přesně tím se liší od kroku G.

## 2. Co je už změřeno — nepřeměřovat

| Fakt | Hodnota | Zdroj |
|---|---:|---|
| P6 source souborů | 416 | [`IMPORT-CENSUS`](../review/2026-08-09-IMPORT-CENSUS.md) |
| vnitřních hran | 1 004 | tamtéž |
| hran přes top-level boundary | 547 | tamtéž |
| unikátních směrovaných boundary dvojic | 137 | tamtéž |
| cykly / soubory v cyklech | 3 / 28 | tamtéž |
| přímých hran ze `src/server.js` | 87 | tamtéž |
| aktuální ratchet baseline | 1 016 hran | `scripts/module-boundary-ratchet.mjs` |

Census sám varuje: *„z čísel neplyne, že má vzniknout 137 portů"* a *„bucket
**není** rozhodnutí `core / optional`."* Sonda tedy **nesmí** vydat top-level
adresář za odpověď.

Autoritativní měřidlo je `scripts/module-graph.mjs`. Sonda nepíše nový parser.

## 3. Postup

1. Z existujícího grafu vypsat všech 416 souborů.
2. Každému přiřadit právě jednu značku: `CORE`, `OPTIONAL`, `NEROZHODNUTELNÉ`.
   Třetí kategorie je povinná a nesmí se schovávat — soubor, který dělá obojí,
   je nález, ne chyba klasifikace.
3. Pro každý `OPTIONAL` soubor vypsat příchozí hrany z `CORE`. To je přesná
   množina, kterou by směrové pravidlo A2 dnes shodilo.
4. Vypsat, které z těchto hran leží uvnitř 21modulového chat SCC — ty nelze
   rozetnout přesunem souboru a patří do kroku G.
5. Odhadnout dopad na ratchet: kolik z 1 016 hran by směrové pravidlo označilo
   jako porušení, kdyby se zapnulo dnes.

Bod 5 je hlavní výstup pro rozhodnutí. Pokud je číslo velké, A2 se nezapíná
jako fail-closed pravidlo, ale jako měřený ukazatel s expirujícím allowlistem —
a to je informace, kterou musí mít operátor **před** zadáním A2, ne po něm.

## 4. Co sonda nerozhoduje

- **nezapisuje** směrové pravidlo do checkeru — to je krok A2, zapisující práce;
- **nepřesouvá** ani jeden soubor — to je krok C a G;
- **nerozhoduje** hranice jádra nad rámec přijatého R1; pokud R1 na konkrétní
  soubor nestačí, je to `NEROZHODNUTELNÉ` a jde do rozhodovací fronty;
- **nevytahuje** expertises — cena je popsaná v R1 (`SessionState` i CRE mají
  expertise-specific pole) a patří do kroku G.

## 5. Výstup

Jediný soubor: **`docs/review/<datum>-CORE-OPTIONAL-MAP.md`**

- tabulka 416 souborů se značkou a jednořádkovým odůvodněním u každého
  `OPTIONAL` a `NEROZHODNUTELNÉ`;
- seznam `CORE → OPTIONAL` hran s vyznačením, které leží v chat SCC;
- číslo z §3 bodu 5 a doporučení, jestli A2 zapnout fail-closed, nebo měřeně;
- seznam `NEROZHODNUTELNÉ` jako vstup rozhodovací fronty `ROADMAP.md §14`.

## 6. Hranice

- žádný zápis mimo výstupní soubor;
- vlastní artifact root — sonda generuje JSON výstup měřidla, takže
  filesystem-read-only není;
- žádná změna `scripts/**`, `src/**`, `tests/**`, `ROADMAP.md`, `SYSTEM-MAP.md`;
- **žádný nový parser** — jen `scripts/module-graph.mjs`.

## 7. Stop condition

- **BLOCK** — R1 na velkou část stromu nestačí a `NEROZHODNUTELNÉ` převáží.
  To je pravdivý výsledek: znamená, že A2 se dnes zapnout nedá a rozhodnutí
  o hranici musí předcházet. Zapiš a skonči; nedoplňuj vlastní výklad R1.
- **FINDING** — soubor je v jádře i modulu současně (import-time side effect
  přes hranici). Zapiš, neopravuj.
- **PARK** — jednotlivý soubor nelze zařadit. Značka `NEROZHODNUTELNÉ` s větou
  proč; sonda kvůli tomu neskončí.

## 8. Ověření, že sonda doběhla pravdivě

```bash
node scripts/module-graph.mjs | tail -3     # 416 souborů, shodná čísla s censem
git status --short                          # čistý strom mimo výstupní soubor
```

Součet `CORE + OPTIONAL + NEROZHODNUTELNÉ` se musí přesně rovnat počtu souborů
vypsaných měřidlem. Nesouhlasí-li, mapa je neúplná a nepřijímá se.
