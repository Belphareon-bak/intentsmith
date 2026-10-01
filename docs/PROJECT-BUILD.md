# Práce s novým a existujícím projektem ve Studiu

Rozsah produktu určuje PRODUCT.md. Tento návod popisuje dostupný ohraničený
builder. Dvousouborový fyzický průchod ze skutečně nainstalovaného Studia byl
ověřen na `dc81a0f0`, včetně schválení, funkčního testu, restartů a obnovy DB.
[Rozsah a důkazy](review/2026-09-12-PRODUCTION-JOURNEY-REVIEW-PACKET.md).
Úplný autonomní builder tím prokázaný není. Následující postup zahrnuje opravu
projektového flow z 18.–19. září 2026; důkazy staršího průchodu neověřují tuto změnu.
[Aktuální skutečný pokus SystemSmith_1 a jeho omezení](review/2026-09-19-SYSTEMSMITH-PROJECT-FLOW.md).

## Nový projekt

**Projekty → Nový** vytvoří nový adresář, minimální projekt pro Node.js 22,
adresáře `src`, `public`, `test`, `scripts`, pravidla M2 a výchozí Git commit.
Existující adresář se nepřepisuje. Projekt zatím nemá implementaci; první
`npm test` záměrně selže, dokud nevznikne skutečný funkční test.

Pro aplikaci s vlastním oknem zvolte typ **Desktop**. Připraví deklaraci
Electronu, startovací příkaz a pravidla pro `electron` a `node:child_process`.
Závislosti se tím nestahují ani neinstalují; GUI, preload, sběrače a testy
teprve vzniknou v řízených krocích. Obecný typ externí Electron nepovoluje.
Nové základy dovolují upravovat také `package.json`, `README.md` a `ROADMAP.md`;
pravidla dříve založených nebo importovaných projektů se zpětně nemění.

V projektovém chatu popište požadovaný výsledek. IntentSmith naváže na cíl
a předchozí zprávy, načte omezený kontext souborů, navrhne priority a podle
potřeby se doptá. Krátké „a jak?“ patří ke stejnému projektu. Pro podporovaný
malý JavaScript krok může nabídnout **Připravit navržený krok**. Tlačítko otevře
editovatelný seznam souborů a test; generování a schválení jsou další dva kroky.
Původní cíl z popisu projektu zůstává v modelovém vstupu celý i po dlouhé
konverzaci. Pokud se cíl a aktuální požadavek nevejdou do schváleného okna,
plánování skončí vysvětlením místo tichého odříznutí konce cíle.
Plánovač zná OS, architekturu a povolené importy. Tím není prokázaná
dostupnost hardwarových senzorů ani instalace deklarovaných závislostí.
Model dostává také seznam skutečných adresářů. U vyjmenovaných strukturálních
chyb návrhu (například neexistující adresář nebo cyklus závislostí) zkusí jednou
plán opravit podle konkrétní chyby. Nevytváří tím adresáře ani neschvaluje
změny. Chyby provideru, přerušený výstup a změna revize se automaticky neopakují.

Test v takovém návrhu je `node --disable-wasm-trap-handler --test`: Node vyhledá testy projektu, takže nová sada nezůstane mimo ověření a původní regrese se kontrolují dál. Nový modul může mít vlastní `test/*.test.mjs`; není nutné přepisovat nesouvisející `acceptance.test.mjs`. Přepínač zachovává funkčnost Node.js pod limitem virtuální paměti sandboxu. Model může
navrhnout jeho assertions, takže úspěch testu sám nedokazuje splnění celého cíle.
Prohlédněte změny a ověřte i skutečný výsledek. Součástí návrhu je lokální Git
commit po úspěšném provedení, aby další krok mohl vycházet z čistého stavu.
Commit se nikam nepublikuje.

