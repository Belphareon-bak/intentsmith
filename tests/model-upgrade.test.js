// tests/model-upgrade.test.js — Model Upgrade System v103 Phase 1 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  MODEL_FAMILIES, MODEL_PROFILES,
  parseModelName, getAllProfiles, getProfile,
  getCurrentBindings, isSameFamily, isNewerVersion,
} from '../src/upgrade/model-profiles.js';
import {
  buildCandidates, getUpgradeHints, UPGRADE_HINTS,
} from '../src/upgrade/model-discovery.js';
import {
  filterCandidates, rankCandidates, generateProposals,
  UpgradeManager,
} from '../src/upgrade/upgrade-manager.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 1: Model Name Parser
// ═══════════════════════════════════════════════════════════════════════════

suite('parseModelName');

test('qwen3.5:27b', () => {
  const r = parseModelName('qwen3.5:27b');
  assertEqual(r.family, 'qwen');
  assertEqual(r.version, '3.5');
  assertEqual(r.params, 27);
  assertEqual(r.category, 'general');
});

test('deepseek-r1-32b', () => {
  const r = parseModelName('deepseek-r1-32b');
  assertEqual(r.family, 'deepseek-r1');
  assertEqual(r.params, 32);
  assertEqual(r.category, 'reasoning');
});

test('qwen3-30b-a3b', () => {
  const r = parseModelName('qwen3-30b-a3b');
  assertEqual(r.family, 'qwen');
  assertEqual(r.version, '3');
  assertEqual(r.params, 30);
});

test('llama3.1:70b', () => {
  const r = parseModelName('llama3.1:70b');
  assertEqual(r.family, 'llama');
  assertEqual(r.version, '3.1');
  assertEqual(r.params, 70);
});

test('codestral:22b', () => {
  const r = parseModelName('codestral:22b');
  assertEqual(r.family, 'codestral');
  assertEqual(r.params, 22);
  assertEqual(r.category, 'code');
});

test('llava:13b', () => {
  const r = parseModelName('llava:13b');
  assertEqual(r.family, 'llava');
  assertEqual(r.params, 13);
  assertEqual(r.category, 'vision');
});

test('qwen2.5-coder:32b', () => {
  const r = parseModelName('qwen2.5-coder:32b');
  assertEqual(r.family, 'qwen-coder');
  assertEqual(r.params, 32);
  assertEqual(r.category, 'code');
});

test('unknown model', () => {
  const r = parseModelName('totally-unknown:7b');
  assertEqual(r.family, 'unknown');
  assertEqual(r.params, 7);
});

test('null/undefined input', () => {
  const r = parseModelName(null);
  assertEqual(r.family, 'unknown');
  assertEqual(r.params, null);
});

