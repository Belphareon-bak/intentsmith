import { db } from '../db/database.js';
import { M2ToolAuthorityRepository } from './m2-tool-authority-repository.js';
import { createM2ToolBroker } from './m2-tool-broker.js';
import { createM2ToolEffectAdapter } from './m2-tool-effect-adapter.js';

export function createM2ToolRuntime({
  database = db,
  clock = Date.now,
  scheduleTimeout,
  effectAdapter = createM2ToolEffectAdapter(),
} = {}) {
  const repository = new M2ToolAuthorityRepository(database);
  return createM2ToolBroker({
    repository,
    clock,
    ...(scheduleTimeout ? { scheduleTimeout } : {}),
    effectAdapter,
  });
}

export const m2ToolRuntime = createM2ToolRuntime();

export default m2ToolRuntime;
