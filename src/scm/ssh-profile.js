import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scmError } from './git-runner.js';

export async function resolveRepositorySsh(db,projectId,remote) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='ide_documents'").get())return null;
  const row=db.prepare("SELECT data_json,revision FROM ide_documents WHERE kind='repository' AND id=?").get(String(projectId));
  const profileId=row&&JSON.parse(row.data_json).sshProfileId;if(!profileId)return null;
  const profile=db.prepare("SELECT data_json,revision FROM ide_documents WHERE kind='ssh-profile' AND id=?").get(profileId);
  if(!profile)throw scmError('SCM_SSH_PROFILE_MISSING');
  const settings=JSON.parse(profile.data_json);
  if(remote.host!==settings.host||remote.url.startsWith('https:'))throw scmError('SCM_SSH_PROFILE_HOST_MISMATCH');
  const parsed=remote.url.startsWith('ssh:')?new URL(remote.url):null;
  const user=parsed?parsed.username:remote.url.split('@')[0],port=parsed?Number(parsed.port||22):22;
  if(user!==settings.user||port!==settings.port)throw scmError('SCM_SSH_PROFILE_REMOTE_MISMATCH');
  const hashes=[];
  for(const key of ['identityFile','knownHostsFile']) {
    const filename=settings[key];
    if(typeof filename!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(filename))throw scmError('SCM_SSH_PROFILE_UNSAFE');
    const stat=await fs.lstat(filename);
    if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||stat.size>1048576
      ||stat.mode&(key==='identityFile'?0o077:0o022)||await fs.realpath(filename)!==filename)throw scmError('SCM_SSH_PROFILE_UNSAFE');
    hashes.push(createHash('sha256').update(await fs.readFile(filename)).digest('hex'));
  }
  return {profileId,repositoryRevision:row.revision,profileRevision:profile.revision,
    fingerprint:createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    command:`/usr/bin/ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o ProxyCommand=none -o ProxyJump=none -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ${settings.identityFile} -o UserKnownHostsFile=${settings.knownHostsFile}`};
}
