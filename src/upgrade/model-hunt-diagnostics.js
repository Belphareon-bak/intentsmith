import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Diagnose recorded evidence; this never changes a score, policy or model binding.
export function analyzeHuntDecisions(results = []) {
  const cases = [];
  let evaluated = 0;
  for (const result of results) for (const trial of result.trials || []) {
    if (trial.skipped || !trial.decision) continue;
    evaluated++;
    if (trial.decision.reasonCode !== 'INSUFFICIENT_EVIDENCE') continue;
    const comparison = trial.comparison || {};
    const epsilon = trial.policy?.taskMarginEpsilon ?? 0.05;
    const rounding = trial.policy?.scoreRoundingEpsilon ?? 0.0005;
    const tasks = comparison.tasks || [];
    const noiseLimited = tasks.filter(t => !t.discriminating && Math.abs(t.delta) > epsilon + rounding
      && Math.abs(t.delta) <= Math.max(epsilon, t.noise || 0) + rounding).map(t => t.name);
    const closeScores = tasks.filter(t => !t.discriminating && Math.abs(t.delta) <= epsilon + rounding).map(t => t.name);
    cases.push({ model: result.model, role: trial.role, suiteContractSha256: trial.policy?.suiteContractSha256,
      discriminating: comparison.discriminating, minimum: trial.policy?.minimumDiscriminatingTasks,
      noiseLimited, closeScores, unstableTasks: comparison.unstableTasks || [],
      diagnosis: noiseLimited.length ? 'VARIABILITY_LIMITED' : 'SMALL_OBSERVED_DIFFERENCE',
    });
  }
  return { evaluated, insufficient: cases.length,
    variabilityLimited: cases.filter(c => c.diagnosis === 'VARIABILITY_LIMITED').length,
    smallObservedDifference: cases.filter(c => c.diagnosis === 'SMALL_OBSERVED_DIFFERENCE').length,
    cases, limitation: 'Diagnostic of recorded tasks only; more repeats or new tasks require a new exact contract and incumbent baseline.' };
}

// Unknown GPU state must never authorize inference or retention.
export async function inspectHuntGpu({ run = promisify(execFile) } = {}) {
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=driver_version,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, maxBuffer: 16384 });
    const rows = stdout.trim().split('\n').map(line => line.split(',').map(s => s.trim()));
    if (!rows.length || rows.some(row => !/^[0-9.]+$/.test(row[0]) || !(Number(row[1]) > 0))) throw new Error('Invalid GPU response');
    return { available: true, vramMb: Math.max(...rows.map(row => Number(row[1]))), driverVersion: rows[0][0], code: null, message: null };
  } catch (error) {
    const mismatch = /Driver\/library version mismatch/i.test(String(error.stdout || '') + String(error.stderr || '') + error.message);
    return { available: false, vramMb: null, code: mismatch ? 'GPU_DRIVER_LIBRARY_MISMATCH' : 'GPU_PROBE_UNAVAILABLE',
      message: mismatch ? 'NVIDIA ovladač a knihovna NVML mají rozdílné verze. Ulož práci a restartuj počítač; potom měření spusť znovu.'
        : 'Stav NVIDIA GPU nelze ověřit. Zkontroluj ovladač; měření ani automatické mazání se nespustí.' };
  }
}

// Inventory only: NV-CONTROL can still report dedicated capacity through the
// running X server when NVML fails. This is neither free VRAM nor CUDA health.
export async function readNvidiaDisplayCapacity({ run = promisify(execFile), platform = process.platform } = {}) {
  if (platform !== 'linux') return null;
  try {
    const { stdout } = await run('nvidia-settings', ['-t', '-q', '[gpu]/TotalDedicatedGPUMemory'], {
      timeout: 3000, maxBuffer: 16384,
    });
    const rows = stdout.trim().split(/\r?\n/);
    if (!rows.length || rows.some(row => !/^\d+$/.test(row.trim()) || !Number.isSafeInteger(Number(row)) || Number(row) <= 0)) return null;
    // Match the catalog's existing largest-single-GPU budget, never sum GPUs.
    return { vramMb: Math.max(...rows.map(Number)), source: 'nvidia-settings' };
  } catch { return null; }
}
