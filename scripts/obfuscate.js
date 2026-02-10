// Source Code Obfuscation Pipeline (Phase F4)
// ══════════════════════════════════════════════════════════════════════════════
//
// Two strategies:
//   1. javascript-obfuscator: AST-level transformation (slower, harder to read)
//   2. bytenode: V8 bytecode compilation (fast, binary output, Node.js only)
//
// Usage:
//   node scripts/obfuscate.js [--mode=obfuscator|bytenode] [--input=src] [--output=dist]
//
// The obfuscated code runs identically to the original.
// NOT cryptographic protection — just makes casual reading/copying harder.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  mode: 'obfuscator',     // 'obfuscator' or 'bytenode'
  inputDir: 'src',
  outputDir: 'dist',
  exclude: [
    'node_modules',
    '**/*.test.js',
    '**/*.test.cjs',
    '**/__tests__/**',
    '**/test/**',
    'setup/wizard.js',     // Keep wizard readable for troubleshooting
  ],
  obfuscatorOptions: {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: false,           // Increases size; skip for server code
    debugProtection: false,             // Not needed for server
    disableConsoleOutput: false,        // We need console for logging
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,               // Would break imports
    rotateStringArray: true,
    selfDefending: false,               // Not needed for server
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  },
};

// ─── File Discovery ─────────────────────────────────────────────────────────

function findJsFiles(dir, exclude = []) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);

      // Check exclusions
      const excluded = exclude.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(
            '^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
          );
          return regex.test(relativePath);
        }
        return relativePath.startsWith(pattern) || entry.name === pattern;
      });

      if (excluded) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
        files.push({ absolute: fullPath, relative: relativePath });
      }
    }
  }

  walk(dir);
  return files;
}

// ─── Strategy: javascript-obfuscator ────────────────────────────────────────

async function obfuscateWithJSObfuscator(config) {
  let JavaScriptObfuscator;
  try {
    JavaScriptObfuscator = (await import('javascript-obfuscator')).default;
  } catch {
    console.error('❌ javascript-obfuscator not installed. Run: npm install -D javascript-obfuscator');
    process.exit(1);
  }

  const files = findJsFiles(config.inputDir, config.exclude);
  console.log(`📦 Obfuscating ${files.length} files...`);

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const outputPath = path.join(config.outputDir, file.relative);
    const outputDir = path.dirname(outputPath);

    try {
      fs.mkdirSync(outputDir, { recursive: true });

      const source = fs.readFileSync(file.absolute, 'utf-8');
      const result = JavaScriptObfuscator.obfuscate(source, {
        ...config.obfuscatorOptions,
        inputFileName: file.relative,
        sourceMap: false,
      });

      fs.writeFileSync(outputPath, result.getObfuscatedCode(), 'utf-8');
      processed++;
    } catch (err) {
      console.error(`  ❌ ${file.relative}: ${err.message}`);
      // Copy original as fallback
      fs.mkdirSync(outputDir, { recursive: true });
      fs.copyFileSync(file.absolute, outputPath);
      errors++;
    }
  }

  // Copy non-JS files (JSON, HTML, CSS, etc.)
  copyNonJsFiles(config.inputDir, config.outputDir, config.exclude);

  return { processed, errors, total: files.length };
}

// ─── Strategy: bytenode (V8 bytecode) ───────────────────────────────────────

async function compileWithBytenode(config) {
  let bytenode;
  try {
    bytenode = (await import('bytenode')).default || await import('bytenode');
  } catch {
    console.error('❌ bytenode not installed. Run: npm install -D bytenode');
    process.exit(1);
  }

  const files = findJsFiles(config.inputDir, config.exclude);
  console.log(`📦 Compiling ${files.length} files to V8 bytecode...`);

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const outputPath = path.join(config.outputDir, file.relative.replace(/\.js$/, '.jsc'));
    const loaderPath = path.join(config.outputDir, file.relative);
    const outputDir = path.dirname(outputPath);

    try {
      fs.mkdirSync(outputDir, { recursive: true });

      // Compile to bytecode
      if (typeof bytenode.compileFile === 'function') {
        await bytenode.compileFile({ filename: file.absolute, output: outputPath });
      } else {
        // Fallback: use bytenode CLI
        execSync(`npx bytenode -c ${file.absolute} -o ${outputPath}`, { stdio: 'pipe' });
      }

      // Create loader stub: require('bytenode'); require('./file.jsc');
      const loaderCode = `'use strict';\nrequire('bytenode');\nmodule.exports = require('${path.basename(outputPath)}');\n`;
      fs.writeFileSync(loaderPath, loaderCode, 'utf-8');

      processed++;
    } catch (err) {
      console.error(`  ❌ ${file.relative}: ${err.message}`);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.copyFileSync(file.absolute, path.join(config.outputDir, file.relative));
      errors++;
    }
  }

  copyNonJsFiles(config.inputDir, config.outputDir, config.exclude);

  return { processed, errors, total: files.length };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function copyNonJsFiles(inputDir, outputDir, exclude) {
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(dir, entry.name);
      const relPath = path.relative(inputDir, srcPath);
      const destPath = path.join(outputDir, relPath);

      if (entry.name === 'node_modules') continue;

      if (entry.isDirectory()) {
        walk(srcPath);
      } else if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) {
        // Copy HTML, CSS, JSON, etc.
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  walk(inputDir);
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function runObfuscation(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  if (!fs.existsSync(config.inputDir)) {
    throw new Error(`Input directory not found: ${config.inputDir}`);
  }

  // Clean output
  if (fs.existsSync(config.outputDir)) {
    fs.rmSync(config.outputDir, { recursive: true });
  }
  fs.mkdirSync(config.outputDir, { recursive: true });

  console.log(`\n🔒 C3-Agent Source Protection`);
  console.log(`   Mode: ${config.mode}`);
  console.log(`   Input: ${config.inputDir}`);
  console.log(`   Output: ${config.outputDir}\n`);

  let result;

  if (config.mode === 'bytenode') {
    result = await compileWithBytenode(config);
  } else {
    result = await obfuscateWithJSObfuscator(config);
  }

  console.log(`\n✅ Done: ${result.processed}/${result.total} files processed`);
  if (result.errors > 0) {
    console.log(`⚠️ ${result.errors} files copied without protection (errors)`);
  }

  // Verify output is runnable
  const mainFile = path.join(config.outputDir, 'server.js');
  if (fs.existsSync(mainFile)) {
    console.log(`\n🔍 Output entry point: ${mainFile}`);
  }

  return result;
}

// ─── Build Config Generator ─────────────────────────────────────────────────

/**
 * Generate a build manifest for the obfuscated output.
 */
export function generateBuildManifest(config, result) {
  return {
    version: '1.0.0',
    buildDate: new Date().toISOString(),
    mode: config.mode,
    filesProcessed: result.processed,
    filesTotal: result.total,
    errors: result.errors,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('obfuscate.js')) {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  for (const arg of args) {
    if (arg.startsWith('--mode=')) config.mode = arg.split('=')[1];
    if (arg.startsWith('--input=')) config.inputDir = arg.split('=')[1];
    if (arg.startsWith('--output=')) config.outputDir = arg.split('=')[1];
  }

  runObfuscation(config).catch(err => {
    console.error('Build failed:', err.message);
    process.exit(1);
  });
}

export default { runObfuscation, findJsFiles, generateBuildManifest };
