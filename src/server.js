// C.3 v135 Server - p(AI)assistant
// ══════════════════════════════════════════════════════════════════════════════

import './runtime-environment.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import {
  buildServerPortPayload,
  writePrivatePortFile,
} from './server-port-file.js';
import {
  LEGACY_LOCAL_ACCESS_REQUIRED,
  LEGACY_LOCAL_CAPABILITY_HEADER,
  createLegacyLocalCapability,
  evaluateLegacyLocalAccess,
} from './security/legacy-local-access-policy.js';
import { listenOnLegacyLoopback } from './security/legacy-listener-policy.js';
import { applyHttpTimeoutPolicy } from './timeout-policy.js';
import { logger } from './core/logger.js';
import { createProductionObservability } from './observability/production-observability.js';
import {
  configureProductionOutboundPolicy,
  installProductionOutboundGuard,
} from './network/outbound-policy.js';
import { installGlobalHandlers, handleError } from './core/error-handler.js';
import {
  assertM5ProductionConditionalSurfaces,
  isM5ConditionalSurfaceEnabled,
  resolveM5ConditionalSurfaces,
} from './release/conditional-surfaces.js';
import db from './db/database.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyLocalCapability = createLegacyLocalCapability();
let metricsCollector = null;
const productionObservability = createProductionObservability({ logger });
const conditionalSurfaces = resolveM5ConditionalSurfaces({ config });
assertM5ProductionConditionalSurfaces(conditionalSurfaces, {
  production: process.env.NODE_ENV === 'production',
});
configureProductionOutboundPolicy({
  database: db.db,
  logger,
  enabledSurfaces: {
    'model-discovery': isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'model-discovery'),
  },
});
installProductionOutboundGuard();

// Global error handlers (Phase 1 — error-handler.js)
installGlobalHandlers({ logger, exitOnUncaught: false });

// ─── v93: Notification system init (before agent platform) ───────────────────
initNotificationTables(db.db);
const { pipeline: notificationPipeline, router: notificationRouter } = createNotificationPipeline({
  db,
  includeExternal: isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'external-notifications'),
});
// Register additional channels (Email, Telegram, Push already registered by factory)
if (
  isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'external-notifications')
  && !notificationRouter.channels.has('webhook')
) notificationRouter.registerChannel(new WebhookChannel({ logger }));
if (!notificationRouter.channels.has('desktop')) notificationRouter.registerChannel(new DesktopChannel({ logger }));
const notificationEmitter = new NotificationEmitter({ pipeline: notificationPipeline, db: db.db });
setNotificationDeps({ notificationRouter, notificationEmitter });
// Wire lifecycle hooks (lazy import — lifecycle-build may not be loaded yet)
import('./planner/lifecycle-build.js').then(m => m.setNotificationEmitter(notificationEmitter)).catch(() => {});
logger.info('Server', `Notification system initialized (channels: ${notificationRouter.getAvailableChannels().join(', ')})`);

// ─── Optional: Agent Platform v33 (Phase B) ─────────────────────────────────
let AgentRepository, AgentScheduler, AgentRunner, AgentExtensionService;
let createAgentRoutes, createAgentProjectContextBridge, LLMServices, agentProjectContextCapabilityId;
if (config.features.agents !== false) {
  try {
    const repo = await import('./agents/repository.js');
    AgentRepository = repo.AgentRepository;
    repo.initAgentTables(db.db);
    AgentScheduler = (await import('./agents/scheduler.js')).AgentScheduler;
    AgentRunner = (await import('./agents/runner.js')).AgentRunner;
    AgentExtensionService = (await import('./extensions/agent-extension-service.js')).AgentExtensionService;
    createAgentProjectContextBridge = (await import('./extensions/agent-project-context.js')).createAgentProjectContextBridge;
    agentProjectContextCapabilityId = (
      await import('../contracts/m3/extension-v1.js')
    ).EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT;
    createAgentRoutes = (await import('./agents/api.js')).createAgentRoutes;
    LLMServices = (await import('./agents/llm-services.js')).LLMServices;
    logger.info('Server', 'Agent platform loaded (Phase B)');
  } catch (err) {
    logger.warn('Server', `Agent platform not available: ${err.message}`);
  }
} else {
  logger.info('Server', 'Agent platform disabled (C3_ENABLE_AGENTS=false)');
}

// ─── Optional: Expert Layer v35 + v57 (Phase D) ─────────────────────────────
let expertiseLayer = null;
let expertiseStore = null;
let getExpertiseStore = null;
if (config.features.expertises !== false) {
  try {
    const store = await import('./expertises/expertise-store.js');
    getExpertiseStore = store.getExpertiseStore;
  } catch (err) {
    logger.warn('Server', `Expert store not available: ${err.message}`);
  }

  const possiblePaths = [
    './expertises/expertise-layer.js',
    './expertise-layer.js',
    './src/expertises/expertise-layer.js',
  ];
  for (const p of possiblePaths) {
    try {
      expertiseLayer = await import(p);
      logger.info('Server', `Expert layer loaded from ${p}`);
      break;
    } catch (err) {
      logger.debug('Server', `Expert layer not at ${p}: ${err.code || err.message}`);
    }
  }
  if (!expertiseLayer) logger.warn('Server', 'Expert layer not available - file not found');
} else {
  logger.info('Server', 'Expertise platform disabled (C3_ENABLE_EXPERTISES=false)');
}

// v36.9.1: LLM client routed through gateway with auth tokens
import { callWithAuth, llmGateway } from './llm/gateway.js';
import { createAuthToken, LLMCallerRole } from './llm/auth-types.js';

// v57.2: Trust Feedback Loop
import { createTrustRoutes } from './notifications/trust-api.js';
import { getTrustTracker } from './notifications/trust.js';

// v44.0: ChatController - THE ONLY entry point for chat
import { ChatController, ChatMode } from './chat/controller.js';

// v59.0: WebSocket bridge for IDE integration
import { attachWebSocketServer } from './ws-bridge/index.js';
import { setNotificationDeps } from './ws-bridge/session-adapter.js';
import { getDefaultHandlers } from './chat/handlers/index.js';
import {
  setModelRegistry,
  setUpgradeManager,
} from './chat/handlers/pre-handler.js';
import { toolExecutor } from './executor/tool-executor.js';

// H9: Route modules (extracted from server.js)
import { createPlannerRoutes } from './routes/planner.js';
import { createArchitectRoutes } from './routes/architect.js';
import { createAgentPlatformRoutes } from './routes/agents.js';
import { M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS } from './agents/m3-legacy-agent-quarantine.js';
import { createExpertiseRoutes, createLifecycleRoutes } from './routes/expertises.js';
import { createProjectRoutes } from './routes/projects.js';
import { createChatRoutes } from './routes/chat.js';
import { createMiscRoutes } from './routes/misc.js';
import { createSpecialistRoutes } from './routes/specialists.js';
import { createQualityRoutes } from './routes/quality.js';
import { createM2LifecycleRoutes } from './routes/m2-lifecycle.js';
import { createAutonomyRoutes } from './routes/autonomy.js';
import { createSkillRoutes } from './routes/skills.js';
import { createSystemRoutes } from './routes/system.js';
import { createSecurityRoutes, validateApiToken } from './routes/security.js';
import { createPrivacyRoutes } from './routes/privacy.js';
import {
  assertGlobalAuthRouteTable,
  authorizeGlobalRequest,
} from './security/global-auth-policy.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { createMarketplaceRoutes } from './routes/marketplace.js';
import { createMediaRoutes, recoverStuckGenerations } from './routes/media.js';
import { createGovernorRoutes } from './routes/governor.js';
import { createLearningRoutes } from './routes/learning.js';
import { createNotificationPipeline, initNotificationTables } from './notifications/index.js';
import { WebhookChannel } from './notifications/channels/webhook.js';
import { DesktopChannel } from './notifications/channels/desktop.js';
import { NotificationEmitter } from './notifications/emitter.js';
import { skillRegistry } from './skills/registry.js';
import { setSkillEffectAuthority } from './skills/runner.js';
import { skillM2EffectAuthority } from './skills/m2-effect-authority.js';
import { creDecisionEngine } from './chat/cre-decision.js';
import { toolRegistry } from './tools/registry.js';
import { createDefaultM2LifecycleApplicationService } from './lifecycle/m2-lifecycle-application-service.js';
import { createLearningApplicationService } from './memory/learning-application-service.js';
import {
  M5PrivacyAuthorityRepository,
  createM5PrivacyTransportWriterCapability,
} from './security/privacy-authority-repository.js';

