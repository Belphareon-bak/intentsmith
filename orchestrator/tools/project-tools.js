/**
 * Project Tools
 * 
 * Nástroje pro vytváření a správu projektů.
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";

const execAsync = promisify(exec);

// ================== PROJECT TEMPLATES ==================

const TEMPLATES = {
  "node-basic": {
    name: "Node.js Basic",
    description: "Simple Node.js project",
    files: {
      "package.json": {
        name: "{{name}}",
        version: "1.0.0",
        type: "module",
        scripts: {
          start: "node src/index.js",
          dev: "node --watch src/index.js",
          test: "node --test"
        }
      },
      "src/index.js": `console.log("Hello from {{name}}!");`,
      ".gitignore": "node_modules/\n.env\ndist/",
      "README.md": "# {{name}}\n\n{{description}}"
    }
  },

  "node-api": {
    name: "Node.js REST API",
    description: "Express.js REST API with structure",
    files: {
      "package.json": {
        name: "{{name}}",
        version: "1.0.0",
        type: "module",
        scripts: {
          start: "node src/server.js",
          dev: "node --watch src/server.js",
          test: "node --test"
        },
        dependencies: {
          express: "^4.18.2",
          cors: "^2.8.5"
        }
      },
      "src/server.js": `import express from 'express';
import cors from 'cors';
import { router } from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', router);

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});
`,
      "src/routes/index.js": `import { Router } from 'express';

export const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
`,
      ".gitignore": "node_modules/\n.env\ndist/",
      ".env.example": "PORT=3000\nNODE_ENV=development",
      "README.md": "# {{name}}\n\n{{description}}\n\n## Usage\n\n```bash\nnpm install\nnpm run dev\n```"
    }
  },

  "react-vite": {
    name: "React + Vite",
    description: "Modern React app with Vite",
    command: "npm create vite@latest {{name}} -- --template react",
    postCommands: ["cd {{name}} && npm install"]
  },

  "svelte-vite": {
    name: "Svelte + Vite",
    description: "Svelte app with Vite",
    command: "npm create vite@latest {{name}} -- --template svelte",
    postCommands: ["cd {{name}} && npm install"]
  },

  "tauri-svelte": {
    name: "Tauri + Svelte",
    description: "Lightweight desktop app with Tauri and Svelte",
    command: "npm create tauri-app@latest {{name}} -- --template svelte --manager npm",
    postCommands: ["cd {{name}} && npm install"]
  },

  "python-basic": {
    name: "Python Basic",
    description: "Simple Python project",
    files: {
      "main.py": `"""{{name}} - {{description}}"""

def main():
    print("Hello from {{name}}!")

if __name__ == "__main__":
    main()
`,
      "requirements.txt": "",
      ".gitignore": "__pycache__/\n*.pyc\n.venv/\n.env",
      "README.md": "# {{name}}\n\n{{description}}\n\n## Usage\n\n```bash\npython main.py\n```"
    }
  },

  "python-api": {
    name: "Python FastAPI",
    description: "FastAPI REST API",
    files: {
      "main.py": `"""{{name}} - FastAPI Application"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="{{name}}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Hello from {{name}}"}

@app.get("/health")
async def health():
    return {"status": "ok"}
`,
      "requirements.txt": "fastapi>=0.100.0\nuvicorn>=0.23.0",
      ".gitignore": "__pycache__/\n*.pyc\n.venv/\n.env",
      "README.md": "# {{name}}\n\n{{description}}\n\n## Usage\n\n```bash\npip install -r requirements.txt\nuvicorn main:app --reload\n```"
    }
  }
};

function applyTemplate(content, vars) {
  if (typeof content === "string") {
    return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");
  }
  if (typeof content === "object") {
    const result = {};
    for (const [key, value] of Object.entries(content)) {
      result[key] = applyTemplate(value, vars);
    }
    return result;
  }
  return content;
}

// ================== PROJECT TOOLS ==================

registerTool({
  name: "project:templates",
  category: "project",
  description: "List available project templates",
  risk: "low",
  parameters: {},
  async execute() {
    const templates = Object.entries(TEMPLATES).map(([id, t]) => ({
      id,
      name: t.name,
      description: t.description
    }));
    
    return { success: true, templates };
  }
});

registerTool({
  name: "project:create",
  category: "project",
  description: "Create a new project from template",
  risk: "medium",
  parameters: {
    template: { type: "string", required: true },
    name: { type: "string", required: true },
    path: { type: "string", default: null },
    description: { type: "string", default: "" }
  },
  async execute({ template: templateId, name, path: projectPath, description = "" }, context) {
    const workdir = context.workdir || process.cwd();
    const template = TEMPLATES[templateId];
    
    if (!template) {
      return { 
        success: false, 
        error: `Template not found: ${templateId}`,
        available: Object.keys(TEMPLATES)
      };
    }

    const destPath = path.resolve(workdir, projectPath || name);
    const vars = { name, description };

    // Create directory
    fs.mkdirSync(destPath, { recursive: true });

    // If template uses command (like Vite)
    if (template.command) {
      const command = applyTemplate(template.command, vars);
      
      try {
        await execAsync(command, { cwd: workdir, timeout: 120000 });
        
        // Run post commands
        if (template.postCommands) {
          for (const cmd of template.postCommands) {
            const postCmd = applyTemplate(cmd, vars);
            await execAsync(postCmd, { cwd: workdir, timeout: 120000 });
          }
        }
        
        return {
          success: true,
          template: templateId,
          name,
          path: destPath,
          method: "command"
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    // Create files from template
    for (const [filePath, content] of Object.entries(template.files)) {
      const fullPath = path.join(destPath, filePath);
      const dir = path.dirname(fullPath);
      
      fs.mkdirSync(dir, { recursive: true });
      
      const finalContent = applyTemplate(content, vars);
      const fileContent = typeof finalContent === "object"
        ? JSON.stringify(finalContent, null, 2)
        : finalContent;
      
      fs.writeFileSync(fullPath, fileContent);
    }

    return {
      success: true,
      template: templateId,
      name,
      path: destPath,
      method: "files",
      filesCreated: Object.keys(template.files).length
    };
  }
});

registerTool({
  name: "project:analyze",
  category: "project",
  description: "Analyze project structure and dependencies",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." }
  },
  async execute({ path: projectPath = "." }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, projectPath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, error: "Path not found" };
    }

    const analysis = {
      path: fullPath,
      type: "unknown",
      language: "unknown",
      framework: null,
      packageManager: null,
      dependencies: [],
      devDependencies: [],
      scripts: {},
      structure: []
    };

    // Detect project type
    const files = fs.readdirSync(fullPath);
    
    if (files.includes("package.json")) {
      analysis.packageManager = "npm";
      const pkg = JSON.parse(fs.readFileSync(path.join(fullPath, "package.json"), "utf-8"));
      
      analysis.name = pkg.name;
      analysis.version = pkg.version;
      analysis.dependencies = Object.keys(pkg.dependencies || {});
      analysis.devDependencies = Object.keys(pkg.devDependencies || {});
      analysis.scripts = pkg.scripts || {};
      
      // Detect framework
      const allDeps = [...analysis.dependencies, ...analysis.devDependencies];
      if (allDeps.includes("react")) analysis.framework = "react";
      else if (allDeps.includes("vue")) analysis.framework = "vue";
      else if (allDeps.includes("svelte")) analysis.framework = "svelte";
      else if (allDeps.includes("express")) analysis.framework = "express";
      else if (allDeps.includes("fastify")) analysis.framework = "fastify";
      else if (allDeps.includes("@tauri-apps/api")) analysis.framework = "tauri";
      
      // Detect language
      if (allDeps.includes("typescript") || files.includes("tsconfig.json")) {
        analysis.language = "typescript";
      } else {
        analysis.language = "javascript";
      }
      
      analysis.type = "node";
    }
    
    if (files.includes("requirements.txt") || files.includes("setup.py") || files.includes("pyproject.toml")) {
      analysis.type = "python";
      analysis.language = "python";
      analysis.packageManager = "pip";
      
      if (files.includes("requirements.txt")) {
        const reqs = fs.readFileSync(path.join(fullPath, "requirements.txt"), "utf-8");
        analysis.dependencies = reqs.split("\n").filter(l => l && !l.startsWith("#")).map(l => l.split("==")[0]);
      }
      
      // Detect framework
      if (analysis.dependencies.includes("fastapi")) analysis.framework = "fastapi";
      else if (analysis.dependencies.includes("flask")) analysis.framework = "flask";
      else if (analysis.dependencies.includes("django")) analysis.framework = "django";
    }
    
    if (files.includes("Cargo.toml")) {
      analysis.type = "rust";
      analysis.language = "rust";
      analysis.packageManager = "cargo";
    }
    
    if (files.includes("go.mod")) {
      analysis.type = "go";
      analysis.language = "go";
      analysis.packageManager = "go";
    }

    // Get file structure
    function getStructure(dir, prefix = "", depth = 0) {
      if (depth > 2) return [];
      
      const items = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          path: prefix + entry.name
        });
        
        if (entry.isDirectory()) {
          const children = getStructure(
            path.join(dir, entry.name),
            prefix + entry.name + "/",
            depth + 1
          );
          items.push(...children);
        }
      }
      
      return items;
    }
    
    analysis.structure = getStructure(fullPath);

    return { success: true, analysis };
  }
});

registerTool({
  name: "project:run",
  category: "project",
  description: "Run project (dev server)",
  risk: "medium",
  parameters: {
    path: { type: "string", default: "." },
    script: { type: "string", default: "dev" }
  },
  async execute({ path: projectPath = ".", script = "dev" }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, projectPath);
    const pkgPath = path.join(fullPath, "package.json");

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      
      if (pkg.scripts?.[script]) {
        try {
          // Start in background
          const { spawn } = await import("child_process");
          const child = spawn("npm", ["run", script], {
            cwd: fullPath,
            detached: true,
            stdio: "ignore"
          });
          child.unref();
          
          return {
            success: true,
            script,
            pid: child.pid,
            message: `Started 'npm run ${script}' in background (PID: ${child.pid})`
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    }

    return { success: false, error: "No runnable script found" };
  }
});

registerTool({
  name: "project:install",
  category: "project",
  description: "Install project dependencies",
  risk: "medium",
  parameters: {
    path: { type: "string", default: "." }
  },
  async execute({ path: projectPath = "." }, context) {
    const workdir = context.workdir || process.cwd();
    const fullPath = path.resolve(workdir, projectPath);

    // Detect package manager and install
    if (fs.existsSync(path.join(fullPath, "package.json"))) {
      try {
        const { stdout, stderr } = await execAsync("npm install", {
          cwd: fullPath,
          timeout: 120000
        });
        return { success: true, manager: "npm", output: stdout, stderr };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    if (fs.existsSync(path.join(fullPath, "requirements.txt"))) {
      try {
        const { stdout, stderr } = await execAsync("pip install -r requirements.txt", {
          cwd: fullPath,
          timeout: 120000
        });
        return { success: true, manager: "pip", output: stdout, stderr };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    return { success: false, error: "No package manifest found" };
  }
});

console.log("🏗️ Project tools registered");
