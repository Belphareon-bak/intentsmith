// Shared oracle for the deterministic and opt-in physical translator journeys.
// This checks one selected specialist, one translation, and an unchanged owned
// project. It does not claim coverage of other specialist packages.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expectJson } from './chat-project-expertise-model-journey.js';

export const TRANSLATOR_CASE = Object.freeze({
  source: 'Nora Vela neposlala zásilku do archivu RIGEL_731.',
  input: 'Přelož do angličtiny pouze tuto větu, bez komentáře: „Nora Vela neposlala zásilku do archivu RIGEL_731.“',
  name: 'Nora Vela',
  canary: 'RIGEL_731',
  projectMarker: 'PROJECT_ONLY_842',
  fixtureTranslation: 'Nora Vela did not send the shipment to the RIGEL_731 archive.',
});

const SHA256 = value => createHash('sha256').update(value).digest('hex');

export function snapshotProject(folder) {
  const rows = [];
  const walk = (directory, relative = '') => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const item = path.posix.join(relative, name);
      const stat = lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `unexpected project symlink: ${item}`);
      if (stat.isDirectory()) {
        rows.push({ path: item, type: 'directory', mode: stat.mode & 0o777 });
        walk(absolute, item);
      } else {
        assert(stat.isFile(), `unexpected project entry: ${item}`);
        rows.push({ path: item, type: 'file', mode: stat.mode & 0o777,
          bytes: stat.size, sha256: SHA256(readFileSync(absolute)) });
      }
    }
  };
  walk(folder);
  return rows;
}

export async function createTranslatorJourney(server, runtime) {
  const projectName = `translator-journey-${randomBytes(5).toString('hex')}`;
  const folder = path.join(runtime.projects, projectName);
  mkdirSync(folder, { mode: 0o700 });
  writeFileSync(path.join(folder, 'README.md'),
    `# ${projectName}\n\nSoukromý projektový marker: ${TRANSLATOR_CASE.projectMarker}.\n`,
    { mode: 0o600 });
  const imported = await expectJson(server, 'POST', '/api/projects/open-folder',
    { folderPath: folder, name: projectName }, 201);
  assert.equal(imported.project.path, folder);
  const projectId = imported.project.id;
  assert(Number.isSafeInteger(projectId) && projectId > 0);
  const conversation = await expectJson(server, 'POST', '/api/conversations',
    { title: `${projectName}-chat`, project_id: projectId, mode: 'chat' }, 201);
  const conversationId = conversation.conversation?.id;
  assert.equal(typeof conversationId, 'string');
  const project = (await expectJson(server, 'GET', `/api/projects/${projectId}`, null, 200)).project;
  return { folder, projectId, conversationId, project,
    filesBefore: snapshotProject(folder) };
}

export async function selectTranslator(server, conversationId) {
  const list = await expectJson(server, 'GET', '/api/specialists', null, 200);
  assert(list.specialists?.some(item => item.id === 'translator'),
    'the installed translator specialist must be discoverable');
  const selected = await expectJson(server, 'POST', '/api/chat/specialist',
    { specialistId: 'translator', sessionId: conversationId }, 200);
  assert.equal(selected.ok, true);
  assert.equal(selected.specialistId, 'translator');
  // POST creates state before the first M1 turn creates a ChatController
  // instance, so the session-info route may still return 404 at this point.
}

export async function assertTranslatorSelectedSession(server, conversationId) {
  const session = await expectJson(server, 'GET',
    `/api/chat/sessions/${conversationId}`, null, 200);
  assert.equal(session.state?.specialist?.id, 'translator');
}

export async function clearTranslator(server, conversationId, projectId) {
  const cleared = await expectJson(server, 'DELETE', '/api/chat/specialist',
    { sessionId: conversationId }, 200);
  assert.equal(cleared.ok, true);
  const session = await expectJson(server, 'GET',
    `/api/chat/sessions/${conversationId}`, null, 200);
  assert.equal(session.state?.specialist, null);
  assert.equal(session.state?.project?.id, projectId,
    'clearing the specialist must not clear the selected project');
}

export function makeTranslatorCommand(conversationId) {
  return { contract: 'ConversationCommand', version: 1,
    requestId: `translator-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `translator-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: TRANSLATOR_CASE.input };
}

