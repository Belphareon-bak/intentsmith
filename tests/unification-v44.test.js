// CRE v44.x Unification Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { describe, it, beforeEach } from 'node:test';

// v44.0: Chat Controller (FÁZE A)
import {
  ChatMode,
  ResponseSpeaker,
  ResponseTag,
  TaggedResponse,
  ModeDetector,
  ChatController,
  createChatController,
  createResponseTag,
  createTaggedResponse,
} from '../src/unification/chat-controller.js';

// v44.1: Project Focus (FÁZE B)
import {
  FocusScope,
  LockState,
  TransitionType,
  TRANSITION_RULES,
  ProjectFocus,
  FocusLock,
  ModeTransition,
  ProjectFocusManager,
  createProjectFocusManager,
  createFileFocus,
  createModuleFocus,
} from '../src/unification/project-focus.js';

// v44.2: Expert Profile (FÁZE C)
import {
  ExpertDomain,
  ConfidenceLevel,
  ArbitrationStrategy,
  ExpertProfile,
  ExpertResponse,
  ExpertArbitrator,
  createExpertProfile,
  createExpertResponse,
  createExpertArbitrator,
} from '../src/unification/expert-profile.js';

// v44.3: Agent Contract (FÁZE D)
import {
  AgentStatus,
  VisibilityLevel,
  ActionType,
  AgentProgress,
  NextAction,
  LogsReference,
  AgentOutputContract,
  VisibilityFormatter,
  AgentOutputBuilder,
  createAgentOutputBuilder,
  createVisibilityFormatter,
} from '../src/unification/agent-contract.js';


