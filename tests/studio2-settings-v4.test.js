import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {SettingsV4,CATEGORIES}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/settings-v4/controller');
const pages=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/settings-v4/pages-settings');
const copy=v=>structuredClone(v), D='a'.repeat(64);
function fixture(mode='ok') {
  let identity={id:'default',revision:0,displayName:'Local',email:'',description:''}, accounts=[],writes=[],callback;
  const c=new SettingsV4({backendUrl:()=> 'http://fixture.invalid',fetchImpl:async(url,o)=>{
    const p=new URL(url).pathname;
    const response=(status,body)=>({status,ok:status<400,json:async()=>copy(body)});
    if(o.method==='GET'&&p==='/api/accounts')return response(200,{profile:identity,accounts,supportedEvents:['worker','lifecycle']});
    if(o.method==='PUT'&&p.startsWith('/api/accounts/')){
      const body=JSON.parse(o.body);writes.push({p,body});
      if(mode==='invalid'){mode='ok';return response(422,{code:'IDE_RECIPIENT_INVALID'});}
      const saved={...body,id:p.split('/').at(-1),revision:body.revision+1,credentialConfigured:true,credentialPersistence:'environment_only',connectionStatus:'NOT_VERIFIED'};
      accounts.push(saved);
      if(mode==='uncertain')return response(503,{code:'IDE_OPERATION_FAILED'});
      return response(200,saved);
    }
    throw Error('Unexpected fixture request: '+o.method+' '+p);
  }});
  c.toast=()=>{};c.render=()=>{};
  c.H.modal=(_title,_html,_submit,fn)=>{callback=fn;c.modals.push({id:'fixture-modal'});};
  const form={querySelector:()=>({textContent:''})};
  const values={'acc-a-name':'Telegram','acc-a-recipient':'123456','acc-a-env':'INTENTSMITH_TELEGRAM_FIXTURE','acc-a-enabled':true,'acc-a-event-worker':true};
  return {c,writes,accounts,form,values,get callback(){return callback;}};
}
async function submit(f) {
  const prior=globalThis.FormData;
  globalThis.FormData=class{get(k){return f.values[k];}has(k){return !!f.values[k];}};
  try{return await f.callback(f.form);}finally{globalThis.FormData=prior;}
}
test('all V4 settings and model pages render unavailable states without fabricated scores',()=>{
  const c=new SettingsV4({backendUrl:()=>'',fetchImpl:async()=>{throw Error('offline')}});
  for(const [,page]of CATEGORIES){c.s.page=page;assert.doesNotThrow(()=>c.view());}
  c.s.page='models';
  for(const tab of ['overview','roles','inventory','evaluations','telemetry','policy']){c.s.modelTab=tab;c.mw.tab=tab;assert.doesNotThrow(()=>c.view());}
  c.s.modelTab='hunt';
  for(const tab of ['overview','catalog','profiles','history']){c.s.huntTab=tab;c.mw.huntTab=tab;assert.doesNotThrow(()=>c.view());}
  c.mw.runDetail={status:'loading'};assert.match(c.view().html,/Načítám odpovědi/);
  c.mw.runDetail={status:'error',error:'Unavailable'};assert.match(c.view().html,/Unavailable/);c.destroy();
});
test('HTTP 503 after a committed account create blocks a second PUT and preserves the identity',async()=>{
  const f=fixture('uncertain');await f.c.sm.load('ucet');
  pages.act(f.c,'sv4-account-new',{dataset:{provider:'telegram'}});
  assert.equal(await submit(f),false);const ed=f.c.sm.editors.get('ucet');
  assert.equal(ed.blocked,true);assert.equal(f.accounts.length,1);
  assert.equal(await submit(f),false);assert.equal(f.writes.length,1);assert.equal(f.c.sm.editors.get('ucet'),ed);
  assert.equal(ed.draft.id,f.accounts[0].id);f.c.destroy();
});
test('HTTP 422 permits correction in the same account editor with the same generated ID',async()=>{
  const f=fixture('invalid');await f.c.sm.load('ucet');pages.act(f.c,'sv4-account-new',{dataset:{provider:'telegram'}});
  assert.equal(await submit(f),false);const ed=f.c.sm.editors.get('ucet'),id=ed.draft.id;
  assert.equal(ed.blocked,false);f.values['acc-a-name']='Opravený název';assert.equal(await submit(f),true);
  assert.equal(f.writes.length,2);assert.equal(f.writes[0].p,f.writes[1].p);assert.equal(f.accounts.length,1);
  assert.equal(f.accounts[0].id,id);assert.equal(f.accounts[0].name,'Opravený název');f.c.destroy();
});
test('configured credentials and SSH references do not claim verified external connection',()=>{
  const f=fixture(),c=f.c;c.s.page='account';
  c.sm.resources.set('ucet',{status:'ready',data:{profile:{displayName:'<img src=x onerror=alert(1)>',email:'',description:'',revision:0},accounts:[{id:'t',name:'T',provider:'telegram',recipient:'123456',enabled:true,credentialConfigured:true,events:['worker'],connectionStatus:'NOT_VERIFIED'}]}});
  c.sm.resources.set('git',{status:'ready',data:{profiles:[{id:'s',host:'github.com',user:'git',port:22}],repositories:[]}});
  const html=c.view().html;assert.match(html,/Nastaveno · doručení neověřeno/);assert.match(html,/Nastaveno · SSH neověřeno/);
  assert(!html.includes('<img'));assert.match(html,/&lt;img/);c.destroy();
});
test('catalog filter excludes incompatible roles and searches verified quantization metadata',()=>{
  const f=fixture(),w=f.c.mw;
  w.resources.set('candidates',{status:'ready',data:[{candidates:[{name:'code:q4',family:'Code',quantization:'Q4_K_M',fitsVram:true,installed:false,eligibleRoles:['CODE']},{name:'chat:q8',family:'Chat',quantization:'Q8_0',fitsVram:true,installed:false,eligibleRoles:['CHAT']}]},{downloads:[]}]});
  assert.deepEqual(w.catalogVM().rows.map(r=>r.name),['chat:q8']);w.catalogFilter={...w.catalogFilter,role:'CODE',search:'Q4_K'};
  assert.deepEqual(w.catalogVM().rows.map(r=>r.name),['code:q4']);
  w.catalogFilter={...w.catalogFilter,search:''};w.catalogVM().setRole({target:{value:''}});
  assert.deepEqual(w.catalogVM().rows.map(r=>r.name),['chat:q8','code:q4']);
  w.resources.get('candidates').data[0].candidates[0].fitsVram=null;
  w.resources.get('candidates').data[0].candidates[0].vramMb=6000;
  assert.match(w.catalogVM().unknownVram,/bez ověřené VRAM/);
  w.catalogFilter={...w.catalogFilter,fits:false};assert.equal(w.catalogVM().rows.length,2);f.c.destroy();
});
test('matrix keeps pending and old-digest evidence distinct and renders a genuine complete score',()=>{
  const f=fixture(),c=f.c;c.s.page='models';c.s.modelTab='evaluations';c.mw.tab='evaluations';
  c.mw.resources.set('evaluations',{status:'ready',data:[{roles:{CHAT:{artifacts:[{model:'chat',digestSha256:D,status:'AWAITING_REVIEW'},{model:'chat',digestSha256:'b'.repeat(64),status:'STALE'}]},CODE:{artifacts:[{model:'code',digestSha256:D,status:'COMPLETE',score:.92}]}},history:[]}]});
  const html=c.view().html;assert.match(html,/Čeká na posouzení/);assert.match(html,/Jiný artefakt/);assert.match(html,/92 %/);assert.match(html,/mw-score-high/);assert(!html.includes('0 %</strong>'));c.destroy();
});

