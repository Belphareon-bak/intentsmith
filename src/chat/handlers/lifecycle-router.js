// Lifecycle Router — Phase routing + handlers
// ══════════════════════════════════════════════════════════════════════════════
// Routes user input to the correct lifecycle phase handler.
// Split from lifecycle-handoff.js for modularity.
//
// DI support: context.callLLM and context.executor are propagated to
// ProjectLifecycle instances, allowing test injection of fake providers.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { ProjectPhase } from '../../planner/lifecycle.js';
import { getLcState, setLcState, clearLcState, bindSessionToLifecycle } from './lifecycle-state.js';
import {
  lcResponse,
  formatSpecQuestions,
  formatSpec,
  formatRoadmap,
  formatMilestonePlan,
  formatMilestoneBlocked,
  formatMilestoneProgress,
  formatBuildProgress,
  formatReview,
  formatChangeProposal,
  formatChangeApplied,
  formatProjectCompleted,
} from './lifecycle-formatters.js';

// ─── DI Helper ──────────────────────────────────────────────────────────────

/**
 * Resume a lifecycle and inject DI overrides from context.
 * @param {Object} state - Handoff state
 * @param {Object} context - Handler context (may contain callLLM, executor)
 * @returns {Object} ProjectLifecycle instance with DI applied
 */
async function resumeWithContext(state, context) {
  const { ProjectLifecycle } = await import('../../planner/lifecycle.js');
  const projectPath = context.projectPath || state.projectPath;
  const lifecycle = ProjectLifecycle.resume(state.lifecycleId, projectPath);
  if (!lifecycle) {
    throw new Error(`Lifecycle ${state.lifecycleId} not found in DB`);
  }
  if (context.callLLM) lifecycle.callLLM = context.callLLM;
  if (context.executor) lifecycle.executor = context.executor;
  return lifecycle;
}

// ─── Phase 1: Project-scope BUILD detected → propose lifecycle ──────────────

/**
 * Handle project-scope BUILD detection.
 * Proposes lifecycle approach instead of quick build.
 *
 * @param {string} input - User's original message
 * @param {Object} decision - CRE decision
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
export function handleLifecycleBuildDetected(input, decision, context) {
  const { sessionId } = context;

  logger.info('LifecycleHandoff', 'Project-scope BUILD → proposing lifecycle', {
    sessionId,
    input: input.substring(0, 100),
  });

  setLcState(sessionId, {
    phase: 'PROPOSED',
    lifecycleId: null,
    currentMilestoneId: null,
    originalRequest: input,
    projectId: null,
  });

  const content = [
    `**Detekován rozsáhlý projekt**`,
    ``,
    `Toto vypadá jako projekt, který vyžaduje strukturovaný přístup. Navrhuji použít **lifecycle engine**:`,
    ``,
    `### Jak to funguje`,
    ``,
    `  1. **SPEC** — Společně definujeme cíle, požadavky a tech stack. Zeptám se na upřesňující otázky.`,
    `  2. **PLANNING** — Vygeneruji roadmapu rozdělenou na milníky. Ty ji schválíš nebo upravíš.`,
    `  3. **BUILD** — Postupné budování po milnících. Každý milník projde: plán → kód → testy → checkpoint.`,
    `  4. **REVIEW** — Pravidelné kontroly kvality a scope driftu.`,
    `  5. **CHANGE** — Kdykoliv můžeš změnit směr. Hotové milníky se zachovají, zbytek se přeplánuje.`,
    ``,
    `### Co se automaticky vytvoří`,
    ``,
    `  - **README.md** — Popis projektu, stack, struktura. Aktualizuje se po každém milníku.`,
    `  - **ROADMAP.md** — Roadmapa s milníky, statusy a historií verzí. Aktualizuje se průběžně.`,
    `  - **Git commit + tag** — Po každém dokončeném milníku automatický commit a tag.`,
    ``,
    `### Komunikace`,
    ``,
    `  - Každý krok vyžaduje tvoje schválení (spec, roadmapa, milestone plány).`,
    `  - Kdykoli můžeš napsat **"pauza"** pro pozastavení nebo **"zrušit"** pro ukončení.`,
    `  - Během BUILD fáze můžeš navrhnout změnu směru — engine přeplánuje zbylé milníky.`,
    ``,
    `Chceš začít lifecycle? (ano/ne)`,
    `Nebo napiš "quick build" pro rychlý build bez lifecycle.`,
  ].join('\n');

  return lcResponse(content, { phase: 'PROPOSED', awaitingConfirmation: true });
}

// ─── Phase 2: Route input based on lifecycle phase ──────────────────────────

/**
 * Main router for lifecycle handoff messages.
 * Called by conversation handler when lifecycle handoff is active.
 *
 * @param {string} input - User's message
 * @param {Object} context - Handler context
 * @returns {Promise<TaggedResponse>}
 */
