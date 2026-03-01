// v89 — Project State Reader
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministic parser: README + ROADMAP + .c3/project.json → structured state.
// Tolerant regex — handles malformed tables, extra spaces, CRLF, BOM.
// No LLM calls. All file I/O is graceful — missing files are noted, never fatal.
//
// v90+ direction: .c3/state.json will be the machine-readable source of truth.
// This parser will then only be needed for onboarding foreign projects.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../../../core/logger.js';
import { detectStack } from './readme-generator.js';

const MAX_FILE_SIZE = 50_000;

// ─── Phase status enum ──────────────────────────────────────────────────────

export const PhaseStatus = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  UNKNOWN: 'UNKNOWN',
});

// ─── State type enum ────────────────────────────────────────────────────────

export const StateType = Object.freeze({
  FULL: 'FULL',       // C3 README + C3 ROADMAP
  HYBRID: 'HYBRID',   // Mix of C3 and foreign/missing
  FOREIGN: 'FOREIGN', // Both exist but neither is C3-generated
  EMPTY: 'EMPTY',     // Neither exists
});

// ─── Safe file reading ──────────────────────────────────────────────────────

function safeReadFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    let content = fs.readFileSync(filePath, 'utf-8');
    // BOM strip
    content = content.replace(/^\uFEFF/, '');
    // Size guard
    if (content.length > MAX_FILE_SIZE) {
      content = content.substring(0, MAX_FILE_SIZE);
    }
    return content;
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  const raw = safeReadFile(filePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── C3 marker detection ────────────────────────────────────────────────────

function isC3Generated(content) {
  if (!content) return false;
  return content.includes('Automaticky vygenerováno C3') || content.includes('C3 Studio');
}

// ─── ROADMAP phase parser ───────────────────────────────────────────────────

/**
 * Parse ROADMAP.md table for phase status markers.
 * Tolerant — handles extra spaces, CRLF, missing columns.
 *
 * @param {string} content - ROADMAP.md content
 * @returns {{ phases: Array<{name: string, status: string}>, hasPhases: boolean }}
 */
function parseRoadmapPhases(content) {
  if (!content) return { phases: [], hasPhases: false };

  // Tolerant regex: | <number> | <phase name> | <status with marker> |
  const PHASE_REGEX = /\|\s*\d+\s*\|\s*([^|]+)\|\s*([^|]*(?:✅|⏳|⬜)[^|]*)/gu;
  const phases = [];
  let match;

  while ((match = PHASE_REGEX.exec(content)) !== null) {
    const name = match[1].trim();
    const statusCell = match[2].trim();

    let status;
    if (statusCell.startsWith('✅')) {
      status = 'completed';
    } else if (statusCell.startsWith('⏳')) {
      status = 'in_progress';
    } else if (statusCell.startsWith('⬜')) {
      status = 'pending';
    } else {
      // Marker might be embedded — check contains as fallback
      if (statusCell.includes('✅')) status = 'completed';
      else if (statusCell.includes('⏳')) status = 'in_progress';
      else if (statusCell.includes('⬜')) status = 'pending';
      else status = 'unknown';
    }

    if (name) {
      phases.push({ name, status });
    }
  }

  return { phases, hasPhases: phases.length > 0 };
}

/**
 * Derive currentPhase and phaseStatus from parsed phases.
 *
 * Rules (deterministic):
 * 1. Exactly 1× in_progress → that's current, phaseStatus = IN_PROGRESS
 * 2. 0× in_progress + has pending → first pending is current, phaseStatus = PENDING
 * 3. Multiple in_progress → warn + take first, phaseStatus = IN_PROGRESS
 * 4. All completed → currentPhase = null, phaseStatus = COMPLETED
 * 5. No phases found → phaseStatus = UNKNOWN
 */
function derivePhaseStatus(phases) {
  if (phases.length === 0) {
    return { currentPhase: null, phaseStatus: PhaseStatus.UNKNOWN };
  }

  const completed = phases.filter(p => p.status === 'completed');
  const inProgress = phases.filter(p => p.status === 'in_progress');
  const pending = phases.filter(p => p.status === 'pending');

  if (inProgress.length === 1) {
    return { currentPhase: inProgress[0].name, phaseStatus: PhaseStatus.IN_PROGRESS };
  }

  if (inProgress.length > 1) {
    logger.warn('ProjectStateReader', `Multiple ⏳ phases found (${inProgress.length}), using first: "${inProgress[0].name}"`);
    return { currentPhase: inProgress[0].name, phaseStatus: PhaseStatus.IN_PROGRESS };
  }

  // 0 in_progress
  if (pending.length > 0) {
    return { currentPhase: pending[0].name, phaseStatus: PhaseStatus.PENDING };
  }

  if (completed.length > 0 && completed.length === phases.length) {
    return { currentPhase: null, phaseStatus: PhaseStatus.COMPLETED };
  }

  return { currentPhase: null, phaseStatus: PhaseStatus.UNKNOWN };
}

// ─── Summary extraction ─────────────────────────────────────────────────────

/**
 * Extract summary from README content.
 * Finds first actual paragraph text under H1 — skips badges, images, links,
 * blockquotes, headings, bare lists, empty lines, tables.
 *
 * @param {string} content - README content
 * @returns {string|null}
 */
function extractReadmeSummary(content) {
  if (!content) return null;

  const lines = content.split(/\r?\n/);
  let pastH1 = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Find H1
    if (!pastH1) {
      if (trimmed.startsWith('# ')) {
        pastH1 = true;
      }
      continue;
    }

    // Skip non-text lines
    if (!trimmed) continue;                      // empty
    if (trimmed.startsWith('!')) continue;        // images/badges
    if (trimmed.startsWith('<')) continue;        // HTML tags
    if (trimmed.startsWith('|')) continue;        // tables
    if (trimmed.startsWith('[')) continue;        // links-only lines
    if (trimmed.startsWith('>')) continue;        // blockquotes
    if (trimmed.startsWith('#')) break;           // next heading — stop
    if (/^[-*]\s/.test(trimmed)) continue;        // bare list items
    if (trimmed.startsWith('```')) break;         // code block — stop
    if (trimmed.startsWith('---')) continue;      // horizontal rule

    // Found a paragraph — take first 200 chars
    return trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
  }

  return null;
}

