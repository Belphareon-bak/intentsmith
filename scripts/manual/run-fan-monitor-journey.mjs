#!/usr/bin/env node
// Manual qualification runner. Default preflight has no provider effects.
// D1 entry remains blocked by project routing; explicit operator CODE entry requires its own reviewed freeze.
// Existing runtime/Studio/relay/GPU/process primitives; no handwritten subject.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import * as Runtime from '../run-project-build-journey.js';
const { makeRuntime, startServer, stopServer, startLiteralStudio, stopLiteralStudio, requestJson, trackNetwork } = Runtime;
import { createOwnedProviderRelay } from '../project-app-provider-relay.js';
import { acquireGpuEvaluationLock, assessScheduledEvaluationReadiness } from '../../src/upgrade/gpu-evaluation-lock.js';
import { processSandboxProvider } from '../../src/execution/process-sandbox-provider.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../../src/execution/process-supervisor-child.js';
import { computeM2ExecutionValueDigest } from '../../contracts/m2/execution-v1.js';
import { buildCodeDraftPrompt, compileCodeDraftInput, compileCodeDraftResult } from '../../src/lifecycle/m2-code-draft.js';
import { CODE_RUNTIME_PROFILE } from '../../src/llm/model-runtime-profile.js';
import { PROJECT_DISCUSSION_SCHEMA, PROJECT_DISCUSSION_SYSTEM } from '../../src/chat/handlers/project-collaboration.js';
import { TARGETS, TEST_ARGV, createFanCallBudget, bindActualConversation, captureRealD1Proposal,
  prepareActualCapturedPlan, prepareActualFailedRevision, prepareActualManualDraft, validateManualDraft, makeManualRevision, approveRenderedExactPlan, reloadActualStatus } from './fan-monitor-studio2-controller.mjs';
import { assertFanSubjectSourcePolicy, assertProtectedSourceHashes } from './fan-monitor-source-policy.mjs';
const SELF = fileURLToPath(import.meta.url), PREPARATION = path.dirname(SELF);
const SOURCE = path.resolve(PREPARATION, '../..'), ARTIFACTS = path.join(SOURCE, '.intentsmith-artifacts');
const MODEL = 'qwen3.8:latest', DIGEST = '22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643';
const VERSION = '0.34.0-intentsmith.1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (root, name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const safeEnv = () => Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'INTENTSMITH_STUDIO_DISPLAY', 'INTENTSMITH_STUDIO_XAUTHORITY']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
function git(root, args) { return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', env: {
  PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } }).trim(); }
function commitOperator(root, files, message) {
  git(root, ['add', '--', ...files]);
  git(root, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=IntentSmith Qualification',
    '-c', 'user.email=qualification@example.invalid', 'commit', '-m', message]);
}
function observeSource(freeze) {
  return { head: git(SOURCE, ['rev-parse', 'HEAD']), dirty: git(SOURCE, ['status', '--porcelain=v1']),
    closure: Object.fromEntries(Object.keys(freeze.closure).sort().map(relative => {
      assert.ok(relative && !path.isAbsolute(relative) && !relative.split('/').includes('..'));
      return [relative, sha(fs.readFileSync(path.join(SOURCE, relative)))];
    })) };
}
export function validateFreeze(freeze) {
  assert.equal(freeze.kind, 'FanJourneyFreeze@1'); assert.match(freeze.sourceSha, /^[0-9a-f]{40}$/);
  assert.equal(freeze.status, 'FROZEN_REVIEWED_FOR_LIVE', 'draft proposals cannot start live work');
  assert.equal(freeze.model, MODEL); assert.equal(freeze.digest, DIGEST); assert.equal(freeze.providerVersion, VERSION);
  assert.equal(freeze.d1Context, 8192); assert.equal(freeze.codeContext, freeze.resumeFailed ? 32768 : 16384);
  if (freeze.resumeFailed) {
    assert.equal(CODE_RUNTIME_PROFILE.contextWindowTokens, freeze.codeContext);
    assert.equal(CODE_RUNTIME_PROFILE.model, freeze.model); assert.equal(CODE_RUNTIME_PROFILE.digestSha256, freeze.digest);
    assert.equal(freeze.resumePending, undefined, 'choose exactly one preserved-state continuation');
    assert.equal(freeze.entryMode, 'manual'); validateFailedResumePins(freeze);
  }
  const entryMode = freeze.entryMode ?? 'd1'; assert.ok(['d1', 'manual'].includes(entryMode));
  assert.equal(freeze.maximumCode, 11); assert.equal(freeze.maximumD1, entryMode === 'manual' ? 0 : 8);
  if (freeze.resumePending) assert.equal(entryMode, 'manual', 'only the preserved explicit CODE journey may continue');
  if (entryMode === 'manual') {
    assert.deepEqual(Object.keys(freeze.manualDrafts).sort(), ['cli', 'core']);
    for (const phase of ['core', 'cli']) {
      validateManualDraft(freeze.manualDrafts[phase], { phase, nodeBinary: freeze.nodeBinary });
      compileCodeDraftInput(freeze.manualDrafts[phase]);
    }
  }
  assert.equal(freeze.nodeBinary, process.execPath); assert.match(process.version, /^v24\./);
  assert.equal(Runtime.OWNED_RUNTIME_SPAWN_HOOK_VERSION, 'fan-owned-spawn-v1', 'ROOT must adopt reviewed runtime ownership hook before live');
  assert.ok(freeze.closure && Object.keys(freeze.closure).length >= 12, 'source/controller/native/build closure must be frozen');
  for (const required of [path.relative(SOURCE, SELF), path.relative(SOURCE, path.join(PREPARATION, 'fan-monitor-studio2-controller.mjs')),
    path.relative(SOURCE, path.join(PREPARATION, 'fan-monitor-source-policy.mjs')), 'package-lock.json',
    'src/lifecycle/m2-code-draft.js', 'src/lifecycle/m2-lifecycle-application-service.js', 'src/llm/gateway.js',
    'src/llm/model-runtime-profile.js', 'src/llm/model-ctx.js', 'src/lifecycle/m2-import-scanner.js',
    'scripts/run-project-build-journey.js', 'intentsmith-ide/yarn.lock',
    'intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-controller.js',
    'intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/work-activity.js',
    'intentsmith-ide/applications/electron/lib/frontend/bundle.js', 'intentsmith-ide/applications/electron/lib/frontend/index.html',
    'intentsmith-ide/applications/electron/lib/frontend/preload.js', 'intentsmith-ide/applications/electron/lib/backend/electron-main.js']) {
    assert.match(freeze.closure[required] || '', /^[0-9a-f]{64}$/, 'required source/build closure missing:' + required);
  }
  assert.equal(freeze.nodeBinarySha256, sha(fs.readFileSync(process.execPath)), 'exact Node executable');
  for (const digest of Object.values(freeze.closure)) assert.match(digest, /^[0-9a-f]{64}$/);
  for (const name of ['projectGoal', 'firstRequest', 'secondRequest']) assert.ok(typeof freeze.inputs?.[name] === 'string' && freeze.inputs[name]);
  const required = ['scripts/fan-monitor-oracle-proposed.mjs', 'scripts/fan-monitor-entry-oracle.mjs',
    'test/operator-core-oracle.test.mjs', 'test/operator-cli-oracle.test.mjs'];
  assert.deepEqual(Object.keys(freeze.operatorFiles).sort(), required.sort());
  for (const row of Object.values(freeze.operatorFiles)) {
    assert.ok(path.isAbsolute(row.source)); assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.equal(sha(fs.readFileSync(row.source)), row.sha256);
  }
  assert.equal(freeze.operatorFiles['scripts/fan-monitor-oracle-proposed.mjs'].sha256,
    'a6a240df97ccff493add59747dbf518cc6b5a8c7e23607a5b942babd24091609');
  assert.deepEqual(freeze.repairSelectionPolicy, freeze.resumeFailed
    ? { eligiblePaths: TARGETS, maximumTargets: 4, maximumLifecyclesPerIncrement: 1, waitMs: 0, cliRepairAllowed: false }
    : { eligiblePaths: TARGETS, maximumTargets: 2, maximumLifecyclesPerIncrement: 1, waitMs: 180000 });
  assert.ok(freeze.reviewReceipts?.length >= 1, 'independent reviewed oracle/controller freeze required');
  for (const row of freeze.reviewReceipts) { assert.ok(path.isAbsolute(row.path)); assert.equal(sha(fs.readFileSync(row.path)), row.sha256); }
  return freeze;
}

