// Operator handoff 2026-09-19: collect first, adjudicate separately.
// This profile deliberately has no scoring or judge authority.
export const COLLECTION_PROFILE = 'role-collection.1';
export const MAX_MODEL_BYTES = 22_000_000_000;

export function collectionSuite(role, suite) {
  return { ...suite, version: `${suite.version}+${COLLECTION_PROFILE}`, tests: suite.tests.map(original => {
    const additions = [];
    if (original.name === 'patch_f63d14d5eb61') additions.push(
      'Upřesnění veřejného API: confidence je řetězec, nikoli číslo. Pro comparison.discriminating === 1 vrať přesně "nízká (jediná úloha)", pro 2 "střední", pro 3 a více "vysoká". Platí pro výhru i prohru založenou na kvalitě.');
    if (original.name === 'patch_adb1258cfec0') additions.push(
      'Zachovej i stávající hranici časového limitu: po přijetí HTTP hlaviček se timer ruší před čtením response.json(), při úspěchu i neúspěšném HTTP statusu. Současně jej zruš při síťové výjimce.');
    const prompt = () => {
      const raw = original.prompt();
      const data = typeof raw === 'string' ? { text: raw } : structuredClone(raw);
      if (additions.length) data.text += '\n\n' + additions.join('\n');
      return data;
    };
    const options = { ...original.options,
      ...(['D1','D2','R1','R2'].includes(role) ? { num_predict: 8192, timeout: 600000 } : {}),
      ...(role === 'VISION' ? { num_predict: 1024 } : {}),
    };
    return { ...original, prompt, options, contractMaterial: {
      ...original.contractMaterial,
      collectionProfile: { version: COLLECTION_PROFILE, additions, options,
        judge: null, scoring: false, tools: [], think: false },
    } };
  }) };
}

export async function collectAnswer(task, model, artifact, call) {
  const data = task.prompt();
  const messages = structuredClone(data.messages || [{ role: 'user', content: data.text || '' }]);
  if (data.images?.length) messages[messages.length - 1].images = [...data.images];
  // Never call prepare(), validateOracle(), grade(), or a semantic judge here.
  const result = await call(model, messages, task.options, artifact);
  return { name: task.name, language: task.language || null,
    captureStatus: result.error ? 'TRANSPORT_ERROR' : result.doneReason === 'length' ? 'OUTPUT_BUDGET_EXHAUSTED' : 'CAPTURED',
    response: result.content, durationMs: result.durationMs,
    evalTokens: result.evalCount, promptEvalTokens: result.promptEvalCount,
    doneReason: result.doneReason || null,
    artifact: { digestSha256: result.digestSha256 || null, providerVersion: result.providerVersion || null },
    error: result.error || null, timedOut: !!result.timedOut,
    gradingStatus: 'NOT_GRADED',
  };
}
