'use strict';

// This form deliberately offers only the local capabilities allowed by M3.
function workerTemplate(s, id) {
  const name = String(s.workerTemplateName || '').trim();
  const query = String(s.workerQuery || '').trim();
  if (!name || name.length > 120 || !query || query.length > 2000) throw Error('Vyplňte název a hledané signály (nejvýše 120 a 2 000 znaků).');
  if (!['manual', 'interval'].includes(s.workerSchedule)) throw Error('Neplatný plán workeru.');
  if (s.workerSchedule === 'interval' && !['5m','15m','30m','1h','2h','4h','6h','12h','1d','7d'].includes(s.workerInterval)) throw Error('Neplatný interval.');
  if (!['changed', 'issues'].includes(s.workerCondition)) throw Error('Neplatná podmínka.');
  const threshold = Number(s.workerThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 10000) throw Error('Počet signálů musí být celé číslo 1–10 000.');
  const message = String(s.workerMessage || '').trim();
  if (!message || message.length > 2000) throw Error('Vyplňte text oznámení (nejvýše 2 000 znaků).');
  return {
    contract:'ExtensionManifest', version:1, kind:'agent', id, moduleVersion:'1.0.0', coreContract:'>=1.0.0 <2.0.0',
    requiredCapabilities:['code-intel.project-context.v1'], optionalCapabilities:[],
    payload:{enabledByDefault:false, definition:{id, name, description:String(s.workerTemplateDescription || '').trim(), icon:'🩺',
      schedule:s.workerSchedule === 'manual' ? {type:'manual'} : {type:'interval', value:s.workerInterval},
      sources:[{id:'project_health', type:'project_context', config:{project_id:'{{params.project_id}}',query,max_files:12,max_bytes:49152,max_tokens:12288}}],
      conditions:[s.workerCondition === 'changed'
        ? {id:'signal',type:'changed',field:'sources.project_health.data.workspace_revision'}
        : {id:'signal',type:'compare',field:'sources.project_health.data.issue_count',operator:'>=',value:threshold}],
      triggers:[{id:'notify_signal',condition_id:'signal',edge:'rising',cooldown:300,max_fires_per_day:10}],
      actions:[{type:'notify',trigger_id:'notify_signal',config:{channel:'in_app',title:name,message,priority:'normal',use_llm:false}}],
      params:[{name:'project_id',type:'number',label:'Projekt'}]}}
  };
}
module.exports = { workerTemplate };
