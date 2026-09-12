import { runAutonomous } from '../engine/autonomous.js';
import { buildTickets } from '../engine/tickets.js';
import { keys, fail } from '../engine/values.js';

const EMPTY_HINTS={horizonHours:null,maxSpreadHours:null,minOdds:null,maxOdds:null,minProbability:null,bookmakerIds:null};
// Text is a convenience input, never a model prediction or provider attestation.
// A complete JSON envelope is the canonical input; follow-ups change only named fields.
export function extractBettingInput(input, attachments=[]) {
  const params={};
  let body=input.trim(), prose=input;
  const fenced=[...input.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  try {
    const supplied=attachments.filter(a=>a && (a.type==='application/json'||a.type==='text/plain'));
    if(supplied.length!==attachments.length) fail('NEEDS_INPUT','Tento formát přílohy sázkař nepodporuje. Zadej preference textem; nabídku a historii si načte sám.');
    if(supplied.length>1||attachments.length>5||fenced.length>1) fail('INVALID_REQUEST','Přilož právě jednu JSON nabídku se zadáním.');
    if(supplied.length) {
      if(fenced.length||body.startsWith('{')) fail('INVALID_REQUEST','Použij jeden zdroj JSON zadání.');
      body=supplied[0].content;
      if(typeof body!=='string') fail('INVALID_REQUEST','Příloha musí obsahovat inline JSON text; cesta k souboru nestačí.');
    } else if(fenced.length) {body=fenced[0][1];prose=input.replace(fenced[0][0],'');}
    else if(body.startsWith('{')) prose='';
    if(supplied.length||fenced.length||body.startsWith('{')) {
      if(new TextEncoder().encode(body).length>1_000_000) fail('INVALID_REQUEST','JSON nabídka překračuje limit 1 MB.');
      const payload=JSON.parse(body);
      if(Object.hasOwn(payload,'preferences')) keys(payload,['preferences'],[],'input');
      else {keys(payload,['request','snapshot'],[],'input');if(payload.snapshot?.events?.some(e=>e.markets?.some(m=>m.prediction))) fail('INVALID_REQUEST','Pravděpodobnosti z přílohy nejsou přijímány; engine je vypočítá sám.');}
      Object.assign(params,EMPTY_HINTS,{payload,inputError:null});
    }
    const normalized=prose.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(/\b(hokej|tenis|basketbal|basketball|tennis|hockey|live|in.play)\b/.test(normalized)) fail('NEEDS_INPUT','Tato verze analyzuje fotbal 1X2 před začátkem zápasu.');
    const books=[...normalized.matchAll(/\b(tipsport|chance|fortuna|betano)(?:\.cz)?\b/g)].map(m=>({tipsport:'Tipsport.cz',chance:'Chance.cz',fortuna:'iFortuna CZ',betano:'Betano CZ'}[m[1]]));
    if(books.length)params.bookmakerIds=[...new Set(books)];
    const windows=[...normalized.matchAll(/(?:do|behem|pristi(?:ch)?)\s+(\d+(?:[.,]\d+)?)\s*(h(?:odin(?:y|u)?)?|dn(?:u|y|i|e)?|dny|days?|hours?)(?![a-z])/g)];
    if(windows.length>1) fail('INVALID_REQUEST','Zadej jedno časové okno.');
    if(windows.length) params.horizonHours=Number(windows[0][1].replace(',','.'))*(windows[0][2].startsWith('d')?24:1);
    else if(/\b(?:dnes|zitra|vikend)\b|\b(?:do|behem)\s+\d/.test(normalized)) fail('NEEDS_INPUT','Použij jednoznačné „do 24 h“, „do 3 dnů“ nebo UTC od/do v JSON.');
    const spread=normalized.match(/rozestup\s+(?:max(?:imalne)?\.?\s*)?(\d+)\s*h/);
    if(spread) params.maxSpreadHours=Number(spread[1]);
    const odds=normalized.match(/(?:celkovy\s+)?kurz\s+(?:od\s*)?(\d+(?:[.,]\d+)?)\s*(?:az|do|[-–])\s*(\d+(?:[.,]\d+)?)/);
    if(odds) {params.minOdds=odds[1].replace(',','.');params.maxOdds=odds[2].replace(',','.');}
    else if(/kurz\s+\d/.test(normalized)) fail('NEEDS_INPUT','Rozsah celkového kurzu zadej „kurz od 2 do 4“.');
    const p=normalized.match(/(?:uspesnost|pravdepodobnost)\s+(?:alespon|min(?:imalne)?\.?\s*)?(\d+(?:[.,]\d+)?)\s*%/);
    if(p) params.minProbability=Number(p[1].replace(',','.'))/100;
  } catch(error) { params.payload=null;params.inputError={code:error.code??'INVALID_REQUEST',message:error instanceof SyntaxError?'Neplatný JSON.':error.message}; }
  return params;
}

export async function runBetting(params={}, turn={}) {
  if(!params.inputError&&!params.payload?.snapshot&&turn.now) {
    const preferences={...(params.payload?.preferences??{})};
    for(const k of ['horizonHours','maxSpreadHours','minOdds','maxOdds','minProbability','bookmakerIds'])if(params[k]!==null&&params[k]!==undefined)preferences[k]=params[k];
    return runAutonomous(preferences,turn);
  }
  let request=params.payload?.request, snapshot=params.payload?.snapshot;
  if(request && typeof request==='object') {
    request={...request};
    if(params.horizonHours!==null&&params.horizonHours!==undefined) request.window={timezone:request.window?.timezone??'Europe/Prague',horizonHours:params.horizonHours,...(request.window?.maxSpreadHours!==undefined?{maxSpreadHours:request.window.maxSpreadHours}:{})};
    if(params.maxSpreadHours!==null&&params.maxSpreadHours!==undefined) request.window={...request.window,maxSpreadHours:params.maxSpreadHours};
    if(params.minOdds!==null&&params.minOdds!==undefined) request.ticketOdds={min:params.minOdds,max:params.maxOdds};
    if(params.minProbability!==null&&params.minProbability!==undefined) request.probabilityFilter={...request.probabilityFilter,min:params.minProbability};
  }
  const result=await buildTickets(request,snapshot,turn);
  if(params.inputError||!request||!turn.now) {
    result.status=params.inputError?.code??'NEEDS_INPUT';result.tickets=[];
    result.errors=[{code:result.status,fieldPath:'input',message:params.inputError?.message??(!turn.now?'Chybí čas hostu; použij specialistu v chatu nebo CLI.':'Přilož nebo vlož JSON {request: BettingRequest@2, snapshot: BettingSnapshot@2}. Pak lze upravit „do 24 h“, „do 3 dnů“, „rozestup max 8 h“, „kurz od 2 do 4“, „úspěšnost alespoň 40 %“. Sport: fotbal, trh 1X2.'),retryable:false,sourceRef:null}];
  }
  return result;
}
