/**
 * System Tools
 * 
 * Nástroje pro informace o systému a správu procesů.
 */

import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";

const execAsync = promisify(exec);

// ================== SYSTEM INFO ==================

registerTool({
  name: "system:info",
  category: "system",
  description: "Get system information (CPU, RAM, OS)",
  risk: "low",
  parameters: {},
  async execute() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      success: true,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      release: os.release(),
      uptime: os.uptime(),
      cpu: {
        model: cpus[0]?.model || "unknown",
        cores: cpus.length,
        speed: cpus[0]?.speed || 0
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        usedPercent: ((totalMem - freeMem) / totalMem * 100).toFixed(1)
      },
      loadAvg: os.loadavg(),
      homedir: os.homedir(),
      tmpdir: os.tmpdir()
    };
  }
});

registerTool({
  name: "system:resources",
  category: "system",
  description: "Get current resource usage (CPU, RAM, disk, network)",
  risk: "low",
  parameters: {},
  async execute() {
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      cpu: {},
      memory: {},
      disk: {},
      network: {}
    };

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    result.memory = {
      total: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100, // GB
      free: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100,
      used: Math.round((totalMem - freeMem) / 1024 / 1024 / 1024 * 100) / 100,
      usedPercent: Math.round((totalMem - freeMem) / totalMem * 100)
    };

    // CPU load
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    result.cpu = {
      cores: cpuCount,
      load1m: loadAvg[0],
      load5m: loadAvg[1],
      load15m: loadAvg[2],
      loadPercent: Math.round(loadAvg[0] / cpuCount * 100)
    };

    // Disk (Linux/macOS)
    try {
      const { stdout } = await execAsync("df -h / | tail -1");
      const parts = stdout.trim().split(/\s+/);
      result.disk = {
        filesystem: parts[0],
        total: parts[1],
        used: parts[2],
        free: parts[3],
        usedPercent: parseInt(parts[4]) || 0
      };
    } catch {
      result.disk = { error: "Unable to get disk info" };
    }

    // Network interfaces
    const nets = os.networkInterfaces();
    result.network = Object.entries(nets).reduce((acc, [name, addrs]) => {
      const ipv4 = addrs?.find(a => a.family === "IPv4" && !a.internal);
      if (ipv4) {
        acc[name] = ipv4.address;
      }
      return acc;
    }, {});

    return result;
  }
});

// ================== PROCESS MANAGEMENT ==================

registerTool({
  name: "system:processes",
  category: "system",
  description: "List running processes",
  risk: "low",
  parameters: {
    filter: { type: "string", default: null },
    limit: { type: "number", default: 20 }
  },
  async execute({ filter, limit = 20 }) {
    try {
      // Get top processes by CPU
      const { stdout } = await execAsync(
        `ps aux --sort=-%cpu | head -${limit + 1}`
      );
      
      const lines = stdout.trim().split("\n");
      const header = lines[0];
      const processes = lines.slice(1).map(line => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0],
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          command: parts.slice(10).join(" ")
        };
      });

      let filtered = processes;
      if (filter) {
        const regex = new RegExp(filter, "i");
        filtered = processes.filter(p => regex.test(p.command));
      }

      return {
        success: true,
        processes: filtered,
        count: filtered.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "system:kill",
  category: "system",
  description: "Kill a process",
  risk: "high",
  requiresApproval: true,
  parameters: {
    pid: { type: "number", required: true },
    signal: { type: "string", default: "TERM" }
  },
  async execute({ pid, signal = "TERM" }) {
    try {
      await execAsync(`kill -${signal} ${pid}`);
      return { success: true, pid, signal };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

registerTool({
  name: "system:ports",
  category: "system",
  description: "List listening ports",
  risk: "low",
  parameters: {},
  async execute() {
    try {
      const { stdout } = await execAsync(
        "netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null"
      );
      
      const lines = stdout.trim().split("\n").slice(1);
      const ports = lines.map(line => {
        const parts = line.split(/\s+/);
        const localAddr = parts[3] || parts[4];
        const [host, port] = localAddr?.split(":") || ["", ""];
        return {
          port: parseInt(port) || 0,
          host,
          state: "LISTEN"
        };
      }).filter(p => p.port > 0);

      return {
        success: true,
        ports,
        count: ports.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

// ================== ENVIRONMENT ==================

registerTool({
  name: "system:env:get",
  category: "system",
  description: "Get environment variable",
  risk: "low",
  parameters: {
    name: { type: "string", required: true }
  },
  async execute({ name }) {
    // Block sensitive vars
    const blocked = ["PASSWORD", "SECRET", "TOKEN", "KEY", "CREDENTIAL"];
    if (blocked.some(b => name.toUpperCase().includes(b))) {
      return { success: false, error: "Access to sensitive variables blocked" };
    }

    const value = process.env[name];
    return {
      success: true,
      name,
      value: value || null,
      exists: value !== undefined
    };
  }
});

registerTool({
  name: "system:env:set",
  category: "system",
  description: "Set environment variable (session only)",
  risk: "low",
  parameters: {
    name: { type: "string", required: true },
    value: { type: "string", required: true }
  },
  async execute({ name, value }) {
    process.env[name] = value;
    return { success: true, name, value };
  }
});

// ================== TIME ==================

registerTool({
  name: "system:time",
  category: "system",
  description: "Get current time and timezone info",
  risk: "low",
  parameters: {},
  async execute() {
    const now = new Date();
    return {
      success: true,
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: now.getTimezoneOffset()
    };
  }
});

console.log("⚙️ System tools registered");
