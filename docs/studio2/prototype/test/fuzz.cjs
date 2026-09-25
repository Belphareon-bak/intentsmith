const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const script = src.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
const tpl = src.split('<x-dc>')[1].split('</x-dc>')[0];
global.window = { innerWidth: 1600, innerHeight: 960 };
global.document = { documentElement: { requestFullscreen() {} }, fullscreenElement: null, exitFullscreen() {} };
class DCLogic { constructor() { this.props = {}; this.state = null; } setState(p) { this.state = Object.assign({}, this.state || {}, typeof p === 'function' ? p(this.state) : p); } }
global.DCLogic = DCLogic;
const Component = eval(script + '\n;Component');
// --- template hole checker
function holes(vm, report) {
  const re = /<sc-for\s+list="\{\{\s*([\w.$]+)\s*\}\}"\s+as="(\w+)"|<\/sc-for>|\{\{\s*([\w.$]+)\s*\}\}/g;
  const scope = []; let m;
  const resolve = (path) => {
    const segs = path.split('.');
    for (let i = scope.length - 1; i >= 0; i--) if (scope[i].alias === segs[0]) { if (scope[i].item === undefined) return { skip: true }; let v = scope[i].item; for (const k of segs.slice(1)) { if (v == null || !(k in Object(v))) return { missing: true }; v = v[k]; } return { v }; }
    if (['true', 'false'].includes(path)) return { v: path === 'true' };
    let v = vm; for (const k of segs) { if (v == null || !(k in Object(v))) return { missing: true }; v = v[k]; } return { v };
  };
  while ((m = re.exec(tpl))) {
    if (m[1]) { const r = resolve(m[1]); if (r.missing) report.add('LIST missing: ' + m[1]); const list = r.v; scope.push({ alias: m[2], item: Array.isArray(list) && list.length ? list[0] : undefined }); if (r.v !== undefined && !Array.isArray(r.v) && !r.skip) report.add('LIST not array: ' + m[1]); }
    else if (m[0] === '</sc-for>') scope.pop();
    else { const r = resolve(m[3]); if (r.missing) report.add('HOLE missing: ' + m[3]); else if (!r.skip && r.v === undefined) report.add('HOLE undefined: ' + m[3]); }
  }
  if (scope.length) report.add('unbalanced sc-for');
}
function fns(o, path, out, seen) {
  if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
  for (const k of Object.keys(o)) { const v = o[k]; const p = path + '.' + k; if (typeof v === 'function') out.push([p, v]); else if (v && typeof v === 'object') fns(v, p, out, seen); }
}
let seed = Number(process.argv[3] || 7); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ev = () => ({ target: { value: rnd() < .5 ? String(Math.floor(rnd() * 5) + 11) : 'test ' + Math.floor(rnd() * 9) }, key: rnd() < .5 ? 'Enter' : 'Escape', ctrlKey: true, preventDefault() {}, stopPropagation() {}, clientX: 300, clientY: 200, pointerId: 1, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} } });
const c = new Component(); const report = new Set(); let errors = 0; const called = new Set();
const N = Number(process.argv[4] || 4000);
for (let i = 0; i < N; i++) {
  let vm;
  try { vm = c.renderVals(); } catch (e) { console.log('RENDER ERROR at iter', i, e.stack.split('\n').slice(0, 4).join(' | '), JSON.stringify(c.state).slice(0, 300)); errors++; c.state = null; continue; }
  holes(vm, report);
  const list = []; fns(vm, 'vm', list, new Set());
  if (!list.length) continue;
  const [p, f] = list[Math.floor(rnd() * list.length)];
  called.add(p.replace(/\.\d+\./g, '.#.').replace(/\.\d+$/, '.#'));
  try { f(ev()); } catch (e) { console.log('HANDLER ERROR', p, e.message, e.stack.split('\n')[1]); errors++; }
  if (rnd() < 0.02) c.state = null;
}
console.log('errors:', errors, '| distinct handlers called:', called.size);
console.log([...report].slice(0, 40).join('\n') || 'template holes OK');
