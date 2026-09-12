import fs from 'node:fs';
import os from 'node:os';
import {createDefaultBettingBridge} from '../src/betting/default-host.js';
import {BettingDataStore} from '../src/betting/data-store.js';
import {createBettingDataHost} from '../src/betting/data-host.js';
import {createOutboundPolicy} from '../src/network/outbound-policy.js';
import {runAutonomous} from '../specialists/sazeni/engine/autonomous.js';
import {oddsIOSnapshot} from '../specialists/sazeni/providers/odds-io.js';
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
 assert.equal((await runtime.tryToolExecution('sazeni','Sestav tiket do 24 h',{sessionId:'b'})).result.status,'PROVIDER_ERROR');
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

const FIXED='2026-09-12T08:00:00.000Z';
function historyCSV(season,at=FIXED) {
 const rows=['Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A'];
 for(let i=0;i<96;i++) {const d=new Date(Date.UTC(2000+season,6,1+i*3));if(d>=new Date(at))continue;const teams=['A','B','C','D'],h=teams[i%4],a=teams[(i%4+1+Math.floor(i/4)%3)%4],x=i%4,y=Math.floor(i/4)%3;rows.push(['E0',`${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`,'15:00',h,a,x,y,x>y?'H':x===y?'D':'A',1.9,3.5,4.5].join(','));}
 return rows.join('\n');
}
const rawFixtures='Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A\nE0,12/09/2026,15:00,A,B,1.9,3.5,4.5\nE0,12/09/2026,18:00,C,D,1.9,3.5,4.5\n';
await testAsync('real data host, autonomous preferences, cache, evidence database and scoped revocation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'is-betting-test-')),filename=path.join(root,'data.sqlite'),store=new BettingDataStore(filename);let calls=0,clock=Date.parse(FIXED);
 const bridge=createBettingDataHost({store,clock:()=>clock,transport:async(url)=>{calls++;clock+=1000;const season=Number(/mmz4281\/(\d{2})/.exec(String(url))?.[1]);return new Response(String(url).endsWith('fixtures.csv')?rawFixtures:historyCSV(season),{headers:{'last-modified':'Fri, 11 Sep 2026 07:17:00 GMT'}});}});
 let token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});
 try {
  const data=bridge.host.forTurn(token),result=await runAutonomous({leagues:['E0'],horizonHours:24,minOdds:'1.5',maxOdds:'4',minProbability:.2},{now:FIXED,bettingData:data,clock:()=>clock-Date.parse(FIXED)});
  assert.equal(result.status,'READY',JSON.stringify(result.errors));assert.equal(result.persistence.status,'SAVED');assert.equal(result.analysis.autonomous,true);assert.equal(result.analysis.models.length,1);assert.equal(calls,6);
  assert.equal(store.database.prepare('SELECT count(*) n FROM betting_runs').get().n,1);assert.equal(store.database.prepare("SELECT count(*) n FROM m5_outbound_audit_events WHERE decision='succeeded'").get().n,6);
  const persisted=JSON.parse(store.database.prepare('SELECT record_json FROM betting_runs').get().record_json);assert.equal(persisted.snapshot.events[0].markets[0].prediction.basis,'model');assert.ok(persisted.models[0].trainingDigest);assert.equal(persisted.hostInvocation.extensionId,'sazeni');assert.equal(persisted.hostInvocation.sourceObservationIds.length,6);
  await assert.rejects(data.get({kind:'fixtures'}),/EXPIRED/);bridge.host.closeInvocation(token);
  token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});const cached=await bridge.host.forTurn(token).get({kind:'fixtures'});assert.equal(cached.sourceRef.cacheHit,true);assert.equal(calls,6);
  await assert.rejects(bridge.host.forTurn(token).get({kind:'fixtures',url:'https://evil.invalid'}),/INVALID/);bridge.host.closeInvocation(token);await assert.rejects(bridge.capability.get(token,{kind:'fixtures'}),/EXPIRED/);
  assert.throws(()=>bridge.host.openInvocation({extensionId:'other',toolId:'sazeni.ticket_builder',operator:true}),/TURN/);
 } finally {bridge.host.closeInvocation(token);store.close();fs.rmSync(root,{recursive:true,force:true});}
});
await testAsync('outbound capability denies other paths, methods, credentials and redirects before transport',async()=>{
 const store=new BettingDataStore(':memory:');let calls=0;
 try {const policy=createOutboundPolicy({database:store.database,logger:{warn(){},error(){}},enabledSurfaces:{'betting-data':true},transport:async()=>{calls++;return new Response('ok');}});
  for(const [url,init] of [['https://evil.invalid/fixtures.csv',{}],['https://www.football-data.co.uk/fixtures.csv?secret=x',{}],['https://www.football-data.co.uk/fixtures.csv',{method:'POST'}],['https://www.football-data.co.uk/private.csv',{}]])await assert.rejects(policy.footballDataFetch(url,{headers:{accept:'text/csv'},...init}));assert.equal(calls,0);
  const redirect=createOutboundPolicy({database:store.database,logger:{warn(){},error(){}},enabledSurfaces:{'betting-data':true},transport:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
  await assert.rejects(redirect.footballDataFetch('https://www.football-data.co.uk/fixtures.csv',{headers:{accept:'text/csv'}}),/denied/);
 }finally{store.close();}
});
await testAsync('provider errors, cancellation and persistence failure never turn into successful tickets',async()=>{
 for(const status of [429,500]){const store=new BettingDataStore(':memory:'),bridge=createBettingDataHost({store,transport:async()=>new Response('secret provider error',{status})}),token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});try{await assert.rejects(bridge.capability.get(token,{kind:'fixtures'}),e=>!e.message.includes('secret'));}finally{bridge.host.closeInvocation(token);store.close();}}
 const controller=new AbortController();controller.abort();const store=new BettingDataStore(':memory:');let network=0;const bridge=createBettingDataHost({store,transport:async()=>{network++;return new Response(rawFixtures);}}),token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true,signal:controller.signal});try{await assert.rejects(bridge.capability.get(token,{kind:'fixtures'}),/CANCELLED/);assert.equal(network,0);}finally{bridge.host.closeInvocation(token);store.close();}
 const get=async request=>({content:request.kind==='fixtures'?rawFixtures:historyCSV(request.season),sourceRef:{resource:request.kind==='fixtures'?'football-data:fixtures':'history',retrievedAt:FIXED,lastModified:'Fri, 11 Sep 2026 07:17:00 GMT',sha256:'0'.repeat(64),url:'https://www.football-data.co.uk/fixtures.csv'}});
 const failed=await runAutonomous({leagues:['E0']},{now:FIXED,bettingData:{get,save:async()=>{throw new Error('disk full');}}});assert.equal(failed.status,'PERSISTENCE_ERROR');assert.equal(failed.tickets.length,0);
});
await testAsync('Czech live adapter uses exact identities, timestamps, scoped API calls and never stores a key',async()=>{
 const key='test_key_not_a_credential',store=new BettingDataStore(':memory:');
 const event={id:1,home:'A',away:'B',homeId:1,awayId:2,date:'2026-09-12T14:00:00Z',sport:{slug:'football'},league:{slug:'england-premier-league'},status:'pending'};
 const odds={...event,bookmakers:{'Tipsport.cz':[{name:'Moneyline',updatedAt:FIXED,odds:[{home:'1.9',draw:'3.5',away:'4.5'}]}]}};
 const bridge=createBettingDataHost({store,clock:()=>Date.parse(FIXED),oddsIOKey:key,transport:async(url)=>String(url).includes('football-data.co.uk')?new Response(historyCSV(Number(/mmz4281\/(\d{2})/.exec(String(url))[1]))):new Response(JSON.stringify(new URL(url).pathname.endsWith('/bookmakers')?[{name:'Tipsport.cz',active:true}]:new URL(url).pathname.endsWith('/events')?[event]:[odds]))});
 const token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});
 try {const bundle=await bridge.capability.get(token,{kind:'live',leagues:['E0'],bookmakers:['Tipsport.cz'],from:FIXED,to:'2026-09-13T08:00:00.000Z'});
  const snapshot=oddsIOSnapshot(bundle,{now:FIXED,leagues:['E0'],bookmakerIds:['Tipsport.cz']});assert.equal(snapshot.dataMode,'live');assert.equal(snapshot.events[0].markets[0].region,'CZ');assert.equal(snapshot.events[0].markets[0].sourceUpdatedAt,FIXED);
  assert.ok(!JSON.stringify(store.database.prepare('SELECT * FROM betting_observations').all()).includes(key));assert.ok(!JSON.stringify(store.database.prepare('SELECT * FROM m5_outbound_audit_events').all()).includes(key));
  const tampered=JSON.parse(bundle.content);tampered.odds[0].awayId=3;assert.throws(()=>oddsIOSnapshot({...bundle,content:JSON.stringify(tampered)},{now:FIXED,leagues:['E0'],bookmakerIds:['Tipsport.cz']}),/IDENTITY/);
  const autonomous=await runAutonomous({leagues:['E0'],bookmakerIds:['Tipsport.cz']},{now:FIXED,bettingData:bridge.host.forTurn(token)});assert.equal(autonomous.status,'READY',JSON.stringify(autonomous.errors));assert.equal(autonomous.verifiedLive,true);assert.equal(autonomous.tickets[0].bookmakerId,'Tipsport.cz');assert.equal(autonomous.persistence.status,'SAVED');
 }finally{bridge.host.closeInvocation(token);store.close();}
});

