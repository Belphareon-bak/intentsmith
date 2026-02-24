// Quality Telemetry — Compute + Log Quality Scores
// ══════════════════════════════════════════════════════════════════════════════
// Observational layer. Never blocks operations. Failures are swallowed.
//
// Integration points:
//   approveSpec()       → logSpecScore()
//   generateRoadmap()   → logRoadmapScore()
//   applyChange()       → logChangeScore()
//
// Query functions:
//   getScoreHistory(lifecycleId)
//   getLatestScores(lifecycleId)
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { qualityScores } from '../db/database.js';
import {
  computeSpecScore,
  computeRoadmapScore,
  computeChangeScore,
  computeLifecycleScore,
} from './quality-score.js';

/**
 * Compute and log spec quality score.
 * @param {string} lifecycleId
 * @param {Object} spec
 * @param {number} [version=1] - Spec attempt number
 * @returns {{ score: number, label: string, breakdown: Object } | null}
 */
export function logSpecScore(lifecycleId, spec, version = 1) {
  try {
    const result = computeSpecScore(spec);
    qualityScores.log(lifecycleId, 'spec', version, result.score, result.label, result.breakdown);

    logger.info('QualityTelemetry', `Spec score: ${result.score} (${result.label})`, {
      lifecycleId,
      version,
      breakdown: result.breakdown,
    });

    return result;
  } catch (err) {
    logger.warn('QualityTelemetry', `Failed to log spec score: ${err.message}`, { lifecycleId });
    return null;
  }
}

/**
 * Compute and log roadmap quality score.
 * @param {string} lifecycleId
 * @param {Object} roadmap
 * @param {number} version - Roadmap version number
 * @returns {{ score: number, label: string, breakdown: Object } | null}
 */
export function logRoadmapScore(lifecycleId, roadmap, version) {
  try {
    const result = computeRoadmapScore(roadmap);
    qualityScores.log(lifecycleId, 'roadmap', version, result.score, result.label, result.breakdown);

    logger.info('QualityTelemetry', `Roadmap score: ${result.score} (${result.label})`, {
      lifecycleId,
      version,
      breakdown: result.breakdown,
    });

    return result;
  } catch (err) {
    logger.warn('QualityTelemetry', `Failed to log roadmap score: ${err.message}`, { lifecycleId });
    return null;
  }
}

/**
 * Compute and log change impact quality score.
 * @param {string} lifecycleId
 * @param {Object} analysis - Change impact analysis
 * @param {string} changeRequestId
 * @returns {{ score: number, label: string, breakdown: Object } | null}
 */
export function logChangeScore(lifecycleId, analysis, changeRequestId) {
  try {
    const result = computeChangeScore(analysis);
    // Use changeRequestId hash as version identifier
    const version = parseInt(changeRequestId?.replace(/\D/g, '').slice(-4) || '0', 10);
    qualityScores.log(lifecycleId, 'change', version, result.score, result.label, result.breakdown);

    logger.info('QualityTelemetry', `Change score: ${result.score} (${result.label})`, {
      lifecycleId,
      changeRequestId,
      breakdown: result.breakdown,
    });

    return result;
  } catch (err) {
    logger.warn('QualityTelemetry', `Failed to log change score: ${err.message}`, { lifecycleId });
    return null;
  }
}

/**
 * Compute and log lifecycle aggregate score.
 * @param {string} lifecycleId
 * @returns {{ score: number, label: string } | null}
 */
export function logLifecycleScore(lifecycleId) {
  try {
    const specEntry = qualityScores.getLatest(lifecycleId, 'spec');
    const roadmapEntry = qualityScores.getLatest(lifecycleId, 'roadmap');
    const changeEntry = qualityScores.getLatest(lifecycleId, 'change');

    const result = computeLifecycleScore({
      spec_score: specEntry?.score || 0,
      roadmap_score: roadmapEntry?.score || 0,
      change_score: changeEntry ? changeEntry.score : null,
    });

    qualityScores.log(lifecycleId, 'lifecycle', null, result.score, result.label, {
      spec_score: specEntry?.score || 0,
      roadmap_score: roadmapEntry?.score || 0,
      change_score: changeEntry?.score ?? null,
    });

    logger.info('QualityTelemetry', `Lifecycle score: ${result.score} (${result.label})`, {
      lifecycleId,
    });

    return result;
  } catch (err) {
    logger.warn('QualityTelemetry', `Failed to log lifecycle score: ${err.message}`, { lifecycleId });
    return null;
  }
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Get full score history for a lifecycle.
 * @param {string} lifecycleId
 * @returns {Object[]}
 */
export function getScoreHistory(lifecycleId) {
  return qualityScores.getHistory(lifecycleId);
}

/**
 * Get latest scores per artifact type.
 * @param {string} lifecycleId
 * @returns {{ spec: Object|null, roadmap: Object|null, change: Object|null, lifecycle: Object|null }}
 */
export function getLatestScores(lifecycleId) {
  return {
    spec: qualityScores.getLatest(lifecycleId, 'spec'),
    roadmap: qualityScores.getLatest(lifecycleId, 'roadmap'),
    change: qualityScores.getLatest(lifecycleId, 'change'),
    lifecycle: qualityScores.getLatest(lifecycleId, 'lifecycle'),
  };
}

/**
 * Get score trend for a specific artifact type.
 * @param {string} lifecycleId
 * @param {string} artifactType
 * @returns {Object[]}
 */
export function getScoreTrend(lifecycleId, artifactType) {
  return qualityScores.getByType(lifecycleId, artifactType);
}

export default {
  logSpecScore,
  logRoadmapScore,
  logChangeScore,
  logLifecycleScore,
  getScoreHistory,
  getLatestScores,
  getScoreTrend,
};
