// C.3 Agent System - API Routes
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { validateAgentDefinition } from './schema.js';
import { AgentBuilder } from './builder.js';
import { inspectSource } from './sources/inspector.js';
import { SourceSchema, SchemaBuilder } from './sources/schema.js';

/**
 * Admin auth guard for sensitive endpoints (secrets).
 * When C3_ADMIN_TOKEN env var is set, requires matching Bearer token.
 * When not set (local dev mode), allows all requests.
 * @param {object} req - Express request
 * @returns {boolean} true if authorized
 */
function requireAdminAuth(req) {
  const expected = process.env.C3_ADMIN_TOKEN;
  if (!expected) return true;  // no token configured = local dev mode
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return token === expected;
}

/**
 * Clean definition by removing orphaned references
 * @param {object} def - Agent definition
 * @returns {object} Cleaned definition
 */
function cleanDefinition(def) {
  if (!def) return def;
  
  const cleaned = { ...def };
  
  // Get valid IDs
  const sourceIds = new Set((def.sources || []).map(s => s.id));
  const conditionIds = new Set((def.conditions || []).map(c => c.id));
  const triggerIds = new Set((def.triggers || []).map(t => t.id));
  
  // Clean triggers - remove those referencing non-existent conditions
  if (cleaned.triggers) {
    cleaned.triggers = cleaned.triggers.filter(t => {
      const condId = t.condition_id || t.condition;
      if (condId && !conditionIds.has(condId)) {
        logger.debug('AgentAPI', `Removing trigger ${t.id} - references non-existent condition ${condId}`);
        return false;
      }
      return true;
    });
  }
  
  // Update trigger IDs set after cleaning
  const cleanedTriggerIds = new Set((cleaned.triggers || []).map(t => t.id));
  
  // Clean actions - remove trigger_id if trigger doesn't exist
  if (cleaned.actions) {
    cleaned.actions = cleaned.actions.map(a => {
      const trigId = a.trigger_id || a.trigger;
      if (trigId && !cleanedTriggerIds.has(trigId)) {
        logger.debug('AgentAPI', `Clearing trigger reference in action - ${trigId} doesn't exist`);
        return { ...a, trigger_id: null, trigger: null };
      }
      return a;
    });
  }
  
  return cleaned;
}

/**
 * Create agent API routes
 * @param {object} deps - Dependencies
 * @returns {object} Route handlers
 */
