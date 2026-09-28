// Pure CPU model: exponentially weighted, ridge-regularized Dixon–Coles.
// Training records and time are injected by the host. No network or filesystem.
import { digest } from '../engine/tickets.js';
const DAY=86400000;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=a=>Math.max(...a.map(Math.abs));
const finite=a=>a.every(Number.isFinite);
export const MODEL_SPEC=Object.freeze({id:'dc-ridge-v1',halfLifeDays:365,ridge:0.001,lookbackDays:1461,minTeamMatches:10,maxIterations:500,tolerance:0.00001});

export function scoreProbabilities(lambda,mu,rho=0) {
  if (![lambda,mu,rho].every(Number.isFinite)||lambda<=0||mu<=0||lambda>20||mu>20) throw new Error('MODEL_RATE_OUT_OF_RANGE');
  const tau=[1-lambda*mu*rho,1+lambda*rho,1+mu*rho,1-rho];
  if(tau.some(x=>x<=0)) throw new Error('MODEL_INVALID_DEPENDENCE');
  function poisson(rate) {
    const p=[Math.exp(-rate)];let mass=p[0];
    for(let k=1;mass<1-1e-12&&k<100;k++){p.push(p[k-1]*rate/k);mass+=p[k];}
    if(mass<1-1e-10) throw new Error('MODEL_TAIL_LIMIT');
    return p;
  }
  const a=poisson(lambda),b=poisson(mu),p=[0,0,0];
  for(let x=0;x<a.length;x++) for(let y=0;y<b.length;y++) p[x>y?0:x===y?1:2]+=a[x]*b[y]*(x<2&&y<2?tau[x*2+y]:1);
  const sum=p.reduce((a,b)=>a+b,0);
  if(Math.abs(sum-1)>1e-9||p.some(x=>x<0)) throw new Error('MODEL_MASS_INVALID');
  return p.map(x=>x/sum);
}

// Exposed objective permits independent finite-difference and reference-solver checks.
export function dcObjective(theta,rows,n,ridge,dc=true) {
  const g=Array(theta.length).fill(0);let f=0;
  const rho=dc?theta[2+2*n]:0;
  if(!finite(theta)||Math.abs(rho)>=0.3) return {f:Infinity,g};
  for(const r of rows) {
    const eh=theta[0]+theta[1]+theta[2+r.h]+theta[2+n+r.a];
    const ea=theta[0]+theta[2+r.a]+theta[2+n+r.h];
    if(Math.max(eh,ea)>3||Math.min(eh,ea)<-6) return {f:Infinity,g};
    const l=Math.exp(eh),m=Math.exp(ea);
    let tau=1,dh=0,da=0,dr=0;
    if(r.x===0&&r.y===0) {tau=1-l*m*rho;dh=da=-l*m*rho;dr=-l*m;}
    else if(r.x===0&&r.y===1) {tau=1+l*rho;dh=l*rho;dr=l;}
    else if(r.x===1&&r.y===0) {tau=1+m*rho;da=m*rho;dr=m;}
    else if(r.x===1&&r.y===1) {tau=1-rho;dr=-1;}
    if(tau<=0) return {f:Infinity,g};
    f+=r.w*(l-r.x*eh+m-r.y*ea-Math.log(tau));
    const gh=r.w*(l-r.x-dh/tau),ga=r.w*(m-r.y-da/tau);
    g[0]+=gh+ga;g[1]+=gh;g[2+r.h]+=gh;g[2+n+r.a]+=gh;g[2+r.a]+=ga;g[2+n+r.h]+=ga;
    if(dc) g[2+2*n]-=r.w*dr/tau;
  }
  for(let i=2;i<2+2*n;i++){f+=ridge*theta[i]**2/2;g[i]+=ridge*theta[i];}
  return {f,g};
}

