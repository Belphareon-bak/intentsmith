#!/usr/bin/env node
// Structural audit of an incomplete development second review. The committed
// manifest freezes existing raw batches; this never grades or decides a role.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`HUNT_SECOND_REVIEW_INVALID:${code}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const scoreOnScale = (value, denominator) => typeof value === 'number'
  && Number.isFinite(value) && value >= 0 && value <= 1
  && Math.abs(value * denominator - Math.round(value * denominator)) < 1e-8;
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const filePattern = /^(chat|code|dr)-\d{3}\.json$/;
const hashPattern = /^[a-f0-9]{64}$/;
const roleForFile = Object.freeze({ chat: ['CHAT'], code: ['CODE'], dr: ['D1', 'D2', 'R1', 'R2'] });

function parseJson(bytes, code) {
  try { return JSON.parse(bytes); } catch { fail(code); }
}

function criterionKeys(item) {
  if (item.role === 'CHAT') {
    const stem = item.task.replace(/^(cs|en)_/, '');
    if (stem === item.task) fail('CHAT_TASK');
    return item.rubric.map((line, index) => {
      const key = line.match(/^([a-z0-9_]+\.\d+)\s/)?.[1];
      if (key !== `${stem}.${index + 1}`) fail('PACKET_RUBRIC');
      return key;
    });
  }
  if (item.role === 'CODE') {
    const keys = item.rubric.map(line => line.match(/^(api|meaning)\s/)?.[1]);
    if (JSON.stringify([...keys].sort()) !== JSON.stringify(['api', 'meaning'])) fail('PACKET_RUBRIC');
    return keys;
  }
  return item.rubric.map((_line, index) => `c${index + 1}`);
}

function verifyCodeComponents(row) {
  if (typeof row.meaning_points_of_24 !== 'number'
    || !Number.isFinite(row.meaning_points_of_24)
    || !Number.isSafeInteger(row.meaning_points_of_24 * 2)
    || row.meaning_points_of_24 < 0
    || row.meaning_points_of_24 > 24 || !Number.isSafeInteger(row.api_cases_ok)
    || row.api_cases_ok < 0 || row.api_cases_ok > 24
    || !exactKeys(row.exact_fractions, ['meaning', 'api'])
    || !exactKeys(row.scale_snap, ['meaning', 'api'])
    || !scoreOnScale(row.provisional_task_mean, 100)) fail('CODE_COMPONENTS');
  for (const [key, numerator] of [['meaning', row.meaning_points_of_24], ['api', row.api_cases_ok]]) {
    const fraction = row.exact_fractions[key], score = row.s[key][0];
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)
      || Math.abs(fraction - numerator / 24) > 1e-6
      || Math.abs(score - fraction) > 0.005001
      || row.scale_snap[key] !== Math.round(score * 4) / 4) fail('CODE_COMPONENTS');
  }
  if (Math.abs(row.provisional_task_mean - (row.s.meaning[0] + row.s.api[0]) / 2) > 0.005001)
    fail('CODE_COMPONENTS');
}

