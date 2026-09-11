import { keys, text, integer, probability, choice, strings, instant, decimal, compare, fail } from './values.js';

export const BETTING_VERSION = 2;
export const BETTING_STATUSES = Object.freeze(['READY', 'NEEDS_INPUT', 'INVALID_REQUEST', 'INSUFFICIENT_DATA', 'MODEL_UNAVAILABLE', 'NO_SOLUTION', 'SEARCH_LIMIT_REACHED', 'CANCELLED', 'PROVIDER_ERROR', 'PERSISTENCE_ERROR', 'INTERNAL_ERROR']);
export function resolveWindow(window, now) {
  const nowMs = instant(now, 'now');
  keys(window, ['timezone'], ['from', 'to', 'horizonHours', 'maxSpreadHours'], 'window');
  try { new Intl.DateTimeFormat('cs-CZ', {timeZone:window.timezone}); } catch { fail('INVALID_REQUEST', 'Neplatná časová zóna.', 'window.timezone'); }
  text(window.timezone, 'window.timezone');
  let from, to;
  if (Object.hasOwn(window, 'horizonHours')) {
    integer(window.horizonHours, 1, 720, 'window.horizonHours');
    if (Object.hasOwn(window, 'from') || Object.hasOwn(window, 'to')) fail('INVALID_REQUEST', 'Relativní a absolutní okno nelze kombinovat.', 'window');
    from = nowMs;
    to = from + window.horizonHours * 3600000;
  } else {
    from = instant(window.from, 'window.from');
    to = instant(window.to, 'window.to');
    if (to <= from || to - from > 720 * 3600000) fail('INVALID_REQUEST', 'Okno musí být kladné a nejvýše 30 dnů.', 'window');
  }
  if (window.maxSpreadHours !== undefined) integer(window.maxSpreadHours, 0, 720, 'window.maxSpreadHours');
  return { from:new Date(from).toISOString(), to:new Date(to).toISOString(), timezone:window.timezone,
    maxSpreadHours:window.maxSpreadHours ?? (to - from)/3600000,
    anchorAt:window.horizonHours === undefined ? null : now };
}
export function validateRequest(request, now) {
  keys(request, ['contract','version','requestId','sport','competitionIds','window','bookmakerIds','ticketType','legOdds','ticketOdds','legs','probabilityFilter','objective','ticketCount','diversity','exclude','dataMode'], ['minLegProbability','minExpectedRoi','targetOdds','stake'], 'request');
  choice(request.contract, ['BettingRequest'], 'contract');
  choice(request.version, [BETTING_VERSION], 'version');
  text(request.requestId, 'requestId');
  choice(request.sport, ['football'], 'sport');
  strings(request.competitionIds, 'competitionIds', {empty:false});
  strings(request.bookmakerIds, 'bookmakerIds', {empty:false});
  choice(request.ticketType, ['single','accumulator'], 'ticketType');
  for (const name of ['legOdds','ticketOdds']) {
    keys(request[name], ['min','max'], [], name);
    if (compare(decimal(request[name].min, `${name}.min`),decimal(request[name].max, `${name}.max`)) > 0) fail('INVALID_REQUEST', 'Minimum překračuje maximum.', name);
  }
  keys(request.legs, ['min','max'], [], 'legs');
  integer(request.legs.min,1,8,'legs.min'); integer(request.legs.max,request.legs.min,8,'legs.max');
  if (request.ticketType === 'single' && (request.legs.min !== 1 || request.legs.max !== 1)) fail('INVALID_REQUEST','Single má jednu položku.','legs');
  keys(request.probabilityFilter,['basis','metric','min'],[],'probabilityFilter');
  choice(request.probabilityFilter.basis,['market','user_estimate','model'],'probabilityFilter.basis');
  choice(request.probabilityFilter.metric,['estimate','lower_bound'],'probabilityFilter.metric');
  probability(request.probabilityFilter.min,'probabilityFilter.min');
  if (request.minLegProbability !== undefined) probability(request.minLegProbability,'minLegProbability');
  if (request.minExpectedRoi !== undefined && (typeof request.minExpectedRoi !== 'number' || !Number.isFinite(request.minExpectedRoi) || request.minExpectedRoi < -1)) fail('INVALID_REQUEST','Neplatné minimální ROI.','minExpectedRoi');
  choice(request.objective,['highest_probability','highest_expected_value','closest_target_odds'],'objective');
  if (request.objective === 'closest_target_odds' || request.targetOdds !== undefined) {
    const target = decimal(request.targetOdds,'targetOdds');
    if (compare(target,decimal(request.ticketOdds.min)) < 0 || compare(target,decimal(request.ticketOdds.max)) > 0) fail('INVALID_REQUEST','Cílový kurz musí být uvnitř mezí.','targetOdds');
  }
  integer(request.ticketCount,1,10,'ticketCount');
  keys(request.diversity,['maxSharedEvents'],[],'diversity'); integer(request.diversity.maxSharedEvents,0,8,'diversity.maxSharedEvents');
  keys(request.exclude,['eventIds','participantIds','competitionIds'],[],'exclude');
  for (const [key,value] of Object.entries(request.exclude)) strings(value,`exclude.${key}`);
  choice(request.dataMode,['imported','historical','live'],'dataMode');
  if (request.stake !== undefined) {
    keys(request.stake,['currency','perTicketMinor','totalBudgetMinor'],[],'stake');
    choice(request.stake.currency,['CZK'],'stake.currency');
    integer(request.stake.perTicketMinor,1,1_000_000_000,'stake.perTicketMinor');
    integer(request.stake.totalBudgetMinor,request.stake.perTicketMinor,1_000_000_000,'stake.totalBudgetMinor');
  }
  return { ...request, window:resolveWindow(request.window, now) };
}

