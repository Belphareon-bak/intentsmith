/**
 * IntentSmith Studio esbuild entrypoints for Theia 1.76.0.
 * Generated gen-esbuild.* files are refreshed by theia build; this tracked
 * file fails if their shape changes before injecting security-critical entries.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';

function replaceEntry(options, key, expected, replacement) {
    if (options.entryPoints?.[key] !== expected) {
        throw new Error(`Theia ${key} entry changed; review IntentSmith build boundary`);
    }
    options.entryPoints[key] = replacement;
}

replaceEntry(browserOptions, 'bundle', './src-gen/frontend/index.js', './intentsmith-browser-entry.js');
replaceEntry(nodeOptions, 'electron-main', './src-gen/backend/electron-main', './intentsmith-electron-main-entry.js');
replaceEntry(electronOptions, 'preload', './src-gen/frontend/preload', './intentsmith-preload-entry.js');

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
