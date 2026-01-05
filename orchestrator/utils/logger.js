/**
 * C.3 Logger
 * 
 * Centrální logging pro celý systém.
 * Loguje do konzole i do souboru.
 */

import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "orchestrator/runtime/state/logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `${new Date().toISOString().split("T")[0]}.log`);

const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const COLORS = {
  DEBUG: "\x1b[90m",  // gray
  INFO: "\x1b[36m",   // cyan
  WARN: "\x1b[33m",   // yellow
  ERROR: "\x1b[31m",  // red
  RESET: "\x1b[0m"
};

class Logger {
  constructor(name = "C3") {
    this.name = name;
    this.level = LEVELS.DEBUG;
  }

  setLevel(level) {
    this.level = LEVELS[level] || LEVELS.INFO;
  }

  _format(level, message, data) {
    const ts = new Date().toISOString();
    const dataStr = data ? " " + JSON.stringify(data) : "";
    return `[${ts}] [${level}] [${this.name}] ${message}${dataStr}`;
  }

  _log(level, message, data) {
    if (LEVELS[level] < this.level) return;

    const formatted = this._format(level, message, data);
    
    // Console with colors
    const color = COLORS[level] || COLORS.RESET;
    console.log(`${color}${formatted}${COLORS.RESET}`);
    
    // File without colors
    fs.appendFileSync(LOG_FILE, formatted + "\n");
  }

  debug(message, data) { this._log("DEBUG", message, data); }
  info(message, data) { this._log("INFO", message, data); }
  warn(message, data) { this._log("WARN", message, data); }
  error(message, data) { this._log("ERROR", message, data); }

  // Create child logger with prefix
  child(name) {
    return new Logger(`${this.name}:${name}`);
  }
}

// Main logger
export const logger = new Logger("C3");

// Shortcuts
export const log = {
  debug: (msg, data) => logger.debug(msg, data),
  info: (msg, data) => logger.info(msg, data),
  warn: (msg, data) => logger.warn(msg, data),
  error: (msg, data) => logger.error(msg, data)
};

// Child loggers for modules
export const llmLog = logger.child("LLM");
export const agentLog = logger.child("Agent");
export const toolLog = logger.child("Tool");
export const serverLog = logger.child("Server");

export default logger;
