#!/usr/bin/env python3
"""Offline sensitivity and author-residual audit. No acceptance or reference rewrites."""
import argparse, collections, hashlib, itertools, json, pathlib, statistics

def avg(xs):
    xs=list(xs)
    return statistics.mean(xs) if xs else None

def cents(x): return round(x*100)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def group_mean(rows, fn):
    groups=collections.defaultdict(list)
    for r in rows: groups[r['group']].append(fn(r))
    return avg(avg(v) for v in groups.values())

def read_rows(root):
    cases={x['id']:x for x in json.loads((root/'inputs.json').read_text())}
    refs=json.loads((root/'restricted/references.json').read_text())
    plan=json.loads((root/'plan.json').read_text()); psha=sha(root/'plan.json')
    receipts={}; ignored=[]
    for f in sorted((root/'receipts').glob('*.json')):
        if f.name.endswith('.post.json'): continue
        r=json.loads(f.read_text()); assert r['planSha256']==psha
        if r['reverse']: continue
        post=f.with_name(f.stem+'.post.json')
        if not post.exists(): ignored.append(f.name);continue
        q=json.loads(post.read_text());assert q['planSha256']==psha and q['key']==f.stem
        key=(r['judge']['modelName'],r['caseId']);assert key not in receipts
        receipts[key]=r
    rows=[]
    comprehensive=plan.get('status')=='FROZEN_COMPREHENSIVE_DEVELOPMENT_PANEL'
    for m in plan['models']:
        if not comprehensive and not any(n==m['name'] for n,c in receipts):continue
        for cid,c in cases.items():
            if c['role']!='CHAT' and not comprehensive:continue
            if not comprehensive and not any(n==m['name'] and r['stage']==c['stage'] for (n,k),r in receipts.items()):continue
            ref=refs[cid]
            if m['artifact']['digestSha256']==ref['answerDigest']:continue
            if plan.get('familyPolicy')=='exclude-author-family-recorded':
                assert m.get('family') and ref.get('answerFamily'), 'UNKNOWN_FAMILY'
                if m['family']==ref['answerFamily']:continue
            receipt=receipts.get((m['name'],cid))
            for i,(a,b) in enumerate(zip(ref['first'],ref['second'])):
                if a is None or b is None:continue
                scored=receipt and receipt['parsed']['valid']
                row=receipt['parsed']['rows'][i] if scored else None
                rows.append(dict(model=m['name'],caseId=cid,criterion=i+1,sourceCriterion=c.get('sourceCriterion',i+1),sourceAnswerId=c.get('sourceAnswerId',cid),group=c['group'],task=c['task'],role=c['role'],language=c.get('language'),
                    sourceStage=c.get('sourceStage',c['stage']),dataset=c.get('dataset','captured'),
                    author=ref['answerModel'],authorFamily=ref.get('answerFamily'),referenceKind=ref.get('referenceKind','TWO_EXTERNAL_DRAFTS'),first=a,second=b,score=row['score'] if row else None,
                    evidence=row['evidence'] if row else None,receiptValid=bool(scored),
                    problem=receipt['parsed'].get('reason') if receipt and not scored else ('MISSING' if not receipt else None)))
    return rows,ignored

