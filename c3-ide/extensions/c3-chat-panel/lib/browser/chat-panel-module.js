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
var h = React.createElement;

/* ═══ TRANSPORT MODULES ═══ */
try { require("./event-bus"); } catch(e) { console.warn('[C3] event-bus.js not loaded:', e.message); }
try { require("./ws-client"); } catch(e) { console.warn('[C3] ws-client.js not loaded:', e.message); }
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
/* Load Google Fonts at startup — base fonts for settings + pro theme fonts */
(function(){if(!document.getElementById('c3-base-fonts')){
  var lk=document.createElement('link');lk.id='c3-base-fonts';lk.rel='stylesheet';
  lk.href='https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Fira+Code:wght@400;500;600&display=swap';
  document.head.appendChild(lk);}})();
/* Glass background mappings for pro themes — used instead of solid hex for CSS vars */
var _PRO_GLASS={
  matrix:{bg0:'transparent',bg1:'rgba(2,4,16,0.90)',bg2:'rgba(4,8,24,0.88)',bg3:'rgba(6,16,32,0.85)',bg4:'rgba(10,20,40,0.82)',bg5:'rgba(14,26,50,0.80)'},
  japanese:{bg0:'transparent',bg1:'rgba(10,4,6,0.88)',bg2:'rgba(18,8,12,0.85)',bg3:'rgba(28,12,18,0.82)',bg4:'rgba(40,18,26,0.78)',bg5:'rgba(52,24,34,0.75)'},
  midnight:{bg0:'transparent',bg1:'rgba(6,10,24,0.78)',bg2:'rgba(10,16,38,0.75)',bg3:'rgba(16,24,52,0.72)',bg4:'rgba(22,32,66,0.68)',bg5:'rgba(28,40,80,0.65)'}
};
function _applyColorTheme(themeId){
  var t=_C_THEMES[themeId]||_C_DEFAULT;
  Object.keys(t).forEach(function(k){C[k]=t[k];});
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
  /* Load Google Fonts for pro themes */
  if(!document.getElementById('c3-pro-fonts')){
    var lk=document.createElement('link');lk.id='c3-pro-fonts';lk.rel='stylesheet';
    lk.href='https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;600;700&family=Zen+Kaku+Gothic+Antique:wght@300;400;500;700&family=Yuji+Boku&family=Inter:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(lk);
  }
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

var I={chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',expert:'<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',worker:'<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.18 1.65 1.65 0 0 0 4.27 6.36l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',chevDown:'<polyline points="6 9 12 15 18 9"/>',plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',split:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',close:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'};

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
var SETTINGS_SECTIONS=[{icon:'👤',title:'Account',desc:'Identita a profil'},{icon:'🤖',title:'LLM',desc:'Modely a inference'},{icon:'🧠',title:'Memory',desc:'Paměť a kontext'},{icon:'🔔',title:'Notifications',desc:'Upozornění'},{icon:'📄',title:'Output',desc:'Formátování výstupu'},{icon:'🎨',title:'Appearance',desc:'Vzhled a přizpůsobení'},{icon:'🖥️',title:'System',desc:'Systém a diagnostika'},{icon:'📦',title:'Storage',desc:'Data a úložiště'},{icon:'💾',title:'Backup',desc:'Zálohy a export'},{icon:'ℹ️',title:'About',desc:'O aplikaci'}];
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
var NAV=[{id:'chats',label:'Konverzace',icon:'chat',badge:0,recent:[]},{id:'projects',label:'Projekty',icon:'folder',badge:0,recent:[]},{id:'specialists',label:'Specialisté',icon:'users',badge:SPECIALISTS.length,recent:SPECIALISTS.slice(0,2).map(function(s){return s.name;})},{id:'expertises',label:'Expertyzy',icon:'expert',badge:EXPERTISES.length,recent:EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;})},{id:'workers',label:'Workeri',icon:'worker',badge:0,recent:[]}];

/* ═══ LIVE DATA FETCH ═══ */
var _backendBase='http://localhost:3335';
function fetchBackendData(){
  /* Projects — filter: must have path (real project, not conversation leak) */
  var projStatus=(_centerState.showArchivedProjects)?'all':'active';
  fetch(_backendBase+'/api/projects?limit=50&status='+projStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.projects||[]);
    items=items.filter(function(p){return p.path&&p.name;});
    if(items.length>0){PROJECTS=items.slice(0,20).map(function(p){return{id:p.id,emoji:'📁',name:_s(p.name||p.title)||'Projekt',path:p.path||null,status:_s(p.status)||'Active',created:_s(p.created_at||p.createdAt||p.created)||'',updated:_s(p.last_active||p.updatedAt||p.updated)||'',desc:_s(p.description)||'',tags:[]};});}
    else{PROJECTS=[];}
    if(typeof console!=='undefined')console.debug('[C3:fetchProjects]',PROJECTS.length,'items, raw:',items.length,'isArray:',Array.isArray(data),'keys:',data?Object.keys(data).join(','):'null');
    NAV[1].badge=PROJECTS.length;NAV[1].recent=PROJECTS.slice(0,3).map(function(p){return p.name;});renderCenter();
    /* v68: Sync working tree with active project after project data loads */
    var _as=_sessions[_sessionActive];
    if(_as&&_as._projectId){var _ap=PROJECTS.find(function(p){return p.id===_as._projectId;});
      if(_ap&&_ap.path&&_wtRoot!==_ap.path){_wtRoot=_ap.path;_loadWorkspaceTree(_ap.path);}}
  }).catch(function(){});
  /* Conversations */
  var convStatus=(_centerState.showArchived)?'all':'active';
  fetch(_backendBase+'/api/conversations?limit=50&status='+convStatus,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.conversations||[]);
    if(items.length>0){CONVERSATIONS=items.slice(0,20).map(function(c){return{id:c.id,title:_s(c.title||c.name)||'Chat',preview:_s(c.preview||c.lastMessage||c.summary)||'',time:_s(c.time||c.updated_at||c.updatedAt)||'',expertise:_s(c.expertise)||'Výchozí',status:_s(c.state||c.status)||'active'};});}
    else{CONVERSATIONS=[];}
    if(typeof console!=='undefined')console.debug('[C3:fetchConversations]',CONVERSATIONS.length,'items, raw:',items.length,'isArray:',Array.isArray(data),'keys:',data?Object.keys(data).join(','):'null');
    NAV[0].badge=CONVERSATIONS.length;NAV[0].recent=CONVERSATIONS.slice(0,3).map(function(c){return c.title;});renderCenter();
  }).catch(function(){});
  /* Expertises — separate specialists (is_specialist or is_builtin+tools) */
  fetch(_backendBase+'/api/expertises',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(data){
    var items=Array.isArray(data)?data:(data.expertises||[]);
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
      /* Rebuild specialists from expertises with is_specialist flag */
      SPECIALISTS=allEx.filter(function(e){return e.isSpecialist;}).map(function(e){
        return{id:e.id,emoji:e.emoji,name:e.name,desc:e.desc,domain:e.domain,
          tags:[e.domain,'Specialista'].filter(Boolean)};
      });
    }
    NAV[3].badge=EXPERTISES.length;NAV[3].recent=EXPERTISES.filter(function(e){return e.fav;}).slice(0,3).map(function(e){return e.name;});
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
    if(!this._root)this._root=_createRoot(this.node);
    this._root.render(h(SidebarApp,{getState:function(){return{active:self._active,dd:self._dd,collapsed:self._collapsed};},setState:function(s){if(s.active!==undefined)self._active=s.active;if(s.dd!==undefined)self._dd=s.dd;if(s.collapsed!==undefined){self._collapsed=s.collapsed;try{var app=window._c3App;if(app&&app.shell&&typeof app.shell.resize==='function'){_c3SnapLock=true;app.shell.resize(s.collapsed?48:240,'left');setTimeout(function(){_c3SnapLock=false;},600);}}catch(ex){}}self._render();}}));
  }
}
inversify_1.decorate(inversify_1.injectable(),C3SidebarWidget);
var _sidebarWidget=null;function renderSidebar(){if(_sidebarWidget)_sidebarWidget._render();}

