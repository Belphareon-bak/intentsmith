import { createHash } from 'node:crypto';
import path from 'node:path';
import * as v1 from './execution-v1.js';
import { computeEffectRequestDigest, validateEffectRequest } from './effect-v1.js';
import { isPlainRecord, validateExactKeys, validationResult } from '../m1/shared.js';

// DEVELOPMENT_DRAFT: explicit private-loopback opt-in; V1 remains authoritative for V1.
export const M2_PRIVATE_HTTP_PROFILE = 'linux-bwrap-private-loopback-v1';
export const M2_EXECUTION_CONTRACT_VERSION = 2;
export const M2_EXECUTION_CONTRACT_STAGE = 'DEVELOPMENT_DRAFT';
export { M2_EXECUTION_CONTRACT_KIND, M2_EXECUTION_LIMITS, M2_EXECUTION_TERMINAL_STATUS,
  canonicalizeM2ExecutionValue, normalizeM2ExecutionValue, computeM2ExecutionValueDigest,
  computeM2ProjectChangePatchSetDigest, deriveM2ProjectChangeAuthoritySet,
  computeM2ProjectChangeAuthoritySetDigest, isM2ExecutionProjectRelativePath } from './execution-v1.js';

export const M2_PRIVATE_HTTP_SECCOMP_DIGEST = 'sha256:fa6f3187520a32137dee66714b41ae11feeb162b7239e58adedb31e5a0ecc91a';
// canonical-private-loopback-nft-v1; byte exact shared native template, no trailing LF.
const NFT_TEMPLATE = "table inet intentsmith_m2_probe {\n chain input { type filter hook input priority 0; policy drop;\n  iifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport %u ct state { new, established } accept\n  iifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport %u ct state established ct direction reply accept\n }\n chain output { type filter hook output priority 0; policy drop;\n  oifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport %u ct state { new, established } accept\n  oifname \"lo\" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport %u ct state established ct direction reply accept\n }\n}";
export function formatM2PrivateHttpNftRules(port) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new TypeError('m2-private-http-policy:invalid-port');
  return NFT_TEMPLATE.replaceAll('%u', String(port));
}
export function computeM2PrivateHttpNftRulesDigest(port) {
  return `sha256:${createHash('sha256').update(formatM2PrivateHttpNftRules(port), 'ascii').digest('hex')}`;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const isDigest = value => typeof value === 'string' && DIGEST.test(value);
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/;
const REF_KEYS = ['canonicalPath', 'bytes', 'digest', 'device', 'inode'];
const ARTIFACTS = ['launcher', 'ip', 'nft', 'runtimeExecutable', 'oracle'];
const FOCUSED_KEYS = ['authority', 'binary', 'argv', 'argvDigest', 'canonicalCwd',
  'environmentDigest', 'timeoutMs', 'expectedExitCode', 'sandboxProfile',
  'networkPolicy', 'networkPolicyDigest'];
const RESULT_FOCUSED_KEYS = ['effectId', 'terminalStatus', 'exitCode', 'signal',
  'stdoutDigest', 'stderrDigest', 'outputTruncated', 'sandboxProfile', 'networkPolicyDigest'];

function absolute(value) {
  return typeof value === 'string' && value === value.normalize('NFC')
    && Buffer.byteLength(value, 'utf8') <= 4096 && !value.includes('\0')
    && Buffer.from(value, 'utf8').toString('utf8') === value && value.startsWith('/') && value !== '/' && path.posix.resolve(value) === value;
}
function uint64(value, positive = false) {
  return typeof value === 'string' && UINT64.test(value)
    && BigInt(value) <= 0xffffffffffffffffn && (!positive || BigInt(value) > 0n);
}
function artifactErrors(value, context) {
  const errors = validateExactKeys(value, REF_KEYS, [], context);
  if (!isPlainRecord(value)) return errors;
  if (!absolute(value.canonicalPath)) errors.push(`${context}:invalid-canonicalPath`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 1_073_741_824) {
    errors.push(`${context}:invalid-bytes`);
  }
  if (!isDigest(value.digest)) errors.push(`${context}:invalid-digest`);
  if (!uint64(value.device)) errors.push(`${context}:invalid-device`);
  if (!uint64(value.inode, true)) errors.push(`${context}:invalid-inode`);
  return errors;
}

export function validateM2PrivateHttpNetworkPolicy(value) {
  const context = 'm2-private-http-policy';
  const errors = validateExactKeys(value, ['contract', 'version', 'profile', 'architecture',
    'endpoint', 'minimumLandlockAbi', 'nftRulesDigest', 'seccompProgramDigest', 'artifacts'], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== 'M2PrivateHttpNetworkPolicy') errors.push(`${context}:invalid-contract`);
  if (value.version !== 1) errors.push(`${context}:invalid-version`);
  if (value.profile !== M2_PRIVATE_HTTP_PROFILE) errors.push(`${context}:invalid-profile`);
  if (value.architecture !== 'x64') errors.push(`${context}:unsupported-architecture`);
  if (value.minimumLandlockAbi !== 4) errors.push(`${context}:invalid-minimumLandlockAbi`);
  errors.push(...validateExactKeys(value.endpoint, ['family', 'transport', 'address', 'port'], [], `${context}.endpoint`));
  if (isPlainRecord(value.endpoint)) {
    if (value.endpoint.family !== 'ipv4' || value.endpoint.transport !== 'tcp'
      || value.endpoint.address !== '127.0.0.1') errors.push(`${context}:unsupported-endpoint`);
    if (!Number.isSafeInteger(value.endpoint.port) || value.endpoint.port < 1024 || value.endpoint.port > 65535) {
      errors.push(`${context}:invalid-port`);
    }
  }
  for (const key of ['nftRulesDigest', 'seccompProgramDigest']) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (Number.isSafeInteger(value.endpoint?.port) && value.endpoint.port >= 1024 && value.endpoint.port <= 65535
    && value.nftRulesDigest !== computeM2PrivateHttpNftRulesDigest(value.endpoint.port)) {
    errors.push(`${context}:nft-rules-digest-mismatch`);
  }
  if (value.seccompProgramDigest !== M2_PRIVATE_HTTP_SECCOMP_DIGEST) errors.push(`${context}:seccomp-program-digest-mismatch`);
  errors.push(...validateExactKeys(value.artifacts, ARTIFACTS, [], `${context}.artifacts`));
  if (isPlainRecord(value.artifacts)) {
    for (const key of ARTIFACTS) errors.push(...artifactErrors(value.artifacts[key], `${context}.artifacts.${key}`));
    if (value.artifacts.ip?.canonicalPath !== '/usr/bin/ip'
      || value.artifacts.nft?.canonicalPath !== '/usr/sbin/nft') errors.push(`${context}:setup-tool-path-mismatch`);
    const paths = ARTIFACTS.map(key => value.artifacts[key]?.canonicalPath);
    if (new Set(paths).size !== paths.length) errors.push(`${context}:artifact-path-reused`);
  }
  return validationResult(errors, value);
}
export function computeM2PrivateHttpNetworkPolicyDigest(value) {
  const result = validateM2PrivateHttpNetworkPolicy(value);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return v1.computeM2ExecutionValueDigest(value);
}

// Internal validation projection only: never emitted, persisted, hashed as V2, or used for authority.
function requestBase(value) {
  if (!isPlainRecord(value)) return value;
  const focused = value.focusedTest;
  if (!isPlainRecord(focused)) return { ...value, version: 1 };
  const { networkPolicy, networkPolicyDigest, ...base } = focused;
  return { ...value, version: 1, focusedTest: { ...base, sandboxProfile: 'linux-bwrap-ro-v2' } };
}
function resultBase(value) {
  if (!isPlainRecord(value)) return value;
  if (!isPlainRecord(value.focusedTest)) return { ...value, version: 1 };
  const { sandboxProfile, networkPolicyDigest, ...focusedTest } = value.focusedTest;
  return { ...value, version: 1, focusedTest };
}
function versionError(value, context) {
  return validationResult([`${context}:unsupported-version`], value);
}
function focusedPolicyErrors(value, context, root = null) {
  if (!isPlainRecord(value)) return [];
  const policy = validateM2PrivateHttpNetworkPolicy(value.networkPolicy);
  const errors = [...policy.errors];
  if (value.sandboxProfile !== M2_PRIVATE_HTTP_PROFILE) errors.push(`${context}:invalid-sandboxProfile`);
  if (!isDigest(value.networkPolicyDigest)) errors.push(`${context}:invalid-networkPolicyDigest`);
  if (!policy.valid) return errors;
  if (value.networkPolicyDigest !== computeM2PrivateHttpNetworkPolicyDigest(value.networkPolicy)) {
    errors.push(`${context}:network-policy-digest-mismatch`);
  }
  if (value.binary !== value.networkPolicy.artifacts.runtimeExecutable.canonicalPath
    || value.argv?.[0] !== value.networkPolicy.artifacts.oracle.canonicalPath) {
    errors.push(`${context}:trusted-command-mismatch`);
  }
  if (typeof root === 'string' && ARTIFACTS.some(key => {
    const candidate = value.networkPolicy.artifacts[key].canonicalPath;
    return candidate === root || candidate.startsWith(`${root}/`);
  })) errors.push(`${context}:trusted-artifact-inside-project`);
  return errors;
}

export function validateM2ProjectChangeRequest(value) {
  if (value?.version === 1) return v1.validateM2ProjectChangeRequest(value);
  if (value?.version !== 2) return versionError(value, 'project-change-request');
  const errors = [...v1.validateM2ProjectChangeRequest(requestBase(value)).errors,
    ...validateExactKeys(value.focusedTest, FOCUSED_KEYS, [], 'project-change-request.focusedTest'),
    ...focusedPolicyErrors(value.focusedTest, 'project-change-request.focusedTest', value.project?.canonicalRoot)];
  return validationResult(errors, value);
}
export function computeM2ProjectChangeRequestDigest(value) {
  if (value?.version === 1) return v1.computeM2ProjectChangeRequestDigest(value);
  const result = validateM2ProjectChangeRequest(value);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return v1.computeM2ExecutionValueDigest(value);
}
export function validateM2ProjectChangeResult(value) {
  if (value?.version === 1) return v1.validateM2ProjectChangeResult(value);
  if (value?.version !== 2) return versionError(value, 'project-change-result');
  const errors = [...v1.validateM2ProjectChangeResult(resultBase(value)).errors,
    ...validateExactKeys(value.focusedTest, RESULT_FOCUSED_KEYS, [], 'project-change-result.focusedTest')];
  if (value.focusedTest?.sandboxProfile !== M2_PRIVATE_HTTP_PROFILE) errors.push('project-change-result:invalid-sandboxProfile');
  if (!isDigest(value.focusedTest?.networkPolicyDigest)) errors.push('project-change-result:invalid-networkPolicyDigest');
  return validationResult(errors, value);
}
export function validateM2ProjectChangeResultForRequest(request, result) {
  if (request?.version === 1 && result?.version === 1) return v1.validateM2ProjectChangeResultForRequest(request, result);
  const errors = [...validateM2ProjectChangeRequest(request).errors, ...validateM2ProjectChangeResult(result).errors];
  if (request?.version !== 2 || result?.version !== 2) errors.push('project-change-result:mixed-execution-versions');
  if (errors.length) return validationResult(errors, result);
  const baseRequest = requestBase(request);
  errors.push(...v1.validateM2ProjectChangeResultForRequest(baseRequest, {
    ...resultBase(result), requestDigest: v1.computeM2ProjectChangeRequestDigest(baseRequest),
  }).errors);
  if (result.requestDigest !== computeM2ProjectChangeRequestDigest(request)) errors.push('project-change-result:request-identity-mismatch');
  if (result.focusedTest.networkPolicyDigest !== request.focusedTest.networkPolicyDigest
    || result.focusedTest.sandboxProfile !== request.focusedTest.sandboxProfile) {
    errors.push('project-change-result:network-policy-mismatch');
  }
  return validationResult(errors, result);
}

function validEnvironment(value) {
  return isPlainRecord(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      && typeof item === 'string' && item === item.normalize('NFC') && !item.includes('\0')
      && Buffer.byteLength(item, 'utf8') <= 32768);
}
export function encodeM2PrivateHttpProcessPayload(focusedTest, environment) {
  const errors = focusedPolicyErrors(focusedTest, 'm2-private-http-process');
  if (!validEnvironment(environment)) errors.push('m2-private-http-process:invalid-environment');
  else if (v1.computeM2ExecutionValueDigest(environment) !== focusedTest?.environmentDigest) {
    errors.push('m2-private-http-process:environment-digest-mismatch');
  }
  if (errors.length) throw new TypeError(errors.join(','));
  const bytes = Buffer.from(v1.canonicalizeM2ExecutionValue({ binary: focusedTest.binary,
    argv: focusedTest.argv, environment, sandboxProfile: focusedTest.sandboxProfile,
    networkPolicy: focusedTest.networkPolicy, networkPolicyDigest: focusedTest.networkPolicyDigest }), 'utf8');
  if (bytes.length > v1.M2_EXECUTION_LIMITS.MAX_WIRE_BYTES) throw new TypeError('m2-private-http-process:payload-too-large');
  return bytes;
}
export function validateM2PrivateHttpProcessEffectForRequest(request, effect, payloadBytes, environment) {
  const errors = [...validateM2ProjectChangeRequest(request).errors, ...validateEffectRequest(effect).errors];
  if (request?.version !== 2) errors.push('m2-private-http-process:requires-request-v2');
  if (errors.length) return validationResult(errors, effect);
  let expected;
  try { expected = encodeM2PrivateHttpProcessPayload(request.focusedTest, environment); }
  catch (error) { return validationResult([error.message], effect); }
  if (!(Buffer.isBuffer(payloadBytes) || payloadBytes instanceof Uint8Array)
    || !expected.equals(Buffer.from(payloadBytes))) errors.push('m2-private-http-process:payload-bytes-mismatch');
  const bytesDigest = `sha256:${createHash('sha256').update(expected).digest('hex')}`;
  const target = { type: 'process', binary: request.focusedTest.binary, argv: request.focusedTest.argv,
    argvDigest: request.focusedTest.argvDigest, canonicalCwd: request.project.canonicalRoot };
  if (effect.kind !== 'process.exec' || effect.requiredCapability !== 'project.process.exec'
    || effect.effectId !== request.focusedTest.authority.effectId
    || computeEffectRequestDigest(effect) !== request.focusedTest.authority.requestDigest
    || effect.payloadDigest !== bytesDigest || effect.payloadBytes !== expected.length
    || effect.runId !== request.runId || effect.workspaceRevision !== request.project.workspaceRevision
    || effect.timeoutMs !== request.focusedTest.timeoutMs
    || v1.computeM2ExecutionValueDigest(effect.target) !== v1.computeM2ExecutionValueDigest(target)
    || v1.computeM2ExecutionValueDigest(effect.actor) !== v1.computeM2ExecutionValueDigest(request.actor)
    || v1.computeM2ExecutionValueDigest(effect.origin) !== v1.computeM2ExecutionValueDigest(request.origin)) {
    errors.push('m2-private-http-process:effect-authority-mismatch');
  }
  return validationResult(errors, effect);
}

export function validateM2ExecutionContract(value, expectedContract = null) {
  if (value?.version === 1) return v1.validateM2ExecutionContract(value, expectedContract);
  if (!isPlainRecord(value)) return validationResult(['m2-execution:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) return validationResult(['m2-execution:unexpected-contract'], value);
  if (value.contract === 'ProjectChangeRequest') return validateM2ProjectChangeRequest(value);
  if (value.contract === 'ProjectChangeResult') return validateM2ProjectChangeResult(value);
  return validationResult(['m2-execution:unknown-contract'], value);
}
export function encodeM2ExecutionContract(value, expectedContract = null) {
  if (value?.version === 1) return v1.encodeM2ExecutionContract(value, expectedContract);
  const result = validateM2ExecutionContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Buffer.from(v1.canonicalizeM2ExecutionValue(value), 'utf8');
}
export function decodeM2ExecutionContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) throw new TypeError('m2-execution-decode:invalid-bytes');
  const bytes = Buffer.from(encoded);
  if (!bytes.length || bytes.length > v1.M2_EXECUTION_LIMITS.MAX_WIRE_BYTES) throw new TypeError('m2-execution-decode:invalid-size');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-execution-decode:invalid-utf8');
  let value;
  try { value = JSON.parse(text); } catch { throw new TypeError('m2-execution-decode:invalid-json'); }
  if (value?.version === 1) return v1.decodeM2ExecutionContract(encoded, expectedContract);
  const result = validateM2ExecutionContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  if (!encodeM2ExecutionContract(value, expectedContract).equals(bytes)) throw new TypeError('m2-execution-decode:non-canonical-encoding');
  return Object.freeze(value);
}