export function classifyGeneration(body, freeze, admission, priorRequests = []) {
  const system = body.messages?.find(message => message.role === 'system')?.content;
  const user = body.messages?.findLast(message => message.role === 'user')?.content;
  assert.equal(body.model, freeze.model); assert.equal(body.stream, false);
  assert.equal(body.options?.temperature, 0.1); assert.ok(typeof system === 'string' && typeof user === 'string');
  let role;
  if (body.format?.required?.includes('reply') && body.format?.required?.includes('plan')) {
    assert.notEqual(freeze.entryMode, 'manual', 'manual CODE qualification admits zero D1/support calls');
    role = 'D1'; assert.equal(body.options.num_ctx, freeze.d1Context);
    assert.deepEqual(body.format, PROJECT_DISCUSSION_SCHEMA);
    assert.ok(system.endsWith(PROJECT_DISCUSSION_SYSTEM), 'exact D1 base instructions with clock prefix');
    const input = JSON.parse(user); assert.equal(input.request, admission.request);
    assert.equal(input.project.id, admission.projectId);
    assert.ok(body.options.num_predict >= 512 && body.options.num_predict <= 2200);
    assert.ok(Buffer.byteLength(system + user) <= (freeze.d1Context - body.options.num_predict - 384) * 2);
  } else {
    role = 'CODE'; assert.equal(body.options.num_ctx, freeze.codeContext);
    assert.ok(admission.draft, 'actual Studio composed draft must be frozen before CODE');
    const repair = admission.kind === 'repair';
    const expectedFormat = repair ? { type: 'object', required: ['replacements'], additionalProperties: false,
      properties: { replacements: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', required: ['before', 'after'], additionalProperties: false,
        properties: { before: { type: 'string', minLength: 1 }, after: { type: 'string' } } } } } }
      : { type: 'object', required: ['afterContent'], additionalProperties: false, properties: { afterContent: { type: ['string', 'null'] } } };
    assert.deepEqual(body.format, expectedFormat); assert.equal(body.options.num_predict, repair ? 2048 : 4096);
    const compiled = compileCodeDraftInput(admission.draft);
    const input = JSON.parse(user), target = typeof input.path === 'number' ? input.paths?.[input.path] : input.path;
    const index = compiled.changes.findIndex(change => change.path === target);
    const step = compiled.buildSteps.find(item => item.index === index); assert.ok(step, 'actual target step required');
    const matching = relative => priorRequests.filter(row => row.role === 'CODE' && row.admission?.phase === admission.phase
      && row.admission?.kind === admission.kind && (() => { const value = JSON.parse(row.body.messages.findLast(message => message.role === 'user').content);
        return (typeof value.path === 'number' ? value.paths?.[value.path] : value.path) === relative; })());
    assert.equal(matching(target).length, 0, 'no duplicate target inference');
    const peers = step.dependsOn.map(relative => {
      const dependency = compiled.buildSteps.find(item => compiled.changes[item.index].path === relative);
      const generated = matching(relative); assert.ok(generated.length <= 1, 'one full dependency output');
      let content;
      if (generated.length) {
        assert.equal(generated[0].physicalIdentityComplete, true);
        content = compileCodeDraftResult(compiled, { finishReason: 'stop', content: generated[0].terminal.message.content },
          dependency.index, repair ? admission.previousFiles[relative].content : null).changes[0].afterContent;
      } else {
        assert.equal(dependency.reusePrevious, true, 'declared dependency must already have a complete output');
        content = admission.previousFiles[relative].content;
      }
      return { path: relative, content, state: 'proposed' };
    }).concat(step.contextFiles.map(relative => {
      const file = admission.readOnlyFiles?.[relative]; assert.ok(file, 'captured actual read-only context required');
      assert.equal(file.contentDigest, 'sha256:' + sha(file.content), 'read-only bytes bind their captured digest');
      return { path: relative, ...file };
    }));
    assert.ok(Object.hasOwn(admission.beforeFiles, target), 'actual original bytes required');
    const expected = buildCodeDraftPrompt(compiled, admission.beforeFiles[target], index, peers,
      repair ? admission.previousFiles[target] : null);
    assert.equal(system, expected.systemPrompt, 'exact product CODE instruction signature');
    assert.equal(user, expected.prompt, 'exact compiled target/dependency/full-source/read-only input');
    assert.ok(TARGETS[admission.phase].includes(target), 'CODE target stays within frozen increment');
    if (repair) {
      assert.ok(admission.repairSelection?.targets.includes(target), 'repair CODE target must match failure-bound selected subset');
      assert.equal(admission.draft.revisionOf.lifecycleId, admission.repairSelection.failedLifecycleId);
      assert.equal(admission.draft.revisionOf.planDigest, admission.repairSelection.planDigest);
    }
    assert.equal(admission.draft.files.find(file => file.path === target)?.reusePrevious, repair ? false : undefined);
    assert.ok(Buffer.byteLength(system + user) <= (freeze.codeContext - body.options.num_predict - 384) * 2);
  }
  return role;
}

export function createFanProviderProxy({ freeze, out, requests, onModelCall }) {
  const budget = createFanCallBudget({ d1Model: freeze.model, codeModel: freeze.model, entryMode: freeze.entryMode ?? 'd1', historicalRows: requests.filter(row => row.admission).map(row => row.admission), continuationMode: freeze.resumeFailed ? 'failed-core4-cli3' : null }); let lastKey = null, stopped = false;
  return createOwnedProviderRelay(async (incoming, outgoing, forward) => {
    let row;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; assert.ok(size <= 1000000); chunks.push(chunk); }
      const raw = Buffer.concat(chunks), body = raw.length ? JSON.parse(raw) : null;
      row = { sequence: requests.length + 1, at: new Date().toISOString(), method: incoming.method, path: incoming.url,
        requestSha256: sha(raw), body }; requests.push(row);
      const modelCall = incoming.method === 'POST' && incoming.url === '/api/chat';
      const harmlessRead = incoming.method === 'GET' && ['/api/tags', '/api/ps', '/api/version'].includes(incoming.url);
      const show = incoming.method === 'POST' && incoming.url === '/api/show' && (body?.model || body?.name) === freeze.model;
      assert.ok(harmlessRead || show || modelCall, 'provider endpoint outside frozen scope');
      if (modelCall) {
        assert.equal(stopped, false, 'no followup billing after provider failure');
        const admission = read(path.join(out, 'admission.json'));
        assert.ok(['core', 'cli'].includes(admission.phase) && ['initial', 'repair'].includes(admission.kind));
        if (admission.kind === 'repair') {
          const { selection, selectionSha256 } = readRepairSelection(out, admission.phase, admission.repairSelection, freeze.resumeFailed ? 'failed-core4-cli3' : null);
          assert.equal(selectionSha256, admission.repairSelection.selectionSha256, 'selection cannot drift after receipt');
          assert.deepEqual(selection.targets, admission.repairSelection.targets);
        }
        const key = admission.phase + ':' + admission.kind;
        if (lastKey !== key) { budget.begin(admission.phase, admission.kind); lastKey = key; }
        row.role = classifyGeneration(body, freeze, admission, requests);
        row.admission = budget.admit({ role: row.role, model: body.model });
        save(out, 'call-budget.json', budget.snapshot());
        save(out, 'provider-input-' + String(row.sequence).padStart(3, '0') + '.json', row);
        onModelCall();
      }
      forward({ hostname: '127.0.0.1', port: 11434, path: incoming.url, method: incoming.method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': raw.length } }, { payload: raw,
        onResponse(response) {
          row.status = response.statusCode; const chunks = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size <= 16000000) chunks.push(chunk); });
          response.on('end', () => {
            const output = Buffer.concat(chunks); row.responseBytes = size; row.responseTruncated = size > 16000000;
            row.responseSha256 = row.responseTruncated ? null : sha(output); row.rawResponse = output.toString('utf8');
            try { row.terminal = JSON.parse(output); } catch { row.parseError = true; }
            if (modelCall) {
              const terminal = row.terminal;
              row.physicalIdentityComplete = row.status === 200 && !row.responseTruncated && terminal?.done === true && terminal?.done_reason === 'stop'
                && terminal?.model === freeze.model && (terminal?.model_digest_sha256 ?? terminal?.digest) === freeze.digest
                && terminal?.provider_version === freeze.providerVersion;
              if (!row.physicalIdentityComplete) stopped = true;
              save(out, 'provider-output-' + String(row.sequence).padStart(3, '0') + '.json', row);
            }
          });
        }, onError(error) { row.error = error.message; if (modelCall) stopped = true; },
      });
    } catch (error) {
      stopped = true; if (row) row.error = error.message;
      if (!outgoing.destroyed) { if (!outgoing.headersSent) outgoing.writeHead(403); outgoing.end(); }
    }
  });
}

export function assessFanModelToPreview(requests, journey) {
  const proof = [];
  for (const row of requests.filter(row => row.role === 'CODE' && row.admission)) {
    assert.equal(row.physicalIdentityComplete, true, 'incomplete physical CODE row');
    const input = JSON.parse(row.body.messages.findLast(message => message.role === 'user').content);
    const target = typeof input.path === 'number' ? input.paths[input.path] : input.path;
    const phase = journey.phases.find(phase => phase.phase === row.admission.phase && phase.kind === row.admission.kind);
    const preview = phase?.preview?.diff?.find(file => file.path === target);
    assert.ok(preview && typeof preview.after.content === 'string', 'corresponding exact preview missing');
    const parsed = JSON.parse(row.terminal.message.content); let output;
    if (row.admission.kind === 'initial') {
      assert.deepEqual(Object.keys(parsed), ['afterContent']); assert.equal(typeof parsed.afterContent, 'string'); output = parsed.afterContent;
    } else {
      assert.deepEqual(Object.keys(parsed), ['replacements']); assert.ok(Array.isArray(parsed.replacements) && parsed.replacements.length >= 1 && parsed.replacements.length <= 16);
      const base = input.previousDraft?.content; assert.equal(typeof base, 'string');
      const spans = parsed.replacements.map(replacement => {
        assert.deepEqual(Object.keys(replacement).sort(), ['after', 'before']); assert.equal(typeof replacement.before, 'string');
        assert.ok(replacement.before); assert.equal(typeof replacement.after, 'string');
        const at = base.indexOf(replacement.before); assert.ok(at >= 0 && base.indexOf(replacement.before, at + 1) === -1);
        return { at, end: at + replacement.before.length, after: replacement.after };
      }).sort((a, b) => a.at - b.at);
      let cursor = 0; output = '';
      for (const span of spans) { assert.ok(span.at >= cursor); output += base.slice(cursor, span.at) + span.after; cursor = span.end; }
      output += base.slice(cursor);
    }
    assert.deepEqual(Buffer.from(output), Buffer.from(preview.after.content), 'provider complete output maps to exact preview');
    proof.push({ sequence: row.sequence, phase: row.admission.phase, kind: row.admission.kind, targetPath: target,
      requestSha256: row.requestSha256, responseSha256: row.responseSha256, outputSha256: sha(output), previewSha256: sha(preview.after.content) });
  }
  return { status: 'ACTUAL_MODEL_TO_PREVIEW_BYTES_PASS_NOT_APP_ACCEPTANCE', observedCode: proof.length, proof };
}

