import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fixture, tick } from './helpers/studio2-live-harness.js';
const require = createRequire(import.meta.url);
const { ScmReview } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/scm-review');
const { SETTINGS_FIELDS } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/settings-preferences');
const hash = 'a'.repeat(40), otherHash = 'b'.repeat(40);
const commit = (projectId = 7, ref = hash, path = null) => ({ projectId, hash: ref, path,
  files: [{ path: 'src/a.js', added: 2, removed: 1 }], diff: '@@ -1 +1 @@\n-old\n+new', subject: 'Change', author: 'Operator' });

test('ordinary settings expose every preference section and retain edits across navigation', () => {
  const { model } = fixture();
  for (const id of ['ucet', 'pamet', 'oznameni', 'vystup', 'system']) {
    model._settingsResources.set(id, { status: 'ready', data: {} });
    model.setState({ mode: 'section', section: 'settings', detail: { settings: id } });
    const vm = model.settingsDetailVM(model.st(), id);
    assert.equal(vm.hasTabs, false);
    if(['ucet','oznameni'].includes(id)){
      assert.equal(vm.blocks.length,id==='ucet'?2:1);assert.equal(vm.blocks[0].isManagement,true);
      assert.equal(vm.blocks.some(b=>b.isPreferences),false,'live account/channel pages replace inert legacy preferences');
    }else assert.deepEqual(vm.blocks.filter(b => b.isPreferences).flatMap(b => b.preferences.fields.map(f => f.label)),
      Object.values(SETTINGS_FIELDS[id]).flat().map(f => f.label));
  }
  model.setState({ detail: { settings: 'pamet' } });
  const memory = model.settingsDetailVM(model.st(), 'pamet');
  const field = memory.blocks.filter(b=>b.isPreferences).flatMap(b=>b.preferences.fields).find(f=>f.label==='Dlouhodobá paměť');
  field.change({ target: { checked: false } });
  const draft = { ...model._preferenceDrafts.get('pamet') };
  model.renderVals().backSettings();
  assert.equal(model.st().detail.settings, null, 'breadcrumb actually returns to overview');
  assert.deepEqual(model._preferenceDrafts.get('pamet'), draft, 'navigation preserves pending edits');
});

test('global list and tile controls have an actual catalog effect and disable forms and matrices with a reason',()=>{
  const {model}=fixture();model.setState({mode:'section',section:'settings',detail:{settings:'modely'}});
  model.modelWorkspace.tab='evaluations';let toolbar=model.renderVals().tbar;
  assert.equal(toolbar.viewDisabled,true);assert.match(toolbar.viewTitle,/tabulku/);assert.equal(toolbar.showList(),false);
  model.modelWorkspace.tab='hunt';model.modelWorkspace.huntTab='catalog';toolbar=model.renderVals().tbar;
  assert.equal(toolbar.viewDisabled,false);toolbar.showList();assert.equal(model.modelWorkspaceVM().redesign.catalog.layoutClass,'mw-catalog-list');
  model.renderVals().tbar.showTiles();assert.match(model.modelWorkspaceVM().redesign.catalog.layoutClass,/mw-catalog-tiles/);
  model.modelWorkspace.huntTab='profiles';assert.equal(model.renderVals().tbar.viewDisabled,false);model.renderVals().tbar.showList();assert.equal(model.modelWorkspaceVM().redesign.profiles.layoutClass,'mw-profile-list');
  model.renderVals().tbar.showTiles();assert.match(model.modelWorkspaceVM().redesign.profiles.layoutClass,/mw-profile-tiles/);model.modelWorkspace.newProfile();assert.equal(model.renderVals().tbar.viewDisabled,true);
  model.setState({section:'workers',detail:{workers:'__new__'}});assert.equal(model.renderVals().tbar.viewDisabled,true);
});

test('catalog has no duplicate sidebar counts and changes list density with the global size control', () => {
  const { model } = fixture();
  model.setState({ mode: 'section', section: 'settings', view: 'seznam', size: 1 });
  assert(model.renderVals().nav.every(row => row.hasBadge === false));
  const small = model.renderVals().cg.rowHeight;
  model.renderVals().setSize({ target: { value: '3' } });
  assert(model.renderVals().cg.rowHeight > small);
  assert.equal(model.renderVals().cg.simpleList, true);
});

test('folder picker is inert until clicked, accepts a current native choice, and ignores cancellation', async () => {
  const { model, widget } = fixture();
  let picks = 0;
  widget.pickProjectDirectory = async () => { picks++; return '/home/operator/Projects/chosen'; };
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' },
    projectPath: '', projectMode: 'open', projectStep: 0 });
  const vm = model.projectWizardVM(model.st());
  assert.equal(vm.canBrowse, true); assert.equal(picks, 0);
  assert.equal(await vm.browse(), true);
  assert.equal(model.st().projectPath, '/home/operator/Projects/chosen');
  widget.pickProjectDirectory = async () => null;
  assert.equal(await model.projectWizardVM(model.st()).browse(), false);
  assert.equal(model.st().projectPath, '/home/operator/Projects/chosen');
});

