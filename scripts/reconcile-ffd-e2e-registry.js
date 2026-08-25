#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const e2eDir = path.join(root, 'tests', 'e2e');
const registryPath = path.join(root, 'tests', 'registry.json');
const write = process.argv.slice(2).includes('--write');

const EXPECTED_PATH_COUNT = 81;
const EXPECTED_PATH_HASH = 'c96260ed80a0cf57668838fa0e44add470883ba8b05efcf1bb88a1c271109d57';
// Suite 08 validates and stores an HTTPS source definition but never executes
// it; only suites that actually perform external I/O belong here.
const EXTERNAL_NETWORK = new Set([10, 51, 206]);
const OLLAMA_ONLY_SERVER = new Set([14, 16]);
const MIXED_SERVER_MODEL = new Set();
const LOCAL_SERVER_ONLY = new Set([56, 60, 63, 64, 80, 83, 84]);
const QWEN_35_27B_DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
const MODEL_FIXTURE_PARALLELISM = new Map([
  [57, 1],
  [58, 1],
  [59, 1],
  [88, 3],
]);

function modelFixtureFor(number) {
  const parallelRequests = MODEL_FIXTURE_PARALLELISM.get(number);
  if (!parallelRequests) return null;

  const modelWeightsMiB = 17_160;
  const perRequestHeadroomMiB = 1_944;
  const minimumHeadroomMiB = 1_024;
  return {
    provider: 'ollama',
    model: 'qwen3.5:27b',
    digestSha256: QWEN_35_27B_DIGEST,
    contextWindowTokens: 8_192,
    minimumFreeVramMiB: (
      modelWeightsMiB
      + (perRequestHeadroomMiB * parallelRequests)
      + minimumHeadroomMiB
    ),
    parallelRequests,
    minimumHeadroomMiB,
    minimumGpuResidencyPercent: 100,
    fallbackPolicy: 'forbid',
  };
}

function suiteId(tier, testPath) {
  const stem = path.basename(testPath, '.e2e.js')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `IS-${tier}-E2E-${stem}`;
}

function isKnownDefective(source) {
  return (
    /\bassert\s*\(\s*true\b/.test(source)
    || /\bstatus\s*===?\s*500\b/.test(source)
    || /\b500\s*===?\s*status\b/.test(source)
  );
}

function metadataFor(testPath, source) {
  const number = Number.parseInt(path.basename(testPath), 10);
  const isPhase = number >= 200;
  const isLongModel = number >= 85 && number < 200;
  const isApiServer = number <= 25;
  const isServer = isApiServer || LOCAL_SERVER_ONLY.has(number);
  const tier = isPhase ? 'T5' : 'T3';
  const profile = isPhase ? 'soak' : isServer ? 'server' : 'model';
  const timeoutMs = isPhase ? 5_400_000 : isLongModel ? 3_600_000 : 900_000;
  const expectedDurationMs = isPhase ? 3_600_000 : isLongModel ? 2_700_000
    : isServer ? 120_000 : 600_000;
  const ollamaRequired = !isServer
    || OLLAMA_ONLY_SERVER.has(number)
    || MIXED_SERVER_MODEL.has(number);
  const gpuRequired = !isServer || MIXED_SERVER_MODEL.has(number);
  const modelFixture = modelFixtureFor(number);

  const metadata = {
    id: suiteId(tier, testPath),
    path: testPath,
    argv: ['node', testPath],
    capabilityId: isApiServer ? 'C3-023' : number < 200 ? 'C3-003' : 'C3-027',
    tier,
    fixture: isPhase
      ? 'owned-sequential-model-server-state'
      : isServer
        ? 'owned-isolated-local-server'
        : isLongModel
          ? 'owned-isolated-model-server-long'
          : 'owned-isolated-model-server',
    profile,
    timeoutMs,
    expectedDurationMs,
    requirements: {
      network: EXTERNAL_NETWORK.has(number) ? 'external' : 'loopback',
      database: true,
      server: true,
      ollama: ollamaRequired,
      gpu: gpuRequired,
      ...(modelFixture ? { modelFixture } : {}),
    },
    required: true,
    owner: 'primary implementer',
    state: isKnownDefective(source) ? 'KNOWN_DEFECTIVE' : 'BLOCKED',
    lastGreen: {
      commit: null,
      artifact: null,
    },
    flakeCount: 0,
    quarantineExpiry: null,
  };
  if (number === 83) {
    return {
      ...metadata,
      capabilityId: 'C3-007',
      fixture: 'server',
      timeoutMs: 120_000,
      expectedDurationMs: 2_000,
      owner: 'WP-M3-EXPERTISE',
      state: 'ACTIVE',
    };
  }
  if (number === 84) {
    return {
      ...metadata,
      capabilityId: 'C3-013',
      timeoutMs: 120_000,
      expectedDurationMs: 5_000,
      owner: 'WP-M3-SPECIALIST-CODE-REVIEW',
      state: 'ACTIVE',
    };
  }
  if (number === 64) {
    return {
      ...metadata,
      capabilityId: 'C3-013',
      timeoutMs: 120_000,
      expectedDurationMs: 5_000,
      owner: 'WP-M3-AGENT-PROJECT-HEALTH',
      state: 'ACTIVE',
    };
  }
  return metadata;
}

async function main() {
  const names = (await readdir(e2eDir))
    .filter((name) => /^\d{2,3}-.*\.e2e\.js$/.test(name))
    .sort();
  const paths = names.map((name) => `tests/e2e/${name}`);
  const pathHash = createHash('sha256')
    .update(`${paths.join('\n')}\n`)
    .digest('hex');

  if (paths.length !== EXPECTED_PATH_COUNT || pathHash !== EXPECTED_PATH_HASH) {
    throw new Error(
      `Disputed E2E inventory drift: count=${paths.length}, sha256=${pathHash}`,
    );
  }

  const rebuilt = [];
  for (const testPath of paths) {
    const source = await readFile(path.join(root, testPath), 'utf8');
    rebuilt.push(metadataFor(testPath, source));
  }

  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const rebuiltPaths = new Set(paths);
  const retained = registry.suites.filter((suite) => !rebuiltPaths.has(suite.path));
  const nextSuites = [...retained, ...rebuilt];

  if (write) {
    registry.suites = nextSuites;
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o644,
    });
  } else {
    // Registry order is not E2E inventory authority: curated suites can be
    // appended alongside their direct tests. Compare the same canonical path
    // order used by discovery so validation does not demand a 2,000-line
    // semantic no-op reorder.
    const current = registry.suites
      .filter((suite) => rebuiltPaths.has(suite.path))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (JSON.stringify(current) !== JSON.stringify(rebuilt)) {
      throw new Error(
        'Rebuilt E2E registry metadata is stale; run '
        + '`node scripts/reconcile-ffd-e2e-registry.js --write`',
      );
    }
  }

  const counts = rebuilt.reduce((result, suite) => {
    result[suite.state] = (result[suite.state] || 0) + 1;
    return result;
  }, {});
  console.log(
    `Disputed E2E registry ${write ? 'written' : 'valid'}: `
    + `${rebuilt.length} suites, ${JSON.stringify(counts)}, paths ${pathHash}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
