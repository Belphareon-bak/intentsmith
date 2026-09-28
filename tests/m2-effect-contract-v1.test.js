import * as currentEffects from '../contracts/m2/effect-current.js';
import { createM2FileListPolicyPayload, createM2FileListTarget, createM2FileListSnapshot } from '../contracts/m2/file-list-snapshot-v1.js';
import { m2FileListBytesDigest, m2FileListOutputEvidenceRef, createM2FileListOutputEvidence, validateM2FileListOutputEvidence, m2FileListOutputBytesMatch } from '../contracts/m2/file-list-output-v1.js';
import assert from 'node:assert/strict';
import {
  M2_EFFECT_CONTRACT_KIND,
  M2_EFFECT_CONTRACT_STAGE,
  canonicalStringify,
  computeEffectArgvDigest,
  computeEffectRequestDigest,
  decodeM2EffectContract,
  encodeM2EffectContract,
  validateApprovalGrant,
  validateEffectRequest,
  validateEffectResult,
  validateEffectResultForRequest,
  validateEffectResultForRequestV1,
} from '../contracts/m2/effect-v1.js';
import { suite, test, summary } from './harness.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const CREATED = '2026-08-23T20:00:00.000Z';
const STARTED = '2026-08-23T20:00:01.000Z';
const COMPLETED = '2026-08-23T20:00:02.000Z';
const PAYLOAD_BYTES = 31;

function request(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
    version: 1,
    effectId: 'effect-1',
    runId: 'run-1',
    parentEffectId: null,
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    kind: 'fs.write',
    target: {
      type: 'filesystem',
      canonicalRoot: '/workspace/project',
      relativePath: 'src/app.js',
      resolvedRealpath: '/workspace/project/src/app.js',
    },
    payloadDigest: DIGEST_A,
    payloadBytes: PAYLOAD_BYTES,
    workspaceRevision: 'wsr1:revision-a',
    requiredCapability: 'project.fs.write',
    riskClass: 'write',
    timeoutMs: 120_000,
    idempotencyKey: 'write-app-1',
    approvalGrantId: null,
    createdAt: CREATED,
  };
  return { ...base, ...overrides };
}

function grant(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT,
    version: 1,
    grantId: 'grant-1',
    subject: { actorType: 'user', actorId: 'user-1' },
    scope: {
      runId: 'run-1',
      projectId: 17,
      effectId: 'effect-1',
      kind: 'fs.write',
      payloadDigest: DIGEST_A,
      payloadBytes: PAYLOAD_BYTES,
      workspaceRevision: 'wsr1:revision-a',
    },
    constraints: {
      allowedRealpaths: ['/workspace/project/src/app.js'],
      allowedBinary: null,
      allowedArgvDigest: null,
      allowedOrigin: null,
      maxBytes: PAYLOAD_BYTES,
    },
    issuedAt: CREATED,
    expiresAt: '2026-08-23T20:05:00.000Z',
    singleUse: true,
    nonce: 'nonce-000000000001',
    consumedAt: null,
    consumedByEffectId: null,
    revokedAt: null,
    revocationReason: null,
  };
  return { ...base, ...overrides };
}

function result(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: 'effect-1',
    runId: 'run-1',
    projectId: 17,
    requestDigest: computeEffectRequestDigest(request()),
    approvalGrantId: 'grant-1',
    terminalStatus: 'succeeded',
    startedAt: STARTED,
    completedAt: COMPLETED,
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: {
      paths: ['src/app.js'],
      beforeDigest: DIGEST_A,
      afterDigest: DIGEST_B,
      diffArtifact: 'artifact:diff-1',
    },
    network: {
      resolvedAddresses: [],
      finalUrl: null,
      status: null,
      bytes: 0,
    },
    rollback: {
      required: false,
      status: 'not_required',
      evidenceRef: null,
    },
    outputDigest: DIGEST_B,
    errorCode: null,
    evidenceRefs: ['artifact:diff-1'],
    lateCompletionRejected: false,
  };
  return { ...base, ...overrides };
}

suite('M2 EffectRequest/Result and ApprovalGrant executable contract');

test('contract stage is PINNED_V1 for exact-byte operator review', () => {
  assert.equal(M2_EFFECT_CONTRACT_STAGE, 'PINNED_V1');
});

