import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createProcessSandboxProvider, processSandboxProvider } from './process-sandbox-provider.js';

const MAX_BYTES = 65536;
const keys = (value, expected) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const fail = detail => { throw new TypeError(`m2-private-http-config:${detail}`); };
const validReference = ref => keys(ref, ['canonicalPath', 'bytes', 'digest', 'device', 'inode'])
  && typeof ref.canonicalPath === 'string' && ref.canonicalPath.startsWith('/') && ref.canonicalPath !== '/'
  && path.posix.resolve(ref.canonicalPath) === ref.canonicalPath && ref.canonicalPath === ref.canonicalPath.normalize('NFC')
  && !ref.canonicalPath.includes('\0') && Buffer.byteLength(ref.canonicalPath, 'utf8') <= 4096
  && Buffer.from(ref.canonicalPath, 'utf8').toString('utf8') === ref.canonicalPath
  && Number.isSafeInteger(ref.bytes) && ref.bytes >= 1 && ref.bytes <= 1073741824
  && typeof ref.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(ref.digest)
  && typeof ref.device === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(ref.device)
  && BigInt(ref.device) <= 0xffffffffffffffffn
  && typeof ref.inode === 'string' && /^[1-9][0-9]{0,19}$/.test(ref.inode)
  && BigInt(ref.inode) <= 0xffffffffffffffffn;

// Operator startup trust references only. This file grants no process authority:
// the complete matching profile/policy must still be in the exact approved DTO.
export async function processProviderFromTrustedPrivateHttpConfig(candidate) {
  if (candidate === undefined || candidate === null || candidate === '') return processSandboxProvider;
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') fail('linux-required');
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || path.normalize(candidate) !== candidate
    || candidate === '/' || candidate !== candidate.normalize('NFC') || candidate.includes('\0')
    || candidate.includes('\\') || Buffer.byteLength(candidate, 'utf8') > 4096) fail('invalid-canonical-path');
  if (await realpath(candidate) !== candidate) fail('symlink-or-alias-path');
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid())
      || ![0o400n, 0o600n].includes(before.mode & 0o7777n) || before.size < 1n || before.size > BigInt(MAX_BYTES)) fail('file-owner-mode-or-size');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) fail('read-budget-exceeded');
    const bytes = buffer.subarray(0, length);
    const after = await handle.stat({ bigint: true });
    if (bytes.length !== Number(before.size) || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) fail('changed-during-read');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail('invalid-utf8');
    let config; try { config = JSON.parse(text); } catch { fail('invalid-json'); }
    if (!keys(config, ['kind', 'privateHttpTrustedArtifacts', 'privateHttpStdioRelay'])
      || config.kind !== 'M2PrivateHttpTrustedArtifacts@1'
      || !keys(config.privateHttpTrustedArtifacts, ['launcher', 'ip', 'nft', 'runtimeExecutable', 'oracle'])
      || !keys(config.privateHttpStdioRelay, ['canonicalPath', 'bytes', 'digest', 'device', 'inode'])) fail('invalid-config-shape');
    if (!Object.values(config.privateHttpTrustedArtifacts).every(validReference)
      || !validReference(config.privateHttpStdioRelay)
      || config.privateHttpTrustedArtifacts.ip.canonicalPath !== '/usr/bin/ip'
      || config.privateHttpTrustedArtifacts.nft.canonicalPath !== '/usr/sbin/nft'
      || new Set(Object.values(config.privateHttpTrustedArtifacts).map(ref => ref.canonicalPath)).size !== 5) fail('invalid-trusted-reference');
    // Values are validated here; the provider freezes them and checks actual FDs at preflight.
    return createProcessSandboxProvider({ privateHttpTrustedArtifacts: config.privateHttpTrustedArtifacts,
      privateHttpStdioRelay: config.privateHttpStdioRelay });
  } finally { await handle.close(); }
}
