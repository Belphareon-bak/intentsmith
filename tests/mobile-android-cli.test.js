import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  executableName,
  findApkSignerJar,
  javaTool,
  parseJavaMajor,
  renderLocalProperties,
  resolveAndroidSdk,
} from '../scripts/mobile-android.mjs';

const read = file => readFileSync(file, 'utf8');
const packageJson = JSON.parse(read('package.json'));
const workflow = read('scripts/mobile-android.mjs');
const shellWrapper = read('scripts/mobile-android.sh');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile Android cross-platform release CLI ===');

await test('all npm Android commands use Node and expose install explicitly', () => {
  const scripts = packageJson.scripts;
  for (const command of ['doctor', 'reverse', 'keystore', 'build', 'install', 'run']) {
    assert.equal(scripts[`mobile:android:${command}`], `node scripts/mobile-android.mjs ${command}`);
  }
  assert.ok(!Object.values(scripts).some(value => /bash scripts\/mobile-android\.sh/.test(value)));
});

await test('the legacy shell entry point is only a compatibility delegate', () => {
  assert.match(shellWrapper, /exec node "\$REPO_ROOT\/scripts\/mobile-android\.mjs" "\$@"/);
  assert.doesNotMatch(shellWrapper, /apksigner|keytool|gradlew/);
});

await test('Android SDK discovery has deterministic environment precedence', () => {
  assert.equal(resolveAndroidSdk({ ANDROID_HOME: '/primary', ANDROID_SDK_ROOT: '/old' }, 'linux', '/home/u'), path.resolve('/primary'));
  assert.equal(resolveAndroidSdk({ ANDROID_SDK_ROOT: '/secondary' }, 'linux', '/home/u'), path.resolve('/secondary'));
  assert.equal(
    resolveAndroidSdk({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u'),
    path.join('C:\\Users\\u\\AppData\\Local', 'Android', 'Sdk'),
  );
});

await test('platform executable and JAVA_HOME resolution are cross-platform', () => {
  assert.equal(executableName('adb', 'win32'), 'adb.exe');
  assert.equal(executableName('adb', 'linux'), 'adb');
  assert.equal(javaTool('java', { JAVA_HOME: 'C:\\JDK21' }, 'win32'), path.join(path.resolve('C:\\JDK21'), 'bin', 'java.exe'));
  assert.equal(javaTool('keytool', {}, 'linux'), 'keytool');
});

await test('JDK major parser recognizes supported and unsupported output', () => {
  assert.equal(parseJavaMajor('openjdk version "21.0.8" 2025-07-15 LTS'), 21);
  assert.equal(parseJavaMajor('java version "17.0.10"'), 17);
  assert.equal(parseJavaMajor('not a java version'), null);
});

await test('local.properties uses a Gradle-safe normalized path', () => {
  const rendered = renderLocalProperties('C:\\Android\\Sdk');
  assert.equal(rendered, `sdk.dir=${path.resolve('C:\\Android\\Sdk').replace(/\\/g, '/')}\n`);
  assert.doesNotMatch(rendered, /\\/);
});

await test('the newest installed build-tools signer jar is selected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'is-android-cli-'));
  try {
    for (const version of ['35.0.1', '36.0.0']) {
      const lib = path.join(dir, 'build-tools', version, 'lib');
      mkdirSync(lib, { recursive: true });
      writeFileSync(path.join(lib, 'apksigner.jar'), 'fixture');
    }
    assert.equal(findApkSignerJar(dir), path.join(dir, 'build-tools', '36.0.0', 'lib', 'apksigner.jar'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('signer verification is mandatory and has no swallowed failure', () => {
  assert.match(workflow, /runCommand\([\s\S]+?java\.command,[\s\S]+?\['-jar', signerJar, 'verify', '--print-certs', apk\]/);
  assert.doesNotMatch(workflow, /apksigner[\s\S]{0,200}\|\| true/);
  assert.match(workflow, /Signed release APK was not produced/);
});

await test('internal key creation uses random material and never a known password', () => {
  assert.match(workflow, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.doesNotMatch(workflow, /intentsmith-prototype|C3_ANDROID_KEY_PASS/);
  assert.match(workflow, /'-storepass:env', passwordEnvironmentName/);
  assert.match(workflow, /'-keypass:env', passwordEnvironmentName/);
  assert.match(workflow, /This is not a production key ceremony/);
});

await test('doctor runs on the current native host without Bash or mutation', () => {
  const result = spawnSync(process.execPath, ['scripts/mobile-android.mjs', 'doctor'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /IntentSmith Android release workflow/);
  assert.match(result.stdout, /Android API 36/);
});

await test('release-only escape options cannot leak into other commands', () => {
  const result = spawnSync(process.execPath, [
    'scripts/mobile-android.mjs',
    'doctor',
    '--debug-signing',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid only with build/);
});

console.log(`\nMobile Android CLI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
