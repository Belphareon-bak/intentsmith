/**
 * User Profile System
 * 
 * Ukládá osobní preference, kontext a informace o uživateli.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILE_DIR = path.resolve(process.cwd(), "orchestrator/runtime/state/user");
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const PROFILE_PATH = path.join(PROFILE_DIR, "profile.json");
const VAULT_PATH = path.join(PROFILE_DIR, "vault.enc.json");

/**
 * Default profile structure
 */
const DEFAULT_PROFILE = {
  // Basic info
  name: null,
  locale: "en",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  
  // Preferences
  preferences: {
    theme: "dark",
    language: "en",
    verbosity: "normal", // minimal, normal, detailed
    autoApprove: false,
    notifications: true
  },
  
  // Technical preferences
  tech: {
    preferredLanguages: ["JavaScript", "TypeScript", "Python"],
    preferredFrameworks: [],
    codingStyle: "modern", // modern, classic, minimal
    testingApproach: "when-needed", // always, when-needed, minimal
    packageManager: "npm" // npm, yarn, pnpm
  },
  
  // Work context
  work: {
    role: null,
    company: null,
    projects: [],
    currentFocus: null
  },
  
  // Learning & patterns
  patterns: {
    frequentTasks: [],
    preferredWorkflows: [],
    customCommands: {}
  },
  
  // Metadata
  createdAt: null,
  updatedAt: null
};

class UserProfile {
  constructor() {
    this.profile = this.load();
  }

  load() {
    try {
      if (fs.existsSync(PROFILE_PATH)) {
        const data = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
        return { ...DEFAULT_PROFILE, ...data };
      }
    } catch (e) {
      console.error("Failed to load profile:", e.message);
    }
    
    // Create default profile
    const profile = {
      ...DEFAULT_PROFILE,
      createdAt: new Date().toISOString()
    };
    this.save(profile);
    return profile;
  }

  save(profile = this.profile) {
    profile.updatedAt = new Date().toISOString();
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
    this.profile = profile;
  }

  get(key) {
    const keys = key.split(".");
    let value = this.profile;
    
    for (const k of keys) {
      if (value === undefined) return undefined;
      value = value[k];
    }
    
    return value;
  }

  set(key, value) {
    const keys = key.split(".");
    let obj = this.profile;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    
    obj[keys[keys.length - 1]] = value;
    this.save();
    return value;
  }

  update(updates) {
    const merge = (target, source) => {
      for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
          target[key] = target[key] || {};
          merge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };
    
    merge(this.profile, updates);
    this.save();
    return this.profile;
  }

  getAll() {
    return { ...this.profile };
  }

  // Preference shortcuts
  getPreference(key) {
    return this.profile.preferences[key];
  }

  setPreference(key, value) {
    this.profile.preferences[key] = value;
    this.save();
    return value;
  }

  getTechPreference(key) {
    return this.profile.tech[key];
  }

  setTechPreference(key, value) {
    this.profile.tech[key] = value;
    this.save();
    return value;
  }

  // Pattern learning
  recordTask(taskType) {
    const tasks = this.profile.patterns.frequentTasks;
    const existing = tasks.find(t => t.type === taskType);
    
    if (existing) {
      existing.count++;
      existing.lastUsed = new Date().toISOString();
    } else {
      tasks.push({
        type: taskType,
        count: 1,
        firstUsed: new Date().toISOString(),
        lastUsed: new Date().toISOString()
      });
    }
    
    // Keep top 50
    this.profile.patterns.frequentTasks = tasks
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    
    this.save();
  }

  getFrequentTasks(limit = 10) {
    return this.profile.patterns.frequentTasks.slice(0, limit);
  }

  // Custom commands
  setCustomCommand(name, definition) {
    this.profile.patterns.customCommands[name] = {
      ...definition,
      createdAt: new Date().toISOString()
    };
    this.save();
  }

  getCustomCommand(name) {
    return this.profile.patterns.customCommands[name];
  }

  listCustomCommands() {
    return Object.entries(this.profile.patterns.customCommands).map(([name, def]) => ({
      name,
      ...def
    }));
  }

  // Context for LLM
  buildContextPrompt() {
    const p = this.profile;
    let context = "## User Profile\n\n";
    
    if (p.name) context += `Name: ${p.name}\n`;
    context += `Timezone: ${p.timezone}\n`;
    context += `Theme: ${p.preferences.theme}\n`;
    context += `Verbosity: ${p.preferences.verbosity}\n`;
    
    if (p.tech.preferredLanguages.length > 0) {
      context += `\nPreferred Languages: ${p.tech.preferredLanguages.join(", ")}\n`;
    }
    
    if (p.tech.preferredFrameworks.length > 0) {
      context += `Preferred Frameworks: ${p.tech.preferredFrameworks.join(", ")}\n`;
    }
    
    context += `Coding Style: ${p.tech.codingStyle}\n`;
    context += `Package Manager: ${p.tech.packageManager}\n`;
    
    if (p.work.role) context += `\nRole: ${p.work.role}\n`;
    if (p.work.currentFocus) context += `Current Focus: ${p.work.currentFocus}\n`;
    
    const frequentTasks = this.getFrequentTasks(5);
    if (frequentTasks.length > 0) {
      context += `\nFrequent Tasks: ${frequentTasks.map(t => t.type).join(", ")}\n`;
    }
    
    return context;
  }
}

/**
 * Secure Vault (for sensitive data like API keys)
 * 
 * Note: This is a simple implementation. For production,
 * use proper encryption with a master password.
 */
class SecureVault {
  constructor() {
    this.vault = this.load();
  }

  load() {
    try {
      if (fs.existsSync(VAULT_PATH)) {
        // In production, decrypt here
        return JSON.parse(fs.readFileSync(VAULT_PATH, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to load vault:", e.message);
    }
    return { secrets: {} };
  }

  save() {
    // In production, encrypt here
    fs.writeFileSync(VAULT_PATH, JSON.stringify(this.vault, null, 2));
  }

  set(key, value, metadata = {}) {
    this.vault.secrets[key] = {
      value: this.obfuscate(value),
      metadata,
      createdAt: new Date().toISOString()
    };
    this.save();
  }

  get(key) {
    const entry = this.vault.secrets[key];
    if (!entry) return null;
    return this.deobfuscate(entry.value);
  }

  has(key) {
    return key in this.vault.secrets;
  }

  delete(key) {
    delete this.vault.secrets[key];
    this.save();
  }

  list() {
    return Object.keys(this.vault.secrets);
  }

  // Simple obfuscation (NOT secure encryption!)
  // In production, use proper encryption
  obfuscate(value) {
    return Buffer.from(value).toString("base64");
  }

  deobfuscate(value) {
    return Buffer.from(value, "base64").toString("utf-8");
  }
}

// Singletons
export const userProfile = new UserProfile();
export const secureVault = new SecureVault();

export { UserProfile, SecureVault };

export default userProfile;
