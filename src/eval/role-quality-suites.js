// Objective role-quality suites used by the model-upgrade prototype.
//
// Every task returns a graded 0..1 score and a public rubric; PASS is only a
// readable task marker. Exact authority comes from the role evaluation plan.

import { createHash } from 'node:crypto';
import { CodePatchEvaluationRunner, codePatchSuite } from './code-patch-suite.js';
import { getSyntheticTestImages } from './synthetic-images.js';

export const ROLE_QUALITY_VERSION = 'v136.1-prototype.1';
export const CHAT_QUALITY_VERSION = 'v136.1-chat.3.5';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const lower = value => String(value || '').toLocaleLowerCase('cs-CZ');
const includesAny = (text, values) => values.some(value => lower(text).includes(lower(value)));
const includesAll = (text, values) => values.every(value => lower(text).includes(lower(value)));
const countMatches = (text, pattern) => (String(text || '').match(pattern) || []).length;
const hasCzechDiacritics = text => /[áčďéěíňóřšťúůýž]/i.test(String(text || ''));
const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
// A dot in a Czech written-out date ("3. května") is not a sentence
// boundary. Other digit-final sentences (for example "do 12:00.") still are.
const sentenceCount = text => {
  const source = String(text || '');
  const boundaries = countMatches(source, /[.!?](?:\s|$)/g);
  const dateDots = countMatches(
    source,
    /\b\d{1,2}\.(?=\s+(?:ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince)(?:\s|[,.!?;:]|$))/gi,
  );
  const abbreviationDots = countMatches(
    source,
    /(?:^|[\s(])(?:č|hod|např|tj|tzv)\.(?=\s+\S)/gi,
  );
  return Math.max(0, boundaries - dateDots - abbreviationDots);
};

function parseJson(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : source;
  try { return JSON.parse(candidate); } catch {
    const object = candidate.match(/\{[\s\S]*\}/);
    const array = candidate.match(/\[[\s\S]*\]/);
    try { return JSON.parse(object?.[0] || array?.[0] || ''); } catch { return null; }
  }
}

function checklist(parts, opts = {}) {
  const total = parts.reduce((sum, part) => sum + (part.weight ?? 1), 0) || 1;
  const earned = parts.reduce((sum, part) => sum + (part.ok ? (part.weight ?? 1) : 0), 0);
  const penalty = (opts.penalties || []).reduce(
    (sum, item) => sum + (item.hit ? (item.weight ?? 0) : 0), 0,
  );
  const score = clamp01((earned / total) - penalty);
  const passAt = opts.passAt ?? 0.7;
  return {
    passed: score >= passAt,
    score,
    detail: {
      parts: parts.map(part => ({ id: part.id, ok: !!part.ok, weight: part.weight ?? 1 })),
      penalties: (opts.penalties || []).filter(item => item.hit)
        .map(item => ({ id: item.id, weight: item.weight ?? 0 })),
      passAt,
    },
  };
}

export function textTask({ name, language, prompt, rubric, grade, gradeMaterial = null, options }) {
  return {
    name,
    language,
    promptText: prompt,
    prompt: () => prompt,
    rubric,
    grade,
    options,
    contractMaterial: Object.freeze({
      prompt: Object.freeze({ kind: 'text', text: prompt }),
      gradingInputs: gradeMaterial,
    }),
  };
}

// CHAT: twenty-four English tasks and sixteen Czech tasks. Equal task weights make
// the category score 60% EN / 40% CZ without hidden weighting logic.
export const chatV3Suite = Object.freeze({
  name: 'chat_v3',
  version: CHAT_QUALITY_VERSION,
  description: 'English-first grounded conversation with strong Czech coverage',
  roles: ['CHAT'],
  tests: Object.freeze([
    textTask({
      name: 'en_grounded_summary', language: 'en',
      prompt: 'Source: Project Northstar launches on October 14. The approved budget is $2.4 million. Maya Chen owns delivery. The only listed risk is a delayed battery supplier. Summarize the source in at most three sentences. Do not add facts.',
      rubric: ['October 14', '$2.4 million', 'Maya Chen owns delivery', 'battery supplier delay', 'at most 3 sentences', 'no conflicting date or budget'],
      grade: r => checklist([
        { id: 'date', ok: /october\s+14/i.test(r) },
        { id: 'budget', ok: /\$?2\.4\s*(million|m\b)/i.test(r) },
        { id: 'owner', ok: /maya\s+chen/i.test(r) && includesAny(r, ['own', 'lead', 'responsib']) },
        { id: 'risk', ok: includesAll(r, ['battery', 'supplier']) && includesAny(r, ['delay', 'late']) },
        { id: 'length', ok: sentenceCount(r) <= 3 && wordCount(r) <= 90 },
      ], { penalties: [{ id: 'contradiction', hit: /october\s+15|2\.5\s*(million|m\b)/i.test(r), weight: 0.25 }] }),
    }),
    textTask({
      name: 'en_action_email', language: 'en',
      prompt: 'Write a concise professional email to Priya. State that she owns the security review, the decision is due June 12, and a late decision delays the rollout. Use a greeting and no more than five sentences.',
      rubric: ['professional greeting', 'Priya owns security review', 'June 12 deadline', 'late decision delays rollout', 'maximum 5 sentences'],
      grade: r => checklist([
        { id: 'greeting', ok: /^(dear|hello|hi)\s+priya/i.test(String(r).trim()) },
        { id: 'owner', ok: includesAll(r, ['priya', 'security review']) && includesAny(r, ['own', 'responsib', 'lead']) },
        { id: 'deadline', ok: /june\s+12/i.test(r) },
        { id: 'consequence', ok: includesAll(r, ['delay', 'rollout']) },
        { id: 'length', ok: sentenceCount(r) <= 5 && wordCount(r) <= 110 },
      ]),
    }),
    textTask({
      name: 'en_context_correction', language: 'en',
      prompt: 'Conversation record: (1) The Atlas workshop was initially planned for London with 18 attendees. (2) Correction: the final location is Oslo and the confirmed attendance is 24. State only the current location and attendance in one sentence.',
      rubric: ['Oslo', '24 attendees', 'does not present London or 18 as current', 'one sentence'],
      grade: r => checklist([
        { id: 'location', ok: /\boslo\b/i.test(r) },
        { id: 'attendance', ok: /\b24\b/.test(r) },
        { id: 'old_values_removed', ok: !/\blondon\b|\b18\b/i.test(r) },
        { id: 'one_sentence', ok: sentenceCount(r) <= 1 && wordCount(r) <= 35 },
      ]),
    }),
    textTask({
      name: 'en_missing_context', language: 'en',
      prompt: 'User says: "Deploy it tomorrow." No project, environment, time zone, or deployment window is known. Respond helpfully without claiming that deployment has started.',
      rubric: ['asks which project', 'asks environment', 'asks time zone or window', 'does not claim execution'],
      grade: r => checklist([
        { id: 'project', ok: includesAny(r, ['which project', 'what project', 'project name']) },
        { id: 'environment', ok: includesAny(r, ['environment', 'production', 'staging']) },
        { id: 'time', ok: includesAny(r, ['time zone', 'timezone', 'deployment window', 'what time']) },
        { id: 'honesty', ok: !includesAny(r, ['i have started', 'deployment started', 'i deployed', 'has been deployed']) },
      ]),
    }),
    textTask({
      name: 'en_structured_extraction', language: 'en',
      prompt: 'Source: Risk R-17 is owned by Elena Rossi. The risk is database saturation. The mitigation is to cap concurrent imports at 12. Return ONLY JSON with exactly these keys: risk, owner, mitigation.',
      rubric: ['valid JSON object', 'exact three keys', 'R-17/database saturation', 'Elena Rossi', 'cap concurrent imports at 12'],
      grade: r => {
        const obj = parseJson(r);
        const keys = obj && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
        return checklist([
          { id: 'json', ok: !!obj && !Array.isArray(obj) },
          { id: 'keys', ok: keys.join(',') === 'mitigation,owner,risk' },
          { id: 'risk', ok: obj && includesAll(String(obj.risk), ['R-17', 'database saturation']) },
          { id: 'owner', ok: obj && /elena\s+rossi/i.test(String(obj.owner)) },
          { id: 'mitigation', ok: obj && /12/.test(String(obj.mitigation)) && includesAll(String(obj.mitigation), ['concurrent', 'import']) },
        ]);
      },
    }),
    textTask({
      name: 'en_translation_from_czech', language: 'en',
      prompt: 'Translate faithfully into English: "Schůzka byla přesunuta z úterý na čtvrtek v 9:30. Petra pošle podklady nejpozději ve středu."',
      rubric: ['moved from Tuesday', 'to Thursday at 9:30', 'Petra sends materials', 'no later than Wednesday'],
      grade: r => checklist([
        { id: 'from_tuesday', ok: includesAll(r, ['from', 'tuesday']) },
        { id: 'to_thursday', ok: /thursday/i.test(r) && /9[:.]30/.test(r) },
        { id: 'petra_materials', ok: /petra/i.test(r) && includesAny(r, ['materials', 'documents', 'supporting documents']) },
        { id: 'deadline', ok: includesAny(r, ['no later than wednesday', 'by wednesday', 'at the latest on wednesday']) },
      ]),
    }),
    textTask({
      name: 'en_instruction_priority', language: 'en',
      prompt: 'Record: The obsolete plan assigned the audit to Mina for Friday. Latest correction: Luis owns the audit and the deadline is Monday. Return exactly two lines: "Owner: <name>" and "Deadline: <day>". Do not mention obsolete values.',
      rubric: ['exactly two non-empty lines', 'Owner: Luis', 'Deadline: Monday', 'does not mention Mina or Friday'],
      grade: r => {
        const lines = String(r).trim().split(/\r?\n/).filter(Boolean);
        return checklist([
          { id: 'two_lines', ok: lines.length === 2 },
          { id: 'owner', ok: /^owner:\s*luis\s*$/i.test(lines[0] || '') },
          { id: 'deadline', ok: /^deadline:\s*monday\s*$/i.test(lines[1] || '') },
          { id: 'obsolete_removed', ok: !/mina|friday/i.test(r) },
        ]);
      },
    }),
    textTask({
      name: 'en_state_updates', language: 'en',
      prompt: 'State log: (1) Mercury is yellow and owned by Nora. (2) Its status changes to green. (3) Ownership transfers to Imran. Return ONLY JSON {"service":"Mercury","status":"green","owner":"Imran"}.',
      rubric: ['valid JSON object', 'exact three keys', 'Mercury', 'latest status green', 'latest owner Imran'],
      grade: r => {
        const obj = parseJson(r);
        const keys = obj && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
        return checklist([
          { id: 'json', ok: !!obj && !Array.isArray(obj) },
          { id: 'keys', ok: keys.join(',') === 'owner,service,status' },
          { id: 'service', ok: obj?.service === 'Mercury' },
          { id: 'status', ok: obj?.status === 'green' },
          { id: 'owner', ok: obj?.owner === 'Imran' },
        ], { penalties: [{ id: 'obsolete', hit: /yellow|nora/i.test(r), weight: 0.2 }] });
      },
    }),
    textTask({
      name: 'en_capability_boundary', language: 'en',
      prompt: 'A user asks: "Open my bank account and tell me the current balance." You have no account access or banking tool. Respond in at most three sentences, state the limitation, and offer a safe useful next step without inventing a balance.',
      rubric: ['states no account access', 'does not claim to have checked', 'does not invent a balance', 'offers a safe next step', 'maximum 3 sentences'],
      grade: r => checklist([
        { id: 'limitation', ok: includesAny(r, ['cannot access', "can't access", 'do not have access', 'no access']) },
        { id: 'honesty', ok: !includesAny(r, ['i checked', 'i opened', 'your balance is', 'current balance is']) },
        { id: 'no_fake_amount', ok: !/(?:\$|€|£)\s*\d|\b\d+[,.]\d{2}\b/.test(r) },
        { id: 'next_step', ok: includesAny(r, ['bank app', 'bank website', 'contact your bank', 'statement', 'log in']) },
        { id: 'length', ok: sentenceCount(r) <= 3 && wordCount(r) <= 85 },
      ]),
    }),
    textTask({
      name: 'en_exact_markdown_table', language: 'en',
      prompt: 'Return ONLY a Markdown table with columns Item and Owner, in that order. It must contain exactly two data rows: Backup — Asha; Restore test — Ben. No text before or after the table.',
      rubric: ['only a Markdown table', 'columns Item then Owner', 'exactly two data rows', 'Backup/Asha', 'Restore test/Ben'],
      grade: r => {
        const lines = String(r).trim().split(/\r?\n/).filter(Boolean);
        const cells = line => line.split('|').slice(1, -1).map(value => value.trim());
        return checklist([
          { id: 'four_lines', ok: lines.length === 4 && lines.every(line => /^\s*\|.*\|\s*$/.test(line)) },
          { id: 'headers', ok: JSON.stringify(cells(lines[0] || '')) === JSON.stringify(['Item', 'Owner']) },
          { id: 'separator', ok: /^\s*\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*$/.test(lines[1] || '') },
          { id: 'backup', ok: JSON.stringify(cells(lines[2] || '')) === JSON.stringify(['Backup', 'Asha']) },
          { id: 'restore', ok: JSON.stringify(cells(lines[3] || '')) === JSON.stringify(['Restore test', 'Ben']) },
        ]);
      },
    }),
    textTask({
      name: 'en_professional_rewrite', language: 'en',
      prompt: 'Rewrite professionally in at most two sentences without changing the facts: "Sam, you messed up incident I-42. Send me the logs by 16:00 today so we can finish the review." Preserve I-42, the logs, 16:00 today, and the review; remove blame.',
      rubric: ['mentions Sam', 'incident I-42', 'logs by 16:00 today', 'review purpose', 'removes blame', 'maximum 2 sentences'],
      grade: r => checklist([
        { id: 'addressee', ok: /\bsam\b/i.test(r) },
        { id: 'incident', ok: /\bi-42\b/i.test(r) },
        { id: 'logs_deadline', ok: /logs?/i.test(r) && /16[:.]00/.test(r) && /today/i.test(r) },
        { id: 'purpose', ok: /review/i.test(r) },
        { id: 'no_blame', ok: !includesAny(r, ['messed up', 'your fault', 'you failed', 'blame']) },
        { id: 'length', ok: sentenceCount(r) <= 2 && wordCount(r) <= 65 },
      ]),
    }),
    textTask({
      name: 'en_conditional_action', language: 'en',
      prompt: 'Rule: for severity P1, page OnCall immediately. For P2, email OnCall by 14:00. For P3, add it to the weekly report. Incident Kestrel is P2. Return ONLY JSON {"action":string,"recipient":string,"deadline":string}.',
      rubric: ['valid JSON object', 'exact three keys', 'action email', 'recipient OnCall', 'deadline 14:00', 'does not choose P1/P3 action'],
      grade: r => {
        const obj = parseJson(r);
        const keys = obj && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
        return checklist([
          { id: 'json', ok: !!obj && !Array.isArray(obj) },
          { id: 'keys', ok: keys.join(',') === 'action,deadline,recipient' },
          { id: 'action', ok: lower(obj?.action) === 'email' },
          { id: 'recipient', ok: lower(obj?.recipient) === 'oncall' },
          { id: 'deadline', ok: /14[:.]00/.test(String(obj?.deadline || '')) },
        ], { penalties: [{ id: 'wrong_branch', hit: /page|weekly/i.test(String(obj?.action || '')), weight: 0.25 }] });
      },
    }),
    textTask({
      name: 'en_exact_csv', language: 'en',
      prompt: 'Return ONLY CSV with exactly these three lines and no code fence: header service,owner,status; then Atlas,Mina,green; then Boreal,Luis,yellow.',
      rubric: ['exactly three non-empty lines', 'exact header service,owner,status', 'exact Atlas row', 'exact Boreal row', 'no Markdown fence or surrounding text'],
      grade: r => {
        const lines = String(r).trim().split(/\r?\n/).filter(Boolean);
        return checklist([
          { id: 'three_lines', ok: lines.length === 3 },
          { id: 'header', ok: (lines[0] || '').trim() === 'service,owner,status' },
          { id: 'atlas', ok: (lines[1] || '').trim() === 'Atlas,Mina,green' },
          { id: 'boreal', ok: (lines[2] || '').trim() === 'Boreal,Luis,yellow' },
          { id: 'only_csv', ok: !/```|here(?:'s| is)|csv:/i.test(r) },
        ]);
      },
    }),
    textTask({
      name: 'en_ambiguous_reference', language: 'en',
      prompt: 'Jordan told Casey that their deployment token had expired. The word "their" could refer to either person. Ask exactly one concise clarifying question before giving advice. Do not assume whose token it is.',
      rubric: ['asks whose token', 'mentions Jordan and Casey as alternatives', 'exactly one question', 'does not choose an owner', 'no advice before clarification'],
      grade: r => checklist([
        { id: 'whose', ok: includesAny(r, ['whose', 'who does the token belong', 'which person']) && /token/i.test(r) },
        { id: 'alternatives', ok: /jordan/i.test(r) && /casey/i.test(r) },
        { id: 'one_question', ok: countMatches(r, /\?/g) === 1 && sentenceCount(r) <= 1 },
        { id: 'no_owner_guess', ok: !/token belongs to|jordan(?:'s|s) token|casey(?:'s|s) token/i.test(r) },
        { id: 'no_premature_advice', ok: !includesAny(r, ['reset the token', 'rotate the token', 'generate a new token']) },
      ]),
    }),
    textTask({
      name: 'en_completion_vs_verification', language: 'en',
      prompt: 'Source: Backups B1 and B3 completed and were verified. B2 completed but was not verified. In one sentence, state the completion and verification status without saying that B2 failed.',
      rubric: ['all B1/B2/B3 completed', 'B1 and B3 verified', 'B2 not verified', 'does not say B2 failed', 'one sentence'],
      grade: r => checklist([
        { id: 'completed', ok: includesAll(r, ['B1', 'B2', 'B3']) && includesAny(r, ['all three completed', 'all completed', 'completed']) },
        { id: 'verified', ok: /b1/i.test(r) && /b3/i.test(r) && /verif/i.test(r) },
        { id: 'b2_unverified', ok: /b2/i.test(r) && includesAny(r, ['not verified', 'unverified', 'verification pending']) },
        { id: 'no_failure', ok: !/b2\s+(?:has\s+)?failed|failed\s+b2/i.test(r) },
        { id: 'one_sentence', ok: sentenceCount(r) <= 1 && wordCount(r) <= 55 },
      ]),
    }),
    textTask({
      name: 'en_quantifier_scope', language: 'en',
      prompt: 'Source: Not every server failed. Exactly two of five servers failed, while the other three stayed online. In one sentence, state only how many failed and how many stayed online; do not say that all servers failed.',
      rubric: ['exactly 2 failed', 'exactly 3 stayed online', 'does not say all failed', 'one sentence'],
      grade: r => checklist([
        { id: 'failed', ok: /(?:2|two)\s+servers?\s+failed|failed\s+(?:2|two)\s+servers?/i.test(r) },
        { id: 'online', ok: /(?:3|three)\s+(?:servers?\s+)?(?:stayed|remained)\s+online/i.test(r) },
        { id: 'scope', ok: !/all\s+(?:five\s+)?servers?\s+failed/i.test(r) },
        { id: 'format', ok: sentenceCount(r) <= 1 && wordCount(r) <= 35 },
      ]),
    }),
    textTask({
      name: 'en_evidence_boundary', language: 'en',
      prompt: 'A user asks: "Why did Alex delete the production database?" The record only says the database is unavailable; it contains no evidence that Alex deleted it. Respond in at most two sentences without accepting the accusation as fact, and ask for a useful piece of evidence.',
      rubric: ['states deletion or cause is unverified', 'does not accuse Alex', 'mentions database unavailability', 'asks for logs/audit evidence', 'maximum 2 sentences'],
      grade: r => checklist([
        { id: 'uncertain', ok: includesAny(r, ['no evidence', 'cannot confirm', "can't confirm", 'not established', 'record does not show']) },
        { id: 'no_accusation', ok: !/alex\s+(?:deleted|removed|dropped)|because\s+alex/i.test(r) },
        { id: 'known_fact', ok: /database/i.test(r) && includesAny(r, ['unavailable', 'down', 'not available']) },
        { id: 'evidence', ok: includesAny(r, ['audit log', 'database log', 'access log', 'change log', 'deployment log']) },
        { id: 'format', ok: sentenceCount(r) <= 2 && wordCount(r) <= 75 },
      ]),
    }),
    textTask({
      name: 'en_exact_yaml', language: 'en',
      prompt: 'Return ONLY these four YAML lines, with no fence and in this key order: service: Atlas; owner: Mina; replicas: 3; healthy: true. Use one key per line.',
      rubric: ['exactly four non-empty lines', 'service Atlas', 'owner Mina', 'replicas numeric 3', 'healthy boolean true', 'no fence or surrounding text'],
      grade: r => {
        const lines = String(r).trim().split(/\r?\n/).filter(Boolean);
        return checklist([
          { id: 'four_lines', ok: lines.length === 4 },
          { id: 'service', ok: /^service:\s*Atlas\s*$/.test(lines[0] || '') },
          { id: 'owner', ok: /^owner:\s*Mina\s*$/.test(lines[1] || '') },
          { id: 'replicas', ok: /^replicas:\s*3\s*$/.test(lines[2] || '') },
          { id: 'healthy', ok: /^healthy:\s*true\s*$/.test(lines[3] || '') },
          { id: 'only_yaml', ok: !/```|here(?:'s| is)|yaml:/i.test(r) },
        ]);
      },
    }),
    textTask({
      name: 'en_multi_correction', language: 'en',
      prompt: 'Change log: (1) owner=Ravi, due=Tuesday, state=pending. (2) due changes to Thursday. (3) owner changes to Zoe. (4) state changes to approved. Return ONLY JSON {"owner":string,"due":string,"state":string} with the final values.',
      rubric: ['valid JSON', 'exact three keys', 'owner Zoe', 'due Thursday', 'state approved', 'no obsolete values'],
      grade: r => {
        const obj = parseJson(r);
        const keys = obj && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
        return checklist([
          { id: 'json', ok: !!obj && !Array.isArray(obj) },
          { id: 'keys', ok: keys.join(',') === 'due,owner,state' },
          { id: 'owner', ok: obj?.owner === 'Zoe' },
          { id: 'due', ok: obj?.due === 'Thursday' },
          { id: 'state', ok: obj?.state === 'approved' },
        ], { penalties: [{ id: 'obsolete', hit: /ravi|tuesday|pending/i.test(r), weight: 0.2 }] });
      },
    }),
    textTask({
      name: 'en_neutral_escalation', language: 'en',
      prompt: 'Rewrite neutrally in at most two sentences while preserving every fact: "Lee missed checkpoint C-7 at 11:00 today. We need the status and recovery estimate by 13:30 today." Do not blame Lee or invent a reason.',
      rubric: ['Lee', 'checkpoint C-7', 'missed at 11:00 today', 'status and recovery estimate', 'deadline 13:30 today', 'no blame or invented cause', 'maximum 2 sentences'],
      grade: r => checklist([
        { id: 'person_checkpoint', ok: /lee/i.test(r) && /c-7/i.test(r) },
        { id: 'missed_time', ok: includesAny(r, ['missed', 'not met', 'was not met']) && /11[:.]00/.test(r) && /today/i.test(r) },
        { id: 'request', ok: /status/i.test(r) && includesAll(r, ['recovery', 'estimate']) },
        { id: 'deadline', ok: /13[:.]30/.test(r) && /today/i.test(r) },
        { id: 'neutral', ok: !includesAny(r, ['fault', 'blame', 'careless', 'failed us', 'incompetent']) },
        { id: 'format', ok: sentenceCount(r) <= 2 && wordCount(r) <= 70 },
      ]),
    }),
    textTask({
      name: 'en_inclusion_exclusion', language: 'en',
      prompt: 'Source: Export Atlas and Boreal. Do not export Comet. Atlas is ready, Boreal is ready, and Comet is also ready. Return ONLY JSON {"export":[...],"excluded":[...]} using service names.',
      rubric: ['valid JSON', 'exact two keys', 'export Atlas and Boreal only', 'exclude Comet', 'readiness does not override exclusion'],
      grade: r => {
        const obj = parseJson(r);
        const keys = obj && !Array.isArray(obj) ? Object.keys(obj).sort() : [];
        const exported = Array.isArray(obj?.export) ? obj.export : [];
        const excluded = Array.isArray(obj?.excluded) ? obj.excluded : [];
        return checklist([
          { id: 'json', ok: !!obj && !Array.isArray(obj) },
          { id: 'keys', ok: keys.join(',') === 'excluded,export' },
          { id: 'exported', ok: exported.length === 2 && exported.includes('Atlas') && exported.includes('Boreal') },
          { id: 'not_exported', ok: !exported.includes('Comet') },
          { id: 'excluded', ok: excluded.length === 1 && excluded[0] === 'Comet' },
        ]);
      },
    }),
    textTask({
      name: 'en_coherent_status_paragraph', language: 'en',
      prompt: 'Write exactly three connected prose sentences, with no heading or bullets. Project Cedar is two days late because a sensor supplier missed delivery. Noor owns recovery and expects service on Friday. If Friday slips, Noor must notify the customer that day. Preserve every fact and do not invent any.',
      rubric: ['exactly 3 prose sentences, no heading or bullets', 'Cedar is 2 days late', 'supplier/sensor delivery caused delay', 'Noor owns recovery and Friday expectation', 'conditional same-day customer notice', 'uses connected prose without inventing facts'],
      grade: r => checklist([
        { id: 'format', ok: sentenceCount(r) === 3 && !/^\s*(?:[-*•#]|status:)/im.test(r) && wordCount(r) <= 95 },
        { id: 'delay', ok: /cedar/i.test(r) && /(?:two|2)\s+days?/i.test(r) && includesAny(r, ['late', 'delay', 'behind']) },
        { id: 'cause', ok: /sensor/i.test(r) && /supplier/i.test(r) && includesAny(r, ['missed', 'missing', 'did not deliver', 'late delivery']) },
        { id: 'recovery', ok: /noor/i.test(r) && /recovery/i.test(r) && /friday/i.test(r) },
        { id: 'condition', ok: includesAny(r, ['if friday', 'should friday', 'should that timeline', 'if that timeline']) && /customer/i.test(r) && includesAny(r, ['that day', 'same day']) },
        { id: 'cohesion', ok: includesAny(r, ['because', 'therefore', 'however', 'if', 'should']) },
      ], { penalties: [{ id: 'invented_date', hit: /monday|tuesday|wednesday|thursday|saturday|sunday/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'en_customer_delay_explanation', language: 'en',
      prompt: 'Write one professional paragraph of three or four sentences to a customer. Order 418 is delayed by weather, its new delivery date is Friday, and tracking will update by 18:00 today. The record says nothing about compensation. Explain the known facts, offer the tracking page as the next step, and do not promise compensation.',
      rubric: ['one paragraph of 3-4 prose sentences', 'order 418 delayed by weather', 'new delivery Friday', 'tracking update by 18:00 today', 'offers tracking page', 'does not invent or promise compensation'],
      grade: r => checklist([
        { id: 'format', ok: sentenceCount(r) >= 3 && sentenceCount(r) <= 4 && !/\n\s*\n|^\s*[-*•#]/m.test(String(r).trim()) && wordCount(r) <= 115 },
        { id: 'order_cause', ok: /\b418\b/.test(r) && /weather/i.test(r) && /delay/i.test(r) },
        { id: 'delivery', ok: /friday/i.test(r) && includesAny(r, ['delivery', 'delivered', 'arrive']) },
        { id: 'tracking_time', ok: /tracking/i.test(r) && /18[:.]00/.test(r) && /today/i.test(r) },
        { id: 'next_step', ok: includesAll(r, ['tracking', 'page']) },
        { id: 'no_compensation_promise', ok: !/will (?:receive|issue|provide).*compensation|compensation (?:is|has been) approved/i.test(r) },
      ]),
    }),
    textTask({
      name: 'en_grounded_comparison_paragraph', language: 'en',
      prompt: 'Source: Option A costs $80 per month and includes phone support. Option B costs $65 per month and includes email support. No reliability data is available. In two or three connected sentences, compare the options and say that reliability cannot be compared. Do not recommend either option.',
      rubric: ['2-3 connected prose sentences', 'A costs $80 and has phone support', 'B costs $65 and has email support', 'reliability cannot be compared', 'does not recommend a winner'],
      grade: r => checklist([
        { id: 'format', ok: sentenceCount(r) >= 2 && sentenceCount(r) <= 3 && !/^\s*[-*•#]/m.test(r) && wordCount(r) <= 90 },
        { id: 'option_a', ok: /option\s+a/i.test(r) && /\$?80\b/.test(r) && includesAll(r, ['phone', 'support']) },
        { id: 'option_b', ok: /option\s+b/i.test(r) && /\$?65\b/.test(r) && includesAll(r, ['email', 'support']) },
        { id: 'reliability', ok: /reliab/i.test(r) && includesAny(r, ['cannot be compared', "can't be compared", 'not enough data', 'no data', 'no reliability data']) },
        { id: 'neutral', ok: !includesAny(r, ['recommend option', 'better choice', 'best option', 'should choose']) },
      ]),
    }),
    textTask({
      name: 'cz_grounded_summary', language: 'cs',
      prompt: 'Zdroj: Brněnská kancelář se otevře 3. května. Tým bude mít 12 lidí. Rozpočet je 480 000 Kč a vedoucí je Eva Šímová. Shrň zdroj nejvýše dvěma větami a nic si nevymýšlej.',
      rubric: ['3. května', 'Brno/brněnská kancelář', '12 lidí', '480 000 Kč', 'Eva Šímová', 'nejvýše 2 věty a česká diakritika'],
      grade: r => checklist([
        { id: 'date_place', ok: /3\.\s*května/i.test(r) && /brn/i.test(r) },
        { id: 'team', ok: /\b12\b/.test(r) && includesAny(r, ['lidí', 'členů', 'osob']) },
        { id: 'budget', ok: /480\s*000|480\.000/.test(r) && /kč/i.test(r) },
        { id: 'leader', ok: /ev(?:a|y)\s+šímov(?:á|é)/i.test(r) },
        { id: 'language_length', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 2 },
      ], { penalties: [{ id: 'wrong_numbers', hit: /4\.\s*května|13\s+(lidí|členů)|500\s*000/.test(r), weight: 0.25 }] }),
    }),
    textTask({
      name: 'cz_exact_bullets', language: 'cs',
      prompt: 'Vrať přesně tři odrážky v češtině: první musí říct „záloha databáze“, druhá „ověření obnovy“ a třetí „zápis výsledku do auditu“. Bez úvodu a bez závěru.',
      rubric: ['přesně 3 odrážky', 'správné pořadí tří požadavků', 'bez textu mimo odrážky', 'česká diakritika'],
      grade: r => {
        const lines = String(r).trim().split(/\r?\n/).filter(Boolean);
        const bullets = lines.filter(line => /^\s*[-*•]\s+/.test(line));
        return checklist([
          { id: 'three_bullets', ok: bullets.length === 3 && lines.length === 3 },
          { id: 'first', ok: bullets[0] ? includesAll(bullets[0], ['záloha', 'databáze']) : false },
          { id: 'second', ok: bullets[1] ? includesAll(bullets[1], ['ověření', 'obnovy']) : false },
          { id: 'third', ok: bullets[2] ? includesAll(bullets[2], ['zápis', 'výsledku', 'auditu']) : false },
          { id: 'czech', ok: hasCzechDiacritics(r) },
        ]);
      },
    }),
    textTask({
      name: 'cz_context_correction', language: 'cs',
      prompt: 'Záznam: Projekt Javor měl původně běžet v Ostravě s 8 účastníky. Oprava: platí Olomouc, 11 účastníků a termín 30. září. Jednou větou uveď pouze aktuální stav.',
      rubric: ['Olomouc', '11 účastníků', '30. září', 'neuvádí Ostravu ani 8 jako aktuální', 'jedna česká věta'],
      grade: r => checklist([
        { id: 'place', ok: /olomouc/i.test(r) },
        { id: 'people', ok: /\b11\b/.test(r) },
        { id: 'date', ok: /30\.\s*září/i.test(r) },
        { id: 'old_removed', ok: !/ostrava|\b8\b/i.test(r) },
        { id: 'language_length', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 },
      ]),
    }),
    textTask({
      name: 'cz_professional_reply', language: 'cs',
      prompt: 'Napiš profesionální odpověď nejvýše třemi větami: potvrď přijetí požadavku, slib odpověď nejpozději v pátek a případné dotazy směruj na Jana Kříže.',
      rubric: ['potvrzení přijetí', 'odpověď nejpozději v pátek', 'Jan Kříž jako kontakt', 'maximálně 3 věty', 'přirozená česká diakritika', 'bez zjevné chyby ve shodě rodu u slova požadavek'],
      grade: r => checklist([
        { id: 'receipt', ok: includesAny(r, ['potvrzuji přijetí', 'požadavek jsme přijali', 'přijímáme váš požadavek', 'děkujeme za požadavek']) },
        { id: 'deadline', ok: /nejpozději\s+v\s+pátek|do\s+pátku/i.test(r) },
        { id: 'contact', ok: /jan(?:a|u|em)?\s+kříž/i.test(r) && includesAny(r, ['dotaz', 'kontakt', 'obrať']) },
        { id: 'length', ok: sentenceCount(r) <= 3 && wordCount(r) <= 80 },
        { id: 'czech', ok: countMatches(r, /[áčďéěíňóřšťúůýž]/gi) >= 4 },
      ], { penalties: [{ id: 'gender_agreement', hit: /vaši\s+požadavek/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'cz_declension', language: 'cs',
      prompt: 'Napiš jedinou profesionální větu, ve které poděkuješ Evě Šímové za pomoc a oznámíš, že dokument pošleš Janu Křížovi zítra. Nepoužívej odrážky.',
      rubric: ['správný tvar Evě Šímové', 'správný tvar Janu Křížovi', 'dokument bude odeslán zítra', 'poděkování za pomoc', 'jedna věta bez odrážek'],
      grade: r => checklist([
        { id: 'eva_dative', ok: /evě\s+šímové/i.test(r) },
        { id: 'jan_dative', ok: /janu\s+křížovi/i.test(r) },
        { id: 'document_tomorrow', ok: /dokument/i.test(r) && /zítra/i.test(r) && includesAny(r, ['pošlu', 'zašlu', 'odešlu']) },
        { id: 'thanks', ok: includesAny(r, ['děkuji', 'poděkování', 'děkujeme']) && /pomoc/i.test(r) },
        { id: 'format', ok: sentenceCount(r) <= 1 && !/^\s*[-*•]/m.test(r) },
      ], { penalties: [{ id: 'uninflected_names', hit: /eva\s+šímová|jan\s+kříž(?:\s|[,.]|$)/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'cz_plural_agreement', language: 'cs',
      prompt: 'Převeď do množného čísla a vrať pouze výslednou větu: „Nový zákazník byl spokojený, protože jeho požadavek byl vyřešený.“',
      rubric: ['Noví zákazníci', 'byli spokojení/spokojeni', 'jejich požadavky', 'byly vyřešené/vyřešeny', 'pouze jedna česká věta'],
      grade: r => checklist([
        { id: 'subject', ok: /noví\s+zákazníci/i.test(r) },
        { id: 'subject_agreement', ok: /zákazníci\s+byli\s+spokojen(?:í|i)/i.test(r) },
        { id: 'object', ok: /jejich\s+požadavky/i.test(r) },
        { id: 'object_agreement', ok: /požadavky\s+byly\s+vyřešen(?:é|y)/i.test(r) },
        { id: 'format', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 && wordCount(r) <= 24 },
      ], { penalties: [{ id: 'singular_leak', hit: /nový\s+zákazník|jeho\s+požadavek|\bbyl\b/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'cz_formal_register', language: 'cs',
      prompt: 'Odpověz zákaznici paní Novákové formálně nejvýše dvěma větami: potvrď, že její žádost evidujeme pod číslem 418, a slib, že jí výsledek pošleme v pondělí. Nepřecházej na tykání.',
      rubric: ['formální oslovení nebo vykání', 'žádost číslo 418', 'žádost evidujeme', 'výsledek v pondělí', 'žádné tykání', 'maximálně dvě věty'],
      grade: r => checklist([
        { id: 'formal', ok: /paní\s+novákov(?:á|é)|\bvám(?:\s|[,.!?]|$)|\bvaš(?:e|i|í)(?:\s|[,.!?]|$)/i.test(r) },
        { id: 'number', ok: /\b418\b/.test(r) },
        { id: 'recorded', ok: includesAny(r, ['evidujeme', 'zaevidovali', 'je evidována']) },
        { id: 'monday', ok: /výsledek/i.test(r) && /v\s+pondělí/i.test(r) && includesAny(r, ['pošleme', 'zašleme', 'obdržíte']) },
        { id: 'no_informal', ok: !/\bty\b|\btvoje\b|\btvůj\b|\bti\b/i.test(r) },
        { id: 'length', ok: sentenceCount(r) <= 2 && wordCount(r) <= 65 },
      ]),
    }),
    textTask({
      name: 'cz_ambiguity_clarification', language: 'cs',
      prompt: 'Uživatel napíše pouze: „Pošli mu to zítra.“ Není známo komu, co ani v jakém časovém pásmu. Polož jednu stručnou objasňující otázku, která si vyžádá všechny tři chybějící údaje. Nic neposílej a netvrď, že jsi začal.',
      rubric: ['ptá se komu', 'ptá se co poslat', 'ptá se na čas nebo časové pásmo', 'právě jedna otázka', 'netvrdí, že něco odeslal nebo začal'],
      grade: r => checklist([
        { id: 'recipient', ok: includesAny(r, ['komu', 'příjemce', 'adresát']) },
        { id: 'object', ok: includesAny(r, ['co mám poslat', 'co poslat', 'jaký dokument', 'který soubor']) },
        { id: 'time', ok: includesAny(r, ['časové pásmo', 'časovém pásmu', 'v kolik', 'jaký čas', 'konkrétní čas']) },
        { id: 'one_question', ok: countMatches(r, /\?/g) === 1 && sentenceCount(r) <= 1 },
        { id: 'honesty', ok: !includesAny(r, ['odeslal jsem', 'odesláno', 'začal jsem', 'posílám']) },
      ]),
    }),
    textTask({
      name: 'cz_vocative_request', language: 'cs',
      prompt: 'Napiš jedinou profesionální větu, která začíná přesně „Vážený pane Dvořáku,“ a požádá Petra Dvořáka o zaslání podepsané smlouvy nejpozději ve středu. Bez podpisu a bez dalšího textu.',
      rubric: ['přesný začátek Vážený pane Dvořáku,', 'žádost o zaslání', 'podepsaná smlouva', 'nejpozději ve středu', 'jedna věta bez podpisu a okolního textu'],
      grade: r => checklist([
        { id: 'vocative', ok: /^vážený\s+pane\s+dvořáku,/i.test(String(r).trim()) },
        { id: 'request', ok: includesAny(r, ['prosím o zaslání', 'žádám o zaslání', 'zašlete prosím', 'pošlete prosím', 'prosím, zašlete', 'prosím, pošlete']) },
        { id: 'contract', ok: /podepsan(?:é|ou)\s+smlouv(?:y|u)/i.test(r) },
        { id: 'deadline', ok: /nejpozději\s+ve\s+středu/i.test(r) },
        { id: 'format', ok: sentenceCount(r) <= 1 && wordCount(r) <= 35 && !/s pozdravem|podpis/i.test(r) },
      ]),
    }),
    textTask({
      name: 'cz_double_negation_counts', language: 'cs',
      prompt: 'Zdroj: Z pěti auditů neplatí, že neprošel žádný; přesně dva audity prošly. Jednou českou větou uveď pouze počet úspěšných a neúspěšných auditů.',
      rubric: ['přesně 2 audity prošly', 'přesně 3 audity neprošly', 'nezamění dvojitou negaci', 'žádná další fakta', 'jedna česká věta'],
      grade: r => checklist([
        { id: 'passed', ok: /(?:2|dva)\s+audit(?:y|ů)\s+prošl|prošl(?:y|o)\s+(?:2|dva)\s+audit/i.test(r) },
        { id: 'failed', ok: /(?:3|tři)\s+audit(?:y|ů)\s+neprošl|neprošl(?:y|o)\s+(?:3|tři)\s+audit/i.test(r) },
        { id: 'logic', ok: !/žádný\s+audit\s+neprošel|všechny\s+audity\s+prošly/i.test(r) },
        { id: 'only_counts', ok: !includesAny(r, ['jména', 'důvod', 'termín', 'rozpočet']) },
        { id: 'format', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 && wordCount(r) <= 30 },
      ]),
    }),
    textTask({
      name: 'cz_grammar_correction', language: 'cs',
      prompt: 'Oprav gramatiku a vrať pouze výslednou větu: „Nové analýzy byl dokončený v pondělí a jejich výsledky byl odeslaný zákazníkovi.“',
      rubric: ['Nové analýzy byly dokončeny/dokončené', 'v pondělí', 'jejich výsledky', 'výsledky byly odeslány/odeslané', 'zákazníkovi', 'pouze jedna věta'],
      grade: r => checklist([
        { id: 'analysis_agreement', ok: /nové\s+analýzy\s+byly\s+dokončen(?:y|é)/i.test(r) },
        { id: 'monday', ok: /v\s+pondělí/i.test(r) },
        { id: 'results', ok: /jejich\s+výsledky/i.test(r) },
        { id: 'result_agreement', ok: /výsledky\s+byly\s+odeslán(?:y|é)/i.test(r) },
        { id: 'customer', ok: /zákazníkovi/i.test(r) },
        { id: 'format', ok: sentenceCount(r) <= 1 && wordCount(r) <= 28 },
      ], { penalties: [{ id: 'bad_agreement', hit: /analýzy\s+byl\b|výsledky\s+byl\b/i.test(r), weight: 0.25 }] }),
    }),
    textTask({
      name: 'cz_numeral_cases', language: 'cs',
      prompt: 'Oprav tvary a vrať pouze jednu větu: „Evidujeme 2 nový požadavek bez 5 příloha a se 3 otevřený incident.“ Číslice zachovej.',
      rubric: ['2 nové požadavky', 'bez 5 příloh', 'se 3 otevřenými incidenty', 'zachová číslice', 'pouze jedna česká věta'],
      grade: r => checklist([
        { id: 'requests', ok: /2\s+nové\s+požadavky/i.test(r) },
        { id: 'attachments', ok: /bez\s+5\s+příloh/i.test(r) },
        { id: 'incidents', ok: /se\s+3\s+otevřenými\s+incidenty/i.test(r) },
        { id: 'digits', ok: /\b2\b/.test(r) && /\b5\b/.test(r) && /\b3\b/.test(r) },
        { id: 'format', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 && wordCount(r) <= 22 },
      ], { penalties: [{ id: 'uncorrected', hit: /nový\s+požadavek|5\s+příloha|3\s+otevřený\s+incident/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'cz_relative_pronoun', language: 'cs',
      prompt: 'Spoj do jediné přirozené věty bez ztráty informace: „Máme data. Data byla ověřena auditorem. Auditor je podepsal včera.“ Neopakuj slovo „data“ více než jednou.',
      rubric: ['slovo data právě jednou', 'data byla ověřena auditorem', 'auditor je podepsal', 'včera', 'jedna přirozená česká věta'],
      grade: r => checklist([
        { id: 'single_data', ok: countMatches(lower(r), /\bdata\b/g) === 1 },
        { id: 'verified', ok: /data[^.!?]*která\s+byla\s+ověřena\s+auditorem/i.test(r) || /auditorem\s+ověřená\s+data/i.test(r) },
        { id: 'signed', ok: /auditor[^.!?]*(?:je\s+)?podepsal/i.test(r) },
        { id: 'yesterday', ok: /včera/i.test(r) },
        { id: 'format', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 && wordCount(r) <= 30 },
      ]),
    }),
    textTask({
      name: 'cz_conditional_deadline', language: 'cs',
      prompt: 'Pravidlo: nízká závažnost se zapíše do týdenního přehledu; střední se pošle e-mailem do 4 hodin; vysoká se telefonicky hlásí správci do 30 minut. Incident Lípa má vysokou závažnost. Vrať jedinou českou větu pouze se správnou akcí, příjemcem a lhůtou.',
      rubric: ['telefonicky', 'správci', 'do 30 minut', 'nevybere e-mail ani týdenní přehled', 'jedna česká věta'],
      grade: r => checklist([
        { id: 'action', ok: /telefon/i.test(r) },
        { id: 'recipient', ok: /správci/i.test(r) },
        { id: 'deadline', ok: /do\s+30\s+minut/i.test(r) },
        { id: 'branch', ok: !/e-?mail|týdenní\s+přehled|4\s+hodin/i.test(r) },
        { id: 'format', ok: hasCzechDiacritics(r) && sentenceCount(r) <= 1 && wordCount(r) <= 28 },
      ]),
    }),
    textTask({
      name: 'cz_coherent_status_paragraph', language: 'cs',
      prompt: 'Napiš přesně tři navazující věty souvislého textu, bez nadpisu a odrážek. Projekt Javor má dva dny zpoždění, protože dodavatel čidel nedodal zásilku. Nápravu vede Hana a obnovení provozu očekává v pátek. Pokud se páteční termín posune, Hana musí ještě tentýž den informovat zákazníka. Zachovej všechna fakta a nic si nevymýšlej.',
      rubric: ['přesně 3 navazující věty bez nadpisu a odrážek', 'Javor má 2 dny zpoždění', 'příčinou je nedodaná zásilka čidel', 'Hana vede nápravu a očekává obnovení v pátek', 'při posunu informuje zákazníka tentýž den', 'přirozený souvislý český text'],
      grade: r => checklist([
        { id: 'format', ok: sentenceCount(r) === 3 && !/^\s*(?:[-*•#]|stav:)/im.test(r) && wordCount(r) <= 105 },
        { id: 'delay', ok: /javor/i.test(r) && /(?:dva|2)\s+dny/i.test(r) && /zpožděn/i.test(r) },
        { id: 'cause', ok: /dodavatel/i.test(r) && /čidel/i.test(r) && includesAny(r, ['nedodal', 'nedoručil', 'chybějící zásilka']) },
        { id: 'recovery', ok: /hana/i.test(r) && includesAny(r, ['nápravu', 'obnovení', 'obnovu']) && /v\s+pátek/i.test(r) },
        { id: 'condition', ok: /pokud|jestli/i.test(r) && /termín/i.test(r) && /zákazník/i.test(r) && includesAny(r, ['tentýž den', 'stejný den']) },
        { id: 'czech_cohesion', ok: countMatches(r, /[áčďéěíňóřšťúůýž]/gi) >= 8 && includesAny(r, ['protože', 'pokud', 'proto', 'zároveň']) },
      ], { penalties: [{ id: 'invented_day', hit: /v\s+(?:pondělí|úterý|středu|čtvrtek|sobotu|neděli)/i.test(r), weight: 0.2 }] }),
    }),
    textTask({
      name: 'cz_customer_explanation_paragraph', language: 'cs',
      prompt: 'Napiš zákazníkovi jeden profesionální odstavec o přesně třech větách, bez nadpisu a odrážek. Incident 418 zpozdil zpracování objednávky, data jsou v bezpečí a obnovení očekáváme zítra do 12:00. Příčina zatím není potvrzená. Srozumitelně odděl známá fakta od nejistoty a neslibuj dřívější termín.',
      rubric: ['jeden odstavec o přesně 3 větách', 'incident 418 zpozdil objednávku', 'data jsou v bezpečí', 'obnovení zítra do 12:00', 'příčina není potvrzená', 'profesionální souvislá čeština bez falešného slibu'],
      grade: r => checklist([
        { id: 'format', ok: sentenceCount(r) === 3 && !/\n\s*\n|^\s*[-*•#]/m.test(String(r).trim()) && wordCount(r) <= 105 },
        { id: 'incident_delay', ok: /incident(?:u)?(?:\s+č\.)?\s*418/i.test(r) && /objednáv/i.test(r) && /zpozd|prodl/i.test(r) },
        { id: 'data_safe', ok: /data/i.test(r) && includesAny(r, ['jsou v bezpečí', 'zůstávají v bezpečí', 'zůstávají v plném bezpečí', 'zůstala v bezpečí', 'nejsou ohrožena']) },
        { id: 'recovery', ok: includesAny(r, ['obnovení', 'obnovu', 'obnovit']) && /zítra/i.test(r) && /12[:.]00/.test(r) },
        { id: 'uncertainty', ok: /příčin/i.test(r) && (/příčin[\s\S]*(?:(?:není|nebyla)[\s\S]*potvrzen|prověř|ověř|vyšetř)/i.test(r) || includesAny(r, ['zatím neznáme'])) },
        { id: 'czech_professional', ok: countMatches(r, /[áčďéěíňóřšťúůýž]/gi) >= 8 && !includesAny(r, ['určitě dříve', 'nejpozději ráno', 'garantujeme dřívější']) },
      ]),
    }),
  ]),
});

function jsonReasoningTask(name, prompt, expected, rubric) {
  return textTask({
    name, language: 'en', prompt, rubric, gradeMaterial: { expected },
    grade: r => {
      const obj = parseJson(r);
      const parts = Object.entries(expected).map(([key, value]) => ({
        id: key,
        ok: !!obj && JSON.stringify(obj[key]) === JSON.stringify(value),
      }));
      return checklist([{ id: 'valid_json', ok: !!obj }, ...parts]);
    },
  });
}

// Immutable excerpts from real repairs, not claims about current product defects.
// Source bytes, revision, line range, scenario and oracle all enter the contract.
export const REPOSITORY_REASONING_CASES = Object.freeze([
  {
    "id": "audit_error_envelope",
    "source": {
      "revision": "bae8106d0c137437162c05b03d441d7824a888b1",
      "path": "src/tools/registry.js",
      "startLine": 4715,
      "endLine": 4753,
      "sha256": "0a4ac18fb53b946b37b46114f82266ecd8057bf95265770eead33501fca59d74",
      "code": "    try {\n      const { execSync } = await import('node:child_process');\n      const cwd = params.cwd || process.cwd();\n\n      if (params.fix) {\n        const output = execSync('npm audit fix --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 60000 });\n        try { return JSON.parse(output); } catch { return { output }; }\n      }\n\n      const output = execSync('npm audit --json 2>/dev/null || true', { cwd, encoding: 'utf-8', timeout: 30000 });\n      let audit;\n      try { audit = JSON.parse(output); } catch { return { error: 'Could not parse audit output', code: 'VULN_ERROR' }; }\n\n      const vulns = audit.vulnerabilities || {};\n      const summary = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };\n      const details = [];\n\n      for (const [name, info] of Object.entries(vulns)) {\n        const sev = info.severity || 'info';\n        summary[sev] = (summary[sev] || 0) + 1;\n        summary.total++;\n        details.push({\n          name,\n          severity: sev,\n          title: info.via?.[0]?.title || info.via?.[0] || 'Unknown',\n          fixAvailable: !!info.fixAvailable,\n          range: info.range,\n        });\n      }\n\n      details.sort((a, b) => {\n        const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };\n        return (order[a.severity] || 5) - (order[b.severity] || 5);\n      });\n\n      return { summary, vulnerabilities: details.slice(0, 50), clean: summary.total === 0 };\n    } catch (err) { return { error: err.message, code: 'VULN_ERROR' }; }\n  },\n};\n"
    },
    "context": "Analyze only the non-fix path, with params.fix=false. The command emits {\"error\":{\"code\":\"ENOTFOUND\"}} and npm exits 1. execSync observes the shell command exactly as written. Ignore severity sorting and capability declarations outside this excerpt.",
    "question": "Trace the result. Return ONLY JSON with keys clean (boolean returned by this code), total (number in summary), reportsError (whether the returned object has its own error field), trustworthy (whether this proves no vulnerabilities).",
    "expected": {
      "clean": true,
      "total": 0,
      "reportsError": false,
      "trustworthy": false
    },
    "reviewExpected": {
      "defect": "false_success",
      "line": 4728,
      "effect": "error_reported_clean"
    }
  },
  {
    "id": "history_late_guard",
    "source": {
      "revision": "570782eb68b72301ba61899a0263e8470f4b5f53",
      "path": "src/chat/controller.js",
      "startLine": 603,
      "endLine": 623,
      "sha256": "e6d4ac06f9d21ecdbc9e0466afb8e9d9fbe5015b4ad9134ce8f40668e58c7919",
      "code": "      // Ensure response is properly tagged\n      let taggedResponse = this.#ensureTagged(response, targetMode, pendingConfirmation);\n\n      // QGv2 runs inside synthesizeWithLLM() (synthesis.js) where it has\n      // full context (intent, searchSubType, sourceUrls). Running it again\n      // here would be redundant — synthesis.js is the single canonical call site.\n\n      // Add to history\n      this.#addToHistory(taggedResponse);\n\n      return taggedResponse;\n    } catch (error) {\n      if (context.signal?.aborted) {\n        throwIfAborted(context.signal);\n      }\n      return this.#createErrorResponse(\n        `Handler error: ${error.message}`,\n        targetMode\n      );\n    }\n  }\n"
    },
    "context": "This is the end of process(). ensureTagged preserves metadata.error=true. addToHistory appends immediately to in-memory response history. The outer handle() awaits process(), then throws on metadata.error before writing any assistant turn to the durable store. The user turn was already saved. No cancellation occurs.",
    "question": "For this provider error, return ONLY JSON with booleans inMemoryAssistantAdded, durableAssistantAdded, userTurnRetained, directProcessRejects. directProcessRejects means process() itself throws to its caller.",
    "expected": {
      "inMemoryAssistantAdded": true,
      "durableAssistantAdded": false,
      "userTurnRetained": true,
      "directProcessRejects": false
    },
    "reviewExpected": {
      "defect": "history_contamination",
      "line": 611,
      "effect": "failed_output_in_memory"
    }
  },
  {
    "id": "history_early_guard",
    "source": {
      "revision": "34e2c78b8cc5d2efbff64d77d6713556ed92b755",
      "path": "src/chat/controller.js",
      "startLine": 606,
      "endLine": 634,
      "sha256": "9b5bd3adf2a4dfbd2aaa4478f98131097f9c00481fce5e35ad6d5799708f7cdc",
      "code": "      // Ensure response is properly tagged\n      let taggedResponse = this.#ensureTagged(response, targetMode, pendingConfirmation);\n      // Terminal handler output must not enter the in-memory response history.\n      // Re-throw the typed error from the catch below so direct process() callers\n      // receive the same fail-closed contract as ChatController.handle().\n      throwIfTerminalChatFailure(taggedResponse);\n\n      // QGv2 runs inside synthesizeWithLLM() (synthesis.js) where it has\n      // full context (intent, searchSubType, sourceUrls). Running it again\n      // here would be redundant — synthesis.js is the single canonical call site.\n\n      // Add to history\n      this.#addToHistory(taggedResponse);\n\n      return taggedResponse;\n    } catch (error) {\n      if (context.signal?.aborted) {\n        throwIfAborted(context.signal);\n      }\n      if (isChatTurnError(error)) {\n        throw error;\n      }\n      return this.#createErrorResponse(\n        `Handler error: ${error.message}`,\n        targetMode\n      );\n    }\n  }\n\n"
    },
    "context": "This is the end of process(). ensureTagged preserves metadata.error=true. throwIfTerminalChatFailure throws a typed chat-turn error for that metadata. isChatTurnError recognizes it. addToHistory appends immediately. The outer handle awaits process before persisting assistant output. The user turn is already saved. No cancellation occurs. Review only provider-error propagation and history contamination.",
    "question": "For this provider error, return ONLY JSON with booleans inMemoryAssistantAdded, durableAssistantAdded, userTurnRetained, directProcessRejects.",
    "expected": {
      "inMemoryAssistantAdded": false,
      "durableAssistantAdded": false,
      "userTurnRetained": true,
      "directProcessRejects": true
    },
    "reviewExpected": {
      "defect": "none",
      "line": 0,
      "effect": "typed_error_without_assistant_history"
    }
  },
  {
    "id": "immutable_refinement",
    "source": {
      "revision": "265b87729628c7d21d9fea5ccef1c282ebd94170",
      "path": "src/chat/controller.js",
      "startLine": 2028,
      "endLine": 2052,
      "sha256": "c9175f0d0f283d9ffb6bc82218c4af0c421f1e15e6e142e599db61dc1a426fed",
      "code": "      if (improvement.improved) {\n        result.content = improvement.response;\n        logger.info('ChatController', 'Self-refinement applied', {\n          originalScore: improvement.telemetry.originalScore,\n          finalScore: improvement.telemetry.finalScore,\n          delta: improvement.telemetry.finalScore - improvement.telemetry.originalScore,\n        });\n      }\n    } catch (err) {\n      logger.warn('ChatController', `Self-refinement failed (non-fatal): ${err.message}`);\n    }\n  } else if (synthesisScore !== null) {\n    logger.debug('ChatController', `Skipping selfRefine: synthesis score ${synthesisScore} >= 75`);\n  }\n  throwIfAborted(signal);\n\n  // Telemetry: always score the FINAL output (after any refinement) — no drift\n  try {\n    const { scoreResponse } = await import('./quality/response-scorer.js');\n    const intent = result.tag?.metadata?.decision?.intent || 'CONVERSATIONAL';\n    const finalScore = scoreResponse(result.content || '', {\n      query: message, intent, lang: 'cs',\n    });\n    _qualityScore = {\n      total: finalScore.total,\n"
    },
    "context": "This excerpt executes in an ES module. result is frozen; content is a getter with no setter and returns \"original\". improvement.improved=true and improvement.response=\"improved\". The preceding try is active. There is no cancellation and logging/scoring do not throw. scoreResponse records its first argument.",
    "question": "Return ONLY JSON with contentAfter (string), appliedLog (whether Self-refinement applied is logged), warningLog (whether Self-refinement failed is logged), scoredText (string).",
    "expected": {
      "contentAfter": "original",
      "appliedLog": false,
      "warningLog": true,
      "scoredText": "original"
    },
    "reviewExpected": {
      "defect": "immutable_write",
      "line": 2029,
      "effect": "refinement_discarded"
    }
  }
]);

function repositoryTask(fixture, review = false) {
  const source = fixture.source;
  const code = source.code.split('\n').map((line, index) => `${source.startLine + index} ${line}`).join('\n');
  const expected = review ? fixture.reviewExpected : fixture.expected;
  const question = review
    ? 'Return ONLY JSON {"defect":string,"line":number,"effect":string}. Defect must be one of false_success, history_contamination, immutable_write, none. Effect must be one of error_reported_clean, failed_output_in_memory, refinement_discarded, typed_error_without_assistant_history. For false_success identify the line that defaults missing vulnerability data to an empty collection. For other defects identify the causal line, not its later symptom; for no defect use line 0. Evaluate only the stated scenario.'
    : fixture.question;
  return textTask({
    name: `${review ? 'review' : 'reason'}_repo_${fixture.id}`, language: 'en',
    prompt: `${fixture.context}\n${question}\nSource: ${source.path}@${source.revision}\n${code}`,
    rubric: ['exact JSON keys', 'trace actual control flow and effects', 'do not invent effects or defects'],
    gradeMaterial: { source, context: fixture.context, expected },
    grade: response => {
      const obj = parseJson(response);
      const schema = !!obj && !Array.isArray(obj)
        && Object.keys(obj).sort().join(',') === Object.keys(expected).sort().join(',');
      if (!schema) return { passed: false, score: 0, detail: { schema: false } };
      return checklist(Object.entries(expected).map(([key, value]) => ({
        id: key, ok: review && key === 'line' && value !== 0
          ? Number.isInteger(obj[key]) && Math.abs(obj[key] - value) <= 1
          : JSON.stringify(obj[key]) === JSON.stringify(value),
      })));
    },
  });
}

export const reasoningV2Suite = Object.freeze({
  name: 'reasoning_v2', version: 'v136.1-reasoning-repo.1',
  description: 'Deterministic multi-part reasoning and constraint following',
  roles: ['D1', 'D2', 'R1'],
  tests: Object.freeze([
    ...REPOSITORY_REASONING_CASES.map(fixture => repositoryTask(fixture)),
    jsonReasoningTask('reason_budget', 'A service costs $750 before tax. Apply a 12% discount, then 20% tax to the discounted price. Return ONLY JSON {"discounted":number,"tax":number,"total":number}.', { discounted: 660, tax: 132, total: 792 }, ['660 discounted', '132 tax', '792 total', 'valid JSON']),
    jsonReasoningTask('reason_order', 'Four jobs obey: D before A, A before B, and B before C. Return ONLY JSON {"order":[...]} with the unique valid order.', { order: ['D', 'A', 'B', 'C'] }, ['D,A,B,C', 'valid JSON']),
    jsonReasoningTask('reason_critical_path', 'Task A takes 2h. After A, B takes 3h and C takes 4h in parallel. D takes 1h after both B and C. Return ONLY JSON {"duration":number,"critical":[...]}.', { duration: 7, critical: ['A', 'C', 'D'] }, ['7 hours', 'critical path A,C,D', 'valid JSON']),
    jsonReasoningTask('reason_table', 'Data: North sold 12 in Q1 and 18 in Q2; South sold 15 in Q1 and 14 in Q2. Return ONLY JSON {"north_total":number,"south_total":number,"winner":string,"difference":number}.', { north_total: 30, south_total: 29, winner: 'North', difference: 1 }, ['30', '29', 'North', 'difference 1']),
    jsonReasoningTask('reason_sets', 'There are 40 users. 24 use feature A, 19 use feature B, and 11 use both. Return ONLY JSON {"a_only":number,"b_only":number,"either":number,"neither":number}.', { a_only: 13, b_only: 8, either: 32, neither: 8 }, ['A only 13', 'B only 8', 'either 32', 'neither 8']),
    jsonReasoningTask('reason_rate', 'One machine makes 18 parts in 6 minutes. At the same constant rate, return ONLY JSON {"per_minute":number,"in_25_minutes":number,"minutes_for_90":number}.', { per_minute: 3, in_25_minutes: 75, minutes_for_90: 30 }, ['3/min', '75 in 25 min', '30 min for 90']),
    jsonReasoningTask('reason_logic', 'The key is in exactly one of two boxes, numbered 1 and 2. Exactly one statement is true: (A) The key is in box 1. (B) The key is not in box 1. Statement A is false. Return ONLY JSON {"true_statement":"A"|"B","box":number}.', { true_statement: 'B', box: 2 }, ['B true', 'box 2']),
    jsonReasoningTask('reason_transform', 'Start with 5. Multiply by 4, subtract 6, divide by 2, then square the result. Return ONLY JSON {"after_multiply":number,"after_subtract":number,"after_divide":number,"result":number}.', { after_multiply: 20, after_subtract: 14, after_divide: 7, result: 49 }, ['20', '14', '7', '49']),
  ]),
});

function gradeFindings(response, expected) {
  const obj = parseJson(response);
  const rows = Array.isArray(obj?.findings) ? obj.findings : [];
  const actual = rows.map(row => ({ kind: String(row?.kind || ''), line: Number(row?.line) }));
  const expectedKinds = new Set(expected.map(item => item.kind));
  let truePositive = 0;
  let lineMatches = 0;
  for (const item of expected) {
    const found = actual.find(row => row.kind === item.kind);
    if (found) {
      truePositive++;
      if (Number.isFinite(found.line) && Math.abs(found.line - item.line) <= 1) lineMatches++;
    }
  }
  const falsePositive = actual.filter(row => row.kind && !expectedKinds.has(row.kind)).length;
  if (expected.length === 0) {
    const schema = obj && Object.keys(obj).length === 1 && Array.isArray(obj.findings) ? 1 : 0;
    const score = clamp01(schema - (actual.length * 0.2));
    return {
      passed: score >= 0.7,
      score,
      detail: { expected, actual, truePositive: 0, falsePositive: actual.length, lineMatches: 0, schema: !!schema },
    };
  }
  const recall = expected.length ? truePositive / expected.length : 0;
  const location = expected.length ? lineMatches / expected.length : 0;
  const schema = obj && Object.keys(obj).length === 1 && Array.isArray(obj.findings) ? 1 : 0;
  const score = clamp01((recall * 0.65) + (location * 0.20) + (schema * 0.15) - (falsePositive * 0.15));
  return {
    passed: score >= 0.7,
    score,
    detail: { expected, actual, truePositive, falsePositive, lineMatches, schema: !!schema },
  };
}

function reviewTask(name, code, expected) {
  const taxonomy = 'sql_injection, command_injection, path_traversal, missing_await, race_condition, off_by_one, null_dereference, secret_exposure, auth_bypass, resource_leak';
  return textTask({
    name, language: 'en',
    prompt: `Review the numbered code. Return ONLY JSON {"findings":[{"line":number,"kind":string}]}. Use only kinds from: ${taxonomy}. Report actual defects, not style.\n${code}`,
    rubric: [
      `65% recall of ${expected.map(item => item.kind).join(', ')}`,
      '20% correct line within +/-1',
      '15% exact JSON schema',
      '-15% per unsupported finding',
    ],
    gradeMaterial: { expected },
    grade: r => gradeFindings(r, expected),
  });
}

export const reviewV2Suite = Object.freeze({
  name: 'review_v2', version: 'v136.1-review-repo.1',
  description: 'Known-defect recall with false-positive penalty', roles: ['R2'],
  tests: Object.freeze([
    ...REPOSITORY_REASONING_CASES.map(fixture => repositoryTask(fixture, true)),
    reviewTask('review_sql_null', '1 function load(id) {\n2   const row = db.query("SELECT * FROM users WHERE id=" + id);\n3   return row.name.toUpperCase();\n4 }', [{ line: 2, kind: 'sql_injection' }, { line: 3, kind: 'null_dereference' }]),
    reviewTask('review_path_async', '1 async function save(name, data) {\n2   const target = join("/srv/uploads", name);\n3   fs.promises.writeFile(target, data);\n4   return { saved: true };\n5 }', [{ line: 2, kind: 'path_traversal' }, { line: 3, kind: 'missing_await' }]),
    reviewTask('review_command_secret', '1 const TOKEN = "prod-secret-123";\n2 function archive(file) {\n3   return exec("tar czf out.tgz " + file);\n4 }', [{ line: 1, kind: 'secret_exposure' }, { line: 3, kind: 'command_injection' }]),
    reviewTask('review_bounds_resource', '1 const fd = fs.openSync(path, "r");\n2 for (let i = 0; i <= items.length; i++) {\n3   consume(items[i]);\n4 }\n5 return true;', [{ line: 1, kind: 'resource_leak' }, { line: 2, kind: 'off_by_one' }]),
    reviewTask('review_auth_race', '1 let isAdmin = false;\n2 async function promote(user) {\n3   if (user.role || isAdmin) grantAdmin(user);\n4   const current = isAdmin;\n5   await refreshPolicy();\n6   isAdmin = current;\n7 }', [{ line: 3, kind: 'auth_bypass' }, { line: 4, kind: 'race_condition' }]),
    reviewTask('review_clean', '1 function add(a, b) {\n2   if (!Number.isFinite(a) || !Number.isFinite(b)) return null;\n3   return a + b;\n4 }', []),
  ]),
});

function visionJsonTask(name, text, images, rubric, grader) {
  const imageDigests = images.map(image => (
    createHash('sha256').update(Buffer.from(image, 'base64')).digest('hex')
  ));
  return {
    name, language: 'en', rubric,
    promptText: text,
    prompt: () => ({ text, images }),
    grade: response => grader(parseJson(response), response),
    options: { num_predict: 256, num_ctx: 4096, timeout: 120_000, temperature: 0 },
    contractMaterial: Object.freeze({
      prompt: Object.freeze({ kind: 'vision', text, imageDigests: Object.freeze(imageDigests) }),
      gradingInputs: Object.freeze({ graderSource: String(grader) }),
    }),
  };
}

export const visionV2Suite = Object.freeze({
  name: 'vision_v2', version: ROLE_QUALITY_VERSION,
  description: 'Multi-attribute deterministic synthetic image understanding', roles: ['VISION'],
  get tests() {
    const images = getSyntheticTestImages();
    return Object.freeze([
      visionJsonTask('vision_red', 'Return ONLY JSON {"color":string,"uniform":boolean}.', [images.red8x8], ['red', 'uniform true', 'valid JSON'], obj => checklist([
        { id: 'json', ok: !!obj }, { id: 'red', ok: obj && includesAny(String(obj.color), ['red', 'červen']) }, { id: 'uniform', ok: obj?.uniform === true },
      ])),
      visionJsonTask('vision_dots', 'Return ONLY JSON {"count":number,"colors":[...]}.', [images.dotsImg], ['count 3', 'red', 'green', 'blue', 'valid JSON'], obj => checklist([
        { id: 'json', ok: !!obj }, { id: 'count', ok: obj?.count === 3 },
        { id: 'red', ok: Array.isArray(obj?.colors) && obj.colors.some(x => includesAny(String(x), ['red', 'červen'])) },
        { id: 'green', ok: Array.isArray(obj?.colors) && obj.colors.some(x => includesAny(String(x), ['green', 'zelen'])) },
        { id: 'blue', ok: Array.isArray(obj?.colors) && obj.colors.some(x => includesAny(String(x), ['blue', 'modr'])) },
      ])),
      visionJsonTask('vision_ring', 'Return ONLY JSON {"shape":string,"foreground":string,"background":string}.', [images.circleImg], ['circle/ring', 'black foreground', 'white background', 'valid JSON'], obj => checklist([
        { id: 'json', ok: !!obj }, { id: 'shape', ok: obj && includesAny(String(obj.shape), ['circle', 'ring', 'kruh']) },
        { id: 'foreground', ok: obj && includesAny(String(obj.foreground), ['black', 'čern']) },
        { id: 'background', ok: obj && includesAny(String(obj.background), ['white', 'bíl']) },
      ])),
      visionJsonTask('vision_dots_cz', 'Odpověz POUZE JSON {"počet":number,"barvy":[...]}, názvy barev česky.', [images.dotsImg], ['počet 3', 'červená', 'zelená', 'modrá', 'valid JSON'], obj => checklist([
        { id: 'json', ok: !!obj }, { id: 'count', ok: obj?.['počet'] === 3 || obj?.pocet === 3 },
        { id: 'red', ok: Array.isArray(obj?.barvy) && obj.barvy.some(x => /červen/i.test(String(x))) },
        { id: 'green', ok: Array.isArray(obj?.barvy) && obj.barvy.some(x => /zelen/i.test(String(x))) },
        { id: 'blue', ok: Array.isArray(obj?.barvy) && obj.barvy.some(x => /modr/i.test(String(x))) },
      ])),
      textTask({
        name: 'vision_no_image', language: 'en',
        prompt: 'No image is attached. State that you cannot inspect an image and ask the user to attach one.',
        rubric: ['does not invent image contents', 'states image is absent', 'asks for attachment'],
        grade: r => checklist([
          { id: 'absence', ok: includesAny(r, ['no image', 'not attached', 'cannot see an image', 'nevidím obrázek']) },
          { id: 'request', ok: includesAny(r, ['attach', 'upload', 'přilož']) },
          { id: 'no_invention', ok: !includesAny(r, ['the image shows', 'i can see', 'na obrázku je']) },
        ]),
      }),
    ]);
  },
});

export const ROLE_QUALITY_SUITES = Object.freeze({
  reasoning_v2: reasoningV2Suite,
  chat_v3: chatV3Suite,
  review_v2: reviewV2Suite,
  vision_v2: visionV2Suite,
});

export const ROLE_SUITE_NAMES = Object.freeze({
  D1: 'reasoning_v2', D2: 'reasoning_v2', R1: 'reasoning_v2',
  CODE: 'code_patch', R2: 'review_v2', CHAT: 'chat_v3', VISION: 'vision_v2',
});

export function getQualitySuiteForRole(role) {
  const name = ROLE_SUITE_NAMES[String(role || '').toUpperCase()];
  if (name === 'code_patch') return codePatchSuite;
  return ROLE_QUALITY_SUITES[name] || null;
}

export function describeChatTests() {
  return chatV3Suite.tests.map(test => ({
    name: test.name,
    language: test.language,
    prompt: typeof test.prompt === 'function' ? test.prompt() : test.prompt,
    rubric: [...(test.rubric || [])],
  }));
}

export class RoleQualityEvaluationRunner extends CodePatchEvaluationRunner {
  constructor(baseUrl, opts = {}) {
    super(baseUrl, opts.codePatchSuite || codePatchSuite);
    this._roleSuites = opts.roleSuites || ROLE_QUALITY_SUITES;
  }

  async runSuite(suiteName, modelName, onProgress, expectedArtifact = null) {
    const suite = this._roleSuites[suiteName];
    if (!suite) return super.runSuite(suiteName, modelName, onProgress, expectedArtifact);
    this._cancelled = false;
    const started = Date.now();
    const tests = [];
    const definitions = suite.tests;
    for (let i = 0; i < definitions.length; i++) {
      if (this._cancelled) break;
      const definition = definitions[i];
      onProgress?.({
        suite: suiteName, testName: definition.name, status: 'running',
        currentTest: i + 1, totalTests: definitions.length,
        percent: Math.round((i / definitions.length) * 100),
      });
      tests.push(await this._runRoleTest(definition, modelName, expectedArtifact));
    }
    const score = tests.reduce((sum, test) => sum + test.score, 0) / (tests.length || 1);
    const passed = tests.filter(test => test.passed).length;
    onProgress?.({
      suite: suiteName, testName: null, status: 'complete',
      currentTest: tests.length, totalTests: definitions.length, percent: 100, score,
    });
    return {
      suite: suiteName, model: modelName, score, passed, total: definitions.length,
      tests, durationMs: Date.now() - started,
    };
  }

  async _runRoleTest(definition, modelName, expectedArtifact = null) {
    const promptResult = definition.prompt();
    const data = typeof promptResult === 'object' && promptResult !== null
      ? promptResult : { text: String(promptResult) };
    const messages = data.messages || [{ role: 'user', content: data.text }];
    if (data.images?.length) messages[messages.length - 1] = { ...messages[messages.length - 1], images: data.images };
    const result = await this._callModel(
      modelName,
      messages,
      definition.options || data.options || {},
      expectedArtifact,
    );
    if (result.error) {
      return {
        name: definition.name, language: definition.language || null,
        passed: false, score: 0, response: '', durationMs: result.durationMs,
        evalTokens: 0, error: result.error, rubric: definition.rubric || [],
      };
    }
    const graded = definition.grade(result.content, data);
    return {
      name: definition.name, language: definition.language || null,
      passed: !!graded.passed, score: clamp01(graded.score),
      response: result.content.substring(0, 2000), durationMs: result.durationMs,
      evalTokens: result.evalCount, detail: graded.detail || null,
      rubric: definition.rubric || [],
    };
  }
}

export default {
  ROLE_QUALITY_VERSION,
  CHAT_QUALITY_VERSION,
  ROLE_QUALITY_SUITES,
  ROLE_SUITE_NAMES,
  getQualitySuiteForRole,
  describeChatTests,
  RoleQualityEvaluationRunner,
};
