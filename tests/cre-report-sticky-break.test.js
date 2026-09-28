#!/usr/bin/env node
import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  CREDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/chat/cre-decision.js';

const cre = new CREDecisionEngine();
cre._llmClassifyIntent = async () => null;

assert.equal(cre.classifyIntent('chci najít auto'), IntentType.SEARCH);
assert.equal(cre.classifyIntent('chci najit auto'), IntentType.SEARCH);

const decision = await cre.decide('chci najít auto', { lastIntent: IntentType.REPORT });
assert.equal(decision.intent, IntentType.SEARCH);
assert.equal(decision.type, DecisionType.TOOL_CALL);
assert.equal(decision.metadata.classifiedBy, 'regex');
assert.equal(decision.metadata.diag.initialIntent, IntentType.SEARCH);
assert.equal(decision.metadata.diag.finalIntent, IntentType.SEARCH);
assert.equal(decision.metadata.diag.lastIntent, IntentType.REPORT);
assert.deepEqual(decision.metadata.diag.overrides, null);

const stopReport = await cre.decide('dost reportů', { lastIntent: IntentType.REPORT });
assert.notEqual(stopReport.intent, IntentType.REPORT);
assert.equal(stopReport.metadata.diag.isIntentBreak, true);

console.log('cre report sticky break regression: PASS');
