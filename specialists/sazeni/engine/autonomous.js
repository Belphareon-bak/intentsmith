import { LIVE_BOOKS, oddsIOSnapshot, historyTeam } from '../providers/odds-io.js';
import {buildTickets,digest} from './tickets.js';
import {validateRequest} from './contract.js';
import {keys,fail} from './values.js';
import {LEAGUES,historyRecords,fixturesSnapshot} from '../providers/football-data.js';
import {fitFootball,predictFootball,marketProbabilities} from '../models/football.js';
import {FORECAST_POLICY} from '../models/policy.js';
export function autonomousRequest(preferences={},now) {
  keys(preferences,[],['horizonHours','maxSpreadHours','minOdds','maxOdds','minProbability','leagues','bookmakerIds','minLegs','maxLegs','ticketCount','objective','minLegProbability','stake'],'preferences');
  const p={horizonHours:24,minOdds:'1.5',maxOdds:'3',minProbability:0.4,leagues:[...LEAGUES],bookmakerIds:['bet365-reference'],minLegs:1,maxLegs:3,ticketCount:3,objective:'highest_probability',...preferences};
  const live=Array.isArray(p.bookmakerIds)&&p.bookmakerIds.length>0&&p.bookmakerIds.every(b=>LIVE_BOOKS.includes(b));
  const r={contract:'BettingRequest',version:3,requestId:'auto:'+digest({p,now}),sport:'football',competitionIds:p.leagues,
    window:{timezone:'Europe/Prague',horizonHours:p.horizonHours,...(p.maxSpreadHours!==undefined?{maxSpreadHours:p.maxSpreadHours}:{})},
    bookmakerIds:p.bookmakerIds,ticketType:p.maxLegs===1?'single':'accumulator',legOdds:{min:'1.01',max:p.maxOdds},ticketOdds:{min:p.minOdds,max:p.maxOdds},legs:{min:p.minLegs,max:p.maxLegs},
    probabilityFilter:{basis:'model',metric:'estimate',min:p.minProbability},objective:p.objective,ticketCount:p.ticketCount,diversity:{maxSharedEvents:0},exclude:{eventIds:[],participantIds:[],competitionIds:[]},dataMode:live?'live':'delayed',
    ...(p.stake!==undefined?{stake:p.stake}:{}),...(p.minLegProbability!==undefined?{minLegProbability:p.minLegProbability}:{})};
  validateRequest(r,now);
  if(!p.leagues.every(l=>LEAGUES.includes(l)))fail('NEEDS_INPUT','Zdroj historie zatím pokrývá E0, D1, I1, SP1 a F1.','preferences.leagues');
  if(!live&&!p.bookmakerIds.every(b=>['bet365-reference','betfred-reference','bwin-reference','paddypower-reference'].includes(b)))fail('PROVIDER_ERROR','Pro české kanceláře je nutné připojení ověřeného API; veřejný zdroj poskytuje pouze referenční kurzy.','preferences.bookmakerIds');
  return r;
}
export async function runAutonomous(preferences,turn={}) {
  let request,result;const started=turn.clock?.()??0;
  const sources=[],models=[],diagnostics=[];
  try {
    request=autonomousRequest(preferences,turn.now);
    if(!turn.bettingData?.get||!turn.bettingData?.save)fail('PROVIDER_ERROR','Host neposkytl autonomní zdroj dat. Použij CLI --auto nebo zapoj datový host specialisty.');
    if(turn.signal?.aborted)fail('CANCELLED','Výpočet zrušen.');
    if(request.dataMode==='live'&&turn.bettingData.liveConfigured!==true)fail('PROVIDER_ERROR','ODDS_IO_KEY_REQUIRED: host potřebuje API klíč Odds-API.io pro české kanceláře.');
    let snapshot;
    const windowEnd=Date.parse(turn.now)+request.window.horizonHours*3600000;
    let leagues=request.competitionIds;
    if(request.dataMode==='delayed') {
      const fixture=await turn.bettingData.get({kind:'fixtures'});sources.push(fixture.sourceRef);
      const fileTime=Date.parse(fixture.sourceRef.lastModified);
      if(!Number.isFinite(fileTime)||Date.parse(turn.now)-fileTime>4*86400000||fileTime>Date.parse(turn.now)+5000)fail('INSUFFICIENT_DATA','Veřejný seznam zápasů je starší než čtyři dny nebo nemá použitelný čas aktualizace.');
      snapshot=fixturesSnapshot(fixture.content,{now:turn.now,sourceRef:fixture.sourceRef,leagues:request.competitionIds,bookmakerIds:request.bookmakerIds});
      leagues=[...new Set(snapshot.events.filter(e=>Date.parse(e.kickoffAt)>=Date.parse(turn.now)+300000&&Date.parse(e.kickoffAt)<=windowEnd).map(e=>e.competitionId))];
    }
    const d=new Date(turn.now),season=(d.getUTCMonth()<6?d.getUTCFullYear()-1:d.getUTCFullYear())-2000;
    for(const league of leagues){
      const records=[];
      for(let y=season-4;y<=season;y++){const response=await turn.bettingData.get({kind:'history',league,season:y});sources.push(response.sourceRef);records.push(...historyRecords(response.content,{league}));}
      const model=await fitFootball(records,{asOf:turn.now,spec:FORECAST_POLICY.structuralSpec,signal:turn.signal,yieldTask:turn.yieldTask});models.push({...model,league});
    }
    if(request.dataMode==='live') {
      const bundle=await turn.bettingData.get({kind:'live',leagues:request.competitionIds,bookmakers:request.bookmakerIds,from:turn.now,to:new Date(windowEnd).toISOString()});
      sources.push(...bundle.sourceRefs);snapshot=oddsIOSnapshot(bundle,{now:turn.now,leagues:request.competitionIds,bookmakerIds:request.bookmakerIds});
    }
    for(const model of models) {
      const league=model.league;
      for(const event of snapshot.events.filter(e=>e.competitionId===league)){
        const home=request.dataMode==='live'?historyTeam(event.home.name,model.teams):event.home.name;
        const away=request.dataMode==='live'?historyTeam(event.away.name,model.teams):event.away.name;
        const prediction=home&&away?predictFootball(model,home,away):null;
        if(!prediction){diagnostics.push({eventId:event.eventId,reason:'MODEL_TEAM_HISTORY_INSUFFICIENT'});continue;}
        for(const market of event.markets){
          const p=marketProbabilities(market.outcomes.map(o=>Number(o.decimalOdds)));
          market.prediction={basis:'model',probabilities:Object.fromEntries(['home','draw','away'].map((k,i)=>[k,p[i]])),method:FORECAST_POLICY.selectedMethod,predictedAt:turn.now,modelRef:FORECAST_POLICY.id};
          diagnostics.push({eventId:event.eventId,marketId:market.marketId,structural:prediction,selected:p,policy:FORECAST_POLICY.id});
        }
      }
    }
    const evaluationAt=new Date(Date.parse(turn.now)+((turn.clock?.()??started)-started)).toISOString();
    result=await buildTickets(request,snapshot,{...turn,evaluationAt,trustedModelDigest:digest(snapshot),...(request.dataMode==='live'?{trustedLiveDigest:digest(snapshot)}:{})});
    result.analysis={autonomous:true,policy:FORECAST_POLICY,sourceRefs:sources,models:models.map(({theta,teams,counts,...rest})=>rest),diagnostics,
      limitations:['Pravděpodobnost výběru je automaticky odvozený tržní odhad. Strukturální model nepřekonal referenci a je diagnostický.',request.dataMode==='live'?'API feed potvrzuje zdroj a stáří dat; přijetí sázky konkrétním účtem ani kalibrace na české kanceláři nebyly ověřeny.':'Veřejný feed nemá čas pořízení jednotlivého kurzu ani záruku dostupnosti v ČR.','Historický CSV benchmark používá konzervativní publikační zpoždění; nemá původní snímky dat dostupných v daný okamžik.']};
    const evidence={contract:'BettingAnalysisEvidence',version:1,request,snapshot,models,policy:FORECAST_POLICY,result};
    try{result.persistence={status:'SAVED',recordId:await turn.bettingData.save(evidence)};}catch{result.status=turn.signal?.aborted?'CANCELLED':'PERSISTENCE_ERROR';result.tickets=[];result.errors.push({code:'PERSISTENCE_ERROR',fieldPath:null,message:'Výsledek nebyl spolehlivě uložen.',retryable:false,sourceRef:null});}
    return result;
  } catch(error){
    result=await buildTickets(request,null,turn);result.status=turn.signal?.aborted?'CANCELLED':['INVALID_REQUEST','NEEDS_INPUT','INSUFFICIENT_DATA','PROVIDER_ERROR','CANCELLED'].includes(error.code)?error.code:error.message?.startsWith('MODEL_')?'MODEL_UNAVAILABLE':'PROVIDER_ERROR';
    result.tickets=[];result.errors=[{code:result.status,fieldPath:error.fieldPath??null,message:error.message,retryable:result.status==='PROVIDER_ERROR',sourceRef:null}];result.analysis={autonomous:true,sourceRefs:sources,diagnostics};return result;
  }
}
