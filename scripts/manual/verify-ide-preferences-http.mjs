import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';
import {readChatMemoryPolicy} from '../../src/db/user-settings.js';
import {createOwnedJourneyRuntime,expectJson,startProduct,stopProduct} from '../../tests/helpers/chat-project-expertise-model-journey.js';
import {isolatedTestRuntime} from '../../tests/helpers/isolated-test-db.js';
const require=createRequire(import.meta.url);
const {LiveModel}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
const {CatalogStore}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/catalog-store');
const {SessionStore}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
const {AppearanceStore}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');
const {SETTINGS_FIELDS}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/settings-preferences');
const runtime=createOwnedJourneyRuntime(isolatedTestRuntime),model='fixture:1b',digest='a'.repeat(64),calls=[];
let product,live;
const provider=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:model,digest}]}));
  if(req.url==='/api/show')return res.end(JSON.stringify({model_info:{'fixture.context_length':32768}}));
  if(req.url!=='/api/chat')return res.writeHead(503).end('{}');
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks));calls.push(body);
  const classifier=body.messages.some(m=>m.role==='system'&&m.content.includes('Klasifikuj'));
  res.end(JSON.stringify({model,model_digest_sha256:digest,done:true,done_reason:'stop',message:{role:'assistant',content:classifier?JSON.stringify({intent:'CONVERSATIONAL',confidence:.99,requestedOperation:'none',responseScope:'conversation'}):'Controlled settings observation.'},eval_count:8,prompt_eval_count:40,eval_duration:1000000000}));
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const launch=()=>startProduct(runtime,`http://127.0.0.1:${provider.address().port}`,model,{productionAdminToken:randomBytes(32).toString('base64url')});
const records=[];
try {
  product=await launch();
  const backendUrl=()=>`http://127.0.0.1:${product.port}`;
  const fetchImpl=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'X-IntentSmith-Local-Capability':product.capability}});
  const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  const catalog=new CatalogStore({backendUrl,fetchImpl}),store=new SessionStore(storage),appearance=new AppearanceStore(storage);
  live=new LiveModel({catalog,store,appearance,workspace:{entry:()=>({tree:[],editor:null})},m2:{entry:()=>({})}});live.fetchImpl=fetchImpl;
  for(const [category,tabs] of Object.entries(SETTINGS_FIELDS)){
    await live.loadSettingsResource(category==='modely'?'modely:prefs':category,true);
    for(const definition of Object.values(tabs).flat()){
      const value=definition.type==='toggle'?!definition.defaultValue:
        definition.type==='select'?definition.options.find(x=>x!==definition.defaultValue):
        definition.type==='time'?'12:34':
        definition.type==='number'?Math.min(definition.max,definition.defaultValue+definition.step):
        definition.key.endsWith('ollamaUrl')?'http://127.0.0.1:12345':'Owned settings fixture';
      assert.equal(live.changePreference(category,definition,value),definition.supported);
      records.push({category,key:definition.key,label:definition.label,value:definition.supported?value:definition.defaultValue,
        support:definition.supported?'ACTIVE':'READ_ONLY_NO_RUNTIME_CONSUMER',controllerSave:definition.supported?'PENDING':'WRITE_REFUSED',
        httpReadback:definition.supported?'PENDING':'UNCHANGED',restartReadback:'PENDING',runtimeEffect:definition.supported?'PENDING':'UNSUPPORTED_LABELLED'});
    }
    const active=records.filter(r=>r.category===category&&r.support==='ACTIVE');
    assert.equal(await live.savePreferences(category),active.length>0,live._preferenceNotice.get(category));
    const observed=await expectJson(product,'GET','/api/settings',null,200);
    for(const record of active){assert.equal(observed[record.key],record.value);record.controllerSave='PASS';record.httpReadback='PASS';}
    for(const record of records.filter(r=>r.category===category&&r.support!=='ACTIVE'))assert.equal(observed[record.key],undefined);
  }
  assert.equal(calls.length,0,'saving ordinary settings must not launch inference');
  await stopProduct(product);product=null;product=await launch();
  const restored=await expectJson(product,'GET','/api/settings',null,200);
  for(const record of records){
    assert.equal(restored[record.key],record.support==='ACTIVE'?record.value:undefined);
    record.restartReadback=record.support==='ACTIVE'?'PASS':'UNCHANGED';
  }
  const policyDb=new Database(runtime.database,{readonly:true});
  let memoryPolicy;try{memoryPolicy=readChatMemoryPolicy(policyDb);}finally{policyDb.close();}
  for(const [key,property] of [['ltmEnabled','ltm'],['learningEnabled','learning'],['feedbackDetection','feedback'],['patternTracking','patterns']]){
    assert.equal(memoryPolicy[property],false);
    records.find(r=>r.key==='intentsmith.memory.'+key).runtimeEffect='MEMORY_POLICY_DISABLED_CONFIRMED';
  }
  const result={status:'ACTIVE_PREFERENCES_HTTP_RESTART_PASS_INACTIVE_WRITES_REFUSED',scope:'OWNED_ACTUAL_HTTP_FRONTEND_CONTROLLERS_SQLITE_RESTART',
    sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),records,memoryPolicy,
    effectRegressionPrograms:['chat-memory-privacy','chat-privacy-http'],inferenceCalls:calls.length,completedAt:new Date().toISOString()};
  const output=new URL('../../.intentsmith-artifacts/ide-integration-20261009/ordinary-preferences.json',import.meta.url);
  await mkdir(new URL('./',output),{recursive:true,mode:0o700});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,fields:records.length,active:records.filter(r=>r.support==='ACTIVE').length,readOnly:records.filter(r=>r.support!=='ACTIVE').length,memoryPolicy},null,2));
} finally {
  live?.componentWillUnmount();
  if(product)await stopProduct(product);
  await new Promise(resolve=>provider.close(resolve));
}
