// TRUSTED ORACLE FIXTURE ONLY, independent of generated application tests.
import test from 'node:test';
import fs from 'node:fs';
import { CORE_GRAPH, verifyFanSources } from '../scripts/fan-monitor-oracle-proposed.mjs';
test('operator frozen core oracle', async () => {
 const sources=Object.fromEntries(Object.keys(CORE_GRAPH).map(relative=>[relative,fs.readFileSync(relative,'utf8')]));
 await verifyFanSources(sources,{phase:'core'});
});
