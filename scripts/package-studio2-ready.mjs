#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROTECTED_COMPONENT = /^(?:restricted|holdout|h1|h2)(?:[._-]|$)/i;
const PROTECTED_SOURCE = 'docs/review/evidence/chat-quality-20261001/holdout-candidate-full-profile.json';
export function protectedPath(relative) {
  return relative === PROTECTED_SOURCE || relative.split(/[\\/]/).some(part => PROTECTED_COMPONENT.test(part));
}
function relativeFile(relative) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || /[\\\0\r\n]/.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid source path.');
  return relative;
}
export function selectTrackedMetadata(raw) {
  const selected = [], excluded = [], seen = new Set();
  for (const row of raw.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(row);
    if (!match) throw Error('Package requires regular committed source files.');
    const relative = relativeFile(match[3]);
    if (seen.has(relative)) throw Error('Duplicate source metadata.');
    seen.add(relative);
    const entry = { path: relative, mode: match[1], blob: match[2] };
    (protectedPath(relative) ? excluded : selected).push(entry);
  }
  if (!selected.length) throw Error('Empty selected source.');
  selected.sort((a,b) => a.path.localeCompare(b.path)); excluded.sort((a,b) => a.path.localeCompare(b.path));
  return { selected, excluded, metadataFiles: seen.size, exclusionAppliedBeforeArchiveOrContentRead: true };
}
async function regular(file) {
  if (protectedPath(file)) throw Error('Protected entry must be absent: ' + file);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw Error('Regular file required: ' + file);
  return stat;
}
async function digest(file) {
  await regular(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function validateAppImageBuild(source, revision, selection, receipt, artifactOverride) {
  if (receipt?.status !== 'BUILD_PASS' || receipt.sourceRevision !== revision || !String(receipt.node).startsWith('24.'))
    throw Error('AppImage build must match the clean candidate and Node 24.');
  const paths = selection.selected.filter(row => row.path.startsWith('intentsmith-ide/')).map(row => row.path);
  if (!paths.length || !Array.isArray(receipt.studioSourceFiles)
    || JSON.stringify(receipt.studioSourceFiles.map(row => row.path)) !== JSON.stringify(paths))
    throw Error('AppImage build source coverage mismatch.');
  for (const row of receipt.studioSourceFiles) {
    relativeFile(row.path);
    if (protectedPath(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256)
      || await digest(path.join(source, row.path)) !== row.sha256) throw Error('AppImage build input mismatch: ' + row.path);
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length !== 2
    || JSON.stringify(receipt.commands.map(row => row.kind)) !== JSON.stringify(['STUDIO_BUILD', 'APPIMAGE_DIST'])
    || receipt.commands.some(row => row.exitCode !== 0 || row.timedOut !== false || row.cleanupTerminated !== true
      || !Array.isArray(row.argv) || !row.argv.length || !/^[a-f0-9]{64}$/.test(row.logSha256))
    || receipt.sourceCleanAfter !== true) throw Error('Successful native Studio/AppImage build commands required.');
  const image = artifactOverride || receipt.artifact?.path;
  if (typeof image !== 'string' || !path.isAbsolute(image) || !Number.isSafeInteger(receipt.artifact?.size)
    || receipt.artifact.size <= 0 || !/^[a-f0-9]{64}$/.test(receipt.artifact?.sha256)) throw Error('AppImage artifact identity missing.');
  const stat = await regular(image);
  if (stat.size !== receipt.artifact.size || await digest(image) !== receipt.artifact.sha256) throw Error('AppImage build artifact mismatch.');
  return image;
}

export async function packageStudioReady(argv = process.argv.slice(2), sourceRoot = root) {
const root = sourceRoot;
if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node 24.');
if (argv[0] === '--seal') {
  const folder = path.resolve(argv[1]);
  if (argv.length !== 2) throw Error('Use --seal PACKAGE_DIR.');
  await regular(path.join(folder, 'SOURCE.json'));
  const metadata = JSON.parse(await fs.readFile(path.join(folder, 'SOURCE.json'), 'utf8'));
  const receiptPath = path.join(folder, 'APPIMAGE-BUILD.json');
  if (await digest(receiptPath) !== metadata.appImageBuildReceiptSha256) throw Error('Build receipt changed.');
  await validateAppImageBuild(path.join(folder, 'source'), metadata.sourceRevision, metadata.sourceSelection,
    JSON.parse(await fs.readFile(receiptPath, 'utf8')), path.join(folder, 'IntentSmith-Studio2.AppImage'));
  await fs.writeFile(path.join(folder, 'SHA256SUMS'), (await hashes(folder)).join('\n') + '\n');
  console.log('SEALED ' + folder);
  return;
}
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, ...options });
const revision = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const selection = selectTrackedMetadata(run('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }));
if (run('git', ['status', '--porcelain', '--untracked-files=no', '--', ...selection.selected.map(row => ':(literal)' + row.path)], { encoding: 'utf8' }).trim()) throw Error('Package requires a clean selected source commit.');
if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node 24.');
const buildArg = argv.find(arg => arg.startsWith('--appimage-build='));
if (!buildArg || argv.filter(arg => arg.startsWith('--appimage-build=')).length !== 1 || argv.length > 2)
  throw Error('Use [OUTPUT] --appimage-build=ABSOLUTE_BUILD_RECEIPT.');
const receiptPath = buildArg.slice('--appimage-build='.length);
if (!path.isAbsolute(receiptPath)) throw Error('Absolute build receipt required.');
await regular(receiptPath);
const buildBytes = await fs.readFile(receiptPath), buildReceipt = JSON.parse(buildBytes);
const appImage = await validateAppImageBuild(root, revision, selection, buildReceipt);
const outputArg = argv.find(arg => arg !== buildArg);
const output = path.resolve(outputArg || path.join(root, '.intentsmith-artifacts', 'studio2-ready-' + revision.slice(0, 8)));
if (protectedPath(output)) throw Error('Protected package output path.');
try { await fs.access(output); throw Error('Output already exists: ' + output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const source = path.join(output, 'source'); await fs.mkdir(source);
run('tar', ['-x', '-C', source], { input: run('git', ['archive', revision, '--', ...selection.selected.map(row => ':(literal)' + row.path)], { maxBuffer: 128 * 1024 * 1024 }), maxBuffer: 128 * 1024 * 1024 });
const runtimeExclusions = [];
const copyRuntime = async (from, to) => fs.cp(from, to, { recursive: true, dereference: true, filter: async original => {
  const relative = path.relative(from, original);
  if (protectedPath(relative) || protectedPath(await fs.realpath(original))) { runtimeExclusions.push({ runtime: path.basename(to), relative }); return false; }
  return true;
}});
await copyRuntime(await fs.realpath(path.join(root, 'node_modules')), path.join(source, 'node_modules'));
await fs.mkdir(path.join(output, 'runtime', 'bin'), { recursive: true });
await fs.copyFile(process.execPath, path.join(output, 'runtime', 'bin', 'node'));
await fs.chmod(path.join(output, 'runtime', 'bin', 'node'), 0o755);
// Include the existing pinned local document runtimes. Never install globally
// or depend on the launcher's isolated HOME finding an old user environment.
const pdfPython = process.env.INTENTSMITH_PDF_PYTHON || path.join(homedir(), '.local/share/intentsmith/python/pdf/bin/python');
const pdfRuntime = path.dirname(path.dirname(pdfPython));
const accountantRuntime = process.env.UCETNI_RUNTIME_DIR || path.join(homedir(), '.local/share/ucetni');
run(pdfPython, ['-c', 'import importlib.metadata as m; assert [m.version(x) for x in ("reportlab","pillow","charset-normalizer")] == ["5.0.0","12.3.0","3.4.4"]'], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
run(path.join(accountantRuntime, 'venv/bin/python'), ['-c', 'import tesserocr,pypdf,PIL,lxml,reportlab,pillow_heif'], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
await copyRuntime(pdfRuntime, path.join(output, 'runtime/pdf'));
await copyRuntime(accountantRuntime, path.join(output, 'runtime/accountant'));
await fs.copyFile(appImage, path.join(output, 'IntentSmith-Studio2.AppImage'));
await fs.writeFile(path.join(output, 'APPIMAGE-BUILD.json'), buildBytes, { flag: 'wx', mode: 0o600 });
await fs.chmod(path.join(output, 'IntentSmith-Studio2.AppImage'), 0o755);
for (const [from, to] of [['studio2-run-trial.sh', 'run-trial.sh'], ['studio2-run-with-data.sh', 'run-with-data.sh']]) {
  await fs.copyFile(path.join(source, 'scripts', from), path.join(output, to)); await fs.chmod(path.join(output, to), 0o755);
}
await fs.writeFile(path.join(output, 'run-live-preview.sh'), `#!/usr/bin/env bash\nset -euo pipefail\nPACKAGE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexport INTENTSMITH_STUDIO2_APPIMAGE="$PACKAGE_DIR/IntentSmith-Studio2.AppImage"\nexport PATH="$PACKAGE_DIR/runtime/bin:$PATH"\nexport INTENTSMITH_NODE24_BIN="$PACKAGE_DIR/runtime/bin/node"\nexport INTENTSMITH_STUDIO2_PROFILE="\${INTENTSMITH_STUDIO2_PROFILE:-$HOME/.local/share/intentsmith-studio2-live}"\nexec "$PACKAGE_DIR/source/scripts/studio2-live-data-preview.sh" "$@"\n`, { mode: 0o755 });
const tracked = selection.selected.map(row => row.path);
for (const relative of tracked) {
  await regular(path.join(root, relative)); await regular(path.join(source, relative));
  const a = await fs.readFile(path.join(root, relative)), b = await fs.readFile(path.join(source, relative));
  if (!a.equals(b)) throw Error('Source mismatch: ' + relative);
}
await validateAppImageBuild(source, revision, selection, buildReceipt, path.join(output, 'IntentSmith-Studio2.AppImage'));
await fs.writeFile(path.join(output, 'SOURCE.json'), JSON.stringify({ sourceRevision: revision, trackedFilesVerified: tracked.length, sourceSelection: selection, appImageBuildReceiptSha256: createHash('sha256').update(buildBytes).digest('hex'), appImage: { sha256: buildReceipt.artifact.sha256, size: buildReceipt.artifact.size, buildSourceRevision: buildReceipt.sourceRevision }, runtimeExclusions, scope: 'CANDIDATE_PACKAGE_EXISTING_DEPENDENCIES_NOT_RELEASE_ACCEPTANCE', node: process.versions.node, theia: '1.76.0', react: '19.3.0' }, null, 2) + '\n');
await fs.writeFile(path.join(output, 'README.md'), `# IntentSmith Studio 2\n\nZdroj: ${revision}. Balík obsahuje AppImage, backend, závislosti, trvalý Node 24 a PDF/OCR prostředí. Python vyžaduje CPython 3.12 a systémové PDF utility ověřované stanice.\n\n## Spuštění s vašimi daty\n\nSpusťte \`./run-with-data.sh\`. Při prvním spuštění vytvoří konzistentní kopii databáze původního IDE a otevře ji na backendu z tohoto balíku. Originál databáze se nemigruje ani nepřepisuje. Nové zprávy a nastavení se ukládají do profilu \`~/.local/share/intentsmith-studio2\`. Cesty původních projektů jsou skutečné: schválené operace se provedou v těchto projektech.\n\nJinou zdrojovou DB nastaví \`INTENTSMITH_STUDIO2_SOURCE_DB=/úplná/cesta\`. Prázdný profil otevře \`./run-trial.sh\`. Vlastní profil nastaví \`INTENTSMITH_STUDIO2_TRIAL_DIR\`. Modely používají lokální Ollamu, výchozí adresa je http://127.0.0.1:11434.\n\n## Připojení k běžícímu backendu\n\n\`./run-live-preview.sh\` otevře nové UI nad původní živou databází. Funkce vyžadující nový backend jsou plně dostupné přes \`run-with-data.sh\`; připojení k starší verzi backendu ji neaktualizuje.\n\nStudio 2 se otevře přímo. Klasický frontend v balíku není. Výsledky ověření jsou v \`TEST-RESULTS.json\` a \`evidence/\`. Kontrolní součty ověří \`sha256sum -c SHA256SUMS\`.\n`);
await fs.writeFile(path.join(output, 'SHA256SUMS'), (await hashes(output)).join('\n') + '\n');
console.log(JSON.stringify({ output, revision, trackedFilesVerified: tracked.length }));

}

export async function hashes(folder, prefix = '') {
  const entries = await fs.readdir(folder, { withFileTypes: true }), out = [];
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name, absolute = path.join(folder, entry.name);
    if (protectedPath(relative)) throw Error('Protected package entry must be absent: ' + relative);
    if (entry.isDirectory()) out.push(...await hashes(absolute, relative + '/'));
    else if (entry.isFile() && relative !== 'SHA256SUMS') out.push(await digest(absolute) + '  ' + relative);
    else if (!entry.isFile()) throw Error('Nonportable package entry: ' + relative);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageStudioReady();
}
