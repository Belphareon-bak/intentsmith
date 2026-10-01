# IDE 2.0 — izolovaná přejímka kandidáta

Autorita: požadavek operátora dokončit IDE 2.0 a backend po milnících,
ověřit funkční hodnoty na reálných datech a teprve potom řešit mobilní klient.
Výchozí integrační commit tohoto kandidáta je `2477c8a2`. Zdroj finálního
balíku se určí až po integraci a zmrazení čistého commitu. Historická přejímka
`c84b88cd` z 28. 9. je vzor scénáře, nikoli výsledek nového kandidáta.

## Rozsah a vlastník

Vlastněné soubory: `scripts/studio2-isolated-stage.mjs`,
`scripts/studio2-isolated-stage-contract.mjs`,
`tests/studio2-isolated-stage.test.js`, příslušný záznam v `tests/registry.json`
včetně generovaného `docs/convergence/TEST-REGISTRY.md`, aktualizované počty
v `README.md` a `SYSTEM-MAP.md`, a tento WP. Soukromý výstup přejímky vznikne až při výslovném živém běhu v
novém `--trial-root`. Produkční DB, systemd služba, nainstalovaný frontend,
zdroj Legacy, absolutní cesty importovaných projektů a vazby produkčních
modelů zůstávají mimo oprávnění testu. Žádný pull modelů ani změna bindingů.

## Kontrakt před spuštěním

1. Zmrazit čistý zdrojový commit. Z téhož commitu sestavit Electron/AppImage a
   vytvořit balík přes `scripts/package-studio2-ready.mjs` v Node 24. Zaznamenat
   příkaz, commit, čistý Git status před/po buildu, SHA AppImage a `SOURCE.json`.
   `SOURCE.json` samotný není kryptografický důkaz původu AppImage; vztah
   zaručuje řízený build a jeho log. Balík musí být soukromý, kompletní a
   zapečetěný `SHA256SUMS`.
2. Předat skutečnou produkční SQLite DB jako zdroj pouze pro čtení, čistý
   detached Legacy checkout a jeho spustitelný Node, přesné očekávané SHA a
   dosud neexistující soukromý trial root. Krátká cesta (`trialRoot/tmp` nejvýše
   72 bajtů) předchází limitu Unix socketů Chromium. Příkaz bez `--live` jen kontroluje
   soubory a neotevře DB writer, nespustí Ollamu/GPU ani nic nevytvoří.
3. Živý běh vyžaduje současně `--live --gpu-authorized` a operátorem zvolený
   `--min-free-vram-mib`. Jen serializované GPU okno bez cizího NVIDIA compute,
   bez načteného modelu v Ollamě a s dostatkem VRAM pro konkrétní model. Script
   kontroluje stav před kopírováním i před vlastní GPU lease. Startovní ověření
   modelových vazeb v backendu používá svůj vlastní sdílený GPU zámek; po jeho
   dokončení runner vyčká na uvolnění načtených modelů a získá zámek pro
   modelový chat a M2. Timeout, cizí provoz
   či nedostatek paměti jsou `FAIL/BLOCKED`, nikoli úspěch.

Příklad příkazu pro **read-only dry run** po vytvoření balíku (proměnné musí
obsahovat ověřené absolutní cesty a plné SHA, nepřejímají se ze starého
paketu):

```sh
"$PACKAGE/runtime/bin/node" "$PACKAGE/source/scripts/studio2-isolated-stage.mjs" \
  "--package=$PACKAGE" "--db=$PRODUCTION_DB" "--trial-root=$NEW_TRIAL_ROOT" \
  "--legacy-source=$LEGACY_SOURCE" "--legacy-node=$LEGACY_NODE" \
  "--expected-source=$FROZEN_SOURCE_SHA" \
  "--expected-appimage=$APPIMAGE_SHA256" "--expected-legacy=$LEGACY_SHA"
```

Očekávaný výsledek dry runu je `READY_FOR_SERIAL_LIVE_STAGE` a neexistující
trial root. Přidání `--live --gpu-authorized --min-free-vram-mib=N` je oddělený
operátorský krok po dokončení review a uvolnění GPU. N musí být alespoň 1024,
ale skutečnou hodnotu stanoví operátor podle změřené potřeby vybraného modelu.

## Živá přejímka na soukromé kopii

- `better-sqlite3` vytvoří konzistentní online backup produkční DB v privátním
  adresáři. Dokončený backup je výchozí snímek; zdroj může během kopírování
  přijmout jiné zápisy. Samostatná kopie projde migracemi, `quick_check`,
  `foreign_key_check` a porovnáním původních řádků v konverzacích, zprávách,
  projektech, expertízách, modelových vazbách a evaluacích. Nové sloupce jsou
  přípustné, ztráta nebo změna původního pole je chyba.
- Soukromý backend z balíku běží na vlastní lokální port a DB. Runner čeká na
  zdravý backend a dokončení startovních ověření vazeb. Produkční MainPID
  přečte před/po; službu nestartuje ani nezastavuje.
