# Společná instalace, desktop a provoz GPU huntu

Autorita: explicitní operátorovo „ano, dodlej to“ z 2026-09-17 navazuje na
čtyři provozní priority v README/ROADMAP. Vstup `5dedbfe8`; existující owned
checkout, nová větev `work/desktop-hunt-20260917`. Cizí dirty checkout a
historické důkazy se zachovávají.

Výsledek: aplikace a hunt používají stejný připnutý zdroj a DB. Desktopová
ikona spustí/připojí Studio k backendové uživatelské službě, chyba se zobrazí
v okně, zavření Studia ponechá službu běžet. GUI ukáže skutečný stav,
frontu a poslední výsledek huntu a nabídne lokální ovládání přes pevné akce.
Kalibrace rozliší příčiny neprůkazných duelů bez snižování rozhodovací laťky.

Vlastněné cesty: desktopové instalační/spouštěcí skripty a assety; existující
hunt wrapper/CLI; malý provozní read/control adaptér a system routes;
Studio chat-panel runtime a Electron branding; související testy, registry,
import boundary baseline a současná dokumentace. Uživatelské systemd units,
desktop entry a konfigurace se instalují až po ověření konkrétního kandidáta
a záloze DB/konfigurace. Pevné start/stop/timer akce nejsou obecný shell.

Ověření: focused pozitivní/negativní testy, lokální transport a odmítnutí
vzdáleného subjectu, stav bez systemd, selhání startu, opakované spuštění,
shutdown ownership, registry, celý deterministic profil, produkční build,
fyzický Studio/HTTP/služba journey a shoda zdroje aplikace/huntu.
GPU běhy jsou sériové; aktivní cizí měření se nepřerušuje. Historické skóre
se nepřepisuje ani neslučuje napříč kontrakty. Bindingy se samy neaktivují.

Stop: nevysvětlitelná změna provozní DB, neobnovitelná migrace, aktivní cizí
GPU práce, nutnost oslabit autoritu/containment nebo chybějící oprávnění.
Předání rozliší implementaci, lokální instalaci, fyzický důkaz a nezávislé review.

Stav 2026-09-17: **LOCAL_INSTALLATION_VERIFIED / REVIEW_PENDING**. Runtime
`9d13bb53`, testovací follow-up `2587ae56` (353 PASS / 1 očekávaný release-seal
FAIL). První tři provozní oblasti jsou implementované a fyzicky ověřené;
kalibrační diagnostika je hotová, nová modelová kalibrace je blokovaná
nesouladem ovladače GPU. [Review a kompletní hranice](../review/2026-09-17-DESKTOP-HUNT-REVIEW.md).