export function assertTranslatorProviderRequest(body, model) {
  assert.equal(body.model, model);
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert(Number.isSafeInteger(body.options?.num_ctx)
    && body.options.num_ctx >= 512 && body.options.num_ctx <= 4096);
  assert(Number.isSafeInteger(body.options?.num_predict) && body.options.num_predict > 0);
  assert(Array.isArray(body.messages) && body.messages.length >= 2);
  const system = body.messages.filter(message => message.role === 'system')
    .map(message => message.content).join('\n');
  const user = body.messages.at(-1);
  assert.equal(user.role, 'user');
  assert.match(system, /Překladatel/u, 'translator persona must reach provider');
  assert(user.content.includes(TRANSLATOR_CASE.input), 'current request absent from provider body');
  assert(user.content.includes(TRANSLATOR_CASE.source), 'exact source sentence absent from provider body');
  assert.match(user.content, /Tool execution results:/u,
    'generative tool-result wrapper was bypassed');
  assert.match(user.content, /"targetLanguage": "en"/u,
    'translator tool did not select English');
  const wire = JSON.stringify(body.messages);
  assert(!wire.includes(TRANSLATOR_CASE.projectMarker),
    'unrelated project file leaked into translation provider prompt');
  return { system, user: user.content };
}

export function assertTranslationMeaning(text) {
  assert.equal(typeof text, 'string');
  const translation = text.trim().replace(/^[„“"]|[„“"]$/gu, '');
  assert(translation.length > 25 && translation.length < 220,
    'translation is empty or contains unrequested explanation');
  assert(!/\n|```/u.test(translation), 'short translation contains extra structure');
  assert(translation.includes(TRANSLATOR_CASE.name), 'proper name changed or missing');
  assert(translation.includes(TRANSLATOR_CASE.canary), 'canary changed or missing');
  assert(!translation.includes(TRANSLATOR_CASE.projectMarker),
    'unrelated project marker appeared in translation');
  assert(!/neposlala|zásilku|archivu/iu.test(translation), 'source sentence was echoed');
  assert(/\b(?:shipment|package|parcel|consignment)\b/iu.test(translation),
    'shipment meaning missing');
  assert(/\barchive\b/iu.test(translation), 'archive destination missing');
  assert(/\b(?:not|never|failed to)\b|n't\b/iu.test(translation),
    'source negation was lost');
  // This one-sentence fixture has a bounded semantic shape. Anchoring the
  // whole answer rejects extra instructions or commentary even when the
  // source meaning and identifiers are also present. Accept common active
  // and passive English variants rather than one fixture string.
  const destination = '(?:(?:the\\s+)?RIGEL_731\\s+archive|(?:the\\s+)?archive\\s+RIGEL_731)';
  const active = new RegExp(`^Nora Vela\\s+(?:(?:did not|didn't)\\s+(?:send|ship|deliver|dispatch)|(?:has not|hasn't|had not|hadn't)\\s+(?:sent|shipped|delivered|dispatched)|never\\s+(?:sent|shipped|delivered|dispatched)|failed to\\s+(?:send|ship|deliver|dispatch))\\s+(?:the|a)\\s+(?:shipment|package|parcel|consignment)\\s+(?:to|into)\\s+${destination}[.!]?$`, 'iu');
  const passive = new RegExp(`^(?:The|A)\\s+(?:shipment|package|parcel|consignment)\\s+(?:was not|wasn't|has not been|hasn't been|had not been|hadn't been|was never)\\s+(?:sent|shipped|delivered|dispatched)\\s+(?:(?:to|into)\\s+${destination}\\s+by Nora Vela|by Nora Vela\\s+(?:to|into)\\s+${destination})[.!]?$`, 'iu');
  assert(active.test(translation) || passive.test(translation),
    'translation contains added content or changes the one-sentence meaning');
  return translation;
}

export function assertTranslatorM1Result(result) {
  assert.equal(result.status, 'ok');
  assert.equal(result.response?.metadata?.expertise?.id, 'translator',
    'reply must come through translator expertise');
  assert.equal(result.response.metadata.toolResults?.[0]?.type, 'translator.translate',
    'translator tool result must reach generative wrapper');
  assert.equal(result.response.metadata.finishReason, 'stop');
  assertTranslationMeaning(result.response.content);
}

export async function assertTranslatorDurabilityAndProject(server, journey, answer) {
  const messages = await expectJson(server, 'GET',
    `/api/conversations/${journey.conversationId}/messages`, null, 200);
  assert.equal(messages.messages?.length, 2);
  assert.equal(messages.messages[0].role, 'user');
  assert.equal(messages.messages[0].content, TRANSLATOR_CASE.input);
  assert.equal(messages.messages[1].role, 'assistant');
  assert.equal(messages.messages[1].content, answer);
  assert.deepEqual(snapshotProject(journey.folder), journey.filesBefore,
    'translation modified the owned project files');
  const after = (await expectJson(server, 'GET',
    `/api/projects/${journey.projectId}`, null, 200)).project;
  for (const key of ['id', 'name', 'path', 'description', 'is_external']) {
    assert.deepEqual(after[key], journey.project[key], `project ${key} changed`);
  }
  return { messages: messages.messages.length, files: journey.filesBefore.length,
    projectId: journey.projectId };
}
