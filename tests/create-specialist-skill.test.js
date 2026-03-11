// v122: create-specialist Skill — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests skill JSON validity, transform step, meta-skill detection,
// loader singleton, and plugin boundary guards.

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Skill JSON Validity ────────────────────────────────────────────────────

suite('create-specialist: skill JSON validity');

const skillPath = path.join(ROOT, 'skills', 'create-specialist.json');
const raw = fs.readFileSync(skillPath, 'utf-8');
const skillDef = JSON.parse(raw);

test('skill JSON parses without error', () => {
  assert(skillDef, 'should parse');
  assertEqual(typeof skillDef, 'object');
});

test('has correct id', () => {
  assertEqual(skillDef.id, 'create-specialist');
});

test('has version 1', () => {
  assertEqual(skillDef.version, 1);
});

test('has name parameter (required)', () => {
  assert(skillDef.parameters?.name, 'should have name parameter');
  assertEqual(skillDef.parameters.name.type, 'string');
  assert(skillDef.parameters.name.required, 'name should be required');
});

test('has 10 steps', () => {
  assertEqual(skillDef.steps.length, 10);
});

test('all step types are valid', () => {
  const VALID_TYPES = new Set(['llm', 'template', 'write', 'shell', 'ask', 'review', 'validate', 'transform']);
  for (const step of skillDef.steps) {
    assert(VALID_TYPES.has(step.type), `step "${step.id}" has invalid type "${step.type}"`);
  }
});

test('step IDs are unique', () => {
  const ids = new Set();
  for (const step of skillDef.steps) {
    assert(!ids.has(step.id), `duplicate step ID: ${step.id}`);
    ids.add(step.id);
  }
});

test('has clarify ask step first', () => {
  assertEqual(skillDef.steps[0].id, 'clarify');
  assertEqual(skillDef.steps[0].type, 'ask');
});

test('has review step', () => {
  const review = skillDef.steps.find(s => s.type === 'review');
  assert(review, 'should have a review step');
});

test('has validate step', () => {
  const validate = skillDef.steps.find(s => s.type === 'validate');
  assert(validate, 'should have a validate step');
});

test('has sanitize transform step', () => {
  const sanitize = skillDef.steps.find(s => s.id === 'sanitize');
  assert(sanitize, 'should have sanitize step');
  assertEqual(sanitize.type, 'transform');
});

test('has two write steps (manifest + entry)', () => {
  const writes = skillDef.steps.filter(s => s.type === 'write');
  assertEqual(writes.length, 2, 'should have exactly 2 write steps');
  assert(writes[0].path.includes('specialist.json'), 'first write should be manifest');
  assert(writes[1].path.includes('index.js'), 'second write should be entry');
});

test('write paths use {{name}} substitution', () => {
  const writes = skillDef.steps.filter(s => s.type === 'write');
  for (const w of writes) {
    assert(w.path.includes('{{name}}'), `write step "${w.id}" should use {{name}} in path`);
  }
});

test('draft prompt includes capability explosion guard', () => {
  const draft = skillDef.steps.find(s => s.id === 'draft');
  assert(draft.prompt.includes('PREFERUJ'), 'draft prompt should prefer existing capabilities');
});

test('generate_code prompt forbids core imports', () => {
  const gen = skillDef.steps.find(s => s.id === 'generate_code');
  assert(gen.prompt.includes('../../src/'), 'generate_code prompt should mention ../../src/ prohibition');
});

// ─── Skill loads into registry ──────────────────────────────────────────────

suite('create-specialist: registry loading');

// Import SkillRegistry class from registry module
const { skillRegistry } = await import('../src/skills/registry.js');

await testAsync('skill loads into SkillRegistry without errors', async () => {
  // Load skills directory
  skillRegistry.load(path.join(ROOT, 'skills'), null);
  const skill = skillRegistry.get('create-specialist');
  assert(skill, 'create-specialist should be in registry');
  assertEqual(skill.id, 'create-specialist');
  assertEqual(skill.steps.length, 10);
});

// ─── Transform Step ─────────────────────────────────────────────────────────

suite('transform step: capability sanitization');

const { executeTransform, _testTransformInternals } = await import('../src/skills/steps/transform.js');

const baseContext = { params: {}, stepsOutput: {} };