- Ještě před spuštěním backendu musí migrační kopie prokázat nulové importované
  automatické SCM fetch/pull politiky, nulové neukončené M2 lifecycle operace
  a nulové nedořešené modelové pull operace. Produkční server totiž umí tyto
  práce obnovit sám při startu nebo periodicky; jejich původní cesty a modelové
  operace nesmějí uniknout z izolované přejímky. Chybějící tabulka nebo nejasný
  stav blokuje start místo tiché sanace kopií.
- Endpoint `POST /api/projects` založí nový projekt v `trial/home/projects`.
  Reálná cesta se ověří před každým M2/SCM efektem. Záznamy importovaných
  projektů s absolutními původními cestami se pouze kontrolují v DB, nikdy se
  pro M2 ani SCM nevyberou.
- Skutečný AppImage otevře Studio 2 a přes jeho DOM odešle M1 dotaz do nové
  konverzace. Přijetí vyžaduje přesnou shodu privátní backend URL z preloadu,
  textovou odpověď s markerem, režim Studio 2,
  nepřítomnost klasického panelu a v kopii DB přesnou uživatelskou zprávu a
  pozdější přesnou asistentskou odpověď v téže nové konverzaci a projektu.
- M2 vytvoří návrh opravy chybného `mul(a,b)`, zachová soubor před schválením,
  zobrazí diff, schválí ho a ověří výsledek na nule, záporných i desetinných
  hodnotách. SCM na témže novém projektu provede stage, commit, větev a
  prokáže zamítnutí nepovoleného push.
- Po zavření AppImage se spustí **samostatný** frontend Legacy z přesného
  čistého commitu proti stejnému soukromému backendu. Musí ukázat klasický
  panel bez Studio 2 a shodnou backend URL. Finální DB znovu projde integritou, zachováním původních
  řádků a vazeb, s povolenými novými testovacími řádky a přechodem stavu
  verifikace modelů.

Výstup `result.json` je od počátku `FAIL`; na `PASS` přejde až po všech krocích.
`manifest.json` obsahuje SHA-256 souborů soukromého paketu, exact source,
AppImage a Legacy identity. Oba vždy nesou `independentReview: REVIEW_PENDING`
a `publicReleaseAttested: false`. Screenshoty, logy a kopie DB zůstávají v
režimu 0700/0600; nejsou určené k pushi. Živý `PASS` ještě vyžaduje
nezávislou revizi a samostatné rozhodnutí o nasazení.

## Ověření této přípravy

Read-only kontrola produkční `data/c3.db` při přípravě 1. 10. 2026 našla všech
sedm `model_overrides` v `FAILED` (`verified=0`), včetně CHAT a CODE.
Poslední pokus každé vazby je `STARTUP_REHYDRATE / FAILED` s kódem
`MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE` z 29. 9. 2026 18:10 UTC.
Read-only `/api/tags` nyní obsahuje všechny čtyři jmenované modely a jejich
digest odpovídá DB; to samo neověřuje inference ani durable stav vazeb.
Nová soukromá přejímka proto musí ukázat úspěšné obnovení přesných artefaktů
a `VERIFIED`; do té doby je modelový krok **předpoklad, ne PASS**. Tento záznam
nemění produkční DB ani vazby.

Red-first: před vytvořením kontraktového modulu test padl na
`ERR_MODULE_NOT_FOUND`. Po implementaci musí projít kontrakty pro přesnou
identitu, utěsnění všech souborů, neexistující trial root, symlinky,
oddělený projekt, zachování dat a skutečnou CLI dry-run cestu:

```sh
node tests/studio2-isolated-stage.test.js
node scripts/validate-test-registry.js --json
node tests/artifact-validation.test.js
git diff --check
```

Nezávislá kontrola `549fc8e5` požadovala opravit tři mezery: pouhá existence
konverzace nedokazovala uložený chat; importovaná automatická SCM politika
mohla po pěti minutách spustit fetch/pull na původní cestě projektu; a zděděné
`GIT_DIR`/`GIT_WORK_TREE` mohly podvrhnout čistotu Legacy checkoutu. Navazující
kontrola startup call graphu našla i obnovu schválené neukončené M2 práce a
modelových pull operací. Pro každou cestu je nyní offline kontrakt; live stage
zůstává **NOT RUN** a změna čeká na opětovné nezávislé review.

Historický stav při předání tohoto kandidáta: **OFFLINE_CONTRACT_VERIFIED /
PHYSICAL_GPU_STAGE_NOT_RUN / REVIEW_PENDING**. Teprve nový balík ze
zmrazeného integračního SHA, skutečný AppImage běh a posouzený výstup mohou
změnit stav produkční přejímky.

Offline příprava `e5b9ca82` získala nezávislé **REVIEW_PASS**. Širší profil
integrovaného `6d16e3f8` následně našel chybějící statický isolation bootstrap
tohoto testu. Bootstrap nyní izoluje HOME, Git a runtime; vlastní kontraktové
fixture používají atomicky vytvořenou soukromou krátkou cestu v `/tmp`, aby
nadále prověřily limit Chromium socketu a všechny následující path guardy.
Kontrakty prošly **13/13**. `harness-exit-code` také prošel po doloženém
přepočtu databázového import grafu z 140 na 141: jediným novým kořenem je
`chat-history-order.test.js`, všechny kořeny mají isolation boundary.
Fyzická přejímka IDE 2.0 zůstává **PHYSICAL_GPU_STAGE_NOT_RUN**.
