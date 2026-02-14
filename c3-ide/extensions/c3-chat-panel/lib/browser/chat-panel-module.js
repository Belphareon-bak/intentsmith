"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
try { require("./styles/c3-theme.css"); } catch(e) {}
try { require("./styles/c3-chat.css"); } catch(e) {}

var inversify_1 = require("@theia/core/shared/inversify");
var browser_1 = require("@theia/core/lib/browser");
var react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
var ReactDOM = require("@theia/core/shared/react-dom");
var React = require("@theia/core/shared/react");
var h = React.createElement;

/* ═══ TRANSPORT MODULES ═══ */
try { require("./event-bus"); } catch(e) { console.warn('[C3] event-bus.js not loaded:', e.message); }
try { require("./ws-client"); } catch(e) { console.warn('[C3] ws-client.js not loaded:', e.message); }
try { require("./agent-client"); } catch(e) { console.warn('[C3] agent-client.js not loaded:', e.message); }
try { require("./terminal-client"); } catch(e) { console.warn('[C3] terminal-client.js not loaded:', e.message); }

/* ═══ COLORS ═══ */
var C={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',
  tx1:'#ececef',tx2:'#a1a1aa',tx3:'#5e8a6d',tx4:'#436b52',
  accent:'#22c55e',accentText:'#4ade80',accentBg:'rgba(34,197,94,0.08)',
  red:'#f87171',redBg:'rgba(239,68,68,0.1)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
  blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
  cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
  border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)',
  font:"'Plus Jakarta Sans',-apple-system,sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"};

/* Color interpolation for intensity sliders */
function _hp(hex){var n=parseInt(hex.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}
function _hs(r,g,b){return '#'+((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);}
function _cl(a,b,t){var ca=_hp(a),cb=_hp(b);return _hs(Math.round(ca[0]+(cb[0]-ca[0])*t),Math.round(ca[1]+(cb[1]-ca[1])*t),Math.round(ca[2]+(cb[2]-ca[2])*t));}
function _mkPalette(hex){return{accent:hex,text:_cl(hex,'#ffffff',0.4),dim:_cl(hex,'#000000',0.3),tx3:_cl('#71717a',hex,0.5),tx4:_cl('#52525b',hex,0.5)};}

function svg(p,w){return '<svg width="'+(w||14)+'" height="'+(w||14)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
function svgEl(p,w){return h('span',{style:{display:'inline-flex',alignItems:'center'},dangerouslySetInnerHTML:{__html:svg(p,w)}});}
/* Toggle switch (iOS-style) */
function togSw(on,onChange){return h('div',{onClick:function(){if(onChange)onChange(!on);},style:{width:42,height:24,borderRadius:12,background:on?C.accent:C.bg4,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}},h('div',{style:{width:20,height:20,borderRadius:10,background:'#fff',position:'absolute',top:2,left:on?20:2,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}));}
/* Safe stringify — prevents React error #31 when backend returns {type,value} objects */
function _s(v){return v==null?'':typeof v==='object'?(v.value||v.name||v.type||JSON.stringify(v)):String(v);}

var I={chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',expert:'<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',worker:'<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.18 1.65 1.65 0 0 0 4.27 6.36l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',chevDown:'<polyline points="6 9 12 15 18 9"/>',plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',split:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',close:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'};

/* ═══ DATA ═══ */
/* 15+1 built-in experts per docs — overridden by backend /api/experts */
var EXPERTS=[
  {emoji:'🤖',name:'Výchozí',desc:'Univerzální AI',fav:true,domain:'general'},
  {emoji:'✍️',name:'Spisovatel',desc:'Kreativní psaní',domain:'creative_writing'},
  {emoji:'🐉',name:'DnD Master',desc:'Stolní RPG',domain:'tabletop_rpg'},
  {emoji:'🎵',name:'Textař',desc:'Hudební texty',domain:'music_lyrics'},
  {emoji:'📊',name:'Analytik',desc:'Analýza dat',domain:'analysis',fav:true},
  {emoji:'💰',name:'Překupník',desc:'Trading',domain:'trading'},
  {emoji:'🧮',name:'Účetní',desc:'Daně, faktury, DPH',domain:'finance',fav:true,isSpecialist:true},
  {emoji:'⚖️',name:'Právník',desc:'Smlouvy, zákony',domain:'legal',isSpecialist:true},
  {emoji:'🩺',name:'Lékař',desc:'Zdraví, medicína',domain:'medical_education'},
  {emoji:'🧠',name:'Psycholog',desc:'Psychologie',domain:'psychology'},
  {emoji:'🤖',name:'AI Expert',desc:'Umělá inteligence',domain:'artificial_intelligence'},
  {emoji:'💻',name:'Vývojář',desc:'Kód, debugging',domain:'software_development',fav:true},
  {emoji:'🔧',name:'Technik',desc:'Technická podpora',domain:'technical_support'},
  {emoji:'🚗',name:'Autíčkář',desc:'Automobily',domain:'automobiles'},
  {emoji:'🏍️',name:'Motorkář',desc:'Motorky',domain:'motorcycles'},
  {emoji:'🏛️',name:'Politolog',desc:'Politika',domain:'politics'}
];
/* Start empty — populated from backend; no hardcoded stale data */
var PROJECTS=[];
var CONVERSATIONS=[];
/* Specialists = experts with deterministic tools (is_specialist from backend or default) */
var SPECIALISTS=EXPERTS.filter(function(e){return e.isSpecialist;}).map(function(e){return{emoji:e.emoji,name:e.name,desc:e.desc,domain:e.domain,tags:[e.domain||'','Specialista'].filter(Boolean)};});
var WORKERS=[];
var SETTINGS_SECTIONS=[{icon:'👤',title:'User / Identity',fields:[{l:'Jméno',v:'Belfik',t:'input'},{l:'E-mail',v:'belfik@c3.local',t:'input'},{l:'Role',v:'Developer',t:'select',opts:['Developer','Admin','User']}]},{icon:'🔔',title:'Notifications',fields:[{l:'Zvukové notifikace',v:true,t:'toggle'},{l:'Desktopové notifikace',v:true,t:'toggle'}]},{icon:'🎨',title:'Appearance',fields:[{l:'Téma'},{l:'Accent'},{l:'Pozadí'},{l:'Intenzita aktivní'},{l:'Intenzita neaktivní'},{l:'Velikost písma'},{l:'Písmo'}]},{icon:'🧠',title:'Memory & Context',fields:[{l:'Systémový prompt',v:'Vždy odpovídej v češtině.',t:'textarea'},{l:'Ukládat historii',v:true,t:'toggle'},{l:'Kontext',v:true,t:'toggle'}]},{icon:'📍',title:'Location',fields:[{l:'Město',v:'Praha',t:'input'},{l:'Země',v:'CZ',t:'input'},{l:'Jazyk',v:'Čeština',t:'select',opts:['Čeština','English']}]},{icon:'📄',title:'Output & Formats',fields:[{l:'Markdown výstup',v:true,t:'toggle'},{l:'Kódové bloky',v:true,t:'toggle'}]},{icon:'🖥️',title:'System',fields:[{l:'Model',v:'qwen2.5:32b',t:'select',opts:['qwen2.5:32b','llama3.1:70b','mistral:7b']},{l:'Ollama URL',v:'http://localhost:11434',t:'input'}]},{icon:'ℹ️',title:'About',fields:[]}];
var FILES=[];
var _collapsedDirs={};var _wtRoot='';var _wtLoading=false;var _wtRenaming=null;var _wtNewInput=null;
var _wtRawTree=null; /* raw nested tree from backend — re-flatten on collapse toggle */
/* ── Flatten nested tree respecting collapsed state ── */
function _flattenTree(nodes,depth,parentPath){
  var result=[];
  (nodes||[]).forEach(function(node){
    var fp=parentPath?parentPath+'/'+node.n:node.n;
    var entry={n:node.n,d:!!node.d,i:depth,fp:fp,_children:node.children||null};
    result.push(entry);
    if(node.d&&node.children&&!_collapsedDirs[fp]){
      result=result.concat(_flattenTree(node.children,depth+1,fp));
    }
  });
  return result;
}
/* ── Load real filesystem tree from backend ── */
function _loadWorkspaceTree(rootPath){
  if(!rootPath)return;
  _wtLoading=true;renderSidebar();
  fetch(_backendBase+'/api/workspace/tree?path='+encodeURIComponent(rootPath),{signal:AbortSignal.timeout(8000)})
  .then(function(r){return r.json();})
  .then(function(data){
    _wtLoading=false;
    if(data.tree){
      _wtRoot=data.root||rootPath;
      _wtRawTree=data.tree;
      FILES=_flattenTree(data.tree,0,null);
    }
    renderSidebar();
  }).catch(function(){_wtLoading=false;renderSidebar();});
}
/* ── Re-flatten without re-fetching (for collapse toggle) ── */
function _reflattenTree(){
  if(_wtRawTree){FILES=_flattenTree(_wtRawTree,0,null);renderSidebar();}
}
/* ── Create file on filesystem ── */
function _wtCreateFile(name){
  if(!_wtRoot||!name)return;
  fetch(_backendBase+'/api/workspace/file',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:name,root:_wtRoot,content:''}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Create directory on filesystem ── */
function _wtCreateDir(name){
  if(!_wtRoot||!name)return;
  fetch(_backendBase+'/api/workspace/directory',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:name,root:_wtRoot}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Rename file/dir on filesystem ── */
function _wtRenameItem(oldPath,newPath){
  if(!_wtRoot||!oldPath||!newPath||oldPath===newPath)return;
  fetch(_backendBase+'/api/workspace/rename',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({from:oldPath,to:newPath,root:_wtRoot}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Delete file/dir on filesystem ── */
function _wtDeleteItem(itemPath){
  if(!_wtRoot||!itemPath)return;
  fetch(_backendBase+'/api/workspace/file?path='+encodeURIComponent(itemPath)+'&root='+encodeURIComponent(_wtRoot),
    {method:'DELETE',signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:0,recent:[]},{id:'projects',label:'Projekty',icon:'folder',badge:0,recent:[]},{id:'specialists',label:'Specialisté',icon:'users',badge:SPECIALISTS.length,recent:SPECIALISTS.slice(0,2).map(function(s){return s.name;})},{id:'experts',label:'Expertyza',icon:'expert',badge:EXPERTS.length,recent:EXPERTS.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;})},{id:'workers',label:'Workeri',icon:'worker',badge:0,recent:[]}];

/* ═══ LIVE DATA FETCH ═══ */
var _backendBase='http://localhost:3335';
function fetchBackendData(){
  /* Projects — filter: must have path (real project, not conversation leak) */
  fetch(_backendBase+'/api/projects',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.projects||data.items||[]);
    items=items.filter(function(p){return p.path&&p.name;});
    if(items.length>0){PROJECTS=items.slice(0,20).map(function(p){return{id:p.id,name:_s(p.name||p.title)||'Projekt',path:p.path||null,status:_s(p.status)||'Active',created:_s(p.created_at||p.createdAt||p.created)||'',updated:_s(p.last_active||p.updatedAt||p.updated)||'',desc:_s(p.description)||'',tags:[]};});}
    else{PROJECTS=[];}
    NAV[1].badge=PROJECTS.length;NAV[1].recent=PROJECTS.slice(0,3).map(function(p){return p.name;});renderCenter();
  }).catch(function(){});
  /* Conversations */
  fetch(_backendBase+'/api/conversations',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.conversations||data.items||[]);
    if(items.length>0){CONVERSATIONS=items.slice(0,20).map(function(c){return{id:c.id,title:_s(c.title||c.name)||'Chat',preview:_s(c.preview||c.lastMessage||c.summary)||'',time:_s(c.time||c.updated_at||c.updatedAt)||'',expert:_s(c.expert)||'Výchozí'};});}
    else{CONVERSATIONS=[];}
    NAV[0].badge=CONVERSATIONS.length;NAV[0].recent=CONVERSATIONS.slice(0,3).map(function(c){return c.title;});renderCenter();
  }).catch(function(){});
  /* Experts — separate specialists (is_specialist or is_builtin+tools) */
  fetch(_backendBase+'/api/experts',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.experts||[]);
    if(items.length>0){
      var _localEx={};EXPERTS.forEach(function(le){_localEx[le.name]=le;});
      var allEx=items.map(function(e){
        var nm=_s(e.name);var le=_localEx[nm];
        var cfg=null;try{cfg=e.config?JSON.parse(e.config):null;}catch(ex){}
        return{id:e.id,emoji:_s(e.emoji)||(le&&le.emoji?le.emoji:'🤖'),name:nm,
          desc:_s(e.description||e.desc)||(le?le.desc:''),
          domain:_s(e.domain)||(le?le.domain:''),
          fav:e.favorite!=null?!!e.favorite:(le?!!le.fav:false),
          isSpecialist:!!(e.is_specialist||(cfg&&cfg.toolEnforcement)||(le&&le.isSpecialist)),
          temperature:e.temperature||null};
      });
      EXPERTS=allEx;
      /* Rebuild specialists from experts with is_specialist flag */
      SPECIALISTS=allEx.filter(function(e){return e.isSpecialist;}).map(function(e){
        return{id:e.id,emoji:e.emoji,name:e.name,desc:e.desc,domain:e.domain,
          tags:[e.domain,'Specialista'].filter(Boolean)};
      });
    }
    NAV[3].badge=EXPERTS.length;NAV[3].recent=EXPERTS.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;});
    NAV[2].badge=SPECIALISTS.length;NAV[2].recent=SPECIALISTS.slice(0,3).map(function(s){return s.name;});
    renderCenter();
  }).catch(function(){});
  /* Workers (agents) */
  fetch(_backendBase+'/api/agents',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.agents||[]);
    if(items.length>0){WORKERS=items.map(function(a){
      var sched=a.definition&&a.definition.schedule?a.definition.schedule:null;
      var cronStr=sched?(sched.type==='cron'?_s(sched.value):_s(sched.value||sched.type)):_s(a.schedule||a.cron)||'';
      return{id:a.id,name:_s(a.name),status:a.enabled===false?'Paused':(_s(a.status)||'Running'),
        cron:cronStr,lastRun:_s(a.lastRun)||'',desc:_s(a.description||a.desc)||''};
    });}else{WORKERS=[];}
    NAV[4].badge=WORKERS.length;NAV[4].recent=WORKERS.slice(0,3).map(function(w){return w.name;});renderCenter();
  }).catch(function(){});
}
setTimeout(fetchBackendData,1500);
/* Auto-detect workspace root: try cwd from backend health, fallback to c3-agent-wip */
setTimeout(function(){
  fetch(_backendBase+'/api/health',{signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(d){
    var root=d.cwd||d.workDir||null;
    if(!root){
      /* Fallback: detect from projects API */
      fetch(_backendBase+'/api/projects',{signal:AbortSignal.timeout(3000)})
      .then(function(r2){return r2.json();})
      .then(function(data){
        var items=Array.isArray(data)?data:(data.projects||[]);
        var withPath=items.find(function(p){return p.path;});
        if(withPath){_wtRoot=withPath.path;_loadWorkspaceTree(withPath.path);}
      }).catch(function(){});
      return;
    }
    _wtRoot=root;_loadWorkspaceTree(root);
  }).catch(function(){});
},2000);
/* Refetch every 30s + health monitor */
setInterval(function(){
  fetch(_backendBase+'/api/health',{signal:AbortSignal.timeout(2000)})
  .then(function(r){return r.json();})
  .then(function(d){
    _serverHealth.status=d.status||'ok';
    _serverHealth.lastCheck=Date.now();
    _serverHealth.wsConnected=(typeof C3WS!=='undefined'&&C3WS.isReady())||false;
    fetchBackendData();
    renderSidebar();
  })
  .catch(function(){
    _serverHealth.status='offline';
    _serverHealth.lastCheck=Date.now();
    _serverHealth.wsConnected=false;
    renderSidebar();
  });
},30000);

/* ═══════════════════════════════════════════════════════════
   1. SIDEBAR WIDGET (ReactWidget — read-only, update() is fine)
   ═══════════════════════════════════════════════════════════ */
var C3_SIDEBAR_ID='c3-sidebar';

class C3SidebarWidget extends react_widget_1.ReactWidget {
  constructor(){
    super();this.id=C3_SIDEBAR_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.outline='none';
    this._active='chats';this._dd={};this._collapsed=false;
  }
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render */}
  onAfterAttach(){
    _sidebarWidget=this;
    this._render();
    /* Mount center view */
    setTimeout(function(){
      var main=document.getElementById('theia-main-content-panel');
      if(main&&!_centerContainer){
        _centerContainer=document.createElement('div');
        _centerContainer.id='c3-center-mount';
        _centerContainer.style.cssText='position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;';
        main.style.position='relative';
        main.appendChild(_centerContainer);
        renderCenter();
        console.log('[C3] Center view mounted into main panel');
      }
      /* Hide activity bars via JS (CSS can't override Theia's inline widths on SplitPanel children) */
      document.querySelectorAll('.theia-app-sidebar-container').forEach(function(el){
        el.style.cssText='display:none!important;width:0!important;min-width:0!important;max-width:0!important;overflow:hidden!important;flex:0 0 0!important;padding:0!important;';
        /* Also collapse the parent SplitPanel child */
        var parent=el.parentElement;
        if(parent&&parent.classList.contains('lm-SplitPanel-child')){
          var w=parent.style.width?parseInt(parent.style.width):parent.getBoundingClientRect().width;
          /* Only collapse if it's narrow (activity bar area, not our sidebar) */
          if(w<60||parent.getBoundingClientRect().width<60){
            parent.style.cssText='width:0!important;min-width:0!important;max-width:0!important;flex:0 0 0!important;';
          }
        }
      });
      /* Also hide the TabBar elements */
      document.querySelectorAll('.theia-app-sides').forEach(function(el){
        el.style.cssText='display:none!important;width:0!important;';
      });
      /* ── Hide sidepanel toolbars (the 35px strips) ────────────
         Target: .theia-sidepanel-toolbar (exact class from DOM inspector)
         Strategy: inject <style> for CSS priority + setProperty to
         preserve Lumino's layout styles while hiding the element. */
      if(!document.getElementById('c3-strip-hide')){
        var ss=document.createElement('style');ss.id='c3-strip-hide';
        ss.textContent='.theia-sidepanel-toolbar{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;visibility:hidden!important;opacity:0!important;}.theia-sidepanel-toolbar~*{top:0!important;height:100%!important;}.lm-TabBar-toolbar{display:none!important;height:0!important;overflow:hidden!important;}#theia-right-side-panel .lm-TabBar~*,#theia-bottom-content-panel .lm-TabBar~*{top:0!important;height:100%!important;}#theia-right-side-panel .lm-DockPanel-widget,#theia-bottom-content-panel .lm-DockPanel-widget{top:0!important;height:100%!important;}.lm-Widget:focus,.lm-Widget:focus-visible,#c3-sidebar:focus,#c3-chat-panel:focus,#c3-agent-panel:focus{outline:none!important;box-shadow:none!important;}*:focus-visible{outline:none!important;}#theia-top-panel,.p-MenuBar,#theia\\:menubar,.theia-app-header{background:var(--c3-bg1,#111114)!important;border-color:var(--c3-border,rgba(255,255,255,0.06))!important;}#theia-left-side-panel,#theia-right-side-panel,#theia-bottom-content-panel{background:var(--c3-bg1,#111114)!important;}input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:var(--c3-bg4,#27282e);outline:none;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--c3-accent,#22c55e);cursor:pointer;border:2px solid var(--c3-bg1,#111114);}body{border:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;box-sizing:border-box!important;}#theia-right-side-panel{border-left:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}#theia-bottom-content-panel{border-top:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}@keyframes c3-ac-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}';
        document.head.appendChild(ss);
      }
      function _hideStrips(){
        document.querySelectorAll('.theia-sidepanel-toolbar').forEach(function(el){
          el.style.setProperty('display','none','important');
          el.style.setProperty('height','0','important');
          el.style.setProperty('max-height','0','important');
          el.style.setProperty('min-height','0','important');
          el.style.setProperty('overflow','hidden','important');
          el.style.setProperty('visibility','hidden','important');
          /* Expand siblings to fill the 35px gap left by hidden toolbar.
             Use 100% instead of explicit pixels so collapse/resize works. */
          var par=el.parentElement;
          if(par){
            for(var j=0;j<par.children.length;j++){
              var sib=par.children[j];
              if(sib!==el&&sib.style){
                sib.style.setProperty('top','0px','important');
                sib.style.setProperty('height','100%','important');
              }
            }
          }
        });
        document.querySelectorAll('.lm-TabBar-toolbar').forEach(function(el){
          el.style.setProperty('display','none','important');
          el.style.setProperty('height','0','important');
        });
        /* Expand DockPanel widgets in right/bottom panels where TabBar is hidden */
        ['#theia-right-side-panel','#theia-bottom-content-panel'].forEach(function(sel){
          document.querySelectorAll(sel+' .lm-TabBar').forEach(function(tb){
            var par=tb.parentElement;if(!par)return;
            for(var k=0;k<par.children.length;k++){
              var sib=par.children[k];
              if(sib!==tb&&sib.style&&!sib.classList.contains('lm-TabBar')){
                sib.style.setProperty('top','0px','important');
                sib.style.setProperty('height','100%','important');
              }
            }
          });
        });
        document.querySelectorAll('.theia-app-sidebar-container').forEach(function(el){
          el.style.setProperty('display','none','important');
          el.style.setProperty('width','0','important');
          el.style.setProperty('min-width','0','important');
        });
        document.querySelectorAll('.theia-app-sides').forEach(function(el){
          el.style.setProperty('display','none','important');
          el.style.setProperty('width','0','important');
        });
      }
      _hideStrips();
      var _sc=0;var _st=setInterval(function(){_hideStrips();_sc++;if(_sc>30){clearInterval(_st);setInterval(_hideStrips,5000);}},500);
    },500);
  }
  _render(){
    var self=this;
    ReactDOM.render(h(SidebarApp,{getState:function(){return{active:self._active,dd:self._dd,collapsed:self._collapsed};},setState:function(s){if(s.active!==undefined)self._active=s.active;if(s.dd!==undefined)self._dd=s.dd;if(s.collapsed!==undefined){self._collapsed=s.collapsed;try{var app=window._c3App;if(app&&app.shell&&typeof app.shell.resize==='function'){app.shell.resize(s.collapsed?48:240,'left');}}catch(ex){}}self._render();}}),this.node);
  }
}
inversify_1.decorate(inversify_1.injectable(),C3SidebarWidget);
var _sidebarWidget=null;function renderSidebar(){if(_sidebarWidget)_sidebarWidget._render();}

