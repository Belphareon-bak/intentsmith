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

/* ═══ COLORS ═══ */
var C={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',
  tx1:'#ececef',tx2:'#a1a1aa',tx3:'#71717a',tx4:'#52525b',
  accent:'#22c55e',accentText:'#4ade80',accentBg:'rgba(34,197,94,0.08)',
  red:'#f87171',redBg:'rgba(239,68,68,0.1)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
  blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
  cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
  border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)',
  font:"'Plus Jakarta Sans',-apple-system,sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"};

function svg(p,w){return '<svg width="'+(w||14)+'" height="'+(w||14)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
function svgEl(p,w){return h('span',{style:{display:'inline-flex',alignItems:'center'},dangerouslySetInnerHTML:{__html:svg(p,w)}});}

var I={chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',expert:'<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',worker:'<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09"/>',chevDown:'<polyline points="6 9 12 15 18 9"/>',plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',split:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',close:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'};

/* ═══ DATA ═══ */
var EXPERTS=[{emoji:'🤖',name:'Výchozí',desc:'Univerzální AI',fav:true},{emoji:'📊',name:'Účetní',desc:'Faktury, DPH',fav:true},{emoji:'💻',name:'Developer',desc:'Kód, debugging',fav:true},{emoji:'✍️',name:'Copywriter',desc:'Texty'},{emoji:'🏗️',name:'Architekt',desc:'Design'},{emoji:'🔬',name:'Researcher',desc:'Analýza'},{emoji:'📋',name:'PM',desc:'Projekty'},{emoji:'🎨',name:'Designer',desc:'UI/UX'},{emoji:'🛡️',name:'Security',desc:'Audit'}];
var PROJECTS=[{name:'Security Hardening',status:'Active',sprint:7,created:'5. 2. 2026',updated:'10. 2. 2026',tests:'247/247 ✓',tags:['Security','Sprint 7','Shell','WebSocket']},{name:'Worker System v2',status:'WIP',sprint:5,created:'20. 1. 2026',updated:'8. 2. 2026',tests:'180/195',tags:['Workers','Cron']},{name:'E2E Validation',status:'Done',sprint:4,created:'1. 2. 2026',updated:'6. 2. 2026',tests:'26/26 ✓',tags:['Tests','E2E']},{name:'Context Budgeting',status:'Active',sprint:4,created:'28. 1. 2026',updated:'9. 2. 2026',tests:'80/80 ✓',tags:['Context','Phase C']}];
var CONVERSATIONS=[{title:'Pomoz s server.js',preview:'Analyzuj router...',time:'14:32',expert:'Developer'},{title:'Historie Československa',preview:'Popiš historii ČSR...',time:'13:15',expert:'Výchozí'},{title:'Flutter build debug',preview:'Proč padá build...',time:'včera',expert:'Developer'},{title:'Účetní rozbor Q4',preview:'Zpracuj faktury...',time:'včera',expert:'Účetní'},{title:'API design review',preview:'Zreviduj REST API...',time:'2 dny',expert:'Architekt'},{title:'SEO analýza',preview:'Analyzuj SEO...',time:'3 dny',expert:'Researcher'}];
var SPECIALISTS=[{emoji:'📊',name:'Účetní',desc:'Daně, faktury, DPH',tags:['Finance','DPH']},{emoji:'⚖️',name:'Právník',desc:'Smlouvy, GDPR',tags:['Právo','GDPR']},{emoji:'📈',name:'Analytik',desc:'Data, statistiky',tags:['Data','Analýza']}];
var WORKERS=[{name:'Weather Monitor',status:'Running',cron:'*/30 * * * *',lastRun:'14:30',desc:'Počasí každých 30 min'},{name:'Realty Watcher',status:'Running',cron:'0 */2 * * *',lastRun:'14:00',desc:'Sledování nemovitostí'},{name:'News Digest',status:'Paused',cron:'0 8 * * *',lastRun:'08:00',desc:'Denní přehled zpráv'}];
var SETTINGS_SECTIONS=[{icon:'👤',title:'User / Identity',fields:[{l:'Jméno',v:'Belfik',t:'input'},{l:'E-mail',v:'belfik@c3.local',t:'input'},{l:'Role',v:'Developer',t:'select',opts:['Developer','Admin','User']}]},{icon:'🔔',title:'Notifications',fields:[{l:'Zvukové notifikace',v:true,t:'toggle'},{l:'Desktopové notifikace',v:true,t:'toggle'}]},{icon:'🎨',title:'Appearance',fields:[{l:'Téma',v:'dark',t:'radio',opts:['Dark','Light','System']}]},{icon:'🧠',title:'Memory & Context',fields:[{l:'Systémový prompt',v:'Vždy odpovídej v češtině.',t:'textarea'},{l:'Ukládat historii',v:true,t:'toggle'},{l:'Kontext',v:true,t:'toggle'}]},{icon:'📍',title:'Location',fields:[{l:'Město',v:'Praha',t:'input'},{l:'Země',v:'CZ',t:'input'},{l:'Jazyk',v:'Čeština',t:'select',opts:['Čeština','English']}]},{icon:'📄',title:'Output & Formats',fields:[{l:'Markdown výstup',v:true,t:'toggle'},{l:'Kódové bloky',v:true,t:'toggle'}]},{icon:'🖥️',title:'System',fields:[{l:'Model',v:'qwen2.5:32b',t:'select',opts:['qwen2.5:32b','llama3.1:70b','mistral:7b']},{l:'Ollama URL',v:'http://localhost:11434',t:'input'}]},{icon:'ℹ️',title:'About',fields:[]}];
var FILES=[{n:'src',d:true,i:0},{n:'server.js',d:false,i:1,a:true},{n:'router.js',d:false,i:1},{n:'chat',d:true,i:1},{n:'planner',d:true,i:1},{n:'tests',d:true,i:0},{n:'design',d:true,i:0},{n:'architecture.md',d:false,i:1},{n:'package.json',d:false,i:0}];
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:12,recent:['Pomoz s server.js','Historie ČSR','Flutter debug']},{id:'projects',label:'Projekty',icon:'folder',badge:4,recent:['Security Hardening','Worker v2']},{id:'specialists',label:'Specialisté',icon:'users',recent:['Účetní']},{id:'experts',label:'Experti',icon:'expert',badge:9,recent:['Výchozí','Developer','Účetní']},{id:'workers',label:'Workeri',icon:'worker',badge:3,recent:['Weather','Realty']}];


