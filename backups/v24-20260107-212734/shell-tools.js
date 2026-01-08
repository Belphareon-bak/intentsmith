/**
 * Shell Tools
 * 
 * Nástroje pro spouštění shell příkazů.
 */

import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { registerTool } from "./registry.js";

const execAsync = promisify(exec);

// Dangerous commands that require explicit approval
const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)/i,
  /sudo/i,
  /chmod\s+777/i,
  />\s*\/dev\//i,
  /mkfs/i,
  /dd\s+if=/i,
  /:\(\)\s*\{/,  // fork bomb
  /wget.*\|.*sh/i,
  /curl.*\|.*sh/i,
];

function isDangerous(command) {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

// ================== SHELL TOOLS ==================

registerTool({
  name: "shell:exec",
  category: "shell",
  description: "Execute a shell command and return output",
  risk: "medium",
  parameters: {
    command: { type: "string", required: true },
    cwd: { type: "string", default: null },
    timeout: { type: "number", default: 30000 },
    env: { type: "object", default: {} }
  },
  validate({ command }) {
    if (!command || typeof command !== "string") {
      return false;
    }
    return true;
  },
  async execute({ command, cwd, timeout = 30000, env = {} }, context) {
    const workdir = cwd 
      ? path.resolve(context.workdir || process.cwd(), cwd)
      : (context.workdir || process.cwd());

    // Check for dangerous commands
    if (isDangerous(command)) {
      return {
        success: false,
        error: "Command blocked: contains dangerous pattern",
        requiresApproval: true,
        command
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workdir,
        timeout,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      return {
        success: true,
        command,
        cwd: workdir,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };

    } catch (error) {
      return {
        success: false,
        command,
        cwd: workdir,
        stdout: error.stdout?.trim() || "",
        stderr: error.stderr?.trim() || error.message,
        exitCode: error.code || 1
      };
    }
  }
});

registerTool({
  name: "shell:run",
  category: "shell",
  description: "Run a command in background (for servers, watchers)",
  risk: "high",
  requiresApproval: true,
  parameters: {
    command: { type: "string", required: true },
    cwd: { type: "string", default: null },
    detached: { type: "boolean", default: true }
  },
  async execute({ command, cwd, detached = true }, context) {
    const workdir = cwd 
      ? path.resolve(context.workdir || process.cwd(), cwd)
      : (context.workdir || process.cwd());

    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const child = spawn(cmd, args, {
      cwd: workdir,
      detached,
      stdio: detached ? "ignore" : "pipe",
      env: process.env
    });

    if (detached) {
      child.unref();
    }

    return {
      success: true,
      command,
      pid: child.pid,
      detached
    };
  }
});

registerTool({
  name: "shell:which",
  category: "shell",
  description: "Find executable path",
  risk: "low",
  parameters: {
    command: { type: "string", required: true }
  },
  async execute({ command }) {
    try {
      const { stdout } = await execAsync(`which ${command}`);
      return {
        command,
        path: stdout.trim(),
        found: true
      };
    } catch {
      return {
        command,
        path: null,
        found: false
      };
    }
  }
});

registerTool({
  name: "shell:env",
  category: "shell",
  description: "Get environment variables",
  risk: "low",
  parameters: {
    filter: { type: "string", default: null }
  },
  async execute({ filter }) {
    let env = { ...process.env };

    // Remove sensitive vars
    delete env.PASSWORD;
    delete env.SECRET;
    delete env.TOKEN;
    delete env.API_KEY;
    delete env.PRIVATE_KEY;

    if (filter) {
      const regex = new RegExp(filter, "i");
      env = Object.fromEntries(
        Object.entries(env).filter(([key]) => regex.test(key))
      );
    }

    return { env, count: Object.keys(env).length };
  }
});

// ================== PACKAGE MANAGERS ==================

registerTool({
  name: "npm:install",
  category: "packages",
  description: "Install npm packages",
  risk: "medium",
  parameters: {
    packages: { type: "array", default: [] },
    dev: { type: "boolean", default: false },
    cwd: { type: "string", default: null }
  },
  async execute({ packages = [], dev = false, cwd }, context) {
    const workdir = cwd 
      ? path.resolve(context.workdir || process.cwd(), cwd)
      : (context.workdir || process.cwd());

    const devFlag = dev ? "-D" : "";
    const pkgList = packages.join(" ");
    const command = packages.length > 0 
      ? `npm install ${devFlag} ${pkgList}`
      : "npm install";

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workdir,
        timeout: 120000 // 2 min for npm
      });

      return {
        success: true,
        command,
        packages,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      return {
        success: false,
        command,
        error: error.message,
        stderr: error.stderr?.trim()
      };
    }
  }
});

registerTool({
  name: "npm:run",
  category: "packages",
  description: "Run npm script",
  risk: "medium",
  parameters: {
    script: { type: "string", required: true },
    cwd: { type: "string", default: null }
  },
  async execute({ script, cwd }, context) {
    const workdir = cwd 
      ? path.resolve(context.workdir || process.cwd(), cwd)
      : (context.workdir || process.cwd());

    try {
      const { stdout, stderr } = await execAsync(`npm run ${script}`, {
        cwd: workdir,
        timeout: 300000 // 5 min
      });

      return {
        success: true,
        script,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      return {
        success: false,
        script,
        error: error.message,
        stdout: error.stdout?.trim(),
        stderr: error.stderr?.trim()
      };
    }
  }
});

registerTool({
  name: "npm:init",
  category: "packages",
  description: "Initialize npm project",
  risk: "low",
  parameters: {
    cwd: { type: "string", default: null },
    name: { type: "string", default: null }
  },
  async execute({ cwd, name }, context) {
    const workdir = cwd 
      ? path.resolve(context.workdir || process.cwd(), cwd)
      : (context.workdir || process.cwd());

    try {
      const { stdout } = await execAsync("npm init -y", {
        cwd: workdir,
        timeout: 10000
      });

      return {
        success: true,
        cwd: workdir,
        stdout: stdout.trim()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

console.log("🐚 Shell tools registered");