function SidebarApp(props){
  var s=props.getState(),set=props.setState;
  /* ── Collapsed icon-only mode ── */
  if(s.collapsed){
    return h('div',{style:{display:'flex',flexDirection:'column',width:48,maxWidth:48,position:'absolute',top:0,left:0,bottom:0,background:C.bg1,fontFamily:C.font,borderRight:'1px solid '+C.border,overflow:'hidden',alignItems:'center',paddingTop:6}},
      h('div',{style:{cursor:'pointer',width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,color:C.tx3,marginBottom:2},title:'Rozbalit (Ctrl+B)',
        onMouseEnter:function(e){e.currentTarget.style.background=C.bg3;},onMouseLeave:function(e){e.currentTarget.style.background='transparent';},
        onClick:function(){set({collapsed:false});}},svgEl('<polyline points="9 18 15 12 9 6"/>',18)),
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
      h('div',{style:{height:1,background:C.border,margin:'6px 12px'}}),
      h('div',{style:{display:'flex',alignItems:'center',padding:'6px 10px 2px'}},
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
            onClick:function(){_wtNewInput={type:'dir',parent:null};renderSidebar();}},'📁'))),
      /* Workspace root path indicator */
      _wtRoot?h('div',{style:{padding:'2px 10px 4px',fontSize:_fs(9),color:C.tx4,fontFamily:C.mono,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},title:_wtRoot},
        _wtRoot.split('/').slice(-2).join('/')):
      h('div',{style:{padding:'4px 10px'},onClick:function(){
        /* Native directory picker (Electron doesn't support prompt()) */
        try{var inp=document.createElement('input');inp.type='file';inp.webkitdirectory=true;
          inp.addEventListener('change',function(){if(inp.files&&inp.files.length>0){var fp=(inp.files[0].path||'').replace(/\\/g,'/').split('/');var dir=fp.slice(0,-1).join('/');if(dir){_wtRoot=dir;_loadWorkspaceTree(dir);}}});
          inp.click();}catch(e){}
      }},h('div',{style:{padding:'6px 10px',borderRadius:6,border:'1px dashed '+C.border2,cursor:'pointer',textAlign:'center',fontSize:_fs(11),color:C.tx3}},
        'Otevřít složku')),
      /* New file/dir inline input */
      _wtNewInput?h('div',{style:{display:'flex',alignItems:'center',gap:4,padding:'2px 8px'}},
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
      _wtLoading?h('div',{style:{padding:'8px 10px',textAlign:'center',fontSize:_fs(10),color:C.tx4}},'Načítám...'):
      /* File tree */
      (function(){
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
      })(),
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
var _centerState={view:'expertises',detail:null,detailConversations:null,openSections:{},zoom:1,listView:false,settingsSection:null};
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
/* ═══ Wizard navigation guard ═══ */
function _wizardGuardNav(targetView,sidebarSet,extra){
  var label=_projectWizard.active?'vytváření projektu':_expertiseWizard.active?'editaci expertýzy':_agentWizard.active?'vytváření workeru':null;
  var det={view:targetView};if(extra)for(var k in extra)det[k]=extra[k];
  if(!label){sidebarSet({active:targetView,dd:{}});window.dispatchEvent(new CustomEvent('c3-nav',{detail:det}));return;}
  if(!confirm('Opravdu chcete ukončit '+label+'? Neuložené změny budou ztraceny.'))return;
  _projectWizard.active=false;_projectWizard.saving=false;
  _expertiseWizard.active=false;_agentWizard.active=false;
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
  var view=_centerState.view,detail=_centerState.detail;
  var isOverlay=_expertiseWizard.active||_agentWizard.active||_projectWizard.active||_editorState.active;
  var mainContent=isOverlay?(
    _expertiseWizard.active?centerExpertiseWizard():
    _agentWizard.active?centerAgentWizard():
    _projectWizard.active?centerProjectWizard():
    centerEditor()
  ):(
    view==='expertises'?centerExpertises():view==='projects'?centerProjects():view==='chats'?centerConvos():
    view==='specialists'?centerSpecs():view==='workers'?centerWorkers():view==='settings'?centerSettings():centerWelcome()
  );
  var showDetail=detail&&!isOverlay;
  return h('div',{style:{display:'flex',height:'100%',width:'100%',background:C.bg0,fontFamily:C.font,overflow:'hidden',position:'absolute',top:0,left:0,right:0,bottom:0}},
    h('div',{key:'cv-'+(isOverlay?'overlay':view),style:{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}},mainContent),
    showDetail?h('div',{style:{width:'45%',maxWidth:480,minWidth:280,borderLeft:'1px solid '+C.border,display:'flex',flexDirection:'column',overflow:'hidden',background:C.bg1,flexShrink:0}},centerDetail()):null);
}

function viewHead(t,showZoom,onAdd){
  return h('div',{style:{padding:'12px 18px',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',flexShrink:0}},
    h('span',{style:{fontSize:_fs(15),fontWeight:700,color:C.tx1,flex:1}},t),
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
  /* ═══ LIST VIEW ═══ */
  if(_centerState.listView){
    var listS={display:'flex',alignItems:'center',gap:10,padding:'8px 16px',cursor:'pointer',transition:'background 0.15s',position:'relative'};
    if(isLines){listS.borderBottom='1px solid '+C.border;listS.background=sel?'rgba(34,197,94,0.05)':'transparent';}
    else{listS.background=sel?'rgba(34,197,94,0.06)':C.bg2;listS.border='1px solid '+(sel?C.accent:C.border);listS.borderRadius=8;listS.marginBottom=4;}
    return h('div',{key:item.name,onClick:onClick,style:listS,
      onMouseEnter:function(e){if(!sel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':'rgba(255,255,255,0.04)';},
      onMouseLeave:function(e){if(!sel)e.currentTarget.style.background=isLines?'transparent':(sel?'rgba(34,197,94,0.06)':C.bg2);}},
      isLines&&sel?h('div',{style:{position:'absolute',left:0,top:0,bottom:0,width:3,background:C.accent,borderRadius:'0 2px 2px 0'}}):null,
      item.emoji?h('span',{style:{fontSize:_fs(16),flexShrink:0,width:24,textAlign:'center'}},item.emoji):null,
      h('div',{style:Object.assign({fontSize:_fs(12),fontWeight:600,color:sel?C.accentText:C.tx1,width:130,flexShrink:0},ell)},item.name),
      h('div',{style:Object.assign({flex:1,fontSize:_fs(11),color:C.tx3,minWidth:0},ell)},item.desc||''),
      item.status?pill(item.status):null,
      item.fav!==undefined?h('span',{style:{fontSize:_fs(14),color:item.fav?C.accentText:C.tx4,cursor:'pointer',padding:'0 2px',userSelect:'none',flexShrink:0},onClick:_favClick(item)},item.fav?'★':'☆'):null);
  }
  /* ═══ Shared grid card body — emoji+name header, desc, status ═══ */
  var body=[
    h('div',{key:'h',style:{display:'flex',alignItems:'center',gap:10,marginBottom:item.desc||item.status?6:0}},
      item.emoji?h('span',{style:{fontSize:_fs(22)}},item.emoji):null,
      h('div',{style:Object.assign({flex:1,fontSize:_fs(13),fontWeight:700,color:C.tx1,minWidth:0},ell)},item.name),
      item.fav!==undefined?h('span',{style:{fontSize:_fs(14),color:item.fav?C.accentText:C.tx4,cursor:'pointer',userSelect:'none'},onClick:_favClick(item)},item.fav?'★':'☆'):null),
    item.desc?h('div',{key:'d',style:Object.assign({fontSize:_fs(11),color:C.tx3,lineHeight:'1.4',marginBottom:item.status?6:0},ell)},item.desc):null,
    item.status?h('div',{key:'s'},pill(item.status)):null
  ];
  /* ═══ GRID — lines mode (no bg, separator borders, hover highlight) ═══ */
  if(isLines){
    return h('div',{key:item.name,onClick:onClick,
      style:{padding:14,cursor:'pointer',borderBottom:'1px solid '+C.border,borderRight:'1px solid '+C.border,
        background:sel?'rgba(34,197,94,0.05)':'transparent',transition:'background 0.15s'},
      onMouseEnter:function(e){if(!sel)e.currentTarget.style.background='rgba(255,255,255,0.025)';},
      onMouseLeave:function(e){e.currentTarget.style.background=sel?'rgba(34,197,94,0.05)':'transparent';}},
      body);
  }
  /* ═══ GRID — borders mode (card with bg, border, radius) ═══ */
  return h('div',{key:item.name,className:'c3-card',onClick:onClick,
    style:{background:C.bg2,border:'1px solid '+(sel?C.accent:C.border),borderRadius:12,padding:16,
      cursor:'pointer',position:'relative',overflow:'hidden',
      transition:'border-color 0.2s,box-shadow 0.2s',
      boxShadow:sel?'0 0 0 1px '+C.accent:'none'},
    onMouseEnter:function(e){if(!sel){e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';}},
    onMouseLeave:function(e){if(!sel){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow='none';}}},
    body);
}

function pill(s){var st=_s(s);var m={Active:{b:'rgba(34,197,94,0.1)',c:C.accentText},Done:{b:C.blueBg,c:C.blue},WIP:{b:C.amberBg,c:C.amber},Running:{b:'rgba(34,197,94,0.1)',c:C.accentText},Paused:{b:C.amberBg,c:C.amber}};var v=m[st]||{b:C.bg4,c:C.tx3};return h('span',{style:{display:'inline-flex',padding:'2px 7px',borderRadius:10,fontSize:_fs(9),fontWeight:600,textTransform:'uppercase',letterSpacing:'0.3px',fontFamily:C.mono,background:v.b,color:v.c}},st);}

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
    var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
    fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Nová konverzace',expertise:'Výchozí'}),signal:AbortSignal.timeout(5000)})
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
  var tpl={
    specialists:{name:'Nový specialista',fields:[{k:'Oblast',v:''}],tags:[],actions:['Uložit','Zrušit'],editing:true,_isNew:true}};
  setDetail(tpl[view]||tpl.specialists);
}

function centerExpertises(){return h(React.Fragment,null,viewHead('Expertyzy',true,function(){_addNew('expertises');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(EXPERTISES.map(function(e){var tags=[e.isSpecialist?'Specialista':'Expertyza'];if(e.domain)tags.push(e.domain);return card(e,function(){setDetail({name:e.name,fields:[{k:'Typ',v:e.desc},{k:'Doména',v:e.domain||'general'},{k:'Emoji',v:e.emoji},{k:'Specialista',v:e.isSpecialist?'Ano':'Ne'},{k:'Oblíbený',v:e.fav,type:'fav',_expertiseName:e.name}],tags:tags,actions:['Otevřít','Editovat']});});}))));}

function centerProjects(){
  var showArchived=_centerState.showArchivedProjects||false;
  /* v82: Defensive guard — only render items with emoji 📁 (projects). Log any contamination. */
  var _contaminated=PROJECTS.filter(function(p){return p.emoji!=='📁';});
  if(_contaminated.length>0&&typeof console!=='undefined'){console.warn('[C3:centerProjects] CONTAMINATION:',_contaminated.length,'non-project items in PROJECTS!',_contaminated.map(function(p){return p.name+'('+p.emoji+')';}));}
  var filtered=PROJECTS.filter(function(p){return p.emoji==='📁'&&(showArchived?true:p.status!=='archived'&&p.status!=='Archived');});
  return h(React.Fragment,null,viewHead('Projekty',true,function(){_addNew('projects');}),
    h('div',{style:{padding:'4px 18px 0',display:'flex',gap:6}},
      h('button',{style:{background:!showArchived?C.bg4:'transparent',color:!showArchived?C.tx1:C.tx4,border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer'},
        onClick:function(){_centerState.showArchivedProjects=false;fetchBackendData();renderCenter();}},'Aktivní'),
      h('button',{style:{background:showArchived?C.bg4:'transparent',color:showArchived?C.tx1:C.tx4,border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer'},
        onClick:function(){_centerState.showArchivedProjects=true;fetchBackendData();renderCenter();}},'Vše + archiv')),
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(filtered.map(function(p){
      var isArchived=p.status==='archived'||p.status==='Archived';
      var actions=isArchived?['Otevřít','Obnovit','Smazat']:['Otevřít','Editovat','Archivovat'];
      return card(p,function(){setDetail({name:p.name,_itemId:p.id,fields:[{k:'Status',v:p.status||'active',a:!isArchived},{k:'Cesta',v:p.path||''},{k:'Popis',v:p.desc||''},{k:'Vytvořeno',v:p.created},{k:'Aktualizováno',v:p.updated}],tags:p.tags,actions:actions});});
    }))));
}

function centerConvos(){
  var showArchived=_centerState.showArchived||false;
  var filtered=CONVERSATIONS.filter(function(c){return showArchived?true:c.status!=='archived';});
  return h(React.Fragment,null,
    viewHead('Konverzace',true,function(){_addNew('chats');}),
    /* Archived filter bar */
    h('div',{style:{padding:'4px 18px 0',display:'flex',gap:6}},
      h('button',{style:{background:!showArchived?C.bg4:'transparent',color:!showArchived?C.tx1:C.tx4,border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer'},
        onClick:function(){_centerState.showArchived=false;fetchBackendData();renderCenter();}},'Aktivní'),
      h('button',{style:{background:showArchived?C.bg4:'transparent',color:showArchived?C.tx1:C.tx4,border:'none',borderRadius:4,padding:'3px 10px',fontSize:_fs(10),fontWeight:600,cursor:'pointer'},
        onClick:function(){_centerState.showArchived=true;fetchBackendData();renderCenter();}},'Vše + archiv')),
    h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(filtered.map(function(c){
      var isArchived=c.status==='archived';
      var actions=isArchived?['Otevřít','Obnovit','Smazat']:['Otevřít','Přidat do projektu','Archivovat'];
      return card({name:c.title,emoji:'💬',desc:c.preview||c.expertise||'',status:isArchived?'Archived':null,_convData:c},
        function(){setDetail({name:c.title,fields:[{k:'Expertyza',v:c.expertise},{k:'Čas',v:c.time},{k:'Status',v:c.status||'active'}],tags:['Chat',c.expertise],actions:actions});});
    }))));
}

function centerSpecs(){return h(React.Fragment,null,viewHead('Specialisté',true,function(){_addNew('specialists');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(SPECIALISTS.map(function(s){return card(s,function(){setDetail({name:s.name,fields:[{k:'Oblast',v:s.desc}],tags:s.tags,actions:['Otevřít','Editovat']});});}))));}

function centerWorkers(){return h(React.Fragment,null,viewHead('Workeri',true,function(){_addNew('workers');}),h('div',{style:{flex:1,overflowY:'auto',padding:18}},grid(WORKERS.map(function(w){return card({name:w.name,emoji:'⚙️',desc:w.desc,status:w.status},function(){setDetail({name:w.name,fields:[{k:'Status',v:w.status,a:w.status==='Running'},{k:'Cron',v:w.cron},{k:'Poslední běh',v:w.lastRun},{k:'Popis',v:w.desc}],tags:['Worker',w.status],actions:['Spustit','Pozastavit','Editovat']});});}))));}

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
  /* v82: Check if another project is already open — ask user */
  var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
  var currentProj=_sessions[_ti]._projectId;
  if(currentProj){
    var curP=PROJECTS.find(function(p){return p.id===currentProj;});
    var curName=curP?curP.name:'projekt';
    if(!confirm('Projekt "'+curName+'" je právě otevřený.\n\nChcete ho nahradit novým projektem z:\n'+folderPath+'?'))return;
  }
  _projectWizard.saving=true;renderCenter();
  fetch(_backendBase+'/api/projects/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({folderPath:folderPath}),signal:AbortSignal.timeout(15000)})
  .then(function(r){if(!r.ok)return r.json().then(function(e){throw new Error((e.error||'Server error '+r.status)+(e.details?' ['+e.details+']':''));});return r.json();})
  .then(function(res){
    _projectWizard.active=false;_projectWizard.saving=false;_wizardRestoreLayout();
    var proj=res.project;
    var realPath=(proj&&proj.path)||folderPath;
    var projName=(proj&&proj.name)||folderPath.split('/').filter(Boolean).pop()||'Projekt';
    /* Open working tree */
    _wtRoot=realPath;_loadWorkspaceTree(realPath);
    /* Link to current session */
    var _ts=_sessions[_ti];
    if(proj&&proj.id){
      _ts._projectId=proj.id;
      /* Reset session for new project context */
      _ts._convId=null;_ts._agentId=null;_ts._lifecycleResumed=false;
      _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
      _ts.chat.ctx=0;
      /* Create conversation for the project */
      fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({project_id:proj.id,title:projName}),signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();}).then(function(cd){
        var conv=cd.conversation||cd;
        if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
      }).catch(function(){});
      _persistSessionState();
    }
    /* Log to agent panel + chat */
    if(window._c3){
      window._c3.agentLog('TOOL','📂 Projekt otevřen: '+projName);
      window._c3.agentLog('TOOL','📍 '+realPath);
      if(res.metadata&&res.metadata.bootstrapped)window._c3.agentLog('TOOL','🔧 Metadata bootstrapped (.c3-architect)');
      if(res.status==='already_registered')window._c3.agentLog('TOOL','ℹ️ Projekt byl již registrován');
    }
    /* Switch view to chat so user sees the project linked */
    _centerState.view='chats';_centerState.detail=null;
    fetchBackendData();renderCenter();renderChat();
  }).catch(function(err){
    _projectWizard.saving=false;_projectWizard.active=false;_wizardRestoreLayout();
    if(window._c3)window._c3.agentLog('TOOL','❌ Chyba při otevírání: '+(err.message||err));
    fetchBackendData();renderCenter();
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
    if(window._c3)window._c3.agentLog('TOOL','✨ Projekt vytvořen: '+projName+' → '+realPath);
    /* Link to session + open working tree */
    var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
    if(_ti!==_sessionActive)_saveTreeState(_sessionActive);
    _sessionActive=_ti;_ensureSessions();var _ts=_sessions[_ti];
    var projId=created.id||(created.project&&created.project.id);
    if(projId){_ts._projectId=projId;_persistSessionState();}
    if(realPath){_wtRoot=realPath;_loadWorkspaceTree(realPath);}
    /* Reset session for new project */
    _ts._lifecycleResumed=false;
    _ts.log=[];_ts.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
    _ts.chat.msgs=[{role:'system',text:'Projekt: '+projName}];
    /* Create conversation for the project */
    if(projId){
      fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({project_id:projId,title:projName}),signal:AbortSignal.timeout(5000)})
      .then(function(r){return r.json();}).then(function(cd){
        var conv=cd.conversation||cd;
        if(conv&&conv.id){_ts._convId=conv.id;_persistSessionState();renderChat();}
      }).catch(function(){});
    }
    /* Activate lifecycle on backend */
    var lcSessionId=_ts._agentId||_ts._convId||('session-'+_ti);
    fetch(_backendBase+'/api/projects/lifecycle/start',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({projectId:projId,projectPath:realPath,projectName:projName,description:d.description.trim(),type:d.type,sessionId:lcSessionId}),
      signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(lc){
      if(window._c3)window._c3.agentLog('TOOL','🔄 Lifecycle aktivován: '+((lc&&lc.phase)||'SPEC'));
    }).catch(function(e){
      if(window._c3)window._c3.agentLog('TOOL','⚠️ Lifecycle start: '+(e.message||e));
    });
    /* Log to agent panel */
    var scaff=created.scaffold?created.scaffold.join(', '):'';
    if(window._c3){
      window._c3.agentLog('TOOL','📁 Projekt '+projName+' vytvořen ('+d.type+') → '+realPath);
      if(scaff)window._c3.agentLog('TOOL','🔧 Scaffolding: '+scaff);
      window._c3.agentLog('TOOL','🔄 Lifecycle: SPEC — popište specifikaci v chatu');
    }
    fetchBackendData();renderCenter();renderChat();
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
    if(window._c3)window._c3.agentLog('TOOL','✨ Expertyza '+(method==='PUT'?'upravena':'vytvořena')+': '+d.name);
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
  if(!d||!s||(d.sources||[]).length>=s.limits.max_sources)return;
  var idx=(d.sources||[]).length+1;
  d.sources.push({id:'src-'+idx,type:'http',config:{url:''}});renderCenter();
}
function _awRemoveSource(i){var d=_agentWizard.data;if(d.sources.length>1)d.sources.splice(i,1);renderCenter();}
function _awAddCondition(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  if(!d||!s||(d.conditions||[]).length>=s.limits.max_conditions)return;
  var idx=(d.conditions||[]).length+1;
  var srcId=(d.sources&&d.sources[0])?d.sources[0].id:'src-1';
  d.conditions.push({id:'cond-'+idx,type:'exists',field:'sources.'+srcId+'.data'});renderCenter();
}
function _awRemoveCondition(i){var d=_agentWizard.data;if(d.conditions.length>1)d.conditions.splice(i,1);renderCenter();}
function _awAddTrigger(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  if(!d||!s||(d.triggers||[]).length>=s.limits.max_triggers)return;
  var idx=(d.triggers||[]).length+1;
  var condId=(d.conditions&&d.conditions[0])?d.conditions[0].id:'cond-1';
  d.triggers.push({id:'trig-'+idx,condition_id:condId,edge:'rising',cooldown:300,max_fires_per_day:10});renderCenter();
}
function _awRemoveTrigger(i){var d=_agentWizard.data;if(d.triggers.length>1)d.triggers.splice(i,1);renderCenter();}
function _awAddAction(){
  var d=_agentWizard.data,s=_agentWizard.schema;
  if(!d||!s||(d.actions||[]).length>=s.limits.max_actions)return;
  var trigId=(d.triggers&&d.triggers[0])?d.triggers[0].id:'trig-1';
  d.actions.push({type:'notify',trigger_id:trigId,config:{channel:'push',title:'',message:'',priority:'normal'}});renderCenter();
}
function _awRemoveAction(i){var d=_agentWizard.data;if(d.actions.length>1)d.actions.splice(i,1);renderCenter();}
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
      els.push(h('div',{key:'pv',style:{marginTop:12,padding:10,borderRadius:8,border:'1px solid '+(pv.valid===false?'#e55':'#4a4'),background:pv.valid===false?'#e5510a':'#4a410a'}},
        h('div',{style:{fontWeight:600,fontSize:_fs(12),color:pv.valid===false?'#f88':'#8f8',marginBottom:4}},pv.valid===false?'Validace selhala':'Validace OK'),
        (pv.errors||[]).map(function(e,i){return h('div',{key:'e'+i,style:{fontSize:_fs(11),color:'#f88'}},e);}),
        (pv.warnings||[]).map(function(w2,i){return h('div',{key:'w'+i,style:{fontSize:_fs(11),color:'#fa0'}},w2);})));}
    if(w.testError&&!w.preview){els.push(h('div',{key:'te',style:{marginTop:12,padding:8,borderRadius:6,background:'#e5510a',fontSize:_fs(11),color:'#f88'}},w.testError));}
    return els.length?h('div',null,els):null;
  }
  function awSourceRow(src,si,srcTypes,canRemove){
    return h('div',{key:'s'+si,style:{display:'flex',gap:6,marginBottom:6,alignItems:'center'}},
      h('select',{style:Object.assign({},inputS2,{width:100,flex:'none'}),value:src.type,onChange:function(e){src.type=e.target.value;renderCenter();}},
        srcTypes.map(function(st){return h('option',{key:st,value:st},st);})),
      h('input',{style:Object.assign({},inputS2,{flex:1}),value:(src.config&&src.config.url)||'',placeholder:'URL / zdroj',
        onChange:function(e){if(!src.config)src.config={};src.config.url=e.target.value;renderCenter();}}),
      canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14)},onClick:function(){_awRemoveSource(si);}},'✕'):null);
  }
  function awCondRow(cond,ci,condTypes,ops,canRemove){
    return h('div',{key:'c'+ci,style:{display:'flex',gap:4,marginBottom:6,alignItems:'center',flexWrap:'wrap'}},
      h('select',{style:Object.assign({},inputS2,{width:100,flex:'none'}),value:cond.type,onChange:function(e){cond.type=e.target.value;renderCenter();}},
        condTypes.map(function(ct){return h('option',{key:ct,value:ct},ct);})),
      h('input',{style:Object.assign({},inputS2,{flex:1,minWidth:120}),value:cond.field||'',placeholder:'sources.src-1.data',
        onChange:function(e){cond.field=e.target.value;renderCenter();}}),
      (cond.type==='compare'||cond.type==='date_diff'||cond.type==='in_range')?
        h('select',{style:Object.assign({},inputS2,{width:55,flex:'none'}),value:cond.operator||'>',onChange:function(e){cond.operator=e.target.value;renderCenter();}},
          ops.map(function(op){return h('option',{key:op,value:op},op);})):null,
      (cond.type!=='exists'&&cond.type!=='new_items'&&cond.type!=='changed')?
        h('input',{style:Object.assign({},inputS2,{width:80,flex:'none'}),value:cond.value!==undefined?cond.value:'',placeholder:'hodnota',
          onChange:function(e){cond.value=e.target.value;renderCenter();}}):null,
      canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14)},onClick:function(){_awRemoveCondition(ci);}},'✕'):null);
  }
  function awActRow(act,ai,actTypes,canRemove){
    return h('div',{key:'a'+ai,style:{background:C.bg2,borderRadius:6,padding:8,marginBottom:6}},
      h('div',{style:{display:'flex',gap:6,marginBottom:4}},
        h('select',{style:Object.assign({},inputS2,{width:100,flex:'none'}),value:act.type,onChange:function(e){act.type=e.target.value;if(!act.config)act.config={};renderCenter();}},
          actTypes.map(function(at){return h('option',{key:at,value:at},at);})),
        canRemove?h('span',{style:{cursor:'pointer',color:C.tx4,fontSize:_fs(14),marginLeft:'auto'},onClick:function(){_awRemoveAction(ai);}},'✕'):null),
      act.type==='notify'?h('div',null,
        h('input',{style:Object.assign({},inputS2,{marginBottom:4}),value:(act.config&&act.config.title)||'',placeholder:'Titulek notifikace',
          onChange:function(e){if(!act.config)act.config={};act.config.title=e.target.value;renderCenter();}}),
        h('input',{style:inputS2,value:(act.config&&act.config.message)||'',placeholder:'Zprava',
          onChange:function(e){if(!act.config)act.config={};act.config.message=e.target.value;renderCenter();}})):null,
      act.type==='store'?h('input',{style:inputS2,value:(act.config&&act.config.key)||'',placeholder:'Klic pro ulozeni',
        onChange:function(e){if(!act.config)act.config={};act.config.key=e.target.value;renderCenter();}}):null,
      act.type==='webhook'?h('input',{style:inputS2,value:(act.config&&act.config.url)||'',placeholder:'https://...',
        onChange:function(e){if(!act.config)act.config={};act.config.url=e.target.value;renderCenter();}}):null);
  }
  var schedTypes=(schema&&schema.allowed?schema.allowed.schedule_types:['cron','interval','manual'])||[];
  var intervals=(schema&&schema.allowed?schema.allowed.intervals:['1h'])||[];
  var srcTypes=(schema&&schema.allowed?schema.allowed.source_types:['http'])||[];
  var condTypes=(schema&&schema.allowed?schema.allowed.condition_types:['exists'])||[];
  var ops=(schema&&schema.allowed?schema.allowed.operators:['=='])||[];
  var actTypes=(schema&&schema.allowed?schema.allowed.action_types:['notify'])||[];
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
        h('input',{style:inputS2,value:d.schedule.value||'',placeholder:'0 8 * * * (min hour day month weekday)',onChange:function(e){d.schedule.value=e.target.value;renderCenter();}}),
        h('div',{style:{display:'flex',gap:4,marginTop:4}},['0 8 * * *','0 */6 * * *','0 9 * * 1','0 7,18 * * *'].map(function(cr){
          return h('span',{key:cr,style:smallBtn2,onClick:function(){d.schedule.value=cr;renderCenter();}},cr);
        }))):null,
      d.schedule&&d.schedule.type==='interval'?h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}},intervals.map(function(iv){
        return h('span',{key:iv,style:chipS2(d.schedule.value===iv),onClick:function(){d.schedule.value=iv;renderCenter();}},iv);
      })):null,
      d.schedule&&d.schedule.type==='manual'?h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:8}},'Agent bezi jen pri manualnim spusteni'):null,
      h('div',{style:Object.assign({},labelS2,{marginTop:12})},'Zdroje dat'),
      (d.sources||[]).map(function(src,si){return awSourceRow(src,si,srcTypes,(d.sources||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddSource},'+ Pridat zdroj'));
    var step3=h('div',null,
      h('div',{style:labelS2},'Podminky'),
      (d.conditions||[]).map(function(cond,ci){return awCondRow(cond,ci,condTypes,ops,(d.conditions||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddCondition},'+ Pridat podminku'),
      h('div',{style:Object.assign({},labelS2,{marginTop:12})},'Akce'),
      (d.actions||[]).map(function(act,ai){return awActRow(act,ai,actTypes,(d.actions||[]).length>1);}),
      h('span',{style:smallBtn2,onClick:_awAddAction},'+ Pridat akci'),
      h('div',{style:{display:'flex',gap:8,marginTop:12}},
        h('span',{style:smallBtn2,onClick:_awDryRun},w.testLoading?'Validuji...':'Dry-run preview'),
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
    d.schedule&&d.schedule.type==='cron'?h('input',{style:Object.assign({},inputS2,{marginBottom:8}),value:d.schedule.value||'',placeholder:'cron expression',onChange:function(e){d.schedule.value=e.target.value;renderCenter();}}):null,
    d.schedule&&d.schedule.type==='interval'?h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}},intervals.map(function(iv){
      return h('span',{key:iv,style:chipS2(d.schedule.value===iv),onClick:function(){d.schedule.value=iv;renderCenter();}},iv);
    })):null,
    h('div',{style:Object.assign({},labelS2,{marginTop:8})},'Zdroje'),
    (d.sources||[]).map(function(src,si){
      return h('div',{key:'as'+si,style:{display:'flex',gap:4,marginBottom:4,alignItems:'center'}},
        h('span',{style:{fontSize:_fs(10),color:C.tx4,width:40}},src.id),
        h('select',{style:Object.assign({},inputS2,{width:90,flex:'none'}),value:src.type,onChange:function(e){src.type=e.target.value;renderCenter();}},
          srcTypes.map(function(st){return h('option',{key:st,value:st},st);})),
        h('input',{style:Object.assign({},inputS2,{flex:1}),value:(src.config&&src.config.url)||'',placeholder:'URL',
          onChange:function(e){if(!src.config)src.config={};src.config.url=e.target.value;renderCenter();}}),
        (d.sources||[]).length>1?h('span',{style:{cursor:'pointer',color:C.tx4},onClick:function(){_awRemoveSource(si);}},'✕'):null);
    }),
    h('span',{style:smallBtn2,onClick:_awAddSource},'+ Zdroj'));
  var condTrigContent=h('div',null,
    h('div',{style:labelS2},'Podminky'),
    (d.conditions||[]).map(function(cond,ci){
      return h('div',{key:'ac'+ci,style:{display:'flex',gap:4,marginBottom:4,alignItems:'center',flexWrap:'wrap'}},
        h('span',{style:{fontSize:_fs(10),color:C.tx4,width:45}},cond.id),
        h('select',{style:Object.assign({},inputS2,{width:90,flex:'none'}),value:cond.type,onChange:function(e){cond.type=e.target.value;renderCenter();}},
          condTypes.map(function(ct){return h('option',{key:ct,value:ct},ct);})),
        h('input',{style:Object.assign({},inputS2,{flex:1,minWidth:100}),value:cond.field||'',placeholder:'field path',
          onChange:function(e){cond.field=e.target.value;renderCenter();}}),
        (cond.type==='compare'||cond.type==='date_diff'||cond.type==='in_range')?
          h('select',{style:Object.assign({},inputS2,{width:50,flex:'none'}),value:cond.operator||'>',onChange:function(e){cond.operator=e.target.value;renderCenter();}},
            ops.map(function(op){return h('option',{key:op,value:op},op);})):null,
        (cond.type!=='exists'&&cond.type!=='new_items'&&cond.type!=='changed')?
          h('input',{style:Object.assign({},inputS2,{width:70,flex:'none'}),value:cond.value!==undefined?cond.value:'',placeholder:'val',
            onChange:function(e){cond.value=e.target.value;renderCenter();}}):null,
        (d.conditions||[]).length>1?h('span',{style:{cursor:'pointer',color:C.tx4},onClick:function(){_awRemoveCondition(ci);}},'✕'):null);
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
      return h('div',{key:'aa'+ai,style:{background:C.bg1,borderRadius:6,padding:6,marginBottom:4}},
        h('div',{style:{display:'flex',gap:4,marginBottom:4}},
          h('select',{style:Object.assign({},inputS2,{width:90,flex:'none'}),value:act.type,onChange:function(e){act.type=e.target.value;if(!act.config)act.config={};renderCenter();}},
            actTypes.map(function(at){return h('option',{key:at,value:at},at);})),
          h('select',{style:Object.assign({},inputS2,{width:70,flex:'none'}),value:act.trigger_id||'',onChange:function(e){act.trigger_id=e.target.value;renderCenter();}},
            h('option',{value:''},'(all)'),
            (d.triggers||[]).map(function(t){return h('option',{key:t.id,value:t.id},t.id);})),
          (d.actions||[]).length>1?h('span',{style:{cursor:'pointer',color:C.tx4,marginLeft:'auto'},onClick:function(){_awRemoveAction(ai);}},'✕'):null),
        act.type==='notify'?h('div',{style:{display:'flex',gap:4}},
          h('input',{style:Object.assign({},inputS2,{flex:1}),value:(act.config&&act.config.title)||'',placeholder:'Titulek',
            onChange:function(e){if(!act.config)act.config={};act.config.title=e.target.value;renderCenter();}}),
          h('input',{style:Object.assign({},inputS2,{flex:2}),value:(act.config&&act.config.message)||'',placeholder:'Zprava',
            onChange:function(e){if(!act.config)act.config={};act.config.message=e.target.value;renderCenter();}})):null,
        act.type==='store'?h('input',{style:inputS2,value:(act.config&&act.config.key)||'',placeholder:'storage key',
          onChange:function(e){if(!act.config)act.config={};act.config.key=e.target.value;renderCenter();}}):null,
        act.type==='webhook'?h('input',{style:inputS2,value:(act.config&&act.config.url)||'',placeholder:'https://...',
          onChange:function(e){if(!act.config)act.config={};act.config.url=e.target.value;renderCenter();}}):null);
    }),
    h('span',{style:smallBtn2,onClick:_awAddAction},'+ Akce'));
  var previewContent=h('div',null,
    h('div',{style:{display:'flex',gap:8,marginBottom:8}},
      h('button',{style:btnS2(false,w.testLoading),onClick:_awDryRun},w.testLoading?'Validuji...':'Dry-run'),
      w.editId?h('button',{style:btnS2(false,w.testLoading),onClick:_awTestRun},'Test run'):null),
    w.preview?h('div',{style:{padding:8,borderRadius:6,border:'1px solid '+(w.preview.valid===false?'#e55':'#4a4'),background:w.preview.valid===false?'#e5510a':'#4a410a',marginBottom:8}},
      h('div',{style:{fontWeight:600,fontSize:_fs(11),color:w.preview.valid===false?'#f88':'#8f8',marginBottom:4}},w.preview.valid===false?'Validace selhala':'Validace OK'),
      (w.preview.errors||[]).map(function(e,i){return h('div',{key:'pe'+i,style:{fontSize:_fs(10),color:'#f88'}},e);}),
      (w.preview.warnings||[]).map(function(w2,i){return h('div',{key:'pw'+i,style:{fontSize:_fs(10),color:'#fa0'}},w2);})):null,
    w.testResult?h('div',{style:{padding:8,borderRadius:6,background:C.bg1,fontSize:_fs(11),color:C.tx2}},
      h('pre',{style:{whiteSpace:'pre-wrap',margin:0,fontFamily:C.mono,fontSize:_fs(10)}},JSON.stringify(w.testResult,null,2))):null,
    w.testError&&!w.preview?h('div',{style:{padding:8,borderRadius:6,background:'#e5510a',fontSize:_fs(11),color:'#f88'}},w.testError):null);
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
var _settingsVals={theme:'dark',accentIdx:0,activeInt:100,passiveInt:50,fontSizeVal:13,fontIdx:0,custom1:null,custom2:null,bgIdx:0,bgCustom1:null,bgCustom2:null,customCSS:'',visualMode:'borders',tileOpacity:80,bgDim:30,sidebarOpacity:80,projectsDir:''};
/* v87.3: Backend config state — loaded from /api/settings */
var _bCfg=null;var _bCfgLoading=false;var _gpuInfo=null;var _ollamaModels=null;var _sysInfo=null;var _storageInfo=null;var _bCfgSaveTimer=null;
function _loadBCfg(cb){if(_bCfg&&!_bCfgLoading){if(cb)cb();return;}_bCfgLoading=true;fetch(_backendBase+'/api/settings',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_bCfg=d||{};_bCfgLoading=false;if(cb)cb();renderCenter();}).catch(function(){_bCfg=_bCfg||{};_bCfgLoading=false;if(cb)cb();});}
function _saveBCfg(){if(!_bCfg)return;clearTimeout(_bCfgSaveTimer);_bCfgSaveTimer=setTimeout(function(){fetch(_backendBase+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_bCfg),signal:AbortSignal.timeout(3000)}).catch(function(){});},500);}
function _bVal(key,def){return _bCfg&&_bCfg[key]!=null?_bCfg[key]:def;}
function _bSet(key,val){if(!_bCfg)_bCfg={};_bCfg[key]=val;_saveBCfg();renderCenter();}
/* v87.3: Info icon helper — native title tooltip on (i) badge */
function _iI(text){return h('span',{style:{display:'inline-flex',alignItems:'center',justifyContent:'center',width:14,height:14,borderRadius:'50%',background:C.bg4,color:C.tx3,fontSize:'8px',fontWeight:700,cursor:'help',marginLeft:5,verticalAlign:'middle',flexShrink:0},title:text},'i');}
function _lI(text,info){return h('span',{style:{display:'inline-flex',alignItems:'center'}},text,_iI(info));}
/* v87.3: Backend config field helpers */
function _cfgInput(label,key,def,type,hint){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),type==='textarea'?h('textarea',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'7px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',resize:'vertical',lineHeight:'1.5',minHeight:60,boxSizing:'border-box'},value:v||'',onChange:function(e){_bSet(key,e.target.value);}}):h('input',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v!=null?String(v):'',onChange:function(e){_bSet(key,type==='number'?parseFloat(e.target.value)||0:e.target.value);}}),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
function _cfgSelect(label,key,def,opts){var v=_bVal(key,def);return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('select',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'6px 9px',color:C.tx1,fontFamily:C.font,fontSize:_fs(12),outline:'none',boxSizing:'border-box'},value:v,onChange:function(e){_bSet(key,e.target.value);}},opts.map(function(o){return h('option',{key:o,value:o},o);})));}
function _cfgToggle(label,desc,key,def){return _settingsToggle(label,desc,!!_bVal(key,def),function(nv){_bSet(key,nv);});}
function _cfgSlider(label,key,def,min,max,step,unit,hint,fmt){var v=_bVal(key,def);var disp=fmt?fmt(v):v+(unit||'');return h('div',{style:{marginBottom:12}},h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:6,display:'flex',alignItems:'center'}},label),h('div',{style:{display:'flex',alignItems:'center',gap:8}},h('input',{type:'range',min:min,max:max,step:step,value:v,onChange:function(e){_bSet(key,parseFloat(e.target.value));},style:{flex:1,cursor:'pointer',accentColor:C.accent}}),h('span',{style:{fontSize:_fs(11),color:C.tx3,minWidth:52,textAlign:'right',fontFamily:C.mono}},disp)),hint?h('div',{style:{fontSize:_fs(9),color:C.tx4,marginTop:3}},hint):null);}
var _backupMsg=null;var _notifChannels=null;
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
          var sty=isLines
            ?{padding:14,cursor:'pointer',borderBottom:'1px solid '+C.border,borderRight:'1px solid '+C.border,
              background:isSel?'rgba(34,197,94,0.05)':'transparent',transition:'background 0.15s'}
            :{background:C.bg2,border:'1px solid '+(isSel?C.accent:C.border),borderRadius:12,padding:16,cursor:'pointer',transition:'border-color 0.15s',position:'relative',overflow:'hidden'};
          return h('div',{key:si,className:'c3-card',onClick:function(){_centerState.settingsSection=si;_centerState.detail=null;renderCenter();},style:sty,
            onMouseEnter:function(e){if(!isSel)e.currentTarget.style.background=isLines?'rgba(255,255,255,0.025)':e.currentTarget.style.background;if(!isSel&&!isLines)e.currentTarget.style.borderColor=C.border2;},
            onMouseLeave:function(e){if(!isSel){e.currentTarget.style.background=isLines?'transparent':C.bg2;if(!isLines)e.currentTarget.style.borderColor=C.border;}}},
            !isLines?h('div',{style:{position:'absolute',top:0,left:0,right:0,height:3,background:isSel?C.accent:'transparent'}}):null,
            h('div',{style:{fontSize:_fs(24),marginBottom:8}},sec.icon),
            h('div',{style:{fontSize:_fs(13),fontWeight:700,color:isSel?C.accentText:C.tx1,marginBottom:2}},sec.title),
            h('div',{style:{fontSize:_fs(11),color:C.tx3}},sec.title==='About'?'v'+(_serverHealth.version||'...'):sec.desc||''));
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
  var models=(_ollamaModels||[]).map(function(m){return typeof m==='string'?m:m.name||m.model||'';}).filter(Boolean);
  if(models.length===0)models=['qwen2.5:32b','qwen2.5-coder:32b','llava:13b','llama3.1:70b','mistral:7b'];
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
    _cfgSelect(_lI('Chat model','Hlavní model pro konverzaci, syntézu a analýzu'),'c3.llm.chatModel','qwen2.5:32b',models),
    _cfgSelect(_lI('Code model','Model optimalizovaný pro generování a editaci kódu'),'c3.llm.codeModel','qwen2.5-coder:32b',models),
    _cfgSelect(_lI('Vision model','Model pro analýzu obrázků a vizuálního obsahu'),'c3.llm.visionModel','llava:13b',models),
    _cfgInput('Ollama URL','c3.llm.ollamaUrl','http://127.0.0.1:11434','input','Adresa lokálního Ollama serveru'),
    _cfgSlider(_lI('Temperature','Nízká = deterministické, konzistentní odpovědi. Vysoká = kreativnější, rozmanitější výstupy.'),'c3.llm.temperature',0.7,0,2,0.1,''),
    _cfgSlider(_lI('Context window','Kolik tokenů si model pamatuje v rámci jedné konverzace. Větší okno = více kontextu, ale vyšší nároky na paměť.'),'c3.llm.contextWindow',32768,2048,131072,1024,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':'v tok';}),
    _cfgSlider(_lI('Timeout chat','Maximální doba čekání na odpověď chat modelu. Zvyšte při pomalých odpovědích.'),'c3.llm.timeoutChat',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('Timeout code','Maximální doba čekání na odpověď code modelu.'),'c3.llm.timeoutCode',90000,10000,300000,5000,'',null,function(v){return Math.round(v/1000)+'s';}),
    _cfgSlider(_lI('GPU layers','Kolik vrstev modelu se načte do GPU. -1 = automaticky dle dostupné VRAM. 0 = vše na CPU.'),'c3.llm.numGpu',-1,-1,8,1,''));
}
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
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_notifChannels){fetch(_backendBase+'/api/notifications/channels',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_notifChannels=d;renderCenter();}).catch(function(){_notifChannels={error:true};});}
  var chs=_notifChannels&&!_notifChannels.error?(_notifChannels.channels||_notifChannels):null;
  return h('div',null,
    _cfgToggle('Desktop notifikace','Systémové notifikace přes Electron (dokončení úloh, chyby agentů)','c3.notif.desktopEnabled',true),
    _cfgToggle('Tichý režim','Potlačí všechny notifikace v nastaveném časovém rozmezí','c3.notif.quietEnabled',false),
    _bVal('c3.notif.quietEnabled',false)?h(React.Fragment,null,
      _cfgInput('Ticho od','c3.notif.quietFrom','22:00','input','Formát HH:MM'),
      _cfgInput('Ticho do','c3.notif.quietTo','07:00','input','Formát HH:MM')):null,
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
    _cfgToggle('Code blocky','Výstup obsahuje formátované bloky se zdrojovým kódem','c3.output.codeBlocks',true),
    _cfgToggle('Syntax highlighting','Zvýrazňování syntaxe v code blocích (barvy dle jazyka)','c3.output.syntaxHighlight',true),
    _cfgToggle('Markdown rendering','Formátování textu — nadpisy, seznamy, tučné písmo, odkazy','c3.output.markdownRendering',true),
    _cfgSlider(_lI('Max délka odpovědi','Maximální počet tokenů v jedné odpovědi. 1 token \u2248 4 znaky českého textu. 8K token \u2248 6 stran textu.'),'c3.output.maxResponseLength',8192,1024,65536,512,'',null,function(v){return v>=1024?Math.round(v/1024)+'K tok':v+' tok';}));
}
function settingsSystemPanel(){
  if(!_bCfg)return h('div',{style:{color:C.tx3,padding:8}},'Načítám...');
  if(!_sysInfo){fetch(_backendBase+'/api/system/info',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){_sysInfo=d;renderCenter();}).catch(function(){_sysInfo={error:true};});}
  return h('div',null,
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
    h('div',{style:{fontSize:_fs(11),color:C.tx3,marginBottom:14}},'Zálohujte svá nastavení nebo je obnovte ze souboru.'),
    _backupMsg?h('div',{style:{padding:'8px 12px',borderRadius:6,marginBottom:10,fontSize:_fs(11),fontWeight:600,background:_backupMsg.ok?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',color:_backupMsg.ok?C.accent:'#ef4444',border:'1px solid '+(_backupMsg.ok?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')}},_backupMsg.text):null,
    h('button',{style:{width:'100%',background:C.accent,color:'#fff',border:'none',borderRadius:6,padding:'10px 14px',fontSize:_fs(12),fontWeight:600,cursor:'pointer',marginBottom:10,fontFamily:C.font},
      onClick:function(){fetch(_backendBase+'/api/settings',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(d){
        var blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
        var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='c3-settings-'+new Date().toISOString().slice(0,10)+'.json';a.click();
        _backupMsg={ok:true,text:'Nastavení exportována do souboru'};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);
      }).catch(function(e){_backupMsg={ok:false,text:'Export selhal: '+e.message};renderCenter();});}},'Exportovat nastavení'),
    h('button',{style:{width:'100%',background:C.bg3,border:'1px solid '+C.border2,borderRadius:6,padding:'10px 14px',fontSize:_fs(12),cursor:'pointer',color:C.tx1,marginBottom:10,fontFamily:C.font},
      onClick:function(){
        var inp=document.createElement('input');inp.type='file';inp.accept='.json';
        inp.onchange=function(e){var f=e.target.files[0];if(!f)return;
          var reader=new FileReader();reader.onload=function(ev){try{var data=JSON.parse(ev.target.result);
            fetch(_backendBase+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(3000)})
            .then(function(){_bCfg=data;_backupMsg={ok:true,text:'Nastavení importována z '+f.name};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);})
            .catch(function(e){_backupMsg={ok:false,text:'Import selhal: '+e.message};renderCenter();});
          }catch(ex){_backupMsg={ok:false,text:'Neplatný JSON soubor'};renderCenter();}};reader.readAsText(f);};inp.click();}},'Importovat nastavení'),
    h('div',{style:{borderTop:'1px solid '+C.border,paddingTop:14,marginTop:8}},
      h('div',{style:{fontSize:_fs(11),fontWeight:600,color:C.tx2,marginBottom:4}},'Reset'),
      h('div',{style:{fontSize:_fs(10),color:C.tx4,marginBottom:8}},'Smaže všechna uživatelská nastavení a obnoví výchozí hodnoty.'),
      h('button',{style:{width:'100%',background:'transparent',border:'1px solid #ef4444',borderRadius:6,padding:'8px 14px',fontSize:_fs(11),cursor:'pointer',color:'#ef4444',fontFamily:C.font},
        onClick:function(){if(!confirm('Opravdu obnovit výchozí nastavení? Všechny změny budou ztraceny.'))return;
          fetch(_backendBase+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)})
          .then(function(){_bCfg={};_backupMsg={ok:true,text:'Nastavení obnovena na výchozí'};renderCenter();setTimeout(function(){_backupMsg=null;renderCenter();},4000);}).catch(function(e){_backupMsg={ok:false,text:'Reset selhal: '+e.message};renderCenter();});}},'Obnovit výchozí')));
}
function settingsAboutPanel(){
  return h('div',{style:{textAlign:'center',padding:'30px 0'}},
    h('div',{style:{width:64,height:64,background:'linear-gradient(135deg,#22c55e,#16a34a)',borderRadius:18,display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:_fs(26),color:'#fff',marginBottom:14}},'C3'),
    h('div',{style:{fontSize:_fs(17),fontWeight:700,color:C.tx1,marginBottom:4}},'C3 Studio'),
    h('div',{style:{fontSize:_fs(13),color:C.accent,fontWeight:600,marginBottom:16}},'v'+(_serverHealth.version||'...')),
    h('div',{style:{fontSize:_fs(11),color:C.tx4}},'Made with \u2764\ufe0f by Belfik'));
}

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
  var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
  if(_ti!==_sessionActive)_saveTreeState(_sessionActive);
  _sessionActive=_ti;_ensureSessions();var _ts=_sessions[_ti];
  if(a==='Otevřít'){
    _centerState.detail=null;_centerState.detailConversations=null;renderCenter();
    var exp=EXPERTISES.find(function(e){return e.name===d.name;});
    if(exp){c3.setExpertise(exp.name);c3.agentLog('TOOL','Expertyza změněna na: '+exp.name);}
    var conv=CONVERSATIONS.find(function(c){return c.title===d.name;});
    if(conv){c3.agentLog('TOOL','Načítám konverzaci: '+conv.title+'...');c3.setExpertise(conv.expertise);
      if(conv.id){_ts._convId=conv.id;_persistSessionState();
        fetch(_backendBase+'/api/conversations/'+conv.id,{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(cd){
          var meta={};try{meta=JSON.parse(cd.metadata||'{}');}catch(ex){}
          if(meta.agentId){_ts._agentId=meta.agentId;_persistSessionState();renderChat();}
        }).catch(function(){});
        fetch(_backendBase+'/api/conversations/'+conv.id+'/messages',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json();}).then(function(msgs){
        var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);if(items.length>0){_ts.chat.msgs=[{role:'system',text:'Konverzace: '+conv.title}];items.forEach(function(m){var meta=null;try{meta=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(meta&&meta.mode)||undefined});});renderChat();_chatScrollPane(_ti);}}).catch(function(){});}
    }
    var proj=PROJECTS.find(function(p){return p.name===d.name;});
    if(proj){c3.agentLog('TOOL','Otevren projekt: '+proj.name+(proj.path?' ['+proj.path+']':''));
      if(proj.path){_wtRoot=proj.path;_loadWorkspaceTree(proj.path);}
      _ts._projectId=proj.id||null;
      _ts._lifecycleResumed=false;
      _ts.log=[];_ts.term=[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}];
      _persistSessionState();
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
    }
    var wrk=WORKERS.find(function(w){return w.name===d.name;});
    if(wrk){c3.agentLog('TOOL','Worker: '+wrk.name+' ['+_s(wrk.status)+'] cron: '+_s(wrk.cron));}
  }else if(a==='Editovat'){
    if(_centerState.view==='expertises'){
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
          var _ti2=_centerState.targetSession||0;if(_ti2>=_sessionCount)_ti2=0;
          _sessions[_ti2]._convId=created.id;
          _sessions[_ti2].chat.expertise=upd.Expertise||upd.expertise||'Vychozi';
          _sessions[_ti2].chat.msgs=[{role:'system',text:'Nova konverzace: '+d.name}];
          _persistSessionState();renderChat();
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
    if(cid4){fetch(_backendBase+'/api/conversations/'+cid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Konverzace '+d.name+' smazána.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
    else if(pid4){fetch(_backendBase+'/api/projects/'+pid4,{method:'DELETE',signal:AbortSignal.timeout(3000)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);c3.agentLog('TOOL','Projekt '+d.name+' smazán.');fetchBackendData();}).catch(function(e){c3.agentLog('TOOL','❌ Chyba mazání: '+(e.message||e));fetchBackendData();});}
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
      /* Session picker */
      _sessionCount>1?h('div',{style:{marginBottom:12}},
        h('div',{style:secS},'RELACE'),
        h('div',{style:{display:'flex',gap:4}},Array.from({length:_sessionCount},function(_,si){
          var sel=(_centerState.targetSession||0)===si;
          return h('div',{key:si,style:{width:26,height:22,display:'flex',alignItems:'center',justifyContent:'center',fontSize:_fs(11),fontWeight:600,borderRadius:5,cursor:'pointer',border:'1px solid '+(sel?C.accent:C.border),color:sel?C.accentText:C.tx4,background:sel?C.accentBg:'transparent'},
            onClick:function(){_centerState.targetSession=si;renderCenter();}},si+1);
        }))):null,
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
              var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
              _sessionActive=_ti;_ensureSessions();var _ts=_sessions[_ti];
              if(cv.id){
                _ts._convId=cv.id;_persistSessionState();
                fetch(_backendBase+'/api/conversations/'+cv.id+'/messages',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).then(function(msgs){
                  var items=Array.isArray(msgs)?msgs:(msgs.messages||[]);
                  _ts.chat.msgs=[{role:'system',text:'Konverzace: '+(cv.title||'#'+cv.id)}];
                  items.forEach(function(m){var mt=null;try{mt=m.metadata?JSON.parse(m.metadata):null;}catch(e){}_ts.chat.msgs.push({role:m.role||'user',text:m.content||m.text||'',tag:(mt&&mt.mode)||undefined});});
                  renderChat();_chatScrollPane(_ti);
                }).catch(function(){});
              }
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
    var _ti=_centerState.targetSession||0;if(_ti>=_sessionCount)_ti=0;
    if(proj&&proj.id){_sessions[_ti]._projectId=proj.id;_persistSessionState();}
    if(window._c3){window._c3.agentLog('TOOL','📂 Složka otevřena: '+realPath);}
    fetchBackendData();renderCenter();
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

/* Nav event handler */
window.addEventListener('c3-nav',function(e){
  _centerState.view=e.detail.view;_centerState.detail=null;_centerState.detailConversations=null;_centerState.settingsSection=null;_editorState.active=false;if(_centerContainer)_centerContainer.style.display='';fetchBackendData();renderCenter();
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
  chat:{msgs:[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}],ctx:0,expertise:'Výchozí',showExpertises:false,showAllExpertises:false,attachments:[],editMode:'ask',editingIdx:null,editOriginalText:null,acSuggestion:null,acLoading:false},
  bottom:'split', /* 'agent' | 'terminal' | 'split' | 'mix' */
  log:[],
  term:[{text:'$ ',ts:new Date().toISOString(),type:'prompt'}]
};}
var _sessions=[_mkSession(),_mkSession()];
/* Expose globally so terminal-client.js and agent-client.js can access session state */
window._sessions=_sessions;
function _ensureSessions(){while(_sessions.length<_sessionCount)_sessions.push(_mkSession());}
function _setSessionCount(n){_sessionCount=Math.max(1,Math.min(3,n));if(_sessionActive>=_sessionCount)_sessionActive=_sessionCount-1;_ensureSessions();renderChat();renderAgent();}

/* v64.4: New-chat dialog state */
var _newChatDialog=null; /* null | {idx, projectId, projectName} */

function _newChatInProject(idx){
  var s=_sessions[idx];if(!s)return;
  var projId=s._projectId;
  var proj=projId?PROJECTS.find(function(p){return p.id===projId;}):null;
  if(!proj){/* No project — just reset */
    s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];s._convId=null;s._agentId=null;
    _sessionActive=idx;_persistSessionState();renderChat();return;
  }
  /* Has project — show dialog */
  _newChatDialog={idx:idx,projectId:projId,projectName:proj.name};renderChat();
}
function _newChatDialogAction(choice){
  if(!_newChatDialog)return;
  var idx=_newChatDialog.idx;var s=_sessions[idx];if(!s){_newChatDialog=null;renderChat();return;}
  if(choice==='project'){
    /* New conversation in same project */
    s.chat.msgs=[{role:'system',text:'📂 Nová konverzace v projektu: '+_newChatDialog.projectName}];
    s.chat.ctx=0;s.chat.attachments=[];s._convId=null;s._agentId=null;
    /* Create new conversation linked to project */
    fetch(_backendBase+'/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:_newChatDialog.projectId,title:_newChatDialog.projectName}),signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json();}).then(function(d){if(d.id||d.conversation){s._convId=(d.conversation||d).id;_persistSessionState();}}).catch(function(){});
  } else if(choice==='free'){
    /* New conversation outside project */
    s.chat.msgs=[{role:'system',text:'Nový chat.'}];s.chat.ctx=0;s.chat.attachments=[];
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
  if(choice==='conv'){
    /* A) Close conversation only — reset pane to empty state */
    s._convId=null;s._projectId=null;s._agentId=null;s._lifecycleResumed=false;
    s.chat.msgs=[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}];
    s.chat.ctx=0;s.chat.expertise='Výchozí';s.chat.attachments=[];
    _perSessionTree[idx]=null;
    if(idx===_sessionActive){_wtRoot='';_wtRawTree=null;FILES=[];renderSidebar();}
    _persistSessionState();
  } else if(choice==='pane'){
    /* B) Close conversation + reduce panel count */
    s._convId=null;s._projectId=null;s._agentId=null;s._lifecycleResumed=false;
    s.chat.msgs=[{role:'system',text:'C3 Studio připraven. Začni psát zprávu.'}];
    s.chat.ctx=0;s.chat.expertise='Výchozí';s.chat.attachments=[];
    _perSessionTree[idx]=null;
    if(_sessionCount>1){
      /* Swap closed pane with last pane if not already last, then reduce count */
      if(idx<_sessionCount-1){
        var last=_sessions[_sessionCount-1];_sessions[_sessionCount-1]=s;_sessions[idx]=last;
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
  renderChat();
}

var _chatContainer=null;

/* ── Bus subscriptions (transport → UI) ── */
function _initBusSubscriptions() {
  if (typeof C3Bus === 'undefined') { console.warn('[C3] C3Bus not available yet'); return; }

  /* Chat messages from assistant */
  C3Bus.on('chat:message', function(ev) {
    var s = _sessions[ev.sessionIdx] || _sessions[0];
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
    renderChat(); _chatScrollPane(ev.sessionIdx);
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

  /* WS reconnected — trigger re-render to show restored messages */
  C3Bus.on('ws:reconnected', function() {
    renderChat(); renderAgent();
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

  /* WS reconnected */
  C3Bus.on('ws:reconnected', function() {
    if(window._c3)window._c3.agentLog('TOOL','✅ Spojení obnoveno.');
    renderSidebar();
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
        if(window._c3)window._c3.agentLog('TOOL','⚠️ Konverzace již neexistuje na serveru.');
      }
    });
    renderChat();
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
            expertiseName: s.chat.expertise,
            editMode: s.chat.editMode,
            bottomMode: s.bottom,
            wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
            recentMsgs: recentMsgs
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
          expertiseName: s.chat.expertise, editMode: s.chat.editMode,
          bottomMode: s.bottom,
          wtRoot: (_perSessionTree[i]&&_perSessionTree[i].wtRoot)||(i===_sessionActive?_wtRoot:''),
          recentMsgs: recentMsgs
        };
      })
    }));
  } catch(e) {}
});

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
          _sessions[i].chat.expertise = ss.expertiseName || 'Výchozí';
          _sessions[i].chat.editMode = ss.editMode || 'ask';
          _sessions[i].bottom = ss.bottomMode || 'split';
          /* v64.3: Restore per-session tree root */
          if(ss.wtRoot){_perSessionTree[i]={wtRoot:ss.wtRoot,collapsedDirs:{},rawTree:null,files:[]};}
          /* v64.4: Restore recent messages */
          if(ss.recentMsgs&&ss.recentMsgs.length>0){_sessions[i].chat.msgs=ss.recentMsgs;}
          /* v81.2: Always clear editing state on restore — editing cannot survive restart */
          _sessions[i].chat.editingIdx=null;
          _sessions[i].chat.editOriginalText=null;
        }
      });
      /* Load active session's tree */
      var act=_sessionActive||0;
      if(_perSessionTree[act]&&_perSessionTree[act].wtRoot){
        _wtRoot=_perSessionTree[act].wtRoot;
        _loadWorkspaceTree(_wtRoot);
      }
      /* v64.5: Schedule renderChat after widget is attached (container may not exist yet at 200ms) */
      var _restoreRenderAttempts=0;
      var _restoreRenderTimer=setInterval(function(){
        _restoreRenderAttempts++;
        if(_chatContainer||_restoreRenderAttempts>20){
          clearInterval(_restoreRenderTimer);
          renderChat();renderAgent();renderSidebar();
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
  if(typeof console!=='undefined')console.debug('[C3:readAttachments]',attachments.length,'files, _nodeFs:',!!_nodeFs);
  attachments.forEach(function(a,i){
    var filePath=(a.file&&a.file.path)?a.file.path:null;
    if(typeof console!=='undefined')console.debug('[C3:readAttachments] file',i,a.name,'hasFile:',!!a.file,'filePath:',filePath,'fileSize:',a.file?a.file.size:'N/A');
    function _done(res){results[i]=res;if(typeof console!=='undefined')console.debug('[C3:readAttachments] result',i,a.name,'hasContent:',!!res.content,'contentLen:',res.content?res.content.length:0,'hasPath:',!!res.path);if(--pending===0)callback(results);}
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
      reader2.onload=function(){_done({name:a.name,size:a.size,type:'image',content:reader2.result,path:filePath});};
      reader2.onerror=function(){_done({name:a.name,size:a.size,type:'image',content:null,path:filePath});};
      reader2.readAsDataURL(a.file);return;
    }
    /* ── UNKNOWN / BINARY / OVERSIZED ── */
    _done({name:a.name,size:a.size,type:'binary',content:null,path:filePath});
  });
}

function _chatSendPane(idx){
  var ta=document.getElementById('c3-chat-ta-'+idx);
  var s=_sessions[idx];if(!s)return;var st=s.chat;
  st.acSuggestion=null;/* clear autocomplete on send */
  var t=ta?ta.value.trim():'';if(!t&&st.attachments.length===0)return;

  /* ── Edit mode — replace message and resend (branch-from-here) ── */
  if(st.editingIdx!==null&&st.editingIdx!==undefined){
    var editIdx=st.editingIdx;
    st.editingIdx=null;st.editOriginalText=null;
    st.msgs[editIdx].text=t;
    st.msgs.splice(editIdx+1);/* remove all after edited msg */
    if(ta){ta.value='';ta.style.height='22px';}
    renderChat();_chatScrollPane(idx);
    var sent=false;
    if(typeof C3WS!=='undefined'&&C3WS.isReady()){sent=C3WS.sendChat(t,s,idx);}
    if(!sent){fetch(_backendBase+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'chat',message:t,expertise:st.expertise,editMode:st.editMode,conversationId:s._convId,agentId:s._agentId||null,projectId:s._projectId||null})}).then(function(r){return r.json();}).then(function(d){st.msgs.push({role:'assistant',text:d.response||d.text||JSON.stringify(d),tag:'LLM'});renderChat();_chatScrollPane(idx);}).catch(function(){st.msgs.push({role:'assistant',text:'Backend nedostupný.',tag:'ERROR'});renderChat();});}
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
  st.attachments=[];
  if(ta){ta.value='';ta.style.height='22px';}
  _sessionActive=idx;
  renderChat();_chatScrollPane(idx);

  /* Read attachments then send */
  _readAttachments(filesToRead,function(readFiles){
    s.chat._pendingAttachments=readFiles.length>0?readFiles:null;
    /* Send via WS (channel protocol) or HTTP fallback */
    var sent = false;
    if (typeof C3WS !== 'undefined' && C3WS.isReady()) {
      sent = C3WS.sendChat(txt, s, idx);
    }
    if (!sent) {
      var body={type:'chat',message:txt,expertise:st.expertise,editMode:st.editMode,conversationId:s._convId,agentId:s._agentId||null,projectId:s._projectId||null};
      if(readFiles.length>0)body.attachments=readFiles;
      fetch(_backendBase+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json();})
      .then(function(d){st.msgs.push({role:'assistant',text:d.response||d.text||JSON.stringify(d),tag:'LLM'});if(typeof d.contextPercent==='number')st.ctx=d.contextPercent;renderChat();_chatScrollPane(idx);})
      .catch(function(){st.msgs.push({role:'assistant',text:'Backend nedostupný. Spusťte: node src/server.js',tag:'ERROR'});renderChat();});
    }
    s.chat._pendingAttachments=null;
    /* Poll context after send */
    setTimeout(function(){_pollContext(idx);},2000);
  });
}

