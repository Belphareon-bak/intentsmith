import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  readProjectFile,
  writeProjectFileAtomic,
} from '../executor/project-path-authority.js';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertNotHardlinked(target, fileSystem) {
  try {
    const stat = fileSystem.statSync(target.real);
    if (stat.isFile() && stat.nlink !== 1) {
      const error = new Error('Existing filesystem target has multiple hardlinks');
      error.code = 'EFFECT_FS_HARDLINK_REJECTED';
      throw error;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function createFilesystemEffectProvider({ fileSystem = fs } = {}) {
  return Object.freeze({
    async execute({ request, payload, signal }) {
      if (request.kind !== 'fs.write') {
        const error = new Error(`Unsupported filesystem effect kind: ${request.kind}`);
        error.code = 'EFFECT_PROVIDER_UNSUPPORTED';
        throw error;
      }
      if (signal?.aborted) {
        const error = new Error('Effect cancelled before filesystem write');
        error.code = 'EFFECT_CANCELLED';
        throw error;
      }

      const before = readProjectFile(
        request.target.canonicalRoot,
        request.target.relativePath,
        { fileSystem },
      );
      assertNotHardlinked(before.target, fileSystem);
      const beforeDigest = before.exists ? digest(Buffer.from(before.content, 'utf8')) : null;
      const content = payload.toString('utf8');
      writeProjectFileAtomic(
        request.target.canonicalRoot,
        request.target.relativePath,
        content,
        { expectedTarget: before.target, fileSystem },
      );

      const after = readProjectFile(
        request.target.canonicalRoot,
        request.target.relativePath,
        { fileSystem },
      );
      const afterBytes = after.exists ? Buffer.from(after.content, 'utf8') : null;
      if (!afterBytes?.equals(payload)) {
        const error = new Error('Filesystem write did not persist the exact authorized bytes');
        error.code = 'EFFECT_FS_WRITE_VERIFICATION_FAILED';
        throw error;
      }
      const afterDigest = digest(afterBytes);
      return Object.freeze({
        changes: Object.freeze({
          paths: Object.freeze([request.target.relativePath]),
          beforeDigest,
          afterDigest,
          diffArtifact: null,
        }),
        outputDigest: afterDigest,
        evidenceRefs: Object.freeze([`effect:${request.effectId}:fs-write`]),
      });
    },
  });
}

export default createFilesystemEffectProvider;
