#!/usr/bin/env node

import { runStudio2ExclusiveUiJourney } from './studio-electron-boundary.e2e.js';

process.umask(0o077);
await runStudio2ExclusiveUiJourney();
