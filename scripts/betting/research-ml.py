#!/usr/bin/env python3
"""Exploratory follow-up: Elo/form/shots vs market; reused holdout is labelled."""
import argparse,csv,datetime as dt,json,pathlib,heapq,math
import numpy as np
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
p=argparse.ArgumentParser();p.add_argument('data');p.add_argument('output');a=p.parse_args();root=pathlib.Path(a.output);root.mkdir()
plan={'status':'EXPLORATORY_REUSED_HOLDOUT_NOT_CONFIRMATORY','features':'prior Elo + exponentially smoothed goals, shots, shots on target (missing observations leave the previous average unchanged), league, prior appearances; targets never features','featureOrigin':'24h before kickoff; results released after 48h; no current match statistics','train':'2016-2021','selection':'2021-2023','calibration':'2023-2024','test':'2024-2026 (previously inspected in DC experiment)','models':['logistic C .1/1/10','histgradientboosting leaves 7/15, l2=10, minleaf=100, 150 iterations'],'market':'pre-closing Bet365; original observation time unavailable','seed':20260912}
(root/'plan.json').write_text(json.dumps(plan,indent=2))
leagues=['E0','D1','I1','SP1','F1'];rows=[]
for league in leagues:
 for y in range(16,26):
  with open(pathlib.Path(a.data)/f'mmz4281_{y}{y+1}_{league}.csv',encoding='utf-8-sig') as f:
   for r in csv.DictReader(f):
    if not r.get('FTR') in 'HDA' or not r.get('FTR'):continue
    try:date=dt.datetime.strptime(r['Date'],'%d/%m/%Y').replace(tzinfo=dt.timezone.utc).timestamp()
    except ValueError:date=dt.datetime.strptime(r['Date'],'%d/%m/%y').replace(tzinfo=dt.timezone.utc).timestamp()
    odds=np.array([float(r['B365'+s]) if r.get('B365'+s) else np.nan for s in 'HDA']);q=1/odds;q=q/q.sum()
    rows.append({'t':date,'league':league,'home':r['HomeTeam'],'away':r['AwayTeam'],'g':[float(r['FTHG']),float(r['FTAG'])],'shots':[float(r['HS']) if r.get('HS') else np.nan,float(r['AS']) if r.get('AS') else np.nan],'sot':[float(r['HST']) if r.get('HST') else np.nan,float(r['AST']) if r.get('AST') else np.nan],'y':'HDA'.index(r['FTR']),'q':q})
rows.sort(key=lambda r:(r['t'],r['league'],r['home'],r['away']))
state={};pending=[];X=[];y=[];dates=[];market=[]
def team(league,name):
 key=(league,name)
 if key not in state:state[key]={'elo':1500.,'count':0,'v':np.array([1.35,1.35,12.,12.,4.2,4.2]),'last':None}
 return state[key]
def update(r):
 h,aw=team(r['league'],r['home']),team(r['league'],r['away']);expect=1/(1+10**((aw['elo']-h['elo']-65)/400));score=[1,.5,0][r['y']];delta=20*(score-expect);h['elo']+=delta;aw['elo']-=delta
 for i,t in enumerate([h,aw]):
  obs=np.array([r['g'][i],r['g'][1-i],r['shots'][i],r['shots'][1-i],r['sot'][i],r['sot'][1-i]]);good=np.isfinite(obs);t['v'][good]=.9*t['v'][good]+.1*obs[good];t['count']+=1;t['last']=r['t']
for i,r in enumerate(rows):
 origin=r['t']-86400
 while pending and pending[0][0]<=origin:_,j=heapq.heappop(pending);update(rows[j])
 h,aw=team(r['league'],r['home']),team(r['league'],r['away']);feat=[(h['elo']-aw['elo'])/400,*h['v'],*aw['v'],* (h['v']-aw['v']),min(h['count'],100)/100,min(aw['count'],100)/100,*[float(r['league']==l) for l in leagues]]
 X.append(feat);y.append(r['y']);dates.append(r['t']);market.append(r['q']);heapq.heappush(pending,(r['t']+2*86400,i))
X=np.array(X);y=np.array(y);dates=np.array(dates);market=np.array(market)
bound=lambda s:dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()
train=dates<bound('2021-07-01');valid=(dates>=bound('2021-07-01'))&(dates<bound('2023-07-01'));cal=(dates>=bound('2023-07-01'))&(dates<bound('2024-07-01'));test=(dates>=bound('2024-07-01'))&(dates<bound('2026-07-01'))
def metrics(p,y):
 p=np.maximum(p,1e-15);return {'n':len(y),'logLoss':float(-np.log(p[np.arange(len(y)),y]).mean()),'brier':float(((p-np.eye(3)[y])**2).sum(axis=1).mean()),'accuracy':float((p.argmax(axis=1)==y).mean())}
models=[(f'logistic-C{c}',make_pipeline(SimpleImputer(add_indicator=True),StandardScaler(),LogisticRegression(C=c,max_iter=2000,random_state=20260912))) for c in [.1,1,10]]+[(f'hgb-leaves{n}',HistGradientBoostingClassifier(max_leaf_nodes=n,max_iter=150,min_samples_leaf=100,l2_regularization=10,learning_rate=.05,random_state=20260912,early_stopping=False)) for n in [7,15]]
scores=[]
for name,model in models:model.fit(X[train],y[train]);scores.append({'name':name,**metrics(model.predict_proba(X[valid]),y[valid])});print(scores[-1],flush=True)
best=min(scores,key=lambda x:x['logLoss'])['name'];model=dict(models)[best];model.fit(X[train|valid],y[train|valid]);cp=model.predict_proba(X[cal]);q=market[cal];ok=np.isfinite(q).all(axis=1);bestcal={'loss':float('inf')}
for w in np.linspace(0,1,21):
 for t in np.linspace(.7,1.3,13):
  p=np.exp((w*np.log(cp[ok])+(1-w)*np.log(q[ok]))/t);p/=p.sum(axis=1,keepdims=True);loss=metrics(p,y[cal][ok])['logLoss']
  if loss<bestcal['loss']:bestcal={'weight':float(w),'temperature':float(t),'loss':loss}
(root/'selection.json').write_text(json.dumps({'selection':scores,'selected':best,'calibration':bestcal},indent=2))
model.fit(X[train|valid|cal],y[train|valid|cal]);tp=model.predict_proba(X[test]);q=market[test];ok=np.isfinite(q).all(axis=1);tp=tp[ok];q=q[ok];yt=y[test][ok];p=np.exp((bestcal['weight']*np.log(tp)+(1-bestcal['weight'])*np.log(q))/bestcal['temperature']);p/=p.sum(axis=1,keepdims=True)
report={'plan':plan,'selection':scores,'selected':best,'calibration':bestcal,'test':{'model':metrics(tp,yt),'market':metrics(q,yt),'pool':metrics(p,yt)},'promotion':'NONE: exploratory comparison, no provider/timepoint-matched prospective validation'}
(root/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
