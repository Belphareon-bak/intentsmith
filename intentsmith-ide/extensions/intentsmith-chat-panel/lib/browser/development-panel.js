'use strict';

const ERRORS = {
  INSTALL_NPM_LOCK_REQUIRED: 'Projekt potřebuje package-lock.json ve verzi 2 nebo 3 s přesnými verzemi balíčků.',
  INSTALL_TARGET_EXISTS: 'Cílová složka již existuje. Tato instalace ji nepřepíše.',
  INSTALL_POLICY_STALE: 'Oprávnění se změnilo. Připrav nový plán podle aktuálního nastavení.',
  INSTALL_MANIFEST_CHANGED: 'Manifest projektu se změnil. Připrav nový plán.',
  INSTALL_SANDBOX_UNAVAILABLE: 'Pro tuto instalaci je potřeba Linux, bubblewrap, systémový Python a prlimit.',
  INSTALL_INSUFFICIENT_DISK: 'Pro bezpečnou přípravu je potřeba alespoň 8 GB volného místa.',
  INSTALL_APPROVAL_REQUIRED: 'Tento konkrétní plán čeká na tvoje potvrzení.',
  INSTALL_POLICY_DISABLED: 'Instalace tohoto typu jsou v nastavení zakázané.',
  INSTALL_BUSY: 'Jiná instalace právě běží. Vyčkej na její dokončení.',
};
const STATES = { pending: 'Čeká na potvrzení', running: 'Instaluje se', succeeded: 'Instalace dokončena',
  failed: 'Instalace selhala', cancelled: 'Instalace zrušena', interrupted: 'Přerušená instalace — výsledek není potvrzen' };
const EVENTS = { prepared: 'Plán připraven', authorized: 'Povoleno', download_started: 'Stahování',
  download_verified_transport: 'Staženo', archive_integrity_verified: 'Kontrolní součet ověřen',
  archive_layout_verified: 'Obsah archivu ověřen', process_started: 'Spuštěn izolovaný nástroj', process_terminated: 'Nástroj ukončen',
  staging_created: 'Připravená pracovní složka', publication_intent: 'Přesun do projektu', succeeded: 'Dokončeno',
  failed: 'Chyba', cancelled: 'Zrušeno', interrupted: 'Přerušeno', cancel_requested: 'Vyžádáno zastavení' };
