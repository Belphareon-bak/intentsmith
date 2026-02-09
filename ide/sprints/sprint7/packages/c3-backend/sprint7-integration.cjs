/**
 * C3 Backend — Sprint 7 Integration (Security & Trust)
 * All in plain Node.js (no dependencies).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Shell Security: Layer 1 — Command Whitelist ─────────

const ALLOWED_COMMANDS = new Set([
  'flutter', 'dart', 'npm', 'npx', 'yarn', 'pnpm',
  'node', 'python', 'python3', 'pip', 'pip3',
  'cargo', 'rustc', 'go', 'make', 'cmake', 'gradle', 'mvn',
  'git',
  'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep',
  'diff', 'file', 'stat', 'tree', 'du',
  'echo', 'printf', 'test', 'true', 'false',
  'mkdir', 'cp', 'mv', 'touch', 'chmod',
  'curl', 'wget',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'docker', 'docker-compose',
]);

// ─── Shell Security: Layer 2 — Arg Blacklist ─────────────

const BLOCKED_ARGS = new Set([
  '-e', '--eval', '-p', '--print', '--input-type',
  '-c', '--command',
  '--upload-pack', '--receive-pack', '--exec', '--exec-path',
  '--output', '-o',
  '--shell', '--login',
]);

const COMMAND_BLOCKED_ARGS = {
  node: new Set(['-e', '--eval', '-p', '--print', '--input-type', '-r', '--require']),
  python: new Set(['-c', '--command', '-m']),
  python3: new Set(['-c', '--command', '-m']),
  git: new Set(['--upload-pack', '--receive-pack', '--exec']),
  curl: new Set(['--output', '-o', '-O', '--remote-name']),
  wget: new Set(['-O', '--output-document']),
};

const NPM_SAFE_SUBCOMMANDS = new Set([
  'install', 'ci', 'test', 'run', 'build',
  'list', 'ls', 'outdated', 'audit', 'info',
  'init', 'version', 'pack', 'dedupe', 'run-script', 'start',
]);

const NPM_FORCE_IGNORE_SCRIPTS = new Set(['install', 'ci']);

// ─── Shell Security: Layer 5 — Env Sanitization ─────────

const STRIPPED_ENV_VARS = new Set([
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'GITHUB_TOKEN', 'GITLAB_TOKEN',
  'DATABASE_URL', 'DB_PASSWORD', 'REDIS_URL', 'MONGO_URI',
  'SSH_AUTH_SOCK', 'GPG_AGENT_INFO',
  'SESSION_SECRET', 'JWT_SECRET', 'COOKIE_SECRET',
  'DOCKER_HOST', 'DOCKER_TLS_VERIFY',
]);
const STRIPPED_PREFIXES = ['SECRET_', 'TOKEN_', 'KEY_', 'PASSWORD_'];
const STRIPPED_SUFFIXES = ['_SECRET', '_TOKEN', '_KEY', '_PASSWORD', '_CREDENTIALS', '_API_KEY', '_AUTH', '_PRIVATE'];

function isEnvSensitive(key) {
  const u = key.toUpperCase();
  if (STRIPPED_ENV_VARS.has(u)) return true;
  for (const p of STRIPPED_PREFIXES) { if (u.startsWith(p)) return true; }
  for (const s of STRIPPED_SUFFIXES) { if (u.endsWith(s)) return true; }
  return false;
}

function sanitizeEnv(env) {
  const result = {};
  for (const [k, v] of Object.entries(env)) {
    if (!isEnvSensitive(k)) result[k] = v;
  }
  return result;
}

// ─── ShellSecurityService ────────────────────────────────

class ShellSecurityService {
  validate(command, args, cwd, projectRoot) {
    const baseName = path.basename(command);

    // Layer 1: Whitelist
    if (!ALLOWED_COMMANDS.has(baseName)) {
      return { verdict: 'block', blockedByLayer: 1, reason: `Command '${baseName}' not in whitelist` };
    }

    // Layer 2: Arg blacklist
    const cmdBlocked = COMMAND_BLOCKED_ARGS[baseName];
    for (const arg of args) {
      if (BLOCKED_ARGS.has(arg)) {
        return { verdict: 'block', blockedByLayer: 2, reason: `Arg '${arg}' blocked globally` };
      }
      if (cmdBlocked) {
        for (const b of cmdBlocked) {
          if (arg === b || arg.startsWith(b + '=')) {
            return { verdict: 'block', blockedByLayer: 2, reason: `Arg '${arg}' blocked for '${baseName}'` };
          }
        }
      }
    }

    // Layer 2b: npm safety
    const injectedArgs = [];
    if (baseName === 'npm' || baseName === 'yarn' || baseName === 'pnpm') {
      const sub = args[0];
      if (sub && !NPM_SAFE_SUBCOMMANDS.has(sub)) {
        return { verdict: 'block', blockedByLayer: 2, reason: `npm subcommand '${sub}' not allowed` };
      }
      if (sub && NPM_FORCE_IGNORE_SCRIPTS.has(sub) && !args.includes('--ignore-scripts')) {
        injectedArgs.push('--ignore-scripts');
      }
    }

    // Layer 4: cwd sandbox
    try {
      const resolvedCwd = fs.realpathSync(cwd);
      const resolvedRoot = fs.realpathSync(projectRoot);
      if (!resolvedCwd.startsWith(resolvedRoot + path.sep) && resolvedCwd !== resolvedRoot) {
        return { verdict: 'block', blockedByLayer: 4, reason: `cwd '${cwd}' outside sandbox` };
      }
    } catch {
      return { verdict: 'block', blockedByLayer: 4, reason: `cwd '${cwd}' cannot be verified` };
    }

    // Layer 4b: path traversal in args
    for (const arg of args) {
      if (!arg.startsWith('-') && !arg.includes('://') && arg.includes('..')) {
        try {
          const resolved = path.resolve(projectRoot, arg);
          const resolvedRoot = fs.realpathSync(projectRoot);
          if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
            return { verdict: 'block', blockedByLayer: 4, reason: `Arg '${arg}' path traversal outside sandbox` };
          }
        } catch {
          return { verdict: 'block', blockedByLayer: 4, reason: `Arg '${arg}' has '..' and can't be verified` };
        }
      }
    }

    return {
      verdict: 'allow',
      sanitizedCommand: baseName,
      sanitizedArgs: [...args, ...injectedArgs],
      injectedArgs: injectedArgs.length > 0 ? injectedArgs : undefined,
      sanitizedEnv: sanitizeEnv(process.env),
    };
  }
}

// ─── WS Security ─────────────────────────────────────────

class SessionTokenManager {
  constructor() { this.token = crypto.randomBytes(32).toString('hex'); }
  getToken() { return this.token; }
  regenerate() { this.token = crypto.randomBytes(32).toString('hex'); return this.token; }
  validate(candidate) {
    if (!candidate || candidate.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
  }
}

class RateLimiter {
  constructor(maxTokens = 20, refillRate = 100 / 60) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.buckets = new Map();
  }
  allow(connId) {
    const now = Date.now();
    let b = this.buckets.get(connId);
    if (!b) { b = { tokens: this.maxTokens, lastRefill: now }; this.buckets.set(connId, b); }
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(this.maxTokens, b.tokens + elapsed * this.refillRate);
    b.lastRefill = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }
  remove(connId) { this.buckets.delete(connId); }
  remaining(connId) { const b = this.buckets.get(connId); return b ? Math.floor(b.tokens) : this.maxTokens; }
}

const ALLOWED_WS_TYPES = new Set([
  'chat', 'agent_event', 'phase_change', 'status',
  'diff_proposal', 'review_action', 'apply_changes',
  'shell_exec', 'shell_result', 'ping', 'pong',
]);

class InputValidator {
  constructor(maxMsgSize = 102400) { this.maxMsgSize = maxMsgSize; }

  validateConnection(remoteAddr, token, tokenMgr) {
    const clean = (remoteAddr || '').replace(/^::ffff:/, '');
    const local = clean === '127.0.0.1' || clean === '::1' || clean === 'localhost' || clean.startsWith('127.');
    if (!local) return { allowed: false, reason: 'Non-local address: ' + remoteAddr };
    if (tokenMgr && (!token || !tokenMgr.validate(token))) {
      return { allowed: false, reason: 'Invalid or missing session token' };
    }
    return { allowed: true };
  }

  validateMessage(raw) {
    const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length;
    if (size > this.maxMsgSize) return { allowed: false, reason: 'Message too large: ' + size };
    let payload;
    try { payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')); }
    catch { return { allowed: false, reason: 'Invalid JSON' }; }
    if (!payload || typeof payload !== 'object' || !payload.type) return { allowed: false, reason: 'Missing "type" field' };
    if (!ALLOWED_WS_TYPES.has(payload.type)) return { allowed: false, reason: 'Disallowed type: ' + payload.type };
    const sanitized = this._deepSanitize(payload);
    return { allowed: true, sanitizedPayload: sanitized };
  }

  _deepSanitize(obj) {
    if (typeof obj === 'string') return this._sanitizeStr(obj);
    if (Array.isArray(obj)) return obj.map(i => this._deepSanitize(i));
    if (obj && typeof obj === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(obj)) r[this._sanitizeStr(k)] = this._deepSanitize(v);
      return r;
    }
    return obj;
  }

  _sanitizeStr(s) {
    return s.replace(/\0/g, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '').slice(0, 50000);
  }
}

class WsSecurityGuard {
  constructor(config = {}) {
    this.tokenManager = new SessionTokenManager();
    this.rateLimiter = new RateLimiter(config.rateBurst || 20, (config.rateLimit || 100) / 60);
    this.validator = new InputValidator(config.maxMessageSize || 102400);
  }
  validateConnection(addr, token) { return this.validator.validateConnection(addr, token, this.tokenManager); }
  validateMessage(connId, raw) {
    if (!this.rateLimiter.allow(connId)) return { allowed: false, reason: 'Rate limited' };
    return this.validator.validateMessage(raw);
  }
  onDisconnect(connId) { this.rateLimiter.remove(connId); }
}

// ─── Process Isolation ───────────────────────────────────

class ProcessIsolation {
  buildSandboxArgs(command, args, cwd, config = {}) {
    const bwrapArgs = [
      '--ro-bind', '/', '/',
      '--bind', cwd, cwd,
      '--tmpfs', '/tmp',
      '--proc', '/proc',
      '--dev', '/dev',
      '--die-with-parent',
      '--unshare-pid',
    ];
    if (!config.allowNetwork) bwrapArgs.push('--unshare-net');
    bwrapArgs.push('--', command, ...args);
    return bwrapArgs;
  }

  commandNeedsNetwork(command, args) {
    const netCmds = new Set(['curl', 'wget', 'git', 'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'flutter']);
    if (!netCmds.has(command)) return false;
    if (command === 'npm' || command === 'yarn' || command === 'pnpm') {
      const net = new Set(['install', 'ci', 'audit', 'outdated', 'info', 'pack']);
      return args[0] ? net.has(args[0]) : false;
    }
    if (command === 'git') {
      const net = new Set(['clone', 'fetch', 'pull', 'push', 'remote']);
      return args[0] ? net.has(args[0]) : false;
    }
    return true;
  }
}

module.exports = {
  ShellSecurityService, ALLOWED_COMMANDS, BLOCKED_ARGS, COMMAND_BLOCKED_ARGS,
  NPM_SAFE_SUBCOMMANDS, NPM_FORCE_IGNORE_SCRIPTS,
  sanitizeEnv, isEnvSensitive,
  SessionTokenManager, RateLimiter, InputValidator, WsSecurityGuard,
  ProcessIsolation,
};
