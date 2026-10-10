# Doplnění V4 do stávajícího IDE 2.0 — 10. 10. 2026

Stav: **NATIVE_CORE_VERIFIED / INSTALLATION_BLOCKED_BINDING_CHOICE / INDEPENDENT_REVIEW_PENDING / NOT_ACCEPTED**.
Autorita: operátorovy připomínky ke skutečnému IDE a V4 z 10. 10.;
[rozsah a podmínky](../wp/WP-IDE-INTEGRATION-20261009.md).
Další samostatné IDE operátor odmítl. Tento report není jeho přejímkou.

## Co se mění

- Jediný stávající Studio 2 renderer zachovává rám, motiv a profil.
  Nastavení používá plochou boční navigaci s ikonou a názvem vedle sebe.
  Mouse focus nepoužívá modrý Theia outline; klávesnice zachovává viditelný
  focus v barvě motivu. Výběrové podtržení záložky zůstává při kliknutí;
  konečná úprava odstraňuje jen browser outline, nikoli produktovou dekoraci.
- Účet a propojení: dvě karty lokální identity/prostředí, skutečný profil
  uložený v DB s autentizací, CAS a readbackem. Neplatný e-mail nezničí draft.
  Funkční lokální výchozí složka projektů zůstává. Neúčinné staré preference
  identity/oznámení už nepřekrývají připojené správy účtů a kanálů.
- Přehled rolí odděluje nastavené okno/odpověď a skutečně ověřený HW strop.
  Vazby rolí lze zobrazit i při výpadku poskytovatele; provider health ani
  místní skóre se tím neoznačí jako ověřené. Detail místního modelu ukazuje
  metadata Ollamy, digest, vazby rolí a konfiguraci kontextu.
- Hunt má čtyři rovnocenné workflow záložky a samostatné skupiny profilů
  Huntu a Challenge. Nový profil má odpovídající typ, výběr modelu/rolí,
  ruční/jednorázový/intervalový/denní/týdenní plán se závislými poli.
  Globální seznam/dlaždice ovládá i uložené profily; při editaci formuláře
  je vypnutý s vysvětlením. Profily, fronta a historie dál používají skutečné
  verze a neměnné snímky.
- Katalog zobrazuje porovnání všech rolí, doporučení místního testu,
  skutečné související tagy s dostupnými metadaty kvantizace/VRAM a odkaz
  na primární zdroj. Výchozí filtry lze přepnout i při neověřené VRAM.
- Veřejné reference nejsou pouze prázdná ruční API možnost: přibyl omezený
  offline snapshot dvou ověřených primárních modelových karet. Srovnání
  vyžaduje stejný zdroj, metriku, stupnici, verzi/otisk a datum měření.
  Zdrojové datum měření je neznámé, datum našeho ověření je oddělené.
  Názvy se nepřenášejí na neznámé tagy/kvantizace. Mapování metrik na role
  je výslovně pomocný prior, nikoli důkaz kvality dialogu nebo revizora.
- Instalátor zachovává PDF/účetní runtime a existující profil; při upgradu
  nekopíruje znovu Legacy. Předává skutečnou konfiguraci OLLAMA_MODELS
  ze služby lokálního poskytovatele. Nepřidává další desktop položku.

## Doložení veřejných referencí

[Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4?hl=zh-cn)
a [Qwen3.6-27B model card](https://huggingface.co/Qwen/Qwen3.6-27B/raw/main/README.md)
byly přečteny přímo. Pinned výběr a otisky zdrojů jsou v
[src/system/ide-public-references.json](../../src/system/ide-public-references.json).
MMLU Pro je znalostní proxy, GPQA Diamond proxy vědeckého uvažování,
LiveCodeBench v6 programování a MMMU Pro multimodality. Mapování na
IntentSmith role je naše inference. Skóre nenahrazuje test přesného
místního digestu a kvantizace ani nepovoluje přepnutí vazeb.

## Ověření a přesné identity

Aplikační zdroj a poslední AppImage: `37ee6177f7cf8e5e4509c5860474e8dca2ce0e8e`.
AppImage SHA-256: `8225de42fa4b743a0113de3322c65450f7efe6e00687b4d0683697b047d4fe26`.
[Build receipt](evidence/ide-preview-completion-20261010/appimage-37ee6177.json)
váže čistý zdroj, Node 24, oba úspěšné sestavovací příkazy a otisky IDE vstupů.
Následující dokumentační commit nemění aplikační zdroj této zkoušky.

| Ověření | Přesný rozsah a výsledek | Důkaz |
|---|---|---|
| Úplný audit `3f9410cc` | **415/415 PASS**, 327 offline + 88 database, žádný blokovaný/skipped program; před doplněním popisků HW v pravém panelu/editoru a opravou zachování indikátoru vybrané záložky při kliknutí | [Report](evidence/ide-preview-completion-20261010/audit-3f9410cc.json), [inventory](evidence/ide-preview-completion-20261010/audit-inventory-3f9410cc.json), [log](evidence/ide-preview-completion-20261010/audit-3f9410cc.log) |
| Dotčené čtyři UI sady pro `37ee6177` | **47/47 PASS**, včetně paritního sestavení view, nastavení, modelů a průvodců | [Výstup](evidence/ide-preview-completion-20261010/ui-tests-37ee6177.txt) |
| Struktura `37ee6177` | Census/artifact 161 PASS; registr 602 programů; importní hranice 1557 hran beze změny; sestavený M1 consumer PASS; `git diff --check` PASS | [Artifact](evidence/ide-preview-completion-20261010/artifact-checks-37ee6177.txt), [registry](evidence/ide-preview-completion-20261010/registry-37ee6177.txt), [boundary](evidence/ide-preview-completion-20261010/boundary-37ee6177.txt), [consumer](evidence/ide-preview-completion-20261010/consumer-build-37ee6177.txt) |
| Nativní AppImage `37ee6177` | **PASS, 39 snímků**, renderované šířky 1366 a 1920, skutečný vlastní backend a skutečná metadata 15 místních modelů Ollamy. Profil se uloží právě jednou a API ho přečte; neplatný e-mail zachová draft; Hunt profil se uloží jako vypnutý/ruční a přepne seznam/dlaždice. Kliknutí bez modrého outline a se zachovaným podtržením aktuální Hunt záložky, klávesnice s 2px focus; žádná chyba stránky | [Receipt](evidence/ide-preview-completion-20261010/native-37ee6177.json), [snímky](evidence/ide-preview-completion-20261010/README.md) |
| Migrace `3750986d` | Konzistentní kopie skutečné provozní DB: quick check ok, 0 FK porušení; počty konverzací/projektů/specialistů/evaluací nezměněny. Provozní DB se nemění | [Preflight](evidence/ide-preview-completion-20261010/migration-preflight-3750986d.json) |
| Nový production-mode backend `3f9410cc` nad kopií provozní DB | Čtecí API **PASS**, ale celá aktualizace **BLOCKED** kvůli rozdílu RAM/DB modelových vazeb níže. Žádné inference ani doručení zprávy | [Výsledek](evidence/ide-preview-completion-20261010/production-copy-3f9410cc.json) |
| Instalátor `37ee6177` | **DRY_RUN_PASS, NEAPLIKOVÁNO**. Zachová DB, profil, Legacy, PDF/účetní runtime; skutečná cesta modelů `/mnt/vi7000/ollama/models` | [Plán](evidence/ide-preview-completion-20261010/installation-plan-37ee6177.json) |
| CI | **19/19 success** na obou přesných SHA: `3f9410cc` run `38042941003`, `37ee6177` run `38045179821` | [Poslední GitHub běh](https://github.com/Belphareon-bak/intentsmith/actions/runs/38045179821), [API](evidence/ide-preview-completion-20261010/ci-37ee6177-jobs.json) |

Nativní zkoušky používají vlastní čerstvou DB a profil, všechny role v této
kopii připnuté na `qwen3.8:latest` pouze pro metadata a formuláře. Nejde o
provozní sestavu ani test generování. Šířky jsou skutečný Electron viewport,
ne tvrzení o fyzické velikosti celého okna. Testovací výchozí motiv není
změnou uloženého motivu operátora. Kopie DB, credential soubory a uživatelská
data nejsou publikovaná.

První celý audit `3750986d` selhal v jednom programu kvůli zastaralému
odvozenému mobile inventory pro nový endpoint profilu. Inventory je opravené
v `df3ab64d`; následně prošly dva celé audity 415/415. Původní
[FAIL](evidence/ide-preview-completion-20261010/audit-failed-3750986d.json)
zůstává dohledatelný. Dvě poslední chyby pomocné nativní sondy (pravý panel
záměrně skrytý na 1366; selektor četl dříve otevřený detail modelu) byly
opraveny v sondě, ne zakryty změnou produktového výsledku. Jejich lokální
receipty jsou zachované.

Průběžné backend/view testy 44/44, desktop/live-model/UI 156/156 a skutečný
HTTP/restart profilu (401/422/409, žádný duplicitní zápis) jsou další cílené
kontroly, nikoli důkaz živého GPU nebo doručení. Starší ověření integračních
oprav je v [remediation reportu](ide-integration-remediation-20261010.md).

## Pokrytí důležitých bodů V4

| Bod preview | Aktuální funkce a její hranice |
|---|---|
| 1 — seznam/dlaždice | Skutečné kolekce účtů, kanálů, Git/SSH, katalogu a Hunt/Challenge profilů; formuláře, diffy a matice mají ovladač vypnutý |
| 2 — katalog | Výchozí filtry/řazení, rodina, metadata, srovnání rolí a příbuzné skutečné tagy. Omezený pinned primární snapshot; chybějící skóre/VRAM/kvantizace zůstávají neověřené. Offload a kvalita nejsou změřené |
| 3 — matice | Pět barevných pásem 50/70/80/90, ploché buňky; čekající a chybějící skóre se nevydávají za výsledek |
| 4 — kontext | Nastaveno × ověřený HW odděleně v přehledu, pravém panelu, detailu modelu i editoru; parametry každé skutečné role. Kapacitní test HW dosud neproveden |
| 5 — popisky Huntu | Omezená šířka checkboxů, celé popisky a lidské účely rolí; ověřeno na obou šířkách |
| 6 — plánování | Ruční, jednorázový, intervalový, denní a týdenní režim aktivuje jen odpovídající pole; Hunt a Challenge jsou oddělené skutečné profily |
| 7 — fronta | Samostatná sekce s odstupem, skutečné stavy a neměnné snímky úkolů |
| 8 — graf | Jednotka a časová osa se nepřekrývají; chybějící měření se negeneruje |
| 9 — české počty | Sdílené české skloňování a české stavy; regresní UI kontroly |

Preview obsahovalo ilustrativní data. Jeho namalovaný budget/offload nebo
skóre bez důkazu se nepřevádí na tvrzení o skutečně změřené funkci.

## Proč normální spouštěč zatím stále otevírá starou verzi

Ověřená běžící instalace má backend `c84b88cd` a frontend `fddfe996`.
Nový AppImage a čistý instalovaný snapshot jsou připravené, ale **spouštěč
`intentsmith.desktop` zatím nebyl přepnut**. Odmítnutá třetí desktop položka
byla odstraněna; nedělá se další IDE. Staré již otevřené kandidátní okno
nebylo násilně zavřeno kvůli možným rozepsaným datům.

Před aktualizací nový backend nad soukromou kopií DB odhalil, že trvalé
uložené vazby se liší od RAM starého běžícího backendu. Nový backend je při
startu obnovuje. Přísná sonda „zachovat běžící modely“ proto skončila FAIL;
čtecí kontrola změnu označuje BLOCKED, ne PASS.

| Role | Nyní běží | Uloženo v provozní DB, obnoví se po restartu |
|---|---|---|
| CHAT | `qwen3.5:27b` | `gemma4:26b` |
| CODE | `qwen3.5:27b` | `qwen3.8:latest` |
| R2 | `qwen3:14b` | `devstral-small-2:latest` |
| VISION | `llava-llama3:8b` | `ornith-1.5:9b` |

D1, D2 a R1 jsou shodné. Operátor dostal cílenou otázku, zda zachovat
nyní běžící sestavu, nebo obnovit uloženou sestavu. **Odpověď je pending**;
nesmí ji nahradit timeout, předvolená volba nebo hodnocení modelu z katalogu.
To není nové vyžádání souhlasu s již autorizovanou aktualizací, ale potřebná
volba skutečného chování. Po odpovědi patří dokončení přes stávající instalační
boundary, se zálohou, readbackem zvolených vazeb, zachováním hold/profilu/Legacy
a kontrolou normálního spuštění `gtk-launch intentsmith`.

## Provozní a release meze

Živé `nvidia-smi` selhalo: načtený modul 595.91.07, NVML 595.99.
To blokuje skutečný GPU Hunt a modelové měření. Aktualizace UI nemůže
opravit načtený kernel modul; restart stanice nelze provést bez operátora.
Automation hold z 19. 9. zůstává a aktualizace jej nesmí uvolnit.

Není doloženo skutečné doručení Discord/Telegram ani GPU evaluace.
Nezávislý Opus musí hodnotit tento nový zdroj, ne starší 230f657f.
Dosud je dostupný pouze jeho starší **NEEDS_CHANGES**; aktuální nezávislý
verdikt nedorazil. Předání ani zelené testy jej nenahrazují.
Hunt profil nenabízí neúčinné libovolné budgety ani změnu chráněných
benchmark kontextů: runner má přijatý pevný měřicí protokol 4096 tokenů
s provozními limity. Neověřené kapacity a offload jsou označené jako
neověřené. Google/Microsoft OAuth, více izolovaných uživatelských účtů a
nepřipojené historické preference nemají předstírat hotovou funkci.

CHAT styl, vlastní prompt a 64k/96k/128k Gemma zůstávají dle operátora
předmětem pozdějšího měření; tato oprava nemění modelové vazby.
Formální release dále potřebuje přesné Gate 0/chain evidence, úschovu
klíčů, podepsané autorizační záznamy, příslušný soak a operátorovu přejímku.

## Pořadí dokončení před přejímkou

1. Vyřešit výše uvedenou modelovou volbu a aktualizovat existující hlavní
   instalaci. Ověřit skutečný běžný start, zachování dat a vazeb, nikoli
   pouze diagnostické okno nad testovací DB.
2. Získat nezávislý Opus verdikt na publikovaný aplikační SHA a zapracovat
   jeho nálezy. Starší verdict není přijetí těchto změn.
3. Obnovit funkční GPU na stanici a ověřit skutečný Hunt/evaluaci/kontext.
   Uvolnění automatického hold je samostatné rozhodnutí operátora.
4. Ověřit doručení Discord/Telegram s provozními credentials a autorizovaným
   cílem. Konfigurace účtu ani HTTP test s řízeným poskytovatelem to nedokládá.
5. Dokončit release důkazy Gate 0/chain, úschovu klíčů, 13 podepsaných
   autorizačních záznamů, relevantní soak a operátorovu přejímku. Běžící 24h
   soak na zmrazeném `387a490f` nepřeznačit na `37ee6177`.

31 historických obecných voleb zůstává nepodporovaných a pouze pro čtení;
nejde o 31 implementovaných funkcí. Čtyři aktivní přepínače paměti, profil,
složka projektů a specializované správy mají vlastní skutečné spotřebitele.
OAuth/multiaccount, libovolné Hunt budgety a test největší HW dvojice nejsou
hotové. Výchozí modelovou sestavu a kvalitu nelze uzavřít metadatovou sondou.
