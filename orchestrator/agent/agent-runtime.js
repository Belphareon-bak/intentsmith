/**
 * Agent Runtime
 * 
 * Hlavní běhové prostředí pro autonomního agenta.
 * Implementuje observe → think → plan → act smyčku.
 */

import { emit } from "../runtime/event-bus.js";
import { toolRegistry, executeTool } from "../tools/index.js";
import { agentMemory } from "../memory/memory-store.js";
import { userProfile } from "../memory/user-profile.js";
import { callLLM } from "../llm/llm-client.js";
import { agentLog } from "../utils/logger.js";

/**
 * Agent State
 */
class AgentState {
  constructor() {
    this.status = "idle"; // idle, thinking, acting, waiting, error
    this.currentTask = null;
    this.currentPlan = null;
    this.currentStep = 0;
    this.history = [];
    this.errors = [];
  }

  setStatus(status) {
    this.status = status;
    agentLog.debug(`Status changed: ${status}`);
    emit({ type: "agent_status", status });
  }

  setTask(task) {
    this.currentTask = task;
    this.currentPlan = null;
    this.currentStep = 0;
    emit({ type: "agent_task", task });
  }

  setPlan(plan) {
    this.currentPlan = plan;
    this.currentStep = 0;
    emit({ type: "agent_plan", plan });
  }

  advanceStep() {
    this.currentStep++;
    emit({ type: "agent_step", step: this.currentStep });
  }

  addToHistory(entry) {
    this.history.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    
    // Keep last 100 entries
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
  }

