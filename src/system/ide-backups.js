import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStateBackup, listBackups, pruneBackups, planBackupRetention } from '../core/db-backup.js';
import { getStorageConfig } from '../db/data-retention.js';
import { ideError, record, textField } from '../db/ide-store.js';

export function backupManagement({db,dataDir,projectRoot,dbPath,store}) {
  const annotate=backup=>({...backup,...(store.get('backup',backup.name)||{revision:0,note:'',archived:false}),
    db_size_mb:Math.round(backup.db_size_bytes/10485.76)/100,total_size_mb:Math.round(backup.total_size_bytes/10485.76)/100});
  const list=()=>listBackups(dataDir).map(annotate);
  function retentionPreview(input) {
    record(input,['maxDaily','maxWeekly']);
    if(!Number.isSafeInteger(input.maxDaily)||input.maxDaily<1||input.maxDaily>30
      ||!Number.isSafeInteger(input.maxWeekly)||input.maxWeekly<1||input.maxWeekly>12)throw ideError('IDE_BACKUP_RETENTION_INVALID',422);
    const plan=planBackupRetention(dataDir,{db,...input});
    return {maxDaily:input.maxDaily,maxWeekly:input.maxWeekly,scope:'CURRENT_SNAPSHOTS_NEXT_RETENTION',
      deletesNothing:true,deletions:plan.deletions.map(b=>({name:b.name,contentFingerprint:b.content_fingerprint})),
      protected:plan.backups.filter(b=>plan.keep.has(b.name)).map(b=>b.name)};
  }
  const find=name=>{const result=list().find(item=>item.name===name);if(!result)throw ideError('IDE_BACKUP_NOT_FOUND',404);return result;};
  function put(name,input,actor) {
    record(input,['revision','note','archived']);find(name);
    if(typeof input.archived!=='boolean')throw ideError('IDE_BACKUP_METADATA_INVALID');
    return store.put('backup',name,input.revision,{note:textField(input.note,2000,true),archived:input.archived},actor);
  }
  function remove(name,input,actor) {
    record(input,['revision','contentFingerprint','confirm']);
    const backup=find(name);
    if(input.confirm!==true)throw ideError('IDE_CONFIRMATION_REQUIRED',409);
    if(backup.archived)throw ideError('IDE_BACKUP_ARCHIVED',409);
    if(backup.revision!==input.revision||!backup.content_fingerprint||backup.content_fingerprint!==input.contentFingerprint)
      throw ideError('IDE_BACKUP_CHANGED',409);
    if(list().length<=1)throw ideError('IDE_LAST_BACKUP_PROTECTED',409);
    // Never traverse a replaced backup root or a symlink outside dataDir.
    const root=path.join(path.resolve(dataDir),'backups');
    if(fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root)!==root||fs.lstatSync(backup.path).isSymbolicLink()
      ||fs.realpathSync(backup.path)!==path.join(root,name))throw ideError('IDE_BACKUP_PATH_UNSAFE',409);
    const metadata=JSON.parse(fs.readFileSync(path.join(backup.path,'metadata.json'),'utf8'));
    if(metadata.content_fingerprint!==input.contentFingerprint)throw ideError('IDE_BACKUP_CHANGED',409);
    // Rename makes it disappear atomically from the list before removal.
    const deleted=path.join(root,`.deleting-${name}`);
    if(fs.existsSync(deleted))throw ideError('IDE_BACKUP_DELETE_BUSY',409);
    store.event('backup',name,actor,'delete_requested');
    fs.renameSync(backup.path,deleted);
    try {fs.rmSync(deleted,{recursive:true});}
    catch(error){fs.renameSync(deleted,backup.path);throw error;}
    store.event('backup',name,actor,'deleted');
    return {removed:true,name};
  }
  function create(input,actor) {
    record(input,['sections','note']);
    const note=textField(input.note??'',2000,true);
    const result=createStateBackup(db,dataDir,{projectRoot,dbPath,sections:input.sections});
    if(result.error)throw ideError('IDE_BACKUP_FAILED',500);
    store.put('backup',result.name,0,{note,archived:false},actor);
    const config=getStorageConfig(db);
    const retention=pruneBackups(dataDir,{db,maxDaily:config.backup.max_daily,maxWeekly:config.backup.max_weekly});
    return {ok:true,name:result.name,files:result.files,size_kb:Math.round(result.size/1024),backup:find(result.name),retention};
  }
  return {list,find,put,remove,create,retentionPreview};
}
