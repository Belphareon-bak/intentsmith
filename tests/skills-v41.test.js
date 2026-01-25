// CRE v41.x Knowledge & Skill Composition Tests
// ══════════════════════════════════════════════════════════════════════════════

import {
  // v41.0: Skill System
  SkillCategory, SkillStatus, SkillIOType, StepType,
  SafetyLevel, SafetyProfile,  // Safety profile
  SkillStep, Skill,
  SkillRegistry, skillRegistry,
  createSkill,
  ExecutionStatus,
  SkillExecutionContext,
  SkillExecutor, skillExecutor,
  executeSkill,

  // v41.1: Project Memory
  StackCategory, ConventionType, MemoryType, Confidence,
  MemorySource,  // Memory source types (REQUIRED)
  StackItem, Convention, MemoryEntry,
  ProjectContext, projectContext,
  ProjectMemory, projectMemory,
  detectStack,
} from '../src/skills/index.js';

// Test utilities
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function assertEq(actual, expected, message) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual: ${JSON.stringify(actual)}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ══════════════════════════════════════════════════════════════════════════════
// v41.0: Skill System Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v41.0: SkillStep', () => {
  const step = new SkillStep({
    id: 'step1',
    type: StepType.TOOL,
    name: 'Read file',
    toolId: 'read_file',
    toolParams: { path: '$input.file' },
  });

  assert(step.id === 'step1', 'has id');
  assert(step.type === StepType.TOOL, 'has type');
  assert(step.toolId === 'read_file', 'has toolId');

  // Parameter resolution
  const resolved = step.resolveParams({
    input: { file: '/path/to/file.txt' },
  });
  assertEq(resolved, { path: '/path/to/file.txt' }, 'resolves $input parameters');
});

describe('v41.0: Skill', () => {
  const skill = new Skill({
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    category: SkillCategory.ANALYSIS,
    version: '1.0.0',
    status: SkillStatus.VERIFIED,
    inputs: [
      { name: 'file', type: SkillIOType.FILE, required: true },
      { name: 'options', type: SkillIOType.JSON, required: false, default: {} },
    ],
    outputs: [
      { name: 'result', type: SkillIOType.JSON },
    ],
    steps: [
      { id: 'read', type: StepType.TOOL, toolId: 'read_file', toolParams: { path: '$input.file' } },
    ],
    tags: ['test', 'example'],
  });

  assert(skill.id === 'test-skill', 'has id');
  assert(skill.category === SkillCategory.ANALYSIS, 'has category');
  assert(skill.status === SkillStatus.VERIFIED, 'has status');
  assert(skill.inputs.length === 2, 'has inputs');
  assert(skill.outputs.length === 1, 'has outputs');
  assert(skill.steps.length === 1, 'has steps');
  assert(skill.steps[0] instanceof SkillStep, 'steps are SkillStep instances');

  // Input validation
  const valid = skill.validateInputs({ file: '/test.txt' });
  assert(valid.valid === true, 'validates correct inputs');

  const invalid = skill.validateInputs({});
  assert(invalid.valid === false, 'rejects missing required inputs');
  assert(invalid.errors.length > 0, 'has error messages');

  // Required tools
  const tools = skill.getRequiredToolIds();
  assert(tools.includes('read_file'), 'extracts required tool ids');

  // Serialization
  const json = skill.toJSON();
  const restored = Skill.fromJSON(json);
  assert(restored.id === skill.id, 'serializes and deserializes');
});

describe('v41.0: SkillRegistry', () => {
  const registry = new SkillRegistry();

  // Register skill
  const skill = registry.register({
    id: 'registry-test',
    name: 'Registry Test',
    category: SkillCategory.TESTING,
    tags: ['test', 'registry'],
    steps: [],
  });

  assert(registry.has('registry-test'), 'registers skill');
  assert(registry.get('registry-test') === skill, 'retrieves skill');

  // Find by category
  const byCategory = registry.findByCategory(SkillCategory.TESTING);
  assert(byCategory.length >= 1, 'finds by category');

  // Find by tag
  const byTag = registry.findByTag('test');
  assert(byTag.length >= 1, 'finds by tag');

  // Search
  const searchResults = registry.search('Registry');
  assert(searchResults.length >= 1, 'searches skills');

  // Aliases
  registry.addAlias('rt', 'registry-test');
  assert(registry.get('rt') === skill, 'resolves aliases');

  // Unregister
  registry.unregister('registry-test');
  assert(!registry.has('registry-test'), 'unregisters skill');
});

