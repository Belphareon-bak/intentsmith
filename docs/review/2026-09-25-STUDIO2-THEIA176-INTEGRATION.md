# Studio 2.0 — migrace hostitele, izolovaný integrační kandidát

Datum: 2026-09-25. Větev: `codex/studio2-integration-20260925`.
Základ: `2db40a40` (sloučená linie nasazeného Studia, huntu a kontraktu).
Stav: **S2-U ověřený integrační kandidát; Studio 2 UI ještě neimplementováno ani nenasazeno.**
Tento běh není fresh-clone atestace ani nezávislé review.

## Rozsah a důvod

Operátor upřesnil, že se v jeden okamžik smí připojit nejvýš jedno UI;
po prokázání správných funkcí nové UI klasické úplně nahradí. Dále požádal
o nejnovější kompatibilní Theiu a React. Kontrakt v `docs/wp/WP-STUDIO-2-20260925.md`
a Decision 049 zachycuje obě podmínky. S2-0 musí volbu vyhodnotit **před
načtením** klasického `chat-panel-module.js`: tento modul už při vyhodnocení
spouští transport, časovače a odběry; pozdější skrytí widgetu by zanechalo
aktivní druhé UI. Přepnutí může provést restart rendereru, pokud žádný okamžik
neobsahuje dva připojené režimy a obnovený layout znovu nepřipojí starý widget.

## Implementace S2-U

- Theia 1.74.1 → 1.76.0 v celém workspace, React a typy → 19.3.0, Node engine
  `>=24 <25`, `.nvmrc` 24.21.0. Nástrojové Node 24.21.0 je izolovaně v `/tmp`;
  systémová instalace se neměnila.
- Theia 1.76 generuje esbuild místo webpacku. Tracked `esbuild.mjs` kontroluje
  přesné vstupy a zachovává lokální HTTP bootstrap, normalizaci Electron Origin
  a preload byte bridge. Kontrola výsledného buildu ověřuje i spustitelný ripgrep.
- Klasický React widget používá `createRoot` z React 19. Transport a M1
  protokol se nepřepisovaly.
- Zastaralý vizuální M2 test vytvořil nový projekt, který nyní automaticky
  obsahuje Git a politiku M2. Proto očekával odmítnutí chybějící politiky,
  ale server korektně došel až k nedostupnému modelu. Scénář nyní registruje
  existující prázdnou složku přes `open-folder`; její obsah se nemění.

## Ověření

- `corepack yarn install --frozen-lockfile --offline` a `corepack yarn build`:
  **PASS** v izolovaném worktree pod Node 24.
- `m1-studio-client`: 141/141; `ide-workspace`: 29/29;
  `m5-install-profile`: 10/10; `studio-electron-runner-contract`: 27/27;
  `schema-migrations`: 61/61; `repository-hygiene`: 2 833 cest — **PASS**.
- Skutečný Electron boundary journey na `2cfc17bf`: **PASS**. Ověřil
  `403/403/200` pro hranici, M1 terminál, byte bridge, nulový externí síťový
  provoz a čisté ukončení. Tento základní scénář sám nehodnotí DOM.
- Skutečný DOM journey na `06ff837d`: **PASS**. Vykreslení a ovládání M2
  formuláře, invalidace kontextu, zachování vstupů a chatu, přesné tělo
  požadavku, `503 M2_LIFECYCLE_POLICY_UNAVAILABLE`, žádné schválení,
  žádné volání modelu, žádné soubory zapsané v projektu. Síťová hranice
  znovu `403/403/200`, čisté ukončení. Artefakt:
  `.intentsmith-artifacts/studio2-theia176-composer-06ff837d/studio-electron-boundary.json`.
- `electron-builder --linux --dir`: dokončen. Zabalený Electron pod
  `ELECTRON_RUN_AS_NODE=1` hlásí Node 24.19.0, zabalený ripgrep je
  spustitelný (`15.0.0`). Zabalená aplikace zatím nebyla spuštěna jako GUI;
  GUI journey použil produkční build z worktree. Builder hlásil varování
  o asar a nevyřešených workspace závislostech, které vyžaduje ověřit při
  distribučním testu, i když build skončil kódem 0.
- `git diff --check`: **PASS**. Základní profil 366 PASS / 1 FAIL z předání
  nebyl znovu proveden; Gate 0 pečeť ani širší regresní profil zde nemají
  nové atestační tvrzení.

## Další práce

S2-0: inventura viditelných rozšíření, nový widget a přepínač s bránou před
načtením klasického modulu; test startu, obnoveného layoutu i přepnutí bez
dvojího UI. Následují S2-1 až S2-7 a parita před odstraněním klasického UI.
