// Semantic Code Index — Embedding-based code search
// ══════════════════════════════════════════════════════════════════════════════
//
// Architecture:
//   - Chunks code into semantic units (functions, classes, blocks)
//   - Generates embeddings via Ollama or falls back to TF-IDF
//   - In-memory vector store with cosine similarity
//   - Incremental updates via git diff
//
// Embedding priority:
//   1. Ollama embedding model (nomic-embed-text, bge-code, etc.)
//   2. TF-IDF fallback (no external deps, deterministic)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles } from './index-builder.js';
import { chunkCode, chunkFixed } from './chunker.js';
import { readFile } from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE = 512 * 1024;

// ─── TF-IDF Fallback ─────────────────────────────────────────────────────────

/**
 * Simple TF-IDF vectorizer for code search.
 * No external dependencies. Deterministic.
 */
class TFIDFVectorizer {
  constructor() {
    this.vocabulary = new Map();  // term → index
    this.idf = new Map();         // term → IDF value
    this.vocabSize = 0;
  }

  /**
   * Fit vocabulary and IDF from a corpus of documents.
   */
  fit(documents) {
    const df = new Map(); // document frequency
    const termSet = new Set();

    for (const doc of documents) {
      const terms = tokenize(doc);
      const unique = new Set(terms);
      for (const t of unique) {
        termSet.add(t);
        df.set(t, (df.get(t) || 0) + 1);
      }
    }

    // Build vocabulary (sorted for determinism)
    const sortedTerms = [...termSet].sort();
    this.vocabulary.clear();
    for (let i = 0; i < sortedTerms.length; i++) {
      this.vocabulary.set(sortedTerms[i], i);
    }
    this.vocabSize = sortedTerms.length;

    // Compute IDF
    const N = documents.length;
    this.idf.clear();
    for (const [term, count] of df) {
      this.idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
    }
  }

  /**
   * Transform a document to a TF-IDF vector.
   * @returns {Float32Array}
   */
  transform(document) {
    const vec = new Float32Array(this.vocabSize);
    const terms = tokenize(document);
    const tf = new Map();

    for (const t of terms) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const [term, count] of tf) {
      const idx = this.vocabulary.get(term);
      if (idx !== undefined) {
        vec[idx] = count * (this.idf.get(term) || 1);
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    return vec;
  }
}

function tokenize(text) {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')     // camelCase split (before lowercase!)
    .replace(/_/g, ' ')                        // snake_case split
    .toLowerCase()                             // lowercase after splits
    .replace(/[^a-z0-9\s]/g, ' ')              // remove punctuation
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 30);
}

// ─── Cosine Similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Ollama Embeddings ───────────────────────────────────────────────────────

async function getOllamaEmbedding(text, model) {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding ? new Float32Array(data.embedding) : null;
  } catch {
    return null;
  }
}

async function detectEmbeddingModel() {
  const candidates = ['nomic-embed-text', 'bge-code', 'mxbai-embed-large', 'all-minilm'];

  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const models = (data.models || []).map(m => m.name.split(':')[0]);

    for (const candidate of candidates) {
      if (models.includes(candidate)) return candidate;
    }
  } catch {
    // Ollama not available
  }

  return null;
}

// ─── Semantic Index ──────────────────────────────────────────────────────────

export class SemanticIndex {
  constructor() {
    this._chunks = [];        // CodeChunk[]
    this._vectors = [];       // Float32Array[]
    this._vectorizer = null;  // TFIDFVectorizer | null
    this._embeddingModel = null;
    this._useOllama = false;
    this._projectPath = null;
    this._buildTime = 0;
    this._building = false;
  }

