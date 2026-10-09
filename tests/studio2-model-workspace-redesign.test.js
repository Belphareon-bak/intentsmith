// Model workspace API contract regression tests.
// Ordinary node:test only: no qualification report writers or generated-view files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {ModelWorkspaceRedesign:Workspace,matrixRows,scoreCell,profileBody,validJobPins}=require(path.join(projectRoot,'intentsmith-ide/extensions/intentsmith-studio2/lib/browser/model-workspace-redesign.js'));
const D='a'.repeat(64),E='b'.repeat(64),S='c'.repeat(64),copy=v=>JSON.parse(JSON.stringify(v));
const backend='https://own-adapter-fixture.invalid';
function workspace(){return new Workspace({backendUrl:()=>backend,fetchImpl:()=>{throw Error('Unexpected external fetch');},confirmAction:()=>true});}
function extra(w,key,data){w.extra.set(key,{status:'ready',data,backend:w.currentBackend()});}
const draft=()=>({id:'own_profile',revision:0,name:'Own profile',kind:'evaluation',roles:['CHAT'],models:['model:tag'],limit:1,enabled:false,modelsPath:'',scheduleType:'manual',at:'',intervalMinutes:60,time:'',timezone:'Europe/Prague',weekDays:[],backend});

test('flat evaluation matrix keeps exact artifact identities and missing/awaiting scores last',()=>{
 const roles={CHAT:{artifacts:[{model:'same',digestSha256:D,status:'COMPLETE',score:.42},{model:'same',digestSha256:E,status:'AWAITING_REVIEW',score:.99}]},CODE:{artifacts:[{model:'same',digestSha256:E,status:'COMPLETE',score:.8}]}};
 assert.equal(matrixRows(roles,'CHAT','asc').length,2);assert.equal(matrixRows(roles,'CHAT','asc')[0].digest,D);assert.equal(matrixRows(roles,'CODE','desc')[0].digest,E);
 assert.equal(scoreCell(roles.CHAT.artifacts[1]).text,'—');assert.equal(scoreCell(roles.CHAT.artifacts[0]).cls,'mw-score-low');
});

test('optional management endpoint failure leaves supported overview usable',async()=>{
 const w=workspace();w.request=async route=>{if(route.endsWith('/overview'))return{models:[]};if(route.endsWith('/bindings'))return{bindings:{}};if(route.endsWith('/evaluations'))return{roles:{},history:[]};if(route.endsWith('/models'))return{models:[]};throw Error('HTTP 404');};
 assert.equal(await w.load('overview'),true);await w.loadExtra('settings');assert.equal(w.resources.get('overview').status,'ready');assert.equal(w.extra.get('settings').status,'error');assert.equal(w.vm().redesign.isOverview,true);w.destroy();
});

test('public score sorting uses a single comparable protocol instead of mixed benchmark scores',()=>{
 const w=workspace(),signal=(metric,score)=>({role:'CHAT',metric,score,sourceUrl:'https://example.test/'+metric,minimum:0,maximum:100,measuredAt:'2026-10-01T00:00:00.000Z',identityScope:'MODEL_REFERENCE_NOT_LOCAL_DIGEST'});
 w.resources.set('candidates',{status:'ready',data:[{candidates:[{name:'a:q4',family:'same-family',fitsVram:true,installed:false,eligibleRoles:['CHAT'],externalSignals:[signal('one',42)]},{name:'b:q8',family:'same-family',fitsVram:true,installed:false,eligibleRoles:['CHAT'],externalSignals:[signal('two',99)]}]},{downloads:[]}]});
 w.catalogFilter.sort='score';const view=w.catalogVM();assert.equal(view.rows[0].name,'a:q4');assert.equal(view.rows[1].score,'—');assert.equal(view.hasVariants,false);assert.equal(view.selected.tests[0].disabled,true);w.destroy();
});

