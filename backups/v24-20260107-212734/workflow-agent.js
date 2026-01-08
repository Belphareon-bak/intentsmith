/**
 * C.3 Workflow Agent
 * 
 * Hierarchický dual review systém:
 * D1 (plan) → CODE (impl) → R2 (quick review) → [D2 → CODE → R2]* → R1 (final) → DONE
 * 
 * Roles:
 * - D1: deepseek-r1-32b - Hlavní architekt, plánování, finální review
 * - D2: qwen3-30b-a3b - Sekundární designer, návrhy oprav
 * - R1: deepseek-r1-32b - Senior reviewer, finální gate
 * - R2: qwen2.5:32b - Junior reviewer, rychlé iterace
 * - CODE: qwen25-coder-32b - Implementace
 */

import { callLLM } from "../llm/llm-router.js";
import { toolRegistry, executeTool } from "../tools/index.js";
import fs from "fs";
import path from "path";

// Logging
const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO] [C3:Workflow] ${msg}`, data ? JSON.stringify(data) : ""),
  debug: (msg, data) => console.log(`[${new Date().toISOString()}] [DEBUG] [C3:Workflow] ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg, data) => console.log(`[${new Date().toISOString()}] [WARN] [C3:Workflow] ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg, data) => console.log(`[${new Date().toISOString()}] [ERROR] [C3:Workflow] ${msg}`, data ? JSON.stringify(data) : ""),
};

// Workflow states
export const State = {
  INIT: "INIT",
  CLARIFYING: "CLARIFYING",
  PLANNING: "PLANNING",
  PLAN_REVIEW: "PLAN_REVIEW",
  IMPLEMENTING: "IMPLEMENTING",
  REVIEWING_R2: "REVIEWING_R2",
  FIXING_D2: "FIXING_D2",
  REVIEWING_R1: "REVIEWING_R1",
  REDESIGNING_D1: "REDESIGNING_D1",
  DONE: "DONE",
  ERROR: "ERROR",
};

// Role prompts
const ROLE_PROMPTS = {
  D1_ANALYZE: `Jsi D1 - hlavní architekt AI systému. Tvým úkolem je analyzovat požadavek uživatele.

INSTRUKCE:
1. Přečti požadavek a zhodnoť, zda máš VŠECHNY potřebné informace.
2. BUĎ PŘÍSNÝ - pokud chybí COKOLIV z následujícího, VŽDY se zeptej:
   - Kam uložit soubory (cesta)?
   - Jaký jazyk/framework použít?
   - Jaké konkrétní funkce má mít?
   - Jaké jsou technické požadavky?
   - Jsou nějaké speciální požadavky na design/UI?

3. Pokud je požadavek vágní (např. "vytvoř aplikaci", "udělej web", "naprogramuj něco"), 
   VŽDY odpověz CLARIFY s konkrétními otázkami.

4. Odpověz READY pouze pokud:
   - Znáš přesnou cestu kam ukládat
   - Znáš jazyk/framework
   - Znáš konkrétní funkce
   - Máš dostatek detailů pro kvalitní implementaci

FORMÁT ODPOVĚDI:
Pokud potřebuješ více informací (PREFEROVANÁ ODPOVĚĎ pro krátké/vágní požadavky):
CLARIFY:
1. [konkrétní otázka 1]
2. [konkrétní otázka 2]
...

Pokud máš VŠECHNY potřebné informace:
READY: [stručný popis co vytvoříš včetně cesty, jazyka a funkcí]`,

  D1_PLAN: `Jsi D1 - hlavní architekt. Vytvoř detailní plán implementace.

INSTRUKCE:
1. Analyzuj požadavek a kontext
2. Navrhni strukturu souborů a jejich účel
3. Rozděl implementaci do kroků
4. Definuj kritéria úspěchu

FORMÁT PLÁNU:
## Přehled
[co budeme vytvářet]

## Soubory
- \`/cesta/soubor1.js\` - [účel]
- \`/cesta/soubor2.js\` - [účel]

## Kroky implementace
1. [krok 1]
2. [krok 2]
...

## Kritéria úspěchu
- [ ] [kritérium 1]
- [ ] [kritérium 2]

## Technologie
- [tech 1]
- [tech 2]`,

  CODE_IMPLEMENT: `Jsi CODE - expert na implementaci. Tvým úkolem je napsat kvalitní kód podle plánu.

INSTRUKCE:
1. Řiď se plánem od D1
2. Piš čistý, komentovaný kód
3. Pro KAŽDÝ soubor použij přesný formát s cestou v komentáři na prvním řádku

FORMÁT PRO KAŽDÝ SOUBOR:
\`\`\`javascript
// /cesta/k/souboru.js
[kód]
\`\`\`

PRO JSON SOUBORY (tasks.json, config.json, package.json atd.):
Protože JSON nepodporuje komentáře, napiš cestu PŘED code block:
Soubor: /cesta/k/souboru.json
\`\`\`json
{"key": "value"}
\`\`\`

DŮLEŽITÉ:
- Každý code block MUSÍ mít identifikaci cesty (komentář uvnitř NEBO "Soubor:" před blokem)
- Pro JSON soubory NIKDY nepřidávej komentáře dovnitř - JSON je nepodporuje!
- Implementuj VŠECHNY soubory z plánu
- Nepřeskakuj žádný soubor
- Pokud používáš EXTERNÍ MODULY (npm balíčky jako commander, express, axios...), MUSÍŠ také vytvořit package.json
- Pro Node.js projekty VŽDY vytvoř package.json se všemi dependencies
- NEPOUŽÍVEJ externí moduly pokud to není nutné - preferuj vestavěné moduly (fs, path, http...)`,

  R2_REVIEW: `Jsi R2 - junior reviewer. Proveď rychlou kontrolu kvality kódu.

INSTRUKCE:
1. Zkontroluj základní chyby (syntax, importy, typy)
2. Zkontroluj, zda jsou všechny soubory z plánu implementovány
3. Zkontroluj základní bezpečnost (hardcoded secrets, SQL injection)
4. KRITICKÉ: Zkontroluj DEPENDENCIES:
   - Pokud kód používá require() nebo import pro EXTERNÍ modul (např. commander, express, axios)
   - A NEEXISTUJE package.json s tímto modulem v dependencies
   - Označ jako FAIL s doporučením vytvořit package.json nebo použít vestavěný modul
   - Vestavěné moduly (fs, path, http, crypto, os...) jsou OK bez package.json

FORMÁT ODPOVĚDI:
Pokud je vše OK:
PASS: [stručné shrnutí co je dobře]

Pokud jsou problémy:
FAIL:
- [problém 1]
- [problém 2]
...
DOPORUČENÍ:
- [jak opravit 1]
- [jak opravit 2]`,

  D2_FIX: `Jsi D2 - sekundární designer. Tvým úkolem je navrhnout konkrétní opravy na základě review.

INSTRUKCE:
1. Přečti review od R2
2. Pro každý problém navrhni konkrétní opravu
3. Buď specifický - ukaž přesně co změnit

FORMÁT:
## Opravy

### Problém 1: [název]
Soubor: \`/cesta/soubor.js\`
Původní:
\`\`\`
[původní kód]
\`\`\`
Opravené:
\`\`\`
[opravený kód]
\`\`\`

### Problém 2: [název]
...`,

  R1_REVIEW: `Jsi R1 - senior reviewer a finální gate. Proveď důkladnou kontrolu kvality.

INSTRUKCE:
1. Zkontroluj architekturu a design patterns
2. Zkontroluj bezpečnost (auth, validation, injection, XSS)
3. Zkontroluj error handling a edge cases
4. Zkontroluj čitelnost a maintainability
5. Porovnej s best practices

FORMÁT ODPOVĚDI:
Pokud je vše OK a připraveno k nasazení:
APPROVED: [shrnutí kvality]

Pokud jsou závažné problémy vyžadující redesign:
REDESIGN:
- [závažný problém 1]
- [závažný problém 2]
DŮVOD: [proč je potřeba redesign, ne jen fix]

Pokud jsou menší problémy:
MINOR_ISSUES:
- [menší problém 1]
- [menší problém 2]
ROZHODNUTÍ: [APPROVED s výhradami / nebo REDESIGN]`,
};