Při chybě testu se změny vrátí a Studio ukáže omezený výstup testu. V další
zprávě lze požádat o opravu. Se zapnutým ukládáním kontextu může plánovač použít
uložený výsledek a vadný návrh ze stejného projektu, konverzace a uživatele;
odlišuje vrácený návrh od aktuálních souborů. Jde o návaznost práce, nikoli
přetrénování modelu nebo sdílení poznatků mezi projekty. Při `saveContext=false`
se tento audit do modelového kontextu nečte. Schvalovací a prováděcí audit
zůstává provozním záznamem M2; přepínač jej nemaže.

## Existující projekt vytvořený mimo IntentSmith

Použijte **Projekty → Nový → Otevřít existující**, nebo do stejného průvodce vložte úplnou cestu a zvolte **Načíst existující projekt**. Import registruje adresář a provede omezenou
statickou analýzu: inventář povolených textových souborů, vybrané ukázky,
přítomnost dokumentace, manifestu a testů. Nezapisuje do repozitáře, nezakládá
Git ani pravidla M2, neinstaluje závislosti a nespouští cizí kód. Funguje i pro
adresář pouze ke čtení. Opětovné otevření aktualizuje přehled téhož projektu.

Úvod uvede známá fakta a omezení a zeptá se na cíl a zamýšlené pokračování.
V chatu lze požádat o silné/slabé stránky a priority dokončení či optimalizace.
Model vidí vybrané ukázky podle svého schváleného kontextového okna, nikoli
automaticky všechny soubory rozsáhlého repozitáře. Neověřené závěry musí
označit; testy nejsou provedené pouhým nalezením testovacích souborů.

U Node projektu dostane plánovač také kompaktní deklarace z `package.json`:
modulový typ (nebo výslovně neurčený), vstupní soubor a příkazy start/test/build.
Nejsou důkazem existence vstupu ani úspěšného spuštění. Zachovává se konvence
převzatého projektu; výchozí ESM a `src/index.mjs` patří pouze novému základu.
Testovací krok může použít `.test.js`, `.test.mjs` i `.test.cjs` v `test/` nebo
`tests/`; běží stále pevný Node test profil. Po zmenšení rezervy odpovědi a
starších zpráv výběr znovu doplní pozorované ukázky do volného místa. Celý
aktuální požadavek, cíl a pravidla mají přednost; okno modelu se nezvyšuje.

Před první řízenou změnou cizího projektu je nutný čistý Git stav a pravidla
odpovídající jeho skutečné struktuře, viz příprava níže. Automatický návrh
spustitelného kroku je nyní omezený na malé projekty Node.js; jiné jazyky lze
analyzovat a plánovat, nikoli tímto formulářem obecně sestavit. Další nový
widget je samostatný nový projekt, nikoli zkouška importu existujícího projektu.

## Generování a schválení kroku

V chatu připojeného projektu klikněte na **Připravit změnu**. Stejný formulář
otevře `/m2-build` bez argumentu. Rozpracovaný text chatu se do cíle zkopíruje
a v chatu zůstane. JSON není nutné psát.

1. Napište celkový cíl a pro každý soubor cestu v projektu a jeho zadání.
   Přidejte další soubory podle potřeby. Přímé závislosti uveďte po jedné cestě
   na řádek; musí to být jiné soubory téhož plánu bez cyklů.
   Hotové moduly z předchozích kroků zadejte do **Existující kontext jen ke
   čtení**. Jejich úplný obsah dostane model pro daný soubor, samy se nepřepisují.
2. Zadejte úplnou cestu programu pro funkční test a jeho jednotlivé argumenty.
   Například program `/usr/bin/node` s argumenty `--test` a
   `tests/app.test.js`. Testovací soubor musí být připravený v projektu.
   Celý inline program patří do jediného argumentu za `-e`; formulář zachovává
   mezery, uvozovky a prázdné argumenty a neprovádí shellové rozdělování.
