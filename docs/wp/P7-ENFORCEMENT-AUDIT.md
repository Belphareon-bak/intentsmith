# P7 — audit vynucení deklarovaných kontraktů

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `13701b2a500feac94d13322433721125793c4587`
**Adresát:** operátor · vlastník M6 (validační matice třinácti invariantů)
**Závislost:** [`P6-MODULE-GRAPH`](P6-MODULE-GRAPH.md) — švy, o které se audit opře
**Důvod:** `L8-2` je precedent, ne výjimka. Guard hranice specialisty existoval,
vypadal zavedeně a vypisoval nulu, zatímco porušení trvalo. `CONTRACT.md §2`
vyžaduje pro M6 všech třináct invariantů bez otevřeného porušení a `§4` chce
u každého schváleného chování *pojmenovaný důkaz, který při rozbití zčervená*.
Než se M6 začne plánovat, musí být známo, kolik takových důkazů existuje.

---

## 1. Otázka, na kterou sonda odpovídá

Pro každý deklarovaný kontrakt v repozitáři: **existuje mechanismus, který ho
vynucuje, a kdy naposledy zafungoval?**

Deklarovaný kontrakt je tady: třináct L0 invariantů, hranice specialisty, route
tabulka, `ctx`, barrel `index.js` a `.d.ts` deklarace — tedy to, co P6 označila
za šev.

Sonda **neprohlašuje invariant za splněný ani porušený**. Stav invariantů je
v `SYSTEM-MAP.md` a mění ho jen měření nebo operátor. Audit je o patro níž:
ptá se, čím by se porušení poznalo.

## 2. Postup

1. **Registr testů jako první mechanismus.** `tests/registry.json` má u každé
   suity pole `lastGreen`. Zjistit, kolik suit má zapsaný commit, kdo tu hodnotu
   zapisuje a co přesně validuje `scripts/test-registry.js`. Rozlišit kontrolu
   **tvaru** pole od kontroly jeho **obsahu**.
2. **Pro každý invariant najít místo v kódu**, které při porušení zasáhne.
   U každého rozlišit, jestli mechanismus **hází**, **vrací varování**, nebo
   jen popisuje záměr v komentáři.
3. **Ověřit dosah mechanismu, ne jeho existenci.** Otázka není „je tam guard",
   ale „kouká guard na to místo, kde porušení vzniká" (`L8-2`) a „dá se
   parametrem nebo proměnnou prostředí obejít bez kontroly".
4. **Klasifikovat.** Tvary vynucení pojmenovat a přiřadit, aby výsledek nebyl
   třináct nesouvisejících poznámek, ale malý počet opakujících se vzorů.
5. **Švy z P6.** Pro každý zjistit, co ho vynucuje. Prázdná buňka je platný a
   důležitý výsledek.
6. **Označit hloubku u každého řádku** — trasováno / lokalizováno / bez
   mechanismu. Řádek bez označení hloubky se čte jako závěr, kterým není.

## 3. Sada se nespouští

Sonda je statická a je to podmínka, ne omezení. `scripts/nightly-audit.js`,
`scripts/test-registry.js` i `tests/registry.json` mají zapisujícího vlastníka
podle `CONTRACT.md §6`; běh by měřil pohyblivý cíl a sahal na sdílený stav
(`data/c3.db`, porty, `.intentsmith-artifacts/`).

Z toho plyne tvrdá hranice výstupu: report **nesmí** o žádném invariantu
napsat, že prošel nebo neprošel. Smí napsat jen, čím by se to poznalo a jestli
takový důkaz existuje.

## 4. Výstup

Jediný soubor: **`docs/review/2026-08-07-ENFORCEMENT-AUDIT.md`**

Povinné sekce:

1. **Metoda a hranice** — proč se nespouští, jak se značí hloubka.
2. **Registr testů** — čísla podle bodu 1 postupu.
3. **Tabulka třinácti invariantů** — mechanismus s `file:line`, tvar, hloubka.
4. **Tvary vynucení** — s doloženým příkladem u každého.
5. **Švy z P6** — deklarace proti vynucení.
6. **Co audit nerozhodl.**
7. **Ověření** — příkazy, které projdou komukoli.

## 5. Hranice

- žádný zápis mimo `docs/review/2026-08-07-ENFORCEMENT-AUDIT.md` a jeden řádek
  v obou `README.md` indexech;
- žádná změna `SYSTEM-MAP.md`, `ROADMAP.md`, `CONTRACT.md`, `src/**`, `tests/**`,
  `scripts/**`;
- **žádná nová kontrola.** I když se najde mezera s levným řešením, trvalý
  mechanismus je aparát podle `CONTRACT.md §12` a je to rozhodnutí operátora,
  ne výstup sondy.

## 6. Stop condition

Zastavit a eskalovat, pokud:

- se najde invariant, který je porušený **a** dosud nezaznamenaný v
  `SYSTEM-MAP.md` — to už není audit mechanismu, ale otevřené porušení podle
  `CONTRACT.md §2` a hlásí se okamžitě;
- by zjištění vyžadovalo spustit sadu nebo zapsat mimo `docs/review/`.

## 7. Ověření, že sonda doběhla pravdivě

```bash
node -e "const s=require('./tests/registry.json').suites;
  console.log(s.length, s.filter(x=>x.required).length,
  s.filter(x=>x.lastGreen&&x.lastGreen.commit).length,
  s.filter(x=>x.state==='BLOCKED').length)"
```

Report musí mít u každého ze třinácti invariantů vyplněnou hloubku a v sekci
„Ověření" příkazy, které projdou. Řádek bez `file:line` nebo bez označené
hloubky požadavek nesplňuje.
