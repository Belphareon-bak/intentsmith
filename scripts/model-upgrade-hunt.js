#!/usr/bin/env node
// Model Evaluation Hunt — discovery, exact measurement and append-only decision
// ══════════════════════════════════════════════════════════════════════════════
//
//   0  vyjmenovat všech ~235 rodin z ollama.com          bez stahování
//   1  seřadit podle externích signálů, odříznout, co se nevejde
//   2  po jednom: stáhnout → změřit VRAM → schopnostní minimum
//   3  souboj se stávajícím modelem na stejných úlohách
//   4  uložit decision, uklidit, pokračovat dalším kandidátem
//
// Použití:
//   node scripts/model-upgrade-hunt.js --shortlist          jen fáze 0+1 (nic nestahuje)
//   node scripts/model-upgrade-hunt.js --role=CODE --run    jen jedna role
//
// --prune-rejected removes only exact artifacts clearly losing every
// applicable role. --prune-only performs this maintenance without inference.
//   node scripts/model-upgrade-hunt.js --run --limit=3      zkusí 3 nejlepší kandidáty
//   node scripts/model-upgrade-hunt.js --run --only=qwen3.8:27b
//   node scripts/model-upgrade-hunt.js --run --installed-panel
//   node scripts/model-upgrade-hunt.js --shortlist --json
//
// Bez `--run` skript nic nestahuje ani nemaže.
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { logger } from '../src/core/logger.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  configureProductionOutboundPolicy,
  installProductionOutboundGuard,
} from '../src/network/outbound-policy.js';
import {
  fetchLibraryFamilies, fetchFamilyTags, getLibraryFamilyMetadata, prioritizeCandidates, buildCandidatePool,
} from '../src/upgrade/model-sweep.js';
import { checkRoleEligibility } from '../src/upgrade/candidate-eligibility.js';
import { MODEL_PROFILES } from '../src/upgrade/model-profiles.js';
import { parseModelNameExtended } from '../src/upgrade/model-family-extensions.js';
import { fetchModels as fetchWhatllm, matchModels } from '../src/upgrade/whatllm-client.js';
import { enrichFromHuggingFace } from '../src/upgrade/huggingface-client.js';
import { modelRegistry } from '../src/upgrade/model-registry.js';
import { upgradeManager } from '../src/upgrade/upgrade-manager.js';
import { modelUseAuthority } from '../src/upgrade/model-use-authority.js';
import { createModelArtifactAuthorityRepository } from '../src/upgrade/model-artifact-authority-repository.js';
import {
  measureModel, drainResident, intendedNumCtx, listResident,
} from '../src/upgrade/vram-measurement.js';
import { tryCandidate } from '../src/upgrade/candidate-trial.js';
import { buildCandidates } from '../src/upgrade/model-discovery.js';
import { canonicalModelName, normalizeModelDigestSha256 } from '../src/upgrade/model-identity.js';
import {
  CHAT_QUALITY_VERSION, RoleQualityEvaluationRunner, describeChatTests,
} from '../src/eval/role-quality-suites.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { modelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { ModelEvaluationDecisionStore } from '../src/upgrade/model-evaluation-decision-store.js';
import {
  DEFAULT_RESPONSIBILITY_POLICY,
  auditResponsibilitySegregation,
  buildInstalledCandidateQueue,
  createHistoryCallbacks,
  recordRoleEvaluationFailures,
  evaluationStateForArtifact,
  materializeCurrentHardwareBlocks,
  resolveCurrentBindings,
  selectResponsibilityPortfolio,
} from '../src/upgrade/model-upgrade-prototype.js';
import { createModelFailoverRepository } from '../src/upgrade/model-failover.js';
import {
  assessCandidateDownloadHeadroom, assessScheduledEvaluationReadiness,
  holdGpuEvaluationLock,
} from '../src/upgrade/gpu-evaluation-lock.js';
import { ModelHuntState } from '../src/upgrade/model-hunt-state.js';
import { huntRetentionKey, pruneRejectedHuntModels } from '../src/upgrade/model-hunt-retention.js';
import { createModelBindingApplication, createOllamaModelBindingProvider } from '../src/upgrade/model-binding-application.js';
import { TASK_MARGIN_EPSILON } from '../src/upgrade/pairwise-trial.js';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const val = n => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };

const DO_RUN = flag('run');
const AS_JSON = flag('json');
const INSTALLED_PANEL = flag('installed-panel');
const limitInput = val('limit') ?? (INSTALLED_PANEL ? String(Number.MAX_SAFE_INTEGER) : '3');
const LIMIT = Number(limitInput);
if (!/^\d+$/.test(limitInput) || !Number.isSafeInteger(LIMIT) || LIMIT < 1) {
  console.error('--limit musí být kladné celé číslo.');
  process.exit(1);
}
const ONLY = (val('only') || '').split(',').map(s => s.trim()).filter(Boolean);
// Kandidát, kterého sada nerozlišila, nebyl horší — jen to nešlo změřit.
const KEEP_INCONCLUSIVE = flag('keep-inconclusive');
// The legacy CLI spelling now also selects the narrow proof-based path.
const PRUNE_REJECTED = flag('prune-rejected') || flag('allow-removal');
const PRUNE_ONLY = flag('prune-only');
if (PRUNE_ONLY && (!PRUNE_REJECTED || !DO_RUN)) throw new Error('--prune-only requires --run --prune-rejected');
const retentionSweeps = [];
const SHOW_CHAT_TESTS = flag('show-chat-tests');
const REMOTE_ONLY = flag('remote-only');
const EXPORT_CHAT_HISTORY = flag('export-chat-history');
const SCHEDULED = flag('scheduled');
const BOOTSTRAP = flag('bootstrap');
const PULL_PROVIDER_URL = process.env.INTENTSMITH_HUNT_PULL_URL || config.ollama.baseUrl;
const INCREMENTAL_ONLY = flag('incremental-only');
const REPORT_PATH = val('report');
if (INSTALLED_PANEL && (REMOTE_ONLY || ONLY.length > 0)) {
  console.error('--installed-panel nelze kombinovat s --remote-only ani --only');
  process.exit(1);
}
// `--json` is a machine contract. Imported discovery modules share this
// logger object, so silence their human progress lines for this process only;
// otherwise ANSI log prefixes would corrupt stdout before the JSON document.
if (AS_JSON) {
  logger.debug = () => {};
  logger.info = () => {};
  logger.warn = () => {};
  logger.error = () => {};
}
const emitJsonArtifact = payload => {
  if (PRUNE_REJECTED) payload = { ...payload, retentionSweeps };
  if (REPORT_PATH) writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  if (AS_JSON) console.log(JSON.stringify(payload, null, 2));
};
/**
 * Role, pro které se hledá.  `--role=CODE` zúží běh na jednu roli — hodí se
 * na ověření řetězce, protože se tím zkrátí souboj i fronta kandidátů.
 */
