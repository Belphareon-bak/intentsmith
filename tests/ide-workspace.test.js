import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { up } from '../src/db/migrations/2026_09_18_115_intentsmith_setting_names.js';

const source=fs.readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);let end=source.indexOf('\nfunction ',start+1);const next=source.indexOf('\nvar ',start+1);if(next>=0&&(end<0||next<end))end=next;return source.slice(start,end<0?undefined:end);}
function harness(){
  const context=vm.createContext({Date,Math,Array,Number,JSON,alert(){},confirm:()=>true,
    _sessionActive:0,_sessionCount:3,_perSessionTree:{},_wtRoot:'/old',_wtRawTree:null,FILES:[],
    _persistSessionState(){},_renderAll(){},renderCenter(){},renderChat(){},_rememberSpecialistFiles(){},
    _showWorkspace(){},_chatCancelPreparedSend(){return false;},_chatInvalidatePreparedSends(st){st._sendContextToken={};},
    IntentSmithWS:{hasActiveM1Turn:s=>!!s.busy},IntentSmithTerminal:{isExecuting:()=>false},IntentSmithAgent:{isExecuting:()=>false},
  });
  for(const name of ['_mkSession','_workspaceSessionIndices','_workspaceBusy','_closeWorkspaceConversation','_closeWorkspaceSession','_normalizePersistedSessionState'])vm.runInContext(fn(name),context);
  context._sessions=[context._mkSession(),context._mkSession(),context._mkSession()];
  context._editorState=context._sessions[0]._editor;
  context._switchSession=idx=>{context._sessionActive=idx;context._editorState=context._sessions[idx]._editor;};
  return context;
}
test('closing a conversation keeps its column, file editor and other session identities',()=>{
  const c=harness(),closed=c._sessions[0],other=c._sessions[1],editor=closed._editor,token=closed.chat._sendContextToken;
  closed._convId='private-conversation';closed._projectId=17;closed.chat.specialist={id:'accountant-cz'};closed.chat._delivery={status:'NOT_SENT'};
  editor.tabs.push({id:'file',content:'unsaved file',dirty:true});
  assert.equal(c._closeWorkspaceConversation(0),true);
  assert.equal(c._sessionCount,3);assert.equal(c._sessions[0]._closed,false);assert.equal(c._sessions[0]._convId,null);
  assert.equal(c._sessions[0]._projectId,null);assert.equal(c._sessions[0].chat.specialist,null);
  assert.equal(c._sessions[0]._editor,editor);assert.equal(c._sessions[1],other);
  assert.notEqual(closed.chat._sendContextToken,token);assert.equal(c._sessions[0].chat._delivery,null);
});
test('closing a tab never moves another active transport into its index',()=>{
  const c=harness();c._sessionActive=2;const owner=c._sessions[2];owner.busy=true;owner._convId='other-active';
  assert.equal(c._closeWorkspaceSession(0),true);assert.equal(c._sessions[2],owner);assert.equal(c._sessionActive,2);
  assert.equal(c._sessions[0]._closed,true);assert.equal(c._sessionCount,3);
  assert.equal(c._closeWorkspaceSession(2),false);assert.equal(c._sessions[2]._convId,'other-active');
});
test('closing the last tab retains an empty workspace and dirty editor close is cancellable',()=>{
  const c=harness();c._sessions[1]._closed=true;c._sessions[2]._closed=true;
  c._sessions[0]._editor.tabs.push({dirty:true});c.confirm=()=>false;
  assert.equal(c._closeWorkspaceSession(0),false);assert.equal(c._sessions[0]._closed,false);
  c.confirm=()=>true;assert.equal(c._closeWorkspaceSession(0),true);
  assert.equal(c._sessions[0]._closed,false);assert.equal(c._sessionActive,0);
});
test('new session editors, output modes and attachment queues are independent',()=>{
  const c=harness(),a=c._sessions[0],b=c._sessions[1];
  a._editor.tabs.push({id:'a'});a.chat.attachments.push({name:'private'});a.log.push({text:'log a'});a.term.push({text:'output a'});
  assert.equal(b._editor.tabs.length,0);assert.equal(b.chat.attachments.length,0);assert.equal(b.log.length,0);assert.equal(b.term.length,1);
});
test('settings migration preserves old values, explicit canonical overrides and timestamps',()=>{
  const db=new Database(':memory:');try{
    db.exec('CREATE TABLE user_settings(id INTEGER PRIMARY KEY,data TEXT,updated_at TEXT)');
    db.prepare('INSERT INTO user_settings VALUES(1,?,?)').run(JSON.stringify({'c3.notif.emailEnabled':true,'intentsmith.notif.emailEnabled':false,'c3.notif.emailRecipient':'local-test','memory.saveContext':false}),'original');
    db.transaction(()=>up(db))();db.transaction(()=>up(db))();
    const row=db.prepare('SELECT * FROM user_settings').get(),data=JSON.parse(row.data);
    assert.equal(data['intentsmith.notif.emailEnabled'],false);assert.equal(data['c3.notif.emailEnabled'],true);
    assert.equal(data['intentsmith.notif.emailRecipient'],'local-test');assert.equal(data['memory.saveContext'],false);assert.equal(row.updated_at,'original');
  }finally{db.close();}
});
test('history and menu surfaces contain no second copy of chat or output panels',()=>{
  assert.match(fn('ChatApp'),/WorkspaceContextApp/);
  assert.doesNotMatch(fn('ChatApp'),/_chatPaneUI|_bottomPane/);
  assert.match(fn('CenterApp'),/if\(_workspaceShown\(\)\)return WorkspaceApp\(\)/);
  assert.match(fn('_bottomPane'),/\['terminal','agent','audit'\]/);
});

