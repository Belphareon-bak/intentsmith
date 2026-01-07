# C.3 Agent - Changelog v23

**Datum:** 2025-01-07
**Typ:** Bugfix release

---

## 🐛 Opravený bug: JSON soubory s komentáři

### Problém
Test `test-workflow-auto.sh` generoval nefunkční `tasks.json`:
```
SyntaxError: Unexpected token '/', "// /tmp/wo"... is not valid JSON
```

### Root Cause
1. CODE prompt instruoval model: "KAŽDÝ soubor MUSÍ mít komentář s cestou"
2. Model vygeneroval: `// /tmp/workflow-auto/tasks.json\n[]`
3. Parser uložil celý obsah včetně komentáře
4. JSON nepodporuje komentáře → `JSON.parse()` selhal

### Oprava (workflow-agent.js)

#### 1. `extractAndSaveCode()` - Vylepšený parser (řádky 416-485)
- **Odstraňuje path komentář** z obsahu před uložením
- **3 metody detekce cesty:**
  1. Komentář uvnitř: `// /path/file.js`
  2. Prefix před blokem: `Soubor: /path/file.json`
  3. Inference z kontextu pro JSON soubory
- **Validace JSON** souborů před uložením

#### 2. `sanitizeJsonContent()` - Nová funkce (řádky 487-520)
- Validuje JSON obsah
- Odstraňuje případné zbylé komentáře
- Fallback na `[]` nebo `{}` pokud nelze opravit

#### 3. `CODE_IMPLEMENT` prompt - Aktualizace (řádky 104-130)
- Přidána instrukce pro JSON soubory
- Model má použít `Soubor: /path` prefix místo komentáře uvnitř
- Explicitní upozornění že JSON nepodporuje komentáře

---

## Změněné soubory

| Soubor | Změna |
|--------|-------|
| `orchestrator/agent/workflow-agent.js` | Parser, sanitizer, prompt |

---

## Testování

```bash
# Po nasazení v23 spusť test
./test-workflow-auto.sh

# Očekávaný výsledek:
# - tasks.json obsahuje validní JSON: []
# - todo.js funguje správně
# - Test proběhne bez SyntaxError
```

---

## Upgrade instrukce

```bash
# 1. Zálohuj aktuální verzi
cp orchestrator/agent/workflow-agent.js orchestrator/agent/workflow-agent.js.bak

# 2. Nahraď novým souborem
cp workflow-agent.js ~/Projects/c3-agent-wip/orchestrator/agent/

# 3. Restartuj server
pkill -f "node.*server.js"
cd ~/Projects/c3-agent-wip && node orchestrator/server.js &

# 4. Spusť test
./test-workflow-auto.sh
```

---

## Známé limitace

- Model může stále občas vygenerovat komentář v JSON
- Sanitizer to zachytí a opraví, ale loguje warning
- Pro lepší výsledky: použít model který lépe dodržuje instrukce

---

*Další plánované opravy v v24:*
- R1 empty response handling (zkrátit prompt)
- D1 CLARIFY enforcement (možná jiný model)
