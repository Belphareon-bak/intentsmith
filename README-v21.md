# C.3 Agent v21 - Memory Bank & Commands

## Nové funkce

### 1. Memory Bank (`/memories` v projektu)
```
memories/
├── workflows/     # Naučené postupy
├── constraints/   # Pravidla a omezení
├── tools/         # Nástroje a jejich použití
└── metadata/      # Kontext projektu
```

### 2. Commands (příkazy začínající `/`)
| Příkaz | Popis |
|--------|-------|
| `/init` | Inicializace kontextu, načte memory a TODO |
| `/todo <text>` | Přidání nového úkolu |
| `/done [id]` | Označení úkolu jako hotového |
| `/memory` | Zobrazení Memory Bank |
| `/updateMemory <cat> <name> <content>` | Přidání znalosti |
| `/plan` | Zobrazení aktuálního plánu |
| `/status` | Stav projektu |
| `/help` | Nápověda |

### 3. Přísnější clarification
D1 se nyní VŽDY ptá na detaily u vágních požadavků.

## Instalace

```bash
# 1. Rozbal do projektu
cd ~/Projects/c3-agent-wip
tar xzvf ~/Downloads/c3-v21-full.tar.gz

# 2. Nahraď server.js (z předchozího downloadu)
cp ~/Downloads/server.js orchestrator/server.js

# 3. Restartuj server
node orchestrator/server.js
```

## Workflow s best practices

```
/init                    # 1. Načti kontext
     ↓
User Request             # 2. Zadej úkol
     ↓
D1 → CLARIFY?           # 3. D1 se zeptá na detaily
     ↓
D1 → PLAN               # 4. D1 vytvoří plán
     ↓
User confirms (OK)       # 5. Uživatel potvrdí
     ↓
CODE → Implement         # 6. Implementace
     ↓
R2 → Quick Review        # 7. Rychlá kontrola
     ↓
R1 → Final Review        # 8. Finální kontrola
     ↓
DONE                     # 9. Hotovo
     ↓
/updateMemory            # 10. Ulož naučené
```

## Příklady použití

### Začátek práce
```bash
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "/init", "sessionId": "my-project", "workdir": "/home/user/project"}'
```

### Přidání úkolu
```bash
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "/todo Implementovat login", "sessionId": "my-project", "workdir": "/home/user/project"}'
```

### Uložení naučeného
```bash
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "/updateMemory workflows api-design REST API má používat JSON a správné HTTP kódy", "sessionId": "my-project", "workdir": "/home/user/project"}'
```

### Vágní požadavek (D1 se zeptá)
```bash
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "Vytvoř mi aplikaci", "sessionId": "test", "workdir": "/tmp/test"}'

# D1 odpoví:
# CLARIFY:
# 1. Kam mám aplikaci uložit (cesta)?
# 2. Jaký jazyk/framework použít?
# 3. Jaké funkce má aplikace mít?
# ...
```

## Aliasy pro shell

```bash
# Přidej do ~/.bashrc nebo ~/.zshrc

export C3_API="http://127.0.0.1:3335"

c3() {
  curl -s -X POST "$C3_API/workflow" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$1" --arg s "${2:-default}" --arg w "${3:-$PWD}" \
      '{message: $m, sessionId: $s, workdir: $w}')" | jq -r '.response // .'
}

# Použití:
# c3 "/init" my-project ~/Projects/my-app
# c3 "/todo Implementovat auth" my-project
# c3 "Vytvoř REST API pro uživatele" my-project ~/Projects/my-app
# c3 "OK" my-project  # potvrzení plánu
```

## Soubory v balíčku

| Soubor | Popis |
|--------|-------|
| `orchestrator/agent/workflow-agent.js` | Hlavní workflow engine |
| `orchestrator/agent/workflow-api.js` | HTTP API s command handling |
| `orchestrator/agent/commands.js` | Handler pro /init, /todo, /memory... |
| `orchestrator/memory/memory-bank.js` | Memory Bank manager |
| `orchestrator/memory/todo-manager.js` | TODO manager |
| `orchestrator/llm/llm-router.js` | LLM router |
| `test-workflow-auto.sh` | Automatický test workflow |
| `test-commands.sh` | Test commands |

## Testování

```bash
# Test workflow (TODO CLI app)
./test-workflow-auto.sh

# Test commands
./test-commands.sh
```

## Struktura projektu po /init

```
my-project/
├── memories/
│   ├── workflows/
│   │   └── api-design.md
│   ├── constraints/
│   │   └── no-hardcoded-secrets.md
│   ├── tools/
│   └── metadata/
├── TODO.md
├── .c3-plan.md          # Aktuální plán
└── ... (project files)
```

## Principy Memory Bank

✅ **Ukládej:**
- Meta-znalosti (vzory, principy)
- Obecně použitelné postupy
- Pravidla a konvence

❌ **Neukládej:**
- Konkrétní detaily projektu
- Implementační specifika
- Logy a statistiky

**Test:** "Použil bych to v jiném projektu?" → Pokud ano, ulož.
