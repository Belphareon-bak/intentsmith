import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const packageJson = JSON.parse(read('mobile-app/package.json'));
const packageLock = JSON.parse(read('mobile-app/package-lock.json'));
const variables = read('mobile-app/android/variables.gradle');
const projectGradle = read('mobile-app/android/build.gradle');
const appGradle = read('mobile-app/android/app/build.gradle');
const capacitorGradle = read('mobile-app/android/app/capacitor.build.gradle');
const wrapper = read('mobile-app/android/gradle/wrapper/gradle-wrapper.properties');
const manifest = read('mobile-app/android/app/src/main/AndroidManifest.xml');
const capacitorConfig = JSON.parse(read('mobile-app/capacitor.config.json'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function exactGradleValue(source, name, expected) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*['\"]?([^'\"\\s]+)`));
  assert.ok(match, `${name} is missing`);
  assert.equal(match[1], String(expected), name);
}

console.log('\n=== Mobile Android production platform baseline ===');

test('Capacitor packages are aligned and exactly pinned to the audited v8 line', () => {
  const expected = '8.4.3';
  assert.equal(packageJson.dependencies['@capacitor/android'], expected);
  assert.equal(packageJson.dependencies['@capacitor/core'], expected);
  assert.equal(packageJson.devDependencies['@capacitor/cli'], expected);
  assert.equal(packageLock.packages['node_modules/@capacitor/android'].version, expected);
  assert.equal(packageLock.packages['node_modules/@capacitor/core'].version, expected);
  assert.equal(packageLock.packages['node_modules/@capacitor/cli'].version, expected);
});

test('Android 16 and Capacitor 8 SDK floors are explicit', () => {
  exactGradleValue(variables, 'minSdkVersion', 24);
  exactGradleValue(variables, 'compileSdkVersion', 36);
  exactGradleValue(variables, 'targetSdkVersion', 36);
});

test('Gradle and Android Gradle Plugin versions match the Capacitor 8 baseline', () => {
  assert.match(wrapper, /gradle-8\.14\.3-all\.zip/);
  assert.match(projectGradle, /com\.android\.tools\.build:gradle:8\.13\.0/);
  assert.match(projectGradle, /com\.google\.gms:google-services:4\.4\.4/);
});

test('generated Android compilation uses Java 21', () => {
  assert.match(capacitorGradle, /sourceCompatibility JavaVersion\.VERSION_21/);
  assert.match(capacitorGradle, /targetCompatibility JavaVersion\.VERSION_21/);
});

test('Android 16 density changes do not restart the locked activity', () => {
  const changes = manifest.match(/android:configChanges="([^"]+)"/)?.[1]?.split('|') || [];
  assert.ok(changes.includes('navigation'));
  assert.ok(changes.includes('density'));
});

test('release WebView diagnostics are disabled', () => {
  assert.equal(capacitorConfig.android.webContentsDebuggingEnabled, false);
  assert.equal(capacitorConfig.android.loggingBehavior, 'none');
  assert.equal(capacitorConfig.android.allowMixedContent, false);
});

test('release signing still fails closed without an explicit key or escape', () => {
  assert.match(appGradle, /keystore\.properties/);
  assert.match(appGradle, /allowDebugSigning/);
  assert.match(appGradle, /throw new GradleException/);
  assert.equal((appGradle.match(/signingConfig\s+signingConfigs\.debug/g) || []).length, 1);
  assert.match(
    appGradle,
    /else if \(project\.hasProperty\('allowDebugSigning'\)[\s\S]+?signingConfig\s+signingConfigs\.debug[\s\S]+?else \{[\s\S]+?throw new GradleException/,
  );
});

test('Android backup remains disabled for device credentials', () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
});

console.log(`\nMobile Android platform: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
