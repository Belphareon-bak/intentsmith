// Loaded only by the owned product child in the M3 crash journey. The hook
// stops that child immediately after SQLite commits a notification and before
// AgentRunner can persist the action state or a successful run terminal.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { AgentRepository } from '../../src/agents/repository.js';

if (process.env.NODE_ENV !== 'test' || !process.env.INTENTSMITH_TEST_ARTIFACT_DIR) {
  throw new Error('M3 crash preload requires an isolated test runtime');
}

const marker = path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
  'm3-notification-persisted.json');
const original = AgentRepository.prototype.createNotification;
AgentRepository.prototype.createNotification = function (...args) {
  const notificationId = original.apply(this, args);
  writeFileSync(marker, `${JSON.stringify({
    pid: process.pid,
    agentId: args[0],
    runId: Number(args[1]),
    notificationId: Number(notificationId),
  })}\n`, { flag: 'wx', mode: 0o600 });
  process.kill(process.pid, 'SIGSTOP');
  return notificationId;
};
