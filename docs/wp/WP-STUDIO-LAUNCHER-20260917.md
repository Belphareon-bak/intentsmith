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
  `81e8f5fe6efd12347829e64602b757cbf600253120b98e76e5e5b5bd6cbf6609`.
- `apparmor_parser -Q -T`: **PASS** nad vygenerovaným profilem; test registry
  platný pro 523 spustitelných programů; `git diff --check`: **PASS**.

Stav kandidáta: **BUILD_VERIFIED / DEPLOYMENT_PENDING**. Nabídkový start a
instalovaná revize nejsou PASS, dokud neprojdou řízeným install/apply a živým
ověřením v KDE relaci.
