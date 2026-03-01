// tests/project-lifecycle-intercept.test.js — v88
// ══════════════════════════════════════════════════════════════════════════════
//
// Unit tests for v88 project workflow fixes:
//   1. ensureRoadmap() — scaffold ROADMAP.md
//   2. SessionState working memory DB persistence
//   3. project.js intercept wiring (structural checks)
//
// RUN: node tests/project-lifecycle-intercept.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Suite 1: ensureRoadmap ─────────────────────────────────────────────────

suite('ensureRoadmap — scaffold ROADMAP.md');

const { ensureRoadmap, ensureReadme } = await import('../src/chat/handlers/utils/readme-generator.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-test-roadmap-'));

test('ensureRoadmap creates ROADMAP.md in empty dir', () => {
  const dir = path.join(tmpDir, 'proj-new');
  fs.mkdirSync(dir, { recursive: true });

  const result = ensureRoadmap(dir, { name: 'TestProject', type: 'webapp' });
  assert(result.written, 'should have written');
  assert(fs.existsSync(result.path), 'file should exist');

  const content = fs.readFileSync(result.path, 'utf-8');
  assert(content.includes('ROADMAP'), 'should contain ROADMAP heading');
  assert(content.includes('TestProject'), 'should contain project name');
  assert(content.includes('Specifikace'), 'should contain phase table');
  assert(content.includes('Implementace'), 'should contain implementation phase');
});

test('ensureRoadmap does NOT overwrite existing ROADMAP.md', () => {
  const dir = path.join(tmpDir, 'proj-existing');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ROADMAP.md'), '# My custom roadmap\n');

  const result = ensureRoadmap(dir, { name: 'X' });
  assert(!result.written, 'should NOT have written');
  assertEqual(result.reason, 'roadmap_exists');

  const content = fs.readFileSync(path.join(dir, 'ROADMAP.md'), 'utf-8');
  assert(content.includes('My custom roadmap'), 'original content preserved');
});

test('ensureRoadmap rejects relative path', () => {
  const result = ensureRoadmap('relative/path', { name: 'X' });
  assert(!result.written, 'should not write');
  assertEqual(result.reason, 'invalid_path');
});

test('ensureRoadmap rejects null path', () => {
  const result = ensureRoadmap(null);
  assert(!result.written, 'should not write');
});

// ─── Suite 2: ensureReadme + ensureRoadmap together ─────────────────────────

suite('ensureReadme + ensureRoadmap — combined');

test('both create files for new project', () => {
  const dir = path.join(tmpDir, 'proj-both');
  fs.mkdirSync(dir, { recursive: true });

  const readmeResult = ensureReadme(dir, { name: 'CombinedTest' });
  const roadmapResult = ensureRoadmap(dir, { name: 'CombinedTest' });

  assert(readmeResult.written, 'README should be written');
  assert(roadmapResult.written, 'ROADMAP should be written');
  assert(fs.existsSync(path.join(dir, 'README.md')), 'README exists');
  assert(fs.existsSync(path.join(dir, 'ROADMAP.md')), 'ROADMAP exists');
});

// ─── Suite 3: SessionState working memory persistence ───────────────────────

suite('SessionState — working memory DB persistence');

const { SessionState } = await import('../src/chat/controller.js');

// Mock projectMemory DB
const mockDb = {
  _store: {},
  set: {
    run(projectId, key, value, category) {
      mockDb._store[`${projectId}:${key}`] = { value, category };
    }
  },
  delete: {
    run(projectId, key) {
      delete mockDb._store[`${projectId}:${key}`];
    }
  },
  listByCategory: {
    all(projectId, category) {
      const results = [];
      for (const [k, v] of Object.entries(mockDb._store)) {
        if (k.startsWith(`${projectId}:`) && v.category === category) {
          results.push({ key: k.split(':').slice(1).join(':'), value: v.value, category: v.category });
        }
      }
      return results;
    }
  }
};

test('initProjectMemoryDb sets static reference', () => {
  SessionState.initProjectMemoryDb(mockDb);
  assertEqual(SessionState._projectMemoryDb, mockDb);
});

test('setProjectGoal persists to DB', () => {
  mockDb._store = {};
  const state = new SessionState('test-session');
  state.setProject({ id: 42, name: 'Test', path: '/tmp/test' });
  state.setProjectGoal('implement login');

  assertEqual(state.projectGoal, 'implement login');
  const stored = mockDb._store['42:wm:goal'];
  assert(stored, 'should be persisted');
  assertEqual(stored.value, 'implement login');
  assertEqual(stored.category, 'working_memory');
});

test('setActiveFile persists to DB', () => {
  mockDb._store = {};
  const state = new SessionState('test-session-2');
  state.setProject({ id: 43, name: 'Test2', path: '/tmp/test2' });
  state.setActiveFile('src/Login.tsx');

  assertEqual(state.activeFile, 'src/Login.tsx');
  const stored = mockDb._store['43:wm:activeFile'];
  assert(stored, 'should be persisted');
  assertEqual(stored.value, 'src/Login.tsx');
});

test('setLastArtifact persists to DB', () => {
  mockDb._store = {};
  const state = new SessionState('test-session-3');
  state.setProject({ id: 44, name: 'Test3', path: '/tmp/test3' });
  state.setLastArtifact('artifact-123');

  assertEqual(state.lastArtifactId, 'artifact-123');
  const stored = mockDb._store['44:wm:lastArtifactId'];
  assert(stored, 'should be persisted');
  assertEqual(stored.value, 'artifact-123');
});

