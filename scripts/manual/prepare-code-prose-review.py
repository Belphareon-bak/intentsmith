#!/usr/bin/env python3
"""Second reading of existing CODE answers. No grading, execution or inference."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import secrets

TASK = 'patch_90eff80ecb8a'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def prepare(answers, replay):
    if (replay.get('status') != 'EXECUTABLE_COMPONENT_REPLAY_COMPLETE'
            or replay.get('decisionAuthority') is not False):
        raise ValueError('REPLAY_NOT_COMPLETE_OR_AUTHORITATIVE')
    rows = [i for i in answers['items'] if i['task'] == TASK]
    measured = [i for i in replay['items'] if i['task'] == TASK]
    if (len(rows) != 30 or len(measured) != 30
            or len({i['id'] for i in rows}) != 30
            or {i['id'] for i in rows} != {i['id'] for i in measured}):
        raise ValueError('EXPECTED_EXACT_30_ANSWER_GRID')
    by_id = {i['id']: i for i in measured}
    expected_input = answers['inputs'][rows[0]['inputKey']]
    expected_criteria = rows[0]['criteria']
    public, private = [], []
    secrets.SystemRandom().shuffle(rows)
    for row in rows:
        result = by_id[row['id']]
        source = answers['inputs'][row['inputKey']]
        response_hash = digest(row['response'].encode())
        if (row.get('status') != 'CAPTURED' or response_hash != row['responseSha256']
                or response_hash != result['responseSha256']
                or digest(encoded(source)) != result['inputSha256']
                or source != expected_input or row['criteria'] != expected_criteria):
            raise ValueError('CAPTURE_PROVENANCE_MISMATCH')
        assessment = result['assessment']
        if (assessment.get('score') is not None or assessment.get('passed') is not False
                or assessment.get('decisionAuthority') is not False):
            raise ValueError('FULL_GRADE_MUST_REMAIN_ABSENT')
        observations = assessment['technical']['contractChecks']['observations']
        expected_cases = [('confidence', side, n) for side in ['candidate', 'incumbent'] for n in [1, 2, 3, 7]]
        expected_cases += [(c, None, None) for c in ['below-quality-threshold', 'speed-candidate', 'speed-insufficient', 'speed-unmeasured']]
        if [(o['case'], o.get('side'), o.get('discriminating')) for o in observations] != expected_cases:
            raise ValueError('OBSERVATION_COVERAGE_MISMATCH')
        observed = []
        for index, obs in enumerate(observations):
            if obs['case'] == 'confidence':
                n, side = obs['discriminating'], obs['side']
                # Exact arguments used in the pinned code-contract-check.mjs.
                comparison = dict(margin=.2 if side == 'candidate' else -.2,
                                  candidateWins=n if side == 'candidate' else 0,
                                  incumbentWins=n if side == 'incumbent' else 0,
                                  inconclusive=False, discriminating=n)
                args = [comparison]  # speed and threshold use the supplied source defaults
            else:
                args = [obs['comparison'], obs['speeds'], .05]
            observed.append({'id': f'O{index + 1:02}', 'case': obs['case'], 'arguments': args,
                             'output': obs.get('result'), 'error': obs.get('error'),
                             'confidenceRequirementDisputed': obs['case'] == 'below-quality-threshold'})
        alias = 'P-' + secrets.token_hex(6)
        item = {'id': alias, 'response': row['response'], 'observations': observed}
        public.append(item)
        private.append({'publicId': alias, 'originalId': row['id'], 'model': result['model'],
                        'repeat': result['repeat'], 'artifact': result['artifact'],
                        'responseSha256': response_hash, 'inputSha256': result['inputSha256'],
                        'publicItemSha256': digest(encoded(item))})
    packet = {
        'schemaVersion': 1, 'packetId': secrets.token_hex(16),
        'status': 'SECOND_READING_AWAITING_REVIEW', 'decisionAuthority': False,
        'identityMasked': True, 'authorGradesIncluded': False, 'referenceIncluded': False,
        'priorExposure': 'Some answers, aggregate results and author reasoning were previously discussed. Masking does not undo that exposure.',
        'independentAcceptance': False, 'freshHoldout': False,
        'historicalScope': 'Read the original task. Assess explicit quality win/loss branches. Do not penalize missing confidence below the threshold: that requirement is disputed. Record ambiguity separately.',
        'messages': expected_input['messages'], 'publicCriteria': expected_criteria,
        'reviewAxes': [
            {'id': 'confidence_explanation', 'label': 'Význam vysvětlení jistoty',
             'scope': 'O01–O08: odpovídá detail nízké/střední/vysoké jistotě podle rozlišujících úloh, bez rozporu? Chybějící API pole není druhou srážkou v této textové ose.'},
            {'id': 'other_explanations', 'label': 'Věcná správnost ostatních vysvětlení',
             'scope': 'O09–O12: odpovídá text pozorovaným vstupům? U O09 nehodnoť přítomnost jistoty, jen ostatní tvrzení.'},
        ],
        'scale': {'0': 'Chybí požadovaný obsah nebo jej odpověď popírá.',
                  '0.25': 'Doložený dílčí pokus s kritickou chybou.',
                  '0.5': 'Podstatná část správně, podstatná část chybí nebo je chybná.',
                  '0.75': 'Převážně správně, konkrétní omezená vada.',
                  '1': 'Požadavek doložen ve všech posuzovaných pozorováních.',
                  'null': 'Nelze rozhodnout z dodaných podkladů; uveď proč. Nejde o nulu.'},
        'instructions': 'U každé osy uveď známku, konkrétní důvod a ID pozorování nebo citaci. Zaznamenej dřívější rozpoznání odpovědi a vady zadání. Nevytvářej celkovou známku úlohy. Pozorovaná volání nepokrývají všechny možné vstupy.',
        'items': public,
    }
    return packet, private


def template(packet):
    return {'schemaVersion': 1, 'packetId': packet['packetId'], 'decisionAuthority': False,
            'reviewer': '', 'priorExposureDeclared': '', 'status': 'DRAFT',
            'items': [{'id': i['id'], 'recognizedBefore': 'unknown', 'taskIssue': '',
                       'axes': [{'id': a['id'], 'score': None, 'reason': '', 'evidence': ''}
                                for a in packet['reviewAxes']]} for i in packet['items']]}


def render(packet):
    # Script JSON is escaped independently from visible HTML. Candidate strings are
    # assigned only through textContent; no markup from a response is interpreted.
    payload = json.dumps({'packet': packet, 'template': template(packet)}, ensure_ascii=False).replace('<', '\\u003c')
    return '''<!doctype html><html lang="cs"><meta charset="utf-8"><title>CODE — druhé posouzení</title>
<style>body{font:16px system-ui;max-width:1250px;margin:24px auto;padding:0 20px;background:#141414;color:#eee}button,select,input,textarea{font:inherit;background:#262626;color:#eee;border:1px solid #888;border-radius:5px;padding:8px}button{cursor:pointer}button.primary{background:#dab060;color:#171717}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:#202020}details{margin:14px 0}summary{cursor:pointer}nav{display:flex;gap:16px;align-items:center;position:sticky;top:0;background:#141414;padding:16px 0}textarea{display:block;box-sizing:border-box;width:100%;margin:8px 0;min-height:70px}fieldset{margin:16px 0;border:1px solid #777}small{color:#bbb}h2{border-bottom:1px solid #777;padding-bottom:10px}.notice{border-left:4px solid #dab060;padding:12px}label{display:block;margin:8px 0}</style>
<h1>CODE — druhé posouzení 30 odpovědí</h1><p class="notice">Modely a předchozí známky jsou skryté. Část materiálu už byla diskutovaná; nejde o nový slepý holdout ani o přejímku hodnotitele. Označ, pokud odpověď poznáváš. Podprahovou větev kvůli chybějící jistotě nepenalizuj; její původní zadání je nejasné.</p>
<label>Posuzovatel <input id="reviewer"></label><label>Předchozí znalost tohoto materiálu <textarea id="exposure" placeholder="Co jsi již viděl: odpovědi, identity, známky, důvody…"></textarea></label>
<details><summary>Původní zadání modelu (beze změny)</summary><div id="prompt"></div></details>
<details><summary>Rozsah posouzení a škála</summary><pre id="rubric"></pre></details>
<nav><button id="prev">← Předchozí</button><select id="choose" aria-label="Odpověď"></select><button id="next">Další →</button><button class="primary" id="export">Uložit posudek JSON</button><span id="saved" role="status"></span></nav>
<p><small>Průběžný návrh se ukládá do tohoto prohlížeče. Pro předání a zálohu použij Uložit posudek JSON. Nikam se neposílá.</small></p><main id="item"></main>
<script type="application/json" id="data">''' + payload + '''</script><script>
const {packet,template}=JSON.parse(document.getElementById('data').textContent);
const key='code-second-review:'+packet.packetId; let draft=template,index=0;
try{const saved=JSON.parse(localStorage.getItem(key));if(saved?.packetId===packet.packetId && Array.isArray(saved.items) && saved.items.length===template.items.length)draft=saved;}catch{}
const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.appendChild(n);return n;};
function save(){draft.reviewer=document.getElementById('reviewer').value;draft.priorExposureDeclared=document.getElementById('exposure').value;try{localStorage.setItem(key,JSON.stringify(draft));document.getElementById('saved').textContent='Návrh uložen';}catch{document.getElementById('saved').textContent='Automatické uložení není dostupné — exportuj JSON';}}
document.getElementById('reviewer').value=draft.reviewer;document.getElementById('exposure').value=draft.priorExposureDeclared;
document.getElementById('reviewer').oninput=save;document.getElementById('exposure').oninput=save;
for(const m of packet.messages){el('h3',m.role,document.getElementById('prompt'));el('pre',m.content,document.getElementById('prompt'));}
document.getElementById('rubric').textContent=JSON.stringify({scope:packet.historicalScope,axes:packet.reviewAxes,scale:packet.scale,instructions:packet.instructions},null,2);
const chooser=document.getElementById('choose');packet.items.forEach((i,n)=>{const o=el('option',`${n+1} / ${packet.items.length} · ${i.id}`,chooser);o.value=n;});
function show(){chooser.value=index;const item=packet.items[index],grade=draft.items[index],root=document.getElementById('item');root.replaceChildren();el('h2',`Odpověď ${index+1} / ${packet.items.length} · ${item.id}`,root);
const original=el('details',undefined,root);el('summary','Celá původní odpověď',original);el('pre',item.response,original);
el('h3','Skutečně pozorované návraty funkce',root);
for(const o of item.observations){const d=el('details',undefined,root);el('summary',`${o.id} · ${o.case}${o.confidenceRequirementDisputed?' · jistota v této větvi mimo hodnocení':''}`,d);el('pre',JSON.stringify({arguments:o.arguments,output:o.output,error:o.error},null,2),d);}
const rec=el('label','Poznáváš tuto konkrétní odpověď z dřívějška? ',root),sel=el('select',undefined,rec);for(const [v,t] of [['unknown','Nevím'],['yes','Ano'],['no','Ne']]){const o=el('option',t,sel);o.value=v;}sel.value=grade.recognizedBefore;sel.onchange=()=>{grade.recognizedBefore=sel.value;save();};
for(const axis of packet.reviewAxes){const value=grade.axes.find(x=>x.id===axis.id),f=el('fieldset',undefined,root);el('legend',axis.label,f);el('p',axis.scope,f);const score=el('select',undefined,f);score.setAttribute('aria-label',axis.label+' — známka');for(const v of ['',0,.25,.5,.75,1]){const o=el('option',v===''?'Bez známky / nelze rozhodnout':String(v),score);o.value=v;}score.value=value.score===null?'':value.score;score.onchange=()=>{value.score=score.value===''?null:Number(score.value);save();};for(const [field,title] of [['reason','Konkrétní důvod'],['evidence','ID pozorování / citace']]){const label=el('label',title,f),text=el('textarea',undefined,label);text.value=value[field];text.oninput=()=>{value[field]=text.value;save();};}}
const issues=el('label','Nejasnost zadání nebo chybějící podklady',root),text=el('textarea',undefined,issues);text.value=grade.taskIssue;text.oninput=()=>{grade.taskIssue=text.value;save();};document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===packet.items.length-1;}
chooser.onchange=()=>{index=Number(chooser.value);show();};document.getElementById('prev').onclick=()=>{if(index>0){index--;show();}};document.getElementById('next').onclick=()=>{if(index+1<packet.items.length){index++;show();}};
document.getElementById('export').onclick=()=>{save();const blob=new Blob([JSON.stringify(draft,null,2)+'\\n'],{type:'application/json'}),u=URL.createObjectURL(blob),a=el('a');a.href=u;a.download='code-second-review-'+packet.packetId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};show();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--answers', type=Path, required=True)
    parser.add_argument('--replay', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if not all(p.is_absolute() for p in [args.answers, args.replay, args.out]):
        parser.error('All paths must be absolute; --out must be new.')
    raw_answers, raw_replay = args.answers.read_bytes(), args.replay.read_bytes()
    replay = json.loads(raw_replay)
    if digest(raw_answers) != replay['sources']['answers']['sha256']:
        raise ValueError('SOURCE_ANSWERS_HASH_MISMATCH')
    packet, identities = prepare(json.loads(raw_answers), replay)
    args.out.mkdir(mode=0o700)  # Fail if existing; never overwrite review edits.
    public = args.out / 'public'; public.mkdir()
    private = args.out / 'custody'; private.mkdir(mode=0o700)
    for name, value in [('answers.json', packet), ('grades-template.json', template(packet))]:
        (public / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    (public / 'review.html').write_text(render(packet))
    key = {'packetId': packet['packetId'], 'identities': identities,
           'answersSha256': digest(raw_answers), 'replaySha256': digest(raw_replay),
           'publicArtifacts': {p.name: digest(p.read_bytes()) for p in public.iterdir()},
           'decisionAuthority': False, 'reviewerGradesIncluded': False}
    (private / 'identity-key.json').write_text(json.dumps(key, ensure_ascii=False, indent=2)+'\n')
    (private / 'identity-key.json').chmod(0o600)
    print(json.dumps({'status': packet['status'], 'answers': len(packet['items']),
                      'review': str(public / 'review.html'), 'identityMasked': True,
                      'independentAcceptance': False, 'inference': False}))


if __name__ == '__main__':
    main()
