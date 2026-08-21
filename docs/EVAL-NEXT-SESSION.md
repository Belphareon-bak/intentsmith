# Zadání pro další relaci — evaluace CODE, rozšíření zásoby úloh

**Kontext:** [`EVAL-CODE-SUITE.md`](EVAL-CODE-SUITE.md) (jak sada funguje a co
měří) · [`EVAL-REDESIGN.md`](EVAL-REDESIGN.md) (proč se evaluace přestavuje) ·
[`MODEL-PLATFORM-HANDOFF.md`](MODEL-PLATFORM-HANDOFF.md) (stav platformy)

**Poslední commit:** `5b856a1f` · **větev:** `claude/gate1-mobile-app-progress-5sywlt`
**Verze:** v136.1

---

## 1. Kde to stojí

Sada `code_patch` je hotová, otestovaná a změřená. Měří spuštěním testu, ne
klíčovými slovy, a má **nulový šum** přes 105 běhů.

| krok | stav |
|---|---|
| extraktor úloh z historie | ✅ `src/eval/code-task-extractor.js` |
| rozsahy funkcí, i více najednou | ✅ `src/eval/function-span.js` |
| runner: prompt → aplikace → test → skóre | ✅ `src/eval/code-patch-runner.js` |
| sada + vlastní runner | ✅ `src/eval/code-patch-suite.js` |
| kurátorská stavba fixture | ✅ `src/eval/build-code-suite.js` |
| doklad rozlišení | ✅ `src/eval/discrimination-report.js` |
| kalibrace aktivní/rezervní | ✅ `src/eval/calibrate-code-suite.js` |
| **dost úloh, aby sada rozlišovala široce** | ⬜ **tohle je práce na teď** |

Naměřeno 2026-08-21 (5 modelů × 3 opakování × 7 úloh, 47,1 min):

```
qwen2.5-coder:32b  0,190        rozlišují 2 úlohy ze 7
qwen3.5:27b        0,143        5 je na podlaze (nevyřešil je nikdo)
qwen3-coder        0,048        šum metriky 0,000
qwen2.5:32b        0,048
qwen3:14b          0,000
```

**Problém není v návrhu měření, ale v počtu úloh.** V aktivní sadě jsou po
kalibraci 2 úlohy a obě rozlišují; cíl je mít takových šest a víc.

## 2. Co udělat, v tomhle pořadí

### Krok 1 — Změny mimo funkce (největší jediný zdroj)

**18 z 29 kandidátů** padá na sítu „změněné řádky leží uvnitř funkcí". Commit
mění import nahoře nebo konstantu na nejvyšší úrovni a `findSpansForLines()`
vrátí `null`.

Řešení: umět jako jednotku zadání i vrcholovou konstrukci — řádek importu, blok
`const X = {…}`, `export const`. Vkládání víc rozsahů už funguje
(`replaceSpans()` jde od konce souboru), takže jde hlavně o rozšíření
`function-span.js` o fallback „nejmenší vrcholová konstrukce obsahující řádek".

Pozor na dvě věci:
- zadání musí zůstat srozumitelné — fragment `import x from 'y';` sám o sobě
  modelu nic neřekne, takže je potřeba ho podat spolu s dotčenými funkcemi;
- round-trip gold patche musí projít stejně jako dnes, jinak se úloha zahodí.

### Krok 2 — Preferovat commity, které přidávají víc testů

Úloha s **jediným** cílovým testem umí dát jen 0, nebo 1 — žádnou mezipolohu.
`a33cc20a` rozlišila právě proto, že má tři cíle a šlo dát 0,33; `da03e8bd`
s jedním cílem rozlišuje jen náhodou.

V `build-code-suite.js` řadit kandidáty sestupně podle `failToPass.length`
a při stejné kvalitě brát ty s víc cíli.

### Krok 3 — Uvolnit první síto

`findCandidates()` bere jen commit s **jedním** souborem v `src/` a **jedním**
v `tests/`. To zahodí 689 z 805 commitů hned na začátku. Povolit víc testových
souborů (a požadovat, aby prošly všechny) přidá zhruba 18 kandidátů; víc
zdrojáků je větší zásah, protože zadání i vkládání musí umět víc souborů.

### Krok 4 — Přeměřit a znovu kalibrovat

Po každém rozšíření zásoby:

```bash
node src/eval/build-code-suite.js --max-function-lines 250 --max-diff-lines 100
node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest \
  qwen2.5:32b qwen3.5:27b qwen3:14b --json /tmp/panel.json
node src/eval/calibrate-code-suite.js /tmp/panel.json
```

Kalibrace je vázaná na panel, na kterém proběhla. Bez zopakování měří sada
včerejší pole kandidátů.

### Potom: REVIEW a CHAT

