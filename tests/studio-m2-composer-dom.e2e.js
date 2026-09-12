#!/usr/bin/env node

// Separate visual DOM scenario. Ordinary M0/M1 runners remain non-visual.
import { runStudioM2ComposerDomJourney } from './studio-electron-boundary.e2e.js';

process.umask(0o077);
await runStudioM2ComposerDomJourney();
