import fs from 'node:fs';
import assert from 'node:assert/strict';
import { suite, testAsync, summary } from './harness.js';
import { buildTickets, digest } from '../specialists/sazeni/engine/tickets.js';
import { resolveWindow } from '../specialists/sazeni/engine/contract.js';
import { extractBettingInput, runBetting } from '../specialists/sazeni/tools/betting-engine.js';
import { exportBettingCSV, renderBettingResult } from '../specialists/sazeni/presentation/report.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/betting/envelope.json',import.meta.url),'utf8'));
const NOW='2026-09-11T12:00:00.000Z';
const clone=()=>structuredClone(fixture);
const run=(r,s,opts={})=>buildTickets(r,s,{now:NOW,...opts});
suite('Sázkař — user-requested odds, probability and time constraints');
await testAsync('24h / 72h include the exact boundary and exclude week/month; spread is separate',async()=>{
 const {request:r,snapshot:s}=clone();delete r.stake;r.legs={min:1,max:1};r.ticketType='single';r.ticketOdds={min:'1.5',max:'2'};r.ticketCount=10;
 let a=await run(r,s);assert.equal(a.status,'READY');assert.deepEqual(a.tickets.map(t=>t.selections[0].eventId),['e0','e1','e2','e3']);
 r.window.horizonHours=72;a=await run(r,s);assert.equal(a.tickets.length,6);assert.ok(a.tickets.every(t=>!['e6','e7'].includes(t.selections[0].eventId)));
 r.legs={min:2,max:2};r.ticketType='accumulator';r.ticketOdds={min:'3',max:'4'};a=await run(r,s);assert.equal(a.tickets.length,3);assert.ok(a.tickets.every(t=>t.window.spreadHours<=8));
});
await testAsync('relative 3 days are 72 elapsed hours across DST and re-anchor each turn',async()=>{
 for(const anchor of ['2026-03-28T12:00:00.000Z','2026-10-24T12:00:00.000Z']) {const w=resolveWindow({timezone:'Europe/Prague',horizonHours:72},anchor);assert.equal(Date.parse(w.to)-Date.parse(w.from),72*3600000);}
 assert.throws(()=>resolveWindow({timezone:'Europe/Prague',horizonHours:24,from:NOW},NOW));
 assert.throws(()=>resolveWindow({timezone:'Europe/Prague',from:'2026-02-30T12:00:00.000Z',to:NOW},NOW));
});
await testAsync('exhaustive independent oracle verifies all feasible sets and ranking on 20 generated requests',async()=>{
 for(let seed=0;seed<20;seed++) {
  const {request:r,snapshot:s}=clone();delete r.stake;s.events=s.events.slice(0,4);r.window={timezone:'UTC',horizonHours:24,maxSpreadHours:seed%2?24:6};r.ticketCount=10;r.diversity.maxSharedEvents=8;
  r.legs={min:1,max:3};r.ticketOdds={min:String(1.1+seed%3),max:String(4+seed%5)};r.probabilityFilter={basis:'user_estimate',metric:'estimate',min:(seed%4)*.1};
  s.events.forEach((e,i)=>{e.markets[0].outcomes[0].decimalOdds=String(1.5+((seed+i)%6)/10);});
  const expected=[];
  for(let mask=1;mask<16;mask++) {const es=s.events.filter((_,i)=>mask&(1<<i));if(es.length>3)continue;const times=es.map(e=>Date.parse(e.kickoffAt));if(Math.max(...times)-Math.min(...times)>r.window.maxSpreadHours*3600000)continue;
   const o=es.reduce((a,e)=>a*Number(e.markets[0].outcomes[0].decimalOdds),1),p=.65**es.length;
   if(o+1e-10<Number(r.ticketOdds.min)||o-1e-10>Number(r.ticketOdds.max)||p+1e-12<r.probabilityFilter.min)continue;
   expected.push({ids:es.map(e=>e.eventId).join(','),p,n:es.length});
  }
  expected.sort((a,b)=>b.p-a.p||a.n-b.n||a.ids.localeCompare(b.ids));const a=await run(r,s);
  assert.equal(a.search.completed,true);assert.deepEqual(a.tickets.map(t=>t.selections.map(e=>e.eventId).join(',')),expected.slice(0,10).map(t=>t.ids),`seed ${seed}`);
 }
});
await testAsync('exact decimal products, cent payout and probability provenance',async()=>{
 const {request:r,snapshot:s}=clone();r.probabilityFilter.basis='user_estimate';r.ticketOdds={min:'3.61',max:'3.61'};
 const a=await run(r,s);assert.equal(a.status,'READY');assert.equal(a.tickets[0].totalOdds,'3.61');assert.equal(a.tickets[0].money.returnMinor,36100);assert.equal(a.tickets[0].money.profitMinor,26100);assert.equal(a.tickets[0].winProbability.estimate,.65*.65);assert.equal(a.tickets[0].winProbability.modelInterval,null);assert.equal(a.verifiedLive,false);
 assert.equal(a.runId,(await run(r,s)).runId);assert.ok(renderBettingResult(a).includes('3.61'));
});
await testAsync('unknown fields, invalid odds, zero and non-normalized probabilities fail closed',async()=>{
 for(const mutate of [(r)=>r.fake=true,(r)=>r.legOdds.min=1.5,(r)=>r.probabilityFilter.min=70,(_,s)=>s.events[0].markets[0].prediction.probabilities.home=.9]) {const {request:r,snapshot:s}=clone();mutate(r,s);const a=await run(r,s);assert.equal(a.status,'INVALID_REQUEST');assert.equal(a.tickets.length,0);}
 const {request:r,snapshot:s}=clone();r.probabilityFilter.basis='user_estimate';s.events.forEach(e=>e.markets[0].prediction.probabilities={home:0,draw:.5,away:.5});assert.equal((await run(r,s)).status,'NO_SOLUTION');
 r.probabilityFilter.basis='model';assert.equal((await run(r,s)).status,'MODEL_UNAVAILABLE');r.probabilityFilter.basis='market';r.probabilityFilter.metric='lower_bound';assert.equal((await run(r,s)).status,'MODEL_UNAVAILABLE');
});
await testAsync('shared team, event, dependency, region, bookmaker or settlement cannot form accumulator',async()=>{
 for(const kind of ['team','dependency','region','book','settlement']) {const {request:r,snapshot:s}=clone();s.events=s.events.slice(0,2);const [a,b]=s.events;
  if(kind==='team') b.home.id=a.home.id;if(kind==='dependency') {a.dependencyGroups=['linked'];b.dependencyGroups=['linked'];}if(kind==='region') b.markets[0].region='other';if(kind==='book') {b.markets[0].bookmakerId='other';r.bookmakerIds.push('other');}if(kind==='settlement')b.markets[0].settlementRuleId='other';
  assert.equal((await run(r,s)).status,'NO_SOLUTION',kind);
 }
 const {request:r,snapshot:s}=clone();s.events=s.events.slice(0,1);r.legOdds.max='5';r.ticketOdds.max='30';assert.equal((await run(r,s)).status,'NO_SOLUTION');
});
await testAsync('untrusted live import, stale quotes, cancelled and incomplete search are explicit',async()=>{
 const {request:r,snapshot:s}=clone();r.dataMode=s.dataMode='live';assert.equal((await run(r,s)).status,'PROVIDER_ERROR');
 const trusted={trustedLiveDigest:digest(s)};assert.equal((await run(r,s,trusted)).status,'READY');
 s.events.forEach(e=>e.markets[0].sourceUpdatedAt='2026-09-11T11:57:00.000Z');assert.equal((await run(r,s,{trustedLiveDigest:digest(s)})).status,'INSUFFICIENT_DATA');
 r.dataMode=s.dataMode='imported';assert.equal((await run(r,s,{maxNodes:1})).status,'SEARCH_LIMIT_REACHED');
 const controller=new AbortController();controller.abort();assert.equal((await run(r,s,{signal:controller.signal})).status,'CANCELLED');
 s.coverage.complete=false;s.events=[];assert.equal((await run(r,s)).status,'INSUFFICIENT_DATA');
});
await testAsync('infeasible probability offers recomputed alternatives without changing request',async()=>{
 const {request:r,snapshot:s}=clone();r.probabilityFilter.min=.5;const before=JSON.stringify(r),a=await run(r,s);assert.equal(a.status,'NO_SOLUTION');assert.equal(a.tickets.length,0);assert.ok(a.alternatives.some(t=>t.status==='READY'));assert.equal(JSON.stringify(r),before);
});
await testAsync('Czech follow-ups, inline attachments, malicious payload and safe CSV',async()=>{
 const payload=clone(),p=extractBettingInput('Sestav tiket do 3 dnů, kurz od 3 do 4, úspěšnost alespoň 20 %, rozestup max 8 h',[{type:'application/json',content:JSON.stringify(payload)}]);
 const a=await runBetting(p,{now:NOW});assert.equal(a.status,'READY');assert.equal(a.effectivePreferences.window.to,'2026-09-14T12:00:00.000Z');
 assert.equal(extractBettingInput('do 24 h nebo do 3 dnů').inputError.code,'INVALID_REQUEST');assert.equal(extractBettingInput('do 0.5 h').horizonHours,.5);
 const absentClock=await runBetting({payload});assert.equal(absentClock.status,'NEEDS_INPUT');assert.equal(JSON.parse(JSON.stringify(absentClock)).generatedAt,null);
 assert.equal(extractBettingInput('Sestav tiket',[{type:'application/pdf',content:'fake'}]).inputError.code,'NEEDS_INPUT');assert.equal(extractBettingInput('{"request":{},"snapshot":{},"now":"fake"}').inputError.code,'INVALID_REQUEST');
 payload.snapshot.events[0].home.name='=HYPERLINK("evil")';const b=await run(payload.request,payload.snapshot);assert.ok(exportBettingCSV(b).includes("'=HYPERLINK"));
});
summary();
