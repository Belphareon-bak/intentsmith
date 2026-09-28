#!/usr/bin/env python3
"""Bounded CHAT pilot. Recompute its gate from verified raw receipts, never a PASS flag."""
import argparse,collections,copy,hashlib,importlib.util,json,pathlib,subprocess,datetime
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('audit',ROOT/'scripts/manual/audit-judge-sensitivity.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
POLICY={'minimumRecall':.5,'minimumValidFraction':.9,'maximumHighFalseRejection':.1,'minimumLowCriteria':10,'minimumLowGroups':4}
AUTHOR_GAP={'authors':['qwen3.8:latest','qwen3.5:27b'],'maximumAbsoluteDistortion':.02,'minimumGroups':15,
 'population':'Both references within 25 percentage points for BOTH authors, paired by task and criterion; equal group weights.',
 'scope':'CHAT full development panel, not the biased low-criterion pilot; both reference residuals must pass.'}
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def fail(condition,reason):
 if not condition:raise ValueError(reason)
def prepare(parent,out,downloads=None):
 fail(not out.exists(),'OUTPUT_EXISTS')
 plan=read(parent/'plan.json');raw=read(parent/'inputs.json');refs=read(parent/'restricted/references.json')
 fail(sha(parent/'inputs.json')==plan['inputsSha256'] and sha(parent/'restricted/references.json')==plan['referencesSha256'],'PARENT_INPUT_CHANGED')
 fail(not list((parent/'receipts').glob('*.json')),'PARENT_ALREADY_STARTED')
 eligible=[c for c in raw if c['dataset']=='chat-context-fixed' and c['sourceStage']=='screen']
 lows=collections.Counter()
 for c in eligible:lows[c['group']]+=sum(max(a,b)<=.5 for a,b in zip(refs[c['id']]['first'],refs[c['id']]['second']))
 groups=sorted(lows,key=lambda g:(-lows[g],hashlib.sha256(('pilot-v1:'+g).encode()).hexdigest()))[:4]
 cases=[dict(c,stage='screen',reverse=False) for c in eligible if c['group'] in groups]
 fail(len(cases)==16 and all(sum(c['group']==g for c in cases)==4 for g in groups),'PILOT_PAIR_COVERAGE')
 models=[m for m in plan['models'] if m['family'] in ['gemma','mistral','phi']]
 fail(len(models)==3,'INITIAL_THREE_MODELS_REQUIRED')
 if downloads:
  models=[]
  for file in sorted(downloads.glob('*-receipt.json')):
   r=read(file);installed=r['installed'];show=r['show']
   fail(r['status']=='DOWNLOADED_NOT_QUALIFIED' and r['inference'] is False,'DOWNLOAD_NOT_VERIFIED')
   fail(installed['name']==r['name'],'DOWNLOAD_IDENTITY')
   context=max((v for k,v in show.get('model_info',{}).items() if k.endswith('.context_length')),default=0)
   fail(context>=plan['options']['num_ctx'],'NATIVE_CONTEXT_TOO_SMALL')
   fail(r['family'] in ['llama','granite'],'NEW_FAMILY_REQUIRED')
   models.append({'name':r['name'],'family':r['family'],'artifact':{'modelName':r['name'],'digestSha256':installed['digest'].removeprefix('sha256:'),'providerVersion':plan['models'][0]['artifact']['providerVersion']},
    'details':installed['details'],'size':installed['size'],'downloadReceipt':{'path':str(file.resolve()),'sha256':sha(file)},'commonCohort':True})
  fail(len(models)==2,'TWO_NEW_DOWNLOADS_REQUIRED')
 out.mkdir(parents=True);(out/'restricted').mkdir(mode=0o700);(out/'receipts').mkdir()
 save(out/'inputs.json',cases);save(out/'restricted/references.json',{c['id']:refs[c['id']] for c in cases});(out/'restricted/references.json').chmod(0o600)
 sources=set(plan['sourceHashes'])|{'scripts/manual/pilot-judge-gate.py'}
 updated=copy.deepcopy(plan);updated.update(preparedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
  sourceRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
  sourceHashes={f:sha(ROOT/f) for f in sorted(sources)},models=models,inputsSha256=sha(out/'inputs.json'),referencesSha256=sha(out/'restricted/references.json'),
  judgeProfile='evidence-first.3',experimentKind='CHAT_LOW_CRITERION_PILOT_V1',
  parent={'path':str(parent.resolve()),'planSha256':sha(parent/'plan.json')},
  pilotPolicy=POLICY,selection={**plan['selection'],'authorGap':AUTHOR_GAP},
  sampling={'groups':groups,'cases':len(cases),'lowCriteriaPerJudge':sum(lows[g] for g in groups),'eligibleCalls':len(cases)*len(models),
   'method':'Four screening groups with most jointly low criteria; deterministic SHA tie-break. Both authors and both languages retained. No confirmation groups.'},
  budget={'maximumCalls':len(cases)*len(models),'maximumHours':1,'maximumOutputTokens':len(cases)*len(models)*2048})
 updated['limitations']+=['Pilot intentionally enriches known errors. Passing only permits a larger development sample; it does not select a judge.',
  'Prompt tuning is restricted to pilot material. Every revision has a new immutable plan; confirmation stays untouched.']
 save(out/'plan.json',updated);(out/'plan.sha256').write_text(sha(out/'plan.json')+'\n')
 return {'status':'PREPARED_NOT_RUN','directory':str(out),'planSha256':sha(out/'plan.json'),'sampling':updated['sampling'],'policy':POLICY}
def metrics_gate(rows,complete,policy):
 x=audit.summarize(rows);reasons=[]
 if not complete:reasons.append('PILOT_INCOMPLETE')
 if x['lowTotal']<policy['minimumLowCriteria'] or x['lowGroups']<policy['minimumLowGroups']:reasons.append('INSUFFICIENT_LOW_COVERAGE')
 if not x['criteria'] or x['validCriteria']/x['criteria']<policy['minimumValidFraction']:reasons.append('INVALID_JUDGEMENTS')
 if x['lowRecall'] is None or x['lowRecall']<policy['minimumRecall']:reasons.append('LOW_RECALL_BELOW_HALF')
 if x['highFalseRejectionRate'] is None or x['highFalseRejectionRate']>policy['maximumHighFalseRejection']:reasons.append('REJECTS_CORRECT_ANSWERS')
 return {'passed':not reasons,'reasons':reasons,'metrics':x}
def evaluate(directory):
 plan=read(directory/'plan.json');fail(plan.get('experimentKind')=='CHAT_LOW_CRITERION_PILOT_V1','NOT_A_PILOT')
 fail(plan['pilotPolicy']==POLICY,'PILOT_POLICY_CHANGED')
 verified=json.loads(subprocess.check_output(['node',str(ROOT/'scripts/manual/verify-comprehensive-judges.mjs'),str(directory)],text=True))
 rows,ignored=audit.read_rows(directory);fail(not ignored,'ORPHAN_RECEIPT')
 results={m['name']:metrics_gate([r for r in rows if r['model']==m['name']],verified['status']=='CAPTURE_COMPLETE',plan['pilotPolicy']) for m in plan['models']}
 passed=[m for m,r in results.items() if r['passed']]
 return {'planSha256':sha(directory/'plan.json'),'decisionAuthority':False,'simulation':False,'verification':verified,
  'status':'CONTINUE_DEVELOPMENT' if passed else ('STOP_CHAT' if verified['status']=='CAPTURE_COMPLETE' else 'PENDING'),
  'eligibleModels':passed,'models':results,'allPairs':audit.pair_summaries(rows)}
def check_expansion(directory):
 plan=read(directory/'plan.json');gate=plan.get('chatPilotGate');fail(isinstance(gate,dict),'CHAT_PILOT_REQUIRED')
 pilot=pathlib.Path(gate['path']);fail(sha(pilot/'plan.json')==gate['planSha256'],'CHAT_PILOT_PLAN_CHANGED')
 p=read(pilot/'plan.json');result=evaluate(pilot)
 fail(result['status']=='CONTINUE_DEVELOPMENT','CHAT_PILOT_NOT_PASSED')
 fail(p['judgeProfile']==plan['judgeProfile'] and p['options']==plan['options'] and p['familyPolicy']==plan['familyPolicy'],'CHAT_PILOT_PROFILE_MISMATCH')
 fail(plan.get('selection',{}).get('authorGap')==AUTHOR_GAP,'AUTHOR_GAP_POLICY_REQUIRED')
 inputs={c['id']:c for c in read(directory/'inputs.json')};refs=read(directory/'restricted/references.json');pr=read(pilot/'restricted/references.json')
 for c in read(pilot/'inputs.json'):
  fail(c['id'] in inputs,'CHAT_PILOT_INPUT_MISSING')
  for key in ['question','response','context','rubric','group','task']:fail(inputs[c['id']].get(key)==c.get(key),'CHAT_PILOT_INPUT_MISMATCH')
  fail(refs[c['id']]==pr[c['id']],'CHAT_PILOT_REFERENCE_MISMATCH')
 for m in plan['models']:
  if m['family']=='qwen':continue # excluded real CHAT by family rule, controls remain eligible
  old=next((x for x in p['models'] if x['name']==m['name']),None)
  fail(old is not None and m['artifact']==old['artifact'] and m['family']==old['family'],'CHAT_PILOT_MODEL_MISMATCH')
  fail(m['name'] in result['eligibleModels'],'CHAT_PILOT_MODEL_FAILED:'+m['name'])
 return {'status':'CHAT_PILOT_GATE_PASSED','models':result['eligibleModels'],'decisionAuthority':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--prepare',type=pathlib.Path);p.add_argument('--out',type=pathlib.Path);p.add_argument('--downloads',type=pathlib.Path);p.add_argument('--report',type=pathlib.Path);p.add_argument('--check-expansion',type=pathlib.Path);a=p.parse_args()
 if a.prepare:result=prepare(a.prepare,a.out,a.downloads)
 elif a.check_expansion:result=check_expansion(a.check_expansion)
 else:result=evaluate(a.report)
 print(json.dumps(result,ensure_ascii=False,indent=2))