await testAsync('alias normalization: tax.calculate → tax.compute', async () => {
  const stepDef = {
    id: 'test-transform',
    type: 'transform',
    content: '{"capabilities": ["tax.calculate", "vat.calculate"]}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assert(data.capabilities.includes('tax.compute'), 'tax.calculate should be normalized');
  assert(data.capabilities.includes('vat.compute'), 'vat.calculate should be normalized');
  assert(!data.capabilities.includes('tax.calculate'), 'original alias should be removed');
});

await testAsync('duplicate removal', async () => {
  const stepDef = {
    id: 'test-dedup',
    type: 'transform',
    content: '{"capabilities": ["tax.compute", "tax.compute", "vat.compute"]}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.capabilities.length, 2, 'should remove duplicate');
});

await testAsync('sorting (deterministic)', async () => {
  const stepDef = {
    id: 'test-sort',
    type: 'transform',
    content: '{"capabilities": ["vat.compute", "deadline.check", "tax.compute"]}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.capabilities[0], 'deadline.check');
  assertEqual(data.capabilities[1], 'tax.compute');
  assertEqual(data.capabilities[2], 'vat.compute');
});

await testAsync('non-capability fields untouched', async () => {
  const stepDef = {
    id: 'test-preserve',
    type: 'transform',
    content: '{"id": "my-spec", "name": "My Specialist", "capabilities": ["x.y"]}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.name, 'My Specialist');
});

await testAsync('invalid JSON → error', async () => {
  const stepDef = {
    id: 'test-invalid',
    type: 'transform',
    content: 'not json at all',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'error');
  assertEqual(result.errorType, 'validation');
});

await testAsync('empty capabilities array → pass-through', async () => {
  const stepDef = {
    id: 'test-empty',
    type: 'transform',
    content: '{"capabilities": []}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.capabilities.length, 0);
});

await testAsync('unknown alias kept as-is', async () => {
  const stepDef = {
    id: 'test-unknown',
    type: 'transform',
    content: '{"capabilities": ["translate.text", "analyze.code"]}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assert(data.capabilities.includes('translate.text'));
  assert(data.capabilities.includes('analyze.code'));
});

await testAsync('id slug sanitization', async () => {
  const stepDef = {
    id: 'test-slug',
    type: 'transform',
    content: '{"id": "My Spécialist!!", "capabilities": []}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.id, 'my-specialist');
});

await testAsync('tools sorted by id', async () => {
  const stepDef = {
    id: 'test-tools-sort',
    type: 'transform',
    content: '{"tools": [{"id": "z.beta"}, {"id": "a.alpha"}], "capabilities": []}',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assertEqual(data.tools[0].id, 'a.alpha');
  assertEqual(data.tools[1].id, 'z.beta');
});

await testAsync('missing content field → error', async () => {
  const stepDef = { id: 'test-no-content', type: 'transform' };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'error');
  assert(result.errorMessage.includes('missing'));
});

await testAsync('strips markdown code fences', async () => {
  const stepDef = {
    id: 'test-fences',
    type: 'transform',
    content: '```json\n{"capabilities": ["x.y"]}\n```',
  };
  const result = await executeTransform(stepDef, baseContext);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assert(data.capabilities.includes('x.y'));
});

await testAsync('substitution works in content', async () => {
  const ctx = { params: {}, stepsOutput: { refine: '{"capabilities": ["a.b"]}' } };
  const stepDef = {
    id: 'test-sub',
    type: 'transform',
    content: '{{steps.refine.output}}',
  };
  const result = await executeTransform(stepDef, ctx);
  assertEqual(result.status, 'success');
  const data = JSON.parse(result.output);
  assert(data.capabilities.includes('a.b'));
});

test('CAPABILITY_ALIASES exported for testing', () => {
  assert(_testTransformInternals.CAPABILITY_ALIASES, 'should export aliases');
  assertEqual(_testTransformInternals.CAPABILITY_ALIASES['tax.calculate'], 'tax.compute');
});

// ─── Meta-Skill Detection (regex-only, no heavy handler import) ─────────────
// Tests the patterns directly to avoid loading the full skill handler
// (which pulls in DB, LLM gateway, etc.)

suite('create-specialist: meta-skill detection');

// v122 patterns — mirror of META_SKILL_PATTERNS in skill.js
const CZ_SPECIALIST = /(?:chci|vytvo[rř]|ud[eě]lej|p[rř]idej|nov\S+)\s+speciali[sz]t[uyaá]?\s+(?:na|pro|o)\s+(.+)/i;
const EN_SPECIALIST = /(?:create|add|make|build)\s+(?:a\s+)?specialist\s+(?:for|about|on)\s+(.+)/i;
const CZ_EXPERTISE = /(?:chci|vytvo[rř]|ud[eě]lej|p[rř]idej|zaregistruj|nov[aáouyýé]{1,2})\s+expert[iyí]z[uyaá]?\s+(?:na|pro|o)\s+(.+)/i;
const CZ_SKILL = /(?:chci|vytvo[rř]|ud[eě]lej|p[rř]idej|nov[aáouyýé]{1,2})\s+skill\s+(?:na\s+|pro\s+)?(.+)/i;

function testDetect(input) {
  let m = CZ_SPECIALIST.exec(input);
  if (m) return { skillId: 'create-specialist', params: { name: m[1].trim().replace(/[.!?]+$/, '') } };
  m = EN_SPECIALIST.exec(input);
  if (m) return { skillId: 'create-specialist', params: { name: m[1].trim().replace(/[.!?]+$/, '') } };
  m = CZ_EXPERTISE.exec(input);
  if (m) return { skillId: 'create-expertise', params: { topic: m[1].trim().replace(/[.!?]+$/, '') } };
  m = CZ_SKILL.exec(input);
  if (m) return { skillId: 'create-skill', params: { name: m[1].trim().replace(/[.!?]+$/, '') } };
  return null;
}

test('Czech: "vytvoř specialistu na překlad"', () => {
  const result = testDetect('vytvoř specialistu na překlad');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'překlad');
});

test('Czech: "chci specialistu pro code review"', () => {
  const result = testDetect('chci specialistu pro code review');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'code review');
});

test('Czech: "nového specialistu na fitness"', () => {
  const result = testDetect('nového specialistu na fitness');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'fitness');
});

test('English: "create specialist for translation"', () => {
  const result = testDetect('create specialist for translation');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'translation');
});

test('English: "add specialist for code review"', () => {
  const result = testDetect('add specialist for code review');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'code review');
});

test('English: "build a specialist on data analysis"', () => {
  const result = testDetect('build a specialist on data analysis');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
  assertEqual(result.params.name, 'data analysis');
});

test('non-matching input returns null', () => {
  const result = testDetect('kolik je 2 + 2?');
  assertEqual(result, null, 'should not match');
});

test('existing patterns still work: create-expertise', () => {
  const result = testDetect('vytvoř expertizu na kuchařinu');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-expertise');
});

test('existing patterns still work: create-skill', () => {
  const result = testDetect('chci skill na code-review');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-skill');
});

test('specialist takes priority over generic patterns', () => {
  // "specialistu" should match specialist, not skill
  const result = testDetect('vytvoř specialistu na překlady');
  assert(result, 'should detect');
  assertEqual(result.skillId, 'create-specialist');
});

// ─── Loader Singleton ───────────────────────────────────────────────────────

suite('specialist-loader: getLoader()');

const { getLoader, SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

test('getLoader() is a function', () => {
  assert(typeof getLoader === 'function');
});

test('getLoader() returns null or instance', () => {
  const loader = getLoader();
  // May be null if no tests called getSpecialistLoader() yet
  // May be an instance if other test files initialized it
  if (loader !== null) {
    assert(loader instanceof SpecialistLoader, 'should be SpecialistLoader instance');
  } else {
    assert(true, 'null before boot is expected');
  }
});

// ─── Template Path Generation ───────────────────────────────────────────────

suite('create-specialist: template paths');

const { substitute } = await import('../src/skills/steps/substitute.js');

test('manifest path resolves correctly', () => {
  const result = substitute('specialists/{{name}}/specialist.json', { name: 'my-translator' }, {});
  assertEqual(result, 'specialists/my-translator/specialist.json');
});

test('entry path resolves correctly', () => {
  const result = substitute('specialists/{{name}}/index.js', { name: 'code-reviewer' }, {});
  assertEqual(result, 'specialists/code-reviewer/index.js');
});

test('path with diacritics in name', () => {
  // The write step sanitizer will handle diacritics
  const result = substitute('specialists/{{name}}/specialist.json', { name: 'překladatel' }, {});
  assertEqual(result, 'specialists/překladatel/specialist.json');
});

// ─── Plugin Boundary ────────────────────────────────────────────────────────

suite('create-specialist: plugin boundary');

test('generate_code prompt forbids ../../src/ imports', () => {
  const genStep = skillDef.steps.find(s => s.id === 'generate_code');
  assert(genStep, 'generate_code step should exist');
  assert(genStep.prompt.includes('../../src/'), 'prompt should mention prohibition');
  assert(genStep.prompt.includes('NIKDY'), 'prompt should use NIKDY for prohibition');
});

test('generate_code system prompt forbids core imports', () => {
  const genStep = skillDef.steps.find(s => s.id === 'generate_code');
  assert(genStep.systemPrompt.includes('../../src/'), 'system prompt should mention prohibition');
});

test('tool stubs in prompt return safe response', () => {
  const genStep = skillDef.steps.find(s => s.id === 'generate_code');
  assert(genStep.prompt.includes('not yet implemented') || genStep.prompt.includes('Tool not yet implemented'),
    'prompt should mention safe stub pattern');
});

// ─── Runner Integration ─────────────────────────────────────────────────────

suite('create-specialist: runner integration');

test('transform is in STEP_EXECUTORS', async () => {
  // Import runner to check that transform is registered
  // We check indirectly: the registry accepts 'transform' as valid step type
  const { skillRegistry: reg } = await import('../src/skills/registry.js');
  reg.load(path.join(ROOT, 'skills'), null);
  const skill = reg.get('create-specialist');
  assert(skill, 'create-specialist should load (transform type accepted)');
  const sanitize = skill.steps.find(s => s.type === 'transform');
  assert(sanitize, 'transform step should be present after registry validation');
});

// ─── Summary ────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