function _chatPaneUI(idx){
  var s=_sessions[idx];if(!s)return null;var st=s.chat;
  var isFocused=_sessionActive===idx;
  var btnS={background:C.accentBg,color:C.accentText,border:'none',borderRadius:5,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:24,height:24};
  return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',width:'100%',minWidth:0,background:C.bg1,fontFamily:C.font,position:'relative',overflow:'hidden'},
    onClick:function(){_switchSession(idx);
      _sessions.forEach(function(ss,j){if(j!==idx)ss.chat.showExpertises=false;});
      if(st.showExpertises){st.showExpertises=false;}renderChat();}},
    /* PANE HEADER */
    h('div',{style:{padding:'0 6px',height:28,display:'flex',alignItems:'center',gap:3,borderBottom:'1px solid '+C.border,flexShrink:0,background:isFocused?C.bg2:'transparent'}},
      h('button',{style:btnS,title:'Nový chat',onClick:function(ev){ev.stopPropagation();_newChatInProject(idx);}},svgEl(I.plus)),
      /* v64.3: Session label — project name or expertise */
      (function(){var label='';if(s._projectId){var _pr=PROJECTS.find(function(p){return p.id===s._projectId;});if(_pr)label=_pr.name;}
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
        var msgS=bub?{background:u?C.bg4:a?C.bg2:C.bg3,borderRadius:u?'12px 12px 2px 12px':a?'12px 12px 12px 2px':'8px',padding:'6px 10px',maxWidth:'85%',minWidth:60,border:isEditing?'2px solid '+C.accent:'none'}:{border:isEditing?'2px solid '+C.accent:'none'};
        return h('div',{key:i,style:Object.assign({},wrapS,u?{cursor:'pointer'}:{}),onClick:u?function(){_chatStartEdit(idx,i);}:undefined,title:u?'Klikni pro editaci':undefined},
          h('div',{style:msgS},
          h('div',{style:{display:'flex',alignItems:'center',gap:4,marginBottom:2}},
            h('div',{style:{width:18,height:18,borderRadius:'50%',background:u?C.bg4:a?'linear-gradient(135deg,#22c55e,#16a34a)':C.bg3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:a?_fs(6):_fs(8),fontWeight:a?700:400,color:u?C.tx3:a?'#fff':C.tx4}},u?'👤':a?'C3':'⚡'),
            h('span',{style:{fontSize:_fs(10),fontWeight:600,color:C.tx2}},u?'Ty':a?'C3':'System'),
            m.tag?h('span',{style:{fontSize:_fs(7.5),padding:'1px 3px',borderRadius:3,fontFamily:C.mono,textTransform:'uppercase',background:m.tag==='ERROR'?C.redBg:C.purpleBg,color:m.tag==='ERROR'?C.red:C.purple}},m.tag):null),
          h('div',{style:{fontSize:_fs(12),lineHeight:'1.5',color:C.tx1,paddingLeft:22,wordBreak:'break-word',whiteSpace:'pre-wrap'}},m.text)));})),
    /* INPUT */
    h('div',{style:{padding:6,borderTop:'1px solid '+C.border,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
      h('div',{style:{background:C.bg2,border:'1px solid '+(st.editingIdx!==null?C.accent:C.border2),borderRadius:10,overflow:'visible',position:'relative'}},
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
          h('button',{style:{background:C.accentBg,color:C.accentText,border:'none',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',width:22,height:22},title:'Připojit soubor',
            onClick:function(ev){ev.stopPropagation();var inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.style.display='none';document.body.appendChild(inp);inp.onchange=function(){if(inp.files){for(var j=0;j<inp.files.length;j++){st.attachments.push({name:inp.files[j].name,size:Math.round(inp.files[j].size/1024)+' KB',file:inp.files[j]});}renderChat();}document.body.removeChild(inp);};inp.click();}},svgEl(I.attach,12)),
          /* Edit mode toggle */
          h('div',{style:{display:'flex',alignItems:'center',gap:1,padding:'1px 2px',borderRadius:4,background:C.bg3,flexShrink:0},onClick:function(ev){ev.stopPropagation();}},
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:_fs(9),fontWeight:600,cursor:'pointer',color:st.editMode==='auto'?C.tx1:C.tx4,background:st.editMode==='auto'?C.bg4:'transparent'},
              onClick:function(){st.editMode='auto';renderChat();_persistSessionState();},title:'Agent edituje soubory automaticky'},'Auto'),
            h('div',{style:{padding:'2px 6px',borderRadius:3,fontSize:_fs(9),fontWeight:600,cursor:'pointer',color:st.editMode==='ask'?C.tx1:C.tx4,background:st.editMode==='ask'?C.bg4:'transparent'},
              onClick:function(){st.editMode='ask';renderChat();_persistSessionState();},title:'Agent se zeptá před každou editací'},'Review')),
          h('div',{style:{flex:1}}),
          h('div',{style:{display:'flex',alignItems:'center',gap:2,padding:'2px 6px',borderRadius:4,fontSize:_fs(10),fontWeight:500,color:C.accentText,opacity:0.7,cursor:'pointer',flexShrink:0},
            onClick:function(ev){ev.stopPropagation();st.showExpertises=!st.showExpertises;renderChat();}},
            h('span',{style:{width:4,height:4,borderRadius:'50%',background:C.accent}}),st.expertise,svgEl(I.chevDown,8))),
        st.showExpertises?(function(){var favs=EXPERTISES.filter(function(e){return e.fav;});var shown=st.showAllExpertises?EXPERTISES:favs.length>0?favs:EXPERTISES;return h('div',{style:{position:'absolute',bottom:'100%',right:6,marginBottom:3,background:C.bg3,border:'1px solid '+C.border2,borderRadius:8,padding:'4px 0',minWidth:160,maxHeight:240,overflowY:'auto',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,0.5)'},onClick:function(ev){ev.stopPropagation();}},
          h('div',{style:{padding:'3px 10px 5px',fontSize:_fs(8.5),fontWeight:700,color:C.tx4,textTransform:'uppercase',letterSpacing:'0.5px'}},'VYBRAT EXPERTYZU'),
          shown.map(function(exp){
            return h('div',{key:exp.name,style:{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',fontSize:_fs(11),color:st.expertise===exp.name?C.accentText:C.tx2,background:st.expertise===exp.name?C.accentBg:'transparent',cursor:'pointer'},
              onMouseEnter:function(e){e.currentTarget.style.background=C.bg4;},
              onMouseLeave:function(e){e.currentTarget.style.background=st.expertise===exp.name?C.accentBg:'transparent';},
              onClick:function(e){e.stopPropagation();st.expertise=exp.name;st.showExpertises=false;st.showAllExpertises=false;renderChat();}},
              h('span',null,exp.emoji),h('span',{style:{flex:1}},exp.name),
              h('span',{style:{fontSize:_fs(11),color:exp.fav?C.accentText:C.tx4,cursor:'pointer'},onClick:function(e){e.stopPropagation();exp.fav=!exp.fav;if(exp.id){fetch(_backendBase+'/api/expertises/'+exp.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:exp.fav}),signal:AbortSignal.timeout(3000)}).catch(function(){});}renderChat();}},exp.fav?'★':'☆'));}),
          !st.showAllExpertises&&favs.length>0&&favs.length<EXPERTISES.length?h('div',{style:{padding:'4px 10px',fontSize:_fs(9.5),color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExpertises=true;renderChat();}},'Zobrazit vše ('+EXPERTISES.length+')'):null,
          st.showAllExpertises?h('div',{style:{padding:'4px 10px',fontSize:_fs(9.5),color:C.tx4,cursor:'pointer',borderTop:'1px solid '+C.border,marginTop:2},onClick:function(e){e.stopPropagation();st.showAllExpertises=false;renderChat();}},'Jen oblíbené'):null);}()):null)));
}

