// tests/execution-graph.test.js — Execution Graph unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { ExecutionGraph } from '../src/code-intel/execution-graph.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'exec-graph-'));
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

// ─── Route Detection ────────────────────────────────────────────────────────

suite('ExecutionGraph — Route Detection');

await testAsync('detects Express routes', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/routes.js', `
const express = require('express');
const router = express.Router();

router.get('/api/users', getUsers);
router.post('/api/users', createUser);
router.put('/api/users/:id', updateUser);
router.delete('/api/users/:id', deleteUser);

module.exports = router;
`);

    const eg = new ExecutionGraph();
    const result = await eg.buildFromProject(dir);

    assert(result.routeCount >= 4, `should find ≥4 routes, got ${result.routeCount}`);
    const routes = eg.getRoutes();
    assert(routes.some(r => r.path === '/api/users' && r.method === 'get'), 'should find GET /api/users');
    assert(routes.some(r => r.path === '/api/users/:id' && r.method === 'delete'), 'should find DELETE /api/users/:id');
  } finally { cleanup(dir); }
});

await testAsync('detects Flask routes', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'app.py', `
from flask import Flask
app = Flask(__name__)

@app.route('/users', methods=['GET'])
def get_users():
    return jsonify(users)

@app.route('/users', methods=['POST'])
def create_user():
    return jsonify(user)
`);

    const eg = new ExecutionGraph();
    const result = await eg.buildFromProject(dir);

    assert(result.routeCount >= 2, `should find ≥2 routes, got ${result.routeCount}`);
  } finally { cleanup(dir); }
});

await testAsync('detects middleware', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', `
const express = require('express');
const app = express();

app.use(cors);
app.use(helmet);
app.use('/api', authMiddleware);
app.get('/health', healthCheck);
`);

    const eg = new ExecutionGraph();
    await eg.buildFromProject(dir);

    const mw = eg.getMiddleware();
    assert(mw.length >= 3, `should find ≥3 middleware, got ${mw.length}`);
    assert(mw.some(m => m.name === 'cors'), 'should find cors middleware');
    assert(mw.some(m => m.name === 'helmet'), 'should find helmet middleware');
  } finally { cleanup(dir); }
});

// ─── Request Tracing ────────────────────────────────────────────────────────

suite('ExecutionGraph — Request Tracing');

test('traceRequest finds matching route', () => {
  const eg = new ExecutionGraph();
  eg._routes = [
    { method: 'get', path: '/api/users', handler: 'getUsers', file: 'routes.js', line: 5, framework: 'Express' },
    { method: 'post', path: '/api/users', handler: 'createUser', file: 'routes.js', line: 6, framework: 'Express' },
  ];
  eg._middleware = [
    { name: 'authMiddleware', file: 'app.js', line: 3 },
  ];

  const trace = eg.traceRequest('GET', '/api/users');
  assert(trace.route !== null, 'should find route');
  assertEqual(trace.route.handler, 'getUsers');
  assert(trace.chain.length > 0, 'should have chain');
});

test('traceRequest returns null for unmatched route', () => {
  const eg = new ExecutionGraph();
  eg._routes = [
    { method: 'get', path: '/api/users', handler: 'getUsers', file: 'routes.js', line: 5, framework: 'Express' },
  ];

  const trace = eg.traceRequest('GET', '/api/products');
  assertEqual(trace.route, null);
});

test('traceRequest matches parameterized routes', () => {
  const eg = new ExecutionGraph();
  eg._routes = [
    { method: 'get', path: '/api/users/:id', handler: 'getUser', file: 'routes.js', line: 5, framework: 'Express' },
  ];

  const trace = eg.traceRequest('GET', '/api/users/123');
  assert(trace.route !== null, 'should match parameterized route');
  assertEqual(trace.route.handler, 'getUser');
});

// ─── Stack Trace Parsing ────────────────────────────────────────────────────

suite('ExecutionGraph — Stack Trace Parsing');

test('parses Node.js stack trace', () => {
  const eg = new ExecutionGraph();
  const frames = eg.parseStackTrace(`
Error: Connection refused
    at Database.query (/app/src/db.js:42:12)
    at UserService.findAll (/app/src/services/user.js:18:5)
    at getUsers (/app/src/routes.js:12:20)
`);

  assert(frames.length >= 3, `should find ≥3 frames, got ${frames.length}`);
  assertEqual(frames[0].function, 'Database.query');
  assertEqual(frames[0].line, 42);
});

test('parses Python stack trace', () => {
  const eg = new ExecutionGraph();
  const frames = eg.parseStackTrace(`
Traceback (most recent call last):
  File "app.py", line 42, in get_users
  File "db.py", line 18, in query
`);

  assert(frames.length >= 2, `should find ≥2 frames, got ${frames.length}`);
  assertEqual(frames[0].function, 'get_users');
  assertEqual(frames[0].line, 42);
});

test('parses Java stack trace', () => {
  const eg = new ExecutionGraph();
  const frames = eg.parseStackTrace(`
java.lang.NullPointerException
    at com.example.UserService.findAll(UserService.java:42)
    at com.example.UserController.getUsers(UserController.java:18)
`);

  assert(frames.length >= 2, `should find ≥2 frames, got ${frames.length}`);
  assert(frames[0].function.includes('UserService'), 'should include class name');
  assertEqual(frames[0].line, 42);
});

// ─── Stats & Clear ──────────────────────────────────────────────────────────

suite('ExecutionGraph — Stats & Clear');

await testAsync('getStats reports framework counts', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/routes.js', `
const router = require('express').Router();
router.get('/api/test', handler);
router.post('/api/test', handler);
`);

    const eg = new ExecutionGraph();
    await eg.buildFromProject(dir);

    const stats = eg.getStats();
    assert(stats.routeCount >= 2, `should have routes, got ${stats.routeCount}`);
    assert(stats.buildTime >= 0, 'should report build time');
  } finally { cleanup(dir); }
});

test('clear resets execution graph', () => {
  const eg = new ExecutionGraph();
  eg._routes = [{ method: 'get', path: '/test' }];
  eg._middleware = [{ name: 'test' }];

  eg.clear();
  assertEqual(eg._routes.length, 0);
  assertEqual(eg._middleware.length, 0);
});

await testAsync('empty project builds empty graph', async () => {
  const dir = tmpDir();
  try {
    const eg = new ExecutionGraph();
    const result = await eg.buildFromProject(dir);
    assertEqual(result.routeCount, 0);
    assertEqual(result.middlewareCount, 0);
  } finally { cleanup(dir); }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
