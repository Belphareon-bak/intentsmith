# WP — funkční SQLite aplikace vytvořená modelem CODE

**Stav:** `IMPLEMENTED / CPU_ACCEPTANCE_PASS / REVIEW_PENDING / LIVE_NOT_RUN`.
**Autorita:** výslovný požadavek operátora dokončit a skutečně otestovat různé
generované projekty; `PRODUCT.md` §2 závazek 7 a §3 práce nad projektem;
`CONTRACT.md` §4, §6 a §10. Výchozí ověřený publikovaný zdroj je
`3971d28a2ccce1368fd4cb2a4bcbf093c19106de` na samostatné větvi
`work/project-sqlite-functional-20261001`. Dva přijaté fyzické průchody
Ledgeru a TaskFlow měří malé paměťové aplikace, nikoli SQLite data.

## Uživatelský výsledek a pravdivá hranice

CODE vytvoří přesně sedm malých modulů katalogu knih v novém izolovaném Git
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
`node:child_process` a `node:vm` pro frozen test, zkontroluje hash a provede Git commit
politiky a testu **před prvním modelem**. Po schválení běží stejné frozen
orákulum na nové privátní DB a znovu po backend restartu. Každé spuštění
nezávisle zkontroluje vnitřní restart aplikace; M2 authority DB má samostatnou
durable kontrolu. `run-project-app-journey` má uzavřenou volbu scénářů, ne
libovolný vstup pro cesty/commandy/testy.

## Pozitivní, negativní a stop podmínky

1. Před implementací zmrazit veřejný kontrakt `run(dbPath, commands)`, názvy
   exportů, pevný graf importů a sedm instrukcí do 512 B každá. Ceny jsou
   celé haléře, množství nezáporné celé číslo, SKU/název řetězce bez převodu.
   `add/get/list/search/update/delete` vrací přesné JSON výsledky. Celé
   `run(commands)` je atomické: neplatný příkaz v libovolném místě dávky
   končí nenulově a DB zůstane ve stavu před dávkou.
2. Důvěryhodný oracle sám používá `node:sqlite` ke kontrole DB. Generované
   moduly `schema/store/service/cli/app` nikdy nenačte do svého procesu ani
   VM; běží v oddělených dětských procesech. Čisté listové moduly `query` a
   `validate` bez importů zkontroluje odděleně v restriktivním VM kontextu s
   objekty vytvořenými v tomtéž realm, bez host objektů či funkcí. Po každém
   spuštěném dítěti nezávisle znovu otevře SQLite, ověří skutečné schéma,
   constrainty a řádky z náhodné výzvy, včetně persistence přes nové dítě.
   Zkontroluje úplný JSON a status, takže falešný výstup či předčasný `exit 0`
   nestačí.
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

## Implementační důkazy a stav převzetí

Kanonický compiler vytvořil přesné pořadí `query → schema → store → validate →
service → cli → app`; veřejný celkový pokyn má 430 B a nejdelší pokyn k
souboru 507 B. Zamrzlé testovací bajty a `src/index.mjs` jsou vytvořeny
operátorem před modelem. Projektová politika přidává jen `node:sqlite`,
`node:child_process` a `node:vm`; původní dva projekty a jejich frozen bajty
se nemění.

Na Node `v24.21.0` prošla reference v reálném `linux-bwrap-ro-v2`. Důvěryhodný
rodič otevřel SQLite přímo po ukončení jednotlivých aplikací, kontroloval
skutečné řádky, schéma, `UNIQUE`, všechny čtyři `NOT NULL`, obě `CHECK`,
neopakování ID po smazání, doslovné SQL metaznaky, Unicode, změny i odmítnutí
neplatných hodnot bez další změny řádků. Stejně kontroluje rollback celé dávky
po předchozím platném `add`, následovaném neznámým příkazem, duplicitním SKU,
chybnou aritou nebo příkazem jiného typu než tuple. Constraint probe používá
pro každý sloupec nejdříve platný INSERT se stejným kladným ID, SKU a ostatními
hodnotami, rollback savepointu, a pak mění pouze testovaný sloupec. Vyžaduje
odpovídající typ chyby SQLite (`UNIQUE`, `CHECK`, konkrétní `NOT NULL` sloupec)
bez závislosti na zápisu výrazu `CHECK`. Závěrečný text z dítěte není oracle.

Pouze `query.js` a `validate.js` se načítají přes `vm.SourceTextModule`: importy
a dynamické importy se odmítají, `strings/wasm` codegen je vypnutý, nedostanou
žádné host objekty ani funkce. Oracle přímo sleduje nové plain records,
nezměněný vstup, nezávislé výsledky po mutaci prvního, odmítnutí řetězcového,
nebezpečně velkého a nekladného ID i ne-plain patchů. VM není novou OS
bezpečnostní atestací; tou zůstává kanonický `linux-bwrap-ro-v2`.

Skutečné M2 `draft → preview → přesné schválení → focusedTest → effect → Git`
commitlo referenci a v dvanácti vadných variantách odmítlo commit, vrátilo
`PROJECT_CHANGE_TEST_FAILED`, dokončilo rollback a odstranilo všech sedm
cílů. V každém případě nový proces otevřel authority SQLite **read-only** a
ověřil přesný trvalý terminál i existenci/bajty souborů. Vadné varianty:
schéma, maskovaný chybějící `CHECK(quantity)`, chybějící tabulka, falešný
stdout, předčasný exit, update, delete, search, aliasované query výsledky,
chybný commit při neplatné dávce, koerce ID a nepersistující `:memory:` DB.
Jednotlivé chyby se ověřují na jejich specifickém stderr, nikoli pouze na
obecném nenulovém exitu.

