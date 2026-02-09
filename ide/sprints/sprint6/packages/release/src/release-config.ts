/**
 * @c3/release — Electron Packaging Configuration
 *
 * Packaging targets:
 *   Linux:   .AppImage, .deb (MVP)
 *   Windows: .exe installer (future)
 *   macOS:   .dmg (future)
 *
 * Auto-update: electron-updater with GitHub Releases
 *
 * Build command:
 *   yarn electron build
 *
 * Release checklist:
 *   ✅ All panels functional
 *   ✅ Backend connection stable
 *   ✅ Project persistence survives restart
 *   ✅ ShellTool sandbox secure
 *   ✅ Export/Import works
 *   ✅ Performance < 3s startup
 *   ✅ Error recovery works
 *   ✅ Documentation complete
 */

// ─── electron-builder.json ───────────────────────────────

export const ELECTRON_BUILDER_CONFIG = {
  productName: 'C3 Studio',
  appId: 'com.c3.studio',
  copyright: 'Copyright © 2026',

  directories: {
    output: 'dist',
    buildResources: 'resources',
  },

  files: [
    'lib/**/*',
    'src-gen/**/*',
    'node_modules/**/*',
    'package.json',
  ],

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Development',
    icon: 'resources/icons',
    desktop: {
      Name: 'C3 Studio',
      Comment: 'AI-powered IDE for C3 Agent',
      Categories: 'Development;IDE;',
      StartupWMClass: 'c3-studio',
    },
  },

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: 'resources/icons/icon.ico',
  },

  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
    ],
    icon: 'resources/icons/icon.icns',
    category: 'public.app-category.developer-tools',
  },

  publish: {
    provider: 'generic',
    url: 'https://releases.c3studio.dev',
  },

  // Auto-update
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
};

// ─── Release Checklist ───────────────────────────────────

export interface ReleaseCheckItem {
  id: string;
  label: string;
  category: 'functional' | 'security' | 'performance' | 'docs';
  automated: boolean;
  testCommand?: string;
}

export const RELEASE_CHECKLIST: ReleaseCheckItem[] = [
  // Functional
  {
    id: 'panels-functional',
    label: 'Všechny panely fungují (Chat, Agent Log, Design, Review, Search, Token)',
    category: 'functional',
    automated: false,
  },
  {
    id: 'backend-stable',
    label: 'Backend connection je stabilní (10 min bez drops)',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:stability',
  },
  {
    id: 'persistence',
    label: 'Project persistence přežije restart',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:persistence',
  },
  {
    id: 'export-import',
    label: 'Export/Import funguje (zip round-trip)',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:export',
  },
  {
    id: 'multi-project',
    label: 'Multi-project switcher funguje',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:multiproject',
  },
  {
    id: 'diff-review',
    label: 'Diff review → Accept → auto-commit pipeline',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:review',
  },
  {
    id: 'error-recovery',
    label: 'Error recovery funguje (disconnect, crash, LLM timeout)',
    category: 'functional',
    automated: true,
    testCommand: 'yarn test:recovery',
  },

  // Security
  {
    id: 'shell-sandbox',
    label: 'ShellTool sandbox je bezpečný (7-layer test)',
    category: 'security',
    automated: true,
    testCommand: 'yarn test:security',
  },
  {
    id: 'ws-auth',
    label: 'WebSocket auth (local-only, session token)',
    category: 'security',
    automated: true,
    testCommand: 'yarn test:ws-security',
  },

  // Performance
  {
    id: 'startup-time',
    label: 'Startup < 3s na studeném startu',
    category: 'performance',
    automated: true,
    testCommand: 'yarn test:perf:startup',
  },
  {
    id: 'chat-render',
    label: 'Chat response rendering < 50ms',
    category: 'performance',
    automated: true,
    testCommand: 'yarn test:perf:chat',
  },
  {
    id: 'agent-event',
    label: 'Agent log event < 10ms',
    category: 'performance',
    automated: true,
    testCommand: 'yarn test:perf:agent',
  },

  // Documentation
  {
    id: 'readme',
    label: 'README.md s instalací a quick start',
    category: 'docs',
    automated: false,
  },
  {
    id: 'architecture',
    label: 'Architecture doc (panely, WS protocol, security model)',
    category: 'docs',
    automated: false,
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard shortcuts reference',
    category: 'docs',
    automated: false,
  },
];

// ─── Performance Targets ─────────────────────────────────

export const PERFORMANCE_TARGETS = {
  startupColdMs: 3000,
  chatRenderMs: 50,
  agentEventMs: 10,
  fileTreeRefreshMs: 200,
  diffOpenMs: 500,
  searchQueryMs: 100,
};

// ─── Theia Application Config ────────────────────────────

export const THEIA_APP_CONFIG = {
  applicationName: 'C3 Studio',
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  electron: {
    windowOptions: {
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: 'C3 Studio',
    },
  },
  // Disable unwanted Theia features
  preferences: {
    'workbench.statusBar.visible': true,
    'editor.minimap.enabled': false,
    'files.autoSave': 'off',
  },
};
