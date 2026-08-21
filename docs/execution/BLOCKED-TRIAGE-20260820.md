
---

## Oprava odhadu, 2026-08-21 — „hodiny a gigabajty" bylo špatně

Sekce výše tvrdí, že postavit Studio artefakty znamená „hodiny a gigabajty".
Operátor to označil za špatný odhad a **měření mu dalo za pravdu**:

| | Odhad výše | Změřeno na `fb028140` |
|---|---|---|
| `yarn install --offline --frozen-lockfile` | „hodiny" | **5 s** |
| `yarn build` | | **49 s** |
| Celkem | | **54 s** |
| `c3-ide/node_modules` | „gigabajty" | **913 MB** |

Rozdíl je v cache. Odhad počítal se studeným startem; tahle stanice má
yarn cache 1,2 GB a Electron binárku 320 MB už staženou, takže install je
rozbalení, ne stahování. Původní odhad se neměřil.

**Všech šest artefaktů `assertBuildPresent()` je postavených.** Sada se tím
posunula ze tří `BLOCKED` důvodů na skutečný `FAIL`:

```
studio-production-build-missing  → build hotov
artifact-root-missing            → INTENTSMITH_TEST_ARTIFACT_DIR (mode 0700)
source-revision-missing          → INTENTSMITH_TEST_SOURCE_REVISION
→ STUDIO_ELECTRON_BOUNDARY_FAIL electron-exited-before-cdp
```

Backend uvnitř network namespace naběhl správně (`C3_READY`, scheduler,
Ollama 503 protože namespace nemá síť — tak to má být). Spadl Electron:

```
Failed to connect to the bus: Did not receive a reply
Electron exited with signal SIGTRAP
```

Je to ten `SIGTRAP`, který `SYSTEM-MAP` vede jako „dřívější pre-CDP residual".

Vyloučeno měřením: `--no-sandbox` se předává (řádek 1494 sady) a Electron
binárka běží **uvnitř i vně namespace** (`v22.17.0` obojí). Není to tedy
binárka ani izolace; rozbíjí se až spuštění okna. Neověřená hypotéza:
kontence o GPU (souběžně běžela vlna modelových E2E sad).

**Sada zůstává `BLOCKED` v registru** — teď už ale ne kvůli chybějícímu buildu.