// v85: FeatureManager — runtime feature flags (hot-toggle from IDE)
import { featureManager } from './core/feature-manager.js';
featureManager.init(config.features);

// v56.0 Sprint 3: Initialize ConversationStore with DB
import { getConversationStore } from './chat/conversation-store.js';
getConversationStore(db);

// v67.0: Initialize MemoryBank with DB
import { getMemoryBank } from './memory/memory-bank.js';
getMemoryBank(db);

// v86: Initialize LongTermMemory with DB (activates SQLite persistence)
import { longTermMemory } from './memory/long-term.js';
longTermMemory.db = db.db;
longTermMemory.init();
logger.info('Server', 'LongTermMemory initialized (SQLite)');

// v86: Wire preferences engine to LTM for cross-session persistence
import { preferenceEngine } from './memory/preferences.js';
preferenceEngine.longTermMemory = longTermMemory;
preferenceEngine.preferences._ltm = longTermMemory;
preferenceEngine.loadFromMemory(longTermMemory);
logger.info('Server', 'PreferenceEngine loaded from LTM');

// v88: Wire SessionState to projectMemory DB for working memory persistence
import { SessionState } from './chat/controller.js';
SessionState.initProjectMemoryDb(db.projectMemory);

// v86 M2: Wire pattern tracker to LTM for cross-conversation learning
import { patternTracker } from './memory/pattern-tracker.js';
patternTracker.wire(longTermMemory);
logger.info('Server', 'PatternTracker wired to LTM');

// v92: Storage architecture — configurable retention, drain, auto-clean
import { pruneAllData, compactDatabase, autoClean, getStorageConfig } from './db/data-retention.js';
import { drainMessages, validateHistoryIntegrity } from './core/history-drain.js';
import { createStateBackup, pruneBackups } from './core/db-backup.js';

// Resolve data directory (parent of c3.db)
const dataDir = config.db?.path ? path.dirname(path.resolve(config.db.path)) : path.resolve('./data');

// Startup: integrity check → auto-clean → drain → backup
try { validateHistoryIntegrity(dataDir); } catch (_) {}
try {
  const storageConfig = getStorageConfig(db.db);
  autoClean(db.db, dataDir, { config: storageConfig });
  if (storageConfig.drain.enabled) {
    drainMessages(db.db, dataDir, { cutoffHours: storageConfig.drain.cutoff_hours });
  }
  if (storageConfig.backup.on_startup) {
    createStateBackup(db.db, dataDir, {
      dbPath: config.db?.path,
      projectRoot: path.resolve(__dirname, '..'),
    });
    pruneBackups(dataDir, {
      maxDaily: storageConfig.backup.max_daily,
      maxWeekly: storageConfig.backup.max_weekly,
    });
  }
} catch (err) {
  logger.warn('Server', `Startup storage tasks: ${err.message}`);
}

// F1: Setup Wizard — first-run detection + API routes
import { SetupWizard, createSetupRoutes } from './setup/wizard.js';
const setupWizard = new SetupWizard(config.db?.path ? path.dirname(config.db.path) : './data');
setupWizard.load();
const setupComplete = setupWizard.isComplete();
if (!setupComplete) {
  logger.info('Server', 'First run detected — setup wizard available at /api/setup/*');
}

// F2: Auto-updater — background version checker
import { startUpdateChecker, stopUpdateChecker, getCurrentVersion } from './packaging/auto-updater.js';

// v103: Self-Evaluating Model Registry — background upgrade check
import { upgradeManager } from './upgrade/upgrade-manager.js';

// v133: ModelRegistry — centralized model management
import { modelRegistry } from './upgrade/model-registry.js';
import { ModelEvaluationReadModel } from './upgrade/model-evaluation-read-model.js';
import { modelUniverseStore } from './upgrade/model-universe-store.js';
import { createModelFailoverRepository } from './upgrade/model-failover.js';
import {
  createModelFailoverDetectionCoordinator,
  createModelFailoverDetectionInventoryPort,
  createModelFailoverDetectionRepositoryPort,
  startModelFailoverDetectionScheduler,
} from './upgrade/model-failover-coordinator.js';
import {
  createModelBindingApplication,
  createOllamaModelBindingProvider,
  requireModelBindingStartupAuthority,
} from './upgrade/model-binding-application.js';

// Restore every manual binding through the single durable application boundary
// before any LLM call can observe config.models.
upgradeManager.setDb(db.db);
setUpgradeManager(upgradeManager);
modelUniverseStore.setDb(db.db);
const bindingRepository = createModelFailoverRepository(db.db);
const modelEvaluationReadModel = new ModelEvaluationReadModel(db.db);
const { broadcast: bindingBroadcast } = await import('./ws-bridge/ws-server.js');
const modelBindingProvider = createOllamaModelBindingProvider({
  baseUrl: config.ollama?.baseUrl,
  pullImpl: (modelName, onProgress, authority) => (
    upgradeManager.pullModel(modelName, onProgress, authority)
  ),
});
const bindingRuntime = upgradeManager.createBindingRuntimePort();
const modelBindingApplication = createModelBindingApplication({
  repository: bindingRepository,
  runtime: bindingRuntime,
  provider: modelBindingProvider,
  publishControl: payload => bindingBroadcast('control', payload),
  logger,
});
const bindingRehydrate = await modelBindingApplication.rehydrateBindings();
if (bindingRehydrate.legacyRestored > 0 || bindingRehydrate.restored > 0) {
  logger.info(
    'Server',
    `Restored ${bindingRehydrate.restored} manual and ${bindingRehydrate.legacyRestored} legacy model binding(s)`,
  );
}
for (const failure of bindingRehydrate.failed) {
  logger.warn(
    'Server',
    `Model binding rehydrate failed for ${failure.role}: ${failure.code}`,
  );
}
requireModelBindingStartupAuthority({ rehydrate: bindingRehydrate });
const bindingBaselineReconcile = await modelBindingApplication.reconcileConfiguredBindingBaselines();
if (bindingBaselineReconcile.created > 0) {
  logger.info(
    'Server',
    `Persisted ${bindingBaselineReconcile.created} configured model binding baseline(s)`,
  );
}
for (const failure of bindingBaselineReconcile.roles.filter(row => row.outcome === 'FAILED')) {
  logger.warn(
    'Server',
    `Configured model binding baseline failed for ${failure.role}: ${failure.code}`,
  );
}
const bindingStartupAuthority = requireModelBindingStartupAuthority({
  rehydrate: bindingRehydrate,
  baseline: bindingBaselineReconcile,
});
if (bindingStartupAuthority.status === 'DEGRADED') {
  logger.warn(
    'Server',
    `Model binding authority is DEGRADED; decision actionability disabled (${bindingStartupAuthority.reason})`,
  );
}
llmGateway.setBindingStartupAuthority(bindingStartupAuthority);

// Registry metadata client supports factual online discovery only.
try {
  const { registryClient } = await import('./upgrade/registry-client.js');
  registryClient.setDb(db.db);
  registryClient.loadCache();
  logger.info('Server', 'Model registry metadata client initialized');
} catch (err) {
  logger.warn('Server', `Model registry metadata client not available: ${err.message}`);
}

// v120: Phase 3 — metrics collector for empirical model evaluation
try {
  ({ metricsCollector } = await import('./upgrade/metrics-collector.js'));
  metricsCollector.setDb(db.db);
  logger.info('Server', 'Phase 3 metrics collector initialized');
} catch (err) {
  logger.warn('Server', `Phase 3 metrics collector not available: ${err.message}`);
}

// v121.1: L4 Online Discovery — wire with DB and registryClient
try {
  const { onlineDiscovery } = await import('./upgrade/online-discovery.js');
  onlineDiscovery.setDb(db.db);
  try {
    const { registryClient } = await import('./upgrade/registry-client.js');
    onlineDiscovery.setRegistryClient(registryClient);
  } catch (_) {}
  const { setOnlineDiscovery } = await import('./upgrade/model-discovery.js');
  setOnlineDiscovery(onlineDiscovery);
  logger.info('Server', 'L4 Online Discovery initialized');
} catch (err) {
  logger.warn('Server', `L4 Online Discovery not available: ${err.message}`);
}