function ChatApp(){
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
    h('div',{style:{display:'flex',flex:1,overflow:'hidden'}},
      Array.from({length:sc},function(_,i){
        return h('div',{key:'cp'+i,style:{flex:1,display:'flex',borderRight:i<sc-1?'2px solid '+C.border2:'none',overflow:'hidden',minWidth:0}},_chatPaneUI(i));
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
  var mode=s.bottom||'split';
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
    /* Per-panel tab bar */
    h('div',{style:{height:24,display:'flex',alignItems:'stretch',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg2}},
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
        window._c3SnapVersion='87.6.2';
        console.log('[C3] Snap-collapse v87.6.2 init');
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
        /* Right panel: snap-hide when below 280px */
        if(rightCP){new ResizeObserver(function(entries){
          if(_c3SnapLock)return;
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
        /* Left panel: snap-hide when below 40px (icon mode = 48px, below = unusable) */
        if(leftCP){new ResizeObserver(function(entries){
          if(_c3SnapLock)return;
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
          el.style.cssText='position:fixed;'+(isLeft?'left:0':'right:0')+';top:50%;transform:translateY(-50%);width:24px;height:72px;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:10000;border-radius:'+(isLeft?'0 8px 8px 0':'8px 0 0 8px')+';background:'+C.bg3+';border:1px solid '+C.border2+';'+(isLeft?'border-left:none':'border-right:none')+';transition:background 0.15s,width 0.15s;';
          el.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="'+C.tx2+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+(isLeft?'<polyline points="9 18 15 12 9 6"/>':'<polyline points="15 18 9 12 15 6"/>')+'</svg>';
          el.title=isLeft?'Rozbalit sidebar':'Rozbalit chat panel';
          el.addEventListener('mouseenter',function(){el.style.background=C.bg4;el.style.width='32px';});
          el.addEventListener('mouseleave',function(){el.style.background=C.bg3;el.style.width='24px';});
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
      }catch(e){console.warn('[C3] Snap-collapse setup:',e);}
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
