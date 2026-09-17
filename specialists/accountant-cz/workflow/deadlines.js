import {validDate,periodKey} from './common.js';
import {computeAnnual,socialAdvance2026} from './annual.js';
export function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function businessDate(date) {
  for(let n=0;n<10;n++,date=addDays(date,1)){
    const d=new Date(date+'T12:00:00Z'),year=d.getUTCFullYear(),holy=['01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26'];
    if(![0,6].includes(d.getUTCDay())&&!holy.includes(date.slice(5))&&date!==addDays(easter(year),-2)&&date!==addDays(easter(year),1))return date;
  }
  throw new Error('DEADLINE_INVALID');
}
export function deadlines(c,today) {
  if(!validDate(today))throw new Error('Neplatné datum kontroly termínů.');
  const rows=[],filings=c.filings??{};
  const add=(id,title,due,condition=null,amount=null)=>{
    const completed=filings[id]?.date;
    rows.push({id,title,amount,due,condition,completed:completed??null,status:completed?'RECORDED':condition?'CONDITIONAL':today>due?'OVERDUE':today>=addDays(due,-14)?'DUE_SOON':'UPCOMING'});
  };
  if(c.kind==='monthly'){
    const next=new Date(Date.UTC(c.year,c.month,25)).toISOString().slice(0,10),due=businessDate(next);
    for(const[id,title]of [['kh','Kontrolní hlášení'],['vat','Přiznání DPH'],['vatPayment','Platba DPH podle výsledku']])add(id,`${title} ${periodKey(c)}`,due);
  }else if(c.year===2025){
    const result=computeAnnual(c,today),ready=result.status==='READY_FOR_EXPORT'&&!c.sources.some(s=>s.coverageReviewRequired&&c.answers['coverage.'+s.id]!==true);
    let mode=c.answers?.filingMode;
    if(filings.dpfo?.date&&filings.dpfo.date<='2026-04-01')mode='basic';
    const dates={basic:['2026-04-01','2026-05-04'],electronic:['2026-05-04','2026-06-04'],advisor:['2026-07-01','2026-08-03']};
    for(const key of mode?[mode]:Object.keys(dates)){
      if(!dates[key])continue;
      const [tax,overview]=dates[key],condition=mode?null:({basic:'Podání do 1. 4. 2026 včetně elektronického',electronic:'Elektronické podání až po 1. 4. 2026',advisor:'Podání poradcem až po 1. 4. 2026'}[key]);
      add('dpfo','Přiznání k dani z příjmů za 2025',tax,condition);add('taxPayment','Doplatek daně za 2025',tax,condition);
      for(const [id,title]of [['cssz','Přehled ČSSZ'],['health','Přehled OZP']]){
        add(id,title,overview,condition);
        const actual=filings[id]?.date,base=actual&&actual<overview?actual:overview;
        add(id+'Payment',`Doplatek ${id==='cssz'?'ČSSZ':'OZP'} (do 8 dnů od skutečného nebo nejzazšího podání)`,businessDate(addDays(base,8)),condition??(actual?null:'Termín se při dřívějším skutečném podání posune.'));
        if(ready){
          const first=Number(base.slice(5,7))+(id==='cssz'?1:0),why=condition??(!actual?'Pracovní plán podle nejzazšího podání; doplň skutečné datum přehledu.':null);
          for(let m=first;m<=12;m++){
            const period=`2026-${String(m).padStart(2,'0')}`,due=id==='cssz'?new Date(Date.UTC(2026,m,0)).toISOString().slice(0,10):new Date(Date.UTC(2026,m,8)).toISOString().slice(0,10),amount=id==='cssz'?socialAdvance2026(result.insuranceTaxBase,period+'-01').amount:result.newHealth;
            add(`${id}Advance-${period}`,`Záloha ${id==='cssz'?'ČSSZ':'OZP'} za ${period}: ${amount} Kč`,businessDate(due),why,amount);
          }
        }
      }
      if(ready&&result.tax>30000){
        const taxMonths=result.tax>150000?[3,6,9,12]:[6,12],amount=Math.ceil(result.tax*(result.tax>150000?.25:.4)/100)*100,start=filings.dpfo?.date&&filings.dpfo.date>tax?filings.dpfo.date:tax;
        for(const m of taxMonths){const due=businessDate(`2026-${String(m).padStart(2,'0')}-15`);if(due>start)add(`taxAdvance-2026-${m}`,`Záloha na daň z příjmů: ${amount} Kč`,due,condition??(!filings.dpfo?'Částka z pracovního přiznání; potvrď skutečné podání a případné odlišné rozhodnutí správce daně.':null),amount);}
      }
    }
  }
  return rows;
}
export function calendar(c,rows,generatedAt){
  const escape=s=>String(s).replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//IntentSmith//Ucetni//CS','CALSCALE:GREGORIAN'];
  for(const r of rows.filter(r=>!r.condition&&!r.completed))lines.push('BEGIN:VEVENT',`UID:${c.id}-${r.id}@ucetni.local`,`DTSTAMP:${generatedAt.replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')}`,`DTSTART;VALUE=DATE:${r.due.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(r.due,1).replaceAll('-','')}`,`SUMMARY:${escape(r.title)}`,'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY',`DESCRIPTION:${escape(r.title)}`,'END:VALARM','END:VEVENT');
  lines.push('END:VCALENDAR');return lines.join('\r\n')+'\r\n';
}
