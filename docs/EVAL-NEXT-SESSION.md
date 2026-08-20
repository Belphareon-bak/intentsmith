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

Sada rozlišuje, ale drží to **jediná úloha z šesti** a dva ze tří modelů
neodliší. Než se na ni cokoli naváže, potřebuje víc úloh:

**a) Změny ve víc funkcích** — největší jediný zdroj. 19 z 29 kandidátů padá na
sítu „změna není uvnitř jediné funkce" (typicky import nahoře + tělo metody
dole). `findSpanForLines()` v takovém případě vrací `null`; rozšíření znamená
vrátit **seznam** rozsahů, poslat modelu všechny dotčené funkce a vložit je
zpátky (od konce souboru, aby zůstala platná čísla řádků).

**b) Commity s víc testovými soubory** — `findCandidates()` vyžaduje přesně
jeden test. Povolení víc testů (a požadavek, aby prošly všechny) přidá zhruba
18 kandidátů z 805 commitů.

**c) Rozprostřít obtížnost** — sada potřebuje i mechaničtější opravy, jinak
rozlišuje jen na jedné těžké úloze.

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