  /**
   * Build semantic index for a project.
   *
   * @param {string} projectPath
   * @param {Object} [opts]
   * @param {number} [opts.maxFiles=1000]
   * @param {string} [opts.embeddingModel] - Override embedding model
   * @param {boolean} [opts.forceLocal=false] - Skip Ollama, use TF-IDF
   * @returns {Promise<{chunkCount: number, buildTime: number, engine: string}>}
   */
  async buildIndex(projectPath, opts = {}) {
    if (this._building) {
      return { chunkCount: this._chunks.length, buildTime: this._buildTime, engine: this._useOllama ? 'ollama' : 'tfidf' };
    }

    this._building = true;
    this._projectPath = projectPath;
    const start = Date.now();

    try {
      this._chunks = [];
      this._vectors = [];

      // Detect embedding engine
      if (!opts.forceLocal) {
        this._embeddingModel = opts.embeddingModel || await detectEmbeddingModel();
        this._useOllama = !!this._embeddingModel;
      }

      const engine = this._useOllama ? `ollama:${this._embeddingModel}` : 'tfidf';
      logger.info('SemanticIndex', `Building with engine: ${engine}`);

      // Collect and chunk files
      const files = await collectCodeFiles(projectPath, opts.maxFiles || 1000);

      for (const file of files) {
        try {
          const absPath = path.join(projectPath, file);
          const content = await readFile(absPath, 'utf8');
          if (content.length > MAX_FILE_SIZE) continue;

          let chunks = chunkCode(content, file);
          if (chunks.length === 0) {
            chunks = chunkFixed(content, file);
          }

          this._chunks.push(...chunks);
        } catch {
          // skip unreadable files
        }
      }

      // Generate vectors
      if (this._useOllama) {
        await this._buildOllamaVectors();
      } else {
        this._buildTFIDFVectors();
      }

      this._buildTime = Date.now() - start;

      logger.info('SemanticIndex', `Index built: ${this._chunks.length} chunks (${this._buildTime}ms, ${engine})`);

      return {
        chunkCount: this._chunks.length,
        buildTime: this._buildTime,
        engine,
      };
    } finally {
      this._building = false;
    }
  }

  _buildTFIDFVectors() {
    const docs = this._chunks.map(c => c.content);
    this._vectorizer = new TFIDFVectorizer();
    this._vectorizer.fit(docs);

    this._vectors = docs.map(doc => this._vectorizer.transform(doc));
  }

  async _buildOllamaVectors() {
    for (const chunk of this._chunks) {
      const vec = await getOllamaEmbedding(chunk.content, this._embeddingModel);
      if (vec) {
        this._vectors.push(vec);
      } else {
        // Fallback for this chunk: zero vector
        this._vectors.push(new Float32Array(384));
      }
    }
  }

  /**
   * Semantic search: find chunks most similar to a query.
   *
   * @param {string} query
   * @param {number} [topK=10]
   * @returns {Promise<Array<{chunk: CodeChunk, score: number}>>}
   */
  async semanticSearch(query, topK = 10) {
    if (this._chunks.length === 0 || this._vectors.length === 0) return [];

    let queryVec;

    if (this._useOllama && this._embeddingModel) {
      queryVec = await getOllamaEmbedding(query, this._embeddingModel);
    }

    if (!queryVec && this._vectorizer) {
      queryVec = this._vectorizer.transform(query);
    }

    if (!queryVec) return [];

    // Compute similarities
    const scores = [];
    for (let i = 0; i < this._vectors.length; i++) {
      const sim = cosineSimilarity(queryVec, this._vectors[i]);
      if (sim > 0.01) { // Skip near-zero
        scores.push({ idx: i, score: sim });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top-K
    return scores.slice(0, topK).map(s => ({
      chunk: this._chunks[s.idx],
      score: s.score,
    }));
  }

  /**
   * Get index statistics.
   */
  getStats() {
    return {
      projectPath: this._projectPath,
      chunkCount: this._chunks.length,
      vectorCount: this._vectors.length,
      engine: this._useOllama ? `ollama:${this._embeddingModel}` : 'tfidf',
      buildTime: this._buildTime,
      building: this._building,
      vocabSize: this._vectorizer?.vocabSize || 0,
    };
  }

  /**
   * Clear the index.
   */
  clear() {
    this._chunks = [];
    this._vectors = [];
    this._vectorizer = null;
    this._projectPath = null;
    this._buildTime = 0;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const semanticIndex = new SemanticIndex();

// ─── Exports for testing ─────────────────────────────────────────────────────

export { TFIDFVectorizer, cosineSimilarity, tokenize };

export default { SemanticIndex, semanticIndex };
