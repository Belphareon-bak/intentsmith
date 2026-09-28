import {digest} from '../engine/tickets.js';
import {instant} from '../engine/values.js';
const TOURS={E0:['00-03m','anglie-4/1-anglie'],D1:['00-0c6','nemecko-6/1-nemecko-1'],I1:['00-06t','italie-1/1-italie-5'],SP1:['00-0h7','spanelsko-1/1-spanelsko-1'],F1:['00-0bo','francie-1/1-francie-1']};
export const FORTUNA_PUBLIC_BOOK='iFortuna CZ';
export const fortunaPages=leagues=>leagues.map(league=>({league,url:'https://www.ifortuna.cz/sazeni/fotbal/'+TOURS[league][1]+'?tab=matches'}));
const fail=message=>{throw Object.assign(new Error(message),{code:'PROVIDER_ERROR'});};
export function fortunaPublicSnapshot(bundle,{now,leagues}) {
  const raw=JSON.parse(bundle.content),events=[],seen=new Set(),marketsSeen=new Set();
  if(!Array.isArray(raw.selected)||raw.selected.length>100||!Array.isArray(raw.batches)||raw.batches.length>10)fail('FORTUNA_PUBLIC_BUNDLE_INVALID');
  const batches=new Map();
  for(const batch of raw.batches){instant(batch.sourceRef?.retrievedAt);for(const id of batch.ids){if(batches.has(id))fail('FORTUNA_PUBLIC_DUPLICATE_BATCH');batches.set(id,batch);}}
  for(const {league,event:e} of raw.selected){
    if(!leagues.includes(league)||!TOURS[league]||e.tournamentId!=='ufo:tour:'+TOURS[league][0]||e.sportId!=='ufo:sprt:00'||seen.has(e.id)||e.kind!=='PREMATCH'||e.status!=='ACTIVE'||e.hasMarkets!==true)fail('FORTUNA_PUBLIC_EVENT_INVALID');seen.add(e.id);
    const home=e.participants?.filter(p=>p.type==='HOME'),away=e.participants?.filter(p=>p.type==='AWAY');
    if(home?.length!==1||away?.length!==1||home[0].id===away[0].id)fail('FORTUNA_PUBLIC_PARTICIPANT_INVALID');
    const batch=batches.get(e.id);if(!batch)fail('FORTUNA_PUBLIC_BATCH_MISSING');
    const offers=batch.data[e.id]??[],matches=offers.filter(m=>m.marketTypeId==='ufo:mtyp:00-00'),markets=[];
    if(matches.length>1)fail('FORTUNA_PUBLIC_MARKET_AMBIGUOUS');
    for(const m of matches){
      if(m.fixtureId!==e.id||typeof m.id!=='string'||marketsSeen.has(m.id)||m.kind!=='PREMATCH'||m.variant!=='STANDARD'||m.specifiers!==null||m.syntheticGroupKey!=='match'
        ||m.name!=='Výsledek zápasu'||m.marketTypeDesc!=='Sázka na výsledek zápasu v základní hrací době.'||!Array.isArray(m.tournamentStageIds)||m.tournamentStageIds.length||!Array.isArray(m.outcomes)||m.outcomes.length!==3)fail('FORTUNA_PUBLIC_MARKET_CHANGED');marketsSeen.add(m.id);
      const outcomes=[],ids=new Set();
      for(const [outcomeId,type,name,longName] of [['home','3q','1',home[0].name],['draw','3r','0','Remíza'],['away','3s','2',away[0].name]]){
        const hit=m.outcomes.filter(o=>o.optionTypeId==='ufo:otyp:00-'+type);
        if(hit.length!==1||hit[0].marketId!==m.id||hit[0].name!==name||hit[0].longName!==longName||hit[0].specifiers!==null||typeof hit[0].id!=='string'||ids.has(hit[0].id))fail('FORTUNA_PUBLIC_OUTCOME_IDENTITY_CHANGED');
        const o=hit[0];ids.add(o.id);
        if(typeof o.odds!=='number'||!Number.isFinite(o.odds)||o.odds<=1||o.odds>10000)fail('FORTUNA_PUBLIC_PRICE_INVALID');
        outcomes.push({outcomeId,decimalOdds:String(o.odds)});
      }
      const open=m.features?.includes('OFFER')&&(!m.status||m.status==='ACTIVE'||m.status==='OPEN')&&m.outcomes.every(o=>o.displayType==='OPEN'&&o.features?.includes('OFFER'));
      markets.push({marketId:m.id,kind:'1x2',period:'regulation',bookmakerId:FORTUNA_PUBLIC_BOOK,region:'CZ',settlementRuleId:'fortuna-football-1x2-regulation-v1',sourceUpdatedAt:null,observedAt:batch.sourceRef.retrievedAt,availability:open?'open':'suspended',outcomes});
    }
    events.push({eventId:e.id,competitionId:league,sport:'football',kickoffAt:new Date(e.startDatetime).toISOString(),status:'scheduled',home:{id:home[0].id,name:home[0].name},away:{id:away[0].id,name:away[0].name},dependencyGroups:[],markets});
  }
  return {contract:'BettingSnapshot',version:2,snapshotId:'fortuna-public:'+digest(bundle),generatedAt:now,dataMode:'observed',source:{id:'fortuna-public-web',version:'2026-09-12-1x2-v1'},coverage:{complete:false,scope:'Veřejná nabídka Fortuny; úplné otevřené 1X2 pro zvolené ligy a okno. Čas poslední změny ceny ani přijetí sázky účtem nejsou známé.'},events};
}
