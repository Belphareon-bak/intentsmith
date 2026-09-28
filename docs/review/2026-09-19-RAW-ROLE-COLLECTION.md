# GPU hunt — data předána k hodnocení

Stav: **RAW_COLLECTION_COMPLETE / HUMAN_REVIEW_PENDING**. Rozhodnutí o nasazení: **NEROZHODNUTO**. Toto uzavírá sběr bodů 1–2 handoffu, nikoli přejímku celého GPU huntu.

## Otevřít

- [review-sample.html](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/review-sample.html): 15 sporných + 15 náhodných odpovědí, bez názvů modelů a mých známek.
- [review.html](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/review.html): všechna zadání, obrázky a nezkrácené odpovědi; formulář s exportem `operator-grades.json`.
- [assistant-assessment.html](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/assistant-assessment.html): moje oddělené známky podle jednotlivých kritérií, konkrétní důvody a odkazy přes ID.
- [identity-key.json](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/identity-key.json): oddělený klíč identit, digestů, času a tokenů.
- [collection-integrity.json](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/collection-integrity.json): automatická kontrola úplnosti, vstupů a identity každé odpovědi.

## Naměřené pokrytí

| Role | Kandidáti | Úlohy × opakování na model | Celkem odpovědí |
|---|---|---:|---:|
| CODE | Qwen3.8, Devstral Small 2, Gemma4 26B | 7 × 3 | 63 |
| CHAT | Qwen3.8, Devstral Small 2 | 40 × 3 | 240 |
| VISION | Qwen3.8, Ornith 1.5 9B | 13 × 3 | 78 |
| D1 | Qwen3.8, Devstral Small 2 | 8 × 3 | 48 |
| D2 | Qwen3.8, Devstral Small 2 | 8 × 3 | 48 |
| R1 | Qwen3.8, Devstral Small 2 | 8 × 3 | 48 |
| R2 | Qwen3.8, Devstral Small 2 | 8 × 3 | 48 |

Celkem **573 odpovědí**, 92 různých zadání napříč rolemi. Opakování ani role nad stejným historickým případem nejsou nezávislá pozorování. VISION: 12 odlišných syntetických obrázků od jednoduchého čtení po výpočty a trasu + kontrola bez obrázku. CHAT: 24 EN + 16 CS úloh.

## Artefakty a délky

| Model | Digest | Délka sběru | Nejvyšší vzorek celé GPU (včetně desktopu) | Stav odpovědí |
|---|---|---:|---:|---|
| qwen3.8:latest | `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643` | 51 min 8 s | 20430 MiB | {'CAPTURED': 276} |
| devstral-small-2:latest | `24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8` | 41 min 0 s | 18808 MiB | {'CAPTURED': 236, 'OUTPUT_BUDGET_EXHAUSTED': 1} |
| ornith-1.5:9b | `e5df7dcdd8a263994df62d610317e07be0d6af23f96fcbd8543273058fce575e` | 0 min 50 s | 8092 MiB | {'CAPTURED': 39} |
| gemma4:26b | `08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68` | 1 min 22 s | 20576 MiB | {'CAPTURED': 21} |

Každá odpověď má response-bound digest a verzi evaluační Ollamy **0.34.2-intentsmith.1**. Systémový provider nebyl povýšen a zůstává oddělený. Logy potvrzují offload všech vrstev všech čtyř modelů. **Nález: Gemma API udává 998 737 181 bytů, ale hlavní CUDA váhy mají podle logu 16 147,43 MiB a pomocné 425,34 MiB.** Příčina není určena. Původní API kontrola proto nestačí pro paměťovou přejímku; její první report je zachován jako collection-integrity-before-memory-audit.json. hardware-audit.json uvádí logy, host buffery i NVIDIA vzorky. Není doložena nulová CPU alokace ani absolutní maximum mezi 2s vzorky. Raw data jsou platná, paměťová metrika providera vyžaduje samostatnou opravu.

## Co bylo pevně dané

Zdroj `6f93294fe567cfa938b234bacf2833f79dcd81eb`, čistý strom každého měření. Full profil, tři opakování, stejná zadání a nastavení mezi kandidáty, bez historie/nástrojů a `think:false`. CODE kontext 16384 / výstup 4096 / 300 s; CHAT 16384 / 2048 / 300 s; D1/D2/R1/R2 16384 / 8192 / 600 s; VISION 4096 / 1024 / 120 s. Před sběrem byla u CODE dvě zadání zpřesněna o veřejný formát confidence a hranici timeoutu po hlavičkách. Znění je v reálných uložených vstupech, v obou/třech modelech totožné. Starší skóre proto není přímá srovnávací řada.