describe('v41.0: SkillRegistry built-in skills', () => {
  // Check built-in skills exist
  assert(skillRegistry.has('skill:analyze-file'), 'has analyze-file skill');
  assert(skillRegistry.has('skill:refactor-function'), 'has refactor-function skill');
  assert(skillRegistry.has('skill:add-tests'), 'has add-tests skill');

  const verified = skillRegistry.getVerified();
  assert(verified.length >= 3, 'has verified built-in skills');
});

describe('v41.0: SafetyProfile', () => {
  // Create safe profile
  const safe = SafetyProfile.safe();
  assert(safe.level === SafetyLevel.SAFE, 'safe profile has SAFE level');
  assert(safe.canModifyFiles === false, 'safe profile cannot modify files');
  assert(safe.requiresApproval === false, 'safe profile does not require approval');

  // Create normal profile
  const normal = SafetyProfile.normal();
  assert(normal.level === SafetyLevel.NORMAL, 'normal profile has NORMAL level');
  assert(normal.canModifyFiles === true, 'normal profile can modify files');

  // Create dangerous profile
  const dangerous = SafetyProfile.dangerous();
  assert(dangerous.level === SafetyLevel.DANGEROUS, 'dangerous profile has DANGEROUS level');
  assert(dangerous.requiresApproval === true, 'dangerous profile requires approval');
  assert(dangerous.canExecuteCommands === true, 'dangerous profile can execute commands');

  // Tool restrictions
  const restricted = new SafetyProfile({
    allowedTools: ['read_file', 'write_file'],
    blockedTools: ['exec_command'],
  });
  assert(restricted.isToolAllowed('read_file') === true, 'allows listed tool');
  assert(restricted.isToolAllowed('dangerous_tool') === false, 'blocks unlisted tool');
  assert(restricted.isToolAllowed('exec_command') === false, 'blocks explicitly blocked tool');

  // Profile with all tools allowed (except blocked)
  const openProfile = new SafetyProfile({
    allowedTools: null,
    blockedTools: ['exec_command'],
  });
  assert(openProfile.isToolAllowed('any_tool') === true, 'allows any tool when allowedTools is null');
  assert(openProfile.isToolAllowed('exec_command') === false, 'still blocks explicitly blocked');

  // Serialization
  const json = safe.toJSON();
  assert(json.level === SafetyLevel.SAFE, 'toJSON preserves level');
  const restored = SafetyProfile.fromJSON(json);
  assert(restored.level === SafetyLevel.SAFE, 'fromJSON restores level');

  // Frozen
  assert(Object.isFrozen(safe), 'SafetyProfile is frozen');
});

describe('v41.0: SafetyProfile merge', () => {
  const profile1 = new SafetyProfile({
    level: SafetyLevel.NORMAL,
    maxSteps: 20,
    allowedTools: ['read_file', 'write_file', 'exec_command'],
    canModifyFiles: true,
    canExecuteCommands: true,
  });

  const profile2 = new SafetyProfile({
    level: SafetyLevel.SAFE,
    maxSteps: 10,
    allowedTools: ['read_file', 'write_file'],
    canModifyFiles: false,
    canExecuteCommands: false,
  });

  const merged = profile1.merge(profile2);

  // More restrictive level wins (NORMAL > SAFE in restriction)
  assert(merged.level === SafetyLevel.NORMAL, 'merge uses more restrictive level');
  assert(merged.maxSteps === 10, 'merge uses smaller maxSteps');
  assert(merged.canModifyFiles === false, 'merge uses more restrictive canModifyFiles');
  assert(merged.canExecuteCommands === false, 'merge uses more restrictive canExecuteCommands');

  // Allowed tools is intersection
  const allowedToolsList = merged.allowedTools;
  assert(allowedToolsList.includes('read_file'), 'merge keeps common tools');
  assert(allowedToolsList.includes('write_file'), 'merge keeps common tools');
  assert(!allowedToolsList.includes('exec_command'), 'merge removes non-common tools');
});

