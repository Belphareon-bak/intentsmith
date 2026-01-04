# C.3 Kritická Analýza & Roadmapa

## Co máš vs Co potřebuješ

### ✅ Aktuální stav (Solid Foundation)
```
✅ Flow orchestration (single-pass, dual-deliberation)
✅ Persistent execution state
✅ Approval checkpoints
✅ SSE event streaming
✅ LLM abstraction (Ollama)
✅ Context passing between steps
```

### ❌ Kritické mezery pro tvou vizi

---

## 1. 🔴 CHYBÍ: Agentic Capabilities

### Problém
Aktuální systém je **task executor**, ne **autonomous agent**.
Agent potřebuje:

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT LOOP                               │
│                                                             │
│   Observe → Think → Plan → Act → Observe → ...              │
│                                                             │
│   Aktuálně máš jen: Plan → Execute (jednosměrné)            │
└─────────────────────────────────────────────────────────────┘
```

### Řešení: Agent Runtime

```javascript
// orchestrator/agent/agent-runtime.js

class AgentRuntime {
  constructor(config) {
    this.memory = new AgentMemory();      // Dlouhodobá paměť
    this.tools = new ToolRegistry();       // Dostupné nástroje
    this.state = new AgentState();         // Aktuální kontext
  }

  async loop() {
    while (!this.shouldStop()) {
      const observation = await this.observe();
      const thought = await this.think(observation);
      const plan = await this.plan(thought);
      const result = await this.act(plan);
      await this.learn(result);
    }
  }
}
```

---

## 2. 🔴 CHYBÍ: Tool System

### Problém
Agent nemá nástroje pro interakci se světem.

### Potřebné nástroje

```javascript
// orchestrator/tools/registry.js

const TOOLS = {
  // === FILE SYSTEM ===
  "fs:read": { ... },
  "fs:write": { ... },
  "fs:list": { ... },
  "fs:search": { ... },
  
  // === SHELL ===
  "shell:exec": { ... },
  "shell:background": { ... },
  
  // === WEB ===
  "web:fetch": { ... },
  "web:search": { ... },
  "web:scrape": { ... },
  
  // === CODE ===
  "code:analyze": { ... },
  "code:generate": { ... },
  "code:test": { ... },
  "code:lint": { ... },
  
  // === PROJECT ===
  "project:create": { ... },
  "project:build": { ... },
  "project:run": { ... },
  "project:deploy": { ... },
  
  // === DATABASE ===
  "db:query": { ... },
  "db:migrate": { ... },
  
  // === GIT ===
  "git:clone": { ... },
  "git:commit": { ... },
  "git:push": { ... },
  
  // === SYSTEM ===
  "system:info": { ... },    // CPU, RAM, GPU usage
  "system:process": { ... },
  "system:network": { ... },
};
```

---

## 3. 🔴 CHYBÍ: Memory System

### Problém
Agent nemá paměť - každá execution začíná od nuly.

### Řešení

```javascript
// orchestrator/memory/memory-store.js

class AgentMemory {
  // Krátkodobá (current session)
  shortTerm = new Map();
  
  // Dlouhodobá (persisted)
  longTerm = new VectorStore();  // Pro semantic search
  
  // Episodická (konkrétní události)
  episodes = new TimeSeriesStore();
  
  // Procedurální (naučené postupy)
  procedures = new ProcedureStore();
  
  async remember(key, value, type = 'short') { ... }
  async recall(query, type = 'all') { ... }
  async forget(key) { ... }
}
```

---

## 4. 🔴 CHYBÍ: Project Templates & Scaffolding

### Problém
Pro komplexní projekty (UI, účetní systém, web) potřebuješ šablony.

### Řešení

```
orchestrator/templates/
├── ui-electron/          # Electron + React/Vue
│   ├── scaffold.json
│   └── files/
├── ui-tauri/             # Tauri + Svelte (lightweight!)
├── web-fullstack/        # Node + React + DB
├── api-rest/             # Express/Fastify API
├── mobile-react-native/  # Mobile app
├── accounting-system/    # Specialized template
└── monitoring-system/    # Logs + Alerts
```

```javascript
// orchestrator/templates/loader.js

export async function scaffoldProject(templateName, projectPath, config) {
  const template = loadTemplate(templateName);
  
  // 1. Copy base files
  await copyTemplateFiles(template, projectPath);
  
  // 2. Apply config transformations
  await applyConfig(projectPath, config);
  
  // 3. Install dependencies
  await installDependencies(projectPath);
  
  // 4. Initialize git
  await initGit(projectPath);
  
  return { success: true, path: projectPath };
}
```

---

## 5. 🔴 CHYBÍ: Multi-Project Workspace

### Problém
Tvoje vize: až 4 projekty současně (jako MobaXterm).

### Řešení

```javascript
// orchestrator/workspace/workspace-manager.js

