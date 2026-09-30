# Studio 2 — klidnější konverzace, projektové časy a nastavení

Autorita: následné připomínky operátora 28. 9. 2026 a jeho odmítnutí
náhledů A/B/C. Rozsah:
[WP-STUDIO-2-RECENCY-CATEGORIES](../wp/WP-STUDIO-2-RECENCY-CATEGORIES-20260928.md).

**LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED / REVIEW_PENDING.**
Nezávislé přijetí této změny dosud neproběhlo. Zděděná Gate 0 pečeť má
FAIL; veřejná M5/M6 přejímka se tímto reportem nemění.

## Oprava podle připomínek

1. **Konverzace:** barevný je kategoriální štítek Chat / Projekt / Specialista.
   Symboly a podklady v dlaždicích, seznamu, detailu i hlavičce relace jsou
   neutrální. Funkční stav a výběr zachovávají svůj význam. Vazby, pořadí,
   čas použití a datové konektory z předchozího balíku zůstávají funkční.
2. **Projektové časy:** `LiveModel.proj` dříve vracel prázdné `last` a
   nevystavoval datum vytvoření. Nyní přebírá skutečné `created_at` /
   `last_active`, doplněné o poslední skutečné použití v místním profilu.
   `SessionStore.projectActivity` přežije zavření relace a restart.
   Detail má Vytvořeno a Poslední aktivita se stejným formátem jako konverzace.
   Neznámý čas zůstává „—“. SQLite datum bez zóny se čte jako UTC.
3. **Navigace:** předložené A/B/C operátor odmítl; B byla nejblíže, ale
   olivová Multimédia připomínala žlutý chat. Opravený konec po modré je
   azurový Worker, mátový Obchod a zelená Multimédia. Chat zůstává žlutý,
   Projekt červený, Specialista fialový a Expertýza modrá. Monochromatické
   motivy zachovávají monochromatickou navigaci a barevné štítky.
4. **Nastavení:** A/B/C původně ukazovaly stejnou úpravu nastavení; nešlo
   o tři návrhy jeho ikon. Finální oprava používá plné barevné podklady,
   kontrastní kresbu a dvanáct odlišných významových symbolů. Účet je osoba,
   Paměť kniha, Výstup dokument, Systém ozubené kolo a Zálohy obnova s hodinami.
   Modely mají čip, Úložiště disk. Dlaždice mají podklad 40 px / symbol 22 px;
   seznam a detail sdílejí symbol i barvu. Paleta nastavení je vlastní,
   tlumenější než hlavní kategorie. Vzhled vzniká v kanonickém prototypu
   a generátor převádí stejnou šablonu, logiku a styly do Reactu.

## Identita nasazeného balíku

| Část | Identita |
|---|---|
| Frontend | `323617107a964e31bcd6a737a01af5a81c296a74` |
| Backend | `c84b88cd0c0b76639823c82c022d2feab96dfc15` |
| AppImage SHA-256 | `3aaae2d7045e55fc914457f7943fa493bc6b608212d810ba90d1ac0453b568ce` |
| Frontend bundle SHA-256 | `a411a3b01f9cf477c6d42ff18ddc482053d5d1eed5970eb70e4fa8adeab6f11c` |
| Legacy frontend | `72247a4983abcb12d42f6da6cc5b27af8f2212fd` |

Trvalý balík:
`/mnt/vi7000/intentsmith/releases/studio2-frontend-323617107a964e31bcd6a737a01af5a81c296a74/IntentSmith-Studio2.AppImage`.
Atomicky se změnil jen `studioAppImage` v existující instalaci, se zálohou
a kontrolou SHA. Backend zůstal aktivní s PID `493803`. Služba, prostředí,
sandboxová volba, hold, desktopové položky a preference Legacy mají stejné
kontrolní součty před změnou i po ní. Otevřená uživatelská okna se neukončovala.

## Ověření a přesná hranice výsledků

