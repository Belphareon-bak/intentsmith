import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiveModel } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
const { AppearanceStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');
const { WorkspaceFiles } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/workspace-files');
const { CatalogStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/catalog-store');
const { IntentSmithBus } = require('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/event-bus');

function setup({ workspace, m2, catalog: catalogOverride } = {}) {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const store = new SessionStore(storage);
  const appearance = new AppearanceStore(storage);
  const catalog = catalogOverride || { view: () => ({ status: 'idle', items: [] }), load: () => {}, subscribe: () => () => {} };
  const files = workspace || { entry: () => ({ tree: [], editor: null }), loadTree: async () => false,
    open: async () => false, save: async () => false, discard: () => {}, edit: () => {} };
  const controller = m2 || { entry: () => ({ view: null, presentedView: null, error: null }), run: async () => {}, report: () => {} };
  const calls = [];
  const widget = { store, appearance, catalog, workspace: files, m2: controller,
    send: async (session, input) => { calls.push(['send', session.id, input.value]); input.value = ''; },
    sendTerminal: async (session, input) => { calls.push(['terminal', session.id, input.value]); input.value = ''; },
    completeTerminal: async (session, input) => { calls.push(['complete', session.id, input.value]); input.value += '/'; },
    pickAttachments: async session => { calls.push(['attach', session.id]); },
    closeSession: session => store.closeSession(session.id) };
  const model = new LiveModel(widget);
  return { model, widget, store, calls, storage };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('M4 composer commands stay in the project and never reach the ordinary chat transport', async () => {
  const { model, store, calls } = setup();
  const session = store.focusedSession();
  session._projectId = '17'; session._convId = 'conversation-17';
  const paths = [];
  model.widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  model.fetchImpl = async url => {
    paths.push(new URL(url).pathname);
    return { ok: true, json: async () => ({ contract: 'LearningProposalReviewList', version: 1,
      projectId: 17, stateFilter: 'pending', reviews: [] }) };
  };
  model.setState({ drafts: { [session.id]: '/m4-learning pending' } });
  const patch = model.pSend(model.st(), session.id);
  model.setState(patch);
  await tick(); await tick();
  assert.deepEqual(paths, ['/api/projects/17/learning/proposals']);
  assert.equal(calls.length, 0);
  assert.equal(model.st().drafts[session.id], '');
  assert.deepEqual(session.chat.msgs.map(message => message.role), ['user', 'assistant']);
  assert.match(session.chat.msgs[1].text, /Count: 0/);
  session.chat._thinking = { text: 'M1 běží' };
  model.setState({ drafts: { [session.id]: '/m4-learning pending' } });
  assert.equal(model.pSend(model.st(), session.id), null);
  assert.equal(paths.length, 1);
  assert.equal(model.st().drafts[session.id], '/m4-learning pending');
});

test('M7 pairing in Security accepts only an exact short-lived local claim and keeps it out of storage', async () => {
  const { model, widget, storage } = setup();
  const calls = [];
  widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'zabezpeceni' },
    dtab: { 'settings:zabezpeceni': 'pristup' } });
  const vm = model.detailVM(model.st());
  assert.equal(vm.blocks[0].isPairing, true);
  assert.equal(vm.blocks[0].pairing.hasClaim, false);
  const selected = model._pairing.selectedScopes.slice();
  const code = 'A'.repeat(22);
  model.fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ claimCode: code, claimId: 'pairing-claim:' + 'B'.repeat(24),
      contract: 'M7LocalPairingClaim', expiresAt: new Date(Date.now() + 120_000).toISOString(),
      pairingUri: 'intentsmith://pair?code=' + code, scopes: selected,
      subjectId: 'local-user', version: 1 }) };
  };
  try {
    assert.equal(await vm.blocks[0].pairing.issue(), true);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0][0]).pathname, '/api/m7/remote/pairing/claims');
    assert.equal(calls[0][1].credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[0][1].body), { scopes: selected });
    assert.equal(model.pairingVM().code, code);
    assert.equal(model.pairingVM().disabled, true, 'a live claim cannot be replaced or broadened');
    assert.equal(model.togglePairingScope('write:chat'), false);
    assert.equal(await model.issuePairingClaim(), false);
    assert.equal(calls.length, 1);
    assert.equal(['intentsmith-studio2-session-state', 'intentsmith-studio2-layout']
      .some(key => storage.getItem(key)?.includes(code)), false);
  } finally { model.componentWillUnmount(); }
  const { model: malformed, widget: second } = setup();
  second.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  malformed.fetchImpl = async () => ({ ok: true, json: async () => ({ claimCode: code }) });
  assert.equal(await malformed.issuePairingClaim(), false);
  assert.equal(malformed.pairingVM().hasClaim, false);
  assert.match(malformed.pairingVM().error, /nepodařilo bezpečně/);
});

test('settings preserve twelve prototype categories and verify live feature changes against backend', async () => {
  let features = { skills: true, agents: false };
  let fail = false, approved = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method || 'GET';
    calls.push([method, path]);
    if (path === '/api/features' && method === 'GET') return { ok: true, json: async () => ({ features: { ...features } }) };
    if (path === '/api/system/models') return { ok: true, json: async () => ({
      models: [{ name: 'local-model:latest', size: 2 * 1024 ** 3, digest: 'sha256:abc' }],
      ollama_url: 'http://127.0.0.1:11434', current_model: 'local-model:latest' }) };
    if (path === '/api/storage/info') return { ok: true, json: async () => ({ totalSize: 1024 ** 2 }) };
    if (fail) return { ok: false, status: 503, json: async () => ({ error: 'Backend selhal' }) };
    if (path === '/api/features/reset') features = { skills: true, agents: true };
    else if (path === '/api/features/skills') features = { ...features, skills: JSON.parse(options.body).enabled };
    else throw Error('Unexpected request: ' + path);
    return { ok: true, json: async () => ({ ok: true, features: { ...features } }) };
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model, widget } = setup({ catalog });
  model.fetchImpl = fetchImpl;
  widget.confirmAction = () => approved;
  assert.deepEqual(model.data().SET.map(category => category.name), [
    'Účet', 'Modely a inference', 'Paměť', 'Oznámení', 'Výstup', 'Vzhled',
    'Systém', 'Úložiště', 'Zálohy', 'Funkční přepínače', 'Zabezpečení', 'O aplikaci']);
  assert.deepEqual(model.data().SET.map(category => category.tabs.length), [2, 4, 3, 2, 2, 5, 4, 2, 3, 2, 3, 2]);
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'prepinace' } });
  await model.loadSettingsResource('prepinace');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].m, 'vypnuto');
  assert.equal(await model.toggleFeature('skills', false), false, 'rejected confirmation sends no mutation');
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
  approved = true; fail = true;
  assert.equal(await model.toggleFeature('skills', false), false);
  assert.match(model._settingsNotice, /Backend selhal/);
  assert.equal(model.detailVM(model.st()).blocks.at(-1).rows.find(row => row.t === 'skills').m, 'zapnuto');
  fail = false;
  assert.equal(await model.toggleFeature('skills', false), true);
  assert.equal(model.detailVM(model.st()).blocks.at(-1).rows.find(row => row.t === 'skills').m, 'vypnuto');
  model.detailVM(model.st()).tabs.find(tab => tab.label === 'Obnovení').go();
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Obnovit přepínače');
  assert.equal(await model.resetFeatures(), true);
  assert.equal(features.skills, true);
  model.setState({ detail: { settings: 'modely' } });
  await model.loadSettingsResource('modely');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].t, 'local-model:latest');
  model.setState({ detail: { settings: 'uloziste' } });
  await model.loadSettingsResource('uloziste');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].m, '1.00 MiB');
});

