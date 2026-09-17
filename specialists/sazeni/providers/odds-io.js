import {digest} from '../engine/tickets.js';
import {instant} from '../engine/values.js';
const LEAGUE_CODES={'england-premier-league':'E0','germany-bundesliga':'D1','italy-serie-a':'I1','spain-la-liga':'SP1','france-ligue-1':'F1'};
export const LIVE_BOOKS=Object.freeze(['Tipsport.cz','Chance.cz','iFortuna CZ','Betano CZ']);
export function oddsIOSnapshot(bundle,{now,leagues,bookmakerIds}) {
  const data=JSON.parse(bundle.content),events=[],seen=new Set();
  if(!Array.isArray(data.events)||!Array.isArray(data.odds)||data.events.length>500)throw new Error('ODDS_IO_BUNDLE_INVALID');
  for(const e of data.events){
    if(!Number.isSafeInteger(e.id)||e.id<=0||seen.has(e.id)||e.sport?.slug!=='football'||!leagues.includes(LEAGUE_CODES[e.league?.slug]))throw new Error('ODDS_IO_EVENT_INVALID');seen.add(e.id);
    if(!Number.isSafeInteger(e.homeId)||!Number.isSafeInteger(e.awayId)||e.homeId<=0||e.awayId<=0||e.homeId===e.awayId||!e.home||!e.away)throw new Error('ODDS_IO_PARTICIPANT_INVALID');
    instant(new Date(instant(e.date)).toISOString());
    const o=data.odds.find(o=>o.id===e.id),markets=[];
    if(o){
      if(o.homeId!==e.homeId||o.awayId!==e.awayId||o.home!==e.home||o.away!==e.away||instant(o.date)!==instant(e.date)||o.league?.slug!==e.league.slug||o.sport?.slug!=='football'||o.status!=='pending')throw new Error('ODDS_IO_IDENTITY_CHANGED');
      for(const book of bookmakerIds){
        if(!LIVE_BOOKS.includes(book))throw new Error('ODDS_IO_BOOKMAKER_INVALID');
        const offers=o.bookmakers?.[book];if(!offers)continue;if(!Array.isArray(offers))throw new Error('ODDS_IO_MARKETS_INVALID');
        // Full-match Moneyline has exactly one 1/X/2 price row. No alternate
        // periods, handicaps or post-regulation two-way markets are accepted.
        const matches=offers.filter(m=>m.name==='Moneyline');if(matches.length>1)throw new Error('ODDS_IO_MARKET_AMBIGUOUS');
        const m=matches[0];if(!m)continue;
        if(!Array.isArray(m.odds)||m.odds.length!==1||Object.hasOwn(m.odds[0],'hdp'))throw new Error('ODDS_IO_MARKET_SHAPE_INVALID');
        const prices=['home','draw','away'].map(k=>m.odds[0][k]);
        if(prices.some(p=>!/^\d+(\.\d+)?$/.test(String(p))||Number(p)<=1||Number(p)>10000))throw new Error('ODDS_IO_PRICE_INVALID');
        markets.push({marketId:`oddsio:${e.id}:${book}:1x2`,kind:'1x2',period:'regulation',bookmakerId:book,region:'CZ',settlementRuleId:'oddsio-football-moneyline-1x2-v1',sourceUpdatedAt:new Date(instant(m.updatedAt)).toISOString(),observedAt:bundle.observedAt,availability:'open',outcomes:prices.map((p,i)=>({outcomeId:['home','draw','away'][i],decimalOdds:String(p)}))});
      }
    }
    events.push({eventId:`oddsio:${e.id}`,competitionId:LEAGUE_CODES[e.league.slug],sport:'football',kickoffAt:new Date(instant(e.date)).toISOString(),status:e.status==='pending'?'scheduled':e.status==='cancelled'?'cancelled':'live',home:{id:`oddsio:${e.homeId}`,name:e.home},away:{id:`oddsio:${e.awayId}`,name:e.away},dependencyGroups:[],markets});
  }
  return {contract:'BettingSnapshot',version:2,snapshotId:'oddsio:'+digest(bundle),generatedAt:now,dataMode:'live',source:{id:'odds-api.io',version:'v3-moneyline'},coverage:{complete:false,scope:'API snapshot českých kanceláří; konkrétní trhy musí mít úplné 1X2, shodnou identitu a stáří nejvýše dvě minuty. Dostupnost na účtu uživatele není ověřena.'},events};
}
// Exact normalized matching plus explicit versioned aliases; never fuzzy pairing.
const ALIASES={'nottingham':'nottm forest','nott m forest':'nottm forest','vfb stuttgart':'stuttgart','1 fc koln':'koln','bayern':'bayern munich','hamburger sv':'hamburg','frankfurt':'ein frankfurt','bremen':'werder bremen','inter milano':'inter','bilbao':'ath bilbao','atl madrid':'ath madrid','a coruna':'la coruna','celta vigo':'celta','espanyol':'espanol','real sociedad':'sociedad','psg':'paris sg','manchester united':'man united','manchester city':'man city','wolverhampton wanderers':'wolves','wolverhampton':'wolves','tottenham hotspur':'tottenham','newcastle united':'newcastle','west ham united':'west ham','nottingham forest':'nottm forest','brighton and hove albion':'brighton','athletic bilbao':'ath bilbao','athletic club':'ath bilbao','atletico madrid':'ath madrid','rayo vallecano':'vallecano','borussia monchengladbach':"m gladbach",'borussia dortmund':'dortmund','bayern munich':'bayern munich','bayern munchen':'bayern munich','paris saint germain':'paris sg','inter milan':'inter','ac milan':'milan','hellas verona':'verona'};
function normalized(name){return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/^(?:fc|afc|ac|sc|as|ss|rc) | (?:fc|afc)$/g,'').trim();}
export function historyTeam(name,teams){const normalizedName=normalized(name),key=ALIASES[normalizedName]??normalizedName;const hits=teams.filter(t=>(ALIASES[normalized(t)]??normalized(t))===key);return hits.length===1?hits[0]:null;}
