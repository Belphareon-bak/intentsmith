#!/usr/bin/env python3
"""Validate two sealed CHAT captures and build a derived view for blind review.

The first run may be partial only because the second model was interrupted. The
second run must be a sealed one-model continuation. Originals remain untouched.
"""
import argparse
import hashlib
import json
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def read(path):
    raw = path.read_bytes()
    return json.loads(raw), sha(raw), raw


def plan_at(directory):
    plan, file_sha, _ = read(directory / 'plan.json')
    declared = plan.get('planSha256')
    material = {key: value for key, value in plan.items() if key != 'planSha256'}
    require(sha(encoded(material)) == declared, 'PLAN_HASH')
    return plan, file_sha


def require(condition, reason):
    if not condition:
        raise ValueError('CHAT_PAIR_MERGE_INVALID:' + reason)


def captured(run, rows, model, digest, tasks, provider):
    expected = {task['id'] for task in tasks}
    require(len(rows) == len(expected), 'ATTEMPT_COUNT')
    by_task = {}
    files = {}
    for row in rows:
        task = next((task for task in tasks if task['id'] + '-' + sha(model.encode())[:8] == row.get('id')), None)
        require(task is not None and row.get('role') == 'CHAT' and row.get('model') == model
                and row.get('status') == 'CAPTURED' and row.get('proof') == 'RESPONSE_BOUND', 'ATTEMPT_SUMMARY')
        require(task['id'] not in by_task, 'DUPLICATE_TASK')
        attempt_path = run / ('attempt-' + row['id'] + '.json')
        value, file_sha, raw = read(attempt_path)
        require(value.get('id') == row['id'] and value.get('task') == task['id']
                and value.get('model') == model and value.get('status') == 'CAPTURED'
                and value.get('proof') == 'RESPONSE_BOUND' and value.get('fullGpu') is True
                and value.get('artifact', {}).get('digestSha256') == digest, 'ATTEMPT_FILE')
        dialogue = value.get('dialogue', [])
        receipts = value.get('receipts', [])
        require(len(dialogue) == len(task['turns']) and
                [turn.get('input') for turn in dialogue] == task['turns'] and
                len(receipts) >= len(dialogue), 'DIALOGUE')
        for receipt in receipts:
            body, data, placement = receipt.get('body') or {}, receipt.get('data') or {}, receipt.get('placement') or {}
            require(body.get('model') == model and body.get('options', {}).get('num_ctx') == 4096
                    and body.get('think') is False and data.get('provider_version') == provider
                    and (data.get('digest') or data.get('model_digest_sha256') or '').removeprefix('sha256:') == digest
                    and data.get('done') is True and data.get('done_reason') == 'stop'
                    and isinstance(data.get('message', {}).get('content'), str)
                    and placement.get('size', 0) > 0
                    and placement.get('size_vram', -1) >= placement.get('size', 0), 'RECEIPT_PROFILE')
        by_task[task['id']] = row
        files[row['id']] = {'sha256': file_sha, 'raw': raw}
    require(set(by_task) == expected, 'TASK_COVERAGE')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('first-run', 'second-run', 'tasks', 'out'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    first, second, out = args.first_run.resolve(), args.second_run.resolve(), args.out.resolve()
    require(not out.exists(), 'OUTPUT_EXISTS')
    first_plan, first_plan_file_sha = plan_at(first)
    second_plan, second_plan_file_sha = plan_at(second)
    first_result, first_result_sha, _ = read(first / 'result.json')
    second_result, second_result_sha, _ = read(second / 'result.json')
    tasks, task_file_sha, _ = read(args.tasks)
    require(isinstance(tasks, list) and len(tasks) == 40
            and len({task.get('id') for task in tasks}) == 40
            and all(task.get('role') == 'CHAT' and 1 <= len(task.get('turns', [])) <= 4 for task in tasks), 'TASKS')
    continuation = second_plan.get('continuationOf') or {}
    first_pairs, second_pairs = first_plan.get('pairs', {}).get('CHAT', []), second_plan.get('pairs', {}).get('CHAT', [])
    require(first_plan.get('roles') == second_plan.get('roles') == ['CHAT']
            and len(first_pairs) == 2 and len(second_pairs) == 1
            and first_pairs[1] == second_pairs[0]
            and first_plan.get('providerVersion') == second_plan.get('providerVersion')
            and first_plan.get('taskFileSha256') == second_plan.get('taskFileSha256') == task_file_sha
            and first_plan.get('benchmarkSha256') == second_plan.get('benchmarkSha256')
            and first_plan.get('tasks') == second_plan.get('tasks') == tasks
            and first_plan.get('repeats') == second_plan.get('repeats') == 1
            and first_plan.get('decisionAuthority') is second_plan.get('decisionAuthority') is False
            and first_result.get('planSha256') == first_plan.get('planSha256')
            and second_result.get('planSha256') == second_plan.get('planSha256')
            and first_result.get('status') in ('BLOCKED', 'COLLECTION_PARTIAL')
            and second_result.get('status') == 'COLLECTION_COMPLETE'
            and not second_result.get('unattempted'), 'RUN_LINEAGE')
    require(continuation.get('priorRunPath') == str(first)
            and continuation.get('priorPlanSha256') == first_plan['planSha256']
            and continuation.get('priorPlanFileSha256') == first_plan_file_sha
            and continuation.get('priorResultFileSha256') == first_result_sha
            and continuation.get('preservedModel') == first_pairs[0]['model']
            and continuation.get('preservedDigestSha256') == first_pairs[0]['artifact']['digestSha256'], 'CONTINUATION_SEAL')
    for file, digest in first_plan.get('sourceHashes', {}).items():
        if file != 'scripts/manual/conversation-operational-handoff.mjs':
            require(second_plan.get('sourceHashes', {}).get(file) == digest, 'HANDLER_CHANGED:' + file)
    first_rows = [row for row in first_result['attempts'] if row.get('model') == first_pairs[0]['model']]
    second_rows = second_result['attempts']
    require(not any(row.get('model') != first_pairs[0]['model'] for row in first_result['attempts'] if row.get('status') == 'CAPTURED')
            and len(second_rows) == len(tasks), 'EXTRA_CAPTURE')
    first_files = captured(first, first_rows, first_pairs[0]['model'], first_pairs[0]['artifact']['digestSha256'], tasks, first_plan['providerVersion'])
    second_files = captured(second, second_rows, second_pairs[0]['model'], second_pairs[0]['artifact']['digestSha256'], tasks, first_plan['providerVersion'])
    require({key: row['sha256'] for key, row in first_files.items()} == continuation.get('preservedAttemptFileSha256'), 'PRESERVED_FILES_CHANGED')
    require(not set(first_files).intersection(second_files), 'ATTEMPT_ID_COLLISION')
    sources = [
        {'kind': 'preserved_first_model', 'path': str(first), 'planSha256': first_plan['planSha256'],
         'planFileSha256': first_plan_file_sha, 'resultFileSha256': first_result_sha},
        {'kind': 'one_model_continuation', 'path': str(second), 'planSha256': second_plan['planSha256'],
         'planFileSha256': second_plan_file_sha, 'resultFileSha256': second_result_sha},
    ]
    merged_plan = {'status': 'DERIVED_MERGED_VIEW', 'roles': ['CHAT'], 'providerVersion': first_plan['providerVersion'],
        'tasks': tasks, 'pairs': first_plan['pairs'], 'taskFileSha256': task_file_sha,
        'profile': first_plan['profile'], 'decisionAuthority': False,
        'operationPolicy': {'productionImported': False, 'bindings': False, 'deletion': False, 'timer': False},
        'sourceRunLineage': sources}
    merged_plan['planSha256'] = sha(encoded(merged_plan))
    merged_result = {'status': 'COLLECTION_COMPLETE', 'derivedView': True,
        'planSha256': merged_plan['planSha256'], 'attempts': first_rows + second_rows,
        'unattempted': [], 'decisionAuthority': False, 'sourceRunLineage': sources}
    out.mkdir(mode=0o700)
    def write(name, raw):
        with (out / name).open('xb') as stream:
            stream.write(raw)
    write('plan.json', (json.dumps(merged_plan, ensure_ascii=False, indent=2) + '\n').encode())
    write('result.json', (json.dumps(merged_result, ensure_ascii=False, indent=2) + '\n').encode())
    for attempt_id, row in {**first_files, **second_files}.items():
        write('attempt-' + attempt_id + '.json', row['raw'])
    write('manifest.json', (json.dumps({'status': 'DERIVED_VIEW_NOT_ORIGINAL_RUN', 'decisionAuthority': False,
        'sourceRunLineage': sources, 'attemptFileSha256': {key: row['sha256'] for key, row in {**first_files, **second_files}.items()}}, indent=2) + '\n').encode())
    print(json.dumps({'status': 'DERIVED_VIEW_NOT_ORIGINAL_RUN', 'attempts': 80,
        'planSha256': merged_plan['planSha256'], 'out': str(out)}))


if __name__ == '__main__':
    main()
