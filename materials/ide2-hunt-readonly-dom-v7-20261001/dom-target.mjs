// Browser-only read snapshots of declared public buttons. No state mutation,
// internal navigation, backend request or hidden fallback in this module.
export const SETTINGS_BUTTON_SELECTOR = '#intentsmith-studio2 .nav-b button.nbtn, #intentsmith-studio2 nav.railw button.rail[aria-label="Nastavení"]';
export const MODELS_TILE_SELECTOR = '#intentsmith-studio2 .view .cat button.tile, #intentsmith-studio2 .view .cat button.lrow';
export function interactiveTargetSnapshot({selector,text,exact=true,waitForCandidate=false}) {
  const describe = n => n ? {tag:String(n.tagName||'').toUpperCase(),id:n.id||'',
    classes:n.getAttribute('class')||'',ariaLabel:n.getAttribute('aria-label')||'',
    text:(n.textContent||'').trim().slice(0,300)} : null;
  const candidates=[...document.querySelectorAll(selector)].map((n,index)=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n),label=n.getAttribute('aria-label')||'',value=(n.textContent||'').trim();
    const match=exact ? value===text||label===text : value.includes(text)||label.includes(text);
    const visible=Number.isFinite(r.left)&&Number.isFinite(r.top)&&r.width>0&&r.height>0
      && s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&Number(s.opacity)!==0;
    const interactive=String(n.tagName||'').toUpperCase()==='BUTTON';
    const disabled=n.disabled===true||n.hasAttribute('disabled')||n.getAttribute('aria-disabled')==='true';
    return {element:n,index,description:describe(n),match,visible,interactive,disabled,
      rect:{left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
      style:{display:s.display,visibility:s.visibility,opacity:s.opacity}};
  });
  const eligible=candidates.filter(c=>c.match&&c.visible&&c.interactive&&!c.disabled);
  if(waitForCandidate)return eligible.length===1;
  const result={selector,text,exact,eligibleCount:eligible.length,selectedIndex:null,
    candidates:candidates.map(({element,...data})=>data),status:eligible.length===0?'NO_ELIGIBLE_BUTTON':eligible.length>1?'AMBIGUOUS':'FOUND',
    viewport:{width:innerWidth,height:innerHeight}};
  if(eligible.length!==1)return result;
  const c=eligible[0],point={x:c.rect.left+c.rect.width/2,y:c.rect.top+c.rect.height/2};
  result.selectedIndex=c.index;result.target=c.description;result.rect=c.rect;result.point=point;
  if(!(point.x>=0&&point.y>=0&&point.x<innerWidth&&point.y<innerHeight)){result.status='OFFSCREEN';return result;}
  const hit=document.elementFromPoint(point.x,point.y);result.hit=describe(hit);
  result.hitWithinTarget=hit===c.element||c.element.contains(hit);
  result.status=result.hitWithinTarget?'READY':'HIT_BLOCKED';return result;
}
export function settingsCatalogSnapshot({waitForReady=false}={}) {
  const catalog=document.querySelector('#intentsmith-studio2 .view .cat');
  const title=catalog?.querySelector('h1')?.textContent.trim()||'';
  const visible=n=>{if(!n)return false;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0;};
  const buttons=catalog?[...catalog.querySelectorAll('button.tile, button.lrow')]:[];
  const modelButtons=buttons.filter(n=>visible(n)&&(n.textContent||'').includes('Modely a inference'));
  const nav=[...document.querySelectorAll('#intentsmith-studio2 .nav-b button.nbtn, #intentsmith-studio2 nav.railw button.rail[aria-label="Nastavení"]')];
  const settingsActive=nav.some(n=>visible(n)&&(n.textContent.trim()==='Nastavení'||n.getAttribute('aria-label')==='Nastavení')
    &&(n.classList.contains('on')||n.parentElement?.classList.contains('on')));
  const ready=visible(catalog)&&title==='Nastavení'&&settingsActive&&modelButtons.length===1;
  if(waitForReady)return ready;
  return {ready,title,catalogVisible:visible(catalog),settingsActive,visibleModelButtonCount:modelButtons.length,
    visibleCatalogButtons:buttons.filter(visible).map(n=>({tag:String(n.tagName).toUpperCase(),text:(n.textContent||'').trim().slice(0,300),
      classes:n.getAttribute('class')||''})),sessionColumnsPresent:!!document.querySelector('#intentsmith-studio2 .view .cols')};
}