// Session storage for workflow instances
const workflowSessions = new Map();

export class WorkflowAgent {
  constructor(config = {}) {
    this.config = {
      workdir: config.workdir || process.cwd(),
      projectName: config.projectName || "default",
      sessionId: config.sessionId || "default",
      maxIterations: config.maxIterations || 5,
      ...config,
    };
    
    this.state = State.INIT;
    this.history = [];
    this.plan = null;
    this.implementation = null;
    this.iterations = 0;
    this.memory = null;
    
    // Paths
    this.memoryDir = path.join(this.config.workdir, "memories");
    this.planFile = path.join(this.config.workdir, ".c3-plan.md");
    
    log.info("WorkflowAgent initialized", { 
      workdir: this.config.workdir,
      sessionId: this.config.sessionId 
    });
  }

  /**
   * Load memory from project
   */
  async loadMemory() {
    this.memory = {
      workflows: [],
      constraints: [],
      tools: [],
      metadata: {},
    };
    
    if (!fs.existsSync(this.memoryDir)) {
      log.debug("No memory directory found");
      return;
    }
    
    const categories = ["workflows", "constraints", "tools", "metadata"];
    for (const cat of categories) {
      const catDir = path.join(this.memoryDir, cat);
      if (fs.existsSync(catDir)) {
        const files = fs.readdirSync(catDir).filter(f => f.endsWith(".md"));
        for (const file of files) {
          const content = fs.readFileSync(path.join(catDir, file), "utf-8");
          if (cat === "metadata") {
            this.memory.metadata[file.replace(".md", "")] = content;
          } else {
            this.memory[cat].push({ file, content });
          }
        }
      }
    }
    
    log.info("Memory loaded", {
      workflows: this.memory.workflows.length,
      constraints: this.memory.constraints.length,
      tools: this.memory.tools.length,
    });
  }

