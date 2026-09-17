import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {worker} from './worker.js';
import {privateDir} from './store.js';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function previewCase(store,id){
  const c=await store.read(id),cards=[];
  for(const d of c.documents){
    const source=c.sources.find(s=>s.id===d.sourceId);let visual='';
    if(source&&['pdf','image'].includes(source.type)){
      const p=await worker({operation:'preview',data:(await store.source(id,source.sha256)).toString('base64'),page:d.sourceRef?.page??1,region:d.sourceRef?.region});
      visual=`<img alt="Zdrojový doklad" src="data:image/png;base64,${p.data}">`;
    }
    cards.push(`<article><h2>${esc(d.label)} — ${esc(d.status)}</h2><div class="pair"><div>${visual||'<p>Textový podklad</p>'}</div><div><p><code>ucetni doklad ${esc(id)} ${esc(d.id)}</code></p><p>Částky v datech jsou v haléřích. Návrh OCR je třeba porovnat s originálem.</p><pre>${esc(JSON.stringify(d.fields,null,2))}</pre><details><summary>Vytěžený text a původ údajů</summary><pre>${esc(d.text)}</pre><pre>${esc(JSON.stringify(d.provenance,null,2))}</pre></details></div></div></article>`);
  }
  const html=`<!doctype html><html lang="cs"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width"><title>Účetní ${esc(id)}</title><style>body{font:16px system-ui;max-width:1280px;margin:2rem auto;padding:0 1rem;color:#182b35;background:#f4f6f7}article{background:white;padding:1.4rem;margin:1rem 0;border:1px solid #ccd6da;border-radius:8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:2rem}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}code{overflow-wrap:anywhere}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Účetní: ${esc(id)}</h1><p>Soukromý náhled revize ${c.revision}. Úpravy a potvrzení ukládá <code>ucetni pruvodce ${esc(id)}</code>. Tato stránka zobrazuje stav v okamžiku vytvoření; po úpravách ji vytvoř znovu.</p>${cards.join('')}</html>`;
  const dir=path.join(store.dir(id),'previews');await privateDir(dir);const file=path.join(dir,`rev-${c.revision}-${randomUUID().slice(0,8)}.html`);await fs.writeFile(file,html,{mode:0o600,flag:'wx'});return file;
}