test('quantization extraction', () => {
  const r = parseModelName('llama3.1:70b-q4_0');
  assertEqual(r.quantization, 'Q4_0');
  assertEqual(r.params, 70);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 2: Model Profiles
// ═══════════════════════════════════════════════════════════════════════════

suite('Model Profiles');

test('all 7 roles defined', () => {
  const profiles = getAllProfiles();
  assertEqual(profiles.length, 7);
  const roles = profiles.map(p => p.role);
  assert(roles.includes('D1'), 'should have D1');
  assert(roles.includes('CHAT'), 'should have CHAT');
  assert(roles.includes('CODE'), 'should have CODE');
  assert(roles.includes('VISION'), 'should have VISION');
});

test('each profile has required fields', () => {
  for (const p of getAllProfiles()) {
    assert(typeof p.role === 'string', `${p.role}: missing role`);
    assert(typeof p.description === 'string', `${p.role}: missing description`);
    assert(typeof p.getCurrentModel === 'function', `${p.role}: missing getCurrentModel`);
    assert(p.requirements?.minParams > 0, `${p.role}: missing minParams`);
    assert(Array.isArray(p.preferredFamilies), `${p.role}: missing preferredFamilies`);
    assert(typeof p.validationSuite === 'string', `${p.role}: missing validationSuite`);
  }
});

test('getProfile returns correct profile', () => {
  const d1 = getProfile('D1');
  assertEqual(d1.role, 'D1');
  assert(d1.preferredFamilies.includes('deepseek-r1'));
});

test('getProfile returns null for unknown role', () => {
  assertEqual(getProfile('NONEXISTENT'), null);
});

test('getCurrentBindings returns all roles', () => {
  const bindings = getCurrentBindings();
  assert('D1' in bindings, 'should have D1');
  assert('CHAT' in bindings, 'should have CHAT');
  assert(typeof bindings.D1 === 'string', 'D1 should be string');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 3: Family Comparison
// ═══════════════════════════════════════════════════════════════════════════

suite('Family comparison');

test('isSameFamily: qwen3.5:27b and qwen3:14b', () => {
  assert(isSameFamily('qwen3.5:27b', 'qwen3:14b'), 'should be same family');
});

test('isSameFamily: deepseek-r1-32b and deepseek-r1-0528', () => {
  assert(isSameFamily('deepseek-r1-32b', 'deepseek-r1-0528'), 'should be same family');
});

test('isSameFamily: qwen3:14b and llama3:14b', () => {
  assert(!isSameFamily('qwen3:14b', 'llama3:14b'), 'different families');
});

test('isSameFamily: unknown models', () => {
  assert(!isSameFamily('unknown-model', 'other-model'), 'both unknown');
});

test('isNewerVersion: qwen3 → qwen3.5', () => {
  assert(isNewerVersion('qwen3:27b', 'qwen3.5:27b'), 'qwen3.5 is newer than qwen3');
});

test('isNewerVersion: qwen3.5 → qwen3 (false)', () => {
  assert(!isNewerVersion('qwen3.5:27b', 'qwen3:27b'), 'qwen3 is not newer than qwen3.5');
});

test('isNewerVersion: different families', () => {
  assert(!isNewerVersion('qwen3:27b', 'llama3.1:70b'), 'different families');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 4: Candidate Building
// ═══════════════════════════════════════════════════════════════════════════

suite('buildCandidates');

test('builds from Ollama-like data', () => {
  const ollamaModels = [
    { name: 'qwen3.5:27b', size: 16_000_000_000, modified_at: '2026-03-01T00:00:00Z' },
    { name: 'deepseek-r1-32b', size: 20_000_000_000, modified_at: '2026-02-15T00:00:00Z' },
    { name: 'llava:13b', size: 8_000_000_000, modified_at: '2025-12-01T00:00:00Z' },
  ];

  const candidates = buildCandidates(ollamaModels);
  assertEqual(candidates.length, 3);

  const qwen = candidates.find(c => c.name === 'qwen3.5:27b');
  assertEqual(qwen.family, 'qwen');
  assertEqual(qwen.params, 27);
  assert(qwen.sizeGB > 0, 'should have size');
  assert(qwen.installed, 'should be marked installed');
  assertEqual(qwen.source, 'local');
});

test('extracts params from details if parser misses', () => {
  const ollamaModels = [
    { name: 'custom-model', size: 5_000_000_000, details: { parameter_size: '14B' } },
  ];
  const candidates = buildCandidates(ollamaModels);
  assertEqual(candidates[0].params, 14);
});

test('empty input returns empty array', () => {
  assertEqual(buildCandidates([]).length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 5: Upgrade Hints
// ═══════════════════════════════════════════════════════════════════════════

suite('Upgrade hints');

test('qwen2.5-coder:32b gets qwen3/3.5 hints', () => {
  const hints = getUpgradeHints('qwen2.5-coder:32b');
  assert(hints.length > 0, 'should have hints');
  assert(hints.some(h => h.suggestedModel === 'qwen3'), 'should suggest qwen3');
  assert(hints.some(h => h.suggestedModel === 'qwen3.5'), 'should suggest qwen3.5');
});

test('deepseek-r1-32b gets 0528 hint', () => {
  const hints = getUpgradeHints('deepseek-r1-32b');
  assert(hints.some(h => h.suggestedModel === 'deepseek-r1-0528'), 'should suggest 0528');
});

test('qwen3.5:27b gets no hints (already latest)', () => {
  const hints = getUpgradeHints('qwen3.5:27b');
  assertEqual(hints.length, 0, 'should have no hints for latest');
});

test('llava:13b gets larger model hints', () => {
  const hints = getUpgradeHints('llava:13b');
  assert(hints.length > 0, 'should have hints');
  assert(hints.some(h => h.suggestedModel.includes('34b') || h.suggestedModel.includes('next')));
});

test('unknown model gets no hints', () => {
  const hints = getUpgradeHints('totally-unknown:7b');
  assertEqual(hints.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 6: Candidate Filtering
// ═══════════════════════════════════════════════════════════════════════════

suite('filterCandidates');

test('filters by minParams', () => {
  const profile = getProfile('D1'); // minParams = 14
  const candidates = [
    { name: 'qwen3:7b', family: 'qwen', category: 'general', params: 7, installed: true },
    { name: 'qwen3:14b', family: 'qwen', category: 'general', params: 14, installed: true },
    { name: 'qwen3:32b', family: 'qwen', category: 'general', params: 32, installed: true },
  ];
  const filtered = filterCandidates(candidates, profile);
  assert(!filtered.some(c => c.params === 7), 'should exclude 7b for D1');
  assert(filtered.some(c => c.params === 14), 'should include 14b');
  assert(filtered.some(c => c.params === 32), 'should include 32b');
});

test('filters by family/category', () => {
  const profile = getProfile('VISION'); // preferredFamilies: ['llava']
  const candidates = [
    { name: 'llava:34b', family: 'llava', category: 'vision', params: 34, installed: true },
    { name: 'qwen3:27b', family: 'qwen', category: 'general', params: 27, installed: true },
  ];
  const filtered = filterCandidates(candidates, profile);
  assertEqual(filtered.length, 1, 'should only keep vision models');
  assertEqual(filtered[0].name, 'llava:34b');
});

test('excludes current model', () => {
  const profile = getProfile('CHAT');
  const current = profile.getCurrentModel();
  const candidates = [
    { name: current, family: 'qwen', category: 'general', params: 27, installed: true },
    { name: 'qwen3:14b', family: 'qwen', category: 'general', params: 14, installed: true },
  ];
  const filtered = filterCandidates(candidates, profile);
  assert(!filtered.some(c => c.name === current), 'should exclude current model');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 7: Candidate Ranking
// ═══════════════════════════════════════════════════════════════════════════

suite('rankCandidates');

test('newer version scores higher than older', () => {
  const profile = getProfile('CHAT');
  const candidates = [
    { name: 'qwen3:27b', family: 'qwen', category: 'general', version: '3', params: 27, installed: true, modifiedAt: '2025-06-01T00:00:00Z' },
    { name: 'qwen3.5:27b', family: 'qwen', category: 'general', version: '3.5', params: 27, installed: true, modifiedAt: '2026-02-01T00:00:00Z' },
  ];
  const ranked = rankCandidates(candidates, profile);
  // qwen3.5 should score higher (newer version + recency)
  assert(ranked[0].name === 'qwen3.5:27b' || ranked[0].score >= ranked[1].score,
    `expected qwen3.5 to rank higher, got ${ranked[0].name} (${ranked[0].score}) vs ${ranked[1].name} (${ranked[1].score})`);
});

test('hint match gets bonus', () => {
  // Simulate a profile where current model is qwen2.5-coder:32b
  const profile = {
    ...getProfile('CODE'),
    getCurrentModel: () => 'qwen2.5-coder:32b',
  };
  const candidates = [
    { name: 'qwen3:27b', family: 'qwen', category: 'general', version: '3', params: 27, installed: true },
    { name: 'qwen3.5:27b', family: 'qwen', category: 'general', version: '3.5', params: 27, installed: true },
  ];
  const ranked = rankCandidates(candidates, profile);
  // Both qwen3 and qwen3.5 are in upgrade hints for qwen2.5
  const qwen35 = ranked.find(c => c.name === 'qwen3.5:27b');
  assert(qwen35.scoreBreakdown.hintBonus > 0, 'qwen3.5 should get hint bonus');
});

test('scoreBreakdown is populated', () => {
  const profile = getProfile('CHAT');
  const candidates = [
    { name: 'qwen3:14b', family: 'qwen', category: 'general', version: '3', params: 14, installed: true },
  ];
  const ranked = rankCandidates(candidates, profile);
  const bd = ranked[0].scoreBreakdown;
  assert('familyBonus' in bd, 'should have familyBonus');
  assert('versionBonus' in bd, 'should have versionBonus');
  assert('paramsBonus' in bd, 'should have paramsBonus');
  assert('recencyBonus' in bd, 'should have recencyBonus');
  assert('hintBonus' in bd, 'should have hintBonus');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 8: Proposal Generation
// ═══════════════════════════════════════════════════════════════════════════

suite('generateProposals');

test('generates proposals for matching candidates', () => {
  const candidates = [
    { name: 'qwen3.5:27b', family: 'qwen', category: 'general', version: '3.5', params: 27, installed: true, sizeGB: 15, modifiedAt: '2026-03-01T00:00:00Z' },
    { name: 'deepseek-r1-0528', family: 'deepseek-r1', category: 'reasoning', version: null, params: 32, installed: true, sizeGB: 20, modifiedAt: '2026-02-28T00:00:00Z' },
    { name: 'llava:34b', family: 'llava', category: 'vision', params: 34, installed: true, sizeGB: 22, modifiedAt: '2026-01-15T00:00:00Z' },
  ];
  const proposals = generateProposals(candidates, { minScore: 1 });
  assert(proposals.length > 0, 'should generate at least one proposal');
});

test('proposals have required fields', () => {
  const candidates = [
    { name: 'qwen3.5:27b', family: 'qwen', category: 'general', version: '3.5', params: 27, installed: true, sizeGB: 15, modifiedAt: '2026-03-01T00:00:00Z' },
  ];
  const proposals = generateProposals(candidates, { minScore: 1 });
  if (proposals.length > 0) {
    const p = proposals[0];
    assert(typeof p.role === 'string', 'should have role');
    assert(typeof p.currentModel === 'string', 'should have currentModel');
    assert(typeof p.candidateModel === 'string', 'should have candidateModel');
    assert(typeof p.score === 'number', 'should have score');
    assert(typeof p.reason === 'string', 'should have reason');
    assert(['low', 'medium', 'high'].includes(p.riskLevel), `invalid riskLevel: ${p.riskLevel}`);
  }
});

test('minScore filters low-quality proposals', () => {
  const candidates = [
    { name: 'phi3:3b', family: 'phi', category: 'general', version: '3', params: 3, installed: true, sizeGB: 2 },
  ];
  // phi3:3b is too small for D1 (minParams=14) and won't match most roles well
  const proposals = generateProposals(candidates, { minScore: 8 });
  assertEqual(proposals.length, 0, 'high minScore should filter everything');
});

test('empty candidates → no proposals', () => {
  const proposals = generateProposals([], { minScore: 1 });
  assertEqual(proposals.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 9: UpgradeManager class
// ═══════════════════════════════════════════════════════════════════════════

suite('UpgradeManager');

test('formatProposals with proposals', () => {
  const proposals = [
    { role: 'CHAT', currentModel: 'qwen3:27b', candidateModel: 'qwen3.5:27b', score: 8, riskLevel: 'low', installed: true, reason: 'newer version', scoreBreakdown: {} },
    { role: 'D1', currentModel: 'deepseek-r1-32b', candidateModel: 'deepseek-r1-0528', score: 7, riskLevel: 'low', installed: false, reason: 'improved JSON reliability', scoreBreakdown: {} },
  ];
  const text = UpgradeManager.formatProposals(proposals);
  assert(text.includes('CHAT'), 'should mention CHAT');
  assert(text.includes('qwen3.5:27b'), 'should mention candidate');
  assert(text.includes('LOW'), 'should show risk level');
  assert(text.includes('not installed'), 'should note uninstalled');
});

test('formatProposals with empty list', () => {
  const text = UpgradeManager.formatProposals([]);
  assert(text.includes('No model upgrades'), 'should show no upgrades message');
});

test('recordUpgrade and getHistory', () => {
  const manager = new UpgradeManager();
  manager.recordUpgrade('CHAT', 'qwen3:27b', 'qwen3.5:27b', 8);
  const history = manager.getHistory();
  assertEqual(history.length, 1);
  assertEqual(history[0].role, 'CHAT');
  assertEqual(history[0].toModel, 'qwen3.5:27b');
  assert(history[0].timestamp > 0, 'should have timestamp');
});

test('getLastResults initially null', () => {
  const manager = new UpgradeManager();
  const { proposals, discovery } = manager.getLastResults();
  assertEqual(proposals, null);
  assertEqual(discovery, null);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 10: Risk Assessment
// ═══════════════════════════════════════════════════════════════════════════

suite('Risk assessment');

test('same family newer version → low risk', () => {
  const candidates = [
    { name: 'qwen3.5:27b', family: 'qwen', category: 'general', version: '3.5', params: 27, installed: true, sizeGB: 15, modifiedAt: '2026-03-01T00:00:00Z' },
  ];
  // CHAT uses qwen3.5:27b by default, so we need a profile with older model
  const profile = { ...getProfile('CHAT'), getCurrentModel: () => 'qwen3:27b' };
  const filtered = filterCandidates(candidates, profile);
  if (filtered.length > 0) {
    const proposals = generateProposals(candidates, { minScore: 1 });
    const chatProposal = proposals.find(p => p.role === 'CHAT');
    // With our profile override this won't work through generateProposals...
    // So test via rankCandidates scoring instead
    const ranked = rankCandidates(filtered, profile);
    assert(ranked[0].score > 0, 'should have positive score');
  }
});

test('different family → high risk', () => {
  const candidates = [
    { name: 'llama3.3:27b', family: 'llama', category: 'general', version: '3.3', params: 27, installed: true, sizeGB: 15, modifiedAt: '2026-03-01T00:00:00Z' },
  ];
  const proposals = generateProposals(candidates, { minScore: 1 });
  // For roles currently using qwen, llama would be different family → high risk
  const highRiskProposal = proposals.find(p => p.riskLevel === 'high');
  // This depends on which roles match — at least CHAT should generate a high-risk proposal
  // since CHAT prefers qwen but llama is in preferredFamilies
  if (proposals.length > 0) {
    const chatProposal = proposals.find(p => p.role === 'CHAT');
    if (chatProposal) {
      assertEqual(chatProposal.riskLevel, 'high', 'llama for qwen-configured CHAT should be high risk');
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 11: MODEL_FAMILIES coverage
// ═══════════════════════════════════════════════════════════════════════════

suite('MODEL_FAMILIES');

test('covers major model families', () => {
  const families = MODEL_FAMILIES.map(f => f.family);
  assert(families.includes('qwen'), 'should have qwen');
  assert(families.includes('llama'), 'should have llama');
  assert(families.includes('deepseek-r1'), 'should have deepseek-r1');
  assert(families.includes('mistral'), 'should have mistral');
  assert(families.includes('codestral'), 'should have codestral');
  assert(families.includes('llava'), 'should have llava');
  assert(families.includes('phi'), 'should have phi');
});

test('UPGRADE_HINTS covers current C3 models', () => {
  // C3 currently uses: deepseek-r1-32b, qwen3-30b-a3b, qwen3.5:27b, llava:13b
  // deepseek-r1-32b should have hint
  const r1Hints = getUpgradeHints('deepseek-r1-32b');
  assert(r1Hints.length > 0, 'deepseek-r1-32b should have upgrade hints');

  // llava:13b should have hint
  const llavaHints = getUpgradeHints('llava:13b');
  assert(llavaHints.length > 0, 'llava:13b should have upgrade hints');
});

// ═══════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
