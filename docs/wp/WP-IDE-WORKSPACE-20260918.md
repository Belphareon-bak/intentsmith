# IntentSmith IDE — pracovní prostor

Autorita: explicitní zadání operátora 2026-09-18 (body 1–4 a přejmenování C3).
Stav: IMPLEMENTED / INSTALLED / REVIEW_PENDING. Základ `4ebdfd39`, větev `work/ide-workspace-20260918`.
Vlastník: Codex; vlastní checkout `intentsmith-audit-20260911-FNF2jj/snapshot`.
GPU hunt a cizí rozpracovaný hlavní checkout zůstávají ve vlastnictví druhého workera.

1. Relace: pojmenované záložky, přidání/zavření, společný svislý sloupec pro
   chat, terminál a log; možnost rozdělení. Uzavření konverzace zachová prostor.
2. Soubory a diff patří relaci; zobrazení může sbalit chat. Terminál, log a
   konverzace zůstávají oddělené a správně směrované při přepínání relací.
3. Navigace: katalog/nastavení využije střed bez stálého chatu a terminálu;
   otevření konkrétního projektu/konverzace/specialisty přejde do pracovního prostoru.
4. Specialista: vlastní soubory a historie, pravý panel standardně historie,
   explicitní přepnutí na soubory; sdílení souborů je výslovný uživatelský krok.
5. Nastavení: kompaktní navigace a čitelné formuláře, ovládání klávesnicí.
6. Názvy IntentSmith: aktivní aplikace, balíčky, soubory, události, konfigurace;
   existující uložená data převést kompatibilně, historické důkazy nepřepisovat.

Ověřeno: 106/106 cílených Node testů, produkční build a skutečné GUI scénáře.
Úplný offline,database profil na `c52b03ff`: 359 PASS / 1 FAIL (Gate 0 pečeť).
Nasazení s ověřenou zálohou, zachováním dat, HTTP autoritou a launcher check.
Nezávislé review, M5 history disposition a systemd M2 AppArmor zůstávají otevřené.
[Návod](../IDE-WORKSPACE.md), [review a přesné meze](../review/2026-09-18-IDE-WORKSPACE.md),
[strojová evidence](../execution/runs/ide-workspace-20260918.json).

Poslední přenosná oprava launcheru `0534a111` čeká s přepnutím instalace
na doběh samostatného GPU měření. Na tomto PC profil zachovává kompatibilní odkaz;
backend a GUI bundle jsou proti nasazené revizi beze změny.