3. Klikněte **Vygenerovat návrh**. Model navrhne úplný obsah každého souboru
   s kontextem jeho přímých závislostí. Při chybě zůstává zadání ve formuláři;
   opravte příčinu uvedenou ve zprávě a odešlete jej znovu. Skrýt zachová zadání,
   Zahodit zadání jej odstraní. Rozepsaný formulář nepřežívá restart Studia;
   návrh z chatu a identita připraveného plánu se obnovují s relací.
4. Prohlédněte všechny původní a navržené obsahy a přesný test. Až tlačítko
   **Schválit zobrazené změny** nebo `/m2-approve` spustí uložený plán. Při
   neúspěšném testu M2 vrací všechny změny. Obecné „ano“ nic neschválí.
5. Tlačítkem **Zrušit** nebo `/m2-cancel` zastavíte generování nebo požádáte
   o zrušení prováděné operace. **Načíst stav a plán** či `/m2-status` obnoví
   uložený stav. Po restartu Studia musí tlačítko schválení nejprve načíst
  a zobrazit obnovený plán. Přepnutí projektu/konverzace staré zadání nepřeváže.

Po zrušení nebo neúspěchu je dostupné **Opravit předchozí návrh**. Model dostane
úplný předchozí návrh daného souboru jako jedinou upravovanou verzi.
Vrací přesné náhrady úseků: každý původní úsek musí existovat právě jednou,
úseky se nesmějí překrývat a všechny se ověřují proti stejnému návrhu.
Nejednoznačná oprava odmítne celou dávku před vznikem plánu. Obsah mimo
náhrady zůstává bajtově zachovaný; úplný výsledný soubor je vidět v novém
plánu. Skutečný obsah na disku planner nadále ověřuje, ale model jej podruhé
nedostává. Tím se šetří kontext a omezuje nechtěné vracení staršího kódu.
U jednotlivých souborů lze zvolit **Zachovat přesný obsah**: jejich ověřené
bajty se převezmou bez dalšího generování. Oprava vytvoří nový plán s novým
schválením; starý plán ani jeho verdikt se nepřepisují. Odkaz je vázaný na
přesný digest, vlastníka, projekt, konverzaci a nezměněnou revizi pracovního
stromu. Při změně souborů nebo po úspěšném provedení je třeba nový běžný krok.
Zachování souboru znamená zachování obsahu, nikoli potvrzení jeho správnosti;
funkční test a kontrola celého výsledku zůstávají nutné.
Vrátí-li model při opravě přesně původní návrh souboru, builder jej odmítne
chybou `M2_CODE_DRAFT_REVISION_UNCHANGED`; nový plán nevznikne. Vědomé zachování
souboru se zadává volbou **Zachovat přesný obsah**, nikoli opakovaným generováním.

Před nabídkou plánu builder parsuje generované `.js/.mjs/.cjs/.jsx` soubory,
včetně opravených a výslovně zachovaných návrhů. Vadná syntaxe odmítne celou
dávku bez zápisu. Jde o gramatickou kontrolu bez spuštění či linkování kódu;
nenahrazuje funkční test, kontrolu runtime API ani ověření celé aplikace.
TypeScript, HTML a CSS tato kontrola nepokrývá. Přímé operátorské `/m2-plan`
se tím nemění.

Pokročilý builder přijímá `revisionOf: { lifecycleId, planDigest }` a
`reusePrevious: true` u explicitně uvedených souborů. Kontext se čte jen na
tento výslovný požadavek, ne jako automatická paměť mezi projekty.

Pokročilý vstup `/m2-build <JSON>` zůstává dostupný, včetně volitelného
Git commitu a vlastního prostředí testu. Formulář používá prostředí uvedené
v jeho detailu. Ruční zadání Git commit nevyžaduje; nabídka z projektového
chatu jej obsahuje. Položka souboru nyní podporuje volitelné `contextFiles`
(nejvýše osm existujících projektových cest). Zapisované cíle, schvalování,
efekty a formát přesného M2 plánu se nemění. Obsah kontextu se ověřuje proti
manifestu; změna projektu během generování zneplatní návrh. Cesty mimo projekt,
skryté chráněné soubory, odkazy, příliš velký obsah nebo přesah kontextového
okna vedou k odmítnutí, nikoli ke zkrácení kódu nebo částečnému plánu.

