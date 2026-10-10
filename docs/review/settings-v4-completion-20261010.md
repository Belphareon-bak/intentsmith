# Nastavení V4 ve stávajícím IDE — dokončení 10. 10. 2026

Stav: **LOCAL_PRIMARY_DEPLOYED / NEW_INDEPENDENT_REVIEW_PENDING / RELEASE_NOT_ACCEPTED**.
Tento dokument nahradí předchozí označení úplného V4: Opus u `37ee6177`
potvrdil místní technický provoz, ale bod f) nebyl splněný a kompozice preview
nebyla dostatečně přenesená. [Původní nezávislý posudek](evidence/settings-v4-completion-20261010/opus-review-37ee6177.md)
není přejímkou nových oprav. Autorita a vlastněný rozsah jsou ve
[WP](../wp/WP-IDE-INTEGRATION-20261009.md).

## Co je implementované

| Oblast preview | Výsledné chování |
|---|---|
| Účet a propojení | Dvě profilové karty, avatar, aktuální lokální rozsah a šest řádků služeb. Profil se ukládá a čte z DB; Git účty vycházejí z SSH profilů, Discord/Telegram z doručovacích účtů. Konfigurace není ověřené spojení. |
| Repozitáře a přístupy | Karta výchozí cesty, tabulka skutečných projektů a bezpečných webových adres s kopírováním, tabulka přístupových profilů, vytvoření/úprava/přiřazení SSH. Uložená cesta se používá při založení projektu místo staré lokální preference. |
| Přehled modelů | Kapacita, požadovaný CHAT kontext, uzavřené místní výsledky a poslední měření; role s účelem, modelem, nastavenými limity a odděleným ověřeným HW stropem. Pravý panel má živé vazby. |
| Role | Výběr skutečné role, primární model, kontext a výstup s readbackem, místní testy a výsledky. Sdílený model nezaměňuje roli. Aktivace používá původní brány; výběr sám model neaktivuje. |
| Modely | Seznam/dlaždice inventury a detail: kontext/HW, identita/umístění, výsledky rolí. Digest a kvantizace jsou metadata konkrétního modelu. |
| Evaluace | Matice přesných artefaktů a rolí, hranice skóre 50/70/80/90, řazení a detail běhu. Neměřeno, čekající posudky, spor a starší digest jsou odlišné stavy; chybějící skóre není nula. |
| GPU Hunt | Čtyři rovnocenné záložky podle V4: přehled, katalog, nastavení Huntu/Challenge, historie. Fronta a podmínky provozu vycházejí z backendu. |
| Katalog | Hledání názvu/kvantizace, všechny nebo konkrétní role, dostupnost, VRAM a řazení. Levý seznam/skutečný detail vpravo, porovnání rolí s původem referencí, konkrétní varianty, potvrzované stažení a příprava testů. Neověřený fit VRAM není tvrzení o absenci odhadu. |
| Plánování | Ruční/jednorázový/intervalový/denní/týdenní profil s odpovídajícími poli; Hunt a Challenge oddělené. Seznam a dlaždice skutečně mění rozložení. Katalog přenese vybraný plán a sady do nového vypnutého profilu; nevzniká automatický efekt. |
| Telemetrie a provoz | Skutečná latence s časy a jednotkami, provozní politika, HW governor a změny modelů přes původní správce. Obnovení zachová aktuální podzáložku. |
| Ostatní nastavení | Paměť a retence, doručovací kanály, vzhled, diagnostika, skutečné úložiště, zálohy, přepínače, tokeny/párování/audit a informace o aplikaci. Starých 31 neúčinných obecných polí už není editable formulář. |
| Chybové cesty | 422 zachová draft a ID pro opravu. Nejistý zápis zablokuje opakování a nabídne čtecí porovnání aktuálního stavu; přepnutí backendu neotevře editor proti jiné databázi. |

Pět designových CSS souborů je byte-for-byte z doladěného preview;
[provenance](evidence/settings-v4-completion-20261010/design-provenance.json).
Selektory jsou omezené na původní Studio2 widget, barvy/fonty/profil zůstávají
z existujícího motivu. Nevznikla další aplikace, nový spouštěč ani druhá správa
modelů/API. Pointer focus nemá modrý outline; klávesnicový focus zůstává.

## Co preview ukazuje, ale backend dosud neposkytuje

Pracovní/anonymní oddělení identity, Google/Microsoft OAuth a libovolný seznam
fallbacků pro každou roli nejsou hotové funkce: ovladače jsou neaktivní a mají
konkrétní vysvětlení. GitHub/GitLab zde používají SSH reference, nikoli OAuth.
HTTPS token se do formuláře ani DB nevkládá. Pro Hunt se nepřidává libovolné
benchmarkové okno a tokenový budget: přijaté pevné sady mají svůj kontrakt
4096; uložený plán a vybrané sady jsou funkční. Ověřené maximum HW není odhad.
Ukecanost a vlastní CHAT systémový prompt jsou podle operátora po releasu;
64k/96k/128k Gemmy vyžaduje samostatné měření. Tato omezení nelze označit za PASS
pouhým zašednutím polí; úplná produktová přejímka bodu f) zůstává otevřená.

## Identita a ověření

Aplikační zdroj: `3c804a8a859a9f44efd200585795f5373e85fc3c`.
AppImage SHA-256: `2a9946879e468a723f62ac6e846d484601be518b3b2687df6c4cc8a2c62efc44`.
Následující dokumentační commit nemění aplikační soubory tohoto buildu.

