# Zadání pro další relaci — přestavba evaluace, den 2

**Kontext:** [`EVAL-REDESIGN.md`](EVAL-REDESIGN.md) (proč a plán) ·
[`EVAL-CODE-SUITE.md`](EVAL-CODE-SUITE.md) (co je hotové ze dne 1) ·
[`MODEL-PLATFORM-HANDOFF.md`](MODEL-PLATFORM-HANDOFF.md) (stav platformy)

---

## 1. Kde to stojí

Den 1 je **hotový**. CODE jde od promptu ke skóre a je doloženo, že sada
rozlišuje.

| krok | stav |
|---|---|
| návrhový dokument | ✅ `EVAL-REDESIGN.md` |
| extraktor úloh z historie | ✅ `src/eval/code-task-extractor.js`, 12 testů |
| kontrolní bod: aplikovatelnost patche | ✅ celá funkce v bloku, 3/3 — parser diffů netřeba |
| runner: prompt → patch → aplikace → test | ✅ `src/eval/code-patch-runner.js`, 14 testů |
| zapojení do `pairwise-trial` | ✅ sada `code_patch` v `SUITES` |
| baseline na 3 modelech = doklad rozlišení | ✅ rozptyl 0,167 > šum 0,000 |

**Naměřeno:** `qwen2.5-coder:32b` 0,167 · `qwen3-coder` 0,000 · `qwen3:14b`
0,000, šum 0,000 při třech opakováních. Podrobnosti a výhrady v
[`EVAL-CODE-SUITE.md`](EVAL-CODE-SUITE.md), oddíl 8.

## 2. Co udělat

### Nejdřív: zesílit CODE, než se přejde na REVIEW

Cíl je **6 ze 6 aktivních úloh rozlišuje**. Rozdělané kroky k tomu (podrobně
[`EVAL-CODE-SUITE.md`](EVAL-CODE-SUITE.md), oddíl 9):

1. ✅ **Odstupňované skóre** — podíl splněných požadavků místo „prošel celý
   soubor". Ověřeno: gold 1,00, před opravou 0,00 na všech šesti úlohách.
2. ✅ **Víc funkcí v zadání** — `findSpansForLines()` / `replaceSpans()`.
3. ⬜ **Zapsat podlahu úlohy** (`baselineScore`) do fixture — `d8a2aa05` dává
   0,33 i bez jakékoli opravy, takže skóre úloh nejsou srovnatelná.
4. ⬜ **Přeměřit panel** s odstupňovaným skóre — čísla v oddílu 8 jsou z
   binárního hodnocení a **neplatí**.
5. ⬜ **Kalibrovat výběr úloh** — nechat jen ty, kde se skóre napříč panelem
   liší; těžké úlohy nemazat, jen odložit jako rezervu.
6. ⬜ **Rozšířit panel** nad tři modely, ať se výběr nepřeučí na dnešní trojici.

Pozor: zásoba úloh je úzká — 29 kandidátů, 11 odvoditelných, 8 do 250 řádků.
Další růst potřebuje:

**a) Změny mimo funkce** — nové úzké hrdlo. 18 z 29 kandidátů mění řádky, které
neleží v žádné funkci (import nahoře, konstanta na nejvyšší úrovni).
`findSpansForLines()` na to vrací `null`. Buď to umět zadat jinak, nebo takové
commity nechat být a hledat zásobu jinde.

**b) Commity s víc testovými soubory** — `findCandidates()` vyžaduje přesně
jeden test. Povolení víc testů (a požadavek, aby prošly všechny) přidá zhruba
18 kandidátů z 805 commitů.

**c) Víc zdrojáků na commit** — dnes se bere jen commit s jediným souborem v
`src/`. To je 689 z 805 commitů zahozených; povolit dva soubory by zásobu
zvětšilo nejvíc ze všeho, ale zadání i vkládání musí umět víc souborů.

### Potom: REVIEW a CHAT

Obojí je **jen obsah do téže pipeline**, ne nový vývoj:

| den | výstup | zdroj pravdy |
|---|---|---|
| 2 | REVIEW | `AUDIT-v123.md` (47 vad se souborem a řádkem), `RISK-REGISTER.md` (33) |
| 3 | CHAT | 192 `.md` souborů, česky, nad doménou projektu |
| 4 | prahy, rulebook, canary |

VISION zůstává odložený.

## 3. Jak se s tím pracuje

```bash
# přestavět sadu úloh z historie (kurátorský běh, ~10 min)
node src/eval/build-code-suite.js --max-function-lines 250 --max-diff-lines 100

# doklad, že sada rozlišuje mezi modely (3 modely ≈ 28 min)
node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest qwen3:14b

# testy
node tests/function-span.test.js && node tests/code-patch-runner.test.js
```

## 4. Pasti (platí dál)

**`git worktree add` nevytvoří `node_modules`** → `ERR_MODULE_NOT_FOUND` a
vypadá to jako nespolehlivé orákulum. Řeší symlink.

**`git checkout <ref> -- <cesta>` mění index hlavního repa**, i při zápisu do
jiného `--work-tree`. Používej `git show <ref>:<cesta>` a ruční zápis. Hlídá
test `index zdrojového repa zůstane nedotčený`.

**Commit, který soubor zakládá, není oprava** — nemá stav „před".

**Zbytek řádku za uzavírací závorkou.** U vlastnosti objektu končí funkce `},`;
když se čárka při náhradě ztratí, soubor přestane být platný. Rozsah veze
`tail`.

**Výchozích 30 s na volání modelu nestačí.** Studené načtení + 2000 tokenů
odpovědi trvalo 122 s. Sada si žádá vlastní `options` (`code-patch-suite.js`).

**V repu není použitelný JS parser.** `@babel/parser` chybí, `esprima` neumí
`?.`, `tree-sitter` vrací `Invalid argument` a nula symbolů. Proto vlastní
scanner závorek ověřený round-tripem gold patche.

## 5. Pravidla, která platí

- **Žádný model se nemaže** (`REMOVAL_ENABLED_BY_DEFAULT = false`). Sada
  rozlišuje jen u části úloh, takže „neuspěl" pořád často znamená „nešlo
  změřit".
- **Vazby rolí se nemění automaticky.** `code_patch` má `roles: []` schválně a
  běží vedle `code`; přepnutí role CODE je ruční rozhodnutí operátora.
- **`model-profiles.js` je připnutý** bajtovým hashem ve fail-closed proof
  policy — nesahat; změny rodin patří do `model-family-extensions.js`.
- **Anti-cheat:** hodnotí se spuštěním testu, ne klíčovými slovy. Model vidí
  vadnou funkci a popis požadovaného chování, ne tělo testu ani gold patch.
