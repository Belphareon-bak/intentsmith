import './helpers/isolated-test-db.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { up as upScm } from '../src/db/migrations/2026_09_25_120_studio_scm.js';
import { up as upOutbound } from '../src/db/migrations/2026_08_26_089_m5_outbound_audit.js';
import { createScmService } from '../src/scm/service.js';
import { createScmRoutes } from '../src/routes/scm.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(),'studio-scm-test-'));
const dbs = [];
after(async()=>{ for(const db of dbs) db.close(); await fs.rm(temp,{recursive:true,force:true}); });
function rawGit(root,args) { return execFileSync('/usr/bin/git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim(); }
async function fixture({repo=true}={}) {
  const root=await fs.mkdtemp(path.join(temp,'project-'));
  const db=new Database(':memory:');dbs.push(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY,path TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE m2_execution_requests(execution_id TEXT PRIMARY KEY,project_id INTEGER NOT NULL);
    CREATE TABLE m2_execution_claims(execution_id TEXT,generation INTEGER,lease_until_ms INTEGER,PRIMARY KEY(execution_id,generation));
    CREATE TABLE m2_execution_claim_renewals(execution_id TEXT,generation INTEGER,lease_until_ms INTEGER);
    CREATE TABLE m2_execution_results(execution_id TEXT PRIMARY KEY);`);
  upOutbound(db);upScm(db);
  db.prepare("INSERT INTO projects VALUES(1,?,'active')").run(root);
  if(repo){rawGit(root,['init','--template=','-b','main']);await fs.writeFile(path.join(root,'one.txt'),'one\n');
    rawGit(root,['add','one.txt']);rawGit(root,['-c','user.name=Tester','-c','user.email=tester@example.invalid','commit','-m','Initial']);}
  return {root,db,service:createScmService({db}),git:args=>rawGit(root,args)};
}

test('SCM reads local status without invoking Git hooks or fetching',async()=>{
  const f=await fixture();const marker=path.join(f.root,'hook-fired');
  await fs.mkdir(path.join(f.root,'.git/hooks'),{recursive:true});
  await fs.writeFile(path.join(f.root,'.git/hooks/pre-commit'),`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o755});
  await fs.writeFile(path.join(f.root,'one.txt'),'changed\n');
  const status=await f.service.status(1);
  assert.equal(status.isRepo,true);assert.equal(status.branch,'main');
  assert.equal(status.files[0].path,'one.txt');assert.equal(status.files[0].unstaged,true);
  assert.equal((await f.service.branches(1)).branches[0].name,'main');
  assert.equal((await f.service.log(1)).commits.length,1);
  assert.match((await f.service.diff(1,{file:'one.txt'})).diff,/changed/);
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM scm_events').get().n,0,'reads add no effect audit');
  await f.service.prepare({projectId:1,op:'stage',args:{paths:['one.txt']}},'local-operator');
  assert.throws(()=>f.db.prepare("UPDATE scm_events SET kind='fake'").run(),/SCM_AUDIT_APPEND_ONLY/);
});

test('SCM exact plans reject forged approval, stale tree and disabled policy without effects',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.root,'one.txt'),'changed\n');
  const plan=await f.service.prepare({projectId:1,op:'stage',args:{paths:['one.txt']}},'local-operator');
  assert.equal(plan.state,'pending');assert.equal(f.git(['diff','--cached','--name-only']),'');
  await assert.rejects(f.service.execute({planId:plan.planId,digest:'sha256:forged',confirm:true},'local-operator'),/SCM_PLAN_STALE/);
  await assert.rejects(f.service.execute({planId:plan.planId,digest:plan.digest,confirm:'true'},'local-operator'),/SCM_APPROVAL_REQUIRED/);
  await fs.writeFile(path.join(f.root,'one.txt'),'raced\n');
  await assert.rejects(f.service.execute({planId:plan.planId,digest:plan.digest,confirm:true},'local-operator'),/SCM_WORKSPACE_CHANGED/);
  assert.equal(f.git(['diff','--cached','--name-only']),'');
  const policy=f.service.policy(1);assert.equal(policy.fetch,'disabled');assert.equal(policy.commit,'ask');
  await assert.rejects(f.service.prepare({projectId:1,op:'fetch'},'local-operator'),/SCM_POLICY_DISABLED/);
  assert.throws(()=>f.service.writePolicy({...policy,revision:99,fetch:'ask'},'local-operator'),/SCM_POLICY_STALE/);
});