test('marketplace detail uses confirmed backend mutations and never claims success after failure', async () => {
  let installed = false, fail = false, approved = false;
  const calls = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push([options.method || 'GET', path]);
      if (path === '/api/marketplace/catalog') return { ok: true, json: async () => ({
        items: [{ id: 'pkg-a', name: 'Balíček A', type: 'skill', version: '1.2.3', installed }] }) };
      if (path === '/api/marketplace/install/skill/pkg-a') {
        if (fail) return { ok: false, status: 503, json: async () => ({ error: 'Instalace selhala' }) };
        installed = true;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (path === '/api/marketplace/installed/skill/pkg-a') {
        installed = false;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => approved;
  await catalog.load('Obchod');
  model.setState({ mode: 'section', section: 'market', detail: { market: 'skill:pkg-a' } });
  let vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Nainstalovat');
  assert.equal(await vm.onPrimary(), false, 'rejected confirmation has no effect');
  assert.equal(calls.filter(([method]) => method !== 'GET').length, 0);
  approved = true; fail = true;
  assert.equal(await vm.onPrimary(), false, 'failed backend response remains failed');
  assert.match(widget.catalogActionError, /Instalace selhala/);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Nainstalovat');
  fail = false;
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(widget.catalogActionError, null);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Odinstalovat');
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Nainstalovat');
  assert.deepEqual(calls.filter(([method]) => method !== 'GET'), [
    ['POST', '/api/marketplace/install/skill/pkg-a'],
    ['POST', '/api/marketplace/install/skill/pkg-a'],
    ['DELETE', '/api/marketplace/installed/skill/pkg-a']]);
});

test('project wizard confirms create or open only after backend response and catalog readback', async () => {
  const posts = [];
  let conflict = true, projects = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/projects/defaults') return { ok: true, json: async () => ({ defaultDir: '/home/user/projects' }) };
      if (path === '/api/projects') return { ok: true, json: async () => ({ projects }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  model.scmClient.load = () => {};
  model.loadProjectConversations = () => {};
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body);
    posts.push([path, body]);
    if (path === '/api/projects' && conflict) return { ok: false, status: 409,
      json: async () => ({ error: 'Projekt už existuje' }) };
    const project = path === '/api/projects' ? { id: 41, name: body.name, path: '/home/user/projects/novy' }
      : { id: 42, name: 'Import', path: '/home/user/existing' };
    projects = [...projects, project];
    return { ok: true, json: async () => ({ project }) };
  };
  await model.loadProjectDefaults();
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' }, projectStep: 1,
    projectName: 'Nový', projectDescription: 'Popis', projectType: 'general' });
  let form = model.projectWizardVM(model.st());
  assert.equal(form.reviewTarget, '/home/user/projects/Novy'.toLowerCase());
  assert.equal(form.submitDisabled, false);
  assert.equal(await model.submitProject(model.st()), false);
  assert.match(widget.catalogActionError, /Projekt už existuje/);
  assert.equal(model.projectStatus().uncertain, false, 'explicit HTTP conflict may be corrected');
  conflict = false;
  assert.equal(await model.submitProject(model.st()), true);
  assert.equal(model.st().detail.projects, '41');
  assert.equal(model.detailVM(model.st()).title, 'Nový');
  assert.deepEqual(posts[1], ['/api/projects', { name: 'Nový', description: 'Popis', type: 'general' }]);
  model.setState({ detail: { projects: '__new__' }, projectStep: 1, projectMode: 'open',
    projectName: '', projectPath: '/home/user/existing' });
  assert.equal(await model.submitProject(model.st()), true);
  assert.equal(model.st().detail.projects, '42');
  assert.deepEqual(posts[2], ['/api/projects/open-folder', { folderPath: '/home/user/existing' }]);
});

test('specialist wizard creates reviewed package and verifies manifest before opening catalog detail', async () => {
  let conflict = true, installed = false, postCount = 0;
  const name = "Překladatelův 'asistent'";
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/specialists') return { ok: true, json: async () => ({
        specialists: installed ? [{ id: 'pekladatelv-asistent', name, status: 'enabled', domain: 'language' }] : [] }) };
      if (path === '/api/specialists/pekladatelv-asistent') return { ok: true,
        json: async () => ({ ok: true, id: 'pekladatelv-asistent', manifest: { name, domain: 'language' } }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/specialists');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).description, "Řádek 'jeden'\nDruhý řádek");
    postCount++;
    if (conflict) return { ok: false, status: 409, json: async () => ({ error: 'Již existuje' }) };
    installed = true;
    return { ok: true, json: async () => ({ ok: true, specialist: { id: 'pekladatelv-asistent' } }) };
  };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' },
    specialistStep: 1, specialistName: name, specialistDomain: 'language',
    specialistDescription: "Řádek 'jeden'\nDruhý řádek", specialistIcon: '🧠' });
  assert.equal(model.specialistWizardVM(model.st()).reviewId, 'pekladatelv-asistent');
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(model.specialistStatus().uncertain, false, 'explicit 409 permits correction');
  conflict = false;
  assert.equal(await model.submitSpecialist(model.st()), true);
  assert.equal(model.st().detail.specialists, 'pekladatelv-asistent');
  assert.equal(model.detailVM(model.st()).title, name);
  assert.equal(postCount, 2);
});

test('specialist wizard never retries an uncertain package creation', async () => {
  let postCount = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => {
    throw Error('No readback expected after lost response');
  } });
  const { model } = setup({ catalog });
  model.fetchImpl = async () => { postCount++; throw Error('Connection lost'); };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' },
    specialistStep: 1, specialistName: 'Analyst', specialistDomain: 'general' });
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(model.specialistStatus().uncertain, true);
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(postCount, 1);
});

test('worker wizard installs only a disabled M3 project-health instance with exact readback', async () => {
  let installed = false, postCount = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/agent-extensions') return { ok: true, json: async () => ({ extensions: [
        { id: 'project-health', name: 'Project Health', requiredCapabilities: ['code-intel.project-context.v1'] },
        { id: 'unknown', name: 'Unknown', requiredCapabilities: [] }] }) };
      if (path === '/api/projects') return { ok: true, json: async () => ({ projects: [{ id: 41, name: 'Repo' }] }) };
      if (path === '/api/agents') return { ok: true, json: async () => ({ agents: installed ? [
        { id: 'health-repo', name: 'Project Health', enabled: false }] : [] }) };
      if (path === '/api/agents/health-repo') return { ok: true, json: async () => ({
        id: 'health-repo', enabled: false, params: { project_id: 41 },
        definition: { m3_extension: { id: 'project-health' }, schedule: { type: 'manual' } }, recentRuns: [] }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    postCount++;
    assert.equal(new URL(url).pathname, '/api/agent-extensions/project-health/install');
    assert.deepEqual(JSON.parse(options.body), { instanceId: 'health-repo', projectId: 41, enabled: false });
    installed = true;
    return { ok: true, json: async () => ({ id: 'health-repo', enabled: false,
      definition: { m3_extension: { id: 'project-health' } } }) };
  };
  model.setState({ mode: 'section', section: 'workers', detail: { workers: '__new__' },
    workerStep: 1, workerExtension: 'project-health', workerProject: '41', workerInstanceId: 'health-repo' });
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, true, 'unloaded extension cannot be installed');
  await model.loadWorkerWizard();
  assert.deepEqual(model.workerStatus().extensions.map(item => item.id), ['project-health']);
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, false);
  assert.equal(await model.submitWorker(model.st()), true);
  assert.equal(model.st().detail.workers, 'health-repo');
  assert.equal(postCount, 1);
});

