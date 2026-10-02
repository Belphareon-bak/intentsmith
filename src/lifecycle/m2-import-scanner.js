import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Native parsing is confined to this module's resource-bounded child process.
export const IMPORT_SCANNER_LIMITS = Object.freeze({
  files: 10_000, fileBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024,
  nodesPerFile: 200_000, nodesTotal: 1_000_000, depth: 512,
  parserMicros: 100_000, wallMs: 10_000, cpuSeconds: 5,
  addressBytes: 2 * 1024 * 1024 * 1024, inputBytes: 32 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
});
const INERT = new Set(['comment', 'string', 'string_fragment', 'escape_sequence',
  'regex', 'regex_pattern', 'jsx_text']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const LOADER_MEMBERS = new Set(['require', 'createRequire', 'getBuiltinModule']);
const MODULE_FACTORY_BINDINGS = new Set(['createRequire', 'createRequireFromPath', 'Module', 'default',
  '_load', '_compile', '_preloadModules', '_extensions', '_cache', 'register', 'registerHooks']);
const NAMESPACES = new Set(['module', 'globalThis', 'global', 'process']);
const CODE_GENERATORS = new Set(['eval', 'Function']);
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const unavailable = code => ({ complete: false, specifiers: [], errors: [{ code }] });
const workerFile = fileURLToPath(import.meta.url);

function decodeLiteral(raw) {
  if (!raw || !['"', "'"].includes(raw[0]) || raw.at(-1) !== raw[0]) throw Error('LITERAL_INVALID');
  let output = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    let character = raw[index];
    if (character !== '\\') { output += character; continue; }
    character = raw[++index];
    const simple = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
    if (Object.hasOwn(simple, character)) { output += simple[character]; continue; }
    if (character === '\n' || character === '\u2028' || character === '\u2029') continue;
    if (character === '\r') { if (raw[index + 1] === '\n') index += 1; continue; }
    if (character === '0') {
      if (/[0-9]/.test(raw[index + 1] ?? '')) throw Error('LEGACY_OCTAL_UNSUPPORTED');
      output += '\0'; continue;
    }
    if (/[1-9]/.test(character)) throw Error('LEGACY_OCTAL_UNSUPPORTED');
    if (character === 'x') {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[a-fA-F0-9]{2}$/.test(hex)) throw Error('HEX_INVALID');
      output += String.fromCharCode(Number.parseInt(hex, 16)); index += 2; continue;
    }
    if (character === 'u') {
      if (raw[index + 1] === '{') {
        const end = raw.indexOf('}', index + 2), hex = raw.slice(index + 2, end);
        const significant = hex.replace(/^0+/, '') || '0';
        if (end < 0 || !/^[a-fA-F0-9]+$/.test(hex) || significant.length > 6 || Number.parseInt(significant, 16) > 0x10ffff) throw Error('UNICODE_INVALID');
        output += String.fromCodePoint(Number.parseInt(significant, 16)); index = end;
      } else {
        const hex = raw.slice(index + 1, index + 5);
        if (!/^[a-fA-F0-9]{4}$/.test(hex)) throw Error('UNICODE_INVALID');
        output += String.fromCharCode(Number.parseInt(hex, 16)); index += 4;
      }
      continue;
    }
    output += character;
  }
  if (!output.isWellFormed()) throw Error('UNICODE_SURROGATE_UNSUPPORTED');
  return output;
}

function identifier(node) {
  if (!node) return '';
  if (!['identifier', 'property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern', 'type_identifier'].includes(node.type)) return node.text;
  const decoded = node.text.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g,
    (_, braced, fixed) => {
      const significant = (braced ?? fixed).replace(/^0+/, '') || '0';
      if (significant.length > 6 || Number.parseInt(significant, 16) > 0x10ffff) throw Error('IMPORT_IDENTIFIER_UNSUPPORTED');
      return String.fromCodePoint(Number.parseInt(significant, 16));
    });
  if (decoded.includes('\\') || !decoded.isWellFormed()) throw Error('IMPORT_IDENTIFIER_UNSUPPORTED');
  return decoded;
}

