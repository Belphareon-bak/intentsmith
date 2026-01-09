// C.3 v28 Logger
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
};

const currentLevel = LEVELS[config.log.level] ?? LEVELS.info;

function formatTime() {
  return new Date().toISOString();
}

function log(level, component, message, data = null) {
  if (LEVELS[level] < currentLevel) return;
  
  const color = COLORS[level];
  const reset = COLORS.reset;
  const time = config.log.timestamps ? `[${formatTime()}] ` : '';
  const prefix = `${color}[${level.toUpperCase()}]${reset} [C3:${component}]`;
  
  if (data) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data) : data;
    console.log(`${time}${prefix} ${message}`, dataStr);
  } else {
    console.log(`${time}${prefix} ${message}`);
  }
}

export const logger = {
  debug: (component, message, data) => log('debug', component, message, data),
  info: (component, message, data) => log('info', component, message, data),
  warn: (component, message, data) => log('warn', component, message, data),
  error: (component, message, data) => log('error', component, message, data),
  
  // Timing helper
  time: (component, label) => {
    const start = Date.now();
    return {
      end: (extra = '') => {
        const duration = ((Date.now() - start) / 1000).toFixed(1);
        log('debug', component, `${label} completed in ${duration}s ${extra}`.trim());
        return parseFloat(duration);
      }
    };
  },
};

export default logger;
