# WP-STUDIO-2-PRODUCTION — výchozí IDE 2.0 a Legacy

Autorita: výslovné zadání operátora 28. 9. 2026: „vše otestuj a pak nové IDE
dej do produkčního stavu a staré jako legacy“. Navazuje na WP-STUDIO-2,
ověřený balík `b0603b24` a Decision 049. Jde o lokální každodenní instalaci;
nezakládá attestaci veřejného releasu IntentSmith 1.0 ani přijetí M5/M6.

## Výstup a vlastnictví

- `scripts/{desktop-runtime,install-desktop}.mjs`: instalace AppImage, trvalý
  Node 24, samostatná volba Legacy nad jedním spravovaným backendem.
- `tests/{desktop-hunt,ide-workspace}.test.js`: skutečný výběr spouštěče,
  zachování profilu a politiky sandboxu, instalace a obnovení služby.
- `src/upgrade/model-failover.js` a `tests/m1-model-binding-repository.test.js`:
  zachování původního `applied_at` stejné vazby při restartu; živá migrační
  zkouška odhalila přepis času. Nová verification generace se nadále audituje.
- `intentsmith-ide/extensions/intentsmith-studio2/lib/browser/studio2-module.js`
  a `tests/helpers/studio2-ui-mode.js`: veřejné Theia API pro sbalení původních
  panelů po obnově rozložení; živé ověření uloženého panelu Problems a celé
  výšky nového UI. Prototyp ani generované React obrazovky se nemění.
- `intentsmith-ide/extensions/intentsmith-studio2/lib/browser/transport-adapter.js`
  a `tests/studio2-transport.test.js`: souběžné terminály nesmějí sdílet časový
  reqId původního nezměněného WS klienta; profil odkryl přechod hodin mezi
  kontrolou adaptéru a odesláním. Regrese vynutí tento přechod i předčasný timer.
- Tento WP, `docs/INSTALL.md`, `docs/studio2/PRODUCTION.md`, záznam
  nasazení v `docs/review/`, `ROADMAP.md` a `SYSTEM-MAP.md`.
- Instalovaný snapshot v `/mnt/vi7000/intentsmith/releases/<SHA>`, existující
  uživatelská konfigurace instalace a dvě desktopové položky. Produkční DB
  zůstává `/home/belphareon/Projects/intentsmith/data/c3.db`.
- Oprava nahlášená operátorem po nasazení: Electron `package.json`,
  `electron-builder.yml` a `scripts/electron-main.js` nastaví vlastní rám před
  vytvořením okna. `studio2-module.js` jej už nepřepíná po obnově rozložení.
  `studio2-electron-menu.js` ponechá Theia příkazy a vlastní restartové
  handlery, ale pro Studio 2 nesynchronizuje sdílené preference rámu Legacy.
  `tests/{studio2-view.test,studio-electron-boundary.e2e}.js`, helper
  `studio2-ui-mode.js` a skutečný AppImage ověří první i opakovaný start
  s uloženým nativním rámem, bez překrývajícího dialogu Restart.

## Ověření a nasazení

1. Ověřit součty balíku a zdrojový původ, kompletní L1 a Electron scénáře.
2. Z produkční DB vytvořit konzistentní soukromý backup; na kopii ověřit
   migrace, integritu, zachování historie a původních vazeb modelů.
3. Ve skutečném Electronu nad kopií provést chat se skutečným modelem,
   soubor/editor, M2 návrh/preview/schválení a SCM v testovacím projektu.
   Starý frontend ověřit proti stejnému novému backendu.
4. Uchovat předchozí konfiguraci a instalaci. Při neúspěšném startu obnovit
   předchozí službu; nově zapsaná data se nepřepisují starší zálohou.
5. Instalovat nový snapshot přes stávající desktopový instalátor, potvrdit
   zdraví, autorizaci, výchozí frontend a vlastní modelový turn. Staré UI
   zůstane zvlášť jako IntentSmith Legacy. Hunt hold/timer se zachová.

Stop podmínky: aktivní cizí GPU práce, neověřitelný backup/migrace, regrese,
neúspěšný start nebo překročení stávající bezpečnostní hranice. Známý Gate 0
FAIL se nevydává za PASS. Neprovádí se rotace modelů, změna jejich vazeb,
změna shellových práv ani odstranění staré instalace.
