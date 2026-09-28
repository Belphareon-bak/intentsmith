import { createM2FileListPolicyPayload } from '../../contracts/m2/file-list-snapshot-v1.js';
import { isM2FileListOutputRequest, m2FileListOutputEvidenceRef } from '../../contracts/m2/file-list-output-v1.js';
import { validateApprovalGrantForRequest } from '../../contracts/m2/effect-current.js';
import { observeProjectRootListing } from '../executor/project-root-listing.js';

export function createFilesystemListEffectProvider({ observe = observeProjectRootListing } = {}) {
  return Object.freeze({
    async execute({ request, grant, payload, signal }) {
      if (!isM2FileListOutputRequest(request) || !validateApprovalGrantForRequest(request, grant).valid
        || !Buffer.isBuffer(payload) || !payload.equals(createM2FileListPolicyPayload())) {
        throw Object.assign(new TypeError('Exact root-list authority is required'), { code: 'EFFECT_FILE_LIST_INVALID' });
      }
      if (signal?.aborted) throw Object.assign(new Error('Listing cancelled'), { code: 'EFFECT_CANCELLED' });
      const snapshot = await observe(request.target, { policyBytes: payload, signal });
      if (signal?.aborted) throw Object.assign(new Error('Listing cancelled'), { code: 'EFFECT_CANCELLED' });
      return Object.freeze({ outputDigest: snapshot.digest, fileListBytes: snapshot.bytes,
        evidenceRefs: [m2FileListOutputEvidenceRef(request.effectId)] });
    },
  });
}
