// Frozen historical C3 repairs for WP-GPU-HUNT-EVALUATION-CONTRACT §8.5.
// This controller-side file is NEVER mounted in an evaluated attempt.
export const c3Revision = '379c2e4';
const cre = 'src/chat/cre-decision.js';
export const cases = [
  { id: 'search-report', fix: 'cc4bc3e', files: [cre], test: 'tests/cre-report-sticky-break.test.js', group: 'cre-routing',
    requirement: 'Czech requests to find something, with or without accents, must start SEARCH even after REPORT. Preserve stop-report handling and diagnostic initial/final intent; do not turn ordinary conversation into SEARCH.',
    alternative: [['/naj[íi]t/i', '/naj(?:í|i)t/i']] },
  { id: 'build-arbitration', fix: 'faf6fa5', files: [cre], test: 'tests/cre-build-arbitration.test.js', group: 'cre-routing',
    requirement: 'A strong deterministic BUILD request must override an accepted conflicting LLM intent and return PLAN. Audit exactly one override with source llm_to_build_deterministic_arbitration and preserve original LLM intent. Ordinary discussion or design about deployment stays non-BUILD.',
    alternative: [['if (llmMeta && intent !== IntentType.BUILD)', 'if (intent !== IntentType.BUILD && llmMeta)']] },
  { id: 'manual-scheduler', fix: 'e55b6af', files: ['src/agents/scheduler.js'], test: 'tests/scheduler.test.js', group: 'scheduler-concurrency',
    requirement: 'triggerAgent must mark a manual execution in flight until its promise settles, reject duplicate manual execution, and make checkDue skip the running agent. Clear the guard on success and rejection. Preserve force:true and isManual:true.',
    alternative: [['return await this.runner.execute(agentId, { force: true, isManual: true });', 'const result = await this.runner.execute(agentId, { force: true, isManual: true });\n      return result;']] },
  { id: 'specialist-cleanup', fix: '6442152', files: ['src/expertises/scenario-engine.js', 'src/specialists/specialist-loader.js'], test: 'tests/specialist-loader.test.js', group: 'specialist-lifecycle',
    requirement: 'Disabling a specialist must remove its tools and scenarios even when unregister throws or is incomplete. Respect the primary expertise ID in its manifest. Add ScenarioRegistry.unregisterBySpecialist(id), SpecialistLoader.setScenarioRegistry(registry), and checkIntegrity() returning {ok,issues}, detecting missing and ghost registrations. Repeated boot/disable must be safe; re-enabling restores the tools.',
    alternative: [['this._bySpecialist.get(specialistId) || []', 'this._bySpecialist.has(specialistId) ? this._bySpecialist.get(specialistId) : []']] },
  { id: 'expertise-categories', fix: 'c170767', files: ['src/expertises/expertise-layer.js'], group: 'audit-c170',
    requirement: 'getExpertiseCategories must not advertise a built-in expertise which is absent from BUILTIN_EXPERTISES. Preserve category IDs, labels, and all existing valid members; accountant is an optional specialist, not a built-in. Do not invent a built-in accountant.',
    testBody: `import assert from 'node:assert/strict';
import {getExpertiseCategories, BUILTIN_EXPERTISES} from './src/expertises/expertise-layer.js';
const categories = getExpertiseCategories();
assert(categories.length >= 4);
assert.deepEqual(categories.find(c => c.id === 'analytical').experts, ['analyst','trader']);
for (const c of categories) for (const id of c.experts) assert(BUILTIN_EXPERTISES[id], 'Unknown built-in: ' + id);
assert(!BUILTIN_EXPERTISES.accountant);
assert(categories.some(c => c.experts.includes('lawyer')));
assert(categories.some(c => c.experts.includes('developer')));
`, alternative: [["experts: ['analyst', 'trader']", "experts: ['analyst', 'trader', 'accountant'].filter(id => Boolean(BUILTIN_EXPERTISES[id]))"]] },
  { id: 'java-javadoc', fix: '2c5f175', files: ['src/planner/quality-gate.js'], group: 'java-structural-validation',
    requirement: 'Java structural quality checks must match the real declaration instead of the word class inside Javadoc. Accept public final classes, abstract classes, interfaces and enums with matching filename; continue rejecting filename mismatch, missing package and unbalanced braces. This is structural validation, not a Java compiler.',
    testBody: String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runQualityGate} from './src/planner/quality-gate.js';
const root = fs.mkdtempSync('/tmp/java-pilot-');
for (const [code, expected] of [
 ['package sample;\n/** class Wrong is documentation. */\npublic final class Widget { public int value() { return 1; } }',true],
 ['package sample;\n/** class Wrong docs */\npublic abstract class Widget {}',true],
 ['package sample;\npublic interface Widget { int value(); }',true],
 ['package sample;\npublic enum Widget { FIRST, SECOND }',true],
 ['package sample;\npublic class Wrong {}',false],
 ['public class Widget {}',false],
 ['package sample;\npublic class Widget {',false],
]) {
 fs.writeFileSync(root + '/Widget.java', code);
 const r = await runQualityGate(root, {}, ['Widget.java']);
 assert.equal(r.passed, expected, JSON.stringify({code, result:r}));
}
`, alternative: [['(?:class|interface|enum)\\s+(\\w+)/m', '(?:interface|enum|class)\\s+(\\w+)/m']] },
  { id: 'structured-code', fix: '486b556', files: ['src/planner/code-cleaner.js'], group: 'structured-provider-content',
    requirement: 'stripCodeFences must extract code from a string, an array of string/text/content parts, or an object with text/content/message. Preserve plain-string fence removal and null/empty behavior; fallback to String for other inputs. repairCode must pass structured model content through this same extraction, not stringify it first.',
    testBody: `import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripCodeFences,repairCode} from './src/planner/code-cleaner.js';
