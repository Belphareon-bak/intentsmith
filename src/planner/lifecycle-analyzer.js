// Lifecycle Analyzer — Existing Project State Analysis (P3)
// ══════════════════════════════════════════════════════════════════════════════
// Reads README.md, ROADMAP.md, .c3/project.json, package.json, git log,
// source code structure, and conversation history from DB.
//
// Returns a plain text context string for LLM injection into specAnalyze().
// Purely deterministic — no LLM calls.
// All file I/O is graceful — missing files are noted, never fatal.
// ══════════════════════════════════════════════════════════════════════════════

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import { logger } from '../core/logger.js';

// ─── File Readers (graceful) ────────────────────────────────────────────────

async function readProjectFile(projectPath, filename) {
  try {
    const content = await readFile(join(projectPath, filename), 'utf-8');
    return content.trim();
  } catch {
    return null;
  }
}

async function readJsonFile(projectPath, filename) {
  const raw = await readProjectFile(projectPath, filename);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Git Analysis ───────────────────────────────────────────────────────────

function analyzeGit(projectPath) {
  try {
    // Check if git repo exists
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectPath, stdio: 'pipe' });
  } catch {
    return null;
  }

  const result = { hasGit: true };

  try {
    const log = execSync('git log --oneline -20', { cwd: projectPath, stdio: 'pipe', encoding: 'utf-8' });
    const lines = log.trim().split('\n').filter(Boolean);
    result.commits = lines.length;
    result.recentCommits = lines.slice(0, 5);
  } catch {
    result.commits = 0;
    result.recentCommits = [];
  }

  try {
    const tags = execSync('git tag --sort=-creatordate', { cwd: projectPath, stdio: 'pipe', encoding: 'utf-8' });
    result.tags = tags.trim().split('\n').filter(Boolean).slice(0, 10);
  } catch {
    result.tags = [];
  }

  try {
    const branches = execSync('git branch --list', { cwd: projectPath, stdio: 'pipe', encoding: 'utf-8' });
    result.branches = branches.trim().split('\n').map(b => b.replace(/^\*?\s+/, '')).filter(Boolean);
  } catch {
    result.branches = [];
  }

  try {
    const status = execSync('git status --porcelain', { cwd: projectPath, stdio: 'pipe', encoding: 'utf-8' });
    result.uncommittedChanges = status.trim().split('\n').filter(Boolean).length;
  } catch {
    result.uncommittedChanges = 0;
  }

  return result;
}

// ─── Source Code Structure ──────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.c3', '.c3-architect', 'dist', 'build',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'coverage',
  '.idea', '.vscode', '.cache',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
  '.kt', '.scala', '.vue', '.svelte', '.astro',
]);

async function analyzeStructure(projectPath, depth = 2) {
  const result = { dirs: [], files: [], codeFiles: 0, totalFiles: 0 };

  async function walk(dir, currentDepth) {
    if (currentDepth > depth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && currentDepth === 0 && !entry.name.startsWith('.c3')) continue;
        if (IGNORE_DIRS.has(entry.name)) continue;

        const relative = join(dir, entry.name).slice(projectPath.length + 1);

        if (entry.isDirectory()) {
          result.dirs.push(relative + '/');
          await walk(join(dir, entry.name), currentDepth + 1);
        } else {
          result.totalFiles++;
          const ext = extname(entry.name);
          if (CODE_EXTENSIONS.has(ext)) {
            result.codeFiles++;
          }
          if (currentDepth <= 1) {
            result.files.push(relative);
          }
        }
      }
    } catch { /* permission denied, etc. */ }
  }

  await walk(projectPath, 0);
  return result;
}

// ─── Conversation History (from DB) ─────────────────────────────────────────