test('old and new WebSocket capability names share strict duplicate rejection',async()=>{
  const {parseLegacyLocalWebSocketCapability}=await import('../src/security/legacy-local-access-policy.js');
  const token='A'.repeat(43);
  for(const prefix of ['c3-local-v1.','intentsmith-local-v1.'])assert.deepEqual(parseLegacyLocalWebSocketCapability(prefix+token),{state:'valid',token});
  assert.equal(parseLegacyLocalWebSocketCapability('c3-local-v1.'+token+', intentsmith-local-v1.'+token).state,'ambiguous');
  assert.equal(parseLegacyLocalWebSocketCapability('c3-local-v11.'+token).state,'ambiguous');
});
test('canonical environment values win; an old installation remains readable',async()=>{
  const {spawnSync}=await import('node:child_process');
  const code=`const {config}=await import('./src/config.js');console.log(JSON.stringify({path:config.db.path,agents:config.features.agents}));`;
  for(const canonical of [false,true]){
    const env={...process.env,C3_DB_PATH:'/legacy/project.sqlite',C3_ENABLE_AGENTS:'true'};
    delete env.INTENTSMITH_DB_PATH;delete env.INTENTSMITH_ENABLE_AGENTS;
    if(canonical){env.INTENTSMITH_DB_PATH='/canonical/project.sqlite';env.INTENTSMITH_ENABLE_AGENTS='false';}
    const p=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env,encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);const result=JSON.parse(p.stdout.trim().split('\n').at(-1));
    assert.deepEqual(result,canonical?{path:'/canonical/project.sqlite',agents:false}:{path:'/legacy/project.sqlite',agents:true});
  }
});
test('draft snapshots cannot copy a closed conversation draft into its replacement',()=>{
  const c=harness();vm.runInContext(fn('_snapshotWorkspaceDrafts'),c);
  const old=c._sessions[0];c._workspaceTextareas={0:{session:old,node:{value:'private draft'}}};
  c._snapshotWorkspaceDrafts();assert.equal(old.chat._draft,'private draft');
  c._closeWorkspaceConversation(0);c._snapshotWorkspaceDrafts();assert.equal(c._sessions[0].chat._draft,undefined);
});
test('opening another entity cannot consume an untouched specialist, draft, attachment, file or terminal workspace',()=>{
  const c=harness();vm.runInContext(fn('_isSessionEmpty'),c);
  assert.equal(c._isSessionEmpty(c._mkSession()),true);
  for(const fill of [s=>s.chat.specialist={id:'accountant-cz'},s=>s.chat._draft='draft',s=>s.chat.attachments.push({name:'notes'}),s=>s._editor.tabs.push({id:'file'}),s=>s.term.push({text:'command output'}),s=>s.chat.msgs=[{role:'user',text:'question'}]]){
    const owner=c._mkSession();fill(owner);assert.equal(c._isSessionEmpty(owner),false);
  }
});
test('catalog navigation takes the center even while the owning session keeps an open editor',()=>{
  const c=vm.createContext({_workspaceShown:()=>false,_centerState:{view:'projects',detail:null},_editorState:{active:true},
    _expertiseWizard:{active:false},_agentWizard:{active:false},_projectWizard:{active:false},_specialistWizard:{active:false},
    C:{},React:{Fragment:'fragment'},h:(tag,props,...children)=>({tag,props,children}),centerProjects:()=> 'PROJECT_CATALOG',centerEditor:()=>{throw Error('editor stole catalog');}});
  vm.runInContext(fn('CenterApp'),c);assert.match(JSON.stringify(c.CenterApp()),/PROJECT_CATALOG/);assert.equal(c._editorState.active,true);
});
test('late project tree responses stay with their owner and cannot replace the selected session tree',async()=>{
  const c=harness(),pending=[];Object.assign(c,{_backendUrl: () => 'http://fixture',AbortSignal,_collapsedDirs:{},renderSidebar(){},_fetchGitStatus(){},fetch:()=>new Promise(resolve=>pending.push(resolve))});
  for(const name of ['_flattenTree','_loadTreeState','_loadWorkspaceTree'])vm.runInContext(fn(name),c);
  const first=c._loadWorkspaceTree('/first',0);c._sessionActive=1;const second=c._loadWorkspaceTree('/second',1);
  pending[1]({ok:true,json:async()=>({root:'/second',tree:[{n:'second.txt',d:false}]})});await second;
  pending[0]({ok:true,json:async()=>({root:'/first',tree:[{n:'first.txt',d:false}]})});await first;
  assert.equal(c._wtRoot,'/second');assert.equal(c.FILES[0].n,'second.txt');assert.equal(c._perSessionTree[0].files[0].n,'first.txt');
  const third=c._loadWorkspaceTree('/stale',0);c._sessions[0]=c._mkSession();pending[2]({ok:true,json:async()=>({root:'/stale',tree:[{n:'private.txt'}]})});await third;
  assert.equal(c._wtRoot,'/second');assert.equal(c._perSessionTree[0].files.length,0);
});
test('desktop upgrades preserve the exact administrator credential under the canonical name',async()=>{
  const {normalizeAdminEnvironment,renderDesktopInstallation}=await import('../scripts/desktop-runtime.mjs');
  const token='D'.repeat(43);
  for(const prefix of ['C3','INTENTSMITH'])assert.equal(normalizeAdminEnvironment(prefix+'_ADMIN_TOKEN='+token+'\n'),'INTENTSMITH_ADMIN_TOKEN='+token+'\n');
  for(const body of ['C3_ADMIN_TOKEN=short\n','C3_ADMIN_TOKEN='+token+'\nEXTRA=1\n','C3_ADMIN_TOKEN='+token+'\nINTENTSMITH_ADMIN_TOKEN='+token+'\n'])assert.throws(()=>normalizeAdminEnvironment(body),/ADMIN_CREDENTIAL_FILE_INVALID/);
  const config={sourceRoot:'/source',node:'/node',dbPath:'/data/legacy.db',stateDirectory:'/state',configDirectory:'/config',icon:'/icon.png'};
  const env=renderDesktopInstallation(config).environment;assert.match(env,/INTENTSMITH_HOST=127\.0\.0\.1/);assert.match(env,/INTENTSMITH_PORT=0/);assert.doesNotMatch(env,/\nC3_/);
});
test('manual file save refuses an externally changed file and retains the unsaved editor',async()=>{
  const writes=[];const c=vm.createContext({window:{_intentsmithFileService:{read:async()=>({value:'external edit'}),write:async(...args)=>writes.push(args)}},require:()=>({default:class URI{constructor(path){this.path=path;}}}),renderCenter(){},_fetchGitStatus(){}});
  vm.runInContext('async '+fn('_saveWorkspaceFile'),c);
  const tab={type:'file',path:'/project/file.js',originalContent:'original',content:'my edit',dirty:true};await c._saveWorkspaceFile(tab);
  assert.equal(writes.length,0);assert.equal(tab.dirty,true);assert.equal(tab.content,'my edit');assert.match(tab._saveError,/změnil na disku/);
});
test('manual save keeps edits made while the previous save is still in flight',async()=>{
  let finish,write;const c=vm.createContext({window:{_intentsmithFileService:{read:async()=>({value:'original',mtime:123,etag:'exact-read',encoding:'utf8'}),write:async(uri,content,opts)=>{write={uri,content,opts};await new Promise(resolve=>finish=resolve);}}},require:()=>({default:class URI{constructor(path){this.path=path;}}}),renderCenter(){},_fetchGitStatus(){}});
  vm.runInContext('async '+fn('_saveWorkspaceFile'),c);const tab={type:'file',path:'/project/file.js',originalContent:'original',content:'first edit',dirty:true};
  const pending=c._saveWorkspaceFile(tab);await new Promise(resolve=>setImmediate(resolve));tab.content='newer edit';finish();await pending;
  assert.equal(write.uri.path,'/project/file.js');assert.equal(write.content,'first edit');assert.equal(write.opts.etag,'exact-read');assert.equal(write.opts.mtime,123);
  assert.equal(tab.originalContent,'first edit');assert.equal(tab.content,'newer edit');assert.equal(tab.dirty,true);assert.equal(tab._saving,false);
});

