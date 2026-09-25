#!/usr/bin/env python3
"""Render a provenance-labelled, non-authoritative model/role review matrix.

Historical rubric grades, the Opus CHAT pilot and current VISION controls are
different evidence tiers. This script keeps their labels instead of pooling
them into a synthetic winner or decision score.
"""
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[2]
HISTORICAL = Path("/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/full-matrix.json")
CHAT = Path("/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/scores-unblinded.json")
CURRENT = ROOT / "docs/review/evidence/2026-09-25-hunt-isolated-campaign.json"
CODE = ROOT / "docs/review/evidence/2026-09-25-hunt-code-components.json"
OUTPUT_JSON = ROOT / "docs/review/evidence/2026-09-25-hunt-human-matrix-preview.json"
OUTPUT_MD = ROOT / "docs/review/2026-09-25-HUNT-HUMAN-MATRIX.md"
ROLES = ("D1", "D2", "CODE", "R1", "R2", "CHAT", "VISION")
ALIASES = {
    "qwen3.8": "qwen3.8:latest",
    "devstral-small-2": "devstral-small-2:latest",
    "qwen3-coder": "qwen3-coder:latest",
    "qwen3-30b-a3b": "qwen3-30b-a3b:latest",
}
def canonical(name):
    return ALIASES.get(name, name)
def file_hash(path):
    return sha256(path.read_bytes()).hexdigest()
def cell(score, source, attempts, tasks, note):
    return dict(percent=round(score * 100, 1), source=source, attempts=attempts, tasks=tasks, note=note,
                decisionAuthority=False)

historical = json.loads(HISTORICAL.read_text())
chat = json.loads(CHAT.read_text())
current = json.loads(CURRENT.read_text())
code = json.loads(CODE.read_text())
assert historical["decisionAuthority"] is False and historical["productionImported"] is False
assert current["decisionAuthority"] is False and current["notAHoldout"] is True
assert code["fullOracleAccepted"] is False
assert len(chat) == 400
matrix = defaultdict(dict)
for row in historical["summaries"]:
    matrix[canonical(row["model"])]
    role = row["role"]
    if role not in ROLES or role == "CODE":
        continue
    content = row.get("historicalContent") or {}
    score = content.get("completeMean")
    if score is not None:
        matrix[canonical(row["model"])][role] = cell(
            score, "H", content["attempts"], content["tasks"],
            "Historical development grading, known rubric limitations; not comparable with current suite."
        )
by_model = defaultdict(list)
assert sum(row["repeat"] == 1 for row in chat) == 399
assert [(row["model"], row["task"], row["repeat"]) for row in chat if row["repeat"] != 1] == [
    ("phi4:14b", "en_duplicate_events", 2)
]
for row in chat:
    assert 0 <= row["score"] <= 1
    by_model[canonical(row["model"])].append(row["score"])
assert len(by_model) == 10 and all(len(scores) == 40 for scores in by_model.values())
for model, scores in by_model.items():
    matrix[model]["CHAT"] = cell(
        statistics.mean(scores), "O", len(scores), 40,
        "One Opus reviewer of exposed development panel; no production system prompt."
    )
vision_runs = [row for row in current["selected"] if row["role"] == "VISION"]
assert len(vision_runs) == 3 and all(row["score"] is not None for row in vision_runs)
for row in vision_runs:
    matrix[canonical(row["model"])]["VISION"] = cell(
        row["score"], "V", row["responses"], row["taskCount"],
        "Current isolated VISION technical rubric; author probes only, no operational validation."
    )
for model in matrix:
    matrix[model]["CODE"] = None
for model in [canonical(row["model"]) for row in code["selected"]]:
    matrix[model]["CODE"] = None

result = {
    "status": "HUMAN_REVIEW_MATRIX_PREVIEW",
    "decisionAuthority": False,
    "modelAssignmentRecommendation": False,
    "roles": ROLES,
    "sources": {
        "H": {"path": str(HISTORICAL), "sha256": file_hash(HISTORICAL)},
        "O": {"path": str(CHAT), "sha256": file_hash(CHAT)},
        "V": {"path": str(CURRENT), "sha256": file_hash(CURRENT)},
        "CODE_component": {"path": str(CODE), "sha256": file_hash(CODE)},
    },
    "cells": {model: {role: matrix[model].get(role) for role in ROLES} for model in sorted(matrix)},
    "codeTechnicalOnly": [
        {"model": row["model"], "technicalPercent": round(row["technicalMean"] * 100, 1),
         "attempts": row["attempts"], "fullTaskScore": row["fullTaskScore"]}
        for row in code["selected"]
    ],
}
OUTPUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

