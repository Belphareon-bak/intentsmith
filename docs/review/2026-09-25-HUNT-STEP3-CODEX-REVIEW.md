# GPU hunt: samostatný vývojový posudek Codexu pro D/R

25. 9. 2026 · `DRAFT_BLIND_REVIEW` · **bez rozhodovací autority**

[Úplný posudek](evidence/2026-09-25-hunt-codex-all-dr-development-review.json) pokrývá všech 312 odpovědí a 840 kritérií v kanonickém packetu SHA256 `b3a2f33445ed7537fca65d2dd25645e68ba90250c1c0718c57396f8371aefc0f`. Každé číselné kritérium má samostatný důvod. Soubor prošel `verify-hunt-blind-review.mjs`: 735 číselných kritérií a 105 `TASK_ISSUE` bez známky. Přesný otisk posudku je `72231c6d959c80157f88ead2733b2e8de7a2532b827ff5b747c83c97b632e4b7` a je v [mrazicím záznamu](evidence/2026-09-25-hunt-codex-review-freeze.json). Ten vznikl před otevřením Opusových známek.

| Role | Odpovědi | Číselná kritéria | Kritéria bez známky |
|---|---:|---:|---:|
| D1 | 72 | 252 | 36 |
| D2 | 72 | 252 | 36 |
| R1 | 96 | 168 | 24 |
| R2 | 72 | 63 | 9 |
| **Celkem** | **312** | **735** | **105** |

Všech 39 odpovědí `model_cleanup` je v tomto posudku konzervativně bez známky. Zadání nezpřístupnilo historické DDL `model_overrides`; `previous_model TEXT NOT NULL` vylučuje údajný produkční řádek s `NULL` a `role PRIMARY KEY` vylučuje více řádků téže role. **Nevylučují však prázdný řetězec ani stejnou předchozí identitu u různých rolí.** Některé části rubriky jsou tedy hodnotitelné. Označení všech kritérií `TASK_ISSUE` je moje opatrná volba při směšování platných a neplatných kontrol v jednom scénáři, nikoli důkaz, že každá odpověď je nehodnotitelná. Operátor má rozhodnout, které části lze zachovat, a vadu zadání opravit pro další sběr. Současný packet ji nesmí vydávat za neúspěch modelu. Ostatní úlohy mají vývojové známky, nikoli přijatou sadu nebo zaručenou předpovědní platnost.

D1, D2 a R1 jsou hodnocené po čtyřech, čtyřech a dvou kritériích; původní samostatný R2 posudek ukládal jediné souhrnné skóre, které odpovídá jedinému kritériu packetu. Při složení nebyly žádné známky přepočítány. [R2 zdroj](evidence/2026-09-25-hunt-codex-r2-development-review.json), [D1 zdroj](evidence/2026-09-25-hunt-codex-d1-development-review.json), [D2 zdroj](evidence/2026-09-25-hunt-codex-d2-development-review.json) a [R1 zdroj](evidence/2026-09-25-hunt-codex-r1-development-review.json) jsou samostatně dohledatelné v mrazicím záznamu.

Hodnotil jsem odpovědi bez otevření klíče identit nebo Opusových známek, ale měl jsem dřívější znalost zadání a některých případů. Toto je proto **samostatný vývojový posudek**, nikoli čerstvá slepá přejímka hodnotitele. Všechna procenta modelů a doporučení role zůstávají pozastavená. [Vlastní explicitní příznaky](evidence/2026-09-25-hunt-codex-review-flags.json) vybírají osm nejméně jistých kritérií a čtyři potenciálně kritická selhání; nejsou úplným automatickým detektorem. Předem zvolený [náhodný vzorek 26 odpovědí](2026-09-25-HUNT-STEP3-OPERATOR-PRESAMPLE.html) zůstal nezměněn.

Po dokončení druhého posudku se oba soubory ověří proti stejnému packetu, porovnají po kritériích a do operátorské fronty přijdou neshody od 0,15, vady úloh, označená nízká jistota, kritická selhání i předvolený vzorek. Rozsouzení bude nová vrstva; tento posudek, syrové odpovědi a druhý posudek zůstanou oddělené. Ani shoda dvou posudků na známých vývojových případech sama o sobě nepřijme hodnotitele a neschválí výměnu modelu.

Po zmrazení jsem při kontrole rozpracovaného druhého posudku našel [konkrétní vlastní chybu v D2](2026-09-25-HUNT-STEP3-CODEX-POSTFREEZE-QC.md). Původní známka zůstává pro audit beze změny; operátorská fronta musí tento rozpor výslovně zahrnout.