/* ═══════════════════════════════════════════════════════════
   1. SIDEBAR WIDGET (ReactWidget — read-only, update() is fine)
   ═══════════════════════════════════════════════════════════ */
var C3_SIDEBAR_ID='c3-sidebar';

class C3SidebarWidget extends react_widget_1.ReactWidget {
  constructor(){
    super();this.id=C3_SIDEBAR_ID;this.title.label='C3';this.title.iconClass='codicon codicon-layout-sidebar-left';this.title.closable=false;this.node.tabIndex=0;
    this._active='chats';this._dd={};
  }
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render */}
  onAfterAttach(){
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
      /* Repeat after layout finishes */
      setTimeout(function(){
        document.querySelectorAll('.theia-app-sidebar-container').forEach(function(el){
          el.style.cssText='display:none!important;width:0!important;min-width:0!important;';
        });
        document.querySelectorAll('.theia-app-sides').forEach(function(el){
          el.style.cssText='display:none!important;width:0!important;';
        });
      },1000);
    },500);
  }
  _render(){
    var self=this;
    ReactDOM.render(h(SidebarApp,{getState:function(){return{active:self._active,dd:self._dd};},setState:function(s){if(s.active!==undefined)self._active=s.active;if(s.dd!==undefined)self._dd=s.dd;self._render();}}),this.node);
  }
}
inversify_1.decorate(inversify_1.injectable(),C3SidebarWidget);

