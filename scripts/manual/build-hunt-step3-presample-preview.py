#!/usr/bin/env python3
"""Render the preselected operator sample without revealing model identities."""

import argparse
import hashlib
import html
import json
import re
from pathlib import Path


def esc(value):
    escaped = html.escape(str(value), quote=True)
    return re.sub(r"[ \t]+(?=\n|$)",
                  lambda match: "".join("&#9;" if char == "\t" else "&#32;" for char in match.group()),
                  escaped)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--sample", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    packet_bytes = args.packet.read_bytes()
    packet = json.loads(packet_bytes)
    sample = json.loads(args.sample.read_text())
    packet_sha = hashlib.sha256(packet_bytes).hexdigest()
    if sample["packetSha256"] != packet_sha or sample["decisionAuthority"] is not False:
        raise SystemExit("sample does not match packet or claims decision authority")
    cases = {case["id"]: case for case in packet["cases"]}
    if len(cases) != len(packet["cases"]):
        raise SystemExit("duplicate packet case")
    groups = {}
    for review in sample["items"]:
        case = cases[review["id"]]
        if review["role"] != case["role"] or review["task"] != case["task"]:
            raise SystemExit("review identity does not match packet")
        if review["label"] != case["label"] or review["repeat"] != case["repeat"]:
            raise SystemExit("review label does not match packet")
        if len(review["criterionReviews"]) not in (0, len(case["rubric"])):
            raise SystemExit("criterion count does not match packet")
        groups.setdefault((case["role"], case["task"]), []).append((case, review))

    parts = ["<!doctype html><html lang='cs'><meta charset='utf-8'>",
             "<title>GPU Hunt – předvolený vzorek k revizi</title>",
             "<style>body{font:15px/1.5 system-ui;background:#111;color:#eee;max-width:1200px;margin:auto;padding:24px}"
             "h1,h2{color:#e3b76d}section,article{border:1px solid #555;border-radius:8px;padding:16px;margin:16px 0}"
             "article{background:#1c1c1c}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101010;padding:12px;border-radius:5px}"
             "small,.muted{color:#aaa}.score{font-weight:bold;color:#8fd2a7}.issue{color:#ffcc7a}</style><body>",
             "<h1>GPU Hunt: předem vybraný vzorek</h1>",
             "<p>26 odpovědí na stejná zadání napříč anonymními kandidáty. A/B/C/D jsou náhodné štítky modelů, číslo je opakování. "
             "Známky jsou předběžné posouzení Codexu; nejsou rozsouzené ani použitelné k výběru modelu.</p>",
             f"<p class='muted'>SHA256 kanonického packetu: <code>{esc(packet_sha)}</code></p>"]
    for (role, task), rows in sorted(groups.items()):
        question = rows[0][0]["question"]
        parts.append(f"<section><h2>{esc(role)} · {esc(task)}</h2><h3>Zadání testu</h3><pre>{esc(question)}</pre>")
        for case, review in sorted(rows, key=lambda item: (item[0]["label"], item[0]["repeat"])):
            parts.append(f"<article><h3>Anonymní kandidát {esc(case['label'])} · pokus {case['repeat']}</h3>")
            parts.append(f"<small>ID odpovědi: {esc(case['id'])}</small>")
            parts.append(f"<h4>Odpověď</h4><pre>{esc(case['response'])}</pre>")
            if review["criterionReviews"]:
                for index, criterion in enumerate(review["criterionReviews"]):
                    if criterion["index"] != index + 1:
                        raise SystemExit("criterion order does not match packet")
                    parts.append(f"<p><strong>Kritérium {index+1}:</strong> {esc(case['rubric'][index])}</p>")
                    parts.append(f"<p class='score'>Předběžná známka: {criterion['score']:.2f} / 1</p>")
                    parts.append(f"<p>Odůvodnění: {esc(criterion['reason'])}</p>")
            else:
                parts.append("<p class='issue'>Známka nevydána: vada zadání nebo potřebného kontextu.</p>")
            parts.append(f"<p class='muted'>Jistota posudku: {esc(review['confidence'])}</p></article>")
        parts.append("</section>")
    parts.append("</body></html>\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(parts))
    print(f"{len(sample['items'])} answers, {len(groups)} tests → {args.output}")


if __name__ == "__main__":
    main()
