import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { suite, testAsync, summary } from './harness.js';
import { SpecialistRuntime, specialistRuntime } from '../src/expertises/specialist-runtime.js';
import { scanSpecialistPackage } from '../src/specialists/specialist-boundary.js';
import * as sazkar from '../specialists/sazeni/index.js';
import { importOddsAPI } from '../specialists/sazeni/providers/odds-api-import.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/betting/envelope.json',import.meta.url),'utf8'));
const ctx=runtime=>({requireCapability:()=>runtime,getCapability:()=>null,extensionId:'sazeni',manifest:{payload:{}}});
const current=()=>{const p=structuredClone(fixture),now=Date.now();p.snapshot.generatedAt=new Date(now).toISOString();p.snapshot.events.forEach((e,i)=>{e.kickoffAt=new Date(now+[2,4,8,24,48,72,168,720][i]*3600000).toISOString();e.markets[0].sourceUpdatedAt=p.snapshot.generatedAt;e.markets[0].observedAt=p.snapshot.generatedAt;});return p;};
suite('Sázkař runtime, real serialized presentation and import boundary');
await testAsync('runtime consumes inline JSON and follows up in same session only',async()=>{
 const runtime=new SpecialistRuntime();await sazkar.register(ctx(runtime));const p=current();
 const a=await runtime.tryToolExecution('sazeni','Sestav tiket do 24 h',{sessionId:'a',attachments:[{type:'application/json',content:JSON.stringify(p)}]});assert.equal(a.result.status,'READY');assert.ok(a.presentation.includes('3.61'));
 const b=await runtime.tryToolExecution('sazeni','Teď do 3 dnů, rozestup max 48 h',{sessionId:'a'});assert.equal(b.result.status,'READY');assert.equal(Date.parse(b.result.effectivePreferences.window.to)-Date.parse(b.result.effectivePreferences.window.from),72*3600000);assert.equal(b.result.effectivePreferences.window.maxSpreadHours,48);
 assert.equal((await runtime.tryToolExecution('sazeni','Sestav tiket do 24 h',{sessionId:'b'})).result.status,'NEEDS_INPUT');
 const controller=new AbortController();controller.abort();assert.equal((await runtime.tryToolExecution('sazeni','Sestav tiket',{sessionId:'a',signal:controller.signal})).result.status,'CANCELLED');
 sazkar.unregister(ctx(runtime));assert.equal(await runtime.tryToolExecution('sazeni','Sestav tiket',{sessionId:'a'}),null);
});
await testAsync('real handler emits engine numbers unchanged and fail-closed response after disable',async()=>{
 const {specialistHandler}=await import('../src/chat/handlers/specialist.js');await sazkar.register(ctx(specialistRuntime));
 const context={specialist:{id:'sazeni',primaryExpertiseId:'sazeni',name:'Sázkař',domain:'sports_betting',expertiseCollection:[]},sessionId:'betting-handler',sessionState:{get:()=>null,clearSpecialist:()=>{}},attachments:[{type:'application/json',content:JSON.stringify(current())}]};
 try {
  const response=await specialistHandler('Sestav tiket do 24 h',context),wire=JSON.parse(JSON.stringify(response));
  assert.equal(wire.tag.metadata.deterministicPresentation,true);const result=wire.tag.metadata.toolResults[0].data;assert.equal(result.status,'READY');assert.equal(result.tickets[0].totalOdds,'3.61');assert.ok(wire.content.includes('3.61'));assert.equal(wire.tag.can_execute,false);
  sazkar.unregister(ctx(specialistRuntime));const disabled=await specialistHandler('Sestav tiket',context);assert.ok(disabled.content);assert.notEqual(disabled.tag.metadata?.deterministicPresentation,true);
 } finally {if(specialistRuntime.isSpecialist('sazeni')) sazkar.unregister(ctx(specialistRuntime));}
});
await testAsync('package passes same scanner used by loader',async()=>{
 const result=scanSpecialistPackage(path.resolve('specialists/sazeni'),{projectRoot:path.resolve('.')});assert.equal(result.ok,true,JSON.stringify(result));
});
await testAsync('Odds API import preserves timestamps/identity and cannot claim verified live coverage',async()=>{
 const at='2026-09-11T12:00:00.000Z';const raw=[{id:'e1',sport_key:'soccer_demo',commence_time:'2026-09-12T00:00:00Z',home_team:'Home',away_team:'Away',bookmakers:[{key:'demo',last_update:at,markets:[{key:'h2h',outcomes:[{name:'Home',price:1.9},{name:'Draw',price:3.5},{name:'Away',price:4.5}]}]}]}];
 const snapshot=importOddsAPI(raw,{observedAt:at,bookmakers:{demo:{region:'CZ-DEMO',settlementRuleId:'90min-demo'}}});assert.equal(snapshot.dataMode,'imported');assert.equal(snapshot.coverage.complete,false);assert.equal(snapshot.events[0].markets[0].sourceUpdatedAt,at);assert.equal(snapshot.events[0].markets[0].outcomes[0].decimalOdds,'1.9');
 assert.throws(()=>importOddsAPI(raw,{observedAt:at}));raw[0].bookmakers[0].markets[0].outcomes.pop();assert.throws(()=>importOddsAPI(raw,{observedAt:at,bookmakers:{demo:{region:'CZ-DEMO',settlementRuleId:'90min-demo'}}}));
});
summary();