function errorText(error) { return ERRORS[error.code || error.message] || error.message || String(error); }
async function request(base, endpoint, body, method) {
  const response = await fetch(base + '/api/development/' + endpoint, { method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(endpoint === 'execute' ? 600000 : 10000) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || 'Požadavek selhal.'), { code: value.code });
  return value;
}
exports.createPanel = function(React) {
  const h = React.createElement;
  return function DevelopmentPanel({ backend, projectId }) {
    const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
    const [project, setProject] = React.useState(projectId || ''), [kind, setKind] = React.useState('npm');
    const [version, setVersion] = React.useState(''), [plan, setPlan] = React.useState(null), [tick, setTick] = React.useState(0);
    const [mode, setMode] = React.useState({ projectMode: 'ask', sdkMode: 'ask' });
    React.useEffect(() => {
      let mounted = true;
      Promise.all([request(backend, 'environment'), request(backend, 'policy'), request(backend, 'installations'),
        fetch(backend + '/api/projects', { signal: AbortSignal.timeout(5000) }).then(async r => { if (!r.ok) throw Error('Projekty se nepodařilo načíst.');return r.json(); })])
        .then(([environment, policy, history, projects]) => { if (mounted) {
          setData({ environment, policy, history, projects: projects.projects || [] });setMode(policy);setError('');
          if (!plan) setPlan(history.find(item => item.state === 'running') || null);
        } }).catch(e => { if (mounted) setError(errorText(e)); });
      return () => { mounted = false; };
    }, [backend, tick]);
    React.useEffect(() => {
      if (!plan || plan.state !== 'running') return;
      let mounted = true, timer;
      async function poll() {
        try { const value = await request(backend, 'status?id=' + encodeURIComponent(plan.id));if (mounted) { setPlan(value);setError(''); } }
        catch (e) { if (mounted) setError('Průběh nelze načíst; dokončení není potvrzené. ' + errorText(e)); }
        if (mounted) timer = setTimeout(poll, 1500);
      }
      timer = setTimeout(poll, 500);return () => { mounted = false;clearTimeout(timer); };
    }, [backend, plan?.id, plan?.state]);
    async function action(fn) { setBusy(true);setError('');try { await fn(); } catch(e) { setError(errorText(e)); } finally { setBusy(false); } }
    async function execute(candidate, approval) {
      // Request acceptance is not success. Poll the durable server state while
      // the long-running request is open; reload history after disconnection.
      const pending = request(backend, 'execute', { id: candidate.id, digest: candidate.digest, approval });
      const timer = setInterval(() => request(backend, 'status?id=' + encodeURIComponent(candidate.id)).then(setPlan).catch(() => {}), 1000);
      try { setPlan(await pending); } finally { clearInterval(timer); }
    }
    const button = (text, onClick, disabled = busy) => h('button', { type: 'button', onClick: () => action(onClick), disabled }, text);
    function policySelect(label, key) { return h('label', null, label, h('select', { value: mode[key], disabled: busy, onChange: e => setMode({ ...mode, [key]: e.target.value }) },
      h('option', { value: 'ask' }, 'Potvrdit každý plán'), h('option', { value: 'automatic' }, 'Automaticky v povoleném rozsahu'), h('option', { value: 'disabled' }, 'Zakázáno'))); }
    if (!data) return h('div', { className: 'intentsmith-development' }, error ? h('p', { role: 'alert' }, error) : 'Načítám prostředí…', button('Obnovit', () => setTick(tick + 1)));
    const env = data.environment, policy = data.policy;
    return h('div', { className: 'intentsmith-development' },
      error ? h('p', { role: 'alert' }, error) : null,
      h('section', null, h('h3', null, 'Skutečné prostředí backendu'),
        h('p', null, (env.distribution || env.platform) + ' · ' + env.architecture + ' · Node ' + env.runtime.node),
        h('p', null, 'Dostupné nástroje: ' + Object.keys(env.tools).filter(name => env.tools[name]).join(', ')),
        h('small', null, 'Zjištěna přítomnost programů, nikoli úspěšné sestavení projektu. Prostředí projektu může cílit na jiný systém.'),
        button('Obnovit prostředí a historii', () => setTick(tick + 1))),
      h('section', null, h('h3', null, 'Oprávnění k instalacím'),
        policySelect('Závislosti projektu', 'projectMode'), policySelect('SDK pro projekt', 'sdkMode'),
        h('p', null, 'Automaticky: pouze konkrétní plán potřebný pro vybraný projekt. npm vychází z uzamčených verzí; SDK musí mít přesnou verzi v global.json. Systémové balíčky a sudo zůstávají ruční.'),
        h('p', null, 'Podporováno: npm z registry.npmjs.org bez instalačních skriptů; .NET SDK z builds.dotnet.microsoft.com. Žádné jiné zdroje, spouštění stažených skriptů ani přepis existující instalace.'),
        button('Uložit oprávnění', async () => { const saved = await request(backend, 'policy', { revision: policy.revision, projectMode: mode.projectMode, sdkMode: mode.sdkMode }, 'PUT');setData({ ...data, policy: saved });setMode(saved); }, busy || !policy.valid)),
      h('section', null, h('h3', null, 'Připravit potřebné závislosti'),
        h('label', null, 'Projekt', h('select', { value: project, disabled: busy, onChange: e => { setProject(e.target.value);setPlan(null); } },
          h('option', { value: '' }, 'Vyber projekt'), data.projects.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
        h('label', null, 'Instalace', h('select', { value: kind, disabled: busy, onChange: e => { setKind(e.target.value);setPlan(null); } },
          h('option', { value: 'npm' }, 'npm — package-lock.json'), h('option', { value: 'dotnet' }, '.NET SDK — přesná verze'))),
        kind === 'dotnet' ? h('label', null, 'Verze SDK', h('input', { value: version, placeholder: 'Přesná verze požadovaná projektem', onChange: e => setVersion(e.target.value) })) : null,
        button('Připravit instalaci', async () => { const value = await request(backend, 'prepare', { kind, projectId: Number(project), ...(kind === 'dotnet' ? { version } : {}) });setPlan(value);
          if (value.plan.automatic && value.plan.autoEligible) await execute(value, false);
        }, busy || !project)),
      plan ? h('section', { 'aria-label': 'Průběh instalace' }, h('h3', null, STATES[plan.state] || plan.state),
        h('p', null, 'Projekt: ' + (data.projects.find(p => p.id === plan.plan.projectId)?.name || plan.plan.projectId)),
        h('p', null, 'Cíl: ', h('code', null, plan.plan.destination)), h('p', null, plan.plan.command), h('p', null, plan.plan.limitations),
        h('details', null, h('summary', null, 'Přesné zdroje a verze'), h('ul', null,
          (plan.plan.artifacts || [{ url: plan.plan.metadataUrl }, { url: plan.plan.archiveUrl }]).map(item => h('li', { key: item.url }, item.name ? item.name + '@' + item.version + ' — ' : '', item.url)))),
        plan.state === 'pending' ? button('Potvrdit tuto instalaci', () => execute(plan, true)) : null,
        ['pending', 'running'].includes(plan.state) ? button('Zrušit instalaci', async () => setPlan(await request(backend, 'cancel', { id: plan.id })), false) : null,
        plan.result?.error ? h('p', { role: 'alert' }, errorText({ message: plan.result.error })) : null,
        h('ol', { className: 'intentsmith-install-events' }, plan.events.map(event => h('li', { key: event.seq },
          h('strong', null, EVENTS[event.kind] || event.kind), ' · ' + new Date(event.occurredAt).toLocaleTimeString(),
          h('details', null, h('summary', null, 'Podrobnosti'), h('pre', null, JSON.stringify(event.detail, null, 2))))))) : null,
      h('section', null, h('h3', null, 'Poslední instalace'), data.history.length ? data.history.map(item => button(
        (data.projects.find(p => p.id === item.plan.projectId)?.name || item.plan.projectId) + ' · ' + item.plan.kind + ' · ' + (STATES[item.state] || item.state),
        async () => setPlan(await request(backend, 'status?id=' + encodeURIComponent(item.id))), false)) : h('p', null, 'Zatím žádná instalace.')));
  };
};
exports.request = request;
