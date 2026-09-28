import {money,periodKey} from './common.js';
import {deadlines} from './deadlines.js';
const crowns=n=>money(Math.round(n*100))+' Kč';
export function report(c,r,today){
  const lines=[`Účetní — ${c.kind==='monthly'?'DPH / kontrolní hlášení':'Roční přiznání OSVČ'} ${periodKey(c)}`,`Evidence: ${c.id}; revize ${c.revision}.`,r.status==='READY_FOR_EXPORT'?'Podklady prošly podporovanými věcnými kontrolami. XML ještě musí projít exportní validací.':'ROZPRACOVÁNO — chybí podklady nebo rozhodnutí.',''];
  if(r.kind==='monthly')lines.push(`DPH na výstupu: ${crowns(r.outputTax)}`,`Uplatněný odpočet: ${crowns(r.inputTax)}`,`Vlastní daň: ${crowns(r.due)}; nadměrný odpočet: ${crowns(r.refund)}`);
  else lines.push(`Příjmy přijaté v roce bez DPH: ${money(r.receivedIncomeCents)} Kč; řádek 101 v celých Kč: ${crowns(Math.round(r.income))}`,`Paušální výdaje: ${crowns(r.expenses)}`,`Základ §7: ${crowns(r.base)}`,`Odpočty: ${crowns(r.deductions)}`,`Sleva na poplatníka: ${crowns(r.taxpayerCredit)}; manžel/ka: ${crowns(r.spouseCredit)} (${r.spouseMonths.length} měsíců).`,`Zvýhodnění dětí: ${crowns(r.childCredit)}; bonus: ${crowns(r.bonus)}.`,`Daň po slevách: ${crowns(r.tax)}; zbývá zaplatit (+) / přeplatek nebo bonus (−): ${crowns(r.taxBalance)}.`,`ČSSZ: pojistné ${crowns(r.social)}; doplatek (+) / přeplatek (−) ${crowns(r.socialBalance)}.`,`OZP: pojistné ${crowns(r.health)}; doplatek (+) / přeplatek (−) ${crowns(r.healthBalance)}.`,`Nové zálohy po přehledech: ČSSZ ${crowns(r.newSocial)}, OZP ${crowns(r.newHealth)}.`,...(r.notes??[]));
  if(r.questions.length)lines.push('','Výše uvedené částky jsou pracovní výpočet z dosud potvrzených údajů.','Potřebuji doplnit:',...r.questions.map((q,i)=>`${i+1}. [${q.key}] ${q.title}`));
  lines.push('','Doklady:',...c.documents.map(d=>`${d.id} | ${d.status} | ${d.label} | ${d.fields?.number??''} | ${Number.isSafeInteger(d.fields?.totalCents)?money(d.fields.totalCents)+' Kč':''}${d.exclusionReason?' | '+d.exclusionReason:''}`));
  lines.push('','Termíny:',...deadlines(c,today).map(d=>`${d.due} | ${d.title} | ${d.status}${d.condition?' | '+d.condition:''}`),'','OVERDUE znamená, že termín uplynul a v této evidenci není potvrzení; netvrdí, že podání nebo platba ve skutečnosti neproběhly.','Přesnost XML ověřuje export. Podání úřadu ani připsání platby se nepotvrzuje vytvořením souboru.');
  return lines.join('\n');
}
export function declaration(c){
  const a=c.answers??{},s=a.spouse??{},p=c.profile??{};
  const lines=[`Čestné prohlášení za rok ${c.year} — návrh k ověření a podpisu`,'',`Já, ${s.firstName??'________'} ${s.lastName??'________'}, rodné číslo ${s.birthNumber??'________'},`, `manžel/ka ${p.firstName??'________'} ${p.lastName??'________'}, rodné číslo ${p.birthNumber??'________'},`, `prohlašuji, že mé vlastní příjmy započitatelné pro slevu na manžela/manželku za celý rok ${c.year} činily ${Number.isSafeInteger(s.annualIncomeCents)?money(s.annualIncomeCents)+' Kč':'________ Kč'}.`, 'Do příjmů byla zahrnuta peněžitá pomoc v mateřství; rodičovský příspěvek se nezahrnuje.',`Měsíce společně hospodařící domácnosti: ${(s.householdMonths??[]).join(', ')||'________'}.`,'','Děti a měsíce, za které druhý rodič neuplatňuje stejné zvýhodnění:'];
  for(const ch of a.children??[])lines.push(`${ch.firstName} ${ch.lastName}, rodné číslo ${ch.birthNumber}; měsíce: ${(ch.claims??[]).map(x=>x.month).join(', ')||'žádné'}.`);
  lines.push('','Výše uvedené údaje je třeba zkontrolovat. Tento návrh není podepsaným prohlášením.','V __________________ dne ______________','Podpis prohlašující osoby: __________________');return lines;
}
