# Zadání pro další relaci — přestavba evaluace, den 1 (pokračování)

**Kontext:** [`EVAL-REDESIGN.md`](EVAL-REDESIGN.md) (proč a plán) ·
[`MODEL-PLATFORM-HANDOFF.md`](MODEL-PLATFORM-HANDOFF.md) (stav platformy)
**Poslední commit:** `1e092629`

---

## 1. Kde to stojí

Den 1 z plánu (CODE od promptu po skóre + doklad rozlišení) je **hotový zhruba
ze třetiny**.

| krok | stav |
|---|---|
| návrhový dokument | ✅ `docs/EVAL-REDESIGN.md` |
| extraktor úloh z historie | ✅ `src/eval/code-task-extractor.js`, 12 testů |
| kontrolní bod: aplikovatelnost patche | ⬜ **další na řadě** |
| runner: prompt → patch → aplikace → test | ⬜ |
| zapojení do `pairwise-trial` | ⬜ |
| baseline na 3 modelech = doklad rozlišení | ⬜ |

## 2. Co udělat, v tomhle pořadí

### Krok 1 — Kontrolní bod aplikovatelnosti (dělej **první**, je to hlavní riziko)

Vezmi 3 úlohy z extraktoru, pošli je jednomu modelu a zjisti, **v jakém tvaru
vrací opravu**. Očekávané formáty: celý soubor, jen upravená funkce, unified
diff, kód v markdown bloku.

Rozhodnutí, které z toho plyne:

- Když jde odpověď spolehlivě aplikovat → pokračuj na krok 2.
- Když ne → **přepni zadání na „vrať celou upravenou funkci"** a nahrazuj ji
  v souboru. Nepiš parser unified diffů, na to není v rozpočtu prostor.

Tenhle krok má vlastní hodnotu i když dopadne špatně: určí tvar celého runneru.

### Krok 2 — Runner

```
vstup:  zdroják před opravou + zadání + (skrytý) test
výstup: pass_rate = prošlé testy / celkem, 3 opakování
```

Povinné vlastnosti:

- **Izolace.** Model generuje kód, který se spouští. Odhozený worktree +
  podproces s timeoutem, bez sítě. Docker by byl lepší, ale nevejde se do
  rozpočtu dne.
- **Test se modelu neukazuje** (anti-cheat pravidlo 3 z návrhu).
- **Bez vedlejších účinků na repozitář** — viz past níže.

### Krok 3 — Zapojení do souboje

`pairwise-trial.js` už umí porovnat dva modely na stejných úlohách s marží a
opakováním. Nová sada se do něj má zapojit, ne obcházet ho.

### Krok 4 — Doklad rozlišení

Spusť na 3 nainstalovaných modelech. **Akceptační kritérium:** rozptyl mezi
nejlepším a nejhorším je větší než vlastní šum metriky. Když všechny modely
dají stejně, metrika nerozlišuje — a to je potřeba nahlásit, ne obejít.

## 3. Pasti, do kterých jsem spadl (nešlapej do nich znovu)

**`git worktree add` nevytvoří `node_modules`.** Každý test pak spadne na
`ERR_MODULE_NOT_FOUND` a vypadá to jako nespolehlivé orákulum. Bez symlinku
vypadalo 15 ze 17 dobrých kandidátů jako vadných. Řeší `linkDependencies()`.

**`git checkout <ref> -- <cesta>` mění index hlavního repa**, i když se zapisuje
do jiného `--work-tree`. Při prvním běhu to zaneslo do stage staré verze šesti
zdrojáků — 766 smazaných řádků. Pracovní strom to nepoškodilo, ale commit by
tiše vrátil několik oprav. Používej `git show <ref>:<cesta>` a zapiš soubor
ručně. Test `index zdrojového repa zůstane nedotčený` to hlídá.

**Commit, který soubor zakládá, není oprava.** Nemá stav „před", takže úloha
nemá zadání. Filtruje se přes `git cat-file -e <hash>~1:<cesta>`.

## 4. Co je k dispozici

```bash
# vytěžit ověřené úlohy z historie
node -e "import('./src/eval/code-task-extractor.js').then(async m => {
  const r = await m.extractTasks(process.cwd(), { count: 20, maxDiffLines: 40 });
  console.log(r.tasks.length, 'úloh z', r.examined, 'prozkoumaných');
})"
```

Úloha nese: `hash`, `source`, `test`, `before` (kód s vadou), `after` (gold
patch), `changedLines`, `subject`.

Materiál v historii: 248 commitů mění `src/` i `tests/`, 35 % má diff ≤ 40
řádků. Testy běží 34–87 ms, takže orákulum je prakticky zadarmo.

## 5. Pravidla, která platí

- **Žádný model se nemaže**, dokud sady nerozlišují (`REMOVAL_ENABLED_BY_DEFAULT
  = false`). Operátorské pravidlo z 2026-08-20.
- **Vazby rolí se nemění automaticky** — výstup je podklad k ručnímu potvrzení.
- **`model-profiles.js` je připnutý** bajtovým hashem ve fail-closed proof
  policy; změny rodin patří do `model-family-extensions.js`.
- Anti-cheat: hodnoticí logika nesmí obsahovat termíny z promptu; skryté testy;
  náhodné varianty tam, kde to jde.

## 6. Po dni 1

| den | výstup |
|---|---|
| 2 | REVIEW z `AUDIT-v123.md` (47 vad se souborem a řádkem) a `RISK-REGISTER.md` (33) |
| 3 | CHAT z 192 `.md` souborů, česky, nad doménou projektu |
| 4 | prahy, rulebook, canary |

Po zprovoznění CODE jsou REVIEW a CHAT **jen data do téže pipeline**, ne nový
vývoj. To je důvod, proč odhad spadl z 18 na 4–5 dní.

VISION je odložený — role je okrajová a testovací obrázky (1×1 až 32×32 px) se
musí postavit znovu.
