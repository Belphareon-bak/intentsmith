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
   * v57.0 - Schedule single agent
   * Computes next_run from last_run for deterministic recovery after restart.
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

      // v57.0 - Get last_run from agent state for deterministic scheduling
      const lastRun = agent.state?._last_run ? new Date(agent.state._last_run) : null;

      if (schedule.type === 'cron') {
        cronExpression = schedule.value;
        // For cron, calculate next occurrence after last_run (or now if never run)
        const after = lastRun || new Date();
        nextRun = getNextCronRun(cronExpression, after);
      } else if (schedule.type === 'interval') {
        intervalMs = parseInterval(schedule.value);
        // v57.0 FIX: Calculate from last_run, not Date.now()
        // This ensures restart at 10:20 with 30m interval and last_run at 10:00
        // results in next_run at 10:30, not 10:50
        if (lastRun) {
          const expectedNext = new Date(lastRun.getTime() + intervalMs);
          // If we're past the expected time, run immediately (catch up)
          nextRun = expectedNext < new Date() ? new Date() : expectedNext;
        } else {
          // Never run before - run now
          nextRun = new Date();
        }
      } else {
        return false;
      }

      this.repo.setSchedule(agent.id, {
        nextRun: nextRun.toISOString(),
        intervalMs,
        cronExpression
      });

      this.logger.info(`[Scheduler] ${agent.id}: next run ${nextRun.toISOString()}${lastRun ? ` (last: ${lastRun.toISOString()})` : ' (first run)'}`);
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
   * v57.0 - Run agent and update schedule
   * Calculates next_run from the actual run time (now), not from schedule time.
   */
  async runAgent(schedule) {
    const agentId = schedule.agent_id;
    this.runningAgents.add(agentId);

    const runStartTime = new Date();

    try {
      this.logger.info(`[Scheduler] Running ${agentId}`);
      await this.runner.execute(agentId);
    } catch (err) {
      this.logger.error(`[Scheduler] ${agentId} failed: ${err.message}`);
    } finally {
      this.runningAgents.delete(agentId);
    }

    // v57.0 FIX: Calculate next run from actual run time, not Date.now()
    // This ensures consistent intervals even if execution takes time
    let nextRun;

    if (schedule.cron_expression) {
      // For cron, get next occurrence after the run completed
      nextRun = getNextCronRun(schedule.cron_expression, runStartTime);
    } else if (schedule.interval_ms) {
      // For interval, add interval to the run start time
      nextRun = new Date(runStartTime.getTime() + schedule.interval_ms);
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

    this.runningAgents.add(agentId);
    try {
      // v34: Mark as manual run for better UX feedback
      return await this.runner.execute(agentId, { isManual: true });
    } finally {
      this.runningAgents.delete(agentId);
    }
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