  recordError(error) {
    this.errors.push({
      message: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }

  reset() {
    this.status = "idle";
    this.currentTask = null;
    this.currentPlan = null;
    this.currentStep = 0;
  }

  getSnapshot() {
    return {
      status: this.status,
      task: this.currentTask,
      plan: this.currentPlan,
      step: this.currentStep,
      historyLength: this.history.length,
      errorsLength: this.errors.length
    };
  }
}

/**
 * Agent Runtime
 */
class AgentRuntime {
  constructor(config = {}) {
    this.config = {
      maxIterations: config.maxIterations || 10,
      maxToolCalls: config.maxToolCalls || 20,
      thinkingModel: config.thinkingModel || "D1",
      planningModel: config.planningModel || "D1",
      autoApprove: config.autoApprove ?? false,
      ...config
    };

    this.state = new AgentState();
    this.tools = toolRegistry;
    this.memory = agentMemory;
    this.profile = userProfile;
    
    this.running = false;
    this.paused = false;
    this.toolCallCount = 0;
  }

  /**
   * Start agent with a goal/task
   */
  async run(task, context = {}) {
    if (this.running) {
      throw new Error("Agent is already running");
    }

    agentLog.info(`=== Starting task ===`, { task });
    
    this.running = true;
    this.paused = false;
    this.toolCallCount = 0;
    
    this.state.setTask(task);
    this.state.setStatus("thinking");

    emit({ type: "agent_start", task });

    // Record in memory
    this.memory.recordInteraction("task_start", { task, context });

    try {
      // Main agent loop
      let iteration = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;
      
      while (this.running && iteration < this.config.maxIterations) {
        if (this.paused) {
          this.state.setStatus("waiting");
          await this.waitForResume();
        }

        iteration++;
        agentLog.info(`--- Iteration ${iteration}/${this.config.maxIterations} ---`);
        emit({ type: "agent_iteration", iteration });

        // 1. OBSERVE - gather current state
        agentLog.debug("Step 1: OBSERVE");
        const observation = await this.observe(context);

        // 2. THINK - analyze situation
        agentLog.debug("Step 2: THINK (calling LLM with role D1)");
        const thought = await this.think(observation);
        agentLog.info(`Thought result`, { done: thought.done, summary: thought.summary?.substring(0, 100) });

        // 3. Check if done
        if (thought.done) {
          agentLog.info("Task marked as DONE by LLM");
          emit({ type: "agent_complete", result: thought.result });
          this.state.addToHistory({ type: "complete", result: thought.result });
          this.memory.recordInteraction("task_complete", { task, result: thought.result });
          break;
        }

        // 4. PLAN - decide next action
        agentLog.debug("Step 3: PLAN");
        const action = await this.plan(thought);
        agentLog.info(`Planned action`, { tool: action.tool, reason: action.reason });

        // 5. ACT - execute action
        agentLog.debug(`Step 4: ACT - executing ${action.tool}`);
        const result = await this.act(action);
        agentLog.info(`Action result`, { tool: action.tool, success: result.success, error: result.error });

        // 6. Track consecutive errors
        if (!result.success) {
          consecutiveErrors++;
          agentLog.warn(`Consecutive errors: ${consecutiveErrors}/${maxConsecutiveErrors}`);
          if (consecutiveErrors >= maxConsecutiveErrors) {
            agentLog.error(`Too many errors, stopping task`);
            emit({ 
              type: "agent_error", 
              error: `Task stopped after ${consecutiveErrors} consecutive failures. Last error: ${result.error || 'Unknown'}` 
            });
            break;
          }
        } else {
          consecutiveErrors = 0; // Reset on success
        }

        // 7. Update context with result
        context = { ...context, lastResult: result };

        // Record step
        this.state.addToHistory({
          type: "step",
          iteration,
          thought: thought.summary,
          action: action.tool,
          result: result.success,
          error: result.error
        });
      }

      if (iteration >= this.config.maxIterations) {
        emit({ type: "agent_max_iterations", iteration });
      }

    } catch (error) {
      this.state.recordError(error);
      this.state.setStatus("error");
      emit({ type: "agent_error", error: error.message });
      throw error;

    } finally {
      this.running = false;
      this.state.setStatus("idle");
      emit({ type: "agent_stop" });
    }

    return {
      success: true,
      iterations: this.state.history.length,
      history: this.state.history
    };
  }

  /**
   * Observe current state
   */
  async observe(context) {
    const observation = {
      task: this.state.currentTask,
      step: this.state.currentStep,
      context,
      memory: this.memory.buildContext({ maxItems: 5 }),
      profile: this.profile.buildContextPrompt(),
      availableTools: this.tools.getToolDescriptions(),
      timestamp: new Date().toISOString()
    };

    // Add last results if any
    if (context.lastResult) {
      observation.lastResult = context.lastResult;
    }

    return observation;
  }

  /**
   * Think about the observation
   */
  async think(observation) {
    this.state.setStatus("thinking");

    const prompt = this.buildThinkingPrompt(observation);
    
    const response = await callLLM({
      role: this.config.thinkingModel,
      prompt,
      systemPrompt: this.getSystemPrompt("thinking")
    });

    // Parse thinking response
    const thought = this.parseThought(response);
    
    emit({ type: "agent_thought", thought });
    
    return thought;
  }

  /**
   * Plan next action based on thought
   */
  async plan(thought) {
    this.state.setStatus("planning");

    // If thought already contains action, use it
    if (thought.nextAction) {
      return thought.nextAction;
    }

    const prompt = this.buildPlanningPrompt(thought);
    
    const response = await callLLM({
      role: this.config.planningModel,
      prompt,
      systemPrompt: this.getSystemPrompt("planning")
    });

    const action = this.parseAction(response);
    
    emit({ type: "agent_action_planned", action });
    
    return action;
  }

  /**
   * Execute action
   */
  async act(action) {
    this.state.setStatus("acting");

    // Check tool call limit
    if (this.toolCallCount >= this.config.maxToolCalls) {
      return {
        success: false,
        error: "Maximum tool calls reached"
      };
    }

    // Check if tool requires approval
    const tool = this.tools.get(action.tool);
    
    if (tool?.requiresApproval && !this.config.autoApprove) {
      this.paused = true;
      emit({
        type: "agent_approval_required",
        action,
        tool: tool.name
      });
      
      await this.waitForApproval(action);
    }

    // Execute tool
    this.toolCallCount++;
    
    const result = await executeTool(action.tool, action.params, {
      workdir: this.config.workdir || process.cwd()
    });

    emit({ type: "agent_action_result", action, result });
    
    // Store in memory
    this.memory.shortTerm.set(`action_${this.toolCallCount}`, {
      tool: action.tool,
      params: action.params,
      result: result.success,
      output: result.result
    });

    this.state.advanceStep();
    
    return result;
  }

  /**
   * Build thinking prompt
   */
  buildThinkingPrompt(observation) {
    return `
## Current Task
${observation.task}

## Current State
Step: ${observation.step}
Timestamp: ${observation.timestamp}

## Context
${JSON.stringify(observation.context, null, 2)}

## Last Action Result
${observation.lastResult ? JSON.stringify(observation.lastResult, null, 2) : "No previous action"}

## User Profile
${observation.profile}

## Memory Context
${observation.memory}

## Available Tools
${observation.availableTools.map(t => `- ${t.name}: ${t.description}`).join("\n")}

---

Analyze the current situation and decide:
1. What progress has been made?
2. What should be done next?
3. Is the task complete?

Respond in JSON format:
{
  "analysis": "Your analysis of the situation",
  "progress": "What has been accomplished",
  "done": false,
  "result": null,
  "summary": "Brief summary",
  "nextAction": {
    "tool": "tool_name",
    "params": { ... },
    "reason": "Why this action"
  }
}

If the task is complete, set "done": true and provide the "result".
`;
  }

  /**
   * Build planning prompt
   */
  buildPlanningPrompt(thought) {
    return `
## Thought Analysis
${thought.analysis}

## Progress
${thought.progress}

## Available Tools
${this.tools.getToolsSystemPrompt()}

---

Based on the analysis, what is the best next action?

Respond in JSON format:
{
  "tool": "tool_name",
  "params": { ... },
  "reason": "Why this action"
}
`;
  }

  /**
   * Get system prompt for different modes
   */
  getSystemPrompt(mode) {
    const base = `You are an AI agent that helps users accomplish tasks by using tools.
You think step by step and take actions to achieve goals.
Always respond in valid JSON format.`;

    if (mode === "thinking") {
      return base + `
When analyzing a situation:
- Be thorough but concise
- Consider what's already done
- Identify the next logical step
- Determine if the goal is achieved`;
    }

    if (mode === "planning") {
      return base + `
When planning actions:
- Choose the most appropriate tool
- Provide exact parameters
- Explain your reasoning`;
    }

    return base;
  }

  /**
   * Parse thinking response
   */
  parseThought(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fall back to structured parsing
    }

    return {
      analysis: response,
      progress: "Unknown",
      done: false,
      summary: response.substring(0, 100),
      nextAction: null
    };
  }

  /**
   * Parse action response
   */
  parseAction(response) {
    agentLog.debug(`Parsing action from response: ${response.substring(0, 300)}`);
    
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        agentLog.debug(`Parsed action:`, parsed);
        
        // Validate required fields
        if (!parsed.tool) {
          agentLog.warn("Parsed action missing 'tool' field");
          return this.fallbackAction("No tool specified in response");
        }
        
        // Ensure params exists
        if (!parsed.params) {
          agentLog.warn(`Action ${parsed.tool} missing 'params' field`);
          parsed.params = {};
        }
        
        return parsed;
      }
    } catch (e) {
      agentLog.error(`Failed to parse action: ${e.message}`);
    }

