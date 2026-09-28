#!/usr/bin/env node
// Chronological model-selection/locked-holdout research, using production code.
import fs from 'node:fs/promises';
import path from 'node:path';
import {historyRecords,LEAGUES} from '../../specialists/sazeni/providers/football-data.js';
import {fitFootball,predictFootball,marketProbabilities,poolProbabilities,MODEL_SPEC} from '../../specialists/sazeni/models/football.js';
const [dataDir,outDir]=process.argv.slice(2);if(!dataDir||!outDir)throw new Error('Usage: benchmark.mjs data-dir new-output-dir');
await fs.mkdir(outDir,{recursive:false});
const configs=[{id:'poisson-ridge-v1',halfLifeDays:365,ridge:0.001},...[180,365,730].flatMap(halfLifeDays=>[0.001,0.005].map(ridge=>({id:'dc-ridge-v1',halfLifeDays,ridge})))];
const plan={createdAt:new Date().toISOString(),training:'rolling 1461 days; match +48h publication lag',validation:['2021-07-01','2023-07-01'],calibration:['2023-07-01','2024-07-01'],lockedTest:['2024-07-01','2026-07-01'],retrain:'monthly before first predicted match',selection:'pooled validation log loss on common coverage, then calibration-only logarithmic pooling and temperature',market:'Bet365 pre-closing only; historical quote availability NOT timestamped',configs};
await fs.writeFile(path.join(outDir,'plan.json'),JSON.stringify(plan,null,2));
const all={};
for(const league of LEAGUES){all[league]=[];for(let y=16;y<=25;y++){const text=await fs.readFile(path.join(dataDir,`mmz4281_${y}${y+1}_${league}.csv`),'utf8');all[league].push(...historyRecords(text,{league}));}}
const losses=(p,y)=>({logLoss:-Math.log(Math.max(1e-15,p[y])),brier:p.reduce((s,x,i)=>s+(x-(i===y?1:0))**2,0)});
const metrics=rows=>{const n=rows.length;if(!n)return {n:0};const bins=Array.from({length:10},()=>({n:0,p:0,y:0}));let ll=0,b=0,correct=0;for(const r of rows){const m=losses(r.p,r.y);ll+=m.logLoss;b+=m.brier;const k=r.p.indexOf(Math.max(...r.p));correct+=k===r.y;for(let i=0;i<3;i++){const bin=bins[Math.min(9,Math.floor(r.p[i]*10))];bin.n++;bin.p+=r.p[i];bin.y+=i===r.y;}}return {n,logLoss:ll/n,brier:b/n,accuracy:correct/n,classwiseECE:bins.reduce((s,x)=>s+Math.abs(x.p-x.y),0)/(n*3),reliability:bins.map(x=>({n:x.n,p:x.n?x.p/x.n:null,observed:x.n?x.y/x.n:null}))};};
async function predictPeriod(config,start,end,label){const out=[];for(const league of LEAGUES){const data=all[league];const targets=data.filter(r=>r.kickoffAt>=start&&r.kickoffAt<end);let currentMonth=null,model=null;for(const r of targets){const month=r.kickoffAt.slice(0,7);if(month!==currentMonth){model=await fitFootball(data,{asOf:month+'-01T00:00:00.000Z',spec:config});currentMonth=month;}
const pred=predictFootball(model,r.home,r.away);let market=null,power=null;try{market=marketProbabilities(r.odds);power=marketProbabilities(r.odds,'power');}catch{}const y=r.homeGoals>r.awayGoals?0:r.homeGoals===r.awayGoals?1:2;
out.push({id:r.id,league,date:r.kickoffAt,y,model:pred?.probabilities??null,market,power,modelId:model.modelId,trainedThrough:model.trainedThrough});}
console.log(label,league,targets.length,flush());}return out;}
function flush(){return '';}
const validation=[];
for(const [i,cfg] of configs.entries()) {const rows=await predictPeriod(cfg,'2021-07-01','2023-07-01','validation '+i);validation.push(rows);await fs.writeFile(path.join(outDir,`validation-${i}.json`),JSON.stringify(rows));}
const common=new Set(validation[0].filter(r=>r.model&&r.market).map(r=>r.id));for(const rows of validation)for(const r of rows)if(!r.model||!r.market)common.delete(r.id);
const scores=validation.map((rows,i)=>({index:i,config:configs[i],...metrics(rows.filter(r=>common.has(r.id)).map(r=>({...r,p:r.model})))}));scores.sort((a,b)=>a.logLoss-b.logLoss);const selected=scores[0];
await fs.writeFile(path.join(outDir,'selection.json'),JSON.stringify({scores,selected},null,2));console.log('SELECTED',JSON.stringify(selected));
const calibration=await predictPeriod(selected.config,'2023-07-01','2024-07-01','calibration');
const cal=calibration.filter(r=>r.model&&r.market);let best={loss:Infinity};
for(const marketMethod of ['market','power'])for(let w=0;w<=20;w++)for(let t=14;t<=26;t++){const options={modelWeight:w/20,temperature:t/20};const value=metrics(cal.map(r=>({...r,p:poolProbabilities(r.model,r[marketMethod],options)})));if(value.logLoss<best.loss)best={...options,marketMethod,loss:value.logLoss};}
// Write the frozen policy BEFORE touching holdout outcomes.
await fs.writeFile(path.join(outDir,'frozen-policy.json'),JSON.stringify({modelSpec:{...MODEL_SPEC,...selected.config},calibration:best,selectedWithoutTest:true},null,2));
const test=await predictPeriod(selected.config,'2024-07-01','2026-07-01','holdout');
await fs.writeFile(path.join(outDir,'holdout-predictions.json'),JSON.stringify(test));
const evaluated=test.filter(r=>r.model&&r.market&&r.power).map(r=>({...r,pool:poolProbabilities(r.model,r[best.marketMethod],best)}));
const report={plan,selected: selected.config,calibration:best,coverage:{total:test.length,model:test.filter(r=>r.model).length,market:test.filter(r=>r.market).length,common:evaluated.length},metrics:{},byLeague:{}};
for(const method of ['model','market','power','pool']){report.metrics[method]=metrics(evaluated.map(r=>({...r,p:r[method]})));report.byLeague[method]=Object.fromEntries(LEAGUES.map(league=>[league,metrics(evaluated.filter(r=>r.league===league).map(r=>({...r,p:r[method]})))]));}
// Paired week-block bootstrap: descriptive uncertainty, no individual-event CI.
const weeks=new Map();for(const r of evaluated){const key=Math.floor(Date.parse(r.date)/(7*86400000));if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(r);}const blocks=[...weeks.values()];let seed=20260912;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
report.pairedBootstrap={};for(const method of ['model','power','pool']){const diffs=[];for(let i=0;i<2000;i++){let n=0,s=0;for(let j=0;j<blocks.length;j++)for(const r of blocks[Math.floor(rand()*blocks.length)]){s+=losses(r[method],r.y).logLoss-losses(r.market,r.y).logLoss;n++;}diffs.push(s/n);}diffs.sort((a,b)=>a-b);report.pairedBootstrap[method]={baseline:'market',metric:'logLoss difference',resampling:'calendar-week blocks',replicates:2000,ci95:[diffs[50],diffs[1949]]};}
await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({coverage:report.coverage,metrics:Object.fromEntries(Object.entries(report.metrics).map(([k,v])=>[k,{n:v.n,logLoss:v.logLoss,brier:v.brier}])),pairedBootstrap:report.pairedBootstrap},null,2));
