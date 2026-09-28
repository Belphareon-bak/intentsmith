#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { scanSpecialistPackage } from '../src/specialists/specialist-boundary.js';

function usage() {
  return [
    'Usage: node scripts/specialist-boundary-ratchet.mjs [options]',
    '',
    'Options:',
    '  --root <path>             repository root (default: cwd)',
    '  --specialists-dir <path>  package directory (default: <root>/specialists)',
    '  --json                    emit one JSON report',
    '  --help                    show this help',
    '',
    'Exit codes: 0 pass, 1 import/effect boundary violation, 2 invalid input or scan failure.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { root: process.cwd(), specialistsDir: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--root' || argument === '--specialists-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`);
      if (argument === '--root') options.root = value;
      else options.specialistsDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const root = path.resolve(options.root);
  const specialistsDir = path.resolve(options.specialistsDir || path.join(root, 'specialists'));
  let entries;
  try {
    entries = fs.readdirSync(specialistsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    console.error(`Cannot scan ${specialistsDir}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const packages = entries.map((entry) => {
    const packageDir = path.join(specialistsDir, entry.name);
    return {
      id: entry.name,
      result: scanSpecialistPackage(packageDir, { projectRoot: root }),
    };
  });
  const violations = packages.flatMap(({ id, result }) => (
    result.violations.map((item) => ({ packageId: id, ...item }))
  ));
  const errors = packages.flatMap(({ id, result }) => (
    result.errors.map((item) => ({ packageId: id, ...item }))
  ));
  const typeReferences = packages.flatMap(({ id, result }) => (
    result.typeReferences.map((item) => ({ packageId: id, ...item }))
  ));
  const computedImports = packages.flatMap(({ id, result }) => (
    result.computedImports.map((item) => ({ packageId: id, ...item }))
  ));
  const ambientEffects = packages.flatMap(({ id, result }) => (
    result.ambientEffects.map((item) => ({ packageId: id, ...item }))
  ));
  const report = {
    schemaVersion: 2,
    ok: violations.length === 0 && errors.length === 0,
    packages: packages.length,
    scannedFiles: packages.reduce((total, item) => total + item.result.scannedFiles, 0),
    violations,
    errors,
    typeReferences,
    computedImports,
    ambientEffects,
  };

  if (options.json) {
    console.log(JSON.stringify(report));
  } else {
    const verdict = report.ok ? 'PASS' : 'FAIL';
    console.log(
      `SPECIALIST_BOUNDARY_${verdict} packages=${report.packages} `
      + `files=${report.scannedFiles} violations=${violations.length} `
      + `scanErrors=${errors.length} typeReferences=${typeReferences.length} `
      + `computedImports=${computedImports.length} ambientEffects=${ambientEffects.length}`,
    );
    for (const item of violations) {
      console.log(
        `VIOLATION ${item.packageId} ${item.file}:${item.line} ${item.kind} -> ${item.specifier}`,
      );
    }
    for (const item of errors) {
      console.log(`SCAN_ERROR ${item.packageId} ${item.file} ${item.reason}`);
    }
    for (const item of typeReferences) {
      console.log(
        `INFO_TYPE_REFERENCE ${item.packageId} ${item.file}:${item.line} -> ${item.specifier}`,
      );
    }
  }

  process.exitCode = errors.length > 0 ? 2 : (violations.length > 0 ? 1 : 0);
}

main();