for (const input of ['const a = 1;', {text:'const a = 1;'}, {content:'const a = 1;'}, {message:'const a = 1;'}, ['const ', {text:'a = '}, {content:'1;'}]]) assert.equal(stripCodeFences(input,'.js'), 'const a = 1;');
assert.equal(stripCodeFences('\x60\x60\x60javascript\\nconst x = 2;\\n\x60\x60\x60','.js'), 'const x = 2;');
assert.equal(stripCodeFences(null,'.js'), '');
assert.equal(stripCodeFences('', '.js'), '');
assert.equal(stripCodeFences(42, '.js'), '');
for (const body of [{text:'const x = 1;'}, [{content:'const x = 1;'}]]) {
 const file='/tmp/structured.js';fs.writeFileSync(file,'const x = ;');
 const r=await repairCode('const x = ;','SyntaxError at /tmp/structured.js:1',file,async()=>({content:body}));
 assert.equal(r.repaired,true);assert.equal(fs.readFileSync(file,'utf8'),'const x = 1;');
}
`, alternative: [["content.map(p => typeof p === 'string' ? p : (p.text || p.content || '')).join('')", "content.reduce((out, p) => out + (typeof p === 'string' ? p : (p.text || p.content || '')), '')"]] },
  { id: 'optional-legacy-table', fix: 'c170767', files: ['src/db/migrations/2026_02_20_008_v69_expert_to_expertise.js'], group: 'audit-c170',
    requirement: 'Migration 008 must work when the optional old custom_experts table is absent. If present, preserve its rows in custom_expertises. Retain old tables, expert records, memory and bindings. Applying the migration twice must be safe.',
    testBody: `import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {up} from './src/db/migrations/2026_02_20_008_v69_expert_to_expertise.js';
for (const optional of [false,true]) {
 const db = new Database(':memory:');
 db.exec(\x60CREATE TABLE experts(id TEXT,name TEXT,description TEXT,domain TEXT,system_prompt TEXT,temperature REAL,config TEXT,is_builtin INTEGER,created_at TEXT,updated_at TEXT);
 CREATE TABLE conversations(id TEXT PRIMARY KEY);
 CREATE TABLE conversation_experts(id INTEGER,conversation_id TEXT,expert_id TEXT,locked INTEGER,strength INTEGER,locked_at TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE expert_memory(id INTEGER,expert_id TEXT,key TEXT,value TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE capability_drift_log(expert_id TEXT); CREATE TABLE llm_execution_log(expert_id TEXT);
 INSERT INTO experts VALUES('one','One','','','',0.5,'{}',1,'2020','2020');
 INSERT INTO expert_memory VALUES(1,'one','key','value','2020','2020');\x60);
 if (optional) db.exec("CREATE TABLE custom_experts(id TEXT, config TEXT, created_at TEXT); INSERT INTO custom_experts VALUES('custom','{}','2020');");
 up(db); up(db);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expertises').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM experts').get().n,1);
 assert.equal(db.prepare('SELECT value FROM expertise_memory').get().value,'value');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM custom_expertises').get().n,optional?1:0);
 if(optional) assert.equal(db.prepare('SELECT config FROM custom_expertises').get().config,'{}');
 db.close();
}
`, alternative: [["db.prepare(\n    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_experts'`\n  ).get()", "db.prepare(\"SELECT name FROM sqlite_master WHERE name = ? AND type = 'table'\").get('custom_experts')"]] },
];
