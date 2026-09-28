// Reference forms are comparison evidence, never ledger facts or entitlement.
export function comparison(c,r) {
  const rows=[];
  const add=(label,reference,current)=>{if(reference!==undefined&&reference!==null&&reference!=='')rows.push({label,reference:Number(reference),current,difference:Math.round((current-Number(reference))*100)/100});};
  for(const ref of c.references??[])for(const form of ref.forms){
    const attrs=tag=>form.fields.find(f=>f.tag===tag)?.attributes??{},value=tag=>form.fields.find(f=>f.tag===tag)?.text;
    if(form.form==='DPFDP7'&&r.kind==='annual'){
      const t=attrs('VetaT'),d=attrs('VetaD');if(Number(d.rok)!==c.year)continue;
      add('Příjmy §7',t.kc_prij7,r.income);add('Výdaje §7',t.kc_vyd7,r.expenses);add('Základ §7',t.kc_zd7p,r.base);add('Daň po slevách',d.kc_dan_celk,r.tax);
    }
    if(form.form==='OSVC'&&r.kind==='annual'&&Number(attrs('prehledosvc').rok)===c.year){add('ČSSZ pojistné',value('poj'),r.social);add('ČSSZ doplatek',value('ned'),r.socialBalance);}
    if(form.form==='DPHDP3'&&r.kind==='monthly'){
      const d=attrs('VetaD');if(Number(d.rok)!==c.year||Number(d.mesic)!==c.month)continue;
      const v=attrs('Veta6');add('DPH na výstupu',v.dan_zocelk,r.outputTax);add('Odpočet DPH',v.odp_zocelk,r.inputTax);add('Vlastní daň DPH',v.dano_da,r.due);
    }
  }
  return rows;
}
