/**
 * C.3 Memory Bank
 * 
 * Persistentní paměť pro AI agenta napříč sezeními.
 * Struktura:
 * - workflows/    - Naučené postupy
 * - constraints/  - Pravidla a omezení
 * - tools/        - Dostupné nástroje a jak je používat
 * - metadata/     - Kontext projektu
 */

import fs from "fs";
import path from "path";

const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO] [C3:Memory] ${msg}`, data ? JSON.stringify(data) : ""),
  debug: (msg, data) => console.log(`[${new Date().toISOString()}] [DEBUG] [C3:Memory] ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg, data) => console.log(`[${new Date().toISOString()}] [WARN] [C3:Memory] ${msg}`, data ? JSON.stringify(data) : ""),
};

const MEMORY_CATEGORIES = ["workflows", "constraints", "tools", "metadata"];

export class MemoryBank {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.memoryDir = path.join(projectPath, "memories");
    this.cache = null;
    this.lastLoad = 0;
    this.cacheTTL = 30000; // 30 sekund
  }

  /**
   * Initialize memory structure
   */
  init() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
      
      for (const cat of MEMORY_CATEGORIES) {
        fs.mkdirSync(path.join(this.memoryDir, cat), { recursive: true });
      }
      
      // Create README
      fs.writeFileSync(
        path.join(this.memoryDir, "README.md"),
        `# Memory Bank

Databáze naučených znalostí pro C.3 AI agenta.

## Struktura

### \`workflows/\`
Naučené postupy a best practices.

### \`constraints/\`
Pravidla, omezení a co NEDĚLAT.

### \`tools/\`
Dostupné nástroje a jak je používat.

### \`metadata/\`
Kontext a meta-informace o projektu.

## Principy

✅ **Ukládej:**
- Meta-znalosti (vzory, principy)
- Obecně použitelné postupy
- Pravidla a konvence

❌ **Neukládej:**
- Konkrétní detaily projektu
- Implementační specifika
- Logy a statistiky
`
      );
      
      log.info("Memory Bank initialized", { path: this.memoryDir });
    }
    
    return this;
  }

  /**
   * Load all memories
   */
  load(force = false) {
    const now = Date.now();
    
    // Use cache if valid
    if (!force && this.cache && (now - this.lastLoad) < this.cacheTTL) {
      return this.cache;
    }
    
    const memory = {
      workflows: [],
      constraints: [],
      tools: [],
      metadata: {},
    };
    
    if (!fs.existsSync(this.memoryDir)) {
      return memory;
    }
    
    for (const cat of MEMORY_CATEGORIES) {
      const catDir = path.join(this.memoryDir, cat);
      
      if (!fs.existsSync(catDir)) continue;
      
      const files = fs.readdirSync(catDir).filter(f => f.endsWith(".md"));
      
      for (const file of files) {
        const filePath = path.join(catDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const name = file.replace(".md", "");
        
        if (cat === "metadata") {
          memory.metadata[name] = content;
        } else {
          memory[cat].push({
            name,
            file,
            path: filePath,
            content,
            size: content.length,
          });
        }
      }
    }
    
    this.cache = memory;
    this.lastLoad = now;
    
    log.debug("Memory loaded", {
      workflows: memory.workflows.length,
      constraints: memory.constraints.length,
      tools: memory.tools.length,
      metadata: Object.keys(memory.metadata).length,
    });
    
    return memory;
  }

  /**
   * Get memory for context building
   */
  getContext(maxLength = 4000) {
    const memory = this.load();
    let context = "";
    let currentLength = 0;
    
    // Priority: constraints > workflows > tools > metadata
    const sections = [
      { name: "Pravidla", items: memory.constraints, priority: 1 },
      { name: "Workflows", items: memory.workflows, priority: 2 },
      { name: "Nástroje", items: memory.tools, priority: 3 },
    ];
    
    for (const section of sections) {
      if (section.items.length === 0) continue;
      
      let sectionContent = `\n### ${section.name}:\n`;
      
      for (const item of section.items) {
        // Zkrať obsah pokud je moc dlouhý
        const excerpt = item.content.length > 500 
          ? item.content.substring(0, 500) + "..."
          : item.content;
        
        const itemText = `- **${item.name}**: ${excerpt}\n`;
        
        if (currentLength + itemText.length > maxLength) {
          break;
        }
        
        sectionContent += itemText;
        currentLength += itemText.length;
      }
      
      context += sectionContent;
    }
    
    // Metadata
    if (Object.keys(memory.metadata).length > 0) {
      context += "\n### Metadata:\n";
      for (const [key, value] of Object.entries(memory.metadata)) {
        const excerpt = value.length > 200 ? value.substring(0, 200) + "..." : value;
        context += `- **${key}**: ${excerpt}\n`;
      }
    }
    
    return context;
  }

  /**
   * Add new memory
   */
  add(category, name, content) {
    if (!MEMORY_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}. Use: ${MEMORY_CATEGORIES.join(", ")}`);
    }
    
    this.init();
    
    const fileName = name.toLowerCase().replace(/\s+/g, "-") + ".md";
    const filePath = path.join(this.memoryDir, category, fileName);
    
    // Add header if not present
    if (!content.startsWith("#")) {
      content = `# ${name}\n\n${content}`;
    }
    
    fs.writeFileSync(filePath, content, "utf-8");
    
    // Invalidate cache
    this.cache = null;
    
    log.info("Memory added", { category, name, file: fileName });
    
    return { category, name, file: fileName, path: filePath };
  }

  /**
   * Update existing memory
   */
  update(category, name, content) {
    return this.add(category, name, content);
  }

  /**
   * Remove memory
   */
  remove(category, name) {
    const fileName = name.toLowerCase().replace(/\s+/g, "-") + ".md";
    const filePath = path.join(this.memoryDir, category, fileName);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.cache = null;
      log.info("Memory removed", { category, name });
      return true;
    }
    
    return false;
  }

  /**
   * Search memories
   */
  search(query) {
    const memory = this.load();
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const cat of ["workflows", "constraints", "tools"]) {
      for (const item of memory[cat]) {
        if (
          item.name.toLowerCase().includes(queryLower) ||
          item.content.toLowerCase().includes(queryLower)
        ) {
          results.push({
            category: cat,
            ...item,
            relevance: item.name.toLowerCase().includes(queryLower) ? 2 : 1,
          });
        }
      }
    }
    
    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);
    
    return results;
  }

  /**
   * Get stats
   */
  getStats() {
    const memory = this.load();
    
    return {
      path: this.memoryDir,
      exists: fs.existsSync(this.memoryDir),
      counts: {
        workflows: memory.workflows.length,
        constraints: memory.constraints.length,
        tools: memory.tools.length,
        metadata: Object.keys(memory.metadata).length,
      },
      totalSize: [
        ...memory.workflows,
        ...memory.constraints,
        ...memory.tools,
      ].reduce((sum, item) => sum + item.size, 0),
    };
  }

  /**
   * Prune - remove duplicates and merge similar
   */
  prune() {
    const memory = this.load(true);
    const removed = [];
    
    for (const cat of ["workflows", "constraints", "tools"]) {
      const seen = new Map();
      
      for (const item of memory[cat]) {
        // Simple duplicate detection based on content similarity
        const contentHash = item.content.substring(0, 100);
        
        if (seen.has(contentHash)) {
          // Remove duplicate
          if (this.remove(cat, item.name)) {
            removed.push({ category: cat, name: item.name });
          }
        } else {
          seen.set(contentHash, item.name);
        }
      }
    }
    
    log.info("Memory pruned", { removed: removed.length });
    return removed;
  }
}

/**
 * Get memory bank for project
 */
const memoryBanks = new Map();

export function getMemoryBank(projectPath) {
  if (!memoryBanks.has(projectPath)) {
    memoryBanks.set(projectPath, new MemoryBank(projectPath));
  }
  return memoryBanks.get(projectPath);
}

export default MemoryBank;
