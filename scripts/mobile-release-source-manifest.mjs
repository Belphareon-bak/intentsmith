#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MOBILE_RELEASE_EXACT_SOURCE_ASSETS,
  MOBILE_RELEASE_SOURCE_MANIFEST_ASSET,
  renderMobileReleaseSourceManifestV1,
} from './mobile-release-artifact-binding.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLIENT = path.join(ROOT, 'src/mobile/client');
const ANDROID = path.join(ROOT, 'mobile-app/android');

function read(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function exact(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label} must occur exactly once`);
  return matches[0][1];
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function readMobileAndroidSourceMetadataV1() {
  const appBuild = read('mobile-app/android/app/build.gradle');
  const variables = read('mobile-app/android/variables.gradle');
  return Object.freeze({
    applicationId: exact(appBuild, /^\s*applicationId\s+"([^"]+)"\s*$/gm, 'applicationId'),
    versionCode: exact(appBuild, /^\s*versionCode\s+([0-9]+)\s*$/gm, 'versionCode'),
    versionName: exact(appBuild, /^\s*versionName\s+"([^"]+)"\s*$/gm, 'versionName'),
    minSdk: exact(variables, /^\s*minSdkVersion\s*=\s*([0-9]+)\s*$/gm, 'minSdkVersion'),
    targetSdk: exact(variables, /^\s*targetSdkVersion\s*=\s*([0-9]+)\s*$/gm, 'targetSdkVersion'),
  });
}

export function buildCurrentMobileReleaseSourceManifestV1({
  sourceRevision = gitRevision(),
  generatedRuntimeConfig = readFileSync(
    path.join(ANDROID, 'app/src/main/assets/public/runtime-config.js'),
    'utf8',
  ),
} = {}) {
  const gatewayUrl = exact(
    generatedRuntimeConfig,
    /^\s*gatewayUrl:\s*("(?:[^"\\]|\\.)*"),\s*$/gm,
    'generated gatewayUrl',
  );
  const sourceAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
    asset,
    readFileSync(path.join(CLIENT, asset), 'utf8'),
  ]));
  return renderMobileReleaseSourceManifestV1({
    sourceRevision,
    android: readMobileAndroidSourceMetadataV1(),
    gatewayUrl: JSON.parse(gatewayUrl),
    sourceCapacitorConfig: read('mobile-app/capacitor.config.json'),
    sourcePackageJson: read('mobile-app/package.json'),
    sourcePackageLock: read('mobile-app/package-lock.json'),
    sourceRuntimeConfig: read('src/mobile/client/runtime-config.js'),
    sourceIndex: read('src/mobile/client/index.html'),
    sourceAssets,
  });
}

function main() {
  const outputFlag = process.argv.indexOf('--output');
  const output = outputFlag === -1
    ? path.join(ANDROID, 'app/build/generated/intentsmithReleaseAssets', MOBILE_RELEASE_SOURCE_MANIFEST_ASSET)
    : path.resolve(process.cwd(), String(process.argv[outputFlag + 1] || ''));
  if (outputFlag !== -1 && !process.argv[outputFlag + 1]) {
    throw new Error('--output requires a path');
  }
  const bytes = buildCurrentMobileReleaseSourceManifestV1();
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, bytes, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