test('split terminal rendering never steals focus; explicit focus stays with its live active owner',()=>{
  const c=harness(),timers=[],focused=[];Object.assign(c,{C:{},_fs:x=>x,
    h:(tag,props,...children)=>({tag,props:props||{},children}),setTimeout:cb=>timers.push(cb),
    document:{getElementById:id=>({focus:()=>focused.push(id)})}});
  for(const name of ['_terminalContent','_focusTerminalInput'])vm.runInContext(fn(name),c);
  function mount(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(mount);return;}
    assert.notEqual(node.props.autoFocus,true);if(node.props.ref)node.props.ref({focus:()=>focused.push('render')});node.children.forEach(mount);}
  for(let n=0;n<5;n++){mount(c._terminalContent(c._sessions[0],0));mount(c._terminalContent(c._sessions[1],1));}
  assert.equal(timers.length,0);assert.equal(focused.length,0);
  c._focusTerminalInput(0,c._sessions[0]);c._sessionActive=1;timers.shift()();assert.equal(focused.length,0);
  c._focusTerminalInput(1,c._sessions[1]);c._sessions[1]=c._mkSession();timers.shift()();assert.equal(focused.length,0);
  c._focusTerminalInput(1,c._sessions[1]);timers.shift()();assert.deepEqual(focused,['intentsmith-term-input-1']);
});

