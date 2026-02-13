// C3 Expertise Wizard — Basic Info Section
// v63.0 — Name, domain, icon, description, systemPrompt, tone, temperature
'use strict';

/**
 * Render basic info section of the wizard.
 * @param {Function} h - React.createElement
 * @param {Object} data - Wizard form data
 * @param {Object} schema - Schema from backend
 * @param {Function} onChange - Callback: (field, value) => void
 * @returns {ReactElement}
 */
function renderBasicInfo(h, data, schema, onChange) {
  const toneOptions = (schema && schema.toneOptions) || ['professional', 'casual', 'academic', 'empathetic', 'assertive', 'neutral'];

  return h('div', { className: 'c3-wiz-basic' },

    // Name
    _field(h, 'Název', 'text',
      h('input', {
        type: 'text',
        className: 'c3-textarea',
        style: { minHeight: 'auto', height: '28px' },
        value: data.name || '',
        placeholder: 'Název expertízy...',
        maxLength: 64,
        onInput: (e) => onChange('name', e.target.value),
      })
    ),

    // Icon + Domain (inline)
    h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } },
      _field(h, 'Ikona', null,
        h('input', {
          type: 'text',
          className: 'c3-textarea',
          style: { minHeight: 'auto', height: '28px', width: '48px', textAlign: 'center', fontSize: '16px' },
          value: data.icon || '👤',
          maxLength: 4,
          onInput: (e) => onChange('icon', e.target.value),
        }),
        { flex: '0 0 auto' }
      ),
      _field(h, 'Doména', null,
        h('input', {
          type: 'text',
          className: 'c3-textarea',
          style: { minHeight: 'auto', height: '28px' },
          value: data.domain || '',
          placeholder: 'nazev_domeny',
          maxLength: 64,
          onInput: (e) => onChange('domain', e.target.value),
        }),
        { flex: '1' }
      ),
    ),

    // Description
    _field(h, 'Popis', 'text',
      h('textarea', {
        className: 'c3-textarea',
        value: data.description || '',
        placeholder: 'Krátký popis expertízy...',
        maxLength: 500,
        rows: 2,
        onInput: (e) => onChange('description', e.target.value),
      })
    ),

    // System prompt
    _field(h, 'System Prompt', 'text',
      h('textarea', {
        className: 'c3-textarea c3-textarea-lg',
        value: data.systemPrompt || '',
        placeholder: 'Systémový prompt pro single-expert flow...',
        maxLength: 8000,
        rows: 5,
        onInput: (e) => onChange('systemPrompt', e.target.value),
      })
    ),

    // Tone
    _field(h, 'Tón', null,
      h('div', { className: 'c3-radios' },
        ...toneOptions.map(tone =>
          h('label', { className: 'c3-radio', key: tone },
            h('input', {
              type: 'radio',
              name: 'wizard-tone',
              value: tone,
              checked: data.tone === tone,
              onChange: () => onChange('tone', tone),
            }),
            tone
          )
        )
      )
    ),

    // Temperature
    h('div', { className: 'c3-wiz-cap-row', style: { marginTop: '4px' } },
      h('label', null, 'Teplota'),
      h('input', {
        type: 'range',
        min: 0,
        max: 100,
        value: Math.round((data.temperature || 0.5) * 100),
        onInput: (e) => onChange('temperature', parseInt(e.target.value) / 100),
      }),
      h('span', { className: 'c3-wiz-cap-val' }, (data.temperature || 0.5).toFixed(2)),
    ),
  );
}

function _field(h, label, type, input, style) {
  return h('div', { style: { marginBottom: '8px', ...(style || {}) } },
    h('div', { style: { fontSize: '10px', color: 'var(--c3-tx-4)', marginBottom: '3px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' } }, label),
    input,
  );
}

module.exports = { renderBasicInfo };
