# Průvodce vytvářením specialistů a expertýz

> Verze: v122.2 | Poslední aktualizace: 2026-03-11

---

## 1. Dva způsoby vytvoření

### A. Chat (doporučeno pro specialisty)

Napište do chatu:
- **CZ**: „Vytvoř specialistu na překlady" / „Chci nového specialistu pro daně"
- **EN**: „Create specialist for translations" / „Add specialist for tax"

C3 aktivuje skill `create-specialist` (10 kroků):

1. **clarify** — dotazník na doménu, nástroje, schopnosti
2. **draft** — LLM vygeneruje `specialist.json` manifest
3. **review** — uživatel schválí nebo navrhne změny
4. **refine** — LLM zapracuje připomínky
5. **validate** — JSON schema kontrola (id, tools, capabilities)
6. **sanitize** — normalizace kapabilit (aliasy, dedup, řazení)
7. **save_manifest** — zápis `specialists/<name>/specialist.json`
8. **generate_code** — LLM vygeneruje `index.js` (register/unregister)
9. **save_entry** — zápis `specialists/<name>/index.js`
10. **done** — souhrn + automatický reload

Po dokončení se specialista ihned objeví v IDE (automatický refresh).

### B. IDE wizard (rychlé vytvoření)

1. Otevřete panel **Specialisté** (navigace vlevo)
2. Klikněte **+** (Nový specialista)
3. Vyplňte formulář (jméno, doména, popis, system prompt, moduly, kapability)
4. Klikněte **Vytvořit** → POST na `/api/expertises` s `is_specialist: true`
5. Specialista se ihned zobrazí v seznamu

Stejný wizard funguje i pro **Expertyzy** — jen bez příznaku `is_specialist`.

---

## 2. Manifest formát (specialist.json)

```json
{
  "manifestVersion": 2,
  "id": "translator",
  "version": "1.0.0",
  "name": "Překladatel",
  "description": "Překlad textů a lokalizace",
  "domain": "language",
  "type": "domain",
  "engine": ">=122.0.0",
  "entry": "./index.js",
  "tools": [
    { "id": "translator.translate", "name": "Překlad", "module": "./index.js", "function": "translate" }
  ],
  "capabilities": ["translation.translate", "translation.detect"],
  "expertises": ["translator"],
  "enabledByDefault": true
}
```

**Pravidla:**
- `id` — slug format: `/^[a-z][a-z0-9\-]*$/`
- `tools[].id` — prefix musí odpovídat `id` specialisty: `translator.translate`
- `capabilities` — dotted notation: `domain.action`
- `engine` — minimální verze C3 enginu

---

## 3. Implementace nástrojů (index.js)

```javascript
export async function register(ctx) {
  const { runtime, manifest } = ctx;

  // 1. Nástroje
  runtime.registerSpecialist({
    id: manifest.id,
    domain: manifest.domain,
    tools: buildToolDefinitions(),
  });

  // 2. Expertyza (volitelné — inline definice)
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(MY_EXPERTISE);
  }

  // 3. Boost patterns (auto-select)
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns(manifest.id, PATTERNS);
  }

  // 4. CRE tool types
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 5. Tool handlers
  if (ctx.registries?.toolExecutor?.register) {
    ctx.registries.toolExecutor.register('myspec.mytool', handler);
  }

  // 6. Capabilities
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
    }
  }
}

export function unregister(ctx) {
  // Každý krok v try/catch — fail-safe
  try { ctx.runtime?.unregisterSpecialist?.(ctx.manifest.id); } catch {}
  try { ctx.registries?.autoSelect?.unregisterBoostPatterns(ctx.manifest.id); } catch {}
  // ... atd.
}
```

**Plugin boundary**: NIKDY neimportujte z `../../src/`. Vše přichází přes `ctx`.

---

## 4. Správa v IDE

### Editace
- Klikněte na kartu specialisty/expertýzy → **Editovat**
- Otevře se wizard s předvyplněnými daty
- Upravte a uložte (PUT `/api/expertises/:id`)

### Mazání
- Klikněte **Smazat** na kartě
- U specialistů: automaticky se nejprve deaktivuje (POST `/api/specialists/:id/disable`), pak smaže expertyza
- Hard delete — bez obnovení

### Hromadné operace
- Klikněte **Označit** v horní liště
- Zaškrtněte karty kliknutím
- Klikněte **Smazat (N)** pro hromadné smazání
- **Zrušit** pro zrušení výběru

---

## 5. Příklady hotových specialistů

| Specialista | Doména | Nástroje | Cesta |
|-------------|--------|----------|-------|
| Účetní (accountant-cz) | finance | 12 nástrojů (DPH, fakturace, mzdy) | `specialists/accountant-cz/` |
| Překladatel (translator) | language | 2 nástroje (překlad, detekce jazyka) | `specialists/translator/` |
| Dummy Logger | utility | 1 nástroj (testovací log) | `specialists/dummy-logger/` |

---

## 6. Troubleshooting

| Problém | Řešení |
|---------|--------|
| Specialista se nezobrazí po vytvoření | Zkontrolujte `engine` v manifestu (musí být `<=` aktuální verze) |
| Chyba při registraci | Zkontrolujte `ctx.registries` — všechny jsou volitelné (`?.`) |
| Tool handler nefunguje | Ujistěte se, že ID v `toolExecutor.register()` odpovídá manifestu |
| Expertise se nezobrazí | Ověřte, že `setExpertiseRegistry()` je zavoláno v server.js před `boot()` |
