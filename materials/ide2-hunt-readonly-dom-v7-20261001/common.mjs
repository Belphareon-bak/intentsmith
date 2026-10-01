// Private preparation only. No code in this module opens a DB or contacts a provider.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'CONFIG.json')));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileSha = p => sha(fs.readFileSync(p));
export const save = (out, name, value) => {
  const target = path.join(out, name), temp = target + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, target);
};
export const inherited = () => Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function git(cwd, args) {
  return execFileSync('/usr/bin/git', args, {cwd, encoding: 'utf8', timeout: 30_000,
    env: {...inherited(), HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}}).trim();
}
export function sourceIdentity() {
  for (const [cwd, wanted] of [[CONFIG.stage, CONFIG.stageHead], [CONFIG.backend, CONFIG.backendHead]]) {
    assert.equal(git(cwd, ['rev-parse', 'HEAD']), wanted);
    assert.equal(git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  }
  assert.equal(fileSha(path.join(CONFIG.package, 'IntentSmith-Studio2.AppImage')), CONFIG.appImageSha256);
  assert.equal(fileSha(path.join(CONFIG.package, 'SHA256SUMS')), CONFIG.packageManifestSha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(CONFIG.package, 'SOURCE.json'))).sourceRevision, CONFIG.packageSource);
  for (const row of CONFIG.sourcePaths) {
    assert.equal(fileSha(path.join(CONFIG.backend, row.path)), row.sha256);
    assert.equal(fileSha(path.join(CONFIG.package, 'source', row.path)), row.sha256);
    assert.equal(sha(execFileSync('/usr/bin/git', ['show', CONFIG.packageSource + ':' + row.path], {cwd: CONFIG.backend})), row.sha256);
  }
  for (const [name, wanted] of Object.entries(CONFIG.helpers)) assert.equal(fileSha(path.join(ROOT, name)), wanted);
  return {packageSource: CONFIG.packageSource, backendSource: CONFIG.backendHead,
    appImageSha256: CONFIG.appImageSha256, relevantSourcePaths: CONFIG.sourcePaths,
    nodeSha256: fileSha(CONFIG.node), noSourceWrites: true};
}