export async function fitFootball(records,{asOf,spec=MODEL_SPEC,signal,yieldTask=async()=>{}}={}) {
  const time=Date.parse(asOf);
  if(!Number.isFinite(time)) throw new Error('MODEL_TIME_REQUIRED');
  const cfg={...MODEL_SPEC,...spec};
  if(!Number.isFinite(cfg.halfLifeDays)||cfg.halfLifeDays<=0||!Number.isFinite(cfg.ridge)||cfg.ridge<=0||cfg.lookbackDays<30||cfg.maxIterations>1000||cfg.minTeamMatches<1) throw new Error('MODEL_SPEC_INVALID');
  // Conservative 48-hour publication lag for retrospective CSV; the actual
  // first-observed timestamp, when available, is an additional hard cutoff.
  const seen=new Set();
  const data=records.filter(r=>{
    const t=Date.parse(r.kickoffAt),available=Date.parse(r.availableAt??new Date(t+2*DAY).toISOString());
    if(!Number.isFinite(t)||!Number.isFinite(available)||!r.home||!r.away||r.home===r.away||![r.homeGoals,r.awayGoals].every(x=>Number.isInteger(x)&&x>=0&&x<=30)) throw new Error('MODEL_RECORD_INVALID');
    if(seen.has(r.id)) throw new Error('MODEL_DUPLICATE_RECORD');seen.add(r.id);
    return t<time-2*DAY&&available<=time&&t>=time-cfg.lookbackDays*DAY;
  }).sort((a,b)=>a.kickoffAt.localeCompare(b.kickoffAt)||a.id.localeCompare(b.id));
  if(data.length<200) throw new Error('MODEL_HISTORY_INSUFFICIENT');
  const teams=[...new Set(data.flatMap(r=>[r.home,r.away]))].sort(),n=teams.length;
  if(n>100||data.length>6000) throw new Error('MODEL_SIZE_LIMIT');
  const ids=new Map(teams.map((t,i)=>[t,i])),counts=Object.fromEntries(teams.map(t=>[t,0]));
  const rows=data.map(r=>({h:ids.get(r.home),a:ids.get(r.away),x:r.homeGoals,y:r.awayGoals,w:Math.exp(-Math.log(2)*(time-Date.parse(r.kickoffAt))/DAY/cfg.halfLifeDays)}));
  const weight=rows.reduce((s,r)=>s+r.w,0);rows.forEach(r=>{r.w/=weight;});
  for(const r of data) if(Date.parse(r.kickoffAt)>=time-730*DAY){counts[r.home]++;counts[r.away]++;}
  const dc=cfg.id!=='poisson-ridge-v1';
  let theta=Array(2+2*n+(dc?1:0)).fill(0);theta[0]=Math.log(rows.reduce((s,r)=>s+r.w*r.y,0));theta[1]=Math.log(rows.reduce((s,r)=>s+r.w*r.x,0))-theta[0];
  const objective=x=>dcObjective(x,rows,n,cfg.ridge,dc);
  let current=objective(theta),iteration=0;
  const history=[];
  while(norm(current.g)>cfg.tolerance&&iteration<cfg.maxIterations) {
    if(signal?.aborted) throw Object.assign(new Error('CANCELLED'),{code:'CANCELLED'});
    if(iteration%5===0) await yieldTask();
    let q=[...current.g];const alphas=[];
    for(let j=history.length-1;j>=0;j--){const h=history[j],a=h.inv*dot(h.s,q);alphas[j]=a;q=q.map((v,k)=>v-a*h.y[k]);}
    const last=history.at(-1),scale=last?dot(last.s,last.y)/dot(last.y,last.y):1;
    let d=q.map(x=>x*scale);
    for(let j=0;j<history.length;j++){const h=history[j],b=h.inv*dot(h.y,d);d=d.map((v,k)=>v+h.s[k]*(alphas[j]-b));}
    d=d.map(x=>-x);
    if(dot(d,current.g)>=0){history.length=0;d=current.g.map(x=>-x);}
    const slope=dot(current.g,d);let step=1,next,candidate;
    for(let attempt=0;attempt<40;attempt++){candidate=theta.map((v,k)=>v+step*d[k]);next=objective(candidate);if(Number.isFinite(next.f)&&next.f<=current.f+0.0001*step*slope)break;step/=2;next=null;}
    if(!next||!finite(next.g)) throw new Error('MODEL_OPTIMIZER_LINE_SEARCH_FAILED');
    const s=candidate.map((v,k)=>v-theta[k]),y=next.g.map((v,k)=>v-current.g[k]),sy=dot(s,y);
    if(sy>1e-12){history.push({s,y,inv:1/sy});if(history.length>10)history.shift();}
    theta=candidate;current=next;iteration++;
  }
  if(norm(current.g)>cfg.tolerance||!finite(theta)) throw new Error('MODEL_OPTIMIZER_NOT_CONVERGED');
  const model={contract:'FootballModel',version:1,method:cfg.id,spec:cfg,asOf,trainedThrough:data.at(-1).kickoffAt,
    trainingRows:data.length,trainingDigest:digest(data),effectiveRows:1/rows.reduce((s,r)=>s+r.w*r.w,0),
    teams,counts,theta,fit:{iterations:iteration,objective:current.f,gradientInfinityNorm:norm(current.g),converged:true}};
  return {...model,modelId:'football:'+digest(model)};
}
export function predictFootball(model,home,away) {
  if(model.contract!=='FootballModel'||model.version!==1||!model.fit?.converged) throw new Error('MODEL_ARTIFACT_INVALID');
  const h=model.teams.indexOf(home),a=model.teams.indexOf(away),n=model.teams.length;
  if(h<0||a<0||home===away||(model.counts[home]??0)<model.spec.minTeamMatches||(model.counts[away]??0)<model.spec.minTeamMatches) return null;
  const x=model.theta,lambda=Math.exp(x[0]+x[1]+x[2+h]+x[2+n+a]),mu=Math.exp(x[0]+x[2+a]+x[2+n+h]);
  const probabilities=scoreProbabilities(lambda,mu,model.method==='poisson-ridge-v1'?0:x[2+2*n]);
  return {probabilities,lambda,mu,modelId:model.modelId,trainingRows:model.trainingRows,trainedThrough:model.trainedThrough};
}

export function marketProbabilities(odds,method='proportional') {
  if(odds.length!==3||odds.some(o=>!Number.isFinite(o)||o<=1||o>10000)) throw new Error('MARKET_ODDS_INVALID');
  const q=odds.map(o=>1/o),sum=q.reduce((a,b)=>a+b,0);
  if(sum<0.98||sum>1.5) throw new Error('MARKET_MARGIN_OUT_OF_RANGE');
  if(method==='proportional') return q.map(x=>x/sum);
  if(method!=='power') throw new Error('MARKET_METHOD_INVALID');
  let lo=0.01,hi=10;
  for(let i=0;i<70;i++){const k=(lo+hi)/2;if(q.reduce((s,x)=>s+x**k,0)>1)lo=k;else hi=k;}
  return q.map(x=>x**((lo+hi)/2));
}
export function poolProbabilities(model,market,{modelWeight=1,temperature=1}={}) {
  if(!Number.isFinite(modelWeight)||modelWeight<0||modelWeight>1||!Number.isFinite(temperature)||temperature<0.5||temperature>2) throw new Error('CALIBRATION_INVALID');
  const p=model.map((x,i)=>Math.exp((modelWeight*Math.log(Math.max(x,1e-15))+(1-modelWeight)*Math.log(Math.max(market[i],1e-15)))/temperature));
  const sum=p.reduce((a,b)=>a+b,0);return p.map(x=>x/sum);
}