test('valid request has a canonical byte-stable encoding and round-trip', () => {
  const value = request();
  assert.equal(validateEffectRequest(value).valid, true);
  const encoded = encodeM2EffectContract(value, M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST);
  assert.equal(encoded, canonicalStringify({ ...value }));
  assert.deepEqual(decodeM2EffectContract(encoded), value);
  assert(encoded.indexOf('"actor"') < encoded.indexOf('"approvalGrantId"'));
});

test('request rejects unknown fields and a false risk class', () => {
  const value = request({ extra: true, riskClass: 'read' });
  const checked = validateEffectRequest(value);
  assert.equal(checked.valid, false);
  assert(checked.errors.includes('effect-request:unknown-extra'));
  assert(checked.errors.includes('effect-request:risk-kind-mismatch'));
});

test('filesystem target rejects traversal, outside target and canonical alias mismatch', () => {
  const traversal = request({
    target: { ...request().target, relativePath: '../outside.js', resolvedRealpath: '/workspace/outside.js' },
  });
  const traversalErrors = validateEffectRequest(traversal).errors;
  assert(traversalErrors.includes('effect-request.target:invalid-relativePath'));
  assert(traversalErrors.includes('effect-request.target:outside-project'));

  const alias = request({
    target: { ...request().target, resolvedRealpath: '/workspace/project/releases/app.js' },
  });
  assert(validateEffectRequest(alias).errors.includes('effect-request.target:canonical-target-mismatch'));
});

test('request rejects a target discriminant that does not match its effect kind', () => {
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
  });
  assert.equal(validateEffectRequest(value).valid, false);
  assert(validateEffectRequest(value).errors.includes('effect-request.target:invalid-type'));
});

test('process target requires an absolute binary and argv array', () => {
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
    target: {
      type: 'process',
      binary: 'node',
      argv: 'script.js',
      argvDigest: DIGEST_A,
      canonicalCwd: '/workspace/project',
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target:invalid-binary'));
  assert(errors.includes('effect-request.target:invalid-argv'));
});

test('process argv digest is derived from exact ordered argv bytes', () => {
  const argv = ['node', 'script.js', '--mode=test'];
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
    target: {
      type: 'process',
      binary: '/usr/bin/node',
      argv,
      argvDigest: computeEffectArgvDigest(argv),
      canonicalCwd: '/workspace/project',
    },
  });
  assert.equal(validateEffectRequest(value).valid, true);
  value.target.argv = [...argv, '--drift'];
  assert(validateEffectRequest(value).errors.includes('effect-request.target:argvDigest-mismatch'));
});

