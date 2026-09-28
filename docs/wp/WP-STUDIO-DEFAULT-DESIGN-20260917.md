# Studio: výchozí vizuální identita IntentSmith

Autorita: explicitní zadání operátora 2026-09-17 a operátorem dodané
`IntentSmitg Logo.png`. Vstupní revize: `4fca7e67`, která zachovává geometrii
levého i pravého panelu. Tento Work Package na panelovou opravu navazuje; nemění
její lifecycle ani velikosti.

1. **Uživatelský výsledek:** nový nebo resetovaný profil otevře profesionální,
   přehledné a decentní tmavé Studio v barvách loga IntentSmith: černé vrstvené
   plochy, teplý zlatý brand accent, světlý text a samostatné sémantické barvy.
2. **Povolené cesty:** autoritativní
   `c3-chat-panel/lib/browser/chat-panel-module.js`, jeho runtime
   `styles/c3-theme.css`, cílená Studio regrese a tento assignment.
   **Zakázané:** archivní TypeScript/Tailwind prototyp, backend, connector,
   persistence, síťová policy, panelová geometrie a generování nového loga.
3. **Connector:** žádný. Jde pouze o renderer tokeny, chrom, viditelné
   pojmenování a výchozí volby vzhledu.
4. **Závislosti:** `4fca7e67`; existující transparentní monogram je už odvozený
   ze stejného operátorského PNG a zůstává jediným obrazovým assetem.
5. **Demonstrace:** produkční Electron v čistém privátním profilu zobrazí
   značku IntentSmith a brand paletu v levém panelu, středu, chatu, spodních
   panelech a status baru; oba postranní panely zůstanou viditelné a ovladatelné
   po startu, navigaci a reloadu.
6. **Test:** pozitivně připnout výchozí brand tokeny a viditelné pojmenování;
   negativně zachovat červenou chybu, zelený úspěch, modrou informaci a
   panelovou lifecycle regresi z `4fca7e67`.
7. **Stop:** změna by vyžadovala nový asset, archivní source, veřejný connector,
   přepis uživatelské uložené volby nebo zásah do cizího checkoutu/procesu.
8. **Ověření:** `node tests/m1-studio-client.test.js`; produkční
   `cd c3-ide && corepack yarn build`; privátní Electron DOM/screenshot probe;
   `node scripts/validate-test-registry.js`.

Výstup je implementační kandidát k vizuálnímu přijetí operátorem, nikoli nový
M1/M6 acceptance verdikt.

## Výsledek implementace

- Výchozí runtime paleta: canvas `#09090b`, text `#f4f1ea`, brand accent
  `#d4a85f`, accent text `#e7c27a`, text na accent ploše `#17120a` a nezávislý
  success `#5ecf91`. Kontrast je připnutý testem: primární text, accent i text
  na accent ploše nejméně 7:1; tlumený text nejméně 4,5:1.
- Levá navigace má zřetelnou brand hlavičku, teplé aktivní stavy a decentní
  dvoupixelový inset indikátor bez změny geometrie. Stejná paleta platí pro
  welcome, chat, editor chrome, spodní panely, status bar, formuláře a akce.
- Viditelné `C3` pojmenování chatu, příkazů a widgetů je nahrazené
  `IntentSmith`; interní `c3:*` identifikátory zůstaly kvůli kompatibilitě.
- Úspěch, chyba, varování a informace zůstávají samostatné sémantické barvy;
  zelená už není výchozí brand ani výběrový stav.

## Ověření 2026-09-17

- `node tests/m1-studio-client.test.js`: **128 PASS / 0 FAIL / 0 SKIP**.
  Součástí je lifecycle regrese panelů z `4fca7e67` i nový brand/kontrast test.
- `cd c3-ide && corepack yarn build`: **PASS**;
  `STUDIO_M1_BUILD_CONSUMER_PASS`, produkční bundle SHA-256
  `346d42f93b60104203b6d825153452b4e1d65d66952f17dd826c3d0df20858f5`.
  Webpack ohlásil pouze existující performance warnings na velikost bundleů.
- Privátní Electron/CDP probe na zdroji SHA-256
  `e15b9298a891edd59b9269cdca0129c5348828c514b2b923d70a003a8faa42ea`:
  **PASS** na `startup`, `settings` i `reload`. Levý rodič měl 240 px, pravý
  416 px; oba widgety byly ve viewportu a hit-testovatelné, chat input byl
  ovladatelný a všech pět výchozích tokenů odpovídalo po každém checkpointu.
- Screenshoty a JSON důkaz jsou mimo git worktree v
  `/home/belphareon/Projects/intentsmith-default-design-20260917-evidence/`.
- Probe zaznamenal 9 síťových 500/501/404 událostí pro expertises, agents a
  media history, protože byly tyto služby v izolovaném backendu explicitně
  vypnuté. Nejsou vydávány za čistý systémový runtime ani skryté jako PASS.

Stav: **IMPLEMENTATION_VERIFIED / VISUAL_ACCEPTANCE_PENDING**. Vizuální přijetí
operátorem a integrace do společné větve jsou stále samostatné kroky.
