import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  M2_GOVERNANCE_CHECK_STATUS,
  M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_VERSION,
  M2_GOVERNANCE_DECISION_CHECKS,
  M2_GOVERNANCE_VERDICT,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceValueDigest,
  createM2GovernanceDecision,
  createM2GovernanceFinding,
  validateM2GovernanceDecision,
  validateM2GovernanceBaselineSnapshot,
  validateM2GovernancePolicySnapshot,
  validateM2GovernanceReceipt,
  validateM2GovernanceReceiptForDecision,
} from '../../contracts/m2/governance-v1.js';
import {
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  isM2ExecutionProjectRelativePath,
  validateM2ProjectChangeRequest,
} from '../../contracts/m2/execution-v1.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../../contracts/m1/shared.js';

const REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IMPORT_PATTERNS = Object.freeze([
  /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]);

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isRevision(value) {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function validUtf8(bytes) {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function safeDigest(value, label) {
  try {
    return computeM2GovernanceValueDigest(value);
  } catch {
    return computeM2GovernanceValueDigest({ invalidGovernanceInput: label });
  }
}

function validateSortedFilePaths(files, context) {
  const errors = [];
  for (let index = 1; index < files.length; index += 1) {
    const previousPath = files[index - 1]?.path;
    const currentPath = files[index]?.path;
    if (
      typeof previousPath === 'string'
      && typeof currentPath === 'string'
      && compareUtf8(previousPath, currentPath) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateCandidateFiles(value, request) {
  const errors = [];
  if (!Array.isArray(value)) return validationResult(['governance-candidates:not-array'], value);
  const requestedPaths = request.changes.map(change => change.path);
  const candidatePaths = value.map(candidate => candidate?.path);
  if (!arraysEqual(candidatePaths, requestedPaths)) {
    errors.push('governance-candidates:exact-request-path-set-required');
  }
  errors.push(...validateSortedFilePaths(value, 'governance-candidates'));
  value.forEach((candidate, index) => {
    const context = `governance-candidates[${index}]`;
    errors.push(...validateExactKeys(candidate, ['path', 'contentBase64'], [], context));
    if (!isPlainRecord(candidate)) return;
    if (!isM2ExecutionProjectRelativePath(candidate.path)) errors.push(`${context}:invalid-path`);
    const bytes = decodeCanonicalBase64(candidate.contentBase64);
    if (bytes === null) {
      errors.push(`${context}:invalid-contentBase64`);
      return;
    }
    const change = request.changes[index];
    if (!change || candidate.path !== change.path) return;
    if (bytes.length !== change.after.bytes) errors.push(`${context}:after-byte-count-mismatch`);
    if (sha256(bytes) !== change.after.digest) errors.push(`${context}:after-digest-mismatch`);
  });
  return validationResult(errors, value);
}

function baselineMatchesRequest(baseline, request) {
  const errors = [];
  const byPath = new Map(baseline.files.map(file => [file.path, file]));
  for (const change of request.changes) {
    const entry = byPath.get(change.path);
    if (change.before.exists === false) {
      if (entry) errors.push(`new-path-present:${change.path}`);
      continue;
    }
    if (!entry) {
      errors.push(`before-path-missing:${change.path}`);
      continue;
    }
    if (entry.digest !== change.before.digest || entry.bytes !== change.before.bytes) {
      errors.push(`before-image-mismatch:${change.path}`);
    }
  }
  return errors;
}

function overlayCandidate(baseline, candidates, request) {
  const byPath = new Map(baseline.files.map(file => [file.path, {
    path: file.path,
    bytes: decodeCanonicalBase64(file.contentBase64),
  }]));
  candidates.forEach((candidate, index) => {
    byPath.set(candidate.path, {
      path: candidate.path,
      bytes: decodeCanonicalBase64(candidate.contentBase64),
      changed: true,
      change: request.changes[index],
    });
  });
  return [...byPath.values()].sort((left, right) => compareUtf8(left.path, right.path));
}

function layerForFile(filePath, policy) {
  const matches = [];
  for (const layer of policy.layers) {
    for (const root of layer.roots) {
      if (filePath === root || filePath.startsWith(`${root}/`)) {
        matches.push({ name: layer.name, root });
      }
    }
  }
  matches.sort((left, right) => {
    const lengthDelta = right.root.length - left.root.length;
    return lengthDelta || compareUtf8(left.name, right.name);
  });
  return matches[0]?.name ?? null;
}

function scanImports(source) {
  const imports = [];
  const recognizedRanges = [];
  for (const pattern of IMPORT_PATTERNS) {
    const expression = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = expression.exec(source)) !== null) {
      imports.push(match[1]);
      recognizedRanges.push([match.index, match.index + match[0].length]);
    }
  }
  // RegExp offsets are UTF-16 code-unit indexes, so split the same way.
  const residue = source.split('');
  for (const [start, end] of recognizedRanges) {
    for (let index = start; index < end; index += 1) residue[index] = ' ';
  }
  const unmatched = residue.join('').replace(/\bimport\s*\.\s*meta\b/g, '');
  return Object.freeze({
    specifiers: Object.freeze([...new Set(imports)].sort(compareUtf8)),
    complete: !(
      /\b(?:import|require)\b/.test(unmatched)
      || /\bexport\b[^;]*?\bfrom\b/.test(unmatched)
    ),
  });
}

function resolveRelativeImport(specifier, sourcePath, filesByPath) {
  const relative = specifier.startsWith('.');
  const base = relative
    ? path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))
    : path.posix.normalize(specifier);
  if (!isM2ExecutionProjectRelativePath(base)) return { external: false, path: null };
  const candidates = [
    base,
    ...[...SUPPORTED_SOURCE_EXTENSIONS].map(extension => `${base}${extension}`),
    ...[...SUPPORTED_SOURCE_EXTENSIONS].map(extension => `${base}/index${extension}`),
  ];
  const matches = candidates.filter(candidate => filesByPath.has(candidate));
  if (!relative && matches.length === 0) return { external: true, path: null };
  if (matches.length !== 1) return { external: false, path: null };
  return { external: false, path: matches[0] };
}

function makeCheck(checkId, status, findings) {
  return Object.freeze({
    checkId,
    required: true,
    status,
    findingIds: findings
      .filter(finding => finding.checkId === checkId)
      .map(finding => finding.findingId)
      .sort(compareUtf8),
  });
}

function decisionVerdict(checks) {
  if (checks.some(check => check.status === M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE)) {
    return M2_GOVERNANCE_VERDICT.UNAVAILABLE;
  }
  if (checks.some(check => check.status === M2_GOVERNANCE_CHECK_STATUS.FAIL)) {
    return M2_GOVERNANCE_VERDICT.DENY;
  }
  return M2_GOVERNANCE_VERDICT.ALLOW;
}

function addFinding(findingsById, checkId, code, pathValue, evidence) {
  const finding = createM2GovernanceFinding({
    checkId,
    code,
    path: pathValue,
    evidence,
  });
  findingsById.set(finding.findingId, finding);
}

function upstreamUnavailable(findingsById, checkId, upstream) {
  addFinding(
    findingsById,
    checkId,
    'UPSTREAM_REQUIRED_CHECK_UNAVAILABLE',
    null,
    { upstream },
  );
}

/**
 * Deterministically evaluate the exact proposed after-images before executing
 * ProjectChangeRequest. No filesystem, database, model, network, or clock is
 * consulted. Every byte used by the evaluator is supplied and digest-bound.
 */
export function evaluateM2Governance({
  lifecycleId,
  milestoneId,
  request,
  policySnapshot,
  baselineSnapshot,
  candidateFiles,
  expectedAfterRevision,
}) {
  if (!isIdentifier(lifecycleId) || !isIdentifier(milestoneId)) {
    throw new TypeError('m2-governance-evaluator:invalid-lifecycle-identity');
  }
  const requestValidation = validateM2ProjectChangeRequest(request);
  if (!requestValidation.valid) {
    throw new TypeError(`m2-governance-evaluator:invalid-request:${requestValidation.errors.join(',')}`);
  }

  const requestDigest = computeM2ProjectChangeRequestDigest(request);
  const policyValidation = validateM2GovernancePolicySnapshot(policySnapshot);
  const baselineValidation = validateM2GovernanceBaselineSnapshot(baselineSnapshot);
  const candidateValidation = validateCandidateFiles(candidateFiles, request);
  const policyDigest = policyValidation.valid
    ? computeM2GovernancePolicySnapshotDigest(policySnapshot)
    : safeDigest(policySnapshot, 'policy');
  const baselineDigest = baselineValidation.valid
    ? computeM2GovernanceBaselineDigest(baselineSnapshot)
    : safeDigest(baselineSnapshot, 'baseline');
  const boundAfterRevision = isRevision(expectedAfterRevision) ? expectedAfterRevision : null;
  const findingsById = new Map();

  let inputStatus = M2_GOVERNANCE_CHECK_STATUS.PASS;
  if (!policyValidation.valid) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'POLICY_INVALID', null, {
      errors: policyValidation.errors,
    });
  }
  if (!baselineValidation.valid) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'BASELINE_INVALID', null, {
      errors: baselineValidation.errors,
    });
  }
  if (!candidateValidation.valid) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'CANDIDATE_MATERIAL_INVALID', null, {
      errors: candidateValidation.errors,
    });
  }
  if (boundAfterRevision === null || boundAfterRevision === request.project.workspaceRevision) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'EXPECTED_AFTER_REVISION_INVALID', null, {
      beforeRevision: request.project.workspaceRevision,
      expectedAfterRevision,
    });
  }
  if (policyValidation.valid && (
    policySnapshot.projectId !== request.project.projectId
    || policySnapshot.workspaceRevision !== request.project.workspaceRevision
  )) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'POLICY_REQUEST_BINDING_MISMATCH', null, {
      policyProjectId: policySnapshot.projectId,
      policyRevision: policySnapshot.workspaceRevision,
      requestProjectId: request.project.projectId,
      requestRevision: request.project.workspaceRevision,
    });
  }
  if (
    policyValidation.valid
    && request.changes.some(change => change.path === policySnapshot.policyPath)
  ) {
    if (inputStatus === M2_GOVERNANCE_CHECK_STATUS.PASS) {
      inputStatus = M2_GOVERNANCE_CHECK_STATUS.FAIL;
    }
    addFinding(
      findingsById,
      'input.bindings',
      'POLICY_SELF_CHANGE_FORBIDDEN',
      policySnapshot.policyPath,
      {
        policyDigest,
        policyPath: policySnapshot.policyPath,
        requestDigest,
      },
    );
  }
  if (baselineValidation.valid && (
    baselineSnapshot.projectId !== request.project.projectId
    || baselineSnapshot.workspaceRevision !== request.project.workspaceRevision
  )) {
    inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'input.bindings', 'BASELINE_REQUEST_BINDING_MISMATCH', null, {
      baselineProjectId: baselineSnapshot.projectId,
      baselineRevision: baselineSnapshot.workspaceRevision,
      requestProjectId: request.project.projectId,
      requestRevision: request.project.workspaceRevision,
    });
  }
  if (baselineValidation.valid) {
    const beforeMismatches = baselineMatchesRequest(baselineSnapshot, request);
    if (beforeMismatches.length > 0) {
      inputStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
      addFinding(findingsById, 'input.bindings', 'BASELINE_BEFORE_IMAGE_MISMATCH', null, {
        mismatches: beforeMismatches.sort(compareUtf8),
      });
    }
  }

  let inventoryStatus = M2_GOVERNANCE_CHECK_STATUS.PASS;
  if (inputStatus === M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE) {
    inventoryStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    upstreamUnavailable(findingsById, 'inventory.complete', 'input.bindings');
  } else if (baselineSnapshot.complete !== true) {
    inventoryStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    addFinding(findingsById, 'inventory.complete', 'INVENTORY_TRUNCATED', null, {
      complete: baselineSnapshot.complete,
      observedFiles: baselineSnapshot.files.length,
    });
  }

  let layersStatus = M2_GOVERNANCE_CHECK_STATUS.PASS;
  let importsStatus = M2_GOVERNANCE_CHECK_STATUS.PASS;
  let overlay = [];
  if (inventoryStatus !== M2_GOVERNANCE_CHECK_STATUS.PASS) {
    layersStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
    upstreamUnavailable(findingsById, 'layers.mapped', 'inventory.complete');
    upstreamUnavailable(findingsById, 'imports.allowed', 'inventory.complete');
  } else {
    overlay = overlayCandidate(baselineSnapshot, candidateFiles, request);
    const declaredSourceExtensions = new Set(policySnapshot.sourceExtensions);
    for (const file of overlay) {
      const extension = path.posix.extname(file.path).toLowerCase();
      if (!declaredSourceExtensions.has(extension)) continue;
      const layer = layerForFile(file.path, policySnapshot);
      if (layer === null) {
        layersStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
        addFinding(findingsById, 'layers.mapped', 'SOURCE_FILE_UNMAPPED', file.path, {
          policyDigest,
          path: file.path,
        });
      }
      if (!SUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
        importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
        addFinding(findingsById, 'imports.allowed', 'SOURCE_LANGUAGE_UNSUPPORTED', file.path, {
          extension,
          path: file.path,
        });
      }
    }

    if (layersStatus !== M2_GOVERNANCE_CHECK_STATUS.PASS) {
      importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
      upstreamUnavailable(findingsById, 'imports.allowed', 'layers.mapped');
    } else if (importsStatus === M2_GOVERNANCE_CHECK_STATUS.PASS) {
      const filesByPath = new Map(overlay.map(file => [file.path, file]));
      const rulesByLayer = new Map(policySnapshot.rules.map(rule => [rule.from, rule]));
      for (const file of overlay) {
        const extension = path.posix.extname(file.path).toLowerCase();
        if (!declaredSourceExtensions.has(extension)
          || !SUPPORTED_SOURCE_EXTENSIONS.has(extension)) continue;
        const source = validUtf8(file.bytes);
        if (source === null) {
          importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
          addFinding(findingsById, 'imports.allowed', 'SOURCE_NOT_UTF8', file.path, {
            path: file.path,
            digest: sha256(file.bytes),
          });
          continue;
        }
        const fromLayer = layerForFile(file.path, policySnapshot);
        const rule = rulesByLayer.get(fromLayer);
        const scan = scanImports(source);
        if (!scan.complete) {
          importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
          addFinding(findingsById, 'imports.allowed', 'IMPORT_SYNTAX_UNSUPPORTED', file.path, {
            sourcePath: file.path,
            sourceDigest: sha256(file.bytes),
          });
        }
        for (const specifier of scan.specifiers) {
          const resolved = resolveRelativeImport(specifier, file.path, filesByPath);
          if (resolved.external) {
            if (!policySnapshot.externalImports.includes(specifier)) {
              importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
              addFinding(findingsById, 'imports.allowed', 'EXTERNAL_IMPORT_UNDECLARED', file.path, {
                sourcePath: file.path,
                specifier,
              });
            }
            continue;
          }
          if (resolved.path === null) {
            importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
            addFinding(findingsById, 'imports.allowed', 'RELATIVE_IMPORT_UNRESOLVED', file.path, {
              sourcePath: file.path,
              specifier,
            });
            continue;
          }
          const toLayer = layerForFile(resolved.path, policySnapshot);
          if (toLayer === null) {
            importsStatus = M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE;
            addFinding(findingsById, 'imports.allowed', 'IMPORT_TARGET_UNMAPPED', file.path, {
              sourcePath: file.path,
              specifier,
              targetPath: resolved.path,
            });
            continue;
          }
          if (fromLayer !== toLayer && !rule.canImport.includes(toLayer)) {
            if (importsStatus !== M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE) {
              importsStatus = M2_GOVERNANCE_CHECK_STATUS.FAIL;
            }
            addFinding(findingsById, 'imports.allowed', 'IMPORT_LAYER_VIOLATION', file.path, {
              sourcePath: file.path,
              specifier,
              targetPath: resolved.path,
              fromLayer,
              toLayer,
            });
          }
        }
      }
    }
  }

  const findings = [...findingsById.values()]
    .sort((left, right) => compareUtf8(left.findingId, right.findingId));
  const statusByCheck = new Map([
    ['imports.allowed', importsStatus],
    ['input.bindings', inputStatus],
    ['inventory.complete', inventoryStatus],
    ['layers.mapped', layersStatus],
  ]);
  const checks = M2_GOVERNANCE_DECISION_CHECKS.map(checkId => (
    makeCheck(checkId, statusByCheck.get(checkId), findings)
  ));
  const verdict = decisionVerdict(checks);
  return createM2GovernanceDecision({
    lifecycleId,
    milestoneId,
    executionId: request.executionId,
    runId: request.runId,
    projectId: request.project.projectId,
    requestDigest,
    policyDigest,
    baselineDigest,
    expectedAfterRevision: boundAfterRevision,
    verdict,
    checks,
    findings,
    blockingFindingIds: verdict === M2_GOVERNANCE_VERDICT.ALLOW
      ? []
      : findings.map(finding => finding.findingId).sort(compareUtf8),
  });
}