describe('v41.0: SafetyProfile step validation', () => {
  const profile = new SafetyProfile({
    maxSteps: 5,
    maxLoopIterations: 10,
    allowedTools: ['read_file', 'write_file'],
  });

  // Valid steps
  const validSteps = [
    { id: 's1', type: StepType.TOOL, toolId: 'read_file' },
    { id: 's2', type: StepType.TOOL, toolId: 'write_file' },
  ];
  const validResult = profile.validateSteps(validSteps);
  assert(validResult.valid === true, 'validates valid steps');

  // Too many steps
  const tooManySteps = Array(10).fill().map((_, i) => ({
    id: `s${i}`, type: StepType.TOOL, toolId: 'read_file',
  }));
  const tooManyResult = profile.validateSteps(tooManySteps);
  assert(tooManyResult.valid === false, 'rejects too many steps');
  assert(tooManyResult.errors.some(e => e.includes('maxSteps')), 'error mentions maxSteps');

  // Disallowed tool
  const disallowedSteps = [
    { id: 's1', type: StepType.TOOL, toolId: 'exec_command' },
  ];
  const disallowedResult = profile.validateSteps(disallowedSteps);
  assert(disallowedResult.valid === false, 'rejects disallowed tools');
  assert(disallowedResult.errors.some(e => e.includes('disallowed')), 'error mentions disallowed');
});

describe('v41.0: Skill with SafetyProfile', () => {
  const skill = new Skill({
    id: 'safety-test-skill',
    name: 'Safety Test Skill',
    steps: [
      { id: 'read', type: StepType.TOOL, toolId: 'read_file' },
    ],
    safetyProfile: {
      level: SafetyLevel.SAFE,
      maxSteps: 5,
      allowedTools: ['read_file'],
      requiresApproval: false,
      canModifyFiles: false,
    },
  });

  assert(skill.safetyProfile instanceof SafetyProfile, 'skill has SafetyProfile instance');
  assert(skill.safetyProfile.level === SafetyLevel.SAFE, 'skill has correct safety level');
  assert(skill.requiresApproval() === false, 'skill.requiresApproval() works');
  assert(skill.getMaxSteps() === 5, 'skill.getMaxSteps() works');
  assert(skill.isToolAllowed('read_file') === true, 'skill.isToolAllowed() works');
  assert(skill.isToolAllowed('write_file') === false, 'skill.isToolAllowed() rejects unlisted');

  // Validate safety
  const safetyResult = skill.validateSafety();
  assert(safetyResult.valid === true, 'validateSafety passes for valid skill');

  // Legacy compatibility
  assert(skill.safetyLevel === SafetyLevel.SAFE, 'legacy safetyLevel preserved');
});

describe('v41.0: Built-in skills have SafetyProfile', () => {
  const analyzeFile = skillRegistry.get('skill:analyze-file');
  assert(analyzeFile.safetyProfile instanceof SafetyProfile, 'analyze-file has SafetyProfile');
  assert(analyzeFile.safetyProfile.level === SafetyLevel.SAFE, 'analyze-file is SAFE level');
  assert(analyzeFile.safetyProfile.canModifyFiles === false, 'analyze-file cannot modify files');

  const refactorFunction = skillRegistry.get('skill:refactor-function');
  assert(refactorFunction.safetyProfile instanceof SafetyProfile, 'refactor-function has SafetyProfile');
  assert(refactorFunction.safetyProfile.level === SafetyLevel.NORMAL, 'refactor-function is NORMAL level');
  assert(refactorFunction.safetyProfile.canModifyFiles === true, 'refactor-function can modify files');
});

describe('v41.0: SkillExecutionContext', () => {
  const skill = new Skill({ id: 'ctx-test', name: 'Context Test', steps: [] });
  const ctx = new SkillExecutionContext(skill, { input1: 'value1' });

  assert(ctx.skill === skill, 'has skill reference');
  assert(ctx.input.input1 === 'value1', 'has inputs');
  assert(ctx.status === ExecutionStatus.PENDING, 'initial status is pending');
  assert(ctx.depth === 0, 'initial depth is 0');

  // Set step result
  ctx.setStepResult('step1', { data: 'result' });
  assert(ctx.steps.step1.data === 'result', 'stores step results');

  // Resolution context
  const resCtx = ctx.getResolutionContext();
  assert(resCtx.input.input1 === 'value1', 'resolution context has inputs');
  assert(resCtx.steps.step1.data === 'result', 'resolution context has steps');

  // Child context
  const childSkill = new Skill({ id: 'child', name: 'Child', steps: [] });
  const childCtx = ctx.createChildContext(childSkill, { childInput: 1 });
  assert(childCtx.depth === 1, 'child has incremented depth');
  assert(childCtx.parentContext === ctx, 'child has parent reference');
});

