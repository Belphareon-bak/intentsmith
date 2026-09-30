#!/usr/bin/env python3
"""Second development pilot: all low criteria plus a locked positive comparison."""
import argparse,copy,datetime,hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def prepare(parent,out):
 if out.exists():raise ValueError('OUTPUT_EXISTS')
 first=parent/'existing-three';second=parent/'new-families'
 base=read(first/'plan.json');other=read(second/'plan.json')
 if (first/'inputs.json').read_bytes()!=(second/'inputs.json').read_bytes():raise ValueError('PILOT_INPUT_DIFFERENCE')
 cases=read(first/'inputs.json');refs=read(first/'restricted/references.json')
 if sha(first/'inputs.json')!=base['inputsSha256'] or sha(first/'restricted/references.json')!=base['referencesSha256']:raise ValueError('INPUT_CHANGED')
 low=[];high=[]
 for c in cases:
  for i,(a,b) in enumerate(zip(refs[c['id']]['first'],refs[c['id']]['second'])):
   if max(a,b)<=.5:low.append((c,i))
   if min(a,b)>=.75:high.append((c,i))
 key=lambda v:hashlib.sha256(('focused-v4-positive:'+v[0]['id']+':'+str(v[1])).encode()).hexdigest()
 high.sort(key=key);chosen=[];represented={c['id'] for c,i in low}
 for c in cases:
  if c['id'] not in represented:
   match=next((v for v in high if v[0]['id']==c['id']),None)
   if match is None:raise ValueError('NO_POSITIVE_COVERAGE')
   chosen.append(match);represented.add(c['id'])
 for v in high:
  if len(chosen)>=max(11,len(low)):break
  if v not in chosen:chosen.append(v)
 selected=sorted(low+chosen,key=lambda v:(v[0]['id'],v[1]));inputs=[];newrefs={}
 for c,i in selected:
  cid=hashlib.sha256(('focused-v4:'+c['id']+':'+str(i+1)).encode()).hexdigest()[:24]
  clock=datetime.date.fromisoformat(c['context']['clockLocalDate'])
  calendar=[{'date':(clock+datetime.timedelta(days=n)).isoformat(),'weekday':(clock+datetime.timedelta(days=n)).strftime('%A')} for n in range(-7,8)]
  item=copy.deepcopy(c);item.update(id=cid,rubric=[c['rubric'][i]],reverse=False,sourceAnswerId=c['id'],sourceCriterion=i+1)
  item['context']={**c['context'],'calendarFacts':calendar,'otherCriterionBoundaries':[r for k,r in enumerate(c['rubric']) if k!=i]}
  ref=copy.deepcopy(refs[c['id']]);ref.update(sourceAnswerId=c['id'],sourceCriterion=i+1)
  for field in ['first','second','firstReasons','secondReasons']:ref[field]=[ref[field][i]]
  inputs.append(item);newrefs[cid]=ref
 # Restrict the next iteration to three candidates, retaining different families.
 models=[m for m in base['models']+other['models'] if m['family'] in ['gemma','llama','granite']]
 if len(models)!=3:raise ValueError('MODEL_COHORT_CHANGED')
 out.mkdir(parents=True);(out/'restricted').mkdir(mode=0o700);(out/'receipts').mkdir()
 save(out/'inputs.json',inputs);save(out/'restricted/references.json',newrefs);(out/'restricted/references.json').chmod(0o600)
 plan=copy.deepcopy(base);plan.update(preparedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
  sourceRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
  models=models,judgeProfile='evidence-focused.4',inputsSha256=sha(out/'inputs.json'),referencesSha256=sha(out/'restricted/references.json'),
  priorPilots=[{'path':str(p.resolve()),'planSha256':sha(p/'plan.json')} for p in [first,second]],
  sampling={'answerCount':len(represented),'criterionCases':len(inputs),'lowCriteria':len(low),'highCriteria':len(chosen),'groups':4,
   'eligibleCalls':len(inputs)*len(models),'selection':'All jointly low criteria; deterministic high criteria covering every source answer, then SHA order. Original references unchanged. No confirmation data.'},
  budget={'maximumCalls':len(inputs)*len(models),'maximumHours':1,'maximumOutputTokens':len(inputs)*len(models)*2048})
 source=set(base['sourceHashes'])|{'scripts/manual/prepare-focused-judges.py'};plan['sourceHashes']={f:sha(ROOT/f) for f in sorted(source)}
 plan['limitations']+=['Focused pilot jointly changes criterion granularity, scoring anchors and supplies a deterministic calendar. This is not an ablation attributing improvement to one change.',
  'Known four development groups, 22 selected criteria rather than complete 64-criterion grading. Successful candidates still require an untouched broader confirmation.']
 save(out/'plan.json',plan);(out/'plan.sha256').write_text(sha(out/'plan.json')+'\n')
 print(json.dumps({'planSha256':sha(out/'plan.json'),'sampling':plan['sampling'],'models':[m['name'] for m in models]},indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--parent',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();prepare(a.parent,a.out)