| Zkouška | Výsledek |
|---|---|
| Celý offline/database profil na čistém `b5fda0f1` | **385 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED** |
| Finální LiveModel | **72/72 PASS**; skutečné projektové časy, neznámé datum, neutrální kontext i předchozí integrace |
| Finální SessionStore | **14 skupin PASS**; projektová aktivita po zavření/obnově a izolace projektu |
| Finální prototyp / generovaná vrstva | **1916 kontrol, 0 chyb**, fuzz 3000 bez chyby; shoda generátoru, projektová pole, neutrální ikony, různé symboly nastavení |
| Integrita dokumentace a census | **160/160 PASS** |
| Finální Electron, Studio 2 | PASS; výlučné UI, strop relací, ochrany práce, soubory, motivy, start a obnova |
| Finální Electron, M1 | PASS; řízený wire backend, success/error/cancel/reconnect, síťová hranice a čisté ukončení |
| Finální Electron, M2 composer | PASS; DOM vstup, odmítnutí nepovolených efektů a zachování vstupu/kontextu |
| Finální AppImage proti původnímu backendu | PASS; skutečné projektové časy, štítky, roletka 1–5, přepnutí 5 → 1 se stabilními ID a obnova aktivity |
| Všech 11 kombinací motivů | PASS; neutrální konverzační ikony, 7 barev štítků, 12 různých podkladů a symbolů nastavení; shoda dlaždic/seznamu/detailu |
| Kontrast | nejméně **4,81 : 1** pro štítky, **5,43 : 1** pro symboly nastavení |
| Produkční build / AppImage / M1 consumer guard | PASS |
| Běžný instalovaný desktopový launcher bez CDP | PASS; skutečné soukromé okno, vlastní rám, bez restartového dialogu a čisté ukončení |

Celý profil běžel na `b5fda0f1`, který již obsahuje všechny integrační opravy.
Následný `32361710` mění pouze kanonickou paletu a symboly nastavení, jejich
generovaný výstup, ověřovací assertion a dokumentaci. Integrační soubory
LiveModel a SessionStore jsou byteově shodné. Tento rozdíl je uložený jako
`audit-to-final.diff`; celý profil se nepředkládá jako běh na finálním SHA.
Finální cílené testy, všechny tři Electron scénáře a AppImage mají identitu
`32361710`, AppImage navíc přesný SHA výše.

Jediný FAIL celého profilu je
`IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`: registr se liší od přijaté Gate 0
policy. Skutečný souhrnný verdikt je **FAIL**, pečeť se nepřepisovala.
Manifest: `.intentsmith-artifacts/test-runs/2026-09-28T19-54-15-669Z/report.json`.

První AppImage pokus na `b5fda0f1` odhalil olivové štítky ve světlých motivech
pod 4,5 : 1; tento neúspěšný výsledek je uchovaný. Nové zelené odstíny prošly.
První finální Electron pokus se zastavil v preflightu kvůli chybějícím
soukromým adresářům pro důkazy; po jejich vytvoření všechny tři scénáře prošly.
Neúspěšné pokusy nejsou přeznačené na PASS.

Konkrétní původní projekt: backend má `created_at=2026-08-21 20:21:40` a
`last_active=2026-09-28 10:20:46`. Detail ve skutečném AppImage ukázal
`21. 8. 2026 22:21` / `28. 9. 2026 12:20`, odpovídající pražskému času.
Původní data se jen četla GET konektory; motivy a relace se měnily v soukromém
profilu. Nebyl spuštěn nový GPU tah ani změna původní DB.

Kontrola původní DB po nasazení: `quick_check=ok`, nula foreign-key chyb,
shodné počty `51 konverzací / 8 zpráv / 16 projektů / 7 modelových vazeb`.
Všech sedm celých modelových vazeb včetně identit a časů je shodných
s kontrolou před změnou.

## Použití a důkazy

Uložit rozpracovanou práci, zavřít otevřená okna IDE 2.0 a spustit znovu
ikonou **IntentSmith IDE 2.0**, případně `gtk-launch intentsmith`.
Otevřená okna si nevymění frontend za běhu. Profil se nemaže. Legacy zůstává
samostatně pod `gtk-launch intentsmith-legacy` proti témuž backendu a DB.

[Náhledy skutečné aplikace včetně porovnání nastavení před/po](/mnt/vi7000/intentsmith/evidence/studio2-palette-projects-20260928-32361710/index.html).
Soukromý packet obsahuje screenshoty, skripty, audit, finální Electron důkazy,
zdrojový archiv, odmítnuté náhledy a neúspěšné pokusy. Všech 499 souborů má
ověřené `SHA256SUMS`. Screenshoty původních konverzací se nepublikují na GitHub.

Lokální čas použití je údaj tohoto profilu, backendová aktivita je sdílená.
Kontrast se ověřil pro výchozí motivy, nikoli libovolné uživatelské CSS.
Tato oprava nemění limity ani stránkování existujících datových konektorů.
Nový živý modelový/M2 zápis do původní DB se v této vizuální opravě neopakoval;
finální chybové a transportní integrace ověřil řízený backend.