def summarize(rows):
    valid=[r for r in rows if r['score'] is not None]
    consensus=[r for r in valid if abs(cents(r['first'])-cents(r['second']))<=25]
    low=[r for r in rows if max(cents(r['first']),cents(r['second']))<=50]
    high=[r for r in rows if min(cents(r['first']),cents(r['second']))>=75]
    eligible_consensus=[r for r in rows if abs(cents(r['first'])-cents(r['second']))<=25]
    error=lambda r:(abs(r['score']-r['first'])+abs(r['score']-r['second']))/2
    def author_residual(parts):
        return {a:{'criteria':len(rs),'first':avg(r['score']-r['first'] for r in rs),
                  'second':avg(r['score']-r['second'] for r in rs)}
        for a,rs in ((a,[r for r in parts if r['author']==a]) for a in sorted({r['author'] for r in parts}))}
    residual=author_residual(valid); consensus_residual=author_residual(consensus)
    # Within-task/criterion pairs avoid confounding author with missing hard tasks.
    matched={}
    for a,b in itertools.combinations(sorted(residual),2):
        av={(r['task'],r.get('sourceCriterion',r['criterion'])):r for r in valid if r['author']==a}
        bv={(r['task'],r.get('sourceCriterion',r['criterion'])):r for r in valid if r['author']==b}
        keys=sorted(av.keys()&bv.keys())
        matched[a+' minus '+b]={'criteriaPairs':len(keys),
            'first':avg((av[k]['score']-av[k]['first'])-(bv[k]['score']-bv[k]['first']) for k in keys),
            'second':avg((av[k]['score']-av[k]['second'])-(bv[k]['score']-bv[k]['second']) for k in keys)}
    mid=[r for r in rows if 25<cents(r['first'])<75 and 25<cents(r['second'])<75]
    baseline=lambda v:group_mean(consensus,lambda r:(abs(v-r['first'])+abs(v-r['second']))/2)
    return dict(criteria=len(rows),cases=len({r['caseId'] for r in rows}),groups=len({r['group'] for r in rows}),validCriteria=len(valid),missingCriteria=len(rows)-len(valid),
        consensusCriteria=len(consensus),referenceDisputedCriteria=sum(abs(cents(r['first'])-cents(r['second']))>25 for r in rows),
        lowTotal=len(low),lowCaught=sum(r['score'] is not None and cents(r['score'])<=50 for r in low),
        lowGroups=len({r['group'] for r in low}),lowRecall=sum(r['score'] is not None and cents(r['score'])<=50 for r in low)/len(low) if low else None,
        lowInvalid=sum(r['score'] is None for r in low),lowOverconfident=sum(r['score'] is not None and cents(r['score'])>=90 for r in low),
        highTotal=len(high),highIncorrectlyRejected=sum(r['score'] is not None and cents(r['score'])<=50 for r in high),
        highFalseRejectionRate=sum(r['score'] is not None and cents(r['score'])<=50 for r in high)/len(high) if high else None,
        severeFalseAccepts=sum(r['score'] is not None and cents(r['score'])>=75 and max(cents(r['first']),cents(r['second']))<=25 for r in rows),
        intermediateReferenceCriteria=len(mid),intermediateScoredCriteria=sum(r['score'] is not None and 0<r['score']<1 for r in mid),
        scoreDistribution=dict(collections.Counter(str(cents(r['score'])) for r in valid)),
        groupMAE=group_mean(consensus,error),
        constantBaselinesMatched={'0.50':baseline(.5),'0.75':baseline(.75),'1.00':baseline(1)},
        alwaysOneGroupMAEMatched=group_mean(consensus,lambda r:((1-r['first'])+(1-r['second']))/2),
        alwaysOneGroupMAEFull=group_mean(eligible_consensus,lambda r:((1-r['first'])+(1-r['second']))/2),
        referenceHalfDistance=group_mean(consensus,lambda r:abs(r['first']-r['second'])/2),
        authorResidualAll=residual,authorResidualConsensus=consensus_residual,matchedAuthorResidualAll=matched)

def pair_summaries(rows):
    vectors={m:{(r['caseId'],r['criterion']):r for r in rows if r['model']==m} for m in sorted({r['model'] for r in rows})}
    pairs=[]
    for a,b in itertools.combinations(vectors,2):
        x,y=vectors[a],vectors[b];ks=sorted(x.keys()&y.keys())
        low=[k for k in ks if max(cents(x[k]['first']),cents(x[k]['second']))<=50]
        caught=lambda v,k:v[k]['score'] is not None and cents(v[k]['score'])<=50
        common=[k for k in ks if x[k]['score'] is not None and y[k]['score'] is not None and abs(cents(x[k]['first'])-cents(x[k]['second']))<=25]
        outside=lambda r:max(r['score']-max(r['first'],r['second']),min(r['first'],r['second'])-r['score'],0)
        pairs.append(dict(a=a,b=b,lowTotal=len(low),caughtA=sum(caught(x,k) for k in low),caughtB=sum(caught(y,k) for k in low),
            caughtEither=sum(caught(x,k) or caught(y,k) for k in low),
            onlyA=sum(caught(x,k) and not caught(y,k) for k in low),onlyB=sum(caught(y,k) and not caught(x,k) for k in low),
            invalidEither=sum(x[k]['score'] is None or y[k]['score'] is None for k in low),
            commonPlannedCriteria=len(ks),commonCriteria=len(common),silentJointErrors=sum(outside(x[k])>.250000001 and outside(y[k])>.250000001 and abs(cents(x[k]['score'])-cents(y[k]['score']))<=25 for k in common)))
    return pairs