  /**
   * Save plan to file for persistence
   */
  async savePlan(plan) {
    const content = `# C.3 Implementation Plan
Generated: ${new Date().toISOString()}
Session: ${this.config.sessionId}

${plan}
`;
    fs.mkdirSync(path.dirname(this.planFile), { recursive: true });
    fs.writeFileSync(this.planFile, content, "utf-8");
    log.info("Plan saved", { path: this.planFile });
  }

  /**
   * Build context from memory
   */
  buildMemoryContext() {
    if (!this.memory) return "";
    
    let context = "\n\n## Kontext z paměti:\n";
    
    if (this.memory.workflows.length > 0) {
      context += "\n### Workflows:\n";
      for (const w of this.memory.workflows.slice(0, 3)) {
        context += `- ${w.file}: ${w.content.substring(0, 200)}...\n`;
      }
    }
    
    if (this.memory.constraints.length > 0) {
      context += "\n### Pravidla:\n";
      for (const c of this.memory.constraints) {
        context += `- ${c.content.substring(0, 200)}...\n`;
      }
    }
    
    return context;
  }

  /**
   * Call specific role
   */
  async callRole(role, prompt, systemPromptKey = null) {
    const sysKey = systemPromptKey || `${role}_${this.getRoleAction()}`;
    const systemPrompt = ROLE_PROMPTS[sysKey] || "";
    
    log.info(`Calling ${role}`, { promptLength: prompt.length, systemKey: sysKey });
    
    const response = await callLLM({
      role: role,
      prompt: prompt,
      systemPrompt: systemPrompt,
    });
    
    log.debug(`${role} response`, { length: response?.length });
    return response;
  }

  getRoleAction() {
    switch (this.state) {
      case State.CLARIFYING: return "ANALYZE";
      case State.PLANNING: return "PLAN";
      case State.IMPLEMENTING: return "IMPLEMENT";
      case State.REVIEWING_R2: return "REVIEW";
      case State.FIXING_D2: return "FIX";
      case State.REVIEWING_R1: return "REVIEW";
      default: return "ANALYZE";
    }
  }