test('role parameters repair a current STALE binding with exact artifact CAS and readback',async()=>{
 const w=workspace();let row={role:'CHAT',model:'model:tag',digestSha256:D,revision:3,status:'STALE',settings:{contextWindowTokens:4096,maxOutputTokens:null},verifiedHardwareMaximum:null,outputAuthority:'CALL_SITE_AND_AUTH_TOKEN_CEILING'},writes=0;
 extra(w,'settings',{roles:[copy(row)]});assert.equal(w.editRoleRuntime('CHAT'),true);w.setRoleRuntime('maxOutputTokens',{target:{value:'1024'}});
 w.request=async(route,options={})=>{if(options.method==='PUT'){writes++;const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['revision','model','digestSha256','contextWindowTokens','maxOutputTokens'].sort());assert.equal(body.digestSha256,D);assert.equal(body.revision,3);row={...row,revision:4,status:'CONFIGURED',settings:{contextWindowTokens:body.contextWindowTokens,maxOutputTokens:body.maxOutputTokens}};return copy(row);}return{roles:[copy(row)]};};
 assert.equal(await w.saveRoleRuntime(),true);assert.equal(writes,1);assert.equal(w.roleRuntimeDraft,null);w.destroy();
});

test('changed role artifact or backend cannot authorize a write from an older editor',async()=>{
 const w=workspace(),row={role:'CHAT',model:'model:tag',digestSha256:D,revision:0,status:'DEFAULT',settings:{contextWindowTokens:4096,maxOutputTokens:null}};
 let endpoint=backend,requests=0,writes=0;w.backendUrl=()=>endpoint;extra(w,'settings',{roles:[copy(row)]});w.editRoleRuntime('CHAT');w.setRoleRuntime('maxOutputTokens',{target:{value:'1024'}});
 w.request=async(route,o={})=>{requests++;if(o.method==='PUT')writes++;return{roles:[{...row,digestSha256:E}]};};endpoint='https://different.invalid';assert.equal(await w.saveRoleRuntime(),false);assert.equal(requests,0);
 endpoint=backend;assert.equal(await w.saveRoleRuntime(),false);assert.equal(writes,0);assert.ok(w.roleRuntimeDraft);w.destroy();
});

test('ambiguous profile readback does not resend the mutation',async()=>{
 const w=workspace();w.profileDraft=draft();let writes=0;
 w.request=async(route,o={})=>{if(o.method==='PUT'){writes++;return{...JSON.parse(o.body),id:w.profileDraft.id,revision:1};}return{profiles:[],capabilities:{activation:'SEPARATE_EXACT_ARTIFACT_ACCEPTANCE'}};};
 assert.equal(await w.saveProfile(),false);assert.equal(writes,1);assert.ok(w.notice.includes('Neopakujte'));w.destroy();
});

test('queued profile captures exact model/suite pins and immutable profile revision',async()=>{
 const w=workspace(),profile={...profileBody(draft()),id:'own_profile',revision:1};extra(w,'profiles',{profiles:[copy(profile)]});let jobs=[],writes=0;
 w.queueAt='2099-01-01T00:00:00.000Z';
 w.request=async(route,o={})=>{if(o.method==='POST'){writes++;const body=JSON.parse(o.body);jobs=[{id:'own_job',revision:1,profileId:profile.id,profileRevision:1,profile:copy(profile),at:body.at,state:'QUEUED',pins:[{model:'model:tag',digestSha256:D,roles:[{role:'CHAT',suiteContractSha256:S}]}]}];return copy(jobs[0]);}return route.endsWith('/jobs')?{jobs:copy(jobs)}:{profiles:[copy(profile)],capabilities:{activation:'SEPARATE_EXACT_ARTIFACT_ACCEPTANCE'}};};
 assert.equal(await w.queueProfile(profile.id),true);assert.equal(writes,1);profile.name='Changed later';assert.notEqual(jobs[0].profile.name,profile.name);
 assert.equal(validJobPins(jobs[0].profile,{pins:[{model:'wrong-tag',digestSha256:D,roles:[{role:'CHAT',suiteContractSha256:S}]}]}),false);w.destroy();
});

