# Decision 043 — Operation-bound complete SPEC output budget

**Datum:** 2026-09-11

**Stav:** `ACCEPTED / REMEDIATION_CANDIDATE / RE_REVIEW_REQUIRED / MODEL_NOT_RUN`

**Rozsah:** jediná strukturovaná operace vytvoření úplného SPEC dokumentu

## Rozhodnutí operátora

Operátor výslovně potvrdil „spec 6000 ano“ nad návrhem a nezávisle
zkontrolovanou behavior boundary z 2026-09-09.

Operace `workflow.spec-document.json@1` smí požádat nejvýše o 6000 výstupních
tokenů. Obecný `WORKFLOW_PLANNER` zůstává na 4000. Stejně zůstávají na 4000
počáteční SPEC analýza, analýza revize a všechna ostatní běžná D1 volání.

První nezávislé review našlo starší rozpor mimo samotnou SPEC operaci:
`callWithAuth()` nepoužívalo role ceiling validátor a dvě živé operace už
vydávaly větší token než deklarovaná role hodnota. Remediation proto vynucuje
role policy i v centrálním `llmGateway.call()` a srovnává deklarované stropy
`CRE_DECISION=4096` a `TOOL_INTERNAL=2048` s jejich existujícím produkčním
chováním. Oddělené výchozí hodnoty zůstávají 2000 a 500, takže se žádný
dosavadní provider request nezvětšuje. Nová ceiling mapa zpřesňuje
autoritativní hranici, kterou nyní gateway skutečně vynucuje. SPEC zůstává
jedinou operací nad stropem své vlastní role.

## Autoritní hranice

Výjimku vydává pouze interní complete-SPEC kompozice jako immutable
process-local token. Token je vázaný na:

- roli `WORKFLOW_PLANNER` a modelovou roli `D1`;
- purpose `answer`, capability `reasoning` a JSON format;
- přesný request, conversation a turn identifikátor;
- nakonfigurovaný D1 model a běžný trusted context/VRAM profil;
- konečný strop 6000.

Běžný `options.maxTokens`, modelový výstup, uživatelský text, spread nebo
serializace tokenu tuto autoritu nevytvoří. Každý vydaný token pro libovolnou
roli nad jejím deklarovaným stropem selže v `llmGateway.call()` před rate
limitem a provider efektem, a to i přes legacy `callWithAuth()` a v testovacím
non-strict režimu. Nižší explicitní požadavek zůstává nižší. Neplatná,
neceločíselná, záporná nebo vyšší hodnota selže před provider efektem.

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

Lokální inertní výsledky původního candidatu před prvním review:

- workflow: 46/46 PASS;
- lifecycle: 158/158 PASS;
- M1 model contract: 31/31 PASS.

První nezávislé review na evidence HEAD `983121ee` potvrdilo konstrukci SPEC
výjimky, ale vrátilo `CHANGES_REQUIRED` kvůli výše popsané legacy gateway
mezeře. Remediation přidává regresi, která vydá ordinary token o jeden nad
role ceiling, volá skutečnou `callWithAuth()` cestu a vyžaduje typed
`LLM_AUTHORIZATION_DENIED`, jediný audit `AUTH_TOKEN_POLICY_DENIED`, nula
provider volání a uvolněný semaphore. Po této změně M1 model contract prochází
32/32. Remediation potřebuje nové nezávislé re-review; původní verdikt se na ni
nepřenáší.

Úplný registrovaný deterministic gate na evidence HEAD `d2b03cc3` zahrnul
produktový candidate `dca0e89b` a skončil 352/352 PASS, bez FAIL, TIMEOUT,
BLOCKED nebo SKIPPED. Tento gate je integrační důkaz candidatu, ne jeho
nezávislé přijetí.

Tyto výsledky dokazují autoritní a fail-closed hranici bez modelu. Skutečný
původní cookbook na exact reviewed kandidátu musí teprve ověřit, zda 6000
vytvoří použitelný plný dokument a zachová všechny revizní požadavky. Do té
doby platí `MODEL_NOT_RUN` a žádná M6 acceptance.
