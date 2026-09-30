#!/usr/bin/env python3
"""Freeze a developmental judge experiment from immutable, real reviews."""
import argparse, hashlib, json, pathlib, urllib.request, subprocess
from datetime import datetime, timezone

E = pathlib.Path('/mnt/vi7000/intentsmith/evidence')
ROOT = pathlib.Path(__file__).resolve().parents[2]
def sha(x): return hashlib.sha256(x if isinstance(x, bytes) else x.encode()).hexdigest()
def dump(x): return json.dumps(x, ensure_ascii=False, indent=2)+'\n'
def main():
    p=argparse.ArgumentParser();p.add_argument('--out',required=True,type=pathlib.Path);a=p.parse_args()
    a.out.mkdir(mode=0o700);(a.out/'restricted').mkdir(mode=0o700);(a.out/'receipts').mkdir(mode=0o700)
    sources={}
    def read(path):
        raw=path.read_bytes();sources[str(path)]=sha(raw);return json.loads(raw)
    def grades(x):
        if 'grades' in x:return {k:[r['score'] for r in v['criteria']] for k,v in x['grades'].items()}
        return {r['id']:r['ratings'] for r in x['cases']}
    packets=[]
    for name,packet,key,first,second in [
        ('CHAT',E/'hunt-chat-context-fixed-20260927-v2/review/packet.json',E/'hunt-chat-context-fixed-20260927-v2/review/restricted/identity-key.json',
         E/'hunt-chat-context-fixed-20260927-v2/assessment-codex/review.json',E/'hunt-chat-second-review-20260927/second-review.json'),
        ('DR',E/'hunt-model-cleanup-v6-20260926/review-v3/packet.json',E/'hunt-model-cleanup-v6-20260926/review-v3/restricted/identity-key.json',
         E/'hunt-step3-codex-grading-20260926/dr-review.json',E/'hunt-step3-second-grader-20260926/dr/review.json')]:
        pk=read(packet);ky=read(key);r1=read(first);r2=read(second)
        assert ky['packetSha256']==sources[str(packet)]==r1['packetSha256']==r2['packetSha256']
        packets.append((name,pk,{c['id']:c for c in ky['cases']},grades(r1),grades(r2)))
    seed='hunt-judge-candidates-20260928-v1'
    order=lambda x:sha(seed+str(x))
    chat=packets[0][1]['cases'];groups=sorted({c['task'].split('_',1)[1] for c in chat},key=order)
    assert len(groups)==20
    selected=[]
    for i,g in enumerate(groups):
        lang='cs' if i%2==0 else 'en'
        subset=[c for c in chat if c['task']==lang+'_'+g];assert len(subset)==2
        selected.extend(('CHAT',dict(c,stage='screen' if i<12 else 'confirm',group=g,language=lang)) for c in subset)
    dr=packets[1]
    for role in ['D1','D2','R1','R2']:
        items=[c for c in dr[1]['cases'] if c['role']==role]
        for artifact in sorted({dr[2][c['id']]['digestSha256'] for c in items}):
            c=min((c for c in items if dr[2][c['id']]['digestSha256']==artifact),key=lambda c:order(c['id']))
            selected.append(('DR',dict(c,stage='screen',group='model_cleanup',language='en')))
    reverse=set()
    for role in ['D1','D2','R1','R2']:
        reverse.add(min((c for _,c in selected if c['role']==role),key=lambda c:order(c['id']))['id'])
    for g in groups[:2]:reverse.update(c['id'] for _,c in selected if c['role']=='CHAT' and c['group']==g)
    public=[];private={}
    for kind,c in selected:
        _,pk,keys,r1,r2=next(x for x in packets if x[0]==kind)
        cid=sha(seed+c['id'])[:24];original=c['id'];identity=keys[original]
        public.append(dict(id=cid,role=c['role'],task=c['task'],group=c['group'],language=c['language'],stage=c['stage'],
                           reverse=c['stage']=='confirm' or original in reverse,question=c['question'],response=c['response'],rubric=c['rubric'],
                           context={'clockLocalDate':pk['clockLocalDate']} if kind=='CHAT' else {}))
        private[cid]=dict(sourceCaseId=original,answerDigest=identity['digestSha256'],answerModel=identity['model'],
                          first=r1[original],second=r2[original])
    tags=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/tags'))['models']
    names=['gemma4:26b','devstral-small-2:latest','phi4:14b','qwen3.6:27b','ornith-1.5:9b','qwen3-coder:latest',
           'qwen3:14b','qwen3-30b-a3b:latest','qwen3.8:latest','qwen3.5:27b']
    models=[]
    for name in names:
        row=next(t for t in tags if t['name']==name)
        family='qwen' if name.startswith(('qwen','ornith')) else 'mistral' if name.startswith('devstral') else 'gemma' if name.startswith('gemma') else 'phi'
        models.append(dict(name=name,family=family,artifact=dict(modelName=name,digestSha256=row['digest'],providerVersion='0.34.2-intentsmith.1'),
                           details=row['details'],size=row['size'],commonCohort=not name.startswith(('qwen3.8:','qwen3.5:'))))
    inputs=dump(public);refs=dump(private)
    (a.out/'inputs.json').write_text(inputs);(a.out/'restricted/references.json').write_text(refs)
    plan=dict(schemaVersion=1,status='PREDECLARED_DEVELOPMENT_EXPERIMENT',decisionAuthority=False,simulation=False,
              preparedAt=datetime.now(timezone.utc).isoformat(),sourceRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              sourceHashes={str(f.relative_to(ROOT)):sha(f.read_bytes()) for f in [ROOT/f for f in ['scripts/manual/prepare-judge-panel.py','scripts/manual/judge-panel-protocol.mjs','scripts/manual/judge-panel-lifecycle.mjs','scripts/manual/run-judge-panel.mjs',
                'scripts/run-model-hunt-provider.js','src/eval/collection-stage-provider.js','src/eval/model-evaluation-runner.js','src/eval/grading-provider-guard.js','src/upgrade/gpu-evaluation-lock.js']]},
              sources=sources,inputsSha256=sha(inputs),referencesSha256=sha(refs),models=models,seed=seed,
              sampling=dict(screenChatGroups=groups[:12],confirmationChatGroups=groups[12:],screenCases=32,screenReverseCases=8,confirmationCases=16,
                            drLimitation='One historical case, four role-specific outputs; diagnostic only, never four independent cases.'),
              options=dict(num_ctx=16384,num_predict=2048,temperature=0,top_p=1,timeout=300000,format='json',think=False),
              budget=dict(maximumCalls=600,maximumHours=8,maximumOutputTokens=1228800),maxPowerWatts=175,
              resourceFloors=dict(freeRamGiB=8,freeEvidenceGiB=40,freeHomeGiB=40,freeTmpGiB=2),
              selection=dict(primary='CHAT mean absolute error to each reference separately; mean of these two errors on criteria whose references differ <= 0.25. Scores themselves are never merged.',
                             secondary=['invalid judgement rate','severe false accepts/rejects on consensus','distance outside reference band','criterion order instability','latency'],
                             shortlist='Four candidates: lowest CHAT error in each distinct family, subject to <=5% invalid and >=90% of eligible screen cases completed. If fewer qualify, report strongest exploratory candidates with failures visible.',
                             finalPair='Prefer different model families, held-out confirmation accuracy, fewer shared severe mistakes. Inspect evidence reasons before recommendation. No automatic acceptance.',
                             selfGrading='Always skip exact producer digest. Two Qwen producers have half the cases; compare them only on matched answer subsets, not the common-cohort ranking.',
                             noTuning='Do not change prompt, options, selection, or source labels after inference starts.'),
              limitations=['Known development responses, not independent evaluator acceptance.','Real references are two LLM reviews with declared prior exposure; unresolved disagreements remain separate.',
                           'No proof of universal grading across CODE/VISION: deterministic oracle tasks stay outside this judge trial.',
                           'Original captured answers use their original provider versions; only judge calls use this newly frozen provider.'])
    (a.out/'plan.json').write_text(dump(plan))
    for f in [a.out/'inputs.json',a.out/'plan.json',a.out/'restricted/references.json']:f.chmod(0o600)
    print(dump(dict(directory=str(a.out),planSha256=sha((a.out/'plan.json').read_bytes()),cases=len(public),models=len(models))))
if __name__=='__main__':main()