## Předpoklady a meze

- Registrovaný, připojený Git projekt s platnou `.intentsmith/m2-governance-policy.json`;
  cílové adresáře již existují. Běžná registrace sama governance nezakládá.
- Aktivní lokální model pro roli CODE a stávající M2 procesový sandbox.
  Žádné automatické změny modelového bindingu ani oprávnění.
- 1–32 explicitních textových cílů; původní i generovaný soubor v projektovém
  builderu do 16 384 B. Přirozený plánovač navrhuje nejvýše šest malých souborů.
  Závislosti odkazují pouze na jiné cíle téhož plánu; bez cyklů.
- Celkové i jednotlivé zadání do 512 B. Projektový prompt má strop 32 000 B,
  dále omezený skutečným schváleným kontextem modelu CODE. Výstup používá
  nejvýše 4096 tokenů (menší okno limit snižuje). Context preflight před prvním
  modelovým voláním kontroluje všechny vstupní soubory; úplné generované peers
  mohou další prompt zvětšit, proto se limit kontroluje znovu před každým voláním.
  Generování má až 120 s na soubor, celkově nejvýše 960 s. Chyba nevytvoří dílčí
  plán. Menší model nemusí složitý krok zvládnout; rozdělte jej na menší moduly.
- `focusedTest` je povinný explicitní program/argv/environment/timeout.
  Samotná přítomnost testu nezaručuje jeho kvalitu. V návrhu z chatu vybírá
  program a argumenty backend; model smí navrhovat obsah testovacího souboru.
  U ručního zadání program nemá allowlist binárek; ohraničení zajišťuje
  schválený M2 procesový sandbox. `gitCommit` používá strict tvar jako `/m2-plan`
  (message a explicitní author/committer identity).

Pro malou změnu 1–3 JS souborů zůstává `/m2-draft src/app.js :: zadání`.
Malý draft zachovává původní limity: 1600 B vstup, 2200 B prompt, 8192 B
výstup a 1536 tokenů, 120 s. Pro ručně hotové obsahy slouží `/m2-plan <JSON změn>`.
Volný text v projektovém chatu nabízí návrh; provedení vyžaduje samostatné schválení.

## Příprava malého JavaScript projektu

Nejprve v editoru připravte adresář `src/` a funkční test, například
`tests/app.test.js`. Vlastní pravidla projektu uložte do
`.intentsmith/m2-governance-policy.json`. Pro jednu aplikační vrstvu bez externích
importů může soubor vypadat takto:

```json
{
  "policyId": "local-app",
  "layers": [{ "name": "app", "roots": ["src"] }],
  "rules": [{ "from": "app", "canImport": ["app"] }],
  "externalImports": [],
  "sourceExtensions": [".cjs", ".js", ".mjs"],
  "requiredChecks": ["imports.allowed", "inventory.complete", "layers.mapped"],
  "unmappedFilePolicy": "unavailable"
}
```

Pravidla upravte podle skutečných vrstev a dovolených importů projektu;
seznamy kořenů, přípon, názvů vrstev, pravidel a importů udržujte seřazené podle
bajtového pořadí UTF-8 bez duplicit. Kořen může být existující adresář nebo
jednotlivý existující soubor; inventura pro oba používá stejné kontroly cest,
odkazů a velikosti. Nové šablony mají toto pořadí připravené automaticky.
Prázdné `externalImports` záměrně neumožňují externí knihovny. Uložte výchozí
soubory, test a pravidla do Git commitu a začněte s čistým pracovním stromem.
Import existujícího projektu tato pravidla nevytváří. U nově založeného
projektu je základ připravený automaticky. U importu tato příprava probíhá
v editoru a Gitu pod vaší správou; formulář generování ji neprovádí.

