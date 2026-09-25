const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const script = src.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
const tpl = src.split('<x-dc>')[1].split('</x-dc>')[0];
global.window = { innerWidth: 2380, innerHeight: 1300, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
global.document = { documentElement: { requestFullscreen() {} }, fullscreenElement: null, exitFullscreen() {} };
class DCLogic { constructor() { this.props = {}; this.state = null; } setState(p) { this.state = Object.assign({}, this.state || {}, p); } forceUpdate() {} }
const Component = eval(script + '\n;Component');
function holes(vm) {
  const out = new Set(); const re = /<sc-for\s+list="\{\{\s*([\w.$]+)\s*\}\}"\s+as="(\w+)"|<\/sc-for>|\{\{\s*([\w.$]+)\s*\}\}/g; const scope = []; let m;
  const resolve = (path) => { const segs = path.split('.'); for (let i = scope.length - 1; i >= 0; i--) if (scope[i].alias === segs[0]) { if (scope[i].item === undefined) return { skip: 1 }; let v = scope[i].item; for (const k of segs.slice(1)) { if (v == null || !(k in Object(v))) return { missing: 1 }; v = v[k]; } return { v }; } if (path === 'true' || path === 'false') return { v: 1 }; let v = vm; for (const k of segs) { if (v == null || !(k in Object(v))) return { missing: 1 }; v = v[k]; } return { v }; };
  while ((m = re.exec(tpl))) { if (m[1]) { const r = resolve(m[1]); if (r.missing) out.add('LIST ' + m[1]); scope.push({ alias: m[2], item: Array.isArray(r.v) && r.v.length ? r.v[0] : undefined }); } else if (m[0] === '</sc-for>') scope.pop(); else { const r = resolve(m[3]); if (r.missing || (!r.skip && r.v === undefined)) out.add('HOLE ' + m[3]); } }
  return [...out];
}
const c = new Component(); const d = c.data(); let fails = 0, checks = 0;
const fail = (...a) => { console.log('FAIL', ...a); fails++; };
const R = (label) => { let vm; try { vm = c.renderVals(); } catch (e) { fail('render', label, e.stack.split('\n').slice(0, 3).join(' | ')); return null; } const h = holes(vm); checks++; if (h.length) fail('holes', label, h.join(', ')); return vm; };
const ev = { preventDefault() {}, stopPropagation() {}, clientX: 400, clientY: 300, pointerId: 1, key: 'Enter', ctrlKey: true, target: { value: 'x' }, currentTarget: { setPointerCapture() {}, releasePointerCapture() {}, parentElement: { getBoundingClientRect: () => ({ width: 1400 }) } } };
const reset = () => { c.state = null; };
const snap = () => JSON.parse(JSON.stringify(c.state || {}));
const restore = (x) => { c.state = x; };
const call = (fn, label) => { try { fn(ev); } catch (e) { fail('handler', label, e.message); } };

// 1) initial: 2 columns
reset(); let vm = R('initial');
if (vm.columns.length !== 2) fail('initial columns', vm.columns.length);
if (!vm.isSessions) fail('not sessions');
// tabs
vm.tabs.forEach((t, i) => { reset(); let v = R('t'); call(v.tabs[i].go, 'tab go'); v = R('tab ' + i); if (!v.tabs[i].cls.includes('focus')) fail('tab focus', i, v.tabs[i].cls); });
// cols
for (const k of [1, 2, 3]) { reset(); let v = R(); call(v.tbar.cols[k - 1].pick, 'cols'); v = R('cols ' + k); if (v.columns.length !== k) fail('cols count', k, v.columns.length); v.columns.forEach((col, i) => { col.btabs.forEach((bt, j) => { const sv = snap(); call(bt.go, 'btab'); const v2 = R('btab ' + k + i + j); restore(sv); }); }); }
// column cycle / close / drag
reset(); vm = R(); call(vm.tbar.cols[2].pick); vm = R('3 cols');
{ const before = vm.columns.map((x) => x.title); call(vm.columns[1].pick, 'colpick'); vm = R('colpick open'); if (!vm.hasCtx || !vm.ctxItems.some((x) => x.hasNum)) fail('colpick menu');
  // vyber relaci, která je ve sloupci 1 -> sloupce se vymění
  const inCol0 = vm.ctxItems.find((x) => x.k.indexOf('sloupec 1') === 0); if (!inCol0) fail('colpick no swap item'); else { call(inCol0.go, 'swap'); vm = R('swapped'); const after = vm.columns.map((x) => x.title); if (after[1] !== before[0] || after[0] !== before[1]) fail('swap', before, after); if (new Set(after).size !== 3) fail('dup after swap', after); }
  call(vm.columns[2].pick); vm = R(); const free = vm.ctxItems.find((x) => x.isItem && x.hasNum && !x.numCls); if (!free) fail('no free session'); else { call(free.go, 'pick free'); vm = R('picked'); if (vm.columns[2].title.indexOf(free.t) < 0 && !vm.columns.some((c2) => c2.title.indexOf(free.t) >= 0)) fail('pick free', free.t); if (!vm.columns[2].cls.includes('focus')) fail('picked not focus'); }
  call(vm.columns[0].pick); vm = R(); const nw = vm.ctxItems.find((x) => x.t.indexOf('Nová relace') === 0); call(nw.go, 'new in col'); vm = R('new in col'); if (vm.tabs.length !== 7) fail('new in col tabs'); if (vm.columns[0].title !== 'Nová konverzace') fail('new in col 0', vm.columns[0].title); }
reset(); vm = R(); call(vm.tbar.cols[2].pick); vm = R('3 cols');
call(vm.columns[1].split.down); call(Object.assign({}, vm.columns[1].split).move); call(vm.columns[1].split.up); call(vm.columns[1].split.reset); R('col drag');
vm = R(); call(vm.columns[2].closeCol, 'closeCol'); vm = R('closed col'); if (vm.columns.length !== 2) fail('closeCol count', vm.columns.length);
// focus click, send, stop, approve
reset(); vm = R(); call(vm.columns[1].focus); vm = R('focus 2'); if (!vm.columns[1].cls.includes('focus')) fail('focus col');
call(vm.columns[0].setDraft); call((e) => vm.columns[0].setDraft({ target: { value: 'Ahoj' } })); vm = R(); call(vm.columns[0].send, 'send'); vm = R('sent');
const run = vm.columns[0].msgs.find((m) => m.isRunning); if (!run) fail('no running after send'); else { call(run.stop, 'stop'); R('stopped'); }
reset(); vm = R(); const ap = vm.columns[0].msgs.find((m) => m.hasApproval); if (!ap) fail('no approval s1'); else { call(ap.showChanges, 'show'); call(ap.approve, 'approve'); vm = R('approved'); if (vm.ws.hasChanges) fail('ws still pending'); }
reset(); vm = R(); call(vm.ws.reject, 'ws reject'); R('rejected');
// ws tabs for each session
for (const t of ['zmeny', 'kontext', 'soubory', 'scm']) for (const sid of ['s1', 's2', 's3', 's4', 's5', 's6']) { reset(); c.setState({ rightTab: t, colSids: [sid], cols: 1 }); R('ws ' + t + sid); }
// soubory: seznamy, náhled, diff, úpravy se stráží
reset(); c.setState({ rightTab: 'soubory', colSids: ['s1'], cols: 1 }); vm = R('files s1');
if (vm.ws.fl.edited.length !== 3 || vm.ws.fl.edited[0].st !== 'navrženo') fail('s1 edited', vm.ws.fl.edited.map((x) => x.st));
if (!vm.ws.fl.opened.some((x) => x.src === 'příloha')) fail('no attachment');
{ const dirRow = vm.ws.fl.tree.find((x) => x.isDir && x.name === 'main'); const n0 = vm.ws.fl.tree.length; call(dirRow.go, 'fold'); vm = R('folded'); if (vm.ws.fl.tree.length >= n0) fail('fold'); call(vm.ws.fl.tree.find((x) => x.name === 'main').go); vm = R(); if (vm.ws.fl.tree.length !== n0) fail('unfold'); }
call(vm.ws.fl.edited[0].go, 'open edited'); vm = R('file open'); if (!vm.ws.isSouboryFile || !vm.ws.fv.isDiff) fail('open edited diff', vm.ws.fv.isDiff);
call(vm.ws.fv.modes[0].pick); vm = R('preview'); if (!vm.ws.fv.isPreview || vm.ws.fv.lines.length < 10) fail('preview');
call(vm.ws.fv.modes[2].pick); vm = R('edit'); if (!vm.ws.fv.isEdit || !vm.ws.editFoot) fail('edit');
call(() => vm.ws.fv.setDraft({ target: { value: 'nový obsah' } })); vm = R('dirty'); if (!vm.ws.fv.dirty) fail('not dirty');
call(vm.ws.fv.back, 'back dirty'); vm = R('guard'); if (!vm.ws.fv.hasGuard || !vm.ws.isSouboryFile) fail('no guard');
call(vm.ws.fv.guardStay); vm = R(); if (vm.ws.fv.hasGuard || !vm.ws.fv.dirty) fail('stay');
call(vm.ws.fv.back); vm = R(); call(vm.ws.fv.guardSave, 'guard save'); vm = R('saved'); if (!vm.ws.isSouboryList) fail('not back after save');
if (vm.columns[0].audit[0].e !== 'file_save') fail('no save audit');
reset(); c.setState({ rightTab: 'soubory', colSids: ['s1'], cols: 1 }); vm = R(); const trf = vm.ws.fl.tree.find((x) => x.name === 'window.js'); call(trf.go); vm = R('tree open'); if (vm.ws.fv.path !== 'src/main/window.js') fail('tree path', vm.ws.fv.path);
call(vm.ws.fv.modes[2].pick); vm = R(); call(() => vm.ws.fv.setDraft({ target: { value: 'x' } })); vm = R(); call(vm.ws.fv.back); vm = R(); call(vm.ws.fv.guardDiscard); vm = R('discard'); if (!vm.ws.isSouboryList || vm.ws.fl.opened[0].src !== 'otevřel jsi') fail('discard/user opened');
reset(); c.setState({ rightTab: 'soubory', colSids: ['s5'], cols: 1 }); vm = R('files s5'); if (!vm.ws.fl.noTree || !vm.ws.fl.noEdited) fail('s5 files');
// správa zdrojů
reset(); c.setState({ rightTab: 'scm', colSids: ['s5'], cols: 1 }); vm = R(); if (!vm.ws.scm.noProject) fail('scm s5');
reset(); c.setState({ rightTab: 'scm', colSids: ['s4'], cols: 1 }); vm = R(); if (!vm.ws.scm.noRepo) fail('scm s4 norepo'); call(vm.ws.scm.init); vm = R(); if (!vm.ws.scm.plan.has) fail('init plan'); call(vm.ws.scm.plan.run, 'init run'); vm = R('inited'); if (!vm.ws.scm.isRepo || !vm.ws.scm.groups.length) fail('init result');
reset(); c.setState({ rightTab: 'scm', colSids: ['s1'], cols: 1 }); vm = R('scm s1');
if (vm.ws.scm.count !== 1 || vm.ws.scm.syncText !== '↓0 ↑1') fail('scm s1 before', vm.ws.scm.count, vm.ws.scm.syncText);
{ const head = vm.ws.scm.graph.find((r) => r.refs.some((x) => x.cls === 'head')); if (!head || head.hash !== '9f8e7d6') fail('head ref'); }
call(vm.ws.scm.sync); vm = R(); if (!vm.ws.scm.plan.has || vm.ws.scm.plan.title !== 'git push') fail('push plan'); call(vm.ws.scm.plan.cancel); vm = R();
call(vm.columns[0].msgs.find((m) => m.hasApproval).approve, 'approve'); vm = R('approved'); if (vm.ws.scm.count !== 4) fail('after approve count', vm.ws.scm.count);
call(vm.ws.scm.commit); vm = R(); if (!vm.ws.scm.hasHint) fail('empty msg hint');
call(() => vm.ws.scm.setMsg({ target: { value: 'SFTP: obnovení přenosu' } })); vm = R(); call(vm.ws.scm.commit); vm = R(); if (!vm.ws.scm.hasHint || vm.ws.scm.plan.has) fail('nothing staged hint');
call(vm.ws.scm.groups.find((g) => g.label === 'Změny').all, 'stage all'); vm = R('staged'); if (vm.ws.scm.groups[0].label !== 'Připravené' || vm.ws.scm.groups[0].n !== 3) fail('staged group', vm.ws.scm.groups.map((g) => g.label + g.n));
call(vm.ws.scm.groups[0].rows[0].open, 'open diff'); vm = R('scm file'); if (!vm.ws.isScmFile || !vm.ws.fv.isDiff) fail('scm diff'); call(vm.ws.fv.back); vm = R();
call(vm.ws.scm.commit); vm = R('plan'); if (!vm.ws.scm.plan.has || !vm.ws.scm.plan.canRun) fail('commit plan');
call(vm.ws.scm.plan.run, 'commit run'); vm = R('committed'); if (vm.ws.scm.count !== 1 || vm.ws.scm.syncText !== '↓0 ↑2' || vm.ws.scm.graph[0].s !== 'SFTP: obnovení přenosu') fail('commit result', vm.ws.scm.count, vm.ws.scm.syncText);
if (vm.columns[0].audit[0].e !== 'scm_commit') fail('commit audit');
call(vm.ws.scm.branchMenu); vm = R('branches'); if (!vm.ctxHasQ) fail('branch search'); const wb = vm.ctxItems.find((x) => x.t === 'work/sftp-resume'); call(wb.go); vm = R(); if (!vm.ws.scm.plan.blocked) fail('checkout dirty not blocked'); call(vm.ws.scm.plan.cancel); vm = R();
call(vm.ws.scm.groups[0].all); vm = R(); call(() => vm.ws.scm.setMsg({ target: { value: 'Dokumentace' } })); vm = R(); call(vm.ws.scm.commitMenu); vm = R(); call(vm.ctxItems.find((x) => x.t.indexOf('odeslat') > 0).go); vm = R(); call(vm.ws.scm.plan.run); vm = R('commit+push'); if (vm.ws.scm.syncText !== '↓0 ↑0' || !vm.ws.scm.clean) fail('commit push', vm.ws.scm.syncText);
call(vm.ws.scm.branchMenu); vm = R(); call(vm.ctxItems.find((x) => x.t === 'work/sftp-resume').go); vm = R(); call(vm.ws.scm.plan.run, 'checkout'); vm = R('checked out'); if (vm.ws.scm.branch !== 'work/sftp-resume' || vm.ws.scm.graph.find((r) => r.refs.some((x) => x.cls === 'head')).hash !== 'a41c9e2') fail('checkout head');
call(vm.ws.scm.branchMenu); vm = R(); call(() => vm.setCtxQ({ target: { value: 'work/dalsi' } })); vm = R(); call(vm.ctxItems.find((x) => x.t.indexOf('Nová větev') === 0).go); vm = R(); if (vm.ws.scm.plan.blocked) fail('branch blocked', vm.ws.scm.plan.reason); call(vm.ws.scm.plan.run); vm = R(); if (vm.ws.scm.branch !== 'work/dalsi') fail('new branch');
reset(); c.setState({ rightTab: 'scm', colSids: ['s2'], cols: 1 }); vm = R('scm s2'); call(vm.ws.scm.sync); vm = R(); if (vm.ws.scm.plan.title !== 'git pull --ff-only' || !vm.ws.scm.plan.blocked) fail('pull dirty blocked'); call(vm.ws.scm.fetch); vm = R(); if (!vm.ws.scm.plan.blocked) fail('fetch policy');
reset(); c.setState({ rightTab: 'scm', colSids: ['s3'], cols: 1 }); vm = R('scm s3'); if (vm.ws.scm.syncCls !== 'dis') fail('no upstream'); call(vm.ws.scm.groups[0].all); vm = R(); call(() => vm.ws.scm.setMsg({ target: { value: 'x' } })); vm = R(); call(vm.ws.scm.commit); vm = R(); if (!vm.ws.scm.plan.blocked) fail('commit while agent writes');
// terminál relace a přílohy ve skladateli
reset(); vm = R(); call(() => vm.columns[0].setCmd({ target: { value: 'cat src/main/sf' } })); vm = R(); vm.columns[0].cmdKey({ key: 'Tab', preventDefault() {} }); vm = R('tab'); if (vm.columns[0].cmd !== 'cat src/main/sftp.js') fail('tab completion', vm.columns[0].cmd);
vm.columns[0].cmdKey({ key: 'Enter', preventDefault() {} }); vm = R('term enter'); if (vm.columns[0].cmd !== '' || !vm.columns[0].term.some((l) => l.t === '$ cat src/main/sftp.js')) fail('term enter');
call(vm.columns[0].attach); call(R().columns[0].attach); vm = R('atts'); if (vm.columns[0].atts.length !== 2) fail('attach'); call(vm.columns[0].atts[0].remove); vm = R(); if (vm.columns[0].atts.length !== 1) fail('remove att');
call(vm.columns[0].send, 'send att only'); vm = R('sent att'); { const last = vm.columns[0].msgs.filter((m) => m.isUser).pop(); if (!last.hasAtts || last.hasText) fail('att-only message'); } if (vm.columns[0].hasAtts) fail('atts not cleared');
// klávesové zkratky
reset(); vm = R(); c.onKey({ key: 'k', ctrlKey: true, preventDefault() {}, stopPropagation() {} }); vm = R('ctrl k'); if (!vm.palette) fail('ctrl+k');
c.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); vm = R(); if (vm.palette) fail('esc');
c.onKey({ key: '3', code: 'Digit3', altKey: true, shiftKey: true, preventDefault() {}, stopPropagation() {} }); vm = R(); if (vm.columns.length !== 3) fail('alt+shift+3');
c.onKey({ key: '5', altKey: true, preventDefault() {}, stopPropagation() {} }); vm = R(); if (!vm.tabs[4].cls.includes('focus')) fail('alt+5');
c.onKey({ key: 'b', ctrlKey: true, preventDefault() {}, stopPropagation() {} }); vm = R(); if (!vm.navRail) fail('ctrl+b');
c.onKey({ key: 'x', preventDefault() {}, stopPropagation() {} }); R('plain key');
// nav + sections + details
const secs = { chats: ['s1', 's6', 'h1', 'h3'], projects: d.P.map((x) => x.id), specialists: d.SP.map((x) => x.id), expertises: d.EX.map((x) => x.id), workers: d.WK.map((x) => x.id), market: d.MK.map((x) => x.id), settings: d.SET.map((x) => x.id) };
reset(); vm = R();
vm.nav.forEach((r, i) => { reset(); let v = R(); call(v.nav[i].go, 'nav go'); v = R('nav ' + r.label); if (!v.isSection) fail('nav not section', r.label); if (v.columns.length) fail('columns in section'); if (v.tabs.some((t) => t.cls.includes('focus'))) fail('tab focus in section'); call(v.nav[i].toggle, 'nav toggle'); v = R('nav toggled ' + r.label); (v.nav[i].kids || []).filter((k) => k.isItem).forEach((k, j) => { const sv = snap(); call(v.nav[i].kids.filter((q) => q.isItem)[j].go, 'kid'); R('kid ' + r.label + j); restore(sv); }); });
for (const [sec, ids] of Object.entries(secs)) for (const view of ['dlazdice', 'seznam']) {
  reset(); c.setState({ view }); vm = R(); call(vm.nav.concat([{ go: vm.navSet.go, label: 'set' }]).find((r) => (sec === 'settings' ? r.label === 'set' : r.label === c.sec(sec).label)).go, 'go ' + sec); vm = R('sec ' + sec);
  vm.cg.chips.forEach((ch, j) => { const sv = snap(); call(ch.go); R('chip ' + sec + j); restore(sv); });
  if (view === 'seznam') continue;
  for (const id of ids) {
    reset(); c.setState(c.pSelect(c.st(), sec, id)); vm = R(sec + ':' + id);
    if (!vm.hasDetail) { fail('no detail', sec, id); continue; }
    vm.dt.tabs.forEach((tb, j) => { call(tb.go); const v2 = R(sec + ':' + id + ' tab ' + j); if (v2 && v2.dt.blocks.length === 0) fail('empty tab', sec, id, j); });
    for (const act of ['onPrimary']) { const sv = snap(); vm = R(); call(vm.dt[act], act); R(sec + id + act); restore(sv); }
    vm = R(); vm.dt.secondary.forEach((b, j) => { const sv = snap(); call(vm.dt.secondary[j].go); R('sec2 ' + sec + id + j); restore(sv); });
    vm = R(); vm.dt.related.forEach((rl, j) => { const sv = snap(); call(vm.dt.related[j].go); R('rel ' + sec + id + j); restore(sv); });
    vm = R(); vm.dt.blocks.forEach((b) => b.rows.forEach((row, j) => { const sv = snap(); call(row.go); R('row ' + sec + id + j); restore(sv); }));
    vm = R(); call(vm.dt.more, 'more'); vm = R('more ' + sec + id); if (!vm.hasCtx) fail('no ctx', sec, id);
    vm.ctxItems.filter((x) => x.isItem).forEach((x) => { const sv = snap(); call(x.go); R('ctx ' + sec + id + x.t); restore(sv); });
    vm = R(); call(vm.closeDetail, 'close'); vm = R(); if (vm.hasDetail) fail('detail not closed');
  }
}
// catalog double click chats, tile ctx
reset(); c.setState(c.pGo(c.st(), 'chats')); vm = R(); vm.cg.items.forEach((e, j) => { const sv = snap(); call(e.dbl); const v2 = R('dbl ' + j); if (!v2.isSessions) fail('dbl chats not sessions', j); restore(sv); });
// appearance
const styles = c.styleList().map((x) => x.id);
for (const style of styles) for (const tmode of ['dark', 'light', 'system']) {
  reset(); c.setState(Object.assign(c.pSelect(c.st(), 'settings', 'vzhled'), { style, tmode })); vm = R('ap ' + style + tmode);
  vm.dt.tabs.forEach((tb, j) => { call(tb.go); R('ap tab ' + style + tmode + j); });
  if (!vm.rootCls.includes('th-')) fail('no theme class');
}
reset(); c.setState(Object.assign(c.pSelect(c.st(), 'settings', 'vzhled'), { style: 'clean' })); vm = R();
vm.ap.caccs.forEach((o) => { call(o.pick); R('cacc'); }); call((e) => vm.ap.setCaccHex({ target: { value: '#ff8800' } })); vm = R('custom acc'); if (!vm.hasDynCss) fail('no dyncss acc');
call((e) => vm.ap.setCbgHex({ target: { value: '#101820' } })); vm = R('custom bg'); if (!vm.dynCss.includes('cbg-custom')) fail('no cbg css');
['setTi', 'setAi', 'setB', 'setFs', 'setTa', 'setBd', 'setPa'].forEach((k) => { call((e) => vm.ap[k]({ target: { value: '60' } })); R(k); });
for (const fsz of [10, 18]) { c.setState({ fs: fsz }); vm = R('fs ' + fsz); }
vm.ap.fonts.forEach((o) => call(o.pick)); vm.ap.densities.forEach((o) => call(o.pick)); vm.ap.scales.forEach((o) => call(o.pick)); vm.ap.seps.forEach((o) => call(o.pick)); vm.ap.tmodes.forEach((o) => call(o.pick)); vm.ap.styles.forEach((o) => call(o.pick)); call(vm.ap.toggleCol); call(vm.ap.toggleSys || (() => {}));
call((e) => vm.ap.setCss({ target: { value: '.tile{border-radius:14px}' } })); vm = R('css'); if (!vm.dynCss.includes('border-radius')) fail('css not applied');
// menus
reset(); vm = R(); vm.menus.forEach((m, i) => { reset(); let v = R(); call(v.menus[i].toggle); v = R('menu ' + m.label); v.menus[i].items.filter((x) => x.isItem).forEach((x) => { const sv = snap(); call(x.go); R('menu ' + m.label + ' ' + x.t); restore(sv); }); });
// palette
reset(); vm = R(); call(vm.openPalette); vm = R('pal'); vm.pal.forEach((g) => g.items.forEach((x) => { const sv = snap(); call(x.go); R('pal ' + x.t); restore(sv); }));
c.setState({ palette: true, pq: 'zzzz' }); vm = R(); if (!vm.palEmpty) fail('pal not empty');
c.setState({ pq: 'tři' }); vm = R(); vm.palKey({ key: 'Enter', preventDefault() {} }); vm = R('pal enter'); if (vm.columns.length !== 3) fail('pal enter cols', vm.columns.length);
// tab ctx
reset(); vm = R(); vm.tabs.forEach((t, i) => { reset(); let v = R(); call(v.tabs[i].ctx); v = R('tabctx'); v.ctxItems.filter((x) => x.isItem).forEach((x) => { const sv = snap(); call(x.go); R('tabctx ' + x.t); restore(sv); }); });
// drags
reset(); vm = R(); ['dragNav', 'dragRight', 'dragBottom', 'dragDetail'].forEach((k) => { call(vm[k].down); call(Object.assign({}, vm[k]).move); call(vm[k].up); R(k); });
// toggles
reset(); vm = R(); call(vm.toggleNav); vm = R('nav rail'); if (!vm.navRail) fail('nav rail'); call(vm.toggleRight); call(vm.toggleBottom); R('toggles');
// narrow window autocollapse
global.window.innerWidth = 1000; reset(); vm = R('narrow'); if (!vm.navRail) fail('auto collapse nav'); global.window.innerWidth = 2380;
// close all tabs
reset(); vm = R(); vm.tabs.slice().forEach(() => { const v = c.renderVals(); call(v.tabs[0].close); }); vm = R('none'); if (!vm.noSessions) fail('noSessions');
call(vm.newSession); vm = R('new after none'); if (vm.columns.length !== 1) fail('new session col');
console.log('checks:', checks, 'fails:', fails);
