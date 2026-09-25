/**
 * IntentSmith Studio esbuild entrypoints for Theia 1.76.0.
 * Generated gen-esbuild.* files are refreshed by theia build; this tracked
 * file fails if their shape changes before injecting security-critical entries.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function replaceEntry(options, key, expected, replacement) {
    if (options.entryPoints?.[key] !== expected) {
        throw new Error(`Theia ${key} entry changed; review IntentSmith build boundary`);
    }
    options.entryPoints[key] = replacement;
}

replaceEntry(browserOptions, 'bundle', './src-gen/frontend/index.js', './intentsmith-browser-entry.js');
replaceEntry(nodeOptions, 'electron-main', './src-gen/backend/electron-main', './intentsmith-electron-main-entry.js');
replaceEntry(electronOptions, 'preload', './src-gen/frontend/preload', './intentsmith-preload-entry.js');

// The generated frontend loads every extension by default. The classic module
// starts transport and event listeners at require-time, so the mode guard must
// wrap the require itself, before either UI can run. Fail if Theia changes the
// generated entry shape instead of silently loading both interfaces.
const classicModules = Object.freeze([
    '@intentsmith/chat-panel/lib/browser/chat-panel-module',
    '@intentsmith/agent-panel/lib/browser/agent-panel-module',
    '@intentsmith/status-widget/lib/browser/status-widget-module',
    '@intentsmith/command-palette/lib/browser/command-palette-module',
    '@intentsmith/context-menu/lib/browser/context-menu-module',
    '@intentsmith/design-viewer/lib/browser/design-viewer-module',
    '@intentsmith/keybindings/lib/browser/keybindings-module',
    '@intentsmith/notifications/lib/browser/notification-module',
    '@intentsmith/diff-viewer/lib/browser/diff-viewer-module',
    '@intentsmith/review-panel/lib/browser/review-panel-module',
    '@intentsmith/onboarding/lib/browser/onboarding-module',
    '@intentsmith/settings/lib/browser/settings-module',
    '@intentsmith/chat-search/lib/browser/chat-search-module',
    '@intentsmith/multi-project/lib/browser/multi-project-module',
    '@intentsmith/token-dashboard/lib/browser/token-dashboard-module',
    '@intentsmith-ide/intentsmith-center-views/lib/browser/center-views-module',
    '@intentsmith-ide/intentsmith-detail-panel/lib/browser/detail-panel-module',
]);
const studio2Module = '@intentsmith-ide/intentsmith-studio2/lib/browser/studio2-module';
const modeModule = '@intentsmith-ide/intentsmith-studio2/lib/browser/studio-mode-module';
function gateFrontendModule(source, specifier, condition) {
    const call = `await load(container, require('${specifier}'));`;
    if (source.split(call).length !== 2) {
        throw new Error(`Theia frontend load changed for ${specifier}; review Studio UI mode gate`);
    }
    return source.replace(call, `if (${condition}) ${call}`);
}
function gateFrontend(source) {
    const modeCall = `await load(container, require('${modeModule}'));`;
    if (source.split(modeCall).length !== 2) {
        throw new Error('Theia frontend mode switch load changed; review Studio UI mode gate');
    }
    for (const specifier of classicModules) {
        source = gateFrontendModule(source, specifier, "window.__intentsmithStudioMode === 'classic'");
    }
    return gateFrontendModule(source, studio2Module, "window.__intentsmithStudioMode === 'studio2'");
}
browserOptions.plugins.unshift({
    name: 'intentsmith-exclusive-studio-ui',
    setup(build) {
        build.onLoad({ filter: /[\\/]src-gen[\\/]frontend[\\/]index\.js$/ }, async args => ({
            contents: gateFrontend(await readFile(args.path, 'utf8')),
            loader: 'js',
            resolveDir: path.dirname(args.path),
        }));
    },
});

const contexts = [
    await esbuild.context(browserOptions),
    await esbuild.context(nodeOptions),
    await esbuild.context(electronOptions),
];

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
} else {
    try {
        for (const context of contexts) await context.rebuild();
    } finally {
        await Promise.all(contexts.map(context => context.dispose()));
    }
}
