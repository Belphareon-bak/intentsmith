// Creation is an explicit operation on a new directory. Import is read-only.
// Repository text is evidence, never execution or approval authority.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { buildProjectContextManifest } from '../code-intel/project-context-manifest.js';
import { readProjectFileBytes } from '../executor/project-path-authority.js';

const exec = promisify(execFile);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const DIRECTORIES = ['public', 'scripts', 'src', 'test'];

export function newProjectPolicy() {
  return {
    policyId: 'intentsmith-local-project-v1',
    layers: [{ name: 'app', roots: DIRECTORIES }],
    rules: [{ from: 'app', canImport: ['app'] }],
    externalImports: [
      'node:assert', 'node:assert/strict', 'node:buffer', 'node:crypto', 'node:events',
      'node:fs', 'node:fs/promises', 'node:http', 'node:https', 'node:os', 'node:path',
      'node:stream', 'node:stream/promises', 'node:test', 'node:timers/promises',
      'node:url', 'node:util',
    ],
    sourceExtensions: ['.cjs', '.js', '.mjs'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'],
    unmappedFilePolicy: 'unavailable',
  };
}

export async function initializeNewProject(root, { name, description = '', type = 'general' }) {
  // mkdir without recursive is the exclusive reservation. Never reuse an
  // existing directory, even an empty one selected by a racing request.
  await fs.mkdir(root);
  try {
    for (const dir of ['.c3', ...DIRECTORIES]) await fs.mkdir(path.join(root, dir));
    const pkg = {
      name: path.basename(root).replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
      version: '0.1.0', private: true, type: 'module', description,
      scripts: { start: 'node src/index.mjs', test: 'node --test test/acceptance.test.mjs' },
    };
    const files = {
      '.gitignore': 'node_modules/\n.env\n.env.*\ndist/\nbuild/\n*.log\n',
      '.c3/project.json': JSON.stringify({ name, description, type, created: new Date().toISOString() }, null, 2) + '\n',
      '.c3/m2-governance-policy.json': JSON.stringify(newProjectPolicy(), null, 2) + '\n',
      'package.json': JSON.stringify(pkg, null, 2) + '\n',
      'README.md': `# ${name}\n\n${description}\n\n## Stav\nZáklad projektu; implementace a funkční ověření ještě chybí.\n\n## Spuštění\nNode.js 22+, bez instalace závislostí: npm start.\nOvěření: npm test. Výchozí test záměrně selže, dokud nevzniknou skutečné assertions.\n`,
      'ROADMAP.md': '# Plán\n\n- [ ] Ujasnit cíl a ověřitelné podmínky dokončení\n- [ ] Navrhnout první použitelný krok\n- [ ] Schválit konkrétní změnu a provést ji\n- [ ] Funkčně ověřit a projít výsledek\n',
      'src/index.mjs': 'console.log("Projekt zatím nemá implementaci. Pokračuj zadáním cíle v IntentSmithu.");\n',
      'test/acceptance.test.mjs': 'import test from "node:test";\ntest("Požadavky projektu zatím nejsou ověřené", () => { throw new Error("Doplň funkční assertions podle cíle projektu."); });\n',
    };
    for (const [file, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, file), content, { flag: 'wx' });
    }
    // This directory is ours and contains only the displayed creation scaffold.
    // Do not run user hooks, signing programs or inherited Git templates.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = '/dev/null';
    const git = args => exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, env, timeout: 10_000 });
    await git(['init', '--template=', '-b', 'main']);
    await git(['add', '--', ...Object.keys(files)]);
    await git(['-c', 'user.name=IntentSmith', '-c', 'user.email=local@intentsmith.invalid',
      '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initialize project for reviewed M2 changes']);
    return Object.keys(files);
  } catch (error) {
    // Keep partial creation for diagnosis. Never delete a directory that could
    // have received user files after the exclusive reservation.
    error.projectPath = root;
    throw error;
  }
}

