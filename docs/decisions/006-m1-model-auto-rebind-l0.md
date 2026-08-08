# 006 — automatický model rebind zůstává blokovaný rozhodnutím L0-9

- **typ:** BLOCK
- **WP:** WP-M1-MODEL
- **rail:** R1 USER_AUTHORITY, R3 OBSERVABLE_BEHAVIOR, R6 REVERSIBILITY
- **vzniklo při:** read-only call-graph kontrole `src/upgrade/model-registry.js:checkBindingIntegrity()`

## Evidence na stole

Model registry umí při periodické kontrole nahradit chybějící role binding a
zapsat jej do persistentních overrides. To je přesně oblast L0-9: změna modelu
bez potvrzení uživatele není povolena. WP-M1-MODEL smí ověřit a zpřesnit request
hranici, ale nesmí změnit L0 invariant ani online upgrade automatiku.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — fail closed a vyžádat approval | Kontrola pouze navrhne rebind; persistentní změna čeká na vlastníka | Odpovídá L0-9, ale potřebuje approval connector, který M1 nevlastní | `src/upgrade/model-registry.js`, approval hranice a nové negativní/restart testy |
| B — zachovat automatický rebind | Periodická kontrola smí změnit binding bez operátora | Porušuje aktuální L0-9 | Žádná implementační cena, ale vyžaduje výslovnou změnu `CONTRACT.md` operátorem |
| C — periodickou kontrolu vypnout | Žádná automatická oprava ani návrh | Bez neautorizované změny, ale ztráta self-healing chování | `src/upgrade/model-registry.js`, startup/periodic testy a provozní dokumentace |

## Vzatý default a proč

Žádný. Dotčená část je **BLOCK**. Současný gateway checkpoint se automatického
rebindu nedotýká a pokračuje nezávisle.

## Šev

Po operátorském rozhodnutí je technický šev
`src/upgrade/model-registry.js:checkBindingIntegrity()`. Rozhodnutí samotné ale
mění L0, proto nesmí být přijato autonomně.

## Cena přepnutí, když operátor rozhodne jinak

Varianta A vyžaduje nejméně model registry, nový approval adaptér a tři negativní
scénáře (bez approval, expirovaný approval, restart). Varianta C mění model
registry a jeho startup/periodic acceptance testy. Varianta B nemá legitimní
implementační cestu bez operátorské změny kontraktu.
