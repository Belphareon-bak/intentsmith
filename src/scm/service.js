import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OutboundAuditRepository, outboundTargetDigest } from '../network/outbound-audit-repository.js';
import { git, isRepo, projectRoot, relativeFile, branchName, remoteInfo, remoteHost, snapshot, scmError } from './git-runner.js';

const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const MODES = { init: ['ask','automatic','disabled'], commit: ['ask','automatic','disabled'],
  branch: ['ask','disabled'], fetch: ['ask','automatic','disabled'], pull: ['ask','automatic','disabled'], push: ['ask','disabled'] };
const defaults = Object.freeze({ init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] });
const keys = Object.freeze(['init','commit','branch','fetch','pull','push','remotes']);
const networkOps = new Set(['fetch','pull','push']);
const writeOps = new Set(['init','stage','unstage','commit','branch.create','checkout','pull']);
const policyKey = op => ({ 'branch.create': 'branch', checkout: 'branch', stage: null, unstage: null })[op] ?? op;
function checkRemotes(remotes) {
  if (!Array.isArray(remotes) || remotes.length > 20) throw scmError('SCM_POLICY_INVALID');
  const names = new Set();
  for (const item of remotes) {
    if (!item || Object.keys(item).sort().join(',') !== 'host,name'
      || typeof item.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(item.name)
      || typeof item.host !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(item.host)
      || names.has(item.name)) throw scmError('SCM_POLICY_INVALID');
    names.add(item.name);
  }
}
function parseStatus(raw) {
  const fields = raw.split('\0');
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]; if (!line) continue;
    if (line.length < 4 || line[2] !== ' ') throw scmError('SCM_STATUS_INVALID');
    const x = line[0], y = line[1], name = line.slice(3);
    if (/[RC]/.test(x+y)) i++; // porcelain -z carries the second rename path separately.
    rows.push({ path: name, staged: x !== ' ' && x !== '?', unstaged: y !== ' ' && y !== '?',
      untracked: x === '?' && y === '?', conflicted: x === 'U' || y === 'U' || x+y === 'AA' || x+y === 'DD',
      x, y });
  }
  return rows;
}
async function numstats(root, staged) {
  const out = await git(root, ['diff','--no-ext-diff', ...(staged ? ['--cached'] : []), '--numstat','-z','--'], { allowFailure: true });
  const map = new Map();
  if (!out) return map;
  const fields = out.split('\0');
  for (let i=0;i<fields.length;i++) {
    const record = fields[i]; if (!record) continue;
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(record);
    if (m && m[3]) map.set(m[3], { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]) });
    else if (m && !m[3]) { const old=fields[++i], current=fields[++i]; if (current) map.set(current, { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]), old }); }
  }
  return map;
}
async function exactSnapshot(root) {
  const snap = await snapshot(root);
  const records = snap.repo ? parseStatus(snap.status) : [];
  if (records.length > 200) throw scmError('SCM_STATUS_LIMIT');
  const files = [];
  for (const record of records) {
    relativeFile(record.path);
    const filename = path.join(root, record.path);
    let digest = null;
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.size > 4_000_000 || stat.nlink !== 1) throw scmError('SCM_FILE_UNSUPPORTED');
      digest = hash(await fs.readFile(filename));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    files.push([record.path, record.x, record.y, digest]);
  }
  // A staged blob can change while worktree content remains identical.
  const index = snap.repo ? await git(root, ['ls-files','--stage','-z']) : '';
  return { ...snap, status: undefined, files, indexDigest: hash(index) };
}
function validateInput(input) {
  if (!input || !Number.isSafeInteger(input.projectId) || typeof input.op !== 'string'
    || !['init','stage','unstage','commit','branch.create','checkout','fetch','pull','push'].includes(input.op)
    || (input.args != null && (typeof input.args !== 'object' || Array.isArray(input.args)))) throw scmError('SCM_INPUT_INVALID');
  const args = input.args || {};
  const allowed = { init: [], stage: ['paths'], unstage: ['paths'], commit: ['message','all'],
    'branch.create': ['name'], checkout: ['name'], fetch: [], pull: [], push: [] }[input.op];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw scmError('SCM_INPUT_INVALID');
  if (['stage','unstage'].includes(input.op)) {
    if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 100 || new Set(args.paths).size !== args.paths.length) throw scmError('SCM_PATH_INVALID');
    args.paths.forEach(relativeFile);
  }
  if (input.op === 'commit' && (typeof args.message !== 'string' || args.message.trim().length < 1
      || args.message.length > 4000 || /\0/.test(args.message) || (args.all != null && typeof args.all !== 'boolean'))) throw scmError('SCM_MESSAGE_INVALID');
  if (['branch.create','checkout'].includes(input.op)) branchName(args.name);
  return args;
}

