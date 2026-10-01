import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const digest = file => {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
};

// This verifies every declared package byte and rejects undeclared actual
// files before any packaged executable is launched. The manifest hash itself
// is pinned by CONFIG.json and by the operator's explicit live config pin.
export function verifyPackageMembers(packageDir, expectedManifestSha256) {
  assert.ok(path.isAbsolute(packageDir) && fs.realpathSync(packageDir) === packageDir,
    'canonical package directory');
  assert.match(expectedManifestSha256, /^[0-9a-f]{64}$/);
  const manifest = path.join(packageDir, 'SHA256SUMS');
  assert.ok(fs.lstatSync(manifest).isFile(), 'regular package SHA256SUMS');
  assert.equal(digest(manifest), expectedManifestSha256, 'pinned package manifest bytes');
  const lines = fs.readFileSync(manifest, 'utf8').trimEnd().split('\n');
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^\r\n]+)$/.exec(line);
    assert.ok(match, 'canonical SHA256SUMS row');
    const name = match[2];
    assert.ok(!path.posix.isAbsolute(name) && name !== 'SHA256SUMS'
      && path.posix.normalize(name) === name && !name.split('/').includes('..')
      && !name.split('/').includes('.') && !name.includes('\\')
      && !expected.has(name), 'unique package-relative member');
    expected.set(name, match[1]);
  }
  assert.ok(expected.size > 0, 'nonempty package manifest');
  const actual = new Set();
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(packageDir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(packageDir, name);
      const stat = fs.lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, 'package symlink denied: ' + name);
      if (stat.isDirectory()) walk(name);
      else {
        assert.ok(stat.isFile(), 'package member must be regular: ' + name);
        if (name !== 'SHA256SUMS') actual.add(name);
      }
    }
  };
  walk('');
  assert.equal(actual.size, expected.size, 'package member count equals manifest');
  for (const name of actual) assert.ok(expected.has(name), 'undeclared package member: ' + name);
  for (const name of expected.keys()) assert.ok(actual.has(name), 'missing package member: ' + name);
  execFileSync('/usr/bin/sha256sum', ['--check', '--status', 'SHA256SUMS'], {
    cwd: packageDir, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    timeout: 180000, maxBuffer: 4096,
  });
  return Object.freeze({ manifestSha256: expectedManifestSha256,
    memberCount: expected.size, packageDir });
}
