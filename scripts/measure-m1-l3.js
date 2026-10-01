#!/usr/bin/env node
//
// M1 L3 measurement — the numbers the roadmap requires to be measured, not
// estimated: deterministic p50/p95, model chat p50/p95, throughput, cold vs
// warm, and the refinement delta.
//
// Runs serially against a live product server. GPU work is never concurrent.
//
// Usage: INTENTSMITH_URL=http://127.0.0.1:PORT node measure-m1-l3.js [--samples N]

import { writeFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assessChatResilienceTransport, chatResilienceRunStatus } from './chat-resilience-transport.js';
import { createChatResilienceProviderRelay } from './chat-resilience-provider-relay.js';

const BASE = (process.env.INTENTSMITH_URL ?? process.env['C3_URL']);
const ISOLATED_CHAT = process.argv.includes('--isolated-chat');
if (!BASE && !ISOLATED_CHAT) {
  console.error('INTENTSMITH_URL is required');
  process.exit(2);
}
const samplesArg = process.argv.indexOf('--samples');
const SAMPLES = samplesArg > 0 ? Number(process.argv[samplesArg + 1]) : 12;

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: the smallest value at or above the p-th percentile.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarize(values) {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    n: values.length,
    minMs: Math.min(...values),
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: Math.max(...values),
    meanMs: Math.round(sum / values.length),
  };
}

const CONVERSATION_ID = process.env.M1_L3_CONVERSATION
  || `m1-l3-${Date.now().toString(36)}`;

async function chatOnce(message, extra = {}) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID, message, ...extra }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => null);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { status: response.status, body, elapsedMs };
}

const DETERMINISTIC_PROMPTS = [
  'kolik je 2+2',
  'kolik je 17*3',
  'kolik je 100/4',
];

const MODEL_PROMPTS = [
  'Vysvětli jednou větou, co dělá HTTP status 409.',
  'Jedním odstavcem: proč je append-only log lepší než mutovatelný stav pro audit?',
  'Ve dvou větách vysvětli rozdíl mezi shared a exclusive lockem.',
];

