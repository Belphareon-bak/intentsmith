# P2 — L0-8 import graph a prototyp obou variant

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Adresát:** operátor (rozhodnutí `§14` ROADMAP) · agent, který povede `WP-M3-BOUNDARY`
**Důvod:** L0-8 je `CARRIED_BLOCKER` s termínem *„před prvním zapisujícím commitem
WP-M3-BOUNDARY"*. Bez evidence se rozhodne pozdě a zastaví M3.

---

## 1. Otázka, na kterou sonda odpovídá

ROADMAP `§14`: **strict injection versus veřejná verzovaná extension boundary.**
Požadovaná evidence na stole: *skutečný import graph, specialista E2E a nejmenší
prototyp obou variant.*

Sonda dodává první a třetí položku a připraví scénář pro druhou. Nerozhoduje —
disposition zachovat/nahradit je podle `CONTRACT.md §7` operátorská.

## 2. Co je už ověřeno (nepřeměřovat)

Na vstupní revizi jsou v `specialists/**` **čtyři** textové výskyty `../../src/`,
ale jen **jeden vykonávaný import**:

| Místo | Tvar | Runtime coupling |
|---|---|---|
| `specialists/accountant-cz/adapters.js:12` | `import { ToolAdapter } from '../../src/expertises/tool-adapter.js'` | **ano** — jediné skutečné porušení |
| `specialists/accountant-cz/knowledge/seed.js:17` | `@param {import('../../../src/expertises/knowledge-base.js').KnowledgeBase}` | ne — JSDoc typ |
| `specialists/dummy-logger/index.js:44` | `@param {import('../../src/expertises/specialist-runtime.js').SpecialistRuntime}` | ne — JSDoc typ |
| `specialists/dummy-logger/index.js:80` | totéž | ne — JSDoc typ |

Importovaný symbol je jediný: `ToolAdapter` (třída, `src/expertises/tool-adapter.js:23`).
Balíčků ve `specialists/`: 5 (`accountant-cz`, `code-reviewer`, `dummy-logger`,
`sazeni`, `translator`). Načítání jde přes `src/specialists/specialist-loader.js`
(scan adresáře + `specialist.json` manifest + `validateManifest()`).

**Tohle je ta netriviální část nálezu:** porušení L0-8 není plošné. Je to jedna
hrana a jeden symbol. Tři zbylé výskyty jsou typové anotace — literu invariantu
*„žádný `import ../../src/`"* porušují, runtime hranici ne. Rozhodnutí se tedy
netýká rozsáhlé migrace, ale toho, čím se nahradí **jedna** hrana a jestli se
JSDoc reference počítají.

## 3. Postup

1. **Uzavřít import graph, ne jen grep.** Ověřit, že `ToolAdapter` je opravdu
   jediný symbol, který balíček ze `src/**` potřebuje: projít tranzitivně, co
   `adapters.js` používá z instance/prototypu `ToolAdapter`, a co dělá
   `tool-adapter.js` sám (jestli dál nesahá do `src/**` způsobem, který by se
   přenesl do SDK).
2. **Zmapovat obrácený směr.** Které moduly v `src/**` naopak sahají do
   `specialists/**`. Výchozí seznam kandidátů je znám (`specialist-loader.js`,
   `capability-registry.js`, `expertises/specialist-runtime.js`,
   `expertises/knowledge-base.js`, `marketplace/package-installer.js`,
   `routes/specialists.js`); ověřit, které z nich čtou soubory a které importují
   kód. Tohle určuje, co vlastně „registrační hranice" dnes je.
3. **Prototyp A — strict injection.** Nejmenší tvar, ve kterém balíček
   `ToolAdapter` nedostane importem, ale z runtime kontextu při registraci.
   Zjistit: kolik call sites se mění, jestli přežije `validateManifest()` beze
   změny, a co to udělá s testy `specialists/**`.
4. **Prototyp B — veřejné verzované extension SDK.** Nejmenší tvar, ve kterém
   existuje samostatný importovatelný balíček (např. `@intentsmith/specialist-sdk`)
   re-exportující `ToolAdapter` a typy z bodu 2. Zjistit: kde SDK fyzicky žije,
   jak se verzuje, a co obnáší pro `package-installer.js` a marketplace instalaci.
5. **Změřit obě varianty stejným metrem:** počet dotčených souborů, počet
   dotčených call sites, co se stane s JSDoc referencemi, dopad na marketplace
   instalaci třetí strany, a cena při přidání dalšího symbolu do hranice.
6. **Připravit specialista E2E scénář** — jednu větu chování podle `CONTRACT.md §4`
   plus přesný příkaz, kterým se spustí. Nespouštět jako důkaz varianty;
   slouží jako regresní síť pro budoucí `WP-M3-BOUNDARY`.

## 4. Prototypy vznikají mimo strom

Prototyp je kód a `src/**` má v tuto chvíli jiného vlastníka. Proto:

- prototypy se staví ve scratch adresáři **mimo worktree**;
- do reportu jde jejich **výsledný tvar jako fenced diff** plus změřená čísla;
- do `src/**`, `specialists/**`, `tests/**` ani `package.json` se v této sondě
  nezapisuje nic.

Tím zůstává sonda skutečně read-only vůči produktu a zároveň splní požadavek
`§14` na „nejmenší prototyp obou variant".

## 5. Výstup

Jediný soubor: **`docs/review/2026-08-07-L0-8-BOUNDARY.md`**

Povinné sekce:

1. **Import graph** — tabulka hran `specialists/** → src/**` a `src/** → specialists/**`,
   každá s `file:line`, symbolem a rozlišením runtime / typ-only.
2. **Prototyp A** — diff, dotčené soubory, dotčené call sites, otevřené otázky.
3. **Prototyp B** — totéž + kde SDK žije a jak se verzuje.
4. **Srovnávací tabulka** — obě varianty stejnými metrikami.
5. **E2E scénář** — věta chování + přesný příkaz, stav `NAPSÁNO` (ne důkaz).
6. **Co sonda nerozhodla** — explicitně, aby se report nečetl jako disposition.

## 6. Hranice

- žádný zápis mimo `docs/review/2026-08-07-L0-8-BOUNDARY.md`;
- žádná změna `ROADMAP.md`, `SYSTEM-MAP.md` ani `CONTRACT.md` — L0-8 zůstává
  otevřený, dokud operátor nerozhodne;
- report není evidence ve smyslu `docs/review/README.md`; je to vstup rozhodnutí.

## 7. Stop condition

Zastavit a eskalovat, pokud:

- se ukáže **další vykonávaný** import ze `specialists/**` do `src/**`, který
  mění rozsah z „jedna hrana" na migraci;
- `ToolAdapter` tranzitivně vytáhne do hranice stav nebo DB přístup — pak už to
  není SDK otázka, ale otázka runtime kontraktu a patří do `WP-M3-BOUNDARY`;
- kterákoli varianta vyžaduje změnu `validateManifest()` nebo manifest schématu —
  to je veřejný connector a podle `CONTRACT.md §7` potřebuje souhlas.

## 8. Ověření, že sonda doběhla pravdivě

```bash
grep -rn "\.\./\.\./src/" specialists/          # musí sedět s tabulkou v §1 reportu
grep -c "^| " docs/review/2026-08-07-L0-8-BOUNDARY.md
```

Report musí obsahovat obě sekce prototypů s neprázdným diffem. Prototyp popsaný
slovy bez diffu požadavek `§14` nesplňuje.
