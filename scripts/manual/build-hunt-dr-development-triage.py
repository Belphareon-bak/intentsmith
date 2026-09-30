#!/usr/bin/env python3
"""Compare a complete frozen development review with an append-only partial draft.

A partial second review can prioritize operator work, but cannot accept grades or
make a role decision. The original packet and reviews are never modified.
"""
import argparse
from collections import Counter
from hashlib import sha256
from html import escape
import json
from pathlib import Path


def load(path):
    raw = path.read_bytes()
    return json.loads(raw), sha256(raw).hexdigest()


def main():
    cli = argparse.ArgumentParser()
    for name in ('packet', 'review_a', 'review_b_jsonl', 'readiness', 'out'):
        cli.add_argument('--' + name.replace('_', '-'), required=True, type=Path)
    a = cli.parse_args()
    if any(not getattr(a, name).is_absolute() for name in ('packet', 'review_a', 'review_b_jsonl', 'readiness', 'out')):
        raise SystemExit('ABSOLUTE_PATHS_REQUIRED')
    if a.out.exists():
        raise SystemExit('OUTPUT_EXISTS')
    packet, packet_sha = load(a.packet)
    review_a, review_a_sha = load(a.review_a)
    readiness, readiness_sha = load(a.readiness)
    b_raw = a.review_b_jsonl.read_bytes()
    review_b_sha = sha256(b_raw).hexdigest()
    if packet.get('status') != 'DEVELOPMENT_BLIND_REVIEW' or packet.get('decisionAuthority') is not False:
        raise SystemExit('PACKET_SCOPE')
    if review_a.get('packetSha256') != packet_sha or review_a.get('decisionAuthority') is not False:
        raise SystemExit('REVIEW_A_SOURCE')
    if readiness['sources']['packet']['sha256'] != packet_sha:
        raise SystemExit('READINESS_SOURCE')
    cases = {row['id']: row for row in packet['cases']}
    first = {row['id']: row for row in review_a['cases']}
    if len(cases) != len(packet['cases']) or len(first) != len(cases) or set(first) != set(cases):
        raise SystemExit('REVIEW_A_COVERAGE')
    second = {}
    for line in b_raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        key = row['fullId']
        case = cases.get(key)
        if not case or key in second or row['task'] != case['task'] or len(row['r']) != len(case['rubric']) or len(row['why']) != len(case['rubric']):
            raise SystemExit('REVIEW_B_CASE')
        if any(not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= 1
               or abs(score * 100 - round(score * 100)) > 1e-8 for score in row['r']):
            raise SystemExit('REVIEW_B_SCORE')
        if any(not isinstance(reason, str) or not reason.strip() for reason in row['why']):
            raise SystemExit('REVIEW_B_REASON')
        second[key] = row
    groups = {}
    comparisons = []
    stats = Counter()
    for key, row in second.items():
        case = cases[key]
        for index, (left, right) in enumerate(zip(first[key]['ratings'], row['r']), 1):
            stats['overlapCriteria'] += 1
            if left is None:
                stats['taskIssueCriteria'] += 1
                continue
            gap = abs(round(left * 100) - round(right * 100))
            stats['numericCriteria'] += 1
            stats['gapAtLeast15'] += gap >= 15
            stats['gapOver25'] += gap > 25
            stats['gapAtLeast50'] += gap >= 50
            if gap >= 15:
                entry = {'id': key, 'role': case['role'], 'task': case['task'], 'label': case['label'],
                         'repeat': case['repeat'], 'criterion': index, 'gapHundredths': gap,
                         'scoreA': left, 'scoreB': right, 'reasonA': first[key]['reasons'][index - 1],
                         'reasonB': row['why'][index - 1]}
                comparisons.append(entry)
                if gap >= 50:
                    group = (case['task'], index)
                    if group not in groups or gap > groups[group]['gapHundredths']:
                        groups[group] = entry
    presampled = [row['id'] for row in readiness['presampledOperatorCases']]
    if len(presampled) != 26 or any(key not in cases for key in presampled):
        raise SystemExit('PRESAMPLE_INVALID')
    issue_representatives = {}
    for key in second:
        if 'model_cleanup' in cases[key]['task'] and cases[key]['role'] not in issue_representatives:
            issue_representatives[cases[key]['role']] = key
    priority_ids = {row['id'] for row in groups.values()} | set(issue_representatives.values())
    priority_ids.add('330085f8-b698-45ea-a20c-a6b971bdd579')
    priority_ids &= set(second)
    def item(key):
        case = cases[key]
        b = second.get(key)
        return {'id': key, 'role': case['role'], 'task': case['task'], 'label': case['label'],
                'repeat': case['repeat'], 'question': case['question'], 'response': case['response'],
                'criteria': [{'criterion': criterion, 'scoreA': first[key]['ratings'][i],
                              'reasonA': first[key]['reasons'][i],
                              'scoreB': b['r'][i] if b else None,
                              'reasonB': b['why'][i] if b else 'SECOND_REVIEW_NOT_YET_AVAILABLE'}
                             for i, criterion in enumerate(case['rubric'])]}
    result = {'schemaVersion': 1, 'status': 'PARTIAL_DEVELOPMENT_TRIAGE', 'decisionAuthority': False,
              'notIndependentAcceptance': True, 'packetSha256': packet_sha,
              'sourceSha256': {'reviewA': review_a_sha, 'reviewBDraft': review_b_sha, 'readiness': readiness_sha},
              'statistics': {'packetCases': len(cases), 'reviewBCases': len(second), 'missingReviewBCases': len(cases)-len(second),
                             **stats, 'highGapGroups': len(groups), 'priorityCases': len(priority_ids),
                             'presampledCases': len(presampled)},
              'missingReviewB': [{'id': key, 'role': value['role'], 'task': value['task']} for key, value in cases.items() if key not in second],
              'allDifferencesAtLeast15': sorted(comparisons, key=lambda row: (-row['gapHundredths'], row['task'], row['id'])),
              'priority': [item(key) for key in sorted(priority_ids, key=lambda key: (cases[key]['role'], cases[key]['task'], key))],
              'presampled': [item(key) for key in presampled],
              'limitations': ['Second review is a changing draft and incomplete; its source SHA is fixed for this snapshot.',
                              'Codex has prior task exposure; agreement is not blind grader acceptance.',
                              'No absent second score is imputed, and no model or role mean is issued.']}
    a.out.mkdir(mode=0o700)
    (a.out / 'triage.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    def render(rows):
        bits = []
        for row in rows:
            grades = ''.join('<tr><td>' + str(i+1) + '. ' + escape(c['criterion']) + '</td><td>'
                + ('—' if c['scoreA'] is None else str(c['scoreA'])) + '<br>' + escape(c['reasonA']) + '</td><td>'
                + ('—' if c['scoreB'] is None else str(c['scoreB'])) + '<br>' + escape(c['reasonB']) + '</td></tr>'
                for i, c in enumerate(row['criteria']))
            bits.append('<article><h2>' + escape(row['role'] + ' · ' + row['task'] + ' · ' + row['label'] + '/' + str(row['repeat']))
                + '</h2><p>' + escape(row['id']) + '</p><details><summary>Celé zadání</summary><pre>' + escape(row['question'])
                + '</pre></details><h3>Odpověď</h3><pre>' + escape(row['response']) + '</pre><table><tr><th>Kritérium</th><th>Codex</th><th>Opus draft</th></tr>'
                + grades + '</table></article>')
        return '\n'.join(bits)
    html = '''<!doctype html><html lang="cs"><meta charset="utf-8"><title>GPU hunt · pracovní neshody</title>
<style>body{background:#101015;color:#eee;font:15px/1.5 system-ui;max-width:1200px;margin:auto;padding:2rem}article{padding:1rem;border:1px solid #777;margin:1.5rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#19191e;padding:1rem}table{border-collapse:collapse}td,th{border:1px solid #555;padding:.5rem;vertical-align:top}summary{cursor:pointer}</style>
<h1>GPU hunt · pracovní neshody</h1><p>Částečný vývojový podklad, bez rozhodovací autority. Chybějící druhé známky zůstávají prázdné.</p>
<h2>Největší neshody a vadná úloha</h2>''' + render(result['priority']) + '<h2>Předem vybraný náhodný vzorek</h2>' + render(result['presampled']) + '</html>'
    (a.out / 'review.html').write_text(html)
    print(json.dumps({'status': result['status'], 'statistics': result['statistics'], 'out': str(a.out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