// ═══════════════════════════════════════════════════════════════════════════════
// v44.0 — FÁZE A: Chat Controller Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('v44.0 — FÁZE A: Chat Controller', () => {

  describe('ResponseTag', () => {
    it('creates a valid response tag', () => {
      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.9,
        canExecute: false,
      });

      assert.strictEqual(tag.speaker, ResponseSpeaker.SYSTEM);
      assert.strictEqual(tag.mode, ChatMode.CONVERSATION);
      assert.strictEqual(tag.confidence, 0.9);
      assert.strictEqual(tag.canExecute, false);
      assert.ok(tag.timestamp > 0);
    });

    it('rejects invalid speaker', () => {
      assert.throws(() => new ResponseTag({
        speaker: 'invalid',
        mode: ChatMode.CONVERSATION,
        confidence: 0.9,
      }), /Invalid speaker/);
    });

    it('rejects invalid confidence', () => {
      assert.throws(() => new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 1.5,
      }), /Confidence must be/);
    });

    it('serializes to JSON', () => {
      const tag = createResponseTag({
        speaker: ResponseSpeaker.EXPERT,
        mode: ChatMode.EXPERT,
        confidence: 0.85,
        canExecute: true,
        metadata: { domain: 'security' },
      });

      const json = tag.toJSON();
      assert.strictEqual(json.speaker, 'expert');
      assert.strictEqual(json.mode, 'expert');
      assert.strictEqual(json.confidence, 0.85);
      assert.strictEqual(json.can_execute, true);
      assert.deepStrictEqual(json.metadata, { domain: 'security' });
    });
  });

  describe('TaggedResponse', () => {
    it('creates a tagged response', () => {
      const response = createTaggedResponse(
        'Hello, how can I help?',
        {
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: 0.95,
          canExecute: false,
        }
      );

      assert.strictEqual(response.content, 'Hello, how can I help?');
      assert.strictEqual(response.speaker, ResponseSpeaker.SYSTEM);
      assert.strictEqual(response.mode, ChatMode.CONVERSATION);
      assert.strictEqual(response.confidence, 0.95);
    });

    it('requires actions when canExecute is true', () => {
      const tag = new ResponseTag({
        speaker: ResponseSpeaker.AGENT,
        mode: ChatMode.AGENT,
        confidence: 0.9,
        canExecute: true,
      });

      assert.throws(() => new TaggedResponse({
        content: 'Execute this',
        tag,
        actions: [], // Empty actions with canExecute=true
      }), /canExecute is true but no actions/);
    });
  });

  describe('ModeDetector', () => {
    it('detects conversation mode for greetings', () => {
      const detector = new ModeDetector();
      const result = detector.detect('Hello there!');

      assert.strictEqual(result.mode, ChatMode.CONVERSATION);
      assert.ok(result.confidence >= 0.5);
    });

    it('detects agent mode for execution commands', () => {
      const detector = new ModeDetector();
      const result = detector.detect('run the tests');

      assert.strictEqual(result.mode, ChatMode.AGENT);
      assert.ok(result.signals.length > 0);
    });

    it('detects expert mode for explanations', () => {
      const detector = new ModeDetector();
      const result = detector.detect('explain how the authentication works');

      assert.strictEqual(result.mode, ChatMode.EXPERT);
    });

    it('detects project mode for file operations', () => {
      const detector = new ModeDetector();
      const result = detector.detect('refactor the User class');

      assert.strictEqual(result.mode, ChatMode.PROJECT);
    });

    it('sets requiresConfirmation for agent mode', () => {
      const detector = new ModeDetector();
      const result = detector.detect('run the tests');

      assert.strictEqual(result.mode, ChatMode.AGENT);
      assert.strictEqual(result.requiresConfirmation, true);
    });

    it('does not require confirmation for conversation mode', () => {
      const detector = new ModeDetector();
      const result = detector.detect('Hello there!');

      assert.strictEqual(result.mode, ChatMode.CONVERSATION);
      assert.strictEqual(result.requiresConfirmation, false);
    });
  });

  describe('ChatController', () => {
    let controller;

    beforeEach(() => {
      controller = createChatController('session_001');
    });

    it('initializes in conversation mode', () => {
      assert.strictEqual(controller.currentMode, ChatMode.CONVERSATION);
      assert.strictEqual(controller.sessionId, 'session_001');
    });

    it('processes input and returns tagged response', async () => {
      const response = await controller.process('Hello');

      assert.ok(response instanceof TaggedResponse);
      assert.strictEqual(response.mode, ChatMode.CONVERSATION);
    });

    it('registers custom handlers', async () => {
      controller.registerHandler(ChatMode.PROJECT, (input, ctx) => {
        return createTaggedResponse(
          `Project handler: ${input}`,
          {
            speaker: ResponseSpeaker.SYSTEM,
            mode: ChatMode.PROJECT,
            confidence: 0.9,
            canExecute: false,
          }
        );
      });

      const response = await controller.process('refactor the code', {
        forceMode: ChatMode.PROJECT,
      });

      assert.strictEqual(response.mode, ChatMode.PROJECT);
      assert.ok(response.content.includes('Project handler'));
    });

    it('tracks mode transitions', () => {
      controller.switchMode(ChatMode.PROJECT, 'user request');
      controller.switchMode(ChatMode.AGENT, 'automation');

      const transitions = controller.modeTransitions;
      assert.strictEqual(transitions.length, 2);
      assert.strictEqual(transitions[0].to, ChatMode.PROJECT);
      assert.strictEqual(transitions[1].to, ChatMode.AGENT);
    });

    it('returns error response for missing handlers', async () => {
      const response = await controller.process('test', {
        forceMode: ChatMode.EXPERT,
      });

      assert.ok(response.content.includes('Error'));
      assert.ok(response.tag.metadata.error);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// v44.1 — FÁZE B: Project Focus Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('v44.1 — FÁZE B: Project Focus', () => {

  describe('ProjectFocus', () => {
    it('creates a file-level focus', () => {
      const focus = createFileFocus('/src/auth/login.js');

      assert.strictEqual(focus.scope, FocusScope.FILE);
      assert.strictEqual(focus.path, '/src/auth/login.js');
    });

    it('creates a module-level focus', () => {
      const focus = createModuleFocus('/src/auth');

      assert.strictEqual(focus.scope, FocusScope.MODULE);
      assert.strictEqual(focus.path, '/src/auth');
    });

    it('creates a global focus', () => {
      const focus = ProjectFocus.global();

      assert.strictEqual(focus.scope, FocusScope.GLOBAL);
      assert.strictEqual(focus.path, null);
    });

    it('checks path containment', () => {
      const moduleFocus = createModuleFocus('/src/auth');
      const fileFocus = createFileFocus('/src/auth/login.js');

      assert.ok(moduleFocus.contains(fileFocus));
      assert.ok(!fileFocus.contains(moduleFocus));
    });

    it('checks file relation', () => {
      const focus = createModuleFocus('/src/auth');

      assert.ok(focus.isRelatedTo('/src/auth/login.js'));
      assert.ok(focus.isRelatedTo('/src/auth/utils/helpers.js'));
      assert.ok(!focus.isRelatedTo('/src/api/routes.js'));
    });
  });

  describe('FocusLock', () => {
    it('creates unlocked state', () => {
      const lock = new FocusLock({ state: LockState.UNLOCKED, focus: null });

      assert.ok(!lock.isLocked);
      assert.ok(lock.allowsFocusChange(ProjectFocus.global()).allowed);
    });

    it('creates soft lock', () => {
      const focus = createFileFocus('/src/main.js');
      const lock = new FocusLock({
        state: LockState.SOFT,
        focus,
        reason: 'Working on main.js',
      });

      assert.ok(lock.isLocked);
      assert.ok(!lock.isHardLocked);

      const check = lock.allowsFocusChange(createFileFocus('/src/other.js'));
      assert.ok(check.allowed);
      assert.ok(check.warning); // Should have warning
    });

    it('creates hard lock', () => {
      const focus = createFileFocus('/src/main.js');
      const lock = new FocusLock({
        state: LockState.HARD,
        focus,
        reason: 'Critical work',
      });

      assert.ok(lock.isLocked);
      assert.ok(lock.isHardLocked);

      const check = lock.allowsFocusChange(createFileFocus('/src/other.js'));
      assert.ok(!check.allowed);
      assert.ok(check.reason.includes('Hard lock'));
    });

    it('hard lock blocks proactive interactions', () => {
      const focus = createFileFocus('/src/main.js');
      const lock = new FocusLock({
        state: LockState.HARD,
        focus,
        reason: 'Critical work',
      });

      assert.ok(lock.blocksProactiveInteractions());

      // Check specific interaction types
      const suggestion = lock.allowsInteraction('proactive_suggestion');
      assert.ok(!suggestion.allowed);
      assert.ok(suggestion.reason.includes('Hard lock'));

      const expertAdvice = lock.allowsInteraction('expert_advice');
      assert.ok(!expertAdvice.allowed);

      const autoTransition = lock.allowsInteraction('auto_transition');
      assert.ok(!autoTransition.allowed);
    });

    it('soft lock does not block proactive interactions', () => {
      const focus = createFileFocus('/src/main.js');
      const lock = new FocusLock({
        state: LockState.SOFT,
        focus,
        reason: 'Working',
      });

      assert.ok(!lock.blocksProactiveInteractions());

      const suggestion = lock.allowsInteraction('proactive_suggestion');
      assert.ok(suggestion.allowed);
    });

    it('unlocked state allows all interactions', () => {
      const lock = new FocusLock({ state: LockState.UNLOCKED, focus: null });

      assert.ok(!lock.blocksProactiveInteractions());

      const suggestion = lock.allowsInteraction('proactive_suggestion');
      assert.ok(suggestion.allowed);
    });
  });

  describe('ProjectFocusManager', () => {
    let manager;

    beforeEach(() => {
      manager = createProjectFocusManager('session_001');
    });

    it('initializes with global focus', () => {
      assert.ok(!manager.isActive());
      assert.strictEqual(manager.currentFocus.scope, FocusScope.GLOBAL);
      assert.strictEqual(manager.currentMode, ChatMode.CONVERSATION);
    });

    it('sets focus successfully', () => {
      const focus = createFileFocus('/src/main.js');
      const result = manager.setFocus(focus);

      assert.ok(result.success);
      assert.ok(manager.isActive());
      assert.strictEqual(manager.currentFocus.path, '/src/main.js');
    });

    it('locks focus', () => {
      manager.setFocus(createFileFocus('/src/main.js'));
      manager.lock(LockState.SOFT, 'Working on feature');

      assert.ok(manager.isLocked);
      assert.strictEqual(manager.lockState, LockState.SOFT);
    });

    it('transitions to project mode', () => {
      const focus = createFileFocus('/src/main.js');
      manager.setFocus(focus);

      const result = manager.transitionTo(ChatMode.PROJECT);

      assert.ok(result.success);
      assert.strictEqual(manager.currentMode, ChatMode.PROJECT);
    });

    it('blocks project transition without focus', () => {
      const result = manager.transitionTo(ChatMode.PROJECT);

      assert.ok(!result.success);
      assert.ok(result.error.includes('Focus required'));
    });

    it('requires confirmation for agent mode', () => {
      const result = manager.transitionTo(ChatMode.AGENT);

      assert.ok(!result.success);
      assert.ok(result.requiresConfirmation);
    });

    it('allows agent transition with confirmation', () => {
      const result = manager.transitionTo(ChatMode.AGENT, { confirmed: true });

      assert.ok(result.success);
      assert.strictEqual(manager.currentMode, ChatMode.AGENT);
    });

    it('enterProject sets focus, mode, and lock', () => {
      const focus = createFileFocus('/src/auth/login.js');
      const result = manager.enterProject(focus, LockState.SOFT, 'Implementing login');

      assert.ok(result.success);
      assert.strictEqual(manager.currentMode, ChatMode.PROJECT);
      assert.ok(manager.isLocked);
      assert.ok(manager.isActive());
    });

    it('exitProject unlocks and returns to conversation', () => {
      manager.enterProject(createFileFocus('/src/main.js'));
      const result = manager.exitProject();

      assert.ok(result.success);
      assert.strictEqual(manager.currentMode, ChatMode.CONVERSATION);
      assert.ok(!manager.isLocked);
    });

    it('tracks transition history', () => {
      manager.setFocus(createFileFocus('/src/main.js'));
      manager.transitionTo(ChatMode.PROJECT);
      manager.transitionTo(ChatMode.AGENT, { confirmed: true });
      manager.transitionTo(ChatMode.CONVERSATION);

      const history = manager.getTransitionHistory();
      assert.strictEqual(history.length, 3);
    });
  });

  describe('TRANSITION_RULES', () => {
    it('defines valid transitions', () => {
      assert.ok(TRANSITION_RULES[ChatMode.CONVERSATION][ChatMode.PROJECT].allowed);
      assert.ok(TRANSITION_RULES[ChatMode.PROJECT][ChatMode.AGENT].allowed);
      assert.ok(TRANSITION_RULES[ChatMode.CONVERSATION][ChatMode.AGENT].requiresConfirmation);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// v44.2 — FÁZE C: Expert Profile Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('v44.2 — FÁZE C: Expert Profile', () => {

  describe('ExpertProfile', () => {
    let expert;

    beforeEach(() => {
      expert = createExpertProfile(
        'security_expert_001',
        'Security Expert',
        [ExpertDomain.SECURITY, ExpertDomain.ARCHITECTURE]
      );
    });

    it('creates expert with domains', () => {
      assert.strictEqual(expert.id, 'security_expert_001');
      assert.strictEqual(expert.name, 'Security Expert');
      assert.ok(expert.domains.includes(ExpertDomain.SECURITY));
    });

    it('tracks confidence history', () => {
      expert.recordResponse(0.9, ExpertDomain.SECURITY, 'auth question');
      expert.recordResponse(0.85, ExpertDomain.SECURITY, 'encryption question');

      const history = expert.getConfidenceHistory();
      assert.strictEqual(history.length, 2);
    });

    it('tracks accepted responses', () => {
      expert.recordResponse(0.9, ExpertDomain.SECURITY);
      expert.recordAcceptance();

      assert.strictEqual(expert.acceptedResponses, 1);
      assert.strictEqual(expert.totalResponses, 1);
      assert.strictEqual(expert.acceptedRate, 1.0);
    });

    it('tracks corrections', () => {
      expert.recordResponse(0.9, ExpertDomain.SECURITY);
      expert.recordCorrection('Wrong recommendation');

      const corrections = expert.getCorrections();
      assert.strictEqual(corrections.length, 1);
      assert.ok(corrections[0].note.includes('Wrong'));
    });

    it('calculates reputation', () => {
      // Record enough responses to calculate reputation
      for (let i = 0; i < 10; i++) {
        expert.recordResponse(0.8, ExpertDomain.SECURITY);
        expert.recordAcceptance();
      }

      const rep = expert.reputation;
      assert.ok(rep >= 0.7); // High acceptance should give good reputation
    });

    it('calculates domain-specific reputation', () => {
      for (let i = 0; i < 5; i++) {
        expert.recordResponse(0.9, ExpertDomain.SECURITY);
        expert.recordAcceptance();
      }

      const securityRep = expert.getDomainReputation(ExpertDomain.SECURITY);
      const generalRep = expert.getDomainReputation(ExpertDomain.GENERAL);

      assert.ok(securityRep > 0.5);
      assert.ok(generalRep <= securityRep); // Less data in general domain
    });

    it('determines confidence level', () => {
      // New expert has unknown confidence
      const newExpert = createExpertProfile('new', 'New Expert');
      assert.strictEqual(newExpert.confidenceLevel, ConfidenceLevel.UNKNOWN);

      // Build up reputation
      for (let i = 0; i < 10; i++) {
        expert.recordResponse(0.95, ExpertDomain.SECURITY);
        expert.recordAcceptance();
      }
      assert.strictEqual(expert.confidenceLevel, ConfidenceLevel.HIGH);
    });
  });

  describe('ExpertArbitrator', () => {
    let arbitrator;
    let securityExpert;
    let archExpert;

    beforeEach(() => {
      arbitrator = createExpertArbitrator();

      securityExpert = createExpertProfile(
        'security_001',
        'Security Expert',
        [ExpertDomain.SECURITY]
      );
      for (let i = 0; i < 10; i++) {
        securityExpert.recordResponse(0.9, ExpertDomain.SECURITY);
        securityExpert.recordAcceptance();
      }

      archExpert = createExpertProfile(
        'arch_001',
        'Architect',
        [ExpertDomain.ARCHITECTURE]
      );
      for (let i = 0; i < 5; i++) {
        archExpert.recordResponse(0.7, ExpertDomain.ARCHITECTURE);
      }

      arbitrator.registerExpert(securityExpert);
      arbitrator.registerExpert(archExpert);
    });

    it('registers and retrieves experts', () => {
      assert.ok(arbitrator.getExpert('security_001'));
      assert.ok(arbitrator.getExpert('arch_001'));
    });

    it('gets experts for domain', () => {
      const securityExperts = arbitrator.getExpertsForDomain(ExpertDomain.SECURITY);
      assert.strictEqual(securityExperts.length, 1);
      assert.strictEqual(securityExperts[0].id, 'security_001');
    });

    it('arbitrates single response', () => {
      const response = createExpertResponse({
        expertId: 'security_001',
        content: 'Use JWT with short expiry',
        confidence: 0.9,
        domain: ExpertDomain.SECURITY,
      });

      const result = arbitrator.arbitrate([response]);

      assert.strictEqual(result.selectedResponse, response);
      assert.strictEqual(result.strategy, 'single');
    });

    it('arbitrates by reputation', () => {
      const responses = [
        createExpertResponse({
          expertId: 'security_001',
          content: 'Security approach',
          confidence: 0.85,
          domain: ExpertDomain.SECURITY,
        }),
        createExpertResponse({
          expertId: 'arch_001',
          content: 'Architecture approach',
          confidence: 0.9, // Higher confidence but lower reputation
          domain: ExpertDomain.SECURITY,
        }),
      ];

      const result = arbitrator.arbitrate(responses, {
        strategy: ArbitrationStrategy.REPUTATION,
        domain: ExpertDomain.SECURITY,
      });

      // Security expert should win due to better reputation
      assert.strictEqual(result.selectedResponse.expertId, 'security_001');
    });

    it('arbitrates by confidence', () => {
      const responses = [
        createExpertResponse({
          expertId: 'security_001',
          content: 'Low confidence answer',
          confidence: 0.6,
          domain: ExpertDomain.SECURITY,
        }),
        createExpertResponse({
          expertId: 'arch_001',
          content: 'High confidence answer',
          confidence: 0.95,
          domain: ExpertDomain.SECURITY,
        }),
      ];

      const result = arbitrator.arbitrate(responses, {
        strategy: ArbitrationStrategy.CONFIDENCE,
      });

      assert.strictEqual(result.selectedResponse.expertId, 'arch_001');
    });

    it('detects conflicts', () => {
      const responses = [
        createExpertResponse({
          expertId: 'security_001',
          content: 'Very confident',
          confidence: 0.95,
          domain: ExpertDomain.SECURITY,
        }),
        createExpertResponse({
          expertId: 'arch_001',
          content: 'Not confident',
          confidence: 0.5,
          domain: ExpertDomain.SECURITY,
        }),
      ];

      const result = arbitrator.arbitrate(responses);

      assert.ok(result.hasConflicts);
      assert.ok(result.conflicts.length > 0);
    });

    it('returns user choice mode', () => {
      const responses = [
        createExpertResponse({
          expertId: 'security_001',
          content: 'Option A',
          confidence: 0.8,
          domain: ExpertDomain.SECURITY,
        }),
        createExpertResponse({
          expertId: 'arch_001',
          content: 'Option B',
          confidence: 0.8,
          domain: ExpertDomain.SECURITY,
        }),
      ];

      const result = arbitrator.arbitrate(responses, {
        strategy: ArbitrationStrategy.USER_CHOICE,
      });

      assert.strictEqual(result.selectedResponse, null);
      assert.strictEqual(result.allResponses.length, 2);
      assert.ok(result.reasoning.includes('Awaiting user'));
    });

    it('converts to tagged response', () => {
      const response = createExpertResponse({
        expertId: 'security_001',
        content: 'Use secure cookies',
        confidence: 0.9,
        domain: ExpertDomain.SECURITY,
      });

      const result = arbitrator.arbitrate([response]);
      const tagged = arbitrator.toTaggedResponse(result, securityExpert);

      assert.strictEqual(tagged.speaker, ResponseSpeaker.EXPERT);
      assert.strictEqual(tagged.mode, ChatMode.EXPERT);
      assert.strictEqual(tagged.tag.metadata.expert_id, 'security_001');
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// v44.3 — FÁZE D: Agent Contract Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('v44.3 — FÁZE D: Agent Contract', () => {

  describe('AgentProgress', () => {
    it('creates progress indicator', () => {
      const progress = new AgentProgress({
        current: 3,
        total: 10,
        phase: 'Building',
        message: 'Compiling sources',
      });

      assert.strictEqual(progress.current, 3);
      assert.strictEqual(progress.total, 10);
      assert.strictEqual(progress.percentage, 30);
      assert.ok(!progress.isComplete);
    });

    it('creates initial progress', () => {
      const progress = AgentProgress.initial(5, 'Starting');

      assert.strictEqual(progress.current, 0);
      assert.strictEqual(progress.total, 5);
      assert.strictEqual(progress.phase, 'Starting');
    });

    it('creates completed progress', () => {
      const progress = AgentProgress.completed(5);

      assert.strictEqual(progress.current, 5);
      assert.ok(progress.isComplete);
    });
  });

  describe('NextAction', () => {
    it('creates continue action', () => {
      const action = NextAction.continue('Processing next batch');

      assert.strictEqual(action.type, ActionType.CONTINUE);
      assert.ok(!action.requiresInput);
    });

    it('creates wait for approval action', () => {
      const action = NextAction.waitApproval('Delete files?', {
        files: ['a.txt', 'b.txt'],
      });

      assert.strictEqual(action.type, ActionType.WAIT_APPROVAL);
      assert.ok(action.requiresInput);
      assert.deepStrictEqual(action.params.files, ['a.txt', 'b.txt']);
    });

    it('creates none action', () => {
      const action = NextAction.none();

      assert.strictEqual(action.type, ActionType.NONE);
      assert.ok(!action.requiresInput);
    });
  });

  describe('LogsReference', () => {
    it('creates logs reference', () => {
      const logs = new LogsReference({
        id: 'log_001',
        path: '/var/logs/agent.log',
        lineCount: 150,
        lastLines: ['Line 1', 'Line 2'],
        hasErrors: true,
        errorCount: 3,
      });

      assert.strictEqual(logs.id, 'log_001');
      assert.strictEqual(logs.lineCount, 150);
      assert.ok(logs.hasErrors);
    });

    it('creates empty reference', () => {
      const logs = LogsReference.empty('log_empty');

      assert.strictEqual(logs.id, 'log_empty');
      assert.strictEqual(logs.lineCount, 0);
    });
  });

  describe('AgentOutputContract', () => {
    it('creates valid output contract', () => {
      const output = new AgentOutputContract({
        agentId: 'builder_001',
        taskId: 'task_build_001',
        status: AgentStatus.RUNNING,
        progress: new AgentProgress({ current: 5, total: 10, phase: 'Building' }),
        nextAction: NextAction.continue(),
        summary: 'Building project...',
      });

      assert.strictEqual(output.agentId, 'builder_001');
      assert.strictEqual(output.status, AgentStatus.RUNNING);
      assert.ok(output.isRunning);
      assert.ok(!output.isComplete);
    });

    it('validates required fields', () => {
      assert.throws(() => new AgentOutputContract({
        agentId: 'test',
        taskId: 'task',
        status: 'invalid_status',
        progress: AgentProgress.initial(1),
        nextAction: NextAction.none(),
        summary: 'Test',
      }), /Invalid status/);
    });

    it('serializes to JSON', () => {
      const output = new AgentOutputContract({
        agentId: 'agent_001',
        taskId: 'task_001',
        status: AgentStatus.COMPLETED,
        progress: AgentProgress.completed(5),
        nextAction: NextAction.none(),
        summary: 'Done',
        artifacts: [{ type: 'file', path: '/output.txt' }],
      });

      const json = output.toJSON();
      assert.strictEqual(json.agent_id, 'agent_001');
      assert.strictEqual(json.status, 'completed');
      assert.strictEqual(json.artifacts.length, 1);
    });
  });

  describe('AgentOutputBuilder', () => {
    it('builds output with fluent API', () => {
      const output = createAgentOutputBuilder('agent_001', 'task_001')
        .status(AgentStatus.RUNNING)
        .progress(3, 10, 'Processing', 'Step 3 of 10')
        .summary('Processing data')
        .build();

      assert.strictEqual(output.status, AgentStatus.RUNNING);
      assert.strictEqual(output.progress.current, 3);
    });

    it('builds running output', () => {
      const output = createAgentOutputBuilder('agent_001', 'task_001')
        .running(5, 10, 'Building', 'Halfway done');

      assert.strictEqual(output.status, AgentStatus.RUNNING);
      assert.strictEqual(output.nextAction.type, ActionType.CONTINUE);
    });

    it('builds completed output', () => {
      const output = createAgentOutputBuilder('agent_001', 'task_001')
        .completed('Task completed successfully', [
          { type: 'report', path: '/report.html' },
        ]);

      assert.ok(output.isComplete);
      assert.strictEqual(output.artifacts.length, 1);
    });

    it('builds failed output', () => {
      const output = createAgentOutputBuilder('agent_001', 'task_001')
        .failed('Connection timeout');

      assert.ok(output.isFailed);
      assert.ok(output.hasErrors);
      assert.ok(output.summary.includes('timeout'));
    });

    it('builds awaiting approval output', () => {
      const output = createAgentOutputBuilder('agent_001', 'task_001')
        .summary('Ready to deploy')
        .awaitingApproval('Deploy to production?', { env: 'prod' });

      assert.ok(output.needsApproval);
      assert.ok(output.nextAction.requiresInput);
    });
  });

  describe('VisibilityFormatter', () => {
    let formatter;
    let sampleOutput;

    beforeEach(() => {
      sampleOutput = new AgentOutputContract({
        agentId: 'agent_001',
        taskId: 'task_001',
        status: AgentStatus.RUNNING,
        progress: new AgentProgress({ current: 5, total: 10, phase: 'Building' }),
        nextAction: NextAction.continue(),
        summary: 'Building the project with all dependencies',
      });
    });

    it('formats hidden output - only errors', () => {
      formatter = createVisibilityFormatter(VisibilityLevel.HIDDEN);
      const result = formatter.format(sampleOutput);

      assert.ok(!result.shouldDisplay); // No errors, don't display
    });

    it('formats hidden output - shows errors', () => {
      const errorOutput = createAgentOutputBuilder('agent_001', 'task_001')
        .failed('Build failed');

      formatter = createVisibilityFormatter(VisibilityLevel.HIDDEN);
      const result = formatter.format(errorOutput);

      assert.ok(result.shouldDisplay);
      assert.ok(result.content.includes('Error'));
    });

    it('formats summarized output', () => {
      formatter = createVisibilityFormatter(VisibilityLevel.SUMMARIZED);
      const result = formatter.format(sampleOutput);

      assert.ok(result.shouldDisplay);
      assert.ok(result.content.includes('RUNNING'));
      assert.ok(result.content.includes('Building'));
    });

    it('formats verbose output', () => {
      formatter = createVisibilityFormatter(VisibilityLevel.VERBOSE);
      const result = formatter.format(sampleOutput);

      assert.ok(result.shouldDisplay);
      assert.ok(result.content.includes('Agent: agent_001'));
      assert.ok(result.content.includes('Task: task_001'));
      assert.ok(result.content.includes('Progress:'));
      assert.ok(result.content.includes('Summary:'));
    });

    it('converts to tagged response', () => {
      formatter = createVisibilityFormatter(VisibilityLevel.SUMMARIZED);
      const tagged = formatter.toTaggedResponse(sampleOutput);

      assert.strictEqual(tagged.speaker, ResponseSpeaker.AGENT);
      assert.strictEqual(tagged.mode, ChatMode.AGENT);
      assert.strictEqual(tagged.tag.metadata.visibility, VisibilityLevel.SUMMARIZED);
    });

    it('changes visibility level', () => {
      formatter = createVisibilityFormatter(VisibilityLevel.HIDDEN);
      assert.strictEqual(formatter.level, VisibilityLevel.HIDDEN);

      formatter.setLevel(VisibilityLevel.VERBOSE);
      assert.strictEqual(formatter.level, VisibilityLevel.VERBOSE);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// v44.x — E2E Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('v44.x — E2E Unification Integration', () => {

  it('complete workflow: chat → project → expert → agent', async () => {
    // 1. Initialize components
    const chatController = createChatController('session_e2e_001');
    const focusManager = createProjectFocusManager('session_e2e_001');
    const arbitrator = createExpertArbitrator();

    // Register security expert
    const securityExpert = createExpertProfile(
      'security_001',
      'Security Expert',
      [ExpertDomain.SECURITY]
    );
    arbitrator.registerExpert(securityExpert);

    // 2. Start in conversation mode
    assert.strictEqual(chatController.currentMode, ChatMode.CONVERSATION);
    assert.strictEqual(focusManager.currentMode, ChatMode.CONVERSATION);

    // 3. User wants to work on auth module
    const authFocus = createModuleFocus('/src/auth');
    const enterResult = focusManager.enterProject(authFocus, LockState.SOFT, 'Implementing auth');

    assert.ok(enterResult.success);
    assert.strictEqual(focusManager.currentMode, ChatMode.PROJECT);
    assert.ok(focusManager.isLocked);

    // 4. User asks security expert for advice
    chatController.switchMode(ChatMode.EXPERT);
    focusManager.transitionTo(ChatMode.EXPERT);

    const expertResponse = createExpertResponse({
      expertId: 'security_001',
      content: 'Use bcrypt for password hashing with cost factor 12',
      confidence: 0.95,
      domain: ExpertDomain.SECURITY,
      reasoning: 'Bcrypt is resistant to GPU attacks',
    });

    const arbitrationResult = arbitrator.arbitrate([expertResponse]);
    const taggedExpertResponse = arbitrator.toTaggedResponse(arbitrationResult, securityExpert);

    assert.strictEqual(taggedExpertResponse.speaker, ResponseSpeaker.EXPERT);
    assert.strictEqual(taggedExpertResponse.confidence, 0.95);

    // 5. User accepts advice, record acceptance
    securityExpert.recordResponse(0.95, ExpertDomain.SECURITY, 'password hashing');
    securityExpert.recordAcceptance();

    // 6. Transition to agent mode for implementation
    focusManager.transitionTo(ChatMode.AGENT, { confirmed: true });
    chatController.switchMode(ChatMode.AGENT);

    assert.strictEqual(focusManager.currentMode, ChatMode.AGENT);

    // 7. Agent produces structured output
    const agentOutput = createAgentOutputBuilder('impl_agent', 'implement_bcrypt')
      .running(1, 3, 'Installing', 'Installing bcrypt package');

    const formatter = createVisibilityFormatter(VisibilityLevel.SUMMARIZED);
    const agentTagged = formatter.toTaggedResponse(agentOutput);

    assert.strictEqual(agentTagged.speaker, ResponseSpeaker.AGENT);
    assert.strictEqual(agentTagged.tag.metadata.status, AgentStatus.RUNNING);

    // 8. Agent completes
    const completedOutput = createAgentOutputBuilder('impl_agent', 'implement_bcrypt')
      .completed('Bcrypt implementation complete', [
        { type: 'file', path: '/src/auth/password.js' },
      ]);

    assert.ok(completedOutput.isComplete);
    assert.strictEqual(completedOutput.artifacts.length, 1);

    // 9. Return to conversation mode
    focusManager.exitProject();
    chatController.switchMode(ChatMode.CONVERSATION);

    assert.strictEqual(focusManager.currentMode, ChatMode.CONVERSATION);
    assert.ok(!focusManager.isLocked);

    // 10. Verify history
    const transitions = focusManager.getTransitionHistory();
    assert.ok(transitions.length >= 4); // conversation → project → expert → agent → conversation

    // 11. Expert reputation should have improved
    assert.strictEqual(securityExpert.acceptedResponses, 1);
    assert.ok(securityExpert.acceptedRate === 1.0);
  });

  it('handles focus lock violations gracefully', () => {
    const manager = createProjectFocusManager('session_lock_001');

    // Enter project with hard lock
    const focus = createFileFocus('/src/critical/payment.js');
    manager.enterProject(focus, LockState.HARD, 'Critical payment code');

    // Try to change focus while hard locked
    const otherFocus = createFileFocus('/src/utils/helpers.js');
    const result = manager.setFocus(otherFocus);

    assert.ok(!result.success);
    assert.ok(result.error.includes('Hard lock'));

    // Unlock and try again
    manager.unlock();
    const result2 = manager.setFocus(otherFocus);
    assert.ok(result2.success);
  });

  it('expert correction affects reputation', () => {
    const expert = createExpertProfile('test_expert', 'Test', [ExpertDomain.GENERAL]);

    // Give many correct responses
    for (let i = 0; i < 10; i++) {
      expert.recordResponse(0.9, ExpertDomain.GENERAL);
      expert.recordAcceptance();
    }
    const repBefore = expert.reputation;

    // Record a correction
    expert.recordResponse(0.9, ExpertDomain.GENERAL);
    expert.recordCorrection('Wrong answer');

    const repAfter = expert.reputation;

    // Reputation should decrease after correction
    assert.ok(repAfter < repBefore);
  });

  it('agent output visibility levels control display', () => {
    const output = createAgentOutputBuilder('agent_001', 'task_001')
      .status(AgentStatus.RUNNING)
      .progress(5, 10, 'Processing')
      .summary('Processing data')
      .build();

    const hiddenFormatter = createVisibilityFormatter(VisibilityLevel.HIDDEN);
    const summaryFormatter = createVisibilityFormatter(VisibilityLevel.SUMMARIZED);
    const verboseFormatter = createVisibilityFormatter(VisibilityLevel.VERBOSE);

    const hiddenResult = hiddenFormatter.format(output);
    const summaryResult = summaryFormatter.format(output);
    const verboseResult = verboseFormatter.format(output);

    // Hidden shouldn't display running status
    assert.ok(!hiddenResult.shouldDisplay);

    // Summary should be shorter than verbose
    assert.ok(summaryResult.content.length < verboseResult.content.length);

    // Verbose should contain detailed info
    assert.ok(verboseResult.content.includes('Agent:'));
    assert.ok(verboseResult.content.includes('Task:'));
    assert.ok(verboseResult.content.includes('Progress:'));
  });
});
