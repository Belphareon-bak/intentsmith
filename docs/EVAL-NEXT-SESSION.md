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

### Nejdřív: zvětšit zásobu úloh

Sada je hotová a čistá — měření má nulový šum a v aktivní sadě jsou jen úlohy,
které rozlišují. Problém je jejich **počet: dvě**. Pět dalších je v rezervě na
podlaze (nevyřešil je nikdo z panelu pěti modelů).

Podrobně [`EVAL-CODE-SUITE.md`](EVAL-CODE-SUITE.md), oddíly 6 a 7.

Zásoba: 29 kandidátů → 11 odvoditelných → 7 ověřených → **2 rozlišující**.
Největší ztráty, v pořadí podle výtěžnosti:

**a) Změny mimo funkce — 18 z 29 kandidátů.** Zdaleka největší zdroj. Commit
mění import nahoře nebo konstantu na nejvyšší úrovni, takže `findSpansForLines()`
vrátí `null`. Řešení: umět jako jednotku zadání i vrcholovou konstrukci (řádek
importu, blok `const X = {…}`), ne jen funkci. Vkládání už umí víc rozsahů, takže
jde hlavně o rozšíření `function-span.js`.

**b) Preferovat commity, které přidávají víc testů.** Úloha s jediným cílovým
testem umí dát jen 0 nebo 1. `a33cc20a` se třemi cíli rozlišila právě proto, že
šlo dát 0,33; `da03e8bd` s jedním cílem rozlišuje jen náhodou. Při stavbě sady
řadit kandidáty podle `failToPass.length` sestupně.

**c) Víc zdrojáků a víc testových souborů na commit.** Dnes se bere jen commit
s jedním souborem v `src/` a jedním v `tests/` — to je 689 z 805 commitů
zahozených hned na prvním sítu.

Po každém rozšíření zásoby: přeměřit panel a **znovu kalibrovat**, jinak sada
měří včerejší pole kandidátů.

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