function bindPattern(node, scope) {
  if (!node) return;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'ambient_declaration') return; // TS declare emits no runtime binding.
  }
  if (['identifier', 'type_identifier', 'shorthand_property_identifier_pattern'].includes(node.type)) {
    scope.bindings.add(identifier(node)); return;
  }
  if (node.type === 'assignment_pattern') { bindPattern(node.childForFieldName('left'), scope); return; }
  if (node.type === 'pair_pattern') { bindPattern(node.childForFieldName('value'), scope); return; }
  if (['required_parameter', 'optional_parameter'].includes(node.type)) {
    bindPattern(node.childForFieldName('pattern') ?? node.childForFieldName('name'), scope); return;
  }
  if (['formal_parameters', 'object_pattern', 'array_pattern', 'rest_pattern'].includes(node.type)) {
    for (const child of node.namedChildren) bindPattern(child, scope);
  }
}

function lexicalNodes(root, limits) {
  const programScope = { parent: null, kind: 'program', bindings: new Set() };
  const stack = [[root, 0, programScope]], rows = [];
  while (stack.length) {
    const [node, depth, outerScope] = stack.pop();
    if (rows.length >= limits.nodesPerFile || depth > limits.depth) return { error: 'SOURCE_PARSER_AST_LIMIT', nodes: rows.length };
    const functionScope = ['function_declaration', 'function_expression', 'arrow_function',
      'generator_function', 'generator_function_declaration', 'method_definition'].includes(node.type);
    let scope = outerScope;
    if (functionScope || ['statement_block', 'catch_clause', 'for_statement', 'for_in_statement', 'class_body'].includes(node.type)) {
      scope = { parent: outerScope, kind: functionScope ? 'function' : 'block', bindings: new Set() };
    }
    rows.push({ node, scope });
    if (INERT.has(node.type)) continue;
    if (node.type === 'variable_declarator') {
      let target = scope;
      if (node.parent?.type === 'variable_declaration') {
        while (target.parent && target.kind !== 'function' && target.kind !== 'program') target = target.parent;
      }
      bindPattern(node.childForFieldName('name'), target);
    }
    if (functionScope) {
      bindPattern(node.childForFieldName('parameters'), scope);
      bindPattern(node.childForFieldName('parameter'), scope);
      if (node.type.endsWith('_declaration')) bindPattern(node.childForFieldName('name'), outerScope);
      else bindPattern(node.childForFieldName('name'), scope);
    }
    if (['class_declaration', 'enum_declaration', 'internal_module'].includes(node.type)) bindPattern(node.childForFieldName('name'), outerScope);
    if (node.type === 'catch_clause') bindPattern(node.childForFieldName('parameter'), scope);
    if (node.type === 'import_clause' && !isObservedTypeOnly(node)) {
      for (const child of node.namedChildren) {
        if (child.type === 'identifier') bindPattern(child, scope);
        if (child.type === 'namespace_import') bindPattern(child.namedChildren.at(-1), scope);
        if (child.type === 'named_imports') {
          for (const entry of child.namedChildren) {
            if (entry.type === 'import_specifier' && !isObservedTypeOnly(entry)) bindPattern(entry.childForFieldName('alias') ?? entry.childForFieldName('name'), scope);
          }
        }
      }
    }
    if (node.type === 'import_require_clause' && !isObservedTypeOnly(node)) bindPattern(node.namedChildren.find(child => child.type === 'identifier'), scope);
    const children = node.namedChildren;
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push([children[index], depth + 1, scope]);
  }
  return { rows, nodes: rows.length };
}

function bound(name, scope) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) return true;
  }
  return false;
}

