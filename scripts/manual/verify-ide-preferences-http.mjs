import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {createRequire} from 'node:module';
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
      assert.equal(live.changePreference(category,definition,value),true);
      records.push({category,key:definition.key,label:definition.label,value,controllerSave:'PENDING',httpReadback:'PENDING',restartReadback:'PENDING',runtimeEffect:'NOT_VERIFIED'});
    }
    assert.equal(await live.savePreferences(category),true,live._preferenceNotice.get(category));
    const observed=await expectJson(product,'GET','/api/settings',null,200);
    for(const record of records.filter(r=>r.category===category)){
      assert.equal(observed[record.key],record.value);record.controllerSave='PASS';record.httpReadback='PASS';
    }
  }
  assert.equal(calls.length,0,'saving ordinary settings must not launch inference');
  await stopProduct(product);product=null;product=await launch();
  const restored=await expectJson(product,'GET','/api/settings',null,200);
  for(const record of records){assert.equal(restored[record.key],record.value);record.restartReadback='PASS';}
  const roles=await expectJson(product,'GET','/api/system/models/role-settings',null,200);
  const chat=roles.roles.find(r=>r.role==='CHAT');
  const conversation=await expectJson(product,'POST','/api/conversations',{title:'Settings effect observation',mode:'chat'},201);
  await expectJson(product,'POST','/api/chat',{conversation_id:conversation.conversation.id,message:'Vysvětli kompozici.'},200);
  const last=calls.at(-1);
  const contextRecord=records.find(r=>r.key==='intentsmith.llm.contextWindow');
  contextRecord.runtimeEffect=last.options.num_ctx===contextRecord.value?'PASS':'NOT_APPLIED';
  const temperatureRecord=records.find(r=>r.key==='intentsmith.llm.temperature');
  temperatureRecord.runtimeEffect=last.options.temperature===temperatureRecord.value?'PASS':'NOT_APPLIED';
  const result={status:'ROUNDTRIP_PASS_EFFECT_COVERAGE_INCOMPLETE',scope:'OWNED_ACTUAL_HTTP_FRONTEND_CONTROLLERS_SQLITE_RESTART_CONTROLLED_PROVIDER',sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),records,roleContext:chat.contextWindowTokens,providerAnswerOptions:last.options,inferenceCalls:calls.length,completedAt:new Date().toISOString()};
  const output=new URL('../../.intentsmith-artifacts/ide-integration-20261009/ordinary-preferences.json',import.meta.url);
  await mkdir(new URL('./',output),{recursive:true,mode:0o700});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,fields:records.length,answerOptions:last.options,effectFindings:records.filter(r=>r.runtimeEffect==='NOT_APPLIED')},null,2));
} finally {
  live?.componentWillUnmount();
  if(product)await stopProduct(product);
  await new Promise(resolve=>provider.close(resolve));
}