const ROLE_FILTER = (val('role') || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
const ALL_ROLES = Object.keys(config.models);
const unknownRoles = ROLE_FILTER.filter(r => !ALL_ROLES.includes(r));
if (unknownRoles.length) {
  console.error(`Neznámá role: ${unknownRoles.join(', ')}. Dostupné: ${ALL_ROLES.join(', ')}`);
  process.exit(1);
}
const ROLES = ROLE_FILTER.length ? ROLE_FILTER : ALL_ROLES;

const log = (...a) => { if (!AS_JSON) console.log(...a); };

if (SHOW_CHAT_TESTS) {
  const tests = describeChatTests();
  const plan = createRoleEvaluationPlans().CHAT;
  if (AS_JSON || REPORT_PATH) emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    suite: 'chat_v3',
    suiteVersion: CHAT_QUALITY_VERSION,
    suiteContractSha256: plan.suiteContractSha256,
    weighting: { en: 0.6, cs: 0.4 },
    decisionMinimums: {
      total: plan.minimumDiscriminatingTasks,
      byLanguage: plan.minimumDiscriminatingByLanguage,
    },
    tests,
  });
  else {
    console.log('CHAT v3 — EN 60 %, CZ 40 %\n');
    for (const test of tests) {
      console.log(`── ${test.name} [${test.language}]`);
      console.log(typeof test.prompt === 'string' ? test.prompt : JSON.stringify(test.prompt));
      test.rubric.forEach((item, index) => console.log(`  ${index + 1}. ${item}`));
      console.log('');
    }
  }
  process.exit(0);
}

function openDb() {
  const p = val('db') || process.env.C3_DB_PATH
    || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'c3.db');
  if (!existsSync(p)) throw new Error(`DB nenalezena: ${p}`);
  return new Database(p);
}

async function detectVram() {
  try {
    const { getSystemProfile } = await import('../src/system/gpu-detector.js');
    const p = await getSystemProfile();
    if (p.gpus?.length) {
      const gpu = p.gpus.reduce((a, b) => ((b.vram_mb || 0) > (a.vram_mb || 0) ? b : a));
      return {
        vramMb: gpu.vram_mb || 0, model: gpu.gpu_model, igpu: gpu.is_igpu,
        numCtx: intendedNumCtx(),
      };
    }
  } catch { /* bez detekce se jede jen na měření */ }
  return { vramMb: 0, model: 'neznámá', igpu: false, numCtx: intendedNumCtx() };
}

