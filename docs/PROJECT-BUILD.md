# Řízené sestavení projektu ve Studiu

Rozsah produktu určuje PRODUCT.md. Tento návod popisuje dostupný ohraničený
builder; úplný autonomní builder a fyzický modelový průchod zůstávají neověřené.

V chatu připojeného projektu klikněte na **Připravit změnu**. Stejný formulář
otevře `/m2-build` bez argumentu. Rozpracovaný text chatu se do cíle zkopíruje
a v chatu zůstane. JSON není nutné psát.

1. Napište celkový cíl a pro každý soubor cestu v projektu a jeho zadání.
   Přidejte další soubory podle potřeby. Přímé závislosti uveďte po jedné cestě
   na řádek; musí to být jiné soubory téhož plánu bez cyklů.
2. Zadejte úplnou cestu programu pro funkční test a jeho jednotlivé argumenty.
   Například program `/usr/bin/node` s argumenty `--test` a
   `tests/app.test.js`. Testovací soubor musí být připravený v projektu.
   Celý inline program patří do jediného argumentu za `-e`; formulář zachovává
   mezery, uvozovky a prázdné argumenty a neprovádí shellové rozdělování.
3. Klikněte **Vygenerovat návrh**. Model navrhne úplný obsah každého souboru
   s kontextem jeho přímých závislostí. Při chybě zůstává zadání ve formuláři;
   opravte příčinu uvedenou ve zprávě a odešlete jej znovu. Skrýt zachová zadání,
   Zahodit zadání jej odstraní. Rozepsaný formulář nepřežívá restart Studia.
4. Prohlédněte všechny původní a navržené obsahy a přesný test. Až tlačítko
   **Schválit zobrazené změny** nebo `/m2-approve` spustí uložený plán. Při
   neúspěšném testu M2 vrací všechny změny. Obecné „ano“ nic neschválí.
5. Tlačítkem **Zrušit** nebo `/m2-cancel` zastavíte generování nebo požádáte
   o zrušení prováděné operace. **Načíst stav a plán** či `/m2-status` obnoví
   uložený stav. Po restartu Studia musí tlačítko schválení nejprve načíst
   a zobrazit obnovený plán. Přepnutí projektu/konverzace staré zadání nepřeváže.

Pokročilý vstup `/m2-build <JSON>` zůstává dostupný, včetně volitelného
Git commitu a vlastního prostředí testu. Formulář používá prostředí uvedené
v jeho detailu a Git commit nevyžaduje; nemění stávající HTTP kontrakt.

## Předpoklady a meze

- Registrovaný, připojený Git projekt s platnou `.c3/m2-governance-policy.json`;
  cílové adresáře již existují. Běžná registrace sama governance nezakládá.
- Aktivní lokální model pro roli CODE a stávající M2 procesový sandbox.
  Žádné automatické změny modelového bindingu ani oprávnění.
- 1–32 explicitních textových cílů v povoleném projektovém kontextu, původní
  soubor do 1600 B. Závislosti odkazují pouze na jiné cíle téhož plánu; bez cyklů.
- Celkové zadání a každé souborové zadání do 512 B. Každý úplný prompt včetně
  systému a přímých dependencies do 2200 B; výstup souboru do 8192 B a zároveň
  modelový limit 1536 tokenů. Celá generace má 120 s. Limit 32 není příslib,
  že každý model v tomto čase zvládne 32 souborů. Překročení nevytvoří dílčí plán.
- `focusedTest` je povinný explicitní program/argv/environment/timeout.
  Zvolte skutečné funkční assertions; samotná přítomnost testu nezaručuje jeho
  kvalitu. Model jeho obsah neurčuje. Program nemá allowlist binárek;
  ohraničení zajišťuje schválený M2 procesový sandbox. Volitelný `gitCommit` používá stejný
  strict tvar jako `/m2-plan` (message a explicitní author/committer identity).

Pro malou změnu 1–3 JS souborů zůstává `/m2-draft src/app.js :: zadání`.
Pro ručně hotové obsahy slouží `/m2-plan <JSON změn>`. Běžný volný text
SPEC→BUILD ještě tímto příkazem není automaticky napojen na úplný builder.

## Příprava malého JavaScript projektu

Nejprve v editoru připravte adresář `src/` a funkční test, například
`tests/app.test.js`. Vlastní pravidla projektu uložte do
`.c3/m2-governance-policy.json`. Pro jednu aplikační vrstvu bez externích
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
seznamy přípon, názvů vrstev, pravidel a importů udržujte seřazené bez duplicit.
prázdné `externalImports` záměrně neumožňují externí knihovny. Uložte výchozí
soubory, test a pravidla do Git commitu a začněte s čistým pracovním stromem.
Studio registrací projektu tato pravidla nevytváří. Tato příprava probíhá
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
