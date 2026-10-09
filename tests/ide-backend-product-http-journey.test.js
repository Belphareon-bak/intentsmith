import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {createOwnedJourneyRuntime,expectJson,startProduct,stopProduct} from './helpers/chat-project-expertise-model-journey.js';
import {isolatedTestRuntime} from './helpers/isolated-test-db.js';

test('IDE management uses the actual authenticated product and durable restart', {timeout:180000}, async t=>{
  const runtime=createOwnedJourneyRuntime(isolatedTestRuntime),model='fixture:1b',digest='a'.repeat(64);
  let modelCalls=0,product=null;
  const provider=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/tags')res.end(JSON.stringify({models:[{name:model,digest}]}));
    else if(req.url==='/api/show')res.end(JSON.stringify({model_info:{'fixture.context_length':16384}}));
    else {modelCalls++;res.writeHead(503).end(JSON.stringify({error:'Inference is outside this journey'}));}
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{try{if(product)await stopProduct(product);}finally{await new Promise(resolve=>provider.close(resolve));}});
  const launch=()=>startProduct(runtime,`http://127.0.0.1:${provider.address().port}`,model,
    {productionAdminToken:randomBytes(32).toString('base64url')});
  product=await launch();
  const unauthorized=await fetch(`http://127.0.0.1:${product.port}/api/accounts`);
  assert.equal(unauthorized.status,401);
  const projects=path.join(runtime.projects,'new-default');mkdirSync(projects);
  await expectJson(product,'PUT','/api/system/storage/paths',{revision:0,projects},200);
  const roles=await expectJson(product,'GET','/api/system/models/role-settings',null,200);
  const chat=roles.roles.find(role=>role.role==='CHAT');assert.equal(chat.digestSha256,digest);
  const pair={revision:0,model,digestSha256:digest,contextWindowTokens:8192,maxOutputTokens:256};
  await expectJson(product,'PUT','/api/system/models/role-settings/CHAT',pair,200);
  await expectJson(product,'PUT','/api/accounts/telegram',{revision:0,name:'Telegram',provider:'telegram',
    credentialEnv:'INTENTSMITH_TELEGRAM_PRODUCT_FIXTURE',recipient:'123456',events:['worker'],enabled:false},200);
  await expectJson(product,'POST','/api/accounts/telegram/test',{revision:1,confirm:true},409);
  const profile=await expectJson(product,'PUT','/api/system/models/hunt/profiles/nightly',{
    revision:0,name:'Nightly',kind:'hunt',roles:['CHAT'],models:[],limit:1,modelsPath:null,
    enabled:false,schedule:{type:'daily',time:'22:00',timezone:'Europe/Prague'}},200);
  assert.equal(profile.revision,1);
  const backup=await expectJson(product,'POST','/api/system/backup',{sections:['database'],note:'Product HTTP fixture'},200);
  assert.equal(backup.backup.note,'Product HTTP fixture');
  const preview=await expectJson(product,'POST','/api/system/backups/retention-preview',{maxDaily:1,maxWeekly:1},200);
  assert.equal(preview.deletesNothing,true);assert(preview.protected.includes(backup.name));
  const afterPreview=(await expectJson(product,'GET','/api/system/backups',null,200)).backups;
  assert(afterPreview.some(b=>b.name===backup.name));
  await stopProduct(product);product=null;product=await launch();
  assert.equal((await expectJson(product,'GET','/api/system/storage/paths',null,200)).projects,projects);
  assert.equal((await expectJson(product,'GET','/api/projects/defaults',null,200)).defaultDir,projects);
  const restored=(await expectJson(product,'GET','/api/system/models/role-settings',null,200)).roles.find(r=>r.role==='CHAT');
  assert.deepEqual(restored.settings,{contextWindowTokens:8192,maxOutputTokens:256});
  await expectJson(product,'PUT','/api/system/models/role-settings/CHAT',pair,409);
  assert.equal((await expectJson(product,'GET','/api/accounts',null,200)).accounts[0].credentialConfigured,false);
  assert.equal((await expectJson(product,'GET','/api/system/models/hunt/profiles',null,200)).profiles[0].name,'Nightly');
  const backups=(await expectJson(product,'GET','/api/system/backups',null,200)).backups;
  assert(backups.some(b=>b.name===backup.name&&b.note==='Product HTTP fixture'));
  assert.equal(modelCalls,0,'management and restart must not invoke inference');
});