def author_gap_filter(rows, policy):
    """Paired author-gap distortion, equal case-group weights, two references.

    Exclude reference disputes before looking at judge scores. Missing scores
    block, rather than selecting an easier author-specific matched subset.
    """
    authors=policy['authors']; limit=policy['maximumAbsoluteDistortion']; minimum=policy['minimumGroups']
    vectors={a:{} for a in authors}
    for r in rows:
        if r['author'] not in vectors: continue
        k=(r['group'],r['task'],r.get('sourceCriterion',r['criterion']))
        if k in vectors[r['author']]: raise ValueError('DUPLICATE_AUTHOR_PAIR')
        vectors[r['author']][k]=r
    a,b=(vectors[x] for x in authors)
    keys=sorted(k for k in a.keys()&b.keys() if all(abs(cents(r['first'])-cents(r['second']))<=25 for r in [a[k],b[k]]))
    groups=collections.defaultdict(list)
    for k in keys: groups[k[0]].append(k)
    reference={ref:avg(avg(a[k][ref]-b[k][ref] for k in ks) for ks in groups.values()) for ref in ['first','second']}
    complete=bool(keys) and all(a[k]['score'] is not None and b[k]['score'] is not None for k in keys)
    observed=avg(avg(a[k]['score']-b[k]['score'] for k in ks) for ks in groups.values()) if complete else None
    residual={ref:observed-value if observed is not None else None for ref,value in reference.items()}
    failures=[]
    if len(groups)<minimum: failures.append('AUTHOR_GAP_TOO_FEW_GROUPS')
    if not complete: failures.append('AUTHOR_GAP_MISSING_PAIRED_GRADES')
    if all(v is not None for v in reference.values()) and abs(reference['first']-reference['second'])>2*limit+1e-10:
        failures.append('AUTHOR_GAP_REFERENCE_ARBITRATION_REQUIRED')
    if any(v is not None and abs(v)>limit+1e-10 for v in residual.values()): failures.append('AUTHOR_GAP_EXCEEDS_LIMIT')
    return dict(passed=not failures,reasons=failures,authors=authors,groups=len(groups),criteriaPairs=len(keys),
                referenceGaps=reference,judgeGap=observed,distortion=residual,maximumAbsoluteDistortion=limit,
                interpretation='Descriptive matched residual, not proof of causal family favoritism or statistical acceptance.')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
    if a.out.resolve()==a.source.resolve() or a.source.resolve() in a.out.resolve().parents:raise ValueError('WRITE_SEPARATE_AUDIT_DIRECTORY')
    a.out.mkdir(parents=True,exist_ok=True)
    rows,ignored=read_rows(a.source);panels={}
    for dataset in sorted({r['dataset'] for r in rows}):
        for stage in ['all']+sorted({r['sourceStage'] for r in rows if r['dataset']==dataset}):
            rs=[r for r in rows if r['dataset']==dataset and (stage=='all' or r['sourceStage']==stage)]
            panels[dataset+':'+stage]={'referenceKinds':sorted({r['referenceKind'] for r in rs}),'models':{m:summarize([r for r in rs if r['model']==m]) for m in sorted({r['model'] for r in rs})},'pairs':pair_summaries(rs)}
            for role in sorted({r['role'] for r in rs}):
                rr=[r for r in rs if r['role']==role]
                panels[dataset+':'+role+':'+stage]={'referenceKinds':sorted({r['referenceKind'] for r in rr}),
                    'models':{m:summarize([r for r in rr if r['model']==m]) for m in sorted({r['model'] for r in rr})},'pairs':pair_summaries(rr)}
    report=dict(status='DESCRIPTIVE_REANALYSIS_NOT_ACCEPTANCE',simulation=False,decisionAuthority=False,source=str(a.source),
        planSha256=sha(a.source/'plan.json'),analysisSourceSha256=sha(pathlib.Path(__file__)),unverifiedReceipts=ignored,panels=panels,
        limitations=['Two exposed external draft references; no merged gold score.',
          'Author residual differences are descriptive; neither causation nor statistically demonstrated family bias.',
          'Missing judgments never count as caught errors or zero content scores.',
          'Low-criterion rates condition on deliberately selected material, not production prevalence.'])
    (a.out/'sensitivity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (a.out/'rows.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    lines=[]
    for name,p in panels.items():
        lines+=['## '+name,'','| Model | Low caught / total | Low invalid | Low >= .9 | MAE p.p. | Always 1 matched p.p. |','|---|---:|---:|---:|---:|---:|']
        for m,r in p['models'].items():
            fmt=lambda x:'—' if x is None else f'{100*x:.2f}'
            lines.append(f"| {m} | {r['lowCaught']}/{r['lowTotal']} | {r['lowInvalid']} | {r['lowOverconfident']} | {fmt(r['groupMAE'])} | {fmt(r['alwaysOneGroupMAEMatched'])} |")
        lines+=['']
    (a.out/'sensitivity.md').write_text('\n'.join(lines)+'\n'); print('\n'.join(lines))
if __name__=='__main__':main()
