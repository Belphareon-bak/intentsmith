import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const revision = 'a3a00baae2dffa6204afa327b97f102ee36c8c09';
const path = 'src/db/migrations/2026_03_08_030_v103_model_overrides.js';
const fixture = JSON.parse(readFileSync(new URL('../src/eval/fixtures/role-semantic-tasks.json', import.meta.url)));
const ddl = execFileSync('git', ['show', `${revision}:${path}`],
  { cwd: fileURLToPath(new URL('../', import.meta.url)) });
const digest = createHash('sha256').update(ddl).digest('hex');

test('all model-cleanup roles use the historical row constraints in prompt and grading', () => {
  assert.match(ddl.toString(), /role TEXT PRIMARY KEY/);
  assert.match(ddl.toString(), /previous_model TEXT NOT NULL/);
  for (const role of ['D1', 'D2', 'R1', 'R2']) {
    const task = fixture.tasks.find(item => item.name === `${role.toLowerCase()}_model_cleanup`);
    assert.ok(task, role);
    assert.match(task.prompt, /previous_model TEXT NOT NULL/);
    assert.match(task.prompt, /role TEXT PRIMARY KEY/);
    const source = task.provenance.additionalContext.find(item => item.path === path);
    assert.equal(source?.revision, revision);
    assert.equal(source?.fileSha256, digest);
    assert.ok(task.reference.criteria.every(row => !/\bnull\b/i.test(row)), `${role}: impossible NULL test in rubric`);
    assert.doesNotMatch(task.reference.gold, /null\/empty|null or repeated/i);
    assert.match(task.reference.gold, /\/api\/delete/);
  }
});
