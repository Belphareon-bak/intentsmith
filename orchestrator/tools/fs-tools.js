/**
 * Filesystem Tools
 * 
 * Nástroje pro práci se soubory a adresáři.
 */

import fs from "fs";
import path from "path";
import { registerTool } from "./registry.js";

// Sandbox enforcement
function resolveSafePath(basePath, relativePath) {
  // Allow absolute paths (user specified)
  if (relativePath && path.isAbsolute(relativePath)) {
    return relativePath;
  }
  
  const resolved = path.resolve(basePath, relativePath || ".");
  
  // Security: ensure path is within sandbox for relative paths
  if (!resolved.startsWith(path.resolve(basePath))) {
    throw new Error(`Path escape attempt: ${relativePath} (base: ${basePath})`);
  }
  
  return resolved;
}

// ================== READ TOOLS ==================

registerTool({
  name: "fs:read",
  category: "filesystem",
  description: "Read file contents",
  risk: "low",
  parameters: {
    path: { type: "string", required: true },
    encoding: { type: "string", default: "utf-8" }
  },
  async execute({ path: filePath, encoding = "utf-8" }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
    
    const content = fs.readFileSync(fullPath, encoding);
    
    return {
      path: filePath,
      content,
      size: stats.size,
      modified: stats.mtime.toISOString()
    };
  }
});

registerTool({
  name: "fs:list",
  category: "filesystem",
  description: "List directory contents",
  risk: "low",
  parameters: {
    path: { type: "string", default: "." },
    recursive: { type: "boolean", default: false },
    maxDepth: { type: "number", default: 3 }
  },
  async execute({ path: dirPath = ".", recursive = false, maxDepth = 3 }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), dirPath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    
    function listDir(dir, depth = 0) {
      if (depth > maxDepth) return [];
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results = [];
      
      for (const entry of entries) {
        // Skip hidden files and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        
        const entryPath = path.join(dir, entry.name);
        const relativePath = path.relative(fullPath, entryPath);
        
        const item = {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? "directory" : "file"
        };
        
        if (entry.isFile()) {
          const stats = fs.statSync(entryPath);
          item.size = stats.size;
        }
        
        results.push(item);
        
        if (recursive && entry.isDirectory()) {
          const children = listDir(entryPath, depth + 1);
          results.push(...children);
        }
      }
      
      return results;
    }
    
    const entries = listDir(fullPath);
    
    return {
      path: dirPath,
      entries,
      count: entries.length
    };
  }
});

registerTool({
  name: "fs:exists",
  category: "filesystem",
  description: "Check if file or directory exists",
  risk: "low",
  parameters: {
    path: { type: "string", required: true }
  },
  async execute({ path: filePath }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    const exists = fs.existsSync(fullPath);
    let type = null;
    
    if (exists) {
      const stats = fs.statSync(fullPath);
      type = stats.isDirectory() ? "directory" : "file";
    }
    
    return { path: filePath, exists, type };
  }
});

registerTool({
  name: "fs:search",
  category: "filesystem",
  description: "Search for files by pattern",
  risk: "low",
  parameters: {
    pattern: { type: "string", required: true },
    path: { type: "string", default: "." },
    maxResults: { type: "number", default: 100 }
  },
  async execute({ pattern, path: dirPath = ".", maxResults = 100 }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), dirPath);
    const regex = new RegExp(pattern.replace(/\*/g, ".*"), "i");
    const results = [];
    
    function search(dir) {
      if (results.length >= maxResults) return;
      
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (results.length >= maxResults) return;
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          
          const entryPath = path.join(dir, entry.name);
          
          if (regex.test(entry.name)) {
            results.push({
              name: entry.name,
              path: path.relative(fullPath, entryPath),
              type: entry.isDirectory() ? "directory" : "file"
            });
          }
          
          if (entry.isDirectory()) {
            search(entryPath);
          }
        }
      } catch (e) {
        // Skip inaccessible directories
      }
    }
    
    search(fullPath);
    
    return { pattern, results, count: results.length };
  }
});

// ================== WRITE TOOLS ==================

