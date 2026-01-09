/**
 * C.3 Workflow Agent v27 - Hybrid Q&A Edition
 * 
 * Klíčové principy:
 * - THINKER detekuje otázky a navrhuje odpovědi
 * - ANALYZER kategorizuje: CRITICAL (ask user) / TRIVIAL (auto-answer)
 * - Learning loop: uživatel potvrzuje/opravuje → systém se učí
 * - Každá role má TVRDÝ JSON contract
 * 
 * Flow:
 * THINKER → ANALYZER → 
 *   [ASK_USER: čeká na člověka] |
 *   [AUTO_ANSWER: zobrazí předpoklady, pokračuje] |
 *   [READY: pokračuje]
 *   → D1 (plan) → DESIGN_AUDIT → User confirms
 *   → CODE → R2A → [R2B if HIGH] → [D2 fix loop]
 *   → DONE
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
  ANALYZING: "ANALYZING",           // THINKER + ANALYZER running
  ASK_USER: "ASK_USER",             // Waiting for user to answer CRITICAL questions
  AUTO_ANSWER: "AUTO_ANSWER",       // Showing auto-answered TRIVIAL questions
  PLANNING: "PLANNING",
  DESIGN_AUDITING: "DESIGN_AUDITING",
  PLAN_REVIEW: "PLAN_REVIEW",
  IMPLEMENTING: "IMPLEMENTING",
  REVIEWING_R2A: "REVIEWING_R2A",
  REVIEWING_R2B: "REVIEWING_R2B",
  FIXING_D2: "FIXING_D2",
  DONE: "DONE",
  ERROR: "ERROR",
};

// ============================================================================
// ROLE PROMPTS - STRICT JSON CONTRACTS
// ============================================================================

const ROLE_PROMPTS = {
  // ---------------------------------------------------------------------------
  // THINKER: Detektor mlhy - ŽÁDNÁ řešení, pouze identifikace nejasností
  // ---------------------------------------------------------------------------
  // THINKER: Detektor nejasností s návrhy odpovědí
  // ---------------------------------------------------------------------------
  THINKER_ANALYZE: `Jsi THINKER - detektor nejasností v požadavcích.

TVŮJ ÚKOL: 
1. Identifikovat co není 100% jasné
2. KE KAŽDÉ NEJASNOSTI navrhnout rozumnou odpověď
3. Kategorizovat jako CRITICAL nebo TRIVIAL

KATEGORIE:
- CRITICAL: Bez odpovědi NELZE pokračovat (chybí cesta, jazyk, hlavní funkce)
- TRIVIAL: Jde rozumně předpokládat (error handling, formát dat, edge cases)

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "questions": [
    {
      "text": "Jak reagovat na neexistující ID?",
      "suggested_answer": "Vypsat chybu 'Task not found' a vrátit exit code 1",
      "category": "TRIVIAL",
      "confidence": 0.8
    },
    {
      "text": "Jaký port má server používat?",
      "suggested_answer": null,
      "category": "CRITICAL", 
      "confidence": 0.0
    }
  ],
  "summary": "Požadavek je jasný, pouze detaily implementace"
}

PRAVIDLA:
- confidence: 0.0-1.0 (jak moc věříš návrhu)
- Pokud confidence >= 0.7 a TRIVIAL → může se auto-approve
- suggested_answer může být null pokud nevíš
- Pokud ŽÁDNÉ otázky → prázdné pole questions: []`,

  // ---------------------------------------------------------------------------
  // ANALYZER: Rozhodovač flow + AC generátor
  // ---------------------------------------------------------------------------
  ANALYZER_EXTRACT: `Jsi ANALYZER - rozhoduješ o dalším kroku workflow.

VSTUP: Otázky od THINKERa + původní požadavek.

TVŮJ ÚKOL:
1. Vyhodnotit otázky od THINKERa
2. Rozhodnout: ASK_USER (critical) / AUTO_ANSWER (trivial) / READY (žádné otázky)
3. Vygenerovat Acceptance Criteria

LOGIKA ROZHODOVÁNÍ:
- Pokud ŽÁDNÉ otázky → state: "READY"
- Pokud POUZE TRIVIAL s confidence >= 0.7 → state: "AUTO_ANSWER"
- Pokud ALESPOŇ 1 CRITICAL → state: "ASK_USER"

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "state": "READY" | "AUTO_ANSWER" | "ASK_USER",
  "questions_for_user": [
    {
      "text": "...",
      "suggested_answer": "...",
      "category": "CRITICAL"
    }
  ],
  "auto_answers": [
    {
      "text": "Jak reagovat na neexistující ID?",
      "answer": "Vypsat 'Task not found' a exit code 1",
      "reason": "Standardní chování CLI aplikací"
    }
  ],
  "acceptance_criteria": [
    {"id": "AC-1", "description": "...", "test_hint": "jak ověřit"}
  ],
  "risk_level": "LOW" | "MEDIUM" | "HIGH"
}

PRAVIDLA:
- Pokud state != "READY", musí být questions_for_user nebo auto_answers neprázdné
- Pokud state == "READY" nebo "AUTO_ANSWER", musí být acceptance_criteria (min 2)
- auto_answers MUSÍ mít reason proč je to bezpečný předpoklad`,

  // ---------------------------------------------------------------------------
  // D1: Plánování - strukturovaný JSON plán
  // ---------------------------------------------------------------------------
  D1_PLAN: `Jsi D1 - architekt. Vytvoř strukturovaný plán.

VSTUP: Požadavek + Acceptance Criteria

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "overview": "jednořádkový popis co vytváříme",
  "architecture": {
    "pattern": "MVC | CLI | REST API | Static | ...",
    "description": "stručný popis architektury"
  },
  "components": [
    {
      "file": "/absolutní/cesta/soubor.js",
      "purpose": "účel souboru",
      "exports": ["funkce1", "funkce2"],
      "dependencies": ["fs", "path"]
    }
  ],
  "data_flow": "jak data proudí systémem",
  "edge_cases": [
    {"case": "prázdný vstup", "handling": "jak řešíme"}
  ],
  "acceptance_criteria_mapping": {
    "AC-1": ["soubor1.js:funkce1"],
    "AC-2": ["soubor2.js:funkce2"]
  }
}

PRAVIDLA:
- Každý soubor MUSÍ mít ABSOLUTNÍ cestu
- Každé AC musí být namapováno na konkrétní kód
- Preferuj vestavěné moduly (fs, path, http) před npm
- Pokud potřebuješ npm balíčky, přidej package.json do components`,

  // ---------------------------------------------------------------------------
  // DESIGN_AUDIT: Zpochybnění plánu - konkrétní verdikt
  // ---------------------------------------------------------------------------
  DESIGN_AUDIT: `Jsi DESIGN_AUDIT - kritický reviewer.

TVŮJ ÚKOL: Najít KONKRÉTNÍ díry v plánu.

ZÁKAZY:
❌ Žádné "zvážil bych..."
❌ Žádné obecné rady
❌ Žádné vágní připomínky

KONTROLUJ:
1. Je každé AC pokryté kódem?
2. Jsou všechny edge cases z plánu řešené?
3. Chybí nějaký soubor? (např. package.json pro npm deps)
4. Jsou závislosti mezi soubory správně?
5. Je data flow konzistentní?

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "verdict": "APPROVE" | "REDESIGN",
  "critical_flaws": [
    {"flaw": "popis problému", "impact": "co se stane", "location": "kde v plánu"}
  ],
  "missing_components": ["co chybí"],
  "required_changes": ["konkrétní změna 1", "konkrétní změna 2"],
  "why_fails_if_unchanged": "co přesně selže a proč"
}

Pokud je plán OK:
{
  "verdict": "APPROVE",
  "critical_flaws": [],
  "missing_components": [],
  "required_changes": [],
  "why_fails_if_unchanged": null
}`,

  // ---------------------------------------------------------------------------
  // CODE: Implementace - sdílený prompt s D2
  // ---------------------------------------------------------------------------
  CODE_IMPLEMENT: `Jsi CODE - implementátor.

PRAVIDLA:
1. Řiď se PŘESNĚ plánem - žádné vlastní "vylepšení"
2. Každý soubor MUSÍ mít ABSOLUTNÍ cestu z plánu
3. Preferuj vestavěné moduly
4. Pokud používáš npm, MUSÍ existovat package.json

FORMÁT PRO KAŽDÝ SOUBOR:

Pro JS/TS/Python (kód s komentáři):
\`\`\`javascript
// /absolutni/cesta/soubor.js
[kód]
\`\`\`

Pro JSON (bez komentářů uvnitř!):
Soubor: /absolutni/cesta/soubor.json
\`\`\`json
{"key": "value"}
\`\`\`

ZÁKAZY:
❌ NIKDY /path/to/ nebo /cesta/k/
❌ NIKDY komentáře uvnitř JSON
❌ NIKDY měnit architekturu z plánu
❌ NIKDY přidávat funkce které nejsou v plánu`,

  // ---------------------------------------------------------------------------
  // D2: Opravy - STEJNÝ prompt jako CODE + kontext chyb
  // ---------------------------------------------------------------------------
  D2_FIX: `Jsi D2 - opravář kódu.

TVŮJ ÚKOL: Opravit POUZE nahlášené problémy.

ZÁKAZY:
❌ NEMĚŇ architekturu
❌ NEPŘIDÁVEJ nové funkce
❌ NEMĚŇ styl kódu
❌ NEOPTIMALIZUJ co není rozbité

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "modified_files": [
    {
      "path": "/absolutni/cesta/soubor.js",
      "reason": "stručný důvod opravy",
      "content": "CELÝ opravený obsah souboru"
    }
  ],
  "summary": "co bylo opraveno"
}

PRAVIDLA:
- V "content" MUSÍ být KOMPLETNÍ obsah souboru, ne jen fragment
- "path" MUSÍ být absolutní cesta ze zadání/plánu
- Oprav POUZE soubory které potřebují opravu
- Zachovej existující styl kódu`,

  // ---------------------------------------------------------------------------
  // R2A: Intent review - kontrola proti AC
  // ---------------------------------------------------------------------------
  R2A_INTENT: `Jsi R2A - kontrolor souladu s plánem a AC.

VSTUP: Plán + Acceptance Criteria + Implementace

TVŮJ ÚKOL: Zkontrolovat zda implementace splňuje VŠECHNA AC.

KONTROLNÍ SEZNAM:
1. Je KAŽDÝ soubor z plánu implementován?
2. Je KAŽDÉ AC splněno? (projdi jedno po druhém)
3. Odpovídá architektura plánu?
4. Jsou všechny dependencies v package.json (pokud existuje)?

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "verdict": "PASS" | "FAIL",
  "ac_results": [
    {"id": "AC-1", "status": "PASS" | "FAIL", "reason": "proč"},
    {"id": "AC-2", "status": "PASS" | "FAIL", "reason": "proč"}
  ],
  "missing_files": ["soubor.js"],
  "architecture_issues": ["problém"],
  "fix_required": ["co přesně opravit"]
}`,

  // ---------------------------------------------------------------------------
  // R2B: Adversarial - POUZE pro HIGH risk, BEZ řešení
  // ---------------------------------------------------------------------------
  R2B_ADVERSARIAL: `Jsi R2B - adversarial tester. Hledáš CO SE ROZBIJE.

ZÁKAZY:
❌ NEPOSKYTUJ ŘEŠENÍ
❌ NENAVRHUJ OPRAVY
❌ Pouze IDENTIFIKUJ problémy

HLEDEJ:
1. Edge cases: prázdný vstup, null, undefined, příliš velká data
2. Runtime chyby: neošetřené výjimky, chybějící error handling
3. Security: injection, path traversal, hardcoded secrets
4. Race conditions, memory leaks

POVINNÝ VÝSTUP (POUZE TENTO JSON):
{
  "verdict": "PASS" | "FAIL",
  "vulnerabilities": [
    {"type": "security|runtime|edge_case|logic", "description": "...", "location": "soubor:řádek", "severity": "LOW|MEDIUM|HIGH"}
  ],
  "crash_scenarios": [
    {"trigger": "co to způsobí", "result": "co se stane"}
  ]
}

PAMATUJ: Pouze problémy, ŽÁDNÁ řešení!`,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJsonResponse(response, fallback = null) {
  if (!response || response.trim().length === 0) {
    log.warn("Empty response, using fallback");
    return fallback;
  }
  
  // Try to extract JSON from markdown code block
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
  
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    log.warn(`Failed to parse JSON: ${e.message}`, { response: response.substring(0, 200) });
    
    // Try to find JSON object in response
    const objMatch = response.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch (e2) {
        log.error("Failed to extract JSON object");
      }
    }
    
    return fallback;
  }
}

/**
 * Format AC for display
 */