export async function handleLifecycleInput(input, context) {
  const { sessionId } = context;
  const state = getLcState(sessionId);

  if (!state) return null;

  // Cancel/pause commands
  if (/^(zru[sš]it?|cancel|stop)\s*[!.]?$/i.test(input.trim())) {
    clearLcState(sessionId);
    return lcResponse('Lifecycle zrušen. Jsem zpět v chat módu.');
  }

  if (/^(pauza|pause|pozastav)\s*[!.]?$/i.test(input.trim())) {
    if (state.lifecycleId) {
      try {
        const { lifecycles } = await import('../../db/database.js');
        lifecycles.updatePhase.run('PAUSED', state.lifecycleId);
      } catch (e) {
        logger.warn('LifecycleHandoff', 'Pause DB update failed', { error: e.message });
      }
    }
    setLcState(sessionId, { ...state, phase: 'PAUSED' });
    return lcResponse('⏸️ Lifecycle pozastaven. Napiš "pokračovat" pro obnovení.');
  }

  // Resume from pause
  if (state.phase === 'PAUSED' && /^(pokra[čc]ovat|resume|continue|obnovit)\s*[!.]?$/i.test(input.trim())) {
    return await handleResume(state, context);
  }

  // Quick build escape hatch from PROPOSED
  if (state.phase === 'PROPOSED' && /quick\s*build/i.test(input.trim())) {
    clearLcState(sessionId);
    const { setHandoffState } = await import('./build-handoff.js');
    setHandoffState(sessionId, {
      phase: 'PROPOSED',
      workflowSessionId: null,
      originalRequest: state.originalRequest,
      plan: null,
      clarificationQuestions: [],
    });
    return lcResponse(
      `OK, přepínám na rychlý build. Chceš jít stavět? (ano/ne)`,
      { phase: 'QUICK_BUILD_FALLBACK' }
    );
  }

  // Route by phase
  switch (state.phase) {
    case 'PROPOSED':
      return await handleProposedResponse(input, state, context);
    case 'SPEC':
      return await handleSpecInput(input, state, context);
    case 'SPEC_REVIEW':
      return await handleSpecReviewInput(input, state, context);
    case 'PLANNING':
      return await handlePlanningInput(input, state, context);
    case 'PLAN_REVIEW':
      return await handlePlanReviewInput(input, state, context);
    case 'BUILD':
      return await handleBuildInput(input, state, context);
    case 'BUILD_MILESTONE_REVIEW':
      return await handleMilestoneReviewInput(input, state, context);
    case 'REVIEW':
      return await handleReviewInput(input, state, context);
    case 'CHANGE':
      return await handleChangeInput(input, state, context);
    default:
      clearLcState(sessionId);
      return lcResponse('Neznámý stav lifecycle. Zrušen.');
  }
}

// ─── PROPOSED → confirm lifecycle ───────────────────────────────────────────