// v133: Wire ModelRegistry — centralized model management
let modelFailoverDetectionCoordinator = null;
try {
  modelRegistry.init({
    db: db.db,
    upgradeManager,
    modelBindingApplication,
    bindingRepository,
    bindingStartupAuthority,
    modelEvaluationReadModel,
    broadcast: bindingBroadcast,
  });
  setModelRegistry(modelRegistry);
  modelFailoverDetectionCoordinator = createModelFailoverDetectionCoordinator({
    repositoryPort: createModelFailoverDetectionRepositoryPort(bindingRepository),
    inventoryPort: createModelFailoverDetectionInventoryPort(modelBindingProvider),
    readSettings: () => modelRegistry.getModelSettings(),
    readBindings: () => modelRegistry.getBound(),
  });
  // v133: Wire usage tracking to gateway
  llmGateway.setUsageDb(db.db);
  logger.info('Server', 'ModelRegistry initialized (+ gateway usage tracking)');
} catch (err) {
  logger.warn('Server', `ModelRegistry init failed: ${err.message}`);
}

// v135: System Governor — health monitoring
try {
  const { systemGovernor } = await import('./system/governor/system-governor.js');
  systemGovernor.setDb(db.db);
  systemGovernor.setBroadcast((await import('./ws-bridge/ws-server.js')).broadcast);
  logger.info('Server', 'System Governor initialized');
} catch (err) {
  logger.warn('Server', `System Governor not available: ${err.message}`);
}

// F3: License system — feature gates
import { licenseManager, TIERS } from './licensing/license.js';
const licenseStatus = licenseManager.getStatus();
logger.info('Server', `License: ${licenseStatus.tier} (${licenseStatus.valid ? 'valid' : licenseStatus.error || 'no key'})`);

// v57.0: Initialize ExpertStore with DB (if experts enabled)
if (getExpertiseStore) expertiseStore = getExpertiseStore(db);

// M3: data-only expertise extensions share the versioned manifest boundary,
// persist in the existing expertise authority, and receive no host capability.
let expertiseExtensionService = null;
if (expertiseLayer?.expertiseRegistry) {
  try {
    const { ExpertiseExtensionService } = await import('./extensions/expertise-extension-service.js');
    const coreVersion = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    ).version;
    expertiseExtensionService = new ExpertiseExtensionService({
      db: db.db,
      expertiseRegistry: expertiseLayer.expertiseRegistry,
      coreVersion,
    });
    const boot = expertiseExtensionService.boot();
    logger.info(
      'M3Expertise',
      `Loaded ${boot.loaded.length} enabled extension(s); ${boot.quarantined.length} quarantined`,
    );
  } catch (err) {
    logger.warn('M3Expertise', `Extension service unavailable: ${err.message}`);
  }
}

// v74.0: Specialist Loader — discover, install, enable specialist packages
import { getSpecialistLoader } from './specialists/specialist-loader.js';
import { specialistRuntime } from './expertises/specialist-runtime.js';
import { getSpecialistMemory } from './expertises/specialist-memory.js';
import { CapabilityRegistry } from './specialists/capability-registry.js';
// v82: Specialist telemetry — init BEFORE loader.boot() to capture lifecycle events
import { getSpecialistTelemetry } from './telemetry/specialist-telemetry.js';
let specialistLoader = null;
let specialistTelemetry = null;
try {
  // v82: Telemetry init first — must exist before boot() fires lifecycle.boot
  if (config.features.specialistTelemetry) {
    specialistTelemetry = getSpecialistTelemetry(db.db);
    specialistRuntime.setTelemetry(specialistTelemetry);
  }
  specialistLoader = getSpecialistLoader(db.db, specialistRuntime, {
    telemetry: specialistTelemetry,
  });
  // v122: Wire registries BEFORE boot() so specialists can self-register
  if (expertiseLayer?.expertiseRegistry) {
    specialistLoader.setExpertiseRegistry(expertiseLayer.expertiseRegistry);
  }
  const capabilityRegistry = new CapabilityRegistry();
  specialistLoader.setCapabilityRegistry(capabilityRegistry);
  await specialistLoader.boot();
  logger.info('Server', `Specialists: ${specialistLoader.getEnabled().length} enabled`);
  // D4: Initialize persistent specialist memory
  const specialistMemory = getSpecialistMemory(db.db);
  specialistRuntime.setMemory(specialistMemory);
  if (specialistTelemetry) specialistMemory.setTelemetry(specialistTelemetry);
} catch (err) {
  logger.warn('Server', `Specialist loader: ${err.message}`);
}

// v85: Initialize skill registry (graceful empty load)
if (config.features.skills !== false) {
  try {
    const skillsPath = path.join(__dirname, '..', 'skills');
    setSkillEffectAuthority(skillM2EffectAuthority);
    skillRegistry.load(skillsPath, logger);
    logger.info('Server', `Skills: ${skillRegistry.list().length} loaded from ${skillsPath}`);
  } catch (err) {
    logger.warn('Server', `Skill registry: ${err.message}`);
  }
}

// v123: Marketplace — catalog client + package installer
let marketplaceClient = null;
let packageInstaller = null;
if (isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'marketplace')) {
  try {
    const { MarketplaceClient } = await import('./marketplace/marketplace-client.js');
    const { PackageInstaller } = await import('./marketplace/package-installer.js');
    marketplaceClient = new MarketplaceClient(db.db, {
      catalogUrl: config.marketplace?.catalogUrl,
    });
    packageInstaller = new PackageInstaller(db.db, {
      client: marketplaceClient,
      skillRegistry,
      expertiseRegistry: expertiseLayer?.expertiseRegistry || null,
      specialistLoader,
    });
    logger.info('Server', 'Marketplace initialized');
  } catch (err) {
    logger.warn('Server', `Marketplace not available: ${err.message}`);
  }
} else {
  logger.info('Server', 'Marketplace disabled (C3_ENABLE_MARKETPLACE=true to request it)');
}

// v130: ComfyUI multimedia module
let comfyuiConnector = null;
let vramManager = null;
let mediaStorage = null;
if (isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'media-comfyui')) {
  try {
    const { ComfyUIConnector } = await import('./media/comfyui-connector.js');
    const { VRAMManager } = await import('./media/vram-manager.js');
    const { MediaOutputStorage } = await import('./media/output-storage.js');
    comfyuiConnector = new ComfyUIConnector(config.comfyui);
    // v131: Pass GPU info + ComfyUI URL for VRAM-aware coordination
    const { getSystemProfile } = await import('./system/gpu-detector.js');
    const gpuProfile = getSystemProfile();
    const gpuVramMb = gpuProfile.gpus.find(g => !g.is_igpu && g.vram_mb > 0)?.vram_mb || 0;
    vramManager = new VRAMManager({
      ollamaUrl: config.ollama.baseUrl,
      chatModel: config.models.CHAT,
      comfyuiUrl: config.comfyui?.baseUrl || null,
      gpuTotalVramMb: gpuVramMb,
    });
    mediaStorage = new MediaOutputStorage({ maxGB: config.comfyui.maxStorageGB });
    mediaStorage.setDb(db.db);
    mediaStorage.init();
    recoverStuckGenerations(db.db, logger);
    // v131: Startup VRAM audit — detect externally loaded models with wrong context
    try {
      const auditResult = await vramManager.auditOllamaModels();
      logger.info('Server', `VRAM audit: ${auditResult.action} — ${auditResult.details}`);
    } catch (err) {
      logger.warn('Server', `VRAM audit failed (non-fatal): ${err.message}`);
    }
    logger.info('Server', `ComfyUI module initialized (GPU: ${gpuVramMb} MB VRAM)`);
  } catch (err) {
    logger.warn('Server', `ComfyUI module not available: ${err.message}`);
  }
}

// Initialize VRAM-aware num_ctx for the active chat model without delaying
// server startup. Gateway and context compaction share this effective value.
{
  const { initModelNumCtx } = await import('./llm/model-ctx.js');
  const chatModel = config.models.CHAT;
  initModelNumCtx(chatModel, config.ollama.baseUrl).then(numCtx => {
    logger.info('Server', `Model context initialized: ${chatModel} → num_ctx=${numCtx}`);
  }).catch(err => {
    logger.warn('Server', `Model context init failed (non-fatal): ${err.message}`);
  });
}