describe('v41.0: SkillExecutor', async () => {
  const executor = new SkillExecutor();

  // Register a simple test skill
  const testSkill = new Skill({
    id: 'exec-test',
    name: 'Executor Test',
    status: SkillStatus.VERIFIED,
    inputs: [
      { name: 'value', type: SkillIOType.NUMBER, required: true },
    ],
    steps: [
      {
        id: 'transform',
        type: StepType.TRANSFORM,
        transform: (ctx) => ({ doubled: ctx.input.value * 2 }),
      },
    ],
  });

  executor.registry.register(testSkill);

  const result = await executor.execute('exec-test', { value: 21 });

  assert(result.success === true, 'execution succeeds');
  assert(result.executionId !== undefined, 'has execution id');
  assert(result.stepsExecuted === 1, 'executed steps');

  // History
  const history = executor.getHistory({ skillId: 'exec-test' });
  assert(history.length >= 1, 'tracks history');
});

describe('v41.0: SkillExecutor validation', async () => {
  const executor = new SkillExecutor();

  const skill = new Skill({
    id: 'validation-test',
    name: 'Validation Test',
    status: SkillStatus.VERIFIED,
    inputs: [
      { name: 'required', type: SkillIOType.TEXT, required: true },
    ],
    steps: [],
  });

  executor.registry.register(skill);

  // Missing required input - executor throws
  let errorCaught = false;
  let errorMsg = '';
  try {
    await executor.execute('validation-test', {});
  } catch (e) {
    errorCaught = true;
    errorMsg = e.message;
  }
  assert(errorCaught === true, 'throws on missing input');
  assert(errorMsg.includes('Invalid inputs'), 'error mentions invalid inputs');
});

// ══════════════════════════════════════════════════════════════════════════════
// v41.1: Project Memory Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v41.1: StackItem', () => {
  const item = new StackItem({
    id: 'nodejs',
    name: 'Node.js',
    category: StackCategory.RUNTIME,
    version: '20.x',
    confidence: Confidence.CERTAIN,
    detectedFrom: 'package.json',
  });

  assert(item.id === 'nodejs', 'has id');
  assert(item.category === StackCategory.RUNTIME, 'has category');
  assert(item.version === '20.x', 'has version');
  assert(item.confidence === Confidence.CERTAIN, 'has confidence');

  const json = item.toJSON();
  assert(json.id === 'nodejs', 'serializes to JSON');
});

describe('v41.1: Convention', () => {
  const convention = new Convention({
    id: 'camelCase',
    type: ConventionType.NAMING,
    name: 'camelCase Variables',
    description: 'Use camelCase for variable names',
    pattern: /^[a-z][a-zA-Z0-9]*$/,
    examples: ['myVariable', 'userName'],
    antiExamples: ['my_variable', 'MyVariable'],
    appliesTo: ['*.js', '*.ts'],
  });

  assert(convention.id === 'camelCase', 'has id');
  assert(convention.type === ConventionType.NAMING, 'has type');

  // Check convention
  assert(convention.check('myVariable') === true, 'matches valid');
  assert(convention.check('my_variable') === false, 'rejects invalid');
});

describe('v41.1: MemoryEntry', () => {
  const entry = new MemoryEntry({
    type: MemoryType.FACT,
    content: 'This project uses ESM modules',
    confidence: Confidence.HIGH,
    source: MemorySource.DETECTED,  // REQUIRED
    tags: ['modules', 'esm'],
  });

  assert(entry.type === MemoryType.FACT, 'has type');
  assert(entry.content.includes('ESM'), 'has content');
  assert(entry.confidence === Confidence.HIGH, 'has confidence');
  assert(entry.source === MemorySource.DETECTED, 'has source');
  assert(entry.tags.includes('esm'), 'has tags');

  // Access tracking
  entry.markAccessed();
  assert(entry.accessCount === 1, 'tracks access count');
  assert(entry.lastAccessedAt !== null, 'tracks last access time');

  // Expiration
  assert(entry.isExpired() === false, 'not expired by default');

  const expiredEntry = new MemoryEntry({
    type: MemoryType.TIP,
    content: 'Old tip',
    confidence: Confidence.LOW,
    source: MemorySource.SYSTEM,
    expiresAt: Date.now() - 1000,
  });
  assert(expiredEntry.isExpired() === true, 'detects expired entries');
});

