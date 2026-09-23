#!/usr/bin/env python3
"""Full matrix of existing observations; no new grading or model calls."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
for key in ['answers', 'grades', 'identities', 'out']:
    parser.add_argument('--' + key, required=True, type=Path)
parser.add_argument('--code-components', type=Path)
parser.add_argument('--component-review', type=Path)
args = parser.parse_args()
if not args.out.is_absolute():
    parser.error('--out must be absolute')
sources = {}
def read(name):
    path = getattr(args, name)
    raw = path.read_bytes()
    sources[name] = {'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest()}
    return json.loads(raw)

answers, grades, identities = read('answers'), read('grades'), read('identities')
components = read('code_components') if args.code_components else None
component_by_id = {}
opinion_by_id = {}
if components:
    assert components['status'] == 'EXECUTABLE_COMPONENT_REPLAY_COMPLETE'
    assert components['decisionAuthority'] is False and components['fullOracleAccepted'] is False
    assert components['sources']['answers']['sha256'] == sources['answers']['sha256']
    assert components['sources']['identities']['sha256'] == sources['identities']['sha256']
    assert {r['id'] for r in components['items']} == {r['id'] for r in answers['items'] if r['role'] == 'CODE'}
    for item in components['items']:
        assert item['assessment']['score'] is None and item['assessment']['passed'] is False
        assert item['id'] not in component_by_id
        # Large immutable stdout stays in the linked evidence JSON, not the UI payload.
        assessment = {**item['assessment'], 'technical': {k: v for k, v in item['assessment']['technical'].items() if k != 'output'}}
        component_by_id[item['id']] = {**item, 'assessment': assessment}
if args.component_review:
    assert components, '--component-review requires --code-components'
    opinion = read('component_review')
    assert opinion['status'] == 'AUTHOR_REVIEW_FOR_ADJUDICATION' and opinion['decisionAuthority'] is False
    assert opinion['source']['sha256'] == sources['code_components']['sha256']
    for row in opinion['items']:
        assert row['id'] in component_by_id and row['id'] not in opinion_by_id
        assert row['responseSha256'] == component_by_id[row['id']]['responseSha256']
        assert row['fullTaskScore'] is None
        opinion_by_id[row['id']] = {k: v for k, v in row.items() if k != 'observations'}
grade_by_id = {g['id']: g for g in grades['items']}
assert len(grade_by_id) == len(grades['items'])
assert len({r['id'] for r in answers['items']}) == len(answers['items'])
assert set(grade_by_id) == {r['id'] for r in answers['items']}
inputs = answers['inputs']
json_only = re.compile(r'Return\s+(?:ONLY\s+(?:a\s+)?JSON|JSON\s+only)|Vrať\s+pouze\s+JSON', re.I)
def requests_json(key):
    messages = inputs[key].get('messages', [])
    return any(json_only.search(m.get('content', '')) for m in messages if m.get('role') == 'user')

items = []
for row in answers['items']:
    g, identity = grade_by_id[row['id']], identities[row['id']]
    assert row['responseSha256'] == g['responseSha256']
    assert hashlib.sha256(row['response'].encode()).hexdigest() == row['responseSha256']
    assert (row['role'], row['task']) == (g['role'], g['task'])
    component = component_by_id.get(row['id'])
    if component:
        assert component['responseSha256'] == row['responseSha256']
        assert component['model'] == identity['model'] and component['artifact'] == identity['artifact']
    # Original values are preserved, including known suspect CODE results.
    # This warning applies to EVERY answer of the affected task, not only to
    # the three observed false negatives: false positives are possible too.
    warning = ('Známka čeká na opravu orákula: doložené falešné přijetí i odmítnutí volného textu.'
               if row['role'] == 'CODE' and row['task'] == 'patch_90eff80ecb8a' else None)
    items.append({**row, 'grade': g, 'model': identity['model'], 'artifact': identity['artifact'],
                  'jsonRequested': requests_json(row['inputKey']), 'warning': warning,
                  **({'codeComponent': component} if component else {}),
                  **({'componentOpinion': opinion_by_id[row['id']]} if row['id'] in opinion_by_id else {})})

def aggregate(rows, field):
    # Repetitions do not acquire extra task weight. Missing values remain
    # visible; a partially observed mean is not a complete comparable score.
    tasks = collections.defaultdict(list)
    missing = 0
    for row in rows:
        value = field(row)
        tasks[row['task']].append(value)
        missing += value is None
    means = []
    for values in tasks.values():
        known = [v for v in values if v is not None]
        if known:
            means.append(sum(known) / len(known))
    observed = sum(means) / len(means) if means else None
    return {'observedMean': observed, 'completeMean': observed if missing == 0 else None,
            'attempts': len(rows), 'missing': missing, 'tasks': len(tasks)}

grouped = collections.defaultdict(list)
for row in items:
    grouped[row['role'], row['model']].append(row)
technical_tasks = {(r['role'], r['task']) for r in items
                   if r['grade']['method'] in ['PRODUCTION_PARSER_EXACT_FIELDS', 'EXECUTED_CODE_CHECKS']
                   or r['role'] in ['D1', 'D2', 'R1', 'R2']}
summaries = []
for (role, model), rows in sorted(grouped.items()):
    content = aggregate(rows, lambda r: r['grade'].get('contentScore'))
    # These are old rubric observations on single-turn prose, explicitly NOT
    # acceptance of a new conversation-quality metric.
    prose = [r for r in rows if role == 'CHAT' and not r['jsonRequested']]
    # Task membership cannot depend on whether this candidate completed an
    # attempt. Otherwise token-limit failures disappear from its denominator.
    exact = [r for r in rows if (role, r['task']) in technical_tasks]
    structured = [r for r in rows if r['jsonRequested']]
    summaries.append({'role': role, 'model': model, 'historicalContent': content,
        'conversationProxy': aggregate(prose, lambda r: r['grade'].get('contentScore')),
        'technical': aggregate(exact, lambda r: r['grade'].get('contentScore')),
        **({'executableComponent': aggregate(rows, lambda r: r['codeComponent']['assessment']['technical']['score'])}
           if role == 'CODE' and components else {}),
        'strictJson': aggregate(structured, lambda r: None if r['grade'].get('format', {}).get('strictJson') is None else int(r['grade']['format']['strictJson'])),
        'runtimeParsed': aggregate(structured, lambda r: None if r['grade'].get('format', {}).get('runtimeParsed') is None else int(r['grade']['format']['runtimeParsed'])),
        'oracleReviewRequired': any(r['warning'] for r in rows)})

coverage = {}
for role in sorted({r['role'] for r in items}):
    role_rows = [r for r in items if r['role'] == role]
    all_tasks = {r['task'] for r in role_rows}
    prose_tasks = {r['task'] for r in role_rows if role == 'CHAT' and not r['jsonRequested']}
    exact_tasks = {task for task_role, task in technical_tasks if task_role == role}
    outside = sorted(all_tasks - prose_tasks - exact_tasks)
    coverage[role] = {'totalTasks': len(all_tasks), 'coveredTasks': len(prose_tasks | exact_tasks),
                      'outsideContentAxes': outside,
                      'outsideAttempts': sum(r['task'] in outside for r in role_rows),
                      'reason': 'Požadují JSON, ale původní obsah je hodnocen posudkem; '
                                'nepatří do osy prózy ani přesných polí. Původní známky jsou v matici.'}

payload = {'schemaVersion': 1, 'status': 'ORIGINAL_GRADES_WITH_SEPARATE_CODE_COMPONENT' if components else 'EXISTING_OBSERVATIONS_NOT_REPLAYED',
           'decisionAuthority': False, 'productionImported': False, 'sources': sources,
           'inputs': inputs, 'items': items, 'summaries': summaries, 'contentAxisCoverage': coverage}
data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
document = '''<!doctype html><html lang="cs"><meta charset="utf-8"><title>GPU hunt — úplná matice</title>
<style>
:root{color-scheme:dark;font:15px system-ui;background:#101010;color:#ddd}body{margin:24px}h1{font-size:24px}h2{font-size:19px}button,select,input{font:inherit;background:#242321;color:#ddd;border:1px solid #635239;border-radius:5px;padding:7px 12px;margin:4px}button{cursor:pointer}button:hover{border-color:#d4aa60}a,.score{color:#e4b766}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #45413b;padding:10px;text-align:left;vertical-align:top}th{background:#292724;position:sticky;top:0}td:first-child{font-weight:600}small,.muted{color:#b4a387}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#191919;padding:14px;border-radius:5px}details{margin:12px 0}summary{cursor:pointer}.warning{color:#ffbc69}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.scroll{overflow:auto}.answer{border:1px solid #565047;border-radius:6px;padding:14px;margin:16px 0}.answer h3{margin-top:0}.hidden{display:none}ul{padding-left:24px}#detail{scroll-margin-top:12px}.badge{background:#302719;padding:5px}
</style>
<h1>GPU hunt — všechny uložené odpovědi a původní známky</h1>
<p class="warning">Bez nového hodnocení a bez doporučení k výměně. CODE výpis jistoty má prokázanou vadu orákula; jeho známky jsou označené ⚠. Ostatní historické známky nejsou tímto přijaté.</p>
<p>Matice zahrnuje všechny modely a úlohy dané role. V buňce jsou tři původní známky v pořadí opakování. Kliknutím otevřeš stejné zadání a odpovědi všech modelů. Chybějící výsledek je —.</p>
<div class="toolbar"><label>Role <select id="role"></select></label><label>Model <select id="model"><option value="">Všechny</option></select></label><label>Filtr úloh <input id="filter" type="search"></label><button id="reset">Zrušit filtry</button></div>
<p id="counts"></p><h2>Oddělené osy — dosavadní pokrytí</h2>
<p class="muted">Konverzační sloupec je pouze průměr původních rubrik nad jednorázovou prózou, nikoli nové měření konverzační kvality. Technická osa: CHAT/VISION přesná pole, CODE spuštěné testy, D1/D2/R1/R2 původní obsahové posudky; tyto metody nejsou zaměnitelné. Formát zde znamená pouze striktní JSON, ne úplné dodržení instrukcí. Runtime znamená parsovatelnost, nikoli správnost. Čísla jsou průměry úloh; opakování se agregují uvnitř úlohy. U neúplných dat je průměr jen z dostupných známek a počet chybějících zůstává viditelný.</p>
REPLAY_NOTICE<div id="coverage"></div><div id="axes" class="scroll"></div><h2>Úlohy × modely</h2><div id="matrix" class="scroll"></div><section id="detail"></section>
<details><summary>Původ dat a omezení</summary><pre id="sources"></pre></details>
<script id="data" type="application/json">PAYLOAD</script><script>
const data=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v==null?'—':Number(v).toLocaleString('cs-CZ',{maximumFractionDigits:3});
const roles=['CHAT','CODE','D1','D2','R1','R2','VISION'];
$('role').innerHTML=roles.map(r=>`<option>${r}</option>`).join('');
$('sources').textContent=JSON.stringify({status:data.status,decisionAuthority:data.decisionAuthority,sources:data.sources},null,2);
function roleRows(){return data.items.filter(r=>r.role===$('role').value)}
function axis(a){return a.attempts?`${fmt(a.observedMean)}<br><small>${a.tasks} úloh · ${a.attempts-a.missing}/${a.attempts} známek${a.missing?' · NEÚPLNÉ':''}</small>`:'— <small>neměřeno / netýká se</small>'}
function setModels(){const models=[...new Set(roleRows().map(r=>r.model))].sort();$('model').innerHTML='<option value="">Všechny</option>'+models.map(m=>`<option>${esc(m)}</option>`).join('');render()}
function render(){
 const rows=roleRows(),models=[...new Set(rows.map(r=>r.model))].sort().filter(m=>!$('model').value||m===$('model').value);
 const tasks=[...new Set(rows.map(r=>r.task))].sort().filter(t=>t.toLowerCase().includes($('filter').value.toLowerCase()));
 $('counts').textContent=`${rows.length} odpovědí v roli · ${new Set(rows.map(r=>r.task)).size} úloh · ${new Set(rows.map(r=>r.model)).size} modelů. Zobrazeno ${tasks.length} úloh / ${models.length} modelů.`;
 const coverage=data.contentAxisCoverage[$('role').value];
 $('coverage').innerHTML=`<p>Pokrytí obsahových os celé role: <strong>${coverage.coveredTasks} / ${coverage.totalTasks} úloh</strong>.</p>`+(coverage.outsideContentAxes.length?`<p class="warning">Mimo obsahové osy: <strong>${coverage.outsideContentAxes.length} úlohy / ${coverage.outsideAttempts} odpovědí</strong>. ${esc(coverage.reason)}</p>`+coverage.outsideContentAxes.map(t=>`<button data-task="${esc(t)}">${esc(t)}</button>`).join(''):'');
 $('axes').innerHTML='<table><thead><tr><th>Model</th><th>Konverzační obsah: původní próza</th><th>Technická správnost</th><th>Nově spuštěná technická složka CODE</th><th>Striktní JSON</th><th>Produkční parsovatelnost</th></tr></thead><tbody>'+data.summaries.filter(s=>s.role===$('role').value&&models.includes(s.model)).map(s=>`<tr><td>${esc(s.model)}</td><td>${axis(s.conversationProxy)}</td><td>${s.oracleReviewRequired?'<span class="warning">⚠ Původní, orákulum vyžaduje opravu</span><br>':''}${axis(s.technical)}</td><td>${s.executableComponent?axis(s.executableComponent)+'<br><small>Bez souhrnné známky; význam textu čeká na posouzení.</small>':'—'}</td><td>${axis(s.strictJson)}</td><td>${axis(s.runtimeParsed)}</td></tr>`).join('')+'</tbody></table>';
 $('matrix').innerHTML='<table><thead><tr><th>Test</th>'+models.map(m=>`<th>${esc(m)}</th>`).join('')+'</tr></thead><tbody>'+tasks.map(t=>`<tr><td><button data-task="${esc(t)}">${esc(t)}</button></td>`+models.map(m=>{const attempts=rows.filter(r=>r.task===t&&r.model===m).sort((a,b)=>a.repeat-b.repeat);return `<td><button data-task="${esc(t)}" data-model="${esc(m)}">${attempts.some(r=>r.warning)?'⚠ ':''}${attempts.map(r=>fmt(r.grade.contentScore)).join(' / ')||'—'}</button></td>`}).join('')+'</tr>').join('')+'</tbody></table>';
 $('detail').innerHTML='';
}
function showTask(task,model){
 const rows=roleRows().filter(r=>r.task===task).sort((a,b)=>a.model.localeCompare(b.model)||a.repeat-b.repeat),input=data.inputs[rows[0].inputKey];
 const order=[...new Set(rows.map(r=>r.model))];if(model){order.splice(order.indexOf(model),1);order.unshift(model)}
 let text=`<h2>${esc(task)}</h2><h3>Zadání — přesný vstup</h3>`+input.messages.map(m=>`<details ${m.role==='user'?'open':''}><summary>${esc(m.role)}</summary><pre>${esc(m.content)}</pre></details>`).join('');
 const images=input.messages.flatMap(m=>m.images||[]);
 for(const image of images){if(typeof image==='string'&&/^[A-Za-z0-9+/=\\s]+$/.test(image))text+=`<img alt="Původní obrazová příloha zadání" style="max-width:100%;max-height:750px" src="data:image/png;base64,${image.replace(/\\s/g,'')}">`;}
 text+=`<details><summary>Celý vstup včetně příloh</summary><pre>${esc(JSON.stringify(input,null,2))}</pre></details>`;
 for(const name of order){text+=`<h2>${esc(name)}</h2>`;for(const r of rows.filter(r=>r.model===name)){
 const g=r.grade;text+=`<article class="answer"><h3>Pokus ${r.repeat} · původní známka <span class="score">${fmt(g.contentScore)} / 1</span></h3>${r.warning?`<p class="warning">${esc(r.warning)}</p>`:''}<p class="muted">${esc(g.status)} · ${esc(g.method)} · ${esc(r.id)}</p><h4>Odpověď modelu</h4><pre>${esc(r.response)}</pre>`;
 if(r.codeComponent){const a=r.codeComponent.assessment;text+=`<section class="component"><h4>Nově spuštěná technická složka: ${fmt(a.technical.score)} / 1</h4><p class="warning">Celá úloha: neoznámkována. ${a.semantics.status==='REVIEW_REQUIRED'?'Význam textu vyžaduje posouzení.':'Tato složka neposuzuje provozní dokončení ani vysvětlení mimo záplatu.'}</p><p>${esc(a.technical.reason||'Spustitelné kontroly prošly.')}</p><details><summary>Kontroly API a skutečné výstupy funkce</summary><pre>${esc(JSON.stringify(a.technical.contractChecks,null,2))}</pre></details><details><summary>Rozsah a identita technického měření</summary><pre>${esc(JSON.stringify(r.codeComponent,null,2))}</pre></details></section>`;}
 if(r.componentOpinion)text+='<h4>Autorské posouzení textu — k revizi, neslepé</h4><ul>'+r.componentOpinion.criteria.map(c=>`<li><b>${esc(c.id)}: ${fmt(c.score)}</b> — ${esc(c.reason)}<br><small>${esc(c.scope)}</small></li>`).join('')+'</ul><p class="muted">Toto není nezávislá přejímka. Celková známka se z těchto složek nepočítá.</p>';
 text+='<h4>Důvody původní známky</h4>';
 if(g.criteria?.length)text+='<ul>'+g.criteria.map(c=>`<li>${esc(c.criterion||c.id||c.index)} — <b>${fmt(c.score??(typeof c.ok==='boolean'?Number(c.ok):null))}</b><br>${esc(c.reason||('Odpověď: '+JSON.stringify(c.observed)+'; očekáváno: '+JSON.stringify(c.expected)))}</li>`).join('')+'</ul>';
 else text+=`<p>${esc(g.detail?.reason||'Rozpad spustitelných kontrol je v podrobnostech hodnocení.')}</p>`;
 text+=`<details><summary>Úplné původní hodnocení a identita</summary><pre>${esc(JSON.stringify({grade:g,artifact:r.artifact},null,2))}</pre></details></article>`;
 }}$('detail').innerHTML=text;$('detail').scrollIntoView();
}
$('matrix').addEventListener('click',e=>{const b=e.target.closest('[data-task]');if(b)showTask(b.dataset.task,b.dataset.model)});
$('coverage').addEventListener('click',e=>{const b=e.target.closest('[data-task]');if(b)showTask(b.dataset.task,$('model').value)});
$('role').onchange=setModels;$('model').onchange=render;$('filter').oninput=render;
$('reset').onclick=()=>{$('filter').value='';$('model').value='';render()};setModels();
</script></html>'''
with args.out.open('x') as f:
    f.write(document.replace('PAYLOAD', data).replace('REPLAY_NOTICE', '<p class="warning">CODE: nové spustitelné výsledky jsou samostatná složka. Původní známky níže zůstávají zachované; celková správnost úlohy není nově oznámkovaná.</p>' if components else ''))
summary = {k: payload[k] for k in ['schemaVersion', 'status', 'decisionAuthority', 'productionImported', 'sources', 'summaries', 'contentAxisCoverage']}
summary.update({'responses': len(items), 'models': len({r['model'] for r in items}),
                'flaggedOracleResponses': sum(bool(r['warning']) for r in items),
                'chatJsonTasks': len({r['task'] for r in items if r['role']=='CHAT' and r['jsonRequested']})})
with args.out.with_suffix('.json').open('x') as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(json.dumps({k: summary[k] for k in ['status', 'responses', 'models', 'flaggedOracleResponses', 'chatJsonTasks']}))
