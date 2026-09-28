# Inventura #15 — Paměť (LTM, task, cross-project)

**Pořadí 12** · **2026-08-02** · `17a8b9a8` · 9 souborů, **3 132 řádků**

| Soubor | Ř. |
|---|---:|
| `preferences.js` | 715 |
| `long-term.js` | 503 |
| `cross-project-learner.js` | 443 |
| `task-memory.js` | 374 |
| `policy.js` | 265 |
| ostatní (4) | 832 |

**Testy:** 7 sad — `offline` 3, `server` 2, `model` 2. `lastGreen: 0`.

## Dobré, použije se
- **Confidence decay** — LTM 69 dní, task memory 139 dní. Samostatně existuje
  TTL, explicitní `forget()` a retenční mazání; decay není privacy-delete ani
  retention mechanismus.
- **`policy.js` (265 ř.) odděleně** — pravidla, co se smí pamatovat, mimo mechaniku ukládání.
- **`injection-ranker`** — `score = effConf × relevance`. Co se vloží do promptu, je spočítané, ne heuristika v handleru.
- **`feedback-detector`** — 6 typů signálu, ze kterých se paměť posiluje.
- **Cross-project learning jako vlastní modul**, ne vedlejší efekt LTM.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **PA-1** | **`preferences.js` je největší soubor schopnosti (715 ř.)**, přitom uživatelské preference nejsou totéž co paměť. | Patří preference sem, do nastavení, nebo jsou to dvě věci pod jedním jménem — jako u #18? |
| **PA-2** | **`ltm-context.js` (186 ř.) je v `src/chat/`, ne v `src/memory/`.** Injekce paměti do promptu žije u konverzace. | Duplikát otázky `K-4`. Kde je hranice #4 a #15? |
| **PA-3** | **Paměť sbírá data o uživateli a jeho projektech.** Privacy incident `P-001`..`P-003` se týkal mimo jiné exportovaných konverzací. | Až se bude řešit bezpečnost: co přesně paměť ukládá a jak se to maže? Zaznamenat, neřešit teď. |