// Configure ChatController with default handlers
ChatController.configure({
  handlers: getDefaultHandlers(),
  config: {
    autoModeDetection: true,
    modeConfidenceThreshold: 0.6,
  },
});
logger.info('Server', 'ChatController v57.0 configured');

// ════════════════════════════════════════════════════════════════════════════
// v44.0: Wire ToolExecutor to existing tool implementations
// ════════════════════════════════════════════════════════════════════════════

toolExecutor.wireServices({
  // Wire existing toolRegistry tools as services
  searchService: {
    async search(query) {
      const tool = toolRegistry.get('web.search');
      if (!tool) throw new Error('web.search tool not available');
      const result = await tool.execute({ query, maxResults: 5 });
      if (result.error) throw new Error(result.error);
      return { results: result };
    }
  },
  scrapeService: {
    async scrape(url) {
      const tool = toolRegistry.get('web.scrape');
      if (!tool) throw new Error('web.scrape tool not available');
      const result = await tool.execute({ url });
      if (result.error) throw new Error(result.error);
      return result;
    }
  }
});

logger.info('Server', 'ToolExecutor wired to toolRegistry', {
  search: !!toolExecutor.searchService,
  scrape: !!toolExecutor.scrapeService
});

// ─── Agent Platform Init (conditional — Phase B) ───────────────────────────
let agentLLMClient = null;
let agentRepository = null;
let agentRunner = null;
let agentScheduler = null;
let agentRoutes = null;
let agentExtensionService = null;

if (AgentRepository) {
  agentLLMClient = {
    async chat({ model, messages, format, options = {} }) {
      try {
        const token = createAuthToken({
          role: LLMCallerRole.WORKFLOW_THINKER,
          decisionId: `agent_${Date.now()}`,
          auditContext: { sessionId: 'agents' }
        });

        const response = await callWithAuth(token, '', {
          model: model || 'qwen3.5:27b',
          messages,
          format: format === 'json' ? 'json' : undefined,
          temperature: options.temperature ?? 0.3
        });

        return { content: response.content || '' };
      } catch (err) {
        logger.error('AgentLLM', `Error: ${err.message}`);
        return { content: '' };
      }
    }
  };

  agentRepository = new AgentRepository(db.db);
  const llmServices = new LLMServices({ llmClient: agentLLMClient });
  const agentProjectContextBridge = createAgentProjectContextBridge({ projects: db.projects });
  agentExtensionService = new AgentExtensionService({
    repository: agentRepository,
    hostCapabilities: {
      [agentProjectContextCapabilityId]: agentProjectContextBridge.capability,
    },
  });
  agentExtensionService.discover();
  agentRunner = new AgentRunner({
    repository: agentRepository,
    llmServices,
    notificationRouter,
    notificationPipeline,
    extensionService: agentExtensionService,
    projectContextBridge: agentProjectContextBridge,
  });
  agentScheduler = new AgentScheduler({
    repository: agentRepository,
    runner: agentRunner,
    executionAuthority: agent => {
      try {
        agentExtensionService.resolveExecution(agent);
        return true;
      } catch {
        return false;
      }
    },
  });
  agentExtensionService.attachScheduler(agentScheduler);
  agentRoutes = createAgentRoutes({
    repository: agentRepository,
    scheduler: agentScheduler,
    executor: agentRunner,
    llmClient: agentLLMClient
  });
  logger.info('Server', 'Agent platform initialized (Phase B)');
} else {
  logger.info('Server', 'Agent platform skipped (disabled or not available)');
}

// ════════════════════════════════════════════════════════════════════════════
// REQUEST HELPERS
// ════════════════════════════════════════════════════════════════════════════

const MAX_BODY_SIZE = config.limits.maxBodySize;

// H1: Error sanitization — never leak internal error details to clients
function safeError(err) {
  const id = `E-${Date.now().toString(36)}`;
  logger.error('Server', `[${id}] ${err.message}`, { stack: err.stack });
  const payload = { error: 'Internal server error', errorId: id };
  if (config.log?.level === 'debug') payload.detail = err.message;
  return payload;
}

// H7: Safe parseInt — returns parsed number or throws for invalid input
function safeParseInt(val, name = 'id') {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw Object.assign(new Error(`Invalid ${name}: ${val}`), { statusCode: 400 });
  return n;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        tooLarge = true;
        body = '';
        reject(new Error(`Request body too large (max ${Math.round(MAX_BODY_SIZE/1024/1024)}MB)`));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

function getCorsOrigin(req) {
  const origin = req?.headers?.origin;
  const allowed = config.server.allowedOrigins;
  if (!allowed.length) return null; // no origins configured → deny all cross-origin
  if (allowed.includes(origin)) return origin;
  return null; // blocked
}

// H2: Security headers — applied to all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:",
};
const CORS_VARY = [
  'Origin',
  'Access-Control-Request-Headers',
  LEGACY_LOCAL_CAPABILITY_HEADER,
  'Sec-Fetch-Site',
].join(', ');

function sendJSON(res, status, data, req = null) {
  productionObservability.observeResponse(res, { statusCode: status, payload: data });
  const corsOrigin = res._corsOrigin || getCorsOrigin(req);
  const headers = {
    'Content-Type': 'application/json',
    Vary: CORS_VARY,
    ...SECURITY_HEADERS,
  };
  if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function sendHTML(res, html, req = null) {
  const corsOrigin = res._corsOrigin || getCorsOrigin(req);
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    Vary: CORS_VARY,
    ...SECURITY_HEADERS,
  };
  if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
  res.writeHead(200, headers);
  res.end(html);
}

// Mock Express-style response for agent routes
function createMockResponse(res) {
  return {
    json: (data) => sendJSON(res, 200, data),
    status: (code) => ({
      json: (data) => sendJSON(res, code, data)
    })
  };
}

