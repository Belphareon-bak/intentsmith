import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { assert, assertEqual, suite, summary, test, testAsync } from './harness.js';
import { db, projects } from '../src/db/database.js';
import { skillRegistry, validateGovernedSkillDefinition } from '../src/skills/registry.js';
import {
  cancel,
  confirmAndExecute,
  getStatus,
  prepare,
  resume,
  setSkillEffectAuthority,
} from '../src/skills/runner.js';
import { executeShell } from '../src/skills/steps/shell.js';
import { executeWrite } from '../src/skills/steps/write.js';
import { skillM2EffectAuthority } from '../src/skills/m2-effect-authority.js';
import { preHandle } from '../src/chat/handlers/pre-handler.js';

const ROOT = isolatedTestRuntime.projects;
const PROJECT_ROOT = path.join(ROOT, 'm3-skill-project');
mkdirSync(PROJECT_ROOT, { recursive: true });
const projectId = Number(projects.create.run('M3 Skill Project', PROJECT_ROOT, '').lastInsertRowid);
const caller = Object.freeze({
  authenticatedSubject: Object.freeze({ actorType: 'user', actorId: 'm3-skill-user' }),
});

skillRegistry.load(path.resolve('skills'), null);
setSkillEffectAuthority(skillM2EffectAuthority);
const skill = skillRegistry.get('m3-project-note');

function authorityContext(userMessageId, overrides = {}) {
  return {
    ...caller,
    project: { id: projectId, path: PROJECT_ROOT },
    userMessageId,
    ...overrides,
  };
}

function prepareExecution({ userMessageId, targetPath = 'PROJECT-NOTES.md' } = {}) {
  return prepare({
    skillId: skill.id,
    skillParams: {
      title: 'Databázová autorita',
      content: 'SQLite zůstává jediným trvalým zdrojem pravdy.',
      path: targetPath,
    },
    input: 'zapiš projektovou poznámku Databázová autorita: SQLite zůstává jediným trvalým zdrojem pravdy.',
    confidence: 1,
    sessionId: 'm3-skill-session',
    conversationId: 'm3-skill-conversation',
    authorityContext: authorityContext(userMessageId),
  });
}

suite('M3 governed skill contract and deterministic trigger');

test('ExtensionManifest skill pins typed inputs, fixed/variable steps, tool and output criteria', () => {
  assert(skill?.governed, 'governed skill must load');
  assertEqual(skill.extensionManifest.kind, 'skill');
  assertEqual(validateGovernedSkillDefinition(skill.extensionManifest.payload.definition).length, 0);
  assertEqual(skill.stepModel.fixed.length, 3);
  assertEqual(skill.stepModel.variable.length, 1);
  assertEqual(skill.toolSelection[0].toolId, 'file.write');
  assert(skill.qualityCriteria.length > 0);
  assert(skill.outputCriteria.length > 0);
});

test('committed trigger resolves exact typed parameters without a model call', () => {
  const resolved = skillRegistry.resolveDeterministic(
    'zapiš projektovou poznámku Databázová autorita: SQLite zůstává zdrojem pravdy.',
  );
  assertEqual(resolved.skillId, skill.id);
  assertEqual(resolved.params.title, 'Databázová autorita');
  assertEqual(resolved.params.path, 'PROJECT-NOTES.md');
  assertEqual(resolved.source, 'extension-trigger-v1');
});

test('effectful skill fails closed without trusted actor, message and project binding', () => {
  const missing = prepare({
    skillId: skill.id,
    skillParams: { title: 'X', content: 'Dostatečně dlouhý obsah poznámky.' },
    input: 'test', confidence: 1, sessionId: 's', conversationId: 'c',
  });
  assertEqual(missing, null);
});

await testAsync('chat pre-handler routes the committed trigger before model classification', async () => {
  const sessionState = {};
  const result = await preHandle(
    'zapiš projektovou poznámku Přímý trigger: Tento krok nevolá resolver model.',
    {
      sessionId: 'm3-trigger-session',
      conversationId: 'm3-trigger-conversation',
      userMessageId: 100,
      project: { id: projectId, path: PROJECT_ROOT },
      authenticatedSubject: caller.authenticatedSubject,
      sessionState,
    },
    'CONVERSATION',
  );
  assertEqual(result.handled, true);
  assertEqual(result.response.tag.metadata.skillId, 'm3-project-note');
  assertEqual(result.response.tag.metadata.confirming, true);
  assertEqual(await cancel(result.response.tag.metadata.skillExecution, caller), true);
});

suite('M3 skill -> M2 ToolRequest -> EffectRequest journey');

let executionId;
let effectId;

await testAsync('review checkpoint precedes exact effect checkpoint and generic approval cannot write', async () => {
  const prepared = prepareExecution({ userMessageId: 101 });
  assert(prepared, 'execution must prepare');
  executionId = prepared.executionId;
  assertEqual(Object.hasOwn(getStatus(executionId).params, '__m3AuthorityV1'), false);

  const review = await confirmAndExecute(executionId, caller);
  assertEqual(review.status, 'awaiting_input');
  assertEqual(review.stepType, 'review');
  assert(review.content.includes('Databázová autorita'));

  const effect = await resume(executionId, 'ano', caller);
  assertEqual(effect.status, 'awaiting_input');
  assertEqual(effect.stepType, 'write');
  effectId = effect.output.persist.effectId;
  assert(/^effect:[a-f0-9]{64}$/.test(effectId));
  assertEqual(existsSync(path.join(PROJECT_ROOT, 'PROJECT-NOTES.md')), false);

  const generic = await resume(executionId, 'ano', caller);
  assertEqual(generic.status, 'awaiting_input');
  assertEqual(generic.errorCode, 'M3_SKILL_EXACT_EFFECT_APPROVAL_REQUIRED');
  assertEqual(existsSync(path.join(PROJECT_ROOT, 'PROJECT-NOTES.md')), false);
});

