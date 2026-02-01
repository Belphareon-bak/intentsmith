// Worker Pool v47.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Manages a pool of workers for parallel plan execution.
//
// Features:
// - Configurable pool size
// - Task queue with priority
// - Backpressure handling
// - Health monitoring
// - Graceful shutdown
//
// Note: Uses async/promise-based concurrency, not separate processes.
// For true process isolation, see Phase C2 (multi-runtime executor).
//
// ══════════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// TASK STATUS
// ════════════════════════════════════════════════════════════════════════════

export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// ════════════════════════════════════════════════════════════════════════════
// TASK
// ════════════════════════════════════════════════════════════════════════════

let taskIdCounter = 0;

class Task {
  constructor(fn, options = {}) {
    this.id = `task_${++taskIdCounter}_${Date.now()}`;
    this.fn = fn;
    this.priority = options.priority || 0;
    this.timeout = options.timeout || 60000;
    this.retries = options.retries || 0;
    this.retryDelay = options.retryDelay || 1000;

    this.status = TaskStatus.PENDING;
    this.attempts = 0;
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;

    // Promise for waiting on result
    this._resolve = null;
    this._reject = null;
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    // Prevent unhandled rejection if promise isn't awaited
    this.promise.catch(() => {});
  }

  /**
   * Execute the task
   */
  async execute() {
    this.status = TaskStatus.RUNNING;
    this.startedAt = Date.now();
    this.attempts++;

    try {
      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout')), this.timeout);
      });

      // Race between task and timeout
      // Wrap in Promise.resolve to catch sync throws
      this.result = await Promise.race([
        Promise.resolve().then(() => this.fn()),
        timeoutPromise,
      ]);

      this.status = TaskStatus.COMPLETED;
      this.completedAt = Date.now();
      this._resolve(this.result);

