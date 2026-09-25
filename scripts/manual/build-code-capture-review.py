#!/usr/bin/env python3
"""Build an identity-masked CODE comparison from sealed raw answers and replay."""
import argparse
import hashlib
import json
import secrets
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for arg in ('answers', 'identities', 'replay', 'out'):
        ap.add_argument('--' + arg, type=Path, required=True)
    a = ap.parse_args()
    if a.out.exists():
        raise SystemExit('OUTPUT_ALREADY_EXISTS')
    ab, ib, rb = a.answers.read_bytes(), a.identities.read_bytes(), a.replay.read_bytes()
    answers, identities, replay = json.loads(ab), json.loads(ib), json.loads(rb)
    if replay['status'] != 'EXECUTABLE_COMPONENT_REPLAY_COMPLETE' or replay['fullOracleAccepted'] or replay['decisionAuthority']:
        raise SystemExit('UNQUALIFIED_REPLAY_STATE')
    if replay['sources']['answers']['sha256'] != digest(ab) or replay['sources']['identities']['sha256'] != digest(ib):
        raise SystemExit('REPLAY_SOURCE_HASH_MISMATCH')
    measured = {row['id']: row for row in replay['items']}
    if len(measured) != len(answers['items']) or set(measured) != {x['id'] for x in answers['items']}:
        raise SystemExit('REPLAY_GRID_MISMATCH')
    models = sorted({i['model'] for i in identities.values()})
    if len(models) != 2:
        raise SystemExit('TWO_ARTIFACTS_REQUIRED')
    secrets.SystemRandom().shuffle(models)
    labels = {model: label for model, label in zip(models, ('A', 'B'))}
    tasks = []
    for task in sorted(k.split('/', 1)[1] for k in answers['inputs']):
        raw_input = answers['inputs']['CODE/' + task]
        variants = []
        for model in models:
            attempts = []
            for row in sorted((r for r in answers['items'] if r['task'] == task and identities[r['id']]['model'] == model), key=lambda r: r['repeat']):
                m = measured[row['id']]
                technical = m['assessment']['technical']
                if row['responseSha256'] != digest(row['response'].encode()) or m['assessment']['score'] is not None or m['assessment']['decisionAuthority']:
                    raise SystemExit('RAW_OR_FULL_GRADE_MISMATCH')
                attempts.append({'id': row['id'], 'repeat': row['repeat'], 'response': row['response'],
                    'responseSha256': row['responseSha256'], 'captureStatus': row['status'],
                    'technical': {'valid': technical['valid'], 'applied': technical['applied'],
                        'syntaxOk': technical['syntaxOk'], 'targetedPassed': technical['targetedPassed'],
                        'targeted': technical['targeted'], 'regressions': technical['regressions'],
                        'outcome': technical['outcome'], 'componentScore': technical['score']},
                    'semanticStatus': m['assessment']['semantics']['status']})
            if len(attempts) != 3:
                raise SystemExit('INCOMPLETE_MODEL_TASK_REPEATS')
            variants.append({'label': labels[model], 'attempts': attempts})
        tasks.append({'task': task, 'question': raw_input['messages'][0]['content'], 'variants': variants})
    packet = {'schemaVersion': 1, 'status': 'RAW_CODE_REVIEW_NOT_GRADED',
        'decisionAuthority': False, 'identityMasked': True, 'freshHoldout': False,
        'sourceAnswersSha256': digest(ab), 'sourceReplaySha256': digest(rb),
        'limitations': ['One-shot replacement answers; no C3 repair iterations or operational holdout.',
            'Executable component is isolated and cannot grade semantics or authorize a role decision.',
            'Prior exposure to model responses may reveal identity despite labels.'], 'tasks': tasks}
    a.out.mkdir(parents=True)
    public = a.out / 'public'; public.mkdir()
    custody = a.out / 'custody'; custody.mkdir(mode=0o700)
    pb = (json.dumps(packet, ensure_ascii=False, indent=2) + '\n').encode()
    (public / 'packet.json').write_bytes(pb)
    key = {'packetSha256': digest(pb), 'identityByLabel': {label: {'model':model,
            'artifact':next(i['artifact'] for i in identities.values() if i['model'] == model)}
            for model, label in labels.items()}, 'sourceIdentitiesSha256': digest(ib)}
    (custody / 'identity-key.json').write_text(json.dumps(key, ensure_ascii=False, indent=2) + '\n')
    (custody / 'identity-key.json').chmod(0o600)
    payload = json.dumps(packet, ensure_ascii=False).replace('<', '\\u003c')
    page = '''<!doctype html><html lang="cs"><meta charset="utf-8"><title>CODE: zadání → model → odpověď</title>
<style>body{font:15px system-ui;background:#101216;color:#eee;margin:2rem;max-width:1450px}select,button{font:inherit;padding:.35rem;background:#252a32;color:#fff;border:1px solid #555}header{position:sticky;top:0;background:#101216;padding:.8rem 0;border-bottom:1px solid #555}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1a1e24;padding:1rem;border-radius:6px;max-height:25rem;overflow:auto}section{border:1px solid #444;border-radius:8px;padding:1rem;margin:1rem 0}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}small{color:#f0c673}summary{cursor:pointer} @media(max-width:800px){.columns{grid-template-columns:1fr}}</style>
<header><strong>CODE · syrový sběr, bez celkové známky</strong> <select id="task"></select><p>7 úloh × 2 anonymní modely × 3 pokusy. Technická kontrola je jen dílčí; význam a provozní opravná smyčka nejsou ohodnoceny.</p></header><main id="view"></main>
<script type="application/json" id="payload">''' + payload + '''</script><script>
const data=JSON.parse(document.getElementById('payload').textContent),sel=document.getElementById('task'),view=document.getElementById('view');
const el=(tag,txt,parent)=>{const n=document.createElement(tag);if(txt!==null)n.textContent=txt;parent.appendChild(n);return n};
for(const [i,t] of data.tasks.entries()){const o=el('option',t.task,sel);o.value=i}
function render(){view.replaceChildren();const t=data.tasks[+sel.value||0];el('h2','Zadání: '+t.task,view);el('pre',t.question,view);const cols=el('div',null,view);cols.className='columns';for(const v of t.variants){const box=el('section',null,cols);el('h2','Model '+v.label,box);for(const a of v.attempts){el('h3','Pokus '+a.repeat,box);el('pre',a.response,box);const d=el('details',null,box);el('summary','Izolované pracovní kontroly (ne celková známka)',d);el('pre',JSON.stringify(a.technical,null,2),d);el('small','Význam: '+a.semanticStatus+' · ID '+a.id,box)}}}sel.onchange=render;render();
</script></html>'''
    (public / 'comparison.html').write_text(page)
    manifest = {'packetSha256': digest(pb), 'publicHtmlSha256': digest((public/'comparison.html').read_bytes()),
                'custodyKeySha256': digest((custody/'identity-key.json').read_bytes()),
                'taskCount': len(tasks), 'answerCount': sum(len(v['attempts']) for t in tasks for v in t['variants']),
                'decisionAuthority': False}
    (a.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status':packet['status'], 'tasks':len(tasks),'answers':manifest['answerCount'],
                      'publicReview':str(public/'comparison.html'),'packetSha256':manifest['packetSha256']}))


if __name__ == '__main__':
    main()