async function sendStaticFile(res, filepath, contentType) {
  try {
    const fsPromises = await import('fs/promises');

    // H5: Path traversal guard — all candidate paths must resolve within allowed base dirs
    const baseDirs = [
      path.resolve(__dirname, '..'),   // project root
      path.resolve(process.cwd()),     // cwd
    ];

    const pathsToTry = [
      path.join(__dirname, '..', filepath),           // From src/../filepath
      path.join(__dirname, filepath.replace(/^src\//, '')),  // From src/filepath without src prefix
      path.join(process.cwd(), filepath)              // From cwd/filepath
    ];

    for (const fullPath of pathsToTry) {
      const resolved = path.resolve(fullPath);
      if (!baseDirs.some(base => resolved.startsWith(base + path.sep) || resolved === base)) {
        logger.warn('Server', `Path traversal blocked: ${filepath} → ${resolved}`);
        continue;
      }
      try {
        const content = await fsPromises.readFile(fullPath, 'utf-8');
        const headers = {
          'Content-Type': contentType + '; charset=utf-8',
          'Cache-Control': 'no-cache',
          Vary: CORS_VARY,
          ...SECURITY_HEADERS,
        };
        if (res._corsOrigin) {
          headers['Access-Control-Allow-Origin'] = res._corsOrigin;
        }
        res.writeHead(200, headers);
        res.end(content);
        return;
      } catch (err) {
        // Expected: trying multiple paths
        logger.debug('Server', `Static file not at ${fullPath}: ${err.code}`);
      }
    }
    
    // None found
    throw new Error(`File not found: ${filepath}`);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

async function getArchitectUIHTML() {
  try {
    const fsPromises = await import('fs/promises');
    // Use __dirname (relative to server.js in src/) to find ui/architect/
    const htmlPath = path.join(__dirname, 'ui/architect/architect.html');
    return await fsPromises.readFile(htmlPath, 'utf-8');
  } catch (err) {
    logger.warn('Server', `Architect UI not found at expected path: ${err.message}`);
    return `<!DOCTYPE html>
<html>
<head><title>C.3 Architect</title></head>
<body style="background: #0f0f0f; color: white; font-family: sans-serif; padding: 40px;">
<h1>🏗️ Architect Mode</h1>
<p>UI files not found. Make sure src/ui/architect/ exists.</p>
<p style="color: #666; font-size: 12px;">Expected: ${path.join(__dirname, 'ui/architect/architect.html')}</p>
</body>
</html>`;
  }
}

// H3: Architect sessions with TTL — prevents unbounded memory growth
const ARCHITECT_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours
const ARCHITECT_MAX_SESSIONS = 20;
const architectSessions = new Map(); // key → { orchestrator, lastAccess }

function getArchitectSession(key) {
  const entry = architectSessions.get(key);
  if (entry) entry.lastAccess = Date.now();
  return entry?.orchestrator || null;
}

function setArchitectSession(key, orchestrator) {
  // Evict oldest if at capacity
  if (architectSessions.size >= ARCHITECT_MAX_SESSIONS && !architectSessions.has(key)) {
    let oldest = null, oldestKey = null;
    for (const [k, v] of architectSessions) {
      if (!oldest || v.lastAccess < oldest) { oldest = v.lastAccess; oldestKey = k; }
    }
    if (oldestKey) architectSessions.delete(oldestKey);
  }
  architectSessions.set(key, { orchestrator, lastAccess: Date.now() });
}

// Cleanup stale sessions every 30 minutes
const architectCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of architectSessions) {
    if (now - entry.lastAccess > ARCHITECT_SESSION_TTL) {
      architectSessions.delete(key);
      logger.debug('Server', `Evicted stale architect session: ${key}`);
    }
  }
}, 30 * 60 * 1000);
architectCleanupInterval.unref(); // Don't prevent process exit

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// v44.5: server.js = transport & wiring ONLY
// All logic goes through ChatController → handlers/ → CRE → ToolExecutor
// ════════════════════════════════════════════════════════════════════════════
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  🛑 ARCHITECTURAL INVARIANT - DO NOT VIOLATE                              ║
// ╠═══════════════════════════════════════════════════════════════════════════╣
// ║  server.js MUST NOT contain:                                              ║
// ║  ❌ intent classification (classifyIntent, detectIntent, etc.)            ║
// ║  ❌ LLM calls (llmCall, callOllama, generateResponse, etc.)               ║
// ║  ❌ fallback logic ("if error, try X")                                    ║
// ║  ❌ expert/project decisions                                               ║
// ║  ❌ semantic routing (switch on intent type)                               ║
// ║                                                                           ║
// ║  server.js MAY ONLY:                                                      ║
// ║  ✅ parse HTTP request                                                    ║
// ║  ✅ create context object                                                 ║
// ║  ✅ call ChatController.handle()                                          ║
// ║  ✅ return HTTP response                                                  ║
// ║                                                                           ║
// ║  If you think "just this one special case..." → STOP                      ║
// ║  Put it in handlers/ modules or CRE. That's what they're for.                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//

// v63.0: Wizard-specific rate limiter (🔴2)
const _wizardRateLimits = new Map();
function checkWizardRateLimit(key, intervalMs) {
  const now = Date.now();
  const last = _wizardRateLimits.get(key) || 0;
  if (now - last < intervalMs) return false;
  _wizardRateLimits.set(key, now);
  return true;
}

// H9: Build deps object for route modules
const routeDeps = {
  db, parseBody, sendJSON, sendHTML, sendStaticFile, safeError, safeParseInt,
  logger, config, path, fs, randomUUID,
  ChatController, expertiseLayer, expertiseStore, expertiseExtensionService,
  callWithAuth, createAuthToken, LLMCallerRole,
  getArchitectSession, setArchitectSession, getArchitectUIHTML,
  createMockResponse, agentRoutes, agentRunner, agentExtensionService,
  checkWizardRateLimit,
  specialistLoader, specialistRuntime, specialistTelemetry,
  notificationRouter, notificationEmitter,
  comfyuiConnector, vramManager, mediaStorage,
  modelRegistry, modelBindingApplication,
  conditionalSurfaces,
};

// M2 small-project-change is the only effect-capable lifecycle surface. The
// route overlay below also retires legacy mutators, so construct and census its
// durable authority before accepting HTTP commands.
const m2LifecycleService = createDefaultM2LifecycleApplicationService({
  database: db.db,
  projects: db.projects,
});
const learningService = createLearningApplicationService({
  repository: db.learningAuthority,
  projects: db.projects,
});
const privacyAuthority = new M5PrivacyAuthorityRepository(db.db, {
  writerCapability: createM5PrivacyTransportWriterCapability(),
});
routeDeps.productionObservability = productionObservability;
routeDeps.m2LifecycleService = m2LifecycleService;
let m2RecoveryFailureCount = 0;
async function runM2StartupRecoveryCensus() {
  try {
    const recovered = await m2LifecycleService.recoverIncompleteSmallProjectChanges();
    m2RecoveryFailureCount = 0;
    if (recovered.length > 0) {
      logger.info('M2Lifecycle', `Recovered ${recovered.length} durable lifecycle operation(s)`);
    }
  } catch (error) {
    // A previous process may still own an unexpired fencing lease immediately
    // after a crash. Keep the public lifecycle fail-closed and retry the
    // durable census; never convert uncertainty into a clean terminal.
    m2RecoveryFailureCount += 1;
    if (m2RecoveryFailureCount === 1 || m2RecoveryFailureCount % 30 === 0) {
      logger.error('M2Lifecycle', `Startup recovery did not converge: ${error?.code || error?.message || error}`);
    }
    const retryTimer = setTimeout(runM2StartupRecoveryCensus, 1_000);
    retryTimer.unref?.();
  }
}
await runM2StartupRecoveryCensus();

// v93: notificationRouter + notificationPipeline initialized above (before agent platform)

// One health handler, referenced by all three paths. Previously the two aliases
// were closures doing a runtime lookup into `routes`; the endpoints are
// unchanged, only the indirection is gone.
function healthHandler(req, res) {
  let databaseReady = false;
  try {
    databaseReady = db.db.prepare('SELECT 1 AS ready').get()?.ready === 1;
  } catch { /* health stays degraded without exposing storage details */ }
  const lifecycleRecovery = m2LifecycleService.getRecoveryCensusStatus();
  const ready = databaseReady && lifecycleRecovery.complete;
  sendJSON(res, 200, {
    name: 'p(AI)assistant',
    version: getCurrentVersion(),
    status: ready ? 'ok' : 'degraded',
    ready,
    health: {
      database: databaseReady,
      lifecycleRecovery: lifecycleRecovery.complete,
    },
    setupComplete,
    limits: config.limits,
    endpoints: [
      'POST /chat',
      'POST /planner/start',
      'GET /api/global-memory',
      'GET /architect',
      'GET /expertises',
      'GET /agents',
      'GET /chat-ui',
      'POST /api/m2/lifecycle/prepare',
      'GET /api/debug/modules (C3_TRACE=1)',
    ],
  });
}
routeDeps.healthHandler = healthHandler;

const routes = {
  'GET /': healthHandler,
  'GET /api/health': healthHandler,
  'GET /health': healthHandler,

  // H9: Spread route modules
  ...createChatRoutes(routeDeps),
  ...createPlannerRoutes(routeDeps),
  ...createArchitectRoutes(routeDeps),
  ...createAgentPlatformRoutes(routeDeps),
  ...createExpertiseRoutes(routeDeps),
  ...createLifecycleRoutes(routeDeps),
  ...createProjectRoutes(routeDeps),
  // Spread last among lifecycle/project routes: the returned map contains the
  // authoritative M2 endpoints and a typed 410 overlay for every legacy
  // lifecycle mutator.
  ...createM2LifecycleRoutes({
    m2LifecycleService,
    parseBody,
    sendJSON,
    safeError,
  }),
  ...createLearningRoutes({
    learningService,
    parseBody,
    sendJSON,
    safeError,
  }),
  ...createMiscRoutes(routeDeps),
  ...createSpecialistRoutes(routeDeps),
  ...createQualityRoutes(routeDeps),

  // v83: Autonomy routes (only when enabled)
  ...(config.features.autonomy
    ? createAutonomyRoutes({ ...routeDeps, creEngine: creDecisionEngine })
    : {}),

  // v85: Skill routes (only when enabled)
  ...(config.features.skills !== false
    ? createSkillRoutes(routeDeps)
    : {}),

  // v87: System routes (GPU, model compatibility, diagnostics)
  ...createSystemRoutes(routeDeps),

  // v91: Security routes (auth guard, API tokens, audit, webhook)
  ...createSecurityRoutes(routeDeps),
  ...createPrivacyRoutes({
    privacyAuthority,
    parseBody,
    sendJSON,
    safeError,
  }),

  // v87: Notification routes (channels, test, log)
  ...createNotificationRoutes({ ...routeDeps, notificationRouter }),

  // v123: Marketplace routes
  ...createMarketplaceRoutes({ ...routeDeps, marketplaceClient, packageInstaller }),

  // v130: Multimedia generation routes (ComfyUI)
  ...(comfyuiConnector ? createMediaRoutes(routeDeps) : {}),

  // v135: System Governor routes
  ...createGovernorRoutes(routeDeps),

  // F1: Setup Wizard routes (always available — idempotent after completion)
  ...createSetupRoutes(setupWizard, routeDeps),

  // F3: License status API
  'GET /api/license/status': (req, res) => {
    const status = licenseManager.getStatus();
    sendJSON(res, 200, {
      tier: status.tier,
      valid: status.valid,
      features: status.features,
      expiresAt: status.expiresAt || null,
      owner: status.owner || null,
    });
  },
};

// ─── Guard agent routes if platform not loaded ──────────────────────────────
if (!agentRoutes) {
  const notAvailable = (req, res) => sendJSON(res, 501, {
    error: 'Agent platform not available (C3_ENABLE_AGENTS=false)'
  });
  const retiredLegacyMutators = new Set(M3_LEGACY_AGENT_MUTATING_ROUTE_KEYS);
  for (const key of Object.keys(routes)) {
    if (!retiredLegacyMutators.has(key) &&
        (key.includes('/api/agents') || key.includes('/api/agent-extensions') || key === 'GET /agents' ||
        key.includes('/api/sources/') || key.includes('/api/notifications') ||
        key.includes('/api/scheduler'))) {
      routes[key] = notAvailable;
    }
  }
}

// F3: License feature gates — agents available on all tiers (v92.1)

// ═══ Trust Feedback Loop API (v57.2) ═════════════════════════════════════════
// Initialize trust tracker singleton with raw DB, then mount routes
getTrustTracker(db.db);
const trustRoutes = createTrustRoutes({ db: db.db, sendJSON, parseBody });
Object.assign(routes, trustRoutes);

// ════════════════════════════════════════════════════════════════════════════
// DEBUG: Runtime Module Tracer (activate: C3_TRACE=1 or --import ./src/core/tracer-register.mjs)
// ════════════════════════════════════════════════════════════════════════════

if (process.env.C3_TRACE === '1' || globalThis.__c3_tracer) {
  routes['GET /api/debug/modules'] = (req, res) => {
    if (globalThis.__c3_tracer) {
      sendJSON(res, 200, globalThis.__c3_tracer.getReport());
    } else {
      // Fallback: list statically known files
      import('fs').then(fs => import('path').then(path => {
        const srcDir = path.dirname(new URL(import.meta.url).pathname);
        const files = [];
        function walk(dir, base = '') {
          for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const rel = base ? `${base}/${entry}` : entry;
            if (fs.statSync(full).isDirectory()) {
              if (!entry.startsWith('.') && entry !== 'node_modules' && entry !== '_archive') {
                walk(full, rel);
              }
            } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
              files.push(rel);
            }
          }
        }
        walk(srcDir);
        sendJSON(res, 200, { source: 'filesystem', totalFiles: files.length, files });
      }));
    }
  };

  routes['GET /api/debug/health'] = (req, res) => {
    sendJSON(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      tracer: !!globalThis.__c3_tracer,
      nodeVersion: process.version,
    });
  };

  logger.info('Server', 'Debug endpoints enabled: /api/debug/modules, /api/debug/health');
}