test('setProjectGoal(null) deletes from DB', () => {
  mockDb._store = {};
  const state = new SessionState('test-session-4');
  state.setProject({ id: 45, name: 'Test4', path: '/tmp/test4' });
  state.setProjectGoal('something');
  assert(mockDb._store['45:wm:goal'], 'should exist');

  state.setProjectGoal(null);
  assertEqual(state.projectGoal, null);
  assert(!mockDb._store['45:wm:goal'], 'should be deleted');
});

test('persistence without DB reference is silent (no crash)', () => {
  const origDb = SessionState._projectMemoryDb;
  SessionState._projectMemoryDb = null;

  const state = new SessionState('test-session-5');
  state.setProject({ id: 99, name: 'NoDB', path: '/tmp/nodb' });
  state.setProjectGoal('should not crash');
  assertEqual(state.projectGoal, 'should not crash');

  SessionState._projectMemoryDb = origDb;
});

test('persistence without project is silent', () => {
  const state = new SessionState('test-session-6');
  // No project set
  state.setProjectGoal('no project');
  assertEqual(state.projectGoal, 'no project');
  // Should not crash and not persist
});

// ─── Suite 4: project.js structural checks ─────────────────────────────────

suite('project.js — structural checks');

await testAsync('project handler exports projectHandler function', async () => {
  const mod = await import('../src/chat/handlers/project.js');
  assert(typeof mod.projectHandler === 'function',
    'should export projectHandler function');
});

// ─── Suite 5: Archive/Delete name collision fix ────────────────────────────

suite('projects DB — archive/delete name collision (v88.1)');

const { projects: projRepo } = await import('../src/db/database.js');

// Helper: clean up test projects
function cleanupTestProject(name) {
  try {
    const p = projRepo.findByName.get(name);
    if (p) projRepo.delete.run(p.id);
  } catch { /* ok */ }
}

const testPath1 = '/tmp/c3-test-collision-' + Date.now() + '/proj1';
const testPath2 = '/tmp/c3-test-collision-' + Date.now() + '/proj2';
const testName = 'CollisionTest-' + Date.now();

test('archive adds suffix to name', () => {
  // Create project
  const proj = projRepo.getOrCreate(testName, testPath1, 'test');
  assert(proj.id, 'should create project');

  // Archive it
  projRepo.archive.run(proj.id);
  const archived = projRepo.findById.get(proj.id);
  assert(archived.status === 'archived', 'should be archived');
  assert(archived.name.includes('[archived-'), `name should have suffix, got: ${archived.name}`);
  assert(archived.name.startsWith(testName), 'should start with original name');
});

test('new project with same name succeeds after archive', () => {
  // The original is archived with suffix, so the name is free
  const proj2 = projRepo.getOrCreate(testName, testPath2, 'test2');
  assert(proj2.id, 'should create project');
  assert(!proj2._nameConflict, 'should NOT have name conflict');
  assertEqual(proj2.name, testName);

  // Cleanup
  projRepo.delete.run(proj2.id);
});

test('restore strips suffix when no collision', () => {
  // The archived project still exists from first test
  const archived = projRepo.findByPath.get(testPath1);
  assert(archived, 'archived project should exist');

  const result = projRepo.restore.run(archived.id);
  assert(!result.conflict, 'should not have conflict');

  const restored = projRepo.findById.get(archived.id);
  assertEqual(restored.name, testName);
  assertEqual(restored.status, 'active');
});

test('softDelete adds suffix to name', () => {
  const proj = projRepo.findByPath.get(testPath1);
  assert(proj, 'project should exist');

  projRepo.softDelete.run(proj.id);
  const deleted = projRepo.findById.get(proj.id);
  assert(deleted.status === 'deleted', 'should be deleted');
  assert(deleted.name.includes('[deleted-'), `name should have suffix, got: ${deleted.name}`);
});

test('restore with name collision keeps suffixed name', () => {
  // Create a new project with the same name
  const proj2 = projRepo.getOrCreate(testName, testPath2, 'new one');
  assert(proj2.id, 'new project created');

  // Try to restore the deleted one — name is now taken
  const deleted = projRepo.findByPath.get(testPath1);
  const result = projRepo.restore.run(deleted.id);
  assert(result.conflict, 'should have conflict');

  const restored = projRepo.findById.get(deleted.id);
  // Should still have the suffixed name since original is taken
  assert(restored.name.includes('[deleted-'), `should keep suffix on conflict, got: ${restored.name}`);

  // Cleanup
  projRepo.delete.run(proj2.id);
  projRepo.delete.run(deleted.id);
});

test('getOrCreate returns conflict flag for duplicate active name', () => {
  const testPath3 = '/tmp/c3-test-collision-' + Date.now() + '/proj3';
  const testPath4 = '/tmp/c3-test-collision-' + Date.now() + '/proj4';
  const name3 = 'UniqueTest-' + Date.now();

  const proj = projRepo.getOrCreate(name3, testPath3, 'first');
  assert(proj.id, 'should create first project');

  const dup = projRepo.getOrCreate(name3, testPath4, 'second');
  assert(dup._nameConflict, 'should flag name conflict');
  assertEqual(dup._requestedName, name3);

  // Cleanup
  projRepo.delete.run(proj.id);
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }

summary();
