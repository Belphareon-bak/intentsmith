// Shell Command Parser — shlex-style argv splitting
// ══════════════════════════════════════════════════════════════════════════════
// Splits a shell command string into [binary, ...args] without invoking a shell.
// Handles single quotes, double quotes, backslash escaping, and pipes/chains.

/**
 * Split a shell command string into argv tokens (shlex-style).
 * Does NOT expand globs, env vars, or subshells — that's intentional for security.
 *
 * @param {string} command - Shell command string
 * @returns {string[]} Array of tokens
 * @throws {Error} If command contains shell operators (pipes, chains, redirects)
 */
export function parseCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string');
  }

  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error('Command must be a non-empty string');
  }

  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    // Outside quotes — check for shell operators
    if (!inSingle && !inDouble) {
      // Reject shell operators that would require shell interpretation
      if (ch === '|' || ch === '&' || ch === ';') {
        throw new Error(`Shell operator "${ch}" is not allowed — use separate commands`);
      }
      if (ch === '>' || ch === '<') {
        throw new Error(`Redirect operator "${ch}" is not allowed`);
      }
      if (ch === '`') {
        throw new Error('Backtick subshell is not allowed');
      }
      if (ch === '$' && i + 1 < trimmed.length && trimmed[i + 1] === '(') {
        throw new Error('$() subshell is not allowed');
      }

      // Whitespace = token boundary
      if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
    }

    current += ch;
  }

  if (inSingle) throw new Error('Unterminated single quote');
  if (inDouble) throw new Error('Unterminated double quote');

  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error('Empty command after parsing');
  }

  return tokens;
}
