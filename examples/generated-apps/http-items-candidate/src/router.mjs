/**
 * router.mjs
 * HTTP request handler for the item service.
 */

import { normalizeItemInput, parseItemId, normalizeBatchInput } from './validation.mjs';

const MAX_URL_LENGTH = 1024;
const MAX_BODY_BYTES = 4096;

/**
 * Creates a typed error for HTTP responses.
 * @param {number} status - HTTP status code.
 * @param {string} code - Error code string.
 * @returns {Error}
 */
function createHttpError(status, code) {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Parses the request URL and validates constraints.
 * @param {string} rawUrl - The raw URL from the request.
 * @returns {{pathname: string, segments: Array<string>}} Parsed pathname and segments.
 */
function parseRequestUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw createHttpError(400, 'invalid_input');
  }

  // Check URL byte length limit
  const urlBytes = Buffer.byteLength(rawUrl, 'utf8');
  if (urlBytes > MAX_URL_LENGTH) {
    throw createHttpError(400, 'invalid_input');
  }

  // Reject query strings
  const qIndex = rawUrl.indexOf('?');
  if (qIndex !== -1) {
    throw createHttpError(400, 'invalid_input');
  }

  // Must start with /
  if (!rawUrl.startsWith('/')) {
    throw createHttpError(400, 'invalid_input');
  }

  const pathname = rawUrl;
  
  // Split into segments, ignoring empty strings from leading/trailing slashes or double slashes
  const parts = pathname.split('/').filter(part => part.length > 0);
  return { pathname, segments: parts };
}