async function handleProposedResponse(input, state, context) {
  const { sessionId } = context;
  const isYes = /^(ano|jo|ok|yes|jasn[eě]?|sure|start|za[cč]n[ei]|jdi)\s*[!.]?$/i.test(input.trim());
  const isNo = /^(ne|no|nechci)\s*[!.]?$/i.test(input.trim());

  if (isNo) {
    clearLcState(sessionId);
    return lcResponse('OK, zůstáváme v chatu. Můžeš zkusit "quick build" nebo zadat jiný požadavek.');
  }

  if (!isYes) {
    return lcResponse('Chceš začít lifecycle přístup? (ano/ne/quick build)');
  }

  // Start lifecycle — create project + lifecycle record
  try {
    const { projects } = await import('../../db/database.js');
    const { ProjectLifecycle } = await import('../../planner/lifecycle.js');

    const projectPath = context.projectPath || `/tmp/lc-${Date.now()}`;
    const projectName = context.projectName || projectPath.split('/').pop() || `lc-${Date.now()}`;
    const project = projects.getOrCreate(projectName, projectPath, state.originalRequest.substring(0, 200));
    const projectId = Number(project.id);

    const lifecycle = await ProjectLifecycle.create({
      projectId,
      projectPath,
      lifecycleConfig: {},
      callLLM: context.callLLM || null,
      executor: context.executor || null,
    });

    setLcState(sessionId, {
      ...state,
      phase: 'SPEC',
      lifecycleId: lifecycle.id,
      projectId,
      projectPath,
    });

    // C4: Bind this session as lifecycle owner
    bindSessionToLifecycle(sessionId, lifecycle.id);

    // P3: Analyze existing project state for context injection
    const { analyzeExistingProject } = await import('../../planner/lifecycle-analyzer.js');
    let analysisDb = null;
    try {
      const dbMod = await import('../../db/database.js');
      analysisDb = { conversations: dbMod.conversations, projectMemory: dbMod.projectMemory };
    } catch { /* DB not available — analyzer works without it */ }
    const projectContext = await analyzeExistingProject(projectPath, projectId, analysisDb);

    // Start spec analysis
    const { startSpec } = await import('../../planner/lifecycle-spec.js');
    const specResult = await startSpec(lifecycle, state.originalRequest, {
      designContext: context.designContext || null,
      projectContext,
    });

    if (specResult.questions && specResult.questions.length > 0) {
      return lcResponse(formatSpecQuestions(specResult.questions), {
        phase: 'SPEC',
        lifecycleId: lifecycle.id,
      });
    }

    // No questions — spec already generated (unlikely but possible)
    if (specResult.spec) {
      setLcState(sessionId, { ...state, phase: 'SPEC_REVIEW', lifecycleId: lifecycle.id, projectId, projectPath });
      return lcResponse(formatSpec(specResult.spec), {
        phase: 'SPEC_REVIEW',
        lifecycleId: lifecycle.id,
      });
    }

    return lcResponse('Specifikace zahájena. Popíš svůj projekt podrobněji.', {
      phase: 'SPEC',
      lifecycleId: lifecycle.id,
    });

  } catch (err) {
    logger.error('LifecycleHandoff', 'Lifecycle creation failed', { error: err.message });
    clearLcState(sessionId);
    return lcResponse(`Chyba při vytváření lifecycle: ${err.message}`);
  }
}

// ─── SPEC phase ─────────────────────────────────────────────────────────────

