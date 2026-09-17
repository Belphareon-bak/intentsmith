import fs from 'node:fs';
import os from 'node:os';
import {createDefaultBettingBridge} from '../src/betting/default-host.js';
import {BettingDataStore} from '../src/betting/data-store.js';
import {createBettingDataHost} from '../src/betting/data-host.js';
import {createOutboundPolicy} from '../src/network/outbound-policy.js';
import {runAutonomous} from '../specialists/sazeni/engine/autonomous.js';
import {oddsIOSnapshot} from '../specialists/sazeni/providers/odds-io.js';
import {fortunaPublicSnapshot} from '../specialists/sazeni/providers/fortuna-public.js';
import {BettingWatchStore} from '../src/betting/watch-store.js';
import {scanBettingWatch} from '../src/betting/watch.js';
import {sendWatchMail,validateWatchMail,watchRecipientHash} from '../src/betting/watch-mail.js';
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
await testAsync('unusable history redirect stops before loopback and identifies the unavailable source',async()=>{
 const store=new BettingDataStore(':memory:');let calls=0;
 const bridge=createBettingDataHost({store,transport:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/history.csv'}});}});
 const token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});
 try{
  const result=await runAutonomous({leagues:['E0']},{now:FIXED,bettingData:bridge.host.forTurn(token)});
  assert.equal(result.status,'PROVIDER_ERROR');assert.equal(calls,1);assert.deepEqual(result.tickets,[]);
  assert.match(result.errors[0].message,/football-data\.co\.uk.*2022\/2023/);assert.match(result.errors[0].message,/OUTBOUND_REDIRECT_DENIED/);
  assert.equal(store.database.prepare("SELECT count(*) n FROM m5_outbound_audit_events WHERE decision='deny' AND reason_code='OUTBOUND_REDIRECT_DENIED'").get().n,1);
 }finally{bridge.host.closeInvocation(token);store.close();}
});
await testAsync('real data host, autonomous preferences, cache, evidence database and scoped revocation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'is-betting-test-')),filename=path.join(root,'data.sqlite'),store=new BettingDataStore(filename);let calls=0,clock=Date.parse(FIXED);
 const bridge=createBettingDataHost({store,clock:()=>clock,transport:async(url)=>{calls++;clock+=1000;const season=Number(/mmz4281\/(\d{2})/.exec(String(url))?.[1]);return new Response(String(url).endsWith('fixtures.csv')?rawFixtures:historyCSV(season),{headers:{'last-modified':'Fri, 11 Sep 2026 07:17:00 GMT'}});}});
 let token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});
 try {
  const data=bridge.host.forTurn(token),result=await runAutonomous({dataSource:'reference',leagues:['E0'],horizonHours:24,minOdds:'1.5',maxOdds:'4',minProbability:.2},{now:FIXED,bettingData:data,clock:()=>clock-Date.parse(FIXED)});
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
 const failed=await runAutonomous({dataSource:'reference',leagues:['E0']},{now:FIXED,bettingData:{get,save:async()=>{throw new Error('disk full');}}});assert.equal(failed.status,'PERSISTENCE_ERROR');assert.equal(failed.tickets.length,0);
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
  const autonomous=await runAutonomous({dataSource:'odds_io',leagues:['E0'],bookmakerIds:['Tipsport.cz']},{now:FIXED,bettingData:bridge.host.forTurn(token)});assert.equal(autonomous.status,'READY',JSON.stringify(autonomous.errors));assert.equal(autonomous.verifiedLive,true);assert.equal(autonomous.tickets[0].bookmakerId,'Tipsport.cz');assert.equal(autonomous.persistence.status,'SAVED');
 }finally{bridge.host.closeInvocation(token);store.close();}
});

