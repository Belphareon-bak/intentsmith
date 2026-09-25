import { readFileSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { assertGradingGpuOwnership } from './grading-provider-guard.js';
import { ModelEvaluationRunner } from './model-evaluation-runner.js';

export function stageResources(directory, floors, {read=readFileSync,stat=statfsSync}={}) {
  const memory=Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(read('/proc/meminfo','utf8'))?.[1])*1024;
  if (!Number.isSafeInteger(memory)) throw Error('STAGE_MEMORY_UNKNOWN');
  if (memory<floors.freeRamGiB*2**30) throw Error('STAGE_RAM_FLOOR');
  const disks=[];
  for(const [path,limit] of [[directory,floors.freeEvidenceGiB],[homedir(),floors.freeHomeGiB],['/tmp',floors.freeTmpGiB]]) {
    const s=stat(path),bytes=Number(s.bavail)*Number(s.bsize);
    if (!Number.isSafeInteger(bytes) || bytes<limit*2**30) throw Error('STAGE_DISK_FLOOR:'+path);
    disks.push({path,availableBytes:bytes,minimumGiB:limit});
  }
  return {memoryAvailableBytes:memory,disks};
}

export async function installedStageModels(names, endpoint='http://127.0.0.1:11434', providerVersion, request=fetch) {
  if (!['http://127.0.0.1:11434','http://127.0.0.1:11435'].includes(endpoint)) throw Error('STAGE_LOCAL_PROVIDER_REQUIRED');
  const r=await request(endpoint+'/api/tags',{signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('STAGE_INVENTORY_UNAVAILABLE');
  const inventory=(await r.json()).models;
  if(!Array.isArray(inventory))throw Error('STAGE_INVENTORY_INVALID');
  return names.map(name=>{
    const rows=inventory.filter(m=>m.name===name);
    const digest=rows[0]?.digest?.replace(/^sha256:/,'');
    if(rows.length!==1 || !/^[a-f0-9]{64}$/.test(digest || ''))throw Error('STAGE_MODEL_NOT_INSTALLED:'+name);
    return {name,artifact:{modelName:name,digestSha256:digest,providerVersion}};
  });
}

export function createStageProvider({plan,directory,endpoint=process.env.OLLAMA_URL,pid=Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID),
  request=fetch,ownership=assertGradingGpuOwnership,resources=stageResources,runner}) {
  if(endpoint!=='http://127.0.0.1:11435' || !Number.isSafeInteger(pid) || pid<1)throw Error('STAGE_MANAGED_PROVIDER_REQUIRED');
  runner ||= new ModelEvaluationRunner(endpoint);
  let ownedModel=null;
  const get=async route=>{const r=await request(endpoint+route,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('STAGE_PROVIDER_HTTP_'+r.status);return r.json();};
  const unload=async()=>{
    if(!ownedModel)return;
    await ownership(pid);
    const ps=(await get('/api/ps')).models;
    if(!Array.isArray(ps) || ps.some(m=>m.name!==ownedModel))throw Error('STAGE_UNOWNED_RESIDENT_MODEL');
    const r=await request(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:ownedModel,keep_alive:0}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('STAGE_UNLOAD_FAILED');
    if((await get('/api/ps')).models?.length!==0)throw Error('STAGE_UNLOAD_UNCONFIRMED');
    ownedModel=null;
  };
  return {
    async guard({model,task,phase}) {
      const snapshot=resources(directory,plan.resourceFloors);
      await ownership(pid);
      const version=(await get('/api/version')).version;
      if(version!==model.artifact.providerVersion)throw Error('STAGE_PROVIDER_CHANGED');
      const current=await installedStageModels([model.name],endpoint,version,request);
      if(current[0].artifact.digestSha256!==model.artifact.digestSha256)throw Error('STAGE_ARTIFACT_CHANGED');
      if(phase==='before' && ownedModel && ownedModel!==model.name)await unload();
      const ps=(await get('/api/ps')).models;
      if(!Array.isArray(ps) || ps.some(m=>m.name!==ownedModel))throw Error('STAGE_UNOWNED_RESIDENT_MODEL');
      if(phase==='after') {
        const p=ps.find(m=>m.name===model.name);
        if(!p || !(p.size>0) || !(p.size_vram>=p.size) || p.size_vram>22*2**30
          || p.context_length!==task.options.num_ctx || p.digest?.replace(/^sha256:/,'')!==model.artifact.digestSha256)
          throw Error('STAGE_FULL_GPU_PLACEMENT_UNVERIFIED');
      }
      return {...snapshot,placement:ps,placementLimitation:'Provider telemetry; native offload log remains separate evidence.'};
    },
    async call(...args) { ownedModel=args[0];return runner._callModel(...args); },
    close:unload,
  };
}