function formatAcceptanceCriteria(criteria) {
  if (!criteria || criteria.length === 0) return "Žádná AC definována";
  return criteria.map(ac => `- **${ac.id}**: ${ac.description}\n  Test: ${ac.test_hint || "N/A"}`).join("\n");
}

/**
 * Format plan for display
 */
function formatPlanForDisplay(plan) {
  if (!plan) return "Žádný plán";
  
  let output = `## Přehled\n${plan.overview || "N/A"}\n\n`;
  output += `## Architektura\n${plan.architecture?.pattern || "N/A"}: ${plan.architecture?.description || ""}\n\n`;
  
  output += `## Komponenty\n`;
  for (const comp of (plan.components || [])) {
    output += `- \`${comp.file}\` - ${comp.purpose}\n`;
  }
  
  output += `\n## Data Flow\n${plan.data_flow || "N/A"}\n\n`;
  
  if (plan.edge_cases?.length > 0) {
    output += `## Edge Cases\n`;
    for (const ec of plan.edge_cases) {
      output += `- ${ec.case}: ${ec.handling}\n`;
    }
  }
  
  return output;
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const workflowSessions = new Map();
const SESSION_TTL = 3600000;

const sessionCleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [id, session] of workflowSessions) {
    const lastActivity = session.lastActivity || session.createdAt || 0;
    if (now - lastActivity > SESSION_TTL) {
      workflowSessions.delete(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    log.info(`Session cleanup: removed ${cleaned} expired sessions`);
  }
}, 300000);