test('worker wizard never repeats installation after uncertain response', async () => {
  let posts = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ extensions: [], projects: [] }) }) });
  const { model } = setup({ catalog });
  model._workerWizardStatus = { loading: false, busy: false, error: '', uncertain: false,
    extensions: [{ id: 'project-health', name: 'Project Health' }], projects: [{ id: 41, name: 'Repo' }] };
  model.fetchImpl = async () => { posts++; throw Error('Response lost'); };
  model.setState({ mode: 'section', section: 'workers', detail: { workers: '__new__' },
    workerStep: 1, workerExtension: 'project-health', workerProject: '41', workerInstanceId: 'health-repo' });
  assert.equal(await model.submitWorker(model.st()), false);
  assert.equal(model.workerStatus().uncertain, true);
  assert.equal(await model.submitWorker(model.st()), false);
  assert.equal(posts, 1);
});

test('expertise wizard previews the exact configuration and verifies saved identity', async () => {
  let installed = false, previews = 0, saves = 0, savedConfig;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/expertises') return { ok: true, json: async () => ({ experts: installed ? [
        { id: 'custom_expert', name: 'Custom Expert', isCustom: true }] : [] }) };
      if (path === '/api/expertises/custom_expert') return { ok: true,
        json: async () => savedConfig };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body);
    if (path === '/api/merge-preview') {
      previews++;
      assert.equal(body.expertises[0].capabilities.reasoning, 70);
      return { ok: true, json: async () => ({ promptPreview: 'Ověřený náhled', tokenCount: 22,
        requiresConfirmation: false }) };
    }
    if (path === '/api/expertises') {
      saves++;
      assert.equal(body.id, 'custom_expert');
      assert.equal(body.temperature, 0.4);
      savedConfig = body;
      installed = true;
      return { ok: true, json: async () => ({ id: body.id, name: body.name }) };
    }
    throw Error('Unexpected mutation: ' + path);
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Custom Expert', expertiseDomain: 'technology',
    expertiseReasoning: 70, expertiseTemperature: 0.4 });
  assert.equal(await model.previewExpertise(model.st()), true);
  assert.equal(model.expertiseWizardVM(model.st()).previewText, 'Ověřený náhled');
  assert.equal(await model.submitExpertise(model.st()), true);
  assert.equal(previews, 1, 'unchanged preview is reused for this exact configuration');
  assert.equal(saves, 1);
  assert.equal(model.st().detail.expertises, 'custom_expert');
});

test('expertise wizard does not repeat uncertain save and discards stale preview', async () => {
  let previews = 0, saves = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ experts: [] }) }) });
  const { model } = setup({ catalog });
  model.fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (path === '/api/merge-preview') {
      previews++;
      return { ok: true, json: async () => ({ promptPreview: 'náhled', tokenCount: 12 }) };
    }
    saves++;
    throw Error('Lost response');
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Test Expert' });
  assert.equal(await model.previewExpertise(model.st()), true);
  model.setState({ expertiseTemperature: 0.6 });
  assert.equal(model.expertiseWizardVM(model.st()).hasPreview, false);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(previews, 2);
  assert.equal(model.expertiseStatus().uncertain, true);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(saves, 1);
});

test('advanced expertise rules are bounded and model test needs explicit approval', async () => {
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ experts: [] }) }) });
  const { model, widget } = setup({ catalog });
  let approved = false, calls = 0;
  widget.confirmAction = () => approved;
  model.fetchImpl = async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/expertise-wizard/test-prompt');
    const body = JSON.parse(options.body);
    assert.equal(body.question, 'Jaký je stav?');
    assert.deepEqual(body.expertiseConfig.modules.domain_rules, ['Pravidlo A', 'Pravidlo B']);
    assert.deepEqual(body.expertiseConfig.inheritance, { vocabulary: 'extend' });
    assert.equal(body.expertiseConfig.capabilities.riskTolerance, 15);
    return { ok: true, json: async () => ({ response: 'Ověřená odpověď', model: 'local', duration: 10 }) };
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Test Expert', expertiseAdvanced: true,
    expertiseDomainRules: 'Pravidlo A\nPravidlo B', expertiseInheritance: '{"vocabulary":"extend"}',
    expertiseRiskTolerance: 15, expertiseTestQuestion: 'Jaký je stav?' });
  assert.equal(model.expertiseWizardVM(model.st()).testDisabled, false);
  assert.equal(await model.testExpertise(model.st()), false);
  assert.equal(calls, 0);
  approved = true;
  assert.equal(await model.testExpertise(model.st()), true);
  assert.equal(model.expertiseWizardVM(model.st()).testResult, 'Ověřená odpověď');
  model.setState({ expertiseTestQuestion: 'Jiný dotaz' });
  assert.equal(model.expertiseWizardVM(model.st()).hasTestResult, false, 'answer belongs to exact question');
  model.setState({ expertiseInheritance: '{' });
  assert.equal(model.expertiseWizardVM(model.st()).submitDisabled, true);
  assert.equal(model.expertiseWizardVM(model.st()).hasTestResult, false);
  model.setState({ expertiseInheritance: '{"__proto__":"extend"}' });
  assert.equal(model.expertiseWizardVM(model.st()).submitDisabled, true);
  model.setState({ expertiseInheritance: '{}', expertiseTestQuestion: 'x'.repeat(2001) });
  assert.equal(model.expertiseWizardVM(model.st()).testDisabled, true);
});

test('custom expertise edit keeps its identity and refuses stale or uncertain updates', async () => {
  const original = { id: 'writer', name: 'Writer', description: 'První verze', domain: 'custom',
    icon: '✍', tone: 'professional', temperature: 0.5, systemPrompt: '', isCustom: true,
    capabilities: { reasoning: 50, creativity: 60, determinism: 50, riskTolerance: 50, verbosity: 50 },
    modules: { domain_rules: [], emphasis: [], constraints: [], vocabulary: [], antipatterns: [], disclaimer: null },
    inheritance: {}, styleRules: { forbiddenPhrases: [], minResponseLength: 50 } };
  let current = { ...original }, puts = 0, loseResponse = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async url => {
    const path = new URL(url).pathname;
    if (path === '/api/expertises/writer') return { ok: true, json: async () => ({ ...current }) };
    if (path === '/api/expertises') return { ok: true, json: async () => ({ experts: [{ ...current }] }) };
    throw Error(path);
  } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/merge-preview') return { ok: true, json: async () => ({ promptPreview: 'náhled', tokenCount: 5 }) };
    assert.equal(path, '/api/expertises/writer');
    assert.equal(options.method, 'PUT');
    assert.match(options.headers['If-Match'], /^"sha256:[0-9a-f]{64}"$/);
    puts++;
    if (loseResponse) throw Error('Lost response');
    current = { ...current, ...JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ...current }) };
  };
  await catalog.load('Expertýzy');
  const item = catalog.view('Expertýzy').items[0];
  assert.equal(await model.openExpertiseEdit(item), true);
  assert.equal(model.st().detail.expertises, '__edit__');
  assert.equal(model.st().expertiseEditingId, 'writer');
  assert.equal(model.expertiseConfig(model.st()).styleRules.minResponseLength, 50);
  model.setState({ expertiseStep: 1, expertiseName: 'Writer revised' });
  assert.equal(model.expertiseConfig(model.st()).id, 'writer');
  current = { ...current, description: 'cizí změna' };
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(puts, 0);
  assert.match(model.expertiseStatus().error, /změnila/);
  current = { ...original };
  assert.equal(await model.submitExpertise(model.st()), true);
  assert.equal(puts, 1);
  assert.equal(current.name, 'Writer revised');
  assert.equal(model.st().detail.expertises, 'writer');
  assert.equal(await model.openExpertiseEdit(catalog.view('Expertýzy').items[0]), true);
  model.setState({ expertiseStep: 1, expertiseName: 'Writer revised again' });
  loseResponse = true;
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(model.expertiseStatus().uncertain, true);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(puts, 2);
  assert.equal(await model.openExpertiseEdit({ id: 'developer', raw: { isCustom: false } }), false);
});

