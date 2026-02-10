#!/usr/bin/env node
// C3 Studio — Electron launcher
// Ensures ELECTRON_RUN_AS_NODE is unset before launching the Electron binary.
// This is needed when launching from VS Code terminal or other Electron-based apps.

const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const appPath = path.resolve(__dirname, '..');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = [appPath, ...process.argv.slice(2)];

console.log('[C3 Launcher] Electron:', electronPath);
console.log('[C3 Launcher] App:', appPath);
console.log('[C3 Launcher] DISPLAY:', env.DISPLAY || '(not set)');

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('Electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

const handleSignal = (signal) => {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
};

handleSignal('SIGINT');
handleSignal('SIGTERM');