function isObservedTypeOnly(node) {
  for (let parent = node; parent; parent = parent.parent) {
    if (parent.type === 'ambient_declaration') return true;
  }
  if (['import_statement', 'export_statement', 'import_specifier', 'export_specifier'].includes(node.type)) {
    return node.children.some(child => child.type === 'type');
  }
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (['import_statement', 'export_statement', 'import_specifier', 'export_specifier'].includes(parent.type)
      && parent.children.some(child => child.type === 'type')) return true;
    if (['type_alias_declaration', 'type_query', 'type_annotation', 'ambient_declaration'].includes(parent.type)) return true;
    if (['variable_declarator', 'expression_statement', 'statement_block'].includes(parent.type)) return false;
  }
  return false;
}

function staticModuleUtility(node) {
  if (isObservedTypeOnly(node)) return true;
  const clause = node.namedChildren.find(child => child.type === 'import_clause' || child.type === 'export_clause');
  if (!clause) return node.type === 'import_statement' && !node.namedChildren.some(child => child.type === 'import_require_clause');
  const named = clause.type === 'export_clause' ? clause :
    clause.namedChildren.length === 1 && clause.namedChildren[0].type === 'named_imports' ? clause.namedChildren[0] : null;
  if (!named) return false;
  return named.namedChildren.every(entry => {
    if (entry.type === 'comment') return true;
    if (entry.type !== 'import_specifier' && entry.type !== 'export_specifier') return false;
    if (isObservedTypeOnly(entry)) return true;
    const imported = entry.childForFieldName('name');
    let name = identifier(imported);
    if (imported?.type === 'string') name = decodeLiteral(imported.text);
    return !MODULE_FACTORY_BINDINGS.has(name);
  });
}