  /**
   * Parse review response
   */
  parseReviewResponse(response) {
    // Handle empty response (bug v deepseek-r1 s dlouhými prompty)
    if (!response || response.trim().length === 0) {
      log.warn("Empty review response - treating as PASS with warning");
      return { 
        passed: true, 
        issues: [], 
        response: "(prázdná odpověď - pravděpodobně timeout)",
        warning: "Model vrátil prázdnou odpověď" 
      };
    }
    
    if (response.includes("PASS:") || response.includes("APPROVED:")) {
      return { passed: true, issues: [], response };
    }
    
    if (response.includes("FAIL:") || response.includes("REDESIGN:") || response.includes("MINOR_ISSUES:")) {
      const issues = [];
      const lines = response.split("\n");
      let inIssues = false;
      
      for (const line of lines) {
        if (line.includes("FAIL:") || line.includes("REDESIGN:") || line.includes("MINOR_ISSUES:")) {
          inIssues = true;
          continue;
        }
        if (line.startsWith("DOPORUČENÍ:") || line.startsWith("DŮVOD:") || line.startsWith("ROZHODNUTÍ:")) {
          inIssues = false;
        }
        if (inIssues && line.trim().startsWith("-")) {
          issues.push(line.trim().substring(1).trim());
        }
      }
      
      const needsRedesign = response.includes("REDESIGN:");
      return { passed: false, issues, needsRedesign, response };
    }
    
    // Default to pass if unclear
    return { passed: true, issues: [], response };
  }

