// v67.0 — README-First: Auto-generate project README.md
// ══════════════════════════════════════════════════════════════════════════════
//
// Scans project directory and generates a structured README.md with:
// - Project name + description
// - Directory structure (top 2 levels)
// - Detected stack (package.json, Cargo.toml, go.mod, etc.)
// - Available scripts
// - Entry points
//
// Used by Context Init for first-turn project understanding.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../../../core/logger.js';

// Files/dirs to ignore when scanning
const IGNORE = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.cache', '.next',
  'dist', 'build', 'target', '.idea', '.vscode', '.DS_Store',
  'coverage', '.nyc_output', 'vendor', '.terraform',
]);

/**
 * Generate README.md content for a project directory.
 *
 * @param {string} projectPath — Absolute path to project root
 * @param {Object} [opts]
 * @param {string} [opts.name] — Project name (default: dirname)
 * @param {string} [opts.description] — Project description
 * @param {Object} [opts.spec] — Lifecycle spec (goals, requirements, architecture, design_decisions)
 * @returns {string} — README.md content
 */
export function generateReadme(projectPath, opts = {}) {
  const name = opts.name || path.basename(projectPath);
  const description = opts.description || '';
  const spec = opts.spec || null;

  const sections = [];
  sections.push(`# ${name}\n`);

  // ─── Spec-aware: rich description from goals ──────────────────────────
  if (spec && spec.goals && spec.goals.length > 0) {
    const goalsText = spec.goals
      .map(g => typeof g === 'string' ? g : (g.description || g.goal || g.name || ''))
      .filter(Boolean);
    if (goalsText.length > 0) {
      sections.push(`## Popis\n`);
      sections.push(goalsText.join('. ') + '\n');
    }
  } else if (description) {
    sections.push(`${description}\n`);
  }

  // ─── Spec-aware: Installation & Usage from tech_stack ─────────────────
  if (spec) {
    const installSteps = _generateInstallSection(projectPath, spec);
    if (installSteps) {
      sections.push(`## Instalace & spuštění\n`);
      sections.push(installSteps + '\n');
    }
  }

  // ─── Spec-aware: Architecture from spec.architecture ──────────────────
  if (spec && spec.architecture) {
    sections.push(`## Architektura\n`);
    const arch = spec.architecture;
    if (arch.description) sections.push(arch.description + '\n');
    if (arch.components && arch.components.length > 0) {
      sections.push('**Komponenty:**\n');
      for (const comp of arch.components) {
        const compName = typeof comp === 'string' ? comp : (comp.name || comp.component || '');
        const compDesc = typeof comp === 'string' ? '' : (comp.description || comp.purpose || '');
        sections.push(`- **${compName}**${compDesc ? ' — ' + compDesc : ''}`);
      }
      sections.push('');
    }
    if (arch.data_flow) {
      sections.push('**Data flow:**\n');
      sections.push(arch.data_flow + '\n');
    }
  }

  // ─── Spec-aware: Tech stack table ─────────────────────────────────────
  if (spec && spec.tech_stack) {
    sections.push(`## Tech stack\n`);
    const ts = spec.tech_stack;
    if (ts.languages || ts.frameworks || ts.databases || ts.tools) {
      const items = [
        ...(ts.languages || []).map(l => typeof l === 'string' ? { name: l, type: 'Language' } : { ...l, type: 'Language' }),
        ...(ts.frameworks || []).map(f => typeof f === 'string' ? { name: f, type: 'Framework' } : { ...f, type: 'Framework' }),
        ...(ts.databases || []).map(d => typeof d === 'string' ? { name: d, type: 'Database' } : { ...d, type: 'Database' }),
        ...(ts.tools || []).map(t => typeof t === 'string' ? { name: t, type: 'Tool' } : { ...t, type: 'Tool' }),
      ];
      if (items.length > 0) {
        sections.push('| Technologie | Verze | Účel |');
        sections.push('|-------------|-------|------|');
        for (const item of items) {
          const n = item.name || '';
          const v = item.version || '—';
          const p = item.purpose || item.type || '—';
          sections.push(`| ${n} | ${v} | ${p} |`);
        }
        sections.push('');
      }
    } else {
      // Flat tech stack (string or simple object)
      const stackStr = typeof ts === 'string' ? ts : JSON.stringify(ts, null, 2);
      sections.push(stackStr + '\n');
    }
  } else {
    // Fallback: detect stack from files
    const stack = detectStack(projectPath);
    if (stack.length > 0) {
      sections.push(`## Stack\n`);
      sections.push(stack.map(s => `- ${s}`).join('\n') + '\n');
    }
  }

  // ─── Spec-aware: Design decisions ─────────────────────────────────────
  if (spec && spec.design_decisions && spec.design_decisions.length > 0) {
    sections.push(`## Design decisions\n`);
    for (const dd of spec.design_decisions) {
      const ddName = dd.name || dd.decision || dd.area || 'Decision';
      const ddChosen = dd.chosen || dd.choice || '';
      const ddRationale = dd.rationale || dd.reason || '';
      sections.push(`### ${ddName}`);
      if (ddChosen) sections.push(`- **Zvoleno:** ${ddChosen}`);
      if (ddRationale) sections.push(`- **Důvod:** ${ddRationale}`);
      if (dd.alternatives_considered && dd.alternatives_considered.length > 0) {
        sections.push('- **Alternativy:**');
        for (const alt of dd.alternatives_considered) {
          const altName = typeof alt === 'string' ? alt : (alt.name || alt.option || '');
          const altPros = typeof alt === 'string' ? '' : (alt.pros || '');
          const altCons = typeof alt === 'string' ? '' : (alt.cons || '');
          let altLine = `  - ${altName}`;
          if (altPros) altLine += ` — ✅ ${altPros}`;
          if (altCons) altLine += ` / ❌ ${altCons}`;
          sections.push(altLine);
        }
      }
      sections.push('');
    }
  }

  // Directory structure
  const tree = buildTree(projectPath, 2);
  if (tree) {
    sections.push(`## Struktura projektu\n`);
    sections.push('```\n' + tree + '\n```\n');
  }

  // Scripts
  const scripts = detectScripts(projectPath);
  if (scripts.length > 0) {
    sections.push(`## Skripty\n`);
    sections.push(scripts.map(s => `- \`${s.name}\` — ${s.cmd}`).join('\n') + '\n');
  }

  // Entry points
  const entries = detectEntryPoints(projectPath);
  if (entries.length > 0) {
    sections.push(`## Vstupní body\n`);
    sections.push(entries.map(e => `- \`${e}\``).join('\n') + '\n');
  }

  sections.push(`---\n> Automaticky vygenerováno C3 Studio (v91.0)\n`);

  return sections.join('\n');
}