      return { ok: true, result: this.result };

    } catch (error) {
      this.error = error;

      // Check if we should retry
      if (this.attempts <= this.retries) {
        logger.debug('WorkerPool', `Task ${this.id} failed, retrying (${this.attempts}/${this.retries})`, {
          error: error.message,
        });

        // Wait before retry
        await this.sleep(this.retryDelay * this.attempts);
        return this.execute();
      }

      this.status = TaskStatus.FAILED;
      this.completedAt = Date.now();
      this._reject(error);

      return { ok: false, error: error.message };
    }
  }

  /**
   * Cancel the task
   */
  cancel() {
    if (this.status === TaskStatus.PENDING) {
      this.status = TaskStatus.CANCELLED;
      this._reject(new Error('Task cancelled'));
    }
  }

  /**
   * Get task duration
   */
  get duration() {
    if (!this.startedAt) return 0;
    return (this.completedAt || Date.now()) - this.startedAt;
  }

  /**
   * Get wait time (time in queue)
   */
  get waitTime() {
    if (!this.startedAt) return Date.now() - this.createdAt;
    return this.startedAt - this.createdAt;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKER POOL
// ════════════════════════════════════════════════════════════════════════════

class WorkerPool extends EventEmitter {
  constructor(options = {}) {
    super();

    this.concurrency = options.concurrency || 4;
    this.maxQueueSize = options.maxQueueSize || 100;

    this.queue = [];
    this.running = new Map();  // taskId → task
    this.completed = [];
    this.maxCompleted = options.maxCompleted || 100;

    this.stats = {
      submitted: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
      totalWaitTime: 0,
    };

    this.isShuttingDown = false;
  }

  /**
   * Submit a task to the pool
   */
  submit(fn, options = {}) {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('Pool is shutting down'));
    }

    // Check queue limit
    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new Error('Queue is full'));
    }

    const task = new Task(fn, options);
    this.stats.submitted++;

    // Add to queue (sorted by priority, higher first)
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);

    // Try to run immediately
    this.processQueue();

    logger.debug('WorkerPool', `Task ${task.id} submitted`, {
      queueSize: this.queue.length,
      running: this.running.size,
    });

    return task.promise;
  }

  /**
   * Submit multiple tasks and wait for all
   */
  submitAll(tasks) {
    return Promise.all(tasks.map(t => this.submit(t.fn, t.options)));
  }

  /**
   * Process the queue
   */
  processQueue() {
    // Start tasks up to concurrency limit
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.runTask(task);
    }
  }

  /**
   * Run a single task
   */
  async runTask(task) {
    this.running.set(task.id, task);

    this.emit('taskStart', task);

    const result = await task.execute();

    this.running.delete(task.id);

    // Update stats
    this.stats.totalDuration += task.duration;
    this.stats.totalWaitTime += task.waitTime;

    if (result.ok) {
      this.stats.completed++;
      this.emit('taskComplete', task, result.result);
    } else {
      this.stats.failed++;
      this.emit('taskFailed', task, result.error);
    }

    // Store completed task
    this.completed.push({
      id: task.id,
      status: task.status,
      duration: task.duration,
      waitTime: task.waitTime,
      attempts: task.attempts,
      timestamp: Date.now(),
    });

    // Trim completed history
    if (this.completed.length > this.maxCompleted) {
      this.completed = this.completed.slice(-this.maxCompleted / 2);
    }

    // Process more tasks
    this.processQueue();
  }

  /**
   * Cancel a pending task
   */
  cancel(taskId) {
    // Check queue
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const task = this.queue.splice(idx, 1)[0];
      task.cancel();
      this.stats.cancelled++;
      return true;
    }

    return false;
  }

  /**
   * Get a running task
   */
  getTask(taskId) {
    return this.running.get(taskId);
  }

  /**
   * Get pool status
   */
  getStatus() {
    return {
      concurrency: this.concurrency,
      queueSize: this.queue.length,
      running: this.running.size,
      available: this.concurrency - this.running.size,
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      avgDuration: this.stats.completed > 0
        ? this.stats.totalDuration / this.stats.completed
        : 0,
      avgWaitTime: this.stats.submitted > 0
        ? this.stats.totalWaitTime / this.stats.submitted
        : 0,
      successRate: this.stats.submitted > 0
        ? (this.stats.completed / this.stats.submitted * 100).toFixed(2)
        : 0,
      queueSize: this.queue.length,
      running: this.running.size,
      recentTasks: this.completed.slice(-10),
    };
  }

  /**
   * Drain the queue (cancel all pending)
   */
  drain() {
    const cancelled = this.queue.length;
    for (const task of this.queue) {
      task.cancel();
    }
    this.queue = [];
    this.stats.cancelled += cancelled;
    return cancelled;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(timeout = 30000) {
    logger.info('WorkerPool', 'Shutting down', {
      running: this.running.size,
      queued: this.queue.length,
    });

    this.isShuttingDown = true;

    // Cancel queued tasks
    this.drain();

    // Wait for running tasks with timeout
    const deadline = Date.now() + timeout;

    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.running.size > 0) {
      logger.warn('WorkerPool', `Force shutdown with ${this.running.size} running tasks`);
    }

    logger.info('WorkerPool', 'Shutdown complete');
  }

  /**
   * Reset pool stats
   */
  resetStats() {
    this.stats = {
      submitted: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
      totalWaitTime: 0,
    };
    this.completed = [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PLAN EXECUTION POOL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Specialized pool for plan execution
 */
class PlanExecutionPool extends WorkerPool {
  constructor(options = {}) {
    super({
      concurrency: options.concurrency || 3,
      maxQueueSize: options.maxQueueSize || 50,
      ...options,
    });

    this.planRunner = options.planRunner || null;
  }

  /**
   * Submit a plan for execution
   */
  async submitPlan(plan, context = {}, options = {}) {
    if (!this.planRunner) {
      throw new Error('PlanRunner not configured');
    }

    const planId = plan.id;

    return this.submit(
      async () => {
        logger.debug('PlanExecutionPool', `Executing plan ${planId}`);
        return this.planRunner.run(plan, context);
      },
      {
        priority: options.priority || 0,
        timeout: options.timeout || 120000,
        retries: options.retries || 0,
        ...options,
      }
    );
  }

  /**
   * Submit multiple plans for parallel execution
   */
  async submitPlans(plans, context = {}, options = {}) {
    return Promise.all(
      plans.map(plan => this.submitPlan(plan, context, options))
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export const workerPool = new WorkerPool();
export const planPool = new PlanExecutionPool();

export {
  Task,
  WorkerPool,
  PlanExecutionPool,
};

export default {
  workerPool,
  planPool,
  Task,
  TaskStatus,
  WorkerPool,
  PlanExecutionPool,
};
