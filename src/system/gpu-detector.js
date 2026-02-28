// GPU Detector — detect GPU hardware without requiring LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// Cross-platform GPU detection:
//   Linux:   nvidia-smi, lspci, rocm-smi
//   Windows: wmic, nvidia-smi
//   Mac:     system_profiler SPDisplaysDataType
//
// Returns: { gpu_model, vram_mb, driver, cuda_version, rocm_version, is_igpu }
//
// ══════════════════════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import os from 'os';
import { logger } from '../core/logger.js';

const EXEC_TIMEOUT = 5000; // 5s max per command

/**
 * Detect GPU hardware. Returns system_profile object.
 * Never throws — returns empty/partial profile on failure.
 *
 * @returns {{ gpus: Array<{ gpu_model: string, vram_mb: number, driver: string, cuda_version: string|null, rocm_version: string|null, is_igpu: boolean }>, platform: string, cpu: string, ram_gb: number }}
 */
export function detectGPU() {
  const platform = os.platform();
  const profile = {
    gpus: [],
    platform,
    cpu: os.cpus()?.[0]?.model || 'unknown',
    ram_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
  };

  try {
    if (platform === 'linux') {
      _detectLinux(profile);
    } else if (platform === 'win32') {
      _detectWindows(profile);
    } else if (platform === 'darwin') {
      _detectMac(profile);
    }
  } catch (err) {
    logger.error('GPUDetector', `Detection failed: ${err.message}`);
  }

  // If no GPU found, add CPU-only entry
  if (profile.gpus.length === 0) {
    profile.gpus.push({
      gpu_model: 'CPU-only (no dedicated GPU detected)',
      vram_mb: 0,
      driver: null,
      cuda_version: null,
      rocm_version: null,
      is_igpu: false,
    });
  }

  return profile;
}

// ── Linux Detection ─────────────────────────────────────────────────────────

function _detectLinux(profile) {
  // Try nvidia-smi first (NVIDIA GPUs)
  const nvidiaGPU = _tryNvidiaSmi();
  if (nvidiaGPU) {
    profile.gpus.push(nvidiaGPU);
    return;
  }

  // Try ROCm (AMD GPUs)
  const amdGPU = _tryRocmSmi();
  if (amdGPU) {
    profile.gpus.push(amdGPU);
    return;
  }

  // Fallback to lspci
  const lspciGPUs = _tryLspci();
  if (lspciGPUs.length > 0) {
    profile.gpus.push(...lspciGPUs);
  }
}

