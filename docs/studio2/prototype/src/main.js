class Component extends DCLogic {
  componentDidMount() {
    this._onResize = () => this.forceUpdate();
    this._onKey = (e) => this.onKey(e);
    if (typeof window !== 'undefined') { window.addEventListener('resize', this._onResize); window.addEventListener('keydown', this._onKey, true); }
  }

  componentWillUnmount() {
    if (typeof window !== 'undefined') { window.removeEventListener('resize', this._onResize); window.removeEventListener('keydown', this._onKey, true); }
  }

  // Klávesové zkratky z nabídek; stejné změny stavu jako položky nabídek.
  onKey(e) {
    const s = this.st();
    const k = (e.key || '').toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    let p = null;
    if (k === 'escape' && (s.palette || s.menu || s.ctx || s.scmPlan)) p = s.palette || s.menu || s.ctx ? { palette: false, menu: null, ctx: null } : { scmPlan: null };
    else if (ctrl && !e.altKey && !e.shiftKey && k === 'k') p = { palette: true, pq: '', menu: null, ctx: null };
    else if (ctrl && !e.altKey && k === 'b') p = { navOpen: !s.navOpen, navPin: !s.navOpen };
    else if (ctrl && e.altKey && k === 'b') p = { rightOpen: !s.rightOpen, rightPin: !s.rightOpen };
    else if (ctrl && !e.altKey && k === 'j') p = { bottomOpen: !s.bottomOpen };
    else if (ctrl && !e.altKey && (k === 't' || k === 'n')) p = this.pNewSession(s, {});
    else if (ctrl && k === ',') p = this.pGo(s, 'settings');
    else if (e.altKey && e.shiftKey && /^digit[1-3]$/.test((e.code || '').toLowerCase())) p = this.pSetCols(s, Number(e.code.slice(-1)));
    else if (e.altKey && !ctrl && !e.shiftKey && /^[1-9]$/.test(k) && s.tabs[Number(k) - 1]) p = this.pFocusSession(s, s.tabs[Number(k) - 1]);
    if (!p) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    this.setState(Object.assign({ menu: null, ctx: null }, p));
  }

  defaults() {
    return {
      mode: 'sessions', section: 'projects', detail: {},
      tabs: ['s1', 's2', 's3', 's4', 's5', 's6'], cols: 2, colSids: ['s1', 's3', 's2'], focusCol: 0, colFr: [1, 1, 1],
      navOpen: true, navPin: false, navW: 248, navExp: { chats: true },
      rightOpen: true, rightPin: false, rightW: 400, rightTab: 'zmeny',
      bottomOpen: true, bottomH: 190, btab: {}, detailW: 520,
      menu: null, palette: false, pq: '', ctx: null, q: '', chip: 'vse',
      view: 'dlazdice', size: 2, dtab: {}, approved: {}, stopped: {}, modes: {}, experts: {}, drafts: {}, extra: {}, sessions: {}, pinned: {},
      openFiles: { 'src/main/sftp.js': true }, paused: {}, ran: {}, installed: {}, seq: 1,
      fileView: {}, fileMode: {}, fileDraft: {}, fileText: {}, fileGuard: null, userOpened: {}, treeClosed: {}, fileAction: null, fileActionNotice: '',
      scm: {}, scmPlan: null, auditX: {}, ctxQ: '', atts: {}, cmds: {}, termX: {},
      mediaType: 'txt2img', mediaPrompt: '', mediaNegative: '', mediaWidth: 1024, mediaHeight: 1024,
      mediaSteps: 20, mediaCfg: 7, mediaSeed: -1, mediaFrames: 49, mediaModel: '',
      mediaInputName: '', mediaDenoise: 0.7,
      projectMode: 'create', projectStep: 0, projectName: '', projectPath: '',
      projectDescription: '', projectType: 'general',
      specialistStep: 0, specialistName: '', specialistDomain: 'general',
      specialistDescription: '', specialistIcon: '',
      workerStep: 0, workerExtension: 'project-health', workerProject: '', workerInstanceId: '',
      expertiseStep: 0, expertiseEditingId: '', expertiseName: '', expertiseDomain: '', expertiseDescription: '', expertiseIcon: '👤',
      expertiseTone: 'professional', expertiseTemperature: 0.5, expertiseSystemPrompt: '',
      expertiseCreativity: 50, expertiseReasoning: 50, expertiseDeterminism: 50,
      expertiseRiskTolerance: 50, expertiseVerbosity: 50, expertiseAdvanced: false,
      expertiseDomainRules: '', expertiseEmphasis: '', expertiseConstraints: '',
      expertiseVocabulary: '', expertiseAntipatterns: '', expertiseDisclaimer: '',
      expertiseForbiddenPhrases: '', expertiseInheritance: '{}', expertiseTestQuestion: '',
      style: 'intentsmith', tmode: 'dark', fs: 13, ff: 'brand', ti: 70, ai: 100, bright: 100, pa: 80, ta: 80, bd: 30,
      sep: 'ramecky', density: 'komfortni', scale: '100', col: true, cacc: 0, caccHex: '#22c55e', cbg: 0, cbgHex: '#14141e', css: ''
    };
  }

  st() { return Object.assign(this.defaults(), this.state || {}); }

  merge(s, key, patch) { return Object.assign({}, s[key], patch); }

  run(fn) {
    return (e) => {
      const s = this.st();
      const p = fn(s, e);
      if (p) this.setState(Object.assign({ menu: null, ctx: null, palette: false }, p));
    };
  }

  chain(s, a, fb) {
    const s2 = Object.assign({}, s, a);
    return Object.assign({}, a, fb(s2));
  }

  data() {
    if (this._d) return this._d;
    const I = {
      anvil: 'M3 9h13l5-2.5V10l-3.5 2H14v2.5l3 3.5H7l3-3.5V12H8.5C5.5 12 3 11 3 9z',
      anvilSpark: 'M3 9h13l5-2.5V10l-3.5 2H14v2.5l3 3.5H7l3-3.5V12H8.5C5.5 12 3 11 3 9zM9 3.5l1 2M13 3v2.2M17 3.5l-1 2',
      chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
      users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
      cap: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5',
      bot: 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2',
      bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
      image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21',
      sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
      gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
      grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
      list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
      plus: 'M5 12h14M12 5v14',
      search: 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
      x: 'M18 6 6 18M6 6l12 12',
      down: 'm6 9 6 6 6-6',
      right: 'm9 18 6-6-6-6',
      check: 'M20 6 9 17l-5-5',
      dotm: 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
      send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
      clip: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
      shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4',
      file: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2zM14 2v6h6',
      play: 'M6 4l14 8-14 8z',
      pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
      stop: 'M6 6h12v12H6z',
      split: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 3v18',
      pl: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18',
      pr: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 3v18',
      pb: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 15h18',
      more: 'M5 12h.01M12 12h.01M19 12h.01',
      swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
      palette: 'M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9 0 3-2.5 5-5 5h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
      cpu: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
      db: 'M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0',
      bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
      drive: 'M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01',
      toggle: 'M8 5h8a7 7 0 0 1 0 14H8A7 7 0 0 1 8 5zM5 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
      code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
      info: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 16v-4M12 8h.01',
      rss: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
      globe: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
      clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 6v6l4 2',
      zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
      pen: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
      chart: 'M3 3v18h18M7 14l4-4 4 4 5-5',
      scale: 'M12 3v18M7 21h10M4 7h16M4 7l-2.5 6a3 3 0 0 0 5 0L4 7zM20 7l-2.5 6a3 3 0 0 0 5 0L20 7z',
      tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
      target: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
      pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
      trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      archive: 'M3 3h18v5H3zM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4',
      copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
      download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
      sparkle: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
      star: 'm12 2 3.1 6.3 7 1-5.1 5 .9 7-6.3-3.3L5.3 21l1.2-7L1.4 9.3l7-1z',
      ext: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
      refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
      type: 'M4 7V4h16v3M9 20h6M12 4v16',
      columns: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18M15 3v18',
      branch: 'M6 3v12M6 21a3 3 0 1 0 0-6a3 3 0 1 0 0 6M18 9a3 3 0 1 0 0-6a3 3 0 1 0 0 6M18 9a9 9 0 0 1-9 9',
      commit: 'M3 12h6M15 12h6M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
      back: 'M19 12H5M12 19l-7-7 7-7',
      eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
      minus: 'M5 12h14',
      widen: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
      up: 'M12 19V5M5 12l7-7 7 7',
      dn: 'M12 5v14M19 12l-7 7-7-7',
      undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13'
    };
    const N = 'var(--info)', A = 'var(--acct)', V = 'var(--violet)', W = 'var(--warn)';
    const hk = (t) => ({ k: 'hunk', o: '', n: '', t });
    const cx = (o, n, t) => ({ k: 'ctx', o, n, t });
    const ad = (n, t) => ({ k: 'add', o: '', n, t });
    const dl = (o, t) => ({ k: 'del', o, n: '', t });
    const S = {
      s1: {
        title: 'ShellSmith — analýza a dokončení existujícího kódu', short: 'ShellSmith', kind: 'project', project: 'shellsmith', state: 'wait',
        expert: 'Vývojář', model: 'qwen3.5:27b', mode: 'kontrola', intent: 'BUILD', ctx: 42, tokens: '13 760 z 32 768', turns: 14,
        parts: [['Systém', 9, N], ['Historie', 21, A], ['Soubory', 12, V]],
        msgs: [
          { k: 'user', time: '14:02', text: 'Dokonči přenos souborů přes SFTP – obnovení přerušeného přenosu a ukazatel průběhu v panelu souborů. Vzhled neměň.' },
          { k: 'agent', time: '14:02 · 34 s', badge: 'BUILD', expert: 'Vývojář',
            steps: [['Prošel 4 soubory v src/main', '1,2 s'], ['Naplánoval 3 změny a 1 nový test', '6,8 s'], ['Upravil src/main/sftp.js', '+48 −9'], ['Upravil src/renderer/js/files.js', '+21 −4'], ['Vytvořil test/sftp-resume.test.js', '+62'], ['Spustil npm test — všechny testy prošly', '11,4 s']],
            paras: ['Přerušený přenos teď pokračuje od posledního potvrzeného bloku. Před zápisem se zjistí velikost souboru na serveru a čtení začne od téhle pozice.', 'Server musí umět zapisovat od posunu – OpenSSH to umí vždy. Když to server neumí, přenos začne znovu a v logu o tom zůstane záznam. Průběh se do panelu souborů posílá nejvýš čtyřikrát za sekundu.'],
            code: ['const offset = await remoteSize(sftp, target).catch(() => 0);', 'const stream = fs.createReadStream(local, { start: offset });'],
            approval: { files: 3, add: 131, del: 13 } }
        ],
        changes: [
          { path: 'src/main/sftp.js', add: 48, del: 9, lines: [hk('@@ -118,10 +118,14 @@ async function upload(sftp, local, target, onProgress)'), cx('118', '118', 'async function upload(sftp, local, target, onProgress) {'), dl('119', '  const stream = fs.createReadStream(local);'), ad('119', '  const offset = await remoteSize(sftp, target).catch(() => 0);'), ad('120', '  const stream = fs.createReadStream(local, { start: offset });'), cx('120', '121', '  const total = (await fs.promises.stat(local)).size;'), dl('121', '  let sent = 0;'), ad('122', '  let sent = offset;'), ad('123', '  const tick = throttle(() => onProgress(sent, total), 250);'), cx('122', '124', '  return new Promise((resolve, reject) => {'), cx('123', '125', '    const ws = sftp.createWriteStream(target, {'), ad('126', "      flags: offset > 0 ? 'r+' : 'w',"), ad('127', '      start: offset'), cx('124', '128', '    });'), cx('125', '129', "    stream.on('data', (chunk) => {"), dl('126', '      sent += chunk.length; onProgress(sent, total);'), ad('130', '      sent += chunk.length; tick();'), cx('127', '131', '    });')] },
          { path: 'src/renderer/js/files.js', add: 21, del: 4, lines: [hk('@@ -88,4 +88,7 @@ function renderTransfer(row, t)'), cx('88', '88', 'function renderTransfer(row, t) {'), dl('89', "  row.querySelector('.size').textContent = fmt(t.size);"), ad('89', '  const pct = t.total ? Math.round(t.sent / t.total * 100) : 0;'), ad('90', "  row.querySelector('.size').textContent = fmt(t.sent) + ' / ' + fmt(t.total);"), ad('91', "  row.querySelector('.bar').style.width = pct + '%';"), cx('90', '92', '}')] },
          { path: 'test/sftp-resume.test.js', add: 62, del: 0, isNew: true, lines: [hk('@@ -0,0 +1,62 @@'), ad('1', "import { test } from 'node:test';"), ad('2', "import assert from 'node:assert/strict';"), ad('3', "import { upload } from '../src/main/sftp.js';"), ad('4', ''), ad('5', "test('obnoví přenos od posunu', async () => {"), ad('6', '  const sftp = fakeSftp({ remoteSize: 4096 });'), ad('7', "  await upload(sftp, fixture('8k.bin'), '/tmp/8k.bin', () => {});"), ad('8', '  assert.equal(sftp.written.start, 4096);'), ad('9', '});')] }
        ],
        ctxFiles: [['src/main/sftp.js', '412 ř.'], ['src/renderer/js/files.js', '388 ř.'], ['src/main/ssh.js', '530 ř.'], ['docs/ARCHITECTURE.md', '210 ř.']],
        attach: [['prenos-log.txt', '3 kB']],
        memory: ['Sestavení přes esbuild, bez TypeScriptu', 'GUI se v testech řídí přes CDP (window.__shellsmith)', 'Balíček .deb potřebuje v package.json homepage a author.email'],
        tree: [[0, 'src', 1], [1, 'main', 1], [2, 'sftp.js', 0, 'M'], [2, 'ssh.js', 0], [2, 'window.js', 0], [1, 'renderer', 1], [2, 'js', 1], [3, 'files.js', 0, 'M'], [3, 'tabs.js', 0], [3, 'terminal.js', 0], [2, 'styles', 1], [3, 'app.css', 0], [0, 'test', 1], [1, 'sftp-resume.test.js', 0, 'A'], [1, 'ssh.test.js', 0], [0, 'docs', 1], [1, 'ARCHITECTURE.md', 0], [0, 'package.json', 0], [0, 'README.md', 0]],
        term: [['$ npm test', 'p'], ['> shellsmith@1.1.2 test', ''], ['> node --test test/', ''], ['ok 1 - obnoví přenos od posunu', 'ok'], ['ok 2 - bez podpory posunu začne znovu', 'ok'], ['ok 3 - průběh nejvýš čtyřikrát za sekundu', 'ok'], ['# tests 38 · pass 38 · fail 0', ''], ['$ ', 'p']],
        log: [['14:02:11', 'INFO', N, 'turn_start', 'intent=BUILD expert=developer'], ['14:02:12', 'TOOL', V, 'read_file', 'src/main/sftp.js · 412 řádků'], ['14:02:14', 'LLM', A, 'qwen3.5:27b', '2 814 → 612 tok · 21,4 tok/s'], ['14:02:31', 'TOOL', V, 'apply_patch', 'src/main/sftp.js +48 −9'], ['14:02:33', 'TOOL', V, 'apply_patch', 'src/renderer/js/files.js +21 −4'], ['14:02:33', 'TOOL', V, 'apply_patch', 'test/sftp-resume.test.js +62'], ['14:02:34', 'TOOL', V, 'run_tests', 'npm test · exit 0 · 11,4 s'], ['14:02:45', 'WAIT', W, 'edit_request', 'er-7f3a · 3 soubory čekají na schválení']],
        runs: [['14:02:45', 'Žádost o schválení', 'edit_request', 'er-7f3a · 3 soubory', '—', 'APPR'], ['14:02:34', 'Testy', 'run_tests', 'npm test', '11,4 s', 'hotovo'], ['14:02:33', 'Nový soubor', 'apply_patch', 'test/sftp-resume.test.js', '0,2 s', 'hotovo'], ['14:02:33', 'Úprava souboru', 'apply_patch', 'src/renderer/js/files.js', '0,2 s', 'hotovo'], ['14:02:31', 'Úprava souboru', 'apply_patch', 'src/main/sftp.js', '0,3 s', 'hotovo'], ['14:02:14', 'Odpověď modelu', 'qwen3.5:27b', 'plán změn', '16,8 s', 'hotovo'], ['14:02:12', 'Čtení', 'read_file', 'src/main/sftp.js', '0,1 s', 'hotovo']],
        audit: [['14:02:45', 'edit_request', 'er-7f3a · 3 soubory'], ['14:02:11', 'turn_start', 'BUILD · Vývojář · qwen3.5:27b']],
        problems: []
      },
      s2: {
        title: 'SystemSmith_1 — desktopový průchod', short: 'SystemSmith_1', kind: 'project', project: 'systemsmith_1', state: 'ok',
        expert: 'Vývojář', model: 'qwen3.5:27b', mode: 'kontrola', intent: 'BUILD', ctx: 18, tokens: '5 900 z 32 768', turns: 9,
        parts: [['Systém', 9, N], ['Historie', 6, A], ['Soubory', 3, V]],
        msgs: [
          { k: 'user', time: '11:32', text: 'Projdi aplikaci jako uživatel na ploše – spusť ji, proklikej přehled, detail a procesy a oprav, co nefunguje.' },
          { k: 'agent', time: '11:40 · 7 min 42 s', badge: 'BUILD', expert: 'Vývojář',
            steps: [['Spustil aplikaci s ladicím portem', '4,1 s'], ['Prošel přehled, detail GPU a tabulku procesů', '2 min 10 s'], ['Našel 2 chyby: řazení podle disku, prázdný graf po startu', ''], ['Upravil src/renderer/js/processes.js', '+14 −3'], ['Upravil src/renderer/js/chart.js', '+9 −2'], ['Znovu sestavil a prošel všechny obrazovky', '1 min 48 s']],
            paras: ['Obě chyby jsou opravené. Řazení podle disku teď sčítá čtení i zápis a graf po startu nekreslí prázdnou osu, dokud nemá aspoň dva vzorky.'],
            approval: { files: 2, add: 23, del: 5, done: 'Schváleno v 11:44 · 2 soubory zapsány' } }
        ],
        changes: [],
        edited: [['src/renderer/js/processes.js', 14, 3, 'zapsáno', 'M'], ['src/renderer/js/chart.js', 9, 2, 'zapsáno', 'M']],
        ctxFiles: [['src/renderer/js/processes.js', '296 ř.'], ['src/renderer/js/chart.js', '241 ř.']],
        memory: ['Výkon měřit jen přes scripts/measure.sh', 'Historie grafů záměrně nepřežívá restart'],
        tree: [[0, 'src', 1], [1, 'main', 1], [2, 'collectors', 1], [1, 'renderer', 1], [2, 'js', 1], [3, 'chart.js', 0, 'M'], [3, 'processes.js', 0, 'M'], [3, 'overview.js', 0], [0, 'scripts', 1], [1, 'measure.sh', 0], [0, 'package.json', 0]],
        term: [['$ npm run build', 'p'], ['> systemsmith@1.7.1 build', ''], ['error: build failed (exit 1)', 'err'], ['$ npm run build', 'p'], ['> systemsmith@1.7.1 build', ''], ['dist/bundle.js  412 kB · hotovo za 36,2 s', 'ok'], ['$ ', 'p']],
        log: [['11:32:04', 'INFO', N, 'turn_start', 'intent=BUILD expert=developer'], ['11:32:09', 'TOOL', V, 'run_command', 'npm start · ladicí port 9224'], ['11:33:05', 'TOOL', V, 'run_command', 'npm run build · exit 1'], ['11:36:40', 'TOOL', V, 'apply_patch', 'src/renderer/js/processes.js +14 −3'], ['11:37:02', 'TOOL', V, 'apply_patch', 'src/renderer/js/chart.js +9 −2'], ['11:40:12', 'WAIT', W, 'edit_request', 'er-6c21 · 2 soubory'], ['11:44:02', 'INFO', N, 'edit_approve', 'er-6c21 · schváleno uživatelem']],
        runs: [['11:44:02', 'Schválení', 'edit_approve', 'er-6c21 · 2 soubory', '—', 'schváleno'], ['11:39:30', 'Sestavení', 'run_command', 'npm run build', '36,2 s', 'hotovo'], ['11:37:02', 'Úprava souboru', 'apply_patch', 'src/renderer/js/chart.js', '0,2 s', 'hotovo'], ['11:36:40', 'Úprava souboru', 'apply_patch', 'src/renderer/js/processes.js', '0,3 s', 'hotovo'], ['11:33:05', 'Sestavení', 'run_command', 'npm run build', '38,0 s', 'selhalo'], ['11:32:09', 'Spuštění', 'run_command', 'npm start', '4,1 s', 'hotovo']],
        audit: [['11:44:02', 'edit_approve', 'er-6c21 · místní operátor'], ['11:40:12', 'edit_request', 'er-6c21 · 2 soubory'], ['11:31:10', 'session_open', 'projekt SystemSmith_1']],
        problems: [['11:33', 'varování', 'První sestavení selhalo (npm run build, exit 1). Po opravě grafu v 11:39 prošlo.']]
      },
      s3: {
        title: 'NewsSmith — vytvoření widgetu zpráv', short: 'NewsSmith', kind: 'project', project: 'newssmith', state: 'run',
        expert: 'Vývojář', model: 'qwen3.5:27b', mode: 'auto', intent: 'BUILD', ctx: 27, tokens: '8 850 z 32 768', turns: 6,
        parts: [['Systém', 9, N], ['Historie', 11, A], ['Soubory', 7, V]],
        msgs: [
          { k: 'user', time: '14:05', text: 'Vytvoř samostatný desktopový news feed widget podle preferencí. Uživatel si vybere zdroje a témata, může filtrovat podle vlastních klíčových slov, označit přečtené a otevřít původní článek.' },
          { k: 'agent', time: '14:05', badge: 'BUILD', expert: 'Vývojář', rid: 's3a', running: true, runText: 'Píše src/feeds/filter.js · běží 0:41',
            steps: [['Založil strukturu projektu', '0,8 s'], ['Naplánoval 5 modulů', '9,2 s'], ['Vytvořil src/feeds/rss.js', '+86'], ['Píše src/feeds/filter.js', '', 'run']] }
        ],
        changes: [],
        edited: [['src/feeds/rss.js', 86, 0, 'zapsáno', 'A'], ['src/feeds/filter.js', 0, 0, 'zapisuje se', 'A']],
        ctxFiles: [['src/feeds/rss.js', '86 ř.'], ['docs/ZADANI.md', '42 ř.']],
        memory: ['Zdroje jen přes RSS, bez scrapování'],
        tree: [[0, 'src', 1], [1, 'feeds', 1], [2, 'rss.js', 0, 'A'], [2, 'filter.js', 0, 'A'], [1, 'renderer', 1], [0, 'docs', 1], [1, 'ZADANI.md', 0], [0, 'package.json', 0, 'A']],
        term: [['$ mkdir -p src/feeds src/renderer', 'p'], ['$ node --check src/feeds/rss.js', 'p'], ['$ ', 'p']],
        log: [['14:05:02', 'INFO', N, 'turn_start', 'intent=BUILD expert=developer'], ['14:05:03', 'TOOL', V, 'run_command', 'mkdir -p src/feeds src/renderer'], ['14:05:11', 'LLM', A, 'qwen3.5:27b', 'plán 5 modulů · 19,8 tok/s'], ['14:05:40', 'TOOL', V, 'write_file', 'src/feeds/rss.js +86'], ['14:05:52', 'TOOL', V, 'write_file', 'src/feeds/filter.js · probíhá']],
        runs: [['14:05:52', 'Zápis souboru', 'write_file', 'src/feeds/filter.js', '—', 'RUN'], ['14:05:40', 'Nový soubor', 'write_file', 'src/feeds/rss.js', '0,2 s', 'hotovo'], ['14:05:11', 'Odpověď modelu', 'qwen3.5:27b', 'plán 5 modulů', '9,2 s', 'hotovo'], ['14:05:03', 'Příkaz', 'run_command', 'mkdir -p src/feeds src/renderer', '0,1 s', 'hotovo']],
        audit: [['14:05:02', 'turn_start', 'BUILD · režim Auto'], ['14:04:58', 'session_open', 'projekt NewsSmith']],
        problems: []
      },
      s4: {
        title: 'WeatherSmith — vytvoření a ověření', short: 'WeatherSmith', kind: 'project', project: 'weathersmith', state: 'idle',
        expert: 'Vývojář', model: 'qwen3.5:27b', mode: 'kontrola', intent: 'BUILD', ctx: 31, tokens: '10 150 z 32 768', turns: 11,
        parts: [['Systém', 9, N], ['Historie', 17, A], ['Soubory', 5, V]],
        msgs: [
          { k: 'user', time: 'včera 22:04', text: 'Ověř, že uložená místa a nastavení přežijí restart widgetu.' },
          { k: 'agent', time: 'včera 22:10 · 5 min 58 s', badge: 'BUILD', expert: 'Vývojář',
            steps: [['Spustil widget a přidal 2 místa', '6,2 s'], ['Restartoval widget', '3,0 s'], ['Porovnal uložená data před a po restartu', '0,4 s']],
            paras: ['Nastavení i uložená místa restart přežila: Praha a Brno, jednotky °C, poloha vypnutá. Soubor s nastavením se přepisuje až po úspěšném zápisu, takže ho nepoškodí ani pád uprostřed ukládání.'] }
        ],
        changes: [],
        ctxFiles: [['src/settings.js', '118 ř.'], ['src/places.js', '204 ř.']],
        memory: ['Poloha jen na vyžádání, nikdy při startu'],
        tree: [[0, 'src', 1], [1, 'settings.js', 0], [1, 'places.js', 0], [1, 'forecast.js', 0], [0, 'package.json', 0]],
        term: [['$ npm start', 'p'], ['[weathersmith] okno připraveno', ''], ['$ npm start', 'p'], ['[weathersmith] načtena 2 místa, jednotky °C', 'ok'], ['$ ', 'p']],
        log: [['22:04:10', 'INFO', N, 'turn_start', 'intent=BUILD'], ['22:04:31', 'TOOL', V, 'run_command', 'npm start'], ['22:06:40', 'TOOL', V, 'run_command', 'npm start · restart'], ['22:10:08', 'INFO', N, 'turn_end', 'ok · 5 min 58 s']],
        runs: [['22:09:58', 'Porovnání', 'read_file', 'places.json', '0,4 s', 'hotovo'], ['22:06:40', 'Restart', 'run_command', 'npm start', '3,0 s', 'hotovo'], ['22:04:31', 'Spuštění', 'run_command', 'npm start', '6,2 s', 'hotovo']],
        audit: [['22:04:10', 'turn_start', 'BUILD · Vývojář']],
        problems: []
      },
      s5: {
        title: 'Co je to Docker?', short: 'Co je to Docker?', kind: 'chat', project: null, state: 'idle',
        expert: 'Výchozí', model: 'qwen3.5:27b', mode: 'kontrola', intent: 'CONVERSATION', ctx: 6, tokens: '1 960 z 32 768', turns: 2,
        parts: [['Systém', 4, N], ['Historie', 2, A], ['Soubory', 0, V]],
        msgs: [
          { k: 'user', time: 'včera 18:03', text: 'Co je to Docker?' },
          { k: 'agent', time: 'včera 18:03 · 9 s', badge: 'CONVERSATION', expert: 'Výchozí',
            paras: ['Docker je nástroj, který zabalí aplikaci i se vším, co potřebuje ke spuštění – knihovny, nastavení a runtime – do takzvaného kontejneru. Kontejner se pak spustí stejně na tvém počítači, na serveru i v cloudu.', 'Na rozdíl od virtuálního stroje nemá kontejner vlastní operační systém; sdílí jádro hostitele, takže startuje za sekundy a zabírá málo místa. Obraz (image) je předpis, kontejner je jeho běžící instance.'] }
        ],
        changes: [], ctxFiles: [], memory: [], tree: [],
        term: [['$ ', 'p']],
        log: [['18:03:02', 'INFO', N, 'turn_start', 'intent=CONVERSATION'], ['18:03:11', 'INFO', N, 'turn_end', 'ok · 9 s']],
        runs: [], audit: [['18:03:02', 'turn_start', 'CONVERSATION']], problems: []
      },
      s6: {
        title: 'Code Reviewer — kontrola změn v sftp.js', short: 'Revize sftp.js', kind: 'specialist', specialist: 'code-reviewer', project: 'shellsmith', state: 'idle',
        expert: 'Code Reviewer', model: 'qwen3.5:27b', mode: 'kontrola', intent: '', ctx: 19, tokens: '6 230 z 32 768', turns: 2,
        parts: [['Systém', 7, N], ['Historie', 3, A], ['Soubory', 9, V]],
        msgs: [
          { k: 'user', time: '14:10', text: 'Zkontroluj změny, které v relaci 1 čekají na schválení (src/main/sftp.js) – bezpečnost a chybové stavy.' },
          { k: 'agent', time: '14:10 · 21 s', badge: 'SPECIALISTA', expert: 'code-reviewer', author: 'Code Reviewer',
            steps: [['Analýza kódu · code-reviewer.analyze_code', '2,1 s'], ['Security Scan · code-reviewer.security_scan', '1,4 s']],
            paras: ['Nic kritického jsem nenašel. Dvě připomínky:', 'Když selže zjištění velikosti na serveru, přenos tiše začne od nuly. Stojí za to zapsat to do logu, jinak se na opakované přenosy těžko přichází.', 'Cílová cesta se skládá bez normalizace. Pokud může přijít zvenčí, patří před zápis kontrola na „..".'] }
        ],
        changes: [], ctxFiles: [['src/main/sftp.js', '416 ř.']], memory: ['Sestavení přes esbuild, bez TypeScriptu'], tree: [],
        term: [['$ ', 'p']],
        log: [['14:10:02', 'INFO', N, 'turn_start', 'specialist=code-reviewer'], ['14:10:05', 'TOOL', V, 'analyze_code', 'src/main/sftp.js · 2,1 s'], ['14:10:07', 'TOOL', V, 'security_scan', 'src/main/sftp.js · 1,4 s'], ['14:10:23', 'INFO', N, 'turn_end', 'ok · 21 s']],
        runs: [['14:10:07', 'Security Scan', 'code-reviewer.security_scan', 'src/main/sftp.js', '1,4 s', 'hotovo'], ['14:10:05', 'Analýza kódu', 'code-reviewer.analyze_code', 'src/main/sftp.js', '2,1 s', 'hotovo']],
        audit: [['14:10:02', 'specialist_call', 'code-reviewer · 2 nástroje']], problems: []
      }
    };
    const H = [
      { id: 'h1', t: 'Ověření opravy chatu — Databázový index', day: 'Dnes', when: '09:15', project: null },
      { id: 'h2', t: 'Ověření chatu after — Docker/Kubernetes', day: 'Včera', when: '16:47', project: null },
      { id: 'h6', t: 'ShellSmith — převzetí existujícího projektu', day: 'Starší', when: '19. 9.', project: 'shellsmith' },
      { id: 'h3', t: 'SystemSmith_1 — vytvoření samostatné systémové utility', day: 'Starší', when: '18. 9.', project: 'systemsmith_1' },
      { id: 'h4', t: 'Napiš tři krátké nadpisy pro můj deník', day: 'Starší', when: '17. 9.', project: null },
      { id: 'h5', t: 'Najdi mi na českém webu inzerát na benzínové auto', day: 'Starší', when: '16. 9.', project: null },
      { id: 'h7', t: 'Ověření chatu before — Docker/Kubernetes', day: 'Starší', when: '16. 9.', project: null }
    ];
    const P = [
      { id: 'shellsmith', name: 'ShellSmith', path: '~/Projects/shellsmith', status: 'active', last: 'dnes 14:10', desc: 'SSH/SFTP klient pro KDE – náhrada MobaXtermu: strom souborů s přetahováním, záložky, dělené panely a čtyři motivy.', convs: ['s1', 's6', 'h6'], stack: 'Electron · vanilla JS · esbuild', test: 'npm test', code: true, recent: [['src/main/sftp.js', 48, 9], ['src/renderer/js/files.js', 21, 4], ['test/sftp-resume.test.js', 62, 0]], memory: S.s1.memory, tree: S.s1.tree },
      { id: 'systemsmith_1', name: 'SystemSmith_1', path: '~/Projects/intentsmith/projects/systemsmith_1', status: 'active', last: 'dnes 11:44', desc: 'Systémový monitor, který spojuje to dobré ze System Monitoru a Mission Centeru – lehčí, s grafy a přehledem procesů.', convs: ['s2', 'h3'], stack: 'Electron · vanilla JS', code: true, recent: [['src/renderer/js/processes.js', 14, 3], ['src/renderer/js/chart.js', 9, 2]], memory: S.s2.memory, tree: S.s2.tree },
      { id: 'newssmith', name: 'NewsSmith', path: '~/Projects/intentsmith/projects/newssmith', status: 'active', last: 'dnes 14:05', desc: 'Desktopový widget se zprávami podle preferencí: zdroje a témata, vlastní klíčová slova, přečtené články a odkaz na původní článek.', convs: ['s3'], code: true, recent: [['src/feeds/rss.js', 86, 0]], memory: S.s3.memory, tree: S.s3.tree },
      { id: 'weathersmith', name: 'WeatherSmith', path: '~/Projects/intentsmith/projects/weathersmith', status: 'active', last: 'včera 22:10', desc: 'Desktopový widget počasí: aktuální stav a předpověď pro uložená místa, hledání měst a poloha na vyžádání.', convs: ['s4'], code: true, recent: [], memory: S.s4.memory, tree: S.s4.tree },
      { id: 'fan-checker', name: 'fan checker', path: '~/Projects/intentsmith/projects/fan-checker', status: 'active', last: '23. 9.', desc: 'Widget pro sledování otáček ventilátorů v reálném čase s grafy v historii.', convs: [], code: true, recent: [] },
      { id: 'smoke-projekt', name: 'smoke-projekt', path: '~/c3-smoke-projekt', status: 'spec', last: '2. 8.', desc: 'Jednoduchá CLI kalkulačka v Pythonu.', convs: [], code: true, recent: [] }
    ];
    const SP = [
      { id: 'code-reviewer', name: 'Code Reviewer', version: '1.0.0', domain: 'software_engineering', type: 'domain', engine: '>=121.0.0', desc: 'Systematické code review – bezpečnost, výkon, čitelnost, osvědčené postupy, OWASP a SOLID.', tools: [['Analýza kódu', 'code-reviewer.analyze_code'], ['Security Scan', 'code-reviewer.security_scan']], caps: ['code.review', 'code.security_scan'], exps: ['code_reviewer'] },
      { id: 'accountant-cz', name: 'Účetní specialista (CZ)', version: '2.0.0', domain: 'finance', type: 'domain', engine: '>=121.0.0', desc: 'Daňová evidence OSVČ, DPH, pojistné, compliance a reporty.', tools: [['Daňová kalkulačka', 'accountant.tax_calculator'], ['Kalkulačka DPH', 'accountant.vat_calculator'], ['Mzdová kalkulačka', 'accountant.salary_calculator'], ['Daňové termíny', 'accountant.deadline_checker'], ['Porovnání OSVČ a s.r.o.', 'accountant.compare_tax_entities']], caps: ['tax.calculate', 'tax.compare', 'vat.compute', 'salary.compute', 'deadline.check'], exps: [] },
      { id: 'translator', name: 'Překladatel', version: '1.0.0', domain: 'language', type: 'domain', desc: 'Překlad textů mezi jazyky, detekce jazyka a stylistická adaptace.', tools: [['Překlad textu', 'translator.translate'], ['Detekce jazyka', 'translator.detect_language']], caps: ['translation.translate', 'translation.detect'], exps: [], market: 'translator' },
      { id: 'sazeni', name: 'Sázkový analytik', version: '1.0.0', domain: 'sports_betting', type: 'domain', desc: 'Analýza sportovních sázek – porovnání kurzů, statistická analýza, value betting a sestavení tiketů.', tools: [['Porovnání kurzů', 'sazeni.odds_compare'], ['Analýza zápasu', 'sazeni.match_analysis'], ['Sestavení tiketu', 'sazeni.ticket_builder'], ['Value Bet Finder', 'sazeni.value_finder']], caps: ['betting.odds_compare', 'betting.match_analysis', 'betting.ticket_build', 'betting.value_find'], exps: [], market: 'sazeni' },
      { id: 'dummy-logger', name: 'Dummy Logger', version: '1.0.0', domain: 'utility', type: 'utility', engine: '>=65.0.0', desc: 'Minimální specialista pro integrační testy platformy. Zapisuje události s časovými značkami.', tools: [['Format Log Entry', 'logger.format_entry']], caps: [], exps: [] }
    ];
    const CATS = { creative: ['Tvůrčí & Narativní', I.pen], analytical: ['Analyticko-rozhodovací', I.chart], normative: ['Normativní & Odpovědnostní', I.scale], technical: ['Technicko-odborní', I.tool], domain: ['Doménoví znalci', I.target] };
    const ex = (id, name, cat, domain, desc, temp, tone, plan, review, caps, rules) => ({ id, name, cat, domain, desc, temp, tone, plan, review, caps, rules });
    const EX = [
      ex('writer', 'Spisovatel', 'creative', 'creative_writing', 'Povídky, knihy, eseje, články, scénáře', '0,8', 'creative', 'DEEP', 'ITERATIVE', [40, 90, 10, 70, 90], ['Před psaním vždy navrhni strukturu (kapitoly, oblouk příběhu)', 'Udržuj konzistenci postav a světa napříč celým textem', 'Piš poutavě, s živými dialogy a popisy', 'Přizpůsob styl cílové skupině (děti, dospělí, žánr)']),
      ex('dnd_master', 'DnD Master', 'creative', 'tabletop_rpg', 'Kampaně, světy, postavy, questy, příběhy', '0,85', 'creative', 'DEEP', 'ITERATIVE', [40, 95, 5, 80, 85], ['Tvoř živé, konzistentní světy', 'Navrhuj zajímavé NPC s vlastními motivacemi', 'Balancuj mezi výzvou a zábavou', 'Respektuj pravidla systému, ale příběh je první']),
      ex('songwriter', 'Textař', 'creative', 'music_lyrics', 'Texty písní, koncepty alb, hudební struktura', '0,9', 'creative', 'LIGHT', 'ITERATIVE', [35, 85, 10, 75, 60], ['Pracuj s rytmem a melodičností textu', 'Respektuj žánrové konvence', 'Tvoř texty, které sedí na hudbu']),
      ex('analyst', 'Analytik', 'analytical', 'analysis', 'Srovnání, rozbory, přehledy, doporučení', '0,3', 'professional', 'LIGHT', 'SELF', [90, 20, 80, 20, 60], ['Vždy uveď zdroje a jistotu dat', 'Rozlišuj fakta od odhadů', 'Strukturuj výstup logicky', 'Nabízej více perspektiv']),
      ex('trader', 'Překupník', 'analytical', 'trading', 'Nákup a prodej, trendy, načasování, bazar', '0,4', 'professional', 'LIGHT', 'SELF', [70, 20, 60, 50, 40], ['Sleduj trendy a sezónnost', 'Znáj rozdíl retail vs. bazar', 'Upozorňuj na rizika']),
      ex('lawyer', 'Právník', 'normative', 'legal', 'Vysvětlení práva, varianty, rizika', '0,3', 'professional', 'LIGHT', 'SELF', [80, 10, 90, 5, 70], ['Vysvětluj právní koncepty srozumitelně', 'Ukazuj možnosti a rizika', 'Odkazuj na relevantní zákony', 'Vždy doporučuj konzultaci s advokátem']),
      ex('doctor', 'Lékař (edukační)', 'normative', 'medical_education', 'Vysvětlení, možnosti, edukace – ne diagnóza', '0,3', 'professional', 'LIGHT', 'SELF', [70, 10, 85, 5, 60], ['Vysvětluj zdravotní témata srozumitelně', 'Popisuj možnosti a postupy', 'Zdůrazňuj důležitost odborné péče']),
      ex('psychologist', 'Psycholog', 'normative', 'psychology', 'Porozumění, rámování, sebereflexe', '0,6', 'friendly', 'NONE', 'NONE', [60, 50, 30, 40, 70], ['Naslouchej bez souzení', 'Pomáhej s reflexí a pochopením', 'Nabízej různé perspektivy', 'Podporuj zdravé strategie']),
      ex('ai_expert', 'AI Expert', 'technical', 'artificial_intelligence', 'Architektura, modely, trendy, implementace', '0,4', 'professional', 'LIGHT', 'SELF', [85, 35, 65, 30, 55], ['Vysvětluj koncepty na různých úrovních', 'Sleduj aktuální trendy', 'Kriticky hodnoť technologie', 'Navrhuj praktická řešení']),
      ex('developer', 'Vývojář', 'technical', 'software_development', 'Kód, architektura, debugging, osvědčené postupy', '0,3', 'concise', 'LIGHT', 'SELF', [80, 40, 70, 30, 30], ['Piš čistý, čitelný kód', 'Dodržuj best practices a design patterns', 'Zajisti testovatelnost', 'Upozorni na edge cases']),
      ex('technician', 'Technik', 'technical', 'technical_support', 'Opravy, postupy, návody, řešení potíží', '0,3', 'professional', 'NONE', 'NONE', [65, 15, 80, 15, 50], ['Postupuj krokovými instrukcemi', 'Bezpečnost na prvním místě', 'Diagnóza před opravou', 'Upozorni na rizika']),
      ex('car_enthusiast', 'Autíčkář', 'domain', 'automobiles', 'Auta, motory, výběr, zkušenosti z praxe', '0,5', 'friendly', 'NONE', 'NONE', [55, 20, 50, 40, 50], ['Praktické zkušenosti nad specifikacemi', 'Znáš typické problémy modelů', 'Víš, co hledat při koupi', 'Rozumíš provozním nákladům']),
      ex('biker', 'Motorkář', 'domain', 'motorcycles', 'Motorky, styl jízdy, výběr, bezpečnost', '0,5', 'friendly', 'NONE', 'NONE', [50, 20, 45, 35, 50], ['Bezpečnost vždy první', 'Praktické rady z praxe', 'Respekt k začátečníkům', 'Znalost různých stylů jízdy']),
      ex('political_analyst', 'Politický analytik', 'domain', 'politics', 'Rozbor, kontext, scénáře – bez agitace', '0,4', 'professional', 'LIGHT', 'SELF', [85, 25, 60, 25, 65], ['Zachovávej neutralitu a vyváženost', 'Uváděj kontext a historii', 'Nabízej více perspektiv', 'Žádná agitace'])
    ];
    const WK = [
      { id: 'morning-briefing', name: 'Ranní přehled', desc: 'Spojí RSS zprávy, počasí z HTTP API a směnný kurz do jednoho ranního přehledu.', kind: 'cron', expr: '0 7 * * *', when: 'Každý den v 7:00', sources: [['rss', 'feeds.bbci.co.uk'], ['http', 'api.open-meteo.com'], ['http', 'api.exchangerate-api.com']], conds: ['exists', 'exists'], channel: 'push' },
      { id: 'ai-news-digest', name: 'AI News Digest', desc: 'Sleduje RSS kanály s novinkami z AI a posílá denní přehled na Telegram.', kind: 'cron', expr: '0 8 * * *', when: 'Každý den v 8:00', sources: [['rss', 'www.novinky.cz'], ['rss', 'technet.idnes.cz']], conds: ['new_items'], channel: 'telegram' },
      { id: 'tax-rate-monitor', name: 'Hlídač daňových sazeb', desc: 'Každý týden zkontroluje aktuálnost daňových sazeb z oficiálních zdrojů – ČSSZ, VZP, MPSV a Finanční správa.', kind: 'cron', expr: '0 9 * * 1', when: 'Každé pondělí v 9:00', sources: [['http', 'www.cssz.cz'], ['http', 'www.vzp.cz'], ['http', 'www.mpsv.cz'], ['http', 'www.financnisprava.cz'], ['http', 'www.financnisprava.cz'], ['http', 'www.financnisprava.cz']], conds: ['changed'], channel: 'in_app' },
      { id: 'realty-multi', name: 'Realitní hlídač (více zdrojů)', desc: 'Hlídá několik realitních portálů a porovnává nové inzeráty napříč zdroji.', kind: 'interval', expr: '30m', when: 'Každých 30 minut', sources: [['http', 'www.sreality.cz'], ['http', 'www.bezrealitky.cz']], conds: ['exists'], channel: 'email' },
      { id: 'realty-watcher', name: 'Realitní hlídač', desc: 'Hlídá nové inzeráty na sreality.cz podle zadaných kritérií a posílá e-mail.', kind: 'interval', expr: '30m', when: 'Každých 30 minut', sources: [['http', 'www.sreality.cz']], conds: ['new_items'], channel: 'email' },
      { id: 'weather-frost-alert', name: 'Hlídač mrazu', desc: 'Sleduje teplotu přes OpenMeteo a pošle upozornění na Telegram, když klesne pod 0 °C.', kind: 'interval', expr: '1h', when: 'Každou hodinu', sources: [['http', 'api.open-meteo.com']], conds: ['compare'], channel: 'telegram' }
    ];
    const mk = (id, type, name, version, desc, inst) => ({ id, type, name, version, desc, inst });
    const MK = [
      mk('brainstorm', 'skill', 'Brainstorming', '1', 'Strukturovaný brainstorming s kreativními technikami SCAMPER a šesti myslitelskými klobouky.', true),
      mk('changelog-gen', 'skill', 'Generátor changelogu', '1', 'Vygeneruje changelog z git commitů – formátovaný přehled změn.', true),
      mk('code-refactor', 'skill', 'Refaktoring kódu', '1', 'Průvodce refaktorováním – analýza code smells, návrh změn a ověření výsledku.', true),
      mk('email-composer', 'skill', 'Sestavení e-mailu', '1', 'Sestaví profesionální e-mail od předmětu po podpis.', true),
      mk('interview-prep', 'skill', 'Příprava na pohovor', '1', 'Otázky, odpovědi metodou STAR a strategie pro konkrétní pozici.', true),
      mk('meeting-notes', 'skill', 'Zápis ze schůzky', '1', 'Strukturuje surové poznámky ze schůzky do přehledného zápisu.', true),
      mk('presentation', 'skill', 'Prezentace', '1', 'Od osnovy přes strukturu slajdů až po finální obsah v markdownu.', true),
      mk('summarizer', 'skill', 'Shrnutí textu', '1', 'Stručné shrnutí dokumentu nebo textu s klíčovými body.', true),
      mk('api_designer', 'expertise', 'API Designér', '1.0.0', 'Návrh REST a GraphQL API – endpointy, verzování, autentizace a konvence.', false),
      mk('backend_developer', 'expertise', 'Backend Developer', '1.0.0', 'Server-side vývoj v Node.js, Pythonu a Go – API, autentizace, databáze, cache.', false),
      mk('copywriter', 'expertise', 'Copywriter', '1.0.0', 'Marketingové texty, titulky, výzvy k akci a SEO copy.', false),
      mk('data_analyst', 'expertise', 'Datový analytik', '1.0.0', 'Statistické metody, vizualizace, pandas, SQL, hypotézy a dashboardy.', false),
      mk('devops_engineer', 'expertise', 'DevOps Inženýr', '1.0.0', 'CI/CD, infrastruktura, kontejnerizace, orchestrace a monitoring.', false),
      mk('docker_expert', 'expertise', 'Docker Specialista', '1.0.0', 'Optimalizace Dockerfile, multi-stage buildy, compose, sítě a bezpečnost kontejnerů.', false),
      mk('translator', 'specialist', 'Překladatel', '1.0.0', 'Překlad textů mezi jazyky, detekce jazyka a stylistická adaptace.', true),
      mk('sazeni', 'specialist', 'Sázkový analytik', '1.0.0', 'Porovnání kurzů, analýza zápasů, value betting a sestavení tiketů.', true)
    ];
    const SET = [
      { id: 'ucet', name: 'Účet', icon: I.sliders, tone: 'blue', desc: 'Profil a projekty.', tabs: [['prehled', 'Profil'], ['projekty', 'Projekty']] },
      { id: 'modely', name: 'Modely a inference', icon: I.cpu, tone: 'violet', desc: 'Modely, inference, připojení a hardware.', tabs: [['prehled', 'Lokální modely'], ['inference', 'Inference'], ['pripojeni', 'Připojení'], ['hardware', 'Hardware']] },
      { id: 'pamet', name: 'Paměť', icon: I.db, tone: 'cyan', desc: 'Historie, kontext a automatické učení.', tabs: [['prehled', 'Historie a kontext'], ['uceni', 'Paměť a učení'], ['retence', 'Kapacita a retence']] },
      { id: 'oznameni', name: 'Oznámení', icon: I.bell, tone: 'amber', desc: 'Kanály oznámení a čas pro soustředění.', tabs: [['prehled', 'Kanály'], ['ticho', 'Tiché hodiny']] },
      { id: 'vystup', name: 'Výstup', icon: I.code, tone: 'blue', desc: 'Formátování a délka odpovědi.', tabs: [['prehled', 'Formátování'], ['delka', 'Délka odpovědi']] },
      { id: 'vzhled', name: 'Vzhled', icon: I.palette, tone: 'violet', desc: 'Paleta, písmo a rozvržení pracovního prostředí.', tabs: [['obecne', 'Obecné'], ['pismo', 'Písmo'], ['barvy', 'Barvy a prvky'], ['rozvrzeni', 'Rozvržení'], ['css', 'Vlastní CSS']] },
      { id: 'system', name: 'Systém', icon: I.cpu, tone: 'blue', desc: 'Prostředí, spouštění, diagnostika a limity.', tabs: [['prostredi', 'Prostředí a závislosti'], ['spousteni', 'Spouštění'], ['diagnostika', 'Diagnostika'], ['limity', 'Limity']] },
      { id: 'uloziste', name: 'Úložiště', icon: I.drive, tone: 'cyan', desc: 'Přehled databáze a údržba.', tabs: [['prehled', 'Databáze'], ['udrzba', 'Údržba']] },
      { id: 'zalohy', name: 'Zálohy', icon: I.drive, tone: 'cyan', desc: 'Export, obnova a výchozí hodnoty.', tabs: [['prehled', 'Export'], ['obnova', 'Obnova'], ['vychozi', 'Výchozí hodnoty']] },
      { id: 'prepinace', name: 'Funkční přepínače', icon: I.toggle, tone: 'violet', desc: 'Dostupné subsystémy a jejich běhové přepínače.', tabs: [['prehled', 'Přepínače'], ['obnoveni', 'Obnovení']] },
      { id: 'zabezpeceni', name: 'Zabezpečení', icon: I.shield, tone: 'mint', desc: 'Audit, přístup a relace.', tabs: [['prehled', 'Audit'], ['pristup', 'Přístup'], ['relace', 'Relace']] },
      { id: 'about', name: 'O aplikaci', icon: I.info, tone: 'blue', desc: 'Verze aplikace, protokol a stav backendu.', tabs: [['prehled', 'Aplikace'], ['zpetna_vazba', 'Zpětná vazba']] }
    ];
    const MODELS = ['qwen3.5:27b', 'qwen3.6:27b', 'gemma4:26b', 'qwen3.8:latest', 'qwen3-coder:latest', 'qwen3-30b-a3b:latest', 'devstral-small-2:latest', 'phi4:14b', 'qwen3:14b', 'ornith-1.5:9b', 'llava:13b', 'llava-llama3:8b'];
    const FILES = {
      'src/main/sftp.js': "'use strict';\n\nconst fs = require('fs');\nconst { throttle } = require('./util');\n\n// Velikost cíle na serveru; chybějící soubor = 0.\nasync function remoteSize(sftp, target) {\n  const st = await sftp.stat(target);\n  return st.size;\n}\n\nasync function upload(sftp, local, target, onProgress) {\n  const offset = await remoteSize(sftp, target).catch(() => 0);\n  const stream = fs.createReadStream(local, { start: offset });\n  const total = (await fs.promises.stat(local)).size;\n  let sent = offset;\n  const tick = throttle(() => onProgress(sent, total), 250);\n  return new Promise((resolve, reject) => {\n    const ws = sftp.createWriteStream(target, {\n      flags: offset > 0 ? 'r+' : 'w',\n      start: offset\n    });\n    stream.on('data', (chunk) => {\n      sent += chunk.length; tick();\n    });\n    stream.pipe(ws).on('close', resolve).on('error', reject);\n  });\n}\n\nmodule.exports = { upload, remoteSize };",
      'src/renderer/js/files.js': "import { fmt } from './format.js';\n\nexport function renderTransfer(row, t) {\n  const pct = t.total ? Math.round(t.sent / t.total * 100) : 0;\n  row.querySelector('.size').textContent = fmt(t.sent) + ' / ' + fmt(t.total);\n  row.querySelector('.bar').style.width = pct + '%';\n}\n\nexport function renderRow(file) {\n  const row = document.createElement('div');\n  row.className = 'frow';\n  row.innerHTML = `<span class=\"name\"></span><span class=\"size\"></span><i class=\"bar\"></i>`;\n  row.querySelector('.name').textContent = file.name;\n  return row;\n}",
      'test/sftp-resume.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { upload } from '../src/main/sftp.js';\n\ntest('obnoví přenos od posunu', async () => {\n  const sftp = fakeSftp({ remoteSize: 4096 });\n  await upload(sftp, fixture('8k.bin'), '/tmp/8k.bin', () => {});\n  assert.equal(sftp.written.start, 4096);\n});",
      'docs/ARCHITECTURE.md': "# ShellSmith – architektura\n\n## Procesy\n\n- **main** – SSH a SFTP spojení, okna, klíčenka.\n- **renderer** – záložky, terminál, strom souborů.\n\n## Přenosy souborů\n\nPřenos běží v hlavním procesu po blocích 32 KiB.\nPřerušený přenos pokračuje od posledního potvrzeného bloku.\nRenderer dostává průběh nejvýš čtyřikrát za sekundu.",
      'src/main/ssh.js': "'use strict';\n\nconst { Client } = require('ssh2');\n\nfunction connect(profile, onReady) {\n  const c = new Client();\n  c.on('ready', () => onReady(c));\n  c.connect({ host: profile.host, port: profile.port || 22, username: profile.user, agent: process.env.SSH_AUTH_SOCK });\n  return c;\n}\n\nmodule.exports = { connect };",
      'package.json': "{\n  \"name\": \"shellsmith\",\n  \"version\": \"1.1.2\",\n  \"main\": \"src/main/window.js\",\n  \"scripts\": {\n    \"start\": \"electron .\",\n    \"build\": \"node scripts/build.mjs\",\n    \"test\": \"node --test test/\"\n  }\n}",
      'README.md': "# ShellSmith\n\nSSH/SFTP klient pro KDE – strom souborů s přetahováním,\nzáložky, dělené panely a čtyři motivy.\n\n    npm install\n    npm start",
      'src/feeds/rss.js': "export async function readFeed(url, fetchImpl = fetch) {\n  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });\n  if (!res.ok) throw new Error('RSS ' + res.status);\n  const xml = await res.text();\n  return parseItems(xml);\n}\n\nfunction parseItems(xml) {\n  const out = [];\n  for (const m of xml.matchAll(/<item>([\\s\\S]*?)<\\/item>/g)) {\n    out.push({ title: pick(m[1], 'title'), link: pick(m[1], 'link'), date: pick(m[1], 'pubDate') });\n  }\n  return out;\n}",
      'src/renderer/js/processes.js': "import { sortBy } from './table.js';\n\nexport function diskRate(p) {\n  return (p.readBps || 0) + (p.writeBps || 0);\n}\n\nexport const COLUMNS = [\n  ['name', 'Proces'],\n  ['cpu', 'CPU'],\n  ['mem', 'Paměť'],\n  ['disk', 'Disk', diskRate]\n];\n\nexport function sortRows(rows, key) {\n  const col = COLUMNS.find((c) => c[0] === key);\n  return sortBy(rows, col && col[2] ? col[2] : (r) => r[key]);\n}",
      'src/renderer/js/chart.js': "export function draw(ctx, samples, opts) {\n  if (samples.length < 2) return;\n  const w = ctx.canvas.width, h = ctx.canvas.height;\n  ctx.clearRect(0, 0, w, h);\n  ctx.beginPath();\n  samples.forEach((v, i) => {\n    const x = i / (samples.length - 1) * w;\n    const y = h - v / opts.max * h;\n    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);\n  });\n  ctx.stroke();\n}"
    };
    const DIFFS = {
      'docs/ARCHITECTURE.md': [hk('@@ -9,4 +9,6 @@ ## Přenosy souborů'), cx('9', '9', '## Přenosy souborů'), cx('10', '10', ''), cx('11', '11', 'Přenos běží v hlavním procesu po blocích 32 KiB.'), dl('12', 'Přerušený přenos začne znovu.'), ad('12', 'Přerušený přenos pokračuje od posledního potvrzeného bloku.'), ad('13', 'Renderer dostává průběh nejvýš čtyřikrát za sekundu.')],
      'src/renderer/js/processes.js': [hk('@@ -1,6 +1,10 @@'), cx('1', '1', "import { sortBy } from './table.js';"), cx('2', '2', ''), ad('3', 'export function diskRate(p) {'), ad('4', '  return (p.readBps || 0) + (p.writeBps || 0);'), ad('5', '}'), ad('6', ''), cx('3', '7', 'export const COLUMNS = ['), dl('6', "  ['disk', 'Disk']"), ad('10', "  ['disk', 'Disk', diskRate]")],
      'src/renderer/js/chart.js': [hk('@@ -1,3 +1,3 @@'), cx('1', '1', 'export function draw(ctx, samples, opts) {'), dl('2', '  if (!samples.length) return;'), ad('2', '  if (samples.length < 2) return;'), cx('3', '3', '  const w = ctx.canvas.width, h = ctx.canvas.height;')]
    };
    const POL = (o) => Object.assign({ init: 'ask', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask' }, o || {});
    const GIT = {
      shellsmith: { repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, fetched: 'dnes 13:58', remote: 'origin', host: 'github.com', policy: POL(),
        branches: ['main', 'work/sftp-resume', 'release/1.1'], remoteBranches: ['origin/main', 'origin/release/1.1'],
        changes: [['docs/ARCHITECTURE.md', 'M', 2, 1]],
        log: [['b', 'a41c9e2', 'WIP: obnovení přenosu přes SFTP', 'operátor', 'dnes 12:40', ['work/sftp-resume']], ['o', '9f8e7d6', 'Záložky: zavření bez posunu fokusu', 'IntentSmith', 'dnes 11:02', []], ['o', '5c4b3a2', 'Strom souborů: přetahování více položek', 'operátor', 'včera 19:30', []], ['f', '3e2d1c0', 'Motivy: čtvrtý motiv Nocturne', 'IntentSmith', '23. 9.', []], ['m', '7a6b5c4', 'Sloučení větve work/split-panes', 'operátor', '22. 9.', []], ['b', '2d3e4f5', 'Dělené panely: svislé dělení', 'IntentSmith', '21. 9.', []], ['f', '1a2b3c4', 'Vydání 1.1.2', 'operátor', '20. 9.', ['v1.1.2']], ['o', '0f9e8d7', 'SFTP: přenos po blocích', 'IntentSmith', '19. 9.', []]],
        incoming: [] },
      systemsmith_1: { repo: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 2, fetched: 'dnes 11:20', remote: 'origin', host: 'github.com', policy: POL({ fetch: 'disabled' }),
        branches: ['main'], remoteBranches: ['origin/main'], changes: [],
        log: [['o', '6b5a4c3', 'Procesy: sloupec GPU', 'IntentSmith', 'dnes 10:15', []], ['o', '8d7c6b5', 'Měření výkonu přes scripts/measure.sh', 'operátor', '23. 9.', []], ['o', '2f1e0d9', 'Založení projektu', 'IntentSmith', '18. 9.', []]],
        incoming: [['o', 'd4e5f6a', 'Teploty NVMe: čtení mimo hlavní vlákno', 'operátor', 'dnes 12:05', []], ['o', 'b3c2d1e', 'README: snímky obrazovky', 'operátor', 'dnes 12:01', []]] },
      newssmith: { repo: true, branch: 'main', upstream: '', ahead: 0, behind: 0, fetched: '', remote: '', host: '', policy: POL({ fetch: 'disabled', pull: 'disabled', push: 'disabled' }),
        branches: ['main'], remoteBranches: [], changes: [['package.json', 'A', 18, 0], ['docs/ZADANI.md', 'A', 42, 0]],
        log: [['o', 'e1f2a3b', 'Založení projektu', 'IntentSmith', 'dnes 14:04', []]], incoming: [] },
      weathersmith: { repo: false, policy: POL({ init: 'ask' }) }
    };
    this._d = { I, S, H, P, SP, CATS, EX, WK, MK, SET, MODELS, FILES, DIFFS, GIT };
    return this._d;
  }

  sections() {
    const I = this.data().I;
    return [
      { id: 'chats', label: 'Konverzace', short: 'Chat', icon: I.chat, tone: 'amber', newLabel: 'Nová konverzace' },
      { id: 'projects', label: 'Projekty', short: 'Projekty', icon: I.folder, tone: 'rose', newLabel: 'Nový projekt' },
      { id: 'specialists', label: 'Specialisté', short: 'Specialisté', icon: I.users, tone: 'violet', newLabel: 'Nový specialista' },
      { id: 'expertises', label: 'Expertýzy', short: 'Expertýzy', icon: I.cap, tone: 'cyan', newLabel: 'Nová expertýza' },
      { id: 'workers', label: 'Workeři', short: 'Workeři', icon: I.bot, tone: 'mint', newLabel: 'Nový worker' },
      { id: 'market', label: 'Obchod', short: 'Obchod', icon: I.bag, tone: 'blue', newLabel: '' },
      { id: 'media', label: 'Multimédia', short: 'Média', icon: I.image, tone: 'violet', newLabel: 'Nové generování' },
      { id: 'settings', label: 'Nastavení', short: 'Nastavení', icon: I.gear, tone: 'none', newLabel: '' }
    ];
  }

  sec(id) { return this.sections().find((x) => x.id === id) || this.sections()[0]; }

  proj(id) { return this.data().P.find((p) => p.id === id) || null; }

  spec(id) { return this.data().SP.find((p) => p.id === id) || null; }

  sess(sid, s) {
    const d = this.data();
    if (d.S[sid]) return d.S[sid];
    const x = s.sessions[sid];
    if (!x) return null;
    const N = 'var(--info)', A = 'var(--acct)', V = 'var(--violet)';
    if (x.hist) {
      const h = d.H.find((q) => q.id === x.hist);
      const p = h && h.project ? this.proj(h.project) : null;
      return {
        title: h ? h.t : 'Konverzace', short: h ? h.t : 'Konverzace', kind: p ? 'project' : 'chat', project: p ? p.id : null, state: 'idle',
        expert: p ? 'Vývojář' : 'Výchozí', model: 'qwen3.5:27b', mode: 'kontrola', intent: 'CONVERSATION', ctx: 5, tokens: '1 640 z 32 768', turns: 2,
        parts: [['Systém', 4, N], ['Historie', 1, A], ['Soubory', 0, V]],
        msgs: [{ k: 'user', time: h ? h.when : '', text: h ? h.t : '' }, { k: 'agent', time: h ? h.when : '', badge: 'CONVERSATION', expert: p ? 'Vývojář' : 'Výchozí', paras: ['Konverzace je obnovená z historie. Starší zprávy se načtou při posunu nahoru; pokračovat můžeš rovnou novou zprávou.'] }],
        changes: [], ctxFiles: [], memory: p && p.memory ? p.memory : [], tree: p && p.tree ? p.tree : [], term: [['$ ', 'p']], log: [['teď', 'INFO', N, 'rehydrate', 'konverzace obnovena z historie']], runs: [], audit: [['teď', 'rehydrate', h ? h.t : '']], problems: []
      };
    }
    const p = x.project ? this.proj(x.project) : null;
    const sp = x.specialist ? this.spec(x.specialist) : null;
    const title = sp ? sp.name + ' — nová konverzace' : p ? p.name + ' — nová relace' : 'Nová konverzace';
    return {
      title, short: sp ? sp.name : p ? p.name : 'Nová konverzace', kind: sp ? 'specialist' : p ? 'project' : 'chat', project: p ? p.id : null, specialist: sp ? sp.id : null, state: 'idle', fresh: true,
      expert: sp ? sp.name : p ? 'Vývojář' : 'Výchozí', model: 'qwen3.5:27b', mode: 'kontrola', intent: '', ctx: 2, tokens: '650 z 32 768', turns: 0,
      parts: [['Systém', 2, N], ['Historie', 0, A], ['Soubory', 0, V]],
      msgs: [], changes: [], ctxFiles: [], memory: p && p.memory ? p.memory : [], tree: p && p.tree ? p.tree : [], term: [['$ ', 'p']], log: [['teď', 'INFO', N, 'session_open', title]], runs: [], audit: [['teď', 'session_open', title]], problems: []
    };
  }

  kindIcon(k) { const I = this.data().I; return k === 'project' ? I.folder : k === 'specialist' ? I.users : I.chat; }

  isRunning(sid, s) {
    const b = this.sess(sid, s);
    if (!b) return false;
    return b.msgs.concat(s.extra[sid] || []).some((m) => m.running && !s.stopped[m.rid]);
  }

  sstate(sid, s) {
    const b = this.sess(sid, s);
    if (!b) return 'idle';
    if (this.isRunning(sid, s)) return 'run';
    if (b.state === 'run') return 'idle';
    if (b.state === 'wait' && s.approved[sid]) return s.approved[sid] === 'ok' ? 'ok' : 'idle';
    return b.state;
  }

  stLabel(st) { return { run: 'pracuje', wait: 'čeká na schválení', ok: 'hotovo', idle: 'nečinná' }[st]; }

  stColor(st) { return { run: 'var(--acct)', wait: 'var(--warn)', ok: 'var(--ok)', idle: 'var(--faint)' }[st]; }

  filesWord(n) { return n === 1 ? '1 soubor' : (n >= 2 && n <= 4 ? n + ' soubory' : n + ' souborů'); }

  toolsWord(n) { return n === 1 ? '1 nástroj' : (n >= 2 && n <= 4 ? n + ' nástroje' : n + ' nástrojů'); }

  ctxOf(sid, s) {
    const b = this.sess(sid, s);
    return b ? Math.min(96, b.ctx + (s.extra[sid] || []).length * 2) : 0;
  }

  colLayout(s) {
    const tabs = s.tabs;
    const n = Math.min(s.cols, tabs.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      let sid = s.colSids[i];
      if (!sid || tabs.indexOf(sid) < 0 || out.indexOf(sid) >= 0) {
        const later = s.colSids.slice(i + 1, n);
        sid = tabs.find((t) => out.indexOf(t) < 0 && later.indexOf(t) < 0) || tabs.find((t) => out.indexOf(t) < 0);
      }
      if (sid) out.push(sid);
    }
    return out;
  }

  focusIdx(s, lay) { return lay.length ? Math.max(0, Math.min(s.focusCol, lay.length - 1)) : 0; }

  focusSid(s) { const lay = this.colLayout(s); return lay.length ? lay[this.focusIdx(s, lay)] : null; }

  pFocusSession(s, sid) {
    const lay = this.colLayout(s);
    const i = lay.indexOf(sid);
    if (i >= 0) return { mode: 'sessions', focusCol: i, colSids: lay.slice() };
    const next = lay.slice();
    const f = this.focusIdx(s, lay);
    if (!next.length) next.push(sid); else next[f] = sid;
    return { mode: 'sessions', focusCol: next.indexOf(sid), colSids: next };
  }

  pOpenSession(s, id) {
    const d = this.data();
    let sessions = s.sessions, tabs = s.tabs;
    if (tabs.indexOf(id) < 0) {
      if (!d.S[id] && !s.sessions[id]) sessions = Object.assign({}, s.sessions, { [id]: { hist: id } });
      tabs = tabs.concat([id]);
    }
    return this.chain(s, { sessions, tabs }, (s2) => this.pFocusSession(s2, id));
  }

  pNewSession(s, opts) {
    const o = opts || {};
    const sid = 'n' + s.seq;
    const sessions = Object.assign({}, s.sessions, { [sid]: { fresh: true, project: o.project || null, specialist: o.specialist || null } });
    return this.chain(s, { sessions, seq: s.seq + 1, tabs: s.tabs.concat([sid]) }, (s2) => this.pFocusSession(s2, sid));
  }

  pOpenBeside(s, id) {
    const base = s.tabs.indexOf(id) < 0 ? this.pOpenSession(s, id) : {};
    const s1 = Object.assign({}, s, base);
    const lay = this.colLayout(Object.assign({}, s1, { colSids: s.colSids }));
    if (lay.indexOf(id) >= 0) return Object.assign(base, { mode: 'sessions', colSids: lay, focusCol: lay.indexOf(id) });
    if (s1.cols < 3 && lay.length === s1.cols) {
      const next = lay.concat([id]);
      return Object.assign(base, { mode: 'sessions', cols: s1.cols + 1, colSids: next, focusCol: next.length - 1, colFr: [1, 1, 1] });
    }
    const next = lay.slice();
    const f = this.focusIdx(s1, lay);
    const slot = next.length > 1 ? (f + 1) % next.length : 0;
    next[slot] = id;
    return Object.assign(base, { mode: 'sessions', colSids: next, focusCol: slot });
  }

  pCloseTab(s, sid) {
    const tabs = s.tabs.filter((t) => t !== sid);
    const colSids = s.colSids.map((x) => (x === sid ? null : x));
    return { tabs, colSids, focusCol: Math.max(0, Math.min(s.focusCol, Math.min(s.cols, tabs.length) - 1)) };
  }

  pTogglePinned(s, sid) {
    const pinned = this.merge(s, 'pinned', { [sid]: !s.pinned[sid] });
    return { pinned, tabs: s.tabs.filter(id => pinned[id]).concat(s.tabs.filter(id => !pinned[id])) };
  }

  pSetCols(s, n) {
    return { mode: 'sessions', cols: n, colFr: [1, 1, 1], focusCol: Math.min(s.focusCol, n - 1) };
  }

  pGo(s, sec) {
    return { mode: 'section', section: sec, chip: sec === s.section ? s.chip : 'vse', q: sec === s.section ? s.q : '' };
  }

  pSelect(s, sec, id) {
    return { mode: 'section', section: sec, detail: this.merge(s, 'detail', { [sec]: id }), chip: sec === s.section ? s.chip : 'vse', q: sec === s.section ? s.q : '' };
  }

  pApprove(s, sid, v) { return { approved: this.merge(s, 'approved', { [sid]: v }) }; }

  pSend(s, sid) {
    const text = (s.drafts[sid] || '').trim();
    const atts = s.atts[sid] || [];
    if (!text && !atts.length) return null;
    const b = this.sess(sid, s);
    const expert = s.experts[sid] || b.expert;
    const rid = 'r' + s.seq;
    const msgs = (s.extra[sid] || []).concat([
      { k: 'user', time: 'teď', text, atts: atts.map((a) => a[0]) },
      { k: 'agent', time: 'teď', badge: b.intent || (b.kind === 'specialist' ? 'SPECIALISTA' : 'CONVERSATION'), expert, author: b.kind === 'specialist' ? b.short : '', rid, running: true, runText: 'Model ' + b.model + ' odpovídá…', steps: [['Načetl kontext relace', '0,4 s'], ['Připravuje odpověď', '', 'run']] }
    ]);
    return { extra: this.merge(s, 'extra', { [sid]: msgs }), drafts: this.merge(s, 'drafts', { [sid]: '' }), atts: this.merge(s, 'atts', { [sid]: [] }), seq: s.seq + 1 };
  }

  showCtx(sec, id, anchored) {
    return (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      const z = Number(this.st().scale) / 100 || 1;
      const w = (typeof window !== 'undefined' ? window.innerWidth : 1600) / z;
      const h = (typeof window !== 'undefined' ? window.innerHeight : 960) / z;
      let x = ((e && e.clientX) || 200) / z, y = ((e && e.clientY) || 200) / z;
      if (anchored) {
        try { const r = e.currentTarget.getBoundingClientRect(); x = (anchored === 'right' ? r.right - 280 : r.left) / z; y = r.bottom / z + 4; } catch (err) { /* souřadnice z události */ }
      }
      x = Math.max(4, Math.min(x, w - 290));
      y = Math.max(4, Math.min(y, h - 200));
      this.setState({ ctx: { sec, id, x, y }, menu: null, ctxQ: '' });
    };
  }

  // Terminál relace: Enter spustí, Tab doplní cestu ze stromu projektu.
  termKey(e, sid) {
    const s = this.st();
    const cmd = s.cmds[sid] || '';
    if (e.key === 'Tab') {
      if (e.preventDefault) e.preventDefault();
      const b = this.sess(sid, s);
      const m = cmd.match(/(\S*)$/);
      const pre = m ? m[1] : '';
      const stack = [];
      const paths = [];
      (b && b.tree || []).forEach((t) => { stack.length = t[0]; paths.push(stack.concat([t[1]]).join('/') + (t[2] ? '/' : '')); stack.push(t[1]); });
      const hit = pre && paths.find((x) => x.indexOf(pre) === 0 && x !== pre);
      if (hit) this.setState({ cmds: this.merge(s, 'cmds', { [sid]: cmd.slice(0, cmd.length - pre.length) + hit }) });
      return;
    }
    if (e.key !== 'Enter' || !cmd.trim()) return;
    if (e.preventDefault) e.preventDefault();
    const lines = (s.termX[sid] || []).concat([['$ ' + cmd.trim(), 'p'], ['(prototyp příkaz nespouští – v IDE jde přes kanál terminal)', '']]);
    this.setState({ termX: this.merge(s, 'termX', { [sid]: lines }), cmds: this.merge(s, 'cmds', { [sid]: '' }) });
  }

  pPickInCol(s, i, sid) {
    const lay = this.colLayout(s);
    const next = lay.slice();
    const j = next.indexOf(sid);
    if (j === i) return { mode: 'sessions', focusCol: i };
    if (j >= 0) next[j] = next[i];
    next[i] = sid;
    return { mode: 'sessions', colSids: next, focusCol: i };
  }

  entities(sec, s) {
    const d = this.data(), I = d.I;
    if (sec === 'chats') {
      const open = s.tabs.map((sid, i) => {
        const b = this.sess(sid, s);
        const st = this.sstate(sid, s);
        const p = b.project ? this.proj(b.project) : null;
        const sp = b.specialist ? this.spec(b.specialist) : null;
        const first = b.msgs.concat(s.extra[sid] || []).find((m) => m.k === 'user');
        return { id: sid, name: b.title, sub: sp ? 'specialista ' + sp.name : p ? p.name : 'bez projektu', desc: first ? first.text : 'Zatím bez zpráv.', icon: this.kindIcon(b.kind), tone: 'amber', dot: st, num: i + 1, groups: ['open', p ? 'project' : 'free'].concat(sp ? ['specialist'] : []), group: 'Otevřené relace', catLabel: 'Relace ' + (i + 1), meta: this.stLabel(st), metaColor: this.stColor(st), tag: '', state: this.stLabel(st) };
      });
      const hist = d.H.filter((h) => s.tabs.indexOf(h.id) < 0).map((h) => {
        const p = h.project ? this.proj(h.project) : null;
        return { id: h.id, name: h.t, sub: p ? p.name : 'bez projektu', desc: 'Uložená konverzace · otevře se jako nová relace.', icon: p ? I.folder : I.chat, tone: 'amber', groups: [p ? 'project' : 'free'], group: h.day, catLabel: h.day === 'Starší' ? h.when : h.day + ' ' + h.when, meta: h.when, tag: '', state: 'uložená' };
      });
      return open.concat(hist);
    }
    if (sec === 'projects') {
      return d.P.map((p) => {
        const openN = p.convs.filter((c) => s.tabs.indexOf(c) >= 0).length;
        return { id: p.id, name: p.name, sub: p.path, desc: p.desc, icon: I.folder, tone: 'rose', groups: [p.status], group: p.status === 'active' ? 'Aktivní' : 'Specifikace', catLabel: p.status === 'active' ? 'aktivní' : 'specifikace', meta: openN ? (openN === 1 ? '1 otevřená relace' : openN + ' otevřené relace') : p.last, metaColor: openN ? 'var(--acct)' : '', tag: p.status === 'active' ? 'aktivní' : 'specifikace', tagCls: p.status === 'active' ? 'ok' : '', state: p.status === 'active' ? 'aktivní' : 'specifikace' };
      });
    }
    if (sec === 'specialists') {
      return d.SP.map((x) => ({ id: x.id, name: x.name, sub: x.id + ' · v' + x.version, desc: x.desc, icon: I.users, tone: 'violet', groups: [x.type], group: x.type === 'domain' ? 'Doménoví' : 'Pomocní', catLabel: x.domain, meta: this.toolsWord(x.tools.length), tag: 'zapnutý', tagCls: 'ok', state: 'zapnutý' }));
    }
    if (sec === 'expertises') {
      return d.EX.map((x) => ({ id: x.id, name: x.name, sub: x.domain, desc: x.desc, icon: d.CATS[x.cat][1], tone: 'cyan', groups: [x.cat], group: d.CATS[x.cat][0], catLabel: d.CATS[x.cat][0], meta: 'teplota ' + x.temp, tag: 'vestavěná', state: 'vestavěná' }));
    }
    if (sec === 'workers') {
      return d.WK.map((a) => {
        const paused = !!s.paused[a.id];
        return { id: a.id, name: a.name, sub: a.id, desc: a.desc, icon: I.bot, tone: 'mint', groups: [a.kind].concat(paused ? ['paused'] : []), group: a.kind === 'cron' ? 'Plánovaní' : 'S intervalem', catLabel: a.when, meta: paused ? 'pozastavený' : a.when, metaColor: paused ? 'var(--warn)' : '', tag: paused ? 'pozastavený' : 'zapnutý', tagCls: paused ? '' : 'ok', state: paused ? 'pozastavený' : 'zapnutý' };
      });
    }
    if (sec === 'market') {
      const TL = { skill: ['Skilly', I.zap, 'skill'], expertise: ['Expertýzy', I.cap, 'expertýza'], specialist: ['Specialisté', I.users, 'specialista'] };
      return d.MK.map((m) => {
        const inst = s.installed[m.id] !== undefined ? s.installed[m.id] : m.inst;
        return { id: m.id, name: m.name, sub: m.id + ' · v' + m.version, desc: m.desc, icon: TL[m.type][1], tone: 'blue', groups: [m.type].concat(inst ? ['installed'] : []), group: TL[m.type][0], catLabel: TL[m.type][2], meta: inst ? 'nainstalováno' : 'k instalaci', metaColor: inst ? 'var(--ok)' : '', tag: inst ? 'nainstalováno' : 'k instalaci', tagCls: inst ? 'ok' : '', state: inst ? 'nainstalováno' : 'k instalaci' };
      });
    }
    if (sec === 'settings') {
      return d.SET.map((x) => ({ id: x.id, name: x.name, sub: 'nastavení', desc: x.desc, icon: x.icon, tone: x.tone, icls: 'always', groups: [], group: 'Kategorie', catLabel: 'nastavení', meta: '', tag: '', state: '' }));
    }
    return [];
  }

  chipDefs(sec) {
    return {
      chats: [['vse', 'Vše'], ['open', 'Otevřené'], ['project', 'S projektem'], ['specialist', 'Se specialistou'], ['free', 'Bez projektu']],
      projects: [['vse', 'Vše'], ['active', 'Aktivní'], ['spec', 'Specifikace']],
      specialists: [['vse', 'Vše'], ['domain', 'Doménoví'], ['utility', 'Pomocní']],
      expertises: [['vse', 'Vše'], ['creative', 'Tvůrčí'], ['analytical', 'Analytičtí'], ['normative', 'Normativní'], ['technical', 'Techničtí'], ['domain', 'Doménoví']],
      workers: [['vse', 'Vše'], ['cron', 'Plánovaní'], ['interval', 'S intervalem'], ['paused', 'Pozastavení']],
      market: [['vse', 'Vše'], ['skill', 'Skilly'], ['expertise', 'Expertýzy'], ['specialist', 'Specialisté'], ['installed', 'Nainstalované']],
      media: [['vse', 'Vše']],
      settings: [['vse', 'Vše']]
    }[sec] || [['vse', 'Vše']];
  }

  filtered(sec, s) {
    const all = this.entities(sec, s).map((e) => Object.assign({ dot: '', tagCls: '', metaColor: '', icls: '', num: 0 }, e));
    const q = (s.q || '').trim().toLowerCase();
    const items = all.filter((e) => (s.chip === 'vse' || e.groups.indexOf(s.chip) >= 0) && (!q || (e.name + ' ' + e.sub + ' ' + e.desc).toLowerCase().indexOf(q) >= 0));
    const chips = this.chipDefs(sec).map((c) => ({ label: c[1], n: c[0] === 'vse' ? all.length : all.filter((e) => e.groups.indexOf(c[0]) >= 0).length, cls: s.chip === c[0] ? 'on' : '', go: () => this.setState({ chip: c[0] }) }));
    return { all, items, chips };
  }

  navVM(s, lay, fsid) {
    const d = this.data(), I = d.I;
    const nWait = s.tabs.filter((x) => this.sstate(x, s) === 'wait').length;
    const rows = this.sections().filter((x) => x.id !== 'settings').map((x) => {
      let kids = [];
      let badge = '', badgeCls = '', more = '';
      if (x.id === 'chats') {
        badge = String(s.tabs.length); badgeCls = nWait ? 'warn' : '';
        kids.push({ isHead: true, t: 'Otevřené relace' });
        s.tabs.forEach((sid, i) => {
          const b = this.sess(sid, s);
          const st = this.sstate(sid, s);
          const vis = lay.indexOf(sid) >= 0;
          kids.push({ isItem: true, t: b.short, m: this.stLabel(st), mc: this.stColor(st), hasNum: true, num: i + 1, numCls: s.mode === 'sessions' && sid === fsid ? 'focus' : vis ? 'vis' : '', hasDot: true, dot: st, hasIcon: false, icon: '', cls: s.mode === 'sessions' && sid === fsid ? 'on' : '', go: this.run((s2) => this.pFocusSession(s2, sid)), ctx: this.showCtx('chats', sid) });
        });
        kids.push({ isHead: true, t: 'Nedávné' });
        d.H.filter((h) => s.tabs.indexOf(h.id) < 0).slice(0, 3).forEach((h) => {
          kids.push({ isItem: true, t: h.t, m: h.when, mc: 'var(--faint)', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '', hasIcon: true, icon: I.chat, cls: '', go: this.run((s2) => this.pOpenSession(s2, h.id)), ctx: this.showCtx('chats', h.id) });
        });
        more = 'Všechny konverzace (' + (s.tabs.length + d.H.filter((h) => s.tabs.indexOf(h.id) < 0).length) + ')';
      } else if (x.id === 'projects') {
        badge = String(d.P.length);
        d.P.filter((p) => p.status === 'active').slice(0, 4).forEach((p) => {
          const sel = s.mode === 'section' && s.section === 'projects' && s.detail.projects === p.id;
          kids.push({ isItem: true, t: p.name, m: p.last, mc: 'var(--faint)', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '', hasIcon: true, icon: I.folder, cls: sel ? 'on' : '', go: this.run((s2) => this.pSelect(s2, 'projects', p.id)), ctx: this.showCtx('projects', p.id) });
        });
        more = 'Všechny projekty (' + d.P.length + ')';
      } else if (x.id === 'specialists') {
        badge = String(d.SP.length);
        d.SP.slice(0, 3).forEach((p) => {
          const sel = s.mode === 'section' && s.section === 'specialists' && s.detail.specialists === p.id;
          kids.push({ isItem: true, t: p.name, m: this.toolsWord(p.tools.length), mc: 'var(--faint)', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '', hasIcon: true, icon: I.users, cls: sel ? 'on' : '', go: this.run((s2) => this.pSelect(s2, 'specialists', p.id)), ctx: this.showCtx('specialists', p.id) });
        });
        more = 'Všichni specialisté (' + d.SP.length + ')';
      } else if (x.id === 'expertises') {
        badge = String(d.EX.length);
        kids.push({ isHead: true, t: 'Oblíbené' });
        ['developer', 'analyst', 'ai_expert'].forEach((id) => {
          const p = d.EX.find((e) => e.id === id);
          const sel = s.mode === 'section' && s.section === 'expertises' && s.detail.expertises === id;
          kids.push({ isItem: true, t: p.name, m: 'teplota ' + p.temp, mc: 'var(--faint)', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '', hasIcon: true, icon: d.CATS[p.cat][1], cls: sel ? 'on' : '', go: this.run((s2) => this.pSelect(s2, 'expertises', id)), ctx: this.showCtx('expertises', id) });
        });
        more = 'Všechny expertýzy (' + d.EX.length + ')';
      } else if (x.id === 'workers') {
        badge = String(d.WK.length);
      } else if (x.id === 'market') {
        badge = String(d.MK.length);
      }
      const hasKids = kids.length > 0;
      const open = hasKids && !!s.navExp[x.id];
      const on = s.mode === 'section' && s.section === x.id;
      return {
        label: x.label, short: x.short, icon: x.icon, tone: x.tone, cls: on ? 'on' : '',
        go: this.run((s2) => this.pGo(s2, x.id)),
        hasBadge: !!badge, badge, badgeCls, hasAlert: x.id === 'chats' && nWait > 0,
        hasKids, open, kids: kids.map((k) => Object.assign({ isHead: false, isItem: false, t: '', m: '', mc: '', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '', hasIcon: false, icon: '', cls: '', go: () => {}, ctx: () => {} }, k)),
        toggle: () => this.setState({ navExp: this.merge(this.st(), 'navExp', { [x.id]: !this.st().navExp[x.id] }) }),
        expLabel: open ? 'Sbalit' : 'Rozbalit', chev: open ? I.down : I.right,
        hasMore: open && !!more, moreLabel: more
      };
    });
    return rows;
  }

  catalogVM(s) {
    const d = this.data(), I = d.I;
    const sec = s.section;
    const SC = this.sec(sec);
    const f = this.filtered(sec, s);
    const size = Math.min(3, Math.max(1, Number(s.size) || 2));
    const selId = s.detail[sec];
    const items = f.items.map((e) => ({
      name: e.name, sub: e.sub, desc: e.desc, icon: e.icon, tone: e.tone || 'none', icls: e.icls || '', tag: e.tag, hasTag: !!e.tag, tagCls: e.tagCls || '',
      hasDot: !!e.dot, dot: e.dot, hasNum: !!e.num, num: e.num, numCls: '', catLabel: e.catLabel, meta: e.meta, mc: e.metaColor || 'var(--faint)', state: e.state || '',
      cls: selId === e.id ? 'on' : '',
      go: this.run((s2) => this.pSelect(s2, sec, e.id)),
      dbl: this.run((s2) => (sec === 'chats' ? this.pOpenSession(s2, e.id) : this.pSelect(s2, sec, e.id))),
      ctx: this.showCtx(sec, e.id)
    }));
    const sums = {
      chats: s.tabs.length + ' otevřených relací · 46 konverzací v databázi · dvojklik otevře relaci',
      projects: d.P.length + ' projektů · ' + d.P.filter((p) => p.status === 'active').length + ' aktivních',
      specialists: d.SP.length + ' nainstalovaných specialistů',
      expertises: '14 vestavěných · 0 vlastních · výchozí pro nové konverzace: Vývojář',
      workers: '6 workerů · 3 plánovaní, 3 s intervalem · zatím žádný běh',
      market: 'Zobrazeno ' + d.MK.length + ' z 39 balíčků · zdroj C3studio/C3-agent',
      media: 'Obrázky a video generované přes ComfyUI',
      settings: 'Všechna nastavení IntentSmithu na jednom místě'
    };
    const empty = sec === 'media'
      ? { t: 'Zatím žádné generování', x: 'Obrázky a video z ComfyUI se tu ukážou jako dlaždice nebo seznam, stejně jako všechno ostatní.', i: I.sparkle }
      : { t: 'Nic nenalezeno', x: 'Zkus jiný filtr nebo hledaný výraz.', i: I.search };
    return {
      title: SC.label, icon: SC.icon, tone: SC.tone, summary: sums[sec] || '', catalogError: '', hasCatalogError: false, primary: SC.newLabel, hasPrimary: !!SC.newLabel,
      onPrimary: this.run((s2) => (sec === 'chats' ? this.pNewSession(s2, {})
        : sec === 'media' ? this.pSelect(s2, 'media', '__new__')
          : sec === 'projects' ? this.pSelect(s2, 'projects', '__new__')
            : sec === 'specialists' ? this.pSelect(s2, 'specialists', '__new__')
              : sec === 'workers' ? this.pSelect(s2, 'workers', '__new__')
                : sec === 'expertises' ? this.pSelect(s2, 'expertises', '__new__') : null)),
      hasChips: f.chips.length > 1, chips: f.chips, items,
      isTiles: s.view === 'dlazdice' && items.length > 0, isList: s.view === 'seznam' && items.length > 0, isEmpty: items.length === 0,
      emptyTitle: empty.t, emptyText: empty.x, emptyIcon: empty.i,
      minW: [190, 250, 330][size - 1]
    };
  }

  convRow(s, cid) {
    const d = this.data(), I = d.I;
    if (d.S[cid] || s.sessions[cid]) {
      const bb = this.sess(cid, s);
      const open = s.tabs.indexOf(cid) >= 0;
      const st = this.sstate(cid, s);
      return { t: bb.title, s: open ? 'relace ' + (s.tabs.indexOf(cid) + 1) : 'uložená', m: this.stLabel(st), mc: this.stColor(st), dot: st, go: (s2) => (open ? this.pFocusSession(s2, cid) : this.pOpenSession(s2, cid)) };
    }
    const h = d.H.find((x) => x.id === cid);
    return { t: h ? h.t : cid, s: 'uložená konverzace', m: h ? h.when : '', icon: I.chat, go: (s2) => this.pOpenSession(s2, cid) };
  }

  detailSpec(sec, id, s) {
    const d = this.data(), I = d.I;
    const ok = 'var(--ok)';
    if (sec === 'projects' && id === '__new__') return {
      icon: I.folder, tone: 'rose', title: 'Nový projekt', type: 'Projektový průvodce', idText: 'projekty/novy',
      status: '', stCls: '', secondary: [], tabs: [['pruvodce', 'Průvodce']],
      blocks: { pruvodce: [{ kind: 'projectWizard' }] },
      desc: 'Založ nový projekt nebo zaregistruj existující složku.', props: [], related: []
    };
    if (sec === 'specialists' && id === '__new__') return {
      icon: I.users, tone: 'violet', title: 'Nový specialista', type: 'Průvodce specialistou', idText: 'specialiste/novy',
      status: '', stCls: '', secondary: [], tabs: [['pruvodce', 'Průvodce']],
      blocks: { pruvodce: [{ kind: 'specialistWizard' }] },
      desc: 'Vytvoří balíček specialisty s manifestem a základním modulem.', props: [], related: []
    };
    if (sec === 'workers' && id === '__new__') return {
      icon: I.bot, tone: 'mint', title: 'Nový worker', type: 'Instalace rozšíření M3', idText: 'workeri/novy',
      status: '', stCls: '', secondary: [], tabs: [['pruvodce', 'Průvodce']],
      blocks: { pruvodce: [{ kind: 'workerWizard' }] },
      desc: 'Vyber projekt a vytvoř instanci dostupného deklarativního rozšíření.', props: [], related: []
    };
    if (sec === 'expertises' && (id === '__new__' || id === '__edit__')) return {
      icon: I.cap, tone: 'cyan', title: id === '__edit__' ? 'Upravit expertýzu' : 'Nová expertýza',
      type: 'Průvodce expertýzou', idText: id === '__edit__' ? 'expertyzy/uprava' : 'expertyzy/nova',
      status: '', stCls: '', secondary: [], tabs: [['pruvodce', 'Průvodce']],
      blocks: { pruvodce: [{ kind: 'expertiseWizard' }] },
      desc: 'Nastav profil, ladění a pravidla expertýzy; před uložením zkontroluj náhled.', props: [], related: []
    };
    if (sec === 'media' && id === '__new__') return {
      icon: I.image, tone: 'violet', title: 'Nové generování', type: 'Multimédia', idText: 'ComfyUI',
      status: '', stCls: '', secondary: [], tabs: [['formular', 'Zadání']],
      blocks: { formular: [{ kind: 'mediaForm' }] },
      desc: 'Zadej prompt, vyber model a parametry. Generování se zařadí do fronty backendu.',
      props: [], related: []
    };
    if (sec === 'chats') {
      const open = s.tabs.indexOf(id) >= 0;
      if (open) {
        const b = this.sess(id, s);
        const st = this.sstate(id, s);
        const p = b.project ? this.proj(b.project) : null;
        const sp = b.specialist ? this.spec(b.specialist) : null;
        const all = b.msgs.concat(s.extra[id] || []);
        const first = all.find((m) => m.k === 'user');
        const lastA = all.slice().reverse().find((m) => m.k === 'agent');
        const lastText = lastA ? (lastA.running && !s.stopped[lastA.rid] ? lastA.runText : (lastA.paras && lastA.paras.length ? lastA.paras[lastA.paras.length - 1] : '')) : '';
        const props = [['Relace', String(s.tabs.indexOf(id) + 1)], ['Druh', b.kind === 'project' ? 'projektová' : b.kind === 'specialist' ? 'se specialistou' : 'volná']];
        if (p) props.push(['Projekt', p.name]);
        if (sp) props.push(['Specialista', sp.name]);
        props.push(['Expertýza', s.experts[id] || b.expert], ['Model', b.model, true], ['Režim úprav', (s.modes[id] || b.mode) === 'auto' ? 'Auto' : 'Kontrola'], ['Kontext', this.ctxOf(id, s) + ' %']);
        const blocks = [];
        if (first) blocks.push({ kind: 'text', title: 'Zadání', items: [first.text] });
        if (lastText) blocks.push({ kind: 'text', title: 'Poslední odpověď', items: [lastText] });
        const related = [];
        if (p) related.push({ t: p.name, s: 'projekt', icon: I.folder, go: (s2) => this.pSelect(s2, 'projects', p.id) });
        if (sp) related.push({ t: sp.name, s: 'specialista', icon: I.users, go: (s2) => this.pSelect(s2, 'specialists', sp.id) });
        return { icon: this.kindIcon(b.kind), tone: 'amber', title: b.title, type: 'Konverzace', idText: 'relace ' + (s.tabs.indexOf(id) + 1), status: this.stLabel(st), stCls: st === 'wait' ? 'warn' : st === 'ok' ? 'ok' : st === 'run' ? 'acc' : 'idle',
          primary: { label: 'Přepnout na relaci', go: (s2) => this.pFocusSession(s2, id) },
          secondary: [{ label: 'Otevřít vedle', icon: I.columns, go: (s2) => this.pOpenBeside(s2, id) }],
          tabs: [['prehled', 'Přehled']], blocks: { prehled: blocks.length ? blocks : [{ kind: 'empty', title: 'Zprávy', text: 'Relace zatím nemá žádnou zprávu.' }] }, desc: '', props, related };
      }
      const h = d.H.find((x) => x.id === id);
      if (!h) return null;
      const p = h.project ? this.proj(h.project) : null;
      return { icon: p ? I.folder : I.chat, tone: 'amber', title: h.t, type: 'Konverzace', idText: 'uložená · ' + h.when, status: 'uložená', stCls: 'idle',
        primary: { label: 'Otevřít jako relaci', go: (s2) => this.pOpenSession(s2, id) },
        secondary: [{ label: 'Otevřít vedle', icon: I.columns, go: (s2) => this.pOpenBeside(s2, id) }],
        tabs: [['prehled', 'Přehled']], blocks: { prehled: [{ kind: 'empty', title: 'Zprávy', text: 'Obsah se načte po otevření jako relace.' }] }, desc: '',
        props: [['Uloženo', h.day === 'Starší' ? h.when : h.day + ' ' + h.when], ['Projekt', p ? p.name : 'bez projektu']],
        related: p ? [{ t: p.name, s: 'projekt', icon: I.folder, go: (s2) => this.pSelect(s2, 'projects', p.id) }] : [] };
    }
    if (sec === 'projects') {
      const p = this.proj(id);
      if (!p) return null;
      const convRows = p.convs.map((c) => this.convRow(s, c));
      const recent = p.recent.map((f) => ({ t: f[0], m: '+' + f[1] + (f[2] ? ' −' + f[2] : ''), mc: ok, icon: I.file, mono: true }));
      const tree = (p.tree || []).map((t) => ({ t: ' '.repeat(t[0] * 4) + t[1], icon: t[2] ? I.folder : I.file, m: t[3] || '', mc: t[3] === 'A' ? ok : 'var(--warn)', mono: true }));
      const prehled = [{ kind: 'rows', title: 'Relace a konverzace', rows: convRows, empty: 'Projekt zatím nemá žádnou konverzaci. Začni tlačítkem Nová relace v projektu.' }, { kind: 'rows', title: 'Nedávné změny', rows: recent, empty: 'Zatím žádné změny souborů.' }];
      if (p.memory && p.memory.length) prehled.push({ kind: 'list', title: 'Paměť projektu', items: p.memory });
      const props = [['Cesta', p.path, true], ['Stav', p.status === 'active' ? 'aktivní' : 'specifikace'], ['Poslední aktivita', p.last], ['Konverzací', String(p.convs.length)]];
      if (p.stack) props.push(['Technologie', p.stack]);
      if (p.test) props.push(['Příkaz testů', p.test, true]);
      const g = this.gitVM(s, p.id);
      const POLK = [['init', 'Init repozitáře'], ['commit', 'Commit'], ['branch', 'Větve'], ['fetch', 'Fetch (síť)'], ['pull', 'Pull (--ff-only)'], ['push', 'Push (nikdy --force)']];
      const pol = g ? g.policy : { init: 'ask', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask' };
      const scmBlocks = [
        g && g.repo ? { kind: 'rows', title: 'Repozitář', rows: [{ t: 'Větev ' + g.branch, m: g.upstream ? '↓' + g.behind + ' ↑' + g.ahead : 'bez upstreamu', icon: I.branch, mono: true }, { t: g.remote ? g.remote + ' · ' + g.host : 'bez vzdáleného repozitáře', m: g.remote ? 'povolený hostitel' : '', mc: ok, icon: I.globe }] } : { kind: 'empty', title: 'Repozitář', text: g ? 'Složka zatím nemá repozitář git. Inicializuješ ho v pravém panelu relace › Správa zdrojů.' : 'Stav repozitáře se načte z GET /api/scm/status.' },
        { kind: 'scmPolicy', title: 'Politika gitu' },
        { kind: 'text', title: 'Jak politika funguje', items: ['Každá operace se zápisem nebo sítí nejdřív ukáže plán a provede se až po potvrzení. Síť jen na povolené hostitele, hooky jsou vypnuté. Politiku mění PUT /api/scm/policy, ne obecné nastavení.'] }
      ];
      const related = [{ t: 'Vývojář', s: 'expertýza', icon: I.cap, go: (s2) => this.pSelect(s2, 'expertises', 'developer') }];
      if (p.code) related.push({ t: 'Code Reviewer', s: 'specialista', icon: I.users, go: (s2) => this.pSelect(s2, 'specialists', 'code-reviewer') });
      return {
        icon: I.folder, tone: 'rose', title: p.name, type: 'Projekt', idText: p.path, status: p.status === 'active' ? 'aktivní' : 'specifikace', stCls: p.status === 'active' ? 'ok' : 'idle',
        primary: { label: 'Nová relace v projektu', go: (s2) => this.pNewSession(s2, { project: p.id }) },
        secondary: [{ label: 'Otevřít složku', icon: I.ext }, { label: 'Upravit', icon: I.pen }],
        tabs: [['prehled', 'Přehled'], ['konverzace', 'Konverzace', p.convs.length], ['soubory', 'Soubory'], ['scm', 'Správa zdrojů']],
        blocks: {
          scm: scmBlocks,
          prehled,
          konverzace: [{ kind: 'rows', title: 'Konverzace projektu', rows: convRows, empty: 'Projekt zatím nemá žádnou konverzaci.' }],
          soubory: [tree.length ? { kind: 'rows', title: 'Soubory', rows: tree } : { kind: 'empty', title: 'Soubory', text: 'Strom souborů se načte po otevření projektu v relaci.' }]
        },
        desc: p.desc, props, related
      };
    }
    if (sec === 'specialists') {
      const x = this.spec(id);
      if (!x) return null;
      const prehled = [];
      if (x.caps.length) prehled.push({ kind: 'chips', title: 'Schopnosti', chips: x.caps });
      if (x.exps.length) prehled.push({ kind: 'chips', title: 'Expertýzy', chips: x.exps });
      const convs = s.tabs.filter((sid) => this.sess(sid, s).specialist === x.id);
      prehled.push({ kind: 'rows', title: 'Konverzace se specialistou', rows: convs.map((c) => this.convRow(s, c)), empty: 'Zatím žádná. Začni tlačítkem Nová konverzace se specialistou.' });
      const props = [['Verze', x.version], ['Doména', x.domain, true], ['Typ', x.type === 'domain' ? 'doménový' : 'pomocný'], ['Autor', 'c3-core']];
      if (x.engine) props.push(['Engine', x.engine, true]);
      props.push(['Výchozí stav', 'zapnutý']);
      return {
        icon: I.users, tone: 'violet', title: x.name, type: 'Specialista', idText: x.id, status: 'zapnutý', stCls: 'ok',
        primary: { label: 'Nová konverzace se specialistou', go: (s2) => this.pNewSession(s2, { specialist: x.id }) },
        secondary: [{ label: 'Vypnout', icon: I.pause }],
        tabs: [['prehled', 'Přehled'], ['nastroje', 'Nástroje', x.tools.length], ['nastaveni', 'Nastavení']],
        blocks: {
          prehled,
          nastroje: [{ kind: 'rows', title: 'Nástroje', rows: x.tools.map((t) => ({ t: t[0], s: t[1], icon: I.tool })) }],
          nastaveni: [{ kind: 'empty', title: 'Nastavení', text: 'Specialista nemá žádná vlastní nastavení.' }]
        },
        desc: x.desc, props,
        related: x.market ? [{ t: x.name, s: 'balíček v obchodě', icon: I.bag, go: (s2) => this.pSelect(s2, 'market', x.market) }] : []
      };
    }
    if (sec === 'expertises') {
      const x = d.EX.find((q) => q.id === id);
      if (!x) return null;
      const TONE = { concise: 'stručný', professional: 'profesionální', creative: 'tvůrčí', friendly: 'přátelský' };
      const PLAN = { LIGHT: 'lehké', DEEP: 'hluboké', NONE: 'žádné' };
      const REV = { SELF: 'vlastní kontrola', ITERATIVE: 'iterativní', NONE: 'bez kontroly' };
      const using = s.tabs.filter((sid) => (s.experts[sid] || this.sess(sid, s).expert) === x.name);
      return {
        icon: d.CATS[x.cat][1], tone: 'cyan', title: x.name, type: 'Expertýza', idText: x.domain, status: 'vestavěná', stCls: 'idle',
        primary: { label: 'Použít v aktivní relaci', go: (s2) => { const f = this.focusSid(s2); if (!f) return null; return this.chain(s2, { experts: this.merge(s2, 'experts', { [f]: x.name }) }, (s3) => this.pFocusSession(s3, f)); } },
        secondary: [{ label: 'Duplikovat', icon: I.copy }],
        tabs: [['prehled', 'Přehled'], ['pravidla', 'Pravidla', x.rules.length]],
        blocks: {
          prehled: [{ kind: 'bars', title: 'Profil', bars: [['Uvažování', x.caps[0]], ['Kreativita', x.caps[1]], ['Determinismus', x.caps[2]], ['Tolerance rizika', x.caps[3]], ['Rozvláčnost', x.caps[4]]] }, { kind: 'rows', title: 'Relace, které ji používají', rows: using.map((sid) => this.convRow(s, sid)), empty: 'Žádná otevřená relace tuhle expertýzu nepoužívá.' }],
          pravidla: [{ kind: 'list', title: 'Pravidla domény', items: x.rules }]
        },
        desc: x.desc,
        props: [['Kategorie', d.CATS[x.cat][0]], ['Doména', x.domain, true], ['Teplota', x.temp], ['Tón', TONE[x.tone] || x.tone], ['Plánování', PLAN[x.plan]], ['Kontrola výstupu', REV[x.review]], ['Typ', 'vestavěná']],
        related: x.id === 'developer' ? [{ t: 'Code Reviewer', s: 'specialista', icon: I.users, go: (s2) => this.pSelect(s2, 'specialists', 'code-reviewer') }] : []
      };
    }
    if (sec === 'workers') {
      const a = d.WK.find((q) => q.id === id);
      if (!a) return null;
      const COND = { exists: 'data jsou k dispozici', new_items: 'objeví se nové položky', changed: 'obsah se změní', compare: 'hodnota překročí práh' };
      const CH = { push: 'push oznámení', telegram: 'Telegram', in_app: 'oznámení v aplikaci', email: 'e-mail' };
      const paused = !!s.paused[a.id];
      const ran = s.ran[a.id];
      return {
        icon: I.bot, tone: 'mint', title: a.name, type: 'Worker', idText: a.id, status: paused ? 'pozastavený' : 'zapnutý', stCls: paused ? 'warn' : 'ok',
        primary: { label: 'Spustit teď', go: (s2) => ({ ran: this.merge(s2, 'ran', { [a.id]: true }), dtab: this.merge(s2, 'dtab', { ['workers:' + a.id]: 'behy' }) }) },
        secondary: [{ label: paused ? 'Obnovit' : 'Pozastavit', icon: paused ? I.play : I.pause, go: (s2) => ({ paused: this.merge(s2, 'paused', { [a.id]: !paused }) }) }, { label: 'Upravit definici', icon: I.pen }],
        tabs: [['prehled', 'Přehled'], ['zdroje', 'Zdroje', a.sources.length], ['behy', 'Běhy', ran ? 1 : 0]],
        blocks: {
          prehled: [
            { kind: 'rows', title: 'Plán', rows: [{ t: a.when, s: a.kind === 'cron' ? 'cron' : 'interval', m: a.expr, icon: I.clock }] },
            { kind: 'rows', title: 'Spouštěče a akce', rows: a.conds.map((c) => ({ t: 'Když ' + COND[c], s: 'pak ' + CH[a.channel], icon: I.zap })) }
          ],
          zdroje: [{ kind: 'rows', title: 'Zdroje dat', rows: a.sources.map((x) => ({ t: x[1], s: x[0].toUpperCase(), icon: x[0] === 'rss' ? I.rss : I.globe, mono: true })) }],
          behy: [ran ? { kind: 'table', title: 'Poslední běhy', cols: ['Začátek', 'Spuštěno', 'Stav'], grid: '80px 90px minmax(0, 1fr)', trs: [['teď', 'ručně', ['běží', 'var(--acct)']]] } : { kind: 'empty', title: 'Poslední běhy', text: 'Worker zatím neběžel. Tlačítkem Spustit teď ho spustíš ručně; běhy se pak ukážou tady.' }]
        },
        desc: a.desc,
        props: [['Plán', a.when], ['Výraz', a.expr, true], ['Zdrojů', String(a.sources.length)], ['Oznámení', CH[a.channel]], ['Stav', paused ? 'pozastavený' : 'zapnutý']],
        related: [{ t: 'Oznámení', s: 'nastavení', icon: I.bell, go: (s2) => this.pSelect(s2, 'settings', 'oznameni') }]
      };
    }
    if (sec === 'market') {
      const m = d.MK.find((q) => q.id === id);
      if (!m) return null;
      const inst = s.installed[m.id] !== undefined ? s.installed[m.id] : m.inst;
      const TL = { skill: ['Skill', I.zap, 'skills/' + m.id + '.json'], expertise: ['Expertýza', I.cap, 'marketplace/packages/expertises/' + m.id + '.json'], specialist: ['Specialista', I.users, 'specialists/' + m.id + '/specialist.json'] };
      const related = m.type === 'specialist' ? [{ t: m.name, s: 'nainstalovaný specialista', icon: I.users, go: (s2) => this.pSelect(s2, 'specialists', m.id) }] : [];
      return {
        icon: TL[m.type][1], tone: 'blue', title: m.name, type: 'Balíček · ' + TL[m.type][0], idText: m.id, status: inst ? 'nainstalováno' : 'k instalaci', stCls: inst ? 'ok' : 'idle',
        primary: { label: inst ? 'Odinstalovat' : 'Nainstalovat', go: (s2) => ({ installed: this.merge(s2, 'installed', { [m.id]: !inst }) }) },
        secondary: [{ label: 'Zdroj', icon: I.ext }],
        tabs: [['prehled', 'Přehled'], ['verze', 'Verze']],
        blocks: {
          prehled: [{ kind: 'rows', title: 'Obsah balíčku', rows: [{ t: TL[m.type][2], s: TL[m.type][0].toLowerCase(), icon: I.file, mono: true }] }],
          verze: [{ kind: 'table', title: 'Verze', cols: ['Verze', 'Stav', 'Zdroj'], grid: '70px 110px minmax(0, 1fr)', trs: [[m.version, inst ? ['nainstalovaná', 'var(--ok)'] : 'dostupná', 'C3studio/C3-agent']] }]
        },
        desc: m.desc,
        props: [['Typ', TL[m.type][0]], ['Verze', m.version], ['Stav', inst ? 'nainstalováno' : 'k instalaci'], ['Zdroj', 'C3studio/C3-agent']],
        related
      };
    }
    if (sec === 'settings') {
      const x = d.SET.find((q) => q.id === id);
      if (!x) return null;
      const base = { icon: x.icon, tone: x.tone, icls: 'always', title: x.name, type: 'Nastavení', idText: 'nastaveni/' + x.id, status: '', stCls: '', secondary: [], tabs: x.tabs, desc: x.desc, related: [] };
      const r = (t, m, sub) => ({ t, m, s: sub || '', mc: 'var(--dim)' });
      if (x.id === 'vzhled') {
        const st = this.styleList().find((q) => q.id === s.style) || this.styleList()[0];
        return Object.assign(base, {
          desc: '', primary: { label: 'Obnovit výchozí', go: () => this.appearanceDefaults() },
          blocks: { obecne: [{ kind: 'apObecne' }], pismo: [{ kind: 'apPismo' }], barvy: [{ kind: 'apBarvy' }], rozvrzeni: [{ kind: 'apRozvrzeni' }], css: [{ kind: 'apCss' }] },
          props: [['Styl', st.name], ['Téma', { dark: 'tmavé', light: 'světlé', system: 'podle systému' }[s.tmode]], ['Písmo', s.fs + ' px'], ['Hustota', { komfortni: 'komfortní', kompaktni: 'kompaktní', minimalni: 'minimální' }[s.density]]],
          hideProps: true
        });
      }
      if (x.id === 'system') return Object.assign(base, { blocks: { prostredi: [{ kind: 'development' }], spousteni: [{ kind: 'empty', text: 'Spouštění zatím není připojené.' }], diagnostika: [{ kind: 'empty', text: 'Diagnostika zatím není připojená.' }], limity: [{ kind: 'empty', text: 'Limity zatím nejsou připojené.' }] }, props: [] });
      if (x.id === 'modely') return Object.assign(base, { blocks: { prehled: [{ kind: 'modelWorkspace' }] }, props: [['Model CHAT', 'qwen3.5:27b', true], ['Model FAST', 'nenastaven'], ['Server', 'Ollama 0.34'], ['Adresa', '127.0.0.1:11434', true]] });
      if (x.id === 'oznameni') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Kanály', rows: [r('Systémová oznámení', 'zapnuto'), r('E-mail (SMTP)', 'nenastaveno'), r('ntfy.sh', 'nenastaveno'), r('Telegram', 'v M5 nepodporováno'), r('Webhook (HMAC)', 'v M5 nepodporováno')] }] }, props: [['Tichý režim', 'vypnutý'], ['Tichý režim od–do', '22:00–07:00'], ['Chyby v tichém režimu', 'projdou']] });
      if (x.id === 'uloziste') return Object.assign(base, { primary: { label: 'Vacuum DB', go: () => ({}) }, blocks: { prehled: [{ kind: 'rows', title: 'Data', rows: [r('Konverzace', '46'), r('Projekty', '6'), r('Workeři', '6'), r('Generování médií', '0')] }] }, props: [['Databáze', 'data/c3.db', true], ['Velikost', '134 MiB'], ['Retence logů', '30 dní']] });
      if (x.id === 'vystup') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Výstup', rows: [r('Code blocks ve výstupu', 'zapnuto'), r('Zvýrazňování syntaxe', 'zapnuto'), r('Markdown', 'zapnuto')] }] }, props: [['Úroveň logu', 'info'], ['Retence logů', '30 dní'], ['Max. velikost souboru', '1 MiB'], ['Limit požadavků', '120 / min']] });
      if (x.id === 'about') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Stav', rows: [r('Backend', 'připojeno', '136.1.0'), r('Protokol', 'WebSocket v1'), r('Ollama', 'běží', '127.0.0.1:11434')] }] }, props: [['Aplikace', 'IntentSmith 2.0 (návrh)'], ['Backend', '136.1.0'], ['Rozhraní', 'ws :3335', true]] });
      if (x.id === 'zabezpeceni') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Ochrana', rows: [r('Schvalování změn souborů', 'Kontrola'), r('Auditní log', 'zapnutý'), r('Přístupové tokeny', '1 aktivní')] }], pristup: [{ kind: 'pairing' }] }, props: [['Výchozí režim úprav', 'Kontrola']] });
      if (x.id === 'pamet') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Dlouhodobá paměť', rows: [r('Poločas zapomínání', '~69 dní'), r('Vkládání do kontextu', 'podle relevance'), r('Paměť projektů', 'zapnutá')] }] }, props: [['Stav', 'zapnutá']] });
      if (x.id === 'ucet') return Object.assign(base, { blocks: { prehled: [{ kind: 'rows', title: 'Chování', rows: [r('Jazyk rozhraní', 'čeština'), r('Po spuštění obnovit relace', 'zapnuto'), r('Varovat při zavření s běžícím agentem', 'zapnuto')] }] }, props: [['Jazyk', 'čeština']] });
      return Object.assign(base, { blocks: { prehled: [{ kind: 'empty', title: x.name, text: 'Tato záložka se připojuje k backendu.' }] }, props: [] });
    }
    return null;
  }

  scmPolicyVM(s, pid) {
    const g = pid ? this.gitVM(s, pid) : null;
    const policy = g?.policy || { init: 'ask', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] };
    const labels = [['init', 'Inicializace'], ['commit', 'Commit'], ['branch', 'Větve'], ['fetch', 'Fetch'], ['pull', 'Pull (--ff-only)'], ['push', 'Push']];
    return { fields: labels.map(([key, label]) => ({ key, label, value: policy[key],
      options: (key === 'branch' || key === 'push' ? ['ask', 'disabled'] : ['ask', 'automatic', 'disabled'])
        .map(value => ({ value, label: this.polLabel(value) })), change: event => {
          if (!pid) return;
          const st = s.scm[pid] || {};
          this.setState({ scm: this.merge(this.st(), 'scm', { [pid]: { ...st, policyDraft: { ...policy, [key]: event.target.value } } }) });
        } })),
      remotes: (policy.remotes || []).map(item => ({ name: item.name, host: item.host, remove: () => {} })),
      remoteName: '', remoteHost: '', setRemoteName: () => {}, setRemoteHost: () => {}, addRemote: () => {},
      save: () => {}, hasError: false, error: '', disabled: !g };
  }

  developmentVM(s) {
    return { loading: false, hasError: false, error: '', os: 'Ukázkové prostředí', arch: 'x64', node: '24',
      tools: 'git, npm, python3', observation: 'Ukázková data prototypu.',
      projectMode: 'ask', sdkMode: 'ask', modes: [
        { value: 'ask', label: 'Vyžadovat potvrzení' }, { value: 'automatic', label: 'Automaticky' }, { value: 'disabled', label: 'Zakázáno' }
      ], policyReady: true, policyDisabled: false, prepareDisabled: false, setProjectMode: () => {}, setSdkMode: () => {}, savePolicy: () => {},
      projects: [], projectId: '', setProject: () => {}, kind: 'npm', setKind: () => {},
      version: '', setVersion: () => {}, isDotnet: false, prepare: () => {},
      hasPlan: false, planState: '', planTarget: '', planCommand: '', planLimitations: '',
      planSources: [], planEvents: [], canExecute: false, canCancel: false,
      execute: () => {}, cancel: () => {}, history: [], refresh: () => {}, chooseHistory: () => {} };
  }

  appearanceDefaults() {
    const D = this.defaults();
    const keys = ['style', 'tmode', 'fs', 'ff', 'ti', 'ai', 'bright', 'pa', 'ta', 'bd', 'sep', 'density', 'scale', 'col', 'cacc', 'caccHex', 'cbg', 'cbgHex', 'css'];
    const p = {};
    keys.forEach((k) => { p[k] = D[k]; });
    return p;
  }

  styleList() {
    return [
      { id: 'intentsmith', name: 'IntentSmith', desc: 'Výchozí brand – zlatá a antracit', light: true },
      { id: 'studio', name: 'Studio', desc: 'Fialová, modrá, mátová · barevné ikony', light: true },
      { id: 'clean', name: 'Clean', desc: 'Původní přizpůsobitelný – vlastní akcent a pozadí', light: true },
      { id: 'matrix', name: 'Matrix', desc: 'Neon terminal', pro: true },
      { id: 'japanese', name: 'Japanese', desc: 'Červená aurora', pro: true },
      { id: 'midnight', name: 'Midnight', desc: 'Vesmírné sklo', pro: true },
      { id: 'nocturne', name: 'Nocturne', desc: 'Rodina ShellSmith a SystemSmith', light: true }
    ];
  }

  themeMode(s) {
    const st = this.styleList().find((x) => x.id === s.style) || this.styleList()[0];
    if (st.pro) return 'dark';
    if (s.tmode === 'system') {
      try { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
    }
    return s.tmode === 'light' ? 'light' : 'dark';
  }

  themeClass(style, mode) {
    const st = this.styleList().find((x) => x.id === style) || this.styleList()[0];
    return st.pro ? 'th-' + st.id : 'th-' + st.id + '-' + mode;
  }

  hexRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [34, 197, 94];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  mixHex(a, b, t) {
    const x = this.hexRgb(a), y = this.hexRgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  dynCss(s, mode) {
    let css = '';
    if (s.style === 'clean' && s.cacc === 'custom') {
      const hx = s.caccHex, rgb = this.hexRgb(hx);
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      css += '.ide.cacc-custom{--accF:' + hx + ';--acct:' + (mode === 'light' ? this.mixHex(hx, '#000000', 0.3) : this.mixHex(hx, '#ffffff', 0.25)) + ';--accD:' + this.mixHex(hx, '#000000', 0.3) + ';--accR:' + rgb.join(' ') + ';--acc-fg:' + (lum > 0.55 ? '#17120a' : '#ffffff') + '}';
    }
    if (s.style === 'clean' && s.cbg === 'custom' && mode === 'dark') {
      const b = s.cbgHex;
      css += '.ide.cbg-custom{--s0:' + b + ';--s1:' + this.mixHex(b, '#ffffff', 0.04) + ';--s2:' + this.mixHex(b, '#ffffff', 0.08) + ';--s3:' + this.mixHex(b, '#ffffff', 0.13) + ';--s4:' + this.mixHex(b, '#ffffff', 0.18) + ';--s5:' + this.mixHex(b, '#ffffff', 0.24) + '}';
    }
    if (s.css) css += '\n' + s.css;
    return css;
  }

  blockVM(b) {
    let kind = b.kind;
    if (kind === 'rows' && (!b.rows || !b.rows.length)) kind = 'empty';
    const rows = (b.rows || []).map((r) => ({ t: r.t, s: r.s || '', hasS: !!r.s, m: r.m || '', mc: r.mc || 'var(--faint)', hasIcon: !!r.icon && !r.dot, icon: r.icon || '', hasDot: !!r.dot, dot: r.dot || '', tcls: r.mono ? 'mono' : '', go: r.go ? this.run(r.go) : () => {}, cls: r.go ? 'link' : '' }));
    const items = (b.items || []).map((t) => ({ t }));
    const chips = (b.chips || []).map((t) => ({ t }));
    const n = kind === 'rows' ? rows.length : kind === 'list' ? items.length : kind === 'chips' ? chips.length : 0;
    const ap = kind.indexOf('ap') === 0;
    return {
      title: b.title || '', hasTitle: !!b.title && !ap, n, hasN: n > 0,
      isRows: kind === 'rows', rows, isChips: kind === 'chips', chips, isList: kind === 'list', isText: kind === 'text', items,
      isBars: kind === 'bars', bars: (b.bars || []).map((x) => ({ label: x[0], v: x[1] })),
      isCode: kind === 'code', lines: (b.lines || []).map((t) => ({ t })),
      isTable: kind === 'table', cols: (b.cols || []).map((t) => ({ t })), grid: b.grid || '1fr',
      trs: (b.trs || []).map((r) => ({ cells: r.map((c) => (Array.isArray(c) ? { t: c[0], c: c[1] } : { t: c, c: 'inherit' })) })),
      isEmpty: kind === 'empty', empty: b.text || b.empty || '',
      isDevelopment: kind === 'development', isScmPolicy: kind === 'scmPolicy',
      isPairing: kind === 'pairing', pairing: this.pairingVM(),
      isSettingsImport: kind === 'settingsImport', settingsImport: this.settingsImportVM(),
      isFeedback: kind === 'feedback', feedback: this.feedbackVM(),
      isSecurity: kind === 'security', security: this.securityVM(this.st()),
      isExpertiseSelection: kind === 'expertiseSelection', expertiseSelection: this.expertiseSelectionVM(),
      isProjectDirectory: kind === 'projectDirectory', projectDirectory: this.projectDirectoryVM(),
      isPreferences: kind === 'preferences', preferences: this.preferencesVM(this.st()),
      isModelWorkspace: kind === 'modelWorkspace', modelWorkspace: this.modelWorkspaceVM(),
      isMediaForm: kind === 'mediaForm', mediaForm: this.mediaFormVM(this.st()),
      isMediaOutputs: kind === 'mediaOutputs', mediaOutputs: b.outputs || [],
      isProjectWizard: kind === 'projectWizard', projectWizard: this.projectWizardVM(this.st()),
      isSpecialistWizard: kind === 'specialistWizard', specialistWizard: this.specialistWizardVM(this.st()),
      isWorkerWizard: kind === 'workerWizard', workerWizard: this.workerWizardVM(this.st()),
      isExpertiseWizard: kind === 'expertiseWizard', expertiseWizard: this.expertiseWizardVM(this.st()),
      isApObecne: kind === 'apObecne', isApPismo: kind === 'apPismo', isApBarvy: kind === 'apBarvy', isApRozvrzeni: kind === 'apRozvrzeni', isApCss: kind === 'apCss'
    };
  }

  mediaStatus() { return { status: 'preview', available: false, models: [], error: 'Prototyp ukazuje formulář; backend se připojuje až v IDE.' }; }

  pairingVM() {
    return { scopes: ['read:chat', 'read:projects', 'write:chat'].map((name) => ({ name, checked: name !== 'write:chat', disabled: false, toggle: () => {} })),
      busy: false, disabled: true, issue: () => {}, hasError: false, error: '',
      hasClaim: false, code: '', expiry: '', uri: '',
      status: 'Prototyp ukazuje ovládání. Párovací kód vydává až lokální backend Studia.' };
  }

  settingsImportVM() {
    return { fileName: '', status: 'Prototyp ukazuje výběr souboru; validaci a import provádí až živé Studio.',
      disabled: true, busy: false, choose: () => {}, submit: () => {} };
  }

  feedbackVM() {
    return { categories: [{ value: 'bug', label: 'Chyba' }, { value: 'ux', label: 'Rozhraní' }],
      category: 'bug', setCategory: () => {}, message: '', setMessage: () => {},
      files: [], chooseFiles: () => {}, attachLast: false, setAttachLast: () => {},
      attachLogs: false, setAttachLogs: () => {}, disabled: true, send: () => {},
      notice: 'Prototyp ukazuje formulář; skutečnou zprávu odesílá až živé Studio.' };
  }

  securityVM(s) {
    const tab = s.dtab?.['settings:zabezpeceni'] || 'prehled';
    return { isAudit: tab === 'prehled', isAccess: tab === 'pristup', isSessions: tab === 'relace',
      status: 'Prototyp ukazuje rozvržení; bezpečnostní údaje načítá až živé Studio.',
      auditTypes: ['ALL', 'CRE', 'MERGE', 'DRIFT', 'LLM'].map(label => ({ label, selected: label === 'ALL', go: () => {} })),
      auditRows: [], tokens: [], tokenName: '', setTokenName: () => {}, scopes: [],
      createDisabled: true, create: () => {}, hasOneTimeToken: false, oneTimeToken: '',
      copyToken: () => {}, hideToken: () => {}, webhook: 'Načítání v živém Studiu.',
      sessions: 'Načítání v živém Studiu.' };
  }

  projectDirectoryVM() {
    return { value: '', change: () => {}, status: 'Prototyp ukazuje lokální volbu; živé Studio ji převezme do průvodce projektem.' };
  }

  expertiseSelectionVM() {
    return { status: 'Aktivní relace používá výchozí expertýzu.', rows: [],
      clearDisabled: true, clear: () => {}, refresh: () => {} };
  }

  preferencesVM() {
    return { fields: [{ label: 'Ukázková volba', value: 'Hodnota z prototypu', isText: true,
      isTextarea: false, isNumber: false, isToggle: false, isTime: false, isSelect: false,
      options: [], checked: false, disabled: true, min: 0, max: 0, step: 1, change: () => {} }],
    status: 'Prototyp ukazuje formulář; hodnoty načítá až živé Studio.' };
  }

  modelWorkspaceVM() {
    return { tabs: ['Přehled', 'Role', 'Evaluace', 'GPU hunt', 'Historie', 'Kandidáti', 'Správce', 'Upgrady', 'Automatizace'].map((label, index) => ({ label, cls: index === 0 ? 'on' : '', go: () => {} })),
      rows: [{ title: 'qwen3.5:27b', subtitle: 'Lokálně nainstalovaný · aktuální CHAT', meta: '26 GiB',
        actions: [{ label: 'Podrobnosti', disabled: true, go: () => {} }] }],
      buttons: [{ label: 'Obnovit', disabled: true, go: () => {} }],
      status: 'Prototyp ukazuje rozvržení; data a akce připojuje živé Studio.',
      hasRoleForm: false, roleOptions: [], modelOptions: [], selectedRole: '', selectedModel: '',
      setRole: () => {}, setModel: () => {}, applyRole: () => {}, applyRoleDisabled: true,
      hasPolicyForm: false, policyFailover: false, policyCleanup: false, policyDays: 14,
      setPolicyFailover: () => {}, setPolicyCleanup: () => {}, setPolicyDays: () => {},
      verifyWarning: '', hasRollback: false, rollback: () => {} };
  }

  projectStatus() { return { busy: false, error: 'Prototyp ukazuje průvodce; backend se připojuje až v IDE.', defaultDir: '' }; }

  submitProject() { return null; }

  specialistStatus() { return { busy: false, error: 'Prototyp ukazuje průvodce; backend se připojuje až v IDE.' }; }

  submitSpecialist() { return null; }

  workerStatus() { return { busy: false, error: 'Prototyp ukazuje průvodce; backend se připojuje až v IDE.',
    extensions: [{ id: 'project-health', name: 'Project Health' }], projects: [{ id: 1, name: 'ShellSmith' }] }; }

  submitWorker() { return null; }

  expertiseStatus() { return { busy: false, error: 'Prototyp ukazuje průvodce; backend se připojuje až v IDE.',
    preview: null }; }

  previewExpertise() { return null; }

  testExpertise() { return null; }

  submitExpertise() { return null; }

  expertiseWizardVM(s) {
    const status = this.expertiseStatus();
    const name = s.expertiseName.trim();
    const id = s.expertiseEditingId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '').slice(0, 32);
    const moduleFields = [
      [s.expertiseDomainRules, 15], [s.expertiseEmphasis, 10], [s.expertiseConstraints, 15],
      [s.expertiseVocabulary, 30], [s.expertiseAntipatterns, 10]
    ];
    let inheritanceValid = false;
    try { const parsed = JSON.parse(s.expertiseInheritance || '{}');
      inheritanceValid = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Object.keys(parsed).every(key => !['__proto__', 'constructor', 'prototype'].includes(key))
        && Object.values(parsed).every(value => value === 'extend' || value === 'replace');
    } catch { /* invalid JSON is shown as invalid form */ }
    const valid = name.length >= 2 && name.length <= 64 && !!id && !/[\x00-\x1f]/.test(name)
      && (!s.expertiseDomain || /^[a-z0-9_]{1,64}$/.test(s.expertiseDomain))
      && s.expertiseDescription.length <= 500 && s.expertiseSystemPrompt.length <= 8000
      && Number.isFinite(s.expertiseTemperature) && s.expertiseTemperature >= 0 && s.expertiseTemperature <= 1
      && [s.expertiseCreativity, s.expertiseReasoning, s.expertiseDeterminism,
        s.expertiseRiskTolerance, s.expertiseVerbosity]
        .every(value => Number.isInteger(value) && value >= 0 && value <= 100)
      && moduleFields.every(([value, limit]) => value.split('\n').filter(line => line.trim()).length <= limit
        && value.split('\n').every(line => line.length <= 500))
      && s.expertiseDisclaimer.length <= 2000
      && s.expertiseForbiddenPhrases.split('\n').filter(line => line.trim()).length <= 50
      && s.expertiseForbiddenPhrases.split('\n').every(line => line.length <= 200)
      && inheritanceValid;
    const setNumber = key => e => this.setState({ [key]: Number(e.target.value) });
    return {
      stepLabel: (s.expertiseEditingId ? 'Úprava · ' : '') + (s.expertiseStep === 0 ? 'Krok 1 ze 2 · Profil' : 'Krok 2 ze 2 · Ladění a kontrola'),
      isProfile: s.expertiseStep === 0, isReview: s.expertiseStep === 1,
      name: s.expertiseName, setName: e => this.setState({ expertiseName: e.target.value }),
      domain: s.expertiseDomain, setDomain: e => this.setState({ expertiseDomain: e.target.value }),
      description: s.expertiseDescription, setDescription: e => this.setState({ expertiseDescription: e.target.value }),
      icon: s.expertiseIcon, setIcon: e => this.setState({ expertiseIcon: e.target.value }),
      tone: s.expertiseTone, tones: ['professional', 'casual', 'academic', 'empathetic', 'assertive', 'neutral']
        .map(value => ({ value, label: value })), setTone: e => this.setState({ expertiseTone: e.target.value }),
      temperature: s.expertiseTemperature, setTemperature: setNumber('expertiseTemperature'),
      systemPrompt: s.expertiseSystemPrompt, setSystemPrompt: e => this.setState({ expertiseSystemPrompt: e.target.value }),
      creativity: s.expertiseCreativity, setCreativity: setNumber('expertiseCreativity'),
      reasoning: s.expertiseReasoning, setReasoning: setNumber('expertiseReasoning'),
      determinism: s.expertiseDeterminism, setDeterminism: setNumber('expertiseDeterminism'),
      riskTolerance: s.expertiseRiskTolerance, setRiskTolerance: setNumber('expertiseRiskTolerance'),
      verbosity: s.expertiseVerbosity, setVerbosity: setNumber('expertiseVerbosity'),
      advanced: s.expertiseAdvanced, toggleAdvanced: () => this.setState({ expertiseAdvanced: !s.expertiseAdvanced }),
      domainRules: s.expertiseDomainRules, setDomainRules: e => this.setState({ expertiseDomainRules: e.target.value }),
      emphasis: s.expertiseEmphasis, setEmphasis: e => this.setState({ expertiseEmphasis: e.target.value }),
      constraints: s.expertiseConstraints, setConstraints: e => this.setState({ expertiseConstraints: e.target.value }),
      vocabulary: s.expertiseVocabulary, setVocabulary: e => this.setState({ expertiseVocabulary: e.target.value }),
      antipatterns: s.expertiseAntipatterns, setAntipatterns: e => this.setState({ expertiseAntipatterns: e.target.value }),
      disclaimer: s.expertiseDisclaimer, setDisclaimer: e => this.setState({ expertiseDisclaimer: e.target.value }),
      forbiddenPhrases: s.expertiseForbiddenPhrases,
      setForbiddenPhrases: e => this.setState({ expertiseForbiddenPhrases: e.target.value }),
      inheritance: s.expertiseInheritance, setInheritance: e => this.setState({ expertiseInheritance: e.target.value }),
      inheritanceValid, hasInheritanceError: !inheritanceValid, testQuestion: s.expertiseTestQuestion,
      setTestQuestion: e => this.setState({ expertiseTestQuestion: e.target.value }),
      testDisabled: !valid || status.busy || !s.expertiseTestQuestion.trim() || s.expertiseTestQuestion.length > 2000,
      test: () => this.testExpertise(this.st()), testResult: status.testResult?.response || '',
      hasTestResult: !!status.testResult?.response,
      reviewName: name, reviewId: id, reviewDomain: s.expertiseDomain || 'custom',
      submitLabel: s.expertiseEditingId ? 'Uložit změny' : 'Potvrdit expertýzu',
      nextDisabled: !valid || status.busy, submitDisabled: !valid || status.busy || !!status.uncertain,
      next: () => this.setState({ expertiseStep: 1 }), back: () => this.setState({ expertiseStep: 0 }),
      preview: () => this.previewExpertise(this.st()), submit: () => this.submitExpertise(this.st()),
      previewText: status.preview?.promptPreview || '', hasPreview: !!status.preview?.promptPreview,
      status: status.error || '', hasStatus: !!status.error
    };
  }

  workerWizardVM(s) {
    const status = this.workerStatus();
    const extensions = Array.isArray(status.extensions) ? status.extensions : [];
    const projects = Array.isArray(status.projects) ? status.projects : [];
    const extension = extensions.find(item => item.id === s.workerExtension);
    const project = projects.find(item => String(item.id) === String(s.workerProject));
    const instanceId = s.workerInstanceId.trim();
    const valid = !!extension && !!project && /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(instanceId);
    return {
      stepLabel: s.workerStep === 0 ? 'Krok 1 ze 2 · Instance' : 'Krok 2 ze 2 · Kontrola',
      isForm: s.workerStep === 0, isReview: s.workerStep === 1,
      extensions: extensions.map(item => ({ value: item.id, label: item.name + ' · ' + item.id })),
      extension: s.workerExtension, setExtension: e => this.setState({ workerExtension: e.target.value }),
      projects: projects.map(item => ({ value: String(item.id), label: item.name })),
      project: s.workerProject, setProject: e => this.setState({ workerProject: e.target.value }),
      instanceId: s.workerInstanceId, setInstanceId: e => this.setState({ workerInstanceId: e.target.value }),
      reviewExtension: extension?.name || '—', reviewProject: project?.name || '—', reviewInstanceId: instanceId,
      nextDisabled: !valid || status.busy || status.loading,
      submitDisabled: !valid || status.busy || status.loading || !!status.uncertain,
      next: () => this.setState({ workerStep: 1 }), back: () => this.setState({ workerStep: 0 }),
      submit: () => this.submitWorker(this.st()),
      status: status.error || (status.loading ? 'Načítám rozšíření a projekty…' : ''),
      hasStatus: !!status.error || !!status.loading
    };
  }

  specialistWizardVM(s) {
    const status = this.specialistStatus();
    const name = s.specialistName.trim();
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, '').slice(0, 32);
    const domains = ['general', 'technology', 'business', 'creative', 'research', 'psychology', 'language', 'education', 'data'];
    const valid = name.length >= 2 && name.length <= 120 && !!id && !/[\x00-\x1f]/.test(name)
      && domains.includes(s.specialistDomain) && s.specialistDescription.length <= 4000
      && Array.from(s.specialistIcon).length <= 4;
    return {
      step: s.specialistStep, isForm: s.specialistStep === 0, isReview: s.specialistStep === 1,
      stepLabel: s.specialistStep === 0 ? 'Krok 1 ze 2 · Údaje' : 'Krok 2 ze 2 · Kontrola',
      name: s.specialistName, setName: e => this.setState({ specialistName: e.target.value }),
      domain: s.specialistDomain, domains: domains.map(value => ({ value, label: value })),
      setDomain: e => this.setState({ specialistDomain: e.target.value }),
      description: s.specialistDescription, setDescription: e => this.setState({ specialistDescription: e.target.value }),
      icon: s.specialistIcon, setIcon: e => this.setState({ specialistIcon: e.target.value }),
      reviewName: name, reviewId: id, reviewDomain: s.specialistDomain,
      reviewDescription: s.specialistDescription || 'bez popisu', reviewIcon: s.specialistIcon || '🤖',
      nextDisabled: !valid || status.busy, submitDisabled: !valid || status.busy || !!status.uncertain,
      next: () => this.setState({ specialistStep: 1 }), back: () => this.setState({ specialistStep: 0 }),
      submit: () => this.submitSpecialist(this.st()), status: status.error || '', hasStatus: !!status.error
    };
  }

  projectWizardVM(s) {
    const status = this.projectStatus();
    const mode = s.projectMode === 'open' ? 'open' : 'create';
    const name = s.projectName.trim(), path = s.projectPath.trim();
    const nameValid = name.length > 0 && name.length <= 120 && !/[\x00-\x1f]/.test(name);
    const pathValid = !path || path.startsWith('/') && !/[\x00-\x1f]/.test(path);
    const valid = mode === 'create' ? nameValid && pathValid && s.projectDescription.length <= 4000
      : path.length > 1 && pathValid && (!name || nameValid);
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const target = path || (status.defaultDir && slug ? status.defaultDir + '/' + slug : 'výchozí složka backendu');
    return {
      mode, modes: [{ value: 'create', label: 'Vytvořit nový' }, { value: 'open', label: 'Otevřít existující složku' }],
      setMode: e => this.setState({ projectMode: e.target.value, projectStep: 0 }),
      step: s.projectStep, stepLabel: s.projectStep === 0 ? 'Krok 1 ze 2 · Údaje' : 'Krok 2 ze 2 · Kontrola',
      isForm: s.projectStep === 0, isReview: s.projectStep === 1,
      name: s.projectName, setName: e => this.setState({ projectName: e.target.value }),
      path: s.projectPath, setPath: e => this.setState({ projectPath: e.target.value }),
      description: s.projectDescription, setDescription: e => this.setState({ projectDescription: e.target.value }),
      type: s.projectType, types: [
        { value: 'general', label: 'Obecný' }, { value: 'desktop', label: 'Desktop' },
        { value: 'webapp', label: 'Web' }, { value: 'api', label: 'API' },
        { value: 'automation', label: 'Automatizace' }, { value: 'data', label: 'Data' }
      ], setType: e => this.setState({ projectType: e.target.value }),
      isCreate: mode === 'create', pathLabel: mode === 'create' ? 'Vlastní cesta (volitelně)' : 'Existující složka',
      reviewMode: mode === 'create' ? 'Vytvořit nový' : 'Otevřít existující',
      reviewName: name || '(název ze složky)', reviewTarget: target,
      reviewType: s.projectType, reviewDescription: s.projectDescription || 'bez popisu',
      status: status.error || '', hasStatus: !!status.error,
      nextDisabled: !valid || status.busy || (mode === 'create' && !slug),
      submitDisabled: !valid || status.busy || !!status.uncertain || (mode === 'create' && !slug),
      next: () => this.setState({ projectStep: 1 }), back: () => this.setState({ projectStep: 0 }),
      submit: () => this.submitProject(this.st())
    };
  }

  submitMedia() { return null; }

  pickMediaInput(event) {
    const file = event?.target?.files?.[0];
    this.setState({ mediaInputName: file?.name || '' });
  }

  mediaFormVM(s) {
    const status = this.mediaStatus();
    const models = Array.isArray(status.models) ? status.models : [];
    const selectedModel = models.includes(s.mediaModel) ? s.mediaModel : models[0] || '';
    const numbers = [s.mediaWidth, s.mediaHeight, s.mediaSteps, s.mediaCfg, s.mediaSeed];
    const valid = numbers.every(Number.isFinite) && s.mediaWidth >= 64 && s.mediaWidth <= 4096 && s.mediaWidth % 8 === 0
      && s.mediaHeight >= 64 && s.mediaHeight <= 4096 && s.mediaHeight % 8 === 0
      && s.mediaSteps >= 1 && s.mediaSteps <= 150 && s.mediaCfg >= 0 && s.mediaCfg <= 30 && s.mediaSeed >= -1
      && (s.mediaType !== 'txt2vid' || Number.isInteger(s.mediaFrames) && s.mediaFrames >= 1 && s.mediaFrames <= 300)
      && (s.mediaType !== 'img2img' || Number.isFinite(s.mediaDenoise) && s.mediaDenoise > 0
        && s.mediaDenoise <= 1 && !!s.mediaInputName);
    const setNumber = (key) => (e) => this.setState({ [key]: e.target.value === '' ? '' : Number(e.target.value) });
    return {
      types: [{ value: 'txt2img', label: 'Text → obraz' }, { value: 'img2img', label: 'Obraz → obraz' },
        { value: 'txt2vid', label: 'Text → video' }],
      type: s.mediaType, setType: (e) => this.setState({ mediaType: e.target.value,
        mediaWidth: e.target.value === 'txt2vid' ? 848 : 1024,
        mediaHeight: e.target.value === 'txt2vid' ? 480 : 1024,
        mediaSteps: e.target.value === 'txt2vid' ? 30 : 20 }),
      prompt: s.mediaPrompt, setPrompt: (e) => this.setState({ mediaPrompt: e.target.value }),
      negative: s.mediaNegative, setNegative: (e) => this.setState({ mediaNegative: e.target.value }),
      width: s.mediaWidth, setWidth: setNumber('mediaWidth'), height: s.mediaHeight, setHeight: setNumber('mediaHeight'),
      steps: s.mediaSteps, setSteps: setNumber('mediaSteps'), cfg: s.mediaCfg, setCfg: setNumber('mediaCfg'),
      seed: s.mediaSeed, setSeed: setNumber('mediaSeed'), frames: s.mediaFrames, setFrames: setNumber('mediaFrames'),
      isVideo: s.mediaType === 'txt2vid', models: models.map((name) => ({ value: name, label: name })),
      isImageToImage: s.mediaType === 'img2img', inputName: s.mediaInputName,
      pickInput: e => this.pickMediaInput(e), denoise: s.mediaDenoise, setDenoise: setNumber('mediaDenoise'),
      model: selectedModel, setModel: (e) => this.setState({ mediaModel: e.target.value }),
      status: status.error || (status.status === 'loading' ? 'Ověřuji ComfyUI a modely…'
        : status.available ? 'ComfyUI je dostupné.' : 'ComfyUI není dostupné.'),
      disabled: !status.available || !selectedModel || !s.mediaPrompt.trim() || !valid || status.status === 'loading',
      submit: () => this.submitMedia(this.st())
    };
  }

  detailVM(s) {
    const sec = s.section, id = s.detail[sec];
    if (!id) return null;
    const sp = this.detailSpec(sec, id, s);
    if (!sp) return null;
    const key = sec + ':' + id;
    const tabId = s.dtab[key] && sp.tabs.some((tab) => tab[0] === s.dtab[key]) ? s.dtab[key] : sp.tabs[0][0];
    const first = tabId === sp.tabs[0][0];
    return {
      icon: sp.icon, tone: sp.tone || 'none', icls: sp.icls || '', title: sp.title, type: sp.type, idText: sp.idText, hasStatus: !!sp.status, status: sp.status || '', stCls: sp.stCls || '',
      hasPrimary: !!sp.primary, primaryLabel: sp.primary ? sp.primary.label : '', onPrimary: sp.primary ? this.run(sp.primary.go) : () => {},
      secondary: (sp.secondary || []).map((b) => ({ label: b.label, icon: b.icon, go: this.run(b.go || (() => ({}))) })),
      more: this.showCtx(sec, id),
      hasTabs: sp.tabs.length > 1,
      tabs: sp.tabs.map((t) => ({ label: t[1], n: t[2] || '', hasN: !!t[2], cls: t[0] === tabId ? 'on' : '', go: () => this.setState({ dtab: this.merge(this.st(), 'dtab', { [key]: t[0] }) }) })),
      hasDesc: !!sp.desc && first, desc: sp.desc || '',
      showProps: first && !sp.hideProps && sp.props.length > 0,
      props: sp.props.map((p) => ({ k: p[0], v: p[1], cls: p[2] ? 'mono' : '' })),
      blocks: (sp.blocks[tabId] || (sec === 'settings' ? [{ kind: 'empty', text: 'Tato záložka zatím není připojená.' }] : [])).map((b) => this.blockVM(b)),
      development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, sec === 'projects' ? id : null),
      hasRelated: !!(sp.related && sp.related.length) && first, related: (sp.related || []).map((r) => ({ t: r.t, s: r.s, icon: r.icon, go: this.run(r.go) }))
    };
  }

  msgVM(m, sid, s, b) {
    const I = this.data().I;
    const a = s.approved[sid];
    const stopped = !!(m.rid && s.stopped[m.rid]);
    const steps = (m.steps || []).map((x) => ({ t: x[0], m: x[1] || '', cls: x[2] === 'run' ? (stopped ? 'stopped' : 'run') : '' }));
    let hasApproval = false, hasResult = false, resText = '', resColor = 'var(--ok)', resIcon = I.check;
    const ap = m.approval;
    if (ap) {
      if (ap.done) { hasResult = true; resText = ap.done; }
      else if (a === 'ok') { hasResult = true; resText = 'Schváleno · ' + this.filesWord(ap.files) + ' zapsáno do projektu'; }
      else if (a === 'no') { hasResult = true; resText = 'Zamítnuto · změny se nezapsaly'; resColor = 'var(--dim)'; resIcon = I.x; }
      else hasApproval = true;
    }
    if (m.running && stopped) { hasResult = true; resText = 'Zastaveno uživatelem · rozpracovaný soubor se nezapsal'; resColor = 'var(--dim)'; resIcon = I.stop; }
    const mode = s.modes[sid] || b.mode;
    const author = m.author || (b.kind === 'specialist' && m.k === 'agent' ? b.short : 'IntentSmith');
    return {
      isUser: m.k === 'user', isAgent: m.k === 'agent', text: m.text || '', hasText: !!m.text, time: m.time || '',
      hasAtts: !!(m.atts && m.atts.length), atts: (m.atts || []).map((a) => ({ t: a })),
      author, authorIcon: b.kind === 'specialist' ? I.users : I.anvil,
      badge: m.badge || '', hasBadge: !!m.badge, expert: m.expert || '',
      steps, hasSteps: steps.length > 0, paras: (m.paras || []).map((t) => ({ t })),
      code: (m.code || []).map((t) => ({ t })), hasCode: !!(m.code && m.code.length),
      hasMarkdown: false, noMarkdown: true, html: '',
      hasCopy: m.k === 'agent' && !!((m.paras || []).length || (m.code || []).length),
      copy: () => { const value = (m.paras || []).join('\n\n') + ((m.code || []).length ? '\n\n' + m.code.join('\n') : '');
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) navigator.clipboard.writeText(value).catch(() => {}); },
      isRunning: !!m.running && !stopped, runText: m.runText || 'Pracuje…',
      stop: () => this.setState({ stopped: this.merge(this.st(), 'stopped', { [m.rid]: true }) }),
      hasApproval, apprTitle: 'Změny čekají na schválení', apprSub: ap ? this.filesWord(ap.files) + ' · +' + ap.add + ' −' + ap.del + ' · režim ' + (mode === 'auto' ? 'Auto' : 'Kontrola') : '',
      approve: this.run((s2) => this.pApprove(s2, sid, 'ok')), reject: this.run((s2) => this.pApprove(s2, sid, 'no')),
      showChanges: () => this.setState({ rightOpen: true, rightPin: true, rightTab: 'zmeny', mode: 'sessions', focusCol: Math.max(0, this.colLayout(this.st()).indexOf(sid)) }),
      hasResult, resText, resColor, resIcon
    };
  }

  columnsVM(s, lay, fidx) {
    const I = this.data().I;
    const fr = s.colFr;
    return lay.map((sid, i) => {
      const b = this.sess(sid, s);
      const st = this.sstate(sid, s);
      const mode = s.modes[sid] || b.mode;
      const p = b.project ? this.proj(b.project) : null;
      const sp = b.specialist ? this.spec(b.specialist) : null;
      const extra = s.extra[sid] || [];
      const bt = s.btab[sid] || 'terminal';
      const log = b.log.slice();
      extra.forEach((m) => { if (m.k === 'user') log.push(['teď', 'INFO', 'var(--info)', 'turn_start', 'nová zpráva uživatele']); if (m.running) log.push(['teď', 'LLM', 'var(--acct)', b.model, s.stopped[m.rid] ? 'zastaveno uživatelem' : 'generuje odpověď…']); });
      if (s.approved[sid] === 'ok') log.push(['teď', 'INFO', 'var(--info)', 'edit_approve', 'schváleno uživatelem · soubory zapsány']);
      if (s.approved[sid] === 'no') log.push(['teď', 'INFO', 'var(--info)', 'edit_reject', 'zamítnuto uživatelem']);
      const runs = (b.runs || []).map((r) => {
        let stt = r[5], c = 'var(--ok)';
        if (stt === 'APPR') { const a = s.approved[sid]; stt = a === 'ok' ? 'schváleno' : a === 'no' ? 'zamítnuto' : 'čeká'; c = a === 'ok' ? 'var(--ok)' : a === 'no' ? 'var(--dim)' : 'var(--warn)'; }
        else if (stt === 'RUN') { const stopped = s.stopped.s3a; stt = stopped ? 'zastaveno' : 'běží'; c = stopped ? 'var(--dim)' : 'var(--acct)'; }
        else if (stt === 'selhalo') c = 'var(--bad)';
        return { t: r[0], step: r[1], tool: r[2], target: r[3], dur: r[4], st: stt, c };
      });
      const probs = (b.problems || []).map((x) => ({ t: x[0], k: x[1], m: x[2] }));
      const btabs = [['terminal', 'Terminál', 0], ['log', 'Log agenta', log.length], ['runs', 'Průběh', runs.length], ['audit', 'Audit', 0], ['prob', 'Problémy', probs.length]];
      const fresh = !!b.fresh && extra.length === 0;
      const owner = sp ? { name: sp.name, icon: I.users, title: 'Detail specialisty', go: (s2) => this.pSelect(s2, 'specialists', sp.id) } : p ? { name: p.name, icon: I.folder, title: 'Detail projektu', go: (s2) => this.pSelect(s2, 'projects', p.id) } : null;
      return {
        n: s.tabs.indexOf(sid) + 1, numCls: i === fidx ? 'focus' : 'vis', cls: i === fidx && lay.length > 1 ? 'focus' : '',
        splitCls: i > 0 ? '' : 'hide', split: this.colDrag(i),
        rows: '40px minmax(0, 1fr) auto ' + (s.bottomOpen ? '4px ' + s.bottomH + 'px' : '0px 0px'),
        focus: () => { const s2 = this.st(); if (s2.focusCol !== i) this.setState({ focusCol: i }); },
        kindIcon: this.kindIcon(b.kind), dot: st, title: b.title,
        hasOwner: !!owner, ownerName: owner ? owner.name : '', ownerIcon: owner ? owner.icon : '', ownerTitle: owner ? owner.title : '', openOwner: this.run(owner ? owner.go : () => null),
        hasIntent: !!b.intent, intent: b.intent || '',
        autoCls: mode === 'auto' ? 'on' : '', revCls: mode === 'kontrola' ? 'on' : '',
        setAuto: () => this.setState({ modes: this.merge(this.st(), 'modes', { [sid]: 'auto' }) }),
        setRev: () => this.setState({ modes: this.merge(this.st(), 'modes', { [sid]: 'kontrola' }) }),
        ctx: this.ctxOf(sid, s),
        multi: lay.length > 1,
        pick: this.showCtx('colpick', String(i), 'left'), pickCls: s.ctx && s.ctx.sec === 'colpick' && s.ctx.id === String(i) ? 'open' : '',
        closeCol: () => { const s2 = this.st(); const l2 = this.colLayout(s2); l2.splice(i, 1); const fr2 = s2.colFr.slice(); fr2.splice(i, 1); fr2.push(1); this.setState({ cols: Math.max(1, s2.cols - 1), colSids: l2, colFr: fr2, focusCol: Math.max(0, Math.min(s2.focusCol, l2.length - 1)) }); },
        msgs: b.msgs.concat(extra).map((m) => this.msgVM(m, sid, s, b)),
        isFresh: fresh, freshTitle: sp ? 'Nová konverzace se specialistou ' + sp.name : p ? 'Nová relace v projektu ' + p.name : 'Nová konverzace',
        freshText: sp ? 'Specialista má k dispozici své nástroje. Napiš, co má udělat.' : p ? 'Agent zná strukturu projektu a jeho paměť. Napiš, co se má udělat.' : 'Zeptej se na cokoli, nebo připoj projekt přes paletu příkazů.',
        expert: s.experts[sid] || b.expert, model: b.model,
        hasAttachmentError: false, attachmentError: '', hasDelivery: false, deliveryText: '',
        deliveryUnknown: false, acknowledge: () => {}, hasModel: true, hasExpertPicker: true,
        draft: s.drafts[sid] || '',
        setDraft: (e) => this.setState({ drafts: this.merge(this.st(), 'drafts', { [sid]: e.target.value }) }),
        keyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const p2 = this.pSend(this.st(), sid); if (p2) this.setState(p2); } },
        send: this.run((s2) => this.pSend(s2, sid)),
        pickExpert: this.run((s2) => this.pGo(s2, 'expertises')),
        pickModel: this.run((s2) => this.pSelect(s2, 'settings', 'modely')),
        btabs: btabs.map((t) => ({ label: t[1], n: t[2] || '', hasN: !!t[2], cls: bt === t[0] ? 'on' : '', go: () => this.setState({ btab: this.merge(this.st(), 'btab', { [sid]: t[0] }), bottomOpen: true }) })),
        isTerm: bt === 'terminal', isLog: bt === 'log', isRuns: bt === 'runs', isAudit: bt === 'audit', isProb: bt === 'prob',
        term: b.term.concat(s.termX[sid] || []).filter((l, j, all) => !(l[0] === '$ ' && j === all.length - 1)).map((l) => ({ t: l[0], cls: l[1] })),
        cmd: s.cmds[sid] || '',
        setCmd: (e) => this.setState({ cmds: this.merge(this.st(), 'cmds', { [sid]: e.target.value }) }),
        cmdKey: (e) => this.termKey(e, sid),
        atts: (s.atts[sid] || []).map((a, j) => ({ t: a[0], s: a[1], remove: () => { const s2 = this.st(); const l = (s2.atts[sid] || []).slice(); l.splice(j, 1); this.setState({ atts: this.merge(s2, 'atts', { [sid]: l }) }); } })),
        hasAtts: (s.atts[sid] || []).length > 0,
        attach: () => { const s2 = this.st(); const l = s2.atts[sid] || []; const pool = [['zadani.md', '2 kB'], ['snimek-obrazovky.png', '184 kB'], ['chyba.log', '12 kB']]; const next = pool.find((a) => !l.some((x) => x[0] === a[0])); if (next) this.setState({ atts: this.merge(s2, 'atts', { [sid]: l.concat([next]) }) }); },
        log: log.map((l) => ({ t: l[0], lv: l[1], c: l[2], e: l[3], m: l[4] })),
        runs, hasRuns: runs.length > 0, noRuns: runs.length === 0, runGrid: '60px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) 52px 76px',
        audit: (s.auditX[sid] || []).concat(b.audit || []).map((l) => ({ t: l[0], e: l[1], m: l[2] })),
        problems: probs, hasProblems: probs.length > 0, noProblems: probs.length === 0
      };
    });
  }

  tabsVM(s, lay, fsid) {
    return s.tabs.map((sid, i) => {
      const b = this.sess(sid, s);
      const st = this.sstate(sid, s);
      const vis = s.mode === 'sessions' && lay.indexOf(sid) >= 0;
      const foc = s.mode === 'sessions' && sid === fsid;
      return {
        n: i + 1, numCls: foc ? 'focus' : vis ? 'vis' : '', cls: foc ? 'focus' : vis ? 'vis' : '',
        icon: this.kindIcon(b.kind), title: b.short, pinned: !!s.pinned[sid],
        full: (i + 1) + ' · ' + b.title + ' · ' + this.stLabel(st) + (s.pinned[sid] ? ' · Připnuto' : ''), dot: st,
        go: this.run((s2) => this.pFocusSession(s2, sid)),
        close: (e) => { if (e && e.stopPropagation) e.stopPropagation(); const s2 = this.st(); this.setState(Object.assign({ ctx: null, menu: null }, this.pCloseTab(s2, sid))); },
        ctx: this.showCtx('tab', sid)
      };
    });
  }

  wsVM(s, fsid) {
    const I = this.data().I;
    const tabsDef = [['zmeny', 'Změny'], ['soubory', 'Soubory'], ['scm', 'Správa zdrojů'], ['kontext', 'Kontext']];
    const b = fsid ? this.sess(fsid, s) : null;
    const fl = this.filesVM(fsid, s);
    const scm = this.scmVM(s, fsid);
    scm.unavailable = false;
    const fvS = this.fileViewVM(fsid, s, 'soubory');
    const fvG = this.fileViewVM(fsid, s, 'scm');
    const common = {
      fl, scm, fvS, fvG, m2Pending: false, m2Digest: '', m2Lifecycle: '', m2Governance: '', m2Test: '', m2Git: '',
      m2Refresh: () => {}, m2HasError: false, m2Error: '', hasFileError: false, fileError: '', isSouboryList: s.rightTab === 'soubory' && !fvS.isOpen, isSouboryFile: s.rightTab === 'soubory' && fvS.isOpen,
      isScm: s.rightTab === 'scm', isScmMain: s.rightTab === 'scm' && !fvG.isOpen, isScmFile: s.rightTab === 'scm' && fvG.isOpen,
      editFoot: (s.rightTab === 'soubory' && fvS.showFoot) || (s.rightTab === 'scm' && fvG.showFoot)
    };
    common.fv = s.rightTab === 'scm' ? fvG : fvS;
    if (!b) {
      return Object.assign(common, { tabs: tabsDef.map((t) => ({ label: t[1], n: '', hasN: false, cls: s.rightTab === t[0] ? 'on' : '', go: () => this.setState({ rightTab: t[0] }) })), n: '–', dot: '', label: 'žádná relace', isZmeny: s.rightTab === 'zmeny', isKontext: s.rightTab === 'kontext', isSoubory: s.rightTab === 'soubory', hasChanges: false, noChanges: true, files: [], emptyIcon: I.chat, emptyTitle: 'Žádná otevřená relace', emptyText: 'Pracovní plocha ukazuje změny, soubory, správu zdrojů a kontext relace v aktivním sloupci.', showFoot: false, sum: '', approve: () => {}, reject: () => {}, ctx: 0, parts: [], tokens: '', turns: 0, ctxFiles: [], hasCtxFiles: false, noCtxFiles: true, memory: [], hasMemory: false, editFoot: false });
    }
    const st = this.sstate(fsid, s);
    const pending = b.changes.length > 0 && st === 'wait';
    const add = b.changes.reduce((x, f) => x + f.add, 0), del = b.changes.reduce((x, f) => x + f.del, 0);
    const files = pending ? b.changes.map((f) => {
      const open = !!s.openFiles[f.path];
      return {
        path: f.path, addText: '+' + f.add, delText: f.del ? '−' + f.del : '', isNew: !!f.isNew, open, chev: open ? I.down : I.right,
        toggle: () => this.setState({ openFiles: this.merge(this.st(), 'openFiles', { [f.path]: !open }) }),
        lines: f.lines.map((l) => ({ o: l.o, n: l.n, sign: l.k === 'add' ? '+' : l.k === 'del' ? '−' : '', code: l.t, cls: l.k }))
      };
    }) : [];
    const a = s.approved[fsid];
    const emptyTitle = a === 'ok' ? 'Změny jsou zapsané' : a === 'no' ? 'Změny byly zamítnuté' : st === 'run' ? 'Agent právě pracuje' : 'Nic nečeká na schválení';
    const emptyText = a === 'ok' ? 'Soubory jsou v projektu. Historie změn zůstává v auditu relace.' : a === 'no' ? 'Projekt zůstal beze změny. Agentovi můžeš napsat, co udělat jinak.' : st === 'run' ? 'Hotové změny se tu objeví, jakmile agent požádá o schválení.' : 'V režimu Kontrola se sem dostanou změny souborů, než se zapíšou.';
    const counts = { zmeny: pending ? b.changes.length : 0, scm: scm.count };
    return Object.assign(common, {
      tabs: tabsDef.map((t) => ({ label: t[1], n: counts[t[0]] || '', hasN: !!counts[t[0]], cls: s.rightTab === t[0] ? 'on' : '', go: () => this.setState({ rightTab: t[0] }) })),
      n: s.tabs.indexOf(fsid) + 1, dot: st, label: b.short,
      isZmeny: s.rightTab === 'zmeny', isKontext: s.rightTab === 'kontext', isSoubory: s.rightTab === 'soubory',
      hasChanges: pending, noChanges: !pending, files, emptyIcon: a === 'no' ? I.x : st === 'run' ? I.clock : I.check, emptyTitle, emptyText,
      showFoot: pending && s.rightTab === 'zmeny', sum: this.filesWord(b.changes.length) + ' · +' + add + ' −' + del,
      approve: this.run((s2) => this.pApprove(s2, fsid, 'ok')), reject: this.run((s2) => this.pApprove(s2, fsid, 'no')),
      ctx: this.ctxOf(fsid, s), parts: b.parts.map((p) => ({ label: p[0], v: p[1], c: p[2] })), tokens: b.tokens, turns: b.turns + (s.extra[fsid] || []).length / 2,
      ctxFiles: (b.ctxFiles || []).map((f) => ({ p: f[0], s: f[1] })), hasCtxFiles: (b.ctxFiles || []).length > 0, noCtxFiles: !(b.ctxFiles || []).length,
      memory: (b.memory || []).map((t) => ({ t })), hasMemory: (b.memory || []).length > 0
    });
  }

  // ---- Soubory relace (zadání 25. 9., bod 2) ----

  fileKey(sid, s, path) {
    const b = this.sess(sid, s);
    return ((b && b.project) || sid) + '|' + path;
  }

  fileContent(sid, s, path) {
    const saved = s.fileText[this.fileKey(sid, s, path)];
    if (saved !== undefined) return saved;
    const f = this.data().FILES[path];
    if (f !== undefined) return f;
    return '// ' + path + '\n\n// Prototyp obsah tohoto souboru nemá. V IDE ho načte GET /api/workspace/file.';
  }

  sessFiles(sid, s) {
    const d = this.data();
    const b = this.sess(sid, s);
    if (!b) return { edited: [], opened: [] };
    const a = s.approved[sid];
    const edited = [];
    const seen = {};
    b.changes.forEach((f) => {
      seen[f.path] = 1;
      edited.push({ path: f.path, add: f.add, del: f.del, st: a === 'ok' ? 'zapsáno' : a === 'no' ? 'zamítnuto' : 'navrženo', diff: f.lines, isNew: !!f.isNew });
    });
    (b.edited || []).forEach((e) => {
      if (seen[e[0]]) return;
      seen[e[0]] = 1;
      const st = e[3] === 'zapisuje se' && !this.isRunning(sid, s) ? 'nedokončeno' : e[3];
      edited.push({ path: e[0], add: e[1], del: e[2], st, diff: d.DIFFS[e[0]] || null, isNew: e[4] === 'A' });
    });
    const pk = (b.project || sid) + '|';
    Object.keys(s.fileText).forEach((k) => {
      if (k.indexOf(pk) !== 0) return;
      const path = k.slice(pk.length);
      if (seen[path]) return;
      seen[path] = 1;
      edited.push({ path, add: 1, del: 1, st: 'uloženo ručně', diff: null, isNew: false });
    });
    const opened = [];
    Object.keys(s.userOpened[sid] || {}).forEach((path) => opened.push({ path, src: 'otevřel jsi', meta: '' }));
    (b.ctxFiles || []).forEach((f) => { if (!opened.some((o) => o.path === f[0])) opened.push({ path: f[0], src: 'četl agent', meta: f[1] }); });
    (b.attach || []).forEach((f) => opened.push({ path: f[0], src: 'příloha', meta: f[1], attach: true }));
    return { edited, opened };
  }

  fileDiff(sid, s, path) {
    const d = this.data();
    const e = this.sessFiles(sid, s).edited.find((x) => x.path === path);
    if (e && e.diff) return e.diff;
    if (d.DIFFS[path]) return d.DIFFS[path];
    const g = this.focusGit(s, sid);
    const isNew = (e && e.isNew) || (g && g.all.some((x) => x.path === path && x.isNew));
    if (isNew && d.FILES[path] !== undefined) {
      const lines = d.FILES[path].split('\n');
      return [{ k: 'hunk', o: '', n: '', t: '@@ -0,0 +1,' + lines.length + ' @@' }].concat(lines.map((t, i) => ({ k: 'add', o: '', n: String(i + 1), t })));
    }
    return null;
  }

  dirtyOf(sid, s) {
    const fv = s.fileView[sid];
    if (!fv) return false;
    const k = this.fileKey(sid, s, fv.path);
    return s.fileDraft[k] !== undefined && s.fileDraft[k] !== this.fileContent(sid, s, fv.path);
  }

  pOpenFile(s, sid, next) {
    if (this.dirtyOf(sid, s) && !(next && s.fileView[sid] && next.path === s.fileView[sid].path)) return { fileGuard: { sid, next: next || null } };
    const fv = Object.assign({}, s.fileView, { [sid]: next ? { path: next.path, from: next.from } : null });
    const p = { fileView: fv, fileGuard: null, rightOpen: true };
    if (next) {
      p.fileMode = this.merge(s, 'fileMode', { [sid]: next.mode || 'nahled' });
      p.rightTab = next.from;
      const b = this.sess(sid, s);
      if (next.from === 'soubory' && !(b.ctxFiles || []).some((f) => f[0] === next.path)) p.userOpened = this.merge(s, 'userOpened', { [sid]: Object.assign({}, s.userOpened[sid], { [next.path]: true }) });
    }
    return p;
  }

  pSaveFile(s, sid) {
    const fv = s.fileView[sid];
    if (!fv) return null;
    const k = this.fileKey(sid, s, fv.path);
    const draft = s.fileDraft[k];
    const fileDraft = Object.assign({}, s.fileDraft);
    delete fileDraft[k];
    const p = { fileDraft };
    if (draft !== undefined && draft !== this.fileContent(sid, s, fv.path)) {
      p.fileText = this.merge(s, 'fileText', { [k]: draft });
      p.auditX = this.merge(s, 'auditX', { [sid]: [['teď', 'file_save', fv.path + ' · uloženo uživatelem']].concat(s.auditX[sid] || []) });
    }
    return p;
  }

  pDiscardFile(s, sid) {
    const fv = s.fileView[sid];
    if (!fv) return null;
    const fileDraft = Object.assign({}, s.fileDraft);
    delete fileDraft[this.fileKey(sid, s, fv.path)];
    return { fileDraft };
  }

  pResolveGuard(s, how) {
    const g = s.fileGuard;
    if (!g) return null;
    if (how === 'stay') return { fileGuard: null, fileMode: this.merge(s, 'fileMode', { [g.sid]: 'upravy' }) };
    const p1 = how === 'save' ? this.pSaveFile(s, g.sid) : this.pDiscardFile(s, g.sid);
    return this.chain(s, Object.assign({ fileGuard: null }, p1), (s2) => this.pOpenFile(s2, g.sid, g.next));
  }

  treeVM(sid, s, b) {
    const I = this.data().I;
    const rows = [];
    const stack = [];
    let hideBelow = -1;
    const pk = (b.project || sid) + '|';
    (b.tree || []).forEach((t) => {
      const depth = t[0], name = t[1], isDir = !!t[2];
      stack.length = depth;
      const path = stack.concat([name]).join('/');
      stack.push(name);
      if (hideBelow >= 0) { if (depth > hideBelow) return; hideBelow = -1; }
      const closed = isDir && !!s.treeClosed[sid + '|' + path];
      if (closed) hideBelow = depth;
      const mark = t[3] || (s.fileText[pk + path] !== undefined ? 'M' : '');
      const fv = s.fileView[sid];
      rows.push({
        pad: 8 + depth * 14, name, path, isDir, icon: isDir ? I.folder : I.file, ic: isDir ? 'var(--acct)' : 'var(--faint)',
        chev: isDir ? (closed ? I.right : I.down) : '', hasChev: isDir, cls: (mark ? 'tmod' : '') + (fv && fv.path === path ? ' sel' : ''), mark, mc: mark === 'A' ? 'var(--ok)' : 'var(--warn)',
        go: isDir ? () => this.setState({ treeClosed: this.merge(this.st(), 'treeClosed', { [sid + '|' + path]: !closed }) }) : this.run((s2) => this.pOpenFile(s2, sid, { path, from: 'soubory' })),
        rename: () => this.startFileAction(sid, 'rename', path),
        remove: () => this.startFileAction(sid, 'delete', path, isDir)
      });
    });
    return rows;
  }

  splitPath(path) {
    const i = path.lastIndexOf('/');
    return { name: i >= 0 ? path.slice(i + 1) : path, dir: i >= 0 ? path.slice(0, i) : '' };
  }

  startFileAction(sid, op, path = '', directory = false) {
    this.setState({ fileAction: { sid, op, path, to: op === 'rename' ? path : '', directory }, fileActionNotice: '' });
  }

  fileActionVM(sid, s) {
    const action = s.fileAction?.sid === sid ? s.fileAction : null;
    if (!action) return { has: false, target: '', setTarget: () => {}, submit: () => {}, cancel: () => {}, title: '', plan: '', impact: '', isDelete: false, needsTarget: false, busy: false };
    const names = { create_file: 'Nový soubor', create_directory: 'Nová složka', rename: 'Přejmenovat', delete: 'Smazat' };
    const target = action.op === 'rename' ? action.to : action.path;
    return { has: true, target, title: names[action.op], isDelete: action.op === 'delete', needsTarget: action.op !== 'delete', busy: !!action.busy,
      plan: action.op === 'rename' ? action.path + ' → ' + action.to : target,
      impact: action.directory ? 'Složka se smaže včetně obsahu.' + (action.entries == null ? '' : ' Položek: ' + action.entries + '.')
        : 'Soubor bude odstraněn z projektu.',
      setTarget: (event) => this.setState({ fileAction: { ...this.st().fileAction,
        [action.op === 'rename' ? 'to' : 'path']: event.target.value } }),
      submit: () => this.submitFileAction(sid),
      cancel: () => this.setState({ fileAction: null, fileActionNotice: '' }) };
  }

  submitFileAction(sid) {
    const s = this.st(), action = s.fileAction;
    if (!action || action.sid !== sid || action.busy) return;
    const b = this.sess(sid, s);
    if (!b || !b.project) return;
    const valid = path => typeof path === 'string' && path.length > 0 && !path.startsWith('/')
      && path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\'));
    const destination = action.op === 'rename' ? action.to : action.path;
    if (!valid(destination) || (action.op === 'rename' && destination === action.path)) {
      this.setState({ fileActionNotice: 'Zadej platnou relativní cestu projektu.' }); return;
    }
    const stack = [], rows = (b.tree || []).map(row => { stack.length = row[0];
      const path = stack.concat([row[1]]).join('/'); stack.push(row[1]); return { path, dir: !!row[2], mark: row[3] }; });
    const exists = rows.some(row => row.path === destination);
    if (action.op !== 'delete' && exists) { this.setState({ fileActionNotice: 'Cíl už existuje.' }); return; }
    if (['rename', 'delete'].includes(action.op) && !rows.some(row => row.path === action.path)) return;
    const next = action.op === 'delete' ? rows.filter(row => row.path !== action.path && !row.path.startsWith(action.path + '/'))
      : action.op === 'rename' ? rows.map(row => ({ ...row, path: row.path === action.path ? destination
        : row.path.startsWith(action.path + '/') ? destination + row.path.slice(action.path.length) : row.path }))
        : rows.concat([{ path: destination, dir: action.op === 'create_directory', mark: 'A' }]);
    next.sort((a, b2) => a.path.localeCompare(b2.path));
    const tree = next.map(row => [row.path.split('/').length - 1, row.path.split('/').at(-1), row.dir ? 1 : 0, row.mark]);
    this.setState({ sessions: this.merge(s, 'sessions', { [sid]: { ...b, tree } }), fileAction: null,
      fileActionNotice: ({ create_file: 'Soubor vytvořen', create_directory: 'Složka vytvořena',
        rename: 'Položka přejmenována', delete: 'Položka smazána' })[action.op] + ' · ukázka provedena.' });
  }

  fileViewVM(sid, s, from) {
    const I = this.data().I;
    const fv = sid ? s.fileView[sid] : null;
    const off = { isOpen: false, path: '', name: '', dir: '', meta: '', modes: [], isPreview: false, isDiff: false, isEdit: false, lines: [], diff: [], hasDiff: false, noDiff: false, draft: '', setDraft: () => {}, editKey: () => {}, dirty: false, save: () => {}, discard: () => {}, back: () => {}, widen: () => {}, hasGuard: false, guardSave: () => {}, guardDiscard: () => {}, guardStay: () => {}, showFoot: false, stCls: '', stText: '', hasSt: false };
    if (!fv || fv.from !== from) return off;
    const path = fv.path;
    const k = this.fileKey(sid, s, path);
    const content = this.fileContent(sid, s, path);
    const draft = s.fileDraft[k] !== undefined ? s.fileDraft[k] : content;
    const dirty = draft !== content;
    const diff = this.fileDiff(sid, s, path);
    const mode = s.fileMode[sid] === 'diff' && !diff ? 'nahled' : (s.fileMode[sid] || 'nahled');
    const e = this.sessFiles(sid, s).edited.find((x) => x.path === path);
    const sp = this.splitPath(path);
    const n = content.split('\n').length;
    const setMode = (m) => () => this.setState({ fileMode: this.merge(this.st(), 'fileMode', { [sid]: m }) });
    return {
      isOpen: true, path, name: sp.name, dir: sp.dir,
      meta: n + (n === 1 ? ' řádek' : n <= 4 ? ' řádky' : ' řádků') + ' · UTF-8' + (e ? ' · +' + e.add + (e.del ? ' −' + e.del : '') : ''),
      hasSt: !!e, stText: e ? e.st : '', stCls: e ? (e.st === 'navrženo' ? 'warn' : e.st === 'zamítnuto' || e.st === 'nedokončeno' ? 'idle' : 'ok') : '',
      modes: [['nahled', 'Náhled', true], ['diff', 'Změny', !!diff], ['upravy', 'Upravit', true]].map((m) => ({ label: m[1], cls: (mode === m[0] ? 'on' : '') + (m[2] ? '' : ' off'), pick: m[2] ? setMode(m[0]) : () => {} })),
      isPreview: mode === 'nahled', isDiff: mode === 'diff', isEdit: mode === 'upravy',
      lines: content.split('\n').map((t, i) => ({ n: i + 1, t })),
      diff: (diff || []).map((l) => ({ o: l.o, n: l.n, sign: l.k === 'add' ? '+' : l.k === 'del' ? '−' : '', code: l.t, cls: l.k })), hasDiff: !!diff, noDiff: !diff,
      draft, dirty,
      setDraft: (ev) => this.setState({ fileDraft: this.merge(this.st(), 'fileDraft', { [k]: ev.target.value }) }),
      editKey: (ev) => { if (ev.key === 's' && (ev.ctrlKey || ev.metaKey)) { if (ev.preventDefault) ev.preventDefault(); const p = this.pSaveFile(this.st(), sid); if (p) this.setState(p); } },
      save: this.run((s2) => this.pSaveFile(s2, sid) || {}),
      discard: this.run((s2) => this.pDiscardFile(s2, sid) || {}),
      back: this.run((s2) => this.pOpenFile(s2, sid, null)),
      widen: () => { const s2 = this.st(); this.setState({ rightW: s2.rightW < 600 ? 680 : 400, rightPin: true }); },
      hasGuard: !!(s.fileGuard && s.fileGuard.sid === sid),
      guardSave: this.run((s2) => this.pResolveGuard(s2, 'save')), guardDiscard: this.run((s2) => this.pResolveGuard(s2, 'discard')), guardStay: this.run((s2) => this.pResolveGuard(s2, 'stay')),
      showFoot: mode === 'upravy'
    };
  }

  filesVM(sid, s) {
    const I = this.data().I;
    const b = sid ? this.sess(sid, s) : null;
    if (!b) return { edited: [], hasEdited: false, noEdited: true, opened: [], hasOpened: false, noOpened: true, tree: [], hasTree: false, noTree: true, treeTitle: 'Projekt', canManage: false, newFile: () => {}, newDirectory: () => {}, action: this.fileActionVM(sid, s), actionNotice: '', hasUncertain: false, refresh: () => {} };
    const f = this.sessFiles(sid, s);
    const open = (path, from, mode) => this.run((s2) => this.pOpenFile(s2, sid, { path, from, mode }));
    const edited = f.edited.map((e) => {
      const sp = this.splitPath(e.path);
      return { name: sp.name, dir: sp.dir, path: e.path, addText: e.add ? '+' + e.add : '', delText: e.del ? '−' + e.del : '', st: e.st, stCls: e.st === 'navrženo' ? 'warn' : e.st === 'zapisuje se' ? 'acc' : e.st === 'zamítnuto' || e.st === 'nedokončeno' ? 'idle' : 'ok', go: open(e.path, 'soubory', e.diff ? 'diff' : 'nahled') };
    });
    const opened = f.opened.map((o) => {
      const sp = this.splitPath(o.path);
      return { name: sp.name, dir: sp.dir, path: o.path, src: o.src, meta: o.meta, icon: o.attach ? I.clip : I.file, go: open(o.path, 'soubory', 'nahled') };
    });
    const p = b.project ? this.proj(b.project) : null;
    const tree = this.treeVM(sid, s, b);
    return { edited, hasEdited: edited.length > 0, noEdited: edited.length === 0, opened, hasOpened: opened.length > 0, noOpened: opened.length === 0, tree, hasTree: tree.length > 0, noTree: tree.length === 0, treeTitle: p ? 'Projekt ' + p.name : 'Projekt', canManage: !!b.project,
      newFile: () => this.startFileAction(sid, 'create_file'), newDirectory: () => this.startFileAction(sid, 'create_directory'),
      action: this.fileActionVM(sid, s), actionNotice: s.fileActionNotice || '', hasUncertain: false, refresh: () => {} };
  }

  // ---- Správa zdrojů (zadání 25. 9., bod 3) ----

  polLabel(v) { return { automatic: 'automaticky', ask: 'ptát se', disabled: 'zakázáno' }[v] || v; }

  focusGit(s, sid) {
    const b = sid ? this.sess(sid, s) : null;
    return b && b.project ? this.gitVM(s, b.project) : null;
  }

  gitVM(s, pid) {
    const d = this.data();
    const p = this.proj(pid);
    if (!d.GIT[pid] || !p) return null;
    const base = Object.assign({ branch: 'main', upstream: '', ahead: 0, behind: 0, fetched: '', remote: '', host: '', branches: ['main'], remoteBranches: [], changes: [], log: [], incoming: [] }, d.GIT[pid]);
    const st = s.scm[pid] || {};
    const repo = !!base.repo || !!st.inited;
    const out = { pid, projectName: p.name, repo, policy: base.policy, branches: [], remoteBranches: [], branch: '', all: [], staged: [], changes: [], untracked: [], conflicts: [], ahead: 0, behind: 0, upstream: '', log: [] };
    if (!repo) return out;
    const committed = st.committed || {};
    const ch = {};
    const put = (path, isNew, add, del) => { if (!committed[path]) ch[path] = { path, isNew, add, del }; };
    if (st.inited) {
      const stack = [];
      (p.tree || []).forEach((t) => { stack.length = t[0]; const path = stack.concat([t[1]]).join('/'); stack.push(t[1]); if (!t[2]) put(path, true, (d.FILES[path] || '').split('\n').length, 0); });
    }
    (base.changes || []).forEach((c) => put(c[0], c[1] === 'A', c[2], c[3]));
    const sids = Object.keys(d.S).concat(Object.keys(s.sessions));
    sids.forEach((sid) => {
      const b = this.sess(sid, s);
      if (!b || b.project !== pid) return;
      this.sessFiles(sid, s).edited.forEach((e) => { if (e.st === 'zapsáno' || e.st === 'uloženo ručně') put(e.path, e.isNew, e.add, e.del); });
    });
    const staged = st.staged || {};
    const all = Object.keys(ch).map((k) => Object.assign({ staged: !!staged[k] }, ch[k]));
    out.all = all;
    out.staged = all.filter((x) => x.staged);
    out.changes = all.filter((x) => !x.staged && !x.isNew);
    out.untracked = all.filter((x) => !x.staged && x.isNew);
    out.branch = st.branch || base.branch;
    out.branches = base.branches.concat(st.newBranches || []);
    out.remoteBranches = base.remoteBranches;
    out.upstream = out.branch === base.branch ? base.upstream : (base.remoteBranches.indexOf('origin/' + out.branch) >= 0 ? 'origin/' + out.branch : '');
    out.ahead = st.ahead !== undefined ? st.ahead : (out.branch === base.branch ? base.ahead : 0);
    out.behind = st.pulled ? 0 : (out.branch === base.branch ? base.behind : 0);
    out.fetched = st.fetched || base.fetched;
    out.remote = base.remote; out.host = base.host;
    out.log = (st.commits || []).concat(st.pulled ? base.incoming : []).concat(base.log);
    out.laneBranch = ((base.log.find((r) => r[0] === 'b') || [])[5] || [])[0] || '';
    out.baseBranch = base.branch;
    return out;
  }

  runningInProject(s, pid) {
    const d = this.data();
    return s.tabs.find((sid) => { const b = this.sess(sid, s); return b && b.project === pid && this.isRunning(sid, s); }) || null;
  }

  pScmCommit(s, pid, o) {
    const g = this.gitVM(s, pid);
    if (!g || !g.repo) return null;
    const st = s.scm[pid] || {};
    const msg = (st.msg || '').trim();
    const files = o.all ? g.all : g.staged;
    if (!msg) return { scm: this.merge(s, 'scm', { [pid]: Object.assign({}, st, { hint: 'Napiš zprávu commitu.' }) }) };
    if (!files.length) return { scm: this.merge(s, 'scm', { [pid]: Object.assign({}, st, { hint: g.all.length ? 'Nic není připravené. Připrav soubory tlačítkem + nebo zvol Potvrdit vše.' : 'Není co potvrdit.' }) }) };
    return { scmPlan: { pid, op: 'commit', files: files.map((f) => f.path), msg, push: !!o.push, all: !!o.all } };
  }

  planVM(s, g, fsid) {
    const I = this.data().I;
    const pl = s.scmPlan;
    const off = { has: false, title: '', rows: [], blocked: false, reason: '', run: () => {}, cancel: () => {}, runLabel: '', canRun: false };
    if (!pl || !g || pl.pid !== g.pid) return off;
    const pol = g.policy;
    const dirty = g.all.length;
    const remote = g.remote ? g.remote + ' · ' + g.host : '';
    let title = '', rows = [], reason = '', runLabel = 'Provést';
    const busy = this.runningInProject(s, g.pid);
    if (pl.op === 'commit') {
      title = pl.push ? 'git commit a push' : 'git commit';
      rows = [['Větev', g.branch, true], ['Soubory', this.filesWord(pl.files.length) + ' · ' + pl.files.slice(0, 3).join(', ') + (pl.files.length > 3 ? ' …' : ''), true], ['Zpráva', pl.msg.split('\n')[0]], ['Hooky', 'vypnuté (core.hooksPath=/dev/null)']];
      if (pl.push) rows.push(['Odeslat na', (g.upstream || 'bez upstreamu') + (remote ? ' · ' + g.host : ''), true]);
      if (pol.commit === 'disabled') reason = 'Politika projektu commit zakazuje.';
      else if (busy) reason = 'V projektu právě zapisuje agent (relace ' + (s.tabs.indexOf(busy) + 1) + '). Commit počká, až doběhne.';
      else if (pl.push && (pol.push === 'disabled' || !g.upstream)) reason = !g.upstream ? 'Větev nemá vzdálený protějšek, push nejde. Zvol jen Potvrdit.' : 'Politika projektu push zakazuje.';
      runLabel = pl.push ? 'Potvrdit a odeslat' : 'Potvrdit';
    } else if (pl.op === 'push') {
      title = 'git push';
      rows = [['Větev', g.branch + ' → ' + (g.upstream || '—'), true], ['Commity', String(g.ahead)], ['Hostitel', g.host || '—', true], ['Force', 'nikdy']];
      if (pol.push === 'disabled') reason = 'Politika projektu push zakazuje.';
      else if (!g.upstream) reason = 'Větev nemá vzdálený protějšek.';
      else if (!g.ahead) reason = 'Není co odeslat.';
      runLabel = 'Odeslat';
    } else if (pl.op === 'pull') {
      title = 'git pull --ff-only';
      rows = [['Větev', g.branch + ' ← ' + (g.upstream || '—'), true], ['Nové commity', String(g.behind)], ['Hostitel', g.host || '—', true]];
      if (pol.pull === 'disabled') reason = 'Politika projektu pull zakazuje.';
      else if (g.ahead && g.behind) reason = 'Historie se rozešla: ' + g.ahead + ' commit jen tady, ' + g.behind + ' jen na ' + g.upstream + '. Pull --ff-only to neumí; sluč větve ručně v terminálu relace.';
      else if (dirty) reason = 'Strom obsahuje nepotvrzené změny (' + this.filesWord(dirty) + '). Nejdřív je potvrď.';
      else if (busy) reason = 'V projektu právě pracuje agent (relace ' + (s.tabs.indexOf(busy) + 1) + ').';
      runLabel = 'Stáhnout';
    } else if (pl.op === 'fetch') {
      title = 'git fetch';
      rows = [['Vzdálený', remote || '—', true], ['Mění', 'jen vzdálené větve, pracovní strom ne']];
      if (pol.fetch === 'disabled') reason = 'Politika projektu síťový fetch zakazuje. Změníš ji v detailu projektu › Správa zdrojů.';
      else if (!g.remote) reason = 'Projekt nemá vzdálený repozitář.';
      runLabel = 'Načíst';
    } else if (pl.op === 'checkout') {
      title = 'git switch ' + pl.target;
      rows = [['Z větve', g.branch, true], ['Na větev', pl.target, true]];
      if (pol.branch === 'disabled') reason = 'Politika projektu přepínání větví zakazuje.';
      else if (dirty) reason = 'Strom obsahuje nepotvrzené změny (' + this.filesWord(dirty) + '). Nejdřív je potvrď – odložení (stash) verze 1.0 nemá.';
      runLabel = 'Přepnout';
    } else if (pl.op === 'branch') {
      title = 'git switch -c ' + pl.target;
      rows = [['Nová větev', pl.target, true], ['Z commitu', (g.log.find((r) => r[0] !== 'b') || ['', '—'])[1] + ' (' + g.branch + ')', true], ['Nepotvrzené změny', dirty ? 'přejdou do nové větve' : 'žádné']];
      if (pol.branch === 'disabled') reason = 'Politika projektu zakládání větví zakazuje.';
      else if (!/^[A-Za-z0-9._\/-]+$/.test(pl.target) || /\.\.|\/\/|^\/|\/$/.test(pl.target)) reason = 'Neplatný název větve (git check-ref-format).';
      else if (g.branches.indexOf(pl.target) >= 0) reason = 'Větev ' + pl.target + ' už existuje.';
      runLabel = 'Založit a přepnout';
    } else if (pl.op === 'init') {
      title = 'git init';
      rows = [['Složka', (this.proj(g.pid) || {}).path || '', true], ['Výchozí větev', 'main', true], ['První commit', 'ne – soubory zůstanou nesledované']];
      if (pol.init === 'disabled') reason = 'Politika projektu init zakazuje.';
      runLabel = 'Inicializovat';
    }
    return {
      has: true, title, rows: rows.map((r) => ({ k: r[0], v: r[1], cls: r[2] ? 'mono' : '' })), blocked: !!reason, reason, runLabel, canRun: !reason,
      run: reason ? () => {} : this.run((s2) => this.pScmRun(s2, fsid)),
      cancel: () => this.setState({ scmPlan: null })
    };
  }

  pScmRun(s, fsid) {
    const pl = s.scmPlan;
    if (!pl) return null;
    const g = this.gitVM(s, pl.pid);
    if (!g) return { scmPlan: null };
    const st = Object.assign({}, s.scm[pl.pid] || {});
    let line = '';
    if (pl.op === 'commit') {
      const committed = Object.assign({}, st.committed);
      pl.files.forEach((f) => { committed[f] = true; });
      const hash = (0x1000000 + (s.seq * 2654435761 >>> 0) % 0xefffff).toString(16).slice(-7);
      const lane = g.laneBranch && g.branch === g.laneBranch ? 'b' : 'o';
      st.commits = [[lane, hash, pl.msg.split('\n')[0], 'operátor', 'teď', []]].concat(st.commits || []);
      st.committed = committed; st.staged = {}; st.msg = ''; st.hint = '';
      st.ahead = pl.push && g.upstream ? 0 : g.ahead + 1;
      line = 'commit ' + hash + ' · ' + this.filesWord(pl.files.length) + (pl.push && g.upstream ? ' · odesláno na ' + g.upstream : '');
    } else if (pl.op === 'push') { st.ahead = 0; line = 'push ' + g.branch + ' → ' + g.upstream; }
    else if (pl.op === 'pull') { st.pulled = true; line = 'pull --ff-only · ' + g.behind + ' commity'; }
    else if (pl.op === 'fetch') { st.fetched = 'teď'; line = 'fetch ' + g.remote + ' · bez nových commitů'; }
    else if (pl.op === 'checkout') { st.branch = pl.target; st.ahead = undefined; line = 'switch ' + pl.target; }
    else if (pl.op === 'branch') { st.newBranches = (st.newBranches || []).concat([pl.target]); st.branch = pl.target; st.ahead = 0; line = 'switch -c ' + pl.target; }
    else if (pl.op === 'init') { st.inited = true; line = 'init · větev main'; }
    const p = { scm: this.merge(s, 'scm', { [pl.pid]: st }), scmPlan: null };
    if (fsid) p.auditX = this.merge(s, 'auditX', { [fsid]: [['teď', 'scm_' + pl.op, line]].concat(s.auditX[fsid] || []) });
    return p;
  }

  graphRows(g) {
    let open1 = false, seen0 = false;
    const headLane = g.laneBranch && g.branch === g.laneBranch ? 1 : 0;
    let headDone = false, baseDone = false, l0 = 0;
    return g.log.map((r, i) => {
      const lane = r[0] === 'b' ? 1 : 0;
      let p0 = '', p1 = '';
      if (lane === 1) { p1 = 'M21 ' + (open1 ? 0 : 13) + 'V26'; open1 = true; if (seen0) p0 = 'M9 0V26'; }
      else {
        p0 = 'M9 ' + (seen0 ? 0 : 13) + 'V26'; seen0 = true;
        if (r[0] === 'f') { if (open1) p1 = 'M21 0C21 8 9 6 9 13'; open1 = false; }
        else if (r[0] === 'm') { p1 = 'M9 13C9 20 21 18 21 26'; open1 = true; }
        else if (open1) p1 = 'M21 0V26';
      }
      const refs = [];
      if (!headDone && lane === headLane) { refs.push({ t: 'HEAD → ' + g.branch, cls: 'head' }); headDone = true; }
      if (lane === 0) {
        if (!baseDone && g.branch !== g.baseBranch) { refs.push({ t: g.baseBranch, cls: '' }); baseDone = true; }
        if (headLane === 0 && g.upstream && g.behind === 0 && l0 === g.ahead) refs.push({ t: g.upstream, cls: 'remote' });
        l0++;
      }
      (r[5] || []).forEach((x) => { if (!(headLane === 1 && x === g.branch)) refs.push({ t: x, cls: /^v\d/.test(x) ? 'tag' : '' }); });
      return { p0, p1, cx: lane ? 21 : 9, dc: lane ? 'var(--violet)' : 'var(--acct)', hash: r[1], s: r[2], who: r[3], when: r[4], refs, hasRefs: refs.length > 0, title: r[1] + ' · ' + r[3] + ' · ' + r[4] };
    });
  }

  scmVM(s, fsid) {
    const I = this.data().I;
    const b = fsid ? this.sess(fsid, s) : null;
    const off = { noProject: true, noRepo: false, isRepo: false, unavailable: false, unavailableText: 'Správa zdrojů zatím není připojená.', projectName: '', initText: '', init: () => {}, branch: '', branchMenu: () => {}, syncText: '', behind: 0, ahead: 0, syncTitle: '', sync: () => {}, syncCls: '', fetch: () => {}, sub: '', msg: '', setMsg: () => {}, msgKey: () => {}, commit: () => {}, commitCls: '', commitMenu: () => {}, hint: '', hasHint: false, groups: [], graph: [], plan: this.planVM(s, null, fsid), count: 0, clean: false };
    if (!b || !b.project) return off;
    const g = this.gitVM(s, b.project);
    if (!g) return off;
    const pid = g.pid;
    const st = s.scm[pid] || {};
    if (!g.repo) {
      return Object.assign({}, off, { noProject: false, noRepo: true, projectName: g.projectName,
        initText: 'Složka projektu zatím nemá repozitář git. Politika init: ' + this.polLabel(g.policy.init) + '.',
        init: () => this.setState({ scmPlan: { pid, op: 'init' } }), plan: this.planVM(s, g, fsid) });
    }
    const setSt = (patch) => { const s2 = this.st(); this.setState({ scm: this.merge(s2, 'scm', { [pid]: Object.assign({}, s2.scm[pid] || {}, patch) }) }); };
    const stage = (paths, on) => () => { const s2 = this.st(); const cur = Object.assign({}, (s2.scm[pid] || {}).staged); paths.forEach((x) => { if (on) cur[x] = true; else delete cur[x]; }); setSt({ staged: cur, hint: '' }); };
    const row = (f) => {
      const sp = this.splitPath(f.path);
      const x = f.staged ? (f.isNew ? 'A' : 'M') : (f.isNew ? 'U' : 'M');
      return { path: f.path, name: sp.name, dir: sp.dir, x, xCls: 'x-' + x, addText: f.add ? '+' + f.add : '', delText: f.del ? '−' + f.del : '',
        open: this.run((s2) => this.pOpenFile(s2, fsid, { path: f.path, from: 'scm', mode: this.fileDiff(fsid, s2, f.path) ? 'diff' : 'nahled' })),
        act: stage([f.path], !f.staged), actIcon: f.staged ? I.minus : I.plus, actLabel: f.staged ? 'Odebrat z připravených' : 'Připravit (stage)' };
    };
    const grp = (label, list, on, allLabel) => ({ label, n: list.length, rows: list.map(row), allIcon: on ? I.plus : I.minus, allLabel, all: stage(list.map((f) => f.path), on), has: list.length > 0 });
    const groups = [
      grp('Konflikty', g.conflicts, true, 'Připravit vše'),
      grp('Připravené', g.staged, false, 'Odebrat vše'),
      grp('Změny', g.changes, true, 'Připravit vše'),
      grp('Nesledované', g.untracked, true, 'Připravit vše')
    ].filter((x) => x.has);
    const canCommit = !!(st.msg || '').trim() && g.staged.length > 0;
    const sync = g.behind ? 'pull' : 'push';
    return {
      noProject: false, noRepo: false, isRepo: true, unavailable: false, unavailableText: '', projectName: g.projectName, initText: '', init: () => {},
      branch: g.branch, branchMenu: this.showCtx('branch', pid, 'left'),
      syncText: '↓' + g.behind + ' ↑' + g.ahead, behind: g.behind, ahead: g.ahead, syncCls: g.upstream ? '' : 'dis',
      syncTitle: g.upstream ? (g.behind ? 'Stáhnout ' + g.behind + ' commity z ' + g.upstream : g.ahead ? 'Odeslat ' + g.ahead + ' commit na ' + g.upstream : 'Synchronizováno s ' + g.upstream) : 'Větev nemá vzdálený protějšek',
      sync: g.upstream ? () => this.setState({ scmPlan: { pid, op: sync } }) : () => {},
      fetch: () => this.setState({ scmPlan: { pid, op: 'fetch' } }),
      sub: g.upstream ? g.remote + ' · ' + g.host + ' · fetch ' + (g.fetched || 'nikdy') + ' · pull ' + this.polLabel(g.policy.pull) : 'bez vzdáleného repozitáře · jen místní commity',
      msg: st.msg || '', setMsg: (ev) => setSt({ msg: ev.target.value, hint: '' }),
      msgKey: (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { if (ev.preventDefault) ev.preventDefault(); const p = this.pScmCommit(this.st(), pid, {}); if (p) this.setState(p); } },
      commit: this.run((s2) => this.pScmCommit(s2, pid, {})), commitCls: canCommit ? '' : 'soft',
      commitMenu: this.showCtx('commit', pid, 'right'),
      hint: st.hint || '', hasHint: !!st.hint,
      groups, clean: groups.length === 0, count: g.all.length,
      graph: this.graphRows(g),
      plan: this.planVM(s, g, fsid)
    };
  }

  menusVM(s, fsid) {
    const I = this.data().I;
    const fb = fsid ? this.sess(fsid, s) : null;
    const mode = fb ? (s.modes[fsid] || fb.mode) : 'kontrola';
    const pend = fb && fb.changes.length > 0 && this.sstate(fsid, s) === 'wait';
    const runningNow = fsid && this.isRunning(fsid, s);
    const it = (t, k, fn, o) => Object.assign({ t, k: k || '', go: this.run(fn || (() => ({}))), isItem: true, isSep: false, isHead: false, cls: '', hasIcon: false, icon: '' }, o || {});
    const dis = (t, k) => ({ t, k: k || '', go: () => {}, isItem: true, isSep: false, isHead: false, cls: 'dis', hasIcon: false, icon: '' });
    const sep = () => ({ t: '', k: '', go: () => {}, isItem: false, isSep: true, isHead: false, cls: '', hasIcon: false, icon: '' });
    const head = (t) => ({ t, k: '', go: () => {}, isItem: false, isSep: false, isHead: true, cls: '', hasIcon: false, icon: '' });
    const chk = (on) => (on ? { hasIcon: true, icon: I.check } : {});
    const rad = (on) => (on ? { hasIcon: true, icon: I.dotm } : {});
    const ic = (i) => ({ hasIcon: true, icon: i });
    const sessItems = s.tabs.map((sid, i) => it((i + 1) + ' · ' + this.sess(sid, s).short, 'Alt+' + (i + 1), (s2) => this.pFocusSession(s2, sid), chk(s.mode === 'sessions' && sid === fsid)));
    const nextSess = (dir) => (s2) => { const l = s2.tabs; if (!l.length) return null; const cur = l.indexOf(this.focusSid(s2)); const nx = l[(cur + dir + l.length) % l.length]; return this.pFocusSession(s2, nx); };
    const fs = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); } catch (e) {} return {}; };
    const defs = [
      ['soubor', 'Soubor', [
        it('Nová konverzace', 'Ctrl+N', (s2) => this.pNewSession(s2, {}), ic(I.plus)),
        it('Nový projekt…', '', (s2) => this.pGo(s2, 'projects'), ic(I.folder)),
        it('Otevřít projekt…', 'Ctrl+O', (s2) => this.pGo(s2, 'projects')),
        sep(),
        it('Importovat konverzaci…', '', null, ic(I.download)),
        it('Exportovat projekt…', ''),
        sep(),
        it('Nastavení', 'Ctrl+,', (s2) => this.pGo(s2, 'settings'), ic(I.gear)),
        it('Vzhled', '', (s2) => this.pSelect(s2, 'settings', 'vzhled'), ic(I.palette)),
        sep(),
        it('Ukončit', 'Ctrl+Q')
      ]],
      ['upravy', 'Úpravy', [
        dis('Zpět', 'Ctrl+Z'), dis('Znovu', 'Ctrl+Shift+Z'),
        sep(),
        it('Kopírovat poslední odpověď', 'Ctrl+Shift+C', null, ic(I.copy)),
        it('Vložit jako přílohu', '', null, ic(I.clip)),
        sep(),
        it('Najít v konverzaci', 'Ctrl+F', () => ({ palette: true, pq: '' }), ic(I.search)),
        it('Najít všude', 'Ctrl+Shift+F', () => ({ palette: true, pq: '' }))
      ]],
      ['zobrazeni', 'Zobrazení', [
        it('Paleta příkazů', 'Ctrl+K', () => ({ palette: true, pq: '' }), ic(I.search)),
        sep(),
        head('Panely'),
        it('Navigace', 'Ctrl+B', (s2) => ({ navOpen: !s2.navOpen, navPin: !s2.navOpen }), chk(s.navOpen)),
        it('Terminály relací', 'Ctrl+J', (s2) => ({ bottomOpen: !s2.bottomOpen }), chk(s.bottomOpen)),
        it('Pracovní plocha', 'Ctrl+Alt+B', (s2) => ({ rightOpen: !s2.rightOpen, rightPin: !s2.rightOpen }), chk(s.rightOpen)),
        sep(),
        head('Sloupce relací'),
        it('Jeden sloupec', 'Alt+Shift+1', (s2) => this.pSetCols(s2, 1), rad(s.cols === 1)),
        it('Dva sloupce', 'Alt+Shift+2', (s2) => this.pSetCols(s2, 2), rad(s.cols === 2)),
        it('Tři sloupce', 'Alt+Shift+3', (s2) => this.pSetCols(s2, 3), rad(s.cols === 3)),
        sep(),
        head('Katalogy'),
        it('Dlaždice', '', () => ({ view: 'dlazdice' }), rad(s.view === 'dlazdice')),
        it('Seznam', '', () => ({ view: 'seznam' }), rad(s.view === 'seznam')),
        sep(),
        it('Přiblížit', 'Ctrl++', (s2) => ({ scale: { '90': '100', '100': '110', '110': '125', '125': '125' }[s2.scale] })),
        it('Oddálit', 'Ctrl+-', (s2) => ({ scale: { '125': '110', '110': '100', '100': '90', '90': '90' }[s2.scale] })),
        it('Celá obrazovka', 'F11', fs)
      ]],
      ['relace', 'Relace', [
        it('Nová relace', 'Ctrl+T', (s2) => this.pNewSession(s2, {}), ic(I.plus)),
        fsid ? it('Zavřít relaci', 'Ctrl+W', (s2) => this.pCloseTab(s2, fsid)) : dis('Zavřít relaci', 'Ctrl+W'),
        sep(),
        it('Další relace', 'Ctrl+Tab', nextSess(1)),
        it('Předchozí relace', 'Ctrl+Shift+Tab', nextSess(-1)),
        sep(),
        head('Otevřené relace')
      ].concat(sessItems).concat([
        sep(),
        it('Zavřít nečinné relace', '', (s2) => { let cur = s2; let p = {}; s2.tabs.slice().forEach((sid) => { if (this.sstate(sid, cur) === 'idle' && sid !== this.focusSid(cur)) { const q = this.pCloseTab(cur, sid); p = Object.assign(p, q); cur = Object.assign({}, cur, q); } }); return p; })
      ])],
      ['agent', 'Agent', [
        runningNow ? it('Zastavit odpověď', 'Esc', (s2) => { const all = this.sess(fsid, s2).msgs.concat(s2.extra[fsid] || []); const stp = {}; all.forEach((m) => { if (m.running) stp[m.rid] = true; }); return { stopped: this.merge(s2, 'stopped', stp) }; }, ic(I.stop)) : dis('Zastavit odpověď', 'Esc'),
        it('Znovu vygenerovat', '', null, ic(I.refresh)),
        sep(),
        head('Režim úprav'),
        it('Auto – změny se zapíšou hned', '', (s2) => (fsid ? { modes: this.merge(s2, 'modes', { [fsid]: 'auto' }) } : null), rad(mode === 'auto')),
        it('Kontrola – změny čekají na schválení', '', (s2) => (fsid ? { modes: this.merge(s2, 'modes', { [fsid]: 'kontrola' }) } : null), rad(mode === 'kontrola')),
        sep(),
        it('Změnit model…', '', (s2) => this.pSelect(s2, 'settings', 'modely'), ic(I.cpu)),
        it('Změnit expertýzu…', '', (s2) => this.pGo(s2, 'expertises'), ic(I.cap)),
        sep(),
        pend ? it('Schválit změny', 'Ctrl+Enter', (s2) => this.pApprove(s2, fsid, 'ok'), ic(I.check)) : dis('Schválit změny', 'Ctrl+Enter'),
        pend ? it('Zamítnout změny', '', (s2) => this.pApprove(s2, fsid, 'no')) : dis('Zamítnout změny', '')
      ]],
      ['napoveda', 'Nápověda', [
        it('Klávesové zkratky', 'Ctrl+K Ctrl+S', () => ({ palette: true, pq: '' })),
        it('Dokumentace', '', null, ic(I.ext)),
        it('Stav backendu', '', (s2) => this.pSelect(s2, 'settings', 'about'), ic(I.info)),
        sep(),
        it('O aplikaci IntentSmith', '', (s2) => this.pSelect(s2, 'settings', 'about'))
      ]]
    ];
    return defs.map((m) => ({
      label: m[1], open: s.menu === m[0], cls: s.menu === m[0] ? 'on' : '', items: m[2],
      toggle: () => this.setState({ menu: this.st().menu === m[0] ? null : m[0], ctx: null }),
      enter: () => { const cur = this.st().menu; if (cur && cur !== m[0]) this.setState({ menu: m[0] }); }
    }));
  }

  ctxVM(s) {
    const I = this.data().I;
    const none = { hasCtx: false, ctxItems: [], ctxX: 0, ctxY: 0, ctxTitle: '', ctxHasQ: false, ctxQ: '', ctxCls: '' };
    if (!s.ctx) return none;
    const c = s.ctx;
    const base = { t: '', k: '', go: () => {}, isItem: false, isSep: false, isHead: false, cls: '', hasIcon: false, icon: '', hasNum: false, num: 0, numCls: '', hasDot: false, dot: '' };
    const it = (t, k, fn, o) => Object.assign({}, base, { t, k: k || '', go: this.run(fn || (() => ({}))), isItem: true }, o || {});
    const sep = () => Object.assign({}, base, { isSep: true });
    const head = (t) => Object.assign({}, base, { t, isHead: true });
    const ic = (i) => ({ hasIcon: true, icon: i });
    let items = [], title = '', hasQ = false, cls = '';
    if (c.sec === 'colpick') {
      const i = Number(c.id);
      const lay = this.colLayout(s);
      if (!(i >= 0 && i < lay.length)) return none;
      title = 'Relace ve sloupci ' + (i + 1);
      cls = 'picker';
      items = s.tabs.map((sid, n) => {
        const b = this.sess(sid, s);
        const st = this.sstate(sid, s);
        const j = lay.indexOf(sid);
        const where = j === i ? 'tady' : j >= 0 ? 'sloupec ' + (j + 1) + ' · vymění se' : this.stLabel(st);
        return it(b.short, where, (s2) => this.pPickInCol(s2, i, sid), { hasNum: true, num: n + 1, numCls: j === i ? 'focus' : j >= 0 ? 'vis' : '', hasDot: true, dot: st, cls: j === i ? 'cur' : '' });
      }).concat([sep(), it('Nová relace v tomto sloupci', 'Ctrl+T', (s2) => this.chain(s2, { focusCol: i }, (s3) => this.pNewSession(s3, {})), ic(I.plus))]);
      return { hasCtx: true, ctxItems: items, ctxX: c.x, ctxY: c.y, ctxTitle: title, ctxHasQ: false, ctxQ: '', ctxCls: cls };
    }
    if (c.sec === 'branch' || c.sec === 'commit') {
      const g = this.gitVM(s, c.id);
      if (!g) return none;
      if (c.sec === 'branch') {
        title = 'Větve · ' + g.projectName;
        hasQ = true;
        const q = (s.ctxQ || '').trim().toLowerCase();
        const match = (b) => !q || b.toLowerCase().indexOf(q) >= 0;
        const loc = g.branches.filter(match).map((b) => it(b, b === g.branch ? 'aktuální' : '', b === g.branch ? null : (s2) => ({ scmPlan: { pid: c.id, op: 'checkout', target: b } }), Object.assign(ic(b === g.branch ? I.check : I.branch), { cls: b === g.branch ? 'cur' : '' })));
        const rem = g.remoteBranches.filter(match).map((b) => it(b, 'vzdálená', (s2) => ({ scmPlan: { pid: c.id, op: 'checkout', target: b.replace(/^[^/]+\//, '') } }), ic(I.globe)));
        items = [head('Místní')].concat(loc.length ? loc : [it('Žádná shoda', '', null, { cls: 'dis', go: () => {} })]);
        if (rem.length) items = items.concat([head('Vzdálené')]).concat(rem);
        items = items.concat([sep(), it(q ? 'Nová větev „' + q + '“…' : 'Nová větev…', '', (s2) => ({ scmPlan: { pid: c.id, op: 'branch', target: q ? q.replace(/\s+/g, '-') : 'work/nova-vetev' } }), ic(I.plus))]);
      } else {
        title = 'Potvrdit změny';
        items = [
          it('Potvrdit (commit)', 'Ctrl+Enter', (s2) => this.pScmCommit(s2, c.id, {}), ic(I.commit)),
          it('Potvrdit a odeslat (push)', '', (s2) => this.pScmCommit(s2, c.id, { push: true }), ic(I.up)),
          sep(),
          it('Potvrdit vše včetně nepřipravených', '', (s2) => this.pScmCommit(s2, c.id, { all: true }), ic(I.check))
        ];
      }
      return { hasCtx: true, ctxItems: items, ctxX: c.x, ctxY: c.y, ctxTitle: title, ctxHasQ: hasQ, ctxQ: s.ctxQ || '', ctxCls: 'picker' };
    }
    const sessCtx = (sid) => [
      it('Přepnout na relaci', 'Enter', (s2) => this.pFocusSession(s2, sid), ic(I.chat)),
      it('Otevřít ve vedlejším sloupci', '', (s2) => this.pOpenBeside(s2, sid), ic(I.columns))
    ];
    if (c.sec === 'tab') {
      const sid = c.id;
      title = 'Relace ' + (s.tabs.indexOf(sid) + 1);
      items = sessCtx(sid).concat([
        sep(),
        it('Zavřít', 'Ctrl+W', (s2) => this.pCloseTab(s2, sid), ic(I.x)),
        it('Zavřít ostatní', '', (s2) => ({ tabs: [sid], colSids: [sid], cols: 1, focusCol: 0 })),
        it('Zavřít vpravo', '', (s2) => ({ tabs: s2.tabs.slice(0, s2.tabs.indexOf(sid) + 1) })),
        sep(),
        it(s.pinned[sid] ? 'Odepnout' : 'Připnout', '', (s2) => this.pTogglePinned(s2, sid), ic(I.pin))
      ]);
    } else {
      const sc = this.sec(c.sec);
      title = sc.label;
      if (c.sec === 'chats') {
        const open = s.tabs.indexOf(c.id) >= 0;
        items = open ? sessCtx(c.id) : [it('Otevřít jako relaci', 'Enter', (s2) => this.pOpenSession(s2, c.id), ic(I.chat)), it('Otevřít ve vedlejším sloupci', '', (s2) => this.pOpenBeside(s2, c.id), ic(I.columns))];
        items.push(it('Zobrazit detail', '', (s2) => this.pSelect(s2, 'chats', c.id), ic(I.info)));
      } else {
        items = [it('Zobrazit detail', 'Enter', (s2) => this.pSelect(s2, c.sec, c.id), ic(I.info))];
        if (c.sec === 'projects') items.push(it('Nová relace v projektu', '', (s2) => this.pNewSession(s2, { project: c.id }), ic(I.plus)));
        if (c.sec === 'specialists') items.push(it('Nová konverzace se specialistou', '', (s2) => this.pNewSession(s2, { specialist: c.id }), ic(I.plus)));
      }
      items = items.concat([sep(), it('Připnout', '', null, ic(I.pin)), it('Přejmenovat…', 'F2', null, ic(I.pen)), it('Duplikovat', '', null, ic(I.copy)), sep(), it('Archivovat', '', null, ic(I.archive)), it('Smazat…', 'Del', null, Object.assign(ic(I.trash), { cls: 'danger' }))]);
    }
    return { hasCtx: true, ctxItems: items, ctxX: c.x, ctxY: c.y, ctxTitle: title, ctxHasQ: false, ctxQ: '', ctxCls: '' };
  }

  palVM(s, fsid) {
    const I = this.data().I;
    const q = (s.pq || '').trim().toLowerCase();
    const fns = new Map();
    const mk = (t, sub, k, icon, fn) => { const o = { t, s: sub || '', k: k || '', icon, go: this.run(fn) }; fns.set(o, fn); return o; };
    const g = (label, items) => ({ label, items: items.filter((x) => !q || (x.t + ' ' + x.s).toLowerCase().indexOf(q) >= 0) });
    const nextStyle = () => { const l = this.styleList(); const i = l.findIndex((x) => x.id === s.style); return l[(i + 1) % l.length]; };
    const ns = nextStyle();
    const groups = [
      g('Otevřené relace', s.tabs.map((sid, i) => { const b = this.sess(sid, s); return mk((i + 1) + ' · ' + b.title, this.stLabel(this.sstate(sid, s)), 'Alt+' + (i + 1), this.kindIcon(b.kind), (s2) => this.pFocusSession(s2, sid)); })),
      g('Příkazy', [
        mk('Nová relace', '', 'Ctrl+T', I.plus, (s2) => this.pNewSession(s2, {})),
        mk('Jeden sloupec relací', '', 'Alt+Shift+1', I.columns, (s2) => this.pSetCols(s2, 1)),
        mk('Dva sloupce relací', '', 'Alt+Shift+2', I.columns, (s2) => this.pSetCols(s2, 2)),
        mk('Tři sloupce relací', '', 'Alt+Shift+3', I.columns, (s2) => this.pSetCols(s2, 3)),
        mk('Navigace – plná nebo ikony', '', 'Ctrl+B', I.pl, (s2) => ({ navOpen: !s2.navOpen, navPin: !s2.navOpen })),
        mk('Terminály relací', '', 'Ctrl+J', I.pb, (s2) => ({ bottomOpen: !s2.bottomOpen })),
        mk('Pracovní plocha', '', 'Ctrl+Alt+B', I.pr, (s2) => ({ rightOpen: !s2.rightOpen, rightPin: !s2.rightOpen })),
        mk('Nastavení vzhledu', 'styl, písmo, hustota', 'Ctrl+,', I.palette, (s2) => this.pSelect(s2, 'settings', 'vzhled')),
        mk('Další styl vzhledu', ns.name, '', I.palette, () => ({ style: ns.id })),
        mk('Změnit model', 'qwen3.5:27b', '', I.cpu, (s2) => this.pSelect(s2, 'settings', 'modely'))
      ]),
      g('Přejít na', this.sections().map((x) => mk(x.label, 'katalog', '', x.icon, (s2) => this.pGo(s2, x.id))))
    ].filter((x) => x.items.length > 0);
    const first = groups.length ? groups[0].items[0] : null;
    return {
      pal: groups, palEmpty: groups.length === 0,
      palKey: (e) => {
        if (e.key === 'Escape') { this.setState({ palette: false }); return; }
        if (e.key === 'Enter' && first) { if (e.preventDefault) e.preventDefault(); const s2 = this.st(); const p = fns.get(first)(s2); this.setState(Object.assign({ palette: false, menu: null, ctx: null }, p || {})); }
      }
    };
  }

  apVM(s, mode) {
    const styles = this.styleList();
    const cur = styles.find((t) => t.id === s.style) || styles[0];
    const seg = (key, opts) => opts.map((o) => ({ label: o[1], cls: s[key] === o[0] ? 'on' : '', pick: () => this.setState({ [key]: o[0] }) }));
    const CACC = [['#22c55e', 'Zelená'], ['#3b82f6', 'Modrá'], ['#8b5cf6', 'Fialová'], ['#ec4899', 'Růžová'], ['#f97316', 'Oranžová'], ['#ffffff', 'Bílá'], ['#ef4444', 'Červená'], ['#06b6d4', 'Tyrkysová']];
    const CBG = [[mode === 'light' ? '#f5f5f7' : '#0c0c0f', 'Výchozí'], ['#14141e', 'Antracit'], ['#0c1525', 'Noční modř']];
    const SW = { intentsmith: [['#09090b'], ['#141416'], ['#d4a85f']], studio: [['#8170ef'], ['#5aaafa'], ['#42dca3']], matrix: [['#00ff6a'], ['#020410'], ['#44aaff']], japanese: [['#dc2626'], ['#0a0406'], ['#fbbf24']], midnight: [['#60a5fa'], ['#060a18'], ['#a78bfa']], nocturne: [['#0f141a'], ['#141b23'], ['#e3a857']] };
    const NOTE = {
      intentsmith: 'IntentSmith používá vlastní zlatou a antracitovou paletu. Volba Téma stále přepíná tmavou a světlou variantu.',
      studio: 'Studio kombinuje chladné plochy, fialový akcent a modré i mátové stavové barvy. Ikony sekcí mají vlastní barvu.',
      matrix: 'Neonová zelená na tmavém skle, tapeta s kódem a strojové písmo Share Tech Mono.',
      japanese: 'Červená aurora na tmavém skle, písmo Zen Kaku Gothic Antique a nadpisy Yuji Boku.',
      midnight: 'Vesmírné sklo v noční modři, písmo Inter.',
      nocturne: 'Chladná modrošedá rodiny ShellSmith a SystemSmith s mosazným akcentem.'
    };
    const FONTS = [['brand', 'IntentSmith Sans', '"Plus Jakarta Sans",sans-serif'], ['inter', 'Inter', '"Inter",sans-serif'], ['system', 'Systémové', 'system-ui,sans-serif']];
    return {
      styleName: cur.name, isClean: cur.id === 'clean', notClean: cur.id !== 'clean', isPro: !!cur.pro, proNote: !!cur.pro, lightNote: cur.id === 'clean' && mode === 'light',
      tmodes: [['dark', 'Tmavé'], ['light', 'Světlé'], ['system', 'Systém']].map((o) => ({ label: o[1], cls: s.tmode === o[0] ? 'on' : '', pick: () => this.setState({ tmode: o[0] }) })),
      styles: styles.map((t) => ({ name: t.name, desc: t.desc, hasTag: !!t.pro, tag: 'tapeta', mcls: this.themeClass(t.id, t.pro ? 'dark' : mode) + ' ' + (t.pro ? 'dark' : mode), cls: t.id === cur.id ? 'on' : '', pressed: t.id === cur.id ? 'true' : 'false', pick: () => this.setState({ style: t.id }) })),
      ti: s.ti, ai: s.ai, b: s.bright, fs: s.fs, ta: s.ta, bd: s.bd, pa: s.pa,
      setTi: (e) => this.setState({ ti: Number(e.target.value) }),
      setAi: (e) => this.setState({ ai: Number(e.target.value) }),
      setB: (e) => this.setState({ bright: Number(e.target.value) }),
      setFs: (e) => this.setState({ fs: Number(e.target.value) }),
      setTa: (e) => this.setState({ ta: Number(e.target.value) }),
      setBd: (e) => this.setState({ bd: Number(e.target.value) }),
      setPa: (e) => this.setState({ pa: Number(e.target.value) }),
      fonts: FONTS.map((f) => ({ label: f[1], family: f[2], icon: this.data().I.type, mark: s.ff === f[0] ? 'vybráno' : '', cls: s.ff === f[0] ? 'sel' : '', pick: () => this.setState({ ff: f[0] }) })),
      caccs: CACC.map((c, i) => ({ hex: c[0], label: c[1], cls: s.cacc === i ? 'on' : '', pick: () => this.setState({ cacc: i }) })),
      caccHex: s.caccHex, setCaccHex: (e) => this.setState({ caccHex: e.target.value, cacc: 'custom' }),
      cbgs: CBG.map((c, i) => ({ hex: c[0], label: c[1], cls: s.cbg === i ? 'on' : '', pick: () => this.setState({ cbg: i }) })),
      cbgHex: s.cbgHex, setCbgHex: (e) => this.setState({ cbgHex: e.target.value, cbg: 'custom' }),
      swatches: (SW[cur.id] || []).map((x) => ({ hex: x[0] })), paletteNote: NOTE[cur.id] || '',
      densities: seg('density', [['komfortni', 'Komfortní'], ['kompaktni', 'Kompaktní'], ['minimalni', 'Minimální']]),
      scales: seg('scale', [['90', '90 %'], ['100', '100 %'], ['110', '110 %'], ['125', '125 %']]),
      seps: seg('sep', [['ramecky', 'Rámečky'], ['linky', 'Linky']]),
      colCls: s.col ? 'on' : '', colAria: s.col ? 'true' : 'false', toggleCol: () => this.setState({ col: !this.st().col }),
      css: s.css, setCss: (e) => this.setState({ css: e.target.value })
    };
  }

  drag(which) {
    return {
      down: (e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {}
        const s = this.st();
        const v = { nav: s.navW, right: s.rightW, bottom: s.bottomH, detail: s.detailW }[which];
        this._drag = { which, x: e.clientX, y: e.clientY, v };
      },
      move: (e) => {
        const d = this._drag;
        if (!d || d.which !== which) return;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (which === 'nav') this.setState({ navW: clamp(d.v + dx, 180, 440), navOpen: true });
        else if (which === 'right') this.setState({ rightW: clamp(d.v - dx, 280, 760) });
        else if (which === 'detail') this.setState({ detailW: clamp(d.v - dx, 340, 900) });
        else this.setState({ bottomH: clamp(d.v - dy, 90, 600) });
      },
      up: (e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (x) {}
        this._drag = null;
      }
    };
  }

  colDrag(i) {
    return {
      down: (e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {}
        const s = this.st();
        let width = 1000;
        try { width = e.currentTarget.parentElement.getBoundingClientRect().width || 1000; } catch (x) {}
        const n = this.colLayout(s).length;
        const fr = s.colFr.slice(0, n);
        this._cdrag = { i, x: e.clientX, fr, sum: fr.reduce((a, b) => a + b, 0), width };
      },
      move: (e) => {
        const d = this._cdrag;
        if (!d || d.i !== i) return;
        const delta = (e.clientX - d.x) / d.width * d.sum;
        const a = d.fr[i - 1] + delta, b = d.fr[i] - delta;
        if (a < 0.3 || b < 0.3) return;
        const fr = this.st().colFr.slice();
        fr[i - 1] = a; fr[i] = b;
        this.setState({ colFr: fr });
      },
      up: (e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (x) {}
        this._cdrag = null;
      },
      reset: () => this.setState({ colFr: [1, 1, 1] })
    };
  }

  renderVals() {
    const s = this.st();
    const d = this.data(), I = d.I;
    const style = this.styleList().find((t) => t.id === s.style) || this.styleList()[0];
    const mode = this.themeMode(s);
    const z = Number(s.scale) / 100;
    const winW = (typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1600) / z;
    const lay = this.colLayout(s);
    const fidx = this.focusIdx(s, lay);
    const fsid = lay.length ? lay[fidx] : null;
    const isSessions = s.mode !== 'section';
    const railW = Math.max(58, Math.min(86, Math.round(62 + (s.fs - 13) * 4)));
    const navFull = s.navOpen && (s.navPin || !(s.col && winW < 1100));
    const navWidth = navFull ? s.navW : railW;
    const rightTooNarrow = s.col && !s.rightPin && (winW - navWidth - s.rightW - 12) < Math.max(1, lay.length) * 360;
    const rightVis = isSessions && s.rightOpen && !rightTooNarrow;
    const cleanCls = style.id === 'clean' ? ' cacc-' + s.cacc + (mode === 'dark' ? ' cbg-' + s.cbg : '') : '';
    const rootCls = ['ide', this.themeClass(style.id, mode), mode, style.pro ? 'pro' : '', style.id === 'studio' ? 'toned' : '', 'ff-' + s.ff, 'fs-' + s.fs, 'ti-' + s.ti, 'ai-' + s.ai, 'pa-' + s.pa, 'ta-' + s.ta, 'bd-' + s.bd, 'den-' + s.density, 'sep-' + s.sep].filter(Boolean).join(' ') + cleanCls;
    const dyn = this.dynCss(s, mode);
    const dt = !isSessions ? this.detailVM(s) : null;
    const emptyDt = { icon: I.file, tone: 'none', icls: '', title: '', type: '', idText: '', hasStatus: false, status: '', stCls: '', hasPrimary: false, primaryLabel: '', onPrimary: () => {}, secondary: [], more: () => {}, hasTabs: false, tabs: [], hasDesc: false, desc: '', showProps: false, props: [], blocks: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null), hasRelated: false, related: [] };
    const colTpl = lay.map((x, i) => (i ? '4px ' : '') + 'minmax(0, ' + (s.colFr[i] || 1) + 'fr)').join(' ') || 'minmax(0, 1fr)';
    const nRun = s.tabs.filter((x) => this.sstate(x, s) === 'run').length;
    const nWait = s.tabs.filter((x) => this.sstate(x, s) === 'wait').length;
    const n = s.tabs.length;
    const sessWord = n === 1 ? '1 relace' : (n >= 2 && n <= 4 ? n + ' relace' : n + ' relací');
    const pal = this.palVM(s, fsid);
    const ctx = this.ctxVM(s);
    return {
      I,
      rootCls, rootW: 'calc(100vw / ' + z + ')', rootH: 'calc(100vh / ' + z + ')', zoom: String(z), filter: s.bright === 100 ? 'none' : 'brightness(' + (s.bright / 100).toFixed(2) + ')',
      hasDynCss: dyn.length > 0, dynCss: dyn,
      menuOpen: !!s.menu, closeMenus: () => this.setState({ menu: null }),
      menus: this.menusVM(s, fsid),
      openPalette: () => this.setState({ palette: true, pq: '', menu: null, ctx: null }),
      closePalette: () => this.setState({ palette: false }),
      palette: !!s.palette, pq: s.pq, setPq: (e) => this.setState({ pq: e.target.value }),
      pal: pal.pal, palEmpty: pal.palEmpty, palKey: pal.palKey,
      hasCtx: ctx.hasCtx, ctxItems: ctx.ctxItems, ctxX: ctx.ctxX, ctxY: ctx.ctxY, ctxTitle: ctx.ctxTitle, ctxHasQ: ctx.ctxHasQ, ctxQ: ctx.ctxQ, ctxCls: ctx.ctxCls, setCtxQ: (e) => this.setState({ ctxQ: e.target.value }), closeCtx: (e) => { if (e && e.preventDefault) e.preventDefault(); this.setState({ ctx: null }); },
      tbar: {
        tilesCls: s.view === 'dlazdice' ? 'on' : '', listCls: s.view === 'seznam' ? 'on' : '',
        showTiles: () => this.setState({ view: 'dlazdice' }), showList: () => this.setState({ view: 'seznam' }),
        viewDim: isSessions ? 'dimmed' : '', colDim: isSessions ? '' : 'dimmed',
        cols: [1, 2, 3].map((k) => ({ n: String(k), label: k === 1 ? 'Jedna relace' : k === 2 ? 'Dvě relace vedle sebe' : 'Tři relace vedle sebe', cls: isSessions && s.cols === k ? 'on' : '', pick: this.run((s2) => this.pSetCols(s2, k)) })),
        navCls: navFull ? 'on' : '', bottomCls: s.bottomOpen ? 'on' : '', rightCls: rightVis ? 'on' : ''
      },
      toggleNav: () => (navFull ? this.setState({ navOpen: false, navPin: false }) : this.setState({ navOpen: true, navPin: true })),
      toggleBottom: () => this.setState({ bottomOpen: !this.st().bottomOpen }),
      toggleRight: () => { const s2 = this.st(); if (rightVis) this.setState({ rightOpen: false, rightPin: false }); else this.setState({ rightOpen: true, rightPin: true, mode: 'sessions' }); },
      fullscreen: () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} },
      mainCols: navWidth + 'px ' + (navFull ? 4 : 0) + 'px minmax(0, 1fr) ' + (rightVis ? 4 : 0) + 'px ' + (rightVis ? s.rightW : 0) + 'px',
      dragNav: this.drag('nav'), dragRight: this.drag('right'), dragBottom: this.drag('bottom'), dragDetail: this.drag('detail'),
      navFull, navRail: !navFull,
      nav: this.navVM(s, lay, fsid),
      navSet: { cls: !isSessions && s.section === 'settings' ? 'on' : '', go: this.run((s2) => this.pGo(s2, 'settings')) },
      tabs: this.tabsVM(s, lay, fsid), newSession: this.run((s2) => this.pNewSession(s2, {})),
      isSessions, isSection: !isSessions, secLabel: this.sec(s.section).label,
      columns: isSessions ? this.columnsVM(s, lay, fidx) : [], colTpl, noSessions: isSessions && lay.length === 0,
      sectCols: dt ? 'minmax(0, 1fr) 4px ' + s.detailW + 'px' : 'minmax(0, 1fr) 0px 0px',
      cg: this.catalogVM(s), q: s.q, setQ: (e) => this.setState({ q: e.target.value }),
      size: s.size, setSize: (e) => this.setState({ size: Number(e.target.value) }),
      hasDetail: !!dt, noDetail: false, dt: dt || emptyDt,
      closeDetail: () => { const s2 = this.st(); this.setState({ detail: this.merge(s2, 'detail', { [s2.section]: null }) }); },
      ap: this.apVM(s, mode),
      ws: this.wsVM(s, fsid),
      sb: { sessions: sessWord + ' · ' + nRun + ' pracuje · ' + nWait + ' čeká', ctx: fsid ? this.ctxOf(fsid, s) : 0, connection: 'Připojeno', dot: 'ok', backend: 'backend 136.1.0', ws: 'ws :3335', db: 'DB 134 MiB', gpu: 'GPU 18,3 / 24,0 GiB · 57 °C' }
    };
  }
}
