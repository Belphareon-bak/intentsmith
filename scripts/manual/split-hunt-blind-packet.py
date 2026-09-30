#!/usr/bin/env python3
"""Separate previously exposed answers from a development blind-review packet.

This reads only the two anonymous packets. It never reads identity keys and
never labels either packet a fresh holdout or accepted grader evidence.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def observation(case):
    fields = ("role", "task", "repeat", "question", "rubric", "response")
    return json.dumps([case.get(field) for field in fields], ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--current-html", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    current = json.loads(args.current.read_text())
    previous = json.loads(args.previous.read_text())
    if current.get("notFreshHoldout") is not True or previous.get("notFreshHoldout") is not True:
        raise ValueError("both sources must remain development-only")
    older = Counter(observation(case) for case in previous["cases"])
    new_cases = []
    overlap = 0
    for case in current["cases"]:
        key = observation(case)
        if older[key]:
            older[key] -= 1
            overlap += 1
        else:
            new_cases.append(case)
    if overlap != len(previous["cases"]) or any(older.values()) or len(new_cases) != 120:
        raise ValueError(f"unexpected overlap: {overlap}, remaining={sum(older.values())}, new={len(new_cases)}")

    ids = {case["id"] for case in new_cases}
    if len(ids) != len(new_cases):
        raise ValueError("duplicate case ID")
    packet = dict(current)
    packet["cases"] = new_cases
    packet["note"] = (
        "Only observations absent from the previous 192-case development packet. "
        "Still known development tasks; content and style may reveal model identity. "
        "No grader acceptance or decision authority."
    )
    packet_bytes = (json.dumps(packet, ensure_ascii=False, indent=2) + "\n").encode()
    packet_hash = sha256(packet_bytes).hexdigest()

    html = args.current_html.read_text()
    cards = list(re.finditer(r"<article>.*?</article>", html, re.S))
    if len(cards) != len(current["cases"]):
        raise ValueError(f"HTML card count {len(cards)} differs from packet")
    retained = []
    for match in cards:
        id_match = re.search(r"<small>([^<]+)</small>", match.group())
        if not id_match:
            raise ValueError("card without case ID")
        if id_match.group(1) in ids:
            retained.append(match.group())
    if len(retained) != len(new_cases):
        raise ValueError("HTML and packet have different IDs")
    prefix = html[:cards[0].start()]
    suffix = html[cards[-1].end():]
    old_hash = digest(args.current)
    if old_hash not in prefix or old_hash not in suffix:
        raise ValueError("HTML is not bound to source packet")
    subset_html = (prefix + "".join(retained) + suffix).replace(old_hash, packet_hash)
    subset_html = subset_html.replace(f"{len(current['cases'])} odpovědí", f"{len(new_cases)} odpovědí")
    if len(re.findall(r"<article>.*?</article>", subset_html, re.S)) != len(new_cases):
        raise ValueError("filtered HTML card count changed")
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / "packet.json").write_bytes(packet_bytes)
    (args.out / "review.html").write_text(subset_html)
    manifest = {
        "status": "DEVELOPMENT_REVIEW_NOT_GRADED",
        "decisionAuthority": False,
        "notFreshHoldout": True,
        "currentPacketSha256": old_hash,
        "previousPacketSha256": digest(args.previous),
        "newPacketSha256": packet_hash,
        "overlapExcluded": overlap,
        "newCases": len(new_cases),
        "newByRole": dict(Counter(case["role"] for case in new_cases)),
        "htmlSha256": digest(args.out / "review.html"),
        "identityKeysRead": False,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
