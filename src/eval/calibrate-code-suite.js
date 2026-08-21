#!/usr/bin/env node
// Calibrate Code Suite — rozdělí úlohy na aktivní a rezervní podle toho, co měří
// ══════════════════════════════════════════════════════════════════════════════
//
//     node src/eval/discrimination-report.js <modely…> --json /tmp/panel.json
//     node src/eval/calibrate-code-suite.js /tmp/panel.json
//
// Proč zvláštní krok:
//
// Úloha, na které dopadnou všechny modely stejně, do rozhodování nic nepřináší —
// a průměr přes sadu to schová.  Přesně tím trpěla stará sada `code`: osm z 36
// úloh dávalo 100 % komukoli včetně vision modelu, takže souboj kvalitních
// modelů končil nerozhodně.
//
// Kalibrace proto úlohu **nezahazuje, ale zařadí**:
//
//   active            modely se na ní liší → tvoří běžnou sadu
//   reserve-floor     nevyřešil ji nikdo → rezerva pro silnější modely
//   reserve-ceiling   vyřešili ji všichni → dnes bez informace
//   reserve-unstable  kolísá víc, než činí rozdíl mezi modely → vada měření
//   reserve-flat      všichni stejně někde uprostřed
//
// Rezervy se **nemažou**.  Úloha, kterou dnes nevyřeší nikdo, je přesně to, čím
// půjde zítra odlišit lepší model od dnešního nejlepšího; vyhodit ji znamená
// připravit sadu o strop.  A úloha označená `reserve-unstable` je úkol pro
// opravu metriky, ne odpad.
//
// Kalibrace je vždycky vázaná na panel, na kterém proběhla — proto se do
// fixture zapisuje i seznam modelů a datum.  Se změnou panelu je potřeba
// zopakovat ji, jinak sada měří včerejší pole kandidátů.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_PATH } from './build-code-suite.js';

const VERDICT_TO_STATUS = {
  'rozlišuje': 'active',
  'podlaha': 'reserve-floor',
  'strop': 'reserve-ceiling',
  'nestabilní': 'reserve-unstable',
  'shodné': 'reserve-flat',
};

/** Název úlohy v reportu (`patch_<hash8>`) zpátky na hash z fixture. */
function matchesTask(taskName, entryHash) {
  return taskName === `patch_${entryHash.slice(0, 8)}`;
}

export function calibrate(fixture, measurement) {
  const tasks = fixture.tasks.map(entry => {
    const measured = measurement.tasks.find(t => matchesTask(t.name, entry.hash));
    if (!measured) return { ...entry, status: entry.status ?? 'active', calibration: null };
    return {
      ...entry,
      status: VERDICT_TO_STATUS[measured.verdict] || 'active',
      calibration: {
        verdict: measured.verdict,
        values: measured.values,
        noise: measured.noise,
      },
    };
  });

  return {
    ...fixture,
    calibratedAt: measurement.measuredAt,
    calibrationPanel: measurement.models,
    calibrationRepeats: measurement.repeats,
    tasks,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const measurementPath = process.argv[2];
  if (!measurementPath) {
    console.error('použití: node src/eval/calibrate-code-suite.js <panel.json>');
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const measurement = JSON.parse(readFileSync(measurementPath, 'utf8'));
  const out = calibrate(fixture, measurement);

  writeFileSync(FIXTURE_PATH, JSON.stringify(out, null, 2) + '\n');

  const counts = {};
  for (const t of out.tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  console.log(`panel: ${out.calibrationPanel.join(', ')}`);
  console.log(`opakování: ${out.calibrationRepeats}\n`);
  for (const t of out.tasks) {
    console.log(`  ${t.hash.slice(0, 8)}  ${(t.status || '').padEnd(17)}`
      + `${t.calibration ? t.calibration.values.map(v => v.toFixed(2)).join(' ') : '(neměřeno)'}`);
  }
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
  const active = counts.active || 0;
  console.log(`\naktivní sada: ${active} úloh — všechny rozlišují`);
  if (!active) console.log('VAROVÁNÍ: žádná úloha nerozlišuje, sada by nic neměřila');
}

export default { calibrate };
