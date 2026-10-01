#!/usr/bin/env node
// Private, opt-in IDE CODE qualification. --preflight is read-only and never
// contacts a provider. --live requires explicit immutable pins and a new out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { acquireGpuEvaluationLock, assessScheduledEvaluationReadiness } from '../../src/upgrade/gpu-evaluation-lock.js';
import { compileCodeDraftInput } from '../../src/lifecycle/m2-code-draft.js';
import { verifyPackageMembers } from './package-members.mjs';
import { OwnedRelayRequests } from './relay-owned.mjs';
import { LEDGER_FILES, ORACLE_SOURCE, ORACLE_SHA256, ORACLE_ARGV,
  PROBE_SOURCE, PROBE_SHA256, VALIDATE_SOURCE, VALIDATE_SHA256,
  ENTRY_SOURCE, ENTRY_SHA256, ledgerBlueprint } from './inputs/project-app-acceptance.js';

process.umask(0o077);
const SELF = fileURLToPath(import.meta.url);
const CANDIDATE = path.dirname(SELF);
const CONFIG = JSON.parse(fs.readFileSync(path.join(CANDIDATE, 'CONFIG.json'), 'utf8'));
const STAGE = CONFIG.stage, PACKAGE = CONFIG.package;
const SOURCE = path.join(PACKAGE, 'source');
const NODE = path.join(PACKAGE, 'runtime/bin/node');
const APPIMAGE = path.join(PACKAGE, 'IntentSmith-Studio2.AppImage');
const ARTIFACTS = path.join(STAGE, '.intentsmith-artifacts');
const SHA40 = /^[0-9a-f]{40}$/, SHA64 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9_.:/-]{1,128}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = file => sha(fs.readFileSync(file));
const save = (out, name, value) => fs.writeFileSync(path.join(out, name),
  JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const inherited = () => Object.fromEntries(['PATH','LANG','LC_ALL','TZ']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
function git(cwd, args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: {
    ...inherited(), HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  }, timeout: 30000 }).trim();
}
function sourceIdentity() {
  assert.equal(git(STAGE, ['rev-parse', 'HEAD']), CONFIG.stageHead, 'stage source pin');
  assert.equal(git(STAGE, ['status', '--porcelain=v1', '--untracked-files=all']), '', 'clean stage source');
  assert.equal(JSON.parse(fs.readFileSync(path.join(PACKAGE, 'SOURCE.json'))).sourceRevision,
    CONFIG.sourceRevision, 'packaged source pin');
  assert.equal(fileSha(APPIMAGE), CONFIG.appImageSha256, 'AppImage pin');
  assert.equal(fileSha(path.join(CANDIDATE,'package-members.mjs')),
    CONFIG.helpers.packageMembersSha256, 'package member verifier pin');
  assert.equal(fileSha(path.join(CANDIDATE,'relay-owned.mjs')),
    CONFIG.helpers.relayOwnedSha256, 'owned relay helper pin');
  const packageMembers = verifyPackageMembers(PACKAGE, CONFIG.packageManifestSha256);
  const sqlite = spawnSync(NODE,['-e',"const D=require('better-sqlite3');const d=new D(':memory:');if(d.prepare('SELECT 1 AS n').get().n!==1)process.exit(1);d.close()"],
    {cwd:SOURCE,env:inherited(),encoding:'utf8',timeout:10000});
  assert.equal(sqlite.status,0,`packaged Node/native SQLite unavailable: ${sqlite.stderr}`);
  for (const input of CONFIG.inputs) assert.equal(fileSha(path.join(CANDIDATE, input.file)), input.sha256,
    'operator blueprint input pin');
  const rows = git(CONFIG.main, ['ls-tree','-r',CONFIG.equivalentSourceRevision,'--',
    'src','intentsmith-ide','package.json','package-lock.json','specialists','skills']).split('\n').filter(Boolean);
  for (const row of rows) {
    const [meta, relative] = row.split('\t');
    const want = meta.split(' ')[2];
    for (const root of [STAGE,SOURCE]) {
      const bytes = fs.readFileSync(path.join(root, relative));
      const blob = createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
      assert.equal(blob, want, root + ':' + relative);
    }
  }
  assert.equal(ORACLE_SHA256, '1593a906dbdc69b46b3e8a445887dd6ca9e77571a75f7415a565dac407884933');
  assert.equal(PROBE_SHA256, '838f3c8d41abbdbf1185fe8c2885dde79eb895f3d3b766d342dd5c836d7da9ec');
  assert.equal(VALIDATE_SHA256, 'baf09f9295d18aad4c55850d1b6d8205ed9120a49f22efc503097022f2f2aafe');
  assert.equal(ENTRY_SHA256, '58a792dce6f33cf5c6d9d92bc2beee920bb4ab566952bd799918916bef538a3f');
  const blueprint = ledgerBlueprint(); blueprint.focusedTest.binary = NODE;
  assert.deepEqual(blueprint.files.map(item => item.path).sort(), LEDGER_FILES.map(item => item.path).sort());
  const require = createRequire(path.join(SOURCE,'package.json'));
  const { normalizeProposal, createForm, composerDraft } = require(path.join(SOURCE,
    'intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-composer.js'));
  const fixtureOrigin = {surface:'studio',sessionId:'conv-preflight',conversationId:'conv-preflight',projectId:1};
  const offered = normalizeProposal({origin:fixtureOrigin,
    proposal:{kind:'ProjectWorkProposal@1',projectId:1,draft:blueprint}});
  assert.ok(offered,'public blueprint is a supported IDE project proposal');
  const composerOutput = composerDraft(createForm(fixtureOrigin,offered.proposal.draft));
  assert.deepEqual(composerOutput,{...blueprint,files:blueprint.files.map(file=>({...file,contextFiles:[]}))},
    'actual packaged composer retains focused test and Git metadata');
  const compiled = compileCodeDraftInput(blueprint);
  const generationPaths = compiled.buildSteps.map(step => compiled.changes[step.index].path);
  assert.deepEqual([...generationPaths].sort(), LEDGER_FILES.map(item => item.path).sort());
  const proofIdentity = {expectedPaths:LEDGER_FILES.map(item=>item.path).sort(),generationPaths};
  const proofPins = {model:'synthetic-code',digest:'f'.repeat(64),version:'0.0.0-test'};
  const proofRows = generationPaths.map(targetPath=>({method:'POST',path:'/api/chat',status:200,
    model:proofPins.model,responseTruncated:false,requestSha256:sha(targetPath),
    terminal:{model:proofPins.model,model_digest_sha256:proofPins.digest,
      provider_version:proofPins.version,done:true,done_reason:'stop',
      message:{content:JSON.stringify({afterContent:targetPath})}}}));
  const proofPreview = generationPaths.map(targetPath=>({path:targetPath,sha256:sha(targetPath)}));
  const swapped = proofPreview.map(row=>({...row}));
  [swapped[0].sha256,swapped[5].sha256]=[swapped[5].sha256,swapped[0].sha256];
  const proofControls = {
    correct: providerProof(proofRows,proofPins,proofIdentity,proofPreview).valid,
    swapped: providerProof(proofRows,proofPins,proofIdentity,swapped).valid,
    missingGeneration: providerProof(proofRows.slice(1),proofPins,proofIdentity,proofPreview).valid,
    wrongDigest: providerProof(proofRows,{...proofPins,digest:'0'.repeat(64)},proofIdentity,proofPreview).valid,
    missingVersion: providerProof(proofRows.map(row=>({...row,
      terminal:{...row.terminal,provider_version:undefined}})),
    {...proofPins,version:undefined},proofIdentity,proofPreview).valid,
    blankVersion: providerProof(proofRows.map(row=>({...row,
      terminal:{...row.terminal,provider_version:''}})),
    {...proofPins,version:''},proofIdentity,proofPreview).valid,
    oneTerminalMissingVersion: providerProof(proofRows.map((row,index)=>index===0
      ? {...row,terminal:{...row.terminal,provider_version:undefined}}:row),
    proofPins,proofIdentity,proofPreview).valid,
    relayError: providerProof(proofRows.map((row,index)=>index===0
      ? {...row,error:'upstream provider response aborted'}:row),
    proofPins,proofIdentity,proofPreview).valid,
  };
  assert.deepEqual(proofControls,{correct:true,swapped:false,missingGeneration:false,
    wrongDigest:false,missingVersion:false,blankVersion:false,
    oneTerminalMissingVersion:false,relayError:false});
  return { stageHead: CONFIG.stageHead, stageClean: true, sourceRevision: CONFIG.sourceRevision,
    equivalentSourceRevision: CONFIG.equivalentSourceRevision, appImageSha256: CONFIG.appImageSha256,
    packageManifestSha256: packageMembers.manifestSha256,
    packageMemberCount: packageMembers.memberCount, comparedTrackedFilesPerCopy: rows.length,
    packagedNodeSha256: fileSha(NODE), nativeSqliteSha256:
      fileSha(path.join(SOURCE,'node_modules/better-sqlite3/build/Release/better_sqlite3.node')),
    hostSha256: fileSha(SELF), probeSha256: fileSha(path.join(CANDIDATE,'probe.mjs')),
    configSha256: fileSha(path.join(CANDIDATE,'CONFIG.json')),
    packageMembersVerifierSha256: CONFIG.helpers.packageMembersSha256,
    ownedRelaySha256: CONFIG.helpers.relayOwnedSha256,
    inputSha256: CONFIG.inputs[0].sha256,
    oracleSha256: ORACLE_SHA256, subjectProbeSha256: PROBE_SHA256,
    validatorProbeSha256: VALIDATE_SHA256, entrySha256: ENTRY_SHA256,
    expectedPaths: LEDGER_FILES.map(item => item.path).sort(), generationPaths,
    blueprintSha256: sha(JSON.stringify(blueprint)), composerDraftSha256:sha(JSON.stringify(composerOutput)),
    proofControls,
    focusedTest: blueprint.focusedTest };
}
function parse(argv) {
  if (!argv.length || argv.length === 1 && argv[0] === '--preflight') return { mode: 'preflight' };
  assert.equal(argv[0], '--live', 'use --preflight or explicit --live');
  assert.equal(argv.length, 19, 'live requires nine named pins');
  const values = new Map();
  for (let i=1;i<argv.length;i+=2) {
    assert.ok(['--out','--stage-sha','--package-sha','--appimage-sha',
      '--host-sha','--probe-sha','--config-sha','--model','--digest'].includes(argv[i]), 'unknown live flag');
    assert.equal(values.has(argv[i]), false, 'duplicate live flag');
    values.set(argv[i], argv[i+1]);
  }
  assert.equal(values.size, 9, 'all live pins required');
  const out = values.get('--out');
  assert.ok(path.isAbsolute(out) && path.dirname(out) === ARTIFACTS, 'new private direct-child output required');
  assert.ok(SHA40.test(values.get('--stage-sha')) && SHA40.test(values.get('--package-sha')),
    'source SHA pins');
  for (const key of ['--appimage-sha','--host-sha','--probe-sha','--config-sha','--digest']) {
    assert.ok(SHA64.test(values.get(key)), key + ' SHA256 pin');
  }
  assert.ok(MODEL.test(values.get('--model')), 'exact model name pin');
  return { mode: 'live', out, stageSha: values.get('--stage-sha'),
    packageSha: values.get('--package-sha'), appimageSha: values.get('--appimage-sha'),
    hostSha: values.get('--host-sha'), probeSha: values.get('--probe-sha'),
    configSha: values.get('--config-sha'),
    model: values.get('--model'), digest: values.get('--digest') };
}
function providerProof(requests, pins, identity, preview) {
  const generations = requests.filter(row => ['/api/chat','/api/generate'].includes(row.path));
  const failures = [];
  if (typeof pins.version !== 'string' || !VERSION.test(pins.version))
    failures.push('provider version metadata missing or invalid');
  if (generations.length !== 6) failures.push(`six CODE generations required, saw ${generations.length}`);
  if (requests.some(row => row.error)) failures.push('relay error');
  const completePreview = Array.isArray(preview) && preview.length === 6
    && new Set(preview.map(row => row.path)).size === 6
    && preview.every(row => identity.expectedPaths.includes(row.path) && SHA64.test(row.sha256));
  if (!completePreview) failures.push('complete exact-path preview unavailable');
  const byPath = new Map(completePreview ? preview.map(row => [row.path,row.sha256]) : []);
  const perFile = generations.map((row,index) => {
    const targetPath = identity.generationPaths[index] ?? null;
    const terminal = row.terminal;
    const complete = row.method === 'POST' && row.status === 200 && row.model === pins.model
      && row.responseTruncated === false && terminal?.done === true && terminal?.done_reason === 'stop';
    const identityMatched = terminal?.model === pins.model
      && (terminal?.model_digest_sha256 || terminal?.digest) === pins.digest
      && typeof terminal?.provider_version === 'string'
      && VERSION.test(terminal.provider_version)
      && terminal.provider_version === pins.version;
    let outputSha256 = null;
    try { const content = JSON.parse(terminal.message.content).afterContent;
      if (typeof content !== 'string') throw Error('missing output'); outputSha256 = sha(content);
    } catch { /* missing output is a failed identity proof */ }
    const previewSha256 = byPath.get(targetPath) ?? null;
    const outputPreviewMatch = outputSha256 !== null && outputSha256 === previewSha256;
    if (!complete || !identityMatched || !outputPreviewMatch) failures.push(`generation ${index+1} ${targetPath} unproven`);
    return { generation:index+1, targetPath, requestSha256:row.requestSha256,
      outputSha256, previewSha256, complete, identityMatched, outputPreviewMatch };
  });
  return { valid: failures.length === 0, observed: generations.length, expected: 6,
    generationPaths: identity.generationPaths, perFile, failures };
}
function privateXauthority(out) {
  const source = process.env.INTENTSMITH_STUDIO_XAUTHORITY || process.env.XAUTHORITY;
  const display = process.env.DISPLAY;
  assert.ok(display && source && path.isAbsolute(source), 'explicit X11 display and authority required');
  const stat = fs.statSync(source); assert.ok(stat.isFile() && stat.size > 0, 'readable Xauthority file');
  const entry = spawnSync('/usr/bin/xauth',['-f',source,'nlist',display],{encoding:null,timeout:10000});
  assert.equal(entry.status,0,'read scoped X11 cookie'); assert.ok(entry.stdout.length > 0,'X11 cookie absent');
  const file = path.join(out,'Xauthority');
  fs.closeSync(fs.openSync(file,'wx',0o600));
  const merge = spawnSync('/usr/bin/xauth',['-f',file,'nmerge','-'],
    {input:entry.stdout,encoding:null,timeout:10000});
  assert.equal(merge.status,0,'create private Xauthority');
  fs.chmodSync(file,0o600); assert.ok(fs.statSync(file).size > 0);
  return display;
}
async function live(options, identity) {
  assert.equal(options.stageSha, identity.stageHead);
  assert.equal(options.packageSha, identity.sourceRevision);
  assert.equal(options.appimageSha, identity.appImageSha256);
  assert.equal(options.hostSha, identity.hostSha256);
  assert.equal(options.probeSha, identity.probeSha256);
  assert.equal(options.configSha, identity.configSha256);
  assert.equal(fs.realpathSync(ARTIFACTS), ARTIFACTS);
  fs.mkdirSync(options.out,{mode:0o700}); // exclusive; existing evidence is never reused
  assert.equal(fs.realpathSync(options.out),options.out);
  const result = { status:'FAIL', scope:'physical packaged IDE composer CODE ledger',
    source:identity, model:options.model, digest:options.digest, startedUtc:new Date().toISOString(),
    chat:'NOT_RUN', releaseAccepted:false, historicalCpuEvidence:CONFIG.historicalCpuEvidence };
  let lease, provider, socketRoot, child, loaded = false;
  const upstreamRequests = new OwnedRelayRequests();
  let interrupted = null, watchdog = null;
  const onInt = () => { interrupted = 'SIGINT'; if(child?.exitCode===null)child.kill('SIGTERM'); };
  const onTerm = () => { interrupted = 'SIGTERM'; if(child?.exitCode===null)child.kill('SIGTERM'); };
  process.on('SIGINT',onInt); process.on('SIGTERM',onTerm);
  const requests = [];
  const upstream = 'http://127.0.0.1:11434';
  const read = async endpoint => {
    const response = await fetch(upstream+endpoint,{signal:AbortSignal.timeout(5000)});
    assert.equal(response.ok,true,`provider ${endpoint} ${response.status}`);
    return response.json();
  };
  try {
    lease = acquireGpuEvaluationLock({command:'packaged Studio 2 physical CODE composer qualification'});
    assert.equal(interrupted,null,'interrupted before provider preflight');
    const ps = await read('/api/ps');
    const compute = execFileSync('nvidia-smi',
      ['--query-compute-apps=pid,process_name,used_memory','--format=csv,noheader'],{encoding:'utf8'}).trim();
    const memory = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo','utf8'));
    const disk = fs.statfsSync(STAGE);
    const ready = assessScheduledEvaluationReadiness({residentModels:ps.models.map(row=>row.name),
      computeProcesses:compute?compute.split('\n'):[], memoryAvailableBytes:Number(memory?.[1])*1024,
      diskAvailableBytes:disk.bavail*disk.bsize});
    result.providerPreflight = ready; assert.equal(ready.ready,true,JSON.stringify(ready.reasons));
    const inventory = await read('/api/tags');
    assert.equal(inventory.models.find(row=>row.name===options.model)?.digest,options.digest,'exact installed digest');
    const version = await read('/api/version');
    assert.ok(version && typeof version.version === 'string' && VERSION.test(version.version),
      'nonempty valid provider version metadata required');
    result.providerVersion = version.version;
    save(options.out,'PROVIDER-VERSION.json',{raw:version,sha256:sha(JSON.stringify(version)),
      observedUtc:new Date().toISOString()});
    const display = privateXauthority(options.out);
    socketRoot = fs.mkdtempSync(path.join(os.tmpdir(),'is-ide-code-'));
    fs.chmodSync(socketRoot,0o700); const socket = path.join(socketRoot,'provider.sock');
    provider = http.createServer(async (incoming,outgoing)=>{
      let row, forwarded;
      try {
        const chunks=[]; let size=0;
        for await (const chunk of incoming) { size+=chunk.length; assert.ok(size<=1_000_000); chunks.push(chunk); }
        const payload=Buffer.concat(chunks), body=payload.length?JSON.parse(payload):null;
        row={at:new Date().toISOString(),method:incoming.method,path:incoming.url,
          model:body?.model??body?.name??null,requestSha256:sha(payload),stream:body?.stream??null,
          numCtx:body?.options?.num_ctx??body?.num_ctx??null}; requests.push(row);
        const permitted=incoming.method==='GET' && ['/api/tags','/api/ps','/api/version'].includes(incoming.url)
          || incoming.method==='POST' && ['/api/chat','/api/generate'].includes(incoming.url)
            && body?.model===options.model
          || incoming.method==='POST' && incoming.url==='/api/show'
            && (body?.model||body?.name)===options.model;
        assert.ok(permitted,'provider request outside pinned model scope');
        if (['/api/chat','/api/generate'].includes(incoming.url)) loaded=true;
        let tracked;
        forwarded=http.request({hostname:'127.0.0.1',port:11434,path:incoming.url,
          method:incoming.method,headers:{'Content-Type':'application/json','Content-Length':payload.length}},response=>{
          tracked.attachResponse(response);
          if(outgoing.destroyed){response.destroy();return;}
          row.status=response.statusCode; outgoing.writeHead(response.statusCode,response.headers);
          const data=[];let total=0;
          response.on('data',chunk=>{total+=chunk.length;if(total<=16_000_000)data.push(chunk);});
          response.on('end',()=>{
            row.responseBytes=total;row.responseTruncated=total>16_000_000;
            const raw=Buffer.concat(data);row.responseSha256=row.responseTruncated?null:sha(raw);
            try {row.terminal=JSON.parse(raw);} catch {row.terminal=raw.toString().trim().split('\n')
              .map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean).at(-1)||null;}
          }); response.pipe(outgoing);
        });
        forwarded.setTimeout(180_000,()=>forwarded.destroy(Error('bounded provider timeout')));
        forwarded.on('error',error=>{row.error=error.message;
          if(!outgoing.destroyed){if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();}});
        tracked=upstreamRequests.track(incoming,outgoing,forwarded,error=>{
          row.error=error.message;
        });
        forwarded.end(payload);
      } catch(error) {if(row)row.error=error.message;forwarded?.destroy();
        if(!outgoing.destroyed){if(!outgoing.headersSent)outgoing.writeHead(403);outgoing.end();}}
    });
    await new Promise(resolve=>provider.listen(socket,resolve)); fs.chmodSync(socket,0o600);
    save(options.out,'INSIDE.json',{out:options.out,stageHead:identity.stageHead,
      sourceRevision:identity.sourceRevision,model:options.model,digest:options.digest,
      version:result.providerVersion,display,providerSocket:socket,
      parentNetns:String(fs.statSync('/proc/self/ns/net').ino)});
    assert.equal(interrupted,null,'interrupted before private GUI start');
    child=spawn('unshare',['--user','--map-root-user','--net','--','bwrap','--bind','/','/',
      '--dev','/dev','--die-with-parent',NODE,path.join(CANDIDATE,'probe.mjs'),
      '--inner',options.out],{cwd:SOURCE,env:inherited(),stdio:['ignore','pipe','pipe']});
    watchdog=setTimeout(()=>{interrupted='TOTAL_DEADLINE_30_MIN';child?.kill('SIGTERM');},30*60*1000);
    const output={stdout:'',stderr:''};
    child.stdout.on('data',chunk=>{output.stdout=(output.stdout+chunk).slice(-100_000);});
    child.stderr.on('data',chunk=>{output.stderr=(output.stderr+chunk).slice(-100_000);});
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);
      child.once('exit',(code,signal)=>resolve({code,signal}));});
    result.child={...exit,...output};
    assert.equal(interrupted,null,'physical run interrupted or deadline exceeded');
    const childResult=JSON.parse(fs.readFileSync(path.join(options.out,'RESULT.json'),'utf8'));
    result.childStatus=childResult.status; result.lifecycleId=childResult.lifecycleId??null;
    const prepared=fs.existsSync(path.join(options.out,'PREPARED.json'))
      ?JSON.parse(fs.readFileSync(path.join(options.out,'PREPARED.json'),'utf8')):null;
    const preview=prepared?.diff?.map(row=>({path:row.path,sha256:sha(row.after.content)}))??null;
    result.providerAttestation=providerProof(requests,{...options,version:result.providerVersion},identity,preview);
    assert.equal(exit.code,0,output.stderr);assert.equal(exit.signal,null);
    assert.equal(result.providerAttestation.valid,true,JSON.stringify(result.providerAttestation.failures));
    assert.equal(childResult.status,'PASS',childResult.error);
    assert.equal(childResult.actualDraftRequests,1);assert.equal(childResult.actualApprovalRequests,1);
    result.status='PASS';
  } catch(error) {result.status='FAIL';result.error=String(error.stack||error);}
  finally {
    if(watchdog)clearTimeout(watchdog);
    process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
    if(child && child.exitCode===null && child.signalCode===null) child.kill('SIGTERM');
    let relaySettled = true;
    if(provider){
      const closed = new Promise(resolve=>provider.close(()=>resolve(true)));
      provider.closeAllConnections();
      result.upstreamDrain=await upstreamRequests.cancelAndSettle(10000);
      let closeTimer;
      const serverClosed=await Promise.race([closed,new Promise(resolve=>{
        closeTimer=setTimeout(()=>resolve(false),10000);
      })]);
      clearTimeout(closeTimer);
      relaySettled=result.upstreamDrain.settled && result.upstreamDrain.pending===0 && serverClosed;
      result.relayServerClosed=serverClosed;
      if(!relaySettled)result.status='FAIL';
    }
    // Include a response/relay failure that arrived during child teardown.
    let finalPreview=null;
    try {finalPreview=JSON.parse(fs.readFileSync(path.join(options.out,'PREPARED.json'))).diff
      .map(row=>({path:row.path,sha256:sha(row.after.content)}));}catch{}
    result.providerAttestation=providerProof(requests,{...options,version:result.providerVersion},identity,finalPreview);
    if(!result.providerAttestation.valid)result.status='FAIL';
    // An identical artifact may have acquired another caller during the run.
    // Do not issue keep_alive:0 without proof that the resident instance is ours.
    result.modelMayRemainResident=loaded;
    if(socketRoot)fs.rmSync(socketRoot,{recursive:true,force:true});
    const cookie=path.join(options.out,'Xauthority');fs.rmSync(cookie,{force:true});
    result.privateXauthorityRemoved=!fs.existsSync(cookie);
    if(!result.privateXauthorityRemoved)result.status='FAIL';
    if(lease){
      if(relaySettled) {result.gpuLeaseReleased=lease.release();
        if(!result.gpuLeaseReleased)result.status='FAIL';}
      else result.gpuLeaseRetainedUntilOwnerExit=true;
    }
    try {result.sourceUnchanged=JSON.stringify(sourceIdentity())===JSON.stringify(identity);
      if(!result.sourceUnchanged)result.status='FAIL';}catch(error){result.status='FAIL';result.sourceError=String(error);}
    result.endedUtc=new Date().toISOString();save(options.out,'PROVIDER-REQUESTS.json',requests);
    save(options.out,'HOST-RESULT.json',result);
  }
  console.log(JSON.stringify({status:result.status,artifactRoot:options.out}));
  if(result.status!=='PASS')process.exitCode=1;
}

try {
  const options=parse(process.argv.slice(2));const identity=sourceIdentity();
  if(options.mode==='preflight') console.log(JSON.stringify({status:'LIVE_NOT_RUN',identity,
    liveRequires:['new output direct child','exact source/AppImage/host/probe/model/digest pins',
      'serial idle GPU/provider lease','scoped X11 authority','private project/SQLite','six exact CODE calls']},null,2));
  else await live(options,identity);
} catch(error) {console.error(error.stack||error.message);process.exitCode=1;}
