# Studio 2 — skutečný build a balíček z 45caf5b5

**Datum měření:** 2026-10-01, 07:46–08:02 UTC.
**Zdroj:** `45caf5b54b78def257221ac2ab33a64031800813`.
**Rozsah:** [WP-STUDIO2-BUILD-PACKAGE](../wp/WP-STUDIO2-BUILD-PACKAGE-20261001.md).
**Výsledek autora:** `BUILD_PACKAGE_VERIFIED / NO_MODEL_UI_VERIFIED`.
**Nezávislé BUILD/PACKAGE identity review:** `REVIEW_PASS`.
**Review reportu a celého milníku:** `REVIEW_PENDING`. **Nasazení:** `NOT_DEPLOYED`.

## Identita a skutečné příkazy

Stávající staging checkout byl před přepnutím čistý detached `e5b9ca82`.
Byl přepnut na vlastní větev z přesného integračního SHA; žádný nový worktree.
Zdroj zůstal čistý po buildu, dist, vytvoření balíčku i všech runtime testech.
Změny tohoto commitu přidávají pouze WP a tento report. Samotný balíček nese
původní zdrojové SHA, nikoli následný dokumentační commit.

Použit Node `v24.21.0`, Yarn `1.22.22`, Theia `1.76.0`, React `19.3.0`,
Electron `42.11.3`. Yarn byl spuštěn jeho ověřeným lokálním entrypointem přes
Node 24; Corepack v kořeni respektuje root `packageManager: npm` a samotné
`--cwd` tento výběr nezmění.

```sh
NODE24=/home/belphareon/.nvm/versions/node/v24.21.0/bin/node
YARN122=/home/belphareon/.cache/node/corepack/v1/yarn/1.22.22/bin/yarn.js
"$NODE24" "$YARN122" --cwd intentsmith-ide build
"$NODE24" "$YARN122" --cwd intentsmith-ide/applications/electron dist
"$NODE24" scripts/package-studio2-ready.mjs "$PRIVATE_PACKAGE"
```

`PATH` obsahoval Node 24 jako první. Stdout/stderr všech běhů je v soukromých
lozích; skutečné exit codes jsou zachované v JSON, žádná pipeline je nezakryla.
Závislosti jsou vlastní fyzické reflink kopie, nikoli sdílené symlinky.
Lockfile a oba IDE manifesty shodné se zdrojem závislostí; 32 workspace
symlinků míří do lokálních extensions. Native Electron a SQLite mají jiné
inode než jejich zdroje.

| Krok na přesném source SHA | Exit / výsledek | Soukromý důkaz |
|---|---|---|
| `yarn --cwd intentsmith-ide build` | `0`, 3,078 s | `yarn-build.log`, `yarn-build-result.json` |
| Electron `dist` | `0`, 6,913 s | `electron-dist.log`, `electron-dist-result.json` |
| Existující package-ready script | `0`, 11,496 s | `package-ready.log`, `package-ready-result.json` |
| SHA256 všech 16 299 původních / 16 313 finálních souborů | `0`, před i po AppImage | `PACKAGE-VERIFY.json`, `PACKAGE-FINAL-VERIFY.json` |
| Skutečný Electron / Studio 2 DOM | `0`, 103,104 s | `electron-ui-result.json`, `electron-ui/studio-electron-boundary.json` |
| M2 composer / skutečný DOM | `0`, 84,647 s | `electron-m2-composer-result.json`, `electron-m2-composer/studio-electron-boundary.json` |
| SCM lokální efekty a zamítnuté plány | `0`, 9/9 | `scm.log`, `scm-result.json` |
| Izolovaný staging kontrakt | `0`, 13/13 | `stage-contract.log`, `stage-contract-result.json` |
| Skutečný AppImage z balíčku / backend z balíčku | `0`, první ~10 s / viditelné opakování ~13 s; oba čistě skončily | `APPIMAGE-NO-MODEL-SMOKE.json`, `APPIMAGE-NO-MODEL-VISIBLE-SMOKE.json` |

## Balíček a jeho původ

Soukromá cesta v tomto checkoutu:
`.intentsmith-artifacts/ide2-build-45caf5b5/package` (1,6 GiB).
`SOURCE.json` potvrzuje 3 103 ověřených trackovaných souborů, Node `24.21.0`
a přesný zdroj. Původ AppImage dokládá řízený build/dist a následné porovnání
obsahu, nikoli samotný text `SOURCE.json`.

- AppImage: **195 079 898 bajtů**.
- AppImage SHA-256:
  `40b016d0316d12aabcb55270d561de89a8058dbd7f21d597718907eee58aed57`.
- `SHA256SUMS` SHA-256:
  `8c94ac560d15642769b4ece6de69d48e2b9136ae7d1e531e88174fc5cc830d77`.
- Původní manifest před doplněním výsledků: 16 299 souborů, SHA-256
  `7584596079931a9e9795e9e915dc0307cb03e72768379fca14454676c574503d`;
  zachován jako `SHA256SUMS.ORIGINAL`. Finální balík má 16 313 položek: stejné
  runtime soubory plus pravdivý `TEST-RESULTS.json` a 13 důkazů v `evidence/`.
- Frontend bundle SHA-256:
  `f3ba860b7ae1e9b89c4382e56c40261dd993c1791f04f5e854d8af543c332011`.

