/**
 * C.3 Commands Handler
 * 
 * Zpracování speciálních příkazů:
 * - /init - Inicializace kontextu
 * - /todo <text> - Přidání úkolu
 * - /done [id] - Dokončení úkolu
 * - /memory - Zobrazení paměti
 * - /updateMemory - Aktualizace paměti
 * - /plan - Zobrazení aktuálního plánu
 */

import { getMemoryBank } from "../memory/memory-bank.js";
import { getTodoManager } from "../memory/todo-manager.js";
import fs from "fs";
import path from "path";

const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO] [C3:Commands] ${msg}`, data ? JSON.stringify(data) : ""),
};

/**
 * Check if message is a command
 */
export function isCommand(message) {
  return message.trim().startsWith("/");
}

/**
 * Parse command from message
 */
export function parseCommand(message) {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/(\w+)(?:\s+(.*))?$/);
  
  if (!match) {
    return null;
  }
  
  return {
    command: match[1].toLowerCase(),
    args: match[2]?.trim() || "",
  };
}

/**
 * Handle command
 */
export async function handleCommand(message, context = {}) {
  const parsed = parseCommand(message);
  
  if (!parsed) {
    return null;
  }
  
  const { command, args } = parsed;
  const workdir = context.workdir || process.cwd();
  
  log.info(`Command: /${command}`, { args, workdir });
  
  switch (command) {
    case "init":
      return handleInit(workdir, args);
    
    case "todo":
      return handleTodo(workdir, args);
    
    case "done":
      return handleDone(workdir, args);
    
    case "memory":
    case "showmemory":
      return handleShowMemory(workdir);
    
    case "updatememory":
      return handleUpdateMemory(workdir, args, context);
    
    case "plan":
      return handleShowPlan(workdir);
    
    case "status":
      return handleStatus(workdir);
    
    case "help":
      return handleHelp();
    
    default:
      return {
        handled: false,
        response: `Neznámý příkaz: /${command}\n\nPoužij /help pro seznam dostupných příkazů.`,
      };
  }
}

/**
 * /init - Initialize context
 */
function handleInit(workdir, args) {
  const memory = getMemoryBank(workdir);
  const todo = getTodoManager(workdir);
  
  // Init memory structure
  memory.init();
  todo.init();
  
  // Load context
  const memoryContext = memory.getContext();
  const todoSummary = todo.getSummary();
  const memoryStats = memory.getStats();
  const todoStats = todo.getStats();
  
  // Check for README
  let projectInfo = "";
  const readmePath = path.join(workdir, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf-8");
    projectInfo = `\n### Projekt:\n${readme.substring(0, 500)}...\n`;
  }
  
  // Check for .c3-plan.md
  let planInfo = "";
  const planPath = path.join(workdir, ".c3-plan.md");
  if (fs.existsSync(planPath)) {
    planInfo = "\n📋 Existuje rozpracovaný plán (`.c3-plan.md`)\n";
  }
  
  const response = `## 🚀 Kontext inicializován

**Workspace:** \`${workdir}\`

### Memory Bank
- Workflows: ${memoryStats.counts.workflows}
- Constraints: ${memoryStats.counts.constraints}
- Tools: ${memoryStats.counts.tools}
- Metadata: ${memoryStats.counts.metadata}

### TODO
- Aktivní úkoly: ${todoStats.active}
- Dokončené: ${todoStats.done}
${todoSummary ? `\n${todoSummary}` : ""}
${projectInfo}
${planInfo}

---
*Připraven. Jak mohu pomoci?*`;

  return {
    handled: true,
    response,
    context: {
      memory: memoryContext,
      todos: todoSummary,
      initialized: true,
    },
  };
}

/**
 * /todo <text> - Add task
 */
function handleTodo(workdir, args) {
  if (!args) {
    return {
      handled: true,
      response: "Použití: `/todo <popis úkolu>`\n\nPříklad: `/todo Implementovat autentizaci`",
    };
  }
  
  const todo = getTodoManager(workdir);
  todo.init();
  
  const task = todo.add(args);
  
  return {
    handled: true,
    response: `✅ Úkol přidán: **#${task.id}** ${task.title}`,
  };
}

/**
 * /done [id] - Complete task
 */
function handleDone(workdir, args) {
  const todo = getTodoManager(workdir);
  
  // If no ID provided, show active tasks
  if (!args) {
    const tasks = todo.list();
    
    if (tasks.length === 0) {
      return {
        handled: true,
        response: "Žádné aktivní úkoly k dokončení.",
      };
    }
    
    let response = "Aktivní úkoly:\n\n";
    for (const task of tasks) {
      response += `- **#${task.id}**: ${task.title}\n`;
    }
    response += "\nPoužij `/done <id>` pro označení jako dokončené.";
    
    return {
      handled: true,
      response,
    };
  }
  
  const id = parseInt(args);
  
  if (isNaN(id)) {
    return {
      handled: true,
      response: `Neplatné ID: ${args}. Použij číslo úkolu.`,
    };
  }
  
  const result = todo.done(id);
  
  if (!result) {
    return {
      handled: true,
      response: `Úkol #${id} nenalezen.`,
    };
  }
  
  return {
    handled: true,
    response: `✅ Úkol **#${id}** označen jako dokončený.`,
  };
}