function memoryAvailableBytes() {
  try {
    const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch { return null; }
}

function gpuComputeProcesses() {
  try {
    return execFileSync('nvidia-smi', [
      '--query-compute-apps=pid,process_name', '--format=csv,noheader,nounits',
    ], { encoding: 'utf8', timeout: 10_000 })
      .split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  } catch { return ['stav GPU nelze bezpečně zjistit']; }
}

function modelStorageAvailableBytes() {
  try {
    const storagePath = process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models';
    const stats = statfsSync(storagePath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch { return null; }
}

async function scheduledEvaluationReadiness() {
  return assessScheduledEvaluationReadiness({
    residentModels: await listResident({ baseUrl: config.ollama?.baseUrl }),
    computeProcesses: gpuComputeProcesses(),
    memoryAvailableBytes: memoryAvailableBytes(),
    diskAvailableBytes: modelStorageAvailableBytes(),
  });
}

// ─── Fáze 0 + 1 ─────────────────────────────────────────────────────────────

/**
 * Fáze 0 + 1 — pro **každou roli zvlášť**.
 *
 * Jeden společný seznam byl špatná otázka: cílem není jeden univerzální model,
 * ale nejlepší model pro každou roli. Role se liší laťkou (svým stávajícím
 * modelem), způsobilostí (VISION potřebuje vision model, D1 minimálně 14B) i
 * tím, co je pro ni přínos (coder model do CODE, generalista do CHAT).
 *
 * @returns {{ perRole: Map<string, Array>, queue: Array, familiesTotal: number }}
 */
async function buildRoleShortlists(gpu, installedNames, bindings, inventory = []) {
  const families = await fetchLibraryFamilies();
  const familyMetadata = getLibraryFamilyMetadata();
  log(`Fáze 0: ${families.length} rodin v knihovně Ollamy`);

  const whatllm = await fetchWhatllm().catch(() => []);
  const qualityByFamily = new Map();
  if (whatllm.length) {
    const probe = families.map(f => ({ name: `${f}:1b` }));
    for (const [probeName, entry] of matchModels(whatllm, probe)) {
      const fam = probeName.split(':')[0];
      const prev = qualityByFamily.get(fam);
      if (!prev || prev < entry.qualityIndex) qualityByFamily.set(fam, entry.qualityIndex);
    }
  }
  log(`Fáze 1: whatllm hodnotí ${qualityByFamily.size} z nich`);

  // Laťka je pro každou roli jiná — je to hodnocení jejího stávajícího modelu,
  // ne globální maximum. Silná role tak nezvedne laťku slabé a naopak.
  // Klíčem je kanonické jméno: config váže `qwen3-30b-a3b`, Ollama hlásí
  // `qwen3-30b-a3b:latest`. Bez sjednocení by laťka nikdy nesedla a filtr
  // podle hodnocení by se neuplatnil.
  const qualityOfModel = new Map();
  if (whatllm.length) {
    for (const [name, entry] of matchModels(whatllm, installedNames.map(n => ({ name: n })))) {
      const key = canonicalModelName(name);
      if (key) qualityOfModel.set(key, entry.qualityIndex);
    }
  }

  // Tagy se stahují jednou pro všechny role a pro **všechny** rodiny.
  // Omezit pool na hodnocené rodiny by roli VISION nechalo trvale prázdnou —
  // whatllm mezi svými 17 rodinami žádný vision model nemá.
  const pool = await buildCandidatePool(families, {
    vramMb: gpu.vramMb,
    gpuModel: gpu.model,
    familyMetadata,
    onProgress: (d, t) => log(`   … prohledáno ${d}/${t} rodin`),
  });
  log(`Fáze 1: ${pool.length} rodin má variantu, která se může vejít\n`);

  // HF není zdroj kvality, ale u nejperspektivnějšího omezeného podvzorku
  // ověří datum vydání a modalitu. Dotazovat všech 235 rodin by z plánovaného
  // huntu udělalo pomalý crawler; sjednocení nejčerstvějších a externě
  // hodnocených kandidátů zachytí nové generace i známé silné rodiny.
  const hfTargets = new Map();
  const byFreshness = [...pool].sort((a, b) => {
    const aDays = Number.isFinite(Number(a.catalogUpdatedDays)) && a.catalogUpdatedDays != null
      ? Number(a.catalogUpdatedDays) : Number.POSITIVE_INFINITY;
    const bDays = Number.isFinite(Number(b.catalogUpdatedDays)) && b.catalogUpdatedDays != null
      ? Number(b.catalogUpdatedDays) : Number.POSITIVE_INFINITY;
    return aDays - bDays || a.sizeGB - b.sizeGB;
  });
  const byExternalQuality = [...pool].sort((a, b) =>
    (qualityByFamily.get(b.family) ?? -1) - (qualityByFamily.get(a.family) ?? -1));
  for (const candidate of [...byFreshness.slice(0, 16), ...byExternalQuality.slice(0, 8)]) {
    hfTargets.set(candidate.name, candidate);
  }
  const hfSummary = await enrichFromHuggingFace([...hfTargets.values()]).catch(() => null);
  if (hfSummary) {
    log(`Fáze 1: HuggingFace ověřil ${hfSummary.resolved}/${hfTargets.size} prioritních kandidátů`);
  }

  const profileOf = (entry) => {
    const parsed = parseModelNameExtended(entry.name);
    if (entry.capabilities?.includes?.('vision')) return { ...parsed, category: 'vision' };
    if (parsed.category !== 'unknown') return parsed;
    const description = String(entry.catalogDescription || '').toLowerCase();
    let category = 'unknown';
    if (/\bembedding|embed model|vector search/.test(description)) category = 'embedding';
    else if (/\bocr\b|optical character/.test(description)) category = 'ocr';
    else if (/content safety|safety classification|guardrail|safeguard/.test(description)) category = 'safety';
    else if (/translation model|collection of .*translation|speciali[sz]ed in translation/.test(description)) category = 'translation';
    else if (/\bvision\b|image understanding|image-text/.test(description)) category = 'vision';
    else if (/agentic coding|software engineering|code model|for developers/.test(description)) category = 'code';
    return { ...parsed, category };
  };
  const eligibilityOf = (entry, role) => checkRoleEligibility(profileOf(entry), role);

  const perRole = new Map();
  for (const role of ROLES) {
    const incumbent = bindings[role];
    const baseline = qualityOfModel.get(canonicalModelName(incumbent)) ?? null;
    const ranked = prioritizeCandidates(pool, {
      vramMb: gpu.vramMb,
      installed: installedNames,
      installedDigests: new Map(inventory.map(row => [canonicalModelName(row.name), row.digest?.replace(/^sha256:/, '')])),
      externalSignalOf: e => qualityByFamily.get(e.family) ?? null,
      releaseDateOf: e => e.releaseDate ?? null,
      role,
      eligibilityOf,
      profileOf,
      preferredCategories: MODEL_PROFILES[role]?.preferredCategories ?? null,
    });
    perRole.set(role, ranked);
    log(`  ${role.padEnd(7)} laťka ${incumbent} (${baseline ?? 'nehodnocen'})  →  ${ranked.length} kandidátů`);
  }

  // Fronta: kandidát se stáhne jednou a zkusí se jen v rolích, kde je
  // kandidátem. Pořadí podle jeho nejlepší priority napříč těmi rolemi.
  const byName = new Map();
  for (const [role, list] of perRole) {
    for (const c of list) {
      const existing = byName.get(c.name);
      if (existing) {
        existing.roles.push(role);
        existing.priority = Math.max(existing.priority, c.priority);
      } else {
        byName.set(c.name, { ...c, roles: [role] });
      }
    }
  }
  const queue = [...byName.values()].sort((a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB);

  return { perRole, queue, familiesTotal: families.length };
}

// ─── Běh ────────────────────────────────────────────────────────────────────

const gpu = await detectVram();
log(`GPU: ${gpu.model}, ${gpu.vramMb} MB VRAM${gpu.igpu ? ' (integrovaná)' : ''}`);
if (!gpu.vramMb) log('⚠ VRAM se nepodařilo zjistit — předfiltr velikosti se neuplatní, rozhodne měření');

const db = openDb();
await runMigrations(db);
configureProductionOutboundPolicy({
  database: db,
  logger,
  enabledSurfaces: { 'model-discovery': config.features.onlineDiscovery === true },
});
installProductionOutboundGuard();
modelEvaluationHistory.setDb(db);
const providerResponse = await fetch(`${config.ollama.baseUrl}/api/version`, { signal: AbortSignal.timeout(10_000) });
if (!providerResponse.ok) throw new Error('OLLAMA_PROVIDER_VERSION_UNAVAILABLE');
const providerVersion = (await providerResponse.json()).version;
modelEvaluationHistory.setProviderVersion(providerVersion);
log(`Provider: Ollama ${providerVersion}`);
const huntState = new ModelHuntState(db);
if (DO_RUN) {
  const artifactRepository = createModelArtifactAuthorityRepository(db);
  modelUseAuthority.bindDurableRepository(artifactRepository);
  upgradeManager.setDb(db);
  upgradeManager.setModelArtifactAuthorityRepository(artifactRepository);
}
const evaluationDecisionStore = new ModelEvaluationDecisionStore(db);
const bindingRepository = createModelFailoverRepository(db);
const evaluationRunner = new RoleQualityEvaluationRunner(config.ollama?.baseUrl);
const evaluationPlans = createRoleEvaluationPlans();

const currentBindingNames = inventory => {
  const names = resolveCurrentBindings(config.models, bindingRepository, ALL_ROLES).bindings;
  if (inventory) for (const role of ALL_ROLES) {
    const desired = bindingRepository.getDesired(role);
    const installed = inventory.find(row => canonicalModelName(row.name) === canonicalModelName(names[role]));
    if (!desired || desired.digestSha256 !== normalizeModelDigestSha256(installed?.digest)
      || canonicalModelName(desired.modelName) !== canonicalModelName(names[role])) throw new Error('RETENTION_BINDING_DRIFT');
  }
  return names;
};
const retentionContext = inventory => ({ inventory, bindings: currentBindingNames(inventory),
  plans: evaluationPlans, hardware: gpu, providerVersion });
async function assertRetentionIdle() {
  for (const baseUrl of new Set([config.ollama.baseUrl, PULL_PROVIDER_URL])) {
    const response = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(8000) });
    const body = response.ok ? await response.json() : null;
    if (!Array.isArray(body?.models)) throw new Error('RETENTION_RESIDENCY_UNKNOWN');
    if (body.models.length) throw Object.assign(new Error('Retention requires idle Ollama'), { code: 'HUNT_GPU_BUSY' });
  }
  if (execFileSync('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader'], { encoding: 'utf8', timeout: 8000 }).trim()) {
    throw Object.assign(new Error('Retention requires an idle GPU compute slot'), { code: 'HUNT_GPU_BUSY' });
  }
}
async function runRetention(phase) {
  await assertRetentionIdle();
  const rows = await pruneRejectedHuntModels({
    registry: modelRegistry, journal: huntState, history: modelEvaluationHistory,
    getInventory: () => modelRegistry.getInstalled({ strict: true, baseUrl: PULL_PROVIDER_URL }),
    getBindings: currentBindingNames,
    getProviderVersion: async () => {
      const response = await fetch(`${PULL_PROVIDER_URL}/api/version`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('RETENTION_PROVIDER_UNAVAILABLE');
      return (await response.json()).version;
    },
    assertIdle: assertRetentionIdle, plans: evaluationPlans, hardware: gpu,
  });
  retentionSweeps.push({ phase, completedAt: new Date().toISOString(), results: rows });
  for (const row of rows) log(`  [retention] ${row.model}: ${row.status} ${row.reason || row.proof?.reason || ''}`);
}
if (DO_RUN && PRUNE_REJECTED) {
  const artifactRepository = createModelArtifactAuthorityRepository(db);
  const application = createModelBindingApplication({
    repository: bindingRepository, runtime: upgradeManager.createBindingRuntimePort(),
    provider: createOllamaModelBindingProvider({ baseUrl: PULL_PROVIDER_URL }), modelUseAuthority,
  });
  modelRegistry.init({ db, upgradeManager, bindingRepository, modelBindingApplication: application,
    modelUseAuthority, modelArtifactAuthorityRepository: artifactRepository,
    requireDurableModelUseAuthority: true, modelMutationBaseUrl: PULL_PROVIDER_URL });
  let cleanupLease;
  try {
    cleanupLease = holdGpuEvaluationLock({ command: 'model-upgrade-hunt retention' });
    await runRetention('before-hunt');
  } catch (error) {
    if (!SCHEDULED || !['GPU_EVALUATION_BUSY', 'HUNT_GPU_BUSY'].includes(error.code)) throw error;
    emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'SCHEDULED_SKIPPED', reasons: [error.message], results: [] });
    db.close();
    process.exit(0);
  } finally { cleanupLease?.release(); }
  if (PRUNE_ONLY) {
    emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'RETENTION_COMPLETE', results: [] });
    db.close();
    process.exit(0);
  }
}