function scanTree(parser, source, limits) {
  let tree;
  const specifiers = [], errors = [];
  const addError = code => errors.push({ code });
  const addLiteral = (literal, moduleUtility = false) => {
    try {
      const value = decodeLiteral(literal.text);
      if (!value || value.includes('\0')) addError('IMPORT_SPECIFIER_INVALID');
      else {
        specifiers.push(value);
        if ((value === 'module' || value === 'node:module') && !moduleUtility) addError('IMPORT_FACTORY_MODULE_UNSUPPORTED');
      }
    } catch { addError('IMPORT_LITERAL_UNSUPPORTED'); }
  };
  let count = 0;
  try {
    parser.setTimeoutMicros(limits.parserMicros);
    // Native 0.21.1's default string adapter fails on long returned chunks on
    // Node24. Supply bounded UTF-16 chunks, preserving complete source bytes.
    try { tree = parser.parse(offset => source.slice(offset, offset + 4096)); }
    catch { return unavailable('SOURCE_PARSER_UNAVAILABLE'); }
    if (!tree) return unavailable('SOURCE_PARSER_TIMEOUT');
    if (tree.rootNode.hasError) return unavailable('SOURCE_SYNTAX_ERROR');
    let lexical;
    try { lexical = lexicalNodes(tree.rootNode, limits); }
    catch (error) {
      return unavailable(error.message === 'IMPORT_IDENTIFIER_UNSUPPORTED' ? error.message : 'SOURCE_PARSER_UNAVAILABLE');
    }
    count = lexical.nodes;
    if (lexical.error) return { ...unavailable(lexical.error), nodes: count };
    for (const { node, scope } of lexical.rows) {
      if (INERT.has(node.type)) continue;
      if (node.type === 'import_statement' || node.type === 'export_statement') {
        const literal = node.childForFieldName('source')
          ?? node.namedChildren.find(child => child.type === 'import_require_clause')?.childForFieldName('source');
        if (literal) addLiteral(literal, staticModuleUtility(node));
      }
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (fn?.type === 'import' || (fn?.type === 'identifier' && identifier(fn) === 'require')) {
          if (fn.type === 'identifier' && bound('require', scope)) addError('IMPORT_SHADOWED_REQUIRE_UNSUPPORTED');
          const args = node.childForFieldName('arguments')?.namedChildren.filter(child => child.type !== 'comment') ?? [];
          if (node.childForFieldName('optional_chain') || args.length !== 1 || args[0]?.type !== 'string') {
            addError('IMPORT_ARGUMENT_UNSUPPORTED');
          } else addLiteral(args[0], isObservedTypeOnly(node));
        }
      }
      if (!isObservedTypeOnly(node)
        && ['identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern'].includes(node.type)) {
        const name = identifier(node), parent = node.parent;
        if (CODE_GENERATORS.has(name) && !bound(name, scope)) addError('IMPORT_CODE_GENERATION_UNSUPPORTED');
        if (name === 'require') {
          const direct = parent?.type === 'call_expression' && parent.childForFieldName('function')?.id === node.id;
          if (!direct) {
            const binding = ['formal_parameters', 'required_parameter', 'optional_parameter', 'rest_pattern', 'object_pattern'].includes(parent?.type)
              || (parent?.type === 'variable_declarator' && parent.childForFieldName('name')?.id === node.id)
              || ['function_declaration', 'import_specifier', 'catch_clause'].includes(parent?.type);
            addError(binding ? 'IMPORT_SHADOWED_REQUIRE_UNSUPPORTED' : 'IMPORT_LOADER_ALIAS_UNSUPPORTED');
          }
        }
        if (name === 'createRequire' && !isObservedTypeOnly(node)) addError('IMPORT_FACTORY_UNSUPPORTED');
        if (NAMESPACES.has(name) && !bound(name, scope) && !(parent?.type === 'member_expression' || parent?.type === 'subscript_expression')
          && parent?.type !== 'import_specifier' && parent?.type !== 'import_clause') {
          addError('IMPORT_LOADER_NAMESPACE_ALIAS_UNSUPPORTED');
        }
      }
      if (!isObservedTypeOnly(node) && ['member_expression', 'subscript_expression', 'pair_pattern'].includes(node.type)) {
        const property = node.childForFieldName('property') ?? node.childForFieldName('index') ?? node.childForFieldName('key');
        const object = node.childForFieldName('object');
        let name = identifier(property);
        if (property?.type === 'string') {
          try { name = decodeLiteral(property.text); } catch { addError('IMPORT_LITERAL_UNSUPPORTED'); }
        }
        if (LOADER_MEMBERS.has(name) || identifier(object) === 'require'
          || (node.type === 'subscript_expression' && NAMESPACES.has(identifier(object)) && !bound(identifier(object), scope) && property?.type !== 'string')) {
          addError('IMPORT_MEMBER_LOADER_UNSUPPORTED');
        }
        const namespace = identifier(object);
        if (['global', 'globalThis'].includes(namespace) && !bound(namespace, scope) && CODE_GENERATORS.has(name)) {
          addError('IMPORT_CODE_GENERATION_UNSUPPORTED');
        }
        if (!bound(namespace, scope)
          && ((['global', 'globalThis'].includes(namespace) && NAMESPACES.has(name))
            || (namespace === 'module' && !['exports', 'id', 'filename', 'loaded', 'path', 'paths'].includes(name))
            || (namespace === 'process' && ['mainModule', 'binding', '_linkedBinding'].includes(name)))) {
          addError('IMPORT_MEMBER_LOADER_UNSUPPORTED');
        }
      }
    }
    const codes = [...new Set(errors.map(error => error.code))].sort(compareUtf8);
    return { complete: codes.length === 0, specifiers: [...new Set(specifiers)].sort(compareUtf8),
      errors: codes.map(code => ({ code })), nodes: count };
  } catch (error) {
    return unavailable(error.message === 'IMPORT_IDENTIFIER_UNSUPPORTED' ? error.message : 'SOURCE_PARSER_UNAVAILABLE');
  }
  finally {
    // A timeout leaves parser progress behind. No later file may resume it.
    parser.reset();
  }
}