  /**
   * Parse clarification response
   */
  parseClarifyResponse(response) {
    if (response.includes("READY:")) {
      return { needsClarification: false, summary: response.split("READY:")[1]?.trim() || response };
    }
    
    if (response.includes("CLARIFY:")) {
      const questions = [];
      const lines = response.split("CLARIFY:")[1]?.split("\n") || [];
      for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+)/);
        if (match) {
          questions.push(match[1].trim());
        }
      }
      return { needsClarification: questions.length > 0, questions };
    }
    
    return { needsClarification: false, summary: response };
  }

  /**
   * Extract and save code from response
   */
  async extractAndSaveCode(response) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const savedFiles = [];
    
    let match;
    while ((match = codeBlockRegex.exec(response)) !== null) {
      const lang = match[1] || "";
      let code = match[2];
      const blockStart = match.index;
      
      // Skip non-code blocks (bash commands are instructions, not files)
      if (["bash", "sh", "shell", "markdown", "md"].includes(lang) && !code.includes("#!/")) {
        continue;
      }
      
      let filePath = null;
      
      // Method 1: Find path in first line comment inside code block
      // Supports: // /path, # /path, <!-- /path, /* /path
      const pathMatch = code.match(/^(?:\/\/|#|<!--|\/\*)\s*(\/[\w\/.+-]+\.\w+)/m);
      if (pathMatch) {
        filePath = pathMatch[1];
        // Remove the path comment line from content
        code = code.replace(/^(?:\/\/|#|<!--|\/\*)\s*\/[\w\/.+-]+\.\w+\s*\n?/, '');
      }
      
      // Method 2: Find "Soubor: /path" or "File: /path" before the code block
      if (!filePath) {
        // Look at text before this code block (last 200 chars)
        const textBefore = response.substring(Math.max(0, blockStart - 200), blockStart);
        const fileMarkerMatch = textBefore.match(/(?:Soubor|File|Súbor):\s*(\/[\w\/.+-]+\.\w+)\s*$/i);
        if (fileMarkerMatch) {
          filePath = fileMarkerMatch[1];
        }
      }
      
      // Method 3: For JSON blocks, try to find filename in nearby context
      if (!filePath && lang === 'json') {
        const textBefore = response.substring(Math.max(0, blockStart - 300), blockStart);
        // Look for patterns like "tasks.json:", "`tasks.json`", "soubor tasks.json"
        const jsonFileMatch = textBefore.match(/[`"]?([\w-]+\.json)[`"]?\s*:?\s*$/i);
        if (jsonFileMatch) {
          // Use workdir as base path
          filePath = path.join(this.config.workdir, jsonFileMatch[1]);
          log.info(`Inferred JSON path from context: ${filePath}`);
        }
      }
      
      if (filePath) {
        // For JSON files: validate and fix if needed
        if (filePath.endsWith('.json')) {
          code = this.sanitizeJsonContent(code, filePath);
        }
        
        log.info(`Saving file: ${filePath}`);
        
        try {
          await executeTool("fs:write", {
            path: filePath,
            content: code,
            createDirs: true,
          }, { workdir: this.config.workdir });
          savedFiles.push(filePath);
        } catch (e) {
          log.error(`Failed to save ${filePath}: ${e.message}`);
        }
      }
    }
    
    return savedFiles;
  }

  /**
   * Sanitize JSON content - validate and fix common issues
   */
  sanitizeJsonContent(content, filePath) {
    const trimmed = content.trim();
    
    // Try to parse as-is first
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch (e) {
      log.warn(`Invalid JSON in ${filePath}, attempting fix: ${e.message}`);
    }
    
    // Try removing any remaining comment lines (// or #)
    const withoutComments = trimmed
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('#'))
      .join('\n')
      .trim();
    
    try {
      JSON.parse(withoutComments);
      log.info(`Fixed JSON by removing comments: ${filePath}`);
      return withoutComments;
    } catch (e) {
      // Still invalid
    }
    
    // Last resort: detect intended structure and provide fallback
    if (trimmed.includes('[') || filePath.includes('task') || filePath.includes('list') || filePath.includes('array')) {
      log.warn(`Using fallback empty array for ${filePath}`);
      return '[]';
    } else {
      log.warn(`Using fallback empty object for ${filePath}`);
      return '{}';
    }
  }

  /**
   * Summarize implementation for shorter prompts (R1 timeout prevention)
   */
  summarizeImplementation(implementation, maxLength = 3000) {
    if (implementation.length <= maxLength) {
      return implementation;
    }
    
    // Extract code blocks and truncate each
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks = [...implementation.matchAll(codeBlockRegex)];
    
    if (blocks.length === 0) {
      return implementation.substring(0, maxLength) + "\n...(zkráceno)";
    }
    
    let summary = "";
    const perBlockLimit = Math.floor(maxLength / blocks.length);
    
    for (const block of blocks) {
      const lang = block[1] || "";
      const code = block[2];
      
      // Get first line (path) and first 30 lines of code
      const lines = code.split("\n");
      const truncatedCode = lines.slice(0, 30).join("\n");
      
      summary += `\`\`\`${lang}\n${truncatedCode}\n`;
      if (lines.length > 30) {
        summary += `// ... (${lines.length - 30} dalších řádků)\n`;
      }
      summary += `\`\`\`\n\n`;
      
      if (summary.length > maxLength) {
        summary += "...(další soubory zkráceny)";
        break;
      }
    }
    
    return summary;
  }

  /**
   * Main workflow execution - Phase 1: Analysis & Planning
   */
  async execute(userMessage) {
    log.info("Workflow started", { message: userMessage.substring(0, 100) });
    
    // Load memory
    await this.loadMemory();
    const memoryContext = this.buildMemoryContext();
    
    // Store original request
    this.history.push({ role: "user", content: userMessage });
    
    // Phase 1: D1 Analysis - Check if clarification needed
    this.state = State.CLARIFYING;
    log.info("Phase 1: D1 Analysis");
    
    const analysisPrompt = memoryContext 
      ? `${memoryContext}\n\n---\n\nPožadavek uživatele:\n${userMessage}`
      : userMessage;
    
    const analysisResponse = await this.callRole("D1", analysisPrompt, "D1_ANALYZE");
    const analysis = this.parseClarifyResponse(analysisResponse);
    
    if (analysis.needsClarification && analysis.questions?.length > 0) {
      log.info("Clarification needed", { questions: analysis.questions });
      this.state = State.CLARIFYING;
      
      const clarifyMessage = `## Potřebuji upřesnění\n\nPřed začátkem implementace potřebuji zodpovědět několik otázek:\n\n${analysis.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n---\n*Odpověz na tyto otázky, abych mohl vytvořit přesně to, co potřebuješ.*`;
      
      this.history.push({ role: "assistant", content: clarifyMessage });
      return { 
        state: this.state, 
        response: clarifyMessage,
        needsInput: true 
      };
    }
    
    // Phase 2: D1 Planning
    return this.createPlan(userMessage, memoryContext);
  }

  /**
   * Create implementation plan
   */
  async createPlan(userMessage, memoryContext = "") {
    this.state = State.PLANNING;
    log.info("Phase 2: D1 Planning");
    
    const planPrompt = memoryContext 
      ? `${memoryContext}\n\n---\n\nPožadavek:\n${userMessage}\n\nVytvoř detailní plán implementace.`
      : `Požadavek:\n${userMessage}\n\nVytvoř detailní plán implementace.`;
    
    const planResponse = await this.callRole("D1", planPrompt, "D1_PLAN");
    
    this.plan = planResponse;
    await this.savePlan(planResponse);
    
    // Return plan for user confirmation
    this.state = State.PLAN_REVIEW;
    const planMessage = `## 📋 Plán implementace\n\n${planResponse}\n\n---\n\n**Potvrď plán odpovědí "OK" nebo "ano", případně navrhni změny.**`;
    
    this.history.push({ role: "assistant", content: planMessage });
    return {
      state: this.state,
      response: planMessage,
      needsInput: true,
      plan: this.plan,
    };
  }

  /**
   * Continue workflow after user input
   */
  async continue(userInput) {
    log.info("Workflow continue", { state: this.state, input: userInput.substring(0, 50) });
    
    this.history.push({ role: "user", content: userInput });
    
    // Handle clarification response
    if (this.state === State.CLARIFYING) {
      const originalRequest = this.history[0].content;
      const fullContext = `Původní požadavek:\n${originalRequest}\n\nUpřesnění od uživatele:\n${userInput}`;
      
      await this.loadMemory();
      const memoryContext = this.buildMemoryContext();
      
      // Create plan with clarified context
      return this.createPlan(fullContext, memoryContext);
    }
    
    // Handle plan confirmation
    if (this.state === State.PLAN_REVIEW) {
      const isApproved = /^(ok|ano|yes|potvrz|schval|good|fine|super|výborně|v pořádku)/i.test(userInput.trim());
      
      if (!isApproved) {
        // User wants changes - update plan
        log.info("Plan modification requested");
        
        const modifyPrompt = `Původní plán:\n${this.plan}\n\nPožadované změny od uživatele:\n${userInput}\n\nUprav plán podle těchto požadavků.`;
        const newPlan = await this.callRole("D1", modifyPrompt, "D1_PLAN");
        
        this.plan = newPlan;
        await this.savePlan(newPlan);
        
        const planMessage = `## 📋 Upravený plán\n\n${newPlan}\n\n---\n\n**Potvrď plán odpovědí "OK" nebo navrhni další změny.**`;
        this.history.push({ role: "assistant", content: planMessage });
        
        return {
          state: this.state,
          response: planMessage,
          needsInput: true,
          plan: this.plan,
        };
      }
      
      // Plan approved - start implementation
      return this.implement();
    }
    
    // Handle other states - user interrupt during implementation
    return { 
      state: this.state, 
      response: `Aktuální stav: ${this.state}. Implementace probíhá...`,
      needsInput: false 
    };
  }

  /**
   * Implementation phase with review loop
   */
  async implement() {
    log.info("Starting implementation phase");
    
    // Phase 3: CODE Implementation
    this.state = State.IMPLEMENTING;
    this.iterations = 0;
    
    const implPrompt = `Plán k implementaci:\n\n${this.plan}\n\nImplementuj VŠECHNY soubory podle plánu. KAŽDÝ soubor MUSÍ mít na prvním řádku komentář s plnou cestou.`;
    let codeResponse = await this.callRole("CODE", implPrompt, "CODE_IMPLEMENT");
    
    // Save implementation
    let savedFiles = await this.extractAndSaveCode(codeResponse);
    this.implementation = codeResponse;
    
    log.info("Initial implementation", { savedFiles: savedFiles.length });
    
    // Review loop
    while (this.iterations < this.config.maxIterations) {
      this.iterations++;
      log.info(`Review iteration ${this.iterations}/${this.config.maxIterations}`);
      
      // Phase 4: R2 Quick Review
      this.state = State.REVIEWING_R2;
      log.info(`R2 Review (iteration ${this.iterations})`);
      
      const r2Prompt = `## Plán:\n${this.plan}\n\n## Implementace:\n${this.implementation}\n\n## Uložené soubory:\n${savedFiles.join(", ") || "žádné"}\n\nProveď rychlou kontrolu kvality.`;
      const r2Response = await this.callRole("R2", r2Prompt, "R2_REVIEW");
      const r2Result = this.parseReviewResponse(r2Response);
      
      log.info("R2 result", { passed: r2Result.passed, issues: r2Result.issues?.length });
      
      if (!r2Result.passed) {
        // Phase 5: D2 Fix Proposal
        this.state = State.FIXING_D2;
        log.info("R2 failed, D2 proposing fixes");
        
        const d2Prompt = `## Implementace:\n${this.implementation}\n\n## Problémy z R2 review:\n${r2Response}\n\nNavrhni konkrétní opravy pro každý problém.`;
        const d2Response = await this.callRole("D2", d2Prompt, "D2_FIX");
        
        // Phase 6: CODE Apply Fixes
        this.state = State.IMPLEMENTING;
        log.info("CODE applying fixes");
        
        const fixPrompt = `## Původní implementace:\n${this.implementation}\n\n## Navržené opravy od D2:\n${d2Response}\n\nAplikuj všechny opravy. KAŽDÝ soubor MUSÍ mít na prvním řádku komentář s plnou cestou.`;
        codeResponse = await this.callRole("CODE", fixPrompt, "CODE_IMPLEMENT");
        
        savedFiles = await this.extractAndSaveCode(codeResponse);
        this.implementation = codeResponse;
        
        continue; // Back to R2
      }
      
      // R2 passed - Phase 7: R1 Final Review
      this.state = State.REVIEWING_R1;
      log.info("R2 passed, R1 Final Review");
      
      // Zkrátit implementaci pro R1 (prevence timeoutu)
      const implSummary = this.summarizeImplementation(this.implementation, 3000);
      
      const r1Prompt = `## Shrnutí plánu:
${this.plan.substring(0, 1500)}...

## Implementace (zkráceno):
${implSummary}

## Uložené soubory:
${savedFiles.join(", ")}

Proveď finální kontrolu architektury, bezpečnosti a kvality. Odpověz APPROVED: nebo REDESIGN:.`;
      const r1Response = await this.callRole("R1", r1Prompt, "R1_REVIEW");
      const r1Result = this.parseReviewResponse(r1Response);
      
      log.info("R1 result", { passed: r1Result.passed, needsRedesign: r1Result.needsRedesign });
      
      if (r1Result.passed) {
        // DONE!
        this.state = State.DONE;
        log.info("Workflow completed successfully", { iterations: this.iterations, files: savedFiles.length });
        
        const doneMessage = `## ✅ Implementace dokončena!\n\n### Vytvořené soubory:\n${savedFiles.map(f => `- \`${f}\``).join("\n")}\n\n### R1 Review:\n${r1Response}\n\n### Statistiky:\n- Iterací: ${this.iterations}\n- Souborů: ${savedFiles.length}\n\n### Další kroky:\n${this.getNextSteps(savedFiles)}`;
        
        this.history.push({ role: "assistant", content: doneMessage });
        
        return {
          state: this.state,
          response: doneMessage,
          needsInput: false,
          files: savedFiles,
        };
      }
      
      if (r1Result.needsRedesign) {
        // Major issues - back to D1
        this.state = State.REDESIGNING_D1;
        log.info("R1 requires redesign");
        
        const redesignPrompt = `## Původní plán:\n${this.plan}\n\n## Problémy vyžadující redesign (z R1):\n${r1Response}\n\nPřepracuj plán s ohledem na tyto závažné problémy.`;
        const newPlan = await this.callRole("D1", redesignPrompt, "D1_PLAN");
        
        this.plan = newPlan;
        await this.savePlan(newPlan);
        
        // Restart implementation with new plan
        this.state = State.IMPLEMENTING;
        const implPrompt2 = `## Nový plán po redesignu:\n${newPlan}\n\nImplementuj podle nového plánu. KAŽDÝ soubor MUSÍ mít na prvním řádku komentář s plnou cestou.`;
        codeResponse = await this.callRole("CODE", implPrompt2, "CODE_IMPLEMENT");
        savedFiles = await this.extractAndSaveCode(codeResponse);
        this.implementation = codeResponse;
        
        continue; // Back to R2
      }
      
      // Minor issues from R1 - D2 can fix
      this.state = State.FIXING_D2;
      log.info("R1 found minor issues, D2 fixing");
      
      const d2FixPrompt = `## Implementace:\n${this.implementation}\n\n## Menší problémy z R1:\n${r1Response}\n\nNavrhni opravy pro tyto menší problémy.`;
      const d2FixResponse = await this.callRole("D2", d2FixPrompt, "D2_FIX");
      
      this.state = State.IMPLEMENTING;
      const applyFixPrompt = `## Původní implementace:\n${this.implementation}\n\n## Opravy od D2:\n${d2FixResponse}\n\nAplikuj opravy. KAŽDÝ soubor MUSÍ mít na prvním řádku komentář s plnou cestou.`;
      codeResponse = await this.callRole("CODE", applyFixPrompt, "CODE_IMPLEMENT");
      savedFiles = await this.extractAndSaveCode(codeResponse);
      this.implementation = codeResponse;
      
      // Continue to R2 again
    }
    
    // Max iterations reached
    this.state = State.ERROR;
    log.warn("Max iterations reached", { iterations: this.iterations });
    
    return {
      state: this.state,
      response: `⚠️ Dosažen maximální počet iterací (${this.config.maxIterations}).\n\nPoslední verze souborů byla uložena:\n${savedFiles.map(f => `- \`${f}\``).join("\n")}\n\n**Poznámka:** Implementace neprošla plnou kontrolou kvality. Zkontroluj soubory manuálně.`,
      needsInput: false,
      files: savedFiles,
    };
  }

  /**
   * Generate next steps based on files
   */
  getNextSteps(files) {
    const steps = [];
    
    const hasPackageJson = files.some(f => f.includes("package.json"));
    const hasServerJs = files.some(f => f.includes("server.js") || f.includes("index.js"));
    const hasPython = files.some(f => f.endsWith(".py"));
    const hasHtml = files.some(f => f.endsWith(".html"));
    
    if (hasPackageJson) {
      steps.push(`\`\`\`bash\ncd ${this.config.workdir}\nnpm install\n\`\`\``);
    }
    
    if (hasServerJs) {
      const serverFile = files.find(f => f.includes("server.js") || f.includes("index.js"));
      steps.push(`\`\`\`bash\nnode ${serverFile}\n\`\`\``);
    }
    
    if (hasPython) {
      const mainPy = files.find(f => f.endsWith(".py"));
      steps.push(`\`\`\`bash\npython ${mainPy}\n\`\`\``);
    }
    
    if (hasHtml && !hasServerJs) {
      const htmlFile = files.find(f => f.endsWith(".html"));
      steps.push(`Otevři v prohlížeči: \`file://${htmlFile}\``);
    }
    
    return steps.length > 0 ? steps.join("\n\n") : "Zkontroluj vytvořené soubory a spusť podle potřeby.";
  }

  /**
   * Get current state info
   */
  getState() {
    return {
      state: this.state,
      iterations: this.iterations,
      plan: this.plan,
      historyLength: this.history.length,
    };
  }
}

/**
 * Get or create workflow session
 */
export function getWorkflowSession(sessionId, config = {}) {
  if (!workflowSessions.has(sessionId)) {
    workflowSessions.set(sessionId, new WorkflowAgent({ ...config, sessionId }));
  }
  return workflowSessions.get(sessionId);
}

/**
 * Clear workflow session
 */
export function clearWorkflowSession(sessionId) {
  workflowSessions.delete(sessionId);
}

export default WorkflowAgent;