function _tryNvidiaSmi() {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits',
      { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!out) return null;

    // Parse: "NVIDIA GeForce RTX 4090, 24564, 550.120"
    const parts = out.split(',').map(s => s.trim());
    if (parts.length < 3) return null;

    // Get CUDA version
    let cudaVersion = null;
    try {
      const cudaOut = execSync(
        'nvidia-smi --query-gpu=cuda_version --format=csv,noheader',
        { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (cudaOut) cudaVersion = cudaOut;
    } catch (_) {}

    return {
      gpu_model: parts[0],
      vram_mb: parseInt(parts[1]) || 0,
      driver: parts[2],
      cuda_version: cudaVersion,
      rocm_version: null,
      is_igpu: false,
    };
  } catch (_) {
    return null;
  }
}

function _tryRocmSmi() {
  try {
    const out = execSync(
      'rocm-smi --showproductname --showmeminfo vram --csv',
      { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!out) return null;

    // Parse ROCm output
    const lines = out.split('\n').filter(l => l && !l.startsWith('='));
    const gpuModel = lines.find(l => l.includes('Card'))?.split(',')[1]?.trim() || 'AMD GPU';

    // Get VRAM from rocm-smi
    let vramMb = 0;
    try {
      const memOut = execSync(
        'rocm-smi --showmeminfo vram --json',
        { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const memData = JSON.parse(memOut);
      const firstCard = Object.values(memData)?.[0];
      if (firstCard?.['VRAM Total Memory (B)']) {
        vramMb = Math.round(parseInt(firstCard['VRAM Total Memory (B)']) / (1024 * 1024));
      }
    } catch (_) {}

    // Get ROCm version
    let rocmVersion = null;
    try {
      const verOut = execSync(
        'cat /opt/rocm/.info/version',
        { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (verOut) rocmVersion = verOut;
    } catch (_) {}

    return {
      gpu_model: gpuModel,
      vram_mb: vramMb,
      driver: 'ROCm',
      cuda_version: null,
      rocm_version: rocmVersion,
      is_igpu: false,
    };
  } catch (_) {
    return null;
  }
}

function _tryLspci() {
  const gpus = [];
  try {
    const out = execSync(
      'lspci | grep -iE "VGA|3D|Display"',
      { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!out) return gpus;

    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      // "01:00.0 VGA compatible controller: NVIDIA Corporation GA102 [GeForce RTX 3090] (rev a1)"
      const match = line.match(/:\s*(.+)/);
      const model = match ? match[1].trim() : line.trim();

      const isIntegrated = /Intel|UHD|Iris|AMD.*APU|Radeon.*Graphics/i.test(model);

      gpus.push({
        gpu_model: model,
        vram_mb: 0, // lspci doesn't report VRAM
        driver: null,
        cuda_version: null,
        rocm_version: null,
        is_igpu: isIntegrated,
      });
    }
  } catch (_) {}
  return gpus;
}

// ── Windows Detection ───────────────────────────────────────────────────────

function _detectWindows(profile) {
  // Try nvidia-smi first
  const nvidiaGPU = _tryNvidiaSmi();
  if (nvidiaGPU) {
    profile.gpus.push(nvidiaGPU);
    return;
  }

  // Fallback to wmic
  try {
    const out = execSync(
      'wmic path win32_VideoController get Name,AdapterRAM /format:csv',
      { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    for (const line of out.split('\n')) {
      if (!line.trim() || line.startsWith('Node')) continue;
      const parts = line.split(',');
      if (parts.length < 3) continue;

      const vramBytes = parseInt(parts[1]) || 0;
      const model = parts[2]?.trim() || 'Unknown GPU';
      const isIntegrated = /Intel|UHD|Iris/i.test(model);

      profile.gpus.push({
        gpu_model: model,
        vram_mb: Math.round(vramBytes / (1024 * 1024)),
        driver: null,
        cuda_version: null,
        rocm_version: null,
        is_igpu: isIntegrated,
      });
    }
  } catch (_) {}
}

// ── Mac Detection ───────────────────────────────────────────────────────────

function _detectMac(profile) {
  try {
    const out = execSync(
      'system_profiler SPDisplaysDataType',
      { timeout: EXEC_TIMEOUT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!out) return;

    // Parse system_profiler output
    const modelMatch = out.match(/Chipset Model:\s*(.+)/);
    const vramMatch = out.match(/VRAM.*?:\s*(\d+)\s*(MB|GB)/i);
    const metalMatch = out.match(/Metal.*?:\s*(.+)/);

    const model = modelMatch ? modelMatch[1].trim() : 'Apple GPU';
    let vramMb = 0;
    if (vramMatch) {
      vramMb = parseInt(vramMatch[1]);
      if (vramMatch[2].toUpperCase() === 'GB') vramMb *= 1024;
    }

    // Apple Silicon uses unified memory — treat total RAM as available
    const isAppleSilicon = /Apple M/i.test(model) || /Apple M/i.test(out);
    if (isAppleSilicon && vramMb === 0) {
      // Apple Silicon shares system RAM — report ~75% as available for ML
      vramMb = Math.round(os.totalmem() / (1024 * 1024) * 0.75);
    }

    profile.gpus.push({
      gpu_model: model,
      vram_mb: vramMb,
      driver: metalMatch ? `Metal ${metalMatch[1].trim()}` : null,
      cuda_version: null,
      rocm_version: null,
      is_igpu: isAppleSilicon,
    });
  } catch (_) {}
}

// ── Cache ───────────────────────────────────────────────────────────────────

let _cachedProfile = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Get cached GPU profile (refreshes every 60s).
 * @param {boolean} forceRefresh
 * @returns {{ gpus: Array, platform: string, cpu: string, ram_gb: number }}
 */
export function getSystemProfile(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedProfile && (now - _cacheTime) < CACHE_TTL) {
    return _cachedProfile;
  }
  _cachedProfile = detectGPU();
  _cacheTime = now;
  return _cachedProfile;
}

export default { detectGPU, getSystemProfile };
