import {dic,birthDateFromNumber} from './common.js';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export const xmlElement=(name,attrs={},body=null)=>`<${name}${Object.entries(attrs).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>` ${k}="${esc(v)}"`).join('')}${body===null?'/>':`>${body}</${name}>`}`;
const tag=(name,value)=>xmlElement(name,{},esc(value??''));
const dateCZ=s=>s?.split('-').reverse().join('.');
const dec=c=>(c/100).toFixed(2);
const wrap=(name,body)=>'<?xml version="1.0" encoding="UTF-8"?>\n'+xmlElement('Pisemnost',{nazevSW:'IntentSmith Ucetni',verzeSW:'1.0'},xmlElement(name,{},body))+'\n';
function identity(p,annual=false){
  const result={dic:dic(p.dic),jmeno:p.firstName,prijmeni:p.lastName,ulice:p.street,c_pop:p.houseNumber,c_orient:p.orientationNumber,naz_obce:p.city,psc:p.postalCode,stat:'ČESKÁ REPUBLIKA',c_pracufo:p.taxOfficeBranch,email:p.email};
  if(annual)Object.assign(result,{rod_c:String(p.birthNumber??'').replace('/',''),st_prislus:'ČESKÁ REPUBLIKA'});
  else Object.assign(result,{typ_ds:'F',c_ufo:p.taxOffice});
  return result;
}
export function monthlyForms(c,r,date){
  if(r.status!=='READY_FOR_EXPORT')throw new Error('EXPORT_NEEDS_REVIEW');
  const D={k_uladis:'DPH',rok:c.year,mesic:c.month,d_poddp:dateCZ(date)},P=xmlElement('VetaP',identity(c.profile));
  let kh=xmlElement('VetaD',{...D,dokument:'KH1',khdph_forma:'B'})+P;
  for(const section of ['A4','A5','B2','B3']){
    const rows=r.rows.filter(x=>x.section===section),aggregate={};
    for(const row of rows){
      const amounts={};for(const line of row.rows){const suffix=line.rate===21?'1':'2';amounts['zakl_dane'+suffix]=(amounts['zakl_dane'+suffix]??0)+line.baseCents;amounts['dan'+suffix]=(amounts['dan'+suffix]??0)+line.vatCents;}
      if(['A5','B3'].includes(section)){for(const[k,v]of Object.entries(amounts))aggregate[k]=(aggregate[k]??0)+v;continue;}
      const attrs={c_evid_dd:row.number,dppd:dateCZ(row.vatDate),zdph_44:'N',...Object.fromEntries(Object.entries(amounts).map(([k,v])=>[k,dec(v)]))};
      if(section==='A4')Object.assign(attrs,{dic_odb:dic(row.customerDic),kod_rezim_pl:'0'});else Object.assign(attrs,{dic_dod:dic(row.supplierDic),pomer:'N'});
      kh+=xmlElement('Veta'+section,attrs);
    }
    if(rows.length&&['A5','B3'].includes(section))kh+=xmlElement('Veta'+section,Object.fromEntries(Object.entries(aggregate).map(([k,v])=>[k,dec(v)])));
  }
  kh+=xmlElement('VetaC',{obrat23:dec(r.totals.income[21].base),obrat5:dec(r.totals.income[12].base),pln23:dec(r.totals.expense[21].base),pln5:dec(r.totals.expense[12].base)});
  let vat=xmlElement('VetaD',{...D,dokument:'DP3',dapdph_forma:'B',typ_platce:'P',c_okec:c.profile.nace})+P;
  vat+=xmlElement('Veta1',{obrat23:r.rounded.income[21].base,dan23:r.rounded.income[21].tax,obrat5:r.rounded.income[12].base,dan5:r.rounded.income[12].tax});
  vat+=xmlElement('Veta4',{pln23:r.rounded.expense[21].base,odp_tuz23_nar:r.rounded.expense[21].tax,pln5:r.rounded.expense[12].base,odp_tuz5_nar:r.rounded.expense[12].tax,odp_sum_nar:r.inputTax});
  vat+=xmlElement('Veta6',{dan_zocelk:r.outputTax,odp_zocelk:r.inputTax,dano_da:r.due,dano_no:r.refund});
  return [{name:`DPHKH-${r.period}.xml`,schema:'dphkh1.xsd',xml:wrap('DPHKH1',kh)},{name:`DPHDP-${r.period}.xml`,schema:'dphdp3.xsd',xml:wrap('DPHDP3',vat)}];
}
export function annualForms(c,r,date){
  if(r.status!=='READY_FOR_EXPORT')throw new Error('EXPORT_NEEDS_REVIEW');
  const p=c.profile,a=c.answers,round=n=>Math.round(n),spouse=a.spouse;
  const D={rok:c.year,dokument:'DP7',k_uladis:'DPF',dap_typ:'B',audit:'N',pln_moc:a.filingMode==='advisor'?'A':'N',c_ufo_cil:p.taxOffice,zdobd_od:`01.01.${c.year}`,zdobd_do:`31.12.${c.year}`,kc_op15_1a:r.taxpayerCredit,kc_op15_1c:r.spouseCredit,uhrn_slevy35ba:r.taxpayerCredit+r.spouseCredit,da_slevy35ba:Math.max(0,r.rawTax-r.taxpayerCredit-r.spouseCredit),kc_dazvyhod:r.childCredit,kc_slevy35c:r.childTaxCredit,da_slevy35c:r.tax,kc_danbonus:r.bonus,kc_dan_celk:r.tax,kc_dan_po_db:r.tax,kc_zbyvpred:round(r.taxBalance),kc_zalpred:round(a.taxAdvances/100),kc_db_po_odpd:r.bonus,m_vyzmanzl:r.spouseMonths.length};
  if(r.spouseCredit)Object.assign(D,{manz_jmeno:spouse.firstName,manz_prijmeni:spouse.lastName,manz_r_cislo:spouse.birthNumber.replace('/','')});
  let out=xmlElement('VetaD',D)+xmlElement('VetaP',identity(p,true));
  out+=xmlElement('VetaO',{kc_zd6:0,kc_zd6p:0,kc_prij6:0,kc_zd7:round(r.base),kc_uhrn:round(r.base),kc_zakldan:round(r.base),kc_zakldan23:round(r.base)});
  out+=xmlElement('VetaS',{kc_zdsniz:round(r.afterDeduction),kc_zdzaokr:r.roundedBase,da_dan16:r.rawTax,kc_odcelk:round(r.deductions),kc_op15_12:round(r.claimed.pension),kc_op15_13:round(r.claimed.lifeInsurance),kc_op15_inpr:round(r.claimed.dip),kc_op15_pece:round(r.claimed.longTermCare),kc_op15_8:round(r.claimed.gifts),kc_op28_5:round(r.claimed.mortgage)});
  for(const ch of a.children??[]){if(!ch.claims.length)continue;out+=xmlElement('VetaA',{vyzdite_jmeno:ch.firstName,vyzdite_prijmeni:ch.lastName,vyzdite_r_cislo:ch.birthNumber.replace('/',''),vyzdite_pocmes:ch.claims.filter(x=>x.order===1).length,vyzdite_pocmes2:ch.claims.filter(x=>x.order===2).length,vyzdite_pocmes3:ch.claims.filter(x=>x.order===3).length,vyzdite_ztpp:0,vyzdite_ztpp2:0,vyzdite_ztpp3:0});}
  out+=xmlElement('VetaB',{priloha1:1});
  out+=xmlElement('VetaT',{c_nace:p.nace,kc_prij7:round(r.income),kc_vyd7:round(r.expenses),kc_hosp_rozd:round(r.base),kc_zd7p:round(r.base),vyd7proc:'A',pr_prij7:round(r.income),pr_vyd7:round(r.expenses),pr_sazba:a.expenseRate,celk_pr_prij7:round(r.income),celk_pr_vyd7:round(r.expenses),m_podnik:12});
  return [{name:`DPFO-${c.year}.xml`,schema:'dpfdp7.xsd',xml:wrap('DPFDP7',out)},csszForm(c,r,date),ozpForm(c,r)];
}
function csszForm(c,r,date){
  const p=c.profile,a=c.answers;
  const months=on=>Array.from({length:13},(_,i)=>tag('m'+(i+1),i===12&&on?'A':'' )).join('');
  let client=xmlElement('name',{fir:p.firstName,sur:p.lastName})+xmlElement('birth',{bno:p.birthNumber.replace('/',''),den:birthDateFromNumber(p.birthNumber)})+xmlElement('adr',{str:p.street,num:p.houseNumber+(p.orientationNumber?'/'+p.orientationNumber:''),pnu:p.postalCode,cit:p.city,cnt:'CZ'});
  client+=tag('idds',p.dataBox??'')+tag('email',p.email??'')+tag('tel','')+tag('druc','H');
  client+=xmlElement('hlavc',{},months(true))+xmlElement('vedc',{},months(false)+['zam','duchod','pdite','ppm','pece','ndite'].map(x=>tag(x,'')).join(''))+xmlElement('narok',{},months(false))+xmlElement('sleva',{},months(false));
  let pvv=xmlElement('mesc',{h:12,v:0})+xmlElement('mesv',{h:12,v:0})+tag('mesp',(r.insuranceTaxBase/12).toFixed(2))+xmlElement('rdza',{h:'0.00',v:'0.00'})+xmlElement('vvz',{h:Math.ceil(r.insuranceTaxBase*.55),v:0})+xmlElement('dvz',{h:0,v:0});
  for(const[k,v]of Object.entries({mvz:r.socialBase,uvz:r.socialBase,vzza:0,vzsu:r.socialBase,vzsvc:r.socialBase,poj:r.social,slev:0,pojposlev:r.social,zal:a.socialAdvances/100,ned:r.socialBalance}))pvv+=tag(k,v);
  let body=xmlElement('client',{},client)+xmlElement('pvv',{pri:Math.round(r.base)},pvv)+tag('prihldp','')+xmlElement('zal',{ved:'H',vz:r.newSocialBase,dp:r.newSocial,np:0});
  body+=xmlElement('pre',{vra:0},tag('rok','')+tag('iban','')+xmlElement('bs')+xmlElement('adr'));
  body+=xmlElement('prizn',{},tag('pau','')+tag('pov','A')+tag('elektr',a.filingMode==='electronic'?'A':'N')+tag('por',a.filingMode==='advisor'?'A':'N')+tag('meldat',''));
  body+=xmlElement('opr')+xmlElement('spo',{},xmlElement('name')+xmlElement('adr'))+xmlElement('dat',{dre:date})+xmlElement('prilo',{coun:0});
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+xmlElement('OSVC',{xmlns:'http://schemas.cssz.cz/OSVC2025',version:'1.0'},xmlElement('prehledosvc',{for:'prehledosvc',dep:p.csszOffice,vsdp:p.socialVariableSymbol,rok:c.year,typ:'N'},body));
  return {name:`PREHLOSVC-${c.year}.xml`,schema:'osvc25.xsd',xml};
}
function ozpForm(c,r){
  const p=c.profile,a=c.answers,rows=obj=>Object.entries(obj).map(([k,v])=>xmlElement('radekHodnoty',{},tag('klicRadku',k)+tag('hodnotaRadku',v))).join('');
  let body=tag('identifikacePredmetuPodaniText','Přehled OSVČ pro ZP 2026+')+tag('identifikacePredmetuPodaniKod','3e0520e9-2dea-4073-8252-ed57cb5d1c89')+tag('kodZdravotniPojistovny','207')+tag('rokPrehledu',c.year)+tag('typPrehledu','radny');
  let person=tag('cisloPojistence',p.birthNumber.replace('/',''))+(p.ico?tag('ic',p.ico):'')+tag('prijmeni',p.lastName)+tag('jmeno',p.firstName);
  person+=xmlElement('adresa',{},tag('ulice',p.street)+tag('cisloDomu',p.houseNumber)+tag('psc',p.postalCode)+tag('obec',p.city));if(p.email)person+=tag('email',p.email);
  body+=xmlElement('pojistenec',{},person);
  body+=xmlElement('prohlaseniRezimPojistneho',{},xmlElement('prohlaseni',{},tag('klicProhlaseni','prohlaseniPp')+xmlElement('seznamMesicu',{},'')));
  body+=xmlElement('prohlaseniPojistenceDP',{},tag('zpusobPodaniDP',{basic:'priznaniDPFO',electronic:'elektronicky',advisor:'danovyPoradce'}[a.filingMode]));
  body+=xmlElement('stanovenePojistneOSVC',{},rows({3:r.insuranceTaxBase,4:12,5:12,6:12,9:279342,14:r.healthBase,16:r.health}));
  body+=xmlElement('vyrovnaniZalohPojistne',{},xmlElement('seznamRadku',{},rows({41:a.healthAdvances/100,43:-r.healthBalance})));
  body+=xmlElement('vyseZalohy',{},xmlElement('seznamRadkuSekceZalohy',{},rows({51:Math.ceil(r.insuranceTaxBase*.5/12*.135)}))+tag('typZalohy',r.newHealth===3306?'zalohaMinimalni':'zalohaVypoctena')+tag('novaVyseZalohy',r.newHealth));
  return {name:`PREHLED-OZP-${c.year}.xml`,schema:'ozp-prehled_OSVC_2025_v5_1.xsd',xml:'<?xml version="1.0" encoding="UTF-8"?>\n'+xmlElement('prehledOSVC',{xmlns:'http://xmlns.vzp.cz/prehledOSVC/v0'},body)};
}
export function ozpPDFFields(c,r,date){
  const p=c.profile,a=c.answers;
  return {box_typ:1,box_priznani_k_dani:{basic:1,electronic:2,advisor:3}[a.filingMode],box_radek_51:r.newHealth===3306?1:2,prijmeni:p.lastName,jmeno:p.firstName,adresa_ulice:p.street,adresa_cislo:p.houseNumber,adresa_psc:p.postalCode,adresa_obec:p.city,rodne_cislo:p.birthNumber,ico:p.ico??'',email:p.email??'',radek_3:r.insuranceTaxBase,radek_4:12,radek_5:12,radek_6:12,radek_9:279342,radek_14:r.healthBase,radek_16:r.health,radek_41:a.healthAdvances/100,radek_43:-r.healthBalance,radek_51:Math.ceil(r.insuranceTaxBase*.5/12*.135),nova_vyse_zalohy:r.newHealth,vyplneno_dne:dateCZ(date)};
}
