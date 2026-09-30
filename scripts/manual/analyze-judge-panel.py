#!/usr/bin/env python3
"""Compare real judge outputs with TWO frozen reviews, never invent a gold score."""
import argparse,collections,hashlib,html,itertools,json,math,pathlib,statistics
def avg(xs):
    xs=list(xs);return statistics.mean(xs) if xs else None
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',required=True,type=pathlib.Path);ap.add_argument('--stage',choices=['screen','confirm'],required=True);ap.add_argument('--shortlist',action='store_true');a=ap.parse_args()
    read=lambda p:json.loads((a.out/p).read_text())
    plan=read('plan.json');plan_sha=hashlib.sha256((a.out/'plan.json').read_bytes()).hexdigest()
    cases={c['id']:c for c in read('inputs.json') if c['stage']==a.stage};refs=read('restricted/references.json')
    receipts=[];unverified=[]
    for p in sorted((a.out/'receipts').glob('*.json')):
        if p.name.endswith('.post.json'):continue
        r=json.loads(p.read_text())
        if r['stage']!=a.stage:continue
        assert r['planSha256']==plan_sha
        if not p.with_name(p.stem+'.post.json').exists():unverified.append(p.name);continue
        receipts.append(r)
    by=collections.defaultdict(dict)
    for r in receipts:by[r['judge']['modelName']][(r['caseId'],r['reverse'])]=r
    metrics=[];details=[];vectors={}
    for model in plan['models']:
        name=model['name'];rs=by[name];eligible={k:c for k,c in cases.items() if refs[k]['answerDigest']!=model['artifact']['digestSha256']}
        if not rs:continue
        allparts=[];vec={};latency=[];stability=[];invalid=[]
        for cid,c in eligible.items():
            r=rs.get((cid,False));rev=rs.get((cid,True))
            if not r:continue
            latency.append(r['result']['durationMs'])
            if not r['parsed']['valid']:
                invalid.append(dict(caseId=cid,role=c['role'],task=c['task'],reason=r['parsed']['reason']));continue
            rows=r['parsed']['rows']
            if rev and rev['parsed']['valid']:
                delta=[abs(x['score']-y['score']) for x,y in zip(rows,rev['parsed']['rows'])]
                stability.append(dict(caseId=cid,maxCriterionDelta=max(delta),meanAbsoluteDelta=avg(delta),
                                      aggregateDelta=abs(avg(x['score'] for x in rows)-avg(y['score'] for y in rev['parsed']['rows'])),
                                      unstable=max(delta)>.5 or abs(avg(x['score'] for x in rows)-avg(y['score'] for y in rev['parsed']['rows']))>.150000001))
            for i,row in enumerate(rows):
                first,second=refs[cid]['first'][i],refs[cid]['second'][i]
                if first is None or second is None:continue
                value=row['score'];lo=min(first,second);hi=max(first,second);dispute=hi-lo>.250000001
                p=dict(model=name,caseId=cid,task=c['task'],role=c['role'],group=c['group'],language=c['language'],criterion=i+1,
                       score=value,first=first,second=second,referenceDispute=dispute,firstError=abs(value-first),secondError=abs(value-second),
                       pairedReferenceError=(abs(value-first)+abs(value-second))/2,outsideBand=max(lo-value,value-hi,0),
                       signedBandError=min(value-lo,0)+max(value-hi,0),falseAccept=hi<=.25 and value>=.75,falseReject=lo>=.75 and value<=.25,
                       evidence=row['evidence'])
                allparts.append(p);vec[(cid,i+1)]=p
        vectors[name]=vec;details.extend(allparts)
        role_rows={}
        for role in sorted({c['role'] for c in eligible.values()}):
            parts=[p for p in allparts if p['role']==role];cons=[p for p in parts if not p['referenceDispute']]
            group_losses=collections.defaultdict(list)
            for p in cons:group_losses[p['group']].append(p['pairedReferenceError'])
            role_rows[role]=dict(criteria=len(parts),consensusCriteria=len(cons),unresolvedCriteria=len(parts)-len(cons),groups=len(group_losses),
                primaryError=avg(avg(v) for v in group_losses.values()),maeFirst=avg(p['firstError'] for p in parts),maeSecond=avg(p['secondError'] for p in parts),
                outsideBandMAE=avg(p['outsideBand'] for p in parts),falseAccepts=sum(p['falseAccept'] for p in parts),falseRejects=sum(p['falseReject'] for p in parts),
                negativeAnchors=sum(max(p['first'],p['second'])<=.25 for p in parts),positiveAnchors=sum(min(p['first'],p['second'])>=.75 for p in parts),
                falseAcceptRate=avg(p['falseAccept'] for p in parts if max(p['first'],p['second'])<=.25),
                falseRejectRate=avg(p['falseReject'] for p in parts if min(p['first'],p['second'])>=.75),
                within25OfBoth=avg(max(p['firstError'],p['secondError'])<=.250000001 for p in cons))
        forward=sum(not rev for _,rev in rs);valid_forward=forward-len(invalid)
        reverse_invalid=[r for (cid,rev),r in rs.items() if rev and not r['parsed']['valid']]
        metrics.append(dict(model=name,family=model['family'],commonCohort=model['commonCohort'],eligibleCases=len(eligible),
            selfExcludedCases=len(cases)-len(eligible),completedCases=forward,validCases=valid_forward,invalidCases=invalid,
            invalidRate=sum(not r['parsed']['valid'] for r in rs.values())/len(rs) if rs else None,coverage=forward/len(eligible) if eligible else 0,
            reverseInvalid=len(reverse_invalid),orderChecks=len(stability),orderUnstable=sum(s['unstable'] for s in stability),
            orderMeanAbsoluteDelta=avg(s['meanAbsoluteDelta'] for s in stability),stability=stability,
            medianSeconds=statistics.median(latency)/1000 if latency else None,roles=role_rows))
    # Matched comparisons retain the same answers and criteria on both sides,
    # including the producer models which necessarily skip their own outputs.
    matched=[];pairs=[]
    for x,y in itertools.combinations(metrics,2):
        vx,vy=vectors[x['model']],vectors[y['model']];common=set(vx)&set(vy)
        cp=[k for k in common if vx[k]['role']=='CHAT' and not vx[k]['referenceDispute']]
        groups=collections.defaultdict(list)
        for k in cp:groups[vx[k]['group']].append(vx[k]['pairedReferenceError']-vy[k]['pairedReferenceError'])
        matched.append(dict(a=x['model'],b=y['model'],criteria=len(cp),groups=len(groups),
                            errorDifference=avg(avg(v) for v in groups.values()),meaning='Negative favors a; descriptive, not a significance test.'))
        agreed=[k for k in cp if abs(vx[k]['score']-vy[k]['score'])<=.250000001]
        pairs.append(dict(a=x['model'],b=y['model'],differentFamilies=x['family']!=y['family'],criteria=len(cp),
            escalationCount=len(cp)-len(agreed),silentJointErrors=sum(vx[k]['outsideBand']>.250000001 and vy[k]['outsideBand']>.250000001 for k in agreed),
            jointFalseAccepts=sum(vx[k]['falseAccept'] and vy[k]['falseAccept'] for k in cp),
            jointFalseRejects=sum(vx[k]['falseReject'] and vy[k]['falseReject'] for k in cp)))
    report=dict(status='EXPLORATORY_JUDGE_COMPARISON',decisionAuthority=False,simulation=False,stage=a.stage,planSha256=plan_sha,
                analysisSourceSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
                unverifiedReceipts=unverified,models=metrics,matchedComparisons=matched,pairs=pairs,
                limitations=plan['limitations'],metrics='Errors are fractions: multiply by 100 for percentage points; not accuracy percentages.')
    (a.out/(a.stage+'-analysis.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (a.out/(a.stage+'-criterion-comparison.json')).write_text(json.dumps(details,ensure_ascii=False,indent=2)+'\n')
    lines=['| Model | Platné / způsobilé | CHAT chyba vůči dvěma posudkům (p. b.) | Chybné vysoké / nízké známky | Nestabilita pořadí | Medián |',
           '|---|---:|---:|---:|---:|---:|']
    for m in sorted(metrics,key=lambda m:m['roles'].get('CHAT',{}).get('primaryError') if m['roles'].get('CHAT',{}).get('primaryError') is not None else 99):
        c=m['roles'].get('CHAT',{});error=c.get('primaryError');error='—' if error is None else f'{100*error:.2f}'
        lines.append(f"| {m['model']} | {m['validCases']}/{m['eligibleCases']} | {error} | {c.get('falseAccepts',0)} / {c.get('falseRejects',0)} | {m['orderUnstable']}/{m['orderChecks']} | {m['medianSeconds']:.1f} s |")
    lines+=['','Qwen3.8 a qwen3.5 nemají společný vzorek: vlastní odpovědi jsou vyloučené. Čtěte porovnání na shodných odpovědích v JSON.',
            'D/R jsou diagnostika jediného historického případu. Spor mezi referencemi není nová zlatá známka.']
    (a.out/(a.stage+'-summary.md')).write_text('\n'.join(lines)+'\n');print('\n'.join(lines))
    payload=json.dumps(dict(cases=list(cases.values()),rows=details,models=metrics),ensure_ascii=False).replace('<','\\u003c')
    page='''<!doctype html><html lang="cs"><meta charset="utf-8"><title>Porovnání místních hodnotitelů</title>
<style>body{font:16px system-ui;background:#16191d;color:#e8edf2;margin:24px auto;max-width:1300px}select,button{font:inherit;padding:8px;background:#28303a;color:inherit;border:1px solid #526070}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 system-ui}article{border:1px solid #526070;border-radius:8px;padding:18px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #526070;text-align:left;vertical-align:top}.weak{background:#542f27}.muted{color:#b0bdca}summary{cursor:pointer;padding:10px}h1{font-size:26px}</style>
<h1>Hodnotitel → zadání → odpověď → známky a důkazy</h1><p>Vývojový experiment. Dvě referenční známky zůstávají oddělené; jejich shoda není formální přejímka.</p>
<label>Hodnotitel <select id="model"></select></label> <label>Role <select id="role"><option value="">Všechny</option><option>CHAT</option><option>D1</option><option>D2</option><option>R1</option><option>R2</option></select></label>
<label><input id="errors" type="checkbox"> Jen odchylka od obou posudků &gt; 25 p. b.</label><main id="view"></main><script>
const data=DATA;const el=id=>document.getElementById(id);const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for(const m of data.models){const o=document.createElement('option');o.value=m.model;o.textContent=m.model;el('model').append(o)}
function render(){let out='';for(const c of data.cases){if(el('role').value&&c.role!==el('role').value)continue;const rows=data.rows.filter(r=>r.model===el('model').value&&r.caseId===c.id);if(!rows.length)continue;if(el('errors').checked&&!rows.some(r=>r.outsideBand>.250000001))continue;
out+='<article><h2>'+escape(c.role+' · '+c.task)+'</h2><p class="muted">'+escape(c.id)+' · celé znění, identita autora skrytá</p><details><summary>Zadání testu</summary><pre>'+escape(c.question)+'</pre></details><details><summary>Celá odpověď / dialog</summary><pre>'+escape(c.response)+'</pre></details><table><thead><tr><th>Kritérium</th><th>Codex</th><th>Opus</th><th>Místní hodnotitel</th><th>Jeho důvod</th></tr></thead><tbody>';
for(const r of rows)out+='<tr class="'+(r.outsideBand>.250000001?'weak':'')+'"><td>'+escape(c.rubric[r.criterion-1])+'</td><td>'+Math.round(r.first*100)+' %</td><td>'+Math.round(r.second*100)+' %</td><td>'+Math.round(r.score*100)+' %</td><td>'+escape(r.evidence)+'</td></tr>';out+='</tbody></table></article>';}el('view').innerHTML=out||'<p>Pro tento výběr není platný posudek. Neplatné výstupy a vyloučené sebehodnocení jsou v JSON souhrnu.</p>'}
for(const id of ['model','role','errors'])el(id).onchange=render;render();</script></html>'''.replace('DATA',payload,1)
    (a.out/(a.stage+'-comparison.html')).write_text(page)
    if a.shortlist:
        assert a.stage=='screen'
        assert read('screen-result.json')['status']=='COMPLETE' and not unverified
        selected=[]
        # Choose on the fully shared sample; Qwen producer-only subsets remain
        # supplementary evidence and cannot win by receiving easier answers.
        for family in ['gemma','mistral','phi','qwen']:
            candidates=[m for m in metrics if m['family']==family and m['commonCohort']]
            qualified=[m for m in candidates if m['coverage']>=.9 and m['invalidRate']<=.05 and m['roles'].get('CHAT',{}).get('primaryError') is not None]
            pool=qualified or [m for m in candidates if m['roles'].get('CHAT',{}).get('primaryError') is not None]
            if pool:selected.append(min(pool,key=lambda m:m['roles']['CHAT']['primaryError'])['model'])
        shortlist=dict(planSha256=plan_sha,decisionAuthority=False,models=selected,method='Best common-cohort CHAT error in each family; not acceptance; see failures in screen-analysis.json.')
        with (a.out/'shortlist.json').open('x') as f:json.dump(shortlist,f,indent=2);f.write('\n')
if __name__=='__main__':main()
