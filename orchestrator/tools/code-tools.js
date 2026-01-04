/**
 * Code Tools
 * 
 * Nástroje pro práci s kódem.
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";

const execAsync = promisify(exec);

// ================== ANALYSIS TOOLS ==================

registerTool({
  name: "code:analyze",
  category: "code",
  description: "Analyze code structure and dependencies",
  risk: "low",
  parameters: {
    path: { type: "string", required: true },
    language: { type: "string", default: "auto" }
  },
  async execute({ path: codePath, language = "auto" }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Path not found: ${codePath}`);
    }

    const stats = fs.statSync(fullPath);
    const isDir = stats.isDirectory();

    // Detect language
    let detectedLang = language;
    if (language === "auto") {
      if (isDir) {
        if (fs.existsSync(path.join(fullPath, "package.json"))) {
          detectedLang = "javascript";
        } else if (fs.existsSync(path.join(fullPath, "Cargo.toml"))) {
          detectedLang = "rust";
        } else if (fs.existsSync(path.join(fullPath, "requirements.txt")) || 
                   fs.existsSync(path.join(fullPath, "setup.py"))) {
          detectedLang = "python";
        } else if (fs.existsSync(path.join(fullPath, "go.mod"))) {
          detectedLang = "go";
        }
      } else {
        const ext = path.extname(fullPath);
        const extMap = {
          ".js": "javascript",
          ".ts": "typescript",
          ".jsx": "javascript",
          ".tsx": "typescript",
          ".py": "python",
          ".rs": "rust",
          ".go": "go",
          ".java": "java",
          ".cpp": "cpp",
          ".c": "c",
          ".rb": "ruby",
          ".php": "php"
        };
        detectedLang = extMap[ext] || "unknown";
      }
    }

    const analysis = {
      path: codePath,
      isDirectory: isDir,
      language: detectedLang,
      files: [],
      dependencies: [],
      structure: {}
    };

    if (isDir) {
      // Analyze project structure
      const files = [];
      function scanDir(dir, prefix = "") {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          
          const entryPath = path.join(dir, entry.name);
          const relativePath = path.join(prefix, entry.name);
          
          if (entry.isDirectory()) {
            scanDir(entryPath, relativePath);
          } else {
            const ext = path.extname(entry.name);
            files.push({
              path: relativePath,
              extension: ext,
              size: fs.statSync(entryPath).size
            });
          }
        }
      }
      scanDir(fullPath);
      analysis.files = files;

      // Get dependencies
      if (detectedLang === "javascript" || detectedLang === "typescript") {
        const pkgPath = path.join(fullPath, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          analysis.dependencies = [
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}).map(d => `${d} (dev)`)
          ];
          analysis.structure.name = pkg.name;
          analysis.structure.version = pkg.version;
          analysis.structure.scripts = Object.keys(pkg.scripts || {});
        }
      }
    } else {
      // Analyze single file
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      
      analysis.files = [{
        path: codePath,
        extension: path.extname(fullPath),
        size: stats.size,
        lines: lines.length
      }];

      // Extract imports
      const imports = [];
      for (const line of lines) {
        // JavaScript/TypeScript imports
        const jsImport = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
        if (jsImport) imports.push(jsImport[1]);
        
        // Python imports
        const pyImport = line.match(/(?:from|import)\s+(\w+)/);
        if (pyImport) imports.push(pyImport[1]);
        
        // Rust use
        const rustUse = line.match(/use\s+(\w+)/);
        if (rustUse) imports.push(rustUse[1]);
      }
      analysis.dependencies = [...new Set(imports)];
    }

    return analysis;
  }
});

registerTool({
  name: "code:lint",
  category: "code",
  description: "Run linter on code",
  risk: "low",
  parameters: {
    path: { type: "string", required: true },
    fix: { type: "boolean", default: false }
  },
  async execute({ path: codePath, fix = false }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    // Detect project type and run appropriate linter
    const hasPackageJson = fs.existsSync(path.join(fullPath, "package.json"));
    
    if (hasPackageJson) {
      // Try ESLint
      const eslintPath = path.join(fullPath, "node_modules/.bin/eslint");
      if (fs.existsSync(eslintPath)) {
        const fixFlag = fix ? "--fix" : "";
        try {
          const { stdout, stderr } = await execAsync(
            `${eslintPath} . ${fixFlag}`,
            { cwd: fullPath }
          );
          return {
            success: true,
            linter: "eslint",
            output: stdout,
            errors: stderr
          };
        } catch (error) {
          return {
            success: false,
            linter: "eslint",
            output: error.stdout,
            errors: error.stderr
          };
        }
      }
    }

    return {
      success: false,
      error: "No supported linter found"
    };
  }
});

registerTool({
  name: "code:format",
  category: "code",
  description: "Format code using Prettier or language-specific formatter",
  risk: "medium",
  parameters: {
    path: { type: "string", required: true }
  },
  async execute({ path: codePath }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    // Try Prettier
    try {
      const { stdout } = await execAsync(
        `npx prettier --write "${fullPath}"`,
        { cwd: workdir }
      );
      return {
        success: true,
        formatter: "prettier",
        output: stdout
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// ================== TEST TOOLS ==================

registerTool({
  name: "code:test",
  category: "code",
  description: "Run tests",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    pattern: { type: "string", default: null },
    coverage: { type: "boolean", default: false }
  },
  async execute({ path: codePath = ".", pattern, coverage = false }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    // Detect test runner
    const pkgPath = path.join(fullPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      
      let testCommand = "npm test";
      
      // Check for specific test runners
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vitest) {
        testCommand = "npx vitest run";
        if (coverage) testCommand += " --coverage";
        if (pattern) testCommand += ` ${pattern}`;
      } else if (deps.jest) {
        testCommand = "npx jest";
        if (coverage) testCommand += " --coverage";
        if (pattern) testCommand += ` ${pattern}`;
      } else if (deps.mocha) {
        testCommand = "npx mocha";
        if (pattern) testCommand += ` --grep "${pattern}"`;
      }

      try {
        const { stdout, stderr } = await execAsync(testCommand, {
          cwd: fullPath,
          timeout: 300000 // 5 min
        });

        return {
          success: true,
          command: testCommand,
          output: stdout,
          stderr
        };
      } catch (error) {
        return {
          success: false,
          command: testCommand,
          output: error.stdout,
          stderr: error.stderr,
          exitCode: error.code
        };
      }
    }

    return {
      success: false,
      error: "No test runner found"
    };
  }
});

// ================== BUILD TOOLS ==================

registerTool({
  name: "code:build",
  category: "code",
  description: "Build project",
  risk: "medium",
  parameters: {
    path: { type: "string", default: "." },
    production: { type: "boolean", default: false }
  },
  async execute({ path: codePath = ".", production = false }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    const pkgPath = path.join(fullPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      
      let buildCommand = "npm run build";
      
      if (pkg.scripts?.build) {
        buildCommand = "npm run build";
      } else {
        // Check for specific build tools
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vite) {
          buildCommand = "npx vite build";
        } else if (deps.webpack) {
          buildCommand = "npx webpack";
          if (production) buildCommand += " --mode production";
        } else if (deps.tsc || deps.typescript) {
          buildCommand = "npx tsc";
        }
      }

      if (production) {
        process.env.NODE_ENV = "production";
      }

      try {
        const { stdout, stderr } = await execAsync(buildCommand, {
          cwd: fullPath,
          timeout: 300000,
          env: { ...process.env, NODE_ENV: production ? "production" : "development" }
        });

        return {
          success: true,
          command: buildCommand,
          output: stdout,
          stderr
        };
      } catch (error) {
        return {
          success: false,
          command: buildCommand,
          output: error.stdout,
          stderr: error.stderr
        };
      }
    }

    return {
      success: false,
      error: "No build configuration found"
    };
  }
});

registerTool({
  name: "code:typecheck",
  category: "code",
  description: "Run TypeScript type checking",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." }
  },
  async execute({ path: codePath = "." }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, codePath);

    try {
      const { stdout, stderr } = await execAsync("npx tsc --noEmit", {
        cwd: fullPath
      });

      return {
        success: true,
        output: stdout,
        errors: stderr
      };
    } catch (error) {
      return {
        success: false,
        output: error.stdout,
        errors: error.stderr
      };
    }
  }
});

console.log("💻 Code tools registered");
