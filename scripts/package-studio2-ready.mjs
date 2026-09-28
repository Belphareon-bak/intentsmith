#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[2] === '--seal') {
  const folder = path.resolve(process.argv[3]);
  await fs.access(path.join(folder, 'SOURCE.json'));
  await fs.writeFile(path.join(folder, 'SHA256SUMS'), (await hashes(folder)).join('\n') + '\n');
  console.log('SEALED ' + folder);
  process.exit(0);
}
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, ...options });
const revision = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (run('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('Package requires a clean source commit.');
if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node 24.');
const output = path.resolve(process.argv[2] || path.join(root, '.intentsmith-artifacts', 'studio2-ready-' + revision.slice(0, 8)));
try { await fs.access(output); throw Error('Output already exists: ' + output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const source = path.join(output, 'source'); await fs.mkdir(source);
run('tar', ['-x', '-C', source], { input: run('git', ['archive', revision], { maxBuffer: 128 * 1024 * 1024 }), maxBuffer: 128 * 1024 * 1024 });
await fs.cp(await fs.realpath(path.join(root, 'node_modules')), path.join(source, 'node_modules'), { recursive: true, dereference: true });
await fs.mkdir(path.join(output, 'runtime', 'bin'), { recursive: true });
await fs.copyFile(process.execPath, path.join(output, 'runtime', 'bin', 'node'));
await fs.chmod(path.join(output, 'runtime', 'bin', 'node'), 0o755);
await fs.copyFile(path.join(root, 'intentsmith-ide/applications/electron/dist/IntentSmith-0.1.0.AppImage'), path.join(output, 'IntentSmith-Studio2.AppImage'));
await fs.chmod(path.join(output, 'IntentSmith-Studio2.AppImage'), 0o755);
for (const [from, to] of [['studio2-run-trial.sh', 'run-trial.sh'], ['studio2-run-with-data.sh', 'run-with-data.sh']]) {
  await fs.copyFile(path.join(source, 'scripts', from), path.join(output, to)); await fs.chmod(path.join(output, to), 0o755);
}
await fs.writeFile(path.join(output, 'run-live-preview.sh'), `#!/usr/bin/env bash\nset -euo pipefail\nPACKAGE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexport INTENTSMITH_STUDIO2_APPIMAGE="$PACKAGE_DIR/IntentSmith-Studio2.AppImage"\nexport PATH="$PACKAGE_DIR/runtime/bin:$PATH"\nexport INTENTSMITH_NODE24_BIN="$PACKAGE_DIR/runtime/bin/node"\nexport INTENTSMITH_STUDIO2_PROFILE="\${INTENTSMITH_STUDIO2_PROFILE:-$HOME/.local/share/intentsmith-studio2-live}"\nexec "$PACKAGE_DIR/source/scripts/studio2-live-data-preview.sh" "$@"\n`, { mode: 0o755 });
const tracked = run('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const relative of tracked) {
  const a = await fs.readFile(path.join(root, relative)), b = await fs.readFile(path.join(source, relative));
  if (!a.equals(b)) throw Error('Source mismatch: ' + relative);
}
await fs.writeFile(path.join(output, 'SOURCE.json'), JSON.stringify({ sourceRevision: revision, trackedFilesVerified: tracked.length, node: process.versions.node, theia: '1.76.0', react: '19.3.0' }, null, 2) + '\n');
await fs.writeFile(path.join(output, 'README.md'), `# IntentSmith Studio 2\n\nZdroj: ${revision}. Balík obsahuje AppImage, backend, závislosti a trvalý Node 24.\n\n## Spuštění s vašimi daty\n\nSpusťte \`./run-with-data.sh\`. Při prvním spuštění vytvoří konzistentní kopii databáze původního IDE a otevře ji na backendu z tohoto balíku. Originál databáze se nemigruje ani nepřepisuje. Nové zprávy a nastavení se ukládají do profilu \`~/.local/share/intentsmith-studio2\`. Cesty původních projektů jsou skutečné: schválené operace se provedou v těchto projektech.\n\nJinou zdrojovou DB nastaví \`INTENTSMITH_STUDIO2_SOURCE_DB=/úplná/cesta\`. Prázdný profil otevře \`./run-trial.sh\`. Vlastní profil nastaví \`INTENTSMITH_STUDIO2_TRIAL_DIR\`. Modely používají lokální Ollamu, výchozí adresa je http://127.0.0.1:11434.\n\n## Připojení k běžícímu backendu\n\n\`./run-live-preview.sh\` otevře nové UI nad původní živou databází. Funkce vyžadující nový backend jsou plně dostupné přes \`run-with-data.sh\`; připojení k starší verzi backendu ji neaktualizuje.\n\nStudio 2 se otevře přímo. Klasický frontend v balíku není. Výsledky ověření jsou v \`TEST-RESULTS.json\` a \`evidence/\`. Kontrolní součty ověří \`sha256sum -c SHA256SUMS\`.\n`);
async function hashes(folder, prefix = '') {
  const entries = await fs.readdir(folder, { withFileTypes: true }), out = [];
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name, absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) out.push(...await hashes(absolute, relative + '/'));
    else if (entry.isFile() && relative !== 'SHA256SUMS') out.push(createHash('sha256').update(await fs.readFile(absolute)).digest('hex') + '  ' + relative);
    else if (!entry.isFile()) throw Error('Nonportable package entry: ' + relative);
  }
  return out;
}
await fs.writeFile(path.join(output, 'SHA256SUMS'), (await hashes(output)).join('\n') + '\n');
console.log(JSON.stringify({ output, revision, trackedFilesVerified: tracked.length }));