async function main() {
  const report = {
    measuredAtIso: new Date().toISOString(),
    baseUrl: BASE,
    samples: SAMPLES,
    deterministic: null,
    modelChat: null,
    notes: [],
  };

  // ── Deterministic ────────────────────────────────────────────────────────
  const deterministicMs = [];
  let deterministicClassified = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const prompt = DETERMINISTIC_PROMPTS[index % DETERMINISTIC_PROMPTS.length];
    const result = await chatOnce(prompt);
    if (result.status !== 200) {
      report.notes.push(`deterministic request ${index} returned ${result.status}`);
      continue;
    }
    // The product reports the classification under metadata, not at the top
    // level. Counting it matters: a p95 that silently included a model call
    // would not be a deterministic p95 at all.
    if (result.body?.metadata?.decision?.type === 'LOCAL'
      || result.body?.metadata?.localComputation === true) {
      deterministicClassified += 1;
    }
    deterministicMs.push(result.elapsedMs);
  }
  report.conversationId = CONVERSATION_ID;
  report.deterministic = {
    ...summarize(deterministicMs),
    classifiedDeterministic: deterministicClassified,
    targetP95Ms: 100,
  };
  report.deterministic.meetsTarget = report.deterministic.p95Ms !== null
    && report.deterministic.p95Ms < 100;

  // ── Model chat: first call is cold, the rest are warm ────────────────────
  const warmMs = [];
  let coldMs = null;
  let providerErrors = 0;
  const refinement = { observed: 0, improved: 0, deltas: [] };

  for (let index = 0; index < SAMPLES; index += 1) {
    const prompt = `${MODEL_PROMPTS[index % MODEL_PROMPTS.length]} (${index})`;
    const result = await chatOnce(prompt);
    if (result.status !== 200) {
      providerErrors += 1;
      report.notes.push(`model request ${index} returned ${result.status}`);
      continue;
    }
    if (index === 0) coldMs = result.elapsedMs;
    else warmMs.push(result.elapsedMs);

    const quality = result.body?.quality || result.body?.metadata?.quality;
    if (quality && typeof quality.scoreBefore?.total === 'number') {
      refinement.observed += 1;
      if (typeof quality.scoreAfter?.total === 'number') {
        refinement.improved += 1;
        refinement.deltas.push(quality.scoreAfter.total - quality.scoreBefore.total);
      }
    }
  }

  const warmSummary = summarize(warmMs);
  report.modelChat = {
    coldMs: coldMs === null ? null : Math.round(coldMs),
    warm: warmSummary,
    providerErrors,
    throughputTurnsPerMinute: warmSummary
      ? Number((60_000 / warmSummary.meanMs).toFixed(2))
      : null,
    // Refinement only fires for synthesized answers below the quality
    // threshold, so plain conversational turns legitimately observe zero. The
    // delta belongs to WP-M1-QUALITY, which runs a fixed A/B corpus.
    refinement: {
      observedTurns: refinement.observed,
      refinedTurns: refinement.improved,
      meanDelta: refinement.deltas.length
        ? Number((refinement.deltas.reduce((a, b) => a + b, 0) / refinement.deltas.length).toFixed(4))
        : null,
      deltas: refinement.deltas,
    },
  };

  const out = process.env.M1_L3_REPORT || '/tmp/m1-l3-report.json';
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nreport: ${out}`);

  // A run that measured nothing is a failed measurement, not a green one.
  if (deterministicMs.length === 0 || warmMs.length === 0) {
    console.error('MEASUREMENT_INCOMPLETE: no usable samples');
    process.exitCode = 1;
  }
}

(ISOLATED_CHAT ? measureIsolatedChat() : main()).catch((error) => {
  console.error('measurement failed:', error.message);
  process.exit(1);
});

// Explicit live mode. A fresh product server, DB, persisted conversations and
// private project run inside an unshared network namespace. The only exception
// is the serial, allowlisted local provider via Unix relay under the shared GPU
// lease. Exact approvals still traverse the real M2 authority; all bytes and
// results are recorded. --offline validates the corpus without any inference.
// Usage: node scripts/measure-m1-l3.js --isolated-chat --live --phase LABEL \
//   --corpus CORPUS.json --record .intentsmith-artifacts/chat-live-20260928/runs.json
async function measureIsolatedChat() {
const arg = name => { const n = process.argv.indexOf(name); if (n < 0 || !process.argv[n + 1]) throw new Error(`${name} is required`); return process.argv[n + 1]; };
const root = process.cwd();
const inside = process.argv.includes('--inside');
const phase = process.env.CHAT_PROBE_PHASE || arg('--phase');
const runId = process.env.CHAT_PROBE_RUN_ID || randomUUID();
const recordPath = path.resolve(process.env.CHAT_PROBE_RECORD || arg('--record'));
const out = process.env.CHAT_PROBE_OUT || path.join(path.dirname(recordPath), `${phase}-${runId.slice(0, 8)}`);
const self = fileURLToPath(import.meta.url);
const model='qwen3.5:27b';
const modelDigest='7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
const corpusFile = path.resolve(process.env.CHAT_PROBE_CORPUS || arg('--corpus'));
const definition = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
const corpus = definition.cases;
const expectedFamilies = Array.from({ length: 20 }, (_, index) => `F${String(index + 1).padStart(2, '0')}`);
const expectedHeldOutFamilies = expectedFamilies.slice(13);
const actualFamilies = Array.isArray(corpus) ? [...new Set(corpus.map(c => c.family))].sort() : [];
if (definition.version !== 1 || !Array.isArray(corpus) || corpus.length !== 53
  || definition.families !== 20 || JSON.stringify(actualFamilies) !== JSON.stringify(expectedFamilies)
  || !Array.isArray(definition.heldOutFamilies) || definition.heldOutFamilies.length !== 7
  || JSON.stringify([...definition.heldOutFamilies].sort()) !== JSON.stringify(expectedHeldOutFamilies)
  || corpus.some(c => !c.id || typeof c.input !== 'string' || !c.input.trim() || !c.intent
    || typeof c.contextPolicy !== 'string' || !Array.isArray(c.allowed) || !c.allowed.length
    || !['required', 'permitted', 'unnecessary'].includes(c.question)
    || !Array.isArray(c.forbidden) || !c.forbidden.length
    || typeof c.usedForTuning !== 'boolean' || !c.variant
    || c.usedForTuning !== !expectedHeldOutFamilies.includes(c.family)))
  throw new Error('Final corpus must have 53 declared cases, 20 families and exact F14-F20 untouched holdout');
if (new Set(corpus.map(c => c.id)).size !== corpus.length) throw new Error('Duplicate case ID');
const requestedCases = process.env.CHAT_PROBE_CASES?.split(',').filter(Boolean) || null;
if (requestedCases && (!requestedCases.length || new Set(requestedCases).size !== requestedCases.length
  || requestedCases.some(id => !corpus.some(entry => entry.id === id)))) {
  throw new Error('Unknown or duplicate selected case');
}
for (const [index, entry] of corpus.entries()) {
  if (!entry.approve?.previous) continue;
  const sourceIndex = corpus.findIndex(candidate => candidate.id === entry.approve.fromCase);
  if (sourceIndex < 0 || sourceIndex >= index || corpus[sourceIndex].dialog !== entry.dialog) {
    throw new Error(`Invalid previous-answer source for ${entry.id}`);
  }
}
const isFinal = /^final-[123]$/u.test(phase);
if (phase.startsWith('final-') && !isFinal) throw new Error('Unknown final phase');
if (isFinal && requestedCases) throw new Error('Final phase cannot filter cases');
if (isFinal && process.env.CHAT_PROBE_NO_DIRECT === 'true') throw new Error('Final phase requires direct A/B baseline');
if (process.argv.includes('--offline')) {
  console.log(JSON.stringify({ status: 'OFFLINE_CORPUS_VALIDATED', cases: corpus.length, modelCalls: 0 }));
  return;
}
const dirtyStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirtyStatus) throw new Error('LIVE_SOURCE_DIRTY: commit the exact runner and corpus before inference');
const manifest = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceClean: dirtyStatus.length === 0, dirtyStatus,
  corpusSha256: createHash('sha256').update(fs.readFileSync(corpusFile)).digest('hex'),
  runnerSha256: createHash('sha256').update(fs.readFileSync(self)).digest('hex'), model, modelDigest,
  providerUrl: 'http://127.0.0.1:11434', node: process.version, inferenceSerial: true, networkIsolation: 'kernel namespace plus explicit Unix provider relay' };
if (isFinal && !inside && phase !== 'final-1') {
  let previous;
  try { previous = JSON.parse(fs.readFileSync(recordPath, 'utf8')).runs
    .find(run => run.phase === `final-${Number(phase.slice(-1)) - 1}` && run.status === 'LIVE_COMPLETE_UNASSESSED');
  } catch {}
  if (!previous || ['revision', 'corpusSha256', 'runnerSha256', 'model', 'modelDigest', 'node']
    .some(key => previous.manifest?.[key] !== manifest[key])) {
    throw new Error('FINAL_SERIES_DRIFT: previous complete run with unchanged source, corpus, runner and model is required');
  }
}
const canonical = () => {
  if (inside) return;
  let record; try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch { record = { version: 1, runs: [] }; }
  const read = name => { try { return JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')); } catch { return null; } };
  const prior = record.runs.find(r => r.runId === runId);
  const exit = read('initial-exit.json');
  const run = { ...prior, runId, phase, manifest, artifactDirectory: out,
    configuration: read('initial-configuration.json'), preflight: read('initial-preflight.json'),
    cases: read('initial-results.json') || [], providerWire: read('initial-provider-wire.json') || [], exit,
    status: chatResilienceRunStatus(exit) };
  record.runs = record.runs.filter(r => r.runId !== runId).concat(run);
  record.updatedAt = new Date().toISOString();
  fs.writeFileSync(recordPath + '.tmp', JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(recordPath + '.tmp', recordPath);
};
const save = (name, data) => { fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); canonical(); };
if(process.argv.includes('--inside')) {
 const runtime=process.env.CHAT_PROBE_RUNTIME; let activeCase='boot';
 const relay=http.createServer((req,res)=>{const upstream=http.request({socketPath:process.env.CHAT_PROBE_SOCKET,path:req.url,method:req.method,headers:{...req.headers,'X-Chat-Measurement-Case':activeCase}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);}); upstream.on('error',e=>{res.writeHead(502);res.end(e.message);});req.pipe(upstream);});
 await new Promise(r=>relay.listen(0,'127.0.0.1',r));
 process.env.OLLAMA_URL=`http://127.0.0.1:${relay.address().port}`;
 await import(path.join(root,'src/server.js'));
 let info; for(let n=0;n<240;n++){try{info=JSON.parse(fs.readFileSync(process.env.INTENTSMITH_PORT_FILE,'utf8'));if(info.pid===process.pid)break;}catch{} await delay(250);}
 if(!info?.localCapability)throw new Error('owned server did not start');
 async function request(method,url,body=null){const began=performance.now();const r=await fetch(`http://127.0.0.1:${info.port}${url}`,{method,headers:{'X-IntentSmith-Local-Capability':info.localCapability,'Content-Type':'application/json'},...(body===null?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});const result=await r.json();return {status:r.status,result,elapsedMs:performance.now()-began};}
 const rows=[]; save('initial-corpus.json',definition);
 const p=await request('POST','/api/projects',{name:'Chat isolated probe',type:'general'});
 const projectId=p.result.project?.id??p.result.id;
 if(!projectId)throw new Error('isolated project setup: '+JSON.stringify(p));
 const db=(await import(path.join(root,'src/db/database.js'))).default;
 const {updateUserSettings,readChatMemoryPolicy}=await import(path.join(root,'src/db/user-settings.js'));
 // Mirror the already paused production learning policy only in the fresh
 // private DB. This never opens or modifies the production settings document.
 updateUserSettings(db.db,document=>({...document,'intentsmith.memory.learningEnabled':false}));
 const project=db.projects.findById.get(projectId);
 for (const [relative, content] of Object.entries(definition.fixtures || {})) {
  if (relative.includes('..') || path.isAbsolute(relative) || path.resolve(project.path, relative).startsWith(project.path + path.sep) === false) throw new Error('Fixture outside private project');
  fs.mkdirSync(path.dirname(path.join(project.path, relative)), { recursive: true });
  fs.writeFileSync(path.join(project.path, relative), content);
 }
 const preflight=JSON.parse(fs.readFileSync(path.join(out,'initial-preflight.json'),'utf8'));
 const effectiveConfiguration={
  bindings:(await import(path.join(root,'src/config.js'))).config.models,
  isolatedEnv:Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('INTENTSMITH_ENABLE_') || key.startsWith('INTENTSMITH_MODEL_'))),
  memoryPolicy:readChatMemoryPolicy(db.db),corpusSize:corpus.length,
  providerVersion:preflight.provider?.version,
 };
 if (typeof effectiveConfiguration.providerVersion !== 'string') throw new Error('Provider version missing from preflight');
 const configurationFingerprint=createHash('sha256').update(JSON.stringify(effectiveConfiguration)).digest('hex');
 if (isFinal && phase !== 'final-1') {
  const previous=JSON.parse(fs.readFileSync(recordPath,'utf8')).runs
   .find(run=>run.phase===`final-${Number(phase.slice(-1))-1}` && run.status==='LIVE_COMPLETE_UNASSESSED');
  if (previous?.configuration?.fingerprint !== configurationFingerprint) throw new Error('FINAL_CONFIGURATION_DRIFT');
 }
 save('initial-configuration.json', { ...manifest, ...effectiveConfiguration,
  fingerprint:configurationFingerprint,project:{id:projectId,path:project.path} });
 const store=(await import(path.join(root,'src/chat/conversation-store.js'))).getConversationStore();
 const conversations=new Map();
 const trace=()=>Object.fromEntries(['tool_v1_requests','tool_v1_results','m2_effect_requests','m2_effect_results'].map(table=>[table,db.db.prepare(`SELECT * FROM ${table}`).all()]));
 const files=()=>{
  const result={};
  const visit=(directory)=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const absolute=path.join(directory,entry.name),relative=path.relative(project.path,absolute);
   if(entry.isDirectory())visit(absolute);
   else if(entry.isFile()){const bytes=fs.readFileSync(absolute);result[relative]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),content:bytes.toString('utf8')};}
   else result[relative]={type:entry.isSymbolicLink()?'symlink':'other'};
  }};
  visit(project.path);return result;
 };
 for(const c of corpus.filter(c=>!requestedCases||requestedCases.includes(c.id))){
  activeCase=c.id; const key=c.dialog||c.id;
  if(!conversations.has(key)){const created=await request('POST','/api/conversations',{project_id:projectId,title:'private '+key});conversations.set(key,created.result.conversation?.id??created.result.id);}
  const id=conversations.get(key); if(!id)throw new Error('no conversation');
  const context=store.buildHandlerHistory(id,50);
  const command={contract:'ConversationCommand',version:1,requestId:randomUUID(),conversationId:id,turnId:randomUUID(),action:'send',input:c.input};
  const before=trace(),filesBefore=files(); const b=await request('POST','/api/chat',command);
  const row={case:c,context,B:b,firstContentMs:b.elapsedMs,firstUsefulMs:null,traceBefore:before,traceAfter:trace(),filesBefore,filesAfter:files()};rows.push(row);save('initial-results.json',rows);
  console.log('CHAT_PROBE '+JSON.stringify({id:c.id,variant:'B',status:b.status,ms:Math.round(b.elapsedMs),content:b.result.response?.content,error:b.result.error}));
  const target=c.approve?.path;
  const effectId=b.result.response?.metadata?.effectId || b.result.response?.content?.match(/effect:[a-f0-9]{64}/u)?.[0];
  if(target&&effectId){
   const effect=db.db.prepare('SELECT request_json FROM m2_effect_requests WHERE effect_id = ?').get(effectId);
   const prepared=effect&&JSON.parse(effect.request_json);
   const sourceRow=c.approve?.previous ? rows.find(previous => previous.case.id === c.approve.fromCase) : null;
   const source=sourceRow?.B;
   const sourceEligible=source?.status===200 && source.result?.status==='ok'
     && typeof source.result.response?.content==='string' && source.result.response.content.trim().length>0
     && !source.result.response.metadata?.error && !source.result.response.metadata?.securityBlocked
     && !source.result.response.metadata?.fallbackSuppressed;
   const expected=c.approve?.content ?? (c.approve?.previous && sourceEligible
     ? source.result.response.content : null);
   const digest=expected===null?null:'sha256:'+createHash('sha256').update(expected??'').digest('hex');
   if(prepared?.target?.canonicalRoot===project.path&&prepared.target.relativePath===target
     &&(c.approve.kind==='fs.read'?prepared.kind==='fs.read':prepared.kind==='fs.write'&&prepared.payloadDigest===digest&&typeof expected==='string')){
    row.approval=await request('POST','/api/chat',{...command,requestId:randomUUID(),turnId:randomUUID(),input:`schválit efekt ${effectId}`});
    row.traceAfter=trace(); row.file={path:target,exists:fs.existsSync(path.join(project.path,target)),content:fs.existsSync(path.join(project.path,target))?fs.readFileSync(path.join(project.path,target),'utf8'):null,expected};
    row.filesAfter=files();
    console.log('CHAT_PROBE '+JSON.stringify({id:c.id,variant:'approval',status:row.approval.status,ms:Math.round(row.approval.elapsedMs),content:row.approval.result.response?.content,file:row.file}));
   }else row.approvalBlocked=!sourceEligible && c.approve?.previous
     ? 'Previous answer was not an eligible successful content response'
     : 'Unexpected effect identity or payload';
   save('initial-results.json',rows);
  }
  if(process.env.CHAT_PROBE_NO_DIRECT==='true')continue;
  const messages=[{role:'system',content:'Jsi užitečný český asistent. Odpovídej přirozeně, stručně, podle celé věty a kontextu. Nástroje ani oprávnění nemáš: text a kód můžeš vytvořit, u skutečné operace jasně uveď, co je potřeba. Zachovej výslovná omezení a cíle; ptej se jen na podstatnou nejasnost.'},...context.map(e=>({role:e.response.tag.speaker==='user'?'user':'assistant',content:e.response.content})),{role:'user',content:c.input}];
  const t=performance.now();const ar=await fetch(process.env.OLLAMA_URL+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,stream:false,think:false,options:{temperature:0.1,top_p:0.75,repeat_penalty:1.1,num_predict:1200,num_ctx:4096}}),signal:AbortSignal.timeout(180000)});const a=await ar.json();row.A={status:ar.status,result:a,elapsedMs:performance.now()-t};save('initial-results.json',rows);
  console.log('CHAT_PROBE '+JSON.stringify({id:c.id,variant:'A',status:ar.status,ms:Math.round(row.A.elapsedMs),content:a.message?.content,error:a.error}));
 }
 process.exit(0);
}else{
 if(!process.argv.includes('--live'))throw new Error('explicit --live required');
 const artifactRoot=path.join(root,'.intentsmith-artifacts');
 const assertPrivateArtifactPath=target=>{
  const relative=path.relative(artifactRoot,target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('LIVE_ARTIFACT_PATH: use the private .intentsmith-artifacts root');
  let current=artifactRoot;
  for(const segment of ['.',...relative.split(path.sep)]){
   if(segment!=='.')current=path.join(current,segment);
   try { if(fs.lstatSync(current).isSymbolicLink()) throw new Error('LIVE_ARTIFACT_SYMLINK'); }
   catch(error) { if(error.code!=='ENOENT')throw error; }
  }
 };
 assertPrivateArtifactPath(recordPath);assertPrivateArtifactPath(out);
 if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('LIVE_NODE_ABI: run with the pinned Node 24 runtime');
 execFileSync(process.execPath, ['-e', 'const Sqlite = require("better-sqlite3"); const db = new Sqlite(":memory:"); db.close();'], { cwd: root, stdio: 'pipe' });
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 const {acquireGpuEvaluationLock}=await import(path.join(root,'src/upgrade/gpu-evaluation-lock.js'));
 let lease;
 const wire=[];let child,proxy;
 // Linux sun_path is limited to 108 bytes. Bind only this private short socket
 // directory into the otherwise read-only child namespace.
 const socketDir=fs.mkdtempSync('/tmp/is-chat-live-'); const socket=path.join(socketDir,'provider.sock');
 try{
  canonical();
  lease=acquireGpuEvaluationLock({command:`CHAT resilience ${phase} ${manifest.revision}`});
  const ps=await (await fetch('http://127.0.0.1:11434/api/ps')).json();
  const compute=execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name,used_memory','--format=csv,noheader'],{encoding:'utf8'}).trim();
  if (!Array.isArray(ps.models)) throw new Error('GPU_PREFLIGHT_ERROR: invalid provider residency response');
  if(ps.models.length||compute)throw new Error('BLOCKED_GPU: occupied before pilot');
  const artifact=(await (await fetch('http://127.0.0.1:11434/api/tags')).json()).models?.find(entry=>entry.name===model);
  if(artifact?.digest!==modelDigest)throw new Error('MODEL_DIGEST_DRIFT: expected fixed CHAT artifact is unavailable');
  save('initial-preflight.json',{at:new Date().toISOString(),lease:{pid:lease.owner.pid,command:lease.owner.command,startedAt:lease.owner.startedAt},ps,compute,gpu:execFileSync('nvidia-smi',['--query-gpu=memory.total,memory.used,utilization.gpu','--format=csv,noheader'],{encoding:'utf8'}).trim(),provider:await (await fetch('http://127.0.0.1:11434/api/version')).json()});
  proxy=createChatResilienceProviderRelay({out,upstream:{hostname:'127.0.0.1',port:11434},model,wire,
   persistWire:rows=>save('initial-provider-wire.json',rows)});
  await new Promise((resolve,reject)=>{
   proxy.once('error',reject);
   proxy.listen(socket,()=>{proxy.off('error',reject);resolve();});
  });
  fs.chmodSync(socket,0o600);
  const runtime=fs.mkdtempSync(path.join(out,'runtime-'));for(const d of ['home','tmp','cache','config','data','state','artifacts','home/projects'])fs.mkdirSync(path.join(runtime,d),{recursive:true,mode:0o700});
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'Europe/Prague',HOME:path.join(runtime,'home'),XDG_CONFIG_HOME:path.join(runtime,'config'),XDG_CACHE_HOME:path.join(runtime,'cache'),XDG_DATA_HOME:path.join(runtime,'data'),XDG_STATE_HOME:path.join(runtime,'state'),TMPDIR:path.join(runtime,'tmp'),DOTENV_CONFIG_PATH:path.join(runtime,'absent'),NODE_ENV:'test',CI:'1',CHAT_PROBE_RUNTIME:runtime,CHAT_PROBE_RUN_ID:runId,CHAT_PROBE_RECORD:recordPath,CHAT_PROBE_OUT:out,CHAT_PROBE_CORPUS:corpusFile,CHAT_PROBE_PHASE:phase,CHAT_PROBE_CASES:process.env.CHAT_PROBE_CASES,CHAT_PROBE_NO_DIRECT:process.env.CHAT_PROBE_NO_DIRECT||(isFinal?'false':'true'),CHAT_PROBE_SOCKET:socket,INTENTSMITH_DB_PATH:path.join(runtime,'db.sqlite'),INTENTSMITH_PORT_FILE:path.join(runtime,'port.json'),INTENTSMITH_PROJECTS_DIR:path.join(runtime,'home/projects'),INTENTSMITH_TEST_PROJECTS_DIR:path.join(runtime,'home/projects'),INTENTSMITH_TEST_ARTIFACT_DIR:path.join(runtime,'artifacts'),INTENTSMITH_TEST_SERVER_NONCE:randomBytes(24).toString('base64url'),INTENTSMITH_MODEL_CHAT:model,INTENTSMITH_MODEL_D1:model,INTENTSMITH_MODEL_CODE:'qwen3.8:latest',INTENTSMITH_MODEL_D2:'qwen3.8:latest',INTENTSMITH_MODEL_R1:'qwen3.8:latest',INTENTSMITH_MODEL_R2:'devstral-small-2:latest',INTENTSMITH_ENABLE_AGENTS:'false',INTENTSMITH_ENABLE_EXPERTISES:'false',INTENTSMITH_ENABLE_LIFECYCLE:'false',INTENTSMITH_ENABLE_COMFYUI:'false',INTENTSMITH_ENABLE_AUTONOMY:'false',INTENTSMITH_MODEL_UNIVERSE_ENABLED:'false',INTENTSMITH_LOG_LEVEL:'warn',INTENTSMITH_TRACE:'0'};
  child=spawn('bwrap',['--ro-bind','/','/','--dev-bind','/dev','/dev','--bind',out,out,
   '--tmpfs','/tmp','--bind',socketDir,socketDir,'--unshare-net','--die-with-parent','--new-session',
   process.execPath,self,'--isolated-chat','--inside'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  const log=fs.createWriteStream(path.join(out,'initial-process.log'),{mode:0o600});let tail='';
  child.stdout.on('data',c=>{log.write(c);const text=c.toString();for(const line of text.split('\n'))if(line.startsWith('CHAT_PROBE')){canonical(); console.log(line);}});child.stderr.on('data',c=>{log.write(c);tail=(tail+c).slice(-2000);});
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
  proxy.sealPending('CHILD_EXIT_WITH_PENDING_PROVIDER_REQUEST');
  log.end();
  let recorded=[];
  try { recorded=JSON.parse(fs.readFileSync(path.join(out,'initial-results.json'),'utf8')); } catch {}
  const selected=corpus.filter(c=>!requestedCases||requestedCases.includes(c.id));
  let postflightDigest=null;
  try { postflightDigest=(await (await fetch('http://127.0.0.1:11434/api/tags')).json()).models
   ?.find(entry=>entry.name===model)?.digest; } catch {}
  const {inferenceWire,exactWire,invalidInferenceCallCount,transportComplete}
   =assessChatResilienceTransport({
   wire,recorded,selected,exit,isFinal,postflightDigest,model,modelDigest});
  save('initial-exit.json',{...exit,transportComplete,exactWire,
   inferenceCallCount:inferenceWire.length,invalidInferenceCallCount,postflightDigest,
   expectedCases:selected.length,recordedCases:recorded.length,at:new Date().toISOString()});
  console.log('pilot exit',JSON.stringify({...exit,transportComplete}),tail);
  process.exitCode=transportComplete?0:1;
 }catch(error){proxy?.sealPending('RUNNER_ERROR_WITH_PENDING_PROVIDER_REQUEST');save('initial-exit.json',{code:1,blocked:['GPU_EVALUATION_BUSY','BLOCKED_GPU'].includes(error.code)||error.message.startsWith('BLOCKED_GPU'),errorCode:error.code||null,error:error.message,at:new Date().toISOString()});process.exitCode=1;console.error(error.message);}
 finally{if(child&&child.exitCode===null)child.kill('SIGTERM');if(proxy){proxy.sealPending('RUNNER_SHUTDOWN_WITH_PENDING_PROVIDER_REQUEST');proxy.closeAllConnections();await new Promise(r=>proxy.close(r));proxy.closeJournal();}fs.rmSync(socketDir,{recursive:true,force:true});lease?.release();canonical();}
}

}
