// Automatic legacy learning uses the existing LTM user namespace as an exact
// scope key. Unscoped historical records remain stored but are not inferred to
// belong to any project. No schema rewrite or historical data deletion.
import database from '../db/database.js';
import { readChatMemoryPolicy } from '../db/user-settings.js';
import { LongTermMemory, longTermMemory } from './long-term.js';
import { PreferenceEngine } from './preferences.js';
import { PatternTracker } from './pattern-tracker.js';

const scopes = new Map();
const defaults = new PreferenceEngine();

export function chatMemory(context = {}) {
  const policy = readChatMemoryPolicy(database.db);
  const conversationId = context.conversationId;
  // The conversation's durable association is authoritative, not a project ID
  // supplied by a caller, a cached session, or the model.
  const conversation = typeof conversationId === 'string'
    ? database.db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId)
    : null;
  if (!policy.ltm || !longTermMemory.initialized || !conversation) {
    scopes.clear(); // do not learn from buffered feedback after a disabled interval
    return { policy, ltm: null, preferences: defaults, patterns: null };
  }
  const scope = conversation.project_id === null
    ? ['conversation', conversationId] : ['project', conversation.project_id];
  const key = `chat-scope-v1:${JSON.stringify([longTermMemory.userId, ...scope])}`;
  let entry = scopes.get(key);
  if (entry?.db !== database.db || !policy.learning) entry = null;
  if (!entry) {
    const ltm = new LongTermMemory({ userId: key, db: database.db });
    ltm.initialized = true; // the shared table was initialized by the server
    const preferences = new PreferenceEngine({ longTermMemory: ltm });
    preferences.preferences._ltm = ltm;
    preferences.loadFromMemory(ltm);
    const patterns = new PatternTracker();
    patterns.wire(ltm);
    entry = { db: database.db, ltm, preferences, patterns, scope: Object.freeze(scope) };
    if (scopes.size >= 128) scopes.delete(scopes.keys().next().value);
    scopes.set(key, entry);
  }
  if (!policy.feedback) entry.preferences.preferences.feedbackHistory = [];
  if (!policy.patterns) entry.patterns.recentIntents = [];
  return { ...entry, policy, patterns: policy.patterns ? entry.patterns : null };
}
