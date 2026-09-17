import { commonChecklist, need, validDate, isDic, dic, periodKey, VAT_RULESET } from './common.js';

export function monthlyChecklist(c) {
  const q = commonChecklist(c), a = c.answers ?? {}, p = c.profile ?? {};
  if (![2025,2026].includes(c.year) || !Number.isInteger(c.month) || c.month < 1 || c.month > 12) need(q,'period','Podporované měsíční období je v letech 2025–2026.','unsupported');
  if (p.vatPayer !== true) need(q,'profile.vatPayer','Jsi pro toto období plátcem DPH?');
  if (a.domesticStandardOnly !== true) need(q,'domesticStandardOnly','Potvrď, že období obsahuje jen běžná tuzemská plnění v CZK, bez oprav, reverse charge, zahraničí, osvobození a krácených/poměrných odpočtů.');
  if (a.monthComplete !== true) need(q,'monthComplete','Jsou dodané všechny doklady a rozhodnutí pro tento měsíc, včetně dokladů dodaných účetní dříve?');
  for (const d of c.documents.filter(d => d.status === 'approved' && ['invoice','receipt'].includes(d.kind))) {
    const f = d.fields;
    if (!validDate(f.vatDate)) need(q,`document.${d.id}`,`${d.label}: doplň DUZP / datum povinnosti přiznat daň.`, 'document');
    if (f.direction === 'expense' && !validDate(f.receivedDate)) need(q,`document.${d.id}`,`${d.label}: doplň datum přijetí dokladu.`, 'document');
    if (f.direction === 'expense' && typeof f.claimVat !== 'boolean') need(q,`document.${d.id}`,`${d.label}: rozhodni, zda uplatnit plný nárok na odpočet, nebo jej neuplatnit.`, 'document');
    if (f.direction === 'expense' && f.claimVat === false && !f.vatDecisionReason?.trim()) need(q,`document.${d.id}`,`${d.label}: uveď důvod neuplatnění odpočtu.`, 'document');
    if (f.direction === 'income' && f.vatDate?.slice(0,7) !== periodKey(c)) need(q,`document.${d.id}`,`${d.label}: DUZP nepatří do zvoleného měsíce.`, 'document');
    if (f.direction === 'expense' && f.claimVat === true && (f.receivedDate?.slice(0,7) > periodKey(c) || f.vatDate?.slice(0,7) > periodKey(c))) need(q,`document.${d.id}`,`${d.label}: odpočet nelze uplatnit před přijetím dokladu/vznikem nároku.`, 'document');
    // Prior-year deductions need a separately verified time-limit/partial-claim path.
    if (f.direction === 'expense' && f.claimVat && f.vatDate?.slice(0,4) !== String(c.year)) need(q,`document.${d.id}`,`${d.label}: odpočet ze staršího roku potřebuje zvláštní kontrolu lhůty.`, 'unsupported');
    if (f.rows?.some(r=>r.rate === 0)) need(q,`document.${d.id}`,`${d.label}: nulová sazba/osvobození vyžaduje samostatný režim.`, 'unsupported');
    const partner = f.direction === 'income' ? f.customerDic : f.supplierDic;
    if (f.totalCents > 1000000 && f.direction === 'expense' && f.claimVat && !isDic(partner)) need(q,`document.${d.id}`,`${d.label}: chybí DIČ dodavatele pro B.2.`, 'document');
    if (partner && dic(partner) === dic(p.dic)) need(q,`document.${d.id}`,`${d.label}: partner má stejné DIČ jako poplatník.`, 'document');
    if (f.direction === 'income' && f.customerVatPayer === undefined) need(q,`document.${d.id}`,`${d.label}: potvrď, zda odběratel je tuzemský plátce DPH.`, 'document');
    if (f.direction === 'income' && f.customerVatPayer && !isDic(partner)) need(q,`document.${d.id}`,`${d.label}: doplň DIČ odběratele.`, 'document');
  }
  return q;
}
export function computeMonthly(c) {
  const questions = monthlyChecklist(c), rows = [], totals = { income:{21:{base:0,tax:0},12:{base:0,tax:0}},expense:{21:{base:0,tax:0},12:{base:0,tax:0}} };
  for (const d of c.documents.filter(d => d.status === 'approved' && ['invoice','receipt'].includes(d.kind))) {
    const f=d.fields;
    if (f.direction === 'expense' && f.claimVat !== true) continue;
    const section=f.direction==='income' ? (f.totalCents>1000000 && f.customerVatPayer===true?'A4':'A5') : (f.totalCents>1000000?'B2':'B3');
    rows.push({documentId:d.id,sourceId:d.sourceId,section,...f});
    for(const r of f.rows??[])if(totals[f.direction]?.[r.rate]){totals[f.direction][r.rate].base+=r.baseCents;totals[f.direction][r.rate].tax+=r.vatCents;}
  }
  const rounded=Object.fromEntries(Object.entries(totals).map(([side,rates])=>[side,Object.fromEntries(Object.entries(rates).map(([rate,x])=>[rate,{base:Math.round(x.base/100),tax:Math.round(x.tax/100)}]))]));
  const outputTax=rounded.income[21].tax+rounded.income[12].tax,inputTax=rounded.expense[21].tax+rounded.expense[12].tax;
  return {kind:'monthly',status:questions.length?'NEEDS_REVIEW':'READY_FOR_EXPORT',period:periodKey(c),ruleset:VAT_RULESET,questions,rows,totals,rounded,outputTax,inputTax,due:Math.max(0,outputTax-inputTax),refund:Math.max(0,inputTax-outputTax)};
}
