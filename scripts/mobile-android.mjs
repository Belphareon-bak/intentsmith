#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareAndroidAssets } from './mobile-android-prepare-assets.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const APP_DIR = path.join(REPO_ROOT, 'mobile-app');
export const ANDROID_DIR = path.join(APP_DIR, 'android');
export const APP_ID = 'cz.intentsmith.companion';
export const REQUIRED_JAVA_MAJOR = 21;
export const REQUIRED_ANDROID_API = 36;

const port = process.env.C3_MOBILE_PORT || '3336';
const gatewayUrl = process.env.C3_MOBILE_APP_URL || `http://127.0.0.1:${port}`;

function note(message) {
  process.stdout.write(`  ${message}\n`);
}

function die(message) {
  throw new Error(message);
}

export function executableName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.exe` : name;
}

export function resolveAndroidSdk(
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
) {
  if (env.ANDROID_HOME) return path.resolve(env.ANDROID_HOME);
  if (env.ANDROID_SDK_ROOT) return path.resolve(env.ANDROID_SDK_ROOT);
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Android', 'sdk');
  return path.join(home, 'Android', 'Sdk');
}

export function javaTool(name, env = process.env, platform = process.platform) {
  return env.JAVA_HOME
    ? path.join(path.resolve(env.JAVA_HOME), 'bin', executableName(name, platform))
    : executableName(name, platform);
}

export function parseJavaMajor(output) {
  const match = String(output).match(/(?:java|openjdk) version "(\d+)(?:\.|"?)/i);
  return match ? Number(match[1]) : null;
}

export function renderLocalProperties(sdkRoot) {
  return `sdk.dir=${path.resolve(sdkRoot).replaceAll('\\', '/')}\n`;
}

export function findApkSignerJar(sdkRoot) {
  const buildTools = path.join(sdkRoot, 'build-tools');
  if (!existsSync(buildTools)) return null;
  const versions = readdirSync(buildTools, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(buildTools, version, 'lib', 'apksigner.jar');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function runCommand(
  command,
  args,
  { cwd = REPO_ROOT, capture = false, env = process.env } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) die(`${path.basename(command)} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}`.trimEnd() : '';
    die(`${path.basename(command)} exited with code ${result.status}.${detail}`);
  }
  return result;
}

function probe(command, args) {
  try {
    return runCommand(command, args, { capture: true });
  } catch {
    return null;
  }
}

function assertReadable(target, message) {
  try {
    accessSync(target, fsConstants.R_OK);
  } catch {
    die(message);
  }
}

function inspectJava() {
  const command = javaTool('java');
  const result = probe(command, ['-version']);
  const versionOutput = result ? `${result.stderr || ''}${result.stdout || ''}` : '';
  return { command, major: parseJavaMajor(versionOutput), versionOutput: versionOutput.trim() };
}

function requireBuildToolchain({ allowDebugSigning = false } = {}) {
  const sdkRoot = resolveAndroidSdk();
  assertReadable(
    path.join(sdkRoot, 'platforms', `android-${REQUIRED_ANDROID_API}`, 'android.jar'),
    `Android SDK platform ${REQUIRED_ANDROID_API} is missing under ${sdkRoot}.`,
  );

  const java = inspectJava();
  if (java.major !== REQUIRED_JAVA_MAJOR) {
    die(`JDK ${REQUIRED_JAVA_MAJOR} is required; set JAVA_HOME to a matching JDK.`);
  }

  const signerJar = findApkSignerJar(sdkRoot);
  if (!signerJar) die(`apksigner.jar is missing under ${path.join(sdkRoot, 'build-tools')}.`);

  const signingProperties = path.join(ANDROID_DIR, 'keystore.properties');
  if (!allowDebugSigning && !existsSync(signingProperties)) {
    die('Release build has no signing key. Run `npm run mobile:android:keystore` first.');
  }
  return { sdkRoot, java, signerJar };
}

async function gatewayResponds() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/m1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function adbPath(sdkRoot) {
  return path.join(sdkRoot, 'platform-tools', executableName('adb'));
}

function requireAdb() {
  const adb = adbPath(resolveAndroidSdk());
  assertReadable(adb, `adb was not found at ${adb}; set ANDROID_HOME to the SDK root.`);
  return adb;
}

async function doctor({ strict = false } = {}) {
  const sdkRoot = resolveAndroidSdk();
  const adb = adbPath(sdkRoot);
  const java = inspectJava();
  const platformJar = path.join(
    sdkRoot,
    'platforms',
    `android-${REQUIRED_ANDROID_API}`,
    'android.jar',
  );
  const signerJar = findApkSignerJar(sdkRoot);
  const checks = {
    adb: existsSync(adb),
    java: java.major === REQUIRED_JAVA_MAJOR,
    platform: existsSync(platformJar),
    signer: Boolean(signerJar),
    signing: existsSync(path.join(ANDROID_DIR, 'keystore.properties')),
  };

  process.stdout.write('\nIntentSmith Android release workflow — status\n');
  note(`${checks.adb ? '✓' : '✗'} adb             ${adb}`);
  note(`${checks.java ? '✓' : '✗'} JDK ${REQUIRED_JAVA_MAJOR}          ${java.command}`);
  note(`${checks.platform ? '✓' : '✗'} Android API ${REQUIRED_ANDROID_API}  ${platformJar}`);
  note(`${checks.signer ? '✓' : '✗'} apksigner       ${signerJar || 'missing'}`);
  note(`${checks.signing ? '✓' : '✗'} signing config ${checks.signing ? 'present' : 'missing (release fails closed)'}`);
  note(`· build endpoint  ${gatewayUrl}`);

  if (checks.adb) {
    const devices = probe(adb, ['devices']);
    const connected = (devices?.stdout || '')
      .split(/\r?\n/)
      .filter(line => /\tdevice$/.test(line));
    note(`${connected.length ? '✓' : '✗'} device          ${connected.join(', ') || 'none attached'}`);
    const tunnels = probe(adb, ['reverse', '--list']);
    const tunnelOpen = (tunnels?.stdout || '').includes(`tcp:${port}`);
    note(`${tunnelOpen ? '✓' : '·'} USB tunnel       ${tunnelOpen ? `tcp:${port} open` : 'not open'}`);
  }

  const health = await gatewayResponds();
  note(`${health ? '✓' : '✗'} gateway         ${health ? 'healthy' : `no response on 127.0.0.1:${port}`}`);
  process.stdout.write('\n');

  if (strict && Object.values(checks).some(value => !value)) {
    die('Strict doctor failed: the release build toolchain is incomplete.');
  }
}

function reverse() {
  const adb = requireAdb();
  runCommand(adb, ['wait-for-device']);
  runCommand(adb, ['reverse', `tcp:${port}`, `tcp:${port}`]);
  note(`✓ tunnel: phone 127.0.0.1:${port} → this host`);
}

function keystore() {
  const keyDir = path.join(APP_DIR, 'keys');
  const keyFile = path.join(keyDir, 'internal.jks');
  const propertiesFile = path.join(ANDROID_DIR, 'keystore.properties');
  if (existsSync(keyFile) || existsSync(propertiesFile)) {
    die(`Signing material already exists (${keyFile} or ${propertiesFile}); rotate it manually.`);
  }

  const java = inspectJava();
  if (java.major !== REQUIRED_JAVA_MAJOR) {
    die(`JDK ${REQUIRED_JAVA_MAJOR} is required; set JAVA_HOME before creating an internal key.`);
  }

  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const password = randomBytes(32).toString('base64url');
  const passwordEnvironmentName = 'C3_ANDROID_GENERATED_KEY_PASSWORD';
  runCommand(javaTool('keytool'), [
    '-genkeypair',
    '-v',
    '-keystore', keyFile,
    '-storetype', 'PKCS12',
    '-alias', 'internal',
    '-keyalg', 'RSA',
    '-keysize', '4096',
    '-validity', '3650',
    '-storepass:env', passwordEnvironmentName,
    '-keypass:env', passwordEnvironmentName,
    '-dname', 'CN=IntentSmith Internal, OU=Mobile, O=IntentSmith, C=CZ',
  ], { env: { ...process.env, [passwordEnvironmentName]: password } });
  writeFileSync(
    propertiesFile,
    `storeFile=../keys/internal.jks\nstorePassword=${password}\nkeyAlias=internal\nkeyPassword=${password}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  try {
    chmodSync(keyDir, 0o700);
    chmodSync(keyFile, 0o600);
    chmodSync(propertiesFile, 0o600);
  } catch {
    // Windows ACLs are not POSIX modes; ignored files and operator ACLs remain authoritative.
  }
  note(`✓ internal signing key created at ${keyFile}`);
  note('· This is not a production key ceremony; back up and govern a release key separately.');
}

