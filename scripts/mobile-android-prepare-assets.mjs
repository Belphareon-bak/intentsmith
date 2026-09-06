#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_OUTPUT = path.join(
  REPO_ROOT,
  'mobile-app/android/app/src/main/assets/public/runtime-config.js',
);

export function normalizeGatewayOrigin(raw) {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw === '') {
    throw new TypeError('Gateway URL must be a non-empty absolute URL without surrounding whitespace.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Gateway URL is not absolute: ${raw}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Gateway URL must be an exact HTTP(S) origin without credentials, path, query or fragment.');
  }

  const loopback = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !loopback) {
    throw new TypeError('Cleartext gateway URLs are allowed only on loopback; use HTTPS for remote access.');
  }

  return url.origin;
}

export function renderRuntimeConfig(origin) {
  return `// Generated for an Android build; do not edit or commit.\n`
    + `Object.defineProperty(globalThis, 'INTENTSMITH_RUNTIME_CONFIG', {\n`
    + `  value: Object.freeze({ gatewayOrigin: ${JSON.stringify(origin)} }),\n`
    + `  configurable: false,\n`
    + `  enumerable: false,\n`
    + `  writable: false,\n`
    + `});\n`;
}

export async function prepareAndroidAssets({ gatewayUrl, outputPath = DEFAULT_OUTPUT }) {
  const origin = normalizeGatewayOrigin(gatewayUrl);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderRuntimeConfig(origin), { encoding: 'utf8', mode: 0o644 });
  return { origin, outputPath };
}

async function main(argv) {
  let gatewayUrl = process.env.C3_MOBILE_APP_URL || 'http://127.0.0.1:3336';
  let outputPath = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') gatewayUrl = argv[++index];
    else if (argv[index] === '--output') outputPath = path.resolve(argv[++index]);
    else throw new TypeError(`Unknown argument: ${argv[index]}`);
  }
  const result = await prepareAndroidAssets({ gatewayUrl, outputPath });
  console.log(`Android runtime config: ${result.origin} -> ${result.outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Android asset preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