Gemma byla do CODE přidána před známkováním nové série: Devstralův starší krátký výsledek byl pod 50 %, takže zůstal slabým srovnávacím kandidátem a přibyl další lokální model s completion/tools. Výběr do měření není potvrzení kvality. `additional-code-plan.json` zachovává důvod i čas.

## Oddělení a omezení

Sběrná cesta nevolala LLM soudce, kalibraci ani hodnotitele; všechny raw položky mají NOT_GRADED. Následné offline CODE kontroly již zapečetěných odpovědí jsou evidencí pro oddělené posouzení, i když další pevně naplánované bloky ještě běžely. Moje posouzení je až v samostatných souborech a nemá rozhodovací autoritu. Celé zapečetěné bloky tří opakování jsem četl souběžně s pokračující pevnou frontou. Původní interní protokol zmiňoval celou roli; rozdíl provedení je výslovně zachován v grading-protocol-clarification.json a původní text nebyl smazán.

Moje autorství části nástrojů a znalost identit omezují nezávislost; nejde o lidsky přijatou pravdu. Opus/operátor zatím tuto novou sérii neadjudikoval. Nejasná kritéria mají NULL s důvodem, nikoli trest modelu. Dílčí známky se neagregují do vítěze.

CODE ověřuje izolované fragmenty z historických oprav a část okolního mechanismu dodává fixture. PASS těchto kontrol není dokončení opravy v produkčním workflow. Některé historické testy mají slepá místa: kontrola VRAM ownera například sama nezachytila odstranění jiných shared ownerů. Nové srážky mají vedle testů i uvedený konkrétní důvod.

Bez nového holdoutu, přijatých rubrik, párové provozní kvalifikace a doložené nezávislosti případů nelze potvrdit funkční výběr pro všech sedm rolí. VISION zde není obecný test fotografií/videa a CHAT ID není doklad nezávislosti.

## Ověření a další krok

Runner collect-only: 6/6 testů; relevantní sémantická regrese 15/15. Integrita 573 záznamů v collection-integrity.json, samostatný prohlížeč v review-ui.json. UI kontrola používá izolovaný diagnostický Electron s --no-sandbox a softwarovým vykreslováním, nikoli produkční Studio. Zachované neúspěšné kontroly mají své logy, včetně opravené chyby odkazu na konkrétní odpověď.

Nejprve posuď 30 položek bez čtení mých známek a exportuj JSON. Pak porovnáme shody a spory, opravíme nejasné rubriky a domluvíme další krok. Žádná vazba, mazání, produkční skóre ani pravidelný timer se na základě této série neaktivují.

Oddělený názor na přiměřenost každé role a konkrétní slabiny měřidla: [assistant-assessment-summary.md](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/assistant-assessment-summary.md).

Závěrečný stav v [host-after.json](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/host-after.json): timer disabled/inactive, oba providery bez načteného modelu (evaluační sidecar již neběží), NVIDIA bez výpočetního procesu.

## Archiv a reprodukovatelnost

Měření proběhlo z čistého `6f93294fe567cfa938b234bacf2833f79dcd81eb`; toto dokončení dokumentace nepřidává novou inferenci. Zdrojový archiv je součástí úplné evidence. Hashované podklady jsou lokální, nikoli veřejně publikovaná data.

- blind-review: [blind-review-1cd4bf01ef9a1f2c.tar.gz](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/blind-review-1cd4bf01ef9a1f2c.tar.gz), 1262130 bytů, SHA-256 `1cd4bf01ef9a1f2cf92e0bf4e660de868bfc0401b7001edca60681af32ee701c`.
- separate-assessment: [separate-assessment-6724fe689df3a08f.tar.gz](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/separate-assessment-6724fe689df3a08f.tar.gz), 870507 bytů, SHA-256 `6724fe689df3a08ffc9da05840b2687304ce66a59e553b2941ea46ae76a7974a`.
- complete-evidence: [evidence-f185d63817929858.tar.gz](/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919/evidence-f185d63817929858.tar.gz), 33662249 bytů, SHA-256 `f185d63817929858aa284f84c9f2d2de813fc9805dfa4ae9352e43096d43af13`.

Kontrola archivu: **PASS**, všech 284 členů porovnáno s SHA-256 manifestem bez rozbalování. Prohlížeč: **14/14**, bez konzolových chyb; skutečný export JSON byl stažen a znovu přečten. Není to zkouška integrace do Studia.

## Verdikt rozsahu tohoto předání

**Sběr a příprava k posouzení dokončeny. Přijetí kvality testů, modelů a celého huntu zůstává otevřené.** Pro každou roli jsou nejméně dva vybraní kandidáti a všechna plánovaná opakování. Výběr předpokládá vhodnost k testu; dvě modelová jména nejsou důkaz dvou vyhovujících modelů. Opus/operátor ještě nová data neposoudili.

