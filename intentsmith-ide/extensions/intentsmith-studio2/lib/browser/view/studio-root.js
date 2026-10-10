'use strict';

const React = require('@theia/core/shared/react');
const { render } = require('./generated/view');
const { LiveModel } = require('./live-model');
const { SettingsV4 } = require('../settings-v4/controller');

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
    const model = props.model, widget = model.widget;
    this.settings = new SettingsV4({
      backendUrl: () => widget.catalog.backendUrl(), fetchImpl: (...args) => model.fetchImpl(...args),
      services: { sm: model.settingsManagement, mw: model.modelWorkspace, sec: model.securityWorkspace, fb: model.feedbackWorkspace },
      navigate: id => model.setState(id ? model.pSelect(model.st(), 'settings', id)
        : { ...model.pGo(model.st(), 'settings'), detail: { ...model.st().detail, settings: null }, q: '' }),
      openProjectWizard: () => model.setState(model.pSelect(model.st(), 'projects', '__new__'))
    });
    this.settings.appearanceState = () => model.st();
    this.settings.applyAppearance = patch => model.setState(patch);
    this.settings.openSection = section => model.setState(model.pGo(model.st(), section));
    this.settings.projectDirectory = () => model._projectsDir;
    this.settings.setProjectDirectory = value => model.setProjectsDir(value);
    this.settingsHost = host => { if (host) { this.settings.attach(host); this.syncSettings(); } else this.settings.detach(); };
    model.settingsV4 = this.settings;
  }

  syncSettings() {
    const s = this.props.model.st();
    this.settings.sync({ id: s.detail?.settings, view: s.view, size: s.size });
  }

  componentDidUpdate() { this.syncSettings(); }

  componentDidMount() {
    const model = this.props.model;
    this.unsubscribe = model.subscribe(() => this.setState((x) => ({ v: x.v + 1 })));
    if (model.componentDidMount) model.componentDidMount();
  }

  componentWillUnmount() {
    const model = this.props.model;
    if (this.unsubscribe) this.unsubscribe();
    this.settings.destroy();
    this.props.model.settingsV4 = null;
    if (model.componentWillUnmount) model.componentWillUnmount();
  }

  render() {
    const vm = this.props.model.renderVals();
    vm.isSettingsV4 = vm.isSection && this.props.model.st().section === 'settings';
    if (vm.isSettingsV4) {
      vm.isSection = false;
      vm.settingsHost = this.settingsHost;
      vm.tbar.viewDisabled = !this.settings.layoutAvailable();
      vm.tbar.viewDim = vm.tbar.viewDisabled ? 'dimmed' : '';
    }
    // Prototyp vyplňuje celé okno plátna; ve Theii vyplní widget.
    vm.rootW = 'calc(100% / ' + vm.zoom + ')';
    vm.rootH = 'calc(100% / ' + vm.zoom + ')';
    return render(vm, h, React.Fragment, rt);
  }
}

module.exports = { StudioRoot, createModel, css };
