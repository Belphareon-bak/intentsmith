#!/usr/bin/env python3
"""Export a completed, equal-profile production CHAT canary for blind review.

The packet contains complete three-turn transcripts and task criteria. Identity
is written separately; this script does not grade, compare, or assign roles.
"""
import argparse
import hashlib
import html
import json
import os
import secrets
from pathlib import Path

def sha(data): return hashlib.sha256(data).hexdigest()
def read(path):
    data=path.read_bytes()
    return json.loads(data),sha(data)
def write_new(path,data):
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w',encoding='utf-8') as stream:stream.write(data)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',type=Path,required=True)
    parser.add_argument('--tasks',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--audit',type=Path)
    parser.add_argument('--rubric-policy',type=Path,required=True,
        help='Frozen shared rubric policy (or fixture containing rubricPolicy), identical for both reviewers')
    args=parser.parse_args()
    plan,plan_file_sha=read(args.run/'plan.json')
    result,result_sha=read(args.run/'result.json')
    tasks,tasks_sha=read(args.tasks)
    policy_source,policy_source_sha=read(args.rubric_policy)
    policy=policy_source.get('rubricPolicy',policy_source)
    if not (isinstance(policy.get('revision'),str) and policy['revision'].strip()
            and isinstance(policy.get('instructions'),list) and policy['instructions']
            and all(isinstance(line,str) and line.strip() for line in policy['instructions'])):
        raise SystemExit('SHARED_RUBRIC_POLICY_REQUIRED')
    policy_sha=sha(json.dumps(policy,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
    model_count=len(plan.get('pairs',{}).get('CHAT',[]))
    if result['status']!='COLLECTION_COMPLETE' or len(result['attempts'])!=model_count*len(tasks) or result['unattempted']:
        raise SystemExit('CANARY_NOT_COMPLETE')
    if plan['profile']['CHAT'].find('fixed to 4096')<0 or not 2<=model_count<=26 or not tasks or len({t['id'] for t in tasks})!=len(tasks):
        raise SystemExit('PROFILE_NOT_COMPARABLE')
    assert plan['taskFileSha256']==tasks_sha and result['planSha256']==plan['planSha256']
    models={p['model']:p['artifact'] for p in plan['pairs']['CHAT']}
    full_original=len(tasks)>4
    audit_sha=None
    if full_original:
        if args.audit is None: raise SystemExit('FULL_PAIR_AUDIT_REQUIRED')
        audit,audit_sha=read(args.audit)
        if not (audit.get('status')=='COLLECTION_AUDIT_PASS'
                and audit.get('decisionAuthority') is False
                and audit.get('planSha256')==plan['planSha256']
                and audit.get('resultFileSha256')==result_sha
                and audit.get('taskFileSha256')==tasks_sha
                and audit.get('frozenClock')==plan.get('frozenClock')
                and audit.get('attempts')==len(result['attempts'])
                and audit.get('completeHistoryRequests',0)>=sum(len(task['turns']) for task in tasks)*model_count
                and audit.get('completeHistoryRequests')==audit.get('providerCalls')
                and audit.get('models')=={name:artifact['digestSha256'] for name,artifact in models.items()}
                and audit.get('localDate')):
            raise SystemExit('FULL_PAIR_AUDIT_MISMATCH')
    task_by_id={t['id']:t for t in tasks}
    by_task={}
    receipts={}
    for attempt in result['attempts']:
        path=args.run/('attempt-'+attempt['id']+'.json')
        value,file_sha=read(path)
        assert attempt['status']=='CAPTURED' and attempt['proof']=='RESPONSE_BOUND'
        assert value['status']=='CAPTURED' and value['proof']=='RESPONSE_BOUND' and value['fullGpu']
        assert value['task'] in task_by_id and len(value['dialogue'])==len(task_by_id[value['task']]['turns']) and len(value['receipts'])>=len(value['dialogue'])
        assert value['artifact']['digestSha256']==models[value['model']]['digestSha256']
        assert all(call['body'].get('options',{}).get('num_ctx')==4096 for call in value['receipts'])
        assert all(call['body'].get('think') is False for call in value['receipts'])
        assert all(call['data'].get('provider_version')==plan['providerVersion'] for call in value['receipts'])
        by_task.setdefault(value['task'],[]).append(value)
        receipts[attempt['id']]=file_sha
    assert set(by_task)=={task['id'] for task in tasks}
    if full_original and (audit.get('attemptFileSha256') != receipts
                          or audit.get('providerCalls') != sum(len(a['receipts']) for group in by_task.values() for a in group)):
        raise SystemExit('ATTEMPT_AUDIT_HASH_MISMATCH')
    if plan.get('status') == 'DERIVED_MERGED_VIEW':
        merged,_=read(args.run/'manifest.json')
        assert result.get('derivedView') is True
        assert merged['status']=='DERIVED_VIEW_NOT_ORIGINAL_RUN'
        assert merged['sourceRunLineage']==plan['sourceRunLineage']==result['sourceRunLineage']
        assert merged['excludedPriorAttempts']==plan['excludedPriorAttempts']==result['excludedPriorAttempts']
        assert merged['attemptFileSha256']==receipts
    # A public plan hash plus known model digests would make deterministic A/B
    # ordering reversible. Keep a fresh ordering key only with the identity map.
    # Retain the historical four-task canary byte-for-byte. Every new full
    # packet needs an ordering secret: public plan hashes and installed model
    # digests otherwise reveal which candidate is A or B.
    secret_ordering=plan.get('status') == 'DERIVED_MERGED_VIEW' or len(tasks) > 4
    blind_salt=secrets.token_hex(32) if secret_ordering else plan['planSha256']
    cases=[];key=[]
    for task in tasks:
        answers=by_task[task['id']]
        assert len(answers)==model_count and {a['model'] for a in answers}==set(models)
        answers.sort(key=lambda a:sha((blind_salt+'\0'+task['id']+'\0'+a['artifact']['digestSha256']).encode()))
        for label,answer in zip([chr(65+i) for i in range(model_count)],answers):
            case_id=sha((plan['planSha256']+'\0'+task['id']+'\0'+label).encode())[:32]
            dialogue=answer['dialogue']
            assert [turn['input'] for turn in dialogue]==task['turns']
            response='\n\n'.join(f"Turn {i} — User:\n{turn['input']}\n\nTurn {i} — Assistant:\n{turn['result']['content']}" for i,turn in enumerate(dialogue,1))
            rubric=[f"{criterion['id']} [{criterion['axis']}]: {criterion['requirement']} Evidence: {criterion['evidence']} Excludes: {criterion['excludes']}" for criterion in task['rubric']]
            cases.append({'id':case_id,'role':'CHAT','task':task['id'],'label':label,'repeat':1,
                'question':'\n\n'.join(f'Turn {i} — User: {turn}' for i,turn in enumerate(task['turns'],1)),
                'rubric':rubric,'response':response})
            key.append({'id':case_id,'model':answer['model'],'digestSha256':answer['artifact']['digestSha256'],
                'attemptId':answer['id'],'attemptSha256':receipts[answer['id']]})
    packet={'schemaVersion':1,'status':'DEVELOPMENT_BLIND_REVIEW','decisionAuthority':False,
        'notFreshHoldout':True,'providerVersion':plan['providerVersion'],
        'sourcePlanSha256':plan['planSha256'],'sourceResultSha256':result_sha,
        'frozenClock':plan.get('frozenClock'),
        'reviewPolicyVersion':'chat-review-shared-policy.1',
        'rubricPolicy':policy,'rubricPolicySha256':policy_sha,
        'limitations':['Known development scenarios; not a new holdout.',
            'Original unequal-context canary is diagnostic and is not pooled with these answers.',
            'Model-specific prior turns differ naturally; all user turns, handler code and request options are matched.'],
        'cases':cases}
    if full_original:
        packet['collectionAuditSha256']=audit_sha
        packet['clockLocalDate']=audit['localDate']
        packet['repairRetryCalls']=audit.get('repairRetryCalls',0)
        if plan.get('frozenClock'):packet['limitations'].append('Clock facts use an explicitly locked evaluation reference, not the real wall-clock date. Do not pool with historical live-clock cohorts.')
        packet['limitations'].append('Matched first-call system prompts/options and the common retry policy were checked against one shared calendar date. Every request, including repairs, carries complete prior user inputs. The dialogue shows the final handler answer; intermediate repair outputs remain in raw evidence. This does not grade response quality.')
    if plan.get('status') == 'DERIVED_MERGED_VIEW':
        packet['derivedView']=True
        packet['excludedPriorAttemptCount']=len(plan['excludedPriorAttempts'])
        packet['limitations'].append('This review packet combines two separately sealed captures; the restricted identity key links their SHA-256 lineage.')
        packet['limitations'].append('Incomplete attempts from the interrupted source run are excluded from paired answers and recorded in the restricted identity key.')
    output=json.dumps(packet,ensure_ascii=False,indent=2)+'\n'
    packet_sha=sha(output.encode())
    review_template={'schemaVersion':1,'status':'DRAFT_EXPOSURE_RECORDED','decisionAuthority':False,
        'packetSha256':packet_sha,'reviewer':'','exposure':'','reviewedAt':'',
        'cases':[{'id':c['id'],'ratings':[None]*len(c['rubric']),'reasons':['']*len(c['rubric'])} for c in cases]}
    body=['<!doctype html><html lang="cs"><meta charset="utf-8"><title>CHAT · produkční canary k hodnocení</title><style>body{background:#111;color:#eee;font:15px/1.5 system-ui;max-width:1150px;margin:auto;padding:24px}article{background:#1c1c1c;border:1px solid #554b3b;padding:16px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#090909;padding:16px;max-height:650px;overflow:auto}textarea,input{background:#292929;color:#fff;border:1px solid #8b7755;padding:6px}textarea{width:90%}label{display:block;margin:8px 0}button{background:#e6b665;padding:9px}</style><h1>CHAT · skutečný produkční handler</h1>',
        f'<p>{len(cases)} dialogů · {model_count} anonymních modelů na stejnou úlohu · stejné skutečné num_ctx=4096 · packet SHA256 <code>{packet_sha}</code>. Vývojové případy, bez rozhodovací autority. Pokud identitu či předchozí známku znáš, přiznej expozici v review.</p>',
        '<label>Hodnotitel <input id="reviewer"></label><label>Předchozí expozice identitám nebo známkám <textarea id="exposure" rows="2"></textarea></label><button id="export">Stáhnout posudek JSON</button>']
    body.append(f'<h2>Společná verzovaná pravidla pro oba hodnotitele</h2><p>SHA256 {policy_sha}. Změna pravidel vyžaduje nový posudek, původní známky se nepřepisují.</p><pre>{html.escape(json.dumps(policy,ensure_ascii=False,indent=2))}</pre>')
    if full_original:
        clock_label='Uzamčené referenční datum tohoto hodnocení' if plan.get('frozenClock') else 'Místní datum systémových hodin'
        body.append(f'<p>Fakt sběru: {clock_label} {html.escape(audit["localDate"])}. Správnost konkrétních dat ověřte podle zadání a kalendáře.</p>')
    for c in cases:
        body.append(f"<article><h2>{html.escape(c['task'])} · odpověď {c['label']}</h2><small>{c['id']}</small><details><summary>Celé zadání</summary><pre>{html.escape(c['question'])}</pre></details><h3>Celý dialog</h3><pre>{html.escape(c['response'])}</pre>")
        for i,text in enumerate(c['rubric']):
            body.append(f'<div><p>{i+1}. {html.escape(text)}</p><label>Známka 0–1 <input type="number" min="0" max="1" step="0.01" data-id="{c["id"]}" data-criterion="{i}"></label><label>Důvod a citace odpovědi<textarea data-id="{c["id"]}" data-reason="{i}" rows="3"></textarea></label></div>')
        body.append('</article>')
    template=json.dumps(review_template,ensure_ascii=False).replace('<','\\u003c')
    body.append(f'<script>const review={template};document.getElementById("export").onclick=()=>{{review.reviewer=document.getElementById("reviewer").value.trim();review.exposure=document.getElementById("exposure").value.trim();review.reviewedAt=new Date().toISOString();for(const c of review.cases){{c.ratings=c.ratings.map((_,i)=>{{const x=document.querySelector(`[data-id="${{c.id}}"][data-criterion="${{i}}"]`);return x.value===""?null:Number(x.value)}});c.reasons=c.reasons.map((_,i)=>document.querySelector(`[data-id="${{c.id}}"][data-reason="${{i}}"]`).value.trim())}}const blob=new Blob([JSON.stringify(review,null,2)+"\\n"],{{type:"application/json"}});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="chat-production-canary-review.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}};</script></html>')
    args.out.mkdir(mode=0o700)
    write_new(args.out/'packet.json',output)
    write_new(args.out/'review.html','\n'.join(body))
    write_new(args.out/'review-template.json',json.dumps(review_template,ensure_ascii=False,indent=2)+'\n')
    write_new(args.out/'REVIEWERS.md',f'''# Stejné podklady pro oba hodnotitele

Použijte packet.json ({packet_sha}) a review-template.json.
Celá rubrika je v cases[].rubric a rubricPolicy ({policy_sha}); stejný obsah zobrazuje review.html.
Posuzujte samostatně, bez klíče identit a bez známek druhého hodnotitele.
Přiznejte předchozí expozici. Ke každé známce připojte důvod a přesný tah/citaci.
Nejasné pravidlo označte a zdůvodněte; nepřidávejte vlastní obecné pravidlo v průvodních instrukcích.
Změna společné rubriky znamená nový packet SHA a nové, oddělené posudky pro oba hodnotitele.
Staré známky se na tento packet nepřevádějí změnou jejich SHA.
''')
    restricted=args.out/'restricted';restricted.mkdir(mode=0o700)
    identity={'packetSha256':packet_sha,'cases':key}
    if plan.get('status') == 'DERIVED_MERGED_VIEW':
        identity['sourceRunLineage']=plan['sourceRunLineage']
        identity['excludedPriorAttempts']=plan['excludedPriorAttempts']
    if secret_ordering:
        identity['blindSalt']=blind_salt
    write_new(restricted/'identity-key.json',json.dumps(identity,indent=2)+'\n')
    write_new(args.out/'manifest.json',json.dumps({'status':'NOT_GRADED','packetSha256':packet_sha,
        'planFileSha256':plan_file_sha,'resultSha256':result_sha,'taskInputSha256':tasks_sha,
        'rubricPolicySourceSha256':policy_source_sha,'rubricPolicySha256':policy_sha,
        'attemptFileSha256':receipts,'collectionAuditSha256':audit_sha,'decisionAuthority':False},indent=2)+'\n')
    print(json.dumps({'status':'EXPORTED_NOT_GRADED','cases':len(cases),'packetSha256':packet_sha,'out':str(args.out)}))

if __name__=='__main__': main()
