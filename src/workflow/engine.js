// C.3 v28 Workflow Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// Adaptivní workflow podle složitosti:
// - SIMPLE:  THINKER → ANALYZER → PLANNER → CODER → REVIEWER → DONE
// - MEDIUM:  + DESIGN_AUDIT (1 retry max)
// - HIGH:    + ADVERSARIAL review
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { config, complexityKeywords } from '../config.js';
import { logger } from '../core/logger.js';
import { callOllama, extractJSON, extractModifiedFiles, hashQuestion } from '../llm/client.js';
import { PROMPTS } from '../llm/prompts.js';
import db from '../db/database.js';

// States
export const State = {
  INIT: 'INIT',
  CLASSIFYING: 'CLASSIFYING',
  ANALYZING: 'ANALYZING',
  ASK_USER: 'ASK_USER',
  AUTO_ANSWER: 'AUTO_ANSWER',
  PLANNING: 'PLANNING',
  DESIGN_AUDIT: 'DESIGN_AUDIT',
  PLAN_REVIEW: 'PLAN_REVIEW',
  IMPLEMENTING: 'IMPLEMENTING',
  REVIEWING: 'REVIEWING',
  FIXING: 'FIXING',
  ADVERSARIAL: 'ADVERSARIAL',
  DONE: 'DONE',
  ERROR: 'ERROR',
};

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW SESSION
// ════════════════════════════════════════════════════════════════════════════

export class WorkflowSession {
  constructor(sessionId, workdir, projectId = null) {
    this.sessionId = sessionId;
    this.workdir = workdir;
    this.projectId = projectId;
    
    this.state = State.INIT;
    this.complexity = 'SIMPLE';
    this.request = '';
    
    // Q&A
    this.questions = [];
    this.answers = {};
    
    // Plan & Implementation
    this.plan = null;
    this.files = {};
    
    // Review
    this.iterations = 0;
    this.designRetries = 0;
    
    // Timing
    this.timing = {
      start: Date.now(),
      phases: {},
    };
    
    // Errors
    this.lastError = null;
  }
  
  // Save state to DB
  save() {
    db.workflowSessions.save(
      this.sessionId,
      this.state,
      this.plan,
      this.files,
      this.timing
    );
  }
  
  // Record phase timing
  recordTiming(phase, durationSec) {
    this.timing.phases[phase] = durationSec;
  }
  
