import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

// A grading request may be queued after another application acquires the GPU.
// The evaluation lease alone does not cover foreign applications or Ollama.
export async function assertGradingGpuOwnership(pid, { run = promisify(execFile), read = readFile, request = fetch } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('GRADING_REQUIRES_MANAGED_PROVIDER');
  const command = await read(`/proc/${pid}/cmdline`, 'utf8');
  if (!command.includes('ollama\0serve')) throw new Error('GRADING_PROVIDER_OWNERSHIP_LOST');
  const response = await request('http://127.0.0.1:11434/api/ps', {signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('GRADING_GPU_OWNERSHIP_UNVERIFIED');
  const body = await response.json();
  if (!Array.isArray(body.models)) throw new Error('GRADING_GPU_OWNERSHIP_UNVERIFIED');
  if (body.models.length) throw new Error('GPU_FOREIGN_WORK_PRESENT');
  const {stdout} = await run('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader,nounits'], {timeout:5000,maxBuffer:16384});
  for (const value of stdout.trim().split('\n').filter(Boolean)) {
    if (!/^\d+$/.test(value.trim())) throw new Error('GRADING_GPU_OWNERSHIP_UNVERIFIED');
    const group = await run('ps', ['-o','pgid=','-p',value.trim()], {timeout:2000,maxBuffer:1024});
    if (Number(group.stdout.trim()) !== pid) throw new Error('GPU_FOREIGN_WORK_PRESENT');
  }
}
