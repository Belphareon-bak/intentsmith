# GPU hunt: původ výsledků a stav sad k revizi

25. 9. 2026 · vývojová větev `work/hunt-model-controls-20260917` · **PRŮZKUM / NO_GO pro automatický výběr a změnu rolí**

Tento záznam doplňuje [izolovanou kampaň](2026-09-25-GPU-HUNT-ISOLATED-CAMPAIGN.md), nikoli její uložené odpovědi. Rozlišuje **sběr → posudek → přejímku → provozní rozhodnutí**. Ani jedna známka z odlišné verze sady nebo z jiného kroku se automaticky nepřenáší. Historických 2 922 odpovědí z 20. září je oddělený sběr; nový konverzační panel má 1 200 dialogů a izolovaná D/R/VISION kampaň 519 odpovědí.

## Co přesně obsahují aktuální podklady

| Podklad | Sběr | Hodnocení | Autorita |
|---|---:|---|---|
| CHAT vícekolový panel | 1 200 plánovaných dialogů, 1 196 dokončených; 10 modelů × 20 CZ/EN dvojic × 3 opakování | Opus: 400 dialogů vybraných z prvního opakování (jedno přerušené nahradilo opakování 2). Samostatný GPT návrh: 60 ručních a 60 mechanických striktně JSON, 119/120 plně oznámkovaných, jeden spor; nejde o známku všech 1 200. | Nepřijatý vývojový posudek, jeden externí hodnotitel. |
| D1/D2/R1/R2 izolovaná kampaň | 312/312 odpovědí CAPTURED: D1 72, D2 72, R1 96, R2 72 | 0/312 aktuálních známek; skóre je `null`. | Bez přijaté dvojice hodnotitelů. |
| VISION izolovaná kampaň | 207/207 odpovědí; 3 modely × 23 úloh × 3 opakování | Technické skóre pro 207 odpovědí; ornith 77,61 %, qwen3.8 77,25 %, gemma4 75,72 %. | Bez provozního rank-checku a bez rozhodovací autority. |
| CODE aktuální úplná sada | 7 aktivních úloh | 0 nových modelových odpovědí: preflight orákula správně blokuje inferenci. Starší dílčí spustitelné komponenty 21/21 vs. 15/21 nejsou úplné skóre. | `CODE_ORACLE_CONTROL_FAILED`. |

Zdroj CHAT: `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/review-full-05/review.json`, `opus-grading-20260924/grades.jsonl` (400 řádků) a `assessment-20260924/assessment.json` (120 řádků; [coverage.json](/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/assessment-20260924/coverage.json) uvádí 1 076 dokončených dialogů bez GPT známky). Opusovo pořadí má jen jedno opakování na dvojici model/úloha; neporovnává všechny tři odpovědi. Zdroj izolované kampaně a přesná run ID jsou v [jejím manifestu](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/manifest.json) a [auditu](evidence/2026-09-25-hunt-isolated-campaign.json). Dokončení sběru není dokončením známkování.

Níže `24/0` znamená **24 uložených odpovědí a 0 aktuálních přijatých známek**. `120/0` u CHAT znamená plánovaný počet dialogů daného modelu a nula přijatých známek; nepovyšuje Opusových 40 vývojových známek na přejímku. `—` znamená, že tato kampaň pro danou buňku neobsahuje srovnatelný sběr, **nikoli** že model roli neumí.

