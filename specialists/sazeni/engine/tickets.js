import { createHash } from 'node:crypto';
import { validateRequest, validateSnapshot } from './contract.js';
import { instant, decimal, multiply, compare, number, decimalString, payout, fail, integer } from './values.js';

function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const ONE={n:1n,d:1n};
const tolerance=1e-12;

// All authority-bearing inputs are host options, never fields in a user request.
// A pure import remains useful without any network, model or provider identity.
export async function buildTickets(request, snapshot, {
  now, evaluationAt=now, signal=null, maxNodes=200000, yieldTask=async()=>{},
  clock=()=>0, deadlineMs=10000, trustedLiveDigest=null, trustedModelDigest=null, includeAlternatives=true,
}={}) {
  const generatedAt=evaluationAt??null;
  const result={contract:'BettingResult',version:3,requestId:typeof request?.requestId==='string'?request.requestId:null,
    runId:null,generatedAt,effectivePreferences:null,status:'INVALID_REQUEST',
    dataMode:['imported','historical','delayed','live'].includes(request?.dataMode)?request.dataMode:null,verifiedLive:false,
    coverage:null,search:{completed:false,nodes:0,limitReason:null,optimality:'unproven'},
    warnings:[],errors:[],tickets:[],alternatives:[],evidenceRefs:[],rejections:[]};
  try {
    const time=instant(evaluationAt,'evaluationAt');
    if(time<instant(now,'now')||time-instant(now)>120000) fail('INVALID_REQUEST','Čas výpočtu je mimo povolené okno hostu.');
    integer(maxNodes,1,200000,'maxNodes'); integer(deadlineMs,1,10000,'deadlineMs');
    const r=validateRequest(request,now);
    result.effectivePreferences=r;
    if(!snapshot) fail('NEEDS_INPUT','Přilož JSON nabídku BettingSnapshot nebo připoj datový zdroj.','snapshot');
    validateSnapshot(snapshot);
    if(snapshot.dataMode!==r.dataMode) fail('INVALID_REQUEST','Režim snapshotu neodpovídá zadání.','dataMode');
    const snapshotDigest=digest(snapshot);
    result.runId=`bet:${digest({request:r,snapshotDigest,generatedAt,engine:'3.0.0',maxNodes,deadlineMs})}`;
    result.evidenceRefs=[{snapshotId:snapshot.snapshotId,digest:snapshotDigest,source:snapshot.source}];
    result.coverage={...snapshot.coverage,events:snapshot.events.length,eligibleSelections:0};
    if(r.dataMode==='live' && trustedLiveDigest!==snapshotDigest) fail('PROVIDER_ERROR','Aktuální feed není ověřen hostem; import nelze vydat za živé kurzy.','dataMode');
    result.verifiedLive=r.dataMode==='live';
    if(instant(snapshot.generatedAt)>time+5000) fail('INVALID_REQUEST','Snapshot pochází z budoucnosti.','snapshot.generatedAt');
    if(r.probabilityFilter.basis==='model' && trustedModelDigest!==snapshotDigest) fail('MODEL_UNAVAILABLE','Pravděpodobnosti musí vypočítat autonomní engine z dat hostu; ruční predikce nejsou přijímány.','probabilityFilter.basis');
    if(r.probabilityFilter.metric==='lower_bound') fail('MODEL_UNAVAILABLE','Validovaná dolní mez celého tiketu není dostupná; bodový odhad ji nenahrazuje.','probabilityFilter.metric');
    result.warnings.push(r.probabilityFilter.basis==='market'
      ? 'Pravděpodobnost je normalizovaný tržní odhad z celého 1X2 trhu, nikoli vlastní kalibrovaná predikce.'
      : 'Pravděpodobnosti vypočítala uvedená politika autonomního enginu. Zkontroluj její zdroj a výsledky měření.');
    result.warnings.push('Součin pravděpodobností předpokládá nezávislost. Odlišné zápasy ji nezaručují.');
    if(r.dataMode!=='live') result.warnings.push('Referenční, importované a historické kurzy nejsou potvrzenou aktuální nabídkou kanceláře.');
    const candidates=[];
    let missingData=false;
    const minLeg=decimal(r.legOdds.min),maxLeg=decimal(r.legOdds.max);
    const from=instant(r.window.from),to=instant(r.window.to);
    function reject(eventId,marketId,code) { result.rejections.push({eventId,marketId,code}); }
    for(const e of snapshot.events) {
      const kickoff=instant(e.kickoffAt);
      let reason=null;
      if(e.sport!==r.sport||!r.competitionIds.includes(e.competitionId)) reason='OUTSIDE_COMPETITION_SCOPE';
      else if(e.status!=='scheduled') reason='EVENT_NOT_SCHEDULED';
      else if(kickoff<from||kickoff>to) reason='OUTSIDE_TIME_WINDOW';
      else if(kickoff<time+300000 && r.dataMode!=='historical') reason='STARTS_TOO_SOON';
      else if(r.exclude.eventIds.includes(e.eventId)||r.exclude.competitionIds.includes(e.competitionId)
        ||[e.home.id,e.away.id].some(id=>r.exclude.participantIds.includes(id))) reason='USER_EXCLUDED';
      if(reason) {reject(e.eventId,null,reason);continue;}
      for(const m of e.markets) {
        if(!r.bookmakerIds.includes(m.bookmakerId)) {reject(e.eventId,m.marketId,'BOOKMAKER_EXCLUDED');continue;}
        if(m.kind!=='1x2'||m.period!=='regulation') {reject(e.eventId,m.marketId,'MARKET_UNSUPPORTED');continue;}
        if(m.availability!=='open') {reject(e.eventId,m.marketId,'MARKET_NOT_OPEN');continue;}
        const observed=instant(m.observedAt), updated=m.sourceUpdatedAt===null?null:instant(m.sourceUpdatedAt);
        if(observed>time+5000||(updated!==null&&updated>time+5000)) {reject(e.eventId,m.marketId,'FUTURE_QUOTE');missingData=true;continue;}
        if(r.dataMode==='live'&&(updated===null||time-updated>120000||time-observed>120000)) {reject(e.eventId,m.marketId,'STALE_QUOTE');missingData=true;continue;}
        let ps, method;
        if(r.probabilityFilter.basis==='market') {
          const inverse=m.outcomes.map(o=>1/number(decimal(o.decimalOdds)));
          const sum=inverse.reduce((a,b)=>a+b,0);
          ps=Object.fromEntries(m.outcomes.map((o,i)=>[o.outcomeId,inverse[i]/sum]));method='market-normalized-v1';
        } else {
          if(m.prediction?.basis!=='model'||instant(m.prediction.predictedAt)>time+5000) {reject(e.eventId,m.marketId,'PROBABILITY_MISSING');missingData=true;continue;}
          ps=m.prediction.probabilities;method=m.prediction.method;
        }
        for(const o of m.outcomes) {
          const odds=decimal(o.decimalOdds);
          if(compare(odds,minLeg)<0||compare(odds,maxLeg)>0||ps[o.outcomeId]+tolerance<(r.minLegProbability??0)) continue;
          candidates.push({event:e,market:m,outcome:o,odds,p:ps[o.outcomeId],method,kickoff,
            quoteTime:updated??observed,expiresAt:r.dataMode==='live'?Math.min(updated+120000,observed+120000,kickoff-300000):null,
            id:JSON.stringify([m.marketId,o.outcomeId])});
        }
      }
    }
    result.coverage.eligibleSelections=candidates.length;
    if(candidates.length>200) fail('NEEDS_INPUT','Více než 200 kandidátů; zúž ligy, období nebo kurzy.','competitionIds');
    candidates.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const ticketMin=decimal(r.ticketOdds.min),ticketMax=decimal(r.ticketOdds.max);
    const feasible=[];
    const startClock=clock();
    const minP=r.probabilityFilter.min;
    const stack=[{indices:[],next:0,odds:ONE,p:1,minTime:Infinity,maxTime:-Infinity,minQuote:Infinity,maxQuote:-Infinity}];
    while(stack.length) {
      if(signal?.aborted) {result.status='CANCELLED';result.search.limitReason='CANCELLED';return result;}
      if(result.search.nodes>=maxNodes||clock()-startClock>=deadlineMs) {
        result.search.limitReason=result.search.nodes>=maxNodes?'NODE_BUDGET':'DEADLINE';break;
      }
      const state=stack.pop();result.search.nodes++;
      if(result.search.nodes%128===0) await yieldTask();
      const count=state.indices.length;
      // Odds only increase, probability only decreases as a leg is added.
      if(compare(state.odds,ticketMax)>0||state.p+tolerance<minP) continue;
      const roi=state.p*number(state.odds)-1;
      if(count>=r.legs.min&&compare(state.odds,ticketMin)>=0&&(r.minExpectedRoi===undefined||roi+tolerance>=r.minExpectedRoi)) {
        feasible.push({...state,roi,key:state.indices.map(i=>candidates[i].id).join('|')});
      }
      if(count>=r.legs.max) continue;
      for(let i=candidates.length-1;i>=state.next;i--) {
        const c=candidates[i],selected=state.indices.map(j=>candidates[j]);
        if(selected.some(s=>s.market.bookmakerId!==c.market.bookmakerId||s.market.region!==c.market.region
          ||s.market.settlementRuleId!==c.market.settlementRuleId||s.event.eventId===c.event.eventId
          ||[s.event.home.id,s.event.away.id].some(id=>[c.event.home.id,c.event.away.id].includes(id))
          ||s.event.dependencyGroups.some(g=>c.event.dependencyGroups.includes(g)))) continue;
        const minTime=Math.min(state.minTime,c.kickoff),maxTime=Math.max(state.maxTime,c.kickoff);
        const minQuote=Math.min(state.minQuote,c.quoteTime),maxQuote=Math.max(state.maxQuote,c.quoteTime);
        if(maxTime-minTime>r.window.maxSpreadHours*3600000) continue;
        if(r.dataMode==='live'&&maxQuote-minQuote>120000) continue;
        stack.push({indices:[...state.indices,i],next:i+1,odds:multiply(state.odds,c.odds),p:state.p*c.p,minTime,maxTime,minQuote,maxQuote});
      }
    }
    result.search.completed=stack.length===0;
    result.search.optimality=result.search.completed?'within_snapshot':'unproven';
    const target=r.targetOdds?decimal(r.targetOdds):null;
    const distance=o=>({n:(o.n*target.d-target.n*o.d)<0n?-(o.n*target.d-target.n*o.d):(o.n*target.d-target.n*o.d),d:o.d*target.d});
    feasible.sort((a,b)=>{
      const objective=r.objective==='highest_expected_value'?b.roi-a.roi:r.objective==='closest_target_odds'?compare(distance(a.odds),distance(b.odds)):b.p-a.p;
      return objective||b.p-a.p||a.indices.length-b.indices.length||(a.key<b.key?-1:a.key>b.key?1:0);
    });
    const maxTickets=r.stake?Math.min(r.ticketCount,Math.floor(r.stake.totalBudgetMinor/r.stake.perTicketMinor)):r.ticketCount;
    for(const f of feasible) {
      if(result.tickets.length>=maxTickets) break;
      const selected=f.indices.map(i=>candidates[i]);
      const ids=selected.map(c=>c.event.eventId);
      if(result.tickets.some(t=>t.selections.filter(s=>ids.includes(s.eventId)).length>r.diversity.maxSharedEvents)) continue;
      const totalOdds=decimalString(f.odds);
      const stake=r.stake?.perTicketMinor??null;
      const returned=stake===null?null:payout(stake,f.odds);
      const ticket={ticketId:`ticket:${digest({runId:result.runId,key:f.key})}`,lifecycle:'DRAFT',
        bookmakerId:selected[0].market.bookmakerId,region:selected[0].market.region,
        selections:selected.map(c=>({eventId:c.event.eventId,marketId:c.market.marketId,outcomeId:c.outcome.outcomeId,
          home:c.event.home.name,away:c.event.away.name,competitionId:c.event.competitionId,kickoffAt:c.event.kickoffAt,
          decimalOdds:c.outcome.decimalOdds,probability:c.p,probabilityMethod:c.method,
          quoteRef:c.id,sourceUpdatedAt:c.market.sourceUpdatedAt,observedAt:c.market.observedAt})),
        totalOdds,winProbability:{basis:r.probabilityFilter.basis,estimate:f.p,jointMethod:'independence-assumption-v1',modelInterval:null,
          dependenceBounds:{lower:Math.max(0,selected.reduce((sum,c)=>sum+c.p,0)-(selected.length-1)),upper:Math.min(...selected.map(c=>c.p))}},
        window:{firstKickoffAt:new Date(f.minTime).toISOString(),lastKickoffAt:new Date(f.maxTime).toISOString(),spreadHours:(f.maxTime-f.minTime)/3600000},
        expiresAt:r.dataMode==='live'?new Date(Math.min(...selected.map(c=>c.expiresAt))).toISOString():null,
        money:stake===null?null:{currency:'CZK',stakeMinor:stake,returnMinor:returned,profitMinor:returned-stake,maxLossMinor:stake,
          expectedProfitMinor:Math.round(stake*f.roi),payoutRule:'estimate-half-up-minor-unit'},
        expectedRoi:f.roi,constraints:[
          {field:'ticketOdds',actual:totalOdds,required:r.ticketOdds,pass:true},
          {field:'probabilityFilter.min',actual:f.p,required:minP,pass:true},
          {field:'window',actual:[new Date(f.minTime).toISOString(),new Date(f.maxTime).toISOString()],required:r.window,pass:true},
          {field:'window.maxSpreadHours',actual:(f.maxTime-f.minTime)/3600000,required:r.window.maxSpreadHours,pass:true},
          {field:'legs',actual:selected.length,required:r.legs,pass:true},
        ]};
      result.tickets.push(ticket);
    }
    if(signal?.aborted) {result.tickets=[];result.status='CANCELLED';return result;}
    if(r.dataMode==='live') {
      const elapsed=clock()-startClock;
      result.tickets=result.tickets.filter(t=>instant(t.expiresAt)>time+elapsed);
      if(feasible.length&&!result.tickets.length) fail('INSUFFICIENT_DATA','Kurzy vypršely během výpočtu.');
    }
    if(!result.search.completed) result.status='SEARCH_LIMIT_REACHED';
    else if(result.tickets.length) result.status='READY';
    else result.status=missingData||!snapshot.coverage.complete?'INSUFFICIENT_DATA':'NO_SOLUTION';
    if(result.tickets.length<r.ticketCount&&result.tickets.length) result.warnings.push(`Nalezeno ${result.tickets.length} z požadovaných ${r.ticketCount} odlišných tiketů v daném rozpočtu.`);
    if(!snapshot.coverage.complete) result.warnings.push('Feed má neúplné pokrytí. Výsledek platí pouze pro přiložený snapshot.');
    if(result.status==='NO_SOLUTION'&&includeAlternatives) {
      // Recompute explicit proposals under the remaining shared node/time budget.
      // No proposal changes the user's accepted preferences or appears as a ticket.
      const proposals=[
        {field:'probabilityFilter.min',value:r.probabilityFilter.min/2,patch:{probabilityFilter:{...request.probabilityFilter,min:r.probabilityFilter.min/2}}},
        {field:'ticketOdds.min',value:'1.000001',patch:{ticketOdds:{...request.ticketOdds,min:'1.000001'}}},
      ];
      let remaining=maxNodes-result.search.nodes;
      for(const proposal of proposals) {
        const remainingMs=Math.floor(deadlineMs-(clock()-startClock));
        if(remaining<1||remainingMs<1||signal?.aborted) break;
        const trial=await buildTickets({...request,...proposal.patch},snapshot,{now,evaluationAt,signal,maxNodes:remaining,
          yieldTask,clock,deadlineMs:remainingMs,trustedLiveDigest,trustedModelDigest,includeAlternatives:false});
        remaining-=trial.search.nodes;
        result.alternatives.push({field:proposal.field,value:proposal.value,requestPatch:proposal.patch,
          status:trial.status,found:trial.tickets.length,search:trial.search,example:trial.tickets[0]??null});
      }
    }
    if(signal?.aborted) {result.status='CANCELLED';result.tickets=[];result.alternatives=[];}
    return result;
  } catch(error) {
    result.status=['NEEDS_INPUT','INVALID_REQUEST','MODEL_UNAVAILABLE','PROVIDER_ERROR','INSUFFICIENT_DATA'].includes(error.code)?error.code:'INTERNAL_ERROR';
    result.tickets=[];
    result.errors=[{code:error.code??'INTERNAL_ERROR',fieldPath:error.fieldPath??null,message:error.message,retryable:false,sourceRef:null}];
    return result;
  }
}