function SidebarApp(props){
  var s=props.getState(),set=props.setState;
  /* ── Collapsed icon-only mode ── */
  if(s.collapsed){
    return h('div',{style:{display:'flex',flexDirection:'column',width:48,maxWidth:48,height:'100%',background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden',alignItems:'center',paddingTop:6}},
      h('div',{style:{cursor:'pointer',width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,color:C.tx3,marginBottom:2},title:'Rozbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:function(){set({collapsed:false});}},svgEl('<polyline points="9 18 15 12 9 6"/>',18)),
      h('div',{style:{width:24,height:1,background:C.border,marginBottom:6}}),
      NAV.map(function(item){
        var isA=s.active===item.id;
        return h('div',{key:item.id,title:item.label,style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',marginBottom:2},
          onMouseEnter:function(e){if(!isA)e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background=isA?C.accentBg:'transparent';},
          onClick:function(){set({active:item.id,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:item.id}}));}},
          h('span',{style:{display:'flex'},dangerouslySetInnerHTML:{__html:svg(I[item.icon],18)}}));
      }),
      h('div',{style:{flex:1}}),
      h('div',{title:'Nastavení',style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',marginBottom:14,transition:'background 0.12s, color 0.12s'},
        onMouseEnter:function(e){if(s.active!=='settings'){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
        onMouseLeave:function(e){e.currentTarget.style.background=s.active==='settings'?C.accentBg:'transparent';e.currentTarget.style.color=s.active==='settings'?C.accentText:C.tx3;},
        onClick:function(){set({active:'settings',dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:'settings'}}));}},
        svgEl(I.settings,18)));
  }
  /* ── Full expanded mode ── */
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',minWidth:200,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden'}},
    /* Header with C3 Studio + collapse */
    h('div',{style:{display:'flex',alignItems:'center',padding:'6px 8px 2px',flexShrink:0}},
      h('div',{style:{width:22,height:22,background:'linear-gradient(135deg,'+C.accent+','+C.accentText+')',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:8,color:'#fff',flexShrink:0}},'C3'),
      h('span',{style:{fontSize:11,fontWeight:700,color:C.tx1,marginLeft:6,flex:1}},'C3 Studio'),
      h('div',{style:{width:7,height:7,borderRadius:'50%',background:_serverHealth.status==='ok'&&_serverHealth.wsConnected?C.accent:_serverHealth.status==='ok'?C.amber:'#ef4444',flexShrink:0,marginRight:2},title:_serverHealth.status==='ok'?(_serverHealth.wsConnected?'Backend OK + WS':'Backend OK, WS odpojen'):'Backend offline'}),
      h('div',{style:{cursor:'pointer',padding:4,borderRadius:4,color:C.tx4},title:'Sbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.color=C.tx2;},onMouseLeave:function(e){e.currentTarget.style.color=C.tx4;},
        onClick:function(){set({collapsed:true});}},svgEl('<polyline points="15 18 9 12 15 6"/>',14))),
    /* Nav */
    h('div',{style:{flex:1,overflowY:'auto',padding:'2px 8px'}},
      NAV.map(function(item){
        var isA=s.active===item.id,isO=s.dd[item.id],els=[];
        els.push(h('div',{key:item.id,style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',marginBottom:2},
          onClick:function(){set({active:item.id,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:item.id}}));}},
          h('span',{style:{flexShrink:0,display:'flex'},dangerouslySetInnerHTML:{__html:svg(I[item.icon],20)}}),
          h('span',{style:{fontSize:13.5,fontWeight:600,flex:1}},item.label),
          item.badge?h('span',{style:{fontSize:9,fontFamily:C.mono,background:C.bg4,padding:'1px 6px',borderRadius:8,color:C.tx3}},item.badge):null,
          item.recent?h('span',{style:{flexShrink:0,display:'flex',padding:2,cursor:'pointer',transform:isO?'rotate(180deg)':'none',transition:'transform 0.15s'},
            onClick:function(e){e.stopPropagation();var nd={};nd[item.id]=!s.dd[item.id];set({dd:nd});}},svgEl(I.chevDown,14)):null));
        if(isO&&item.recent)els.push(h('div',{key:item.id+'-dd',style:{padding:'2px 0 6px 34px'}},item.recent.map(function(r,i){
          return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:4,fontSize:12,color:C.tx3,cursor:'pointer'},
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){set({active:item.id,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:item.id,select:r}}));}},
            h('span',{style:{width:6,height:6,borderRadius:'50%',background:C.accent,flexShrink:0}}),r);})));
        return els;
      }),
      h('div',{style:{height:1,background:C.border,margin:'6px 12px'}}),
      h('div',{style:{display:'flex',alignItems:'center',padding:'6px 10px 2px'}},
        h('span',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.6px',flex:1}},'Working Tree'),
        h('div',{style:{display:'flex',gap:2}},
          _wtRoot?h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:11},title:'Obnovit',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_loadWorkspaceTree(_wtRoot);}},'↻'):null,
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:11},title:'Sbalit vše',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){FILES.forEach(function(f){if(f.d&&f.i===0)_collapsedDirs[f.fp]=true;});_reflattenTree();}},'↑'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:12},title:'Nový soubor',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_wtNewInput={type:'file',parent:null};renderSidebar();}},'📄'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:12},title:'Nová složka',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_wtNewInput={type:'dir',parent:null};renderSidebar();}},'📁'))),
      /* Workspace root path indicator */
      _wtRoot?h('div',{style:{padding:'2px 10px 4px',fontSize:9,color:C.tx4,fontFamily:C.mono,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},title:_wtRoot},
        _wtRoot.split('/').slice(-2).join('/')):
      h('div',{style:{padding:'4px 10px'},onClick:function(){
        /* Prompt for path and load */
        var p=prompt('Zadejte cestu ke složce projektu:','/home/belphareon/Projects/c3-agent-wip');
        if(p){_wtRoot=p;_loadWorkspaceTree(p);}
      }},h('div',{style:{padding:'6px 10px',borderRadius:6,border:'1px dashed '+C.border2,cursor:'pointer',textAlign:'center',fontSize:11,color:C.tx3}},
        'Otevřít složku')),
      /* New file/dir inline input */
      _wtNewInput?h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'2px 8px'}},
        h('span',{style:{fontSize:13,flexShrink:0}},_wtNewInput.type==='dir'?'📁':'📄'),
        h('input',{autoFocus:true,style:{flex:1,background:C.bg3,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 6px',color:C.tx1,fontFamily:C.mono,fontSize:11,outline:'none'},
          placeholder:_wtNewInput.type==='dir'?'název-složky':'soubor.js',
          onKeyDown:function(e){
            if(e.key==='Enter'){
              var name=e.target.value.trim();
              if(name&&_wtRoot){
                var parentPath=_wtNewInput.parent?_wtNewInput.parent+'/':'';
                if(_wtNewInput.type==='dir'){_wtCreateDir(parentPath+name);}
                else{_wtCreateFile(parentPath+name);}
              }
              _wtNewInput=null;renderSidebar();
            }else if(e.key==='Escape'){_wtNewInput=null;renderSidebar();}
          },
          onBlur:function(){_wtNewInput=null;renderSidebar();}})):null,
      /* Loading indicator */
      _wtLoading?h('div',{style:{padding:'8px 10px',textAlign:'center',fontSize:10,color:C.tx4}},'Načítám...'):
      /* File tree */
      (function(){
        var stColors={M:C.accentText,A:'#22d3ee',D:'#ef4444',U:'#f97316'};
        if(FILES.length===0&&_wtRoot){return h('div',{style:{padding:'8px 10px',fontSize:11,color:C.tx4}},'Prázdná složka');}
        if(FILES.length===0){return null;}
        return FILES.map(function(f,i){
          var isCol=f.d&&_collapsedDirs[f.fp];
          var filePath=_buildFilePath(f);
          var fullPath=_wtRoot?((_wtRoot+'/'+filePath).replace(/\/+/g,'/')):filePath;
          var isRenaming=_wtRenaming&&_wtRenaming.path===filePath;
          return h('div',{key:f.fp+i,style:{display:'flex',alignItems:'center',gap:4,paddingLeft:(8+f.i*14),paddingRight:8,paddingTop:3,paddingBottom:3,borderRadius:4,fontSize:12,color:f.a?C.accentText:C.tx2,background:f.a?C.accentBg:'transparent',cursor:'pointer'},
            onMouseEnter:function(e){if(!f.a)e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background=f.a?C.accentBg:'transparent';},
            onClick:function(){if(f.d){_collapsedDirs[f.fp]=!_collapsedDirs[f.fp];_reflattenTree();}else{FILES.forEach(function(x){x.a=false;});f.a=true;renderSidebar();}},
            onDoubleClick:function(){if(!f.d&&_wtRoot){document.dispatchEvent(new CustomEvent('c3-file-open',{detail:{path:fullPath}}));}},
            onContextMenu:function(e){e.preventDefault();_wtRenaming={path:filePath,name:f.n,isDir:f.d};renderSidebar();}},
            f.d?h('span',{style:{fontSize:8,color:C.tx4,width:10,textAlign:'center',flexShrink:0}},isCol?'▶':'▼'):h('span',{style:{width:10,flexShrink:0}}),
            h('span',{style:{flexShrink:0,fontSize:13}},f.d?'📁':'📄'),
            isRenaming?h('input',{autoFocus:true,defaultValue:f.n,style:{flex:1,background:C.bg3,border:'1px solid '+C.accent,borderRadius:3,padding:'1px 4px',color:C.tx1,fontFamily:C.mono,fontSize:11,outline:'none'},
              onClick:function(e){e.stopPropagation();},
              onKeyDown:function(e){
                e.stopPropagation();
                if(e.key==='Enter'){
                  var newName=e.target.value.trim();
                  if(newName&&newName!==f.n){
                    var oldPath=filePath;
                    var newPath=f.p?(f.p+'/'+newName):newName;
                    _wtRenameItem(oldPath,newPath);
                  }
                  _wtRenaming=null;renderSidebar();
                }else if(e.key==='Escape'){_wtRenaming=null;renderSidebar();}
              },
              onBlur:function(){_wtRenaming=null;renderSidebar();}}):
            h('span',{style:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},f.n),
            isRenaming?h('span',{style:{fontSize:12,color:C.red,cursor:'pointer',padding:'0 2px',flexShrink:0},title:'Smazat',
              onClick:function(e){e.stopPropagation();if(confirm('Smazat '+f.n+'?')){_wtDeleteItem(filePath);}_wtRenaming=null;renderSidebar();}},'×'):
            f.st?h('span',{style:{fontSize:9,fontWeight:700,color:stColors[f.st]||C.tx4,fontFamily:C.mono,flexShrink:0}},f.st):null);
        });
      })()
    ),
    /* Settings bottom */
    h('div',{style:{padding:'10px 8px',borderTop:'1px solid '+C.border,flexShrink:0}},
      h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',transition:'background 0.12s, color 0.12s'},
        onMouseEnter:function(e){if(s.active!=='settings'){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
        onMouseLeave:function(e){e.currentTarget.style.background=s.active==='settings'?C.accentBg:'transparent';e.currentTarget.style.color=s.active==='settings'?C.accentText:C.tx3;},
        onClick:function(){set({active:'settings',dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:'settings'}}));}},
        svgEl(I.settings,18),h('span',{style:{fontSize:13.5,fontWeight:600}},'Nastavení'))));
}


/* ═══════════════════════════════════════════════════════════
   2. CENTER VIEW (ReactDOM.render into main panel)
   ═══════════════════════════════════════════════════════════ */
var _centerState={view:'experts',detail:null,openSections:{},zoom:1,listView:false,settingsSection:null};
/* ═══ Editor tab state (Fáze 5 — Blok E) ═══ */
var _editorState={active:false,tabs:[],activeTabId:null,scrollRaf:null};
/* ═══ Project wizard state ═══ */
var _projectWizard={active:false,step:0,data:{name:'',path:'',description:'',type:'general'},saving:false};
var WIZARD_STEPS=[
  {id:'name',label:'Název',icon:'📝',desc:'Pojmenujte projekt'},
  {id:'type',label:'Typ',icon:'📋',desc:'Zvolte typ projektu'},
  {id:'path',label:'Umístění',icon:'📁',desc:'Zvolte cestu na disku'},
  {id:'desc',label:'Popis',icon:'💬',desc:'Popište cíl projektu'},
  {id:'review',label:'Souhrn',icon:'✅',desc:'Zkontrolujte a vytvořte'}
];
var PROJECT_TYPES=[
  {id:'general',label:'Obecný',icon:'📦',desc:'Prázdný projekt bez šablony'},
  {id:'webapp',label:'Web App',icon:'🌐',desc:'Webová aplikace (frontend + backend)'},
  {id:'api',label:'API / Backend',icon:'⚡',desc:'REST/GraphQL API server'},
  {id:'automation',label:'Automatizace',icon:'🤖',desc:'Skripty, pipeline, worker'},
  {id:'data',label:'Data / ML',icon:'📊',desc:'Analýza dat, ML model, pipeline'}
];
var _centerContainer=null;
function renderCenter(){if(!_centerContainer)return;ReactDOM.render(h(CenterApp,null),_centerContainer);}

