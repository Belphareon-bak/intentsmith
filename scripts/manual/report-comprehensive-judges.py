#!/usr/bin/env python3
"""Verified descriptive tables, all pairs, evidence browser; never issues acceptance."""
import argparse,collections,hashlib,html,importlib.util,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('audit',ROOT/'scripts/manual/audit-judge-sensitivity.py');audit=importlib.util.module_from_spec(s);s.loader.exec_module(audit)
def dump(v):return json.dumps(v,ensure_ascii=False,indent=2)+'\n'
def fmt(v):return '—' if v is None else f'{100*v:.1f} %'
def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
 if a.source.resolve()==a.out.resolve() or a.source.resolve() in a.out.resolve().parents:raise ValueError('SEPARATE_REPORT_REQUIRED')
 verified=subprocess.run(['node',str(ROOT/'scripts/manual/verify-comprehensive-judges.mjs'),str(a.source)],capture_output=True,text=True,check=True)
 v=json.loads(verified.stdout);plan=json.loads((a.source/'plan.json').read_text());cases=json.loads((a.source/'inputs.json').read_text());refs=json.loads((a.source/'restricted/references.json').read_text());case={c['id']:c for c in cases}
 rows,ignored=audit.read_rows(a.source);assert not ignored
 out=a.out;out.mkdir(parents=True,exist_ok=False)
 (out/'verification.json').write_text(dump(v));(out/'criterion-rows.json').write_text(dump(rows))
 panels={};decisions=[]
 for dataset in sorted({c['dataset'] for c in cases}):
  for role in sorted({c['role'] for c in cases if c['dataset']==dataset}):
   for part in ['all','screen','confirm']:
    key=':'.join([dataset,role,part]);rs=[r for r in rows if r['dataset']==dataset and r['role']==role and (part=='all' or r['sourceStage']==part)]
    models={m['name']:audit.summarize([r for r in rs if r['model']==m['name']]) for m in plan['models']}
    pairs=audit.pair_summaries(rs);families={m['name']:m['family'] for m in plan['models']}
    for pair in pairs:pair['differentFamilies']=families[pair['a']]!=families[pair['b']]
    panels[key]={'models':models,'pairs':pairs}
 # Nomination is a prespecified development filter, not a best-looking MAE sort.
 for dataset in sorted({c['dataset'] for c in cases if c['dataset']!='authored-control'}):
  for role in sorted({c['role'] for c in cases if c['dataset']==dataset}):
   for m in plan['models']:
    failures=[]
    author_gap=None
    for part in ['screen','confirm']:
     x=panels[':'.join([dataset,role,part])]['models'][m['name']]
     if not x['criteria']:failures.append(part+':NO_ELIGIBLE_CAPTURE');continue
     if x['validCriteria']/x['criteria']<.95:failures.append(part+':VALIDITY_BELOW_95_PERCENT')
     if x['lowTotal']<5 or x['lowGroups']<3:failures.append(part+':TOO_FEW_LOW_GROUPS')
     if x['lowRecall'] is None or x['lowRecall']<.7:failures.append(part+':LOW_RECALL_BELOW_70_PERCENT')
     if x['highFalseRejectionRate'] is None or x['highFalseRejectionRate']>.1:failures.append(part+':HIGH_FALSE_REJECTION')
     if x['groupMAE'] is None or x['groupMAE']>=x['alwaysOneGroupMAEMatched']:failures.append(part+':NOT_BETTER_THAN_ALWAYS_ONE')
    if role=='CHAT':
     policy=plan.get('selection',{}).get('authorGap')
     if not policy:failures.append('AUTHOR_GAP_POLICY_NOT_LOCKED')
     else:
      author_gap=audit.author_gap_filter([r for r in rows if r['dataset']==dataset and r['role']==role and r['model']==m['name']],policy)
      failures.extend(author_gap['reasons'])
    if v['status']!='CAPTURE_COMPLETE':failures.append('PANEL_INCOMPLETE')
    decisions.append({'dataset':dataset,'role':role,'model':m['name'],'developmentFilterPassed':not failures,'reasons':failures,'authorGap':author_gap,'decisionAuthority':False})
 report={'status':v['status'],'simulation':False,'decisionAuthority':False,'planSha256':v['planSha256'],'sources':plan['sources'],
  'analysisSourceSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'panels':panels,'developmentNominations':decisions,
  'orderProbes':v['order'],'limitations':plan['limitations']}
 (out/'report.json').write_text(dump(report))
 lines=['# Místní hodnotitelé — rozšířené porovnání','',f"Stav: **{v['status']}**, {v['captured']}/{v['expected']} volání, {v['valid']} platných. Bez rozhodovací autority.",'',
  'Výsledky rolí a verzí sběru se neslévají. Reference jsou dva původní posudky, nikoli jejich průměr coby nová pravda. MAE je průměr dvou vzdáleností, uvnitř skupin se stejnou vahou skupin. Spory referencí >25 p. b. jsou mimo hlavní MAE. Záchyt nízkých znamená obě reference ≤50 % a místní známka ≤50 %. Chybějící posudek není záchyt ani nula autorovi.','']
 for key,panel in panels.items():
  if not key.endswith(':all'):continue
  lines.extend(['## '+key,'','| Hodnotitel | Kritéria platná / plán | Nízká zachycená / celkem | Nesprávně odmítnutá vysoká / celkem | MAE | Všemu 100 % |','|---|---:|---:|---:|---:|---:|'])
  for model,x in panel['models'].items():
   if not x['criteria']:continue
   lines.append(f"| {model} | {x['validCriteria']}/{x['criteria']} | {x['lowCaught']}/{x['lowTotal']} | {x['highIncorrectlyRejected']}/{x['highTotal']} | {fmt(x['groupMAE'])} | {fmt(x['alwaysOneGroupMAEMatched'])} |")
  lines+=['']
 lines+=['## Meze závěru','']+['- '+s for s in plan['limitations']]
 (out/'REPORT.md').write_text('\n'.join(lines)+'\n')
 # Complete per-answer browser. The viewer sees author names only here, never in grader payloads.
 bycase=collections.defaultdict(lambda:collections.defaultdict(list))
 for r in rows:bycase[r['caseId']][r['model']].append(r)
 data=[]
 for c in cases:
  r=refs[c['id']];data.append(dict(c,author=r['answerModel'],first=r['first'],second=r['second'],firstReasons=r.get('firstReasons',[]),secondReasons=r.get('secondReasons',[]),judges=bycase[c['id']]))
 payload=json.dumps(data,ensure_ascii=False).replace('<','\\u003c')
 page='''<!doctype html><meta charset="utf-8"><title>Hodnotitelé: celé důkazy</title><style>body{font:16px system-ui;max-width:1400px;margin:24px auto;background:#14171c;color:#eee}select{font:inherit;max-width:95%;margin:8px;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#20252b;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #59616b;padding:9px;vertical-align:top}small{color:#aab3bd}summary{cursor:pointer}</style><h1>Místní hodnotitelé: dotaz → odpověď → obě reference → místní posudky</h1><p>Vývojové porovnání. Původní dvě reference zůstávají samostatné. Vyloučená rodina nemá známku; není to nula. Kontrolní odpovědi vytvořil jeden autor.</p><label>Role <select id="role"></select></label><label>Odpověď <select id="case"></select></label><div id="view"></div><script>const data=PAYLOAD;const role=document.querySelector('#role'),pick=document.querySelector('#case'),view=document.querySelector('#view');const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const score=s=>s==null?'CHYBÍ':(s*100).toFixed(0)+' %';role.innerHTML=['vše',...new Set(data.map(c=>c.role))].map(r=>'<option>'+esc(r)+'</option>').join('');function options(){pick.innerHTML=data.filter(c=>role.value==='vše'||role.value===c.role).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.dataset+' · '+c.task+' · '+c.author+' · '+c.id.slice(0,8))+'</option>').join('');render()}function render(){const c=data.find(c=>c.id===pick.value);if(!c)return;view.innerHTML='<h2>'+esc(c.task)+' · '+esc(c.author)+'</h2><p>'+esc(c.dataset)+' / '+esc(c.sourceStage)+' / '+esc(c.id)+'</p><details><summary>Celé zadání a kontext</summary><pre>'+esc(c.question)+'\\n'+esc(JSON.stringify(c.context))+'</pre></details><details><summary>Celá odpověď</summary><pre>'+esc(c.response)+'</pre></details>'+c.rubric.map((r,i)=>'<h3>Kritérium '+(i+1)+'</h3><pre>'+esc(r)+'</pre><table><tr><th>Hodnotitel</th><th>Známka</th><th>Důvod</th></tr><tr><td>Reference 1</td><td>'+score(c.first[i])+'</td><td>'+esc(c.firstReasons[i])+'</td></tr><tr><td>Reference 2</td><td>'+score(c.second[i])+'</td><td>'+esc(c.secondReasons[i])+'</td></tr>'+Object.entries(c.judges).map(([m,rs])=>{const j=rs.find(x=>x.criterion===i+1);return '<tr><td>'+esc(m)+'</td><td>'+score(j?.score)+'</td><td>'+esc(j?.evidence||j?.problem)+'</td></tr>'}).join('')+'</table>').join('')}role.onchange=options;pick.onchange=render;options();</script>'''
 (out/'comparison.html').write_text(page.replace('PAYLOAD',payload))
 print(dump({'status':v['status'],'captured':v['captured'],'expected':v['expected'],'out':str(out)}))
if __name__=='__main__':main()