await testAsync('actual chat handler accepts preferences without an imported snapshot and emits persisted autonomous result',async()=>{
 const {specialistHandler}=await import('../src/chat/handlers/specialist.js');const store=new BettingDataStore(':memory:');const now=new Date(),tomorrow=new Date(Date.now()+86400000);const date=`${String(tomorrow.getUTCDate()).padStart(2,'0')}/${String(tomorrow.getUTCMonth()+1).padStart(2,'0')}/${tomorrow.getUTCFullYear()}`;
 const csv=`Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A\nE0,${date},15:00,A,B,1.9,3.5,4.5\n`;
 const bridge=createBettingDataHost({store,transport:async url=>new Response(String(url).endsWith('fixtures.csv')?csv:historyCSV(Number(/mmz4281\/(\d{2})/.exec(String(url))[1]),now.toISOString()),{headers:{'last-modified':now.toUTCString()}})});
 specialistRuntime.setBettingDataHost(bridge.host);await sazkar.register(ctx(specialistRuntime));
 try {const result=await specialistHandler(JSON.stringify({preferences:{leagues:['E0'],horizonHours:72,minOdds:'1.5',maxOdds:'3',minProbability:.4}}),{specialist:{id:'sazeni',primaryExpertiseId:'sazeni',name:'Sázkař',domain:'sports_betting',expertiseCollection:[]},sessionId:'autonomous-handler',conversationId:'conversation-auto',userMessageId:456,sessionState:{get:()=>null,clearSpecialist:()=>{}}});
  const wire=JSON.parse(JSON.stringify(result)),data=wire.tag.metadata.toolResults[0].data;assert.equal(data.status,'READY',JSON.stringify(data.errors));assert.equal(data.analysis.autonomous,true);assert.equal(data.persistence.status,'SAVED');assert.equal(wire.tag.metadata.deterministicPresentation,true);assert.ok(wire.content.includes('1.9'));assert.equal(wire.tag.can_execute,false);
 }finally{sazkar.unregister(ctx(specialistRuntime));specialistRuntime.setBettingDataHost(null);store.close();}
});

await testAsync('extension capability cannot initialize storage without a core invocation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'is-betting-lazy-'));try{const bridge=createDefaultBettingBridge(root);await assert.rejects(bridge.capability.get({}, {kind:'fixtures'}),/SCOPE_EXPIRED/);assert.deepEqual(fs.readdirSync(root),[]);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
await testAsync('odds scope rejects non-RFC3339 strings carrying free text before transmission',async()=>{
 const store=new BettingDataStore(':memory:');let calls=0;const policy=createOutboundPolicy({database:store.database,logger:{warn(){},error(){}},enabledSurfaces:{'betting-data':true},transport:async()=>{calls++;return new Response('[]');}});
 try{const u=new URL('https://api.odds-api.io/v3/events');for(const [k,v] of Object.entries({apiKey:'test',sport:'football',league:'england-premier-league',status:'pending',limit:'100',skip:'0',from:'2026-09-12 (private annotation)',to:'2026-09-13'}))u.searchParams.set(k,v);await assert.rejects(policy.oddsIOFetch(u,{headers:{accept:'application/json'}}));assert.equal(calls,0);}finally{store.close();}
});
summary();
