import { commonChecklist, need, requireEvidence, validDate, birthDateFromNumber, ratioRound, RULESET } from './common.js';

export const ANNUAL_FACTS = [
  ['cashBasis','Příjmy eviduješ podle skutečného přijetí peněz (daňová evidence / výdaje procentem)?','boolean'],
  ['expenseRate','Sazba výdajového paušálu podle druhu činnosti: 80, 60, 40 nebo 30 % (paušální výdaje nejsou paušální daň).','rate'],
  ['mainActivityAllYear','Šlo celý rok o hlavní OSVČ, bez přerušení, zaměstnání, důchodu, nemocenské a sníženého minima pro nově zahájenou činnost?','boolean'],
  ['sameInsurerAllYear','Byl/a jsi celý rok pojištěn/a u zvolené zdravotní pojišťovny, bez výjimky z minimálního vyměřovacího základu?','boolean'],
  ['czechTaxResident','Jsi pro celý rok českým daňovým rezidentem?','boolean'],
  ['sameMainActivity2026','Pokračuješ i v roce 2026 ve stejné hlavní činnosti, bez nové výjimky, snížení/zrušení záloh, souběhu či důchodu?','boolean'],
  ['onlyDomesticSelfEmployment','Byly příjmy jen z vlastní tuzemské činnosti §7 v CZK, bez zaměstnání, pronájmu, investic, zahraničí, spolupracujících osob, ztrát a úprav základu?','boolean'],
  ['children','Vyživované děti: jméno, příjmení, datum narození, rodné číslo, měsíce společné domácnosti a pořadí zvýhodnění v jednotlivých měsících. Prázdný seznam znamená žádné děti.','children'],
  ['claimSpouse','Chceš posoudit slevu na manželku/manžela?','boolean'],
  ['pension','Máš daňově uznatelné příspěvky na penzijní produkty?','boolean'],
  ['lifeInsurance','Máš daňově uznatelné životní pojištění?','boolean'],
  ['dip','Máš daňově podporovaný dlouhodobý investiční produkt (DIP)?','boolean'],
  ['longTermCare','Máš daňově podporované pojištění dlouhodobé péče?','boolean'],
  ['gifts','Poskytl/a jsi odčitatelné dary, včetně bezpříspěvkového darování krve?','boolean'],
  ['mortgage','Uplatňuješ úroky z úvěru na vlastní bydlení?','boolean'],
  ['disability','Uplatňuješ slevu na invaliditu nebo ZTP/P?','boolean'],
  ['taxAdvances','Zaplacené zálohy na daň z příjmů za rok (Kč; i nulu je třeba potvrdit).','money'],
  ['socialAdvances','Zálohy na důchodové pojištění přiřazené ČSSZ k tomuto roku (Kč).','money'],
  ['healthAdvances','Zálohy na zdravotní pojištění přiřazené zdravotní pojišťovnou k tomuto roku (Kč).','money'],
  ['incomeComplete','Jsou doložené všechny příjmy/úhrady v roce, včetně starších faktur, hotovosti a prosincových pohledávek?','boolean'],
  ['boundaryInvoices','Jsou prověřené faktury z prosince předchozího roku a ledna tohoto roku i jejich skutečné úhrady?','boolean'],
  ['filingMode','Plán podání: do základní lhůty, elektronicky po základní lhůtě, nebo poradcem po základní lhůtě?','filingMode'],
];
export const DEDUCTIONS = {pension:'penzijní produkty',lifeInsurance:'životní pojištění',dip:'DIP',longTermCare:'pojištění dlouhodobé péče',gifts:'dary',mortgage:'úroky na bydlení'};
const validMonths = v => Array.isArray(v) && v.length<=12 && v.every(m=>Number.isInteger(m)&&m>=1&&m<=12) && new Set(v).size===v.length;
export function socialAdvance2026(base,date) {
  const minimum=date<'2026-07-01'?19587:17139;
  const baseCents=Math.round(base*100),raw=BigInt(baseCents)*55n;
  const monthlyBase=Math.min(195868,Math.max(minimum,Number((raw+119999n)/120000n)));
  return {base:monthlyBase,amount:Math.ceil(monthlyBase*292/1000)};
}
export function spouseEligibleMonths(a,year) {
  const s=a.spouse;
  if (!s || !validDate(s.marriedSince) || !validMonths(s.householdMonths) || !Number.isSafeInteger(s.annualIncomeCents) || s.annualIncomeCents>6800000 || s.annualIncomeCents<0) return [];
  return s.householdMonths.filter(month=>{
    const start=`${year}-${String(month).padStart(2,'0')}-01`;
    return s.marriedSince<=start && (a.children??[]).some(ch=>{
      if(!validDate(ch.birthDate)||!validMonths(ch.householdMonths))return false;
      const thirdBirthday=`${Number(ch.birthDate.slice(0,4))+3}${ch.birthDate.slice(4)}`;
      return ch.birthDate<=start && start<thirdBirthday && ch.householdMonths.includes(month);
    });
  }).sort((a,b)=>a-b);
}
export function annualChecklist(c) {
  const q=commonChecklist(c),a=c.answers??{};
  if(c.year!==2025)need(q,'year','Roční formuláře a pravidla jsou zatím ověřené pro rok 2025.','unsupported');
  for(const [key,title,type]of ANNUAL_FACTS)if(a[key]===undefined||a[key]===null)need(q,key,title,type);
  for(const key of ['cashBasis','mainActivityAllYear','onlyDomesticSelfEmployment','sameInsurerAllYear','czechTaxResident','sameMainActivity2026'])if(a[key]===false)need(q,key,'Tento režim vyžaduje další účetní výpočet; automatický export se zastavil: '+ANNUAL_FACTS.find(x=>x[0]===key)[1],'unsupported');
  if(a.expenseRate!==undefined&&![30,40,60,80].includes(a.expenseRate))need(q,'expenseRate','Potřebná je sazba paušálu 30/40/60/80; skutečné výdaje mají vlastní režim.','unsupported');
  if(a.incomeComplete===false)need(q,'incomeComplete','Doplň dosud chybějící příjmy a podklady k úhradám.');
  if(a.boundaryInvoices===false)need(q,'boundaryInvoices','Dodej prosincovou fakturu předchozího roku, lednovou fakturu a jejich úhrady, nebo potvrď, že nevznikly.');
  if(a.disability===true)need(q,'disability','Dolož rozhodnutí o invaliditě/ZTP/P; tento zvláštní výpočet zatím vyžaduje účetní kontrolu.','unsupported');
  if(!c.profile.birthNumber)need(q,'profile.birthNumber','Rodné číslo poplatníka (ukládá se jen lokálně).','text');
  else if(!birthDateFromNumber(c.profile.birthNumber))need(q,'profile.birthNumber','Zkontroluj rodné číslo a datum narození.','text');
  if(!c.profile.nace)need(q,'profile.nace','Kód převažující ekonomické činnosti CZ-NACE.','text');
  if(!c.profile.csszOffice)need(q,'profile.csszOffice','Číslo příslušné OSSZ/PSSZ/MSSZ.','text');
  if(!c.profile.socialVariableSymbol)need(q,'profile.socialVariableSymbol','Variabilní symbol přidělený ČSSZ.','text');
  if(!c.profile.healthInsurer)need(q,'profile.healthInsurer','Kód zdravotní pojišťovny (např. OZP 207).','text');
  else if(c.profile.healthInsurer!=='207')need(q,'profile.healthInsurer','Tiskový formulář je zatím připraven pro OZP 207; jiná pojišťovna potřebuje vlastní formulář.','unsupported');
  for(const key of ['taxAdvances','socialAdvances','healthAdvances']) {
    if(a[key]!==undefined&&(!Number.isSafeInteger(a[key])||a[key]<0))need(q,key,'Zálohy musí být nezáporná částka.','money');
    if(a[key]!==undefined)requireEvidence(c,q,key+'Evidence',`Dolož přehled zaplacených záloh: ${key==='socialAdvances'?'ČSSZ':key==='healthAdvances'?'zdravotní pojišťovna':'daň z příjmů (nebo potvrzení nulových záloh)'}.`);
  }
  if(a.children!==undefined) {
    if(!Array.isArray(a.children)||a.children.length>15)need(q,'children','Zkontroluj seznam dětí.','children');
    else {
      const ids=new Set(), slots=new Set();
      for(const ch of a.children) {
        if(!ch.firstName||!ch.lastName||!/^\d{9,10}$/.test(String(ch.birthNumber??'').replace('/',''))||!validDate(ch.birthDate)||!validMonths(ch.householdMonths)||!Array.isArray(ch.claims)) {need(q,'children','Doplň identitu dětí, narození, domácnost a měsíce zvýhodnění.','children');continue;}
        if(birthDateFromNumber(ch.birthNumber)!==ch.birthDate)need(q,'children','Datum narození dítěte neodpovídá rodnému číslu.','children');
        const rc=String(ch.birthNumber).replace('/','');if(ids.has(rc))need(q,'children','Stejné dítě je uvedeno vícekrát.','children');ids.add(rc);
        const cm=new Set();
        for(const claim of ch.claims) {
          const key=`${claim.month}:${claim.order}`, end=`${c.year}-${String(claim.month).padStart(2,'0')}-31`;
          if(!Number.isInteger(claim.month)||!ch.householdMonths.includes(claim.month)||![1,2,3].includes(claim.order)||cm.has(claim.month)||(claim.order<3&&slots.has(key))||ch.birthDate>end||Number(ch.birthDate.slice(0,4))+18<=c.year)need(q,'children','Oprav měsíce/pořadí dětí; zletilé dítě potřebuje samostatné doložení nároku.','children');
          cm.add(claim.month);slots.add(key);
        }
      }
      if(a.children.some(ch=>ch.ztpP!==false))need(q,'children','U dětí potvrď stav ZTP/P; zvýšené zvýhodnění zatím potřebuje samostatnou kontrolu.','children');
      if(a.children.some(ch=>ch.claims?.length))requireEvidence(c,q,'childrenEvidence','Dolož, že druhý rodič neuplatňuje stejné dítě ve stejných měsících (potvrzení zaměstnavatele / prohlášení).');
    }
  }
  if(a.claimSpouse===true) {
    const s=a.spouse;
    if(!s?.firstName||!s.lastName||!birthDateFromNumber(s.birthNumber)||!validDate(s.marriedSince)||!validMonths(s.householdMonths)||!Number.isSafeInteger(s.annualIncomeCents)||s.ztpP!==false)need(q,'spouse','Doplň manžela/manželku: identita, datum sňatku, měsíce společné domácnosti a vlastní příjmy za CELÝ rok. PPM se započítává, rodičovský příspěvek ne. ZTP/P potřebuje zvláštní kontrolu.','spouse');
    else if(spouseEligibleMonths(a,c.year).length)requireEvidence(c,q,'spouseEvidence','Dolož podepsané čestné prohlášení o celoročních příjmech manželky/manžela a domácnosti.');
  }
  for(const [key,label]of Object.entries(DEDUCTIONS))if(a[key]===true){
    requireEvidence(c,q,key+'Evidence',`Dodej potvrzení: ${label}.`);
    if(!Number.isSafeInteger(a[key+'Amount'])||a[key+'Amount']<0)need(q,key+'Amount',`Daňově odčitatelná částka z potvrzení (${label}), nikoli všechny platby produktu.`, 'money');
    if(a[key+'Eligible']!==true)need(q,key+'Eligible',`Potvrď, že jsou splněny podmínky odpočtu pro ${label}, včetně vlastnictví produktu, účelu a případného předčasného ukončení.`);
  }
  if(a.mortgage===true&&!['before2021','from2021'].includes(a.housingNeedAcquired))need(q,'housingNeedAcquired','Byla bytová potřeba obstarána před 1. 1. 2021, nebo od tohoto dne?','housing');
  if(a.mortgage===true&&a.mortgageHouseholdAllocationConfirmed!==true)need(q,'mortgageHouseholdAllocationConfirmed','Potvrď rozdělení úroků mezi oprávněné osoby a společný limit domácnosti.');
  if(a.mortgage===true&&(!Number.isInteger(a.mortgageMonths)||a.mortgageMonths<1||a.mortgageMonths>12))need(q,'mortgageMonths','Za kolik měsíců roku byly placeny úroky (1–12)? Limit se při části roku krátí.', 'integer');
  for(const d of c.documents.filter(d=>d.status==='approved'&&['invoice','receipt'].includes(d.kind)&&d.fields.direction==='income')) {
    const f=d.fields;
    if(!['paid','unpaid','partial'].includes(f.paymentStatus))need(q,`payment.${d.id}`,`${d.label}: dolož skutečné úhrady; datum splatnosti není datum přijetí peněz.`, 'payment');
    const payments=f.payments??[];
    if(f.paymentStatus==='unpaid'&&payments.length)need(q,`payment.${d.id}`,`${d.label}: neuhrazený doklad obsahuje platbu.`, 'payment');
    if(['paid','partial'].includes(f.paymentStatus)&&!payments.length)need(q,`payment.${d.id}`,`${d.label}: chybí rozpis plateb.`, 'payment');
    for(const payment of payments)if(!validDate(payment.date)||!Number.isSafeInteger(payment.amountCents)||payment.amountCents<=0||!c.documents.some(e=>e.id===payment.evidenceId&&e.status==='approved'&&e.kind==='support'))need(q,`payment.${d.id}`,`${d.label}: každá platba potřebuje datum, částku a doložený výpis/pokladní doklad.`, 'payment');
    const paid=payments.reduce((s,p)=>s+p.amountCents,0);
    if(paid>f.totalCents||(f.paymentStatus==='paid'&&paid!==f.totalCents)||(f.paymentStatus==='partial'&&paid>=f.totalCents))need(q,`payment.${d.id}`,`${d.label}: úhrady nesouhlasí s částkou/status dokladu.`, 'payment');
  }
  return q;
}
export function computeAnnual(c,asOf='2026-09-12') {
  const questions=annualChecklist(c),a=c.answers??{},paymentRows=[];
  if(!validDate(asOf)||!asOf.startsWith('2026-'))need(questions,'rulesValidity','Následné zálohy a export tohoto pravidlového balíčku jsou ověřené jen pro rok 2026; je nutná aktualizace pravidel.','unsupported');
  let incomeCents=0;
  for(const d of c.documents.filter(d=>d.status==='approved'&&['invoice','receipt'].includes(d.kind)&&d.fields.direction==='income')) {
    const f=d.fields,net=(f.rows??[]).reduce((sum,r)=>sum+r.baseCents,0);let received=0,previousNet=0;
    // Allocate VAT proportionally across all receipts in chronological order;
    // differences of rounded cumulative sums conserve the invoice net exactly.
    for(const payment of [...f.payments??[]].sort((x,y)=>x.date.localeCompare(y.date))){received+=payment.amountCents;const cumulative=ratioRound(net,received,f.totalCents),netPart=cumulative-previousNet;previousNet=cumulative;if(payment.date.slice(0,4)===String(c.year)){incomeCents+=netPart;paymentRows.push({documentId:d.id,number:f.number,date:payment.date,grossCents:payment.amountCents,netCents:netPart,evidenceId:payment.evidenceId});}}
  }
  const rate=[30,40,60,80].includes(a.expenseRate)?a.expenseRate:0;
  const expensesCents=Math.min(ratioRound(incomeCents,rate,100),2000000*rate),baseCents=Math.max(0,incomeCents-expensesCents);
  const income=incomeCents/100,expenses=expensesCents/100,base=baseCents/100;
  const claimed={};let sharedLimit=48000;
  for(const key of ['pension','lifeInsurance','dip','longTermCare']){claimed[key]=a[key]===true?Math.min(Math.max(0,(a[key+'Amount']??0)/100),sharedLimit):0;sharedLimit-=claimed[key];}
  const gifts=a.giftsAmount??0;claimed.gifts=a.gifts&&(gifts>=100000||gifts*100>baseCents*2)?Math.min(gifts,ratioRound(baseCents,30,100))/100:0;
  claimed.mortgage=a.mortgage?Math.min((a.mortgageAmount??0)/100,(a.housingNeedAcquired==='before2021'?300000:150000)*(a.mortgageMonths??0)/12):0;
  const deductionCents=Object.values(claimed).reduce((x,y)=>x+Math.round(y*100),0),deductions=deductionCents/100,afterCents=Math.max(0,baseCents-deductionCents),afterDeduction=afterCents/100,roundedBase=Math.floor(afterCents/10000)*100;
  // EPO fields use whole crowns. If their projection changes arithmetic or a
  // tax threshold, require a rounding reconciliation instead of exporting a
  // mathematically inconsistent return. Keep the exact ledger calculation.
  if(Math.round(income)-Math.round(expenses)!==Math.round(base)||Math.max(0,Math.round(base)-Object.values(claimed).reduce((s,v)=>s+Math.round(v),0))!==Math.round(afterDeduction)||Math.floor(Math.round(afterDeduction)/100)*100!==roundedBase)need(questions,'roundingReview','Haléřové mezivýpočty se liší od návazností celokorunových řádků formuláře. Je nutné účetní odsouhlasení zaokrouhlení; XML se zatím nevytvoří.','unsupported');
  const rawTax=Math.ceil((Math.min(roundedBase,1676052)*15+Math.max(0,roundedBase-1676052)*23)/100);
  const spouseMonths=a.claimSpouse?spouseEligibleMonths(a,c.year):[],spouseCredit=spouseMonths.length*2070,taxpayerCredit=30840;
  const afterCredits=Math.max(0,rawTax-taxpayerCredit-spouseCredit);
  const childCredit=(Array.isArray(a.children)?a.children:[]).reduce((sum,ch)=>sum+(ch.claims??[]).reduce((s,x)=>s+({1:1267,2:1860,3:2320}[x.order]??0),0),0);
  const childTaxCredit=Math.min(afterCredits,childCredit),potentialBonus=Math.max(0,childCredit-afterCredits),bonus=incomeCents>=12480000&&potentialBonus>=100?potentialBonus:0;
  const tax=Math.max(0,afterCredits-childTaxCredit),taxBalance=tax-bonus-(a.taxAdvances??0)/100;
  const insuranceTaxBase=Math.round(base),socialBase=Math.min(2234736,Math.max(195540,Math.ceil(insuranceTaxBase*.55))),social=Math.ceil(socialBase*292/1000);
  const healthBase=Math.max(insuranceTaxBase*.5,279342),health=Math.ceil(healthBase*135/1000);
  const nextSocial=socialAdvance2026(insuranceTaxBase,asOf),newSocialBase=nextSocial.base,newSocial=nextSocial.amount,newHealth=Math.max(3306,Math.ceil(insuranceTaxBase*.5/12*135/1000));
  if(taxBalance<0||social-(a.socialAdvances??0)/100<0||health-(a.healthAdvances??0)/100<0)need(questions,'refundDisposition','Výpočet obsahuje přeplatek nebo daňový bonus. Pro finální export je nutné doplnit žádost o vrácení či použití přeplatku a ověřené platební údaje; tento formulářový krok zatím vyžaduje účetní kontrolu.','unsupported');
  const notes=[];
  if(a.claimSpouse&&!spouseMonths.length&&a.spouse)notes.push('Sleva na manžela/manželku nevyšla: ověř celoroční příjem, sňatek a společnou domácnost s dítětem do 3 let k prvnímu dni měsíce.');
  if(rate&&income>2000000)notes.push('Výdajový paušál dosáhl zákonného stropu; další příjem už paušální výdaje nezvyšuje.');
  if(sharedLimit===0)notes.push('Produkty na stáří a dlouhodobou péči společně dosáhly limitu 48 000 Kč.');
  return {kind:'annual',status:questions.length?'NEEDS_REVIEW':'READY_FOR_EXPORT',year:c.year,ruleset:RULESET,questions,notes,paymentRows,receivedIncomeCents:incomeCents,income,expenses,base,claimed,deductions,afterDeduction,roundedBase,rawTax,taxpayerCredit,spouseCredit,spouseMonths,childCredit,childTaxCredit,bonus,tax,taxBalance,insuranceTaxBase,socialBase,social,socialBalance:social-(a.socialAdvances??0)/100,healthBase,health,healthBalance:health-(a.healthAdvances??0)/100,newSocialBase,newSocial,newHealth};
}
