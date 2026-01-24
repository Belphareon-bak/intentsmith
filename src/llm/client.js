// C.3 v36.7 LLM Client
// ══════════════════════════════════════════════════════════════════════════════
//
// v36.7: All calls now go through LLMGateway
// This file provides backward-compatible wrappers for legacy code.
// 
// MIGRATION: All direct callOllama() calls should migrate to using
// auth tokens via llmGateway.authorize() / llmGateway.call()
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { legacyCall, llmGateway } from './gateway.js';

// ════════════════════════════════════════════════════════════════════════════
// LEGACY OLLAMA CLIENT (routes through Gateway)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Call Ollama LLM (LEGACY - use llmGateway.call() with auth token instead)
 *
 * v36.9: This function is DEPRECATED. All LLM calls must use auth tokens.
 * Will throw unless ALLOW_LEGACY_LLM=1 environment variable is set.
 *
 * @deprecated Use llmGateway with auth token instead
 */
export async function callOllama(role, prompt, systemPrompt = '', options = {}) {
  // v36.9: LOUD deprecation warning
  logger.warn('LLM', `[DEPRECATED] callOllama() called with role: ${role}. MIGRATE TO AUTH TOKENS.`);

  // Route through gateway - gateway will enforce auth check
  const result = await legacyCall(role, prompt, systemPrompt, {
    ...options,
    model: config.models?.[role] || config.models?.CHAT
  });

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// OLLAMA VISION CLIENT
// ════════════════════════════════════════════════════════════════════════════
// NOTE: Vision uses /api/generate endpoint which is different from chat.
// TODO v36.8: Route vision calls through gateway with special handling

/**
 * Call Ollama vision model with image(s)
 *
 * v36.9: DEPRECATED - bypasses gateway. Requires ALLOW_LEGACY_LLM=1.
 *
 * @deprecated Migrate to gateway with vision support
 * @param {string} prompt - Text prompt
 * @param {string[]} images - Array of base64 encoded images (without data: prefix)
 * @param {string} systemPrompt - System prompt
 * @returns {Promise<{content: string, model: string, duration: number}>}
 */
export async function callOllamaVision(prompt, images, systemPrompt = '') {
  // v36.9: Hard guard - vision bypasses gateway, requires env flag
  if (process.env.ALLOW_LEGACY_LLM !== '1') {
    throw new Error('LLM_CALL_OUTSIDE_CRE: callOllamaVision() bypasses LLMGateway. Set ALLOW_LEGACY_LLM=1 to allow, or migrate to gateway with vision support.');
  }

  logger.warn('LLM', '[DEPRECATED] VISION CALL - bypasses gateway. MIGRATE TO AUTH TOKENS.');
  
  const model = config.models.VISION || 'llava:13b';
  const timeout = config.timeouts.VISION || 60000;
  
  logger.info('LLM', `Calling VISION`, { model, imageCount: images.length });
  
  const timer = logger.time('LLM', `VISION (${model})`);
  
  const body = {
    model,
    prompt,
    system: systemPrompt,
    images, // Base64 encoded images
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 2048,
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
        const errorText = await response.text();
        // Check if model not found
        if (errorText.includes('not found') || errorText.includes('does not exist')) {
          throw new Error(`Vision model "${model}" not installed. Run: ollama pull ${model}`);
        }
        throw new Error(`Ollama HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      const output = data.response || '';
      
      const duration = timer.end(`(${output.length} chars)`);
      
      return {
        content: output,
        model,
        duration,
        role: 'VISION',
      };
      
    } catch (err) {
      lastError = err;
      
      if (err.name === 'AbortError') {
        logger.warn('LLM', `Vision timeout after ${timeout}ms (attempt ${attempt})`);
      } else {
        logger.warn('LLM', `Vision error (attempt ${attempt}): ${err.message}`);
      }
      
      if (attempt < config.ollama.retries) {
        await sleep(config.ollama.retryDelay * attempt);
      }
    }
  }
  
  throw new Error(`Vision failed: ${lastError?.message}`);
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
  let match;
  
  // Pattern 1: ### Soubor: `/path/file.js` followed by code block
  const pattern1 = /###\s*(?:Soubor|File):\s*`([^`]+)`[\s\S]*?```(?:\w+)?\s*([\s\S]*?)```/gi;
  
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
  
  if (blocks.length > 0) return blocks;
  
  // Pattern 4: **path/file.js** or **`path/file.js`** followed by code block
  const pattern4 = /\*\*`?([\/\w.-]+\.\w+)`?\*\*[:\s]*\n```(?:\w+)?\s*([\s\S]*?)```/gi;
  
  while ((match = pattern4.exec(text)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2].trim(),
    });
  }
  
  if (blocks.length > 0) return blocks;
  
  // Pattern 5: // filename.js comment at start of code block
  const pattern5 = /```(?:\w+)?\s*\n\/\/\s*([\/\w.-]+\.\w+)\n([\s\S]*?)```/gi;
  
  while ((match = pattern5.exec(text)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: `// ${match[1].trim()}\n${match[2].trim()}`,
    });
  }
  
  return blocks;
}

/**
 * Extract file modifications in JSON format
 * Expected format: { "modified_files": [{ "path": "...", "content": "..." }] }
 */
export function extractModifiedFiles(text) {
  // Debug: log first 500 chars of response
  logger.debug('LLM', `CODER response preview: ${text?.substring(0, 500)}...`);
  
  // First try JSON extraction
  const json = extractJSON(text);
  
  if (json?.modified_files && Array.isArray(json.modified_files)) {
    logger.debug('LLM', `Extracted ${json.modified_files.length} files from JSON`);
    return json.modified_files;
  }
  
  // Try files array directly (some models return this format)
  if (json?.files && Array.isArray(json.files)) {
    logger.debug('LLM', `Extracted ${json.files.length} files from JSON (files key)`);
    return json.files.map(f => ({ path: f.path || f.filename, content: f.content || f.code }));
  }
  
  // Fallback to code block extraction
  const blocks = extractCodeBlocks(text);
  if (blocks.length > 0) {
    logger.debug('LLM', `Extracted ${blocks.length} files from code blocks (fallback)`);
    return blocks.map(b => ({ path: b.path, content: b.content }));
  }
  
  // Last resort: try to find any JSON array with path/content
  const arrayMatch = text?.match(/\[\s*\{[\s\S]*?"path"[\s\S]*?"content"[\s\S]*?\}\s*\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        logger.debug('LLM', `Extracted ${arr.length} files from embedded array`);
        return arr;
      }
    } catch {}
  }
  
  logger.warn('LLM', 'No files extracted from CODER response', { 
    textLength: text?.length,
    hasJson: !!json,
    jsonKeys: json ? Object.keys(json) : []
  });
  
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