export function validateSnapshot(snapshot) {
  keys(snapshot,['contract','version','snapshotId','generatedAt','dataMode','source','coverage','events'],[],'snapshot');
  choice(snapshot.contract,['BettingSnapshot'],'snapshot.contract'); choice(snapshot.version,[2],'snapshot.version');
  text(snapshot.snapshotId,'snapshot.snapshotId'); instant(snapshot.generatedAt,'snapshot.generatedAt');
  choice(snapshot.dataMode,['imported','historical','live'],'snapshot.dataMode');
  keys(snapshot.source,['id','version'],[],'snapshot.source'); text(snapshot.source.id,'snapshot.source.id'); text(snapshot.source.version,'snapshot.source.version');
  keys(snapshot.coverage,['complete','scope'],[],'snapshot.coverage');
  if (typeof snapshot.coverage.complete !== 'boolean') fail('INVALID_REQUEST','Chybí stav pokrytí.','snapshot.coverage.complete');
  text(snapshot.coverage.scope,'snapshot.coverage.scope',1000);
  if (!Array.isArray(snapshot.events) || snapshot.events.length > 1000) fail('INVALID_REQUEST','Nejvýše 1000 událostí v importu.','snapshot.events');
  const events = new Set(), markets = new Set();
  for (const [i,e] of snapshot.events.entries()) {
    const p = `snapshot.events[${i}]`;
    keys(e,['eventId','competitionId','sport','kickoffAt','status','home','away','dependencyGroups','markets'],[],p);
    text(e.eventId,p+'.eventId'); if(events.has(e.eventId)) fail('INVALID_REQUEST','Duplicitní událost.',p); events.add(e.eventId);
    text(e.competitionId,p+'.competitionId'); text(e.sport,p+'.sport'); instant(e.kickoffAt,p+'.kickoffAt');
    choice(e.status,['scheduled','live','finished','postponed','cancelled'],p+'.status');
    for (const side of ['home','away']) { keys(e[side],['id','name'],[],p+'.'+side); text(e[side].id,p+'.'+side+'.id'); text(e[side].name,p+'.'+side+'.name'); }
    if(e.home.id===e.away.id) fail('INVALID_REQUEST','Shodní účastníci.',p);
    strings(e.dependencyGroups,p+'.dependencyGroups');
    if(!Array.isArray(e.markets)||e.markets.length>50) fail('INVALID_REQUEST','Neplatný seznam trhů.',p+'.markets');
    for(const [j,m] of e.markets.entries()) {
      const q=p+`.markets[${j}]`;
      keys(m,['marketId','kind','period','bookmakerId','region','settlementRuleId','sourceUpdatedAt','observedAt','availability','outcomes'],['prediction'],q);
      for(const k of ['marketId','kind','period','bookmakerId','region','settlementRuleId']) text(m[k],q+'.'+k);
      if(markets.has(m.marketId)) fail('INVALID_REQUEST','Duplicitní market ID.',q); markets.add(m.marketId);
      if(m.sourceUpdatedAt!==null) instant(m.sourceUpdatedAt,q+'.sourceUpdatedAt');
      instant(m.observedAt,q+'.observedAt'); choice(m.availability,['open','suspended','closed'],q+'.availability');
      if(!Array.isArray(m.outcomes)||m.outcomes.length!==3) fail('INVALID_REQUEST','Úplný 1X2 trh musí mít tři výsledky.',q+'.outcomes');
      const outcomes=new Set();
      for(const o of m.outcomes) { keys(o,['outcomeId','decimalOdds'],[],q+'.outcomes'); choice(o.outcomeId,['home','draw','away'],q+'.outcomeId'); outcomes.add(o.outcomeId); const price=decimal(o.decimalOdds,q+'.decimalOdds'); if(compare(price,{n:10000n,d:1n})>0) fail('INVALID_REQUEST','Kurz položky přesahuje 10000.',q); }
      if(outcomes.size!==3) fail('INVALID_REQUEST','Duplicitní výsledek trhu.',q);
      if(m.prediction!==undefined) {
        keys(m.prediction,['basis','probabilities','method','predictedAt'],['modelRef'],q+'.prediction');
        choice(m.prediction.basis,['user_estimate','model'],q+'.prediction.basis'); text(m.prediction.method,q+'.prediction.method'); instant(m.prediction.predictedAt,q+'.prediction.predictedAt');
        keys(m.prediction.probabilities,['home','draw','away'],[],q+'.prediction.probabilities');
        const ps=Object.values(m.prediction.probabilities); ps.forEach(v=>probability(v,q+'.prediction.probabilities'));
        if(Math.abs(ps.reduce((a,b)=>a+b,0)-1)>1e-9) fail('INVALID_REQUEST','Součet pravděpodobností trhu není 1.',q+'.prediction.probabilities');
        if(m.prediction.modelRef!==undefined) text(m.prediction.modelRef,q+'.prediction.modelRef');
      }
    }
  }
  return snapshot;
}
