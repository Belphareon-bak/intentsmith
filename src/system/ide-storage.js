import fs from 'node:fs/promises';
import path from 'node:path';
import { ideError, record, textField } from '../db/ide-store.js';

export function validatePaths(input) {
  record(input,['revision','projects']);
  const projects=textField(input.projects,4096);
  if (!path.isAbsolute(projects)||projects===path.parse(projects).root) throw ideError('IDE_PATH_INVALID');
  return {projects:path.resolve(projects)};
}
export async function directoryUsage(root, {maximumEntries=5000,budgetMs=300}={}) {
  let bytes=0,entries=0,complete=true;
  const start=Date.now(),pending=[root];
  try {
    while(pending.length) {
      if(entries>=maximumEntries||Date.now()-start>budgetMs) {complete=false;break;}
      const item=pending.pop(),stat=await fs.lstat(item);entries++;
      if(stat.isSymbolicLink()) continue;
      if(stat.isFile()) bytes+=stat.size;
      else if(stat.isDirectory()) {
        const directory=await fs.opendir(item);
        for await(const entry of directory) {
          if(entries+pending.length>=maximumEntries||Date.now()-start>budgetMs){complete=false;break;}
          pending.push(path.join(item,entry.name));
        }
      }
    }
    return {bytes,entries,status:complete?'COMPLETE':'PARTIAL',observedAt:new Date().toISOString()};
  } catch(error) {return {bytes:null,entries,status:error.code==='ENOENT'?'MISSING':'UNAVAILABLE',observedAt:new Date().toISOString()};}
}
export async function storageInventory(db,config,store) {
  const dataDir=path.dirname(path.resolve(config.db.path));
  const roots=[['projects',store.get('paths','default')?.projects||path.resolve(config.projects.defaultDir)],
    ['data',dataDir],['backups',path.join(dataDir,'backups')],
    ['models',process.env.OLLAMA_MODELS||'/usr/share/ollama/.ollama/models']];
  const mounts=[];
  try {
    for(const line of (await fs.readFile('/proc/self/mountinfo','utf8')).trim().split('\n')) {
      const [left,right]=line.split(' - ');if(!right)continue;
      const fields=left.split(' '),[type,source]=right.split(' ');
      if(!['ext4','ext3','ext2','btrfs','xfs','zfs','ntfs','ntfs3','exfat','fuseblk','overlay'].includes(type)) continue;
      mounts.push({mountPoint:fields[4].replace(/\\([0-7]{3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8))),type,source});
    }
  } catch {mounts.push({mountPoint:path.parse(dataDir).root,type:'unknown',source:null});}
  const disks=(await Promise.all(mounts.map(async mount=>{
    try {const st=await fs.statfs(mount.mountPoint);return {...mount,totalBytes:st.blocks*st.bsize,
      freeBytes:st.bavail*st.bsize,usedBytes:(st.blocks-st.bfree)*st.bsize,status:'OBSERVED'};}
    catch{return {...mount,totalBytes:null,freeBytes:null,usedBytes:null,status:'UNAVAILABLE'};}
  })));
  const locations=await Promise.all(roots.map(async([kind,root])=>({kind,path:root,
    mountPoint:disks.filter(d=>root===d.mountPoint||root.startsWith(d.mountPoint==='/'?'/':d.mountPoint+'/'))
      .sort((a,b)=>b.mountPoint.length-a.mountPoint.length)[0]?.mountPoint||null,
    ...(await directoryUsage(root))})));
  const databases=[];
  for(const item of db.pragma('database_list')) {
    const name=`"${item.name.replaceAll('"','""')}"`;
    const pageCount=db.pragma(`${name}.page_count`,{simple:true}),pageSize=db.pragma(`${name}.page_size`,{simple:true});
    const freelist=db.pragma(`${name}.freelist_count`,{simple:true});
    let walBytes=0;try {walBytes=(await fs.stat(item.file+'-wal')).size;}catch{}
    databases.push({name:item.name,path:item.file||null,engine:'SQLite',version:db.prepare('SELECT sqlite_version() AS v').get().v,
      allocatedBytes:pageCount*pageSize,usedBytes:(pageCount-freelist)*pageSize,freePages:freelist,pageSize,walBytes,
      journalMode:db.pragma(`${name}.journal_mode`,{simple:true}),
      tableCount:db.prepare(`SELECT count(*) AS n FROM ${name}.sqlite_master WHERE type='table'`).get().n});
  }
  return {generatedAt:new Date().toISOString(),disks,locations,databases,
    pathManagement:{projects:'LIVE_DEFAULT',models:'PROVIDER_ENVIRONMENT_REQUIRES_RESTART',data:'INSTALLATION_MANAGED'}};
}