| Model | D1 | D2 | R1 | R2 | CODE | CHAT | VISION |
|---|---:|---:|---:|---:|---:|---:|---:|
| qwen3.8:latest | 24/0 | 24/0 | 24/0 | 24/0 | blokováno | 120/0 | 69 technicky |
| qwen3.5:27b | 24/0 | — | — | — | blokováno | 120/0 | — |
| qwen3.6:27b | 24/0 | 24/0 | 24/0 | 24/0 | blokováno | 120/0 | — |
| gemma4:26b | — | 24/0 | 24/0 | — | blokováno | 120/0 | 69 technicky |
| devstral-small-2:latest | — | — | 24/0 | 24/0 | blokováno | 120/0 | — |
| ornith-1.5:9b | — | — | — | — | blokováno | 120/0 | 69 technicky |
| phi4:14b | — | — | — | — | blokováno | 120/0 | — |
| qwen3-30b-a3b:latest | — | — | — | — | blokováno | 120/0 | — |
| qwen3-coder:latest | — | — | — | — | blokováno | 120/0 | — |
| qwen3:14b | — | — | — | — | blokováno | 120/0 | — |

D1, D2, R1 a R2 používají **stejné historické případy**, ale jiné veřejné úkoly a rubriky: D1 analyzuje a plánuje bez patche, D2 diagnostikuje a navrhuje nejmenší opravu, R1 reviduje napříč vrstvami a R2 dělá rychlou lokální revizi s důkazem. Proto jejich procenta nelze ztotožnit. Osm případů sdílených rolí ani jejich tři opakování nevytvářejí nové nezávislé provozní skupiny.

## Konkrétní nálezy a provedené opravy

1. **CODE orákulum:** agregovaný preflight ověřil všech sedm aktivních úloh před GPU inferencí. Šest prošlo; `patch_90eff80ecb8a` selhala na osmi dalších kontrolách významové shody a rozporu, přestože gold=1, alternative=1 a broken=0. Preflight teď vrací všechny vadné úlohy a jejich důvody, i když jich bude více; model za vadnou sadu nedostane nulu. Regresní CODE sada 30/30.
2. **CHAT rubrika:** `corrected_project.2` ve verzi `chat-conversation.2-draft` vyžadovalo konkrétní „acceptance information“, které zadání nepožaduje. Verze `chat-conversation.3-draft` dovoluje libovolný doložený relevantní chybějící údaj a výslovně zakazuje vyvozovat postup/hotovost, které prompt nedal. Všech 40 zadání a volby inference zůstaly stejné; historické známky se nemění. Nová rubrika je pořád `PREPARED_NOT_VALIDATED`, `decisionReady:false`. Při jejím přijetí lze uložené dialogy přeznámkovat bez nového GPU sběru; odlišné SHA musí zůstat viditelné.
3. **Zaslepený D/R packet:** nový 312položkový balíček opakuje přesně 192 odpovědí ze starého balíčku. Z obou původních packetů jsem bez otevření klíčů identit odvodil [samostatných 120 nových odpovědí](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/new-only-120/packet.json) a [formulář](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/new-only-120/review.html): D1 24, D2 24, R1 48, R2 24, celkem 312 kritérií. [Receipt](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/new-only-120/receipt.json) svazuje SHA obou zdrojů a nového packetu; originální manifest zůstal nedotčen. Znalost starého klíče ale umožňuje identitu odvodit i v tomto doplňku. Toto je vývojový podklad, ne čerstvá slepá přejímka.
4. **Smíšený stav huntu:** finální JSON zachovává `PARTIAL` při blokované roli a navíc uvádí `awaitingReviewRoles`. Čekající posudek tak nezmizí za souhrnným statusem. Regresní desktop sada 40/40.
5. **VISION kontrola:** u `vision_connections` reference sedí s obrazovým zdrojem: T1 přijíždí 08:41, T5 odjíždí 09:00, přestup 19 minut splňuje minimum 12 a příjezd 09:15 je nejčasnější. Nula všech tří modelů v této úloze sama o sobě není důkaz vadného orákula. Deset ze 23 úloh mělo u všech stejnou známku; není důvod je automaticky vyřadit, ale jejich rozlišovací příspěvek je nulový v tomto panelu.

## Otevřené brány podle dohodnutého pořadí