Obojí je **jen obsah do téže pipeline**, ne nový vývoj:

| výstup | zdroj pravdy |
|---|---|
| REVIEW | `AUDIT-v123.md` (47 vad se souborem a řádkem), `RISK-REGISTER.md` (33) |
| CHAT | 192 `.md` souborů, česky, nad doménou projektu |
| nakonec | prahy, rulebook, canary |

VISION zůstává odložený — role je okrajová a testovací obrázky (1×1 až 32×32 px)
se musí postavit znovu.

## 3. Pasti, do kterých se nemá šlapat znovu

**`validation-suites.js` a `model-profiles.js` jsou bajtově připnuté** ve
`model-failover-proof-policy.js`. Přidání jediného řádku shodí policy na
`MODEL_FAILOVER_PROOF_POLICY_SOURCE_DRIFT`; zápis šesté sady do registru
`SUITES` — i zvenčí — na `AUTHORITY_INVALID`. Obojí se stalo. Sada se proto
předává explicitně: `comparePair(runner, 'code_patch', a, b, { suite })`.
Hlídají to testy v `tests/code-patch-suite.test.js`.

**`git worktree add` nevytvoří `node_modules`** → každý test spadne na
`ERR_MODULE_NOT_FOUND` a vypadá to jako nespolehlivé orákulum. Řeší symlink.

**`git checkout <ref> -- <cesta>` mění index hlavního repa**, i při zápisu do
jiného `--work-tree`. Používej `git show <ref>:<cesta>` a ruční zápis. Hlídá to
test `index zdrojového repa zůstane nedotčený`.

**Testy nehlásí výsledky jednotně.** `tests/harness.js` tiskne `✅ název`
i `❌ název: chyba`; `tests/routes-smoke.test.js` tiskne **jen** `FAIL: název`
a úspěch mlčí. U mlčícího stylu je oprava poznat po *zmizelém pádu*, ne po
*přibylém průchodu* — a protože pád zmizí i při havárii běhu, vyžaduje se
doklad, že běh doběhl (závěrečný souhrn). Bez toho dostával částečný pád plné
skóre.

**Nestabilní úloha není slabá úloha, ale podezření na vadu měření.** Proto má
v reportu vlastní kategorii a neschovává se pod „shodné".

**Výchozích 30 s na volání modelu nestačí** — studené načtení a 2000 tokenů
odpovědi trvalo 122 s. Sada si nese vlastní `options`.

**V repu není použitelný JS parser.** `@babel/parser` chybí, `esprima` neumí
`?.`, `tree-sitter` vrací `Invalid argument` a nula symbolů. Proto vlastní
scanner závorek, ověřený round-tripem gold patche.

**Commit, který soubor zakládá, není oprava** — nemá stav „před".

**Background úloha přenastaví pracovní adresář.** Po `run_in_background` se cwd
vrátí na `~/Projects`; relativní cesty pak míří mimo repo a `cat >>` mlčky
založí nový soubor. Piš absolutními cestami nebo uvozuj `cd <repo> &&`.

## 4. Pravidla, která platí

- **Žádný model se nemaže** (`REMOVAL_ENABLED_BY_DEFAULT = false`). Sada
  rozlišuje jen na části úloh, takže „neuspěl" pořád často znamená „nešlo
  změřit".
- **Vazby rolí se nemění automaticky.** `code_patch` má `roles: []` a běží vedle
  `code`; přepnutí role CODE je ruční rozhodnutí operátora.
- **Rezervní úlohy se nemažou.** Dnešní podlaha je zítřejší strop.
  `C3_EVAL_INCLUDE_RESERVE=1` je vrátí do běhu.
- **Anti-cheat:** hodnotí se spuštěním testu. Model vidí vadné funkce a popis
  požadovaného chování, ne tělo testu, fixtury ani gold patch.
- Po úspěšném otestování commitnout, bez `Co-Authored-By`.

## 5. Co je k dispozici

```bash
# testy sady (rychlé, bez modelů)
node tests/function-span.test.js
node tests/code-patch-runner.test.js
node tests/code-patch-suite.test.js
node tests/code-task-extractor.test.js

# kontrola, že připnuté soubory a policy drží
node -e "import('./src/upgrade/model-failover-proof-policy.js').then(m=>{m.getModelFailoverProofPolicy();console.log('policy OK')})"
```

Stav fixture: [`src/eval/code-suite-tasks.json`](../src/eval/code-suite-tasks.json)
— 7 úloh, z toho 2 `active` a 5 `reserve-floor`, kalibrováno 2026-08-21 na pěti
modelech.

Doklad posledního měření:
[`execution/runs/code-patch-panel-20260821.md`](execution/runs/code-patch-panel-20260821.md).