    return this.fallbackAction("Unable to parse LLM response");
  }

  fallbackAction(reason) {
    agentLog.warn(`Using fallback action: ${reason}`);
    return {
      tool: "shell:exec",
      params: { command: `echo 'Agent error: ${reason}'` },
      reason: "Fallback action"
    };
  }

  /**
   * Wait for user to resume
   */
  async waitForResume() {
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!this.paused) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Wait for approval
   */
  async waitForApproval(action) {
    return new Promise(resolve => {
      const handler = (approval) => {
        if (approval.approved) {
          this.paused = false;
          resolve();
        } else {
          throw new Error("Action rejected by user");
        }
      };
      
      // In real implementation, this would listen to approval events
      // For now, auto-approve after a delay in non-interactive mode
      setTimeout(() => {
        this.paused = false;
        resolve();
      }, 100);
    });
  }

  /**
   * Control methods
   */
  pause() {
    this.paused = true;
    emit({ type: "agent_paused" });
  }

  resume() {
    this.paused = false;
    emit({ type: "agent_resumed" });
  }

  stop() {
    this.running = false;
    this.paused = false;
    emit({ type: "agent_stopped" });
  }

  approve(actionId) {
    // Handle approval
    emit({ type: "agent_action_approved", actionId });
  }

  reject(actionId, reason) {
    // Handle rejection
    emit({ type: "agent_action_rejected", actionId, reason });
  }

  getState() {
    return this.state.getSnapshot();
  }
}

// Factory function
export function createAgent(config = {}) {
  return new AgentRuntime(config);
}

// Singleton for simple use cases
export const agent = new AgentRuntime();

export { AgentRuntime, AgentState };

export default agent;