// ─── State type derivation ──────────────────────────────────────────────────

function deriveStateType(hasReadme, readmeIsC3, hasRoadmap, roadmapIsC3) {
  if (!hasReadme && !hasRoadmap) return StateType.EMPTY;
  if (hasReadme && readmeIsC3 && hasRoadmap && roadmapIsC3) return StateType.FULL;
  if (hasReadme && !readmeIsC3 && hasRoadmap && !roadmapIsC3) return StateType.FOREIGN;
  return StateType.HYBRID;
}

// ─── Main reader ────────────────────────────────────────────────────────────

/**
 * Read project state from filesystem.
 * Deterministic — no LLM, no DB. Pure file-based.
 *
 * @param {string} projectPath - Absolute path to project root
 * @returns {Object} Structured project state
 */
export function readProjectState(projectPath) {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    return {
      name: 'Unknown',
      description: 'Projekt bez popisu',
      type: null,
      currentPhase: null,
      phaseStatus: PhaseStatus.UNKNOWN,
      completedPhases: [],
      pendingPhases: [],
      hasReadme: false,
      hasRoadmap: false,
      hasPhases: false,
      stateType: StateType.EMPTY,
      hasC3Structure: false,
      stack: [],
      summary: 'Projekt bez popisu',
    };
  }

  // 1. Read files
  const readmeContent = safeReadFile(path.join(projectPath, 'README.md'));
  const roadmapContent = safeReadFile(path.join(projectPath, 'ROADMAP.md'));
  const c3Meta = safeReadJson(path.join(projectPath, '.c3', 'project.json'));

  const hasReadme = readmeContent !== null;
  const hasRoadmap = roadmapContent !== null;
  const readmeIsC3 = isC3Generated(readmeContent);
  const roadmapIsC3 = isC3Generated(roadmapContent);

  // 2. Parse ROADMAP phases
  const { phases, hasPhases } = parseRoadmapPhases(roadmapContent);
  const { currentPhase, phaseStatus } = derivePhaseStatus(phases);
  const completedPhases = phases.filter(p => p.status === 'completed').map(p => p.name);
  const pendingPhases = phases.filter(p => p.status === 'pending').map(p => p.name);

  // 3. Description — deterministic priority
  let description;
  if (c3Meta?.description) {
    description = c3Meta.description;
  } else {
    description = extractReadmeSummary(readmeContent) || 'Projekt bez popisu';
  }

  // 4. Name
  const name = c3Meta?.name || path.basename(projectPath);

  // 5. Type
  const type = c3Meta?.type || null;

  // 6. State type
  const stateType = deriveStateType(hasReadme, readmeIsC3, hasRoadmap, roadmapIsC3);
  const hasC3Structure = readmeIsC3 || roadmapIsC3;

  // 7. Stack — from actual files
  const stack = detectStack(projectPath);

  // 8. Summary (for welcome — concise)
  const summary = description;

  return {
    name,
    description,
    type,
    currentPhase,
    phaseStatus,
    completedPhases,
    pendingPhases,
    hasReadme,
    hasRoadmap,
    hasPhases,
    stateType,
    hasC3Structure,
    stack,
    summary,
  };
}

export default { readProjectState, PhaseStatus, StateType };
