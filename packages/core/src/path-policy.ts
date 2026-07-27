import { realpathSync } from 'node:fs';
import path from 'node:path';

import type { CapabilityEnvelope } from '@intentsmith/contracts';

import { DomainError } from './errors.js';

export function canonicalizeExistingPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    return realpathSync(resolved);
  } catch {
    throw new DomainError('INVALID_WORKSPACE_ROOT', `Workspace root does not exist: ${inputPath}`);
  }
}

export function canonicalizeCapabilityEnvelope(scope: CapabilityEnvelope): CapabilityEnvelope {
  const fsReadRoots = scope.fsReadRoots.map(canonicalizeExistingPath);
  const fsWriteRoots = scope.fsWriteRoots.map(canonicalizeExistingPath);
  for (const writeRoot of fsWriteRoots) {
    if (!fsReadRoots.some(readRoot => isWithinRoot(writeRoot, readRoot))) {
      throw new DomainError('WRITE_ROOT_OUTSIDE_READ_ROOT', `Write root is outside allowed read roots: ${writeRoot}`);
    }
  }
  return { ...scope, fsReadRoots, fsWriteRoots };
}

export function assertPathInsideRoots(candidate: string, roots: string[]): string {
  const resolved = path.resolve(candidate);
  const canonical = realpathSync(resolved);
  if (!roots.some(root => isWithinRoot(canonical, root))) {
    throw new DomainError('PATH_OUTSIDE_WORKSPACE', `Path is outside allowed roots: ${candidate}`);
  }
  return canonical;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
