'use strict';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const relative = value => typeof value === 'string' && !!value && !value.startsWith('/')
  && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
function normalizeProposal(value) {
  if (!record(value) || !record(value.origin) || !record(value.proposal)) return null;
  const { origin: o, proposal: p } = value;
  if (p.kind !== 'ProjectWorkProposal@1' || !Number.isSafeInteger(p.projectId) || p.projectId < 1
    || o.projectId !== p.projectId || o.surface !== 'studio' || !o.conversationId
    || typeof o.conversationId !== 'string' || o.sessionId !== o.conversationId) return null;
  try { validateBlueprint(p.draft); } catch { return null; }
  return clone({ origin: o, proposal: p });
}
function validateBlueprint(draft) {
  const instruction = value => typeof value === 'string' && !!value.trim() && new TextEncoder().encode(value).length <= 512;
  if (!record(draft) || Object.keys(draft).some(key => !['instruction', 'files', 'focusedTest', 'gitCommit', 'revisionOf'].includes(key))
    || !instruction(draft.instruction) || !Array.isArray(draft.files) || !draft.files.length || draft.files.length > 32) {
    throw new Error('Vyplňte zadání do 512 bajtů a jeden až 32 souborů.');
  }
  if (draft.revisionOf !== undefined && (!record(draft.revisionOf)
    || Object.keys(draft.revisionOf).sort().join(',') !== 'lifecycleId,planDigest'
    || typeof draft.revisionOf.lifecycleId !== 'string' || !draft.revisionOf.lifecycleId.trim()
    || draft.revisionOf.lifecycleId.length > 128 || !/^sha256:[0-9a-f]{64}$/.test(draft.revisionOf.planDigest))) {
    throw new Error('Neplatná vazba předchozího návrhu.');
  }
  const paths = draft.files.map(file => file?.path);
  if (new Set(paths).size !== paths.length) throw new Error('Každý soubor zadejte pouze jednou.');
  for (const file of draft.files) {
    if (!record(file) || Object.keys(file).some(key => !['path', 'instruction', 'dependsOn', 'contextFiles', 'reusePrevious'].includes(key))
      || !relative(file.path) || !instruction(file.instruction) || !Array.isArray(file.dependsOn)
      || new Set(file.dependsOn).size !== file.dependsOn.length || file.dependsOn.some(path => !paths.includes(path))
      || (file.reusePrevious !== undefined && (typeof file.reusePrevious !== 'boolean' || !draft.revisionOf))
      || (file.contextFiles !== undefined && (!Array.isArray(file.contextFiles) || file.contextFiles.length > 8
        || new Set(file.contextFiles).size !== file.contextFiles.length || file.contextFiles.some(path => !relative(path) || paths.includes(path))))) {
      throw new Error('Zkontrolujte cesty, zadání a závislosti souborů.');
    }
  }
  const resolved = new Set();
  while (resolved.size < paths.length) {
    const next = draft.files.find(file => !resolved.has(file.path) && file.dependsOn.every(path => resolved.has(path)));
    if (!next) throw new Error('Závislosti souborů obsahují cyklus.');
    resolved.add(next.path);
  }
  const test = draft.focusedTest;
  if (!record(test) || typeof test.binary !== 'string' || !test.binary.startsWith('/') || test.binary.includes('\0')
    || !Array.isArray(test.argv) || test.argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))
    || !Number.isSafeInteger(test.timeoutMs) || test.timeoutMs < 1 || test.timeoutMs > 3600000) {
    throw new Error('Test potřebuje úplnou cestu programu, pole doslovných argumentů a limit 1–3600000 ms.');
  }
  return draft;
}
function normalizeForm(value) {
  if (!record(value) || !record(value.origin) || value.origin.surface !== 'studio'
    || typeof value.origin.conversationId !== 'string' || !value.origin.conversationId
    || value.origin.sessionId !== value.origin.conversationId || !Number.isSafeInteger(value.origin.projectId)
    || value.origin.projectId < 1 || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 32
    || !['instruction', 'binary', 'argv', 'timeoutMs'].every(key => typeof value[key] === 'string' && value[key].length <= 65536)
    || value.files.some(file => !record(file) || !['path', 'instruction', 'dependencies', 'contextFiles'].every(key => file[key] == null || typeof file[key] === 'string' && file[key].length <= 65536))) return null;
  return clone(value);
}
function createForm(origin, draft = null, text = '') {
  return { origin: clone(origin), instruction: draft?.instruction || text,
    files: draft ? draft.files.map(file => ({ path: file.path, instruction: file.instruction,
      dependencies: file.dependsOn.join('\n'), contextFiles: (file.contextFiles || []).join('\n'), reusePrevious: !!file.reusePrevious }))
      : [{ path: '', instruction: '', dependencies: '', contextFiles: '', reusePrevious: false }],
    binary: draft?.focusedTest.binary || '', argv: JSON.stringify(draft?.focusedTest.argv || []),
    timeoutMs: String(draft?.focusedTest.timeoutMs || 30000), gitCommit: draft?.gitCommit || null,
    revisionOf: draft?.revisionOf || null, open: true, error: null };
}
function composerDraft(form) {
  let argv;
  try { argv = JSON.parse(form.argv); } catch { throw new Error('Argumenty testu musí být JSON pole řetězců.'); }
  const lines = value => String(value || '').split('\n').map(part => part.trim()).filter(Boolean);
  return validateBlueprint({ instruction: form.instruction, files: form.files.map(file => ({ path: file.path,
    instruction: file.instruction, dependsOn: lines(file.dependencies), contextFiles: lines(file.contextFiles),
    ...(form.revisionOf ? { reusePrevious: !!file.reusePrevious } : {}) })),
    focusedTest: { binary: form.binary, argv, timeoutMs: Number(form.timeoutMs),
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' } },
    ...(form.gitCommit ? { gitCommit: form.gitCommit } : {}), ...(form.revisionOf ? { revisionOf: form.revisionOf } : {}) });
}
module.exports = { normalizeForm, normalizeProposal, validateBlueprint, createForm, composerDraft };
