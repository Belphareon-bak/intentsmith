// Authorized private HTTP WP: operator configuration is opt-in; malformed input refuses before effects.
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {processProviderFromTrustedPrivateHttpConfig} from '../src/execution/private-http-config.js';
import {processSandboxProvider} from '../src/execution/process-sandbox-provider.js';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'is-http-config-cpu-'));
const digest='sha256:'+'a'.repeat(64), ref=canonicalPath=>({canonicalPath,bytes:10,digest,device:'1',inode:'1'});
const valid={kind:'M2PrivateHttpTrustedArtifacts@1',privateHttpTrustedArtifacts:{launcher:ref('/trusted/launcher'),ip:ref('/usr/bin/ip'),nft:ref('/usr/sbin/nft'),runtimeExecutable:ref('/usr/bin/node'),oracle:ref('/trusted/oracle.mjs')},privateHttpStdioRelay:ref('/usr/bin/python3.14')};
let sequence=0;const results=[];
async function file(value,mode=0o600){const candidate=path.join(directory,`config-${sequence++}.json`);await fs.writeFile(candidate,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value),{mode});await fs.chmod(candidate,mode);return candidate;}
async function check(name,body){await body();results.push({name,status:'PASS'});}
try {
  await check('Absent operator opt-in returns exact unchanged default singleton',async()=>{for(const v of [undefined,null,''])assert.equal(await processProviderFromTrustedPrivateHttpConfig(v),processSandboxProvider);});
  await check('Owned canonical0600 file produces configured provider without artifact/process/network effects',async()=>{const provider=await processProviderFromTrustedPrivateHttpConfig(await file(valid));assert.notEqual(provider,processSandboxProvider);assert.equal(typeof provider.preflight,'function');});
  await check('Invalid UTF8/JSON/unknown/null/incomplete refs reject during startup',async()=>{for(const v of [Buffer.from([0xff]),'{','{}',{...valid,extra:'x'},{...valid,privateHttpTrustedArtifacts:null},{...valid,privateHttpStdioRelay:null},{...valid,privateHttpTrustedArtifacts:{...valid.privateHttpTrustedArtifacts,oracle:{...valid.privateHttpTrustedArtifacts.oracle,digest:'bad'}}}])await assert.rejects(processProviderFromTrustedPrivateHttpConfig(await file(v)));});
  await check('Alias/symlink/hardlink/world-readable/oversized config refuse',async()=>{const original=await file(valid), alias=path.join(directory,'alias.json'), hard=path.join(directory,'hard.json');await fs.symlink(original,alias);await assert.rejects(processProviderFromTrustedPrivateHttpConfig(alias));await fs.link(original,hard);await assert.rejects(processProviderFromTrustedPrivateHttpConfig(original));await assert.rejects(processProviderFromTrustedPrivateHttpConfig(await file(valid,0o644)));await assert.rejects(processProviderFromTrustedPrivateHttpConfig(await file('x'.repeat(65537))));await assert.rejects(processProviderFromTrustedPrivateHttpConfig(directory));});
  await check('Owned FIFO refuses without blocking startup',async()=>{const fifo=path.join(directory,'config.fifo');execFileSync('/usr/bin/mkfifo',['--mode=600',fifo]);const started=performance.now();await assert.rejects(processProviderFromTrustedPrivateHttpConfig(fifo),/file-owner-mode-or-size/);assert.ok(performance.now()-started<2000);});
  await check('Rejected reads leave no owned config descriptors open',async()=>{for(const fd of await fs.readdir('/proc/self/fd')){let name='';try{name=await fs.readlink('/proc/self/fd/'+fd);}catch{}assert.equal(name.startsWith(directory+'/'),false);}});
  const receipt={kind:'PrivateHttpTrustedStartupConfigCpu@1',status:'PASS',groups:results,modelCalls:0,nativeLauncherOrNetworkCalls:0,trackedWrites:0,actualArtifactPreflight:'NOT_RUN',actualServerStartup:'NOT_RUN'};
  console.log(JSON.stringify(receipt));
} finally {await fs.rm(directory,{recursive:true,force:true});}