function CenterApp(){
  var view=_centerState.view,detail=_centerState.detail;
  return h('div',{style:{display:'flex',height:'100%',width:'100%',background:C.bg0,fontFamily:C.font,overflow:'hidden',position:'absolute',top:0,left:0,right:0,bottom:0}},
    h('div',{style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
      _projectWizard.active?centerProjectWizard():
      _editorState.active?centerEditor():
      view==='experts'?centerExperts():view==='projects'?centerProjects():view==='chats'?centerConvos():
      view==='specialists'?centerSpecs():view==='workers'?centerWorkers():view==='settings'?centerSettings():centerWelcome()),
    detail&&!_editorState.active?centerDetail():null);
}

function viewHead(t,showZoom,onAdd){
  return h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
    h('span',{style:{fontSize:15,fontWeight:700,color:C.tx1,flex:1}},t),
    onAdd?h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:10},onClick:onAdd},svgEl(I.plus,12),'Nový'):null,
    showZoom?h('div',{style:{display:'flex',alignItems:'center',gap:6}},
      svgEl('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',14),
      h('input',{type:'range',min:0,max:2,step:1,value:_centerState.zoom,onChange:function(e){_centerState.zoom=parseInt(e.target.value);renderCenter();},
        style:{width:60,accentColor:C.accent,cursor:'pointer'}}),
      svgEl('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',14),
      h('div',{style:{width:1,height:16,background:C.border,margin:'0 2px'}}),
      h('div',{style:{display:'flex',gap:2}},
        h('button',{style:{background:!_centerState.listView?C.bg4:'transparent',border:'none',borderRadius:4,padding:4,cursor:'pointer',display:'flex',color:!_centerState.listView?C.tx1:C.tx4},onClick:function(){_centerState.listView=false;renderCenter();},title:'Dlaždice'},svgEl('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',14)),
        h('button',{style:{background:_centerState.listView?C.bg4:'transparent',border:'none',borderRadius:4,padding:4,cursor:'pointer',display:'flex',color:_centerState.listView?C.tx1:C.tx4},onClick:function(){_centerState.listView=true;renderCenter();},title:'Seznam'},svgEl('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',14)))
    ):null);
}

