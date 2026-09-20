// Controller-only cases, disjoint from the seven benchmark tasks and the eight
// exposed development repairs. Historical code is not a claim of unseen training
// data. Each entire allowed source file is restored to its pre-fix version.
export const caseSet = 'fresh-20260920';
export const cases = [
  {id:'nonfinite-math',fix:'66ddd5f',group:'finite-arithmetic',
    files:['src/chat/handlers/local.js','src/chat/handlers/utils/local-i18n.js'],
    requirement:'Handle non-finite results in both direct and Czech-normalized computeMath expressions. Return answer:NaN, error:"non_finite_result", nonFiniteResult:"Infinity", "-Infinity" or "NaN", and the evaluated expression. Render a helpful non-finite explanation without literal NaN, preserving the error code in formatLocalResponse. Keep finite arithmetic including zero and VAT calculations working. Direct English formatMathResponse must explain that the result is not a finite number.',
    testBody:String.raw`import assert from 'node:assert/strict';
import {computeMath,formatLocalResponse} from './src/chat/handlers/local.js';
import {formatMathResponse} from './src/chat/handlers/utils/local-i18n.js';
for(const [input,kind] of [['5 / 0','Infinity'],['0-5 / 0','-Infinity'],['0 / 0','NaN'],['5 děleno 0','Infinity']]) {
 const r=computeMath(input);assert(Number.isNaN(r.answer),input);assert.equal(r.error,'non_finite_result');assert.equal(r.nonFiniteResult,kind);assert(r.expression);
 const text=formatLocalResponse(input,r,'local.math','cs');assert(!text.includes('NaN'));assert(text.includes('non_finite_result'));
}
for(const [input,result] of [['4-4',0],['8/2',4],['5 děleno 2',2.5],['DPH z 10000 při 21%',2100]]) assert.equal(computeMath(input).answer,result,input);
assert.match(formatMathResponse('5/0',NaN,'en'),/not a finite number/);assert(!formatMathResponse('5/0',NaN,'en').includes('NaN'));
`, alternative:[['Number.isNaN(result) ? \'NaN\' : String(result)','String(result)']],
    mutants:[{name:'accept-infinity',edits:[['Number.isFinite(result)','!Number.isNaN(result)']]}]},
  {id:'capability-underscores',fix:'5276c7d',group:'manifest-capability-grammar',files:['src/specialists/specialist-loader.js'],
    requirement:'Specialist manifests must accept dotted capabilities containing underscores after the initial lowercase letter, in both namespace and action (betting.odds_compare, code_review.security_scan). Preserve exactly two nonempty components, lowercase-letter starts and remaining lowercase letters/digits/underscores. Reject spaces, uppercase, slash, hyphen, extra dots, leading digits and leading underscores. Preserve unrelated manifest validation and v1 compatibility.',
    testBody:String.raw`import assert from 'node:assert/strict';
import {_testLoaderInternals} from './src/specialists/specialist-loader.js';
const base={id:'probe',name:'Probe',version:'1.0.0',domain:'probe',entry:'index.js',engine:'>=1.0.0'};
const valid=m=>_testLoaderInternals.validateManifest(m).valid;
assert(valid(base));
for(const cap of ['betting.odds_compare','code_review.security_scan','tax.calculate','a1.b2','a_.b_']) assert(valid({...base,manifestVersion:2,capabilities:[cap]}),cap);
for(const cap of ['a','a.b.c','.b','a.','A.b','a.B','a-b.c','a/b.c','1a.b','a.1b','_a.b','a._b','a. b','a.b\n',42]) assert(!valid({...base,capabilities:[cap]}),String(cap));
assert(!valid({...base,id:'bad/id'}));assert(!valid({...base,version:'wrong'}));assert(!valid({...base,capabilities:'a.b'}));
`,alternative:[['[a-z0-9_]*\\.[a-z][a-z0-9_]*','[a-z_0-9]*\\.[a-z][a-z_0-9]*']],
    mutants:[{name:'accept-any-capability',edits:[['!CAPABILITY_PATTERN.test(cap)','false']]}]},
  {id:'environment-prose',fix:'3708713',group:'configuration-artifact-filter',files:['src/planner/code-cleaner.js'],
    requirement:'For .env/.ini/.cfg/.conf, strip surrounding model prose and keep KEY=VALUE assignments, # comments and blank lines. Keys begin with a letter or underscore, followed by word characters and optional whitespace before =. Preserve assignment values, embedded equals and comments verbatim. Do not apply this filter to SQL, YAML or shell content. Existing fenced code extraction must still work.',
    testBody:String.raw`import assert from 'node:assert/strict';
import {stripCodeFences} from './src/planner/code-cleaner.js';
const content='Here is the configuration:\nPORT=3210\n# retained\n_secret = a=b\n\nEnabled for you.\nMODE=local\nThis completes the setup.';
const expected='PORT=3210\n# retained\n_secret = a=b\n\nMODE=local';
for(const ext of ['.env','.ini','.cfg','.conf']) assert.equal(stripCodeFences(content,ext),expected,ext);
assert.equal(stripCodeFences('\x60\x60\x60env\nPORT=3210\n\x60\x60\x60','.env'),'PORT=3210');
for(const [ext,body] of [['.sql','SELECT * FROM events;'],['.yaml','port: 3210'],['.sh','echo ready']]) assert.equal(stripCodeFences(body,ext),body);
`,alternative:[["/^([A-Z_a-z]\\w*\\s*=|#|\\s*$)/","/^(?:[a-zA-Z_]\\w*\\s*=|#|\\s*$)/"]],
    mutants:[{name:'drop-comments',edits:[['\\s*=|#|\\s*$)','\\s*=|\\s*$)']]}]},
  {id:'vat-migration-reentry',fix:'2816be1',group:'migration-reentry',files:['src/db/migrations/2026_02_22_010_v72_vat_engine.js'],
    requirement:'Make VAT migration 010 re-entrant, including a database where some of its five financial_entries columns already exist. Preserve existing row values and all VAT columns, period table constraints and indexes. Repeated execution must succeed; genuine missing base-table/schema errors must still propagate rather than being swallowed.',
    testBody:String.raw`import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {up} from './src/db/migrations/2026_02_22_010_v72_vat_engine.js';
for(const partial of [false,true]) {
 const db=new Database(':memory:');db.exec('CREATE TABLE entity_profiles(id TEXT PRIMARY KEY); CREATE TABLE financial_entries(id INTEGER PRIMARY KEY, entity_id TEXT); INSERT INTO entity_profiles VALUES(\'e\'); INSERT INTO financial_entries VALUES(1,\'e\');');
 if(partial) db.exec("ALTER TABLE financial_entries ADD COLUMN partner_dic TEXT; UPDATE financial_entries SET partner_dic='CZ123';");
 up(db);up(db);const row=db.prepare('SELECT * FROM financial_entries').get();assert.equal(row.entity_id,'e');if(partial)assert.equal(row.partner_dic,'CZ123');
 for(const c of ['supply_date','partner_dic','partner_name','document_number','vat_type']) assert(c in row,c);
 db.exec("INSERT INTO vat_periods(entity_id,period_type,period_start,period_end) VALUES('e','monthly','2026-01-01','2026-01-31')");
 assert.throws(()=>db.exec("INSERT INTO vat_periods(entity_id,period_type,period_start,period_end) VALUES('e','yearly','2027','2028')"));
 assert.throws(()=>db.exec("INSERT INTO vat_periods(entity_id,period_type,period_start,period_end) VALUES('e','monthly','2026-01-01','2026-01-31')"));
 assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_fe_supply_date'").get());db.close();
}
const missing=new Database(':memory:');assert.throws(()=>up(missing));missing.close();
`,alternative:[["if (!hasColumn(db, 'financial_entries', col))","if (hasColumn(db, 'financial_entries', col) === false)"]],
    mutants:[{name:'skip-all-additions',edits:[["if (!hasColumn(db, 'financial_entries', col))",'if (false)']]}]},
  {id:'archive-name-reuse',fix:'2a19bc3',group:'project-archive-identity',files:['src/db/database.js'],
    requirement:'Archived and soft-deleted projects must free their former name for reuse by adding the existing timestamp suffix convention. Restore removes the suffix if the name is free and reports a conflict while retaining the safe suffix if occupied. getOrCreate must reactivate the same path without duplicating its ID and flag conflicting active names. Preserve active records and descriptions. Only the repository API is in scope; HTTP handling is not part of this repair.',
    testBody:String.raw`import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
// Historical installation prerequisite, not a repair supplied to the candidate.
const legacy=new Database(process.env.C3_DB_PATH);legacy.exec('CREATE TABLE IF NOT EXISTS custom_experts(id TEXT, config TEXT, created_at TEXT)');legacy.close();
const {projects}=await import('./src/db/database.js');
for(const op of ['archive','softDelete']) {
 const name='sample-'+op,p=projects.getOrCreate(name,'/tmp/'+op+'/one','original');projects[op].run(p.id);
 let old=projects.findById.get(p.id);assert.notEqual(old.name,name);assert.equal(old.status,op==='archive'?'archived':'deleted');
 const fresh=projects.getOrCreate(name,'/tmp/'+op+'/two','second');assert(!fresh._nameConflict);assert.notEqual(fresh.id,p.id);assert.equal(fresh.name,name);
 const conflict=projects.restore.run(p.id);assert.equal(conflict.conflict,true);old=projects.findById.get(p.id);assert.notEqual(old.name,name);assert.equal(old.status,'active');assert.equal(projects.findById.get(fresh.id).description,'second');
 projects.delete.run(fresh.id);const restored=projects.restore.run(p.id);assert.equal(restored.conflict,false);assert.equal(projects.findById.get(p.id).name,name);
 projects[op].run(p.id);const same=projects.getOrCreate(name,'/tmp/'+op+'/one','updated');assert.equal(same.id,p.id);assert.equal(same.status,'active');assert.equal(same.description,'updated');
 const duplicate=projects.getOrCreate(name,'/tmp/'+op+'/three');assert.equal(duplicate._nameConflict,true);assert.equal(projects.findByPath.get('/tmp/'+op+'/three'),undefined);
}
`,alternative:[['if (nameConflict && nameConflict.id !== project.id)','if (nameConflict && project.id !== nameConflict.id)']],
    mutants:[{name:'silent-active-name-collision',edits:[['if (nameConflict) {','if (false) {']]}]},
  {id:'remote-package-integrity',fix:'5577795',group:'marketplace-package-integrity',files:['src/marketplace/marketplace-client.js'],
    requirement:'Reject remote package downloads without an expected SHA-256 digest, remove the unverified downloaded file, and never return verified:false as an accepted remote package. Preserve successful verified downloads, rejection and cleanup on hash mismatch, and HTTP failures. Use the existing downloadPackage API; unrelated installer and project-route security are outside this task.',
    testBody:String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs';import {createHash} from 'node:crypto';
import {MarketplaceClient} from './src/marketplace/marketplace-client.js';
const client=Object.create(MarketplaceClient.prototype),payload=Buffer.from('a real package payload'),digest=createHash('sha256').update(payload).digest('hex');
const old=globalThis.fetch;
try {
 globalThis.fetch=async()=>({ok:true,body:(async function*(){yield payload.subarray(0,7);yield payload.subarray(7);})()});
 const dir=fs.mkdtempSync('/tmp/download-'),entry={id:'sample',downloadUrl:'https://fixture.invalid/payload.pkg'};
 for(const sha256 of [undefined,'0'.repeat(64)]) {await assert.rejects(()=>client.downloadPackage({...entry,sha256},dir));assert(!fs.existsSync(dir+'/payload.pkg'));}
 const good=await client.downloadPackage({...entry,sha256:digest},dir);assert.equal(good.verified,true);assert.deepEqual(fs.readFileSync(good.path),payload);
 globalThis.fetch=async()=>({ok:false,status:503});await assert.rejects(()=>client.downloadPackage({...entry,sha256:digest},dir));
} finally {globalThis.fetch=old;}
`,alternative:[['computed !== entry.sha256','entry.sha256 !== computed']],
    mutants:[{name:'skip-mismatch-check',edits:[['computed !== entry.sha256','false']]}]},
];