test('restoring an inactive project reloads its missing tree exactly once on activation',()=>{
  const c=harness(),reads=[];Object.assign(c,{PROJECTS:[{id:17,path:'/project'}],
    _loadWorkspaceTree:(root,idx)=>{reads.push({root,idx});c._sessions[idx]._treeLoading=true;}});
  vm.runInContext(fn('_ensureWorkspaceTree'),c);
  c._sessions[1]._projectId=17;c._perSessionTree[1]={wtRoot:'/project',rawTree:null,files:[]};
  c._ensureWorkspaceTree(1);c._ensureWorkspaceTree(1);assert.deepEqual(reads,[{root:'/project',idx:1}]);
  c._sessions[1]._treeLoading=false;c._perSessionTree[1].rawTree=[];c._ensureWorkspaceTree(1);assert.equal(reads.length,1);
  c._perSessionTree[1].rawTree=null;c._sessions[1]._closed=true;c._ensureWorkspaceTree(1);assert.equal(reads.length,1);
});

test('late system logs belong to the sender, never the currently selected or a closed session',()=>{
  const c=harness();c.renderAgent=()=>{};c._sessionActive=1;vm.runInContext(fn('_appendSessionLog'),c);
  const start=source.indexOf("IntentSmithBus.on('chat:system'");const end=source.indexOf('\n  });',start)+6;
  c.IntentSmithBus={on:(_name,handler)=>c.handler=handler};vm.runInContext(source.slice(start,end),c);
  c.handler({sessionIdx:0,content:'background session message'});
  assert.equal(c._sessions[0].log[0].text,'background session message');assert.equal(c._sessions[1].log.length,0);
  c._sessions[0]._closed=true;c.handler({sessionIdx:0,content:'late'});c.handler({sessionIdx:99,content:'unknown'});
  assert.equal(c._sessions[0].log.length,1);assert.equal(c._sessions[1].log.length,0);
});
test('a background terminal completion cannot move focus out of the selected session',()=>{
  const terminal=fs.readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/terminal-client.js',import.meta.url),'utf8');
  const start=terminal.indexOf('function _refocusTermInput('),end=terminal.indexOf('/* ─── Helpers',start);
  const callbacks=[],focused=[];const c=harness();Object.assign(c,{requestAnimationFrame:cb=>callbacks.push(cb),
    window:{_intentsmith:{getSessionActive:()=>c._sessionActive}},document:{getElementById:id=>({focus:()=>focused.push(id)})}});
  vm.runInContext(terminal.slice(start,end),c);c._refocusTermInput(0);c._sessionActive=1;callbacks.shift()();assert.equal(focused.length,0);
  c._refocusTermInput(1);c._sessions[1]=c._mkSession();callbacks.shift()();assert.equal(focused.length,0);
  c._refocusTermInput(1);callbacks.shift()();assert.deepEqual(focused,['intentsmith-term-input-1']);
});