export async function inspectProject(project, { signal } = {}) {
  const canonicalRoot = await fs.realpath(project.path);
  const manifest = await buildProjectContextManifest({ projectId: project.id, canonicalRoot },
    { signal, deadlineAt: Date.now() + 15_000 });
  const regular = manifest.entries.filter(entry => entry.kind === 'regular@1');
  const isTest = name => /(^|\/)(test|tests)\/|\.(test|spec)\.|(^|\/)test_[^/]+\.py$|(^|\/)[^/]+_test\.(py|go)$/.test(name);
  const priority = entry => /(^|\/)(readme[^/]*|package.json|pyproject.toml|cargo.toml|go.mod)$/i.test(entry.path) ? 0
    : isTest(entry.path) ? 1 : 2;
  const selected = [...regular].sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  const excerpts = [];
  let used = 0;
  for (const entry of selected) {
    if (excerpts.length >= 10 || used >= 24_000) break;
    if (entry.size > 64_000 || /(^|\/)(package-lock|pnpm-lock|yarn.lock)/.test(entry.path)) continue;
    const observation = readProjectFileBytes(canonicalRoot, entry.path,
      { maxBytes: 64_000, requireCanonicalTarget: true, rejectHardlinks: true });
    const bytes = observation.bytes;
    if (!observation.exists || sha(bytes) !== entry.contentDigest) throw Object.assign(new Error('Projekt se během analýzy změnil; zopakuj načtení.'), { code: 'PROJECT_CHANGED' });
    const text = bytes.toString('utf8').slice(0, Math.min(5_000, 24_000 - used));
    excerpts.push({ path: entry.path, text, truncated: text.length < bytes.toString('utf8').length });
    used += text.length;
  }
  const names = regular.map(entry => entry.path);
  const facts = [];
  const gaps = [];
  if (names.some(name => /(^|\/)readme/i.test(name))) facts.push('README je přítomné; popis je tvrzení autora, ne ověření funkčnosti.');
  else gaps.push('Chybí README s cílem a postupem spuštění.');
  if (names.some(isTest)) facts.push('Repozitář obsahuje testovací soubory; testy zatím nebyly spuštěné.');
  else gaps.push('V pozorované části nebyly nalezené testovací soubory.');
  if (names.some(name => /(^|\/)(package.json|pyproject.toml|cargo.toml)$/i.test(name))) facts.push('Je přítomný manifest projektu. Závislosti nebyly instalované.');
  const setup = {};
  for (const name of ['.git', '.c3/m2-governance-policy.json']) {
    try { const st = await fs.lstat(path.join(canonicalRoot, name)); setup[name] = !st.isSymbolicLink(); }
    catch { setup[name] = false; }
  }
  return { projectId: project.id, revision: manifest.revision, fileCount: regular.length,
    files: names.slice(0, 250), fileListTruncated: names.length > 250, excerpts, facts, gaps,
    setup, scope: 'Bounded static inspection; no project commands, tests or dependency installation.' };
}

export function importedProjectWelcome(project, analysis) {
  const lines = [`Otevřel jsem projekt **${project.name}** bez změn jeho souborů.`];
  if (analysis) {
    lines.push(`Prošel jsem inventář ${analysis.fileCount} textových souborů a ${analysis.excerpts.length} vybraných ukázek.`,
      ...analysis.facts.map(fact => `• ${fact}`), ...analysis.gaps.map(gap => `• ${gap}`),
      'Tohle je úvodní statický přehled, nikoli ověřený audit celé aplikace.');
  } else lines.push('Bezpečné načtení analýzy se nepodařilo; obsah projektu zatím nehodnotím.');
  lines.push('', 'Jaký je zamýšlený cíl projektu a čím chceš pokračovat? Z podkladů navrhnu priority, uvedu nedostatky i silné stránky a odliším ověřené skutečnosti od předpokladů.');
  return lines.join('\n');
}
