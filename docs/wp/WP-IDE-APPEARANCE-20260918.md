# IDE vzhled a sekční nastavení

Autorita: explicitní zadání operátora 2026-09-18, ikony rozložení, nový barevný
tmavý styl a sekční nastavení podle obrázku; následná oprava rozsahu posuvníku
na **veškerý text**, nikoli jen vedlejší. Vstup `585e9ece`, zachovat nasazené
změny evaluací z `230778ad` (integrační merge `cc8f4ace`).

Rozsah a vlastnictví: ruční browser modul a jeho styly, související workspace
regrese a dokumentace. Dvě tlačítka s ikonami a označenou aktivní volbou;
viditelný okamžitý účinek výraznosti na text ve všech webových plochách IDE;
nový volitelný barevný styl; 12 kategorií nastavení v kartách a tematických
záložkách při zachování jejich skutečných ovladačů a hlavní levé navigace.
Obrázek je inspirace pro uspořádání, nikoli autorizace fiktivních cloudových,
licenčních nebo SSO funkcí. Neměnit hunt, skórování, modelová přiřazení,
bezpečnostní kontrakty ani uživatelův profil.

Důkaz: stávající workspace/Studio testy, produkční build, skutečné Electron
klikání obou ikon, všech kategorií a záložek, posuvník na min/max na navigaci,
chatu, souboru/editoru i terminálu/logu; restart uchová vzhled a nastavení.
Zúžené okno nesmí odstřihnout hlavní navigaci nebo ovladače. Nasazení jako
čistá instalace s kontrolou novějšího live SHA před přepnutím.

Základní ověřovací příkaz: `node --test tests/ide-workspace.test.js
 tests/m1-studio-client.test.js tests/desktop-hunt.test.js`.
Při kolizi s cizím nasazením nejprve integrovat změny; žádný tichý rollback.
