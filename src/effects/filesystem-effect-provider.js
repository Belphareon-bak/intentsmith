import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ProjectPathError,
  readProjectFileBytes,
  writeProjectFileAtomic,
} from '../executor/project-path-authority.js';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertNotHardlinked(before) {
  if (before.exists && before.linkCount !== 1) {
    const error = new Error('Existing filesystem target has multiple hardlinks');
    error.code = 'EFFECT_FS_HARDLINK_REJECTED';
    throw error;
  }
}

function assertExistingParent(target, fileSystem) {
  const directory = path.dirname(target.real);
  try {
    if (!fileSystem.statSync(directory).isDirectory()) {
      throw new ProjectPathError('parent_not_directory', {
        input: target.input,
        projectRoot: target.projectRoot,
        target: directory,
      });
    }
  } catch (error) {
    if (error instanceof ProjectPathError) throw error;
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new ProjectPathError('parent_directory_missing', {
        input: target.input,
        projectRoot: target.projectRoot,
        target: directory,
      });
    }
    throw error;
  }
}

function appliedFilesystemEvidence({ request, beforeDigest, afterDigest = null, reason }) {
  return Object.freeze({
    changes: Object.freeze({
      paths: Object.freeze([request.target.relativePath]),
      beforeDigest,
      afterDigest,
      diffArtifact: null,
    }),
    rollback: Object.freeze({
      required: true,
      status: 'pending',
      evidenceRef: `effect:${request.effectId}:rollback-pending`,
    }),
    outputDigest: afterDigest,
    evidenceRefs: Object.freeze([`effect:${request.effectId}:${reason}`]),
  });
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

      const before = readProjectFileBytes(
        request.target.canonicalRoot,
        request.target.relativePath,
        { fileSystem },
      );
      assertNotHardlinked(before);
      // The shared legacy writer retains its pre-M2 ability to create parent
      // directories. This authority-bearing provider deliberately does not:
      // path-based recursive mkdir would be an effect before its post-check.
      assertExistingParent(before.target, fileSystem);
      const beforeDigest = before.exists ? digest(before.bytes) : null;
      try {
        writeProjectFileAtomic(
          request.target.canonicalRoot,
          request.target.relativePath,
          payload,
          {
            expectedTarget: before.target,
            fileSystem,
            createParents: false,
          },
        );
      } catch (error) {
        if (error?.effectApplied === true) {
          error.evidence = appliedFilesystemEvidence({
            request,
            beforeDigest,
            afterDigest: request.payloadDigest,
            reason: 'fs-write-durability-unconfirmed',
          });
        }
        throw error;
      }

      let afterDigest = null;
      try {
        const after = readProjectFileBytes(
          request.target.canonicalRoot,
          request.target.relativePath,
          { fileSystem },
        );
        const afterBytes = after.exists ? after.bytes : null;
        afterDigest = afterBytes ? digest(afterBytes) : null;
        if (!afterBytes?.equals(payload)) {
          const error = new Error('Filesystem write did not persist the exact authorized bytes');
          error.code = 'EFFECT_FS_WRITE_VERIFICATION_FAILED';
          throw error;
        }
      } catch (error) {
        // writeProjectFileAtomic returned only after the rename and durability
        // boundary. Any subsequent read/compare error therefore describes an
        // applied effect whose exact terminal bytes are uncertain.
        error.effectApplied = true;
        error.evidence = appliedFilesystemEvidence({
          request,
          beforeDigest,
          afterDigest,
          reason: 'fs-write-post-commit-verification-failed',
        });
        throw error;
      }
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