// Only this trusted scanner can mint an observation, after parsing/validating
// the reply (or recording a concrete admission/containment failure). A JSON
// object, structuredClone or copied token cannot acquire the private brand.
const observations = new WeakMap();
let activeChild = false;
const PARSER_VERSIONS = Object.freeze({ runtime: '0.21.1', javascript: '0.21.4', typescript: '0.23.2' });
const SCAN_CODES = new Set([
  'IMPORT_ARGUMENT_UNSUPPORTED', 'IMPORT_CODE_GENERATION_UNSUPPORTED', 'IMPORT_FACTORY_MODULE_UNSUPPORTED', 'IMPORT_FACTORY_UNSUPPORTED',
  'IMPORT_IDENTIFIER_UNSUPPORTED', 'IMPORT_LITERAL_UNSUPPORTED', 'IMPORT_LOADER_ALIAS_UNSUPPORTED',
  'IMPORT_LOADER_NAMESPACE_ALIAS_UNSUPPORTED', 'IMPORT_MEMBER_LOADER_UNSUPPORTED',
  'IMPORT_SHADOWED_REQUIRE_UNSUPPORTED', 'IMPORT_SPECIFIER_INVALID', 'SOURCE_SYNTAX_ERROR',
  'SOURCE_PARSER_AST_LIMIT', 'SOURCE_PARSER_GRAMMAR_INCOMPATIBLE', 'SOURCE_PARSER_GRAMMAR_UNAVAILABLE',
  'SOURCE_PARSER_TIMEOUT', 'SOURCE_PARSER_TOTAL_AST_LIMIT', 'SOURCE_PARSER_UNAVAILABLE',
]);
const sha = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function mint(prepared, result) {
  const token = Object.freeze(Object.create(null));
  observations.set(token, freeze({ bindingDigest: prepared.bindingDigest, ...result }));
  return token;
}

// Pure read. It neither consults the host nor authorizes a caller-created DTO.
export function readM2ImportObservation(token, prepared) {
  const value = token && observations.get(token);
  if (!value || !prepared.ready || value.bindingDigest !== prepared.bindingDigest) return null;
  if (value.error) return value;
  if (!validIdentity(value.identity) || value.files.length !== prepared.files.length) return null;
  for (let index = 0; index < value.files.length; index += 1) {
    const actual = value.files[index], expected = prepared.files[index];
    if (actual.path !== expected.path || actual.extension !== expected.extension
      || actual.bytes !== expected.bytes || actual.digest !== expected.digest) return null;
  }
  return value;
}

function validIdentity(identity) {
  if (!exactKeys(identity, ['protocol', 'node', 'abi', 'platform', 'arch', 'components'])
    || identity.protocol !== 'm2-import-ast-1' || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(identity.node)
    || !/^[0-9]+$/.test(identity.abi) || typeof identity.platform !== 'string' || typeof identity.arch !== 'string'
    || !exactKeys(identity.components, Object.keys(PARSER_VERSIONS))) return false;
  return Object.entries(PARSER_VERSIONS).every(([kind, version]) => {
    const component = identity.components[kind];
    return (kind === 'typescript' && component === null) || (exactKeys(component, ['version', 'packageDigest', 'nativeDigest', 'nativePath'])
      && component.version === version && /^sha256:[0-9a-f]{64}$/.test(component.packageDigest)
      && /^sha256:[0-9a-f]{64}$/.test(component.nativeDigest)
      && typeof component.nativePath === 'string' && component.nativePath.length > 0 && component.nativePath.isWellFormed());
  });
}