function card(item,onClick){
  var _z=_centerState.zoom,sel=_centerState.detail&&_centerState.detail.name===item.name;
  if(_centerState.listView){
    var _lf=_z===0?11:_z===2?14.5:12.5;var _ld=_z===0?9.5:_z===2?12.5:11;var _le=_z===0?14:_z===2?24:18;
    return h('div',{key:item.name,onClick:onClick,style:{display:'flex',alignItems:'center',gap:_z===0?6:_z===2?14:10,background:C.bg2,border:'1px solid '+(sel?C.accent:C.border),borderRadius:8,padding:(_z===0?'6px 10px':_z===2?'14px 18px':'8px 14px'),cursor:'pointer',transition:'border-color 0.15s',minHeight:_z===0?28:_z===2?48:36},
      onMouseEnter:function(e){if(!sel)e.currentTarget.style.borderColor=C.border2;},onMouseLeave:function(e){if(!sel)e.currentTarget.style.borderColor=C.border;}},
      item.emoji?h('span',{style:{fontSize:_le,flexShrink:0}},item.emoji):null,
      h('span',{style:{fontSize:_lf,fontWeight:700,color:C.tx1,minWidth:100}},item.name),
      h('span',{style:{flex:1,fontSize:_ld,color:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},item.desc||''),
      item.status?pill(item.status):null,
      item.sprint?h('span',{style:{fontSize:_ld,color:C.tx4,fontFamily:C.mono}},'S'+item.sprint):null,
      item.fav!==undefined?h('span',{style:{fontSize:_z===0?12:_z===2?18:14,color:item.fav?C.accentText:C.tx4,cursor:'pointer',padding:'0 4px',userSelect:'none',flexShrink:0},onClick:function(ev){ev.stopPropagation();item.fav=!item.fav;if(item.id){fetch(_backendBase+'/api/experts/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:item.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderCenter();}},item.fav?'★':'☆'):null);
  }
  return h('div',{key:item.name,onClick:onClick,style:{background:C.bg2,border:'1px solid '+(sel?C.accent:C.border),borderRadius:12,padding:(_z===0?12:_z===2?24:16),cursor:'pointer',position:'relative',minHeight:(_z===0?70:_z===2?120:90),overflow:'hidden',transition:'border-color 0.15s'},
    onMouseEnter:function(e){if(!sel)e.currentTarget.style.borderColor=C.border2;},onMouseLeave:function(e){if(!sel)e.currentTarget.style.borderColor=C.border;}},
    h('div',{style:{position:'absolute',top:0,left:0,right:0,height:3,background:sel?C.accent:'transparent'}}),
    item.emoji?h('div',{style:{display:'flex',alignItems:'center',gap:12}},
      h('span',{style:{fontSize:22}},item.emoji),
      h('div',{style:{flex:1,minWidth:0,overflow:'hidden'}},h('div',{style:{fontSize:13,fontWeight:700,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},item.name),h('div',{style:{fontSize:11,color:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},item.desc)),
      item.fav!==undefined?h('span',{style:{fontSize:16,color:item.fav?C.accentText:C.tx4,cursor:'pointer',padding:'2px 4px',userSelect:'none'},onClick:function(ev){ev.stopPropagation();item.fav=!item.fav;if(item.id){fetch(_backendBase+'/api/experts/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:item.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderCenter();}},item.fav?'★':'☆'):null
    ):h('div',null,h('div',{style:{fontSize:13,fontWeight:700,color:C.tx1,marginBottom:3}},item.name),
      item.desc?h('div',{style:{fontSize:11,color:C.tx3,lineHeight:'1.4',marginBottom:8}},item.desc):null,
      item.status?h('div',{style:{display:'flex',alignItems:'center',gap:6}},pill(item.status),item.sprint?h('span',{style:{fontSize:10,color:C.tx4}},'Sprint '+item.sprint):null):null));
}

function pill(s){var st=_s(s);var m={Active:{b:'rgba(34,197,94,0.1)',c:C.accentText},Done:{b:C.blueBg,c:C.blue},WIP:{b:C.amberBg,c:C.amber},Running:{b:'rgba(34,197,94,0.1)',c:C.accentText},Paused:{b:C.amberBg,c:C.amber}};var v=m[st]||{b:C.bg4,c:C.tx3};return h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',fontFamily:C.mono,background:v.b,color:v.c}},st);}

function grid(items){
  var z=_centerState.zoom;
  if(_centerState.listView){var lg=z===0?4:z===2?8:6;return h('div',{style:{display:'flex',flexDirection:'column',gap:lg}},items);}
  var minW=z===0?150:z===2?300:210;
  var gap=z===0?8:z===2?16:12;
  return h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax('+minW+'px,1fr))',gap:gap}},items);
}

function setDetail(d){_centerState.detail=d;renderCenter();}

function _addNew(view){
  /* Experts → dispatch wizard open event (center-views-module.js listens) */
  if(view==='experts'){
    try{document.dispatchEvent(new CustomEvent('c3-wizard-open',{detail:{mode:'create'}}));}catch(e){}
    return;
  }
  /* Workers → inject wizard trigger into chat */
  if(view==='workers'){
    var s=_sessions[_sessionActive]||_sessions[0];
    s.chat.msgs.push({role:'system',text:'🛠️ Spouštím průvodce vytvořením workeru...'});
    if(typeof C3WS!=='undefined'&&C3WS.isReady()){C3WS.sendChat('/new-agent',s);}
    renderChat();_chatScrollPane(_sessionActive);
    return;
  }
  /* Conversations → create via API, link to session */
  if(view==='chats'){
    var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
    fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nová konverzace',expert:'Výchozí'}),signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();})
    .then(function(created){
      if(created.id){
        _sessions[_ti]._convId=created.id;
        _sessions[_ti].chat.msgs=[{role:'system',text:'📂 Nová konverzace vytvořena.'}];
        _sessions[_ti].chat.ctx=0;
        _persistSessionState();renderChat();_chatScrollPane(_ti);
      }
      fetchBackendData();
    }).catch(function(){
      /* Fallback: local only */
      _sessions[_ti].chat.msgs=[{role:'system',text:'📂 Nová konverzace (lokální).'}];
      _sessions[_ti].chat.ctx=0;
      renderChat();
    });
    return;
  }
  /* Projects → open multi-step wizard in center view */
  if(view==='projects'){
    _projectWizard={active:true,step:0,data:{name:'',path:'',description:'',type:'general'},saving:false};
    _centerState.detail=null;
    renderCenter();
    return;
  }
  var tpl={
    specialists:{name:'Nový specialista',fields:[{k:'Oblast',v:''}],tags:[],actions:['Uložit','Zrušit'],editing:true,_isNew:true}};
  setDetail(tpl[view]||tpl.specialists);
}

function centerExperts(){return h(React.Fragment,null,viewHead('Expertyza',true,function(){_addNew('experts');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(EXPERTS.map(function(e){var tags=[e.isSpecialist?'Specialista':'Expert'];if(e.domain)tags.push(e.domain);return card(e,function(){setDetail({name:e.name,fields:[{k:'Typ',v:e.desc},{k:'Doména',v:e.domain||'general'},{k:'Emoji',v:e.emoji},{k:'Specialista',v:e.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:e.fav,type:'fav',_expertName:e.name}],tags:tags,actions:['Otevřít','Editovat']});});}))));}

function centerProjects(){return h(React.Fragment,null,viewHead('Projekty',true,function(){_addNew('projects');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(PROJECTS.map(function(p){return card(p,function(){setDetail({name:p.name,fields:[{k:'Status',v:p.status,a:p.status==='Active'},{k:'Cesta',v:p.path||''},{k:'Popis',v:p.desc||''},{k:'Vytvořeno',v:p.created},{k:'Aktualizováno',v:p.updated}],tags:p.tags,actions:['Otevřít','Editovat','Archivovat']});});}))));}

function centerConvos(){return h(React.Fragment,null,viewHead('Konverzace',true,function(){_addNew('chats');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(CONVERSATIONS.map(function(c){return h('div',{key:c.title,onClick:function(){setDetail({name:c.title,fields:[{k:'Expert',v:c.expert},{k:'Čas',v:c.time}],tags:['Chat',c.expert],actions:['Otevřít','Archivovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===c.title?C.accent:C.border),borderRadius:12,padding:14,cursor:'pointer',display:'flex',gap:10}},h('div',{style:{width:26,height:26,borderRadius:'50%',background:C.bg4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,flexShrink:0}},'💬'),h('div',{style:{flex:1,minWidth:0}},h('div',{style:{fontSize:12.5,fontWeight:700,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.title),h('div',{style:{fontSize:11,color:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.preview)),h('span',{style:{fontSize:10,color:C.tx4,flexShrink:0}},c.time));}))));}

function centerSpecs(){return h(React.Fragment,null,viewHead('Specialisté',true,function(){_addNew('specialists');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(SPECIALISTS.map(function(s){return card(s,function(){setDetail({name:s.name,fields:[{k:'Oblast',v:s.desc}],tags:s.tags,actions:['Otevřít','Editovat']});});}))));}

function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',true,function(){_addNew('workers');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(WORKERS.map(function(w){return h('div',{key:w.name,onClick:function(){setDetail({name:w.name,fields:[{k:'Status',v:w.status,a:w.status==='Running'},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:['Spustit','Pozastavit','Editovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===w.name?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer'}},h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:6}},h('span',{style:{fontSize:18}},'⚙️'),h('span',{style:{fontSize:13,fontWeight:700,color:C.tx1,flex:1}},w.name),pill(w.status)),h('div',{style:{fontSize:11,color:C.tx3}},_s(w.desc)),h('div',{style:{fontSize:10,color:C.tx4,marginTop:6,fontFamily:C.mono}},'cron: '+_s(w.cron)));}))));}

/* ═══ PROJECT CREATION WIZARD ═══ */
function _wizardCanNext(){
  var d=_projectWizard.data,s=_projectWizard.step;
  if(s===0)return d.name.trim().length>=2;
  if(s===1)return!!d.type;
  if(s===2)return d.path.trim().length>=1;
  return true;
}
function _wizardSubmit(){
  if(_projectWizard.saving)return;
  _projectWizard.saving=true;renderCenter();
  var d=_projectWizard.data;
  fetch(_backendBase+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:d.name.trim(),path:d.path.trim(),description:d.description.trim(),type:d.type,status:'Active'}),signal:AbortSignal.timeout(8000)})
  .then(function(r){return r.json();})
  .then(function(created){
    _projectWizard.active=false;_projectWizard.saving=false;
    if(window._c3)window._c3.agentLog('TOOL','✨ Projekt vytvořen: '+d.name);
    /* Link to session + open working tree */
    var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
    if(created.id){_sessions[_ti]._projectId=created.id;_persistSessionState();}
    if(d.path){_wtRoot=d.path;_loadWorkspaceTree(d.path);}
    /* Switch to lifecycle SPEC phase → send to chat */
    var s=_sessions[_ti];
    s.chat.msgs.push({role:'system',text:'📁 Projekt **'+d.name+'** vytvořen. Fáze: SPEC'});
    s.chat.msgs.push({role:'system',text:'Popište specifikaci projektu v chatu. Agent ji zpracuje a posune do fáze PLANNING.'});
    renderChat();_chatScrollPane(_ti);
    fetchBackendData();renderCenter();
  }).catch(function(){
    _projectWizard.saving=false;
    if(window._c3)window._c3.agentLog('TOOL','📁 Projekt vytvořen lokálně: '+d.name);
    _projectWizard.active=false;fetchBackendData();renderCenter();
  });
}
function centerProjectWizard(){
  var w=_projectWizard,step=w.step,d=w.data;
  var stepStyle={background:C.bg2,borderRadius:12,padding:24,maxWidth:520,margin:'0 auto',width:'100%'};
  var labelStyle={fontSize:11,color:C.tx3,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6};
  var inputStyle={width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:13,outline:'none',boxSizing:'border-box'};
  var content;
  if(step===0){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Název projektu'),
      h('input',{autoFocus:true,style:inputStyle,value:d.name,placeholder:'Můj nový projekt',
        onChange:function(e){d.name=e.target.value;renderCenter();},
        onKeyDown:function(e){if(e.key==='Enter'&&_wizardCanNext()){w.step=1;renderCenter();}}}));
  }else if(step===1){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Typ projektu'),
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}},
        PROJECT_TYPES.map(function(pt){
          var sel=d.type===pt.id;
          return h('div',{key:pt.id,onClick:function(){d.type=pt.id;renderCenter();},
            style:{padding:14,borderRadius:10,border:'1px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',transition:'border 0.15s'}},
            h('div',{style:{fontSize:18,marginBottom:4}},pt.icon),
            h('div',{style:{fontSize:12.5,fontWeight:700,color:sel?C.accentText:C.tx1}},pt.label),
            h('div',{style:{fontSize:10.5,color:C.tx3,marginTop:2}},pt.desc));})));
  }else if(step===2){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Cesta na disku'),
      h('input',{autoFocus:true,style:inputStyle,value:d.path,placeholder:'/home/user/projects/my-project',
        onChange:function(e){d.path=e.target.value;renderCenter();},
        onKeyDown:function(e){if(e.key==='Enter'&&_wizardCanNext()){w.step=3;renderCenter();}}}),
      h('div',{style:{fontSize:10,color:C.tx4,marginTop:6}},'Složka bude vytvořena pokud neexistuje'));
  }else if(step===3){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Popis projektu (volitelné)'),
      h('textarea',{autoFocus:true,style:Object.assign({},inputStyle,{minHeight:80,resize:'vertical',fontFamily:C.font}),value:d.description,placeholder:'Popište cíl a scope projektu...',
        onChange:function(e){d.description=e.target.value;renderCenter();}}));
  }else if(step===4){
    var pt=PROJECT_TYPES.find(function(t){return t.id===d.type;})||PROJECT_TYPES[0];
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Souhrn'),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10,marginTop:8}},
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:12}},h('span',{style:{color:C.tx3}},'Název'),h('span',{style:{color:C.tx1,fontWeight:600}},d.name)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:12}},h('span',{style:{color:C.tx3}},'Typ'),h('span',{style:{color:C.tx1}},pt.icon+' '+pt.label)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:12}},h('span',{style:{color:C.tx3}},'Cesta'),h('span',{style:{color:C.tx2,fontFamily:C.mono,fontSize:11}},d.path)),
        d.description?h('div',{style:{fontSize:11,color:C.tx2,marginTop:4,padding:8,background:C.bg3,borderRadius:6,whiteSpace:'pre-wrap'}},d.description):null),
      h('div',{style:{marginTop:16,padding:10,background:C.accentBg,borderRadius:8,border:'1px solid '+C.accent+'33'}},
        h('div',{style:{fontSize:11,color:C.accentText,fontWeight:600}},'Lifecycle: PROPOSED → SPEC'),
        h('div',{style:{fontSize:10,color:C.tx3,marginTop:4}},'Po vytvoření bude projekt ve fázi SPEC. Popište specifikaci v chatu.')));
  }
  return h(React.Fragment,null,
    /* Header */
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:10,flexShrink:0}},
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:4,borderRadius:4,display:'flex'},
        onClick:function(){_projectWizard.active=false;renderCenter();}},svgEl(I.close,16)),
      h('span',{style:{fontSize:14,fontWeight:700,color:C.tx1}},'Nový projekt'),
      h('div',{style:{flex:1}}),
      h('span',{style:{fontSize:10,color:C.tx4,fontFamily:C.mono}},'Krok '+(step+1)+'/'+WIZARD_STEPS.length)),
    /* Step indicators */
    h('div',{style:{display:'flex',gap:2,padding:'8px 18px',flexShrink:0}},
      WIZARD_STEPS.map(function(ws,i){
        var done=i<step,cur=i===step;
        return h('div',{key:ws.id,style:{flex:1,height:3,borderRadius:2,background:done?C.accent:cur?C.accentText:C.bg4,transition:'background 0.2s'}});})),
    /* Step content */
    h('div',{style:{flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start'}},
      h('div',{style:{fontSize:28,marginBottom:8}},WIZARD_STEPS[step].icon),
      h('div',{style:{fontSize:16,fontWeight:700,color:C.tx1,marginBottom:4}},WIZARD_STEPS[step].desc),
      h('div',{style:{width:'100%',maxWidth:520,marginTop:16}},content)),
    /* Navigation */
    h('div',{style:{padding:'12px 18px',borderTop:'1px solid '+C.border,display:'flex',gap:8,justifyContent:'flex-end',flexShrink:0}},
      step>0?h('button',{style:{padding:'7px 16px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontFamily:C.font,fontSize:12,cursor:'pointer'},
        onClick:function(){w.step=Math.max(0,step-1);renderCenter();}},'Zpět'):null,
      step<4?h('button',{disabled:!_wizardCanNext(),style:{padding:'7px 20px',borderRadius:6,border:'none',background:_wizardCanNext()?C.accent:C.bg4,color:_wizardCanNext()?'#fff':C.tx4,fontFamily:C.font,fontSize:12,fontWeight:600,cursor:_wizardCanNext()?'pointer':'default',opacity:_wizardCanNext()?1:0.5},
        onClick:function(){if(_wizardCanNext()){w.step=step+1;renderCenter();}}},'Další'):
      h('button',{disabled:w.saving,style:{padding:'7px 24px',borderRadius:6,border:'none',background:w.saving?C.bg4:C.accent,color:'#fff',fontFamily:C.font,fontSize:12,fontWeight:600,cursor:w.saving?'default':'pointer'},
        onClick:_wizardSubmit},w.saving?'Vytvářím...':'Vytvořit projekt')));
}

/* Settings state */
var _settingsVals={theme:'dark',accentIdx:0,activeInt:100,passiveInt:50,fontSizeVal:13,fontIdx:0,custom1:null,custom2:null,bgIdx:0,bgCustom1:null,bgCustom2:null,customCSS:''};
/* I2: Custom CSS injection — scoped under .c3-root */
var _customStyleEl=null;
function _injectCustomCSS(css){
  if(!_customStyleEl){_customStyleEl=document.createElement('style');_customStyleEl.id='c3-custom-css';document.head.appendChild(_customStyleEl);}
  _customStyleEl.textContent='.c3-root {\n'+(css||'')+'\n}';
}
var _accentPalettes=[
  {accent:'#22c55e',text:'#4ade80',dim:'#16a34a'},
  {accent:'#3b82f6',text:'#60a5fa',dim:'#2563eb'},
  {accent:'#8b5cf6',text:'#a78bfa',dim:'#7c3aed'},
  {accent:'#ec4899',text:'#f472b6',dim:'#db2777'},
  {accent:'#f97316',text:'#fb923c',dim:'#ea580c'},
  {accent:'#ffffff',text:'#e4e4e7',dim:'#a1a1aa'},
  {accent:'#ef4444',text:'#f87171',dim:'#dc2626'},
  {accent:'#06b6d4',text:'#22d3ee',dim:'#0891b2'}];
var _themeOpts=[{id:'dark',label:'Tmavé',icon:'🌙'},{id:'light',label:'Světlé',icon:'☀️'},{id:'system',label:'Systém',icon:'🖥️'}];
var _fontFamilies=[
  {label:'Plus Jakarta Sans',val:"'Plus Jakarta Sans',-apple-system,sans-serif"},
  {label:'Inter',val:"'Inter',-apple-system,sans-serif"},
  {label:'Systémové',val:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}];
var _bgPresets=[
  {label:'Výchozí',bg:null},
  {label:'Antracit',bg:'#14141e'},
  {label:'Noční modř',bg:'#0c1525'},
  {label:'Custom',bg:null},
  {label:'Custom',bg:null}];
var _darkC={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',tx1:'#ececef',tx2:'#a1a1aa',border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)'};
var _lightC={bg0:'#f5f5f7',bg1:'#eaeaec',bg2:'#e0e0e3',bg3:'#d4d4d8',bg4:'#c8c8cc',bg5:'#bbbbc0',tx1:'#18181b',tx2:'#52525b',border:'rgba(0,0,0,0.08)',border2:'rgba(0,0,0,0.15)'};
try{var _sv=localStorage.getItem('c3-settings');if(_sv){var _p=JSON.parse(_sv);Object.assign(_settingsVals,_p);}}catch(e){}
function _saveSV(){try{localStorage.setItem('c3-settings',JSON.stringify(_settingsVals));}catch(e){}}
function _getPalette(){var idx=_settingsVals.accentIdx;if(idx>=100){var cc=idx===100?_settingsVals.custom1:_settingsVals.custom2;return cc?_mkPalette(cc):_accentPalettes[0];}return _accentPalettes[idx]||_accentPalettes[0];}
function _isLight(){var t=_settingsVals.theme;if(t==='light')return true;if(t==='system')try{return!window.matchMedia('(prefers-color-scheme:dark)').matches;}catch(e){return false;}return false;}
function _applyTheme(){
  var lt=_isLight();var tc=lt?_lightC:_darkC;
  var bi=_settingsVals.bgIdx||0;
  var baseBg;
  if(bi===3){baseBg=_settingsVals.bgCustom1||tc.bg0;}
  else if(bi===4){baseBg=_settingsVals.bgCustom2||tc.bg0;}
  else if(bi>0&&_bgPresets[bi]&&_bgPresets[bi].bg){baseBg=_bgPresets[bi].bg;}
  else{baseBg=tc.bg0;}
  C.bg0=baseBg;
  var bt=lt?'#000000':'#ffffff';
  C.bg1=_cl(baseBg,bt,0.04);C.bg2=_cl(baseBg,bt,0.08);C.bg3=_cl(baseBg,bt,0.13);C.bg4=_cl(baseBg,bt,0.18);C.bg5=_cl(baseBg,bt,0.24);
  C.tx1=tc.tx1;C.tx2=tc.tx2;C.border=tc.border;C.border2=tc.border2;
  var d=document.documentElement.style;
  d.setProperty('--c3-bg0',C.bg0);d.setProperty('--c3-bg1',C.bg1);d.setProperty('--c3-bg2',C.bg2);
  d.setProperty('--c3-bg3',C.bg3);d.setProperty('--c3-bg4',C.bg4);d.setProperty('--c3-bg5',C.bg5);
  d.setProperty('--c3-tx1',C.tx1);d.setProperty('--c3-tx2',C.tx2);
  d.setProperty('--c3-border',C.border);d.setProperty('--c3-border2',C.border2);
}
function _applyAccent(){
  var p=_getPalette();var ai=(_settingsVals.activeInt||100)/100;var pi=(_settingsVals.passiveInt!=null?_settingsVals.passiveInt:50)/100;
  C.accent=_cl(p.dim,p.accent,ai);C.accentText=_cl(p.dim,p.text,ai);
  var ac=_hp(p.accent);C.accentBg='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+(0.08*ai).toFixed(3)+')';
  /* Passive: lerp from grey toward accent text for stronger visibility */
  C.tx3=_cl('#71717a',p.text,pi*0.6);C.tx4=_cl('#52525b',p.accent,pi*0.4);
  var d=document.documentElement.style;
  d.setProperty('--c3-accent',C.accent);d.setProperty('--c3-accent-text',C.accentText);
  d.setProperty('--c3-accent-bg',C.accentBg);d.setProperty('--c3-accent-dim',p.dim);
  d.setProperty('--c3-tx3',C.tx3);d.setProperty('--c3-tx4',C.tx4);
}
function _applyFont(){
  var fs=_settingsVals.fontSizeVal||13;
  var ff=_fontFamilies[_settingsVals.fontIdx]||_fontFamilies[0];
  C.font=ff.val;
  document.documentElement.style.setProperty('--c3-font-size',fs+'px');
  document.documentElement.style.setProperty('--c3-font-family',ff.val);
  document.documentElement.style.setProperty('--c3-mono',C.mono);
  document.body.style.fontSize=fs+'px';document.body.style.fontFamily=ff.val;
  ['c3-center-mount','c3-sidebar','c3-chat-panel','c3-agent-panel'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.style.zoom='';el.style.fontFamily=ff.val;}});
}
function _applyAllSettings(){_applyTheme();_applyAccent();_applyFont();_injectCustomCSS(_settingsVals.customCSS);renderCenter();renderChat();renderAgent();if(typeof renderSidebar==='function')renderSidebar();}
/* Apply saved settings on load */
_applyTheme();_applyAccent();setTimeout(function(){_applyFont();_injectCustomCSS(_settingsVals.customCSS);_applyAllSettings();},600);

function centerSettings(){
  var selSi=_centerState.settingsSection;
  var selSec=selSi!=null?SETTINGS_SECTIONS[selSi]:null;
  return h(React.Fragment,null,viewHead('Nastavení',true),
    h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
      h('div',{style:{flex:1,overflowY:'auto',padding:18}},
        grid(SETTINGS_SECTIONS.map(function(sec,si){
          var isSel=selSi===si;
          return h('div',{key:si,onClick:function(){_centerState.settingsSection=si;_centerState.detail=null;renderCenter();},
            style:{background:C.bg2,border:'1px solid '+(isSel?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer',transition:'border-color 0.15s',position:'relative',overflow:'hidden'},
            onMouseEnter:function(e){if(!isSel)e.currentTarget.style.borderColor=C.border2;},onMouseLeave:function(e){if(!isSel)e.currentTarget.style.borderColor=C.border;}},
            h('div',{style:{position:'absolute',top:0,left:0,right:0,height:3,background:isSel?C.accent:'transparent'}}),
            h('div',{style:{fontSize:24,marginBottom:8}},sec.icon),
            h('div',{style:{fontSize:13,fontWeight:700,color:C.tx1,marginBottom:2}},sec.title),
            h('div',{style:{fontSize:11,color:C.tx3}},sec.title==='About'?'C3 Studio v0.1.0':sec.fields.length+' nastavení'));
        }))),
      selSec?settingsDetailPanel(selSec,selSi):null));
}

function settingsDetailPanel(sec,si){
  return h('div',{style:{width:280,background:C.bg1,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}},
    h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},
      h('span',{style:{fontSize:16}},sec.icon),
      h('span',{style:{fontSize:13.5,fontWeight:700,flex:1,color:C.tx1}},sec.title),
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:2,borderRadius:4,display:'flex'},
        onClick:function(){_centerState.settingsSection=null;renderCenter();}},svgEl(I.close,15))),
    h('div',{style:{flex:1,overflowY:'auto',padding:'12px 14px'}},
      sec.title==='About'?h('div',{style:{textAlign:'center',padding:'20px 0'}},
        h('div',{style:{width:48,height:48,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:14,display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:20,color:'#fff',marginBottom:8}},'C3'),
        h('div',{style:{fontSize:14,fontWeight:700,color:C.tx1,marginBottom:2}},'C3 Studio'),
        h('div',{style:{fontSize:11,color:C.tx3,marginBottom:12}},'v0.1.0'),
        h('div',{style:{fontSize:11,color:C.tx4}},'Made with ❤️ by Belfik')):
      sec.title==='Appearance'?settingsAppearance():
      sec.fields.map(function(f,fi){
        return h('div',{key:fi,style:{marginBottom:12}},
          h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},f.l),
          f.t==='input'?h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',boxSizing:'border-box'},defaultValue:f.v}):
          f.t==='textarea'?h('textarea',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',resize:'vertical',lineHeight:'1.5',minHeight:60,boxSizing:'border-box'},defaultValue:f.v}):
          f.t==='select'?h('select',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',boxSizing:'border-box'},defaultValue:f.v},(f.opts||[]).map(function(o){return h('option',{key:o},o);})):
          f.t==='toggle'?h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}},
            h('span',{style:{fontSize:12,color:C.tx2}},f.l),
            togSw(!!f.v,function(v){f.v=v;renderCenter();})):
          f.t==='radio'?h('div',{style:{display:'flex',gap:6}},(f.opts||[]).map(function(o){
            var sel=f.v===o.toLowerCase()||f.v===o;
            return h('div',{key:o,onClick:function(){f.v=o.toLowerCase();renderCenter();},
              style:{flex:1,padding:'8px 6px',borderRadius:8,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',textAlign:'center'}},
              h('div',{style:{fontSize:11,color:sel?C.accentText:C.tx2,fontWeight:sel?700:400}},o));})):
          null);
      })));
}

function settingsAppearance(){
  var sv=_settingsVals;
  function _sl(val,min,max,step,onChange,unit){
    return h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('input',{type:'range',min:min,max:max,step:step,value:val,onChange:function(e){onChange(parseFloat(e.target.value));},
        style:{flex:1,cursor:'pointer'}}),
      h('span',{style:{fontSize:11,color:C.tx3,minWidth:36,textAlign:'right',fontFamily:C.mono}},val+unit));
  }
  function _cpDot(bg,sel,onClick,key){
    return h('div',{key:key,onClick:onClick,
      style:{width:24,height:24,borderRadius:'50%',background:bg,cursor:'pointer',border:sel?'3px solid '+C.tx1:'3px solid transparent',boxSizing:'border-box',boxShadow:bg==='#ffffff'?'inset 0 0 0 1px rgba(0,0,0,0.15)':'none'}});
  }
  function _cpCustom(id,val,sel,onChange){
    return h('div',{key:id,style:{position:'relative'}},
      h('div',{onClick:function(){document.getElementById(id).click();},
        style:{width:24,height:24,borderRadius:'50%',background:val||'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)',cursor:'pointer',border:sel?'3px solid '+C.tx1:'3px solid transparent',boxSizing:'border-box'}},
        val?null:h('span',{style:{fontSize:9,color:'#fff',textShadow:'0 0 2px #000',display:'flex',width:'100%',height:'100%',alignItems:'center',justifyContent:'center'}},'+')),
      h('input',{id:id,type:'color',value:val||'#ff6b6b',style:{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'},onChange:function(e){onChange(e.target.value);}}));
  }
  return h('div',null,
    /* Theme */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},'Téma'),
    h('div',{style:{display:'flex',gap:6,marginBottom:16}},_themeOpts.map(function(t){
      var sel=sv.theme===t.id;
      return h('div',{key:t.id,onClick:function(){sv.theme=t.id;_saveSV();_applyAllSettings();},
        style:{flex:1,padding:'10px 6px',borderRadius:8,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',textAlign:'center'}},
        h('div',{style:{fontSize:18,marginBottom:4}},t.icon),
        h('div',{style:{fontSize:11,color:sel?C.accentText:C.tx2,fontWeight:sel?700:400}},t.label));})),
    /* Accent */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},'Accent'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
      _accentPalettes.map(function(p,i){return _cpDot(p.accent,sv.accentIdx===i,function(){sv.accentIdx=i;_saveSV();_applyAllSettings();},i);}),
      _cpCustom('c3-cp1',sv.custom1,sv.accentIdx===100,function(v){sv.custom1=v;sv.accentIdx=100;_saveSV();_applyAllSettings();}),
      _cpCustom('c3-cp2',sv.custom2,sv.accentIdx===101,function(v){sv.custom2=v;sv.accentIdx=101;_saveSV();_applyAllSettings();})),
    /* Background */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},'Pozadí'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
      _bgPresets.slice(0,3).map(function(bp,i){return _cpDot(bp.bg,sv.bgIdx===i,function(){sv.bgIdx=i;_saveSV();_applyAllSettings();},('bg'+i));}),
      _cpCustom('c3-bgc1',sv.bgCustom1,sv.bgIdx===3,function(v){sv.bgCustom1=v;sv.bgIdx=3;_saveSV();_applyAllSettings();}),
      _cpCustom('c3-bgc2',sv.bgCustom2,sv.bgIdx===4,function(v){sv.bgCustom2=v;sv.bgIdx=4;_saveSV();_applyAllSettings();})),
    /* Intensity sliders */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:8}},'Intenzita podsvícení'),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:10,color:C.tx3}},'Aktivní prvky')),
    h('div',{style:{marginBottom:10}},_sl(sv.activeInt,10,100,5,function(v){sv.activeInt=v;_saveSV();_applyAllSettings();},'%')),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:10,color:C.tx3}},'Neaktivní prvky')),
    h('div',{style:{marginBottom:16}},_sl(sv.passiveInt,0,100,5,function(v){sv.passiveInt=v;_saveSV();_applyAllSettings();},'%')),
    /* Font size slider */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},'Velikost písma'),
    h('div',{style:{marginBottom:16}},_sl(sv.fontSizeVal,10,18,1,function(v){sv.fontSizeVal=v;_saveSV();_applyAllSettings();},'px')),
    /* Font family */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6}},'Písmo'),
    h('div',{style:{display:'flex',flexDirection:'column',gap:4}},_fontFamilies.map(function(ff,i){
      var sel=sv.fontIdx===i;
      return h('div',{key:i,onClick:function(){sv.fontIdx=i;_saveSV();_applyAllSettings();},
        style:{padding:'8px 10px',borderRadius:8,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',display:'flex',alignItems:'center',gap:8}},
        h('div',{style:{width:16,height:16,borderRadius:'50%',border:'2px solid '+(sel?C.accent:C.border2),background:sel?C.accent:'transparent',flexShrink:0}}),
        h('span',{style:{fontSize:12,fontFamily:ff.val,color:sel?C.accentText:C.tx2}},ff.label));})),
    /* I2: Custom CSS */
    h('div',{style:{fontSize:11,fontWeight:600,color:C.tx2,marginBottom:6,marginTop:16}},'Vlastní CSS'),
    h('div',{style:{fontSize:10,color:C.tx4,marginBottom:6}},'Scope: .c3-root — globální selektory nejsou podporované'),
    h('textarea',{value:sv.customCSS||'',
      onChange:function(e){sv.customCSS=e.target.value;_injectCustomCSS(e.target.value);_saveSV();},
      style:{width:'100%',height:80,fontFamily:C.mono,fontSize:11,background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',outline:'none',resize:'vertical',lineHeight:'1.4',boxSizing:'border-box'},
      placeholder:'.c3-card { border-radius: 12px; }'}));
}

function centerWelcome(){return h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}},h('div',{style:{width:48,height:48,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:20,color:'#fff'}},'C3'),h('div',{style:{fontSize:16,fontWeight:700,color:C.tx1}},'C3 Studio'),h('div',{style:{fontSize:12,color:C.tx3}},'Vyber sekci v levém panelu'));}