if (EXPORT_CHAT_HISTORY) {
  const plan = evaluationPlans.CHAT;
  const selected = new Set(ONLY.map(canonicalModelName));
  const rows = db.prepare(`
    SELECT model_name, model_canonical_name, model_digest_sha256, score, repeats,
           duration_ms, tokens_per_second, vram_bytes, task_results_json, completed_at
      FROM model_evaluation_runs
     WHERE status = 'COMPLETE'
       AND role = 'CHAT'
       AND suite_name = ?
       AND suite_version = ?
       AND suite_contract_sha256 = ?
     ORDER BY completed_at ASC
  `).all(plan.suiteName, plan.suiteVersion, plan.suiteContractSha256)
    .filter(row => !selected.size || selected.has(row.model_canonical_name))
    .map(row => ({
      model: row.model_name,
      canonicalModel: row.model_canonical_name,
      digestSha256: row.model_digest_sha256,
      score: row.score,
      repeats: row.repeats,
      durationMs: row.duration_ms,
      tokensPerSecond: row.tokens_per_second,
      vramBytes: row.vram_bytes,
      completedAt: row.completed_at,
      tasks: JSON.parse(row.task_results_json),
    }));
  const currentForExport = resolveCurrentBindings(config.models, bindingRepository, ALL_ROLES);
  const incumbentCanonical = canonicalModelName(currentForExport.bindings.CHAT);
  const incumbent = rows.find(row => row.canonicalModel === incumbentCanonical) || null;
  const languageScore = (row, language) => {
    const tasks = row.tasks.filter(task => task.language === language);
    return tasks.reduce((sum, task) => sum + task.mean, 0) / (tasks.length || 1);
  };
  const pairwise = rows.filter(row => row !== incumbent).map(row => {
    const incumbentTasks = new Map((incumbent?.tasks || []).map(task => [task.name, task]));
    const tasks = row.tasks.map(task => {
      const baseline = incumbentTasks.get(task.name);
      const delta = baseline ? task.mean - baseline.mean : 0;
      const noise = baseline ? Math.max(task.spread, baseline.spread) : 0;
      return {
        name: task.name, language: task.language, candidateMean: task.mean,
        incumbentMean: baseline?.mean ?? null, delta, noise,
        discriminating: !!baseline && Math.abs(delta) > Math.max(TASK_MARGIN_EPSILON, noise),
      };
    });
    const discriminating = tasks.filter(task => task.discriminating);
    return {
      candidate: row.model,
      incumbent: incumbent?.model || currentForExport.bindings.CHAT,
      discriminating: discriminating.length,
      byLanguage: Object.fromEntries(['en', 'cs'].map(language => [
        language, discriminating.filter(task => task.language === language).length,
      ])),
      candidateWins: discriminating.filter(task => task.delta > 0).length,
      incumbentWins: discriminating.filter(task => task.delta < 0).length,
      tasks,
    };
  });
  const taskNames = [...new Set(rows.flatMap(row => row.tasks.map(task => task.name)))];
  const panel = taskNames.map(name => {
    const values = rows.map(row => {
      const task = row.tasks.find(item => item.name === name);
      return { model: row.model, mean: task?.mean ?? 0, spread: task?.spread ?? 0 };
    });
    const means = values.map(value => value.mean);
    const range = Math.max(...means) - Math.min(...means);
    const noise = Math.max(...values.map(value => value.spread));
    const language = rows.flatMap(row => row.tasks).find(task => task.name === name)?.language || null;
    return {
      name, language, values, range, noise,
      discriminating: range > Math.max(TASK_MARGIN_EPSILON, noise) + 1e-9,
    };
  });
  emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    suite: plan.suiteName,
    suiteVersion: plan.suiteVersion,
    suiteContractSha256: plan.suiteContractSha256,
    weighting: { en: 0.6, cs: 0.4 },
    decisionMinimums: {
      total: plan.minimumDiscriminatingTasks,
      byLanguage: plan.minimumDiscriminatingByLanguage,
    },
    incumbent: currentForExport.bindings.CHAT,
    tests: describeChatTests(),
    models: rows.map(row => ({
      ...row,
      languageScores: { en: languageScore(row, 'en'), cs: languageScore(row, 'cs') },
    })),
    pairwise,
    panel: {
      models: rows.map(row => row.model),
      discriminating: panel.filter(task => task.discriminating).length,
      byLanguage: Object.fromEntries(['en', 'cs'].map(language => [
        language, panel.filter(task => task.language === language && task.discriminating).length,
      ])),
      tasks: panel,
    },
  });
  db.close();
  process.exit(0);
}

