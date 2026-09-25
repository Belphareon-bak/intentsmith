# GPU hunt: odpověď na druhou nezávislou revizi

25. 9. 2026 · větev `work/hunt-model-controls-20260917` · **NO_GO pro výběr a autonomní změnu rolí**

Podklad: `/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925-review/REVIEW-2.md`.
Tento záznam opravuje prezentaci i nové běhy; uložené odpovědi, historické známky a jejich původní SHA zůstávají nedotčené.

| Nález | Oprava | Co stále není doloženo |
|---|---|---|
| P1 VISION opakování | [Audit](evidence/2026-09-25-hunt-vision-repeat-audit.json) nad připnutou read-only SQLite potvrdil 207 uložených, 69 různých výstupů; všechny trojice jsou bajtově shodné a čtyři datované qwen3.8 běhy vracejí tytéž výstupy. `createRoleEvaluationPlans` teď pečetí pro deterministickou VISION jedno opakování a `evaluateRole` i `trialRole` tento počet skutečně předávají runneru. | Rozptyl při nenulové teplotě, oddělený provozní rank-check, přijaté významové orákulum. Dosavadní těsné pořadí není doporučení. |
| P2 dva packety po 120 | [Opravný záznam](evidence/2026-09-25-hunt-review-provenance-correction.json) identifikuje obě různá SHA a stahuje oba odvozené packety ze srovnávacího hodnocení. Jediný pracovní podklad je [původní formulář se všemi 312 odpověďmi](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/review.html), packet SHA256 `b3a2f33445ed7537fca65d2dd25645e68ba90250c1c0718c57396f8371aefc0f`. | 312 známek po kritériích a druhý nezávislý posudek. Expozici identit nebo starých známek musí každý hodnotitel přiznat; samotný anonymní formulář z ní nedělá slepou přejímku. |
| P2 M6 | Konstanta kandidáta nyní odpovídá 106 migračním souborům, test odmítá starý počet 105 a M6 runtime/technical testy jsou zelené. Regrese vznikla v hunt commitu `bf6a28bd`; opravený popis to přiznává. | Nová fyzická M6 upgrade/rollback zkouška a release pečeť pro přesný kandidátní commit. Existující receipt pro jiného kandidáta a 79 migrací se nepřenáší. |
| P2 „lidská“ matice | Zdrojový generátor i artefakty nesou název **index evidence**. D značí vývojové známky Codexu a orákul, O obsahové známky Opusu bez striktního JSON formátu, V technickou VISION známku z jediného různého výstupu na úlohu. Žádná buňka není lidský konsenzus. | Identifikovaný operátor musí posoudit spory a vybraný vzorek; potom lze budovat kotvu pro místní hodnotitele. |
| P3 expozice čtyř CHAT známek | Neměnný původní návrh doplňuje opravný záznam: Codex již viděl odkryté Opusovy známky těchto dialogů. Čtyři známky jsou pracovní a **neslepé**. | Nezávislá slepá přejímka nové rubriky na nepoužitých odpovědích. |
| P3 CODE historická čísla | Index uvádí neplatnost celé třídy historických CODE známek a více než dva příklady. | Přijaté plné orákulum a nové CODE měření. |

Sběr, známkování a rozhodnutí zůstávají oddělené: D1/D2/R1/R2 mají 312 syrových odpovědí bez přijatých známek; CODE je blokovaný orákulem; CHAT má pouze částečné posudky; VISION má technické známky bez opakovaného vzorkování. Žádná role nemá z tohoto balíku autoritu ke změně modelu.

Základní offline ověření po opravě: `model-evaluation-suites` 35/35, `pairwise-trial` 49/49, `model-evaluation-acceptance` 17/17, `m6-runtime-evidence` 8/8, `m6-technical-evidence` 8/8 a `artifact-validation` 160/160. Skript `scripts/manual/audit-hunt-vision-repeats.py` je read-only a požaduje přesný SHA izolované SQLite.
