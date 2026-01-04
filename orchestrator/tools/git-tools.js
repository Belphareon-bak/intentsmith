/**
 * Git Tools
 * 
 * Nástroje pro práci s Git.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { registerTool } from "./registry.js";

const execAsync = promisify(exec);

async function git(command, cwd) {
  const { stdout, stderr } = await execAsync(`git ${command}`, {
    cwd,
    timeout: 60000
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

// ================== GIT TOOLS ==================

registerTool({
  name: "git:init",
  category: "git",
  description: "Initialize a new Git repository",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    defaultBranch: { type: "string", default: "main" }
  },
  async execute({ path: repoPath = ".", defaultBranch = "main" }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);
    
    try {
      await git(`init -b ${defaultBranch}`, cwd);
      return { success: true, path: cwd, branch: defaultBranch };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:clone",
  category: "git",
  description: "Clone a Git repository",
  risk: "medium",
  parameters: {
    url: { type: "string", required: true },
    destination: { type: "string", default: null },
    depth: { type: "number", default: null }
  },
  async execute({ url, destination, depth }, context) {
    const cwd = context.workdir || process.cwd();
    
    let command = `clone ${url}`;
    if (destination) command += ` ${destination}`;
    if (depth) command += ` --depth ${depth}`;

    try {
      const { stdout } = await git(command, cwd);
      return { success: true, url, destination, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:status",
  category: "git",
  description: "Get Git repository status",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." }
  },
  async execute({ path: repoPath = "." }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    try {
      const { stdout: status } = await git("status --porcelain", cwd);
      const { stdout: branch } = await git("branch --show-current", cwd);
      
      const files = status.split("\n").filter(Boolean).map(line => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3)
      }));

      return {
        success: true,
        branch: branch.trim(),
        clean: files.length === 0,
        files
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:add",
  category: "git",
  description: "Stage files for commit",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    files: { type: "array", default: ["."] }
  },
  async execute({ path: repoPath = ".", files = ["."] }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    try {
      const fileList = files.join(" ");
      await git(`add ${fileList}`, cwd);
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:commit",
  category: "git",
  description: "Commit staged changes",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    message: { type: "string", required: true }
  },
  async execute({ path: repoPath = ".", message }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    try {
      const { stdout } = await git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
      
      // Extract commit hash
      const hashMatch = stdout.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
      const hash = hashMatch ? hashMatch[1] : null;

      return { success: true, message, hash, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:push",
  category: "git",
  description: "Push commits to remote",
  risk: "high",
  requiresApproval: true,
  parameters: {
    path: { type: "string", default: "." },
    remote: { type: "string", default: "origin" },
    branch: { type: "string", default: null },
    force: { type: "boolean", default: false }
  },
  async execute({ path: repoPath = ".", remote = "origin", branch, force = false }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    let command = `push ${remote}`;
    if (branch) command += ` ${branch}`;
    if (force) command += " --force";

    try {
      const { stdout } = await git(command, cwd);
      return { success: true, remote, branch, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:pull",
  category: "git",
  description: "Pull changes from remote",
  risk: "medium",
  parameters: {
    path: { type: "string", default: "." },
    remote: { type: "string", default: "origin" },
    branch: { type: "string", default: null }
  },
  async execute({ path: repoPath = ".", remote = "origin", branch }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    let command = `pull ${remote}`;
    if (branch) command += ` ${branch}`;

    try {
      const { stdout } = await git(command, cwd);
      return { success: true, remote, branch, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:branch",
  category: "git",
  description: "List, create, or switch branches",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    action: { type: "string", default: "list" }, // list, create, switch, delete
    name: { type: "string", default: null }
  },
  async execute({ path: repoPath = ".", action = "list", name }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    try {
      switch (action) {
        case "list": {
          const { stdout } = await git("branch -a", cwd);
          const branches = stdout.split("\n").map(b => ({
            name: b.replace(/^\*?\s*/, "").trim(),
            current: b.startsWith("*")
          })).filter(b => b.name);
          return { success: true, action, branches };
        }
        
        case "create": {
          if (!name) throw new Error("Branch name required");
          await git(`branch ${name}`, cwd);
          return { success: true, action, name };
        }
        
        case "switch": {
          if (!name) throw new Error("Branch name required");
          await git(`checkout ${name}`, cwd);
          return { success: true, action, name };
        }
        
        case "delete": {
          if (!name) throw new Error("Branch name required");
          await git(`branch -d ${name}`, cwd);
          return { success: true, action, name };
        }
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:log",
  category: "git",
  description: "Show commit history",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    count: { type: "number", default: 10 }
  },
  async execute({ path: repoPath = ".", count = 10 }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    try {
      const { stdout } = await git(
        `log -${count} --pretty=format:"%h|%s|%an|%ai"`,
        cwd
      );
      
      const commits = stdout.split("\n").filter(Boolean).map(line => {
        const [hash, subject, author, date] = line.split("|");
        return { hash, subject, author, date };
      });

      return { success: true, commits };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "git:diff",
  category: "git",
  description: "Show changes",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    staged: { type: "boolean", default: false },
    file: { type: "string", default: null }
  },
  async execute({ path: repoPath = ".", staged = false, file }, context) {
    const cwd = path.resolve(context.workdir || process.cwd(), repoPath);

    let command = "diff";
    if (staged) command += " --staged";
    if (file) command += ` -- ${file}`;

    try {
      const { stdout } = await git(command, cwd);
      return { success: true, diff: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

console.log("📦 Git tools registered");