if (sessionCleanupInterval.unref) {
  sessionCleanupInterval.unref();
}

// ============================================================================
// WORKFLOW AGENT CLASS
// ============================================================================

export class WorkflowAgent {
  constructor(config = {}) {
    this.config = {
      workdir: config.workdir || process.cwd(),
      projectName: config.projectName || "default",
      sessionId: config.sessionId || "default",
      maxIterations: config.maxIterations || 5,
      maxAuditRetries: config.maxAuditRetries || 2,
      ...config,
    };
    
    this.state = State.INIT;
    this.history = [];
    this.plan = null;
    this.planJson = null;
    this.implementation = null;
    this.acceptanceCriteria = [];
    this.riskLevel = "LOW";
    this.iterations = 0;
    this.auditRetries = 0;
    this.memory = null;
    
    // v27: Hybrid Q&A
    this.pendingQuestions = [];      // Questions waiting for user
    this.autoAnswers = [];           // Auto-answered trivial questions
    this.resolvedAnswers = {};       // User-confirmed answers (question_hash → answer)
    
    // Timing tracking
    this.timings = {};
    this.workflowStartTime = null;
    
    // File paths
    this.memoryDir = path.join(this.config.workdir, "memories");
    this.planFile = path.join(this.config.workdir, ".c3-plan.json");
    this.learningFile = path.join(this.config.workdir, ".c3-learning.json");
    
    log.info("WorkflowAgent v27 initialized", { 
      workdir: this.config.workdir,
      sessionId: this.config.sessionId 
    });
  }

  /**
   * Simple hash for question deduplication
   */
  hashQuestion(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return 'q_' + Math.abs(hash).toString(16);
  }

  /**
   * Load learning data (past user choices)
   */
  loadLearning() {
    try {
      if (fs.existsSync(this.learningFile)) {
        return JSON.parse(fs.readFileSync(this.learningFile, 'utf-8'));
      }
    } catch (e) {
      log.warn("Failed to load learning data", { error: e.message });
    }
    return { patterns: {}, stats: { total: 0, trivial: 0, critical: 0 } };
  }

  /**
   * Save learning feedback
   */
  saveLearningFeedback(questionHash, data) {
    try {
      const learning = this.loadLearning();
      learning.patterns[questionHash] = {
        ...learning.patterns[questionHash],
        ...data,
        lastSeen: new Date().toISOString(),
        count: (learning.patterns[questionHash]?.count || 0) + 1,
      };
      learning.stats.total++;
      if (data.userChoice === 'TRIVIAL') learning.stats.trivial++;
      if (data.userChoice === 'CRITICAL') learning.stats.critical++;
      
      fs.writeFileSync(this.learningFile, JSON.stringify(learning, null, 2));
      log.debug("Learning feedback saved", { questionHash, choice: data.userChoice });
    } catch (e) {
      log.warn("Failed to save learning feedback", { error: e.message });
    }
  }

  /**
   * Check if we have learned pattern for question
   */
  getLearnedPattern(questionHash) {
    const learning = this.loadLearning();
    const pattern = learning.patterns[questionHash];
    if (pattern && pattern.count >= 3) {
      // Trust pattern after 3 consistent confirmations
      return pattern;
    }
    return null;
  }

  /**
   * Get current time in ms
   */
  nowMs() {
    return Date.now();
  }

  /**
   * Run role with timing
   */
  async runWithTiming(role, fn) {
    const start = this.nowMs();
    try {
      return await fn();
    } finally {
      const duration = ((this.nowMs() - start) / 1000).toFixed(1);
      
      // Accumulate if role called multiple times (e.g. D2, CODE in fix loops)
      if (this.timings[role]) {
        const prev = parseFloat(this.timings[role]);
        this.timings[role] = (prev + parseFloat(duration)).toFixed(1) + 's';
      } else {
        this.timings[role] = duration + 's';
      }
      
      log.debug(`${role} completed in ${duration}s`);
    }
  }

  /**
   * Print timing summary
   */
  printTimingSummary() {
    const totalTime = this.workflowStartTime 
      ? ((this.nowMs() - this.workflowStartTime) / 1000).toFixed(1)
      : '?';
    
    log.info("=== WORKFLOW TIMING SUMMARY ===");
    console.log("\n┌─────────────────┬──────────┐");
    console.log("│ Role            │ Time     │");
    console.log("├─────────────────┼──────────┤");
    
    for (const [role, time] of Object.entries(this.timings)) {
      const paddedRole = role.padEnd(15);
      const paddedTime = time.padStart(8);
      console.log(`│ ${paddedRole} │ ${paddedTime} │`);
    }
    
    console.log("├─────────────────┼──────────┤");
    console.log(`│ TOTAL           │ ${(totalTime + 's').padStart(8)} │`);
    console.log("└─────────────────┴──────────┘\n");
    
    return {
      timings: this.timings,
      total: totalTime + 's'
    };
  }