- **Sady a pilot:** přijmout opravenou CHAT rubriku na dvou přesných artefaktech; u CODE nahradit významově vadné orákulum novou verzí s pozitivními i negativními sondami a nezávislou přejímkou, nikoli širším regexem. D/R sady mají pouze osm sdílených historických skupin a anglická zadání. VISION má 23 kontrolovaných úloh, ale bez ověření provozního pořadí.
- **Doplnění sběru:** aktuální desetimodelová sedmirolová matice je řídká. Nespouštět plošný GPU přesběr, dokud není srovnávací profil konkrétní role uzamčený; nové prompty znamenají nový sběr, nová rubrika při totožném vstupu znamená nové hodnocení původních odpovědí. Pro CODE zatím neexistuje platný úplný výsledek.
- **Nezávislé posudky:** Opusových 400 CHAT dialogů a GPT 120 návrhů nejsou dvě kompletní nezávislé známky celého panelu. D/R 312 čeká na dva posudky a rozsouzení sporů. Už známé odpovědi nesmějí sloužit jako čerstvá přejímací sada hodnotitelů. Člověk kontroluje spory, nízkou jistotu a náhodný vzorek až po zmrazení obou nezávislých známek.
- **Místní hodnotitelé a provoz:** kandidátní místní hodnotitelé musí být posouzeni na nepoužitých odpovědích nejméně dvou různých modelů na roli včetně negativních sond a zákazu vlastního hodnocení. Teprve přijatá dvojice může hodnotit zbytek; rozhodnutí o výměně dále vyžaduje nový oddělený provozní rank-check a konfliktově platné portfolio. Aktuálně `decisionReady: 0/7`, takže žádné doporučení ani aktivace z této evidence nevzniká.

Kontroly tohoto pracovního balíku: `code-patch-suite` 30/30, `desktop-hunt` 40/40, `artifact-validation` 160/160, CHAT cíleně 13/13, registr 541 programů validní. Živá DB, bindingy, timer ani GPU inference se tímto balíkem neměnily.


## Čistý audit kandidáta a úzká kontrola rubriky

Na čistém commitu `4849cceab09d1996a4d392d80bb39505c5f02b71` skončil povinný profil `offline,database` výsledkem **364 PASS, 2 FAIL, 10 BLOCKED z 376 programů**; [lokální report](../../.intentsmith-artifacts/test-runs/2026-09-25T10-52-22-102Z/report.json) má SHA256 `201a77b1e16b03c3310d35d22f2bcdc2cd050e515ae3e4715dc7bd6249846a95`. Nejde o zelenou přejímku. `tests/nightly-orchestrator-self-test.js` odmítá hash registru proti revidované Gate 0 politice; stejná závada je doložená už v [předchozím GO review](2026-09-25-GPU-HUNT-GO-REVIEW.md). `tests/m6-runtime-evidence.test.js` našel **106 souborů migrací, ale pevný release kontrakt říká 105**. Tento nesoulad existoval už v rodičovském commitu `dabb9802daa2159470b724475b3efbed4e8db92f`: stejných 106 migrací a stejná konstanta 105; tento balík migrace ani M6 kontrakt nemění. Změna čísla v release kontraktu by vyžadovala vlastní revizi M6 pečetě, není to oprava skórování huntu. Přesný rozpad je v [ověřovacím záznamu](evidence/2026-09-25-hunt-lineage-verification.json).

Pro opravené `corrected_project` jsem před otevřením identit zmrazil [čtyři vlastní známky s důvodem u každého kritéria](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/chat-corrected-project-v3-draft.json) (SHA256 `14ea72c46d8429f8bbce169c237a01adce33d0f1626bed0eb2650b978f7598f4`). Dva stručné dialogy dostaly 4/4 osy plně; dvě odpovědi s domyšleným stavem projektu mají srážky. Až poté vzniklo [srovnání se staršími Opusovými známkami a odkrytými identitami](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/chat-corrected-project-v3-post-freeze-comparison.json). Rozdílná verze rubriky a čtyři případy nedovolují z toho počítat shodu hodnotitelů ani vítěze CHAT role. Původní posudky zůstaly beze změny.