export function createAgentRoutes({ repository, scheduler, executor, llmClient, notificationRouter = null }) {

  // Agent Builder for creating agents from descriptions
  const builder = llmClient ? new AgentBuilder({ llmClient }) : null;
  return {
    // ═══════════════════════════════════════════════════════════════════════════
    // AGENTS CRUD
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GET /api/agents
     * List all agents
     */
    async listAgents(req, res) {
      try {
        const includeDisabled = req.query.all === 'true';
        const agents = repository.getAll(includeDisabled);
        
        // Add schedule info
        const result = agents.map(agent => {
          const schedule = repository.getSchedule(agent.id);
          const lastRun = repository.getLastRun(agent.id);
          
          return {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            icon: agent.icon,
            enabled: agent.enabled,
            schedule: agent.definition.schedule,
            nextRun: schedule?.next_run,
            lastRun: lastRun ? {
              at: lastRun.started_at,
              status: lastRun.status,
              triggers: lastRun.triggers_fired?.length || 0
            } : null
          };
        });
        
        res.json({ agents: result });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * GET /api/agents/:id
     * Get agent details
     */
    async getAgent(req, res) {
      try {
        const agent = repository.getById(req.params.id);
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        
        const schedule = repository.getSchedule(agent.id);
        const runs = repository.getRunHistory(agent.id, 10);
        const notifications = repository.getNotifications({ agentId: agent.id, limit: 10 });
        
        res.json({
          ...agent,
          schedule: schedule,
          recentRuns: runs,
          notifications
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/agents
     * Create new agent
     */
    async createAgent(req, res) {
      try {
        const { id, name, description, icon, definition, params, enabled } = req.body;
        
        // Validate definition
        const validation = validateAgentDefinition(definition);
        if (!validation.valid) {
          return res.status(400).json({ 
            error: 'Invalid agent definition', 
            details: validation.errors 
          });
        }
        
        // Check for duplicate ID
        if (repository.getById(id || definition.id)) {
          return res.status(409).json({ error: 'Agent with this ID already exists' });
        }
        
        const agent = repository.create({
          id: id || definition.id,
          name: name || definition.name,
          description: description || definition.description,
          icon: icon || definition.icon || '🤖',
          definition,
          params: params || {},
          enabled: enabled !== false
        });
        
        // Schedule if enabled
        if (agent.enabled) {
          scheduler.scheduleAgent(agent);
        }
        
        res.status(201).json(agent);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * PUT /api/agents/:id
     * Update agent
     */
    async updateAgent(req, res) {
      try {
        const agent = repository.getById(req.params.id);
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        
        const { name, description, icon, definition, params, enabled } = req.body;
        
        // Validate definition if provided
        if (definition) {
          const validation = validateAgentDefinition(definition);
          if (!validation.valid) {
            return res.status(400).json({ 
              error: 'Invalid agent definition', 
              details: validation.errors 
            });
          }
        }
        
        const updated = repository.update(req.params.id, {
          name,
          description,
          icon,
          definition,
          params,
          enabled
        });
        
        // Reschedule
        scheduler.rescheduleAgent(req.params.id);
        
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * DELETE /api/agents/:id
     * Delete agent
     */
    async deleteAgent(req, res) {
      try {
        const agent = repository.getById(req.params.id);
        if (!agent) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        
        repository.delete(req.params.id);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * POST /api/agents/:id/run
     * Manually trigger agent
     */
    async runAgent(req, res) {
      try {
        const result = await scheduler.triggerAgent(req.params.id);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/agents/:id/enable
     * Enable agent
     */
    async enableAgent(req, res) {
      try {
        const updated = repository.update(req.params.id, { enabled: true });
        if (!updated) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        scheduler.rescheduleAgent(req.params.id);
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/agents/:id/disable
     * Disable agent
     */
    async disableAgent(req, res) {
      try {
        const updated = repository.update(req.params.id, { enabled: false });
        if (!updated) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * GET /api/agents/:id/runs
     * Get agent run history
     */
    async getAgentRuns(req, res) {
      try {
        const limit = parseInt(req.query.limit) || 20;
        const runs = repository.getRunHistory(req.params.id, limit);
        res.json({ runs });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GET /api/notifications
     * Get all notifications
     */
    async getNotifications(req, res) {
      try {
        const unreadOnly = req.query.unread === 'true';
        const agentId = req.query.agent;
        const limit = parseInt(req.query.limit) || 50;
        
        const notifications = repository.getNotifications({ unreadOnly, agentId, limit });
        const unreadCount = repository.getUnreadCount();
        
        res.json({ notifications, unreadCount });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/notifications/:id/read
     * Mark notification as read
     */
    async markNotificationRead(req, res) {
      try {
        repository.markNotificationRead(parseInt(req.params.id));
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/notifications/read-all
     * Mark all notifications as read
     */
    async markAllNotificationsRead(req, res) {
      try {
        repository.markAllNotificationsRead(req.query.agent);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * DELETE /api/notifications/:id
     * Dismiss notification
     */
    async dismissNotification(req, res) {
      try {
        repository.dismissNotification(parseInt(req.params.id));
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SECRETS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GET /api/secrets
     * List secret names (not values)
     */
    async listSecrets(req, res) {
      if (!requireAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized — set C3_ADMIN_TOKEN and pass as Bearer token' });
      }
      try {
        const secrets = repository.listSecrets();
        res.json({ secrets });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    /**
     * POST /api/secrets
     * Create/update secret
     */
    async setSecret(req, res) {
      if (!requireAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized — set C3_ADMIN_TOKEN and pass as Bearer token' });
      }
      try {
        const { name, value } = req.body;
        if (!name || !value) {
          return res.status(400).json({ error: 'Name and value required' });
        }
        repository.setSecret(name, value);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    /**
     * DELETE /api/secrets/:name
     * Delete secret
     */
    async deleteSecret(req, res) {
      if (!requireAdminAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized — set C3_ADMIN_TOKEN and pass as Bearer token' });
      }
      try {
        repository.deleteSecret(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SCHEDULER STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GET /api/scheduler/status
     * Get scheduler status
     */
    async getSchedulerStatus(req, res) {
      try {
        const status = scheduler.getStatus();
        res.json(status);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT BUILDER (create from natural language)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * POST /api/agents/from-description
     * Create agent definition from natural language description
     */
    async createFromDescription(req, res) {
      try {
        if (!builder) {
          return res.status(503).json({ error: 'Agent Builder not available (no LLM client)' });
        }
        
        const { description } = req.body;
        if (!description) {
          return res.status(400).json({ error: 'Description required' });
        }
        
        const result = await builder.buildFromDescription(description);
        
        if (result.error) {
          return res.status(400).json(result);
        }
        
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/agents/refine
     * Refine agent definition based on user feedback
     */
    async refineAgent(req, res) {
      try {
        if (!builder) {
          return res.status(503).json({ error: 'Agent Builder not available' });
        }
        
        const { definition, feedback } = req.body;
        if (!definition || !feedback) {
          return res.status(400).json({ error: 'Definition and feedback required' });
        }
        
        const result = await builder.refineDefinition(definition, feedback);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/agents/confirm
     * Confirm and save agent definition
     */
    async confirmAgent(req, res) {
      try {
        const { definition, params, forceCreate } = req.body;
        
        // Clean up orphaned references
        const cleanedDef = cleanDefinition(definition);
        
        // Validate
        const validation = validateAgentDefinition(cleanedDef);
        
        // Hard errors block creation completely
        const hardErrors = validation.errors.filter(e => 
          !e.includes('references non-existent') && 
          !e.includes('No triggers defined') &&
          !e.includes('No actions defined')
        );
        
        if (hardErrors.length > 0 && !forceCreate) {
          return res.status(400).json({ 
            error: 'Invalid definition', 
            details: hardErrors,
            warnings: validation.warnings,
            canForce: false
          });
        }
        
        // Soft errors/warnings - allow creation as disabled
        const hasIssues = validation.errors.length > 0 || validation.warnings.length > 0;
        
        // Check duplicate
        if (repository.getById(cleanedDef.id)) {
          return res.status(409).json({ error: 'Agent with this ID already exists' });
        }
        
        // Create (disabled if has issues)
        const agent = repository.create({
          id: cleanedDef.id,
          name: cleanedDef.name,
          description: cleanedDef.description,
          icon: cleanedDef.icon || '🤖',
          definition: cleanedDef,
          params: params || {},
          enabled: !hasIssues
        });
        
        // Schedule only if enabled
        if (agent.enabled) {
          scheduler.scheduleAgent(agent);
        }
        
        res.status(201).json({
          ...agent,
          warnings: validation.warnings,
          softErrors: validation.errors.filter(e => !hardErrors.includes(e))
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SOURCE INSPECTION (Vrstva 1)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * POST /api/sources/inspect
     * Inspect a URL and return metadata + sample + suggested schema
     */
    async inspectSourceUrl(req, res) {
      try {
        const { url } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }
        
        const result = await inspectSource(url);
        
        // Add suggested schema
        if (result.status !== 'error') {
          result.suggestedSchema = SchemaBuilder.fromInspection('source', result).toJSON();
        }
        
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/sources/validate-field
     * Validate a field path against inspected source
     */
    async validateField(req, res) {
      try {
        const { inspection, fieldPath } = req.body;
        
        if (!inspection || !fieldPath) {
          return res.status(400).json({ error: 'inspection and fieldPath required' });
        }
        
        // Check if field exists in structure
        const fields = inspection.structure?.fields || [];
        const exists = fields.some(f => f.path === fieldPath || f.path.includes(fieldPath));
        
        // Get field type if exists
        const field = fields.find(f => f.path === fieldPath);
        
        res.json({
          valid: exists,
          exists,
          type: field?.type || null,
          sample: field?.sample || null,
          suggestion: exists ? null : findSimilarField(fields, fieldPath)
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
    
    /**
     * POST /api/sources/validate-condition
     * Validate a condition against sample data
     */
    async validateCondition(req, res) {
      try {
        const { condition, sampleData } = req.body;
        
        if (!condition) {
          return res.status(400).json({ error: 'condition required' });
        }
        
        // Try to evaluate condition against sample
        const result = evaluateConditionAgainstSample(condition, sampleData);
        
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT HEALTH & MONITORING (B7)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * GET /api/agents/health
     * Overview of all agents with status, last run, error count
     */
    async getAgentsHealth(req, res) {
      try {
        const agents = repository.getAll(true);
        const health = agents.map(agent => {
          const lastRun = repository.getLastRun(agent.id);
          const runs = repository.getRunHistory(agent.id, 50);
          const errorCount = runs.filter(r => r.status === 'error').length;

          let status = 'inactive'; // ⚪
          if (!agent.enabled) {
            status = 'disabled';
          } else if (lastRun) {
            status = lastRun.status === 'error' ? 'error' : 'ok'; // 🔴 / 🟢
          }

          return {
            id: agent.id,
            name: agent.name,
            status,
            enabled: agent.enabled,
            last_run: lastRun ? lastRun.started_at : null,
            last_status: lastRun ? lastRun.status : null,
            error_count: errorCount,
            total_runs: runs.length,
          };
        });

        res.json({ agents: health });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    /**
     * GET /api/agents/:id/notifications
     * Get notifications for a specific agent
     */
    async getAgentNotifications(req, res) {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const notifications = repository.getNotifications({
          agentId: req.params.id,
          limit,
        });
        res.json({ notifications });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },

    /**
     * POST /api/agents/:id/test-notify
     * Test notification delivery for an agent's configured channel
     */
    async testAgentNotification(req, res) {
      try {
        if (!notificationRouter) {
          return res.status(503).json({ error: 'Notification service not initialized' });
        }

        const { channel, recipient } = req.body;
        if (!channel) {
          return res.status(400).json({ error: 'channel is required (email, telegram)' });
        }

        const result = await notificationRouter.testChannel(channel, recipient);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  };
}

/**
 * Find similar field name (for suggestions)
 */
function findSimilarField(fields, path) {
  const fieldName = path.split('.').pop();
  
  for (const f of fields) {
    const name = f.path.split('.').pop();
    if (name.toLowerCase().includes(fieldName.toLowerCase()) ||
        fieldName.toLowerCase().includes(name.toLowerCase())) {
      return f.path;
    }
  }
  return null;
}

/**
 * Evaluate condition against sample data
 */
function evaluateConditionAgainstSample(condition, sampleData) {
  const result = {
    valid: false,
    fieldExists: false,
    fieldType: null,
    sampleValue: null,
    wouldPass: null,
    error: null
  };
  
  try {
    // Get field value from sample
    const fieldPath = condition.field?.replace('sources.', '').split('.');
    let value = sampleData;
    
    for (const part of fieldPath) {
      if (part.includes('[*]')) {
        // Array wildcard
        const key = part.replace('[*]', '');
        if (key) value = value?.[key];
        if (Array.isArray(value)) {
          value = value.map(item => item);
        }
        break;
      }
      value = value?.[part];
    }
    
    result.fieldExists = value !== undefined;
    result.fieldType = Array.isArray(value) ? 'array' : typeof value;
    result.sampleValue = Array.isArray(value) 
      ? value.slice(0, 3) 
      : value;
    
    if (result.fieldExists) {
      result.valid = true;
      
      // Try to evaluate
      if (condition.type === 'compare' && condition.operator && condition.value !== undefined) {
        const compareValue = Array.isArray(value) ? value[0] : value;
        const threshold = parseFloat(condition.value);
        
        switch (condition.operator) {
          case '<': result.wouldPass = compareValue < threshold; break;
          case '>': result.wouldPass = compareValue > threshold; break;
          case '<=': result.wouldPass = compareValue <= threshold; break;
          case '>=': result.wouldPass = compareValue >= threshold; break;
          case '==': result.wouldPass = compareValue == threshold; break;
          case '!=': result.wouldPass = compareValue != threshold; break;
        }
      }
    }
  } catch (err) {
    result.error = err.message;
  }
  
  return result;
}

/**
 * Register routes with Express app
 */
export function registerAgentRoutes(app, deps) {
  const routes = createAgentRoutes(deps);
  
  // Agents CRUD
  app.get('/api/agents', routes.listAgents);
  app.get('/api/agents/:id', routes.getAgent);
  app.post('/api/agents', routes.createAgent);
  app.put('/api/agents/:id', routes.updateAgent);
  app.delete('/api/agents/:id', routes.deleteAgent);
  
  // Agent execution
  app.post('/api/agents/:id/run', routes.runAgent);
  app.post('/api/agents/:id/enable', routes.enableAgent);
  app.post('/api/agents/:id/disable', routes.disableAgent);
  app.get('/api/agents/:id/runs', routes.getAgentRuns);
  
  // Notifications
  app.get('/api/notifications', routes.getNotifications);
  app.post('/api/notifications/:id/read', routes.markNotificationRead);
  app.post('/api/notifications/read-all', routes.markAllNotificationsRead);
  app.delete('/api/notifications/:id', routes.dismissNotification);
  
  // Secrets
  app.get('/api/secrets', routes.listSecrets);
  app.post('/api/secrets', routes.setSecret);
  app.delete('/api/secrets/:name', routes.deleteSecret);
  
  // Scheduler
  app.get('/api/scheduler/status', routes.getSchedulerStatus);
  
  // Agent Builder (create from description)
  app.post('/api/agents/from-description', routes.createFromDescription);
  app.post('/api/agents/refine', routes.refineAgent);
  app.post('/api/agents/confirm', routes.confirmAgent);
  
  // Source Inspection & Validation
  app.post('/api/sources/inspect', routes.inspectSourceUrl);
  app.post('/api/sources/validate-field', routes.validateField);
  app.post('/api/sources/validate-condition', routes.validateCondition);

  // Agent Health & Monitoring (B7)
  app.get('/api/agents/health', routes.getAgentsHealth);
  app.get('/api/agents/:id/notifications', routes.getAgentNotifications);
  app.post('/api/agents/:id/test-notify', routes.testAgentNotification);
}

export default {
  createAgentRoutes,
  registerAgentRoutes
};
