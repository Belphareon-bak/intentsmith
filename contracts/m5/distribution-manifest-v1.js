import { createHash } from 'node:crypto';
import path from 'node:path';

export const M5_DISTRIBUTION_MANIFEST = Object.freeze({
  contract: 'IntentSmithDistributionManifest',
  version: 1,
  runtimeRoots: Object.freeze([
    'agent-extensions',
    'bin',
    'c3-ide',
    'contracts',
    'marketplace',
    'scripts',
    'skills',
    'specialists',
    'src',
  ]),
  rootFiles: Object.freeze(['package.json']),
  contentExtensions: Object.freeze([
    '.cjs', '.css', '.html', '.js', '.json', '.mjs', '.py', '.sh', '.toml',
    '.ts', '.tsx', '.yaml', '.yml',
  ]),
});

export const M5_DISTRIBUTION_MANIFEST_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify(M5_DISTRIBUTION_MANIFEST), 'utf8')
  .digest('hex')}`;

const RUNTIME_ROOTS = new Set(M5_DISTRIBUTION_MANIFEST.runtimeRoots);
const ROOT_FILES = new Set(M5_DISTRIBUTION_MANIFEST.rootFiles);
const CONTENT_EXTENSIONS = new Set(M5_DISTRIBUTION_MANIFEST.contentExtensions);

export function isM5DistributedContentPath(filePath) {
  if (typeof filePath !== 'string' || filePath === '') return false;
  if (ROOT_FILES.has(filePath)) return true;
  const slash = filePath.indexOf('/');
  if (slash < 1 || !RUNTIME_ROOTS.has(filePath.slice(0, slash))) return false;
  return CONTENT_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}
