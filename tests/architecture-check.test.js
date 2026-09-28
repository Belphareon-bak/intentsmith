// tests/architecture-check.test.js — deterministic architecture contract checks
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { scanImports, validateArchitecture } from '../src/planner/architecture-check.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-check-test-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

suite('Architecture Check — Java');

test('scanImports extracts regular and static Java imports', () => {
  const imports = scanImports(
    'import com.example.service.UserService;\n' +
    'import static com.example.util.Constants.VALUE;\n',
    'java',
  );

  assertEqual(imports.length, 2);
  assert(imports.includes('com.example.service.UserService'), 'regular import must be extracted');
  assert(imports.includes('com.example.util.Constants.VALUE'), 'static import must be extracted');
});

await testAsync('validateArchitecture discovers Java source files', async () => {
  const dir = tmpDir();
  try {
    writeFile(
      dir,
      'src/controllers/UserController.java',
      'package com.example.controllers;\n\npublic class UserController {\n}\n',
    );
    const contract = {
      layers: ['controllers'],
      rules: [{ from: 'controllers', canImport: [] }],
      fileStructure: { controllers: 'src/controllers' },
    };

    const result = await validateArchitecture(dir, contract);
    assertEqual(result.totalFiles, 1, 'Java source must be discovered');
    assertEqual(result.checkedFiles, 1, 'Java source must be checked');
    assertEqual(result.violations.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

summary();