/* ═══════════════════════════════════════════════════════════
   I3: KEYBOARD SHORTCUTS — scoped, no collisions
   ═══════════════════════════════════════════════════════════ */

function _isC3Focused(){
  var el=document.activeElement;
  while(el){
    if(el.classList&&(el.classList.contains('c3-chat-widget')||
      el.classList.contains('c3-center-widget')||
      el.classList.contains('c3-agent-widget')||
      el.id==='c3-center-mount'||el.id==='c3-chat-panel'||
      el.id==='c3-agent-panel'||el.id==='c3-sidebar'))return true;
    el=el.parentElement;
  }
  return false;
}

document.addEventListener('keydown',function(e){
  if(!_isC3Focused())return;

  var key='';
  if(e.ctrlKey||e.metaKey)key+='Ctrl+';
  if(e.shiftKey)key+='Shift+';
  if(e.altKey)key+='Alt+';
  key+=e.key;

  switch(key){
    case 'Ctrl+Shift+L':
      /* Toggle bottom pane: agent ↔ split */
      e.preventDefault();e.stopPropagation();
      var cs=_sessions[_sessionActive];
      if(cs){cs.bottom=cs.bottom==='agent'?'split':'agent';renderChat();renderAgent();}
      break;
    case 'Ctrl+Shift+E':
      /* Toggle edit mode auto ↔ ask */
      e.preventDefault();e.stopPropagation();
      var es=_sessions[_sessionActive];
      if(es){es.chat.editMode=es.chat.editMode==='ask'?'auto':'ask';renderChat();}
      break;
    case 'Escape':
      /* Cancel execution or clear autocomplete */
      if(_sessions[_sessionActive]&&_sessions[_sessionActive].chat.acSuggestion){
        _sessions[_sessionActive].chat.acSuggestion=null;renderChat();
        e.preventDefault();
      }else if(typeof C3WS!=='undefined'&&C3WS.isReady()){
        C3WS.sendCancel();e.preventDefault();
      }
      break;
    /* Excluded: Ctrl+W (close window), Ctrl+T (new tab), Ctrl+S (Theia save) */
  }
});

/* ═══════════════════════════════════════════════════════════
   EDITOR / DIFF TAB SYSTEM (Fáze 5 — Blok E)
   ═══════════════════════════════════════════════════════════ */

function _buildFilePath(f){
  return f.fp||f.n;
}

function _openFileTab(path){
  var existing=_editorState.tabs.find(function(t){return t.path===path&&t.type==='file';});
  if(existing){_setActiveTab(existing.id);return;}
  fetch(_backendBase+'/api/workspace/file?path='+encodeURIComponent(path),{signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error)return;
    var tab={id:'file-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),type:'file',path:path,
      label:path.split('/').pop(),content:data.content||'',hash:data.hash||null,
      dirty:false,scrollTop:0,deleted:false,externalChange:false};
    _editorState.tabs.push(tab);
    _editorState.activeTabId=tab.id;
    _editorState.active=true;
    renderCenter();_persistEditorState();
  }).catch(function(){});
}

function _closeTab(tabId){
  var tab=_editorState.tabs.find(function(t){return t.id===tabId;});
  if(!tab)return;
  if(tab.dirty&&!confirm('Neuložené změny v '+tab.label+'. Zavřít?'))return;
  var idx=_editorState.tabs.indexOf(tab);
  _editorState.tabs.splice(idx,1);
  if(_editorState.activeTabId===tabId){
    if(_editorState.tabs.length>0){
      _editorState.activeTabId=_editorState.tabs[Math.min(idx,_editorState.tabs.length-1)].id;
    }else{_editorState.activeTabId=null;_editorState.active=false;}
  }
  renderCenter();_persistEditorState();
}

function _setActiveTab(tabId){
  var cur=_editorState.tabs.find(function(t){return t.id===_editorState.activeTabId;});
  if(cur){var el=document.getElementById('c3-editor-scroll');if(el)cur.scrollTop=el.scrollTop;}
  _editorState.activeTabId=tabId;_editorState.active=true;
  renderCenter();
  var nxt=_editorState.tabs.find(function(t){return t.id===tabId;});
  if(nxt&&nxt.scrollTop){setTimeout(function(){var el=document.getElementById('c3-editor-scroll');if(el)el.scrollTop=nxt.scrollTop;},50);}
}

function _backToGrid(){_editorState.active=false;renderCenter();}

function _persistEditorState(){
  try{localStorage.setItem('c3-editor-state',JSON.stringify({
    openFiles:_editorState.tabs.filter(function(t){return t.type==='file';}).map(function(t){return{path:t.path};}),
    activeTab:_editorState.activeTabId
  }));}catch(e){}
}

function _refreshFileTab(tab){
  fetch(_backendBase+'/api/workspace/file?path='+encodeURIComponent(tab.path),{signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error)return;
    if(data.hash&&data.hash===tab.hash)return;
    tab.content=data.content||'';tab.hash=data.hash||null;
    tab.dirty=false;tab.externalChange=false;
    renderCenter();
  }).catch(function(){});
}

/* ── Syntax highlighting (regex colorizer) ── */
function _highlightLine(line){
  if(!line)return '';
  var parts=[],last=0,m;
  var re=/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\/\/.*/g;
  while((m=re.exec(line))!==null){
    if(m.index>last)parts.push({t:'c',v:line.substring(last,m.index)});
    parts.push({t:m[0].charAt(0)==='/'?'cm':'st',v:m[0]});
    last=re.lastIndex;
  }
  if(last<line.length)parts.push({t:'c',v:line.substring(last)});
  if(parts.length===0)return line;
  var kw=/\b(function|const|var|let|import|export|if|else|return|class|async|await|for|while|new|this|try|catch|finally|throw|typeof|switch|case|break|default|null|undefined|true|false)\b/g;
  return parts.map(function(p,i){
    if(p.t==='st')return h('span',{key:i,style:{color:'#ce9178'}},p.v);
    if(p.t==='cm')return h('span',{key:i,style:{color:'#6a9955'}},p.v);
    var segs=[],l2=0,m2;kw.lastIndex=0;
    while((m2=kw.exec(p.v))!==null){
      if(m2.index>l2)segs.push(p.v.substring(l2,m2.index));
      segs.push(h('span',{key:'k'+segs.length,style:{color:'#569cd6'}},m2[0]));
      l2=m2.index+m2[0].length;
    }
    if(l2<p.v.length)segs.push(p.v.substring(l2));
    return segs.length>1?h('span',{key:i},segs):(segs[0]||'');
  });
}

/* ── Diff algorithm (LCS with prefix/suffix skip) ── */
function computeLineDiff(oldText,newText){
  var oL=(oldText||'').split('\n'),nL=(newText||'').split('\n');
  var pL=0;while(pL<oL.length&&pL<nL.length&&oL[pL]===nL[pL])pL++;
  var sL=0;while(sL<oL.length-pL&&sL<nL.length-pL&&oL[oL.length-1-sL]===nL[nL.length-1-sL])sL++;
  var oM=oL.slice(pL,oL.length-sL),nM=nL.slice(pL,nL.length-sL);
  var m=oM.length,n=nM.length;
  /* OOM guard: if middle section too large, skip LCS */
  if(m*n>4000000){
    var simple=[];
    for(var i=0;i<pL;i++)simple.push({type:'same',text:oL[i],oldNo:i+1,newNo:i+1});
    oM.forEach(function(l,i){simple.push({type:'remove',text:l,oldNo:pL+i+1,newNo:null});});
    nM.forEach(function(l,i){simple.push({type:'add',text:l,oldNo:null,newNo:pL+i+1});});
    for(var i=0;i<sL;i++)simple.push({type:'same',text:oL[oL.length-sL+i],oldNo:oL.length-sL+i+1,newNo:nL.length-sL+i+1});
    return _groupHunks(simple);
  }
  var dp=[];
  for(var i=0;i<=m;i++){dp[i]=new Array(n+1);dp[i][0]=0;}
  for(var j=0;j<=n;j++)dp[0][j]=0;
  for(var i=1;i<=m;i++)for(var j=1;j<=n;j++){
    dp[i][j]=oM[i-1]===nM[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);
  }
  var result=[],ci=m,cj=n;
  while(ci>0||cj>0){
    if(ci>0&&cj>0&&oM[ci-1]===nM[cj-1]){result.unshift({type:'same',text:oM[ci-1],oldNo:pL+ci,newNo:pL+cj});ci--;cj--;}
    else if(cj>0&&(ci===0||dp[ci][cj-1]>=dp[ci-1][cj])){result.unshift({type:'add',text:nM[cj-1],oldNo:null,newNo:pL+cj});cj--;}
    else{result.unshift({type:'remove',text:oM[ci-1],oldNo:pL+ci,newNo:null});ci--;}
  }
  var all=[];
  for(var i=0;i<pL;i++)all.push({type:'same',text:oL[i],oldNo:i+1,newNo:i+1});
  all=all.concat(result);
  for(var i=0;i<sL;i++){var oi=oL.length-sL+i,ni=nL.length-sL+i;all.push({type:'same',text:oL[oi],oldNo:oi+1,newNo:ni+1});}
  return _groupHunks(all);
}

function _groupHunks(allLines){
  var ci=[];allLines.forEach(function(l,i){if(l.type!=='same')ci.push(i);});
  if(ci.length===0)return[{startOld:1,startNew:1,oldCount:allLines.length,newCount:allLines.length,lines:allLines}];
  var CTX=3,groups=[],cur=[ci[0]];
  for(var i=1;i<ci.length;i++){
    if(ci[i]-ci[i-1]<=CTX*2)cur.push(ci[i]);
    else{groups.push(cur);cur=[ci[i]];}
  }
  groups.push(cur);
  return groups.map(function(g){
    var s=Math.max(0,g[0]-CTX),e=Math.min(allLines.length-1,g[g.length-1]+CTX);
    var lines=allLines.slice(s,e+1),f=lines[0];
    return{startOld:f.oldNo||1,startNew:f.newNo||1,
      oldCount:lines.filter(function(l){return l.type!=='add';}).length,
      newCount:lines.filter(function(l){return l.type!=='remove';}).length,
      lines:lines};
  });
}

/* ── Editor renderer ── */
function centerEditor(){
  var tabs=_editorState.tabs;
  var at=tabs.find(function(t){return t.id===_editorState.activeTabId;});
  return h(React.Fragment,null,
    /* Tab bar */
    h('div',{style:{display:'flex',alignItems:'center',height:32,borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2,overflow:'hidden'}},
      /* Back button */
      h('div',{style:{padding:'0 10px',height:'100%',display:'flex',alignItems:'center',cursor:'pointer',color:C.tx4,fontSize:12,flexShrink:0,borderRight:'1px solid '+C.border,gap:4},
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:_backToGrid},svgEl('<polyline points="15 18 9 12 15 6"/>',14),'Grid'),
      /* Tabs */
      h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
        tabs.map(function(tab){
          var isA=tab.id===_editorState.activeTabId;
          return h('div',{key:tab.id,style:{display:'flex',alignItems:'center',gap:4,padding:'0 10px',height:32,cursor:'pointer',borderRight:'1px solid '+C.border,background:isA?C.bg1:'transparent',color:isA?C.tx1:C.tx3,fontSize:11.5,fontWeight:isA?600:400,maxWidth:160,flexShrink:0},
            onClick:function(){_setActiveTab(tab.id);}},
            tab.type==='diff'?h('span',{style:{color:C.amber,fontSize:10}},'~'):h('span',{style:{fontSize:10}},'📄'),
            h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}},tab.label+(tab.dirty?' •':'')),
            h('span',{style:{fontSize:14,color:C.tx4,padding:'0 2px',flexShrink:0,lineHeight:'1'},
              onMouseEnter:function(e){e.currentTarget.style.color=C.tx1;},onMouseLeave:function(e){e.currentTarget.style.color=C.tx4;},
              onClick:function(e){e.stopPropagation();_closeTab(tab.id);}},'×'));
        })),
      h('div',{style:{flex:1}})),
    /* Content */
    h('div',{style:{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}},
      at?(
        at.deleted?h('div',{style:{padding:20,textAlign:'center'}},
          h('div',{style:{background:C.redBg,color:C.red,padding:'8px 12px',borderRadius:6,fontSize:12,display:'inline-block'}},'Soubor byl smazán.'),
          h('button',{style:{marginTop:8,padding:'4px 12px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,cursor:'pointer',fontSize:11},onClick:function(){_closeTab(at.id);}},'Zavřít tab')):
        at.type==='file'?_renderFileContent(at):
        at.type==='diff'?_renderDiffContent(at):
        h('div',{style:{padding:20,color:C.tx4,fontSize:12}},'Neznámý typ tabu')
      ):h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:C.tx4,fontSize:12}},'Dvojklik na soubor ve Working Tree pro otevření')));
}

function _renderFileContent(tab){
  var lines=(tab.content||'').split('\n');
  return h(React.Fragment,null,
    /* External change banner */
    tab.externalChange?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:C.amberBg,borderBottom:'1px solid '+C.border,fontSize:11,flexShrink:0}},
      h('span',{style:{color:C.amber,flex:1}},'Soubor byl změněn externě.'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.amber,background:'transparent',color:C.amber,cursor:'pointer',fontSize:10},
        onClick:function(){_refreshFileTab(tab);}},'Načíst z disku'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border2,background:'transparent',color:C.tx3,cursor:'pointer',fontSize:10},
        onClick:function(){tab.externalChange=false;renderCenter();}},'Ignorovat')):null,
    /* Code view */
    h('div',{id:'c3-editor-scroll',style:{flex:1,overflow:'auto',background:C.bg0},
      onScroll:function(e){tab.scrollTop=e.target.scrollTop;}},
      h('table',{style:{borderCollapse:'collapse',width:'100%',fontFamily:C.mono,fontSize:12,lineHeight:'1.6'}},
        h('tbody',null,lines.map(function(line,i){
          return h('tr',{key:i},
            h('td',{style:{color:C.tx4,textAlign:'right',paddingRight:12,paddingLeft:8,userSelect:'none',width:48,verticalAlign:'top',fontSize:11,opacity:0.6}},i+1),
            h('td',{style:{whiteSpace:'pre',color:C.tx1,paddingRight:16}},_highlightLine(line)));
        })))));
}

function _renderDiffContent(tab){
  if(tab.tooLarge){
    return h('div',{style:{padding:24,textAlign:'center'}},
      h('div',{style:{fontSize:13,color:C.tx2,marginBottom:12}},'Soubor příliš velký pro inline diff.'),
      h('div',{style:{display:'flex',gap:8,justifyContent:'center'}},
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600},onClick:function(){_approveAll(tab.reqId);}},'Schválit bez review'),
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:12},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')));
  }
  if(!tab.diffData||!tab.diffData.hunks)return h('div',{style:{padding:20,color:C.tx4}},'Žádný diff k zobrazení');
  var hunks=tab.diffData.hunks;
  var totalLines=hunks.reduce(function(s,hk){return s+hk.lines.length;},0);
  return h('div',{style:{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}},
    h('div',{id:'c3-editor-scroll',style:{flex:1,overflow:'auto',background:C.bg0},
      onScroll:function(e){
        tab.scrollTop=e.target.scrollTop;
        if(totalLines>200&&!_editorState.scrollRaf){
          _editorState.scrollRaf=requestAnimationFrame(function(){_editorState.scrollRaf=null;renderCenter();});
        }
      }},
      hunks.map(function(hunk,hi){
        return h('div',{key:hi,style:{marginBottom:8}},
          h('div',{style:{padding:'4px 12px',background:C.bg3,color:C.tx4,fontFamily:C.mono,fontSize:10.5,borderBottom:'1px solid '+C.border}},
            '@@ -'+hunk.startOld+','+hunk.oldCount+' +'+hunk.startNew+','+hunk.newCount+' @@'),
          hunk.lines.map(function(line,li){
            var bg=line.type==='add'?'rgba(34,197,94,0.08)':line.type==='remove'?'rgba(239,68,68,0.08)':'transparent';
            var sign=line.type==='add'?'+':line.type==='remove'?'-':' ';
            var sc=line.type==='add'?C.accentText:line.type==='remove'?C.red:C.tx4;
            return h('div',{key:li,style:{display:'flex',fontFamily:C.mono,fontSize:12,lineHeight:'1.6',background:bg}},
              h('span',{style:{color:C.tx4,width:40,textAlign:'right',paddingRight:4,flexShrink:0,fontSize:11,opacity:0.5,userSelect:'none'}},line.oldNo||''),
              h('span',{style:{color:C.tx4,width:40,textAlign:'right',paddingRight:8,flexShrink:0,fontSize:11,opacity:0.5,userSelect:'none'}},line.newNo||''),
              h('span',{style:{color:sc,width:16,textAlign:'center',flexShrink:0,fontWeight:600}},sign),
              h('pre',{style:{margin:0,color:C.tx1,whiteSpace:'pre',flex:1}},_highlightLine(line.text)));
          }));
      })),
    /* Bottom toolbar — approve/reject */
    tab.reqId?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderTop:'1px solid '+C.border,background:C.bg2,flexShrink:0}},
      h('span',{style:{fontSize:10,color:C.tx4,flex:1}},'Schválení se vztahuje na celý soubor: '+(tab.path||'')),
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600},onClick:function(){_approveAll(tab.reqId);}},'Schválit'),
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:12,fontWeight:600},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')):null);
}