/**
 * Generate installation section from spec and project files.
 * Deterministic — no LLM call.
 */
function _generateInstallSection(projectPath, spec) {
  const lines = [];
  const ts = spec.tech_stack || {};

  // Detect package manager
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    lines.push('```bash');
    lines.push('npm install');
    const scripts = detectScripts(projectPath);
    const startScript = scripts.find(s => s.name === 'npm run start' || s.name === 'npm run dev');
    if (startScript) {
      lines.push(startScript.name);
    } else {
      lines.push('npm start');
    }
    lines.push('```');
  } else if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    lines.push('```bash');
    lines.push('pip install -r requirements.txt');
    if (fs.existsSync(path.join(projectPath, 'main.py'))) {
      lines.push('python main.py');
    }
    lines.push('```');
  } else if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
    lines.push('```bash');
    lines.push('cargo build');
    lines.push('cargo run');
    lines.push('```');
  } else if (fs.existsSync(path.join(projectPath, 'pubspec.yaml'))) {
    lines.push('```bash');
    lines.push('flutter pub get');
    lines.push('flutter run');
    lines.push('```');
  } else if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    lines.push('```bash');
    lines.push('go build');
    lines.push('go run .');
    lines.push('```');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Generate and write README.md to project directory.
 * Only writes if README.md doesn't exist or is auto-generated.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @returns {{ written: boolean, path: string }}
 */