class WorkspaceManager {
  projects = new Map();  // projectId -> ProjectInstance
  maxConcurrent = 4;
  
  async openProject(projectId) {
    if (this.projects.size >= this.maxConcurrent) {
      throw new Error("Max concurrent projects reached");
    }
    
    const project = await Project.load(projectId);
    this.projects.set(projectId, project);
    
    emit({ type: "project_opened", projectId });
    return project;
  }
  
  async switchFocus(projectId) {
    emit({ type: "project_focus", projectId });
  }
  
  getActiveProjects() {
    return [...this.projects.values()];
  }
}
```

---

## 6. 🔴 CHYBÍ: Web Integration

### Problém
Agent nemá přístup k internetu (web search, aktuální info).

### Řešení

```javascript
// orchestrator/web/web-tools.js

export async function webSearch(query, options = {}) {
  // Use DuckDuckGo, SearXNG, or local search engine
  const results = await searchEngine.search(query, {
    maxResults: options.limit || 10,
    region: options.region || 'wt-wt'
  });
  
  return results.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet
  }));
}

export async function webFetch(url, options = {}) {
  const response = await fetch(url);
  const html = await response.text();
  
  // Extract readable content
  const readable = extractReadableContent(html);
  
  return {
    url,
    title: readable.title,
    content: readable.text,
    metadata: readable.metadata
  };
}
```

---

## 7. 🔴 CHYBÍ: Personal Context / Preferences

### Problém
Agent nezná uživatele, jeho preference, historii.

### Řešení

```javascript
// orchestrator/user/user-profile.js

const userProfile = {
  // Základní info
  name: "...",
  preferences: {
    theme: "dark",
    language: "cs",
    timezone: "Europe/Prague"
  },
  
  // Technické preference
  tech: {
    preferredLanguages: ["TypeScript", "Python"],
    preferredFrameworks: ["React", "FastAPI"],
    codingStyle: "functional",
    testingApproach: "TDD"
  },
  
  // Historie a kontext
  recentProjects: [...],
  frequentTasks: [...],
  knownPatterns: [...],
  
  // Osobní informace (encrypted)
  personalVault: {
    // Pro klíčenku, credentials, etc.
  }
};
```

---

## 8. 🟡 ČÁSTEČNĚ: Execution Capabilities

### Co chybí pro komplexní projekty

```javascript
// orchestrator/execution/project-executor.js

// Potřebuješ:
// 1. Dependency management (npm, pip, cargo, ...)
// 2. Build systems (webpack, vite, cargo build, ...)
// 3. Dev servers (vite dev, next dev, ...)
// 4. Testing frameworks (jest, pytest, ...)
// 5. Deployment (docker, kubernetes, vercel, ...)
// 6. Database management (migrations, seeds, ...)
// 7. Process management (PM2-like)
```

---

## 9. 🟡 ČÁSTEČNĚ: LLM Capabilities

### Co chybí

```javascript
// orchestrator/llm/capabilities.js

// Potřebuješ:
// 1. Streaming responses (částečně máš)
// 2. Function calling / Tool use
// 3. Multi-modal (images, audio) - pro budoucnost
// 4. Context window management (chunking, summarization)
// 5. Multiple LLM backends (Ollama, LM Studio, vLLM, ...)
// 6. Model routing (different models for different tasks)
```

---

## Prioritizovaná Roadmapa

### Phase 4: Tool System (KRITICKÉ)
```
[ ] Tool registry
[ ] fs tools
[ ] shell tools  
[ ] web tools (fetch, search)
[ ] code tools (analyze, generate)
```

### Phase 5: Project Templates
```
[ ] Template loader
[ ] UI template (Tauri + Svelte - lightweight!)
[ ] Web fullstack template
[ ] Scaffolding system
```

### Phase 6: Agent Runtime
```
[ ] Agent loop
[ ] Observation system
[ ] Planning system
[ ] Learning/feedback loop
```

### Phase 7: Memory System
```
[ ] Short-term memory
[ ] Long-term memory (vector store)
[ ] Episodic memory
[ ] Procedural memory
```

### Phase 8: Multi-Project Workspace
```
[ ] Workspace manager
[ ] Project isolation
[ ] Resource sharing
[ ] Focus switching
```

### Phase 9: Web Integration
```
[ ] Web search
[ ] Web scraping
[ ] API integration
[ ] Real-time data
```

### Phase 10: Personal Context
```
[ ] User profile
[ ] Preferences
[ ] Secure vault
[ ] Learning from interactions
```

---

## Doporučení pro první test

Pro tvůj UI test bych doporučil:

1. **Přidej základní tool system** před testem
2. **Přidej UI template** (Tauri + Svelte je super lightweight)
3. **Rozšíř decision-output schema** o detailnější execution steps

Pak teprve spusť dual-deliberation na UI design.

Chceš abych implementoval Phase 4 (Tool System) jako základ?
