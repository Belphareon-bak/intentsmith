// C3 Expertise Wizard — Preview + Test Section
// v63.0 — Compatibility badge, token count, prompt preview, enforcement, test prompt
'use strict';

/**
 * Render preview section.
 * @param {Function} h - React.createElement
 * @param {Object|null} preview - Preview data from POST /api/merge-preview
 * @param {Object|null} testResult - Test result from POST /api/expertise-wizard/test-prompt
 * @param {boolean} testLoading - Whether a test is in progress
 * @param {string|null} testError - Error message from test
 * @param {Function} onTest - Callback: (question) => void
 * @returns {ReactElement}
 */
function renderPreview(h, preview, testResult, testLoading, testError, onTest) {
  return h('div', { className: 'c3-wiz-preview' },

    // Compatibility + token count
    preview && h('div', { style: { marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' } },
      h('span', {
        className: `c3-wiz-preview-badge ${preview.blocked ? 'hard_block' : (preview.compatibility?.severity || 'ok')}`,
      }, preview.blocked ? 'BLOKOVÁNO' : (preview.compatibility?.severity || 'OK').toUpperCase()),
      h('span', { style: { fontSize: '11px', color: 'var(--c3-tx-3)' } },
        `Tokeny: `,
        h('span', { style: { fontFamily: 'var(--c3-mono)', color: 'var(--c3-tx-2)' } }, String(preview.tokenCount || '?')),
      ),
      preview.tone && h('span', { style: { fontSize: '11px', color: 'var(--c3-tx-3)' } },
        `Tón: `,
        h('span', { style: { fontFamily: 'var(--c3-mono)', color: 'var(--c3-tx-2)' } }, preview.tone),
      ),
      preview.temperature !== undefined && h('span', { style: { fontSize: '11px', color: 'var(--c3-tx-3)' } },
        `Teplota: `,
        h('span', { style: { fontFamily: 'var(--c3-mono)', color: 'var(--c3-tx-2)' } }, String(preview.temperature)),
      ),
    ),

    // Blocked message
    preview && preview.blocked && h('div', { className: 'c3-wiz-test-error', style: { marginBottom: '8px' } },
      `Nekompatibilní kombinace: ${preview.error || 'Konflikt expertíz'}`,
    ),

    // Prompt preview
    preview && preview.promptPreview && h('div', { style: { marginBottom: '8px' } },
      h('div', { style: { fontSize: '10px', color: 'var(--c3-tx-4)', marginBottom: '3px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Prompt Preview'),
      h('pre', { className: 'c3-wiz-preview-prompt' }, preview.promptPreview),
    ),

    // Enforcement summary
    preview && preview.enforcement && h('div', { className: 'c3-wiz-preview-enf' },
      h('div', null, 'Forbidden: ', h('span', null, String(preview.enforcement.forbiddenPhrasesCount || 0))),
      h('div', null, 'Min délka: ', h('span', null, String(preview.enforcement.minResponseLength || 0))),
      h('div', null, 'Disclaimery: ', h('span', null, String((preview.enforcement.disclaimers || []).length))),
    ),

    // No preview yet
    !preview && h('div', { className: 'c3-wiz-hint', style: { textAlign: 'center', padding: '12px' } },
      'Preview se načte po vyplnění základních údajů...'
    ),

    // Test prompt section
    h('div', { style: { marginTop: '12px', borderTop: '1px solid var(--c3-border)', paddingTop: '10px' } },
      h('div', { style: { fontSize: '10px', color: 'var(--c3-tx-4)', marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Test Prompt'),
      h('div', { className: 'c3-wiz-test-input' },
        h('input', {
          type: 'text',
          placeholder: 'Zadejte testovací otázku...',
          id: 'c3-wizard-test-q',
          disabled: testLoading,
          onKeyDown: (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
              onTest(e.target.value.trim());
            }
          },
        }),
        h('button', {
          className: 'c3-btn-primary',
          disabled: testLoading,
          onClick: () => {
            const input = document.getElementById('c3-wizard-test-q');
            if (input && input.value.trim()) {
              onTest(input.value.trim());
            }
          },
        }, testLoading ? '...' : 'Test'),
      ),

      // Loading indicator
      testLoading && h('div', { className: 'c3-wiz-hint', style: { textAlign: 'center', padding: '8px' } },
        'Čekám na odpověď LLM...'
      ),

      // Error
      testError && h('div', { className: 'c3-wiz-test-error' }, testError),

      // Result
      testResult && !testLoading && h('div', null,
        h('div', { className: 'c3-wiz-test-response' }, testResult.response || '(prázdná odpověď)'),
        h('div', { className: 'c3-wiz-test-meta' },
          `Model: ${testResult.model || '?'} | Doba: ${testResult.duration || '?'}ms | Tokeny: ${testResult.tokenCount || '?'}`,
        ),
      ),
    ),
  );
}

module.exports = { renderPreview };