test('job leaving QUEUED state between view and confirmation is not cancelled',async()=>{
 const w=workspace();extra(w,'jobs',{jobs:[{id:'own_job',revision:1,state:'QUEUED'}]});let deletes=0;
 w.request=async(route,o={})=>{if(o.method==='DELETE')deletes++;return{jobs:[{id:'own_job',revision:2,state:'RUNNING'}]};};
 assert.equal(await w.cancelJob('own_job'),false);assert.equal(deletes,0);w.destroy();
});

test('invalid role-settings are an error state; valid unavailable bindings remain renderable', async () => {
 const w=workspace();
 for (const roles of [[null], [{role:'CHAT',revision:0,status:'DEFAULT'}], [{role:'OTHER',revision:0,status:'BINDING_UNAVAILABLE'}]]) {
  w.request=async()=>({roles}); assert.equal(await w.loadExtra('settings',true),false);
  assert.equal(w.extra.get('settings').status,'error'); assert.doesNotThrow(()=>w.vm());
 }
 w.request=async()=>({roles:[{role:'CHAT',revision:0,status:'BINDING_UNAVAILABLE'}]});
 assert.equal(await w.loadExtra('settings',true),true); assert.doesNotThrow(()=>w.vm());
 assert.equal(w.vm().redesign.settings[0].editDisabled,true); w.destroy();
});

test('profile editor locks every draft callback and opening action while a write is pending', async () => {
 const w=workspace();w.profileDraft=draft();let rows=[],release;
 const wait=new Promise(resolve=>{release=resolve;});
 w.request=async(route,o={})=>{if(o.method==='PUT'){await wait;rows=[{...JSON.parse(o.body),id:'own_profile',revision:1}];return copy(rows[0]);}return{profiles:copy(rows),capabilities:{activation:'SEPARATE_EXACT_ARTIFACT_ACCEPTANCE'}};};
 const saving=w.saveProfile();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(w.busy,true);const before=copy(w.profileDraft),v=w.profileVM();assert.equal(v.draft.disabled,true);
 v.draft.setName({target:{value:'unsubmitted'}});v.draft.setKind({target:{value:'hunt'}});
 v.draft.setModelA({target:{value:'other'}});v.draft.roleOptions[0].change({target:{checked:true}});
 v.draft.dayOptions[0].change({target:{checked:true}});v.close();v.new();
 assert.deepEqual(w.profileDraft,before);assert.equal(w.editProfile('own_profile'),false);
 release();assert.equal(await saving,true);assert.equal(w.profileDraft.name,before.name);w.destroy();
});

test('historical matrix cells cannot test another digest selected only by the same tag', async () => {
 const w=workspace();w.resources.set('evaluations',{status:'ready',data:[{roles:{CHAT:{measurementReady:true,suiteContractSha256:S,artifacts:[{model:'same',digestSha256:D,status:'COMPLETE',score:.5},{model:'same',digestSha256:E,status:'COMPLETE',score:.9}]}},history:[]}]});
 const historical=w.matrixVM().rows.find(r=>r.digest===E).cells.find(c=>c.role==='CHAT');
 assert.equal(historical.testDisabled,true);assert.equal(await historical.test(),false);w.destroy();
});

test('catalog prepares a selectable evaluation profile without mutating or starting GPU', () => {
 const w=workspace();w.load=async()=>true;w.loadExtra=async()=>true;
 w.resources.set('candidates',{status:'ready',data:[{candidates:[{name:'download:tag',installed:false,eligibleRoles:['CHAT']},{name:'installed:tag',installed:true,eligibleRoles:['CHAT','CODE']}]},{downloads:[]}]});
 assert.equal(w.prepareModelTests('download:tag'),false);assert.equal(w.profileDraft,null);
 assert.equal(w.prepareModelTests('installed:tag'),true);assert.equal(w.huntTab,'profiles');
 assert.equal(w.profileDraft.kind,'evaluation');assert.deepEqual(w.profileDraft.models,['installed:tag']);
 assert.deepEqual(w.profileDraft.roles,['CHAT','CODE']);w.destroy();
});