test('network target rejects credentialed and non-normalized URLs', () => {
  const value = request({
    kind: 'network.request',
    riskClass: 'network',
    target: {
      type: 'network',
      url: 'https://user:pass@example.com',
      origin: 'https://example.com',
      method: 'GET',
      redirectPolicy: 'revalidate',
      dnsPolicy: 'public-only',
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target:credentialed-url'));
  assert(errors.includes('effect-request.target:url-not-normalized'));
});

test('git target requires exact revision and bytewise-sorted unique paths', () => {
  const value = request({
    kind: 'git.commit',
    riskClass: 'write',
    target: {
      type: 'git',
      canonicalRepo: '/workspace/project',
      paths: ['src/z.js', 'src/a.js'],
      expectedWorkspaceRevision: 'wsr1:stale',
      remote: null,
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target.paths:not-bytewise-sorted-unique'));
  assert(errors.includes('effect-request.target:workspace-revision-mismatch'));
});

test('request rejects non-canonical timestamps and malformed digests', () => {
  const checked = validateEffectRequest(request({
    payloadDigest: 'a'.repeat(64),
    createdAt: '2026-08-23T20:00:00Z',
  }));
  assert(checked.errors.includes('effect-request:invalid-payloadDigest'));
  assert(checked.errors.includes('effect-request:invalid-createdAt'));
});

test('request rejects a self-referential effect lineage', () => {
  const checked = validateEffectRequest(request({ parentEffectId: 'effect-1' }));
  assert(checked.errors.includes('effect-request:self-parent'));
});

test('fresh exact single-use grant is valid', () => {
  assert.equal(validateApprovalGrant(grant()).valid, true);
});

test('request digest excludes grant binding but covers payload byte count', () => {
  const original = request();
  assert.equal(
    computeEffectRequestDigest({ ...original, approvalGrantId: 'grant-1' }),
    computeEffectRequestDigest(original),
  );
  assert.notEqual(
    computeEffectRequestDigest({ ...original, payloadBytes: original.payloadBytes + 1 }),
    computeEffectRequestDigest(original),
  );
});

test('grant rejects partial or simultaneous consumed and revoked states', () => {
  const partial = validateApprovalGrant(grant({ consumedAt: COMPLETED }));
  assert(partial.errors.includes('approval-grant:invalid-consumedByEffectId'));
  assert(partial.errors.includes('approval-grant:partial-consumption'));

  const terminalConflict = validateApprovalGrant(grant({
    consumedAt: STARTED,
    consumedByEffectId: 'effect-1',
    revokedAt: COMPLETED,
    revocationReason: 'cancelled',
  }));
  assert(terminalConflict.errors.includes('approval-grant:consumed-and-revoked'));
});

test('grant rejects invalid expiry and non-single-use claims', () => {
  const checked = validateApprovalGrant(grant({ expiresAt: CREATED, singleUse: false }));
  assert(checked.errors.includes('approval-grant:invalid-expiry-order'));
  assert(checked.errors.includes('approval-grant:singleUse-required'));
});

test('grant rejects consumption at expiry and permits defensive revocation before issuance', () => {
  const consumed = validateApprovalGrant(grant({
    consumedAt: '2026-08-23T20:05:00.000Z',
    consumedByEffectId: 'effect-1',
  }));
  assert(consumed.errors.includes('approval-grant:invalid-consumption-time'));
  const revoked = validateApprovalGrant(grant({
    revokedAt: '2026-08-23T19:59:59.999Z',
    revocationReason: 'cancelled',
  }));
  assert.equal(revoked.valid, true);
});

test('successful EffectResult is valid and failure requires an error code', () => {
  assert.equal(validateEffectResult(result()).valid, true);
  const failure = validateEffectResult(result({ terminalStatus: 'failed', errorCode: null }));
  assert(failure.errors.includes('effect-result:missing-errorCode'));
});

test('every EffectResult requires exact approval and request authority identity', () => {
  const withoutApproval = validateEffectResult(result({ approvalGrantId: null }));
  assert(withoutApproval.errors.includes('effect-result:invalid-approvalGrantId'));
  assert.equal(validateEffectResult(result({ projectId: '17' })).valid, false);
  assert.equal(validateEffectResult(result({ requestDigest: 'not-a-digest' })).valid, false);
});

test('EffectResult rejects time inversion and contradictory rollback state', () => {
  const checked = validateEffectResult(result({
    startedAt: COMPLETED,
    completedAt: STARTED,
    rollback: { required: false, status: 'failed', evidenceRef: null },
  }));
  assert(checked.errors.includes('effect-result:time-order'));
  assert(checked.errors.includes('effect-result.rollback:unexpected-status'));
});

test('EffectResult network evidence rejects credentials and non-IP addresses', () => {
  const checked = validateEffectResult(result({
    network: {
      resolvedAddresses: ['not-an-ip'],
      finalUrl: 'https://user:secret@example.com/',
      status: 200,
      bytes: 1,
    },
  }));
  assert(checked.errors.includes('effect-result.network.resolvedAddresses[0]:invalid'));
  assert(checked.errors.includes('effect-result.network:credentialed-finalUrl'));
});

test('historical v1 stays frozen while current process.exec requires execution evidence', () => {
  const argv = ['/workspace/project/test.js'];
  const processRequest = request({
    approvalGrantId: 'grant-1',
    kind: 'process.exec',
    riskClass: 'exec',
    requiredCapability: 'project.process.exec',
    target: {
      type: 'process',
      binary: '/usr/bin/node',
      argv,
      argvDigest: computeEffectArgvDigest(argv),
      canonicalCwd: '/workspace/project',
    },
  });
  const emptyProcessSuccess = result({
    requestDigest: computeEffectRequestDigest(processRequest),
    process: {
      pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null,
    },
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    outputDigest: DIGEST_B,
    evidenceRefs: ['effect:process:test'],
  });
  assert.equal(validateEffectResultForRequestV1(processRequest, emptyProcessSuccess).valid, true);
  const checked = validateEffectResultForRequest(processRequest, emptyProcessSuccess);
  assert.equal(checked.valid, false);
  assert(checked.errors.includes('effect-result:process-exec-success-process-evidence-missing'));

  const proven = {
    ...emptyProcessSuccess,
    process: {
      pid: 4242,
      processGroupId: 4242,
      startIdentity: 'process-start-1',
      exitCode: 0,
      signal: null,
    },
  };
  assert.equal(validateEffectResultForRequest(processRequest, proven).valid, true);
});

test('expired and revoked pre-execution approvals are one evidence-free cancellation shape for every kind', () => {
  const filesystemTarget = request().target;
  const argv = ['--version'];
  const cases = [
    ['fs.read', 'read', filesystemTarget],
    ['fs.write', 'write', filesystemTarget],
    ['fs.delete', 'destructive', filesystemTarget],
    ['process.exec', 'exec', {
      type: 'process', binary: '/usr/bin/node', argv,
      argvDigest: computeEffectArgvDigest(argv), canonicalCwd: '/workspace/project',
    }],
    ['network.request', 'network', {
      type: 'network', url: 'https://example.com/', origin: 'https://example.com',
      method: 'GET', redirectPolicy: 'revalidate', dnsPolicy: 'public-only',
    }],
    ['git.commit', 'write', {
      type: 'git', canonicalRepo: '/workspace/project', paths: ['src/app.js'],
      expectedWorkspaceRevision: 'wsr1:revision-a', remote: null,
    }],
    ['git.push', 'network', {
      type: 'git', canonicalRepo: '/workspace/project', paths: ['src/app.js'],
      expectedWorkspaceRevision: 'wsr1:revision-a', remote: 'origin',
    }],
  ];
  for (const [index, [kind, riskClass, target]] of cases.entries()) {
    const exactRequest = request({
      effectId: `effect-approval-${index}`,
      idempotencyKey: `approval-operation-${index}`,
      kind,
      riskClass,
      target,
    });
    for (const errorCode of ['APPROVAL_GRANT_EXPIRED', 'APPROVAL_GRANT_REVOKED']) {
      const terminal = result({
        effectId: exactRequest.effectId,
        requestDigest: computeEffectRequestDigest(exactRequest),
        terminalStatus: 'cancelled',
        changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
        rollback: { required: false, status: 'not_required', evidenceRef: null },
        outputDigest: null,
        errorCode,
        evidenceRefs: [`effect:${exactRequest.effectId}:${errorCode.toLowerCase()}`],
        lateCompletionRejected: false,
      });
      assert.equal(
        validateEffectResultForRequest(exactRequest, terminal).valid,
        true,
        `${kind}/${errorCode}`,
      );
    }
  }
});

test('pre-execution approval cancellation rejects any effect, rollback, output or late evidence', () => {
  const exactRequest = request();
  const terminal = result({
    requestDigest: computeEffectRequestDigest(exactRequest),
    terminalStatus: 'cancelled',
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: null,
    errorCode: 'APPROVAL_GRANT_EXPIRED',
    evidenceRefs: ['effect:effect-1:approval-grant-expired'],
    lateCompletionRejected: false,
  });
  const mutations = [
    { ...terminal, terminalStatus: 'failed' },
    { ...terminal, changes: { ...terminal.changes, paths: ['src/app.js'] } },
    { ...terminal, process: { ...terminal.process, pid: 4242 } },
    { ...terminal, network: { ...terminal.network, status: 503 } },
    { ...terminal, rollback: { required: true, status: 'pending', evidenceRef: 'rollback:1' } },
    { ...terminal, outputDigest: DIGEST_A },
    { ...terminal, lateCompletionRejected: true },
  ];
  for (const candidate of mutations) {
    assert.equal(validateEffectResultForRequest(exactRequest, candidate).valid, false);
  }
});

test('git.commit success is exact-path and an in-doubt failure cannot claim zero effects', () => {
  const gitRequest = request({
    approvalGrantId: 'grant-1',
    kind: 'git.commit',
    riskClass: 'write',
    requiredCapability: 'project.git.commit',
    target: {
      type: 'git',
      canonicalRepo: '/workspace/project',
      paths: ['src/app.js'],
      expectedWorkspaceRevision: 'wsr1:revision-a',
      remote: null,
    },
  });
  const success = result({
    requestDigest: computeEffectRequestDigest(gitRequest),
    process: {
      pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null,
    },
    changes: {
      paths: ['src/app.js'], beforeDigest: DIGEST_A, afterDigest: DIGEST_B, diffArtifact: null,
    },
    outputDigest: DIGEST_B,
    evidenceRefs: ['effect:git:test'],
  });
  assert.equal(validateEffectResultForRequest(gitRequest, success).valid, true);

  const foreignPath = {
    ...success,
    changes: { ...success.changes, paths: ['src/foreign.js'] },
  };
  assert(validateEffectResultForRequest(gitRequest, foreignPath).errors
    .includes('effect-result:git-commit-path-evidence-mismatch'));

  const falseInDoubt = result({
    requestDigest: computeEffectRequestDigest(gitRequest),
    terminalStatus: 'failed',
    process: {
      pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null,
    },
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: null,
    errorCode: 'GIT_COMMIT_IN_DOUBT',
    evidenceRefs: ['effect:git:in-doubt'],
  });
  const checked = validateEffectResultForRequest(gitRequest, falseInDoubt);
  assert.equal(checked.valid, false);
  assert(checked.errors.includes('effect-result:git-commit-pre-effect-error-code-mismatch'));
});

suite('EffectRequest@2 exact project-root listing alongside immutable version1');
function rootListRequest(overrides = {}) {
  const payload = createM2FileListPolicyPayload();
  return request({version:2,effectId:'effect:'+ 'a'.repeat(64),kind:'fs.read',riskClass:'read',
    requiredCapability:'project.fs.list',target:createM2FileListTarget('/workspace/project'),
    payloadBytes:payload.length,payloadDigest:m2FileListBytesDigest(payload),...overrides});
}
function rootListGrant(value = rootListRequest()) {
  return grant({scope:{runId:value.runId,projectId:value.origin.projectId,effectId:value.effectId,
    kind:value.kind,payloadDigest:value.payloadDigest,payloadBytes:value.payloadBytes,workspaceRevision:value.workspaceRevision},
    constraints:currentEffects.deriveApprovalGrantConstraints(value)});
}
function rootListResult(value = rootListRequest(), overrides = {}) {
  return result({effectId:value.effectId,requestDigest:currentEffects.computeEffectRequestDigest(value),
    changes:{paths:[],beforeDigest:null,afterDigest:null,diffArtifact:null},...overrides});
}

test('version2 serializes the real root and old version1 still rejects it',()=>{
  const value=rootListRequest();
  assert.equal(currentEffects.validateEffectRequest(value).valid,true);
  assert.equal(validateEffectRequest(value).valid,false);
  assert.equal(validateEffectRequest({...value,version:1}).valid,false);
  assert.deepEqual(currentEffects.decodeM2EffectContract(currentEffects.encodeM2EffectContract(value)),value);
  assert.equal(currentEffects.computeEffectRequestDigest({...value,approvalGrantId:'grant-1'}),currentEffects.computeEffectRequestDigest(value));
  for(const old of [request(),request({kind:'fs.read',riskClass:'read',requiredCapability:'project.fs.read'})]) {
    assert.equal(currentEffects.computeEffectRequestDigest(old),computeEffectRequestDigest(old));
    assert.equal(currentEffects.encodeM2EffectContract(old),encodeM2EffectContract(old));
    assert.deepEqual(currentEffects.validateEffectRequest(old),validateEffectRequest(old));
  }
});

test('version2 rejects every other kind capability target and caller-supplied resource policy',()=>{
  const value=rootListRequest();
  const mutations=[{version:3},{kind:'fs.write',riskClass:'write'},{kind:'network.request'},
    {requiredCapability:'project.fs.read'},{riskClass:'write'},
    {actor:{type:'model',id:'model-1'}},{actor:{type:'user',id:'../other'}},
    {origin:{...value.origin,projectId:null}},{origin:{...value.origin,projectId:0}},
    {origin:{...value.origin,conversationId:null}},{origin:{...value.origin,extra:true}},
    {target:{...value.target,relativePath:'./'}},{target:{...value.target,relativePath:'child'}},
    {target:{...value.target,type:'filesystem'}},{target:{...value.target,resolvedRealpath:'/other'}},
    {target:{...value.target,canonicalRoot:'/workspace/project/../project'}},
    {target:{...value.target,recursive:true}},{payloadBytes:value.payloadBytes+1},
    {payloadDigest:DIGEST_B},{extra:true},{workspaceRevision:' '},{timeoutMs:0},{timeoutMs:86400001},
    {createdAt:'2026-08-23T20:00:00Z'}];
  for(const mutation of mutations)assert.equal(currentEffects.validateEffectRequest({...value,...mutation}).valid,false,JSON.stringify(mutation));
  const smaller=createM2FileListPolicyPayload({maxEntries:1});
  assert.equal(currentEffects.validateEffectRequest({...value,payloadBytes:smaller.length,payloadDigest:m2FileListBytesDigest(smaller)}).valid,false);
});

test('listing grant remains single-use exact actor project request root and policy with no global capability',()=>{
  const value=rootListRequest(), permission=rootListGrant(value);
  assert.equal(validateApprovalGrant(permission).valid,true);
  assert.equal(currentEffects.validateApprovalGrantForRequest(value,permission).valid,true);
  assert.equal(currentEffects.validateApprovalGrantForRequest({...value,target:createM2FileListTarget('/other')},permission).valid,false);
  for(const changed of [{...permission,scope:{...permission.scope,projectId:18}},
    {...permission,subject:{actorType:'user',actorId:'other'}},{...permission,singleUse:false},
    {...permission,constraints:{...permission.constraints,allowedRealpaths:['/workspace']}},
    {...permission,constraints:{...permission.constraints,maxBytes:value.payloadBytes+1}},
    {...permission,constraints:{...permission.constraints,allowedBinary:'/bin/sh'}}]) {
    assert.equal(currentEffects.validateApprovalGrantForRequest(value,changed).valid,false);
  }
});

test('listing result cannot carry changes processes network rollback late bytes or a foreign request digest',()=>{
  const value=rootListRequest(), completed=rootListResult(value);
  assert.equal(currentEffects.validateEffectResultForRequest(value,completed).valid,true);
  for(const changed of [{...completed,requestDigest:DIGEST_A},{...completed,projectId:18},
    {...completed,process:{...completed.process,pid:123}},{...completed,network:{...completed.network,bytes:1}},
    {...completed,changes:{...completed.changes,paths:['file']}},{...completed,rollback:{required:true,status:'pending',evidenceRef:'pending'}},
    {...completed,lateCompletionRejected:true},{...completed,outputDigest:null},{...completed,evidenceRefs:[]}]) {
    assert.equal(currentEffects.validateEffectResultForRequest(value,changed).valid,false);
  }
  for(const terminalStatus of ['cancelled','timed_out','orphaned','failed']){
    const failure=rootListResult(value,{terminalStatus,errorCode:'EFFECT_CANCELLED',outputDigest:null});
    assert.equal(currentEffects.validateEffectResultForRequest(value,failure).valid,true);
    assert.equal(currentEffects.validateEffectResultForRequest(value,{...failure,outputDigest:DIGEST_B}).valid,false);
  }
});

test('listing metadata validates exact canonical snapshot bytes with a separate immutable reference digest',()=>{
  const value=rootListRequest();const snapshot=createM2FileListSnapshot([{nameBase64:Buffer.from('name').toString('base64'),type:'file'}]);
  const completed=rootListResult(value,{outputDigest:snapshot.digest,evidenceRefs:[m2FileListOutputEvidenceRef(value.effectId)]});
  const evidence=createM2FileListOutputEvidence(value,completed,snapshot.bytes);
  assert.equal(validateM2FileListOutputEvidence(value,completed,evidence),true);
  assert.equal(m2FileListOutputBytesMatch(value,evidence,snapshot.bytes),true);
  for(const bytes of [Buffer.from('{}'),Buffer.from(snapshot.bytes.toString()+' '),Buffer.from(snapshot.bytes.toString().replace('file','directory'))])assert.equal(m2FileListOutputBytesMatch(value,evidence,bytes),false);
  assert.equal(validateM2FileListOutputEvidence(value,completed,{...evidence,path:'child'}),false);
  assert.equal(validateM2FileListOutputEvidence(value,completed,{...evidence,contentRef:evidence.contentRef.replace('file-list','file-read')}),false);
  assert.equal(validateM2FileListOutputEvidence(value,completed,{...evidence,extra:true}),false);
  assert.equal(validateM2FileListOutputEvidence(value,completed,Object.assign(Object.create({}),evidence)),false);
  assert.equal(validateM2FileListOutputEvidence(value,completed,Object.assign(Object.create(null),evidence)),true);
});

summary();
