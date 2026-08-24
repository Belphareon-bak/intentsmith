# WP-MODEL-EVALUATION-CONSOLIDATION — jedna autorita pro modelové evaluace

**Typ:** zapisující WP · **Slot:** izolovaný worktree
`/home/belphareon/worktrees/is-model-evaluation-consolidation-20260824`

**Vstupní revision:** `bd71b2ff37036f1b80d56620083402ffe3610269`

**Větev:** `codex/model-evaluation-consolidation-20260824`

**Autorita:** explicitní pokyn operátora z 2026-08-24 odstranit v123 cestu,
sjednotit scoring/evaluace a pokračovat přes všechny milníky až k jednomu
review candidate.

**Stav:** `IN PROGRESS`; tento soubor je zadání, nikoli PASS evidence.

## 1. Uživatelský výsledek

IntentSmith bude mít jednu autoritativní cestu pro hodnocení modelů. Každý
aktuální výsledek bude čitelný z DB a svázaný s přesným artefaktem modelu,
rolí, verzí a contract SHA sady a časem testu. Durable binding, vyhodnocení,
rozhodnutí o změně a skutečná aktivace budou oddělené kroky. Neaktuální,
neúplný nebo chybějící výsledek nesmí vypadat jako PASS.

Starý v123 scoring/validation runtime, jeho HTTP/WS/CLI/UI surface a paralelní
agregované score se odstraní. Historické migrační kroky a review/run evidence
zůstávají pouze kvůli reprodukovatelnosti a bezpečnému upgradu existujících DB;
nejsou runtime fallbackem ani současnou autoritou.

## 2. Vlastněné a zakázané cesty

**Povolené:**

- `src/eval/**`, modelová část `src/upgrade/**`, modelové route/server wiring;
- aditivní migrace `082`, eval/decision repository a přesné schema testy;
- modelová CLI/report skripta a jejich testy;
- autoritativní Studio runtime v
  `c3-ide/extensions/c3-chat-panel/lib/browser/**`;
- modelové registry, dokumentace, rozhodnutí, test registry a boundary baseline;
- skutečné Ollama/GPU přijetí až po opakované kontrole sériového slotu.

**Zakázané:**

- přepis historické evidence tak, aby starý běh vypadal jako současný PASS;
- automatická aktivace vítěze, opt-in failover nebo rollback bez existující
  uživatelské autority podle L0-9;
- přímé SQL mimo autoritativní typed repository;
- dotyk cizích checkoutů, procesů a neznámého untracked reportu v mainu;
- svévolný zásah do M2 connector práce nebo použití obsazeného GPU/Ollama slotu.

## 3. Autoritativní kontrakt a invarianty

1. `model_evaluation_runs` je append-only historie měření exact artefaktu a
   exact suite contractu; migrace `082` odstraní runtime tabulky v123 až po
   preflightu importu z migrace `070`.
2. Aktuálnost se určuje shodou `(model digest, role, suite name, suite version,
   suite contract SHA)`, ne stářím řádku ani názvem modelu.
3. API, CLI a Studio čtou stejný read model. Ukazují `COMPLETE`, `FAILED`,
   `BLOCKED` nebo `MISSING`, score pouze tam, kde existuje, a `testedAt`.
4. Mezi-role agregát není autoritou. Rozhodnutí je role-specific a je uloženo
   append-only s odkazy na oba porovnávané runy a přesnou politiku.
5. Durable bindings jsou jediná autorita pro aktivní role. Konfigurační model
   je jen explicitně označený bootstrap fallback.
6. Discovery ranking je pouze prior pro výběr kandidáta; nesmí být vydáván za
   eval score ani získávat bonus z odstraněné v123 validace.
7. Retence a cleanup jsou fail-closed: bound, chráněný, použitý, neúplně
   vyhodnocený nebo inconclusive artefakt se automaticky nemaže.
8. Vyhodnocení ani doporučení samo model neaktivuje. Aktivace vyžaduje dnešní
   explicitní uživatelský krok a exact-digest binding application.

## 4. Pořadí implementace

1. odstranit v123 runtime a vyjmout z něj obecný runner/syntetické fixture;
2. zavést jednotný v136.1 read model, API, CLI a Studio čtení;
3. přidat migraci `082`, append-only decision store a digest-bound audit;
4. převést proof/measurement cestu na current v136.1 contracts;
5. uzavřít role coverage a fail-closed hranice;
6. odstranit zbývající paralelní scoring terminologii a neautoritativní docs;
7. provést focused, daily a čistý acceptance běh, pak připravit jednu přesnou
   review jednotku pro nezávislé review operátora.

Milníky jsou review checkpoints, nikoli stop condition. Práce pokračuje až do
dokončení všech bodů nebo pravdivě doloženého blockeru.

## 5. Pozitivní a negativní důkaz

**Pozitivní:** čerstvá DB projde migracemi; upgrade DB zachová audit v `070` a
odstraní v123 runtime tabulky; stejný exact-current stav vrátí repository, API,
CLI i Studio; role-specific rozhodnutí odkazuje na oba runy; durable binding se
všude zobrazuje stejně; current v136.1 suite lze dokončit a její timestamp i
contract SHA jsou čitelné.

**Negativní minimálně:** jiný digest, starý contract, chybějící run, BLOCKED
run, DB chyba, neúplné role coverage, inconclusive comparison, config/DB drift,
neznámé využití a neautorizovaná aktivace všechny fail-close skončí bez PASS,
mazání nebo změny bindingu. Odstraněné v123 endpointy a WS zprávy vrátí 404 nebo
neexistují; žádný runtime import `validation-suites.js` nezůstane.

## 6. Stop condition / eskalace

Zastaví se jen dotčená část, pokud je potřeba změnit L0-9, překročit explicitní
aktivaci operátora, přepsat přijaté historické rozhodnutí místo aditivního
follow-upu, použít obsazený GPU/Ollama slot, sáhnout do cizí dirty práce nebo
pokud fresh-clone baseline odhalí nesouvisející regresi. Ostatní nezávislé
milníky pokračují a blocker se nesmí vydávat za PASS.

## 7. Ověřovací příkazy

Přesný focused seznam se průběžně doplní podle změněných modulů; minimální
finální brány jsou:

```bash
C3_LOG_LEVEL=error npm run test:deterministic
C3_LOG_LEVEL=error npm run test:registry
node tests/schema-migrations.test.js
node tests/model-evaluation-history.test.js
node tests/model-upgrade-hunt.test.js
node tests/routes-smoke.test.js
node tests/ws-bridge.test.js
node scripts/validate-test-registry.js
node tests/artifact-validation.test.js
node tests/repository-hygiene.test.js
node scripts/module-boundary-ratchet.mjs
git diff --check
```

Skutečný Ollama/GPU acceptance běh se provede pouze po potvrzení volného
sériového slotu, dostatečné VRAM, RAM a disku; jinak zůstane pravdivě `BLOCKED /
NOT RUN`.

## 8. Výstup a pravdivé omezení

Výstupem je jeden souvislý review candidate s přesným base/head rozsahem,
migrační a focused/daily evidencí, explicitním seznamem skutečných host/GPU
běhů a známých baseline non-PASS. Implementační green bez nezávislého review
není `ACCEPTED`; konečný stav po implementaci je nejvýše `REVIEW_PENDING`.

Po přijetí této modelové části následuje samostatný whole-repo audit dalších
zastaralých nebo paralelních implementací IntentSmith. Tento následný audit je
záměrně mimo aktuální review rozsah a nesmí být použit k předčasnému uzavření
tohoto WP.
