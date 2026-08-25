# Hledání lepších modelů

**Vstup:** `scripts/model-upgrade-hunt.js` · **Stav:** current v136.1 pipeline
**Autorita evaluací:** [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md)

Hunt používá trychtýř, aby GPU a disk platily až za kandidáty, kteří mají
reálnou šanci pro konkrétní roli:

1. online/local discovery a role-specific eligibility;
2. postupný pull jednoho kandidáta s 40 GiB diskovou rezervou;
3. prázdný GPU slot a měření reálného VRAM placementu při produkčním contextu;
4. krátké binární capability minimum;
5. candidate/incumbent na stejné versioned suite, třikrát, exact digest;
6. fail-closed evidence minima a append-only role decision až po kontrole
   celého portfolia; pouze přesně vybraný kandidát může mít
   `activationEligible=true`;
7. žádná automatická aktivace — vítěz je podklad pro ruční binding application.

Discovery/ranking není score. CPU spill je diskvalifikace, ne kvalitativní
penalizace. Run jiného digestu nebo suite contractu nelze z cache znovu použít.
Sdílená suite cache zahrnuje contract SHA a model, takže reasoning lze bezpečně
sdílet mezi D1/D2/R1 pouze uvnitř téhož hunt běhu.

Nerozlišující sada, příliš úzký jazykový vzorek, nestabilní úlohy, neúplný run
nebo chybějící binding končí jako `nedostatečný důkaz`/`MISSING`/`BLOCKED`, ne
jako vítěz. Rychlost je diagnostika a tie-break metadata; bez minimálního
počtu stabilně rozlišujících úloh sama výměnu neautorizuje.

Párová výhra před portfolio solverem není akční doporučení. Read model vrací
`PORTFOLIO_NOT_APPROVED`, pokud rozhodnutí výslovně nenese portfolio
způsobilost; starší nebo částečně zapsaný decision proto selže zavřeně.

Hunt je GPU operace. Před spuštěním musí být prázdné `ollama ps`, žádný cizí
NVIDIA compute proces, dostatečná RAM/VRAM a ověřená disková rezerva. Report
aktuálního stavu je naproti tomu read-only:

```bash
npm run report:model-evaluations
```

Jednorázový úplný panel všech kompatibilních lokálních artefaktů se spouští:

```bash
node scripts/model-upgrade-hunt.js --run --installed-panel
```

Tento režim nevolá vzdálené discovery, nepřidá do fronty nenainstalovaný model
a znovu změří i dřívější VRAM blokace, aby se pod aktuálními suite kontrakty
zapsal čerstvý `CANDIDATE_VRAM_FIT_FAILED`. Model s CPU offloadem nepokračuje
do capability ani quality sad. Režim nic neaktivuje ani nemaže.
