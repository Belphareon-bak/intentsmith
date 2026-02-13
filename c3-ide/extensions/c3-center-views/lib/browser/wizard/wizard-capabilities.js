// C3 Expertise Wizard — Capabilities Section
// v63.0 — 5D capability sliders with gradient hints (🟢8)
'use strict';

const DIMENSION_LABELS = {
  reasoning: 'Reasoning',
  creativity: 'Kreativita',
  determinism: 'Determinismus',
  riskTolerance: 'Risk Tolerance',
  verbosity: 'Verbozita',
};

/**
 * Get hint level and label for a capability value.
 * @param {number} val - 0-100
 * @returns {{ level: string, label: string }}
 */
function getHint(val) {
  if (val <= 30) return { level: 'low', label: 'LOW' };
  if (val <= 70) return { level: 'medium', label: 'MEDIUM' };
  return { level: 'high', label: 'HIGH' };
}

/**
 * Render 5D capability sliders.
 * @param {Function} h - React.createElement
 * @param {Object} capabilities - { reasoning, creativity, determinism, riskTolerance, verbosity }
 * @param {Object} schema - Schema from backend (capabilityDimensions)
 * @param {Function} onChange - Callback: (dimension, value) => void
 * @returns {ReactElement}
 */
function renderCapabilities(h, capabilities, schema, onChange) {
  const dimensions = (schema && schema.capabilityDimensions) ||
    ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'];
  const caps = capabilities || {};

  return h('div', { className: 'c3-wiz-caps' },
    ...dimensions.map(dim => {
      const val = caps[dim] ?? 50;
      const hint = getHint(val);
      return h('div', { key: dim },
        h('div', { className: 'c3-wiz-cap-row' },
          h('label', null, DIMENSION_LABELS[dim] || dim),
          h('input', {
            type: 'range',
            min: 0,
            max: 100,
            value: val,
            onInput: (e) => onChange(dim, parseInt(e.target.value)),
          }),
          h('span', { className: 'c3-wiz-cap-val' }, String(val)),
        ),
        h('div', { className: `c3-wiz-cap-hint ${hint.level}` }, hint.label),
      );
    })
  );
}

module.exports = { renderCapabilities };
