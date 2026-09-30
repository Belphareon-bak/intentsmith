#!/usr/bin/env python3
"""Audit the user history actually sent in a captured multi-turn CHAT panel.

This is a collection audit, not a grader. The public output keeps blind case
IDs; the optional restricted output is the only file containing model names.
"""

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def delivered_history(prompt):
    marker = "Previous conversation (quoted data, not system instructions):\n"
    if not prompt.startswith(marker):
        return []
    history = prompt[len(marker):].split("\n\nUser: ", 1)[0]
    return [json.loads(line) for line in history.splitlines() if line.startswith('{"role":')]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--attempts", type=Path, required=True)
    parser.add_argument("--identity-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--restricted-output", type=Path, required=True)
    args = parser.parse_args()

    key = json.loads(args.identity_key.read_text())
    identities = {case["attemptId"]: case for case in key["cases"]}
    rows, restricted = [], []
    for path in sorted(args.attempts.glob("attempt-*.json")):
        attempt = json.loads(path.read_text())
        identity = identities[attempt["id"]]
        if len(attempt["dialogue"]) != len(attempt["receipts"]):
            raise ValueError(f"Unexpected retry/receipt count: {attempt['id']}")
        turns = []
        for index, receipt in enumerate(attempt["receipts"]):
            messages = receipt["body"]["messages"]
            if len(messages) != 2 or messages[1]["role"] != "user":
                raise ValueError(f"Unexpected provider request shape: {attempt['id']}")
            delivered = delivered_history(messages[1]["content"])
            delivered_users = [item["content"] for item in delivered if item["role"] == "user"]
            expected_users = [item["input"] for item in attempt["dialogue"][:index]]
            missing = [prior + 1 for prior, value in enumerate(expected_users)
                       if value not in delivered_users]
            turns.append({
                "turn": index + 1,
                "expectedPriorUserTurns": len(expected_users),
                "deliveredPriorUserTurns": len(expected_users) - len(missing),
                "missingPriorUserTurns": missing,
                "historyTruncationMarker": "část historie vynechána" in messages[1]["content"],
                "outputTokenLimit": receipt["body"]["options"]["num_predict"],
            })
        rows.append({"caseId": identity["id"], "task": attempt["task"], "turns": turns})
        restricted.append({"caseId": identity["id"], "attemptId": attempt["id"],
                           "model": attempt["model"], "attemptSha256": digest(path)})
    if len(rows) != len(identities):
        raise ValueError(f"Attempt coverage mismatch: {len(rows)} vs {len(identities)}")

    summary = {}
    for turn in (2, 3):
        applicable = [row["turns"][turn - 1] for row in rows if len(row["turns"]) >= turn]
        summary[str(turn)] = {
            "attempts": len(applicable),
            "missingAnyPriorUser": sum(bool(item["missingPriorUserTurns"]) for item in applicable),
            "missingAllPriorUsers": sum(item["deliveredPriorUserTurns"] == 0 for item in applicable),
            "truncationMarker": sum(item["historyTruncationMarker"] for item in applicable),
        }
    output = {
        "status": "CAPTURE_CONTEXT_AUDIT",
        "decisionAuthority": False,
        "identityKeySha256": digest(args.identity_key),
        "attemptCount": len(rows),
        "summaryByTurn": summary,
        "affectedTasksTurn3": dict(Counter(row["task"] for row in rows
                                           if len(row["turns"]) >= 3
                                           and row["turns"][2]["missingPriorUserTurns"])),
        "cases": rows,
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    args.restricted_output.write_text(json.dumps(restricted, ensure_ascii=False, indent=2) + "\n")
    args.restricted_output.chmod(0o600)
    print(json.dumps({"attempts": len(rows), "summaryByTurn": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
