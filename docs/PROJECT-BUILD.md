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

```json
{
  "instruction": "Build a small in-memory expense ledger with a command entrypoint and no external dependencies.",
  "files": [
    {
      "path": "src/app.js",
      "instruction": "Re-export run from cli as the public entrypoint.",
      "dependsOn": [
        "src/cli.js"
      ]
    },
    {
      "path": "src/cli.js",
      "instruction": "Export run(commands): add takes amount/category; list, total, categories return results; unknown operation throws. Each run has a fresh service.",
      "dependsOn": [
        "src/service.js"
      ]
    },
    {
      "path": "src/service.js",
      "instruction": "Export createService(): expose ledger add/list, total() and categories() using the totals module.",
      "dependsOn": [
        "src/storage.js",
        "src/totals.js"
      ]
    },
    {
      "path": "src/storage.js",
      "instruction": "Export createLedger(): add(amount,category) validates and stores one item; list() returns copies.",
      "dependsOn": [
        "src/validate.js"
      ]
    },
    {
      "path": "src/totals.js",
      "instruction": "Export total(rows) and categories(rows), summing numeric amount, also grouped by category.",
      "dependsOn": []
    },
    {
      "path": "src/validate.js",
      "instruction": "Export validate(amount,category), throwing for nonpositive/nonfinite amount or empty/nonstring category.",
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

Model může selhat nebo vrátit nekvalitní implementaci. Ověření tohoto přírůstku
používá řízené modelové odpovědi a skutečný M2 test/commit/rollback; fyzický
šestisouborový modelový běh se musí změřit zvlášť. Příkaz nevytváří adresáře,
neinstaluje závislosti a neaktivuje starý milestone executor.