První úzký M2 běh měl `9/10 PASS`: testovací fixture chybně aplikovala starou
ledger mutaci `early-exit` i na SQLite scénář a spadla před draftem. Oprava
oddělila větve fixture; následující úzký M2 běh `10/10 PASS`. Mezikrok
společných sad měl `48/48 PASS`, pozdější mezikrok `49/49 PASS` před
nezávislými adversarial nálezy. Konečný společný Node `v24.21.0` běh po
atomické dávce, čistém VM a constraint opravě má `52/52 PASS`, `0 FAIL`,
exit `0`; soukromý ignorovaný log
`.intentsmith-artifacts/sqlite-catalog-final-cpu-20261001-v2/two-app-suites.log`
má SHA-256 `38d167348062349fefaadb8a6177d1b268b1afbbc0b46737b16b29017673452c`.
Tyto CPU výsledky nejsou nezávislým review ani fyzickou generací modelem.

První soukromý design snapshot
`.intentsmith-artifacts/sqlite-catalog-design-20261001-v1/` má historické
`CHANGES_REQUIRED`: veřejný pokyn sliboval atomickou dávku, zatímco reference
prováděla `commands.map` bez transakce a oracle zkoušel jen samostatné neplatné
příkazy. Reviewer dále prokázal, že oracle přijal koerci řetězcového ID,
aliasované query objekty a schéma s maskujícím `CHECK(id>0)` bez požadovaného
`CHECK(quantity>=0)`. Následná verze výslovně vyžaduje `BEGIN/COMMIT/ROLLBACK`
přes `store → service → cli`, na skutečné SQLite ověřuje čtyři vadné dávky,
měří čisté leaf API v uzavřeném VM a změnila mutant `invalid-mutation` tak,
aby skutečně porušoval pozorovaný výsledek (chybný commit při výjimce).
Constraint challenge nyní mění vždy právě jeden sloupec po platné kontrole.
Historický snapshot není přijatým oraclem; finální kontrola patří přesnému
implementačnímu commitu a jeho nezávislému review.

## Fyzický start SQLite: závada hranice JSON — 1. 10. 2026

První explicitní živý pokus na čistém integračním zdroji `3863549f` skončil
**FAIL před jakoukoli inferencí**: zaznamenal `0/7` generací a nedošel ani k
vytvoření projektového runtime. Přesný soukromý záznam root je
`.intentsmith-artifacts/sqlite-catalog-physical-3863549f-20261001-1400/result.json`.
Rodič předal konfiguraci přes `JSON.stringify`, který odstranil dvě
nepřítomné volitelné hodnoty `probeSha256` a `validatorProbeSha256`.
`sourceObservation(sqlite-catalog)` je ale vytvořila s hodnotou `undefined`,
takže první `assert.deepEqual` v `runInside` skončil chybou. Ledger a TaskFlow
mají oba hashe přítomné a jejich přesné hodnoty se nesmí změnit.

Následná úzká oprava má vytvořit JSON stabilní pozorování zdroje: volitelný
hash v objektu existuje jen tehdy, když má definovanou hodnotu. Stejný
produkční `runInside` počáteční guard ověří child proces s konfigurací
procházející skutečným JSON souborem; CPU test před síťovým namespace a před
alokací runtime ověří kladné všechny tři scénáře a odmítnutí pozměněného
hashu. Zmrazené orákulum, sedm veřejných instrukcí, projektová politika,
produktové moduly a GPU/provider kód zůstávají byte-identické. Tento pokus
zůstává historickým **FAIL**; oprava sama není náhradou nového živého běhu.

Red-first CPU test volal stejný počáteční guard `runInside` ve skutečném
samostatném procesu s konfigurací z JSON souboru a zastavil se před `ip`, DB
i modelem. Ledger/TaskFlow prošly; SQLite selhal přesně na dvou `undefined`
polích. Po opravě má cílený test `1/1 PASS` pro tři scénáře a pro každý odmítá
podvržený `probeSha256` i `validatorProbeSha256`. Společné dvě aplikační sady
na zmrazeném Node `v24.21.0` mají `53/53 PASS`, exit `0`; ignorovaný log
`.intentsmith-artifacts/sqlite-source-boundary-fix-20261001/two-app-suites-node24-final.log`
má SHA-256 `0bf71b5014e8449389ab5ceb8eee16aaba8fcd011132ef23facdef202ae549fe`.
Předchozí první pokus o společné sady spustil systémový Node `v22.21.1`
(ABI 127) proti `better-sqlite3` pro ABI 137 a skončil `20 PASS / 33 FAIL` s
`ERR_DLOPEN_FAILED`; raw log SHA-256
`84a76e0cf08970521add904dab621c64d2d98114b4e4544bad467ec401c0e393`
je zachován ve stejném soukromém adresáři. Nešlo o selhání aplikace, ale
platné společné CPU přijetí dokládá teprve explicitní Node 24 běh.
