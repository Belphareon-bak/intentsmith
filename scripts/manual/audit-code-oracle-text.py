#!/usr/bin/env python3
"""Inventory historical CODE oracle text checks. No tests, inference or DB writes.

This is a lexical inventory for review, not a semantic acceptance verdict.
It retains all matching sites, including fixed API strings and false positives.
"""
import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inventory():
    raw = (ROOT / 'src/eval/code-suite-tasks.json').read_bytes()
    fixture = json.loads(raw)
    files = {}
    for task in fixture['tasks']:
        for name in task.get('tests') or [task['test']]:
            key = (task['hash'], name)
            files.setdefault(key, []).append({
                'task': 'patch_' + task['taskFingerprint'][:12],
                'status': task['status'], 'editableFile': task['source'],
                'editableHeaders': [s['header'] for s in task['snapshot']['spans']],
                'publicRequirements': (task['snapshot'].get('publicContract') or {}).get(
                    'requirements', task['snapshot'].get('requirements', [])),
            })
    # Also inventory the checks injected by the current runner and the probe
    # driver. Historical imported implementation files are not test assertions.
    for name in ['src/eval/code-contract-check.mjs', 'src/eval/code-patch-runner.js',
                 'scripts/manual/verify-code-oracles.mjs', 'tests/harness.js']:
        files[('WORKTREE', name)] = []
    # Include historical relative test helpers, not production imports. Preserve
    # non-JS helpers as source files; the inventory remains explicit about scope.
    unresolved_imports = []
    pending = list(files)
    for revision, name in pending:
        if revision == 'WORKTREE':
            continue
        source = git('show', f'{revision}:{name}').decode()
        for relative in re.findall(r"(?:from\s+|import\s*\()\s*['\"](\.[^'\"]+)['\"]", source):
            candidate = str((Path(name).parent / relative).as_posix())
            # Normalise without resolving against the host filesystem.
            candidate = posixpath.normpath(candidate)
            if candidate.startswith('tests/') and candidate.endswith(('.js', '.mjs')):
                key = (revision, candidate)
                if key in files:
                    continue
                exists = subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e',
                                         f'{revision}:{candidate}'], capture_output=True).returncode == 0
                if exists:
                    files[key] = []
                    pending.append(key)
                else:
                    unresolved_imports.append({'revision': revision, 'importer': name,
                                               'path': candidate, 'status': 'REVIEW_IMPORT_OR_EMBEDDED_FIXTURE'})
    pattern = re.compile(r'\.\s*(?:test|match|matchAll|search|includes|startsWith|endsWith|indexOf)\s*\('
                         r'|\b(?:assert(?:Equal|Includes|DeepEqual)?|expect)\s*(?:\.\s*\w+\s*)?\(')
    records = []
    for (revision, name), tasks in sorted(files.items()):
        data = (ROOT / name).read_bytes() if revision == 'WORKTREE' else git('show', f'{revision}:{name}')
        source = data.decode()
        lines = source.splitlines()
        sites = []
        for match in pattern.finditer(source):
            line = source.count('\n', 0, match.start()) + 1
            context = '\n'.join(lines[max(0, line-3):line+3])
            sites.append({'line': line, 'operator': match.group(), 'lineText': lines[line-1],
                          'context': context,
                          'textFieldNearby': bool(re.search(r'\b(detail|reason|message|summary|description|content|response)\b', context))})
        records.append({'revision': revision, 'path': name, 'sha256': sha(data),
                        'tasks': tasks, 'sites': sites})
    return {'schemaVersion': 1, 'sourceRevision': git('rev-parse', 'HEAD').decode().strip(),
            'fixtureSha256': sha(raw), 'status': 'LEXICAL_INVENTORY_REQUIRES_REVIEW',
            'taskCount': len(fixture['tasks']),
            'activeTasks': sum(t['status'] == 'active' for t in fixture['tasks']),
            'historicalEntryFiles': len({(t['hash'], f) for t in fixture['tasks'] for f in (t.get('tests') or [t['test']])}),
            'limitations': ['A lexical match is not a defect or a semantic verdict.',
                            'Computed assertions and deeper transitive imports require manual inspection.',
                            'Duplicate sites across revisions are intentional; exact history matters.',
                            'No scoring, replay, model invocation or production mutation was performed.'],
            'unresolvedImportCandidates': unresolved_imports, 'files': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if not args.out.is_absolute():
        parser.error('--out must be absolute')
    report = inventory()
    with args.out.open('x') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({k: report[k] for k in ['status', 'taskCount', 'activeTasks', 'historicalEntryFiles']}))
