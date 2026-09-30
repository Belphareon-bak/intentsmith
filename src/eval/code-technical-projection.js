// Explicit projection of a historical oracle onto executable API behavior.
// This is NOT a replacement oracle for the whole public task. The free-text
// obligations remain unresolved, including for known contradictory controls.
export const CODE_TECHNICAL_PROFILE = 'code-executable-component.1';
export const CONFIDENCE_CASE = 'f63d14d5eb61';

const assertions = [
  'assert(/nedosáhl prahu/.test(d.detail));',
  'assert(/2\\.00×/.test(d.detail), `detail má uvést poměr: ${d.detail}`);',
  'assert(/není změřená/.test(d.detail));',
  'assert(/jistota nízká/.test(d.detail), d.detail);',
];

export function projectConfidenceTests(source) {
  let text = source;
  for (const statement of assertions) {
    if (text.split(statement).length !== 2) throw Error('CODE_PROJECTION_SOURCE_DRIFT');
    text = text.replace(statement, '// Free prose excluded from executable component; semantic review remains mandatory.');
  }
  return { text, deferredAssertions: assertions };
}

export function executableComponent(result, task) {
  const semanticRequired = (task.oracleCase || task.taskFingerprint?.slice(0, 12)) === CONFIDENCE_CASE;
  return {
    profile: CODE_TECHNICAL_PROFILE,
    score: null, passed: false, valid: false,
    outcome: 'PARTIAL_ASSESSMENT', decisionAuthority: false,
    reason: 'Executable evidence is a separate component, not a full-task grade.',
    technical: result,
    semantics: { status: semanticRequired ? 'REVIEW_REQUIRED' : 'NOT_ASSESSED_BY_THIS_PROFILE',
      score: null, deferredAssertions: semanticRequired ? [...assertions] : [],
      reason: semanticRequired
        ? 'Confidence, threshold and speed explanations may agree with or contradict the verified API. No lexical rule decides this.'
        : 'This component does not assess prose surrounding the replacement or operational completion.' },
  };
}
