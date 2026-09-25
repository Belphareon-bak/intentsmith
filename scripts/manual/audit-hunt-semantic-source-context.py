#!/usr/bin/env python3
"""Verify historical D/R prompt excerpts against exact Git source bytes.

This proves source fidelity and provenance only. It cannot judge whether the
provided excerpt contains enough context to solve a role task.
"""
import argparse
import collections
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'src/eval/fixtures/role-semantic-tasks.json'
ROLES = ('D1', 'D2', 'R1', 'R2')
ROW = re.compile(r'(?m)^(\d+): ?(.*)$')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if not args.out.is_absolute():
        parser.error('--out must be absolute')
    fixture_bytes = FIXTURE.read_bytes()
    fixture = json.loads(fixture_bytes)
    source_cache = {}
    results = []
    for task in fixture['tasks']:
        if task['role'] not in ROLES:
            continue
        origin = task['provenance']
        main_prompt = task['prompt'].split('\n\nAdditional pinned context', 1)[0]
        sections = [(origin, main_prompt, True)]
        sections.extend((context, context['text'], context['text'] in task['prompt'])
                        for context in origin.get('additionalContext', []))
        section_results = []
        for source, text, visible in sections:
            key = (source['revision'], source['path'])
            if key not in source_cache:
                try:
                    source_cache[key] = subprocess.check_output(
                        ['git', 'show', f'{key[0]}:{key[1]}'], cwd=ROOT, stderr=subprocess.PIPE)
                except subprocess.CalledProcessError:
                    source_cache[key] = b''
            raw = source_cache[key]
            lines = raw.decode('utf-8').splitlines() if raw else []
            excerpts = ROW.findall(text)
            mismatches = [int(number) for number, payload in excerpts
                          if int(number) < 1 or int(number) > len(lines)
                          or lines[int(number)-1] != payload]
            file_sha = sha(raw) if raw else None
            section_results.append({
                'revision': source['revision'], 'path': source['path'],
                'expectedFileSha256': source['fileSha256'], 'observedFileSha256': file_sha,
                'presentInPublicPrompt': visible, 'excerptLineCount': len(excerpts),
                'lineMismatches': mismatches,
                'sourceFaithful': bool(visible and excerpts and not mismatches
                                      and file_sha == source['fileSha256']),
            })
        results.append({'role': task['role'], 'task': task['name'],
                        'independenceGroup': task['independenceGroup'],
                        'sections': section_results,
                        'sourceFaithful': all(row['sourceFaithful'] for row in section_results),
                        'contextSufficient': None,
                        'note': 'Source fidelity does not prove that the excerpt contains all facts needed for a correct answer.'})
    counts = collections.Counter(t['role'] for t in results)
    assert counts == {role: 8 for role in ROLES}
    report = {
        'schemaVersion': 1,
        'status': 'SOURCE_FIDELITY_PASS' if all(t['sourceFaithful'] for t in results) else 'SOURCE_FIDELITY_FAIL',
        'decisionAuthority': False,
        'fixtureSha256': sha(fixture_bytes),
        'tasks': len(results),
        'sourceSections': sum(len(t['sections']) for t in results),
        'uniqueSourceFiles': len(source_cache),
        'excerptLines': sum(s['excerptLineCount'] for t in results for s in t['sections']),
        'contextSufficiency': 'NOT_ASSESSED',
        'results': results,
    }
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('status','tasks','sourceSections','uniqueSourceFiles','excerptLines','contextSufficiency')}))
    if report['status'] != 'SOURCE_FIDELITY_PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
