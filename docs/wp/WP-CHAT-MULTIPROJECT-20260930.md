# WP — živá izolace kontextu více projektů

**Stav:** implementační kandidát; modelový běh `NOT RUN`, přejímka otevřená.

**Autorita:** explicitní zadání operátora z 2026-09-30 připravit a skutečně
ověřit chat na různých projektech. Navazuje na produktové projektové konverzace
v `PRODUCT.md` a existující registrovaný test
`IS-T3-E2E-77-PROJECT-CONTEXT-INJECTION`. Tento dokument neurčuje nové
produktové chování.

**Vstup:** ověřený `origin/main` `838b8cee038db027691072d293eb00153854f81e`.
Vlastní branch `work/real-chat-journeys-20260930` a vlastní checkout. Ostatní
živé worktree jsou chráněné nebo užívané; před vytvořením tohoto souběžného
checkoutu workspace-budget report neukázal bezpečně odstranitelný worktree.

**Výsledek pro uživatele:** chat navázaný na projekt A při střídání s projektem
B vrátí aktuální obsah projektu A a ve své odpovědi neuvede obsah B. Nenavázaný
chat nevrátí obsah žádného z nich. Ověření pokrývá také persistovanou vazbu
konverzace a čerstvé načtení změněného README.

**Rozsah a vlastnictví:** `tests/e2e/77-project-context-injection.e2e.js`,
`tests/project-collaboration.test.js` a tento WP. Žádná změna chatového
konektoru, registru, GPU hunt, model bindings, produkční DB nebo běžící služby.
Oprava auto-contextu běží odděleně.

**Demonstrace a test:** registrovaný modelový test vytvoří dva soukromé
projekty s různými interními kódy, zavolá skutečný HTTP chat v pořadí A–B–A,
před třetím voláním změní README projektu A a zkontroluje přesnou odpověď,
nepřítomnost starého a cizího kódu, režim `project` a uloženou projektovou
vazbu. Stávající negativní větev zkouší konverzaci bez projektu.
Deterministický test používá skutečný `inspectProject()` a
`fitProjectDiscussionPrompt()` na různých adresářích a kontroluje obsah
sestaveného promptu. Nezachycuje vlastní síťový požadavek providera.
Provedení:

```sh
node --test tests/project-collaboration.test.js
node scripts/run-suites.js --suite=IS-T3-E2E-77-PROJECT-CONTEXT-INJECTION --keep-run-root
```

Runner musí mít vlastní izolovaný server a dostupný přesně připnutý model.
GPU se smí použít až po skončení cizího hodnocení a po kontrole globálního
zámku, Ollamy a NVIDIA procesů. Před tím lze ověřit syntaxi, registry a
deterministický test promptu; tyto výsledky nejsou důkazem odpovědi modelu.
Neúspěšná konkrétní odpověď je
`FAIL`, chybějící prerekvizita `BLOCKED`, nespuštěná sada `NOT RUN`.
Deterministický projektový test na Node 24 prošel 2026-09-30 v tomto checkoutu
`30/30`; modelový běh je stále `NOT RUN`.

**Stop condition:** zapsat konkrétní selhání i důkazní artefakt, nezměnit
`lastGreen` ani `state` registru z lokálního běhu; nezaměnit tento HTTP test za
Studio DOM, důkaz nulového úniku ve skutečném provider payloadu nebo finální
release akceptaci. Po izolovaném běhu následuje nezávislé review a integrovaný
test na společném kandidátu.
