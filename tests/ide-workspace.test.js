import { execFileSync as runStudio2BehaviorTests } from 'node:child_process';
import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { up } from '../src/db/migrations/2026_09_18_115_intentsmith_setting_names.js';

test('Studio 2 copies committed WAL data without migrating or replacing user databases', async () => {
  const { createRequire } = await import('node:module');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { copyUserData } = createRequire(import.meta.url)('../scripts/studio2-copy-user-data.cjs');
  const folder = fs.mkdtempSync(join(tmpdir(), 'studio2-data-copy-'));
  const source = join(folder, 'original.sqlite'), target = join(folder, 'studio2.sqlite');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE conversations(id INTEGER PRIMARY KEY, title TEXT)');
    db.prepare('INSERT INTO conversations(title) VALUES(?)').run('Původní práce');
    const original = fs.readFileSync(source), wal = fs.readFileSync(source + '-wal');
    await copyUserData(source, target);
    assert.deepEqual(fs.readFileSync(source), original);
    assert.deepEqual(fs.readFileSync(source + '-wal'), wal);
    const snapshot = new Database(target);
    try {
      assert.equal(snapshot.prepare('SELECT title FROM conversations').get().title, 'Původní práce');
      snapshot.prepare('INSERT INTO conversations(title) VALUES(?)').run('Nová práce');
    } finally { snapshot.close(); }
    assert.equal(db.prepare('SELECT count(*) AS n FROM conversations').get().n, 1);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    const existing = fs.readFileSync(target);
    await assert.rejects(copyUserData(source, target));
    await assert.rejects(copyUserData(source, source));
    await assert.rejects(copyUserData(join(folder, 'missing'), join(folder, 'other.sqlite')));
    assert.deepEqual(fs.readFileSync(target), existing);
    assert.equal(fs.readdirSync(folder).some(name => name.includes('.backup-')), false);
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
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




test('desktop upgrades preserve the exact administrator credential under the canonical name',async()=>{
  const {normalizeAdminEnvironment,renderDesktopInstallation}=await import('../scripts/desktop-runtime.mjs');
  const token='D'.repeat(43);
  for(const prefix of ['C3','INTENTSMITH'])assert.equal(normalizeAdminEnvironment(prefix+'_ADMIN_TOKEN='+token+'\n'),'INTENTSMITH_ADMIN_TOKEN='+token+'\n');
  for(const body of ['C3_ADMIN_TOKEN=short\n','C3_ADMIN_TOKEN='+token+'\nEXTRA=1\n','C3_ADMIN_TOKEN='+token+'\nINTENTSMITH_ADMIN_TOKEN='+token+'\n'])assert.throws(()=>normalizeAdminEnvironment(body),/ADMIN_CREDENTIAL_FILE_INVALID/);
  const config={sourceRoot:'/source',node:'/node',dbPath:'/data/legacy.db',stateDirectory:'/state',configDirectory:'/config',icon:'/icon.png'};
  const env=renderDesktopInstallation(config).environment;assert.match(env,/INTENTSMITH_HOST=127\.0\.0\.1/);assert.match(env,/INTENTSMITH_PORT=0/);assert.doesNotMatch(env,/\nC3_/);
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

// Operator regression: restored Settings occupied the whole window; the main
// navigation had a hidden dock despite its outer container being visible.










// Active Studio 2 adapters replace source extraction from the retired React monolith.
test('ide-workspace: active Studio 2 integration coverage', () => {
  const output = runStudio2BehaviorTests(process.execPath, ['--test', '--test-reporter=tap', 'tests/studio2-session-store.test.js', 'tests/studio2-transport.test.js', 'tests/studio2-attachments.test.js', 'tests/studio2-workspace-files.test.js', 'tests/studio2-appearance.test.js', 'tests/studio2-live-model.test.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  if (!/# fail 0/.test(output)) throw new Error('Active Studio 2 tests did not complete: ' + output);
});