// ════════════════════════════════════════════════════════════════════════════
// EXPERT PERSISTENCE HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Create custom_expertises table if not exists (v69: renamed from custom_experts)
try {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS custom_expertises (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  logger.warn('Server', `Could not create custom_expertises table: ${err.message}`);
}

// Load custom experts on startup
function loadCustomExpertises() {
  if (!expertiseLayer) return;
  
  try {
    const rows = db.db.prepare('SELECT id, config FROM custom_expertises').all();
    let loaded = 0;
    for (const row of rows) {
      // M3 rows use the durable expertises-table envelope. A legacy copy must
      // never reactivate a disabled/removed extension during startup.
      if (expertiseExtensionService?.get(row.id)) continue;
      const config = JSON.parse(row.config);
      expertiseLayer.expertiseRegistry.addCustom(config);
      loaded += 1;
    }
    logger.info('Server', `Loaded ${loaded} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not load custom experts: ${err.message}`);
  }
}

// Save custom experts
function saveCustomExpertises() {
  if (!expertiseLayer) return;
  
  try {
    const experts = expertiseLayer.expertiseRegistry.getCustom();
    
    // Clear existing
    db.db.exec('DELETE FROM custom_expertises');

    // Insert all
    const insert = db.db.prepare('INSERT INTO custom_expertises (id, config) VALUES (?, ?)');
    for (const expert of experts) {
      if (expertiseExtensionService?.get(expert.id)) continue;
      insert.run(expert.id, JSON.stringify(expert.toJSON()));
    }
    
    logger.debug('Server', `Saved ${experts.length} custom experts`);
  } catch (err) {
    logger.warn('Server', `Could not save custom experts: ${err.message}`);
  }
}

// Load custom experts on startup
loadCustomExpertises();

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

function matchRoute(method, url) {
  const key = `${method} ${url}`;
  
  // Exact match
  if (routes[key]) {
    return { handler: routes[key], params: {}, routeKey: key };
  }
  
  // Pattern match (with :param)
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(' ');
    
    if (routeMethod !== method) continue;
    
    // Convert pattern to regex
    const paramNames = [];
    const regexStr = routePath.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    
    const regex = new RegExp(`^${regexStr}$`);
    const match = url.match(regex);
    
    if (match) {
      const params = {};
      try {
        paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
      } catch {
        return null; // Malformed URI component → 404
      }
      return { handler, params, routeKey: pattern };
    }
  }
  
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVER
// ════════════════════════════════════════════════════════════════════════════

// ── Rate limiter (v125: disabled on localhost, tiered on network) ─────────
//
// Like Ollama, local dev tools don't rate-limit localhost — the user IS the
// only client. Rate limiting only activates when C3_HOST binds to a network
// interface (0.0.0.0, LAN IP, etc.).
//
const _rateLimitEnabled = config.server.host !== '127.0.0.1' && config.server.host !== 'localhost';
const _rateBuckets = new Map();

/**
 * Classify endpoint into rate-limit tier.
 * @returns {number} 0=exempt, 1=read, 2=write
 */
function classifyEndpoint(method, pathname) {
  if (method === 'OPTIONS') return 0;
  if (pathname === '/api/health') return 0;
  if (method === 'GET') return 1;
  return 2; // POST, PUT, DELETE
}

/**
 * Get client IP with optional proxy header trust.
 */
function getClientIp(req) {
  if (config.server.rateLimit.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    const realIp = req.headers['x-real-ip'];
    if (realIp) return realIp.trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip, tier) {
  if (!_rateLimitEnabled) return true; // localhost — no limit
  if (tier === 0) return true; // exempt endpoints
  const { windowMs, readMaxRequests, writeMaxRequests } = config.server.rateLimit;
  const maxRequests = tier === 1 ? readMaxRequests : writeMaxRequests;
  const key = `${ip}:${tier}`;
  const now = Date.now();
  let bucket = _rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    _rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= maxRequests;
}
// Cleanup stale buckets every 5 minutes (only when rate limiting is active)
if (_rateLimitEnabled) {
  setInterval(() => {
    const cutoff = Date.now() - config.server.rateLimit.windowMs * 2;
    for (const [key, b] of _rateBuckets) {
      if (b.start < cutoff) _rateBuckets.delete(key);
    }
  }, 300_000).unref();
}

assertGlobalAuthRouteTable(routes);

const server = http.createServer(async (req, res) => {
  const httpObservation = productionObservability.beginHttpRequest(req, res);
  const address = server.address();
  const access = evaluateLegacyLocalAccess({
    host: req.headers.host,
    expectedPort: (
      address
      && typeof address === 'object'
      && Number.isInteger(address.port)
    ) ? address.port : null,
    remoteAddress: req.socket.remoteAddress,
    origin: req.headers.origin,
    allowedOrigins: config.server.allowedOrigins,
    expectedCapability: legacyLocalCapability,
    presentedCapability:
      req.headers[LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase()],
    fetchSite: req.headers['sec-fetch-site'],
    preflight: req.method === 'OPTIONS',
    requestedHeaders: req.headers['access-control-request-headers'],
  });
  if (!access.allowed) {
    httpObservation.setRoute('LOCAL_ACCESS');
    productionObservability.markFailure(res, access.reasonCode || LEGACY_LOCAL_ACCESS_REQUIRED);
    logger.warn('Server', 'Legacy local HTTP request rejected', {
      reasonCode: access.reasonCode,
      method: req.method,
      remoteAddress: req.socket.remoteAddress,
    });
    req.resume();
    res.writeHead(403, {
      'Content-Type': 'application/json',
      Vary: CORS_VARY,
      ...SECURITY_HEADERS,
    });
    return res.end(JSON.stringify({
      error: 'Local access boundary rejected the request.',
      code: LEGACY_LOCAL_ACCESS_REQUIRED,
    }));
  }

  const requestOrigin = req.headers.origin;
  res._corsOrigin = (
    requestOrigin === 'null'
    || (
      typeof requestOrigin === 'string'
      && requestOrigin.startsWith('file:')
    )
  ) ? 'null' : (requestOrigin || null);
  res.setHeader('Vary', CORS_VARY);
  if (res._corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', res._corsOrigin);
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    httpObservation.setRoute('OPTIONS *');
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        `Content-Type, Authorization, X-Admin-Token, ${LEGACY_LOCAL_CAPABILITY_HEADER}`,
      Vary: CORS_VARY,
      ...SECURITY_HEADERS,
    };
    if (res._corsOrigin) {
      headers['Access-Control-Allow-Origin'] = res._corsOrigin;
    }
    res.writeHead(204, headers);
    return res.end();
  }

  let pathname;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    pathname = url.pathname;
  } catch {
    httpObservation.setRoute('MALFORMED_URL');
    return sendJSON(res, 400, { error: 'Malformed URL', code: 'HTTP_URL_INVALID' });
  }

  // Rate limiting (v125: tiered)
  const clientIp = getClientIp(req);
  const rateTier = classifyEndpoint(req.method, pathname);
  if (!checkRateLimit(clientIp, rateTier)) {
    httpObservation.setRoute('RATE_LIMITED');
    res.setHeader('Retry-After', '60');
    return sendJSON(res, 429, { error: 'Too many requests', code: 'HTTP_RATE_LIMITED' });
  }

  logger.debug('Server', `${req.method} ${pathname}`);

  const route = matchRoute(req.method, pathname);

  if (!route) {
    httpObservation.setRoute('UNMATCHED');
    return sendJSON(res, 404, { error: 'Not found', code: 'HTTP_ROUTE_NOT_FOUND' });
  }
  httpObservation.setRoute(route.routeKey);

  const authorization = authorizeGlobalRequest({
    routeKey: route.routeKey,
    headers: req.headers,
    remoteAddress: req.socket.remoteAddress,
    localCapability: legacyLocalCapability,
    adminToken: process.env.C3_ADMIN_TOKEN,
    validateApiToken: token => validateApiToken(db.db, token),
  });
  if (!authorization.allowed) {
    req.resume();
    if (authorization.status === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="IntentSmith"');
    }
    return sendJSON(res, authorization.status, {
      error: authorization.status === 403
        ? 'The authenticated credential does not grant this operation'
        : 'Authentication is required for this operation',
      code: authorization.code,
      routeClass: authorization.routeClass || null,
    });
  }
  req.authenticatedSubject = authorization.subject;
  req.authenticatedCredentialType = authorization.credentialType;
  httpObservation.setCredentialType(authorization.credentialType);

  try {
    await route.handler(req, res, route.params);
  } catch (err) {
    if (err.message?.startsWith('Request body too large')) {
      return sendJSON(res, 413, { error: err.message, code: 'HTTP_BODY_TOO_LARGE' });
    }
    if (err.message === 'Invalid JSON in request body') {
      return sendJSON(res, 400, { error: 'Invalid JSON in request body', code: 'HTTP_BODY_INVALID_JSON' });
    }
    if (err.statusCode) {
      return sendJSON(res, err.statusCode, { error: err.message, code: err.code || 'HTTP_REQUEST_FAILED' });
    }
    logger.error('Server', `Handler error: ${err.message}`);
    sendJSON(res, 500, { ...safeError(err), code: 'HTTP_HANDLER_FAILED' });
  }
});

