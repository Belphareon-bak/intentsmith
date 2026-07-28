import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Executable dependency boundaries.
 *
 * These rules mirror `docs/architecture/dependency-boundaries.md`. They run as
 * part of `pnpm test`, so `pnpm verify` fails when a boundary is crossed. The
 * check is a plain deterministic scan rather than an extra lint dependency.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Zone = {
  /** Human-readable zone name used in failure messages. */
  name: string;
  /** Repo-relative directory that holds the zone's source. */
  dir: string;
  /** Import specifiers this zone must never reference. */
  forbidden: Array<{ pattern: RegExp; reason: string }>;
  /** Files excluded from the rule, repo-relative. */
  allow?: RegExp;
};

const FASTIFY = { pattern: /^fastify$/, reason: 'must not depend on the HTTP framework' };
const SQLITE = { pattern: /^better-sqlite3$/, reason: 'must not depend on a concrete SQLite driver' };
const PERSISTENCE = { pattern: /^@intentsmith\/persistence$/, reason: 'must not depend on persistence' };
const CORE = { pattern: /^@intentsmith\/core$/, reason: 'must not depend on core' };
const SERVER = { pattern: /^@intentsmith\/server$/, reason: 'must not depend on the server app' };
const ADAPTER_OLLAMA = { pattern: /^@intentsmith\/adapter-ollama$/, reason: 'must not depend on a concrete inference adapter' };
const CORE_PKG = { pattern: /^@intentsmith\/core$/, reason: 'must not depend on core' };
const HARDWARE = { pattern: /^@intentsmith\/hardware$/, reason: 'must not depend on hardware' };

const ZONES: Zone[] = [
  {
    name: 'packages/process-runtime',
    dir: 'packages/process-runtime/src',
    // It may use the worker vocabulary, and nothing above it. A process runner
    // that could reach Core or persistence would be able to decide things it is
    // only supposed to execute.
    forbidden: [CORE, PERSISTENCE, FASTIFY, SQLITE, SERVER, ADAPTER_OLLAMA, HARDWARE],
  },
  {
    name: 'packages/contracts',
    dir: 'packages/contracts/src',
    forbidden: [CORE, PERSISTENCE, FASTIFY, SQLITE, SERVER],
  },
  {
    name: 'packages/core',
    dir: 'packages/core/src',
    forbidden: [
      PERSISTENCE,
      FASTIFY,
      SQLITE,
      SERVER,
      // Core may use the inference and hardware ports, never a concrete adapter.
      ADAPTER_OLLAMA,
      { pattern: /^@intentsmith\/testing$/, reason: 'must not depend on a concrete worker adapter' },
      { pattern: /adapter-(opencode|openhands|goose)/, reason: 'must not depend on a concrete worker adapter' },
      { pattern: /^ollama$|^openai$|^@anthropic-ai\//, reason: 'must not depend on an inference vendor SDK' },
    ],
  },
  {
    // The port package is the root of the inference dependency direction.
    name: 'packages/inference',
    dir: 'packages/inference/src',
    forbidden: [
      CORE_PKG,
      PERSISTENCE,
      FASTIFY,
      SQLITE,
      SERVER,
      HARDWARE,
      ADAPTER_OLLAMA,
      { pattern: /^ollama$|^openai$|^@anthropic-ai\//, reason: 'must not depend on an inference vendor SDK' },
    ],
  },
  {
    // The adapter translates one vendor API and must stay a leaf.
    name: 'packages/adapter-ollama',
    dir: 'packages/adapter-ollama/src',
    forbidden: [CORE_PKG, PERSISTENCE, FASTIFY, SQLITE, SERVER, HARDWARE],
  },
  {
    name: 'packages/hardware',
    dir: 'packages/hardware/src',
    forbidden: [CORE_PKG, PERSISTENCE, FASTIFY, SQLITE, SERVER, ADAPTER_OLLAMA],
  },
  {
    name: 'packages/persistence',
    dir: 'packages/persistence/src',
    forbidden: [FASTIFY, SERVER],
  },
  {
    name: 'apps/cli',
    dir: 'apps/cli/src',
    forbidden: [
      SQLITE,
      { pattern: /^@intentsmith\/persistence$/, reason: 'must reach state through the API boundary, not SQLite' },
    ],
  },
  {
    name: 'apps/server routes',
    dir: 'apps/server/src',
    forbidden: [SQLITE],
    // `runtime.ts` composes the process and may open the store; routes may not.
    allow: /apps\/server\/src\/runtime\.ts$/,
  },
];

/** Worker adapter implementations must never touch persistence directly. */
const WORKER_SOURCES = ['packages/testing/src/fake-worker.ts'];

function sourceFiles(dir: string): string[] {
  const absolute = path.join(repoRoot, dir);
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'dist' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (full.endsWith('.ts')) out.push(full);
    }
  };
  walk(absolute);
  return out;
}