await testAsync('exact approval settles both durable contracts and produces verified bytes', async () => {
  const completed = await resume(executionId, `schválit efekt ${effectId}`, caller);
  assertEqual(completed.status, 'success');
  const output = completed.output.persist;
  assertEqual(output.status, 'ok');
  assertEqual(output.effectId, effectId);
  assertEqual(output.terminalStatus, 'succeeded');
  const bytes = readFileSync(path.join(PROJECT_ROOT, 'PROJECT-NOTES.md'), 'utf8');
  assert(bytes.includes('# Projektová poznámka: Databázová autorita'));

  const tool = db.prepare(`
    SELECT request_json AS requestJson FROM tool_v1_requests WHERE request_id = ?
  `).get(output.requestId);
  const effect = db.prepare(`
    SELECT request_json AS requestJson FROM m2_effect_requests WHERE effect_id = ?
  `).get(effectId);
  assertEqual(JSON.parse(tool.requestJson).origin.surface, 'skill');
  assertEqual(JSON.parse(effect.requestJson).origin.surface, 'skill');
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM tool_v1_results WHERE request_id = ?').get(output.requestId).count, 1);
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM m2_effect_results WHERE effect_id = ?').get(effectId).count, 1);
  assertEqual(getStatus(executionId).state, 'DONE');
});

await testAsync('caller mismatch cannot consume a pending skill effect', async () => {
  const prepared = prepareExecution({ userMessageId: 102, targetPath: 'MISMATCH.md' });
  const review = await confirmAndExecute(prepared.executionId, caller);
  assertEqual(review.stepType, 'review');
  const pending = await resume(prepared.executionId, 'ano', caller);
  const mismatch = await resume(prepared.executionId, `schválit efekt ${pending.output.persist.effectId}`, {
    authenticatedSubject: { actorType: 'user', actorId: 'other-user' },
  });
  assertEqual(mismatch.status, 'error');
  assertEqual(getStatus(prepared.executionId).state, 'AWAITING_INPUT');
  assertEqual(existsSync(path.join(PROJECT_ROOT, 'MISMATCH.md')), false);
  assertEqual(await cancel(prepared.executionId, caller), true);
});

await testAsync('cancelling a skill durably revokes authority and removes pending effect bytes', async () => {
  const prepared = prepareExecution({ userMessageId: 103, targetPath: 'CANCELLED.md' });
  await confirmAndExecute(prepared.executionId, caller);
  const pending = await resume(prepared.executionId, 'ano', caller);
  const pendingEffectId = pending.output.persist.effectId;
  assertEqual(await cancel(prepared.executionId, caller), true);
  assertEqual(existsSync(path.join(PROJECT_ROOT, 'CANCELLED.md')), false);
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM m2_pending_effect_payloads WHERE effect_id = ?').get(pendingEffectId).count, 0);
  const effectResult = JSON.parse(db.prepare(`
    SELECT result_json AS resultJson FROM m2_effect_results WHERE effect_id = ?
  `).get(pendingEffectId).resultJson);
  assertEqual(effectResult.terminalStatus, 'cancelled');
  assertEqual(effectResult.errorCode, 'APPROVAL_GRANT_REVOKED');
  const toolResult = JSON.parse(db.prepare(`
    SELECT result_json AS resultJson FROM tool_v1_results
    WHERE effect_request_id = ?
  `).get(pendingEffectId).resultJson);
  assertEqual(toolResult.status, 'cancelled');
});

suite('Legacy effect bypass containment');

await testAsync('legacy write definitions map to file.write but still require M2 authority', async () => {
  let observed = null;
  const result = await executeWrite(
    { id: 'legacy-write', type: 'write', path: 'LEGACY.md', content: 'legacy bytes' },
    {
      params: {},
      stepsOutput: {},
      authorityBinding: { projectId },
      effectAuthority: {
        async prepareWrite(request) {
          observed = request;
          return { state: 'approval_required', effectId: `effect:${'a'.repeat(64)}` };
        },
      },
    },
  );
  assertEqual(result.status, 'awaiting_input');
  assertEqual(observed.path, 'LEGACY.md');
  assertEqual(observed.content, 'legacy bytes');
  assertEqual(existsSync(path.join(PROJECT_ROOT, 'LEGACY.md')), false);
});

await testAsync('shell steps retain parsing compatibility but never call execSync', async () => {
  const sentinel = path.join(PROJECT_ROOT, 'SHELL-BYPASS');
  const result = await executeShell(
    { id: 'legacy-shell', type: 'shell', command: `touch ${sentinel}` },
    { params: {}, stepsOutput: {} },
  );
  assertEqual(result.status, 'error');
  assertEqual(result.errorType, 'security');
  assertEqual(existsSync(sentinel), false);
});

summary();
