// Pure, evidence-based watch signals. A changed price is not a validated edge.
import {validateSnapshot} from './contract.js';
import {digest} from './tickets.js';

export const WATCH_DEFAULTS=Object.freeze({horizonHours:72,leagues:['E0','D1','I1','SP1','F1'],minOdds:1.5,maxOdds:3,minProbability:0.4,minImprovement:0.05,intervalMinutes:15,maxAlertsPerDay:4});
export function validateWatchPreferences(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(WATCH_DEFAULTS,k)))throw new Error('WATCH_PREFERENCES_INVALID');
  const p={...WATCH_DEFAULTS,...input};
  if(!Number.isInteger(p.horizonHours)||p.horizonHours<1||p.horizonHours>168||!Array.isArray(p.leagues)||!p.leagues.length||new Set(p.leagues).size!==p.leagues.length||p.leagues.some(l=>!WATCH_DEFAULTS.leagues.includes(l))
    ||!Number.isFinite(p.minOdds)||!Number.isFinite(p.maxOdds)||p.minOdds<=1||p.maxOdds<p.minOdds||p.maxOdds>100||!Number.isFinite(p.minProbability)||p.minProbability<0||p.minProbability>1
    ||!Number.isFinite(p.minImprovement)||p.minImprovement<0.01||p.minImprovement>1||!Number.isInteger(p.intervalMinutes)||p.intervalMinutes<5||p.intervalMinutes>120
    ||!Number.isInteger(p.maxAlertsPerDay)||p.maxAlertsPerDay<1||p.maxAlertsPerDay>20)throw new Error('WATCH_PREFERENCES_INVALID');
  return p;
}
export function watchQuotes(snapshot,{now,from,to,preferences}) {
  validateSnapshot(snapshot);const time=Date.parse(now),p=validateWatchPreferences(preferences),quotes=[];
  if(snapshot.dataMode!=='observed'||snapshot.source.id!=='fortuna-public-web'||!Number.isFinite(time)||Date.parse(snapshot.generatedAt)>time+5000)throw new Error('WATCH_SNAPSHOT_INVALID');
  for(const e of snapshot.events){
    const kickoff=Date.parse(e.kickoffAt);
    if(!p.leagues.includes(e.competitionId)||e.status!=='scheduled'||kickoff<Math.max(Date.parse(from),time+300000)||kickoff>Date.parse(to))continue;
    for(const m of e.markets){
      const observed=Date.parse(m.observedAt);
      if(m.bookmakerId!=='iFortuna CZ'||m.kind!=='1x2'||m.period!=='regulation'||time-observed>120000||observed>time+5000)throw new Error('WATCH_QUOTE_INVALID_OR_STALE');
      const booksum=m.outcomes.reduce((sum,o)=>sum+1/Number(o.decimalOdds),0);
      if(booksum<1||booksum>1.3)continue;
      for(const o of m.outcomes){
        const identity={eventId:e.eventId,competitionId:e.competitionId,home:e.home,away:e.away,kickoffAt:e.kickoffAt,marketId:m.marketId,bookmakerId:m.bookmakerId,settlementRuleId:m.settlementRuleId,outcomeId:o.outcomeId};
        quotes.push({...identity,key:digest(identity),decimalOdds:Number(o.decimalOdds),marketProbability:(1/Number(o.decimalOdds))/booksum,overround:booksum-1,observedAt:m.observedAt,availability:m.availability,expiresAt:new Date(Math.min(observed+120000,kickoff-300000)).toISOString()});
      }
    }
  }
  return quotes;
}
export function findOpportunities(quotes,{now,preferences,previousScan=null,history={}}) {
  const p=validateWatchPreferences(preferences),time=Date.parse(now),signals=[];
  // After a gap, scope change or first start, establish a baseline; no mass alerts.
  const continuous=previousScan&&time-Date.parse(previousScan.at)>0&&time-Date.parse(previousScan.at)<=p.intervalMinutes*2.5*60000;
  for(const q of quotes){
    if(q.availability!=='open'||q.decimalOdds<p.minOdds||q.decimalOdds>p.maxOdds||q.marketProbability<p.minProbability||Date.parse(q.expiresAt)<=time)continue;
    const h=history[q.key],old=h?.last;let kind=null,improvement=null;
    const seenEvent=Object.values(history).some(row=>row.last.eventId===q.eventId&&row.last.outcomeId===q.outcomeId);
    if(continuous&&!h&&!seenEvent&&Date.parse(q.kickoffAt)<=Date.parse(previousScan.to)&&Date.parse(q.kickoffAt)>=Date.parse(previousScan.from)+300000)kind='NEWLY_OBSERVED';
    if(continuous&&old?.availability==='open'&&time-Date.parse(old.observedAt)<=p.intervalMinutes*2.5*60000){
      improvement=q.decimalOdds/old.decimalOdds-1;
      if(improvement+1e-12>=p.minImprovement)kind='PRICE_IMPROVED';
    }
    if(!kind)continue;
    // Do not repeatedly announce the same selection; a further meaningful gain
    // must beat the last announced price, even if the market oscillated meanwhile.
    if(h?.lastAlert&&(time-Date.parse(h.lastAlert.at)<6*3600000||q.decimalOdds/h.lastAlert.price-1<p.minImprovement))continue;
    const firstSeenAt=h?.firstSeenAt??q.observedAt;
    signals.push({contract:'BettingWatchSignal',version:1,id:digest({key:q.key,kind,observedAt:q.observedAt}),kind,quote:q,firstSeenAt,openingAt:null,
      observedAgeHours:(time-Date.parse(firstSeenAt))/3600000,hoursToKickoff:(Date.parse(q.kickoffAt)-time)/3600000,
      previous:old?{decimalOdds:old.decimalOdds,observedAt:old.observedAt,marketProbability:old.marketProbability}:null,improvement,
      detectionInterval:kind==='NEWLY_OBSERVED'?{from:previousScan.at,to:q.observedAt}:null,
      valueStatus:'UNVERIFIED',expectedValue:null,
      reason:kind==='NEWLY_OBSERVED'?'Nově zachycená nabídka v průběžně sledovaném okně; skutečný čas vypsání zdroj neuvádí.':'Vyšší nabízená cena než při předchozím měření. Mohla se současně zhoršit šance výsledku; kladné EV není doložené.'});
  }
  return signals.sort((a,b)=>(b.improvement??0)-(a.improvement??0)||b.quote.marketProbability-a.quote.marketProbability||a.quote.key.localeCompare(b.quote.key));
}
export function renderWatchSignal(s) {
  const q=s.quote,pct=n=>(100*n).toFixed(2).replace('.',',')+' %',tip={home:'1',draw:'0',away:'2'}[q.outcomeId];
  return `${s.kind==='PRICE_IMPROVED'?'Zlepšení pozorované ceny':'Nově zachycená nabídka'}: ${q.home.name} – ${q.away.name}\nTip ${tip}, Fortuna, kurz ${q.decimalOdds}${s.previous?` (dříve ${s.previous.decimalOdds}; změna ${pct(s.improvement)})`:''}.\nTržní odhad ${pct(q.marketProbability)}; do začátku ${s.hoursToKickoff.toFixed(1)} h.\n${s.reason}\nNačteno ${q.observedAt}; obnovit nejpozději ${q.expiresAt}.\nČas skutečného vypsání neznámý. Jde o podnět ke kontrole, nikoli prokázanou sázkovou výhodu.`;
}