function parserIdentity() {
  const require = createRequire(import.meta.url);
  const components = {};
  for (const [kind, name] of [['runtime', 'tree-sitter'], ['javascript', 'tree-sitter-javascript'], ['typescript', 'tree-sitter-typescript']]) {
    try {
      const packagePath = require.resolve(`${name}/package.json`);
      const bytes = readFileSync(packagePath), pkg = JSON.parse(bytes);
      if (pkg.version !== PARSER_VERSIONS[kind]) throw Error('VERSION_MISMATCH');
      // Resolve exactly as the package's Node binding does. A local
      // build/Release or Debug may take precedence over platform prebuilds.
      const packageRequire = createRequire(packagePath);
      const resolver = packageRequire('node-gyp-build');
      if (typeof resolver.path !== 'function') throw Error('NATIVE_RESOLVER_UNSUPPORTED');
      const nativePath = resolver.path(path.dirname(packagePath));
      components[kind] = { version: pkg.version, packageDigest: sha(bytes),
        nativeDigest: sha(readFileSync(nativePath)), nativePath };
    } catch {
      if (kind !== 'typescript') throw Error('SOURCE_PARSER_UNAVAILABLE');
      components[kind] = null;
    }
  }
  return { protocol: 'm2-import-ast-1', node: process.version, abi: process.versions.modules,
    platform: process.platform, arch: process.arch, components };
}

function validateReply(reply, prepared, identity) {
  if (!exactKeys(reply, ['identity', 'files']) || JSON.stringify(reply.identity) !== JSON.stringify(identity)
    || !Array.isArray(reply.files) || reply.files.length !== prepared.files.length) return false;
  return reply.files.every((file, index) => {
    const source = prepared.files[index];
    if (!exactKeys(file, ['path', 'extension', 'bytes', 'digest', 'complete', 'specifiers', 'errors', 'nodes'])
      || file.path !== source.path || file.extension !== source.extension || file.bytes !== source.bytes || file.digest !== source.digest
      || typeof file.complete !== 'boolean' || !Number.isSafeInteger(file.nodes) || file.nodes < 0 || file.nodes > IMPORT_SCANNER_LIMITS.nodesPerFile
      || !Array.isArray(file.specifiers) || !Array.isArray(file.errors)
      || file.specifiers.some((item, i) => typeof item !== 'string' || !item || item.includes('\0') || !item.isWellFormed()
        || (i > 0 && compareUtf8(file.specifiers[i - 1], item) >= 0))
      || file.errors.some((error, i) => !exactKeys(error, ['code']) || !SCAN_CODES.has(error.code)
        || (i > 0 && compareUtf8(file.errors[i - 1].code, error.code) >= 0))) return false;
    return file.complete === (file.errors.length === 0);
  });
}

