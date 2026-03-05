// tests/debug-agent.test.js — Autonomous Debug Agent unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { debugIssue } from '../src/code-intel/debug-agent.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'debug-test-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return name;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Basic Debug Tests ───────────────────────────────────────────────────────

suite('Debug Agent — Basic');

await testAsync('debugs timeout issue', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/server.js', `
const TIMEOUT = 5000;

function handleRequest(req, res) {
  setTimeout(() => {
    res.send("ok");
  }, TIMEOUT);
}

module.exports = { handleRequest };
`);
    writeFile(dir, 'src/config.js', `
const config = {
  timeout: 5000,
  retries: 3,
  port: 3000,
};

module.exports = config;
`);

    const result = await debugIssue(dir, 'The API requests are timing out after 5 seconds. Users report slow response.');

    assert(result, 'should return result');
    assert(result.hypothesis, 'should have a hypothesis');
    assert(result.hypothesis.description.length > 0, 'hypothesis should have description');
    assert(result.iterations > 0, 'should have at least 1 iteration');
    assert(result.summary.length > 0, 'should have summary');
    assert(result.evidence.length > 0, 'should have evidence');
  } finally { cleanup(dir); }
});

await testAsync('debugs null reference issue', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/handler.js', `
function processUser(user) {
  // TODO: add null check
  const name = user.profile.name;
  return name.toUpperCase();
}

function getUser(id) {
  return null; // user not found
}
`);

    const result = await debugIssue(dir, 'TypeError: Cannot read property "name" of null when processing user profile');

    assert(result, 'should return result');
    assert(result.hypothesis, 'should have hypothesis');
    assert(result.iterations >= 1, 'should iterate');
  } finally { cleanup(dir); }
});

await testAsync('debugs permission issue', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `
function checkPermission(user, resource) {
  if (!user.role) return false;
  return user.role === 'admin';
}

function authorize(req, res, next) {
  if (!checkPermission(req.user, req.path)) {
    return res.status(403).send('Forbidden');
  }
  next();
}
`);

    const result = await debugIssue(dir, 'Users are getting 403 Forbidden when accessing /api/dashboard even though they have permission');

    assert(result, 'should return result');
    assert(result.hypothesis, 'should have hypothesis');
    assert(result.hypothesis.category, 'should have category');
  } finally { cleanup(dir); }
});

suite('Debug Agent — Progress Callback');

await testAsync('calls onProgress during debug', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', `
function process(data) {
  if (!data) throw new Error("Missing data");
  return data.map(x => x * 2);
}
`);

    const steps = [];
    await debugIssue(dir, 'Error: Missing data thrown in process function', {
      onProgress: (step, detail) => {
        steps.push(step);
      },
    });

    assert(steps.includes('analyze'), 'should report analyze step');
    assert(steps.includes('hypothesize'), 'should report hypothesize step');
    assert(steps.includes('search'), 'should report search step');
    assert(steps.includes('done'), 'should report done step');
  } finally { cleanup(dir); }
});

suite('Debug Agent — Edge Cases');

await testAsync('handles empty project', async () => {
  const dir = tmpDir();
  try {
    const result = await debugIssue(dir, 'Application crashes on startup');

    assert(result, 'should return result');
    assert(result.summary.length > 0, 'should have summary even with no files');
  } finally { cleanup(dir); }
});

await testAsync('handles empty bug report', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', 'const x = 1;\n');

    const result = await debugIssue(dir, '');

    assert(result, 'should return result');
    // Empty report = no hypotheses possible
    assertEqual(result.iterations, 0);
  } finally { cleanup(dir); }
});

await testAsync('limits iterations', async () => {
  const dir = tmpDir();
  try {
    // Create many files to make search more complex
    for (let i = 0; i < 10; i++) {
      writeFile(dir, `src/module${i}.js`, `
function handler${i}(x) {
  const timeout = ${i * 1000};
  setTimeout(() => {
    console.error("timeout in module ${i}");
  }, timeout);
  return x;
}
`);
    }

    const result = await debugIssue(dir, 'Timeout errors in multiple modules');

    assert(result, 'should return result');
    assert(result.iterations <= 5, `should not exceed max iterations, got ${result.iterations}`);
  } finally { cleanup(dir); }
});

suite('Debug Agent — Stack Trace');

await testAsync('extracts functions from stack trace', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/service.js', `
function validateInput(data) {
  if (!data.name) throw new Error("Name required");
  return true;
}

function processRequest(req) {
  validateInput(req.body);
  return { status: "ok" };
}
`);

    const result = await debugIssue(dir, `Error: Name required
  at validateInput (src/service.js:3:30)
  at processRequest (src/service.js:8:3)
  at Object.<anonymous> (src/app.js:15:1)`);

    assert(result, 'should return result');
    assert(result.hypothesis, 'should have hypothesis');
    // Stack trace hypothesis should have highest confidence
    assert(result.hypothesis.confidence >= 0.5, 'stack trace hypothesis should have high confidence');
  } finally { cleanup(dir); }
});

suite('Debug Agent — Result Structure');

await testAsync('result has all required fields', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', `
const MAX_RETRIES = 3;

function fetchData(url) {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      return http.get(url);
    } catch (e) {
      retries++;
      // FIXME: should add backoff
    }
  }
  throw new Error("Max retries exceeded");
}
`);

    const result = await debugIssue(dir, 'Max retries exceeded error when calling external API');

    // Check structure
    assert('rootCause' in result, 'should have rootCause');
    assert('hypothesis' in result, 'should have hypothesis');
    assert('evidence' in result, 'should have evidence');
    assert('fixes' in result, 'should have fixes');
    assert('iterations' in result, 'should have iterations');
    assert('summary' in result, 'should have summary');

    // Check types
    assert(typeof result.rootCause === 'string', 'rootCause should be string');
    assert(Array.isArray(result.evidence), 'evidence should be array');
    assert(Array.isArray(result.fixes), 'fixes should be array');
    assert(typeof result.iterations === 'number', 'iterations should be number');
    assert(typeof result.summary === 'string', 'summary should be string');
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