function SidebarApp(props){
  var s=props.getState(),set=props.setState;
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden'}},
    /* Brand */
    h('div',{style:{padding:'8px 14px',display:'flex',alignItems:'center',gap:8,flexShrink:0}},
      h('div',{style:{width:26,height:26,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:11,color:'#fff',flexShrink:0}},'C3'),
      h('span',{style:{fontSize:14,fontWeight:700,color:C.tx1}},'C3 Studio')),
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
      h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.6px',padding:'8px 12px 4px'}},'Working Tree'),
      FILES.map(function(f,i){return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:5,paddingLeft:(10+f.i*14),paddingRight:10,paddingTop:3,paddingBottom:3,borderRadius:4,fontSize:12,color:f.a?C.accentText:C.tx2,background:f.a?C.accentBg:'transparent',cursor:'pointer'}},(f.d?'📁 ':'📄 ')+f.n);})
    ),
    /* Settings bottom */
    h('div',{style:{padding:'8px 8px',borderTop:'1px solid '+C.border,flexShrink:0}},
      h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent'},
        onClick:function(){set({active:'settings',dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:'settings'}}));}},
        svgEl(I.settings,18),h('span',{style:{fontSize:13.5,fontWeight:600}},'Nastavení'))));
}


/* ═══════════════════════════════════════════════════════════
   2. CENTER VIEW (ReactDOM.render into main panel)
   ═══════════════════════════════════════════════════════════ */
var _centerState={view:'experts',detail:null,openSections:{},zoom:1};
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

function viewHead(t,showZoom){
  return h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
    h('span',{style:{fontSize:15,fontWeight:700,color:C.tx1,flex:1}},t),
    showZoom?h('div',{style:{display:'flex',alignItems:'center',gap:6}},
      svgEl('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',14),
      h('input',{type:'range',min:0,max:2,step:1,value:_centerState.zoom,onChange:function(e){_centerState.zoom=parseInt(e.target.value);renderCenter();},
        style:{width:60,accentColor:C.accent,cursor:'pointer'}}),
      svgEl('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',14)
    ):null);
}

