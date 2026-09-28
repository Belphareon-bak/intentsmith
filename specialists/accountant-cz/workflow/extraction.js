import {cents,validDate,dic} from './common.js';
const norm=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const dateFrom=s=>{
  const m=s.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\b/);
  const result=m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
  return validDate(result)?result:null;
};
const amountPattern=/-?(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)[,.]\d{2}/g;
function amountTokens(s){return [...s.replace(/(\d)\s*([,.])\s*(\d{2})(?!\d)/g,'$1$2$3').matchAll(amountPattern)].map(m=>({value:cents(m[0]),text:m[0],offset:m.index}));}
export function extractDocument(page,source,profile={}){
  const text=page.text??'',n=norm(text),isSupport=/^\s*(?:potvrzeni|cestne prohlaseni|vypis)/.test(n),isInvoice=/faktura\b/.test(n),isReceipt=/danovy doklad|uctenka|celkem k uhrade|datum zdanitelneho plneni/.test(n)||/bez dph[\s\S]*celkem/.test(n);
  const kind=isSupport?'support':isInvoice?'invoice':isReceipt?'receipt':/potvrzeni|cestne prohlaseni|vypis|zaplacen.*zaloh/.test(n)?'support':'unknown';
  const sourceRef={sourceId:source.id,page:page.page,region:page.region??null,method:page.method,confidence:page.confidence};
  const fields={currency:'CZK',number:null,date:null,vatDate:null,direction:kind==='receipt'?'expense':null,totalCents:null,rows:[],paymentStatus:'unknown',payments:[]},provenance={};
  const put=(key,value,excerpt,method=page.method)=>{fields[key]=value;provenance[key]={...sourceRef,method,excerpt:excerpt.slice(0,240)};};
  if(['invoice','receipt'].includes(kind)){
    const number=text.match(/(?:Faktura\s*(?:č[.íslo]*\s*)?|(?:dokladu|Doklad|Účtenka)\s*[.:]*\s*[^\w\n]*)([\w][\w/.-]{2,50})/iu);
    if(number)put('number',number[1],number[0]);
    const dateLine=n.match(/datum vystaveni[^\n]*|datum:[^\n]*|datum zdanitelneho plneni[^\n]*/)?.[0];
    const day=dateFrom(dateLine??text);if(day)put('date',day,dateLine??text.slice(0,300));
    const vatLine=n.match(/datum zdan\. plneni[^\n]*|datum zdanitelneho plneni[^\n]*|duzp[^\n]*/)?.[0];
    if(vatLine&&dateFrom(vatLine))put('vatDate',dateFrom(vatLine),vatLine);
    else if(kind==='receipt'&&day)put('vatDate',day,dateLine??text.slice(0,300),'receipt-date-proposal');
    const ids=[...text.matchAll(/\b(?:DIČ|DIC)\s*[:.]?\s*(CZ\d{8,10})/gi)].map(m=>m[1]);
    if(ids[0])put('supplierDic',ids[0],ids[0]);if(ids[1]&&kind==='invoice')put('customerDic',ids[1],ids[1]);
    if(kind==='invoice'&&profile.dic){if(dic(ids[0])===dic(profile.dic))put('direction','income','DIČ dodavatele odpovídá profilu.');else if(dic(ids[1])===dic(profile.dic))put('direction','expense','DIČ odběratele odpovídá profilu.');}
    const totalLine=[...n.matchAll(/(?:celkem(?: k uhrade)?|suma|k uhrade)[^\n]*/g)].map(x=>x[0]).filter(x=>!/(?:bez dph|eur)/.test(x)&&amountTokens(x).length).at(-1);
    const currencyLines=text.split('\n').filter(line=>/Kč|CZK/.test(line));
    const totalToken=totalLine?amountTokens(totalLine).at(-1):amountTokens(currencyLines.at(-1)??'').at(-1);
    if(totalToken)put('totalCents',totalToken.value,totalLine??currencyLines.at(-1));
    // Recap order is rate, base, VAT, total. Do not infer mixed VAT rates.
    const recapLines=text.split('\n').filter(line=>/^\s*(?:\(B\),?\s*)?(?:21(?:[,.]0)?|12(?:[,.]0)?)\s/.test(line));
    const rows=[];
    for(const line of recapLines){const numbers=amountTokens(line.replace(/^\s*(?:\(B\),?\s*)?(?:21(?:[,.]0)?|12(?:[,.]0)?)\s/,''));if(numbers.length>=3){const[base,tax,total]=numbers.slice(-3);if(base.value+tax.value===total.value){const rate=/^\s*(?:\(B\),?\s*)?21/.test(line)?21:12;if(!rows.some(r=>r.rate===rate&&r.baseCents===base.value&&r.vatCents===tax.value))rows.push({rate,baseCents:base.value,vatCents:tax.value});}}}
    if(rows.length){put('rows',rows,recapLines.join('\n'));if(kind==='receipt')put('totalCents',rows.reduce((sum,r)=>sum+r.baseCents+r.vatCents,0),recapLines.join('\n'),'vat-recap-total-proposal');}
    else if(kind==='invoice'&&fields.totalCents){
      const taxes=text.split('\n').filter(line=>/^\s*DPH\s+(?:21|12)\s*%/i.test(line));
      if(taxes.length===1){const tax=amountTokens(taxes[0]).at(-1),rate=taxes[0].includes('21')?21:12;if(tax&&tax.value<fields.totalCents)put('rows',[{rate,baseCents:fields.totalCents-tax.value,vatCents:tax.value}],taxes[0],'total-minus-stated-vat-proposal');}
    }
  }
  if(page.alternatives?.length){
    const candidates=page.alternatives.map(alternative=>extractDocument({...page,...alternative,alternatives:[]},source,profile));
    const score=d=>(d.kind!=='unknown'?2:0)+(d.fields.number?1:0)+(d.fields.date?1:0)+(d.fields.rows.length?10:0)+(d.fields.rows.length&&d.fields.rows.reduce((s,r)=>s+r.baseCents+r.vatCents,0)===d.fields.totalCents?5:0);
    const current={kind,fields,provenance,text,sourceRef,status:'draft'};
    return [current,...candidates].sort((a,b)=>score(b)-score(a))[0];
  }
  return {kind,fields,provenance,text,sourceRef,status:'draft'};
}
export function referenceProfile(forms){
  const p={},metrics=[];
  for(const form of forms??[]){
    const person=form.fields.find(f=>f.tag==='VetaP')?.attributes??{};
    const header=form.fields.find(f=>f.tag==='VetaD')?.attributes??{};
    const mapping={jmeno:'firstName',prijmeni:'lastName',dic:'dic',rod_c:'birthNumber',ulice:'street',c_pop:'houseNumber',c_orient:'orientationNumber',naz_obce:'city',psc:'postalCode',c_ufo:'taxOffice',c_pracufo:'taxOfficeBranch',email:'email'};
    for(const[k,v]of Object.entries(mapping))if(person[k])p[v]=person[k];
    if(header.c_ufo_cil)p.taxOffice=header.c_ufo_cil;
    const annual=form.fields.find(f=>f.tag==='VetaT')?.attributes;
    if(annual?.c_nace)p.nace=annual.c_nace;
    if(form.form==='DPFDP7')metrics.push({form:'DPFDP7',year:header.rok,income:annual?.kc_prij7,expenses:annual?.kc_vyd7,tax:header.kc_dan_celk,provenance:'reference-output-not-source-ledger'});
    if(form.form==='OSVC'){
      const head=form.fields.find(f=>f.tag==='prehledosvc')?.attributes??{};if(head.dep)p.csszOffice=head.dep;if(head.vsdp)p.socialVariableSymbol=head.vsdp;
    }
  }
  return {profile:p,metrics};
}