test('expertise update route requires matching revision, keeps ID and rolls back failed persistence', async () => {
  const { createExpertiseRoutes } = await import('../src/routes/expertises.js');
  const { createHash } = await import('node:crypto');
  const path = await import('node:path');
  const data = { id: 'writer', name: 'Writer', domain: 'custom', isCustom: true };
  const asExpert = value => ({ ...value, toJSON() { return { id: this.id, name: this.name,
    domain: this.domain, isCustom: this.isCustom }; } });
  const registry = new Map([['writer', asExpert(data)]]);
  let failSave = false, result;
  const routes = createExpertiseRoutes({ expertiseLayer: { expertiseRegistry: {
    get: id => registry.get(id), getCustom: () => [...registry.values()],
    updateCustom: (id, body) => { const next = asExpert({ ...registry.get(id).toJSON(), ...body }); registry.set(id, next); return next; },
    register: expert => registry.set(expert.id, expert), removeCustom: id => registry.delete(id)
  } }, parseBody: async req => req.body, sendJSON: (_res, status, body) => { result = { status, body }; },
  safeError: error => ({ error: error.message }), logger: { debug() {} }, path,
  db: { db: { transaction: fn => fn, exec() {}, prepare: () => ({ run() { if (failSave) throw Error('db failed'); } }) } } });
  const revision = '"sha256:' + createHash('sha256').update(JSON.stringify(registry.get('writer').toJSON())).digest('hex') + '"';
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': '"sha256:stale"' },
    body: { name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 412);
  assert.equal(registry.get('writer').name, 'Writer');
  failSave = true;
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': revision },
    body: { id: 'spoofed', name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 500);
  assert.equal(registry.get('writer').name, 'Writer');
  failSave = false;
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': revision },
    body: { id: 'spoofed', name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 200);
  assert.equal(registry.get('writer').id, 'writer');
  assert.equal(registry.get('writer').name, 'Updated');
});

test('project wizard treats lost mutation response as uncertain and never retries automatically', async () => {
  let posts = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async () => ({ ok: true, json: async () => ({ projects: [] }) }) });
  const { model } = setup({ catalog });
  model.fetchImpl = async () => { posts++; throw Error('socket closed'); };
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' },
    projectStep: 1, projectName: 'Nový' });
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(model.projectStatus().uncertain, true);
  assert.equal(model.projectWizardVM(model.st()).submitDisabled, true);
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(posts, 1);
});

test('worker detail runs only a verified M3 extension through its active route', async () => {
  const calls = [];
  let enabled = true, rejectRun = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push([options.method || 'GET', path]);
      if (path === '/api/agents') return { ok: true, json: async () => ({ agents: [
        { id: 'worker-m3', name: 'Nový worker', enabled },
        { id: 'legacy', name: 'Starý worker', enabled: true }] }) };
      if (path === '/api/agents/worker-m3') return { ok: true, json: async () => ({
        id: 'worker-m3', enabled, definition: { m3_extension: { id: 'approved-extension' }, schedule: { type: 'manual' } }, recentRuns: [] }) };
      if (path === '/api/agents/legacy') return { ok: true, json: async () => ({
        id: 'legacy', enabled: true, definition: { schedule: { type: 'manual' } }, recentRuns: [] }) };
      if (path === '/api/agent-extensions/instances/worker-m3/run') return rejectRun
        ? { ok: false, status: 409, json: async () => ({ error: 'Worker je zaneprázdněný.' }) }
        : { ok: true, json: async () => ({ runId: 'run-1' }) };
      if (path === '/api/agent-extensions/instances/worker-m3/disable') {
        enabled = false;
        return { ok: true, json: async () => ({ id: 'worker-m3', enabled: false }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  await catalog.load('Workeři');
  await model.loadWorkerDetail('worker-m3');
  model.setState({ mode: 'section', section: 'workers', detail: { workers: 'worker-m3' } });
  let vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, true);
  rejectRun = true;
  assert.equal(await vm.onPrimary(), false);
  assert.match(widget.catalogActionError, /zaneprázdněný/);
  rejectRun = false;
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(await model.detailVM(model.st()).secondary[0].go(), true);
  assert.equal(model.detailVM(model.st()).hasPrimary, false);
  await model.loadWorkerDetail('legacy');
  model.setState({ detail: { workers: 'legacy' } });
  vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, false);
  assert.deepEqual(vm.secondary, []);
  assert.match(JSON.stringify(vm.blocks), /legacy worker/);
  assert.equal(calls.some(([, path]) => path.startsWith('/api/agents/worker-m3/run')), false);
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path.includes('/worker-m3/run')).length, 2);
});

test('media history actions refresh real state and report deferred cancellation honestly', async () => {
  const id = 'gen-1790400000000-30e4aab2';
  const calls = [];
  let status = 'running', favorite = 0, deleted = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      const method = options.method || 'GET';
      calls.push([method, path, options.body && JSON.parse(options.body)]);
      if (path.startsWith('/api/media/history')) return { ok: true, json: async () => ({
        generations: deleted ? [] : [{ id, type: 'txt2img', prompt: 'Krajina', status, favorite }] }) };
      if (path === '/api/media/cancel?id=' + id) return { ok: true,
        json: async () => ({ ok: true, message: 'Zrušení se projeví po dokončení aktuální úlohy' }) };
      if (path === '/api/media/favorite') {
        favorite = options.body && JSON.parse(options.body).favorite ? 1 : 0;
        return { ok: true, json: async () => ({ ok: true, favorite }) };
      }
      if (path === '/api/media?id=' + id) {
        deleted = true;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  await catalog.load('Multimédia');
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  let vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Zrušit generování');
  assert.equal(await vm.onPrimary(), true);
  vm = model.detailVM(model.st());
  assert.equal(vm.status, 'running', 'deferred cancellation must not appear complete');
  assert.match(JSON.stringify(vm.blocks), /po dokončení aktuální úlohy/);
  assert.equal(await vm.secondary[0].go(), true);
  assert.match(model.detailVM(model.st()).secondary[0].label, /Odebrat/);
  assert.deepEqual(calls.find(([method]) => method === 'PUT')[2], { id, favorite: true });
  status = 'completed';
  await catalog.load('Multimédia');
  vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, false);
  assert.equal(await vm.secondary[1].go(), true);
  assert.equal(model.detailVM(model.st()), null);
  assert.deepEqual(calls.filter(([method]) => method !== 'GET').map(([method, path]) => [method, path]), [
    ['POST', '/api/media/cancel?id=' + id], ['PUT', '/api/media/favorite'], ['DELETE', '/api/media?id=' + id]]);
});

test('media form verifies ComfyUI and checkpoint, validates inputs, and observes accepted generation in history', async () => {
  const id = 'gen-1790400000001-4bcbd01a', requests = [];
  let available = false, started = false, rejectGenerate = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      requests.push([method, path, options.body && JSON.parse(options.body)]);
      if (path === '/api/media/health') return { ok: true, json: async () => ({ available }) };
      if (path === '/api/media/models') return { ok: true, json: async () => ({ checkpoints: ['real-checkpoint.safetensors'] }) };
      if (path === '/api/media/history') return { ok: true, json: async () => ({
        generations: started ? [{ id, type: 'txt2img', prompt: 'Krajina', status: 'pending' }] : [] }) };
      if (path === '/api/media/generate') {
        if (rejectGenerate) return { ok: false, status: 502, json: async () => ({ error: 'ComfyUI odmítlo plán' }) };
        started = true;
        return { ok: true, json: async () => ({ ok: true, generationId: id }) };
      }
      throw Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  await catalog.load('Multimédia');
  model.setState(model.pSelect(model.st(), 'media', '__new__'));
  await tick();
  assert.equal(model.mediaFormVM(model.st()).disabled, true, 'offline ComfyUI blocks generation');
  assert.equal(await model.submitMedia(model.st()), false);
  available = true;
  assert.equal(await model.loadMediaEnvironment(), true);
  model.setState({ mediaPrompt: 'Krajina', mediaWidth: 63 });
  assert.equal(model.mediaFormVM(model.st()).disabled, true, 'invalid dimensions block generation');
  model.setState({ mediaWidth: 1024 });
  const form = model.mediaFormVM(model.st());
  assert.equal(form.model, 'real-checkpoint.safetensors');
  assert.equal(form.disabled, false);
  rejectGenerate = true;
  assert.equal(await form.submit(), false);
  assert.match(widget.catalogActionError, /ComfyUI odmítlo plán/);
  assert.equal(model.st().detail.media, '__new__');
  rejectGenerate = false;
  assert.equal(await model.mediaFormVM(model.st()).submit(), true);
  assert.equal(model.st().detail.media, id);
  assert.equal(model.detailVM(model.st()).status, 'pending');
  assert.deepEqual(requests.filter(([method]) => method === 'POST').at(-1)[2], {
    type: 'txt2img', prompt: 'Krajina', negative_prompt: '',
    params: { width: 1024, height: 1024, steps: 20, cfg_scale: 7, seed: -1, model: 'real-checkpoint.safetensors' }
  });
});

