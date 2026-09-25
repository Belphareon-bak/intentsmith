'use strict';

function renderCatalog(widget, h) {
  const section = widget.section;
  const view = widget.catalog.view(section);
  const search = widget.catalogSearch || '';
  const filtered = view.items.filter(item => `${item.name} ${item.description} ${item.group}`.toLocaleLowerCase('cs-CZ').includes(search.toLocaleLowerCase('cs-CZ')));
  const selected = filtered.find(item => item.id === widget.catalogSelection) || null;
  const layout = widget.catalogLayout || 'tiles';
  const icon = ({ Konverzace: '◉', Projekty: '□', Specialisté: '♙', Expertýzy: '◇', Workeři: '▷', Obchod: '▣', Multimédia: '◫' })[section] || '□';
  function choose(item) { widget.catalogSelection = item.id; widget.update(); }
  function itemButton(item) {
    return h('button', { key: item.id, type: 'button', className: `intentsmith-s2-catalog-item${selected?.id === item.id ? ' active' : ''}`,
      onClick: () => choose(item), onDoubleClick: () => widget.openCatalogItem(section, item) },
    h('span', { className: 'intentsmith-s2-catalog-icon', 'aria-hidden': 'true' }, icon),
    h('strong', null, item.name),
    h('span', { className: 'intentsmith-s2-catalog-group' }, item.group),
    h('span', { className: 'intentsmith-s2-catalog-description' }, item.description || 'Bez popisu'));
  }
  function detail(item) {
    if (!item) return null;
    const fields = Object.entries(item.raw).filter(([key, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 20);
    return h('aside', { className: 'intentsmith-s2-catalog-detail', 'aria-label': `Detail ${item.name}` },
      h('header', null, h('span', { className: 'intentsmith-s2-catalog-icon' }, icon),
        h('h2', null, item.name),
        h('button', { type: 'button', 'aria-label': 'Zavřít detail', onClick: () => { widget.catalogSelection = null; widget.update(); } }, '×')),
      item.state ? h('p', { className: 'intentsmith-s2-catalog-state' }, item.state) : null,
      h('p', null, item.description || 'Bez popisu.'),
      (section === 'Konverzace' || section === 'Projekty') ? h('button', { type: 'button', onClick: () => widget.openCatalogItem(section, item) },
        section === 'Projekty' ? 'Nová relace v projektu' : 'Otevřít jako relaci') : null,
      h('h3', null, 'Vlastnosti'),
      h('dl', null, fields.map(([key, value]) => h('div', { key }, h('dt', null, key), h('dd', null, String(value))))));
  }
  return h('div', { className: 'intentsmith-s2-catalog', 'data-catalog-section': section, 'data-catalog-status': view.status },
    h('header', { className: 'intentsmith-s2-catalog-head' },
      h('div', null, h('small', null, 'Katalog'), h('h1', null, `${icon} ${section}`),
        h('p', null, view.status === 'ready' ? `${view.items.length} položek` : view.status === 'loading' ? 'Načítání…' : '')),
      h('input', { type: 'search', 'aria-label': `Hledat v ${section}`, placeholder: 'Hledat…', value: search,
        onChange: event => { widget.catalogSearch = event.target.value; widget.update(); } }),
      h('button', { type: 'button', onClick: () => widget.catalog.load(section) }, 'Obnovit'),
      h('button', { type: 'button', className: layout === 'tiles' ? 'active' : '', onClick: () => { widget.catalogLayout = 'tiles'; widget.update(); } }, 'Dlaždice'),
      h('button', { type: 'button', className: layout === 'list' ? 'active' : '', onClick: () => { widget.catalogLayout = 'list'; widget.update(); } }, 'Seznam')),
    view.status === 'error' ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, view.error) : null,
    widget.catalogActionError ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, widget.catalogActionError) : null,
    view.status === 'loading' ? h('p', { role: 'status' }, 'Načítání položek…') : null,
    view.status === 'ready' && !filtered.length ? h('p', { className: 'intentsmith-s2-catalog-empty' }, search ? 'Hledání nevrátilo žádnou položku.' : 'Zatím žádné položky.') : null,
    h('div', { className: 'intentsmith-s2-catalog-body' },
      h('div', { className: `intentsmith-s2-catalog-items ${layout}` }, filtered.map(itemButton)),
      detail(selected)));
}

module.exports = { renderCatalog };