function beforeImages(project, paths) { return Object.fromEntries(paths.map(relative => [relative,
  fs.existsSync(path.join(project, relative)) ? fs.readFileSync(path.join(project, relative)).toString('base64') : null])); }
export function assertPreviewBytes(diff, before) {
  assert.deepEqual(diff.map(row => row.path).sort(), Object.keys(before).sort(), 'preview paths match full before-image snapshot');
  for (const row of diff) {
    const existed = before[row.path] !== null, bytes = existed ? Buffer.from(before[row.path], 'base64') : Buffer.alloc(0);
    assert.equal(row.before.exists, existed, row.path + ': exact existence');
    assert.equal(row.before.bytes, bytes.length, row.path + ': exact before byte length');
    assert.equal(row.before.digest, existed ? 'sha256:' + sha(bytes) : null, row.path + ': exact before digest');
    assert.equal(row.before.content, existed ? bytes.toString('utf8') : null, row.path + ': exact before content');
    if (existed) assert.deepEqual(Buffer.from(row.before.content), bytes, row.path + ': exact UTF-8 before bytes');
    assert.equal(typeof row.after.content, 'string');
    const after = Buffer.from(row.after.content);
    assert.equal(row.after.bytes, after.length, row.path + ': exact after byte length');
    assert.equal(row.after.digest, 'sha256:' + sha(after), row.path + ': exact after digest');
  }
}
export function assertWrongDigestResponse(response) {
  assert.equal(response.statusCode, 409, 'wrong/stale approval digest must reject before effect');
  assert.equal(response.json?.code, 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH', 'exact typed digest mismatch');
}

const ownedClose = new WeakMap();
function watchOwnedChild(child) {
  assert.ok(child && typeof child.kill === 'function', 'exact owned ChildProcess handle required');
  if (ownedClose.has(child)) return ownedClose.get(child);
  const observed = { closed: false, result: null, promise: null };
  observed.promise = new Promise(resolve => {
    child.once('close', (code, signal) => { observed.closed = true; observed.result = { code, signal }; resolve(observed.result); });
  });
  ownedClose.set(child, observed); return observed;
}
async function joinWithin(observed, ms) {
  if (observed.closed) return true;
  let timer; try { return await Promise.race([observed.promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function terminateOwnedChild(child, { termMs = 3000, killMs = 3000 } = {}) {
  const observed = watchOwnedChild(child); const result = { pid: child.pid, closed: observed.closed, termSent: false, killSent: false };
  if (!observed.closed) {
    result.termSent = child.kill('SIGTERM');
    if (!await joinWithin(observed, termMs)) { result.killSent = child.kill('SIGKILL'); await joinWithin(observed, killMs); }
  }
  result.closed = observed.closed; result.exit = observed.result; return result;
}
export async function stopOwnedRuntime(state, gracefulStop, label, bounds = {}) {
  const observed = watchOwnedChild(state.child); let gracefulError = null;
  try { await gracefulStop(state); } catch (error) { gracefulError = error.message; }
  let join = { pid: state.child.pid, closed: observed.closed, termSent: false, killSent: false, exit: observed.result };
  if (!observed.closed && !await joinWithin(observed, 100)) join = await terminateOwnedChild(state.child, bounds);
  else { join.closed = observed.closed; join.exit = observed.result; }
  if (join.closed && state.electronTmp) fs.rmSync(state.electronTmp, { recursive: true, force: true });
  return { label, ...join, gracefulError, status: !join.closed ? 'OWNED_STOP_UNRESOLVED' : gracefulError || join.termSent || join.killSent ? 'OWNED_STOP_FAILED_JOINED' : 'OWNED_STOP_PASS' };
}

export function validateRepairSelection(selection, { phase, failedLifecycleId, planDigest }, continuationMode = null) {
  assert.ok(continuationMode === null || continuationMode === 'failed-core4-cli3');
  if (continuationMode) assert.equal(phase, 'core');
  assert.ok(selection && Object.getPrototypeOf(selection) === Object.prototype && !Array.isArray(selection), 'selection must be a JSON record');
  assert.deepEqual(Object.keys(selection).sort(), ['failedLifecycleId', 'phase', 'planDigest', 'reason', 'targets']);
  assert.equal(selection.phase, phase); assert.equal(selection.failedLifecycleId, failedLifecycleId); assert.equal(selection.planDigest, planDigest);
  assert.match(selection.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Array.isArray(selection.targets) && selection.targets.length >= 1 && selection.targets.length <= (continuationMode ? 4 : 2)
    && new Set(selection.targets).size === selection.targets.length && selection.targets.every(relative => TARGETS[phase].includes(relative)), 'repair subset must remain in frozen eligible scope');
  if (continuationMode) assert.deepEqual([...selection.targets].sort(), [...TARGETS.core].sort(), 'fixed full4 repair only');
  assert.ok(typeof selection.reason === 'string' && selection.reason.isWellFormed() && selection.reason.trim() && Buffer.byteLength(selection.reason) <= 1024);
  return selection;
}
export function readRepairSelection(out, phase, failure, continuationMode = null) {
  assert.ok(['core', 'cli'].includes(phase));
  const dir = fs.lstatSync(out); assert.ok(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o777) === 0o700);
  const fd = fs.openSync(path.join(out, phase + '-repair-selection.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); let raw;
  try { const stat = fs.fstatSync(fd); assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 4096 && (stat.mode & 0o777) === 0o600); raw = fs.readFileSync(fd); }
  finally { fs.closeSync(fd); }
  assert.ok(raw.length <= 4096); assert.deepEqual(Buffer.from(raw.toString('utf8')), raw, 'selection must be exact well-formed UTF-8');
  return { selection: validateRepairSelection(JSON.parse(raw), failure, continuationMode), selectionSha256: sha(raw) };
}
async function waitRepairSelection(out, phase, terminal) {
  const label = phase + '-repair-selection', file = path.join(out, label + '.json');
  assert.equal(fs.existsSync(file), false, 'selection must be new and bind the actual failure');
  assert.deepEqual(terminal.diff.map(row => row.path).sort(), [...TARGETS[phase]].sort(), 'actual failed materials match frozen eligible scope');
  const pending = { phase, failedLifecycleId: terminal.lifecycleId, planDigest: terminal.planDigest,
    eligiblePaths: TARGETS[phase], maximumTargets: 2, waitMs: 180000, status: 'AWAITING_ROOT_DIAGNOSTIC_SELECTION' };
  save(out, label + '-pending.json', pending);
  console.log(JSON.stringify({ status: pending.status, file, phase, failedLifecycleId: terminal.lifecycleId, planDigest: terminal.planDigest }));
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    let present; try { fs.lstatSync(file); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) {
      const { selection, selectionSha256 } = readRepairSelection(out, phase, pending);
      const receipt = { status: 'FAILURE_BOUND_SELECTION_FROZEN_BEFORE_REPAIR_D1', ...selection, selectionSha256 };
      fs.writeFileSync(path.join(out, label + '-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Object.assign(Error('FAN_REPAIR_SELECTION_TIMEOUT: actual rollback preserved; ROOT diagnostic decision required'), { code: 'FAN_REPAIR_SELECTION_TIMEOUT' });
}
function assertAfter(project, diff) {
  for (const row of diff) assert.deepEqual(fs.readFileSync(path.join(project, row.path)), Buffer.from(row.after.content), row.path + ': exact approved bytes');
}
function subjectOverlay(project, view, phase) {
  const paths = phase === 'core' ? TARGETS.core : [...TARGETS.core, ...TARGETS.cli];
  return Object.fromEntries(paths.map(relative => {
    const proposed = view.diff.find(row => row.path === relative);
    return [relative, proposed ? proposed.after.content : fs.readFileSync(path.join(project, relative), 'utf8')];
  }));
}
async function canonicalOracle(project, root) {
  const environment = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };
  const result = await processSandboxProvider.run({ sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    projectRoot: project, canonicalCwd: project, binary: process.execPath, argv: TEST_ARGV,
    argvDigest: computeM2ExecutionValueDigest(TEST_ARGV), environment, environmentDigest: computeM2ExecutionValueDigest(environment), timeoutMs: 30000, expectedExitCode: 0 }, {
    recordSupervisorIdentity(identity) {
      const file = path.join(root, 'sandbox-supervisor-' + randomUUID() + '.json'), fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(fd, JSON.stringify(identity) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const directory = fs.openSync(root, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      return { durable: true };
    },
  });
  assert.equal(result.terminalStatus, 'succeeded', JSON.stringify(result));
  assert.match(result.stdout, /operator frozen core oracle/);
  return result;
}

export function snapshotFanPendingPacket(root) {
  assert.ok(path.isAbsolute(root)); assert.equal(fs.realpathSync(root), root);
  const files = [];
  const walk = (directory, prefix = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = path.posix.join(prefix, name), stat = fs.lstatSync(file);
      assert.ok(stat.isDirectory() || (stat.isFile() && stat.nlink === 1), 'unsupported historical member:' + relative);
      files.push({ path: relative, type: stat.isDirectory() ? 'directory' : 'file', mode: stat.mode & 0o7777,
        ...(stat.isFile() ? { bytes: stat.size, sha256: sha(fs.readFileSync(file)) } : {}) });
      if (stat.isDirectory()) walk(file, relative);
    }
  }; walk(root); return files;
}

export function prepareFanPendingResume(freeze, out) {
  const pins = freeze.resumePending;
  assert.deepEqual(Object.keys(pins || {}).sort(), ['mainDatabaseSha256', 'packet', 'snapshotSha256']);
  const packet = pins.packet; assert.equal(path.dirname(packet), ARTIFACTS); assert.notEqual(packet, out);
  assert.equal(path.basename(packet), 'fan-monitor-manual-592cb54c-live-20261002-1457', 'only the reviewed historical pending packet');
  assert.equal(pins.mainDatabaseSha256, 'ebdb5523f6d971ed9066c533d4a909d9ef29fcdda9a6eda23c3adc9b3b976bfb');
  const snapshot = snapshotFanPendingPacket(packet);
  assert.equal(sha(JSON.stringify(snapshot)), pins.snapshotSha256, 'complete preserved packet must match the frozen checkpoint');
  const priorFreeze = read(path.join(packet, 'frozen-input.json')), journey = read(path.join(packet, 'fan-journey.json'));
  assert.equal(priorFreeze.sourceSha, '592cb54c9de3a6cf341a85bc40a1894827df3062');
  assert.equal(read(path.join(packet, 'result.json')).status, 'FAIL'); assert.equal(journey.status, 'FAIL');
  assert.match(journey.error?.message || '', /FAN_CONVERSATION_BUSY/);
  assert.equal(journey.phases.length, 1); const phase = journey.phases[0], view = phase.preview;
  assert.equal(view.lifecycleId, 'lifecycle:c2eb0c49-288d-4be4-aa47-4fd745668aa2');
  assert.equal(view.planDigest, 'sha256:45e4a5a84ad19bc111ec7039e610fdcd6ff49800db5f25d88f4cb7a98b40c908');
  assert.equal(phase.phase, 'core'); assert.equal(phase.kind, 'initial'); assert.equal(view.state, 'awaiting_approval');
  assert.equal(view.plan.origin.projectId, journey.projectId); assert.equal(view.plan.origin.conversationId, journey.conversationId);
  assert.equal(view.plan.origin.sessionId, journey.conversationId); assert.equal(view.plan.origin.surface, 'studio');
  assert.ok(Date.now() < Date.parse(view.plan.approvalExpiresAt), 'historical approval expiry is immutable');
  for (const key of ['model', 'digest', 'providerVersion', 'entryMode', 'd1Context', 'codeContext', 'maximumD1', 'maximumCode', 'inputs', 'manualDrafts', 'repairSelectionPolicy']) {
    assert.deepEqual(freeze[key], priorFreeze[key], 'continuation changes no model/input/budget/oracle contract:' + key);
  }
  for (const [relative, row] of Object.entries(freeze.operatorFiles)) assert.equal(row.sha256, priorFreeze.operatorFiles[relative].sha256);
  const allowed = new Set(['scripts/manual/fan-monitor-studio2-controller.mjs', 'scripts/manual/run-fan-monitor-journey.mjs']);
  for (const [relative, digest] of Object.entries(priorFreeze.closure)) if (!allowed.has(relative)) assert.equal(freeze.closure[relative], digest, 'unrelated source closure drift:' + relative);
  const requests = read(path.join(packet, 'provider-requests.json')), admitted = requests.filter(row => row.admission);
  assert.equal(admitted.length, 4); assert.ok(admitted.every(row => row.role === 'CODE' && row.admission.phase === 'core' && row.admission.kind === 'initial' && row.physicalIdentityComplete));
  const budget = createFanCallBudget({ d1Model: freeze.model, codeModel: freeze.model, entryMode: 'manual', historicalRows: admitted.map(row => row.admission) });
  assert.equal(budget.snapshot().rows.length, 4); assert.equal(assessFanModelToPreview(requests, journey).observedCode, 4);
  const savedPreview = read(path.join(packet, 'core-initial-actual-preview.json'));
  assert.deepEqual(savedPreview.view, view); assert.deepEqual(savedPreview.submittedDraft, freeze.manualDrafts.core);
  assert.equal(savedPreview.command, '/m2-build ' + JSON.stringify(savedPreview.submittedDraft));
  const runtimeRoot = path.resolve(journey.project, '../../..'); assert.equal(path.dirname(runtimeRoot), packet);
  assert.equal(journey.project, path.join(runtimeRoot, 'home/projects/fan-monitor'));
  assert.equal(sha(fs.readFileSync(path.join(runtimeRoot, 'm1.sqlite'))), pins.mainDatabaseSha256);
  const copyRoot = path.join(out, 'runtime-resume'); fs.cpSync(runtimeRoot, copyRoot, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
  fs.chmodSync(copyRoot, fs.statSync(runtimeRoot).mode & 0o7777);
  const prefix = path.basename(runtimeRoot) + '/', original = snapshot.filter(row => row.path.startsWith(prefix)).map(row => ({ ...row, path: row.path.slice(prefix.length) }));
  for (const row of original) fs.chmodSync(path.join(copyRoot, row.path), row.mode);
  assert.deepEqual(snapshotFanPendingPacket(copyRoot), original, 'copied runtime preserves all bytes and modes');
  const project = path.join(copyRoot, 'home/projects/fan-monitor'); assert.equal(git(project, ['rev-parse', 'HEAD']), phase.baseline);
  assert.equal(git(project, ['status', '--porcelain=v1']), ''); assert.deepEqual(beforeImages(project, TARGETS.core), phase.before);
  assertPreviewBytes(view.diff, phase.before);
  const frozen = { '.intentsmith/m2-governance-policy.json': sha(fs.readFileSync(path.join(project, '.intentsmith/m2-governance-policy.json'))) };
  for (const [relative, row] of Object.entries(freeze.operatorFiles).filter(([relative]) => !relative.includes('operator-cli-'))) {
    assert.equal(sha(fs.readFileSync(path.join(project, relative))), row.sha256); frozen[relative] = row.sha256;
  }
  const db = new Database(path.join(copyRoot, 'm1.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.deepEqual(db.prepare('SELECT id,path FROM projects').all(), [{ id: journey.projectId, path: journey.project }]);
    assert.deepEqual(db.prepare('SELECT id,project_id FROM conversations').all(), [{ id: journey.conversationId, project_id: journey.projectId }]);
    const operations = db.prepare('SELECT lifecycle_id,plan_digest,plan_json FROM m2_lifecycle_operations').all(); assert.equal(operations.length, 1);
    assert.equal(operations[0].lifecycle_id, view.lifecycleId); assert.equal(operations[0].plan_digest, view.planDigest); assert.deepEqual(JSON.parse(operations[0].plan_json), view.plan);
    for (const table of ['m2_lifecycle_terminals', 'm2_lifecycle_approval_intents', 'm2_lifecycle_grant_sets', 'm2_execution_results']) assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0);
    const materials = db.prepare('SELECT relative_path,after_bytes,after_digest,after_byte_count FROM m2_execution_files WHERE execution_id=? ORDER BY ordinal').all(view.plan.identity.executionId);
    assert.equal(materials.length, 4);
    for (const material of materials) {
      const file = view.diff.find(file => file.path === material.relative_path); assert.ok(file);
      assert.deepEqual(material.after_bytes, Buffer.from(file.after.content)); assert.equal(material.after_digest, file.after.digest); assert.equal(material.after_byte_count, file.after.bytes);
    }
  } finally { db.close(); }
  assert.deepEqual(snapshotFanPendingPacket(packet), snapshot, 'historical packet unchanged by preparation');
  return { packet, snapshot, runtimeRoot, copyRoot, journey, preview: savedPreview, requests, frozen, originalModelCalls: 4, remainingModelCalls: 7 };
}

const FAILED_FAN_PACKET = 'fan-monitor-resume-b1f7146c-live-20261002-1535';
const FAILED_FAN_SNAPSHOT = '7849678bba806406b955b996c2b23b6d775f4a620dfa2fab9250aacb0f1672c3';
const FAILED_FAN_DATABASE = '6b204a4722f39d2bf5f95d0cea99ad931c1d5162a03340042040797428c1b9ec';
const FAILED_FAN_PINS = Object.freeze({
  'result.json': '751c6fc491005c475ccca48c221c1f7380f442ffe3cda25562505e01cf0a98de',
  'fan-journey.json': 'fddbcda8b487541dfb441e911890c5649b6697f96551f9270700a9fdd639d300',
  'provider-requests.json': '8912726d25122161ec980661541e742231ea91d35e37b2515554d8df0c5a7399',
  'core-initial-actual-terminal.json': '6cd5ae30fbdabc4c26ceb744a79e8c344862b9540e19cc690481e5afaaa18e38',
  'core-initial-actual-preview.json': '01fac90af6cea59a09d55ad818524908e4a5c3533854f932e932950669feeb5d',
  'core-initial-actual-composed-draft.json': '1d6ab9fc3f18ec90158599fb2ead6e2fd0322a9f057ce8f284dc734af8546fd2',
});
export function validateFailedResumePins(freeze) {
  const pins = freeze.resumeFailed;
  assert.deepEqual(Object.keys(pins || {}).sort(), ['coreRepairDraftSha256', 'mainDatabaseSha256', 'packet', 'snapshotSha256']);
  assert.equal(pins.packet, path.join(ARTIFACTS, FAILED_FAN_PACKET));
  assert.equal(pins.mainDatabaseSha256, FAILED_FAN_DATABASE); assert.equal(pins.snapshotSha256, FAILED_FAN_SNAPSHOT);
  assert.equal(pins.coreRepairDraftSha256, sha(JSON.stringify(freeze.coreRepairDraft)), 'literal frozen repair draft value SHA');
  validateManualDraft(freeze.coreRepairDraft, { phase: 'core', nodeBinary: freeze.nodeBinary, repair: true });
  compileCodeDraftInput(freeze.coreRepairDraft);
}
export function assertFailedResumeView(current, saved) {
  assert.equal(current.state, 'failed'); assert.equal(current.lifecycleId, saved.lifecycleId); assert.equal(current.planDigest, saved.planDigest);
  assert.deepEqual(current.plan, saved.plan); assert.deepEqual(current.diff, saved.diff);
  assert.deepEqual(current.terminal, saved.terminal); assert.deepEqual(current.result, saved.result);
  assert.equal(current.result.focusedTest.terminalStatus, 'failed'); assert.equal(current.result.rollback.status, 'succeeded');
}
export function prepareFanFailedResume(freeze, out) {
  validateFailedResumePins(freeze); assert.equal(freeze.entryMode, 'manual'); assert.equal(freeze.maximumD1, 0); assert.equal(freeze.maximumCode, 11);
  assert.equal(freeze.codeContext, 32768); assert.equal(path.dirname(out), ARTIFACTS);
  const packet = freeze.resumeFailed.packet; assert.notEqual(packet, out);
  const snapshot = snapshotFanPendingPacket(packet); assert.equal(sha(JSON.stringify(snapshot)), FAILED_FAN_SNAPSHOT);
  for (const [name, expected] of Object.entries(FAILED_FAN_PINS)) assert.equal(sha(fs.readFileSync(path.join(packet, name))), expected, name);
  const journey = read(path.join(packet, 'fan-journey.json')), priorFreeze = read(path.join(packet, 'frozen-input.json'));
  assert.equal(journey.status, 'FAIL'); assert.match(journey.error.message, /FAN_REPAIR_SELECTION_TIMEOUT/); assert.equal(journey.phases.length, 1);
  const phase = journey.phases[0], terminal = read(path.join(packet, 'core-initial-actual-terminal.json'));
  assert.equal(phase.phase, 'core'); assert.equal(phase.kind, 'initial'); assert.equal(phase.atomicRollbackVerified, true);
  assertFailedResumeView(phase.terminal, terminal);
  const preview = read(path.join(packet, 'core-initial-actual-preview.json'));
  assert.deepEqual(preview.view, phase.preview); assert.deepEqual(preview.view.diff, terminal.diff);
  assert.deepEqual(preview.submittedDraft, read(path.join(packet, 'core-initial-actual-composed-draft.json')));
  assert.deepEqual(freeze.manualDrafts, priorFreeze.manualDrafts);
  for (const key of ['model', 'digest', 'providerVersion', 'entryMode', 'd1Context', 'maximumD1', 'maximumCode', 'inputs']) assert.deepEqual(freeze[key], priorFreeze[key]);
  for (const [relative, row] of Object.entries(freeze.operatorFiles)) assert.equal(row.sha256, priorFreeze.operatorFiles[relative].sha256, 'oracle is immutable:' + relative);
  const origin = terminal.plan.origin; assert.deepEqual(origin, { surface: 'studio', sessionId: journey.conversationId, conversationId: journey.conversationId, projectId: journey.projectId });
  assert.deepEqual(terminal.plan.project.canonicalRoot, journey.project);
  const runtimeRoot = path.join(ARTIFACTS, 'fan-monitor-manual-592cb54c-live-20261002-1457/runtime-CigGtS');
  assert.equal(journey.project, path.join(runtimeRoot, 'home/projects/fan-monitor'));
  const sourceRuntime = path.join(packet, 'runtime-resume'); assert.equal(sha(fs.readFileSync(path.join(sourceRuntime, 'm1.sqlite'))), FAILED_FAN_DATABASE);
  const requests = read(path.join(packet, 'provider-requests.json')), rows = requests.filter(row => row.admission);
  assert.equal(rows.length, 4); assert.ok(rows.every(row => row.role === 'CODE' && row.physicalIdentityComplete && row.admission.phase === 'core' && row.admission.kind === 'initial'));
  createFanCallBudget({ d1Model: freeze.model, codeModel: freeze.model, entryMode: 'manual', historicalRows: rows.map(row => row.admission), continuationMode: 'failed-core4-cli3' });
  assert.equal(assessFanModelToPreview(requests, journey).observedCode, 4);
  const selection = { phase: 'core', failedLifecycleId: terminal.lifecycleId, planDigest: terminal.planDigest,
    targets: [...TARGETS.core], reason: freeze.coreRepairDraft.instruction };
  validateRepairSelection(selection, selection, 'failed-core4-cli3');
  makeManualRevision(preview.submittedDraft, terminal, selection, { phase: 'core', nodeBinary: freeze.nodeBinary, frozenCoreRepairDraft: freeze.coreRepairDraft });
  const copyRoot = path.join(out, 'runtime-resume'); fs.cpSync(sourceRuntime, copyRoot, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
  fs.chmodSync(copyRoot, fs.statSync(sourceRuntime).mode & 0o7777);
  const original = snapshot.filter(row => row.path.startsWith('runtime-resume/')).map(row => ({ ...row, path: row.path.slice('runtime-resume/'.length) }));
  for (const row of original) fs.chmodSync(path.join(copyRoot, row.path), row.mode);
  assert.deepEqual(snapshotFanPendingPacket(copyRoot), original, 'whole failed runtime copy bytes/modes');
  const project = path.join(copyRoot, 'home/projects/fan-monitor');
  assert.equal(git(project, ['rev-parse', 'HEAD']), phase.baseline); assert.equal(git(project, ['status', '--porcelain=v1']), '');
  assert.deepEqual(beforeImages(project, TARGETS.core), phase.before); assertPreviewBytes(terminal.diff, phase.before);
  const frozen = { '.intentsmith/m2-governance-policy.json': sha(fs.readFileSync(path.join(project, '.intentsmith/m2-governance-policy.json'))) };
  for (const [relative, row] of Object.entries(freeze.operatorFiles).filter(([relative]) => !relative.includes('operator-cli-'))) {
    assert.equal(sha(fs.readFileSync(path.join(project, relative))), row.sha256); frozen[relative] = row.sha256;
  }
  // Read only the owned copy: native SQLite may create sidecars there. The
  // original packet is never opened by native SQLite or rewritten.
  const db = new Database(path.join(copyRoot, 'm1.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.deepEqual(db.prepare('SELECT id,path FROM projects').all(), [{ id: journey.projectId, path: journey.project }]);
    assert.deepEqual(db.prepare('SELECT id,project_id FROM conversations').all(), [{ id: journey.conversationId, project_id: journey.projectId }]);
    const operations = db.prepare('SELECT lifecycle_id,plan_digest,plan_json FROM m2_lifecycle_operations').all(); assert.equal(operations.length, 1);
    assert.equal(operations[0].lifecycle_id, terminal.lifecycleId); assert.equal(operations[0].plan_digest, terminal.planDigest); assert.deepEqual(JSON.parse(operations[0].plan_json), terminal.plan);
    const saved = db.prepare('SELECT terminal_status,terminal_json FROM m2_lifecycle_terminals').all(); assert.equal(saved.length, 1);
    assert.equal(saved[0].terminal_status, 'failed'); assert.deepEqual(JSON.parse(saved[0].terminal_json), terminal.terminal);
    const results = db.prepare('SELECT terminal_status,result_json FROM m2_execution_results').all(); assert.equal(results.length, 1);
    assert.equal(results[0].terminal_status, 'failed'); assert.deepEqual(JSON.parse(results[0].result_json), terminal.result);
    for (const table of ['m2_lifecycle_approval_intents', 'm2_lifecycle_grant_sets', 'm2_execution_requests']) assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 1);
    const materials = db.prepare('SELECT relative_path,after_bytes,after_digest,after_byte_count FROM m2_execution_files WHERE execution_id=? ORDER BY ordinal').all(terminal.plan.identity.executionId);
    assert.equal(materials.length, 4);
    for (const material of materials) {
      const file = terminal.diff.find(file => file.path === material.relative_path); assert.ok(file);
      assert.deepEqual(material.after_bytes, Buffer.from(file.after.content)); assert.equal(material.after_digest, file.after.digest); assert.equal(material.after_byte_count, file.after.bytes);
    }
  } finally { db.close(); }
  assert.equal(sha(fs.readFileSync(path.join(copyRoot, 'm1.sqlite'))), FAILED_FAN_DATABASE, 'CPU readonly verification does not modify copied main DB');
  assert.deepEqual(snapshotFanPendingPacket(packet), snapshot, 'original failed packet immutable');
  const selectionPath = path.join(out, 'core-repair-selection.json'); assert.equal(fs.existsSync(selectionPath), false);
  save(out, 'core-repair-selection.json', selection);
  const { selectionSha256 } = readRepairSelection(out, 'core', selection, 'failed-core4-cli3');
  const boundSelection = { ...selection, selectionSha256 }; save(out, 'core-repair-selection-frozen.json', boundSelection);
  return { kind: 'failed', packet, snapshot, runtimeRoot, sourceRuntime, copyRoot, journey, preview, terminal,
    selection: boundSelection, requests, frozen, originalModelCalls: 4, remainingModelCalls: 7 };
}

async function inside(configPath) {
  const cfg = read(configPath), out = path.dirname(configPath), freeze = validateFreeze(cfg.freeze);
  assert.deepEqual(observeSource(freeze), cfg.source, 'namespace source/build/controller closure remains frozen');
  execFileSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']);
  const interfaces = JSON.parse(execFileSync('/usr/sbin/ip', ['-j', 'address'], { encoding: 'utf8' }));
  assert.deepEqual(interfaces.map(row => row.ifname), ['lo']);
  const relay = createOwnedProviderRelay((incoming, outgoing, forward) => forward({ socketPath: cfg.socketPath, path: incoming.url,
    method: incoming.method, headers: { 'Content-Type': 'application/json' } }));
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const providerUrl = 'http://127.0.0.1:' + relay.server.address().port;
  const runtime = cfg.resume ? { ...Object.fromEntries(Object.entries(cfg.resume.runtimePaths)),
    portFile: path.join(out, 'resume-server-port.json'), serverLog: path.join(out, 'resume-server.log') } : makeRuntime(out);
  const project = path.join(runtime.projects, 'fan-monitor');
  if (cfg.resume) assert.equal(fs.statSync(runtime.database).ino, fs.statSync(path.join(cfg.resume.copyRoot, 'm1.sqlite')).ino, 'copied database is bound at unchanged signed root');
  const evidence = { status: 'RUNNING', entryMode: freeze.entryMode ?? 'd1', scope: freeze.entryMode === 'manual'
    ? 'Explicit operator Studio2 /m2-build JSON→default CODE→exact M2 approval→all tests→Git→restart; D1 remains BLOCKED'
    : 'Actual D1→Studio2 composer→CODE→exact M2 approval→all tests→Git→restart',
    source: cfg.source, model: freeze.model, digest: freeze.digest, providerVersion: freeze.providerVersion,
    d1Context: freeze.d1Context, codeContext: freeze.codeContext, phases: [], startedAt: new Date().toISOString() };
  let server = null, studio = null; const renderer = [], http = [];
  const rawAsk = async (method, route, body, timeout) => {
    const response = await requestJson(server, method, route, body, timeout); http.push({ at: new Date().toISOString(), method, route, body, response }); return response;
  };
  const ask = async (method, route, body, timeout) => {
    const response = await rawAsk(method, route, body, timeout);
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, route + ':' + response.raw); return response.json;
  };
  const start = async () => {
    assert.equal(server, null); assert.equal(studio, null);
    const readyServer = await startServer(runtime, randomBytes(20).toString('hex'), providerUrl,
      { CHAT: freeze.model, D1: freeze.model, CODE: freeze.model }, state => { server = state; watchOwnedChild(state.child); });
    assert.equal(readyServer, server, 'actual server ownership callback must run before readiness await');
    const readyStudio = await startLiteralStudio(runtime, state => { studio = state; watchOwnedChild(state.child); });
    assert.equal(readyStudio, studio, 'actual Studio ownership callback must run before readiness await');
    await trackNetwork(studio, renderer);
  };
  let stopping = null;
  const stop = async () => {
    if (stopping) return stopping;
    stopping = (async () => {
    const failures = [];
    if (studio) {
      const result = await stopOwnedRuntime(studio, stopLiteralStudio, 'Studio'); (evidence.ownedStops ||= []).push(result);
      if (result.closed) studio = null; if (result.status !== 'OWNED_STOP_PASS') failures.push(result);
    }
    if (server) {
      const result = await stopOwnedRuntime(server, stopServer, 'backend'); (evidence.ownedStops ||= []).push(result);
      if (result.closed) server = null; if (result.status !== 'OWNED_STOP_PASS') failures.push(result);
    }
    assert.deepEqual(failures, [], 'owned Studio/backend cleanup');
    })();
    try { await stopping; } finally { stopping = null; }
  };
  let interrupted = false;
  const interrupt = signal => {
    if (interrupted) return; interrupted = true;
    void (async () => {
      evidence.status = 'FAIL'; evidence.interruptedBy = signal;
      try { await stop(); } catch (error) { evidence.cleanupError = error.message; }
      try { evidence.relayCleanup = await relay.close(); } catch (error) { evidence.relayCleanupError = error.message; }
      evidence.completedAt = new Date().toISOString(); save(out, 'fan-journey-interrupted.json', evidence);
      process.exit(2);
    })();
  };
  const onTerm = () => interrupt('SIGTERM'), onInt = () => interrupt('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  let frozen = {}, projectId, conversationId, sessionId;
  const protectedCheck = () => assertProtectedSourceHashes(Object.fromEntries(Object.keys(frozen)
    .map(relative => [relative, fs.readFileSync(path.join(project, relative), 'utf8')])), frozen);
  const fixture = relative => {
    const row = freeze.operatorFiles[relative], content = fs.readFileSync(row.source);
    assert.equal(sha(content), row.sha256); fs.writeFileSync(path.join(project, relative), content, { flag: 'wx' }); frozen[relative] = row.sha256;
  };
  const bind = async (resumePending = null, resumeFailed = null) => { ({ sessionId } = await bindActualConversation(studio, { projectId, conversationId, title: 'Fan monitor actual journey', resumePending, resumeFailed })); };
  try {
    await start();
    if (cfg.resume) {
      projectId = cfg.resume.journey.projectId; conversationId = cfg.resume.journey.conversationId; frozen = cfg.resume.frozen;
      evidence.resumedFrom = { packet: cfg.resume.packet, lifecycleId: cfg.resume.preview.view.lifecycleId, planDigest: cfg.resume.preview.view.planDigest, originalModelCalls: 4, remainingModelCalls: 7, kind: cfg.resume.kind ?? 'pending' };
      if (cfg.resume.kind === 'failed') {
        const old = cfg.resume.terminal, origin = old.plan.origin;
        const route = '/api/m2/lifecycle/status?' + new URLSearchParams({ id: old.lifecycleId, surface: origin.surface, sessionId: origin.sessionId, conversationId: origin.conversationId, projectId: String(projectId) });
        const actual = await ask('GET', route); assertFailedResumeView(actual, old);
        await bind(null, { lifecycleId: old.lifecycleId, planDigest: old.planDigest, status: actual });
        const restored = await reloadActualStatus(studio, { sessionId, lifecycleId: old.lifecycleId, planDigest: old.planDigest });
        assertFailedResumeView(restored, old);
        assert.deepEqual(beforeImages(project, TARGETS.core), cfg.resume.journey.phases[0].before); protectedCheck();
        assert.equal(git(project, ['rev-parse', 'HEAD']), cfg.resume.journey.phases[0].baseline); assert.equal(git(project, ['status', '--porcelain=v1']), '');
        // Preserve historical preview/terminal as history, never as a new success.
        evidence.phases.push({ ...cfg.resume.journey.phases[0], historical: true, sourcePacket: cfg.resume.packet });
      }
    } else {
    const created = await ask('POST', '/api/projects', { name: 'Fan monitor qualification', description: freeze.inputs.projectGoal, type: 'general', path: project });
    projectId = created.project.id; assert.equal(fs.realpathSync(created.path), project);
    const policyPath = '.intentsmith/m2-governance-policy.json', policy = read(path.join(project, policyPath));
    policy.externalImports = ['node:assert', 'node:assert/strict', 'node:test', 'node:fs', 'node:path', 'node:url', 'node:crypto', 'node:vm', 'node:child_process'].sort();
    fs.writeFileSync(path.join(project, policyPath), JSON.stringify(policy, null, 2) + '\n'); frozen[policyPath] = sha(fs.readFileSync(path.join(project, policyPath)));
    for (const relative of Object.keys(freeze.operatorFiles).filter(relative => !relative.includes('operator-cli-'))) fixture(relative);
    commitOperator(project, Object.keys(frozen), 'Freeze independent fan core oracle and unchanged red scaffold');
    const conversation = (await ask('POST', '/api/conversations', { title: 'Fan monitor actual journey', project_id: projectId })).conversation;
    conversationId = conversation.id; assert.equal(conversation.project_id, projectId); await bind();
    }
    evidence.project = project; evidence.projectId = projectId; evidence.conversationId = conversationId;
    for (const phase of ['core', 'cli']) {
      if (phase === 'cli') { fixture('test/operator-cli-oracle.test.mjs'); commitOperator(project, ['test/operator-cli-oracle.test.mjs'], 'Freeze independent fan CLI oracle before second increment'); }
      const retainedCore = phase === 'cli' ? beforeImages(project, TARGETS.core) : null;
      const baseline = git(project, ['rev-parse', 'HEAD']), before = beforeImages(project, TARGETS[phase]);
      let kind = 'initial', request = phase === 'core' ? freeze.inputs.firstRequest : freeze.inputs.secondRequest;
      let prior = null, lastDraft = null, selection = null;
      if (cfg.resume?.kind === 'failed' && phase === 'core') {
        kind = 'repair'; prior = cfg.resume.terminal; lastDraft = cfg.resume.preview.submittedDraft; selection = cfg.resume.selection;
      }
      for (let attempt = 0; attempt < (cfg.resume?.kind === 'failed' ? 1 : 2); attempt++) {
        const label = phase + '-' + kind, row = { phase, kind, baseline, before, request }; evidence.phases.push(row);
        const admission = { phase, kind, projectId, request, ...(selection ? { repairSelection: selection } : {}) };
        save(out, 'admission.json', admission); save(out, label + '-request.json', admission);
        const beforeSubmit = async draft => {
          admission.draft = draft;
          admission.beforeFiles = Object.fromEntries(Object.entries(before).map(([relative, encoded]) => [relative, encoded === null ? null : Buffer.from(encoded, 'base64').toString('utf8')]));
          admission.readOnlyFiles = Object.fromEntries([...new Set(draft.files.flatMap(file => file.contextFiles || []))].map(relative => {
            const content = fs.readFileSync(path.join(project, relative), 'utf8');
            return [relative, { content, state: 'read_only', contentDigest: 'sha256:' + sha(content) }];
          }));
          admission.previousFiles = prior ? Object.fromEntries(prior.diff.map(file => [file.path,
            { content: file.after.content, contentDigest: file.after.digest, state: 'unapplied_proposal' }])) : {};
          save(out, label + '-actual-composed-draft.json', draft); save(out, 'admission.json', admission);
        };
        let prepared;
        if (cfg.resume && cfg.resume.kind !== 'failed' && phase === 'core' && kind === 'initial') {
          prepared = cfg.resume.preview; assert.deepEqual(prepared.view, cfg.resume.journey.phases[0].preview);
          assert.deepEqual(before, cfg.resume.journey.phases[0].before); assert.equal(baseline, cfg.resume.journey.phases[0].baseline);
          await beforeSubmit(prepared.submittedDraft);
        } else if (freeze.entryMode === 'manual') {
          const draft = kind === 'initial' ? freeze.manualDrafts[phase]
            : makeManualRevision(lastDraft, prior, selection, { phase, nodeBinary: freeze.nodeBinary, frozenCoreRepairDraft: cfg.resume?.kind === 'failed' ? freeze.coreRepairDraft : null });
          prepared = await prepareActualManualDraft(studio, { sessionId, projectId, conversationId, phase,
            nodeBinary: freeze.nodeBinary, draft, beforeSubmit });
        } else {
          const d1 = await captureRealD1Proposal(studio, { sessionId, projectId, conversationId, phase, request, key: label });
          save(out, label + '-actual-d1.json', d1);
          prepared = kind === 'initial' ? await prepareActualCapturedPlan(studio, { sessionId, bound: d1.bound, phase, nodeBinary: freeze.nodeBinary, beforeSubmit })
            : await prepareActualFailedRevision(studio, { sessionId, bound: d1.bound, phase, failedView: prior, lastDraft,
              repairPaths: selection.targets, beforeSubmit });
        }
        const view = prepared.view; lastDraft = prepared.submittedDraft; row.preview = view;
        if (cfg.resume?.kind === 'failed' && phase === 'core') {
          assert.notEqual(view.lifecycleId, prior.lifecycleId); assert.notEqual(view.planDigest, prior.planDigest);
          assert.ok(Date.parse(view.plan.createdAt) > Date.parse(prior.plan.createdAt));
          assert.ok(Date.parse(view.plan.approvalExpiresAt) > Date.now(), 'only fresh new-plan approval is usable');
        }
        save(out, label + '-actual-preview.json', prepared);
        assert.deepEqual(beforeImages(project, TARGETS[phase]), before, 'no preview writes'); assert.equal(git(project, ['rev-parse', 'HEAD']), baseline);
        assertPreviewBytes(view.diff, before);
        assert.equal(git(project, ['status', '--porcelain=v1']), ''); protectedCheck();
        row.sourcePolicy = await assertFanSubjectSourcePolicy(subjectOverlay(project, view, phase), { phase });
        assert.equal(view.plan.focusedTest.binary, freeze.nodeBinary); assert.deepEqual(view.plan.focusedTest.argv, TEST_ARGV);
        if (prior) for (const old of prior.diff) if (!selection.targets.includes(old.path)) {
          assert.equal(view.diff.find(file => file.path === old.path).after.content, old.after.content, 'exact failed-material retention');
        }
        const origin = view.plan.origin, statusRoute = '/api/m2/lifecycle/status?' + new URLSearchParams({ id: view.lifecycleId,
          surface: origin.surface, sessionId: origin.sessionId, conversationId: origin.conversationId, projectId: String(projectId) });
        const wrongDigest = prior?.planDigest || view.planDigest.slice(0, -1) + (view.planDigest.endsWith('0') ? '1' : '0');
        assert.notEqual(wrongDigest, view.planDigest); assert.match(wrongDigest, /^sha256:[0-9a-f]{64}$/);
        const wrong = await rawAsk('POST', '/api/m2/lifecycle/approve', { lifecycleId: view.lifecycleId, planDigest: wrongDigest, origin });
        assertWrongDigestResponse(wrong);
        assert.deepEqual(beforeImages(project, TARGETS[phase]), before, 'wrong digest cannot write any target bytes');
        assert.equal(git(project, ['rev-parse', 'HEAD']), baseline); assert.equal(git(project, ['status', '--porcelain=v1']), ''); protectedCheck();
        const stillPending = await ask('GET', statusRoute);
        assert.equal(stillPending.state, 'awaiting_approval'); assert.equal(stillPending.planDigest, view.planDigest);
        assert.deepEqual(stillPending.diff, view.diff); assertPreviewBytes(stillPending.diff, before);
        row.wrongDigestRejection = { wrongDigest, response: wrong, stillPending };
        save(out, label + '-wrong-digest-rejection.json', row.wrongDigestRejection);
        await stop(); await start();
        const pending = await ask('GET', statusRoute); assert.equal(pending.state, 'awaiting_approval');
        assert.equal(pending.planDigest, view.planDigest); assert.deepEqual(pending.plan, view.plan); assert.deepEqual(pending.diff, view.diff); save(out, label + '-pending-after-restart.json', pending);
        await bind({ lifecycleId: view.lifecycleId, planDigest: view.planDigest, status: pending });
        await reloadActualStatus(studio, { sessionId, lifecycleId: view.lifecycleId, planDigest: view.planDigest });
        const terminal = await approveRenderedExactPlan(studio, { sessionId, lifecycleId: view.lifecycleId, planDigest: view.planDigest });
        row.terminal = terminal; save(out, label + '-actual-terminal.json', terminal);
        if (terminal.state !== 'succeeded') {
          assert.equal(terminal.state, 'failed', 'only actual focused-test failure has authorized correction');
          assert.equal(terminal.result?.focusedTest?.terminalStatus, 'failed'); assert.equal(terminal.result?.rollback?.status, 'succeeded');
          assert.deepEqual(beforeImages(project, TARGETS[phase]), before, 'atomic full rollback');
          assert.equal(git(project, ['rev-parse', 'HEAD']), baseline); assert.equal(git(project, ['status', '--porcelain=v1']), ''); protectedCheck();
          row.atomicRollbackVerified = true;
          assert.notEqual(cfg.resume?.kind, 'failed', 'bounded4+4+3 stops on first new core/CLI failure after full rollback');
          assert.equal(attempt, 0, 'second bounded failure stops the strategy');
          selection = await waitRepairSelection(out, phase, terminal); row.repairSelection = selection;
          prior = terminal; kind = 'repair';
          const output = terminal.audit?.executionEvents?.find(event => event.type === 'process_terminated')?.details?.testOutput;
          request = (phase === 'core' ? freeze.inputs.firstRequest : freeze.inputs.secondRequest)
            + '\nJde o opravu skutečného selhaného návrhu. Zachovej stejné soubory a dependency graf. Oprav pouze '
            + selection.targets.join(', ') + '; ostatní materiály budou zachovány bajtově. Odůvodnění operátora: ' + selection.reason + '. Funkční diagnostika: '
            + JSON.stringify({ stdout: output?.stdout?.slice(-1000), stderr: output?.stderr?.slice(-500) });
          continue;
        }
        assert.equal(terminal.result?.focusedTest?.terminalStatus, 'succeeded'); assert.equal(terminal.result?.git?.status, 'committed');
        assertAfter(project, view.diff); assert.equal(git(project, ['status', '--porcelain=v1']), ''); protectedCheck();
        if (retainedCore) assert.deepEqual(beforeImages(project, TARGETS.core), retainedCore, 'CLI increment preserves four core files');
        row.committedHead = git(project, ['rev-parse', 'HEAD']); assert.notEqual(row.committedHead, baseline);
        row.oracle = await canonicalOracle(project, runtime.artifacts);
        if (phase === 'cli') assert.match(row.oracle.stdout, /operator frozen core and CLI oracle plus actual guarded entry/);
        await stop(); await start(); await bind();
        const durable = await ask('GET', statusRoute); assert.deepEqual(durable.terminal, terminal.terminal); assert.deepEqual(durable.result, terminal.result);
        const replay = await ask('POST', '/api/m2/lifecycle/approve', { lifecycleId: view.lifecycleId, planDigest: view.planDigest, origin });
        assert.deepEqual(replay, durable); assertAfter(project, view.diff); assert.equal(git(project, ['rev-parse', 'HEAD']), row.committedHead);
        assert.equal(git(project, ['status', '--porcelain=v1']), ''); protectedCheck();
        row.postRestartOracle = await canonicalOracle(project, runtime.artifacts); row.restartAndReplayVerified = true;
        save(out, label + '-completed.json', row); break;
      }
    }
    evidence.status = 'PHYSICAL_PASS_REVIEW_PENDING';
  } catch (error) { evidence.status = 'FAIL'; evidence.error = { message: error.message, stack: error.stack }; }
  finally {
    try { await stop(); } catch (error) { evidence.status = 'FAIL'; evidence.cleanupError = error.message; }
    try { evidence.relayCleanup = await relay.close(); } catch (error) { evidence.status = 'FAIL'; evidence.relayCleanupError = error.message; }
    evidence.completedAt = new Date().toISOString(); save(out, 'renderer-network.json', renderer); save(out, 'http-full-requests-responses.json', http); save(out, 'fan-journey.json', evidence);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
  }
  assert.equal(evidence.status, 'PHYSICAL_PASS_REVIEW_PENDING', evidence.error?.message || evidence.cleanupError);
}

async function parent(freezePath, freezeSha, out) {
  const raw = fs.readFileSync(freezePath); assert.equal(sha(raw), freezeSha, 'explicit immutable freeze SHA');
  const freeze = validateFreeze(JSON.parse(raw)), source = observeSource(freeze);
  assert.equal(source.head, freeze.sourceSha); assert.equal(source.dirty, ''); assert.deepEqual(source.closure, freeze.closure);
  assert.ok(path.isAbsolute(out) && path.dirname(out) === ARTIFACTS && !fs.existsSync(out)); fs.mkdirSync(out, { mode: 0o700 });
  const runtimeProbe = new Database(':memory:'); runtimeProbe.close();
  const evidence = { status: 'RUNNING', source, freezeSha256: freezeSha, startedAt: new Date().toISOString(), liveReview: 'PENDING' };
  let resume = null; const requests = []; let lease = null, proxy = null, child = null, socketRoot = null, loaded = false;
  let interrupted = null, termination = null;
  const interruptParent = signal => {
    interrupted ||= signal;
    if (child && !termination) termination = terminateOwnedChild(child, { termMs: 75000, killMs: 5000 });
  };
  const onTerm = () => interruptParent('SIGTERM');
  const onInt = () => interruptParent('SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  const upstream = async route => { const response = await fetch('http://127.0.0.1:11434' + route, { signal: AbortSignal.timeout(5000) }); assert.ok(response.ok); return response.json(); };
  try {
    if (freeze.resumePending || freeze.resumeFailed) {
      resume = freeze.resumeFailed ? prepareFanFailedResume(freeze, out) : prepareFanPendingResume(freeze, out); requests.push(...JSON.parse(JSON.stringify(resume.requests)));
      save(out, 'resume-provenance.json', { packet: resume.packet, snapshotSha256: (freeze.resumeFailed ?? freeze.resumePending).snapshotSha256, mainDatabaseSha256: (freeze.resumeFailed ?? freeze.resumePending).mainDatabaseSha256, originalModelCalls: 4, remainingModelCalls: 7, lifecycleId: resume.preview.view.lifecycleId, planDigest: resume.preview.view.planDigest });
    }
    assert.equal(interrupted, null, 'interrupted before owned GPU operation');
    lease = acquireGpuEvaluationLock({ command: 'fan actual D1 Studio2 CODE two-increment qualification' });
    const ps = await upstream('/api/ps');
    const compute = execFileSync('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader'], { encoding: 'utf8' }).trim();
    const gpu = execFileSync('nvidia-smi', ['--query-gpu=memory.free,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(',').map(value => Number(value.trim()));
    const mem = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo', 'utf8')), disk = fs.statfsSync(SOURCE);
    evidence.readiness = assessScheduledEvaluationReadiness({ residentModels: ps.models.map(row => row.name), computeProcesses: compute ? compute.split('\n') : [],
      memoryAvailableBytes: Number(mem?.[1]) * 1024, diskAvailableBytes: disk.bavail * disk.bsize });
    assert.ok(evidence.readiness.ready); assert.ok(gpu[0] >= 20000 && gpu[1] <= 30, 'explicit idle GPU placement precondition');
    assert.equal((await upstream('/api/tags')).models.find(row => row.name === freeze.model)?.digest, freeze.digest);
    assert.equal((await upstream('/api/version')).version, freeze.providerVersion);
    socketRoot = fs.mkdtempSync('/tmp/is-fan-journey-'); fs.chmodSync(socketRoot, 0o700); const socketPath = path.join(socketRoot, 'provider.sock');
    proxy = createFanProviderProxy({ freeze, out, requests, onModelCall: () => { loaded = true; } });
    await new Promise(resolve => proxy.server.listen(socketPath, resolve)); fs.chmodSync(socketPath, 0o600);
    const runtimePaths = resume ? Object.fromEntries(Object.entries({ root: '', home: 'home', xdgConfig: 'xdg-config', xdgCache: 'xdg-cache', xdgData: 'xdg-data', xdgState: 'xdg-state', temp: 'tmp', npmCache: 'npm-cache', projects: 'home/projects', artifacts: 'artifacts', database: 'm1.sqlite' }).map(([key, relative]) => [key, path.join(resume.runtimeRoot, relative)])) : null;
    save(out, 'inside-configuration.json', { freeze, source, socketPath, ...(resume ? { resume: { ...resume, runtimePaths } } : {}) }); save(out, 'frozen-input.json', freeze);
    assert.equal(interrupted, null, 'interrupted before namespace child spawn');
    child = spawn('unshare', ['--user', '--map-root-user', '--net', '--', 'bwrap', '--bind', '/', '/', '--dev', '/dev', '--die-with-parent', ...(resume ? ['--ro-bind', resume.packet, resume.packet, ...(resume.kind === 'failed'
        ? ['--ro-bind', path.dirname(resume.runtimeRoot), path.dirname(resume.runtimeRoot)] : []), '--bind', resume.copyRoot, resume.runtimeRoot] : []),
      process.execPath, SELF, '--inside', path.join(out, 'inside-configuration.json')], { cwd: SOURCE, env: safeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    watchOwnedChild(child);
    const output = { stdout: '', stderr: '' }; child.stdout.on('data', chunk => { output.stdout = (output.stdout + chunk).slice(-100000); });
    child.stderr.on('data', chunk => { output.stderr = (output.stderr + chunk).slice(-100000); });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    evidence.child = { ...exit, ...output }; assert.equal(exit.code, 0, output.stderr); assert.equal(exit.signal, null);
    const actual = requests.filter(row => row.admission);
    evidence.modelCalls = { historical: resume ? 4 : 0, new: actual.length - (resume ? 4 : 0), total: actual.length, maximum: 11 };
    assert.ok(actual.length <= 11); if (resume?.kind === 'failed') assert.equal(actual.length, 11, 'exact historical4+coreRepair4+CLI3 complete');
    assert.ok(actual.length > 0 && actual.every(row => row.physicalIdentityComplete));
    assert.ok(actual.filter(row => row.role === 'CODE').length >= 7);
    if (freeze.entryMode === 'manual') assert.equal(actual.filter(row => row.role !== 'CODE').length, 0);
    else assert.ok(actual.filter(row => row.role === 'D1').length >= 2);
    const journey = read(path.join(out, 'fan-journey.json'));
    assert.equal(journey.status, 'PHYSICAL_PASS_REVIEW_PENDING');
    evidence.modelToPreview = assessFanModelToPreview(requests, journey); evidence.status = 'PHYSICAL_PASS_REVIEW_PENDING';
  } catch (error) { evidence.status = 'FAIL'; evidence.error = { message: error.message, stack: error.stack }; }
  finally {
    let childSettled = !child || watchOwnedChild(child).closed;
    if (child && (!childSettled || termination)) {
      termination ||= terminateOwnedChild(child, { termMs: 75000, killMs: 5000 });
      evidence.childTermination = await termination; childSettled = evidence.childTermination.closed;
      if (evidence.childTermination.killSent || !childSettled) { evidence.forcedChildCleanup = true; evidence.status = 'FAIL'; }
    }
    if (interrupted) { evidence.status = 'FAIL'; evidence.interruptedBy = interrupted; }
    let settled = proxy === null;
    try { if (proxy) { evidence.proxyCleanup = await proxy.close(); settled = true; } } catch (error) { evidence.status = 'FAIL'; evidence.proxyCleanupError = error.message; }
    if (loaded && settled && childSettled) try {
      const ps = await upstream('/api/ps'); assert.ok(ps.models.every(row => row.name === freeze.model && row.digest === freeze.digest), 'foreign model prevents unloading');
      const response = await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: freeze.model, keep_alive: 0 }), signal: AbortSignal.timeout(30000) }); assert.ok(response.ok); await response.text(); evidence.ownedModelUnloaded = true;
    } catch (error) { evidence.status = 'FAIL'; evidence.unloadError = error.message; }
    if (settled && childSettled) { if (socketRoot) fs.rmSync(socketRoot, { recursive: true, force: true }); if (lease) evidence.leaseReleased = lease.release(); }
    else { evidence.status = 'FAIL'; evidence.leaseRetainedForUnsettledRequestsOrChild = lease !== null; }
    if (resume) {
      try { evidence.originalPacketUnchanged = JSON.stringify(snapshotFanPendingPacket(resume.packet)) === JSON.stringify(resume.snapshot); }
      catch (error) { evidence.originalPacketUnchanged = false; evidence.originalPacketError = error.message; }
      if (!evidence.originalPacketUnchanged) evidence.status = 'FAIL';
    }
    evidence.sourceUnchanged = JSON.stringify(observeSource(freeze)) === JSON.stringify(source); if (!evidence.sourceUnchanged) evidence.status = 'FAIL';
    evidence.completedAt = new Date().toISOString(); save(out, 'provider-requests.json', requests); save(out, 'result.json', evidence);
    process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
  }
  console.log(JSON.stringify({ status: evidence.status, evidence: path.join(out, 'result.json') }));
  if (evidence.status !== 'PHYSICAL_PASS_REVIEW_PENDING') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (process.argv[2] === '--inside' && process.argv.length === 4) await inside(process.argv[3]);
  else if (process.argv[2] === '--live' && process.argv.length === 6) await parent(path.resolve(process.argv[3]), process.argv[4], path.resolve(process.argv[5]));
  else {
    assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--preflight'));
    console.log(JSON.stringify({ status: 'QUALIFICATION_ONLY_LIVE_BLOCKED_PROJECT_ROUTING', model: MODEL, digest: DIGEST, providerVersion: VERSION,
      d1Context: 8192, codeContext: 16384, targets: TARGETS, maximumD1: 8, maximumCode: 11,
      requires: ['CHAT owner project-routing fix and fresh independent review', 'actual product CODE profile16384', 'clean frozen source and built Studio closure',
        'explicit FanJourneyFreeze@1 JSON/SHA/new output path', 'owned DISPLAY/XAUTHORITY', 'idle GPU/provider', 'unshare/bwrap/prlimit'] }));
  }
}