test('read-only reconciliation preserves a blocked account ID and explicitly closes the editor without another PUT',async()=>{
  const f=fixture('uncertain');await f.c.sm.load('ucet');pages.act(f.c,'sv4-account-new',{dataset:{provider:'telegram'}});await submit(f);
  const id=f.c.sm.editors.get('ucet').draft.id;
  let resolve;f.c.modal=(_title,html,_label,fn)=>{assert(html.includes(id));assert(html.includes('Současný stav'));resolve=fn;};
  f.c.clearDrafts=()=>{};f.c.closeAllModals=()=>{};
  pages.act(f.c,'sv4-sm-compare',{dataset:{category:'ucet'}});await new Promise(r=>setImmediate(r));assert(resolve);
  assert.equal(f.writes.length,1);resolve();assert.equal(f.writes.length,1);assert.equal(f.c.sm.editors.has('ucet'),false);assert.equal(f.accounts[0].id,id);f.c.destroy();
});
test('base model cache reloads after backend switch and rejects a result arriving from the old backend',async()=>{
  const {ModelWorkspace}=require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/model-workspace');
  let backend='http://old.invalid',release,calls=0;
  const w=new ModelWorkspace({backendUrl:()=>backend,fetchImpl:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {ok:true,json:async()=>({models:[]})};}});
  const load=w.load('overview');backend='http://new.invalid';release();assert.equal(await load,false);
  assert.equal(await w.load('overview'),true);assert.equal(calls,2);assert.equal(w.resources.get('overview').backend,backend);w.destroy();
});
test('V4 catalog preparation copies planning defaults and only selected role suites into a new disabled draft',async()=>{
  const f=fixture(),c=f.c,w=c.mw;c.s.page='models';c.s.modelTab='hunt';c.s.huntTab='catalog';w.tab='candidates';w.catalogFilter={...w.catalogFilter,availability:'all'};
  w.resources.set('candidates',{status:'ready',data:[{candidates:[{name:'chat:q4',fitsVram:true,installed:true,eligibleRoles:['CHAT','CODE']}]},{downloads:[]}]});
  w.extra.set('profiles',{status:'ready',backend:'http://fixture.invalid',data:{profiles:[{id:'weekly',name:'Týdenní',roles:['CHAT'],models:[],kind:'hunt',revision:1,enabled:false,limit:2,schedule:{type:'weekly',time:'21:15',timezone:'Europe/Prague',weekDays:[1]}}]}});
  c.s.catalogProfile='weekly';c.s.catalogSuites={'chat:q4':['CHAT']};w.load=async()=>true;w.loadExtra=async()=>true;c.load=async()=>true;
  const html=c.view().html,id=html.match(/data-action="([^"]+)"[^>]*>Připravit testy vybraných sad</)[1];c.handle(id,{dataset:{}},{});await new Promise(r=>setImmediate(r));
  assert.deepEqual(w.profileDraft.roles,['CHAT']);assert.equal(w.profileDraft.enabled,false);assert.equal(w.profileDraft.scheduleType,'weekly');assert.deepEqual(w.profileDraft.weekDays,[1]);assert.equal(w.profileDraft.limit,2);
  assert.equal(w.profileRows()[0].id,'weekly');assert.notEqual(w.profileDraft.id,'weekly');assert.equal(f.writes.length,0);c.destroy();
});