Pokud se návrh odmítne, zkontrolujte příčinu zobrazenou ve formuláři: chybějící
policy opravte v uvedeném souboru, chybějící adresář vytvořte před generací,
příliš velký kontext rozdělte do menších změn. Při změně pracovního stromu
vytvořte nový návrh nad aktuálním stavem. Chybějící model řešte ve správě
modelů; opakování formuláře samo nepřepne binding ani neinstaluje model.

## Příklad: šest modulů evidence výdajů

Připravený projekt má adresář `src/`, který governance dovoluje. Odešlete jednu
chatovou zprávu začínající `/m2-build ` a pokračující tímto JSON; samotný
`/m2-build` otevře formulář. Jde o paměťovou aplikaci s příkazovým
entrypointem; test kontroluje přidávání, součty, kategorie, čerstvý stav,
neplatné vstupy a neznámý příkaz. JSON lze napsat na více řádcích.
Veřejné rozhraní předané modelu je konkrétní: `run(commands)` přijímá pole
příkazových n-tic `['add', amount, category]`, `['list']`, `['total']` a
`['categories']`; vrací pole výsledků ve stejném pořadí. Například
`run([['add', 12, 'food'], ['total']])` vrátí dvouprvkové pole s druhým
výsledkem `12`. Každé volání začíná prázdnou evidencí. `list()` vrací řádky
`{amount, category}` v pořadí vložení jako nezávislé kopie. `add()` musí
odmítnout neplatnou částku či kategorii; `total()` a `categories()` počítají
nad stejnými uloženými řádky. Neznámý příkaz vyvolá chybu. Toto zadání je
veřejným kontraktem, podle kterého lze implementaci posoudit před schválením.

```json
{
  "instruction": "Build a dependency-free in-memory expense ledger. Public run(commands) takes an array of command tuples and returns one result per tuple in order. Each run starts with empty state. Generate the six listed modules only.",
  "files": [
    {
      "path": "src/app.js",
      "instruction": "Re-export run from './cli.js' as the public entrypoint. Its input is an array of command tuples and its output is one result per command in order.",
      "dependsOn": [
        "src/cli.js"
      ]
    },
    {
      "path": "src/cli.js",
      "instruction": "Export run(commands). Commands are tuples: ['add',amount,category], ['list'], ['total'], ['categories']. Return an array of one result per command in order; add may yield undefined/null. Create a fresh service per run; throw on unknown operations or invalid arguments. Do not use object commands or return only the last result.",
      "dependsOn": [
        "src/service.js"
      ]
    },
    {
      "path": "src/service.js",
      "instruction": "Export createService(): create one fresh ledger; expose add(amount,category), list(), total(), categories(). list returns ordered {amount,category} rows; total and categories use those rows and the totals module.",
      "dependsOn": [
        "src/storage.js",
        "src/totals.js"
      ]
    },
    {
      "path": "src/storage.js",
      "instruction": "Export createLedger(): add(amount,category) calls validate, then stores one {amount,category} row from the arguments. Do not depend on the return value of validate. list() returns ordered independent copies of rows; mutating a result cannot change stored rows or another result.",
      "dependsOn": [
        "src/validate.js"
      ]
    },
    {
      "path": "src/totals.js",
      "instruction": "Export total(rows) as the numeric sum of row.amount (0 for no rows), and categories(rows) as a plain object mapping each row.category to its numeric sum ({} for no rows). Rows have {amount,category}; do not coerce invalid amounts.",
      "dependsOn": []
    },
    {
      "path": "src/validate.js",
      "instruction": "Export validate(amount,category): throw unless amount is a finite positive number without string coercion and category is a non-whitespace string. Storage calls it for rejection and creates the row itself; no return value is required.",
      "dependsOn": []
    }
  ],
  "focusedTest": {
    "binary": "/usr/bin/node",
    "argv": [
      "--experimental-default-type=module",
      "--input-type=module",
      "-e",
      "import assert from 'node:assert/strict';import {run} from './src/app.js';const results=run([['add',12,'food'],['add',8,'travel'],['add',3,'food'],['total'],['categories'],['list']]);assert.equal(results[3],23);assert.deepEqual(results[4],{food:15,travel:8});assert.equal(results[5].length,3);assert.deepEqual(run([['list'],['total']]),[[],0]);for(const amount of [0,-1,NaN,Infinity])assert.throws(()=>run([['add',amount,'food']]));assert.throws(()=>run([['add',1,'']]));assert.throws(()=>run([['unknown']]));"
    ],
    "environment": {
      "LANG": "C.UTF-8",
      "LC_ALL": "C.UTF-8",
      "NO_COLOR": "1"
    },
    "timeoutMs": 30000
  }
}
```