// Keep slow-request protection finite. Long LLM generation is governed by the
// gateway's per-role timeout and is not extended by disabling requestTimeout.
applyHttpTimeoutPolicy(server, config.server.httpTimeouts);

// ════════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════════

listenOnLegacyLoopback(server, config.server, async () => {
  // Only exact M3 extension instances pass the scheduler execution authority.
  // Existing legacy rows remain readable but cannot be scheduled or executed.
  if (agentScheduler) agentScheduler.start();

  // v59.0: Attach WebSocket server for IDE integration
  attachWebSocketServer(server, ChatController, logger, {
    allowedOrigins: config.server.allowedOrigins,
    localCapability: legacyLocalCapability,
    adminToken: process.env.C3_ADMIN_TOKEN,
    validateApiToken: token => validateApiToken(db.db, token),
    production: process.env.NODE_ENV === 'production',
    m1WireSupported: true,
  });
  modelBindingApplication.startBackgroundVerification();

  // Phase C1: Preload active workflow sessions into RAM cache
  try {
    const { preloadActiveSessions } = await import('./chat/handlers/session-resume.js');
    const count = preloadActiveSessions();
    if (count > 0) logger.info('Server', `Preloaded ${count} active workflow sessions`);
  } catch (err) {
    logger.debug('Server', `Session preload skipped: ${err.message}`);
  }

  // C1: Preload active lifecycle handoff states from DB (crash recovery)
  try {
    const { lifecycleHandoffState, lifecycles: lcRepo } = await import('./db/database.js');
    const { initLifecycleStateDb, preloadActiveLifecycles } = await import('./chat/handlers/lifecycle-state.js');
    initLifecycleStateDb(lifecycleHandoffState, lcRepo);
    const lcCount = preloadActiveLifecycles();
    if (lcCount > 0) logger.info('Server', `Preloaded ${lcCount} active lifecycle handoff states`);
  } catch (err) {
    logger.debug('Server', `Lifecycle handoff preload skipped: ${err.message}`);
  }

  // Auto-discover projects in default projects directory on startup
  try {
    const { projects: projectsRepo } = await import('./db/database.js');
    const projectsDir = path.resolve(config.projects.defaultDir);

    if (fs.existsSync(projectsDir)) {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      let discovered = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = path.join(projectsDir, entry.name);

        // Read description from .c3/project.json if available
        let desc = entry.name;
        try {
          const c3 = JSON.parse(fs.readFileSync(path.join(projectPath, '.c3', 'project.json'), 'utf8'));
          desc = c3.description || c3.name || entry.name;
        } catch { /* no .c3 metadata */ }

        // getOrCreate registers new projects and fixes auto-generated names (lc-xxx) on existing ones
        const before = projectsRepo.findByPath.get(projectPath);
        projectsRepo.getOrCreate(entry.name, projectPath, desc);
        if (!before) discovered++;
      }

      if (discovered > 0) {
        logger.info('Server', `Auto-discovered ${discovered} project(s) in ${projectsDir}`);
      }
    }
  } catch (err) {
    logger.debug('Server', `Project auto-discovery skipped: ${err.message}`);
  }

  // v64.0: Bind CRE Gatekeeper audit DB
  try {
    const { creOverrideLog } = await import('./db/database.js');
    const { creDecisionEngine } = await import('./chat/cre-decision.js');
    creDecisionEngine.bindAuditDb(creOverrideLog);
    logger.info('Server', 'CRE Gatekeeper audit DB bound');
  } catch (err) {
    logger.debug('Server', `CRE audit DB bind skipped: ${err.message}`);
  }

  // v83: Autonomy background loop
  if (config.features.autonomy) {
    try {
      const { restoreThreshold, runAutonomyCycle } = await import('./autonomy/controller.js');

      // Restore last applied threshold from DB (survives restarts)
      restoreThreshold(db, creDecisionEngine, logger);

      const autonomyInterval = setInterval(() => {
        try {
          runAutonomyCycle(db, creDecisionEngine, logger);
        } catch (err) {
          logger.debug('Autonomy', `Cycle error: ${err.message}`);
        }
      }, config.autonomy.intervalMs);
      autonomyInterval.unref();
      logger.info('Server', `Autonomy loop started (${config.autonomy.intervalMs / 1000}s interval)`);
    } catch (err) {
      logger.debug('Server', `Autonomy init skipped: ${err.message}`);
    }
  }

  // v92: Configurable auto-clean + drain interval
  {
    const storageConfig = getStorageConfig(db.db);
    const cleanIntervalMs = (storageConfig.clean.interval_hours || 24) * 60 * 60 * 1000;

    if (storageConfig.clean.enabled) {
      const cleanInterval = setInterval(() => {
        try {
          const cfg = getStorageConfig(db.db); // re-read for hot config changes
          autoClean(db.db, dataDir, { config: cfg });
          if (cfg.drain.enabled) {
            drainMessages(db.db, dataDir, { cutoffHours: cfg.drain.cutoff_hours });
          }
        } catch (_) {}
      }, cleanIntervalMs);
      cleanInterval.unref();
      logger.info('Server', `Auto-clean scheduled (every ${storageConfig.clean.interval_hours}h)`);
    }

    // Weekly compact (independent of auto-clean)
    const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
    const weeklyCompact = setInterval(() => {
      try { compactDatabase(db.db); } catch (_) {}
    }, WEEKLY_MS);
    weeklyCompact.unref();

    // v129: Periodic WAL checkpoint — prevents WAL file growth under sustained write load
    const WAL_CHECKPOINT_MS = 5 * 60 * 1000; // 5 minutes
    const walCheckpoint = setInterval(() => {
      try { db.db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) {}
    }, WAL_CHECKPOINT_MS);
    walCheckpoint.unref();
  }

  // F2: Start background update checker (only if repository configured)
  if (isM5ConditionalSurfaceEnabled(conditionalSurfaces, 'core-auto-update')) {
    startUpdateChecker((update) => {
      logger.info('Updater', `New version available: ${update.latestVersion} (current: ${update.currentVersion})`);
      logger.info('Updater', `Release: ${update.releaseUrl}`);
    });
  }

  // v103: Start background model upgrade check (non-blocking, fire-and-forget)
  upgradeManager.startPeriodicCheck();

  // v133: ModelRegistry — auto-cleanup scheduler (every 6h) + digest-bound
  // failover detection (every 5 min, first run after the existing delay).
  {
    if (modelFailoverDetectionCoordinator) {
      startModelFailoverDetectionScheduler({
        coordinator: modelFailoverDetectionCoordinator,
        intervalMs: 5 * 60 * 1000,
        onResult: result => {
          if (result.status !== 'SKIPPED_DISABLED') {
            if (result.status === 'COMPLETED') {
              if (result.counters.detectionsCreated > 0) {
                logger.warn(
                  'Server',
                  `Model failover detection recorded ${result.counters.detectionsCreated} incident(s)`,
                );
              } else if (result.counters.desiredCreated > 0) {
                logger.info(
                  'Server',
                  `Model failover detection observed ${result.counters.desiredCreated} desired binding(s)`,
                );
              }
            } else {
              logger.warn(
                'Server',
                `Model failover detection ${result.status}: ${result.reason}`,
              );
            }
          }
        },
        onError: error => {
          logger.warn('Server', `Model failover detection failed: ${error.message}`);
        },
      });
    }

    const cleanupInterval = setInterval(async () => {
      try {
        const result = await modelRegistry.runConfiguredAutoCleanup();
        if (result.status === 'SKIPPED_INVALID_SETTINGS') {
          logger.warn('Server', `Model auto-cleanup skipped: ${result.reason}`);
        }
      } catch (error) {
        logger.warn('Server', `Model auto-cleanup failed: ${error.message}`);
      }
    }, 6 * 60 * 60 * 1000);
    cleanupInterval.unref();
    logger.info('Server', 'ModelRegistry schedulers started (failover detection 5min, cleanup 6h)');
  }

  // v125: Dynamic port — resolve actual port after listen (port 0 → OS-assigned)
  const assignedPort = server.address().port;

  // Write port file for IDE discovery
  try {
    writePrivatePortFile(
      config.server.portFile,
      buildServerPortPayload(
        {
          port: assignedPort,
          host: config.server.host,
          pid: process.pid,
          started: new Date().toISOString(),
        },
        process.env.INTENTSMITH_TEST_SERVER_NONCE,
        legacyLocalCapability,
      ),
    );
    logger.info('Server', `Port file written: ${config.server.portFile}`);
  } catch (err) {
    logger.warn('Server', `Failed to write port file: ${err.message}`);
  }

  // Machine-readable stdout line for parent process detection
  console.log(`C3_READY:${assignedPort}`);

  const ver = getCurrentVersion();
  logger.info('Server', `p(AI)assistant v${ver} started`);
  logger.info('Server', `Chat:   http://${config.server.host}:${assignedPort}/architect`);
  if (agentRoutes) logger.info('Server', `Agents: http://${config.server.host}:${assignedPort}/agents`);
  logger.info('Server', `API:    http://${config.server.host}:${assignedPort}`);
  logger.info('Server', `WS:    ws://${config.server.host}:${assignedPort}/c3/ws`);
});

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS
// ════════════════════════════════════════════════════════════════════════════