/**
 * /memory - Show memory
 */
function handleShowMemory(workdir) {
  const memory = getMemoryBank(workdir);
  const data = memory.load();
  const stats = memory.getStats();
  
  let response = `## 🧠 Memory Bank

**Cesta:** \`${stats.path}\`
**Celková velikost:** ${stats.totalSize} bytes

`;

  if (data.workflows.length > 0) {
    response += `### Workflows (${data.workflows.length})\n`;
    for (const item of data.workflows) {
      response += `- **${item.name}** (${item.size} bytes)\n`;
    }
    response += "\n";
  }
  
  if (data.constraints.length > 0) {
    response += `### Constraints (${data.constraints.length})\n`;
    for (const item of data.constraints) {
      response += `- **${item.name}** (${item.size} bytes)\n`;
    }
    response += "\n";
  }
  
  if (data.tools.length > 0) {
    response += `### Tools (${data.tools.length})\n`;
    for (const item of data.tools) {
      response += `- **${item.name}** (${item.size} bytes)\n`;
    }
    response += "\n";
  }
  
  if (Object.keys(data.metadata).length > 0) {
    response += `### Metadata\n`;
    for (const key of Object.keys(data.metadata)) {
      response += `- **${key}**\n`;
    }
  }
  
  if (stats.totalSize === 0) {
    response += "*Memory Bank je prázdná. Použij `/updateMemory` pro přidání znalostí.*";
  }
  
  return {
    handled: true,
    response,
  };
}

/**
 * /updateMemory - Update memory from conversation
 */
function handleUpdateMemory(workdir, args, context) {
  if (!args) {
    return {
      handled: true,
      response: `## Aktualizace Memory Bank

Použití: \`/updateMemory <kategorie> <název> <obsah>\`

Kategorie:
- **workflows** - Naučené postupy
- **constraints** - Pravidla a omezení
- **tools** - Nástroje a jak je používat
- **metadata** - Kontext projektu

Příklad:
\`/updateMemory workflows code-review Vždy používat dual review systém D1→CODE→R2→R1\``,
    };
  }
  
  // Parse: category name content
  const parts = args.match(/^(\w+)\s+(\S+)\s+(.+)$/s);
  
  if (!parts) {
    return {
      handled: true,
      response: "Neplatný formát. Použij: `/updateMemory <kategorie> <název> <obsah>`",
    };
  }
  
  const [, category, name, content] = parts;
  
  try {
    const memory = getMemoryBank(workdir);
    const result = memory.add(category, name, content);
    
    return {
      handled: true,
      response: `✅ Memory uložena: **${result.category}/${result.name}**`,
    };
  } catch (e) {
    return {
      handled: true,
      response: `❌ Chyba: ${e.message}`,
    };
  }
}

/**
 * /plan - Show current plan
 */
function handleShowPlan(workdir) {
  const planPath = path.join(workdir, ".c3-plan.md");
  
  if (!fs.existsSync(planPath)) {
    return {
      handled: true,
      response: "Žádný aktivní plán. Začni nový požadavek pro vytvoření plánu.",
    };
  }
  
  const plan = fs.readFileSync(planPath, "utf-8");
  
  return {
    handled: true,
    response: `## 📋 Aktuální plán\n\n${plan}`,
  };
}

/**
 * /status - Project status
 */
function handleStatus(workdir) {
  const memory = getMemoryBank(workdir);
  const todo = getTodoManager(workdir);
  
  const memoryStats = memory.getStats();
  const todoStats = todo.getStats();
  
  const planPath = path.join(workdir, ".c3-plan.md");
  const hasPlan = fs.existsSync(planPath);
  
  return {
    handled: true,
    response: `## 📊 Status projektu

**Workspace:** \`${workdir}\`

| Komponenta | Status |
|------------|--------|
| Memory Bank | ${memoryStats.exists ? "✅" : "❌"} (${memoryStats.counts.workflows + memoryStats.counts.constraints} items) |
| TODO | ${todoStats.active} aktivních, ${todoStats.done} hotových |
| Plán | ${hasPlan ? "✅ Existuje" : "❌ Žádný"} |
`,
  };
}

/**
 * /help - Show help
 */
function handleHelp() {
  return {
    handled: true,
    response: `## 📚 C.3 Příkazy

### Kontext
- \`/init\` - Inicializace kontextu, načtení memory a TODO
- \`/status\` - Stav projektu

### TODO
- \`/todo <text>\` - Přidání nového úkolu
- \`/done [id]\` - Označení úkolu jako hotového

### Memory Bank
- \`/memory\` - Zobrazení uložených znalostí
- \`/updateMemory <cat> <name> <content>\` - Přidání znalosti

### Plánování
- \`/plan\` - Zobrazení aktuálního plánu

---
*Pro normální konverzaci nebo zadání úkolu piš bez lomítka.*`,
  };
}

export default {
  isCommand,
  parseCommand,
  handleCommand,
};
