'use strict';

// Read-only commit/compare workspace. Every response belongs to the captured
// backend, project and revision; a late response cannot replace a newer view.
const OID = /^[0-9a-f]{40,64}$/;
const REFERENCE = /^(?!-)[^\x00-\x20~^:?*\[\\]{1,200}$/;
function splitDiff(text) {
  const rows=[],left=[],right=[];
  const flush=()=>{for(let i=0;i<Math.max(left.length,right.length);i++)rows.push({left:left[i]||'',right:right[i]||'',leftClass:left[i]?'removed':'',rightClass:right[i]?'added':''});left.length=right.length=0;};
  for(const line of (text||'').split('\n')) {
    if(line.startsWith('-')&&!line.startsWith('---'))left.push(line);
    else if(line.startsWith('+')&&!line.startsWith('+++'))right.push(line);
    else {flush();rows.push({left:line,right:line,leftClass:line.startsWith('@@')?'hunk':'',rightClass:line.startsWith('@@')?'hunk':''});}
  }
  flush();return rows;
}
// Řádky jednotného diffu s čísly starého a nového souboru (vzhled návrhu V4: Git a změny).
// Hlavičky „diff --git/index/---/+++“ se mění na řádek souboru, technické značky se nezobrazují.
function parseUnified(text) {
  const rows=[],lines=(text||'').split('\n');let o=0,n=0;
  if(lines.at(-1)==='')lines.pop();
  for(const line of lines) {
    if(line.startsWith('diff --git ')){const m=line.match(/ b\/(.+)$/);rows.push({cls:'file',o:'',n:'',sign:'',code:m?m[1]:line.slice(11)});continue;}
    if(/^(index |--- |\+\+\+ |similarity index|dissimilarity index|rename from|rename to|copy from|copy to|old mode|new mode|new file mode|deleted file mode)/.test(line))continue;
    if(line.startsWith('Binary files')){rows.push({cls:'meta',o:'',n:'',sign:'',code:'Binární soubor · textový rozdíl není k dispozici'});continue;}
    const hunk=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if(hunk){o=Number(hunk[1]);n=Number(hunk[2]);rows.push({cls:'hunk',o:'',n:'',sign:'',code:line});continue;}
    if(line.startsWith('+')){rows.push({cls:'added',o:'',n:String(n++),sign:'+',code:line.slice(1)});continue;}
    if(line.startsWith('-')){rows.push({cls:'removed',o:String(o++),n:'',sign:'−',code:line.slice(1)});continue;}
    if(line.startsWith('\\')){rows.push({cls:'meta',o:'',n:'',sign:'',code:'Bez nového řádku na konci souboru'});continue;}
    rows.push({cls:'',o:String(o++),n:String(n++),sign:'',code:line.slice(1)});
  }
  return rows;
}
function splitRows(rows) {
  const out=[],left=[],right=[];
  const flush=()=>{for(let i=0;i<Math.max(left.length,right.length);i++){const l=left[i],r=right[i];out.push({lo:l?.o||'',left:l?l.code:'',leftClass:l?'removed':'blank',rn:r?.n||'',right:r?r.code:'',rightClass:r?'added':'blank'});}left.length=right.length=0;};
  for(const row of rows) {
    if(row.cls==='removed')left.push(row);else if(row.cls==='added')right.push(row);
    else {flush();out.push(row.cls?{lo:'',left:row.code,leftClass:row.cls,rn:'',right:row.cls==='file'?'':row.code,rightClass:row.cls}:{lo:row.o,left:row.code,leftClass:'',rn:row.n,right:row.code,rightClass:''});}
  }
  flush();return out;
}
function fileStatuses(text) {
  const status=new Map();let current=null;
  for(const line of (text||'').split('\n')) {
    const m=line.match(/^diff --git a\/.+ b\/(.+)$/);if(m){current=m[1];status.set(current,'modified');continue;}
    if(!current)continue;
    if(line.startsWith('new file mode'))status.set(current,'added');
    else if(line.startsWith('deleted file mode'))status.set(current,'deleted');
    else if(line.startsWith('rename from'))status.set(current,'renamed');
  }
  return status;
}
const STATUS={added:['Nový soubor','green'],deleted:['Smazáno','red'],renamed:['Přejmenováno','blue'],modified:['Upraveno',''],binary:['Binární','']};
const plural=(n,one,few,many)=>n+' '+(n===1?one:n>=2&&n<=4?few:many);
function czechDate(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const p=x=>String(x).padStart(2,'0');return d.getDate()+'. '+(d.getMonth()+1)+'. '+d.getFullYear()+' · '+p(d.getHours())+':'+p(d.getMinutes());}
class ScmReview {
  constructor(client, onChange = () => {}) {
    this.client = client; this.onChange = onChange; this.current = null; this.token = null;
  }
  close() { this.token = null; this.current = null; this.onChange(); }
  async open(projectId, ref, projectName = '') {
    if (!/^[1-9][0-9]*$/.test(String(projectId)) || !OID.test(ref)) return false;
    this.current = { projectId: Number(projectId), projectName, kind: 'commit', ref, path: null,
      base: '', head: ref, parent:0, branchSort:'activity', branches:[], status: 'loading', data: null, error: '' };
    const [loaded]=await Promise.all([this.load(),this.loadBranches()]);return loaded;
  }
  async loadBranches() {
    const view=this.current,backend=this.client.backendUrl();if(!view)return false;
    const sort=view.branchSort;
    try {
      const data=await this.client.request('/api/scm/branches?'+new URLSearchParams({projectId:String(view.projectId),sort}));
      if(this.current!==view||view.branchSort!==sort||backend!==this.client.backendUrl())return false;
      if(data.projectId!==view.projectId||!Array.isArray(data.branches)||data.branches.some(b=>!REFERENCE.test(b.ref)||typeof b.name!=='string'))throw Error('Neplatný seznam větví.');
      view.branches=data.branches;view.branchError='';this.onChange();return true;
    } catch(error) {if(this.current===view){view.branchError='Seznam větví není dostupný.';this.onChange();}return false;}
  }
  async load(path = this.current?.path || null) {
    const view = this.current;
    if (!view || path !== null && (typeof path !== 'string' || /[\x00-\x1f]/.test(path))) return false;
    if (view.kind === 'compare' && (!REFERENCE.test(view.base) || !REFERENCE.test(view.head))) {
      view.error = 'Vyplň platné reference základu a cíle.'; this.onChange(); return false;
    }
    const identity = { ...view }, token = Symbol('git-review');
    const backend = this.client.backendUrl();
    this.token = token; view.status = 'loading'; view.error = ''; this.onChange();
    const query = new URLSearchParams({ projectId: String(view.projectId) });
    if (view.kind === 'commit') {query.set('ref', view.ref);query.set('parent',String(view.parent||0));}
    else { query.set('base', view.base); query.set('head', view.head); }
    if (path !== null) query.set('path', path);
    try {
      const data = await this.client.request('/api/scm/' + view.kind + '?' + query);
      if (this.token !== token || this.current !== view) return false;
      if (this.client.backendUrl() !== backend || data.projectId !== identity.projectId
        || data.path !== path || !Array.isArray(data.files) || typeof data.diff !== 'string'
        || data.diff.length > 1_000_000
        || identity.kind === 'commit' && data.hash !== identity.ref
        || identity.kind === 'compare' && (data.base !== identity.base || data.head !== identity.head
          || !OID.test(data.baseOid) || !OID.test(data.headOid))
        || data.files.some(file => typeof file?.path !== 'string')) throw Error('Backend vrátil jiné nebo neplatné změny.');
      if (path === null) view.statuses = fileStatuses(data.diff);
      view.path = path; view.data = data; view.status = 'ready'; this.onChange(); return true;
    } catch (error) {
      if (this.token === token && this.current === view) {
        view.status = 'error'; view.error = error?.message || 'Změny nelze načíst.'; this.onChange();
      }
      return false;
    }
  }
  vm() {
    const view = this.current, data = view?.data;
    const changeReference = key => event => {
      if (!this.current || this.current !== view) return;
      this.token = null; view[key] = event.target.value; view.kind = 'compare';
      view.data = null; view.status = 'idle'; view.path = null; view.error = ''; this.onChange();
    };
    return {
      open: !!view, title: data?.subject || (view?.kind === 'compare' ? 'Porovnání revizí' : 'Detail commitu'),
      project: view?.projectName || ('Projekt ' + (view?.projectId || '')), loading: view?.status === 'loading',
      hasError: !!view?.error, error: view?.error || '', hasData: view?.status === 'ready',
      identity: data ? (data.hash || data.baseOid + ' → ' + data.headOid) : view?.ref || '',
      author: data ? [data.author, data.time].filter(Boolean).join(' · ') : '', body: data?.body || '',
      base: view?.base || '', head: view?.head || '', setBase: changeReference('base'), setHead: changeReference('head'),
      referenceOptions:[...new Set([view?.base,view?.head,...(view?.branches||[]).map(b=>b.ref)].filter(Boolean))].map(value=>({value,label:(view?.branches||[]).find(b=>b.ref===value)?.name||value})),
      branchSort:view?.branchSort||'activity',branchError:view?.branchError||'',setBranchSort:e=>{if(view&&['activity','name'].includes(e.target.value)){view.branchSort=e.target.value;return this.loadBranches();}return false;},
      hasParents:view?.kind==='commit'&&data?.parents?.length>0,parent:String(view?.parent||0),
      parents:(data?.parents||[]).map((oid,index)=>({value:String(index),label:'Rodič '+(index+1)+' · '+oid})),
      setParent:e=>{const parent=Number(e.target.value);if(view&&view.kind==='commit'&&Number.isSafeInteger(parent)&&parent>=0&&parent<(data?.parents||[]).length){view.parent=parent;return this.load(null);}return false;},
      diffNote:data?.diffTruncated?'Velká změna: diff je zkrácen na 1 MB. Seznam souborů je úplný; vyberte konkrétní soubor.':'',
      layout:view?.layout||'unified',unified:view?.layout!=='split',split:view?.layout==='split',setLayout:e=>{if(view&&['unified','split'].includes(e.target.value)){view.layout=e.target.value;this.onChange();}},splitLines:splitDiff(data?.diff),
      compareDisabled: !view || view.status === 'loading' || !REFERENCE.test(view.base) || !REFERENCE.test(view.head),
      compare: () => { if (this.current !== view) return false; view.kind = 'compare'; return this.load(null); },
      refresh: () => this.load(), close: () => this.close(), all: () => this.load(null),
      files: (data?.files || []).map(file => ({ path: file.path, selected: view?.path === file.path ? 'on' : '',
        added: file.added === null ? 'binární' : '+' + (file.added || 0), removed: file.removed === null ? '' : '−' + (file.removed || 0),
        go: () => { if (this.current === view) return this.load(file.path); return false; } })),
      lines: (data?.diff || '').split('\n').map(line => ({ text: line,
        cls: line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'added'
          : line.startsWith('-') && !line.startsWith('---') ? 'removed' : '' })),
      empty: view?.status === 'ready' && !data?.diff,
      ...this.presentation(view, data),
    };
  }
  // Vzhled návrhu V4: hlavička commitu, soubory se stavem a diff s čísly řádků. Jen odvozené údaje.
  presentation(view, data) {
    const files = data?.files || [], added = files.reduce((n, f) => n + (f.added || 0), 0), removed = files.reduce((n, f) => n + (f.removed || 0), 0);
    const rows = parseUnified(data?.diff), isCompare = view?.kind === 'compare', parents = data?.parents || [];
    const statusOf = file => file.binary ? 'binary' : file.oldPath ? 'renamed' : view?.statuses?.get(file.path) || 'modified';
    return {
      kindLabel: isCompare ? 'Porovnání revizí' : 'Detail commitu', isCommit: !isCompare, isCompare,
      shortHash: data?.hash ? data.hash.slice(0, 7) : '', authorName: data?.author || '—', dateText: data?.time ? czechDate(data.time) : '—',
      summary: isCompare ? (view?.base || '') + ' → ' + (view?.head || '') : [data?.author, data?.time && czechDate(data.time)].filter(Boolean).join(' · '),
      parentText: parents.length ? parents[0].slice(0, 12) + (parents.length > 1 ? ' · sloučení ' + parents.length + ' rodičů' : '') : 'Kořenový commit',
      hasBody: !!data?.body, fileCount: data ? plural(files.length, 'soubor', 'soubory', 'souborů') + ' · +' + added + ' −' + removed : '',
      currentPath: view?.path || 'Všechny změny', pathCls: view?.path ? 'mono' : '', allCls: view?.path ? '' : 'on',
      fileCards: files.map(file => { const [label, tone] = STATUS[statusOf(file)]; const at = file.path.lastIndexOf('/');
        return { name: at >= 0 ? file.path.slice(at + 1) : file.path, dir: at >= 0 ? file.path.slice(0, at + 1) : 'Kořen projektu', statusLabel: label, statusTone: tone,
          delta: file.added === null ? 'binární' : '+' + (file.added || 0) + ' −' + (file.removed || 0), cls: view?.path === file.path ? 'on' : '',
          go: () => { if (this.current === view) return this.load(file.path); return false; } }; }),
      rows, splitRows: splitRows(rows),
      unifiedCls: view?.layout !== 'split' ? 'on' : '', splitCls: view?.layout === 'split' ? 'on' : '',
      showUnified: () => { if (view) { view.layout = 'unified'; this.onChange(); } }, showSplit: () => { if (view) { view.layout = 'split'; this.onChange(); } },
    };
  }
}
module.exports = { ScmReview, splitDiff, parseUnified, splitRows, fileStatuses };
