// C3 Expertise Wizard — API Helpers
// v63.0 — All backend communication for the wizard
'use strict';

const API_BASE = 'http://localhost:3335';

/**
 * Fetch expertise schema from backend (🔴1 — anti-drift).
 * @returns {Promise<Object>} Schema with moduleSections, limits, capabilityDimensions, etc.
 */
async function fetchSchema() {
  const res = await fetch(`${API_BASE}/api/expertise-schema`);
  if (!res.ok) throw new Error(`Schema fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch all expertises from backend (for parent picker).
 * @returns {Promise<Array>} Array of expertise objects
 */
async function fetchExpertises() {
  const res = await fetch(`${API_BASE}/api/expertises`);
  if (!res.ok) throw new Error(`Expertises fetch failed: ${res.status}`);
  const data = await res.json();
  return data.expertises || [];
}

/**
 * Fetch merge preview with inline configs (POST).
 * @param {Array<Object>} expertises - 1-3 inline expertise configs
 * @returns {Promise<Object>} Preview data
 */
async function fetchPreview(expertises) {
  const res = await fetch(`${API_BASE}/api/merge-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expertises }),
  });
  if (res.status === 429) throw new Error('Rate limited — wait before retrying');
  if (res.status === 409) {
    const data = await res.json();
    return { blocked: true, ...data };
  }
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  return res.json();
}

/**
 * Send test prompt to LLM with inline config.
 * @param {Object} expertiseConfig - Expertise config object
 * @param {string} question - Test question
 * @returns {Promise<Object>} LLM response with model, duration, etc.
 */
async function sendTestPrompt(expertiseConfig, question) {
  const res = await fetch(`${API_BASE}/api/expertise-wizard/test-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expertiseConfig, question }),
  });
  if (res.status === 429) throw new Error('Rate limited — max 1 test per 5 seconds');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Test failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Save expertise (create or update).
 * @param {Object} config - Expertise config
 * @param {string|null} existingId - If editing, the existing expertise ID
 * @returns {Promise<Object>} Saved expertise
 */
async function saveExpertise(config, existingId) {
  const method = existingId ? 'PUT' : 'POST';
  const url = existingId ? `${API_BASE}/api/expertises/${existingId}` : `${API_BASE}/api/expertises`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Save failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Debounce utility.
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

module.exports = {
  fetchSchema,
  fetchExpertises,
  fetchPreview,
  sendTestPrompt,
  saveExpertise,
  debounce,
};