Model může selhat nebo vrátit nekvalitní implementaci. První fyzický
šestisouborový pokus na `62e1309f` skončil `FAIL`: model navrhl objektové
příkazy místo zde uvedených n-tic a M2 všechny soubory vrátilo. Původní
modelové zadání tento tvar výslovně neuvádělo; nynější veřejný kontrakt ho
upřesňuje. Nový fyzický běh na `92f7b51c` dne 1. 10. 2026 v 09:14 UTC
prošel **PASS** a nezávislým review: aplikace prošla pevným funkčním testem,
commitem a dalším testem po restartu. Jde o jeden malý backend/M2 projekt;
další typy projektů a průchod instalovaným IDE vyžadují vlastní ověření.
[Důkazy a stav](wp/WP-PROJECT-APP-FUNCTIONAL-20261001.md). Příkaz nevytváří
adresáře, neinstaluje závislosti a neaktivuje starý milestone executor.


## Příklad: pět modulů správce úloh TaskFlow

TaskFlow je druhá, věcně odlišná paměťová aplikace. Veřejné `run(commands)`
přijímá pole n-tic `['add',title,priority]`, `['update',id,patch]`,
`['transition',id,status]`, `['remove',id]`, `['list']` či `['list',options]`.
Vrací jeden výsledek na každou n-tici a každé volání začíná prázdnou tabulí.
Úloha má kladné bezpečné celočíselné ID, neblankový titul zachovaný včetně
okrajových mezer, prioritu 1–3 a stav `todo|doing|done`. Povoleny jsou jen
přechody `todo → doing → done`. `list` filtruje přesným stavem a řadí podle
ID nebo sestupné priority s ID jako rozhodovačem shody. Vrácené úlohy jsou
nezávislé kopie; smazaná ID se znovu nepřidělují. Neplatný příkaz či argument
vyvolá chybu před změnou svého stavu. Povoleny jsou jen uvedené importy a
standardní ECMAScript globály.

Pět generovaných modulů má toto veřejné zadání. Operátor před generováním
uloží vlastní zamčený funkční test, CLI adaptér a policy; ty nejsou součástí
modelových výstupů. V projektu lze zadání předat stejnému `/m2-build` formuláři
jako předchozí příklad; jeho zamčené testovací artefakty vyžadují zvláštní
kvalifikační runner. Následující JSON je veřejná část přesného kvalifikačního
zadání:

```json
{
  "instruction": "Build dependency-free in-memory TaskFlow JS. Tasks={id,title,priority,status}; priority 1..3; status todo|doing|done. run(commands) accepts exact tuples below, returns one result per tuple and uses a fresh board each call. An invalid command throws before changing its own state. Generate only five modules. In every generated module use only standard ECMAScript globals; no Node/Web host globals such as structuredClone, process, console or Buffer.",
  "files": [
    {
      "path": "src/app.js",
      "instruction": "Re-export run only from './cli.js' as the public entrypoint. No other imports. Do not execute commands or start a process at import time.",
      "dependsOn": [
        "src/cli.js"
      ]
    },
    {
      "path": "src/cli.js",
      "instruction": "Import createBoard only from './store.js'; no other imports. Export run(commands): require an array; make a fresh board per call. Exact tuples: ['add',title,priority], ['update',id,patch], ['transition',id,status], ['remove',id], ['list'] or ['list',options]. Reject wrong arity/unknown operations. Dispatch in order and return one result per tuple: task copies for add/update/transition, true for remove, array for list. Never return only the last result.",
      "dependsOn": [
        "src/store.js"
      ]
    },
    {
      "path": "src/store.js",
      "instruction": "Import only './validate.js' and './query.js'. Export createBoard() with add(title,priority), update(id,patch), transition(id,status), remove(id), list(options={}). add assigns never-reused ids 1,2,... and todo; update changes only supplied title/priority; transition only todo->doing or doing->done; remove existing id returns true. Validate all inputs/options; unknown ids or illegal transitions throw. Return independent task copies; list uses select. No other imports.",
      "dependsOn": [
        "src/query.js",
        "src/validate.js"
      ]
    },
    {
      "path": "src/query.js",
      "instruction": "Export select(tasks,options). Filter by exact options.status when present. Default sort=created means id ascending; sort=priority means priority descending then id ascending. Return a new array of new plain {id,title,priority,status} records. Never mutate input array or rows. No imports.",
      "dependsOn": []
    },
    {
      "path": "src/validate.js",
      "instruction": "Export validateTitle, validatePriority, validateId, validateStatus, validatePatch, validateOptions; each throws TypeError on invalid input. No imports. Title is a nonblank string, stored without trimming; priority is an integer 1..3; id is a positive safe integer; status is todo|doing|done. Patch is a nonempty plain object with only title and/or priority; validate each present field. Options is a plain object with only optional status and sort=created|priority. Never coerce values.",
      "dependsOn": []
    }
  ]
}
```

Lokální CPU přejímka kontroluje skutečný výsledek a stav aplikace v M2
sandboxu včetně rollbacku vadných implementací a opětovného otevření SQLite.
Fyzické vytvoření TaskFlow přesným modelem na `6f0f04d5` má nyní
**PASS / REVIEW_PASS**, včetně frozen testu, přesných bajtů a restartu.
Status a důkazy jsou v [TaskFlow WP](wp/WP-PROJECT-TASKFLOW-FUNCTIONAL-20261001.md).

## Přesné zdroje přijatých generovaných aplikací

Samostatná [generace Ledgeru ve skutečném packaged IDE](../examples/generated-apps/expense-ledger-ide/README.md)
má šest přesných modulů a vlastní manifest; následná fyzická přejímka
CODE/composer/M2 získala **REVIEW_PASS**. [Report](review/2026-10-01-STUDIO2-M2-FUNCTIONAL-UI.md)
vymezuje předvyplněný blueprint, frozen test, Git/restart/DB a důkazní
limity. Archivní [source probe](../materials/ide2-code-dom-physical-response-guard-20261001/README.md)
je rovněž zveřejněný. Historické stavy při exportu jsou zachované;
starší backend Ledger/TaskFlow snapshoty a manifest se nemění.

[Ledger a TaskFlow](../examples/generated-apps/README.md) obsahují všech
11 původních modelových souborů, jejich hash/Git blob manifest a příklady
tuple volání. Jsou zkopírované bez dodatečných oprav z přijatých skutečných
průchodů `92f7b51c` a `6f0f04d5`. Nezávislé source-only review ověřilo
provider → preview → terminal → Git → filesystem → export, žádná nová
inference. Soukromé DB, prompts a raw odpovědi jsou mimo Git.