export function createM2GovernanceReceipt({
  request,
  result,
  decision,
  recordedAt,
}) {
  const decisionValidation = validateM2GovernanceDecision(decision);
  if (!decisionValidation.valid) {
    throw new TypeError(`m2-governance-receipt:invalid-decision:${decisionValidation.errors.join(',')}`);
  }
  if (decision.verdict !== M2_GOVERNANCE_VERDICT.ALLOW) {
    throw new TypeError('m2-governance-receipt:allow-decision-required');
  }
  const evidenceRefs = [
    ...(Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : []),
    `governance-decision:${decision.decisionId}`,
    `project-change-result:${result?.executionId}`,
  ].sort(compareUtf8);
  const projection = {
    contract: M2_GOVERNANCE_CONTRACT_KIND.RECEIPT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    decisionDigest: computeM2GovernanceDecisionDigest(decision),
    lifecycleId: decision.lifecycleId,
    milestoneId: decision.milestoneId,
    executionId: decision.executionId,
    runId: decision.runId,
    projectId: decision.projectId,
    requestDigest: decision.requestDigest,
    policyDigest: decision.policyDigest,
    baselineDigest: decision.baselineDigest,
    expectedAfterRevision: decision.expectedAfterRevision,
    resultDigest: computeM2ExecutionValueDigest(result),
    actualAfterRevision: result?.changes?.afterRevision,
    fencingGeneration: result?.fencingGeneration,
    status: 'accepted',
    recordedAt,
    evidenceRefs,
  };
  const receipt = Object.freeze({
    receiptId: `govreceipt1:${computeM2GovernanceValueDigest(projection).slice('sha256:'.length)}`,
    ...projection,
  });
  const validation = validateM2GovernanceReceipt(receipt);
  if (!validation.valid) {
    throw new TypeError(`m2-governance-receipt:invalid:${validation.errors.join(',')}`);
  }
  const semantic = validateM2GovernanceReceiptForDecision(request, result, decision, receipt);
  if (!semantic.valid) {
    throw new TypeError(`m2-governance-receipt:not-bound:${semantic.errors.join(',')}`);
  }
  return receipt;
}

export const _testInternals = Object.freeze({
  decodeCanonicalBase64,
  layerForFile,
  resolveRelativeImport,
  scanImports,
  validUtf8,
});
