# Studio: Kubuntu desktop launcher a viditelný Appearance režim

Autorita: hlášení operátora 2026-09-17, že instalovaná aplikace neukazuje nový
vzhled a spuštění z nabídky Kubuntu končí bez okna; stejný symptom byl dříve u
ShellSmithu. Výchozí revize integrační větve: `fce4f055` (instalovaná revize
`3f005fc0` je její předek bez rozdílu v dotčeném runtime kódu).

1. **Uživatelský výsledek:** Appearance obsahuje samostatnou volbu
   `IntentSmith — Výchozí brand`, nový profil ji zvolí automaticky a launcher
   z nabídky buď otevře Studio, nebo před oslabením Chromium sandboxu zobrazí
   konkrétní volbu a bezpečnější trvalý postup.
2. **Povolené cesty:** autoritativní Studio renderer a jeho cílený test,
   desktop runtime/instalátor, desktop test, dokumentace a tento WP.
   **Zakázané:** backendové API, DB, modely, GPU/hunt, panelová geometrie,
   ShellSmith a cizí pracovní checkouty/procesy.
3. **Bezpečnostní kontrakt:** `--no-sandbox` se nikdy nepřidá tiše. Je povolen
   pouze explicitním environment override nebo privátním markerem vytvořeným
   po potvrzení uživatele. Setuid root helper nebo odpovídající AppArmor profil
   fallback vypne. Odmítnutí nesmí spouštět Electronový error dialog, který by
   selhal na stejném sandboxu.
4. **Instalace:** změna se registruje pouze z čistého detached snapshotu přes
   `scripts/install-desktop.mjs`; aktivní hunt se nepřerušuje. Existující DB se
   před migrací zálohuje a zůstává explicitně svázaná s instalací.
5. **Test:** cílený desktop test pokryje detekci, potvrzený/uložený fallback,
   explicitní jednorázový override a vygenerovaný profil. Studio test připne
   samostatné ID vzhledu, jeho label a výchozí volbu nového profilu.
6. **Ověření:** cílené testy, celý Studio klientský soubor, produkční build,
   čistota worktree, dry-run instalátoru, kontrolovaný apply a start přes
   registrovaný desktop launcher.
7. **Stop:** cizí aktivní hunt, neočekávaná DB/revize, nečistý snapshot,
   neověřený backend po instalaci nebo nutnost měnit systémový `/etc` bez
   výslovné správní akce uživatele.

Stav před implementací: **IN_PROGRESS**. Hlášení operátora je důkaz, že
předchozí `IMPLEMENTATION_VERIFIED / VISUAL_ACCEPTANCE_PENDING` nebylo
integrované ani nasazené; proto se nevydává za dostupný produktový vzhled.

## Ověření kandidáta

- `node --test tests/desktop-hunt.test.js`: **11/11 PASS**; zahrnuje potvrzený
  a zapamatovaný Kubuntu fallback, explicitní jednorázový override, mód `0755`
  launcheru a obnovu obecné i KDE desktop cache.
- `node tests/m1-studio-client.test.js`: **131 PASS / 0 FAIL / 0 SKIP** po
  produkčním buildu; samostatná volba `intentsmith`, volba `clean`, viditelný
  nadpis a výchozí ID jsou připnuté testem.
- `cd c3-ide && corepack yarn build`: **PASS** s pouze existujícími webpack
  upozorněními na velikost; bundle SHA-256
  `be5b698e73983140066e37e0b84fe63b61d72d84da6862d264dc95c42a35837b`.
- `apparmor_parser -Q -T`: **PASS** nad vygenerovaným profilem; test registry
  platný pro 523 spustitelných programů; `git diff --check`: **PASS**.

## Nasazení a živé ověření

- Čistý detached snapshot `fdfbc54e100d192b0acf53a474892863b41a08ce`
  byl nasazen autoritativním installerem nad původní DB a zachovaným PDF
  Pythonem. Backup před migrací:
  `/home/belphareon/.local/state/intentsmith/installation-backups/2026-09-17T15-03-27-146Z`.
- Installer obnovil `update-desktop-database` i `kbuildsycoca5` bez varování;
  launcher má mód `0755`. `gtk-launch intentsmith.desktop` skutečně spustil
  Electron z revize `fdfbc54e`, backend handshake i Studio startup doběhly.
- Živý DOM důkaz: `mode=intentsmith`, volby `IntentSmith` i `Clean` jsou
  viditelné, brand tokeny jsou `#d4a85f`, `#e7c27a`, `#17120a` a success
  `#5ecf91`; levý panel 240 px, pravý 416 px. Screenshot a JSON jsou mimo git v
  `/home/belphareon/Projects/intentsmith-design-launcher-20260917-evidence/`.
- Systémový AppArmor profil nebyl nainstalován, protože neinteraktivní `sudo`
  není dostupné. Trvalý `allow-no-sandbox` marker nebyl vytvořen. Běžný první
  start proto zobrazí volbu: správní instalace přesného profilu, nebo výslovně
  potvrzený fallback bez Chromium sandboxu. End-to-end test menu použil pouze
  jednorázový environment override.

Stav: **DEPLOYED_AND_LIVE_VERIFIED / SYSTEM_APPARMOR_PROFILE_NOT_INSTALLED**.
Funkční nabídková cesta, Appearance i panely jsou ověřené; bezpečnější trvalé
odstranění fallback dialogu stále vyžaduje uživatelovo `sudo` heslo.