export function verifyHuntSecondReviewBatches({packetBytes,expectedPacketSha256,
  sharedContextBytes,codePolicyBytes,batchFiles,revisionBytes,manifestBytes} = {}) {
  if (!hashPattern.test(expectedPacketSha256 ?? '')) fail('EXPECTED_PACKET_HASH');
  const packetSha256 = sha256(packetBytes);
  if (packetSha256 !== expectedPacketSha256) fail('PACKET_HASH');
  const manifest = parseJson(manifestBytes, 'MANIFEST_JSON');
  if (!exactKeys(manifest, ['schemaVersion','status','decisionAuthority',
    'packetSha256','batchFiles','revisionFile'])
    || manifest.schemaVersion !== 1
    || manifest.status !== 'FROZEN_DEVELOPMENT_REVIEW_EVIDENCE'
    || manifest.decisionAuthority !== false
    || manifest.packetSha256 !== packetSha256
    || !Array.isArray(manifest.batchFiles) || !manifest.batchFiles.length
    || manifest.batchFiles.some(entry => !exactKeys(entry, ['name','sha256'])
      || !filePattern.test(entry.name) || !hashPattern.test(entry.sha256))
    || !exactKeys(manifest.revisionFile, ['name','sha256'])
    || manifest.revisionFile.name !== 'revisions-after-context.json'
    || !hashPattern.test(manifest.revisionFile.sha256)) fail('MANIFEST_SCOPE');
  const expectedFiles=manifest.batchFiles.map(entry => entry.name);
  if (JSON.stringify(expectedFiles) !== JSON.stringify([...expectedFiles].sort((a,b)=>a.localeCompare(b,'en')))
    || new Set(expectedFiles).size !== expectedFiles.length) fail('MANIFEST_FILES');
  if (!Array.isArray(batchFiles) || batchFiles.length !== expectedFiles.length
    || JSON.stringify(batchFiles.map(file=>file?.name).sort((a,b)=>String(a).localeCompare(String(b),'en')))
      !== JSON.stringify(expectedFiles)) fail('BATCH_MANIFEST_FILES');
  const expectedHashes=new Map(manifest.batchFiles.map(entry=>[entry.name,entry.sha256]));
  for (const file of batchFiles) {
    if (sha256(file.bytes) !== expectedHashes.get(file.name)) fail('BATCH_MANIFEST_HASH');
  }
  if (sha256(revisionBytes) !== manifest.revisionFile.sha256) fail('REVISION_MANIFEST_HASH');
  const packet = parseJson(packetBytes, 'PACKET_JSON');
  if (packet?.schemaVersion !== 1 || packet.status !== 'DEVELOPMENT_BLIND_REVIEW'
    || packet.notFreshHoldout !== true || packet.decisionAuthority !== false
    || !Array.isArray(packet.cases) || packet.cases.length === 0
    || packet.reviewPolicyVersion !== 'chat-review-shared-policy.1'
    || !nonempty(packet.rubricPolicy?.revision)
    || !Array.isArray(packet.rubricPolicy.instructions) || !packet.rubricPolicy.instructions.length
    || packet.rubricPolicy.instructions.some(line => !nonempty(line))) fail('PACKET_SCOPE');
  if (sha256(canonical(packet.rubricPolicy)) !== packet.rubricPolicySha256) fail('SHARED_RUBRIC_HASH');
  const sharedContextSha256 = sha256(sharedContextBytes);
  if (sharedContextSha256 !== packet.sharedSystemContextSha256) fail('SHARED_CONTEXT_HASH');
  const codePolicySha256 = sha256(codePolicyBytes);
  if (codePolicySha256 !== packet.codeReviewPolicySha256) fail('CODE_POLICY_HASH');

  const ids = new Set(), expectedKeys = [];
  const totalByRole = new Map();
  let packetCriteria = 0;
  for (const item of packet.cases) {
    if (!object(item) || !nonempty(item.id) || ids.has(item.id)
      || !['CHAT', 'CODE', 'D1', 'D2', 'R1', 'R2'].includes(item.role)
      || !nonempty(item.task) || !nonempty(item.label)
      || !Number.isSafeInteger(item.repeat) || item.repeat < 1
      || typeof item.question !== 'string' || typeof item.response !== 'string'
      || !Array.isArray(item.rubric) || item.rubric.length < 1
      || item.rubric.some(line => !nonempty(line))) fail('PACKET_CASE');
    ids.add(item.id);
    expectedKeys.push(criterionKeys(item));
    packetCriteria += item.rubric.length;
    totalByRole.set(item.role, (totalByRole.get(item.role) ?? 0) + 1);
  }

  const seenNames = new Set(), grades = new Map(), files = [], reviewers = new Set();
  let validatedCriteria = 0, taskIssueCriteria = 0, normalizedMissingIds = 0;
  for (const file of [...batchFiles].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const match = filePattern.exec(file?.name ?? '');
    if (!match || seenNames.has(file.name)) fail('BATCH_FILE_NAME');
    seenNames.add(file.name);
    const batch = parseJson(file.bytes, 'BATCH_JSON');
    if (!exactKeys(batch, ['reviewer', 'batch', 'scale', 'note', 'grades'])
      || !nonempty(batch.reviewer) || batch.batch !== file.name.slice(0, -5)
      || !nonempty(batch.note) || JSON.stringify(batch.scale) !== JSON.stringify([0, .25, .5, .75, 1])
      || !Array.isArray(batch.grades) || batch.grades.length === 0) fail('BATCH_HEADER');
    reviewers.add(batch.reviewer);
    files.push({name:file.name,sha256:sha256(file.bytes),cases:batch.grades.length});
    for (const row of batch.grades) {
      if (!object(row) || !Number.isSafeInteger(row.idx)
        || row.idx < 0 || row.idx >= packet.cases.length) fail('CASE_INDEX');
      if (grades.has(row.idx)) fail('DUPLICATE_INDEX');
      const item = packet.cases[row.idx];
      if (!roleForFile[match[1]].includes(item.role)) fail('CASE_ROLE');
      if (row.id === undefined) {
        if (match[1] !== 'dr') fail('CASE_ID');
        normalizedMissingIds++;
      } else if (row.id !== item.id) fail('CASE_ID');
      if (row.task !== item.task || row.label !== item.label
        || (row.role !== undefined && row.role !== item.role)
        || (row.repeat !== undefined && row.repeat !== item.repeat)) fail('CASE_METADATA');
      if (!exactKeys(row.s, expectedKeys[row.idx])) fail('CRITERION_KEYS');
      for (const key of expectedKeys[row.idx]) {
        const tuple = row.s[key];
        if (!Array.isArray(tuple) || tuple.length !== 3
          || !nonempty(tuple[1]) || !nonempty(tuple[2])
          || (tuple[0] === null ? !tuple[1].startsWith('TASK_ISSUE:')
            : !scoreOnScale(tuple[0], item.role === 'CODE' ? 100 : 4))) fail('CRITERION_VALUE');
        if (tuple[0] === null) taskIssueCriteria++;
      }
      if (item.role === 'CODE') verifyCodeComponents(row);
      grades.set(row.idx, row);
      validatedCriteria += item.rubric.length;
    }
  }
  if (reviewers.size !== 1) fail('REVIEWER_MISMATCH');

  const revision = parseJson(revisionBytes, 'REVISION_JSON');
  if (!exactKeys(revision, ['note', 'clock', 'log'])
    || !nonempty(revision.note) || !nonempty(revision.clock)
    || !Array.isArray(revision.log)) fail('REVISION_HEADER');
  const seenRevisions = new Set();
  let scoreChanges = 0;
  for (const row of revision.log) {
    if (!exactKeys(row, ['idx', 'task', 'label', 'criterion',
      'old_score', 'new_score', 'old_reason', 'new_reason'])
      || !Number.isSafeInteger(row.idx) || row.idx < 0 || row.idx >= packet.cases.length
      || !nonempty(row.old_reason) || !nonempty(row.new_reason)
      || !scoreOnScale(row.old_score, 4) || !scoreOnScale(row.new_score, 4)) fail('REVISION_ROW');
    const item = packet.cases[row.idx], grade = grades.get(row.idx);
    if (item.role !== 'CHAT' || !grade || row.task !== item.task || row.label !== item.label
      || !expectedKeys[row.idx].includes(row.criterion)) fail('REVISION_TARGET');
    const key = `${row.idx}:${row.criterion}`;
    if (seenRevisions.has(key)) fail('REVISION_DUPLICATE');
    seenRevisions.add(key);
    if (grade.s[row.criterion][0] !== row.new_score
      || grade.s[row.criterion][1] !== row.new_reason) fail('REVISION_CURRENT_MISMATCH');
    if (row.old_score === row.new_score && row.old_reason === row.new_reason) fail('REVISION_NO_CHANGE');
    if (row.old_score !== row.new_score) scoreChanges++;
  }

  const missingCases = packet.cases.flatMap((item, idx) => grades.has(idx) ? [] : [{
    idx,id:item.id,role:item.role,task:item.task,label:item.label,repeat:item.repeat,
  }]);
  const roles = Object.fromEntries([...totalByRole].map(([role, total]) => {
    const missing = missingCases.filter(item => item.role === role).length;
    return [role, {packetCases:total,validatedCases:total - missing,missingCases:missing}];
  }));
  return {
    schemaVersion:1,
    status:missingCases.length ? 'DEVELOPMENT_REVIEW_INCOMPLETE' : 'STRUCTURALLY_COMPLETE_NO_DECISION',
    decisionStatus:'NO_DECISION',decisionAuthority:false,acceptedGrader:false,
    notFreshHoldout:true,validationScope:'STRUCTURE_ONLY_NO_GRADING',
    packetSha256,manifestSha256:sha256(manifestBytes),sharedContextSha256,codePolicySha256,
    reviewer:[...reviewers][0],normalizedMissingIds,
    coverage:{packetCases:packet.cases.length,validatedCases:grades.size,missingCases:missingCases.length,
      packetCriteria,validatedCriteria,missingCriteria:packetCriteria-validatedCriteria,taskIssueCriteria},
    roles,files,revisions:{sha256:sha256(revisionBytes),entries:revision.log.length,scoreChanges},
    missingCases,
  };
}

