// C.3 v33 Agent Scheduler
// ══════════════════════════════════════════════════════════════════════════════
// Manages periodic execution of agents (cron + interval)

/**
 * Parse cron expression and get next run time
 * Simple implementation - supports basic patterns
 */
function getNextCronRun(expression, after = new Date()) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron: ${expression}`);
  }
  
  const [minute, hour, day, month, weekday] = parts;
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  
  // Simple search for next matching time (max 1 year)
  for (let i = 0; i < 525600; i++) { // 1 year in minutes
    if (
      matchCron(minute, next.getMinutes()) &&
      matchCron(hour, next.getHours()) &&
      matchCron(day, next.getDate()) &&
      matchCron(month, next.getMonth() + 1) &&
      matchCron(weekday, next.getDay())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  
  throw new Error(`Could not find next run for: ${expression}`);
}

function matchCron(pattern, value) {
  if (pattern === '*') return true;
  if (pattern.startsWith('*/')) {
    return value % parseInt(pattern.slice(2)) === 0;
  }
  if (pattern.includes(',')) {
    return pattern.split(',').map(Number).includes(value);
  }
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(pattern) === value;
}

/**
 * Parse interval string to milliseconds
 */
function parseInterval(interval) {
  const match = interval.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid interval: ${interval}`);
  
  const [, value, unit] = match;
  const multipliers = { m: 60000, h: 3600000, d: 86400000 };
  return parseInt(value) * multipliers[unit];
}

/**
 * Agent Scheduler
 */
export class AgentScheduler {
  constructor({ repository, runner, logger = console }) {
    this.repo = repository;
    this.runner = runner;
    this.logger = logger;
    this.running = false;
    this.checkInterval = null;
    this.runningAgents = new Set();
  }
  
  /**
   * Start scheduler
   * @param {number} checkIntervalMs - How often to check (default 30s)
   */
  start(checkIntervalMs = 30000) {
    if (this.running) {
      this.logger.warn('[Scheduler] Already running');
      return;
    }
    
    this.running = true;
    this.logger.info('[Scheduler] Starting (check every ' + checkIntervalMs + 'ms)');
    
    // Initialize schedules
    this.initSchedules();
    
    // Start periodic check
    this.checkInterval = setInterval(() => this.checkDue(), checkIntervalMs);
    
    // Initial check
    this.checkDue();
  }
  
  /**
   * Stop scheduler
   */
  stop() {
    if (!this.running) return;
    
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    this.logger.info('[Scheduler] Stopped');
  }
  
  /**
   * Initialize schedules for all enabled agents
   */
  initSchedules() {
    const agents = this.repo.getAllAgents(false);
    let scheduled = 0;
    
    for (const agent of agents) {
      if (this.scheduleAgent(agent)) {
        scheduled++;
      }
    }
    
    this.logger.info(`[Scheduler] Initialized ${scheduled} agents`);
  }
  
  /**
   * Schedule single agent
   */
  scheduleAgent(agent) {
    const schedule = agent.definition?.schedule;
    if (!schedule || schedule.type === 'manual') {
      return false;
    }
    
    try {
      let nextRun;
      let intervalMs = null;
      let cronExpression = null;
      
      if (schedule.type === 'cron') {
        cronExpression = schedule.value;
        nextRun = getNextCronRun(cronExpression);
      } else if (schedule.type === 'interval') {
        intervalMs = parseInterval(schedule.value);
        nextRun = new Date(Date.now() + intervalMs);
      } else {
        return false;
      }
      
      this.repo.setSchedule(agent.id, {
        nextRun: nextRun.toISOString(),
        intervalMs,
        cronExpression
      });
      
      this.logger.info(`[Scheduler] ${agent.id}: next run ${nextRun.toISOString()}`);
      return true;
      
    } catch (err) {
      this.logger.error(`[Scheduler] Failed to schedule ${agent.id}: ${err.message}`);
      return false;
    }
  }
  
  /**
   * Check for due agents and run them
   */
  async checkDue() {
    if (!this.running) return;
    
    const dueAgents = this.repo.getDueAgents();
    
    for (const schedule of dueAgents) {
      if (this.runningAgents.has(schedule.agent_id)) {
        continue; // Already running
      }
      
      this.runAgent(schedule);
    }
  }
  
  /**
   * Run agent and update schedule
   */
  async runAgent(schedule) {
    const agentId = schedule.agent_id;
    this.runningAgents.add(agentId);
    
    try {
      this.logger.info(`[Scheduler] Running ${agentId}`);
      await this.runner.execute(agentId);
    } catch (err) {
      this.logger.error(`[Scheduler] ${agentId} failed: ${err.message}`);
    } finally {
      this.runningAgents.delete(agentId);
    }
    
    // Calculate next run
    let nextRun;
    
    if (schedule.cron_expression) {
      nextRun = getNextCronRun(schedule.cron_expression);
    } else if (schedule.interval_ms) {
      nextRun = new Date(Date.now() + schedule.interval_ms);
    } else {
      return;
    }
    
    this.repo.updateLastRun(agentId, nextRun.toISOString());
  }
  
  /**
   * Manually trigger agent
   */
  async triggerAgent(agentId) {
    if (this.runningAgents.has(agentId)) {
      throw new Error('Agent is already running');
    }
    
    return this.runner.execute(agentId, { force: true });
  }
  
  /**
   * Reschedule agent after update
   */
  rescheduleAgent(agentId) {
    const agent = this.repo.getAgent(agentId);
    if (agent) {
      this.scheduleAgent(agent);
    }
  }
  
  /**
   * Get status
   */
  getStatus() {
    return {
      running: this.running,
      runningAgents: Array.from(this.runningAgents),
      scheduled: this.repo.getAllAgents().map(a => {
        const sched = this.repo.getSchedule(a.id);
        return {
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          nextRun: sched?.next_run,
          lastRun: sched?.last_run
        };
      })
    };
  }
}

export default AgentScheduler;