for (const change of ['reopen', 'mode', 'step', 'busy', 'uncertain', 'path', 'newer']) test('late native choice cannot overwrite a newer wizard: ' + change, async () => {
  const { model, widget } = fixture(); let resolve;
  widget.pickProjectDirectory = () => new Promise(done => { resolve = done; });
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' },
    projectPath: '', projectMode: 'open', projectStep: 0 });
  const pending = model.projectWizardVM(model.st()).browse();
  if (change === 'reopen') { model.pGo(model.st(), 'settings'); model.pSelect(model.st(), 'projects', '__new__'); }
  if (change === 'mode') model.setState({ projectMode: 'create' });
  if (change === 'step') model.setState({ projectStep: 1 });
  if (change === 'busy') model._projectWizardStatus.busy = true;
  if (change === 'uncertain') model._projectWizardStatus.uncertain = true;
  if (change === 'path') model.setState({ projectPath: '/home/operator/newer' });
  if (change === 'newer') { const previous = resolve; void model.projectWizardVM(model.st()).browse(); resolve = previous; }
  resolve('/home/operator/old-choice');
  assert.equal(await pending, false);
  assert.notEqual(model.st().projectPath, '/home/operator/old-choice');
});

test('commit workspace validates project, ref, path and backend identity', async () => {
  let data = commit(), base = 'http://fixture.invalid', seen;
  const review = new ScmReview({ backendUrl: () => base, request: async path => { seen = path; return data; } });
  assert.equal(await review.open(7, hash, 'Project'), true);
  assert.equal(review.vm().title, 'Change');
  assert.equal(review.vm().files.length, 1);
  data = commit(7, hash, 'src/a.js');
  assert.equal(await review.vm().files[0].go(), true);
  assert.equal(new URL('http://fixture.invalid' + seen).searchParams.get('path'), 'src/a.js');
  data = commit(8);
  assert.equal(await review.open(7, hash), false);
  assert.equal(review.vm().hasError, true);
  data = commit(7, otherHash);
  assert.equal(await review.open(7, hash), false);
  review.client.request = async () => { base = 'http://another.invalid'; return commit(); };
  assert.equal(await review.open(7, hash), false);
});

test('an old commit response and a response after closing cannot replace the selected commit', async () => {
  const pending = [];
  const review = new ScmReview({ backendUrl: () => 'http://fixture.invalid',
    request: path => path.startsWith('/api/scm/branches?') ? Promise.resolve({projectId:7,branches:[]}) : new Promise(resolve => pending.push(resolve)) });
  const first = review.open(7, hash), second = review.open(7, otherHash);
  pending[0](commit()); assert.equal(await first, false);
  pending[1](commit(7, otherHash)); assert.equal(await second, true);
  assert.equal(review.vm().identity, otherHash);
  const third = review.open(7, hash); review.close(); pending[2](commit());
  assert.equal(await third, false); assert.equal(review.vm().open, false);
});

test('reference edits invalidate old data and compare returns pinned revisions', async () => {
  const review = new ScmReview({ backendUrl: () => 'http://fixture.invalid', request: async path => {
    const q = new URL('http://fixture.invalid' + path).searchParams;
    return { projectId: 7, path: null, base: q.get('base'), head: q.get('head'),
      baseOid: hash, headOid: otherHash, files: [], diff: '' };
  } });
  review.current = { projectId: 7, kind: 'compare', base: 'main', head: 'work/change', status: 'idle' };
  assert.equal(await review.vm().compare(), true);
  review.vm().setBase({ target: { value: '--unsafe' } });
  assert.equal(review.vm().hasData, false); assert.equal(review.vm().compareDisabled, true);
});

test('commit review offers real sorted branches, parent selection, bounded diff notice and side by side changes',async()=>{
  const seen=[];
  const review=new ScmReview({backendUrl:()=> 'http://fixture.invalid',request:async route=>{
    seen.push(route);const url=new URL('http://fixture.invalid'+route);
    if(url.pathname==='/api/scm/branches')return {projectId:7,branches:[{ref:'refs/heads/main',name:'main'},{ref:'refs/heads/feature',name:'feature'}]};
    return {...commit(),parents:[hash,otherHash],parent:Number(url.searchParams.get('parent')),diffTruncated:true};
  }});
  assert.equal(await review.open(7,hash),true);assert(review.vm().referenceOptions.some(o=>o.value==='refs/heads/main'));
  await review.vm().setBranchSort({target:{value:'name'}});assert(seen.some(route=>route.includes('sort=name')));
  await review.vm().setParent({target:{value:'1'}});assert.equal(review.current.data.parent,1);assert.equal(review.current.kind,'commit');
  assert.match(review.vm().diffNote,/zkrácen/);review.vm().setLayout({target:{value:'split'}});
  assert.equal(review.vm().split,true);assert(review.vm().splitLines.some(line=>line.left==='-old'&&line.right==='+new'));
});

test('branch creation preserves the entered name after failure and clears it only after a verified plan', async () => {
  const { model, session } = fixture();
  const entry = model.scmClient.entry(session._projectId);
  entry.status = 'ready'; entry.data = { isRepo: true, files: [], branch: 'main' }; entry.policy = {};
  entry.log = { commits: [] }; entry.branches = { branches: [] };
  model._branchDraft = { projectId: session._projectId, name: 'work/user-chosen' };
  let accepted = false, seen;
  model.scmClient.prepare = async (...args) => { seen = args; return accepted; };
  const vm = model.scmVM(model.st(), session.id);
  assert.equal(await vm.branchForm.create(), false);
  assert.equal(model._branchDraft.name, 'work/user-chosen');
  assert.deepEqual(seen.slice(0, 3), [session._projectId, 'branch.create', { name: 'work/user-chosen' }]);
  accepted = true; assert.equal(await model.scmVM(model.st(), session.id).branchForm.create(), true);
  assert.equal(model._branchDraft, null);
});
