#!/usr/bin/env python3
"""Export sealed, ungraded CODE captures to the separate executable replay tool."""
import argparse
import hashlib
import json
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(folder, name):
    raw = (folder / name).read_bytes()
    return json.loads(raw), sha(raw)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', action='append', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit('OUTPUT_ALREADY_EXISTS')
    answers = {'schemaVersion': 1, 'status': 'RAW_CAPTURE_EXPORT_NOT_GRADED', 'items': [], 'inputs': {}}
    identities = {}
    sources = []
    contract = None
    public_inputs = None
    for folder in args.source:
        plan, plan_sha = read(folder, 'plan.json')
        result, result_sha = read(folder, 'result.json')
        tasks, tasks_sha = read(folder, 'tasks.json')
        if not plan['collectOnly'] or plan['workingTreeDirty'] or plan['profile'] != 'full' or plan['repeats'] != 3:
            raise SystemExit('NONCOMPARABLE_CAPTURE_PLAN')
        if len(plan['roles']) != 1 or plan['roles'][0]['role'] != 'CODE' or len(plan['roles'][0]['tasks']) != 7:
            raise SystemExit('INCOMPLETE_CODE_SUITE')
        if result['status'] != 'COLLECTION_COMPLETE' or result['planSha256'] != plan['sha256']:
            raise SystemExit('COLLECTION_NOT_SEALED_COMPLETE')
        if result['decisionAuthority'] or len(result['attempts']) != 21:
            raise SystemExit('GRADED_OR_INCOMPLETE_CAPTURE')
        if len(result.get('capturePreflights', [])) != 7 or not all(p['ready'] for p in result['capturePreflights']):
            raise SystemExit('CODE_CAPTURE_FIXTURE_NOT_VERIFIED')
        model = result['artifacts']['model']
        if model['modelName'] != plan['model'] or not model['digestSha256']:
            raise SystemExit('MODEL_IDENTITY_MISMATCH')
        specification = (plan['sourceRevision'], plan['roles'][0]['contractSha256'],
                         tuple((t['name'], json.dumps(t['options'], sort_keys=True)) for t in plan['roles'][0]['tasks']))
        if contract is None:
            contract = specification
        elif contract != specification:
            raise SystemExit('MODEL_CAPTURE_CONTRACT_MISMATCH')
        inputs = {}
        for task in tasks:
            if task['role'] != 'CODE' or not isinstance(task['input']['text'], str):
                raise SystemExit('BAD_TASK_INPUT')
            key = 'CODE/' + task['name']
            if key in inputs:
                raise SystemExit('DUPLICATE_TASK_INPUT')
            # Deliberately exclude internal _task and gradingInputs.
            inputs[key] = {'messages': [{'role': 'user', 'content': task['input']['text']}],
                           'options': task['options'], 'think': False, 'tools': []}
        if public_inputs is None:
            public_inputs = inputs
            answers['inputs'] = inputs
        elif public_inputs != inputs:
            raise SystemExit('PUBLIC_INPUTS_DIFFER_BETWEEN_MODELS')
        expected = {(t['name'], repeat) for t in plan['roles'][0]['tasks'] for repeat in (1, 2, 3)}
        observed = {(a['task'], a['repeat']) for a in result['attempts']}
        if observed != expected or len(observed) != 21:
            raise SystemExit('INCOMPLETE_ATTEMPT_GRID')
        for attempt in result['attempts']:
            if attempt['gradingStatus'] != 'NOT_GRADED' or 'score' in attempt or 'passed' in attempt:
                raise SystemExit('ATTEMPT_ALREADY_GRADED')
            if attempt['artifact']['digestSha256'] != model['digestSha256'] or attempt['artifact']['providerVersion'] != model['providerVersion']:
                raise SystemExit('RESPONSE_BOUND_IDENTITY_MISMATCH')
            if attempt['captureStatus'] not in ('CAPTURED', 'OUTPUT_BUDGET_EXHAUSTED'):
                raise SystemExit('UNUSABLE_CAPTURE_ATTEMPT')
            key = f"{model['digestSha256']}:{attempt['task']}:{attempt['repeat']}"
            identifier = sha(key.encode())[:32]
            if identifier in identities:
                raise SystemExit('DUPLICATE_ATTEMPT_ID')
            identities[identifier] = {'model': model['modelName'], 'artifact': model}
            answers['items'].append({'id': identifier, 'role': 'CODE', 'task': attempt['task'],
                'repeat': attempt['repeat'], 'response': attempt['response'],
                'responseSha256': sha(attempt['response'].encode()), 'status': attempt['captureStatus'],
                'inputKey': 'CODE/' + attempt['task']})
        sources.append({'directory': str(folder), 'planSha256': plan_sha,
                        'resultSha256': result_sha, 'tasksSha256': tasks_sha,
                        'model': model, 'attempts': len(result['attempts'])})
    args.out.mkdir(parents=True, mode=0o700)
    answer_path = args.out / 'answers.json'
    identity_path = args.out / 'identities.json'
    answer_path.write_text(json.dumps(answers, ensure_ascii=False, indent=2) + '\n')
    identity_path.write_text(json.dumps(identities, ensure_ascii=False, indent=2) + '\n')
    identity_path.chmod(0o600)
    manifest = {'schemaVersion': 1, 'status': 'READY_FOR_SEPARATE_EXECUTABLE_REPLAY',
                'gradingStatus': 'NOT_GRADED', 'decisionAuthority': False,
                'sources': sources, 'answerCount': len(answers['items']),
                'answersSha256': sha(answer_path.read_bytes()),
                'identitiesSha256': sha(identity_path.read_bytes())}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': manifest['status'], 'models': len(sources), 'attempts': len(answers['items'])}))


if __name__ == '__main__':
    main()