function getConversationHistory(projectId, db) {
  if (!db || !projectId) return null;

  try {
    const convDb = db.conversations || db;
    if (!convDb.listRecentByProject) return null;

    const convs = convDb.listRecentByProject.all(projectId, 5);
    if (!convs || convs.length === 0) return null;

    return convs.map(c => ({
      title: c.title || 'Untitled',
      summary: c.summary || null,
      updatedAt: c.updated_at || null,
    }));
  } catch {
    return null;
  }
}

// ─── Project Memory (from DB) ───────────────────────────────────────────────

function getProjectMemory(projectId, db) {
  if (!db || !projectId) return null;

  try {
    const memDb = db.projectMemory || db;
    if (!memDb.listByProject) return null;

    const rows = memDb.listByProject.all(projectId);
    if (!rows || rows.length === 0) return null;

    const facts = {};
    for (const row of rows) {
      if (!row.key.startsWith('timeline:')) {
        const cat = row.category || 'general';
        if (!facts[cat]) facts[cat] = [];
        facts[cat].push({ key: row.key, value: row.value });
      }
    }
    return Object.keys(facts).length > 0 ? facts : null;
  } catch {
    return null;
  }
}

// ─── Main Analyzer ──────────────────────────────────────────────────────────

/**
 * Analyze existing project state for SPEC context injection.
 * Reads files, git, DB. Returns formatted context string for LLM.
 *
 * @param {string} projectPath - Absolute path to project directory
 * @param {number|null} projectId - Project ID in DB (for conversation/memory lookup)
 * @param {Object|null} db - Database module (conversations, projectMemory)
 * @returns {Promise<string>} Context string for specAnalyze() prompt
 */
