# C.3 Agent v30 - Architect Mode

## 🎯 Release Summary

Architect Mode (Mode B) - konverzační, iterativní vývoj pro komplexní projekty.
Na rozdíl od lineárního pipeline (Mode A), Architect Mode pracuje v cyklech s důrazem na:
- Definice před kódem
- Uživatel řídí, AI navrhuje
- Deterministické rozhodování
- Izolované LLM role

---

## ✨ New Features

### Architect Mode Core (`src/architect/`)

#### State Management (`state.js`)
- `state.json` management (mode, confidence, current block, scopeLock, blocker, stats)
- Confidence gate (0.7 threshold pro code generation)
- Scope lock - zabraňuje náhodnému přeskakování mezi bloky
- Blocker tracking s attempts a next steps

#### Roadmap Management (`roadmap.js`)
- `roadmap/main.md` s checkboxy a timestampy
- Block/subblock hierarchie
- Definice v `roadmap/{block-path}/{name}.md`
- Stats calculation (total, done, wip, blocked)

#### Context Loading (`context.js`)
- Base context: spec.md + state summary + roadmap
- Current block definition loading
- History a decisions loading pro kontext po pauzách

#### Conversation Orchestrator (`orchestrator.js`)
- **DETERMINISTICKÝ router** - žádné LLM rozhodování
- Intent detection pomocí regex patterns (ne LLM!)
- Gate checks: `checkCodeGate()`, `checkSwitchGate()`, `checkCompleteGate()`
- Routing na handlery podle intentu

#### Action Executor (`actions.js`)
- `CODER`: Generování nových souborů (nižší riziko)
- `EDITOR`: Modifikace existujících souborů (vyšší riziko)
- `UPDATE`: Update .md definic
- `COMPLETE`: Kompletní sekvence (roadmap + state + replay + decisions + git commit)
- Safepoint a rollback

#### Git Integration (`git.js`)
- Conventional commits: `feat(scope): detail - complete`
- WIP commits pro safepoints
- Tagging: `v{version}-{scope}`
- Block-specific commit logs
- **WIP Safepoint tracking** pro hardening

#### History Management (`history.js`)
- Replay dokumenty v `history/{block-path}/`
- `decisions.md` s decided/rejected/open/notes
- Session markers
- Pruning (keep last 10)

### LLM Modules (Separated Responsibilities)

#### ArchitectLLM (`llm.js`) - ADVISOR Role
- `converse()` - konverzace s uživatelem
- `suggestConfidence()` - NAVRHNE confidence (Orchestrator aplikuje)
- `proposeDefinition()` - návrh definice bloku
- `extractDecisions()` - extrakce rozhodnutí z konverzace
- `createSessionSummary()` - shrnutí session
- ❌ Žádné rozhodování, žádné generování kódu

#### CoderLLM (`coder.js`) - Isolated Code Generator
- `generate(definition)` → files
- Immutable inputs (JSON.parse/stringify)
- Žádná konverzace, žádná historie
- Model: qwen2.5-coder:32b

#### ReviewerLLM (`reviewer.js`) - Isolated Reviewer
- `review(definition, files)` → verdict + issues + confidenceImpact
- `quickCheck(files)` - rychlá validace bez LLM
- Verdicts: PASS, WARN, FAIL
- `confidenceImpact`: -0.2 až 0.1 (Orchestrator aplikuje)
- Model: qwen2.5:32b (adversarial - jiný než Coder)

### Hardening

1. **Reviewer confidenceImpact** - strukturovaný výstup, Orchestrator aplikuje
2. **Immutable inputs pro CoderLLM** - `JSON.parse(JSON.stringify())` před voláním
3. **WIP Guard** - hard assert před code generation: `git.hasWIPSafepoint()`

### Scripts (`src/architect/scripts/`)
- `init-architect.sh` - inicializace projektu
- `create-block.sh` - vytvoření bloku/subbloku
- `complete-block.sh` - dokončení bloku
- `project-status.sh` - zobrazení stavu

### API Endpoints
- `POST /architect/init` - inicializace projektu
- `POST /architect/message` - zpracování zprávy
- `GET /architect/status/:projectRoot` - stav projektu
- `POST /architect/action` - provedení akce

---

## 🏗️ Architecture Principles

```
ORCHESTRATOR = DETERMINISTICKÝ ROUTER + JUDGE
- Rozhoduje na základě gates a pravidel
- Žádné LLM rozhodování

ArchitectLLM = ADVISOR
- Radí, navrhuje, NIKDY nerozhoduje
- Žádné generování kódu

CoderLLM = IZOLOVANÝ GENERÁTOR
- definition → files
- Žádný kontext konverzace

ReviewerLLM = IZOLOVANÝ REVIEWER  
- definition + files → verdict
- Jiný model než Coder (adversarial)
```

---

## 📁 Project Structure

```
.c3-architect/
├── spec.md              # Specifikace projektu
├── state.json           # Aktuální stav
├── roadmap/
│   ├── main.md          # Kompletní strom s checkboxy
│   └── {block-id}/      # Složky bloků
│       └── {name}.md    # Definice
└── history/
    └── {block-path}/    # Session logy
        ├── {timestamp}_session.md
        └── decisions.md
```

---

## 🔧 Configuration

### Intent Patterns (Regex, no LLM)
- `APPROVE_TO_CODE`: "ano", "generuj", "jdi do kódu"
- `QUERY_STATUS`: "stav", "status", "progress"
- `SWITCH_BLOCK`: "přejdi na", "01-nazev"
- `SET_BLOCKER`: "problém", "nefunguje", "stuck"
- `COMPLETE_BLOCK`: "hotovo", "done"

### Gates
- **Code Gate**: current block + confidence ≥ 70% + no blocker + architect mode
- **Switch Gate**: scope lock check
- **Complete Gate**: current block exists + not already done

---

## 📝 Commit Message

```
feat(architect): Add Architect Mode v30 - conversational iterative development

BREAKING CHANGE: New development mode with separated concerns

Core:
- StateManager: confidence gate, scope lock, blocker tracking
- RoadmapManager: hierarchical blocks with definitions
- ContextLoader: base + block + history context
- ConversationOrchestrator: deterministic router with gates
- ActionExecutor: CODER, EDITOR, UPDATE, COMPLETE actions
- GitManager: conventional commits, WIP safepoints
- HistoryManager: replay docs, decisions, session markers

LLM Modules (separated responsibilities):
- ArchitectLLM: ADVISOR only (converse, suggestConfidence, proposeDefinition)
- CoderLLM: isolated code generator with immutable inputs
- ReviewerLLM: isolated reviewer with confidenceImpact

Hardening:
- confidenceImpact in review verdict (Orchestrator applies)
- Immutable inputs for CoderLLM (JSON serialize)
- WIP Guard: assert safepoint before code generation

API:
- POST /architect/init
- POST /architect/message  
- GET /architect/status/:projectRoot
- POST /architect/action

Principle: LLM advises, Orchestrator decides
```

---

## 🚀 Next Steps

- [ ] UI pro Architect Mode (inspirace Open WebUI)
- [ ] Testy (gates, intent detection, WIP guard)
- [ ] EDITOR action (modify existing files)
- [ ] Multi-file rollback
