// AccountingWorkflow@1: pure domain functions; files, OCR and export belong to the host.
export const RULESET = 'cz-osvc-2025-v1_2026-09-12';
export const VAT_RULESET = 'cz-domestic-vat-2025-2026-v1_2026-09-12';
export const money = n => (n / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Round a nonnegative rational directly once; large invoice products stay exact.
export function ratioRound(value, numerator, denominator) {
  if (![value,numerator,denominator].every(Number.isSafeInteger) || value<0 || numerator<0 || denominator<=0) throw new Error('Neplatný poměr částek.');
  const product=BigInt(value)*BigInt(numerator), divisor=BigInt(denominator);
  const result=Number((product*2n+divisor)/(2n*divisor));
  if(!Number.isSafeInteger(result))throw new Error('Součet částek je mimo bezpečný rozsah.');
  return result;
}
export function cents(value) {
  const s = String(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(s)) throw new Error('Částka musí mít nejvýše dvě desetinná místa.');
  const negative = s.startsWith('-'), [whole, decimals = ''] = s.replace('-', '').split('.');
  const n = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('Částka je mimo rozsah.');
  return negative ? -n : n;
}
export function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}
export const periodKey = c => c.kind === 'monthly' ? `${c.year}-${String(c.month).padStart(2, '0')}` : String(c.year);
export const dic = value => String(value ?? '').replace(/^CZ/i, '').replace(/\s/g, '');
export const isDic = value => /^\d{8,10}$/.test(dic(value));
export function birthDateFromNumber(value) {
  const rc=String(value??'').replace('/','');if(!/^\d{9,10}$/.test(rc))return null;
  let year=Number(rc.slice(0,2)),month=Number(rc.slice(2,4));
  year+=(rc.length===9||year>=54)?1900:2000;if(month>70)month-=70;else if(month>50)month-=50;else if(month>20)month-=20;
  const date=`${year}-${String(month).padStart(2,'0')}-${rc.slice(4,6)}`;return validDate(date)?date:null;
}
export const question = (key, title, type = 'boolean', extra = {}) => ({ key, title, type, ...extra });
export const need = (items, key, title, type = 'boolean', extra = {}) => items.push(question(key, title, type, extra));
export function validateDocument(d) {
  const f = d.fields ?? {}, errors = [];
  if (!['invoice', 'receipt'].includes(d.kind)) return errors;
  if (!f.number?.trim()) errors.push('číslo dokladu');
  if (!validDate(f.date)) errors.push('datum vystavení');
  if (!['income', 'expense'].includes(f.direction)) errors.push('vydaný / přijatý doklad');
  if (f.currency !== 'CZK') errors.push('podporována je zatím jen měna CZK');
  if (!Number.isSafeInteger(f.totalCents) || f.totalCents <= 0) errors.push('kladná celková částka');
  if (!Array.isArray(f.rows) || !f.rows.length) errors.push('rekapitulace základů a DPH');
  else {
    for (const r of f.rows) {
      if (![0, 12, 21].includes(r.rate) || !Number.isSafeInteger(r.baseCents) || !Number.isSafeInteger(r.vatCents) || r.baseCents < 0 || r.vatCents < 0) errors.push('platná rekapitulace sazeb');
      else if (Math.abs(Math.round(r.baseCents * r.rate / 100) - r.vatCents) > 100) errors.push('nesoulad základu a daně');
    }
    if (f.rows.reduce((sum, r) => sum + r.baseCents + r.vatCents, 0) !== f.totalCents) errors.push('součet základů a DPH neodpovídá celku');
  }
  return [...new Set(errors)];
}
export function commonChecklist(c) {
  const q = [], p = c.profile ?? {};
  for (const [key, title] of Object.entries({firstName:'Jméno poplatníka',lastName:'Příjmení poplatníka',dic:'DIČ poplatníka (nikoli IČO)',taxOffice:'Číslo finančního úřadu',taxOfficeBranch:'Číslo územního pracoviště',street:'Ulice',houseNumber:'Číslo domu',city:'Obec',postalCode:'PSČ'})) {
    if (!String(p[key] ?? '').trim()) need(q, 'profile.' + key, title, 'text');
  }
  if (p.dic && !isDic(p.dic)) need(q, 'profile.dic', 'Oprav DIČ poplatníka.', 'text');
  for(const [key,pattern]of [['taxOffice',/^\d{1,3}$/],['taxOfficeBranch',/^\d{1,4}$/],['postalCode',/^\d{5}$/]])if(p[key]&&!pattern.test(p[key]))need(q,'profile.'+key,'Oprav formát údaje '+key+'.','text');
  if (p.confirmed !== true) need(q, 'profile.confirmed', 'Potvrď totožnost a adresu poplatníka v zobrazeném profilu.');
  if (!c.sources?.length) need(q, 'sources', 'Dodej zdrojové doklady nebo výslovně dolož prázdné období.', 'material');
  for (const d of c.documents ?? []) {
    if (d.status === 'excluded' && d.exclusionReason?.trim()) continue;
    if (d.status !== 'approved') need(q, `document.${d.id}`, `Zkontroluj ${d.label}: ${d.kind === 'unknown' ? 'urči druh podkladu' : 'potvrď vytěžené údaje'}.`, 'document');
    else if (validateDocument(d).length) need(q, `document.${d.id}`, `${d.label}: ${validateDocument(d).join(', ')}.`, 'document');
  }
  const seen = new Map();
  for (const d of (c.documents ?? []).filter(d => d.status === 'approved' && ['invoice','receipt'].includes(d.kind))) {
    const f = d.fields, key = [f.direction, dic(f.supplierDic), f.number, f.date, f.totalCents].join('|');
    if((f.direction==='income'&&dic(f.supplierDic)!==dic(p.dic))||(f.direction==='expense'&&f.customerDic&&dic(f.customerDic)!==dic(p.dic)))need(q,`document.${d.id}`,`${d.label}: DIČ vlastníka neodpovídá profilu poplatníka.`, 'document');
    if (seen.has(key)) need(q, `duplicate.${d.id}`, `Možná duplicita ${d.label} a ${seen.get(key)}; rozhodni o vyřazení.`, 'document');
    else seen.set(key, d.label);
  }
  return q;
}
export function requireEvidence(c, q, key, title) {
  const value = c.answers?.[key];
  if (!value || !c.documents.some(d => d.id === value && d.status === 'approved' && d.kind === 'support')) need(q, key, title, 'evidence');
}
export function rejectUnknownKeys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k => !allowed.includes(k))) throw new Error('Neznámá pole vstupu.');
}
