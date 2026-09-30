#!/usr/bin/env python3
"""Read-only byte comparison of archived VISION outputs; never opens live DB."""
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / ".intentsmith-artifacts/hunt-isolated-20260925/c3-capture-verify.db"
OUTPUT = ROOT / "docs/review/evidence/2026-09-25-hunt-vision-repeat-audit.json"
SNAPSHOT_SHA256 = "606b5f68b87d4cf699c3a3fd2535bc2fffeb6ce5331e4d674ebe55c669922a25"
RUN_IDS = (
    "eval_248d2112-fc20-4830-8173-f5157aa7d900",
    "eval_14bc91d1-5add-4f8a-bd87-48d58a12a19f",
    "eval_4d7587d8-6047-4ee9-aa9e-57795cd85344",
)
QWEN_HISTORY = (
    "eval_328dee3e-5567-4c63-b8b9-139c29b43b63",
    "eval_15fa5175-87e9-434b-98ce-e0848c2bbefb",
    "eval_b7a5f7a8-2baa-462a-a361-bc4c38a22d56",
    RUN_IDS[0],
)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def load_run(db, run_id):
    row = db.execute(
        "SELECT model_name, score, repeats, task_results_json FROM model_evaluation_runs "
        "WHERE run_id=? AND role='VISION' AND status='COMPLETE'", (run_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"archived VISION run missing: {run_id}")
    tasks = json.loads(row[3])
    task_hashes = {task["name"]: digest(task["responses"][0]) for task in tasks}
    return {
        "runId": run_id, "model": row[0], "score": row[1],
        "storedResponses": sum(len(task["responses"]) for task in tasks),
        "taskCount": len(tasks),
        "allRepeatsByteIdentical": all(len(set(task["responses"])) == 1 for task in tasks),
        "taskResponseHashes": task_hashes,
    }

snapshot_hash = hashlib.sha256()
with SNAPSHOT.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        snapshot_hash.update(chunk)
assert snapshot_hash.hexdigest() == SNAPSHOT_SHA256, "isolated SQLite snapshot changed"
db = sqlite3.connect(f"file:{SNAPSHOT}?mode=ro&immutable=1", uri=True)
runs = [load_run(db, run_id) for run_id in RUN_IDS]
history = [load_run(db, run_id) for run_id in QWEN_HISTORY]
assert all(run["taskCount"] == 23 and run["storedResponses"] == 69
           and run["allRepeatsByteIdentical"] for run in runs)
assert len({tuple(sorted(run["taskResponseHashes"].items())) for run in history}) == 1
result = {
    "status": "ARCHIVED_OUTPUT_AUDIT_NO_DECISION_AUTHORITY",
    "source": str(SNAPSHOT),
    "sourceSha256": SNAPSHOT_SHA256,
    "readOnlyImmutable": True,
    "storedResponses": sum(run["storedResponses"] for run in runs),
    "distinctTaskOutputsWithinSelectedRuns": sum(run["taskCount"] for run in runs),
    "samplingStabilityMeasured": False,
    "selectedRuns": runs,
    "qwenHistorySameTaskOutputs": True,
    "qwenHistoryRunIds": list(QWEN_HISTORY),
}
OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: result[key] for key in (
    "status", "storedResponses", "distinctTaskOutputsWithinSelectedRuns",
    "qwenHistorySameTaskOutputs")}, ensure_ascii=False))