  /**
   * Load memory from project
   */
  async loadMemory() {
    this.memory = { workflows: [], constraints: [], tools: [], metadata: {} };
    
    if (!fs.existsSync(this.memoryDir)) return;
    
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
    });
  }

  /**
   * Save plan to file
   */
  async savePlan(planJson) {
    fs.mkdirSync(path.dirname(this.planFile), { recursive: true });
    fs.writeFileSync(this.planFile, JSON.stringify(planJson, null, 2), "utf-8");
    log.info("Plan saved", { path: this.planFile });
  }

  /**
   * Build context from memory
   */
  buildMemoryContext() {
    if (!this.memory) return "";
    
    let context = "";
    
    if (this.memory.constraints.length > 0) {
      context += "\n## Pravidla projektu:\n";
      for (const c of this.memory.constraints) {
        context += `- ${c.content.substring(0, 200)}...\n`;
      }
    }
    
    return context;
  }

  /**
   * Call specific role with timing
   */
  async callRole(role, prompt, systemPromptKey = null) {
    const sysKey = systemPromptKey || role;
    const systemPrompt = ROLE_PROMPTS[sysKey] || "";
    
    log.info(`Calling ${role}`, { promptLength: prompt.length, systemKey: sysKey });
    
    return await this.runWithTiming(role, async () => {
      const response = await callLLM({
        role: role,
        prompt: prompt,
        systemPrompt: systemPrompt,
      });
      
      log.debug(`${role} response`, { length: response?.length });
      return response;
    });
  }

  /**
   * Extract and save code from response
   */
  async extractAndSaveCode(response) {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const fileMap = new Map();
    
    let match;
    while ((match = codeBlockRegex.exec(response)) !== null) {
      const lang = match[1] || "";
      let code = match[2];
      const blockStart = match.index;
      
      if (["bash", "sh", "shell", "markdown", "md"].includes(lang) && !code.includes("#!/")) {
        continue;
      }
      
      let filePath = null;
      
      // Method 1: Path in first line comment (absolute)
      const pathMatch = code.match(/^(?:\/\/|#|<!--|\/\*)\s*(\/[\w\/.+-]+\.\w+)/m);
      if (pathMatch) {
        filePath = pathMatch[1];
        code = code.replace(/^(?:\/\/|#|<!--|\/\*)\s*\/[\w\/.+-]+\.\w+\s*\n?/, '');
      }
      
      // Method 2: "Soubor: /path" or "### Soubor: filename" before code block
      if (!filePath) {
        const textBefore = response.substring(Math.max(0, blockStart - 400), blockStart);
        // Match absolute or relative paths with optional ### prefix and optional backticks
        // Handles: "Soubor: /path", "### Soubor: `/path`", "File: `filename.js`"
        // Removed $ anchor to allow matching anywhere in text
        const fileMarkerMatch = textBefore.match(/(?:#{1,3}\s*)?(?:Soubor|File):\s*`?(\/[\w\/.+-]+\.\w+|[\w.-]+\.\w+)`?/im);
        if (fileMarkerMatch) {
          const matchedPath = fileMarkerMatch[1];
          filePath = matchedPath.startsWith('/') 
            ? matchedPath 
            : path.join(this.config.workdir, matchedPath);
          log.info(`Found file marker: ${matchedPath} → ${filePath}`);
        }
      }
      
      // Method 3: Path in first line comment (relative) - join with workdir
      if (!filePath) {
        const relPathMatch = code.match(/^(?:\/\/|#|<!--|\/\*)\s*([\w.-]+\.\w+)/m);
        if (relPathMatch && !relPathMatch[1].includes(' ')) {
          filePath = path.join(this.config.workdir, relPathMatch[1]);
          code = code.replace(/^(?:\/\/|#|<!--|\/\*)\s*[\w.-]+\.\w+\s*\n?/, '');
          log.info(`Inferred from relative comment: ${relPathMatch[1]} → ${filePath}`);
        }
      }
      
      // Method 4: Infer JSON filename from context
      if (!filePath && lang === 'json') {
        const textBefore = response.substring(Math.max(0, blockStart - 300), blockStart);
        const jsonFileMatch = textBefore.match(/[`"]?([\w-]+\.json)[`"]?\s*:?\s*$/i);
        if (jsonFileMatch) {
          filePath = path.join(this.config.workdir, jsonFileMatch[1]);
          log.info(`Inferred JSON: ${jsonFileMatch[1]} → ${filePath}`);
        }
      }
      
      // Method 5: Infer JS filename from context before code block
      if (!filePath && lang === 'javascript') {
        const textBefore = response.substring(Math.max(0, blockStart - 500), blockStart);
        const jsFileMatch = textBefore.match(/[`"]([\w-]+\.js)[`"]/i);
        if (jsFileMatch) {
          filePath = path.join(this.config.workdir, jsFileMatch[1]);
          log.info(`Inferred JS from context: ${jsFileMatch[1]} → ${filePath}`);
        }
      }
      
      if (filePath) {
        // Validate path
        const INVALID_PATTERNS = [/^\/path\/to\//i, /^\/cesta\/k\//i, /^\/your\//i, /\[path\]/i];
        
        if (INVALID_PATTERNS.some(p => p.test(filePath))) {
          const filename = path.basename(filePath);
          if (filename && filename.includes('.')) {
            filePath = path.join(this.config.workdir, filename);
            log.warn(`Recovered placeholder path → ${filePath}`);
          } else {
            continue;
          }
        }
        
        // Sanitize JSON
        if (filePath.endsWith('.json')) {
          code = this.sanitizeJson(code, filePath);
        }
        
        fileMap.set(filePath, { code, lang });
      } else {
        log.warn(`Could not determine path for code block (lang: ${lang}, length: ${code.length})`);
      }
    }
    
    // Save files
    const savedFiles = [];
    
    for (const [filePath, { code }] of fileMap) {
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
    
    return savedFiles;
  }

  /**
   * Sanitize JSON content
   */
  sanitizeJson(content, filePath) {
    const trimmed = content.trim();
    
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch (e) {
      // Remove comments
      const clean = trimmed
        .split('\n')
        .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('#'))
        .join('\n')
        .trim();
      
      try {
        JSON.parse(clean);
        return clean;
      } catch (e2) {
        log.warn(`Invalid JSON in ${filePath}, using fallback`);
        return filePath.includes('array') || filePath.includes('list') ? '[]' : '{}';
      }
    }
  }

  /**
   * Summarize implementation
   */
  summarizeImplementation(implementation, maxLength = 3000) {
    if (implementation.length <= maxLength) return implementation;
    
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks = [...implementation.matchAll(codeBlockRegex)];
    
    if (blocks.length === 0) {
      return implementation.substring(0, maxLength) + "\n...(zkráceno)";
    }
    
    let summary = "";
    
    for (const block of blocks) {
      const lang = block[1] || "";
      const code = block[2];
      const lines = code.split("\n").slice(0, 30);
      
      summary += `\`\`\`${lang}\n${lines.join("\n")}\n`;
      if (code.split("\n").length > 30) {
        summary += `// ... (zkráceno)\n`;
      }
      summary += `\`\`\`\n\n`;
      
      if (summary.length > maxLength) break;
    }
    
    return summary;
  }

  // ==========================================================================
  // MAIN WORKFLOW EXECUTION
  // ==========================================================================

  /**
   * Phase 1: THINKER → ANALYZER
   */
  async execute(userMessage) {
    log.info("Workflow v27 started", { message: userMessage.substring(0, 100) });
    
    // Start timing
    this.workflowStartTime = this.nowMs();
    this.timings = {}; // Reset timings for new workflow
    
    await this.loadMemory();
    const memoryContext = this.buildMemoryContext();
    
    this.history.push({ role: "user", content: userMessage });
    
    this.state = State.ANALYZING;
    log.info("Phase 1: THINKER → ANALYZER (Hybrid Q&A)");
    
    const fullRequest = memoryContext 
      ? `${memoryContext}\n\nPožadavek:\n${userMessage}`
      : `Požadavek:\n${userMessage}`;
    
    // THINKER - detekuje otázky s návrhy
    log.info("THINKER analyzing...");
    const thinkerResponse = await this.callRole("THINKER", fullRequest, "THINKER_ANALYZE");
    const thinkerResult = parseJsonResponse(thinkerResponse, {
      questions: [],
      summary: "Požadavek je jasný"
    });
    
    log.debug("THINKER result", { questionsCount: thinkerResult.questions?.length });
    
    // ANALYZER - rozhoduje flow
    log.info("ANALYZER deciding...");
    const analyzerPrompt = `## Požadavek:
${userMessage}

## THINKER otázky:
${JSON.stringify(thinkerResult.questions, null, 2)}

Rozhodni o dalším kroku.`;

    const analyzerResponse = await this.callRole("ANALYZER", analyzerPrompt, "ANALYZER_EXTRACT");
    const analyzerResult = parseJsonResponse(analyzerResponse, {
      state: "READY",
      questions_for_user: [],
      auto_answers: [],
      acceptance_criteria: [],
      risk_level: "LOW"
    });
    
    log.debug("ANALYZER result", { 
      state: analyzerResult.state,
      questionsForUser: analyzerResult.questions_for_user?.length,
      autoAnswers: analyzerResult.auto_answers?.length
    });
    
    // Store AC and risk level
    this.acceptanceCriteria = analyzerResult.acceptance_criteria || [];
    this.riskLevel = analyzerResult.risk_level || "LOW";
    this.autoAnswers = analyzerResult.auto_answers || [];
    this.pendingQuestions = analyzerResult.questions_for_user || [];
    
    // Apply learned patterns to pending questions
    for (const q of this.pendingQuestions) {
      const qHash = this.hashQuestion(q.text);
      const learned = this.getLearnedPattern(qHash);
      if (learned && learned.userChoice === 'TRIVIAL') {
        log.info("Applying learned pattern", { question: q.text.substring(0, 50) });
        q.learned = true;
        q.learnedAnswer = learned.answer;
      }
    }
    
    // Handle different states
    if (analyzerResult.state === "ASK_USER" && this.pendingQuestions.length > 0) {
      this.state = State.ASK_USER;
      log.info("Questions for user", { count: this.pendingQuestions.length });
      
      const askMessage = this.formatQuestionsForUser();
      this.history.push({ role: "assistant", content: askMessage });
      
      return { 
        state: this.state, 
        response: askMessage,
        needsInput: true,
        questions: this.pendingQuestions,
        autoAnswers: this.autoAnswers,
      };
    }
    
    if (analyzerResult.state === "AUTO_ANSWER" && this.autoAnswers.length > 0) {
      this.state = State.AUTO_ANSWER;
      log.info("Auto-answering trivial questions", { count: this.autoAnswers.length });
      
      const autoMessage = this.formatAutoAnswers();
      this.history.push({ role: "assistant", content: autoMessage });
      
      // Store auto answers as resolved
      for (const aa of this.autoAnswers) {
        const qHash = this.hashQuestion(aa.text);
        this.resolvedAnswers[qHash] = aa.answer;
      }
      
      return { 
        state: this.state, 
        response: autoMessage,
        needsInput: true, // User can still override
        autoAnswers: this.autoAnswers,
        acceptanceCriteria: this.acceptanceCriteria,
      };
    }
    
    // READY - no questions, proceed to planning
    if (this.acceptanceCriteria.length < 2) {
      log.warn("Insufficient AC, generating defaults");
      this.acceptanceCriteria = [
        { id: "AC-1", description: "Kód se spustí bez chyb", test_hint: "node soubor.js" },
        { id: "AC-2", description: "Funkce odpovídá požadavku", test_hint: "manuální test" }
      ];
    }
    
    log.info("Request ready, proceeding to planning", { 
      riskLevel: this.riskLevel,
      acCount: this.acceptanceCriteria.length 
    });
    
    return this.createPlan(userMessage);
  }

  /**
   * Format questions for user display (with suggested answers and buttons)
   */
  formatQuestionsForUser() {
    let msg = `## 🤔 Mám pár otázek\n\n`;
    
    for (let i = 0; i < this.pendingQuestions.length; i++) {
      const q = this.pendingQuestions[i];
      msg += `### ${i + 1}. ${q.text}\n`;
      
      if (q.suggested_answer) {
        msg += `💡 **Návrh:** ${q.suggested_answer}\n`;
      }
      
      if (q.learned) {
        msg += `🧠 *Naučeno z minulých odpovědí*\n`;
      }
      
      msg += `\n[✓ TRIVIAL - použít návrh] [⚠ CRITICAL - upravit]\n\n`;
    }
    
    if (this.autoAnswers.length > 0) {
      msg += `---\n### ✅ Automaticky zodpovězeno:\n`;
      for (const aa of this.autoAnswers) {
        msg += `- **${aa.text}** → ${aa.answer} *(${aa.reason})*\n`;
      }
    }
    
    msg += `\n---\n*Odpověz číslem otázky + tvá odpověď, nebo "OK" pro použití návrhů.*`;
    
    return msg;
  }

  /**
   * Format auto answers display
   */
  formatAutoAnswers() {
    let msg = `## ✅ Předpoklady\n\nPokračuji s těmito předpoklady:\n\n`;
    
    for (const aa of this.autoAnswers) {
      msg += `- **${aa.text}**\n`;
      msg += `  → ${aa.answer}\n`;
      msg += `  *(${aa.reason})*\n\n`;
    }
    
    if (this.acceptanceCriteria.length > 0) {
      msg += `---\n### Acceptance Criteria:\n`;
      for (const ac of this.acceptanceCriteria) {
        msg += `- **${ac.id}:** ${ac.description}\n`;
      }
    }
    
    msg += `\n---\n*[OK - pokračovat] nebo [Upravit - změnit předpoklady]*`;
    
    return msg;
  }

  /**
   * Handle user response to questions
   */
  async handleQuestionResponse(userResponse) {
    log.info("Processing question response", { response: userResponse.substring(0, 100) });
    
    const lowerResponse = userResponse.toLowerCase().trim();
    
    // "OK" = accept all suggestions
    if (lowerResponse === 'ok' || lowerResponse === 'ano' || lowerResponse === 'yes') {
      log.info("User accepted all suggestions");
      
      // Save learning feedback for all questions
      for (const q of this.pendingQuestions) {
        const qHash = this.hashQuestion(q.text);
        this.resolvedAnswers[qHash] = q.suggested_answer;
        this.saveLearningFeedback(qHash, {
          question: q.text,
          answer: q.suggested_answer,
          userChoice: 'TRIVIAL',
          usedSuggestion: true,
          context: this.config.projectName,
        });
      }
      
      for (const aa of this.autoAnswers) {
        const qHash = this.hashQuestion(aa.text);
        this.resolvedAnswers[qHash] = aa.answer;
      }
      
      // Proceed to planning
      const originalRequest = this.history.find(h => h.role === 'user')?.content || '';
      return this.createPlan(originalRequest);
    }
    
    // Parse specific answers (format: "1: moje odpověď" or "1. moje odpověď")
    const answerMatch = userResponse.match(/^(\d+)[:.]\s*(.+)$/m);
    if (answerMatch) {
      const qIndex = parseInt(answerMatch[1]) - 1;
      const userAnswer = answerMatch[2].trim();
      
      if (qIndex >= 0 && qIndex < this.pendingQuestions.length) {
        const q = this.pendingQuestions[qIndex];
        const qHash = this.hashQuestion(q.text);
        
        this.resolvedAnswers[qHash] = userAnswer;
        this.saveLearningFeedback(qHash, {
          question: q.text,
          answer: userAnswer,
          userChoice: 'CRITICAL',
          usedSuggestion: false,
          context: this.config.projectName,
        });
        
        // Remove answered question
        this.pendingQuestions.splice(qIndex, 1);
        
        log.info("Question answered", { qIndex, answer: userAnswer.substring(0, 50) });
      }
    }
    
    // Check if more questions remain
    if (this.pendingQuestions.length > 0) {
      const followupMsg = this.formatQuestionsForUser();
      return {
        state: this.state,
        response: followupMsg,
        needsInput: true,
        questions: this.pendingQuestions,
      };
    }
    
    // All answered - proceed to planning
    const originalRequest = this.history.find(h => h.role === 'user')?.content || '';
    return this.createPlan(originalRequest);
  }

  /**
   * Phase 2: D1 Planning
   */
  async createPlan(userMessage) {
    this.state = State.PLANNING;
    log.info("Phase 2: D1 Planning");
    
    const planPrompt = `## Požadavek:
${userMessage}

## Acceptance Criteria:
${JSON.stringify(this.acceptanceCriteria, null, 2)}

## Working directory:
${this.config.workdir}

Vytvoř strukturovaný plán implementace.`;

    const planResponse = await this.callRole("D1", planPrompt, "D1_PLAN");
    this.planJson = parseJsonResponse(planResponse, {
      overview: userMessage,
      architecture: { pattern: "Unknown", description: "" },
      components: [],
      data_flow: "",
      edge_cases: [],
      acceptance_criteria_mapping: {}
    });
    
    this.plan = planResponse;
    await this.savePlan(this.planJson);
    
    return this.auditPlan(userMessage);
  }

  /**
   * Phase 3: DESIGN_AUDIT
   */
  async auditPlan(userMessage) {
    this.state = State.DESIGN_AUDITING;
    log.info("Phase 3: DESIGN_AUDIT");
    
    const auditPrompt = `## Požadavek:
${userMessage}

## Acceptance Criteria:
${JSON.stringify(this.acceptanceCriteria, null, 2)}

## Plán:
${JSON.stringify(this.planJson, null, 2)}

Najdi konkrétní díry v plánu.`;

    const auditResponse = await this.callRole("DESIGN_AUDIT", auditPrompt, "DESIGN_AUDIT");
    const auditResult = parseJsonResponse(auditResponse, {
      verdict: "APPROVE",
      critical_flaws: [],
      missing_components: [],
      required_changes: [],
      why_fails_if_unchanged: null
    });
    
    log.info("DESIGN_AUDIT result", { verdict: auditResult.verdict, flaws: auditResult.critical_flaws?.length });
    
    if (auditResult.verdict === "REDESIGN" && this.auditRetries < this.config.maxAuditRetries) {
      this.auditRetries++;
      log.info(`REDESIGN required (attempt ${this.auditRetries})`);
      
      const redesignPrompt = `## Původní plán:
${JSON.stringify(this.planJson, null, 2)}

## DESIGN_AUDIT kritika:
${JSON.stringify(auditResult, null, 2)}

Přepracuj plán - adresuj VŠECHNY critical_flaws a required_changes.`;

      this.state = State.PLANNING;
      const newPlanResponse = await this.callRole("D1", redesignPrompt, "D1_PLAN");
      this.planJson = parseJsonResponse(newPlanResponse, this.planJson);
      this.plan = newPlanResponse;
      await this.savePlan(this.planJson);
      
      return this.auditPlan(userMessage);
    }
    
    // Plan approved - show to user
    this.state = State.PLAN_REVIEW;
    
    let planMessage = `## 📋 Plán implementace

${formatPlanForDisplay(this.planJson)}

## Acceptance Criteria
${formatAcceptanceCriteria(this.acceptanceCriteria)}

## Risk Level: ${this.riskLevel}
${this.riskLevel === "HIGH" ? "⚠️ Bude spuštěn adversarial review (R2B)" : ""}
`;

    if (this.auditRetries > 0) {
      planMessage += `\n*Plán prošel ${this.auditRetries}x revizí.*\n`;
    }

    planMessage += `\n---\n**Potvrď "OK" nebo navrhni změny.**`;
    
    this.history.push({ role: "assistant", content: planMessage });
    return {
      state: this.state,
      response: planMessage,
      needsInput: true,
      plan: this.planJson,
      acceptanceCriteria: this.acceptanceCriteria,
      riskLevel: this.riskLevel,
    };
  }

  /**
   * Continue workflow after user input
   */
  async continue(userInput) {
    log.info("Workflow continue", { state: this.state, input: userInput.substring(0, 50) });
    
    this.history.push({ role: "user", content: userInput });
    
    // v27: Handle question responses
    if (this.state === State.ASK_USER) {
      return this.handleQuestionResponse(userInput);
    }
    
    // v27: Handle auto-answer confirmation
    if (this.state === State.AUTO_ANSWER) {
      const isApproved = /^(ok|ano|yes|pokrač|continue|fine)/i.test(userInput.trim());
      
      if (isApproved) {
        // User accepted auto-answers - save learning feedback
        for (const aa of this.autoAnswers) {
          const qHash = this.hashQuestion(aa.text);
          this.saveLearningFeedback(qHash, {
            question: aa.text,
            answer: aa.answer,
            userChoice: 'TRIVIAL',
            usedSuggestion: true,
            context: this.config.projectName,
          });
        }
        
        const originalRequest = this.history.find(h => h.role === 'user')?.content || '';
        return this.createPlan(originalRequest);
      } else {
        // User wants to modify - parse their input
        return this.handleQuestionResponse(userInput);
      }
    }
    
    // Legacy: Handle clarification (backwards compat)
    if (this.state === State.ANALYZING) {
      const originalRequest = this.history[0].content;
      const enrichedRequest = `${originalRequest}\n\nUpřesnění:\n${userInput}`;
      return this.execute(enrichedRequest);
    }
    
    // Handle plan confirmation
    if (this.state === State.PLAN_REVIEW) {
      const isApproved = /^(ok|ano|yes|potvrz|schval|good|fine|super)/i.test(userInput.trim());
      
      if (!isApproved) {
        log.info("Plan modification requested");
        
        const modifyPrompt = `## Aktuální plán:
${JSON.stringify(this.planJson, null, 2)}

## Požadované změny:
${userInput}

Uprav plán.`;

        const newPlanResponse = await this.callRole("D1", modifyPrompt, "D1_PLAN");
        this.planJson = parseJsonResponse(newPlanResponse, this.planJson);
        this.plan = newPlanResponse;
        this.auditRetries = 0;
        await this.savePlan(this.planJson);
        
        return this.auditPlan(this.history[0].content);
      }
      
      return this.implement();
    }
    
    return { 
      state: this.state, 
      response: `Stav: ${this.state}`,
      needsInput: false 
    };
  }

  /**
   * Phase 4-7: Implementation with review
   */
  async implement() {
    log.info("Starting implementation");
    
    this.state = State.IMPLEMENTING;
    this.iterations = 0;
    
    const implPrompt = `## Plán:
${JSON.stringify(this.planJson, null, 2)}

## Working directory:
${this.config.workdir}

Implementuj VŠECHNY soubory z plánu.`;

    let codeResponse = await this.callRole("CODE", implPrompt, "CODE_IMPLEMENT");
    let savedFiles = await this.extractAndSaveCode(codeResponse);
    this.implementation = codeResponse;
    
    log.info("Initial implementation", { files: savedFiles.length });
    
    // Review loop
    while (this.iterations < this.config.maxIterations) {
      this.iterations++;
      log.info(`Review iteration ${this.iterations}`);
      
      // R2A: Intent check
      this.state = State.REVIEWING_R2A;
      
      const r2aPrompt = `## Plán:
${JSON.stringify(this.planJson, null, 2)}

## Acceptance Criteria:
${JSON.stringify(this.acceptanceCriteria, null, 2)}

## Implementace:
${this.summarizeImplementation(this.implementation)}

## Uložené soubory:
${savedFiles.join(", ")}`;

      const r2aResponse = await this.callRole("R2A", r2aPrompt, "R2A_INTENT");
      const r2aResult = parseJsonResponse(r2aResponse, { verdict: "PASS", ac_results: [], fix_required: [] });
      
      log.info("R2A result", { verdict: r2aResult.verdict });
      
      if (r2aResult.verdict === "FAIL") {
        // Fix and retry
        this.state = State.FIXING_D2;
        
        const d2Prompt = `## Plán:
${JSON.stringify(this.planJson, null, 2)}

## Aktuální implementace:
${this.implementation}

## PROBLEMS (z R2A):
${JSON.stringify(r2aResult.fix_required, null, 2)}

Oprav POUZE nahlášené problémy. Vrať JSON s opravenými soubory.`;

        const d2Response = await this.callRole("D2", d2Prompt, "D2_FIX");
        const d2Result = parseJsonResponse(d2Response, null);
        
        // Validate D2 output
        if (!d2Result || !d2Result.modified_files || d2Result.modified_files.length === 0) {
          log.error("D2 failed to return valid JSON with modified_files");
          // Fallback: try to extract code blocks
          const fallbackFiles = await this.extractAndSaveCode(d2Response);
          if (fallbackFiles.length > 0) {
            log.warn("D2 fallback: extracted files from code blocks", { files: fallbackFiles.length });
            savedFiles = [...new Set([...savedFiles, ...fallbackFiles])];
          }
        } else {
          // Save files from D2 JSON response
          log.info("D2 returned JSON", { files: d2Result.modified_files.length, summary: d2Result.summary });
          
          for (const file of d2Result.modified_files) {
            if (file.path && file.content) {
              log.info(`D2 saving file: ${file.path} (reason: ${file.reason})`);
              try {
                await executeTool("fs:write", {
                  path: file.path,
                  content: file.content,
                  createDirs: true,
                }, { workdir: this.config.workdir });
                if (!savedFiles.includes(file.path)) {
                  savedFiles.push(file.path);
                }
              } catch (e) {
                log.error(`D2 failed to save ${file.path}: ${e.message}`);
              }
            }
          }
          
          // Update implementation for next review
          this.implementation = d2Result.modified_files.map(f => 
            `### Soubor: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``
          ).join("\n\n");
        }
        
        this.state = State.IMPLEMENTING;
        continue;
      }
      
      // R2A passed - run R2B only for HIGH risk
      if (this.riskLevel === "HIGH") {
        this.state = State.REVIEWING_R2B;
        log.info("R2B Adversarial (HIGH risk)");
        
        const r2bPrompt = `## Implementace:
${this.summarizeImplementation(this.implementation)}

## Soubory:
${savedFiles.join(", ")}

Najdi co se může rozbít. ŽÁDNÁ ŘEŠENÍ!`;

        const r2bResponse = await this.callRole("R2B", r2bPrompt, "R2B_ADVERSARIAL");
        const r2bResult = parseJsonResponse(r2bResponse, { verdict: "PASS", vulnerabilities: [], crash_scenarios: [] });
        
        log.info("R2B result", { verdict: r2bResult.verdict, vulns: r2bResult.vulnerabilities?.length });
        
        if (r2bResult.verdict === "FAIL" && r2bResult.vulnerabilities?.length > 0) {
          this.state = State.FIXING_D2;
          
          const d2Prompt = `## Plán:
${JSON.stringify(this.planJson, null, 2)}

## Aktuální implementace:
${this.implementation}

## PROBLEMS (z R2B - security/edge cases):
${JSON.stringify(r2bResult.vulnerabilities, null, 2)}
${JSON.stringify(r2bResult.crash_scenarios, null, 2)}

Oprav POUZE nahlášené problémy. Vrať JSON s opravenými soubory.`;

          const d2Response = await this.callRole("D2", d2Prompt, "D2_FIX");
          const d2Result = parseJsonResponse(d2Response, null);
          
          if (!d2Result || !d2Result.modified_files || d2Result.modified_files.length === 0) {
            log.error("D2 failed to return valid JSON with modified_files (R2B)");
            const fallbackFiles = await this.extractAndSaveCode(d2Response);
            if (fallbackFiles.length > 0) {
              savedFiles = [...new Set([...savedFiles, ...fallbackFiles])];
            }
          } else {
            log.info("D2 (R2B) returned JSON", { files: d2Result.modified_files.length });
            
            for (const file of d2Result.modified_files) {
              if (file.path && file.content) {
                try {
                  await executeTool("fs:write", {
                    path: file.path,
                    content: file.content,
                    createDirs: true,
                  }, { workdir: this.config.workdir });
                  if (!savedFiles.includes(file.path)) {
                    savedFiles.push(file.path);
                  }
                } catch (e) {
                  log.error(`D2 failed to save ${file.path}: ${e.message}`);
                }
              }
            }
            
            this.implementation = d2Result.modified_files.map(f => 
              `### Soubor: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``
            ).join("\n\n");
          }
          
          this.state = State.IMPLEMENTING;
          continue; // Back to R2A
        }
      }
      
      // All passed - DONE!
      this.state = State.DONE;
      log.info("Workflow completed", { iterations: this.iterations, files: savedFiles.length });
      
      // Print timing summary
      const timingData = this.printTimingSummary();
      
      const doneMessage = `## ✅ Implementace dokončena!

### Soubory:
${savedFiles.map(f => `- \`${f}\``).join("\n")}

### Review:
- **R2A (Intent):** ✅ PASS
${this.riskLevel === "HIGH" ? "- **R2B (Adversarial):** ✅ PASS" : "- R2B: přeskočeno (risk level: " + this.riskLevel + ")"}

### Statistiky:
- Iterací: ${this.iterations}
- Souborů: ${savedFiles.length}
- Celkový čas: ${timingData.total}

### Další kroky:
${this.getNextSteps(savedFiles)}`;

      this.history.push({ role: "assistant", content: doneMessage });
      
      return {
        state: this.state,
        response: doneMessage,
        needsInput: false,
        files: savedFiles,
        timings: timingData.timings,
        totalTime: timingData.total,
      };
    }
    
    // Max iterations
    this.state = State.ERROR;
    
    // Print timing even on error
    const timingData = this.printTimingSummary();
    
    return {
      state: this.state,
      response: `⚠️ Max iterací (${this.config.maxIterations}).\n\nSoubory: ${savedFiles.join(", ")}\nČas: ${timingData.total}`,
      needsInput: false,
      files: savedFiles,
      timings: timingData.timings,
      totalTime: timingData.total,
    };
  }

  /**
   * Generate next steps
   */
  getNextSteps(files) {
    const steps = [];
    
    if (files.some(f => f.includes("package.json"))) {
      steps.push(`cd ${this.config.workdir} && npm install`);
    }
    
    const mainJs = files.find(f => f.includes("index.js") || f.includes("main.js") || f.includes("server.js"));
    if (mainJs) {
      steps.push(`node ${mainJs}`);
    }
    
    const mainPy = files.find(f => f.endsWith(".py"));
    if (mainPy) {
      steps.push(`python ${mainPy}`);
    }
    
    return steps.length > 0 
      ? steps.map(s => `\`\`\`bash\n${s}\n\`\`\``).join("\n")
      : "Zkontroluj soubory a spusť podle potřeby.";
  }

  getState() {
    const elapsedTime = this.workflowStartTime 
      ? ((this.nowMs() - this.workflowStartTime) / 1000).toFixed(1) + 's'
      : null;
    
    return {
      state: this.state,
      iterations: this.iterations,
      auditRetries: this.auditRetries,
      riskLevel: this.riskLevel,
      acCount: this.acceptanceCriteria.length,
      timings: this.timings,
      elapsedTime: elapsedTime,
      // v27: Hybrid Q&A
      pendingQuestions: this.pendingQuestions?.length || 0,
      autoAnswers: this.autoAnswers?.length || 0,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getWorkflowSession(sessionId, config = {}) {
  let session = workflowSessions.get(sessionId);
  
  if (!session) {
    session = new WorkflowAgent({ ...config, sessionId });
    session.createdAt = Date.now();
    session.lastActivity = Date.now();
    workflowSessions.set(sessionId, session);
  } else {
    session.lastActivity = Date.now();
  }
  
  return session;
}

export function clearWorkflowSession(sessionId) {
  workflowSessions.delete(sessionId);
}

export function getSessionStats() {
  return {
    activeSessions: workflowSessions.size,
    sessionIds: [...workflowSessions.keys()],
  };
}

export default WorkflowAgent;