function _approveAll(reqId){
  if(!reqId)return;
  if(typeof C3WS!=='undefined')C3WS.approveEdit(reqId);
  var tab=_editorState.tabs.find(function(t){return t.reqId===reqId;});
  if(tab)_closeTab(tab.id);
}

function _rejectAll(reqId){
  if(!reqId)return;
  if(typeof C3WS!=='undefined')C3WS.rejectEdit(reqId);
  var tab=_editorState.tabs.find(function(t){return t.reqId===reqId;});
  if(tab)_closeTab(tab.id);
}

function centerDetail(){var d=_centerState.detail;return h('div',{style:{width:280,background:C.bg1,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}},h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},h('span',{style:{fontSize:13.5,fontWeight:700,flex:1,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},d.name),h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:2,borderRadius:4,display:'flex'},onClick:function(){_centerState.detail=null;renderCenter();}},svgEl(I.close,15))),h('div',{style:{flex:1,overflowY:'auto',padding:'12px 14px'}},(d.fields||[]).map(function(f,i){return h('div',{key:i,style:{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:12,borderBottom:'1px solid '+C.border}},h('span',{style:{color:C.tx3}},f.k),f.type==='fav'?h('span',{style:{fontSize:16,cursor:'pointer',color:f.v?C.accentText:C.tx4,userSelect:'none'},onClick:function(ev){ev.stopPropagation();f.v=!f.v;var ex=EXPERTS.find(function(e){return e.name===f._expertName;});if(ex){ex.fav=f.v;if(ex.id){fetch(_backendBase+'/api/experts/'+ex.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:f.v}),signal:AbortSignal.timeout(3000)}).catch(function(){});}}renderCenter();}},f.v?'★':'☆'):d.editing?h('input',{defaultValue:_s(f.v),onChange:function(e){f.v=e.target.value;},style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'2px 6px',color:C.tx1,fontFamily:C.mono,fontSize:11,width:110,textAlign:'right',outline:'none',boxSizing:'border-box'}}):h('span',{style:{color:f.a?C.accentText:C.tx2,fontFamily:C.mono,fontSize:11}},_s(f.v)));}),d.tags?h('div',{style:{marginTop:12}},h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}},'TAGY'),h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},(d.tags||[]).map(function(t){return h('span',{key:_s(t),style:{padding:'2px 8px',borderRadius:10,background:C.bg4,fontSize:10,color:C.tx2}},_s(t));}))):null,/* Session picker for Otevřít */
_sessionCount>1?h('div',{style:{marginTop:12}},
  h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}},'OTEVŘÍT V RELACI'),
  h('div',{style:{display:'flex',gap:4}},Array.from({length:_sessionCount},function(_,si){
    var sel=(_centerState.targetSession||0)===si;
    return h('div',{key:si,style:{width:28,height:22,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,borderRadius:5,cursor:'pointer',border:'1px solid '+(sel?C.accent:C.border),color:sel?C.accentText:C.tx4,background:sel?C.accentBg:'transparent'},
      onClick:function(){_centerState.targetSession=si;renderCenter();}},si+1);
  }))):null,
d.actions?h('div',{style:{marginTop:12}},h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}},'AKCE'),h('div',{style:{display:'flex',gap:5,flexWrap:'wrap'}},(d.actions||[]).map(function(a,i){return h('button',{key:a,style:{padding:'5px 12px',borderRadius:6,border:i===0?'none':'1px solid '+C.border2,background:i===0?C.accent:C.bg3,color:i===0?'#fff':C.tx2,fontFamily:C.font,fontSize:11,cursor:'pointer'},
    onClick:function(){
      var c3=window._c3;if(!c3)return;
      var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
      _sessionActive=_ti;_ensureSessions();var _ts=_sessions[_ti];
      if(a==='Otevřít'){
        var exp=EXPERTS.find(function(e){return e.name===d.name;});
        if(exp){c3.setExpert(exp.name);c3.chatMsg('🎓 Expert změněn na: '+exp.name);}
        var conv=CONVERSATIONS.find(function(c){return c.title===d.name;});
        if(conv){c3.chatMsg('📂 Načítám konverzaci: '+conv.title+'...');c3.setExpert(conv.expert);
          if(conv.id){_ts._convId=conv.id;_persistSessionState();
            /* G1: Restore agentId from conversation metadata */
            fetch(_backendBase+'/api/conversations/'+conv.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(cd){
              var meta={};try{meta=JSON.parse(cd.metadata||'{}');}catch(ex){}
              if(meta.agentId){_ts._agentId=meta.agentId;_persistSessionState();renderChat();}
            }).catch(function(){});
            fetch(_backendBase+'/api/conversations/'+conv.id+'/messages',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(msgs){
            var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);if(items.length>0){_ts.chat.msgs=[{role:'system',text:'📂 Konverzace: '+conv.title}];items.forEach(function(m){var meta=null;try{meta=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(meta&&meta.mode)||undefined});});renderChat();_chatScrollPane(_ti);}}).catch(function(){});}
        }
        var proj=PROJECTS.find(function(p){return p.name===d.name;});
        if(proj){c3.agentLog('TOOL','📁 Otevřen projekt: '+proj.name+(proj.path?' ['+proj.path+']':''));
          /* Set working tree root to project path */
          if(proj.path){_wtRoot=proj.path;_loadWorkspaceTree(proj.path);}
          /* Link project to session */
          _ts._projectId=proj.id||null;_persistSessionState();
          if(proj.id){fetch(_backendBase+'/api/projects/'+proj.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(pd){if(pd.description)c3.agentLog('TOOL',_s(pd.description));if(pd.path&&!proj.path){proj.path=pd.path;_wtRoot=pd.path;_loadWorkspaceTree(pd.path);}}).catch(function(){});}
        }
        var wrk=WORKERS.find(function(w){return w.name===d.name;});
        if(wrk){c3.agentLog('TOOL','⚙️ Worker: '+wrk.name+' ['+_s(wrk.status)+'] cron: '+_s(wrk.cron));}
      }else if(a==='Editovat'){
        _centerState.detail.editing=true;_centerState.detail._orig=d.fields.map(function(f){return{k:f.k,v:f.v};});_centerState.detail._origActions=d.actions.slice();_centerState.detail.actions=['Uložit','Zrušit'];c3.agentLog('TOOL','✏️ Editace: '+d.name);renderCenter();
      }else if(a==='Uložit'){
        var view=_centerState.view;var itemId=null;
        if(view==='projects'){var p2=PROJECTS.find(function(p){return p.name===d.name;});if(p2)itemId=p2.id;}
        else if(view==='experts'){var e2=EXPERTS.find(function(e){return e.name===d.name;});if(e2)itemId=e2.id;}
        else if(view==='workers'){var w4=WORKERS.find(function(w){return w.name===d.name;});if(w4)itemId=w4.id;}
        var upd={};d.fields.forEach(function(f){upd[f.k]=f.v;});
        var ep=view==='projects'?'/api/projects/':view==='experts'?'/api/experts/':view==='workers'?'/api/agents/':null;
        if(d._isNew&&ep){
          /* POST new entity */
          upd.name=d.name;
          var postEp=view==='chats'?'/api/conversations':ep.slice(0,-1);/* remove trailing / */
          fetch(_backendBase+postEp,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(5000)})
          .then(function(r){return r.json();})
          .then(function(created){
            c3.agentLog('TOOL','✨ Vytvořeno: '+d.name);
            /* Link conversation to session */
            if(view==='chats'&&created.id){
              var _ti2=_centerState.targetSession||0;if(_ti2>=_sessionCount)_ti2=0;
              _sessions[_ti2]._convId=created.id;
              _sessions[_ti2].chat.expert=upd.Expert||upd.expert||'Výchozí';
              _sessions[_ti2].chat.msgs=[{role:'system',text:'📂 Nová konverzace: '+d.name}];
              _persistSessionState();renderChat();
            }
            fetchBackendData();
          }).catch(function(){c3.agentLog('TOOL','✨ Vytvořeno lokálně: '+d.name);});
          delete d._isNew;
        }else if(itemId&&ep){fetch(_backendBase+ep+itemId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','💾 Uloženo: '+d.name);fetchBackendData();}).catch(function(){c3.agentLog('TOOL','💾 Uloženo lokálně: '+d.name);});}
        else{c3.agentLog('TOOL','💾 Uloženo: '+d.name);}
        d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;renderCenter();
      }else if(a==='Zrušit'){
        if(d._orig){d.fields=d._orig;}d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;c3.agentLog('TOOL','↩️ Editace zrušena');renderCenter();
      }else if(a==='Archivovat'){
        var cid=null;var conv2=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv2&&conv2.id)cid=conv2.id;
        var pid=null;var proj2=PROJECTS.find(function(p){return p.name===d.name;});if(proj2&&proj2.id)pid=proj2.id;
        if(cid){fetch(_backendBase+'/api/conversations/'+cid,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','📦 Konverzace '+d.name+' archivována.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','📦 '+d.name+' archivováno (lokálně).');});}
        else if(pid){fetch(_backendBase+'/api/projects/'+pid,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','📦 Projekt '+d.name+' archivován.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','📦 '+d.name+' archivováno (lokálně).');});}
        else{c3.agentLog('TOOL','📦 '+d.name+' archivováno.');}
        _centerState.detail=null;renderCenter();
      }else if(a==='Spustit'){
        var wid=null;var w2=WORKERS.find(function(w){return w.name===d.name;});if(w2&&w2.id)wid=w2.id;
        if(wid){fetch(_backendBase+'/api/agents/'+wid+'/run',{method:'POST',signal:AbortSignal.timeout(5000)}).then(function(){c3.agentLog('TOOL','▶️ Worker '+d.name+' spuštěn.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','▶️ Worker '+d.name+' — backend nedostupný.');});}
        else{c3.agentLog('TOOL','▶️ Worker '+d.name+' spuštěn.');}
      }else if(a==='Pozastavit'){
        var wid2=null;var w3=WORKERS.find(function(w){return w.name===d.name;});if(w3&&w3.id)wid2=w3.id;
        if(wid2){fetch(_backendBase+'/api/agents/'+wid2+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','⏸️ Worker '+d.name+' pozastaven.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','⏸️ Worker '+d.name+' — backend nedostupný.');});}
        else{c3.agentLog('TOOL','⏸️ Worker '+d.name+' pozastaven.');}
      }
    }},a);}))):null));}

/* ── File open / diff open event listeners (Blok E) ── */
document.addEventListener('c3-file-open',function(e){
  var path=e.detail&&e.detail.path;
  if(path)_openFileTab(path);
});
document.addEventListener('c3-diff-open',function(e){
  var d=e.detail;if(!d)return;
  var totalLines=((d.oldContent||'').split('\n').length)+((d.newContent||'').split('\n').length);
  var tab={id:'diff-'+(d.reqId||Date.now()),type:'diff',path:d.path||'',
    label:'~ '+(d.path||'').split('/').pop(),reqId:d.reqId||null,baseHash:d.baseHash||null,
    tooLarge:totalLines>4000,dirty:false,scrollTop:0,deleted:false,externalChange:false,
    diffData:totalLines>4000?null:{hunks:computeLineDiff(d.oldContent,d.newContent)}};
  _editorState.tabs.push(tab);
  _editorState.activeTabId=tab.id;
  _editorState.active=true;
  renderCenter();
});
/* ── Dirty tab guard ── */
window.addEventListener('beforeunload',function(e){
  if(_editorState.tabs.some(function(t){return t.dirty;})){e.preventDefault();e.returnValue='Máte neuložené změny.';}
});
/* ── Restore editor tabs from localStorage (deferred to ws:ready — invariant 17) ── */
if(typeof C3Bus!=='undefined'){
  C3Bus.on('ws:ready',function(){
    try{var saved=JSON.parse(localStorage.getItem('c3-editor-state')||'null');
      if(saved&&saved.openFiles&&saved.openFiles.length>0){saved.openFiles.forEach(function(f){_openFileTab(f.path);});}
    }catch(e){}
  });
}

/* Nav event handler */
window.addEventListener('c3-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;_centerState.settingsSection=null;_editorState.active=false;renderCenter();
  if(e.detail.select){
    var name=e.detail.select,view=e.detail.view,item=null;
    if(view==='experts'){item=EXPERTS.find(function(x){return x.name===name||x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Typ',v:item.desc},{k:'Doména',v:item.domain||'general'},{k:'Emoji',v:item.emoji},{k:'Specialista',v:item.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:item.fav?'Ano':'Ne'}],tags:[item.isSpecialist?'Specialista':'Expert',item.domain||item.desc].filter(Boolean),actions:['Otevřít','Editovat']});}
    else if(view==='projects'){item=PROJECTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Status',v:item.status,a:item.status==='Active'},{k:'Cesta',v:item.path||''},{k:'Popis',v:item.desc||''},{k:'Vytvořeno',v:item.created}],tags:item.tags,actions:['Otevřít','Editovat','Archivovat']});}
    else if(view==='chats'){item=CONVERSATIONS.find(function(x){return x.title.indexOf(name)>=0;});if(item)setDetail({name:item.title,fields:[{k:'Expert',v:item.expert},{k:'Čas',v:item.time}],tags:['Chat',item.expert],actions:['Otevřít','Archivovat']});}
    else if(view==='specialists'){item=SPECIALISTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Oblast',v:item.desc}],tags:item.tags,actions:['Otevřít','Editovat']});}
    else if(view==='workers'){item=WORKERS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Status',v:item.status,a:item.status==='Running'},{k:'Cron',v:item.cron},{k:'Popis',v:item.desc}],tags:['Worker',item.status],actions:['Spustit','Pozastavit','Editovat']});}
  }
});


/* ═══════════════════════════════════════════════════════════
   3. CHAT PANEL — pure DOM via ReactDOM.render (NO ReactWidget)
   ═══════════════════════════════════════════════════════════ */
var C3_CHAT_ID='c3-chat-panel';

/* ── Shared session state (links chat ↔ bottom panel) ── */
var _sessionCount=2;
var _sessionActive=0;
function _mkSession(){return{
  _convId:null,          /* conversationId — stable routing key */
  _projectId:null,       /* linked project */
  _agentId:null,         /* G1: agent binding — persists with conversation metadata */
  chat:{msgs:[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}],ctx:0,expert:'Výchozí',showExperts:false,showAllExperts:false,attachments:[],editMode:'auto',acSuggestion:null,acLoading:false},
  bottom:'split', /* 'agent' | 'terminal' | 'split' | 'mix' */
  log:[],
  term:[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}]
};}
var _sessions=[_mkSession(),_mkSession()];
/* Expose globally so terminal-client.js and agent-client.js can access session state */
window._sessions=_sessions;
function _ensureSessions(){while(_sessions.length<_sessionCount)_sessions.push(_mkSession());}
function _setSessionCount(n){_sessionCount=Math.max(1,Math.min(3,n));if(_sessionActive>=_sessionCount)_sessionActive=_sessionCount-1;_ensureSessions();renderChat();renderAgent();}

var _chatContainer=null;

/* ── Bus subscriptions (transport → UI) ── */
function _initBusSubscriptions() {
  if (typeof C3Bus === 'undefined') { console.warn('[C3] C3Bus not available yet'); return; }

  /* Chat messages from assistant */
  C3Bus.on('chat:message', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
    s.chat.msgs.push({role:'assistant', text:ev.content, tag:ev.tag||'LLM'});
    if (ev.metadata && typeof ev.metadata.contextPercent === 'number') s.chat.ctx = ev.metadata.contextPercent;
    /* v65.0: If SHELL intent — switch to split/terminal so user sees output */
    if (ev.metadata && ev.metadata.shellCommand) {
      if (s.bottom !== 'split' && s.bottom !== 'terminal') { s.bottom = 'split'; }
      renderAgent();
    }
    renderChat(); _chatScrollPane(ev.sessionIdx);
  });

  /* System messages */
  C3Bus.on('chat:system', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
    s.chat.msgs.push({role:'system', text:ev.content});
    renderChat(); _chatScrollPane(ev.sessionIdx);
  });

  /* Agent log entries (from agent-client.js formatter) */
  C3Bus.on('agent:log', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
    s.log.forEach(function(l) { l.active = false; });
    s.log.push(ev.entry);
    renderAgent();
  });

  /* Terminal lines (from terminal-client.js) */
  C3Bus.on('terminal:line', function(ev) {
    renderAgent();
  });

  /* Status updates (context %, health) */
  C3Bus.on('status:update', function(ev) {
    if (ev.data && typeof ev.data.contextPercent === 'number') {
      var si = ev.sessionIdx !== undefined ? ev.sessionIdx : _sessionActive;
      var s = _sessions[si] || _sessions[0];
      s.chat.ctx = ev.data.contextPercent;
      renderChat();
    }
    if (ev.health) {
      _serverHealth = ev.health;
      renderSidebar();
    }
  });

  /* Edit requests (ask mode) — open diff tab in center editor */
  C3Bus.on('edit:request', function(ev) {
    var si = ev.sessionIdx;
    var s = _sessions[si] || _sessions[0];
    var d = ev.event || {};
    var p = d.payload || d;
    if (s.chat.editMode === 'ask') {
      var reqId = p.reqId || p.requestId || d.id || ('er-' + Date.now());
      var file = p.file || '';
      if (typeof C3WS !== 'undefined') C3WS.trackEditRequest(reqId, file, null, si);
      /* Open diff tab in center editor */
      if (p.oldContent !== undefined || p.newContent !== undefined) {
        document.dispatchEvent(new CustomEvent('c3-diff-open', {
          detail: { reqId: reqId, path: file, oldContent: p.oldContent || '', newContent: p.newContent || '', baseHash: p.baseHash || null }
        }));
      }
      s.chat.msgs.push({role:'assistant', text:'✋ Editace: ' + file + ' — otevřen diff v centru', tag:'EDIT', _editReqId: reqId});
      renderChat(); _chatScrollPane(si);
    }
  });

  /* Edit resolved */
  C3Bus.on('edit:resolved', function(ev) {
    renderChat(); renderAgent();
  });

  /* Workspace file changes (F3 — dirty tab protection) */
  C3Bus.on('workspace:change', function(ev) {
    if (ev.data && ev.data.type === 'file_batch') {
      /* Refresh working tree from filesystem */
      if (_wtRoot) _loadWorkspaceTree(_wtRoot);

      (ev.data.events || []).forEach(function(e) {
        var tab = _editorState.tabs.find(function(t) { return t.path === e.path && t.type === 'file'; });
        if (!tab) return;
        if (e.event === 'unlink') {
          tab.deleted = true;
        } else if (e.event === 'change') {
          if (tab.dirty) {
            tab.externalChange = true; /* sticky banner — NESMÍ přepsat dirty tab */
          } else {
            _refreshFileTab(tab);
          }
        }
      });
      renderCenter();
    }
  });

  /* WS ready */
  C3Bus.on('ws:ready', function(ev) {
    _serverHealth.wsConnected = true;
    _serverHealth.status = 'ok';
    renderSidebar();
  });

  /* WS disconnected */
  C3Bus.on('ws:disconnected', function(ev) {
    _serverHealth.wsConnected = false;
    if (ev.wasReady) {
      _sessions.forEach(function(s) {
        s.chat.msgs.push({role:'system', text:'⚠️ Spojení s backendem ztraceno. Pokus o reconnect...'});
      });
      renderChat();
    }
    renderSidebar();
  });

  /* WS reconnected */
  C3Bus.on('ws:reconnected', function() {
    _sessions.forEach(function(s) {
      s.chat.msgs.push({role:'system', text:'✅ Spojení obnoveno.'});
    });
    renderChat(); renderSidebar();
  });

  /* Session changed (e.g. after rehydration) */
  C3Bus.on('session:changed', function(ev) {
    renderChat(); renderAgent();
    _persistSessionState();
  });

  /* Session invalid (orphan) */
  C3Bus.on('session:invalid', function(ev) {
    _sessions.forEach(function(s) {
      if (s._convId === ev.sessionId) {
        s._convId = null;
        s.chat.msgs.push({role:'system', text:'⚠️ Konverzace již neexistuje na serveru.'});
      }
    });
    renderChat();
  });
}

