/**
 * C.3 TODO Manager
 * 
 * Správa úkolů v projektu.
 * Úkoly jsou ukládány do TODO.md v projektu.
 */

import fs from "fs";
import path from "path";

const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO] [C3:TODO] ${msg}`, data ? JSON.stringify(data) : ""),
};

export class TodoManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.todoFile = path.join(projectPath, "TODO.md");
  }

  /**
   * Initialize TODO file
   */
  init() {
    if (!fs.existsSync(this.todoFile)) {
      fs.writeFileSync(this.todoFile, `# TODO List

Dynamicky spravovaný seznam úkolů pro projekt.

## Aktivní úkoly

## Dokončené úkoly

`);
      log.info("TODO file created", { path: this.todoFile });
    }
    return this;
  }

  /**
   * Parse TODO.md
   */
  parse() {
    if (!fs.existsSync(this.todoFile)) {
      return { active: [], done: [] };
    }

    const content = fs.readFileSync(this.todoFile, "utf-8");
    const tasks = { active: [], done: [] };
    
    // Match tasks: ## [ ] #1 Title or ## [x] #1 Title
    const taskRegex = /^##\s*\[([ x])\]\s*#(\d+)\s+(.+?)(?:\n\n([\s\S]*?))?(?=\n##|\n*$)/gm;
    
    let match;
    while ((match = taskRegex.exec(content)) !== null) {
      const task = {
        id: parseInt(match[2]),
        title: match[3].trim(),
        done: match[1] === "x",
        description: match[4]?.trim() || "",
      };
      
      if (task.done) {
        tasks.done.push(task);
      } else {
        tasks.active.push(task);
      }
    }
    
    return tasks;
  }

  /**
   * Get next available ID
   */
  getNextId() {
    const tasks = this.parse();
    const allIds = [...tasks.active, ...tasks.done].map(t => t.id);
    return allIds.length === 0 ? 1 : Math.max(...allIds) + 1;
  }

  /**
   * Add new task
   */
  add(title, description = "") {
    this.init();
    
    const id = this.getNextId();
    const timestamp = new Date().toISOString();
    
    const taskEntry = `## [ ] #${id} ${title}

${description}

*Vytvořeno: ${timestamp}*

`;

    // Read current content
    let content = fs.readFileSync(this.todoFile, "utf-8");
    
    // Find "## Aktivní úkoly" section and add after it
    const activeSection = "## Aktivní úkoly";
    const insertIndex = content.indexOf(activeSection);
    
    if (insertIndex !== -1) {
      const afterSection = insertIndex + activeSection.length;
      content = content.slice(0, afterSection) + "\n\n" + taskEntry + content.slice(afterSection);
    } else {
      // Append at end
      content += "\n" + taskEntry;
    }
    
    fs.writeFileSync(this.todoFile, content, "utf-8");
    
    log.info("Task added", { id, title });
    
    return { id, title, description, done: false };
  }

  /**
   * Mark task as done
   */
  done(id) {
    if (!fs.existsSync(this.todoFile)) {
      return null;
    }
    
    let content = fs.readFileSync(this.todoFile, "utf-8");
    
    // Find task with this ID and mark as done
    const taskRegex = new RegExp(`(## \\[) \\] (#${id} .+)`, "m");
    const match = content.match(taskRegex);
    
    if (!match) {
      return null;
    }
    
    // Replace [ ] with [x]
    content = content.replace(taskRegex, "$1x] $2");
    
    // Add completion timestamp
    const completedAt = `\n*Dokončeno: ${new Date().toISOString()}*`;
    const taskEndRegex = new RegExp(`(## \\[x\\] #${id} .+?\n\n[\\s\\S]*?)(\n\n##|$)`);
    content = content.replace(taskEndRegex, `$1${completedAt}$2`);
    
    fs.writeFileSync(this.todoFile, content, "utf-8");
    
    log.info("Task completed", { id });
    
    return { id, done: true };
  }

  /**
   * List tasks
   */
  list(includeCompleted = false) {
    const tasks = this.parse();
    
    if (includeCompleted) {
      return [...tasks.active, ...tasks.done];
    }
    
    return tasks.active;
  }

  /**
   * Get task by ID
   */
  get(id) {
    const tasks = this.parse();
    return [...tasks.active, ...tasks.done].find(t => t.id === id) || null;
  }

  /**
   * Get summary for context
   */
  getSummary() {
    const tasks = this.parse();
    
    if (tasks.active.length === 0) {
      return "Žádné aktivní úkoly.";
    }
    
    let summary = `Aktivní úkoly (${tasks.active.length}):\n`;
    for (const task of tasks.active.slice(0, 5)) {
      summary += `- #${task.id}: ${task.title}\n`;
    }
    
    if (tasks.active.length > 5) {
      summary += `... a ${tasks.active.length - 5} dalších\n`;
    }
    
    return summary;
  }

  /**
   * Get stats
   */
  getStats() {
    const tasks = this.parse();
    
    return {
      active: tasks.active.length,
      done: tasks.done.length,
      total: tasks.active.length + tasks.done.length,
      path: this.todoFile,
    };
  }
}

/**
 * Get TODO manager for project
 */
const todoManagers = new Map();

export function getTodoManager(projectPath) {
  if (!todoManagers.has(projectPath)) {
    todoManagers.set(projectPath, new TodoManager(projectPath));
  }
  return todoManagers.get(projectPath);
}

export default TodoManager;
