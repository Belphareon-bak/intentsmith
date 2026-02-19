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
 * @returns {string} — README.md content
 */
export function generateReadme(projectPath, opts = {}) {
  const name = opts.name || path.basename(projectPath);
  const description = opts.description || '';

  const sections = [];
  sections.push(`# ${name}\n`);
  if (description) sections.push(`${description}\n`);

  // Detect stack
  const stack = detectStack(projectPath);
  if (stack.length > 0) {
    sections.push(`## Stack\n`);
    sections.push(stack.map(s => `- ${s}`).join('\n') + '\n');
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

  sections.push(`---\n> Automaticky vygenerováno C3 Studio (v67.0)\n`);

  return sections.join('\n');
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

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function detectStack(projectPath) {
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
