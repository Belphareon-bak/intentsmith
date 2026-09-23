import { createHash, randomUUID } from 'node:crypto';

// Answers and criteria travel together. Identity and existing verdicts do not.
// Blinding metadata cannot hide a model identifying itself inside its answer.
export function createBlindAnswerReview(runs) {
  const items = [], identities = [];
  for (const run of runs) {
    if (!run.collection || !['AWAITING_REVIEW','COLLECTION_PARTIAL'].includes(run.status)) {
      throw new Error('Only ungraded collections can enter this review export');
    }
    for (const task of run.tasks) {
      if (!task.input || !Array.isArray(task.responses) || task.responses.length !== task.details.length) {
        throw new Error('Collection detail is incomplete; export the full stored run');
      }
      for (const [index, response] of task.responses.entries()) {
        const id = randomUUID(), detail = task.details[index];
        items.push({ id, role: run.role, task: task.name, independenceGroup: task.independenceGroup,
          input: task.input, criteria: task.rubric, response, captureStatus: detail.captureStatus,
          ...(detail.conversation ? { conversation: {
            transcript: detail.conversation.transcript,
            plannedTurns: detail.conversation.plannedTurns, completedTurns: detail.conversation.completedTurns,
            status: detail.conversation.status, transcriptSha256: detail.conversation.transcriptSha256,
            // Provider identity stays in the private identity key.
            receipts: detail.conversation.receipts.map(r => ({ turn:r.turn, captureStatus:r.captureStatus,
              inputSha256:r.inputSha256, responseSha256:r.responseSha256, error:r.error })),
          } } : {}),
          error: detail.reason || null, score: null, criterionGrades: [], reviewStatus: 'NOT_REVIEWED' });
        identities.push({ id, runId: run.runId, model: run.model, digestSha256: run.digestSha256,
          suiteContractSha256: run.suiteContractSha256, providerVersion: run.providerVersion,
          task: task.name, repeat: index + 1, responseSha256: createHash('sha256').update(response).digest('hex'),
          ...(detail.conversation ? { conversationReceipts:detail.conversation.receipts } : {}) });
      }
    }
  }
  // Do not expose blocks of repeated answers in model/run order.
  items.sort((a,b) => a.id.localeCompare(b.id));
  return {
    review: { schemaVersion: 1, purpose: 'INDEPENDENT_REVIEW', identityMetadataRemoved: true,
      gradingAuthority: false, instructions: 'Grade content against the supplied criteria. Record a reason for each criterion; unresolved task defects remain null. Do not grade transport errors or CODE oracles by reading.', items },
    identityKey: { schemaVersion: 1, privateUntilReviewFrozen: true, identities },
  };
}