test('SCM stage and commit change only confirmed project, suppress hooks and keep audit',async()=>{
  const f=await fixture();const marker=path.join(f.root,'hook-fired');
  await fs.mkdir(path.join(f.root,'.git/hooks'),{recursive:true});
  await fs.writeFile(path.join(f.root,'.git/hooks/pre-commit'),`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o755});
  await fs.writeFile(path.join(f.root,'one.txt'),'after\n');
  const stage=await f.service.prepare({projectId:1,op:'stage',args:{paths:['one.txt']}},'local-operator');
  assert.equal((await f.service.execute({planId:stage.planId,digest:stage.digest,confirm:true},'local-operator')).state,'succeeded');
  await fs.writeFile(path.join(f.root,'one.txt'),'after\nworking tree only\n');
  const both=await f.service.status(1);
  assert.equal(both.files[0].staged,true);
  assert.equal(both.files[0].unstaged,true);
  assert.equal(both.files[0].stagedAdded,1);
  assert.equal(both.files[0].unstagedAdded,1);
  const commit=await f.service.prepare({projectId:1,op:'commit',args:{message:'Reviewed change'}},'local-operator');
  assert.equal((await f.service.execute({planId:commit.planId,digest:commit.digest,confirm:true},'local-operator')).state,'succeeded');
  assert.equal(f.git(['log','-1','--format=%s']),'Reviewed change');
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  assert.equal(f.service.operations(1,'local-operator').length,2);
  assert.throws(()=>f.db.prepare("UPDATE scm_operations SET digest='fake' WHERE plan_id=?").run(commit.planId),/IMMUTABLE/);
});

test('SCM rejects remote outside project allowlist, force and dirty checkout before network or mutation',async()=>{
  const f=await fixture();f.git(['remote','add','origin','ssh://git@forbidden.example/repo.git']);
  f.git(['config','--local','branch.main.remote','origin']);
  f.git(['config','--local','branch.main.merge','refs/heads/main']);
  // Local config points at a remote, but no allowlisted host grants a network request.
  const pol=f.service.writePolicy({...f.service.policy(1),fetch:'ask'},'local-operator');
  await assert.rejects(f.service.prepare({projectId:1,op:'fetch'},'local-operator'),/SCM_HOST_DENIED/);
  assert.ok(f.db.prepare("SELECT 1 FROM scm_events WHERE kind='network_denied'").get());
  await assert.rejects(f.service.prepare({projectId:1,op:'push',args:{force:true}},'local-operator'),/SCM_INPUT_INVALID/);
  f.git(['branch','second']);await fs.writeFile(path.join(f.root,'one.txt'),'dirty\n');
  await assert.rejects(f.service.prepare({projectId:1,op:'checkout',args:{name:'second'}},'local-operator'),/SCM_TREE_DIRTY/);
  assert.equal(f.git(['branch','--show-current']),'main');
  assert.equal(pol.fetch,'ask');
});

test('database lock excludes M2 claim while SCM runs and restart marks it interrupted',async()=>{
  const f=await fixture();const plan=await f.service.prepare({projectId:1,op:'branch.create',args:{name:'feature'}},'local-operator');
  f.db.prepare("UPDATE scm_operations SET state='running' WHERE plan_id=?").run(plan.planId);
  f.db.prepare("INSERT INTO m2_execution_requests VALUES('m2-1',1)").run();
  assert.throws(()=>f.db.prepare("INSERT INTO m2_execution_claims VALUES('m2-1',1,9999999999999)").run(),/SCM_PROJECT_WRITE_BUSY/);
  const restarted=createScmService({db:f.db});
  assert.equal(restarted.operations(1,'local-operator')[0].state,'interrupted');
  assert.equal(f.git(['branch','--show-current']),'main');
});

test('HTTP SCM routes refuse forged local identity',async()=>{
  const f=await fixture();const routes=createScmRoutes({db:f.db,parseBody:async()=>({}),sendJSON:(res,status,body)=>({status,body}),scmService:f.service});
  const req={url:'/api/scm/status?projectId=1',authenticatedSubject:{actorType:'user',actorId:'local-operator'}};
  assert.equal((await routes['GET /api/scm/status'](req,{})).status,403);
  const local=createGlobalAuthAuthority({production:false}).authorize({routeKey:'POST /api/chat',headers:{},remoteAddress:'127.0.0.1'}).subject;
  assert.equal((await routes['GET /api/scm/status']({...req,authenticatedSubject:local},{})).status,200);
});

test('SCM rejects local URL rewrites and malformed upstream branch before a network plan', async () => {
  const f = await fixture();
  f.git(['remote', 'add', 'origin', 'ssh://git@allowed.example/repo.git']);
  f.git(['config', '--local', 'branch.main.remote', 'origin']);
  f.git(['config', '--local', 'branch.main.merge', 'refs/heads/main']);
  f.service.writePolicy({ ...f.service.policy(1), fetch: 'ask', remotes: [{ name: 'origin', host: 'allowed.example' }] }, 'local-operator');
  f.git(['config', '--local', 'url.ssh://git@other.example/.pushInsteadOf', 'ssh://git@allowed.example/']);
  await assert.rejects(f.service.prepare({ projectId: 1, op: 'fetch' }, 'local-operator'), /SCM_REMOTE_REWRITE_DENIED/);
  f.git(['config', '--local', '--unset', 'url.ssh://git@other.example/.pushInsteadOf']);
  f.git(['config', '--local', 'branch.main.merge', 'refs/heads/../other']);
  await assert.rejects(f.service.prepare({ projectId: 1, op: 'fetch' }, 'local-operator'), /SCM_BRANCH_INVALID/);
});