async function handleSpecInput(input, state, context) {
  const { sessionId } = context;

  try {
    const lifecycle = await resumeWithContext(state, context);
    const { answerSpecQuestions } = await import('../../planner/lifecycle-spec.js');

    const result = await answerSpecQuestions(lifecycle, input);

    if (result.questions && result.questions.length > 0) {
      return lcResponse(formatSpecQuestions(result.questions), {
        phase: 'SPEC',
        lifecycleId: state.lifecycleId,
      });
    }

    if (result.spec && result.needsMore) {
      // Spec generated but failed validation — stay in SPEC, report errors
      const errorList = (result.validationErrors || []).map(e => `- ${e}`).join('\n');
      return lcResponse(
        `Specifikace má problémy s kvalitou:\n${errorList}\n\nDoplň chybějící informace nebo napiš "doplň to za mě".`,
        { phase: 'SPEC', lifecycleId: state.lifecycleId }
      );
    }

    if (result.spec) {
      await lifecycle.transitionTo('SPEC_REVIEW');
      setLcState(sessionId, { ...state, phase: 'SPEC_REVIEW' });
      return lcResponse(formatSpec(result.spec), {
        phase: 'SPEC_REVIEW',
        lifecycleId: state.lifecycleId,
      });
    }

    return lcResponse('Pokračuj s popisem projektu, potřebuji více detailů.');
  } catch (err) {
    logger.error('LifecycleHandoff', 'Spec input failed', { error: err.message });
    return lcResponse(`Chyba ve specifikační fázi: ${err.message}`);
  }
}

// ─── SPEC_REVIEW phase ──────────────────────────────────────────────────────

async function handleSpecReviewInput(input, state, context) {
  const { sessionId } = context;
  const isApproval = /^(ano|jo|ok|yes|schvaluji?|approve|vypad[áa]\s+to\s+dob[rř]e|lgtm)\s*[!.]?$/i.test(input.trim());

  try {
    const lifecycle = await resumeWithContext(state, context);

    if (isApproval) {
      const { approveSpec } = await import('../../planner/lifecycle-spec.js');
      await approveSpec(lifecycle);

      // Transition to PLANNING — generate roadmap
      setLcState(sessionId, { ...state, phase: 'PLANNING' });

      const { generateRoadmap } = await import('../../planner/lifecycle-planning.js');
      const roadmapResult = await generateRoadmap(lifecycle);

      await lifecycle.transitionTo('PLAN_REVIEW');
      setLcState(sessionId, { ...state, phase: 'PLAN_REVIEW' });
      return lcResponse(formatRoadmap(roadmapResult), {
        phase: 'PLAN_REVIEW',
        lifecycleId: state.lifecycleId,
      });
    }

    // Revision feedback — reviseSpec transitions lifecycle to SPEC and returns {questions, assessment}
    const { reviseSpec } = await import('../../planner/lifecycle-spec.js');
    const result = await reviseSpec(lifecycle, input);

    // Sync handoff state with lifecycle (reviseSpec transitions to SPEC)
    setLcState(sessionId, { ...state, phase: 'SPEC' });

    if (result.questions && result.questions.length > 0) {
      return lcResponse(formatSpecQuestions(result.questions), {
        phase: 'SPEC',
        lifecycleId: state.lifecycleId,
      });
    }

    return lcResponse('Specifikace se reviduje. Pošli odpovědi na upřesňující otázky.');
  } catch (err) {
    logger.error('LifecycleHandoff', 'Spec review failed', { error: err.message });
    return lcResponse(`Chyba při review specifikace: ${err.message}`);
  }
}

// ─── PLANNING / PLAN_REVIEW phase ───────────────────────────────────────────

async function handlePlanningInput(input, state, context) {
  return lcResponse('Roadmapa se generuje, počkej prosím...');
}