registerTool({
  name: "fs:write",
  category: "filesystem",
  description: "Write content to a file",
  risk: "medium",
  parameters: {
    path: { type: "string", required: true },
    content: { type: "string", required: true },
    createDirs: { type: "boolean", default: true }
  },
  async execute({ path: filePath, content, createDirs = true }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    if (createDirs) {
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const existed = fs.existsSync(fullPath);
    fs.writeFileSync(fullPath, content, "utf-8");
    
    return {
      path: filePath,
      created: !existed,
      size: Buffer.byteLength(content)
    };
  }
});

registerTool({
  name: "fs:append",
  category: "filesystem",
  description: "Append content to a file",
  risk: "medium",
  parameters: {
    path: { type: "string", required: true },
    content: { type: "string", required: true }
  },
  async execute({ path: filePath, content }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    fs.appendFileSync(fullPath, content, "utf-8");
    const stats = fs.statSync(fullPath);
    
    return {
      path: filePath,
      newSize: stats.size
    };
  }
});

registerTool({
  name: "fs:mkdir",
  category: "filesystem",
  description: "Create directory",
  risk: "low",
  parameters: {
    path: { type: "string", required: true },
    recursive: { type: "boolean", default: true }
  },
  async execute({ path: dirPath, recursive = true }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), dirPath);
    
    const existed = fs.existsSync(fullPath);
    fs.mkdirSync(fullPath, { recursive });
    
    return {
      path: dirPath,
      created: !existed
    };
  }
});

registerTool({
  name: "fs:copy",
  category: "filesystem",
  description: "Copy file or directory",
  risk: "medium",
  parameters: {
    source: { type: "string", required: true },
    destination: { type: "string", required: true }
  },
  async execute({ source, destination }, context) {
    const workdir = context.workdir || process.cwd();
    const srcPath = resolveSafePath(workdir, source);
    const destPath = resolveSafePath(workdir, destination);
    
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Source not found: ${source}`);
    }
    
    const stats = fs.statSync(srcPath);
    
    if (stats.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
    
    return { source, destination, isDirectory: stats.isDirectory() };
  }
});

registerTool({
  name: "fs:move",
  category: "filesystem",
  description: "Move/rename file or directory",
  risk: "medium",
  parameters: {
    source: { type: "string", required: true },
    destination: { type: "string", required: true }
  },
  async execute({ source, destination }, context) {
    const workdir = context.workdir || process.cwd();
    const srcPath = resolveSafePath(workdir, source);
    const destPath = resolveSafePath(workdir, destination);
    
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Source not found: ${source}`);
    }
    
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.renameSync(srcPath, destPath);
    
    return { source, destination };
  }
});

registerTool({
  name: "fs:delete",
  category: "filesystem",
  description: "Delete file or directory",
  risk: "high",
  requiresApproval: true,
  parameters: {
    path: { type: "string", required: true },
    recursive: { type: "boolean", default: false }
  },
  async execute({ path: filePath, recursive = false }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { path: filePath, deleted: false, reason: "not_found" };
    }
    
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      if (!recursive) {
        throw new Error("Cannot delete directory without recursive=true");
      }
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    
    return { path: filePath, deleted: true };
  }
});

// ================== CONTENT TOOLS ==================

registerTool({
  name: "fs:replace",
  category: "filesystem",
  description: "Replace text in a file",
  risk: "medium",
  parameters: {
    path: { type: "string", required: true },
    search: { type: "string", required: true },
    replace: { type: "string", required: true },
    all: { type: "boolean", default: false }
  },
  async execute({ path: filePath, search, replace, all = false }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    let content = fs.readFileSync(fullPath, "utf-8");
    const originalLength = content.length;
    
    if (all) {
      content = content.split(search).join(replace);
    } else {
      content = content.replace(search, replace);
    }
    
    fs.writeFileSync(fullPath, content, "utf-8");
    
    return {
      path: filePath,
      replaced: content.length !== originalLength || content.includes(replace)
    };
  }
});

registerTool({
  name: "fs:patch",
  category: "filesystem",
  description: "Apply a patch to a file (find unique string, replace with new content)",
  risk: "medium",
  parameters: {
    path: { type: "string", required: true },
    find: { type: "string", required: true },
    replace: { type: "string", required: true }
  },
  async execute({ path: filePath, find, replace }, context) {
    const fullPath = resolveSafePath(context.workdir || process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(fullPath, "utf-8");
    
    // Check uniqueness
    const occurrences = content.split(find).length - 1;
    
    if (occurrences === 0) {
      throw new Error("Search string not found in file");
    }
    
    if (occurrences > 1) {
      throw new Error(`Search string is not unique (found ${occurrences} times)`);
    }
    
    const newContent = content.replace(find, replace);
    fs.writeFileSync(fullPath, newContent, "utf-8");
    
    return { path: filePath, patched: true };
  }
});

console.log("📁 Filesystem tools registered");
