// tests/code-analyzer.test.js — Deep Code Analyzer unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { analyzeCodeStructure, buildAnalysisSummary, detectLanguage } from '../src/code-intel/code-analyzer.js';

// ─── Language Detection ──────────────────────────────────────────────────────

suite('Code Analyzer — Language Detection');

test('detects JavaScript', () => {
  assertEqual(detectLanguage('app.js'), 'javascript');
  assertEqual(detectLanguage('index.mjs'), 'javascript');
  assertEqual(detectLanguage('lib.cjs'), 'javascript');
});

test('detects TypeScript', () => {
  assertEqual(detectLanguage('app.ts'), 'typescript');
  assertEqual(detectLanguage('component.tsx'), 'typescript');
});

test('detects Python', () => {
  assertEqual(detectLanguage('main.py'), 'python');
});

test('detects Go', () => {
  assertEqual(detectLanguage('main.go'), 'go');
});

test('detects Java', () => {
  assertEqual(detectLanguage('App.java'), 'java');
});

test('detects Rust', () => {
  assertEqual(detectLanguage('main.rs'), 'rust');
});

test('returns unknown for unrecognized', () => {
  assertEqual(detectLanguage('file.xyz'), 'unknown');
  assertEqual(detectLanguage(null), 'unknown');
});

// ─── JavaScript Structure ────────────────────────────────────────────────────

suite('Code Analyzer — JavaScript Structure');

test('extracts JS class', () => {
  const code = 'class UserService extends BaseService {\n  constructor() {}\n}';
  const r = analyzeCodeStructure(code, 'javascript');
  assertEqual(r.classes.length, 1);
  assertEqual(r.classes[0].name, 'UserService');
  assertEqual(r.classes[0].extends, 'BaseService');
});

test('extracts JS function', () => {
  const code = 'function validateToken(token) {\n  return token.length > 0;\n}';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.functions.length >= 1, `should find function, got ${r.functions.length}`);
  assertEqual(r.functions[0].name, 'validateToken');
});

test('extracts JS arrow function', () => {
  const code = 'const handleClick = (event) => {\n  console.log(event);\n};';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.functions.some(f => f.name === 'handleClick'), 'should find arrow function');
});

test('extracts JS exported function', () => {
  const code = 'export function fetchData(url) { return fetch(url); }';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.functions.some(f => f.name === 'fetchData'), 'should find exported function');
});

test('extracts JS constants', () => {
  const code = 'const MAX_RETRIES = 5;\nconst TIMEOUT_MS = 10000;\nconst x = 1;';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.constants.length >= 2, `should find 2+ constants, got ${r.constants.length}`);
  assert(r.constants.some(c => c.name === 'MAX_RETRIES'), 'should find MAX_RETRIES');
  assert(r.constants.some(c => c.name === 'TIMEOUT_MS'), 'should find TIMEOUT_MS');
});

// ─── Python Structure ────────────────────────────────────────────────────────

suite('Code Analyzer — Python Structure');

test('extracts Python class', () => {
  const code = 'class UserModel(BaseModel):\n    def __init__(self):\n        pass';
  const r = analyzeCodeStructure(code, 'python');
  assertEqual(r.classes.length, 1);
  assertEqual(r.classes[0].name, 'UserModel');
});

test('extracts Python functions', () => {
  const code = 'def calculate(x, y):\n    return x + y\n\nasync def fetch_data(url):\n    pass';
  const r = analyzeCodeStructure(code, 'python');
  assert(r.functions.length >= 2, `should find 2+ functions, got ${r.functions.length}`);
});

test('extracts Python constants', () => {
  const code = 'MAX_SIZE = 1024\nDEFAULT_TIMEOUT = 30\nresult = None';
  const r = analyzeCodeStructure(code, 'python');
  assert(r.constants.length >= 2, `should find 2+ constants, got ${r.constants.length}`);
});

// ─── Go Structure ────────────────────────────────────────────────────────────

suite('Code Analyzer — Go Structure');

test('extracts Go function', () => {
  const code = 'func HandleRequest(w http.ResponseWriter, r *http.Request) {\n}';
  const r = analyzeCodeStructure(code, 'go');
  assert(r.functions.some(f => f.name === 'HandleRequest'), 'should find HandleRequest');
});

test('extracts Go struct', () => {
  const code = 'type Config struct {\n\tHost string\n\tPort int\n}';
  const r = analyzeCodeStructure(code, 'go');
  assert(r.classes.length >= 1, 'should find struct');
  assertEqual(r.classes[0].name, 'Config');
});

test('extracts Go method', () => {
  const code = 'func (s *Server) Start(port int) error {\n\treturn nil\n}';
  const r = analyzeCodeStructure(code, 'go');
  assert(r.functions.some(f => f.name === 'Start'), 'should find method Start');
});

// ─── Java Structure ──────────────────────────────────────────────────────────

suite('Code Analyzer — Java Structure');

test('extracts Java class with extends/implements', () => {
  const code = 'public class UserController extends BaseController implements Serializable {';
  const r = analyzeCodeStructure(code, 'java');
  assertEqual(r.classes.length, 1);
  assertEqual(r.classes[0].name, 'UserController');
  assertEqual(r.classes[0].extends, 'BaseController');
});

test('extracts Java enum', () => {
  const code = 'public enum Status {\n  ACTIVE, INACTIVE, DELETED\n}';
  const r = analyzeCodeStructure(code, 'java');
  assertEqual(r.enums.length, 1);
  assertEqual(r.enums[0].name, 'Status');
});

test('extracts Java method', () => {
  const code = 'public static List<User> findByName(String name) {\n  return null;\n}';
  const r = analyzeCodeStructure(code, 'java');
  assert(r.functions.some(f => f.name === 'findByName'), `should find findByName, got: ${r.functions.map(f=>f.name)}`);
});

