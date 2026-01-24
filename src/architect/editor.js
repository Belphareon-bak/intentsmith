// C.3 Architect Mode - Editor LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// EditorLLM = IZOLOVANÝ EDITOR KÓDU
// - Pouze: instrukce + aktuální soubory → modifikace
// - Vyšší riziko než CODER (modifikuje existující)
// - Žádný kontext konverzace
// - Voláno pouze přes Orchestrator po splnění všech gates
//
// v36.9.1: Migrated to LLMGateway with WORKFLOW_CODER auth token
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { extractJSON } from '../llm/client.js';

const EDITOR_MODEL = 'qwen2.5-coder:32b';

/**
 * EDITOR PROMPT - pro modifikaci existujících souborů
 */
const EDITOR_PROMPT = `Jsi EDITOR. Modifikuj existující soubory podle instrukcí.

## INSTRUKCE

{instructions}

## AKTUÁLNÍ SOUBORY

{currentFiles}

---

Vygeneruj modifikace. Odpověz POUZE platným JSON:

{
  "modifications": [
    {
      "path": "cesta/k/souboru.js",
      "type": "patch|replace|append|prepend",
      "search": "text k nalezení (pouze pro patch)",
      "replace": "náhradní text (pouze pro patch)", 
      "content": "nový obsah (pro replace/append/prepend)"
    }
  ],
  "summary": "shrnutí změn",
  "risks": ["potenciální rizika změn"]
}

TYPY MODIFIKACÍ:
- patch: Najdi "search" a nahraď "replace" (přesná shoda)
- replace: Nahraď celý obsah souboru
- append: Přidej na konec souboru
- prepend: Přidej na začátek souboru

PRAVIDLA:
- Používej patch pokud možno (nejbezpečnější)
- replace pouze když se mění většina souboru
- search musí být unikátní v souboru
- Zachovej styl a formátování původního kódu`;

/**
 * DIFF PROMPT - pro zobrazení náhledu změn
 */
const DIFF_PROMPT = `Porovnej PŘED a PO a vytvoř čitelný diff.

## PŘED

{before}

## PO

{after}

---

Odpověz POUZE platným JSON:

{
  "hunks": [
    {
      "location": "řádky X-Y",
      "removed": ["odebrané řádky"],
      "added": ["přidané řádky"]
    }
  ],
  "summary": "stručný popis změn"
}`;

/**
 * EditorLLM - Izolovaný editor kódu
 * 
 * Vstup: instrukce + aktuální soubory
 * Výstup: pole modifikací
 * 
 * Žádná konverzace, žádná historie, žádné rozhodování.
 * 
 * HARDENING: Všechny vstupy jsou serializované (immutable)
 */
