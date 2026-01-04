/**
 * Agent Memory System
 * 
 * Poskytuje krátkodobou a dlouhodobou paměť pro agenta.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const MEMORY_DIR = path.resolve(process.cwd(), "orchestrator/runtime/state/memory");

// Ensure memory directory exists
fs.mkdirSync(MEMORY_DIR, { recursive: true });

/**
 * Short-term Memory (session-based, in-memory)
 */
class ShortTermMemory {
  constructor() {
    this.store = new Map();
    this.maxSize = 1000;
  }

  set(key, value, metadata = {}) {
    if (this.store.size >= this.maxSize) {
      // Remove oldest entry
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      metadata,
      timestamp: Date.now()
    });
  }

  get(key) {
    const entry = this.store.get(key);
    return entry?.value;
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  search(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [key, entry] of this.store) {
      const valueStr = JSON.stringify(entry.value).toLowerCase();
      if (key.toLowerCase().includes(queryLower) || valueStr.includes(queryLower)) {
        results.push({ key, ...entry });
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  getRecent(limit = 10) {
    const entries = [...this.store.entries()]
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    
    return entries;
  }

  size() {
    return this.store.size;
  }
}

/**
 * Long-term Memory (persistent, file-based)
 */
class LongTermMemory {
  constructor() {
    this.indexPath = path.join(MEMORY_DIR, "index.json");
    this.index = this.loadIndex();
  }

  loadIndex() {
    try {
      if (fs.existsSync(this.indexPath)) {
        return JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to load memory index:", e.message);
    }
    return { entries: {}, tags: {} };
  }

  saveIndex() {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  generateId() {
    return crypto.randomUUID();
  }

  store(content, metadata = {}) {
    const id = this.generateId();
    const entry = {
      id,
      content,
      metadata,
      tags: metadata.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save entry to file
    const entryPath = path.join(MEMORY_DIR, `${id}.json`);
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));

    // Update index
    this.index.entries[id] = {
      id,
      summary: this.summarize(content),
      tags: entry.tags,
      createdAt: entry.createdAt
    };

    // Update tag index
    for (const tag of entry.tags) {
      if (!this.index.tags[tag]) {
        this.index.tags[tag] = [];
      }
      this.index.tags[tag].push(id);
    }

    this.saveIndex();
    return id;
  }

  summarize(content) {
    // Simple summarization: first 100 chars
    const str = typeof content === "string" ? content : JSON.stringify(content);
    return str.substring(0, 100) + (str.length > 100 ? "..." : "");
  }

  retrieve(id) {
    const entryPath = path.join(MEMORY_DIR, `${id}.json`);
    
    if (!fs.existsSync(entryPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(entryPath, "utf-8"));
  }

  update(id, content, metadata = {}) {
    const entry = this.retrieve(id);
    
    if (!entry) {
      throw new Error(`Memory entry not found: ${id}`);
    }

    entry.content = content;
    entry.metadata = { ...entry.metadata, ...metadata };
    entry.updatedAt = new Date().toISOString();

    const entryPath = path.join(MEMORY_DIR, `${id}.json`);
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));

    // Update index
    this.index.entries[id].summary = this.summarize(content);
    this.saveIndex();

    return id;
  }

  delete(id) {
    const entryPath = path.join(MEMORY_DIR, `${id}.json`);
    
    if (fs.existsSync(entryPath)) {
      fs.unlinkSync(entryPath);
    }

    // Remove from index
    const entry = this.index.entries[id];
    if (entry) {
      for (const tag of entry.tags || []) {
        const tagIndex = this.index.tags[tag];
        if (tagIndex) {
          const idx = tagIndex.indexOf(id);
          if (idx > -1) tagIndex.splice(idx, 1);
        }
      }
      delete this.index.entries[id];
      this.saveIndex();
    }

    return true;
  }

  search(query, options = {}) {
    const { limit = 10, tags = null } = options;
    const queryLower = query.toLowerCase();
    const results = [];

    for (const [id, indexEntry] of Object.entries(this.index.entries)) {
      // Filter by tags if specified
      if (tags && !tags.some(t => indexEntry.tags?.includes(t))) {
        continue;
      }

      // Simple text search in summary
      if (indexEntry.summary.toLowerCase().includes(queryLower)) {
        results.push({
          id,
          ...indexEntry,
          score: 1
        });
      }
    }

    // Sort by creation date (newest first) and limit
    return results
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  findByTag(tag, limit = 10) {
    const ids = this.index.tags[tag] || [];
    return ids.slice(0, limit).map(id => this.index.entries[id]).filter(Boolean);
  }

  listTags() {
    return Object.keys(this.index.tags);
  }

  getStats() {
    return {
      totalEntries: Object.keys(this.index.entries).length,
      totalTags: Object.keys(this.index.tags).length,
      tags: Object.entries(this.index.tags).map(([tag, ids]) => ({
        tag,
        count: ids.length
      }))
    };
  }
}

/**
 * Episodic Memory (conversation/interaction history)
 */
class EpisodicMemory {
  constructor() {
    this.episodesDir = path.join(MEMORY_DIR, "episodes");
    fs.mkdirSync(this.episodesDir, { recursive: true });
  }

  recordEpisode(type, data, metadata = {}) {
    const episode = {
      id: crypto.randomUUID(),
      type,
      data,
      metadata,
      timestamp: new Date().toISOString()
    };

    // Save to daily file
    const date = new Date().toISOString().split("T")[0];
    const dailyPath = path.join(this.episodesDir, `${date}.jsonl`);
    
    fs.appendFileSync(dailyPath, JSON.stringify(episode) + "\n");
    
    return episode.id;
  }

  getEpisodes(date = null, type = null) {
    const targetDate = date || new Date().toISOString().split("T")[0];
    const dailyPath = path.join(this.episodesDir, `${targetDate}.jsonl`);

    if (!fs.existsSync(dailyPath)) {
      return [];
    }

    const lines = fs.readFileSync(dailyPath, "utf-8").trim().split("\n");
    let episodes = lines.filter(Boolean).map(line => JSON.parse(line));

    if (type) {
      episodes = episodes.filter(e => e.type === type);
    }

    return episodes;
  }

  getRecentEpisodes(limit = 20) {
    const files = fs.readdirSync(this.episodesDir)
      .filter(f => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    const episodes = [];
    
    for (const file of files) {
      if (episodes.length >= limit) break;
      
      const filePath = path.join(this.episodesDir, file);
      const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
      
      for (const line of lines.reverse()) {
        if (episodes.length >= limit) break;
        if (line) episodes.push(JSON.parse(line));
      }
    }

    return episodes;
  }
}

/**
 * Procedural Memory (learned procedures/patterns)
 */
class ProceduralMemory {
  constructor() {
    this.proceduresPath = path.join(MEMORY_DIR, "procedures.json");
    this.procedures = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.proceduresPath)) {
        return JSON.parse(fs.readFileSync(this.proceduresPath, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to load procedures:", e.message);
    }
    return {};
  }

  save() {
    fs.writeFileSync(this.proceduresPath, JSON.stringify(this.procedures, null, 2));
  }

  learn(name, procedure) {
    this.procedures[name] = {
      ...procedure,
      name,
      learnedAt: new Date().toISOString(),
      usageCount: 0
    };
    this.save();
    return name;
  }

  get(name) {
    const proc = this.procedures[name];
    if (proc) {
      proc.usageCount++;
      this.save();
    }
    return proc;
  }

  list() {
    return Object.values(this.procedures);
  }

  search(query) {
    const queryLower = query.toLowerCase();
    return Object.values(this.procedures).filter(p => 
      p.name.toLowerCase().includes(queryLower) ||
      (p.description && p.description.toLowerCase().includes(queryLower))
    );
  }

  forget(name) {
    delete this.procedures[name];
    this.save();
  }
}

/**
 * Unified Agent Memory
 */
class AgentMemory {
  constructor() {
    this.shortTerm = new ShortTermMemory();
    this.longTerm = new LongTermMemory();
    this.episodic = new EpisodicMemory();
    this.procedural = new ProceduralMemory();
  }

  // Quick access methods
  remember(key, value, options = {}) {
    const { persistent = false, tags = [] } = options;
    
    // Always store in short-term
    this.shortTerm.set(key, value, { tags });
    
    // Optionally store in long-term
    if (persistent) {
      return this.longTerm.store(value, { key, tags });
    }
    
    return key;
  }

  recall(key) {
    // Try short-term first
    if (this.shortTerm.has(key)) {
      return this.shortTerm.get(key);
    }
    
    // Search long-term
    const results = this.longTerm.search(key, { limit: 1 });
    if (results.length > 0) {
      const entry = this.longTerm.retrieve(results[0].id);
      return entry?.content;
    }
    
    return null;
  }

  search(query, options = {}) {
    const shortTermResults = this.shortTerm.search(query);
    const longTermResults = this.longTerm.search(query, options);
    
    return {
      shortTerm: shortTermResults,
      longTerm: longTermResults
    };
  }

  recordInteraction(type, data) {
    return this.episodic.recordEpisode(type, data);
  }

  getHistory(limit = 20) {
    return this.episodic.getRecentEpisodes(limit);
  }

  learnProcedure(name, procedure) {
    return this.procedural.learn(name, procedure);
  }

  getProcedure(name) {
    return this.procedural.get(name);
  }

  getStats() {
    return {
      shortTerm: this.shortTerm.size(),
      longTerm: this.longTerm.getStats(),
      procedures: this.procedural.list().length
    };
  }

  // Context building for LLM
  buildContext(options = {}) {
    const { maxItems = 5, includeHistory = true, includeProcedures = false } = options;
    
    let context = "";
    
    // Recent short-term memories
    const recentShort = this.shortTerm.getRecent(maxItems);
    if (recentShort.length > 0) {
      context += "## Recent Context\n";
      for (const item of recentShort) {
        context += `- ${item.key}: ${JSON.stringify(item.value).substring(0, 200)}\n`;
      }
      context += "\n";
    }
    
    // Recent interactions
    if (includeHistory) {
      const history = this.episodic.getRecentEpisodes(maxItems);
      if (history.length > 0) {
        context += "## Recent Interactions\n";
        for (const ep of history) {
          context += `- [${ep.type}] ${JSON.stringify(ep.data).substring(0, 200)}\n`;
        }
        context += "\n";
      }
    }
    
    // Learned procedures
    if (includeProcedures) {
      const procs = this.procedural.list().slice(0, maxItems);
      if (procs.length > 0) {
        context += "## Known Procedures\n";
        for (const proc of procs) {
          context += `- ${proc.name}: ${proc.description || "No description"}\n`;
        }
        context += "\n";
      }
    }
    
    return context;
  }
}

// Singleton instance
export const agentMemory = new AgentMemory();

export {
  ShortTermMemory,
  LongTermMemory,
  EpisodicMemory,
  ProceduralMemory,
  AgentMemory
};

export default agentMemory;
