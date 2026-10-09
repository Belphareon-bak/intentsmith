import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Offline contract qualification. No server, network, DB, credentials or model.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IdeSettingsManagement, remoteWebUrl, emptyManagementVM } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/ide-settings-management');
const clone = v => JSON.parse(JSON.stringify(v));
const account = { id: 'telegram-one', revision: 1, name: 'Telegram', provider: 'telegram', credentialEnv: 'INTENTSMITH_TELEGRAM_ONE', recipient: '123456', enabled: true, events: ['worker'], credentialConfigured: false, credentialPersistence: 'environment_only', connectionStatus: 'NOT_VERIFIED' };
const profile = { id: 'ssh-one', revision: 1, name: 'Git SSH', host: 'github.com', user: 'git', port: 22, identityFile: '/home/fixture/.ssh/id_ed25519', knownHostsFile: '/home/fixture/.ssh/known_hosts' };
const repo = { id: 1, name: 'Project', path: '/fixture/project', remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git', host: 'github.com' }], status: 'OBSERVED', profile: { id: '1', revision: 1, sshProfileId: 'ssh-one' } };
const backup = { name: 'intentsmith-state-20261009.backup', revision: 0, note: '', archived: false, sections: ['database', 'config'], restore_scope: ['database'], content_fingerprint: 'sha256:' + 'a'.repeat(64), created_at: '2026-10-09T12:00:00Z', db_size_bytes: 1024, total_size_bytes: 2048, restorable: true, format_version: 2, schema_version: 110 };
function fixture(extra = {}) {
  const calls = [], accounts = [clone(account)], profiles = [clone(profile)], repositories = [clone(repo)], backups = [clone(backup)];
  let settings = { unrelated: 'preserve', storage: { retention: { conversations: 100 }, backup: { max_daily: 7, max_weekly: 4, on_startup: true, on_shutdown: true, periodic: false } } };
  const respond = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, method: options.method, body });
    if (extra.handle) { const handled = await extra.handle(path, options.method, body, respond); if (handled) return handled; }
    if (options.method === 'GET') {
      if (path === '/api/accounts') return respond(200, { accounts, supportedEvents: ['worker', 'lifecycle'] });
      if (path === '/api/scm/profiles') return respond(200, { profiles });
      if (path === '/api/scm/repositories') return respond(200, { repositories, defaultProjectsPath: '/fixture/projects' });
      if (path === '/api/system/backups') return respond(200, { backups });
      if (path === '/api/settings') return respond(200, settings);
      if (path === '/api/system/storage/settings') return respond(200, { backup: settings.storage.backup });
      if (path === '/api/notifications/channels') return respond(200, { channels: [{ name: 'telegram.account.telegram-one', configured: true }] });
      if (path === '/api/notifications/config') return respond(200, { emailEnabled: false, smtpHost: '', smtpPort: 587, emailRecipient: '', smtpFrom: '', smtpPass: '*****', credentialPersistence: 'environment_only' });
    }
    if (options.method === 'PUT' && path === '/api/accounts/' + account.id) {
      if (body.revision !== accounts[0].revision) return respond(409, { code: 'IDE_REVISION_STALE' });
      Object.assign(accounts[0], body, { revision: body.revision + 1 }); return respond(200, accounts[0]);
    }
    if (options.method === 'PUT' && path.startsWith('/api/system/backups/')) {
      Object.assign(backups[0], body, { id: backups[0].name, revision: body.revision + 1 });
      return respond(200, { id: backups[0].name, revision: backups[0].revision, note: body.note, archived: body.archived });
    }
    if (options.method === 'PUT' && path === '/api/scm/repositories/1') {
      repositories[0].profile = { id: '1', revision: body.revision + 1, sshProfileId: body.sshProfileId }; return respond(200, repositories[0].profile);
    }
    if (options.method === 'POST' && path === '/api/settings') { settings = clone(body); return respond(200, { success: true }); }
    if (options.method === 'POST' && path === '/api/system/backups/retention-preview') return respond(200,{deletesNothing:true,scope:'CURRENT_SNAPSHOTS_NEXT_RETENTION',deletions:[]});
    throw new Error('Unexpected offline request: ' + options.method + ' ' + path);
  };
  let confirms = 0, updates = 0;
  const controller = new IdeSettingsManagement({ backendUrl: extra.backendUrl || (() => 'http://127.0.0.1:12345'), fetchImpl, onChange: () => { updates++; }, confirmAction: extra.confirmAction || (() => { confirms++; return true; }) });
  return { controller, calls, accounts, profiles, repositories, backups, confirms: () => confirms, updates: () => updates };
}
test('inert VM; account revision payload and readback; view switch preserves editor', async () => {
  const f = fixture(), c = f.controller; assert.equal(c.vm('ucet').loading, true); assert.equal(f.calls.length, 0);
  await c.load('ucet'); c.openAccount('ucet', c.resource('ucet').accounts[0]);
  const beforeChange = f.updates(); c.editorVM('ucet').fields.find(f => f.label === 'Název').change({ target: { value: 'Nový název' } }); assert.equal(f.updates(), beforeChange + 1);
  const editor = c.editors.get('ucet'); c.vm('ucet', 'seznam'); c.vm('ucet', 'dlazdice'); assert.equal(c.editors.get('ucet'), editor);
  assert.equal(await c.save('ucet'), true); assert.equal(f.accounts[0].name, 'Nový název');
  const put = f.calls.find(x => x.method === 'PUT'); assert.equal(put.body.revision, 1); assert.equal(put.body.credentialEnv, account.credentialEnv);
  assert.equal(Object.hasOwn(put.body, 'token'), false); assert.equal(f.calls.at(-1).method, 'GET'); assert.equal(c.editors.has('ucet'), false); c.destroy();
});
test('stale CAS refuses once and preserves original draft without rebase or retry', async () => {
  const f = fixture(), c = f.controller; await c.load('ucet'); c.openAccount('ucet', c.resource('ucet').accounts[0]);
  c.editors.get('ucet').draft.name = 'Unsaved'; f.accounts[0].revision = 2;
  assert.equal(await c.save('ucet'), false); assert.equal(await c.save('ucet'), false);
  assert.equal(f.calls.filter(x => x.method === 'PUT').length, 1); assert.equal(c.editors.get('ucet').draft.name, 'Unsaved');
  assert.equal(c.editors.get('ucet').original.revision, 1); await c.load('ucet', true);
  assert.equal(c.editorVM('ucet').saveDisabled, true); assert.equal(c.editors.get('ucet').original.revision, 1); c.destroy();
});
test('successful response with mismatched durable readback is not accepted', async () => {
  let changed = false;
  const f = fixture({ handle: async (path, method, body, respond) => {
    if (method === 'PUT') { changed = true; return respond(200, { ...account, ...body, revision: body.revision + 1 }); }
    if (changed && path === '/api/accounts') return respond(200, { accounts: [account], supportedEvents: ['worker', 'lifecycle'] });
  } }), c = f.controller;
  await c.load('ucet'); c.openAccount('ucet', c.resource('ucet').accounts[0]); c.editors.get('ucet').draft.name = 'Lost readback';
  assert.equal(await c.save('ucet'), false); assert.match(c.vm('ucet').notice, /READBACK_MISMATCH/); assert.equal(c.editorVM('ucet').saveDisabled, true); c.destroy();
});
test('SSH in-use deletion is refused before confirmation or request; repository mapping verifies true document revision', async () => {
  const f = fixture(), c = f.controller; await c.load('git'); const n = f.calls.length;
  assert.equal(await c.remove('git', 'profiles', c.resource('git').profiles[0]), false); assert.equal(f.calls.length, n); assert.equal(f.confirms(), 0); assert.match(c.vm('git').notice, /Project/);
  c.editor('git', 'repository', c.resource('git').repositories[0].profile, { projectId: 1, sshProfileId: '' });
  assert.equal(await c.save('git'), true); assert.equal(f.repositories[0].profile.revision, 2); assert.equal(f.repositories[0].profile.sshProfileId, null); c.destroy();
});
test('backup note/archive updates preserve payload fingerprint and forbid archived/last deletion', async () => {
  const f = fixture(), c = f.controller; await c.load('zalohy'); const b = c.resource('zalohy').backups[0];
  c.editor('zalohy', 'backup', b, { note: 'Relevant note', archived: true }); assert.equal(await c.save('zalohy'), true);
  assert.equal(f.backups[0].content_fingerprint, backup.content_fingerprint); assert.equal(f.backups[0].note, 'Relevant note');
  const n = f.calls.length; assert.equal(await c.remove('zalohy', 'backups', c.resource('zalohy').backups[0]), false); assert.equal(f.calls.length, n); assert.equal(f.confirms(), 0); c.destroy();
});
test('web transport projection is conservative, rejects credentials/ports/unsafe decoded paths', () => {
  assert.equal(remoteWebUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
  assert.equal(remoteWebUrl('https://gitlab.com/group/subgroup/repo.git'), 'https://gitlab.com/group/subgroup/repo');
  for (const url of ['https://token@github.com/owner/repo', 'https://github.com:8443/owner/repo', 'ssh://git@github.com:2222/owner/repo', 'https://private.invalid/owner/repo', 'https://github.com/owner/%2e%67%69%74', 'https://github.com/owner/repo?token=secret', 'https://github.com/owner/repo#x', 'javascript:alert(1)', 'git@github.com:owner/../repo.git']) assert.equal(remoteWebUrl(url), '', url);
});
test('notification read stores public fields only; list/grid items and action labels agree', async () => {
  const f = fixture(), c = f.controller; await c.load('oznameni'); assert.equal(Object.hasOwn(c.resource('oznameni').email, 'smtpPass'), false);
  const projection = view => c.vm('oznameni', view).sections.map(s => ({ title: s.title, rows: s.items.map(i => ({ title: i.title, properties: i.properties, actions: i.actions.map(a => a.label) })) }));
  assert.deepEqual(projection('seznam'), projection('dlazdice')); assert.notEqual(c.vm('oznameni', 'seznam').layoutClass, c.vm('oznameni', 'dlazdice').layoutClass);
  assert.equal(f.calls.every(x => x.method === 'GET'), true); c.destroy();
});
test('empty canonical Component VM supplies inert template structures and simple-path bindings', () => {
  const fs = require('node:fs'), vm = emptyManagementVM();
  assert.deepEqual(vm.sections, []); assert.deepEqual(vm.editor.fields, []); assert.deepEqual(vm.detail.rows, []);
  for (const key of ['refresh', 'closeDetail']) assert.equal(typeof vm[key], 'function');
  for (const key of ['save', 'cancel']) assert.equal(typeof vm.editor[key], 'function');
  const canonical = fs.readFileSync(new URL('../docs/studio2/prototype/src/main.template.html', import.meta.url), 'utf8');
  const template = canonical.slice(canonical.indexOf('<sc-if value="{{b.isManagement}}"'), canonical.indexOf('<sc-if value="{{b.isPreferences}}"'));
  for (const m of template.matchAll(/\{\{([^}]+)\}\}/g)) assert.match(m[1], /^(?:[a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/);
  assert.doesNotMatch(template, /style=|<script/i);
  for (const binding of template.matchAll(/on(?:Click|Change)="([^"]+)"/g)) assert.match(binding[1], /^\{\{[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\}\}$/);
  assert.equal(vm.hasNotice, false);
});
test('backend identity switch never sends stale account/configuration into another backend, including async confirmation', async () => {
  let base = 'http://127.0.0.1:12345';
  const f = fixture({ backendUrl: () => base, confirmAction: async () => { base = 'http://127.0.0.1:23456'; return true; } }), c = f.controller;
  await c.load('ucet'); c.openAccount('ucet', c.resource('ucet').accounts[0]); const editor = c.editors.get('ucet');
  base = 'http://127.0.0.1:23456'; assert.equal(await c.save('ucet'), false); assert.equal(f.calls.some(x => x.method !== 'GET'), false);
  assert.equal(c.vm('ucet').hasError, true); assert.equal(c.vm('ucet').sections[0].items.length, 0); assert.equal(c.editors.get('ucet'), editor);
  base = 'http://127.0.0.1:12345'; assert.equal(await c.testAccount('ucet', account), false); assert.equal(f.calls.some(x => x.method !== 'GET'), false); c.destroy();
});
test('legacy retention merges only selected backup values, preserves unrelated settings and verifies effective readback without CAS claim', async () => {
  const f = fixture(), c = f.controller; await c.load('zalohy');
  const data = c.resource('zalohy'); c.editor('zalohy', 'retention', { settings: data.settings }, data.backupPolicy);
  c.editors.get('zalohy').draft.max_daily = 1; c.editors.get('zalohy').draft.max_weekly = 2;
  assert.equal(await c.save('zalohy'), true);
  assert(f.calls.some(x=>x.path==='/api/system/backups/retention-preview'));
  const writes = f.calls.filter(x => x.path === '/api/settings' && x.method === 'POST'); assert.equal(writes.length, 1); assert.equal(writes[0].path, '/api/settings');
  assert.equal(writes[0].body.unrelated, 'preserve'); assert.equal(writes[0].body.storage.retention.conversations, 100); assert.equal(writes[0].body.storage.backup.periodic, false);
  assert.equal(c.resource('zalohy').backupPolicy.max_daily, 1); assert.equal(c.resource('zalohy').backupPolicy.max_weekly, 2); assert.equal(f.backups.length, 1); c.destroy();
});

test('retention changes show the actual deletion preview and cancellation preserves draft without saving',async()=>{
  let confirmation='';
  const f=fixture({confirmAction:message=>{confirmation=message;return false;},handle:async(path,method,body,respond)=>{
    if(path==='/api/system/backups/retention-preview')return respond(200,{deletesNothing:true,scope:'CURRENT_SNAPSHOTS_NEXT_RETENTION',deletions:[{name:'old.backup'}]});
  }}),c=f.controller;
  await c.load('zalohy');const data=c.resource('zalohy');c.editor('zalohy','retention',{settings:data.settings},data.backupPolicy);
  c.editors.get('zalohy').draft.max_daily=1;
  assert.equal(await c.save('zalohy'),false);assert.match(confirmation,/old.backup/);assert.match(confirmation,/příštím/);
  assert(!f.calls.some(x=>x.method==='POST'&&x.path==='/api/settings'));assert.equal(c.editors.get('zalohy').draft.max_daily,1);c.destroy();
});

test('definite validation rejection preserves an editable draft for correction',async()=>{
  let reject=true;
  const f=fixture({handle:(path,method,body,respond)=>method==='PUT'&&reject?respond(422,{code:'IDE_SSH_FILE_MISSING',error:'Soubor SSH klíče neexistuje. Opravte cestu.'}):null}),c=f.controller;
  await c.load('ucet');c.openAccount('ucet',c.resource('ucet').accounts[0]);c.editors.get('ucet').draft.name='Moje rozepsaná změna';
  assert.equal(await c.save('ucet'),false);assert.equal(c.editors.get('ucet').blocked,false);assert.equal(c.editors.get('ucet').draft.name,'Moje rozepsaná změna');
  reject=false;assert.equal(await c.save('ucet'),true);assert.equal(f.accounts[0].name,'Moje rozepsaná změna');
});
