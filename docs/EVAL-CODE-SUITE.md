# CODE evaluace `code_patch`

**Stav:** current v136.1 contract · **Reader:** společná modelová autorita
**Plný kontrakt:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)

`code_patch` nehodnotí klíčová slova v odpovědi. Každá aktivní úloha je
odvozena z konkrétní opravené vady v historii repozitáře: model dostane vadnou
funkci, navrhne náhradu a skrytý test se skutečně spustí nad dočasným stromem.
Nová regrese vynuluje gain.

Aktuální supply obsahuje sedm aktivních úloh; role CODE fail-close vyžaduje
nejméně šest aktivních a nejméně dvě stabilně rozlišující úlohy. Fixture
`src/eval/code-suite-tasks.json` je součást suite contract SHA, takže změna
kurace zneplatní reuse starého runu.

Hlavní moduly:

- `src/eval/code-patch-suite.js` — suite a `CodePatchEvaluationRunner`;
- `src/eval/code-patch-runner.js` — odvození, aplikace a spuštění testů;
- `src/eval/build-code-suite.js` — kurace fixture;
- `src/eval/calibrate-code-suite.js` — panelová kalibrace;
- `src/eval/role-evaluation-plan.js` — role, verze, contract a minima;
- `src/upgrade/model-evaluation-history.js` — exact-artifact run history.

Výchozí modelové volání používá `num_ctx=16384`, `num_predict=4096`, timeout
300 s a temperature 0.1. Párový trial opakuje sadu třikrát a rozdíl uzná jen
tehdy, když překročí vlastní pozorovaný rozptyl úlohy.

Fixture obsahuje i neaktivní kalibrační rezervu. Ta není decision evidence a
aktivuje se pouze explicitním kalibračním režimem. Úlohy přímo svázané s
odstraněným rankerem, v123 validací a benchmark scorerem byly z fixture
odstraněny; zbývající historické gold opravy jsou evaluační data, ne runtime
fallback.