test('completed media loads only safe output names as local object URLs', async () => {
  const id = 'gen-1790400000002-c48a8dc7', requests = [];
  const raw = { id, type: 'txt2img', prompt: 'Krajina', status: 'completed',
    outputs: JSON.stringify([`/home/user/.intentsmith/media/images/${id}/result.png`,
      `/home/user/.intentsmith/media/images/${id}/bad.html`,
      `/home/user/.intentsmith/media/images/${id}/error.webp`]) };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      assert.equal(new URL(url).pathname, '/api/media/history');
      return { ok: true, json: async () => ({ generations: [raw] }) };
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async url => {
    requests.push(url);
    return { ok: true, blob: async () => new Blob(['fake'], { type: url.includes('error.webp') ? 'text/html' : 'image/png' }) };
  };
  await catalog.load('Multimédia');
  const item = catalog.view('Multimédia').items[0];
  await model.loadMediaOutputs(item);
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  const outputs = model.detailVM(model.st()).blocks.find(block => block.isMediaOutputs).mediaOutputs;
  assert.deepEqual(outputs.map(output => output.name), ['result.png', 'error.webp']);
  assert.equal(outputs[0].ready, true);
  assert.match(outputs[0].url, /^blob:/);
  assert.equal(outputs[1].ready, false);
  assert.match(outputs[1].status, /nepodporovaný formát/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => url.includes('/api/media/output?id=' + id)));
  model.componentWillUnmount();
});

test('media WS events update progress and verify terminal state from history without a second transport', async () => {
  const id = 'gen-1790400000003-784bc072';
  let status = 'running', loads = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      assert.equal(new URL(url).pathname, '/api/media/history');
      loads++;
      return { ok: true, json: async () => ({ generations: [{ id, type: 'txt2img',
        prompt: 'Krajina', status, outputs: '[]' }] }) };
    } });
  const { model } = setup({ catalog });
  model.statusClient.start = () => {};
  await catalog.load('Multimédia');
  model.componentDidMount();
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  IntentSmithBus.emit('comfyui:progress', { generationId: id, percent: 42, text: 'Generuji' });
  assert.match(JSON.stringify(model.detailVM(model.st()).blocks), /Generuji · 42 %/);
  IntentSmithBus.emit('comfyui:complete', { generationId: 'other-id' });
  assert.equal(loads, 1, 'invalid ID does not trigger refresh');
  status = 'completed';
  IntentSmithBus.emit('comfyui:complete', { generationId: id });
  await tick(); await tick();
  assert.equal(loads, 2);
  assert.equal(model.detailVM(model.st()).status, 'completed');
  assert.match(JSON.stringify(model.detailVM(model.st()).blocks), /Generování dokončeno/);
  model.componentWillUnmount();
  IntentSmithBus.emit('comfyui:progress', { generationId: id, percent: 99, text: 'Pozdě' });
  assert.doesNotMatch(JSON.stringify(model.detailVM(model.st()).blocks), /Pozdě/);
});

test('live view contains only actual sessions and messages, and swaps column ownership', () => {
  const { model, store } = setup();
  const first = store.focusedSession();
  first._label = 'Moje skutečná relace';
  first.chat.msgs.push({ role: 'user', text: 'Ahoj' }, { role: 'assistant', text: 'Odpověď' });
  const second = store.addSession({ label: 'Druhá skutečná relace' });
  store.setColumnCount(2);
  store.selectInColumn(0, first.id);
  let vm = model.renderVals();
  assert.equal(vm.tabs.length, 2);
  assert.equal(vm.columns[0].title, first._label);
  assert.equal(vm.columns[0].msgs[0].text, 'Ahoj');
  assert.equal(vm.columns[0].msgs[1].paras[0].t, 'Odpověď');
  assert.doesNotMatch(JSON.stringify(vm.columns.map(column => column.title)), /ShellSmith|SystemSmith/);
  model.pPickInCol(model.st(), 0, second.id);
  assert.deepEqual(store.state.columns, [second.id, first.id]);
  vm = model.renderVals();
  assert.equal(vm.columns[0].title, second._label);
  assert.equal(vm.columns[1].title, first._label);
  assert.equal(vm.ws.scm.unavailable, false);
});

test('composer, attachment picker and terminal use widget services without prototype replies', async () => {
  const { model, store, calls } = setup();
  const session = store.focusedSession();
  let column = model.renderVals().columns[0];
  column.setDraft({ target: { value: 'Živý dotaz' } });
  model.renderVals().columns[0].send();
  await tick();
  assert.deepEqual(calls[0], ['send', session.id, 'Živý dotaz']);
  assert.equal(model.st().drafts[session.id], '');
  assert.equal(model.renderVals().columns[0].msgs.length, 0);
  model.renderVals().columns[0].attach();
  await tick();
  assert.deepEqual(calls[1], ['attach', session.id]);
  column = model.renderVals().columns[0];
  column.setCmd({ target: { value: 'pwd' } });
  model.termKey({ key: 'Enter', preventDefault() {} }, session.id);
  await tick();
  assert.deepEqual(calls[2], ['terminal', session.id, 'pwd']);
  assert.equal(model.renderVals().columns[0].term.length, 0);
});

test('file editor opens through WorkspaceFiles and saves through its verified path', async () => {
  const requests = [];
  let current = 'původní';
  const response = body => ({ ok: true, json: async () => body });
  const workspace = new WorkspaceFiles({ backendUrl: () => 'http://studio.test', fetchImpl: async (url, options = {}) => {
    requests.push([url, options.method || 'GET']);
    if (url.includes('/api/workspace/tree')) return response({ root: '/safe/project', tree: [{ n: 'app.txt', d: false }] });
    if (options.method === 'POST') { current = JSON.parse(options.body).content; return response({ ok: true, path: 'app.txt' }); }
    return response({ path: 'app.txt', content: current, hash: 'hash-' + current });
  } });
  const { model, store } = setup({ workspace });
  const session = store.focusedSession();
  session._projectId = '17';
  assert.equal(await workspace.loadTree(session), true);
  model.pOpenFile(model.st(), session.id, { path: 'app.txt', from: 'soubory', mode: 'upravy' });
  await tick();
  let file = model.renderVals().ws.fvS;
  assert.equal(file.isOpen, true);
  assert.equal(file.draft, 'původní');
  file.setDraft({ target: { value: 'upravené' } });
  file = model.renderVals().ws.fvS;
  assert.equal(file.dirty, true);
  const guard = model.pOpenFile(model.st(), session.id, null);
  assert.equal(guard.fileGuard.sid, session.id);
  assert.equal(requests.filter(([, method]) => method === 'POST').length, 0);
  await file.save();
  assert.equal(requests.filter(([, method]) => method === 'POST').length, 1);
  assert.equal(workspace.entry(session).editor.dirty, false);
  assert.equal(model.renderVals().ws.fvS.draft, 'upravené');
});