process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Process', 'Unhandled Promise Rejection', {
    message,
    stack,
    promiseInfo: 'Promise rejection not caught',
  });

  // v124.7: Exit on DB corruption — unrecoverable state
  if (message && (message.includes('database') || message.includes('SQLITE'))) {
    logger.error('Process', 'Database error in unhandled rejection — exiting');
    process.exit(1);
  }
});

process.on('uncaughtException', (error, origin) => {
  logger.error('Process', 'Uncaught Exception - FATAL', {
    message: error.message,
    stack: error.stack,
    origin,
  });
  
  // Attempt graceful shutdown
  try {
    db.close();
  } catch (e) {
    // Ignore cleanup errors
  }
  
  // Give logs time to flush, then exit
  setTimeout(() => process.exit(1), 100);
});

// ════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ════════════════════════════════════════════════════════════════════════════

/**
 * v55.1 - Graceful shutdown with proper cleanup
 */
function gracefulShutdown(signal) {
  logger.info('Server', `Received ${signal}, shutting down gracefully...`);
  
  // Stop session cleanup timer
  try {
    ChatController.stopCleanup();
    logger.debug('Server', 'Session cleanup stopped');
  } catch (e) {
    // Ignore
  }

  // F2: Stop update checker
  try { stopUpdateChecker(); } catch { /* ignore */ }

  // v103: Stop upgrade manager periodic checks
  try { upgradeManager.stopPeriodicCheck(); } catch { /* ignore */ }

  // v124.5: Release lazy-loaded lifecycle modules
  try { import('./planner/lifecycle-build.js').then(m => m.resetLazyModules()).catch(() => {}); } catch { /* ignore */ }

  // v82: Flush specialist telemetry before DB close
  try { specialistTelemetry?.shutdown(); } catch { /* ignore */ }

  // v135.1: Persist the last buffered upgrade metrics before DB shutdown
  try { metricsCollector?.flush(); } catch { /* ignore */ }

  // Persist buffered runtime model signals before the database is closed.
  try {
    modelUniverseStore.flushSignalBuffer({ drain: true, reason: 'shutdown' });
  } catch { /* ignore */ }

  // v92: Drain + backup before shutdown
  try {
    const storageConfig = getStorageConfig(db.db);
    if (storageConfig.drain.enabled) {
      drainMessages(db.db, dataDir, { cutoffHours: storageConfig.drain.cutoff_hours });
    }
    if (storageConfig.backup.on_shutdown) {
      createStateBackup(db.db, dataDir, {
        dbPath: config.db?.path,
        projectRoot: path.resolve(__dirname, '..'),
      });
      pruneBackups(dataDir, {
        maxDaily: storageConfig.backup.max_daily,
        maxWeekly: storageConfig.backup.max_weekly,
      });
    }
  } catch { /* ignore */ }

  // v125: Remove port file
  try {
    if (fs.existsSync(config.server.portFile)) {
      fs.unlinkSync(config.server.portFile);
      logger.debug('Server', 'Port file removed');
    }
  } catch { /* ignore */ }

  // Close database
  try {
    db.close();
    logger.debug('Server', 'Database closed');
  } catch (e) {
    // Ignore
  }

  logger.info('Server', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default server;