function card(item,onClick){
  var sel=_centerState.detail&&_centerState.detail.name===item.name;
  return h('div',{key:item.name,onClick:onClick,style:{background:C.bg2,border:'1px solid '+(sel?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer',position:'relative',overflow:'hidden',transition:'border-color 0.15s'},
    onMouseEnter:function(e){if(!sel)e.currentTarget.style.borderColor=C.border2;},onMouseLeave:function(e){if(!sel)e.currentTarget.style.borderColor=C.border;}},
    h('div',{style:{position:'absolute',top:0,left:0,right:0,height:3,background:sel?C.accent:'transparent'}}),
    item.emoji?h('div',{style:{display:'flex',alignItems:'center',gap:12}},
      h('span',{style:{fontSize:22}},item.emoji),
      h('div',{style:{flex:1,minWidth:0}},h('div',{style:{fontSize:13,fontWeight:700,color:C.tx1}},item.name),h('div',{style:{fontSize:11,color:C.tx3}},item.desc)),
      item.fav!==undefined?h('span',{style:{fontSize:14,color:item.fav?C.accentText:C.tx4}},item.fav?'★':'☆'):null
    ):h('div',null,h('div',{style:{fontSize:13,fontWeight:700,color:C.tx1,marginBottom:3}},item.name),
      item.desc?h('div',{style:{fontSize:11,color:C.tx3,lineHeight:'1.4',marginBottom:8}},item.desc):null,
      item.status?h('div',{style:{display:'flex',alignItems:'center',gap:6}},pill(item.status),item.sprint?h('span',{style:{fontSize:10,color:C.tx4}},'Sprint '+item.sprint):null):null));
}

function pill(s){var m={Active:{b:'rgba(34,197,94,0.1)',c:C.accentText},Done:{b:C.blueBg,c:C.blue},WIP:{b:C.amberBg,c:C.amber},Running:{b:'rgba(34,197,94,0.1)',c:C.accentText},Paused:{b:C.amberBg,c:C.amber}};var v=m[s]||{b:C.bg4,c:C.tx3};return h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:9,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',fontFamily:C.mono,background:v.b,color:v.c}},s);}

function grid(items,cols){return h('div',{style:{display:'grid',gridTemplateColumns:'repeat('+(cols||3)+',1fr)',gap:12}},items);}

function getZoomCols(base){var z=_centerState.zoom;return z===0?base+1:z===2?Math.max(1,base-1):base;}

function setDetail(d){_centerState.detail=d;renderCenter();}

function centerExperts(){return h(React.Fragment,null,viewHead('Experti',true),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(EXPERTS.map(function(e){return card(e,function(){setDetail({name:e.name,fields:[{k:'Typ',v:e.desc},{k:'Emoji',v:e.emoji},{k:'Oblíbený',v:e.fav?'Ano':'Ne'}],tags:['Expert',e.desc],actions:['Otevřít','Editovat']});});}),getZoomCols(3))));}

function centerProjects(){return h(React.Fragment,null,viewHead('Projekty',true),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(PROJECTS.map(function(p){return card(p,function(){setDetail({name:p.name,fields:[{k:'Status',v:p.status,a:p.status==='Active'},{k:'Sprint',v:p.sprint},{k:'Vytvořeno',v:p.created},{k:'Aktualizováno',v:p.updated},{k:'Testy',v:p.tests}],tags:p.tags,actions:['Otevřít','Editovat','Archivovat']});});}),getZoomCols(2))));}

function centerConvos(){return h(React.Fragment,null,viewHead('Konverzace',true),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(CONVERSATIONS.map(function(c){return h('div',{key:c.title,onClick:function(){setDetail({name:c.title,fields:[{k:'Expert',v:c.expert},{k:'Čas',v:c.time}],tags:['Chat',c.expert],actions:['Otevřít','Archivovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===c.title?C.accent:C.border),borderRadius:12,padding:14,cursor:'pointer',display:'flex',gap:10}},h('div',{style:{width:26,height:26,borderRadius:'50%',background:C.bg4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,flexShrink:0}},'💬'),h('div',{style:{flex:1,minWidth:0}},h('div',{style:{fontSize:12.5,fontWeight:700,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.title),h('div',{style:{fontSize:11,color:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},c.preview)),h('span',{style:{fontSize:10,color:C.tx4,flexShrink:0}},c.time));}),getZoomCols(2))));}

function centerSpecs(){return h(React.Fragment,null,viewHead('Specialisté',true),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(SPECIALISTS.map(function(s){return card(s,function(){setDetail({name:s.name,fields:[{k:'Oblast',v:s.desc}],tags:s.tags,actions:['Otevřít','Editovat']});});}),getZoomCols(3))));}

function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',true),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(WORKERS.map(function(w){return h('div',{key:w.name,onClick:function(){setDetail({name:w.name,fields:[{k:'Status',v:w.status,a:w.status==='Running'},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:['Spustit','Pozastavit','Editovat']});},style:{background:C.bg2,border:'1px solid '+(_centerState.detail&&_centerState.detail.name===w.name?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer'}},h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:6}},h('span',{style:{fontSize:18}},'⚙️'),h('span',{style:{fontSize:13,fontWeight:700,color:C.tx1,flex:1}},w.name),pill(w.status)),h('div',{style:{fontSize:11,color:C.tx3}},w.desc),h('div',{style:{fontSize:10,color:C.tx4,marginTop:6,fontFamily:C.mono}},'cron: '+w.cron));}),getZoomCols(2))));}