test('file tree actions bind the prototype form to project-scoped verified operations', async () => {
  const revision = 'a'.repeat(64), operations = [];
  const state = { root: '/safe/project', projectId: '17', tree: [
    { path: 'src', name: 'src', depth: 0, directory: true },
    { path: 'src/main.js', name: 'main.js', depth: 1, directory: false }], editor: null };
  const workspace = { entry: () => state, inspect: async (_session, path) => ({ projectId: 17, path,
    type: path === 'src' ? 'directory' : 'file', revision,
    ...(path === 'src' ? { entries: 1, protectedDescendants: false } : {}) }),
    operate: async (_session, operation) => { operations.push(operation); return true; },
    loadTree: async () => true, open: async () => false, save: async () => false, discard: () => {}, edit: () => {} };
  const { model, store } = setup({ workspace });
  const session = store.focusedSession(); session._projectId = '17';
  session._modifiedFiles = ['src/main.js'];
  session._fileChanges = { 'src/main.js': { added: 2, removed: 1 } };
  const scmEntry = model.scmClient.entry('17');
  scmEntry.diffs.set('unstaged|src/main.js', 'old diff');
  let scmLoads = 0;
  model.scmClient.load = async (_projectId, { refresh }) => { assert.equal(refresh, true); scmLoads++; return true; };
  model.setState({ rightTab: 'soubory' });
  let vm = model.renderVals().ws.fl;
  assert.equal(vm.canManage, true);
  await vm.tree.find(row => row.path === 'src/main.js').rename();
  vm = model.renderVals().ws.fl;
  assert.equal(vm.action.title, 'Přejmenovat');
  vm.action.setTarget({ target: { value: 'src/renamed.js' } });
  await model.renderVals().ws.fl.action.submit();
  assert.deepEqual(operations, [{ op: 'rename', path: 'src/main.js', to: 'src/renamed.js', expectedRevision: revision }]);
  assert.equal(model.st().fileAction, null);
  assert.deepEqual(session._modifiedFiles, ['src/renamed.js']);
  assert.deepEqual(session._fileChanges, { 'src/renamed.js': { added: 2, removed: 1 } });
  assert.equal(scmEntry.diffs.size, 0);
  state.editor = { path: 'src/main.js', dirty: true };
  await model.renderVals().ws.fl.tree.find(row => row.path === 'src/main.js').remove();
  assert.equal(model.st().fileAction, null, 'dirty edit prevents destructive action');
  assert.equal(operations.length, 1);
  state.editor = null;
  scmEntry.plan = { state: 'pending', planId: 'old-plan' };
  scmEntry.next = { op: 'push' };
  let scmCancels = 0;
  model.scmClient.cancel = async projectId => { assert.equal(projectId, '17'); scmCancels++; return true; };
  await model.renderVals().ws.fl.tree.find(row => row.path === 'src').remove();
  assert.match(model.renderVals().ws.fl.action.impact, /včetně obsahu\. Položek: 1\./);
  await model.renderVals().ws.fl.action.submit();
  assert.deepEqual(operations[1], { op: 'delete', path: 'src', to: '', expectedRevision: revision });
  assert.deepEqual(session._modifiedFiles, []);
  assert.deepEqual(session._fileChanges, {});
  assert.equal(scmLoads, 2);
  assert.equal(scmCancels, 1);
  assert.equal(scmEntry.plan, null);
  assert.equal(scmEntry.next, null);
});

test('M2 approval needs the bound digest and rendered changes panel', async () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  const calls = [];
  const entry = { view: null, presentedView: null, error: null, busy: false };
  const m2 = { entry: () => entry, run: async (session, command) => { calls.push(command); }, report: () => {} };
  const { model, store } = setup({ m2 });
  const session = store.focusedSession();
  session._projectId = '17'; session._convId = 'conv-17';
  session._m2Pending = { lifecycleId: 'life-17', planDigest: digest,
    origin: { surface: 'studio', sessionId: 'conv-17', conversationId: 'conv-17', projectId: 17 } };
  entry.view = { state: 'awaiting_approval', lifecycleId: 'life-17', planDigest: digest,
    plan: { focusedTest: { binary: 'node', argv: ['test.js'] }, gitCommit: false },
    diff: [{ path: 'app.txt', before: { content: 'a' }, after: { content: 'b' } }] };
  model.pApprove(model.st(), session.id, 'ok');
  assert.deepEqual(calls, []);
  model.setState({ rightTab: 'zmeny' });
  const vm = model.renderVals();
  assert.equal(vm.ws.m2Digest, digest);
  assert.equal(vm.ws.files[0].open, true);
  assert.equal(entry.presentedView, entry.view);
  vm.ws.approve();
  await tick();
  assert.deepEqual(calls, ['/m2-approve']);
  entry.view = { ...entry.view, planDigest: 'sha256:' + 'b'.repeat(64) };
  model.pApprove(model.st(), session.id, 'ok');
  assert.deepEqual(calls, ['/m2-approve']);
});

const { DevelopmentClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/development-client');

test('system settings use observed backend and exact installation approval', async () => {
  const calls = [];
  const reply = value => ({ ok: true, json: async () => value });
  const client = new DevelopmentClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    calls.push([path, options.method, body]);
    if (path === '/api/development/environment') return reply({ platform: 'linux', distribution: 'Test Linux', architecture: 'x64', runtime: { node: '24.0.0' }, tools: { git: '/usr/bin/git', npm: null }, observation: 'Observed executable presence.' });
    if (path === '/api/development/policy' && options.method === 'GET') return reply({ valid: true, revision: 7, projectMode: 'ask', sdkMode: 'ask' });
    if (path === '/api/development/policy') return reply({ valid: true, revision: 8, projectMode: body.projectMode, sdkMode: body.sdkMode });
    if (path === '/api/development/installations') return reply([]);
    if (path === '/api/projects') return reply({ projects: [{ id: 17, name: 'Projekt 17' }] });
    if (path === '/api/development/prepare') return reply({ id: 'plan-17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, kind: 'npm', destination: '/safe/node_modules', command: 'npm ci --offline', artifacts: [] }, events: [] });
    if (path === '/api/development/execute') return reply({ id: 'plan-17', digest: body.digest, state: 'succeeded', plan: { projectId: 17, kind: 'npm', destination: '/safe/node_modules' }, events: [] });
    throw Error('Unexpected request ' + path);
  } });
  assert.equal(client.vm().policyDisabled, true, 'policy cannot be changed from unverified defaults');
  await client.refresh();
  assert.equal(client.vm().os, 'Test Linux');
  assert.equal(client.vm().tools, 'git');
  assert.equal(client.vm().projectMode, 'ask');
  client.vm().setProjectMode({ target: { value: 'automatic' } });
  await client.vm().savePolicy();
  assert.deepEqual(calls.find(([path, method]) => path === '/api/development/policy' && method === 'PUT')[2],
    { revision: 7, projectMode: 'automatic', sdkMode: 'ask' });
  client.vm().setProject({ target: { value: '17' } });
  await client.vm().prepare();
  assert.equal(client.vm().hasPlan, true);
  assert.equal(calls.filter(([path]) => path === '/api/development/execute').length, 0, 'ask plan waits for approval');
  await client.vm().execute();
  assert.deepEqual(calls.find(([path]) => path === '/api/development/execute')[2],
    { id: 'plan-17', digest: 'sha256:exact', approval: true });
  assert.equal(client.vm().planState, 'Instalace dokončena');
  client.destroy();
});

test('development policy remains fail closed after unavailable backend', async () => {
  const client = new DevelopmentClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => { throw Error('offline'); } });
  await client.refresh();
  assert.equal(client.vm().hasError, true);
  assert.equal(client.vm().policyDisabled, true);
  await client.vm().savePolicy();
  assert.equal(client.vm().error, 'Politika není načtená.');
  client.destroy();
});

const { ScmClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/scm-client');

test('live SCM panel maps backend files and prepares exact effects instead of changing local fixture', async () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  Object.assign(e, { status: 'ready', data: { projectId: 17, isRepo: true, branch: 'main',
    upstream: '', ahead: 0, behind: 0, fetchedAt: null, files: [{ path: 'src/app.js', staged: false,
      unstaged: true, untracked: false, conflicted: false, x: ' ', y: 'M', added: 3, removed: 1 }] },
    branches: { branches: [{ name: 'main', remote: false }] }, log: { commits: [] },
    policy: { projectId: 17, revision: 0, init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] } });
  const actions = [];
  model.scmClient.prepare = async (...args) => { actions.push(args); return true; };
  let vm = model.renderVals().ws.scm;
  assert.equal(vm.isRepo, true);
  assert.equal(vm.groups.find(group => group.label === 'Změny').rows[0].addText, '+3');
  vm.groups.find(group => group.label === 'Změny').rows[0].act();
  await tick();
  assert.deepEqual(actions[0], [17, 'stage', { paths: ['src/app.js'] }, null]);
  assert.equal(e.data.files[0].staged, false, 'stage waits for server plan and approval');
  vm.setMsg({ target: { value: 'Reviewed message' } });
  vm = model.renderVals().ws.scm;
  assert.equal(vm.msg, 'Reviewed message', 'commit draft survives render');
  vm.commit(); await tick();
  assert.equal(actions.length, 1, 'commit needs a staged file');
  e.data.files[0].staged = true; e.data.files[0].x = 'M'; e.data.files[0].y = ' ';
  model.renderVals().ws.scm.commit(); await tick();
  assert.deepEqual(actions[1], [17, 'commit', { message: 'Reviewed message', all: false }, null]);
});

test('SCM client requires server plan digest and explicit confirmation before execute', async () => {
  const calls = [];
  const client = new ScmClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    calls.push([path, body]);
    if (path === '/api/scm/prepare') return { ok: true, json: async () => ({ planId: 'p17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, op: 'stage', args: { paths: ['app.js'] } } }) };
    if (path === '/api/scm/execute') return { ok: true, json: async () => ({ planId: 'p17', state: 'succeeded' }) };
    if (path === '/api/scm/status') return { ok: true, json: async () => ({ projectId: 17, isRepo: true, files: [] }) };
    if (path === '/api/scm/branches') return { ok: true, json: async () => ({ branches: [] }) };
    if (path === '/api/scm/log') return { ok: true, json: async () => ({ commits: [] }) };
    if (path === '/api/scm/policy') return { ok: true, json: async () => ({ projectId: 17, revision: 0 }) };
    if (path === '/api/scm/operations') return { ok: true, json: async () => [{ planId: 'p17', state: 'succeeded', plan: { projectId: 17, op: 'stage' }, events: [{ kind: 'succeeded', occurredAt: 123, detail: {} }] }] };
    throw Error('Unexpected ' + path);
  } });
  assert.equal(await client.execute(17), false);
  assert.equal(calls.length, 0);
  assert.equal(await client.prepare(17, 'stage', { paths: ['app.js'] }), true);
  assert.equal(calls.filter(([path]) => path === '/api/scm/execute').length, 0);
  assert.equal(await client.execute(17), true);
  assert.deepEqual(calls.find(([path]) => path === '/api/scm/execute')[1],
    { planId: 'p17', digest: 'sha256:exact', confirm: true });
  client.destroy();
});

test('project detail saves only per-project SCM policy with CAS revision', async () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  e.status = 'ready'; e.policy = { projectId: 17, revision: 4, init: 'automatic', commit: 'ask', branch: 'ask',
    fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] };
  let sent;
  model.scmClient.setPolicy = async (id, patch) => { sent = [id, patch]; return true; };
  let policy = model.scmPolicyVM(model.st(), 17);
  policy.fields.find(item => item.key === 'pull').change({ target: { value: 'automatic' } });
  policy = model.scmPolicyVM(model.st(), 17);
  policy.setRemoteName({ target: { value: 'origin' } });
  policy.setRemoteHost({ target: { value: 'github.com' } });
  policy = model.scmPolicyVM(model.st(), 17);
  policy.addRemote();
  policy = model.scmPolicyVM(model.st(), 17);
  assert.deepEqual(policy.remotes.map(item => [item.name, item.host]), [['origin', 'github.com']]);
  await policy.save();
  assert.deepEqual(sent, [17, { init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled',
    pull: 'automatic', push: 'ask', remotes: [{ name: 'origin', host: 'github.com' }] }]);
  assert.equal(model.st().scm[17], undefined, 'policy is not stored in generic prototype settings');
});

test('SCM execute never retries a lost response and reads durable terminal audit', async () => {
  const calls = [];
  const reply = value => ({ ok: true, json: async () => value });
  const client = new ScmClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options = {}) => {
    const endpoint = new URL(url).pathname;
    calls.push(endpoint);
    if (endpoint === '/api/scm/prepare') return reply({ planId: 'p17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, op: 'commit' } });
    if (endpoint === '/api/scm/execute') throw Error('connection lost');
    if (endpoint === '/api/scm/status') return reply({ projectId: 17, isRepo: true, files: [] });
    if (endpoint === '/api/scm/branches') return reply({ branches: [] });
    if (endpoint === '/api/scm/log') return reply({ commits: [] });
    if (endpoint === '/api/scm/policy') return reply({ projectId: 17, revision: 0 });
    if (endpoint === '/api/scm/operations') return reply([{ planId: 'p17', state: 'interrupted',
      plan: { projectId: 17, op: 'commit' }, events: [{ kind: 'interrupted', occurredAt: 123, detail: { retried: false } }] }]);
    throw Error('Unexpected ' + endpoint);
  } });
  await client.prepare(17, 'commit', { message: 'Reviewed' });
  assert.equal(await client.execute(17), false);
  assert.equal(client.entry(17).plan, null);
  assert.equal(client.entry(17).operations[0].state, 'interrupted');
  assert.match(client.entry(17).error, /Výsledek operace není potvrzen/);
  assert.equal(await client.execute(17), false);
  assert.equal(calls.filter(endpoint => endpoint === '/api/scm/execute').length, 1);
  client.destroy();
});

test('prototype appearance controls persist every visible choice including 125 percent scale', () => {
  const { model, widget, storage } = setup();
  model.setState({ ff: 'inter', bright: 115, col: false, cacc: 'custom', caccHex: '#123456',
    cbg: 'custom', cbgHex: '#112233', scale: '125' });
  const saved = JSON.parse(storage.getItem('intentsmith-studio2-appearance'));
  assert.equal(saved.fontIdx, 1);
  assert.equal(saved.brightness, 115);
  assert.equal(saved.autoCollapse, false);
  assert.equal(saved.accentHex, '#123456');
  assert.equal(saved.bgHex, '#112233');
  assert.equal(saved.uiScale, '1.25');
  const reopened = new AppearanceStore(storage);
  assert.equal(reopened.values.uiScale, '1.25');
  assert.equal(model.st().scale, '125');
  assert.equal(model.st().ff, 'inter');
  assert.equal(widget.appearance.values.accentIdx, 'custom');
});