async function handlePlanReviewInput(input, state, context) {
  const { sessionId } = context;
  const isApproval = /^(ano|jo|ok|yes|schvaluji?|approve|vypad[áa]\s+to\s+dob[rř]e|lgtm)\s*[!.]?$/i.test(input.trim());

  try {
    const lifecycle = await resumeWithContext(state, context);

    if (isApproval) {
      const { approveRoadmap } = await import('../../planner/lifecycle-planning.js');
      await approveRoadmap(lifecycle);

      // Transition to BUILD — start first milestone
      setLcState(sessionId, { ...state, phase: 'BUILD' });

      const { startNextMilestone } = await import('../../planner/lifecycle-build.js');
      const msResult = await startNextMilestone(lifecycle);

      setLcState(sessionId, {
        ...state,
        phase: 'BUILD_MILESTONE_REVIEW',
        currentMilestoneId: msResult.milestoneId,
      });

      return lcResponse(formatMilestonePlan(msResult), {
        phase: 'BUILD_MILESTONE_REVIEW',
        lifecycleId: state.lifecycleId,
        milestoneId: msResult.milestoneId,
      });
    }

    // Revision — reviseRoadmap transitions lifecycle to PLANNING, transition back to PLAN_REVIEW
    const { reviseRoadmap } = await import('../../planner/lifecycle-planning.js');
    const result = await reviseRoadmap(lifecycle, input);
    await lifecycle.transitionTo('PLAN_REVIEW');

    return lcResponse(formatRoadmap(result), {
      phase: 'PLAN_REVIEW',
      lifecycleId: state.lifecycleId,
    });
  } catch (err) {
    logger.error('LifecycleHandoff', 'Plan review failed', { error: err.message });
    return lcResponse(`Chyba při review roadmapy: ${err.message}`);
  }
}

// ─── BUILD phase ────────────────────────────────────────────────────────────

async function handleBuildInput(input, state, context) {
  // Status check
  if (/^(status|stav|progress|jak\s+to\s+jde)\s*[?!.]?$/i.test(input.trim())) {
    try {
      const { getBuildProgress } = await import('../../planner/lifecycle-build.js');
      const progress = getBuildProgress(state.lifecycleId);
      return lcResponse(formatBuildProgress(progress), {
        phase: 'BUILD',
        lifecycleId: state.lifecycleId,
      });
    } catch (err) {
      return lcResponse(`Chyba při zjišťování stavu: ${err.message}`);
    }
  }

  // Change request
  if (/^(zm[eě]n[ai]|change|upravit|p[rř]idat)\s*:?\s/i.test(input.trim())) {
    return await initiateChange(input, state, context);
  }

  // Continue building — start next milestone
  if (/^(ano|jo|ok|yes|pokra[čc]ovat|continue|d[áa]l|next|jdi)\s*[!.]?$/i.test(input.trim())) {
    return await startNextMilestoneOrComplete(state, context);
  }

  // Default: acknowledge and continue
  return lcResponse(
    'Milestone se právě buduje. Můžeš:\n' +
    '  - "ano" / "pokračovat" — spustit další milník\n' +
    '  - "status" — zobrazit aktuální stav\n' +
    '  - "změna: ..." — navrhnout změnu\n' +
    '  - "pauza" — pozastavit lifecycle\n' +
    '  - "zrušit" — zrušit lifecycle'
  );
}

async function handleMilestoneReviewInput(input, state, context) {
  const { sessionId } = context;
  const isApproval = /^(ano|jo|ok|yes|schvaluji?|approve|jdi|spusť|start)\s*[!.]?$/i.test(input.trim());
  const isRejection = /^(ne|no|nechci|reject|odmít)\s*[!.]?$/i.test(input.trim());

  try {
    const lifecycle = await resumeWithContext(state, context);

    if (isApproval) {
      setLcState(sessionId, { ...state, phase: 'BUILD' });

      const { approveMilestonePlan } = await import('../../planner/lifecycle-build.js');
      const result = await approveMilestonePlan(lifecycle, state.currentMilestoneId);

      // Check if milestone completed
      if (result.status === 'PASSED') {
        return await handleMilestoneCompleted(result, state, context);
      }

      if (result.status === 'BLOCKED') {
        return lcResponse(formatMilestoneBlocked(result), {
          phase: 'BUILD',
          lifecycleId: state.lifecycleId,
          milestoneId: state.currentMilestoneId,
        });
      }

      return lcResponse(formatMilestoneProgress(result), {
        phase: 'BUILD',
        lifecycleId: state.lifecycleId,
      });
    }

    if (isRejection) {
      const feedback = input.replace(/^(ne|no|nechci|reject|odmít)\s*/i, '').trim();
      if (feedback) {
        return lcResponse(
          `Milník odmítnut s feedbackem: "${feedback}"\nPřegeneruji plán milníku...`,
          { phase: 'BUILD_MILESTONE_REVIEW' }
        );
      }
      return lcResponse('Milník odmítnut. Pošli feedback pro úpravu plánu, nebo napiš "skip" pro přeskočení.');
    }

    // Skip milestone
    if (/^skip\s*$/i.test(input.trim())) {
      const { handleMilestoneBlocked } = await import('../../planner/lifecycle-build.js');
      await handleMilestoneBlocked(lifecycle, state.currentMilestoneId, 'skip');
      return await startNextMilestoneOrComplete(state, context);
    }

    // Change request during milestone review — allow user to propose changes
    if (/^(zm[eě]n[ai]|change|upravit|p[rř]idat)\s*:?\s/i.test(input.trim())) {
      return await initiateChange(input, state, context);
    }

    return lcResponse('Schválíš plán milníku? (ano/ne/skip, nebo napiš feedback pro úpravu)');
  } catch (err) {
    logger.error('LifecycleHandoff', 'Milestone review failed', { error: err.message });
    return lcResponse(`Chyba při review milníku: ${err.message}`);
  }
}