  // Get summary
  getSummary() {
    const totalTime = ((Date.now() - this.timing.start) / 1000).toFixed(1);
    return {
      sessionId: this.sessionId,
      state: this.state,
      complexity: this.complexity,
      iterations: this.iterations,
      totalTime: `${totalTime}s`,
      phases: this.timing.phases,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW ENGINE
// ════════════════════════════════════════════════════════════════════════════

export class WorkflowEngine {
  constructor() {
    this.sessions = new Map();
  }
  
  // Get or create session
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // START WORKFLOW
  // ══════════════════════════════════════════════════════════════════════════
  
  async start(sessionId, request, workdir) {
    const session = new WorkflowSession(sessionId, workdir);
    session.request = request;
    this.sessions.set(sessionId, session);
    
    // Ensure workdir exists
    if (!fs.existsSync(workdir)) {
      fs.mkdirSync(workdir, { recursive: true });
    }
    
    // Create DB record
    db.workflowSessions.getOrCreate(sessionId, session.projectId, request, 'SIMPLE');
    
    logger.info('Workflow', `Started session ${sessionId}`, { workdir });
    
    // Step 1: Classify complexity
    session.state = State.CLASSIFYING;
    session.complexity = await this.classifyComplexity(session);
    
    logger.info('Workflow', `Complexity: ${session.complexity}`);
    
    // Step 2: Analyze for questions
    session.state = State.ANALYZING;
    const analysisResult = await this.analyze(session);
    
    return analysisResult;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CONTINUE WORKFLOW (after user input)
  // ══════════════════════════════════════════════════════════════════════════
  
  async continue(sessionId, userInput) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    logger.info('Workflow', `Continue session ${sessionId}`, { state: session.state, input: userInput.substring(0, 50) });
    
    switch (session.state) {
      case State.ASK_USER:
        return await this.processUserAnswers(session, userInput);
        
      case State.AUTO_ANSWER:
        return await this.confirmAutoAnswers(session, userInput);
        
      case State.PLAN_REVIEW:
        return await this.confirmPlan(session, userInput);
        
      case State.DONE:
      case State.ERROR:
        return this.getResult(session);
        
      default:
        throw new Error(`Cannot continue in state: ${session.state}`);
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CLASSIFY COMPLEXITY
  // ══════════════════════════════════════════════════════════════════════════
  
  async classifyComplexity(session) {
    const timer = logger.time('Workflow', 'CLASSIFIER');
    
    // Quick heuristic first
    const requestLower = session.request.toLowerCase();
    
    for (const keyword of complexityKeywords.HIGH) {
      if (requestLower.includes(keyword)) {
        timer.end('(heuristic: HIGH)');
        return 'HIGH';
      }
    }
    
    for (const keyword of complexityKeywords.MEDIUM) {
      if (requestLower.includes(keyword)) {
        timer.end('(heuristic: MEDIUM)');
        return 'MEDIUM';
      }
    }
    
    // If short request, assume SIMPLE
    if (session.request.length < 200) {
      timer.end('(heuristic: SIMPLE - short)');
      return 'SIMPLE';
    }
    
    // LLM classification for longer requests
    try {
      const response = await callOllama('CLASSIFIER', session.request, PROMPTS.CLASSIFIER);
      const result = extractJSON(response.content);
      
      if (result?.complexity) {
        session.recordTiming('CLASSIFIER', response.duration);
        timer.end(`(LLM: ${result.complexity})`);
        return result.complexity;
      }
    } catch (err) {
      logger.warn('Workflow', `Classifier failed, defaulting to SIMPLE: ${err.message}`);
    }
    
    timer.end('(default: SIMPLE)');
    return 'SIMPLE';
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // ANALYZE (THINKER → ANALYZER)
  // ══════════════════════════════════════════════════════════════════════════
  
  async analyze(session) {
    // Phase 1: THINKER - generate questions
    logger.info('Workflow', 'Phase: THINKER');
    const thinkerTimer = logger.time('Workflow', 'THINKER');
    
    const thinkerResponse = await callOllama('THINKER', session.request, PROMPTS.THINKER);
    session.recordTiming('THINKER', thinkerResponse.duration);
    
    const thinkerResult = extractJSON(thinkerResponse.content);
    thinkerTimer.end();
    
    if (!thinkerResult?.questions || thinkerResult.questions.length === 0) {
      // No questions needed - proceed to planning
      logger.info('Workflow', 'No questions - proceeding to planning');
      return await this.plan(session);
    }
    
    session.questions = thinkerResult.questions;
    
    // Phase 2: ANALYZER - decide what to do with questions
    logger.info('Workflow', 'Phase: ANALYZER');
    const analyzerTimer = logger.time('Workflow', 'ANALYZER');
    
    const analyzerPrompt = `## Požadavek:\n${session.request}\n\n## Otázky od THINKER:\n${JSON.stringify(thinkerResult.questions, null, 2)}`;
    const analyzerResponse = await callOllama('ANALYZER', analyzerPrompt, PROMPTS.ANALYZER);
    session.recordTiming('ANALYZER', analyzerResponse.duration);
    
    const analyzerResult = extractJSON(analyzerResponse.content);
    analyzerTimer.end();
    
    if (!analyzerResult) {
      // Fallback: treat all as trivial
      logger.warn('Workflow', 'ANALYZER failed - auto-answering all questions');
      session.state = State.AUTO_ANSWER;
      return {
        state: session.state,
        auto_answers: session.questions.map(q => ({
          text: q.text,
          answer: q.suggested_answer,
        })),
      };
    }
    
    // Route based on ANALYZER decision
    session.state = analyzerResult.state || State.AUTO_ANSWER;
    
    if (session.state === State.READY || 
        (session.state === State.AUTO_ANSWER && (!analyzerResult.auto_answers || analyzerResult.auto_answers.length === 0))) {
      // Ready to proceed
      return await this.plan(session);
    }
    
    return {
      state: session.state,
      questions_for_user: analyzerResult.questions_for_user || [],
      auto_answers: analyzerResult.auto_answers || [],
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // PROCESS USER ANSWERS
  // ══════════════════════════════════════════════════════════════════════════
  
  async processUserAnswers(session, userInput) {
    // Parse user answers (simple format: each line is an answer)
    const lines = userInput.split('\n').filter(l => l.trim());
    
    session.questions.forEach((q, i) => {
      if (q.importance === 'CRITICAL') {
        session.answers[q.text] = lines[i] || q.suggested_answer;
      }
    });
    
    logger.info('Workflow', 'User answers recorded', { count: Object.keys(session.answers).length });
    
    return await this.plan(session);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CONFIRM AUTO ANSWERS
  // ══════════════════════════════════════════════════════════════════════════
  
  async confirmAutoAnswers(session, userInput) {
    const input = userInput.trim().toLowerCase();
    
    if (input === 'ok' || input === 'yes' || input === 'ano' || input === 'y') {
      // Record learning feedback
      for (const q of session.questions) {
        if (q.importance === 'TRIVIAL') {
          const hash = hashQuestion(q.text);
          db.learnedPatterns.recordConfirmation(
            hash,
            q.text,
            q.suggested_answer,
            session.projectId,
            config.workflow.learningThreshold
          );
          session.answers[q.text] = q.suggested_answer;
        }
      }
      
      logger.info('Workflow', 'Auto-answers confirmed, proceeding to planning');
      return await this.plan(session);
    }
    
    // User wants to modify - switch to ASK_USER
    session.state = State.ASK_USER;
    return {
      state: session.state,
      questions_for_user: session.questions,
      message: 'Prosím odpověz na otázky:',
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // PLAN (D1)
  // ══════════════════════════════════════════════════════════════════════════
  
  async plan(session) {
    session.state = State.PLANNING;
    logger.info('Workflow', 'Phase: PLANNER (D1)');
    
    const plannerTimer = logger.time('Workflow', 'PLANNER');
    
    // Build context with answers
    let context = `## Požadavek:\n${session.request}\n\n`;
    
    if (Object.keys(session.answers).length > 0) {
      context += `## Upřesnění:\n`;
      for (const [q, a] of Object.entries(session.answers)) {
        context += `- ${q}: ${a}\n`;
      }
      context += '\n';
    }
    
    const response = await callOllama('PLANNER', context, PROMPTS.PLANNER);
    session.recordTiming('PLANNER', response.duration);
    
    const plan = extractJSON(response.content);
    plannerTimer.end();
    
    if (!plan) {
      session.state = State.ERROR;
      session.lastError = 'PLANNER failed to generate valid plan';
      return { state: session.state, error: session.lastError };
    }
    
    session.plan = plan;
    
    // Save plan to file
    const planPath = path.join(session.workdir, '.c3-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    logger.info('Workflow', 'Plan saved', { path: planPath });
    
    // DESIGN_AUDIT for MEDIUM/HIGH complexity
    const workflowConfig = config.workflow.complexity[session.complexity];
    
    if (workflowConfig.designAudit) {
      const auditResult = await this.designAudit(session);
      if (auditResult.verdict === 'REDESIGN') {
        return auditResult;
      }
    }
    
    // Show plan for review
    session.state = State.PLAN_REVIEW;
    return {
      state: session.state,
      plan: this.formatPlanPreview(plan),
      planJson: plan,
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // DESIGN AUDIT (optional, MEDIUM/HIGH only)
  // ══════════════════════════════════════════════════════════════════════════
  
  async designAudit(session) {
    session.state = State.DESIGN_AUDIT;
    session.designRetries++;
    
    logger.info('Workflow', `Phase: DESIGN_AUDIT (attempt ${session.designRetries})`);
    const auditTimer = logger.time('Workflow', 'DESIGN_AUDIT');
    
    const auditPrompt = `## Požadavek:\n${session.request}\n\n## Plán:\n${JSON.stringify(session.plan, null, 2)}`;
    const response = await callOllama('REVIEWER', auditPrompt, PROMPTS.DESIGN_AUDIT);
    session.recordTiming('DESIGN_AUDIT', response.duration);
    
    const result = extractJSON(response.content);
    auditTimer.end();
    
    if (!result || result.verdict === 'PASS') {
      logger.info('Workflow', 'DESIGN_AUDIT: PASS');
      return { verdict: 'PASS' };
    }
    
    // REDESIGN needed
    logger.info('Workflow', 'DESIGN_AUDIT: REDESIGN', { flaws: result.critical_flaws?.length });
    
    if (session.designRetries >= config.workflow.maxDesignRetries) {
      logger.warn('Workflow', 'Max design retries reached, proceeding anyway');
      return { verdict: 'PASS' };
    }
    
    // Re-plan with feedback
    const redesignPrompt = `## Původní plán:\n${JSON.stringify(session.plan, null, 2)}\n\n## Kritické problémy:\n${JSON.stringify(result.critical_flaws, null, 2)}\n\nOprav plán tak, aby řešil tyto problémy.`;
    
    const redesignResponse = await callOllama('PLANNER', redesignPrompt, PROMPTS.PLANNER);
    const newPlan = extractJSON(redesignResponse.content);
    
    if (newPlan) {
      session.plan = newPlan;
      const planPath = path.join(session.workdir, '.c3-plan.json');
      fs.writeFileSync(planPath, JSON.stringify(newPlan, null, 2));
    }
    
    return { verdict: 'REDESIGN', flaws: result.critical_flaws };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CONFIRM PLAN
  // ══════════════════════════════════════════════════════════════════════════
  
  async confirmPlan(session, userInput) {
    const input = userInput.trim().toLowerCase();
    
    if (input === 'ok' || input === 'yes' || input === 'ano' || input === 'y') {
      logger.info('Workflow', 'Plan confirmed, starting implementation');
      return await this.implement(session);
    }
    
    if (input.startsWith('jiný') || input.startsWith('alternativ')) {
      // User wants alternative - re-plan with different approach
      logger.info('Workflow', 'User requested alternative plan');
      session.answers['_alternative'] = 'Použij jiný přístup než v předchozím plánu';
      return await this.plan(session);
    }
    
    // User provided feedback
    session.answers['_feedback'] = userInput;
    return await this.plan(session);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // IMPLEMENT (CODE → REVIEW → FIX loop)
  // ══════════════════════════════════════════════════════════════════════════
  
  async implement(session) {
    session.state = State.IMPLEMENTING;
    session.iterations++;
    
    logger.info('Workflow', `Phase: CODER (iteration ${session.iterations})`);
    const coderTimer = logger.time('Workflow', 'CODER');
    
    const coderPrompt = `## Plán:\n${JSON.stringify(session.plan, null, 2)}`;
    const response = await callOllama('CODER', coderPrompt, PROMPTS.CODER);
    session.recordTiming(`CODER_${session.iterations}`, response.duration);
    
    const files = extractModifiedFiles(response.content);
    coderTimer.end(`(${files.length} files)`);
    
    if (files.length === 0) {
      logger.error('Workflow', 'CODER returned no files');
      session.state = State.ERROR;
      session.lastError = 'CODER failed to generate files';
      return { state: session.state, error: session.lastError };
    }
    
    // Save files
    for (const file of files) {
      this.saveFile(file.path, file.content);
      session.files[file.path] = file.content;
    }
    
    logger.info('Workflow', `Saved ${files.length} files`);
    
    // Review
    return await this.review(session);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW (R2A)
  // ══════════════════════════════════════════════════════════════════════════
  
  async review(session) {
    session.state = State.REVIEWING;
    
    logger.info('Workflow', 'Phase: REVIEWER (R2A)');
    const reviewTimer = logger.time('Workflow', 'REVIEWER');
    
    // Build review context
    const filesContext = Object.entries(session.files)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');
    
    const reviewPrompt = `## Plán:\n${JSON.stringify(session.plan, null, 2)}\n\n## Implementace:\n${filesContext}`;
    const response = await callOllama('REVIEWER', reviewPrompt, PROMPTS.REVIEWER);
    session.recordTiming(`REVIEWER_${session.iterations}`, response.duration);
    
    const result = extractJSON(response.content);
    reviewTimer.end();
    
    if (!result || result.verdict === 'PASS') {
      logger.info('Workflow', 'REVIEWER: PASS');
      
      // ADVERSARIAL review for HIGH complexity
      const workflowConfig = config.workflow.complexity[session.complexity];
      if (workflowConfig.adversarial) {
        return await this.adversarialReview(session);
      }
      
      return await this.complete(session);
    }
    
    // FAIL - need fixes
    logger.info('Workflow', 'REVIEWER: FAIL', { issues: result.issues?.length });
    
    if (session.iterations >= config.workflow.maxIterations) {
      logger.warn('Workflow', 'Max iterations reached, completing anyway');
      return await this.complete(session);
    }
    
    // Fix issues
    return await this.fix(session, result.issues);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // FIX (D2)
  // ══════════════════════════════════════════════════════════════════════════
  
  async fix(session, issues) {
    session.state = State.FIXING;
    session.iterations++;
    
    logger.info('Workflow', `Phase: FIXER (D2) - iteration ${session.iterations}`);
    const fixerTimer = logger.time('Workflow', 'FIXER');
    
    const filesContext = Object.entries(session.files)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');
    
    const fixPrompt = `## Plán:\n${JSON.stringify(session.plan, null, 2)}\n\n## Aktuální implementace:\n${filesContext}\n\n## Problémy k opravě:\n${JSON.stringify(issues, null, 2)}`;
    const response = await callOllama('FIXER', fixPrompt, PROMPTS.FIXER);
    session.recordTiming(`FIXER_${session.iterations}`, response.duration);
    
    const files = extractModifiedFiles(response.content);
    fixerTimer.end(`(${files.length} files)`);
    
    if (files.length === 0) {
      logger.warn('Workflow', 'FIXER returned no files, using previous');
    } else {
      // Update files
      for (const file of files) {
        this.saveFile(file.path, file.content);
        session.files[file.path] = file.content;
      }
    }
    
    // Re-review
    return await this.review(session);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // ADVERSARIAL REVIEW (R2B, HIGH only)
  // ══════════════════════════════════════════════════════════════════════════
  
  async adversarialReview(session) {
    session.state = State.ADVERSARIAL;
    
    logger.info('Workflow', 'Phase: ADVERSARIAL (R2B)');
    const advTimer = logger.time('Workflow', 'ADVERSARIAL');
    
    const filesContext = Object.entries(session.files)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');
    
    const advPrompt = `## Požadavek:\n${session.request}\n\n## Implementace:\n${filesContext}`;
    const response = await callOllama('ADVERSARIAL', advPrompt, PROMPTS.ADVERSARIAL);
    session.recordTiming('ADVERSARIAL', response.duration);
    
    const result = extractJSON(response.content);
    advTimer.end();
    
    if (!result || result.verdict === 'PASS') {
      logger.info('Workflow', 'ADVERSARIAL: PASS');
      return await this.complete(session);
    }
    
    // HIGH severity findings - fix them
    const highFindings = result.findings?.filter(f => f.severity === 'HIGH') || [];
    
    if (highFindings.length > 0 && session.iterations < config.workflow.maxIterations) {
      logger.info('Workflow', 'ADVERSARIAL: FAIL', { highFindings: highFindings.length });
      
      // Convert findings to issues format for FIXER
      const issues = highFindings.map(f => ({
        severity: 'CRITICAL',
        file: f.file || 'unknown',
        issue: f.description,
        fix: f.fix,
      }));
      
      return await this.fix(session, issues);
    }
    
    return await this.complete(session);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // COMPLETE
  // ══════════════════════════════════════════════════════════════════════════
  
  async complete(session) {
    session.state = State.DONE;
    session.timing.end = Date.now();
    session.timing.total = ((session.timing.end - session.timing.start) / 1000).toFixed(1);
    
    session.save();
    
    logger.info('Workflow', '✅ Workflow completed', session.getSummary());
    
    return {
      state: session.state,
      files: Object.keys(session.files),
      summary: session.getSummary(),
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  
  saveFile(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
    logger.debug('Workflow', `Saved: ${filePath}`);
  }
  
  formatPlanPreview(plan) {
    let preview = `## 📋 Plán implementace\n\n`;
    preview += `### Přehled\n${plan.overview}\n\n`;
    preview += `### Architektura\n${plan.architecture?.pattern}: ${plan.architecture?.description}\n\n`;
    preview += `### Soubory\n`;
    
    for (const file of plan.files || []) {
      preview += `- \`${file.path}\` - ${file.purpose}\n`;
    }
    
    if (plan.acceptance_criteria?.length > 0) {
      preview += `\n### Akceptační kritéria\n`;
      for (const ac of plan.acceptance_criteria) {
        preview += `- **${ac.id}**: ${ac.description}\n`;
      }
    }
    
    return preview;
  }
  
  getResult(session) {
    return {
      state: session.state,
      summary: session.getSummary(),
      files: Object.keys(session.files),
      error: session.lastError,
    };
  }
}

// Singleton instance
export const workflowEngine = new WorkflowEngine();

export default workflowEngine;
