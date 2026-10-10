# Důkazy nastavení V4 — 3c804a8a

[Report](../../settings-v4-completion-20261010.md) a [galerie](../../settings-v4-completion-20261010.html).
Nativní snímky jsou ze skutečného AppImage, vlastního backendu/DB/profilu a skutečných místních Ollama metadat. Repozitář a SSH soubory jsou vlastněné testovací fixture, nikoli ověření připojení GitHubu. Zkouška nedělá inference ani externí doručení. `primary-*.png` jsou samostatné snímky skutečné hlavní instalace přes běžný launcher bez CDP, s původním profilem a motivem. Zápisy do provozních účtů/Hunt profilů se při těchto snímcích nedělaly.

`native-probe.mjs` je použitá ruční sonda; při publikaci se upravila jen hloubka relativního importu helperu. Spouští se z kořene checkoutu po reprodukci příslušného AppImage a s Node 24. Vyžaduje vlastní X11 display, Ollama metadata a závislosti IDE; použije privátní DB/profil, jejichž procesy uklidí. Výsledek na jiném zdroji je nový výsledek, nikoli zopakování této identity.

```sh
node docs/review/evidence/settings-v4-completion-20261010/native-probe.mjs
```

`audit-failed-8ffc1778.json` a `audit-interrupted-8a66d331.json` jsou diagnostické neúspěšné/přerušené běhy. Nejsou součástí finálního PASS. Původní Opus posudek platí pouze pro uvedený starý source. Nová nezávislá revize a release přejímka jsou pending.

Souborové otisky jsou v `MANIFEST.json`. Privátní DB, profile backup, environment, capability/tokeny a AppImage runtime log se nepublikují.

Publikované textové logy mají odstraněné koncové mezery a nadbytečné prázdné řádky na konci. Raw originály zůstávají v ignorované složce zkoušky; manifest popisuje publikované soubory.