function centerSettings(){return h('div',{style:{flex:1,overflowY:'auto'}},h('div',{style:{padding:'20px 20px',maxWidth:700}},h('h1',{style:{fontSize:20,fontWeight:700,margin:'0 0 3px',color:C.tx1}},'Nastavení'),h('p',{style:{fontSize:12,color:C.tx3,margin:'0 0 18px'}},'Konfigurace C3 Studio'),SETTINGS_SECTIONS.map(function(sec,si){var isO=_centerState.openSections[si];return h('div',{key:si,style:{borderBottom:'1px solid '+C.border}},h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'10px 2px',cursor:'pointer',borderRadius:6},onClick:function(){_centerState.openSections[si]=!_centerState.openSections[si];renderCenter();}},h('span',{style:{fontSize:14,width:18,textAlign:'center'}},sec.icon),h('span',{style:{flex:1,fontSize:13,fontWeight:600,color:C.tx1}},sec.title),h('span',{style:{transform:isO?'rotate(180deg)':'none',transition:'transform 0.2s',display:'flex'}},svgEl(I.chevDown,13))),isO?h('div',{style:{padding:'2px 2px 12px 26px'}},sec.title==='About'?h('div',{style:{textAlign:'center'}},h('div',{style:{width:32,height:32,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:9,display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:13,color:'#fff'}},'C3'),h('p',{style:{fontSize:12,margin:'6px 0 0',color:C.tx3}},'v0.1.0 · Made with ❤️ by Belfik')):sec.fields.map(function(f,fi){return h('div',{key:fi},h('label',{style:{fontSize:11,fontWeight:600,color:C.tx2,margin:'8px 0 4px',display:'block'}},f.l),f.t==='input'?h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',boxSizing:'border-box'},defaultValue:f.v}):f.t==='textarea'?h('textarea',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',resize:'vertical',lineHeight:'1.5',minHeight:60,boxSizing:'border-box'},defaultValue:f.v}):f.t==='select'?h('select',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:12,outline:'none',boxSizing:'border-box'},defaultValue:f.v},(f.opts||[]).map(function(o){return h('option',{key:o},o);})):f.t==='toggle'?h('label',{style:{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer',fontSize:12,color:C.tx2}},h('input',{type:'checkbox',defaultChecked:f.v}),f.l):null);})):null);})));}

function centerWelcome(){return h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}},h('div',{style:{width:48,height:48,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:20,color:'#fff'}},'C3'),h('div',{style:{fontSize:16,fontWeight:700,color:C.tx1}},'C3 Studio'),h('div',{style:{fontSize:12,color:C.tx3}},'Vyber sekci v levém panelu'));}

function centerDetail(){var d=_centerState.detail;return h('div',{style:{width:280,background:C.bg1,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}},h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},h('span',{style:{fontSize:13.5,fontWeight:700,flex:1,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},d.name),h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:2,borderRadius:4,display:'flex'},onClick:function(){_centerState.detail=null;renderCenter();}},svgEl(I.close,15))),h('div',{style:{flex:1,overflowY:'auto',padding:'12px 14px'}},(d.fields||[]).map(function(f,i){return h('div',{key:i,style:{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:12,borderBottom:'1px solid '+C.border}},h('span',{style:{color:C.tx3}},f.k),h('span',{style:{color:f.a?C.accentText:C.tx2,fontFamily:C.mono,fontSize:11}},f.v));}),d.tags?h('div',{style:{marginTop:12}},h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}},'TAGY'),h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},(d.tags||[]).map(function(t){return h('span',{key:t,style:{padding:'2px 8px',borderRadius:10,background:C.bg4,fontSize:10,color:C.tx2}},t);}))):null,d.actions?h('div',{style:{marginTop:12}},h('div',{style:{fontSize:10,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}},'AKCE'),h('div',{style:{display:'flex',gap:5,flexWrap:'wrap'}},(d.actions||[]).map(function(a,i){return h('button',{key:a,style:{padding:'5px 12px',borderRadius:6,border:i===0?'none':'1px solid '+C.border2,background:i===0?C.accent:C.bg3,color:i===0?'#fff':C.tx2,fontFamily:C.font,fontSize:11,cursor:'pointer'},
    onClick:function(){
      var c3=window._c3;if(!c3)return;
      if(a==='Otevřít'){
        var exp=EXPERTS.find(function(e){return e.name===d.name;});
        if(exp){c3.setExpert(exp.name);c3.chatMsg('🎓 Expert změněn na: '+exp.name);}
        var conv=CONVERSATIONS.find(function(c){return c.title===d.name;});
        if(conv){c3.chatMsg('📂 Načtena konverzace: '+conv.title);c3.setExpert(conv.expert);}
        var proj=PROJECTS.find(function(p){return p.name===d.name;});
        if(proj){c3.chatMsg('📁 Projekt: '+proj.name+' (Sprint '+proj.sprint+', '+proj.tests+')');}
        var wrk=WORKERS.find(function(w){return w.name===d.name;});
        if(wrk){c3.chatMsg('⚙️ Worker: '+wrk.name+' ['+wrk.status+'] cron: '+wrk.cron);}
      }else if(a==='Editovat'){
        c3.chatMsg('✏️ Editace '+d.name+' — otevřeno v editoru.');
      }else if(a==='Archivovat'){
        c3.chatMsg('📦 '+d.name+' archivováno.');_centerState.detail=null;renderCenter();
      }else if(a==='Spustit'){
        c3.chatMsg('▶️ Worker '+d.name+' spuštěn.');
      }else if(a==='Pozastavit'){
        c3.chatMsg('⏸️ Worker '+d.name+' pozastaven.');
      }
    }},a);}))):null));}

