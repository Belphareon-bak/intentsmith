// Adapter for a locally supplied v4 GET odds response. No credentials or network.
// Bookmaker region/settlement must be configured from verified operator metadata;
// the feed's key/title alone do not establish Czech offer availability.
import { validateSnapshot } from '../engine/contract.js';
import { digest } from '../engine/tickets.js';
import { fail, instant, text } from '../engine/values.js';
export function importOddsAPI(data,{observedAt,bookmakers}={}) {
  instant(observedAt,'observedAt');
  if(!Array.isArray(data)||data.length>1000) fail('INVALID_REQUEST','Očekávána omezená v4 odds nabídka.');
  if(!bookmakers||typeof bookmakers!=='object') fail('NEEDS_INPUT','Chybí ověřená konfigurace regionu a vypořádání kanceláří.');
  const events=data.map(e=>{
    if(typeof e.sport_key!=='string'||!e.sport_key.startsWith('soccer_')) fail('INVALID_REQUEST','Import podporuje pouze fotbal.');
    text(e.id,'id');text(e.home_team,'home_team');text(e.away_team,'away_team');instant(e.commence_time,'commence_time');
    if(!Array.isArray(e.bookmakers)||e.bookmakers.length>50) fail('INVALID_REQUEST','Neplatný seznam kanceláří.');
    const markets=[];
    for(const b of e.bookmakers) {
      const config=Object.hasOwn(bookmakers,b.key)?bookmakers[b.key]:null;
      if(!config) continue;
      if(!Array.isArray(b.markets)||b.markets.length>50) fail('INVALID_REQUEST','Neplatný seznam trhů.');
      for(const m of b.markets) {
        if(m.key!=='h2h') continue;
        if(!Array.isArray(m.outcomes)||m.outcomes.length!==3) fail('INVALID_REQUEST','Neúplný 1X2 trh.');
        markets.push({marketId:JSON.stringify(['odds-api',e.id,b.key,'h2h']),kind:'1x2',period:'regulation',
          bookmakerId:b.key,region:config.region,settlementRuleId:config.settlementRuleId,
          sourceUpdatedAt:m.last_update??b.last_update??null,observedAt,availability:'open',
          outcomes:m.outcomes.map(o=>({outcomeId:o.name===e.home_team?'home':o.name===e.away_team?'away':o.name==='Draw'?'draw':'unknown',decimalOdds:String(o.price)}))});
      }
    }
    const participant=name=>({id:`odds-api-team:${digest(name.normalize('NFKC').trim().toLowerCase())}`,name});
    return {eventId:`odds-api:${e.id}`,sport:'football',competitionId:e.sport_key,kickoffAt:e.commence_time,
      status:'scheduled',home:participant(e.home_team),away:participant(e.away_team),dependencyGroups:[],markets};
  });
  return validateSnapshot({contract:'BettingSnapshot',version:2,snapshotId:`odds-api-import:${digest(data)}`,
    generatedAt:observedAt,dataMode:'imported',source:{id:'the-odds-api:manual-import',version:'v4'},
    coverage:{complete:false,scope:'Pouze dodané události/konfigurované kanceláře; aktuálnost, dostupnost a aliasy týmů nejsou potvrzeny.'},events});
}
