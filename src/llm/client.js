// C.3 LLM Client — Utilities
// ══════════════════════════════════════════════════════════════════════════════
//
// v78: Cleaned up — legacy callOllama/callOllamaVision removed.
// All LLM calls go through LLMGateway (gateway.js) with auth tokens.
//
// This file provides utility functions for LLM response parsing:
//   - extractJSON()          — robust JSON extraction from LLM output
//   - extractCodeBlocks()    — code block extraction with file paths
//   - extractModifiedFiles() — file modification extraction (JSON + fallback)
//   - hashQuestion()         — deterministic question hashing
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

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

  // Helper: try to parse, return null on failure
  const tryParse = (str, strategy) => {
    try {
      return JSON.parse(str);
    } catch (err) {
      logger.debug('LLM', `JSON parse failed (${strategy}): ${err.message.slice(0, 50)}`);
      return null;
    }
  };
  
  // 1. Try direct parse first
  let result = tryParse(text.trim(), 'direct');
  if (result !== null) return result;
  
  // 2. Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    result = tryParse(codeBlockMatch[1].trim(), 'codeblock');
    if (result !== null) return result;
  }
  
  // 3. Find JSON object boundaries
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const jsonCandidate = text.substring(jsonStart, jsonEnd + 1);
    result = tryParse(jsonCandidate, 'extracted-object');
    if (result !== null) return result;
    
    // 4. Try to fix common JSON issues
    const fixed = fixBrokenJSON(jsonCandidate);
    result = tryParse(fixed, 'fixed-object');
    if (result !== null) return result;
  }
  
  // 5. Try array format
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const arrayCandidate = text.substring(arrayStart, arrayEnd + 1);
    result = tryParse(arrayCandidate, 'extracted-array');
    if (result !== null) return result;
    
    const fixed = fixBrokenJSON(arrayCandidate);
    result = tryParse(fixed, 'fixed-array');
    if (result !== null) return result;
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
    } catch (err) {
      logger.debug('LLM', `Embedded array parse failed: ${err.message.slice(0, 50)}`);
    }
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
  extractJSON,
  extractCodeBlocks,
  extractModifiedFiles,
  hashQuestion,
};
