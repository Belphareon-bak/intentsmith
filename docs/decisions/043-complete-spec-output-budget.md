# Decision 043 — Operation-bound complete SPEC output budget

**Datum:** 2026-09-11

**Stav:** `ACCEPTED / IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED / MODEL_NOT_RUN`

**Rozsah:** jediná strukturovaná operace vytvoření úplného SPEC dokumentu

## Rozhodnutí operátora

Operátor výslovně potvrdil „spec 6000 ano“ nad návrhem a nezávisle
zkontrolovanou behavior boundary z 2026-09-09.

Operace `workflow.spec-document.json@1` smí požádat nejvýše o 6000 výstupních
tokenů. Obecný `WORKFLOW_PLANNER` zůstává na 4000. Stejně zůstávají na 4000
počáteční SPEC analýza, analýza revize a všechna ostatní běžná D1 volání.
Limity dalších rolí se nemění.

## Autoritní hranice

Výjimku vydává pouze interní complete-SPEC kompozice jako immutable
process-local token. Token je vázaný na:

- roli `WORKFLOW_PLANNER` a modelovou roli `D1`;
- purpose `answer`, capability `reasoning` a JSON format;
- přesný request, conversation a turn identifikátor;
- nakonfigurovaný D1 model a běžný trusted context/VRAM profil;
- konečný strop 6000.

Běžný `options.maxTokens`, modelový výstup, uživatelský text, spread nebo
serializace tokenu tuto autoritu nevytvoří. Běžný planner token nad 4000 na
strict policy boundary selže před provider efektem. Nižší explicitní požadavek
zůstává nižší. Neplatná, neceločíselná, záporná nebo vyšší hodnota selže před
provider efektem.

## Failure semantics

Každá operace provede nejvýše jeden provider pokus. `finishReason:length`
zůstává terminální typed chybou i tehdy, když dosavadní bajty náhodou tvoří
validní JSON a projdou obsahovou validací. Uživatelské upřesnění zůstane
durabilně uložené pro pozdější explicitní pokus. Prázdný, nevalidní nebo
neúplný dokument se nepovýší na SPEC a nevzniká skrytý fallback.

Rozhodnutí nemění model binding, context size, VRAM rezervu, `think` policy,
webovou autoritu ani akceptační kritéria SPEC. Strop 6000 je technický kandidát,
ne důkaz kvality nebo záruka dokončení.

## Implementační a důkazní stav

Implementační candidate mění `auth-types.js`, strict policy v `gateway.js`,
typed adaptér v `cre-bridge.js`, specializovanou kompozici ve `workflow.js` a
jediného produkčního konzumenta v `lifecycle-spec.js`. Regrese jsou v
existujících registrovaných suitách `workflow`, `lifecycle` a
`m1-model-contract`.

Lokální inertní výsledky před review:

- workflow: 46/46 PASS;
- lifecycle: 158/158 PASS;
- M1 model contract: 31/31 PASS.

Tyto výsledky dokazují autoritní a fail-closed hranici bez modelu. Skutečný
původní cookbook na exact reviewed kandidátu musí teprve ověřit, zda 6000
vytvoří použitelný plný dokument a zachová všechny revizní požadavky. Do té
doby platí `MODEL_NOT_RUN` a žádná M6 acceptance.
