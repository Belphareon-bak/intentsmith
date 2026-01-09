// C.3 v28 LLM Client
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// OLLAMA CLIENT
// ════════════════════════════════════════════════════════════════════════════

export async function callOllama(role, prompt, systemPrompt = '', options = {}) {
  const model = config.models[role] || config.models.CHAT;
  const timeout = config.timeouts[role] || 60000;
  
  logger.info('LLM', `Calling ${role}`, { model, promptLength: prompt.length });
  logger.debug('LLM', `Prompt preview: ${prompt.substring(0, 200)}...`);
  
  const timer = logger.time('LLM', `${role} (${model})`);
  
  const body = {
    model,
    prompt,
    system: systemPrompt,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.3,
      num_predict: options.maxTokens ?? 4096,
      ...options,
    },
  };
  
  let lastError;
  
  for (let attempt = 1; attempt <= config.ollama.retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(`${config.ollama.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      const output = data.response || '';
      
      const duration = timer.end(`(${output.length} chars)`);
      
      logger.debug('LLM', `Response preview: ${output.substring(0, 200)}...`);
      
      return {
        content: output,
        model,
        duration,
        role,
      };
      
    } catch (err) {
      lastError = err;
      
      if (err.name === 'AbortError') {
        logger.warn('LLM', `Timeout after ${timeout}ms (attempt ${attempt}/${config.ollama.retries})`, { role, model });
      } else {
        logger.warn('LLM', `Error (attempt ${attempt}/${config.ollama.retries}): ${err.message}`);
      }
      
      if (attempt < config.ollama.retries) {
        await sleep(config.ollama.retryDelay * attempt);
      }
    }
  }
  
  throw new Error(`LLM failed after ${config.ollama.retries} attempts: ${lastError?.message}`);
}

// ════════════════════════════════════════════════════════════════════════════
// JSON EXTRACTION (ROBUST)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract JSON from LLM response - handles various formats
 * 
 * Handles:
 * - Clean JSON: { "key": "value" }
 * - Markdown code block: ```json { ... } ```
 * - Mixed text with JSON: "Here's the plan: { ... }"
 * - Broken JSON with common issues
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // 1. Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {}
  
  // 2. Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }
  
  // 3. Find JSON object boundaries
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const jsonCandidate = text.substring(jsonStart, jsonEnd + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch {
      // 4. Try to fix common JSON issues
      const fixed = fixBrokenJSON(jsonCandidate);
      try {
        return JSON.parse(fixed);
      } catch {}
    }
  }
  
  // 5. Try array format
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const arrayCandidate = text.substring(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(arrayCandidate);
    } catch {
      const fixed = fixBrokenJSON(arrayCandidate);
      try {
        return JSON.parse(fixed);
      } catch {}
    }
  }
  
  logger.warn('LLM', 'Failed to extract JSON from response');
  return null;
}

/**
 * Try to fix common JSON formatting issues from LLMs
 */
function fixBrokenJSON(str) {
  let fixed = str;
  
  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  
  // Fix unquoted keys (basic)
  fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
  // Fix single quotes to double quotes
  fixed = fixed.replace(/'/g, '"');
  
  // Remove control characters
  fixed = fixed.replace(/[\x00-\x1F\x7F]/g, ' ');
  
  // Fix escaped newlines in strings
  fixed = fixed.replace(/\\n/g, '\\n');
  
  return fixed;
}

// ════════════════════════════════════════════════════════════════════════════
// CODE BLOCK EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract code blocks with file paths from LLM response
 * 
 * Handles formats:
 * - ### Soubor: `/path/file.js`
 * - ### File: `/path/file.js`
 * - `/path/file.js`:
 * - ```javascript:path/file.js
 */
export function extractCodeBlocks(text) {
  const blocks = [];
  
  // Pattern 1: ### Soubor: `/path/file.js` followed by code block
  const pattern1 = /###\s*(?:Soubor|File):\s*`([^`]+)`[\s\S]*?```(?:\w+)?\s*([\s\S]*?)```/gi;
  let match;
  
  while ((match = pattern1.exec(text)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2].trim(),
    });
  }
  
  if (blocks.length > 0) return blocks;
  
  // Pattern 2: ```language:path/file.js or ```language /path/file.js
  const pattern2 = /```(\w+)[:\/\s]+([^\n`]+)\n([\s\S]*?)```/gi;
  
  while ((match = pattern2.exec(text)) !== null) {
    const possiblePath = match[2].trim();
    // Only if it looks like a path
    if (possiblePath.includes('/') || possiblePath.includes('.')) {
      blocks.push({
        path: possiblePath,
        content: match[3].trim(),
        language: match[1],
      });
    }
  }
  
  if (blocks.length > 0) return blocks;
  
  // Pattern 3: Simple path followed by code block
  const pattern3 = /(?:^|\n)`?([\/\w.-]+\.\w+)`?:?\s*\n```(?:\w+)?\s*([\s\S]*?)```/gi;
  
  while ((match = pattern3.exec(text)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2].trim(),
    });
  }
  
  return blocks;
}

/**
 * Extract file modifications in JSON format
 * Expected format: { "modified_files": [{ "path": "...", "content": "..." }] }
 */
export function extractModifiedFiles(text) {
  // First try JSON extraction
  const json = extractJSON(text);
  
  if (json?.modified_files && Array.isArray(json.modified_files)) {
    return json.modified_files;
  }
  
  // Fallback to code block extraction
  const blocks = extractCodeBlocks(text);
  if (blocks.length > 0) {
    logger.debug('LLM', `Extracted ${blocks.length} files from code blocks (fallback)`);
    return blocks.map(b => ({ path: b.path, content: b.content }));
  }
  
  return [];
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a hash for learning system
 */
export function hashQuestion(question) {
  let hash = 0;
  const str = question.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `q_${Math.abs(hash).toString(16)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  callOllama,
  extractJSON,
  extractCodeBlocks,
  extractModifiedFiles,
  hashQuestion,
};