test('settings upgrade on a reopened database preserves the real M5 trigger and existing values',async()=>{
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {up:privacy,computeM5PrivacyAuthorityFingerprintV090:fingerprint}=await import('../src/db/migrations/2026_08_26_090_m5_privacy_authority.js');
  const dir=fs.mkdtempSync(join(tmpdir(),'intentsmith-settings-upgrade-')),file=join(dir,'settings.sqlite');let db;
  try{db=new Database(file);db.exec('CREATE TABLE user_settings(id INTEGER PRIMARY KEY,data TEXT,updated_at TEXT)');
    const original={'c3.notif.emailEnabled':true,'memory.saveContext':false};
    db.prepare('INSERT INTO user_settings VALUES(1,?,?)').run(JSON.stringify(original),'unchanged-time');privacy(db);
    const schema=fingerprint(db);db.close();db=new Database(file);
    assert.throws(()=>db.prepare('UPDATE user_settings SET data=data').run(),/no such function: m5_privacy_user_settings_valid_v1/);
    db.transaction(()=>up(db))();const row=db.prepare('SELECT * FROM user_settings').get();
    assert.deepEqual(JSON.parse(row.data),{...original,'intentsmith.notif.emailEnabled':true});assert.equal(row.updated_at,'unchanged-time');
    assert.equal(fingerprint(db),schema);
    assert.throws(()=>db.prepare('UPDATE user_settings SET data=?').run(JSON.stringify({password:'forbidden-test-only'})),/M5_PRIVACY_PLAINTEXT_SETTING_FORBIDDEN/);
  }finally{if(db?.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('startup continues while a durable model download is pending and observes recovery failure',async()=>{
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const start=server.indexOf('  // An existing multi-GB download'),end=server.indexOf('  setModelRegistry(modelRegistry);',start);assert.ok(start>=0&&end>start);
  for(const rejectRecovery of [false,true]){
    let resolve,reject,calls=0;const log=[];const pending=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
    const c=vm.createContext({upgradeManager:{recoverOutstandingModelPulls:()=>{calls++;return pending;}},
      logger:{info:(...args)=>log.push(args),warn:(...args)=>log.push(args)},ready:false});
    const boot=vm.runInContext('(async()=>{'+server.slice(start,end)+'ready=true;})()',c);
    await new Promise(ok=>setImmediate(ok));assert.equal(c.ready,true);assert.equal(calls,1);assert.equal(log.length,0);
    if(rejectRecovery)reject(Object.assign(Error('controlled failure'),{code:'TEST_RECOVERY_FAILURE'}));
    else resolve([{operationId:'same-existing-operation',status:'RECOVERED'}]);
    await boot;await new Promise(ok=>setImmediate(ok));assert.equal(log.length,1);
    assert.match(log[0][1],rejectRecovery?/TEST_RECOVERY_FAILURE/:/same-existing-operation: RECOVERED/);
  }
});

test('renaming Studio keeps existing user data without replacing an explicit or newer profile',async()=>{
  const {createRequire}=await import('node:module');const {resolveUserDataArgs}=createRequire(import.meta.url)('../intentsmith-ide/applications/electron/resolve-user-data.js');
  const previous='/profiles/c3-ide-electron',current='/profiles/intentsmith-ide-electron';
  const options={platform:'linux',env:{XDG_CONFIG_HOME:'/profiles'},home:'/home/test',isDirectory:p=>p===previous};
  assert.deepEqual(resolveUserDataArgs([],options),['--user-data-dir='+previous]);
  for(const args of [['--user-data-dir=/chosen'],['--user-data-dir','/chosen'],['--electron-user-data=/chosen'],['--electron-user-data','/chosen']])assert.deepEqual(resolveUserDataArgs(args,options),[]);
  assert.deepEqual(resolveUserDataArgs([],{...options,isDirectory:p=>p===current||p===previous}),[]);
  assert.deepEqual(resolveUserDataArgs([],{...options,isDirectory:()=>false}),[]);
});
