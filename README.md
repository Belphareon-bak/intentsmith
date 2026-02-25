# C3 Agent

Conversational AI platform with CRE decision engine, 15 domain expertises with 5D capability profiles, project lifecycle management, resilience layer (circuit breaker, auto-retry, telemetry), and C3 Studio IDE.

**Version:** 81.0.0

## Quick Start

```bash
# Install dependencies (requires Node.js 22+, Python 3, build-essential)
npm install

# Configure (all defaults work out-of-the-box)
cp .env.example .env

# Start backend
node src/server.js
# → http://127.0.0.1:3335

# Start IDE (optional)
cd c3-ide && yarn && yarn build && yarn start
```

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 22+ (18+ minimum) | Backend runtime |
| Ollama | latest | LLM inference (`ollama pull qwen2.5:32b`) |
| Python 3 | 3.x | Native module compilation (better-sqlite3) |
| build-essential | - | C++ compiler for native modules |
| Git | 2.x+ | Lifecycle features (auto-commit, diff) |
| yarn | 1.22+ | IDE build only (optional) |

## Documentation

| Document | Description |
|----------|-------------|
| [Installation Guide](docs/INSTALL.md) | Full install instructions (Ubuntu, Fedora, Docker) |
| [Architecture](docs/ARCHITECTURE.md) | Platform architecture and design decisions |
| [Full Reference](docs/README.md) | Modules, CRE routing, test suites, project structure |
| [Expertises](docs/EXPERTISES.md) | 15 domain expertises, 5D capability profiles, merge engine |
| [Specialists](docs/SPECIALISTS.md) | Specialist plugin system (runtime, knowledge base, scenarios) |
| [Workers](docs/WORKERS.md) | Autonomous worker agents (scheduler, triggers, notifications) |
| [Roadmap](docs/ROADMAP.md) | Current roadmap and progress |
| [API Spec](docs/openapi.yaml) | OpenAPI specification |

## Tech Stack

- **Runtime:** Node.js (ESM), no framework — raw `http` module
- **Database:** SQLite (better-sqlite3, WAL mode, 58 tables, 18 migrations)
- **LLM:** Ollama (local inference, 6 model roles)
- **IDE:** C3 Studio (Theia 1.65.2 + Electron, 33 custom extensions)
- **Dependencies:** 8 production deps (zero bloat)

## Tests

```bash
npm test          # Core deterministic tests (~2100+)
npm run test:all  # Full suite including specialists
```