function runGradle(javaCommand, args) {
  const wrapperJar = path.join(ANDROID_DIR, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  assertReadable(wrapperJar, `Gradle wrapper is missing: ${wrapperJar}`);
  runCommand(javaCommand, [
    '-Dorg.gradle.appname=gradlew',
    '-classpath', wrapperJar,
    'org.gradle.wrapper.GradleWrapperMain',
    ...args,
  ], { cwd: ANDROID_DIR });
}

async function build({ allowDebugSigning = false } = {}) {
  assertReadable(ANDROID_DIR, `Android project is missing: ${ANDROID_DIR}`);
  const { sdkRoot, java, signerJar } = requireBuildToolchain({ allowDebugSigning });
  writeFileSync(path.join(ANDROID_DIR, 'local.properties'), renderLocalProperties(sdkRoot), 'utf8');

  const capacitorBin = path.join(APP_DIR, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  assertReadable(capacitorBin, 'Capacitor CLI is missing; run `npm --prefix mobile-app ci`.');
  runCommand(process.execPath, [capacitorBin, 'copy', 'android'], { cwd: APP_DIR });
  await prepareAndroidAssets({ gatewayUrl });

  const gradleArgs = ['--no-daemon', ':app:assembleRelease'];
  if (allowDebugSigning) gradleArgs.push('-PallowDebugSigning=true');
  runGradle(java.command, gradleArgs);

  const apk = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  assertReadable(apk, `Signed release APK was not produced at ${apk}.`);
  runCommand(java.command, ['-jar', signerJar, 'verify', '--print-certs', apk]);
  note(`✓ signed APK verified: ${apk}`);
}

function install() {
  const adb = requireAdb();
  const apk = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  assertReadable(apk, `APK is missing; run npm run mobile:android:build first.`);
  runCommand(adb, ['install', '-r', apk]);
  note('✓ installed');
}

function runOnDevice() {
  reverse();
  install();
  const adb = requireAdb();
  runCommand(adb, ['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1']);
  note('✓ launched on device');
}

function parseOptions(args) {
  const command = args[0] || 'doctor';
  const options = new Set(args.slice(1));
  const known = new Set(['--strict', '--debug-signing']);
  for (const option of options) {
    if (!known.has(option)) die(`Unknown option: ${option}`);
  }
  if (options.has('--strict') && command !== 'doctor') {
    die('--strict is valid only with doctor.');
  }
  if (options.has('--debug-signing') && command !== 'build') {
    die('--debug-signing is valid only with build.');
  }
  return { command, strict: options.has('--strict'), allowDebugSigning: options.has('--debug-signing') };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.command === 'doctor') return doctor(options);
  if (options.command === 'reverse') return reverse();
  if (options.command === 'keystore') return keystore();
  if (options.command === 'build') return build(options);
  if (options.command === 'install') return install();
  if (options.command === 'run') return runOnDevice();
  die(`Unknown command: ${options.command} (doctor|reverse|keystore|build|install|run)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Android workflow failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
