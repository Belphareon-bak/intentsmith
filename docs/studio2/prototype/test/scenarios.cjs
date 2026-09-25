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
reset(); vm = R(); call(vm.tbar.cols[2].pick); vm = R('3 cols'); call(vm.columns[1].cycle, 'cycle'); vm = R('cycled'); const sidsAfter = vm.columns.map((x) => x.title); if (new Set(sidsAfter).size !== 3) fail('dup after cycle', sidsAfter);
call(vm.columns[1].split.down); call(Object.assign({}, vm.columns[1].split).move); call(vm.columns[1].split.up); call(vm.columns[1].split.reset); R('col drag');
vm = R(); call(vm.columns[2].closeCol, 'closeCol'); vm = R('closed col'); if (vm.columns.length !== 2) fail('closeCol count', vm.columns.length);
// focus click, send, stop, approve
reset(); vm = R(); call(vm.columns[1].focus); vm = R('focus 2'); if (!vm.columns[1].cls.includes('focus')) fail('focus col');
call(vm.columns[0].setDraft); call((e) => vm.columns[0].setDraft({ target: { value: 'Ahoj' } })); vm = R(); call(vm.columns[0].send, 'send'); vm = R('sent');
const run = vm.columns[0].msgs.find((m) => m.isRunning); if (!run) fail('no running after send'); else { call(run.stop, 'stop'); R('stopped'); }
reset(); vm = R(); const ap = vm.columns[0].msgs.find((m) => m.hasApproval); if (!ap) fail('no approval s1'); else { call(ap.showChanges, 'show'); call(ap.approve, 'approve'); vm = R('approved'); if (vm.ws.hasChanges) fail('ws still pending'); }
reset(); vm = R(); call(vm.ws.reject, 'ws reject'); R('rejected');
// ws tabs for each session
for (const t of ['zmeny', 'kontext', 'soubory']) for (const sid of ['s1', 's2', 's3', 's4', 's5', 's6']) { reset(); c.setState({ rightTab: t, colSids: [sid], cols: 1 }); R('ws ' + t + sid); }
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
