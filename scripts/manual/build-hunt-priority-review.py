#!/usr/bin/env python3
"""Select a bounded, identity-free first tranche from the full D/R operator queue."""
import argparse
import hashlib
import html
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    raw = args.queue.read_bytes()
    source = json.loads(raw)
    if source.get('status') != 'OPERATOR_ADJUDICATION_PENDING' or source.get('decisionAuthority') is not False:
        raise ValueError('PRIORITY_REVIEW_SOURCE_INVALID')
    if args.out.exists():
        raise ValueError('PRIORITY_REVIEW_OUTPUT_EXISTS')
    rows = source['rows']
    by_id = {row['id']: row for row in rows}
    if len(by_id) != len(rows) or any('model' in row or 'digestSha256' in row for row in rows):
        raise ValueError('PRIORITY_REVIEW_IDENTITY_OR_DUPLICATE')
    fixed = {'PRESELECTED_RANDOM', 'A_LOW_CONFIDENCE', 'A_CRITICAL_FAILURE', 'ZERO_VERSUS_AT_LEAST_HALF'}
    chosen = {row['id'] for row in rows if fixed.intersection(row['selectionReasons'])}
    # One example of the shared defective scenario per role is enough for the
    # first tranche; the full queue retains every affected response.
    for role in sorted({row['role'] for row in rows}):
        affected = sorted((row for row in rows if row['role'] == role and
                           'TASK_ISSUE_UNSCORABLE' in row['selectionReasons']), key=lambda row: row['id'])
        if affected:
            chosen.add(affected[0]['id'])

    def rank(row):
        deltas = [criterion['differenceHundredths'] for criterion in row['criteria']
                  if criterion['differenceHundredths'] is not None]
        return (-max(deltas, default=0), -sum(delta > 25 for delta in deltas), row['role'], row['task'], row['id'])

    target = max(48, len(chosen))
    for row in sorted(rows, key=rank):
        if len(chosen) >= target:
            break
        chosen.add(row['id'])
    selected = [row for row in rows if row['id'] in chosen]
    if len(selected) != len(chosen) or not fixed.issubset({reason for row in selected for reason in row['selectionReasons']}):
        raise ValueError('PRIORITY_REVIEW_SELECTION_INVALID')
    report = {'schemaVersion': 1, 'status': 'OPERATOR_FIRST_TRANCHE_PENDING', 'decisionAuthority': False,
              'sourceQueueSha256': hashlib.sha256(raw).hexdigest(), 'packetSha256': source['packetSha256'],
              'selectionRule': 'All 26 presampled cases, all submitted A low-confidence and critical flags, all zero-vs-half cases, one task-issue case per role, then largest numeric gaps to at least 48 cases. Other cases remain in the full queue.',
              'sourceFlags': source['flags'], 'fullQueueCases': len(rows), 'selectedCases': len(selected),
              'rows': selected}
    args.out.mkdir(mode=0o700)
    (args.out / 'priority.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    escape = html.escape
    parts = ['<!doctype html><html lang="cs"><meta charset="utf-8"><title>GPU hunt · první rozsouzení</title>',
             '<style>body{background:#111;color:#eee;font:15px/1.5 system-ui;max-width:1300px;margin:auto;padding:24px}article{border:1px solid #584d3d;background:#1c1c1c;padding:16px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#080808;padding:14px;max-height:520px;overflow:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #524939;padding:8px;vertical-align:top;text-align:left}summary{cursor:pointer;color:#e7b66b}</style>',
             '<h1>GPU hunt · první část rozsouzení</h1>',
             f'<p>{len(selected)} anonymních odpovědí z {len(rows)} ve frontě. Výběr: {escape(report["selectionRule"])} Žádné skóre zde nemá rozhodovací autoritu.</p>',
             f'<p>Zdrojová fronta SHA-256: <code>{report["sourceQueueSha256"]}</code>. Druhý posuzovatel nedodal samostatné příznaky nízké jistoty a kritických selhání; tyto odpovědi mohou být mimo první část.</p>']
    for row in selected:
        parts += [f'<article id="{escape(row["id"])}"><h2>{escape(row["role"])} · {escape(row["task"])} · {escape(row["label"])}/{row["repeat"]}</h2>',
                  f'<p>{escape(", ".join(row["selectionReasons"]))} · <code>{escape(row["id"])}</code></p>',
                  f'<details><summary>Celé zadání</summary><pre>{escape(row["question"])}</pre></details>',
                  f'<h3>Celá odpověď</h3><pre>{escape(row["response"])}</pre>',
                  '<table><tr><th>Kritérium</th><th>Codex</th><th>Opus</th></tr>']
        for criterion in row['criteria']:
            def cell(score, reason):
                return ('bez známky' if score is None else f'{score:.2f}') + ' · ' + escape(reason)
            parts.append('<tr><td>' + str(criterion['index']) + '. ' + escape(criterion['criterion']) +
                         '</td><td>' + cell(criterion['scoreA'], criterion['reasonA']) +
                         '</td><td>' + cell(criterion['scoreB'], criterion['reasonB']) + '</td></tr>')
        parts.append('</table></article>')
    parts.append('</html>')
    (args.out / 'priority.html').write_text('\n'.join(parts))
    print(json.dumps({'status': report['status'], 'selectedCases': len(selected),
                      'fullQueueCases': len(rows), 'out': str(args.out)}))


if __name__ == '__main__':
    main()
