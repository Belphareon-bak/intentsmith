import os from "node:os";
import fs from "node:fs";

export async function analyzeEnvironment() {
  const hasDocker =
    fs.existsSync("/usr/bin/docker") ||
    fs.existsSync("/bin/docker");

  const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const freeMemGB = Math.round(os.freemem() / 1024 / 1024 / 1024);

  return {
    read_only: true,
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    },
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || "unknown"
    },
    memory: {
      total_gb: totalMemGB,
      free_gb: freeMemGB
    },
    docker: {
      available: hasDocker
    }
  };
}