function cliOptions(args) {
  const options={};
  for (const arg of args) {
    const match=/^--(packet|grades-dir|expected-packet-sha256)=(.+)$/.exec(arg);
    if (!match || options[match[1]]) fail('ARGUMENTS');
    options[match[1]]=match[2];
  }
  if (Object.keys(options).length !== 3 || !isAbsolute(options.packet)
    || !isAbsolute(options['grades-dir'])) fail('ARGUMENTS');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options=cliOptions(process.argv.slice(2));
    const gradesDir=options['grades-dir'];
    const entries=readdirSync(gradesDir,{withFileTypes:true});
    const json=entries.filter(entry=>entry.name.endsWith('.json'));
    if (json.some(entry=>!entry.isFile() || (entry.name!=='revisions-after-context.json'
      && !filePattern.test(entry.name)))) fail('BATCH_FILE_NAME');
    const parent=dirname(options.packet);
    const report=verifyHuntSecondReviewBatches({
      packetBytes:readFileSync(options.packet),
      expectedPacketSha256:options['expected-packet-sha256'],
      sharedContextBytes:readFileSync(join(parent,'shared-system-context.json')),
      codePolicyBytes:readFileSync(join(parent,'CODE-REVIEW-POLICY.md')),
      // The manifest is selected by reviewed source, not by a caller path.
      manifestBytes:readFileSync(new URL('../docs/review/evidence/2026-10-01-hunt-second-review-batch-manifest.json',import.meta.url)),
      batchFiles:json.filter(entry=>entry.name!=='revisions-after-context.json')
        .map(entry=>({name:entry.name,bytes:readFileSync(join(gradesDir,entry.name))})),
      revisionBytes:readFileSync(join(gradesDir,'revisions-after-context.json')),
    });
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode=1;
  }
}
