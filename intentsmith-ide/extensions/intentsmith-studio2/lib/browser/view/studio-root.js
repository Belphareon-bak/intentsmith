'use strict';

const React = require('@theia/core/shared/react');
const { render } = require('./generated/view');
const { LiveModel } = require('./live-model');

const h = React.createElement;

// Inline styly šablony jsou řetězce ("width: 40%; --x: 1"); React chce objekt.
const styleCache = new Map();
function css(text) {
  if (text == null || text === '') return undefined;
  const hit = styleCache.get(text);
  if (hit) return hit;
  const out = {};
  for (const decl of String(text).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop) continue;
    out[prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
  }
  if (styleCache.size > 4000) styleCache.clear();
  styleCache.set(text, out);
  return out;
}

const rt = {
  S: (v) => (v == null ? '' : String(v)),
  L: (v) => (Array.isArray(v) ? v : []),
  css
};

function createModel(widget) {
  return new LiveModel(widget);
}

// Kořen vizuální vrstvy. Model (logika prototypu) drží stav; každá jeho změna
// překreslí strom synchronně v rámci Reactu, takže řízená pole (textarea, input)
// nepřeskakují kurzorem.
class StudioRoot extends React.Component {
  constructor(props) {
    super(props);
    this.state = { v: 0 };
  }

  componentDidMount() {
    const model = this.props.model;
    this.unsubscribe = model.subscribe(() => this.setState((x) => ({ v: x.v + 1 })));
    if (model.componentDidMount) model.componentDidMount();
  }

  componentWillUnmount() {
    const model = this.props.model;
    if (this.unsubscribe) this.unsubscribe();
    if (model.componentWillUnmount) model.componentWillUnmount();
  }

  render() {
    const vm = this.props.model.renderVals();
    // Prototyp vyplňuje celé okno plátna; ve Theii vyplní widget.
    vm.rootW = 'calc(100% / ' + vm.zoom + ')';
    vm.rootH = 'calc(100% / ' + vm.zoom + ')';
    return render(vm, h, React.Fragment, rt);
  }
}

module.exports = { StudioRoot, createModel, css };