const installedRaw = await modelRegistry.getInstalled({ strict: true });
const installed = buildCandidates(installedRaw);
const installedNames = installed.map(m => m.name);
log(`Nainstalováno: ${installedNames.length} modelů`);
if (ROLE_FILTER.length) log(`Omezeno na role: ${ROLES.join(', ')}`);
log('');

// Durable USER_APPLY/USER_ROLLBACK bindings are runtime truth after startup
// rehydration. Falling back to config here would compare against stale defaults
// and could "upgrade" a role to a model it already superseded.
const current = resolveCurrentBindings(config.models, bindingRepository, ALL_ROLES);
const durableBindings = current.durable;
const initialBindings = current.bindings;
const bindings = { ...initialBindings };
if (Object.keys(durableBindings).length) {
  log(`Durable runtime vazby: ${Object.entries(durableBindings).map(([role, model]) => `${role}=${model}`).join(', ')}`);
}
const initialResponsibilityAudit = auditResponsibilitySegregation(initialBindings);
if (!initialResponsibilityAudit.compliant) {
  log(`Segregace vyžaduje opravu: ${initialResponsibilityAudit.violations
    .map(row => `${row.type} ${row.roles.join('+')}=${row.model}`).join('; ')}`);
}
// Ručně zadaný pilot zná své kandidáty předem. Neprocházet kvůli němu celý
// vzdálený katalog je podstatné: --only má být rychlá a síťově úsporná cesta,
// ne skrytá discovery fáze.
const shortlist = (ONLY.length || INSTALLED_PANEL)
  ? { perRole: new Map(ROLES.map(role => [role, []])), queue: [], familiesTotal: 0 }
  : await buildRoleShortlists(gpu, installedNames, bindings, installedRaw);
const { perRole, queue: discoveredRemoteQueue, familiesTotal } = shortlist;
// Replacing an installed tag could silently change a desired/rollback binding.
// Surface such revisions, but require a separate versioned import operation.
const catalogUpdatesRequiringManualImport = discoveredRemoteQueue.filter(candidate =>
  installedNames.some(name => canonicalModelName(name) === canonicalModelName(candidate.name)));
const remoteQueue = discoveredRemoteQueue.filter(candidate => !catalogUpdatesRequiringManualImport.includes(candidate));
const reusedHardwareBlocks = DO_RUN && INSTALLED_PANEL
  ? materializeCurrentHardwareBlocks({
    candidates: installed,
    roles: ROLES,
    plans: evaluationPlans,
    history: modelEvaluationHistory,
    hardware: gpu,
  })
  : [];
if (reusedHardwareBlocks.length) {
  log(`Převzato ${reusedHardwareBlocks.length} current-role VRAM blokací bez nového načtení do RAM.`);
}
const installedQueue = REMOTE_ONLY ? [] : buildInstalledCandidateQueue({
  candidates: installed,
  roles: ROLES,
  bindings,
  plans: evaluationPlans,
  history: modelEvaluationHistory,
  hardware: gpu,
  // Na stejném GPU a kontextu je artifact-wide CPU spill definitivní. Reuse
  // výše materializuje current-role BLOCKED rows, takže model znovu nenačítáme.
  ignoreHardwareBlocks: false,
});
// Chybějící suite už staženého artefaktu má přednost před dalším downloadem:
// je rychlejší, nezvětšuje disk a uzavírá přesně tu historii, kterou už máme.
const byPriority = (a, b) => b.priority - a.priority || a.sizeGB - b.sizeGB;
const installedPending = installedQueue
  .filter(candidate => candidate.evaluationState?.state !== 'scored')
  .sort(byPriority);
const installedScored = installedQueue
  .filter(candidate => candidate.evaluationState?.state === 'scored')
  .sort(byPriority);
const queue = [
  ...installedPending.filter(local => !remoteQueue.some(remote => canonicalModelName(remote.name) === canonicalModelName(local.name))),
  ...remoteQueue.sort(byPriority),
  // Candidate COMPLETE is not a completed duel: the incumbent may have failed.
  // Keep these behind unseen artifacts; the durable attempt ledger below
  // suppresses completed duels and applies retry backoff to incomplete ones.
  ...installedScored,
];

log('\n══ KANDIDÁTI PODLE ROLÍ ══');
for (const role of ROLES) {
  const list = perRole.get(role) || [];
  log(`\n── ${role}  (nyní ${bindings[role]}) ──`);
  if (!list.length) { log('   žádný kandidát neprošel filtrem'); continue; }
  list.slice(0, 5).forEach((c, i) =>
    log(`  ${i + 1}. ${c.name.padEnd(28)} ${String(c.sizeGB).padStart(5)} GB  prio ${String(c.priority).padStart(6)}  ${c.reasons.join(', ')}`));
}

log(`\n══ FRONTA KE ZKOUŠCE (${queue.length}) ══`);
queue.slice(0, 12).forEach((c, i) =>
  log(`  ${String(i + 1).padStart(2)}. ${c.name.padEnd(28)} pro role: ${c.roles.join(', ')}`
    + `${c.evaluationState ? `  [${c.evaluationState.state}]` : '  [remote artifact unknown]'}`));

let picked = queue;
if (ONLY.length) {
  picked = [];
  for (const name of ONLY) {
    const local = installed.find(candidate => canonicalModelName(candidate.name) === canonicalModelName(name));
    // An explicit remote name still needs a catalog size before any pull.
    // Unknown/private artifacts fail closed at the same storage gate.
    const tags = local ? [] : await fetchFamilyTags(name.split(':')[0]);
    const remote = tags.find(candidate => canonicalModelName(candidate.name) === canonicalModelName(name));
    picked.push({
      ...(local || {}),
      name: local?.name || name,
      family: (local?.name || name).split(':')[0],
      sizeGB: local?.sizeGB || remote?.sizeGB || 0,
      installed: Boolean(local),
      artifact: local?.artifact || null,
      catalogDigest: remote?.catalogDigest || null,
      roles: ROLES,
      reasons: [local ? 'zadáno ručně; již nainstalováno' : 'zadáno ručně'],
    });
  }
}
if (INSTALLED_PANEL && picked.some(candidate => candidate.installed !== true)) {
  throw new Error('installed panel obsahuje nenainstalovaný artefakt');
}

