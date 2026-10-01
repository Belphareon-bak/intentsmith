# WP — funkční SQLite aplikace vytvořená modelem CODE

**Stav:** `WP_ONLY / IMPLEMENTATION_NOT_RUN / REVIEW_PENDING / LIVE_NOT_RUN`.
**Autorita:** výslovný požadavek operátora dokončit a skutečně otestovat různé
generované projekty; `PRODUCT.md` §2 závazek 7 a §3 práce nad projektem;
`CONTRACT.md` §4, §6 a §10. Výchozí ověřený publikovaný zdroj je
`3971d28a2ccce1368fd4cb2a4bcbf093c19106de` na samostatné větvi
`work/project-sqlite-functional-20261001`. Dva přijaté fyzické průchody
Ledgeru a TaskFlow měří malé paměťové aplikace, nikoli SQLite data.

## Uživatelský výsledek a pravdivá hranice

CODE vytvoří sedm či osm malých modulů katalogu knih v novém izolovaném Git
projektu. Operátorem předem zmrazený test musí před M2 commitem ověřit skutečný
obsah SQLite souboru, správné čtení po ukončení a novém spuštění aplikačního
procesu, CRUD, přesné řazení, vyhledávání, validaci a nezměněnou DB po chybě.
Test nesmí přijmout modelový vlastní test, tvrzení dítěte, marker ani samotný
Git commit. Model smí dodat pouze bajty vyjmenovaných `src/*.js`; cesta,
instrukce, test, úzká projektová politika a schválení patří operátorovi.

Kanonický `linux-bwrap-ro-v2` zpřístupňuje projekt read-only a každý samostatný
focused test dostane novou privátní `/tmp` tmpfs. Důvěryhodný test proto drží
jednu instanci sandboxu, spouští generovanou CLI aplikaci v jednotlivých
dětských procesech a sám otevírá DB mezi nimi. To prokazuje persistenci mezi
procesy **v tomtéž sandboxu**. Netvrdí zachování stejného aplikačního DB
souboru přes další M2 test či restart backendu. Živý HTTP server vyžaduje
jinou revidovanou izolaci: tento sandbox zakazuje socket/connect.

Soukromá no-model CPU sonda na přesném Node `24.21.0` a produkčním
`processSandboxProvider` má `PASS` ve dvou sandbox invocations. První ověřila
`node:sqlite`, schéma/unikátní index/řádky/quick_check, znovuotevření z dítěte
a odmítnutou duplicitu bez změny řádků; druhá potvrdila, že původní `/tmp`
DB už není vidět. Jde pouze o proveditelnost, ne o test modelové aplikace.
Soukromý ignorovaný důkaz v autorském checkoutu:
`.intentsmith-artifacts/sqlite-sandbox-feasibility-20261001/`,
`result.json` SHA-256 `57e14ee6a776b4ddd7d64ef47f6d6a318a32b44892457527fa3013da9998aaae`.

## Vlastnictví a závislosti

Vlastním pouze nový `scripts/project-sqlite-catalog-acceptance.js`, zmrazený
`scripts/project-sqlite-catalog-oracle.mjs`, nový referenční helper v
`tests/helpers/`, jediný aditivní pevný scénář a jeho adaptér v existujícím
`scripts/run-project-app-journey.js`, rozšíření existujících dvou programů
`tests/project-app-acceptance.test.js` a
`tests/project-app-m2-functional.test.js`, a tento WP. Nezasahuji do
`src/**`, `contracts/**`, CHAT, mobilu, global governance, registry ani
generované projekce. Root vlastní registraci pomocného souboru, integraci,
publikaci a případný živý serialized GPU slot. Staré frozen bajty, default
ledger CLI, TaskFlow, M2 runtime a provider relay jsou invarianty.

`newProjectPolicy('general')` výchozí `node:sqlite` nepovoluje. Nový scénář
přidá přesný import do **své** lokální seřazené `externalImports`, spolu s
`node:child_process` pro frozen test, zkontroluje hash a provede Git commit
politiky a testu **před prvním modelem**. Po schválení běží stejné frozen
orákulum na nové privátní DB a znovu po backend restartu. Každé spuštění
nezávisle zkontroluje vnitřní restart aplikace; M2 authority DB má samostatnou
durable kontrolu. `run-project-app-journey` má uzavřenou volbu scénářů, ne
libovolný vstup pro cesty/commandy/testy.

## Pozitivní, negativní a stop podmínky

1. Před implementací zmrazit veřejný kontrakt `run(dbPath, commands)`, názvy
   exportů, pevný graf importů a sedm/osm instrukcí do 512 B každá. Ceny jsou
   celé haléře, množství nezáporné celé číslo, SKU/název řetězce bez převodu.
   `add/get/list/search/update/delete` vrací přesné JSON výsledky. Neplatný
   příkaz či argument končí nenulově a nemění vlastní DB stav.
2. Důvěryhodný oracle generované moduly nikdy nenačte do svého procesu ani
   VM. Po každém spuštěném dítěti nezávisle znovu otevře SQLite, ověří
   skutečné schéma, constrainty a řádky z náhodné výzvy, včetně persistence
   přes nové dítě. Zkontroluje úplný JSON a status, takže falešný výstup či
   předčasný `exit 0` nestačí.
3. Referenční implementace projde skutečný M2 draft→preview→approval→
   focusedTest→Git→restart. Vadné schéma, chybějící DB, falešný stdout,
   předčasný exit, chybné update/delete/search, mutace při invalidním vstupu
   a ztracená persistence každý končí `PROJECT_CHANGE_TEST_FAILED`, kompletním
   rollbackem všech cílů, bez Git commitu a stejným failed terminálem po
   samostatném novém read-only procesu nad authority SQLite.
4. Původní dvě app sady a jejich frozen hashe, nová sada, přesný Node 24
   no-inference preflight tří scénářů, syntaxe, čistý Git a `git diff --check`
   musí projít. Implementační zelená je `REVIEW_PENDING / LIVE_NOT_RUN`.
   Nezávislé review předchází root integraci a pozdějšímu fyzickému modelu.

**Stop:** nelze-li splnit skutečné DB assertions v kanonickém sandboxu bez
rozšíření produktové pravomoci, nevydávat SQLite PASS; zachovat chybu a
navrhnout samostatný izolovaný runtime WP.
