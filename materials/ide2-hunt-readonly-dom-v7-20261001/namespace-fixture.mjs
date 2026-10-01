// CPU payload controls only. The detached child runs before any ownership
// publication, exactly the vulnerable window in v1. No DB/network/GPU/UI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {CONFIG, save, delay, inherited} from './common.mjs';
const [out, kind] = process.argv.slice(2);
assert.ok(['postspawn-fatal', 'deadline', 'proc-stat-scan'].includes(kind));
if (kind === 'proc-stat-scan') {
  await import('./namespace-proc-fixture.mjs');
} else {
const code = `const fs=require('node:fs');const{spawn}=require('node:child_process');const grand=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const raw=fs.readFileSync('/proc/self/stat','utf8');const c=raw.slice(raw.lastIndexOf(')')+1).trim().split(/\\s+/);fs.writeFileSync(process.argv[1],JSON.stringify({namespacePid:process.pid,pgid:Number(c[2]),grandchildNamespacePid:grand.pid,pidNamespace:fs.readlinkSync('/proc/self/ns/pid')}));setInterval(()=>{},1000);`;
const child = spawn(CONFIG.node, ['-e', code, path.join(out, 'DETACHED-STARTED.json')], {cwd: out, env: inherited(), detached: true, stdio: 'ignore'});
const deadline = Date.now() + 6_000;
while (Date.now() < deadline && !fs.existsSync(path.join(out, 'DETACHED-STARTED.json'))) await delay(10);
assert.ok(fs.existsSync(path.join(out, 'DETACHED-STARTED.json')));
assert.equal(fs.existsSync(path.join(out, 'OWNERSHIP.json')), false, 'there has been NO publisher record/ACK');
save(out, 'FIXTURE-READY.json', {childNamespacePid: child.pid, ownershipPublished: false});
if (kind === 'postspawn-fatal') {
  while (!fs.existsSync(path.join(out, 'INJECT-FATAL.json'))) await delay(10);
  // Fatal before detached PID/PGID publication and with no finally handler.
  process.exit(23);
}
await new Promise(() => {setInterval(() => {}, 1000);});

}