export function createScmService({ db, clock = Date.now, idFactory = randomUUID } = {}) {
  if (!db?.prepare) throw new TypeError('SCM database is required');
  const outbound = new OutboundAuditRepository(db, { clock, idFactory });
  const audit = (planId, projectId, actorId, kind, detail) => db.prepare(`INSERT INTO scm_events
    (plan_id,project_id,actor_id,kind,occurred_at,detail_json) VALUES(?,?,?,?,?,?)`)
    .run(planId,projectId,actorId,kind,clock(),JSON.stringify(detail));
  db.transaction(() => {
    for (const row of db.prepare("SELECT plan_id,project_id,actor_id FROM scm_operations WHERE state='running'").all()) {
      db.prepare("UPDATE scm_operations SET state='interrupted' WHERE plan_id=?").run(row.plan_id);
      audit(row.plan_id,row.project_id,row.actor_id,'interrupted',{ reason: 'service_restarted', retried: false });
    }
  })();
  function policy(projectId) {
    const row = db.prepare('SELECT * FROM scm_project_policy WHERE project_id=?').get(projectId);
    if (!row) return { projectId, revision: 0, ...defaults };
    let remotes;
    try { remotes = JSON.parse(row.remotes_json); checkRemotes(remotes); }
    catch { throw scmError('SCM_POLICY_INVALID'); }
    const result = { projectId, revision: row.revision, init: row.init_mode, commit: row.commit_mode,
      branch: row.branch_mode, fetch: row.fetch_mode, pull: row.pull_mode, push: row.push_mode, remotes };
    if (Object.keys(MODES).some(key => !MODES[key].includes(result[key]))) throw scmError('SCM_POLICY_INVALID');
    return result;
  }
  function writePolicy(input, actorId) {
    if (!input || !Number.isSafeInteger(input.projectId) || !Number.isSafeInteger(input.revision)
      || Object.keys(input).sort().join(',') !== ['projectId','revision',...keys].sort().join(',')) throw scmError('SCM_POLICY_INVALID');
    for (const [key, values] of Object.entries(MODES)) if (!values.includes(input[key])) throw scmError('SCM_POLICY_INVALID');
    checkRemotes(input.remotes);
    if (!db.prepare('SELECT 1 FROM projects WHERE id=?').get(input.projectId)) throw scmError('SCM_PROJECT_NOT_FOUND');
    return db.transaction(() => {
      const old = policy(input.projectId);
      if (old.revision !== input.revision) throw scmError('SCM_POLICY_STALE');
      const next = { ...input, revision: old.revision + 1 };
      db.prepare(`INSERT INTO scm_project_policy
        (project_id,revision,init_mode,commit_mode,branch_mode,fetch_mode,pull_mode,push_mode,remotes_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
        revision=excluded.revision,init_mode=excluded.init_mode,commit_mode=excluded.commit_mode,
        branch_mode=excluded.branch_mode,fetch_mode=excluded.fetch_mode,pull_mode=excluded.pull_mode,
        push_mode=excluded.push_mode,remotes_json=excluded.remotes_json,updated_at=excluded.updated_at`)
        .run(input.projectId,next.revision,next.init,next.commit,next.branch,next.fetch,next.pull,next.push,JSON.stringify(next.remotes),clock());
      audit(null,input.projectId,actorId,'policy_changed',{ before: old, after: next });
      return next;
    }).immediate();
  }
  async function status(projectId) {
    const root = await projectRoot(db,projectId);
    const snap = await snapshot(root);
    if (!snap.repo) return { projectId,isRepo:false,branch:null,upstream:null,ahead:0,behind:0,fetchedAt:null,files:[] };
    const branch = snap.branch;
    const remote = branch ? await remoteInfo(root,branch).catch(() => null) : null;
    const upstream = (await git(root,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'],{allowFailure:true}))?.trim() || null;
    let ahead=0, behind=0;
    if (upstream) { const counts=(await git(root,['rev-list','--left-right','--count',`HEAD...${upstream}`],{allowFailure:true}))?.trim().split(/\s+/).map(Number);
      if (counts?.length===2 && counts.every(Number.isSafeInteger)) [ahead,behind]=counts; }
    let fetchedAt=null;
    try { const gitDir=(await git(root,['rev-parse','--absolute-git-dir'])).trim();fetchedAt=(await fs.stat(path.join(gitDir,'FETCH_HEAD'))).mtime.toISOString(); } catch {}
    const [staged,unstaged]=await Promise.all([numstats(root,true),numstats(root,false)]);
    const files=parseStatus(snap.status).map(item => ({ ...item,
      stagedAdded: staged.get(item.path)?.added ?? null, stagedRemoved: staged.get(item.path)?.removed ?? null,
      unstagedAdded: unstaged.get(item.path)?.added ?? null, unstagedRemoved: unstaged.get(item.path)?.removed ?? null,
      added: (item.staged ? staged : unstaged).get(item.path)?.added ?? null,
      removed: (item.staged ? staged : unstaged).get(item.path)?.removed ?? null }));
    return { projectId,isRepo:true,branch,upstream,ahead,behind,fetchedAt,
      remote: remote ? { name: remote.name, host: remote.host } : null, files };
  }
  async function branches(projectId) {
    const root=await projectRoot(db,projectId);
    if (!await isRepo(root)) return { projectId,isRepo:false,branches:[] };
    const rows=(await git(root,['for-each-ref','--format=%(refname:short)%09%(objectname)%09%(upstream:short)','refs/heads','refs/remotes']))
      .trim().split('\n').filter(Boolean).map(line=>{const [name,hash,upstream]=line.split('\t');return {name,hash,upstream:upstream||null,remote:name.includes('/')};});
    return {projectId,isRepo:true,branches:rows};
  }
  async function log(projectId,{limit=50,ref=null}={}) {
    const root=await projectRoot(db,projectId);
    if (!await isRepo(root)) return {projectId,isRepo:false,commits:[]};
    if (!Number.isInteger(limit)||limit<1||limit>100) throw scmError('SCM_INPUT_INVALID');
    const argv=['log','--all','--date=iso-strict','--format=%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1e','-n',String(limit)];
    if (ref) argv.push(branchName(ref));
    const out=await git(root,argv,{allowFailure:true});
    return {projectId,isRepo:true,commits:(out||'').split('\x1e').map(line=>line.trim()).filter(Boolean).map(line=>{const [hashValue,parents,refs,author,time,subject]=line.split('\x1f');return {hash:hashValue,parents:parents?parents.split(' '):[],refs:refs?refs.split(', '):[],author,time,subject};})};
  }
  async function diff(projectId,{file,staged=false}={}) {
    const root=await projectRoot(db,projectId); relativeFile(file);
    if (typeof staged!=='boolean'||!await isRepo(root)) throw scmError('SCM_INPUT_INVALID');
    const text=await git(root,['diff','--no-ext-diff','--no-textconv',...(staged?['--cached']:[]),'--',file]);
    if (text.length>1_000_000) throw scmError('SCM_DIFF_LIMIT');
    return {projectId,path:file,staged,diff:text};
  }
  function m2Busy(projectId) {
    const row=db.prepare(`SELECT 1 FROM m2_execution_claims c JOIN m2_execution_requests r ON r.execution_id=c.execution_id
      WHERE r.project_id=? AND NOT EXISTS(SELECT 1 FROM m2_execution_results result WHERE result.execution_id=c.execution_id)
        AND (c.lease_until_ms>? OR EXISTS(SELECT 1 FROM m2_execution_claim_renewals renewal
          WHERE renewal.execution_id=c.execution_id AND renewal.generation=c.generation AND renewal.lease_until_ms>?)) LIMIT 1`).get(projectId,clock(),clock());
    return !!row;
  }
  function networkAudit(plan, decision, reason, phase='decision') {
    const remote=plan.remote;
    if (!remote) return;
    const requestId=outbound.createRequestId(plan.id);
    outbound.append({requestId,phase,surface:'studio-scm',scope:'git.sync',method:'GIT',
      targetOrigin:`${remote.url.startsWith('https:')?'https':'ssh'}://${remote.host}`,
      targetDigest:outboundTargetDigest(remote.url),decision,reasonCode:reason});
  }
  async function prepare(input,actorId) {
    const args=validateInput(input);
    const root=await projectRoot(db,input.projectId), current=policy(input.projectId);
    const key=policyKey(input.op);
    if (key && current[key]==='disabled') throw scmError('SCM_POLICY_DISABLED');
    const before=await exactSnapshot(root);
    if (input.op==='init' ? before.repo : !before.repo) throw scmError('SCM_REPO_STATE_INVALID');
    if (['checkout','pull'].includes(input.op) && before.files.length) throw scmError('SCM_TREE_DIRTY');
    if (writeOps.has(input.op) && m2Busy(input.projectId)) throw scmError('SCM_PROJECT_BUSY');
    if (input.op==='stage' && args.paths.some(name=>!before.files.some(file=>file[0]===name))) throw scmError('SCM_PATH_NOT_CHANGED');
    if (input.op==='commit' && !args.all && !before.files.some(file=>file[1]!==' '&&file[1]!=='?')) throw scmError('SCM_INDEX_EMPTY');
    if (input.op==='checkout' && !(await git(root,['show-ref','--verify',`refs/heads/${args.name}`],{allowFailure:true}))) throw scmError('SCM_BRANCH_NOT_FOUND');
    if (input.op==='branch.create' && await git(root,['show-ref','--verify',`refs/heads/${args.name}`],{allowFailure:true})) throw scmError('SCM_BRANCH_EXISTS');
    let remote=null;
    if (networkOps.has(input.op)) {
      if (!before.branch) throw scmError('SCM_BRANCH_REQUIRED');
      remote=await remoteInfo(root,before.branch);
      if (!remote || !current.remotes.some(item=>item.name===remote.name&&item.host===remote.host)) {
        const denied={id:idFactory(),remote:remote||{url:'unconfigured',host:'unconfigured'}};
        audit(null,input.projectId,actorId,'network_denied',{op:input.op,host:remote?.host||null});
        if (remote) networkAudit(denied,'deny','SCM_HOST_DENIED');
        throw scmError('SCM_HOST_DENIED');
      }
      if (input.op==='pull' && (await status(input.projectId)).ahead && (await status(input.projectId)).behind) throw scmError('SCM_HISTORY_DIVERGED');
      if (input.op==='push' && !(await status(input.projectId)).upstream) throw scmError('SCM_UPSTREAM_REQUIRED');
    }
    const createdAt=clock(), id=idFactory();
    const plan={id,projectId:input.projectId,root,op:input.op,args,remote,before,
      policyRevision:current.revision,createdAt,expiresAt:createdAt+120000};
    const json=JSON.stringify(plan),digest=hash(json);
    db.transaction(()=>{db.prepare(`INSERT INTO scm_operations
      (plan_id,actor_id,project_id,op,plan_json,digest,policy_revision,created_at,expires_at,state)
      VALUES(?,?,?,?,?,?,?,?,?,'pending')`).run(id,actorId,input.projectId,input.op,json,digest,current.revision,createdAt,plan.expiresAt);
      audit(id,input.projectId,actorId,'prepared',{op:input.op,digest});}) .immediate();
    return {planId:id,digest,state:'pending',expiresAt:plan.expiresAt,plan};
  }
  function view(row) {
    if (!row) throw scmError('SCM_PLAN_NOT_FOUND');
    return {planId:row.plan_id,digest:row.digest,state:row.state,plan:JSON.parse(row.plan_json),
      result:row.result_json?JSON.parse(row.result_json):null,
      events:db.prepare('SELECT seq,kind,occurred_at AS occurredAt,detail_json FROM scm_events WHERE plan_id=? ORDER BY seq').all(row.plan_id)
        .map(({detail_json,...event})=>({...event,detail:JSON.parse(detail_json)}))};
  }
  function load(planId,actorId) {
    const row=db.prepare('SELECT * FROM scm_operations WHERE plan_id=? AND actor_id=?').get(planId,actorId);
    if (!row) throw scmError('SCM_PLAN_NOT_FOUND');return row;
  }
  async function execute(input,actorId) {
    if (!input || Object.keys(input).sort().join(',')!=='confirm,digest,planId' || input.confirm!==true
      || typeof input.planId!=='string' || typeof input.digest!=='string') throw scmError('SCM_APPROVAL_REQUIRED');
    const row=load(input.planId,actorId),plan=JSON.parse(row.plan_json);
    if (row.state!=='pending'||row.digest!==input.digest||clock()>row.expires_at) throw scmError('SCM_PLAN_STALE');
    if (policy(plan.projectId).revision!==plan.policyRevision) throw scmError('SCM_POLICY_STALE');
    if (await projectRoot(db,plan.projectId)!==plan.root || JSON.stringify(await exactSnapshot(plan.root))!==JSON.stringify(plan.before)) throw scmError('SCM_WORKSPACE_CHANGED');
    if (writeOps.has(plan.op) && m2Busy(plan.projectId)) throw scmError('SCM_PROJECT_BUSY');
    if (networkOps.has(plan.op)) {
      const current=policy(plan.projectId),remote=await remoteInfo(plan.root,plan.before.branch);
      if (!remote||remote.url!==plan.remote.url||!current.remotes.some(item=>item.name===remote.name&&item.host===remote.host)) {
        audit(plan.id,plan.projectId,actorId,'network_denied',{op:plan.op,host:remote?.host||null});
        networkAudit(plan,'deny','SCM_HOST_DENIED');throw scmError('SCM_HOST_DENIED');
      }
      networkAudit(plan,'allow','SCM_HOST_ALLOWED');
    }
    db.transaction(()=>{
      if (db.prepare("SELECT 1 FROM scm_operations WHERE project_id=? AND state='running'").get(plan.projectId)) throw scmError('SCM_PROJECT_BUSY');
      if (row.state!=='pending'||m2Busy(plan.projectId)) throw scmError('SCM_PROJECT_BUSY');
      const updated=db.prepare("UPDATE scm_operations SET state='running' WHERE plan_id=? AND state='pending'").run(plan.id);
      if (updated.changes!==1) throw scmError('SCM_PLAN_STALE');
      audit(plan.id,plan.projectId,actorId,'started',{op:plan.op});
    }).immediate();
    let result;
    try {
      const root=plan.root,a=plan.args;
      if (plan.op==='init') await git(root,['init','--template=','-b','main']);
      else if (plan.op==='stage') await git(root,['add','--',...a.paths]);
      else if (plan.op==='unstage') await git(root,['restore','--staged','--',...a.paths]);
      else if (plan.op==='commit') {
        if (a.all) await git(root,['add','-A','--',...plan.before.files.map(file=>file[0])]);
        await git(root,['-c','user.name=IntentSmith','-c','user.email=local@intentsmith.invalid','commit','-m',a.message]);
      } else if (plan.op==='branch.create') await git(root,['switch','-c',a.name]);
      else if (plan.op==='checkout') await git(root,['switch','--',a.name]);
      else if (plan.op==='fetch') await git(root,['fetch','--no-tags','--no-recurse-submodules',plan.remote.url,
        `+refs/heads/${plan.remote.branch}:refs/remotes/${plan.remote.name}/${plan.remote.branch}`],{timeout:60000});
      else if (plan.op==='pull') {
        await git(root,['fetch','--no-tags','--no-recurse-submodules',plan.remote.url,
          `+refs/heads/${plan.remote.branch}:refs/remotes/${plan.remote.name}/${plan.remote.branch}`],{timeout:60000});
        const mergeBase=(await git(root,['merge-base','HEAD','FETCH_HEAD'],{allowFailure:true}))?.trim();
        if (mergeBase!==(await git(root,['rev-parse','HEAD'])).trim()) throw scmError('SCM_HISTORY_DIVERGED');
        await git(root,['merge','--ff-only','FETCH_HEAD']);
      } else if (plan.op==='push') await git(root,['push',plan.remote.url,`HEAD:refs/heads/${plan.remote.branch}`],{timeout:60000});
      result={after:await snapshot(root),completedAt:clock()};
      db.transaction(()=>{
        if (networkOps.has(plan.op)) networkAudit(plan,'succeeded','SCM_GIT_SUCCEEDED','terminal');
        db.prepare("UPDATE scm_operations SET state='succeeded',result_json=? WHERE plan_id=? AND state='running'")
        .run(JSON.stringify({head:result.after.head,branch:result.after.branch,completedAt:result.completedAt}),plan.id);
        audit(plan.id,plan.projectId,actorId,'succeeded',{head:result.after.head,branch:result.after.branch});}) .immediate();
    } catch (error) {
      db.transaction(()=>{db.prepare("UPDATE scm_operations SET state='failed',result_json=? WHERE plan_id=? AND state='running'")
        .run(JSON.stringify({code:error.code||'SCM_GIT_FAILED',uncertain:true}),plan.id);
        audit(plan.id,plan.projectId,actorId,'failed',{code:error.code||'SCM_GIT_FAILED',uncertain:true});}) .immediate();
      if (networkOps.has(plan.op)) { try { networkAudit(plan,'failed','SCM_GIT_FAILED','terminal'); } catch { /* SCM failure remains uncertain and audited locally. */ } }
      throw error;
    }
    return view(load(plan.id,actorId));
  }
  function cancel(input,actorId) {
    if (!input||Object.keys(input).join(',')!=='planId'||typeof input.planId!=='string') throw scmError('SCM_INPUT_INVALID');
    const row=load(input.planId,actorId);
    if (row.state!=='pending') throw scmError('SCM_PLAN_STALE');
    db.transaction(()=>{db.prepare("UPDATE scm_operations SET state='cancelled' WHERE plan_id=? AND state='pending'").run(row.plan_id);
      audit(row.plan_id,row.project_id,actorId,'cancelled',{});}) .immediate();
    return view(load(row.plan_id,actorId));
  }
  return {policy,writePolicy,status,branches,log,diff,prepare,execute,cancel,
    operations:(projectId,actorId)=>db.prepare('SELECT * FROM scm_operations WHERE project_id=? AND actor_id=? ORDER BY created_at DESC LIMIT 30').all(projectId,actorId).map(view)};
}