export async function analyzeExistingProject(projectPath, projectId = null, db = null) {
  if (!projectPath) return '';

  const parts = [];

  // 1. README.md
  const readme = await readProjectFile(projectPath, 'README.md');
  if (readme) {
    // Take first ~500 chars to keep context manageable
    const truncated = readme.length > 500 ? readme.substring(0, 500) + '...' : readme;
    parts.push(`### README.md\n${truncated}`);
  }

  // 2. ROADMAP.md
  const roadmap = await readProjectFile(projectPath, 'ROADMAP.md');
  if (roadmap) {
    const truncated = roadmap.length > 500 ? roadmap.substring(0, 500) + '...' : roadmap;
    parts.push(`### ROADMAP.md\n${truncated}`);
  }

  // 3. .c3/project.json
  const c3Config = await readJsonFile(projectPath, '.c3/project.json');
  if (c3Config) {
    const summary = [];
    if (c3Config.name) summary.push(`Name: ${c3Config.name}`);
    if (c3Config.type) summary.push(`Type: ${c3Config.type}`);
    if (c3Config.description) summary.push(`Description: ${c3Config.description}`);
    if (c3Config.lifecycle) summary.push(`Lifecycle phase: ${c3Config.lifecycle}`);
    if (summary.length > 0) {
      parts.push(`### .c3/project.json\n${summary.join('\n')}`);
    }
  }

  // 4. package.json
  const pkg = await readJsonFile(projectPath, 'package.json');
  if (pkg) {
    const summary = [];
    if (pkg.name) summary.push(`Name: ${pkg.name}`);
    if (pkg.version) summary.push(`Version: ${pkg.version}`);
    if (pkg.description) summary.push(`Description: ${pkg.description}`);
    if (pkg.type) summary.push(`Module type: ${pkg.type}`);
    const deps = Object.keys(pkg.dependencies || {});
    if (deps.length > 0) summary.push(`Dependencies: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? ` (+${deps.length - 10} more)` : ''}`);
    const devDeps = Object.keys(pkg.devDependencies || {});
    if (devDeps.length > 0) summary.push(`Dev dependencies: ${devDeps.slice(0, 5).join(', ')}${devDeps.length > 5 ? ` (+${devDeps.length - 5} more)` : ''}`);
    const scripts = Object.keys(pkg.scripts || {});
    if (scripts.length > 0) summary.push(`Scripts: ${scripts.join(', ')}`);
    if (summary.length > 0) {
      parts.push(`### package.json\n${summary.join('\n')}`);
    }
  }

  // 5. Git analysis
  const git = analyzeGit(projectPath);
  if (git) {
    const summary = [`Commits: ${git.commits}`];
    if (git.tags.length > 0) summary.push(`Tags: ${git.tags.join(', ')}`);
    if (git.branches.length > 1) summary.push(`Branches: ${git.branches.join(', ')}`);
    if (git.uncommittedChanges > 0) summary.push(`Uncommitted changes: ${git.uncommittedChanges}`);
    if (git.recentCommits.length > 0) {
      summary.push(`Recent commits:`);
      for (const c of git.recentCommits) {
        summary.push(`  - ${c}`);
      }
    }
    parts.push(`### Git\n${summary.join('\n')}`);
  }

  // 6. Source code structure
  try {
    const structure = await analyzeStructure(projectPath);
    if (structure.totalFiles > 0 || structure.dirs.length > 0) {
      const summary = [`Total files: ${structure.totalFiles}`, `Code files: ${structure.codeFiles}`];
      if (structure.dirs.length > 0) {
        summary.push(`Directories: ${structure.dirs.slice(0, 15).join(', ')}${structure.dirs.length > 15 ? ` (+${structure.dirs.length - 15} more)` : ''}`);
      }
      if (structure.files.length > 0) {
        summary.push(`Root files: ${structure.files.slice(0, 10).join(', ')}${structure.files.length > 10 ? ` (+${structure.files.length - 10} more)` : ''}`);
      }
      parts.push(`### Source Structure\n${summary.join('\n')}`);
    }
  } catch { /* non-fatal */ }

  // 7. Conversation history (from DB)
  const conversations = getConversationHistory(projectId, db);
  if (conversations) {
    const summary = [`Previous conversations: ${conversations.length}`];
    for (const c of conversations.slice(0, 3)) {
      let line = `- "${c.title}"`;
      if (c.summary) line += ` — ${c.summary.substring(0, 80)}`;
      if (c.updatedAt) line += ` (${c.updatedAt.split('T')[0]})`;
      summary.push(line);
    }
    parts.push(`### Conversation History\n${summary.join('\n')}`);
  }

  // 8. Project memory (from DB)
  const memory = getProjectMemory(projectId, db);
  if (memory) {
    const summary = [];
    for (const [category, facts] of Object.entries(memory)) {
      if (category === 'decisions') {
        summary.push(`Decisions: ${facts.length}`);
        for (const f of facts.slice(0, 3)) {
          try {
            const parsed = JSON.parse(f.value);
            summary.push(`  - ${parsed.step}: ${typeof parsed.decision === 'string' ? parsed.decision.substring(0, 80) : JSON.stringify(parsed.decision).substring(0, 80)}`);
          } catch {
            summary.push(`  - ${f.key}: ${f.value.substring(0, 80)}`);
          }
        }
      } else if (category === 'blockers') {
        const active = facts.filter(f => {
          try { return !JSON.parse(f.value).resolved; } catch { return true; }
        });
        if (active.length > 0) {
          summary.push(`Active blockers: ${active.length}`);
          for (const b of active.slice(0, 3)) {
            try {
              const parsed = JSON.parse(b.value);
              summary.push(`  - ${parsed.description}`);
            } catch {
              summary.push(`  - ${b.value.substring(0, 80)}`);
            }
          }
        }
      } else {
        for (const f of facts.slice(0, 5)) {
          summary.push(`- ${f.key}: ${f.value.substring(0, 100)}`);
        }
      }
    }
    if (summary.length > 0) {
      parts.push(`### Project Memory\n${summary.join('\n')}`);
    }
  }

  if (parts.length === 0) return '';

  const context = `## Existing Project Analysis\n\n${parts.join('\n\n')}`;

  logger.info('LifecycleAnalyzer', 'Project analyzed', {
    projectPath,
    sections: parts.length,
    contextLength: context.length,
  });

  return context;
}

export default { analyzeExistingProject };