/**
 * Reads the request body with size limit.
 * @param {import('node:http').IncomingMessage} req - The HTTP request object.
 * @returns {Promise<Buffer>} The raw body buffer.
 */
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        // Stop receiving data and reject with 413
        aborted = true;
        req.pause();
        reject(createHttpError(413, 'body_too_large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parses JSON body with validation.
 * @param {Buffer} buffer - The raw body buffer.
 * @returns {*} Parsed JSON value.
 */
function parseJsonBody(buffer) {
  if (buffer.length === 0) {
    throw createHttpError(400, 'invalid_input');
  }

  // Check for valid UTF-8
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text;
  try {
    text = decoder.decode(buffer);
  } catch (e) {
    throw createHttpError(400, 'invalid_input');
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw createHttpError(400, 'invalid_input');
  }
}

/**
 * Validates Content-Type header for JSON requests.
 * @param {string|undefined} contentType - The Content-Type header value.
 */
function validateContentType(contentType) {
  if (!contentType || typeof contentType !== 'string') {
    throw createHttpError(415, 'unsupported_media_type');
  }

  const lower = contentType.toLowerCase().trim();
  // Must be application/json with optional charset=utf-8 (case-insensitive, flexible whitespace)
  if (lower === 'application/json' || /^application\/json;\s*charset=\s*(utf-?8)$/i.test(lower)) {
    return;
  }
  
  throw createHttpError(415, 'unsupported_media_type');
}

/**
 * Sends a JSON response.
 * @param {import('node:http').ServerResponse} res - The HTTP response object.
 * @param {number} status - HTTP status code.
 * @param {*} data - Data to serialize as JSON.
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8')
  });
  res.end(body);
}

/**
 * Creates the HTTP router handler.
 * @param {{list: Function, get: Function, create: Function, replace: Function, remove: Function, createBatch: Function}} store - The item store instance.
 * @returns {Function} Async request handler function.
 */
export function createRouter(store) {
  return async (req, res) => {
    try {
      const method = req.method;
      if (!method || typeof method !== 'string') {
        throw createHttpError(405, 'method_not_allowed');
      }

      const { pathname, segments } = parseRequestUrl(req.url);

      // Route matching logic
      
      // /health
      if (pathname === '/health') {
        if (method !== 'GET') {
          throw createHttpError(405, 'method_not_allowed');
        }
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      // Reject trailing slash aliases for known routes to enforce canonical paths
      if ((pathname === '/health/' || pathname === '/items/' || pathname === '/batch/') && segments.length > 0) {
        throw createHttpError(404, 'not_found');
      }

      // /items
      if (pathname === '/items') {
        if (method === 'GET') {
          const items = store.list();
          sendJson(res, 200, items);
          return;
        } else if (method === 'POST') {
          validateContentType(req.headers['content-type']);
          const bodyBuffer = await readBody(req);
          const data = parseJsonBody(bodyBuffer);
          
          // Validate input
          const normalized = normalizeItemInput(data);
          
          try {
            const created = store.create(normalized);
            sendJson(res, 201, created);
          } catch (err) {
            if (err.status === 409 && err.code === 'duplicate_name') {
              throw createHttpError(409, 'duplicate_name');
            }
            throw err;
          }
          return;
        } else {
          throw createHttpError(405, 'method_not_allowed');
        }
      }

      // /items/:id
      if (segments.length === 2 && segments[0] === 'items') {
        const idRaw = segments[1];
        
        let id;
        try {
          id = parseItemId(idRaw);
        } catch (e) {
          throw createHttpError(400, 'invalid_input');
        }

        if (method === 'GET') {
          const item = store.get(id);
          if (!item) {
            throw createHttpError(404, 'not_found');
          }
          sendJson(res, 200, item);
          return;
        } else if (method === 'PUT') {
          validateContentType(req.headers['content-type']);
          const bodyBuffer = await readBody(req);
          const data = parseJsonBody(bodyBuffer);
          
          // Validate input
          const normalized = normalizeItemInput(data);
          
          try {
            const updated = store.replace(id, normalized);
            if (!updated) {
              throw createHttpError(404, 'not_found');
            }
            sendJson(res, 200, updated);
          } catch (err) {
            if (err.status === 409 && err.code === 'duplicate_name') {
              throw createHttpError(409, 'duplicate_name');
            }
            if (err.status === 404 && err.code === 'not_found') {
              throw err;
            }
            throw err;
          }
          return;
        } else if (method === 'DELETE') {
          const removed = store.remove(id);
          if (!removed) {
            throw createHttpError(404, 'not_found');
          }
          sendJson(res, 200, { deleted: id });
          return;
        } else {
          throw createHttpError(405, 'method_not_allowed');
        }
      }

      // /batch
      if (pathname === '/batch') {
        if (method !== 'POST') {
          throw createHttpError(405, 'method_not_allowed');
        }
        
        validateContentType(req.headers['content-type']);
        const bodyBuffer = await readBody(req);
        const data = parseJsonBody(bodyBuffer);
        
        // Validate batch input
        const normalizedItems = normalizeBatchInput(data);
        
        try {
          const created = store.createBatch(normalizedItems);
          sendJson(res, 201, { items: created });
        } catch (err) {
          if (err.status === 409 && err.code === 'duplicate_name') {
            throw createHttpError(409, 'duplicate_name');
          }
          throw err;
        }
        return;
      }

      // Unknown route
      throw createHttpError(404, 'not_found');

    } catch (err) {
      let status = 500;
      let code = 'internal_error';
      
      if (err.status && typeof err.status === 'number') {
        status = err.status;
      }
      if (err.code && typeof err.code === 'string') {
        code = err.code;
      }

      // Ensure we don't leak internal details for 500 errors
      let bodyData;
      if (status === 400) {
        bodyData = { error: 'invalid_input' };
      } else if (status === 401 || status === 403) {
        bodyData = { error: code };
      } else if (status === 404) {
        bodyData = { error: 'not_found' };
      } else if (status === 405) {
        // Add Allow header based on route
        let allowHeader = '';
        try {
          const { pathname, segments } = parseRequestUrl(req.url);
          if (pathname === '/health') {
            allowHeader = 'GET';
          } else if (pathname === '/items') {
            allowHeader = 'GET, POST';
          } else if (segments.length === 2 && segments[0] === 'items') {
            allowHeader = 'GET, PUT, DELETE';
          } else if (pathname === '/batch') {
            allowHeader = 'POST';
          }
        } catch (_) {}
        
        res.writeHead(405, {
          'Content-Type': 'application/json; charset=utf-8',
          'Allow': allowHeader
        });
        const body = JSON.stringify({ error: 'method_not_allowed' });
        res.end(body);
        return;
      } else if (status === 409) {
        bodyData = { error: 'duplicate_name' };
      } else if (status === 413) {
        bodyData = { error: 'body_too_large' };
      } else if (status === 415) {
        bodyData = { error: 'unsupported_media_type' };
      } else {
        // For 500 and others, use generic internal_error
        bodyData = { error: 'internal_error' };
      }

      sendJson(res, status, bodyData);
    }
  };
}