/* Nav event handler */
window.addEventListener('c3-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;renderCenter();
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
var _chatState={msgs:[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}],ctx:0,expert:'Výchozí',showExperts:false,attachments:[],ws:null};
var _chatContainer=null;

/* Init WebSocket */
try{
  _chatState.ws=new WebSocket('ws://localhost:3335/ws');
  _chatState.ws.onmessage=function(e){try{var d=JSON.parse(e.data);if(d.type==='chat_response'){_chatState.msgs.push({role:'assistant',text:d.text,tag:d.tag||'LLM'});if(d.contextPercent)_chatState.ctx=d.contextPercent;renderChat();chatScroll();}}catch(err){}};
}catch(e){}

function renderChat(){if(!_chatContainer)return;ReactDOM.render(h(ChatApp,null),_chatContainer);}
function chatScroll(){setTimeout(function(){var f=document.getElementById('c3-chat-feed');if(f)f.scrollTop=f.scrollHeight;},60);}

/* Expose for cross-component communication (center view actions → chat) */
window._c3={
  chatMsg:function(text){_chatState.msgs.push({role:'system',text:text});renderChat();chatScroll();},
  setExpert:function(name){_chatState.expert=name;renderChat();},
  getExpert:function(){return _chatState.expert;},
  renderChat:renderChat,
  renderCenter:function(){renderCenter();}
};

