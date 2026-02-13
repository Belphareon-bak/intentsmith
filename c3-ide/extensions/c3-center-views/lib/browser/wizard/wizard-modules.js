// C3 Expertise Wizard — Modules Editor Section
// v63.0 — 6 section editors with add/remove + inheritance badges (🟡4)
'use strict';

const SECTION_LABELS = {
  domain_rules: 'Domain Rules',
  emphasis: 'Důraz',
  constraints: 'Omezení',
  vocabulary: 'Slovník',
  antipatterns: 'Anti-patterny',
  disclaimer: 'Disclaimer',
};

/**
 * Render modules editor (6 sections).
 * @param {Function} h - React.createElement
 * @param {Object} modules - { domain_rules:[], emphasis:[], ..., disclaimer: string|null }
 * @param {Object} schema - Schema from backend (moduleSections, limits)
 * @param {Object} inheritance - { section: 'extend'|'replace' } per-section modes
 * @param {Object|null} parentModules - Parent's modules for inheritance badges
 * @param {Function} onModuleChange - (section, newArray) => void
 * @param {Function} onInheritanceChange - (section, mode) => void
 * @returns {ReactElement}
 */
function renderModules(h, modules, schema, inheritance, parentModules, onModuleChange, onInheritanceChange) {
  const sections = (schema && schema.moduleSections) ||
    ['domain_rules', 'emphasis', 'constraints', 'vocabulary', 'antipatterns', 'disclaimer'];
  const limits = schema && schema.limits || {};
  const mods = modules || {};
  const inh = inheritance || {};

  return h('div', { className: 'c3-wiz-modules' },
    ...sections.map(section => {
      if (section === 'disclaimer') {
        return _renderDisclaimer(h, mods.disclaimer, (val) => onModuleChange('disclaimer', val));
      }
      return _renderArraySection(
        h, section, mods[section] || [], limits, inh[section],
        parentModules && parentModules[section],
        (newArr) => onModuleChange(section, newArr),
        (mode) => onInheritanceChange(section, mode),
      );
    })
  );
}

function _renderArraySection(h, section, items, limits, inheritanceMode, parentItems, onItemsChange, onInhChange) {
  const limitKey = 'max' + section.charAt(0).toUpperCase() + section.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const sectionLimit = limits[limitKey] || 999;
  const label = SECTION_LABELS[section] || section;
  const parentCount = parentItems ? parentItems.length : 0;

  return h('div', { className: 'c3-wiz-mod', key: section },

    // Header
    h('div', { className: 'c3-wiz-mod-head' },
      h('span', null, label),
      h('span', { className: 'c3-wiz-mod-count' }, `${items.length} / ${sectionLimit}`),
      parentCount > 0 && h('span', { className: 'c3-wiz-inherit-badge' },
        `Inherited: ${parentCount} | Own: ${items.length} | Mode: ${inheritanceMode || 'extend'}`
      ),
    ),

    // Items list
    ...items.map((item, idx) =>
      h('div', { className: 'c3-wiz-mod-item', key: `${section}-${idx}` },
        h('span', null, item),
        h('button', {
          className: 'c3-wiz-mod-rm',
          title: 'Odebrat',
          onClick: () => {
            const newArr = [...items];
            newArr.splice(idx, 1);
            onItemsChange(newArr);
          },
        }, '\u00d7'),
      )
    ),

    // Add row
    items.length < sectionLimit && h('div', { className: 'c3-wiz-mod-add' },
      h('input', {
        type: 'text',
        placeholder: `Přidat ${label.toLowerCase()}...`,
        'data-section': section,
        onKeyDown: (e) => {
          if (e.key === 'Enter' && e.target.value.trim()) {
            onItemsChange([...items, e.target.value.trim()]);
            e.target.value = '';
          }
        },
      }),
      h('button', {
        onClick: (e) => {
          const input = e.target.parentElement.querySelector('input');
          if (input && input.value.trim()) {
            onItemsChange([...items, input.value.trim()]);
            input.value = '';
          }
        },
      }, '+'),
    ),

    // Inheritance mode selector (when parent exists)
    parentCount > 0 && h('div', { className: 'c3-wiz-inherit-row' },
      h('span', { style: { fontSize: '10px', color: 'var(--c3-tx-4)' } }, 'Dědičnost:'),
      h('select', {
        className: 'c3-select-sm',
        value: inheritanceMode || 'extend',
        onChange: (e) => onInhChange(e.target.value),
      },
        h('option', { value: 'extend' }, 'extend (sloučit)'),
        h('option', { value: 'replace' }, 'replace (nahradit)'),
      ),
    ),
  );
}

function _renderDisclaimer(h, disclaimer, onChange) {
  return h('div', { className: 'c3-wiz-mod', key: 'disclaimer' },
    h('div', { className: 'c3-wiz-mod-head' },
      h('span', null, SECTION_LABELS.disclaimer),
    ),
    h('textarea', {
      className: 'c3-textarea',
      value: disclaimer || '',
      placeholder: 'Disclaimer text (nebo prázdné pro žádný)...',
      rows: 2,
      onInput: (e) => onChange(e.target.value || null),
    }),
    h('div', { className: 'c3-wiz-hint' }, 'Ponechte prázdné pokud disclaimer není potřeba'),
  );
}

module.exports = { renderModules };