if ((DO_RUN || BOOTSTRAP) && !ONLY.length && !INSTALLED_PANEL) {
  if (familiesTotal === 0) throw new Error('HUNT_DISCOVERY_UNAVAILABLE: bootstrap requires a catalog snapshot');
  picked = huntState.observe(picked, { initialize: BOOTSTRAP });
  let rejectionKey = null;
  try { rejectionKey = huntRetentionKey(retentionContext(installedRaw)); } catch { /* No matching proof can be reused. */ }
  // Keep the historical backlog visible. New arrivals get the first slots;
  // pending bootstrap candidates continue in subsequent bounded ticks.
  picked = picked.filter(candidate => (!INCREMENTAL_ONLY || candidate.hunt.cohort === 'INCREMENTAL')
    && huntState.pending(candidate, huntState.evaluationKey(candidate, providerVersion, evaluationPlans, gpu),
      Date.now(), { retentionKey: rejectionKey }))
    .sort((a, b) => Number(b.hunt.cohort === 'INCREMENTAL') - Number(a.hunt.cohort === 'INCREMENTAL')
      || Number(b.installed === true) - Number(a.installed === true) || byPriority(a, b));
}

if (!DO_RUN) {
  if (AS_JSON || REPORT_PATH) {
    emitJsonArtifact({
      gpu, providerVersion, familiesTotal, catalogUpdatesRequiringManualImport,
      perRole: Object.fromEntries([...perRole].map(([r, l]) => [r, l])),
      queue: picked,
    });
  } else log('\n(bez --run se nic nestahuje; --run --limit=N zkusí N nejlepších)');
  process.exit(0);
}

if (!picked.length) {
  emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'NO_PENDING_CANDIDATES', results: [], queue: [] });
  db.close();
  process.exit(0);
}

const readyRoles = ROLES.filter(role => evaluationPlans[role]?.decisionReady !== false);
const blockedRoles = ROLES.filter(role => !readyRoles.includes(role));
for (const role of blockedRoles) {
  const plan = evaluationPlans[role];
  log(`  [suite-readiness] ${role}: ${plan.suiteName} má ${plan.taskCount}/${plan.minimumTaskCount} `
    + 'požadovaných aktivních úloh');
}
if (readyRoles.length === 0) {
  log('\nŽádná vybraná role nemá rozhodovací sadu; bez stahování a bez GPU běhu končím.');
  process.exit(0);
}

// Prevent a scheduled hunt, manual pilot and CODE calibration from loading
// different Ollama models into the same GPU between drain and measurement.
let gpuLease;
try {
  gpuLease = holdGpuEvaluationLock({ command: `model-upgrade-hunt ${args.join(' ')}` });
} catch (error) {
  if (!SCHEDULED || error.code !== 'GPU_EVALUATION_BUSY') throw error;
  emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'SCHEDULED_SKIPPED', reasons: [error.message], results: [] });
  db.close();
  process.exit(0);
}
if (SCHEDULED) {
  const readiness = await scheduledEvaluationReadiness();
  if (!readiness.ready) {
    log(`Plánovaný hunt přeskočen bez zásahu: ${readiness.reasons.join('; ')}`);
    emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'SCHEDULED_SKIPPED', reasons: readiness.reasons, results: [] });
    gpuLease.release();
    db.close();
    process.exit(0);
  }
}

const toTry = [];
let plannedDiskAvailableBytes = modelStorageAvailableBytes();
for (const candidate of picked) {
  if (toTry.length >= LIMIT) break;
  if (candidate.installed !== true) {
    // Ollama catalog sizes are decimal-ish labels; treating them as GiB is a
    // conservative overestimate. Reserve cumulatively for all pulls selected
    // in this tick, because losing candidates stay on disk by default.
    const downloadBytes = Math.ceil(Number(candidate.sizeGB) * 2 ** 30);
    const headroom = assessCandidateDownloadHeadroom({
      diskAvailableBytes: plannedDiskAvailableBytes,
      downloadBytes,
    });
    if (!headroom.ready) {
      log(`  [storage-headroom] ${candidate.name}: ${headroom.reason}`);
      continue;
    }
    plannedDiskAvailableBytes = headroom.remainingBytes;
  }
  toTry.push(candidate);
}
if (!toTry.length) {
  emitJsonArtifact({ generatedAt: new Date().toISOString(), providerVersion, status: 'STORAGE_BLOCKED', results: [], queue: picked });
  gpuLease.release();
  db.close();
  process.exit(0);
}

// Referenční rychlost stávajících modelů — potřebná pro rozhodnutí při remíze.
log('\n══ MĚŘENÍ STÁVAJÍCÍCH MODELŮ ══');
const incumbentSpeed = {};
const allowedDrainModels = new Set();
const measurementOptions = { providerVersion, ...(SCHEDULED ? { allowedDrainModels } : {}) };
const markOwned = name => {
  allowedDrainModels.add(name);
  const canonical = canonicalModelName(name);
  allowedDrainModels.add(canonical);
  if (!canonical.includes(':')) allowedDrainModels.add(`${canonical}:latest`);
};
const measurements = new Map();
const historyCallbacks = createHistoryCallbacks({
  history: modelEvaluationHistory,
  inventory: installedRaw,
  baseUrl: config.ollama?.baseUrl,
  hardware: gpu,
  measurements,
});
for (const name of new Set(readyRoles.map(role => bindings[role]).filter(Boolean))) {
  const artifact = await historyCallbacks.resolveArtifact(name);
  const matchingRole = readyRoles.find(role => canonicalModelName(bindings[role]) === canonicalModelName(name));
  const plan = matchingRole ? evaluationPlans[matchingRole] : null;
  const prior = plan ? modelEvaluationHistory.getComplete({
    digestSha256: artifact.digestSha256,
    role: matchingRole,
    suiteName: plan.suiteName,
    suiteVersion: plan.suiteVersion,
    contractSha256: plan.suiteContractSha256,
  }) : null;
  const m = prior?.tokensPerSecond != null
    ? { fits: true, throughput: { tokensPerSecond: prior.tokensPerSecond }, placement: { vramBytes: prior.vramBytes || 0, sizeBytes: 0 }, reused: true }
    : await measureModel(name, { ...measurementOptions, expectedArtifact: artifact });
  if (!m.reused) markOwned(name);
  incumbentSpeed[name] = m.throughput?.tokensPerSecond ?? 0;
  measurements.set(canonicalModelName(name), m);
  const p = m.placement || {};
  log(`  ${name.padEnd(24)} ${m.fits ? 'vejde se' : 'NEVEJDE '} ${m.reused ? '[history]' : '[new]'} `
    + `${p.sizeBytes ? `${(p.vramBytes / 2 ** 30).toFixed(2)}/${(p.sizeBytes / 2 ** 30).toFixed(2)} GB` : '-'}  `
    + `${incumbentSpeed[name] || '—'} tok/s`);
}
await drainResident(measurementOptions);