describe('v41.1: MemoryEntry validation (MANDATORY TYPING)', () => {
  // Test that missing required fields throw errors

  // Missing type
  let threw = false;
  try {
    new MemoryEntry({ content: 'test', confidence: Confidence.HIGH, source: MemorySource.USER });
  } catch (e) {
    threw = true;
    assert(e.message.includes('type'), 'error mentions type');
  }
  assert(threw === true, 'throws on missing type');

  // Missing confidence
  threw = false;
  try {
    new MemoryEntry({ type: MemoryType.FACT, content: 'test', source: MemorySource.USER });
  } catch (e) {
    threw = true;
    assert(e.message.includes('confidence'), 'error mentions confidence');
  }
  assert(threw === true, 'throws on missing confidence');

  // Missing source
  threw = false;
  try {
    new MemoryEntry({ type: MemoryType.FACT, content: 'test', confidence: Confidence.HIGH });
  } catch (e) {
    threw = true;
    assert(e.message.includes('source'), 'error mentions source');
  }
  assert(threw === true, 'throws on missing source');

  // Missing content
  threw = false;
  try {
    new MemoryEntry({ type: MemoryType.FACT, confidence: Confidence.HIGH, source: MemorySource.USER });
  } catch (e) {
    threw = true;
    assert(e.message.includes('content'), 'error mentions content');
  }
  assert(threw === true, 'throws on missing content');

  // Invalid type
  threw = false;
  try {
    new MemoryEntry({ type: 'invalid', content: 'test', confidence: Confidence.HIGH, source: MemorySource.USER });
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'throws on invalid type');

  // Invalid source
  threw = false;
  try {
    new MemoryEntry({ type: MemoryType.FACT, content: 'test', confidence: Confidence.HIGH, source: 'invalid' });
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'throws on invalid source');

  // Static validation
  const validResult = MemoryEntry.validate({
    type: MemoryType.FACT,
    content: 'valid',
    confidence: Confidence.HIGH,
    source: MemorySource.USER,
  });
  assert(validResult.valid === true, 'validates valid entry');

  const invalidResult = MemoryEntry.validate({
    content: 'missing fields',
  });
  assert(invalidResult.valid === false, 'rejects invalid entry');
  assert(invalidResult.errors.length >= 3, 'reports all missing fields');
});

describe('v41.1: ProjectContext', () => {
  const context = new ProjectContext({
    projectId: 'test-project',
    name: 'Test Project',
    codeStyle: {
      indentation: 'spaces',
      indentSize: 2,
      quotes: 'single',
    },
  });

  assert(context.projectId === 'test-project', 'has projectId');
  assert(context.codeStyle.quotes === 'single', 'has codeStyle');

  // Add stack items
  context.addStackItem({
    id: 'typescript',
    name: 'TypeScript',
    category: StackCategory.LANGUAGE,
    version: '5.x',
  });

  context.addStackItem({
    id: 'react',
    name: 'React',
    category: StackCategory.FRAMEWORK,
    version: '18.x',
  });

  assert(context.uses('typescript'), 'checks stack item');
  assert(!context.uses('vue'), 'rejects missing stack item');

  const languages = context.getStackByCategory(StackCategory.LANGUAGE);
  assert(languages.length === 1, 'filters by category');

  const primaryLang = context.getPrimaryLanguage();
  assert(primaryLang.id === 'typescript', 'identifies primary language');

  // Add conventions
  context.addConvention({
    id: 'no-semicolons',
    type: ConventionType.CODE_STYLE,
    name: 'No Semicolons',
  });

  const conventions = context.getConventionsByType(ConventionType.CODE_STYLE);
  assert(conventions.length === 1, 'filters conventions by type');

  // Serialization
  const json = context.toJSON();
  const restored = ProjectContext.fromJSON(json);
  assert(restored.projectId === 'test-project', 'serializes and deserializes');
  assert(restored.uses('typescript'), 'preserves stack');
});

