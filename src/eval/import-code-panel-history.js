#!/usr/bin/env node
// Historical calibration panels carry means/task names, but no original
// grading-runtime contract or exact artifact provenance. They remain useful
// diagnostic inputs to calibrate-code-suite.js. Assigning today's CODE contract
// and today's installed artifact to them would fabricate current measurements.
// Refuse before importing DB/provider modules, opening files or querying models.
console.error('CODE_PANEL_HISTORY_PROVENANCE_REQUIRED: Historický kalibrační panel nelze převést na aktuální CODE COMPLETE. Chybí původní kontrakt graderu a přesná identita měřeného artefaktu. Použijte standardní měření pro aktuální kontrakt; původní reporty a historie zůstávají zachované.');
process.exitCode = 1;
