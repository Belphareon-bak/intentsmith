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
import { codeTaskName, FIXTURE_PATH } from './build-code-suite.js';
import { classifyTask } from './discrimination-report.js';

const VERDICT_TO_STATUS = {
  'rozlišuje': 'active',
  'podlaha': 'reserve-floor',
  'strop': 'reserve-ceiling',
  'nestabilní': 'reserve-unstable',
  'shodné': 'reserve-flat',
};

/** Název úlohy v reportu zpátky na její plný kontrakt ve fixture. */
function matchesTask(taskName, entry) {
  return taskName === codeTaskName(entry);
}

export function calibrate(fixture, measurement) {
  if (measurement?.invalidated) {
    throw new Error(`calibration report is invalidated: ${measurement.invalidReason || 'unspecified reason'}`);
  }
  const tasks = fixture.tasks.map(entry => {
    const measured = measurement.tasks.find(t => matchesTask(t.name, entry));
    // Inkrementální rozšíření panelu měří jen nové pending úlohy. Již doložená
    // kalibrace stejného fingerprintu se při takovém běhu nesmí zahodit.
    if (!measured) {
      if (entry.calibration && entry.status && entry.status !== 'pending-recalibration') return entry;
      return { ...entry, status: 'pending-recalibration', calibration: null };
    }
    return {
      ...entry,
      status: VERDICT_TO_STATUS[measured.verdict] || 'pending-recalibration',
      calibration: {
        verdict: measured.verdict,
        values: measured.values,
        noise: measured.noise,
        panel: measurement.models,
        repeats: measurement.repeats,
        measuredAt: measurement.measuredAt,
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

/**
 * Vymění člena panelu bez opakování exact-task měření nezměněných modelů.
 * Nové reporty mají přednost; chybějící model lze doplnit pouze z kalibrace
 * stejného task fingerprintu. Jakákoli neúplnost nechá úlohu fail-closed jako
 * pending-recalibration.
 */
export function rebaseCalibrationPanel(fixture, measurements, models) {
  const reports = Array.isArray(measurements) ? measurements : [measurements];
  const invalid = reports.find(report => report?.invalidated);
  if (invalid) throw new Error(`panel report is invalidated: ${invalid.invalidReason || 'unspecified reason'}`);
  if (!Array.isArray(models) || models.length < 2 || new Set(models).size !== models.length) {
    throw new Error('rebase panel vyžaduje nejméně dva unikátní modely');
  }

  const reportValue = (name, model) => {
    for (let i = reports.length - 1; i >= 0; i--) {
      const report = reports[i];
      const modelIndex = report?.models?.indexOf(model) ?? -1;
      const task = report?.tasks?.find(item => item.name === name);
      const value = task?.values?.[modelIndex];
      if (modelIndex >= 0 && Number.isFinite(value)) return {
        value, noise: Number(task.noise) || 0,
        repeats: Number(report.repeats) || 1,
        measuredAt: report.measuredAt || null,
        source: 'new-report',
      };
    }
    return null;
  };

  const tasks = fixture.tasks.map(entry => {
    const name = codeTaskName(entry);
    const oldPanel = entry.calibration?.panel || [];
    const values = [];
    const evidence = [];
    const noises = [];
    const repeats = [];
    let complete = true;

    for (const model of models) {
      let measured = reportValue(name, model);
      if (!measured) {
        const oldIndex = oldPanel.indexOf(model);
        const oldValue = entry.calibration?.values?.[oldIndex];
        if (oldIndex >= 0 && Number.isFinite(oldValue)) measured = {
          value: oldValue,
          noise: Number(entry.calibration?.noise) || 0,
          repeats: Number(entry.calibration?.repeats) || 1,
          measuredAt: entry.calibration?.measuredAt || null,
          source: 'prior-exact-task',
        };
      }
      if (!measured) { complete = false; break; }
      values.push(measured.value);
      noises.push(measured.noise);
      repeats.push(measured.repeats);
      evidence.push({ model, source: measured.source, measuredAt: measured.measuredAt });
    }

    if (!complete) return {
      ...entry,
      status: 'pending-recalibration',
      calibration: null,
      recalibrationReason: `neúplný panel ${models.join(', ')}`,
    };

    const noise = Math.max(0, ...noises);
    const verdict = classifyTask(values, noise);
    return {
      ...entry,
      status: VERDICT_TO_STATUS[verdict] || 'pending-recalibration',
      calibration: {
        verdict,
        values,
        noise,
        panel: models,
        repeats: Math.max(...repeats),
        measuredAt: evidence.map(item => item.measuredAt).filter(Boolean).sort().at(-1) || null,
        modelEvidence: evidence,
      },
      recalibrationReason: undefined,
    };
  });
  const measuredAt = reports.map(report => report?.measuredAt).filter(Boolean).sort().at(-1)
    || fixture.calibratedAt || null;
  return {
    ...fixture,
    calibratedAt: measuredAt,
    calibrationPanel: models,
    calibrationRepeats: Math.max(1, ...reports.map(report => Number(report?.repeats) || 1)),
    tasks,
  };
}

export function buildPanelSummaries(fixture, measurements) {
  const reports = Array.isArray(measurements) ? measurements : [measurements];
  const invalid = reports.find(report => report?.invalidated);
  if (invalid) {
    throw new Error(`panel report is invalidated: ${invalid.invalidReason || 'unspecified reason'}`);
  }
  const active = (fixture?.tasks || [])
    .filter(task => task.status === 'active')
    .map(codeTaskName);
  if (!active.length) return [];
  const models = [...new Set(reports.flatMap(report => report?.models || []))];
  for (const task of fixture?.tasks || []) {
    if (task.status !== 'active') continue;
    for (const model of task.calibration?.panel || []) {
      if (!models.includes(model)) models.push(model);
    }
  }
  return models.map((model) => {
    const tasks = active.map((name) => {
      const report = [...reports].reverse().find(item => item?.models?.includes(model)
        && item?.tasks?.some(task => task.name === name));
      const measured = report?.tasks?.find(task => task.name === name);
      const modelIndex = report?.models?.indexOf(model) ?? -1;
      let mean = measured?.values?.[modelIndex];
      let spread = Number(measured?.noise) || 0;
      if (!Number.isFinite(mean)) {
        const fixtureTask = (fixture?.tasks || []).find(task => codeTaskName(task) === name);
        const fixtureIndex = fixtureTask?.calibration?.panel?.indexOf(model) ?? -1;
        mean = fixtureTask?.calibration?.values?.[fixtureIndex];
        spread = Number(fixtureTask?.calibration?.noise) || 0;
      }
      if (!Number.isFinite(mean)) {
        throw new Error(`panel history is incomplete for ${model}/${name}`);
      }
      return {
        name,
        mean,
        spread,
        // The report stores the measured mean and conservative task noise,
        // not each raw response. Do not invent raw repetitions.
        scores: [],
        source: 'code-patch-calibration-panel',
      };
    });
    const repeats = Math.max(...reports.map(report => Number(report?.repeats) || 1));
    return {
      model,
      runs: repeats,
      tasks,
      score: tasks.reduce((sum, task) => sum + task.mean, 0) / tasks.length,
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const rebase = process.argv[2] === '--rebase-panel';
  const panel = rebase ? String(process.argv[3] || '').split(',').filter(Boolean) : null;
  const measurementPaths = rebase ? process.argv.slice(4) : process.argv.slice(2, 3);
  if (!measurementPaths.length || (rebase && panel.length < 2)) {
    console.error('použití: node src/eval/calibrate-code-suite.js <panel.json>\n'
      + 'nebo: node src/eval/calibrate-code-suite.js --rebase-panel model1,model2 <report.json> [report.json…]');
    process.exit(1);
  }

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const measurements = measurementPaths.map(measurementPath => JSON.parse(readFileSync(measurementPath, 'utf8')));
  const out = rebase ? rebaseCalibrationPanel(fixture, measurements, panel)
    : calibrate(fixture, measurements[0]);

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

export default { calibrate, rebaseCalibrationPanel, buildPanelSummaries };