// ─── REVIEW phase ───────────────────────────────────────────────────────────

async function handleReviewInput(input, state, context) {
  const isContinue = /^(pokra[čc]ovat|continue|ok|d[áa]l|next)\s*[!.]?$/i.test(input.trim());
  const isChange = /^(zm[eě]n[ai]|change)\s*/i.test(input.trim());

  if (isContinue) {
    return await startNextMilestoneOrComplete(state, context);
  }

  if (isChange) {
    return await initiateChange(input, state, context);
  }

  return lcResponse(
    'Review dokončen. Co chceš dělat?\n' +
    '  - "pokračovat" — další milník\n' +
    '  - "změna: ..." — navrhnout změnu roadmapy\n' +
    '  - "status" — celkový stav projektu'
  );
}

// ─── CHANGE MANAGEMENT phase ────────────────────────────────────────────────

async function handleChangeInput(input, state, context) {
  const { sessionId } = context;
  const isApproval = /^(ano|jo|ok|yes|schvaluji?|approve)\s*[!.]?$/i.test(input.trim());
  const isRejection = /^(ne|no|nechci|reject|odmít)\s*[!.]?$/i.test(input.trim());

  if (!state.changeRequestId) {
    return lcResponse('Žádný aktivní change request. Napiš "změna: ..." pro návrh.');
  }

  try {
    if (isApproval) {
      const { applyChange } = await import('../../planner/lifecycle-change.js');
      const lifecycle = await resumeWithContext(state, context);

      const result = await applyChange(lifecycle, state.changeRequestId);

      setLcState(sessionId, {
        ...state,
        phase: 'BUILD',
        changeRequestId: null,
      });

      return lcResponse(formatChangeApplied(result), {
        phase: 'BUILD',
        lifecycleId: state.lifecycleId,
      });
    }

    if (isRejection) {
      const { rejectChange } = await import('../../planner/lifecycle-change.js');
      rejectChange(state.changeRequestId);

      setLcState(sessionId, {
        ...state,
        phase: 'BUILD',
        changeRequestId: null,
      });

      return lcResponse('Změna zamítnuta. Pokračuji v BUILD fázi.');
    }

    return lcResponse('Schválíš navrhovanou změnu? (ano/ne)');
  } catch (err) {
    logger.error('LifecycleHandoff', 'Change handling failed', { error: err.message });
    return lcResponse(`Chyba při zpracování změny: ${err.message}`);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function handleMilestoneCompleted(result, state, context) {
  const { sessionId } = context;

  // Check if review is due
  try {
    const lifecycle = await resumeWithContext(state, context);

    if (lifecycle.isReviewDue()) {
      setLcState(sessionId, { ...state, phase: 'REVIEW', currentMilestoneId: null });

      const { triggerProjectReview } = await import('../../planner/lifecycle-review.js');
      const reviewResult = await triggerProjectReview(lifecycle);

      return lcResponse(formatReview(reviewResult), {
        phase: 'REVIEW',
        lifecycleId: state.lifecycleId,
      });
    }
  } catch (err) {
    logger.warn('LifecycleHandoff', 'Review check failed, continuing', { error: err.message });
  }

  // No review needed — start next milestone
  return await startNextMilestoneOrComplete(state, context);
}

async function startNextMilestoneOrComplete(state, context) {
  const { sessionId } = context;

  try {
    const lifecycle = await resumeWithContext(state, context);

    const { startNextMilestone } = await import('../../planner/lifecycle-build.js');
    const msResult = await startNextMilestone(lifecycle);

    if (!msResult || !msResult.milestoneId) {
      // No more milestones — project complete!
      await lifecycle.transitionTo(ProjectPhase.COMPLETED);

      const { getBuildProgress } = await import('../../planner/lifecycle-build.js');
      const progress = getBuildProgress(state.lifecycleId);

      clearLcState(sessionId);
      return lcResponse(formatProjectCompleted(progress), {
        phase: 'COMPLETED',
        lifecycleId: state.lifecycleId,
      });
    }

    setLcState(sessionId, {
      ...state,
      phase: 'BUILD_MILESTONE_REVIEW',
      currentMilestoneId: msResult.milestoneId,
    });

    return lcResponse(formatMilestonePlan(msResult), {
      phase: 'BUILD_MILESTONE_REVIEW',
      lifecycleId: state.lifecycleId,
      milestoneId: msResult.milestoneId,
    });
  } catch (err) {
    logger.error('LifecycleHandoff', 'Next milestone failed', { error: err.message });
    return lcResponse(`Chyba při startu dalšího milníku: ${err.message}`);
  }
}

async function initiateChange(input, state, context) {
  const { sessionId } = context;
  const description = input.replace(/^(zm[eě]n[ai]|change|upravit|p[rř]idat)\s*:?\s*/i, '').trim();

  if (!description) {
    return lcResponse('Popíš změnu, kterou chceš provést. Např: "změna: přidat autentifikaci"');
  }

  try {
    const { proposeChange } = await import('../../planner/lifecycle-change.js');
    const lifecycle = await resumeWithContext(state, context);

    const result = await proposeChange(lifecycle, description);

    setLcState(sessionId, {
      ...state,
      phase: 'CHANGE',
      changeRequestId: result.changeRequestId,
    });

    return lcResponse(formatChangeProposal(result), {
      phase: 'CHANGE',
      lifecycleId: state.lifecycleId,
      changeRequestId: result.changeRequestId,
    });
  } catch (err) {
    logger.error('LifecycleHandoff', 'Change proposal failed', { error: err.message });
    return lcResponse(`Chyba při navrhování změny: ${err.message}`);
  }
}

async function handleResume(state, context) {
  const { sessionId } = context;

  try {
    const lifecycle = await resumeWithContext(state, context);

    // Determine where we left off
    const phase = lifecycle.phase;
    setLcState(sessionId, { ...state, phase });

    const { getBuildProgress } = await import('../../planner/lifecycle-build.js');
    const progress = getBuildProgress(state.lifecycleId);

    return lcResponse(
      `▶️ Lifecycle obnoven.\n\n` +
      `Fáze: **${phase}**\n` +
      `${formatBuildProgress(progress)}\n\n` +
      `Co chceš dělat? (pokračovat/status/změna/zrušit)`,
      { phase, lifecycleId: state.lifecycleId }
    );
  } catch (err) {
    logger.error('LifecycleHandoff', 'Resume failed', { error: err.message });
    clearLcState(sessionId);
    return lcResponse(`Chyba při obnovení lifecycle: ${err.message}`);
  }
}
