// CRE v41.x Knowledge & Skill Composition Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 6 — KNOWLEDGE & SKILL COMPOSITION
//
// v41.0: Skill System
//   - Skill: Verified sequence of steps (≠ Tool)
//   - SkillRegistry: Skill management
//   - SkillExecutor: Execute skills with context
//
// v41.1: Project Memory
//   - ProjectContext: Stack, conventions, code style
//   - ProjectMemory: Long-term knowledge storage
//
// ══════════════════════════════════════════════════════════════════════════════

// v41.0: Skill System
export {
  SkillCategory, SkillStatus, SkillIOType, StepType,
  SafetyLevel, SafetyProfile,  // Safety profile for skills
  SkillStep, Skill,
  SkillRegistry, skillRegistry,
  createSkill,
} from './skill-registry.js';

export {
  ExecutionStatus,
  SkillExecutionContext,
  SkillExecutor, skillExecutor,
  executeSkill,
} from './skill-executor.js';

// v41.1: Project Memory
export {
  StackCategory, ConventionType, MemoryType, Confidence,
  MemorySource,  // Memory source types (REQUIRED for entries)
  StackItem, Convention, MemoryEntry,
  ProjectContext, projectContext,
  ProjectMemory, projectMemory,
  detectStack,
} from './project-memory.js';