test('actual Studio controllers save CHAT settings then chat, recover validation and create/edit a custom worker', {timeout:180000},async t=>{
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
  const {ModelWorkspaceRedesign}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/model-workspace-redesign');
  const {IdeSettingsManagement}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/ide-settings-management');
  const {LiveModel}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
  const {CatalogStore}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/catalog-store');
  const {SessionStore}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
  const {AppearanceStore}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');
  const {readFileSync,writeFileSync,chmodSync}=await import('node:fs');
  const runtime=createOwnedJourneyRuntime(isolatedTestRuntime),model='fixture:1b',digest='a'.repeat(64),calls=[];
  let product;
  const provider=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    res.setHeader('content-type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:model,digest}]}));
    if(req.url==='/api/show')return res.end(JSON.stringify({model_info:{'fixture.context_length':16384}}));
    if(req.url!=='/api/chat')return res.writeHead(503).end('{}');
    const body=JSON.parse(Buffer.concat(chunks));calls.push(body);
    const classifier=body.messages?.some(m=>m.role==='system'&&m.content.includes('Klasifikuj'));
    const content=classifier?JSON.stringify({intent:'CONVERSATIONAL',confidence:.99,requestedOperation:'none',responseScope:'conversation'}):'Kontext a limit odpovědi jsou ověřené.';
    res.end(JSON.stringify({model,model_digest_sha256:digest,done:true,done_reason:'stop',message:{role:'assistant',content},prompt_eval_count:40,eval_count:8,eval_duration:1000000000}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{try{if(product)await stopProduct(product);}finally{await new Promise(resolve=>provider.close(resolve));}});
  product=await startProduct(runtime,`http://127.0.0.1:${provider.address().port}`,model,{enableAgents:true,productionAdminToken:randomBytes(32).toString('base64url')});
  const backendUrl=()=>`http://127.0.0.1:${product.port}`;
  const httpRequests=[];
  const fetchImpl=(url,options={})=>{httpRequests.push(new URL(url).pathname);return fetch(url,{...options,headers:{...options.headers,'X-IntentSmith-Local-Capability':product.capability}});};
  const models=new ModelWorkspaceRedesign({backendUrl,fetchImpl,onChange(){},confirmAction:()=>true});t.after(()=>models.destroy());
  await models.loadExtra('settings');models.editRoleRuntime('CHAT');models.roleRuntimeDraft.contextWindowTokens=2048;models.roleRuntimeDraft.maxOutputTokens=32;
  assert.equal(await models.saveRoleRuntime(),false);assert.equal(calls.length,0);
  await expectJson(product,'PUT','/api/system/models/role-settings/CHAT',{revision:0,model,digestSha256:digest,contextWindowTokens:2048,maxOutputTokens:32},422);
  models.roleRuntimeDraft.contextWindowTokens=8192;assert.equal(await models.saveRoleRuntime(),true,models.notice);
  const conversation=await expectJson(product,'POST','/api/conversations',{title:'Role settings integration',mode:'chat'},201);
  const reply=await expectJson(product,'POST','/api/chat',{conversation_id:conversation.conversation.id,message:'Vysvětli tento podklad: '+('podklad '.repeat(250))},200);
  assert.equal(reply.response,'Kontext a limit odpovědi jsou ověřené.');
  assert(calls.some(c=>c.messages.some(m=>m.content.includes('Klasifikuj'))&&c.options.num_predict===256),'classification must retain JSON budget');
  assert.equal(calls.at(-1).options.num_predict,32);assert(calls.every(c=>c.options.num_ctx===8192));
  const tooLong=await expectJson(product,'POST','/api/conversations',{title:'Oversized request',mode:'chat'},201);
  const beforeRejected=calls.length;
  const rejected=await expectJson(product,'POST','/api/chat',{conversation_id:tooLong.conversation.id,message:'x'.repeat(30000)},413);
  assert.equal(rejected.code,'CHAT_CONTEXT_CAPACITY_EXCEEDED');assert.match(rejected.error,/kontext|okno CHAT/);assert.equal(calls.length,beforeRejected);
  const recorded=await expectJson(product,'GET','/api/conversations/'+tooLong.conversation.id+'/messages',null,200);
  assert(!recorded.messages.some(m=>m.role==='assistant'));
  const settings=new IdeSettingsManagement({backendUrl,fetchImpl,confirmAction:()=>true});t.after(()=>settings.destroy());
  await settings.load('git');settings.openSsh();
  const editor=settings.editors.get('git');Object.assign(editor.draft,{name:'My SSH',host:'github.com',user:'git',port:22,identityFile:path.join(runtime.home,'id'),knownHostsFile:path.join(runtime.home,'known_hosts')});
  assert.equal(await settings.save('git'),false);assert.equal(editor.blocked,false);assert.equal(editor.draft.name,'My SSH');
  writeFileSync(editor.draft.identityFile,'owned fixture key');chmodSync(editor.draft.identityFile,0o600);writeFileSync(editor.draft.knownHostsFile,'owned fixture known hosts');chmodSync(editor.draft.knownHostsFile,0o600);
  assert.equal(await settings.save('git'),true,settings.notices.get('git'));
  const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  const catalog=new CatalogStore({backendUrl,fetchImpl}),store=new SessionStore(storage),appearance=new AppearanceStore(storage);
  const live=new LiveModel({catalog,store,appearance,workspace:{entry:()=>({tree:[],editor:null})},m2:{entry:()=>({})}});live.fetchImpl=fetchImpl;t.after(()=>live.componentWillUnmount());
  const project=await expectJson(product,'POST','/api/projects',{name:'Owned IDE fixture',type:'general'},201);
  live.setState(live.pSelect(live.st(),'workers','__new__'));
  await live.loadWorkerWizard();
  live.setState({workerTemplateName:'Česká kontrola',workerQuery:'TODO FIXME',workerCondition:'issues',workerThreshold:'2',workerSchedule:'interval',workerInterval:'1h'});
  assert.equal(await live.saveWorkerTemplateForm(live.st()),true,live.workerStatus().error);
  const template=JSON.parse(live.st().workerTemplate);
  assert.match(template.id,/^ceska-kontrola-/);assert.equal(template.payload.definition.conditions[0].value,2);
  assert.equal(template.payload.definition.schedule.value,'1h');assert.equal(template.payload.definition.actions[0].config.use_llm,false);
  live.setState({workerStep:1,workerProject:String(project.project.id),workerInstanceId:'studio-owned'});
  assert.equal(await live.previewWorker(live.st()),true,live.workerStatus().error);assert.equal(await live.submitWorker(live.st()),true,live.workerStatus().error);
  const installed=await expectJson(product,'GET','/api/agent-extensions/instances/studio-owned/config',null,200);assert.equal(installed.enabled,false);
  const immediateState=live.setState,queuedState=[];live.setState=patch=>queuedState.push(patch);
  try { assert.equal(await live.openWorkerEdit({id:'studio-owned'}),true,live.workerStatus().error); }
  finally {live.setState=immediateState;for(const patch of queuedState)live.setState(patch);}
  assert.equal(live.st().workerInstanceId,'studio-owned');assert.equal(live.st().workerEditing,true);
  live.setState({workerStep:1,workerName:'Edited in Studio'});assert.equal(await live.previewWorker(live.st()),true,live.workerStatus().error);
  assert.equal(await live.submitWorker(live.st()),true,live.workerStatus().error);
  const edited=await expectJson(product,'GET','/api/agent-extensions/instances/studio-owned/config',null,200);assert.equal(edited.name,'Edited in Studio');assert.equal(edited.enabled,false);
  assert(!httpRequests.includes('/api/agents/__new__'),'creation sentinel must not become a backend instance request');
  const inferenceCount=calls.length;
  models.openExternalReference();Object.assign(models.externalDraft,{model,role:'CHAT',metric:'controlled reference',score:'75',minimum:'0',maximum:'100',sourceUrl:'https://example.invalid/reference',measuredAt:'2026-10-08T12:00:00.000Z',referenceModel:'Fixture public'});
  assert.equal(await models.saveExternalReference(),true,models.notice);assert.equal(calls.length,inferenceCount);
});