describe('v41.1: ProjectMemory', () => {
  const memory = new ProjectMemory({ projectId: 'memory-test' });

  // Add entries (now require source!)
  memory.rememberFact('The database is SQLite', { source: MemorySource.DETECTED, tags: ['database'] });
  memory.rememberPreference('Use functional style', { source: MemorySource.USER, tags: ['style'] });
  memory.rememberPattern('Error handling uses try/catch', { source: MemorySource.INFERRED, tags: ['errors'] });
  memory.rememberDecision('Chose SQLite over PostgreSQL for simplicity', {
    source: MemorySource.USER,
    tags: ['database', 'architecture'],
  });
  memory.rememberWarning('Avoid using eval()', { source: MemorySource.SYSTEM, tags: ['security'] });

  // Get by type
  const facts = memory.getByType(MemoryType.FACT);
  assert(facts.length === 1, 'retrieves by type');

  // Get by tag
  const dbEntries = memory.getByTag('database');
  assert(dbEntries.length === 2, 'retrieves by tag');

  // Get by multiple tags
  const dbArch = memory.getByTags(['database', 'architecture']);
  assert(dbArch.length === 1, 'retrieves by multiple tags');

  // Search
  const searchResults = memory.search('SQLite');
  assert(searchResults.length >= 1, 'searches memories');

  // Warnings
  const warnings = memory.getWarnings('eval');
  assert(warnings.length >= 1, 'retrieves warnings');

  // Relevant memories
  const relevant = memory.getRelevant('database error handling');
  assert(relevant.length >= 1, 'retrieves relevant memories');

  // Stats
  const stats = memory.getStats();
  assert(stats.total >= 5, 'tracks total entries');
  assert(stats.byType[MemoryType.FACT] >= 1, 'tracks by type');

  // Export/import
  const exported = memory.export();
  assert(exported.entries.length >= 5, 'exports entries');

  const newMemory = new ProjectMemory({ projectId: 'import-test' });
  const importResult = newMemory.import(exported);
  assert(importResult.imported >= 5, 'imports entries');
});

describe('v41.1: ProjectMemory requires source', () => {
  const memory = new ProjectMemory({ projectId: 'source-test' });

  // Test that convenience methods require source
  let threw = false;
  try {
    memory.rememberFact('Test fact without source', { tags: ['test'] });
  } catch (e) {
    threw = true;
    assert(e.message.includes('source'), 'error mentions source');
  }
  assert(threw === true, 'rememberFact throws without source');

  threw = false;
  try {
    memory.rememberDecision('Test decision without source', { tags: ['test'] });
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'rememberDecision throws without source');

  // Verify source is preserved
  const entry = memory.rememberFact('Test with source', {
    source: MemorySource.USER,
    tags: ['test'],
  });
  assert(entry.source === MemorySource.USER, 'source is preserved');
});

describe('v41.1: ProjectMemory supersede', () => {
  const memory = new ProjectMemory({ projectId: 'supersede-test' });

  const original = memory.rememberFact('Database is MySQL', { source: MemorySource.DETECTED, tags: ['db'] });
  const replacement = memory.supersede(original.id, {
    type: MemoryType.FACT,
    content: 'Database is PostgreSQL',
    confidence: Confidence.CERTAIN,
    source: MemorySource.USER,
    tags: ['db'],
  });

  assert(original.supersededBy === replacement.id, 'original marked as superseded');
  assert(original.isSuperseded() === true, 'isSuperseded returns true');

  // Superseded entries excluded from normal queries
  const facts = memory.getByType(MemoryType.FACT);
  const activeContents = facts.map(f => f.content);
  assert(!activeContents.includes('Database is MySQL'), 'superseded excluded from queries');
  assert(activeContents.includes('Database is PostgreSQL'), 'replacement included');
});

describe('v41.1: ProjectMemory cleanup', () => {
  const memory = new ProjectMemory({ projectId: 'cleanup-test' });

  memory.add({
    type: MemoryType.TIP,
    content: 'Old tip',
    confidence: Confidence.LOW,
    source: MemorySource.SYSTEM,
    expiresAt: Date.now() - 1000, // Expired
  });

  memory.rememberFact('Current fact', { source: MemorySource.USER });

  const removed = memory.cleanup({ removeExpired: true });
  assert(removed === 1, 'removes expired entries');
  assert(memory.getStats().total === 1, 'keeps non-expired entries');
});

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(`v41.x Skills Tests: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