log(`\n══ ZKOUŠKA KANDIDÁTŮ (${toTry.length}) ══`);

const results = [];
for (const cand of toTry) {
  log(`\n─── ${cand.name}  (role: ${cand.roles.join(', ')}) ───`);
  if (cand.installed !== true) {
    // Earlier candidates and unrelated disk users may have consumed the space
    // since queue planning. Recheck immediately before this candidate's pull.
    const headroom = assessCandidateDownloadHeadroom({
      diskAvailableBytes: modelStorageAvailableBytes(),
      downloadBytes: Math.ceil(Number(cand.sizeGB) * 2 ** 30),
    });
    if (!headroom.ready) {
      log(`  [storage-headroom] ${cand.name}: ${headroom.reason}`);
      continue;
    }
  }
  const candidateStartedAt = new Date().toISOString();
  const r = await tryCandidate(cand.name, {
    ...measurementOptions,
    beforeMeasure: async name => {
      const artifact = await historyCallbacks.refreshArtifact(name);
      // A long download must not turn the earlier idle check into permission
      // to evict a model loaded by an interactive user meanwhile.
      if (SCHEDULED) {
        await drainResident(measurementOptions);
        const readiness = await scheduledEvaluationReadiness();
        if (!readiness.ready) throw Object.assign(new Error(readiness.reasons.join('; ')), { code: 'HUNT_GPU_BUSY' });
      }
      markOwned(name);
      return artifact;
    },
    runner: evaluationRunner,
    pullModel: async (name, onProgress, authority) => {
      const recovered = await upgradeManager.recoverOutstandingModelPulls(onProgress, {
        modelNames: [name], providerOrigin: new URL(PULL_PROVIDER_URL).origin,
      });
      if (recovered.length) {
        if (recovered.some(row => row.status !== 'RECOVERED')) throw Object.assign(new Error('Selected pull remains unresolved'), { code: 'CANDIDATE_EVALUATION_RETRYABLE' });
        return;
      }
      const nowInstalled = await modelRegistry.getInstalled({ strict: true });
      if (nowInstalled.some(row => canonicalModelName(row.name) === canonicalModelName(name))) {
        throw Object.assign(new Error('Candidate was installed after discovery; rebuild its exact queue entry'), {
          code: 'CANDIDATE_EVALUATION_RETRYABLE',
        });
      }
      return upgradeManager.pullModel(name, onProgress, { ...authority, baseUrl: PULL_PROVIDER_URL });
    },
    skipPull: cand.installed === true,
    // Jen role, pro které je tenhle model vůbec kandidátem.
    roles: cand.roles,
    candidateParams: cand.params,
    candidateCategory: cand.category,
    candidateCapabilities: cand.capabilities,
    bindings,
    keepInconclusive: KEEP_INCONCLUSIVE,
    // Removal happens only after an independent all-role proof and registry
    // recheck. A restricted or partial candidate trial cannot authorize it.
    allowRemoval: false,
    // Mazání vlastní model-registry; candidate-trial ho dostane injekcí,
    // aby neobcházel kanonickou identitu a exclusive mutation autoritu.
    deleteModel: (name, options) => modelRegistry.deleteModel(name, options),
    incumbentSpeed,
    evaluationPlans,
    trialOpts: {
      repeats: 3,
      resolveArtifact: historyCallbacks.resolveArtifact,
      loadHistoricalSummary: historyCallbacks.loadHistoricalSummary,
      saveHistoricalSummary: historyCallbacks.saveHistoricalSummary,
    },
    hasReusableEvaluation: async (name, roles) => {
      const artifact = await historyCallbacks.resolveArtifact(name);
      return evaluationStateForArtifact(
        artifact, roles, evaluationPlans, modelEvaluationHistory,
      ).state === 'scored';
    },
    onStage: (stage, m, info = {}) => {
      if (stage === 'measured') {
        measurements.set(canonicalModelName(m), {
          fits: info.fits,
          throughput: { tokensPerSecond: info.tokensPerSecond },
          placement: { vramBytes: info.vramBytes, sizeBytes: info.sizeBytes },
          numCtx: info.numCtx,
        });
        const gb = n => (n / 2 ** 30).toFixed(2);
        log(`  ✓ vejde se do VRAM (${gb(info.vramBytes)}/${gb(info.sizeBytes)} GB při ${info.numCtx} tok), `
          + `${info.tokensPerSecond ?? '—'} tok/s`);
      } else if (stage === 'floorPassed') {
        log(`  ✓ schopnostní minimum prošlo (${info.probes} kontroly)`);
      } else if (stage === 'roleFailed') {
        log(`     ${info.role} FAILED (${info.model || 'preparation'}): ${info.error}`);
        for (const task of info.failedTasks || []) log(`       ${task.name}: ${task.error || 'timeout'}`);
      } else if (stage === 'roleDecided') {
        const d = info.decision;
        log(`     ${info.role.padEnd(7)} ${d.winner === 'candidate' ? 'KANDIDÁT' : 'stávající'}  (${d.basis}) ${d.detail}`);
      } else {
        log(`  [${stage}] ${m}`);
      }
    },
  });
  const candidateCompletedAt = new Date().toISOString();
  r.failureRecords = recordRoleEvaluationFailures({ result: r, history: modelEvaluationHistory, plans: evaluationPlans, hardware: gpu });
  results.push(r);
  huntState.record(cand, huntState.evaluationKey(cand, providerVersion, evaluationPlans, gpu), r);

  if (r.error) {
    let artifact;
    try {
      artifact = await historyCallbacks.resolveArtifact(cand.name);
    } catch {
      // Pull failures still belong in append-only history. Without a digest the
      // row is evidence only and will never suppress a future artifact.
      artifact = { modelName: cand.name };
    }
    for (const role of r.stage === 'trial' ? [] : cand.roles) {
      const plan = evaluationPlans[role];
      if (!plan) continue;
      const measuredCpuSpill = r.stage === 'measure'
        && r.measurement?.placement?.loaded === true
        && r.measurement?.fits === false;
      modelEvaluationHistory.recordTerminal({
        artifact,
        role,
        suiteName: plan.suiteName,
        suiteVersion: plan.suiteVersion,
        contractSha256: plan.suiteContractSha256,
        status: r.stage === 'measure' ? 'BLOCKED' : 'FAILED',
        repeats: plan.repeats,
        hardware: gpu,
        metadata: {
          source: 'model-upgrade-hunt-v136.1', stage: r.stage,
          numCtx: r.measurement?.numCtx ?? gpu.numCtx,
          cpuBytes: r.measurement?.placement?.cpuBytes ?? null,
          sizeBytes: r.measurement?.placement?.sizeBytes ?? null,
          vramBytes: r.measurement?.placement?.vramBytes ?? null,
        },
        errorCode: r.stage === 'measure'
          ? (measuredCpuSpill ? 'CANDIDATE_VRAM_FIT_FAILED' : 'CANDIDATE_MEASURE_RETRYABLE')
          : (r.errorCode || `CANDIDATE_${String(r.stage || 'unknown').toUpperCase()}_FAILED`),
        errorMessage: r.error,
        durationMs: Date.parse(candidateCompletedAt) - Date.parse(candidateStartedAt),
        startedAt: candidateStartedAt,
        completedAt: candidateCompletedAt,
      });
    }
    log(`  ✗ ${r.error}${r.removed ? ' → smazán' : ''}`);
    continue;
  }
  const t = r.measurement.throughput?.tokensPerSecond;
  if (r.accepted) {
    const won = Object.entries(r.decisions).filter(([, d]) => d.winner === 'candidate').map(([x]) => x);
    log(`  → kvalitativní kandidát pro role: ${won.join(', ')}; finální portfolio určí segregace`);
    incumbentSpeed[cand.name] = t ?? 0;
  } else if (r.roleErrors.length) {
    log(`  → NEÚPLNÉ: ${r.roleErrors.length} rolí selhalo; ostatní výsledky zachovány, kandidát ponechán`);
  } else if (r.inconclusive) {
    log('  → NEROZHODNUTO — sada kandidáta neodlišila od stávajícího, takže');
    log(`     to neznamená, že je horší. ${r.removed ? 'Smazán.' : 'Ponechán na disku.'}`);
  } else {
    log(`  → prohrál v souboji${r.removed ? ', smazán' : ', ponechán na disku'}`);
  }
  if (r.keptReason) log(`     (${r.keptReason})`);
}

