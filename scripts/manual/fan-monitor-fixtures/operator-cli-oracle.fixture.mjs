// TRUSTED ORACLE FIXTURE ONLY, independent of generated application tests.
import test from 'node:test';
import fs from 'node:fs';
import { CLI_GRAPH, verifyFanSources } from '../scripts/fan-monitor-oracle-proposed.mjs';
import { verifyFanEntry } from '../scripts/fan-monitor-entry-oracle.mjs';
test('operator frozen core and CLI oracle plus actual guarded entry', async () => {
 const sources=Object.fromEntries(Object.keys(CLI_GRAPH).map(relative=>[relative,fs.readFileSync(relative,'utf8')]));
 await verifyFanSources(sources,{phase:'cli'});
 verifyFanEntry();
});
