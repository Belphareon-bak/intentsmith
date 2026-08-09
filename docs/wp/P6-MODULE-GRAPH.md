# P6 — měřený modulový graf a mapa švů

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `13701b2a500feac94d13322433721125793c4587`
**Adresát:** operátor · agent, který by psal kontraktový registr · `WP-M3-BOUNDARY`
**Důvod:** čtyři sondy P2–P5 našly čtyři varianty téhož: kontrakt existoval na
papíře a nikde se nevynucoval. Guard specialistů vypsal nulu (`L8-2`), duplicitní
route klíč tiše přebil jiný, nástroje se zdvojily, protože nebyl šev. Než se
začne psát registr kontraktů, musí být známo, **které švy repozitář skutečně má** —
jinak vznikne druhý dokument, který se čte jako popis a je to plán.

---

## 1. Otázka, na kterou sonda odpovídá

**Kde jsou v `src/**` skutečné hranice a které z nich někdo deklaroval?**

Rozhodnutí, které to připravuje, je rozsah kontraktového registru: psát ho pro
všech 407 souborů je aparát, psát ho pro švy vybrané dojmem je hádání. Sonda
dodá seznam odvozený z grafu, ne z názorů.

Sonda **nerozhoduje** disposition ani rozsah registru — obojí je podle
`CONTRACT.md §7` operátorské.

## 2. Východisko

Předchozí hrubé měření grepem dalo *405 souborů, 1195 hran, 87 bez konzumenta*.
Ta čísla se nesmějí přebírat: nerozlišují JSDoc typovou referenci od vykonávaného
importu, počítají řádky uvnitř scaffold šablon a dvojí import téhož modulu.
Sonda začíná od nuly nástrojem, jehož výstup je přeměřitelný.

## 3. Postup

1. **Postavit graf mechanicky.** Uzly = soubory v `src/**`. Hrany = `import`,
   `export … from`, `import()` s literálem, `require()`. Oddělit komentáře, aby
   JSDoc `import('…')` nevytvářel runtime hranu. Nečíst obsah template literálů —
   `src/domains/scaffolds/**` generuje cizí projekty.
2. **Deklarovat vstupní body a spočítat dosažitelnost.** Dosažitelnost nejde
   odvodit z grafu; každý vstup musí mít důvod doložený v kódu (`package.json`
   `main`, dynamické načítání adresáře, `bin/**`). Teprve rozdíl mezi „nulový
   fan-in" a „nedosažitelný" je použitelný.
3. **Ručně projít každé `import()` s vypočítanou cestou.** Bez toho je seznam
   nedosažitelných modulů nedůvěryhodný. Určit, které cíle jsou uvnitř `src/**`.
4. **Fan-in žebříček a šířka povrchu.** U modulů s fan-in ≥ 5 změřit, kolik
   **různých symbolů** si konzumenti berou. Vysoký fan-in s úzkým povrchem je
   levná hranice; se širokým povrchem drahá. Bez tohohle rozlišení je žebříček
   jen popularita.
5. **Klasifikovat švy.** Pro každý kandidátský šev určit, zda existuje
   deklarovaná hranice (route tabulka, `ctx`, barrel `index.js`, `.d.ts`,
   dokument) a zda jí konzumenti skutečně procházejí. Poměr „přes hranici" :
   „kolem hranice" změřit, ne odhadnout.
6. **Triáž modulů bez konzumenta.** Každý zařadit: vstupní bod / dynamicky
   načítaný / asset jiného runtimu / jen testy / bez konzumenta. U kandidátů na
   „mrtvý" ověřit i **řetězcové** odkazy, ne jen importy.
7. **Cykly.** SCC > 1. U největšího vypsat celý obsah — je to vstup do otevřené
   otázky „Rozdělení #6" v `CONTRACT.md §9`.

## 4. Historické umístění sondy a současné vlastnictví

Při původní sondě měly `src/**` i `scripts/**` jiného vlastníka. Nástroj proto
vznikl u reportu a nebyl součástí průběžné linky. Po samostatném operátorském
přijetí ratchetu se provozní vlastnictví změnilo:

- autoritativní nástroj leží v `scripts/module-graph.mjs`; datovaná cesta u
  reportu je jen kompatibilitní wrapper;
- **není zapojený do `package.json`**. Průběžné hlídání driftu je přijatý
  aparát podle `ROADMAP.md §12` a spouští jej registrovaný boundary checker;
- výstup je setříděný JSON, aby se drift příště zjistil `git diff`em.

## 5. Výstup

Historický report a data zůstávají v `docs/review/`; provozní scanner je ve
`scripts/`:

| Soubor | Co to je |
|---|---|
| `2026-08-07-MODULE-GRAPH.md` | report |
| `scripts/module-graph.mjs` | autoritativní měřidlo; datovaný review vstup je kompatibilitní wrapper |
| `2026-08-07-MODULE-GRAPH.json` | strojově čitelný graf |

Povinné sekce reportu:

1. **Jak se měřilo** — vstupní body s důvodem, tři limity metody, rozchod
   s předchozími hrubými čísly.
2. **Číselný obraz.**
3. **Fan-in žebříček** — s šířkou povrchu a sloupcem „deklarovaná hranice".
4. **Švy** — deklarované a procházené / deklarované a obcházené / nedeklarované.
5. **Nedosažitelné moduly** — s triáží podle bodu 6 postupu.
6. **Cykly.**
7. **Co sonda nerozhodla** — explicitně, aby se report nečetl jako disposition.
8. **Ověření** — příkazy, kterými si to přeměří kdokoli.

## 6. Hranice

- žádný zápis mimo tři soubory v `docs/review/`;
- žádná změna `ROADMAP.md`, `SYSTEM-MAP.md`, `CONTRACT.md`, `src/**`, `tests/**`
  ani `package.json`;
- report neoznačí žádný modul za mrtvý — to je disposition;
- do `docs/wp/README.md` se doplní řádek tabulky, protože tam se podle jejího
  vlastního pravidla drží stav sond, a upraví se hlavičková revize, aby
  netvrdila `1fc8f03e` i pro P6; do `docs/review/README.md` řádek indexu.

## 7. Stop condition

Zastavit a eskalovat, pokud:

- se ukáže, že dynamické načítání pokrývá tolik `src/**`, že statický graf není
  vypovídající — pak je otázka runtime, ne struktury, a patří do WP;
- kterýkoli nedosažitelný modul má vazbu na L0 invariant — pak to není triáž,
  ale otevřené porušení a hlásí se okamžitě;
- měření by vyžadovalo spustit produkt nebo zapsat mimo `docs/review/`.

## 8. Ověření, že sonda doběhla pravdivě

```bash
node scripts/module-graph.mjs . --out docs/review/2026-08-07-MODULE-GRAPH.json
git diff --stat docs/review/2026-08-07-MODULE-GRAPH.json     # na čisté revizi musí být prázdné
```

Report bez neprázdné sekce „Ověření" s příkazy, které projdou, požadavek
nesplňuje. Číslo, které se nedá přeměřit, do reportu nepatří.