const portfolioEvidence = {};
const addPortfolioEvidence = (role, row) => {
  if (!portfolioEvidence[role]) portfolioEvidence[role] = [];
  portfolioEvidence[role].push(row);
};
for (const result of results) {
  for (const trial of result.trials || []) {
    if (!trial?.comparison || !trial.role) continue;
    addPortfolioEvidence(trial.role, {
      model: result.model,
      score: trial.comparison.candidateSuiteScore,
      source: 'candidate-evaluation',
      eligibleForChange: trial.decision?.winner === 'candidate',
    });
    addPortfolioEvidence(trial.role, {
      model: initialBindings[trial.role],
      score: trial.comparison.incumbentSuiteScore,
      source: 'incumbent-evaluation',
      eligibleForChange: true,
    });
  }
}
const portfolio = selectResponsibilityPortfolio({
  before: initialBindings,
  evidenceByRole: portfolioEvidence,
  roles: ALL_ROLES,
});
Object.assign(bindings, portfolio.bindings);

// Pairwise outcomes are durable evidence, but only the exact candidate chosen
// by the feasible whole-role portfolio can be advertised for manual binding.
// Persist after portfolio selection so a raw winner cannot bypass segregation.
for (const result of results) {
  result.decisionRecords = [];
  for (const trial of result.trials || []) {
    if (trial?.skipped || !trial?.decision) continue;
    const selected = portfolio.feasible
      && trial.decision.winner === 'candidate'
      && canonicalModelName(portfolio.bindings[trial.role]) === canonicalModelName(result.model);
    result.decisionRecords.push(evaluationDecisionStore.recordTrial(trial, {
      candidateModel: result.model,
      incumbentModel: initialBindings[trial.role],
      source: 'model-upgrade-hunt-v136.1',
      activationEligible: selected,
      activationBlockReason: portfolio.feasible
        ? 'CANDIDATE_NOT_SELECTED_BY_PORTFOLIO'
        : 'RESPONSIBILITY_SEGREGATION_FAILED',
    }));
  }
}

log('\n══ SEGREGACE ODPOVĚDNOSTÍ ══');
if (portfolio.feasible) {
  log(`  portfolio vyhovuje: nejvýše ${DEFAULT_RESPONSIBILITY_POLICY.maxRolesPerModel} role/model, kritické autor-reviewer dvojice oddělené`);
  for (const role of portfolio.changedRoles) {
    const choice = portfolio.choices[role];
    log(`  ${role}: ${initialBindings[role]} → ${portfolio.bindings[role]}  score ${choice?.score?.toFixed?.(3) ?? '—'}`);
  }
} else {
  log('  z dosud změřených variant nelze sestavit vyhovující portfolio; žádná vazba se nemění');
  for (const violation of portfolio.audit.violations) {
    log(`  ✗ ${violation.type}: ${violation.roles.join(', ')} → ${violation.model}`);
  }
}

log('\n══ VÝSLEDEK ══');
for (const role of ROLES) {
  const before = initialBindings[role];
  const after = bindings[role];
  log(`  ${role.padEnd(7)} ${before === after ? `beze změny (${before})` : `${before} → ${after}`}`);
}
const changed = ROLES.filter(r => initialBindings[r] !== bindings[r]);
if (changed.length) {
  log(`\n${changed.length} rolí má decision pro kandidáta. Hunt binding nikdy nemění; ruční aktivace používá samostatnou binding application.`);
} else {
  const rawWinners = results.flatMap(result => Object.entries(result.decisions || {})
    .filter(([, decision]) => decision.winner === 'candidate')
    .map(([role]) => `${role}=${result.model}`));
  if (rawWinners.length) {
    log(`\nKvalitativní vítěz existuje (${rawWinners.join(', ')}), ale po segregaci nevznikla přípustná změna vazby.`);
  } else {
    log('\nŽádný kandidát neporazil stávající modely.');
  }
}

await drainResident(measurementOptions);
if (PRUNE_REJECTED) {
  await runRetention('after-hunt');
  for (const row of retentionSweeps.at(-1).results) {
    const result = results.find(item => canonicalModelName(item.model) === canonicalModelName(row.model));
    if (result) {
      result.retention = row;
      if (row.status === 'DELETED') { result.removed = true; result.keptReason = null; }
    }
  }
}

if (AS_JSON || REPORT_PATH) {
  emitJsonArtifact({
    generatedAt: new Date().toISOString(),
    gpu, providerVersion, huntCatalog: huntState.summary(), catalogUpdatesRequiringManualImport,
    perRole: Object.fromEntries([...perRole].map(([r, l]) => [r, l])),
    queue, results, proposedBindings: bindings, portfolio,
  });
}

gpuLease.release();
db.close();