export function ensureReadme(projectPath, opts = {}) {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    logger.warn('ReadmeGenerator', `Skipped: invalid projectPath (${projectPath})`);
    return { written: false, path: null, reason: 'invalid_path' };
  }
  const readmePath = path.join(projectPath, 'README.md');

  try {
    // Don't overwrite user-created READMEs
    if (fs.existsSync(readmePath)) {
      const existing = fs.readFileSync(readmePath, 'utf-8');
      // Only regenerate if it's our auto-generated one
      if (!existing.includes('Automaticky vygenerováno C3 Studio')) {
        return { written: false, path: readmePath, reason: 'user_readme_exists' };
      }
    }

    const content = generateReadme(projectPath, opts);
    fs.writeFileSync(readmePath, content, 'utf-8');
    logger.info('ReadmeGenerator', `README.md written`, { projectPath: projectPath.substring(0, 60) });
    return { written: true, path: readmePath };
  } catch (err) {
    logger.warn('ReadmeGenerator', `Failed to write README.md: ${err.message}`);
    return { written: false, path: readmePath, error: err.message };
  }
}

/**
 * Ensure ROADMAP.md exists in the project directory.
 * Creates a scaffold if missing; never overwrites user- or lifecycle-created roadmaps.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {string} [opts.name] — Project name
 * @param {string} [opts.type] — Project type (webapp, api, automation, data, general)
 * @returns {{ written: boolean, path: string }}
 */
export function ensureRoadmap(projectPath, opts = {}) {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    logger.warn('ReadmeGenerator', `ensureRoadmap skipped: invalid path (${projectPath})`);
    return { written: false, path: null, reason: 'invalid_path' };
  }
  const roadmapPath = path.join(projectPath, 'ROADMAP.md');

  try {
    if (fs.existsSync(roadmapPath)) {
      return { written: false, path: roadmapPath, reason: 'roadmap_exists' };
    }

    const name = opts.name || path.basename(projectPath);
    const content = generateRoadmapScaffold(name, opts.type);
    fs.writeFileSync(roadmapPath, content, 'utf-8');
    logger.info('ReadmeGenerator', 'ROADMAP.md scaffold written', { projectPath: projectPath.substring(0, 60) });
    return { written: true, path: roadmapPath };
  } catch (err) {
    logger.warn('ReadmeGenerator', `Failed to write ROADMAP.md: ${err.message}`);
    return { written: false, path: roadmapPath, error: err.message };
  }
}

/**
 * Generate scaffold ROADMAP.md content.
 * Will be replaced by lifecycle engine's writeRoadmapFile() once planning completes.
 *
 * Status markers: ✅ Hotovo | ⏳ Probíhá | ⬜ Čeká
 * These are parsed by project-state-reader.js to determine current phase.
 */
function generateRoadmapScaffold(name, type) {
  const lines = [
    `# ROADMAP — ${name}`,
    '',
    '> Automaticky vygenerováno C3 Studio. Lifecycle engine aktualizuje po dokončení každé fáze.',
    '',
    '## Fáze projektu',
    '',
    '| # | Fáze | Status | Popis |',
    '|---|------|--------|-------|',
    '| 1 | Specifikace | ⏳ Probíhá | Definice požadavků, cílů a tech stacku |',
    '| 2 | Plánování | ⬜ Čeká | Generování roadmapy s milníky |',
    '| 3 | Implementace | ⬜ Čeká | Psaní kódu podle plánu |',
    '| 4 | Review | ⬜ Čeká | Kontrola kvality a finalizace |',
    '',
    '## Milníky',
    '',
    '_(Budou vygenerovány po dokončení plánovací fáze)_',
    '',
    '## Poznámky',
    '',
    '_(Sem se zapisují důležité rozhodnutí a blokery)_',
    '',
  ];
  return lines.join('\n');
}

/**
 * Ensure ARCHITECTURE.md exists with spec-derived content.
 * Generated at first milestone PASS from spec data — no LLM call.
 *
 * @param {string} projectPath
 * @param {Object} spec — Lifecycle spec
 * @returns {{ written: boolean, path: string }}
 */
