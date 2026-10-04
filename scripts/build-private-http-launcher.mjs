#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdtemp, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { M2_PRIVATE_HTTP_PROFILE, M2_PRIVATE_HTTP_SECCOMP_DIGEST } from '../contracts/m2/execution-v2.js';

const SOURCE = fileURLToPath(new URL('../src/execution/private-http-launcher.c', import.meta.url));
const SOURCE_SHA256 = '4701119ffc3fd0c55b1099fbb113fedf7a1fc27aa924e799e4920ffc110641e0';
const BUILD_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function check(value, detail) { if (!value) throw new Error(`private-http-build:${detail}`); }
async function artifact(candidate) {
  const canonicalPath = await realpath(candidate);
  const bytes = await readFile(canonicalPath);
  const meta = await stat(canonicalPath, { bigint: true });
  check(meta.isFile(), 'non-regular-artifact');
  return { canonicalPath, bytes: bytes.length, digest: `sha256:${sha(bytes)}`,
    device: meta.dev.toString(), inode: meta.ino.toString() };
}
function elfProof(bytes) {
  check(bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))
    && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === 62, 'linux-x64-elf');
  const programOffset = Number(bytes.readBigUInt64LE(32));
  const programSize = bytes.readUInt16LE(54), programCount = bytes.readUInt16LE(56);
  check(programSize >= 56 && programOffset + programSize * programCount <= bytes.length, 'program-bounds');
  for (let index = 0; index < programCount; index++) {
    check(![2, 3].includes(bytes.readUInt32LE(programOffset + index * programSize)), 'dynamic-or-interpreted-launcher');
  }
  const sectionOffset = Number(bytes.readBigUInt64LE(40));
  const sectionSize = bytes.readUInt16LE(58), sectionCount = bytes.readUInt16LE(60);
  const stringsIndex = bytes.readUInt16LE(62);
  check(sectionSize >= 64 && sectionOffset + sectionSize * sectionCount <= bytes.length
    && stringsIndex < sectionCount, 'section-bounds');
  const header = sectionOffset + stringsIndex * sectionSize;
  const stringsOffset = Number(bytes.readBigUInt64LE(header + 24));
  const stringsSize = Number(bytes.readBigUInt64LE(header + 32));
  check(stringsOffset + stringsSize <= bytes.length, 'string-bounds');
  const names = bytes.subarray(stringsOffset, stringsOffset + stringsSize);
  let filter = null;
  for (let index = 0; index < sectionCount; index++) {
    const start = sectionOffset + index * sectionSize;
    const nameOffset = bytes.readUInt32LE(start);
    check(nameOffset < names.length, 'section-name-bounds');
    const nameEnd = names.indexOf(0, nameOffset);
    check(nameEnd >= 0, 'section-name-termination');
    if (names.subarray(nameOffset, nameEnd).toString('ascii') !== '.m2_seccomp') continue;
    check(filter === null, 'duplicate-seccomp-section');
    const offset = Number(bytes.readBigUInt64LE(start + 24)), size = Number(bytes.readBigUInt64LE(start + 32));
    check(size === 312 && offset + size <= bytes.length, 'seccomp-section-bounds');
    filter = bytes.subarray(offset, offset + size);
  }
  check(filter !== null && `sha256:${sha(filter)}` === M2_PRIVATE_HTTP_SECCOMP_DIGEST, 'seccomp-bytes');
  return { architecture: 'x64', static: true, seccompBytes: filter.length,
    seccompProgramDigest: M2_PRIVATE_HTTP_SECCOMP_DIGEST };
}

check(process.platform === 'linux' && process.arch === 'x64', 'linux-x64-required');
check(process.argv.length === 4 && process.argv[2] === '--output', 'usage--output-absolute-path');
const output = process.argv[3];
check(path.isAbsolute(output) && path.normalize(output) === output && output === output.normalize('NFC')
  && !output.includes('\0') && !output.includes('\\') && Buffer.from(output).toString() === output, 'canonical-output');
check(await realpath(path.dirname(output)) === path.dirname(output), 'canonical-output-parent');
for (const candidate of [output, `${output}.build.json`]) {
  try { await lstat(candidate); throw new Error('private-http-build:output-already-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const source = await artifact(SOURCE);
check(source.digest === `sha256:${SOURCE_SHA256}`, 'reviewed-source-drift');
const compiler = await artifact('/usr/bin/gcc');
const compilerVersion = spawnSync(compiler.canonicalPath, ['--version'], { encoding: 'utf8', env: BUILD_ENV, timeout: 5000, maxBuffer: 16384 });
check(compilerVersion.status === 0 && !compilerVersion.error, 'compiler-version');
const temporary = await mkdtemp(path.join(path.dirname(output), '.m2-private-http-build-'));
const binaryPath = path.join(temporary, 'private-http-launcher');
const argv = ['-std=c11', '-O2', '-static', '-no-pie', '-Wall', '-Wextra', '-Werror', '-Wformat=2',
  '-fstack-protector-strong', '-D_FORTIFY_SOURCE=3', '-fno-ident', '-Wl,--build-id=none,-z,noexecstack',
  source.canonicalPath, '-o', binaryPath];
let published = false;
try {
  const result = spawnSync(compiler.canonicalPath, argv, { env: BUILD_ENV, encoding: 'utf8', timeout: 60000, maxBuffer: 65536 });
  check(result.status === 0 && !result.error, `compiler-failed:${result.stderr || result.error?.code}`);
  check((await artifact(SOURCE)).digest === source.digest, 'source-changed-during-build');
  const proof = elfProof(await readFile(binaryPath));
  await chmod(binaryPath, 0o500);
  await link(binaryPath, output); published = true;
  await unlink(binaryPath);
  const binary = await artifact(output);
  const receipt = { schemaVersion: 1, profile: M2_PRIVATE_HTTP_PROFILE, source, binary, compiler,
    compilerVersion: compilerVersion.stdout.split('\n')[0], argv: [compiler.canonicalPath, ...argv],
    argvDigest: `sha256:${sha(Buffer.from(JSON.stringify([compiler.canonicalPath, ...argv])))}`,
    buildEnvironment: BUILD_ENV, proof, nativeExecuted: false, networkExecuted: false };
  await writeFile(`${output}.build.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  process.stdout.write(JSON.stringify(receipt) + '\n');
} catch (error) {
  if (published) await unlink(output).catch(() => {});
  throw error;
} finally { await rm(temporary, { recursive: true, force: true }); }
