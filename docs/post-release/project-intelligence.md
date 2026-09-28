# Kontrakt: porozumění celému rozsáhlému projektu

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11.
Navazuje na přijatý ProjectContext v1, M4 a existující
[symbol-index WP](../wp/WP-M2-CODE-PROJECT-BOUND-SYMBOL-INDEX-V1.md).
Neobnovuje globální legacy singleton ani druhou autoritu pro projektové cesty.

## Uživatelský výsledek

Systém odpoví „jak aplikace funguje“, „kde se rozhoduje o oprávnění“,
„co změna rozbije“ a „které testy ji kryjí“ napříč balíčky, UI, serverem,
daty, konfigurací a dokumentací. Každý zásadní závěr má cestu, span a revizi;
statický fakt, pozorovaná runtime vazba a modelová hypotéza se rozlišují.
„Celý projekt“ znamená inventarizovaný rozsah a měřené pokrytí vztahů,
nikoli odeslání všech souborů do jednoho modelového kontextu nebo vševědoucnost.

## Architektura za stávající projektovou hranicí

1. Úplný manifest způsobilých souborů včetně dirty/untracked změn; explicitní
   důvody vyloučení (binary, policy, velikost, jazyk, chyba). Každý soubor je
   zařazen nebo vykázán jako mezera, nikdy tiše vynechán.
2. Jazykové symboly a reference přes parser/language server, importy/exporty,
   call/type vazby; konektory pro routes, schema/migrations, config a testy.
   LSP poskytuje např. definice a reference, sám negarantuje úplný běhový graf.
   [Primární specifikace](https://microsoft.github.io/language-server-protocol/).
3. Verzovaný graf modulů, symbolů, datových a efektových hranic. Dynamic import,
   reflection, DI a externí služby vytvářejí explicitní nejistotu; důkaz lze
   doplnit řízeným runtime trace bez samovolného spuštění repozitářového kódu.
4. Hybridní retrieval: přesné symboly + lexikální index + volitelná lokální
   embeddings + traversal grafu, reranking a kontrola zdrojů. Shrnutí modulů
   je odvozené z konkrétních revizí a invaliduje se spolu se závislostmi.
5. Dotazovací plán rozloží otázku na ověřitelné poddotazy, omezeně doplní
   důkazy a vydá syntézu s coverage reportem. Nedostatek kontextu vrací
   PARTIAL/UNKNOWN a konkrétní chybějící oblast.

Navržené typy `ProjectIndexManifest@1`, `ProjectGraphSnapshot@1`,
`ProjectUnderstandingResult@1`. Vše má úplný key projectId/canonicalRoot/
workspaceRevision/policy/algorithm/model digest. Publikace atomická;
cancel/stale/error nezveřejní poloviční index. Warm/cold/eviction mají
stejný sémantický výsledek. Nové typy doplňují interní providery;
změna veřejného ProjectContext potřebuje vlastní verzované review.
Vlastněné oblasti budoucího WP: `src/code-intel/**`, provider adapter,
omezený consumer, interní contracts a test fixtures.

## Rozsáhlost a akceptace

Navržené kapacitní fixture: 1k, 10k a 50k textových souborů, monorepo,
více jazyků a skutečný IntentSmith. Před implementací změřit a zmrazit cold
index time, warm query p95, incremental update, RAM/disk a modelový rozpočet.
Výkonnost se vykazuje odděleně od kvality; překročení má pravdivý terminál.

Zmražený oracle musí mít definice/reference, mezibalíčkové call paths,
autorizaci až k efektu, UI→API→DB, změnový dopad a výběr regresních testů.
Hodnotit retrieval recall, přesnost citací, úplnost dopadu, nepravdivé závěry
a správné UNKNOWN. Kritické bezpečnostní/efektové hrany nesmějí být přehlédnuté
v přijatém fixture oracle. Úlohy vzniknou před tuningem; samotná podobnost
odpovědi s modelovým shrnutím není oracle.

Negativní demonstrace: stejné symboly v A/B, souběžné revize, rename/delete,
částečný parser, záměrně zavádějící komentář, stale shrnutí, symlink, secret,
vyčerpaný rozpočet a cancel během indexace. Žádný přenos mezi projekty,
neautorizovaný proces/síť ani tichý globální fallback. Porovnat s dnešním
lexikálním baseline na skutečné produkční cestě, doložit zlepšení a nezávislé
review. Symbol lookup samotný není přijetí celého tohoto kontraktu.