await testAsync('actual chat handler accepts preferences without an imported snapshot and emits persisted autonomous result',async()=>{
 const {specialistHandler}=await import('../src/chat/handlers/specialist.js');const store=new BettingDataStore(':memory:');const now=new Date(),tomorrow=new Date(Date.now()+86400000);const date=`${String(tomorrow.getUTCDate()).padStart(2,'0')}/${String(tomorrow.getUTCMonth()+1).padStart(2,'0')}/${tomorrow.getUTCFullYear()}`;
 const csv=`Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A\nE0,${date},15:00,A,B,1.9,3.5,4.5\n`;
 const bridge=createBettingDataHost({store,transport:async url=>new Response(String(url).endsWith('fixtures.csv')?csv:historyCSV(Number(/mmz4281\/(\d{2})/.exec(String(url))[1]),now.toISOString()),{headers:{'last-modified':now.toUTCString()}})});
 specialistRuntime.setBettingDataHost(bridge.host);await sazkar.register(ctx(specialistRuntime));
 try {const result=await specialistHandler(JSON.stringify({preferences:{dataSource:'reference',leagues:['E0'],horizonHours:72,minOdds:'1.5',maxOdds:'3',minProbability:.4}}),{specialist:{id:'sazeni',primaryExpertiseId:'sazeni',name:'Sázkař',domain:'sports_betting',expertiseCollection:[]},sessionId:'autonomous-handler',conversationId:'conversation-auto',userMessageId:456,sessionState:{get:()=>null,clearSpecialist:()=>{}}});
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
const publicOffer=JSON.parse(fs.readFileSync(new URL('./fixtures/betting/fortuna-public.json',import.meta.url)));
function publicTransport({clock,change=()=>{},count=()=>{}}){let listings=0;const anchor=clock();return async input=>{
 const u=new URL(input);count(u);
 if(u.hostname==='www.football-data.co.uk'){const names={A:'Crystal Palace',B:'Ipswich',C:'Liverpool',D:'Fulham'},csv=historyCSV(Number(/mmz4281\/(\d{2})/.exec(u.pathname)[1]),new Date(clock()).toISOString());return new Response(csv.split('\n').map((line,i)=>{if(!i)return line;const row=line.split(',');row[3]=names[row[3]];row[4]=names[row[4]];return row.join(',');}).join('\n'));}
 let data;
 if(u.pathname.endsWith('/matches')){data=structuredClone(publicOffer.listing);data.fixtures.forEach((e,i)=>{e.startDatetime=anchor+6*3600000+i*3600000;});listings++;}
 else if(u.pathname.endsWith('/overview'))data=structuredClone(publicOffer.markets);
 else throw new Error('Unexpected public request: '+u.pathname);
 change({u,data,listings});return new Response(JSON.stringify(data),{headers:{'content-type':'application/json','date':new Date(clock()).toUTCString()}});
};}
await testAsync('public Fortuna default acquires prices without a key and persists host-bound evidence',async()=>{
 const store=new BettingDataStore(':memory:');let ms=Date.parse(FIXED),calls=0;
 const bridge=createBettingDataHost({store,clock:()=>ms,transport:publicTransport({clock:()=>ms,count:()=>{calls++;ms+=1000;}})}),token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true});
 try{
  const result=await runAutonomous({leagues:['E0'],minOdds:'2',maxOdds:'4',minProbability:.2,minLegs:2,maxLegs:2},{now:FIXED,clock:()=>ms-Date.parse(FIXED),bettingData:bridge.host.forTurn(token)});
  assert.equal(result.status,'READY',JSON.stringify(result.errors));assert.equal(result.verifiedObservation,true);assert.equal(result.verifiedLive,false);assert.equal(result.dataMode,'observed');assert.equal(result.tickets[0].bookmakerId,'iFortuna CZ');assert.equal(result.tickets[0].selections.length,2);assert.equal(calls,8);
  assert.ok(result.tickets[0].selections.every(s=>s.sourceUpdatedAt===null));assert.ok(Date.parse(result.tickets[0].expiresAt)>ms);
  const record=JSON.parse(store.database.prepare('SELECT record_json FROM betting_runs').get().record_json);assert.equal(record.hostInvocation.sourceObservationIds.length,8);assert.equal(record.snapshot.source.id,'fortuna-public-web');assert.equal(record.request.dataSource,'public_web');
  assert.equal(store.database.prepare("SELECT count(*) n FROM m5_outbound_audit_events WHERE scope='sports.fortuna.public.read' AND decision='succeeded'").get().n,3);
  assert.ok(!JSON.stringify(store.database.prepare('SELECT url FROM betting_observations').all()).includes('apiKey'));
 }finally{bridge.host.closeInvocation(token);store.close();}
});
await testAsync('public host rejects changed schedules, foreign market IDs, bad pages and stale responses',async()=>{
 for(const variant of ['schedule','foreign','html','stale','rate','cancel']){
  let ms=Date.parse(FIXED),calls=0;const controller=new AbortController(),store=new BettingDataStore(':memory:');
  const base=publicTransport({clock:()=>ms,count:()=>{calls++;ms+=1000;},change:({data,listings,u})=>{if(variant==='schedule'&&listings===2&&u.pathname.endsWith('/matches'))data.fixtures[0].startDatetime+=3600000;if(variant==='foreign'&&u.pathname.endsWith('/overview'))data['ufo:mtch:xxx-xxx']=[];}});
  const transport=async u=>{if(['html','stale','rate'].includes(variant)){calls++;return variant==='html'?new Response('<html>Challenge</html>',{headers:{'content-type':'text/html'}}):variant==='rate'?new Response('do not expose body',{status:429}):new Response('{}',{headers:{'content-type':'application/json','date':'Fri, 11 Sep 2026 00:00:00 GMT'}});}const r=await base(u);if(variant==='cancel')controller.abort();return r;};
  const bridge=createBettingDataHost({store,clock:()=>ms,transport}),token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true,signal:controller.signal});
  try{await assert.rejects(bridge.capability.get(token,{kind:'fortuna_public',leagues:['E0'],from:FIXED,to:'2026-09-13T08:00:00.000Z'}),new RegExp({schedule:'IDENTITY_CHANGED',foreign:'SCOPE_MISMATCH',html:'SCHEMA_CHANGED',stale:'RESPONSE_STALE',rate:'RATE_LIMITED',cancel:'CANCELLED|aborted'}[variant]));assert.equal(store.database.prepare('SELECT count(*) n FROM betting_runs').get().n,0);if(['html','stale','rate','cancel'].includes(variant))assert.equal(calls,1);}
  finally{bridge.host.closeInvocation(token);store.close();}
 }
});
await testAsync('public outbound scope allows only fixed leagues and bounded unique match IDs',async()=>{
 const store=new BettingDataStore(':memory:');let calls=0;const policy=createOutboundPolicy({database:store.database,logger:{warn(){},error(){}},enabledSurfaces:{'betting-data':true},transport:async()=>{calls++;return new Response('{}');}});
 const good='https://api.ifortuna.cz/offer/markets/api/v1_0/fixtures/markets/overview?fixtureIds=ufo:mtch:1vy-0ch';
 try{
  for(const [u,init] of [[good+'&secret=x',{}],[good+'&fixtureIds=ufo:mtch:1vy-0ch',{}],[good.replace('1vy-0ch','../../private'),{}],[good,{method:'POST'}],[good,{headers:{accept:'application/json',cookie:'session=x'}}],['https://api.ifortuna.cz/pams/api/v2/player/details',{}],[good.replace('api.ifortuna.cz','evil.invalid'),{}]])await assert.rejects(policy.fortunaPublicFetch(u,{headers:{accept:'application/json'},...init}));assert.equal(calls,0);
  await policy.fortunaPublicFetch(good,{headers:{accept:'application/json'}});assert.equal(calls,1);
 }finally{store.close();}
});
await testAsync('actual chat handler emits public Fortuna prices and observation limits without attachments',async()=>{
 const {specialistHandler}=await import('../src/chat/handlers/specialist.js');const store=new BettingDataStore(':memory:'),bridge=createBettingDataHost({store,transport:publicTransport({clock:Date.now})});
 specialistRuntime.setBettingDataHost(bridge.host);await sazkar.register(ctx(specialistRuntime));
 try{
  const response=await specialistHandler(JSON.stringify({preferences:{leagues:['E0'],horizonHours:24,minOdds:'2',maxOdds:'4',minProbability:.2,minLegs:2,maxLegs:2}}),{specialist:{id:'sazeni',primaryExpertiseId:'sazeni',name:'Sázkař',domain:'sports_betting',expertiseCollection:[]},sessionId:'public-handler',conversationId:'conversation-public',userMessageId:789,sessionState:{get:()=>null,clearSpecialist:()=>{}}});
  const wire=JSON.parse(JSON.stringify(response)),r=wire.tag.metadata.toolResults[0].data;assert.equal(r.status,'READY',JSON.stringify(r.errors));assert.equal(r.verifiedObservation,true);assert.equal(wire.tag.metadata.deterministicPresentation,true);assert.ok(wire.content.includes('bez účtu a klíče'));assert.ok(wire.content.includes(r.tickets[0].totalOdds));assert.ok(wire.content.includes('čas poslední změny kurzu neznámý'));assert.equal(wire.tag.can_execute,false);
  const record=JSON.parse(store.database.prepare('SELECT record_json FROM betting_runs').get().record_json);assert.equal(record.hostInvocation.conversationId,'conversation-public');assert.equal(record.hostInvocation.userMessageId,789);
 }finally{sazkar.unregister(ctx(specialistRuntime));specialistRuntime.setBettingDataHost(null);store.close();}
});
await testAsync('watch persists independent observations, restarts without opening spam and records changed prices',async()=>{
 const store=new BettingDataStore(':memory:');let ms=Date.parse(FIXED),changed=false;
 const bridge=createBettingDataHost({store,clock:()=>ms,transport:publicTransport({clock:()=>ms,count:()=>ms+=1000,change:({u,data})=>{if(changed&&u.pathname.endsWith('/overview')){const o=Object.values(data)[0][0].outcomes.find(o=>o.optionTypeId==='ufo:otyp:00-3q');o.odds=Number((o.odds*1.06).toFixed(2));}}})});
 const preferences={leagues:['E0'],minOdds:1.01,maxOdds:100,minProbability:0};let watch=new BettingWatchStore(store),lease;
 try{
  const first=await scanBettingWatch({bridge,watch,preferences,clock:()=>ms});lease=first.lease;assert.equal(first.signals.length,0);assert.equal(first.quotes,6);watch.release(lease);lease=null;
  changed=true;ms+=15*60000;watch=new BettingWatchStore(store);
  const second=await scanBettingWatch({bridge,watch,preferences,clock:()=>ms});lease=second.lease;assert.equal(second.signals.length,1);assert.equal(second.signals[0].kind,'PRICE_IMPROVED');assert.equal(watch.status().observations,12);assert.equal(watch.alerts()[0].status,'local');
  const record=JSON.parse(store.database.prepare('SELECT record_json FROM betting_runs WHERE id=?').get(second.runId).record_json);assert.equal(record.contract,'BettingWatchEvidence');assert.equal(record.hostInvocation.sourceObservationIds.length,3);
  assert.throws(()=>watch.acquire(ms),/ALREADY_RUNNING/);watch.release(lease);lease=null;ms+=15*60000;
  const third=await scanBettingWatch({bridge,watch,preferences,clock:()=>ms});lease=third.lease;assert.equal(third.signals.length,0);assert.equal(watch.alerts().length,1);
 }finally{if(lease)watch.release(lease);store.close();}
});
await testAsync('mail requires one configured recipient, fresh evidence, TLS and durable at-most-once claims',async()=>{
 const store=new BettingDataStore(':memory:'),watch=new BettingWatchStore(store),ms=Date.parse(FIXED),lease=watch.acquire(ms),config={host:'smtp.example.com',port:465,user:'operator@example.com',from:'operator@example.com',to:'recipient@example.com'},hash=watchRecipientHash(config);let network=0;
 const q={key:'q',eventId:'e',competitionId:'E0',home:{name:'Home'},away:{name:'Away'},outcomeId:'home',decimalOdds:2,marketProbability:.45,observedAt:FIXED,expiresAt:new Date(ms+120000).toISOString()};
 const signal={contract:'BettingWatchSignal',version:1,id:'a'.repeat(64),kind:'PRICE_IMPROVED',quote:q,previous:{decimalOdds:1.8},improvement:1/9,hoursToKickoff:12,reason:'Testované zlepšení ceny.',valueStatus:'UNVERIFIED'};
 try{
  watch.save({token:lease,now:FIXED,scope:'scope',from:FIXED,to:new Date(ms+86400000).toISOString(),runId:'fixture',quotes:[q],signals:[signal],recipientHash:hash});
  assert.throws(()=>validateWatchMail({...config,to:'one@example.com,two@example.com'}));assert.throws(()=>validateWatchMail({...config,port:25}));
  const createTransport=options=>{assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);return {sendMail:async msg=>{network++;assert.deepEqual(msg.envelope.to,[config.to]);assert.equal(msg.disableFileAccess,true);assert.equal(msg.disableUrlAccess,true);assert.ok(msg.text.includes('kladné')||msg.text.includes('výhodu'));return {accepted:[config.to],rejected:[],messageId:'test-id'};},close(){}};};
  await assert.rejects(sendWatchMail({store,config,password:'fixture-password',signal:{...signal,quote:{...q,expiresAt:FIXED}},clock:()=>ms,createTransport}),/EXPIRED/);assert.equal(network,0);
  const claimed=watch.claimMail({token:lease,now:FIXED,recipientHash:hash,maxPerDay:4});assert.equal(claimed.id,signal.id);assert.equal(watch.claimMail({token:lease,now:FIXED,recipientHash:hash,maxPerDay:4}),null);
  const outcome=await sendWatchMail({store,config,password:'fixture-password',signal:claimed.signal,clock:()=>ms,createTransport});watch.finishMail(claimed.id,outcome);assert.equal(watch.alerts()[0].status,'sent');assert.equal(network,1);
  assert.equal(store.database.prepare("SELECT count(*) n FROM m5_outbound_audit_events WHERE scope='sports.betting.email.notify'").get().n,2);
  assert.ok(!JSON.stringify(store.database.prepare('SELECT * FROM m5_outbound_audit_events').all()).includes('fixture-password'));
 }finally{watch.release(lease);store.close();}
});
await testAsync('watch never resends ambiguous SMTP attempts and expires pending alerts after downtime',async()=>{
 const store=new BettingDataStore(':memory:'),watch=new BettingWatchStore(store),ms=Date.parse(FIXED);let lease=watch.acquire(ms);
 try{
  for(const [id,status] of [['uncertain','sending'],['stale','pending']])store.database.prepare('INSERT INTO betting_watch_alerts(id,at,expires_at,payload,status,recipient_hash) VALUES(?,?,?,?,?,?)').run(id,FIXED,new Date(ms+120000).toISOString(),'{}',status,'hash');
  watch.release(lease);lease=watch.acquire(ms+200000);assert.equal(watch.alerts().find(a=>a.id==='uncertain').status,'unknown');
  assert.equal(watch.claimMail({token:lease,now:new Date(ms+200000).toISOString(),recipientHash:'hash',maxPerDay:4}),null);assert.equal(watch.alerts().find(a=>a.id==='stale').status,'expired');
 }finally{watch.release(lease);store.close();}
});
await testAsync('watch daily mail limit and changed preferences cannot release an older pending signal',async()=>{
 const store=new BettingDataStore(':memory:'),watch=new BettingWatchStore(store),ms=Date.parse(FIXED),lease=watch.acquire(ms),config={host:'smtp.example.com',port:465,user:'operator@example.com',from:'operator@example.com',to:'recipient@example.com'};
 const old=watchRecipientHash(config,{minProbability:.4}),current=watchRecipientHash(config,{minProbability:.8});assert.notEqual(old,current);
 try{
  const insert=store.database.prepare('INSERT INTO betting_watch_alerts(id,at,expires_at,payload,status,recipient_hash) VALUES(?,?,?,?,?,?)');
  insert.run('old',FIXED,new Date(ms+120000).toISOString(),'{}','pending',old);
  assert.equal(watch.claimMail({token:lease,now:FIXED,recipientHash:current,maxPerDay:4}),null);assert.equal(watch.alerts()[0].status,'expired');
  for(let i=0;i<4;i++)insert.run('sent'+i,FIXED,new Date(ms+120000).toISOString(),'{}','sent',current);
  insert.run('pending',FIXED,new Date(ms+120000).toISOString(),'{}','pending',current);
  assert.equal(watch.claimMail({token:lease,now:FIXED,recipientHash:current,maxPerDay:4}),null);
 }finally{watch.release(lease);store.close();}
});
summary();