export function ensureArchitectureDoc(projectPath, spec) {
  if (!projectPath || !path.isAbsolute(projectPath) || !spec) {
    return { written: false, path: null, reason: 'missing_input' };
  }

  const archPath = path.join(projectPath, 'ARCHITECTURE.md');

  try {
    // Don't overwrite user-created architecture docs
    if (fs.existsSync(archPath)) {
      const existing = fs.readFileSync(archPath, 'utf-8');
      if (!existing.includes('Automaticky vygenerováno C3 Studio')) {
        return { written: false, path: archPath, reason: 'user_doc_exists' };
      }
    }

    const content = _generateArchitectureDoc(spec, path.basename(projectPath));
    fs.writeFileSync(archPath, content, 'utf-8');
    logger.info('ReadmeGenerator', 'ARCHITECTURE.md written', { projectPath: projectPath.substring(0, 60) });
    return { written: true, path: archPath };
  } catch (err) {
    logger.warn('ReadmeGenerator', `Failed to write ARCHITECTURE.md: ${err.message}`);
    return { written: false, path: archPath, error: err.message };
  }
}

/**
 * Append changelog entry to README.md after a milestone completes.
 * Deterministic — no LLM call.
 *
 * @param {string} projectPath
 * @param {Object} milestone — { id, title, sequence }
 * @param {Object} [diffInfo] — { filesChanged, newFiles }
 */
export function appendReadmeChangelog(projectPath, milestone, diffInfo = {}) {
  if (!projectPath || !path.isAbsolute(projectPath)) return;

  const readmePath = path.join(projectPath, 'README.md');
  try {
    if (!fs.existsSync(readmePath)) return;

    let content = fs.readFileSync(readmePath, 'utf-8');

    // Find or create changelog section
    const changelogHeader = '## Changelog';
    if (!content.includes(changelogHeader)) {
      // Insert before the footer
      const footer = '---\n> Automaticky vygenerováno C3 Studio';
      const footerIdx = content.indexOf(footer);
      if (footerIdx >= 0) {
        content = content.substring(0, footerIdx) + changelogHeader + '\n\n' + content.substring(footerIdx);
      } else {
        content += '\n' + changelogHeader + '\n\n';
      }
    }

    // Build entry
    const seq = milestone.sequence || parseInt(String(milestone.id).replace(/\D/g, ''), 10) || '?';
    const title = milestone.title || milestone.id;
    const files = diffInfo.filesChanged || 0;
    const newFiles = diffInfo.newFiles || [];

    let entry = `### Milestone ${seq}: ${title}\n`;
    if (files > 0) entry += `- ${files} souborů změněno\n`;
    if (newFiles.length > 0) entry += `- Nové: ${newFiles.slice(0, 5).join(', ')}${newFiles.length > 5 ? ` (+${newFiles.length - 5})` : ''}\n`;
    entry += '\n';

    // Insert after changelog header
    const headerIdx = content.indexOf(changelogHeader);
    const insertPoint = headerIdx + changelogHeader.length;
    content = content.substring(0, insertPoint) + '\n\n' + entry + content.substring(insertPoint);

    fs.writeFileSync(readmePath, content, 'utf-8');
  } catch (err) {
    logger.warn('ReadmeGenerator', `Failed to append changelog: ${err.message}`);
  }
}

/**
 * Generate ARCHITECTURE.md content from spec.
 * Purely deterministic — extracts from spec JSON fields.
 */
