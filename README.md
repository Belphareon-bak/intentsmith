# C.3 Agent

Lokální AI asistent s kontraktovanou pipeline.

```
Verze: v47.0.0
Stack: Node.js + SQLite + Ollama
```

## Quick Start

```bash
# 1. Instalace
npm install

# 2. Spusť Ollama
ollama serve

# 3. Spusť server
node src/server.js

# 4. Otevři
open http://localhost:3335/architect
```

### Požadavky

- Node.js 18+
- Ollama s modelem `qwen2.5:32b`

## Golden Path

Základní flow agenta. Spustíš → vidíš plán → vidíš exekuci.

```
User Input → Planner → Validation → Executor → Result
```

```javascript
import { runGoldenPath } from './src/golden/goldenPipeline.js';

const result = await runGoldenPath('Search for RTX 5090 prices');

console.log(result.status);     // 'SUCCESS' | 'PARTIAL' | 'ERROR'
console.log(result.plan);       // validated planner output
console.log(result.execution);  // step-by-step results
```

Viz: [docs/golden-path.md](docs/golden-path.md)

## Architektura

```
USER
  │
  ▼
ChatController ─── rozhodování
  │
  ▼
CRE ─────────────── co dělat (TOOL_CALL | ANSWER | PLAN)
  │
  ├──▶ Planner ──── jak to udělat (kroky)
  │
  └──▶ Executor ─── spuštění kroků
```

Viz: [docs/architecture-simple.md](docs/architecture-simple.md)

## Kontrakty

Data mezi vrstvami mají tvrdou definici:

| Kontrakt | Schema |
|----------|--------|
| Planner Output | `src/contracts/planner-output.schema.json` |
| Tool Call | `src/contracts/tool-call.schema.json` |
| Execution Result | `src/contracts/execution-result.schema.json` |

Validace probíhá v runtime, ne jen v testech.

## Testy

```bash
# Golden Path testy
node tests/golden-path.test.js

# Contract testy
node tests/contracts/planner-output.test.js
node tests/contracts/tool-call.test.js

# Všechny testy
npm run test
```

## Klíčové soubory

| Účel | Soubor |
|------|--------|
| Golden Path | `src/golden/goldenPipeline.js` |
| Kontrakty | `src/contracts/` |
| Rozhodování | `src/chat/cre-v2.js` |
| Exekuce | `src/tools/executor.js` |
| LLM | `src/llm/gateway.js` |

## Dokumentace

- [Golden Path](docs/golden-path.md) — referenční pipeline
- [Architecture](docs/architecture-simple.md) — architektura na jednu stránku
- [Dev Checklist](docs/dev-checklist.md) — před každým commitem

## Pokročilé funkce

> Tyto funkce NEJSOU součástí Golden Path. Použij je pouze pokud rozumíš základní architektuře.

- Expert Layer — `src/experts/`
- Agent Platform — `src/agents/`
- Autonomous Mode — `src/autonomous/`
- Memory System — `src/memory/`

Viz: [ARCHITECTURE.md](ARCHITECTURE.md) pro detailní dokumentaci.

## Troubleshooting

### Ollama neodpovídá

```bash
curl http://localhost:11434/api/tags
ollama serve
```

### Server nenastartuje

```bash
lsof -i :3335
node --check src/server.js
```

---

**Maintainer:** Belfik
**Stack:** Node.js, SQLite, Ollama
