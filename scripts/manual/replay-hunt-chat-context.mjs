// Replay captured CHAT dialogue and system prompts through the current context
// builder. This makes no model calls and does not modify the source attempts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const attemptDir = process.argv[2];
if (!attemptDir) throw new Error('Usage: node replay-hunt-chat-context.mjs ATTEMPT_DIR');
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-context-replay-'));
process.env.INTENTSMITH_DB_PATH = path.join(isolatedRoot, 'read-only-replay.sqlite');
const { buildAnswerContext } = await import('../../src/chat/handlers/decisions.js');
const summary = { attempts: 0, turns: {}, underOriginalOutputLimit: 0, failed: [] };
for (const name of fs.readdirSync(attemptDir).filter(file => /^attempt-.*\.json$/.test(file))) {
  const attempt = JSON.parse(fs.readFileSync(path.join(attemptDir, name), 'utf8'));
  summary.attempts++;
  for (let index = 0; index < attempt.dialogue.length; index++) {
    const receipt = attempt.receipts[index];
    const history = attempt.dialogue.slice(0, index).map(turn => ({
      userInput: turn.input, response: turn.result,
    }));
    const originalOptions = receipt.body.options;
    const context = buildAnswerContext(attempt.dialogue[index].input, history,
      receipt.body.messages[0].content, originalOptions.num_predict, originalOptions.num_ctx);
    const actualUsers = context.prompt.split('\n').filter(line => line.startsWith('{"role":"user",'))
      .map(line => JSON.parse(line).content);
    const missing = history.filter(turn => !actualUsers.includes(turn.userInput));
    const turn = summary.turns[index + 1] ||= {
      attempts: 0, missingAnyPriorUser: 0, missingAllPriorUsers: 0,
      noPriorAssistant: 0, minimumOutputTokens: Infinity, maximumOutputTokens: 0,
    };
    turn.attempts++;
    if (missing.length) turn.missingAnyPriorUser++;
    if (index > 0 && missing.length === index) turn.missingAllPriorUsers++;
    if (index > 0 && !context.prompt.includes('{"role":"assistant",')) turn.noPriorAssistant++;
    turn.minimumOutputTokens = Math.min(turn.minimumOutputTokens, context.maxTokens);
    turn.maximumOutputTokens = Math.max(turn.maximumOutputTokens, context.maxTokens);
    if (context.maxTokens < originalOptions.num_predict) summary.underOriginalOutputLimit++;
    if (Buffer.byteLength(context.prompt + receipt.body.messages[0].content) / 2
        + context.maxTokens + 384 > originalOptions.num_ctx) {
      summary.failed.push({ task: attempt.task, turn: index + 1, reason: 'context_budget' });
    }
  }
}
console.log(JSON.stringify(summary, null, 2));
fs.rmSync(isolatedRoot, { recursive: true, force: true });
if (summary.failed.length) process.exitCode = 1;
