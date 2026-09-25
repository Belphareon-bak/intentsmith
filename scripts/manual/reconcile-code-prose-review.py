#!/usr/bin/env python3
"""Attach a draft second reading to offline adjudication; never import scores into production."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

AXES = {'confidence_explanation': 'confidence-explanation', 'other_explanations': 'other-prose-observed'}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def index_unique(rows, key):
    result = {row[key]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError('DUPLICATE_IDS')
    return result


def reconcile(packet, custody, review, author):
    if (review.get('schemaVersion') != 1 or review.get('status') != 'DRAFT'
            or review.get('decisionAuthority') is not False
            or review.get('packetId') != packet['packetId']
            or custody.get('packetId') != packet['packetId']):
        raise ValueError('REVIEW_CONTRACT_MISMATCH')
    if not all(isinstance(review.get(k), str) and review[k].strip()
               for k in ['reviewer', 'priorExposureDeclared']):
        raise ValueError('REVIEWER_AND_EXPOSURE_REQUIRED')
    if (author.get('decisionAuthority') is not False or author.get('calibrationEvidence') is not False
            or author['source']['sha256'] != custody['replaySha256']):
        raise ValueError('AUTHOR_EVIDENCE_MISMATCH')
    public = index_unique(packet['items'], 'id')
    keys = index_unique(custody['identities'], 'publicId')
    submitted = index_unique(review['items'], 'id')
    originals = index_unique(author['items'], 'id')
    if (len(public) != 30 or set(public) != set(keys) or set(public) != set(submitted)
            or len({k['originalId'] for k in keys.values()}) != 30
            or {k['originalId'] for k in keys.values()} != set(originals)):
        raise ValueError('REVIEW_COVERAGE_MISMATCH')
    compared = []
    distributions = {axis: Counter() for axis in AXES}
    recognition = Counter()
    for ident, answer in public.items():
        key, second = keys[ident], submitted[ident]
        first = originals[key['originalId']]
        if (sha(encode(answer)) != key['publicItemSha256']
                or sha(answer['response'].encode()) != first['responseSha256']):
            raise ValueError('ANSWER_PROVENANCE_MISMATCH')
        axes = index_unique(second['axes'], 'id')
        first_axes = index_unique(first['criteria'], 'id')
        if set(axes) != set(AXES) or not set(AXES.values()).issubset(first_axes):
            raise ValueError('AXIS_COVERAGE_MISMATCH')
        recognition[second.get('recognizedBefore', 'unknown')] += 1
        result = {'publicId': ident, 'originalId': key['originalId'], 'axes': []}
        for axis_id, original_axis in AXES.items():
            axis = axes[axis_id]
            score = axis.get('score')
            if score is not None and (type(score) not in (int, float) or score not in [0, .25, .5, .75, 1]):
                raise ValueError('INVALID_REVIEW_SCORE')
            if not all(isinstance(axis.get(k), str) and axis[k].strip() for k in ['reason', 'evidence']):
                raise ValueError('REASON_AND_EVIDENCE_REQUIRED')
            # This verifies quotations against observed text, not their meaning
            # or the grade. No regex/prose matching contributes to model scores.
            quotes = [re.sub(r'^O\d{2}(?: detail)?:\s*', '', s.strip()) for s in axis['evidence'].split('|')]
            details = [o['output'].get('detail', '') for o in answer['observations'] if isinstance(o.get('output'), dict)]
            quotes_found = all(q and any(q in detail for detail in details) for q in quotes)
            distributions[axis_id]['null' if score is None else f'{score:g}'] += 1
            result['axes'].append({'id': axis_id, 'authorScore': first_axes[original_axis]['score'],
                                   'secondScore': score, 'agreement': score is not None and score == first_axes[original_axis]['score'],
                                   'reason': axis['reason'], 'evidence': axis['evidence'],
                                   'literalQuotesFound': quotes_found})
        compared.append(result)
    api_correct = api_absent = api_wrong = 0
    for item in public.values():
        for observation in item['observations'][:8]:
            count = observation['arguments'][0]['discriminating']
            expected = 'nízká (jediná úloha)' if count == 1 else 'střední' if count == 2 else 'vysoká'
            output = observation['output']
            if 'confidence' not in output:
                api_absent += 1
            elif output['confidence'] == expected:
                api_correct += 1
            else:
                api_wrong += 1
    diagnostics = []
    for n in range(8, 12):
        observations = [i['observations'][n]['output'] for i in public.values()]
        diagnostics.append({'observationId': f'O{n+1:02}',
                            'distinctDetailStrings': len({o.get('detail') for o in observations}),
                            'distinctStructuralOutputs': len({json.dumps(o, ensure_ascii=False, sort_keys=True) for o in observations}),
                            'confidencePresent': sum('confidence' in o for o in observations),
                            'outputVariants': [{'output': json.loads(text), 'count': count} for text, count in
                                               Counter(json.dumps(o, ensure_ascii=False, sort_keys=True) for o in observations).items()]})
    return {'schemaVersion': 1, 'status': 'DRAFT_ATTACHED_FOR_ADJUDICATION', 'sourceStatus': review['status'],
            'decisionAuthority': False, 'productionImported': False, 'calibrationEvidence': False,
            'independentAgreement': False, 'freshHoldout': False, 'packetId': packet['packetId'],
            'reviewer': review['reviewer'], 'priorExposureDeclared': review['priorExposureDeclared'],
            'recognition': dict(recognition), 'items': compared,
            'summary': {'answers': len(compared), 'axesCompared': len(compared)*len(AXES),
                        'agree': sum(a['agreement'] for i in compared for a in i['axes']),
                        'missing': sum(a['secondScore'] is None for i in compared for a in i['axes']),
                        'literalQuoteChecksPassed': sum(a['literalQuotesFound'] for i in compared for a in i['axes']),
                        'distributions': {k: dict(v) for k, v in distributions.items()}},
            'qualityObservations': {'total': 240, 'correctApiPresent': api_correct, 'missingApi': api_absent,
                                    'wrongApi': api_wrong, 'proseAutomaticallyGraded': False},
            'diagnosticObservations': diagnostics,
            'limitations': ['Agreement is a consistent second reading after prior exposure, not independent acceptance.',
                            'Literal quotation verification proves presence only, not the correctness of the semantic judgment.',
                            'An invariant result can be a regression check; no discrimination was observed on this panel.',
                            'Historical grades, source answers and acceptance authority are unchanged.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['packet-dir', 'review', 'author', 'out']:
        parser.add_argument('--'+flag, type=Path, required=True)
    args = parser.parse_args()
    if not all(p.is_absolute() for p in vars(args).values()):
        parser.error('All paths must be absolute; output directory must be new.')
    paths = {'packet': args.packet_dir/'public/answers.json', 'custody': args.packet_dir/'custody/identity-key.json',
             'review': args.review, 'author': args.author}
    raw = {k: p.read_bytes() for k, p in paths.items()}
    data = {k: json.loads(b) for k, b in raw.items()}
    if sha(raw['packet']) != data['custody']['publicArtifacts']['answers.json']:
        raise ValueError('PUBLIC_PACKET_HASH_MISMATCH')
    report = reconcile(**data)
    report['sources'] = {k: {'path': str(paths[k]), 'sha256': sha(b)} for k, b in raw.items()}
    args.out.mkdir(mode=0o700)
    # Original reviewer bytes and DRAFT status are preserved, never promoted.
    (args.out/'second-review-original.json').write_bytes(raw['review'])
    (args.out/'reconciliation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'status': report['status'], **report['summary'], 'decisionAuthority': False}))


if __name__ == '__main__':
    main()
