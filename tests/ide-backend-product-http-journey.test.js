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
    else if(req.url==='/api/show')res.end(JSON.stringify({model_info:{'fixture.context_length':4096}}));
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
  const pair={revision:0,model,digestSha256:digest,contextWindowTokens:2048,maxOutputTokens:256};
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
  await stopProduct(product);product=null;product=await launch();
  assert.equal((await expectJson(product,'GET','/api/system/storage/paths',null,200)).projects,projects);
  assert.equal((await expectJson(product,'GET','/api/projects/defaults',null,200)).defaultDir,projects);
  const restored=(await expectJson(product,'GET','/api/system/models/role-settings',null,200)).roles.find(r=>r.role==='CHAT');
  assert.deepEqual(restored.settings,{contextWindowTokens:2048,maxOutputTokens:256});
  await expectJson(product,'PUT','/api/system/models/role-settings/CHAT',pair,409);
  assert.equal((await expectJson(product,'GET','/api/accounts',null,200)).accounts[0].credentialConfigured,false);
  assert.equal((await expectJson(product,'GET','/api/system/models/hunt/profiles',null,200)).profiles[0].name,'Nightly');
  const backups=(await expectJson(product,'GET','/api/system/backups',null,200)).backups;
  assert(backups.some(b=>b.name===backup.name&&b.note==='Product HTTP fixture'));
  assert.equal(modelCalls,0,'management and restart must not invoke inference');
});
