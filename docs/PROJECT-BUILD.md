# Řízené sestavení projektu ve Studiu

Stav: implementovaný kandidát pro review. Rozsah produktu určuje PRODUCT.md;
tento návod popisuje konkrétní dostupný přírůstek, nezakládá release acceptance.

V připojeném projektu vložte do chatu příkaz `/m2-build` následovaný JSON
plánem níže. Model navrhne úplný obsah každého souboru podle jeho zadání a již
navržených přímých závislostí. Studio ukáže všechny původní a navržené obsahy
a přesný test. Teprve `/m2-approve` schválí uložený plán; při neúspěšném
testu M2 vrací všechny změny. `/m2-cancel` zruší generování nebo požádá
o zrušení existující operace; `/m2-status` načte uložený stav.

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
  kvalitu. Model jeho obsah neurčuje. Volitelný `gitCommit` používá stejný
  strict tvar jako `/m2-plan` (message a explicitní author/committer identity).

Pro malou změnu 1–3 JS souborů zůstává `/m2-draft src/app.js :: zadání`.
Pro ručně hotové obsahy slouží `/m2-plan <JSON změn>`. Běžný volný text
SPEC→BUILD ještě tímto příkazem není automaticky napojen na úplný builder.

## Příklad: šest modulů evidence výdajů

Připravený projekt má adresář `src/`, který governance dovoluje. Po příkazu
`/m2-build` vložte tento JSON. Jde o paměťovou aplikaci s příkazovým
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