// One active child and no waiting queue. The caller's validated source snapshot
// is complete before the first await; full sources are never truncated.
export async function observeM2Imports(prepared, { signal } = {}) {
  if (!prepared?.ready || !/^sha256:[0-9a-f]{64}$/.test(prepared.bindingDigest)) throw new TypeError('m2-import-scanner:unprepared-input');
  if (signal?.aborted) return mint(prepared, { error: 'SOURCE_PARSER_CANCELLED' });
  if (activeChild) return mint(prepared, { error: 'SOURCE_PARSER_RESOURCE_BUSY' });
  if (prepared.files.length > IMPORT_SCANNER_LIMITS.files) return mint(prepared, { error: 'SOURCE_PARSER_FILE_COUNT_LIMIT' });
  let identity;
  try { identity = parserIdentity(); }
  catch { return mint(prepared, { error: 'SOURCE_PARSER_UNAVAILABLE' }); }
  let total = 0, encodedBytes = Buffer.byteLength(JSON.stringify({ identity, files: [] }));
  const files = [];
  for (const file of prepared.files) {
    if (!EXTENSIONS.has(file.extension) || typeof file.source !== 'string' || typeof file.path !== 'string') {
      return mint(prepared, { error: 'SOURCE_PARSER_INPUT_INVALID' });
    }
    const bytes = Buffer.from(file.source);
    if (bytes.length !== file.bytes || sha(bytes) !== file.digest) return mint(prepared, { error: 'SOURCE_PARSER_INPUT_INVALID' });
    if (bytes.length > IMPORT_SCANNER_LIMITS.fileBytes) return mint(prepared, { error: 'SOURCE_PARSER_FILE_BYTES_LIMIT' });
    total += bytes.length;
    if (total > IMPORT_SCANNER_LIMITS.totalBytes) return mint(prepared, { error: 'SOURCE_PARSER_TOTAL_BYTES_LIMIT' });
    const encoded = { path: file.path, extension: file.extension, bytes: file.bytes, digest: file.digest, contentBase64: bytes.toString('base64') };
    encodedBytes += Buffer.byteLength(JSON.stringify(encoded)) + (files.length > 0 ? 1 : 0);
    if (encodedBytes > IMPORT_SCANNER_LIMITS.inputBytes) return mint(prepared, { error: 'SOURCE_PARSER_INPUT_BYTES_LIMIT' });
    files.push(encoded);
  }
  const input = JSON.stringify({ identity, files });
  if (Buffer.byteLength(input) > IMPORT_SCANNER_LIMITS.inputBytes) return mint(prepared, { error: 'SOURCE_PARSER_INPUT_BYTES_LIMIT' });
  activeChild = true;
  try {
    const result = await runChild(input, signal);
    if (result.error) return mint(prepared, result);
    let reply;
    try { reply = JSON.parse(result.stdout); }
    catch { return mint(prepared, { error: 'SOURCE_PARSER_PROTOCOL_INVALID' }); }
    if (!validateReply(reply, prepared, identity)) return mint(prepared, { error: 'SOURCE_PARSER_PROTOCOL_INVALID' });
    return mint(prepared, reply);
  } finally { activeChild = false; }
}

function runChild(input, signal) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('/usr/bin/prlimit', [`--as=${IMPORT_SCANNER_LIMITS.addressBytes}`, `--cpu=${IMPORT_SCANNER_LIMITS.cpuSeconds}`, '--core=0', '--',
        process.execPath, '--max-old-space-size=128', '--jitless', '--no-warnings', '--expose-gc', workerFile, '--worker'],
      { env: {}, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { resolve({ error: 'SOURCE_PARSER_PROCESS_UNAVAILABLE' }); return; }
    let error = null, closed = false, outputBytes = 0;
    const stdout = [];
    const kill = code => {
      if (closed) return;
      if (error === null) error = code;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch { /* close/error below is authoritative */ } }
    };
    const onAbort = () => kill('SOURCE_PARSER_CANCELLED');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => kill('SOURCE_PARSER_PROCESS_TIMEOUT'), IMPORT_SCANNER_LIMITS.wallMs);
    child.on('error', () => { error ??= 'SOURCE_PARSER_PROCESS_UNAVAILABLE'; });
    child.stdin.on('error', () => { error ??= 'SOURCE_PARSER_PROCESS_UNAVAILABLE'; });
    const readOutput = (chunk, isStdout) => {
      outputBytes += chunk.length;
      if (outputBytes > IMPORT_SCANNER_LIMITS.outputBytes) kill('SOURCE_PARSER_OUTPUT_BYTES_LIMIT');
      else if (isStdout) stdout.push(chunk);
    };
    child.stdout.on('data', chunk => readOutput(chunk, true));
    child.stderr.on('data', chunk => readOutput(chunk, false));
    child.once('close', (status, killedBy) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // close fires after process exit and all stdio handles are drained.
      const bytes = Buffer.concat(stdout), text = bytes.toString('utf8');
      resolve(error ? { error } : status !== 0 || killedBy
        ? { error: 'SOURCE_PARSER_PROCESS_UNAVAILABLE' }
        : !Buffer.from(text).equals(bytes) ? { error: 'SOURCE_PARSER_PROTOCOL_INVALID' } : { stdout: text });
    });
    if (signal?.aborted) onAbort();
    else child.stdin.end(input);
  });
}

