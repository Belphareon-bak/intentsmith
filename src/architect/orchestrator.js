// C.3 Architect Mode - Conversation Orchestrator
// ══════════════════════════════════════════════════════════════════════════════
//
// ORCHESTRATOR = DETERMINISTICKÝ ROUTER + JUDGE
// 
// Zásady:
// - LLM radí, Orchestrator rozhoduje
// - Všechna rozhodnutí jsou tvrdá logika, ne prompty
// - Gates jsou explicitní a testovatelné
// - Coder a Reviewer jsou izolované moduly
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { StateManager } from './state.js';
import { RoadmapManager } from './roadmap.js';
import { ContextLoader } from './context.js';
import { HistoryManager } from './history.js';
import { ActionExecutor } from './actions.js';
import { GitManager } from './git.js';
import { ArchitectLLM } from './llm.js';
import { CoderLLM } from './coder.js';
import { EditorLLM } from './editor.js';
import { ReviewerLLM, Verdict } from './reviewer.js';

/**
 * Intent types - detekované DETERMINISTICKY z message patterns
 */
const Intent = {
  CONTINUE_DEFINING: 'continue_defining',
  APPROVE_TO_CODE: 'approve_to_code',
  EDIT_FILE: 'edit_file',  // NEW: Edit existing files
  SWITCH_BLOCK: 'switch_block',
  QUERY_STATUS: 'query_status',
  NEW_INPUT: 'new_input',
  SET_BLOCKER: 'set_blocker',
  CLEAR_BLOCKER: 'clear_blocker',
  ADD_BLOCK: 'add_block',
  COMPLETE_BLOCK: 'complete_block',
  UNLOCK_SCOPE: 'unlock_scope',
  UNKNOWN: 'unknown',
};

/**
 * DETERMINISTICKÉ patterns pro intent detection
 * Žádné LLM, jen regex
 */
const INTENT_PATTERNS = {
  [Intent.APPROVE_TO_CODE]: [
    /^(ok|ano|yes|jo|jasn[eě]|ud[eě]lej|go|do it|jdi do k[oó]du|m[uů][zž]e[sš]|generuj|implementuj)/i,
    /^(potvrz|schvaluj|start|za[čc]ni|coding|kód)/i,
    /^(ano,?\s*(jdi|generuj|udělej))/i,
  ],
  [Intent.EDIT_FILE]: [
    /^(uprav|edit|modifikuj|zm[eě][nň]).*(soubor|file)/i,
    /^(oprav|fix|patch).*(soubor|file|kód|code)/i,
    /^(p[řr]idej|append|prepend).*(do|to).*(soubor|file)/i,
    /^(refaktor|refactor)/i,
  ],
  [Intent.QUERY_STATUS]: [
    /^(stav|status|kde jsm|progress|jak.*(dal|eko)|co (zbývá|chybí|je hotov))/i,
    /^(ukaž|zobraz).*(stav|progress|roadmap)/i,
  ],
  [Intent.SWITCH_BLOCK]: [
    /^(p[řr]ejd|jdi na|switch|zm[eě][nň]|otev[řr]i).*(blok|sekci|\d+-)/i,
    /^(chci|pracuj).*(blok|sekci|\d+-)/i,
  ],
  [Intent.SET_BLOCKER]: [
    /^(probl[eé]m|chyba|nefunguje|zasekl|blocker|stuck)/i,
    /^(nem[uů][zž]u|nejde|nevím jak)/i,
  ],
  [Intent.CLEAR_BLOCKER]: [
    /^(vy[řr]e[sš]en|opraveno|funguje|cleared|už to jde)/i,
  ],
  [Intent.ADD_BLOCK]: [
    /^(p[řr]idej|nov[yý] blok|vytvo[řr]|add).*(blok|\d+-)/i,
  ],
  [Intent.COMPLETE_BLOCK]: [
    /^(hotovo|dokon[čc]eno|complete|done|finished)/i,
  ],
  [Intent.UNLOCK_SCOPE]: [
    /^(odemkni|unlock|uvolni).*(scope|zamek|lock)/i,
  ],
};

/**
 * Gate check results
 */
const GateResult = {
  PASS: 'pass',
  FAIL: 'fail',
  WARN: 'warn',
};

