import { applyAndTest, extractFunctionCodes, buildPrompt } from './code-patch-runner.js';
import { CODE_TECHNICAL_PROFILE, CONFIDENCE_CASE } from './code-technical-projection.js';

export function assessExecutable(repo, task, response) {
  return applyAndTest(repo, task, extractFunctionCodes(response, task.spans), { oracleProfile: CODE_TECHNICAL_PROFILE });
}

// Acceptance of the *component*, never acceptance of the full task. In
// particular, contradictory prose must remain unresolved, not receive PASS.
export function verifyExecutableTask(repo, task, beforeEach = () => {}) {
  const fenced = codes => codes.map(code => '```javascript\n' + code + '\n```').join('\n');
  const samples = [
    ['gold', fenced(task.goldTexts), 1],
    ['alternative', fenced(task.oracleAcceptance.alternativeTexts), 1],
    ['broken', fenced(task.functionTexts), 0],
    ['empty', '', 0],
    ['prompt-echo', buildPrompt(task), 0],
  ];
  if (task.spans.length === 1) {
    const lines = task.oracleAcceptance.alternativeTexts[0].split('\n'), at = Math.floor(lines.length / 2);
    samples.push(['alternative-two-blocks', fenced([lines.slice(0, at).join('\n'), lines.slice(at).join('\n')]), 1]);
  }
  if (['0fe346cc820c', '6fc5e4eb7dce'].includes(task.oracleCase)) {
    samples.push(['regression-existing-owner', fenced(task.goldTexts.map(c => c.replace(/.*MODEL_VALIDATION:.*\n/g, ''))), 0]);
    samples.push(['regression-existing-reader', fenced(task.goldTexts.map(c => c.replace(/.*MODEL_ACTIVITY_OWNER\.BINDING_VERIFICATION,?\n/g, ''))), 0]);
  }
  if (task.oracleCase === CONFIDENCE_CASE) {
    for (const control of task.oracleAcceptance.additionalControls || []) {
      const codes = task.goldTexts.map(c => c.replaceAll(control.replace.from, control.replace.to));
      if (JSON.stringify(codes) === JSON.stringify(task.goldTexts)) throw Error('CODE_CONTROL_UNCHANGED');
      // Both paraphrases and contradictions preserve executable behavior.
      // Neither obtains a full grade. Their semantic labels remain evidence.
      samples.push([control.name, fenced(codes), 1, control.expectedScore === 0 ? 'contradictory' : 'equivalent']);
    }
    samples.push(['wrong-confidence-enum', fenced(task.goldTexts.map(c => c.replaceAll('nízká (jediná úloha)', 'vysoká'))), 0]);
    samples.push(['wrong-winner', fenced(task.goldTexts.map(c => c.replaceAll("winner: 'candidate'", "winner: 'incumbent'"))), 0]);
  }
  const controls = [];
  for (const [name, response, expected, semanticLabel] of samples) {
    beforeEach();
    const result = assessExecutable(repo, task, response);
    const ok = result.score === null && result.passed === false && result.valid === false
      && result.decisionAuthority === false && result.technical.valid === true
      && !result.technical.timedOut && result.technical.score === expected
      && (task.oracleCase !== CONFIDENCE_CASE || result.semantics.status === 'REVIEW_REQUIRED');
    controls.push({ name, expectedTechnicalScore: expected, semanticLabel: semanticLabel || null, ok, result });
  }
  return { status: controls.every(c => c.ok) ? 'COMPONENT_CONTROLS_PASS' : 'COMPONENT_CONTROLS_FAILED',
    fullOracleAccepted: false, controls };
}

export function summarizeExecutable(items) {
  const models = [...new Set(items.map(i => i.model))].sort();
  return models.map(model => {
    const rows = items.filter(i => i.model === model);
    const taskNames = [...new Set(rows.map(i => i.task))].sort();
    const tasks = taskNames.map(task => {
      const attempts = rows.filter(i => i.task === task), values = attempts.map(i => i.assessment.technical.score);
      const missing = values.filter(v => !Number.isFinite(v)).length;
      return { task, attempts: attempts.length, missing, mean: missing ? null : values.reduce((a,b) => a+b, 0) / values.length };
    });
    return { model, attempts: rows.length, tasks, fullTaskScore: null,
      technicalMean: tasks.some(t => t.mean === null) ? null : tasks.reduce((n,t) => n+t.mean, 0)/tasks.length,
      missing: tasks.reduce((n,t) => n+t.missing, 0),
      semanticReviewRequired: rows.filter(i => i.assessment.semantics.status === 'REVIEW_REQUIRED').length,
      decisionAuthority: false };
  });
}
