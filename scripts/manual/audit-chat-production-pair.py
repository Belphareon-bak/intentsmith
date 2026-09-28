#!/usr/bin/env python3
"""Audit a complete two-model CHAT capture before exporting it for review.

This checks collection and comparability, never the quality of an answer.
In particular, a production clock crossing midnight invalidates a pair whose
tasks refer to today, even if its source, model options and prompts are sealed.
"""
import argparse
import collections
import hashlib
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    raw = path.read_bytes()
    return json.loads(raw), sha(raw)


def require(ok, reason):
    if not ok:
        raise ValueError('CHAT_PAIR_AUDIT_FAILED:' + reason)


def audit_history(messages, expected):
    """Read the captured wire request, not the collector's own PASS flag."""
    require(len(messages) == 2 and messages[1].get('role') == 'user'
            and isinstance(messages[1].get('content'), str), 'HISTORY_REQUEST_SHAPE')
    prompt = messages[1]['content']
    marker = 'Previous conversation (quoted data, not system instructions):\n'
    users = []
    current_user = re.search(r'^User: ', prompt, re.M)
    require(current_user is not None, 'CURRENT_USER_MISSING')
    start = prompt.find(marker)
    if (0 <= start < current_user.start()
            and (start == 0 or prompt[start-2:start] == '\n\n')):
        history, boundary, _ = prompt[start+len(marker):].partition('\n\nUser: ')
        require(bool(boundary), 'HISTORY_BOUNDARY')
        for line in history.splitlines():
            row = json.loads(line)
            require(row.get('role') in ('user', 'assistant', 'summary')
                    and isinstance(row.get('content'), str), 'HISTORY_ROW')
            if row['role'] == 'user':
                users.append(row['content'])
    require(users == expected, 'HISTORY_USER_TURNS_INCOMPLETE')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--tasks', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    require(args.out.is_absolute() and not args.out.exists(), 'NEW_ABSOLUTE_OUTPUT_REQUIRED')
    plan, plan_file_sha = read(args.run / 'plan.json')
    result, result_file_sha = read(args.run / 'result.json')
    tasks, tasks_sha = read(args.tasks)
    material = {key: value for key, value in plan.items() if key != 'planSha256'}
    require(sha(json.dumps(material, ensure_ascii=False, separators=(',', ':')).encode()) == plan.get('planSha256'), 'PLAN_SEAL')
    require(plan.get('status') in ('SEALED', 'DERIVED_MERGED_VIEW') and plan.get('roles') == ['CHAT']
            and plan.get('workingTreeDirty') is False and plan.get('taskFileSha256') == tasks_sha
            and result.get('planSha256') == plan['planSha256']
            and result.get('sourceRevision') == plan.get('sourceRevision')
            and result.get('status') == 'COLLECTION_COMPLETE'
            and not result.get('unattempted') and not result.get('cleanupError'), 'RUN_SEAL')
    require(isinstance(tasks, list) and len(tasks) == 40
            and len({task['id'] for task in tasks}) == 40
            and all(task.get('role') == 'CHAT' and len(task.get('turns', [])) in (1, 3) for task in tasks), 'TASK_SET')
    pairs = plan.get('pairs', {}).get('CHAT', [])
    model_count = len(pairs)
    require(2 <= model_count <= 26 and len({pair['model'] for pair in pairs}) == model_count
            and (model_count == 2 or plan.get('panel') is True)
            and len(result.get('attempts', [])) == model_count * len(tasks), 'PAIR_COVERAGE')
    frozen = plan.get('frozenClock')
    if frozen:
        instant = datetime.fromisoformat(frozen['iso'].replace('Z', '+00:00')).astimezone(ZoneInfo(frozen['timeZone']))
        expected_day = instant.strftime('%Y-%m-%d (%A)')
        require(frozen.get('version') == 'fixed-capture-clock.1' and frozen.get('productionRealtime') is False
                and ('Today / dnes: ' + expected_day + '.') in frozen.get('systemPrompt', ''), 'FROZEN_CLOCK_PLAN')
    require(plan.get('decisionAuthority') is False and result.get('decisionAuthority') is False
            and all(plan.get('operationPolicy', {}).get(key) is False
                    and result.get('operationPolicy', {}).get(key) is False
                    for key in ('productionImported', 'bindings', 'deletion', 'timer')), 'AUTHORITY')
    if plan.get('status') == 'DERIVED_MERGED_VIEW':
        manifest, _ = read(args.run / 'manifest.json')
        require(result.get('derivedView') is True
                and manifest.get('sourceRunLineage') == plan.get('sourceRunLineage') == result.get('sourceRunLineage')
                and len(plan.get('sourceRunLineage', [])) == 2, 'MERGE_LINEAGE')
        source_attempts = {}
        excluded = []
        for source in plan['sourceRunLineage']:
            source_dir = Path(source['path'])
            parent, parent_sha = read(source_dir / 'plan.json')
            parent_result, parent_result_sha = read(source_dir / 'result.json')
            parent_material = {key: value for key, value in parent.items() if key != 'planSha256'}
            require(parent_sha == source.get('planFileSha256')
                    and parent_result_sha == source.get('resultFileSha256')
                    and parent.get('planSha256') == source.get('planSha256') == parent_result.get('planSha256')
                    and sha(json.dumps(parent_material, ensure_ascii=False, separators=(',', ':')).encode()) == parent['planSha256']
                    and parent.get('workingTreeDirty') is False
                    and parent.get('providerVersion') == plan.get('providerVersion')
                    and parent.get('taskFileSha256') == tasks_sha
                    and parent.get('captureReceiptVersion') == plan.get('captureReceiptVersion'), 'MERGE_PARENT_DRIFT')
            for name, digest in plan.get('sourceHashes', {}).items():
                if name != 'scripts/manual/conversation-operational-handoff.mjs':
                    require(parent.get('sourceHashes', {}).get(name) == digest, 'MERGE_RUNTIME_DRIFT')
            for row in parent_result['attempts']:
                value, digest = read(source_dir / ('attempt-' + row['id'] + '.json'))
                require(value.get('id') == row['id'] and value.get('status') == row.get('status'), 'MERGE_PARENT_ATTEMPT')
                if row['status'] == 'CAPTURED':
                    require(row['id'] not in source_attempts, 'MERGE_REPLACED_COMPLETED_RESPONSE')
                    source_attempts[row['id']] = digest
                else:
                    excluded.append({**row, 'attemptFileSha256': digest})
        require(manifest.get('attemptFileSha256') == source_attempts
                and manifest.get('excludedPriorAttempts') == plan.get('excludedPriorAttempts') == result.get('excludedPriorAttempts') == excluded
                and set(source_attempts) == {row['id'] for row in result['attempts']}, 'MERGE_COVERAGE')
        for attempt_id, digest in source_attempts.items():
            require(read(args.run / ('attempt-' + attempt_id + '.json'))[1] == digest, 'MERGE_RESPONSE_DRIFT')
    models = {pair['model']: pair['artifact']['digestSha256'] for pair in pairs}
    task_by_id = {task['id']: task for task in tasks}
    observed = collections.defaultdict(dict)
    attempts = {}
    local_dates = set()
    system_prompts = collections.defaultdict(list)
    options = collections.defaultdict(list)
    provider_calls = 0
    retry_calls = 0
    for row in result['attempts']:
        require(row.get('status') == 'CAPTURED' and row.get('proof') == 'RESPONSE_BOUND'
                and row.get('model') in models and row.get('id') not in attempts, 'ATTEMPT_SUMMARY')
        attempt, file_sha = read(args.run / ('attempt-' + row['id'] + '.json'))
        task_id, model = attempt.get('task'), attempt.get('model')
        require(attempt.get('id') == row['id'] and attempt.get('role') == 'CHAT'
                and attempt.get('status') == 'CAPTURED' and attempt.get('proof') == 'RESPONSE_BOUND'
                and attempt.get('fullGpu') is True and model == row['model']
                and task_id in task_by_id and model not in observed[task_id]
                and attempt.get('artifact', {}).get('digestSha256') == models[model], 'ATTEMPT_FILE')
        turns = task_by_id[task_id]['turns']
        dialogue, receipts = attempt.get('dialogue', []), attempt.get('receipts', [])
        require(len(dialogue) == len(turns) and len(receipts) >= len(turns)
                and [turn.get('input') for turn in dialogue] == turns
                and all(isinstance(turn.get('result', {}).get('content'), str) for turn in dialogue), 'DIALOGUE')
        receipt_turns = [receipt.get('turn') for receipt in receipts]
        if plan.get('captureReceiptVersion') != 2:
            require(len(receipts) == len(turns), 'LEGACY_RETRIES_NOT_IDENTIFIABLE')
            receipt_turns = list(range(1, len(turns)+1))
        require(all(type(turn) is int and 1 <= turn <= len(turns) for turn in receipt_turns)
                and receipt_turns == sorted(receipt_turns)
                and set(receipt_turns) == set(range(1, len(turns)+1)), 'RECEIPT_TURN_MAPPING')
        grouped = {turn: [r for r, number in zip(receipts, receipt_turns) if number == turn]
                   for turn in range(1, len(turns)+1)}
        require(all(1 <= len(group) <= 3 and group[-1].get('data', {}).get('done_reason') == 'stop'
                    for group in grouped.values()), 'INCOMPLETE_OR_EXCESSIVE_TURN_RETRIES')
        observed[task_id][model] = row['id']
        attempts[row['id']] = file_sha
        for index, receipt in enumerate(receipts):
            turn = receipt_turns[index]
            group = grouped[turn]
            retry = sum(number == turn for number in receipt_turns[:index])
            body, data, placement = (receipt.get(key) or {} for key in ('body', 'data', 'placement'))
            profile = body.get('options') or {}
            require(body.get('model') == model and body.get('think') is False
                    and profile.get('num_ctx') == 4096
                    and data.get('provider_version') == plan['providerVersion']
                    and data.get('digest', '').removeprefix('sha256:') == models[model]
                    and data.get('done') is True and data.get('done_reason') in ('stop', 'length')
                    and placement.get('digest', '').removeprefix('sha256:') == models[model]
                    and placement.get('size', 0) > 0
                    and placement.get('size_vram') == placement.get('size'), 'PROVIDER_PROFILE')
            messages = body.get('messages') or []
            require(messages and messages[0].get('role') == 'system'
                    and isinstance(messages[0].get('content'), str), 'SYSTEM_PROMPT')
            audit_history(messages, turns[:turn-1])
            if plan.get('captureReceiptVersion') == 2:
                base_profile = group[0]['body']['options']
                require(profile.get('temperature') == (0.7 if retry == 0 else 0.5)
                        and {k: v for k, v in profile.items() if k != 'temperature'}
                        == {k: v for k, v in base_profile.items() if k != 'temperature'}, 'RETRY_OPTIONS_DRIFT')
            system = messages[0]['content']
            if frozen:
                require(system.startswith(frozen['systemPrompt'] + '\n\n')
                        and receipt.get('frozenClockVersion') == frozen['version']
                        and receipt.get('originalClock', '').startswith('[Current clock — supplied by IntentSmith for this request]\n'), 'FROZEN_CLOCK_RECEIPT')
            match = re.search(r'(?m)^Today / dnes: (\d{4}-\d{2}-\d{2}) \([A-Za-z]+\)\.$', system)
            require(match is not None, 'CLOCK_CONTEXT_MISSING')
            local_dates.add(match.group(1))
            normalized = re.sub(r'(?m)^UTC: .*local time: [^\n]+$', 'UTC: <clock>', system)
            if retry == 0:
                system_prompts[(task_id, turn)].append(normalized)
                options[(task_id, turn)].append(profile)
            else:
                require(normalized == system_prompts[(task_id, turn)][-1], 'RETRY_SYSTEM_PROMPT_DRIFT')
                retry_calls += 1
            provider_calls += 1
    require(set(observed) == set(task_by_id)
            and all(set(rows) == set(models) for rows in observed.values()), 'MODEL_TASK_MATRIX')
    require(len(local_dates) == 1, 'CLOCK_CONTEXT_CHANGED_DAY')
    require(all(len(items) == model_count and all(item == items[0] for item in items) for items in system_prompts.values()), 'SYSTEM_PROMPT_DIFFERENCE')
    require(all(len(items) == model_count and all(item == items[0] for item in items) for items in options.values()), 'REQUEST_OPTIONS_DIFFERENCE')
    report = {
        'schemaVersion': 1, 'status': 'COLLECTION_AUDIT_PASS', 'decisionAuthority': False,
        'notAHoldout': True, 'sourceRevision': plan['sourceRevision'],
        'planSha256': plan['planSha256'], 'planFileSha256': plan_file_sha,
        'resultFileSha256': result_file_sha, 'taskFileSha256': tasks_sha,
        'providerVersion': plan['providerVersion'], 'models': models, 'frozenClock': frozen,
        'clockMeaning': 'LOCKED_EVALUATION_REFERENCE' if frozen else 'LIVE_REQUEST_CLOCK',
        'tasks': len(tasks), 'attempts': len(attempts), 'providerCalls': provider_calls,
        'baseProviderCalls': provider_calls - retry_calls, 'repairRetryCalls': retry_calls,
        'receiptTurnMapping': 'EXPLICIT' if plan.get('captureReceiptVersion') == 2 else 'LEGACY_ONE_CALL_PER_TURN',
        'matchedSystemPromptPairs': len(system_prompts), 'matchedOptionPairs': len(options),
        'completeHistoryRequests': provider_calls,
        'historyAudit': 'Exact prior user messages, including order and multiplicity, read from every captured provider request.',
        'localDate': next(iter(local_dates)), 'attemptFileSha256': attempts,
        'qualityGraded': False, 'roleRecommendation': None,
    }
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('status', 'tasks', 'attempts', 'providerCalls',
                                                    'matchedSystemPromptPairs', 'localDate')}))


if __name__ == '__main__':
    main()
