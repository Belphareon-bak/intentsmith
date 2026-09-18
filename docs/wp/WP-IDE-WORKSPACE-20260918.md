# IntentSmith IDE — pracovní prostor

Autorita: explicitní zadání operátora 2026-09-18 (body 1–4 a přejmenování C3).
Stav: IN_PROGRESS. Základ `4ebdfd39`, větev `work/ide-workspace-20260918`.
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

Ověření: cílené regrese izolace relací, obnovy a kompatibility, produkční build,
skutečné Electron ovládání a snímky. Závěrečný deterministický profil ponechá
případný známý nesoulad operátorské Gate 0 pečeti červený. Review není nahrazeno
vlastními testy. Výsledky a nezajištěné části budou doplněny po ověření.