`PACKAGE-CONTENT.json` dokládá přesnou shodu sedmi kritických souborů mezi
buildem, linux-unpacked a extrahovaným AppImage: frontend bundle, preload,
index, backend main, Electron main a obě spouštěcí/preload vrstvy. `asar` je
v přijaté konfiguraci vypnutý; ověřoval se skutečný `resources/app`.

Původní diagnostická kontrola požadovala také byte-for-byte zdrojový
`package.json` a skončila exit `1`. Zjištěný rozdíl je očekávané odstranění
`scripts` a `devDependencies` při balení; všechna ostatní pole včetně runtime
závislostí a entrypointu jsou přesně shodná. Tato diagnostická chyba není
skrytá ani vydávaná za chybu produktu. Dist log obsahuje varování
`unresolved deps`, vypnuté asar a hledání ikony; builder použil existující
ikonu v `resources`. Úspěšný skutečný AppImage startup dokládá jen zkoušenou
runtime cestu, nikoli funkčnost všech volitelných modulů.

## Co bylo pozorováno v rozhraní

Registrovaný Studio 2 test otevřel nový Electron a vlastní privátní backend,
HOME, DB, projects a profil v user/network namespace s loopbackem. Prošel
skutečný DOM, relace a jejich obnovení po reloadu, přepínání/limit pěti relací,
ochranu rozepsaného konceptu při limitu relací, katalogy, paleta, panel změn,
terminál a 11 motivů.
Síťové a capability hranice prošly; AppImage se v tomto scénáři nespouští,
testuje se sestavený Electron přímo. Sdílený M0 transportní probe provedl
pouze deterministickou aritmetiku; počet modelových požadavků během tahu byl
`0`. Není to důkaz přejímky přirozeného modelového CHATu.

Samostatný registrovaný M2 DOM scénář ověřil jediný autentizovaný draft
request a bezpečnou odpověď `503 / LLM_PROVIDER_UNAVAILABLE`, zachování
vstupu/fokusu, zrušení neplatného kontextu a nulové approval requests,
modelové požadavky a souborové efekty. **Neověřil úspěšný CODE draft ani
opravu projektu.** SCM 9/9 samostatně provedlo skutečné lokální stage/commit,
kontrolovalo přesný schválený plán, stale/forged odmítnutí, hook suppression,
policy, lock a restart recovery nad privátními projekty.

Navíc operační smoke spustil přímo ověřený AppImage z balíčku s
`--appimage-extract-and-run --disable-gpu`, Node/backend ze stejného balíčku,
novou privátní DB a profilem a další vlastní user/network namespace.
Ollama URL mířila na nedostupný namespace-local port 9. DOM ukázal pouze
Studio 2, správnou přesnou privátní backend URL a stav Připojeno. První
screenshot rychlého DOM probe zachytil loading overlay. Druhý samostatný
běh počkal na nezakrytý viewport pomocí stejného DOM guardu jako přijatý
Studio 2 test; `visibleStudio2: true` a výsledný screenshot ukazují skutečný
frontend. Oba běhy jsou zachované, druhý screenshot je ve finálním balíčku.
AppImage i backend skončily
exit `0`; portfile byl odstraněn. Manifest balíčku byl potom znovu plně ověřen.

Xvfb na stanici chybí. Testy použily existující display `:0` a dočasnou
privátní kopii XAUTHORITY; CDP se připojovalo pouze k novému vlastnímu procesu.
Neproběhly interakce s cizí instalací. Kopie XAUTHORITY byla po bězích smazána.
Produkční DB/služba, role/bindingy a Ollama nebyly těmito běhy měněny.
Probes použily `NODE_ENV=test` a `--no-sandbox`; nejde o přejímku běžné
produkční konfigurace. Raw logy zachovávají D-Bus chyby, focus varování,
`inotify_init: Too many open files` a `/api/agents` 501 při vypnutých agentech.
Výsledek vymezených DOM/startup kontrol tyto provozní poznámky neskrývá.

## Nezávislá kontrola identity

Reviewer `/root/full405_diagnosis/ide2_package_identity_review` nezávisle
porovnal všech 3 103 zabalených trackovaných souborů přímo s Git bloby
source SHA, celý sealed manifest, sedm hlavních runtime souborů a úplný
obsah 30 souborů v lib/scripts/resources včetně native modulů. Zabalený Electron
a Node jsou bajtově shodné s použitými build runtime. Balíček a jeho
resources/app neobsahují symlinky. Závěr: **REVIEW_PASS pouze pro
BUILD/PACKAGE identity**. Posudek není přejímka CHATu ani releasu.

## Zbývající práce a přejímka

1. Nezávisle zkontrolovat přesný balíček a tento report, předat integračnímu
   vlastníkovi; dokumentační commit sám balíček nemění.
2. Modelový CHAT, VAT, 53×3 a kontextové testy dokončí jiný worker.
3. Celý připravený GPU/uživatelská-data stage, úspěšný modelový M2 projekt
   v AppImage, obnova skutečných dat, Legacy srovnání a mobilní klient
   zůstávají mimo provedený rozsah. Jejich historické `NOT_RUN` se nemění.
4. Nasazení a release přejímka zůstávají samostatné rozhodnutí. Tento report
   neoznačuje produkt ani release za přijatý.

Soukromé logy, DB, balíček a screenshoty zůstávají v ignored artifacts a
nepatří do pushovaného zdrojového repozitáře. Root obdrží přesné cesty a
identity. Tracked změny jsou omezené na WP a report.