function chatSend(){
  var ta=document.getElementById('c3-chat-ta');
  var t=ta?ta.value.trim():'';if(!t&&_chatState.attachments.length===0)return;
  var txt=t;
  if(_chatState.attachments.length>0){txt=(t?t+'\n':'')+'📎 '+_chatState.attachments.map(function(a){return a.name;}).join(', ');}
  _chatState.msgs.push({role:'user',text:txt});
  _chatState.attachments=[];
  if(ta){ta.value='';ta.style.height='22px';}
  renderChat();chatScroll();
  if(_chatState.ws&&_chatState.ws.readyState===1){
    _chatState.ws.send(JSON.stringify({type:'chat',message:t,expert:_chatState.expert}));
  }else{
    fetch('http://localhost:3335/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:t,expert:_chatState.expert})})
    .then(function(r){return r.json();})
    .then(function(d){_chatState.msgs.push({role:'assistant',text:d.response||d.text||JSON.stringify(d),tag:'LLM'});if(d.contextPercent)_chatState.ctx=d.contextPercent;renderChat();chatScroll();})
    .catch(function(){_chatState.msgs.push({role:'assistant',text:'Backend nedostupný. Spusťte: node src/server.js',tag:'ERROR'});renderChat();});
  }
}

function ChatApp(){
  var st=_chatState;
  var btnS={background:C.accentBg,color:C.accentText,border:'none',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:26,height:26};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font,position:'relative'},
    onClick:function(){if(st.showExperts){_chatState.showExperts=false;renderChat();}}},
    /* HEADER */
    h('div',{style:{padding:'0 8px',height:36,display:'flex',alignItems:'center',gap:4,borderBottom:'1px solid '+C.border,flexShrink:0,cursor:'grab'}},
      h('button',{style:btnS,title:'Nový chat',onClick:function(){_chatState.msgs=[{role:'system',text:'Nový chat.'}];_chatState.ctx=0;_chatState.attachments=[];renderChat();var ta=document.getElementById('c3-chat-ta');if(ta)ta.value='';}},svgEl(I.plus)),
      h('button',{style:btnS,title:'Rozdělit',onClick:function(){_chatState.msgs.push({role:'system',text:'⚡ Split view — připravujeme v další verzi.'});renderChat();chatScroll();}},svgEl(I.split)),
      h('div',{style:{flex:1}}),
      h('div',{style:{display:'flex',alignItems:'center',gap:3,fontSize:9,color:C.tx4,fontFamily:C.mono}},
        h('div',{style:{width:36,height:4,background:C.bg4,borderRadius:2,overflow:'hidden'}},h('div',{style:{height:'100%',background:C.accent,borderRadius:2,width:st.ctx+'%'}})),h('span',null,st.ctx+'%')),
      h('button',{style:btnS,title:'Zavřít chat',onClick:function(){_chatState.msgs.push({role:'system',text:'💡 Chat panel je hlavní rozhraní a nelze zavřít.'});renderChat();chatScroll();}},svgEl(I.close))),
    /* FEED */
    h('div',{id:'c3-chat-feed',style:{flex:1,overflowY:'auto',padding:10}},
      st.msgs.map(function(m,i){var u=m.role==='user',a=m.role==='assistant';
        return h('div',{key:i,style:{padding:'8px 0',borderBottom:'1px solid '+C.border}},
          h('div',{style:{display:'flex',alignItems:'center',gap:5,marginBottom:3}},
            h('div',{style:{width:20,height:20,borderRadius:'50%',background:u?C.bg4:a?'linear-gradient(135deg,#22c55e,#16a34a)':C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:a?7:9,fontWeight:a?700:400,color:u?C.tx3:a?'#fff':C.tx4}},u?'👤':a?'C3':'⚡'),
            h('span',{style:{fontSize:11,fontWeight:600,color:C.tx2}},u?'Ty':a?'C3':'System'),
            m.tag?h('span',{style:{fontSize:8,padding:'1px 4px',borderRadius:3,fontFamily:C.mono,textTransform:'uppercase',background:m.tag==='ERROR'?C.redBg:C.purpleBg,color:m.tag==='ERROR'?C.red:C.purple}},m.tag):null),
          h('div',{style:{fontSize:12.5,lineHeight:'1.6',color:C.tx1,paddingLeft:25,wordBreak:'break-word',whiteSpace:'pre-wrap'}},m.text));})),
    /* INPUT */
    h('div',{style:{padding:8,borderTop:'1px solid '+C.border,flexShrink:0}},
      h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,overflow:'visible',position:'relative'}},
        /* Attachment chips */
        st.attachments.length>0?h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,padding:'6px 10px 0'}},
          st.attachments.map(function(a,i){
            return h('span',{key:i,style:{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:6,background:C.bg4,fontSize:10,color:C.tx2}},
              '📎 '+a.name+' ('+a.size+')',
              h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:12,marginLeft:2},onClick:function(){_chatState.attachments.splice(i,1);renderChat();}},'×'));})):null,
        /* Textarea + send */
        h('div',{style:{display:'flex',alignItems:'flex-end',padding:'8px 10px 6px',gap:3}},
          h('textarea',{id:'c3-chat-ta',style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.font,fontSize:13,lineHeight:'1.4',resize:'none',minHeight:22,maxHeight:120,overflow:'auto'},placeholder:'Napiš zprávu...',rows:1,
            onInput:function(e){e.target.style.height='22px';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';},
            onKeyDown:function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();chatSend();}}}),
          h('button',{style:{background:'rgba(34,197,94,0.15)',color:C.accentText,border:'none',borderRadius:7,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:28,height:28,flexShrink:0},onClick:chatSend},svgEl(I.send))),
        /* Bottom bar */
        h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'3px 7px 7px',borderTop:'1px solid '+C.border}},
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:24,height:24},title:'Připojit soubor',
            onClick:function(ev){ev.stopPropagation();var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var i=0;i<inp.files.length;i++){_chatState.attachments.push({name:inp.files[i].name,size:Math.round(inp.files[i].size/1024)+' KB',file:inp.files[i]});}renderChat();}document.body.removeChild(inp);};inp.click();}},svgEl(I.attach,13)),
          h('span',{style:{flex:1,fontSize:10,color:C.accentText,opacity:0.5,padding:'0 4px',fontStyle:'italic'}},'Tab pro autocomplete'),
          h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:5,fontSize:10.5,fontWeight:500,color:C.accentText,opacity:0.7,cursor:'pointer',flexShrink:0},
            onClick:function(ev){ev.stopPropagation();_chatState.showExperts=!_chatState.showExperts;renderChat();}},
            h('span',{style:{width:4,height:4,borderRadius:'50%',background:C.accent}}),st.expert,svgEl(I.chevDown,9))),
        /* Expert picker — full list with favorites toggle */
        st.showExperts?h('div',{style:{position:'absolute',bottom:'100%',right:8,marginBottom:4,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:'4px 0',minWidth:170,maxHeight:260,overflowY:'auto',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,0.5)'},onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{padding:'4px 12px 6px',fontSize:9,fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px'}},'VYBRAT EXPERTA'),
          EXPERTS.map(function(exp){
            return h('div',{key:exp.name,style:{display:'flex',alignItems:'center',gap:6,padding:'5px 12px',fontSize:11.5,color:st.expert===exp.name?C.accentText:C.tx2,background:st.expert===exp.name?C.accentBg:'transparent',cursor:'pointer'},
              onMouseEnter:function(e){e.currentTarget.style.background=C.bg4;},
              onMouseLeave:function(e){e.currentTarget.style.background=st.expert===exp.name?C.accentBg:'transparent';},
              onClick:function(e){e.stopPropagation();_chatState.expert=exp.name;_chatState.showExperts=false;renderChat();}},
              h('span',null,exp.emoji),h('span',{style:{flex:1}},exp.name),
              h('span',{style:{fontSize:12,color:exp.fav?C.accentText:C.tx4,cursor:'pointer'},onClick:function(e){e.stopPropagation();exp.fav=!exp.fav;renderChat();}},exp.fav?'★':'☆'));})):null)));
}

