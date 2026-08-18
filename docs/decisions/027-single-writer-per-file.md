# 027 — Dva agenti nesmějí zapisovat do stejného souboru ve stejné větvi

- **typ:** požadavek na jádro; **není mobilní**
- **stav rozhodnutí:** NÁVRH — čeká na operátora
- **vyvolal:** operátor 2026-08-18: *„chtěl bych pravidlo, které zamezuje dvěma
  agentům zapisovat do stejného souboru ve stejné branchi, kdyby to nebylo, tak
  by to byla neskutečná divočina"*
- **souvisí:** [025](025-approval-window-and-push.md) osa 2 (svět pod návrhem)

## Proč to není totéž co osa 2 v 025

Vypadá to podobně, ale je to opačný konec téhož problému:

| | Co dělá | Kdy zabírá |
|---|---|---|
| **Zámek na soubor** (tohle rozhodnutí) | **zabrání** tomu, aby druhý agent do souboru vůbec sáhl | dřív, než vznikne konflikt |
| **Předpoklad v approvalu** (025, osa 2) | **pozná**, že se cíl mezitím změnil, a schválení propadne | až když se konfliktu zabránit nepodařilo |

Potřebujeme obojí. Zámek řeší běžný případ (dva agenti, jeden repozitář) a
předpoklad je poslední pojistka pro všechno ostatní: uživatel, který soubor
upravil v editoru, `git checkout`, jiný nástroj, restart jádra. Kdyby existoval
jen zámek, stačilo by jedno místo mimo něj a tichý přepis je zpátky.

## Co pravidlo musí říct

1. **Jednotka zámku je (větev, cesta).** Ne repozitář — to by serializovalo
   práci zbytečně. Ne řádek — na to nemáme sémantiku.
2. **Zámek drží běh, ne agent.** Agent může mít víc běhů; zdrojem konfliktu je
   běh, který se chystá zapsat.
3. **Zámek má vlastníka a expiraci.** Spadlý běh nesmí zamknout soubor navždy;
   po expiraci musí být uvolnění pozorovatelné, ne tiché.
4. **Odmítnutí je hlasité.** Druhý běh dostane „soubor drží běh X", ne timeout
   a ne tichý zápis do fronty. Uživatel se to musí dozvědět.
5. **Approval si drží zámek.** Když běh čeká na schválení, soubor zůstává
   zamčený — jinak by mezi schválením a zápisem stihl zasáhnout někdo jiný a
   předpoklad z 025 by propadl u každého druhého approvalu.

## Otevřené otázky pro operátora

- **Fronta, nebo odmítnutí?** Má druhý běh počkat, až se soubor uvolní, nebo
  rovnou skončit s vysvětlením? (Doporučuji odmítnutí: čekání ve frontě je
  místo, kde vznikají zaseknuté běhy.)
- **Co s větví jako identitou.** Když agent pracuje v git worktree nebo
  odděleném klonu, je to jiná větev, nebo tatáž? (Doporučuji: klíč je
  `repozitář + větev + cesta`, protože worktree stejné větve sdílí soubory.)
- **Kde zámek žije.** Tabulka v SQLite jako u approvalů je konzistentní se
  zbytkem a přežije restart; souborový zámek na disku ne.

## Co to znamená pro mobil

Nic přímo. Nepřímo dvě věci: approval, který drží zámek, má **důvod** čekat
libovolně dlouho (nikdo jiný mezitím soubor nezmění), a hlášení „soubor drží
jiný běh" je stav, který se dřív nebo později objeví i na telefonu — a musí mít
`S1` podobu, tedy „běh čeká na jiný běh", ne cesta k souboru.