lines = [
    "# GPU hunt — pracovní matice model × role",
    "",
    "**Stav: KONTROLA LIDMI / BEZ AUTORITY K PŘIŘAZENÍ.** Procenta jsou orientační výsledky",
    "ze tří různých vývojových zdrojů. Značka za číslem určuje zdroj; čísla s různou",
    "značkou se nesmějí vzájemně řadit. Pomlčka je chybějící platná známka, nikoli 0 %.",
    "Žádné číslo níže neprošlo společným posouzením GPT + Opus + operátor.",
    "",
    "| Model | D1 | D2 | CODE | R1 | R2 | CHAT | VISION |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
]
for model in sorted(matrix):
    values = []
    for role in ROLES:
        entry = result["cells"][model][role]
        values.append(f'{entry["percent"]:.1f} % {entry["source"]}' if entry else "—")
    lines.append("| " + model + " | " + " | ".join(values) + " |")
lines += [
    "",
    "**H** = staré vývojové známky z 20. 9. na dřívější sadě; jedno čtení, známé",
    "vady rubrik a neúplná pokrytí některých buněk. **O** = 400 CHAT rozhovorů",
    "ohodnocených Opusem; jeden hodnotitel s předchozí expozicí identitám a bez",
    "produkčního systémového promptu. **V** = aktuální izolovaná technická VISION",
    "sada, 23 úloh × 3 opakování; autorské sondy orákula, bez provozní kvalifikace.",
    "H a V u VISION ani H a O u CHAT se přímo neporovnávají.",
    "",
    "CODE je v hlavní matici záměrně prázdný: plné orákulum selhalo na pozitivní",
    "i negativní kontrole ještě před novou inferencí. Oddělená spustitelná dílčí",
    "komponenta na známých případech: qwen3.8 21/21 = 100,0 %, Devstral 15/21 =",
    "71,4 %. To **není** celé skóre CODE ani úspěšnost oprav v provozu.",
    "",
    "## Co z matice doporučuji prověřit jako první",
    "",
    "| Role | Přednostní srovnání | Důvod a omezení |",
    "|---|---|---|",
    "| D1 | qwen3.5 × qwen3.8 × qwen3.6 | Současné odpovědi všech tří jsou uložené, ale 72 odpovědí nemá přijaté známky. Historické rozdíly jsou malé. |",
    "| D2 | qwen3.8 × qwen3.6 × gemma4 | Současná trojice má totožné zadání; staré procento favorizuje qwen3.6, ale vyžaduje nové čtení odpovědí. |",
    "| CODE | qwen3.8 × Devstral | Nejprve přijmout opravené orákulum; dílčí technická výhoda qwen3.8 není doporučení k přiřazení. |",
    "| R1 | qwen3.8 × qwen3.6 × gemma4 × Devstral | Odpovědi čtyř artefaktů jsou uložené; rozhodne věcná revize, nikoli stará prahová čísla. |",
    "| R2 | Devstral × qwen3.6 × qwen3.8 | Současná trojice je připravena k ručnímu srovnání; historický výsledek Devstralu je varovný signál, ne prokázaná prohra. |",
    "| CHAT | qwen3.5 × qwen3.8 × gemma4 | Opusův pilot zvýhodňuje qwen3.8; ověřit sporné dialogy a skutečný systémový prompt. |",
    "| VISION | ornith × qwen3.8 × gemma4 | Aktuální rozdíl je malý; prověřit hlavně úlohy, kde se kandidáti rozcházejí. |",
    "",
    "Pracovní volba podle dostupných čísel: D1 qwen3.5 (náskok jen 1,5 p. b.",
    "před qwen3.8); D2 qwen3.6; R1 qwen3.8; R2 qwen3.5 (náskok jen 1,0 p. b.",
    "před qwen3.8); CHAT qwen3.8; VISION ornith (náskok 0,4 p. b. před qwen3.8).",
    "U CODE není platná pracovní volba. Tato pořadí **nemají rozhodovací autoritu**:",
    "D/R čísla jsou ze starší sady, CHAT z jednoho neslepého posudku a VISION",
    "z izolované technické sady. R1 a CODE navíc nesmí držet tentýž model.",
    "",
    "Toto jsou **priority revize**, nikoli návrhy na změnu bindingů. Každá role",
    "potřebuje doložené známky na stejné sadě a posouzení konkrétních sporných",
    "odpovědí. U nové izolované kampaně je všech 312 sémantických odpovědí stále",
    "bez známky. Oddělený balíček 120 odpovědí bez překryvu se starým je v",
    "[revizním formuláři](/home/belphareon/Projects/coworker/intentsmith-hunt-human-review-20260925/new-120/review.html).",
    "Je to vývojová sada, ne čerstvý přejímací holdout. Starých 192 odpovědí",
    "nelze po otevření jejich identit vydávat za slepé hodnocení.",
    "",
    "## Cesta k ověřenému doporučení v IntentSmithu",
    "",
    "1. U všech 312 sémantických odpovědí D1/D2/R1/R2 dokončit známky po",
    "   jednotlivých kritériích. Nových 120 odpovědí je odděleno pro revizi;",
    "   starých 192 po odhalení identity zůstává vývojovou evidencí. U CODE",
    "   nejprve opravit a přijmout orákulum; žádnou jeho plnou známku nenahrazovat",
    "   dílčí technickou komponentou. Sporné odpovědi a konkrétní důvody",
    "   projdeme spolu s Opusem a operátorem. Přepočet matice musí uvést pokrytí",
    "   a shodu posudků, nejen jedno procento.",
    "2. Až po kontrole lidských známek otestovat dva **nezávislé místní**",
    "   hodnotitele na dosud nepoužité zaslepené sadě. Oba musí dostat stejné",
    "   zadání a odpověď bez modelové identity i bez našich známek. V IntentSmithu",
    "   zobrazit vedle každé odpovědi lidskou kotvu, oba posudky, důvody a",
    "   rozpory. Přijetí hodnotitelů vyžaduje předem zamčené meze falešného",
    "   přijetí/odmítnutí a rozhodnutí o neshodách; shoda na známé vývojové sadě",
    "   nestačí. Do přijetí nesmějí hodnotitelé doporučovat výměnu role.",
    "3. Po přijetí hodnotitelů může hunt měřit a doporučit kandidáta pro",
    "   **jednu konkrétní roli** proti jejímu současnému modelu na párových",
    "   nezávislých provozních případech. Musí doložit zlepšení či nezhoršení",
    "   podle zamčeného pravidla, kritické chyby, rychlost a konflikty rolí",
    "   (zejména CODE/R1). NEROZHODNUTO znamená ponechat model a sebrat další",
    "   případy, nikoli vynutit vítěze. Samostatné přepínání zůstává poslední fází.",
    "4. Závěrečná zkouška: hunt objeví několik nových modelů, bezpečně je",
    "   stáhne, zaznamená přesnou identitu a průběh, otestuje a nechá místní",
    "   hodnotitele oznámkovat. Doporučení nejprve zkontroluji já, potom",
    "   operátor a Opus. Teprve taková prověrka může otevřít rozhodovací bránu.",
    "",
    "## Přesné zdroje",
    "",
]
for name, source in result["sources"].items():
    lines.append(f'- {name}: {source["path"]} · SHA256 `{source["sha256"]}`')
lines += ["", "Strojové buňky a jejich pokrytí: [JSON](evidence/2026-09-25-hunt-human-matrix-preview.json).", ""]
OUTPUT_MD.write_text("\n".join(lines))
print(json.dumps({"models": len(matrix), "roles": len(ROLES), "chatScores": len(chat),
                  "visionRuns": len(vision_runs), "markdown": str(OUTPUT_MD),
                  "json": str(OUTPUT_JSON)}, ensure_ascii=False))