/**
 * Confidence threshold for code generation
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Conversation Orchestrator
 * 
 * DETERMINISTICKÝ router a decision maker.
 * LLM (ArchitectLLM) pouze radí a generuje text.
 * Rozhodnutí jsou vždy na základě state a pravidel.
 */
export class ConversationOrchestrator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    
    // Core managers
    this.state = new StateManager(projectRoot);
    this.roadmap = new RoadmapManager(projectRoot);
    this.context = null;
    this.history = new HistoryManager(projectRoot);
    this.actions = null;
    this.git = new GitManager(projectRoot);
    
    // LLM modules - separate responsibilities
    this.architect = new ArchitectLLM();  // ADVISOR - radí, nikdy nerozhoduje
    this.coder = new CoderLLM();          // Izolovaný generátor kódu
    this.editor = new EditorLLM(projectRoot); // Izolovaný editor kódu
    this.reviewer = new ReviewerLLM();     // Izolovaný reviewer
    
    this.initialized = false;
  }

  /**
   * Initialize the orchestrator
   */
  async init(projectName) {
    await this.state.init(projectName);
    await this.roadmap.init(projectName);
    
    this.context = new ContextLoader(this.projectRoot, this.state, this.roadmap);
    this.actions = new ActionExecutor(this.projectRoot, this.state, this.roadmap, this.history, this.git);
    
    this.initialized = true;
    logger.info('Orchestrator', 'Initialized', { project: projectName });
    
    return this.state.getSummary();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DETERMINISTICKÁ DETEKCE INTENTU
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Detect intent from user message - PURE REGEX, NO LLM
   */
  detectIntent(message) {
    const normalized = message.trim();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          logger.debug('Orchestrator', 'Intent detected', { intent, pattern: pattern.toString() });
          return intent;
        }
      }
    }

    // URL detection
    if (message.includes('http://') || message.includes('https://')) {
      return Intent.NEW_INPUT;
    }

    // Default: continue conversation
    return Intent.CONTINUE_DEFINING;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GATE CHECKS - Deterministická pravidla
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Gate: Can proceed to code generation?
   * DETERMINISTICKÁ kontrola, žádné LLM
   */
  checkCodeGate() {
    const state = this.state.state;
    const reasons = [];

    // 1. Must have current block
    if (!state.current?.path) {
      reasons.push('Není vybraný žádný blok');
      return { result: GateResult.FAIL, reasons };
    }

    // 2. Confidence must be >= threshold
    if (state.definitionConfidence < CONFIDENCE_THRESHOLD) {
      reasons.push(`Confidence ${(state.definitionConfidence * 100).toFixed(0)}% < ${CONFIDENCE_THRESHOLD * 100}%`);
      return { result: GateResult.FAIL, reasons };
    }

    // 3. No active blocker
    if (state.blocker) {
      reasons.push(`Aktivní blocker: ${state.blocker.description}`);
      return { result: GateResult.FAIL, reasons };
    }

    // 4. Must be in architect mode
    if (state.mode !== 'architect') {
      reasons.push(`Nesprávný mode: ${state.mode}`);
      return { result: GateResult.WARN, reasons };
    }

    return { result: GateResult.PASS, reasons: [] };
  }

  /**
   * Gate: Can switch block?
   */
  checkSwitchGate(targetBlock) {
    const state = this.state.state;
    const reasons = [];

    // Scope lock check
    if (state.scopeLock?.active) {
      if (!targetBlock.startsWith(state.scopeLock.path)) {
        reasons.push(`Scope zamčený na ${state.scopeLock.path}`);
        return { result: GateResult.FAIL, reasons, needsUnlock: true };
      }
    }

    return { result: GateResult.PASS, reasons: [] };
  }

  /**
   * Gate: Can complete block?
   */
  checkCompleteGate() {
    const state = this.state.state;
    const reasons = [];

    if (!state.current?.path) {
      reasons.push('Není vybraný žádný blok');
      return { result: GateResult.FAIL, reasons };
    }

    if (state.current.status === 'done') {
      reasons.push('Blok už je dokončený');
      return { result: GateResult.WARN, reasons };
    }

    return { result: GateResult.PASS, reasons: [] };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN PROCESS - Router
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Process user message
   * Deterministický routing na základě intentu
   */
  async process(message, attachments = []) {
    if (!this.initialized) {
      return {
        response: 'Orchestrator není inicializován. Zavolej init() nejdříve.',
        action: null,
      };
    }

    const intent = this.detectIntent(message);
    logger.info('Orchestrator', 'Processing', { intent, messagePreview: message.substring(0, 50) });

    // Deterministický routing
    switch (intent) {
      case Intent.APPROVE_TO_CODE:
        return await this.handleApproveToCode();
      
      case Intent.EDIT_FILE:
        return await this.handleEditFile(message);
      
      case Intent.QUERY_STATUS:
        return await this.handleQueryStatus();
      
      case Intent.SWITCH_BLOCK:
        return await this.handleSwitchBlock(message);
      
      case Intent.SET_BLOCKER:
        return await this.handleSetBlocker(message);
      
      case Intent.CLEAR_BLOCKER:
        return await this.handleClearBlocker();
      
      case Intent.ADD_BLOCK:
        return await this.handleAddBlock(message);
      
      case Intent.COMPLETE_BLOCK:
        return await this.handleCompleteBlock();
      
      case Intent.UNLOCK_SCOPE:
        return await this.handleUnlockScope();
      
      case Intent.NEW_INPUT:
      case Intent.CONTINUE_DEFINING:
      default:
        return await this.handleConversation(message, attachments);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Handle: Approve to code
   * Orchestrator ROZHODUJE na základě gates
   */
  async handleApproveToCode() {
    // 1. Check gate - DETERMINISTICKÉ
    const gate = this.checkCodeGate();
    
    if (gate.result === GateResult.FAIL) {
      return {
        response: `❌ Nemůžu jít do kódu:\n${gate.reasons.map(r => `- ${r}`).join('\n')}\n\nCo potřebuješ doplnit?`,
        action: null,
        gateResult: gate,
      };
    }

    const currentPath = this.state.state.current.path;

    // 2. Create safepoint BEFORE coding
    await this.actions.createSafepoint(currentPath);
    
    // HARDENING: Assert WIP safepoint exists before any code generation
    if (!this.git.hasWIPSafepoint()) {
      logger.error('Orchestrator', 'WIP GUARD FAILED: No safepoint before code generation');
      return {
        response: `❌ Interní chyba: WIP safepoint nebyl vytvořen. Toto by se nemělo stát.`,
        action: null,
        error: 'WIP_GUARD_FAILED',
      };
    }
    
    // 3. Switch mode
    await this.state.setMode('coder');

    try {
      // 4. Load definition - IMMUTABLE copy will be made in CoderLLM
      const definition = await this.roadmap.loadDefinition(currentPath);
      const context = await this.context.buildContext();
      
      // 5. Call ISOLATED CoderLLM (uses immutable inputs internally)
      logger.info('Orchestrator', 'Invoking CoderLLM', { path: currentPath, wipCommit: this.git.getWIPCommit() });
      const { files, notes, duration } = await this.coder.generate(
        definition,
        context.base.spec || ''
      );

      // 6. Quick check before full review
      const quickCheck = this.reviewer.quickCheck(files);
      if (!quickCheck.passed) {
        await this.state.setMode('architect');
        return {
          response: `⚠️ Quick check failed:\n${quickCheck.issues.map(i => `- ${i.issue}`).join('\n')}\n\nChceš to zkusit znovu?`,
          action: null,
        };
      }

      // 7. Execute CODER action - write files
      const codeResult = await this.actions.coder(files);
      
      if (!codeResult.success) {
        await this.state.setMode('architect');
        return {
          response: `❌ Chyba při zápisu souborů:\n${codeResult.errors.map(e => `- ${e.path}: ${e.error}`).join('\n')}`,
          action: null,
        };
      }

      // 8. Switch to review mode
      await this.state.setMode('review');

      // 9. Call ISOLATED ReviewerLLM
      logger.info('Orchestrator', 'Invoking ReviewerLLM', { fileCount: files.length });
      const review = await this.reviewer.review(definition, files);

      // 10. APPLY confidence impact from review (Orchestrator decides!)
      const newConfidence = Math.max(0, Math.min(1, 
        this.state.state.definitionConfidence + review.confidenceImpact
      ));
      await this.state.setConfidence(newConfidence);
      logger.info('Orchestrator', 'Confidence updated', { 
        impact: review.confidenceImpact, 
        newConfidence 
      });

      // 11. Build response based on review verdict
      let response = `✅ Vygenerováno ${files.length} souborů (${duration.toFixed(1)}s):\n`;
      response += files.map(f => `- \`${f.path}\``).join('\n');
      
      if (notes) {
        response += `\n\n📝 ${notes}`;
      }

      // 12. DETERMINISTICKÉ rozhodnutí na základě verdiktu
      if (review.verdict === Verdict.PASS) {
        response += `\n\n✅ Review: PASS (${review.score}/100, confidence: ${(newConfidence * 100).toFixed(0)}%)\nChceš označit blok jako hotový?`;
      } else if (review.verdict === Verdict.WARN) {
        response += `\n\n⚠️ Review: WARN (${review.score}/100, confidence: ${(newConfidence * 100).toFixed(0)}%)`;
        if (review.issues.length > 0) {
          response += `\n${review.issues.slice(0, 3).map(i => `- [${i.severity}] ${i.issue}`).join('\n')}`;
        }
        response += `\n\nChceš opravit nebo označit jako hotovo?`;
      } else {
        response += `\n\n❌ Review: FAIL (${review.score}/100, confidence: ${(newConfidence * 100).toFixed(0)}%)`;
        if (review.issues.length > 0) {
          response += `\n${review.issues.map(i => `- [${i.severity}] ${i.issue}`).join('\n')}`;
        }
        response += `\n\nDoporučuji rollback a opravu definice.`;
      }

      // 13. Return to architect mode
      await this.state.setMode('architect');

      return {
        response,
        action: { type: 'CODER', path: currentPath, files: codeResult.created },
        review,
      };

    } catch (err) {
      await this.state.setMode('architect');
      logger.error('Orchestrator', `Code generation failed: ${err.message}`);
      
      return {
        response: `❌ Chyba při generování: ${err.message}\n\nChceš to zkusit znovu nebo upravit definici?`,
        action: null,
        error: err.message,
      };
    }
  }

  /**
   * Handle: Edit existing files
   * Higher risk than CODER - modifies existing code
   * 
   * Flow:
   * 1. Parse file paths from message
   * 2. Check edit gate
   * 3. Create WIP safepoint
   * 4. EditorLLM generates modifications
   * 5. Preview changes (dry run)
   * 6. Apply modifications
   * 7. ReviewerLLM reviews changes
   * 8. Update confidence based on review
   */
  async handleEditFile(message) {
    const currentPath = this.state.state.current?.path;
    
    // 1. Check basic gate - need current block
    if (!currentPath) {
      return {
        response: '❌ Nejdříve vyber blok, který chceš editovat.',
        action: null,
      };
    }

    // 2. Extract file paths from message or ask
    const filePathMatch = message.match(/(?:soubor|file|upravit?|edit)\s+[`"']?([^\s`"']+)[`"']?/i);
    
    if (!filePathMatch) {
      // Ask for specific files
      return {
        response: '📝 Které soubory chceš upravit?\n\nNapiš např.: `uprav soubor src/api/auth.js`\n\nNebo mi řekni co chceš změnit a já najdu relevantní soubory.',
        action: { type: 'QUERY' },
      };
    }

    const targetFiles = [filePathMatch[1]];
    
    // 3. Extract instructions (rest of message)
    const instructions = message
      .replace(filePathMatch[0], '')
      .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
      .trim() || 'Uprav podle aktuální definice bloku';

    logger.info('Orchestrator', 'Edit request', { targetFiles, instructions: instructions.substring(0, 50) });

    try {
      // 4. Create WIP safepoint BEFORE any changes
      await this.actions.createSafepoint(currentPath);
      
      // HARDENING: Assert WIP safepoint exists
      if (!this.git.hasWIPSafepoint()) {
        logger.error('Orchestrator', 'EDIT WIP GUARD FAILED - no safepoint');
        return {
          response: '❌ Bezpečnostní chyba: nelze vytvořit zálohu. Operace zrušena.',
          error: 'WIP_GUARD_FAILED',
        };
      }

      await this.state.setMode('editor');
      logger.info('Orchestrator', 'Invoking EditorLLM', { 
        files: targetFiles, 
        wipCommit: this.git.getWIPCommit() 
      });

      // 5. Load definition for context
      const definition = await this.roadmap.loadDefinition(currentPath);
      const fullInstructions = `## Kontext bloku\n\n${definition}\n\n## Instrukce\n\n${instructions}`;

      // 6. Generate modifications
      const { modifications, summary, risks, duration, backupSize } = 
        await this.editor.generateModifications(fullInstructions, targetFiles);

      // 7. Validate modifications (dry run)
      const validation = await this.editor.validateModifications(modifications);
      
      if (!validation.valid) {
        const errors = validation.results.filter(r => !r.valid);
        await this.state.setMode('architect');
        
        return {
          response: `⚠️ Některé modifikace nelze aplikovat:\n${errors.map(e => `- ${e.path}: ${e.error}`).join('\n')}\n\nUpřesni instrukce nebo zvol jiné soubory.`,
          action: null,
        };
      }

      // 8. Preview changes
      const previews = await this.editor.previewChanges(modifications);
      
      let previewText = `📝 **Náhled změn** (${modifications.length} modifikací):\n\n`;
      for (const p of previews) {
        if (p.error) {
          previewText += `- ❌ \`${p.path}\`: ${p.error}\n`;
        } else {
          previewText += `- \`${p.path}\` [${p.type}]: ${p.lineDiff > 0 ? '+' : ''}${p.lineDiff} řádků\n`;
        }
      }

      if (risks.length > 0) {
        previewText += `\n⚠️ **Rizika:**\n${risks.map(r => `- ${r}`).join('\n')}`;
      }

      // 9. Apply modifications
      const editResult = await this.actions.editor(modifications);
      
      if (!editResult.success) {
        // Rollback on failure
        await this.editor.restoreBackup();
        await this.state.setMode('architect');
        
        return {
          response: `❌ Chyba při aplikaci změn:\n${editResult.errors.map(e => `- ${e.path}: ${e.error}`).join('\n')}\n\nZměny byly vráceny zpět.`,
          action: null,
        };
      }

      // 10. Review changes
      const filesContent = await this.editor.loadFiles(targetFiles);
      const review = await this.reviewer.review(definition, filesContent);

      // 11. Apply confidence impact (Orchestrator decides, not LLM)
      const newConfidence = Math.max(0, Math.min(1, 
        this.state.state.definitionConfidence + review.confidenceImpact
      ));
      await this.state.setConfidence(newConfidence);

      // 12. Clear WIP marker on success
      this.git.clearWIPMarker();

      // 13. Build response
      let response = `✅ **Editace dokončena** (${duration.toFixed(1)}s)\n\n`;
      response += previewText;
      response += `\n\n📊 Review: ${review.verdict} (${review.score}/100)\n`;
      response += `Confidence: ${(newConfidence * 100).toFixed(0)}%`;

      if (review.verdict === Verdict.FAIL) {
        response += `\n\n❌ Review selhalo. Chceš vrátit změny? (rollback)`;
      } else if (review.verdict === Verdict.WARN) {
        response += `\n\n⚠️ ${review.issues.slice(0, 2).map(i => i.issue).join(', ')}`;
      }

      await this.state.setMode('architect');

      return {
        response,
        action: { type: 'EDITOR', files: targetFiles, modifications: editResult.modified },
        review,
        summary,
      };

    } catch (err) {
      // Restore backup on any error
      await this.editor.restoreBackup();
      await this.state.setMode('architect');
      logger.error('Orchestrator', `Edit failed: ${err.message}`);
      
      return {
        response: `❌ Chyba při editaci: ${err.message}\n\nZměny byly vráceny zpět.`,
        action: null,
        error: err.message,
      };
    }
  }

  /**
   * Handle: Conversation (default flow)
   * LLM pouze RADÍ, Orchestrator aktualizuje state
   */
  async handleConversation(message, attachments) {
    const currentPath = this.state.state.current?.path;

    // Build context
    const context = await this.context.buildContext();
    const formattedContext = this.context.formatForPrompt(context);

    try {
      // LLM generates response - ADVISORY only
      const { response, duration } = await this.architect.converse(message, formattedContext);
      
      // If we have current block, update confidence
      // Orchestrator ROZHODUJE co s navrženou hodnotou
      if (currentPath) {
        const definition = await this.roadmap.loadDefinition(currentPath);
        if (definition) {
          const suggestion = await this.architect.suggestConfidence(definition);
          
          // Orchestrator APLIKUJE confidence (ne LLM!)
          await this.state.setConfidence(suggestion.suggested);
          
          // Add confidence info to response if relevant
          if (suggestion.suggested >= CONFIDENCE_THRESHOLD && !response.includes('?')) {
            return {
              response: response + `\n\n📊 Confidence: ${(suggestion.suggested * 100).toFixed(0)}% - definice vypadá kompletní. Chceš generovat kód?`,
              action: { type: 'CONVERSATION' },
              confidence: suggestion.suggested,
            };
          } else if (suggestion.missing.length > 0 && suggestion.suggested < 0.5) {
            return {
              response: response + `\n\n💡 Tip: ${suggestion.missing[0]}`,
              action: { type: 'CONVERSATION' },
              confidence: suggestion.suggested,
            };
          }
        }
      }

      return {
        response,
        action: { type: 'CONVERSATION' },
        confidence: this.state.state.definitionConfidence,
      };

    } catch (err) {
      logger.error('Orchestrator', `Conversation error: ${err.message}`);
      return {
        response: `Omlouvám se, měl jsem problém: ${err.message}`,
        action: null,
        error: err.message,
      };
    }
  }

  /**
   * Handle: Query status
   * Čistě deterministické, žádné LLM
   */
  async handleQueryStatus() {
    const summary = this.context.getQuickSummary();
    const { stats } = await this.roadmap.parseStructure();
    
    const progressPercent = stats.total > 0 
      ? ((stats.done / stats.total) * 100).toFixed(0) 
      : 0;

    const state = this.state.state;
    
    let response = `📊 **Stav projektu: ${state.project}**\n\n`;
    response += `Progress: ${stats.done}/${stats.total} bloků (${progressPercent}%)\n`;
    response += `Mode: ${state.mode}\n`;
    response += `Confidence: ${(state.definitionConfidence * 100).toFixed(0)}%\n`;
    
    if (state.current?.path) {
      response += `\n📍 Aktuální: ${state.current.path} (${state.current.status})`;
    }
    
    if (state.scopeLock?.active) {
      response += `\n🔒 Scope: ${state.scopeLock.path}`;
    }
    
    if (state.blocker) {
      response += `\n\n⚠️ **BLOCKER**: ${state.blocker.description}`;
    }

    return {
      response,
      action: { type: 'STATUS' },
    };
  }

  /**
   * Handle: Switch block
   */
  async handleSwitchBlock(message) {
    const blockMatch = message.match(/(\d+-[\w-]+(?:\/\d+-[\w-]+)*)/);
    
    if (!blockMatch) {
      return {
        response: 'Na který blok chceš přejít? (formát: 01-nazev nebo 01-parent/02-child)',
        action: null,
      };
    }

    const targetBlock = blockMatch[1];
    
    // Gate check
    const gate = this.checkSwitchGate(targetBlock);
    if (gate.result === GateResult.FAIL) {
      if (gate.needsUnlock) {
        return {
          response: `🔒 ${gate.reasons[0]}\n\nŘekni "odemkni scope" pro odemčení.`,
          action: null,
        };
      }
      return {
        response: `❌ Nemůžu přepnout:\n${gate.reasons.join('\n')}`,
        action: null,
      };
    }

    // Check if block exists
    const definition = await this.roadmap.loadDefinition(targetBlock);
    if (!definition) {
      return {
        response: `Blok ${targetBlock} neexistuje. Chceš ho vytvořit?`,
        action: null,
      };
    }

    // Save current progress
    if (this.state.state.current?.path) {
      try {
        const sessionLog = await this.architect.createSessionSummary(this.state.state.current.path);
        await this.history.saveReplay(this.state.state.current.path, sessionLog);
      } catch {}
    }

    // Clear history
    this.architect.clearHistory();

    // Switch
    await this.state.setCurrent(targetBlock, 'defining');
    
    // Evaluate confidence
    const suggestion = await this.architect.suggestConfidence(definition);
    await this.state.setConfidence(suggestion.suggested);

    return {
      response: `✅ Přepnuto na ${targetBlock}\n\nConfidence: ${(suggestion.suggested * 100).toFixed(0)}%\n${suggestion.missing.length > 0 ? `\n💡 Chybí: ${suggestion.missing.join(', ')}` : ''}`,
      action: { type: 'SWITCH', path: targetBlock },
    };
  }

  /**
   * Handle: Add block
   */
  async handleAddBlock(message) {
    const blockMatch = message.match(/(\d+-[\w-]+)/);
    
    if (!blockMatch) {
      return {
        response: 'Jak se má blok jmenovat? (formát: 01-nazev-bloku)',
        action: null,
      };
    }

    const blockId = blockMatch[1];
    
    // Create block
    await this.roadmap.addBlock(blockId, 'Definice bude doplněna', []);
    await this.state.setCurrent(blockId, 'defining');
    
    // Let architect propose definition
    const context = await this.context.buildContext();
    const { definition } = await this.architect.proposeDefinition(
      blockId,
      context.base.spec || '',
      message
    );
    
    await this.roadmap.saveDefinition(blockId, definition);

    return {
      response: `✅ Vytvořen blok ${blockId}\n\nNavrhl jsem definici - uprav podle potřeby.`,
      action: { type: 'ADD_BLOCK', id: blockId },
    };
  }

  /**
   * Handle: Complete block
   */
  async handleCompleteBlock() {
    const gate = this.checkCompleteGate();
    
    if (gate.result === GateResult.FAIL) {
      return {
        response: `❌ Nemůžu dokončit:\n${gate.reasons.join('\n')}`,
        action: null,
      };
    }

    const currentPath = this.state.state.current.path;

    try {
      // Generate summary and decisions
      const sessionLog = await this.architect.createSessionSummary(currentPath);
      const decisions = await this.architect.extractDecisions();

      // Execute completion
      await this.actions.complete(currentPath, sessionLog, decisions);
      
      // Clear WIP marker after successful completion
      this.git.clearWIPMarker();
      
      // Clear history
      this.architect.clearHistory();

      // Find next block
      const { blocks } = await this.roadmap.parseStructure();
      const nextBlock = blocks.find(b => !b.done);

      let response = `✅ Blok ${currentPath} dokončen!\n`;
      if (decisions.decided?.length > 0) {
        response += `📋 ${decisions.decided.length} rozhodnutí uloženo\n`;
      }
      
      if (nextBlock) {
        response += `\nDalší: ${nextBlock.id} - chceš přejít?`;
      } else {
        response += `\n🎉 Všechny bloky hotové!`;
      }

      return {
        response,
        action: { type: 'COMPLETE', path: currentPath },
        suggestedNext: nextBlock?.id,
      };

    } catch (err) {
      return {
        response: `❌ Chyba při dokončování: ${err.message}`,
        action: null,
        error: err.message,
      };
    }
  }

  /**
   * Handle: Set blocker
   */
  async handleSetBlocker(message) {
    await this.state.setBlocker('technical', message, [], null);
    
    return {
      response: `⚠️ Blocker zaznamenán.\n\nCo už jsi zkusil? Jaký by mohl být další krok?`,
      action: { type: 'SET_BLOCKER' },
    };
  }

  /**
   * Handle: Clear blocker
   */
  async handleClearBlocker() {
    await this.state.clearBlocker();
    
    return {
      response: `✅ Blocker odstraněn. Můžeme pokračovat.`,
      action: { type: 'CLEAR_BLOCKER' },
    };
  }

  /**
   * Handle: Unlock scope
   */
  async handleUnlockScope() {
    await this.state.unlockScope();
    
    return {
      response: `🔓 Scope odemčen. Můžeš přejít na jiný blok.`,
      action: { type: 'UNLOCK_SCOPE' },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get session info
   */
  getSessionInfo() {
    return {
      initialized: this.initialized,
      project: this.state.state?.project,
      mode: this.state.state?.mode,
      current: this.state.state?.current,
      confidence: this.state.state?.definitionConfidence,
      scopeLocked: this.state.state?.scopeLock?.active,
      hasBlocker: !!this.state.state?.blocker,
    };
  }

  /**
   * Manual rollback
   */
  async rollback() {
    return await this.actions.rollback();
  }
}

export { Intent, GateResult, CONFIDENCE_THRESHOLD };
export default ConversationOrchestrator;