// ─── Rust Structure ──────────────────────────────────────────────────────────

suite('Code Analyzer — Rust Structure');

test('extracts Rust function', () => {
  const code = 'pub async fn process(data: &[u8]) -> Result<()> {\n}';
  const r = analyzeCodeStructure(code, 'rust');
  assert(r.functions.some(f => f.name === 'process'), 'should find process');
});

test('extracts Rust struct', () => {
  const code = 'pub struct Config {\n    pub host: String,\n    pub port: u16,\n}';
  const r = analyzeCodeStructure(code, 'rust');
  assert(r.classes.some(c => c.name === 'Config'), 'should find struct Config');
});

test('extracts Rust enum', () => {
  const code = 'pub enum Color {\n    Red,\n    Green,\n    Blue,\n}';
  const r = analyzeCodeStructure(code, 'rust');
  assertEqual(r.enums.length, 1);
  assertEqual(r.enums[0].name, 'Color');
});

test('extracts Rust trait', () => {
  const code = 'pub trait Handler {\n    fn handle(&self) -> Result<()>;\n}';
  const r = analyzeCodeStructure(code, 'rust');
  assert(r.interfaces.some(i => i.name === 'Handler'), 'should find trait Handler');
});

// ─── Code Smells ─────────────────────────────────────────────────────────────

suite('Code Analyzer — Code Smells');

test('detects TODO', () => {
  const code = 'function f() {\n  // TODO: fix this later\n  return 42;\n}';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'TODO'), 'should detect TODO');
});

test('detects FIXME', () => {
  const code = '// FIXME: memory leak\nconst x = 1;';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'FIXME'), 'should detect FIXME');
});

test('detects eval', () => {
  const code = 'const result = eval("1 + 2");';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'EVAL_USAGE'), 'should detect eval');
});

test('detects process.exit', () => {
  const code = 'if (error) process.exit(1);';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'PROCESS_EXIT'), 'should detect process.exit');
});

test('detects console.error', () => {
  const code = 'console.error("something failed");';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'CONSOLE_ERROR'), 'should detect console.error');
});

test('detects hardcoded secret', () => {
  const code = 'const api_key = "sk_live_abc123def456";';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'HARDCODED_SECRET'), 'should detect hardcoded secret');
});

test('detects HACK comment', () => {
  const code = '// HACK: workaround for upstream bug\nconst x = 1;';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.codeSmells.some(s => s.type === 'HACK'), 'should detect HACK');
});

test('reports correct severity', () => {
  const code = 'eval("x");\n// TODO fix\n';
  const r = analyzeCodeStructure(code, 'javascript');
  const evalSmell = r.codeSmells.find(s => s.type === 'EVAL_USAGE');
  const todoSmell = r.codeSmells.find(s => s.type === 'TODO');
  assert(evalSmell, 'should find eval');
  assert(todoSmell, 'should find TODO');
  assertEqual(evalSmell.severity, 'error');
  assertEqual(todoSmell.severity, 'info');
});

// ─── Config Values ───────────────────────────────────────────────────────────

suite('Code Analyzer — Config Values');

test('detects timeout config', () => {
  const code = 'const timeout = 30000;';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.configValues.some(c => c.name === 'timeout'), 'should detect timeout');
});

test('detects retries config', () => {
  const code = 'MAX_RETRY = 3';
  const r = analyzeCodeStructure(code, 'python');
  assert(r.configValues.some(c => c.name === 'retries'), `should detect retries, got: ${r.configValues.map(c=>c.name)}`);
});

test('detects port config', () => {
  const code = 'const PORT = 8080;';
  const r = analyzeCodeStructure(code, 'javascript');
  assert(r.configValues.some(c => c.name === 'port'), 'should detect port');
  assertEqual(r.configValues.find(c => c.name === 'port').value, '8080');
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

suite('Code Analyzer — Edge Cases');

test('empty content returns empty structure', () => {
  const r = analyzeCodeStructure('', 'javascript');
  assertEqual(r.classes.length, 0);
  assertEqual(r.functions.length, 0);
  assertEqual(r.codeSmells.length, 0);
});

test('null content returns empty structure', () => {
  const r = analyzeCodeStructure(null, 'javascript');
  assertEqual(r.classes.length, 0);
});

test('unknown language still detects smells', () => {
  const code = '// TODO: fix\neval("x")';
  const r = analyzeCodeStructure(code, 'unknown');
  assert(r.codeSmells.length >= 2, 'should detect smells even for unknown language');
});

// ─── Summary Builder ─────────────────────────────────────────────────────────

suite('Code Analyzer — Summary Builder');

test('builds summary from analysis', () => {
  const analysis = {
    classes: [{ name: 'UserService' }],
    functions: [{ name: 'validate' }, { name: 'process' }],
    interfaces: [],
    enums: [],
    constants: [{ name: 'MAX_SIZE' }],
    exports: [],
    codeSmells: [{ type: 'TODO', severity: 'info' }],
    configValues: [{ name: 'timeout', value: '30' }],
  };

  const summary = buildAnalysisSummary(analysis);
  assert(summary.includes('UserService'), 'should include class name');
  assert(summary.includes('validate'), 'should include function name');
  assert(summary.includes('MAX_SIZE'), 'should include constant');
  assert(summary.includes('timeout=30'), 'should include config');
  assert(summary.includes('1 info'), 'should include smell count');
});

test('empty analysis produces empty summary', () => {
  const analysis = {
    classes: [], functions: [], interfaces: [], enums: [],
    constants: [], exports: [], codeSmells: [], configValues: [],
  };

  const s = buildAnalysisSummary(analysis);
  assertEqual(s, '');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
