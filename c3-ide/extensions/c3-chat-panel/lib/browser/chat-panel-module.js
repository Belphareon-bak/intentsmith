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
var EXPERTS=[{emoji:'🤖',name:'Výchozí',desc:'Univerzální AI',fav:true},{emoji:'📊',name:'Účetní',desc:'Faktury, DPH',fav:true},{emoji:'💻',name:'Developer',desc:'Kód, debugging',fav:true},{emoji:'✍️',name:'Copywriter',desc:'Texty'},{emoji:'🏗️',name:'Architekt',desc:'Design'},{emoji:'🔬',name:'Researcher',desc:'Analýza'},{emoji:'📋',name:'PM',desc:'Projekty'},{emoji:'🎨',name:'Designer',desc:'UI/UX'},{emoji:'🛡️',name:'Security',desc:'Audit'}];
var PROJECTS=[{name:'Security Hardening',status:'Active',sprint:7,created:'5. 2. 2026',updated:'10. 2. 2026',tests:'247/247 ✓',tags:['Security','Sprint 7','Shell','WebSocket']},{name:'Worker System v2',status:'WIP',sprint:5,created:'20. 1. 2026',updated:'8. 2. 2026',tests:'180/195',tags:['Workers','Cron']},{name:'E2E Validation',status:'Done',sprint:4,created:'1. 2. 2026',updated:'6. 2. 2026',tests:'26/26 ✓',tags:['Tests','E2E']},{name:'Context Budgeting',status:'Active',sprint:4,created:'28. 1. 2026',updated:'9. 2. 2026',tests:'80/80 ✓',tags:['Context','Phase C']}];
var CONVERSATIONS=[{title:'Pomoz s server.js',preview:'Analyzuj router...',time:'14:32',expert:'Developer'},{title:'Historie Československa',preview:'Popiš historii ČSR...',time:'13:15',expert:'Výchozí'},{title:'Flutter build debug',preview:'Proč padá build...',time:'včera',expert:'Developer'},{title:'Účetní rozbor Q4',preview:'Zpracuj faktury...',time:'včera',expert:'Účetní'},{title:'API design review',preview:'Zreviduj REST API...',time:'2 dny',expert:'Architekt'},{title:'SEO analýza',preview:'Analyzuj SEO...',time:'3 dny',expert:'Researcher'}];
var SPECIALISTS=[{emoji:'📊',name:'Účetní',desc:'Daně, faktury, DPH',tags:['Finance','DPH']},{emoji:'⚖️',name:'Právník',desc:'Smlouvy, GDPR',tags:['Právo','GDPR']},{emoji:'📈',name:'Analytik',desc:'Data, statistiky',tags:['Data','Analýza']}];
var WORKERS=[{name:'Weather Monitor',status:'Running',cron:'*/30 * * * *',lastRun:'14:30',desc:'Počasí každých 30 min'},{name:'Realty Watcher',status:'Running',cron:'0 */2 * * *',lastRun:'14:00',desc:'Sledování nemovitostí'},{name:'News Digest',status:'Paused',cron:'0 8 * * *',lastRun:'08:00',desc:'Denní přehled zpráv'}];
var SETTINGS_SECTIONS=[{icon:'👤',title:'User / Identity',fields:[{l:'Jméno',v:'Belfik',t:'input'},{l:'E-mail',v:'belfik@c3.local',t:'input'},{l:'Role',v:'Developer',t:'select',opts:['Developer','Admin','User']}]},{icon:'🔔',title:'Notifications',fields:[{l:'Zvukové notifikace',v:true,t:'toggle'},{l:'Desktopové notifikace',v:true,t:'toggle'}]},{icon:'🎨',title:'Appearance',fields:[{l:'Téma'},{l:'Accent'},{l:'Pozadí'},{l:'Intenzita aktivní'},{l:'Intenzita neaktivní'},{l:'Velikost písma'},{l:'Písmo'}]},{icon:'🧠',title:'Memory & Context',fields:[{l:'Systémový prompt',v:'Vždy odpovídej v češtině.',t:'textarea'},{l:'Ukládat historii',v:true,t:'toggle'},{l:'Kontext',v:true,t:'toggle'}]},{icon:'📍',title:'Location',fields:[{l:'Město',v:'Praha',t:'input'},{l:'Země',v:'CZ',t:'input'},{l:'Jazyk',v:'Čeština',t:'select',opts:['Čeština','English']}]},{icon:'📄',title:'Output & Formats',fields:[{l:'Markdown výstup',v:true,t:'toggle'},{l:'Kódové bloky',v:true,t:'toggle'}]},{icon:'🖥️',title:'System',fields:[{l:'Model',v:'qwen2.5:32b',t:'select',opts:['qwen2.5:32b','llama3.1:70b','mistral:7b']},{l:'Ollama URL',v:'http://localhost:11434',t:'input'}]},{icon:'ℹ️',title:'About',fields:[]}];
var FILES=[{n:'src',d:true,i:0},{n:'server.js',d:false,i:1,a:true,st:'M',p:'src'},{n:'router.js',d:false,i:1,st:'M',p:'src'},{n:'chat',d:true,i:1,p:'src'},{n:'handler.js',d:false,i:2,st:'A',p:'chat'},{n:'context.js',d:false,i:2,p:'chat'},{n:'planner',d:true,i:1,p:'src'},{n:'engine.js',d:false,i:2,p:'planner'},{n:'tests',d:true,i:0},{n:'e2e.test.js',d:false,i:1,st:'M',p:'tests'},{n:'unit.test.js',d:false,i:1,p:'tests'},{n:'design',d:true,i:0},{n:'mockups.fig',d:false,i:1,p:'design'},{n:'architecture.md',d:false,i:0,st:'M'},{n:'package.json',d:false,i:0},{n:'.env',d:false,i:0}];
var _collapsedDirs={};var _wtPath='';
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:12,recent:['Pomoz s server.js','Historie ČSR','Flutter debug']},{id:'projects',label:'Projekty',icon:'folder',badge:4,recent:['Security Hardening','Worker v2']},{id:'specialists',label:'Specialisté',icon:'users',recent:['Účetní']},{id:'experts',label:'Experti',icon:'expert',badge:9,recent:['Výchozí','Developer','Účetní']},{id:'workers',label:'Workeri',icon:'worker',badge:3,recent:['Weather','Realty']}];

