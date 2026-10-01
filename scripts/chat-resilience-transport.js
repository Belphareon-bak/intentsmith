// Pure transport verdict for the isolated chat runner. Callers persist the
// original wire separately; this function does not interpret answer quality.
export function assessChatResilienceTransport({ wire, recorded, selected, exit,
  isFinal, postflightDigest, model, modelDigest }) {
  const inferenceWire = wire.filter(call =>
    ['/api/chat', '/api/generate'].includes(call.path));
  const invalidInferenceWire = inferenceWire.filter(call => {
    const terminal = call.response || call.responseLines?.at(-1);
    const presentDigests = terminal && typeof terminal === 'object'
      ? ['digest', 'model_digest_sha256'].filter(key => Object.hasOwn(terminal, key))
      : [];
    return call.error || call.captureComplete === false || call.status !== 200 || terminal?.done !== true
      || terminal.model !== model
      || presentDigests.length === 0
      || presentDigests.some(key => terminal[key] !== modelDigest);
  });
  const exactWire = invalidInferenceWire.length === 0;
  const transportComplete = exit.code === 0 && inferenceWire.length > 0
    && recorded.length === selected.length
    && new Set(recorded.map(row => row.case?.id)).size === selected.length
    && exactWire && postflightDigest === modelDigest
    && selected.every(c => recorded.some(row => row.case?.id === c.id
      && row.B?.status === 200 && row.B?.result?.status === 'ok'
      && typeof row.B?.result?.response?.content === 'string'
      && (!isFinal || row.A?.status === 200
        && typeof row.A?.result?.message?.content === 'string'
        && inferenceWire.some(call => call.caseId === c.id && call.path === '/api/chat'))));
  return { inferenceWire, exactWire,
    invalidInferenceCallCount: invalidInferenceWire.length, transportComplete };
}

export function chatResilienceRunStatus(exit) {
  if (!exit) return 'RUNNING';
  if (exit.code === 0 && exit.transportComplete) return 'LIVE_COMPLETE_UNASSESSED';
  return exit.blocked ? 'BLOCKED_GPU' : 'LIVE_INCOMPLETE';
}