function runWorker() {
  let identity;
  try { identity = parserIdentity(); }
  catch { process.exitCode = 1; return; }
  let input;
  try {
    const bytes = readFileSync(0);
    if (bytes.length > IMPORT_SCANNER_LIMITS.inputBytes) throw Error('INPUT_LIMIT');
    input = JSON.parse(bytes.toString('utf8'));
    if (!exactKeys(input, ['identity', 'files']) || JSON.stringify(input.identity) !== JSON.stringify(identity)
      || !Array.isArray(input.files) || input.files.length > IMPORT_SCANNER_LIMITS.files) throw Error('INPUT_INVALID');
  } catch { process.exitCode = 1; return; }
  const require = createRequire(import.meta.url);
  let Parser, javascript, typescript;
  try { Parser = require('tree-sitter'); javascript = require('tree-sitter-javascript'); }
  catch { process.exitCode = 1; return; }
  if (identity.components.typescript) {
    try { typescript = require('tree-sitter-typescript'); } catch { /* typed files fail closed below */ }
  }
  const parsers = new Map(), results = [];
  let nodes = 0, totalBytes = 0;
  for (const file of input.files) {
    const bytes = Buffer.from(file.contentBase64, 'base64');
    totalBytes += bytes.length;
    if (!exactKeys(file, ['path', 'extension', 'bytes', 'digest', 'contentBase64']) || !EXTENSIONS.has(file.extension)
      || bytes.toString('base64') !== file.contentBase64 || !Buffer.from(bytes.toString('utf8')).equals(bytes)
      || bytes.length !== file.bytes || sha(bytes) !== file.digest || bytes.length > IMPORT_SCANNER_LIMITS.fileBytes
      || totalBytes > IMPORT_SCANNER_LIMITS.totalBytes) { process.exitCode = 1; return; }
    const grammarName = file.extension === '.ts' ? 'typescript' : file.extension === '.tsx' ? 'tsx' : 'javascript';
    const grammar = grammarName === 'javascript' ? javascript : typescript?.[grammarName];
    let result;
    if (nodes > IMPORT_SCANNER_LIMITS.nodesTotal) result = unavailable('SOURCE_PARSER_TOTAL_AST_LIMIT');
    else if (!grammar) result = unavailable('SOURCE_PARSER_GRAMMAR_UNAVAILABLE');
    else {
      try {
        if (!parsers.has(grammarName)) {
          const parser = new Parser();
          try {
            parser.setLanguage(grammar);
            parser.setTimeoutMicros(IMPORT_SCANNER_LIMITS.parserMicros);
            if (!parser.parse(() => '')) throw Error('GRAMMAR_REJECTED');
            parser.reset(); parsers.set(grammarName, parser);
          } catch {
            results.push({ path: file.path, extension: file.extension, bytes: file.bytes, digest: file.digest,
              ...unavailable('SOURCE_PARSER_GRAMMAR_INCOMPATIBLE'), nodes: 0 });
            continue;
          }
        }
        result = scanTree(parsers.get(grammarName), bytes.toString('utf8'), IMPORT_SCANNER_LIMITS);
      } catch { result = unavailable('SOURCE_PARSER_UNAVAILABLE'); }
    }
    nodes += result.nodes ?? 0;
    if (nodes > IMPORT_SCANNER_LIMITS.nodesTotal) result = unavailable('SOURCE_PARSER_TOTAL_AST_LIMIT');
    results.push({ path: file.path, extension: file.extension, bytes: file.bytes, digest: file.digest,
      ...result, nodes: result.nodes ?? 0 });
    if (results.length % 32 === 0) global.gc?.();
  }
  process.stdout.write(JSON.stringify({ identity, files: results }));
}

if (process.argv[1] === workerFile && process.argv[2] === '--worker') runWorker();
