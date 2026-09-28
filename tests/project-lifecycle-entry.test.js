// tests/project-lifecycle-entry.test.js — v123.3: Project lifecycle entry tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests GUARD 11 (DESIGN → BUILD escalation in project mode),
// isProjectScopeBuild broadened patterns, and DESIGN advisory exclusion.
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { _testCREInternals, IntentType } from '../src/chat/cre-decision.js';
import { isProjectScopeBuild } from '../src/chat/handlers/build-handoff.js';

const { DESIGN_BUILD_ESCALATION, DESIGN_ADVISORY } = _testCREInternals;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchesEscalation(input) {
  return DESIGN_BUILD_ESCALATION.some(p => p.test(input));
}

function matchesAdvisory(input) {
  return DESIGN_ADVISORY.some(p => p.test(input));
}

function shouldEscalate(input) {
  return matchesEscalation(input) && !matchesAdvisory(input);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1: DESIGN_BUILD_ESCALATION patterns
// ═══════════════════════════════════════════════════════════════════════════════

suite('DESIGN_BUILD_ESCALATION Patterns');

test('CZ: chci vytvořit mobilní aplikaci', () => {
  assert(matchesEscalation('chci vytvořit mobilní aplikaci'), 'should match');
});

test('CZ: chci udělat mobilní appku', () => {
  assert(matchesEscalation('chci udělat mobilní appku'), 'should match mobilní + app');
});

test('CZ: chci vytvořit webovou aplikaci', () => {
  assert(matchesEscalation('chci vytvořit webovou aplikaci'), 'should match');
});

test('CZ: chci vytvořit webový systém', () => {
  assert(matchesEscalation('chci vytvořit webový systém'), 'should match');
});

test('CZ: chci udělat webovou stránku', () => {
  assert(matchesEscalation('chci udělat webovou stránku'), 'should match');
});

test('CZ: chci postavit novou platformu', () => {
  assert(matchesEscalation('chci postavit novou platformu'), 'should match');
});

test('CZ: chci vytvořit flutter appku', () => {
  assert(matchesEscalation('chci vytvořit flutter appku'), 'should match flutter');
});

test('CZ: chci vytvořit android aplikaci', () => {
  assert(matchesEscalation('chci vytvořit android aplikaci'), 'should match android');
});

test('CZ no-diacritics: chci vytvorit mobilni aplikaci', () => {
  assert(matchesEscalation('chci vytvorit mobilni aplikaci'), 'no-diacritics should match');
});

test('CZ no-diacritics: chci udelat web', () => {
  assert(matchesEscalation('chci udelat web'), 'no-diacritics web should match');
});

test('EN: I want to create a mobile app', () => {
  assert(matchesEscalation('I want to create a mobile app'), 'EN should match');
});

test('EN: want to build a web application', () => {
  assert(matchesEscalation('want to build a web application'), 'EN build should match');
});

test('EN: I want to develop a new platform', () => {
  assert(matchesEscalation('I want to develop a new platform'), 'EN develop should match');
});

test('does NOT match plain question', () => {
  assert(!matchesEscalation('co je mobilní aplikace?'), 'question should not match');
});

test('does NOT match search', () => {
  assert(!matchesEscalation('najdi mi mobilní aplikaci'), 'search should not match');
});

test('does NOT match greeting', () => {
  assert(!matchesEscalation('ahoj, jak se máš?'), 'greeting should not match');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2: DESIGN_ADVISORY patterns (should NOT escalate)
// ═══════════════════════════════════════════════════════════════════════════════

suite('DESIGN_ADVISORY Patterns');

test('CZ: navrhni schéma databáze', () => {
  assert(matchesAdvisory('navrhni schéma databáze'), 'schema should be advisory');
});

test('CZ: navrhni api endpoint', () => {
  assert(matchesAdvisory('navrhni api endpoint'), 'api endpoint should be advisory');
});

test('CZ: udělej roadmapu', () => {
  assert(matchesAdvisory('udělej roadmapu'), 'roadmap should be advisory');
});

test('CZ: vytvoř plán projektu', () => {
  assert(matchesAdvisory('vytvoř plán projektu'), 'plan should be advisory');
});

test('CZ: jaký stack bys doporučil', () => {
  assert(matchesAdvisory('jaký stack bys doporučil'), 'stack question should be advisory');
});

test('CZ: jaká technologie je lepší', () => {
  assert(matchesAdvisory('jaká technologie je lepší'), 'tech question should be advisory');
});

test('CZ: doporuč framework', () => {
  assert(matchesAdvisory('doporuč framework'), 'recommendation should be advisory');
});

test('CZ: navrhni jak to řešit', () => {
  assert(matchesAdvisory('navrhni jak to řešit'), 'strategy should be advisory');
});

test('CZ: navrhni postup implementace', () => {
  assert(matchesAdvisory('navrhni postup implementace'), 'procedure should be advisory');
});

test('advisory does NOT match build requests', () => {
  assert(!matchesAdvisory('chci vytvořit mobilní aplikaci'), 'build request should NOT be advisory');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3: Combined escalation logic (shouldEscalate)
// ═══════════════════════════════════════════════════════════════════════════════

suite('Combined Escalation Logic');

test('chci vytvořit mobilní aplikaci → escalate', () => {
  assert(shouldEscalate('chci vytvořit mobilní aplikaci'), 'should escalate');
});

test('navrhni schéma databáze → NO escalation', () => {
  assert(!shouldEscalate('navrhni schéma databáze'), 'advisory should not escalate');
});

test('udělej roadmapu → NO escalation', () => {
  assert(!shouldEscalate('udělej roadmapu'), 'roadmap should not escalate');
});

test('jaký stack bys doporučil → NO escalation', () => {
  assert(!shouldEscalate('jaký stack bys doporučil'), 'stack question should not escalate');
});

test('chci vytvořit webovou aplikaci → escalate', () => {
  assert(shouldEscalate('chci vytvořit webovou aplikaci'), 'web app should escalate');
});

test('want to build a web application → escalate', () => {
  assert(shouldEscalate('want to build a web application'), 'EN should escalate');
});

test('pozdrav → NO escalation', () => {
  assert(!shouldEscalate('ahoj, jak se máš'), 'greeting should not escalate');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4: isProjectScopeBuild broadened patterns
// ═══════════════════════════════════════════════════════════════════════════════

suite('isProjectScopeBuild — Broadened Patterns');

test('chci vytvořit mobilní aplikaci → project scope', () => {
  assert(isProjectScopeBuild('chci vytvořit mobilní aplikaci'), 'mobile app should be project scope');
});

test('chci vytvořit webovou aplikaci → project scope', () => {
  assert(isProjectScopeBuild('chci vytvořit webovou aplikaci'), 'web app should be project scope');
});

test('chci udělat android aplikaci → project scope', () => {
  assert(isProjectScopeBuild('chci udělat android aplikaci'), 'android should be project scope');
});

test('chci vytvořit flutter appku → project scope', () => {
  assert(isProjectScopeBuild('chci vytvořit flutter appku'), 'flutter should be project scope');
});

test('mobilní aplikace pro správu úkolů → project scope', () => {
  assert(isProjectScopeBuild('mobilní aplikace pro správu úkolů'), 'mobile app keyword should match');
});

test('mobile app for task management → project scope', () => {
  assert(isProjectScopeBuild('mobile app for task management'), 'EN mobile app should match');
});

test('web application with authentication → project scope', () => {
  assert(isProjectScopeBuild('web application with authentication'), 'EN web application should match');
});

test('webová aplikace s autentikací → project scope', () => {
  assert(isProjectScopeBuild('webová aplikace s autentikací'), 'CZ webová aplikace should match');
});

test('no-diacritics: chci vytvorit mobilni aplikaci → project scope', () => {
  assert(isProjectScopeBuild('chci vytvorit mobilni aplikaci'), 'no-diacritics should match');
});

// Existing patterns still work
test('existing: celý projekt → project scope', () => {
  assert(isProjectScopeBuild('celý projekt na e-shop'), 'existing celý projekt pattern');
});

test('existing: kompletní systém → project scope', () => {
  assert(isProjectScopeBuild('kompletní systém pro správu'), 'existing kompletní systém pattern');
});

test('existing: e-shop → project scope', () => {
  assert(isProjectScopeBuild('e-shop pro prodej knih'), 'existing e-shop pattern');
});

test('existing: end-to-end → project scope', () => {
  assert(isProjectScopeBuild('end-to-end solution'), 'existing end-to-end pattern');
});

// Should NOT match simple component requests
test('postav API endpoint → NOT project scope', () => {
  assert(!isProjectScopeBuild('postav API endpoint'), 'single component should not be project scope');
});

test('scaffoldni Express server → NOT project scope', () => {
  assert(!isProjectScopeBuild('scaffoldni Express server'), 'scaffold should not be project scope');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5: Edge cases and no-match
// ═══════════════════════════════════════════════════════════════════════════════

suite('Edge Cases');

test('empty string → no match', () => {
  assert(!matchesEscalation(''), 'empty should not match');
  assert(!matchesAdvisory(''), 'empty should not match advisory');
  assert(!shouldEscalate(''), 'empty should not escalate');
});

test('very long input preserves matching', () => {
  const long = 'chci vytvořit mobilní aplikaci ' + 'pro správu '.repeat(50);
  assert(matchesEscalation(long), 'long input should still match');
});

test('case insensitive', () => {
  assert(matchesEscalation('CHCI VYTVOŘIT MOBILNÍ APLIKACI'), 'uppercase should match');
  assert(matchesAdvisory('NAVRHNI SCHÉMA DATABÁZE'), 'uppercase advisory should match');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
if (results.failed > 0) process.exit(1);