/**
 * Matches, in order: `import|export ... from 'x'`, a bare side-effect
 * `import 'x'`, a dynamic `import('x')`, and `require('x')`. The bare form
 * matters: `import 'fastify';` pulls in a dependency just as much as a named
 * import does.
 */
const IMPORT_PATTERNS = [
  /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/**
 * Test files, and the fixture modules that feed them, may import and contain
 * whatever they need to drive the system under test. Fixtures are inert sample
 * payloads, never call sites, and are kept out of every package's production
 * entry point so they cannot ship.
 */
const isTestFile = (file: string): boolean => file.endsWith('.test.ts') || file.endsWith('/fixtures.ts');

describe('dependency boundaries', () => {
  for (const zone of ZONES) {
    it(`${zone.name} respects its forbidden imports`, () => {
      const violations: string[] = [];
      for (const file of sourceFiles(zone.dir)) {
        const relative = path.relative(repoRoot, file);
        if (isTestFile(file)) continue;
        if (zone.allow?.test(relative)) continue;
        for (const specifier of importsOf(file)) {
          for (const rule of zone.forbidden) {
            if (rule.pattern.test(specifier)) {
              violations.push(`${relative} imports "${specifier}": ${zone.name} ${rule.reason}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('worker adapters do not import persistence', () => {
    const violations: string[] = [];
    for (const relative of WORKER_SOURCES) {
      for (const specifier of importsOf(path.join(repoRoot, relative))) {
        if (/^@intentsmith\/persistence$/.test(specifier) || /^better-sqlite3$/.test(specifier)) {
          violations.push(`${relative} imports "${specifier}": worker adapters must not reach persistence`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no runtime source calls a cloud or inference endpoint', () => {
    const zones = [
      'packages/contracts/src',
      'packages/core/src',
      'packages/inference/src',
      'packages/hardware/src',
      'packages/adapter-ollama/src',
      'packages/persistence/src',
      'apps/server/src',
      'apps/cli/src',
    ];
    const banned = /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+/i;
    const violations: string[] = [];
    for (const dir of zones) {
      for (const file of sourceFiles(dir)) {
        if (isTestFile(file)) continue;
        const source = readFileSync(file, 'utf8');
        for (const line of source.split('\n')) {
          // Ignore documentation links inside comments.
          if (/^\s*(\*|\/\/)/.test(line)) continue;
          const match = banned.exec(line);
          if (match) violations.push(`${path.relative(repoRoot, file)}: ${match[0]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('declares every cross-package import in the package manifest', () => {
    const violations: string[] = [];
    const packages = [
      'packages/contracts',
      'packages/core',
      'packages/inference',
      'packages/hardware',
      'packages/adapter-ollama',
      'packages/persistence',
      'packages/testing',
      'apps/server',
      'apps/cli',
    ];
    for (const pkg of packages) {
      const manifest = JSON.parse(readFileSync(path.join(repoRoot, pkg, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]);
      for (const file of sourceFiles(path.join(pkg, 'src'))) {
        for (const specifier of importsOf(file)) {
          if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
          const packageName = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : (specifier.split('/')[0] as string);
          if (packageName === 'vitest') continue;
          if (!declared.has(packageName)) {
            violations.push(`${path.relative(repoRoot, file)} imports undeclared package "${packageName}"`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