function _generateArchitectureDoc(spec, projectName) {
  const lines = [];
  lines.push(`# Architecture — ${projectName}\n`);

  // Architecture overview
  if (spec.architecture) {
    const arch = spec.architecture;
    if (arch.description) {
      lines.push(`## Overview\n`);
      lines.push(arch.description + '\n');
    }

    if (arch.components && arch.components.length > 0) {
      lines.push(`## Components\n`);
      for (const comp of arch.components) {
        if (typeof comp === 'string') {
          lines.push(`- ${comp}`);
        } else {
          const name = comp.name || comp.component || 'Component';
          const desc = comp.description || comp.purpose || '';
          const deps = comp.dependencies || comp.depends_on || [];
          lines.push(`### ${name}`);
          if (desc) lines.push(desc);
          if (deps.length > 0) lines.push(`\n**Závislosti:** ${deps.join(', ')}`);
          lines.push('');
        }
      }
    }

    if (arch.data_flow) {
      lines.push(`## Data Flow\n`);
      lines.push(arch.data_flow + '\n');
    }

    if (arch.patterns) {
      lines.push(`## Patterns\n`);
      const patterns = Array.isArray(arch.patterns) ? arch.patterns : [arch.patterns];
      for (const p of patterns) {
        lines.push(`- ${typeof p === 'string' ? p : (p.name || JSON.stringify(p))}`);
      }
      lines.push('');
    }
  }

  // Design decisions
  if (spec.design_decisions && spec.design_decisions.length > 0) {
    lines.push(`## Design Decisions\n`);
    for (const dd of spec.design_decisions) {
      const ddName = dd.name || dd.decision || dd.area || 'Decision';
      const ddChosen = dd.chosen || dd.choice || '';
      const ddRationale = dd.rationale || dd.reason || '';
      lines.push(`### ${ddName}\n`);
      if (ddChosen) lines.push(`**Zvoleno:** ${ddChosen}\n`);
      if (ddRationale) lines.push(`**Důvod:** ${ddRationale}\n`);
      if (dd.alternatives_considered && dd.alternatives_considered.length > 0) {
        lines.push('**Alternativy:**\n');
        lines.push('| Alternativa | Pros | Cons |');
        lines.push('|-------------|------|------|');
        for (const alt of dd.alternatives_considered) {
          if (typeof alt === 'string') {
            lines.push(`| ${alt} | — | — |`);
          } else {
            const n = alt.name || alt.option || '';
            const pros = alt.pros || '—';
            const cons = alt.cons || '—';
            lines.push(`| ${n} | ${pros} | ${cons} |`);
          }
        }
        lines.push('');
      }
    }
  }

  // Risks
  if (spec.risks && spec.risks.length > 0) {
    lines.push(`## Risks\n`);
    for (const risk of spec.risks) {
      const rName = typeof risk === 'string' ? risk : (risk.description || risk.name || '');
      const severity = risk.severity || '';
      const mitigation = risk.mitigation || '';
      lines.push(`- **${rName}**${severity ? ` [${severity}]` : ''}`);
      if (mitigation) lines.push(`  - Mitigace: ${mitigation}`);
    }
    lines.push('');
  }

  lines.push(`---\n> Automaticky vygenerováno C3 Studio (v91.0)\n`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

export function detectStack(projectPath) {
  const stack = [];
  const checks = [
    ['package.json', 'Node.js'],
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['requirements.txt', 'Python'],
    ['pyproject.toml', 'Python'],
    ['Gemfile', 'Ruby'],
    ['pom.xml', 'Java (Maven)'],
    ['build.gradle', 'Java/Kotlin (Gradle)'],
    ['composer.json', 'PHP'],
    ['CMakeLists.txt', 'C/C++ (CMake)'],
    ['Makefile', 'Make'],
    ['docker-compose.yml', 'Docker Compose'],
    ['Dockerfile', 'Docker'],
    ['.env', 'Environment config'],
    ['tsconfig.json', 'TypeScript'],
    ['next.config.js', 'Next.js'],
    ['vite.config.ts', 'Vite'],
    ['tailwind.config.js', 'Tailwind CSS'],
  ];

  for (const [file, label] of checks) {
    try {
      if (fs.existsSync(path.join(projectPath, file))) {
        stack.push(label);
      }
    } catch { /* ignore */ }
  }

  return stack;
}

function buildTree(dirPath, maxDepth, prefix = '', depth = 0) {
  if (depth >= maxDepth) return '';

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        // Dirs first, then files
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 30); // Limit entries per level

    const lines = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      lines.push(prefix + connector + e.name + (e.isDirectory() ? '/' : ''));

      if (e.isDirectory()) {
        const subTree = buildTree(
          path.join(dirPath, e.name), maxDepth, prefix + childPrefix, depth + 1
        );
        if (subTree) lines.push(subTree);
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

function detectScripts(projectPath) {
  const scripts = [];

  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts) {
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          scripts.push({ name: `npm run ${name}`, cmd: String(cmd).substring(0, 80) });
        }
      }
    }
  } catch { /* ignore */ }

  return scripts.slice(0, 15);
}

function detectEntryPoints(projectPath) {
  const entries = [];
  const candidates = [
    'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'src/server.js', 'src/app.js', 'index.js', 'main.js',
    'app.py', 'main.py', 'manage.py',
    'src/main.rs', 'main.go', 'cmd/main.go',
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(projectPath, c))) {
        entries.push(c);
      }
    } catch { /* ignore */ }
  }

  return entries;
}
