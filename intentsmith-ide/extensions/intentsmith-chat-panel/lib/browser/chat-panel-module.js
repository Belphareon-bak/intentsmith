"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* One-time additive migration; old keys remain available to the previous installation. */
try {
  for (var key of Object.keys(localStorage)) {
    if (key.indexOf('c3-')===0 || key.indexOf('c3.')===0) {
      var nextKey='intentsmith'+key.slice(2);
      if(localStorage.getItem(nextKey)===null)localStorage.setItem(nextKey,localStorage.getItem(key));
    }
  }
} catch(e) { console.warn('[IntentSmith] Uložené nastavení se nepodařilo převést.'); }

try { require("./styles/intentsmith-theme.css"); } catch(e) {}
try { require("./styles/intentsmith-chat.css"); } catch(e) {}

var inversify_1 = require("@theia/core/shared/inversify");
var browser_1 = require("@theia/core/lib/browser");
var react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
var ReactDOM = require("@theia/core/shared/react-dom");
var _createRoot = (ReactDOM.createRoot || function(c){return{render:function(el){ReactDOM.render(el,c);}};});
var React = require("@theia/core/shared/react");
var createLegacyLocalObjectUrlCache = require("../../../../shared/legacy-local-object-url-cache").createLegacyLocalObjectUrlCache;
var h = React.createElement;

/* ═══ TRANSPORT MODULES ═══ */
try { require("./event-bus"); } catch(e) { console.warn('[IntentSmith] event-bus.js not loaded:', e.message); }
/* M1 runtime validation is a hard product dependency after protocol prebuild. */
require("./ws-client");
try { require("./agent-client"); } catch(e) { console.warn('[IntentSmith] agent-client.js not loaded:', e.message); }
try { require("./agent-log-renderer"); } catch(e) { console.warn('[IntentSmith] agent-log-renderer.js not loaded:', e.message); }
try { require("./terminal-client"); } catch(e) { console.warn('[IntentSmith] terminal-client.js not loaded:', e.message); }

/* ═══ COLORS ═══ */
var _C_DEFAULT={bg0:'#09090b',bg1:'#141416',bg2:'#1b1b1e',bg3:'#232326',bg4:'#2d2c30',bg5:'#38373c',
  tx1:'#f4f1ea',tx2:'#b9b2a7',tx3:'#a18d6e',tx4:'#8c7d67',
  accent:'#d4a85f',accentText:'#e7c27a',accentDim:'#9b6b32',accentBg:'rgba(212,168,95,0.12)',onAccent:'#17120a',
  success:'#5ecf91',successBg:'rgba(94,207,145,0.12)',
  red:'#f87171',redBg:'rgba(239,68,68,0.1)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
  blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
  cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
  border:'rgba(231,194,122,0.08)',border2:'rgba(231,194,122,0.15)',
  font:"'Plus Jakarta Sans',-apple-system,sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"};
var _C_CLEAN={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',
  tx1:'#ececef',tx2:'#a1a1aa',tx3:'#5e8a6d',tx4:'#436b52',
  accent:'#22c55e',accentText:'#4ade80',accentDim:'#16a34a',accentBg:'rgba(34,197,94,0.08)',onAccent:'#ffffff',
  success:'#22c55e',successBg:'rgba(34,197,94,0.08)',
  red:'#f87171',redBg:'rgba(239,68,68,0.1)',amber:'#fbbf24',amberBg:'rgba(251,191,36,0.1)',
  blue:'#60a5fa',blueBg:'rgba(96,165,250,0.1)',purple:'#a78bfa',purpleBg:'rgba(167,139,250,0.1)',
  cyan:'#22d3ee',cyanBg:'rgba(34,211,238,0.1)',
  border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)',
  font:"'Plus Jakarta Sans',-apple-system,sans-serif",mono:"'JetBrains Mono','Fira Code',monospace"};
var _C_THEMES={
  intentsmith:_C_DEFAULT,
  clean:_C_CLEAN,
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
function _appearanceMode(){try{return localStorage.getItem('intentsmith-theme-mode')||'intentsmith';}catch(e){return'intentsmith';}}
function _isProTheme(themeId){return themeId!=='intentsmith'&&themeId!=='clean';}
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
  r.setAttribute('data-intentsmith-appearance',themeId||'intentsmith');
  /* For pro themes: intentsmith CSS vars → transparent (structural wrappers must not add another glass layer).
     Only React inline styles (C.bg*) provide the single glass layer.
     For clean theme: intentsmith CSS vars = C.bg* (solid hex, normal behavior). */
  if(g){
    r.style.setProperty('--intentsmith-bg0','transparent');r.style.setProperty('--intentsmith-bg1','transparent');
    r.style.setProperty('--intentsmith-bg2','transparent');r.style.setProperty('--intentsmith-bg3','transparent');
    r.style.setProperty('--intentsmith-bg4','transparent');r.style.setProperty('--intentsmith-bg5','transparent');
  } else {
    r.style.setProperty('--intentsmith-bg0',C.bg0);r.style.setProperty('--intentsmith-bg1',C.bg1);
    r.style.setProperty('--intentsmith-bg2',C.bg2);r.style.setProperty('--intentsmith-bg3',C.bg3);
    r.style.setProperty('--intentsmith-bg4',C.bg4);r.style.setProperty('--intentsmith-bg5',C.bg5);
  }
  r.style.setProperty('--intentsmith-tx1',C.tx1);r.style.setProperty('--intentsmith-tx2',C.tx2);
  r.style.setProperty('--intentsmith-tx3',C.tx3);r.style.setProperty('--intentsmith-tx4',C.tx4);
  r.style.setProperty('--intentsmith-accent',C.accent);r.style.setProperty('--intentsmith-accent-dim',C.accent);
  r.style.setProperty('--intentsmith-accent-bg',C.accentBg);r.style.setProperty('--intentsmith-accent-text',C.accentText);
  r.style.setProperty('--intentsmith-on-accent',C.onAccent);r.style.setProperty('--intentsmith-success',C.success);
  r.style.setProperty('--intentsmith-success-bg',C.successBg);
  r.style.setProperty('--intentsmith-border',C.border);r.style.setProperty('--intentsmith-border2',C.border2);
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
  var sid='intentsmith-pro-theme-css';var ex=document.getElementById(sid);
  if(!ex){ex=document.createElement('style');ex.id=sid;document.head.appendChild(ex);}
  if(!themeId||!_isProTheme(themeId)){ex.textContent='';return;}
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
  if(css&&themeId&&_isProTheme(themeId)){
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
    css+=B+' .intentsmith-card{background:rgba('+pbc[0]+','+pbc[1]+','+pbc[2]+','+tileAlpha.toFixed(2)+')!important;}\n';
    /* Sidebar/panel glass — target both outer container AND inner React div (which has inline background) */
    var panelRgba='rgba('+pbc[0]+','+pbc[1]+','+pbc[2]+','+panelAlpha.toFixed(2)+')';
    css+=B+' #intentsmith-sidebar,'+B+' #intentsmith-chat-panel,'+B+' #intentsmith-agent-panel,'+B+' #theia-bottom-content-panel{background:'+panelRgba+'!important;backdrop-filter:blur(20px)!important;}\n';
    css+=B+' #intentsmith-sidebar>div,'+B+' #intentsmith-chat-panel>div,'+B+' #intentsmith-agent-panel>div{background:transparent!important;}\n';
  }
  ex.textContent=css;
}

/* Color interpolation for intensity sliders */
function _hp(hex){var n=parseInt(hex.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}
function _hs(r,g,b){return '#'+((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);}
function _cl(a,b,t){var ca=_hp(a),cb=_hp(b);return _hs(Math.round(ca[0]+(cb[0]-ca[0])*t),Math.round(ca[1]+(cb[1]-ca[1])*t),Math.round(ca[2]+(cb[2]-ca[2])*t));}
function _rgba(hex,a){var c=_hp(hex);return'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';}
function _onColor(hex){var c=_hp(hex);return(c[0]*299+c[1]*587+c[2]*114)/1000>155?'#17120a':'#ffffff';}
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
  _editorState=_sessions[newIdx]._editor||(_sessions[newIdx]._editor={active:false,tabs:[],activeTabId:null,scrollRaf:null});
  _loadTreeState(newIdx);
  _ensureWorkspaceTree(newIdx);
  /* v92: Sync focus mode class — layout derives from new session's specialist */
  _syncFocusClass();renderCenter();renderChat();renderAgent();
}
/* A restored inactive tab has only a root, not a loaded tree. */
function _ensureWorkspaceTree(idx){
  var s=_sessions[idx],cached=_perSessionTree[idx];if(!s||s._closed||s._treeLoading)return;
  if(cached&&cached.rawTree!==null&&cached.rawTree!==undefined)return;
  var proj=s._projectId&&PROJECTS.find(function(p){return p.id===s._projectId;});
  var root=(proj&&proj.path)||(cached&&cached.wtRoot);if(root)_loadWorkspaceTree(root,idx);
}
/* ── Flatten nested tree respecting collapsed state ── */
function _flattenTree(nodes,depth,parentPath,collapsed){
  collapsed=collapsed||_collapsedDirs;
  var result=[];
  (nodes||[]).forEach(function(node){
    var fp=parentPath?parentPath+'/'+node.n:node.n;
    var entry={n:node.n,d:!!node.d,i:depth,fp:fp,_children:node.children||null};
    result.push(entry);
    if(node.d&&node.children&&!collapsed[fp]){
      result=result.concat(_flattenTree(node.children,depth+1,fp,collapsed));
    }
  });
  return result;
}
/* ── Load real filesystem tree from backend ── */
function _loadWorkspaceTree(rootPath,ownerIdx){
  if(!rootPath)return;
  var idx=typeof ownerIdx==='number'?ownerIdx:_sessionActive,s=_sessions[idx];if(!s||s._closed)return;
  var token={};s._treeLoadToken=token;s._treeLoading=true;
  _perSessionTree[idx]={wtRoot:rootPath,collapsedDirs:{},rawTree:null,files:[]};
  if(idx===_sessionActive){_wtRoot=rootPath;_wtLoading=true;renderSidebar();}
  function current(){return _sessions[idx]===s&&!s._closed&&s._treeLoadToken===token;}
  return fetch(_backendUrl()+'/api/workspace/tree?path='+encodeURIComponent(rootPath),{signal:AbortSignal.timeout(8000)})
  .then(function(r){if(!r.ok)throw Error('Strom projektu nelze načíst.');return r.json();})
  .then(function(data){
    if(!current())return;
    s._treeLoading=false;
    if(data.tree){
      var collapsed={};data.tree.forEach(function(node){if(node.d)collapsed[node.n]=true;});
      _perSessionTree[idx]={wtRoot:data.root||rootPath,rawTree:data.tree,collapsedDirs:collapsed,files:_flattenTree(data.tree,0,null,collapsed)};
    }
    if(idx===_sessionActive){_wtLoading=false;_loadTreeState(idx);_fetchGitStatus();}
  }).catch(function(){if(current()){s._treeLoading=false;if(idx===_sessionActive){_wtLoading=false;renderSidebar();}}});
}
/* ── Fetch git status and merge into file entries ── */
var _gitStatusTimer=null;
function _fetchGitStatus(){
  if(!_wtRoot)return;
  var idx=_sessionActive,owner=_sessions[idx],root=_wtRoot;
  fetch(_backendUrl()+'/api/workspace/git-status?path='+encodeURIComponent(root),{signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(data){
    if(!data.files||_sessionActive!==idx||_sessions[idx]!==owner||_wtRoot!==root)return;
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
  fetch(_backendUrl()+'/api/workspace/file',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:name,root:_wtRoot,content:''}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Create directory on filesystem ── */
function _wtCreateDir(name){
  if(!_wtRoot||!name)return;
  fetch(_backendUrl()+'/api/workspace/directory',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:name,root:_wtRoot}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Rename file/dir on filesystem ── */
function _wtRenameItem(oldPath,newPath){
  if(!_wtRoot||!oldPath||!newPath||oldPath===newPath)return;
  fetch(_backendUrl()+'/api/workspace/rename',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({from:oldPath,to:newPath,root:_wtRoot}),signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
/* ── Delete file/dir on filesystem ── */
function _wtDeleteItem(itemPath){
  if(!_wtRoot||!itemPath)return;
  fetch(_backendUrl()+'/api/workspace/file?path='+encodeURIComponent(itemPath)+'&root='+encodeURIComponent(_wtRoot),
    {method:'DELETE',signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(d){if(d.ok)_loadWorkspaceTree(_wtRoot);})
  .catch(function(){});
}
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:0,recent:[]},{id:'projects',label:'Projekty',icon:'folder',badge:0,recent:[]},{id:'specialists',label:'Specialisté',icon:'users',badge:SPECIALISTS.length,recent:SPECIALISTS.slice(0,2).map(function(s){return s.name;})},{id:'expertises',label:'Expertyzy',icon:'expert',badge:EXPERTISES.length,recent:EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;})},{id:'workers',label:'Workeri',icon:'worker',badge:0,recent:[]},{id:'marketplace',label:'Obchod',icon:'store',badge:0,recent:[]},{id:'multimedia',label:'Multim\u00E9dia',icon:'media',badge:0,recent:[]}];

/* ═══ LIVE DATA FETCH ═══ */
/* Read the private endpoint on every request: a managed backend restart rotates
   both its port and capability while this renderer stays open. */
function _backendUrl(){
  if(typeof window!=='undefined'&&window.electronIntentSmith){
    try{return window.electronIntentSmith.getBackendUrl()||'';}catch(e){return '';}
  }
  return 'http://127.0.0.1:3335';
}

/* v88: Extracted expertise fetch — reusable for initial load + post-skill refresh */
function _fetchSpecialists(){
  return fetch(_backendUrl()+'/api/specialists',{signal:AbortSignal.timeout(5000)}).then(function(r){if(!r.ok)throw new Error('Specialisté: HTTP '+r.status);return r.json();}).then(function(data){
    if(!data.ok||!Array.isArray(data.specialists))throw new Error('Neplatný seznam specialistů');
    SPECIALISTS=data.specialists.filter(function(s){return s.status==='enabled'&&s.type!=='utility';}).map(function(s){return {id:s.id,expertiseId:s.expertiseId,name:s.name,emoji:s.icon||'🤖',desc:s.description||s.domain,domain:s.domain,tags:[s.domain,'Specialista']};});
    NAV[2].badge=SPECIALISTS.length;NAV[2].recent=SPECIALISTS.slice(0,3).map(function(s){return s.name;});renderCenter();
  }).catch(function(e){console.error('[IntentSmith:specialists]',e.message);});
}
function _fetchExpertises(){
  _fetchSpecialists();
  fetch(_backendUrl()+'/api/expertises',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
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

    }
    NAV[3].badge=EXPERTISES.length;NAV[3].recent=EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;});
    NAV[2].badge=SPECIALISTS.length;NAV[2].recent=SPECIALISTS.slice(0,3).map(function(s){return s.name;});
    renderCenter();
  }).catch(function(err){if(typeof console!=='undefined')console.error('[IntentSmith:fetchExpertises] ERROR:',err);});
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
  fetch(_backendUrl()+'/api/projects?limit=50&status='+projStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
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
  fetch(_backendUrl()+'/api/conversations?limit=50&status='+convStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.conversations||[]);
    if(items.length>0){CONVERSATIONS=items.slice(0,20).map(function(c){return{id:c.id,projectId:c.project_id||null,title:_s(c.title||c.name)||'Chat',preview:_s(c.preview||c.lastMessage||c.summary)||'',time:_s(c.time||c.updated_at||c.updatedAt)||'',created_at:_s(c.created_at||c.createdAt)||'',updated_at:_s(c.updated_at||c.updatedAt||c.time)||'',expertise:_s(c.expertise)||'Výchozí',status:_s(c.state||c.status)||'active'};});}
    else{CONVERSATIONS=[];}
    NAV[0].badge=CONVERSATIONS.length;NAV[0].recent=CONVERSATIONS.slice(0,3).map(function(c){return c.title;});renderCenter();
  }).catch(function(){});
  /* Expertises — separate specialists (is_specialist or is_builtin+tools) */
  _fetchExpertises();
  /* Workers (agents) */
  if(!_agentsForbidden){fetch(_backendUrl()+'/api/agents?all=true',{signal:AbortSignal.timeout(3000)}).then(function(r){if(r.status===403){_agentsForbidden=true;return{agents:[]};}if(!r.ok)return{agents:[]};return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.agents||[]);
    if(items.length>0){WORKERS=items.map(function(a){
      var sched=a.definition&&a.definition.schedule?a.definition.schedule:null;
      var cronStr=sched?(sched.type==='cron'?_s(sched.value):_s(sched.value||sched.type)):_s(a.schedule||a.cron)||'';
      var binding=a.definition&&a.definition.m3_extension;
      var native=!!(binding&&binding.contract==='M3AgentExtensionBinding'&&binding.version===1);
      return{id:a.id,name:_s(a.name),native:native,enabled:a.enabled===true,status:native?(a.enabled===true?'Plánování povoleno':'Pozastaveno'):'Legacy — pouze čtení',
        cron:cronStr,lastRun:_s(a.lastRun)||'',desc:_s(a.description||a.desc)||''};
    });}else{WORKERS=[];}
    NAV[4].badge=WORKERS.length;NAV[4].recent=WORKERS.slice(0,3).map(function(w){return w.name;});renderCenter();
  }).catch(function(){});}
  /* v132: Media badge — show active generation count */
  fetch(_backendUrl()+'/api/media/history?limit=1',{signal:AbortSignal.timeout(3000)})
    .then(function(r){return r.json();})
    .then(function(d){NAV[6].badge=_media.progress.size||(d.generations&&d.generations.length>0?'●':0);renderCenter();})
    .catch(function(){});
}
setTimeout(fetchBackendData,1500);
/* Refetch every 30s + health monitor */
setInterval(function(){
  fetch(_backendUrl()+'/api/health',{signal:AbortSignal.timeout(2000)})
  .then(function(r){if(!r.ok)throw new Error('Health HTTP '+r.status);return r.json();})
  .then(function(d){
    if(_modelsDisconnected){if(window.IntentSmithWS&&!window.IntentSmithWS.isReady())window.IntentSmithWS.reconnect();_modelsDisconnected=false;_refreshModelWorkspace();}
    _serverHealth.status=d.status||'ok';
    _serverHealth.lastCheck=Date.now();
    _serverHealth.wsConnected=(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.isReady())||false;
    if(d.version)_serverHealth.version=d.version;
    if(d.limits){_serverHealth.limits=d.limits;_MAX_TEXT_SIZE=d.limits.maxTextAttachment||_MAX_TEXT_SIZE;_MAX_IMG_SIZE=d.limits.maxImageAttachment||_MAX_IMG_SIZE;_MAX_DOC_SIZE=d.limits.maxDocumentAttachment||_MAX_DOC_SIZE;}
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
var INTENTSMITH_SIDEBAR_ID='intentsmith-sidebar';

class IntentSmithSidebarWidget extends react_widget_1.ReactWidget {
  constructor(){
    super();this.id=INTENTSMITH_SIDEBAR_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.outline='none';
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
        _centerContainer.id='intentsmith-center-mount';
        _centerContainer.style.cssText='position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;';
        main.style.position='relative';
        main.appendChild(_centerContainer);
        _syncFocusClass();
        renderCenter();
        console.log('[IntentSmith] Center view mounted into main panel');
      }
      /* Hide activity bars via JS (CSS can't override Theia's inline widths on SplitPanel children) */
      document.querySelectorAll('.theia-app-sidebar-container').forEach(function(el){
        el.style.cssText='display:none!important;width:0!important;min-width:0!important;max-width:0!important;overflow:hidden!important;flex:0 0 0!important;padding:0!important;';
        /* The parent SplitPanel child contains the complete navigation/chat
           panel. Its initial width can be below 60px before layout settles;
           preserve its Lumino geometry and hide only this activity bar. */
      });
      /* Also hide the TabBar elements */
      document.querySelectorAll('.theia-app-sides').forEach(function(el){
        el.style.cssText='display:none!important;width:0!important;';
      });
      /* ── Hide sidepanel toolbars (the 35px strips) ────────────
         Target: .theia-sidepanel-toolbar (exact class from DOM inspector)
         Strategy: inject <style> for CSS priority + setProperty to
         preserve Lumino's layout styles while hiding the element. */
      if(!document.getElementById('intentsmith-strip-hide')){
        var ss=document.createElement('style');ss.id='intentsmith-strip-hide';
        ss.textContent='.theia-sidepanel-toolbar{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;visibility:hidden!important;opacity:0!important;}.theia-sidepanel-toolbar~*{top:0!important;height:100%!important;}.lm-TabBar-toolbar{display:none!important;height:0!important;overflow:hidden!important;}#theia-right-side-panel .lm-TabBar~*,#theia-bottom-content-panel .lm-TabBar~*{top:0!important;height:100%!important;}#theia-right-side-panel .lm-DockPanel-widget,#theia-bottom-content-panel .lm-DockPanel-widget{top:0!important;height:100%!important;}.lm-Widget:focus,.lm-Widget:focus-visible,#intentsmith-sidebar:focus,#intentsmith-chat-panel:focus,#intentsmith-agent-panel:focus{outline:none!important;box-shadow:none!important;}button:focus-visible,input:focus-visible,textarea:focus-visible,[role=tab]:focus-visible{outline:2px solid var(--intentsmith-accent,#d4a85f)!important;outline-offset:-2px;}#theia-top-panel,.p-MenuBar,#theia\\:menubar,.theia-app-header{background:var(--intentsmith-bg1,#0f0f12)!important;border-color:var(--intentsmith-border,rgba(231,194,122,0.10))!important;}#theia-left-side-panel,#theia-right-side-panel,#theia-bottom-content-panel{background:var(--intentsmith-bg1,#0f0f12)!important;}input[type=range]{-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:var(--intentsmith-bg4,#2a292f);outline:none;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--intentsmith-accent,#d4a85f);cursor:pointer;border:2px solid var(--intentsmith-bg1,#0f0f12);}body{border:1px solid var(--intentsmith-border2,rgba(231,194,122,0.18))!important;box-sizing:border-box!important;}#theia-right-side-panel{border-left:1px solid var(--intentsmith-border2,rgba(231,194,122,0.18))!important;}#theia-bottom-content-panel{border-top:1px solid var(--intentsmith-border2,rgba(231,194,122,0.18))!important;}@keyframes intentsmith-ac-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}@keyframes intentsmith-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}@keyframes intentsmith-thinking-dot{0%,80%,100%{opacity:0.2;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}.lm-TabBar-tabCloseIcon,.lm-TabBar-tabCloseIcon::before,.p-TabBar-tabCloseIcon,.p-TabBar-tabCloseIcon::before{font-family:"codicon"!important;}';
        document.head.appendChild(ss);
      }
      /* v92: Focus Mode CSS — layout override when specialist is active */
      if(!document.getElementById('intentsmith-focus-css')){
        var fc=document.createElement('style');fc.id='intentsmith-focus-css';
        fc.textContent='';
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
    this._root.render(h(SidebarApp,{getState:function(){return{active:self._active,dd:self._dd,collapsed:self._collapsed};},setState:function(s){if(s.active!==undefined)self._active=s.active;if(s.dd!==undefined)self._dd=s.dd;if(s.collapsed!==undefined){self._collapsed=s.collapsed;try{var app=window._intentsmithApp;if(app&&app.shell&&typeof app.shell.resize==='function'){_intentsmithSnapLock=true;app.shell.resize(s.collapsed?48:240,'left');setTimeout(function(){_intentsmithSnapLock=false;},600);}}catch(ex){}}self._render();}}));
  }
}
inversify_1.decorate(inversify_1.injectable(),IntentSmithSidebarWidget);
var _sidebarWidget=null;function renderSidebar(){if(_sidebarWidget)_sidebarWidget._render();}

function SidebarApp(props){
  var s=props.getState(),set=props.setState;
  /* ── Collapsed icon-only mode (also forced in specialist focus mode) ── */
  if(s.collapsed){
    return h('div',{style:{display:'flex',flexDirection:'column',width:48,maxWidth:48,position:'absolute',top:0,left:0,bottom:0,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden',alignItems:'center',paddingTop:6}},
      h('div',{style:{cursor:'pointer',width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,color:C.tx3,marginBottom:2},title:'Rozbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:function(){set({collapsed:false});}},svgEl('<polyline points="9 18 15 12 9 6"/>',18)),
      h('div',{style:{width:24,height:1,background:C.border,marginBottom:6}}),
      NAV.map(function(item){
        var isA=s.active===item.id;
        return h('div',{key:item.id,title:item.label,style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',boxShadow:isA?'inset 2px 0 0 '+C.accent:'none',marginBottom:2,transition:'background 0.12s,color 0.12s'},
          onMouseEnter:function(e){if(!isA)e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background=isA?C.accentBg:'transparent';},
          onClick:function(){_wizardGuardNav(item.id,set);}},
          h('span',{style:{display:'flex'},dangerouslySetInnerHTML:{__html:svg(I[item.icon],18)}}));
      }),
      h('div',{style:{flex:1}}),
      h('div',{title:'Nastavení',style:{width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',boxShadow:s.active==='settings'?'inset 2px 0 0 '+C.accent:'none',marginBottom:4,transition:'background 0.12s, color 0.12s'},
        onMouseEnter:function(e){if(s.active!=='settings'){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
        onMouseLeave:function(e){e.currentTarget.style.background=s.active==='settings'?C.accentBg:'transparent';e.currentTarget.style.color=s.active==='settings'?C.accentText:C.tx3;},
        onClick:function(){_wizardGuardNav('settings',set);}},
        svgEl(I.settings,18)));
  }
  /* ── Full expanded mode ── */
  var _curS=_sessions[_sessionActive];
  var _showWT=_wtRoot&&_curS&&_curS._projectId;
  return h('div',{style:{display:'flex',flexDirection:'column',position:'absolute',top:0,left:0,right:0,bottom:0,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden'}},
    /* Header with IntentSmith + collapse */
    h('div',{style:{display:'flex',alignItems:'center',padding:'8px 10px 7px',flexShrink:0,borderBottom:'1px solid '+C.border}},
      h('img',{src:'../../resources/intentsmith-icon.png',alt:'',style:{width:28,height:28,objectFit:'contain',flexShrink:0}}),
      h('span',{style:{fontSize:_fs(11.5),fontWeight:750,color:C.tx1,letterSpacing:'0.2px',marginLeft:7,flex:1}},'IntentSmith'),
      h('div',{style:{cursor:'pointer',padding:4,borderRadius:4,color:C.tx4},title:'Sbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.color=C.tx2;},onMouseLeave:function(e){e.currentTarget.style.color=C.tx4;},
        onClick:function(){set({collapsed:true});}},svgEl('<polyline points="15 18 9 12 15 6"/>',14))),
    /* Nav */
    h('div',{style:{flex:1,overflowY:'auto',padding:'8px 8px 2px'}},
      NAV.map(function(item){
        var isA=s.active===item.id,isO=s.dd[item.id],els=[];
        els.push(h('div',{key:item.id,style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:isA?C.accentText:C.tx3,background:isA?C.accentBg:'transparent',boxShadow:isA?'inset 2px 0 0 '+C.accent:'none',marginBottom:2,transition:'background 0.12s,color 0.12s'},
          onMouseEnter:function(e){if(!isA){e.currentTarget.style.background=C.bg3;e.currentTarget.style.color=C.tx2;}},
          onMouseLeave:function(e){e.currentTarget.style.background=isA?C.accentBg:'transparent';e.currentTarget.style.color=isA?C.accentText:C.tx3;},
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
            onDoubleClick:function(){if(!f.d&&_wtRoot){document.dispatchEvent(new CustomEvent('intentsmith-file-open',{detail:{path:fullPath}}));}},
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
      h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,cursor:'pointer',color:s.active==='settings'?C.accentText:C.tx3,background:s.active==='settings'?C.accentBg:'transparent',boxShadow:s.active==='settings'?'inset 2px 0 0 '+C.accent:'none',transition:'background 0.12s, color 0.12s'},
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
try{var _dw=localStorage.getItem('intentsmith-detail-width');if(_dw){var _parsed=parseInt(_dw,10);if(_parsed>=200&&_parsed<=900)_detailWidth=_parsed;}}catch(e){}
var _detailDragging=false;
function _startDetailDrag(e){
  e.preventDefault();_detailDragging=true;
  var startX=e.clientX,startW=_detailWidth;
  var container=document.getElementById('intentsmith-center-mount');
  var maxW=container?Math.round(container.offsetWidth*0.7):700;
  function onMove(ev){
    var delta=startX-ev.clientX; /* drag left = wider detail */
    var newW=Math.max(200,Math.min(maxW,startW+delta));
    _detailWidth=newW;renderCenter();
  }
  function onUp(){
    _detailDragging=false;document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
    document.body.style.cursor='';document.body.style.userSelect='';
    try{localStorage.setItem('intentsmith-detail-width',String(_detailWidth));}catch(e){}
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
  var wizard=_projectWizard.active||_expertiseWizard.active||_agentWizard.active||_specialistWizard.active;
  if(wizard&&!confirm('Ukončit rozpracovaný formulář? Neuložené změny budou ztraceny.'))return;
  _projectWizard.active=false;_expertiseWizard.active=false;_agentWizard.active=false;_specialistWizard.active=false;
  var target=targetView===_centerState.view?null:targetView;
  sidebarSet({active:target,dd:{}});
  window.dispatchEvent(new CustomEvent('intentsmith-nav',{detail:Object.assign({},extra||{},{view:target})}));
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
function renderCenter(){_snapshotWorkspaceDrafts();_syncWorkspacePanels();if(!_centerContainer)return;if(!_centerRoot)_centerRoot=_createRoot(_centerContainer);_centerRoot.render(h(CenterApp,null));}

function CenterApp(){
  if(_workspaceShown())return WorkspaceApp();
  var view=_centerState.view,detail=_centerState.detail;
  var isOverlay=_expertiseWizard.active||_agentWizard.active||_projectWizard.active||_specialistWizard.active;
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

function _mpNavBtn(tab){return h('button',{style:{background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'4px 10px',fontSize:_fs(11),fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:10,color:C.tx2,fontFamily:C.font},onClick:function(){_mpTab=tab;_mpData=null;window.dispatchEvent(new CustomEvent('intentsmith-nav',{detail:{view:'marketplace'}}));}},svgEl(I.store,12),'Marketplace');}
function viewHead(t,showZoom,onAdd,extraBtn){
  return h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
    h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},t),
    extraBtn||null,
    onAdd?h('button',{style:{background:C.accent,color:C.onAccent,border:'none',borderRadius:6,padding:'4px 10px',fontSize:_fs(11),fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:4,marginRight:10},onClick:onAdd},svgEl(I.plus,12),'Nový'):null,
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

function _favClick(item){return function(ev){ev.stopPropagation();item.fav=!item.fav;if(item.id){fetch(_backendUrl()+'/api/expertises/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:item.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderCenter();};}

function card(item,onClick){
  var sel=_centerState.detail&&_centerState.detail.name===item.name;
  var isLines=_settingsVals.visualMode==='lines';
  var ell={whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
  var bm=_centerState._bulkMode;
  var _iid=item._itemId||item.id;
  var bSel=bm&&_iid&&_centerState._bulkSelected.indexOf(_iid)>=0;
  /* Bulk checkbox element */
  var chkBox=bm?h('div',{style:{width:18,height:18,borderRadius:4,border:'2px solid '+(bSel?C.accent:C.tx4),background:bSel?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}},
    bSel?h('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:C.onAccent,strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('polyline',{points:'20 6 9 17 4 12'})):null):null;
  /* ═══ LIST VIEW ═══ */
  if(_centerState.listView){
    var listS={display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'all 0.15s',position:'relative'};
    if(bSel){listS.background=_rgba(C.accent,0.15);listS.borderLeft=isLines?'4px solid '+C.accent:undefined;if(!isLines){listS.border='2px solid '+C.accent;listS.borderRadius=8;listS.marginBottom=4;listS.boxShadow='0 0 0 1px '+C.accent;}}
    else if(isLines){listS.borderBottom='1px solid '+C.border;listS.background=sel?_rgba(C.accent,0.07):'transparent';}
    else{listS.background=sel?_rgba(C.accent,0.09):C.bg2;listS.border='1px solid '+(sel?C.accent:C.border);listS.borderRadius=8;listS.marginBottom=4;}
    return h('div',{key:item.name,onClick:onClick,style:listS,
      onMouseEnter:function(e){if(!sel&&!bSel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':'rgba(255,255,255,0.04)';},
      onMouseLeave:function(e){if(!sel&&!bSel)e.currentTarget.style.background=bSel?_rgba(C.accent,0.15):isLines?'transparent':(sel?_rgba(C.accent,0.09):C.bg2);}},
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
    var linesBg=bSel?_rgba(C.accent,0.15):sel?_rgba(C.accent,0.07):'transparent';
    return h('div',{key:item.name,onClick:onClick,
      style:{padding:14,cursor:'pointer',borderBottom:'1px solid '+C.border,borderRight:'1px solid '+C.border,
        background:linesBg,transition:'background 0.15s',position:'relative'},
      onMouseEnter:function(e){if(!sel&&!bSel)e.currentTarget.style.background='rgba(255,255,255,0.025)';},
      onMouseLeave:function(e){e.currentTarget.style.background=linesBg;}},
      bSel?h('div',{style:{position:'absolute',left:0,top:0,bottom:0,width:4,background:C.accent}}):null,
      body);
  }
  /* ═══ GRID — borders mode (card with bg, border, radius) ═══ */
  var cardBg=bSel?_rgba(C.accent,0.10):C.bg2;
  var cardBorder=bSel?'2px solid '+C.accent:'1px solid '+(sel?C.accent:C.border);
  var cardShadow=bSel?'0 0 0 2px '+_rgba(C.accent,0.30):sel?'0 0 0 1px '+C.accent:'none';
  return h('div',{key:item.name,className:'intentsmith-card',onClick:onClick,
    style:{background:cardBg,border:cardBorder,borderRadius:12,padding:16,
      cursor:'pointer',position:'relative',overflow:'hidden',
      transition:'border-color 0.2s,box-shadow 0.2s,background 0.2s',
      boxShadow:cardShadow},
    onMouseEnter:function(e){if(!sel&&!bSel){e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';}},
    onMouseLeave:function(e){if(!sel&&!bSel){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';}}},
    body);
}

function pill(s){var st=_s(s);var m={Active:{b:C.successBg,c:C.success},Done:{b:C.blueBg,c:C.blue},WIP:{b:C.amberBg,c:C.amber},Running:{b:C.successBg,c:C.success},Paused:{b:C.amberBg,c:C.amber},Deleted:{b:C.redBg,c:C.red},Archived:{b:C.bg4,c:C.tx3}};var v=m[st]||{b:C.bg4,c:C.tx3};return h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:_fs(9),fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',fontFamily:C.mono,background:v.b,color:v.c}},st);}

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
      fetch(_backendUrl()+'/api/projects/'+proj.id+'/conversations?limit=3',{signal:AbortSignal.timeout(5000)})
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
      fetch(_backendUrl()+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nová konverzace',expertise:'Výchozí'}),signal:AbortSignal.timeout(5000)})
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
    {
      /* The backend owns the effective default; refresh it on every creation. */
      fetch(_backendUrl()+'/api/projects/defaults',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(j){
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
      if(action==='archive')return fetch(_backendUrl()+ep+id+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)});
      if(action==='delete')return fetch(_backendUrl()+ep+id,{method:'DELETE',signal:AbortSignal.timeout(3000)});
      if(action==='restore')return fetch(_backendUrl()+ep+id+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)});
      return Promise.resolve();
    });
    Promise.all(promises).then(function(){_centerState._bulkMode=false;_centerState._bulkSelected=[];_centerState.detail=null;fetchBackendData();renderCenter();}).catch(function(){fetchBackendData();renderCenter();});
  }
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',
    background:bm?C.accent:'transparent',color:bm?C.onAccent:C.tx4,transition:'background 0.15s'};
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
      var chain=spec?fetch(_backendUrl()+'/api/specialists/'+id+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).catch(function(){}):Promise.resolve();
      return chain.then(function(){return fetch(_backendUrl()+ep+id,{method:'DELETE',signal:AbortSignal.timeout(3000)});});
    });
    Promise.all(promises).then(function(){_centerState._bulkMode=false;_centerState._bulkSelected=[];_centerState.detail=null;_fetchExpertises();renderCenter();}).catch(function(){_fetchExpertises();renderCenter();});
  }
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer',
    background:bm?C.accent:'transparent',color:bm?C.onAccent:C.tx4,transition:'background 0.15s'};
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
  if(_contaminated.length>0&&typeof console!=='undefined'){console.warn('[IntentSmith:centerProjects] CONTAMINATION:',_contaminated.length,'non-project items in PROJECTS!',_contaminated.map(function(p){return p.name+'('+p.emoji+')';}));}
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

function _workerDetail(w){return {name:w.name,_itemId:w.id,fields:[{k:'Status',v:w.status},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:w.native?['Spustit',w.enabled?'Pozastavit':'Povolit']:[]};}
function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',false,null,_mpNavBtn('skills')),h('div',{style:{flex:1,overflowY:'auto',padding:18}},h('p',null,'Ovládání je dostupné pro nainstalované M3 agenty. Legacy záznamy jsou pouze ke čtení. Pozastavení zakáže další plánované běhy; právě běžící úlohu neruší.'),grid(WORKERS.map(function(w){return card({name:w.name,emoji:'⚙️',desc:w.desc,status:w.status},function(){setDetail(_workerDetail(w));});}))));}

/* ═══ PROJECT CREATION WIZARD ═══ */
function _openRegisteredProject(idx,proj){
  var s=_sessions[idx];if(!s||!proj||!proj.id)return Promise.resolve();
  if(s.chat._m2Busy||(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn(s))){s.chat.msgs.push({role:'system',tag:'ERROR',text:'Nejdřív dokonči nebo zruš probíhající požadavek.'});renderChat();return Promise.resolve();}
  _chatInvalidatePreparedSends(s.chat);
  _showWorkspace();
  var token={};s._openToken=token;s._history=null;s._projectId=proj.id;s._label=proj.name||'Projekt';
  s._convId=null;s._agentId=null;s._lifecycleResumed=false;s._m2Pending=null;s._m2PresentedPlan=null;
  s.chat._projectWorkProposal=null;s.chat._m2Composer=null;s.chat._m2ComposerOpen=false;
  s.chat.msgs=[{role:'system',text:'Načítám projekt: '+proj.name}];s.chat.ctx=0;s._conversationFocus=false;
  s.log=[];s.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
  if(proj.path)_loadWorkspaceTree(proj.path,idx);
  _syncFocusClass();_persistSessionState();renderChat();
  function current(){return _sessions[idx]===s&&s._openToken===token&&s._projectId===proj.id;}
  function read(url,options){return fetch(_backendUrl()+url,Object.assign({signal:AbortSignal.timeout(5000)},options||{})).then(function(r){return r.json().then(function(body){if(!r.ok)throw new Error(body.error||'Načtení selhalo ('+r.status+').');return body;});});}
  return read('/api/projects/'+proj.id+'/conversations?limit=1').then(function(data){
    if(!current())return null;
    var conversations=data.conversations||[];if(conversations.length)return conversations[0];
    return read('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:proj.id,title:proj.name})}).then(function(body){return body.conversation||body;});
  }).then(function(conv){
    if(!current())return;
    if(!conv||typeof conv.id!=='string'||!conv.id)throw new Error('Server nepotvrdil uloženou konverzaci.');
    if(conv.project_id!==undefined&&Number(conv.project_id)!==Number(proj.id))throw new Error('Konverzace patří jinému projektu.');
    return read('/api/conversations/'+encodeURIComponent(conv.id)+'/messages').then(function(body){
      if(!current())return;
      var items=Array.isArray(body)?body:body.messages;if(!Array.isArray(items))throw new Error('Server nevrátil platnou historii.');
      s._convId=conv.id;s.chat.msgs=[{role:'system',text:'Projekt: '+proj.name}];
      items.forEach(function(m){var meta={};try{meta=m.metadata?JSON.parse(m.metadata):{};}catch(e){}s.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:meta.mode});});
      if(!items.length)s.chat.msgs.push({role:'assistant',tag:'PROJECT',text:'Projekt je připojený. Popiš zamýšlený cíl a čím chceš pokračovat. Můžu nejprve projít skutečné soubory, shrnout silné stránky, nedostatky a navrhnout priority. Samotné otevření soubory nemění.'});
      _persistSessionState();renderChat();requestAnimationFrame(function(){_chatScrollPane(idx);});
    });
  }).catch(function(error){if(!current())return;s._convId=null;s.chat.msgs.push({role:'system',tag:'ERROR',text:'Konverzaci projektu se nepodařilo otevřít: '+error.message+' Otevři projekt znovu.'});_persistSessionState();renderChat();});
}

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
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Dialog selhal: '+(e.message||e));
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
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Nelze určit absolutní cestu. Použijte: /open <absolutní_cesta>');
    });
    inp.click();
  }catch(e){
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Nelze otevřít dialog: '+(e.message||e));
  }
}
function _doOpenExistingProject(folderPath){
  if(!folderPath||!folderPath.trim()){if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ _doOpenExistingProject: prázdná cesta');return;}
  folderPath=folderPath.trim();
  if(window._intentsmith)window._intentsmith.agentLog('TOOL','📂 Otevírám složku: '+folderPath+' (délka: '+folderPath.length+', první znak: '+JSON.stringify(folderPath.charAt(0))+')');
  /* v90: Smart route to relay — open-folder always routes to free/new relay */
  _projectWizard.saving=true;renderCenter();
  _smartRouteToRelay(function(_ti){
    fetch(_backendUrl()+'/api/projects/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({folderPath:folderPath}),signal:AbortSignal.timeout(30000)})
    .then(function(r){if(!r.ok)return r.json().then(function(e){throw new Error((e.error||'Server error '+r.status)+(e.details?' ['+e.details+']':''));});return r.json();})
    .then(function(res){
      var proj=res.project;
      if(!proj||!Number.isSafeInteger(proj.id)||!proj.path)throw new Error('Server nepotvrdil načtený projekt.');
      _projectWizard.active=false;_projectWizard.saving=false;_wizardRestoreLayout();_showWorkspace();
      var realPath=(proj&&proj.path)||folderPath;
      var projName=(proj&&proj.name)||folderPath.split('/').filter(Boolean).pop()||'Projekt';
      var _welcomeMsg=res.welcomeMessage||null;
      /* Open working tree */
      _loadWorkspaceTree(realPath,_ti);
      /* Link to routed session */
      var _ts=_sessions[_ti];
      if(proj&&proj.id){
        _ts._projectId=proj.id;_ts._label=projName;
        _ts._conversationFocus=false; /* v122.3 */
        /* Reset session for new project context */
        _ts._convId=null;_ts._agentId=null;_ts._lifecycleResumed=false;_ts._m2Pending=null;
        _ts.chat._projectWorkProposal=null;_ts.chat._m2Composer=null;_ts.chat._m2ComposerOpen=false;
        _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
        _ts.chat.ctx=0;
        /* Create conversation for the project. M2 lifecycle starts only via explicit /m2-plan. */
        fetch(_backendUrl()+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project_id:proj.id,title:projName,welcomeMessage:_welcomeMsg}),signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json().then(function(cd){if(!r.ok)throw new Error(cd.error||'Konverzaci se nepodařilo uložit.');return cd;});}).then(function(cd){
          var conv=cd.conversation||cd;
          if(!conv||!conv.id)throw new Error('Server nepotvrdil uloženou konverzaci.');
          if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
          if(_welcomeMsg){_ts.chat.msgs.push({role:'assistant',text:_welcomeMsg,tag:'PROJECT'});renderChat();_chatScrollPane(_ti);}
        }).catch(function(err){_ts.chat.msgs.push({role:'system',tag:'ERROR',text:'Projekt je uložený, ale konverzace se neotevřela: '+err.message+' Otevři projekt znovu.'});_persistSessionState();renderChat();});
        _persistSessionState();
      }
      if(window._intentsmith){
        window._intentsmith.agentLog('TOOL','📂 Projekt otevřen: '+projName);
        window._intentsmith.agentLog('TOOL','📍 '+realPath);
        if(res.metadata&&res.metadata.bootstrapped)window._intentsmith.agentLog('TOOL','🔧 Metadata bootstrapped (.intentsmith-architect)');
        if(res.status==='already_registered')window._intentsmith.agentLog('TOOL','ℹ️ Projekt byl již registrován');
      }
      _showWorkspace();
      fetchBackendData();renderCenter();renderChat();
    }).catch(function(err){
      _projectWizard.saving=false;_projectWizard.error=err.message||String(err);
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Chyba při otevírání: '+(err.message||err));
      if(!_projectWizard.active){_sessions[_sessionActive].chat.msgs.push({role:'system',tag:'ERROR',text:'Projekt se nepodařilo otevřít: '+_projectWizard.error});renderChat();}
      fetchBackendData();renderCenter();
    });
  });
}
function _wizardSubmit(){
  if(_projectWizard.saving)return;
  _projectWizard.saving=true;_projectWizard.error=null;renderCenter();
  var d=_projectWizard.data;
  var sendPath=d.pathMode==='custom'?d.path.trim():'';
  return fetch(_backendUrl()+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:d.name.trim(),path:sendPath||null,description:d.description.trim(),type:d.type,autoPath:!sendPath}),signal:AbortSignal.timeout(30000)})
  .then(function(r){return r.json().then(function(value){
    if(!r.ok)throw new Error(value.error||'Vytvoření projektu selhalo (HTTP '+r.status+').');
    if(!Number.isSafeInteger(value.id)||!value.project||value.project.id!==value.id||typeof value.path!=='string')throw new Error('Server nepotvrdil uložený projekt. Ověř seznam projektů před opakováním.');
    return value;
  });})
  .then(function(created){
    _projectWizard.active=false;_projectWizard.saving=false;_wizardRestoreLayout();_showWorkspace();
    var realPath=created.path||sendPath;
    var projName=d.name.trim();
    var _welcomeMsg=created.welcomeMessage||null; /* v89: save welcome from BE */
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','✨ Projekt vytvořen: '+projName+' → '+realPath);
    /* v90: Smart route to relay */
    _smartRouteToRelay(function(_ti){
      var _ts=_sessions[_ti];
      var projId=created.id||(created.project&&created.project.id);
      if(projId){_ts._projectId=projId;_ts._conversationFocus=false;_syncFocusClass();_persistSessionState();}
      _ts._label=projName;
      if(realPath)_loadWorkspaceTree(realPath,_ti);
      /* Reset session for new project */
      _ts._convId=null;_ts._agentId=null;_ts._lifecycleResumed=false;_ts._m2Pending=null;
      _ts.chat._projectWorkProposal=null;_ts.chat._m2Composer=null;_ts.chat._m2ComposerOpen=false;
      _ts.log=[];_ts.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
      _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
      /* Create conversation for the project. M2 lifecycle starts only via explicit /m2-plan. */
      if(projId){
        fetch(_backendUrl()+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({project_id:projId,title:projName,welcomeMessage:_welcomeMsg}),signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json().then(function(cd){if(!r.ok)throw new Error(cd.error||'Konverzaci se nepodařilo uložit.');return cd;});}).then(function(cd){
          var conv=cd.conversation||cd;
          if(!conv||!conv.id)throw new Error('Server nepotvrdil uloženou konverzaci.');
          if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
          if(_welcomeMsg){_ts.chat.msgs.push({role:'assistant',text:_welcomeMsg,tag:'PROJECT'});renderChat();_chatScrollPane(_ti);}
        }).catch(function(err){_ts.chat.msgs.push({role:'system',tag:'ERROR',text:'Projekt je uložený, ale konverzace se neotevřela: '+err.message+' Otevři projekt znovu.'});_persistSessionState();renderChat();});
      }
      var scaff=created.scaffold?created.scaffold.join(', '):'';
      if(window._intentsmith){
        window._intentsmith.agentLog('TOOL','📁 Projekt '+projName+' vytvořen ('+d.type+') → '+realPath);
        if(scaff)window._intentsmith.agentLog('TOOL','🔧 Scaffolding: '+scaff);
        window._intentsmith.agentLog('TOOL','Popište cíl v chatu. Navržený krok otevřete přes Připravit navržený krok; před zápisem se samostatně schvaluje konkrétní změna. Malou změnu zadáte: /m2-draft src/app.js :: popis změny');
      }
      fetchBackendData();renderCenter();renderChat();
    });
  }).catch(function(err){
    _projectWizard.saving=false;
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Chyba při vytváření projektu: '+(err.message||err));
    _projectWizard.error=err.message||String(err);renderCenter();
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
          h('div',{style:{fontSize:_fs(11),color:C.tx3,marginTop:4}},'Vybrat složku z disku'))),
      h('label',{style:{display:'block',marginTop:16}},'Nebo vlož úplnou cestu existujícího projektu',
        h('input',{id:'project-import-path',style:inputStyle,value:d.importPath||'',placeholder:'/home/user/projects/existing',onChange:function(e){d.importPath=e.target.value;renderCenter();}})),
      h('button',{id:'project-import-submit',disabled:w.saving||!(d.importPath||'').trim(),style:{marginTop:8,padding:8},onClick:function(){_doOpenExistingProject(d.importPath);}},w.saving?'Načítám…':'Načíst existující projekt'));

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
    var slug=d.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
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
    var slug2=d.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
    var displayPath=d.pathMode==='auto'?(_projectWizard.defaultDir+'/'+slug2):d.path;
    var scaffoldHint='Node.js 22, src/, public/, test/, scripts/, pravidla M2 a první Git commit';
    content=h('div',{style:stepStyle},
      h('div',{style:labelStyle},'Souhrn'),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10,marginTop:8}},
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Název'),h('span',{style:{color:C.tx1,fontWeight:600}},d.name)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Typ'),h('span',{style:{color:C.tx1}},pt.icon+' '+pt.label)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12),gap:8}},h('span',{style:{color:C.tx3,flexShrink:0}},'Cesta'),h('span',{style:{color:C.tx2,fontFamily:C.mono,fontSize:_fs(11),textAlign:'right',wordBreak:'break-all'}},displayPath)),
        h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:_fs(12)}},h('span',{style:{color:C.tx3}},'Scaffolding'),h('span',{style:{color:C.tx2,fontSize:_fs(10.5)}},scaffoldHint)),
        d.description?h('div',{style:{fontSize:_fs(11),color:C.tx2,marginTop:4,padding:8,background:C.bg3,borderRadius:6,whiteSpace:'pre-wrap'}},d.description):null),
      h('div',{style:{marginTop:16,padding:10,background:C.accentBg,borderRadius:8,border:'1px solid '+C.accent+'33'}},
        h('div',{style:{fontSize:_fs(11),color:C.accentText,fontWeight:600}},'Projekt pro řízenou práci'),
        h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:4}},'Vznikne základ Node.js bez dalších závislostí, s připravenými pravidly změn. Popište cíl v chatu; návrh otevřete přes Připravit navržený krok. Implementace a funkční test zatím chybí. Každou změnu schvalujete zvlášť.')));
  }
  if(w.error)content=h(React.Fragment,null,content,h('p',{role:'alert',style:{color:C.red||C.tx1,padding:12}},w.error));
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
      step>0&&step<5?h('button',{disabled:!_wizardCanNext(),style:{padding:'7px 20px',borderRadius:6,border:'none',background:_wizardCanNext()?C.accent:C.bg4,color:_wizardCanNext()?C.onAccent:C.tx4,fontFamily:C.font,fontSize:_fs(12),fontWeight:700,cursor:_wizardCanNext()?'pointer':'default',opacity:_wizardCanNext()?1:0.5},
        onClick:function(){if(_wizardCanNext()){w.step=step+1;renderCenter();}}},'Další'):null,
      step===5?h('button',{disabled:w.saving,style:{padding:'7px 24px',borderRadius:6,border:'none',background:w.saving?C.bg4:C.accent,color:w.saving?C.tx4:C.onAccent,fontFamily:C.font,fontSize:_fs(12),fontWeight:700,cursor:w.saving?'default':'pointer'},
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
  fetch(_backendUrl()+'/api/specialists',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:d.name.trim(),domain:d.domain,description:d.description.trim(),icon:d.icon||null}),
    signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json().then(function(j){return{ok:r.ok,data:j};});})
  .then(function(res){
    _specialistWizard.saving=false;
    if(!res.ok){_specialistWizard.error=res.data.error||'Chyba při vytváření';renderCenter();return;}
    _specialistWizard.active=false;_wizardRestoreLayout();
    _fetchExpertises();
    if(typeof intentsmith!=='undefined'&&intentsmith.agentLog)intentsmith.agentLog('TOOL','Specialista \u201E'+d.name.trim()+'\u201C vytvořen.');
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
      step<3?h('button',{disabled:!_swCanNext(),style:{padding:'7px 20px',borderRadius:6,border:'none',background:_swCanNext()?C.accent:C.bg4,color:_swCanNext()?C.onAccent:C.tx4,fontFamily:C.font,fontSize:_fs(12),fontWeight:700,cursor:_swCanNext()?'pointer':'default',opacity:_swCanNext()?1:0.5},
        onClick:function(){if(_swCanNext()){w.step=step+1;renderCenter();}}},'Další'):null,
      step===3?h('button',{disabled:w.saving,style:{padding:'7px 24px',borderRadius:6,border:'none',background:w.saving?C.bg4:C.accent,color:w.saving?C.tx4:C.onAccent,fontFamily:C.font,fontSize:_fs(12),fontWeight:700,cursor:w.saving?'default':'pointer'},
        onClick:_swSubmit},w.saving?'Vytvářím...':'Vytvořit specialistu'):null));
}

/* ═══ EXPERTISE CREATION/EDIT WIZARD (v64.1) ═══ */
var _ewDebounce=null;
function _ewPreview(){
  if(_ewDebounce)clearTimeout(_ewDebounce);
  _ewDebounce=setTimeout(function(){
    var d=_expertiseWizard.data;if(!d||!d.name)return;
    fetch(_backendUrl()+'/api/merge-preview',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expertises:[{id:'__wizard_'+Date.now(),name:d.name,modules:d.modules,capabilities:d.capabilities,systemPrompt:d.systemPrompt,temperature:d.temperature,tone:d.tone,weight:1.0,styleRules:d.styleRules}]}),
      signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();}).then(function(p){_expertiseWizard.preview=p;renderCenter();}).catch(function(){});
  },500);
}
function _ewTest(question){
  if(_expertiseWizard.testLoading)return;
  _expertiseWizard.testLoading=true;_expertiseWizard.testError=null;_expertiseWizard.testResult=null;renderCenter();
  fetch(_backendUrl()+'/api/expertise-wizard/test-prompt',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({expertiseConfig:_expertiseWizard.data,question:question}),signal:AbortSignal.timeout(60000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(res){_expertiseWizard.testResult=res;_expertiseWizard.testLoading=false;renderCenter();})
  .catch(function(err){_expertiseWizard.testError=err.message;_expertiseWizard.testLoading=false;renderCenter();});
}
function _ewSave(){
  if(_expertiseWizard.saving||!_expertiseWizard.data||!_expertiseWizard.data.name)return;
  _expertiseWizard.saving=true;renderCenter();
  var d=_expertiseWizard.data;var method=_expertiseWizard.editId?'PUT':'POST';
  var url=_expertiseWizard.editId?(_backendUrl()+'/api/expertises/'+_expertiseWizard.editId):(_backendUrl()+'/api/expertises');
  fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(d),signal:AbortSignal.timeout(5000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(){
    _expertiseWizard.saving=false;
    var _label=d.is_specialist?'Specialista':'Expertyza';
    if(window._intentsmith)window._intentsmith.agentLog('TOOL',_label+' '+(method==='PUT'?'upraven(a)':'vytvořen(a)')+': '+d.name);
    fetchBackendData();_ewClose();
  }).catch(function(err){
    _expertiseWizard.saving=false;_expertiseWizard.testError='Uložení selhalo: '+err.message;
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Chyba: '+err.message);renderCenter();
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
  fetch(_backendUrl()+'/api/expertise-schema',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(s){_expertiseWizard.schema=s;renderCenter();}).catch(function(){});
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
  fetch(_backendUrl()+'/api/agents/schema',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(s){_agentWizard.schema=s;renderCenter();}).catch(function(){});
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
  fetch(_backendUrl()+'/api/agents/dry-run',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({definition:d}),signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json();})
  .then(function(res){_agentWizard.preview=res;_agentWizard.testLoading=false;renderCenter();})
  .catch(function(err){_agentWizard.testError=err.message;_agentWizard.testLoading=false;renderCenter();});
}
function _awTestRun(){
  if(!_agentWizard.editId)return;
  _agentWizard.testLoading=true;_agentWizard.testError=null;_agentWizard.testResult=null;renderCenter();
  fetch(_backendUrl()+'/api/agents/'+_agentWizard.editId+'/run',{method:'POST',signal:AbortSignal.timeout(60000)})
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
  fetch(_backendUrl()+'/api/agents/dry-run',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({definition:d}),signal:AbortSignal.timeout(10000)})
  .then(function(r){return r.json();})
  .then(function(dryRes){
    if(dryRes.valid===false){
      _agentWizard.saving=false;_agentWizard.preview=dryRes;_agentWizard.testError='Validace selhala: '+(dryRes.errors||[]).join(', ');renderCenter();
      return;
    }
    /* Dry-run OK → save */
    var method=_agentWizard.editId?'PUT':'POST';
    var url=_agentWizard.editId?(_backendUrl()+'/api/agents/'+_agentWizard.editId):(_backendUrl()+'/api/agents');
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
      if(window._intentsmith)window._intentsmith.agentLog('TOOL',(method==='PUT'?'Agent upraven: ':'Agent vytvoren: ')+d.name);
      fetchBackendData();_awClose();
    }).catch(function(err){
      _agentWizard.saving=false;_agentWizard.testError='Ulozeni selhalo: '+err.message;
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','Chyba: '+err.message);renderCenter();
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
  var btnS2=function(primary,disabled){return{padding:'5px '+(primary?16:12)+'px',borderRadius:6,border:primary?'none':'1px solid '+C.border2,background:disabled?C.bg4:primary?C.accent:C.bg3,color:disabled?C.tx4:primary?C.onAccent:C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:primary?700:400,cursor:disabled?'default':'pointer'};};
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
          return h('span',{key:si,style:{fontSize:_fs(10),padding:'2px 8px',borderRadius:10,background:simpleStep===(si+1)?C.accent:C.bg3,color:simpleStep===(si+1)?C.onAccent:C.tx3}},sn);
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
  var btnS=function(primary,disabled){return{padding:'5px '+(primary?16:12)+'px',borderRadius:6,border:primary?'none':'1px solid '+C.border2,background:disabled?C.bg4:primary?C.accent:C.bg3,color:disabled?C.tx4:primary?C.onAccent:C.tx2,fontFamily:C.font,fontSize:_fs(11),fontWeight:primary?700:400,cursor:disabled?'default':'pointer'};};
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
          return h('button',{key:em,style:{width:32,height:32,borderRadius:6,border:'1px solid '+(d.icon===em?C.accent:C.border),background:d.icon===em?C.accentBg:C.bg3,fontSize:_fs(16),cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0},
            onClick:function(){d.icon=em;renderCenter();}},em);})),
        h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:4}},'Nebo zadejte vlastní emoji/Unicode znak (max 4 znaky)')),
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Doména'),h('input',{style:inputS,value:d.domain||'',placeholder:'nazev_domeny',
        onChange:function(e){d.domain=e.target.value;var det=_ewDetectDomain(d.name||'',d.domain);_ewApplyPreset(det);}})),
      /* Preset picker chips */
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Nebo vyberte šablonu:'),
        h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
          Object.keys(_DOMAIN_PRESETS).map(function(key){
            var p=_DOMAIN_PRESETS[key];var isSel=detectedPreset===key;
            return h('button',{key:key,style:{padding:'4px 12px',borderRadius:16,border:'1px solid '+(isSel?C.accent:C.border),background:isSel?C.accentBg:C.bg3,color:isSel?C.accentText:C.tx3,fontSize:_fs(10),fontWeight:isSel?700:400,cursor:'pointer'},
              onClick:function(){d.domain=key;_ewApplyPreset(key);}},p.label);}))),
      h('div',{style:{marginBottom:10}},h('div',{style:labelS},'Popis'),h('textarea',{style:Object.assign({},taS,{minHeight:36,fontFamily:C.font}),value:d.description||'',placeholder:'Stručný popis co expertyza umí...',onChange:function(e){d.description=e.target.value;renderCenter();}})));
    /* Step 2: Tuning + Test */
    var step2=h('div',{style:{maxWidth:560,margin:'0 auto',width:'100%'}},
      /* Auto-detected summary */
      presetInfo?h('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:12,padding:'8px 14px',background:C.accentBg,borderRadius:8,border:'1px solid '+C.border}},
        h('span',{style:{fontSize:_fs(16)}},d.icon||'🤖'),
        h('span',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1}},d.name||''),
        h('span',{style:{fontSize:_fs(10),fontWeight:700,color:C.accentText,padding:'2px 8px',borderRadius:10,background:_rgba(C.accent,0.15)}},presetInfo.label||detectedPreset)):null,
      /* Key tuning sliders */
      h('div',{style:{marginBottom:14}},h('div',{style:labelS},'Ladění (IntentSmith nastavil výchozí hodnoty)'),
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
          h('button',{disabled:w.testLoading||!d.name,style:{background:(w.testLoading||!d.name)?C.bg4:C.accent,color:(w.testLoading||!d.name)?C.tx4:C.onAccent,border:'none',borderRadius:6,padding:'5px 14px',fontSize:_fs(11),fontWeight:700,cursor:(w.testLoading||!d.name)?'default':'pointer',flexShrink:0},
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
          h('button',{style:{background:C.accent,color:C.onAccent,border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(11),fontWeight:700,cursor:'pointer'},onClick:function(){_ewAddModItem(s);}},'+')
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
          background:pr.compatibility==='ok'?C.successBg:pr.compatibility==='warning'?C.amberBg:pr.compatibility==='soft_block'?'rgba(249,115,22,0.15)':C.redBg,
          color:pr.compatibility==='ok'?C.success:pr.compatibility==='warning'?C.amber:pr.compatibility==='soft_block'?'#f97316':C.red}},
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
        h('button',{disabled:w.testLoading,style:{background:w.testLoading?C.bg4:C.accent,color:w.testLoading?C.tx4:C.onAccent,border:'none',borderRadius:6,padding:'5px 14px',fontSize:_fs(11),fontWeight:700,cursor:w.testLoading?'default':'pointer',flexShrink:0},
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
/* v87.3: Backend config state — loaded from /api/settings */
var _bCfg=null;var _bCfgLoading=false;var _gpuInfo=null;var _ollamaModels=null;var _sysInfo=null;var _storageInfo=null;var _bCfgSaveTimer=null;
var _upgradeData=null;var _upgradeLoading=false;var _upgradeMsg=null;
var _evaluationData=null;var _evaluationLoading=false;var _upgradeTab='overview';
var _modelTestPending=false;var _modelTestMessage=null;var _evaluationModelFilter='';
var _modelTestTarget=null;var _modelTestFailed=false;
function _modelButtonStyle(primary,disabled){
  return {padding:'5px 12px',minHeight:28,borderRadius:6,border:'1px solid '+(primary&&!disabled?C.accent:C.border2),
    background:disabled?C.bg4:primary?C.accent:C.bg3,color:disabled?C.tx4:primary?C.onAccent:C.tx2,
    fontFamily:C.font,fontSize:_fs(11),fontWeight:primary?600:400,cursor:disabled?'default':'pointer',
    display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,whiteSpace:'nowrap',opacity:disabled?0.65:1};
}
function _modelFieldStyle(){
  return {background:C.bg3,color:C.tx1,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 10px',
    boxSizing:'border-box',height:30,fontFamily:C.font,fontSize:_fs(11),colorScheme:_settingsVals.theme==='light'?'light':'dark'};
}
function _modelTestFeedback(model,role){
  if(!_modelTestTarget||_modelTestTarget.role!==role||_canonicalModelIdentity(_modelTestTarget.model)!==_canonicalModelIdentity(model))return null;
  var text=_modelTestPending?'Ověřuji model a spouštím test…':_modelTestMessage;
  if(!text)return null;
  return h('div',{'data-testid':'model-test-feedback',role:_modelTestFailed?'alert':'status',
    style:{marginTop:8,padding:'8px 10px',maxWidth:480,whiteSpace:'normal',textAlign:'left',fontFamily:C.font,
      fontSize:_fs(11),fontWeight:400,lineHeight:1.5,borderRadius:6,border:'1px solid '+C.border2,
      background:_modelTestFailed?C.redBg:C.bg3,color:_modelTestFailed?C.red:C.tx2}},text);
}
var _huntSubmittedAt=0;var _huntRefreshedRunId=null;
var _huntData=null;var _huntLoading=false;var _huntActionPending=false;var _huntError=null;
function _loadHuntStatus(){
  if(_huntLoading)return;_huntLoading=true;
  return _readModelResource('/api/system/models/hunt',function(d){_huntData=d;_huntError=null;
    if(d.current&&Date.parse(d.current.startedAt)>=_huntSubmittedAt&&_huntSubmittedAt>0)_modelTestMessage=null;
    if(d.current&&d.current.runId&&d.current.finishedAt&&_huntRefreshedRunId!==d.current.runId){
      _huntRefreshedRunId=d.current.runId;_modelOverview=null;_loadEvaluationData();
    }
  },function(error){_huntError=error;_huntData=null;},function(){_huntLoading=false;},15000);
}
function _controlHunt(action){
  if(_huntActionPending)return;
  var messages={start:'Spustit hunt pro nejvýše dva kandidáty? Může stahovat modely a uklidit prokazatelně odmítnuté artefakty. Obsazenou GPU nepřeruší. Role modelů se nezmění.',
    stop:'Zastavit aktuální hunt? Již uložená měření zůstanou zachovaná. Nedokončené měření není úspěch.',
    pause:'Pozastavit automatický hunt? Právě běžící měření bude pokračovat.',
    resume:'Obnovit automatický hunt? Zmeškaný termín se může dohnat nyní, pokud je GPU volná.'};
  if(!messages[action]||!confirm(messages[action]))return;
  _huntActionPending=true;renderCenter();
  fetch(_backendUrl()+'/api/system/models/hunt/control',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:action}),signal:AbortSignal.timeout(15000)})
    .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||d.code||('HTTP '+r.status));return d;});})
    .then(function(){_huntError=null;_loadHuntStatus();})
    .catch(function(e){_huntError=e.message;})
    .finally(function(){_huntActionPending=false;renderCenter();});
}
function _openModelTests(model){
  _evaluationModelFilter=model;_upgradeTab='evaluations';_loadEvaluationData();renderCenter();
}
function _testInstalledModel(model,role){
  if(_modelTestPending)return;
  var plan=typeof _evaluationData!=='undefined'&&_evaluationData&&_evaluationData.roles&&_evaluationData.roles[role];
  var scope=plan?' Celá aktuální sada: '+plan.taskCount+' úloh × '+plan.repeats+' opakování.':'';
  if(!confirm('Otestovat '+model+' pro roli '+role+'?'+scope+' Použije GPU, uloží skóre a ponechá přiřazení rolí. Provede nové měření; předchozí výsledky zůstanou v historii.'))return;
  _huntSubmittedAt=Date.now();_modelTestPending=true;_modelTestMessage=null;_modelTestTarget={model:model,role:role};_modelTestFailed=false;renderCenter();
  fetch(_backendUrl()+'/api/system/models/evaluations',{signal:AbortSignal.timeout(15000)})
    .then(function(r){if(!r.ok)throw new Error('Nelze ověřit aktuální modely');return r.json();})
    .then(function(d){var rd=d.roles&&d.roles[role];var row=rd&&(rd.artifacts||[]).find(function(a){return _canonicalModelIdentity(a.model)===_canonicalModelIdentity(model);});
      if(!row||!row.digestSha256||row.applicable===false)throw new Error('Model není nainstalovaný nebo není vhodný pro tuto roli.');
      return fetch(_backendUrl()+'/api/system/models/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:row.model,role:role,digestSha256:row.digestSha256,suiteContractSha256:rd.suiteContractSha256}),signal:AbortSignal.timeout(20000)});})
    .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||d.code||('HTTP '+r.status));return d;});})
    .then(function(){_upgradeTab='hunt';_modelTestMessage='Požadavek na měření přijat. Připravuji průběh testu…';_loadHuntStatus();})
    .catch(function(e){_modelTestFailed=true;_modelTestMessage='Test '+model+' ('+role+') se nespustil. '+e.message;})
    .finally(function(){_modelTestPending=false;renderCenter();});
}
setInterval(function(){if(_centerState.view==='upgrades'&&_upgradeTab==='hunt')_loadHuntStatus();},5000);
function _renderRecentHunts(data){
  var rows=data&&data.recent||[];
  return h('div',{'data-testid':'hunt-history'},h('h3',{style:{fontSize:_fs(13)}},'Posledních 5 akcí GPU huntu'),
    rows.length?_modelTable(['Kdy','Akce','Výsledek'],rows.map(function(r){return h('tr',{key:r.runId},
      _modelCell(new Date(r.finishedAt).toLocaleString('cs-CZ')),_modelCell(r.request&&r.request.model?r.request.model+' · '+r.request.role:'Pravidelný hunt'),
      _modelCell(h('div',null,({COMPLETE:'Dokončeno',FAILED:'Selhalo',SCHEDULED_SKIPPED:'Přeskočeno',CANCELLED:'Zastaveno',BLOCKED:'Blokováno'}[r.status]||r.status),
        (r.reasons||[]).length?h('div',{style:{color:C.tx3}},r.reasons.join('; ')):null,
        (r.results||[]).map(function(m){return h('div',{key:m.model},m.model+(m.error?' · Nedokončeno: '+m.error:'')+(m.roleErrors?' · Nedokončené role: '+m.roleErrors:'')+' · '+(m.evaluations||[]).map(function(e){return e.role+' '+Math.round(e.score*100)+' %'+(e.reused?' (starší platný výsledek)':' (nové měření)');}).join(', '));}))));
    })):h('p',{style:{color:C.tx3}},'Žádné dokončené akce.'));
}
function _huntDuration(ms){
  if(!Number.isFinite(ms)||ms<0)return '—';
  var seconds=Math.floor(ms/1000),minutes=Math.floor(seconds/60);
  return minutes>=60?Math.floor(minutes/60)+' h '+(minutes%60)+' min':minutes+' min '+(seconds%60)+' s';
}
function _huntFailureText(last){
  var code=last.code||(/Error:\s*([A-Z][A-Z0-9_]+)/.exec(last.error||'')||[])[1];
  var messages={MODEL_EVALUATION_ARTIFACT_CHANGED:'Identita modelu neodpovídá požadavku. Obnov seznam modelů a spusť test znovu.',
    MODEL_EVALUATION_CONTRACT_CHANGED:'Testovací sada se změnila. Obnov scoring a spusť test pro aktuální sadu.',
    GPU_DRIVER_LIBRARY_MISMATCH:'Ovladač NVIDIA čeká na restart počítače. Měření se nespustilo.',
    HUNT_GPU_BUSY:'GPU používá jiná úloha. Měření můžeš zopakovat, až se uvolní.',
    GPU_PROBE_UNAVAILABLE:'Dostupnost GPU se nepodařilo ověřit.'};
  return messages[code]||'Měření nebylo dokončeno. Příčinu najdeš v podrobnostech; uložená skóre zůstávají zachovaná.';
}
function _renderHuntTab(){
  if(_huntError&&!_huntData)return _modelLoadFailure(_huntError,_loadHuntStatus);
  var d=_huntData,last=d&&d.current;
  var running=d&&(d.state==='RUNNING'||d.state==='STOPPING');
  var progress=running&&last&&last.status==='RUNNING'?d.progress:null;
  var detail=progress&&progress.detail||{};
  var labels={RUNNING:'Probíhá měření',STOPPING:'Zastavuje se',WAITING:'Čeká na další termín',PAUSED:'Plánovač pozastaven',FAILED:'Měření selhalo',
    COMPLETE:'Dokončeno',CANCELLED:'Zastaveno',SCHEDULED_SKIPPED:'Přeskočeno',NO_PENDING_CANDIDATES:'Žádný čekající kandidát',BLOCKED:'Měření blokované',REPORT_MISSING:'Chybí výsledek'};
  var phases={'provider-start':'Spouštění evaluačního provideru',discovery:'Ověřování inventáře a sestavení plánu',planned:'Plán připraven',
    incumbents:'Příprava referenčních modelů',evaluating:'Příprava modelu',pull:'Stahování modelu',pullSkipped:'Model už je stažený',
    'waiting-gpu':'Čekám na uvolnění GPU',measure:'Načítání modelu a ověření jeho paměťových nároků',measured:'Paměť a rychlost změřeny',floor:'Kontrola základních schopností',floorPassed:'Základní kontroly prošly',
    tasks:'Vyhodnocování testovacích úloh',roleEvaluated:'Ukládání výsledku role',roleDecided:'Porovnání role dokončeno',roleFailed:'Měření role selhalo',roleSkipped:'Role přeskočena'};
  var activeRequest=last&&last.status==='RUNNING'?last.request:null;
  var model=progress&&progress.activeModel||activeRequest&&activeRequest.model;
  var phase=progress&&progress.phase||last&&last.phase;
  var completed=detail.completedTests,total=detail.totalTests;
  var counted=Number.isInteger(completed)&&Number.isInteger(total)&&total>0&&completed>=0&&completed<=total;
  var percent=counted?Math.floor(completed/total*100):null;
  var age=progress?Math.max(0,Date.now()-Date.parse(progress.updatedAt)):0;
  var eta=counted&&detail.etaMs>0&&detail.etaMs>age?'Přibližně '+_huntDuration(detail.etaMs-age)+' do konce této sady':counted&&completed>0?'Odhad času se upřesňuje':'Odhad času po prvních dokončených úlohách';
  var request=last&&last.request||{};
  function button(label,action,disabled){disabled=!d||_huntActionPending||disabled;return h('button',{disabled:disabled,
    onClick:function(){_controlHunt(action);},style:_modelButtonStyle(action==='start',disabled)},label);}
  function scoreButton(){return h('button',{style:_modelButtonStyle(true,false),onClick:function(){_evaluationModelFilter='';_evaluationRoleFilter=request.role||'all';_upgradeTab='evaluations';_loadEvaluationData();renderCenter();}},'Zobrazit skóre');}
  function technical(record){return h('details',{style:{marginTop:12,color:C.tx3,fontSize:_fs(10)}},h('summary',{style:{cursor:'pointer'}},'Technické podrobnosti'),
    h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto',background:C.bg1,padding:12,borderRadius:6}},record.error||(record.reasons||[]).join('\n')||record.status));}
  var card={padding:16,marginBottom:16,border:'1px solid '+C.border,borderRadius:8,background:C.bg2};
  return h('div',{'data-testid':'hunt-panel',style:{maxWidth:1080,padding:'8px 0',fontSize:_fs(12),lineHeight:1.6,color:C.tx2}},
    h('div',{style:{display:'flex',alignItems:'center',gap:12,marginBottom:16}},h('h3',{style:{margin:0,flex:1}},request.kind==='evaluation'?'Testování modelu':'GPU hunt'),
      h('button',{onClick:_loadHuntStatus,disabled:_huntLoading,style:_modelButtonStyle(false,_huntLoading)},'Obnovit')),
    _huntError?h('p',{role:'alert',style:{color:C.red}},'Aktuální stav není ověřen: '+_huntError):null,
    running?h('div',{'data-testid':'hunt-progress',style:card},
      h('div',{role:'status',style:{color:C.accent,fontWeight:600}},d.state==='STOPPING'?'Zastavování měření…':phases[phase]||'Připravuji měření…'),
      h('div',{style:{fontSize:_fs(16),fontWeight:700,marginTop:6}},model||'Ověřuji vybraný model',detail.role?' · '+detail.role:activeRequest&&activeRequest.role?' · '+activeRequest.role:''),
      detail.testName?h('p',{style:{margin:'8px 0',fontFamily:C.mono,fontSize:_fs(11)}},detail.testName+' · opakování '+detail.repeat+'/'+detail.repeats):null,
      detail.reasons?h('p',{style:{color:C.amber}},detail.reasons.map(function(reason){return /GPU evaluation is already active/.test(reason)?'GPU právě používá jiný testovací běh':reason;}).join('; ')+'. Test se spustí automaticky po uvolnění prostředků (nejvýše 30 minut).'):null,
      detail.currentProbe?h('p',null,'Základní kontrola '+detail.currentProbe+'/'+detail.totalProbes+' · '+detail.probe):null,
      h('progress',{max:100,value:counted?percent:undefined,'aria-label':'Průběh aktuální testovací sady',style:{display:'block',width:'100%',height:12,margin:'14px 0 8px',accentColor:C.accent}}),
      h('div',{style:{display:'flex',gap:16,flexWrap:'wrap',justifyContent:'space-between',color:C.tx3}},
        h('span',null,counted?completed+' / '+total+' provedených úloh · '+percent+' %':detail.download?detail.download.text:phase==='waiting-gpu'?'Požadavek čeká na volné prostředky':'Přípravná fáze · ověřuji konkrétní model'),
        h('span',null,'Uplynulo '+_huntDuration(Date.now()-Date.parse(last&&last.startedAt)))),
      h('div',{style:{color:C.tx3,fontSize:_fs(10),marginTop:8}},counted?eta:'Délka této fáze zatím není známá.'),
      progress?h('div',{style:{color:age>60000?C.amber:C.tx4,fontSize:_fs(10),marginTop:4}},'Poslední změna před '+_huntDuration(age)+(age>60000?' · aktuální úloha zatím nevrátila další výsledek.':'')):null,
      h('div',{style:{marginTop:12}},button('Zastavit měření','stop',d.state==='STOPPING'||Boolean(_huntError)))):null,
    d&&d.gpu&&!d.gpu.available?h('p',{role:'alert',style:{color:C.amber}},d.gpu.message):null,
    last&&last.status!=='RUNNING'?h('div',{'data-testid':'hunt-result',style:card},
      h('div',{style:{fontWeight:700,color:last.status==='COMPLETE'?C.success:['FAILED','REPORT_MISSING'].includes(last.status)?C.red:C.tx2}},
        (running?'Předchozí pokus · ':'')+(labels[last.status]||last.status)),
      h('p',{style:{margin:'6px 0'}},request.model||'Hunt modelů',request.role?' · '+request.role:'',
        ' · '+new Date(last.finishedAt||last.startedAt).toLocaleString('cs-CZ')),
      last.finishedAt?h('p',{style:{color:C.tx3,margin:'6px 0'}},'Doba běhu '+_huntDuration(Date.parse(last.finishedAt)-Date.parse(last.startedAt))):null,
      last.error||last.status==='FAILED'?h('p',{role:'alert'},_huntFailureText(last)):null,
      (last.reasons||[]).length?h('p',{style:{color:C.amber}},last.reasons.join('; ')):null,
      last.status==='COMPLETE'?h('p',null,'Výsledky jsou uložené. Přiřazení rolí zůstalo beze změny.'):null,
      (last.results||[]).map(function(r,i){return h('div',{key:i,style:{margin:'8px 0'}},
        h('strong',null,r.model),r.error?h('p',null,r.error):null,
        (r.roleFailures||[]).map(function(f,j){return h('div',{key:'failure'+j},h('p',null,f.role+' · měření nebylo dokončeno'),technical({error:f.error+'\n'+(f.failedTasks||[]).map(function(t){return t.name+': '+(t.error||'časový limit');}).join('\n')}));}),
        (r.evaluations||[]).map(function(ev,j){return h('p',{key:'eval'+j},ev.role+' · skóre '+Math.round(ev.score*100)+' %'+(ev.reused?' · použito starší platné měření':' · nové měření'));}),
        (r.decisions||[]).map(function(dec,j){return h('p',{key:j,style:{color:C.tx3}},dec.role+' · '+({INSUFFICIENT_EVIDENCE:'Nedostatečný důkaz',CANDIDATE_QUALITY:'Lepší kandidát',INCUMBENT_QUALITY:'Zůstává současný model'}[dec.reason]||dec.reason||'bez rozhodnutí'));}));}),
      last.diagnostics&&last.diagnostics.evaluated>0?h('p',null,'Porovnání rolí: '+last.diagnostics.evaluated+' · bez dostatečného důkazu: '+last.diagnostics.insufficient):null,
      h('div',{style:{marginTop:12}},scoreButton()),
      last.error||(last.reasons||[]).length?technical(last):null):null,
    d&&d.gpuInventory?h('p',{style:{color:C.tx3,fontSize:_fs(11)}},(d.gpuInventory.gpus||[]).map(function(g){return g.gpu_model+' · '+(g.vram_mb/1024).toFixed(1)+' GiB';}).join(', ')+' · inventura '+(d.gpuInventory.detectedAt?new Date(d.gpuInventory.detectedAt).toLocaleString('cs-CZ'):'nezjištěna')+(d.gpuInventory.inventoryStale?' · poslední kontrola selhala, zobrazena uložená kapacita':'')+' · automatická kontrola jednou denně. Při testu se ověřuje umístění modelu, nikoli kapacita karty.'):null,
    h('div',{style:card},h('div',{style:{fontWeight:600}},'Pravidelné hledání modelů'),
      h('p',{style:{color:C.tx3}},d?(d.timer.ActiveState==='active'?'Plánovač zapnutý':'Plánovač pozastavený')+' · další termín: '+(d.timer.NextElapseUSecRealtime||'nenaplánován'):'Načítám stav…'),
      h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},button('Spustit hunt nyní','start',running||Boolean(_huntError)||Boolean(d&&d.gpu&&!d.gpu.available)),
        button(d&&d.timer.ActiveState==='active'?'Pozastavit plánovač':'Obnovit plánovač',d&&d.timer.ActiveState==='active'?'pause':'resume',Boolean(_huntError)))),
    d&&d.queue&&d.queue.length?h('details',{style:{marginTop:12,color:C.tx3}},h('summary',{style:{cursor:'pointer'}},'Plán probíhajícího běhu ('+d.queue.length+')'),
      h('p',null,'Plán z '+new Date(d.queueObservedAt).toLocaleString('cs-CZ')+'. Stav se průběžně aktualizuje.'),
      d.queue.map(function(c,i){return h('div',{key:i,style:{padding:'6px 0',borderBottom:'1px solid '+C.border}},c.name+' · '+(c.roles||[]).join(', ')+' · '+({PENDING:'čeká',RUNNING:'měří se',FINISHED:'pokus ukončen'}[c.state]||c.state));})):null,_renderRecentHunts(d));
}
var _discoveredData=null;var _discoveredLoading=false;
/* v133: Model overview + management state */
var _modelOverview=null;var _modelOverviewLoading=false;
var _deleteConfirm=null;/* {model,sizeGB} */var _deletingModel=null;
/* 022/A: recovery is offered only with the complete exact identity of the
   failed operation. Warning-only state carries no identity and no button. */
var _verifyFailure=null;/* {role,model,text,identity|null} */
var _rollbackConfirm=false;var _rollbackInFlight=null;var _rollbackToken=0;
var _overviewSort={col:'name',dir:'asc'};var _roleBindings=null;
function _canonicalModelIdentity(value){
  var name=typeof value==='string'?value.trim().toLowerCase():'';
  return name.endsWith(':latest')?name.slice(0,-7):name;
}
function _isInstalledModel(models,target){
  var wanted=_canonicalModelIdentity(target);
  return !!wanted&&(models||[]).some(function(model){return _canonicalModelIdentity(model)===wanted;});
}
/* v135: Governor */
var _governorData=null;var _governorLoading=false;var _governorProposals=null;
/* v124: Marketplace */
var _mpData=null;var _mpLoading=false;var _mpMsg=null;var _mpTab='skills';var _mpSearch='';var _mpPage=1;var _mpInstalling={};
var _pullState={};/* model name → {status,percent,text,downloadedGB,totalGB,eta} */
/* v91: Feature flags state — loaded from GET /api/features */
var _featureFlags=null;var _ffLoading=false;
/* v91: Security state */
var _secTokens=null;var _secAudit=null;var _secAuditType='all';var _secWebhook=null;var _secSessions=null;var _secNewToken=null;var _secLoading={};
var _fbCategory='other';var _fbMessage='';var _fbSending=false;var _fbSent=false;var _fbAttachLast=false;var _fbCooldown=0;
var _fbFiles=[];var _fbAttachLogs=false;
function _loadBCfg(cb){if(_bCfg&&!_bCfgLoading){if(cb)cb();return;}_bCfgLoading=true;fetch(_backendUrl()+'/api/settings',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_bCfg=d||{};_bCfgLoading=false;if(cb)cb();renderCenter();}).catch(function(){_bCfg=_bCfg||{};_bCfgLoading=false;if(cb)cb();});}
var _bCfgSaveVersion=0;var _bCfgSaveChain=Promise.resolve();var _bCfgError=null;
function _saveBCfg(){
  if(!_bCfg)return;var version=++_bCfgSaveVersion;clearTimeout(_bCfgSaveTimer);
  _bCfgSaveTimer=setTimeout(function(){
    var body=JSON.stringify(_bCfg);
    _bCfgSaveChain=_bCfgSaveChain.then(function(){
      return fetch(_backendUrl()+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:body,signal:AbortSignal.timeout(5000)})
        .then(function(r){return r.json().then(function(data){if(!r.ok||data.success!==true)throw new Error(data.error||'HTTP '+r.status);});})
        .then(function(){if(version===_bCfgSaveVersion){_bCfgError=null;renderCenter();}})
        .catch(function(error){
          if(version!==_bCfgSaveVersion)return;
          _bCfgError='Nastavení nebylo uloženo: '+error.message;renderCenter();
          if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ '+_bCfgError);
          return fetch(_backendUrl()+'/api/settings',{signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('read failed');return r.json();})
            .then(function(data){if(version===_bCfgSaveVersion){_bCfg=data;renderCenter();}}).catch(function(){});
        });
    });
  },500);
}
function _bVal(key,def){return _bCfg&&_bCfg[key]!=null?_bCfg[key]:def;}
function _bSet(key,val){if(!_bCfg)_bCfg={};_bCfg[key]=val;_saveBCfg();renderCenter();}
/* v91: Feature flags loader */
function _loadFeatureFlags(cb){if(_ffLoading)return;_ffLoading=true;fetch(_backendUrl()+'/api/features',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_featureFlags=d.features||{};_ffLoading=false;if(cb)cb();renderCenter();}).catch(function(){_ffLoading=false;if(cb)cb();});}
function _toggleFeatureFlag(name,enabled){fetch(_backendUrl()+'/api/features/'+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled}),signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){if(d.features)_featureFlags=d.features;renderCenter();}).catch(function(){});}
function _resetFeatureFlags(){fetch(_backendUrl()+'/api/features/reset',{method:'POST',signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){if(d.features)_featureFlags=d.features;renderCenter();}).catch(function(){});}
/* v87.3: Info icon helper — native title tooltip on (i) badge */
function _iI(text){return h('span',{style:{display:'inline-flex',alignItems:'center',justifyContent:'center',width:14,height:14,borderRadius:'50%',background:C.bg4,color:C.tx3,fontSize:'8px',fontWeight:700,cursor:'help',marginLeft:5,verticalAlign:'middle',flexShrink:0},title:text},'i');}
function _lI(text,info){return h('span',{style:{display:'inline-flex',alignItems:'center'}},text,_iI(info));}
/* v87.3: Backend config field helpers */
function _cfgInput(label,key,def,type,hint){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),type==='textarea'?h('textarea',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',resize:'vertical',lineHeight:'1.5',minHeight:60,boxSizing:'border-box'},value:v||'',onChange:function(e){_bSet(key,e.target.value);}}):h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v!=null?String(v):'',onChange:function(e){_bSet(key,type==='number'?parseFloat(e.target.value)||0:e.target.value);}}),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
function _cfgSelect(label,key,def,opts){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('select',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v,onChange:function(e){_bSet(key,e.target.value);}},opts.map(function(o){return h('option',{key:o,value:o},o);})));}
function _cfgToggle(label,desc,key,def){return _settingsToggle(label,desc,!!_bVal(key,def),function(nv){_bSet(key,nv);});}
function _cfgSlider(label,key,def,min,max,step,unit,hint,fmt){var v=_bVal(key,def);var disp=fmt?fmt(v):v+(unit||'');return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('div',{style:{display:'flex',alignItems:'center',gap:8}},h('input',{type:'range',min:min,max:max,step:step,value:v,onChange:function(e){_bSet(key,parseFloat(e.target.value));},style:{flex:1,cursor:'pointer',accentColor:C.accent}}),h('span',{style:{fontSize:_fs(11),color:C.tx3,minWidth:52,textAlign:'right',fontFamily:C.mono}},disp)),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
var _backupMsg=null;var _notifChannels=null;
/* I2: Custom CSS injection — scoped under .intentsmith-root */
var _customStyleEl=null;
function _injectCustomCSS(css){
  if(!_customStyleEl){_customStyleEl=document.createElement('style');_customStyleEl.id='intentsmith-custom-css';document.head.appendChild(_customStyleEl);}
  _customStyleEl.textContent='.intentsmith-root {\n'+(css||'')+'\n}';
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
  {label:'IntentSmith Sans',val:"'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"},
  {label:'Inter',val:"'Inter',-apple-system,sans-serif"},
  {label:'Systémové',val:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}];
var _bgPresets=[
  {label:'Výchozí',bg:null},
  {label:'Antracit',bg:'#14141e'},
  {label:'Noční modř',bg:'#0c1525'},
  {label:'Custom',bg:null},
  {label:'Custom',bg:null}];
var _cleanDarkC={bg0:'#0c0c0f',bg1:'#111114',bg2:'#18181c',bg3:'#1f2025',bg4:'#27282e',bg5:'#2f3038',tx1:'#ececef',tx2:'#a1a1aa',border:'rgba(255,255,255,0.06)',border2:'rgba(255,255,255,0.1)'};
var _cleanLightC={bg0:'#f5f5f7',bg1:'#eaeaec',bg2:'#e0e0e3',bg3:'#d4d4d8',bg4:'#c8c8cc',bg5:'#bbbbc0',tx1:'#18181b',tx2:'#52525b',border:'rgba(0,0,0,0.08)',border2:'rgba(0,0,0,0.15)'};
var _brandLightC={bg0:'#f7f4ee',bg1:'#f0ebe2',bg2:'#e8e1d6',bg3:'#ddd4c7',bg4:'#d0c4b4',bg5:'#c0b29f',tx1:'#211d17',tx2:'#5c5348',border:'rgba(83,61,30,0.10)',border2:'rgba(83,61,30,0.18)'};
try{var _sv=localStorage.getItem('intentsmith-settings');if(_sv){var _p=JSON.parse(_sv);Object.assign(_settingsVals,_p);}}catch(e){}
function _saveSV(){try{localStorage.setItem('intentsmith-settings',JSON.stringify(_settingsVals));}catch(e){}}
function _getPalette(){var idx=_settingsVals.accentIdx;if(idx>=100){var cc=idx===100?_settingsVals.custom1:_settingsVals.custom2;return cc?_mkPalette(cc):_accentPalettes[0];}return _accentPalettes[idx]||_accentPalettes[0];}
function _isLight(){var t=_settingsVals.theme;if(t==='light')return true;if(t==='system')try{return!window.matchMedia('(prefers-color-scheme:dark)').matches;}catch(e){return false;}return false;}
function _applyTheme(themeId){
  var lt=_isLight();var isClean=themeId==='clean';var tc=isClean?(lt?_cleanLightC:_cleanDarkC):(lt?_brandLightC:_C_DEFAULT);
  var bi=_settingsVals.bgIdx||0;
  var baseBg=tc.bg0;
  if(isClean){
    if(bi===3){baseBg=_settingsVals.bgCustom1||tc.bg0;}
    else if(bi===4){baseBg=_settingsVals.bgCustom2||tc.bg0;}
    else if(bi>0&&_bgPresets[bi]&&_bgPresets[bi].bg){baseBg=_bgPresets[bi].bg;}
    C.bg0=baseBg;
    var bt=lt?'#000000':'#ffffff';
    C.bg1=_cl(baseBg,bt,0.04);C.bg2=_cl(baseBg,bt,0.08);C.bg3=_cl(baseBg,bt,0.13);C.bg4=_cl(baseBg,bt,0.18);C.bg5=_cl(baseBg,bt,0.24);
  }else{
    C.bg0=tc.bg0;C.bg1=tc.bg1;C.bg2=tc.bg2;C.bg3=tc.bg3;C.bg4=tc.bg4;C.bg5=tc.bg5;
  }
  C.tx1=tc.tx1;C.tx2=tc.tx2;C.border=tc.border;C.border2=tc.border2;
  var d=document.documentElement.style;
  d.setProperty('--intentsmith-bg0',C.bg0);d.setProperty('--intentsmith-bg1',C.bg1);d.setProperty('--intentsmith-bg2',C.bg2);
  d.setProperty('--intentsmith-bg3',C.bg3);d.setProperty('--intentsmith-bg4',C.bg4);d.setProperty('--intentsmith-bg5',C.bg5);
  d.setProperty('--intentsmith-tx1',C.tx1);d.setProperty('--intentsmith-tx2',C.tx2);
  d.setProperty('--intentsmith-border',C.border);d.setProperty('--intentsmith-border2',C.border2);
}
function _applyAccent(){
  var _ctm=_appearanceMode();var _theme=_C_THEMES[_ctm];var isClean=_ctm==='clean';var p=(!isClean&&_theme)?{accent:_theme.accent,text:_theme.accentText,dim:_theme.accentDim||_cl(_theme.accent,'#000000',0.3)}:_getPalette();var ai=(_settingsVals.activeInt||100)/100;var pi=(_settingsVals.passiveInt!=null?_settingsVals.passiveInt:50)/100;
  C.accent=_cl(p.dim,p.accent,ai);C.accentText=_cl(p.dim,p.text,ai);
  var ac=_hp(p.accent);C.accentBg='rgba('+ac[0]+','+ac[1]+','+ac[2]+','+((isClean?0.08:0.12)*ai).toFixed(3)+')';C.onAccent=_onColor(C.accent);
  if(isClean){
    /* Preserve the original Clean palette and its stronger user-selected tint. */
    C.tx3=_cl('#71717a',p.text,pi*0.6);C.tx4=_cl('#52525b',p.accent,pi*0.4);
  }else{
    /* Brand copy stays readable and only picks up a restrained gold tint. */
    C.tx3=_cl(_isLight()?'#514a41':'#a18d6e',p.text,pi*0.18);C.tx4=_cl(_isLight()?'#665f55':'#8c7d67',p.accent,pi*0.08);
  }
  var d=document.documentElement.style;
  d.setProperty('--intentsmith-accent',C.accent);d.setProperty('--intentsmith-accent-text',C.accentText);
  d.setProperty('--intentsmith-accent-bg',C.accentBg);d.setProperty('--intentsmith-accent-dim',p.dim);
  d.setProperty('--intentsmith-on-accent',C.onAccent);d.setProperty('--intentsmith-success',C.success);d.setProperty('--intentsmith-success-bg',C.successBg);
  d.setProperty('--intentsmith-tx3',C.tx3);d.setProperty('--intentsmith-tx4',C.tx4);
}
function _applyFont(){
  var fs=_settingsVals.fontSizeVal||13;
  _fsScale=fs/13;
  var ff=_fontFamilies[_settingsVals.fontIdx]||_fontFamilies[0];
  C.font=ff.val;
  document.documentElement.style.setProperty('--intentsmith-font-size',fs+'px');
  document.documentElement.style.setProperty('--intentsmith-font-family',ff.val);
  document.documentElement.style.setProperty('--intentsmith-mono',C.mono);
  document.body.style.fontFamily=ff.val;
  ['intentsmith-center-mount','intentsmith-sidebar','intentsmith-chat-panel','intentsmith-agent-panel'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.style.zoom='';el.style.fontFamily=ff.val;}});
  var sid='intentsmith-font-override';var ex=document.getElementById(sid);
  if(!ex){ex=document.createElement('style');ex.id=sid;document.head.appendChild(ex);}
  var css='#intentsmith-center-mount span,#intentsmith-center-mount div,#intentsmith-center-mount p,#intentsmith-center-mount button,'+
    '#intentsmith-center-mount label,#intentsmith-center-mount h3,#intentsmith-center-mount h4,'+
    '#intentsmith-sidebar span,#intentsmith-sidebar div,#intentsmith-sidebar button,'+
    '#intentsmith-chat-panel span,#intentsmith-chat-panel div,#intentsmith-chat-panel textarea,#intentsmith-chat-panel input,'+
    '#intentsmith-agent-panel span,#intentsmith-agent-panel div{font-family:'+ff.val+';}\n'+
    '.codicon,.codicon *{font-family:"codicon"!important;}\n';
  if(fs!==13){css+='#intentsmith-chat-panel .intentsmith-chat-msg-text{font-size:'+fs+'px!important;}';}
  ex.textContent=css;
}
function _applyAllSettings(){var _ctm=_appearanceMode();_applyColorTheme(_ctm);if(!_isProTheme(_ctm))_applyTheme(_ctm);_applyAccent();_injectProThemeCSS(_ctm);_applyFont();_injectCustomCSS(_settingsVals.customCSS);renderCenter();renderChat();renderAgent();if(typeof renderSidebar==='function')renderSidebar();}
/* Apply saved settings on load */
var _initialAppearance=_appearanceMode();_applyColorTheme(_initialAppearance);if(!_isProTheme(_initialAppearance))_applyTheme(_initialAppearance);_applyAccent();setTimeout(function(){_applyFont();_injectCustomCSS(_settingsVals.customCSS);_applyAllSettings();},600);
/* Restore Pro theme from localStorage */
try{var _tm=_appearanceMode();if(_isProTheme(_tm)){document.body.classList.add('theme-pro-'+_tm);_applyColorTheme(_tm);_injectProThemeCSS(_tm);}}catch(e){}

var _settingsLabels={'Account':'Účet','LLM':'Modely a inference','Memory':'Paměť','Notifications':'Oznámení','Output':'Výstup','Appearance':'Vzhled','System':'Systém','Storage':'Úložiště','Backup':'Zálohy','Feature Flags':'Funkce','Security':'Zabezpečení','About':'O aplikaci'};
var _settingsSearch='';
function centerSettings(){
  var si=_centerState.settingsSection;if(si==null)si=5;
  var sec=SETTINGS_SECTIONS[si]||SETTINGS_SECTIONS[0];
  if(!_bCfg&&!_bCfgLoading)_loadBCfg();
  return h(React.Fragment,null,viewHead('Nastavení',false),
    h('div',{className:'intentsmith-settings',style:{display:'flex',flex:1,minHeight:0,overflow:'hidden'}},
      h('nav',{style:{width:220,minWidth:170,borderRight:'1px solid '+C.border,padding:12,overflowY:'auto'},'aria-label':'Kategorie nastavení'},
        h('input',{value:_settingsSearch,placeholder:'Hledat kategorii', 'aria-label':'Hledat v nastavení',style:{width:'100%',boxSizing:'border-box',padding:8,marginBottom:12,border:'1px solid '+C.border2,borderRadius:4,background:C.bg2,color:C.tx1},onChange:function(e){_settingsSearch=e.target.value;renderCenter();}}),
        SETTINGS_SECTIONS.map(function(section,index){var title=_settingsLabels[section.title]||section.title;if((title+' '+section.desc).toLocaleLowerCase().indexOf(_settingsSearch.toLocaleLowerCase())<0)return null;return h('button',{key:section.title,'aria-current':index===si?'page':undefined,style:{display:'block',width:'100%',textAlign:'left',border:0,borderRadius:4,padding:'10px 12px',marginBottom:2,background:index===si?C.bg3:'transparent',color:index===si?C.tx1:C.tx2,fontSize:13,cursor:'pointer'},onClick:function(){_centerState.settingsSection=index;renderCenter();}},title);})),
      settingsDetailPanel(sec,si)));
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
  return h('div',{style:{flex:1,minWidth:0,background:C.bg1,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0,overflow:'hidden'}},
    h('div',{style:{padding:'10px 14px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:8,flexShrink:0}},

      h('span',{style:{fontSize:_fs(13.5),fontWeight:700,flex:1,color:C.tx1}},_settingsLabels[sec.title]||sec.title),
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
  var appearanceMode=_appearanceMode();
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
  function _appearancePicker(){
    return h('div',{style:{display:'flex',flexWrap:'wrap',gap:6,marginBottom:16}},
      [{id:'intentsmith',label:'IntentSmith',desc:'Výchozí brand',clr:'#e7c27a'},
       {id:'clean',label:'Clean',desc:'Původní přizpůsobitelný',clr:'#4ade80'},
       {id:'matrix',label:'Matrix',desc:'Neon terminal',clr:'#00ff6a'},
       {id:'japanese',label:'Japanese',desc:'Červená aurora',clr:'#f87171'},
       {id:'midnight',label:'Midnight',desc:'Vesmírné sklo',clr:'#93c5fd'}
      ].map(function(pm){
        var current=_appearanceMode();
        var isSel=current===pm.id;
        return h('div',{key:pm.id,style:{flex:'0 0 calc(50% - 3px)',padding:'8px 6px',borderRadius:8,border:'2px solid '+(isSel?pm.clr:'rgba(255,255,255,0.08)'),background:isSel?'rgba(255,255,255,0.05)':C.bg3,cursor:'pointer',textAlign:'center',transition:'all 0.2s ease'},
          onClick:function(){
            document.body.className=document.body.className.replace(/\btheme-pro[\w-]*/g,'').trim();
            if(_isProTheme(pm.id)){document.body.classList.add('theme-pro-'+pm.id);}
            localStorage.setItem('intentsmith-theme-mode',pm.id);
            _applyColorTheme(pm.id);
            _applyAllSettings();
          }},
          h('div',{style:{fontSize:_fs(11),fontWeight:isSel?700:500,color:isSel?pm.clr:C.tx2,marginBottom:1}},pm.label),
          h('div',{style:{fontSize:_fs(8),color:C.tx4}},pm.desc));
      }));
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
    /* Appearance style — visible before detailed color controls */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8}},'Styl vzhledu'),
    _appearancePicker(),
    /* Clean keeps the original editable palette. Brand/pro styles own theirs. */
    appearanceMode==='clean'?h(React.Fragment,null,
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Accent'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
        _accentPalettes.map(function(p,i){return _cpDot(p.accent,sv.accentIdx===i,function(){sv.accentIdx=i;_saveSV();_applyAllSettings();},i);}),
        _cpCustom('intentsmith-cp1',sv.custom1,sv.accentIdx===100,function(v){sv.custom1=v;sv.accentIdx=100;_saveSV();_applyAllSettings();}),
        _cpCustom('intentsmith-cp2',sv.custom2,sv.accentIdx===101,function(v){sv.custom2=v;sv.accentIdx=101;_saveSV();_applyAllSettings();})),
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Pozadí'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
        _bgPresets.slice(0,3).map(function(bp,i){return _cpDot(bp.bg,sv.bgIdx===i,function(){sv.bgIdx=i;_saveSV();_applyAllSettings();},('bg'+i));}),
        _cpCustom('intentsmith-bgc1',sv.bgCustom1,sv.bgIdx===3,function(v){sv.bgCustom1=v;sv.bgIdx=3;_saveSV();_applyAllSettings();}),
        _cpCustom('intentsmith-bgc2',sv.bgCustom2,sv.bgIdx===4,function(v){sv.bgCustom2=v;sv.bgIdx=4;_saveSV();_applyAllSettings();}))
    ):h('div',{style:{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',marginBottom:16,border:'1px solid '+C.border,borderRadius:8,background:C.bg2}},
      appearanceMode==='intentsmith'?h('div',{style:{display:'flex',gap:4,flexShrink:0}},
        ['#09090b','#141416','#d4a85f'].map(function(color){return h('span',{key:color,style:{width:12,height:12,borderRadius:'50%',background:color,border:'1px solid '+C.border2}});})):null,
      h('div',{style:{fontSize:_fs(9.5),lineHeight:1.4,color:C.tx3}},appearanceMode==='intentsmith'?'IntentSmith používá vlastní zlatou a antracitovou paletu. Volba Téma stále přepíná tmavou a světlou variantu.':'Barvy a pozadí určuje zvolený efektový styl.')),
    /* Intensity sliders */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:8}},'Intenzita podsvícení'),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Aktivní prvky')),
    h('div',{style:{marginBottom:10}},_sl(sv.activeInt,10,100,5,function(v){sv.activeInt=v;_saveSV();_applyAllSettings();},'%')),
    h('div',{style:{marginBottom:4}},h('span',{style:{fontSize:_fs(10),color:C.tx3}},'Neaktivní prvky')),
    h('div',{style:{marginBottom:16}},_sl(sv.passiveInt,0,100,5,function(v){sv.passiveInt=v;_saveSV();_applyAllSettings();},'%')),
    /* Pro theme glass sliders (only visible for pro themes) */
    (function(){var _ctm=_appearanceMode();if(!_isProTheme(_ctm))return null;return h(React.Fragment,null,
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
    /* I2: Custom CSS */
    h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,marginTop:16}},'Vlastní CSS'),
    h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:6}},'Scope: .intentsmith-root — globální selektory nejsou podporované'),
    h('textarea',{value:sv.customCSS||'',
      onChange:function(e){sv.customCSS=e.target.value;_injectCustomCSS(e.target.value);_saveSV();},
      style:{width:'100%',height:80,fontFamily:C.mono,fontSize:_fs(11),background:C.bg3,color:C.tx2,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',outline:'none',resize:'vertical',lineHeight:'1.4',boxSizing:'border-box'},
      placeholder:'.intentsmith-card { border-radius: 12px; }'}));
}

/* ═══════════════════════════════════════════════════════════
   v87.4: SETTINGS SECTION RENDERERS
   ═══════════════════════════════════════════════════════════ */
function settingsAccount(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _cfgInput('Zobrazované jméno','intentsmith.account.displayName','','input','Jak vás IntentSmith oslovuje v konverzaci'),
    _cfgInput('Popis / Bio','intentsmith.account.description','','textarea','Kontext pro personalizaci odpovědí — např. role, zkušenosti, preference'),
    _cfgSelect('Jazyk UI','intentsmith.language','cs',['cs','en']),
    h('div',{style:{marginBottom:12}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6}},'Složka projektů'),
      h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.mono,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},
        value:_settingsVals.projectsDir||'',placeholder:'/home/user/Projects',
        onChange:function(e){_settingsVals.projectsDir=e.target.value;_saveSV();renderCenter();}}),
      h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},'Výchozí složka pro nové projekty')));
}
var _settingsModelsLoading=false,_settingsModelsError=null;
function _loadSettingsModels(){
  if(_settingsModelsLoading)return;_settingsModelsLoading=true;_settingsModelsError=null;
  return _readModelResource('/api/system/models',function(d){
    var models=Array.isArray(d)?d:d.models;
    if(!Array.isArray(models))throw new Error('Seznam modelů má neplatný formát.');
    _ollamaModels=models;
  },function(error){_settingsModelsError=error;_ollamaModels=[];},function(){_settingsModelsLoading=false;},5000);
}
function _openModelsWorkspace(){_centerState.view='upgrades';_upgradeTab='overview';_centerState.settingsSection=null;renderCenter();}
function settingsLLM(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_gpuInfo){fetch(_backendUrl()+'/api/system/gpu',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(d){_gpuInfo=d;renderCenter();}).catch(function(){_gpuInfo={error:true};});}
  if(!_ollamaModels&&!_settingsModelsLoading)_loadSettingsModels();
  if(!_evaluationData&&!_evaluationLoading)_loadEvaluationData();
  var models=[...new Set((Array.isArray(_ollamaModels)?_ollamaModels:[]).map(function(m){return typeof m==='string'?m:m.name||m.model||'';}).filter(Boolean))];
  var gpus=_gpuInfo&&_gpuInfo.profile?_gpuInfo.profile.gpus:(_gpuInfo&&_gpuInfo.gpus?_gpuInfo.gpus:null);
  var rec=_gpuInfo&&_gpuInfo.recommendation?_gpuInfo.recommendation:null;
  return h('div',null,
    h('button',{style:Object.assign({},_modelButtonStyle(true,false),{width:'100%',marginBottom:14}),onClick:_openModelsWorkspace},'Spravovat role a modely'),
    _settingsModelsError?_modelLoadFailure(_settingsModelsError,function(){_ollamaModels=null;_roleBindings=null;_loadSettingsModels();renderCenter();}):null,
    gpus?h('div',{style:{background:'linear-gradient(135deg,'+_rgba(C.success,0.10)+','+_rgba(C.success,0.04)+')',border:'1px solid '+_rgba(C.success,0.24),borderRadius:8,padding:12,marginBottom:14}},
      h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.success,marginBottom:6}},'GPU'),
      gpus.map(function(g,i){
        var name=g.gpu_model||g.name||'CPU-only';
        var vram=g.vram_mb||g.vram||0;
        return h('div',{key:i,style:{fontSize:_fs(11),color:C.tx2,marginBottom:2}},
          h('span',{style:{fontWeight:600}},name),
          vram?h('span',{style:{color:C.tx3}},' — '+vram+' MB VRAM'):'',
          g.driver?h('span',{style:{color:C.tx4,fontSize:_fs(9)}},' ('+g.driver+(g.cuda_version?' / CUDA '+g.cuda_version:'')+')'):null);
      }),
      rec&&rec.recommended_model?h('div',{style:{fontSize:_fs(9),color:C.success,marginTop:6}},'Doporučený model: '+rec.recommended_model):null):null,
    /* v133: Compact 7-role bindings summary (replaces 3 broken dropdowns) */
    (function(){
      if(_settingsModelsError)return null;
      if(!_roleBindings){
        fetch(_backendUrl()+'/api/system/upgrades/bindings',{signal:AbortSignal.timeout(5000)})
          .then(function(r){if(!r.ok)throw new Error('Přiřazení rolí: HTTP '+r.status);return r.json();})
          .then(function(d){_roleBindings=d.bindings||{};renderCenter();})
          .catch(function(e){_settingsModelsError=_modelReadError(e);renderCenter();});
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
            var roleEval=_evaluationData&&_evaluationData.roles?_evaluationData.roles[r]:null;
            var evalRow=roleEval?(roleEval.artifacts||[]).find(function(x){return x.isCurrentBinding;}):null;
            var scoreText=evalRow&&evalRow.status==='COMPLETE'?Math.round(evalRow.score*100)+'%':(evalRow?evalRow.status:'MISSING');
            var scoreColor=evalRow&&evalRow.status==='COMPLETE'?C.success:evalRow&&evalRow.status==='BLOCKED'?C.amber:C.tx4;
            var installed=_isInstalledModel(models,m);
            return h('div',{key:r,style:{display:'flex',alignItems:'center',gap:8,padding:'4px 8px',borderRadius:6,background:C.bg2}},
              h('span',{style:{fontWeight:700,fontSize:_fs(10),color:rp[r].color,minWidth:48}},r),
              h('span',{style:{fontSize:_fs(10),color:C.tx3,minWidth:100,flex:'0 0 auto'}},rp[r].name),
              h('span',{style:{flex:1,fontSize:_fs(10),color:installed?C.tx1:'#ef4444',fontFamily:C.mono}},m,
                !installed?h('span',{style:{color:'#ef4444',fontSize:_fs(9),marginLeft:4}},'\u26A0'):null),
              h('span',{style:{fontSize:_fs(10),fontWeight:600,color:scoreColor,minWidth:36,textAlign:'right'}},scoreText));
          })));
    })(),
    _cfgInput('Ollama URL','intentsmith.llm.ollamaUrl','http://127.0.0.1:11434','input','Adresa lok\u00E1ln\u00EDho Ollama serveru'),
    _cfgSlider(_lI('Temperature','Nízká = deterministické, konzistentní odpovědi. Vysoká = kreativnější, rozmanitější výstupy.'),'intentsmith.llm.temperature',0.7,0,2,0.1,''),
    _cfgSlider(_lI('Context window','Kolik tokenů si model pamatuje v rámci jedné konverzace. Větší okno = více kontextu, ale vyšší nároky na paměť.'),'intentsmith.llm.contextWindow',32768,2048,131072,1024,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':'v tok';}),
    _cfgSlider(_lI('Timeout chat','Maximální doba čekání na odpověď chat modelu. Zvyšte při pomalých odpovědích.'),'intentsmith.llm.timeoutChat',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('Timeout code','Maximální doba čekání na odpověď code modelu.'),'intentsmith.llm.timeoutCode',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('GPU layers','Kolik vrstev modelu se načte do GPU. -1 = automaticky dle dostupné VRAM. 0 = vše na CPU.'),'intentsmith.llm.numGpu',-1,-1,8,1,''),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'14px 0'}}));
}
/* ═══════════════════════════════════════════════════════════
   v120.2: MODEL UPGRADE PROPOSALS — full center panel
   ═══════════════════════════════════════════════════════════ */
var _modelReadEpoch=0,_modelsDisconnected=false;
function _modelReadError(e){
  return e&&(/Failed to fetch|fetch failed|NetworkError|capability is unavailable/.test(e.message)||e.name==='TypeError')
    ?'Backend není dostupný. Spojení se obnovuje automaticky; můžeš zkusit načtení znovu.'
    :e&&(/Timeout|Abort/.test(e.name))?'Backend neodpověděl včas. Zkus načtení znovu.':e&&e.message||'Data se nepodařilo načíst.';
}
function _modelLoadFailure(message,retry){
  return h('div',{role:'alert','data-testid':'model-load-error',style:{padding:14,marginBottom:12,border:'1px solid '+C.border2,borderRadius:8,background:C.bg2}},
    h('p',{style:{color:C.amber,margin:'0 0 10px'}},message),
    h('button',{style:_modelButtonStyle(false,false),onClick:retry},'Zkusit znovu'));
}
function _readModelResource(path,loaded,failed,finished,timeout){
  var epoch=_modelReadEpoch;
  return fetch(_backendUrl()+path,{signal:AbortSignal.timeout(timeout||10000)})
    .then(function(r){if(!r.ok)throw new Error('Načtení dat selhalo (HTTP '+r.status+').');return r.json();})
    .then(function(data){if(epoch===_modelReadEpoch)loaded(data);})
    .catch(function(e){if(epoch===_modelReadEpoch)failed(_modelReadError(e));})
    .finally(function(){if(epoch===_modelReadEpoch){finished();renderCenter();}});
}
function _resetModelReads(){
  _modelReadEpoch++;
  _historyDetails={};_historyExpanded={};
  _upgradeLoading=_evaluationLoading=_modelOverviewLoading=_discoveredLoading=_governorLoading=_huntLoading=_installedLoading=false;
  _upgradeData=_evaluationData=_modelOverview=_discoveredData=_governorData=_governorProposals=_installedModels=null;
  _governorError=null;_huntData=null;_huntError=null;
  _settingsModelsLoading=false;_settingsModelsError=null;_ollamaModels=null;_roleBindings=null;
}
function _refreshModelWorkspace(){
  _resetModelReads();
  if(_centerState.view!=='upgrades')return;
  _loadUpgradeData();_loadModelOverview();_loadEvaluationData();_loadDiscoveredData();_loadGovernorData();_loadHuntStatus();
}
function _retryModelConnection(){
  return fetch(_backendUrl()+'/api/health',{signal:AbortSignal.timeout(3000)})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(){if(window.IntentSmithWS&&!window.IntentSmithWS.isReady())window.IntentSmithWS.reconnect();_modelsDisconnected=false;_refreshModelWorkspace();})
    .catch(function(){_modelsDisconnected=true;renderCenter();});
}
function _loadUpgradeData(){
  if(_upgradeLoading)return;_upgradeLoading=true;
  return _readModelResource('/api/system/upgrades',function(d){_upgradeData=d;},
    function(error){_upgradeData={error:error};},function(){_upgradeLoading=false;},8000);
}
/* v125: fire-and-forget — progress comes via WS events */
function _upgradeApply(role,model){
  if(_upgradeLoading){_upgradeMsg={ok:false,text:'Prob\u00EDh\u00E1 jin\u00FD upgrade \u2014 vy\u010Dkejte'};renderCenter();return;}
  _upgradeMsg={ok:true,text:'Aplikuji upgrade '+role+': '+model+'...'};_upgradeLoading=true;renderCenter();
  if(window._intentsmith)window._intentsmith.agentLog('TOOL','\uD83D\uDD04 Upgrade '+role+': '+model+'...');
  fetch(_backendUrl()+'/api/system/upgrades/apply',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:role,targetModel:model}),signal:AbortSignal.timeout(30000)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.ok){_upgradeLoading=false;
        var errMsg=d.error||'Upgrade selhal';
        if(errMsg.indexOf('already set')>=0)errMsg='Model je ji\u017E nastaven pro tuto roli';
        else if(errMsg.indexOf('Invalid role')>=0)errMsg='Neplatn\u00E1 role: '+role;
        _upgradeMsg={ok:false,text:errMsg};renderCenter();
        if(window._intentsmith)window._intentsmith.agentLog('TOOL','\u274C '+errMsg);
        setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}
      /* else: loading stays true, WS model_changed/upgrade_error will clear it */
      /* Safety: auto-reset after 120s in case WS event is lost */
      setTimeout(function(){if(_upgradeLoading){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Timeout \u2014 odpov\u011B\u010F nedorazila'};renderCenter();
        setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}},120000);})
    .catch(function(e){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Chyba s\u00EDt\u011B: '+e.message};renderCenter();
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','\u274C Chyba s\u00EDt\u011B: '+e.message);});
}
function _upgradeCheck(){
  _upgradeMsg={ok:true,text:'Probíhá kontrola + vyhledávání nových modelů...'};_upgradeLoading=true;renderCenter();
  fetch(_backendUrl()+'/api/system/upgrades/check',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({fullCycle:true}),
    signal:AbortSignal.timeout(90000)})
    .then(function(r){return r.json();})
    .then(function(d){_upgradeData=d;_upgradeLoading=false;
      var stats=d.discovery||{};var l4=stats.l4Count||0;
      _upgradeMsg={ok:true,text:'Discovery dokončeno — '+(stats.candidateCount||0)+' kandidátů'+(l4>0?', '+l4+' nově objeveno':'')+'. Kvalitu určuje pouze evaluace.'};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);})
    .catch(function(e){_upgradeLoading=false;_upgradeMsg={ok:false,text:'Chyba: '+e.message};renderCenter();});
}
function _loadEvaluationData(){
  if(_evaluationLoading)return;_evaluationLoading=true;
  return _readModelResource('/api/system/models/evaluations',function(d){_evaluationData=d;},
    function(error){_evaluationData={error:error};},function(){_evaluationLoading=false;});
}
/* Installed models cache for role and evaluation tabs */
var _installedModels=null;var _installedLoading=false;var _assigningRole=null;
function _loadInstalledModels(){
  if(_installedLoading)return;_installedLoading=true;
  fetch(_backendUrl()+'/api/system/models',{signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();})
    .then(function(d){_installedModels=(d.models||[]).map(function(m){return m.name;});_installedLoading=false;renderCenter();})
    .catch(function(){_installedLoading=false;});
}
function _assignModel(role,model){
  if(_assigningRole)return;if(!confirm('Přiřadit '+model+' roli '+role+'? Samostatný test lze spustit i bez změny přiřazení.'))return;_assigningRole=role;_assignmentMessage='Ověřuji a přiřazuji '+model+'…';renderCenter();
  fetch(_backendUrl()+'/api/system/upgrades/apply',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role:role,targetModel:model,appliedBy:'user-roles'}),signal:AbortSignal.timeout(30000)})
    .then(function(r){return r.json();})
    .then(function(d){_assigningRole=null;
      if(d.ok||d.applied){_assignmentMessage='Požadavek na přiřazení '+role+' → '+model+' byl přijat. Aktuální stav se obnoví po ověření.';_evaluationData=null;_modelOverview=null;_loadModelOverview();_loadEvaluationData();_discoveredData=null;}
      else{_assigningRole=null;_assignmentMessage=d.error||'Přiřazení se nezdařilo.';}renderCenter();})
    .catch(function(e){_assigningRole=null;_assignmentMessage='Přiřazení selhalo: '+e.message;renderCenter();});
}
/* v133: Overview loader + model delete */
function _loadModelOverview(){
  if(_modelOverviewLoading)return;_modelOverviewLoading=true;
  return _readModelResource('/api/system/models/overview',function(d){_modelOverview=d;_roleBindings=d.bindings||null;},
    function(error){_modelOverview={error:error};},function(){_modelOverviewLoading=false;});
}
function _deleteModel(name){
  if(_deletingModel)return;_deletingModel=name;renderCenter();
  fetch(_backendUrl()+'/api/system/models?name='+encodeURIComponent(name),{method:'DELETE',signal:AbortSignal.timeout(15000)})
    .then(function(r){return r.json();})
    .then(function(d){_deletingModel=null;_deleteConfirm=null;
      if(d.ok){_modelOverview=null;_installedModels=null;_ollamaModels=null;}
      else{_upgradeMsg={ok:false,text:d.error||'Chyba p\u0159i maz\u00E1n\u00ED'};setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);}
      renderCenter();})
    .catch(function(e){_deletingModel=null;_deleteConfirm=null;
      _upgradeMsg={ok:false,text:'Chyba: '+e.message};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);});
}
function _exactRecoveryIdentity(ev){
  /* 022/A bidirectional skew: a new client against an older server, or a
     replayed event, must never become actionable. Any missing or non-exact
     member means warning only — never a {role} fallback. */
  if(!ev||typeof ev.role!=='string'||!ev.role)return null;
  if(typeof ev.operationId!=='string'||ev.operationId.length<16)return null;
  if(!Number.isSafeInteger(ev.committedBindingRevision)||ev.committedBindingRevision<=0)return null;
  if(!Number.isSafeInteger(ev.failedAttemptRevision)||ev.failedAttemptRevision<=0)return null;
  return {role:ev.role,operationId:ev.operationId,
    committedBindingRevision:ev.committedBindingRevision,
    failedAttemptRevision:ev.failedAttemptRevision};
}
function _rollbackBinding(identity){
  if(!identity)return;
  if(_rollbackInFlight)return;/* single-flight: a double click cannot send twice */
  _rollbackInFlight=identity.role;_rollbackConfirm=false;
  var token=++_rollbackToken;renderCenter();
  return fetch(_backendUrl()+'/api/system/upgrades/rollback',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(identity),signal:AbortSignal.timeout(30000)})
    .then(function(r){return r.json().then(function(d){return {status:r.status,body:d};});})
    .then(function(res){
      if(token!==_rollbackToken)return;/* stale response guard */
      _rollbackInFlight=null;
      if(res.status>=200&&res.status<300&&res.body&&res.body.ok){
        _verifyFailure=null;_roleBindings=null;_modelOverview=null;
        _upgradeMsg={ok:true,text:'Rollback proveden: '+identity.role};
      }else{
        /* The warning stays on screen: nothing was rolled back. */
        _upgradeMsg={ok:false,text:'Rollback odmítnut ('+res.status+'): '
          +((res.body&&res.body.error)||'stav se mezitím změnil')};
      }
      renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},8000);})
    .catch(function(e){
      if(token!==_rollbackToken)return;
      _rollbackInFlight=null;
      _upgradeMsg={ok:false,text:'Rollback selhal: '+e.message};renderCenter();
      setTimeout(function(){_upgradeMsg=null;renderCenter();},8000);});
}
var _discoverLoading=false;var _discoverMsg=null;
function _discoverNewModels(){
  if(_discoverLoading)return;
  _discoverLoading=true;_discoverMsg={ok:true,text:'Prohledávám ollama.com/library...'};renderCenter();
  fetch(_backendUrl()+'/api/system/upgrades/check',{method:'POST',
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
var _downloadsLoading=false,_downloadsError=null,_downloadsObservedAt=null,_downloadRequestError=null;
function _pullKey(name){return String(name||'').replace(/:latest$/,'');}
function _downloadState(name){return _pullState[_pullKey(name)];}
function _loadDownloads(){
  if(_downloadsLoading)return;_downloadsLoading=true;
  return fetch(_backendUrl()+'/api/system/models/downloads',{signal:AbortSignal.timeout(7000)})
    .then(function(r){if(!r.ok)throw Error('HTTP '+r.status);return r.json();})
    .then(function(data){
      var states={},completed=false;
      (data.downloads||[]).forEach(function(row){var key=_pullKey(row.model);if(states[key])return;states[key]=row;
        if(row.status==='done'&&_pullState[key]&&_pullState[key].status!=='done')completed=true;
      });
      _pullState=states;_downloadsError=null;_downloadsObservedAt=Date.now();
      if(completed){_loadDiscoveredData();_loadModelOverview();}
    }).catch(function(e){_downloadsError=_modelReadError(e);})
    .finally(function(){_downloadsLoading=false;if(_centerState.view==='upgrades')renderCenter();});
}
setInterval(function(){if(_centerState.view==='upgrades'&&_upgradeTab==='discovered')_loadDownloads();},3000);
function _pullModel(name){
  var state=_downloadState(name);
  if(state&&!['done','error'].includes(state.status))return;
  _downloadRequestError=null;
  _pullState[_pullKey(name)]={model:name,status:'starting',percent:null,text:'Odesílám požadavek',startedAt:new Date().toISOString()};renderCenter();
  fetch(_backendUrl()+'/api/system/models/pull',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name}),signal:AbortSignal.timeout(10000)})
    .then(function(r){return r.json().then(function(d){if(!r.ok||!d.ok)throw Error(d.error||'HTTP '+r.status);return d;});})
    .then(function(){_loadDownloads();})
    .catch(function(e){_downloadRequestError=name+' — '+e.message;_pullState[_pullKey(name)]={model:name,status:'error',percent:null,text:e.message,startedAt:new Date().toISOString()};renderCenter();});
}
function _renderDownloads(){
  var rows=Object.keys(_pullState).map(function(k){return _pullState[k];}).filter(function(p){return !['done','error'].includes(p.status)||Date.now()-Date.parse(p.startedAt)<86400000;});
  if(!rows.length&&!_downloadsError&&!_downloadRequestError)return null;
  function bytes(n){return (n/Math.pow(1024,3)).toFixed(2)+' GiB';}
  return h('section',{'data-testid':'model-downloads',style:{marginBottom:18}},
    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},h('h3',null,'Stahování modelů'),
      h('button',{style:_modelButtonStyle(false,_downloadsLoading),disabled:_downloadsLoading,onClick:_loadDownloads},'Obnovit stav')),
    _downloadRequestError?h('p',{role:'alert',style:{color:C.red}},_downloadRequestError):null,
    _downloadsError?h('p',{role:'alert',style:{color:C.amber}},'Stav stahování není ověřen. '+_downloadsError):null,
    rows.map(function(p){var running=!['done','error'].includes(p.status),age=Date.now()-Date.parse(p.updatedAt||p.startedAt),stale=running&&(!!_downloadsError||age>15000);
      return h('div',{key:p.operationId||p.model,style:{padding:14,marginBottom:8,background:C.bg2,border:'1px solid '+C.border2,borderRadius:8}},
        h('div',{style:{display:'flex',justifyContent:'space-between',gap:16}},h('strong',null,p.model),h('span',{style:{color:p.status==='error'?C.red:p.status==='done'?C.success:C.accent}},p.text)),
        running?h('progress',{max:100,value:!stale&&Number.isFinite(p.percent)?p.percent:undefined,'aria-label':'Stahování '+p.model,style:{width:'100%',height:8,accentColor:C.accent,margin:'12px 0'}}):null,
        p.totalBytes>0?h('div',null,(Number.isFinite(p.percent)?p.percent+' % · ':'')+bytes(p.completedBytes)+' / '+bytes(p.totalBytes)+' · oznámené vrstvy'):null,
        running?h('div',{style:{color:stale?C.amber:C.tx3,marginTop:6}},stale?'Čekám na aktuální zprávu. Poslední aktualizace před '+_huntDuration(age)+'.':
          (p.bytesPerSecond>0?(p.bytesPerSecond/1048576).toFixed(1)+' MiB/s · ':'')+(p.etaSeconds>0?'Odhad do konce oznámených vrstev: '+_huntDuration(p.etaSeconds*1000):'Odhad času bude dostupný po změření přenosu.')):null,
        p.startedAt?h('div',{style:{fontSize:_fs(10),color:C.tx3,marginTop:6}},'Zahájeno '+new Date(p.startedAt).toLocaleString('cs-CZ')):null,
        p.status==='error'?h('button',{style:_modelButtonStyle(false,false),onClick:function(){_pullModel(p.model);}},'Zkusit stáhnout znovu'):null,
        p.status==='done'?h('button',{style:_modelButtonStyle(false,false),onClick:function(){_evaluationRoleFilter='all';_openModelTests(p.model);}},'Testy modelu…'):null);
    }));
}
function _loadDiscoveredData(){
  _loadDownloads();
  if(_discoveredLoading)return;_discoveredLoading=true;
  return _readModelResource('/api/system/models/candidates',function(d){_discoveredData=d;},
    function(error){_discoveredData={error:error};},function(){_discoveredLoading=false;});
}
var _candidateFilter={fit:'fit',sort:'releaseDate-desc',budgetGiB:'',role:'all'};
function _filteredCandidates(data){
  var budget=_candidateFilter.budgetGiB!==''?Number(_candidateFilter.budgetGiB)*1024:data.vramBudgetMb;
  if(!Number.isFinite(budget)||!(budget>0))budget=null;
  var rows=(data.candidates||[]).filter(function(m){
    if(_candidateFilter.role&&_candidateFilter.role!=='all'&&!(m.eligibleRoles||[]).includes(_candidateFilter.role))return false;
    if(_candidateFilter.fit==='installed'&&!m.installed)return false;
    if(_candidateFilter.fit==='fit'&&budget&&(!(m.vramMb>0)||m.vramMb>budget))return false;
    return true;
  });
  var sort=_candidateFilter.sort,field=sort.split('-')[0],dir=sort.endsWith('-asc')?1:-1;
  rows.sort(function(a,b){
    if(field==='name')return a.name.localeCompare(b.name);
    var av=field==='releaseDate'?Date.parse(a.releaseDate):Number(a[field]),bv=field==='releaseDate'?Date.parse(b.releaseDate):Number(b[field]);var ak=Number.isFinite(av)&&av>0,bk=Number.isFinite(bv)&&bv>0;
    if(ak!==bk)return ak?-1:1;
    return (ak?(av-bv)*dir:0)||a.name.localeCompare(b.name);
  });
  return {rows:rows,budgetMb:budget,fitUnavailable:_candidateFilter.fit==='fit'&&!budget};
}
function _renderDiscoveredTab(){
  var toast=_discoverMsg?h('div',{style:{marginBottom:12,padding:'8px 14px',borderRadius:6,fontSize:_fs(11),fontWeight:600,
    background:_discoverMsg.ok?C.successBg:C.redBg,color:_discoverMsg.ok?C.success:C.red,
    border:'1px solid '+(_discoverMsg.ok?_rgba(C.success,0.25):_rgba(C.red,0.25))}},_discoverMsg.text):null;
  if(_discoveredLoading&&!_discoveredData)return h('div',null,toast,h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Načítám kandidáty...'));
  if(!_discoveredData||_discoveredData.error)return _modelLoadFailure(_discoveredData&&_discoveredData.error||'Katalog není dostupný.',_loadDiscoveredData);
  var selection=_filteredCandidates(_discoveredData);var candidates=selection.rows;
  function fCtx(w){if(!w)return'-';return w>=1048576?(w/1048576).toFixed(0)+'M':w>=1024?(w/1024).toFixed(0)+'K':w+'';}
  return h('div',null,toast,_renderDownloads(),
    h('div',{style:{fontSize:_fs(10),color:C.tx3,lineHeight:1.5,marginBottom:12}},
      'VRAM je katalogový odhad. Skutečné umístění na GPU ověří až měření s produkčním kontextem. Katalogová hodnota není skóre kvality.'),
    h('div',{style:{display:'flex',gap:14,flexWrap:'wrap',alignItems:'flex-end',marginBottom:14,padding:12,
      background:C.bg2,border:'1px solid '+C.border,borderRadius:8,fontSize:_fs(10),color:C.tx3}},
      h('label',{style:{display:'flex',flexDirection:'column',gap:5}},'Zobrazit',h('select',{style:_modelFieldStyle(),value:_candidateFilter.fit,onChange:function(e){_candidateFilter.fit=e.target.value;renderCenter();}},
        h('option',{value:'fit'},selection.fitUnavailable?'Všechny · limit VRAM nezjištěn':'V limitu VRAM (odhad)'),h('option',{value:'all'},'Všechny modely'),h('option',{value:'installed'},'Pouze stažené'))),
      h('label',{style:{display:'flex',flexDirection:'column',gap:5}},'Role',h('select',{style:_modelFieldStyle(),value:_candidateFilter.role||'all',onChange:function(e){_candidateFilter.role=e.target.value;renderCenter();}},h('option',{value:'all'},'Všechny role'),['D1','D2','R1','R2','CODE','CHAT','VISION'].map(function(r){return h('option',{key:r,value:r},r); }))),
      h('label',{style:{display:'flex',flexDirection:'column',gap:5}},'Limit VRAM · GiB (odhad)',h('input',{type:'number',min:1,max:512,step:0.5,
        value:_candidateFilter.budgetGiB,placeholder:_discoveredData.vramBudgetMb?(_discoveredData.vramBudgetMb/1024).toFixed(1):'Nezjištěno',
        style:Object.assign({},_modelFieldStyle(),{width:120}),onChange:function(e){_candidateFilter.budgetGiB=e.target.value;renderCenter();}})),
      h('label',{style:{display:'flex',flexDirection:'column',gap:5}},'Řadit podle',h('select',{style:_modelFieldStyle(),value:_candidateFilter.sort,onChange:function(e){_candidateFilter.sort=e.target.value;renderCenter();}},
        h('option',{value:'params-desc'},'Parametry: největší'),h('option',{value:'params-asc'},'Parametry: nejmenší'),
        h('option',{value:'vramMb-asc'},'VRAM: nejnižší'),h('option',{value:'contextWindow-desc'},'Kontext: největší'),h('option',{value:'name-asc'},'Název'),h('option',{value:'releaseDate-desc'},'Vydání: nejnovější'))),
      h('span',{style:{marginLeft:'auto',paddingBottom:7,whiteSpace:'nowrap'}},candidates.length+' / '+(_discoveredData.candidates||[]).length+' modelů')),
    _discoveredData.gpuVramMb>0?h('p',{style:{fontSize:_fs(10),color:C.tx3}},'GPU: '+(_discoveredData.gpuVramMb/1024).toFixed(1)+' GiB dedikované VRAM · zdroj: '+(_discoveredData.gpuCapacitySource||'systém')+' · automatický limit 80 % (rezerva pro kontext a systém).'):null,
    !selection.budgetMb?h('p',{role:'status',style:{color:C.amber}},'Limit VRAM není k dispozici. Katalog zůstává viditelný; vejití modelů na GPU není ověřené. Pro filtrování lze zadat vlastní kladný limit.'):null,
    candidates.length===0?h('div',{style:{color:C.tx4,padding:20,textAlign:'center'}},(_discoveredData.candidates||[]).length?'Zvolenému filtru neodpovídá žádný model.':'Katalog zatím neobsahuje žádné modely.'):
    _modelTable(['Model','Parametry','VRAM · odhad','Kontext','Možné role','Vydání','Akce'],candidates.map(function(m){
      var ps=_downloadState(m.name),pulling=ps&&ps.status&&ps.status!=='done'&&ps.status!=='error';
      var fit=!selection.budgetMb||!(m.vramMb>0)?'Vejití neověřeno':m.vramMb>selection.budgetMb?'Nad limitem':'';
      return h('tr',{key:m.canonicalName||m.name},
        _modelCell(h('div',null,h('strong',null,m.name),h('div',{style:{fontSize:_fs(9),color:C.tx3}},m.installed?'Stažený':'Katalog · kvalita nezměřena'))),
        _modelCell(m.params?m.params+' B':'—'),_modelCell(h('div',null,m.vramMb?(m.vramMb/1024).toFixed(1)+' GiB':'Neznámá',fit?h('div',{style:{color:C.amber}},fit):null)),
        _modelCell(fCtx(m.contextWindow)),_modelCell((m.eligibleRoles||[]).join(' · ')),
        _modelCell(h('div',null,m.releaseDate&&Number.isFinite(Date.parse(m.releaseDate))?new Date(m.releaseDate).toLocaleDateString('cs-CZ'):'Vydání nedoloženo',h('div',{style:{fontSize:_fs(9),color:C.tx3}},m.releaseDateSource?h('a',{href:m.releaseDateSource,target:'_blank',rel:'noreferrer',style:{color:C.accent}},'Zdroj vydání ↗'):m.releaseDate?'Starší katalogový údaj':m.discoveredAt?'Objeveno '+new Date(m.discoveredAt).toLocaleDateString('cs-CZ'):'Zdroj datum neuvádí'))),
        _modelCell(h('div',null,m.installed?h('button',{style:_modelButtonStyle(false,false),onClick:function(){_evaluationRoleFilter='all';_openModelTests(m.name);}},'Testy modelu…'):
          h('button',{style:_modelButtonStyle(true,pulling),disabled:pulling,onClick:function(){_pullModel(m.name);}},pulling?'Stahuji…':'Stáhnout'),
          ps?h('div',{style:{marginTop:5,color:ps.status==='error'?C.red:C.tx3}},ps.text):null)));
    })));
}

var _evaluationRoleFilter='all',_roleChoices={},_assignmentMessage=null,_qualityExpanded={};
var _modelSorts={roles:{col:'role',dir:1},quality:{col:'score',dir:-1},history:{col:'testedAt',dir:-1}},_historyDetails={},_historyExpanded={};
function _modelSortHeader(scope,col,label){
  var sort=_modelSorts[scope],active=sort.col===col;
  return h('button',{'aria-label':'Řadit: '+label,style:{font:'inherit',fontWeight:600,color:active?C.accent:C.tx3,background:'none',border:0,padding:0,cursor:'pointer'},onClick:function(){
    if(active)sort.dir=-sort.dir;else{sort.col=col;sort.dir=col==='score'||col==='testedAt'||col==='durationMs'?-1:1;}renderCenter();
  }},label+(active?(sort.dir===1?' ▲':' ▼'):' ↕'));
}
function _sortModelRows(rows,scope){
  var sort=_modelSorts[scope];return rows.slice().sort(function(a,b){
    var av=a[sort.col],bv=b[sort.col];
    if(sort.col==='score'){av=a.status==='COMPLETE'?a.score:null;bv=b.status==='COMPLETE'?b.score:null;}
    if(av==null||bv==null)return av==null&&bv==null?0:av==null?1:-1;
    return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'cs'))*sort.dir;
  });
}
function _modelTable(headers,rows){
  return h('div',{style:{overflowX:'auto',border:'1px solid '+C.border,borderRadius:8,marginBottom:14}},
    h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:_fs(11),textAlign:'left'}},
      h('thead',{style:{background:C.bg2,color:C.tx3}},h('tr',null,headers.map(function(v,i){return h('th',{key:i,style:{padding:'10px 12px',fontWeight:600,whiteSpace:'nowrap'}},v);}))),
      h('tbody',null,rows)));
}
function _modelCell(value,props){return h('td',Object.assign({style:{padding:'9px 12px',borderTop:'1px solid '+_rgba(C.tx1,0.22),verticalAlign:'top'}},props||{}),value);}
function _modelScore(row){return row&&row.status==='COMPLETE'&&Number.isFinite(row.score)?(row.score*100).toFixed(1)+' %':'—';}
function _modelStatus(row){return row.applicable===false?'Mimo roli':({COMPLETE:'Změřeno',MISSING:'Nezměřeno',FAILED:'Test selhal',BLOCKED:'Blokováno'}[row.status]||row.status);}
function _taskLabel(task,rd){var d=(rd.tasks||[]).find(function(t){return t.name===task.name;});return d?d.label:task.name.replace(/_/g,' ');}
function _taskResultNotes(t){
  var notes=[];
  (t.details||[]).forEach(function(d){
    if(!d)return;
    if(d.reason)notes.push(d.reason);
    if(d.schema===false)notes.push('Neodpovídá požadovaný formát JSON');
    if(d.syntaxOk===false)notes.push('Neplatná syntaxe kódu');
    if(d.applied===false)notes.push('Opravu nelze použít');
    if(Number.isFinite(d.targeted))notes.push('Úspěšné cílové testy: '+(d.targetedPassed||0)+'/'+d.targeted);
    if(d.regressions)notes.push('Nové regrese: '+d.regressions);
    var parts=d.parts||[];
    if(parts.length)notes.push('Splněné kontroly: '+parts.filter(function(x){return x.ok;}).length+'/'+parts.length);
    var failed=parts.filter(function(x){return !x.ok;}).map(function(x){return x.id;});
    if(failed.length)notes.push('Nesplněno: '+failed.join(', '));
    if((d.penalties||[]).length)notes.push('Srážky: '+d.penalties.map(function(x){return x.id;}).join(', '));
  });
  return Array.from(new Set(notes));
}
function _qualityDetail(row,rd){
  var tasks=row.tasks||[],catalogs=row.taskCatalog||rd.tasks||[];
  return h('div',{'data-testid':'model-task-detail',style:{padding:'4px 0 12px'}},
    h('strong',null,row.model+' · výsledky '+tasks.length+' úloh'),
    h('p',{style:{color:C.tx3}},'Skóre '+_modelScore(row)+' = průměr '+tasks.length+' úloh, každá má stejnou váhu. '+(row.repeats||rd.repeats||'?')+' opakování na úlohu'+(row.durationMs!=null?' · měření '+_huntDuration(row.durationMs):'')+'.'),
    h('p',{style:{color:C.tx3}},row.suiteName==='code_patch'||rd.suiteName==='code_patch'?'Tato sada měří konkrétní opravy JavaScriptu, nikoli dokončení celého projektu. Každá oprava se ověří spuštěním testů; regrese vynuluje výsledek úlohy. Délka běhu není cílem testu.':'Výsledek platí pro tuto sadu úloh. Shoda opakování neprokazuje pokrytí všech schopností modelu.'),
    row.catalogMatchesContract===false?h('p',{style:{color:C.amber}},'Historická verze sady: dnešní popisy testů se na ni nepřenášejí. Níže jsou tehdy uložené výsledky a kritéria.'):null,
    _modelTable(['Druh testu / úloha','Skóre','Výsledek'],tasks.map(function(t){
      var catalog=catalogs.find(function(c){return c.name===t.name;})||{},requirements=catalog.requirements||t.rubric||[],notes=_taskResultNotes(t);
      var label=catalog.label||t.name.replace(/_/g,' ');
      return h('tr',{key:t.name},
        _modelCell(h('div',{style:{maxWidth:520}},h('div',{style:{fontSize:_fs(9),color:C.tx3,marginBottom:4}},catalog.type||row.suiteName||rd.suiteName),
          h('strong',null,label),h('details',{style:{marginTop:7,fontSize:_fs(10)}},
            h('summary',{'aria-label':'Informace o testu: '+label,style:{cursor:'pointer',color:C.accent}},'ⓘ Jak se test hodnotí'),
            catalog.source?h('p',null,'Zdroj úlohy: '+catalog.source):null,
            catalog.context?h('p',null,catalog.context):null,
            requirements.length?h('ul',{style:{paddingLeft:18,lineHeight:1.6}},requirements.map(function(r,i){return h('li',{key:i},typeof r==='string'?r:r.label||r.name||JSON.stringify(r));})):h('p',null,'Popis kritérií v tomto měření nebyl uložen.'),
            h('p',{style:{color:C.tx3}},'Opakování: '+(t.scores||[]).map(function(v){return (v*100).toFixed(1)+' %';}).join(' / ')),h('code',null,t.name)))),
        _modelCell(h('strong',{style:{color:t.mean>=.8?C.success:t.mean<.5?C.amber:C.tx1,whiteSpace:'nowrap'}},(t.mean*100).toFixed(1)+' %')),
        _modelCell(notes.length?h('ul',{style:{margin:0,paddingLeft:17,lineHeight:1.5,maxWidth:320}},notes.map(function(n,i){return h('li',{key:i},n);})):h('span',{style:{color:C.tx3}},'Podrobné vyhodnocení nebylo uloženo.')));
    })));
}
function _modelResultBullets(tasks,rd){
  var selected=tasks.slice().sort(function(a,b){return b.mean-a.mean;});
  var strong=selected.filter(function(t){return t.mean>=.8;}),weak=selected.filter(function(t){return t.mean<.5;}).reverse();
  function group(list,label,color){return list.length?h('div',null,h('span',{style:{color:color,fontSize:_fs(9)}},label),h('ul',{style:{paddingLeft:17,margin:'4px 0 8px',lineHeight:1.6}},list.slice(0,3).map(function(t){return h('li',{key:t.name},_taskLabel(t,rd)+' · '+Math.round(t.mean*100)+' %');}),list.length>3?h('li',{style:{color:C.tx3}},'Další '+(list.length-3)+' v detailu'):null)):null;}
  return h('div',{style:{maxWidth:330,fontSize:_fs(10)}},group(strong,'Silnější výsledky',C.success),group(weak,'Slabší výsledky',C.amber),!strong.length&&!weak.length?h('span',null,'Výsledky jsou mezi 50 a 80 %; rozpad je v detailu.'):null);
}
function _loadHistoricalRun(runId){
  _historyExpanded[runId]=!_historyExpanded[runId];renderCenter();
  if(!_historyExpanded[runId]||(_historyDetails[runId]&&!_historyDetails[runId].error))return;
  _historyDetails[runId]={loading:true};
  return _readModelResource('/api/system/models/evaluations/'+encodeURIComponent(runId),function(d){_historyDetails[runId]=d;},function(e){_historyDetails[runId]={error:e};},function(){renderCenter();});
}

function _renderEvaluationsTab(){
  if(_evaluationData&&_evaluationData.error)return _modelLoadFailure(_evaluationData.error,_loadEvaluationData);
  if(!_evaluationData)return h('p',null,_evaluationLoading?'Načítám výsledky…':'Výsledky nejsou dostupné.');
  var roles=_evaluationData.roles||{};
  return h('div',{'data-testid':'model-quality'},
    h('label',{style:{display:'flex',gap:10,alignItems:'center',marginBottom:16}},'Role',h('select',{style:_modelFieldStyle(),value:_evaluationRoleFilter,onChange:function(e){_evaluationRoleFilter=e.target.value;renderCenter();}},
      h('option',{value:'all'},'Všechny role'),Object.keys(roles).map(function(role){return h('option',{key:role,value:role},role);}))),
    Object.keys(roles).filter(function(role){return _evaluationRoleFilter==='all'||role===_evaluationRoleFilter;}).map(function(role){
      var rd=roles[role],rows=(rd.artifacts||[]).filter(function(a){return a.applicable!==false&&(!_evaluationModelFilter||_canonicalModelIdentity(a.model)===_canonicalModelIdentity(_evaluationModelFilter));})
        ;rows=_sortModelRows(rows,'quality');
      return h('section',{key:role,style:{marginBottom:26}},
        h('h3',{style:{fontSize:_fs(14)}},role+' · '+rd.suiteName),
        h('p',{style:{color:C.tx3,fontSize:_fs(11)}},'Aktuální model: '+(rd.binding||'nepřiřazen')+' · změřeno '+rows.filter(function(a){return a.status==='COMPLETE';}).length+'/'+rows.length+' místních modelů · '+rd.taskCount+' úloh × '+rd.repeats+' opakování · silné úlohy ≥ 80 %, slabé < 50 %'),
        _modelTable([_modelSortHeader('quality','model','Model'),_modelSortHeader('quality','score','Skóre'),'Výsledky','Detail','Akce'],rows.flatMap(function(row){
          var tasks=row.tasks||[];
          var key=role+'|'+row.model,expanded=!!_qualityExpanded[key];
          var main=h('tr',{key:row.model,style:{background:row.isCurrentBinding?C.accentBg:undefined}},
            _modelCell(h('div',null,h('strong',null,row.model),row.isCurrentBinding?h('div',{style:{color:C.accent,fontSize:_fs(9)}},'Aktuálně přiřazený'):null,
              h('div',{style:{color:row.status==='COMPLETE'?C.success:C.tx3}},_modelStatus(row)),_modelTestFeedback(row.model,role))),
            _modelCell(h('div',null,h('strong',null,_modelScore(row)),row.status==='COMPLETE'&&Number.isFinite(row.passed)&&Number.isFinite(row.total)?h('div',{style:{color:C.tx3}},row.passed+'/'+row.total+' úloh nad prahem'):null)),
            _modelCell(tasks.length?_modelResultBullets(tasks,rd):row.status==='COMPLETE'?'Chybí podrobnosti výsledku':'Čeká na měření'),
            _modelCell(tasks.length?h('button',{style:_modelButtonStyle(false,false),'aria-expanded':expanded,onClick:function(){_qualityExpanded[key]=!expanded;renderCenter();}},(expanded?'Skrýt detail':'Výsledky '+tasks.length+' úloh')):'—'),_modelCell(h('button',{style:_modelButtonStyle(false,_modelTestPending),disabled:_modelTestPending,onClick:function(){_testInstalledModel(row.model,role);}},'Nový test')));
          return expanded?[main,h('tr',{key:key+'-detail'},h('td',{colSpan:5,style:{padding:14,borderTop:'1px solid '+C.border,background:C.bg2}},_qualityDetail(row,rd)))]:[main];
        })),
        h('details',null,h('summary',{style:{cursor:'pointer',color:C.accent}},'Matice výsledků jednotlivých úloh'),
          _modelTable(['Model'].concat((rd.tasks||[]).map(function(t){return h('span',{title:t.label},t.label);})),rows.filter(function(row){return row.status==='COMPLETE';}).map(function(row){return h('tr',{key:row.model},_modelCell(row.model),(rd.tasks||[]).map(function(t){var result=(row.tasks||[]).find(function(x){return x.name===t.name;});return _modelCell(result?Math.round(result.mean*100)+' %':'—',{key:t.name,title:result?'Rozdíl opakování: '+Math.round(result.spread*100)+' bodů':'Chybí detail',style:{padding:10,borderTop:'1px solid '+C.border,color:result&&result.mean>=0.8?C.success:C.amber}});}));})))
      );
    }));
}
function _renderEvaluationHistory(){
  if(_evaluationData&&_evaluationData.error)return _modelLoadFailure(_evaluationData.error,_loadEvaluationData);
  if(!_evaluationData)return h('p',null,'Načítám historii měření…');
  var data=_evaluationData||{},rows=_sortModelRows(data.history||[],'history');
  return h('div',null,h('h3',{style:{fontSize:_fs(13)}},'Měření modelů · posledních '+rows.length),
    _modelTable([_modelSortHeader('history','testedAt','Dokončeno'),_modelSortHeader('history','model','Model / role'),_modelSortHeader('history','score','Výsledek'),_modelSortHeader('history','durationMs','Délka'),'Ollama','Detail měření'],rows.flatMap(function(r){
      var expanded=!!_historyExpanded[r.runId],detail=_historyDetails[r.runId];
      var main=h('tr',{key:r.runId},
      _modelCell(r.testedAt?new Date(r.testedAt).toLocaleString('cs-CZ'):'Nezaznamenáno'),_modelCell(h('div',null,r.model+' · '+r.role,h('div',{style:{color:C.tx3}},r.suiteName))),
      _modelCell(h('div',null,_modelStatus(r)+' · '+_modelScore(r),r.current?h('div',{style:{color:C.success}},'Aktuální výsledek'):null,r.errorMessage?h('div',null,r.errorMessage):null)),
      _modelCell(r.durationMs!=null?_huntDuration(r.durationMs):'Neověřený interval'),_modelCell(r.providerVersion||'Nezaznamenána'),
      _modelCell(h('button',{style:_modelButtonStyle(false,false),'aria-expanded':expanded,onClick:function(){_loadHistoricalRun(r.runId);}},expanded?'Skrýt měření':'Detail měření')));
      if(!expanded)return [main];
      return [main,h('tr',{key:r.runId+'-detail'},h('td',{colSpan:6,style:{padding:16,background:C.bg2}},
        !detail||detail.loading?h('p',null,'Načítám toto měření…'):detail.error?_modelLoadFailure(detail.error,function(){_historyExpanded[r.runId]=false;_loadHistoricalRun(r.runId);}):h('div',null,
          detail.tasks&&detail.tasks.length?_qualityDetail(detail,{suiteName:detail.suiteName,tasks:detail.taskCatalog}):h('p',null,'Měření nemá výsledky úloh. '+(detail.errorMessage||'')),
          h('details',null,h('summary',{style:{cursor:'pointer'}},'Identita měření'),h('p',null,r.runId),h('p',null,'Artefakt: '+r.digestSha256),h('p',null,'Kontrakt: '+r.suiteContractSha256)))) )];
    })),
    h('h3',{style:{fontSize:_fs(13)}},'Porovnání rolí'),_modelTable(['Kdy','Role','Porovnání','Výsledek'],(data.decisions||[]).slice(0,50).map(function(d){return h('tr',{key:d.decisionId},_modelCell(new Date(d.createdAt).toLocaleString('cs-CZ')),_modelCell(d.role),_modelCell(d.incumbentModel+' → '+d.candidateModel),_modelCell(({CANDIDATE:'Lepší kandidát',INCUMBENT:'Zůstává současný',INCONCLUSIVE:'Nedostatečný důkaz'}[d.outcome]||d.outcome)+(!d.actionable?' · historické / nelze přímo použít':' · lze ručně přiřadit')));})));
}

/* ═══════════════════════════════════════════════════════════
   v133: MODEL OVERVIEW + ROLES TABS
   ═══════════════════════════════════════════════════════════ */
function _renderOverviewTab(){
  if(_modelOverview&&_modelOverview.error)return _modelLoadFailure(_modelOverview.error,_loadModelOverview);
  if(_modelOverviewLoading&&!_modelOverview)return h('div',{style:{color:C.tx3,padding:20,textAlign:'center'}},'Na\u010D\u00EDt\u00E1m p\u0159ehled...');
  if(!_modelOverview)return h('div',{style:{color:C.tx4,padding:20,textAlign:'center'}},'Nelze na\u010D\u00EDst p\u0159ehled model\u016F');
  var ov=_modelOverview;var mods=ov.models||[];
  var du=ov.diskUsage||{};var ac=ov.autoCleanup||{enabled:false,days:14};
  /* Sort */
  var sorted=mods.slice().sort(function(a,b){
    var c=_overviewSort.col;var d=_overviewSort.dir==='asc'?1:-1;
    if(c==='name')return a.name.localeCompare(b.name)*d;
    if(c==='size')return((a.size||0)-(b.size||0))*d;
    if(c==='score')return((a.evaluatedRoleCount||0)-(b.evaluatedRoleCount||0))*d;
    if(c==='roles')return((a.boundRoles||[]).length-(b.boundRoles||[]).length)*d;
    return 0;
  });
  function sortBtn(col,label){
    var active=_overviewSort.col===col;
    return h('th',{style:{padding:'6px 8px',textAlign:col==='name'?'left':'right',cursor:'pointer',fontSize:_fs(10),fontWeight:600,color:active?C.accent:C.tx3,
      background:active?_rgba(C.accent,0.07):'transparent',borderBottom:'2px solid '+(active?C.accent:C.border),userSelect:'none'},
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
        sortBtn('score','Evaluace'),
        h('th',{style:{padding:'6px 8px',textAlign:'center',fontSize:_fs(10),fontWeight:600,color:C.tx3,borderBottom:'2px solid '+C.border}},'Akce'))),
      h('tbody',null,sorted.map(function(m){
        var evalCount=m.evaluatedRoleCount||0;var scorePct=evalCount+'/7';
        var scoreColor=evalCount===7?C.accent:evalCount>0?'#eab308':C.tx4;
        return h('tr',{key:m.name,style:{borderBottom:'1px solid '+C.border}},
          h('td',{style:{padding:'6px 8px',color:C.tx1,fontFamily:C.mono,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},
            m.name,
            h('div',{style:{fontSize:_fs(9),color:C.tx4}},m.paramsLabel||(m.params!=null?m.params+'B':'?'))),
          h('td',{style:{padding:'6px 8px',textAlign:'right',color:C.tx4,fontSize:_fs(9)}},m.quantization||'?'),
          h('td',{style:{padding:'6px 8px',textAlign:'right',color:C.tx2}},m.sizeGB+' GB'),
          h('td',{style:{padding:'6px 8px',textAlign:'right'}},
            m.boundRoles.length>0?m.boundRoles.map(function(r){
              var rp={D1:'#8b5cf6',D2:'#a78bfa',CODE:'#22c55e',R1:'#6366f1',R2:'#818cf8',CHAT:'#3b82f6',VISION:'#f59e0b'};
              return h('span',{key:r,style:{display:'inline-block',padding:'1px 5px',borderRadius:3,fontSize:_fs(9),fontWeight:600,
                background:'rgba(0,0,0,0.15)',color:rp[r]||C.tx3,marginLeft:2}},r);
            }):h('span',{style:{color:C.tx4}},'\u2014')),
          h('td',{style:{padding:'6px 8px',textAlign:'right'}},
            h('span',{style:{fontWeight:600,color:scoreColor},title:(m.missingEvaluationRoles||[]).join(', ')},scorePct)),
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
  var ov=_modelOverview||{},roles=(_evaluationData||{}).roles||{},profiles=ov.profiles||{};
  if(_evaluationData&&_evaluationData.error)return _modelLoadFailure(_evaluationData.error,_loadEvaluationData);
  if(!Object.keys(roles).length)return h('p',null,_evaluationLoading?'Načítám role…':'Žádné role nejsou dostupné.');
  return h('div',{'data-testid':'model-roles'},
    h('p',{style:{color:C.tx3,fontSize:_fs(11)}},'Porovnání používá aktuální testy dané role. Pořadí skóre samo nemění přiřazení. Další model můžeš otestovat bez přepínání role.'),
    _evaluationData.bindingAuthority&&_evaluationData.bindingAuthority.status!=='DURABLE'?h('p',{role:'alert',style:{color:C.amber}},'Přiřazení modelů není plně ověřené. Zobrazená skóre nepotvrzují aktivní runtime. ',h('span',null,_evaluationData.bindingAuthority.reason||_evaluationData.bindingAuthority.status)):null,
    _assignmentMessage?h('p',{role:'status'},_assignmentMessage):null,
    _modelTable([_modelSortHeader('roles','role','Role a účel'),_modelSortHeader('roles','model','Aktuální model'),_modelSortHeader('roles','score','Skóre'),'Další místní modely · top 2','Ovládání'],_sortModelRows(Object.keys(roles).map(function(role){var bound=(roles[role].artifacts||[]).find(function(a){return a.isCurrentBinding;})||{};return {role:role,model:roles[role].binding,score:bound.score,status:bound.status};}),'roles').map(function(item){var role=item.role;
      var rd=roles[role],p=profiles[role]||{},current=rd.binding,rows=(rd.artifacts||[]).filter(function(a){return a.applicable!==false;}),bound=rows.find(function(a){return a.isCurrentBinding;});
      var alternatives=rows.filter(function(a){return !a.isCurrentBinding&&a.status==='COMPLETE';}).sort(function(a,b){return b.score-a.score;}).slice(0,2);
      return h('tr',{key:role},_modelCell(h('div',null,h('strong',{style:{color:C.accent}},role),h('div',null,p.name||rd.suiteName))),
        _modelCell(h('div',null,current||'Nepřiřazen',h('div',{style:{color:C.tx3,fontSize:_fs(10)}},bound?_modelStatus(bound):'Model není v místním inventáři'))),_modelCell(_modelScore(bound)),
        _modelCell(alternatives.length?alternatives.map(function(a,i){return h('div',{key:a.model,style:{display:'grid',gridTemplateColumns:'18px minmax(140px,1fr) 56px',gap:8,alignItems:'start',padding:'6px 0',borderBottom:i===0?'1px solid '+_rgba(C.tx1,.18):'none'}},h('span',{style:{color:C.tx3}},(i+1)+'.'),h('button',{title:'Zobrazit testy pro '+role,style:{font:'inherit',textAlign:'left',overflowWrap:'anywhere',background:'none',border:0,padding:0,color:C.accent,cursor:'pointer'},onClick:function(){_evaluationRoleFilter=role;_evaluationModelFilter=a.model;_qualityExpanded[role+'|'+a.model]=true;_upgradeTab='evaluations';renderCenter();}},a.model),h('strong',{style:{textAlign:'right',whiteSpace:'nowrap'}},_modelScore(a)));}):'Zatím nejsou další změřené modely'),
        _modelCell(h('div',{style:{display:'flex',gap:6,flexWrap:'wrap',maxWidth:420}},
          h('button',{style:_modelButtonStyle(false,false),onClick:function(){_evaluationModelFilter='';_evaluationRoleFilter=role;_upgradeTab='evaluations';_loadEvaluationData();renderCenter();}},'Kvalita a testy'),
          bound?h('button',{style:_modelButtonStyle(false,_modelTestPending),disabled:_modelTestPending,onClick:function(){_testInstalledModel(current,role);}},'Nový test'):null,
          h('select',{style:Object.assign({},_modelFieldStyle(),{maxWidth:220}),value:_roleChoices[role]||'',onChange:function(e){_roleChoices[role]=e.target.value;renderCenter();}},
            h('option',{value:''},'Zvolit jiný model…'),rows.filter(function(a){return !a.isCurrentBinding;}).map(function(a){return h('option',{key:a.model,value:a.model},a.model+' · '+_modelScore(a));})),
          h('button',{style:_modelButtonStyle(false,!_roleChoices[role]||!!_assigningRole),disabled:!_roleChoices[role]||!!_assigningRole,onClick:function(){_assignModel(role,_roleChoices[role]);}},'Přiřadit'),
          _modelTestFeedback(current,role))));
    })));
}
function centerUpgrades(){
  if(!_modelsDisconnected){
  if(_upgradeTab==='overview'&&!_modelOverview&&!_modelOverviewLoading)_loadModelOverview();
  if(_upgradeTab==='roles'&&!_modelOverview&&!_modelOverviewLoading)_loadModelOverview();
  if(_upgradeTab==='roles'&&!_installedModels&&!_installedLoading)_loadInstalledModels();
  if(!_upgradeData&&!_upgradeLoading)_loadUpgradeData();
  if(['evaluations','history','roles'].includes(_upgradeTab)&&!_evaluationData&&!_evaluationLoading)_loadEvaluationData();
  if(_upgradeTab==='evaluations'&&!_installedModels&&!_installedLoading)_loadInstalledModels();
  if(_upgradeTab==='discovered'&&!_discoveredData&&!_discoveredLoading)_loadDiscoveredData();
  }
  var history=_upgradeData&&_upgradeData.history?_upgradeData.history:[];
  var lastCheck=_upgradeData&&_upgradeData.lastCheckTime?new Date(_upgradeData.lastCheckTime).toLocaleString('cs-CZ'):null;
  var tabStyle=function(t){return{background:_upgradeTab===t?C.accent:'transparent',color:_upgradeTab===t?C.onAccent:C.tx3,
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
      h('button',{style:tabStyle('evaluations'),onClick:function(){_upgradeTab='evaluations';_loadEvaluationData();renderCenter();}},'Evaluace'),
      h('button',{style:tabStyle('hunt'),onClick:function(){_upgradeTab='hunt';_loadHuntStatus();renderCenter();}},'GPU hunt'),
      h('button',{style:tabStyle('history'),onClick:function(){_upgradeTab='history';renderCenter();}},'Historie'),
      h('button',{style:tabStyle('discovered'),onClick:function(){_upgradeTab='discovered';renderCenter();}},'Kandid\u00E1ti'),
      h('button',{style:tabStyle('governor'),onClick:function(){_upgradeTab='governor';_governorData=null;_loadGovernorData();renderCenter();}},'Spr\u00E1vce')),
    /* toast */
    _upgradeMsg?h('div',{style:{margin:'0 18px',marginTop:12,padding:'8px 14px',borderRadius:6,fontSize:_fs(11),fontWeight:600,
      background:_upgradeMsg.ok?C.successBg:C.redBg,
      color:_upgradeMsg.ok?C.success:C.red,
      border:'1px solid '+(_upgradeMsg.ok?_rgba(C.success,0.25):_rgba(C.red,0.25))}},_upgradeMsg.text):null,
    /* 022/A: verification failure. The warning always shows; the action exists
       only with the complete exact identity, and only after confirmation. */
    _verifyFailure?h('div',{style:{margin:'0 18px',marginTop:8,padding:'10px 14px',borderRadius:6,fontSize:_fs(11),
      background:'rgba(239,68,68,0.08)',color:'#ef4444',border:'1px solid rgba(239,68,68,0.25)',
      display:'flex',alignItems:'center',gap:10}},
      h('span',{style:{flex:1}},_verifyFailure.text),
      _verifyFailure.identity?(_rollbackConfirm
        ?h('span',{style:{display:'flex',gap:8,alignItems:'center'}},
          h('span',null,'Vr\u00E1tit '+_verifyFailure.identity.role+' na p\u0159edchoz\u00ED model?'),
          h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid #ef4444',background:'#ef4444',
            color:'#fff',cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
            onClick:function(){_rollbackBinding(_verifyFailure.identity);}},
            _rollbackInFlight?'Vrac\u00EDm...':'Potvrdit'),
          h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid rgba(239,68,68,0.3)',
            background:'transparent',color:'#ef4444',cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
            onClick:function(){_rollbackConfirm=false;renderCenter();}},'Zru\u0161it'))
        :h('button',{style:{padding:'4px 12px',borderRadius:4,border:'1px solid #ef4444',background:'transparent',
          color:'#ef4444',cursor:'pointer',fontSize:_fs(10),fontFamily:C.font},
          onClick:function(){_rollbackConfirm=true;renderCenter();}},'Rollback')):null):null,
    _modelTestMessage&&_upgradeTab==='hunt'?h('div',{role:_modelTestFailed?'alert':'status',style:{margin:'12px 18px 0',padding:'8px 12px',borderRadius:6,
      border:'1px solid '+C.border2,fontSize:_fs(11),lineHeight:1.5,background:_modelTestFailed?C.redBg:C.bg3,color:_modelTestFailed?C.red:C.tx2}},_modelTestMessage):null,
    /* body */
    h('div',{key:_upgradeTab,'data-testid':'model-tab-body',style:{flex:1,overflowY:'auto',padding:18}},
      _modelsDisconnected?_modelLoadFailure('Spojení s backendem je přerušené. Čekám na obnovení; uložená skóre ani historie se nemažou.',_retryModelConnection):h(React.Fragment,null,
      /* ── Overview tab (v133) ── */
      _upgradeTab==='overview'?_renderOverviewTab():null,
      _upgradeTab==='hunt'?_renderHuntTab():null,
      /* ── Roles tab (v133) ── */
      _upgradeTab==='roles'?_renderRolesTab():null,
      /* ── Exact-contract evaluations tab ── */
      _upgradeTab==='evaluations'?h('div',null,
        h('div',{style:{display:'flex',alignItems:'center',gap:12,marginBottom:12}},
          h('button',{disabled:_evaluationLoading,onClick:function(){_loadEvaluationData();renderCenter();},
            style:_modelButtonStyle(false,_evaluationLoading)},_evaluationLoading?'Načítám…':'Obnovit scoring'),
          h('span',{style:{fontSize:_fs(10),color:C.tx3}},
            _evaluationData&&_evaluationData.generatedAt?'Data k '+new Date(_evaluationData.generatedAt).toLocaleString('cs-CZ'):'')),
        _evaluationModelFilter?h('div',{style:{display:'flex',alignItems:'center',gap:10,marginBottom:12,fontSize:_fs(11),color:C.tx2}},'Model: '+_evaluationModelFilter+' ',h('button',{style:_modelButtonStyle(false,false),onClick:function(){_evaluationModelFilter='';renderCenter();}},'Všechny modely')):null,
        h('p',{style:{fontSize:_fs(11),color:C.tx3,lineHeight:1.5}},'Chybí aktuální test = model je stažený, ale nemá měření pro tuto sadu a verzi Ollamy. Nový test vždy provede nové měření. Podrobnosti času, verze a historie najdeš v Historii.'),
        _renderEvaluationsTab()):null,

      /* ── History tab ── */
      _upgradeTab==='history'?h('div',null,_renderEvaluationHistory(),
        history.length>0?h('div',null,
          h('div',{style:{fontSize:_fs(13),fontWeight:700,color:C.tx1,marginBottom:10}},'Historie upgradů'),
          history.slice(0,20).map(function(hi,i){
            var ts=hi.timestamp||hi.created_at?new Date(hi.timestamp||hi.created_at).toLocaleString('cs-CZ'):'?';
            var isRollback=hi.action==='rollback';
            return h('div',{key:i,style:{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid '+C.border,fontSize:_fs(11)}},
              h('span',{style:{color:C.tx4,minWidth:120}},ts),
              h('span',{style:{background:isRollback?C.redBg:C.successBg,color:isRollback?C.red:C.success,borderRadius:4,padding:'1px 6px',fontSize:_fs(9),fontWeight:600}},isRollback?'ROLLBACK':'UPGRADE'),
              h('span',{style:{fontWeight:600,color:C.tx2}},hi.role),
              h('span',{style:{color:C.tx3,fontFamily:C.mono}},hi.fromModel||hi.from_model||'?'),
              h('span',{style:{color:C.tx4}},'\u2192'),
              h('span',{style:{color:C.tx1,fontFamily:C.mono}},hi.toModel||hi.to_model||'?'));
          })):
          h('div',{style:{textAlign:'center',padding:'40px 20px',color:C.tx4,fontSize:_fs(12)}},'Žádná historie upgradů')):null,
      /* ── Discovered tab ── */
      _upgradeTab==='discovered'?_renderDiscoveredTab():null,
      /* ── Governor tab (v135) ── */
      _upgradeTab==='governor'?_renderGovernorTab():null)));
}
/* ── v135: Governor data loading + rendering ───────────────────────── */
var _governorError=null;
function _loadGovernorData(){
  if(_governorLoading)return;_governorLoading=true;_governorError=null;
  var epoch=_modelReadEpoch;
  return Promise.all(['/api/system/governor/report','/api/system/governor/proposals'].map(function(path){
    return fetch(_backendUrl()+path,{signal:AbortSignal.timeout(10000)}).then(function(r){if(!r.ok)throw new Error('Správce: HTTP '+r.status);return r.json();});
  })).then(function(res){if(epoch===_modelReadEpoch){_governorData=res[0];_governorProposals=res[1].proposals||[];}})
    .catch(function(e){if(epoch===_modelReadEpoch)_governorError=_modelReadError(e);})
    .finally(function(){if(epoch===_modelReadEpoch){_governorLoading=false;renderCenter();}});
}
function _runGovernorCheck(){
  if(_governorLoading)return;_governorLoading=true;_governorError=null;renderCenter();
  return fetch(_backendUrl()+'/api/system/governor/check',{method:'POST',signal:AbortSignal.timeout(15000)})
    .then(function(r){if(!r.ok)throw new Error('Kontrola Správce: HTTP '+r.status);return r.json();})
    .then(function(d){_governorData=d;_governorLoading=false;return _loadGovernorData();})
    .catch(function(e){_governorError=_modelReadError(e);_governorLoading=false;renderCenter();});
}
var _governorActionMessage=null,_governorActionPending=false;
function _governorProposalAction(id,action){
  if(_governorActionPending)return;
  _governorActionPending=true;_governorActionMessage=null;renderCenter();
  fetch(_backendUrl()+'/api/system/governor/proposals/'+id+'/'+action,{method:'POST',signal:AbortSignal.timeout(15000)})
    .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Akce se nezdařila');return d;});})
    .then(function(d){_governorActionMessage=d.message||(action==='approve'?'Doporučení přijato. Navrženou úpravu je potřeba provést ručně.':'Doporučení zamítnuto.');_loadGovernorData();})
    .catch(function(e){_governorActionMessage='Chyba: '+e.message;})
    .finally(function(){_governorActionPending=false;renderCenter();});
}
function _approveGovernorProposal(id){_governorProposalAction(id,'approve');}
function _dismissGovernorProposal(id){_governorProposalAction(id,'dismiss');}
function _renderGovernorTab(){
  if(_governorError)return _modelLoadFailure(_governorError,_loadGovernorData);
  if(!_governorData)return h('p',null,_governorLoading?'Načítám data Správce…':'Provozní diagnostika ještě nebyla načtena.');
  var report=_governorData,dimensions=report&&report.dimensions||{},proposals=_governorProposals||[];
  var labels={models:'Provoz modelů',cre:'Směrování požadavků (CRE)',architecture:'Architektura',builds:'Buildy',specialists:'Specialisté',upgrades:'Pokrytí rolí měřením'};
  var explanations={models:'Zaznamenaná volání a výsledky provozních úloh za 30 dní; benchmarky jsou v Evaluaci.',
    cre:'Výsledek zpracování požadavků a ruční opravy směrování za 7 dní. Není to přesnost klasifikátoru.',
    architecture:'Poslední zaznamenaná kontrola odchylek architektury, vrstev a cyklických závislostí.',
    builds:'Výsledky testů změn projektu, případně zaznamenaná kvalita buildů za 30 dní.',
    specialists:'Úspěšné výsledky nástrojů specialistů za 7 dní.',upgrades:'Pokrytí přiřazených rolí uloženým měřením.'};
  var known=Object.values(dimensions).filter(function(d){return d.collectorStatus==='READY';}).length;
  var status={UNKNOWN:'Chyba sběru',NO_ACTIVITY:'Zatím bez aktivity',OBSERVED:'Sběr běží',INCOMPLETE:'Neúplné výsledky',HEALTHY:'V pořádku',DEGRADED:'Zhoršený',CRITICAL:'Vyžaduje pozornost'};
  var pending=proposals.filter(function(p){return p.status==='pending'||p.status==='PENDING';});
  return h('div',{'data-testid':'model-governor'},
    h('div',{style:{display:'flex',alignItems:'center',gap:12}},h('h3',{style:{flex:1}},'Provozní diagnostika'),
      h('button',{style:_modelButtonStyle(false,_governorLoading),disabled:_governorLoading,onClick:_runGovernorCheck},'Zkontrolovat')),
    h('p',{style:{color:C.tx3}},'Správce sleduje provoz aplikace. Kvalitu modelů porovnávej v Evaluaci. Zdroje ověřeny: '+known+' / '+Object.keys(labels).length+'. Bez aktivity se skóre nevymýšlí.'),
    _governorActionMessage?h('p',{role:'status',style:{color:C.accent}},_governorActionMessage):null,
    _modelTable(['Oblast','Stav','Hodnota','Co se měří'],Object.keys(labels).map(function(key){var d=dimensions[key];var unknown=!d||d.status==='UNKNOWN';return h('tr',{key:key},
      _modelCell(labels[key]),_modelCell(unknown?'Chyba sběru':status[d.status]||d.status),_modelCell(!d||!Number.isFinite(d.score)?'—':Math.round(d.score*100)+' %'),
      _modelCell(h('div',null,explanations[key],d&&d.details?h('div',{style:{color:C.tx3,marginTop:6}},d.details.note||'',d.details.requests!=null?' · volání '+d.details.requests:'',d.details.outcomes!=null?' · doložené výsledky '+d.details.success+'/'+d.details.outcomes:'',d.details.unrecorded_outcomes?' · bez výsledku '+d.details.unrecorded_outcomes:'',d.details.total!=null?' · záznamů '+d.details.total:'',d.details.tested!=null?' · testy '+d.details.passed+'/'+d.details.tested:'',d.details.current_evaluation_complete!=null?' · změřeno '+d.details.current_evaluation_complete+'/7 rolí':'',d.details.source?h('div',null,'Zdroj: '+d.details.source):null):null)));
    })),
    h('h3',null,'Doporučení'),h('p',{style:{color:C.tx3}},'Přijetí doporučení uloží tvoje rozhodnutí. Správce nemá automatické provádění změn; úpravu je potřeba provést ručně.'),
    pending.length?pending.map(function(p){return h('div',{key:p.id,style:{padding:14,marginBottom:10,background:C.bg2,border:'1px solid '+C.border,borderRadius:8}},
      h('strong',null,p.title),h('p',null,p.description||p.rationale||''),h('p',{style:{color:C.tx3}},p.suggested_action||''),
      h('button',{style:_modelButtonStyle(false,_governorActionPending),disabled:_governorActionPending,onClick:function(){_dismissGovernorProposal(p.id);}},'Zamítnout'),
      h('button',{style:Object.assign({},_modelButtonStyle(true,_governorActionPending),{marginLeft:8}),disabled:_governorActionPending,onClick:function(){_approveGovernorProposal(p.id);}},'Přijmout doporučení'));
    }):h('p',null,'Žádná otevřená doporučení.'),
    h('h3',null,'Historie doporučení'),_modelTable(['Kdy','Doporučení','Výsledek'],proposals.filter(function(p){return !pending.includes(p);}).map(function(p){var accepted=String(p.status).toLowerCase()==='approved';return h('tr',{key:p.id},
      _modelCell(p.resolved_at||p.created_at||'—'),_modelCell(p.title),_modelCell(accepted?'Přijato · čeká na ruční provedení':String(p.status).toLowerCase()==='dismissed'?'Zamítnuto':p.status));})));
}
if(typeof IntentSmithBus!=='undefined'){IntentSmithBus.on('governor:report',function(){_governorData=null;if(_upgradeTab==='governor')_loadGovernorData();});}
function settingsMemory(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _bCfgError?h('p',{role:'alert'},_bCfgError):null,
    _bCfg.memory&&_bCfg.memory.saveHistory===false?h('div',{role:'alert'},'Chat je zastaven kvůli dříve vypnuté historii. Režim bez historie není podporován. ',h('button',{onClick:function(){if(window.confirm('Povolit lokální ukládání historie a obnovit chat?')){_bCfg.memory.saveHistory=true;_saveBCfg();renderCenter();}}},'Povolit ukládání historie')):null,
    h('p',{style:{color:C.tx2}},'Historie konverzací a provozní žurnál se ukládají lokálně. Chat bez historie zatím není podporován. Přepínače níže ovládají automatickou paměť a učení; již uložené záznamy nemažou.'),
    _cfgToggle('Dlouhodobá paměť (LTM)','Korekce, preference a vzorce se používají pouze uvnitř stejného projektu, bez projektu pouze uvnitř konverzace','intentsmith.memory.ltmEnabled',true),
    _cfgToggle('Učení z preferencí','IntentSmith se adaptuje na váš styl komunikace a pracovní postupy','intentsmith.memory.learningEnabled',true),
    _cfgToggle('Detekce zpětné vazby','Automaticky rozpozná pochvalu, kritiku nebo opravu v konverzaci a upraví své chování','intentsmith.memory.feedbackDetection',true),
    _cfgToggle('Sledování vzorců','Rozpoznává opakující se sekvence úloh a navrhuje efektivnější postupy','intentsmith.memory.patternTracking',true),
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'10px 0'}}),
    _cfgSlider(_lI('Max turnů','Maximální počet zpráv (uživatel+asistent) v jedné konverzaci před automatickým ořezáním'),'intentsmith.memory.conversationMaxTurns',500,50,5000,50,''),
    _cfgSlider(_lI('Práh kompakce','Když kontext dosáhne tohoto % kapacity, starší zprávy se automaticky zhuštní do shrnutí'),'intentsmith.memory.compactThreshold',0.75,0.3,0.95,0.05,'',null,function(v){return Math.round(v*100)+'%';}),
    _cfgSlider(_lI('Uchované turny','Kolik posledních zpráv zůstane v plném znění při kompakci — starší se zhuštění do shrnutí'),'intentsmith.memory.compactKeepTurns',6,2,20,1,''),
    _cfgSlider(_lI('Max LTM záznamů','Maximální kapacita dlouhodobé paměti. Staré záznamy s nízkou důvěryhodností se automaticky mažou.'),'intentsmith.memory.ltmMaxEntries',1000,100,10000,100,''),
    _cfgSlider(_lI('Poločas LTM','Za kolik dní klesne důvěryhodnost LTM záznamu na 50%. Delší = déle si pamatuje, ale může si pamatovat i neaktuální věci.'),'intentsmith.memory.ltmDecayHalfLife',69,7,365,7,' d'),
    _cfgSlider(_lI('Budget chat','Kolik % kontextového okna se vyhradí pro chat kontext (historii, LTM, systémové instrukce)'),'intentsmith.memory.contextBudgetChat',60,10,90,5,' %'),
    _cfgSlider(_lI('Budget code','Kolik % kontextového okna se vyhradí pro zdrojový kód při generování'),'intentsmith.memory.contextBudgetCode',40,10,90,5,' %'),
    _cfgSlider(_lI('Hard cap','Absolutní limit kontextu v tokenech — ochrana proti přetečení bez ohledu na procentuální budget'),'intentsmith.memory.contextBudgetMaxTokens',24576,2048,65536,1024,'',null,function(v){return v>=1024?Math.round(v/1024)+'K':'v';}));
}
function settingsNotif(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_notifChannels){fetch(_backendUrl()+'/api/notifications/channels',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_notifChannels=d;renderCenter();}).catch(function(){_notifChannels={error:true};});}
  var chs=_notifChannels&&!_notifChannels.error?(_notifChannels.channels||_notifChannels):null;
  return h('div',null,
    _cfgToggle('Desktop notifikace','Systémové notifikace přes Electron (dokončení úloh, chyby agentů)','intentsmith.notif.desktopEnabled',true),
    _cfgToggle('Tichý režim','Potlačí všechny notifikace v nastaveném časovém rozmezí','intentsmith.notif.quietEnabled',false),
    _bVal('intentsmith.notif.quietEnabled',false)?h(React.Fragment,null,
      _cfgInput('Ticho od','intentsmith.notif.quietFrom','22:00','input','Formát HH:MM'),
      _cfgInput('Ticho do','intentsmith.notif.quietTo','07:00','input','Formát HH:MM')):null,
    h('div',{style:{borderTop:'1px solid '+C.border,margin:'14px 0'}}),
    h('div',{style:{fontSize:_fs(11),fontWeight:700,color:C.tx1,marginBottom:10}},'Kanály'),
    h('div',{style:{display:'flex',flexDirection:'column',gap:6}},
      [{id:'email',icon:'\u2709\ufe0f',label:'E-mail',desc:'Notifikace na e-mailovou adresu'},
       {id:'telegram',icon:'\ud83d\udcac',label:'Telegram',desc:'Notifikace přes Telegram bota'},
       {id:'webhook',icon:'\ud83d\udd17',label:'Webhook',desc:'HTTP POST na vlastní URL'},
       {id:'push',icon:'\ud83d\udce4',label:'Push (ntfy)',desc:'Push notifikace přes ntfy.sh'}
      ].map(function(ch){
        var status=chs?chs.find(function(c){return c.name===ch.id||c.channel===ch.id;}):null;
        var ok=status&&status.ok;
        return h('div',{key:ch.id,style:{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:C.bg3,border:'1px solid '+C.border2,borderRadius:8}},
          h('span',{style:{fontSize:_fs(16)}},ch.icon),
          h('div',{style:{flex:1}},
            h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx1}},ch.label),
            h('div',{style:{fontSize:_fs(9),color:C.tx4}},ch.desc)),
          h('span',{style:{fontSize:_fs(9),color:ok?C.accent:'#6b7280',fontWeight:600}},ok?'Aktivní':'Neaktivní'));
      })),
    h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:8}},'Konfigurace kanálů se nastavuje v backend konfiguraci (env proměnné).'));
}
function settingsOutput(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  return h('div',null,
    _cfgToggle('Code blocky','Výstup obsahuje formátované bloky se zdrojovým kódem','intentsmith.output.codeBlocks',true),
    _cfgToggle('Syntax highlighting','Zvýrazňování syntaxe v code blocích (barvy dle jazyka)','intentsmith.output.syntaxHighlight',true),
    _cfgToggle('Markdown rendering','Formátování textu — nadpisy, seznamy, tučné písmo, odkazy','intentsmith.output.markdownRendering',true),
    _cfgSlider(_lI('Max délka odpovědi','Maximální počet tokenů v jedné odpovědi. 1 token \u2248 4 znaky českého textu. 8K token \u2248 6 stran textu.'),'intentsmith.output.maxResponseLength',8192,1024,65536,512,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':v+' tok';}));
}
function settingsSystemPanel(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_sysInfo){fetch(_backendUrl()+'/api/system/info',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=d;renderCenter();}).catch(function(){_sysInfo={error:true};});}
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
    _cfgSelect('Časové pásmo','intentsmith.account.timezone','Europe/Prague',['Europe/Prague','Europe/London','America/New_York','America/Los_Angeles','Asia/Tokyo','UTC']),
    _cfgSelect('Měna','intentsmith.account.currency','CZK',['CZK','EUR','USD','GBP']),
    _cfgSelect(_lI('Log level','Úroveň detailu v serverových logách. Debug = vše, Error = jen chyby.'),'intentsmith.system.logLevel','info',['debug','info','warn','error']),
    _cfgSlider(_lI('Retence logů','Po kolika dnech se automaticky mažou staré logy'),'intentsmith.system.logRetentionDays',30,7,365,7,' d'),
    _cfgSlider(_lI('Max velikost přílohy','Největší soubor který IntentSmith zpracuje jako přílohu (text, kód). Větší soubory budou odmítnuty.'),'intentsmith.system.maxFileSize',1048576,102400,10485760,102400,'',null,function(v){return v>=1048576?Math.round(v/1048576)+' MB':Math.round(v/1024)+' KB';}),
    _cfgSlider(_lI('Rate limit','Maximální počet API požadavků za minutu — ochrana proti přetížení serveru'),'intentsmith.system.rateLimit',120,10,1000,10,' /min'));
}
function settingsStoragePanel(){
  if(!_sysInfo){fetch(_backendUrl()+'/api/system/info',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=d;renderCenter();}).catch(function(){_sysInfo={error:true};});}
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
      onClick:function(){fetch(_backendUrl()+'/api/system/vacuum',{method:'POST',signal:AbortSignal.timeout(30000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=null;_storageInfo=null;renderCenter();alert(d.message||'Databáze optimalizována');}).catch(function(e){alert('Chyba: '+e.message);});}},'Optimalizovat databázi'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'8px 12px',color:C.tx1,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font},
      onClick:function(){_sysInfo=null;_storageInfo=null;renderCenter();}},'Aktualizovat info'));
}
function settingsBackupPanel(){
  return h('div',null,
    h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:14}},'Zálohujte svá nastavení nebo je obnovte ze souboru.'),
    _backupMsg?h('div',{style:{padding:'8px 12px',borderRadius:6,marginBottom:10,fontSize:_fs(11),fontWeight:600,background:_backupMsg.ok?C.successBg:C.redBg,color:_backupMsg.ok?C.success:C.red,border:'1px solid '+(_backupMsg.ok?_rgba(C.success,0.25):_rgba(C.red,0.25))}},_backupMsg.text):null,
    h('button',{style:{width:'100%',background:C.accent,color:C.onAccent,border:'none',borderRadius:6,padding:'10px 14px',fontSize:_fs(12),fontWeight:700,cursor:'pointer',marginBottom:10,fontFamily:C.font},
      onClick:function(){fetch(_backendUrl()+'/api/settings',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){
        var blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
        var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='intentsmith-settings-'+new Date().toISOString().slice(0,10)+'.json';a.click();
        _backupMsg={ok:true,text:'Nastavení exportována do souboru'};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);
      }).catch(function(e){_backupMsg={ok:false,text:'Export selhal: '+e.message};renderCenter();});}},'Exportovat nastavení'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'10px 14px',fontSize:_fs(12),cursor:'pointer',color:C.tx1,marginBottom:10,fontFamily:C.font},
      onClick:function(){
        var inp=document.createElement('input');inp.type='file';inp.accept='.json';
        inp.onchange=function(e){var f=e.target.files[0];if(!f)return;
          var reader=new FileReader();reader.onload=function(ev){try{var data=JSON.parse(ev.target.result);
            /* 020/E: explicit versioned adapter, and the result is checked —
               an ignored response made a failed import look like a success. */
            fetch(_backendUrl()+'/api/settings/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,settings:data}),signal:AbortSignal.timeout(3000)})
            .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);
              _bCfg=data;_backupMsg={ok:true,text:'Nastavení importována z '+f.name};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);})
            .catch(function(e){_backupMsg={ok:false,text:'Import selhal: '+e.message};renderCenter();});
          }catch(ex){_backupMsg={ok:false,text:'Neplatný JSON soubor'};renderCenter();}};reader.readAsText(f);};inp.click();}},'Importovat nastavení'),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,marginTop:8}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:4}},'Reset'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:8}},'Smaže všechna uživatelská nastavení a obnoví výchozí hodnoty.'),
      h('button',{style:{width:'100%',background:'transparent',border:'1px solid #ef4444',borderRadius:6,padding:'8px 14px',fontSize:_fs(11),cursor:'pointer',color:'#ef4444',fontFamily:C.font},
        onClick:function(){if(!confirm('Opravdu obnovit výchozí nastavení? Všechny změny budou ztraceny.'))return;
          /* 020/E: the audited reset path. POST {} no longer resets the
             automation policy, and the result is no longer ignored. */
          fetch(_backendUrl()+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);
            _bCfg={};_backupMsg={ok:true,text:'Nastavení obnovena na výchozí'};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);}).catch(function(e){_backupMsg={ok:false,text:'Reset selhal: '+e.message};renderCenter();});}},'Obnovit výchozí')));
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
function _secFetch(path,opts){return fetch(_backendUrl()+path,Object.assign({signal:AbortSignal.timeout(5000)},opts||{}));}
function _secLoadTokens(){_secLoading.tokens=true;_secFetch('/api/security/tokens').then(function(r){return r.json();}).then(function(d){_secTokens=d.tokens||[];_secLoading.tokens=false;renderCenter();}).catch(function(){_secLoading.tokens=false;});}
function _secLoadAudit(type){_secAuditType=type||'all';_secLoading.audit=true;_secFetch('/api/security/audit?type='+encodeURIComponent(_secAuditType)+'&limit=50').then(function(r){return r.json();}).then(function(d){_secAudit=d.results||{};_secLoading.audit=false;renderCenter();}).catch(function(){_secLoading.audit=false;});}
function _secLoadWebhook(){_secFetch('/api/security/webhook-secret').then(function(r){return r.json();}).then(function(d){_secWebhook=d;renderCenter();}).catch(function(){});}
function _secLoadSessions(){_secFetch('/api/security/sessions').then(function(r){return r.json();}).then(function(d){_secSessions=d;renderCenter();}).catch(function(){});}
function settingsSecurityPanel(){
  if(!_secTokens&&!_secLoading.tokens)_secLoadTokens();
  if(!_secAudit&&!_secLoading.audit)_secLoadAudit('all');
  if(!_secWebhook)_secLoadWebhook();
  if(!_secSessions)_secLoadSessions();
  var secH={fontSize:_fs(12),fontWeight:600,color:C.tx2,marginTop:14,marginBottom:6};
  var secSub={fontSize:_fs(10),color:C.tx4,marginBottom:8};
  /* ── Audit Log ── */
  var auditTabs=['all','cre','merge','drift','llm'];
  var auditTabRow=h('div',{style:{display:'flex',gap:4,marginBottom:8,flexWrap:'wrap'}},auditTabs.map(function(t){
    var active=_secAuditType===t;
    return h('button',{key:t,style:{padding:'3px 8px',fontSize:_fs(10),border:'1px solid '+(active?C.accent:C.border),borderRadius:4,background:active?C.accent:'transparent',color:active?C.onAccent:C.tx3,cursor:'pointer'},
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
    newTokenBanner=h('div',{style:{background:C.successBg,border:'1px solid '+_rgba(C.success,0.30),borderRadius:6,padding:10,marginBottom:10}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.accent,marginBottom:4}},'Token vytvořen — zkopírujte nyní (zobrazí se jen jednou):'),
      h('div',{style:{fontFamily:C.mono,fontSize:_fs(10),color:C.tx1,wordBreak:'break-all',userSelect:'all',marginBottom:6}},_secNewToken),
      h('button',{style:{background:C.accent,color:C.onAccent,border:'none',borderRadius:4,padding:'4px 10px',cursor:'pointer',fontSize:_fs(10),fontWeight:700},
        onClick:function(){navigator.clipboard.writeText(_secNewToken);_secNewToken=null;renderCenter();}},'Kopírovat & zavřít'));
  }
  /* ── Webhook ── */
  var webhookInfo=null;
  if(_secWebhook){
    webhookInfo=h('div',{style:{fontSize:_fs(10),color:C.tx3}},
      _secWebhook.configured
        ?h('span',null,'Secret: ',h('code',{style:{fontFamily:C.mono,background:C.bg4,padding:'1px 4px',borderRadius:3}},_secWebhook.masked))
        :h('span',{style:{color:C.tx4}},'Není nastaven'),
      h('button',{style:{marginLeft:8,background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:4,padding:'2px 8px',cursor:'pointer',fontSize:_fs(9)},
        onClick:function(){if(!confirm('Regenerovat webhook secret?'))return;_secFetch('/api/security/webhook-secret',{method:'POST'}).then(function(r){return r.json();}).then(function(d){_secWebhook=d.ok?{configured:true,masked:d.masked}:_secWebhook;renderCenter();}).catch(function(){});}},'Regenerovat'));
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
    h('button',{style:{marginTop:6,background:C.accent,color:C.onAccent,border:'none',borderRadius:4,padding:'4px 12px',cursor:'pointer',fontSize:_fs(10),fontWeight:700},
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
  try{ctx.chatModel=_bVal('intentsmith.llm.chatModel',null);}catch(_){}
  try{ctx.codeModel=_bVal('intentsmith.llm.codeModel',null);}catch(_){}
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
      return fetch(_backendUrl()+'/api/feedback/'+feedbackId+'/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,type:f.type,data:f.data})}).then(function(r){return r.json();});
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
      h('img',{src:'../../resources/intentsmith-icon.png',alt:'',style:{width:80,height:80,objectFit:'contain',marginBottom:14}}),
      h('div',{style:{fontSize:_fs(17),fontWeight:700,color:C.tx1,marginBottom:4}},'IntentSmith'),
      h('div',{style:{fontSize:_fs(13),color:C.accent,fontWeight:600,marginBottom:16}},'v'+(_serverHealth.version||'...')),
      h('div',{style:{fontSize:_fs(11),color:C.tx4,marginBottom:20}},'Made with \u2764\ufe0f by Belfik')),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:16,marginBottom:20,textAlign:'center'}},
      h('button',{style:{background:C.bg4,color:C.tx2,border:'1px solid '+C.border,borderRadius:6,padding:'6px 14px',cursor:'pointer',fontSize:_fs(11)},
        onClick:function(){try{localStorage.removeItem('intentsmith.onboarding.completed');}catch(_){}renderCenter();}},'Spustit pr\u016fvodce prvn\u00edm spu\u0161t\u011bn\u00edm')),
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
      _fbSent?h('div',{style:{color:C.success,fontSize:_fs(11),fontWeight:600,marginBottom:8}},'D\u011bkujeme za zp\u011btnou vazbu!'):null,
      cooldownActive?h('div',{style:{color:'#f59e0b',fontSize:_fs(10),marginBottom:8}},'Po\u010dkej 30s p\u0159ed dal\u0161\u00edm odesl\u00e1n\u00edm.'):null,
      h('button',{style:{background:btnDisabled?C.bg4:C.accent,color:btnDisabled?C.tx4:C.onAccent,border:'none',borderRadius:6,padding:'6px 16px',cursor:btnDisabled?'default':'pointer',fontSize:_fs(11),fontWeight:700,opacity:btnDisabled?0.6:1},disabled:btnDisabled,
        onClick:function(){
          if(!_fbMessage.trim()||btnDisabled)return;
          _fbSending=true;_fbSent=false;renderCenter();
          var payload={category:_fbCategory,message:_fbMessage.trim(),version:_serverHealth.version||null,context:_fbCollectContext()};
          if(_fbAttachLast){var lr=_fbGetLastAssistant();if(lr)payload.lastResponse=lr;}
          /* Step 1: fetch logs if requested */
          var logsPromise=_fbAttachLogs?fetch(_backendUrl()+'/api/logs/export').then(function(r){return r.text();}).then(function(txt){
            var b64=btoa(unescape(encodeURIComponent(txt)));
            return {name:'server-logs_'+Date.now()+'.log',type:'text/plain',data:b64,size:txt.length};
          }).catch(function(){return null;}):Promise.resolve(null);
          logsPromise.then(function(logFile){
            var allFiles=_fbFiles.slice();
            if(logFile)allFiles.push(logFile);
            /* Step 2: submit feedback */
            return fetch(_backendUrl()+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(d){
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
  var url=_backendUrl()+'/api/marketplace/catalog?page='+_mpPage+'&limit=50';
  if(force)url=_backendUrl()+'/api/marketplace/catalog/refresh';
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
  fetch(_backendUrl()+'/api/marketplace/install/'+type+'/'+id,{method:'POST',signal:AbortSignal.timeout(120000)})
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
  fetch(_backendUrl()+'/api/marketplace/installed/'+type+'/'+id,{method:'DELETE',signal:AbortSignal.timeout(15000)})
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
  fetch(_backendUrl()+'/api/marketplace/update/'+type+'/'+id,{method:'POST',signal:AbortSignal.timeout(120000)})
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
  var tabStyle=function(t){return{background:_mpTab===t?C.accent:'transparent',color:_mpTab===t?C.onAccent:C.tx3,
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
      background:_mpMsg.ok?C.successBg:C.redBg,
      color:_mpMsg.ok?C.success:C.red,
      border:'1px solid '+(_mpMsg.ok?_rgba(C.success,0.25):_rgba(C.red,0.25))}},_mpMsg.text):null,
    _modelTestMessage?h('p',{role:'status',style:{padding:'8px 18px'}},_modelTestMessage):null,
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
            p.installed?h('div',{style:{position:'absolute',top:10,right:isNew?52:10,background:C.successBg,border:'1px solid '+_rgba(C.success,0.30),borderRadius:4,padding:'2px 6px',fontSize:_fs(8),fontWeight:700,color:C.success}},p.updateAvailable?'AKTUALIZACE':'NAINSTALOVÁNO'):null,
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
              p.installed&&p.updateAvailable?h('button',{style:{background:C.accent,color:C.onAccent,border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(10),fontWeight:700,cursor:'pointer',fontFamily:C.font},onClick:function(ev){ev.stopPropagation();_mpUpdate(p.type,p.id);}},'Aktualizovat'):
              !p.installed?h('button',{style:{background:C.accent,color:C.onAccent,border:'none',borderRadius:5,padding:'3px 10px',fontSize:_fs(10),fontWeight:700,cursor:'pointer',fontFamily:C.font},onClick:function(ev){ev.stopPropagation();_mpInstall(p.type,p.id);}},'Nainstalovat'):null)
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
  return _backendUrl()+_mediaOutputPath(id,filename);
}
function _mediaEnsureOutputUrl(id,filename){
  return _mediaOutputCache.load(_mediaOutputTarget(id,filename))
    .then(function(objectUrl){
      if(objectUrl)MediaEvents.render();
      return objectUrl;
    });
}
function _mediaRevokeOutputUrls(id){
  var prefix=_backendUrl()+'/api/media/output?id='+encodeURIComponent(id)+'&';
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
    return fetch(_backendUrl()+path,o)
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
    IntentSmithBus.on('comfyui:progress',function(ev){
      if(!_media.progress.has(ev.generationId)){
        _media.progress.set(ev.generationId,{id:ev.generationId,percent:0,text:'',status:'generating',startedAt:Date.now()});
      }
      var p=_media.progress.get(ev.generationId);
      p.percent=ev.percent||0;p.text=ev.text||'';p.status=ev.status||'generating';
      /* Update badge */
      NAV[6].badge=_media.progress.size||0;
      if(_centerState.view==='multimedia')MediaEvents.render();
    });
    IntentSmithBus.on('comfyui:complete',function(ev){
      _media.progress.delete(ev.generationId);
      NAV[6].badge=_media.progress.size||0;
      if(ev.generationId)_mediaRevokeOutputUrls(ev.generationId);
      MediaAPI.loadData();
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','Media generování dokončeno');
    });
    IntentSmithBus.on('comfyui:error',function(ev){
      _media.progress.delete(ev.generationId);
      NAV[6].badge=_media.progress.size||0;
      _media.msg={ok:false,text:'Generování selhalo: '+(ev.error||'neznámá chyba')};
      MediaAPI.loadData();
      if(_centerState.view==='multimedia')MediaEvents.render();
      setTimeout(function(){_media.msg=null;if(_centerState.view==='multimedia')MediaEvents.render();},8000);
    });
    IntentSmithBus.on('vram:state',function(ev){
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
  var tabStyle=function(t){return{background:_media.tab===t?C.accent:'transparent',color:_media.tab===t?C.onAccent:C.tx3,
    border:'1px solid '+(_media.tab===t?C.accent:C.border2),borderRadius:6,padding:'5px 14px',fontSize:_fs(11),
    fontWeight:_media.tab===t?600:400,cursor:'pointer',fontFamily:C.font};};
  var formTypeStyle=function(t){return{background:_media.form.type===t?C.accent:'transparent',color:_media.form.type===t?C.onAccent:C.tx3,
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
        background:_media.health.available?C.successBg:C.redBg,
        color:_media.health.available?C.success:C.red,
        border:'1px solid '+(_media.health.available?_rgba(C.success,0.25):_rgba(C.red,0.25)),
        borderRadius:4,padding:'2px 8px'}},
        h('span',{style:{width:6,height:6,borderRadius:'50%',background:_media.health.available?C.success:C.red}}),
        _media.health.available?'ComfyUI':'Nedostupné'),
      _media.health.vramBusy?h('span',{style:{fontSize:_fs(9),background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.2)',borderRadius:4,padding:'2px 8px',fontWeight:600}},'GPU zaneprázdněno'):null,
      h('button',{style:{background:C.accent,border:'none',borderRadius:6,padding:'5px 14px',color:C.onAccent,fontSize:_fs(11),cursor:'pointer',fontFamily:C.font,fontWeight:700},
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
      background:_media.msg.ok?C.successBg:C.redBg,
      color:_media.msg.ok?C.success:C.red,
      border:'1px solid '+(_media.msg.ok?_rgba(C.success,0.25):_rgba(C.red,0.25))}},_media.msg.text):null,

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
        h('button',{disabled:formDisabled,style:{background:formDisabled?C.bg4:C.accent,border:'none',borderRadius:6,padding:'6px 18px',color:formDisabled?C.tx4:C.onAccent,fontSize:_fs(11),cursor:formDisabled?'default':'pointer',fontFamily:C.font,fontWeight:700},
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

function centerWelcome(){return h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10,background:'radial-gradient(circle at 50% 45%,'+_rgba(C.accent,0.055)+' 0,transparent 34%)'}},
  h('img',{src:'../../resources/intentsmith-icon.png',alt:'',style:{width:82,height:82,objectFit:'contain'}}),
  h('div',{style:{fontSize:_fs(17),fontWeight:750,color:C.tx1,letterSpacing:'0.2px'}},'IntentSmith'),
  h('div',{style:{width:34,height:1,background:C.accent,opacity:0.65,margin:'2px 0 1px'}}),
  h('div',{style:{fontSize:_fs(12),color:C.tx3}},'Vyber sekci v levém panelu'));
}

/* ═══════════════════════════════════════════════════════════
   I3: KEYBOARD SHORTCUTS — scoped, no collisions
   ═══════════════════════════════════════════════════════════ */

function _isIntentSmithFocused(){
  var el=document.activeElement;
  while(el){
    if(el.classList&&(el.classList.contains('intentsmith-chat-widget')||
      el.classList.contains('intentsmith-center-widget')||
      el.classList.contains('intentsmith-agent-widget')||
      el.id==='intentsmith-center-mount'||el.id==='intentsmith-chat-panel'||
      el.id==='intentsmith-agent-panel'||el.id==='intentsmith-sidebar'))return true;
    el=el.parentElement;
  }
  return false;
}

document.addEventListener('keydown',function(e){
  if(!_isIntentSmithFocused())return;

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
        else if(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.isReady()){
          if(IntentSmithWS.sendCancel(activeSession))e.preventDefault();
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

function _openFileTab(path,ownerIndex,quiet){
  if(!quiet)_showWorkspace();
  var owner=_sessions[ownerIndex===undefined?_sessionActive:ownerIndex];if(!owner||owner._closed)return;
var editor=owner._editor||_editorState;
  var existing=editor.tabs.find(function(t){return t.path===path&&t.type==='file';});
  if(existing){editor.activeTabId=existing.id;editor.active=true;renderCenter();return;}
  fetch(_backendUrl()+'/api/workspace/file?path='+encodeURIComponent(path),{signal:AbortSignal.timeout(5000)})
  .then(function(r){if(!r.ok)throw new Error('Soubor nelze načíst ('+r.status+').');return r.json();})
  .then(function(data){
    if(data.error)throw new Error(data.error);
    var tab={id:'file-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),type:'file',path:path,
      label:path.split('/').pop(),content:data.content||'',hash:data.hash||null,
      originalContent:data.content||'',dirty:false,scrollTop:0,deleted:false,externalChange:false};
    editor.tabs.push(tab);
    editor.activeTabId=tab.id;
    editor.active=true;owner._chatCollapsed=true;
    renderCenter();_persistEditorState();
  }).catch(function(e){owner.chat.msgs.push({role:'system',tag:'ERROR',text:e.message});renderChat();});
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
  if(cur){var el=document.getElementById('intentsmith-editor-scroll');if(el)cur.scrollTop=el.scrollTop;}
  _editorState.activeTabId=tabId;_editorState.active=true;
  renderCenter();
  var nxt=_editorState.tabs.find(function(t){return t.id===tabId;});
  if(nxt&&nxt.scrollTop){setTimeout(function(){var el=document.getElementById('intentsmith-editor-scroll');if(el)el.scrollTop=nxt.scrollTop;},50);}
}

function _backToGrid(){_editorState.active=false;_sessions[_sessionActive]._chatCollapsed=false;if(_centerContainer)_centerContainer.style.display='';renderCenter();}

function _persistEditorState(){
  try{localStorage.setItem('intentsmith-editor-state',JSON.stringify({version:2,sessions:_sessions.map(function(s){var ed=s._editor||{tabs:[]};return {openFiles:ed.tabs.filter(function(t){return t.type==='file'&&t.path&&t.path.charAt(0)==='/';}).map(function(t){return {path:t.path};}),activePath:(ed.tabs.find(function(t){return t.id===ed.activeTabId;})||{}).path||null};})}));}catch(e){}
}

function _refreshFileTab(tab){
  fetch(_backendUrl()+'/api/workspace/file?path='+encodeURIComponent(tab.path),{signal:AbortSignal.timeout(5000)})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error)return;
    if(data.hash&&data.hash===tab.hash)return;
    tab.content=data.content||'';tab.originalContent=tab.content;tab.hash=data.hash||null;
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
function centerEditor(idx){
  var editor=_sessions[idx===undefined?_sessionActive:idx]._editor||_editorState;
  var tabs=editor.tabs;
  var at=tabs.find(function(t){return t.id===editor.activeTabId;});
  return h(React.Fragment,null,
    /* Tab bar */
    h('div',{style:{display:'flex',alignItems:'center',height:32,borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2,overflow:'hidden'}},
      /* Back button */
      h('div',{style:{padding:'0 10px',height:'100%',display:'flex',alignItems:'center',cursor:'pointer',color:C.tx4,fontSize:_fs(12),flexShrink:0,borderRight:'1px solid '+C.border,gap:4},
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:_backToGrid},svgEl('<polyline points="15 18 9 12 15 6"/>',14),'Chat'),
      /* Tabs */
      h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
        tabs.map(function(tab){
          var isA=tab.id===editor.activeTabId;
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

/* Manual editing uses Theia's existing local file service; no model or chat
   path invokes this operation. The operator saves explicitly and stale content
   is rejected before the provider's mtime/etag check. */
async function _saveWorkspaceFile(tab){
  if(!tab||tab.type!=='file'||!tab.path||tab.path[0]!=='/'||tab._saving)return;
  tab._saving=true;tab._saveError=null;renderCenter();
  try{
    if(!window._intentsmithFileService)throw Error('Souborová služba není dostupná.');
    var service=window._intentsmithFileService,uri=new (require('@theia/core/lib/common/uri').default)(tab.path);
    var current=await service.read(uri);
    if(current.value!==tab.originalContent)throw Error('Soubor se změnil na disku. Uložení bylo zastaveno; nejprve změny porovnej.');
    var content=tab.content;
    await service.write(uri,content,{mtime:current.mtime,etag:current.etag,encoding:current.encoding});
    tab.originalContent=content;tab.dirty=tab.content!==content;tab.externalChange=false;_fetchGitStatus();
  }catch(e){tab._saveError=e.message||'Uložení selhalo.';}
  finally{tab._saving=false;renderCenter();}
}
function WorkspaceFileEditor(props){
  var tab=props.tab,node=React.useRef(null);
  React.useEffect(function(){
    var editor,model,change;try{
      var monaco=require('@theia/monaco-editor-core');
      var ext=tab.path.split('.').pop().toLowerCase();var language={js:'javascript',mjs:'javascript',json:'json',ts:'typescript',md:'markdown',py:'python',css:'css',html:'html'}[ext]||'plaintext';
      model=monaco.editor.createModel(tab.content||'',language);
      editor=monaco.editor.create(node.current,{model:model,automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,theme:'vs-dark'});
      if(tab._editorViewState)editor.restoreViewState(tab._editorViewState);
      change=model.onDidChangeContent(function(){var dirty=tab.dirty;tab.content=model.getValue();tab.dirty=tab.content!==tab.originalContent;if(tab.dirty!==dirty)renderCenter();});
      editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,function(){_saveWorkspaceFile(tab);});
    }catch(e){tab._saveError='Editor se nepodařilo otevřít: '+e.message;renderCenter();}
    return function(){if(editor){tab._editorViewState=editor.saveViewState();editor.dispose();}if(change)change.dispose();if(model)model.dispose();};
  },[tab.id]);
  return h('div',{ref:node,'data-file-editor':tab.id,style:{flex:1,minHeight:80,overflow:'hidden'}});
}
function _renderFileContent(tab){
  var lines=(tab.content||'').split('\n');
  return h(React.Fragment,null,
    tab.path&&tab.path[0]==='/'?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'4px 10px',borderBottom:'1px solid '+C.border,flexShrink:0}},
      _workspaceButton(tab.editing?'Náhled':'Upravit','Přepnout editor souboru',function(){tab.editing=!tab.editing;renderCenter();}),
      _workspaceButton(tab._saving?'Ukládám…':'Uložit','Uložit ruční změny (Ctrl+S)',function(){_saveWorkspaceFile(tab);},{disabled:!tab.dirty||tab._saving}),
      h('span',{style:{fontSize:_fs(10),color:C.tx3}},tab.dirty?'Neuložené změny':'Soubor na disku')):null,
    tab._saveError?h('div',{role:'alert',style:{padding:8,color:C.red}},tab._saveError):null,
    /* External change banner */
    tab.externalChange?h('div',{style:{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:C.amberBg,borderBottom:'1px solid '+C.border,fontSize:_fs(11),flexShrink:0}},
      h('span',{style:{color:C.amber,flex:1}},'Soubor byl změněn externě.'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.amber,background:'transparent',color:C.amber,cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){_refreshFileTab(tab);}},'Načíst z disku'),
      h('button',{style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border2,background:'transparent',color:C.tx3,cursor:'pointer',fontSize:_fs(10)},
        onClick:function(){tab.externalChange=false;renderCenter();}},'Ignorovat')):null,
    /* Code view */
    tab.editing?h(WorkspaceFileEditor,{key:tab.id,tab:tab}):h('div',{id:'intentsmith-editor-scroll',style:{flex:1,overflow:'auto',background:C.bg0},
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
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:C.onAccent,cursor:'pointer',fontSize:_fs(12),fontWeight:700},onClick:function(){_approveAll(tab.reqId);}},'Schválit bez review'),
        h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:_fs(12)},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')));
  }
  if(!tab.diffData||!tab.diffData.hunks)return h('div',{style:{padding:20,color:C.tx4}},'Žádný diff k zobrazení');
  var hunks=tab.diffData.hunks;
  var totalLines=hunks.reduce(function(s,hk){return s+hk.lines.length;},0);
  return h('div',{style:{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}},
    h('div',{id:'intentsmith-editor-scroll',style:{flex:1,overflow:'auto',background:C.bg0},
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
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'none',background:C.accent,color:C.onAccent,cursor:'pointer',fontSize:_fs(12),fontWeight:700},onClick:function(){_approveAll(tab.reqId);}},'Schválit'),
      h('button',{style:{padding:'6px 16px',borderRadius:6,border:'1px solid '+C.red,background:'transparent',color:C.red,cursor:'pointer',fontSize:_fs(12),fontWeight:600},onClick:function(){_rejectAll(tab.reqId);}},'Odmítnout')):null);
}

function _approveAll(reqId){
  if(!reqId)return;
  if(typeof IntentSmithWS!=='undefined')IntentSmithWS.approveEdit(reqId);
  var tab=_editorState.tabs.find(function(t){return t.reqId===reqId;});
  if(tab)_closeTab(tab.id);
}

function _rejectAll(reqId){
  if(!reqId)return;
  if(typeof IntentSmithWS!=='undefined')IntentSmithWS.rejectEdit(reqId);
  var tab=_editorState.tabs.find(function(t){return t.reqId===reqId;});
  if(tab)_closeTab(tab.id);
}

function _detailActionHandler(d,a){
  var intentsmith=window._intentsmith;if(!intentsmith)return;
  if(a==='Deaktivovat'){
    _centerState.detail=null;renderCenter();
    intentsmith.clearSpecialist().then(function(ok){if(ok)intentsmith.agentLog('TOOL','Specialista deaktivován');});return;
  }
  if(a==='Otevřít'){
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
    var spec=SPECIALISTS.find(function(x){return x.name===d.name;});
    if(spec){_openSpecialistWorkspace(spec).then(function(ok){if(ok)intentsmith.agentLog('TOOL','Specialista aktivován: '+spec.name);});return;}
    var exp=EXPERTISES.find(function(e){return e.name===d.name;});
    if(exp){intentsmith.setExpertise(exp.name);intentsmith.agentLog('TOOL','Expertyza změněna na: '+exp.name);}
    var conv=CONVERSATIONS.find(function(c){return c.title===d.name;});
    if(conv){_showOpenDialog('conv',conv,function(idx){_loadWorkspaceConversation(idx,conv,null);});return;}
    var proj=PROJECTS.find(function(p){return p.name===d.name;});
    if(proj){_showOpenDialog('proj',proj,function(_ti){_openRegisteredProject(_ti,proj);});}
    var wrk=WORKERS.find(function(w){return w.name===d.name;});
    if(wrk){intentsmith.agentLog('TOOL','Worker: '+wrk.name+' ['+_s(wrk.status)+'] cron: '+_s(wrk.cron));}
  }else if(a==='Editovat'){
    if(_centerState.view==='expertises'||_centerState.view==='specialists'){
      var _exItem=EXPERTISES.find(function(e){return e.name===d.name;});
      if(_exItem&&_exItem.id){
        fetch(_backendUrl()+'/api/expertises/'+_exItem.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(full){
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
        fetch(_backendUrl()+'/api/agents/'+_wkItem.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(full){
          var def=full.definition||{};
          var wizData={id:full.id||_wkItem.id,name:full.name||d.name,description:full.description||'',icon:full.icon||'🤖',type:full.type||'MONITOR',
            schedule:def.schedule||{type:'manual'},sources:def.sources||[],conditions:def.conditions||[],triggers:def.triggers||[],actions:def.actions||[],params:def.params||[]};
          _awOpen('edit',_wkItem.id,wizData);
        }).catch(function(){_awOpen('edit',_wkItem.id,{id:_wkItem.id,name:d.name,description:'',icon:'🤖',type:'MONITOR',schedule:{type:'manual'},sources:[],conditions:[],triggers:[],actions:[],params:[]});});
        return;
      }
    }
    _centerState.detail.editing=true;_centerState.detail._orig=d.fields.map(function(f){return{k:f.k,v:f.v};});_centerState.detail._origActions=d.actions.slice();_centerState.detail.actions=['Uložit','Zrušit'];intentsmith.agentLog('TOOL','Editace: '+d.name);renderCenter();
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
      fetch(_backendUrl()+postEp,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();})
      .then(function(created){
        intentsmith.agentLog('TOOL','Vytvoreno: '+d.name);
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
      }).catch(function(){intentsmith.agentLog('TOOL','Vytvoreno lokalne: '+d.name);});
      delete d._isNew;
    }else if(itemId&&ep){fetch(_backendUrl()+ep+itemId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(upd),signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(res){intentsmith.agentLog('TOOL','Ulozeno: '+d.name);if(view==='projects'&&upd.path){_wtRoot=upd.path;_loadWorkspaceTree(upd.path);intentsmith.agentLog('TOOL','📍 Working tree: '+upd.path);}fetchBackendData();}).catch(function(){intentsmith.agentLog('TOOL','Ulozeno lokalne: '+d.name);});}
    else{intentsmith.agentLog('TOOL','Ulozeno: '+d.name);}
    if(view==='projects'&&itemId){var _pi=PROJECTS.find(function(p){return p.id===itemId;});if(_pi){if(upd.path!==undefined)_pi.path=upd.path;if(upd.description!==undefined)_pi.desc=upd.description;if(upd.status!==undefined)_pi.status=upd.status;}}
    d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;renderCenter();
  }else if(a==='Zrušit'){
    if(d._orig){d.fields=d._orig;}d.actions=d._origActions||['Otevřít','Editovat'];delete d.editing;delete d._orig;delete d._origActions;intentsmith.agentLog('TOOL','Editace zrusena');renderCenter();
  }else if(a==='Archivovat'){
    var cid=null;var conv2=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv2&&conv2.id)cid=conv2.id;
    var pid=null;var proj2=PROJECTS.find(function(p){return p.name===d.name;});if(proj2&&proj2.id)pid=proj2.id;
    if(cid){fetch(_backendUrl()+'/api/conversations/'+cid+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){intentsmith.agentLog('TOOL','Konverzace '+d.name+' archivovana.');fetchBackendData();}).catch(function(){intentsmith.agentLog('TOOL',d.name+' archivovano (lokalne).');});}
    else if(pid){fetch(_backendUrl()+'/api/projects/'+pid+'/archive',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){intentsmith.agentLog('TOOL','Projekt '+d.name+' archivovan.');fetchBackendData();}).catch(function(){intentsmith.agentLog('TOOL',d.name+' archivovano (lokalne).');});}
    else{intentsmith.agentLog('TOOL',d.name+' archivovano.');}
    _centerState.detail=null;renderCenter();
  }else if(a==='Obnovit'){
    var cid3=null;var conv3=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv3&&conv3.id)cid3=conv3.id;
    var pid3=null;var proj3=PROJECTS.find(function(p){return p.name===d.name;});if(proj3&&proj3.id)pid3=proj3.id;
    if(cid3){fetch(_backendUrl()+'/api/conversations/'+cid3+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){intentsmith.agentLog('TOOL','Konverzace '+d.name+' obnovena.');fetchBackendData();}).catch(function(){intentsmith.agentLog('TOOL',d.name+' obnoveno (lokalne).');});}
    else if(pid3){fetch(_backendUrl()+'/api/projects/'+pid3+'/restore',{method:'PATCH',signal:AbortSignal.timeout(3000)}).then(function(){intentsmith.agentLog('TOOL','Projekt '+d.name+' obnoven.');fetchBackendData();}).catch(function(){intentsmith.agentLog('TOOL',d.name+' obnoveno (lokalne).');});}
    _centerState.detail=null;renderCenter();
  }else if(a==='Smazat'){
    var cid4=null;var conv4=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv4&&conv4.id)cid4=conv4.id;
    var pid4=null;var proj4=PROJECTS.find(function(p){return p.name===d.name;});if(proj4&&proj4.id)pid4=proj4.id;
    var eid4=d._itemId||null;var exp4=EXPERTISES.find(function(e){return e.name===d.name;});if(!eid4&&exp4&&exp4.id)eid4=exp4.id;
    if(cid4){fetch(_backendUrl()+'/api/conversations/'+cid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);intentsmith.agentLog('TOOL','Konverzace '+d.name+' smazána.');fetchBackendData();}).catch(function(e){intentsmith.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(pid4){fetch(_backendUrl()+'/api/projects/'+pid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);intentsmith.agentLog('TOOL','Projekt '+d.name+' smazán.');fetchBackendData();}).catch(function(e){intentsmith.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(eid4){
      /* v122.2: Delete expertise/specialist — disable specialist first if active */
      var _isSpec=SPECIALISTS.find(function(s){return s.name===d.name;});
      var _disableChain=_isSpec?fetch(_backendUrl()+'/api/specialists/'+eid4+'/disable',{method:'POST',signal:AbortSignal.timeout(3000)}).catch(function(){}):Promise.resolve();
      _disableChain.then(function(){return fetch(_backendUrl()+'/api/expertises/'+eid4,{method:'DELETE',signal:AbortSignal.timeout(3000)});})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);intentsmith.agentLog('TOOL',(_isSpec?'Specialista':'Expertyza')+' '+d.name+' smazán(a).');_fetchExpertises();})
      .catch(function(e){intentsmith.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));_fetchExpertises();});
    }
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
  }else if(a==='Smazat trvale'){
    var cid5=null;var conv5=CONVERSATIONS.find(function(c){return c.title===d.name;});if(conv5&&conv5.id)cid5=conv5.id;
    var pid5=null;var proj5=PROJECTS.find(function(p){return p.name===d.name;});if(proj5&&proj5.id)pid5=proj5.id;
    if(cid5){fetch(_backendUrl()+'/api/conversations/'+cid5+'?hard=true',{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);intentsmith.agentLog('TOOL','Konverzace '+d.name+' trvale smazána.');fetchBackendData();}).catch(function(e){intentsmith.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(pid5){fetch(_backendUrl()+'/api/projects/'+pid5+'?hard=true',{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);intentsmith.agentLog('TOOL','Projekt '+d.name+' trvale smazán.');fetchBackendData();}).catch(function(e){intentsmith.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
  }else if(a==='Spustit'||a==='Pozastavit'||a==='Povolit'){
    var worker=d._itemId?WORKERS.find(function(w){return w.id===d._itemId;}):WORKERS.find(function(w){return w.name===d.name;});
    if(!worker||!worker.id||!worker.native){intentsmith.agentLog('TOOL','❌ Agent nemá ověřené native ovládání. Legacy záznam je pouze ke čtení.');return;}
    var action=a==='Spustit'?'run':a==='Povolit'?'enable':'disable';
    intentsmith.agentLog('TOOL','Požadavek pro agenta '+d.name+' probíhá…');
    return fetch(_backendUrl()+'/api/agent-extensions/instances/'+encodeURIComponent(worker.id)+'/'+action,{method:'POST',signal:AbortSignal.timeout(action==='run'?300000:5000)})
      .then(function(r){return r.json().then(function(body){if(!r.ok)throw new Error(body.error||body.code||'HTTP '+r.status);return body;});})
      .then(function(body){
        if(action==='run'){
          if(body.status!=='success')throw new Error('Běh nebyl úspěšně dokončen: '+(body.status||'neplatná odpověď')+(body.reason?' — '+body.reason:''));
          intentsmith.agentLog('TOOL','Agent '+d.name+' dokončil běh.');
        }else{
          if(body.id!==worker.id||body.enabled!==(action==='enable'))throw new Error('Server nepotvrdil požadovaný stav agenta.');
          intentsmith.agentLog('TOOL','Plánování agenta '+d.name+(body.enabled?' povoleno.':' pozastaveno. Právě běžící úloha může pokračovat.'));
        }
        fetchBackendData();
      }).catch(function(error){intentsmith.agentLog('TOOL','❌ Agent '+d.name+': '+error.message+' Stav ověřte obnovením přehledu.');fetchBackendData();});
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
    fetch(_backendUrl()+'/api/marketplace/export/'+_pubType+'/'+_pubId,{method:'POST',signal:AbortSignal.timeout(30000)})
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
  fetch(_backendUrl()+'/api/conversations/'+conv.id+'/assign',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({project_id:projectId}),signal:AbortSignal.timeout(5000)})
  .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
  .then(function(){
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','Konverzace "'+convTitle+'" přidána do projektu.');
    _centerState._projectPicker=null;fetchBackendData();renderCenter();
  }).catch(function(err){
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','Chyba při přiřazení: '+(err.message||'neznámá chyba'));
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
              onClick:function(ev){ev.stopPropagation();f.v=!f.v;var ex=EXPERTISES.find(function(e){return e.name===f._expertiseName;});if(ex){ex.fav=f.v;if(ex.id){fetch(_backendUrl()+'/api/expertises/'+ex.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:f.v}),signal:AbortSignal.timeout(3000)}).catch(function(){});}}renderCenter();}},f.v?'★':'☆'):
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
            var btnS=i===0?{padding:'5px 14px',borderRadius:isL?4:5,border:'none',background:C.accent,color:C.onAccent,fontFamily:C.font,fontSize:_fs(11),fontWeight:700,cursor:'pointer',transition:'background 0.15s'}
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
              var intentsmith=window._intentsmith;if(!intentsmith)return;
              if(cv.id){_smartRouteToRelay(function(_ti){
                var _ts=_sessions[_ti];
                _ts._convId=cv.id;_ts._label=cv.title||'Konverzace';_ts._m2Pending=null;_persistSessionState();
                fetch(_backendUrl()+'/api/conversations/'+cv.id+'/messages',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(msgs){
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
document.addEventListener('intentsmith-file-open',function(e){
  var path=e.detail&&e.detail.path;
  if(!path)return;
  _openFileTab(path);
});
/* ── File → Open Folder handler (Theia command override) ── */
document.addEventListener('intentsmith-open-folder',function(){
  try{var inp=document.createElement('input');inp.type='file';inp.webkitdirectory=true;
    inp.addEventListener('change',function(){if(!inp.files||!inp.files.length)return;var fp=(inp.files[0].path||'').replace(/\\/g,'/').split('/');var folderPath=fp.slice(0,-1).join('/');if(!folderPath)return;_intentsmithOpenFolderDo(folderPath);});
    inp.click();}catch(e){if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Nelze otevřít dialog: '+(e.message||e));}
});
function _intentsmithOpenFolderDo(folderPath){
  fetch(_backendUrl()+'/api/projects/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({folderPath:folderPath}),signal:AbortSignal.timeout(15000)})
  .then(function(r){if(!r.ok)throw new Error('Server error '+r.status);return r.json();})
  .then(function(res){
    var proj=res.project;var realPath=(proj&&proj.path)||folderPath;
    _wtRoot=realPath;_loadWorkspaceTree(realPath);
    _smartRouteToRelay(function(_ti){
      if(proj&&proj.id){_sessions[_ti]._projectId=proj.id;_sessions[_ti]._conversationFocus=false;_sessions[_ti]._label=proj.name||folderPath.split('/').filter(Boolean).pop()||'Projekt';_sessions[_ti]._m2Pending=null;_syncFocusClass();_persistSessionState();}
      if(window._intentsmith){window._intentsmith.agentLog('TOOL','📂 Složka otevřena: '+realPath);}
      fetchBackendData();renderCenter();renderChat();
    });
  }).catch(function(err){
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','❌ Chyba: '+(err.message||err));
  });
}
document.addEventListener('intentsmith-diff-open',function(e){
  var d=e.detail;if(!d)return;
  var totalLines=((d.oldContent||'').split('\n').length)+((d.newContent||'').split('\n').length);
  var tab={id:'diff-'+(d.reqId||Date.now()),type:'diff',path:d.path||'',
    label:'~ '+(d.path||'').split('/').pop(),reqId:d.reqId||null,baseHash:d.baseHash||null,
    tooLarge:totalLines>4000,dirty:false,scrollTop:0,deleted:false,externalChange:false,
    diffData:totalLines>4000?null:{hunks:computeLineDiff(d.oldContent,d.newContent)}};
  _showWorkspace();_sessions[_sessionActive]._chatCollapsed=true;
  _editorState.tabs.push(tab);
  _editorState.activeTabId=tab.id;
  _editorState.active=true;
  renderCenter();
});
/* ── Dirty tab guard ── */
window.addEventListener('beforeunload',function(e){
  if(_sessions.some(function(s){return s._editor&&s._editor.tabs.some(function(t){return t.dirty;});})){e.preventDefault();e.returnValue='Máte neuložené změny.';}
});
/* Restore each editor into its owning session; reconnect must not steal focus. */
var _workspaceEditorsRestored=false;
if(typeof IntentSmithBus!=='undefined'){
  IntentSmithBus.on('ws:ready',function(){
    if(_workspaceEditorsRestored)return;_workspaceEditorsRestored=true;
    try{var saved=JSON.parse(localStorage.getItem('intentsmith-editor-state')||'null');
      var rows=saved&&saved.version===2&&Array.isArray(saved.sessions)?saved.sessions:null;
      if(rows)rows.slice(0,_sessionCount).forEach(function(row,idx){if(row&&Array.isArray(row.openFiles))row.openFiles.slice(0,30).forEach(function(f){if(f&&typeof f.path==='string')_openFileTab(f.path,idx,true);});});
      else if(saved&&Array.isArray(saved.openFiles))saved.openFiles.slice(0,30).forEach(function(f){if(f&&typeof f.path==='string')_openFileTab(f.path,_sessionActive,true);});
    }catch(e){}
  });
}
/* v132: Attach media event listeners (guarded — single attach) */
if(typeof MediaEvents!=='undefined')MediaEvents.attach();

/* Nav event handler */
window.addEventListener('intentsmith-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;_centerState.detailConversations=null;_centerState.settingsSection=null;_centerState._bulkMode=false;_centerState._bulkSelected=[];if(_centerContainer)_centerContainer.style.display='';_settingsVals.lastView=e.detail.view||'';_saveSV();fetchBackendData();renderCenter();
  if(e.detail.select){
    var name=e.detail.select,view=e.detail.view,item=null;
    if(view==='expertises'){item=EXPERTISES.find(function(x){return x.name===name||x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Typ',v:item.desc},{k:'Doména',v:item.domain||'general'},{k:'Emoji',v:item.emoji},{k:'Specialista',v:item.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:item.fav?'Ano':'Ne'}],tags:[item.isSpecialist?'Specialista':'Expertyza',item.domain||item.desc].filter(Boolean),actions:['Otevřít','Editovat']});}
    else if(view==='projects'){item=PROJECTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,_itemId:item.id,fields:[{k:'Status',v:item.status,a:item.status==='Active'},{k:'Cesta',v:item.path||''},{k:'Popis',v:item.desc||''},{k:'Vytvořeno',v:item.created}],tags:item.tags,actions:['Otevřít','Editovat','Archivovat']});}
    else if(view==='chats'){item=CONVERSATIONS.find(function(x){return x.title.indexOf(name)>=0;});if(item)setDetail({name:item.title,fields:[{k:'Expertyza',v:item.expertise},{k:'Čas',v:item.time}],tags:['Chat',item.expertise],actions:['Otevřít','Archivovat']});}
    else if(view==='specialists'){item=SPECIALISTS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail({name:item.name,fields:[{k:'Oblast',v:item.desc}],tags:item.tags,actions:['Otevřít','Editovat']});}
    else if(view==='workers'){item=WORKERS.find(function(x){return x.name.indexOf(name)>=0;});if(item)setDetail(_workerDetail(item));}
  }
});


/* ═══════════════════════════════════════════════════════════
   3. CHAT PANEL — pure DOM via ReactDOM.render (NO ReactWidget)
   ═══════════════════════════════════════════════════════════ */
var INTENTSMITH_CHAT_ID='intentsmith-chat-panel';

/* ── Shared session state (links chat ↔ bottom panel) ── */
var _sessionCount=1;
var _sessionActive=0;
function _mkSession(){return{
  _uiId:Date.now().toString(36)+Math.random().toString(36).slice(2),
  _convId:null,          /* conversationId — stable routing key */
  _projectId:null,       /* linked project */
  _agentId:null,         /* G1: agent binding — persists with conversation metadata */
  _openToken:null,       /* guard: project switch during async — stale responses ignored */
  _lifecycleResumed:false, /* guard: lifecycle resume message shown only once */
  _m2Pending:null,       /* exact durable {lifecycleId,planDigest,origin} awaiting explicit approval */
  _label:'',             /* v90: snapshot label for relay header — persisted */
  chat:{msgs:[{role:'system',text:'IntentSmith připraven. Začni psát zprávu.'}],ctx:0,expertise:'Výchozí',specialist:null,showExpertises:false,showAllExpertises:false,attachments:[],editMode:'ask',editingIdx:null,editOriginalText:null,acSuggestion:null,acLoading:false,_thinking:null,_delivery:null,_sendContextToken:{},_sendTurnToken:{},_preparedSend:null},
  _closed:false,_history:null,_editor:{active:false,tabs:[],activeTabId:null,scrollRaf:null},_chatCollapsed:false,_chatPosition:'bottom',_outputHeight:210,
  bottom:'agent', /* 'agent' | 'terminal' | 'split' | 'mix' */
  log:[],
  term:[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}],
  _focusFiles:[],  /* v92: files tracked during specialist focus mode */
  _focusBulkMode:false,  /* v92: file selection mode */
  _focusBulkSelected:[],  /* v92: selected file indices */
  _conversationFocus:false /* v125.7: default OFF — focus activates on explicit user action (toggle/new conv), not on startup */
};}
var _sessions=[_mkSession()];
/* Expose globally so terminal-client.js and agent-client.js can access session state */
window._sessions=_sessions;
_editorState=_sessions[0]._editor;
function _ensureSessions(){while(_sessions.length<_sessionCount)_sessions.push(_mkSession());}
function _setSessionCount(n){
  var nextCount=Math.max(1,Math.min(24,n));
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
  document.body.classList.remove('intentsmith-focus-mode');
  if(_centerContainer)_centerContainer.style.display='';
  _syncWorkspacePanels();
}
function _renderAll(){_syncFocusClass();renderCenter();renderChat();renderAgent();renderSidebar();}
function _focusFileExists(s,name,path){return s._focusFiles.some(function(x){return(path&&x.path&&x.path===path)||x.name===name;});}
function _relativeTime(ts){if(!ts)return '';var d=Date.now()-ts;if(d<60000)return 'teď';if(d<3600000)return Math.round(d/60000)+' min';if(d<86400000)return Math.round(d/3600000)+' h';return Math.round(d/86400000)+' d';}

/* v90: Relay helpers */
function _isSessionEmpty(s){
  return !!s&&!s._closed&&!s._convId&&!s._projectId&&!s._agentId&&!s._m2Pending
    &&!(s._editor&&s._editor.tabs.length)&&!(s.term&&s.term.length>1)
    &&(!s.chat||(!s.chat.specialist&&!s.chat._thinking&&!s.chat._m2Busy
      &&!(s.chat._draft||'').trim()&&!(s.chat.attachments&&s.chat.attachments.length)
      &&(!s.chat.msgs||s.chat.msgs.length<=1&&s.chat.msgs.every(function(m){return m.role==='system';}))));
}
function _findFreeRelay(excludeIdx){for(var i=0;i<_sessionCount;i++){if(i===excludeIdx||_sessions[i]._closed)continue;if(_isSessionEmpty(_sessions[i]))return i;}return -1;}
/* v90: Relay picker dialog state */
var _relayPickDialog=null; /* null | {callback, action} */
function _chatPrepareRelayTarget(idx){
  var target=_sessions[idx];
  if(!_chatCancelPreparedSend(idx,target))_chatInvalidatePreparedSends(target&&target.chat);
}
function _smartRouteToRelay(callback){
  var idx=_findFreeRelay(-1);if(idx<0)idx=_addWorkspaceSession();if(idx<0)return;
  _switchSession(idx);_chatPrepareRelayTarget(idx);_showWorkspace();callback(idx);
}

/* v91: Open-target dialog — replace current session vs open in new */
var _openTargetDialog=null; /* null | {type:'conv'|'proj', data:Object, loadFn:Function} */
function _showOpenDialog(type,data,loadFn){
  var existing=_sessions.findIndex(function(s){return !s._closed&&(type==='conv'?s._convId===data.id:s._projectId===data.id);});
  if(existing>=0){_switchSession(existing);_showWorkspace();return;}
  var idx=_isSessionEmpty(_sessions[_sessionActive])?_sessionActive:_addWorkspaceSession();
  if(idx<0)return;
  _switchSession(idx);_chatPrepareRelayTarget(idx);_showWorkspace();loadFn(idx);
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
  s._label='';s._convId=null;s._agentId=null;s._projectId=null;s._lifecycleResumed=false;s._m2Pending=null;
  s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
}
function _newChatInProject(idx){
  var s=_sessions[idx];if(!s)return;
  if(_workspaceBusy(idx)){alert('Nejdřív dokonči nebo zastav probíhající úlohu.');return;}
  var project=s._projectId, spec=s.chat.specialist,label=s._label;
  if(!_closeWorkspaceConversation(idx))return;
  s=_sessions[idx];s._projectId=project;s._label=label;
  if(spec)_chatSelectSpecialist(s,spec);
  _persistSessionState();_renderAll();
}
function _newChatDialogAction(choice){
  if(!_newChatDialog)return;
  var idx=_newChatDialog.idx;var s=_sessions[idx];if(!s){_newChatDialog=null;renderChat();return;}
  if(choice==='project'||choice==='free')_chatInvalidatePreparedSends(s.chat);
  if(choice==='project'){
    /* New conversation in same project */
    s._label=_newChatDialog.projectName;
    s.chat.msgs=[{role:'system',text:'📂 Nová konverzace v projektu: '+_newChatDialog.projectName}];
    s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;s._convId=null;s._agentId=null;s._m2Pending=null;
    /* Create new conversation linked to project */
    fetch(_backendUrl()+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:_newChatDialog.projectId,title:_newChatDialog.projectName}),signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();}).then(function(d){if(d.id||d.conversation){s._convId=(d.conversation||d).id;_persistSessionState();}}).catch(function(){});
  } else if(choice==='free'){
    /* New conversation outside project */
    s._label='';
    s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];s.chat._thinking=null;s.chat._delivery=null;
    s._convId=null;s._agentId=null;s._projectId=null;s._lifecycleResumed=false;s._m2Pending=null;
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
  var idx=_closeDialog.idx;_closeDialog=null;
  if(choice==='conv')_closeWorkspaceConversation(idx);
  if(choice==='pane')_closeWorkspaceSession(idx);
  _renderAll();
}

var _chatContainer=null;

/* ── Bus subscriptions (transport → UI) ── */
function _initBusSubscriptions() {
  if (typeof IntentSmithBus === 'undefined') { console.warn('[IntentSmith] IntentSmithBus not available yet'); return; }

  /* Chat messages from assistant */
  IntentSmithBus.on('chat:message', function(ev) {
    var s = _sessions[ev.sessionIdx];if(!s||s._closed)return;
    s.chat._thinking = null; /* v90: response arrived — clear thinking indicator */
    s.chat.msgs.push({role:'assistant', text:ev.content, tag:ev.tag||'LLM'});
    s._history=null;
    /* Update session convId from backend response (new conversation or first message) */
    var respConvId = ev.metadata && ev.metadata.conversationId;
    if (respConvId && !s._convId) { s._convId = respConvId; _persistSessionState(); }
    if (ev.metadata && typeof ev.metadata.contextPercent === 'number') s.chat.ctx = ev.metadata.contextPercent;
    /* v65.0: If SHELL intent — switch to split/terminal so user sees output */
    if (ev.metadata && ev.metadata.shellCommand) {
      if (s.bottom !== 'terminal') { s.bottom = 'terminal'; }
      renderAgent();
    }
    /* v88+v122.2: Refresh expertises after create-expertise or create-specialist skill completes */
    _maybeRefreshExpertises(ev.metadata);
    renderChat(); _chatScrollPane(ev.sessionIdx);
  });

  /* Negotiated M1 has one terminal seam for ok/cancel/timeout/error. */
  IntentSmithBus.on('chat:terminal', function(ev) {
    var s = _sessions[ev.sessionIdx] || null;
    if (!s || !s.chat) return;
    var result = ev.result || {};
    s._history=null;
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
      s.chat._projectWorkProposal = metadata.projectWorkProposal && metadata.projectWorkProposal.kind === 'ProjectWorkProposal@1' && metadata.projectWorkProposal.projectId === Number(s._projectId)
        ? _m2NormalizeWorkProposal({proposal:metadata.projectWorkProposal,origin:_m2StudioOrigin(s)}) : null;
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
  IntentSmithBus.on('chat:system', function(ev) {
    _appendSessionLog(ev.sessionIdx,'TOOL',ev.content);
  });

  /* Session changed (rehydration after WS reconnect) */
  IntentSmithBus.on('session:changed', function(ev) {
    renderChat(); renderAgent();
    if (typeof ev.idx === 'number') _chatScrollPane(ev.idx);
  });

  /* A fresh Studio pane receives a durable routing identity before first send. */
  IntentSmithBus.on('session:identity', function() {
    _persistSessionState();
  });

  /* WS reconnected — trigger re-render to show restored messages */
  IntentSmithBus.on('ws:reconnected', function() {
    renderChat(); renderAgent();
  });

  /* Agent log entries (from agent-client.js formatter) */
  IntentSmithBus.on('agent:log', function(ev) {
    var s = _sessions[ev.sessionIdx];if(!s||s._closed)return;
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
  IntentSmithBus.on('agent:state', function() {
    renderAgent();
  });

  /* Terminal lines (from terminal-client.js) */
  IntentSmithBus.on('terminal:line', function(ev) {
    renderAgent();
  });

  /* Status updates (context %, health) */
  IntentSmithBus.on('status:update', function(ev) {
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
  IntentSmithBus.on('edit:request', function(ev) {
    var si = ev.sessionIdx;
    var s = _sessions[si] || _sessions[0];
    var d = ev.event || {};
    var p = d.payload || d;
    if (s.chat.editMode === 'ask') {
      var reqId = p.reqId || p.requestId || d.id || ('er-' + Date.now());
      var file = p.file || '';
      if (typeof IntentSmithWS !== 'undefined') IntentSmithWS.trackEditRequest(reqId, file, null, si);
      /* Open diff tab in center editor */
      if (p.oldContent !== undefined || p.newContent !== undefined) {
        document.dispatchEvent(new CustomEvent('intentsmith-diff-open', {
          detail: { reqId: reqId, path: file, oldContent: p.oldContent || '', newContent: p.newContent || '', baseHash: p.baseHash || null }
        }));
      }
      s.chat.msgs.push({role:'assistant', text:'✋ Editace: ' + file + ' — otevřen diff v centru', tag:'EDIT', _editReqId: reqId});
      renderChat(); _chatScrollPane(si);
    }
  });

  /* Edit resolved */
  IntentSmithBus.on('edit:resolved', function(ev) {
    renderChat(); renderAgent();
  });

  /* Workspace file changes (F3 — dirty tab protection) */
  IntentSmithBus.on('workspace:change', function(ev) {
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
  IntentSmithBus.on('ws:ready', function(ev) {
    _modelsDisconnected=false;_refreshModelWorkspace();
    _serverHealth.wsConnected = true;
    _serverHealth.status = 'ok';
    renderSidebar();_updateStatusIndicator();
  });

  /* WS disconnected */
  IntentSmithBus.on('ws:disconnected', function(ev) {
    _modelsDisconnected=true;_modelReadEpoch++;renderCenter();
    _serverHealth.wsConnected = false;
    if (ev.wasReady) {
      if(window._intentsmith)window._intentsmith.agentLog('TOOL','⚠️ Spojení s backendem ztraceno. Pokus o reconnect...');
    }
    renderSidebar();_updateStatusIndicator();
  });

  /* WS reconnect budget exhausted — remain visibly offline. */
  IntentSmithBus.on('ws:reconnect_exhausted', function(ev) {
    _serverHealth.wsConnected = false;
    _serverHealth.status = 'offline';
    if(window._intentsmith)window._intentsmith.agentLog(
      'TOOL',
      '⚠️ Backend zatím neodpovídá po '+ev.attempts+' pokusech. Spojení znovu ověřím při kontrole backendu; můžeš také použít Zkusit znovu.'
    );
    renderSidebar();_updateStatusIndicator();
  });

  /* WS reconnected */
  IntentSmithBus.on('ws:reconnected', function(ev) {
    if(window._intentsmith){
      if(ev&&ev.status==='degraded'){
        window._intentsmith.agentLog('TOOL','⚠️ Spojení obnoveno, ale některé relace se nepodařilo bezpečně obnovit.');
      }else{
        window._intentsmith.agentLog('TOOL','✅ Spojení obnoveno.');
      }
    }
    renderSidebar();
  });

  /* Model pull progress (v121.2) */
  IntentSmithBus.on('model:pull_progress', function(ev) {
    // WS wakes the reader; HTTP is the same authority after missed events,
    // reloads and automatic recovery of a pre-existing download.
    _loadDownloads();
  });

  /* v125: Model changed via WS (fire-and-forget apply) */
  IntentSmithBus.on('model:changed', function(ev) {
    _upgradeLoading=false;_assigningRole=null;_roleBindings=null;_modelOverview=null;_evaluationData=null;
    _upgradeMsg={ok:true,text:'Upgrade '+ev.role+': '+(ev.fromModel||'?')+' \u2192 '+(ev.toModel||'?')};
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\u2705 Model zm\u011Bn\u011Bn: '+ev.role+' '+(ev.fromModel||'?')+' \u2192 '+(ev.toModel||'?'));
    _upgradeData=null;_loadUpgradeData();renderCenter();
    setTimeout(function(){_upgradeMsg=null;renderCenter();},5000);
  });

  /* v125: Upgrade progress (intermediate status) */
  IntentSmithBus.on('upgrade:progress', function(ev) {
    _upgradeMsg={ok:true,text:ev.text||'Aplikuji...'};
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\uD83D\uDD04 '+(ev.text||'Aplikuji upgrade...'));
    renderCenter();
  });

  /* v125: Upgrade error via WS */
  IntentSmithBus.on('upgrade:error', function(ev) {
    _upgradeLoading=false;
    var errMsg=ev.error||'Upgrade selhal';
    /* Translate common BE errors to user-friendly CZ */
    if(errMsg.indexOf('already set')>=0)errMsg='Model je ji\u017E nastaven pro tuto roli';
    else if(errMsg.indexOf('Upgrade in progress')>=0)errMsg='Prob\u00EDh\u00E1 jin\u00FD upgrade \u2014 vy\u010Dkejte';
    else if(errMsg.indexOf('file does not exist')>=0||errMsg.indexOf('not found')>=0)errMsg='Model neexistuje v Ollama registru \u2014 nelze st\u00E1hnout';
    else if(errMsg.indexOf('not installed')>=0)errMsg='Model nen\u00ED nainstalovan\u00FD a pull selhal';
    _upgradeMsg={ok:false,text:errMsg};
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\u274C Upgrade selhal: '+errMsg);
    renderCenter();
    setTimeout(function(){_upgradeMsg=null;renderCenter();},8000);
  });

  /* v125: Background verify failed warning; 022/A: optionally actionable */
  IntentSmithBus.on('upgrade:verify_failed', function(ev) {
    var identity=_exactRecoveryIdentity(ev);
    _verifyFailure={role:ev.role||null,model:ev.model||null,
      text:ev.text||'Varov\u00E1n\u00ED: model neodpov\u00EDd\u00E1 na ping',identity:identity};
    _rollbackConfirm=false;
    _upgradeMsg={ok:false,text:_verifyFailure.text};
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\u26A0\uFE0F '+_verifyFailure.text);
    renderCenter();
    setTimeout(function(){_upgradeMsg=null;renderCenter();},15000);
  });

  /* 022/A: bounded clear event — UX invalidation only, never authority. */
  IntentSmithBus.on('upgrade:verify_cleared', function(ev) {
    if(!_verifyFailure)return;
    if(!ev||!ev.operationId)return;
    if(!_verifyFailure.identity||_verifyFailure.identity.operationId!==ev.operationId)return;
    _verifyFailure=null;_rollbackConfirm=false;renderCenter();
  });

  /* v133: Model deleted — refresh overview */
  IntentSmithBus.on('model:deleted', function(ev) {
    _modelOverview=null;_installedModels=null;_ollamaModels=null;_deletingModel=null;_deleteConfirm=null;
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\uD83D\uDDD1 Model smaz\u00E1n: '+ev.model+' (uvoln\u011Bno '+ev.freedGB+' GB)');
    renderCenter();
  });

  /* v133: Auto-cleanup deleted a model */
  IntentSmithBus.on('model:auto_cleaned', function(ev) {
    _modelOverview=null;_installedModels=null;_ollamaModels=null;
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\uD83E\uDDF9 Auto-cleanup: smaz\u00E1n '+ev.model);
    renderCenter();
  });

  /* v133: Auto-rebind — bound model disappeared externally */
  IntentSmithBus.on('model:auto_rebound', function(ev) {
    _roleBindings=null;_modelOverview=null;
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','\uD83D\uDD04 Auto-rebind: '+ev.role+' '+ev.from+' \u2192 '+ev.to);
    renderCenter();
  });

  /* Session changed (e.g. after rehydration) */
  IntentSmithBus.on('session:changed', function(ev) {
    renderChat(); renderAgent();
    _persistSessionState();
  });

  /* Transport already cleared this exact unchanged session after a complete ACK. */
  IntentSmithBus.on('session:invalidated', function(ev) {
    if(
      !ev
      || typeof ev.idx!=='number'
      || _sessions[ev.idx]!==ev.sessionRef
      || ev.sessionRef._convId!==null
    )return;
    var s=ev.sessionRef;
    _chatInvalidatePreparedSends(s.chat);
    _persistSessionState();
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','⚠️ Konverzace již neexistuje na serveru.');
    renderChat();renderAgent();
  });

  /* Malformed persisted identity is preserved but cannot perform chat effects. */
  IntentSmithBus.on('session:quarantined', function(ev) {
    if(!ev||typeof ev.idx!=='number'||_sessions[ev.idx]!==ev.sessionRef)return;
    _chatInvalidatePreparedSends(ev.sessionRef.chat);
    _persistSessionState();
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','⚠️ Relace má neplatnou lokální identitu a zůstává pouze pro čtení.');
    renderChat();renderAgent();
  });

  /* A legacy uncorrelated warning has no authority to mutate a panel. */
  IntentSmithBus.on('session:identity_warning', function() {
    if(window._intentsmith)window._intentsmith.agentLog('TOOL','⚠️ Server ohlásil neověřený stav identity; relace byla zachována.');
  });
}

/* ── Health state ── */
var _serverHealth = {status:'unknown', wsConnected:false, lastCheck:0, version:null};

/* ── Status-bar health indicator (injected into Theia status bar) ── */
function _updateStatusIndicator(){
  var el=document.getElementById('intentsmith-health-indicator');
  if(!el){
    var bar=document.querySelector('#theia-statusBar .area.left');
    if(!bar)return;
    el=document.createElement('div');
    el.id='intentsmith-health-indicator';
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
  _sessions.forEach(_rememberSpecialistFiles);
  clearTimeout(_persistDebounce);
  _persistDebounce = setTimeout(function() {
    try {
      localStorage.setItem('intentsmith-session-state', JSON.stringify({
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
            label: s._label, closed:!!s._closed, contextTab:s._contextTab||'history', chatPosition:s._chatPosition||'bottom',
            expertiseName: s.chat.expertise,
            specialistData: s.chat.specialist,
            editMode: s.chat.editMode,
            bottomMode: s.bottom,
            wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
            recentMsgs: recentMsgs,
            focusFiles: s._focusFiles||[],
            lastAttachDir: s.chat._lastAttachDir||'',
            m2Pending: _m2NormalizePending(s._m2Pending),
            projectWorkProposal: _m2NormalizeWorkProposal(s.chat._projectWorkProposal)
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
    localStorage.setItem('intentsmith-session-state', JSON.stringify({
      sessionCount: _sessionCount, sessionActive: _sessionActive,
      sessions: _sessions.map(function(s, i) {
        var recentMsgs = (s.chat.msgs || []).slice(-20).map(function(m) {
          return { role: m.role, text: m.text, tag: m.tag };
        });
        return {
          convId: s._convId, projectId: s._projectId, agentId: s._agentId,
          label: s._label, closed:!!s._closed, contextTab:s._contextTab||'history', chatPosition:s._chatPosition||'bottom',
          specialistData:s.chat.specialist, expertiseName: s.chat.expertise, editMode: s.chat.editMode,
          bottomMode: s.bottom,
          wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
          recentMsgs: recentMsgs,
          focusFiles: s._focusFiles||[],
          lastAttachDir: s.chat._lastAttachDir||'',
          m2Pending: _m2NormalizePending(s._m2Pending),
            projectWorkProposal: _m2NormalizeWorkProposal(s.chat._projectWorkProposal)
        };
      })
    }));
    /* Flush settings (lastView) synchronously */
    _settingsVals.lastView=_centerState.view||'';
    localStorage.setItem('intentsmith-settings',JSON.stringify(_settingsVals));
  } catch(e) {}
});

function _normalizePersistedSessionState(saved) {
  var count=(saved&&Number.isInteger(saved.sessionCount))
    ?Math.max(1,Math.min(24,saved.sessionCount)):1;
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
    var _lastV = (_settingsVals.restoreSession && _settingsVals.lastView) ? _settingsVals.lastView : '';
    /* v93: If lastView was toggled off (empty string), keep center hidden to show editor */
    if (_settingsVals.restoreSession && _settingsVals.lastView === '') {
      _centerState.view = null;
      if (_sidebarWidget) _sidebarWidget._active = null;
      /* v122.3: Don't hide center if conversation focus active — chat renders there */
      setTimeout(function(){ if(_centerContainer)_centerContainer.style.display=''; },50);
    } else {
      _centerState.view = _lastV;
      if (_sidebarWidget) _sidebarWidget._active = _lastV;
    }
    var saved = JSON.parse(localStorage.getItem('intentsmith-session-state') || 'null');
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
            _sessions[i]._closed=ss.closed===true;_sessions[i]._contextTab=ss.contextTab==='files'?'files':'history';_sessions[i]._chatPosition=ss.chatPosition==='top'?'top':'bottom';
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
            /* M2: Restore only the exact durable approval binding. */
            _sessions[i]._m2Pending=_m2NormalizePending(ss.m2Pending);
            _sessions[i].chat._projectWorkProposal=_m2NormalizeWorkProposal(ss.projectWorkProposal);
          }
          /* v81.2: Always clear editing state on restore — editing cannot survive restart */
          _sessions[i].chat.editingIdx=null;
          _sessions[i].chat.editOriginalText=null;
        }
      });
      if(!_workspaceSessionIndices().length)_sessions[_sessionActive]._closed=false;
      if(_sessions[_sessionActive]._closed)_sessionActive=_workspaceSessionIndices()[0];
      _editorState=_sessions[_sessionActive]._editor;
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
  if (typeof IntentSmithAgent !== 'undefined' && IntentSmithAgent.init) IntentSmithAgent.init();
  if (typeof IntentSmithTerminal !== 'undefined' && IntentSmithTerminal.init) IntentSmithTerminal.init();

  /* Connect WS */
  if (typeof IntentSmithWS !== 'undefined' && IntentSmithWS.connect) {
    IntentSmithWS.connect();
  }
}
/* Delayed init — give modules time to load */
setTimeout(_initTransport, 200);

var _chatRoot=null;
function renderChat(){if(_workspaceShown())renderCenter();if(!_chatContainer)return;if(!_chatRoot)_chatRoot=_createRoot(_chatContainer);_chatRoot.render(h(ChatApp,null));}
function _chatScrollPane(idx){setTimeout(function(){var f=document.getElementById('intentsmith-chat-feed-'+idx);if(f)f.scrollTop=f.scrollHeight;},60);}

function _chatSelectSpecialist(s,spec){
  if(s.chat._specialistSelecting)return Promise.resolve(false);
  s.chat._specialistSelecting=true;
  if(!s._convId)s._convId='studio-specialist-'+crypto.randomUUID();
  var id=spec&&spec.id==='accountant'?'accountant-cz':spec&&spec.id;
  return fetch(_backendUrl()+'/api/chat/specialist',{method:spec?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({specialistId:id,sessionId:s._convId}),signal:AbortSignal.timeout(5000)}).then(function(r){return r.json().then(function(d){if(!r.ok||!d.ok)throw new Error(d.error||'Aktivace specialisty selhala');
    _rememberSpecialistFiles(s);
    s.chat.specialist=spec?Object.assign({},spec,{id:id}):null;s.chat.expertise=spec?spec.name:'Výchozí';s._focusFiles=spec?_specialistFiles(id):[];s._history=null;s._storedFiles=null;s._filesError=null;s._focusBulkMode=false;s._focusBulkSelected=[];_showWorkspace();_renderAll();_persistSessionState();return true;
  });}).catch(function(e){s.chat.msgs.push({role:'system',text:e.message,tag:'ERROR'});renderChat();return false;}).finally(function(){s.chat._specialistSelecting=false;});
}
/* Expose for cross-component communication */
window._intentsmith={
  chatMsg:function(text){if(window._intentsmith)window._intentsmith.agentLog('TOOL',text);},
  setExpertise:function(name){var s=_sessions[_sessionActive]||_sessions[0];s.chat.expertise=name;renderChat();_persistSessionState();},
  getExpertise:function(){return(_sessions[_sessionActive]||_sessions[0]).chat.expertise;},
  setSpecialist:function(spec){var s=_sessions[_sessionActive]||_sessions[0];return _chatSelectSpecialist(s,spec);},
  clearSpecialist:function(){var s=_sessions[_sessionActive]||_sessions[0];return _chatSelectSpecialist(s,null);},
  getSpecialist:function(){return(_sessions[_sessionActive]||_sessions[0]).chat.specialist;},
  renderChat:renderChat,
  agentLog:function(type,text){_appendSessionLog(_sessionActive,type,text);},
  renderCenter:function(){renderCenter();},
  approveEdit:function(reqId){if(typeof IntentSmithWS!=='undefined')IntentSmithWS.approveEdit(reqId);},
  rejectEdit:function(reqId){if(typeof IntentSmithWS!=='undefined')IntentSmithWS.rejectEdit(reqId);},
  sessions:_sessions,
  getSessionActive:function(){return _sessionActive;},
  getSessionRoot:function(idx){var s=_sessions[idx];var p=s&&s._projectId&&PROJECTS.find(function(p){return p.id===s._projectId;});return p&&p.path||(_perSessionTree[idx]&&_perSessionTree[idx].wtRoot)||undefined;}
};

/* Autocomplete — Tab triggers backend completion */
/* H1: AbortController + LRU cache */
var _acAbort=null;
var _acCache={};
var _acOrder=[];
var _acMaxCache=20;

function _chatAutocomplete(idx){
  var ta=document.getElementById('intentsmith-chat-ta-'+idx);
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
  fetch(_backendUrl()+'/api/autocomplete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partial:partial,expertise:st.expertise,context:st.msgs.slice(-6).map(function(m){return{role:m.role,text:m.text};})}),signal:_acAbort.signal})
  .then(function(r){return r.json();})
  .then(function(d){
    st.acLoading=false;
    /* H1: Stale guard — check input hasn't changed */
    var currentTa=document.getElementById('intentsmith-chat-ta-'+idx);
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
  fetch(_backendUrl()+'/api/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:idx,messageCount:s.chat.msgs.length}),signal:AbortSignal.timeout(3000)})
  .then(function(r){return r.json();})
  .then(function(d){if(typeof d.percent==='number'){s.chat.ctx=d.percent;renderChat();}})
  .catch(function(){});
}

/* ── Message editing ── */
function _chatStartEdit(paneIdx,msgIdx){
  var s=_sessions[paneIdx];if(!s)return;var st=s.chat;
  var m=st.msgs[msgIdx];if(!m||m.role!=='user')return;
  st.editingIdx=msgIdx;st.editOriginalText=m.text;
  var ta=document.getElementById('intentsmith-chat-ta-'+paneIdx);
  if(ta){ta.value=m.text;ta.style.height='20px';ta.style.height=Math.min(ta.scrollHeight,100)+'px';ta.focus();}
  renderChat();
}
function _chatCancelEdit(paneIdx){
  var s=_sessions[paneIdx];if(!s)return;
  s.chat.editingIdx=null;s.chat.editOriginalText=null;
  var ta=document.getElementById('intentsmith-chat-ta-'+paneIdx);
  if(ta){ta.value='';ta.style.height='20px';}
  renderChat();
}

/* ── Read file attachments before sending ── */
var _TEXT_EXTS=/\.(js|ts|jsx|tsx|mjs|cjs|py|pyw|json|jsonc|json5|md|mdx|txt|css|scss|sass|less|html|htm|yaml|yml|xml|xsl|csv|tsv|sql|sh|bash|zsh|fish|ps1|bat|cmd|env|cfg|ini|log|toml|rs|go|java|c|cpp|cc|cxx|h|hpp|hxx|cs|rb|php|swift|kt|kts|r|lua|pl|pm|ex|exs|erl|hs|ml|mli|fs|fsx|vue|svelte|astro|scala|clj|cljs|cljc|dart|groovy|gradle|graphql|gql|proto|tf|hcl|dockerfile|makefile|cmake|properties|conf|nginx|prisma|sol|zig|nim|v|wasm|wat|lock|editorconfig|gitignore|gitattributes|dockerignore|npmrc|nvmrc|eslintrc|prettierrc|babelrc|browserslistrc|stylelintrc|rst|adoc|tex|latex|org|nix|dhall|jsonnet|jsx2|pug|jade|ejs|hbs|handlebars|mustache|twig|liquid|erb|haml|slim|razor|cshtml|diff|patch)$/i;
var _IMG_EXTS=/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff|tif|avif)$/i;
var _MAX_TEXT_SIZE=1024*1024;/* 1MB */
var _MAX_IMG_SIZE=5*1024*1024;/* 5MB */
var _DOC_EXTS=/\.(pdf|heic|heif)$/i;
var _MAX_DOC_SIZE=10*1024*1024;

/* Try Node.js fs (available in Electron renderer) */
var _nodeFs=null;
try{_nodeFs=window.require&&window.require('fs');}catch(e){}

function _readAttachments(attachments,callback){
  if(!attachments||attachments.length===0){callback([]);return;}
  var results=[];var pending=attachments.length;
  attachments.forEach(function(a,i){
    var filePath=(a.file&&a.file.path)?a.file.path:null;
    function _done(res){results[i]=res;if(--pending===0)callback(results);}
    /* ── TEXT FILES ── */
    if(_TEXT_EXTS.test(a.name)&&a.file&&a.file.size<=_MAX_TEXT_SIZE){
      /* Strategy A: FileReader (works in ALL contexts — standard Web API) */
      var reader=new FileReader();
      reader.onload=function(){
        if(reader.result){_done({name:a.name,size:a.size,type:'text',content:reader.result,path:filePath});return;}
        /* FileReader returned empty — fallback to path */
        if(filePath){_done({name:a.name,size:a.size,type:'text',content:null,path:filePath});}
        else{_done({name:a.name,size:a.size,type:'text',content:null,path:null});}
      };
      reader.onerror=function(){
        if(typeof console!=='undefined')console.warn('[IntentSmith:readAttachments] FileReader failed for',a.name,reader.error);
        /* FileReader failed — fallback to path-based backend reading */
        if(filePath){_done({name:a.name,size:a.size,type:'text',content:null,path:filePath});}
        else{_done({name:a.name,size:a.size,type:'text',content:null,path:null});}
      };
      reader.readAsText(a.file);return;
    }
    if(_DOC_EXTS.test(a.name)&&a.file&&a.file.size<=_MAX_DOC_SIZE){
      var mime=/\.pdf$/i.test(a.name)?'application/pdf':/\.heif$/i.test(a.name)?'image/heif':'image/heic';
      var dr=new FileReader();
      dr.onload=function(){var data=typeof dr.result==='string'?dr.result.replace(/^data:[^,]*,/, 'data:'+mime+';base64,'):null;_done({name:a.name,type:'document',content:data});};
      dr.onerror=function(){_done({name:a.name,type:'document',content:null});};
      dr.readAsDataURL(a.file);return;
    }
    /* ── IMAGE FILES ── */
    if(_IMG_EXTS.test(a.name)&&a.file&&a.file.size<=_MAX_IMG_SIZE){
      var reader2=new FileReader();
      reader2.onload=function(){_done({name:a.name,size:a.size,type:'image',content:reader2.result,path:filePath});};
      reader2.onerror=function(){_done({name:a.name,size:a.size,type:'image',content:null,path:filePath});};
      reader2.readAsDataURL(a.file);return;
    }
    /* ── UNKNOWN / BINARY / OVERSIZED ── */
    _done({name:a.name,size:a.size,type:'binary',content:null,path:filePath});
  });
}

/* ── 021 byte bridge: attach picker ──
   Three ways into `st.attachments` used to produce two different shapes. Drag&drop
   and <input type=file> yield real `File` objects; the Electron dialog branch had
   only a path, so it pushed `{file:{path,size:1024}}` — a `File` with no bytes.
   `_readAttachments` handed that to `FileReader`, got nothing, and emitted
   `content:null`, which the inline-only policy refuses. The user saw NOT_SENT on a
   file they had just picked.

   The dialog branch now spends a preload grant for the actual bytes and builds a
   real `File`, so all three ways converge on one shape and `_readAttachments`
   stays unchanged. The per-kind ceiling goes down to the read: an oversized file is
   refused from its stat instead of being read and thrown away in policy. */
function _attachCeilingFor(name){
  return _DOC_EXTS.test(name)?_MAX_DOC_SIZE:_IMG_EXTS.test(name)?_MAX_IMG_SIZE:_MAX_TEXT_SIZE;
}

function _attachSizeLabel(bytes){
  return bytes<1024?bytes+' B':Math.ceil(bytes/1024)+' KiB';
}

/* A refusal is reported against the file the user named, not swallowed. The item
   is left out of the list rather than added as an unsendable stub — a stub would
   only fail again at send, one step further from the pick. */
function _attachRefusal(st,refused){
  if(refused.length===0)return;
  st._delivery={status:'ATTACH_REFUSED',retryable:false,reason:refused[0].code,
    text:refused.map(function(r){return r.name+' ('+r.code+')';}).join(', ')};
}

function _chatPickAttachments(st,bridge,done){
  var finish=typeof done==='function'?done:function(){};
  if(!bridge||typeof bridge.pickAttachmentFiles!=='function'
    ||typeof bridge.readAttachmentBytes!=='function'){finish(null);return;}
  bridge.pickAttachmentFiles({title:'Připojit soubory',selectMany:true,defaultPath:st._lastAttachDir||''})
    .then(function(picked){
      var files=(picked&&Array.isArray(picked.files))?picked.files:[];
      if(picked&&typeof picked.directory==='string'&&picked.directory)st._lastAttachDir=picked.directory;
      if(files.length===0){finish([]);return;}
      var added=[];var refused=[];
      for(var i=0;i<files.length;i++){
        var f=files[i];
        if(!f||typeof f.name!=='string'||typeof f.token!=='string'){continue;}
        var ceiling=_attachCeilingFor(f.name);
        /* Cheap pre-check on the size the dialog already reported; the read
           re-checks against the open descriptor, which is the binding one. */
        if(typeof f.size==='number'&&f.size>ceiling){
          refused.push({name:f.name,code:'M1_BRIDGE_ITEM_TOO_LARGE'});continue;
        }
        var result=bridge.readAttachmentBytes(f.token,ceiling);
        if(!result||result.ok!==true||!result.bytes){
          refused.push({name:f.name,code:(result&&result.code)||'M1_BRIDGE_READ_FAILED'});continue;
        }
        var file;
        try{file=new File([result.bytes],f.name,{type:typeof f.type==='string'?f.type:''});}
        catch(e){refused.push({name:f.name,code:'M1_BRIDGE_READ_FAILED'});continue;}
        added.push({name:f.name,size:_attachSizeLabel(result.size),file:file});
      }
      for(var j=0;j<added.length;j++)st.attachments.push(added[j]);
      _attachRefusal(st,refused);
      finish(added);
    })
    .catch(function(e){
      if(typeof console!=='undefined')console.warn('[IntentSmith:attach] pickAttachmentFiles error:',e);
      finish(null);
    });
}

/* M1/011: Chat sends are WebSocket-only until M2 owns one effect authority.
   A successful WebSocket.send() is queued locally, not acknowledged by server. */
function _chatEnsureSpecialist(s){
  var spec=s.chat.specialist;
  if(!spec)return Promise.resolve();
  // Restore old sessions which stored the accountant expertise ID.
  var id=spec.id==='accountant'?'accountant-cz':spec.id;
  return fetch(_backendUrl()+'/api/chat/specialist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({specialistId:id,sessionId:s._convId}),signal:AbortSignal.timeout(5000)}).then(function(r){return r.json().then(function(d){if(!r.ok||!d.ok)throw new Error(d.error||'Aktivace specialisty selhala');spec.id=id;});});
}
function _chatTryWsSend(content,session,sessionIdx){
  try{
    if(typeof IntentSmithWS==='undefined'||!IntentSmithWS||typeof IntentSmithWS.isReady!=='function'||IntentSmithWS.isReady()!==true){
      return{status:'NOT_SENT',retryable:true,reason:'WS_UNAVAILABLE',serverAcknowledged:false};
    }
    if(typeof IntentSmithWS.sendChat!=='function'||IntentSmithWS.sendChat(content,session,sessionIdx)!==true){
      return{status:'NOT_SENT',retryable:!session.chat._m1AttachmentRejection,reason:session.chat._m1AttachmentRejection||'WS_SEND_REJECTED',serverAcknowledged:false};
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
  st._delivery={status:'NOT_SENT',retryable:delivery.retryable,reason:delivery.reason,text:text,draft:typeof draft==='string'?draft:text};
  renderChat();_chatScrollPane(idx);
}
function _chatDeliveryMessage(delivery){
  var reason=delivery.reason||'';
  var labels={M1_ATTACHMENT_NOT_INLINE:'Přílohu nelze přečíst nebo překračuje limit. Podporován je text, PNG/JPEG/GIF/WebP a PDF/HEIC (do '+Math.round(_MAX_DOC_SIZE/1048576)+' MiB).',M1_ATTACHMENT_TYPE_UNSUPPORTED:'Nepodporovaný formát přílohy.',M1_ATTACHMENT_ITEM_TOO_LARGE:'Příloha překračuje povolenou velikost.',M1_ATTACHMENT_AGGREGATE_TOO_LARGE:'Přílohy dohromady překračují povolenou velikost.',M1_ATTACHMENT_COUNT_EXCEEDED:'Lze připojit nejvýše 5 souborů.',M1_ATTACHMENT_SHAPE_INVALID:'Příloha neobsahuje platná data.'};
  return 'NOT_SENT · Zpráva nebyla odeslána. '+(labels[reason]|| (reason==='WS_UNAVAILABLE'?'Spojení není připravené. Zkus zprávu odeslat po obnovení spojení.':'Odeslání se nezdařilo ('+reason+').'))+' Rozepsaná zpráva a přílohy zůstaly zachované.';
}
function _chatClearDelivery(st){st._delivery=null;}
function _chatInvalidatePreparedSends(st){
  if(!st)return;
  st._sendContextToken={};st._sendTurnToken={};st._preparedSend=null;st._pendingAttachments=null;
}
function _chatCaptureSendContext(idx,s,st,userMsg,rawDraft,filesToRead,ta,text){
  if(!st._sendContextToken)st._sendContextToken={};st._sendTurnToken={};
  var prepared={idx:idx,session:s,chat:st,msgs:st.msgs,sessionEpoch:st._sendContextToken,turnEpoch:st._sendTurnToken,
    convId:s._convId,agentId:s._agentId,projectId:s._projectId,editMode:st.editMode,specialist:st.specialist,
    conversationFocus:!!s._conversationFocus,focusActive:!!(st.specialist||s._conversationFocus),
    userMsg:userMsg,userMsgIdx:st.msgs.length-1,messageCount:st.msgs.length,
    rawDraft:rawDraft,attachments:filesToRead,textarea:ta,text:text,thinking:st._thinking};
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
    &&captured.chat.specialist===captured.specialist
    &&captured.chat.editMode===captured.editMode
    &&!!captured.session._conversationFocus===captured.conversationFocus;
}
function _chatReleasePreparedSend(captured){
  if(captured&&captured.chat&&captured.chat._preparedSend===captured)captured.chat._preparedSend=null;
}
function _chatRejectPreparedSend(captured,reason){
  if(!captured||!captured.chat||captured.chat._preparedSend!==captured)return false;
  _chatReleasePreparedSend(captured);captured.chat._sendContextToken={};captured.chat._sendTurnToken={};captured.chat._pendingAttachments=null;
  var ownsTimeline=captured.idx>=0&&captured.idx<_sessionCount
    &&_sessions[captured.idx]===captured.session
    &&captured.session.chat===captured.chat
    &&captured.chat.msgs===captured.msgs
    &&captured.chat.msgs[captured.userMsgIdx]===captured.userMsg;
  if(!ownsTimeline)return true;
  captured.userMsg.tag='NOT_SENT';captured.userMsg.deliveryStatus='NOT_SENT';captured.userMsg.deliveryReason=reason;captured.userMsg.retryable=true;
  _chatRestoreInput(captured.textarea,captured.rawDraft);_chatRestoreAttachments(captured.chat,captured.attachments);
  if(captured.chat._thinking===captured.thinking)captured.chat._thinking=null;
  captured.chat._delivery={status:'NOT_SENT',retryable:true,reason:reason,text:captured.text,draft:captured.rawDraft};
  renderChat();_chatScrollPane(captured.idx);
  return true;
}
function _chatCancelPreparedSend(idx,s){
  var st=s&&s.chat;var prepared=st&&st._preparedSend;
  if(!prepared)return false;
  return _chatRejectPreparedSend(prepared,'CANCELLED_BEFORE_SEND');
}

/* ── M2 lifecycle — explicit Studio plan/approval surface ── */
var _M2_TERMINAL_STATES={succeeded:true,failed:true,cancelled:true,timed_out:true,orphaned:true,blocked:true};
function _m2IsRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function _m2NormalizePending(value){
  if(!_m2IsRecord(value)||typeof value.lifecycleId!=='string'||!value.lifecycleId.trim()
    ||typeof value.planDigest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value.planDigest)||!_m2IsRecord(value.origin))return null;
  var origin=value.origin;
  if(origin.surface!=='studio'||typeof origin.sessionId!=='string'||!origin.sessionId.trim()
    ||typeof origin.conversationId!=='string'||!origin.conversationId.trim()
    ||!Number.isSafeInteger(origin.projectId)||origin.projectId<1)return null;
  return {lifecycleId:value.lifecycleId,planDigest:value.planDigest,origin:{
    surface:'studio',sessionId:origin.sessionId,conversationId:origin.conversationId,projectId:origin.projectId
  }};
}
function _m2NormalizeWorkProposal(value){
  if(!_m2IsRecord(value)||!_m2IsRecord(value.origin)||!_m2IsRecord(value.proposal))return null;
  var p=value.proposal;var d=p.draft;var o=value.origin;
  if(p.kind!=='ProjectWorkProposal@1'||!Number.isSafeInteger(p.projectId)||p.projectId<1||o.projectId!==p.projectId
    ||o.surface!=='studio'||typeof o.conversationId!=='string'||!o.conversationId||o.sessionId!==o.conversationId
    ||!_m2IsRecord(d)||typeof d.instruction!=='string'||!Array.isArray(d.files)||!d.files.length||d.files.length>8
    ||!_m2IsRecord(d.focusedTest)||typeof d.focusedTest.binary!=='string'||!Array.isArray(d.focusedTest.argv)
    ||d.files.some(function(f){return !_m2IsRecord(f)||typeof f.path!=='string'||typeof f.instruction!=='string'||!Array.isArray(f.dependsOn);}))return null;
  return {origin:{surface:'studio',sessionId:o.sessionId,conversationId:o.conversationId,projectId:o.projectId},proposal:p};
}
function _m2StudioOrigin(s){
  var projectId=Number(s&&s._projectId);
  var conversationId=s&&s._convId!==null&&s._convId!==undefined?String(s._convId).trim():'';
  if(!Number.isSafeInteger(projectId)||projectId<1)throw Object.assign(new Error('M2 vyžaduje aktivní projekt s číselným ID.'),{code:'M2_STUDIO_PROJECT_REQUIRED'});
  if(!conversationId)throw Object.assign(new Error('M2 vyžaduje uloženou konverzaci se stabilním ID.'),{code:'M2_STUDIO_CONVERSATION_REQUIRED'});
  return {surface:'studio',sessionId:conversationId,conversationId:conversationId,projectId:projectId};
}
function _m2SameOrigin(left,right){
  return !!left&&!!right&&left.surface===right.surface&&left.sessionId===right.sessionId
    &&left.conversationId===right.conversationId&&left.projectId===right.projectId;
}
function _m2AssertCurrentContext(idx,s,origin){
  if(_sessions[idx]!==s||!_m2SameOrigin(_m2StudioOrigin(s),origin)){
    throw Object.assign(new Error('Studio kontext se během M2 požadavku změnil.'),{code:'M2_STUDIO_CONTEXT_CHANGED'});
  }
}
function _m2FetchJSON(endpoint,options,timeoutMs){
  var request=Object.assign({credentials:'same-origin'},options||{});
  if(!request.signal)request.signal=AbortSignal.timeout(timeoutMs);
  return fetch(_backendUrl()+endpoint,request).then(function(r){
    return r.json().catch(function(){return{};}).then(function(payload){
      if(!r.ok){
        var code=typeof payload.code==='string'?payload.code:'HTTP_'+r.status;
        var message=typeof payload.error==='string'?payload.error:'M2 lifecycle HTTP '+r.status;
        throw Object.assign(new Error(message),{code:code,status:r.status});
      }
      return payload;
    });
  });
}
function _m2RequireStatusView(view,expectedLifecycleId,expectedOrigin,expectedPlanDigest){
  if(!_m2IsRecord(view)||view.lifecycleId!==expectedLifecycleId||typeof view.planDigest!=='string'||!view.planDigest
    ||(expectedPlanDigest&&view.planDigest!==expectedPlanDigest)
    ||!_m2IsRecord(view.plan)||!_m2IsRecord(view.plan.identity)||view.plan.identity.lifecycleId!==expectedLifecycleId
    ||!_m2SameOrigin(view.plan.origin,expectedOrigin)){
    throw Object.assign(new Error('Server vrátil neúplný nebo cizí M2 status view.'),{code:'M2_STUDIO_INVALID_RESPONSE'});
  }
  if(view.state==='awaiting_approval'){
    var focused=view.plan.focusedTest;var decision=view.audit&&view.audit.governanceDecision;
    if(view.plan.state!=='awaiting_approval'||!Array.isArray(view.plan.changes)||view.plan.changes.length<1
      ||!Array.isArray(view.diff)||view.diff.length!==view.plan.changes.length
      ||view.plan.changes.some(function(change){var files=view.diff.filter(function(file){return file&&file.path===change.path;});
        return files.length!==1||!files[0].before||!files[0].after
          ||(files[0].before.content!==null&&typeof files[0].before.content!=='string')||typeof files[0].after.content!=='string';})
      ||!_m2IsRecord(focused)||!Array.isArray(focused.argv)||!Number.isSafeInteger(focused.timeoutMs)
      ||!_m2IsRecord(decision)||decision.verdict!=='allow'){
      throw Object.assign(new Error('Server nevrátil úplný schvalovatelný M2 plán.'),{code:'M2_STUDIO_INVALID_PLAN'});
    }
  }
  if(_M2_TERMINAL_STATES[view.state]){
    if(!_m2IsRecord(view.terminal)||view.terminal.state!==view.state
      ||!_m2IsRecord(view.terminal.identity)||view.terminal.identity.lifecycleId!==expectedLifecycleId
      ||view.terminal.planDigest!==view.planDigest){
      throw Object.assign(new Error('Server nevrátil canonical M2 terminal.'),{code:'M2_STUDIO_INVALID_TERMINAL'});
    }
    if(view.state==='succeeded'&&(!_m2IsRecord(view.result)||view.result.terminalStatus!=='succeeded'
      ||!_m2IsRecord(view.result.changes)||!_m2IsRecord(view.result.focusedTest)||!_m2IsRecord(view.result.git)
      ||!_m2IsRecord(view.audit)||!_m2IsRecord(view.audit.governanceReceipt))){
      throw Object.assign(new Error('Success nemá úplnou result/test/Git/diff/audit evidenci.'),{code:'M2_STUDIO_FALSE_SUCCESS'});
    }
  }
  return view;
}
function _m2Display(value,fallback){return value===null||value===undefined||value===''?(fallback||'—'):String(value);}
function _m2RenderPlan(view){
  var plan=view.plan;var decision=view.audit&&view.audit.governanceDecision;
  var material=Array.isArray(view.diff)?view.diff:[];
  var lines=[
    'M2 EXACT PLAN — čeká na explicitní approval',
    'Lifecycle ID: '+view.lifecycleId,
    'Plan digest: '+view.planDigest,
    'Request digest: '+_m2Display(plan.requestDigest),
    'Patch-set digest: '+_m2Display(plan.patchSetDigest),
    'Authority-set digest: '+_m2Display(plan.authoritySetDigest),
    'Context snapshot digest: '+_m2Display(plan.contextSnapshotDigest),
    'Expected workspace revision: '+_m2Display(plan.expectedAfterRevision),
    'Exact changes:'
  ];
  (Array.isArray(plan.changes)?plan.changes:[]).forEach(function(change){
    var file=material.find(function(entry){return entry&&entry.path===change.path;});
    if(file){
      lines.push('Původní obsah '+change.path+':');
      lines.push(String(file.before.content===null?'(nový soubor)':file.before.content).split('\n').map(function(line){return '    '+line;}).join('\n'));
      lines.push('Navržený úplný obsah '+change.path+':');
      lines.push(String(file.after.content).split('\n').map(function(line){return '    '+line;}).join('\n'));
    }
    lines.push('- '+_m2Display(change.path)+' | beforeDigest: '+_m2Display(file&&file.before&&file.before.digest,'absent')
      +' | afterDigest: '+_m2Display(change.afterDigest)+' | afterBytes: '+_m2Display(change.afterBytes));
  });
  var focused=plan.focusedTest||{};
  if(focused.argv&&(focused.argv[0]==='--check'||(focused.argv[0]==='--experimental-vm-modules'&&focused.argv[1]==='-e'&&String(focused.argv[2]).indexOf('SourceTextModule')>=0)))lines.push('Kontrola ověří pouze syntaxi. Funkční správnost tím není potvrzená.');
  lines.push('Focused test binary: '+_m2Display(focused.binary));
  lines.push('Focused test argv: '+JSON.stringify(Array.isArray(focused.argv)?focused.argv:[]));
  lines.push('Focused test argv digest: '+_m2Display(focused.argvDigest));
  lines.push('Focused test environment digest: '+_m2Display(focused.environmentDigest));
  lines.push('Focused test timeoutMs: '+_m2Display(focused.timeoutMs));
  if(plan.gitCommit===null){
    lines.push('Git intent: not_requested');
  }else{
    var git=plan.gitCommit||{};
    lines.push('Git intent: commit | expectedHead: '+_m2Display(git.expectedHead)+' | branchRef: '+_m2Display(git.branchRef));
    lines.push('Git paths: '+JSON.stringify(Array.isArray(git.paths)?git.paths:[]));
    lines.push('Git message digest: '+_m2Display(git.messageDigest)+' | identity digest: '+_m2Display(git.identityDigest));
  }
  lines.push('Governance verdict: '+_m2Display(decision&&decision.verdict,'unavailable'));
  lines.push('Governance decision digest: '+_m2Display(plan.governanceDecisionDigest));
  lines.push('Approval expires at: '+_m2Display(plan.approvalExpiresAt));
  lines.push('Před approval nebyl spuštěn žádný M2 efekt.');
  lines.push('Schválení přesně tohoto plánu: /m2-approve');
  return lines.join('\n');
}
function _m2RenderTerminal(view){
  var terminal=view.terminal||{};var result=view.result||{};var changes=result.changes||{};
  var focused=result.focusedTest||{};var git=result.git||{};var audit=view.audit||{};
  var decision=audit.governanceDecision||{};var receipt=audit.governanceReceipt||{};
  var lines=[
    view.state==='succeeded'?'Změna byla provedena a cílený test prošel. Pro další krok napiš do chatu; nejde o ověření celého projektu.':'Změna nebyla úspěšně dokončena. Níže je skutečný výsledek včetně stavu rollbacku.',
    'M2 CANONICAL TERMINAL',
    'Lifecycle ID: '+view.lifecycleId,
    'Lifecycle state: '+_m2Display(view.state),
    'Plan digest: '+_m2Display(view.planDigest),
    'Terminal state: '+_m2Display(terminal.state),
    'Terminal error code: '+_m2Display(terminal.errorCode,'none'),
    'Terminal result digest: '+_m2Display(terminal.resultDigest),
    'Terminal governance receipt digest: '+_m2Display(terminal.governanceReceiptDigest),
    'Terminal completed at: '+_m2Display(terminal.completedAt),
    'Result terminal status: '+_m2Display(result.terminalStatus),
    'Result error code: '+_m2Display(result.errorCode,'none'),
    'Diff paths: '+JSON.stringify(Array.isArray(changes.paths)?changes.paths:[]),
    'Diff before revision: '+_m2Display(changes.beforeRevision),
    'Diff after revision: '+_m2Display(changes.afterRevision),
    'Diff digest: '+_m2Display(changes.diffDigest),
    'Focused test terminal status: '+_m2Display(focused.terminalStatus),
    'Focused test exit code: '+_m2Display(focused.exitCode),
    'Focused test signal: '+_m2Display(focused.signal,'none'),
    'Focused test stdout digest: '+_m2Display(focused.stdoutDigest),
    'Focused test stderr digest: '+_m2Display(focused.stderrDigest),
    'Git status: '+_m2Display(git.status),
    'Git before head: '+_m2Display(git.beforeHead),
    'Git after head: '+_m2Display(git.afterHead),
    'Git commit ID: '+_m2Display(git.commitId,'none'),
    'Git foreign dirt preserved: '+_m2Display(git.foreignDirtPreserved),
    'Audit governance verdict: '+_m2Display(decision.verdict),
    'Audit governance decision ID: '+_m2Display(decision.decisionId),
    'Audit governance receipt ID: '+_m2Display(receipt.receiptId),
    'Audit lifecycle event count: '+(Array.isArray(audit.lifecycleEvents)?audit.lifecycleEvents.length:0),
    'Audit execution event count: '+(Array.isArray(audit.executionEvents)?audit.executionEvents.length:0),
    'Audit evidence refs: '+JSON.stringify(Array.isArray(terminal.evidenceRefs)?terminal.evidenceRefs:[]),
    'Exact diff material:'
  ];
  (Array.isArray(audit.executionEvents)?audit.executionEvents:[]).forEach(function(event){
    var output=event&&event.details&&event.details.testOutput;if(!output)return;
    lines.push('Výstup cíleného testu'+(output.truncated?' (zkrácený)':'')+':');
    if(output.stdout)lines.push(output.stdout);if(output.stderr)lines.push(output.stderr);
  });
  (Array.isArray(view.diff)?view.diff:[]).forEach(function(file){
    lines.push('- '+_m2Display(file&&file.path)+' | beforeDigest: '+_m2Display(file&&file.before&&file.before.digest,'absent')
      +' | afterDigest: '+_m2Display(file&&file.after&&file.after.digest)+' | beforeBytes: '+_m2Display(file&&file.before&&file.before.bytes,0)
      +' | afterBytes: '+_m2Display(file&&file.after&&file.after.bytes,0));
  });
  return lines.join('\n');
}
function _m2RenderStatus(view){
  if(view.terminal||_M2_TERMINAL_STATES[view.state])return _m2RenderTerminal(view);
  if(view.state==='awaiting_approval')return _m2RenderPlan(view);
  return ['M2 LIFECYCLE STATUS','Lifecycle ID: '+view.lifecycleId,'Lifecycle state: '+_m2Display(view.state),
    'Plan digest: '+_m2Display(view.planDigest),'Cancel requested: '+_m2Display(view.cancelRequested),
    'Obnovit durable stav: /m2-status '+view.lifecycleId].join('\n');
}
function _m2BeginStudioCommand(idx,st,ta,text){
  if(ta){ta.value='';ta.style.height='22px';}
  st.msgs.push({role:'user',text:text,tag:'M2'});
  st._m2Busy=true;st._thinking={text:'M2 lifecycle…',ts:Date.now()};
  _sessionActive=idx;_persistSessionState();renderChat();_chatScrollPane(idx);
}
function _m2FinishStudioCommand(idx,s,st,text,isError,operation){
  if(st._m2Operation===operation){
    operation.requests--;
    if(operation.requests===0){st._m2Busy=false;st._m2DraftController=null;st._thinking=null;st._m2Operation=null;}
  }
  st.msgs.push({role:isError?'system':'assistant',text:text,tag:isError?'M2_ERROR':'M2'});
  _persistSessionState();renderChat();_chatScrollPane(idx);
}
function _m2StudioError(error){
  var code=error&&error.code?error.code:'M2_STUDIO_REQUEST_FAILED';
  var status=error&&error.status?' HTTP '+error.status:'';
  return 'M2 chyba ['+code+status+']: '+(error&&error.message?error.message:String(error));
}
function _m2OpenComposer(idx){
  var s=_sessions[idx];var st=s&&s.chat;
  if(!st)return;
  try{
    var origin=_m2StudioOrigin(s);
    if(st._m2Busy||st._preparedSend||(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn(s)))throw new Error('Nejdřív dokončete nebo zrušte probíhající požadavek.');
    if(_m2NormalizePending(s._m2Pending))throw new Error('Nejdřív zkontrolujte nebo zrušte připravený plán.');
    if(!st._m2Composer){
      var ta=document.getElementById('intentsmith-chat-ta-'+idx);
      var offered=st._projectWorkProposal;
      var draft=offered&&_m2SameOrigin(offered.origin,origin)&&offered.proposal.projectId===origin.projectId?offered.proposal.draft:null;
      st._m2Composer=draft?{origin:origin,instruction:draft.instruction,
        files:draft.files.map(function(file){return {path:file.path,instruction:file.instruction,dependencies:file.dependsOn.join('\n')};}),
        binary:draft.focusedTest.binary,argv:draft.focusedTest.argv.slice(),timeoutMs:String(draft.focusedTest.timeoutMs),gitCommit:draft.gitCommit||null,error:null}
        :{origin:origin,instruction:ta?ta.value:'',files:[{path:'',instruction:'',dependencies:''}],binary:'',argv:[],timeoutMs:'30000',error:null};
    }
    st._m2ComposerOpen=true;
  }catch(error){st.msgs.push({role:'system',text:_m2StudioError(error),tag:'M2_ERROR'});}
  renderChat();
}
function _m2ComposerDraft(form){
  function required(value,label){if(typeof value!=='string'||!value.trim())throw new Error('Vyplňte '+label+'.');return value;}
  function instruction(value,label){required(value,label);if(new TextEncoder().encode(value).length>512)throw new Error(label+' přesahuje 512 bajtů.');return value;}
  var files=form.files.map(function(file){return {path:required(file.path,'cestu souboru'),instruction:instruction(file.instruction,'zadání souboru'),
    dependsOn:file.dependencies?file.dependencies.split('\n').map(function(value){return value.trim();}).filter(Boolean):[]};});
  if(!files.length||files.length>32)throw new Error('Plán musí obsahovat 1–32 souborů.');
  var paths=files.map(function(file){return file.path;});
  if(new Set(paths).size!==paths.length)throw new Error('Každý soubor zadejte pouze jednou.');
  files.forEach(function(file){if(new Set(file.dependsOn).size!==file.dependsOn.length||file.dependsOn.some(function(dependency){return paths.indexOf(dependency)<0;}))throw new Error('Závislosti musí jednou odkazovat na soubory tohoto plánu.');});
  var resolved=new Set();
  while(resolved.size<files.length){var next=files.find(function(file){return !resolved.has(file.path)&&file.dependsOn.every(function(dependency){return resolved.has(dependency);});});
    if(!next)throw new Error('Závislosti souborů obsahují cyklus.');resolved.add(next.path);}
  var timeoutMs=Number(form.timeoutMs);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw new Error('Časový limit testu musí být 1–3600000 ms.');
  return Object.assign({instruction:instruction(form.instruction,'celkové zadání'),files:files,
    focusedTest:{binary:required(form.binary,'úplnou cestu programu pro test'),argv:form.argv.slice(),
      environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NO_COLOR:'1'},timeoutMs:timeoutMs}},form.gitCommit?{gitCommit:form.gitCommit}:{});
}
function _m2SubmitComposer(idx,s,st,form){
  try{
    if(st._m2Composer!==form||s.chat!==st)throw new Error('Rozepsaný návrh již není aktivní.');
    _m2AssertCurrentContext(idx,s,form.origin);
    if(st._m2Busy||st._preparedSend||(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn(s)))throw new Error('Nejdřív dokončete nebo zrušte probíhající požadavek.');
    var draft=_m2ComposerDraft(form);form.error=null;
    var arg=JSON.stringify(draft);
    _m2HandleStudioCommand(idx,s,st,null,'/m2-build '+arg,'/m2-build',arg);
    if(st._m2Operation&&st._m2Operation.command==='/m2-build')st._m2Operation.composer=form;
  }catch(error){form.error=error.message;renderChat();}
}
function _m2ComposerUI(idx,s,st){
  var form=st._m2Composer;if(!st._m2ComposerOpen||!form)return null;
  var current=false;try{current=s.chat===st&&_sessions[idx]===s&&_m2SameOrigin(form.origin,_m2StudioOrigin(s));}catch(error){}
  var locked=!current||!!st._m2Busy||!!_m2NormalizePending(s._m2Pending);
  var prefix='m2-build-'+idx+'-';
  var inputStyle={width:'100%',boxSizing:'border-box',padding:'6px 8px',borderRadius:5,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,fontFamily:C.font,fontSize:_fs(12)};
  var buttonStyle={padding:'5px 9px',borderRadius:5,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,cursor:'pointer',fontSize:_fs(11)};
  function field(label,id,value,change,multiline,placeholder){return h('label',{htmlFor:prefix+id,style:{display:'block',marginBottom:8,fontSize:_fs(11),color:C.tx2}},label,
    h(multiline?'textarea':'input',{id:prefix+id,style:inputStyle,value:value,disabled:locked,autoFocus:id==='instruction'&&current&&!locked,rows:multiline?2:undefined,placeholder:placeholder||'',
      onChange:function(event){change(event.target.value);form.error=null;renderChat();}}));}
  return h('section',{'aria-label':'Připravit změnu projektu',style:{padding:10,borderTop:'1px solid '+C.border,background:C.bg2,maxHeight:'55vh',overflowY:'auto',flexShrink:0},onClick:function(event){event.stopPropagation();}},
    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}},h('strong',{style:{fontSize:_fs(13),color:C.tx1}},'Připravit změnu'),
      h('button',{type:'button',style:buttonStyle,onClick:function(){st._m2ComposerOpen=false;renderChat();}},'Skrýt')),
    h('p',{style:{fontSize:_fs(11),color:C.tx2}},'Popište cíl a vyberte soubory. Model připraví návrh; zápis a test spustíte až schválením výsledné změny. Projekt musí mít povolené změny a cílové adresáře musí existovat.'),
    !current?h('p',{role:'alert',style:{color:C.red}},'Konverzace nebo projekt se změnily. Tento návrh nelze odeslat; vraťte se do původní konverzace nebo jej zahoďte.'):null,
    field('Co chcete změnit?', 'instruction',form.instruction,function(value){form.instruction=value;},true),
    form.files.map(function(file,index){return h('fieldset',{key:index,disabled:locked,style:{border:'1px solid '+C.border2,borderRadius:6,padding:8,margin:'0 0 8px'}},
      h('legend',{style:{color:C.tx2,fontSize:_fs(11)}},'Soubor '+(index+1)),
      field('Cesta v projektu','file-'+index+'-path',file.path,function(value){file.path=value;},false,'src/app.js'),
      field('Zadání souboru','file-'+index+'-instruction',file.instruction,function(value){file.instruction=value;},true),
      field('Závislosti — jedna cesta z plánu na řádek','file-'+index+'-dependencies',file.dependencies,function(value){file.dependencies=value;},true),
      h('button',{type:'button',style:buttonStyle,disabled:locked||form.files.length===1,onClick:function(){form.files.splice(index,1);renderChat();}},'Odebrat soubor'));}),
    h('button',{type:'button',id:prefix+'add-file',style:buttonStyle,disabled:locked||form.files.length>=32,onClick:function(){form.files.push({path:'',instruction:'',dependencies:''});renderChat();}},'Přidat soubor'),
    h('h4',{style:{color:C.tx1,margin:'12px 0 8px'}},'Ověření výsledku'),
    field('Úplná cesta programu pro test','binary',form.binary,function(value){form.binary=value;},false,'/usr/bin/node'),
    h('p',{style:{fontSize:_fs(11),color:C.tx2}},'Zvolte test funkčního chování. Každý argument je samostatná hodnota, bez shellového překladu. Mezery a uvozovky se zachovají.'),
    form.argv.map(function(value,index){return h('div',{key:index,style:{display:'flex',alignItems:'center',gap:5}},
      h('div',{style:{flex:1}},field('Argument '+(index+1),'arg-'+index,value,function(next){form.argv[index]=next;},true)),
      h('button',{type:'button',style:buttonStyle,disabled:locked,'aria-label':'Odebrat argument '+(index+1),onClick:function(){form.argv.splice(index,1);renderChat();}},'×'));}),
    h('button',{type:'button',id:prefix+'add-arg',style:buttonStyle,disabled:locked,onClick:function(){form.argv.push('');renderChat();}},'Přidat argument'),
    field('Časový limit testu (ms)','timeout',form.timeoutMs,function(value){form.timeoutMs=value;},false),
    h('details',{style:{color:C.tx2,fontSize:_fs(11),marginBottom:8}},h('summary',null,'Prostředí testu'),h('pre',null,'LANG=C.UTF-8\nLC_ALL=C.UTF-8\nNO_COLOR=1')),
    form.gitCommit?h('p',{style:{fontSize:_fs(11),color:C.tx2}},'Po úspěšném testu tento schválený krok vytvoří místní Git commit. Jeho údaje budou součástí schvalovaného plánu.'):null,
    form.error?h('p',{role:'alert',style:{color:C.red}},form.error):null,
    h('div',{style:{display:'flex',gap:8}},
      h('button',{type:'button',id:prefix+'submit',style:Object.assign({},buttonStyle,{background:C.accentBg,color:C.accentText}),disabled:locked,onClick:function(){_m2SubmitComposer(idx,s,st,form);}},'Vygenerovat návrh'),
      h('button',{type:'button',style:buttonStyle,disabled:!!st._m2Busy,onClick:function(){st._m2Composer=null;st._m2ComposerOpen=false;renderChat();}},'Zahodit zadání')));
}
function _m2ActionsUI(idx,s,st){
  var pending=_m2NormalizePending(s._m2Pending);
  if(!pending&&!st._m2DraftController)return null;
  var viewed=s._m2PresentedPlan;
  var canApprove=pending&&viewed&&viewed.lifecycleId===pending.lifecycleId&&viewed.planDigest===pending.planDigest&&_m2SameOrigin(viewed.origin,pending.origin);
  function sendBusy(){return !!st._preparedSend||(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn(s));}
  function action(label,cmd,disabled){return h('button',{type:'button',disabled:disabled||(cmd!=='/m2-cancel'&&sendBusy()),
    style:{padding:'5px 8px',borderRadius:5,border:'1px solid '+C.border2,background:C.bg3,color:C.tx1,cursor:'pointer',fontSize:_fs(11)},
    onClick:function(){
      // React may not have committed a newly loaded plan yet. This button is
      // authority only for the exact binding captured by its own render.
      if(cmd==='/m2-approve'){
        var live=_m2NormalizePending(s._m2Pending);var shown=s._m2PresentedPlan;
        if(!canApprove||!live||live.lifecycleId!==pending.lifecycleId||live.planDigest!==pending.planDigest||!_m2SameOrigin(live.origin,pending.origin)
          ||!shown||shown.lifecycleId!==pending.lifecycleId||shown.planDigest!==pending.planDigest||!_m2SameOrigin(shown.origin,pending.origin)){
          st.msgs.push({role:'system',text:'Zobrazený plán se změnil. Načtěte a zkontrolujte aktuální návrh před schválením.',tag:'M2_ERROR'});renderChat();return;
        }
      }
      // Recheck at click time too: a previously rendered button may outlive
      // the start of a normal chat/attachment send. Cancellation stays usable.
      if(cmd!=='/m2-cancel'&&sendBusy()){
        st.msgs.push({role:'system',text:'Nejdřív dokončete nebo zrušte probíhající chatový požadavek.',tag:'M2_ERROR'});renderChat();return;
      }
      _m2HandleStudioCommand(idx,s,st,null,cmd,cmd,'');}},label);}
  return h('div',{'aria-label':'Akce připravené změny',style:{padding:'6px 10px',borderTop:'1px solid '+C.border,fontSize:_fs(11),color:C.tx2},onClick:function(event){event.stopPropagation();}},
    h('div',null,pending?(canApprove?'Před schválením zkontrolujte úplné obsahy souborů a test v návrhu výše.':'Nejdřív načtěte uložený plán a prohlédněte změny.'): 'Připravuji návrh souborů.'),
    h('div',{style:{display:'flex',gap:6,flexWrap:'wrap',marginTop:5}},
      pending?action('Načíst stav a plán','/m2-status',!!st._m2Busy):null,
      pending?action('Schválit zobrazené změny','/m2-approve',!canApprove||!!st._m2Busy):null,
      action('Zrušit','/m2-cancel',!!st._m2Busy&&!st._m2DraftController&&!(st._m2Operation&&st._m2Operation.command==='/m2-approve'&&!st._m2Operation.cancelIssued))));
}
function _m2IsGenericApproval(text){return /^(?:ano|ok|spusť(?: to)?|spust(?: to)?|yes|approve)$/i.test(text.trim());}
function _m2HandleStudioCommand(idx,s,st,ta,text,cmd,arg){
  if(['/m2-draft','/m2-build','/m2-plan','/m2-approve','/m2-status','/m2-cancel'].indexOf(cmd)<0)return false;
  if(cmd==='/m2-build'&&!arg){_m2OpenComposer(idx);return true;}
  var isDraft=cmd==='/m2-draft'||cmd==='/m2-build';
  var running=st._m2Operation;
  var concurrentCancel=st._m2Busy&&cmd==='/m2-cancel'&&running&&running.command==='/m2-approve'&&!running.cancelIssued;
  if(st._m2Busy&&!concurrentCancel){
    if(cmd==='/m2-cancel'&&st._m2DraftController){st._m2DraftController.abort();return true;}
    st.msgs.push({role:'system',text:'M2 požadavek už běží. Vyčkejte na jeho pravdivý HTTP výsledek.',tag:'M2_ERROR'});renderChat();
    return true;
  }
  var pending=_m2NormalizePending(concurrentCancel?running.pending:s._m2Pending);
  if(!concurrentCancel)s._m2Pending=pending;
  var origin;var lifecycleId;var proposal;var draft;
  try{
    if(cmd==='/m2-plan'||isDraft){
      if(pending)throw Object.assign(new Error('Nejdřív použijte /m2-status '+pending.lifecycleId+' nebo /m2-cancel <reason>.'),{code:'M2_STUDIO_PLAN_PENDING'});
      if(st.attachments.length>0)throw Object.assign(new Error('M2 plán přijímá pouze výslovně zadané soubory bez příloh.'),{code:'M2_STUDIO_ATTACHMENTS_NOT_ALLOWED'});
      if(!arg)throw Object.assign(new Error('Použití: /m2-plan <JSON změn>, /m2-build <JSON souborového plánu> nebo /m2-draft soubor :: zadání'),{code:'M2_STUDIO_PROPOSAL_REQUIRED'});
      if(cmd==='/m2-draft'){
        var split=arg.indexOf(' :: ');
        if(split<1)throw Object.assign(new Error('Použití: /m2-draft src/app.js[, src/other.js] :: popis malé změny'),{code:'M2_STUDIO_DRAFT_INPUT_INVALID'});
        var paths=arg.slice(0,split).split(',').map(function(file){return file.trim();});
        if(paths.length>3||paths.some(function(file,index){return !file||paths.indexOf(file)!==index;})){
          throw Object.assign(new Error('Zadejte jeden až tři různé soubory oddělené čárkou.'),{code:'M2_STUDIO_DRAFT_INPUT_INVALID'});
        }
        draft=paths.length===1?{path:paths[0],instruction:arg.slice(split+4).trim()}:{paths:paths,instruction:arg.slice(split+4).trim()};
      }else if(cmd==='/m2-build'){
        try{draft=JSON.parse(arg);}catch(parseError){throw Object.assign(new Error('Souborový plán není validní JSON.'),{code:'M2_STUDIO_DRAFT_INPUT_INVALID'});}
        if(!_m2IsRecord(draft)||!Array.isArray(draft.files))throw Object.assign(new Error('Souborový plán vyžaduje instruction, files se zadáním a závislostmi a vlastní focusedTest.'),{code:'M2_STUDIO_DRAFT_INPUT_INVALID'});
      }else{
      try{proposal=JSON.parse(arg);}catch(parseError){throw Object.assign(new Error('Proposal není validní strict JSON.'),{code:'M2_STUDIO_PROPOSAL_JSON_INVALID'});}
      if(!_m2IsRecord(proposal))throw Object.assign(new Error('Proposal musí být JSON object.'),{code:'M2_STUDIO_PROPOSAL_INVALID'});
      }
      origin=_m2StudioOrigin(s);
    }else if(cmd==='/m2-approve'){
      if(arg)throw Object.assign(new Error('Použití: /m2-approve'),{code:'M2_STUDIO_APPROVAL_ARGUMENTS_FORBIDDEN'});
      if(!pending)throw Object.assign(new Error('Není uložen žádný exact M2 plán k approval.'),{code:'M2_STUDIO_PLAN_REQUIRED'});
      origin=pending.origin;lifecycleId=pending.lifecycleId;_m2AssertCurrentContext(idx,s,origin);
    }else if(cmd==='/m2-cancel'){
      if(!pending)throw Object.assign(new Error('Není uložen žádný M2 lifecycle ke zrušení.'),{code:'M2_STUDIO_PLAN_REQUIRED'});
      origin=pending.origin;lifecycleId=pending.lifecycleId;_m2AssertCurrentContext(idx,s,origin);
    }else{
      if(arg&&/\s/.test(arg))throw Object.assign(new Error('Použití: /m2-status [lifecycleId]'),{code:'M2_STUDIO_STATUS_ID_INVALID'});
      lifecycleId=arg||(pending&&pending.lifecycleId);
      if(!lifecycleId)throw Object.assign(new Error('Použití: /m2-status [lifecycleId]'),{code:'M2_STUDIO_STATUS_ID_REQUIRED'});
      origin=pending&&pending.lifecycleId===lifecycleId?pending.origin:_m2StudioOrigin(s);
      _m2AssertCurrentContext(idx,s,origin);
    }
  }catch(error){
    if(ta){ta.value='';ta.style.height='22px';}
    st.msgs.push({role:'system',text:_m2StudioError(error),tag:'M2_ERROR'});_persistSessionState();renderChat();_chatScrollPane(idx);
    return true;
  }

  var operation;
  if(concurrentCancel){
    operation=running;operation.cancelIssued=true;operation.requests++;
    if(ta){ta.value='';ta.style.height='22px';}
    st.msgs.push({role:'user',text:text,tag:'M2'});
    st._thinking={text:'Žádám o zrušení; čekám na potvrzený stav.',ts:Date.now()};
    _persistSessionState();renderChat();_chatScrollPane(idx);
  }else{
    operation={command:cmd,pending:pending,requests:1,cancelIssued:false,terminal:null};st._m2Operation=operation;
    _m2BeginStudioCommand(idx,st,ta,text);
  }
  var request;
  if(isDraft){st._m2DraftController=new AbortController();st._thinking.text='Připravuji návrh; zrušení: /m2-cancel';renderChat();}
  if(cmd==='/m2-plan'||isDraft){
    request=_m2FetchJSON(isDraft?'/api/m2/lifecycle/draft':'/api/m2/lifecycle/prepare',{method:'POST',headers:{'Content-Type':'application/json'},
      signal:st._m2DraftController?AbortSignal.any([st._m2DraftController.signal,AbortSignal.timeout(990000)]):undefined,
      body:JSON.stringify(isDraft?{projectId:origin.projectId,origin:origin,draft:draft}:{projectId:origin.projectId,origin:origin,proposal:proposal})},990000)
    .then(function(view){
      _m2AssertCurrentContext(idx,s,origin);
      if(!_m2IsRecord(view)||typeof view.lifecycleId!=='string'||!view.lifecycleId)throw Object.assign(new Error('Prepare response nemá lifecycle ID.'),{code:'M2_STUDIO_INVALID_RESPONSE'});
      _m2RequireStatusView(view,view.lifecycleId,origin);
      var exact=_m2NormalizePending({lifecycleId:view.lifecycleId,planDigest:view.planDigest,origin:origin});
      if(!exact)throw Object.assign(new Error('Prepare response nemá exact approval binding.'),{code:'M2_STUDIO_INVALID_RESPONSE'});
      s._m2Pending=exact;return view;
    });
  }else if(cmd==='/m2-approve'){
    request=_m2FetchJSON('/api/m2/lifecycle/approve',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lifecycleId:pending.lifecycleId,planDigest:pending.planDigest,origin:pending.origin})},3600000)
    .then(function(view){_m2AssertCurrentContext(idx,s,pending.origin);return _m2RequireStatusView(view,pending.lifecycleId,pending.origin,pending.planDigest);});
  }else if(cmd==='/m2-cancel'){
    request=_m2FetchJSON('/api/m2/lifecycle/cancel',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lifecycleId:pending.lifecycleId,reason:arg||'user_cancelled',origin:pending.origin})},600000)
    .then(function(view){_m2AssertCurrentContext(idx,s,pending.origin);return _m2RequireStatusView(view,pending.lifecycleId,pending.origin,pending.planDigest);});
  }else{
    var query='?id='+encodeURIComponent(lifecycleId)+'&surface='+encodeURIComponent(origin.surface)
      +'&sessionId='+encodeURIComponent(origin.sessionId)+'&conversationId='+encodeURIComponent(origin.conversationId)
      +'&projectId='+encodeURIComponent(origin.projectId);
    request=_m2FetchJSON('/api/m2/lifecycle/status'+query,{method:'GET'},120000)
      .then(function(view){_m2AssertCurrentContext(idx,s,origin);return _m2RequireStatusView(view,lifecycleId,origin,
        pending&&pending.lifecycleId===lifecycleId?pending.planDigest:null);});
  }
  request.then(function(view){
    // Approval and durable cancellation may return in either order. A terminal
    // result owns the display and pending state; a late older view cannot reopen it.
    if(view.terminal||_M2_TERMINAL_STATES[view.state]){
      if(operation.terminal&&operation.terminal.state!==view.state){
        throw Object.assign(new Error('Server vrátil konfliktní M2 terminály; obnovte durable stav.'),{code:'M2_STUDIO_CONFLICTING_TERMINAL'});
      }
      operation.terminal=view;
    }else if(operation.terminal){view=operation.terminal;}
    if(view.state==='awaiting_approval'){
      s._m2Pending=_m2NormalizePending({lifecycleId:view.lifecycleId,planDigest:view.planDigest,origin:view.plan.origin});
      s._m2PresentedPlan=s._m2Pending;
      if(operation.composer&&st._m2Composer===operation.composer)st._m2ComposerOpen=false;
    }else if(view.terminal||_M2_TERMINAL_STATES[view.state]){
      if(s._m2Pending&&s._m2Pending.lifecycleId===view.lifecycleId)s._m2Pending=null;
      st._m2Composer=null;st._m2ComposerOpen=false;st._projectWorkProposal=null;
    }
    _m2FinishStudioCommand(idx,s,st,_m2RenderStatus(view),false,operation);
  }).catch(function(error){
    if(st._m2DraftController&&st._m2DraftController.signal.aborted)error=Object.assign(new Error('Generování návrhu zrušeno.'),{code:'M2_STUDIO_DRAFT_CANCELLED'});
    if(operation.composer&&st._m2Composer===operation.composer)operation.composer.error=_m2StudioError(error);
    _m2FinishStudioCommand(idx,s,st,_m2StudioError(error),true,operation);
  });
  return true;
}

/* ── M4 learning — explicit Studio evidence and user-gate surface ── */
var _M4_LEARNING_COMMANDS=['/m4-learning','/m4-learning-show','/m4-learning-approve','/m4-learning-reject',
  '/m4-learning-weaken','/m4-learning-rollback','/m4-learning-delete'];
var _M4_LEARNING_STATES={pending:true,active:true,rejected:true,rolled_back:true,expired:true,deleted:true};
function _m4LearningProject(s){
  var projectId=Number(s&&s._projectId);
  if(!Number.isSafeInteger(projectId)||projectId<1)throw Object.assign(new Error('M4 learning vyžaduje aktivní projekt s číselným ID.'),{code:'M4_STUDIO_PROJECT_REQUIRED'});
  return projectId;
}
function _m4AssertCurrentProject(idx,s,projectId){
  if(_sessions[idx]!==s||_m4LearningProject(s)!==projectId){
    throw Object.assign(new Error('Studio projekt se během M4 learning požadavku změnil.'),{code:'M4_STUDIO_CONTEXT_CHANGED'});
  }
}
function _m4LearningFetchJSON(endpoint,options,timeoutMs){
  var request=Object.assign({credentials:'same-origin'},options||{});
  if(!request.signal)request.signal=AbortSignal.timeout(timeoutMs);
  return fetch(_backendUrl()+endpoint,request).then(function(r){
    return r.json().catch(function(){return{};}).then(function(payload){
      if(!r.ok){
        var code=typeof payload.code==='string'?payload.code:'HTTP_'+r.status;
        var message=typeof payload.error==='string'?payload.error:'M4 learning HTTP '+r.status;
        throw Object.assign(new Error(message),{code:code,status:r.status});
      }
      return payload;
    });
  });
}
function _m4LearningProposalId(value){return typeof value==='string'&&/^lpr1:[0-9a-f]{64}$/.test(value);}
function _m4RequireLearningReview(view,projectId,proposalId){
  if(!_m2IsRecord(view)||view.contract!=='LearningProposalReview'||view.version!==1||view.projectId!==projectId
    ||!_m2IsRecord(view.proposal)||view.proposal.projectId!==projectId||!_m4LearningProposalId(view.proposal.proposalId)
    ||(proposalId&&view.proposal.proposalId!==proposalId)||!Array.isArray(view.proposal.observationIds)
    ||view.proposal.observationIds.length<2||!Array.isArray(view.observations)
    ||view.observations.length!==view.proposal.observationIds.length||!_M4_LEARNING_STATES[view.state]){
    throw Object.assign(new Error('Server vrátil neúplný nebo cizí M4 learning review.'),{code:'M4_STUDIO_INVALID_RESPONSE'});
  }
  for(var i=0;i<view.observations.length;i++){
    var observation=view.observations[i];
    if(!_m2IsRecord(observation)||observation.contract!=='LearningObservation'||observation.projectId!==projectId
      ||observation.observationId!==view.proposal.observationIds[i]||!Array.isArray(observation.evidence)
      ||observation.evidence.length<1){
      throw Object.assign(new Error('M4 review nemá úplnou same-project evidenci.'),{code:'M4_STUDIO_INVALID_EVIDENCE'});
    }
    for(var j=0;j<observation.evidence.length;j++){
      var evidence=observation.evidence[j];
      if(!_m2IsRecord(evidence)||typeof evidence.evidenceId!=='string'
        ||!/^sha256:[0-9a-f]{64}$/.test(evidence.digest)||!/^wsr1:[0-9a-f]{64}$/.test(evidence.workspaceRevision)){
        throw Object.assign(new Error('M4 review evidence nemá exact digest/revision.'),{code:'M4_STUDIO_INVALID_EVIDENCE'});
      }
    }
  }
  if(view.state==='pending'){
    if(view.currentOutcome!==null)throw Object.assign(new Error('Pending M4 proposal nesmí mít outcome.'),{code:'M4_STUDIO_INVALID_RESPONSE'});
  }else if(!_m2IsRecord(view.currentOutcome)||view.currentOutcome.projectId!==projectId
    ||view.currentOutcome.proposalId!==view.proposal.proposalId
    ||(view.state==='active'?['approved','measured','weakened'].indexOf(view.currentOutcome.status)<0:view.currentOutcome.status!==view.state)){
    throw Object.assign(new Error('M4 review nemá exact current outcome.'),{code:'M4_STUDIO_INVALID_RESPONSE'});
  }
  return view;
}
function _m4RequireLearningList(view,projectId,state){
  if(!_m2IsRecord(view)||view.contract!=='LearningProposalReviewList'||view.version!==1
    ||view.projectId!==projectId||view.stateFilter!==state||!Array.isArray(view.reviews)||view.reviews.length>100){
    throw Object.assign(new Error('Server vrátil neúplný nebo cizí M4 learning seznam.'),{code:'M4_STUDIO_INVALID_RESPONSE'});
  }
  view.reviews.forEach(function(review){_m4RequireLearningReview(review,projectId,null);});
  return view;
}
function _m4LearningDisplay(value,fallback){return value===null||value===undefined||value===''?(fallback||'—'):String(value);}
function _m4RenderLearningReview(view,compact){
  var proposal=view.proposal;var adaptation=proposal.adaptation||{};var retention=proposal.retention||{};
  var lines=[
    (compact?'M4 PROPOSAL':'M4 LEARNING REVIEW'),
    'Proposal ID: '+proposal.proposalId,
    'Project ID: '+view.projectId,
    'State: '+view.state,
    'Title: '+_m4LearningDisplay(proposal.title),
    'Rationale: '+_m4LearningDisplay(proposal.rationale),
    'Confidence: '+_m4LearningDisplay(proposal.confidenceBps)+'/10000',
    'Created at: '+_m4LearningDisplay(proposal.createdAtMs),
    'Pattern key: '+_m4LearningDisplay(adaptation.key),
    'Pattern value: '+JSON.stringify(adaptation.value),
    'Target: '+_m4LearningDisplay(adaptation.target),
    'Changes permissions/code/config: '+[adaptation.changesPermissions,adaptation.changesCode,adaptation.changesConfig].join('/'),
    'TTL ms: '+_m4LearningDisplay(retention.ttlMs),
    'Observation IDs: '+JSON.stringify(proposal.observationIds),
    'Exact evidence:'
  ];
  view.observations.forEach(function(observation){
    lines.push('- observation '+observation.observationId+' | producer: '+_m4LearningDisplay(observation.producer)
      +' | confidence: '+_m4LearningDisplay(observation.confidenceBps)+'/10000 | observedAt: '+_m4LearningDisplay(observation.observedAtMs));
    observation.evidence.forEach(function(evidence){
      lines.push('  evidence '+evidence.evidenceId+' | kind: '+_m4LearningDisplay(evidence.kind)
        +' | source: '+_m4LearningDisplay(evidence.sourceId)+'@'+_m4LearningDisplay(evidence.sourceVersion)
        +' | digest: '+evidence.digest+' | workspaceRevision: '+evidence.workspaceRevision);
    });
  });
  if(view.currentOutcome){
    lines.push('Current outcome ID: '+view.currentOutcome.outcomeId);
    lines.push('Current outcome actor: '+_m4LearningDisplay(view.currentOutcome.actor&&view.currentOutcome.actor.actorId));
    lines.push('Current outcome reason: '+_m4LearningDisplay(view.currentOutcome.reason));
    if(view.currentOutcome.learnedItem){
      lines.push('Learned item: '+view.currentOutcome.learnedItem.itemId+'@'+view.currentOutcome.learnedItem.itemVersion
        +' | active: '+view.currentOutcome.learnedItem.active+' | expiresAt: '+view.currentOutcome.learnedItem.expiresAtMs);
    }
  }
  if(view.state==='pending'){
    lines.push('Explicit approval: /m4-learning-approve '+proposal.proposalId+' <reason>');
    lines.push('Explicit rejection: /m4-learning-reject '+proposal.proposalId+' <reason>');
    lines.push('Obecné „ano“ tento proposal nikdy neschválí.');
  }else if(view.state==='active'){
    lines.push('Weaken: /m4-learning-weaken '+proposal.proposalId+' {"confidenceBps":5000,"reason":"...","value":{...}}');
    lines.push('Rollback: /m4-learning-rollback '+proposal.proposalId+' <reason>');
    lines.push('Delete tombstone: /m4-learning-delete '+proposal.proposalId+' <reason>');
  }else if(view.state!=='deleted'){
    lines.push('Delete tombstone: /m4-learning-delete '+proposal.proposalId+' <reason>');
  }
  return lines.join('\n');
}
function _m4RenderLearningList(view){
  var lines=['M4 LEARNING PROPOSALS','Project ID: '+view.projectId,'Filter: '+view.stateFilter,'Count: '+view.reviews.length];
  if(view.reviews.length===0)lines.push('Žádné proposal v tomto stavu.');
  view.reviews.forEach(function(review,index){
    lines.push('');lines.push('['+(index+1)+'/'+view.reviews.length+']');lines.push(_m4RenderLearningReview(review,true));
  });
  return lines.join('\n');
}
function _m4ParseIdReason(arg,usage){
  var match=/^(lpr1:[0-9a-f]{64})\s+([\s\S]+)$/.exec(arg||'');
  if(!match||!match[2].trim()||match[2].trim().length>4096){
    throw Object.assign(new Error('Použití: '+usage),{code:'M4_STUDIO_ARGUMENT_INVALID'});
  }
  return {proposalId:match[1],reason:match[2].trim()};
}
function _m4ParseWeaken(arg){
  var match=/^(lpr1:[0-9a-f]{64})\s+([\s\S]+)$/.exec(arg||'');var body;
  if(!match)throw Object.assign(new Error('Použití: /m4-learning-weaken <proposalId> <strict JSON>'),{code:'M4_STUDIO_ARGUMENT_INVALID'});
  try{body=JSON.parse(match[2]);}catch(error){throw Object.assign(new Error('Weaken payload není validní strict JSON.'),{code:'M4_STUDIO_JSON_INVALID'});}
  if(!_m2IsRecord(body)||Object.keys(body).sort().join(',')!=='confidenceBps,reason,value'
    ||!Number.isSafeInteger(body.confidenceBps)||body.confidenceBps<0||body.confidenceBps>10000
    ||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>4096){
    throw Object.assign(new Error('Weaken JSON musí mít přesně confidenceBps, reason a value.'),{code:'M4_STUDIO_ARGUMENT_INVALID'});
  }
  return {proposalId:match[1],body:{confidenceBps:body.confidenceBps,reason:body.reason.trim(),value:body.value}};
}
function _m4BeginLearningCommand(idx,st,ta,text){
  if(ta){ta.value='';ta.style.height='22px';}
  st.msgs.push({role:'user',text:text,tag:'M4'});st._m4LearningBusy=true;
  st._thinking={text:'M4 learning…',ts:Date.now()};_sessionActive=idx;_persistSessionState();renderChat();_chatScrollPane(idx);
}
function _m4FinishLearningCommand(idx,st,text,isError){
  st._m4LearningBusy=false;st._thinking=null;
  st.msgs.push({role:isError?'system':'assistant',text:text,tag:isError?'M4_ERROR':'M4'});
  _persistSessionState();renderChat();_chatScrollPane(idx);
}
function _m4LearningError(error){
  var code=error&&error.code?error.code:'M4_STUDIO_REQUEST_FAILED';var status=error&&error.status?' HTTP '+error.status:'';
  return 'M4 chyba ['+code+status+']: '+(error&&error.message?error.message:String(error));
}
function _m4HandleLearningCommand(idx,s,st,ta,text,cmd,arg){
  if(_M4_LEARNING_COMMANDS.indexOf(cmd)<0)return false;
  if(st._m4LearningBusy){st.msgs.push({role:'system',text:'M4 learning požadavek už běží.',tag:'M4_ERROR'});renderChat();return true;}
  var projectId;var proposalId=null;var body=null;var state='pending';var method='GET';var endpoint;
  try{
    if(st.attachments.length>0)throw Object.assign(new Error('M4 learning příkazy nepřijímají přílohy.'),{code:'M4_STUDIO_ATTACHMENTS_NOT_ALLOWED'});
    projectId=_m4LearningProject(s);
    var base='/api/projects/'+encodeURIComponent(projectId)+'/learning/proposals';
    if(cmd==='/m4-learning'){
      state=arg||'pending';if(['all','pending','active','terminal'].indexOf(state)<0)throw Object.assign(new Error('Použití: /m4-learning [all|pending|active|terminal]'),{code:'M4_STUDIO_ARGUMENT_INVALID'});
      endpoint=base+'?state='+encodeURIComponent(state)+'&limit=50';
    }else if(cmd==='/m4-learning-show'){
      if(!_m4LearningProposalId(arg))throw Object.assign(new Error('Použití: /m4-learning-show <proposalId>'),{code:'M4_STUDIO_ARGUMENT_INVALID'});
      proposalId=arg;endpoint=base+'/'+encodeURIComponent(proposalId);
    }else if(cmd==='/m4-learning-weaken'){
      var weaken=_m4ParseWeaken(arg);proposalId=weaken.proposalId;body=weaken.body;method='POST';
      endpoint=base+'/'+encodeURIComponent(proposalId)+'/weaken';
    }else{
      var action=cmd.slice('/m4-learning-'.length);var parsed=_m4ParseIdReason(arg,cmd+' <proposalId> <reason>');
      proposalId=parsed.proposalId;body={reason:parsed.reason};method=action==='delete'?'DELETE':'POST';
      endpoint=base+'/'+encodeURIComponent(proposalId)+'/'+action;
      if(action==='delete')endpoint=base+'/'+encodeURIComponent(proposalId);
    }
  }catch(error){
    if(ta){ta.value='';ta.style.height='22px';}
    st.msgs.push({role:'system',text:_m4LearningError(error),tag:'M4_ERROR'});_persistSessionState();renderChat();_chatScrollPane(idx);return true;
  }
  _m4BeginLearningCommand(idx,st,ta,text);
  var options={method:method};
  if(body!==null){options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(body);}
  _m4LearningFetchJSON(endpoint,options,120000).then(function(view){
    _m4AssertCurrentProject(idx,s,projectId);
    if(cmd==='/m4-learning')return _m4RenderLearningList(_m4RequireLearningList(view,projectId,state));
    return _m4RenderLearningReview(_m4RequireLearningReview(view,projectId,proposalId),false);
  }).then(function(rendered){_m4FinishLearningCommand(idx,st,rendered,false);})
  .catch(function(error){_m4FinishLearningCommand(idx,st,_m4LearningError(error),true);});
  return true;
}

function _chatSendPane(idx){
  var ta=document.getElementById('intentsmith-chat-ta-'+idx);
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  // An unrelated chat turn or attachment read cannot disable cancellation of
  // an already running M2 operation. Its dispatcher still owns exact origin.
  var m2CancelText=ta?ta.value.trim():'';
  if(st._m2Busy&&/^\/m2-cancel(?:\s|$)/i.test(m2CancelText)){
    _m2HandleStudioCommand(idx,s,st,ta,m2CancelText,'/m2-cancel',m2CancelText.slice(10).trim());return;
  }
  if(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn&&IntentSmithWS.hasActiveM1Turn(s))return;
  if(st._preparedSend||st._specialistSelecting)return;
  st.acSuggestion=null;/* clear autocomplete on send */
  if(st.specialist&&!s._convId)s._convId='studio-specialist-'+crypto.randomUUID();
  var rawDraft=ta?ta.value:'';
  var t=rawDraft.trim();if(!t&&st.attachments.length===0)return;

  /* Ambiguous chat acknowledgements never grant M2 approval. */
  if(_m2NormalizePending(s._m2Pending)&&_m2IsGenericApproval(t)){
    if(ta){ta.value='';ta.style.height='22px';}
    st.msgs.push({role:'user',text:t,tag:'M2'});
    st.msgs.push({role:'system',text:'M2 approval nebyl proveden. Pro exact uložený plan digest použijte pouze /m2-approve.',tag:'M2'});
    _persistSessionState();renderChat();_chatScrollPane(idx);return;
  }

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
    var commandToken=t.match(/^\S+/)[0];var cmd=commandToken.toLowerCase();var arg=t.slice(commandToken.length).trim();
    if(_m2HandleStudioCommand(idx,s,st,ta,t,cmd,arg))return;
    if(_m4HandleLearningCommand(idx,s,st,ta,t,cmd,arg))return;
    if(cmd==='/run'){
      if(ta){ta.value='';ta.style.height='22px';}
      st.msgs.push({role:'user',text:t});renderChat();
      if(arg&&typeof IntentSmithTerminal!=='undefined'){IntentSmithTerminal.send(idx,arg);renderAgent();}
      else{st.msgs.push({role:'system',text:'Použití: /run <příkaz>'});renderChat();}
      return;
    }
    if(cmd==='/test'){
      if(ta){ta.value='';ta.style.height='22px';}
      st.msgs.push({role:'user',text:'/test'});renderChat();
      if(typeof IntentSmithTerminal!=='undefined'){IntentSmithTerminal.send(idx,arg||'npm test');renderAgent();}
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
  function sendPrepared(readFiles){
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
      userMsg.tag='NOT_SENT';userMsg.deliveryStatus='NOT_SENT';userMsg.retryable=true;
      _chatRestoreInput(ta,rawDraft);_chatRestoreAttachments(st,filesToRead);
      _chatMarkNotSent(idx,st,txt,delivery,rawDraft);return;
    }
    s.chat._pendingAttachments=null;
    /* Poll context after send */
    setTimeout(function(){_pollContext(idx);},2000);
  }
  if(st.specialist){
    _chatEnsureSpecialist(s).then(function(){if(!_chatSendContextIsCurrent(sendContext)){_chatRejectPreparedSend(sendContext,'CONTEXT_CHANGED_BEFORE_SEND');return;}_readAttachments(filesToRead,sendPrepared);}).catch(function(e){_chatRejectPreparedSend(sendContext,'SPECIALIST_ACTIVATION_FAILED');st.msgs.push({role:'system',text:e.message,tag:'ERROR'});renderChat();});
  }else _readAttachments(filesToRead,sendPrepared);
}

/* D5: Gap choice button handler — sends user's gap choice as chat message */
function _chatGapChoice(idx,choice,gapMsgIdx){
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  var gapMessage=typeof gapMsgIdx==='number'?st.msgs[gapMsgIdx]:null;
  if(!gapMessage||!gapMessage._gapChoice||gapMessage._gapResolved)return false;
  if(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn&&IntentSmithWS.hasActiveM1Turn(s)){
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
    gapUserMsg.tag='NOT_SENT';gapUserMsg.deliveryStatus='NOT_SENT';gapUserMsg.retryable=true;
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
        title:'Zavřít konverzaci',onClick:function(ev){ev.stopPropagation();_closeWorkspaceConversation(idx);}},'×'):null),
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
    h('div',{id:'intentsmith-chat-feed-'+idx,style:{flex:1,overflowY:'auto',overflowX:'hidden',padding:8,minWidth:0}},
      st.msgs.map(function(m,i){var u=m.role==='user',a=m.role==='assistant';var bub=_settingsVals.visualMode==='borders';
        var isEditing=st.editingIdx===i;
        var wrapS=bub?{padding:'3px 6px',marginBottom:3,display:'flex',justifyContent:u?'flex-end':'flex-start'}
          :{padding:'6px 0',borderBottom:'1px solid '+C.border};
        var _mw=inFocus?'90%':'85%';
        var msgS=bub?{background:u?C.bg4:a?C.bg2:C.bg3,borderRadius:u?'12px 12px 2px 12px':a?'12px 12px 12px 2px':'8px',padding:'6px 10px',maxWidth:_mw,minWidth:60,border:isEditing?'2px solid '+C.accent:'none'}:{border:isEditing?'2px solid '+C.accent:'none'};
        return h('div',{key:i,style:Object.assign({},wrapS,u?{cursor:'pointer'}:{}),onClick:u?function(){_chatStartEdit(idx,i);}:undefined,title:u?'Klikni pro editaci':undefined},
          h('div',{style:msgS},
          h('div',{style:{display:'flex',alignItems:'center',gap:4,marginBottom:2}},
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:u?C.bg4:a?'linear-gradient(135deg,'+C.accentText+','+C.accent+')':C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:a?_fs(6):_fs(8),fontWeight:a?800:400,color:u?C.tx3:a?C.onAccent:C.tx4}},u?'👤':a?'IS':'⚡'),
            h('span',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2}},u?'Ty':a?'IntentSmith':'System'),
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
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:'linear-gradient(135deg,'+C.accentText+','+C.accent+')',display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(6),fontWeight:800,color:C.onAccent}},'IS'),
            h('span',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2}},'IntentSmith')),
          h('div',{style:{display:'flex',alignItems:'center',gap:6,paddingLeft:22}},
            h('div',{style:{display:'flex',gap:3,alignItems:'center'}},
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'intentsmith-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0s'}}),
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'intentsmith-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0.15s'}}),
              h('span',{style:{width:5,height:5,borderRadius:'50%',background:C.accent,display:'inline-block',animation:'intentsmith-thinking-dot 1.2s ease-in-out infinite',animationDelay:'0.3s'}})),
            h('span',{style:{fontSize:_fs(11),color:C.tx3,fontStyle:'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:200}},st._thinking.text||'')))):null),
    /* M1/011: minimal functional status; final Studio UI is a later product surface. */
    st._delivery&&st._delivery.status==='NOT_SENT'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:C.redBg,color:C.red,fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      _chatDeliveryMessage(st._delivery)):
    st._delivery&&st._delivery.status==='DELIVERY_UNKNOWN'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:'rgba(245,158,11,0.12)',color:'#fbbf24',fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      'DELIVERY_UNKNOWN · Spojení skončilo po odeslání. Výsledek ověřte v historii; automatické opakování je vypnuté.'):
    st._delivery&&st._delivery.status==='BUSY'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:'rgba(245,158,11,0.12)',color:'#fbbf24',fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      'BUSY · '+st._delivery.text):
    st._delivery&&st._delivery.status==='ATTACH_REFUSED'?h('div',{style:{padding:'5px 10px',borderTop:'1px solid '+C.border,background:C.redBg,color:C.red,fontSize:_fs(10),lineHeight:'1.35',flexShrink:0}},
      'Nepřipojeno · '+st._delivery.text):null,
    _m2ActionsUI(idx,s,st),
    _m2ComposerUI(idx,s,st),
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
          h('textarea',{key:s._uiId,id:'intentsmith-chat-ta-'+idx,defaultValue:st._draft||'',ref:function(node){if(node)_workspaceTextareas[idx]={session:s,node:node};else delete _workspaceTextareas[idx];},style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.font,fontSize:_fs(12.5),lineHeight:'1.4',resize:'none',minHeight:20,maxHeight:100,overflow:'auto'},placeholder:'Napiš zprávu...',rows:1,
            onFocus:function(){_switchSession(idx);},
            onInput:function(e){st._draft=e.target.value;e.target.style.height='20px';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';st.acSuggestion=null;renderChat();},
            onKeyDown:function(e){if(e.key==='Tab'){e.preventDefault();_chatAutocomplete(idx);}else if(e.key==='Escape'){if(st.editingIdx!==null){_chatCancelEdit(idx);}else{st.acSuggestion=null;renderChat();}}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_chatSendPane(idx);}else if(e.key==='ArrowUp'&&!e.target.value.trim()){e.preventDefault();for(var j=st.msgs.length-1;j>=0;j--){if(st.msgs[j].role==='user'){_chatStartEdit(idx,j);break;}}}}}),
          h('button',{style:{background:_rgba(C.accent,0.18),color:C.accentText,border:'1px solid '+_rgba(C.accent,0.24),borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:26,height:26,flexShrink:0},onClick:function(){_chatSendPane(idx);}},svgEl(I.send))),
        /* Autocomplete suggestion — subtle ghost text row */
        st.acSuggestion?h('div',{style:{display:'flex',alignItems:'center',padding:'1px 8px 2px',cursor:'pointer',gap:4},onClick:function(ev){ev.stopPropagation();_chatAutocomplete(idx);}},
          h('span',{style:{fontSize:_fs(11.5),color:C.tx4,opacity:0.45,fontFamily:C.font,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1,fontStyle:'italic'}},st.acSuggestion),
          h('span',{style:{fontSize:_fs(8),color:C.tx4,fontFamily:C.mono,flexShrink:0,padding:'1px 5px',border:'1px solid '+C.border2,borderRadius:3,opacity:0.5}},'Tab')):null,
        st.acLoading?h('div',{style:{padding:'1px 8px 2px'}},
          h('div',{style:{height:1,borderRadius:1,background:C.bg4,overflow:'hidden'}},
            h('div',{style:{height:'100%',width:'30%',background:C.tx4,borderRadius:1,opacity:0.3,animation:'intentsmith-ac-pulse 1.2s ease-in-out infinite'}}))):null,
        h('div',{style:{display:'flex',alignItems:'center',gap:3,padding:'2px 6px 5px',borderTop:'1px solid '+C.border}},
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22},title:'Připojit soubor (nebo přetáhni)',
            onClick:function(ev){ev.stopPropagation();
              /* v95: Smart file picker — project folder default + remember last dir */
              if(!st._lastAttachDir){var curSess=_sessions[_sessionActive];if(curSess&&curSess._projectId){var prj=PROJECTS.find(function(p){return p.id===curSess._projectId;});if(prj&&prj.path)st._lastAttachDir=prj.path;}}
              var _bridge=(typeof window!=='undefined')?window.electronIntentSmith:null;
              if(_bridge&&typeof _bridge.pickAttachmentFiles==='function'){
                _chatPickAttachments(st,_bridge,function(added){if(added&&added.length>0)_persistSessionState();renderChat();});
              }else{
                var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var j=0;j<inp.files.length;j++){st.attachments.push({name:inp.files[j].name,size:Math.round(inp.files[j].size/1024)+' KB',file:inp.files[j]});}renderChat();}document.body.removeChild(inp);};inp.click();
                            }}},svgEl(I.attach,12)),
          s._projectId&&s._convId?h('button',{type:'button',id:'m2-build-'+idx+'-open',style:{background:C.accentBg,color:C.accentText,border:'1px solid '+C.border2,borderRadius:4,cursor:'pointer',padding:'3px 6px',fontSize:_fs(10)},
            disabled:!!st._m2Busy||!!st._preparedSend||!!_m2NormalizePending(s._m2Pending),onClick:function(){_m2OpenComposer(idx);}},st._m2Composer?'Pokračovat v zadání':st._projectWorkProposal?'Připravit navržený krok':'Připravit změnu'):null,
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
              onClick:function(ev){ev.stopPropagation();var intentsmith=window._intentsmith;if(intentsmith)intentsmith.clearSpecialist();}},'✕')):
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
              h('span',{style:{fontSize:_fs(11),color:exp.fav?C.accentText:C.tx4,cursor:'pointer'},onClick:function(e){e.stopPropagation();exp.fav=!exp.fav;if(exp.id){fetch(_backendUrl()+'/api/expertises/'+exp.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:exp.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderChat();}},exp.fav?'★':'☆'));}),
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
  var projectFiles=s._projectId?FILES.filter(function(f){return !f.d;}).map(function(f){return {name:f.n,path:_wtRoot+'/'+f.fp};}):[];
  var files=projectFiles.concat(s._focusFiles||[]).slice(0,100);
  var bm=s._focusBulkMode;
  var bs=s._focusBulkSelected;
  function _toggleFocusBulk(){s._focusBulkMode=!s._focusBulkMode;s._focusBulkSelected=[];renderChat();}
  function _toggleFocusItem(idx){var pos=bs.indexOf(idx);if(pos>=0){bs.splice(pos,1);}else{bs.push(idx);}renderChat();}
  function _focusBulkDelete(){if(bs.length===0)return;var sorted=bs.slice().sort(function(a,b){return b-a;});for(var k=0;k<sorted.length;k++){s._focusFiles.splice(sorted[k],1);}s._focusBulkMode=false;s._focusBulkSelected=[];_persistSessionState();renderChat();}
  var markBtnS={border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:700,cursor:'pointer',background:bm?C.accent:'transparent',color:bm?C.onAccent:C.tx4,transition:'background 0.15s'};
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
          var rowBg=bSel?_rgba(C.accent,0.15):'transparent';
          return h('div',{key:f.name+'-'+i,style:{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',borderRadius:6,marginBottom:2,cursor:bm?'pointer':'default',background:rowBg,transition:'background 0.15s'},
            onClick:bm?function(){_toggleFocusItem(i);}:undefined,
            onMouseEnter:function(e){if(!bSel)e.currentTarget.style.background=C.bg3;},
            onMouseLeave:function(e){e.currentTarget.style.background=bSel?_rgba(C.accent,0.15):'transparent';}},
            bm?h('div',{style:{width:16,height:16,borderRadius:4,border:'2px solid '+(bSel?C.accent:C.tx4),background:bSel?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}},
              bSel?h('svg',{width:10,height:10,viewBox:'0 0 24 24',fill:'none',stroke:'#fff',strokeWidth:3,strokeLinecap:'round',strokeLinejoin:'round'},h('polyline',{points:'20 6 9 17 4 12'})):null):null,
            h('span',{style:{fontSize:_fs(13),flexShrink:0}},isImg?'🖼️':'📄'),
            h('div',{style:{flex:1,minWidth:0}},
              h('div',{style:{fontSize:_fs(11),fontWeight:bSel?700:600,color:bSel?C.accentText:C.tx1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},f.name),
              h('div',{style:{fontSize:_fs(9),color:C.tx4}},f.size||'')),
            h('span',{style:{fontSize:_fs(9),color:C.tx4,flexShrink:0}},_relativeTime(f.addedAt)),
            !bm&&f.path?_workspaceButton('Otevřít','Otevřít '+f.name,function(){_openFileTab(f.path);}):null,
            !bm&&f.path?h('button',{style:{background:C.bg4,border:'none',borderRadius:4,padding:'2px 6px',cursor:'pointer',color:C.tx3,fontSize:_fs(10),flexShrink:0},
              title:'Kopírovat cestu',onClick:function(){try{navigator.clipboard.writeText(f.path);}catch(e){}}},'📋'):null);
        })));
}

/* Session workspace: stable transport indices, one owner per vertical column. */
var _workspaceTextareas={};
function _snapshotWorkspaceDrafts(){
  Object.keys(_workspaceTextareas||{}).forEach(function(idx){var item=_workspaceTextareas[idx];if(item&&item.node&&item.session===_sessions[idx])item.session.chat._draft=item.node.value;});
}
var _workspaceSplit=false;
var _workspacePanelMode=null;
var _specialistWorkspaces={};
try{_specialistWorkspaces=JSON.parse(localStorage.getItem('intentsmith-specialist-workspaces')||'{}')||{};}catch(e){}
function _workspaceShown(){return !_centerState.view&&!_projectWizard.active&&!_expertiseWizard.active&&!_agentWizard.active&&!_specialistWizard.active;}
function _workspaceSessionIndices(){return _sessions.map(function(s,i){return s._closed?-1:i;}).filter(function(i){return i>=0;});}
function _showWorkspace(){_ensureWorkspaceTree(_sessionActive);_centerState.view=null;_centerState.detail=null;_settingsVals.lastView='';if(_sidebarWidget)_sidebarWidget._active=null;_syncWorkspacePanels();renderCenter();renderChat();}
function _syncWorkspacePanels(){
  var visible=_workspaceShown();var app=window._intentsmithApp;
  if(!app||!app.shell)return;
  try{
    var bottom=app.shell.bottomPanel; if(bottom&&typeof bottom.hide==='function')bottom.hide();
    var handler=app.shell.bottomPanelHandler;if(handler&&handler.container)handler.container.hide();
    var right=app.shell.rightPanelHandler;
    if(right&&right.container&&_workspacePanelMode!==visible){_workspacePanelMode=visible;if(visible){right.container.show();app.shell.resize(280,'right');}else right.container.hide();}
  }catch(e){}
}
function _workspaceButton(text,title,fn,extra){return h('button',Object.assign({type:'button',title:title,'aria-label':title,onClick:fn,style:{background:'transparent',border:0,borderRadius:3,color:C.tx2,padding:'5px 9px',cursor:'pointer',fontFamily:C.font,fontSize:12,whiteSpace:'nowrap'}},extra||{}),text);}
function _workspaceBusy(idx){var s=_sessions[idx];return !!(s&&(s.chat._m2Busy||s.chat._specialistSelecting||(typeof IntentSmithWS!=='undefined'&&IntentSmithWS.hasActiveM1Turn(s))||(typeof IntentSmithTerminal!=='undefined'&&IntentSmithTerminal.isExecuting(idx))||(typeof IntentSmithAgent!=='undefined'&&IntentSmithAgent.isExecuting(idx))));}
function _addWorkspaceSession(){
  var idx=_sessions.findIndex(function(s,i){return s._closed&&!_workspaceBusy(i);});
  if(idx<0){if(_sessionCount>=24){alert('Nejdřív zavři některou z otevřených relací.');return -1;}idx=_sessionCount++;_ensureSessions();}
  else _sessions[idx]=_mkSession();
  _switchSession(idx);_showWorkspace();_persistSessionState();return idx;
}
function _closeWorkspaceConversation(idx){
  if(_workspaceBusy(idx)){alert('Nejdřív dokonči nebo zastav probíhající úlohu v této relaci.');return false;}
  var s=_sessions[idx];_rememberSpecialistFiles(s);if(!_chatCancelPreparedSend(idx,s))_chatInvalidatePreparedSends(s.chat);
  var editor=s._editor;_sessions[idx]=_mkSession();_sessions[idx]._editor=editor;
  _perSessionTree[idx]=null;if(idx===_sessionActive){_wtRoot='';_wtRawTree=null;FILES=[];_editorState=editor;}
  _persistSessionState();_renderAll();return true;
}
function _closeWorkspaceSession(idx){
  var s=_sessions[idx];if(!s||_workspaceBusy(idx)){alert('Nejdřív dokonči nebo zastav probíhající úlohu v této relaci.');return false;}
  if(s._editor&&s._editor.tabs.some(function(t){return t.dirty;})&&!confirm('Zavřít relaci s neuloženými změnami?'))return false;
  if(!_closeWorkspaceConversation(idx))return false;
  _sessions[idx]._closed=true;_sessions[idx]._editor={active:false,tabs:[],activeTabId:null,scrollRaf:null};
  var open=_workspaceSessionIndices();if(!open.length){_sessions[idx]._closed=false;open=[idx];}
  if(idx===_sessionActive){_sessionActive=-1;_switchSession(open[0]);}
  _persistSessionState();_renderAll();return true;
}
function _workspaceResize(e,idx){
  e.preventDefault();var s=_sessions[idx],start=e.clientY,height=s._outputHeight||210;
  function move(ev){s._outputHeight=Math.max(100,Math.min(window.innerHeight-240,height+start-ev.clientY));renderCenter();}
  function up(){document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);}
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
}
function WorkspaceApp(){
  _ensureSessions();var open=_workspaceSessionIndices();var visible=_workspaceSplit?open:[_sessionActive];
  return h('main',{id:'intentsmith-workspace',style:{height:'100%',width:'100%',minWidth:0,minHeight:0,contain:'size layout',display:'flex',flexDirection:'column',background:C._solidBg0||C.bg0,color:C.tx1,fontFamily:C.font}},
    h('div',{role:'tablist','aria-label':'Pracovní relace',style:{display:'flex',minHeight:36,borderBottom:'1px solid '+C.border,background:C.bg2,overflowX:'auto',flexShrink:0}},
      open.map(function(idx){var s=_sessions[idx];var title=s._label||(s.chat.specialist&&s.chat.specialist.name)||'Nová relace';return h('div',{key:idx,style:{display:'flex',borderRight:'1px solid '+C.border,borderBottom:'2px solid '+(_sessionActive===idx?C.accent:'transparent'),background:_sessionActive===idx?C.bg1:'transparent',maxWidth:250,flexShrink:0}},
        _workspaceButton(title,title,function(){_switchSession(idx);_showWorkspace();},{role:'tab','aria-selected':_sessionActive===idx,'data-session-tab':idx}),
        _workspaceButton('×','Zavřít relaci '+title,function(){_closeWorkspaceSession(idx);}));}),
      _workspaceButton('+','Nová relace',function(){_addWorkspaceSession();},{id:'intentsmith-new-session'}),
      h('div',{style:{flex:1}}),_workspaceButton(_workspaceSplit?'Jedna relace':'Vedle sebe','Rozdělit pracovní prostor',function(){_workspaceSplit=!_workspaceSplit;renderCenter();},{'aria-pressed':_workspaceSplit,id:'intentsmith-split-sessions'})),
    h('div',{style:{display:'flex',flex:1,minWidth:0,minHeight:0,overflowX:'auto'}},visible.map(function(idx){
      var s=_sessions[idx];if(!s||s._closed)return null;var editor=s._editor;var fileOpen=editor&&editor.active&&editor.tabs.length>0;
      var chat=h('section',{'aria-label':'Chat relace','data-session-chat':idx,style:{display:'flex',flexDirection:'column',minHeight:0,flex:fileOpen?(s._chatCollapsed?'0 0 34px':'0 0 36%'):1}},
        fileOpen?h('div',{style:{display:'flex',height:34,background:C.bg2,alignItems:'center',flexShrink:0}},_workspaceButton(s._chatCollapsed?'Rozbalit chat':'Sbalit chat','Přepnout zobrazení chatu',function(){s._chatCollapsed=!s._chatCollapsed;renderCenter();}),h('div',{style:{flex:1}}),_workspaceButton(s._chatPosition==='top'?'Chat dolů':'Chat nahoru','Změnit umístění chatu',function(){s._chatPosition=s._chatPosition==='top'?'bottom':'top';renderCenter();})):null,
        h('div',{style:{display:fileOpen&&s._chatCollapsed?'none':'flex',flex:1,minHeight:0}},_chatPaneUI(idx)));
      return h('section',{key:idx,'data-session-column':idx,onMouseDownCapture:function(){_switchSession(idx);},onFocusCapture:function(){_switchSession(idx);},style:{flex:_workspaceSplit?'1 0 360px':'1 1 0px',minWidth:_workspaceSplit?360:0,contain:'inline-size',display:'flex',flexDirection:'column',overflow:'hidden',borderRight:'1px solid '+C.border2}},
        s._chatPosition==='top'?chat:null,
        fileOpen?h('section',{'aria-label':'Soubory relace',style:{display:'flex',flex:1,minWidth:0,flexDirection:'column',minHeight:80,overflow:'hidden'}},centerEditor(idx)):null,
        s._chatPosition!=='top'?chat:null,
        h('div',{role:'separator','aria-label':'Výška výstupů',onMouseDown:function(e){_workspaceResize(e,idx);},style:{height:5,cursor:'row-resize',background:C.border,flexShrink:0}}),
        h('section',{'aria-label':'Výstupy relace','data-session-output':idx,style:{height:s._outputHeight||210,minHeight:90,display:'flex',flexShrink:0}},_bottomPane(idx)));
    })));
}
function _specialistKey(spec){return spec&&spec.id==='accountant'?'accountant-cz':spec&&spec.id;}
function _specialistFiles(id){var w=_specialistWorkspaces[id];return w&&Array.isArray(w.files)?w.files.slice():[];}
function _rememberSpecialistFiles(s){
  var id=_specialistKey(s&&s.chat.specialist);if(!id)return;
  var w=_specialistWorkspaces[id]||{files:[],conversations:[]};w.files=(s._focusFiles||[]).slice(0,100);
  if(s._convId&&!w.conversations.some(function(c){return c.id===s._convId;}))w.conversations.unshift({id:s._convId,title:s._label||s.chat.specialist.name});
  w.conversations=w.conversations.slice(0,100);_specialistWorkspaces[id]=w;
  try{localStorage.setItem('intentsmith-specialist-workspaces',JSON.stringify(_specialistWorkspaces));}catch(e){}
}
function _openSpecialistWorkspace(spec){
  var id=_specialistKey(spec);var idx=_sessions.findIndex(function(s){return !s._closed&&_specialistKey(s.chat.specialist)===id;});
  if(idx>=0){_switchSession(idx);_showWorkspace();return Promise.resolve(true);}
  idx=_isSessionEmpty(_sessions[_sessionActive])?_sessionActive:_addWorkspaceSession();if(idx<0)return Promise.resolve(false);
  _switchSession(idx);_sessions[idx]._label=spec.name;return _chatSelectSpecialist(_sessions[idx],spec);
}
function _loadWorkspaceConversation(idx,conv,spec){
  var s=_sessions[idx];if(_workspaceBusy(idx))return;
  _chatInvalidatePreparedSends(s.chat);var token={};s._openToken=token;
  s.chat.msgs=[{role:'system',text:'Načítám historii…'}];s._convId=null;s._projectId=null;s._agentId=null;s._m2Pending=null;
  function current(){return _sessions[idx]===s&&s._openToken===token;}
  return fetch(_backendUrl()+'/api/conversations/'+encodeURIComponent(conv.id),{signal:AbortSignal.timeout(5000)}).then(function(r){if(!r.ok)throw Error('Historii nelze otevřít ('+r.status+').');return r.json();}).then(function(data){
    if(!current())return;
    return fetch(_backendUrl()+'/api/conversations/'+encodeURIComponent(conv.id)+'/messages',{signal:AbortSignal.timeout(5000)}).then(function(r){if(!r.ok)throw Error('Zprávy nelze načíst.');return r.json();}).then(function(body){
      if(!current())return;var items=Array.isArray(body)?body:body.messages;if(!Array.isArray(items))throw Error('Neplatná historie.');
      var meta={};try{meta=typeof data.metadata==='string'?JSON.parse(data.metadata):data.metadata||{};}catch(e){}
      s._convId=conv.id;s._projectId=data.project_id||null;s._history=null;s._agentId=meta.agentId||null;s._label=data.title||conv.title;
      s.chat.specialist=spec||null;s.chat.msgs=items.map(function(m){return {role:m.role,text:m.content||m.text||''};});s.chat._projectWorkProposal=null;
      _perSessionTree[idx]=null;if(idx===_sessionActive)_loadTreeState(idx);_persistSessionState();renderChat();
    });
  }).catch(function(e){if(current()){s.chat.msgs=[{role:'system',tag:'ERROR',text:e.message}];renderChat();}});
}
function _fetchSpecialistHistory(s,id){
  s._historyLoading=true;
  var historyScope=s._projectId;
  var route=id?'/api/conversations?limit=100&specialistId='+encodeURIComponent(id):historyScope?'/api/projects/'+encodeURIComponent(historyScope)+'/conversations?limit=100':'/api/conversations?limit=100';
  fetch(_backendUrl()+route,{signal:AbortSignal.timeout(5000)}).then(function(r){if(!r.ok)throw Error('Historii nelze načíst.');return r.json();}).then(function(body){if(_specialistKey(s.chat.specialist)!==id||s._projectId!==historyScope)return;s._history=body.conversations||[];s._historyError=null;}).catch(function(e){s._history=[];s._historyError=e.message;}).finally(function(){s._historyLoading=false;renderChat();});
}
var _specialistFileStore=require('../../../../shared/specialist-files').createSpecialistFileStore(window.indexedDB);
function _loadSpecialistFiles(s,id){
  s._filesLoading=true;return _specialistFileStore.list(id).then(function(files){if(_specialistKey(s.chat.specialist)!==id)return;s._storedFiles=files;s._filesError=null;}).catch(function(e){s._filesError=e.message;}).finally(function(){s._filesLoading=false;renderChat();});
}
function _pickSpecialistFiles(s,id){
  var input=document.createElement('input');input.type='file';input.multiple=true;input.hidden=true;
  document.body.appendChild(input);input.oncancel=function(){input.remove();};
  input.onchange=async function(){try{for(var file of input.files||[])await _specialistFileStore.put(id,file);await _loadSpecialistFiles(s,id);}catch(e){s._filesError=e.message;renderChat();}finally{input.remove();}};input.click();
}
function _previewSpecialistFile(s,id,file){
  return _specialistFileStore.get(id,file.id).then(async function(row){
    if(_specialistKey(s.chat.specialist)!==id)return;
    if(row.size>512*1024||!(/^(text\/|application\/(json|xml))/.test(row.type)||/\.(txt|md|js|ts|py|json|csv|log|css|html|yaml|yml)$/i.test(row.name)))throw Error('Náhled je dostupný pro textové soubory do 512 KiB. Soubor můžeš připojit do chatu.');
    var content=await row.blob.text();if(_specialistKey(s.chat.specialist)!==id)return;
    var tab={id:'specialist-'+row.id,type:'file',label:row.name,path:'specialist:'+row.id,content:content,dirty:false,scrollTop:0};
    if(!s._editor.tabs.some(function(t){return t.id===tab.id;}))s._editor.tabs.push(tab);
    s._editor.active=true;s._editor.activeTabId=tab.id;s._chatCollapsed=true;renderCenter();
  }).catch(function(e){s._filesError=e.message;renderChat();});
}
function SpecialistFilesApp(s,id){
  if(!s._storedFiles&&!s._filesLoading&&!s._filesError)_loadSpecialistFiles(s,id);
  return h('div',{style:{display:'flex',flexDirection:'column',flex:1,minHeight:0}},
    h('div',{style:{padding:8,display:'flex',flexWrap:'wrap'}},_workspaceButton('+ Přidat soubory','Přidat soubory specialistovi',function(){_pickSpecialistFiles(s,id);}),
      _workspaceButton('Sdílet…','Převzít soubor jiného specialisty',async function(){try{var list=[];for(var key of Object.keys(_specialistWorkspaces)){if(key!==id)for(var f of await _specialistFileStore.list(key))list.push({owner:key,file:f});}s._shareFiles=list;renderChat();}catch(e){s._filesError=e.message;renderChat();}})),
    s._filesError?h('p',{role:'alert',style:{padding:10,color:C.red}},s._filesError):null,
    s._shareFiles?h('div',{style:{padding:10,borderBottom:'1px solid '+C.border}},h('p',null,'Vyber soubor ke zkopírování do tohoto prostoru.'),s._shareFiles.length?s._shareFiles.map(function(c){return _workspaceButton(c.file.name+' · '+((SPECIALISTS.find(function(spec){return _specialistKey(spec)===c.owner;})||{}).name||c.owner),'Sdílet '+c.file.name,async function(){try{await _specialistFileStore.share(c.owner,id,c.file.id);s._shareFiles=null;await _loadSpecialistFiles(s,id);}catch(e){s._filesError=e.message;renderChat();}});}):h('p',null,'Žádné soubory k převzetí.'),_workspaceButton('Zavřít','Zavřít sdílení',function(){s._shareFiles=null;renderChat();})):null,
    h('div',{style:{overflowY:'auto',flex:1,padding:8}},s._filesLoading?h('p',null,'Načítám soubory…'):(s._storedFiles||[]).length?(s._storedFiles||[]).map(function(f){return h('div',{key:f.id,style:{padding:'10px 0',borderBottom:'1px solid '+C.border}},
      h('div',{style:{overflowWrap:'anywhere',fontSize:12}},f.name),h('div',{style:{color:C.tx2,fontSize:11,marginTop:4}},_attachSizeLabel(f.size)),
      _workspaceButton('Náhled','Otevřít '+f.name,function(){_previewSpecialistFile(s,id,f);}),
      _workspaceButton('Připojit','Připojit '+f.name+' do rozepsané zprávy',async function(){try{var row=await _specialistFileStore.get(id,f.id);if(_specialistKey(s.chat.specialist)!==id)return;s.chat.attachments.push({name:row.name,size:_attachSizeLabel(row.size),file:new File([row.blob],row.name,{type:row.type})});s._chatCollapsed=false;renderChat();}catch(e){s._filesError=e.message;renderChat();}}),
      _workspaceButton('Odebrat','Odebrat '+f.name,async function(){if(!confirm('Odebrat uloženou kopii souboru '+f.name+'? Původní soubor na disku zůstane zachován.'))return;try{await _specialistFileStore.remove(id,f.id);await _loadSpecialistFiles(s,id);}catch(e){s._filesError=e.message;renderChat();}}));}):h('p',{style:{padding:10,fontSize:12}},'Přidej soubory pro tohoto specialistu. Do chatu se dostanou až po připojení.')));
}

function WorkspaceContextApp(){
  if(!_workspaceShown())return null;var idx=_sessionActive,s=_sessions[idx];if(!s)return null;
  var spec=s.chat.specialist,id=_specialistKey(spec);var tab=s._contextTab||'history';
  _rememberSpecialistFiles(s);
  if(!s._historyLoading&&s._history==null){_fetchSpecialistHistory(s,id);}
  var history=s._history||[];
  return h('aside',{style:{height:'100%',display:'flex',flexDirection:'column',background:C.bg1,color:C.tx2,fontFamily:C.font}},
    h('div',{style:{padding:'12px 10px',fontWeight:600,borderBottom:'1px solid '+C.border}},spec?spec.name:s._label||'Pracovní prostor'),
    h('div',{role:'tablist','aria-label':'Kontext relace',style:{display:'flex',borderBottom:'1px solid '+C.border}},['history','files'].map(function(t){return _workspaceButton(t==='history'?'Historie':'Soubory',t==='history'?'Historie konverzací':'Soubory specialisty nebo relace',function(){s._contextTab=t;if(t==='history')s._history=null;_persistSessionState();renderChat();},{role:'tab','aria-selected':t===tab,style:{flex:1,padding:10,background:C.bg1,border:0,borderBottom:'2px solid '+(t===tab?C.accent:'transparent'),color:C.tx1,cursor:'pointer'}});})),
    tab==='files'?(id?SpecialistFilesApp(s,id):FocusFilesApp()):h('div',{style:{flex:1,overflowY:'auto',padding:8}},
        _workspaceButton('+ Nová konverzace','Nová konverzace v tomto prostoru',function(){var savedSpec=spec,project=s._projectId;if(!_closeWorkspaceConversation(idx))return;if(savedSpec)_chatSelectSpecialist(_sessions[idx],savedSpec);else if(project){var p=PROJECTS.find(function(p){return p.id===project;});if(p){_sessions[idx]._projectId=project;_sessions[idx]._label=p.name;}}}),
        s._historyError?h('p',{role:'alert'},s._historyError):s._historyLoading?h('p',null,'Načítám historii…'):history.length?history.map(function(c){return h('button',{key:c.id,style:{display:'block',width:'100%',textAlign:'left',padding:10,marginBottom:3,border:0,borderRadius:3,background:c.id===s._convId?C.bg3:'transparent',color:C.tx1,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis'},onClick:function(){_loadWorkspaceConversation(idx,c,spec);}},c.title||'Konverzace');}):h('p',{style:{padding:10,fontSize:12,color:C.tx2}},'Zatím žádné uložené konverzace.')));
}

function ChatApp(){return WorkspaceContextApp();}

class IntentSmithChatWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=INTENTSMITH_CHAT_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.cssText='height:100%;width:100%;outline:none;';}
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render — we manage DOM via ReactDOM.render */}
  onAfterAttach(){_chatContainer=this.node;renderChat();}
}
inversify_1.decorate(inversify_1.injectable(),IntentSmithChatWidget);


/* ═══════════════════════════════════════════════════════════
   4. AGENT LOG — pure DOM via ReactDOM.render
   ═══════════════════════════════════════════════════════════ */
var INTENTSMITH_AGENT_ID='intentsmith-agent-panel';
var TC={cre:C.cyan,llm:C.purple,tool:C.amber,gate:C.accentText,turn:C.blue,sys:C.tx3};
var _agentContainer=null;
var _turnCollapsed={};
var _scrollOnNewOnly=false;
var _agentRoot=null;
function _appendSessionLog(idx,type,text){
  var s=_sessions[idx];if(!s||s._closed)return;
  var now=new Date();s.log.forEach(function(e){e.active=false;});
  s.log.push({time:now.toLocaleTimeString('cs-CZ'),type:type,cls:type.toLowerCase(),text:text,active:true,ts:now.toISOString()});renderAgent();
}
function renderAgent(){if(_workspaceShown())renderCenter();}
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
    var agentColor=e.agent&&typeof IntentSmithAgent!=='undefined'?IntentSmithAgent.getAgentColor(e.agent):null;
    return h('div',{key:i,style:{display:'flex',gap:6,padding:'3px 10px',fontFamily:C.mono,fontSize:_fs(11),lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?_rgba(C.accent,0.05):'transparent'}},
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
  if(typeof IntentSmithTerminal!=='undefined')IntentSmithTerminal.send(idx,v);
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
  fetch(_backendUrl()+'/api/workspace/ls?path='+encodeURIComponent(dir)+'&prefix='+encodeURIComponent(partial),{signal:_termTabAbort.signal})
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

/* Focus is a user action, never a render side effect: split terminals must not steal it. */
function _focusTerminalInput(idx,owner){
  setTimeout(function(){
    if(_sessionActive!==idx||_sessions[idx]!==owner||owner._closed)return;
    var el=document.getElementById('intentsmith-term-input-'+idx);if(el&&!el.disabled)el.focus();
  },0);
}
function _terminalContent(s,idx){
  var isExec=typeof IntentSmithTerminal!=='undefined'&&IntentSmithTerminal.isExecuting(idx);
  return h('div',{style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    h('div',{style:{flex:1,overflowY:'auto',padding:'5px 10px',fontFamily:C.mono,fontSize:_fs(11.5),lineHeight:'1.6',color:C.tx2}},
      s.term.map(function(t,i){
        return h('div',{key:i},t.accent?h('span',{style:{color:C.accentText}},t.text):h('span',null,
          t.text.indexOf('$ ')>=0?[h('span',{key:'p',style:{color:C.accentText}},t.text.slice(0,t.text.indexOf('$ ')+2)),t.text.slice(t.text.indexOf('$ ')+2)]:t.text));
      })),
    /* Terminal input */
    h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'3px 6px',borderTop:'1px solid '+C.border,background:C.bg2,flexShrink:0}},
      h('span',{style:{color:C.accentText,fontFamily:C.mono,fontSize:_fs(11),flexShrink:0}},'$'),
      h('input',{id:'intentsmith-term-input-'+idx,key:'term-input-'+idx,
        style:{flex:1,background:'none',border:'none',outline:'none',color:C.tx1,fontFamily:C.mono,fontSize:_fs(11.5)},
        placeholder:isExec?'Čekám na dokončení...':'Zadej příkaz...',disabled:isExec,
        onKeyDown:function(e){
          /* Enter — execute command */
          if(e.key==='Enter'){
            var v=e.target.value.trim();
            if(v){_termExec(idx,v);e.target.value='';renderAgent();
              _focusTerminalInput(idx,s);}
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
    if(it.src==='log'){var e=it.d;return h('div',{key:'l'+i,style:{display:'flex',gap:6,padding:'2px 10px',fontFamily:C.mono,fontSize:_fs(11),lineHeight:'1.5',borderLeft:e.active?'3px solid '+C.accent:'3px solid transparent',background:e.active?_rgba(C.accent,0.05):'transparent'}},
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
  if (!localPreparedCancelled && typeof IntentSmithWS !== 'undefined') chatCancelSent = IntentSmithWS.sendCancel(s);
  if (typeof IntentSmithTerminal !== 'undefined') IntentSmithTerminal.cancel(idx);
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
    var url=_backendUrl()+'/api/audit?limit=100'+(convId?'&conversation_id='+convId:'');
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
  var mode=['terminal','agent','audit'].indexOf(s.bottom)>=0?s.bottom:'agent';
  /* Split/Mix together, then gap, then Terminal/Log/Audit */
  var grpA=[];
  var grpB=[{k:'terminal',l:'Terminal'},{k:'agent',l:'Log'},{k:'audit',l:'Audit'}];
  function setMode(m){s.bottom=m;renderAgent();if(m==='terminal')_focusTerminalInput(idx,s);}
  function _tab(m,mi){var active=mode===m.k;return h(React.Fragment,{key:m.k},
    mi>0?h('div',{style:{width:1,background:C.border}}):null,
    h('div',{style:{display:'flex',alignItems:'center',padding:'0 8px',fontSize:_fs(12),fontWeight:600,color:active?C.tx1:C.tx4,cursor:'pointer',borderBottom:'2px solid '+(active?C.accent:'transparent'),gap:3},
      onClick:function(){setMode(m.k);}},
      m.l,m.k==='agent'?h('span',{style:{fontSize:_fs(8),background:C.bg4,padding:'0 3px',borderRadius:4,color:C.tx3}},s.log.length):null));}
  return h('div',{key:'bp'+idx,style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}},
    /* Per-panel tab bar — hidden in focus mode via CSS class */
    h('div',{className:'intentsmith-bottom-mode-tabs',style:{height:24,display:'flex',alignItems:'stretch',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2}},
      grpA.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{width:10}}),/* gap between groups */
      grpB.map(function(m,mi){return _tab(m,mi);}),
      h('div',{style:{flex:1}}),
      /* STOP button — visible when executing */
      (typeof IntentSmithAgent!=='undefined'&&IntentSmithAgent.isExecuting(idx))||(typeof IntentSmithTerminal!=='undefined'&&IntentSmithTerminal.isExecuting(idx))?
        h('button',{style:{background:C.redBg,color:C.red,border:'none',borderRadius:3,cursor:'pointer',fontSize:_fs(8),fontWeight:700,padding:'2px 6px',margin:'0 4px',alignSelf:'center'},
          onClick:function(){_cancelExecution(idx);}},'■ STOP'):null,
      null),
    /* Panel content */
    mode==='split'?_splitContent(s,idx):mode==='agent'?_agentLogContent(s):mode==='terminal'?_terminalContent(s,idx):mode==='audit'?_auditContent(s):_mixedContent(s));
}


class IntentSmithAgentWidget extends react_widget_1.ReactWidget {
  constructor(){super();this.id=INTENTSMITH_AGENT_ID;this.title.label='';this.title.iconClass='';this.title.closable=false;this.node.tabIndex=-1;this.node.style.cssText='height:100%;width:100%;outline:none;';}
  render(){return null;}
  onUpdateRequest(){/* block ReactWidget re-render */}
  onAfterAttach(){_agentContainer=this.node;renderAgent();}
}
inversify_1.decorate(inversify_1.injectable(),IntentSmithAgentWidget);


/* ═══════════════════════════════════════════════════════════
   CONTRIBUTIONS
   ═══════════════════════════════════════════════════════════ */

/* ── Snap-collapse state ── */
var _intentsmithLastLeftW=240,_intentsmithLastRightW=280;
var _INTENTSMITH_MIN_LEFT=200,_INTENTSMITH_MIN_RIGHT=220;
var _intentsmithSnapLock=false;
var _agentsForbidden=false;

class IntentSmithSidebarContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:INTENTSMITH_SIDEBAR_ID,widgetName:'IntentSmith Navigation',defaultWidgetOptions:{area:'left',rank:0},toggleCommandId:'intentsmith:toggleSidebar',toggleKeybinding:'ctrlcmd+b'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  registerCommands(c){
    c.registerCommand({id:'intentsmith:toggleSidebar',label:'IntentSmith: Toggle Sidebar',category:'IntentSmith'},{
      execute:function(){
        if(typeof window._intentsmithIsLeftHidden==='function'&&window._intentsmithIsLeftHidden()){
          var tw=(_sidebarWidget&&_sidebarWidget._collapsed)?48:(_intentsmithLastLeftW||240);
          window._intentsmithSnapShowLeft(tw);
        }else{
          var n=document.getElementById('theia-left-content-panel');
          if(n)_intentsmithLastLeftW=n.offsetWidth||240;
          window._intentsmithSnapHideLeft();
        }
      }
    });
  }
  async onStart(a){
    window._intentsmithApp=a;
    try{await this.openView({activate:false,reveal:true});}catch(e){}
    _intentsmithSnapLock=true; /* Lock immediately — prevent snap-collapse during entire init */
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
      }catch(e){console.warn('[IntentSmith] Split spacing fix:',e);}
      /* ── Snap-collapse via ResizeObserver + expand tabs ── */
      try{
        console.log('[IntentSmith] Snap-collapse init');
        var _lph=a.shell.leftPanelHandler;
        var _rph=a.shell.rightPanelHandler;
        var leftCP=_lph&&_lph.container?_lph.container.node:null;
        var rightCP=_rph&&_rph.container?_rph.container.node:null;
        console.log('[IntentSmith] leftCP=',!!leftCP,'rightCP=',!!rightCP);
        var _leftSnapT=null,_rightSnapT=null;
        /* Helper: hide a side panel via Lumino Widget.hide() — removes from layout */
        function _snapHide(handler,side){
          _intentsmithSnapLock=true;
          console.log('[IntentSmith] snap-hide',side);
          try{handler.container.hide();}catch(e){console.warn('[IntentSmith] hide fail',e);}
          setTimeout(function(){_intentsmithSnapLock=false;},600);
        }
        /* Helper: show a side panel + resize to saved width */
        function _snapShow(handler,side,w){
          _intentsmithSnapLock=true;
          console.log('[IntentSmith] snap-show',side,w);
          try{handler.container.show();a.shell.resize(w,side);}catch(e){console.warn('[IntentSmith] show fail',e);}
          setTimeout(function(){_intentsmithSnapLock=false;},600);
        }
        /* Right panel: snap-hide when below threshold */
        if(rightCP){new ResizeObserver(function(entries){
          if(_intentsmithSnapLock||!_settingsVals.autoCollapse)return;
          var w=entries[0].contentRect.width;
          if(w>0&&w<_INTENTSMITH_MIN_RIGHT){
            if(!_rightSnapT){_rightSnapT=setTimeout(function(){
              _rightSnapT=null;if(_intentsmithSnapLock)return;
              if(rightCP.offsetWidth>0&&rightCP.offsetWidth<_INTENTSMITH_MIN_RIGHT){
                _snapHide(_rph,'right');
              }
            },300);}
          }else{if(_rightSnapT){clearTimeout(_rightSnapT);_rightSnapT=null;}
            if(w>=_INTENTSMITH_MIN_RIGHT){_intentsmithLastRightW=w;}
          }
        }).observe(rightCP);}
        /* Left panel: snap-hide when below threshold */
        if(leftCP){new ResizeObserver(function(entries){
          if(_intentsmithSnapLock||!_settingsVals.autoCollapse)return;
          var w=entries[0].contentRect.width;
          if(w>0&&w<_INTENTSMITH_MIN_LEFT){
            if(!_leftSnapT){_leftSnapT=setTimeout(function(){
              _leftSnapT=null;if(_intentsmithSnapLock)return;
              if(leftCP.offsetWidth>0&&leftCP.offsetWidth<_INTENTSMITH_MIN_LEFT){
                _snapHide(_lph,'left');
              }
            },300);}
          }else{if(_leftSnapT){clearTimeout(_leftSnapT);_leftSnapT=null;}
            if(w>=160){_intentsmithLastLeftW=w;}
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
              var tw=(_sidebarWidget&&_sidebarWidget._collapsed)?48:(_intentsmithLastLeftW||240);
              _snapShow(_lph,'left',tw);
            }else{
              _snapShow(_rph,'right',_intentsmithLastRightW||280);
            }
          });
          document.body.appendChild(el);
          return el;
        };
        var _leftTab=_mkExpandTab('left');
        var _rightTab=_mkExpandTab('right');
        /* Show/hide expand tabs based on container hidden state */
        /* Expose snap helpers for toggle commands */
        window._intentsmithSnapHideLeft=function(){_snapHide(_lph,'left');};
        window._intentsmithSnapShowLeft=function(w){_snapShow(_lph,'left',w);};
        window._intentsmithSnapHideRight=function(){_snapHide(_rph,'right');};
        window._intentsmithSnapShowRight=function(w){_snapShow(_rph,'right',w);};
        window._intentsmithIsLeftHidden=function(){return _lph.container.isHidden;};
        window._intentsmithIsRightHidden=function(){return _rph.container.isHidden;};
        /* Show/hide expand tabs based on container hidden state */
        function _updateTabs(){
          _leftTab.style.display=(_lph.container.isHidden)?'flex':'none';
          _rightTab.style.display=(_rph.container.isHidden)?'flex':'none';
        }
        setInterval(_updateTabs,500);
        _updateTabs();
        /* v130: Resize right panel AFTER observers are installed (fixes race condition) */
        try{a.shell.resize(280,'right');}catch(e){}
        /* Unlock snap-collapse after panels have settled */
        setTimeout(function(){_intentsmithSnapLock=false;console.log('[IntentSmith] Snap-lock released');},1200);
      }catch(e){console.warn('[IntentSmith] Snap-collapse setup:',e);_intentsmithSnapLock=false;}
    },800);
  }
}
inversify_1.decorate(inversify_1.injectable(),IntentSmithSidebarContrib);

class IntentSmithChatContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:INTENTSMITH_CHAT_ID,widgetName:'IntentSmith Chat',defaultWidgetOptions:{area:'right',rank:100},toggleCommandId:'intentsmith:toggleChat',toggleKeybinding:'ctrlcmd+shift+l'});}
  async initializeLayout(a){await this.openView({activate:true,reveal:true});}
  registerCommands(c){
    c.registerCommand({id:'intentsmith:toggleChat',label:'IntentSmith: Toggle Chat',category:'IntentSmith'},{
      execute:function(){
        if(typeof window._intentsmithIsRightHidden==='function'&&window._intentsmithIsRightHidden()){
          window._intentsmithSnapShowRight(_intentsmithLastRightW||280);
        }else{
          var n=document.getElementById('theia-right-content-panel');
          if(n)_intentsmithLastRightW=n.offsetWidth||420;
          window._intentsmithSnapHideRight();
        }
      }
    });
  }
  async onStart(a){try{await this.openView({activate:false,reveal:true});
    /* v130: Right panel resize moved to SidebarContrib.onStart (after ResizeObserver setup).
       Lock is set there too — no duplicate lock/resize needed here. */
  }catch(e){}}}
inversify_1.decorate(inversify_1.injectable(),IntentSmithChatContrib);

class IntentSmithAgentContrib extends browser_1.AbstractViewContribution {
  constructor(){super({widgetId:INTENTSMITH_AGENT_ID,widgetName:'Agent Log',defaultWidgetOptions:{area:'bottom',rank:100},toggleCommandId:'intentsmith:toggleAgent',toggleKeybinding:'ctrlcmd+shift+a'});}
  async initializeLayout(a){_syncWorkspacePanels();}
  async onStart(a){_syncWorkspacePanels();}}
inversify_1.decorate(inversify_1.injectable(),IntentSmithAgentContrib);

class IntentSmithStatusContrib {
  onStart(){this._c();}
  async _c(){try{var r=await fetch(_backendUrl()+'/health',{signal:AbortSignal.timeout(2000)});document.body.classList.toggle('intentsmith-backend-online',r.ok);}catch(e){document.body.classList.remove('intentsmith-backend-online');}}}
inversify_1.decorate(inversify_1.injectable(),IntentSmithStatusContrib);


/* ═══════════════════════════════════════════════════════════
   DI MODULE
   ═══════════════════════════════════════════════════════════ */
exports.default = new inversify_1.ContainerModule(function(bind){
  // Sidebar
  var _URI = require("@theia/core/lib/common/uri").default;
  bind(IntentSmithSidebarWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){
    // Keep both preview and manual editing inside the owning workspace.
    window._intentsmithOpenFileInEditor=function(filePath){_openFileTab(filePath);};
    window._intentsmithFileService=ctx.container.get(require('@theia/filesystem/lib/browser/file-service').FileService);
    return{id:INTENTSMITH_SIDEBAR_ID,createWidget:function(){return ctx.container.get(IntentSmithSidebarWidget);}};
  }).inSingletonScope();
  browser_1.bindViewContribution(bind,IntentSmithSidebarContrib);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithSidebarContrib);

  // Center view is mounted directly into DOM (no Theia widget needed)

  // Chat
  bind(IntentSmithChatWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){return{id:INTENTSMITH_CHAT_ID,createWidget:function(){return ctx.container.get(IntentSmithChatWidget);}};}).inSingletonScope();
  browser_1.bindViewContribution(bind,IntentSmithChatContrib);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithChatContrib);

  // Agent
  bind(IntentSmithAgentWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(function(ctx){return{id:INTENTSMITH_AGENT_ID,createWidget:function(){return ctx.container.get(IntentSmithAgentWidget);}};}).inSingletonScope();
  browser_1.bindViewContribution(bind,IntentSmithAgentContrib);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithAgentContrib);

  // Status
  bind(IntentSmithStatusContrib).toSelf();
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithStatusContrib);
});
