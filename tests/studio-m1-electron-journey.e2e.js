#!/usr/bin/env node

import { runStudioM1ElectronJourney } from './studio-electron-boundary.e2e.js';

process.umask(0o077);
await runStudioM1ElectronJourney();