/* ── Health state ── */
var _serverHealth = {status:'unknown', wsConnected:false, lastCheck:0};

/* ── Session persistence (crash recovery) ── */
var _persistDebounce = null;
function _persistSessionState() {
  clearTimeout(_persistDebounce);
  _persistDebounce = setTimeout(function() {
    try {
      localStorage.setItem('c3-session-state', JSON.stringify({
        sessionCount: _sessionCount,
        sessionActive: _sessionActive,
        sessions: _sessions.map(function(s) {
          return {
            convId: s._convId,
            projectId: s._projectId,
            agentId: s._agentId,
            expertName: s.chat.expert,
            editMode: s.chat.editMode,
            bottomMode: s.bottom
          };
        })
      }));
    } catch(e) {}
  }, 1000);
}

/* ── Restore session state from localStorage ── */
function _restoreSessionState() {
  try {
    var saved = JSON.parse(localStorage.getItem('c3-session-state') || 'null');
    if (saved) {
      _sessionCount = saved.sessionCount || 2;
      _sessionActive = saved.sessionActive || 0;
      _ensureSessions();
      (saved.sessions || []).forEach(function(ss, i) {
        if (_sessions[i]) {
          _sessions[i]._convId = ss.convId || null;
          _sessions[i]._projectId = ss.projectId || null;
          _sessions[i]._agentId = ss.agentId || null;
          _sessions[i].chat.expert = ss.expertName || 'Výchozí';
          _sessions[i].chat.editMode = ss.editMode || 'auto';
          _sessions[i].bottom = ss.bottomMode || 'split';
        }
      });
    }
  } catch(e) {}
}

/* ── Initialize transport ── */
function _initTransport() {
  _restoreSessionState();
  _initBusSubscriptions();

  /* Init sub-modules */
  if (typeof C3Agent !== 'undefined' && C3Agent.init) C3Agent.init();
  if (typeof C3Terminal !== 'undefined' && C3Terminal.init) C3Terminal.init();

  /* Connect WS */
  if (typeof C3WS !== 'undefined' && C3WS.connect) {
    C3WS.connect();
  }
}
/* Delayed init — give modules time to load */
setTimeout(_initTransport, 200);

function renderChat(){if(!_chatContainer)return;ReactDOM.render(h(ChatApp,null),_chatContainer);}
function _chatScrollPane(idx){setTimeout(function(){var f=document.getElementById('c3-chat-feed-'+idx);if(f)f.scrollTop=f.scrollHeight;},60);}

/* Expose for cross-component communication */
window._c3={
  chatMsg:function(text){var s=_sessions[_sessionActive]||_sessions[0];s.chat.msgs.push({role:'system',text:text});renderChat();_chatScrollPane(_sessionActive);try{var cp=document.getElementById('c3-chat-panel');if(cp){cp.style.outline='2px solid '+C.accent;setTimeout(function(){cp.style.outline='';},1200);}}catch(e){}},
  setExpert:function(name){var s=_sessions[_sessionActive]||_sessions[0];s.chat.expert=name;renderChat();_persistSessionState();},
  getExpert:function(){return(_sessions[_sessionActive]||_sessions[0]).chat.expert;},
  renderChat:renderChat,
  agentLog:function(type,text){var s=_sessions[_sessionActive]||_sessions[0];var now=new Date();s.log.forEach(function(e){e.active=false;});s.log.push({time:now.toLocaleTimeString('cs-CZ'),type:type,cls:type.toLowerCase(),text:text,active:true,ts:now.toISOString()});renderAgent();},
  renderCenter:function(){renderCenter();},
  approveEdit:function(reqId){if(typeof C3WS!=='undefined')C3WS.approveEdit(reqId);},
  rejectEdit:function(reqId){if(typeof C3WS!=='undefined')C3WS.rejectEdit(reqId);},
  sessions:_sessions,
  getSessionActive:function(){return _sessionActive;}
};

/* Autocomplete — Tab triggers backend completion */
/* H1: AbortController + LRU cache */
var _acAbort=null;
var _acCache={};
var _acOrder=[];
var _acMaxCache=20;

function _chatAutocomplete(idx){
  var ta=document.getElementById('c3-chat-ta-'+idx);
  var s=_sessions[idx];if(!s||!ta)return;var st=s.chat;
  var partial=ta.value;if(!partial.trim()){return;}
  /* If there's already a suggestion showing, accept it */
  if(st.acSuggestion){ta.value=partial+st.acSuggestion;st.acSuggestion=null;ta.style.height='20px';ta.style.height=Math.min(ta.scrollHeight,100)+'px';renderChat();return;}

  /* H1: LRU cache hit */
  if(_acCache[partial]){
    st.acSuggestion=_acCache[partial];
    _acOrder=_acOrder.filter(function(k){return k!==partial;});
    _acOrder.push(partial);
    renderChat();return;
  }

  /* H1: Abort previous request */
  if(_acAbort){try{_acAbort.abort();}catch(e){}}
  _acAbort=new AbortController();
  var requestPrefix=partial;

  st.acLoading=true;renderChat();
  fetch(_backendBase+'/api/autocomplete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partial:partial,expert:st.expert,context:st.msgs.slice(-6).map(function(m){return{role:m.role,text:m.text};})}),signal:_acAbort.signal})
  .then(function(r){return r.json();})
  .then(function(d){
    st.acLoading=false;
    /* H1: Stale guard — check input hasn't changed */
    var currentTa=document.getElementById('c3-chat-ta-'+idx);
    if(currentTa&&currentTa.value!==requestPrefix){renderChat();return;}
    if(d.suggestion){
      /* H1: LRU cache store */
      _acCache[requestPrefix]=d.suggestion;
      _acOrder.push(requestPrefix);
      while(_acOrder.length>_acMaxCache){var oldest=_acOrder.shift();delete _acCache[oldest];}
      st.acSuggestion=d.suggestion;
    }
    renderChat();
  })
  .catch(function(e){
    if(e&&e.name==='AbortError')return;/* expected */
    st.acLoading=false;renderChat();
  });
}

/* Context meter — poll real context usage from backend */
function _pollContext(idx){
  var s=_sessions[idx];if(!s)return;
  fetch(_backendBase+'/api/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:idx,messageCount:s.chat.msgs.length}),signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(d){if(typeof d.percent==='number'){s.chat.ctx=d.percent;renderChat();}})
  .catch(function(){});
}

function _chatSendPane(idx){
  var ta=document.getElementById('c3-chat-ta-'+idx);
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  st.acSuggestion=null;/* clear autocomplete on send */
  var t=ta?ta.value.trim():'';if(!t&&st.attachments.length===0)return;

  /* ── Slash commands ── */
  if(t.charAt(0)==='/'){
    var parts=t.split(/\s+/);var cmd=parts[0].toLowerCase();var arg=parts.slice(1).join(' ');
    if(cmd==='/run'){
      if(ta){ta.value='';ta.style.height='22px';}
      st.msgs.push({role:'user',text:t});renderChat();
      if(arg&&typeof C3Terminal!=='undefined'){C3Terminal.send(idx,arg);renderAgent();}
      else{st.msgs.push({role:'system',text:'Použití: /run <příkaz>'});renderChat();}
      return;
    }
    if(cmd==='/test'){
      if(ta){ta.value='';ta.style.height='22px';}
      st.msgs.push({role:'user',text:'/test'});renderChat();
      if(typeof C3Terminal!=='undefined'){C3Terminal.send(idx,arg||'npm test');renderAgent();}
      return;
    }
    if(cmd==='/edit'){
      if(ta){ta.value='';ta.style.height='22px';}
      st.editMode=st.editMode==='auto'?'ask':'auto';
      st.msgs.push({role:'system',text:'Edit mode: '+(st.editMode==='auto'?'▶▶ Auto':'✋ Dotaz')});
      _persistSessionState();renderChat();
      return;
    }
    if(cmd==='/explain'||cmd==='/review'){
      /* Prepend instruction and send as normal chat */
      t=(cmd==='/explain'?'Vysvětli: ':'Zreviduj: ')+(arg||'předchozí kód');
    }
  }

  var hasFiles=st.attachments.length>0;
  var txt=t;
  if(hasFiles){txt=(t?t+'\n':'')+'📎 '+st.attachments.map(function(a){return a.name;}).join(', ');}
  st.msgs.push({role:'user',text:txt});
  st.attachments=[];
  if(ta){ta.value='';ta.style.height='22px';}
  _sessionActive=idx;
  renderChat();_chatScrollPane(idx);
  /* Send via WS (channel protocol) or HTTP fallback */
  var sent = false;
  if (typeof C3WS !== 'undefined' && C3WS.isReady()) {
    sent = C3WS.sendChat(txt, s);
  }
  if (!sent) {
    fetch(_backendBase+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'chat',message:txt,expert:st.expert,editMode:st.editMode,conversationId:s._convId,agentId:s._agentId||null})})
    .then(function(r){return r.json();})
    .then(function(d){st.msgs.push({role:'assistant',text:d.response||d.text||JSON.stringify(d),tag:'LLM'});if(typeof d.contextPercent==='number')st.ctx=d.contextPercent;renderChat();_chatScrollPane(idx);})
    .catch(function(){st.msgs.push({role:'assistant',text:'Backend nedostupný. Spusťte: node src/server.js',tag:'ERROR'});renderChat();});
  }
  /* Poll context after send */
  setTimeout(function(){_pollContext(idx);},2000);
}

function _chatPaneUI(idx){
  var s=_sessions[idx];if(!s)return null;var st=s.chat;
  var isFocused=_sessionActive===idx;
  var btnS={background:C.accentBg,color:C.accentText,border:'none',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:24,height:24};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font,position:'relative'},
    onClick:function(){_sessionActive=idx;
      _sessions.forEach(function(ss,j){if(j!==idx)ss.chat.showExperts=false;});
      if(st.showExperts){st.showExperts=false;}renderChat();}},
    /* PANE HEADER */
    h('div',{style:{padding:'0 6px',height:28,display:'flex',alignItems:'center',gap:3,borderBottom:'1px solid '+C.border,flexShrink:0,background:isFocused?C.bg2:'transparent'}},
      h('button',{style:btnS,title:'Nový chat',onClick:function(ev){ev.stopPropagation();st.msgs=[{role:'system',text:'Nový chat.'}];st.ctx=0;st.attachments=[];_sessionActive=idx;renderChat();}},svgEl(I.plus)),
      h('div',{style:{flex:1}}),
      /* Context meter */
      h('div',{style:{display:'flex',alignItems:'center',gap:3,fontSize:9,color:C.tx4,fontFamily:C.mono}},
        h('div',{style:{width:30,height:3,background:C.bg4,borderRadius:2,overflow:'hidden'}},h('div',{style:{height:'100%',background:C.accent,borderRadius:2,width:st.ctx+'%'}})),h('span',null,st.ctx+'%'))),
    /* FEED */
    h('div',{id:'c3-chat-feed-'+idx,style:{flex:1,overflowY:'auto',padding:8}},
      st.msgs.map(function(m,i){var u=m.role==='user',a=m.role==='assistant';
        return h('div',{key:i,style:{padding:'6px 0',borderBottom:'1px solid '+C.border}},
          h('div',{style:{display:'flex',alignItems:'center',gap:4,marginBottom:2}},
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:u?C.bg4:a?'linear-gradient(135deg,#22c55e,#16a34a)':C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:a?6:8,fontWeight:a?700:400,color:u?C.tx3:a?'#fff':C.tx4}},u?'👤':a?'C3':'⚡'),
            h('span',{style:{fontSize:10,fontWeight:600,color:C.tx2}},u?'Ty':a?'C3':'System'),
            m.tag?h('span',{style:{fontSize:7.5,padding:'1px 3px',borderRadius:3,fontFamily:C.mono,textTransform:'uppercase',background:m.tag==='ERROR'?C.redBg:C.purpleBg,color:m.tag==='ERROR'?C.red:C.purple}},m.tag):null),
          h('div',{style:{fontSize:12,lineHeight:'1.5',color:C.tx1,paddingLeft:22,wordBreak:'break-word',whiteSpace:'pre-wrap'}},m.text));})),
    /* INPUT */
    h('div',{style:{padding:6,borderTop:'1px solid '+C.border,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
      h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:10,overflow:'visible',position:'relative'}},
        st.attachments.length>0?h('div',{style:{display:'flex',flexWrap:'wrap',gap:3,padding:'5px 8px 0'}},
          st.attachments.map(function(a,i){
            var isImg=/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(a.name);
            return h('span',{key:i,style:{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 6px',borderRadius:5,background:C.bg4,fontSize:9,color:C.tx2,maxWidth:160},title:a.name+' ('+a.size+')'},
              isImg?'🖼️':'📎',
              h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},a.name),
              h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:11,marginLeft:1,flexShrink:0},onClick:function(e){e.stopPropagation();st.attachments.splice(i,1);renderChat();}},'×'));})):null,
        h('div',{style:{display:'flex',alignItems:'flex-end',padding:'6px 8px 4px',gap:3}},
          h('textarea',{id:'c3-chat-ta-'+idx,style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.font,fontSize:12.5,lineHeight:'1.4',resize:'none',minHeight:20,maxHeight:100,overflow:'auto'},placeholder:'Napiš zprávu...',rows:1,
            onFocus:function(){_sessionActive=idx;renderChat();},
            onInput:function(e){e.target.style.height='20px';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';st.acSuggestion=null;renderChat();},
            onKeyDown:function(e){if(e.key==='Tab'){e.preventDefault();_chatAutocomplete(idx);}else if(e.key==='Escape'){st.acSuggestion=null;renderChat();}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_chatSendPane(idx);}}}),
          h('button',{style:{background:'rgba(34,197,94,0.15)',color:C.accentText,border:'none',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:26,height:26,flexShrink:0},onClick:function(){_chatSendPane(idx);}},svgEl(I.send))),
        /* Autocomplete suggestion — subtle ghost text row */
        st.acSuggestion?h('div',{style:{display:'flex',alignItems:'center',padding:'1px 8px 2px',cursor:'pointer',gap:4},onClick:function(ev){ev.stopPropagation();_chatAutocomplete(idx);}},
          h('span',{style:{fontSize:11.5,color:C.tx4,opacity:0.45,fontFamily:C.font,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1,fontStyle:'italic'}},st.acSuggestion),
          h('span',{style:{fontSize:8,color:C.tx4,fontFamily:C.mono,flexShrink:0,padding:'1px 5px',border:'1px solid '+C.border2,borderRadius:3,opacity:0.5}},'Tab')):null,
        st.acLoading?h('div',{style:{padding:'1px 8px 2px'}},
          h('div',{style:{height:1,borderRadius:1,background:C.bg4,overflow:'hidden'}},
            h('div',{style:{height:'100%',width:'30%',background:C.tx4,borderRadius:1,opacity:0.3,animation:'c3-ac-pulse 1.2s ease-in-out infinite'}}))):null,
        h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 6px 5px',borderTop:'1px solid '+C.border}},
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22},title:'Připojit soubor',
            onClick:function(ev){ev.stopPropagation();var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var j=0;j<inp.files.length;j++){st.attachments.push({name:inp.files[j].name,size:Math.round(inp.files[j].size/1024)+' KB',file:inp.files[j]});}renderChat();}document.body.removeChild(inp);};inp.click();}},svgEl(I.attach,12)),
          /* Edit mode toggle */
          h('div',{style:{display:'flex',alignItems:'center',gap:1,padding:'1px 2px',borderRadius:4,background:C.bg3,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:9,fontWeight:600,cursor:'pointer',color:st.editMode==='auto'?C.tx1:C.tx4,background:st.editMode==='auto'?C.bg4:'transparent'},
              onClick:function(){st.editMode='auto';renderChat();_persistSessionState();},title:'Agent edituje soubory automaticky'},'Auto'),
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:9,fontWeight:600,cursor:'pointer',color:st.editMode==='ask'?C.tx1:C.tx4,background:st.editMode==='ask'?C.bg4:'transparent'},
              onClick:function(){st.editMode='ask';renderChat();_persistSessionState();},title:'Agent se zeptá před každou editací'},'Review')),
          h('div',{style:{flex:1}}),
          h('div',{style:{display:'flex',alignItems:'center',gap:2,padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:500,color:C.accentText,opacity:0.7,cursor:'pointer',flexShrink:0},
            onClick:function(ev){ev.stopPropagation();st.showExperts=!st.showExperts;renderChat();}},
            h('span',{style:{width:4,height:4,borderRadius:'50%',background:C.accent}}),st.expert,svgEl(I.chevDown,8))),
        st.showExperts?(function(){var favs=EXPERTS.filter(function(e){return e.fav;});var shown=st.showAllExperts?EXPERTS:favs.length>0?favs:EXPERTS;return h('div',{style:{position:'absolute',bottom:'100%',right:6,marginBottom:3,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:'4px 0',minWidth:160,maxHeight:240,overflowY:'auto',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,0.5)'},onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{padding:'3px 10px 5px',fontSize:8.5,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px'}},'VYBRAT EXPERTA'),
          shown.map(function(exp){
            return h('div',{key:exp.name,style:{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',fontSize:11,color:st.expert===exp.name?C.accentText:C.tx2,background:st.expert===exp.name?C.accentBg:'transparent',cursor:'pointer'},
              onMouseEnter:function(e){e.currentTarget.style.background=C.bg4;},
              onMouseLeave:function(e){e.currentTarget.style.background=st.expert===exp.name?C.accentBg:'transparent';},
              onClick:function(e){e.stopPropagation();st.expert=exp.name;st.showExperts=false;st.showAllExperts=false;renderChat();}},
              h('span',null,exp.emoji),h('span',{style:{flex:1}},exp.name),
              h('span',{style:{fontSize:11,color:exp.fav?C.accentText:C.tx4,cursor:'pointer'},onClick:function(e){e.stopPropagation();exp.fav=!exp.fav;if(exp.id){fetch(_backendBase+'/api/experts/'+exp.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:exp.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderChat();}},exp.fav?'★':'☆'));}),
          !st.showAllExperts&&favs.length>0&&favs.length<EXPERTS.length?h('div',{style:{padding:'4px 10px',fontSize:9.5,color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExperts=true;renderChat();}},'Zobrazit vše ('+EXPERTS.length+')'):null,
          st.showAllExperts?h('div',{style:{padding:'4px 10px',fontSize:9.5,color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExperts=false;renderChat();}},'Jen oblíbené'):null);}()):null)));
}