/* ═══ LIVE DATA FETCH ═══ */
var _backendBase='http://localhost:3335';
function fetchBackendData(){
  fetch(_backendBase+'/api/projects',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.projects||data.items||[]);
    if(items.length>0){PROJECTS=items.slice(0,20).map(function(p){var sp=p.sprint;if(sp&&typeof sp==='object')sp=sp.value||sp.number||0;return{id:p.id,name:_s(p.name||p.title)||'Project',status:_s(p.status)||'Active',sprint:Number(sp)||0,created:_s(p.createdAt||p.created)||'',updated:_s(p.updatedAt||p.updated)||'',tests:_s(p.tests)||'',tags:Array.isArray(p.tags)?p.tags:[]};});
    NAV[1].badge=PROJECTS.length;NAV[1].recent=PROJECTS.slice(0,3).map(function(p){return p.name;});renderCenter();}
  }).catch(function(){});
  fetch(_backendBase+'/api/conversations',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.conversations||data.items||[]);
    if(items.length>0){CONVERSATIONS=items.slice(0,20).map(function(c){return{id:c.id,title:_s(c.title||c.name)||'Chat',preview:_s(c.preview||c.lastMessage)||'',time:_s(c.time||c.updatedAt)||'',expert:_s(c.expert)||'Výchozí'};});
    NAV[0].badge=CONVERSATIONS.length;NAV[0].recent=CONVERSATIONS.slice(0,3).map(function(c){return c.title;});renderCenter();}
  }).catch(function(){});
  fetch(_backendBase+'/api/experts',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.experts||[]);
    if(items.length>0){var _localEx={};EXPERTS.forEach(function(le){_localEx[le.name]=le;});EXPERTS=items.map(function(e){var nm=_s(e.name);var le=_localEx[nm];return{id:e.id,emoji:_s(e.emoji)||(le&&le.emoji?le.emoji:'🤖'),name:nm,desc:_s(e.description||e.desc)||(le?le.desc:''),fav:e.favorite!=null?!!e.favorite:(le?!!le.fav:false)};});
    NAV[3].badge=EXPERTS.length;NAV[3].recent=EXPERTS.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;});renderCenter();}
  }).catch(function(){});
  fetch(_backendBase+'/api/agents',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.agents||[]);
    if(items.length>0){WORKERS=items.map(function(a){return{id:a.id,name:_s(a.name),status:a.enabled===false?'Paused':(_s(a.status)||'Running'),cron:_s(a.schedule||a.cron)||'',lastRun:_s(a.lastRun)||'',desc:_s(a.description||a.desc)||''};});
    NAV[4].badge=WORKERS.length;NAV[4].recent=WORKERS.slice(0,3).map(function(w){return w.name;});renderCenter();}
  }).catch(function(){});
}
setTimeout(fetchBackendData,1500);
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
        ss.textContent='.theia-sidepanel-toolbar{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;visibility:hidden!important;opacity:0!important;}.theia-sidepanel-toolbar~*{top:0!important;height:100%!important;}.lm-TabBar-toolbar{display:none!important;height:0!important;overflow:hidden!important;}#theia-right-side-panel .lm-TabBar~*,#theia-bottom-content-panel .lm-TabBar~*{top:0!important;height:100%!important;}#theia-right-side-panel .lm-DockPanel-widget,#theia-bottom-content-panel .lm-DockPanel-widget{top:0!important;height:100%!important;}.lm-Widget:focus,.lm-Widget:focus-visible,#c3-sidebar:focus,#c3-chat-panel:focus,#c3-agent-panel:focus{outline:none!important;box-shadow:none!important;}*:focus-visible{outline:none!important;}#theia-top-panel,.p-MenuBar,#theia\\:menubar,.theia-app-header{background:var(--c3-bg1,#111114)!important;border-color:var(--c3-border,rgba(255,255,255,0.06))!important;}#theia-left-side-panel,#theia-right-side-panel,#theia-bottom-content-panel{background:var(--c3-bg1,#111114)!important;}input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:var(--c3-bg4,#27282e);outline:none;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--c3-accent,#22c55e);cursor:pointer;border:2px solid var(--c3-bg1,#111114);}body{border:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;box-sizing:border-box!important;}#theia-right-side-panel{border-left:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}#theia-bottom-content-panel{border-top:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}';
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
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:11},title:'O úroveň výš',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){/* collapse all top-level dirs */FILES.forEach(function(f){if(f.d&&!f.p)_collapsedDirs[f.n]=true;});renderSidebar();}},'↑'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:12},title:'Nový soubor',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){FILES.push({n:'untitled.js',d:false,i:0,st:'A'});renderSidebar();}},'📄'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:12},title:'Nová složka',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){FILES.push({n:'new-folder',d:true,i:0});renderSidebar();}},'📁'))),
      (function(){
        var stColors={M:C.accentText,A:'#22d3ee',D:'#ef4444',U:'#f97316'};
        /* Build set of all collapsed ancestor chains */
        function _isHidden(f){
          if(!f.p)return false;
          if(_collapsedDirs[f.p])return true;
          /* check grandparent: find parent dir entry */
          var parEntry=FILES.find(function(x){return x.d&&x.n===f.p;});
          return parEntry?_isHidden(parEntry):false;
        }
        return FILES.filter(function(f){return!_isHidden(f);}).map(function(f,i){
          var isCol=f.d&&_collapsedDirs[f.n];
          return h('div',{key:f.n+i,style:{display:'flex',alignItems:'center',gap:4,paddingLeft:(8+f.i*14),paddingRight:8,paddingTop:3,paddingBottom:3,borderRadius:4,fontSize:12,color:f.a?C.accentText:C.tx2,background:f.a?C.accentBg:'transparent',cursor:'pointer'},
            onMouseEnter:function(e){if(!f.a)e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background=f.a?C.accentBg:'transparent';},
            onClick:function(){if(f.d){_collapsedDirs[f.n]=!_collapsedDirs[f.n];renderSidebar();}else{FILES.forEach(function(x){x.a=false;});f.a=true;renderSidebar();}}},
            f.d?h('span',{style:{fontSize:8,color:C.tx4,width:10,textAlign:'center',flexShrink:0}},isCol?'▶':'▼'):h('span',{style:{width:10,flexShrink:0}}),
            h('span',{style:{flexShrink:0,fontSize:13}},f.d?'📁':'📄'),
            h('span',{style:{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},f.n),
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
var _centerContainer=null;
function renderCenter(){if(!_centerContainer)return;ReactDOM.render(h(CenterApp,null),_centerContainer);}

function CenterApp(){
  var view=_centerState.view,detail=_centerState.detail;
  return h('div',{style:{display:'flex',height:'100%',width:'100%',background:C.bg0,fontFamily:C.font,overflow:'hidden',position:'absolute',top:0,left:0,right:0,bottom:0}},
    h('div',{style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
      view==='experts'?centerExperts():view==='projects'?centerProjects():view==='chats'?centerConvos():
      view==='specialists'?centerSpecs():view==='workers'?centerWorkers():view==='settings'?centerSettings():centerWelcome()),
    detail?centerDetail():null);
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
  var tpl={experts:{name:'Nový expert',fields:[{k:'Typ',v:''},{k:'Emoji',v:'🆕'}],tags:['Expert'],actions:['Uložit','Zrušit'],editing:true,_isNew:true},
    projects:{name:'Nový projekt',fields:[{k:'Status',v:'Active'},{k:'Sprint',v:''},{k:'Vytvořeno',v:new Date().toLocaleDateString('cs-CZ')}],tags:[],actions:['Uložit','Zrušit'],editing:true,_isNew:true},
    chats:{name:'Nová konverzace',fields:[{k:'Expert',v:'Výchozí'}],tags:['Chat'],actions:['Uložit','Zrušit'],editing:true,_isNew:true},
    specialists:{name:'Nový specialista',fields:[{k:'Oblast',v:''}],tags:[],actions:['Uložit','Zrušit'],editing:true,_isNew:true},
    workers:{name:'Nový worker',fields:[{k:'Status',v:'Paused'},{k:'Cron',v:''},{k:'Popis',v:''}],tags:['Worker'],actions:['Uložit','Zrušit'],editing:true,_isNew:true}};
  setDetail(tpl[view]||tpl.experts);
}

function centerExperts(){return h(React.Fragment,null,viewHead('Experti',true,function(){_addNew('experts');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(EXPERTS.map(function(e){return card(e,function(){setDetail({name:e.name,fields:[{k:'Typ',v:e.desc},{k:'Emoji',v:e.emoji},{k:'Oblíbený',v:e.fav,type:'fav',_expertName:e.name}],tags:['Expert',e.desc],actions:['Otevřít','Editovat']});});}))));}

function centerProjects(){return h(React.Fragment,null,viewHead('Projekty',true,function(){_addNew('projects');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(PROJECTS.map(function(p){return card(p,function(){setDetail({name:p.name,fields:[{k:'Status',v:p.status,a:p.status==='Active'},{k:'Sprint',v:p.sprint},{k:'Vytvořeno',v:p.created},{k:'Aktualizováno',v:p.updated},{k:'Testy',v:p.tests}],tags:p.tags,actions:['Otevřít','Editovat','Archivovat']});});}))));}

function centerConvos(){return h(React.Fragment,null,viewHead('Konverzace',true,function(){_addNew('chats');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(CONVERSATIONS.map(function(c){return h('div',{key:c.title,onClick:function(){setDetail({name:c.title,fields:[{k:'Expert',v:c.expert},{k:'Čas',v:c.time}],tags:['Chat',c.expert],actions:['Otevřít','Archivovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===c.title?C.accent:C.border),borderRadius:12,padding:14,cursor:'pointer',display:'flex',gap:10}},h('div',{style:{width:26,height:26,borderRadius:'50%',background:C.bg4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,flexShrink:0}},'💬'),h('div',{style:{flex:1,minWidth:0}},h('div',{style:{fontSize:12.5,fontWeight:700,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.title),h('div',{style:{fontSize:11,color:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.preview)),h('span',{style:{fontSize:10,color:C.tx4,flexShrink:0}},c.time));}))));}

function centerSpecs(){return h(React.Fragment,null,viewHead('Specialisté',true,function(){_addNew('specialists');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(SPECIALISTS.map(function(s){return card(s,function(){setDetail({name:s.name,fields:[{k:'Oblast',v:s.desc}],tags:s.tags,actions:['Otevřít','Editovat']});});}))));}

function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',true,function(){_addNew('workers');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(WORKERS.map(function(w){return h('div',{key:w.name,onClick:function(){setDetail({name:w.name,fields:[{k:'Status',v:w.status,a:w.status==='Running'},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:['Spustit','Pozastavit','Editovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===w.name?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer'}},h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:6}},h('span',{style:{fontSize:18}},'⚙️'),h('span',{style:{fontSize:13,fontWeight:700,color:C.tx1,flex:1}},w.name),pill(w.status)),h('div',{style:{fontSize:11,color:C.tx3}},_s(w.desc)),h('div',{style:{fontSize:10,color:C.tx4,marginTop:6,fontFamily:C.mono}},'cron: '+_s(w.cron)));}))));}

/* Settings state */
var _settingsVals={theme:'dark',accentIdx:0,activeInt:100,passiveInt:50,fontSizeVal:13,fontIdx:0,custom1:null,custom2:null,bgIdx:0,bgCustom1:null,bgCustom2:null};
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
  document.body.style.fontSize=fs+'px';document.body.style.fontFamily=ff.val;
  ['c3-center-mount','c3-sidebar','c3-chat-panel','c3-agent-panel'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.style.zoom='';el.style.fontFamily=ff.val;}});
}
function _applyAllSettings(){_applyTheme();_applyAccent();_applyFont();renderCenter();renderChat();renderAgent();if(typeof renderSidebar==='function')renderSidebar();}
/* Apply saved settings on load */
_applyTheme();_applyAccent();setTimeout(function(){_applyFont();_applyAllSettings();},600);

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
        h('span',{style:{fontSize:12,fontFamily:ff.val,color:sel?C.accentText:C.tx2}},ff.label));})));
}

function centerWelcome(){return h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}},h('div',{style:{width:48,height:48,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:20,color:'#fff'}},'C3'),h('div',{style:{fontSize:16,fontWeight:700,color:C.tx1}},'C3 Studio'),h('div',{style:{fontSize:12,color:C.tx3}},'Vyber sekci v levém panelu'));}

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
          if(conv.id){fetch(_backendBase+'/api/conversations/'+conv.id+'/messages',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(msgs){
            var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);if(items.length>0){_ts.chat.msgs=[{role:'system',text:'📂 Konverzace: '+conv.title}];items.forEach(function(m){_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||''});});renderChat();_chatScrollPane(_ti);}}).catch(function(){});}
        }
        var proj=PROJECTS.find(function(p){return p.name===d.name;});
        if(proj){c3.agentLog('TOOL','📁 Otevřen projekt: '+proj.name+(proj.sprint?' (Sprint '+proj.sprint+')':'')+(proj.tests?' — Testy: '+_s(proj.tests):''));
          if(proj.id){fetch(_backendBase+'/api/projects/'+proj.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(pd){if(pd.description)c3.agentLog('TOOL',_s(pd.description));}).catch(function(){});}
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
        if(itemId&&ep){fetch(_backendBase+ep+itemId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','💾 Uloženo: '+d.name);fetchBackendData();}).catch(function(){c3.agentLog('TOOL','💾 Uloženo lokálně: '+d.name);});}
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

/* Nav event handler */
window.addEventListener('c3-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;_centerState.settingsSection=null;renderCenter();
  if(e.detail.select){
    var name=e.detail.select,view=e.detail.view,item=null;
    if(view==='experts'){item=EXPERTS.find(function(x){return x.name===name||x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Typ',v:item.desc},{k:'Emoji',v:item.emoji},{k:'Oblíbený',v:item.fav?'Ano':'Ne'}],tags:['Expert',item.desc],actions:['Otevřít','Editovat']});}
    else if(view==='projects'){item=PROJECTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Status',v:item.status,a:item.status==='Active'},{k:'Sprint',v:item.sprint},{k:'Vytvořeno',v:item.created}],tags:item.tags,actions:['Otevřít','Editovat','Archivovat']});}
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
  chat:{msgs:[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}],ctx:0,expert:'Výchozí',showExperts:false,showAllExperts:false,attachments:[],editMode:'auto',acSuggestion:null,acLoading:false},
  bottom:'split', /* 'agent' | 'terminal' | 'split' | 'mix' */
  log:[],
  term:[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}]
};}
var _sessions=[_mkSession(),_mkSession()];
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

  /* Edit requests (ask mode) */
  C3Bus.on('edit:request', function(ev) {
    var si = ev.sessionIdx;
    var s = _sessions[si] || _sessions[0];
    var d = ev.event || {};
    if (s.chat.editMode === 'ask') {
      var reqId = d.payload ? d.payload.requestId || d.id : d.requestId || ('er-' + Date.now());
      if (typeof C3WS !== 'undefined') C3WS.trackEditRequest(reqId, d.payload ? d.payload.file : d.file, d.payload ? d.payload.diff : d.diff, si);
      s.chat.msgs.push({role:'assistant', text:'✋ Chci editovat: ' + (d.payload ? d.payload.file : d.file) + '\n```\n' + (d.payload ? d.payload.diff : d.diff) + '\n```', tag:'EDIT', _editReqId: reqId});
      renderChat(); _chatScrollPane(si);
    }
  });

  /* Edit resolved */
  C3Bus.on('edit:resolved', function(ev) {
    renderChat(); renderAgent();
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
function _chatAutocomplete(idx){
  var ta=document.getElementById('c3-chat-ta-'+idx);
  var s=_sessions[idx];if(!s||!ta)return;var st=s.chat;
  var partial=ta.value;if(!partial.trim()){return;}
  /* If there's already a suggestion showing, accept it */
  if(st.acSuggestion){ta.value=partial+st.acSuggestion;st.acSuggestion=null;ta.style.height='20px';ta.style.height=Math.min(ta.scrollHeight,100)+'px';renderChat();return;}
  st.acLoading=true;renderChat();
  fetch(_backendBase+'/api/autocomplete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partial:partial,expert:st.expert,context:st.msgs.slice(-6).map(function(m){return{role:m.role,text:m.text};})}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){st.acLoading=false;if(d.suggestion){st.acSuggestion=d.suggestion;renderChat();}else{renderChat();}})
  .catch(function(){st.acLoading=false;renderChat();});
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
    fetch(_backendBase+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'chat',message:txt,expert:st.expert,editMode:st.editMode,conversationId:s._convId})})
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
        /* Autocomplete ghost text */
        st.acSuggestion?h('div',{style:{padding:'2px 8px 0',fontSize:11,color:C.tx4,fontStyle:'italic',opacity:0.6,cursor:'pointer'},
          onClick:function(ev){ev.stopPropagation();_chatAutocomplete(idx);}},
          '⇥ '+st.acSuggestion):null,
        st.acLoading?h('div',{style:{padding:'2px 8px 0',fontSize:10,color:C.tx4}},
          '⏳ Načítám návrh...'):null,
        h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 6px 5px',borderTop:'1px solid '+C.border}},
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22},title:'Připojit soubor',
            onClick:function(ev){ev.stopPropagation();var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var j=0;j<inp.files.length;j++){st.attachments.push({name:inp.files[j].name,size:Math.round(inp.files[j].size/1024)+' KB',file:inp.files[j]});}renderChat();}document.body.removeChild(inp);};inp.click();}},svgEl(I.attach,12)),
          /* Edit mode toggle */
          h('div',{style:{display:'flex',alignItems:'center',gap:1,padding:'1px 2px',borderRadius:4,background:C.bg3,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:9,fontWeight:600,cursor:'pointer',color:st.editMode==='auto'?C.tx1:C.tx4,background:st.editMode==='auto'?C.bg4:'transparent'},
              onClick:function(){st.editMode='auto';renderChat();_persistSessionState();},title:'Agent edituje soubory automaticky'},'▶▶ Auto'),
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:9,fontWeight:600,cursor:'pointer',color:st.editMode==='ask'?C.tx1:C.tx4,background:st.editMode==='ask'?C.bg4:'transparent'},
              onClick:function(){st.editMode='ask';renderChat();_persistSessionState();},title:'Agent se zeptá před každou editací'},'✋ Dotaz')),
          h('span',{style:{flex:1,fontSize:9,color:C.tx4,opacity:0.5,padding:'0 3px',textAlign:'center'}},'Tab ⇥'),
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
    return h('div',{key:i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:11,lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
      h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
      h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
      h('span',{style:{color:C.tx2}},e.text));}));
}
function _terminalContent(s){
  return h('div',{style:{flex:1,overflowY:'auto',padding:'5px 10px',fontFamily:C.mono,fontSize:11.5,lineHeight:'1.6',color:C.tx2}},
    s.term.map(function(t,i){
      return h('div',{key:i},t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
        t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
    }));
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
/* split mode: agent log left, terminal right */
function _splitContent(s){
  return h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
    h('div',{style:{flex:1,borderRight:'1px solid '+C.border,overflow:'hidden',display:'flex'}},_agentLogContent(s)),
    h('div',{style:{flex:1,overflow:'hidden',display:'flex'}},_terminalContent(s)));
}

function _bottomPane(idx){
  var s=_sessions[idx];if(!s)return null;
  var mode=s.bottom||'split';
  /* Split/Mix together, then gap, then Terminal/Log */
  var grpA=[{k:'split',l:'Split'},{k:'mix',l:'Mix'}];
  var grpB=[{k:'terminal',l:'Terminal'},{k:'agent',l:'Log'}];
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
      h('span',{style:{fontSize:9,color:C.tx4,padding:'0 6px',alignSelf:'center'}},''+(idx+1))),
    /* Panel content */
    mode==='split'?_splitContent(s):mode==='agent'?_agentLogContent(s):mode==='terminal'?_terminalContent(s):_mixedContent(s));
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
