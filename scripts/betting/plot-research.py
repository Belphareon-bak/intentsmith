#!/usr/bin/env python3
import argparse,json,pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=argparse.ArgumentParser();p.add_argument('report');p.add_argument('output');a=p.parse_args();r=json.loads(pathlib.Path(a.report).read_text())
fig,(ax,bx)=plt.subplots(1,2,figsize=(11,4.4),layout='constrained')
colors={'model':'#be5542','power':'#4186b1','pool':'#8264a8'}
for i,(k,label) in enumerate([('model','Dixon–Coles'),('power','Market: power'),('pool','Frozen calibration')]):
 x=r['metrics'][k]['logLoss']-r['metrics']['market']['logLoss'];lo,hi=r['pairedBootstrap'][k]['ci95'];ax.errorbar(x,i,xerr=[[x-lo],[hi-x]],fmt='o',capsize=5,color=colors[k]);
ax.axvline(0,color='#333333',lw=1);ax.set_yticks(range(3),['Dixon–Coles','Market: power','Frozen calibration']);ax.set_xlabel('Log loss difference vs proportional market\n(negative is better; paired weekly bootstrap 95% CI)');ax.set_title('Locked test: 3,306 common matches')
for k,label in [('model','Dixon–Coles'),('market','Proportional market'),('pool','Frozen calibration')]:
 bins=[b for b in r['metrics'][k]['reliability'] if b['n']>=50];bx.plot([b['p'] for b in bins],[b['observed'] for b in bins],marker='.',label=label)
bx.plot([0,1],[0,1],'--',color='gray',lw=1);bx.set(xlim=(0,1),ylim=(0,1),xlabel='Mean forecast probability',ylabel='Observed outcome frequency',title='Classwise reliability (bins with n ≥ 50)');bx.legend(fontsize=8)
fig.suptitle('IntentSmith football forecast evaluation — 2024–2026',fontsize=13)
fig.savefig(a.output,dpi=160);fig.savefig(str(pathlib.Path(a.output).with_suffix('.svg')))
