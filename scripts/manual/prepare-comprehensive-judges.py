#!/usr/bin/env python3
"""Prepare a version-separated, family-excluded judge panel. Never runs inference."""
import argparse, collections, hashlib, json, pathlib, subprocess, urllib.request
from datetime import datetime, timezone
E=pathlib.Path('/mnt/vi7000/intentsmith/evidence')
ROOT=pathlib.Path(__file__).resolve().parents[2]
SEED='comprehensive-judges-20260928-fixed-before-calls'
def sha(x): return hashlib.sha256(x if isinstance(x,bytes) else x.encode()).hexdigest()
def dump(x): return json.dumps(x,ensure_ascii=False,indent=2)+'\n'
def family(name):
    if name.startswith(('qwen','ornith')):return 'qwen'
    if name.startswith('devstral'):return 'mistral'
    if name.startswith('gemma'):return 'gemma'
    if name.startswith('phi'):return 'phi'
    raise ValueError('UNKNOWN_AUTHOR_FAMILY:'+name)
def grades(x):
    if 'grades' in x:return {k:[r['score'] for r in v['criteria']] for k,v in x['grades'].items()}
    return {r['id']:r['ratings'] for r in x['cases']}
def reasons(x):
    if 'grades' in x:return {k:[r.get('reason',r.get('evidence','')) for r in v['criteria']] for k,v in x['grades'].items()}
    return {r['id']:r['reasons'] for r in x['cases']}