Jeden Devstral D2 pokus skončil limitem 8192 tokenů; 572 dalších má providerem potvrzené ukončení `stop`. Ani `stop` samo o sobě neprokazuje správnou či sémanticky dokončenou odpověď. Neúplný pokus je viditelný v raw exportu i jmenovateli.

K rozhodnutí po druhém hodnocení: nejasné rubriky (41 NULL dílčích kritérií), přiměřenost lokálních CODE oprav vůči reálné práci, spustitelné důkazy pro D2/R2, nové provozní případy a kvalifikace hodnotitele. Nově nalezená nesrovnalost Gemma paměťové metriky vyžaduje samostatnou opravu před paměťovou přejímkou. Není důvod měnit bindingy, mazat modely nebo spustit pravidelný timer na základě této série.

---

## Zachovaný plán před zahájením

# Sběr odpovědí dvou kandidátů pro každou roli

Původní stav před sběrem: PREPARED. Konečný stav je uveden výše.

Autorita: explicitní zadání operátora a WP-GPU-HUNT-HANDOFF-20260919 §5,
pravidla WP-GPU-HUNT-DIRECTION-20260919. Evaluační kontrakt se nemění.

| Role | Kandidáti | Úlohy × opakování pro jeden model |
| --- | --- | --- |
| D1, D2, R1, R2 | qwen3.8:latest, devstral-small-2:latest | 8 × 3 pro každou roli |
| CODE | qwen3.8:latest, devstral-small-2:latest | 7 × 3 |
| CHAT | qwen3.8:latest, devstral-small-2:latest | 40 × 3 |
| VISION | qwen3.8:latest, ornith-1.5:9b | 12 obrázků + kontrola bez obrázku, vše 3× |

Výběr vychází z dostupných lokálních artefaktů, dosavadních průzkumných
výsledků CODE/R2 a deklarovaných schopností `/api/tags`. Je to předpoklad
vhodnosti k testu, nikoli závěr o kvalitě. Qwen3-coder se na CODE neopakuje.

## Předem stanovený profil

- Celkem 552 odpovědí. Celá sada, žádný výběr výhodných úloh nebo opakování.
- D1/D2/R1/R2: kontext 16 384, výstup 8 192 tokenů, limit volání 600 s.
  Předchozí limit 2 048 omezoval dokončení odpovědí. Nový profil slouží
  průzkumu schopností a **netvrdí shodu s produkčním workflow**. Stejný pro oba.
- CODE: kontext 16 384, výstup 4 096, 300 s; CHAT: 16 384 / 2 048 / 300 s.
- VISION: kontext 4 096, výstup 1 024, 120 s. Ostatní nastavení zachována
  v jednotlivých úlohách. `think:false`, bez nástrojů, bez historie pokusů.
- Výslovně doplněn typ a enum `confidence` do zadání CODE f63d14d5eb61
  a zachování rušení timeru před čtením těla odpovědi v adb1258cfec0.
  Jde o nové hashované zadání; staré odpovědi se podle něj nepřeznámkovávají.
- Plné umístění profilu na GPU, nejvýše 22 000 000 000 bajtů podle `/api/ps`.
  Telemetrie paměti zařízení se navíc vzorkuje každé 2 s; není to důkaz
  přesného maxima mezi vzorky. Desktopová paměť je odlišná od paměti modelu.
- Vlastněný provider 0.34.2-intentsmith.1, port 11435. Identita artefaktu
  i providera je ověřena z každé odpovědi. Časový rozpočet každého běhu 240 min.
- Žádné kalibrační ani hodnoticí volání, žádné skóre v datech sběru.
  Technická chyba a vyčerpání limitu zůstávají viditelné včetně původní odpovědi.
- Timer vypnutý, žádný import do produkce, změna rolí, mazání ani doporučení.

`--collect-only` v existujícím `scripts/manual/all-role-evaluation.mjs`
odděluje sběr od starého hodnoticího režimu. Referenční odpovědi, rubriky
a testovací orákula se modelu neposílají; ukládají se pouze pro pozdější review.
Export k hodnocení bude bez mých známek; moje stanovisko dostane samostatný soubor.

Ověření před spuštěním: `node --test tests/role-collection.test.mjs` (6 kontrol),
příprava všech 276 pokusů jednoho modelu bez inference, odmítnutí kombinace
`--collect-only --judge=...`. Tato evidence nedokazuje kvalitu úloh ani modelů.

Privátní evidence: `/home/belphareon/Projects/coworker/intentsmith-hunt-raw-pairs-20260919`.
Původní sady jsou vývojové případy, nikoli nový holdout. Uzavření produkční T5
cesty, kvalifikace soudce a provozní zkouška zůstávají oddělené práce; tento sběr
se neopírá o jejich nehotovou rozhodovací autoritu.