function ChatApp(){
  var sc=_sessionCount;_ensureSessions();
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    /* Top bar — split count on the right */
    h('div',{style:{height:22,display:'flex',alignItems:'center',borderBottom:'1px solid '+C.border,flexShrink:0,padding:'0 6px'}},
      h('span',{style:{fontSize:12,fontWeight:600,color:C.tx2}},'Chat'),
      h('div',{style:{flex:1}}),
      h('span',{style:{fontSize:9,color:C.tx4,marginRight:4}},'Relace'),
      [1,2,3].map(function(n){
        return h('div',{key:n,style:{width:18,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,borderRadius:3,cursor:'pointer',marginRight:1,
          color:sc===n?C.tx1:C.tx4,background:sc===n?C.bg4:'transparent'},
          onClick:function(){_setSessionCount(n);}},n);
      })),
    /* Split panes */
    h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
      Array.from({length:sc},function(_,i){
        return h('div',{key:'cp'+i,style:{flex:1,display:'flex',borderRight:i<sc-1?'2px solid '+C.border2:'none',overflow:'hidden'}},_chatPaneUI(i));
      })));
}

class C3ChatWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=C3_CHAT_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.cssText='height:100%;width:100%;outline:none;';}
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render — we manage DOM via ReactDOM.render */}
  onAfterAttach(){_chatContainer=this.node;renderChat();}
}
inversify_1.decorate(inversify_1.injectable(),C3ChatWidget);


/* ═══════════════════════════════════════════════════════════
   4. AGENT LOG — pure DOM via ReactDOM.render
   ═══════════════════════════════════════════════════════════ */
var C3_AGENT_ID='c3-agent-panel';
var TC={cre:C.cyan,llm:C.purple,tool:C.amber,gate:C.accentText,turn:C.blue};
var _agentContainer=null;
function renderAgent(){if(!_agentContainer)return;ReactDOM.render(h(AgentApp,null),_agentContainer);}

function _agentLogContent(s){
  return h('div',{style:{flex:1,overflowY:'auto'}},s.log.map(function(e,i){
    var agentColor=e.agent&&typeof C3Agent!=='undefined'?C3Agent.getAgentColor(e.agent):null;
    return h('div',{key:i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:11,lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
      h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
      /* G2: Agent color badge */
      e.agent?h('span',{style:{fontSize:9,padding:'1px 4px',borderRadius:3,background:agentColor+'22',color:agentColor,marginRight:2,flexShrink:0}},e.agent):null,
      h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
      h('span',{style:{color:C.tx2}},e.text));}));
}
function _terminalContent(s,idx){
  var isExec=typeof C3Terminal!=='undefined'&&C3Terminal.isExecuting(idx);
  return h('div',{style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    h('div',{style:{flex:1,overflowY:'auto',padding:'5px 10px',fontFamily:C.mono,fontSize:11.5,lineHeight:'1.6',color:C.tx2}},
      s.term.map(function(t,i){
        return h('div',{key:i},t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
          t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
      })),
    /* Terminal input */
    h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'3px 6px',borderTop:'1px solid '+C.border,background:C.bg2,flexShrink:0}},
      h('span',{style:{color:C.accentText,fontFamily:C.mono,fontSize:11,flexShrink:0}},'$'),
      h('input',{id:'c3-term-input-'+idx,style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.mono,fontSize:11.5},
        placeholder:isExec?'Čekám na dokončení...':'Zadej příkaz...',disabled:isExec,
        onKeyDown:function(e){if(e.key==='Enter'){var v=e.target.value.trim();if(v&&typeof C3Terminal!=='undefined'){C3Terminal.send(idx,v);e.target.value='';renderAgent();}}}}),
      isExec?h('button',{style:{background:C.redBg,color:C.red,border:'none',borderRadius:4,cursor:'pointer',fontSize:9,fontWeight:600,padding:'2px 6px',flexShrink:0},
        onClick:function(){_cancelExecution(idx);}},'STOP'):null));
}
function _mixedContent(s){
  /* Interleave log entries + terminal lines sorted by timestamp */
  var items=[];
  s.log.forEach(function(e){items.push({src:'log',d:e,ts:e.ts||''});});
  s.term.forEach(function(t){items.push({src:'term',d:t,ts:t.ts||''});});
  items.sort(function(a,b){return a.ts.localeCompare(b.ts);});
  return h('div',{style:{flex:1,overflowY:'auto',padding:'2px 0'}},items.map(function(it,i){
    if(it.src==='log'){var e=it.d;return h('div',{key:'l'+i,style:{display:'flex',gap:6,padding:'2px 10px',fontFamily:C.mono,fontSize:11,lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
      h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
      h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
      h('span',{style:{color:C.tx2}},e.text));}
    var t=it.d;return h('div',{key:'t'+i,style:{padding:'2px 10px',fontFamily:C.mono,fontSize:11.5,lineHeight:'1.5',color:C.tx2,background:'rgba(255,255,255,0.02)'}},
      t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
        t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
  }));
}
/* ── Cancel execution (LLM + terminal) ── */
function _cancelExecution(idx) {
  if (typeof C3WS !== 'undefined') C3WS.sendCancel();
  if (typeof C3Terminal !== 'undefined') C3Terminal.cancel(idx);
  var s = _sessions[idx];
  if (s) {
    s.log.forEach(function(l) { l.active = false; });
    s.log.push({time:new Date().toLocaleTimeString('cs-CZ'),type:'CANCEL',cls:'error',text:'Zrušeno uživatelem',active:true,ts:new Date().toISOString()});
  }
  renderAgent(); renderChat();
}

/* split mode: agent log left, terminal right */
function _splitContent(s,idx){
  return h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
    h('div',{style:{flex:1,borderRight:'1px solid '+C.border,overflow:'hidden',display:'flex'}},_agentLogContent(s)),
    h('div',{style:{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}},_terminalContent(s,idx)));
}

/* ── Audit panel ── */
var _auditCache={data:null,ts:0};
function _auditContent(s){
  /* Fetch audit data (cache 30s) */
  if(!_auditCache.data||Date.now()-_auditCache.ts>30000){
    var convId=s._convId;
    var url=_backendBase+'/api/audit?limit=100'+(convId?'&conversation_id='+convId:'');
    fetch(url,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){
      _auditCache={data:d,ts:Date.now()};renderAgent();
    }).catch(function(){});
  }
  var d=_auditCache.data||{audit:[],drift:[]};
  var items=[];
  (d.audit||[]).forEach(function(a){items.push({ts:a.created_at||'',src:'audit',d:a});});
  (d.drift||[]).forEach(function(dr){items.push({ts:dr.created_at||'',src:'drift',d:dr});});
  items.sort(function(a,b){return(b.ts||'').localeCompare(a.ts||'');});

  return h('div',{style:{flex:1,overflowY:'auto',padding:'4px 0'}},
    items.length===0?h('div',{style:{padding:20,textAlign:'center',color:C.tx4,fontSize:11}},'Žádné audit záznamy.'):
    items.map(function(it,i){
      if(it.src==='audit'){var a=it.d;return h('div',{key:'a'+i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:10.5,lineHeight:'1.5',borderLeft:'3px solid '+(a.verdict==='ok'||a.passed?C.accent:a.verdict==='warning'?C.amber:C.red)}},
        h('span',{style:{color:C.tx4,flexShrink:0,minWidth:70,fontSize:9.5}},a.created_at?(a.created_at.substring(11,19)||''):''),
        h('span',{style:{fontWeight:600,minWidth:50,flexShrink:0,color:a.verdict==='ok'||a.passed?C.accentText:a.verdict==='warning'?C.amber:C.red}},'MERGE'),
        h('span',{style:{color:C.tx2}},_s(a.expert_name||'')+' → '+(a.verdict||a.result||'')));}
      var dr=it.d;return h('div',{key:'d'+i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:10.5,lineHeight:'1.5',borderLeft:'3px solid '+C.amber}},
        h('span',{style:{color:C.tx4,flexShrink:0,minWidth:70,fontSize:9.5}},dr.created_at?(dr.created_at.substring(11,19)||''):''),
        h('span',{style:{fontWeight:600,minWidth:50,flexShrink:0,color:C.amber}},'DRIFT'),
        h('span',{style:{color:C.tx2}},_s(dr.capability||'')+': '+(dr.drift_score||dr.value||'')));
    }));
}

function _bottomPane(idx){
  var s=_sessions[idx];if(!s)return null;
  var mode=s.bottom||'split';
  /* Split/Mix together, then gap, then Terminal/Log/Audit */
  var grpA=[{k:'split',l:'Split'},{k:'mix',l:'Mix'}];
  var grpB=[{k:'terminal',l:'Terminal'},{k:'agent',l:'Log'},{k:'audit',l:'Audit'}];
  function setMode(m){s.bottom=m;renderAgent();}
  function _tab(m,mi){var active=mode===m.k;return h(React.Fragment,{key:m.k},
    mi>0?h('div',{style:{width:1,background:C.border}}):null,
    h('div',{style:{display:'flex',alignItems:'center',padding:'0 8px',fontSize:12,fontWeight:600,color:active?C.tx1:C.tx4,cursor:'pointer',borderBottom:'2px solid '+(active?C.accent:'transparent'),gap:3},
      onClick:function(){setMode(m.k);}},
      m.l,m.k==='agent'?h('span',{style:{fontSize:8,background:C.bg4,padding:'0 3px',borderRadius:4,color:C.tx3}},s.log.length):null));}
  return h('div',{key:'bp'+idx,style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    /* Per-panel tab bar */
    h('div',{style:{height:24,display:'flex',alignItems:'stretch',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2}},
      grpA.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{width:10}}),/* gap between groups */
      grpB.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{flex:1}}),
      /* STOP button — visible when executing */
      (typeof C3Agent!=='undefined'&&C3Agent.isExecuting(idx))||(typeof C3Terminal!=='undefined'&&C3Terminal.isExecuting(idx))?
        h('button',{style:{background:C.redBg,color:C.red,border:'none',borderRadius:3,cursor:'pointer',fontSize:8,fontWeight:700,padding:'2px 6px',margin:'0 4px',alignSelf:'center'},
          onClick:function(){_cancelExecution(idx);}},'■ STOP'):null,
      h('span',{style:{fontSize:9,color:C.tx4,padding:'0 6px',alignSelf:'center'}},''+(idx+1))),
    /* Panel content */
    mode==='split'?_splitContent(s,idx):mode==='agent'?_agentLogContent(s):mode==='terminal'?_terminalContent(s,idx):mode==='audit'?_auditContent(s):_mixedContent(s));
}

function AgentApp(){
  var sc=_sessionCount;_ensureSessions();
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    /* Top bar — synced session count */
    h('div',{style:{height:22,display:'flex',alignItems:'center',justifyContent:'flex-end',borderBottom:'1px solid '+C.border,flexShrink:0,padding:'0 6px',gap:2}},
      h('span',{style:{fontSize:9,color:C.tx4,marginRight:4}},'Relace'),
      [1,2,3].map(function(n){
        return h('div',{key:n,style:{width:18,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,borderRadius:3,cursor:'pointer',
          color:sc===n?C.tx1:C.tx4,background:sc===n?C.bg4:'transparent'},
          onClick:function(){_setSessionCount(n);}},n);
      })),
    /* Split panels — one per session */
    h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
      Array.from({length:sc},function(_,i){
        return h('div',{key:'w'+i,style:{flex:1,display:'flex',borderRight:i<sc-1?'2px solid '+C.border2:'none',overflow:'hidden'}},_bottomPane(i));
      })));
}

class C3AgentWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=C3_AGENT_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.cssText='height:100%;width:100%;outline:none;';}
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render */}
  onAfterAttach(){_agentContainer=this.node;renderAgent();}
}
inversify_1.decorate(inversify_1.injectable(),C3AgentWidget);


/* ═══════════════════════════════════════════════════════════
   CONTRIBUTIONS
   ═══════════════════════════════════════════════════════════ */
class C3SidebarContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_SIDEBAR_ID,widgetName:'C3 Navigation',defaultWidgetOptions:{area:'left',rank:0},toggleCommandId:'c3:toggleSidebar',toggleKeybinding:'ctrlcmd+b'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  async onStart(a){window._c3App=a;try{await this.openView({activate:false,reveal:true});}catch(e){}setTimeout(function(){try{a.shell.resize(240,'left');}catch(e){}},800);}}
inversify_1.decorate(inversify_1.injectable(),C3SidebarContrib);

class C3ChatContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_CHAT_ID,widgetName:'C3 Chat',defaultWidgetOptions:{area:'right',rank:100},toggleCommandId:'c3:toggleChat',toggleKeybinding:'ctrlcmd+shift+l'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  async onStart(a){try{await this.openView({activate:false,reveal:true});}catch(e){}}}
inversify_1.decorate(inversify_1.injectable(),C3ChatContrib);

class C3AgentContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_AGENT_ID,widgetName:'Agent Log',defaultWidgetOptions:{area:'bottom',rank:100},toggleCommandId:'c3:toggleAgent',toggleKeybinding:'ctrlcmd+shift+a'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  async onStart(a){try{await this.openView({activate:false,reveal:true});}catch(e){}}}
inversify_1.decorate(inversify_1.injectable(),C3AgentContrib);

class C3StatusContrib {
  onStart(){this._c();}
  async _c(){try{var r=await fetch('http://localhost:3335/health',{signal:AbortSignal.timeout(2000)});document.body.classList.toggle('c3-backend-online',r.ok);}catch(e){document.body.classList.remove('c3-backend-online');}}}
inversify_1.decorate(inversify_1.injectable(),C3StatusContrib);


/* ═══════════════════════════════════════════════════════════
   DI MODULE
   ═══════════════════════════════════════════════════════════ */
exports.default = new inversify_1.ContainerModule(function(bind){
  // Sidebar
  bind(C3SidebarWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){return{id:C3_SIDEBAR_ID,createWidget:function(){return ctx.container.get(C3SidebarWidget);}};}).inSingletonScope();
  browser_1.bindViewContribution(bind,C3SidebarContrib);
  bind(browser_1.FrontendApplicationContribution).toService(C3SidebarContrib);

  // Center view is mounted directly into DOM (no Theia widget needed)

  // Chat
  bind(C3ChatWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){return{id:C3_CHAT_ID,createWidget:function(){return ctx.container.get(C3ChatWidget);}};}).inSingletonScope();
  browser_1.bindViewContribution(bind,C3ChatContrib);
  bind(browser_1.FrontendApplicationContribution).toService(C3ChatContrib);

  // Agent
  bind(C3AgentWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){return{id:C3_AGENT_ID,createWidget:function(){return ctx.container.get(C3AgentWidget);}};}).inSingletonScope();
  browser_1.bindViewContribution(bind,C3AgentContrib);
  bind(browser_1.FrontendApplicationContribution).toService(C3AgentContrib);

  // Status
  bind(C3StatusContrib).toSelf();
  bind(browser_1.FrontendApplicationContribution).toService(C3StatusContrib);
});