def prepare(out, max_power):
    sources={};inputs=[];refs={};excluded=[]
    def read(p):
        raw=p.read_bytes();sources[str(p)]=sha(raw);return json.loads(raw)
    old=read(E/'hunt-local-judges-20260928/plan.json')
    specs=[('chat-context-fixed',E/'hunt-chat-context-fixed-20260927-v2/review/packet.json',
            E/'hunt-chat-context-fixed-20260927-v2/review/restricted/identity-key.json',
            E/'hunt-chat-context-fixed-20260927-v2/assessment-codex/review.json',
            E/'hunt-chat-second-review-20260927/second-review.json'),
           ('dr-historical',E/'hunt-isolated-20260925/blind/packet.json',
            E/'hunt-isolated-20260925/restricted/blind-review-identity-key.json',
            ROOT/'docs/review/evidence/2026-09-25-hunt-codex-all-dr-development-review.json',
            E/'hunt-grading-opus-20260925/dr-312/review.json'),
           ('dr-cleanup-v6',E/'hunt-model-cleanup-v6-20260926/review-v3/packet.json',
            E/'hunt-model-cleanup-v6-20260926/review-v3/restricted/identity-key.json',
            E/'hunt-step3-codex-grading-20260926/dr-review.json',
            E/'hunt-step3-second-grader-20260926/dr/review.json')]
    for dataset,pp,kp,ap,bp in specs:
        pk=read(pp);key=read(kp);first=read(ap);second=read(bp)
        assert key['packetSha256']==first['packetSha256']==second['packetSha256']==sources[str(pp)]
        keys={r['id']:r for r in key.get('cases',key.get('key',[]))};a,b=grades(first),grades(second);ar,br=reasons(first),reasons(second)
        for c in pk['cases']:
            why='DEFECTIVE_OLD_MODEL_CLEANUP' if dataset=='dr-historical' and c['task'].endswith('model_cleanup') else 'REPETITION_NOT_IN_PRIMARY_GRID' if c['repeat']!=1 else None
            if why:excluded.append(dict(dataset=dataset,sourceId=c['id'],reason=why));continue
            k=keys[c['id']];cid=sha(SEED+dataset+c['id'])[:24]
            group=c['task'].split('_',1)[1]
            assert len(c['rubric'])==len(a[c['id']])==len(b[c['id']])
            assert all(isinstance(v,(float,int)) and 0<=v<=1 for v in a[c['id']]+b[c['id']])
            inputs.append(dict(id=cid,role=c['role'],task=c['task'],group=group,language=c['task'][:2] if c['role']=='CHAT' else 'en',
                stage='screen',dataset=dataset,sourceStage='full',reverse=False,question=c['question'],response=c['response'],rubric=c['rubric'],
                context={'clockLocalDate':pk['clockLocalDate']} if c['role']=='CHAT' else {}))
            refs[cid]=dict(sourceCaseId=c['id'],sourcePacketSha256=sources[str(pp)],sourceProviderVersion=pk.get('providerVersion'),
                answerDigest=k['digestSha256'],answerModel=k['model'],answerFamily=family(k['model']),
                first=a[c['id']],second=b[c['id']],firstReasons=ar[c['id']],secondReasons=br[c['id']],
                referenceKind='TWO_EXPOSED_EXTERNAL_DRAFTS_NOT_GOLD',originalRepeat=c['repeat'])
    # Reuse the previously frozen, never-run controls as separate authored tests.
    prior=E/'hunt-local-judges-revision-20260928/evidence-first'
    prior_inputs=read(prior/'inputs.json');prior_refs=read(prior/'restricted/references.json')
    for c in prior_inputs:
        if c.get('dataset')!='authored-control':continue
        inputs.append(dict(c,stage='screen',sourceStage='full'));refs[c['id']]=prior_refs[c['id']]
    extra=read(ROOT/'scripts/manual/judge-controls-20260928.json')
    for g in extra:
        for variant in g['variants']:
            cid=sha(SEED+g['group']+variant['name'])[:24]
            inputs.append(dict(id=cid,role=g['role'],task='control_'+sha(g['group'])[:10],group='control_'+g['group'],language=g['language'],stage='screen',
                dataset='authored-control',sourceStage='full',reverse=False,question=g['question'],response=variant['answer'],rubric=g['rubric'],context={}))
            refs[cid]=dict(answerDigest=sha('authored:'+cid),answerModel='authored-control',answerFamily='codex-authored',
                first=variant['expected'],second=variant['expected'],referenceKind='ONE_AUTHOR_CONSTRUCTED_EXPECTATION_NOT_TWO_REVIEWERS',
                variant=variant['name'],verification=g['verification'])
    assert collections.Counter(c['dataset'] for c in inputs)=={'chat-context-fixed':80,'dr-historical':91,'dr-cleanup-v6':8,'authored-control':60}
    # Multiple mutations/technical views of the same source defect are one
    # cluster, including controls reused from the preceding proposal.
    origins={'filter_map':'model_cleanup','alias_unbound':'model_cleanup',
             'release':'verification_state','strict_checks':'verification_state',
             'confidence_direction':'pairwise_confidence','ratio_of_totals':'pairwise_confidence',
             'catch_scope':'verification_timeout','frozen_copy':'immutable_refinement',
             'transaction_queue':'metrics_flush','empty_envelope':'audit_error_envelope'}
    for c in inputs:
        if c['dataset']=='authored-control':
            c['controlTemplate']=c['group'];name=c['group'].removeprefix('control_')
            c['group']='control_origin_'+origins.get(name,name)
    # Split by historical group, never by language, author, repetition or mutation.
    groups_by_domain={}
    for domain in ['CHAT','DR','controls']:
        subset=[c for c in inputs if c['dataset']!='dr-cleanup-v6' and ('controls' if c['dataset']=='authored-control' else 'CHAT' if c['role']=='CHAT' else 'DR')==domain]
        gs=sorted({c['group'] for c in subset},key=lambda g:sha(SEED+domain+g));n=max(1,(len(gs)+2)//3)
        groups_by_domain[domain]={'screen':gs[n:],'confirm':gs[:n]}
        for c in subset:c['sourceStage']='confirm' if c['group'] in gs[:n] else 'screen'
    for c in inputs:
        if c['dataset']=='dr-cleanup-v6':c['sourceStage']='diagnostic'
    # Two cases per role where order exists, and four multi-criterion controls.
    # Reversing one criterion is identical input and cannot measure order bias.
    for role in ['CHAT','D1','D2','R1','R2']:
        candidates=sorted((c for c in inputs if c['role']==role and c['dataset']!='authored-control' and len(c['rubric'])>1),key=lambda c:sha(SEED+'order'+c['id']))
        for c in candidates[:2]:c['reverse']=True
    for c in sorted((c for c in inputs if c['dataset']=='authored-control' and len(c['rubric'])>1),key=lambda c:sha(SEED+'order'+c['id']))[:4]:c['reverse']=True
    inputs.sort(key=lambda c:sha(SEED+'input-order'+c['id']))
    models=old['models'];tags=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/tags'))['models']
    for m in models:
        t=next(t for t in tags if t['name']==m['name']);assert t['digest'].removeprefix('sha256:')==m['artifact']['digestSha256']
    matrix=[];calls=0
    for m in models:
        for c in inputs:
            r=refs[c['id']];reason='SELF_ARTIFACT' if m['artifact']['digestSha256']==r['answerDigest'] else 'RELATED_AUTHOR_FAMILY' if m['family']==r['answerFamily'] else None
            n=0 if reason else 1+int(c['reverse']);calls+=n
            matrix.append(dict(model=m['name'],caseId=c['id'],role=c['role'],dataset=c['dataset'],calls=n,status=reason or 'PLANNED'))
    out.mkdir(mode=0o700);(out/'restricted').mkdir(mode=0o700);(out/'receipts').mkdir(mode=0o700);(out/'source').mkdir()
    files=list(dict.fromkeys(list(old['sourceHashes'])+['scripts/manual/prepare-comprehensive-judges.py','scripts/manual/judge-controls-20260928.json','scripts/manual/audit-judge-sensitivity.py','scripts/manual/verify-comprehensive-judges.mjs','scripts/manual/report-comprehensive-judges.py']))
    hashes={f:sha((ROOT/f).read_bytes()) for f in files}
    for f in files:
        target=out/'source'/f;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((ROOT/f).read_bytes())
    for name,obj in [('inputs.json',inputs),('restricted/references.json',refs),('coverage-plan.json',matrix),('source-exclusions.json',excluded)]:
        (out/name).write_text(dump(obj));(out/name).chmod(0o600)
    plan=dict(old,status='FROZEN_COMPREHENSIVE_DEVELOPMENT_PANEL',preparedAt=datetime.now(timezone.utc).isoformat(),
        sourceRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),sourceHashes=hashes,sources=sources,seed=SEED,
        inputsSha256=sha((out/'inputs.json').read_bytes()),referencesSha256=sha((out/'restricted/references.json').read_bytes()),
        judgeProfile='evidence-first.2',familyPolicy='exclude-author-family-recorded',maxPowerWatts=max_power,
        budget={'maximumCalls':calls,'maximumHours':12,'maximumOutputTokens':calls*2048},
        sampling={'realAnswers':179,'authoredControls':60,'controlTemplates':24,
                  'controlGroups':len({c['group'] for c in inputs if c['dataset']=='authored-control'}),
                  'primaryOriginalRepeat':1,'groupPartitions':groups_by_domain,
                  'reverseCases':sum(c['reverse'] for c in inputs),'eligibleCalls':calls,'totalMatrixCells':len(matrix),
                  'excludedCells':sum(not r['calls'] for r in matrix),'allLanguagesInChat':True},
        selection={'primary':'Recall of criteria both references grade <= .50, at controlled false rejection of criteria both grade >= .75; invalid judgements retained in denominators.',
            'secondary':'Group MAE versus always-one/.75/.5 baselines; author residual; score distribution; order instability; all pairs with incremental detections and shared silent errors.',
            'comparison':'Rank only on common eligible cells within the same role and dataset. No overall rank across different author-family coverage.',
            'nomination':'Development shortlist only: >=95% valid, >=70% low recall, <=10% high false rejection, MAE below always-one on both partitions; minimum 5 low criteria in 3 groups per partition. No forced winner if unmet.',
            'pair':'Different families. Each member must add a real low-criterion detection on the matched set; show all pairs regardless of eligibility. Not acceptance.',
            'noTuning':'One frozen profile, references and sample. No adaptive retry of invalid semantic outputs; no reference grades in inference.'},
        limitations=['Known development material and exposed external references, not accepted human gold or a fresh holdout.',
            'Seven historical DR groups and repaired cleanup are separately versioned. Cross-role case reuse does not add independent observations.',
            'All real CHAT authors are Qwen-family: Qwen-family judges have no eligible real CHAT cells. Controls cannot qualify them for this author comparison.',
            'Authored variants share 24 templates clustered by source defect, not 60 independent observations. Their expectations have one exposed author, not two independent reviews.',
            'Source text can contain model names in code or prose. Identity keys and reference scores are withheld, but perfect nonrecognition is not guaranteed.',
            'CODE and VISION deterministic tasks are not replaced by a text judge; these five roles cannot establish universal qualification.',
            'Provider versions of source collections remain distinct; only judge-call profile is common. Original grades are never overwritten.'])
    (out/'plan.json').write_text(dump(plan));(out/'plan.sha256').write_text(sha((out/'plan.json').read_bytes())+'\n')
    print(dump({'out':str(out),'planSha256':sha((out/'plan.json').read_bytes()),'cases':len(inputs),'calls':calls,'byDataset':collections.Counter(c['dataset'] for c in inputs)}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--max-power',type=int,choices=[175,250],default=175);a=p.parse_args();prepare(a.out,a.max_power)