| Ověření | Výsledek a mez | Důkaz |
|---|---|---|
| Offline/database | **416/416 PASS**, 0 FAIL/BLOCKED/SKIPPED; čistý přesný SHA, 328 offline + 88 database, místní nástroje explicitně připravené, sériové sady | [Audit](evidence/settings-v4-completion-20261010/audit.json) |
| HTTP | 3/3 programy PASS: skutečný auth server/restart a projekty/expertýzy A→B→A; měření není Gate 0 acceptance | [Report](evidence/settings-v4-completion-20261010/http.json) |
| Nové V4 testy | 9 PASS: 422/nejistý zápis, read-only porovnání, XSS, veřejné/ověřené stavy, filtry všech rolí, přepnutí backendu, snapshot plánování | [Výstup](evidence/settings-v4-completion-20261010/ui-tests.txt) |
| Struktura | Artifact/census 161 PASS, registr 603 programů, importní hrany 1557 beze změny, kanonický view a sestavený M1 consumer PASS, diff --check PASS | [Registr](evidence/settings-v4-completion-20261010/registry.txt), [hranice](evidence/settings-v4-completion-20261010/boundary.txt), [build](evidence/settings-v4-completion-20261010/appimage-build.json) |
| Nativní Electron/AppImage | **53 snímků + 10 ověřených kontrol PASS**; vlastní DB/profil, skutečný backend a metadata Ollamy, všechny stránky na 1366/1920; skutečné zápisy/readback/restart. Bez inference a doručení. Izolovaný Hunt má očekávané DESKTOP_NOT_INSTALLED | [Receipt](evidence/settings-v4-completion-20261010/native.json), [galerie](settings-v4-completion-20261010.html) |
| Kopie provozních dat | Konzistentní SQLite backup/migrace, quick check ok, FK 0, doménové počty stejné; produkční režim nového backendu nad kopií obnoví všech sedm vazeb, 15 modelů a skutečnou modelovou cestu | [Migrace](evidence/settings-v4-completion-20261010/migration.json), [čtecí API](evidence/settings-v4-completion-20261010/production-copy.json) |
| Hlavní instalace | **Běžný launcher PASS**, původní motiv/profil/DB/Legacy, sedm stejných rolí, hold a disabled timer zachovány, bez CDP | [Receipt](evidence/settings-v4-completion-20261010/primary-installation.json) |
| CI | **19/19 success** na přesném `3c804a8a`, [run 38059638315](https://github.com/Belphareon-bak/intentsmith/actions/runs/38059638315); jiný SHA ani starý běh se nepřebírá | [Ověření](evidence/settings-v4-completion-20261010/ci.json) |

Původní celý audit `8ffc1778` je uchovaný jako FAIL (398 PASS, 17 nepovolených
toolchainů, jedna transientní kontrola nečistého stromu při souběžném HTTP
fixture). Běh `8a66d331` byl úmyslně přerušen kvůli závěrečné opravě katalogu.
Tyto běhy nejsou finální PASS. HTTP fixture původně vracel odpověď plánovače i
klasifikátoru; stejný FAIL byl reprodukován na `37ee6177`. Oprava fixture
vyžaduje přesně klasifikaci + finální odpověď, zachovává původní dotazy s názvem
souboru a všechny kontroly přesných souborových dat, cizích canary, expertýz,
mutací oracle a durable odpovědí. Backendové bezpečnostní pravidlo se nemění.

## Místní instalace a zbývající release podmínky

Instalováno 10. 10. v 16:33 CEST do stávajícího `intentsmith.desktop`,
source `3c804a8a859a9f44efd200585795f5373e85fc3c`, AppImage z téhož source. Skutečné okno
PID 977847 a backend PID 976926 používají tentýž nový snapshot.
Jedna hlavní položka IDE 2.0, samostatný původní Legacy; žádný kandidátní
launcher. Původní DB/profil/historie/role zůstaly. Konzistentní DB a privátní
profilový backup jsou uvedeny v receipt. Zavření starého okna proběhlo přes
WM_DELETE_WINDOW; nepřerušil se cizí soak a hold se neuvolnil.

Nový posudek Opuse pro tento přesný source není k dispozici. Starý verdikt
37ee6177 nepřenáším na nový renderer. Připravené důkazy jsou pro novou
nezávislou revizi; případné nové nálezy se opraví a odpovídající zkoušky zopakují.

- NVML má mismatch jaderného modulu a knihoven; GPU guard/Hunt a kapacitní
  ověření jsou BLOCKED. To není tvrzení, že CUDA/Ollama inference nefunguje.
  Po opravě provozního stavu je nutný nový gpuProbe a vlastní měření Huntu.
- Persistentní automation hold z 19. 9. je zachovaný. Uložený plán ani queue
  z UI jej neobcházejí; jeho uvolnění vyžaduje samostatné rozhodnutí operátora.
- Skutečné doručení Discord/Telegram je dosud neověřené; nynější testy dokazují
  adaptéry/auth a chybové cesty, nikoli doručení do externího účtu.
- Nový UI source nemá dokončený 24h soak. Běžící zmrazený `387a490f` je
  historický vůči tomuto source a nebyl přerušen. Zaniklý 138e958b není PASS.
- Přejímka všech produktových funkcí, custody klíčů, 13 podepsaných autorizačních
  záznamů, vhodný čistý checkout pro formální Gate 0 a operátorova přejímka
  zůstávají samostatné release podmínky. Autor těchto oprav je nemůže sám
  přepsat na přijatý release.