test('SCM lists partly staged file twice and renders backend diff in right panel', () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  Object.assign(e, { status: 'ready', data: { projectId: 17, isRepo: true, branch: 'main', files: [{
    path: 'app.txt', staged: true, unstaged: true, untracked: false, conflicted: false, x: 'M', y: 'M',
    stagedAdded: 1, stagedRemoved: 0, unstagedAdded: 2, unstagedRemoved: 1 }] },
    branches: { branches: [] }, log: { commits: [] }, policy: { projectId: 17, revision: 0,
      init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] } });
  let groups = model.renderVals().ws.scm.groups;
  assert.equal(groups.find(group => group.label === 'Připravené').rows[0].addText, '+1');
  assert.equal(groups.find(group => group.label === 'Změny').rows[0].addText, '+2');
  e.diffs.set('unstaged|app.txt', 'diff --git a/app.txt b/app.txt\n@@ -1 +1,2 @@\n-old\n+new');
  model.setState({ rightTab: 'scm', fileView: { [session.id]: { path: 'app.txt', from: 'scm', staged: false } },
    fileMode: { [session.id]: 'diff' } });
  const vm = model.renderVals().ws.fvG;
  assert.equal(vm.isDiff, true);
  assert.ok(vm.diff.some(line => line.sign === '+' && line.code === 'new'));
  groups = model.renderVals().ws.scm.groups;
  assert.equal(groups.length, 2);
});


test('specialist detail activates backend identity before showing a new session', async () => {
  const { model, widget, store } = setup();
  widget.catalog.view = section => ({ status: 'ready', items: section === 'Specialisté'
    ? [{ id: 'specialist-9', name: 'Testovací specialista', description: 'Popis', raw: { id: 'specialist-9' } }] : [] });
  const calls = [];
  widget.openSpecialist = async item => { calls.push(item.id); store.addSession({ label: item.name,
    convId: 'studio-specialist-verified', specialistData: { id: item.id, name: item.name } }); return true; };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: 'specialist-9' } });
  const detail = model.renderVals().dt;
  assert.equal(detail.hasPrimary, true);
  detail.onPrimary();
  await tick();
  assert.deepEqual(calls, ['specialist-9']);
  assert.equal(model.st().mode, 'sessions');
  assert.equal(store.focusedSession().chat.specialist.id, 'specialist-9');
});

test('project detail waits for real conversations, validates scope, and opens selected saved chat', async () => {
  const { model, widget, store } = setup();
  widget.catalog.view = section => ({ status: 'ready', items: section === 'Projekty'
    ? [{ id: '17', name: 'Projekt 17', description: 'Skutečný projekt', state: 'active', raw: { id: 17, path: '/safe/project' } }] : [] });
  let resolveList;
  widget.catalog.get = async path => {
    assert.equal(path, '/api/projects/17/conversations?limit=50&status=all');
    return new Promise(resolve => { resolveList = resolve; });
  };
  const opened = [];
  widget.openCatalogItem = async (section, item) => { opened.push([section, item.id]);
    store.addSession({ convId: item.id, projectId: 17, label: item.name }); return true; };
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '17' } });
  model.pSelect(model.st(), 'projects', '17');
  let vm = model.renderVals().dt;
  assert.equal(vm.props.find(prop => prop.k === 'Konverzací').v, '—');
  assert.match(vm.blocks[0].empty, /Načítám/);
  resolveList({ conversations: [{ id: 88, project_id: 17, title: 'Opravdová konverzace' }] });
  await tick();
  vm = model.renderVals().dt;
  assert.equal(vm.props.find(prop => prop.k === 'Konverzací').v, '1');
  assert.equal(vm.blocks[0].rows[0].t, 'Opravdová konverzace');
  vm.blocks[0].rows[0].go();
  await tick();
  assert.deepEqual(opened, [['Konverzace', '88']]);
  assert.equal(model.st().mode, 'sessions');
  assert.equal(store.focusedSession()._convId, '88');
  const bad = model.loadProjectConversations('17');
  resolveList({ conversations: [{ id: 99, project_id: 18, title: 'Cizí' }] });
  await bad;
  model.setState({ mode: 'section' });
  assert.match(model.renderVals().dt.blocks[0].empty, /jiného projektu/);
  assert.equal(model.renderVals().dt.props.find(prop => prop.k === 'Konverzací').v, '—');
});

const { StatusClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/status-client');

test('status line reports observed backend, DB, GPU capacity and failure independently', async () => {
  const calls = [];
  let dbAvailable = true;
  const client = new StatusClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/api/health') return { ok: true, json: async () => ({ ready: true, version: '136.2.0' }) };
    if (path === '/api/system/info' && !dbAvailable) throw Error('offline');
    if (path === '/api/system/info') return { ok: true, json: async () => ({ db: { size_mb: 23.5 } }) };
    if (path === '/api/system/gpu') return { ok: true, json: async () => ({ profile: { capacityOnly: true,
      gpus: [{ gpu_model: 'Example GPU', vram_mb: 24576 }] } }) };
    throw Error('unexpected request');
  } });
  assert.equal(client.vm({ connection: 'Připojeno' }).db, 'DB nedostupné');
  await client.refresh();
  const status = client.vm({ connection: 'Připojeno' });
  assert.equal(status.dot, 'ok');
  assert.equal(status.backend, 'backend 136.2.0');
  assert.equal(status.ws, 'ws :3335');
  assert.equal(status.db, 'DB 23,5 MiB');
  assert.equal(status.gpu, 'GPU kapacita 24 GiB');
  assert.equal(client.vm({ connection: 'Odpojeno' }).dot, 'err');
  dbAvailable = false;
  await client.refresh();
  assert.equal(client.vm({ connection: 'Připojeno' }).db, 'DB nedostupné');
  assert.equal(client.vm({ connection: 'Připojeno' }).gpu, 'GPU kapacita 24 GiB');
  assert.equal(calls.length, 6);
  client.destroy();
});

test('rendered status line does not expose prototype DB or GPU numbers', () => {
  const { model, widget } = setup();
  widget.transport = { connection: 'Odpojeno', serverVersion: null };
  const status = model.renderVals().sb;
  assert.equal(status.connection, 'Odpojeno');
  assert.equal(status.dot, 'err');
  assert.equal(status.db, 'DB nedostupné');
  assert.equal(status.gpu, 'GPU nezjištěno');
  assert.doesNotMatch(JSON.stringify(status), /134 MiB|18,3 \/ 24,0|57 °C|136\.1\.0/);
});

test('conversation audit loads only when opened and shows backend records without fixture data', async () => {
  const { model, store, widget } = setup();
  const session = store.focusedSession();
  session._convId = 'conversation/17';
  widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  const urls = [];
  model.fetchImpl = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({
      audit: [{ created_at: '2026-09-25T14:02:45Z', expertise_name: 'Vývojář', verdict: 'ok' }],
      drift: [{ created_at: '2026-09-25T14:03:00Z', capability: 'fs.write', drift_score: 0.25 }],
    }) };
  };
  assert.equal(urls.length, 0, 'render must not read audit or cause effects');
  let column = model.renderVals().columns[0];
  assert.equal(urls.length, 0);
  column.btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get('conversation_id'), session._convId);
  column = model.renderVals().columns[0];
  assert.deepEqual(column.audit.map(row => row.e), ['DRIFT', 'MERGE']);
  assert.match(column.audit[0].m, /fs\.write/);
  column.btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(urls.length, 1, 'recent audit is cached');
  model._audit.get(session._convId).time = 0;
  model.fetchImpl = async () => { throw Error('backend offline'); };
  model.renderVals().columns[0].btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(model.renderVals().columns[0].audit.at(-1).e, 'CHYBA AUDITU');
});

test('deleted tracked file opens its Git diff without presenting an empty editable file', async () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  session._projectId = 17;
  const e = model.scmClient.entry(17);
  e.diffs.set('unstaged|deleted.txt', 'diff --git a/deleted.txt b/deleted.txt\n@@ -1 +0,0 @@\n-old');
  model.pOpenFile(model.st(), session.id, { path: 'deleted.txt', from: 'scm', mode: 'diff', staged: false });
  await tick();
  const file = model.renderVals().ws.fvG;
  assert.equal(file.isOpen, true);
  assert.equal(file.isDiff, true);
  assert.equal(file.diff[1].code, 'old');
  assert.equal(file.modes.find(mode => mode.label === 'Upravit').cls, 'off');
  assert.equal(model.renderVals().ws.fvS.isOpen, false);
});
