#!/usr/bin/env python3
"""Independent numerical solver check against exported JS production artifacts."""
import argparse,json,math,pathlib
import numpy as np
from scipy.optimize import minimize
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args();data=json.loads(pathlib.Path(a.input).read_text());results=[]
for case in data:
 m=case['model'];n=len(m['teams']);ids={t:i for i,t in enumerate(m['teams'])};records=case['records'];rows=np.array([[ids[r['home']],ids[r['away']],r['homeGoals'],r['awayGoals'],r['weight']] for r in records]);h,aw=rows[:,0].astype(int),rows[:,1].astype(int);x,y,w=rows[:,2],rows[:,3],rows[:,4];w/=w.sum();ridge=m['spec']['ridge']
 def objective(t):
  l=np.exp(t[0]+t[1]+t[2+h]+t[2+n+aw]);mu=np.exp(t[0]+t[2+aw]+t[2+n+h]);rho=t[-1];tau=np.ones(len(x));tau[(x==0)&(y==0)]=1-l[(x==0)&(y==0)]*mu[(x==0)&(y==0)]*rho;tau[(x==0)&(y==1)]=1+l[(x==0)&(y==1)]*rho;tau[(x==1)&(y==0)]=1+mu[(x==1)&(y==0)]*rho;tau[(x==1)&(y==1)]=1-rho
  if np.any(tau<=0):return 1e10
  return np.sum(w*(l-x*np.log(l)+mu-y*np.log(mu)-np.log(tau)))+ridge*np.sum(t[2:2+2*n]**2)/2
 start=np.zeros(len(m['theta']));start[0]=math.log(np.sum(w*y));start[1]=math.log(np.sum(w*x))-start[0]
 fit=minimize(objective,start,method='L-BFGS-B',jac='3-point',options={'ftol':1e-13,'gtol':1e-7,'maxiter':1000,'maxfun':100000})
 delta=objective(np.array(m['theta']))-fit.fun
 result={'league':case['league'],'asOf':m['asOf'],'rows':len(records),'scipySuccess':bool(fit.success),'scipyMessage':str(fit.message),'objectiveDifference':float(delta),'maxParameterDifference':float(np.max(np.abs(fit.x-np.array(m['theta']))))};results.append(result)
 if not fit.success or abs(delta)>1e-7:raise RuntimeError(result)
pathlib.Path(a.output).write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
