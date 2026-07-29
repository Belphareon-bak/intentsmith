import { readdir, readFile, stat } from 'node:fs/promises';

import { createRedactor } from '@intentsmith/worker-sdk';

import type { LeakCheckResult, RedactionResult } from './types.js';

export type ResourceSnapshot = {
  fileDescriptors: number;
  diskBytes: number;
};

async function diskBytes(path: string): Promise<number> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map(entry => diskBytes(`${path}/${entry}`)));
  return sizes.reduce((total, size) => total + size, 0);
}

export async function snapshotResources(root: string): Promise<ResourceSnapshot> {
  let fileDescriptors = 0;
  try {
    fileDescriptors = (await readdir('/proc/self/fd')).length;
  } catch {
    // Unsupported platforms record zero; the artifact remains explicit.
  }
  return { fileDescriptors, diskBytes: await diskBytes(root) };
}

export async function scanRedaction(paths: readonly string[], secrets: readonly string[]): Promise<RedactionResult> {
  const redactor = createRedactor(secrets);
  const findings: string[] = [];
  for (const path of paths) {
    try {
      if (redactor.leaks(await readFile(path, 'utf8'))) findings.push(path);
    } catch {
      // Missing paths are handled by the deterministic artifact checks, not
      // misclassified as a credential leak.
    }
  }
  return { passed: findings.length === 0, checkedLocations: [...paths], findings };
}

export function buildLeakCheck(options: {
  before: ResourceSnapshot;
  after: ResourceSnapshot;
  processGroupMembers?: number[];
  ownedListeners?: string[];
  ownedSockets?: string[];
  ownedTemporaryPaths?: string[];
  isolatedEnvironmentPaths?: string[];
  approvalWaiters?: number;
  liveApprovalGrants?: number;
  liveGatewayTokens?: number;
  operatorCredentialLeaks?: string[];
}): LeakCheckResult {
  const result: LeakCheckResult = {
    processGroupMembers: options.processGroupMembers ?? [],
    ownedListeners: options.ownedListeners ?? [],
    ownedSockets: options.ownedSockets ?? [],
    ownedTemporaryPaths: options.ownedTemporaryPaths ?? [],
    isolatedEnvironmentPaths: options.isolatedEnvironmentPaths ?? [],
    fileDescriptorDelta: options.after.fileDescriptors - options.before.fileDescriptors,
    diskBytesDelta: options.after.diskBytes - options.before.diskBytes,
    approvalWaiters: options.approvalWaiters ?? 0,
    liveApprovalGrants: options.liveApprovalGrants ?? 0,
    liveGatewayTokens: options.liveGatewayTokens ?? 0,
    operatorCredentialLeaks: options.operatorCredentialLeaks ?? [],
    passed: false,
  };
  result.passed =
    result.processGroupMembers.length === 0 &&
    result.ownedListeners.length === 0 &&
    result.ownedSockets.length === 0 &&
    result.ownedTemporaryPaths.length === 0 &&
    result.isolatedEnvironmentPaths.length === 0 &&
    result.approvalWaiters === 0 &&
    result.liveApprovalGrants === 0 &&
    result.liveGatewayTokens === 0 &&
    result.operatorCredentialLeaks.length === 0;
  return result;
}