class C3ChatWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=C3_CHAT_ID;this.title.label='C3 Chat';this.title.iconClass='codicon codicon-comment-discussion';this.title.closable=true;this.node.tabIndex=0;this.node.style.cssText='height:100%;width:100%;';}
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
var _agentState={tab:'agent',log:[
  {time:'14:32:01',type:'TURN',cls:'turn',text:'start — "Popiš historii Československa"',active:true},
  {time:'14:32:01',type:'CRE',cls:'cre',text:'CONV conf=0.94'},
  {time:'14:32:02',type:'LLM',cls:'llm',text:'qwen2.5:32b 847tok'},
  {time:'14:32:04',type:'GATE',cls:'gate',text:'D6.1✓ D6.2✓ q=0.91'},
  {time:'14:32:04',type:'TURN',cls:'turn',text:'end ok 2847ms'}
]};
var _agentContainer=null;
function renderAgent(){if(!_agentContainer)return;ReactDOM.render(h(AgentApp,null),_agentContainer);}

function AgentApp(){
  var st=_agentState;
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    h('div',{style:{height:28,display:'flex',alignItems:'stretch',borderBottom:'1px solid '+C.border,flexShrink:0}},
      ['agent','terminal','problems'].map(function(t){
        var lbl=t==='agent'?'Agent':t==='terminal'?'Terminal':'Problems';
        var cnt=t==='agent'?st.log.length:t==='problems'?0:null;
        return h('div',{key:t,style:{padding:'0 10px',fontSize:10.5,fontWeight:600,color:st.tab===t?C.tx1:C.tx4,display:'flex',alignItems:'center',gap:4,cursor:'pointer',borderBottom:st.tab===t?'2px solid '+C.accent:'2px solid transparent'},
          onClick:function(){_agentState.tab=t;renderAgent();}},
          lbl,cnt!==null?h('span',{style:{fontSize:8,background:C.bg4,padding:'0 4px',borderRadius:5,color:C.tx3}},cnt):null);})),
    st.tab==='agent'?h('div',{style:{flex:1,overflowY:'auto'}},st.log.map(function(e,i){
      return h('div',{key:i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:11,lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
        h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
        h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
        h('span',{style:{color:C.tx2}},e.text));})):null,
    st.tab==='terminal'?h('div',{style:{flex:1,overflowY:'auto',padding:'5px 10px',fontFamily:C.mono,fontSize:11.5,lineHeight:'1.6',color:C.tx2}},
      h('div',null,h('span',{style:{color:C.accentText}},'~/c3 $ '),'node src/server.js'),
      h('div',null,h('span',{style:{color:C.accentText}},'✓ '),'C3 on :3335'),
      h('div',null,h('span',{style:{color:C.accentText}},'~/c3 $ '))):null,
    st.tab==='problems'?h('div',{style:{flex:1,padding:10,color:C.tx4,fontSize:11}},'No problems detected.'):null);
}

class C3AgentWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=C3_AGENT_ID;this.title.label='Agent Log';this.title.iconClass='codicon codicon-hubot';this.title.closable=true;this.node.tabIndex=0;this.node.style.cssText='height:100%;width:100%;';}
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
  async onStart(a){try{await this.openView({activate:false,reveal:true});}catch(e){}}}
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
