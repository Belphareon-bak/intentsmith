"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
try { require("./styles/c3-theme.css"); } catch(e) {}
try { require("./styles/c3-chat.css"); } catch(e) {}

var inversify_1 = require("@theia/core/shared/inversify");
var browser_1 = require("@theia/core/lib/browser");
var react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
var ReactDOM = require("@theia/core/shared/react-dom");
var _createRoot = (ReactDOM.createRoot || function(c){return{render:function(el){ReactDOM.render(el,c);}};});
var React = require("@theia/core/shared/react");
var createLegacyLocalObjectUrlCache = require("../../../../shared/legacy-local-object-url-cache").createLegacyLocalObjectUrlCache;
var h = React.createElement;

/* ═══ TRANSPORT MODULES ═══ */
try { require("./event-bus"); } catch(e) { console.warn('[C3] event-bus.js not loaded:', e.message); }
/* M1 runtime validation is a hard product dependency after protocol prebuild. */
require("./ws-client");
try { require("./agent-client"); } catch(e) { console.warn('[C3] agent-client.js not loaded:', e.message); }
try { require("./agent-log-renderer"); } catch(e) { console.warn('[C3] agent-log-renderer.js not loaded:', e.message); }
try { require("./terminal-client"); } catch(e) { console.warn('[C3] terminal-client.js not loaded:', e.message); }

/* ═══ COLORS ═══ */
var _C_DEFAULT={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',
  tx1:'#ececef',tx2:'#a1a1aa',tx3:'#5e8a6d',tx4:'#436b52',
  accent:'#22c55e',accentText:'#4ade80',accentBg:'rgba(34,197,94,0.08)',
  red:'#f87171',redBg:'rgba(239,68,68,0.1)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
  blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
  cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
  border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)',
  font:"'Plus Jakarta Sans',-apple-system,sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"};
var _C_THEMES={
  clean:_C_DEFAULT,
  matrix:{bg0:'#010208',bg1:'#020410',bg2:'#040818',bg3:'#06101e',bg4:'#0a1428',bg5:'#0e1a32',
    tx1:'#b0ffb0',tx2:'#408050',tx3:'#22c55e',tx4:'#0d6832',
    accent:'#00ff6a',accentText:'#66ffaa',accentBg:'rgba(0,255,106,0.1)',
    red:'#ff4444',redBg:'rgba(255,68,68,0.12)',amber:'#ffaa00',amberBg:'rgba(255,170,0,0.1)',
    blue:'#44aaff',blueBg:'rgba(68,170,255,0.1)',purple:'#bb66ff',purpleBg:'rgba(187,102,255,0.1)',
    cyan:'#00ffcc',cyanBg:'rgba(0,255,204,0.1)',
    border:'rgba(0,255,106,0.1)',border2:'rgba(0,255,106,0.22)',
    font:"'Share Tech Mono','JetBrains Mono',monospace",mono:"'Share Tech Mono','JetBrains Mono',monospace"},
  japanese:{bg0:'#050304',bg1:'#0a0406',bg2:'#120810',bg3:'#1c0c12',bg4:'#28121a',bg5:'#341822',
    tx1:'#f5e8e8',tx2:'#b07070',tx3:'#cc3333',tx4:'#882222',
    accent:'#dc2626',accentText:'#f87171',accentBg:'rgba(220,38,38,0.1)',
    red:'#f87171',redBg:'rgba(248,113,113,0.12)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
    blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
    cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
    border:'rgba(220,38,38,0.15)',border2:'rgba(220,38,38,0.32)',
    font:"'Zen Kaku Gothic Antique','Noto Sans JP',sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"},
  midnight:{bg0:'#030712',bg1:'#060a18',bg2:'#0a1026',bg3:'#101838',bg4:'#16204a',bg5:'#1c285c',
    tx1:'#d8e8ff',tx2:'#6888b8',tx3:'#3b82f6',tx4:'#1d4ed8',
    accent:'#60a5fa',accentText:'#93c5fd',accentBg:'rgba(96,165,250,0.1)',
    red:'#fb7185',redBg:'rgba(251,113,133,0.1)',amber:'#fcd34d',amberBg:'rgba(252,211,77,0.1)',
    blue:'#60a5fa',blueBg:'rgba(96,165,250,0.12)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
    cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.12)',
    border:'rgba(100,160,255,0.12)',border2:'rgba(100,160,255,0.25)',
    font:"'Inter','Plus Jakarta Sans',sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"}
};
var C=Object.assign({},_C_DEFAULT);
/* Font-size scaling — _fs(base) returns scaled px value, containers stay fixed */
var _fsScale=1;
function _fs(b){return Math.round(b*_fsScale*10)/10;}
/* Glass background mappings for pro themes — used instead of solid hex for CSS vars */
var _PRO_GLASS={
  matrix:{bg0:'transparent',bg1:'rgba(2,4,16,0.90)',bg2:'rgba(4,8,24,0.88)',bg3:'rgba(6,16,32,0.85)',bg4:'rgba(10,20,40,0.82)',bg5:'rgba(14,26,50,0.80)'},
  japanese:{bg0:'transparent',bg1:'rgba(10,4,6,0.88)',bg2:'rgba(18,8,12,0.85)',bg3:'rgba(28,12,18,0.82)',bg4:'rgba(40,18,26,0.78)',bg5:'rgba(52,24,34,0.75)'},
  midnight:{bg0:'transparent',bg1:'rgba(6,10,24,0.78)',bg2:'rgba(10,16,38,0.75)',bg3:'rgba(16,24,52,0.72)',bg4:'rgba(22,32,66,0.68)',bg5:'rgba(28,40,80,0.65)'}
};
function _applyColorTheme(themeId){
  var t=_C_THEMES[themeId]||_C_DEFAULT;
  Object.keys(t).forEach(function(k){C[k]=t[k];});
  C._solidBg0=t.bg0; /* v93: Always store solid bg0 before glass override */
  /* For pro themes: overwrite C.bg* with glass (rgba) values.
     This makes BOTH React inline styles AND CSS variables use transparent backgrounds,
     so the background image shows through everything. */
  var g=_PRO_GLASS[themeId];
  if(g){C.bg0=g.bg0;C.bg1=g.bg1;C.bg2=g.bg2;C.bg3=g.bg3;C.bg4=g.bg4;C.bg5=g.bg5;}
  var r=document.documentElement;
  /* For pro themes: c3 CSS vars → transparent (structural wrappers must not add another glass layer).
     Only React inline styles (C.bg*) provide the single glass layer.
     For clean theme: c3 CSS vars = C.bg* (solid hex, normal behavior). */
  if(g){
    r.style.setProperty('--c3-bg0','transparent');r.style.setProperty('--c3-bg1','transparent');
    r.style.setProperty('--c3-bg2','transparent');r.style.setProperty('--c3-bg3','transparent');
    r.style.setProperty('--c3-bg4','transparent');r.style.setProperty('--c3-bg5','transparent');
  } else {
    r.style.setProperty('--c3-bg0',C.bg0);r.style.setProperty('--c3-bg1',C.bg1);
    r.style.setProperty('--c3-bg2',C.bg2);r.style.setProperty('--c3-bg3',C.bg3);
    r.style.setProperty('--c3-bg4',C.bg4);r.style.setProperty('--c3-bg5',C.bg5);
  }
  r.style.setProperty('--c3-tx1',C.tx1);r.style.setProperty('--c3-tx2',C.tx2);
  r.style.setProperty('--c3-tx3',C.tx3);r.style.setProperty('--c3-tx4',C.tx4);
  r.style.setProperty('--c3-accent',C.accent);r.style.setProperty('--c3-accent-dim',C.accent);
  r.style.setProperty('--c3-accent-bg',C.accentBg);r.style.setProperty('--c3-accent-text',C.accentText);
  r.style.setProperty('--c3-border',C.border);r.style.setProperty('--c3-border2',C.border2);
  /* Override Theia CSS variables for pro themes.
     Structural containers → transparent (our React panels provide the glass layer).
     Leaf Theia components (editor, terminal, tabs, menus) → glass (no React inside). */
  if(g){
    var T='transparent';
    /* Structural wrappers — transparent so only ONE glass layer exists */
    r.style.setProperty('--theia-sideBar-background',T);
    r.style.setProperty('--theia-activityBar-background',T);
    r.style.setProperty('--theia-panel-background',T);
    r.style.setProperty('--theia-titleBar-activeBackground',T);
    r.style.setProperty('--theia-titleBar-inactiveBackground',T);
    r.style.setProperty('--theia-editorGroupHeader-tabsBackground',T);
    r.style.setProperty('--theia-editorGroupHeader-noTabsBackground',T);
    r.style.setProperty('--theia-mainToolbar-background',T);
    r.style.setProperty('--theia-sideBarSectionHeader-background',T);
    r.style.setProperty('--theia-breadcrumb-background',T);
    /* Leaf components — glass (these are pure Theia, no React glass inside) */
    r.style.setProperty('--theia-editor-background',C.bg1);
    r.style.setProperty('--theia-terminal-background',C.bg1);
    r.style.setProperty('--theia-editorGutter-background',C.bg1);
    r.style.setProperty('--theia-editorStickyScroll-background',C.bg1);
    r.style.setProperty('--theia-tab-activeBackground',C.bg2);
    r.style.setProperty('--theia-tab-inactiveBackground',C.bg1);
    r.style.setProperty('--theia-tab-border',T);
    r.style.setProperty('--theia-statusBar-background',C.bg2);
    r.style.setProperty('--theia-statusBar-noFolderBackground',C.bg2);
    r.style.setProperty('--theia-input-background',C.bg3);
    r.style.setProperty('--theia-dropdown-background',C.bg3);
    r.style.setProperty('--theia-menu-background',C.bg2);
    r.style.setProperty('--theia-menu-selectionBackground',C.bg3);
    r.style.setProperty('--theia-notifications-background',C.bg2);
    r.style.setProperty('--theia-notificationCenterHeader-background',C.bg2);
    r.style.setProperty('--theia-quickInput-background',C.bg2);
    r.style.setProperty('--theia-editorWidget-background',C.bg2);
    r.style.setProperty('--theia-editorHoverWidget-background',C.bg2);
    r.style.setProperty('--theia-list-hoverBackground',C.bg3);
    r.style.setProperty('--theia-list-activeSelectionBackground',C.bg3);
    r.style.setProperty('--theia-list-inactiveSelectionBackground',C.bg3);
    r.style.setProperty('--theia-peekViewTitle-background',C.bg2);
    r.style.setProperty('--theia-peekViewResult-background',C.bg2);
    r.style.setProperty('--theia-editorMarkerNavigation-background',C.bg2);
    r.style.setProperty('--theia-settings-focusedRowBackground',C.bg3);
  }
}

/* ═══ PRO THEME CSS INJECTION ═══ */
var _themesUrl=(function(){try{return new URL('../../../../themes/',window.location.href).href;}catch(e){return 'themes/';}})();
function _injectProThemeCSS(themeId){
  var sid='c3-pro-theme-css';var ex=document.getElementById(sid);
  if(!ex){ex=document.createElement('style');ex.id=sid;document.head.appendChild(ex);}
  if(!themeId||themeId==='clean'){ex.textContent='';return;}
  /* Targeted transparency on Theia wrapper containers only.
     Background image goes on body directly. React inline styles (C.bg*) provide glass. */
  function _pro(B,BLUR){return '\
'+B+' .theia-ApplicationShell,\
'+B+' .p-DockPanel,'+B+' .p-DockPanel-widget,'+B+' .lm-DockPanel,'+B+' .lm-DockPanel-widget,\
'+B+' .p-SplitPanel,'+B+' .lm-SplitPanel,\
'+B+' .theia-side-panel,\
'+B+' #theia-left-side-panel,'+B+' #theia-right-side-panel,\
'+B+' #theia-bottom-content-panel,\
'+B+' .theia-app-sides,\
'+B+' #theia-main-content-panel{background:transparent!important;}\n\
'+B+' .p-TabBar,'+B+' .lm-TabBar{backdrop-filter:blur('+BLUR+'px);-webkit-backdrop-filter:blur('+BLUR+'px);}\n';}
  var css='';
  if(themeId==='matrix'){
    var B='body.theme-pro-matrix';
    css='\
/* MATRIX THEME — image on body, overlays on ::before/::after */\n\
'+B+'{background:url("'+_themesUrl+'bg-matrix.jpg") center/cover fixed no-repeat!important;}\n\
'+B+'::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;\n\
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,106,0.012) 2px,rgba(0,255,106,0.012) 4px);}\n\
'+_pro(B,'20')+'\
'+B+' *{font-family:"Share Tech Mono","JetBrains Mono",monospace!important;}\n\
'+B+' .codicon,'+B+' .codicon *{font-family:"codicon"!important;}\n\
'+B+' .p-MenuBar-content,'+B+' .p-MenuBar-content *{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif!important;}\n\
'+B+' #theia-top-panel{background:rgba(2,4,16,0.95)!important;}\n\
'+B+' #theia-left-side-panel{border-right:1px solid rgba(0,255,106,0.15)!important;}\n\
'+B+' .p-MenuBar,'+B+' #theia\\:menubar{background:rgba(2,4,16,0.92)!important;backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,255,106,0.1)!important;}\n\
'+B+' .p-MenuBar-item{color:#408050!important;}\n\
'+B+' .p-MenuBar-item:hover,'+B+' .p-MenuBar-item.p-mod-active{background:rgba(0,255,106,0.05)!important;color:#00ff6a!important;}\n\
'+B+' .p-Menu{background:rgba(4,8,24,0.95)!important;backdrop-filter:blur(20px);border:1px solid rgba(0,255,106,0.15)!important;}\n\
'+B+' .p-Menu-item:hover{background:rgba(0,255,106,0.05)!important;}\n\
'+B+' .p-Menu-item .p-Menu-itemLabel{color:#b0ffb0!important;}\n\
'+B+' #theia-statusBar{background:rgba(2,4,16,0.92)!important;border-top:1px solid rgba(0,255,106,0.1)!important;}\n\
'+B+' .theia-statusBar .area .element{color:#408050!important;}\n\
'+B+' .theia-statusBar .area.left .element:first-child{color:#00ff6a!important;text-shadow:0 0 8px rgba(0,255,106,0.4);}\n\
'+B+' ::-webkit-scrollbar-thumb{background:rgba(0,255,106,0.15)!important;}\n\
'+B+' ::-webkit-scrollbar-thumb:hover{background:rgba(0,255,106,0.3)!important;}\n\
'+B+' .p-TabBar-tab.p-mod-current,'+B+' .lm-TabBar-tab.lm-mod-current{border-bottom:2px solid #00ff6a!important;}\n\
';
  } else if(themeId==='japanese'){
    var B='body.theme-pro-japanese';
    css='\
/* JAPANESE THEME — image on body, glow on ::before */\n\
'+B+'{background:url("'+_themesUrl+'bg-japanese.jpg") center/cover fixed no-repeat!important;}\n\
'+B+'::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;\n\
  background:radial-gradient(ellipse 80% 40% at 50% 90%,rgba(180,20,20,0.15),transparent 70%),\n\
  radial-gradient(ellipse 50% 20% at 30% 70%,rgba(255,30,30,0.08),transparent);opacity:0.7;}\n\
'+_pro(B,'20')+'\
'+B+' *{font-family:"Zen Kaku Gothic Antique","Noto Sans JP",sans-serif!important;}\n\
'+B+' .codicon,'+B+' .codicon *{font-family:"codicon"!important;}\n\
'+B+' .p-MenuBar-content,'+B+' .p-MenuBar-content *{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif!important;}\n\
'+B+' #theia-top-panel{background:rgba(10,4,6,0.95)!important;}\n\
'+B+' #theia-left-side-panel{border-right:1px solid rgba(220,38,38,0.2)!important;}\n\
'+B+' h1,'+B+' h2,'+B+' h3{font-family:"Yuji Boku","Zen Kaku Gothic Antique",serif!important;}\n\
'+B+' .p-MenuBar,'+B+' #theia\\:menubar{background:rgba(10,4,6,0.92)!important;backdrop-filter:blur(20px);border-bottom:1px solid rgba(220,38,38,0.15)!important;}\n\
'+B+' .p-MenuBar-item{color:#b07070!important;}\n\
'+B+' .p-MenuBar-item:hover,'+B+' .p-MenuBar-item.p-mod-active{background:rgba(220,38,38,0.08)!important;color:#f87171!important;}\n\
'+B+' .p-Menu{background:rgba(10,4,6,0.95)!important;backdrop-filter:blur(20px);border:1px solid rgba(220,38,38,0.2)!important;}\n\
'+B+' .p-Menu-item:hover{background:rgba(220,38,38,0.08)!important;}\n\
'+B+' .p-Menu-item .p-Menu-itemLabel{color:#f5e8e8!important;}\n\
'+B+' #theia-statusBar{background:rgba(10,4,6,0.92)!important;border-top:1px solid rgba(220,38,38,0.15)!important;}\n\
'+B+' .theia-statusBar .area .element{color:#b07070!important;}\n\
'+B+' .theia-statusBar .area.left .element:first-child{color:#f87171!important;text-shadow:0 0 8px rgba(220,38,38,0.4);}\n\
'+B+' ::-webkit-scrollbar-thumb{background:rgba(220,38,38,0.2)!important;}\n\
'+B+' ::-webkit-scrollbar-thumb:hover{background:rgba(220,38,38,0.35)!important;}\n\
'+B+' .p-TabBar-tab.p-mod-current,'+B+' .lm-TabBar-tab.lm-mod-current{border-bottom:2px solid #dc2626!important;}\n\
';
  } else if(themeId==='midnight'){
    var B='body.theme-pro-midnight';
    css='\
/* MIDNIGHT THEME — image on body, glow on ::before */\n\
'+B+'{background:url("'+_themesUrl+'bg-midnight.jpg") center/cover fixed no-repeat!important;}\n\
'+B+'::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;\n\
  background:radial-gradient(ellipse 60% 30% at 55% 90%,rgba(40,80,200,0.12),transparent 60%),\n\
  radial-gradient(ellipse 40% 20% at 70% 20%,rgba(100,60,200,0.08),transparent);opacity:0.7;}\n\
'+_pro(B,'30')+'\
'+B+' *{font-family:"Inter","Plus Jakarta Sans",sans-serif!important;}\n\
'+B+' .codicon,'+B+' .codicon *{font-family:"codicon"!important;}\n\
'+B+' .p-MenuBar-content,'+B+' .p-MenuBar-content *{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,sans-serif!important;}\n\
'+B+' #theia-top-panel{background:rgba(6,10,24,0.95)!important;}\n\
'+B+' #theia-left-side-panel{border-right:1px solid rgba(100,160,255,0.15)!important;}\n\
'+B+' .p-MenuBar,'+B+' #theia\\:menubar{background:rgba(6,10,24,0.85)!important;backdrop-filter:blur(30px);border-bottom:1px solid rgba(100,160,255,0.12)!important;}\n\
'+B+' .p-MenuBar-item{color:#6888b8!important;}\n\
'+B+' .p-MenuBar-item:hover,'+B+' .p-MenuBar-item.p-mod-active{background:rgba(96,165,250,0.07)!important;color:#93c5fd!important;}\n\
'+B+' .p-Menu{background:rgba(6,10,24,0.95)!important;backdrop-filter:blur(30px);border:1px solid rgba(100,160,255,0.18)!important;border-radius:12px!important;}\n\
'+B+' .p-Menu-item:hover{background:rgba(96,165,250,0.07)!important;}\n\
'+B+' .p-Menu-item .p-Menu-itemLabel{color:#d8e8ff!important;}\n\
'+B+' #theia-statusBar{background:rgba(6,10,24,0.85)!important;border-top:1px solid rgba(100,160,255,0.12)!important;}\n\
'+B+' .theia-statusBar .area .element{color:#6888b8!important;}\n\
'+B+' .theia-statusBar .area.left .element:first-child{color:#93c5fd!important;text-shadow:0 0 8px rgba(96,165,250,0.3);}\n\
'+B+' ::-webkit-scrollbar-thumb{background:rgba(96,165,250,0.15)!important;}\n\
'+B+' ::-webkit-scrollbar-thumb:hover{background:rgba(96,165,250,0.3)!important;}\n\
'+B+' .p-TabBar-tab.p-mod-current,'+B+' .lm-TabBar-tab.lm-mod-current{border-bottom:2px solid #60a5fa!important;}\n\
'+B+' .p-TabBar-tab,'+B+' .lm-TabBar-tab{border-radius:8px 8px 0 0!important;}\n\
';
  }
  /* Common pro theme glass rules based on sliders */
  if(css&&themeId&&themeId!=='clean'){
    var svo=_settingsVals;
    var bgDimAlpha=(svo.bgDim!=null?svo.bgDim:30)/100;
    var tileAlpha=(svo.tileOpacity!=null?svo.tileOpacity:80)/100;
    var panelAlpha=(svo.sidebarOpacity!=null?svo.sidebarOpacity:80)/100;
    var tb=_C_THEMES[themeId]?_C_THEMES[themeId].bg0:'#000000';
    var tbc=_hp(tb);
    var pb=_C_THEMES[themeId]?_C_THEMES[themeId].bg1:'#111114';
    var pbc=_hp(pb);
    var B='body.theme-pro-'+themeId;
    /* Background dimming — gradient layer composited onto background image (not an overlay that covers content) */
    var _themeImgs={matrix:'bg-matrix.jpg',japanese:'bg-japanese.jpg',midnight:'bg-midnight.jpg'};
    var imgFile=_themeImgs[themeId];
    if(imgFile&&bgDimAlpha>0){
      css+=B+'{background:linear-gradient(rgba('+tbc[0]+','+tbc[1]+','+tbc[2]+','+bgDimAlpha.toFixed(2)+'),rgba('+tbc[0]+','+tbc[1]+','+tbc[2]+','+bgDimAlpha.toFixed(2)+')),url("'+_themesUrl+imgFile+'") center/cover fixed no-repeat!important;}\n';
    }
    /* Card/tile transparency */
    css+=B+' .c3-card{background:rgba('+pbc[0]+','+pbc[1]+','+pbc[2]+','+tileAlpha.toFixed(2)+')!important;}\n';
    /* Sidebar/panel glass — target both outer container AND inner React div (which has inline background) */
    var panelRgba='rgba('+pbc[0]+','+pbc[1]+','+pbc[2]+','+panelAlpha.toFixed(2)+')';
    css+=B+' #c3-sidebar,'+B+' #c3-chat-panel,'+B+' #c3-agent-panel,'+B+' #theia-bottom-content-panel{background:'+panelRgba+'!important;backdrop-filter:blur(20px)!important;}\n';
    css+=B+' #c3-sidebar>div,'+B+' #c3-chat-panel>div,'+B+' #c3-agent-panel>div{background:transparent!important;}\n';
  }
  ex.textContent=css;
}

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

var I={chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',expert:'<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',worker:'<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.18 1.65 1.65 0 0 0 4.27 6.36l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',chevDown:'<polyline points="6 9 12 15 18 9"/>',plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',split:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',close:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',store:'<path d="M6 2L3 7v13a1 1 0 001 1h16a1 1 0 001-1V7l-3-5H6z"/><path d="M3 7h18"/><path d="M16 10a4 4 0 01-8 0"/>',media:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'};

/* ═══ DATA ═══ */
/* 15+1 built-in expertises per docs — overridden by backend /api/expertises */
var EXPERTISES=[
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
  {emoji:'🤖',name:'AI Expertise',desc:'Umělá inteligence',domain:'artificial_intelligence'},
  {emoji:'💻',name:'Vývojář',desc:'Kód, debugging',domain:'software_development',fav:true},
  {emoji:'🔧',name:'Technik',desc:'Technická podpora',domain:'technical_support'},
  {emoji:'🚗',name:'Autíčkář',desc:'Automobily',domain:'automobiles'},
  {emoji:'🏍️',name:'Motorkář',desc:'Motorky',domain:'motorcycles'},
  {emoji:'🏛️',name:'Politolog',desc:'Politika',domain:'politics'}
];
/* Start empty — populated from backend; no hardcoded stale data */
var PROJECTS=[];
var CONVERSATIONS=[];
/* Specialists = expertises with deterministic tools (is_specialist from backend or default) */
var SPECIALISTS=EXPERTISES.filter(function(e){return e.isSpecialist;}).map(function(e){return{emoji:e.emoji,name:e.name,desc:e.desc,domain:e.domain,tags:[e.domain||'','Specialista'].filter(Boolean)};});
var WORKERS=[];
var SETTINGS_SECTIONS=[{icon:'👤',title:'Account',desc:'Identita a profil'},{icon:'🤖',title:'LLM',desc:'Modely a inference'},{icon:'🧠',title:'Memory',desc:'Paměť a kontext'},{icon:'🔔',title:'Notifications',desc:'Upozornění'},{icon:'📄',title:'Output',desc:'Formátování výstupu'},{icon:'🎨',title:'Appearance',desc:'Vzhled a přizpůsobení'},{icon:'🖥️',title:'System',desc:'Systém a diagnostika'},{icon:'📦',title:'Storage',desc:'Data a úložiště'},{icon:'💾',title:'Backup',desc:'Zálohy a export'},{icon:'🎛️',title:'Feature Flags',desc:'Runtime přepínače'},{icon:'🔒',title:'Security',desc:'Tokeny a audit log'},{icon:'ℹ️',title:'About',desc:'O aplikaci'}];
var FILES=[];
var _collapsedDirs={};var _wtRoot='';var _wtLoading=false;var _wtRenaming=null;var _wtNewInput=null;
/* Expose _wtRoot on window so ws-client.js can send cwd with terminal commands */
Object.defineProperty(window,'_wtRoot',{get:function(){return _wtRoot;},set:function(v){_wtRoot=v;}});
var _wtRawTree=null; /* raw nested tree from backend — re-flatten on collapse toggle */
/* ── Per-session working tree state (v64.3) ── */
var _perSessionTree={}; /* sessionIdx → {wtRoot, collapsedDirs, rawTree, files} */
function _saveTreeState(idx){
  _perSessionTree[idx]={wtRoot:_wtRoot,collapsedDirs:Object.assign({},_collapsedDirs),rawTree:_wtRawTree,files:FILES.slice()};
}
function _loadTreeState(idx){
  var st=_perSessionTree[idx];
  if(st){_wtRoot=st.wtRoot||'';_collapsedDirs=Object.assign({},st.collapsedDirs||{});_wtRawTree=st.rawTree;FILES=st.files||[];}
  else{_wtRoot='';_collapsedDirs={};_wtRawTree=null;FILES=[];}
  renderSidebar();
}
function _switchSession(newIdx){
  if(newIdx===_sessionActive)return;
  _saveTreeState(_sessionActive);
  _sessionActive=newIdx;
  _loadTreeState(newIdx);
  /* v64.5: If target session has a project but no tree data, load project tree */
  var s=_sessions[newIdx];
  if(s&&s._projectId&&!_wtRoot){
    var proj=PROJECTS.find(function(p){return p.id===s._projectId;});
    if(proj&&proj.path){_wtRoot=proj.path;_loadWorkspaceTree(proj.path);}
  }
  /* v92: Sync focus mode class — layout derives from new session's specialist */
  _syncFocusClass();renderCenter();renderChat();renderAgent();
}
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
      /* v64.2: Collapse all top-level dirs on initial load */
      (data.tree||[]).forEach(function(node){if(node.d)_collapsedDirs[node.n]=true;});
      FILES=_flattenTree(data.tree,0,null);
    }
    renderSidebar();
    _fetchGitStatus();
  }).catch(function(){_wtLoading=false;renderSidebar();});
}
/* ── Fetch git status and merge into file entries ── */
var _gitStatusTimer=null;
function _fetchGitStatus(){
  if(!_wtRoot)return;
  fetch(_backendBase+'/api/workspace/git-status?path='+encodeURIComponent(_wtRoot),{signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(data){
    if(!data.files)return;
    FILES.forEach(function(f){
      if(f.d)return;
      var fp=f.fp;
      /* git status uses path relative to repo root — try both fp and full constructions */
      var st=data.files[fp]||data.files[f.p?(f.p+'/'+f.n):f.n]||null;
      /* Map git porcelain codes: M=modified, A=added, D=deleted, ??=untracked, AM, MM etc */
      if(st==='??')f.st='U';
      else if(st)f.st=st.charAt(0)===' '?st.charAt(1):st.charAt(0);
      else f.st=null;
    });
    renderSidebar();
  }).catch(function(){});
}
/* ── Refresh git status after file save (Ctrl+S / Cmd+S) ── */
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){
    clearTimeout(_gitStatusTimer);
    _gitStatusTimer=setTimeout(_fetchGitStatus,800);
  }
});
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
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:0,recent:[]},{id:'projects',label:'Projekty',icon:'folder',badge:0,recent:[]},{id:'specialists',label:'Specialisté',icon:'users',badge:SPECIALISTS.length,recent:SPECIALISTS.slice(0,2).map(function(s){return s.name;})},{id:'expertises',label:'Expertyzy',icon:'expert',badge:EXPERTISES.length,recent:EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;})},{id:'workers',label:'Workeri',icon:'worker',badge:0,recent:[]},{id:'marketplace',label:'Obchod',icon:'store',badge:0,recent:[]},{id:'multimedia',label:'Multim\u00E9dia',icon:'media',badge:0,recent:[]}];

/* ═══ LIVE DATA FETCH ═══ */
var _backendBase=(function(){try{if(typeof window!=='undefined'&&window.electronC3){var url=window.electronC3.getBackendUrl();if(url)return url;}}catch(e){}return 'http://127.0.0.1:3335';})();

/* v88: Extracted expertise fetch — reusable for initial load + post-skill refresh */
function _fetchExpertises(){
  fetch(_backendBase+'/api/expertises',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.expertises||data.experts||[]);
    if(items.length>0){
      var _localEx={};EXPERTISES.forEach(function(le){_localEx[le.name]=le;});
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
      EXPERTISES=allEx;
      SPECIALISTS=allEx.filter(function(e){return e.isSpecialist;}).map(function(e){
        return{id:e.id,emoji:e.emoji,name:e.name,desc:e.desc,domain:e.domain,
          tags:[e.domain,'Specialista'].filter(Boolean)};
      });
    }
    NAV[3].badge=EXPERTISES.length;NAV[3].recent=EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;});
    NAV[2].badge=SPECIALISTS.length;NAV[2].recent=SPECIALISTS.slice(0,3).map(function(s){return s.name;});
    renderCenter();
  }).catch(function(err){if(typeof console!=='undefined')console.error('[C3:fetchExpertises] ERROR:',err);});
}

/* v88+v122.2: Re-fetch expertises after create-expertise or create-specialist skill completes */
function _maybeRefreshExpertises(metadata){
  if(metadata&&metadata.completed&&(metadata.skillId==='create-expertise'||metadata.skillId==='create-specialist')){
    _fetchExpertises();
  }
}

function fetchBackendData(){
  /* Projects — filter: must have path (real project, not conversation leak) */
  var projStatus=_centerState.projectFilterMode||'active';
  fetch(_backendBase+'/api/projects?limit=50&status='+projStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.projects||[]);
    items=items.filter(function(p){return p.path&&p.name;});
    if(items.length>0){PROJECTS=items.slice(0,20).map(function(p){return{id:p.id,emoji:'📁',name:_s(p.name||p.title)||'Projekt',path:p.path||null,status:_s(p.status)||'Active',created:_s(p.created_at||p.createdAt||p.created)||'',updated:_s(p.last_active||p.updatedAt||p.updated)||'',desc:_s(p.description)||'',tags:[]};});}
    else{PROJECTS=[];}
    NAV[1].badge=PROJECTS.length;NAV[1].recent=PROJECTS.slice(0,3).map(function(p){return p.name;});renderCenter();
    /* v68: Sync working tree with active project after project data loads */
    var _as=_sessions[_sessionActive];
    if(_as&&_as._projectId){var _ap=PROJECTS.find(function(p){return p.id===_as._projectId;});
      if(_ap&&_ap.path&&_wtRoot!==_ap.path){_wtRoot=_ap.path;_loadWorkspaceTree(_ap.path);}}
  }).catch(function(){});
  /* Conversations */
  var convStatus=_centerState.filterMode||'active';
  fetch(_backendBase+'/api/conversations?limit=50&status='+convStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.conversations||[]);
    if(items.length>0){CONVERSATIONS=items.slice(0,20).map(function(c){return{id:c.id,title:_s(c.title||c.name)||'Chat',preview:_s(c.preview||c.lastMessage||c.summary)||'',time:_s(c.time||c.updated_at||c.updatedAt)||'',created_at:_s(c.created_at||c.createdAt)||'',updated_at:_s(c.updated_at||c.updatedAt||c.time)||'',expertise:_s(c.expertise)||'Výchozí',status:_s(c.state||c.status)||'active'};});}
    else{CONVERSATIONS=[];}
    NAV[0].badge=CONVERSATIONS.length;NAV[0].recent=CONVERSATIONS.slice(0,3).map(function(c){return c.title;});renderCenter();
  }).catch(function(){});
  /* Expertises — separate specialists (is_specialist or is_builtin+tools) */
  _fetchExpertises();
  /* Workers (agents) */
  if(!_agentsForbidden){fetch(_backendBase+'/api/agents',{signal:AbortSignal.timeout(3000)}).then(function(r){if(r.status===403){_agentsForbidden=true;return{agents:[]};}if(!r.ok)return{agents:[]};return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.agents||[]);
    if(items.length>0){WORKERS=items.map(function(a){
      var sched=a.definition&&a.definition.schedule?a.definition.schedule:null;
      var cronStr=sched?(sched.type==='cron'?_s(sched.value):_s(sched.value||sched.type)):_s(a.schedule||a.cron)||'';
      return{id:a.id,name:_s(a.name),status:a.enabled===false?'Paused':(_s(a.status)||'Running'),
        cron:cronStr,lastRun:_s(a.lastRun)||'',desc:_s(a.description||a.desc)||''};
    });}else{WORKERS=[];}
    NAV[4].badge=WORKERS.length;NAV[4].recent=WORKERS.slice(0,3).map(function(w){return w.name;});renderCenter();
  }).catch(function(){});}
  /* v132: Media badge — show active generation count */
  fetch(_backendBase+'/api/media/history?limit=1',{signal:AbortSignal.timeout(3000)})
    .then(function(r){return r.json();})
    .then(function(d){NAV[6].badge=_media.progress.size||(d.generations&&d.generations.length>0?'●':0);renderCenter();})
    .catch(function(){});
}
setTimeout(fetchBackendData,1500);
/* Auto-detect workspace root — ONLY if no session has a saved tree (don't overwrite restored state) */
setTimeout(function(){
  /* v64.5: Skip auto-detect if active session already has a tree root (restored from localStorage or project open) */
  var act=_sessionActive||0;
  var hasRestoredTree=(_perSessionTree[act]&&_perSessionTree[act].wtRoot)||_wtRoot;
  if(hasRestoredTree){return;}
  fetch(_backendBase+'/api/health',{signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(d){
    var root=d.cwd||d.workDir||null;
    if(!root){
      fetch(_backendBase+'/api/projects',{signal:AbortSignal.timeout(3000)})
      .then(function(r2){return r2.json();})
      .then(function(data){
        var items=Array.isArray(data)?data:(data.projects||[]);
        var withPath=items.find(function(p){return p.path;});
        if(withPath&&!_wtRoot){_wtRoot=withPath.path;_loadWorkspaceTree(withPath.path);}
      }).catch(function(){});
      return;
    }
    if(!_wtRoot){_wtRoot=root;_loadWorkspaceTree(root);}
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
    if(d.version)_serverHealth.version=d.version;
    if(d.limits){_serverHealth.limits=d.limits;_MAX_TEXT_SIZE=d.limits.maxTextAttachment||_MAX_TEXT_SIZE;_MAX_IMG_SIZE=d.limits.maxImageAttachment||_MAX_IMG_SIZE;}
    fetchBackendData();
    renderSidebar();_updateStatusIndicator();
  })
  .catch(function(){
    _serverHealth.status='offline';
    _serverHealth.lastCheck=Date.now();
    _serverHealth.wsConnected=false;
    renderSidebar();_updateStatusIndicator();
  });
},30000);

/* ═══════════════════════════════════════════════════════════
   1. SIDEBAR WIDGET (ReactWidget — read-only, update() is fine)
   ═══════════════════════════════════════════════════════════ */
var C3_SIDEBAR_ID='c3-sidebar';

class C3SidebarWidget extends react_widget_1.ReactWidget {
  constructor(){
    super();this.id=C3_SIDEBAR_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.outline='none';
    this._active=null;this._dd={};this._collapsed=false;
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
        _syncFocusClass();
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
        ss.textContent='.theia-sidepanel-toolbar{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;visibility:hidden!important;opacity:0!important;}.theia-sidepanel-toolbar~*{top:0!important;height:100%!important;}.lm-TabBar-toolbar{display:none!important;height:0!important;overflow:hidden!important;}#theia-right-side-panel .lm-TabBar~*,#theia-bottom-content-panel .lm-TabBar~*{top:0!important;height:100%!important;}#theia-right-side-panel .lm-DockPanel-widget,#theia-bottom-content-panel .lm-DockPanel-widget{top:0!important;height:100%!important;}.lm-Widget:focus,.lm-Widget:focus-visible,#c3-sidebar:focus,#c3-chat-panel:focus,#c3-agent-panel:focus{outline:none!important;box-shadow:none!important;}*:focus-visible{outline:none!important;}#theia-top-panel,.p-MenuBar,#theia\\:menubar,.theia-app-header{background:var(--c3-bg1,#111114)!important;border-color:var(--c3-border,rgba(255,255,255,0.06))!important;}#theia-left-side-panel,#theia-right-side-panel,#theia-bottom-content-panel{background:var(--c3-bg1,#111114)!important;}input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:var(--c3-bg4,#27282e);outline:none;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--c3-accent,#22c55e);cursor:pointer;border:2px solid var(--c3-bg1,#111114);}body{border:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;box-sizing:border-box!important;}#theia-right-side-panel{border-left:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}#theia-bottom-content-panel{border-top:1px solid var(--c3-border2,rgba(255,255,255,0.1))!important;}@keyframes c3-ac-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}@keyframes c3-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}@keyframes c3-thinking-dot{0%,80%,100%{opacity:0.2;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}.lm-TabBar-tabCloseIcon,.lm-TabBar-tabCloseIcon::before,.p-TabBar-tabCloseIcon,.p-TabBar-tabCloseIcon::before{font-family:"codicon"!important;}';
        document.head.appendChild(ss);
      }
      /* v92: Focus Mode CSS — layout override when specialist is active */
      if(!document.getElementById('c3-focus-css')){
        var fc=document.createElement('style');fc.id='c3-focus-css';
        fc.textContent='body.c3-focus-mode .c3-bottom-mode-tabs{display:none!important;}';
        document.head.appendChild(fc);
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
    if(!this._root)this._root=_createRoot(this.node);
    this._root.render(h(SidebarApp,{getState:function(){return{active:self._active,dd:self._dd,collapsed:self._collapsed};},setState:function(s){if(s.active!==undefined)self._active=s.active;if(s.dd!==undefined)self._dd=s.dd;if(s.collapsed!==undefined){self._collapsed=s.collapsed;try{var app=window._c3App;if(app&&app.shell&&typeof app.shell.resize==='function'){_c3SnapLock=true;app.shell.resize(s.collapsed?48:240,'left');setTimeout(function(){_c3SnapLock=false;},600);}}catch(ex){}}self._render();}}));
  }
}
inversify_1.decorate(inversify_1.injectable(),C3SidebarWidget);
var _sidebarWidget=null;function renderSidebar(){if(_sidebarWidget)_sidebarWidget._render();}

function SidebarApp(props){
  var s=props.getState(),set=props.setState;
  /* ── Collapsed icon-only mode (also forced in specialist focus mode) ── */
  if(s.collapsed||isFocusActive()){
    return h('div',{style:{display:'flex',flexDirection:'column',width:48,maxWidth:48,position:'absolute',top:0,left:0,bottom:0,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden',alignItems:'center',paddingTop:6}},
      h('div',{style:{cursor:'pointer',width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,color:C.tx3,marginBottom:2},title:'Rozbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:function(){if(isSpecialistFocus()){_focusExitDialog={pendingAction:function(){set({collapsed:false});}};renderCenter();return;}if(isConversationFocus()){_sessions[_sessionActive]._conversationFocus=false;_syncFocusClass();renderCenter();renderChat();}set({collapsed:false});}},svgEl('<polyline points="9 18 15 12 9 6"/>',18)),
      h('div',{style:{width:24,height:1,background:C.border,marginBottom:6}}),
      NAV.map(function(item){
        var isA=s.active===item.id;
        return h('div',{key:item.id,title:item.label,style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',marginBottom:2},
          onMouseEnter:function(e){if(!isA)e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background=isA?C.accentBg:'transparent';},
          onClick:function(){_wizardGuardNav(item.id,set);}},
          h('span',{style:{display:'flex'},dangerouslySetInnerHTML:{__html:svg(I[item.icon],18)}}));
      }),
      h('div',{style:{flex:1}}),
      h('div',{title:'Nastavení',style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',marginBottom:4,transition:'background 0.12s, color 0.12s'},
        onMouseEnter:function(e){if(s.active!=='settings'){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
        onMouseLeave:function(e){e.currentTarget.style.background=s.active==='settings'?C.accentBg:'transparent';e.currentTarget.style.color=s.active==='settings'?C.accentText:C.tx3;},
        onClick:function(){_wizardGuardNav('settings',set);}},
        svgEl(I.settings,18)));
  }
  /* ── Full expanded mode ── */
  var _curS=_sessions[_sessionActive];
  var _showWT=_wtRoot&&_curS&&_curS._projectId;
  return h('div',{style:{display:'flex',flexDirection:'column',position:'absolute',top:0,left:0,right:0,bottom:0,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden'}},
    /* Header with C3 Studio + collapse */
    h('div',{style:{display:'flex',alignItems:'center',padding:'6px 8px 2px',flexShrink:0}},
      h('div',{style:{width:22,height:22,background:'linear-gradient(135deg,'+C.accent+','+C.accentText+')',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:_fs(8),color:'#fff',flexShrink:0}},'C3'),
      h('span',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx1,marginLeft:6,flex:1}},'C3 Studio'),
      h('div',{style:{cursor:'pointer',padding:4,borderRadius:4,color:C.tx4},title:'Sbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.color=C.tx2;},onMouseLeave:function(e){e.currentTarget.style.color=C.tx4;},
        onClick:function(){set({collapsed:true});}},svgEl('<polyline points="15 18 9 12 15 6"/>',14))),
    /* Nav */
    h('div',{style:{flex:1,overflowY:'auto',padding:'2px 8px'}},
      NAV.map(function(item){
        var isA=s.active===item.id,isO=s.dd[item.id],els=[];
        els.push(h('div',{key:item.id,style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',marginBottom:2},
          onClick:function(){_wizardGuardNav(item.id,set);}},
          h('span',{style:{flexShrink:0,display:'flex'},dangerouslySetInnerHTML:{__html:svg(I[item.icon],20)}}),
          h('span',{style:{fontSize:_fs(13.5),fontWeight:600,flex:1}},item.label),
          item.badge?h('span',{style:{fontSize:_fs(9),fontFamily:C.mono,background:C.bg4,padding:'1px 6px',borderRadius:8,color:C.tx3}},item.badge):null,
          item.recent?h('span',{style:{flexShrink:0,display:'flex',padding:2,cursor:'pointer',transform:isO?'rotate(180deg)':'none',transition:'transform 0.15s'},
            onClick:function(e){e.stopPropagation();var nd={};nd[item.id]=!s.dd[item.id];set({dd:nd});}},svgEl(I.chevDown,14)):null));
        if(isO&&item.recent)els.push(h('div',{key:item.id+'-dd',style:{padding:'2px 0 6px 34px'}},item.recent.map(function(r,i){
          return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:4,fontSize:_fs(12),color:C.tx3,cursor:'pointer'},
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_wizardGuardNav(item.id,set,{select:r});}},
            h('span',{style:{width:6,height:6,borderRadius:'50%',background:C.accent,flexShrink:0}}),r);})));
        return els;
      }),
      _showWT?h('div',{style:{height:1,background:C.border,margin:'6px 12px'}}):null,
      _showWT?h('div',{style:{display:'flex',alignItems:'center',padding:'6px 10px 2px'}},
        h('span',{style:{fontSize:_fs(10),fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.6px',flex:1}},'Working Tree'),
        h('div',{style:{display:'flex',gap:2}},
          _wtRoot?h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:_fs(11)},title:'Obnovit',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_loadWorkspaceTree(_wtRoot);}},'↻'):null,
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:_fs(11)},title:'Sbalit vše',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){FILES.forEach(function(f){if(f.d&&f.i===0)_collapsedDirs[f.fp]=true;});_reflattenTree();}},'↑'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:_fs(12)},title:'Nový soubor',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_wtNewInput={type:'file',parent:null};renderSidebar();}},'📄'),
          h('div',{style:{width:20,height:18,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:3,cursor:'pointer',color:C.tx4,fontSize:_fs(12)},title:'Nová složka',
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
            onClick:function(){_wtNewInput={type:'dir',parent:null};renderSidebar();}},'📁'))):null,
      /* Workspace root path indicator */
      _showWT?h('div',{style:{padding:'2px 10px 4px',fontSize:_fs(9),color:C.tx4,fontFamily:C.mono,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},title:_wtRoot},
        _wtRoot.split('/').slice(-2).join('/')):null,
      /* New file/dir inline input (only when project open) */
      (_showWT&&_wtNewInput)?h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'2px 8px'}},
        h('span',{style:{fontSize:_fs(13),flexShrink:0}},_wtNewInput.type==='dir'?'📁':'📄'),
        h('input',{autoFocus:true,style:{flex:1,background:C.bg3,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 6px',color:C.tx1,fontFamily:C.mono,fontSize:_fs(11),outline:'none'},
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
      (_showWT&&_wtLoading)?h('div',{style:{padding:'8px 10px',textAlign:'center',fontSize:_fs(10),color:C.tx4}},'Načítám...'):
      /* File tree */
      _showWT?(function(){
        var stColors={M:C.accentText,A:'#22d3ee',D:'#ef4444',U:'#f97316'};
        if(FILES.length===0&&_wtRoot){return h('div',{style:{padding:'8px 10px',fontSize:_fs(11),color:C.tx4}},'Prázdná složka');}
        if(FILES.length===0){return null;}
        return FILES.map(function(f,i){
          var isCol=f.d&&_collapsedDirs[f.fp];
          var filePath=_buildFilePath(f);
          var fullPath=_wtRoot?((_wtRoot+'/'+filePath).replace(/\/+/g,'/')):filePath;
          var isRenaming=_wtRenaming&&_wtRenaming.path===filePath;
          return h('div',{key:f.fp+i,style:{display:'flex',alignItems:'center',gap:4,paddingLeft:(8+f.i*14),paddingRight:8,paddingTop:3,paddingBottom:3,borderRadius:4,fontSize:_fs(12),color:f.a?C.accentText:C.tx2,background:f.a?C.accentBg:'transparent',cursor:'pointer'},
            onMouseEnter:function(e){if(!f.a)e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background=f.a?C.accentBg:'transparent';},
            onClick:function(){if(f.d){_collapsedDirs[f.fp]=!_collapsedDirs[f.fp];_reflattenTree();}else{FILES.forEach(function(x){x.a=false;});f.a=true;renderSidebar();}},
            onDoubleClick:function(){if(!f.d&&_wtRoot){document.dispatchEvent(new CustomEvent('c3-file-open',{detail:{path:fullPath}}));}},
            onContextMenu:function(e){e.preventDefault();_wtRenaming={path:filePath,name:f.n,isDir:f.d};renderSidebar();}},
            f.d?h('span',{style:{fontSize:_fs(8),color:C.tx4,width:10,textAlign:'center',flexShrink:0}},isCol?'▶':'▼'):h('span',{style:{width:10,flexShrink:0}}),
            h('span',{style:{flexShrink:0,fontSize:_fs(13)}},f.d?'📁':'📄'),
            isRenaming?h('input',{autoFocus:true,defaultValue:f.n,style:{flex:1,background:C.bg3,border:'1px solid '+C.accent,borderRadius:3,padding:'1px 4px',color:C.tx1,fontFamily:C.mono,fontSize:_fs(11),outline:'none'},
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
            isRenaming?h('span',{style:{fontSize:_fs(12),color:C.red,cursor:'pointer',padding:'0 2px',flexShrink:0},title:'Smazat',
              onClick:function(e){e.stopPropagation();if(confirm('Smazat '+f.n+'?')){_wtDeleteItem(filePath);}_wtRenaming=null;renderSidebar();}},'×'):
            f.st?h('span',{style:{fontSize:_fs(9),fontWeight:700,color:stColors[f.st]||C.tx4,fontFamily:C.mono,flexShrink:0}},f.st):null);
        });
      })():null,
    ),
    /* Settings — pinned to bottom outside scroll area */
    h('div',{style:{padding:'4px 8px 2px',borderTop:'1px solid '+C.border,flexShrink:0}},
      h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',transition:'background 0.12s, color 0.12s'},
        onMouseEnter:function(e){if(s.active!=='settings'){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
        onMouseLeave:function(e){e.currentTarget.style.background=s.active==='settings'?C.accentBg:'transparent';e.currentTarget.style.color=s.active==='settings'?C.accentText:C.tx3;},
        onClick:function(){_wizardGuardNav('settings',set);}},
        svgEl(I.settings,18),h('span',{style:{fontSize:_fs(13.5),fontWeight:600}},'Nastavení'))));
}


/* ═══════════════════════════════════════════════════════════
   2. CENTER VIEW (ReactDOM.render into main panel)
   ═══════════════════════════════════════════════════════════ */
var _centerState={view:null,detail:null,detailConversations:null,openSections:{},zoom:1,listView:false,settingsSection:null,filterMode:'active',projectFilterMode:'active',_bulkMode:false,_bulkSelected:[]};
/* v125: Resizable detail panel — drag handle between main content and detail */
var _detailWidth=360; /* px, default width — persisted in localStorage */
try{var _dw=localStorage.getItem('c3-detail-width');if(_dw){var _parsed=parseInt(_dw,10);if(_parsed>=200&&_parsed<=900)_detailWidth=_parsed;}}catch(e){}
var _detailDragging=false;
function _startDetailDrag(e){
  e.preventDefault();_detailDragging=true;
  var startX=e.clientX,startW=_detailWidth;
  var container=document.getElementById('c3-center-mount');
  var maxW=container?Math.round(container.offsetWidth*0.7):700;
  function onMove(ev){
    var delta=startX-ev.clientX; /* drag left = wider detail */
    var newW=Math.max(200,Math.min(maxW,startW+delta));
    _detailWidth=newW;renderCenter();
  }
  function onUp(){
    _detailDragging=false;document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
    document.body.style.cursor='';document.body.style.userSelect='';
    try{localStorage.setItem('c3-detail-width',String(_detailWidth));}catch(e){}
  }
  document.body.style.cursor='col-resize';document.body.style.userSelect='none';
  document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
}
var _savedCenterState=null; /* saved state before wizard opens */
function _wizardSaveLayout(){_savedCenterState={zoom:_centerState.zoom,listView:_centerState.listView,detail:_centerState.detail,view:_centerState.view};_centerState.detail=null;_centerState.zoom=1;_centerState.listView=false;}
function _wizardRestoreLayout(){if(_savedCenterState){_centerState.zoom=_savedCenterState.zoom;_centerState.listView=_savedCenterState.listView;_centerState.view=_savedCenterState.view;_savedCenterState=null;}}
/* ═══ Editor tab state (Fáze 5 — Blok E) ═══ */
var _editorState={active:false,tabs:[],activeTabId:null,scrollRaf:null};
/* ═══ Project wizard state ═══ */
var _projectWizard={active:false,step:0,data:{name:'',path:'',description:'',type:'general',pathMode:'auto'},saving:false,defaultDir:''};
/* ═══ Expertise wizard state (v64.1) ═══ */
var _expertiseWizard={active:false,mode:'create',data:null,schema:null,preview:null,testResult:null,testLoading:false,testError:null,openSections:{basic:true},editId:null,saving:false,advancedMode:false,confirmAdvanced:false};
/* ═══ Agent wizard state (v65.5) ═══ */
var _agentWizard={active:false,mode:'create',data:null,schema:null,preview:null,testResult:null,testLoading:false,testError:null,openSections:{basic:true},editId:null,saving:false,advancedMode:false,confirmAdvanced:false,simpleStep:1};
/* ═══ Specialist wizard state (v122.2) ═══ */
var _specialistWizard={active:false,step:0,data:{name:'',domain:'general',description:'',icon:''},saving:false,error:null};
/* ═══ Wizard navigation guard ═══ */
function _wizardGuardNav(targetView,sidebarSet,extra){
  /* v93: Toggle — same nav item clicked again → hide center, show editor */
  if(targetView===_centerState.view&&!_projectWizard.active&&!_expertiseWizard.active&&!_agentWizard.active&&!_specialistWizard.active&&!_editorState.active){
    _centerState.view=null;_centerState.detail=null;
    _settingsVals.lastView='';_saveSV();
    sidebarSet({active:null,dd:{}});
    /* v122.3: Re-enable conversation focus for non-project sessions instead of hiding center */
    var _as=_sessions[_sessionActive];
    if(_as&&!_as._projectId&&!_as.chat.specialist){_as._conversationFocus=true;_syncFocusClass();renderCenter();renderChat();return;}
    if(_centerContainer)_centerContainer.style.display='none';
    return;
  }
  /* v92+v122.2: Focus mode intercept */
  if(isFocusActive()){
    /* Conversation focus: just exit silently and navigate */
    if(isConversationFocus()){
      _sessions[_sessionActive]._conversationFocus=false;_syncFocusClass();renderCenter();renderChat();
      /* fall through to normal navigation below */
    }else{
      /* Specialist focus: show exit confirmation dialog */
      var det2={view:targetView};if(extra)for(var k2 in extra)det2[k2]=extra[k2];
      _focusExitDialog={pendingAction:function(){sidebarSet({active:targetView,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:det2}));}};
      renderCenter();
      return;
    }
  }
  var label=_projectWizard.active?'vytváření projektu':_expertiseWizard.active?'editaci expertýzy':_agentWizard.active?'vytváření workeru':_specialistWizard.active?'vytváření specialisty':null;
  var det={view:targetView};if(extra)for(var k in extra)det[k]=extra[k];
  if(!label){sidebarSet({active:targetView,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:det}));return;}
  if(!confirm('Opravdu chcete ukončit '+label+'? Neuložené změny budou ztraceny.'))return;
  _projectWizard.active=false;_projectWizard.saving=false;
  _expertiseWizard.active=false;_agentWizard.active=false;_specialistWizard.active=false;
  _savedCenterState=null;
  sidebarSet({active:targetView,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:det}));
}

/* ═══ Domain → capability/module presets (v64.2) ═══ */
var _DOMAIN_PRESETS={
  law:{label:'Právo',caps:{reasoning:80,creativity:10,determinism:90,riskTolerance:5,verbosity:70},tone:'professional',temperature:0.25,
    modules:{domain_rules:['Dodržuj platnou legislativu ČR','Vždy cituj příslušný zákon nebo paragraf'],emphasis:['Přesnost právní terminologie','Strukturované odpovědi'],constraints:['Nikdy neposkytuj závaznou právní radu','Odkaz na advokáta pro konkrétní případy'],vocabulary:['žalobce','žalovaný','odvolání','usnesení','nález'],antipatterns:['Zjednodušování právních pojmů bez vysvětlení'],disclaimer:'Toto jsou obecné informace, nikoli právní rada. Konzultujte advokáta.'}},
  medicine:{label:'Medicína',caps:{reasoning:70,creativity:10,determinism:85,riskTolerance:5,verbosity:60},tone:'empathetic',temperature:0.3,
    modules:{domain_rules:['Vycházej z evidence-based medicíny','Rozlišuj urgentní a neurgentní stavy'],emphasis:['Bezpečnost pacienta','Srozumitelnost'],constraints:['Nikdy nediagnostikuj','Vždy doporuč návštěvu lékaře'],vocabulary:['anamnéza','diagnóza','indikace','kontraindikace'],antipatterns:['Předepisování léků','Diagnóza na dálku'],disclaimer:'Edukační informace, nikoli lékařská rada. Poraďte se s lékařem.'}},
  finance:{label:'Finance',caps:{reasoning:75,creativity:5,determinism:95,riskTolerance:5,verbosity:50},tone:'professional',temperature:0.2,
    modules:{domain_rules:['Pracuj s aktuální legislativou ČR','Rozlišuj FO a PO'],emphasis:['Přesnost výpočtů','Daňové termíny'],constraints:['Nenahrazuj daňového poradce','Vždy upozorni na možné sankce'],vocabulary:['DPH','základ daně','odpisy','DPFO','DPPO'],antipatterns:['Zaručené daňové rady'],disclaimer:'Konzultujte daňového poradce pro konkrétní situaci.'}},
  creative:{label:'Kreativní psaní',caps:{reasoning:40,creativity:90,determinism:10,riskTolerance:70,verbosity:90},tone:'casual',temperature:0.8,
    modules:{domain_rules:['Piš originálně a poutavě','Pracuj s emocemi a atmosférou'],emphasis:['Kreativita','Originalita','Styl'],constraints:[],vocabulary:[],antipatterns:['Klišé','Generické fráze'],disclaimer:null}},
  tech:{label:'Technologie',caps:{reasoning:80,creativity:40,determinism:70,riskTolerance:30,verbosity:30},tone:'professional',temperature:0.4,
    modules:{domain_rules:['Uváděj konkrétní verze a kompatibilitu','Preferuj osvědčená řešení'],emphasis:['Přesnost','Praktičnost','Kódové ukázky'],constraints:['Nenavrhuj neověřené technologie bez upozornění'],vocabulary:[],antipatterns:['Vágní doporučení bez příkladů'],disclaimer:null}},
  psychology:{label:'Psychologie',caps:{reasoning:60,creativity:50,determinism:30,riskTolerance:40,verbosity:70},tone:'empathetic',temperature:0.5,
    modules:{domain_rules:['Používej empatický a podpůrný tón','Normalizuj emoce'],emphasis:['Aktivní naslouchání','Bezpečný prostor'],constraints:['Nikdy nediagnostikuj poruchy','Nedávej terapeutické rady'],vocabulary:['emoce','prožívání','zvládání','strategie'],antipatterns:['Bagatelizování pocitů','Nezvaná rada'],disclaimer:'Podpůrné informace, nikoli terapie. Linka bezpečí 116 111.'}},
  general:{label:'Obecný',caps:{reasoning:50,creativity:50,determinism:50,riskTolerance:50,verbosity:50},tone:'professional',temperature:0.5,
    modules:{domain_rules:[],emphasis:[],constraints:[],vocabulary:[],antipatterns:[],disclaimer:null}}
};
function _ewDetectDomain(name,domain){
  var text=(name+' '+domain).toLowerCase();
  var map=[
    {keys:['prav','law','legal','legislat','advokat','zakon'],preset:'law'},
    {keys:['medic','doctor','lekar','zdravot','medical','zdrav'],preset:'medicine'},
    {keys:['financ','ucet','dane','daňov','account','bank','invest'],preset:'finance'},
    {keys:['creat','kreativ','writer','psat','pisan','basn','pribeh','story'],preset:'creative'},
    {keys:['tech','dev','program','kod','code','software','it','cyber'],preset:'tech'},
    {keys:['psych','therap','terapi','mental','emoc','counsel'],preset:'psychology'}
  ];
  for(var i=0;i<map.length;i++){for(var j=0;j<map[i].keys.length;j++){if(text.indexOf(map[i].keys[j])!==-1)return map[i].preset;}}
  return 'general';
}
function _ewApplyPreset(presetId){
  var p=_DOMAIN_PRESETS[presetId]||_DOMAIN_PRESETS.general;
  var d=_expertiseWizard.data;
  d.capabilities={reasoning:p.caps.reasoning,creativity:p.caps.creativity,determinism:p.caps.determinism,riskTolerance:p.caps.riskTolerance,verbosity:p.caps.verbosity};
  d.tone=p.tone;d.temperature=p.temperature;
  d.modules={domain_rules:(p.modules.domain_rules||[]).slice(),emphasis:(p.modules.emphasis||[]).slice(),constraints:(p.modules.constraints||[]).slice(),vocabulary:(p.modules.vocabulary||[]).slice(),antipatterns:(p.modules.antipatterns||[]).slice(),disclaimer:p.modules.disclaimer||null};
  _ewPreview();renderCenter();
}
var WIZARD_STEPS=[
  {id:'mode',label:'Režim',icon:'🚀',desc:'Nový nebo existující projekt'},
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
var _centerRoot=null;
function renderCenter(){if(!_centerContainer)return;if(!_centerRoot)_centerRoot=_createRoot(_centerContainer);_centerRoot.render(h(CenterApp,null));}

function CenterApp(){
  /* v92+v122.2: Focus mode — full-width chat in center (specialist or conversation) */
  if(isFocusActive()){
    var _spec=(_sessions[_sessionActive]&&_sessions[_sessionActive].chat)?_sessions[_sessionActive].chat.specialist:null;
    var _isConvFocus=isConversationFocus();
    return h('div',{style:{display:'flex',height:'100%',width:'100%',background:C.bg0,fontFamily:C.font,position:'relative'}},
      h('div',{key:'cv-focus',style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
        _chatPaneUI(_sessionActive,{fullWidth:true})),
      /* Focus exit confirmation dialog */
      _focusExitDialog?h('div',{style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.55)',zIndex:80,display:'flex',alignItems:'center',justifyContent:'center'},
        onClick:function(ev){ev.stopPropagation();_focusExitDialog=null;renderCenter();}},
        h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,padding:'20px 24px',minWidth:280,maxWidth:380,boxShadow:'0 12px 40px rgba(0,0,0,0.5)'},
          onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{fontSize:_fs(14),fontWeight:700,color:C.tx1,marginBottom:6}},_isConvFocus?'Zavřít konverzaci?':'Ukončit režim specialisty?'),
          _spec?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:14}},
            h('span',null,'Aktivní: '),h('span',{style:{fontWeight:600}},(_spec.emoji||'')+' '+(_spec.name||'Specialista'))):null,
          _isConvFocus?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:14}},'Chat zůstane uložen.'):null,
          h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
            h('button',{style:{background:'transparent',color:C.tx3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 16px',fontSize:_fs(11),fontWeight:600,cursor:'pointer'},
              onClick:function(){_focusExitDialog=null;renderCenter();}},'Zůstat'),
            h('button',{style:{background:'rgba(239,68,68,0.15)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',borderRadius:6,padding:'6px 16px',fontSize:_fs(11),fontWeight:600,cursor:'pointer'},
              onClick:function(){var pa=_focusExitDialog?_focusExitDialog.pendingAction:null;_focusExitDialog=null;if(_isConvFocus){_sessions[_sessionActive]._conversationFocus=false;_syncFocusClass();renderCenter();renderChat();}else{if(window._c3)window._c3.clearSpecialist();}if(pa)pa();}},'Zavřít')))):null);
  }
  var view=_centerState.view,detail=_centerState.detail;
  var isOverlay=_expertiseWizard.active||_agentWizard.active||_projectWizard.active||_specialistWizard.active||_editorState.active;
  var mainContent=isOverlay?(
    _expertiseWizard.active?centerExpertiseWizard():
    _agentWizard.active?centerAgentWizard():
    _projectWizard.active?centerProjectWizard():
    _specialistWizard.active?centerSpecialistWizard():
    centerEditor()
  ):(
    view==='expertises'?centerExpertises():view==='projects'?centerProjects():view==='chats'?centerConvos():
    view==='specialists'?centerSpecs():view==='workers'?centerWorkers():view==='settings'?centerSettings():view==='upgrades'?centerUpgrades():view==='marketplace'?centerMarketplace():view==='multimedia'?centerMultimedia():centerWelcome()
  );
  var showDetail=detail&&!isOverlay;
  /* v93: Solid background when view/overlay active — prevents editor bleed-through on pro themes */
  var bgColor=(view||isOverlay)?(C._solidBg0||C.bg0):C.bg0;
  return h('div',{style:{display:'flex',height:'100%',width:'100%',background:bgColor,fontFamily:C.font,overflow:'hidden',position:'absolute',top:0,left:0,right:0,bottom:0}},
    h('div',{key:'cv-'+(isOverlay?'overlay':view),style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}},mainContent),
    showDetail?h(React.Fragment,null,
      /* v125: Drag handle — resizable detail panel */
      h('div',{onMouseDown:_startDetailDrag,style:{width:5,cursor:'col-resize',background:_detailDragging?C.accent:'transparent',flexShrink:0,transition:_detailDragging?'none':'background 0.2s',zIndex:2},
        onMouseEnter:function(e){if(!_detailDragging)e.currentTarget.style.background=C.border2;},
        onMouseLeave:function(e){if(!_detailDragging)e.currentTarget.style.background='transparent';}}),
      h('div',{style:{width:_detailWidth,minWidth:200,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',overflow:'hidden',background:C.bg1,flexShrink:0}},centerDetail())):null);
}

function _mpNavBtn(tab){return h('button',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'4px 10px',fontSize:_fs(11),fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:10,color:C.tx2,fontFamily:C.font},onClick:function(){_mpTab=tab;_mpData=null;window.dispatchEvent(new CustomEvent('c3-nav',{detail:{view:'marketplace'}}));}},svgEl(I.store,12),'Marketplace');}
function viewHead(t,showZoom,onAdd,extraBtn){
  return h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
    h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},t),
    extraBtn||null,
    onAdd?h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'4px 10px',fontSize:_fs(11),fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:10},onClick:onAdd},svgEl(I.plus,12),'Nový'):null,
    showZoom?h('div',{style:{display:'flex',alignItems:'center',gap:6}},
      svgEl('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',14),
      h('input',{type:'range',min:100,max:135,step:5,value:Math.round((_centerState.zoom||1)*100),onChange:function(e){_centerState.zoom=parseInt(e.target.value)/100;renderCenter();},
        style:{width:70,accentColor:C.accent,cursor:'pointer'}}),
      h('span',{style:{fontSize:_fs(9),color:C.tx4,fontFamily:C.mono,minWidth:26}},Math.round((_centerState.zoom||1)*100)+'%'),
      h('div',{style:{width:1,height:16,background:C.border,margin:'0 2px'}}),
      h('div',{style:{display:'flex',gap:2}},
        h('button',{style:{background:!_centerState.listView?C.bg4:'transparent',border:'none',borderRadius:4,padding:4,cursor:'pointer',display:'flex',color:!_centerState.listView?C.tx1:C.tx4},onClick:function(){_centerState.listView=false;renderCenter();},title:'Dlaždice'},svgEl('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',14)),
        h('button',{style:{background:_centerState.listView?C.bg4:'transparent',border:'none',borderRadius:4,padding:4,cursor:'pointer',display:'flex',color:_centerState.listView?C.tx1:C.tx4},onClick:function(){_centerState.listView=true;renderCenter();},title:'Seznam'},svgEl('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',14)))
    ):null);
}

function _favClick(item){return function(ev){ev.stopPropagation();item.fav=!item.fav;if(item.id){fetch(_backendBase+'/api/expertises/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:item.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderCenter();};}

function card(item,onClick){
  var sel=_centerState.detail&&_centerState.detail.name===item.name;
  var isLines=_settingsVals.visualMode==='lines';
  var ell={whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
  var bm=_centerState._bulkMode;
  var _iid=item._itemId||item.id;
  var bSel=bm&&_iid&&_centerState._bulkSelected.indexOf(_iid)>=0;
  /* Bulk checkbox element */
  var chkBox=bm?h('div',{style:{width:18,height:18,borderRadius:4,border:'2px solid '+(bSel?C.accent:C.tx4),background:bSel?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}},
    bSel?h('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'#fff',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('polyline',{points:'20 6 9 17 4 12'})):null):null;
  /* ═══ LIST VIEW ═══ */
  if(_centerState.listView){
    var listS={display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'all 0.15s',position:'relative'};
    if(bSel){listS.background='rgba(34,197,94,0.15)';listS.borderLeft=isLines?'4px solid '+C.accent:undefined;if(!isLines){listS.border='2px solid '+C.accent;listS.borderRadius=8;listS.marginBottom=4;listS.boxShadow='0 0 0 1px '+C.accent;}}
    else if(isLines){listS.borderBottom='1px solid '+C.border;listS.background=sel?'rgba(34,197,94,0.05)':'transparent';}
    else{listS.background=sel?'rgba(34,197,94,0.06)':C.bg2;listS.border='1px solid '+(sel?C.accent:C.border);listS.borderRadius=8;listS.marginBottom=4;}
    return h('div',{key:item.name,onClick:onClick,style:listS,
      onMouseEnter:function(e){if(!sel&&!bSel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':'rgba(255,255,255,0.04)';},
      onMouseLeave:function(e){if(!sel&&!bSel)e.currentTarget.style.background=bSel?'rgba(34,197,94,0.15)':isLines?'transparent':(sel?'rgba(34,197,94,0.06)':C.bg2);}},
      isLines&&sel&&!bSel?h('div',{style:{position:'absolute',left:0,top:0,bottom:0,width:3,background:C.accent,borderRadius:'0 2px 2px 0'}}):null,
      chkBox,
      item.emoji?h('span',{style:{fontSize:_fs(16),flexShrink:0,width:24,textAlign:'center'}},item.emoji):null,
      h('div',{style:Object.assign({fontSize:_fs(12),fontWeight:bSel?700:600,color:bSel?C.accentText:sel?C.accentText:C.tx1,flex:'0 1 auto',maxWidth:'40%',minWidth:80},ell)},item.name),
      h('div',{style:Object.assign({flex:1,fontSize:_fs(11),color:C.tx3,minWidth:0},ell)},item.desc||''),
      item.status?pill(item.status):null,
      item.age?h('span',{style:{fontSize:_fs(10),color:C.tx4,fontFamily:C.mono,flexShrink:0,minWidth:28,textAlign:'right'}},item.age):null,
      item.fav!==undefined?h('span',{style:{fontSize:_fs(14),color:item.fav?C.accentText:C.tx4,cursor:'pointer',padding:'0 2px',userSelect:'none',flexShrink:0},onClick:_favClick(item)},item.fav?'★':'☆'):null);
  }
  /* ═══ Shared grid card body — emoji+name header, desc, status ═══ */
  var body=[
    bm?h('div',{key:'cb',style:{marginBottom:6}},chkBox):null,
    h('div',{key:'h',style:{display:'flex',alignItems:'center',gap:10,marginBottom:item.desc||item.status?6:0}},
      item.emoji?h('span',{style:{fontSize:_fs(22)}},item.emoji):null,
      h('div',{style:Object.assign({flex:1,fontSize:_fs(13),fontWeight:700,color:bSel?C.accentText:C.tx1,minWidth:0},ell)},item.name),
      item.age?h('span',{style:{fontSize:_fs(10),color:C.tx4,fontFamily:C.mono,flexShrink:0}},item.age):null,
      item.fav!==undefined?h('span',{style:{fontSize:_fs(14),color:item.fav?C.accentText:C.tx4,cursor:'pointer',userSelect:'none'},onClick:_favClick(item)},item.fav?'★':'☆'):null),
    item.desc?h('div',{key:'d',style:Object.assign({fontSize:_fs(11),color:C.tx3,lineHeight:'1.4',marginBottom:item.status?6:0},ell)},item.desc):null,
    item.status?h('div',{key:'s'},pill(item.status)):null
  ];
  /* ═══ GRID — lines mode (no bg, separator borders, hover highlight) ═══ */
  if(isLines){
    var linesBg=bSel?'rgba(34,197,94,0.12)':sel?'rgba(34,197,94,0.05)':'transparent';
    return h('div',{key:item.name,onClick:onClick,
      style:{padding:14,cursor:'pointer',borderBottom:'1px solid '+C.border,borderRight:'1px solid '+C.border,
        background:linesBg,transition:'background 0.15s',position:'relative'},
      onMouseEnter:function(e){if(!sel&&!bSel)e.currentTarget.style.background='rgba(255,255,255,0.025)';},
      onMouseLeave:function(e){e.currentTarget.style.background=linesBg;}},
      bSel?h('div',{style:{position:'absolute',left:0,top:0,bottom:0,width:4,background:C.accent}}):null,
      body);
  }
  /* ═══ GRID — borders mode (card with bg, border, radius) ═══ */
  var cardBg=bSel?'rgba(34,197,94,0.08)':C.bg2;
  var cardBorder=bSel?'2px solid '+C.accent:'1px solid '+(sel?C.accent:C.border);
  var cardShadow=bSel?'0 0 0 2px rgba(34,197,94,0.3)':sel?'0 0 0 1px '+C.accent:'none';
  return h('div',{key:item.name,className:'c3-card',onClick:onClick,
    style:{background:cardBg,border:cardBorder,borderRadius:12,padding:16,
      cursor:'pointer',position:'relative',overflow:'hidden',
      transition:'border-color 0.2s,box-shadow 0.2s,background 0.2s',
      boxShadow:cardShadow},
    onMouseEnter:function(e){if(!sel&&!bSel){e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';}},
    onMouseLeave:function(e){if(!sel&&!bSel){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';}}},
    body);
}

function pill(s){var st=_s(s);var m={Active:{b:'rgba(34,197,94,0.1)',c:C.accentText},Done:{b:C.blueBg,c:C.blue},WIP:{b:C.amberBg,c:C.amber},Running:{b:'rgba(34,197,94,0.1)',c:C.accentText},Paused:{b:C.amberBg,c:C.amber},Deleted:{b:C.redBg,c:C.red},Archived:{b:C.bg4,c:C.tx3}};var v=m[st]||{b:C.bg4,c:C.tx3};return h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:_fs(9),fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',fontFamily:C.mono,background:v.b,color:v.c}},st);}

/* Relative age: "2h" / "3d" / "1t" (weeks) / "2m" */
function _relAge(dateStr){
  if(!dateStr)return '';
  var d=new Date(dateStr);if(isNaN(d.getTime()))return '';
  var ms=Date.now()-d.getTime();if(ms<0)return '';
  var hrs=Math.floor(ms/3600000);
  if(hrs<1)return '<1h';
  if(hrs<24)return hrs+'h';
  var days=Math.floor(hrs/24);
  if(days<7)return days+'d';
  var weeks=Math.floor(days/7);
  if(weeks<5)return weeks+'t';
  var months=Math.floor(days/30);
  return months+'m';
}
/* Format ISO date for detail display: "28. 2. 2026, 14:30" */
function _fmtDate(dateStr){
  if(!dateStr)return '—';
  var d=new Date(dateStr);if(isNaN(d.getTime()))return dateStr;
  var day=d.getDate(),mon=d.getMonth()+1,yr=d.getFullYear();
  var hh=String(d.getHours()).padStart(2,'0'),mm=String(d.getMinutes()).padStart(2,'0');
  return day+'. '+mon+'. '+yr+', '+hh+':'+mm;
}

function grid(items){
  var zoomVal=_centerState.zoom||1;
  var isLines=_settingsVals.visualMode==='lines';
  var inner;
  if(_centerState.listView){inner=h('div',{style:{display:'flex',flexDirection:'column',gap:isLines?0:4}},items);}
  else if(isLines){inner=h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:0,alignContent:'start',borderTop:'1px solid '+C.border,borderLeft:'1px solid '+C.border}},items);}
  else{inner=h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12,alignContent:'start'}},items);}
  if(zoomVal!==1){return h('div',{style:{zoom:String(zoomVal),transformOrigin:'top left'}},inner);}
  return inner;
}

function setDetail(d){
  _centerState.detail=d;_centerState.detailConversations=null;
  /* v65.5: Fetch conversations for projects */
  if(d&&_centerState.view==='projects'){
    var proj=PROJECTS.find(function(p){return p.name===d.name;});
    if(proj&&proj.id){
      fetch(_backendBase+'/api/projects/'+proj.id+'/conversations?limit=3',{signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(data){
        var convs=(data.conversations||[]).sort(function(a,b){return(b.updated||b.created||'').localeCompare(a.updated||a.created||'');});
        _centerState.detailConversations=convs.slice(0,3);renderCenter();
      }).catch(function(){_centerState.detailConversations=[];renderCenter();});
    }
  }
  renderCenter();
}

function _addNew(view){
  /* Expertises → dispatch wizard open event (center-views-module.js listens) */
  if(view==='expertises'){
    _ewOpen('create',null,null);
    return;
  }
  /* Workers → agent wizard (v65.5) */
  if(view==='workers'){_awOpen('create',null,null);return;}
  /* Conversations → create via API, link to session */
  if(view==='chats'){
    _smartRouteToRelay(function(_ti){
      fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nová konverzace',expertise:'Výchozí'}),signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(created){
        if(created.id){
          _sessions[_ti]._convId=created.id;
          _sessions[_ti]._label='Nová konverzace';
          _sessions[_ti].chat.msgs=[{role:'system',text:'📂 Nová konverzace vytvořena.'}];
          _sessions[_ti].chat.ctx=0;
          _persistSessionState();renderChat();_chatScrollPane(_ti);
        }
        fetchBackendData();
      }).catch(function(){
        _sessions[_ti]._label='Nová konverzace';
        _sessions[_ti].chat.msgs=[{role:'system',text:'📂 Nová konverzace (lokální).'}];
        _sessions[_ti].chat.ctx=0;
        _persistSessionState();renderChat();
      });
    });
    return;
  }
  /* Projects → open multi-step wizard in center view */
  if(view==='projects'){
    _wizardSaveLayout();
    _projectWizard={active:true,step:0,data:{name:'',path:'',description:'',type:'general',pathMode:'auto',mode:'create'},saving:false,defaultDir:_settingsVals.projectsDir||''};
    if(!_projectWizard.defaultDir){
      /* First use or not configured — fetch from backend, offer to save */
      fetch(_backendBase+'/api/projects/defaults',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(j){
        if(j.defaultDir){_projectWizard.defaultDir=j.defaultDir;if(!_settingsVals.projectsDir){_settingsVals.projectsDir=j.defaultDir;_saveSV();}renderCenter();}
      }).catch(function(){});
    }
    renderCenter();
    return;
  }
  /* v122.2: Specialists → center-panel wizard */
  if(view==='specialists'){
    _wizardSaveLayout();
    _specialistWizard={active:true,step:0,data:{name:'',domain:'general',description:'',icon:''},saving:false,error:null};
    renderCenter();
    return;
  }
  setDetail({name:'Nová položka',fields:[{k:'Popis',v:''}],tags:[],actions:['Uložit','Zrušit'],editing:true,_isNew:true});
}

function centerExpertises(){return h(React.Fragment,null,viewHead('Expertyzy',true,function(){_addNew('expertises');},_mpNavBtn('expertises')),_bulkBar('expertises'),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(EXPERTISES.map(function(e){var tags=[e.isSpecialist?'Specialista':'Expertyza'];if(e.domain)tags.push(e.domain);return card(e,function(){if(_centerState._bulkMode){_bulkToggleItem(e.id);return;}setDetail({name:e.name,_itemId:e.id,fields:[{k:'Typ',v:e.desc},{k:'Doména',v:e.domain||'general'},{k:'Emoji',v:e.emoji},{k:'Specialista',v:e.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:e.fav,type:'fav',_expertiseName:e.name}],tags:tags,actions:['Otevřít','Editovat','Publikovat','Smazat']});});}))));}

/* ═══ Shared filter bar: [Označit] (bulk actions) ... [Aktivní] [Archivované] [Smazané] ═══ */
function _filterBar(filterKey,view){
  var fm=_centerState[filterKey]||'active';
  var bm=_centerState._bulkMode;
  var bs=_centerState._bulkSelected;
  var cats=[{id:'active',label:'Aktivní'},{id:'archived',label:'Archivované'},{id:'deleted',label:'Smazané'}];
  function _setFilter(id){_centerState[filterKey]=id;_centerState._bulkMode=false;_centerState._bulkSelected=[];_centerState.detail=null;fetchBackendData();renderCenter();}
  function _toggleBulk(){_centerState._bulkMode=!_centerState._bulkMode;_centerState._bulkSelected=[];renderCenter();}
  function _bulkAction(action){
    if(bs.length===0)return;
    var ep=view==='projects'?'/api/projects/':'/api/conversations/';
    var promises=bs.map(function(id){
      if(action==='archive')return fetch(_backendBase+ep+id+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)});
      if(action==='delete')return fetch(_backendBase+ep+id,{method:'DELETE',signal:AbortSignal.timeout(3000)});
      if(action==='restore')return fetch(_backendBase+ep+id+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)});
      return Promise.resolve();
    });
    Promise.all(promises).then(function(){_centerState._bulkMode=false;_centerState._bulkSelected=[];_centerState.detail=null;fetchBackendData();renderCenter();}).catch(function(){fetchBackendData();renderCenter();});
  }
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',
    background:bm?C.accent:'transparent',color:bm?'#fff':C.tx4,transition:'background 0.15s'};
  return h('div',{style:{padding:'4px 18px 0',display:'flex',alignItems:'center',gap:6}},
    /* Left: Označit + bulk actions */
    h('button',{style:markBtnS,onClick:_toggleBulk},bm?'Označit ✓':'Označit'),
    bm&&bs.length>0?h(React.Fragment,null,
      fm!=='archived'?h('button',{style:{border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',background:C.accentBg,color:C.accentText},
        onClick:function(){_bulkAction(fm==='deleted'?'restore':'archive');}},(fm==='deleted'?'Obnovit':'Archivovat')+' ('+bs.length+')'):null,
      h('button',{style:{border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',background:'rgba(239,68,68,0.1)',color:C.red},
        onClick:function(){_bulkAction('delete');}},'Smazat ('+bs.length+')'),
      h('button',{style:{border:'none',borderRadius:4,padding:'3px 6px',fontSize:_fs(10),cursor:'pointer',background:'transparent',color:C.tx4},
        onClick:function(){_centerState._bulkSelected=[];renderCenter();}},'Zrušit')):null,
    /* Spacer */
    h('div',{style:{flex:1}}),
    /* Right: Categories */
    cats.map(function(cat){
      var isSel=fm===cat.id;
      return h('button',{key:cat.id,style:{border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',
        background:isSel?C.bg4:'transparent',color:isSel?C.tx1:C.tx4,transition:'background 0.15s'},
        onClick:function(){_setFilter(cat.id);}},cat.label);
    }));
}
function _bulkToggleItem(id){
  var idx=_centerState._bulkSelected.indexOf(id);
  if(idx>=0){_centerState._bulkSelected.splice(idx,1);}else{_centerState._bulkSelected.push(id);}
  renderCenter();
}

/* v122.2: Simplified bulk bar for expertises/specialists (no archive filter — hard delete only) */
function _bulkBar(view){
  var bm=_centerState._bulkMode;
  var bs=_centerState._bulkSelected;
  function _toggleBulk(){_centerState._bulkMode=!_centerState._bulkMode;_centerState._bulkSelected=[];renderCenter();}
  function _bulkDelete(){
    if(bs.length===0)return;
    var ep='/api/expertises/';
    var promises=bs.map(function(id){
      /* For specialists, disable first then delete expertise */
      var spec=SPECIALISTS.find(function(s){return s.id===id;});
      var chain=spec?fetch(_backendBase+'/api/specialists/'+id+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).catch(function(){}):Promise.resolve();
      return chain.then(function(){return fetch(_backendBase+ep+id,{method:'DELETE',signal:AbortSignal.timeout(3000)});});
    });
    Promise.all(promises).then(function(){_centerState._bulkMode=false;_centerState._bulkSelected=[];_centerState.detail=null;_fetchExpertises();renderCenter();}).catch(function(){_fetchExpertises();renderCenter();});
  }
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',
    background:bm?C.accent:'transparent',color:bm?'#fff':C.tx4,transition:'background 0.15s'};
  return h('div',{style:{padding:'4px 18px 0',display:'flex',alignItems:'center',gap:6}},
    h('button',{style:markBtnS,onClick:_toggleBulk},bm?'Označit \u2713':'Označit'),
    bm&&bs.length>0?h(React.Fragment,null,
      h('button',{style:{border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',background:'rgba(239,68,68,0.1)',color:C.red},
        onClick:_bulkDelete},'Smazat ('+bs.length+')'),
      h('button',{style:{border:'none',borderRadius:4,padding:'3px 6px',fontSize:_fs(10),cursor:'pointer',background:'transparent',color:C.tx4},
        onClick:function(){_centerState._bulkSelected=[];renderCenter();}},'Zrušit')):null);
}

function centerProjects(){
  var fm=_centerState.projectFilterMode||'active';
  /* v82: Defensive guard — only render items with emoji 📁 (projects). Log any contamination. */
  var _contaminated=PROJECTS.filter(function(p){return p.emoji!=='📁';});
  if(_contaminated.length>0&&typeof console!=='undefined'){console.warn('[C3:centerProjects] CONTAMINATION:',_contaminated.length,'non-project items in PROJECTS!',_contaminated.map(function(p){return p.name+'('+p.emoji+')';}));}
  var filtered=PROJECTS.filter(function(p){return p.emoji==='📁';});
  return h(React.Fragment,null,viewHead('Projekty',true,function(){_addNew('projects');}),
    _filterBar('projectFilterMode','projects'),
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(filtered.map(function(p){
      var isDeleted=p.status==='deleted';
      var isArchived=p.status==='archived'||p.status==='Archived';
      var actions=isDeleted?['Obnovit','Smazat trvale']:isArchived?['Otevřít','Obnovit','Smazat']:['Otevřít','Editovat','Archivovat','Smazat'];
      return card(Object.assign({},p,{age:_relAge(p.updated)}),function(){if(_centerState._bulkMode){_bulkToggleItem(p.id);return;}setDetail({name:p.name,_itemId:p.id,fields:[{k:'Status',v:p.status||'active',a:!isArchived&&!isDeleted},{k:'Cesta',v:p.path||''},{k:'Popis',v:p.desc||''},{k:'Vytvořeno',v:_fmtDate(p.created)},{k:'Poslední aktivita',v:_fmtDate(p.updated)}],tags:p.tags,actions:actions});});
    }))));
}

function centerConvos(){
  var fm=_centerState.filterMode||'active';
  return h(React.Fragment,null,
    viewHead('Konverzace',true,function(){_addNew('chats');}),
    _filterBar('filterMode','chats'),
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(CONVERSATIONS.map(function(c){
      var isDeleted=c.status==='deleted';
      var isArchived=c.status==='archived';
      var actions=isDeleted?['Obnovit','Smazat trvale']:isArchived?['Otevřít','Obnovit','Smazat']:['Otevřít','Přidat do projektu','Archivovat','Smazat'];
      return card({name:c.title,emoji:'💬',desc:c.preview||'',age:_relAge(c.updated_at||c.time),status:isDeleted?'Deleted':isArchived?'Archived':null,_convData:c,_itemId:c.id},
        function(){if(_centerState._bulkMode){_bulkToggleItem(c.id);return;}setDetail({name:c.title,fields:[{k:'Vytvořeno',v:_fmtDate(c.created_at||c.time)},{k:'Poslední aktivita',v:_fmtDate(c.updated_at||c.time)},{k:'Status',v:c.status||'active'}],tags:['Chat'],actions:actions});});
    }))));
}

function centerSpecs(){
  var activeSp=(_sessions[_sessionActive]||_sessions[0]).chat.specialist;
  return h(React.Fragment,null,viewHead('Specialisté',true,function(){_addNew('specialists');},_mpNavBtn('specialists')),_bulkBar('specialists'),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(SPECIALISTS.map(function(s){
    var isActive=activeSp&&(activeSp.name===s.name||activeSp.id===s.id);
    var actions=isActive?['Deaktivovat','Smazat']:['Otevřít','Editovat','Publikovat','Smazat'];
    return card(Object.assign({},s,{status:isActive?'Aktivní':null}),function(){if(_centerState._bulkMode){_bulkToggleItem(s.id);return;}setDetail({name:s.name,_itemId:s.id,fields:[{k:'Oblast',v:s.desc},{k:'Doména',v:s.domain||''},{k:'Status',v:isActive?'Aktivní':'Neaktivní'}],tags:s.tags,actions:actions});});
  }))));
}

function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',true,function(){_addNew('workers');},_mpNavBtn('skills')),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(WORKERS.map(function(w){return card({name:w.name,emoji:'⚙️',desc:w.desc,status:w.status},function(){setDetail({name:w.name,fields:[{k:'Status',v:w.status,a:w.status==='Running'},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:['Spustit','Pozastavit','Editovat']});});}))));}

/* ═══ PROJECT CREATION WIZARD ═══ */
function _wizardCanNext(){
  var d=_projectWizard.data,s=_projectWizard.step;
  if(s===0)return!!d.mode;
  if(s===1)return d.name.trim().length>=2;
  if(s===2)return!!d.type;
  if(s===3)return d.pathMode==='auto'||d.path.trim().length>=1;
  return true;
}
function _openExistingProject(){
  /* 1. Try Theia's electronTheiaFilesystem API (works in Theia Electron) */
  if(window.electronTheiaFilesystem&&window.electronTheiaFilesystem.showOpenDialog){
    window.electronTheiaFilesystem.showOpenDialog({
      title:'Vyberte složku projektu',
      openFolders:true,
      openFiles:false,
      selectMany:false,
      modal:true
    }).then(function(filePaths){
      if(filePaths&&filePaths.length>0){
        _doOpenExistingProject(filePaths[0]);
      }
    }).catch(function(e){
      if(window._c3)window._c3.agentLog('TOOL','❌ Dialog selhal: '+(e.message||e));
    });
    return;
  }

  /* 2. Fallback: webkitdirectory file picker with Electron file.path */
  try{
    var inp=document.createElement('input');inp.type='file';inp.webkitdirectory=true;
    inp.addEventListener('change',function(){
      if(!inp.files||inp.files.length===0)return;
      var fp=inp.files[0].path||'';
      /* Validate absolute path (/ on Linux/Mac, drive letter on Windows) */
      if(fp&&(fp.charAt(0)==='/'||/^[A-Z]:\\/i.test(fp))){
        var parts=fp.replace(/\\/g,'/').split('/');
        var folderPath=parts.slice(0,-1).join('/');
        if(folderPath){_doOpenExistingProject(folderPath);return;}
      }
      if(window._c3)window._c3.agentLog('TOOL','❌ Nelze určit absolutní cestu. Použijte: /open <absolutní_cesta>');
    });
    inp.click();
  }catch(e){
    if(window._c3)window._c3.agentLog('TOOL','❌ Nelze otevřít dialog: '+(e.message||e));
  }
}
function _doOpenExistingProject(folderPath){
  if(!folderPath||!folderPath.trim()){if(window._c3)window._c3.agentLog('TOOL','❌ _doOpenExistingProject: prázdná cesta');return;}
  folderPath=folderPath.trim();
  if(window._c3)window._c3.agentLog('TOOL','📂 Otevírám složku: '+folderPath+' (délka: '+folderPath.length+', první znak: '+JSON.stringify(folderPath.charAt(0))+')');
  /* v90: Smart route to relay — open-folder always routes to free/new relay */
  _projectWizard.saving=true;renderCenter();
  _smartRouteToRelay(function(_ti){
    fetch(_backendBase+'/api/projects/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folderPath:folderPath}),signal:AbortSignal.timeout(15000)})
    .then(function(r){if(!r.ok)return r.json().then(function(e){throw new Error((e.error||'Server error '+r.status)+(e.details?' ['+e.details+']':''));});return r.json();})
    .then(function(res){
      _projectWizard.active=false;_projectWizard.saving=false;_wizardRestoreLayout();
      var proj=res.project;
      var realPath=(proj&&proj.path)||folderPath;
      var projName=(proj&&proj.name)||folderPath.split('/').filter(Boolean).pop()||'Projekt';
      var _welcomeMsg=res.welcomeMessage||null;
      /* Open working tree */
      _wtRoot=realPath;_loadWorkspaceTree(realPath);
      /* Link to routed session */
      var _ts=_sessions[_ti];
      if(proj&&proj.id){
        _ts._projectId=proj.id;_ts._label=projName;
        _ts._conversationFocus=false; /* v122.3 */
        /* Reset session for new project context */
        _ts._convId=null;_ts._agentId=null;_ts._lifecycleResumed=false;
        _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
        _ts.chat.ctx=0;
        /* Create conversation for the project, then bind lifecycle (v88) */
        fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project_id:proj.id,title:projName,welcomeMessage:_welcomeMsg}),signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json();}).then(function(cd){
          var conv=cd.conversation||cd;
          if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
          if(_welcomeMsg){_ts.chat.msgs.push({role:'assistant',text:_welcomeMsg,tag:'PROJECT'});renderChat();_chatScrollPane(_ti);}
          var bindSessionId=_ts._agentId||_ts._convId||('session-'+_ti);
          fetch(_backendBase+'/api/projects/'+proj.id+'/lifecycle/bind',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({sessionId:bindSessionId}),signal:AbortSignal.timeout(5000)})
          .then(function(r2){return r2.json();}).then(function(result){
            if(result.ok){_ts._lifecycleResumed=true;if(window._c3)window._c3.agentLog('TOOL','Lifecycle obnoven: faze '+result.phase);}
          }).catch(function(){});
        }).catch(function(){});
        _persistSessionState();
      }
      if(window._c3){
        window._c3.agentLog('TOOL','📂 Projekt otevřen: '+projName);
        window._c3.agentLog('TOOL','📍 '+realPath);
        if(res.metadata&&res.metadata.bootstrapped)window._c3.agentLog('TOOL','🔧 Metadata bootstrapped (.c3-architect)');
        if(res.status==='already_registered')window._c3.agentLog('TOOL','ℹ️ Projekt byl již registrován');
      }
      _centerState.view='chats';_centerState.detail=null;
      fetchBackendData();renderCenter();renderChat();
    }).catch(function(err){
      _projectWizard.saving=false;_projectWizard.active=false;_wizardRestoreLayout();
      if(window._c3)window._c3.agentLog('TOOL','❌ Chyba při otevírání: '+(err.message||err));
      fetchBackendData();renderCenter();
    });
  });
}
function _wizardSubmit(){
  if(_projectWizard.saving)return;
  _projectWizard.saving=true;renderCenter();
  var d=_projectWizard.data;
  var slug=d.name.replace(/[^a-zA-Z0-9-_]/g,'-').toLowerCase();
  var sendPath=d.pathMode==='custom'?d.path.trim():'';
  if(!sendPath&&d.pathMode==='auto'&&_projectWizard.defaultDir){sendPath=_projectWizard.defaultDir+'/'+slug;}
  fetch(_backendBase+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:d.name.trim(),path:sendPath||null,description:d.description.trim(),type:d.type,autoPath:!sendPath}),signal:AbortSignal.timeout(15000)})
  .then(function(r){return r.json();})
  .then(function(created){
    _projectWizard.active=false;_projectWizard.saving=false;_wizardRestoreLayout();
    var realPath=created.path||sendPath;
    var projName=d.name.trim();
    var _welcomeMsg=created.welcomeMessage||null; /* v89: save welcome from BE */
    if(window._c3)window._c3.agentLog('TOOL','✨ Projekt vytvořen: '+projName+' → '+realPath);
    /* v90: Smart route to relay */
    _smartRouteToRelay(function(_ti){
      var _ts=_sessions[_ti];
      var projId=created.id||(created.project&&created.project.id);
      if(projId){_ts._projectId=projId;_ts._conversationFocus=false;_syncFocusClass();_persistSessionState();}
      _ts._label=projName;
      if(realPath){_wtRoot=realPath;_loadWorkspaceTree(realPath);}
      /* Reset session for new project */
      _ts._lifecycleResumed=false;
      _ts.log=[];_ts.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
      _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
      /* Create conversation for the project, THEN start lifecycle (v88) */
      if(projId){
        fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project_id:projId,title:projName,welcomeMessage:_welcomeMsg}),signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json();}).then(function(cd){
          var conv=cd.conversation||cd;
          if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
          if(_welcomeMsg){_ts.chat.msgs.push({role:'assistant',text:_welcomeMsg,tag:'PROJECT'});renderChat();_chatScrollPane(_ti);}
          var lcSessionId=_ts._agentId||_ts._convId||('session-'+_ti);
          fetch(_backendBase+'/api/projects/lifecycle/start',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({projectId:projId,projectPath:realPath,projectName:projName,description:d.description.trim(),type:d.type,sessionId:lcSessionId}),
            signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(lc){
            if(window._c3)window._c3.agentLog('TOOL','Lifecycle aktivovan: '+((lc&&lc.phase)||'SPEC'));
          }).catch(function(e){
            if(window._c3)window._c3.agentLog('TOOL','Lifecycle start: '+(e.message||e));
          });
        }).catch(function(){});
      }
      var scaff=created.scaffold?created.scaffold.join(', '):'';
      if(window._c3){
        window._c3.agentLog('TOOL','📁 Projekt '+projName+' vytvořen ('+d.type+') → '+realPath);
        if(scaff)window._c3.agentLog('TOOL','🔧 Scaffolding: '+scaff);
        window._c3.agentLog('TOOL','🔄 Lifecycle: SPEC — popište specifikaci v chatu');
      }
      fetchBackendData();renderCenter();renderChat();
    });
  }).catch(function(err){
    _projectWizard.saving=false;
    if(window._c3)window._c3.agentLog('TOOL','❌ Chyba při vytváření projektu: '+(err.message||err));
    _projectWizard.active=false;_wizardRestoreLayout();fetchBackendData();renderCenter();
  });
}
function centerProjectWizard(){
  var w=_projectWizard,step=w.step,d=w.data;
  var stepStyle={background:C.bg2,borderRadius:12,padding:24,maxWidth:520,margin:'0 auto',width:'100%'};
  var labelStyle={fontSize:_fs(11),color:C.tx3,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6};
  var inputStyle={width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:_fs(13),outline:'none',boxSizing:'border-box'};
  var content;
  var modeCardStyle=function(sel){return{padding:20,borderRadius:12,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',transition:'border 0.15s',textAlign:'center',flex:1};};
  if(step===0){
    content=h('div',{style:Object.assign({},stepStyle,{maxWidth:480})},
      h('div',{style:{display:'flex',gap:12}},
        h('div',{style:modeCardStyle(d.mode==='create'),onClick:function(){d.mode='create';w.step=1;renderCenter();}},
          h('div',{style:{fontSize:_fs(32),marginBottom:8}},'📝'),
          h('div',{style:{fontSize:_fs(14),fontWeight:700,color:d.mode==='create'?C.accentText:C.tx1}},'Nový projekt'),
          h('div',{style:{fontSize:_fs(11),color:C.tx3,marginTop:4}},'Vytvořit od nuly se scaffoldingem')),
        h('div',{style:modeCardStyle(d.mode==='open'),onClick:function(){d.mode='open';_openExistingProject();}},
          h('div',{style:{fontSize:_fs(32),marginBottom:8}},'📂'),
          h('div',{style:{fontSize:_fs(14),fontWeight:700,color:d.mode==='open'?C.accentText:C.tx1}},'Otevřít existující'),
          h('div',{style:{fontSize:_fs(11),color:C.tx3,marginTop:4}},'Vybrat složku z disku'))));
  }else if(step===1){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Název projektu'),
      h('input',{autoFocus:true,style:inputStyle,value:d.name,placeholder:'Můj nový projekt',
        onChange:function(e){d.name=e.target.value;renderCenter();},
        onKeyDown:function(e){if(e.key==='Enter'&&_wizardCanNext()){w.step=2;renderCenter();}}}));
  }else if(step===2){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Typ projektu'),
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}},
        PROJECT_TYPES.map(function(pt){
          var sel=d.type===pt.id;
          return h('div',{key:pt.id,onClick:function(){d.type=pt.id;renderCenter();},
            style:{padding:14,borderRadius:10,border:'1px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',transition:'border 0.15s'}},
            h('div',{style:{fontSize:_fs(18),marginBottom:4}},pt.icon),
            h('div',{style:{fontSize:_fs(12.5),fontWeight:700,color:sel?C.accentText:C.tx1}},pt.label),
            h('div',{style:{fontSize:_fs(10.5),color:C.tx3,marginTop:2}},pt.desc));})));
  }else if(step===3){
    var slug=d.name.replace(/[^a-zA-Z0-9-_]/g,'-').toLowerCase();
    var autoDir=_projectWizard.defaultDir?((_projectWizard.defaultDir)+'/'+slug):'(načítám...)';
    var isAuto=d.pathMode==='auto';
    var tabStyle=function(active){return{flex:1,padding:'8px 0',textAlign:'center',fontSize:_fs(12),fontWeight:600,cursor:'pointer',borderRadius:'8px 8px 0 0',background:active?C.bg3:'transparent',color:active?C.tx1:C.tx4,border:'1px solid '+(active?C.border:'transparent'),borderBottom:active?'1px solid '+C.bg3:'1px solid '+C.border,marginBottom:-1};};
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Umístění projektu'),
      h('div',{style:{display:'flex',gap:0,marginBottom:0}},
        h('div',{style:tabStyle(isAuto),onClick:function(){d.pathMode='auto';renderCenter();}},'Vytvořit automaticky'),
        h('div',{style:tabStyle(!isAuto),onClick:function(){d.pathMode='custom';renderCenter();}},'Vlastní cesta')),
      h('div',{style:{border:'1px solid '+C.border,borderTop:'none',borderRadius:'0 0 8px 8px',padding:14,background:C.bg3}},
        isAuto?h('div',null,
          h('div',{style:{fontSize:_fs(12),color:C.tx2,marginBottom:6}},'Projekt bude vytvořen ve výchozí složce:'),
          h('div',{style:{fontFamily:C.mono,fontSize:_fs(12),color:C.accentText,padding:'6px 10px',background:C.bg2,borderRadius:6,border:'1px solid '+C.border,wordBreak:'break-all'}},autoDir),
          h('div',{style:{fontSize:_fs(10),color:C.tx4,marginTop:8}},'Změnit: Nastavení → System → Složka projektů')):
        h('div',null,
          h('div',{style:{display:'flex',gap:6,alignItems:'center'}},
            h('input',{autoFocus:true,style:Object.assign({},inputStyle,{flex:1}),value:d.path,placeholder:'/home/user/projects/my-project',
              onChange:function(e){d.path=e.target.value;renderCenter();},
              onKeyDown:function(e){if(e.key==='Enter'&&_wizardCanNext()){w.step=4;renderCenter();}}}),
            h('button',{style:{padding:'8px 12px',borderRadius:8,border:'1px solid '+C.border2,background:C.bg2,color:C.tx2,fontSize:_fs(11),fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0},
              onClick:function(){try{var inp=document.createElement('input');inp.type='file';inp.webkitdirectory=true;inp.addEventListener('change',function(){if(inp.files&&inp.files.length>0){var fp=inp.files[0].path||inp.files[0].webkitRelativePath;if(fp){var parts=fp.replace(/\\/g,'/').split('/');d.path=parts.slice(0,-1).join('/')||fp;renderCenter();}}});inp.click();}catch(e){}}},'📁 Vybrat')),
          h('div',{style:{fontSize:_fs(10),color:C.tx4,marginTop:6}},'Složka bude vytvořena pokud neexistuje'))));
  }else if(step===4){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Popis projektu (volitelné)'),
      h('textarea',{autoFocus:true,style:Object.assign({},inputStyle,{minHeight:80,resize:'vertical',fontFamily:C.font}),value:d.description,placeholder:'Popište cíl a scope projektu...',
        onChange:function(e){d.description=e.target.value;renderCenter();}}));
  }else if(step===5){
    var pt=PROJECT_TYPES.find(function(t){return t.id===d.type;})||PROJECT_TYPES[0];
    var slug2=d.name.replace(/[^a-zA-Z0-9-_]/g,'-').toLowerCase();
    var displayPath=d.pathMode==='auto'?(_projectWizard.defaultDir+'/'+slug2):d.path;
    var scaffoldHints={general:'git init, README.md (prázdný projekt)',webapp:'package.json, src/, public/, git init',api:'package.json, src/index.js (API), git init',automation:'package.json, scripts/main.js, git init',data:'package.json, data/, notebooks/, src/pipeline.js, git init'};
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Souhrn'),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10,marginTop:8}},
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Název'),h('span',{style:{color:C.tx1,fontWeight:600}},d.name)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Typ'),h('span',{style:{color:C.tx1}},pt.icon+' '+pt.label)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12),gap:8}},h('span',{style:{color:C.tx3,flexShrink:0}},'Cesta'),h('span',{style:{color:C.tx2,fontFamily:C.mono,fontSize:_fs(11),textAlign:'right',wordBreak:'break-all'}},displayPath)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Scaffolding'),h('span',{style:{color:C.tx2,fontSize:_fs(10.5)}},scaffoldHints[d.type]||'')),
        d.description?h('div',{style:{fontSize:_fs(11),color:C.tx2,marginTop:4,padding:8,background:C.bg3,borderRadius:6,whiteSpace:'pre-wrap'}},d.description):null),
      h('div',{style:{marginTop:16,padding:10,background:C.accentBg,borderRadius:8,border:'1px solid '+C.accent+'33'}},
        h('div',{style:{fontSize:_fs(11),color:C.accentText,fontWeight:600}},'Lifecycle: PROPOSED → SPEC'),
        h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:4}},'Po vytvoření: git init, scaffolding dle typu, lifecycle SPEC. Popište specifikaci v chatu.')));
  }
  var totalSteps=d.mode==='create'?WIZARD_STEPS.length:1;
  var headerTitle=step===0?'Projekt':d.mode==='create'?'Nový projekt':'Otevřít projekt';
  return h(React.Fragment,null,
    /* Header */
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:10,flexShrink:0}},
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:4,borderRadius:4,display:'flex'},
        onClick:function(){_projectWizard.active=false;_wizardRestoreLayout();renderCenter();}},svgEl(I.close,16)),
      h('span',{style:{fontSize:_fs(14),fontWeight:700,color:C.tx1}},headerTitle),
      h('div',{style:{flex:1}}),
      step>0?h('span',{style:{fontSize:_fs(10),color:C.tx4,fontFamily:C.mono}},'Krok '+step+'/'+( WIZARD_STEPS.length-1)):null),
    /* Step indicators */
    step>0?h('div',{style:{display:'flex',gap:2,padding:'8px 18px',flexShrink:0}},
      WIZARD_STEPS.slice(1).map(function(ws,i){
        var done=i<step-1,cur=i===step-1;
        return h('div',{key:ws.id,style:{flex:1,height:3,borderRadius:2,background:done?C.accent:cur?C.accentText:C.bg4,transition:'background 0.2s'}});})):null,
    /* Step content */
    h('div',{style:{flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start'}},
      h('div',{style:{fontSize:_fs(28),marginBottom:8}},WIZARD_STEPS[step].icon),
      h('div',{style:{fontSize:_fs(16),fontWeight:700,color:C.tx1,marginBottom:4}},WIZARD_STEPS[step].desc),
      h('div',{style:{width:'100%',maxWidth:520,marginTop:16}},content)),
    /* Navigation */
    h('div',{style:{padding:'12px 18px',borderTop:'1px solid '+C.border,display:'flex',gap:8,justifyContent:'flex-end',flexShrink:0}},
      step>0?h('button',{style:{padding:'7px 16px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontFamily:C.font,fontSize:_fs(12),cursor:'pointer'},
        onClick:function(){w.step=Math.max(0,step-1);renderCenter();}},'Zpět'):null,
      step>0&&step<5?h('button',{disabled:!_wizardCanNext(),style:{padding:'7px 20px',borderRadius:6,border:'none',background:_wizardCanNext()?C.accent:C.bg4,color:_wizardCanNext()?'#fff':C.tx4,fontFamily:C.font,fontSize:_fs(12),fontWeight:600,cursor:_wizardCanNext()?'pointer':'default',opacity:_wizardCanNext()?1:0.5},
        onClick:function(){if(_wizardCanNext()){w.step=step+1;renderCenter();}}},'Další'):null,
      step===5?h('button',{disabled:w.saving,style:{padding:'7px 24px',borderRadius:6,border:'none',background:w.saving?C.bg4:C.accent,color:'#fff',fontFamily:C.font,fontSize:_fs(12),fontWeight:600,cursor:w.saving?'default':'pointer'},
        onClick:_wizardSubmit},w.saving?'Vytvářím...':'Vytvořit projekt'):null));
}

/* ═══ SPECIALIST CREATION WIZARD (v122.2) ═══ */
var _SW_DOMAINS=[
  {id:'general',label:'Obecný',icon:'🤖'},
  {id:'finance',label:'Finance',icon:'💰'},
  {id:'law',label:'Právo',icon:'⚖️'},
  {id:'tech',label:'Technologie',icon:'💻'},
  {id:'medicine',label:'Medicína',icon:'🏥'},
  {id:'creative',label:'Kreativní psaní',icon:'✍️'},
  {id:'psychology',label:'Psychologie',icon:'🧠'},
  {id:'language',label:'Jazyky',icon:'🌐'},
  {id:'education',label:'Vzdělávání',icon:'📚'},
  {id:'data',label:'Data a analýza',icon:'📊'}
];
function _swCanNext(){
  var d=_specialistWizard.data,s=_specialistWizard.step;
  if(s===0)return d.name.trim().length>=2;
  if(s===1)return!!d.domain;
  return true;
}
function _swSubmit(){
  if(_specialistWizard.saving)return;
  _specialistWizard.saving=true;_specialistWizard.error=null;renderCenter();
  var d=_specialistWizard.data;
  fetch(_backendBase+'/api/specialists',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:d.name.trim(),domain:d.domain,description:d.description.trim(),icon:d.icon||null}),
    signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json().then(function(j){return{ok:r.ok,data:j};});})
  .then(function(res){
    _specialistWizard.saving=false;
    if(!res.ok){_specialistWizard.error=res.data.error||'Chyba při vytváření';renderCenter();return;}
    _specialistWizard.active=false;_wizardRestoreLayout();
    _fetchExpertises();
    if(typeof c3!=='undefined'&&c3.agentLog)c3.agentLog('TOOL','Specialista \u201E'+d.name.trim()+'\u201C vytvořen.');
    renderCenter();
  })
  .catch(function(e){_specialistWizard.saving=false;_specialistWizard.error=e.message||'Nepodařilo se vytvořit';renderCenter();});
}
function centerSpecialistWizard(){
  var w=_specialistWizard,step=w.step,d=w.data;
  var stepStyle={background:C.bg2,borderRadius:12,padding:24,maxWidth:520,margin:'0 auto',width:'100%'};
  var labelStyle={fontSize:_fs(11),color:C.tx3,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6};
  var inputStyle={width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:_fs(13),outline:'none',boxSizing:'border-box'};
  var content;
  if(step===0){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Název specialisty'),
      h('input',{autoFocus:true,style:inputStyle,value:d.name,placeholder:'Např. Překladatel, Účetní, Analytik...',
        onChange:function(e){d.name=e.target.value;renderCenter();},
        onKeyDown:function(e){if(e.key==='Enter'&&_swCanNext()){w.step=1;renderCenter();}}}));
  }else if(step===1){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Doména'),
      h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}},
        _SW_DOMAINS.map(function(dom){
          var sel=d.domain===dom.id;
          return h('div',{key:dom.id,onClick:function(){d.domain=dom.id;if(!d.icon)d.icon=dom.icon;renderCenter();},
            style:{padding:14,borderRadius:10,border:'1px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',transition:'border 0.15s'}},
            h('div',{style:{fontSize:_fs(18),marginBottom:4}},dom.icon),
            h('div',{style:{fontSize:_fs(12.5),fontWeight:700,color:sel?C.accentText:C.tx1}},dom.label));})));
  }else if(step===2){
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Popis (volitelný)'),
      h('textarea',{autoFocus:true,style:Object.assign({},inputStyle,{minHeight:80,resize:'vertical',fontFamily:C.font}),value:d.description,placeholder:'Popište co specialista umí a k čemu slouží...',
        onChange:function(e){d.description=e.target.value;renderCenter();}}),
      h('div',{style:Object.assign({},labelStyle,{marginTop:16})},'Emoji / ikona (volitelná)'),
      h('input',{style:Object.assign({},inputStyle,{maxWidth:80}),value:d.icon,placeholder:'🤖',maxLength:4,
        onChange:function(e){d.icon=e.target.value;renderCenter();}}));
  }else if(step===3){
    var domInfo=_SW_DOMAINS.find(function(x){return x.id===d.domain;})||_SW_DOMAINS[0];
    var slug=d.name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').substring(0,32);
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Souhrn'),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10,marginTop:8}},
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Název'),h('span',{style:{color:C.tx1,fontWeight:600}},(d.icon||domInfo.icon)+' '+d.name.trim())),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Doména'),h('span',{style:{color:C.tx1}},domInfo.icon+' '+domInfo.label)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'ID'),h('span',{style:{color:C.tx2,fontFamily:C.mono,fontSize:_fs(11)}},slug)),
        d.description?h('div',{style:{fontSize:_fs(11),color:C.tx2,marginTop:4,padding:8,background:C.bg3,borderRadius:6,whiteSpace:'pre-wrap'}},d.description):null),
      h('div',{style:{marginTop:16,padding:10,background:C.accentBg,borderRadius:8,border:'1px solid '+C.accent+'33'}},
        h('div',{style:{fontSize:_fs(11),color:C.accentText,fontWeight:600}},'specialists/'+slug+'/'),
        h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:4}},'Vytvoří se balíček s manifestem a stub kódem. Nástroje můžete přidat později editací index.js.')),
      w.error?h('div',{style:{marginTop:12,padding:8,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:6,fontSize:_fs(11),color:'#f87171'}},w.error):null);
  }
  var SW_STEPS=[{id:'name',icon:'📝',desc:'Jak se bude jmenovat?'},{id:'domain',icon:'🎯',desc:'Doména specialisty'},{id:'desc',icon:'📋',desc:'Popis a ikona'},{id:'review',icon:'✅',desc:'Souhrn a vytvoření'}];
  var totalSteps=SW_STEPS.length;
  return h(React.Fragment,null,
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:10,flexShrink:0}},
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:4,borderRadius:4,display:'flex'},
        onClick:function(){_specialistWizard.active=false;_wizardRestoreLayout();renderCenter();}},svgEl(I.close,16)),
      h('span',{style:{fontSize:_fs(14),fontWeight:700,color:C.tx1}},'Nový specialista'),
      h('div',{style:{flex:1}}),
      h('span',{style:{fontSize:_fs(10),color:C.tx4,fontFamily:C.mono}},'Krok '+(step+1)+'/'+totalSteps)),
    h('div',{style:{display:'flex',gap:2,padding:'8px 18px',flexShrink:0}},
      SW_STEPS.map(function(ws,i){
        var done=i<step,cur=i===step;
        return h('div',{key:ws.id,style:{flex:1,height:3,borderRadius:2,background:done?C.accent:cur?C.accentText:C.bg4,transition:'background 0.2s'}});})),
    h('div',{style:{flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start'}},
      h('div',{style:{fontSize:_fs(28),marginBottom:8}},SW_STEPS[step].icon),
      h('div',{style:{fontSize:_fs(16),fontWeight:700,color:C.tx1,marginBottom:4}},SW_STEPS[step].desc),
      h('div',{style:{width:'100%',maxWidth:520,marginTop:16}},content)),
    h('div',{style:{padding:'12px 18px',borderTop:'1px solid '+C.border,display:'flex',gap:8,justifyContent:'flex-end',flexShrink:0}},
      step>0?h('button',{style:{padding:'7px 16px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontFamily:C.font,fontSize:_fs(12),cursor:'pointer'},
        onClick:function(){w.step=Math.max(0,step-1);renderCenter();}},'Zpět'):null,
      step<3?h('button',{disabled:!_swCanNext(),style:{padding:'7px 20px',borderRadius:6,border:'none',background:_swCanNext()?C.accent:C.bg4,color:_swCanNext()?'#fff':C.tx4,fontFamily:C.font,fontSize:_fs(12),fontWeight:600,cursor:_swCanNext()?'pointer':'default',opacity:_swCanNext()?1:0.5},
        onClick:function(){if(_swCanNext()){w.step=step+1;renderCenter();}}},'Další'):null,
      step===3?h('button',{disabled:w.saving,style:{padding:'7px 24px',borderRadius:6,border:'none',background:w.saving?C.bg4:C.accent,color:'#fff',fontFamily:C.font,fontSize:_fs(12),fontWeight:600,cursor:w.saving?'default':'pointer'},
        onClick:_swSubmit},w.saving?'Vytvářím...':'Vytvořit specialistu'):null));
}

/* ═══ EXPERTISE CREATION/EDIT WIZARD (v64.1) ═══ */
var _ewDebounce=null;
function _ewPreview(){
  if(_ewDebounce)clearTimeout(_ewDebounce);
  _ewDebounce=setTimeout(function(){
    var d=_expertiseWizard.data;if(!d||!d.name)return;
    fetch(_backendBase+'/api/merge-preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expertises:[{id:'__wizard_'+Date.now(),name:d.name,modules:d.modules,capabilities:d.capabilities,systemPrompt:d.systemPrompt,temperature:d.temperature,tone:d.tone,weight:1.0,styleRules:d.styleRules}]}),
      signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();}).then(function(p){_expertiseWizard.preview=p;renderCenter();}).catch(function(){});
  },500);
}
function _ewTest(question){
  if(_expertiseWizard.testLoading)return;
  _expertiseWizard.testLoading=true;_expertiseWizard.testError=null;_expertiseWizard.testResult=null;renderCenter();
  fetch(_backendBase+'/api/expertise-wizard/test-prompt',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({expertiseConfig:_expertiseWizard.data,question:question}),signal:AbortSignal.timeout(60000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(res){_expertiseWizard.testResult=res;_expertiseWizard.testLoading=false;renderCenter();})
  .catch(function(err){_expertiseWizard.testError=err.message;_expertiseWizard.testLoading=false;renderCenter();});
}
function _ewSave(){
  if(_expertiseWizard.saving||!_expertiseWizard.data||!_expertiseWizard.data.name)return;
  _expertiseWizard.saving=true;renderCenter();
  var d=_expertiseWizard.data;var method=_expertiseWizard.editId?'PUT':'POST';
  var url=_expertiseWizard.editId?(_backendBase+'/api/expertises/'+_expertiseWizard.editId):(_backendBase+'/api/expertises');
  fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(d),signal:AbortSignal.timeout(5000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(){
    _expertiseWizard.saving=false;
    var _label=d.is_specialist?'Specialista':'Expertyza';
    if(window._c3)window._c3.agentLog('TOOL',_label+' '+(method==='PUT'?'upraven(a)':'vytvořen(a)')+': '+d.name);
    fetchBackendData();_ewClose();
  }).catch(function(err){
    _expertiseWizard.saving=false;_expertiseWizard.testError='Uložení selhalo: '+err.message;
    if(window._c3)window._c3.agentLog('TOOL','❌ Chyba: '+err.message);renderCenter();
  });
}
function _ewToggle(secId){_expertiseWizard.openSections[secId]=!_expertiseWizard.openSections[secId];renderCenter();}
function _ewAddModItem(section){
  var el=document.getElementById('ew-mod-'+section);if(!el||!el.value.trim())return;
  var d=_expertiseWizard.data;if(!d.modules[section])d.modules[section]=[];
  d.modules[section].push(el.value.trim());el.value='';_ewPreview();renderCenter();
}
function _ewRemModItem(section,idx){
  var d=_expertiseWizard.data;if(d.modules[section])d.modules[section].splice(idx,1);
  _ewPreview();renderCenter();
}
function _ewDefaultData(){
  return{name:'',description:'',domain:'',icon:'👤',systemPrompt:'',tone:'professional',temperature:0.5,
    capabilities:{reasoning:50,creativity:50,determinism:50,riskTolerance:50,verbosity:50},
    modules:{domain_rules:[],emphasis:[],constraints:[],vocabulary:[],antipatterns:[],disclaimer:null},
    parent:null,inheritance:{},styleRules:{forbiddenPhrases:[]}};
}
function _ewOpen(mode,editId,data){
  var isEdit=mode==='edit';
  _wizardSaveLayout();
  _expertiseWizard={active:true,mode:mode,data:data||_ewDefaultData(),schema:null,preview:null,testResult:null,testLoading:false,testError:null,openSections:{basic:true},editId:editId||null,saving:false,advancedMode:isEdit,confirmAdvanced:false,simpleStep:1};
  fetch(_backendBase+'/api/expertise-schema',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(s){_expertiseWizard.schema=s;renderCenter();}).catch(function(){});
  renderCenter();
}
function _ewClose(){_expertiseWizard.active=false;_wizardRestoreLayout();renderCenter();}
/* ═══ Agent wizard functions (v65.5) ═══ */
function _awDefaultData(){
  return{id:'',name:'',description:'',icon:'🤖',type:'MONITOR',
    schedule:{type:'interval',value:'1h'},
    sources:[{id:'src-1',type:'http',config:{url:''}}],
    conditions:[{id:'cond-1',type:'exists',field:'sources.src-1.data'}],
    triggers:[{id:'trig-1',condition_id:'cond-1',edge:'rising',cooldown:300,max_fires_per_day:10}],
    actions:[{type:'notify',trigger_id:'trig-1',config:{channel:'push',title:'',message:'',priority:'normal'}}],
    params:[]};
}
function _awOpen(mode,editId,data){
  var isEdit=mode==='edit';
  _wizardSaveLayout();
  _agentWizard={active:true,mode:mode,data:data||_awDefaultData(),schema:null,preview:null,testResult:null,testLoading:false,testError:null,openSections:{basic:true},editId:editId||null,saving:false,advancedMode:isEdit,confirmAdvanced:false,simpleStep:1};
  fetch(_backendBase+'/api/agents/schema',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(s){_agentWizard.schema=s;renderCenter();}).catch(function(){});
  renderCenter();
}
function _awClose(){_agentWizard.active=false;_wizardRestoreLayout();renderCenter();}
function _awToggle(secId){_agentWizard.openSections[secId]=!_agentWizard.openSections[secId];renderCenter();}
function _awApplyPreset(typeId){
  var s=_agentWizard.schema;
  if(!s||!s.presets||!s.presets[typeId])return;
  var p=JSON.parse(JSON.stringify(s.presets[typeId]));
  var d=_agentWizard.data;
  d.type=typeId;d.icon=p.icon||d.icon;d.schedule=p.schedule;d.sources=p.sources;d.conditions=p.conditions;d.triggers=p.triggers;d.actions=p.actions;
  renderCenter();
}
function _awDryRun(){
  var d=_agentWizard.data;if(!d)return;
  _agentWizard.testLoading=true;_agentWizard.testError=null;_agentWizard.preview=null;renderCenter();
  fetch(_backendBase+'/api/agents/dry-run',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({definition:d}),signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json();})
  .then(function(res){_agentWizard.preview=res;_agentWizard.testLoading=false;renderCenter();})
  .catch(function(err){_agentWizard.testError=err.message;_agentWizard.testLoading=false;renderCenter();});
}
function _awTestRun(){
  if(!_agentWizard.editId)return;
  _agentWizard.testLoading=true;_agentWizard.testError=null;_agentWizard.testResult=null;renderCenter();
  fetch(_backendBase+'/api/agents/'+_agentWizard.editId+'/run',{method:'POST',signal:AbortSignal.timeout(60000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(res){_agentWizard.testResult=res;_agentWizard.testLoading=false;renderCenter();})
  .catch(function(err){_agentWizard.testError=err.message;_agentWizard.testLoading=false;renderCenter();});
}
function _awSave(){
  if(_agentWizard.saving||!_agentWizard.data||!_agentWizard.data.name)return;
  _agentWizard.saving=true;renderCenter();
  var d=_agentWizard.data;
  if(!d.id)d.id=d.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9_-]/g,'').slice(0,64);
  /* Auto dry-run pred save */
  fetch(_backendBase+'/api/agents/dry-run',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({definition:d}),signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json();})
  .then(function(dryRes){
    if(dryRes.valid===false){
      _agentWizard.saving=false;_agentWizard.preview=dryRes;_agentWizard.testError='Validace selhala: '+(dryRes.errors||[]).join(', ');renderCenter();
      return;
    }
    /* Dry-run OK → save */
    var method=_agentWizard.editId?'PUT':'POST';
    var url=_agentWizard.editId?(_backendBase+'/api/agents/'+_agentWizard.editId):(_backendBase+'/api/agents');
    var payload=_agentWizard.editId?d:{name:d.name,description:d.description,type:d.type,icon:d.icon,definition:dryRes.definition||d};
    fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)})
    .then(function(r){
      if(r.status===409){
        d.id=d.id+'-'+Date.now().toString(36).slice(-4);
        _agentWizard.saving=false;_awSave();return;
      }
      if(!r.ok)throw new Error('HTTP '+r.status);return r.json();
    })
    .then(function(res){
      if(!res)return;
      _agentWizard.saving=false;
      if(window._c3)window._c3.agentLog('TOOL',(method==='PUT'?'Agent upraven: ':'Agent vytvoren: ')+d.name);
      fetchBackendData();_awClose();
    }).catch(function(err){
      _agentWizard.saving=false;_agentWizard.testError='Ulozeni selhalo: '+err.message;
      if(window._c3)window._c3.agentLog('TOOL','Chyba: '+err.message);renderCenter();
    });
  }).catch(function(err){
    _agentWizard.saving=false;_agentWizard.testError='Dry-run selhal: '+err.message;renderCenter();
  });
}
/* ═══ Agent wizard: add/remove helpers ═══ */
function _awAddSource(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  var maxSrc=(s&&s.limits?s.limits.max_sources:5);
  if(!d||(d.sources||[]).length>=maxSrc)return;
  var idx=(d.sources||[]).length+1;
  d.sources.push({id:'src-'+idx,type:'http',config:{url:''}});renderCenter();
}
function _awRemoveSource(i){var d=_agentWizard.data;if(d.sources.length>1)d.sources.splice(i,1);renderCenter();}
function _awAddCondition(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  var maxCond=(s&&s.limits?s.limits.max_conditions:10);
  if(!d||(d.conditions||[]).length>=maxCond)return;
  var idx=(d.conditions||[]).length+1;
  var srcId=(d.sources&&d.sources[0])?d.sources[0].id:'src-1';
  d.conditions.push({id:'cond-'+idx,type:'exists',field:'sources.'+srcId+'.data'});renderCenter();
}
function _awRemoveCondition(i){var d=_agentWizard.data;if(d.conditions.length>1)d.conditions.splice(i,1);renderCenter();}
function _awAddTrigger(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  var maxTrig=(s&&s.limits?s.limits.max_triggers:10);
  if(!d||(d.triggers||[]).length>=maxTrig)return;
  var idx=(d.triggers||[]).length+1;
  var condId=(d.conditions&&d.conditions[0])?d.conditions[0].id:'cond-1';
  d.triggers.push({id:'trig-'+idx,condition_id:condId,edge:'rising',cooldown:300,max_fires_per_day:10});renderCenter();
}
function _awRemoveTrigger(i){var d=_agentWizard.data;if(d.triggers.length>1)d.triggers.splice(i,1);renderCenter();}
function _awAddAction(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  var maxAct=(s&&s.limits?s.limits.max_actions:10);
  if(!d||(d.actions||[]).length>=maxAct)return;
  var trigId=(d.triggers&&d.triggers[0])?d.triggers[0].id:'trig-1';
  d.actions.push({type:'notify',trigger_id:trigId,config:{channel:'push',title:'',message:'',priority:'normal'}});renderCenter();
}
function _awRemoveAction(i){var d=_agentWizard.data;if(d.actions.length>1)d.actions.splice(i,1);renderCenter();}
function _awAutoPropose(){
  var d=_agentWizard.data;if(!d)return;
  var srcList=d.sources||[];
  var newConds=[];var newTrigs=[];var newActs=[];
  srcList.forEach(function(src,si){
    var srcId=src.id||('src-'+(si+1));
    var condId='cond-'+(si+1);
    if(src.type==='rss'||src.type==='scraper'){
      newConds.push({id:condId,type:'new_items',field:'sources.'+srcId+'.items'});
    }else if(src.type==='database'){
      newConds.push({id:condId,type:'exists',field:'sources.'+srcId+'.data'});
    }else{
      newConds.push({id:condId,type:'exists',field:'sources.'+srcId+'.data'});
    }
    var trigId='trig-'+(si+1);
    newTrigs.push({id:trigId,condition_id:condId,edge:'rising',cooldown:300,max_fires_per_day:10});
    if(src.type==='rss'||src.type==='scraper'){
      newActs.push({type:'mark_seen',trigger_id:trigId,config:{source_id:srcId,id_field:'id'}});
    }
    newActs.push({type:'notify',trigger_id:trigId,config:{channel:'push',title:d.name||'Agent',message:'',priority:'normal'}});
  });
  if(newConds.length>0){d.conditions=newConds;d.triggers=newTrigs;d.actions=newActs;}
  renderCenter();
}
/* ═══ Agent wizard rendering (v65.5) ═══ */
function centerAgentWizard(){
  var w=_agentWizard,d=w.data,schema=w.schema,isCreate=w.mode==='create',SS=w.openSections;
  var labelS2={fontSize:_fs(11),color:C.tx3,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.4px',marginBottom:4};
  var inputS2={width:'100%',padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:_fs(12.5),outline:'none',boxSizing:'border-box'};
  var taS2={width:'100%',padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.mono,fontSize:_fs(12),outline:'none',boxSizing:'border-box',minHeight:60,resize:'vertical'};
  var btnS2=function(primary,disabled){return{padding:'5px '+(primary?16:12)+'px',borderRadius:6,border:primary?'none':'1px solid '+C.border2,background:disabled?C.bg4:primary?C.accent:C.bg3,color:primary?'#fff':C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:primary?600:400,cursor:disabled?'default':'pointer'};};
  var chipS2=function(active){return{padding:'4px 10px',borderRadius:12,border:'1px solid '+(active?C.accent:C.border2),background:active?C.accent+'22':C.bg3,color:active?C.accent:C.tx2,fontSize:_fs(11),cursor:'pointer',fontWeight:active?600:400};};
  var smallBtn2={padding:'3px 8px',borderRadius:5,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontSize:_fs(10),cursor:'pointer'};
  var iconPool=['\u{1F916}','\u{1F514}','\u{1F50D}','\u{1F4C5}','\u{1F4F0}','\u{1F52D}','\u{1F575}\u{FE0F}','\u{1F4CA}','\u{23F0}','\u{1F6E1}\u{FE0F}','\u{1F3AF}','\u{1F4A1}','\u{1F310}','\u{1F4E1}','\u{1F3F7}\u{FE0F}','\u{26A1}'];
  if(!d)return h('div',null,'Loading...');
  var simpleStep=w.simpleStep||1;
  function awPreviewBlock(){
    var els=[];
    if(w.preview){var pv=w.preview;
      var checkedItems=[];
      if(d.name)checkedItems.push('Nazev: '+d.name);
      if(d.schedule)checkedItems.push('Rozvrh: '+d.schedule.type+' ('+d.schedule.value+')');
      checkedItems.push('Zdroje: '+(d.sources||[]).length);
      checkedItems.push('Podminky: '+(d.conditions||[]).length);
      checkedItems.push('Triggery: '+(d.triggers||[]).length);
      checkedItems.push('Akce: '+(d.actions||[]).length);
      els.push(h('div',{key:'pv',style:{marginTop:12,padding:10,borderRadius:8,border:'1px solid '+(pv.valid===false?'#e55':'#4a4'),background:pv.valid===false?'#e5510a':'#4a410a'}},
        h('div',{style:{fontWeight:600,fontSize:_fs(12),color:pv.valid===false?'#f88':'#8f8',marginBottom:6}},pv.valid===false?'Validace selhala':'Validace OK'),
        h('div',{style:{fontSize:_fs(10),color:pv.valid===false?'#faa':'#afa',marginBottom:6}},
          checkedItems.map(function(item,i){return h('div',{key:'ci'+i,style:{padding:'1px 0'}},(pv.valid!==false?'\u2713 ':'\u2022 ')+item);})),
        (pv.errors||[]).map(function(e,i){return h('div',{key:'e'+i,style:{fontSize:_fs(11),color:'#f88',padding:'2px 0'}},'\u2717 '+e);}),
        (pv.warnings||[]).map(function(w2,i){return h('div',{key:'w'+i,style:{fontSize:_fs(11),color:'#fa0',padding:'2px 0'}},'\u26A0 '+w2);})));}
    if(w.testError&&!w.preview){els.push(h('div',{key:'te',style:{marginTop:12,padding:8,borderRadius:6,background:'#e5510a',fontSize:_fs(11),color:'#f88'}},w.testError));}
    return els.length?h('div',null,els):null;
  }
  function awSourceRow(src,si,srcTypes,canRemove){
    if(!src.config)src.config={};
    var isDb=src.type==='database';
    var isRss=src.type==='rss';
    return h('div',{key:'s'+si,style:{background:C.bg2,borderRadius:6,padding:8,marginBottom:6}},
      h('div',{style:{display:'flex',gap:6,alignItems:'center',marginBottom:isDb||isRss?4:0}},
        h('select',{style:Object.assign({},inputS2,{width:110,flex:'none'}),value:src.type,onChange:function(e){src.type=e.target.value;renderCenter();}},
          srcTypes.map(function(st){return h('option',{key:st,value:st},srcTypeLabels[st]||st);})),
        isDb?h('select',{style:Object.assign({},inputS2,{flex:1}),value:src.config.table||'',onChange:function(e){src.config.table=e.target.value;renderCenter();}},
          h('option',{value:''},'-- Vyberte tabulku --'),
          ['user_inventory','agent_data'].map(function(t){return h('option',{key:t,value:t},t);})):
        h('input',{style:Object.assign({},inputS2,{flex:1}),value:src.config.url||'',placeholder:isRss?'RSS feed URL':'https://...',
          onChange:function(e){src.config.url=e.target.value;renderCenter();}}),
        canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14)},onClick:function(){_awRemoveSource(si);}},'✕'):null),
      isRss?h('div',{style:{display:'flex',gap:6,alignItems:'center'}},
        h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Limit polozek:'),
        h('input',{style:Object.assign({},inputS2,{width:60}),type:'number',value:src.config.limit||20,min:1,max:100,
          onChange:function(e){src.config.limit=parseInt(e.target.value)||20;renderCenter();}})):null,
      src.type==='http'?h('div',{style:{display:'flex',gap:6,alignItems:'center',marginTop:4}},
        h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Metoda:'),
        ['GET','POST'].map(function(m){return h('span',{key:m,style:chipS2((src.config.method||'GET')===m),onClick:function(){src.config.method=m;renderCenter();}},m);})):null);
  }
  function awCondRow(cond,ci,condTypes,ops,canRemove){
    var needsOp=cond.type==='compare'||cond.type==='date_diff'||cond.type==='in_range';
    var needsVal=cond.type!=='exists'&&cond.type!=='new_items'&&cond.type!=='changed';
    var isDateDiff=cond.type==='date_diff';
    var dateUnits=['days','hours','minutes'];
    return h('div',{key:'c'+ci,style:{background:C.bg2,borderRadius:6,padding:8,marginBottom:6}},
      h('div',{style:{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}},
        h('select',{style:Object.assign({},inputS2,{width:120,flex:'none'}),value:cond.type,onChange:function(e){cond.type=e.target.value;renderCenter();}},
          condTypes.map(function(ct){return h('option',{key:ct,value:ct},condTypeLabels[ct]||ct);})),
        h('input',{style:Object.assign({},inputS2,{flex:1,minWidth:120}),value:cond.field||'',placeholder:'sources.src-1.data',
          onChange:function(e){cond.field=e.target.value;renderCenter();}}),
        needsOp?h('select',{style:Object.assign({},inputS2,{width:55,flex:'none'}),value:cond.operator||'>',onChange:function(e){cond.operator=e.target.value;renderCenter();}},
          ops.map(function(op){return h('option',{key:op,value:op},op);})):null,
        needsVal?h('input',{style:Object.assign({},inputS2,{width:80,flex:'none'}),value:cond.value!==undefined?cond.value:'',placeholder:'hodnota',
          onChange:function(e){cond.value=e.target.value;renderCenter();}}):null,
        isDateDiff?h('select',{style:Object.assign({},inputS2,{width:80,flex:'none'}),value:cond.unit||'days',onChange:function(e){cond.unit=e.target.value;renderCenter();}},
          dateUnits.map(function(u){return h('option',{key:u,value:u},u);})):null,
        canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14)},onClick:function(){_awRemoveCondition(ci);}},'✕'):null));
  }
  function awActRow(act,ai,actTypes,canRemove){
    if(!act.config)act.config={};
    return h('div',{key:'a'+ai,style:{background:C.bg2,borderRadius:6,padding:8,marginBottom:6}},
      h('div',{style:{display:'flex',gap:6,marginBottom:4}},
        h('select',{style:Object.assign({},inputS2,{width:120,flex:'none'}),value:act.type,onChange:function(e){act.type=e.target.value;if(!act.config)act.config={};renderCenter();}},
          actTypes.map(function(at){return h('option',{key:at,value:at},actTypeLabels[at]||at);})),
        canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14),marginLeft:'auto'},onClick:function(){_awRemoveAction(ai);}},'✕'):null),
      act.type==='notify'?h('div',null,
        h('input',{style:Object.assign({},inputS2,{marginBottom:4}),value:act.config.title||'',placeholder:'Titulek notifikace',
          onChange:function(e){act.config.title=e.target.value;renderCenter();}}),
        h('textarea',{style:Object.assign({},inputS2,{marginBottom:4,minHeight:40,resize:'vertical'}),value:act.config.message||'',placeholder:'Zprava (muze pouzit {{data}}, {{source}}, {{timestamp}})',rows:2,
          onChange:function(e){act.config.message=e.target.value;renderCenter();}}),
        h('div',{style:{display:'flex',gap:8,alignItems:'center'}},
          h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Priorita:'),
          priorities.map(function(p){return h('span',{key:p,style:chipS2((act.config.priority||'normal')===p),onClick:function(){act.config.priority=p;renderCenter();}},
            p==='low'?'Nizka':p==='high'?'Vysoka':'Normalni');}),
          h('div',{style:{flex:1}}),
          h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4,cursor:'pointer'}},
            h('input',{type:'checkbox',checked:!!act.config.use_llm,onChange:function(e){act.config.use_llm=e.target.checked;renderCenter();}}),
            'LLM souhrn'))):null,
      act.type==='store'?h('div',null,
        h('input',{style:Object.assign({},inputS2,{marginBottom:4}),value:act.config.key||'',placeholder:'Klic pro ulozeni (napr. latest_prices)',
          onChange:function(e){act.config.key=e.target.value;renderCenter();}}),
        h('div',{style:{fontSize:_fs(10),color:C.tx4}},'Data budou ulozena do agent_data pod timto klicem')):null,
      act.type==='webhook'?h('div',null,
        h('input',{style:Object.assign({},inputS2,{marginBottom:4}),value:act.config.url||'',placeholder:'https://hooks.example.com/...',
          onChange:function(e){act.config.url=e.target.value;renderCenter();}}),
        h('div',{style:{fontSize:_fs(10),color:C.tx4}},'POST s JSON payload pri spusteni triggeru')):null,
      act.type==='mark_seen'?h('div',null,
        h('div',{style:{display:'flex',gap:6,alignItems:'center'}},
          h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Zdroj:'),
          h('select',{style:Object.assign({},inputS2,{width:100}),value:act.config.source_id||'',onChange:function(e){act.config.source_id=e.target.value;renderCenter();}},
            h('option',{value:''},'--'),
            (d.sources||[]).map(function(s2){return h('option',{key:s2.id,value:s2.id},s2.id);})),
          h('span',{style:{fontSize:_fs(10),color:C.tx3}},'ID pole:'),
          h('input',{style:Object.assign({},inputS2,{width:80}),value:act.config.id_field||'id',placeholder:'id',
            onChange:function(e){act.config.id_field=e.target.value;renderCenter();}}))):null);
  }
  var schedTypes=(schema&&schema.allowed?schema.allowed.schedule_types:['cron','interval','manual'])||[];
  var intervals=(schema&&schema.allowed?schema.allowed.intervals:['5m','15m','30m','1h','2h','4h','6h','12h','1d','7d'])||[];
  var srcTypes=(schema&&schema.allowed?schema.allowed.source_types:['http','scraper','rss','database'])||[];
  var condTypes=(schema&&schema.allowed?schema.allowed.condition_types:['compare','date_diff','contains','exists','in_range','changed','new_items'])||[];
  var ops=(schema&&schema.allowed?schema.allowed.operators:['<','>','<=','>=','==','!='])||[];
  var actTypes=(schema&&schema.allowed?schema.allowed.action_types:['notify','store','webhook','mark_seen'])||[];
  var priorities=(schema&&schema.allowed?schema.allowed.priorities:['low','normal','high'])||[];
  var condTypeLabels={compare:'Porovnani',date_diff:'Casovy rozdil',contains:'Obsahuje',exists:'Existuje',in_range:'V rozsahu',changed:'Zmeneno',new_items:'Nove polozky'};
  var actTypeLabels={notify:'Notifikace',store:'Ulozit',webhook:'Webhook',mark_seen:'Oznacit videt'};
  var srcTypeLabels={http:'HTTP',scraper:'Web scraper',rss:'RSS feed',database:'Databaze'};
  if(!w.advancedMode){
    var typeChips=schema?Object.keys(schema.presets||{}).map(function(tid){
      var p=schema.presets[tid];
      return h('span',{key:tid,style:chipS2(d.type===tid),onClick:function(){_awApplyPreset(tid);}},
        (p.icon||'')+' '+p.label);
    }):[];
    var typeDesc=schema&&schema.typeDescriptions&&d.type?schema.typeDescriptions[d.type]:null;
    var step1=h('div',null,
      h('div',{style:{display:'flex',gap:8,marginBottom:10}},
        h('div',{style:{flex:1}},h('div',{style:labelS2},'Nazev'),h('input',{style:inputS2,value:d.name||'',placeholder:'Nazev agenta',onChange:function(e){d.name=e.target.value;renderCenter();}})),
        h('div',{style:{width:60}},h('div',{style:labelS2},'Ikona'),h('input',{style:Object.assign({},inputS2,{textAlign:'center',fontSize:_fs(18),padding:'4px'}),value:d.icon||'',maxLength:4,onChange:function(e){d.icon=e.target.value;renderCenter();}}))),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginBottom:12}},iconPool.map(function(ic){
        return h('span',{key:ic,style:{fontSize:_fs(16),cursor:'pointer',padding:'2px 4px',borderRadius:4,background:d.icon===ic?C.accent+'22':'transparent'},onClick:function(){d.icon=ic;renderCenter();}},ic);
      })),
      h('div',{style:labelS2},'Typ agenta'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:6,marginBottom:6}},typeChips),
      typeDesc?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:10,padding:'4px 8px',background:C.bg2,borderRadius:6}},typeDesc):null,
      h('div',{style:{marginBottom:10}},h('div',{style:labelS2},'Popis'),h('textarea',{style:taS2,value:d.description||'',placeholder:'Co tento agent dela?',rows:2,onChange:function(e){d.description=e.target.value;renderCenter();}})));
    var step2=h('div',null,
      h('div',{style:labelS2},'Rozvrh'),
      h('div',{style:{display:'flex',gap:6,marginBottom:8}},schedTypes.map(function(st){
        return h('span',{key:st,style:chipS2(d.schedule&&d.schedule.type===st),onClick:function(){d.schedule={type:st,value:d.schedule?d.schedule.value:''};renderCenter();}},st);
      })),
      d.schedule&&d.schedule.type==='cron'?h('div',{style:{marginBottom:8}},
        h('input',{style:inputS2,value:d.schedule.value||'',placeholder:'0 8 * * *',onChange:function(e){d.schedule.value=e.target.value;renderCenter();}}),
        h('div',{style:{fontSize:_fs(9),color:C.tx4,margin:'4px 0',fontFamily:C.mono}},'Format: minuta hodina den mesic den_tydne (0=ne, 1=po ... 6=so)'),
        h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}},
          [['0 8 * * *','Denne 8:00'],['0 */6 * * *','Kazde 6h'],['0 9 * * 1','Pondeli 9:00'],['0 7,18 * * *','7:00 a 18:00'],['*/30 * * * *','Kazde 30min'],['0 0 1 * *','1. v mesici']].map(function(cr){
            return h('span',{key:cr[0],style:Object.assign({},chipS2(d.schedule.value===cr[0]),{fontSize:_fs(10)}),onClick:function(){d.schedule.value=cr[0];renderCenter();}},cr[1]);
          }))):null,
      d.schedule&&d.schedule.type==='interval'?h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}},intervals.map(function(iv){
        return h('span',{key:iv,style:chipS2(d.schedule.value===iv),onClick:function(){d.schedule.value=iv;renderCenter();}},iv);
      })):null,
      d.schedule&&d.schedule.type==='manual'?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:8}},'Agent bezi jen pri manualnim spusteni'):null,
      h('div',{style:Object.assign({},labelS2,{marginTop:12})},'Zdroje dat'),
      (d.sources||[]).map(function(src,si){return awSourceRow(src,si,srcTypes,(d.sources||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddSource},'+ Pridat zdroj'));
    var step3=h('div',null,
      h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:4}},
        h('div',{style:labelS2},'Podminky'),
        h('span',{style:Object.assign({},smallBtn2,{fontSize:_fs(9)}),onClick:function(){_awAutoPropose();}},'Navrhnout automaticky')),
      (d.conditions||[]).map(function(cond,ci){return awCondRow(cond,ci,condTypes,ops,(d.conditions||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddCondition},'+ Pridat podminku'),
      h('div',{style:Object.assign({},labelS2,{marginTop:12})},'Akce'),
      (d.actions||[]).map(function(act,ai){return awActRow(act,ai,actTypes,(d.actions||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddAction},'+ Pridat akci'),
      h('div',{style:{display:'flex',gap:8,marginTop:16,alignItems:'center'}},
        h('button',{style:btnS2(false,w.testLoading),onClick:_awDryRun},w.testLoading?'Validuji...':'Validovat'),
        h('span',{style:{fontSize:_fs(11),color:C.accent,cursor:'pointer',lineHeight:'24px'},onClick:function(){w.advancedMode=true;renderCenter();}},'Pokrocily rezim')),
      awPreviewBlock());
    var stepNames=['Zaklad','Rozvrh & Zdroje','Podminky & Akce'];
    return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}},
      h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
        h('span',{style:{cursor:'pointer',marginRight:10,fontSize:_fs(14),color:C.tx3},onClick:_awClose},'\u2190'),
        h('span',{style:{fontWeight:700,fontSize:_fs(14),color:C.tx1,flex:1}},isCreate?'Novy agent':'Upravit agent'),
        h('div',{style:{display:'flex',gap:4}},stepNames.map(function(sn,si){
          return h('span',{key:si,style:{fontSize:_fs(10),padding:'2px 8px',borderRadius:10,background:simpleStep===(si+1)?C.accent:C.bg3,color:simpleStep===(si+1)?'#fff':C.tx3}},sn);
        }))),
      h('div',{style:{padding:'10px 18px',borderTop:'1px solid '+C.border,display:'flex',justifyContent:'flex-end',gap:8,flexShrink:0}},
        simpleStep>1?h('button',{style:btnS2(false,false),onClick:function(){w.simpleStep=simpleStep-1;renderCenter();}},'Zpet'):null,
        simpleStep<3?h('button',{disabled:simpleStep===1&&!d.name,style:btnS2(true,simpleStep===1&&!d.name),
          onClick:function(){if(simpleStep===1&&!d.name)return;w.simpleStep=simpleStep+1;renderCenter();}},'Dalsi'):
        h('button',{disabled:!d.name||w.saving,style:btnS2(true,!d.name||w.saving),
          onClick:function(){if(d.name&&!w.saving){_awSave();}}},w.saving?'Ukladam...':'Vytvorit')),
      h('div',{style:{flex:1,overflowY:'auto',padding:'20px 14px'}},[step1,step2,step3][simpleStep-1]));
  }
  var secHeadS2={display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid '+C.border,userSelect:'none'};
  function awSec(id,icon,title,content){
    return h('div',{key:id,style:{background:C.bg2,borderRadius:10,marginBottom:8,border:'1px solid '+C.border,overflow:'hidden'}},
      h('div',{style:secHeadS2,onClick:function(){_awToggle(id);}},
        h('span',{style:{fontSize:_fs(14)}},icon),
        h('span',{style:{fontSize:_fs(12.5),fontWeight:700,color:C.tx1,flex:1}},title),
        h('span',{style:{fontSize:_fs(10),color:C.tx4,transform:SS[id]?'rotate(180deg)':'none',transition:'transform 0.15s'}},'\u25BC')),
      SS[id]?h('div',{style:{padding:'14px 18px'}},content):null);
  }
  var basicContent=h('div',null,
    h('div',{style:{display:'flex',gap:8,marginBottom:8}},
      h('div',{style:{flex:1}},h('div',{style:labelS2},'Nazev'),h('input',{style:inputS2,value:d.name||'',placeholder:'Nazev agenta',onChange:function(e){d.name=e.target.value;renderCenter();}})),
      h('div',{style:{width:60}},h('div',{style:labelS2},'Ikona'),h('input',{style:Object.assign({},inputS2,{textAlign:'center',fontSize:_fs(18),padding:'4px'}),value:d.icon||'',maxLength:4,onChange:function(e){d.icon=e.target.value;renderCenter();}}))),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS2},'ID'),h('input',{style:inputS2,value:d.id||'',placeholder:'auto-generated',onChange:function(e){d.id=e.target.value;renderCenter();}})),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS2},'Typ'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
        (schema?Object.keys(schema.presets||{}):['MONITOR','HUNTER','TRACKER','DIGEST','SCOUT']).map(function(tid){
          var p=schema&&schema.presets?schema.presets[tid]:null;
          return h('span',{key:tid,style:chipS2(d.type===tid),onClick:function(){_awApplyPreset(tid);}},(p?p.icon+' ':'')+tid);
        }))),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS2},'Popis'),h('textarea',{style:taS2,value:d.description||'',rows:2,onChange:function(e){d.description=e.target.value;renderCenter();}})));
  var schedSrcContent=h('div',null,
    h('div',{style:labelS2},'Rozvrh'),
    h('div',{style:{display:'flex',gap:6,marginBottom:8}},schedTypes.map(function(st){
      return h('span',{key:st,style:chipS2(d.schedule&&d.schedule.type===st),onClick:function(){d.schedule={type:st,value:d.schedule?d.schedule.value:''};renderCenter();}},st);
    })),
    d.schedule&&d.schedule.type==='cron'?h('div',{style:{marginBottom:8}},
      h('input',{style:inputS2,value:d.schedule.value||'',placeholder:'0 8 * * *',onChange:function(e){d.schedule.value=e.target.value;renderCenter();}}),
      h('div',{style:{fontSize:_fs(9),color:C.tx4,margin:'4px 0',fontFamily:C.mono}},'Format: minuta hodina den mesic den_tydne (0=ne, 1=po ... 6=so)'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}},
        [['0 8 * * *','Denne 8:00'],['0 */6 * * *','Kazde 6h'],['0 9 * * 1','Pondeli 9:00'],['0 7,18 * * *','7:00 a 18:00']].map(function(cr){
          return h('span',{key:cr[0],style:Object.assign({},chipS2(d.schedule.value===cr[0]),{fontSize:_fs(10)}),onClick:function(){d.schedule.value=cr[0];renderCenter();}},cr[1]);
        }))):null,
    d.schedule&&d.schedule.type==='interval'?h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}},intervals.map(function(iv){
      return h('span',{key:iv,style:chipS2(d.schedule.value===iv),onClick:function(){d.schedule.value=iv;renderCenter();}},iv);
    })):null,
    h('div',{style:Object.assign({},labelS2,{marginTop:8})},'Zdroje'),
    (d.sources||[]).map(function(src,si){
      return h('div',{key:'as'+si,style:{marginBottom:4}},
        h('div',{style:{fontSize:_fs(9),color:C.tx4,marginBottom:2}},src.id),
        awSourceRow(src,si,srcTypes,(d.sources||[]).length>1));
    }),
    h('span',{style:smallBtn2,onClick:_awAddSource},'+ Zdroj'));
  var condTrigContent=h('div',null,
    h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:4}},
      h('div',{style:labelS2},'Podminky'),
      h('span',{style:Object.assign({},smallBtn2,{fontSize:_fs(9)}),onClick:function(){_awAutoPropose();}},'Navrhnout')),
    (d.conditions||[]).map(function(cond,ci){
      return h('div',{key:'ac'+ci,style:{marginBottom:4}},
        h('div',{style:{fontSize:_fs(9),color:C.tx4,marginBottom:2}},cond.id),
        awCondRow(cond,ci,condTypes,ops,(d.conditions||[]).length>1));
    }),
    h('span',{style:smallBtn2,onClick:_awAddCondition},'+ Podminka'),
    h('div',{style:Object.assign({},labelS2,{marginTop:12})},'Triggery'),
    (d.triggers||[]).map(function(trig,ti){
      return h('div',{key:'at'+ti,style:{display:'flex',gap:4,marginBottom:4,alignItems:'center',flexWrap:'wrap'}},
        h('span',{style:{fontSize:_fs(10),color:C.tx4,width:40}},trig.id),
        h('select',{style:Object.assign({},inputS2,{width:80,flex:'none'}),value:trig.condition_id||'',onChange:function(e){trig.condition_id=e.target.value;renderCenter();}},
          (d.conditions||[]).map(function(c){return h('option',{key:c.id,value:c.id},c.id);})),
        h('select',{style:Object.assign({},inputS2,{width:70,flex:'none'}),value:trig.edge||'rising',onChange:function(e){trig.edge=e.target.value;renderCenter();}},
          ((schema&&schema.allowed?schema.allowed.trigger_edges:['rising','falling','any'])||[]).map(function(te){return h('option',{key:te,value:te},te);})),
        h('input',{style:Object.assign({},inputS2,{width:70,flex:'none'}),type:'number',value:trig.cooldown||300,placeholder:'cooldown',
          onChange:function(e){trig.cooldown=parseInt(e.target.value)||300;renderCenter();}}),
        (d.triggers||[]).length>1?h('span',{style:{cursor:'pointer',color:C.tx4},onClick:function(){_awRemoveTrigger(ti);}},'✕'):null);
    }),
    h('span',{style:smallBtn2,onClick:_awAddTrigger},'+ Trigger'));
  var actParamContent=h('div',null,
    h('div',{style:labelS2},'Akce'),
    (d.actions||[]).map(function(act,ai){
      return h('div',{key:'aa'+ai,style:{marginBottom:4}},
        h('div',{style:{display:'flex',gap:4,alignItems:'center',marginBottom:2}},
          h('span',{style:{fontSize:_fs(9),color:C.tx4}},'Trigger:'),
          h('select',{style:Object.assign({},inputS2,{width:80,flex:'none',fontSize:_fs(10)}),value:act.trigger_id||'',onChange:function(e){act.trigger_id=e.target.value;renderCenter();}},
            h('option',{value:''},'(vsechny)'),
            (d.triggers||[]).map(function(t){return h('option',{key:t.id,value:t.id},t.id);}))),
        awActRow(act,ai,actTypes,(d.actions||[]).length>1));
    }),
    h('span',{style:smallBtn2,onClick:_awAddAction},'+ Akce'));
  var previewContent=h('div',null,
    h('div',{style:{display:'flex',gap:8,marginBottom:8}},
      h('button',{style:btnS2(false,w.testLoading),onClick:_awDryRun},w.testLoading?'Validuji...':'Validovat'),
      w.editId?h('button',{style:btnS2(false,w.testLoading),onClick:_awTestRun},'Test run'):null),
    awPreviewBlock(),
    w.testResult?h('div',{style:{padding:8,borderRadius:6,background:C.bg1,fontSize:_fs(11),color:C.tx2,marginTop:8}},
      h('div',{style:{fontWeight:600,marginBottom:4}},'Test run vysledek:'),
      h('pre',{style:{whiteSpace:'pre-wrap',margin:0,fontFamily:C.mono,fontSize:_fs(10)}},JSON.stringify(w.testResult,null,2))):null,
    w.testError&&!w.preview?h('div',{style:{padding:8,borderRadius:6,background:'#e5510a',fontSize:_fs(11),color:'#f88',marginTop:8}},w.testError):null);
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}},
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
      h('span',{style:{cursor:'pointer',marginRight:10,fontSize:_fs(14),color:C.tx3},onClick:_awClose},'\u2190'),
      h('span',{style:{fontWeight:700,fontSize:_fs(14),color:C.tx1,flex:1}},isCreate?'Novy agent (pokrocily)':'Upravit agent'),
      h('span',{style:{fontSize:_fs(11),color:C.accent,cursor:'pointer'},onClick:function(){w.advancedMode=false;renderCenter();}},'Jednoduchy rezim')),
    h('div',{style:{padding:'10px 18px',borderTop:'1px solid '+C.border,display:'flex',justifyContent:'flex-end',gap:8,flexShrink:0}},
      h('button',{style:btnS2(false,false),onClick:_awClose},'Zrusit'),
      h('button',{disabled:!d.name||w.saving,style:btnS2(true,!d.name||w.saving),
        onClick:function(){if(d.name&&!w.saving){_awSave();}}},w.saving?'Ukladam...':(isCreate?'Vytvorit':'Ulozit'))),
    h('div',{style:{flex:1,overflowY:'auto',padding:'12px 14px'}},
      awSec('basic','\u{1F4CB}','Zakladni udaje',basicContent),
      awSec('schedule','\u23F0','Rozvrh & Zdroje',schedSrcContent),
      awSec('conditions','\u{1F500}','Podminky & Triggery',condTrigContent),
      awSec('actions','\u26A1','Akce & Parametry',actParamContent),
      awSec('preview','\u{1F50D}','Preview & Test',previewContent)));
}
function centerExpertiseWizard(){
  var w=_expertiseWizard,d=w.data,schema=w.schema,isCreate=w.mode==='create',SS=w.openSections;
  var labelS={fontSize:_fs(11),color:C.tx3,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.4px',marginBottom:4};
  var inputS={width:'100%',padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:_fs(12.5),outline:'none',boxSizing:'border-box'};
  var taS={width:'100%',padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.mono,fontSize:_fs(12),outline:'none',boxSizing:'border-box',minHeight:60,resize:'vertical'};
  var btnS=function(primary,disabled){return{padding:'5px '+(primary?16:12)+'px',borderRadius:6,border:primary?'none':'1px solid '+C.border2,background:disabled?C.bg4:primary?C.accent:C.bg3,color:primary?'#fff':C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:primary?600:400,cursor:disabled?'default':'pointer'};};
  /* --- Detect domain preset --- */
  var detectedPreset=_ewDetectDomain(d.name||'',d.domain||'');
  var presetInfo=_DOMAIN_PRESETS[detectedPreset];
  /* --- Confirmation modal for advanced mode --- */
  if(w.confirmAdvanced){
    return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center'}},
      h('div',{style:{background:C.bg2,borderRadius:14,padding:32,maxWidth:460,border:'1px solid '+C.border,textAlign:'center'}},
        h('div',{style:{fontSize:_fs(28),marginBottom:12}},'⚙️'),
        h('h3',{style:{color:C.tx1,fontSize:_fs(16),fontWeight:700,margin:'0 0 8px'}},'Pokročilé nastavení'),
        h('p',{style:{color:C.tx3,fontSize:_fs(12),lineHeight:'1.6',margin:'0 0 20px'}},
          'Toto vyžaduje znalost 5D capability systému, module struktury a enforcement pipeline. Nesprávné nastavení může vést k nekvalitním nebo nekonzistentním odpovědím.'),
        h('div',{style:{display:'flex',gap:8,justifyContent:'center'}},
          h('button',{style:btnS(false,false),onClick:function(){w.confirmAdvanced=false;renderCenter();}},'Zpět'),
          h('button',{style:btnS(true,false),onClick:function(){w.confirmAdvanced=false;w.advancedMode=true;w.openSections={basic:true,capabilities:true,modules:false,preview:false};renderCenter();}},'Rozumím, pokračovat'))));
  }
  /* ═══ SIMPLE MODE (2-step) ═══ */
  var _emojiPool=['🤖','⚖️','🏥','💰','✍️','💻','🧠','🔬','🎓','📊','🏠','🚗','🎨','🌍','📱','🔧','🛡️','📚','🎯','👨‍💼'];
  if(!w.advancedMode){
    var simpleStep=w.simpleStep||1;
    /* Step 1: Name, Domain, Icon, Description */
    var step1=h('div',{style:{maxWidth:560,margin:'0 auto',width:'100%'}},
      h('div',{style:{display:'flex',gap:8,marginBottom:10}},
        h('div',{style:{flex:1}},h('div',{style:labelS},'Název expertyzy'),h('input',{style:inputS,value:d.name||'',placeholder:'Např. Právní poradce',autoFocus:true,
          onChange:function(e){d.name=e.target.value;var det=_ewDetectDomain(d.name,d.domain||'');_ewApplyPreset(det);}})),
        h('div',{style:{width:60}},h('div',{style:labelS},'Ikona'),h('input',{style:Object.assign({},inputS,{textAlign:'center',fontSize:_fs(18),padding:'4px'}),value:d.icon||'',maxLength:4,onChange:function(e){d.icon=e.target.value;renderCenter();}}))),
      /* Icon picker pool */
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Rychlý výběr ikony'),
        h('div',{style:{display:'flex',gap:4,flexWrap:'wrap'}},_emojiPool.map(function(em){
          return h('button',{key:em,style:{width:32,height:32,borderRadius:6,border:'1px solid '+(d.icon===em?C.accent:C.border),background:d.icon===em?(C.accentBg||'rgba(34,197,94,0.1)'):C.bg3,fontSize:_fs(16),cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0},
            onClick:function(){d.icon=em;renderCenter();}},em);})),
        h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:4}},'Nebo zadejte vlastní emoji/Unicode znak (max 4 znaky)')),
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Doména'),h('input',{style:inputS,value:d.domain||'',placeholder:'nazev_domeny',
        onChange:function(e){d.domain=e.target.value;var det=_ewDetectDomain(d.name||'',d.domain);_ewApplyPreset(det);}})),
      /* Preset picker chips */
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Nebo vyberte šablonu:'),
        h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
          Object.keys(_DOMAIN_PRESETS).map(function(key){
            var p=_DOMAIN_PRESETS[key];var isSel=detectedPreset===key;
            return h('button',{key:key,style:{padding:'4px 12px',borderRadius:16,border:'1px solid '+(isSel?C.accent:C.border),background:isSel?(C.accentBg||'rgba(34,197,94,0.1)'):C.bg3,color:isSel?C.accent:C.tx3,fontSize:_fs(10),fontWeight:isSel?700:400,cursor:'pointer'},
              onClick:function(){d.domain=key;_ewApplyPreset(key);}},p.label);}))),
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Popis'),h('textarea',{style:Object.assign({},taS,{minHeight:36,fontFamily:C.font}),value:d.description||'',placeholder:'Stručný popis co expertyza umí...',onChange:function(e){d.description=e.target.value;renderCenter();}})));
    /* Step 2: Tuning + Test */
    var step2=h('div',{style:{maxWidth:560,margin:'0 auto',width:'100%'}},
      /* Auto-detected summary */
      presetInfo?h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:12,padding:'8px 14px',background:C.accentBg||'rgba(34,197,94,0.08)',borderRadius:8,border:'1px solid '+C.border}},
        h('span',{style:{fontSize:_fs(16)}},d.icon||'🤖'),
        h('span',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1}},d.name||''),
        h('span',{style:{fontSize:_fs(10),fontWeight:700,color:C.accent,padding:'2px 8px',borderRadius:10,background:'rgba(34,197,94,0.15)'}},presetInfo.label||detectedPreset)):null,
      /* Key tuning sliders */
      h('div',{style:{marginBottom:14}},h('div',{style:labelS},'Ladění (C3 nastavil výchozí hodnoty)'),
        [{k:'creativity',l:'Kreativita',hint:'Nízká = striktní fakta, Vysoká = volné asociace'},
         {k:'reasoning',l:'Analytičnost',hint:'Nízká = intuitivní, Vysoká = systematické uvažování'},
         {k:'determinism',l:'Konzistence',hint:'Nízká = variabilní, Vysoká = stejné odpovědi'}].map(function(dim){
          var v=(d.capabilities&&d.capabilities[dim.k]!=null)?d.capabilities[dim.k]:50;
          var hintC=v<=30?'#ef4444':v>70?'#22c55e':'#eab308';
          return h('div',{key:dim.k,style:{marginBottom:10}},
            h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:2}},
              h('span',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2}},dim.l),
              h('span',{style:{fontSize:_fs(11),fontFamily:C.mono,color:hintC,fontWeight:700}},String(v))),
            h('input',{type:'range',min:0,max:100,value:v,style:{width:'100%',accentColor:C.accent},onChange:function(e){if(!d.capabilities)d.capabilities={};d.capabilities[dim.k]=parseInt(e.target.value);_ewPreview();renderCenter();}}),
            h('div',{style:{fontSize:_fs(9),color:C.tx4}},dim.hint));
        })),
      /* Temperature + Tone */
      h('div',{style:{display:'flex',gap:12,marginBottom:14}},
        h('div',{style:{flex:1}},h('div',{style:labelS},'Tón'),
          h('select',{style:Object.assign({},inputS,{padding:'6px 10px'}),value:d.tone||'professional',onChange:function(e){d.tone=e.target.value;_ewPreview();renderCenter();}},
            ['professional','casual','academic','empathetic','assertive','neutral'].map(function(t){return h('option',{key:t,value:t},t);}))),
        h('div',{style:{flex:1}},h('div',{style:labelS},'Teplota: '+(d.temperature!=null?d.temperature:0.5)),
          h('input',{type:'range',min:0,max:1,step:0.05,value:d.temperature!=null?d.temperature:0.5,style:{width:'100%',accentColor:C.accent},onChange:function(e){d.temperature=parseFloat(e.target.value);_ewPreview();renderCenter();}}))),
      /* System Prompt */
      h('div',{style:{marginBottom:14}},h('div',{style:labelS},'System Prompt (volitelný)'),h('textarea',{style:Object.assign({},taS,{minHeight:60}),value:d.systemPrompt||'',placeholder:'Vlastní instrukce... (nepovinné, preset nastaví základní pravidla automaticky)',onChange:function(e){d.systemPrompt=e.target.value;renderCenter();}})),
      /* Test prompt */
      h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,marginBottom:14}},
        h('div',{style:Object.assign({},labelS,{marginBottom:8})},'Vyzkoušet expertyzu'),
        h('div',{style:{display:'flex',gap:6}},
          h('input',{id:'ew-test-q',style:Object.assign({},inputS,{fontSize:_fs(11)}),placeholder:'Zadejte testovací otázku...',disabled:w.testLoading,
            onKeyDown:function(e){if(e.key==='Enter'){var el=document.getElementById('ew-test-q');if(el&&el.value.trim())_ewTest(el.value.trim());}}}),
          h('button',{disabled:w.testLoading||!d.name,style:{background:(w.testLoading||!d.name)?C.bg4:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'5px 14px',fontSize:_fs(11),fontWeight:600,cursor:(w.testLoading||!d.name)?'default':'pointer',flexShrink:0},
            onClick:function(){var el=document.getElementById('ew-test-q');if(el&&el.value.trim())_ewTest(el.value.trim());}},w.testLoading?'Generuji...':'Otestovat')),
        w.testError?h('div',{style:{color:'#ef4444',fontSize:_fs(11),marginTop:6}},w.testError):null,
        w.testResult?h('div',{style:{marginTop:8,background:C.bg3,borderRadius:8,padding:12,border:'1px solid '+C.border}},
          h('div',{style:{fontSize:_fs(11),color:C.tx1,whiteSpace:'pre-wrap',lineHeight:'1.5'}},w.testResult.response||''),
          h('div',{style:{display:'flex',gap:8,marginTop:6,fontSize:_fs(9),color:C.tx4}},
            w.testResult.model?h('span',null,w.testResult.model):null,
            w.testResult.duration?h('span',null,w.testResult.duration+'ms'):null)):null),
      /* Advanced mode link */
      h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,display:'flex',alignItems:'center',gap:8}},
        h('button',{style:{padding:'5px 14px',borderRadius:6,border:'1px solid '+C.border2,background:'transparent',color:C.tx4,fontFamily:C.font,fontSize:_fs(10),cursor:'pointer'},
          onClick:function(){w.confirmAdvanced=true;renderCenter();}},'Pokročilé nastavení'),
        h('span',{style:{fontSize:_fs(10),color:C.tx4}},'Všechny Capabilities, Modules, Preview & Test')));
    /* Step indicator + navigation */
    return h('div',{style:{display:'flex',flexDirection:'column',height:'100%'}},
      h('div',{style:{padding:'10px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},
        h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},isCreate?'+ Nová expertyza':'✏️ Editace: '+(d.name||'?')),
        h('div',{style:{display:'flex',gap:4,marginRight:8}},
          h('span',{style:{width:8,height:8,borderRadius:'50%',background:simpleStep===1?C.accent:C.bg4}}),
          h('span',{style:{width:8,height:8,borderRadius:'50%',background:simpleStep===2?C.accent:C.bg4}})),
        h('button',{style:btnS(false,false),onClick:_ewClose},'Zrušit'),
        simpleStep===1?h('button',{disabled:!d.name,style:btnS(true,!d.name),
          onClick:function(){if(d.name){if(!d.domain)d.domain=_ewDetectDomain(d.name,'');_ewApplyPreset(_ewDetectDomain(d.name,d.domain));w.simpleStep=2;_ewPreview();renderCenter();}}},'Další'):
        h('div',{style:{display:'flex',gap:6}},
          h('button',{style:btnS(false,false),onClick:function(){w.simpleStep=1;renderCenter();}},'Zpět'),
          h('button',{disabled:!d.name||w.saving,style:btnS(true,!d.name||w.saving),
            onClick:function(){if(d.name&&!w.saving){if(!d.domain)d.domain=d.name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');_ewSave();}}},w.saving?'Ukládám...':'Vytvořit'))),
      h('div',{style:{flex:1,overflowY:'auto',padding:'20px 14px'}},simpleStep===1?step1:step2));
  }
  /* ═══ ADVANCED MODE ═══ */
  var secHeadS={display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid '+C.border,userSelect:'none'};
  function sec(id,icon,title,content){
    return h('div',{key:id,style:{background:C.bg2,borderRadius:10,marginBottom:8,border:'1px solid '+C.border,overflow:'hidden'}},
      h('div',{style:secHeadS,onClick:function(){_ewToggle(id);}},
        h('span',{style:{fontSize:_fs(14)}},icon),
        h('span',{style:{fontSize:_fs(12.5),fontWeight:700,color:C.tx1,flex:1}},title),
        h('span',{style:{fontSize:_fs(10),color:C.tx4,transform:SS[id]?'rotate(180deg)':'none',transition:'transform 0.15s'}},'▼')),
      SS[id]?h('div',{style:{padding:'14px 18px'}},content):null);
  }
  /* Section 1: Basic info */
  var basicContent=h('div',null,
    h('div',{style:{display:'flex',gap:8,marginBottom:8}},
      h('div',{style:{flex:1}},h('div',{style:labelS},'Název'),h('input',{style:inputS,value:d.name||'',placeholder:'Název expertyzy',onChange:function(e){d.name=e.target.value;renderCenter();}})),
      h('div',{style:{width:60}},h('div',{style:labelS},'Ikona'),h('input',{style:Object.assign({},inputS,{textAlign:'center',fontSize:_fs(18),padding:'4px'}),value:d.icon||'',maxLength:4,onChange:function(e){d.icon=e.target.value;renderCenter();}}))),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS},'Doména'),h('input',{style:inputS,value:d.domain||'',placeholder:'nazev_domeny',onChange:function(e){d.domain=e.target.value;renderCenter();}})),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS},'Popis'),h('textarea',{style:Object.assign({},taS,{minHeight:40,fontFamily:C.font}),value:d.description||'',placeholder:'Stručný popis',onChange:function(e){d.description=e.target.value;renderCenter();}})),
    h('div',{style:{marginBottom:8}},h('div',{style:labelS},'System Prompt'),h('textarea',{style:Object.assign({},taS,{minHeight:80}),value:d.systemPrompt||'',placeholder:'Systémový prompt...',onChange:function(e){d.systemPrompt=e.target.value;_ewPreview();renderCenter();}})),
    h('div',{style:{display:'flex',gap:12}},
      h('div',{style:{flex:1}},h('div',{style:labelS},'Tón'),
        h('select',{style:Object.assign({},inputS,{padding:'6px 10px'}),value:d.tone||'professional',onChange:function(e){d.tone=e.target.value;_ewPreview();renderCenter();}},
          ['professional','casual','academic','empathetic','assertive','neutral'].map(function(t){return h('option',{key:t,value:t},t);}))),
      h('div',{style:{flex:1}},h('div',{style:labelS},'Teplota: '+(d.temperature!=null?d.temperature:0.5)),
        h('input',{type:'range',min:0,max:1,step:0.05,value:d.temperature!=null?d.temperature:0.5,style:{width:'100%',accentColor:C.accent},onChange:function(e){d.temperature=parseFloat(e.target.value);_ewPreview();renderCenter();}}))));
  /* Section 2: Capabilities */
  var capDims=[{k:'reasoning',l:'Reasoning'},{k:'creativity',l:'Kreativita'},{k:'determinism',l:'Determinismus'},{k:'riskTolerance',l:'Risk Tolerance'},{k:'verbosity',l:'Verbozita'}];
  var capsContent=h('div',null,capDims.map(function(dim){
    var v=(d.capabilities&&d.capabilities[dim.k]!=null)?d.capabilities[dim.k]:50;
    var hint=v<=30?'LOW':v>70?'HIGH':'MEDIUM';
    var hintC=v<=30?'#ef4444':v>70?'#22c55e':'#eab308';
    return h('div',{key:dim.k,style:{display:'flex',alignItems:'center',gap:8,marginBottom:10}},
      h('span',{style:{width:105,fontSize:_fs(11),color:C.tx2}},dim.l),
      h('input',{type:'range',min:0,max:100,value:v,style:{flex:1,accentColor:C.accent},onChange:function(e){if(!d.capabilities)d.capabilities={};d.capabilities[dim.k]=parseInt(e.target.value);_ewPreview();renderCenter();}}),
      h('span',{style:{width:28,fontSize:_fs(12),fontFamily:C.mono,color:C.tx1,textAlign:'right'}},String(v)),
      h('span',{style:{fontSize:_fs(9),fontWeight:700,color:hintC,width:44,textAlign:'center',padding:'1px 4px',borderRadius:4,background:hintC+'18'}},hint));
  }),
  h('div',{style:{marginTop:8}},h('button',{style:{padding:'3px 10px',borderRadius:5,border:'1px solid '+C.border2,background:'transparent',color:C.tx4,fontSize:_fs(10),cursor:'pointer'},
    onClick:function(){_ewApplyPreset(detectedPreset);}},'Resetovat na výchozí ('+detectedPreset+')')));
  /* Section 3: Modules */
  var modSecs=['domain_rules','emphasis','constraints','vocabulary','antipatterns'];
  var modLabels={domain_rules:'Domain Rules',emphasis:'Emphasis',constraints:'Constraints',vocabulary:'Vocabulary',antipatterns:'Antipatterns'};
  var modLimits=schema&&schema.limits?{domain_rules:schema.limits.MAX_DOMAIN_RULES||15,emphasis:schema.limits.MAX_EMPHASIS||10,constraints:schema.limits.MAX_CONSTRAINTS||15,vocabulary:schema.limits.MAX_VOCABULARY||30,antipatterns:schema.limits.MAX_ANTIPATTERNS||10}:{domain_rules:15,emphasis:10,constraints:15,vocabulary:30,antipatterns:10};
  var modsContent=h('div',null,
    modSecs.map(function(s){
      var items=(d.modules&&d.modules[s])||[];var lim=modLimits[s]||15;
      return h('div',{key:s,style:{marginBottom:10,background:C.bg3,borderRadius:8,padding:'8px 12px'}},
        h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:5}},
          h('span',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx2}},modLabels[s]||s),
          h('span',{style:{fontSize:_fs(10),color:C.tx4,fontFamily:C.mono}},items.length+' / '+lim)),
        items.map(function(item,idx){
          return h('div',{key:idx,style:{display:'flex',alignItems:'center',gap:4,marginBottom:3}},
            h('span',{style:{flex:1,fontSize:_fs(11),color:C.tx1,padding:'2px 6px',background:C.bg4,borderRadius:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},item),
            h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',fontSize:_fs(13),padding:'0 4px',lineHeight:1},onClick:function(){_ewRemModItem(s,idx);}},'×'));
        }),
        items.length<lim?h('div',{style:{display:'flex',gap:4,marginTop:4}},
          h('input',{id:'ew-mod-'+s,style:Object.assign({},inputS,{fontSize:_fs(11),padding:'4px 8px'}),placeholder:'Přidat...',onKeyDown:function(e){if(e.key==='Enter')_ewAddModItem(s);}}),
          h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(11),cursor:'pointer'},onClick:function(){_ewAddModItem(s);}},'+')
        ):null);
    }),
    h('div',{style:{marginBottom:8,background:C.bg3,borderRadius:8,padding:'8px 12px'}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx2,marginBottom:5}},'Disclaimer'),
      h('textarea',{style:Object.assign({},taS,{minHeight:36,fontSize:_fs(11)}),value:(d.modules&&d.modules.disclaimer)||'',placeholder:'Volitelný disclaimer...',onChange:function(e){if(!d.modules)d.modules={};d.modules.disclaimer=e.target.value||null;_ewPreview();renderCenter();}})),
    h('div',{style:{marginTop:6}},h('button',{style:{padding:'3px 10px',borderRadius:5,border:'1px solid '+C.border2,background:'transparent',color:C.tx4,fontSize:_fs(10),cursor:'pointer'},
      onClick:function(){var p=_DOMAIN_PRESETS[detectedPreset]||_DOMAIN_PRESETS.general;d.modules={domain_rules:(p.modules.domain_rules||[]).slice(),emphasis:(p.modules.emphasis||[]).slice(),constraints:(p.modules.constraints||[]).slice(),vocabulary:(p.modules.vocabulary||[]).slice(),antipatterns:(p.modules.antipatterns||[]).slice(),disclaimer:p.modules.disclaimer||null};renderCenter();}},'Resetovat moduly na výchozí')));
  /* Section 4: Preview & Test */
  var pr=w.preview;
  var previewContent=h('div',null,
    pr?h('div',null,
      h('div',{style:{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}},
        h('span',{style:{padding:'2px 8px',borderRadius:10,fontSize:_fs(10),fontWeight:700,
          background:pr.compatibility==='ok'?'rgba(34,197,94,0.15)':pr.compatibility==='warning'?'rgba(234,179,8,0.15)':pr.compatibility==='soft_block'?'rgba(249,115,22,0.15)':'rgba(239,68,68,0.15)',
          color:pr.compatibility==='ok'?'#22c55e':pr.compatibility==='warning'?'#eab308':pr.compatibility==='soft_block'?'#f97316':'#ef4444'}},
          String(pr.compatibility||'?').toUpperCase()),
        pr.tokenCount!=null?h('span',{style:{fontSize:_fs(10),color:C.tx3,fontFamily:C.mono}},pr.tokenCount+' tokenů'):null,
        pr.tone?h('span',{style:{fontSize:_fs(10),color:C.tx3}},'tón: '+pr.tone):null,
        pr.temperature!=null?h('span',{style:{fontSize:_fs(10),color:C.tx3}},'temp: '+pr.temperature):null),
      pr.promptPreview?h('pre',{style:{background:C.bg3,borderRadius:6,padding:8,fontSize:_fs(10),fontFamily:C.mono,color:C.tx2,maxHeight:160,overflowY:'auto',whiteSpace:'pre-wrap',border:'1px solid '+C.border}},pr.promptPreview):null,
      pr.enforcement?h('div',{style:{display:'flex',gap:10,marginTop:8,fontSize:_fs(10),color:C.tx3}},
        h('span',null,'Forbidden: '+(pr.enforcement.forbiddenCount||0)),
        h('span',null,'MinLen: '+(pr.enforcement.minResponseLength||0)),
        h('span',null,'Disclaimers: '+(pr.enforcement.disclaimerCount||0))):null
    ):h('p',{style:{fontSize:_fs(11),color:C.tx4,margin:0}},'Vyplňte název a system prompt pro preview.'),
    h('div',{style:{marginTop:12,borderTop:'1px solid '+C.border,paddingTop:10}},
      h('div',{style:labelS},'Test prompt'),
      h('div',{style:{display:'flex',gap:6}},
        h('input',{id:'ew-test-q',style:Object.assign({},inputS,{fontSize:_fs(11)}),placeholder:'Testovací otázka...',disabled:w.testLoading,
          onKeyDown:function(e){if(e.key==='Enter'){var el=document.getElementById('ew-test-q');if(el&&el.value.trim())_ewTest(el.value.trim());}}}),
        h('button',{disabled:w.testLoading,style:{background:w.testLoading?C.bg4:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'5px 14px',fontSize:_fs(11),fontWeight:600,cursor:w.testLoading?'default':'pointer',flexShrink:0},
          onClick:function(){var el=document.getElementById('ew-test-q');if(el&&el.value.trim())_ewTest(el.value.trim());}},w.testLoading?'Čekám...':'Test')),
      w.testError?h('div',{style:{color:'#ef4444',fontSize:_fs(11),marginTop:6}},w.testError):null,
      w.testResult?h('div',{style:{marginTop:8,background:C.bg3,borderRadius:6,padding:10,border:'1px solid '+C.border}},
        h('div',{style:{fontSize:_fs(11),color:C.tx1,whiteSpace:'pre-wrap',lineHeight:'1.5'}},w.testResult.response||''),
        h('div',{style:{display:'flex',gap:8,marginTop:6,fontSize:_fs(9),color:C.tx4}},
          w.testResult.model?h('span',null,w.testResult.model):null,
          w.testResult.duration?h('span',null,w.testResult.duration+'ms'):null,
          w.testResult.tokenCount?h('span',null,w.testResult.tokenCount+' tok'):null)):null));
  /* Advanced wizard layout */
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%'}},
    h('div',{style:{padding:'10px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},
      h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},isCreate?'+ Nová expertyza (pokročilý)':'✏️ Editace: '+(d.name||'?')),
      h('button',{style:{padding:'4px 10px',borderRadius:5,border:'1px solid '+C.border2,background:'transparent',color:C.tx4,fontFamily:C.font,fontSize:_fs(10),cursor:'pointer'},
        onClick:function(){w.advancedMode=false;w.simpleStep=1;renderCenter();}},'Jednoduchý mód'),
      h('button',{style:btnS(false,false),onClick:_ewClose},'Zrušit'),
      h('button',{disabled:!d.name||w.saving,style:btnS(true,!d.name||w.saving),onClick:_ewSave},w.saving?'Ukládám...':'Uložit')),
    h('div',{style:{flex:1,overflowY:'auto',padding:14}},
      sec('basic','📝','Základní údaje',basicContent),
      sec('capabilities','📊','Capabilities (5D)',capsContent),
      sec('modules','📦','Modules',modsContent),
      sec('preview','👁️','Preview & Test',previewContent)));
}

/* Settings state */
var _settingsVals={theme:'dark',accentIdx:0,activeInt:100,passiveInt:50,fontSizeVal:13,fontIdx:0,custom1:null,custom2:null,bgIdx:0,bgCustom1:null,bgCustom2:null,customCSS:'',visualMode:'borders',tileOpacity:80,bgDim:30,sidebarOpacity:80,projectsDir:'',autoCollapse:true,restoreSession:true,lastView:''};
/* M1: Backend config state — loaded from the versioned settings authority. */
var _bCfg=null;var _bCfgRevision=null;var _bCfgLoading=false;var _gpuInfo=null;var _ollamaModels=null;var _sysInfo=null;var _storageInfo=null;var _bCfgSaveTimer=null;
var _upgradeData=null;var _upgradeLoading=false;var _upgradeMsg=null;var _upgradeAutoChecked=false;
/* M1: operation-bound upgrade recovery.  This ledger is deliberately
   independent from transient toasts and role-only model_changed events. */
var _upgradeRecoveryByRole=Object.create(null);var _upgradeRecoveryWatermarks=Object.create(null);var _upgradeRecoveryToken=0;
var _upgradeRecoveryRoles={D1:true,D2:true,CODE:true,R1:true,R2:true,CHAT:true,VISION:true};
function _upgradeRecoveryKnownRole(v){return typeof v==='string'&&Object.hasOwn(_upgradeRecoveryRoles,v);}
function _upgradeRecoveryExactString(v){return typeof v==='string'&&v.length>0&&v===v.trim();}
function _upgradeRecoveryIdentity(ev){
  if(!ev||typeof ev!=='object'||Array.isArray(ev)||!_upgradeRecoveryKnownRole(ev.role)
    ||!_upgradeRecoveryExactString(ev.model)||!_upgradeRecoveryExactString(ev.operationId)
    ||!Number.isSafeInteger(ev.committedBindingRevision)||ev.committedBindingRevision<1
    ||!Number.isSafeInteger(ev.failedAttemptRevision)||ev.failedAttemptRevision<1)return null;
  return{role:ev.role,model:ev.model,operationId:ev.operationId,
    committedBindingRevision:ev.committedBindingRevision,failedAttemptRevision:ev.failedAttemptRevision};
}
function _upgradeRecoveryKey(v){return v.model+'\u0000'+v.operationId+'\u0000'+v.committedBindingRevision+'\u0000'+v.failedAttemptRevision;}
function _upgradeRecoveryCompare(a,b){
  if(a.committedBindingRevision!==b.committedBindingRevision)return a.committedBindingRevision-b.committedBindingRevision;
  if(a.failedAttemptRevision!==b.failedAttemptRevision)return a.failedAttemptRevision-b.failedAttemptRevision;
  return a.operationId===b.operationId?0:-1;
}
function _upgradeRecoveryClose(role,record){
  if(record&&record.identity){
    var watermark=_upgradeRecoveryWatermarks[role];
    if(!watermark||_upgradeRecoveryCompare(record.identity,watermark)>0)_upgradeRecoveryWatermarks[role]=record.identity;
  }
  if(_upgradeRecoveryByRole[role]===record)delete _upgradeRecoveryByRole[role];
}
function _upgradeRecoveryReceiveFailure(ev){
  var identity=_upgradeRecoveryIdentity(ev);var role=ev&&ev.role;
  if(!identity){
    if(_upgradeRecoveryKnownRole(role)&&_upgradeRecoveryByRole[role])_upgradeRecoveryClose(role,_upgradeRecoveryByRole[role]);
    return false;
  }
  var watermark=_upgradeRecoveryWatermarks[identity.role];
  if(watermark&&(_upgradeRecoveryKey(watermark)===_upgradeRecoveryKey(identity)||_upgradeRecoveryCompare(identity,watermark)<=0))return false;
  var current=_upgradeRecoveryByRole[identity.role];
  if(current){
    if(_upgradeRecoveryKey(current.identity)===_upgradeRecoveryKey(identity)||_upgradeRecoveryCompare(identity,current.identity)<=0)return false;
    _upgradeRecoveryClose(identity.role,current);
  }
  _upgradeRecoveryByRole[identity.role]={identity:identity,token:++_upgradeRecoveryToken,phase:'READY',message:ev.text||'Model neprošel ověřením.'};
  return true;
}
function _upgradeRecoveryReceiveClear(ev){
  var identity=_upgradeRecoveryIdentity(ev);
  if(!identity||!Number.isSafeInteger(ev.succeededAttemptRevision)||ev.succeededAttemptRevision<1)return false;
  var current=_upgradeRecoveryByRole[identity.role];
  if(!current||_upgradeRecoveryKey(current.identity)!==_upgradeRecoveryKey(identity))return false;
  _upgradeRecoveryClose(identity.role,current);return true;
}
function _upgradeRecoverySnapshot(){
  return Object.keys(_upgradeRecoveryByRole).sort().map(function(role){
    var record=_upgradeRecoveryByRole[role];return{role:role,model:record.identity.model,
      operationId:record.identity.operationId,committedBindingRevision:record.identity.committedBindingRevision,
      failedAttemptRevision:record.identity.failedAttemptRevision,token:record.token,phase:record.phase,message:record.message};
  });
}
function _upgradeRecoveryBegin(role,token){
  var record=_upgradeRecoveryByRole[role];
  if(!record||record.token!==token||(record.phase!=='READY'&&record.phase!=='RETRYABLE'))return false;
  record.phase='CONFIRMING';renderCenter();return true;
}
function _upgradeRecoveryCancel(role,token){
  var record=_upgradeRecoveryByRole[role];
  if(!record||record.token!==token||record.phase!=='CONFIRMING')return false;
  record.phase='READY';renderCenter();return true;
}
async function _upgradeRecoveryConfirm(role,token){
  var record=_upgradeRecoveryByRole[role];
  if(!record||record.token!==token||record.phase!=='CONFIRMING')return false;
  var identity=record.identity;record.phase='IN_FLIGHT';record.message='Provádím přesně svázaný rollback...';renderCenter();
  var response;var body=null;var parsed=false;
  try{
    response=await fetch(_backendBase+'/api/system/upgrades/recovery/rollback',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({role:identity.role,operationId:identity.operationId,
        committedBindingRevision:identity.committedBindingRevision,failedAttemptRevision:identity.failedAttemptRevision}),
      signal:AbortSignal.timeout(30000)});
    try{body=await response.json();parsed=true;}catch(_jsonError){parsed=false;}
  }catch(error){
    record=_upgradeRecoveryByRole[role];if(!record||record.token!==token)return false;
    record.phase='RETRYABLE';record.message='Rollback nebyl doručen: '+(error&&error.message?error.message:'chyba sítě');renderCenter();return false;
  }
  record=_upgradeRecoveryByRole[role];if(!record||record.token!==token)return false;
  if(!response.ok){
    record.phase=response.status>=500?'RETRYABLE':'DISABLED';
    record.message=(response.status===409?'Akce už není aktuální. ':'Rollback byl odmítnut. ')+(parsed&&body&&body.error?body.error:'HTTP '+response.status);
    renderCenter();return false;
  }
  var exact=parsed&&body&&body.ok===true&&body.role===identity.role
    &&body.operationId===identity.operationId
    &&body.committedBindingRevision===identity.committedBindingRevision
    &&body.failedAttemptRevision===identity.failedAttemptRevision
    &&_upgradeRecoveryExactString(body.rollbackOperationId);
  if(!exact){record.phase='UNKNOWN';record.message='Výsledek rollbacku nelze bezpečně potvrdit. Akci neopakujte.';renderCenter();return false;}
  _upgradeRecoveryClose(role,record);_roleBindings=null;_modelOverview=null;_upgradeData=null;
  _upgradeMsg={ok:true,text:'Model role '+role+' byl vrácen na předchozí binding.'};
  _loadUpgradeData();renderCenter();return true;
}
function _renderUpgradeRecoveries(){
  var rows=_upgradeRecoverySnapshot();if(rows.length===0)return null;
  return h('div',{style:{margin:'10px 18px 0',display:'flex',flexDirection:'column',gap:8}},rows.map(function(row){
    var busy=row.phase==='IN_FLIGHT';var closed=row.phase==='DISABLED'||row.phase==='UNKNOWN';
    return h('div',{key:row.role,style:{padding:'10px 12px',borderRadius:7,background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:8}},
        h('span',{style:{fontSize:_fs(11),fontWeight:700,color:'#ef4444'}},'Ověření selhalo: '+row.role),
        h('span',{style:{fontSize:_fs(10),color:C.tx3,fontFamily:C.mono,flex:1}},row.model),
        row.phase==='CONFIRMING'?h(React.Fragment,null,
          h('button',{style:{padding:'4px 10px',borderRadius:5,border:'1px solid '+C.border2,background:'transparent',color:C.tx3,cursor:'pointer'},
            onClick:function(){_upgradeRecoveryCancel(row.role,row.token);}},'Zrušit'),
          h('button',{style:{padding:'4px 10px',borderRadius:5,border:'none',background:'#ef4444',color:'#fff',fontWeight:600,cursor:'pointer'},
            onClick:function(){_upgradeRecoveryConfirm(row.role,row.token);}},'Potvrdit rollback')):
        (!busy&&!closed?h('button',{style:{padding:'4px 10px',borderRadius:5,border:'1px solid #ef4444',background:'transparent',color:'#ef4444',fontWeight:600,cursor:'pointer'},
          onClick:function(){_upgradeRecoveryBegin(row.role,row.token);}},row.phase==='RETRYABLE'?'Zkusit znovu':'Vrátit předchozí model'):
          h('span',{style:{fontSize:_fs(10),fontWeight:600,color:closed?'#eab308':C.tx3}},
            row.phase==='UNKNOWN'?'Neznámý výsledek':row.phase==='DISABLED'?'Akce neaktuální':'Čekám...'))),
      h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:6,lineHeight:1.4}},row.message));
  }));
}
/* End M1 operation-bound upgrade recovery. */
var _scoringData=null;var _scoringLoading=false;var _upgradeTab='overview';
var _discoveredData=null;var _discoveredLoading=false;
/* v133: Model overview + management state */
var _modelOverview=null;var _modelOverviewLoading=false;
var _deleteConfirm=null;/* {model,sizeGB} */var _deletingModel=null;
var _batchValidating=false;var _batchQueue=[];var _batchCurrent=null;
var _overviewSort={col:'name',dir:'asc'};var _roleBindings=null;
/* v135: Governor */
var _governorData=null;var _governorLoading=false;var _governorProposals=null;
/* v124: Marketplace */
var _mpData=null;var _mpLoading=false;var _mpMsg=null;var _mpTab='skills';var _mpSearch='';var _mpPage=1;var _mpInstalling={};
var _pullState={};/* model name → {status,percent,text,downloadedGB,totalGB,eta,scores} */
var _validationScores={};/* model name → { reasoning: { score, validatedAt }, code: { ... } } */
var _validatingModel=null;/* currently validating model name or null */
var _validationProgress=null;/* { suite, testName, percent, text } */
/* v91: Feature flags state — loaded from GET /api/features */
var _featureFlags=null;var _ffLoading=false;var _ffGeneration=0;var _ffLoadToken=0;
/* v91: Security state */
var _secTokens=null;var _secAudit=null;var _secAuditType='all';var _secWebhook={phase:'IDLE'};var _secSessions=null;var _secNewToken=null;var _secLoading={};
var _fbCategory='other';var _fbMessage='';var _fbSending=false;var _fbSent=false;var _fbAttachLast=false;var _fbCooldown=0;
var _fbFiles=[];var _fbAttachLogs=false;
function _loadBCfg(cb,force){
  if(_settingsMutationPending){if(cb)cb(false);return Promise.resolve(false);}
  if(_settingsDeliveryUnknown||_settingsReloadRequired){if(cb)cb(false);return Promise.resolve(false);}
  if(_bCfg&&Number.isSafeInteger(_bCfgRevision)&&_bCfgRevision>=1&&!_bCfgLoading&&force!==true){if(cb)cb(true);return Promise.resolve(true);}
  var generation=_settingsGeneration;var token=++_bCfgLoadToken;_bCfgLoading=true;
  return Promise.resolve().then(function(){return fetch(_backendBase+'/api/settings/v2',{signal:AbortSignal.timeout(3000)});}).then(function(response){return _settingsVersionedReadResponse(response);}).then(function(snapshot){
    if(token!==_bCfgLoadToken||generation!==_settingsGeneration||_settingsMutationPending)return false;
    _bCfg=snapshot.settings;_bCfgRevision=snapshot.revision;_bCfgLoading=false;if(cb)cb(true);renderCenter();return true;
  }).catch(function(){
    if(token!==_bCfgLoadToken||generation!==_settingsGeneration)return false;
    _bCfgLoading=false;if(cb)cb(false);renderCenter();return false;
  });
}
function _saveBCfg(){
  if(!_bCfg||!Number.isSafeInteger(_bCfgRevision)||_bCfgRevision<1||_settingsDeliveryUnknown||_settingsReloadRequired)return;
  clearTimeout(_bCfgSaveTimer);_bCfgSaveTimer=null;
  if(_settingsMutationPending){_settingsDeferredSave=true;return;}
  _bCfgSaveTimer=setTimeout(function(){
    _bCfgSaveTimer=null;
    if(_settingsMutationPending){_settingsDeferredSave=true;return;}
    if(_settingsDeliveryUnknown||_settingsReloadRequired)return;
    if(_bCfgSaveInFlight){_settingsDeferredSave=true;return;}
    var expectedRevision=_bCfgRevision;var generation=_settingsGeneration;
    var payload=JSON.stringify({expectedRevision:expectedRevision,patch:_bCfg});
    var request=Promise.resolve().then(function(){return fetch(_backendBase+'/api/settings/v2',{method:'PUT',headers:{'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(3000)});}).then(function(response){return _settingsVersionedMutationResponse(response,expectedRevision);}).then(function(snapshot){
      _bCfgRevision=snapshot.revision;
      if(generation===_settingsGeneration&&!_settingsMutationPending){_bCfg=snapshot.settings;renderCenter();}
      else if(!_settingsMutationPending)_settingsDeferredSave=true;
      return snapshot;
    }).catch(function(error){
      var outcome=error&&error.settingsMutationOutcome;
      if(outcome===_SETTINGS_MUTATION_RELOAD_REQUIRED){_settingsMutationState=outcome;_settingsReloadRequired=true;_settingsDeferredSave=false;_settingsResult(false,'Nastavení se mezitím změnila; před dalším uložením znovu načtěte Studio');}
      else if(outcome!==_SETTINGS_MUTATION_REJECTED){_settingsMutationState=_SETTINGS_MUTATION_DELIVERY_UNKNOWN;_settingsDeliveryUnknown=true;_settingsDeferredSave=false;_settingsResult(false,'Výsledek uložení nelze potvrdit; před další změnou znovu načtěte Studio');}
      else _settingsResult(false,'Uložení bylo odmítnuto: '+error.message);
      return null;
    });
    _bCfgSaveInFlight=request;
    request.finally(function(){
      if(_bCfgSaveInFlight===request)_bCfgSaveInFlight=null;
      if(_settingsDeferredSave&&!_settingsMutationPending&&!_settingsDeliveryUnknown&&!_settingsReloadRequired){_settingsDeferredSave=false;_saveBCfg();}
    });
  },500);
}
function _bVal(key,def){return _bCfg&&_bCfg[key]!=null?_bCfg[key]:def;}
function _bSet(key,val){
  if(_settingsMutationPending){_settingsResult(false,'Obnova nastavení právě probíhá');return;}
  if(_settingsDeliveryUnknown||_settingsReloadRequired){_settingsResult(false,'Nastavení nelze měnit, dokud Studio znovu nenačte stav serveru');return;}
  if(!_bCfg||!Number.isSafeInteger(_bCfgRevision)||_bCfgRevision<1){_settingsResult(false,'Nejprve je nutné načíst autoritativní nastavení serveru');return;}
  _settingsGeneration++;_bCfg[key]=val;_saveBCfg();renderCenter();
}
/* v91: Feature flags loader */
function _loadFeatureFlags(cb,force){
  if(_ffLoading&&force!==true)return Promise.resolve(false);
  var generation=_ffGeneration;var token=++_ffLoadToken;_ffLoading=true;
  return fetch(_backendBase+'/api/features',{signal:AbortSignal.timeout(3000)}).then(function(r){if(!r||r.ok!==true)throw new Error('FEATURE_FLAGS_READ_FAILED');return r.json();}).then(function(d){
    if(token!==_ffLoadToken||generation!==_ffGeneration)return false;
    if(!_settingsPlainObject(d)||!_settingsPlainObject(d.features))throw new Error('FEATURE_FLAGS_READ_INVALID');
    _featureFlags=d.features;if(cb)cb(true);renderCenter();return true;
  }).catch(function(){
    if(token!==_ffLoadToken||generation!==_ffGeneration)return false;
    if(cb)cb(false);renderCenter();return false;
  }).finally(function(){
    if(token===_ffLoadToken)_ffLoading=false;
  });
}
function _toggleFeatureFlag(name,enabled){fetch(_backendBase+'/api/features/'+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled}),signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){if(d.features)_featureFlags=d.features;renderCenter();}).catch(function(){});}
function _resetFeatureFlags(){fetch(_backendBase+'/api/features/reset',{method:'POST',signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){if(d.features)_featureFlags=d.features;renderCenter();}).catch(function(){});}
/* v87.3: Info icon helper — native title tooltip on (i) badge */
function _iI(text){return h('span',{style:{display:'inline-flex',alignItems:'center',justifyContent:'center',width:14,height:14,borderRadius:'50%',background:C.bg4,color:C.tx3,fontSize:'8px',fontWeight:700,cursor:'help',marginLeft:5,verticalAlign:'middle',flexShrink:0},title:text},'i');}
function _lI(text,info){return h('span',{style:{display:'inline-flex',alignItems:'center'}},text,_iI(info));}
/* v87.3: Backend config field helpers */
function _cfgInput(label,key,def,type,hint){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),type==='textarea'?h('textarea',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',resize:'vertical',lineHeight:'1.5',minHeight:60,boxSizing:'border-box'},value:v||'',onChange:function(e){_bSet(key,e.target.value);}}):h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v!=null?String(v):'',onChange:function(e){_bSet(key,type==='number'?parseFloat(e.target.value)||0:e.target.value);}}),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
function _cfgSelect(label,key,def,opts){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('select',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v,onChange:function(e){_bSet(key,e.target.value);}},opts.map(function(o){return h('option',{key:o,value:o},o);})));}
function _cfgToggle(label,desc,key,def){return _settingsToggle(label,desc,!!_bVal(key,def),function(nv){_bSet(key,nv);});}
function _cfgSlider(label,key,def,min,max,step,unit,hint,fmt){var v=_bVal(key,def);var disp=fmt?fmt(v):v+(unit||'');return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('div',{style:{display:'flex',alignItems:'center',gap:8}},h('input',{type:'range',min:min,max:max,step:step,value:v,onChange:function(e){_bSet(key,parseFloat(e.target.value));},style:{flex:1,cursor:'pointer',accentColor:C.accent}}),h('span',{style:{fontSize:_fs(11),color:C.tx3,minWidth:52,textAlign:'right',fontFamily:C.mono}},disp)),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
var _backupMsg=null;
var _SETTINGS_BACKUP_KIND='INTENTSMITH_SETTINGS_BACKUP';var _SETTINGS_BACKUP_SCHEMA_VERSION=2;
var _SETTINGS_PORTABLE_PROFILE='UX_PREFERENCES_V1';
var _SETTINGS_PORTABLE_PATHS=['/appearance/accentColor','/appearance/fontFamily','/appearance/fontSize','/appearance/theme','/c3.language','/c3.output.codeBlocks','/c3.output.markdownRendering','/c3.output.syntaxHighlight','/output/codeStyle','/output/defaultFormat','/output/namingConvention'];
var _SETTINGS_MUTATION_COMMITTED='COMMITTED';var _SETTINGS_MUTATION_REJECTED='REJECTED';var _SETTINGS_MUTATION_DELIVERY_UNKNOWN='DELIVERY_UNKNOWN';var _SETTINGS_MUTATION_RELOAD_REQUIRED='RELOAD_REQUIRED';
var _settingsResultToken=0;var _settingsMutationState='IDLE';var _settingsMutationPending=false;var _settingsDeferredSave=false;var _settingsDeliveryUnknown=false;var _settingsReloadRequired=false;
var _settingsGeneration=0;var _bCfgLoadToken=0;var _bCfgSaveInFlight=null;
var _settingsPolicyRevision=null;var _settingsResetReceipt=null;var _settingsResetLocalPhase='IDLE';var _settingsResetLocalInFlight=null;
function _settingsPlainObject(value){if(!value||typeof value!=='object'||Array.isArray(value))return false;var proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}
function _settingsRequireVersionedSnapshot(body,expectedRevision){
  if(!_settingsPlainObject(body)||Object.keys(body).sort().join(',')!=='revision,settings'||!Number.isSafeInteger(body.revision)||body.revision<1||!_settingsPlainObject(body.settings))throw new Error('neplatná verzovaná odpověď serveru');
  if(expectedRevision!==null&&body.revision!==expectedRevision+1)throw new Error('server nepotvrdil očekávanou revision');
  return body;
}
function _settingsVersionedReadResponse(response){
  if(!response||typeof response.json!=='function')return Promise.reject(new Error('neplatná HTTP odpověď'));
  return Promise.resolve().then(function(){return response.json();}).catch(function(){return null;}).then(function(body){
    if(response.ok!==true){var code=body&&typeof body.code==='string'?body.code:'HTTP_'+(response.status||'ERROR');throw new Error(code);}
    return _settingsRequireVersionedSnapshot(body,null);
  });
}
function _settingsRequirePolicySnapshot(body){
  var policy=body&&body.policy;
  if(!_settingsPlainObject(body)||Object.keys(body).sort().join(',')!=='ok,policy'||body.ok!==true
    ||!_settingsPlainObject(policy)||Object.keys(policy).sort().join(',')!=='autoCleanupDays,autoCleanupEnabled,autoFailoverEnabled,lastEventId,revision,schemaVersion,updatedAtMs'
    ||policy.schemaVersion!==1||!Number.isSafeInteger(policy.revision)||policy.revision<1
    ||typeof policy.autoFailoverEnabled!=='boolean'||typeof policy.autoCleanupEnabled!=='boolean'
    ||!Number.isSafeInteger(policy.autoCleanupDays)||policy.autoCleanupDays<1||policy.autoCleanupDays>3650
    ||typeof policy.lastEventId!=='string'||policy.lastEventId.length<16
    ||!Number.isSafeInteger(policy.updatedAtMs)||policy.updatedAtMs<0)throw new Error('neplatná model-policy odpověď serveru');
  return policy;
}
function _settingsPolicyReadResponse(response){
  if(!response||typeof response.json!=='function')return Promise.reject(new Error('neplatná HTTP odpověď'));
  return Promise.resolve().then(function(){return response.json();}).catch(function(){return null;}).then(function(body){
    if(response.ok!==true){var code=body&&typeof body.code==='string'?body.code:'HTTP_'+(response.status||'ERROR');throw new Error(code);}
    return _settingsRequirePolicySnapshot(body);
  });
}
function _settingsResponseJson(response){
  if(!response||typeof response.json!=='function')return Promise.reject(new Error('neplatná HTTP odpověď'));
  return Promise.resolve().then(function(){return response.json();}).catch(function(){return null;}).then(function(body){
    if(response.ok!==true){var code=body&&typeof body.code==='string'?body.code:'HTTP_'+(response.status||'ERROR');var path=body&&typeof body.path==='string'?' ('+body.path+')':'';throw new Error(code+path);}
    if(!_settingsPlainObject(body)||body.ok!==true)throw new Error('neplatná odpověď serveru');
    return body;
  });
}
function _settingsMutationError(outcome,message,code,status){var error=new Error(message);error.settingsMutationOutcome=outcome;if(typeof code==='string')error.settingsCode=code;if(Number.isInteger(status))error.settingsHttpStatus=status;return error;}
function _settingsVersionedMutationResponse(response,expectedRevision){
  if(!response||typeof response.json!=='function')return Promise.reject(_settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'neplatná HTTP odpověď'));
  return Promise.resolve().then(function(){return response.json();}).catch(function(){
    if(response.ok!==true)return null;
    throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'nečitelná odpověď po odeslání');
  }).then(function(body){
    if(response.ok!==true){
      var code=body&&typeof body.code==='string'?body.code:'HTTP_'+(response.status||'ERROR');
      var outcome=response.status===409&&code==='USER_SETTINGS_REVISION_CONFLICT'?_SETTINGS_MUTATION_RELOAD_REQUIRED:_SETTINGS_MUTATION_REJECTED;
      throw _settingsMutationError(outcome,code,code,response.status);
    }
    try{return _settingsRequireVersionedSnapshot(body,expectedRevision);}
    catch(error){throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,error.message);}
  });
}
function _settingsMutationResponse(response){
  if(!response||typeof response.json!=='function')return Promise.reject(_settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'neplatná HTTP odpověď'));
  return Promise.resolve().then(function(){return response.json();}).catch(function(){
    if(response.ok!==true)return null;
    throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'nečitelná odpověď po odeslání');
  }).then(function(body){
    if(response.ok!==true){var code=body&&typeof body.code==='string'?body.code:'HTTP_'+(response.status||'ERROR');var outcome=response.status===409&&(code==='USER_SETTINGS_REVISION_CONFLICT'||code==='SETTINGS_RESET_REVISION_CONFLICT')?_SETTINGS_MUTATION_RELOAD_REQUIRED:_SETTINGS_MUTATION_REJECTED;throw _settingsMutationError(outcome,code,code,response.status);}
    if(!_settingsPlainObject(body)||body.ok!==true)throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'neplatná odpověď po odeslání');
    return body;
  });
}
function _settingsPolicyValid(policy){return policy===null||(_settingsPlainObject(policy)&&Object.keys(policy).sort().join(',')==='autoCleanupDays,autoCleanupEnabled,autoFailoverEnabled'&&typeof policy.autoFailoverEnabled==='boolean'&&typeof policy.autoCleanupEnabled==='boolean'&&Number.isSafeInteger(policy.autoCleanupDays)&&policy.autoCleanupDays>=1&&policy.autoCleanupDays<=3650);}
function _settingsPortableValueValid(path,value){
  if(path==='/appearance/accentColor')return typeof value==='string'&&/^#[0-9A-Fa-f]{6}$/.test(value);
  if(path==='/appearance/fontFamily')return ['system','inter','roboto','source-code'].indexOf(value)>=0;
  if(path==='/appearance/fontSize')return Number.isSafeInteger(value)&&value>=12&&value<=20;
  if(path==='/appearance/theme')return ['dark','light','system'].indexOf(value)>=0;
  if(path==='/c3.language')return ['cs','en'].indexOf(value)>=0;
  if(path==='/c3.output.codeBlocks'||path==='/c3.output.markdownRendering'||path==='/c3.output.syntaxHighlight')return typeof value==='boolean';
  if(path==='/output/codeStyle')return ['default','airbnb','google','standard'].indexOf(value)>=0;
  if(path==='/output/defaultFormat')return ['markdown','json','csv','yaml'].indexOf(value)>=0;
  if(path==='/output/namingConvention')return ['camelCase','snake_case','kebab-case','PascalCase'].indexOf(value)>=0;
  return false;
}
function _settingsRequireBackup(value){
  if(!_settingsPlainObject(value))throw new Error('Neplatný formát zálohy');
  var projection=value.settingsProjection;var omissions=value.omissions;var policy=value.modelAutomationPolicy;
  var values=projection&&projection.values;
  var valueKeys=_settingsPlainObject(values)?Object.keys(values).sort():[];
  var valuesValid=_settingsPlainObject(values)&&valueKeys.every(function(path){return _SETTINGS_PORTABLE_PATHS.indexOf(path)>=0&&_settingsPortableValueValid(path,values[path]);});
  var projectionValid=_settingsPlainObject(projection)&&Object.keys(projection).sort().join(',')==='profile,values'&&projection.profile===_SETTINGS_PORTABLE_PROFILE&&valuesValid;
  var omissionsValid=_settingsPlainObject(omissions)&&Object.keys(omissions).sort().join(',')==='excluded,scope,sourceHadExcludedPaths,strategy'&&omissions.strategy==='DEFAULT_DENY'&&omissions.scope==='GENERAL_SETTINGS'&&omissions.excluded==='ALL_PATHS_NOT_IN_PROFILE'&&typeof omissions.sourceHadExcludedPaths==='boolean';
  if(Object.keys(value).sort().join(',')!=='kind,modelAutomationPolicy,omissions,schemaVersion,settingsProjection'||value.kind!==_SETTINGS_BACKUP_KIND||value.schemaVersion!==_SETTINGS_BACKUP_SCHEMA_VERSION||!projectionValid||!_settingsPolicyValid(policy)||!omissionsValid)throw new Error('Nepodporovaný formát zálohy');
  return value;
}
function _settingsRequireLegacyBackup(value){
  var omitted=value&&value.omittedSensitiveKeys;
  var omittedValid=Array.isArray(omitted)&&omitted.every(function(key,index){return typeof key==='string'&&(index===0||omitted[index-1]<key);});
  if(!_settingsPlainObject(value)||Object.keys(value).sort().join(',')!=='generalSettings,kind,modelAutomationPolicy,omittedSensitiveKeys,schemaVersion'||value.kind!==_SETTINGS_BACKUP_KIND||value.schemaVersion!==1||!_settingsPlainObject(value.generalSettings)||!_settingsPolicyValid(value.modelAutomationPolicy)||!omittedValid)throw new Error('Nepodporovaný legacy formát zálohy');
  return value;
}
function _settingsImportEnvelope(value){
  if(!_settingsPlainObject(value))throw new Error('Neplatný JSON soubor');
  if(value.kind===_SETTINGS_BACKUP_KIND||Object.prototype.hasOwnProperty.call(value,'schemaVersion'))return value.schemaVersion===1?_settingsRequireLegacyBackup(value):_settingsRequireBackup(value);
  return {kind:_SETTINGS_BACKUP_KIND,schemaVersion:1,generalSettings:value,modelAutomationPolicy:null,omittedSensitiveKeys:[]};
}
function _settingsPortableEntry(documentValue,path){
  if(path.indexOf('/appearance/')===0||path.indexOf('/output/')===0){var parts=path.split('/');var section=parts[1];var key=parts[2];if(!Object.prototype.hasOwnProperty.call(documentValue,section)||!_settingsPlainObject(documentValue[section])||!Object.prototype.hasOwnProperty.call(documentValue[section],key))return{found:false,value:undefined};return{found:true,value:documentValue[section][key]};}
  var flatKey=path.slice(1);return Object.prototype.hasOwnProperty.call(documentValue,flatKey)?{found:true,value:documentValue[flatKey]}:{found:false,value:undefined};
}
function _settingsExpectedPortableEntries(envelope){
  if(envelope.schemaVersion===_SETTINGS_BACKUP_SCHEMA_VERSION)return Object.keys(envelope.settingsProjection.values).sort().map(function(path){return{path:path,value:envelope.settingsProjection.values[path]};});
  var entries=[];_SETTINGS_PORTABLE_PATHS.forEach(function(path){var entry=_settingsPortableEntry(envelope.generalSettings,path);if(!entry.found)return;if(!_settingsPortableValueValid(path,entry.value))throw new Error('legacy záloha obsahuje neplatnou přenosnou předvolbu');entries.push({path:path,value:entry.value});});return entries;
}
function _settingsExpectedIgnoredSourcePathCount(envelope){
  if(envelope.schemaVersion===_SETTINGS_BACKUP_SCHEMA_VERSION)return 0;var count=0;Object.keys(envelope.generalSettings).forEach(function(key){var value=envelope.generalSettings[key];if((key==='appearance'||key==='output')&&_settingsPlainObject(value)){Object.keys(value).forEach(function(child){if(_SETTINGS_PORTABLE_PATHS.indexOf('/'+key+'/'+child)<0)count++;});}else if(_SETTINGS_PORTABLE_PATHS.indexOf('/'+key)<0)count++;});return count;
}
function _settingsExactStringList(actual,expected){return Array.isArray(actual)&&actual.length===expected.length&&actual.every(function(value,index){return typeof value==='string'&&value===expected[index];});}
function _settingsPolicyCommitValid(policy){return _settingsPlainObject(policy)&&Object.keys(policy).sort().join(',')==='autoCleanupDays,autoCleanupEnabled,autoFailoverEnabled,lastEventId,revision,updatedAtMs'&&Number.isSafeInteger(policy.revision)&&policy.revision>=1&&typeof policy.autoFailoverEnabled==='boolean'&&typeof policy.autoCleanupEnabled==='boolean'&&Number.isSafeInteger(policy.autoCleanupDays)&&policy.autoCleanupDays>=1&&policy.autoCleanupDays<=3650&&typeof policy.lastEventId==='string'&&policy.lastEventId.length>=16&&Number.isSafeInteger(policy.updatedAtMs)&&policy.updatedAtMs>=0;}
function _settingsEventValid(event,kind,source,actor){return _settingsPlainObject(event)&&Object.keys(event).sort().join(',')==='actor,eventId,eventKind,requestId,source'&&typeof event.eventId==='string'&&event.eventId.length>=16&&typeof event.requestId==='string'&&event.requestId.length>=16&&event.eventKind===kind&&event.actor===actor&&event.source===source;}
function _settingsRequireCommitBase(body,expectedKeys,eventKind,eventSource,eventActor){
  if(!_settingsPlainObject(body)||Object.keys(body).sort().join(',')!==expectedKeys||body.ok!==true||body.success!==true||!Number.isSafeInteger(body.revision)||body.revision<1||!_settingsPlainObject(body.settings)||!_settingsPolicyCommitValid(body.policy)||!_settingsEventValid(body.event,eventKind,eventSource,eventActor)||body.policy.lastEventId!==body.event.eventId||typeof body.runtimeApplied!=='boolean')throw new Error('neplatný commit serveru');
  if((body.runtimeApplied===true&&body.runtimeErrorCode!==null)||(body.runtimeApplied===false&&body.runtimeErrorCode!=='SETTINGS_RUNTIME_APPLY_FAILED'))throw new Error('nekonzistentní stav runtime');
  return body;
}
function _settingsRequireImportCommit(body,expectedEnvelope,expectedRevision){
  _settingsRequireCommitBase(body,'appliedPortablePaths,event,featuresChanged,ignoredSourcePathCount,ok,policy,preservedLocalPathCount,revision,runtimeApplied,runtimeErrorCode,settings,sourceSchemaVersion,success','BACKUP_IMPORT','SETTINGS_IMPORT','user:settings-import');
  var expectedEntries=_settingsExpectedPortableEntries(expectedEnvelope);var expectedPaths=expectedEntries.map(function(entry){return entry.path;});var expectedPolicy=expectedEnvelope.modelAutomationPolicy;var expectedIgnoredSourcePathCount=_settingsExpectedIgnoredSourcePathCount(expectedEnvelope);
  if(body.revision!==expectedRevision+1||body.sourceSchemaVersion!==expectedEnvelope.schemaVersion||!Number.isSafeInteger(body.featuresChanged)||body.featuresChanged<0||!Number.isSafeInteger(body.ignoredSourcePathCount)||body.ignoredSourcePathCount!==expectedIgnoredSourcePathCount||!Number.isSafeInteger(body.preservedLocalPathCount)||body.preservedLocalPathCount<0||!_settingsExactStringList(body.appliedPortablePaths,expectedPaths)||!expectedEntries.every(function(entry){var committed=_settingsPortableEntry(body.settings,entry.path);return committed.found&&Object.is(committed.value,entry.value);})||(expectedPolicy!==null&&(body.policy.autoFailoverEnabled!==expectedPolicy.autoFailoverEnabled||body.policy.autoCleanupEnabled!==expectedPolicy.autoCleanupEnabled||body.policy.autoCleanupDays!==expectedPolicy.autoCleanupDays)))throw new Error('neplatná metadata importu');
  return body;
}
function _settingsRequireResetCommit(body,expectedRevision,expectedPolicyRevision){_settingsRequireCommitBase(body,'event,ok,policy,revision,runtimeApplied,runtimeErrorCode,settings,success','GLOBAL_RESET','GLOBAL_RESET','user:global-reset');if(body.revision!==expectedRevision+1||body.policy.revision!==expectedPolicyRevision+1||Object.keys(body.settings).length!==0||body.policy.autoFailoverEnabled!==false||body.policy.autoCleanupEnabled!==false||body.policy.autoCleanupDays!==14)throw new Error('neplatný reset serveru');return body;}
function _settingsResult(ok,text){var token=++_settingsResultToken;_backupMsg={ok:ok,text:text};renderCenter();if(ok)setTimeout(function(){if(token!==_settingsResultToken)return;_backupMsg=null;renderCenter();},4000);}
function _settingsBeginMutation(){
  if(_settingsMutationPending){_settingsResult(false,'Jiná obnova nastavení právě probíhá');return null;}
  if(_settingsDeliveryUnknown){_settingsResult(false,'Nejprve je nutné znovu načíst autoritativní stav serveru');return null;}
  if(_settingsReloadRequired){_settingsResult(false,'Nastavení se na serveru změnila; nejprve znovu načtěte Studio');return null;}
  if(!_bCfg||!Number.isSafeInteger(_bCfgRevision)||_bCfgRevision<1){_settingsResult(false,'Nejprve je nutné načíst autoritativní nastavení serveru');return null;}
  _settingsMutationState='PENDING';_settingsMutationPending=true;_settingsGeneration++;_bCfgLoadToken++;_bCfgLoading=false;
  if(_bCfgSaveTimer!==null){clearTimeout(_bCfgSaveTimer);_bCfgSaveTimer=null;_settingsDeferredSave=true;}
  return _bCfgSaveInFlight?Promise.resolve(_bCfgSaveInFlight):Promise.resolve();
}
function _settingsEndMutation(outcome){
  _settingsMutationState=outcome;_settingsMutationPending=false;
  if(outcome===_SETTINGS_MUTATION_COMMITTED){_settingsDeliveryUnknown=false;_settingsDeferredSave=false;return;}
  if(outcome===_SETTINGS_MUTATION_DELIVERY_UNKNOWN){
    _settingsDeliveryUnknown=true;_settingsDeferredSave=false;renderCenter();return;
  }
  if(outcome===_SETTINGS_MUTATION_RELOAD_REQUIRED){
    _settingsReloadRequired=true;_settingsDeferredSave=false;renderCenter();return;
  }
  if(outcome===_SETTINGS_MUTATION_REJECTED&&_settingsDeferredSave&&!_settingsDeliveryUnknown&&!_settingsReloadRequired){_settingsDeferredSave=false;_saveBCfg();}
}
function _settingsExportBackup(){
  return fetch(_backendBase+'/api/settings/backup',{signal:AbortSignal.timeout(3000)}).then(function(r){return _settingsResponseJson(r);}).then(function(body){
    var backup=_settingsRequireBackup(body.backup);var blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    var a=document.createElement('a');var objectUrl=URL.createObjectURL(blob);a.href=objectUrl;a.download='intentsmith-settings-'+new Date().toISOString().slice(0,10)+'.json';try{a.click();}finally{URL.revokeObjectURL(objectUrl);}
    _settingsResult(true,'Přenosná záloha předvoleb vytvořena; lokální a citlivé hodnoty zůstaly v této instalaci');return body;
  }).catch(function(error){_settingsResult(false,'Export selhal: '+error.message);return null;});
}
function _settingsImportDocument(value,fileName){
  var envelope;try{envelope=_settingsImportEnvelope(value);}catch(error){_settingsResult(false,error.message);return Promise.resolve(null);}
  var ready=_settingsBeginMutation();if(!ready)return Promise.resolve(null);var outcome=_SETTINGS_MUTATION_DELIVERY_UNKNOWN;var expectedRevision=null;
  return ready.then(function(){
    if(_settingsDeliveryUnknown)throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'předchozí uložení nemá potvrzený výsledek');
    if(_settingsReloadRequired)throw _settingsMutationError(_SETTINGS_MUTATION_RELOAD_REQUIRED,'nastavení vyžaduje reload');
    if(!_bCfg||!Number.isSafeInteger(_bCfgRevision)||_bCfgRevision<1)throw _settingsMutationError(_SETTINGS_MUTATION_RELOAD_REQUIRED,'chybí autoritativní revision');
    expectedRevision=_bCfgRevision;
    return fetch(_backendBase+'/api/settings/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup:envelope,expectedRevision:expectedRevision}),signal:AbortSignal.timeout(3000)});
  }).then(function(r){return _settingsMutationResponse(r);}).then(function(body){
    _settingsRequireImportCommit(body,envelope,expectedRevision);outcome=_SETTINGS_MUTATION_COMMITTED;
    _bCfg=body.settings;_bCfgRevision=body.revision;
    var ignoredNotice=body.ignoredSourcePathCount>0?'; '+body.ignoredSourcePathCount+' nepřenosných zdrojových cest bylo ignorováno':'';
    _settingsResult(true,(body.runtimeApplied===false?'Předvolby uloženy z '+fileName+'; runtime vyžaduje restart':'Předvolby importovány z '+fileName)+ignoredNotice);
    return body;
  }).catch(function(error){
    outcome=error&&error.settingsMutationOutcome===_SETTINGS_MUTATION_REJECTED?_SETTINGS_MUTATION_REJECTED:error&&error.settingsMutationOutcome===_SETTINGS_MUTATION_RELOAD_REQUIRED?_SETTINGS_MUTATION_RELOAD_REQUIRED:_SETTINGS_MUTATION_DELIVERY_UNKNOWN;
    _settingsResult(false,outcome===_SETTINGS_MUTATION_DELIVERY_UNKNOWN?'Výsledek importu nelze potvrdit; další ukládání je do obnovení Studia zablokováno':outcome===_SETTINGS_MUTATION_RELOAD_REQUIRED?'Import narazil na novější nastavení; znovu načtěte Studio':'Import byl odmítnut: '+error.message);return null;
  }).finally(function(){_settingsEndMutation(outcome);});
}
function _settingsCompleteResetReceipt(){
  if(!_settingsResetReceipt)return Promise.resolve(false);
  if(_settingsResetLocalInFlight)return _settingsResetLocalInFlight;
  var receipt=_settingsResetReceipt;_settingsResetLocalPhase='APPLYING';
  _ffGeneration++;_ffLoadToken++;_ffLoading=false;_featureFlags=null;
  var operation=_loadFeatureFlags(null,true).then(function(applied){
    if(receipt!==_settingsResetReceipt)return false;
    if(!applied){
      _settingsResetLocalPhase='DEGRADED';
      _settingsResult(false,'Reset serverových nastavení je commitnutý, ale feature flags se nepodařilo načíst. Opakování provede jen lokální reload.');
      return false;
    }
    _settingsResetLocalPhase='COMPLETE';
    _settingsResult(true,receipt.runtimeApplied===false?'Serverová nastavení resetována; runtime vyžaduje restart':'Serverová nastavení obnovena na výchozí');
    return true;
  }).catch(function(){
    if(receipt===_settingsResetReceipt){
      _settingsResetLocalPhase='DEGRADED';
      _settingsResult(false,'Reset serverových nastavení je commitnutý, ale lokální reload selhal. Opakování neodešle nový reset.');
    }
    return false;
  });
  _settingsResetLocalInFlight=operation;
  operation.finally(function(){if(_settingsResetLocalInFlight===operation)_settingsResetLocalInFlight=null;});
  return operation;
}
function _settingsResetAll(){
  if(_settingsResetReceipt&&_settingsResetLocalPhase==='DEGRADED')return _settingsCompleteResetReceipt().then(function(){return _settingsResetReceipt;});
  var ready=_settingsBeginMutation();if(!ready)return Promise.resolve(null);
  var outcome=_SETTINGS_MUTATION_DELIVERY_UNKNOWN;var expectedRevision=null;var expectedPolicyRevision=null;var postStarted=false;
  return ready.then(function(){
    if(_settingsDeliveryUnknown)throw _settingsMutationError(_SETTINGS_MUTATION_DELIVERY_UNKNOWN,'předchozí uložení nemá potvrzený výsledek');
    if(_settingsReloadRequired)throw _settingsMutationError(_SETTINGS_MUTATION_RELOAD_REQUIRED,'nastavení vyžaduje reload');
    return fetch(_backendBase+'/api/settings/v2',{signal:AbortSignal.timeout(3000)});
  }).then(function(response){return _settingsVersionedReadResponse(response);}).then(function(snapshot){
    expectedRevision=snapshot.revision;
    return fetch(_backendBase+'/api/system/models/settings',{signal:AbortSignal.timeout(3000)});
  }).then(function(response){return _settingsPolicyReadResponse(response);}).then(function(policy){
    expectedPolicyRevision=policy.revision;postStarted=true;
    return fetch(_backendBase+'/api/settings/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'SERVER_SETTINGS_V1',expectedRevision:expectedRevision,expectedPolicyRevision:expectedPolicyRevision}),signal:AbortSignal.timeout(3000)});
  }).then(function(r){return _settingsMutationResponse(r);}).then(function(body){
    _settingsRequireResetCommit(body,expectedRevision,expectedPolicyRevision);outcome=_SETTINGS_MUTATION_COMMITTED;
    _settingsResetReceipt=body;_settingsResetLocalPhase='RECEIPT';
    _bCfg=body.settings;_bCfgRevision=body.revision;_settingsPolicyRevision=body.policy.revision;
    return _settingsCompleteResetReceipt().then(function(){return body;});
  }).catch(function(error){
    if(!postStarted)outcome=_SETTINGS_MUTATION_REJECTED;
    else outcome=error&&error.settingsMutationOutcome===_SETTINGS_MUTATION_REJECTED?_SETTINGS_MUTATION_REJECTED:error&&error.settingsMutationOutcome===_SETTINGS_MUTATION_RELOAD_REQUIRED?_SETTINGS_MUTATION_RELOAD_REQUIRED:_SETTINGS_MUTATION_DELIVERY_UNKNOWN;
    _settingsResult(false,outcome===_SETTINGS_MUTATION_DELIVERY_UNKNOWN?'Výsledek resetu nelze potvrdit; další ukládání je do obnovení Studia zablokováno':outcome===_SETTINGS_MUTATION_RELOAD_REQUIRED?'Reset vyžaduje nový autoritativní stav; znovu načtěte Studio':'Reset nebyl proveden: '+error.message);return null;
  }).finally(function(){_settingsEndMutation(outcome);});
}
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
  var _ctm=localStorage.getItem('c3-theme-mode');var p=(_ctm&&_ctm!=='clean'&&_C_THEMES[_ctm])?_mkPalette(_C_THEMES[_ctm].accent):_getPalette();var ai=(_settingsVals.activeInt||100)/100;var pi=(_settingsVals.passiveInt!=null?_settingsVals.passiveInt:50)/100;
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
  _fsScale=fs/13;
  var ff=_fontFamilies[_settingsVals.fontIdx]||_fontFamilies[0];
  C.font=ff.val;
  document.documentElement.style.setProperty('--c3-font-size',fs+'px');
  document.documentElement.style.setProperty('--c3-font-family',ff.val);
  document.documentElement.style.setProperty('--c3-mono',C.mono);
  document.body.style.fontFamily=ff.val;
  ['c3-center-mount','c3-sidebar','c3-chat-panel','c3-agent-panel'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.style.zoom='';el.style.fontFamily=ff.val;}});
  var sid='c3-font-override';var ex=document.getElementById(sid);
  if(!ex){ex=document.createElement('style');ex.id=sid;document.head.appendChild(ex);}
  var css='#c3-center-mount span,#c3-center-mount div,#c3-center-mount p,#c3-center-mount button,'+
    '#c3-center-mount label,#c3-center-mount h3,#c3-center-mount h4,'+
    '#c3-sidebar span,#c3-sidebar div,#c3-sidebar button,'+
    '#c3-chat-panel span,#c3-chat-panel div,#c3-chat-panel textarea,#c3-chat-panel input,'+
    '#c3-agent-panel span,#c3-agent-panel div{font-family:'+ff.val+';}\n'+
    '.codicon,.codicon *{font-family:"codicon"!important;}\n';
  if(fs!==13){css+='#c3-chat-panel .c3-chat-msg-text{font-size:'+fs+'px!important;}';}
  ex.textContent=css;
}
function _applyAllSettings(){_applyTheme();var _ctm=localStorage.getItem('c3-theme-mode');if(_ctm&&_ctm!=='clean'){_applyColorTheme(_ctm);}_applyAccent();_injectProThemeCSS(_ctm||'clean');_applyFont();_injectCustomCSS(_settingsVals.customCSS);renderCenter();renderChat();renderAgent();if(typeof renderSidebar==='function')renderSidebar();}
/* Apply saved settings on load */
_applyTheme();_applyAccent();setTimeout(function(){_applyFont();_injectCustomCSS(_settingsVals.customCSS);_applyAllSettings();},600);
/* Restore Pro theme from localStorage */
try{var _tm=localStorage.getItem('c3-theme-mode');if(_tm&&_tm!=='clean'){document.body.classList.add('theme-pro-'+_tm);_applyColorTheme(_tm);_injectProThemeCSS(_tm);}}catch(e){}

function centerSettings(){
  var selSi=_centerState.settingsSection;
  var selSec=selSi!=null?SETTINGS_SECTIONS[selSi]:null;
  var isLines=_settingsVals.visualMode==='lines';
  if(!_bCfg&&!_bCfgLoading)_loadBCfg();
  return h(React.Fragment,null,viewHead('Nastavení',true),
    h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
      h('div',{style:{flex:1,overflowY:'auto',padding:18}},
        grid(SETTINGS_SECTIONS.map(function(sec,si){
          var isSel=selSi===si;
          var descText=sec.title==='About'?'v'+(_serverHealth.version||'...'):sec.desc||'';
          var ell={whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
          var _onClick=function(){_centerState.settingsSection=si;_centerState.detail=null;renderCenter();};
          /* ═══ LIST VIEW — compact horizontal row (matches card() list layout) ═══ */
          if(_centerState.listView){
            var listS={display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background 0.15s',position:'relative'};
            if(isLines){listS.borderBottom='1px solid '+C.border;listS.background=isSel?'rgba(34,197,94,0.05)':'transparent';}
            else{listS.background=isSel?'rgba(34,197,94,0.06)':C.bg2;listS.border='1px solid '+(isSel?C.accent:C.border);listS.borderRadius=8;listS.marginBottom=4;}
            return h('div',{key:si,onClick:_onClick,style:listS,
              onMouseEnter:function(e){if(!isSel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':'rgba(255,255,255,0.04)';},
              onMouseLeave:function(e){if(!isSel)e.currentTarget.style.background=isLines?'transparent':(isSel?'rgba(34,197,94,0.06)':C.bg2);}},
              isLines&&isSel?h('div',{style:{position:'absolute',left:0,top:0,bottom:0,width:3,background:C.accent,borderRadius:'0 2px 2px 0'}}):null,
              h('span',{style:{fontSize:_fs(16),flexShrink:0,width:24,textAlign:'center'}},sec.icon),
              h('div',{style:Object.assign({fontSize:_fs(12),fontWeight:600,color:isSel?C.accentText:C.tx1,width:130,flexShrink:0},ell)},sec.title),
              h('div',{style:Object.assign({flex:1,fontSize:_fs(11),color:C.tx3,minWidth:0},ell)},descText));
          }
          /* ═══ GRID — same as before ═══ */
          var sty=isLines
            ?{padding:14,cursor:'pointer',borderBottom:'1px solid '+C.border,borderRight:'1px solid '+C.border,
              background:isSel?'rgba(34,197,94,0.05)':'transparent',transition:'background 0.15s'}
            :{background:C.bg2,border:'1px solid '+(isSel?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer',transition:'border-color 0.15s',position:'relative',overflow:'hidden'};
          return h('div',{key:si,className:'c3-card',onClick:_onClick,style:sty,
            onMouseEnter:function(e){if(!isSel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':e.currentTarget.style.background;if(!isSel&&!isLines)e.currentTarget.style.borderColor=C.border2;},
            onMouseLeave:function(e){if(!isSel){e.currentTarget.style.background=isLines?'transparent':C.bg2;if(!isLines)e.currentTarget.style.borderColor=C.border;}}},
            !isLines?h('div',{style:{position:'absolute',top:0,left:0,right:0,height:3,background:isSel?C.accent:'transparent'}}):null,
            h('div',{style:{fontSize:_fs(24),marginBottom:8}},sec.icon),
            h('div',{style:{fontSize:_fs(13),fontWeight:700,color:isSel?C.accentText:C.tx1,marginBottom:2}},sec.title),
            h('div',{style:{fontSize:_fs(11),color:C.tx3}},descText));
        }))),
      selSec?settingsDetailPanel(selSec,selSi):null));
}

function settingsDetailPanel(sec,si){
  var panelBody=null;
  switch(sec.title){
    case 'Account':panelBody=settingsAccount();break;
    case 'LLM':panelBody=settingsLLM();break;
    case 'Memory':panelBody=settingsMemory();break;
    case 'Notifications':panelBody=settingsNotif();break;
    case 'Output':panelBody=settingsOutput();break;
    case 'Appearance':panelBody=settingsAppearance();break;
    case 'System':panelBody=settingsSystemPanel();break;
    case 'Storage':panelBody=settingsStoragePanel();break;
    case 'Backup':panelBody=settingsBackupPanel();break;
    case 'Feature Flags':panelBody=settingsFeatureFlags();break;
    case 'Security':panelBody=settingsSecurityPanel();break;
    case 'About':panelBody=settingsAboutPanel();break;
    default:panelBody=h('div',{style:{padding:12,color:C.tx3}},'Žádná nastavení.');
  }
  return h('div',{style:{width:320,background:C.bg1,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}},
    h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},
      h('span',{style:{fontSize:_fs(16)}},sec.icon),
      h('span',{style:{fontSize:_fs(13.5),fontWeight:700,flex:1,color:C.tx1}},sec.title),
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:2,borderRadius:4,display:'flex'},
        onClick:function(){_centerState.settingsSection=null;renderCenter();}},svgEl(I.close,15))),
    h('div',{style:{flex:1,overflowY:'auto',padding:'12px 14px'}},panelBody));
}

function _settingsToggle(label,desc,val,onChange){
  return h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid '+C.border,marginBottom:4}},
    h('div',{style:{flex:1}},
      h('div',{style:{fontSize:_fs(12),color:C.tx1,fontWeight:500}},label),
      desc?h('div',{style:{fontSize:_fs(10),color:C.tx4,marginTop:2}},desc):null),
    h('div',{onClick:function(){onChange(!val);},style:{width:36,height:20,borderRadius:10,background:val?C.accent:C.bg4,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}},
      h('div',{style:{width:16,height:16,borderRadius:'50%',background:'#fff',position:'absolute',top:2,left:val?18:2,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}})));
}
function settingsAppearance(){
  var sv=_settingsVals;
  function _sl(val,min,max,step,onChange,unit){
    return h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('input',{type:'range',min:min,max:max,step:step,value:val,onChange:function(e){onChange(parseFloat(e.target.value));},
        style:{flex:1,cursor:'pointer'}}),
      h('span',{style:{fontSize:_fs(11),color:C.tx3,minWidth:36,textAlign:'right',fontFamily:C.mono}},val+unit));
  }
  function _cpDot(bg,sel,onClick,key){
    return h('div',{key:key,onClick:onClick,
      style:{width:24,height:24,borderRadius:'50%',background:bg,cursor:'pointer',border:sel?'3px solid '+C.tx1:'3px solid transparent',boxSizing:'border-box',boxShadow:bg==='#ffffff'?'inset 0 0 0 1px rgba(0,0,0,0.15)':'none'}});
  }
  function _cpCustom(id,val,sel,onChange){
    return h('div',{key:id,style:{position:'relative'}},
      h('div',{onClick:function(){document.getElementById(id).click();},
        style:{width:24,height:24,borderRadius:'50%',background:val||'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)',cursor:'pointer',border:sel?'3px solid '+C.tx1:'3px solid transparent',boxSizing:'border-box'}},
        val?null:h('span',{style:{fontSize:_fs(9),color:'#fff',textShadow:'0 0 2px #000',display:'flex',width:'100%',height:'100%',alignItems:'center',justifyContent:'center'}},'+')),
      h('input',{id:id,type:'color',value:val||'#ff6b6b',style:{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'},onChange:function(e){onChange(e.target.value);}}));
  }
  return h('div',null,
    /* Theme */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Téma'),
    h('div',{style:{display:'flex',gap:6,marginBottom:16}},_themeOpts.map(function(t){
      var sel=sv.theme===t.id;
      return h('div',{key:t.id,onClick:function(){sv.theme=t.id;_saveSV();_applyAllSettings();},
        style:{flex:1,padding:'10px 6px',borderRadius:8,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',textAlign:'center'}},
        h('div',{style:{fontSize:_fs(18),marginBottom:4}},t.icon),
        h('div',{style:{fontSize:_fs(11),color:sel?C.accentText:C.tx2,fontWeight:sel?700:400}},t.label));})),
    /* Accent */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Accent'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
      _accentPalettes.map(function(p,i){return _cpDot(p.accent,sv.accentIdx===i,function(){sv.accentIdx=i;_saveSV();_applyAllSettings();},i);}),
      _cpCustom('c3-cp1',sv.custom1,sv.accentIdx===100,function(v){sv.custom1=v;sv.accentIdx=100;_saveSV();_applyAllSettings();}),
      _cpCustom('c3-cp2',sv.custom2,sv.accentIdx===101,function(v){sv.custom2=v;sv.accentIdx=101;_saveSV();_applyAllSettings();})),
    /* Background */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Pozadí'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
      _bgPresets.slice(0,3).map(function(bp,i){return _cpDot(bp.bg,sv.bgIdx===i,function(){sv.bgIdx=i;_saveSV();_applyAllSettings();},('bg'+i));}),
      _cpCustom('c3-bgc1',sv.bgCustom1,sv.bgIdx===3,function(v){sv.bgCustom1=v;sv.bgIdx=3;_saveSV();_applyAllSettings();}),
      _cpCustom('c3-bgc2',sv.bgCustom2,sv.bgIdx===4,function(v){sv.bgCustom2=v;sv.bgIdx=4;_saveSV();_applyAllSettings();})),
    /* Intensity sliders */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8}},'Intenzita podsvícení'),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Aktivní prvky')),
    h('div',{style:{marginBottom:10}},_sl(sv.activeInt,10,100,5,function(v){sv.activeInt=v;_saveSV();_applyAllSettings();},'%')),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Neaktivní prvky')),
    h('div',{style:{marginBottom:16}},_sl(sv.passiveInt,0,100,5,function(v){sv.passiveInt=v;_saveSV();_applyAllSettings();},'%')),
    /* Pro theme glass sliders (only visible for pro themes) */
    (function(){var _ctm=localStorage.getItem('c3-theme-mode');if(!_ctm||_ctm==='clean')return null;return h(React.Fragment,null,
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8,marginTop:4}},'Průhlednost'),
      h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Dlaždice')),
      h('div',{style:{marginBottom:10}},_sl(sv.tileOpacity,0,100,5,function(v){sv.tileOpacity=v;_saveSV();_applyAllSettings();},'%')),
      h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Ztlumení pozadí')),
      h('div',{style:{marginBottom:10}},_sl(sv.bgDim,0,80,5,function(v){sv.bgDim=v;_saveSV();_applyAllSettings();},'%')),
      h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Panely')),
      h('div',{style:{marginBottom:16}},_sl(sv.sidebarOpacity,10,100,5,function(v){sv.sidebarOpacity=v;_saveSV();_applyAllSettings();},'%')));})(),
    /* Font size slider */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Velikost písma'),
    h('div',{style:{marginBottom:16}},_sl(sv.fontSizeVal,10,18,1,function(v){sv.fontSizeVal=v;_saveSV();_applyAllSettings();},'px')),
    /* Font family */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Písmo'),
    h('div',{style:{display:'flex',flexDirection:'column',gap:4}},_fontFamilies.map(function(ff,i){
      var sel=sv.fontIdx===i;
      return h('div',{key:i,onClick:function(){sv.fontIdx=i;_saveSV();_applyAllSettings();},
        style:{padding:'8px 10px',borderRadius:8,border:'2px solid '+(sel?C.accent:C.border),background:sel?C.accentBg:C.bg3,cursor:'pointer',display:'flex',alignItems:'center',gap:8}},
        h('div',{style:{width:16,height:16,borderRadius:'50%',border:'2px solid '+(sel?C.accent:C.border2),background:sel?C.accent:'transparent',flexShrink:0}}),
        h('span',{style:{fontSize:_fs(12),fontFamily:ff.val,color:sel?C.accentText:C.tx2}},ff.label));})),
    /* Auto-collapse toggle */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8,marginTop:16}},'Automatické skrývání panelů'),
    h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:16,cursor:'pointer'},
      onClick:function(){sv.autoCollapse=!sv.autoCollapse;_saveSV();renderCenter();}},
      h('div',{style:{width:36,height:20,borderRadius:10,background:sv.autoCollapse?C.accent:C.bg4,transition:'background 0.2s',position:'relative',flexShrink:0}},
        h('div',{style:{width:16,height:16,borderRadius:'50%',background:'#fff',position:'absolute',top:2,left:sv.autoCollapse?18:2,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}})),
      h('div',null,
        h('div',{style:{fontSize:_fs(12),color:sv.autoCollapse?C.tx1:C.tx3,fontWeight:500}},sv.autoCollapse?'Zapnuto':'Vypnuto'),
        h('div',{style:{fontSize:_fs(10),color:C.tx4}},'Panely se automaticky skryjí při zúžení pod limit'))),
    /* Visual mode picker — global: borders vs lines */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8,marginTop:16}},'Vizuální režim'),
    h('div',{style:{display:'flex',gap:6,marginBottom:12}},
      [{id:'borders',label:'Rámečky',desc:'Karty, bubliny, tlačítka s rámečkem'},{id:'lines',label:'Linky',desc:'Tenké separátory, bez rámečků'}].map(function(vm){
        var isSel=sv.visualMode===vm.id;
        return h('div',{key:vm.id,style:{flex:1,padding:'10px 8px',borderRadius:8,border:'2px solid '+(isSel?C.accent:C.border),background:isSel?C.accentBg:C.bg3,cursor:'pointer',textAlign:'center'},
          onClick:function(){sv.visualMode=vm.id;_saveSV();_applyAllSettings();}},
          h('div',{style:{fontSize:_fs(12),fontWeight:isSel?700:400,color:isSel?C.accentText:C.tx2,marginBottom:2}},vm.label),
          h('div',{style:{fontSize:_fs(9),color:C.tx4}},vm.desc));
      })),
    /* Pro Theme Styles (5 variants) */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8,marginTop:16}},'Režim efektů'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}},
      [{id:'clean',label:'Clean',desc:'Základní styl',clr:C.tx3},
       {id:'matrix',label:'Matrix',desc:'Neon terminal',clr:'#00ff6a'},
       {id:'japanese',label:'Japanese',desc:'Červená aurora',clr:'#f87171'},
       {id:'midnight',label:'Midnight',desc:'Vesmírné sklo',clr:'#93c5fd'}
      ].map(function(pm){
        var current=localStorage.getItem('c3-theme-mode')||'clean';
        var isSel=current===pm.id;
        return h('div',{key:pm.id,style:{flex:'0 0 calc(50% - 3px)',padding:'8px 6px',borderRadius:8,border:'2px solid '+(isSel?pm.clr:'rgba(255,255,255,0.08)'),background:isSel?'rgba(255,255,255,0.05)':C.bg3,cursor:'pointer',textAlign:'center',transition:'all 0.2s ease'},
          onClick:function(){
            document.body.className=document.body.className.replace(/\btheme-pro[\w-]*/g,'').trim();
            if(pm.id!=='clean'){document.body.classList.add('theme-pro-'+pm.id);}
            localStorage.setItem('c3-theme-mode',pm.id);
            if(pm.id==='clean'){Object.keys(_C_DEFAULT).forEach(function(k){C[k]=_C_DEFAULT[k];});}
            else{_applyColorTheme(pm.id);}
            _applyAllSettings();
          }},
          h('div',{style:{fontSize:_fs(11),fontWeight:isSel?700:500,color:isSel?pm.clr:C.tx2,marginBottom:1}},pm.label),
          h('div',{style:{fontSize:_fs(8),color:C.tx4}},pm.desc));
      })),
    /* I2: Custom CSS */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,marginTop:16}},'Vlastní CSS'),
    h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:6}},'Scope: .c3-root — globální selektory nejsou podporované'),
    h('textarea',{value:sv.customCSS||'',
      onChange:function(e){sv.customCSS=e.target.value;_injectCustomCSS(e.target.value);_saveSV();},
      style:{width:'100%',height:80,fontFamily:C.mono,fontSize:_fs(11),background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',outline:'none',resize:'vertical',lineHeight:'1.4',boxSizing:'border-box'},
      placeholder:'.c3-card { border-radius: 12px; }'}));
}

/* ═══════════════════════════════════════════════════════════
   v87.4: SETTINGS SECTION RENDERERS
   ═══════════════════════════════════════════════════════════ */
function settingsAccount(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _cfgInput('Zobrazované jméno','c3.account.displayName','','input','Jak vás C3 oslovuje v konverzaci'),
    _cfgInput('Popis / Bio','c3.account.description','','textarea','Kontext pro personalizaci odpovědí — např. role, zkušenosti, preference'),
    _cfgSelect('Jazyk UI','c3.language','cs',['cs','en']),
    h('div',{style:{marginBottom:12}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Složka projektů'),
      h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.mono,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},
        value:_settingsVals.projectsDir||'',placeholder:'/home/user/Projects',
        onChange:function(e){_settingsVals.projectsDir=e.target.value;_saveSV();renderCenter();}}),
      h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},'Výchozí složka pro nové projekty')));
}
function settingsLLM(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_gpuInfo){fetch(_backendBase+'/api/system/gpu',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(d){_gpuInfo=d;renderCenter();}).catch(function(){_gpuInfo={error:true};});}
  if(!_ollamaModels){fetch(_backendBase+'/api/system/models',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(d){_ollamaModels=d.models||d||[];renderCenter();}).catch(function(){_ollamaModels=[];});}
  var models=[...new Set((_ollamaModels||[]).map(function(m){return typeof m==='string'?m:m.name||m.model||'';}).filter(Boolean))];
  if(models.length===0)models=['qwen3.5:27b','llava:13b','llama3.1:70b','mistral:7b'];
  var gpus=_gpuInfo&&_gpuInfo.profile?_gpuInfo.profile.gpus:(_gpuInfo&&_gpuInfo.gpus?_gpuInfo.gpus:null);
  var rec=_gpuInfo&&_gpuInfo.recommendation?_gpuInfo.recommendation:null;
  return h('div',null,
    gpus?h('div',{style:{background:'linear-gradient(135deg,rgba(34,197,94,0.08),rgba(22,163,74,0.04))',border:'1px solid rgba(34,197,94,0.2)',borderRadius:8,padding:12,marginBottom:14}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.accent,marginBottom:6}},'GPU'),
      gpus.map(function(g,i){
        var name=g.gpu_model||g.name||'CPU-only';
        var vram=g.vram_mb||g.vram||0;
        return h('div',{key:i,style:{fontSize:_fs(11),color:C.tx2,marginBottom:2}},
          h('span',{style:{fontWeight:600}},name),
          vram?h('span',{style:{color:C.tx3}},' — '+vram+' MB VRAM'):'',
          g.driver?h('span',{style:{color:C.tx4,fontSize:_fs(9)}},' ('+g.driver+(g.cuda_version?' / CUDA '+g.cuda_version:'')+')'):null);
      }),
      rec&&rec.recommended_model?h('div',{style:{fontSize:_fs(9),color:C.accent,marginTop:6}},'Doporučený model: '+rec.recommended_model):null):null,
    /* v133: Compact 7-role bindings summary (replaces 3 broken dropdowns) */
    (function(){
      if(!_roleBindings){
        fetch(_backendBase+'/api/system/upgrades/bindings',{signal:AbortSignal.timeout(5000)})
          .then(function(r){return r.json();})
          .then(function(d){_roleBindings=d.bindings||{};renderCenter();})
          .catch(function(){});
        return h('div',{style:{color:C.tx4,fontSize:_fs(10),padding:'8px 0'}},'Na\u010D\u00EDt\u00E1m role...');
      }
      var rp={D1:{name:'Hlubok\u00E1 anal\u00FDza',color:'#8b5cf6'},D2:{name:'Anal\u00FDza oprav',color:'#a78bfa'},
        CODE:{name:'Generov\u00E1n\u00ED k\u00F3du',color:'#22c55e'},R1:{name:'Hlubok\u00E1 revize',color:'#6366f1'},
        R2:{name:'Rychl\u00E1 revize',color:'#818cf8'},CHAT:{name:'Konverzace',color:'#3b82f6'},VISION:{name:'Anal\u00FDza obr\u00E1zk\u016F',color:'#f59e0b'}};
      var roles=Object.keys(rp);
      return h('div',{style:{marginBottom:12}},
        h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx2,marginBottom:8}},
          'P\u0159i\u0159azen\u00ED model\u016F'),
        h('div',{style:{display:'flex',flexDirection:'column',gap:4}},
          roles.map(function(r){
            var m=_roleBindings[r]||'?';
            var vs=_validationScores[m];
            var scoreText='\u2014';var scoreColor=C.tx4;
            if(vs){var vals=Object.values(vs).filter(function(v){return v&&v.score!=null;});
              if(vals.length>0){var avg=vals.reduce(function(a,b){return a+b.score;},0)/vals.length;
                scoreText=Math.round(avg*100)+'%';scoreColor=avg>=0.7?C.accent:avg>=0.4?'#eab308':'#ef4444';}}
            var installed=models.indexOf(m)>=0;
            return h('div',{key:r,style:{display:'flex',alignItems:'center',gap:8,padding:'4px 8px',borderRadius:6,background:C.bg2}},
              h('span',{style:{fontWeight:700,fontSize:_fs(10),color:rp[r].color,minWidth:48}},r),
              h('span',{style:{fontSize:_fs(10),color:C.tx3,minWidth:100,flex:'0 0 auto'}},rp[r].name),
              h('span',{style:{flex:1,fontSize:_fs(10),color:installed?C.tx1:'#ef4444',fontFamily:C.mono}},m,
                !installed?h('span',{style:{color:'#ef4444',fontSize:_fs(9),marginLeft:4}},'\u26A0'):null),
              h('span',{style:{fontSize:_fs(10),fontWeight:600,color:scoreColor,minWidth:36,textAlign:'right'}},scoreText));
          })),
        h('button',{style:{width:'100%',marginTop:10,background:'linear-gradient(135deg,rgba(34,197,94,0.12),rgba(22,163,74,0.06))',
          border:'1px solid rgba(34,197,94,0.3)',borderRadius:8,padding:'10px 14px',color:C.accent,fontSize:_fs(12),fontWeight:600,
          cursor:'pointer',fontFamily:C.font,display:'flex',alignItems:'center',gap:8,justifyContent:'center'},
          onClick:function(){_centerState.view='upgrades';_upgradeTab='overview';_centerState.settingsSection=null;renderCenter();}},
          svgEl('<path d="M12 5v14M5 12l7-7 7 7"/>',16),'Spravovat role a modely'));
    })(),
    _cfgInput('Ollama URL','c3.llm.ollamaUrl','http://127.0.0.1:11434','input','Adresa lok\u00E1ln\u00EDho Ollama serveru'),
    _cfgSlider(_lI('Temperature','Nízká = deterministické, konzistentní odpovědi. Vysoká = kreativnější, rozmanitější výstupy.'),'c3.llm.temperature',0.7,0,2,0.1,''),
    _cfgSlider(_lI('Context window','Kolik tokenů si model pamatuje v rámci jedné konverzace. Větší okno = více kontextu, ale vyšší nároky na paměť.'),'c3.llm.contextWindow',32768,2048,131072,1024,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':'v tok';}),
    _cfgSlider(_lI('Timeout chat','Maximální doba čekání na odpověď chat modelu. Zvyšte při pomalých odpovědích.'),'c3.llm.timeoutChat',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('Timeout code','Maximální doba čekání na odpověď code modelu.'),'c3.llm.timeoutCode',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('GPU layers','Kolik vrstev modelu se načte do GPU. -1 = automaticky dle dostupné VRAM. 0 = vše na CPU.'),'c3.llm.numGpu',-1,-1,8,1,''),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'14px 0'}}));
}
/* ═══════════════════════════════════════════════════════════
   v120.2: MODEL UPGRADE PROPOSALS — full center panel
   ═══════════════════════════════════════════════════════════ */
function _loadUpgradeData(){
  if(_upgradeLoading)return;_upgradeLoading=true;
  fetch(_backendBase+'/api/system/upgrades',{signal:AbortSignal.timeout(8000)})
    .then(function(r){return r.json();})
    .then(function(d){_upgradeData=d;_upgradeLoading=false;
      if(!_upgradeAutoChecked&&(!d.proposals||d.proposals.length===0)){_upgradeAutoChecked=true;_upgradeCheck();}
      else renderCenter();})
    .catch(function(e){_upgradeData={error:e.message};_upgradeLoading=false;_upgradeAutoChecked=true;renderCenter();});
}
/* v125: fire-and-forget — progress comes via WS events */
function _upgradeApply(role,model){
  if(_upgradeLoading){_upgradeMsg={ok:false,text:'Prob\u00EDh\u00E1 jin\u00FD upgrade \u2014 vy\u010Dkejte'};renderCenter();return;}
  _upgradeMsg={ok:true,text:'Aplikuji upgrade '+role+': '+model+'...'};_upgradeLoading=true;renderCenter();
  if(window._c3)window._c3.agentLog('TOOL','\uD83D\uDD04 Upgrade '+role+': '+model+'...');
  fetch(_backendBase+'/api/system/upgrades/apply',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:role,targetModel:model}),signal:AbortSignal.timeout(30000)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.ok){_upgradeLoading=false;
        var errMsg=d.error||'Upgrade selhal';
        if(errMsg.indexOf('already set')>=0)errMsg='Model je ji\u017E nastaven pro tuto roli';
        else if(errMsg.indexOf('Invalid role')>=0)errMsg='Neplatn\u00E1 role: '+role;
        _upgradeMsg={ok:false,text:errMsg};renderCenter();
        if(window._c3)window._c3.agentLog('TOOL','\u274C '+errMsg);
        setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}
      /* else: loading stays true, WS model_changed/upgrade_error will clear it */
      /* Safety: auto-reset after 120s in case WS event is lost */
      setTimeout(function(){if(_upgradeLoading){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Timeout \u2014 odpov\u011B\u010F nedorazila'};renderCenter();
        setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}},120000);})
    .catch(function(e){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Chyba s\u00EDt\u011B: '+e.message};renderCenter();
      if(window._c3)window._c3.agentLog('TOOL','\u274C Chyba s\u00EDt\u011B: '+e.message);});
}
var _validationPrompt=null;/* v125: pending validation consent */
function _upgradeDismiss(id){
  fetch(_backendBase+'/api/system/proposals/'+id+'/dismiss',{method:'POST',signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();})
    .then(function(d){if(d.ok){_upgradeData=null;_loadUpgradeData();}})
    .catch(function(){});
}
function _upgradeCheck(){
  _upgradeMsg={ok:true,text:'Probíhá kontrola + vyhledávání nových modelů...'};_upgradeLoading=true;renderCenter();
  fetch(_backendBase+'/api/system/upgrades/check',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({fullCycle:true}),
    signal:AbortSignal.timeout(90000)})
    .then(function(r){return r.json();})
    .then(function(d){_upgradeData=d;_upgradeLoading=false;
      var stats=d.discovery||{};var l4=stats.l4Count||0;
      _upgradeMsg={ok:true,text:'Kontrola dokončena — '+(d.proposals||[]).length+' návrh(ů)'+(l4>0?', '+l4+' nových modelů objeveno':'')};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);})
    .catch(function(e){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function _loadScoringData(){
  if(_scoringLoading)return;_scoringLoading=true;
  fetch(_backendBase+'/api/system/upgrades/scoring',{signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){_scoringData=d;_scoringLoading=false;_loadValidationScores();renderCenter();})
    .catch(function(e){_scoringData={error:e.message};_scoringLoading=false;renderCenter();});
}
function _loadValidationScores(){
  fetch(_backendBase+'/api/system/models/validation-scores',{signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();})
    .then(function(d){_validationScores=d.scores||{};renderCenter();})
    .catch(function(){});
}
function _validateModel(name){
  if(_validatingModel)return;
  _validatingModel=name;_validationProgress={suite:'',testName:'',percent:0,text:name+' — Spouštím...'};renderCenter();
  fetch(_backendBase+'/api/system/models/validate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:name}),signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){if(!d.ok){_validatingModel=null;_validationProgress=null;renderCenter();}})
    .catch(function(e){_validatingModel=null;_validationProgress=null;renderCenter();});
}
/* Installed models cache for scoring tab */
var _installedModels=null;var _installedLoading=false;var _assigningRole=null;
function _loadInstalledModels(){
  if(_installedLoading)return;_installedLoading=true;
  fetch(_backendBase+'/api/system/models',{signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();})
    .then(function(d){_installedModels=(d.models||[]).map(function(m){return m.name;});_installedLoading=false;renderCenter();})
    .catch(function(){_installedLoading=false;});
}
function _assignModel(role,model){
  if(_assigningRole)return;_assigningRole=role;renderCenter();
  fetch(_backendBase+'/api/system/upgrades/apply',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:role,targetModel:model,appliedBy:'user-scoring'}),signal:AbortSignal.timeout(30000)})
    .then(function(r){return r.json();})
    .then(function(d){_assigningRole=null;
      if(d.ok||d.applied){_scoringData=null;_loadScoringData();_discoveredData=null;}
      else{_assigningRole=null;}renderCenter();})
    .catch(function(){_assigningRole=null;renderCenter();});
}
/* v133: Overview loader + model delete + batch validate */
function _loadModelOverview(){
  if(_modelOverviewLoading)return;_modelOverviewLoading=true;
  fetch(_backendBase+'/api/system/models/overview',{signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){_modelOverview=d;_modelOverviewLoading=false;
      _batchValidating=d.batchValidating||false;
      _roleBindings=d.bindings||null;renderCenter();})
    .catch(function(){_modelOverviewLoading=false;renderCenter();});
}
function _deleteModel(name){
  if(_deletingModel)return;_deletingModel=name;renderCenter();
  fetch(_backendBase+'/api/system/models?name='+encodeURIComponent(name),{method:'DELETE',signal:AbortSignal.timeout(15000)})
    .then(function(r){return r.json();})
    .then(function(d){_deletingModel=null;_deleteConfirm=null;
      if(d.ok){_modelOverview=null;_installedModels=null;_ollamaModels=null;}
      else{_upgradeMsg={ok:false,text:d.error||'Chyba p\u0159i maz\u00E1n\u00ED'};setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}
      renderCenter();})
    .catch(function(e){_deletingModel=null;_deleteConfirm=null;
      _upgradeMsg={ok:false,text:'Chyba: '+e.message};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);});
}
function _batchValidateAll(){
  if(_batchValidating)return;_batchValidating=true;renderCenter();
  fetch(_backendBase+'/api/system/models/validate-all',{method:'POST',headers:{'Content-Type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){if(d.alreadyRunning){_upgradeMsg={ok:true,text:'Validace ji\u017E prob\u00EDh\u00E1'};setTimeout(function(){_upgradeMsg=null;renderCenter();},3000);}
      else if(d.queued){_batchQueue=d.queued;
        _upgradeMsg={ok:true,text:'Validace spu\u0161t\u011Bna: '+d.queued.length+' model\u016F (~'+d.estimatedMinutes+' min)'};
        if(window._c3)window._c3.agentLog('TOOL','\uD83E\uDDEA D\u00E1vkov\u00E1 validace: '+d.queued.length+' model\u016F');
        setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}
      renderCenter();})
    .catch(function(e){_batchValidating=false;_upgradeMsg={ok:false,text:'Chyba: '+e.message};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);});
}
var _discoverLoading=false;var _discoverMsg=null;
function _discoverNewModels(){
  if(_discoverLoading)return;
  _discoverLoading=true;_discoverMsg={ok:true,text:'Prohledávám ollama.com/library...'};renderCenter();
  fetch(_backendBase+'/api/system/upgrades/check',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({fullCycle:true}),
    signal:AbortSignal.timeout(90000)})
    .then(function(r){return r.json();})
    .then(function(d){_discoverLoading=false;_upgradeData=d;
      var stats=d.discovery||{};var l4=stats.l4Count||0;
      _discoverMsg={ok:true,text:'Hotovo — '+(l4>0?l4+' nových modelů nalezeno':'žádné nové modely')};
      _discoveredData=null;_loadDiscoveredData();renderCenter();
      setTimeout(function(){_discoverMsg=null;renderCenter();},5000);})
    .catch(function(e){_discoverLoading=false;_discoverMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function _pullModel(name){
  if(_pullState[name]&&_pullState[name].status&&_pullState[name].status!=='done'&&_pullState[name].status!=='error')return;
  _pullState[name]={status:'starting',percent:0,text:name+' — Zahajuji stahování...'};renderCenter();
  fetch(_backendBase+'/api/system/models/pull',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name}),signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){if(!d.ok){_pullState[name]={status:'error',percent:-1,text:name+' — '+(d.error||'Chyba')};renderCenter();}})
    .catch(function(e){_pullState[name]={status:'error',percent:-1,text:name+' — '+e.message};renderCenter();});
}
function _loadDiscoveredData(){
  if(_discoveredLoading)return;_discoveredLoading=true;
  fetch(_backendBase+'/api/system/upgrades/recommendations',{signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json();})
    .then(function(d){_discoveredData=d;_discoveredLoading=false;renderCenter();})
    .catch(function(e){_discoveredData={error:e.message};_discoveredLoading=false;renderCenter();});
}
var _recExpanded={};/* model name → true/false for comparison details */
function _renderDiscoveredTab(){
  var toast=_discoverMsg?h('div',{style:{marginBottom:12,padding:'8px 14px',borderRadius:6,fontSize:_fs(11),fontWeight:600,
    background:_discoverMsg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
    color:_discoverMsg.ok?C.accent:'#ef4444',
    border:'1px solid '+(_discoverMsg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_discoverMsg.text):null;
  if(_discoveredLoading&&!_discoveredData)return h('div',null,toast,h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Nacitam doporucene modely...'));
  if(!_discoveredData||_discoveredData.error)return h('div',null,
    h('div',{style:{textAlign:'center',padding:'40px 20px'}},
      h('div',{style:{fontSize:_fs(28),marginBottom:12}},'\uD83D\uDD0D'),
      h('div',{style:{fontSize:_fs(13),color:C.tx2,fontWeight:600,marginBottom:8}},_discoveredData?'Chyba: '+_discoveredData.error:'Nacitam doporuceni...')));
  var sections=_discoveredData.sections||[];
  var curModels=_discoveredData.currentModels||{};
  if(sections.length===0)return h('div',null,toast,
    h('div',{style:{textAlign:'center',padding:'40px 20px'}},
      h('div',{style:{fontSize:_fs(28),marginBottom:10}},'\uD83D\uDD0D'),
      h('div',{style:{fontSize:_fs(13),color:C.tx2,fontWeight:600}},'Zadna doporuceni')));
  var semColors={upgrade:'#22c55e',sidegrade:'#eab308',downgrade:'#ef4444',unknown:C.tx4};
  var semBg={upgrade:'rgba(34,197,94,0.12)',sidegrade:'rgba(234,179,8,0.12)',downgrade:'rgba(239,68,68,0.12)',unknown:C.bg3};
  var semLabels={upgrade:'Upgrade',sidegrade:'Srovnatelny',downgrade:'Slabsi',unknown:'?'};
  var semIcons={upgrade:'\u2B06\uFE0F',sidegrade:'\u2194\uFE0F',downgrade:'\u2B07\uFE0F',unknown:'\u2753'};
  var bL={mmlu:'MMLU',gpqa:'GPQA',humaneval:'HumanEval',livecodebench:'LiveCode',swebench:'SWE-Bench',
    arena:'Arena',reasoning:'Reasoning',math:'Math',code:'Code',multimodal:'Multimodal'};
  var roleColors={D1:'#8b5cf6',D2:'#a78bfa',CODE:'#22c55e',R1:'#6366f1',R2:'#818cf8',CHAT:'#3b82f6',VISION:'#f59e0b'};
  var capColors={vision:'#8b5cf6',tool_use:'#f59e0b',reasoning:'#3b82f6',json_mode:'#6366f1',long_context:'#06b6d4'};
  var gpuGB=_discoveredData.gpuVramMb?(_discoveredData.gpuVramMb/1024).toFixed(0):null;
  var budgetGB=_discoveredData.vramBudget?(_discoveredData.vramBudget/1024).toFixed(1):null;
  /* Helper: format context window */
  function fCtx(w){if(!w)return'-';return w>=1048576?(w/1048576).toFixed(0)+'M':w>=1024?(w/1024).toFixed(0)+'K':w+'';}
  /* Helper: delta cell */
  function dCell(a,b){if(a==null||b==null)return h('td',{style:{padding:'2px 6px',textAlign:'right',fontSize:_fs(9),color:C.tx4}},'-');
    var d=a-b;var col=d>0.005?'#22c55e':d<-0.005?'#ef4444':C.tx4;
    return h('td',{style:{padding:'2px 6px',textAlign:'right',fontSize:_fs(9),fontWeight:600,color:col}},
      (d>0?'+':'')+Math.round(d*100));}
  return h('div',null,
    toast,
    h('div',{style:{marginBottom:14}},
      h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:3}},'Doporucene modely pro C3'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,lineHeight:1.4}},
        gpuGB?'GPU: '+gpuGB+' GB VRAM'+(budgetGB?' — zobrazeny modely do '+budgetGB+' GB (80%)':'')+'. ':'','Kliknete pro porovnani s aktualnim modelem.')),
    sections.map(function(sec){
      return h('div',{key:sec.id,style:{marginBottom:22}},
        h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:8,paddingBottom:6,borderBottom:'1px solid '+C.border}},
          h('span',{style:{fontSize:_fs(16)}},sec.icon),
          h('div',{style:{flex:1}},
            h('div',{style:{fontSize:_fs(12),fontWeight:700,color:C.tx1}},sec.title),
            h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:1}},sec.subtitle))),
        sec.models.map(function(m){
          var vramGB=(m.vramMb/1024).toFixed(1);
          var sizeGB=(m.vramMb*0.75/1024).toFixed(1);
          var sem=m.bestSemaphore||'unknown';
          var isHL=m.highlight===true;
          var ps=_pullState[m.name];
          var isPulling=ps&&ps.status&&ps.status!=='done'&&ps.status!=='error';
          var isDone=ps&&ps.status==='done';
          var isError=ps&&ps.status==='error';
          var isExp=_recExpanded[m.name+'-'+sec.id]===true;
          /* Primary role for comparison (first role in list) */
          var priRole=(m.roles||[])[0]||null;
          var priCur=priRole?curModels[priRole]:null;
          return h('div',{key:m.name+'-'+sec.id,style:{background:isHL?'linear-gradient(135deg,rgba(99,102,241,0.05),rgba(139,92,246,0.03))':C.bg2,
            border:'1px solid '+(isHL?'rgba(99,102,241,0.25)':isPulling?'rgba(59,130,246,0.4)':isDone?'rgba(34,197,94,0.3)':C.border),
            borderRadius:10,padding:'12px 14px',marginBottom:8,cursor:'pointer'},
            onClick:function(){_recExpanded[m.name+'-'+sec.id]=!isExp;renderCenter();}},
            /* ── Row 1: header line ── */
            h('div',{style:{display:'flex',alignItems:'center',gap:6,marginBottom:4}},
              h('span',{style:{fontSize:_fs(12),fontWeight:700,color:C.tx1,fontFamily:C.mono}},m.name),
              isHL?h('span',{style:{fontSize:_fs(8),padding:'1px 5px',borderRadius:3,background:'rgba(99,102,241,0.15)',color:'#6366f1',fontWeight:700}},'TOP'):null,
              h('span',{style:{flex:1}}),
              /* Semaphore badge */
              h('span',{style:{fontSize:_fs(9),padding:'2px 8px',borderRadius:4,fontWeight:600,background:semBg[sem],color:semColors[sem]}},
                semIcons[sem]+' '+semLabels[sem]),
              /* Right side: installed badge | pull progress | download button */
              m.installed?h('span',{style:{fontSize:_fs(9),padding:'3px 10px',borderRadius:6,background:'rgba(34,197,94,0.12)',
                color:C.accent,fontWeight:600,marginLeft:6,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:4}},
                '\u2705 Nainstalováno'):
              isPulling?h('div',{style:{marginLeft:6,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2,minWidth:180}},
                h('div',{style:{display:'flex',alignItems:'center',gap:6}},
                  h('span',{style:{fontSize:_fs(9),color:'#3b82f6',fontWeight:600,whiteSpace:'nowrap'}},
                    ps.percent>=0?ps.percent+'%':(ps.status==='scoring'?'Scoring...':'Stahování...')),
                  ps.downloadedGB&&ps.totalGB?h('span',{style:{fontSize:_fs(8),color:C.tx4,whiteSpace:'nowrap'}},
                    ps.downloadedGB+'/'+ps.totalGB+' GB'):null,
                  ps.eta?h('span',{style:{fontSize:_fs(8),color:C.tx4,whiteSpace:'nowrap'}},'~'+ps.eta):null),
                h('div',{style:{width:'100%',background:C.bg3,borderRadius:3,height:4,overflow:'hidden'}},
                  ps.percent>=0?h('div',{style:{width:Math.max(2,ps.percent)+'%',height:'100%',borderRadius:3,transition:'width 0.3s ease',
                    background:ps.status==='scoring'?'linear-gradient(90deg,#8b5cf6,#6366f1)':'linear-gradient(90deg,#3b82f6,#60a5fa)'}}):
                  h('div',{style:{width:'30%',height:'100%',borderRadius:3,
                    background:'linear-gradient(90deg,transparent,#3b82f6,transparent)',
                    animation:'c3-pulse 1.5s ease-in-out infinite'}}))):
              isDone?h('div',{style:{marginLeft:6,display:'flex',alignItems:'center',gap:6}},
                h('span',{style:{fontSize:_fs(9),color:C.accent,fontWeight:600,whiteSpace:'nowrap'}},'\u2705 Staženo'),
                h('button',{style:{background:'linear-gradient(135deg,#8b5cf6,#6366f1)',color:'#fff',border:'none',borderRadius:6,
                  padding:'3px 10px',fontSize:_fs(9),fontWeight:600,cursor:'pointer',fontFamily:C.font,
                  display:'flex',alignItems:'center',gap:4,whiteSpace:'nowrap'},
                  onClick:function(e){e.stopPropagation();_validateModel(m.name);}},
                  'Otestovat')):
              isError?h('span',{style:{fontSize:_fs(9),color:'#ef4444',fontWeight:600,marginLeft:6,whiteSpace:'nowrap'}},
                '\u274C Chyba'):
              h('button',{style:{background:'linear-gradient(135deg,#3b82f6,#2563eb)',color:'#fff',border:'none',borderRadius:6,
                padding:'4px 12px',fontSize:_fs(9),fontWeight:600,cursor:'pointer',fontFamily:C.font,marginLeft:6,
                display:'flex',alignItems:'center',gap:4,boxShadow:'0 1px 4px rgba(37,99,235,0.25)',whiteSpace:'nowrap'},
                onClick:function(e){e.stopPropagation();_pullModel(m.name);}},
                svgEl('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',12),
                '~'+sizeGB+' GB')),
            /* ── Row 2: description + specs ── */
            h('div',{style:{display:'flex',alignItems:'baseline',gap:8,marginBottom:3,flexWrap:'wrap'}},
              h('span',{style:{fontSize:_fs(10),color:C.tx2,flex:'1 1 auto',lineHeight:1.3,minWidth:150}},m.description),
              h('span',{style:{fontSize:_fs(9),color:C.tx4,whiteSpace:'nowrap'}},m.params+'B'),
              h('span',{style:{fontSize:_fs(9),color:C.tx4,whiteSpace:'nowrap'}},vramGB+' GB'),
              m.moe?h('span',{style:{fontSize:_fs(8),padding:'0px 5px',borderRadius:3,background:'rgba(245,158,11,0.1)',color:'#f59e0b',fontWeight:600,whiteSpace:'nowrap'}},
                'MoE '+m.moe.activeParams+'B'):null,
              h('span',{style:{fontSize:_fs(9),color:C.tx4,whiteSpace:'nowrap'}},fCtx(m.contextWindow)+' ctx')),
            /* ── Row 3: roles + capabilities ── */
            h('div',{style:{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}},
              (m.roles||[]).map(function(r){var sv=m.semaphores&&m.semaphores[r];
                return h('span',{key:r,style:{fontSize:_fs(8),padding:'1px 5px',borderRadius:3,fontWeight:600,
                  background:(roleColors[r]||C.tx4)+'1a',color:roleColors[r]||C.tx4,
                  borderLeft:sv?'2px solid '+semColors[sv]:'none'}},r);}),
              h('span',{style:{width:1,height:10,background:C.border,margin:'0 2px'}}),
              (m.capabilities||[]).map(function(cap){
                return h('span',{key:cap,style:{fontSize:_fs(7),padding:'1px 4px',borderRadius:2,
                  background:(capColors[cap]||C.tx4)+'12',color:capColors[cap]||C.tx4}},cap.replace(/_/g,' '));})),
            /* ── Pull status detail line (below rows when pulling) ── */
            isPulling?h('div',{style:{marginTop:4,fontSize:_fs(9),color:'#3b82f6',fontWeight:500}},ps.text||'Stahování...'):null,
            isError&&ps?h('div',{style:{marginTop:4,fontSize:_fs(9),color:'#ef4444',fontWeight:600}},ps.text):null,
            /* ── Expanded: comparison table ── */
            isExp?h('div',{style:{marginTop:8,borderTop:'1px solid '+C.border,paddingTop:8}},
              /* Detail text */
              m.detail?h('div',{style:{fontSize:_fs(9),color:C.tx3,lineHeight:1.4,marginBottom:8}},m.detail):null,
              /* Comparison per role — deduplicate when multiple roles share the same current model */
              (function(){
                var seen={};var deduped=[];
                (m.roles||[]).forEach(function(role){
                  var cur=curModels[role];var curName=cur?cur.name:'?';
                  if(seen[curName]){seen[curName].roles.push(role);return;}
                  seen[curName]={roles:[role],cur:cur,curName:curName};
                  deduped.push(seen[curName]);
                });
                return deduped;
              })().map(function(grp){
                var roleLabel=grp.roles.join('+');
                /* Skip self-comparison: show badge instead of table */
                var allCurrent=m.isCurrent&&grp.roles.every(function(r){return m.isCurrent[r];});
                if(allCurrent)return h('div',{key:roleLabel,style:{marginBottom:8,display:'flex',alignItems:'center',gap:6}},
                  h('span',{style:{fontSize:_fs(9),fontWeight:700,color:roleColors[grp.roles[0]]||C.tx2}},roleLabel),
                  h('span',{style:{fontSize:_fs(8),padding:'2px 8px',borderRadius:4,fontWeight:600,
                    background:'rgba(34,197,94,0.12)',color:C.accent}},'Aktualni model'));
                var cur=grp.cur;var curB=cur&&cur.benchmarks?cur.benchmarks:{};
                var recB=m.benchmarks||{};
                var allKeys=Object.keys(Object.assign({},curB,recB)).filter(function(k){return curB[k]!=null||recB[k]!=null;});
                if(allKeys.length===0)return null;
                var curName=grp.curName;
                /* Best semaphore for merged group */
                var grpSem='unknown';var semOrd={upgrade:3,sidegrade:2,downgrade:1,unknown:0};
                grp.roles.forEach(function(r){var s=m.semaphores&&m.semaphores[r];if((semOrd[s]||0)>(semOrd[grpSem]||0))grpSem=s;});
                return h('div',{key:roleLabel,style:{marginBottom:8}},
                  h('div',{style:{display:'flex',alignItems:'center',gap:6,marginBottom:4}},
                    h('span',{style:{fontSize:_fs(9),fontWeight:700,color:roleColors[grp.roles[0]]||C.tx2}},roleLabel),
                    h('span',{style:{fontSize:_fs(8),color:C.tx4}},'vs'),
                    h('span',{style:{fontSize:_fs(9),fontFamily:C.mono,color:C.tx3}},grp.curName),
                    grpSem!=='unknown'?h('span',{style:{fontSize:_fs(8),padding:'0px 4px',borderRadius:3,
                      background:semBg[grpSem],color:semColors[grpSem],fontWeight:600}},
                      semLabels[grpSem]):null),
                  h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:_fs(9),fontFamily:C.mono}},
                    h('thead',null,h('tr',{style:{borderBottom:'1px solid '+C.border}},
                      h('th',{style:{textAlign:'left',padding:'2px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(8)}},'Benchmark'),
                      h('th',{style:{textAlign:'right',padding:'2px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(8)}},m.name.split(':')[0]),
                      h('th',{style:{textAlign:'right',padding:'2px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(8)}},curName.split(':')[0]),
                      h('th',{style:{textAlign:'right',padding:'2px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(8)}},'\u0394'))),
                    h('tbody',null,
                      allKeys.map(function(k){
                        var rv=recB[k];var cv=curB[k];
                        return h('tr',{key:k,style:{borderBottom:'1px solid '+C.border+'44'}},
                          h('td',{style:{padding:'2px 6px',color:C.tx3,fontSize:_fs(8)}},bL[k]||k),
                          h('td',{style:{padding:'2px 6px',textAlign:'right',fontWeight:600,color:C.tx2,fontSize:_fs(9)}},rv!=null?Math.round(rv*100):'-'),
                          h('td',{style:{padding:'2px 6px',textAlign:'right',color:C.tx3,fontSize:_fs(9)}},cv!=null?Math.round(cv*100):'-'),
                          dCell(rv,cv));
                      }),
                      /* VRAM row */
                      h('tr',{style:{borderBottom:'1px solid '+C.border+'44'}},
                        h('td',{style:{padding:'2px 6px',color:C.tx3,fontSize:_fs(8)}},'VRAM'),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',fontWeight:600,color:C.tx2,fontSize:_fs(9)}},(m.vramMb/1024).toFixed(1)+' GB'),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',color:C.tx3,fontSize:_fs(9)}},cur&&cur.vramMb?(cur.vramMb/1024).toFixed(1)+' GB':'-'),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',fontSize:_fs(9),fontWeight:600,
                          color:cur&&cur.vramMb?(m.vramMb<cur.vramMb?'#22c55e':m.vramMb>cur.vramMb?'#ef4444':C.tx4):C.tx4}},
                          cur&&cur.vramMb?((m.vramMb-cur.vramMb)/1024).toFixed(1)+' GB':'-')),
                      /* Context row */
                      h('tr',null,
                        h('td',{style:{padding:'2px 6px',color:C.tx3,fontSize:_fs(8)}},'Kontext'),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',fontWeight:600,color:C.tx2,fontSize:_fs(9)}},fCtx(m.contextWindow)),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',color:C.tx3,fontSize:_fs(9)}},fCtx(cur&&cur.contextWindow)),
                        h('td',{style:{padding:'2px 6px',textAlign:'right',color:C.tx4,fontSize:_fs(9)}},'-'))
                    )));
              }),
              /* Footnote */
              h('div',{style:{fontSize:_fs(8),color:C.tx4,lineHeight:1.4,marginTop:4,fontStyle:'italic'}},
                '* Odhad z benchmarku. Po instalaci model projde lokalnim scoringem a empirickymi testy.')
            ):null);
        }));
    }));
}
function _describeUpgrade(p,bd){
  var items=[];var cur=bd.current||{};var cand=bd.candidate||{};
  var role=p.role||'';
  /* Benchmark comparison — role-specific interpretation */
  var benchDelta=(cand.benchmark||0)-(cur.benchmark||0);
  if(benchDelta>0.05){
    var benchDesc='Lepší benchmarkové skóre';
    if(role==='CODE')benchDesc='Lepší v generování a úpravách kódu (LiveCodeBench, HumanEval)';
    else if(role==='D1'||role==='R1')benchDesc='Lepší dedukce a logické uvažování';
    else if(role==='CHAT')benchDesc='Kvalitnější odpovědi v konverzaci (MMLU, Arena)';
    else if(role==='D2'||role==='R2')benchDesc='Lepší znalostní báze a reasoning';
    else if(role==='VISION')benchDesc='Lepší porozumění obrázkům a textu';
    items.push({text:benchDesc+' (+'+((benchDelta)*100).toFixed(0)+'%)',icon:'\u2B06',color:C.accent});
  }else if(benchDelta<-0.05){
    items.push({text:'Mírně slabší benchmarky (\u2212'+((0-benchDelta)*100).toFixed(0)+'%), ale jiné výhody kompenzují',icon:'\u26A0',color:'#eab308'});
  }
  /* Hardware fit */
  var hwDelta=(cand.hardwareFit||0)-(cur.hardwareFit||0);
  if(hwDelta>0.15)items.push({text:'Lépe využívá dostupný HW (GPU VRAM)',icon:'\u2699'});
  else if(hwDelta<-0.15)items.push({text:'Vyšší nároky na HW',icon:'\u26A0',color:'#eab308'});
  /* Speed */
  var speedDelta=(cand.speed||0)-(cur.speed||0);
  if(speedDelta>0.1)items.push({text:'Rychlejší inference — kratší čekání na odpovědi',icon:'\u26A1'});
  else if(speedDelta<-0.1)items.push({text:'Pomalejší inference',icon:'\u231B',color:'#eab308'});
  /* Generation */
  var genDelta=(cand.generation||0)-(cur.generation||0);
  if(genDelta>0.3)items.push({text:'Novější generace modelu s vylepšenou architekturou',icon:'\u2728'});
  /* Maturity */
  if((cand.maturity||0)>0.8&&(cur.maturity||0)<0.5)items.push({text:'Stabilní a prověřený model',icon:'\u2705'});
  /* Provisional / L4 */
  if(p.source==='L4'){
    var conf=p.benchmarkConfidence||bd.benchConfidence;
    if(conf&&conf<0.7)items.push({text:'Odhadované benchmarky (spolehlivost '+(conf*100).toFixed(0)+'%) — empirické testování upřesní',icon:'\u2139',color:C.tx4});
  }
  /* benchConfidence from candidate breakdown */
  if(cand.benchConfidence!=null&&cand.benchConfidence<0.7&&!p.source)
    items.push({text:'Odhadované benchmarky (spolehlivost '+(cand.benchConfidence*100).toFixed(0)+'%)',icon:'\u2139',color:C.tx4});
  /* Provisional penalty info */
  if(cand.provisionalPenalty&&cand.provisionalPenalty<0)
    items.push({text:'Provizorní model — skóre sníženo, empirické testování upřesní',icon:'\u2139',color:C.tx4});
  /* Fallback: if no items, show generic reason */
  if(items.length===0&&p.reason)items.push({text:p.reason,icon:'\u2022'});
  return items;
}
function _renderScoringTab(){
  if(_scoringLoading&&!_scoringData)return h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Načítám hodnocení modelů...');
  if(!_scoringData||_scoringData.error)return h('div',{style:{color:'#ef4444',padding:20,textAlign:'center'}},'Chyba: '+(_scoringData?_scoringData.error:'žádná data'));
  var scoring=_scoringData.scoring;var roles=Object.keys(scoring);
  var bdKeys=['benchmark','hardwareFit','maturity','generation','category','speed','diversityPenalty'];
  var bdLabels={benchmark:'Bench',hardwareFit:'HW Fit',maturity:'Zralost',generation:'Generace',category:'Kategorie',speed:'Rychlost',diversityPenalty:'Diverzita'};
  var bdTooltips={benchmark:'Benchmark skóre z veřejných testů (MMLU, HumanEval, reasoning). Váha 35%.',hardwareFit:'Jak dobře model využívá dostupnou GPU VRAM (0=příliš velký, 1=ideální). Váha 20%.',maturity:'Stáří a stabilita modelu (starší = ověřenější). Váha 15%.',generation:'Bonus za novější generaci architektury (0=stará, 0.5=nová). Váha 10%.',category:'Bonus za kategorii modelu vhodnou pro danou roli. Váha 13%.',speed:'Rychlost inference (tokens/s normalizováno). Váha 7%.',diversityPenalty:'Penalizace pokud model již slouží v jiné roli (zabrání přiřazení jednoho modelu všude).'};
  var roleSuiteMap={D1:'reasoning',D2:'reasoning',CODE:'code',R1:'reasoning',R2:'review',CHAT:'chat',VISION:'vision'};
  return h('div',null,
    _scoringData.gpuVramMb?h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:12}},'GPU VRAM: '+(_scoringData.gpuVramMb/1024).toFixed(1)+' GB  |  Eval: '+(_scoringData.evalVersion||'?')):null,
    /* validation progress banner */
    _validatingModel&&_validationProgress?h('div',{style:{margin:'0 0 12px',padding:'8px 14px',borderRadius:6,fontSize:_fs(11),
      background:'rgba(59,130,246,0.1)',color:'#3b82f6',border:'1px solid rgba(59,130,246,0.2)'}},
      _validationProgress.text||(_validatingModel+' — validace...')):null,
    roles.map(function(role){
      var rd=scoring[role];var models=rd.models||[];var suiteName=roleSuiteMap[role]||'';
      return h('div',{key:role,style:{marginBottom:20}},
        h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:8}},
          h('span',{style:{background:C.accent,color:'#fff',borderRadius:4,padding:'2px 8px',fontSize:_fs(10),fontWeight:700}},role),
          h('span',{style:{fontSize:_fs(10),color:C.tx4}},'Aktuální: '),
          h('span',{style:{fontSize:_fs(10),color:C.tx2,fontFamily:C.mono}},rd.current||'?'),
          suiteName?h('span',{style:{fontSize:_fs(9),color:C.tx4,marginLeft:8}},'('+suiteName+')'):null),
        models.length===0?h('div',{style:{fontSize:_fs(10),color:C.tx4,padding:8}},'Žádné modely v katalogu'):
        h('div',{style:{overflowX:'auto'}},
          h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:_fs(10),fontFamily:C.mono}},
            h('thead',null,h('tr',{style:{borderBottom:'1px solid '+C.border}},
              h('th',{style:{textAlign:'left',padding:'4px 6px',color:C.tx3,fontWeight:600,fontFamily:C.font}},'#'),
              h('th',{style:{textAlign:'left',padding:'4px 6px',color:C.tx3,fontWeight:600,fontFamily:C.font}},'Model'),
              h('th',{title:'Celkové skóre modelu pro danou roli (vyšší = lepší). Skládá se z vážené kombinace sloupců vpravo.',style:{textAlign:'right',padding:'4px 6px',color:C.tx3,fontWeight:600,fontFamily:C.font,cursor:'help'}},'Skóre'),
              h('th',{title:'Odkud pocházejí benchmarky: Katalog (manuálně kurované), WhatLLM (reálné testy z whatllm.org), Odhad (interpolace z rodiny modelů)',style:{textAlign:'center',padding:'4px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(9),fontFamily:C.font,cursor:'help'}},'Zdroj'),
              h('th',{title:'Výsledek lokálního syntetického testu (0-100%). Klikněte ▶ pro spuštění. Platnost 14 dní.',style:{textAlign:'right',padding:'4px 6px',color:'#3b82f6',fontWeight:600,fontFamily:C.font,cursor:'help'}},'Validace'),
              h('th',{title:'Přiřadit model k této roli (pouze lokálně nainstalované)',style:{textAlign:'center',padding:'4px 6px',color:C.tx3,fontWeight:600,fontFamily:C.font,cursor:'help',width:60}},''),
              bdKeys.map(function(k){return h('th',{key:k,title:bdTooltips[k]||'',style:{textAlign:'right',padding:'4px 6px',color:C.tx4,fontWeight:500,fontSize:_fs(9),fontFamily:C.font,cursor:'help'}},bdLabels[k]);}))),
            h('tbody',null,models.map(function(m,i){
              var isCur=m.isCurrent;
              var vs=_validationScores[m.name];
              var valScore=vs&&vs[suiteName]?vs[suiteName].score:null;
              var valAge=vs&&vs[suiteName]&&vs[suiteName].validatedAt?Math.round((Date.now()-new Date(vs[suiteName].validatedAt).getTime())/(86400000)):null;
              var isValidating=_validatingModel===m.name;
              var valColor=valScore!=null?(valScore>=0.7?C.accent:valScore>=0.4?'#eab308':'#ef4444'):C.tx4;
              return h('tr',{key:m.name,style:{borderBottom:'1px solid '+C.border,background:isCur?'rgba(34,197,94,0.06)':'transparent'}},
                h('td',{style:{padding:'4px 6px',color:C.tx4}},i+1),
                h('td',{style:{padding:'4px 6px',color:isCur?C.accent:C.tx2,fontWeight:isCur?700:400}},m.name+(isCur?' *':'')),
                h('td',{style:{padding:'4px 6px',textAlign:'right',color:C.tx1,fontWeight:700}},m.score.toFixed(4)),
                h('td',{style:{padding:'4px 6px',textAlign:'center'}},
                  h('span',{style:{fontSize:_fs(8),padding:'1px 5px',borderRadius:3,
                    background:m.benchmarkSource==='whatllm'?'rgba(59,130,246,0.12)':m.benchmarkSource==='catalog'?'rgba(34,197,94,0.08)':m.benchmarkSource==='L4'?'rgba(234,179,8,0.1)':'transparent',
                    color:m.benchmarkSource==='whatllm'?'#3b82f6':m.benchmarkSource==='catalog'?C.accent:m.benchmarkSource==='L4'?'#eab308':C.tx4},
                    title:m.benchmarkSource==='whatllm'?'Reálné benchmarky z whatllm.org (Quality Index)':m.benchmarkSource==='catalog'?'Benchmarky z kurovaného katalogu':m.benchmarkSource==='L4'?'Odhadované benchmarky (log-interpolace z rodiny)':'Neznámý zdroj'},
                    m.benchmarkSource==='whatllm'?'WhatLLM':m.benchmarkSource==='catalog'?'Katalog':m.benchmarkSource==='L4'?'Odhad':'\u2014')),
                h('td',{style:{padding:'4px 6px',textAlign:'right'}},
                  isValidating?h('span',{style:{color:'#3b82f6',fontSize:_fs(9)}},'...'):
                  valScore!=null?h('span',{style:{color:valColor,fontWeight:600,cursor:'default'},
                    title:'Validováno '+((valAge!=null&&valAge>=0)?valAge+'d ago':'')},
                    Math.round(valScore*100)+'%'):
                  h('button',{style:{background:'none',border:'1px solid '+C.border2,borderRadius:4,padding:'1px 6px',
                    color:C.tx3,fontSize:_fs(9),cursor:'pointer',fontFamily:C.font},
                    onClick:function(){_validateModel(m.name);}},'\u25B6')),
                h('td',{style:{padding:'4px 6px',textAlign:'center'}},
                  isCur?h('span',{style:{fontSize:_fs(8),color:C.accent,fontWeight:600}},'\u2713'):
                  _installedModels&&_installedModels.indexOf(m.name)>=0?
                    _assigningRole===role?h('span',{style:{fontSize:_fs(8),color:'#3b82f6'}},'...'):
                    h('button',{style:{background:'none',border:'1px solid rgba(59,130,246,0.3)',borderRadius:4,padding:'1px 8px',
                      color:'#3b82f6',fontSize:_fs(8),cursor:'pointer',fontFamily:C.font,whiteSpace:'nowrap'},
                      onClick:function(){_assignModel(role,m.name);}},'\u2190 Přiřadit'):
                  h('span',{style:{fontSize:_fs(7),color:C.tx4}},'\u2014')),
                bdKeys.map(function(k){
                  var v=m.breakdown?m.breakdown[k]:0;
                  var color=C.tx3;if(k==='diversityPenalty'&&v<0)color='#ef4444';
                  return h('td',{key:k,title:bdTooltips[k]||'',style:{padding:'4px 6px',textAlign:'right',color:color,cursor:'help'}},v!=null?v.toFixed(2):'—');
                }));
            })))));
    }),
    h('div',{style:{marginTop:12,fontSize:_fs(9),color:C.tx4,lineHeight:1.5}},
      '* = aktuálně přiřazený model. Skóre: benchmark*0.35 + hwFit*0.20 + maturity*0.15 + generation*0.10 + category*0.13 + speed*0.07. Validace = lokální syntetický test (TTL 14d).'));
}
/* ═══════════════════════════════════════════════════════════
   v133: MODEL OVERVIEW + ROLES TABS
   ═══════════════════════════════════════════════════════════ */
function _renderOverviewTab(){
  if(_modelOverviewLoading&&!_modelOverview)return h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Na\u010D\u00EDt\u00E1m p\u0159ehled...');
  if(!_modelOverview)return h('div',{style:{color:C.tx4,padding:20,textAlign:'center'}},'Nelze na\u010D\u00EDst p\u0159ehled model\u016F');
  var ov=_modelOverview;var mods=ov.models||[];
  var du=ov.diskUsage||{};var ac=ov.autoCleanup||{enabled:false,days:14};
  /* Sort */
  var sorted=mods.slice().sort(function(a,b){
    var c=_overviewSort.col;var d=_overviewSort.dir==='asc'?1:-1;
    if(c==='name')return a.name.localeCompare(b.name)*d;
    if(c==='size')return((a.size||0)-(b.size||0))*d;
    if(c==='score')return((a.overallScore||0)-(b.overallScore||0))*d;
    if(c==='roles')return((a.boundRoles||[]).length-(b.boundRoles||[]).length)*d;
    return 0;
  });
  function sortBtn(col,label){
    var active=_overviewSort.col===col;
    return h('th',{style:{padding:'6px 8px',textAlign:col==='name'?'left':'right',cursor:'pointer',fontSize:_fs(10),fontWeight:600,color:active?C.accent:C.tx3,
      background:active?'rgba(34,197,94,0.05)':'transparent',borderBottom:'2px solid '+(active?C.accent:C.border),userSelect:'none'},
      onClick:function(){if(_overviewSort.col===col)_overviewSort.dir=_overviewSort.dir==='asc'?'desc':'asc';
        else{_overviewSort.col=col;_overviewSort.dir=col==='size'||col==='score'?'desc':'asc';}renderCenter();}},
      label+(active?(_overviewSort.dir==='asc'?' \u25B2':' \u25BC'):''));
  }
  var delCount=mods.filter(function(m){return m.isDeletable;}).length;
  var totalFreedGB=mods.filter(function(m){return m.isDeletable;}).reduce(function(s,m){return s+parseFloat(m.sizeGB||0);},0).toFixed(1);
  return h('div',null,
    /* Stats line */
    h('div',{style:{display:'flex',gap:16,flexWrap:'wrap',marginBottom:12,fontSize:_fs(10),color:C.tx3}},
      h('span',null,mods.length+' model\u016F'),
      h('span',null,du.totalGB+' GB celkem'),
      delCount>0?h('span',null,delCount+' nepou\u017E\u00EDvan\u00FDch'):null,
      h('span',null,'Voln\u00E9 m\u00EDsto: '+(du.freeGB||'?')+' GB')),
    /* Action bar */
    h('div',{style:{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}},
      h('button',{style:{padding:'6px 14px',borderRadius:6,border:'1px solid rgba(59,130,246,0.3)',
        background:_batchValidating?'rgba(59,130,246,0.05)':'rgba(59,130,246,0.1)',color:'#3b82f6',fontSize:_fs(11),
        fontWeight:600,cursor:_batchValidating?'default':'pointer',fontFamily:C.font,opacity:_batchValidating?0.6:1},
        disabled:_batchValidating,onClick:_batchValidateAll},
        _batchValidating?'Validuji...':'Validovat v\u0161e'+(ov.unvalidatedCount>0?' ('+ov.unvalidatedCount+')':'')),
      delCount>0?h('button',{style:{padding:'6px 14px',borderRadius:6,border:'1px solid rgba(239,68,68,0.3)',
        background:'rgba(239,68,68,0.1)',color:'#ef4444',fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
        onClick:function(){/* Delete all unused one by one */
          var del=mods.filter(function(m){return m.isDeletable;});
          if(del.length===0)return;
          _deleteConfirm={model:'__bulk__',sizeGB:totalFreedGB,count:del.length,names:del.map(function(m){return m.name;})};renderCenter();}},
        'Smazat nepou\u017E\u00EDvan\u00E9 ('+delCount+', '+totalFreedGB+' GB)'):null,
      h('button',{style:{padding:'6px 14px',borderRadius:6,border:'1px solid '+C.border2,background:'transparent',
        color:C.tx3,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
        onClick:function(){_modelOverview=null;_loadModelOverview();}},'\u21BB Obnovit')),
    /* Batch progress */
    _batchValidating&&_batchCurrent?h('div',{style:{padding:'8px 12px',borderRadius:6,marginBottom:12,
      background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',fontSize:_fs(11),color:'#3b82f6'}},
      'Validuji: '+_batchCurrent+(_validationProgress?' \u2014 '+_validationProgress.text:'...')):null,
    /* Delete confirm */
    _deleteConfirm?h('div',{style:{padding:'10px 14px',borderRadius:8,marginBottom:12,
      background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',display:'flex',alignItems:'center',gap:10}},
      h('span',{style:{flex:1,fontSize:_fs(11),color:'#ef4444'}},
        _deleteConfirm.model==='__bulk__'
          ?'Smazat '+_deleteConfirm.count+' nepou\u017E\u00EDvan\u00FDch model\u016F? Uvoln\u00ED '+_deleteConfirm.sizeGB+' GB'
          :'Smazat '+_deleteConfirm.model+'? Uvoln\u00ED '+_deleteConfirm.sizeGB+' GB'),
      h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid #ef4444',background:'#ef4444',color:'#fff',
        cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
        onClick:function(){if(_deleteConfirm.model==='__bulk__'){
          var names=_deleteConfirm.names||[];_deleteConfirm=null;
          names.forEach(function(n){_deleteModel(n);});}
          else{_deleteModel(_deleteConfirm.model);}}},_deletingModel?'Ma\u017Eu...':'Smazat'),
      h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',background:'transparent',
        color:'#ef4444',cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
        onClick:function(){_deleteConfirm=null;renderCenter();}},'Zru\u0161it')):null,
    /* Table */
    h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:_fs(10)}},
      h('thead',null,h('tr',null,
        sortBtn('name','Model'),
        h('th',{style:{padding:'6px 8px',textAlign:'right',fontSize:_fs(10),fontWeight:600,color:C.tx3,borderBottom:'2px solid '+C.border}},'Kv.'),
        sortBtn('size','Velikost'),
        sortBtn('roles','Role'),
        sortBtn('score','Validace'),
        h('th',{style:{padding:'6px 8px',textAlign:'center',fontSize:_fs(10),fontWeight:600,color:C.tx3,borderBottom:'2px solid '+C.border}},'Akce'))),
      h('tbody',null,sorted.map(function(m){
        var scorePct=m.overallScore!=null?Math.round(m.overallScore*100)+'%':'\u2014';
        var scoreColor=m.overallScore==null?C.tx4:m.overallScore>=0.7?C.accent:m.overallScore>=0.4?'#eab308':'#ef4444';
        var validBtn=m.unvalidatedSuites&&m.unvalidatedSuites.length>0&&!_validatingModel;
        return h('tr',{key:m.name,style:{borderBottom:'1px solid '+C.border}},
          h('td',{style:{padding:'6px 8px',color:C.tx1,fontFamily:C.mono,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},
            m.name,
            h('div',{style:{fontSize:_fs(9),color:C.tx4}},m.params)),
          h('td',{style:{padding:'6px 8px',textAlign:'right',color:C.tx4,fontSize:_fs(9)}},m.quantization||'?'),
          h('td',{style:{padding:'6px 8px',textAlign:'right',color:C.tx2}},m.sizeGB+' GB'),
          h('td',{style:{padding:'6px 8px',textAlign:'right'}},
            m.boundRoles.length>0?m.boundRoles.map(function(r){
              var rp={D1:'#8b5cf6',D2:'#a78bfa',CODE:'#22c55e',R1:'#6366f1',R2:'#818cf8',CHAT:'#3b82f6',VISION:'#f59e0b'};
              return h('span',{key:r,style:{display:'inline-block',padding:'1px 5px',borderRadius:3,fontSize:_fs(9),fontWeight:600,
                background:'rgba(0,0,0,0.15)',color:rp[r]||C.tx3,marginLeft:2}},r);
            }):h('span',{style:{color:C.tx4}},'\u2014')),
          h('td',{style:{padding:'6px 8px',textAlign:'right'}},
            h('span',{style:{fontWeight:600,color:scoreColor}},scorePct),
            validBtn?h('button',{style:{marginLeft:4,padding:'1px 6px',borderRadius:3,border:'1px solid rgba(59,130,246,0.3)',
              background:'rgba(59,130,246,0.1)',color:'#3b82f6',fontSize:_fs(9),cursor:'pointer',fontFamily:C.font},
              onClick:function(){_validateModel(m.name);}},'\u25B6'):null),
          h('td',{style:{padding:'6px 8px',textAlign:'center'}},
            m.isDeletable?h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',
              background:'rgba(239,68,68,0.06)',color:'#ef4444',fontSize:_fs(10),cursor:'pointer',fontFamily:C.font},
              disabled:!!_deletingModel,title:'Smazat model',
              onClick:function(){_deleteConfirm={model:m.name,sizeGB:m.sizeGB};renderCenter();}},'\uD83D\uDDD1'):
              h('span',{style:{fontSize:_fs(9),color:C.tx4},title:m.deletableReason||''},'\u2014')));
      }))),
    /* Ollama offline warning */
    !ov.ollamaAvailable?h('div',{style:{marginTop:16,padding:'10px 14px',borderRadius:6,
      background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',color:'#ef4444',fontSize:_fs(11)}},
      'Ollama nedostupn\u00E1 \u2014 nelze na\u010D\u00EDst modely'):null);
}
function _renderRolesTab(){
  if(_modelOverviewLoading&&!_modelOverview)return h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Na\u010D\u00EDt\u00E1m...');
  var ov=_modelOverview||{};var bindings=ov.bindings||_roleBindings||{};
  var profiles=ov.profiles||{D1:{name:'Hlubok\u00E1 anal\u00FDza',desc:'Anal\u00FDza, pl\u00E1nov\u00E1n\u00ED, redesign.',suite:'reasoning',color:'#8b5cf6'},
    D2:{name:'Anal\u00FDza oprav',desc:'Fokusovan\u00FD reasoning pro opravy.',suite:'reasoning',color:'#a78bfa'},
    CODE:{name:'Generov\u00E1n\u00ED k\u00F3du',desc:'Implementace a editace k\u00F3du.',suite:'code',color:'#22c55e'},
    R1:{name:'Hlubok\u00E1 revize',desc:'Fin\u00E1ln\u00ED deep review.',suite:'reasoning',color:'#6366f1'},
    R2:{name:'Rychl\u00E1 revize',desc:'Rychl\u00FD check.',suite:'review',color:'#818cf8'},
    CHAT:{name:'Konverzace',desc:'U\u017Eivatelsk\u00E1 konverzace.',suite:'chat',color:'#3b82f6'},
    VISION:{name:'Anal\u00FDza obr\u00E1zk\u016F',desc:'Porozum\u011Bn\u00ED obr\u00E1zk\u016Fm.',suite:'vision',color:'#f59e0b'}};
  var models=[...new Set((_installedModels||[]).concat(Object.values(bindings)))].filter(Boolean).sort();
  var allScores=ov.models?{}:null;
  if(ov.models)ov.models.forEach(function(m){allScores[m.name]=m.validationScores||{};});
  var roles=Object.keys(profiles);
  return h('div',{style:{display:'flex',flexDirection:'column',gap:12}},
    roles.map(function(role){
      var p=profiles[role];var current=bindings[role]||'?';
      var vs=allScores?allScores[current]||{}:(_validationScores[current]||{});
      var suiteScore=vs[p.suite];var scoreVal=suiteScore&&suiteScore.score!=null?suiteScore.score:null;
      var scorePct=scoreVal!=null?Math.round(scoreVal*100)+'%':'\u2014';
      var scoreColor=scoreVal==null?C.tx4:scoreVal>=0.7?C.accent:scoreVal>=0.4?'#eab308':'#ef4444';
      /* Recommendation */
      var rec=null;if(ov.models){
        var bestScore=-1;var bestModel=null;
        ov.models.forEach(function(m){var ms=m.validationScores||{};var s=ms[p.suite];
          if(s&&s.score!=null&&m.name!==current&&s.score>bestScore){bestScore=s.score;bestModel=m.name;}});
        if(bestModel&&scoreVal!=null&&bestScore>scoreVal){
          rec={model:bestModel,delta:Math.round((bestScore-scoreVal)*100)};
        }
      }
      var installed=models.indexOf(current)>=0;
      return h('div',{key:role,style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:14}},
        /* Header */
        h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:6}},
          h('span',{style:{fontWeight:700,fontSize:_fs(13),color:p.color}},role),
          h('span',{style:{fontSize:_fs(12),fontWeight:600,color:C.tx1}},p.name),
          h('span',{style:{fontSize:_fs(9),padding:'1px 6px',borderRadius:3,background:'rgba(0,0,0,0.1)',color:C.tx4}},p.suite)),
        /* Description */
        h('div',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:8}},p.desc),
        /* Model selector + score */
        h('div',{style:{display:'flex',alignItems:'center',gap:10}},
          h('span',{style:{fontSize:_fs(10),color:C.tx3,minWidth:40}},'Model:'),
          h('select',{style:{flex:1,background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'5px 8px',
            color:C.tx1,fontSize:_fs(11),fontFamily:C.mono,outline:'none',cursor:'pointer',maxWidth:250},
            value:current,
            onChange:function(e){var v=e.target.value;if(v===current)return;_assignModel(role,v);}},
            models.map(function(m){return h('option',{key:m,value:m},m);})),
          _assigningRole===role?h('span',{style:{fontSize:_fs(10),color:C.accent}},'Ukl\u00E1d\u00E1m...'):null,
          h('span',{style:{fontWeight:700,fontSize:_fs(13),color:scoreColor,minWidth:40,textAlign:'right'}},scorePct),
          scoreVal!=null&&scoreVal>=0.7?h('span',{style:{color:C.accent}},'\u2705'):
            scoreVal!=null&&scoreVal<0.4?h('span',{style:{color:'#ef4444'}},'\u26A0'):null),
        /* Warnings */
        !installed?h('div',{style:{marginTop:6,fontSize:_fs(10),color:'#ef4444'}},'\u26A0 Model nen\u00ED nainstalovan\u00FD!'):null,
        scoreVal!=null&&scoreVal<0.5?h('div',{style:{marginTop:4,fontSize:_fs(10),color:'#eab308'}},'\u26A0 Slab\u00FD model pro tuto roli ('+scorePct+')'):null,
        rec?h('div',{style:{marginTop:4,fontSize:_fs(10),color:'rgba(34,197,94,0.8)'}},
          'Lep\u0161\u00ED model dostupn\u00FD: '+rec.model+' (+'+rec.delta+'%)'):null);
    }));
}
function centerUpgrades(){
  if(_upgradeTab==='overview'&&!_modelOverview&&!_modelOverviewLoading)_loadModelOverview();
  if(_upgradeTab==='roles'&&!_modelOverview&&!_modelOverviewLoading)_loadModelOverview();
  if(_upgradeTab==='roles'&&!_installedModels&&!_installedLoading)_loadInstalledModels();
  if(_upgradeTab==='proposals'&&!_upgradeData&&!_upgradeLoading)_loadUpgradeData();
  if(_upgradeTab==='scoring'&&!_scoringData&&!_scoringLoading)_loadScoringData();
  if(_upgradeTab==='scoring'&&!_installedModels&&!_installedLoading)_loadInstalledModels();
  if(_upgradeTab==='discovered'&&!_discoveredData&&!_discoveredLoading)_loadDiscoveredData();
  var proposals=_upgradeData&&_upgradeData.proposals?_upgradeData.proposals:[];
  var history=_upgradeData&&_upgradeData.history?_upgradeData.history:[];
  var discovery=_upgradeData&&_upgradeData.discovery?_upgradeData.discovery:null;
  var lastCheck=_upgradeData&&_upgradeData.lastCheckTime?new Date(_upgradeData.lastCheckTime).toLocaleString('cs-CZ'):null;
  var riskColors={low:'rgba(34,197,94,0.15)',medium:'rgba(234,179,8,0.15)',high:'rgba(239,68,68,0.15)'};
  var riskBorders={low:'rgba(34,197,94,0.3)',medium:'rgba(234,179,8,0.3)',high:'rgba(239,68,68,0.3)'};
  var riskText={low:C.accent,medium:'#eab308',high:'#ef4444'};
  var tabStyle=function(t){return{background:_upgradeTab===t?C.accent:'transparent',color:_upgradeTab===t?'#fff':C.tx3,
    border:'1px solid '+(_upgradeTab===t?C.accent:C.border2),borderRadius:6,padding:'5px 14px',fontSize:_fs(11),
    fontWeight:_upgradeTab===t?600:400,cursor:'pointer',fontFamily:C.font};};
  return h(React.Fragment,null,
    /* header */
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0,gap:10}},
      h('button',{style:{background:'none',border:'none',color:C.tx3,cursor:'pointer',padding:4,borderRadius:4,display:'flex'},
        onClick:function(){_centerState.view='settings';_centerState.settingsSection=1;renderCenter();}},
        svgEl('<path d="M15 18l-6-6 6-6"/>',18)),
      h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},'Modely LLM'),
      lastCheck?h('span',{style:{fontSize:_fs(10),color:C.tx4}},'Kontrola: '+lastCheck):null,
      h('button',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'5px 12px',color:C.tx2,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font,display:'flex',alignItems:'center',gap:4},
        onClick:_upgradeCheck},svgEl('<path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>',14),'Zkontrolovat')),
    /* tab bar */
    h('div',{style:{display:'flex',gap:6,padding:'10px 18px',borderBottom:'1px solid '+C.border,flexWrap:'wrap'}},
      h('button',{style:tabStyle('overview'),onClick:function(){_upgradeTab='overview';renderCenter();}},'P\u0159ehled'),
      h('button',{style:tabStyle('roles'),onClick:function(){_upgradeTab='roles';renderCenter();}},'Role (7)'),
      h('button',{style:tabStyle('scoring'),onClick:function(){_upgradeTab='scoring';renderCenter();}},'Hodnocen\u00ED'),
      h('button',{style:tabStyle('proposals'),onClick:function(){_upgradeTab='proposals';renderCenter();}},'N\u00E1vrhy ('+proposals.length+')'),
      h('button',{style:tabStyle('history'),onClick:function(){_upgradeTab='history';renderCenter();}},'Historie'),
      h('button',{style:tabStyle('discovered'),onClick:function(){_upgradeTab='discovered';renderCenter();}},'Nov\u00E9 modely'),
      h('button',{style:tabStyle('governor'),onClick:function(){_upgradeTab='governor';_governorData=null;_loadGovernorData();renderCenter();}},'Spr\u00E1vce')),
    /* toast */
    _upgradeMsg?h('div',{style:{margin:'0 18px',marginTop:12,padding:'8px 14px',borderRadius:6,fontSize:_fs(11),fontWeight:600,
      background:_upgradeMsg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
      color:_upgradeMsg.ok?C.accent:'#ef4444',
      border:'1px solid '+(_upgradeMsg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_upgradeMsg.text):null,
    _renderUpgradeRecoveries(),
    /* v125: validation prompt */
    _validationPrompt?h('div',{style:{margin:'0 18px',marginTop:8,padding:'10px 14px',borderRadius:6,fontSize:_fs(11),
      background:'rgba(59,130,246,0.1)',color:'#3b82f6',border:'1px solid rgba(59,130,246,0.2)',display:'flex',alignItems:'center',gap:10}},
      h('span',{style:{flex:1}},_validationPrompt.text||'Spustit validaci?'),
      h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid #3b82f6',background:'#3b82f6',color:'#fff',cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){var m=_validationPrompt.model;_validationPrompt=null;_validateModel(m);renderCenter();}},'Spustit'),
      h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid rgba(59,130,246,0.3)',background:'transparent',color:'#3b82f6',cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){_validationPrompt=null;renderCenter();}},'P\u0159eskočit')):null,
    /* body */
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},
      /* ── Overview tab (v133) ── */
      _upgradeTab==='overview'?_renderOverviewTab():null,
      /* ── Roles tab (v133) ── */
      _upgradeTab==='roles'?_renderRolesTab():null,
      /* ── Scoring tab ── */
      _upgradeTab==='scoring'?_renderScoringTab():null,
      /* ── Proposals tab ── */
      _upgradeTab==='proposals'?h('div',null,
        _upgradeLoading&&!_upgradeData?h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Načítám návrhy...'):null,
        _upgradeData&&_upgradeData.error?h('div',{style:{color:'#ef4444',padding:20,textAlign:'center'}},'Chyba: '+_upgradeData.error):null,
        /* discovery info */
        discovery?h('div',{style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:8,padding:12,marginBottom:16,display:'flex',gap:16,flexWrap:'wrap'}},
          h('div',{style:{fontSize:_fs(10),color:C.tx3}},h('span',{style:{fontWeight:600,color:C.tx2}},'Ollama: '),discovery.ollamaAvailable?'dostupný':'nedostupný'),
          h('div',{style:{fontSize:_fs(10),color:C.tx3}},h('span',{style:{fontWeight:600,color:C.tx2}},'Kandidátů: '),discovery.candidateCount||0),
          h('div',{style:{fontSize:_fs(10),color:C.tx3}},h('span',{style:{fontWeight:600,color:C.tx2}},'Hinty: '),discovery.hintsCount||0)):null,
        /* proposals */
        proposals.length>0?h('div',null,
          h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:12}},'Návrhy na upgrade ('+proposals.length+')'),
          proposals.map(function(p,i){
            var risk=p.riskLevel||p.risk_level||'low';
            var improvement=p.improvement!=null?(p.improvement*100).toFixed(1)+'%':p.score?p.score.toFixed(2):'?';
            var bd=p.scoreBreakdown||p.score_breakdown||{};
            var desc=_describeUpgrade(p,bd);
            return h('div',{key:p.id||i,style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:16,marginBottom:12,position:'relative'}},
              /* risk badge */
              h('div',{style:{position:'absolute',top:12,right:14,background:riskColors[risk],border:'1px solid '+riskBorders[risk],borderRadius:4,padding:'2px 8px',fontSize:_fs(9),fontWeight:600,color:riskText[risk]}},risk.toUpperCase()),
              /* role + models */
              h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:8}},
                h('span',{style:{background:C.accent,color:'#fff',borderRadius:4,padding:'2px 8px',fontSize:_fs(10),fontWeight:700}},p.role),
                h('span',{style:{fontSize:_fs(12),color:C.tx2,fontFamily:C.mono}},p.currentModel||p.current_model||'?'),
                h('span',{style:{color:C.tx4,fontSize:_fs(11)}},'\u2192'),
                h('span',{style:{fontSize:_fs(12),color:C.tx1,fontWeight:600,fontFamily:C.mono}},p.candidateModel||p.candidate_model||'?')),
              /* improvement + meta */
              h('div',{style:{display:'flex',gap:16,marginBottom:8,flexWrap:'wrap',alignItems:'center'}},
                h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.accent}},'+'+improvement),
                p.installed!=null?h('div',{style:{fontSize:_fs(10),padding:'1px 6px',borderRadius:4,
                  background:p.installed?'rgba(34,197,94,0.1)':'rgba(234,179,8,0.1)',
                  color:p.installed?C.accent:'#eab308'}},p.installed?'Nainstalován':'Nutný pull'):null,
                p.sizeGB?h('div',{style:{fontSize:_fs(10),color:C.tx4}},p.sizeGB+' GB'):null,
                p.source==='L4'?h('div',{style:{fontSize:_fs(9),padding:'1px 5px',borderRadius:3,background:'rgba(139,92,246,0.1)',color:'#8b5cf6'}},'L4 discovered'):null),
              /* rich description */
              desc.length>0?h('div',{style:{marginBottom:10}},desc.map(function(d,j){
                return h('div',{key:j,style:{display:'flex',gap:6,alignItems:'baseline',marginBottom:3}},
                  h('span',{style:{fontSize:_fs(10),color:d.color||C.tx3}},d.icon||'\u2022'),
                  h('span',{style:{fontSize:_fs(10),color:C.tx2,lineHeight:1.4}},d.text));
              })):null,
              /* actions */
              h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
                h('button',{style:{background:'transparent',color:C.tx4,border:'1px solid '+C.border2,borderRadius:6,padding:'5px 14px',fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
                  onClick:function(){_upgradeDismiss(p.id);}},'Zahodit'),
                h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'5px 14px',fontSize:_fs(11),fontWeight:600,cursor:'pointer',fontFamily:C.font},
                  onClick:function(){_upgradeApply(p.role,p.candidateModel||p.candidate_model);}},'Schválit')));
          })):
          (!_upgradeLoading?h('div',{style:{textAlign:'center',padding:'40px 20px'}},
            h('div',{style:{fontSize:_fs(32),marginBottom:12}},'\u2705'),
            h('div',{style:{fontSize:_fs(13),color:C.tx2,fontWeight:600,marginBottom:4}},'Žádné návrhy na upgrade'),
            h('div',{style:{fontSize:_fs(11),color:C.tx4}},'Všechny modely jsou aktuální. Klikněte na "Zkontrolovat" pro novou analýzu.')):null)):null,
      /* ── History tab ── */
      _upgradeTab==='history'?h('div',null,
        history.length>0?h('div',null,
          h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:10}},'Historie upgradů'),
          history.slice(0,20).map(function(hi,i){
            var ts=hi.timestamp||hi.created_at?new Date(hi.timestamp||hi.created_at).toLocaleString('cs-CZ'):'?';
            var isRollback=hi.action==='rollback';
            return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid '+C.border,fontSize:_fs(11)}},
              h('span',{style:{color:C.tx4,minWidth:120}},ts),
              h('span',{style:{background:isRollback?'rgba(239,68,68,0.1)':'rgba(34,197,94,0.1)',color:isRollback?'#ef4444':C.accent,borderRadius:4,padding:'1px 6px',fontSize:_fs(9),fontWeight:600}},isRollback?'ROLLBACK':'UPGRADE'),
              h('span',{style:{fontWeight:600,color:C.tx2}},hi.role),
              h('span',{style:{color:C.tx3,fontFamily:C.mono}},hi.fromModel||hi.from_model||'?'),
              h('span',{style:{color:C.tx4}},'\u2192'),
              h('span',{style:{color:C.tx1,fontFamily:C.mono}},hi.toModel||hi.to_model||'?'));
          })):
          h('div',{style:{textAlign:'center',padding:'40px 20px',color:C.tx4,fontSize:_fs(12)}},'Žádná historie upgradů')):null,
      /* ── Discovered tab ── */
      _upgradeTab==='discovered'?_renderDiscoveredTab():null,
      /* ── Governor tab (v135) ── */
      _upgradeTab==='governor'?_renderGovernorTab():null));
}
/* ── v135: Governor data loading + rendering ───────────────────────── */
function _loadGovernorData(){
  if(_governorLoading)return;_governorLoading=true;renderCenter();
  var base=_backendBase;
  Promise.all([
    fetch(base+'/api/system/governor/report').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
    fetch(base+'/api/system/governor/proposals').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
  ]).then(function(res){
    _governorData=res[0];_governorProposals=res[1]?res[1].proposals:[];
    _governorLoading=false;renderCenter();
  }).catch(function(){_governorLoading=false;renderCenter();});
}
function _runGovernorCheck(){
  var base=_backendBase;
  fetch(base+'/api/system/governor/check',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.overallHealth){_governorData=d;_governorProposals=null;_loadGovernorData();}
    else{_governorLoading=false;renderCenter();}
  }).catch(function(){_governorLoading=false;renderCenter();});
}
function _approveGovernorProposal(id){
  var base=_backendBase;
  fetch(base+'/api/system/governor/proposals/'+id+'/approve',{method:'POST'}).then(function(){_loadGovernorData();});
}
function _dismissGovernorProposal(id){
  var base=_backendBase;
  fetch(base+'/api/system/governor/proposals/'+id+'/dismiss',{method:'POST'}).then(function(){_loadGovernorData();});
}
function _renderGovernorTab(){
  if(_governorLoading&&!_governorData)return h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Na\u010D\u00EDt\u00E1m data Spr\u00E1vce...');
  var report=_governorData;
  var proposals=_governorProposals||[];
  var healthColor=!report?C.tx4:report.overallHealth==='HEALTHY'?C.accent:report.overallHealth==='DEGRADED'?'#eab308':'#ef4444';
  var healthIcon=!report?'\u2753':report.overallHealth==='HEALTHY'?'\u2705':report.overallHealth==='DEGRADED'?'\u26A0\uFE0F':'\uD83D\uDED1';
  var healthLabel=!report?'Neznámý':report.overallHealth==='HEALTHY'?'V po\u0159\u00E1dku':report.overallHealth==='DEGRADED'?'Zhor\u0161en\u00FD':'Kritick\u00FD';
  var trendArrow=function(d){if(!d)return '';var dir=d.trendDirection;return dir==='improving'?'\u2191':dir==='declining'?'\u2193':'\u2192';};
  var trendColor=function(d){if(!d)return C.tx4;return d.trendDirection==='improving'?C.accent:d.trendDirection==='declining'?'#ef4444':C.tx4;};
  var dimLabel={models:'Modely',cre:'CRE',architecture:'Architektura',builds:'Buildy',specialists:'Specialisti\u0301',upgrades:'Upgrady'};
  var dimIcon={models:'\uD83E\uDD16',cre:'\uD83C\uDFAF',architecture:'\uD83C\uDFD7\uFE0F',builds:'\uD83D\uDD28',specialists:'\uD83D\uDC68\u200D\uD83D\uDD2C',upgrades:'\u2B06\uFE0F'};
  var sevBg=function(s){return s==='HIGH'?'rgba(239,68,68,0.12)':s==='MEDIUM'?'rgba(234,179,8,0.12)':'rgba(59,130,246,0.1)';};
  var sevColor=function(s){return s==='HIGH'?'#ef4444':s==='MEDIUM'?'#eab308':'#3b82f6';};
  return h('div',null,
    /* ── Health Overview ── */
    h('div',{style:{display:'flex',alignItems:'center',gap:12,padding:16,background:C.bg3,borderRadius:8,marginBottom:16,border:'1px solid '+C.border}},
      h('span',{style:{fontSize:28}},healthIcon),
      h('div',{style:{flex:1}},
        h('div',{style:{fontSize:_fs(14),fontWeight:700,color:healthColor}},healthLabel),
        report?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginTop:2}},
          'Sk\u00F3re: '+Math.round(report.overallScore*100)+'%'+(report.summary?' \u2014 '+report.summary:'')):
        h('div',{style:{fontSize:_fs(11),color:C.tx4}},'Dosud nebylo provedeno \u017E\u00E1dn\u00E9 hodnocen\u00ED.')),
      h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'6px 14px',fontSize:_fs(11),fontWeight:600,cursor:'pointer',fontFamily:C.font},
        onClick:_runGovernorCheck},'Zkontrolovat')),
    /* ── Dimension Grid ── */
    report&&report.dimensions?h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}},
      Object.keys(dimLabel).map(function(key){
        var d=report.dimensions[key];if(!d)return null;
        var statusBg=d.status==='HEALTHY'?'rgba(34,197,94,0.08)':d.status==='DEGRADED'?'rgba(234,179,8,0.08)':d.status==='CRITICAL'?'rgba(239,68,68,0.08)':'rgba(100,100,100,0.05)';
        var statusColor=d.status==='HEALTHY'?C.accent:d.status==='DEGRADED'?'#eab308':d.status==='CRITICAL'?'#ef4444':C.tx4;
        return h('div',{key:key,style:{padding:12,background:statusBg,borderRadius:6,border:'1px solid '+C.border}},
          h('div',{style:{display:'flex',alignItems:'center',gap:6,marginBottom:6}},
            h('span',{style:{fontSize:16}},dimIcon[key]||''),
            h('span',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx1}},dimLabel[key]),
            h('span',{style:{fontSize:_fs(9),color:statusColor,fontWeight:600,marginLeft:'auto'}},d.status||'?')),
          h('div',{style:{display:'flex',alignItems:'baseline',gap:6}},
            h('span',{style:{fontSize:_fs(18),fontWeight:700,color:statusColor}},Math.round((d.score||0)*100)+'%'),
            h('span',{style:{fontSize:_fs(14),color:trendColor(d)}},trendArrow(d))),
          typeof d.dataCompleteness==='number'?h('div',{style:{marginTop:4}},
            h('div',{style:{height:3,background:'rgba(255,255,255,0.1)',borderRadius:2}},
              h('div',{style:{height:3,width:Math.round(d.dataCompleteness*100)+'%',background:statusColor,borderRadius:2,transition:'width 0.3s'}}))):null);
      })):null,
    /* ── Proposals ── */
    h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:10,marginTop:6}},'N\u00E1vrhy na zlep\u0161en\u00ED'+(proposals.length?' ('+proposals.length+')':'')),
    proposals.length>0?proposals.map(function(p){
      return h('div',{key:p.id,style:{padding:12,background:C.bg3,borderRadius:6,marginBottom:8,border:'1px solid '+C.border}},
        h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}},
          h('span',{style:{background:sevBg(p.severity),color:sevColor(p.severity),borderRadius:4,padding:'2px 8px',fontSize:_fs(9),fontWeight:700}},p.severity),
          h('span',{style:{fontSize:_fs(12),fontWeight:600,color:C.tx1,flex:1}},p.title),
          h('span',{style:{fontSize:_fs(9),color:C.tx4}},'Jistota: '+Math.round(p.confidence*100)+'%')),
        p.root_cause?h('div',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:4}},'\uD83D\uDD0D '+p.root_cause):null,
        p.description?h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:6}},p.description):null,
        p.suggested_action?h('div',{style:{fontSize:_fs(10),color:'#3b82f6',marginBottom:6}},'\u27A1 '+p.suggested_action):null,
        h('div',{style:{display:'flex',gap:8,justifyContent:'flex-end'}},
          h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid '+C.border,background:'transparent',color:C.tx3,cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
            onClick:function(){_dismissGovernorProposal(p.id);}},'Zam\u00EDtnout'),
          h('button',{style:{padding:'4px 12px',borderRadius:4,border:'none',background:C.accent,color:'#fff',cursor:'pointer',fontSize:_fs(10),fontWeight:600,fontFamily:C.font},
            onClick:function(){_approveGovernorProposal(p.id);}},'Schv\u00E1lit')));
    }):h('div',{style:{textAlign:'center',padding:'30px 20px'}},
      h('div',{style:{fontSize:32,marginBottom:8}},'\u2705'),
      h('div',{style:{fontSize:_fs(12),color:C.tx3}},'Žádné aktivní návrhy.'+(!report?' Klikněte na Zkontrolovat.':''))));
}
if(typeof C3Bus!=='undefined'){C3Bus.on('governor:report',function(){_governorData=null;if(_upgradeTab==='governor')_loadGovernorData();});}
function settingsMemory(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _cfgToggle('Dlouhodobá paměť (LTM)','C3 si pamatuje vaše preference, korekce a poznatky napříč konverzacemi','c3.memory.ltmEnabled',true),
    _cfgToggle('Učení z preferencí','C3 se adaptuje na váš styl komunikace a pracovní postupy','c3.memory.learningEnabled',true),
    _cfgToggle('Detekce zpětné vazby','Automaticky rozpozná pochvalu, kritiku nebo opravu v konverzaci a upraví své chování','c3.memory.feedbackDetection',true),
    _cfgToggle('Sledování vzorců','Rozpoznává opakující se sekvence úloh a navrhuje efektivnější postupy','c3.memory.patternTracking',true),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'10px 0'}}),
    _cfgSlider(_lI('Max turnů','Maximální počet zpráv (uživatel+asistent) v jedné konverzaci před automatickým ořezáním'),'c3.memory.conversationMaxTurns',500,50,5000,50,''),
    _cfgSlider(_lI('Práh kompakce','Když kontext dosáhne tohoto % kapacity, starší zprávy se automaticky zhuštní do shrnutí'),'c3.memory.compactThreshold',0.75,0.3,0.95,0.05,'',null,function(v){return Math.round(v*100)+'%';}),
    _cfgSlider(_lI('Uchované turny','Kolik posledních zpráv zůstane v plném znění při kompakci — starší se zhuštění do shrnutí'),'c3.memory.compactKeepTurns',6,2,20,1,''),
    _cfgSlider(_lI('Max LTM záznamů','Maximální kapacita dlouhodobé paměti. Staré záznamy s nízkou důvěryhodností se automaticky mažou.'),'c3.memory.ltmMaxEntries',1000,100,10000,100,''),
    _cfgSlider(_lI('Poločas LTM','Za kolik dní klesne důvěryhodnost LTM záznamu na 50%. Delší = déle si pamatuje, ale může si pamatovat i neaktuální věci.'),'c3.memory.ltmDecayHalfLife',69,7,365,7,' d'),
    _cfgSlider(_lI('Budget chat','Kolik % kontextového okna se vyhradí pro chat kontext (historii, LTM, systémové instrukce)'),'c3.memory.contextBudgetChat',60,10,90,5,' %'),
    _cfgSlider(_lI('Budget code','Kolik % kontextového okna se vyhradí pro zdrojový kód při generování'),'c3.memory.contextBudgetCode',40,10,90,5,' %'),
    _cfgSlider(_lI('Hard cap','Absolutní limit kontextu v tokenech — ochrana proti přetečení bez ohledu na procentuální budget'),'c3.memory.contextBudgetMaxTokens',24576,2048,65536,1024,'',null,function(v){return v>=1024?Math.round(v/1024)+'K':'v';}));
}
function settingsNotif(){
  return h('div',null,
    h('div',{style:{padding:12,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,marginBottom:10}},
      h('div',{style:{fontSize:_fs(12),fontWeight:700,color:C.tx1}},'In-App'),
      h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:4}},'Jediný podporovaný kanál core 1.0. Oznámení zůstávají uvnitř aplikace.')),
    h('div',{style:{padding:12,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,marginBottom:10}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx2}},'Retained externí kandidáti'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,marginTop:4,lineHeight:'1.5'}},'Desktop, e-mail, Telegram, webhook a push/ntfy jsou pouze operátorsky konfigurované kandidáty. Studio je neovládá a nepotvrzuje jejich doručení.')),
    h('div',{style:{fontSize:_fs(10),color:C.tx4}},'Slack, Discord a SMS nejsou podporované.'));
}
function settingsOutput(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _cfgToggle('Code blocky','Výstup obsahuje formátované bloky se zdrojovým kódem','c3.output.codeBlocks',true),
    _cfgToggle('Syntax highlighting','Zvýrazňování syntaxe v code blocích (barvy dle jazyka)','c3.output.syntaxHighlight',true),
    _cfgToggle('Markdown rendering','Formátování textu — nadpisy, seznamy, tučné písmo, odkazy','c3.output.markdownRendering',true),
    _cfgSlider(_lI('Max délka odpovědi','Maximální počet tokenů v jedné odpovědi. 1 token \u2248 4 znaky českého textu. 8K token \u2248 6 stran textu.'),'c3.output.maxResponseLength',8192,1024,65536,512,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':v+' tok';}));
}
function settingsSystemPanel(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_sysInfo){fetch(_backendBase+'/api/system/info',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=d;renderCenter();}).catch(function(){_sysInfo={error:true};});}
  return h('div',null,
    _settingsToggle('Obnovit poslední relaci','Při startu obnoví poslední otevřený pohled, konverzaci a projekt',_settingsVals.restoreSession,function(nv){_settingsVals.restoreSession=nv;_saveSV();renderCenter();}),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'14px 0'}}),
    _sysInfo&&!_sysInfo.error?h('div',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:12,marginBottom:14}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx1,marginBottom:6}},'Systémové info'),
      h('div',{style:{fontSize:_fs(10),color:C.tx2,lineHeight:'1.8'}},
        h('div',null,'OS: '+(_sysInfo.platform||'?')+' '+(_sysInfo.arch||'')),
        h('div',null,'Node: '+(_sysInfo.node_version||'?')),
        _sysInfo.memory?h('div',null,'RAM: '+_sysInfo.memory.process_mb+' MB / '+_sysInfo.memory.total_mb+' MB'):null,
        h('div',null,'Uptime: '+(_sysInfo.uptime_seconds?Math.round(_sysInfo.uptime_seconds/60)+' min':'?')),
        _sysInfo.config?h('div',null,'Model: '+(_sysInfo.config.chat_model||'?')):null)):null,
    _cfgSelect('Časové pásmo','c3.account.timezone','Europe/Prague',['Europe/Prague','Europe/London','America/New_York','America/Los_Angeles','Asia/Tokyo','UTC']),
    _cfgSelect('Měna','c3.account.currency','CZK',['CZK','EUR','USD','GBP']),
    _cfgSelect(_lI('Log level','Úroveň detailu v serverových logách. Debug = vše, Error = jen chyby.'),'c3.system.logLevel','info',['debug','info','warn','error']),
    _cfgSlider(_lI('Retence logů','Po kolika dnech se automaticky mažou staré logy'),'c3.system.logRetentionDays',30,7,365,7,' d'),
    _cfgSlider(_lI('Max velikost přílohy','Největší soubor který C3 zpracuje jako přílohu (text, kód). Větší soubory budou odmítnuty.'),'c3.system.maxFileSize',1048576,102400,10485760,102400,'',null,function(v){return v>=1048576?Math.round(v/1048576)+' MB':Math.round(v/1024)+' KB';}),
    _cfgSlider(_lI('Rate limit','Maximální počet API požadavků za minutu — ochrana proti přetížení serveru'),'c3.system.rateLimit',120,10,1000,10,' /min'));
}
function settingsStoragePanel(){
  if(!_sysInfo){fetch(_backendBase+'/api/system/info',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=d;renderCenter();}).catch(function(){_sysInfo={error:true};});}
  var db=_sysInfo&&_sysInfo.db?_sysInfo.db:null;
  var tables=db&&db.tables?db.tables:null;
  return h('div',null,
    db?h('div',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:12,marginBottom:14}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx1,marginBottom:8}},'SQLite databáze'),
      h('div',{style:{fontSize:_fs(10),color:C.tx2,lineHeight:'1.8'}},
        h('div',null,'Velikost: '+(db.size_mb||0)+' MB'),
        h('div',null,'Migrace: '+(db.migrations||0))),
      tables?h('div',{style:{marginTop:10}},
        h('div',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2,marginBottom:4}},'Tabulky'),
        h('div',{style:{fontSize:_fs(10),color:C.tx3,lineHeight:'1.8'}},
          Object.keys(tables).map(function(t){return h('div',{key:t,style:{display:'flex',justifyContent:'space-between'}},h('span',null,t),h('span',{style:{fontFamily:C.mono}},tables[t].toLocaleString()+' zázn.'));}))):null):
      h('div',{style:{color:C.tx3,padding:8,fontSize:_fs(11)}},_sysInfo?'Nepodařilo se načíst':'Načítám...'),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'14px 0'}}),
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Údržba'),
    h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:10}},'Optimalizace databáze odstraní fragmentaci a zmenší soubor na disku. Doporučeno po smazání velkého množství dat.'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'8px 12px',color:C.tx1,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font,marginBottom:8},
      onClick:function(){fetch(_backendBase+'/api/system/vacuum',{method:'POST',signal:AbortSignal.timeout(30000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=null;_storageInfo=null;renderCenter();alert(d.message||'Databáze optimalizována');}).catch(function(e){alert('Chyba: '+e.message);});}},'Optimalizovat databázi'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'8px 12px',color:C.tx1,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
      onClick:function(){_sysInfo=null;_storageInfo=null;renderCenter();}},'Aktualizovat info'));
}
function settingsBackupPanel(){
  return h('div',null,
    h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:14}},'Přeneste podporované UI předvolby a modelovou automatizační policy. Tajemství, soukromé údaje a lokální cíle zůstávají pouze v této instalaci.'),
    _backupMsg?h('div',{style:{padding:'8px 12px',borderRadius:6,marginBottom:10,fontSize:_fs(11),fontWeight:600,background:_backupMsg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',color:_backupMsg.ok?C.accent:'#ef4444',border:'1px solid '+(_backupMsg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_backupMsg.text):null,
    h('button',{style:{width:'100%',background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'10px 14px',fontSize:_fs(12),fontWeight:600,cursor:'pointer',marginBottom:10,fontFamily:C.font},
      onClick:function(){_settingsExportBackup();}},'Exportovat přenosné předvolby'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'10px 14px',fontSize:_fs(12),cursor:'pointer',color:C.tx1,marginBottom:10,fontFamily:C.font},
      onClick:function(){
        var inp=document.createElement('input');inp.type='file';inp.accept='.json';
        inp.onchange=function(e){var f=e.target.files[0];if(!f)return;
          var reader=new FileReader();reader.onload=function(ev){try{var data=JSON.parse(ev.target.result);_settingsImportDocument(data,f.name);}catch(ex){_settingsResult(false,'Neplatný JSON soubor');}};
          reader.onerror=function(){_settingsResult(false,'Soubor se nepodařilo přečíst');};reader.onabort=function(){_settingsResult(false,'Čtení souboru bylo zrušeno');};reader.readAsText(f);};inp.click();}},'Importovat přenosné předvolby'),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,marginTop:8}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:4}},'Reset'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:8}},'Resetuje pouze serverová nastavení a modelovou automatizaci. Lokální rozložení a relace zůstanou zachované.'),
      h('button',{style:{width:'100%',background:'transparent',border:'1px solid #ef4444',borderRadius:6,padding:'8px 14px',fontSize:_fs(11),cursor:'pointer',color:'#ef4444',fontFamily:C.font},
        onClick:function(){if(!confirm('Opravdu resetovat serverová nastavení? Lokální data zůstanou zachovaná.'))return;
          _settingsResetAll();}},'Resetovat serverová nastavení')));
}
/* v91: Feature Flags panel */
var _FF_META=[
  {key:'agents',label:'Workeri',desc:'Autonomní agenti a monitorování',critical:true},
  {key:'lifecycle',label:'Projekty',desc:'Lifecycle engine (SPEC→BUILD→REVIEW)',critical:true},
  {key:'expertises',label:'Expertízy',desc:'Doménové expertízy a merge engine',critical:true},
  {key:'telemetry',label:'Telemetrie',desc:'Resilience telemetrie a metriky',critical:false},
  {key:'specialistTelemetry',label:'Specialist Telemetry',desc:'Pasivní observabilita specialistů',critical:false},
  {key:'autonomy',label:'Autonomie',desc:'Guarded autonomy — self-tuning CRE',critical:false},
  {key:'skills',label:'Skilly',desc:'Automatické makro-recepty',critical:false}
];
function settingsFeatureFlags(){
  if(!_featureFlags&&!_ffLoading)_loadFeatureFlags();
  if(!_featureFlags)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  var warnStyle={fontSize:_fs(9),color:'#e8a735',marginTop:3,display:'flex',alignItems:'center',gap:4};
  return h('div',null,
    h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:12,lineHeight:1.4}},
      'Runtime přepínače subsystémů. Změny jsou okamžité a platí do restartu serveru.'),
    _FF_META.map(function(ff){
      var val=!!_featureFlags[ff.key];
      return h('div',{key:ff.key,style:{marginBottom:2}},
        _settingsToggle(ff.label,ff.desc,val,function(nv){_toggleFeatureFlag(ff.key,nv);}),
        ff.critical&&val?null:ff.critical?h('div',{style:warnStyle},'⚠ ','Subsystém vypnut — některé funkce nebudou dostupné.'):null);
    }),
    h('div',{style:{marginTop:16,paddingTop:12,borderTop:'1px solid '+C.border}},
      h('button',{style:{background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:6,padding:'6px 14px',cursor:'pointer',fontSize:_fs(11)},
        onClick:function(){_resetFeatureFlags();}},'Obnovit výchozí')));
}
/* v91: Security panel */
function _secFetch(path,opts){return fetch(_backendBase+path,Object.assign({signal:AbortSignal.timeout(5000)},opts||{}));}
function _secLoadTokens(){_secLoading.tokens=true;_secFetch('/api/security/tokens').then(function(r){return r.json();}).then(function(d){_secTokens=d.tokens||[];_secLoading.tokens=false;renderCenter();}).catch(function(){_secLoading.tokens=false;});}
function _secLoadAudit(type){_secAuditType=type||'all';_secLoading.audit=true;_secFetch('/api/security/audit?type='+encodeURIComponent(_secAuditType)+'&limit=50').then(function(r){return r.json();}).then(function(d){_secAudit=d.results||{};_secLoading.audit=false;renderCenter();}).catch(function(){_secLoading.audit=false;});}
function _secWebhookStatus(value){
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('WEBHOOK_STATUS_INVALID');
  var keys=Object.keys(value).sort();
  if(keys.length!==2||keys[0]!=='configured'||keys[1]!=='source')throw new Error('WEBHOOK_STATUS_INVALID');
  if(typeof value.configured!=='boolean')throw new Error('WEBHOOK_STATUS_INVALID');
  if(value.source!=='PROCESS_ENV'&&value.source!=='ROOT_ENV_FILE')throw new Error('WEBHOOK_STATUS_INVALID');
  return {phase:'READY',configured:value.configured,source:value.source};
}
function _secLoadWebhook(){
  if(_secWebhook.phase==='LOADING'||_secWebhook.phase==='READY')return Promise.resolve(false);
  _secWebhook={phase:'LOADING'};
  return Promise.resolve().then(function(){return _secFetch('/api/security/webhook-secret');}).then(function(r){
    if(!r||r.ok!==true||r.status!==200)throw new Error('WEBHOOK_STATUS_UNAVAILABLE');
    return r.json();
  }).then(function(d){_secWebhook=_secWebhookStatus(d);renderCenter();return true;}).catch(function(){
    _secWebhook={phase:'ERROR'};renderCenter();return false;
  });
}
function _secLoadSessions(){_secFetch('/api/security/sessions').then(function(r){return r.json();}).then(function(d){_secSessions=d;renderCenter();}).catch(function(){});}
function settingsSecurityPanel(){
  if(!_secTokens&&!_secLoading.tokens)_secLoadTokens();
  if(!_secAudit&&!_secLoading.audit)_secLoadAudit('all');
  if(_secWebhook.phase==='IDLE')_secLoadWebhook();
  if(!_secSessions)_secLoadSessions();
  var secH={fontSize:_fs(12),fontWeight:600,color:C.tx2,marginTop:14,marginBottom:6};
  var secSub={fontSize:_fs(10),color:C.tx4,marginBottom:8};
  /* ── Audit Log ── */
  var auditTabs=['all','cre','merge','drift','llm'];
  var auditTabRow=h('div',{style:{display:'flex',gap:4,marginBottom:8,flexWrap:'wrap'}},auditTabs.map(function(t){
    var active=_secAuditType===t;
    return h('button',{key:t,style:{padding:'3px 8px',fontSize:_fs(10),border:'1px solid '+(active?C.accent:C.border),borderRadius:4,background:active?C.accent:'transparent',color:active?'#fff':C.tx3,cursor:'pointer'},
      onClick:function(){_secLoadAudit(t);}},t.toUpperCase());
  }));
  var auditRows=[];
  if(_secAudit){
    var entries=[];
    Object.keys(_secAudit).forEach(function(k){(_secAudit[k]||[]).forEach(function(e){entries.push(Object.assign({_type:k},e));});});
    entries.sort(function(a,b){return(b.created_at||'').localeCompare(a.created_at||'');});
    entries.slice(0,50).forEach(function(e,i){
      var ts=e.created_at?new Date(e.created_at).toLocaleString('cs-CZ'):'?';
      var preview=e.input_preview||e.intent||e.capability||e.model||JSON.stringify(e).substring(0,80);
      auditRows.push(h('div',{key:i,style:{padding:'4px 0',borderBottom:'1px solid '+C.border,fontSize:_fs(10),color:C.tx3}},
        h('span',{style:{color:C.tx4,marginRight:6}},ts),
        h('span',{style:{background:C.bg4,borderRadius:3,padding:'1px 4px',marginRight:4,fontSize:_fs(9)}},e._type),
        h('span',null,preview)));
    });
  }
  /* ── API Tokens ── */
  var tokenRows=[];
  if(_secTokens){_secTokens.forEach(function(t,i){
    var lastUsed=t.last_used_at?new Date(t.last_used_at).toLocaleString('cs-CZ'):'nikdy';
    var expires=t.expires_at?new Date(t.expires_at).toLocaleString('cs-CZ'):'∞';
    tokenRows.push(h('div',{key:t.id,style:{padding:'6px 0',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:6}},
      h('div',{style:{flex:1}},
        h('div',{style:{fontSize:_fs(11),color:C.tx1,fontWeight:500}},t.name),
        h('div',{style:{fontSize:_fs(9),color:C.tx4}},'Použit: '+lastUsed+' | Expiruje: '+expires)),
      h('button',{style:{background:'#c0392b',color:'#fff',border:'none',borderRadius:4,padding:'3px 8px',cursor:'pointer',fontSize:_fs(9)},
        onClick:function(){if(!confirm('Odvolat token "'+t.name+'"?'))return;_secFetch('/api/security/tokens/'+t.id,{method:'DELETE'}).then(function(){_secLoadTokens();}).catch(function(){});}},
        'Odvolat')));
  });}
  /* ── New Token Created ── */
  var newTokenBanner=null;
  if(_secNewToken){
    newTokenBanner=h('div',{style:{background:'rgba(34,197,94,0.1)',border:'1px solid '+C.accent,borderRadius:6,padding:10,marginBottom:10}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.accent,marginBottom:4}},'Token vytvořen — zkopírujte nyní (zobrazí se jen jednou):'),
      h('div',{style:{fontFamily:C.mono,fontSize:_fs(10),color:C.tx1,wordBreak:'break-all',userSelect:'all',marginBottom:6}},_secNewToken),
      h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:4,padding:'4px 10px',cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){navigator.clipboard.writeText(_secNewToken);_secNewToken=null;renderCenter();}},'Kopírovat & zavřít'));
  }
  /* ── Webhook ── */
  var webhookInfo=null;
  if(_secWebhook.phase==='READY'){
    var webhookSource=_secWebhook.source==='PROCESS_ENV'
      ?'Procesní prostředí (PROCESS_ENV)'
      :'Kořenový .env soubor (ROOT_ENV_FILE)';
    webhookInfo=h('div',{style:{fontSize:_fs(10),color:C.tx3,lineHeight:1.5}},
      h('div',null,'Stav: '+(_secWebhook.configured?'Nastaven':'Nenastaven')),
      h('div',null,'Zdroj: '+webhookSource),
      h('div',{style:{color:C.tx4,marginTop:4}},'Secret spravuje operátor v prostředí. Změna se projeví až po restartu serveru.'));
  }else if(_secWebhook.phase==='ERROR'){
    webhookInfo=h('div',{style:{fontSize:_fs(10),color:'#ef4444'}},'Stav webhook secretu není dostupný.');
  }
  /* ── Sessions ── */
  var sessInfo=_secSessions?h('div',{style:{fontSize:_fs(10),color:C.tx3}},'Aktivní relace: '+_secSessions.count+' | Uptime: '+Math.round((_secSessions.uptime_seconds||0)/60)+' min'):null;
  return h('div',null,
    h('div',{style:secH},'Audit Log'),h('div',{style:secSub},'Záznamy z CRE, merge, drift a LLM'),
    auditTabRow,
    _secLoading.audit?h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Načítám...'):
      auditRows.length>0?h('div',{style:{maxHeight:200,overflowY:'auto'}},auditRows):h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Žádné záznamy.'),
    h('div',{style:secH},'API Tokeny'),h('div',{style:secSub},'Přístupové tokeny pro API'),
    newTokenBanner,
    _secLoading.tokens?h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Načítám...'):
      tokenRows.length>0?h('div',null,tokenRows):h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Žádné tokeny.'),
    h('button',{style:{marginTop:6,background:C.accent,color:'#fff',border:'none',borderRadius:4,padding:'4px 12px',cursor:'pointer',fontSize:_fs(10)},
      onClick:function(){var name=prompt('Název nového tokenu:');if(!name)return;_secFetch('/api/security/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(function(r){return r.json();}).then(function(d){if(d.token){_secNewToken=d.token;_secLoadTokens();}}).catch(function(){});}},'Vytvořit nový token'),
    h('div',{style:secH},'Webhook Secret'),h('div',{style:secSub},'HMAC podpis pro webhook notifikace'),
    webhookInfo||h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Načítám...'),
    h('div',{style:secH},'Aktivní relace'),
    sessInfo||h('div',{style:{color:C.tx4,fontSize:_fs(10)}},'Načítám...'));
}
function _fbGetLastAssistant(){
  var msgs=_ts&&_ts.chat&&_ts.chat.msgs;if(!msgs)return null;
  for(var i=msgs.length-1;i>=0;i--){if(msgs[i].role==='assistant')return msgs[i].text;}
  return null;
}
function _fbCollectContext(){
  var ctx={};
  try{ctx.chatModel=_bVal('c3.llm.chatModel',null);}catch(_){}
  try{ctx.codeModel=_bVal('c3.llm.codeModel',null);}catch(_){}
  try{ctx.wsConnected=_serverHealth.wsConnected||false;}catch(_){}
  var msgs=_ts&&_ts.chat&&_ts.chat.msgs;
  if(msgs){for(var i=msgs.length-1;i>=0;i--){if(msgs[i].tag){ctx.lastIntent=msgs[i].tag;break;}}}
  try{ctx.featureFlags=_featureFlags||null;}catch(_){}
  return ctx;
}
function _fbReadFile(file){
  return new Promise(function(resolve,reject){
    if(file.size>2*1024*1024){reject(new Error('File too large'));return;}
    var reader=new FileReader();
    reader.onload=function(){
      var base64=reader.result.split(',')[1]||'';
      resolve({name:file.name,type:file.type||'application/octet-stream',data:base64,size:file.size});
    };
    reader.onerror=function(){reject(reader.error);};
    reader.readAsDataURL(file);
  });
}
function _fbUploadAttachments(feedbackId,files){
  var chain=Promise.resolve();
  files.forEach(function(f){
    chain=chain.then(function(){
      return fetch(_backendBase+'/api/feedback/'+feedbackId+'/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,type:f.type,data:f.data})}).then(function(r){return r.json();});
    });
  });
  return chain;
}
function _fbRemoveFile(idx){_fbFiles.splice(idx,1);renderCenter();}
function _fbFormatSize(bytes){
  if(bytes<1024)return bytes+' B';
  if(bytes<1024*1024)return (bytes/1024).toFixed(1)+' KB';
  return (bytes/(1024*1024)).toFixed(1)+' MB';
}
function settingsAboutPanel(){
  var catOpts=[{v:'bug',l:'Bug'},{v:'performance',l:'V\u00fdkon (pomal\u00e9)'},{v:'ux',l:'UX probl\u00e9m'},{v:'feature',l:'N\u00e1pad / Feature'},{v:'other',l:'Jin\u00e9'}];
  var selStyle={background:C.bg3,color:C.tx1,border:'1px solid '+C.border,borderRadius:4,padding:'4px 8px',fontSize:_fs(11),width:'100%'};
  var taStyle={background:C.bg3,color:C.tx1,border:'1px solid '+C.border,borderRadius:6,padding:'8px 10px',fontSize:_fs(11),width:'100%',minHeight:80,resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'};
  var charsLeft=2000-(_fbMessage||'').length;
  var cooldownActive=_fbCooldown>Date.now();
  var btnDisabled=_fbSending||cooldownActive;
  var totalSize=0;_fbFiles.forEach(function(f){totalSize+=f.size||0;});
  var fileListEls=_fbFiles.map(function(f,i){
    var isImg=f.type&&f.type.indexOf('image/')===0;
    return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:6,padding:'4px 0',borderBottom:'1px solid '+C.border}},
      isImg?h('div',{style:{width:24,height:24,borderRadius:3,background:'#333',backgroundImage:'url(data:'+f.type+';base64,'+f.data+')',backgroundSize:'cover',flexShrink:0}}):
        h('div',{style:{width:24,height:24,borderRadius:3,background:C.bg4,display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(9),flexShrink:0}},'\ud83d\udcc4'),
      h('div',{style:{flex:1,fontSize:_fs(9),color:C.tx2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},f.name),
      h('div',{style:{fontSize:_fs(8),color:C.tx4,flexShrink:0}},_fbFormatSize(f.size)),
      h('button',{style:{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:_fs(10),padding:'0 4px',flexShrink:0},onClick:function(){_fbRemoveFile(i);}},'\u00d7'));
  });
  return h('div',{style:{padding:'30px 0'}},
    h('div',{style:{textAlign:'center'}},
      h('div',{style:{width:64,height:64,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:18,display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:_fs(26),color:'#fff',marginBottom:14}},'C3'),
      h('div',{style:{fontSize:_fs(17),fontWeight:700,color:C.tx1,marginBottom:4}},'C3 Studio'),
      h('div',{style:{fontSize:_fs(13),color:C.accent,fontWeight:600,marginBottom:16}},'v'+(_serverHealth.version||'...')),
      h('div',{style:{fontSize:_fs(11),color:C.tx4,marginBottom:20}},'Made with \u2764\ufe0f by Belfik')),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:16,marginBottom:20,textAlign:'center'}},
      h('button',{style:{background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:6,padding:'6px 14px',cursor:'pointer',fontSize:_fs(11)},
        onClick:function(){try{localStorage.removeItem('c3.onboarding.completed');}catch(_){}renderCenter();}},'Spustit pr\u016fvodce prvn\u00edm spu\u0161t\u011bn\u00edm')),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:16}},
      h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:4}},'Zp\u011btn\u00e1 vazba'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:12}},'Napi\u0161 n\u00e1m co funguje, co ne, nebo co bys cht\u011bl/a p\u0159idat. Runtime kontext se p\u0159ilo\u017e\u00ed automaticky.'),
      h('div',{style:{marginBottom:8}},
        h('label',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:2,display:'block'}},'Kategorie'),
        h('select',{style:selStyle,value:_fbCategory,onChange:function(e){_fbCategory=e.target.value;renderCenter();}},
          catOpts.map(function(o){return h('option',{key:o.v,value:o.v},o.l);}))),
      h('div',{style:{marginBottom:4}},
        h('label',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:2,display:'block'}},'Zpr\u00e1va'),
        h('textarea',{style:taStyle,value:_fbMessage,maxLength:2000,placeholder:'Co bys vylep\u0161il/a? Na\u0161el/\u0161la jsi chybu?',onChange:function(e){_fbMessage=e.target.value;renderCenter();}})),
      h('div',{style:{fontSize:_fs(9),color:charsLeft<200?'#f59e0b':C.tx4,marginBottom:8,textAlign:'right'}},charsLeft+' / 2000'),
      h('label',{style:{display:'flex',alignItems:'center',gap:6,fontSize:_fs(10),color:C.tx3,marginBottom:6,cursor:'pointer'}},
        h('input',{type:'checkbox',checked:_fbAttachLast,onChange:function(){_fbAttachLast=!_fbAttachLast;renderCenter();}}),
        'P\u0159ilo\u017eit posledn\u00ed odpov\u011b\u010f asistenta'),
      h('label',{style:{display:'flex',alignItems:'center',gap:6,fontSize:_fs(10),color:C.tx3,marginBottom:10,cursor:'pointer'}},
        h('input',{type:'checkbox',checked:_fbAttachLogs,onChange:function(){_fbAttachLogs=!_fbAttachLogs;renderCenter();}}),
        'P\u0159ilo\u017eit serverov\u00e9 logy'),
      h('div',{style:{marginBottom:10}},
        h('div',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:4}},'P\u0159\u00edlohy (screenshoty, soubory)'),
        h('div',{style:{display:'flex',gap:6,marginBottom:6}},
          h('button',{style:{background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:4,padding:'4px 10px',cursor:'pointer',fontSize:_fs(10)},
            onClick:function(){
              var inp=document.createElement('input');inp.type='file';inp.accept='image/*,.png,.jpg,.jpeg,.gif,.webp,.log,.txt';inp.multiple=true;
              inp.onchange=function(){
                var promises=[];
                for(var i=0;i<inp.files.length;i++){promises.push(_fbReadFile(inp.files[i]));}
                Promise.all(promises).then(function(results){
                  results.forEach(function(r){if(totalSize+r.size<=5*1024*1024){_fbFiles.push(r);totalSize+=r.size;}});
                  renderCenter();
                }).catch(function(){});
              };
              inp.click();
            }},'\ud83d\udcce P\u0159idat soubor'),
          h('button',{style:{background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:4,padding:'4px 10px',cursor:'pointer',fontSize:_fs(10)},
            onClick:function(){
              if(!navigator.clipboard||!navigator.clipboard.read)return;
              navigator.clipboard.read().then(function(items){
                for(var i=0;i<items.length;i++){
                  var types=items[i].types||[];
                  for(var t=0;t<types.length;t++){
                    if(types[t].indexOf('image/')===0){
                      items[i].getType(types[t]).then(function(blob){
                        _fbReadFile(new File([blob],'screenshot_'+Date.now()+'.png',{type:blob.type})).then(function(r){
                          if(totalSize+r.size<=5*1024*1024){_fbFiles.push(r);renderCenter();}
                        });
                      });
                      return;
                    }
                  }
                }
              }).catch(function(){});
            }},'\ud83d\udccb Vlo\u017eit ze schr\u00e1nky')),
        _fbFiles.length>0?h('div',{style:{border:'1px solid '+C.border,borderRadius:6,padding:6,marginBottom:4}},fileListEls,
          h('div',{style:{fontSize:_fs(8),color:C.tx4,marginTop:4,textAlign:'right'}},_fbFiles.length+' soubor'+(_fbFiles.length>1?'\u016f':'')+' \u2022 '+_fbFormatSize(totalSize)+' / 5 MB')):null),
      _fbSent?h('div',{style:{color:'#22c55e',fontSize:_fs(11),fontWeight:600,marginBottom:8}},'D\u011bkujeme za zp\u011btnou vazbu!'):null,
      cooldownActive?h('div',{style:{color:'#f59e0b',fontSize:_fs(10),marginBottom:8}},'Po\u010dkej 30s p\u0159ed dal\u0161\u00edm odesl\u00e1n\u00edm.'):null,
      h('button',{style:{background:btnDisabled?C.bg4:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'6px 16px',cursor:btnDisabled?'default':'pointer',fontSize:_fs(11),opacity:btnDisabled?0.6:1},disabled:btnDisabled,
        onClick:function(){
          if(!_fbMessage.trim()||btnDisabled)return;
          _fbSending=true;_fbSent=false;renderCenter();
          var payload={category:_fbCategory,message:_fbMessage.trim(),version:_serverHealth.version||null,context:_fbCollectContext()};
          if(_fbAttachLast){var lr=_fbGetLastAssistant();if(lr)payload.lastResponse=lr;}
          /* Step 1: fetch logs if requested */
          var logsPromise=_fbAttachLogs?fetch(_backendBase+'/api/logs/export').then(function(r){return r.text();}).then(function(txt){
            var b64=btoa(unescape(encodeURIComponent(txt)));
            return {name:'server-logs_'+Date.now()+'.log',type:'text/plain',data:b64,size:txt.length};
          }).catch(function(){return null;}):Promise.resolve(null);
          logsPromise.then(function(logFile){
            var allFiles=_fbFiles.slice();
            if(logFile)allFiles.push(logFile);
            /* Step 2: submit feedback */
            return fetch(_backendBase+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(d){
              if(!d.ok){if(d.error&&d.error.indexOf('Too many')>=0){_fbCooldown=Date.now()+30000;}return;}
              var fbId=d.id;
              _fbMessage='';_fbSent=true;_fbCooldown=Date.now()+30000;_fbAttachLast=false;_fbAttachLogs=false;
              /* Step 3: upload attachments */
              if(allFiles.length>0&&fbId){
                _fbUploadAttachments(fbId,allFiles).catch(function(){});
              }
              _fbFiles=[];
            });
          }).catch(function(){}).finally(function(){_fbSending=false;renderCenter();});
        }},_fbSending?'Odes\u00edl\u00e1m...':'Odeslat zp\u011btnou vazbu')));
}

/* ═══════════════════════════════════════════════════════════
   v124: MARKETPLACE — browse / install / update / uninstall
   ═══════════════════════════════════════════════════════════ */
function _loadMarketplaceData(force){
  if(_mpLoading)return;_mpLoading=true;
  var url=_backendBase+'/api/marketplace/catalog?page='+_mpPage+'&limit=50';
  if(force)url=_backendBase+'/api/marketplace/catalog/refresh';
  var opts=force?{method:'POST',signal:AbortSignal.timeout(15000)}:{signal:AbortSignal.timeout(8000)};
  fetch(url,opts)
    .then(function(r){return r.json();})
    .then(function(d){
      if(force){_mpData=null;_mpLoading=false;_loadMarketplaceData();return;}
      _mpData=d;_mpLoading=false;
      var nav=NAV.find(function(n){return n.id==='marketplace';});
      if(nav&&d&&d.items){nav.badge=d.total||d.items.length;}
      renderCenter();
    })
    .catch(function(e){_mpData={error:e.message};_mpLoading=false;renderCenter();});
}
function _mpInstall(type,id){
  /* v124: Confirm dialog with package info */
  var pkg=_mpData&&_mpData.items?_mpData.items.find(function(p){return p.type===type&&p.id===id;}):null;
  var msg='Nainstalovat '+id+' ('+type+')?';
  if(pkg){msg=(pkg.name||id)+' v'+(pkg.version||'?')+' ('+type+')';if(pkg.dependencies&&pkg.dependencies.length)msg+='\nZávislosti: '+pkg.dependencies.join(', ');if(pkg.size)msg+='\nVelikost: '+(pkg.size>1024?(pkg.size/1024).toFixed(1)+' KB':pkg.size+' B');msg+='\n\nNainstalovat?';}
  if(!confirm(msg))return;
  _mpInstalling[type+':'+id]='Stahuji...';_mpMsg=null;renderCenter();
  fetch(_backendBase+'/api/marketplace/install/'+type+'/'+id,{method:'POST',signal:AbortSignal.timeout(120000)})
    .then(function(r){return r.json();})
    .then(function(d){
      delete _mpInstalling[type+':'+id];
      if(d.error){_mpMsg={ok:false,text:d.error};}
      else{_mpMsg={ok:true,text:(d.id||id)+' v'+d.version+' nainstalováno'+(d.deps&&d.deps.length?' (+ '+d.deps.length+' závislostí)':'')+'.'};_mpData=null;}
      renderCenter();if(!_mpData)_loadMarketplaceData();
    })
    .catch(function(e){delete _mpInstalling[type+':'+id];_mpMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function _mpUninstall(type,id){
  if(!confirm('Opravdu odinstalovat '+id+'?'))return;
  _mpInstalling[type+':'+id]='Odinstalace...';_mpMsg=null;renderCenter();
  fetch(_backendBase+'/api/marketplace/installed/'+type+'/'+id,{method:'DELETE',signal:AbortSignal.timeout(15000)})
    .then(function(r){return r.json();})
    .then(function(d){
      delete _mpInstalling[type+':'+id];
      if(d.error){_mpMsg={ok:false,text:d.error};}
      else{_mpMsg={ok:true,text:id+' odinstalováno.'};_mpData=null;}
      renderCenter();if(!_mpData)_loadMarketplaceData();
    })
    .catch(function(e){delete _mpInstalling[type+':'+id];_mpMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function _mpUpdate(type,id){
  _mpInstalling[type+':'+id]='Aktualizuji...';_mpMsg=null;renderCenter();
  fetch(_backendBase+'/api/marketplace/update/'+type+'/'+id,{method:'POST',signal:AbortSignal.timeout(120000)})
    .then(function(r){return r.json();})
    .then(function(d){
      delete _mpInstalling[type+':'+id];
      if(d.error){_mpMsg={ok:false,text:d.error};}
      else{_mpMsg={ok:true,text:id+' aktualizováno na v'+d.version+'.'};_mpData=null;}
      renderCenter();if(!_mpData)_loadMarketplaceData();
    })
    .catch(function(e){delete _mpInstalling[type+':'+id];_mpMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function centerMarketplace(){
  if(!_mpData&&!_mpLoading)_loadMarketplaceData();
  var typeMap={skills:'skill',expertises:'expertise',specialists:'specialist'};
  var tabLabels={skills:'Dovednosti',expertises:'Expertízy',specialists:'Specialisté'};
  var items=_mpData&&_mpData.items?_mpData.items:[];
  /* filter by tab type */
  var typeFilter=typeMap[_mpTab]||'skill';
  var filtered=items.filter(function(p){return p.type===typeFilter;});
  /* client-side search */
  if(_mpSearch){var q=_mpSearch.toLowerCase();filtered=filtered.filter(function(p){return(p.name||'').toLowerCase().indexOf(q)>=0||(p.description||'').toLowerCase().indexOf(q)>=0||(p.tags||[]).join(' ').toLowerCase().indexOf(q)>=0;});}
  /* counts per type */
  var counts={skills:0,expertises:0,specialists:0};
  items.forEach(function(p){var k=p.type==='skill'?'skills':p.type==='expertise'?'expertises':'specialists';counts[k]++;});
  var tabStyle=function(t){return{background:_mpTab===t?C.accent:'transparent',color:_mpTab===t?'#fff':C.tx3,
    border:'1px solid '+(_mpTab===t?C.accent:C.border2),borderRadius:6,padding:'5px 14px',fontSize:_fs(11),
    fontWeight:_mpTab===t?600:400,cursor:'pointer',fontFamily:C.font};};
  var isOffline=_mpData&&_mpData._offline;
  var isNewDays=7;
  return h(React.Fragment,null,
    /* header */
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0,gap:10}},
      h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},'Marketplace'),
      isOffline?h('span',{style:{fontSize:_fs(9),background:'rgba(239,68,68,0.1)',color:'#ef4444',border:'1px solid rgba(239,68,68,0.2)',borderRadius:4,padding:'2px 8px',fontWeight:600}},'Offline'):null,
      h('button',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'5px 12px',color:C.tx2,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font,display:'flex',alignItems:'center',gap:4},
        onClick:function(){_mpData=null;_mpMsg=null;_loadMarketplaceData(true);}},svgEl('<path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>',14),'Obnovit')),
    /* tab bar */
    h('div',{style:{display:'flex',gap:6,padding:'10px 18px',borderBottom:'1px solid '+C.border,alignItems:'center'}},
      Object.keys(tabLabels).map(function(t){return h('button',{key:t,style:tabStyle(t),onClick:function(){_mpTab=t;_mpSearch='';renderCenter();}},tabLabels[t]+' ('+counts[t]+')');}),
      h('div',{style:{flex:1}}),
      h('input',{type:'text',value:_mpSearch,placeholder:'Hledat balíček...',
        style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:6,padding:'4px 10px',fontSize:_fs(11),color:C.tx1,fontFamily:C.font,width:180,outline:'none'},
        onChange:function(e){_mpSearch=e.target.value;renderCenter();}})),
    /* toast */
    _mpMsg?h('div',{style:{margin:'0 18px',marginTop:12,padding:'8px 14px',borderRadius:6,fontSize:_fs(11),fontWeight:600,
      background:_mpMsg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
      color:_mpMsg.ok?C.accent:'#ef4444',
      border:'1px solid '+(_mpMsg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_mpMsg.text):null,
    /* body */
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},
      _mpLoading&&!_mpData?h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Načítám katalog...'):null,
      _mpData&&_mpData.error?h('div',{style:{color:'#ef4444',padding:20,textAlign:'center'}},'Chyba: '+_mpData.error):null,
      filtered.length===0&&_mpData&&!_mpData.error?h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},_mpSearch?'Žádné výsledky pro "'+_mpSearch+'"':'Žádné balíčky v této kategorii.'):null,
      filtered.length>0?h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12,alignContent:'start'}},
        filtered.map(function(p){
          var key=p.type+':'+p.id;
          var installing=_mpInstalling[key];
          var isNew=p.publishedAt&&((Date.now()-new Date(p.publishedAt).getTime())/(86400000))<isNewDays;
          return h('div',{key:key,style:{background:C.bg2,border:'1px solid '+(p.installed?C.accent:C.border),borderRadius:10,padding:16,cursor:'pointer',position:'relative',transition:'border-color 0.2s,box-shadow 0.2s',overflow:'hidden'},
            onMouseEnter:function(e){if(!p.installed)e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';},
            onMouseLeave:function(e){if(!p.installed)e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';},
            onClick:function(){setDetail({name:p.name||p.id,_itemId:p.id,fields:[
              {k:'ID',v:p.id},{k:'Typ',v:p.type},{k:'Verze',v:p.version||'?'},
              {k:'Autor',v:p.author||'—'},{k:'Popis',v:p.description||''},
              {k:'Engine',v:p.engine||'—'},{k:'Velikost',v:p.size?(p.size>1024?(p.size/1024).toFixed(1)+' KB':p.size+' B'):'—'},
              {k:'Závislosti',v:p.dependencies&&p.dependencies.length?p.dependencies.join(', '):'žádné'},
              {k:'Stav',v:p.installed?'Nainstalováno'+(p.installedVersion?' (v'+p.installedVersion+')':''):'Dostupné'}
            ],tags:[p.type].concat(p.tags||[]),actions:p.installed?(p.updateAvailable?['Aktualizovat','Odinstalovat']:['Odinstalovat']):['Nainstalovat']});}},
            /* badges */
            isNew?h('div',{style:{position:'absolute',top:10,right:10,background:'rgba(59,130,246,0.15)',border:'1px solid rgba(59,130,246,0.3)',borderRadius:4,padding:'2px 6px',fontSize:_fs(8),fontWeight:700,color:'#3b82f6'}},'NOVÉ'):null,
            p.installed?h('div',{style:{position:'absolute',top:10,right:isNew?52:10,background:'rgba(34,197,94,0.15)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:4,padding:'2px 6px',fontSize:_fs(8),fontWeight:700,color:C.accent}},p.updateAvailable?'AKTUALIZACE':'NAINSTALOVÁNO'):null,
            /* content */
            h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:4,paddingRight:isNew||p.installed?70:0}},p.name||p.id),
            h('div',{style:{fontSize:_fs(10),color:C.tx3,marginBottom:8,lineHeight:1.4,maxHeight:40,overflow:'hidden'}},p.description||''),
            h('div',{style:{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}},(p.tags||[]).slice(0,4).map(function(t){return h('span',{key:t,style:{background:C.bg3,border:'1px solid '+C.border,borderRadius:4,padding:'1px 6px',fontSize:_fs(9),color:C.tx4}},t);})),
            /* footer: version + author + action */
            h('div',{style:{display:'flex',alignItems:'center',gap:8,marginTop:4}},
              h('span',{style:{fontSize:_fs(9),color:C.tx4}},p.version||''),
              p.author?h('span',{style:{fontSize:_fs(9),color:C.tx4}},'· '+p.author):null,
              h('div',{style:{flex:1}}),
              installing?h('span',{style:{fontSize:_fs(10),color:C.accent,fontWeight:600}},installing):
              p.installed&&p.updateAvailable?h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',fontFamily:C.font},onClick:function(ev){ev.stopPropagation();_mpUpdate(p.type,p.id);}},'Aktualizovat'):
              !p.installed?h('button',{style:{background:C.accent,color:'#fff',border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',fontFamily:C.font},onClick:function(ev){ev.stopPropagation();_mpInstall(p.type,p.id);}},'Nainstalovat'):null)
          );
        })
      ):null,
      /* pagination */
      _mpData&&_mpData.totalPages>1?h('div',{style:{display:'flex',justifyContent:'center',gap:10,marginTop:16,alignItems:'center'}},
        h('button',{disabled:_mpPage<=1,style:{background:C.bg3,border:'1px solid '+C.border,borderRadius:6,padding:'4px 12px',fontSize:_fs(11),color:_mpPage<=1?C.tx4:C.tx2,cursor:_mpPage<=1?'default':'pointer',fontFamily:C.font},
          onClick:function(){if(_mpPage>1){_mpPage--;_mpData=null;_loadMarketplaceData();}}},'← Předchozí'),
        h('span',{style:{fontSize:_fs(11),color:C.tx3}},_mpPage+' / '+_mpData.totalPages),
        h('button',{disabled:_mpPage>=_mpData.totalPages,style:{background:C.bg3,border:'1px solid '+C.border,borderRadius:6,padding:'4px 12px',fontSize:_fs(11),color:_mpPage>=_mpData.totalPages?C.tx4:C.tx2,cursor:_mpPage>=_mpData.totalPages?'default':'pointer',fontFamily:C.font},
          onClick:function(){if(_mpPage<_mpData.totalPages){_mpPage++;_mpData=null;_loadMarketplaceData();}}},'Další →'))
      :null
    )
  );
}

// ═══ MEDIA MODULE START ═══════════════════════════════════════════════════════

var _media={
  data:[],loading:false,tab:'all',search:'',
  health:{available:false,vramBusy:false},
  models:null,
  form:{visible:false,type:'txt2img',prompt:'',neg:'',params:{width:1024,height:1024,steps:20,cfg_scale:7,seed:-1}},
  progress:new Map(),
  msg:null
};
var _mediaListenersAttached=false;
var _mediaOutputCache=createLegacyLocalObjectUrlCache({
  fetchImpl:function(target,options){return fetch(target,options);},
  createObjectURL:function(blob){return URL.createObjectURL(blob);},
  revokeObjectURL:function(objectUrl){URL.revokeObjectURL(objectUrl);},
  maxEntries:24
});

function _mediaOutputPath(id,filename){
  return '/api/media/output?id='+encodeURIComponent(id)+'&filename='+encodeURIComponent(filename);
}
function _mediaOutputTarget(id,filename){
  return _backendBase+_mediaOutputPath(id,filename);
}
function _mediaEnsureOutputUrl(id,filename){
  return _mediaOutputCache.load(_mediaOutputTarget(id,filename))
    .then(function(objectUrl){
      if(objectUrl)MediaEvents.render();
      return objectUrl;
    });
}
function _mediaRevokeOutputUrls(id){
  var prefix=_backendBase+'/api/media/output?id='+encodeURIComponent(id)+'&';
  _mediaOutputCache.invalidateWhere(function(target){
    return target.indexOf(prefix)===0;
  });
}
function _mediaPruneOutputUrls(generations){
  var activeTargets=[];
  generations.forEach(function(generation){
    var outputs=[];try{outputs=JSON.parse(generation.outputs||'[]');}catch(_){}
    outputs.forEach(function(filename){
      activeTargets.push(_mediaOutputTarget(generation.id,filename));
    });
  });
  _mediaOutputCache.retain(activeTargets);
}

var MediaAPI={
  _fetch:function(path,opts){
    var o={signal:AbortSignal.timeout(8000)};
    if(opts){Object.keys(opts).forEach(function(k){o[k]=opts[k];});}
    return fetch(_backendBase+path,o)
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .catch(function(e){_media.msg={ok:false,text:e.message};throw e;});
  },
  loadData:function(){
    if(_media.loading)return;
    _media.loading=true;
    var params='?limit=50';
    if(_media.tab==='favorites')params+='&favorite=1';
    else if(_media.tab!=='all')params+='&type='+_media.tab;
    if(_media.search)params+='&q='+encodeURIComponent(_media.search);
    MediaAPI._fetch('/api/media/history'+params)
      .then(function(d){_media.data=d.generations||[];_mediaPruneOutputUrls(_media.data);})
      .catch(function(){_media.data=[];})
      .finally(function(){_media.loading=false;MediaEvents.render();});
  },
  loadHealth:function(){
    MediaAPI._fetch('/api/media/health')
      .then(function(d){_media.health={available:!!d.available,vramBusy:false};})
      .catch(function(){_media.health={available:false,vramBusy:false};})
      .finally(function(){MediaEvents.render();});
  },
  loadModels:function(){
    MediaAPI._fetch('/api/media/models')
      .then(function(d){_media.models=d;})
      .catch(function(){})
      .finally(function(){MediaEvents.render();});
  },
  submit:function(){
    var f=_media.form;
    if(!f.prompt.trim()){_media.msg={ok:false,text:'Prompt je povinný'};MediaEvents.render();return;}
    if(f.params.steps>150||f.params.steps<1){_media.msg={ok:false,text:'Steps musí být 1–150'};MediaEvents.render();return;}
    if(f.params.width%8!==0||f.params.height%8!==0){_media.msg={ok:false,text:'Rozměry musí být dělitelné 8'};MediaEvents.render();return;}
    if(!_media.health.available){_media.msg={ok:false,text:'ComfyUI není dostupné'};MediaEvents.render();return;}
    MediaAPI._fetch('/api/media/generate',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:f.type,prompt:f.prompt,negative_prompt:f.neg,params:f.params})
    }).then(function(d){
      if(d.ok){
        _media.msg={ok:true,text:'Generování zahájeno'+(d.dedup?' (již ve frontě)':'')};
        _media.progress.set(d.generationId,{id:d.generationId,percent:0,text:'Ve frontě...',status:'pending',startedAt:Date.now()});
        _media.form.visible=false;_media.form.prompt='';_media.form.neg='';
        setTimeout(function(){_media.msg=null;MediaEvents.render();},3000);
      }else{
        _media.msg={ok:false,text:d.error||'Chyba'};
        setTimeout(function(){_media.msg=null;MediaEvents.render();},5000);
      }
      MediaEvents.render();
    }).catch(function(){MediaEvents.render();});
  },
  toggleFav:function(id,currentFav){
    var item=_media.data.find(function(g){return g.id===id;});
    if(item){item.favorite=currentFav?0:1;MediaEvents.render();}
    MediaAPI._fetch('/api/media/favorite',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:id,favorite:!currentFav})
    }).catch(function(){
      if(item){item.favorite=currentFav?1:0;MediaEvents.render();}
    });
  },
  del:function(id){
    if(!confirm('Smazat generaci?'))return;
    MediaAPI._fetch('/api/media?id='+encodeURIComponent(id),{method:'DELETE'})
      .then(function(){_media.data=_media.data.filter(function(g){return g.id!==id;});_media.progress.delete(id);_mediaRevokeOutputUrls(id);MediaEvents.render();})
      .catch(function(){MediaEvents.render();});
  },
  cancel:function(id){
    MediaAPI._fetch('/api/media/cancel?id='+encodeURIComponent(id),{method:'POST'})
      .then(function(){
        _media.progress.delete(id);
        _media.msg={ok:true,text:'Zrušeno'};MediaEvents.render();
        setTimeout(function(){_media.msg=null;MediaEvents.render();},3000);
      }).catch(function(){});
  }
};

var MediaEvents={
  _scheduled:false,
  render:function(){
    if(MediaEvents._scheduled)return;
    MediaEvents._scheduled=true;
    requestAnimationFrame(function(){MediaEvents._scheduled=false;renderCenter();});
  },
  attach:function(){
    if(_mediaListenersAttached)return;
    _mediaListenersAttached=true;
    C3Bus.on('comfyui:progress',function(ev){
      if(!_media.progress.has(ev.generationId)){
        _media.progress.set(ev.generationId,{id:ev.generationId,percent:0,text:'',status:'generating',startedAt:Date.now()});
      }
      var p=_media.progress.get(ev.generationId);
      p.percent=ev.percent||0;p.text=ev.text||'';p.status=ev.status||'generating';
      /* Update badge */
      NAV[6].badge=_media.progress.size||0;
      if(_centerState.view==='multimedia')MediaEvents.render();
    });
    C3Bus.on('comfyui:complete',function(ev){
      _media.progress.delete(ev.generationId);
      NAV[6].badge=_media.progress.size||0;
      if(ev.generationId)_mediaRevokeOutputUrls(ev.generationId);
      MediaAPI.loadData();
      if(window._c3)window._c3.agentLog('TOOL','Media generování dokončeno');
    });
    C3Bus.on('comfyui:error',function(ev){
      _media.progress.delete(ev.generationId);
      NAV[6].badge=_media.progress.size||0;
      _media.msg={ok:false,text:'Generování selhalo: '+(ev.error||'neznámá chyba')};
      MediaAPI.loadData();
      if(_centerState.view==='multimedia')MediaEvents.render();
      setTimeout(function(){_media.msg=null;if(_centerState.view==='multimedia')MediaEvents.render();},8000);
    });
    C3Bus.on('vram:state',function(ev){
      _media.health.vramBusy=!!ev.busy;
      if(_centerState.view==='multimedia')MediaEvents.render();
    });
  }
};

function centerMultimedia(){
  /* Lazy init on first view open */
  if(!_media.data.length&&!_media.loading)MediaAPI.loadData();
  if(!_media.models)MediaAPI.loadModels();
  MediaAPI.loadHealth();

  var ell={whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
  var tabs=[
    {id:'all',label:'Všechny'},{id:'txt2img',label:'Obrázky'},{id:'img2img',label:'Img2Img'},
    {id:'txt2vid',label:'Video'},{id:'favorites',label:'Oblíbené'}
  ];
  var tabStyle=function(t){return{background:_media.tab===t?C.accent:'transparent',color:_media.tab===t?'#fff':C.tx3,
    border:'1px solid '+(_media.tab===t?C.accent:C.border2),borderRadius:6,padding:'5px 14px',fontSize:_fs(11),
    fontWeight:_media.tab===t?600:400,cursor:'pointer',fontFamily:C.font};};
  var formTypeStyle=function(t){return{background:_media.form.type===t?C.accent:'transparent',color:_media.form.type===t?'#fff':C.tx3,
    border:'1px solid '+(_media.form.type===t?C.accent:C.border2),borderRadius:6,padding:'4px 12px',fontSize:_fs(10),
    cursor:'pointer',fontFamily:C.font};};

  /* ── Progress cards ── */
  var progressCards=[];
  _media.progress.forEach(function(p){
    progressCards.push(h('div',{key:p.id,style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:8,padding:12,marginBottom:8}},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}},
        h('span',{style:{fontSize:_fs(11),color:C.tx2}},p.text||'Generuji...'),
        h('button',{style:{background:'transparent',border:'none',color:C.tx4,cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
          onClick:function(){MediaAPI.cancel(p.id);}},'Zrušit')),
      h('div',{style:{width:'100%',height:6,background:C.bg4,borderRadius:3,overflow:'hidden'}},
        h('div',{style:{width:p.percent+'%',height:'100%',background:C.accent,borderRadius:3,transition:'width 0.3s'}})),
      h('span',{style:{fontSize:_fs(9),color:C.tx4}},p.percent+'%')
    ));
  });

  /* ── History grid ── */
  var gridItems=_media.data.map(function(gen){
    var outputs=[];try{outputs=JSON.parse(gen.outputs||'[]');}catch(_){}
    var thumb=outputs.length>0?outputs[0]:null;
    var thumbUrl=thumb?_mediaOutputCache.peek(_mediaOutputTarget(gen.id,thumb)):null;
    if(thumb&&!thumbUrl)_mediaEnsureOutputUrl(gen.id,thumb);
    var statusColor=gen.status==='completed'?C.accent:gen.status==='failed'?'#ef4444':C.tx4;
    var statusLabel=gen.status==='completed'?'Hotovo':gen.status==='failed'?'Chyba':gen.status==='cancelled'?'Zrušeno':gen.status==='running'?'Běží':'Čeká';
    return h('div',{key:gen.id,style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,overflow:'hidden',cursor:'pointer',transition:'border-color 0.2s,box-shadow 0.2s'},
      onMouseEnter:function(e){e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';},
      onMouseLeave:function(e){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';},
      onClick:function(){
        setDetail({
          name:(gen.prompt||'').slice(0,40)+(gen.prompt&&gen.prompt.length>40?'…':''),
          _itemId:gen.id,
          fields:[
            {k:'ID',v:gen.id},{k:'Typ',v:gen.type},{k:'Status',v:gen.status},
            {k:'Prompt',v:gen.prompt||'—'},
            {k:'Vytvořeno',v:gen.created_at||'—'},{k:'Dokončeno',v:gen.completed_at||'—'},
            {k:'Doba',v:gen.duration_ms?(gen.duration_ms/1000).toFixed(1)+'s':'—'},
            {k:'Chyba',v:gen.error||'—'}
          ],
          tags:[gen.type,statusLabel],
          actions:gen.status==='completed'?['Oblíbené','Smazat']
            :gen.status==='pending'?['Zrušit','Smazat']:['Smazat']
        });
      }},
      thumbUrl?h('img',{src:thumbUrl,
        style:{width:'100%',height:140,objectFit:'cover'},
        onError:function(e){e.target.style.display='none';}
      }):h('div',{style:{width:'100%',height:140,background:C.bg3,display:'flex',alignItems:'center',justifyContent:'center',color:C.tx4}},
        gen.status==='failed'?svgEl(I.close,24):svgEl(I.media,24)),
      h('div',{style:{padding:10}},
        h('div',{style:{fontSize:_fs(11),color:C.tx1,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginBottom:4}},gen.prompt||'—'),
        h('div',{style:{display:'flex',gap:4,alignItems:'center'}},
          h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:_fs(9),fontWeight:600,fontFamily:C.mono,background:C.bg4,color:C.tx3}},gen.type),
          h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:_fs(9),fontWeight:600,fontFamily:C.mono,background:statusColor+'22',color:statusColor}},statusLabel),
          h('div',{style:{flex:1}}),
          h('span',{style:{cursor:'pointer',fontSize:16,color:gen.favorite?'#f59e0b':C.tx4,userSelect:'none'},
            onClick:function(ev){ev.stopPropagation();MediaAPI.toggleFav(gen.id,gen.favorite);}},gen.favorite?'★':'☆')),
        gen.duration_ms?h('span',{style:{fontSize:_fs(9),color:C.tx4}},(gen.duration_ms/1000).toFixed(1)+'s'):null)
    );
  });

  /* ── Models select options ── */
  var checkpoints=_media.models&&_media.models.checkpoints?_media.models.checkpoints:[];
  var formDisabled=!_media.health.available||checkpoints.length===0;

  return h(React.Fragment,null,
    /* ── Header ── */
    h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0,gap:10}},
      h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},'Multimédia'),
      h('span',{style:{display:'inline-flex',alignItems:'center',gap:4,fontSize:_fs(9),fontWeight:600,
        background:_media.health.available?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
        color:_media.health.available?C.accentText:'#ef4444',
        border:'1px solid '+(_media.health.available?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'),
        borderRadius:4,padding:'2px 8px'}},
        h('span',{style:{width:6,height:6,borderRadius:'50%',background:_media.health.available?C.accentText:'#ef4444'}}),
        _media.health.available?'ComfyUI':'Nedostupné'),
      _media.health.vramBusy?h('span',{style:{fontSize:_fs(9),background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.2)',borderRadius:4,padding:'2px 8px',fontWeight:600}},'GPU zaneprázdněno'):null,
      h('button',{style:{background:C.accent,border:'none',borderRadius:6,padding:'5px 14px',color:'#fff',fontSize:_fs(11),cursor:'pointer',fontFamily:C.font,fontWeight:600},
        onClick:function(){_media.form.visible=!_media.form.visible;MediaEvents.render();}},'+ Nový')),

    /* ── Tab bar ── */
    h('div',{style:{display:'flex',gap:6,padding:'10px 18px',borderBottom:'1px solid '+C.border,alignItems:'center'}},
      tabs.map(function(t){return h('button',{key:t.id,style:tabStyle(t.id),
        onClick:function(){_media.tab=t.id;_media.data=[];MediaAPI.loadData();}},t.label);}),
      h('div',{style:{flex:1}}),
      h('input',{type:'text',value:_media.search,placeholder:'Hledat...',
        style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'5px 10px',fontSize:_fs(11),color:C.tx1,fontFamily:C.font,width:160,outline:'none'},
        onChange:function(e){_media.search=e.target.value;},
        onKeyDown:function(e){if(e.key==='Enter'){_media.data=[];MediaAPI.loadData();}}})),

    /* ── Toast ── */
    _media.msg?h('div',{style:{margin:'8px 18px',padding:'8px 14px',borderRadius:8,fontSize:_fs(11),fontWeight:600,
      background:_media.msg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
      color:_media.msg.ok?C.accentText:'#ef4444',
      border:'1px solid '+(_media.msg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_media.msg.text):null,

    /* ── Generation form ── */
    _media.form.visible?h('div',{style:{margin:'8px 18px',padding:16,background:C.bg2,border:'1px solid '+C.border,borderRadius:10}},
      h('div',{style:{display:'flex',gap:6,marginBottom:12}},
        h('button',{style:formTypeStyle('txt2img'),onClick:function(){_media.form.type='txt2img';MediaEvents.render();}},'Text→Obraz'),
        h('button',{style:formTypeStyle('img2img'),onClick:function(){_media.form.type='img2img';MediaEvents.render();}},'Obraz→Obraz'),
        h('button',{style:formTypeStyle('txt2vid'),onClick:function(){_media.form.type='txt2vid';MediaEvents.render();}},'Text→Video')),
      h('textarea',{value:_media.form.prompt,placeholder:'Popište co chcete vygenerovat...',rows:3,
        style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:8,fontSize:_fs(11),color:C.tx1,fontFamily:C.font,resize:'vertical',outline:'none',boxSizing:'border-box'},
        onChange:function(e){_media.form.prompt=e.target.value;}}),
      h('textarea',{value:_media.form.neg,placeholder:'Negativní prompt (volitelné)',rows:2,
        style:{width:'100%',marginTop:8,background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:8,fontSize:_fs(10),color:C.tx3,fontFamily:C.font,resize:'vertical',outline:'none',boxSizing:'border-box'},
        onChange:function(e){_media.form.neg=e.target.value;}}),
      h('div',{style:{display:'flex',gap:12,marginTop:10,flexWrap:'wrap',alignItems:'center'}},
        h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'Šířka',
          h('input',{type:'number',value:_media.form.params.width,min:64,max:4096,step:8,
            style:{width:70,background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none'},
            onChange:function(e){_media.form.params.width=parseInt(e.target.value)||1024;}})),
        h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'Výška',
          h('input',{type:'number',value:_media.form.params.height,min:64,max:4096,step:8,
            style:{width:70,background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none'},
            onChange:function(e){_media.form.params.height=parseInt(e.target.value)||1024;}})),
        h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'Steps',
          h('input',{type:'number',value:_media.form.params.steps,min:1,max:150,
            style:{width:50,background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none'},
            onChange:function(e){_media.form.params.steps=parseInt(e.target.value)||20;}})),
        h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'CFG',
          h('input',{type:'number',value:_media.form.params.cfg_scale,min:0,max:30,step:0.5,
            style:{width:50,background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none'},
            onChange:function(e){_media.form.params.cfg_scale=parseFloat(e.target.value)||7;}})),
        h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'Seed',
          h('input',{type:'number',value:_media.form.params.seed,
            style:{width:80,background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none'},
            onChange:function(e){_media.form.params.seed=parseInt(e.target.value)||-1;}})),
        checkpoints.length>0?h('label',{style:{fontSize:_fs(10),color:C.tx3,display:'flex',alignItems:'center',gap:4}},'Model',
          h('select',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',fontSize:_fs(10),color:C.tx1,fontFamily:C.font,outline:'none',maxWidth:150},
            onChange:function(e){_media.form.params.model=e.target.value;}},
            checkpoints.map(function(m){return h('option',{key:m,value:m},m);}))):null),
      h('div',{style:{display:'flex',gap:8,marginTop:12}},
        h('button',{disabled:formDisabled,style:{background:formDisabled?C.bg4:C.accent,border:'none',borderRadius:6,padding:'6px 18px',color:formDisabled?C.tx4:'#fff',fontSize:_fs(11),cursor:formDisabled?'default':'pointer',fontFamily:C.font,fontWeight:600},
          onClick:function(){if(!formDisabled)MediaAPI.submit();}},'Generovat'),
        h('button',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 14px',color:C.tx2,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
          onClick:function(){_media.form.visible=false;MediaEvents.render();}},'Zavřít'))
    ):null,

    /* ── Active progress ── */
    progressCards.length>0?h('div',{style:{padding:'8px 18px'}},progressCards):null,

    /* ── Content area ── */
    h('div',{style:{flex:1,overflow:'auto',padding:18}},
      _media.loading?h('div',{style:{textAlign:'center',padding:40,color:C.tx4,fontSize:_fs(12)}},'Načítám...'):
      _media.data.length===0?h('div',{style:{textAlign:'center',padding:40,color:C.tx4,fontSize:_fs(12)}},'Žádné generace'):
      h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12}},gridItems))
  );
}

// ═══ MEDIA MODULE END ═════════════════════════════════════════════════════════

function centerWelcome(){return h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}},h('div',{style:{width:48,height:48,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:_fs(20),color:'#fff'}},'C3'),h('div',{style:{fontSize:_fs(16),fontWeight:700,color:C.tx1}},'C3 Studio'),h('div',{style:{fontSize:_fs(12),color:C.tx3}},'Vyber sekci v levém panelu'));}

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
      if(es&&!es.chat._preparedSend){es.chat.editMode=es.chat.editMode==='ask'?'auto':'ask';renderChat();}
      break;
    case 'Escape':
      /* Cancel execution or clear autocomplete */
      if(_sessions[_sessionActive]&&_sessions[_sessionActive].chat.acSuggestion){
        _sessions[_sessionActive].chat.acSuggestion=null;renderChat();
        e.preventDefault();
      }else{
        var activeSession=_sessions[_sessionActive];
        if(_chatCancelPreparedSend(_sessionActive,activeSession))e.preventDefault();
        else if(typeof C3WS!=='undefined'&&C3WS.isReady()){
          if(C3WS.sendCancel(activeSession))e.preventDefault();
        }
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

function _backToGrid(){_editorState.active=false;if(_centerContainer)_centerContainer.style.display='';renderCenter();}

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
      h('div',{style:{padding:'0 10px',height:'100%',display:'flex',alignItems:'center',cursor:'pointer',color:C.tx4,fontSize:_fs(12),flexShrink:0,borderRight:'1px solid '+C.border,gap:4},
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:_backToGrid},svgEl('<polyline points="15 18 9 12 15 6"/>',14),'Grid'),
      /* Tabs */
      h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
        tabs.map(function(tab){
          var isA=tab.id===_editorState.activeTabId;
          return h('div',{key:tab.id,style:{display:'flex',alignItems:'center',gap:4,padding:'0 10px',height:32,cursor:'pointer',borderRight:'1px solid '+C.border,background:isA?C.bg1:'transparent',color:isA?C.tx1:C.tx3,fontSize:_fs(11.5),fontWeight:isA?600:400,maxWidth:160,flexShrink:0},
            onClick:function(){_setActiveTab(tab.id);}},
            tab.type==='diff'?h('span',{style:{color:C.amber,fontSize:_fs(10)}},'~'):h('span',{style:{fontSize:_fs(10)}},'📄'),
            h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}},tab.label+(tab.dirty?' •':'')),
            h('span',{style:{fontSize:_fs(14),color:C.tx4,padding:'0 2px',flexShrink:0,lineHeight:'1'},
              onMouseEnter:function(e){e.currentTarget.style.color=C.tx1;},onMouseLeave:function(e){e.currentTarget.style.color=C.tx4;},
              onClick:function(e){e.stopPropagation();_closeTab(tab.id);}},'×'));
        })),
      h('div',{style:{flex:1}})),
    /* Content */
    h('div',{style:{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}},
      at?(
        at.deleted?h('div',{style:{padding:20,textAlign:'center'}},
          h('div',{style:{background:C.redBg,color:C.red,padding:'8px 12px',borderRadius:6,fontSize:_fs(12),display:'inline-block'}},'Soubor byl smazán.'),
          h('button',{style:{marginTop:8,padding:'4px 12px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,cursor:'pointer',fontSize:_fs(11)},onClick:function(){_closeTab(at.id);}},'Zavřít tab')):
        at.type==='file'?_renderFileContent(at):
        at.type==='diff'?_renderDiffContent(at):
        h('div',{style:{padding:20,color:C.tx4,fontSize:_fs(12)}},'Neznámý typ tabu')
      ):h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:C.tx4,fontSize:_fs(12)}},'Dvojklik na soubor ve Working Tree pro otevření')));
}

function _renderFileContent(tab){
  var lines=(tab.content||'').split('\n');
  return h(React.Fragment,null,
    /* External change banner */
    tab.externalChange?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:C.amberBg,borderBottom:'1px solid '+C.border,fontSize:_fs(11),flexShrink:0}},
      h('span',{style:{color:C.amber,flex:1}},'Soubor byl změněn externě.'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.amber,background:'transparent',color:C.amber,cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){_refreshFileTab(tab);}},'Načíst z disku'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border2,background:'transparent',color:C.tx3,cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){tab.externalChange=false;renderCenter();}},'Ignorovat')):null,
    /* Code view */
    h('div',{id:'c3-editor-scroll',style:{flex:1,overflow:'auto',background:C.bg0},
      onScroll:function(e){tab.scrollTop=e.target.scrollTop;}},
      h('table',{style:{borderCollapse:'collapse',width:'100%',fontFamily:C.mono,fontSize:_fs(12),lineHeight:'1.6'}},
        h('tbody',null,lines.map(function(line,i){
          return h('tr',{key:i},
            h('td',{style:{color:C.tx4,textAlign:'right',paddingRight:12,paddingLeft:8,userSelect:'none',width:48,verticalAlign:'top',fontSize:_fs(11),opacity:0.6}},i+1),
            h('td',{style:{whiteSpace:'pre',color:C.tx1,paddingRight:16}},_highlightLine(line)));
        })))));
}

function _renderDiffContent(tab){
  if(tab.tooLarge){
    return h('div',{style:{padding:24,textAlign:'center'}},
      h('div',{style:{fontSize:_fs(13),color:C.tx2,marginBottom:12}},'Soubor příliš velký pro inline diff.'),
      h('div',{style:{display:'flex',gap:8,justifyContent:'center'}},
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:'#fff',cursor:'pointer',fontSize:_fs(12),fontWeight:600},onClick:function(){_approveAll(tab.reqId);}},'Schválit bez review'),
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:_fs(12)},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')));
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
          h('div',{style:{padding:'4px 12px',background:C.bg3,color:C.tx4,fontFamily:C.mono,fontSize:_fs(10.5),borderBottom:'1px solid '+C.border}},
            '@@ -'+hunk.startOld+','+hunk.oldCount+' +'+hunk.startNew+','+hunk.newCount+' @@'),
          hunk.lines.map(function(line,li){
            var bg=line.type==='add'?'rgba(34,197,94,0.08)':line.type==='remove'?'rgba(239,68,68,0.08)':'transparent';
            var sign=line.type==='add'?'+':line.type==='remove'?'-':' ';
            var sc=line.type==='add'?C.accentText:line.type==='remove'?C.red:C.tx4;
            return h('div',{key:li,style:{display:'flex',fontFamily:C.mono,fontSize:_fs(12),lineHeight:'1.6',background:bg}},
              h('span',{style:{color:C.tx4,width:40,textAlign:'right',paddingRight:4,flexShrink:0,fontSize:_fs(11),opacity:0.5,userSelect:'none'}},line.oldNo||''),
              h('span',{style:{color:C.tx4,width:40,textAlign:'right',paddingRight:8,flexShrink:0,fontSize:_fs(11),opacity:0.5,userSelect:'none'}},line.newNo||''),
              h('span',{style:{color:sc,width:16,textAlign:'center',flexShrink:0,fontWeight:600}},sign),
              h('pre',{style:{margin:0,color:C.tx1,whiteSpace:'pre',flex:1}},_highlightLine(line.text)));
          }));
      })),
    /* Bottom toolbar — approve/reject */
    tab.reqId?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderTop:'1px solid '+C.border,background:C.bg2,flexShrink:0}},
      h('span',{style:{fontSize:_fs(10),color:C.tx4,flex:1}},'Schválení se vztahuje na celý soubor: '+(tab.path||'')),
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:'#fff',cursor:'pointer',fontSize:_fs(12),fontWeight:600},onClick:function(){_approveAll(tab.reqId);}},'Schválit'),
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:_fs(12),fontWeight:600},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')):null);
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

function _detailActionHandler(d,a){
  var c3=window._c3;if(!c3)return;
  if(a==='Deaktivovat'){
    _centerState.detail=null;renderCenter();
    c3.clearSpecialist();c3.agentLog('TOOL','Specialista deaktivován');return;
  }
  if(a==='Otevřít'){
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
    var spec=SPECIALISTS.find(function(x){return x.name===d.name;});
    if(spec){c3.setSpecialist(spec);c3.agentLog('TOOL','Specialista aktivován: '+spec.name);return;}
    var exp=EXPERTISES.find(function(e){return e.name===d.name;});
    if(exp){c3.setExpertise(exp.name);c3.agentLog('TOOL','Expertyza změněna na: '+exp.name);}
    var conv=CONVERSATIONS.find(function(c){return c.title===d.name;});
    if(conv){_showOpenDialog('conv',conv,function(_ti){
      var _ts=_sessions[_ti];
      c3.agentLog('TOOL','Načítám konverzaci: '+conv.title+'...');c3.setExpertise(conv.expertise);
      if(conv.id){_ts._convId=conv.id;_ts._label=conv.title||'Konverzace';
        /* v122.2: Activate conversation center-panel focus */
        _ts._conversationFocus=true;_syncFocusClass();renderCenter();
        _persistSessionState();
        fetch(_backendBase+'/api/conversations/'+conv.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(cd){
          var meta={};try{meta=JSON.parse(cd.metadata||'{}');}catch(ex){}
          if(meta.agentId){_ts._agentId=meta.agentId;_persistSessionState();renderChat();}
        }).catch(function(){});
        fetch(_backendBase+'/api/conversations/'+conv.id+'/messages',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(msgs){
        var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);if(items.length>0){_ts.chat.msgs=[{role:'system',text:'Konverzace: '+conv.title}];items.forEach(function(m){var meta=null;try{meta=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(meta&&meta.mode)||undefined});});renderChat();_chatScrollPane(_ti);}}).catch(function(){});}
    });}
    var proj=PROJECTS.find(function(p){return p.name===d.name;});
    if(proj){_showOpenDialog('proj',proj,function(_ti){
      var _ts=_sessions[_ti];
      c3.agentLog('TOOL','Otevren projekt: '+proj.name+(proj.path?' ['+proj.path+']':''));
      if(proj.path){_wtRoot=proj.path;_loadWorkspaceTree(proj.path);}
      _ts._projectId=proj.id||null;_ts._label=proj.name||'Projekt';
      _ts._conversationFocus=false; /* v122.3: project sessions use normal layout */
      _ts._lifecycleResumed=false;
      _ts.log=[];_ts.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
      _syncFocusClass();_persistSessionState();
      var openToken=Date.now();
      _ts._openToken=openToken;
      if(proj.id){
        var pConv=fetch(_backendBase+'/api/projects/'+proj.id+'/conversations?limit=1',{signal:AbortSignal.timeout(5000)})
          .then(function(r){return r.json();})
          .then(function(data){
            if(_ts._openToken!==openToken)return null;
            var convs=data.conversations||[];
            if(convs.length>0)return convs[0];
            return fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:proj.id,title:proj.name}),signal:AbortSignal.timeout(5000)})
              .then(function(r){return r.json();}).then(function(d2){return d2.conversation||d2;});
          });
        var pLifecycle=fetch(_backendBase+'/api/projects/'+proj.id+'/lifecycle',{signal:AbortSignal.timeout(5000)})
          .then(function(r){return r.json();}).catch(function(){return{lifecycle:null};});
        fetch(_backendBase+'/api/projects/'+proj.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(pd){if(pd.description)c3.agentLog('TOOL',_s(pd.description));if(pd.path&&!proj.path){proj.path=pd.path;_wtRoot=pd.path;_loadWorkspaceTree(pd.path);}}).catch(function(){});
        Promise.all([pConv,pLifecycle]).then(function(results){
          if(_ts._openToken!==openToken)return;
          var conv2=results[0];
          var lcData=results[1];
          if(conv2&&conv2.id){
            _ts._convId=conv2.id;_persistSessionState();
            fetch(_backendBase+'/api/conversations/'+conv2.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(cd){
              var meta2={};try{meta2=JSON.parse(cd.metadata||'{}');}catch(ex){meta2={};}
              if(meta2.agentId){_ts._agentId=meta2.agentId;_persistSessionState();renderChat();}
            }).catch(function(){});
            fetch(_backendBase+'/api/conversations/'+conv2.id+'/messages',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(msgs){
              if(_ts._openToken!==openToken)return;
              var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);
              _ts.chat.msgs=[{role:'system',text:'Projekt: '+proj.name}];
              if(items.length>0){
                items.forEach(function(m){var mt=null;try{mt=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(mt&&mt.mode)||undefined});});
              }
              var lc=lcData&&lcData.lifecycle;
              if(lc&&lc.phase!=='COMPLETED'&&lc.phase!=='FAILED'){
                if(!_ts._lifecycleResumed){
                  var ms=lc.milestones||{};
                  _ts.chat.msgs.push({role:'system',text:'Lifecycle: faze '+lc.phase+' | milestones: '+(ms.PASSED||0)+'/'+(ms.total||0)});
                  _ts._lifecycleResumed=true;
                }
                fetch(_backendBase+'/api/projects/'+proj.id+'/lifecycle/bind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:_ts._convId}),signal:AbortSignal.timeout(3000)}).catch(function(){});
              }
              renderChat();
              requestAnimationFrame(function(){_chatScrollPane(_ti);});
            }).catch(function(){});
          }
        }).catch(function(){});
      }
    });}
    var wrk=WORKERS.find(function(w){return w.name===d.name;});
    if(wrk){c3.agentLog('TOOL','Worker: '+wrk.name+' ['+_s(wrk.status)+'] cron: '+_s(wrk.cron));}
  }else if(a==='Editovat'){
    if(_centerState.view==='expertises'||_centerState.view==='specialists'){
      var _exItem=EXPERTISES.find(function(e){return e.name===d.name;});
      if(_exItem&&_exItem.id){
        fetch(_backendBase+'/api/expertises/'+_exItem.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(full){
          var cfg=null;try{cfg=full.config?JSON.parse(full.config):null;}catch(ex){}
          var defCaps={reasoning:50,creativity:50,determinism:50,riskTolerance:50,verbosity:50};
          var defMods={domain_rules:[],emphasis:[],constraints:[],vocabulary:[],antipatterns:[],disclaimer:null};
          var wizData={name:full.name||d.name,description:full.description||_exItem.desc||'',domain:full.domain||_exItem.domain||'',
            icon:full.icon||full.emoji||_exItem.emoji||'',
            systemPrompt:full.systemPrompt||(cfg&&cfg.systemPrompt)||'',
            tone:full.tone||(cfg&&cfg.tone)||'professional',
            temperature:full.temperature||(cfg&&cfg.temperature)||0.5,
            capabilities:full.capabilities||(cfg&&cfg.capabilities)||defCaps,
            modules:full.modules||(cfg&&cfg.modules)||defMods,
            parent:full.parent||(cfg&&cfg.parent)||null,
            inheritance:full.inheritance||(cfg&&cfg.inheritance)||{},
            styleRules:full.styleRules||(cfg&&cfg.styleRules)||{forbiddenPhrases:[]}};
          _ewOpen('edit',_exItem.id,wizData);
        }).catch(function(){_ewOpen('edit',_exItem.id,{name:d.name,description:_exItem.desc||'',domain:_exItem.domain||'',icon:_exItem.emoji||'',systemPrompt:'',tone:'professional',temperature:_exItem.temperature||0.5,capabilities:{reasoning:50,creativity:50,determinism:50,riskTolerance:50,verbosity:50},modules:{domain_rules:[],emphasis:[],constraints:[],vocabulary:[],antipatterns:[],disclaimer:null},parent:null,inheritance:{},styleRules:{forbiddenPhrases:[]}});});
        return;
      }
    }
    if(_centerState.view==='workers'){
      var _wkItem=WORKERS.find(function(w){return w.name===d.name;});
      if(_wkItem&&_wkItem.id){
        fetch(_backendBase+'/api/agents/'+_wkItem.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(full){
          var def=full.definition||{};
          var wizData={id:full.id||_wkItem.id,name:full.name||d.name,description:full.description||'',icon:full.icon||'🤖',type:full.type||'MONITOR',
            schedule:def.schedule||{type:'manual'},sources:def.sources||[],conditions:def.conditions||[],triggers:def.triggers||[],actions:def.actions||[],params:def.params||[]};
          _awOpen('edit',_wkItem.id,wizData);
        }).catch(function(){_awOpen('edit',_wkItem.id,{id:_wkItem.id,name:d.name,description:'',icon:'🤖',type:'MONITOR',schedule:{type:'manual'},sources:[],conditions:[],triggers:[],actions:[],params:[]});});
        return;
      }
    }
    _centerState.detail.editing=true;_centerState.detail._orig=d.fields.map(function(f){return{k:f.k,v:f.v};});_centerState.detail._origActions=d.actions.slice();_centerState.detail.actions=['Uložit','Zrušit'];c3.agentLog('TOOL','Editace: '+d.name);renderCenter();
  }else if(a==='Uložit'){
    var view=_centerState.view;var itemId=d._itemId||null;
    if(view==='projects'&&!itemId){var p2=PROJECTS.find(function(p){return p.name===d.name;});if(p2)itemId=p2.id;}
    else if(view==='expertises'){var e2=EXPERTISES.find(function(e){return e.name===d.name;});if(e2)itemId=e2.id;}
    else if(view==='workers'){var w4=WORKERS.find(function(w){return w.name===d.name;});if(w4)itemId=w4.id;}
    var upd={};
    if(view==='projects'){
      var _pfm={'Cesta':'path','Popis':'description','Status':'status'};
      d.fields.forEach(function(f){var mk=_pfm[f.k];if(mk)upd[mk]=f.v;});
    }else{d.fields.forEach(function(f){upd[f.k]=f.v;});}
    var ep=view==='projects'?'/api/projects/':view==='expertises'?'/api/expertises/':view==='workers'?'/api/agents/':null;
    if(d._isNew&&ep){
      upd.name=d.name;
      var postEp=view==='chats'?'/api/conversations':ep.slice(0,-1);
      fetch(_backendBase+postEp,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(created){
        c3.agentLog('TOOL','Vytvoreno: '+d.name);
        if(view==='chats'&&created.id){
          _smartRouteToRelay(function(_ti2){
            _sessions[_ti2]._convId=created.id;
            _sessions[_ti2]._label=d.name||'Nová konverzace';
            _sessions[_ti2].chat.expertise=upd.Expertise||upd.expertise||'Vychozi';
            _sessions[_ti2].chat.msgs=[{role:'system',text:'Nova konverzace: '+d.name}];
            _persistSessionState();renderChat();
          });
        }
        fetchBackendData();
      }).catch(function(){c3.agentLog('TOOL','Vytvoreno lokalne: '+d.name);});
      delete d._isNew;
    }else if(itemId&&ep){fetch(_backendBase+ep+itemId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(res){c3.agentLog('TOOL','Ulozeno: '+d.name);if(view==='projects'&&upd.path){_wtRoot=upd.path;_loadWorkspaceTree(upd.path);c3.agentLog('TOOL','📍 Working tree: '+upd.path);}fetchBackendData();}).catch(function(){c3.agentLog('TOOL','Ulozeno lokalne: '+d.name);});}
    else{c3.agentLog('TOOL','Ulozeno: '+d.name);}
    if(view==='projects'&&itemId){var _pi=PROJECTS.find(function(p){return p.id===itemId;});if(_pi){if(upd.path!==undefined)_pi.path=upd.path;if(upd.description!==undefined)_pi.desc=upd.description;if(upd.status!==undefined)_pi.status=upd.status;}}
    d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;renderCenter();
  }else if(a==='Zrušit'){
    if(d._orig){d.fields=d._orig;}d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;c3.agentLog('TOOL','Editace zrusena');renderCenter();
  }else if(a==='Archivovat'){
    var cid=null;var conv2=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv2&&conv2.id)cid=conv2.id;
    var pid=null;var proj2=PROJECTS.find(function(p){return p.name===d.name;});if(proj2&&proj2.id)pid=proj2.id;
    if(cid){fetch(_backendBase+'/api/conversations/'+cid+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','Konverzace '+d.name+' archivovana.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL',d.name+' archivovano (lokalne).');});}
    else if(pid){fetch(_backendBase+'/api/projects/'+pid+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','Projekt '+d.name+' archivovan.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL',d.name+' archivovano (lokalne).');});}
    else{c3.agentLog('TOOL',d.name+' archivovano.');}
    _centerState.detail=null;renderCenter();
  }else if(a==='Obnovit'){
    var cid3=null;var conv3=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv3&&conv3.id)cid3=conv3.id;
    var pid3=null;var proj3=PROJECTS.find(function(p){return p.name===d.name;});if(proj3&&proj3.id)pid3=proj3.id;
    if(cid3){fetch(_backendBase+'/api/conversations/'+cid3+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','Konverzace '+d.name+' obnovena.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL',d.name+' obnoveno (lokalne).');});}
    else if(pid3){fetch(_backendBase+'/api/projects/'+pid3+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','Projekt '+d.name+' obnoven.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL',d.name+' obnoveno (lokalne).');});}
    _centerState.detail=null;renderCenter();
  }else if(a==='Smazat'){
    var cid4=null;var conv4=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv4&&conv4.id)cid4=conv4.id;
    var pid4=null;var proj4=PROJECTS.find(function(p){return p.name===d.name;});if(proj4&&proj4.id)pid4=proj4.id;
    var eid4=d._itemId||null;var exp4=EXPERTISES.find(function(e){return e.name===d.name;});if(!eid4&&exp4&&exp4.id)eid4=exp4.id;
    if(cid4){fetch(_backendBase+'/api/conversations/'+cid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Konverzace '+d.name+' smazána.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(pid4){fetch(_backendBase+'/api/projects/'+pid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Projekt '+d.name+' smazán.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(eid4){
      /* v122.2: Delete expertise/specialist — disable specialist first if active */
      var _isSpec=SPECIALISTS.find(function(s){return s.name===d.name;});
      var _disableChain=_isSpec?fetch(_backendBase+'/api/specialists/'+eid4+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).catch(function(){}):Promise.resolve();
      _disableChain.then(function(){return fetch(_backendBase+'/api/expertises/'+eid4,{method:'DELETE',signal:AbortSignal.timeout(3000)});})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL',(_isSpec?'Specialista':'Expertyza')+' '+d.name+' smazán(a).');_fetchExpertises();})
      .catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));_fetchExpertises();});
    }
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
  }else if(a==='Smazat trvale'){
    var cid5=null;var conv5=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv5&&conv5.id)cid5=conv5.id;
    var pid5=null;var proj5=PROJECTS.find(function(p){return p.name===d.name;});if(proj5&&proj5.id)pid5=proj5.id;
    if(cid5){fetch(_backendBase+'/api/conversations/'+cid5+'?hard=true',{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Konverzace '+d.name+' trvale smazána.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(pid5){fetch(_backendBase+'/api/projects/'+pid5+'?hard=true',{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Projekt '+d.name+' trvale smazán.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
  }else if(a==='Spustit'){
    var wid=null;var w2=WORKERS.find(function(w){return w.name===d.name;});if(w2&&w2.id)wid=w2.id;
    if(wid){fetch(_backendBase+'/api/agents/'+wid+'/run',{method:'POST',signal:AbortSignal.timeout(5000)}).then(function(){c3.agentLog('TOOL','Worker '+d.name+' spusten.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','Worker '+d.name+' — backend nedostupny.');});}
    else{c3.agentLog('TOOL','Worker '+d.name+' spusten.');}
  }else if(a==='Pozastavit'){
    var wid2=null;var w3=WORKERS.find(function(w){return w.name===d.name;});if(w3&&w3.id)wid2=w3.id;
    if(wid2){fetch(_backendBase+'/api/agents/'+wid2+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).then(function(){c3.agentLog('TOOL','Worker '+d.name+' pozastaven.');fetchBackendData();}).catch(function(){c3.agentLog('TOOL','Worker '+d.name+' — backend nedostupny.');});}
    else{c3.agentLog('TOOL','Worker '+d.name+' pozastaven.');}
  }else if(a==='Přidat do projektu'){
    /* Show project picker overlay in detail */
    _centerState._projectPicker={convName:d.name,projects:PROJECTS.filter(function(p){return p.status!=='archived';}),show:true};
    renderCenter();
  }else if(a==='Nainstalovat'&&_centerState.view==='marketplace'){
    var _mpId=d._itemId;var _mpType=d.fields&&d.fields.find(function(f){return f.k==='Typ';});
    if(_mpId&&_mpType)_mpInstall(_mpType.v,_mpId);
    _centerState.detail=null;renderCenter();
  }else if(a==='Odinstalovat'&&_centerState.view==='marketplace'){
    var _mpId2=d._itemId;var _mpType2=d.fields&&d.fields.find(function(f){return f.k==='Typ';});
    if(_mpId2&&_mpType2)_mpUninstall(_mpType2.v,_mpId2);
    _centerState.detail=null;renderCenter();
  }else if(a==='Aktualizovat'&&_centerState.view==='marketplace'){
    var _mpId3=d._itemId;var _mpType3=d.fields&&d.fields.find(function(f){return f.k==='Typ';});
    if(_mpId3&&_mpType3)_mpUpdate(_mpType3.v,_mpId3);
    _centerState.detail=null;renderCenter();
  }else if(a==='Oblíbené'&&_centerState.view==='multimedia'){
    var _mfId=d._itemId;if(_mfId){var _mfItem=_media.data.find(function(g){return g.id===_mfId;});MediaAPI.toggleFav(_mfId,_mfItem&&_mfItem.favorite);}
    _centerState.detail=null;renderCenter();
  }else if(a==='Zrušit'&&_centerState.view==='multimedia'){
    var _mcId=d._itemId;if(_mcId)MediaAPI.cancel(_mcId);
    _centerState.detail=null;renderCenter();
  }else if(a==='Smazat'&&_centerState.view==='multimedia'){
    var _mdId=d._itemId;if(_mdId)MediaAPI.del(_mdId);
    _centerState.detail=null;renderCenter();
  }else if(a==='Publikovat'){
    var _pubId=d._itemId||null;
    var _pubType=_centerState.view==='specialists'?'specialist':'expertise';
    if(!_pubId){var _pubItem=(_pubType==='specialist'?SPECIALISTS:EXPERTISES).find(function(x){return x.name===d.name;});if(_pubItem)_pubId=_pubItem.id;}
    if(!_pubId){alert('Nelze publikovat — chybí ID.');return;}
    _mpMsg={ok:true,text:'Exportuji '+d.name+'...'};renderCenter();
    fetch(_backendBase+'/api/marketplace/export/'+_pubType+'/'+_pubId,{method:'POST',signal:AbortSignal.timeout(30000)})
      .then(function(r){return r.json();})
      .then(function(result){
        if(result.error){_mpMsg={ok:false,text:result.error};renderCenter();return;}
        var info=result.name+' v'+result.version+' ('+result.type+')\nSHA-256: '+result.sha256+'\nVelikost: '+result.size+' B';
        if(result.catalogEntry){info+='\n\nKatalogový záznam zkopírován do schránky.';}
        _mpMsg={ok:true,text:'Balíček '+result.name+' exportován.'};renderCenter();
        /* Copy catalog entry to clipboard */
        if(result.catalogEntry&&navigator.clipboard){
          navigator.clipboard.writeText(JSON.stringify(result.catalogEntry,null,2)).catch(function(){});
        }
        alert('Export dokončen:\n\n'+info);
      })
      .catch(function(e){_mpMsg={ok:false,text:'Chyba exportu: '+e.message};renderCenter();});
  }
}

/* v65.6: Project picker for conversations */
function _assignConvToProject(convTitle,projectId){
  var conv=CONVERSATIONS.find(function(c){return c.title===convTitle;});
  if(!conv||!conv.id||!projectId)return;
  fetch(_backendBase+'/api/conversations/'+conv.id+'/assign',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project_id:projectId}),signal:AbortSignal.timeout(5000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(){
    if(window._c3)window._c3.agentLog('TOOL','Konverzace "'+convTitle+'" přidána do projektu.');
    _centerState._projectPicker=null;fetchBackendData();renderCenter();
  }).catch(function(err){
    if(window._c3)window._c3.agentLog('TOOL','Chyba při přiřazení: '+(err.message||'neznámá chyba'));
    _centerState._projectPicker=null;renderCenter();
  });
}

/* v65.5: Detail sidebar view */
function centerDetail(){
  var d=_centerState.detail;
  var view=_centerState.view;
  var convs=_centerState.detailConversations;
  var secS={fontSize:_fs(10),fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8,marginTop:12};
  var rowS={display:'flex',padding:'6px 0',fontSize:_fs(12),borderBottom:'1px solid '+C.border};
  var lblS={color:C.tx3,width:110,flexShrink:0,fontWeight:500,fontSize:_fs(11)};
  var valS={color:C.tx1,fontFamily:C.mono,fontSize:_fs(11),flex:1,wordBreak:'break-word'};

  return h(React.Fragment,null,
    /* Header bar — close X on right */
    h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},
      h('span',{style:{fontSize:_fs(14),fontWeight:700,color:C.tx1,flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},d.name),
      d.fields&&d.fields[0]&&d.fields[0].a?pill(d.fields[0].v):null,
      h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',padding:4,borderRadius:4,display:'flex',flexShrink:0},
        onClick:function(){_centerState.detail=null;_centerState.detailConversations=null;renderCenter();}},
        svgEl('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',14))),
    /* Scrollable content */
    h('div',{style:{flex:1,overflowY:'auto',padding:'12px 16px'}},
      /* Info fields — single column for sidebar */
      h('div',{style:{marginBottom:12}},
        (d.fields||[]).map(function(f,i){
          return h('div',{key:i,style:rowS},
            h('span',{style:lblS},f.k),
            f.type==='fav'?h('span',{style:{fontSize:_fs(16),cursor:'pointer',color:f.v?C.accentText:C.tx4,userSelect:'none'},
              onClick:function(ev){ev.stopPropagation();f.v=!f.v;var ex=EXPERTISES.find(function(e){return e.name===f._expertiseName;});if(ex){ex.fav=f.v;if(ex.id){fetch(_backendBase+'/api/expertises/'+ex.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:f.v}),signal:AbortSignal.timeout(3000)}).catch(function(){});}}renderCenter();}},f.v?'★':'☆'):
            d.editing?h('input',{defaultValue:_s(f.v),onChange:function(e){f.v=e.target.value;},
              style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:4,padding:'3px 6px',color:C.tx1,fontFamily:C.mono,fontSize:_fs(11),flex:1,outline:'none',boxSizing:'border-box'}}):
            h('span',{style:Object.assign({},valS,f.a?{color:C.accentText}:{})},_s(f.v)));
        })
      ),
      /* Tags */
      d.tags?h('div',{style:{marginBottom:12}},
        h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
          (d.tags||[]).map(function(t){return h('span',{key:_s(t),style:{padding:'2px 8px',borderRadius:8,background:C.bg4,fontSize:_fs(10),color:C.tx2}},_s(t));}))):null,
      /* v90: Session picker removed — smart routing handles relay selection automatically */
      /* Action buttons */
      d.actions?h('div',{style:{marginBottom:8}},
        h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
          (d.actions||[]).map(function(a,i){
            var isL=_settingsVals.visualMode==='lines';
            var btnS=i===0?{padding:'5px 14px',borderRadius:isL?4:5,border:'none',background:C.accent,color:'#fff',fontFamily:C.font,fontSize:_fs(11),fontWeight:600,cursor:'pointer',transition:'background 0.15s'}
              :isL?{padding:'5px 14px',borderRadius:4,border:'none',background:'transparent',color:C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:400,cursor:'pointer',transition:'background 0.15s'}
              :{padding:'5px 14px',borderRadius:5,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:400,cursor:'pointer',transition:'background 0.15s'};
            return h('button',{key:a,style:btnS,
              onMouseEnter:function(e){if(i>0&&isL)e.currentTarget.style.background='rgba(255,255,255,0.05)';},
              onMouseLeave:function(e){if(i>0&&isL)e.currentTarget.style.background='transparent';},
              onClick:function(){_detailActionHandler(d,a);}},a);
          }))):null,
      /* v65.5: Thin line + project conversations (flat style) */
      view==='projects'&&convs?h('div',{style:{marginTop:4}},
        h('div',{style:{height:1,background:C.border,marginBottom:10}}),
        h('div',{style:secS},'KONVERZACE'),
        convs.length===0?h('div',{style:{fontSize:_fs(11),color:C.tx4,fontStyle:'italic'}},'Žádné konverzace'):
        convs.map(function(cv,ci){
          return h('div',{key:cv.id||ci,onClick:function(){
              var c3=window._c3;if(!c3)return;
              if(cv.id){_smartRouteToRelay(function(_ti){
                var _ts=_sessions[_ti];
                _ts._convId=cv.id;_ts._label=cv.title||'Konverzace';_persistSessionState();
                fetch(_backendBase+'/api/conversations/'+cv.id+'/messages',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(msgs){
                  var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);
                  _ts.chat.msgs=[{role:'system',text:'Konverzace: '+(cv.title||'#'+cv.id)}];
                  items.forEach(function(m){var mt=null;try{mt=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(mt&&mt.mode)||undefined});});
                  renderChat();_chatScrollPane(_ti);
                }).catch(function(){});
              });}
            },
            style:{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:'1px solid '+C.border,cursor:'pointer',transition:'background 0.15s'},
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background='transparent';}},
            h('span',{style:{fontSize:_fs(12),flexShrink:0,color:C.tx3}},'💬'),
            h('div',{style:{flex:1,minWidth:0}},
              h('div',{style:{fontSize:_fs(11.5),fontWeight:600,color:C.tx1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},cv.title||'#'+cv.id),
              h('div',{style:{fontSize:_fs(10),color:C.tx4}},cv.updated||cv.created||'')),
            h('span',{style:{fontSize:_fs(10),color:C.tx4,flexShrink:0,fontFamily:C.mono}},cv.expertise||''));
        })):null,
      /* v65.6: Project picker overlay */
      _centerState._projectPicker&&_centerState._projectPicker.show?h('div',{style:{marginTop:8}},
        h('div',{style:{height:1,background:C.border,marginBottom:10}}),
        h('div',{style:secS},'PŘIDAT DO PROJEKTU'),
        (_centerState._projectPicker.projects||[]).map(function(p){
          return h('div',{key:p.id||p.name,
            onClick:function(){_assignConvToProject(_centerState._projectPicker.convName,p.id);},
            style:{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:'1px solid '+C.border,cursor:'pointer',transition:'background 0.15s'},
            onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background='transparent';}},
            h('span',{style:{fontSize:_fs(12),flexShrink:0}},p.emoji||'📁'),
            h('span',{style:{fontSize:_fs(11.5),fontWeight:600,color:C.tx1}},p.name));
        }),
        h('button',{style:{marginTop:6,background:'transparent',border:'1px solid '+C.border,borderRadius:4,padding:'3px 10px',fontSize:_fs(10),color:C.tx4,cursor:'pointer'},
          onClick:function(){_centerState._projectPicker=null;renderCenter();}},'Zrušit')):null
    )
  );
}

/* ── File open / diff open event listeners (Blok E) ── */
document.addEventListener('c3-file-open',function(e){
  var path=e.detail&&e.detail.path;
  if(!path)return;
  if(window._c3OpenFileInEditor){
    window._c3OpenFileInEditor(path);
  }else{
    _openFileTab(path);
  }
});
/* ── File → Open Folder handler (Theia command override) ── */
document.addEventListener('c3-open-folder',function(){
  try{var inp=document.createElement('input');inp.type='file';inp.webkitdirectory=true;
    inp.addEventListener('change',function(){if(!inp.files||!inp.files.length)return;var fp=(inp.files[0].path||'').replace(/\\/g,'/').split('/');var folderPath=fp.slice(0,-1).join('/');if(!folderPath)return;_c3OpenFolderDo(folderPath);});
    inp.click();}catch(e){if(window._c3)window._c3.agentLog('TOOL','❌ Nelze otevřít dialog: '+(e.message||e));}
});
function _c3OpenFolderDo(folderPath){
  fetch(_backendBase+'/api/projects/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({folderPath:folderPath}),signal:AbortSignal.timeout(15000)})
  .then(function(r){if(!r.ok)throw new Error('Server error '+r.status);return r.json();})
  .then(function(res){
    var proj=res.project;var realPath=(proj&&proj.path)||folderPath;
    _wtRoot=realPath;_loadWorkspaceTree(realPath);
    _smartRouteToRelay(function(_ti){
      if(proj&&proj.id){_sessions[_ti]._projectId=proj.id;_sessions[_ti]._conversationFocus=false;_sessions[_ti]._label=proj.name||folderPath.split('/').filter(Boolean).pop()||'Projekt';_syncFocusClass();_persistSessionState();}
      if(window._c3){window._c3.agentLog('TOOL','📂 Složka otevřena: '+realPath);}
      fetchBackendData();renderCenter();renderChat();
    });
  }).catch(function(err){
    if(window._c3)window._c3.agentLog('TOOL','❌ Chyba: '+(err.message||err));
  });
}
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
/* v132: Attach media event listeners (guarded — single attach) */
if(typeof MediaEvents!=='undefined')MediaEvents.attach();

/* Nav event handler */
window.addEventListener('c3-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;_centerState.detailConversations=null;_centerState.settingsSection=null;_centerState._bulkMode=false;_centerState._bulkSelected=[];_editorState.active=false;if(_centerContainer)_centerContainer.style.display='';_settingsVals.lastView=e.detail.view||'';_saveSV();fetchBackendData();renderCenter();
  if(e.detail.select){
    var name=e.detail.select,view=e.detail.view,item=null;
    if(view==='expertises'){item=EXPERTISES.find(function(x){return x.name===name||x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Typ',v:item.desc},{k:'Doména',v:item.domain||'general'},{k:'Emoji',v:item.emoji},{k:'Specialista',v:item.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:item.fav?'Ano':'Ne'}],tags:[item.isSpecialist?'Specialista':'Expertyza',item.domain||item.desc].filter(Boolean),actions:['Otevřít','Editovat']});}
    else if(view==='projects'){item=PROJECTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,_itemId:item.id,fields:[{k:'Status',v:item.status,a:item.status==='Active'},{k:'Cesta',v:item.path||''},{k:'Popis',v:item.desc||''},{k:'Vytvořeno',v:item.created}],tags:item.tags,actions:['Otevřít','Editovat','Archivovat']});}
    else if(view==='chats'){item=CONVERSATIONS.find(function(x){return x.title.indexOf(name)>=0;});if(item)setDetail({name:item.title,fields:[{k:'Expertyza',v:item.expertise},{k:'Čas',v:item.time}],tags:['Chat',item.expertise],actions:['Otevřít','Archivovat']});}
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
  _openToken:null,       /* guard: project switch during async — stale responses ignored */
  _lifecycleResumed:false, /* guard: lifecycle resume message shown only once */
  _label:'',             /* v90: snapshot label for relay header — persisted */
  chat:{msgs:[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}],ctx:0,expertise:'Výchozí',specialist:null,showExpertises:false,showAllExpertises:false,attachments:[],editMode:'ask',editingIdx:null,editOriginalText:null,acSuggestion:null,acLoading:false,_thinking:null,_delivery:null,_sendContextToken:{},_sendTurnToken:{},_preparedSend:null},
  bottom:'split', /* 'agent' | 'terminal' | 'split' | 'mix' */
  log:[],
  term:[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}],
  _focusFiles:[],  /* v92: files tracked during specialist focus mode */
  _focusBulkMode:false,  /* v92: file selection mode */
  _focusBulkSelected:[],  /* v92: selected file indices */
  _conversationFocus:false /* v125.7: default OFF — focus activates on explicit user action (toggle/new conv), not on startup */
};}
var _sessions=[_mkSession(),_mkSession()];
/* Expose globally so terminal-client.js and agent-client.js can access session state */
window._sessions=_sessions;
function _ensureSessions(){while(_sessions.length<_sessionCount)_sessions.push(_mkSession());}
function _setSessionCount(n){
  var nextCount=Math.max(1,Math.min(3,n));
  if(nextCount<_sessionCount){for(var i=nextCount;i<_sessionCount;i++){
    if(!_chatCancelPreparedSend(i,_sessions[i]))_chatInvalidatePreparedSends(_sessions[i]&&_sessions[i].chat);
  }}
  _sessionCount=nextCount;if(_sessionActive>=_sessionCount)_sessionActive=_sessionCount-1;_ensureSessions();renderChat();renderAgent();
}

/* ── Focus Mode (derived state — no snapshot, no _focusMode variable) ── */
/* v122.2: Also active when conversation is opened in center-panel mode */
function isFocusActive(){var s=_sessions[_sessionActive];return !!(s&&(s.chat&&s.chat.specialist||s._conversationFocus));}
function isSpecialistFocus(){var s=_sessions[_sessionActive];return !!(s&&s.chat&&s.chat.specialist);}
function isConversationFocus(){var s=_sessions[_sessionActive];return !!(s&&s._conversationFocus);}
var _focusExitDialog=null; /* v92: {pendingAction:fn|null} — confirmation dialog state */
function _syncFocusClass(){
  var wasFocus=document.body.classList.contains('c3-focus-mode');
  var isFocus=isFocusActive();
  document.body.classList.toggle('c3-focus-mode',isFocus);
  /* v122.3: Ensure center container is visible when focus active (may have been hidden by toggle-off) */
  if(isFocus&&_centerContainer&&_centerContainer.style.display==='none'){_centerContainer.style.display='';}
  /* Sidebar resize via shell API (same pattern as collapsed toggle, line 688) */
  try{var app=window._c3App;if(app&&app.shell&&typeof app.shell.resize==='function'){
    if(isFocus&&!wasFocus){_c3SnapLock=true;app.shell.resize(48,'left');setTimeout(function(){_c3SnapLock=false;},600);}
    else if(!isFocus&&wasFocus){_c3SnapLock=true;app.shell.resize(240,'left');setTimeout(function(){_c3SnapLock=false;},600);}
  }}catch(ex){}
  /* Force Lumino relayout after CSS class change */
  requestAnimationFrame(function(){window.dispatchEvent(new Event('resize'));});
}
function _renderAll(){_syncFocusClass();renderCenter();renderChat();renderAgent();renderSidebar();}
function _focusFileExists(s,name,path){return s._focusFiles.some(function(x){return(path&&x.path&&x.path===path)||x.name===name;});}
function _relativeTime(ts){if(!ts)return '';var d=Date.now()-ts;if(d<60000)return 'teď';if(d<3600000)return Math.round(d/60000)+' min';if(d<86400000)return Math.round(d/3600000)+' h';return Math.round(d/86400000)+' d';}

/* v90: Relay helpers */
function _isSessionEmpty(s){return !s._convId&&!s._projectId&&(!s.chat||!s.chat.msgs||s.chat.msgs.length<=1);}
function _findFreeRelay(excludeIdx){for(var i=0;i<_sessionCount;i++){if(i===excludeIdx)continue;if(_isSessionEmpty(_sessions[i]))return i;}return -1;}
/* v90: Relay picker dialog state */
var _relayPickDialog=null; /* null | {callback, action} */
function _chatPrepareRelayTarget(idx){
  var target=_sessions[idx];
  if(!_chatCancelPreparedSend(idx,target))_chatInvalidatePreparedSends(target&&target.chat);
}
function _smartRouteToRelay(callback){
  var free=_findFreeRelay(-1);
  if(free>=0){_ensureSessions();_switchSession(free);_chatPrepareRelayTarget(free);callback(free);return;}
  if(_sessionCount<3){_setSessionCount(_sessionCount+1);_ensureSessions();var ni=_sessionCount-1;_switchSession(ni);_chatPrepareRelayTarget(ni);callback(ni);return;}
  /* All 3 occupied → show picker */
  _relayPickDialog={callback:function(targetIdx){_chatPrepareRelayTarget(targetIdx);callback(targetIdx);}};renderChat();
}

/* v91: Open-target dialog — replace current session vs open in new */
var _openTargetDialog=null; /* null | {type:'conv'|'proj', data:Object, loadFn:Function} */
function _showOpenDialog(type,data,loadFn){
  var cur=_sessions[_sessionActive];
  if(_isSessionEmpty(cur)){_chatPrepareRelayTarget(_sessionActive);loadFn(_sessionActive);return;}
  _openTargetDialog={type:type,data:data,loadFn:loadFn};renderChat();
}
function _openTargetDialogAction(choice){
  if(!_openTargetDialog)return;var dlg=_openTargetDialog;_openTargetDialog=null;
  if(choice==='replace'){var idx=_sessionActive;_chatInvalidatePreparedSends(_sessions[idx]&&_sessions[idx].chat);_sessions[idx]=_mkSession();_ensureSessions();dlg.loadFn(idx);}
  else if(choice==='new'){_smartRouteToRelay(dlg.loadFn);}
  renderChat();
}

/* v64.4: New-chat dialog state */
var _newChatDialog=null; /* null | {idx, projectId, projectName} */

function _resetSessionToClean(s){
  _chatInvalidatePreparedSends(s&&s.chat);
  s._label='';s._convId=null;s._agentId=null;s._projectId=null;s._lifecycleResumed=false;
  s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
}
function _newChatInProject(idx){
  var s=_sessions[idx];if(!s)return;
  /* v122.3: In conversation focus — just reset current session, no relay routing */
  if(s._conversationFocus&&!s._projectId){_resetSessionToClean(s);_sessionActive=idx;_persistSessionState();renderChat();renderCenter();return;}
  /* v90: New "+" button logic with smart relay routing */
  /* 1. Current pane is empty → just reset it */
  if(_isSessionEmpty(s)){_resetSessionToClean(s);_sessionActive=idx;_persistSessionState();renderChat();return;}
  /* If current pane has a project → offer in-project or free choice */
  var projId=s._projectId;
  var proj=projId?PROJECTS.find(function(p){return p.id===projId;}):null;
  if(proj){_newChatDialog={idx:idx,projectId:projId,projectName:proj.name};renderChat();return;}
  /* 2. Current pane is occupied (no project) → find free relay elsewhere */
  var free=_findFreeRelay(idx);
  if(free>=0){_ensureSessions();_switchSession(free);_resetSessionToClean(_sessions[free]);_persistSessionState();renderChat();return;}
  /* 3. Can expand → add new relay */
  if(_sessionCount<3){_setSessionCount(_sessionCount+1);_ensureSessions();var ni=_sessionCount-1;_switchSession(ni);_resetSessionToClean(_sessions[ni]);_persistSessionState();renderChat();return;}
  /* 4. All 3 occupied → relay picker dialog */
  _relayPickDialog={callback:function(ti){_resetSessionToClean(_sessions[ti]);_ensureSessions();_switchSession(ti);_persistSessionState();renderChat();}};renderChat();
}
function _newChatDialogAction(choice){
  if(!_newChatDialog)return;
  var idx=_newChatDialog.idx;var s=_sessions[idx];if(!s){_newChatDialog=null;renderChat();return;}
  if(choice==='project'||choice==='free')_chatInvalidatePreparedSends(s.chat);
  if(choice==='project'){
    /* New conversation in same project */
    s._label=_newChatDialog.projectName;
    s.chat.msgs=[{role:'system',text:'📂 Nová konverzace v projektu: '+_newChatDialog.projectName}];
    s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;s._convId=null;s._agentId=null;
    /* Create new conversation linked to project */
    fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:_newChatDialog.projectId,title:_newChatDialog.projectName}),signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();}).then(function(d){if(d.id||d.conversation){s._convId=(d.conversation||d).id;_persistSessionState();}}).catch(function(){});
  } else if(choice==='free'){
    /* New conversation outside project */
    s._label='';
    s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
    s._convId=null;s._agentId=null;s._projectId=null;s._lifecycleResumed=false;
    /* Clear tree for this session */
    _perSessionTree[idx]=null;
    if(idx===_sessionActive){_wtRoot='';_wtRawTree=null;FILES=[];renderSidebar();}
  }
  /* choice==='cancel' → do nothing */
  _newChatDialog=null;_sessionActive=idx;_persistSessionState();renderChat();
}

/* v70: Close-pane dialog state */
var _closeDialog=null; /* null | {idx} */
function _closeDialogAction(choice){
  if(!_closeDialog)return;
  var idx=_closeDialog.idx;var s=_sessions[idx];
  _closeDialog=null;
  if(!s){renderChat();return;}
  if(choice==='conv'||choice==='pane')_chatInvalidatePreparedSends(s.chat);
  if(choice==='conv'){
    /* A) Close conversation only — reset pane to empty state */
    s._convId=null;s._projectId=null;s._agentId=null;s._lifecycleResumed=false;s._label='';
    s.chat.msgs=[];
    s.chat.ctx=0;s.chat.expertise='Výchozí';s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
    var _now=new Date();
    s.log=[{time:_now.toLocaleTimeString('cs-CZ'),type:'SYSTEM',cls:'system',text:'C3 Studio připraven. Začni psát zprávu.',active:true,ts:_now.toISOString()}];
    s.term=[{text:'$ ',ts:_now.toISOString(),type:'prompt'}];
    _perSessionTree[idx]=null;
    if(idx===_sessionActive){_wtRoot='';_wtRawTree=null;FILES=[];renderSidebar();}
    _persistSessionState();
  } else if(choice==='pane'){
    /* B) Close conversation + reduce panel count */
    s._convId=null;s._projectId=null;s._agentId=null;s._lifecycleResumed=false;s._label='';
    s.chat.msgs=[];
    s.chat.ctx=0;s.chat.expertise='Výchozí';s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
    s.log=[];s.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
    _perSessionTree[idx]=null;
    if(_sessionCount>1){
      /* Swap closed pane with last pane if not already last, then reduce count */
      if(idx<_sessionCount-1){
        var lastIdx=_sessionCount-1;var last=_sessions[lastIdx];
        if(!_chatCancelPreparedSend(lastIdx,last))_chatInvalidatePreparedSends(last&&last.chat);
        _sessions[lastIdx]=s;_sessions[idx]=last;
        var tmpTree=_perSessionTree[_sessionCount-1];_perSessionTree[_sessionCount-1]=_perSessionTree[idx];_perSessionTree[idx]=tmpTree;
        if(_sessionActive===_sessionCount-1)_sessionActive=idx;
      }
      _setSessionCount(_sessionCount-1);
    }
    _persistSessionState();
    if(_sessionActive>=_sessionCount)_sessionActive=_sessionCount-1;
    if(idx===_sessionActive||_sessionActive<0)_sessionActive=0;
  }
  /* choice==='cancel' → do nothing */
  renderChat();renderAgent();
}

var _chatContainer=null;

/* ── Bus subscriptions (transport → UI) ── */
function _initBusSubscriptions() {
  if (typeof C3Bus === 'undefined') { console.warn('[C3] C3Bus not available yet'); return; }

  /* Chat messages from assistant */
  C3Bus.on('chat:message', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
    s.chat._thinking = null; /* v90: response arrived — clear thinking indicator */
    s.chat.msgs.push({role:'assistant', text:ev.content, tag:ev.tag||'LLM'});
    /* Update session convId from backend response (new conversation or first message) */
    var respConvId = ev.metadata && ev.metadata.conversationId;
    if (respConvId && !s._convId) { s._convId = respConvId; _persistSessionState(); }
    if (ev.metadata && typeof ev.metadata.contextPercent === 'number') s.chat.ctx = ev.metadata.contextPercent;
    /* v65.0: If SHELL intent — switch to split/terminal so user sees output */
    if (ev.metadata && ev.metadata.shellCommand) {
      if (s.bottom !== 'split' && s.bottom !== 'terminal') { s.bottom = 'split'; }
      renderAgent();
    }
    /* v88+v122.2: Refresh expertises after create-expertise or create-specialist skill completes */
    _maybeRefreshExpertises(ev.metadata);
    renderChat(); _chatScrollPane(ev.sessionIdx);
  });

  /* Negotiated M1 has one terminal seam for ok/cancel/timeout/error. */
  C3Bus.on('chat:terminal', function(ev) {
    var s = _sessions[ev.sessionIdx] || null;
    if (!s || !s.chat) return;
    var result = ev.result || {};
    if (ev.action === 'cancel') {
      var cancelError = result.error || {};
      var cancelText = ev.status === 'cancelled'
        ? 'Zrušení potvrzeno.'
        : (cancelError.message || (ev.status === 'timeout'
          ? 'Potvrzení zrušení vypršelo.'
          : 'Zrušení nebylo potvrzeno.'));
      if (Array.isArray(s.log)) {
        s.log.push({
          time:new Date().toLocaleTimeString('cs-CZ'),type:'CANCEL',
          cls:ev.status==='cancelled'?'info':'error',text:cancelText,
          active:false,ts:new Date().toISOString()
        });
      }
      if (ev.status !== 'cancelled') {
        s.chat.msgs.push({role:'system',text:cancelText,tag:String(ev.status||'error').toUpperCase()});
      }
      _persistSessionState();
      renderAgent();renderChat();_chatScrollPane(ev.sessionIdx);
      return;
    }
    s.chat._thinking = null;
    var terminalError = result.error || {};
    var deliveryUnknown = ev.status === 'error' && (
      terminalError.code === 'M1_CONNECTION_REPLACED'
      || terminalError.code === 'M1_CONNECTION_INTERRUPTED'
      || terminalError.code === 'M1_CLIENT_DESTROYED'
      || terminalError.code === 'M1_PROTOCOL_ERROR'
    );
    s.chat._delivery = deliveryUnknown ? {
      status:'DELIVERY_UNKNOWN',retryable:false,reason:terminalError.code,
      text:'Spojení skončilo po odeslání; výsledek požadavku nelze bezpečně určit.'
    } : null;
    if (ev.renderAssistant === true && ev.status === 'ok' && result.response) {
      var metadata = result.response.metadata || {};
      s.chat.msgs.push({
        role:'assistant',
        text:result.response.content,
        tag:metadata.mode||'LLM'
      });
      if (metadata.contextPercent !== undefined) s.chat.ctx = metadata.contextPercent;
      _maybeRefreshExpertises(metadata);
    } else {
      var text = terminalError.message || (
        ev.status === 'cancelled'
          ? 'Zpracování zrušeno.'
          : ev.status === 'timeout'
            ? 'Zpracování vypršelo.'
            : 'Zpracování selhalo.'
      );
      s.chat.msgs.push({role:'system',text:text,tag:String(ev.status||'error').toUpperCase()});
    }
    _persistSessionState();
    renderChat();_chatScrollPane(ev.sessionIdx);
  });

  /* System messages → agent log */
  C3Bus.on('chat:system', function(ev) {
    if(window._c3)window._c3.agentLog('TOOL',ev.content);
  });

  /* Session changed (rehydration after WS reconnect) */
  C3Bus.on('session:changed', function(ev) {
    renderChat(); renderAgent();
    if (typeof ev.idx === 'number') _chatScrollPane(ev.idx);
  });

  /* A fresh Studio pane receives a durable routing identity before first send. */
  C3Bus.on('session:identity', function() {
    _persistSessionState();
  });

  /* WS reconnected — trigger re-render to show restored messages */
  C3Bus.on('ws:reconnected', function() {
    renderChat(); renderAgent();
  });

  /* Agent log entries (from agent-client.js formatter) */
  C3Bus.on('agent:log', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
    s.log.forEach(function(l) { l.active = false; });
    s.log.push(ev.entry);
    /* v90: Update thinking indicator text from agent steps */
    if (s.chat._thinking && ev.entry && ev.entry.text) {
      s.chat._thinking.text = ev.entry.text;
      renderChat();
    }
    renderAgent();
  });

  /* Agent execution state is updated after chat:terminal in production
     subscription order, so it owns a separate post-clear render signal. */
  C3Bus.on('agent:state', function() {
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
      renderSidebar();_updateStatusIndicator();
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
    renderSidebar();_updateStatusIndicator();
  });

  /* WS disconnected */
  C3Bus.on('ws:disconnected', function(ev) {
    _serverHealth.wsConnected = false;
    if (ev.wasReady) {
      if(window._c3)window._c3.agentLog('TOOL','⚠️ Spojení s backendem ztraceno. Pokus o reconnect...');
    }
    renderSidebar();_updateStatusIndicator();
  });

  /* WS reconnect budget exhausted — remain visibly offline. */
  C3Bus.on('ws:reconnect_exhausted', function(ev) {
    _serverHealth.wsConnected = false;
    _serverHealth.status = 'offline';
    if(window._c3)window._c3.agentLog(
      'TOOL',
      '❌ Spojení se nepodařilo obnovit po '+ev.attempts+' pokusech. Zkontrolujte backend a restartujte Studio.'
    );
    renderSidebar();_updateStatusIndicator();
  });

  /* WS reconnected */
  C3Bus.on('ws:reconnected', function(ev) {
    if(window._c3){
      if(ev&&ev.status==='degraded'){
        window._c3.agentLog('TOOL','⚠️ Spojení obnoveno, ale některé relace se nepodařilo bezpečně obnovit.');
      }else{
        window._c3.agentLog('TOOL','✅ Spojení obnoveno.');
      }
    }
    renderSidebar();
  });

  /* Model pull progress (v121.2) */
  C3Bus.on('model:pull_progress', function(ev) {
    var m=ev.model;if(!m)return;
    _pullState[m]={status:ev.status||'unknown',percent:ev.percent||0,text:ev.text||'',
      downloadedGB:ev.downloadedGB,totalGB:ev.totalGB,eta:ev.eta,scores:ev.scores||null};
    if(ev.status==='done'||ev.status==='error'){
      /* Refresh discovered data after completion */
      _discoveredData=null;_loadDiscoveredData();
    }
    renderCenter();
  });

  C3Bus.on('model:validation_progress', function(ev) {
    var m=ev.model;if(!m)return;
    _validationProgress={suite:ev.suite||'',testName:ev.testName||'',percent:ev.percent||0,text:ev.text||''};
    /* Route details to log panel */
    if(window._c3){
      if(ev.status==='starting'){
        window._c3.agentLog('TOOL','\uD83E\uDDEA Validace '+m+' \u2014 spou\u0161t\u00EDm testy...');
      }else if(ev.status==='running'&&ev.testName){
        window._c3.agentLog('TOOL','\uD83D\uDD04 ['+ev.suite+'] '+ev.testName+' ('+ev.currentTest+'/'+ev.totalTests+')');
      }else if(ev.status==='complete'&&ev.suite){
        var pct=ev.score!=null?Math.round(ev.score*100)+'%':'?';
        window._c3.agentLog('TOOL','\u2705 ['+ev.suite+'] hotovo \u2014 sk\u00F3re: '+pct);
      }else if(ev.status==='done'){
        var overall=ev.overallScore!=null?Math.round(ev.overallScore*100)+'%':'?';
        window._c3.agentLog('TOOL','\uD83C\uDFC1 Validace '+m+' dokon\u010Dena \u2014 celkov\u00E9 sk\u00F3re: '+overall);
        if(ev.results){ev.results.forEach(function(r){
          window._c3.agentLog('TOOL','   '+r.suite+': '+Math.round(r.score*100)+'% ('+r.passed+'/'+r.total+')');
        });}
      }else if(ev.status==='error'){
        window._c3.agentLog('TOOL','\u274C Validace '+m+' selhala: '+(ev.text||'nezn\u00E1m\u00E1 chyba'));
      }
    }
    /* v133: Track batch validation state */
    if(ev.batchIndex!=null){
      _batchValidating=true;_batchCurrent=ev.model;
      if((ev.status==='done'||ev.status==='error')&&ev.batchIndex===ev.batchTotal){
        _batchValidating=false;_batchCurrent=null;_modelOverview=null;
      }
    }
    if(ev.status==='done'||ev.status==='error'){
      _validatingModel=null;_validationProgress=null;
      /* Store results if provided */
      if(ev.results){
        if(!_validationScores[m])_validationScores[m]={};
        ev.results.forEach(function(r){_validationScores[m][r.suite]={score:r.score,validatedAt:new Date().toISOString()};});
      }
      /* Also refresh from backend */
      _loadValidationScores();
      _modelOverview=null;/* invalidate overview cache */
    }
    renderCenter();
  });

  /* v125: Model changed via WS (fire-and-forget apply) */
  C3Bus.on('model:changed', function(ev) {
    _upgradeLoading=false;_assigningRole=null;_roleBindings=null;_modelOverview=null;
    _upgradeMsg={ok:true,text:'Upgrade '+ev.role+': '+(ev.fromModel||'?')+' \u2192 '+(ev.toModel||'?')};
    if(window._c3)window._c3.agentLog('TOOL','\u2705 Model zm\u011Bn\u011Bn: '+ev.role+' '+(ev.fromModel||'?')+' \u2192 '+(ev.toModel||'?'));
    _upgradeData=null;_loadUpgradeData();renderCenter();
    setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);
  });

  /* v125: Upgrade progress (intermediate status) */
  C3Bus.on('upgrade:progress', function(ev) {
    _upgradeMsg={ok:true,text:ev.text||'Aplikuji...'};
    if(window._c3)window._c3.agentLog('TOOL','\uD83D\uDD04 '+(ev.text||'Aplikuji upgrade...'));
    renderCenter();
  });

  /* v125: Upgrade error via WS */
  C3Bus.on('upgrade:error', function(ev) {
    _upgradeLoading=false;
    var errMsg=ev.error||'Upgrade selhal';
    /* Translate common BE errors to user-friendly CZ */
    if(errMsg.indexOf('already set')>=0)errMsg='Model je ji\u017E nastaven pro tuto roli';
    else if(errMsg.indexOf('Upgrade in progress')>=0)errMsg='Prob\u00EDh\u00E1 jin\u00FD upgrade \u2014 vy\u010Dkejte';
    else if(errMsg.indexOf('file does not exist')>=0||errMsg.indexOf('not found')>=0)errMsg='Model neexistuje v Ollama registru \u2014 nelze st\u00E1hnout';
    else if(errMsg.indexOf('not installed')>=0)errMsg='Model nen\u00ED nainstalovan\u00FD a pull selhal';
    _upgradeMsg={ok:false,text:errMsg};
    if(window._c3)window._c3.agentLog('TOOL','\u274C Upgrade selhal: '+errMsg);
    renderCenter();
    setTimeout(function(){_upgradeMsg=null;renderCenter();},8000);
  });

  /* v125: Background verify failed warning */
  C3Bus.on('upgrade:verify_failed', function(ev) {
    _upgradeRecoveryReceiveFailure(ev);
    var warning={ok:false,text:ev.text||'Varování: model neodpovídá na ping'};_upgradeMsg=warning;
    if(window._c3)window._c3.agentLog('TOOL','\u26A0\uFE0F '+(ev.text||'Model neodpov\u00EDd\u00E1 na ping'));
    renderCenter();
    setTimeout(function(){if(_upgradeMsg===warning){_upgradeMsg=null;renderCenter();}},15000);
  });

  /* M1: bounded UX invalidation; repository CAS remains authoritative. */
  C3Bus.on('upgrade:verify_cleared', function(ev) {
    if(_upgradeRecoveryReceiveClear(ev))renderCenter();
  });

  /* v125: Validation prompt after model change */
  C3Bus.on('model:validation_prompt', function(ev) {
    _validationPrompt=ev;renderCenter();
  });

  /* v133: Model deleted — refresh overview */
  C3Bus.on('model:deleted', function(ev) {
    _modelOverview=null;_installedModels=null;_ollamaModels=null;_deletingModel=null;_deleteConfirm=null;
    if(window._c3)window._c3.agentLog('TOOL','\uD83D\uDDD1 Model smaz\u00E1n: '+ev.model+' (uvoln\u011Bno '+ev.freedGB+' GB)');
    renderCenter();
  });

  /* v133: Auto-cleanup deleted a model */
  C3Bus.on('model:auto_cleaned', function(ev) {
    _modelOverview=null;_installedModels=null;_ollamaModels=null;
    if(window._c3)window._c3.agentLog('TOOL','\uD83E\uDDF9 Auto-cleanup: smaz\u00E1n '+ev.model);
    renderCenter();
  });

  /* v133: Auto-rebind — bound model disappeared externally */
  C3Bus.on('model:auto_rebound', function(ev) {
    _roleBindings=null;_modelOverview=null;
    if(window._c3)window._c3.agentLog('TOOL','\uD83D\uDD04 Auto-rebind: '+ev.role+' '+ev.from+' \u2192 '+ev.to);
    renderCenter();
  });

  /* Session changed (e.g. after rehydration) */
  C3Bus.on('session:changed', function(ev) {
    renderChat(); renderAgent();
    _persistSessionState();
  });

  /* Transport already cleared this exact unchanged session after a complete ACK. */
  C3Bus.on('session:invalidated', function(ev) {
    if(
      !ev
      || typeof ev.idx!=='number'
      || _sessions[ev.idx]!==ev.sessionRef
      || ev.sessionRef._convId!==null
    )return;
    var s=ev.sessionRef;
    _chatInvalidatePreparedSends(s.chat);
    _persistSessionState();
    if(window._c3)window._c3.agentLog('TOOL','⚠️ Konverzace již neexistuje na serveru.');
    renderChat();renderAgent();
  });

  /* Malformed persisted identity is preserved but cannot perform chat effects. */
  C3Bus.on('session:quarantined', function(ev) {
    if(!ev||typeof ev.idx!=='number'||_sessions[ev.idx]!==ev.sessionRef)return;
    _chatInvalidatePreparedSends(ev.sessionRef.chat);
    _persistSessionState();
    if(window._c3)window._c3.agentLog('TOOL','⚠️ Relace má neplatnou lokální identitu a zůstává pouze pro čtení.');
    renderChat();renderAgent();
  });

  /* A legacy uncorrelated warning has no authority to mutate a panel. */
  C3Bus.on('session:identity_warning', function() {
    if(window._c3)window._c3.agentLog('TOOL','⚠️ Server ohlásil neověřený stav identity; relace byla zachována.');
  });
}

/* ── Health state ── */
var _serverHealth = {status:'unknown', wsConnected:false, lastCheck:0, version:null};

/* ── Status-bar health indicator (injected into Theia status bar) ── */
function _updateStatusIndicator(){
  var el=document.getElementById('c3-health-indicator');
  if(!el){
    var bar=document.querySelector('#theia-statusBar .area.left');
    if(!bar)return;
    el=document.createElement('div');
    el.id='c3-health-indicator';
    el.style.cssText='display:flex;align-items:center;gap:5px;padding:0 8px;height:100%;cursor:default;font-size:10px;';
    bar.insertBefore(el,bar.firstChild);
  }
  var ok=_serverHealth.status==='ok';
  var ws=_serverHealth.wsConnected;
  var color=ok&&ws?'#22c55e':ok?'#f59e0b':'#ef4444';
  var label=ok?(ws?'Online':'WS odpojen'):'Offline';
  el.innerHTML='<span style="width:6px;height:6px;border-radius:50%;background:'+color+';display:inline-block;"></span><span style="color:'+color+';font-weight:600;letter-spacing:0.3px;">'+label+'</span>';
  el.title=ok?(ws?'Backend OK + WebSocket':'Backend OK, WebSocket odpojen'):'Backend offline';
}
/* Kick-start indicator once Theia DOM is ready */
setTimeout(_updateStatusIndicator,2000);
setTimeout(_updateStatusIndicator,5000);

/* ── Session persistence (crash recovery) ── */
var _persistDebounce = null;
function _persistSessionState() {
  clearTimeout(_persistDebounce);
  _persistDebounce = setTimeout(function() {
    try {
      localStorage.setItem('c3-session-state', JSON.stringify({
        sessionCount: _sessionCount,
        sessionActive: _sessionActive,
        sessions: _sessions.map(function(s, i) {
          /* Persist last 20 messages for instant restore */
          var recentMsgs = (s.chat.msgs || []).slice(-20).map(function(m) {
            return { role: m.role, text: m.text, tag: m.tag };
          });
          return {
            convId: s._convId,
            projectId: s._projectId,
            agentId: s._agentId,
            label: s._label,
            expertiseName: s.chat.expertise,
            specialistData: s.chat.specialist,
            editMode: s.chat.editMode,
            bottomMode: s.bottom,
            wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
            recentMsgs: recentMsgs,
            focusFiles: s._focusFiles||[],
            lastAttachDir: s.chat._lastAttachDir||''
          };
        })
      }));
    } catch(e) {}
  }, 1000);
}

/* ── Flush session state synchronously before unload ── */
window.addEventListener('beforeunload', function() {
  clearTimeout(_persistDebounce);
  try {
    localStorage.setItem('c3-session-state', JSON.stringify({
      sessionCount: _sessionCount, sessionActive: _sessionActive,
      sessions: _sessions.map(function(s, i) {
        var recentMsgs = (s.chat.msgs || []).slice(-20).map(function(m) {
          return { role: m.role, text: m.text, tag: m.tag };
        });
        return {
          convId: s._convId, projectId: s._projectId, agentId: s._agentId,
          label: s._label,
          expertiseName: s.chat.expertise, editMode: s.chat.editMode,
          bottomMode: s.bottom,
          wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
          recentMsgs: recentMsgs,
          focusFiles: s._focusFiles||[],
          lastAttachDir: s.chat._lastAttachDir||''
        };
      })
    }));
    /* Flush settings (lastView) synchronously */
    _settingsVals.lastView=_centerState.view||'';
    localStorage.setItem('c3-settings',JSON.stringify(_settingsVals));
  } catch(e) {}
});

function _normalizePersistedSessionState(saved) {
  var count=(saved&&Number.isInteger(saved.sessionCount))
    ?Math.max(1,Math.min(3,saved.sessionCount)):2;
  var active=(saved&&Number.isInteger(saved.sessionActive))
    ?Math.max(0,Math.min(count-1,saved.sessionActive)):0;
  var sessions=(saved&&Array.isArray(saved.sessions))
    ?saved.sessions.slice(0,count):[];
  return {sessionCount:count,sessionActive:active,sessions:sessions};
}

/* ── Restore session state from localStorage ── */
function _restoreSessionState() {
  try {
    /* Restore last view (from settings, independent of session state) */
    var _lastV = (_settingsVals.restoreSession && _settingsVals.lastView) ? _settingsVals.lastView : 'expertises';
    /* v93: If lastView was toggled off (empty string), keep center hidden to show editor */
    if (_settingsVals.restoreSession && _settingsVals.lastView === '') {
      _centerState.view = null;
      if (_sidebarWidget) _sidebarWidget._active = null;
      /* v122.3: Don't hide center if conversation focus active — chat renders there */
      setTimeout(function(){ if(_centerContainer&&!isFocusActive())_centerContainer.style.display='none'; },50);
    } else {
      _centerState.view = _lastV;
      if (_sidebarWidget) _sidebarWidget._active = _lastV;
    }
    var saved = JSON.parse(localStorage.getItem('c3-session-state') || 'null');
    if (saved) {
      var normalizedSaved=_normalizePersistedSessionState(saved);
      _sessionCount=normalizedSaved.sessionCount;
      _sessionActive=normalizedSaved.sessionActive;
      _ensureSessions();
      normalizedSaved.sessions.forEach(function(ss, i) {
        if(!ss||typeof ss!=='object'||Array.isArray(ss))return;
        if (_sessions[i]) {
          if (_settingsVals.restoreSession) {
            _sessions[i]._convId = ss.convId || null;
            _sessions[i]._projectId = ss.projectId || null;
            _sessions[i]._agentId = ss.agentId || null;
            _sessions[i]._label = ss.label || '';
            _sessions[i].chat.expertise = ss.expertiseName || 'Výchozí';
            _sessions[i].chat.specialist = ss.specialistData || null;
            _sessions[i].chat.editMode = ss.editMode || 'ask';
            _sessions[i].bottom = ss.bottomMode || 'split';
            /* v64.3: Restore per-session tree root */
            if(ss.wtRoot){_perSessionTree[i]={wtRoot:ss.wtRoot,collapsedDirs:{},rawTree:null,files:[]};}
            /* v64.4: Restore recent messages */
            if(ss.recentMsgs&&ss.recentMsgs.length>0){_sessions[i].chat.msgs=ss.recentMsgs;}
            /* v92: Restore focus files */
            _sessions[i]._focusFiles=ss.focusFiles||[];
            /* v95: Restore last attach directory */
            if(ss.lastAttachDir)_sessions[i].chat._lastAttachDir=ss.lastAttachDir;
          }
          /* v81.2: Always clear editing state on restore — editing cannot survive restart */
          _sessions[i].chat.editingIdx=null;
          _sessions[i].chat.editOriginalText=null;
        }
      });
      /* v122.3: Sync conversation focus after restore — disable for project sessions */
      _sessions.forEach(function(s){ if(s._projectId) s._conversationFocus=false; });
      /* If a center view was restored, disable focus so the view renders */
      if(_centerState.view){_sessions[_sessionActive||0]._conversationFocus=false;}
      /* Load active session's tree */
      if (_settingsVals.restoreSession) {
        var act=_sessionActive||0;
        if(_perSessionTree[act]&&_perSessionTree[act].wtRoot){
          _wtRoot=_perSessionTree[act].wtRoot;
          _loadWorkspaceTree(_wtRoot);
        }
      }
      /* v64.5: Schedule renderChat after widget is attached (container may not exist yet at 200ms) */
      var _restoreRenderAttempts=0;
      var _restoreRenderTimer=setInterval(function(){
        _restoreRenderAttempts++;
        if(_chatContainer||_restoreRenderAttempts>20){
          clearInterval(_restoreRenderTimer);
          _renderAll();
        }
      },150);
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

var _chatRoot=null;
function renderChat(){if(!_chatContainer)return;if(!_chatRoot)_chatRoot=_createRoot(_chatContainer);_chatRoot.render(h(ChatApp,null));}
function _chatScrollPane(idx){setTimeout(function(){var f=document.getElementById('c3-chat-feed-'+idx);if(f)f.scrollTop=f.scrollHeight;},60);}

/* Expose for cross-component communication */
window._c3={
  chatMsg:function(text){if(window._c3)window._c3.agentLog('TOOL',text);},
  setExpertise:function(name){var s=_sessions[_sessionActive]||_sessions[0];s.chat.expertise=name;renderChat();_persistSessionState();},
  getExpertise:function(){return(_sessions[_sessionActive]||_sessions[0]).chat.expertise;},
  setSpecialist:function(spec){var s=_sessions[_sessionActive]||_sessions[0];s.chat.specialist=spec||null;if(spec){s.chat.expertise=spec.name;}
    _renderAll();_persistSessionState();if(spec&&spec.id){fetch(_backendBase+'/api/chat/specialist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({specialistId:spec.id,sessionId:s._convId}),signal:AbortSignal.timeout(3000)}).catch(function(){});}},
  clearSpecialist:function(){var s=_sessions[_sessionActive]||_sessions[0];s.chat.specialist=null;s.chat.expertise='Výchozí';s._focusBulkMode=false;s._focusBulkSelected=[];
    _renderAll();_persistSessionState();fetch(_backendBase+'/api/chat/specialist',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s._convId}),signal:AbortSignal.timeout(3000)}).catch(function(){});},
  getSpecialist:function(){return(_sessions[_sessionActive]||_sessions[0]).chat.specialist;},
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
  fetch(_backendBase+'/api/autocomplete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partial:partial,expertise:st.expertise,context:st.msgs.slice(-6).map(function(m){return{role:m.role,text:m.text};})}),signal:_acAbort.signal})
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

/* ── Message editing ── */
function _chatStartEdit(paneIdx,msgIdx){
  var s=_sessions[paneIdx];if(!s)return;var st=s.chat;
  var m=st.msgs[msgIdx];if(!m||m.role!=='user')return;
  st.editingIdx=msgIdx;st.editOriginalText=m.text;
  var ta=document.getElementById('c3-chat-ta-'+paneIdx);
  if(ta){ta.value=m.text;ta.style.height='20px';ta.style.height=Math.min(ta.scrollHeight,100)+'px';ta.focus();}
  renderChat();
}
function _chatCancelEdit(paneIdx){
  var s=_sessions[paneIdx];if(!s)return;
  s.chat.editingIdx=null;s.chat.editOriginalText=null;
  var ta=document.getElementById('c3-chat-ta-'+paneIdx);
  if(ta){ta.value='';ta.style.height='20px';}
  renderChat();
}

/* ── Read file attachments before sending ── */
var _TEXT_EXTS=/\.(js|ts|jsx|tsx|mjs|cjs|py|pyw|json|jsonc|json5|md|mdx|txt|css|scss|sass|less|html|htm|yaml|yml|xml|xsl|csv|tsv|sql|sh|bash|zsh|fish|ps1|bat|cmd|env|cfg|ini|log|toml|rs|go|java|c|cpp|cc|cxx|h|hpp|hxx|cs|rb|php|swift|kt|kts|r|lua|pl|pm|ex|exs|erl|hs|ml|mli|fs|fsx|vue|svelte|astro|scala|clj|cljs|cljc|dart|groovy|gradle|graphql|gql|proto|tf|hcl|dockerfile|makefile|cmake|properties|conf|nginx|prisma|sol|zig|nim|v|wasm|wat|lock|editorconfig|gitignore|gitattributes|dockerignore|npmrc|nvmrc|eslintrc|prettierrc|babelrc|browserslistrc|stylelintrc|rst|adoc|tex|latex|org|nix|dhall|jsonnet|jsx2|pug|jade|ejs|hbs|handlebars|mustache|twig|liquid|erb|haml|slim|razor|cshtml|diff|patch)$/i;
var _IMG_EXTS=/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff|tif|avif)$/i;
var _MAX_TEXT_SIZE=1024*1024;/* 1MB */
var _MAX_IMG_SIZE=5*1024*1024;/* 5MB */

/* Try Node.js fs (available in Electron renderer) */
var _nodeFs=null;
try{_nodeFs=window.require&&window.require('fs');}catch(e){}

function _readAttachments(attachments,callback){
  if(!attachments||attachments.length===0){callback([]);return;}
  var results=[];var pending=attachments.length;
  attachments.forEach(function(a,i){
    var m1InlineOnly=typeof C3WS!=='undefined'&&C3WS&&typeof C3WS.isM1WireNegotiated==='function'&&C3WS.isM1WireNegotiated()===true;
    var filePath=!m1InlineOnly&&a.file&&a.file.path?a.file.path:null;
    function _done(res){results[i]=res;if(--pending===0)callback(results);}
    /* ── TEXT FILES ── */
    if(_TEXT_EXTS.test(a.name)&&a.file&&a.file.size<=_MAX_TEXT_SIZE){
      /* Strategy A: FileReader (works in ALL contexts — standard Web API) */
      var reader=new FileReader();
      if(m1InlineOnly){
        reader.onload=function(){
          var content=null;
          try{
            if(typeof TextDecoder!=='function'||reader.result===null)throw new Error('UTF-8 decoder unavailable');
            content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(reader.result);
          }catch(e){
            if(typeof console!=='undefined')console.warn('[C3:readAttachments] M1 rejected non-UTF-8 text bytes for',a.name);
          }
          _done({name:a.name,size:a.size,type:'text',content:content,path:null});
        };
        reader.onerror=function(){
          if(typeof console!=='undefined')console.warn('[C3:readAttachments] FileReader failed for',a.name,reader.error);
          _done({name:a.name,size:a.size,type:'text',content:null,path:null});
        };
        try{reader.readAsArrayBuffer(a.file);}catch(e){reader.onerror();}
        return;
      }
      reader.onload=function(){
        /* Empty text is legitimate inline content. Legacy still retains its
           existing path fallback because its controller checks truthiness. */
        var content=typeof reader.result==='string'?reader.result:null;
        _done({name:a.name,size:a.size,type:'text',content:content,path:filePath});
      };
      reader.onerror=function(){
        if(typeof console!=='undefined')console.warn('[C3:readAttachments] FileReader failed for',a.name,reader.error);
        /* FileReader failed — fallback to path-based backend reading */
        if(filePath){_done({name:a.name,size:a.size,type:'text',content:null,path:filePath});}
        else{_done({name:a.name,size:a.size,type:'text',content:null,path:null});}
      };
      reader.readAsText(a.file);return;
    }
    /* ── IMAGE FILES ── */
    if(_IMG_EXTS.test(a.name)&&a.file&&a.file.size<=_MAX_IMG_SIZE){
      var reader2=new FileReader();
      reader2.onload=function(){_done({name:a.name,size:a.size,type:'image',content:typeof reader2.result==='string'?reader2.result:null,path:filePath});};
      reader2.onerror=function(){_done({name:a.name,size:a.size,type:'image',content:null,path:filePath});};
      reader2.readAsDataURL(a.file);return;
    }
    /* ── UNKNOWN / BINARY / OVERSIZED ── */
    _done({name:a.name,size:a.size,type:'binary',content:null,path:filePath});
  });
}

/* M1/011: Chat sends are WebSocket-only until M2 owns one effect authority.
   A successful WebSocket.send() is queued locally, not acknowledged by server. */
function _chatTryWsSend(content,session,sessionIdx){
  try{
    if(typeof C3WS==='undefined'||!C3WS||typeof C3WS.isReady!=='function'||C3WS.isReady()!==true){
      return{status:'NOT_SENT',retryable:true,reason:'WS_UNAVAILABLE',serverAcknowledged:false};
    }
    if(typeof C3WS.sendChat!=='function'||C3WS.sendChat(content,session,sessionIdx)!==true){
      if(typeof C3WS.takeM1SendRejection==='function'){
        var local=C3WS.takeM1SendRejection();
        if(local&&local.status==='NOT_SENT'&&typeof local.reason==='string'&&local.serverAcknowledged===false){
          return{status:'NOT_SENT',retryable:local.retryable===true,reason:local.reason,serverAcknowledged:false};
        }
      }
      return{status:'NOT_SENT',retryable:true,reason:'WS_SEND_REJECTED',serverAcknowledged:false};
    }
    return{status:'QUEUED_WS',retryable:false,reason:null,serverAcknowledged:false};
  }catch(e){
    return{status:'NOT_SENT',retryable:true,reason:'WS_SEND_FAILED',serverAcknowledged:false};
  }
}
function _chatRestoreInput(ta,text){
  if(!ta||ta.value)return;
  ta.value=text||'';ta.style.height='20px';
  if(typeof ta.scrollHeight==='number')ta.style.height=Math.min(ta.scrollHeight,100)+'px';
}
function _chatRestoreAttachments(st,attachments){
  var current=Array.isArray(st.attachments)?st.attachments:[];
  (attachments||[]).slice().reverse().forEach(function(item){
    if(current.indexOf(item)<0)current.unshift(item);
  });
  st.attachments=current;
}
function _chatMarkNotSent(idx,st,text,delivery,draft){
  st._thinking=null;st._pendingAttachments=null;
  st._delivery={status:'NOT_SENT',retryable:delivery.retryable===true,reason:delivery.reason,text:text,draft:typeof draft==='string'?draft:text};
  renderChat();_chatScrollPane(idx);
}
function _chatClearDelivery(st){st._delivery=null;}
function _chatInvalidatePreparedSends(st){
  if(!st)return;
  st._sendContextToken={};st._sendTurnToken={};st._preparedSend=null;st._pendingAttachments=null;
}
function _chatTransportSnapshot(){
  var ws=typeof C3WS!=='undefined'&&C3WS?C3WS:null;
  return{
    epoch:ws&&typeof ws.connectionEpoch==='function'?ws.connectionEpoch():null,
    m1:!!(ws&&typeof ws.isM1WireNegotiated==='function'&&ws.isM1WireNegotiated()===true),
    policy:ws&&typeof ws.m1AttachmentPolicy==='function'?ws.m1AttachmentPolicy():null,
    ready:!!(ws&&typeof ws.isReady==='function'&&ws.isReady()===true)
  };
}
function _chatTransportIsCurrent(snapshot){
  var current=_chatTransportSnapshot();
  return!!snapshot&&current.epoch===snapshot.epoch&&current.m1===snapshot.m1
    &&current.policy===snapshot.policy&&current.ready===snapshot.ready;
}
function _chatCaptureSendContext(idx,s,st,userMsg,rawDraft,filesToRead,ta,text){
  if(!st._sendContextToken)st._sendContextToken={};st._sendTurnToken={};
  var prepared={idx:idx,session:s,chat:st,msgs:st.msgs,sessionEpoch:st._sendContextToken,turnEpoch:st._sendTurnToken,
    convId:s._convId,agentId:s._agentId,projectId:s._projectId,editMode:st.editMode,
    conversationFocus:!!s._conversationFocus,focusActive:!!(st.specialist||s._conversationFocus),
    userMsg:userMsg,userMsgIdx:st.msgs.length-1,messageCount:st.msgs.length,
    rawDraft:rawDraft,attachments:filesToRead,textarea:ta,text:text,thinking:st._thinking,
    transport:_chatTransportSnapshot()};
  st._preparedSend=prepared;return prepared;
}
function _chatSendContextIsCurrent(captured){
  return!!captured&&captured.idx>=0&&captured.idx<_sessionCount
    &&_sessions[captured.idx]===captured.session
    &&captured.session.chat===captured.chat
    &&captured.chat.msgs===captured.msgs
    &&captured.chat._sendContextToken===captured.sessionEpoch
    &&captured.chat._sendTurnToken===captured.turnEpoch
    &&captured.chat._preparedSend===captured
    &&captured.chat.msgs.length===captured.messageCount
    &&captured.chat.msgs[captured.userMsgIdx]===captured.userMsg
    &&captured.chat._thinking===captured.thinking
    &&captured.session._convId===captured.convId
    &&captured.session._agentId===captured.agentId
    &&captured.session._projectId===captured.projectId
    &&captured.chat.editMode===captured.editMode
    &&!!captured.session._conversationFocus===captured.conversationFocus
    &&_chatTransportIsCurrent(captured.transport);
}
function _chatReleasePreparedSend(captured){
  if(captured&&captured.chat&&captured.chat._preparedSend===captured)captured.chat._preparedSend=null;
}
function _chatRejectPreparedSend(captured,reason,retryable){
  if(!captured||!captured.chat||captured.chat._preparedSend!==captured)return false;
  _chatReleasePreparedSend(captured);captured.chat._sendContextToken={};captured.chat._sendTurnToken={};captured.chat._pendingAttachments=null;
  var ownsTimeline=captured.idx>=0&&captured.idx<_sessionCount
    &&_sessions[captured.idx]===captured.session
    &&captured.session.chat===captured.chat
    &&captured.chat.msgs===captured.msgs
    &&captured.chat.msgs[captured.userMsgIdx]===captured.userMsg;
  if(!ownsTimeline)return true;
  var canRetry=retryable!==false;
  captured.userMsg.tag='NOT_SENT';captured.userMsg.deliveryStatus='NOT_SENT';captured.userMsg.deliveryReason=reason;captured.userMsg.retryable=canRetry;
  _chatRestoreInput(captured.textarea,captured.rawDraft);_chatRestoreAttachments(captured.chat,captured.attachments);
  if(captured.chat._thinking===captured.thinking)captured.chat._thinking=null;
  captured.chat._delivery={status:'NOT_SENT',retryable:canRetry,reason:reason,text:captured.text,draft:captured.rawDraft};
  renderChat();_chatScrollPane(captured.idx);
  return true;
}
function _chatCancelPreparedSend(idx,s){
  var st=s&&s.chat;var prepared=st&&st._preparedSend;
  if(!prepared)return false;
  return _chatRejectPreparedSend(prepared,'CANCELLED_BEFORE_SEND');
}

function _chatSendPane(idx){
  var ta=document.getElementById('c3-chat-ta-'+idx);
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  if(typeof C3WS!=='undefined'&&C3WS.hasActiveM1Turn&&C3WS.hasActiveM1Turn(s))return;
  if(st._preparedSend)return;
  st.acSuggestion=null;/* clear autocomplete on send */
  var rawDraft=ta?ta.value:'';
  var t=rawDraft.trim();if(!t&&st.attachments.length===0)return;

  /* ── Edit mode — replace message and resend (branch-from-here) ── */
  if(st.editingIdx!==null&&st.editingIdx!==undefined){
    var editIdx=st.editingIdx;
    var editSnapshot=st.msgs.map(function(m){return Object.assign({},m);});
    st.editingIdx=null;st.editOriginalText=null;
    st.msgs[editIdx].text=t;
    st.msgs.splice(editIdx+1);/* remove all after edited msg */
    if(ta){ta.value='';ta.style.height='22px';}
    st._thinking={text:'Zpracovávám...', ts:Date.now()};
    _chatClearDelivery(st);
    renderChat();_chatScrollPane(idx);
    var editDelivery=_chatTryWsSend(t,s,idx);
    if(editDelivery.status==='NOT_SENT'){
      st.msgs=editSnapshot;st.editingIdx=editIdx;
      st.editOriginalText=editSnapshot[editIdx]?editSnapshot[editIdx].text:null;
      _chatRestoreInput(ta,rawDraft);_chatMarkNotSent(idx,st,t,editDelivery,rawDraft);return;
    }
    if(st.msgs[editIdx]&&st.msgs[editIdx].deliveryStatus==='NOT_SENT'){
      delete st.msgs[editIdx].deliveryStatus;delete st.msgs[editIdx].retryable;
      if(st.msgs[editIdx].tag==='NOT_SENT')delete st.msgs[editIdx].tag;
    }
    setTimeout(function(){_pollContext(idx);},2000);
    return;
  }

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
  var filesToRead=hasFiles?st.attachments.slice():[];
  st.msgs.push({role:'user',text:txt,id:'umsg-'+Date.now()});
  var userMsg=st.msgs[st.msgs.length-1];
  st.attachments=[];
  if(ta){ta.value='';ta.style.height='22px';}
  _sessionActive=idx;
  renderChat();_chatScrollPane(idx);

  /* v90: Start thinking indicator */
  st._thinking={text:'Zpracovávám...', ts:Date.now()};
  _chatClearDelivery(st);
  renderChat();

  /* Read attachments then send */
  var sendContext=_chatCaptureSendContext(idx,s,st,userMsg,rawDraft,filesToRead,ta,txt);
  _readAttachments(filesToRead,function(readFiles){
    if(!_chatSendContextIsCurrent(sendContext)){_chatRejectPreparedSend(sendContext,'CONTEXT_CHANGED_BEFORE_SEND');return;}
    _chatReleasePreparedSend(sendContext);
    s.chat._pendingAttachments=readFiles.length>0?readFiles:null;
    /* v92: Track attachments in focus mode file list */
    if(sendContext.focusActive&&filesToRead.length>0){
      filesToRead.forEach(function(a){if(!_focusFileExists(s,a.name,null)){s._focusFiles.unshift({name:a.name,size:a.size||'',addedAt:Date.now(),type:'attachment'});}});
      renderChat();
    }
    /* M1 is WebSocket-only. HTTP parity returns with M2 effect authority. */
    var delivery=_chatTryWsSend(txt,s,idx);
    if(delivery.status==='NOT_SENT'){
      userMsg.tag='NOT_SENT';userMsg.deliveryStatus='NOT_SENT';userMsg.deliveryReason=delivery.reason;userMsg.retryable=delivery.retryable===true;
      _chatRestoreInput(ta,rawDraft);_chatRestoreAttachments(st,filesToRead);
      _chatMarkNotSent(idx,st,txt,delivery,rawDraft);return;
    }
    s.chat._pendingAttachments=null;
    /* Poll context after send */
    setTimeout(function(){_pollContext(idx);},2000);
  });
}

/* D5: Gap choice button handler — sends user's gap choice as chat message */
function _chatGapChoice(idx,choice,gapMsgIdx){
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  var gapMessage=typeof gapMsgIdx==='number'?st.msgs[gapMsgIdx]:null;
  if(!gapMessage||!gapMessage._gapChoice||gapMessage._gapResolved)return false;
  if(typeof C3WS!=='undefined'&&C3WS.hasActiveM1Turn&&C3WS.hasActiveM1Turn(s)){
    st._delivery={status:'BUSY',retryable:true,reason:'CONVERSATION_BUSY',text:'Nejprve dokončete nebo zrušte aktivní požadavek.'};
    renderChat();return false;
  }
  if(st._preparedSend){
    st._delivery={status:'BUSY',retryable:true,reason:'SEND_PREPARING',text:'Předchozí zpráva se ještě připravuje.'};
    renderChat();return false;
  }
  gapMessage._gapResolved=true;
  var txt=choice==='create'?'Vytvoř expertízu':'Bez ní, odpověz rovnou';
  var gapUserMsg={role:'user',text:txt};st.msgs.push(gapUserMsg);
  st._thinking={text:'Zpracovávám...', ts:Date.now()};
  _chatClearDelivery(st);
  renderChat();_chatScrollPane(idx);
  var delivery=_chatTryWsSend(txt,s,idx);
  if(delivery.status==='NOT_SENT'){
    gapUserMsg.tag='NOT_SENT';gapUserMsg.deliveryStatus='NOT_SENT';gapUserMsg.deliveryReason=delivery.reason;gapUserMsg.retryable=delivery.retryable===true;
    if(typeof gapMsgIdx==='number'&&st.msgs[gapMsgIdx]&&st.msgs[gapMsgIdx]._gapChoice){
      st.msgs[gapMsgIdx]._gapResolved=false;
    }
    _chatMarkNotSent(idx,st,txt,delivery);
    return false;
  }
  return true;
}

function _chatPaneUI(idx,opts){
  var inFocus=opts&&opts.fullWidth;
  var s=_sessions[idx];if(!s)return null;var st=s.chat;
  var isFocused=_sessionActive===idx;
  var btnS={background:C.accentBg,color:C.accentText,border:'none',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:24,height:24};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',minWidth:0,background:C.bg1,fontFamily:C.font,position:'relative',overflow:'hidden'},
    onClick:function(){if(!inFocus){_switchSession(idx);
      _sessions.forEach(function(ss,j){if(j!==idx)ss.chat.showExpertises=false;});
      if(st.showExpertises){st.showExpertises=false;}renderChat();}}},
    /* PANE HEADER — specialist focus header or normal header */
    inFocus&&st.specialist?
    h('div',{style:{padding:'6px 12px',height:36,display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2}},
      h('span',{style:{fontSize:_fs(16)}},st.specialist.emoji||''),
      h('span',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1}},st.specialist.name||''),
      h('span',{style:{fontSize:_fs(10),color:C.tx3}},st.specialist.desc||st.specialist.domain||''),
      h('div',{style:{flex:1}}),
      /* Context meter */
      h('div',{style:{display:'flex',alignItems:'center',gap:3,fontSize:_fs(9),color:C.tx4,fontFamily:C.mono}},
        h('div',{style:{width:40,height:3,background:C.bg4,borderRadius:2,overflow:'hidden'}},h('div',{style:{height:'100%',background:C.accent,borderRadius:2,width:st.ctx+'%'}})),h('span',null,st.ctx+'%')),
      h('button',{style:{background:'rgba(239,68,68,0.15)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',borderRadius:6,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',marginLeft:6},
        onMouseEnter:function(e){e.currentTarget.style.background='rgba(239,68,68,0.3)';},
        onMouseLeave:function(e){e.currentTarget.style.background='rgba(239,68,68,0.15)';},
        onClick:function(ev){ev.stopPropagation();_focusExitDialog={pendingAction:null};renderCenter();}},'Ukončit')):
    h('div',{style:{padding:'0 6px',height:28,display:'flex',alignItems:'center',gap:3,borderBottom:'1px solid '+C.border,flexShrink:0,background:isFocused?C.bg2:'transparent'}},
      h('button',{style:btnS,title:'Nový chat',onClick:function(ev){ev.stopPropagation();_newChatInProject(idx);}},svgEl(I.plus)),
      /* v90: Session label — prefer persisted _label, fallback to lookup */
      (function(){var label=s._label||'';
        if(!label&&s._projectId){var _pr=PROJECTS.find(function(p){return p.id===s._projectId;});if(_pr)label=_pr.name;}
        if(!label&&s._convId){var _cv=CONVERSATIONS.find(function(c){return c.id===s._convId;});if(_cv)label=_cv.title;}
        if(!label&&st.expertise&&st.expertise!=='Výchozí')label=st.expertise;
        return label?h('span',{style:{fontSize:_fs(10),fontWeight:600,color:isFocused?C.tx1:C.tx3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:140},title:label},label):null;})(),
      h('div',{style:{flex:1}}),
      /* Context meter */
      h('div',{style:{display:'flex',alignItems:'center',gap:3,fontSize:_fs(9),color:C.tx4,fontFamily:C.mono}},
        h('div',{style:{width:30,height:3,background:C.bg4,borderRadius:2,overflow:'hidden'}},h('div',{style:{height:'100%',background:C.accent,borderRadius:2,width:st.ctx+'%'}})),h('span',null,st.ctx+'%')),
      /* Close button — opens dialog with options */
      (s._convId||s._projectId)?h('button',{style:{background:'none',border:'none',color:C.tx4,cursor:'pointer',fontSize:_fs(13),padding:'0 2px',lineHeight:1,marginLeft:2},
        title:'Zavřít',onClick:function(ev){ev.stopPropagation();_closeDialog={idx:idx};renderChat();}},'×'):null),
    /* NEW CHAT DIALOG (v64.4) */
    _newChatDialog&&_newChatDialog.idx===idx?h('div',{style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center'},
      onClick:function(ev){ev.stopPropagation();_newChatDialogAction('cancel');}},
      h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,padding:'16px 20px',minWidth:200,maxWidth:260,boxShadow:'0 12px 40px rgba(0,0,0,0.5)'},
        onClick:function(ev){ev.stopPropagation();}},
        h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:4}},'Nová konverzace'),
        h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:12}},'Projekt: '+_newChatDialog.projectName),
        h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,background:C.accentBg,color:C.accentText,border:'1px solid '+C.accent,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
          onClick:function(){_newChatDialogAction('project');}},'A) Nová konverzace v projektu'),
        h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
          onClick:function(){_newChatDialogAction('free');}},'B) Nová konverzace mimo projekt'),
        h('button',{style:{display:'block',width:'100%',padding:'8px 12px',background:'transparent',color:C.tx4,border:'1px solid '+C.border,borderRadius:6,fontSize:_fs(11),cursor:'pointer',textAlign:'left'},
          onClick:function(){_newChatDialogAction('cancel');}},'C) Zrušit'))):null,
    /* CLOSE DIALOG (v70) */
    _closeDialog&&_closeDialog.idx===idx?h('div',{style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center'},
      onClick:function(ev){ev.stopPropagation();_closeDialogAction('cancel');}},
      h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,padding:'16px 20px',minWidth:200,maxWidth:260,boxShadow:'0 12px 40px rgba(0,0,0,0.5)'},
        onClick:function(ev){ev.stopPropagation();}},
        h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:12}},'Zavřít'),
        h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,background:C.accentBg,color:C.accentText,border:'1px solid '+C.accent,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
          onClick:function(){_closeDialogAction('conv');}},'A) Zavřít konverzaci'),
        _sessionCount>1?h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
          onClick:function(){_closeDialogAction('pane');}},'B) Zavřít konverzaci i panel'):null,
        h('button',{style:{display:'block',width:'100%',padding:'8px 12px',background:'transparent',color:C.tx4,border:'1px solid '+C.border,borderRadius:6,fontSize:_fs(11),cursor:'pointer',textAlign:'left'},
          onClick:function(){_closeDialogAction('cancel');}},'C) Zrušit'))):null,
    /* FEED */
    h('div',{id:'c3-chat-feed-'+idx,style:{flex:1,overflowY:'auto',overflowX:'hidden',padding:8,minWidth:0}},
      st.msgs.map(function(m,i){var u=m.role==='user',a=m.role==='assistant';var bub=_settingsVals.visualMode==='borders';
        var isEditing=st.editingIdx===i;
        var wrapS=bub?{padding:'3px 6px',marginBottom:3,display:'flex',justifyContent:u?'flex-end':'flex-start'}
          :{padding:'6px 0',borderBottom:'1px solid '+C.border};
        var _mw=inFocus?'90%':'85%';
        var msgS=bub?{background:u?C.bg4:a?C.bg2:C.bg3,borderRadius:u?'12px 12px 2px 12px':a?'12px 12px 12px 2px':'8px',padding:'6px 10px',maxWidth:_mw,minWidth:60,border:isEditing?'2px solid '+C.accent:'none'}:{border:isEditing?'2px solid '+C.accent:'none'};
        return h('div',{key:i,style:Object.assign({},wrapS,u?{cursor:'pointer'}:{}),onClick:u?function(){_chatStartEdit(idx,i);}:undefined,title:u?'Klikni pro editaci':undefined},
          h('div',{style:msgS},
          h('div',{style:{display:'flex',alignItems:'center',gap:4,marginBottom:2}},
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:u?C.bg4:a?'linear-gradient(135deg,#22c55e,#16a34a)':C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:a?_fs(6):_fs(8),fontWeight:a?700:400,color:u?C.tx3:a?'#fff':C.tx4}},u?'👤':a?'C3':'⚡'),
            h('span',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2}},u?'Ty':a?'C3':'System'),
            m.tag?h('span',{style:{fontSize:_fs(7.5),padding:'1px 3px',borderRadius:3,fontFamily:C.mono,textTransform:'uppercase',background:m.tag==='ERROR'||m.tag==='NOT_SENT'?C.redBg:C.purpleBg,color:m.tag==='ERROR'||m.tag==='NOT_SENT'?C.red:C.purple}},m.tag):null),
          h('div',{style:{fontSize:_fs(12),lineHeight:'1.5',color:C.tx1,paddingLeft:22,wordBreak:'break-word',whiteSpace:'pre-wrap'}},m.text),
          /* D5: Gap choice inline buttons */
          m._gapChoice&&!m._gapResolved?h('div',{style:{display:'flex',gap:6,paddingLeft:22,paddingTop:6}},
            h('button',{style:{padding:'5px 12px',borderRadius:6,border:'1px solid #f59e0b',background:'rgba(245,158,11,0.1)',color:'#fbbf24',fontSize:_fs(11),fontWeight:600,cursor:'pointer'},
              onClick:function(ev){ev.stopPropagation();_chatGapChoice(idx,'create',i);}},
              '✨ Vytvořit expertízu'),
            h('button',{style:{padding:'5px 12px',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontSize:_fs(11),fontWeight:600,cursor:'pointer'},
              onClick:function(ev){ev.stopPropagation();_chatGapChoice(idx,'fallback',i);}},
              '💬 Odpovědět bez ní')):null));}),
      /* v90: Thinking indicator */
      st._thinking?h('div',{key:'thinking',style:{padding:'3px 6px',marginBottom:3,display:'flex',justifyContent:'flex-start'}},
        h('div',{style:{background:C.bg2,borderRadius:'12px 12px 12px 2px',padding:'6px 10px',maxWidth:'85%',minWidth:60}},
          h('div',{style:{display:'flex',alignItems:'center',gap:4,marginBottom:2}},
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:'linear-gradient(135deg,#22c55e,#16a34a)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(6),fontWeight:700,color:'#fff'}},'C3'),
            h('span',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2}},'C3')),
          h('div',{style:{display:'flex',alignItems:'center',gap:6,paddingLeft:22}},
            h('div',{style:{display:'flex',gap:3,alignItems:'center'}},
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'c3-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0s'}}),
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'c3-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0.15s'}}),
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'c3-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0.3s'}})),
            h('span',{style:{fontSize:_fs(11),color:C.tx3,fontStyle:'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:200}},st._thinking.text||'')))):null),
    /* M1/011: minimal functional status; final Studio UI is a later product surface. */
    st._delivery&&st._delivery.status==='NOT_SENT'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:C.redBg,color:C.red,fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      st._delivery.retryable===false
        ?'NOT_SENT · Vstup nesplňuje vyjednanou bezpečnostní politiku ('+st._delivery.reason+'). Upravte přílohy nebo zprávu; automatické opakování je vypnuté.'
        :'NOT_SENT · Zpráva nebyla odeslána. Po obnovení WebSocketu akci opakujte; rozepsaná data zůstala zachovaná.'):
    st._delivery&&st._delivery.status==='DELIVERY_UNKNOWN'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:'rgba(245,158,11,0.12)',color:'#fbbf24',fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      'DELIVERY_UNKNOWN · Spojení skončilo po odeslání. Výsledek ověřte v historii; automatické opakování je vypnuté.'):
    st._delivery&&st._delivery.status==='BUSY'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:'rgba(245,158,11,0.12)',color:'#fbbf24',fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      'BUSY · '+st._delivery.text):null,
    /* INPUT */
    h('div',{style:{padding:6,borderTop:'1px solid '+C.border,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
      h('div',{style:{background:C.bg2,border:'1px solid '+(st._dragOver?C.accent:st.editingIdx!==null?C.accent:C.border2),borderRadius:10,overflow:'visible',position:'relative',transition:'border-color 0.15s'},
        onDragOver:function(e){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';if(!st._dragOver){st._dragOver=true;renderChat();}},
        onDragLeave:function(e){e.preventDefault();e.stopPropagation();if(st._dragOver){st._dragOver=false;renderChat();}},
        onDrop:function(e){e.preventDefault();e.stopPropagation();st._dragOver=false;if(e.dataTransfer&&e.dataTransfer.files){for(var j=0;j<e.dataTransfer.files.length;j++){st.attachments.push({name:e.dataTransfer.files[j].name,size:Math.round(e.dataTransfer.files[j].size/1024)+' KB',file:e.dataTransfer.files[j]});}renderChat();}}},
        /* v95: Drop zone indicator */
        st._dragOver?h('div',{style:{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.4)',borderRadius:10,zIndex:10,pointerEvents:'none'}},
          h('span',{style:{color:C.accentText,fontSize:_fs(12),fontWeight:600,padding:'8px 16px',background:C.bg3,borderRadius:8,border:'2px dashed '+C.accent}},'Přetáhni soubory sem')):null,
        /* Edit bar */
        st.editingIdx!==null?h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',background:C.accentBg,borderBottom:'1px solid '+C.accent,borderRadius:'10px 10px 0 0',fontSize:_fs(10)}},
          h('span',{style:{color:C.accentText,fontWeight:600}},'✏️ Editace zprávy'),
          h('button',{style:{background:'none',border:'none',color:C.tx3,cursor:'pointer',fontSize:_fs(10),padding:'1px 6px'},onClick:function(ev){ev.stopPropagation();_chatCancelEdit(idx);}},'Zrušit (Esc)')):null,
        st.attachments.length>0?h('div',{style:{display:'flex',flexWrap:'wrap',gap:3,padding:'5px 8px 0'}},
          st.attachments.map(function(a,i){
            var isImg=/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(a.name);
            return h('span',{key:i,style:{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 6px',borderRadius:5,background:C.bg4,fontSize:_fs(9),color:C.tx2,maxWidth:160},title:a.name+' ('+a.size+')'},
              isImg?'🖼️':'📎',
              h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},a.name),
              h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(11),marginLeft:1,flexShrink:0},onClick:function(e){e.stopPropagation();st.attachments.splice(i,1);renderChat();}},'×'));})):null,
        h('div',{style:{display:'flex',alignItems:'flex-end',padding:'6px 8px 4px',gap:3}},
          h('textarea',{id:'c3-chat-ta-'+idx,style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.font,fontSize:_fs(12.5),lineHeight:'1.4',resize:'none',minHeight:20,maxHeight:100,overflow:'auto'},placeholder:'Napiš zprávu...',rows:1,
            onFocus:function(){_sessionActive=idx;renderChat();},
            onInput:function(e){e.target.style.height='20px';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';st.acSuggestion=null;renderChat();},
            onKeyDown:function(e){if(e.key==='Tab'){e.preventDefault();_chatAutocomplete(idx);}else if(e.key==='Escape'){if(st.editingIdx!==null){_chatCancelEdit(idx);}else{st.acSuggestion=null;renderChat();}}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_chatSendPane(idx);}else if(e.key==='ArrowUp'&&!e.target.value.trim()){e.preventDefault();for(var j=st.msgs.length-1;j>=0;j--){if(st.msgs[j].role==='user'){_chatStartEdit(idx,j);break;}}}}}),
          h('button',{style:{background:'rgba(34,197,94,0.15)',color:C.accentText,border:'none',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:26,height:26,flexShrink:0},onClick:function(){_chatSendPane(idx);}},svgEl(I.send))),
        /* Autocomplete suggestion — subtle ghost text row */
        st.acSuggestion?h('div',{style:{display:'flex',alignItems:'center',padding:'1px 8px 2px',cursor:'pointer',gap:4},onClick:function(ev){ev.stopPropagation();_chatAutocomplete(idx);}},
          h('span',{style:{fontSize:_fs(11.5),color:C.tx4,opacity:0.45,fontFamily:C.font,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1,fontStyle:'italic'}},st.acSuggestion),
          h('span',{style:{fontSize:_fs(8),color:C.tx4,fontFamily:C.mono,flexShrink:0,padding:'1px 5px',border:'1px solid '+C.border2,borderRadius:3,opacity:0.5}},'Tab')):null,
        st.acLoading?h('div',{style:{padding:'1px 8px 2px'}},
          h('div',{style:{height:1,borderRadius:1,background:C.bg4,overflow:'hidden'}},
            h('div',{style:{height:'100%',width:'30%',background:C.tx4,borderRadius:1,opacity:0.3,animation:'c3-ac-pulse 1.2s ease-in-out infinite'}}))):null,
        h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 6px 5px',borderTop:'1px solid '+C.border}},
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22},title:'Připojit soubor (nebo přetáhni)',
            onClick:function(ev){ev.stopPropagation();
              /* v95: Smart file picker — project folder default + remember last dir */
              var defDir=st._lastAttachDir||'';
              if(!defDir){var curSess=_sessions[_sessionActive];if(curSess&&curSess._projectId){var prj=PROJECTS.find(function(p){return p.id===curSess._projectId;});if(prj&&prj.path)defDir=prj.path;}}
              var m1InlineOnly=typeof C3WS!=='undefined'&&C3WS&&typeof C3WS.isM1WireNegotiated==='function'&&C3WS.isM1WireNegotiated()===true;
              if(!m1InlineOnly&&window.electronTheiaFilesystem&&window.electronTheiaFilesystem.showOpenDialog){
                window.electronTheiaFilesystem.showOpenDialog({title:'Připojit soubory',openFiles:true,openFolders:false,selectMany:true,defaultPath:defDir}).then(function(filePaths){
                  if(filePaths&&filePaths.length>0){
                    /* Remember last directory */
                    var lastPath=filePaths[0].replace(/\\/g,'/');var slashIdx=lastPath.lastIndexOf('/');
                    if(slashIdx>0){st._lastAttachDir=lastPath.substring(0,slashIdx);_persistSessionState();}
                    for(var j=0;j<filePaths.length;j++){
                      var fp=filePaths[j];var fn=fp.replace(/\\/g,'/').split('/').pop()||fp;
                      st.attachments.push({name:fn,size:'soubor',file:{path:fp,size:1024}});}
                    renderChat();}
                }).catch(function(e){if(typeof console!=='undefined')console.warn('[C3:attach] showOpenDialog error:',e);});
              }else{
                /* M1 obtains bytes directly from the user-gesture File object.
                   Never turn an Electron filesystem path into wire authority. */
                var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var j=0;j<inp.files.length;j++){st.attachments.push({name:inp.files[j].name,size:Math.round(inp.files[j].size/1024)+' KB',file:inp.files[j]});}renderChat();}document.body.removeChild(inp);};inp.click();
              }}},svgEl(I.attach,12)),
          /* Edit mode toggle */
          h('div',{style:{display:'flex',alignItems:'center',gap:1,padding:'1px 2px',borderRadius:4,background:C.bg3,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:_fs(9),fontWeight:600,cursor:'pointer',color:st.editMode==='auto'?C.tx1:C.tx4,background:st.editMode==='auto'?C.bg4:'transparent'},
              onClick:function(){if(st._preparedSend)return;st.editMode='auto';renderChat();_persistSessionState();},title:'Agent edituje soubory automaticky'},'Auto'),
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:_fs(9),fontWeight:600,cursor:'pointer',color:st.editMode==='ask'?C.tx1:C.tx4,background:st.editMode==='ask'?C.bg4:'transparent'},
              onClick:function(){if(st._preparedSend)return;st.editMode='ask';renderChat();_persistSessionState();},title:'Agent se zeptá před každou editací'},'Review')),
          h('div',{style:{flex:1}}),
          /* D5: Specialist indicator or expertise dropdown */
          st.specialist?h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 6px',borderRadius:4,fontSize:_fs(10),fontWeight:600,flexShrink:0}},
            h('span',{style:{width:5,height:5,borderRadius:'50%',background:'#f59e0b'}}),
            h('span',{style:{color:'#fbbf24',cursor:'default'},title:'Aktivní specialista: '+st.specialist.name},st.specialist.emoji+' '+st.specialist.name),
            h('span',{style:{fontSize:_fs(9),color:C.tx4,cursor:'pointer',marginLeft:2},title:'Deaktivovat specialistu',
              onClick:function(ev){ev.stopPropagation();var c3=window._c3;if(c3)c3.clearSpecialist();}},'✕')):
          h('div',{style:{display:'flex',alignItems:'center',gap:2,padding:'2px 6px',borderRadius:4,fontSize:_fs(10),fontWeight:500,color:C.accentText,opacity:0.7,cursor:'pointer',flexShrink:0},
            onClick:function(ev){ev.stopPropagation();st.showExpertises=!st.showExpertises;renderChat();}},
            h('span',{style:{width:4,height:4,borderRadius:'50%',background:C.accent}}),st.expertise,svgEl(I.chevDown,8))),
        st.showExpertises&&!st.specialist?(function(){var favs=EXPERTISES.filter(function(e){return e.fav;});var shown=st.showAllExpertises?EXPERTISES:favs.length>0?favs:EXPERTISES;return h('div',{style:{position:'absolute',bottom:'100%',right:6,marginBottom:3,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:'4px 0',minWidth:160,maxHeight:240,overflowY:'auto',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,0.5)'},onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{padding:'3px 10px 5px',fontSize:_fs(8.5),fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px'}},'VYBRAT EXPERTYZU'),
          shown.map(function(exp){
            return h('div',{key:exp.name,style:{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',fontSize:_fs(11),color:st.expertise===exp.name?C.accentText:C.tx2,background:st.expertise===exp.name?C.accentBg:'transparent',cursor:'pointer'},
              onMouseEnter:function(e){e.currentTarget.style.background=C.bg4;},
              onMouseLeave:function(e){e.currentTarget.style.background=st.expertise===exp.name?C.accentBg:'transparent';},
              onClick:function(e){e.stopPropagation();st.expertise=exp.name;st.specialist=null;st.showExpertises=false;st.showAllExpertises=false;renderChat();}},
              h('span',null,exp.emoji),h('span',{style:{flex:1}},exp.name),
              h('span',{style:{fontSize:_fs(11),color:exp.fav?C.accentText:C.tx4,cursor:'pointer'},onClick:function(e){e.stopPropagation();exp.fav=!exp.fav;if(exp.id){fetch(_backendBase+'/api/expertises/'+exp.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:exp.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderChat();}},exp.fav?'★':'☆'));}),
          !st.showAllExpertises&&favs.length>0&&favs.length<EXPERTISES.length?h('div',{style:{padding:'4px 10px',fontSize:_fs(9.5),color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExpertises=true;renderChat();}},'Zobrazit vše ('+EXPERTISES.length+')'):null,
          st.showAllExpertises?h('div',{style:{padding:'4px 10px',fontSize:_fs(9.5),color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExpertises=false;renderChat();}},'Jen oblíbené'):null);}()):null)));
}

/* v122.2: Conversation info panel — replaces chat in right panel when conversation focus active */
function ConversationInfoApp(){
  var s=_sessions[_sessionActive];if(!s)return null;
  var convTitle=s._label||'Konverzace';
  var expertise=s.chat.expertise||'Výchozí';
  var msgCount=s.chat.msgs.filter(function(m){return m.role!=='system';}).length;
  var attachCount=s.chat.attachments?s.chat.attachments.length:0;
  var labelS={fontSize:_fs(9.5),color:C.tx4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',marginBottom:2};
  var valS={fontSize:_fs(12),color:C.tx1,marginBottom:12};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    h('div',{style:{height:22,display:'flex',alignItems:'center',borderBottom:'1px solid '+C.border,flexShrink:0,padding:'0 10px'}},
      h('span',{style:{fontSize:_fs(12),fontWeight:600,color:C.tx2}},'Konverzace')),
    h('div',{style:{flex:1,overflowY:'auto',padding:14}},
      h('div',{style:{marginBottom:16}},
        h('div',{style:labelS},'Název'),
        h('div',{style:valS},convTitle)),
      h('div',{style:{marginBottom:16}},
        h('div',{style:labelS},'Expertyza'),
        h('div',{style:valS},expertise)),
      h('div',{style:{marginBottom:16}},
        h('div',{style:labelS},'Zprávy'),
        h('div',{style:valS},String(msgCount))),
      attachCount>0?h('div',{style:{marginBottom:16}},
        h('div',{style:labelS},'Přílohy'),
        h('div',{style:valS},String(attachCount))):null,
      h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:12,marginTop:8}},
        h('button',{style:{width:'100%',padding:'8px 0',borderRadius:6,border:'1px solid '+C.border2,background:C.bg3,color:C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:600,cursor:'pointer'},
          onClick:function(){s._conversationFocus=false;_syncFocusClass();renderCenter();renderChat();}},'Zavřít konverzaci'))));
}

/* v92: Focus Mode file list — replaces chat in right panel when specialist active */
function FocusFilesApp(){
  var s=_sessions[_sessionActive];
  if(!s)return null;
  var files=((s._focusFiles)||[]).slice(0,100);
  var bm=s._focusBulkMode;
  var bs=s._focusBulkSelected;
  function _toggleFocusBulk(){s._focusBulkMode=!s._focusBulkMode;s._focusBulkSelected=[];renderChat();}
  function _toggleFocusItem(idx){var pos=bs.indexOf(idx);if(pos>=0){bs.splice(pos,1);}else{bs.push(idx);}renderChat();}
  function _focusBulkDelete(){if(bs.length===0)return;var sorted=bs.slice().sort(function(a,b){return b-a;});for(var k=0;k<sorted.length;k++){s._focusFiles.splice(sorted[k],1);}s._focusBulkMode=false;s._focusBulkSelected=[];_persistSessionState();renderChat();}
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',background:bm?C.accent:'transparent',color:bm?'#fff':C.tx4,transition:'background 0.15s'};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    h('div',{style:{height:22,display:'flex',alignItems:'center',padding:'0 10px',borderBottom:'1px solid '+C.border,flexShrink:0}},
      h('span',{style:{fontSize:_fs(12),fontWeight:600,color:C.tx2,flex:1}},'Soubory'),
      h('span',{style:{fontSize:_fs(9),fontFamily:C.mono,color:C.tx4,background:C.bg4,padding:'1px 5px',borderRadius:4}},files.length)),
    /* v92: Bulk action bar — reuses pattern from conversations/projects */
    files.length>0?h('div',{style:{padding:'3px 10px',display:'flex',alignItems:'center',gap:4,borderBottom:'1px solid '+C.border,flexShrink:0}},
      h('button',{style:markBtnS,onClick:_toggleFocusBulk},bm?'Hotovo':'Vybrat'),
      bm&&bs.length>0?h(React.Fragment,null,
        h('button',{style:{border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',background:'rgba(239,68,68,0.1)',color:C.red},
          onClick:_focusBulkDelete},'Odebrat ('+bs.length+')'),
        h('button',{style:{border:'none',borderRadius:4,padding:'3px 6px',fontSize:_fs(10),cursor:'pointer',background:'transparent',color:C.tx4},
          onClick:function(){s._focusBulkSelected=[];renderChat();}},'Zrušit')):null):null,
    h('div',{style:{flex:1,overflowY:'auto',padding:6}},
      files.length===0
        ?h('div',{style:{padding:'30px 16px',textAlign:'center',color:C.tx4,fontSize:_fs(11)}},'Zatím žádné soubory.',h('br'),h('span',{style:{fontSize:_fs(10),opacity:0.7}},'Soubory se zobrazí po odeslání příloh.'))
        :files.map(function(f,i){
          var isImg=/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(f.name);
          var bSel=bm&&bs.indexOf(i)>=0;
          var rowBg=bSel?'rgba(34,197,94,0.15)':'transparent';
          return h('div',{key:f.name+'-'+i,style:{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',borderRadius:6,marginBottom:2,cursor:bm?'pointer':'default',background:rowBg,transition:'background 0.15s'},
            onClick:bm?function(){_toggleFocusItem(i);}:undefined,
            onMouseEnter:function(e){if(!bSel)e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background=bSel?'rgba(34,197,94,0.15)':'transparent';}},
            bm?h('div',{style:{width:16,height:16,borderRadius:4,border:'2px solid '+(bSel?C.accent:C.tx4),background:bSel?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}},
              bSel?h('svg',{width:10,height:10,viewBox:'0 0 24 24',fill:'none',stroke:'#fff',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('polyline',{points:'20 6 9 17 4 12'})):null):null,
            h('span',{style:{fontSize:_fs(13),flexShrink:0}},isImg?'🖼️':'📄'),
            h('div',{style:{flex:1,minWidth:0}},
              h('div',{style:{fontSize:_fs(11),fontWeight:bSel?700:600,color:bSel?C.accentText:C.tx1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},f.name),
              h('div',{style:{fontSize:_fs(9),color:C.tx4}},f.size||'')),
            h('span',{style:{fontSize:_fs(9),color:C.tx4,flexShrink:0}},_relativeTime(f.addedAt)),
            !bm&&f.path?h('button',{style:{background:C.bg4,border:'none',borderRadius:4,padding:'2px 6px',cursor:'pointer',color:C.tx3,fontSize:_fs(10),flexShrink:0},
              title:'Kopírovat cestu',onClick:function(){try{navigator.clipboard.writeText(f.path);}catch(e){}}},'📋'):null);
        })));
}

function ChatApp(){
  /* v92+v122.2: Focus mode — specialist shows files, conversation shows info */
  if(isFocusActive()){
    if(isConversationFocus())return ConversationInfoApp();
    return FocusFilesApp();
  }
  var sc=_sessionCount;_ensureSessions();
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    /* Top bar — split count on the right */
    h('div',{style:{height:22,display:'flex',alignItems:'center',borderBottom:'1px solid '+C.border,flexShrink:0,padding:'0 6px'}},
      h('span',{style:{fontSize:_fs(12),fontWeight:600,color:C.tx2}},'Chat'),
      h('div',{style:{flex:1}}),
      h('span',{style:{fontSize:_fs(9),color:C.tx4,marginRight:4}},'Relace'),
      [1,2,3].map(function(n){
        return h('div',{key:n,style:{width:18,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(9),fontWeight:600,borderRadius:3,cursor:'pointer',marginRight:1,
          color:sc===n?C.tx1:C.tx4,background:sc===n?C.bg4:'transparent'},
          onClick:function(){_setSessionCount(n);}},n);
      })),
    /* Split panes */
    h('div',{style:{display:'flex',flex:1,overflow:'hidden',position:'relative'}},
      Array.from({length:sc},function(_,i){
        return h('div',{key:'cp'+i,style:{flex:1,display:'flex',borderRight:i<sc-1?'2px solid '+C.border2:'none',overflow:'hidden',minWidth:0}},_chatPaneUI(i));
      }),
      /* v91: Open-target dialog — replace current vs new relay */
      _openTargetDialog?h('div',{style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:60,display:'flex',alignItems:'center',justifyContent:'center'},
        onClick:function(ev){ev.stopPropagation();_openTargetDialogAction('cancel');}},
        h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,padding:'16px 20px',minWidth:220,maxWidth:320,boxShadow:'0 12px 40px rgba(0,0,0,0.5)'},
          onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:4}},
            'Otevřít '+(_openTargetDialog.type==='conv'?'konverzaci':'projekt')),
          h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},
            _openTargetDialog.data.name||_openTargetDialog.data.title||''),
          h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,
            background:C.accentBg,color:C.accentText,border:'1px solid '+C.accent,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
            onClick:function(){_openTargetDialogAction('replace');}},
            'Nahradit relaci '+(_sessionActive+1)+': '+(_sessions[_sessionActive]._label||'Relace')),
          h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,
            background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
            onClick:function(){_openTargetDialogAction('new');}},
            'Otevřít v nové relaci'),
          h('button',{style:{display:'block',width:'100%',padding:'8px 12px',background:'transparent',color:C.tx4,border:'1px solid '+C.border,borderRadius:6,fontSize:_fs(11),cursor:'pointer',textAlign:'left'},
            onClick:function(){_openTargetDialogAction('cancel');}},'Zrušit'))):null,
      /* v90: Relay picker dialog overlay */
      _relayPickDialog?h('div',{style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)',zIndex:60,display:'flex',alignItems:'center',justifyContent:'center'},
        onClick:function(ev){ev.stopPropagation();_relayPickDialog=null;renderChat();}},
        h('div',{style:{background:C.bg2,border:'1px solid '+C.border2,borderRadius:12,padding:'16px 20px',minWidth:220,maxWidth:300,boxShadow:'0 12px 40px rgba(0,0,0,0.5)'},
          onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:12}},'Kam otevřít?'),
          Array.from({length:sc},function(_,i){
            var s=_sessions[i];if(!s)return null;
            var occupied=!_isSessionEmpty(s);
            var label=s._label||(s._convId?'Chat':s._projectId?'Projekt':'Prázdná');
            return h('button',{key:'rp'+i,style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,
              background:occupied?C.bg3:C.accentBg,color:occupied?C.tx2:C.accentText,
              border:'1px solid '+(occupied?C.border2:C.accent),borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
              onClick:function(){var cb=_relayPickDialog.callback;_relayPickDialog=null;cb(i);}},
              'Relace '+(i+1)+': '+label);
          }),
          _sessionCount<3?h('button',{style:{display:'block',width:'100%',padding:'8px 12px',marginBottom:6,
            background:C.accentBg,color:C.accentText,border:'1px solid '+C.accent,borderRadius:6,fontSize:_fs(11),fontWeight:600,cursor:'pointer',textAlign:'left'},
            onClick:function(){var cb=_relayPickDialog.callback;_relayPickDialog=null;_setSessionCount(_sessionCount+1);_ensureSessions();cb(_sessionCount-1);}},'Otevřít v nové relaci'):null,
          h('button',{style:{display:'block',width:'100%',padding:'8px 12px',background:'transparent',color:C.tx4,border:'1px solid '+C.border,borderRadius:6,fontSize:_fs(11),cursor:'pointer',textAlign:'left'},
            onClick:function(){_relayPickDialog=null;renderChat();}},'Zrušit'))):null));
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
var TC={cre:C.cyan,llm:C.purple,tool:C.amber,gate:C.accentText,turn:C.blue,sys:C.tx3};
var _agentContainer=null;
var _turnCollapsed={};
var _scrollOnNewOnly=false;
var _agentRoot=null;
function renderAgent(){if(!_agentContainer)return;if(!_agentRoot)_agentRoot=_createRoot(_agentContainer);_agentRoot.render(h(AgentApp,null));_agentScrollBottom();}
function _agentScrollBottom(){if(_scrollOnNewOnly){_scrollOnNewOnly=false;return;}setTimeout(function(){if(!_agentContainer)return;var divs=_agentContainer.querySelectorAll('div');for(var i=0;i<divs.length;i++){var d=divs[i];if(d.style.overflowY==='auto'&&d.scrollHeight>d.clientHeight+20){d.scrollTop=d.scrollHeight;}}},80);}

function _agentLogContent(s){
  /* Use extracted renderer if available, fallback to flat list */
  if(typeof AgentLogRenderer!=='undefined'){
    return AgentLogRenderer.render(h,s,C,TC,_fs,_turnCollapsed,function(turnId){
      _turnCollapsed[turnId]=!_turnCollapsed[turnId];
      _scrollOnNewOnly=true;
      renderAgent();
    });
  }
  /* Fallback: flat log (backward compat if renderer not loaded) */
  return h('div',{style:{flex:1,overflowY:'auto'}},s.log.map(function(e,i){
    var agentColor=e.agent&&typeof C3Agent!=='undefined'?C3Agent.getAgentColor(e.agent):null;
    return h('div',{key:i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:_fs(11),lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
      h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
      e.agent?h('span',{style:{fontSize:_fs(9),padding:'1px 4px',borderRadius:3,background:agentColor+'22',color:agentColor,marginRight:2,flexShrink:0}},e.agent):null,
      h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
      h('span',{style:{color:C.tx2}},e.text));}));
}
/* ── Terminal command history (per-session) ── */
var _termHistory={};   /* sessionIdx → [cmd1, cmd2, ...] */
var _termHistIdx={};   /* sessionIdx → current browse position (-1 = new input) */
var _termHistDraft={}; /* sessionIdx → draft text before browsing history */
var _termTabAbort=null; /* AbortController for Tab completion */

function _termExec(idx,v){
  if(!v)return;
  /* Save to history (dedup consecutive) */
  if(!_termHistory[idx])_termHistory[idx]=[];
  var hist=_termHistory[idx];
  if(hist[hist.length-1]!==v)hist.push(v);
  if(hist.length>100)hist.shift(); /* cap at 100 */
  _termHistIdx[idx]=-1;
  _termHistDraft[idx]='';
  if(typeof C3Terminal!=='undefined')C3Terminal.send(idx,v);
}

function _termTabComplete(idx,el){
  var val=el.value;if(!val)return;
  /* Parse: extract last token (path-like) for completion */
  var parts=val.split(/\s+/);
  var lastToken=parts[parts.length-1]||'';
  var prefix=parts.slice(0,-1).join(' ');
  if(prefix)prefix+=' ';
  /* Determine directory to list */
  var cwd=window._wtRoot||'';
  if(!cwd)return;
  var dir=cwd;
  var partial=lastToken;
  /* If token has a slash, split into dir part + partial name */
  var slashIdx=lastToken.lastIndexOf('/');
  if(slashIdx>=0){
    var tokenDir=lastToken.substring(0,slashIdx+1);
    partial=lastToken.substring(slashIdx+1);
    if(tokenDir.charAt(0)==='/')dir=tokenDir;
    else dir=cwd+'/'+tokenDir;
  }
  /* Fetch directory listing from backend */
  if(_termTabAbort)try{_termTabAbort.abort();}catch(e){}
  _termTabAbort=new AbortController();
  fetch(_backendBase+'/api/workspace/ls?path='+encodeURIComponent(dir)+'&prefix='+encodeURIComponent(partial),{signal:_termTabAbort.signal})
  .then(function(r){return r.json();})
  .then(function(d){
    if(!d.entries||d.entries.length===0)return;
    if(d.entries.length===1){
      /* Single match — auto-complete */
      var match=d.entries[0];
      var completed=match.name+(match.isDir?'/':'');
      if(slashIdx>=0){completed=lastToken.substring(0,slashIdx+1)+completed;}
      el.value=prefix+completed;
    }else{
      /* Multiple matches — find common prefix and show options in terminal */
      var names=d.entries.map(function(e){return e.name;});
      var common=names[0];
      for(var i=1;i<names.length;i++){
        while(names[i].indexOf(common)!==0&&common.length>0)common=common.substring(0,common.length-1);
      }
      if(common.length>partial.length){
        if(slashIdx>=0){common=lastToken.substring(0,slashIdx+1)+common;}
        el.value=prefix+common;
      }
      /* Show options in terminal output */
      var s=_sessions[idx];if(s){
        s.term.push({text:names.map(function(n){return n;}).join('  '),ts:new Date().toISOString(),type:'output'});
        s.term.push({text:'$ '+el.value,ts:new Date().toISOString(),type:'prompt'});
        renderAgent();
      }
    }
  }).catch(function(){/* ignore abort/network errors */});
}

function _terminalContent(s,idx){
  var isExec=typeof C3Terminal!=='undefined'&&C3Terminal.isExecuting(idx);
  return h('div',{style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    h('div',{style:{flex:1,overflowY:'auto',padding:'5px 10px',fontFamily:C.mono,fontSize:_fs(11.5),lineHeight:'1.6',color:C.tx2}},
      s.term.map(function(t,i){
        return h('div',{key:i},t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
          t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
      })),
    /* Terminal input */
    h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'3px 6px',borderTop:'1px solid '+C.border,background:C.bg2,flexShrink:0}},
      h('span',{style:{color:C.accentText,fontFamily:C.mono,fontSize:_fs(11),flexShrink:0}},'$'),
      h('input',{id:'c3-term-input-'+idx,key:'term-input-'+idx,autoFocus:true,
        style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.mono,fontSize:_fs(11.5)},
        placeholder:isExec?'Čekám na dokončení...':'Zadej příkaz...',disabled:isExec,
        ref:function(el){if(el&&!isExec)setTimeout(function(){el.focus();},50);},
        onKeyDown:function(e){
          /* Enter — execute command */
          if(e.key==='Enter'){
            var v=e.target.value.trim();
            if(v){_termExec(idx,v);e.target.value='';renderAgent();
              setTimeout(function(){var el=document.getElementById('c3-term-input-'+idx);if(el&&!el.disabled)el.focus();},100);}
            return;
          }
          /* Tab — autocomplete file/dir names */
          if(e.key==='Tab'){
            e.preventDefault();
            _termTabComplete(idx,e.target);
            return;
          }
          /* ArrowUp — previous command in history */
          if(e.key==='ArrowUp'){
            e.preventDefault();
            var hist=_termHistory[idx]||[];
            if(hist.length===0)return;
            var hi=_termHistIdx[idx];
            if(hi==null||hi<0){_termHistDraft[idx]=e.target.value;hi=hist.length;}
            hi--;
            if(hi<0)hi=0;
            _termHistIdx[idx]=hi;
            e.target.value=hist[hi]||'';
            return;
          }
          /* ArrowDown — next command in history */
          if(e.key==='ArrowDown'){
            e.preventDefault();
            var hist2=_termHistory[idx]||[];
            var hi2=_termHistIdx[idx];
            if(hi2==null||hi2<0)return;
            hi2++;
            if(hi2>=hist2.length){_termHistIdx[idx]=-1;e.target.value=_termHistDraft[idx]||'';return;}
            _termHistIdx[idx]=hi2;
            e.target.value=hist2[hi2]||'';
            return;
          }
        }}),
      isExec?h('button',{style:{background:C.redBg,color:C.red,border:'none',borderRadius:4,cursor:'pointer',fontSize:_fs(9),fontWeight:600,padding:'2px 6px',flexShrink:0},
        onClick:function(){_cancelExecution(idx);}},'STOP'):null));
}
function _mixedContent(s){
  /* Interleave log entries + terminal lines sorted by timestamp */
  var items=[];
  s.log.forEach(function(e){items.push({src:'log',d:e,ts:e.ts||''});});
  s.term.forEach(function(t){items.push({src:'term',d:t,ts:t.ts||''});});
  items.sort(function(a,b){return a.ts.localeCompare(b.ts);});
  return h('div',{style:{flex:1,overflowY:'auto',padding:'2px 0'}},items.map(function(it,i){
    if(it.src==='log'){var e=it.d;return h('div',{key:'l'+i,style:{display:'flex',gap:6,padding:'2px 10px',fontFamily:C.mono,fontSize:_fs(11),lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?'rgba(34,197,94,0.03)':'transparent'}},
      h('span',{style:{color:C.tx4,flexShrink:0,minWidth:58}},e.time),
      h('span',{style:{fontWeight:600,minWidth:60,flexShrink:0,color:TC[e.cls]||C.tx3}},e.type),
      h('span',{style:{color:C.tx2}},e.text));}
    var t=it.d;return h('div',{key:'t'+i,style:{padding:'2px 10px',fontFamily:C.mono,fontSize:_fs(11.5),lineHeight:'1.5',color:C.tx2,background:'rgba(255,255,255,0.02)'}},
      t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
        t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
  }));
}
/* ── Cancel execution (LLM + terminal) ── */
function _cancelExecution(idx) {
  var s = _sessions[idx];
  var chatCancelSent = false;
  var localPreparedCancelled = _chatCancelPreparedSend(idx, s);
  if (!localPreparedCancelled && typeof C3WS !== 'undefined') chatCancelSent = C3WS.sendCancel(s);
  if (typeof C3Terminal !== 'undefined') C3Terminal.cancel(idx);
  if (s && localPreparedCancelled) {
    s.log.push({time:new Date().toLocaleTimeString('cs-CZ'),type:'CANCEL',cls:'info',text:'Rozpracované odeslání zrušeno.',active:false,ts:new Date().toISOString()});
  } else if (s && chatCancelSent) {
    s.log.push({time:new Date().toLocaleTimeString('cs-CZ'),type:'CANCEL',cls:'info',text:'Požadavek na zrušení odeslán.',active:true,ts:new Date().toISOString()});
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
    items.length===0?h('div',{style:{padding:20,textAlign:'center',color:C.tx4,fontSize:_fs(11)}},'Žádné audit záznamy.'):
    items.map(function(it,i){
      if(it.src==='audit'){var a=it.d;return h('div',{key:'a'+i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:_fs(10.5),lineHeight:'1.5',borderLeft:'3px solid '+(a.verdict==='ok'||a.passed?C.accent:a.verdict==='warning'?C.amber:C.red)}},
        h('span',{style:{color:C.tx4,flexShrink:0,minWidth:70,fontSize:_fs(9.5)}},a.created_at?(a.created_at.substring(11,19)||''):''),
        h('span',{style:{fontWeight:600,minWidth:50,flexShrink:0,color:a.verdict==='ok'||a.passed?C.accentText:a.verdict==='warning'?C.amber:C.red}},'MERGE'),
        h('span',{style:{color:C.tx2}},_s(a.expertise_name||'')+' → '+(a.verdict||a.result||'')));}
      var dr=it.d;return h('div',{key:'d'+i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:_fs(10.5),lineHeight:'1.5',borderLeft:'3px solid '+C.amber}},
        h('span',{style:{color:C.tx4,flexShrink:0,minWidth:70,fontSize:_fs(9.5)}},dr.created_at?(dr.created_at.substring(11,19)||''):''),
        h('span',{style:{fontWeight:600,minWidth:50,flexShrink:0,color:C.amber}},'DRIFT'),
        h('span',{style:{color:C.tx2}},_s(dr.capability||'')+': '+(dr.drift_score||dr.value||'')));
    }));
}

function _bottomPane(idx){
  var s=_sessions[idx];if(!s)return null;
  /* v92: In focus mode, render log-only without mutating s.bottom */
  var mode=isFocusActive()?'agent':(s.bottom||'split');
  /* Split/Mix together, then gap, then Terminal/Log/Audit */
  var grpA=[{k:'split',l:'Split'},{k:'mix',l:'Mix'}];
  var grpB=[{k:'terminal',l:'Terminal'},{k:'agent',l:'Log'},{k:'audit',l:'Audit'}];
  function setMode(m){s.bottom=m;renderAgent();}
  function _tab(m,mi){var active=mode===m.k;return h(React.Fragment,{key:m.k},
    mi>0?h('div',{style:{width:1,background:C.border}}):null,
    h('div',{style:{display:'flex',alignItems:'center',padding:'0 8px',fontSize:_fs(12),fontWeight:600,color:active?C.tx1:C.tx4,cursor:'pointer',borderBottom:'2px solid '+(active?C.accent:'transparent'),gap:3},
      onClick:function(){setMode(m.k);}},
      m.l,m.k==='agent'?h('span',{style:{fontSize:_fs(8),background:C.bg4,padding:'0 3px',borderRadius:4,color:C.tx3}},s.log.length):null));}
  return h('div',{key:'bp'+idx,style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    /* Per-panel tab bar — hidden in focus mode via CSS class */
    h('div',{className:'c3-bottom-mode-tabs',style:{height:24,display:'flex',alignItems:'stretch',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2}},
      grpA.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{width:10}}),/* gap between groups */
      grpB.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{flex:1}}),
      /* STOP button — visible when executing */
      (typeof C3Agent!=='undefined'&&C3Agent.isExecuting(idx))||(typeof C3Terminal!=='undefined'&&C3Terminal.isExecuting(idx))?
        h('button',{style:{background:C.redBg,color:C.red,border:'none',borderRadius:3,cursor:'pointer',fontSize:_fs(8),fontWeight:700,padding:'2px 6px',margin:'0 4px',alignSelf:'center'},
          onClick:function(){_cancelExecution(idx);}},'■ STOP'):null,
      h('span',{style:{fontSize:_fs(9),color:C.tx4,padding:'0 6px',alignSelf:'center'}},''+(idx+1))),
    /* Panel content */
    mode==='split'?_splitContent(s,idx):mode==='agent'?_agentLogContent(s):mode==='terminal'?_terminalContent(s,idx):mode==='audit'?_auditContent(s):_mixedContent(s));
}

function AgentApp(){
  var sc=_sessionCount;_ensureSessions();
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',background:C.bg1,fontFamily:C.font}},
    /* Top bar — synced session count */
    h('div',{style:{height:22,display:'flex',alignItems:'center',justifyContent:'flex-end',borderBottom:'1px solid '+C.border,flexShrink:0,padding:'0 6px',gap:2}},
      h('span',{style:{fontSize:_fs(9),color:C.tx4,marginRight:4}},'Relace'),
      [1,2,3].map(function(n){
        return h('div',{key:n,style:{width:18,height:16,display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(9),fontWeight:600,borderRadius:3,cursor:'pointer',
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

/* ── Snap-collapse state ── */
var _c3LastLeftW=240,_c3LastRightW=420;
var _C3_MIN_LEFT=200,_C3_MIN_RIGHT=300;
var _c3SnapLock=false;
var _agentsForbidden=false;

class C3SidebarContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_SIDEBAR_ID,widgetName:'C3 Navigation',defaultWidgetOptions:{area:'left',rank:0},toggleCommandId:'c3:toggleSidebar',toggleKeybinding:'ctrlcmd+b'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  registerCommands(c){
    c.registerCommand({id:'c3:toggleSidebar',label:'C3: Toggle Sidebar',category:'C3'},{
      execute:function(){
        if(typeof window._c3IsLeftHidden==='function'&&window._c3IsLeftHidden()){
          var tw=(_sidebarWidget&&_sidebarWidget._collapsed)?48:(_c3LastLeftW||240);
          window._c3SnapShowLeft(tw);
        }else{
          var n=document.getElementById('theia-left-content-panel');
          if(n)_c3LastLeftW=n.offsetWidth||240;
          window._c3SnapHideLeft();
        }
      }
    });
  }
  async onStart(a){
    window._c3App=a;
    try{await this.openView({activate:false,reveal:true});}catch(e){}
    _c3SnapLock=true; /* Lock immediately — prevent snap-collapse during entire init */
    setTimeout(function(){
      try{a.shell.resize(240,'left');}catch(e){}
      /* ── Spacing fix ── */
      try{
        var lc=a.shell.leftPanelHandler.container;
        var lrSplit=lc&&lc.parent;
        if(lrSplit&&lrSplit.id==='theia-left-right-split-panel'){lrSplit.spacing=4;}
        var mp=a.shell.mainPanel;
        var btSplit=mp&&mp.parent;
        if(btSplit&&btSplit.id==='theia-bottom-split-panel'){btSplit.spacing=4;}
      }catch(e){console.warn('[C3] Split spacing fix:',e);}
      /* ── Snap-collapse via ResizeObserver + expand tabs ── */
      try{
        console.log('[C3] Snap-collapse init');
        var _lph=a.shell.leftPanelHandler;
        var _rph=a.shell.rightPanelHandler;
        var leftCP=_lph&&_lph.container?_lph.container.node:null;
        var rightCP=_rph&&_rph.container?_rph.container.node:null;
        console.log('[C3] leftCP=',!!leftCP,'rightCP=',!!rightCP);
        var _leftSnapT=null,_rightSnapT=null;
        /* Helper: hide a side panel via Lumino Widget.hide() — removes from layout */
        function _snapHide(handler,side){
          _c3SnapLock=true;
          console.log('[C3] snap-hide',side);
          try{handler.container.hide();}catch(e){console.warn('[C3] hide fail',e);}
          setTimeout(function(){_c3SnapLock=false;},600);
        }
        /* Helper: show a side panel + resize to saved width */
        function _snapShow(handler,side,w){
          _c3SnapLock=true;
          console.log('[C3] snap-show',side,w);
          try{handler.container.show();a.shell.resize(w,side);}catch(e){console.warn('[C3] show fail',e);}
          setTimeout(function(){_c3SnapLock=false;},600);
        }
        /* Right panel: snap-hide when below threshold */
        if(rightCP){new ResizeObserver(function(entries){
          if(_c3SnapLock||!_settingsVals.autoCollapse)return;
          var w=entries[0].contentRect.width;
          if(w>0&&w<_C3_MIN_RIGHT){
            if(!_rightSnapT){_rightSnapT=setTimeout(function(){
              _rightSnapT=null;if(_c3SnapLock)return;
              if(rightCP.offsetWidth>0&&rightCP.offsetWidth<_C3_MIN_RIGHT){
                _snapHide(_rph,'right');
              }
            },300);}
          }else{if(_rightSnapT){clearTimeout(_rightSnapT);_rightSnapT=null;}
            if(w>=_C3_MIN_RIGHT){_c3LastRightW=w;}
          }
        }).observe(rightCP);}
        /* Left panel: snap-hide when below threshold */
        if(leftCP){new ResizeObserver(function(entries){
          if(_c3SnapLock||!_settingsVals.autoCollapse)return;
          var w=entries[0].contentRect.width;
          if(w>0&&w<_C3_MIN_LEFT){
            if(!_leftSnapT){_leftSnapT=setTimeout(function(){
              _leftSnapT=null;if(_c3SnapLock)return;
              if(leftCP.offsetWidth>0&&leftCP.offsetWidth<_C3_MIN_LEFT){
                _snapHide(_lph,'left');
              }
            },300);}
          }else{if(_leftSnapT){clearTimeout(_leftSnapT);_leftSnapT=null;}
            if(w>=160){_c3LastLeftW=w;}
          }
        }).observe(leftCP);}
        /* Expand tabs — floating arrows at edges */
        var _mkExpandTab=function(side){
          var el=document.createElement('div');
          var isLeft=side==='left';
          el.style.cssText='position:fixed;'+(isLeft?'left:0':'right:0')+';top:50%;transform:translateY(-50%);width:6px;height:48px;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:10000;border-radius:'+(isLeft?'0 6px 6px 0':'6px 0 0 6px')+';background:'+C.border2+';border:none;opacity:0.15;transition:opacity 0.2s,width 0.2s,background 0.15s;';
          el.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="'+C.tx2+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0;transition:opacity 0.2s">'+(isLeft?'<polyline points="9 18 15 12 9 6"/>':'<polyline points="15 18 9 12 15 6"/>')+'</svg>';
          el.title=isLeft?'Rozbalit sidebar':'Rozbalit chat panel';
          el.addEventListener('mouseenter',function(){el.style.opacity='1';el.style.width='24px';el.style.background=C.bg4;el.querySelector('svg').style.opacity='1';});
          el.addEventListener('mouseleave',function(){el.style.opacity='0.15';el.style.width='6px';el.style.background=C.border2;el.querySelector('svg').style.opacity='0';});
          el.addEventListener('click',function(){
            if(isLeft){
              var tw=(_sidebarWidget&&_sidebarWidget._collapsed)?48:(_c3LastLeftW||240);
              _snapShow(_lph,'left',tw);
            }else{
              _snapShow(_rph,'right',_c3LastRightW||420);
            }
          });
          document.body.appendChild(el);
          return el;
        };
        var _leftTab=_mkExpandTab('left');
        var _rightTab=_mkExpandTab('right');
        /* Show/hide expand tabs based on container hidden state */
        /* Expose snap helpers for toggle commands */
        window._c3SnapHideLeft=function(){_snapHide(_lph,'left');};
        window._c3SnapShowLeft=function(w){_snapShow(_lph,'left',w);};
        window._c3SnapHideRight=function(){_snapHide(_rph,'right');};
        window._c3SnapShowRight=function(w){_snapShow(_rph,'right',w);};
        window._c3IsLeftHidden=function(){return _lph.container.isHidden;};
        window._c3IsRightHidden=function(){return _rph.container.isHidden;};
        /* Show/hide expand tabs based on container hidden state */
        function _updateTabs(){
          _leftTab.style.display=(_lph.container.isHidden)?'flex':'none';
          _rightTab.style.display=(_rph.container.isHidden)?'flex':'none';
        }
        setInterval(_updateTabs,500);
        _updateTabs();
        /* v130: Resize right panel AFTER observers are installed (fixes race condition) */
        try{a.shell.resize(420,'right');}catch(e){}
        /* Unlock snap-collapse after panels have settled */
        setTimeout(function(){_c3SnapLock=false;console.log('[C3] Snap-lock released');},1200);
      }catch(e){console.warn('[C3] Snap-collapse setup:',e);_c3SnapLock=false;}
    },800);
  }
}
inversify_1.decorate(inversify_1.injectable(),C3SidebarContrib);

class C3ChatContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_CHAT_ID,widgetName:'C3 Chat',defaultWidgetOptions:{area:'right',rank:100},toggleCommandId:'c3:toggleChat',toggleKeybinding:'ctrlcmd+shift+l'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  registerCommands(c){
    c.registerCommand({id:'c3:toggleChat',label:'C3: Toggle Chat',category:'C3'},{
      execute:function(){
        if(typeof window._c3IsRightHidden==='function'&&window._c3IsRightHidden()){
          window._c3SnapShowRight(_c3LastRightW||420);
        }else{
          var n=document.getElementById('theia-right-content-panel');
          if(n)_c3LastRightW=n.offsetWidth||420;
          window._c3SnapHideRight();
        }
      }
    });
  }
  async onStart(a){try{await this.openView({activate:false,reveal:true});
    /* v130: Right panel resize moved to SidebarContrib.onStart (after ResizeObserver setup).
       Lock is set there too — no duplicate lock/resize needed here. */
  }catch(e){}}}
inversify_1.decorate(inversify_1.injectable(),C3ChatContrib);

class C3AgentContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:C3_AGENT_ID,widgetName:'Agent Log',defaultWidgetOptions:{area:'bottom',rank:100},toggleCommandId:'c3:toggleAgent',toggleKeybinding:'ctrlcmd+shift+a'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  async onStart(a){try{await this.openView({activate:false,reveal:true});}catch(e){}}}
inversify_1.decorate(inversify_1.injectable(),C3AgentContrib);

class C3StatusContrib {
  onStart(){this._c();}
  async _c(){try{var r=await fetch(_backendBase+'/health',{signal:AbortSignal.timeout(2000)});document.body.classList.toggle('c3-backend-online',r.ok);}catch(e){document.body.classList.remove('c3-backend-online');}}}
inversify_1.decorate(inversify_1.injectable(),C3StatusContrib);


/* ═══════════════════════════════════════════════════════════
   DI MODULE
   ═══════════════════════════════════════════════════════════ */
exports.default = new inversify_1.ContainerModule(function(bind){
  // Sidebar
  var _URI = require("@theia/core/lib/common/uri").default;
  bind(C3SidebarWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){
    // Expose OpenerService for file editing via Monaco editor (runs when sidebar factory is resolved)
    if(!window._c3OpenFileInEditor){
      try{
        var openerService=ctx.container.get(browser_1.OpenerService);
        window._c3OpenFileInEditor=function(filePath){
          try{
            var uri=new _URI(filePath);
            // Hide center container so Monaco editor is visible
            if(_centerContainer)_centerContainer.style.display='none';
            openerService.getOpener(uri).then(function(opener){
              return opener.open(uri,{mode:'activate'});
            }).catch(function(err){
              console.error('[C3] Opener error:',err);
              if(_centerContainer)_centerContainer.style.display='';
            });
          }catch(err){
            console.warn('[C3] Editor open failed:',err);
            if(_centerContainer)_centerContainer.style.display='';
          }
        };
        console.log('[C3] OpenerService ready — file editing via Monaco enabled');
      }catch(e){console.warn('[C3] OpenerService not available:',e);}
    }
    return{id:C3_SIDEBAR_ID,createWidget:function(){return ctx.container.get(C3SidebarWidget);}};
  }).inSingletonScope();
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