export class EditorLLM {
  
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.backups = new Map(); // path -> original content
  }

  /**
   * Načti aktuální obsah souborů
   */
  async loadFiles(filePaths) {
    const files = [];
    
    for (const filePath of filePaths) {
      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(this.projectRoot, filePath);
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        files.push({
          path: filePath,
          content,
        });
      } catch (err) {
        logger.warn('EditorLLM', `Cannot read file: ${filePath}`, { error: err.message });
      }
    }
    
    return files;
  }

  /**
   * Vytvoř backup souborů před editací
   */
  async createBackup(filePaths) {
    this.backups.clear();
    
    for (const filePath of filePaths) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.projectRoot, filePath);
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        this.backups.set(filePath, content);
      } catch (err) {
        // Soubor neexistuje - to je OK
      }
    }
    
    logger.info('EditorLLM', `Backup created for ${this.backups.size} files`);
    return this.backups.size;
  }

  /**
   * Obnov soubory z backupu
   */
  async restoreBackup() {
    let restored = 0;
    
    for (const [filePath, content] of this.backups) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.projectRoot, filePath);
      
      try {
        await fs.writeFile(fullPath, content);
        restored++;
      } catch (err) {
        logger.error('EditorLLM', `Failed to restore: ${filePath}`, { error: err.message });
      }
    }
    
    logger.info('EditorLLM', `Restored ${restored} files from backup`);
    return restored;
  }

  /**
   * Generuj modifikace z instrukcí
   * 
   * @param {string} instructions - Co se má změnit
   * @param {string[]} filePaths - Cesty k souborům k editaci
   * @returns {Promise<{modifications: Array, summary: string, risks: string[], duration: number}>}
   */
  async generateModifications(instructions, filePaths) {
    // HARDENING: Immutable inputs
    const immutableInstructions = JSON.parse(JSON.stringify(instructions || ''));
    const immutablePaths = JSON.parse(JSON.stringify(filePaths || []));
    
    if (!immutableInstructions || immutableInstructions.trim().length < 10) {
      throw new Error('Instructions are too short or empty');
    }

    if (immutablePaths.length === 0) {
      throw new Error('No files specified for editing');
    }

    // Načti aktuální obsah souborů
    const currentFiles = await this.loadFiles(immutablePaths);
    
    if (currentFiles.length === 0) {
      throw new Error('No files could be loaded');
    }

    // Vytvoř backup
    await this.createBackup(immutablePaths);

    // Formátuj soubory pro prompt
    const filesText = currentFiles.map(f => 
      `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``
    ).join('\n\n');

    const prompt = EDITOR_PROMPT
      .replace('{instructions}', immutableInstructions)
      .replace('{currentFiles}', filesText);

    logger.info('EditorLLM', 'Generating modifications...', { 
      instructionsLength: immutableInstructions.length,
      fileCount: currentFiles.length 
    });

    try {
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_CODER,
        decisionId: `editor_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: EDITOR_MODEL,
        temperature: 0.1,
        timeout: 180000,
        format: 'json',
        maxTokens: 8000
      });

      const result = extractJSON(response.content);
      
      if (!result?.modifications || !Array.isArray(result.modifications)) {
        logger.error('EditorLLM', 'Invalid response structure', { 
          hasModifications: !!result?.modifications,
          responseLength: response.content?.length 
        });
        throw new Error('Invalid response: missing modifications array');
      }

      // Validace modifikací
      const validMods = result.modifications.filter(mod => {
        if (!mod.path || !mod.type) {
          logger.warn('EditorLLM', 'Skipping invalid modification', { path: mod.path });
          return false;
        }
        
        // Validace podle typu
        if (mod.type === 'patch' && (!mod.search || !mod.replace)) {
          logger.warn('EditorLLM', 'Patch missing search/replace', { path: mod.path });
          return false;
        }
        
        if (['replace', 'append', 'prepend'].includes(mod.type) && !mod.content) {
          logger.warn('EditorLLM', `${mod.type} missing content`, { path: mod.path });
          return false;
        }
        
        return true;
      });

      if (validMods.length === 0) {
        throw new Error('No valid modifications generated');
      }

      logger.info('EditorLLM', 'Modifications generated', { 
        modCount: validMods.length,
        duration: response.duration 
      });

      return {
        modifications: validMods,
        summary: result.summary || '',
        risks: result.risks || [],
        duration: response.duration,
        backupSize: this.backups.size,
      };

    } catch (err) {
      logger.error('EditorLLM', `Generation failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Aplikuj modifikaci na soubor (dry run)
   * Vrací nový obsah bez zápisu
   */
  applyModification(currentContent, modification) {
    switch (modification.type) {
      case 'replace':
        return modification.content;
      
      case 'patch':
        if (!currentContent.includes(modification.search)) {
          throw new Error(`Search string not found in file: "${modification.search.substring(0, 50)}..."`);
        }
        return currentContent.replace(modification.search, modification.replace);
      
      case 'append':
        return currentContent + modification.content;
      
      case 'prepend':
        return modification.content + currentContent;
      
      default:
        throw new Error(`Unknown modification type: ${modification.type}`);
    }
  }

  /**
   * Preview změn (dry run)
   */
  async previewChanges(modifications) {
    const previews = [];
    
    for (const mod of modifications) {
      const originalContent = this.backups.get(mod.path);
      
      if (!originalContent) {
        previews.push({
          path: mod.path,
          error: 'No backup found - file not loaded',
        });
        continue;
      }
      
      try {
        const newContent = this.applyModification(originalContent, mod);
        
        // Jednoduchý diff - počet řádků
        const originalLines = originalContent.split('\n').length;
        const newLines = newContent.split('\n').length;
        
        previews.push({
          path: mod.path,
          type: mod.type,
          originalLines,
          newLines,
          lineDiff: newLines - originalLines,
          preview: mod.type === 'patch' 
            ? `"${mod.search.substring(0, 30)}..." → "${mod.replace.substring(0, 30)}..."`
            : `${mod.type}: ${mod.content?.substring(0, 50)}...`,
        });
      } catch (err) {
        previews.push({
          path: mod.path,
          error: err.message,
        });
      }
    }
    
    return previews;
  }

  /**
   * Validuj že všechny modifikace jsou aplikovatelné
   */
  async validateModifications(modifications) {
    const results = [];
    
    for (const mod of modifications) {
      const originalContent = this.backups.get(mod.path);
      
      if (!originalContent) {
        results.push({ path: mod.path, valid: false, error: 'File not found in backup' });
        continue;
      }
      
      try {
        this.applyModification(originalContent, mod);
        results.push({ path: mod.path, valid: true });
      } catch (err) {
        results.push({ path: mod.path, valid: false, error: err.message });
      }
    }
    
    const allValid = results.every(r => r.valid);
    return { valid: allValid, results };
  }
}

export default EditorLLM;
