// Prepared development collection, deliberately not registered in role plans.
// Prompts changed: historic single-turn answers cannot be reused here.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CHAT_CONVERSATION_FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/chat-conversation-draft.json', import.meta.url), 'utf8'));
export function validateConversationFixture(fixture) {
  if (fixture.status !== 'PREPARED_NOT_VALIDATED' || fixture.decisionReady !== false || fixture.notAHoldout !== true)
    throw Error('CHAT_DRAFT_AUTHORITY_INVALID');
  if (new Set(fixture.scenarios.map(s=>s.id)).size !== fixture.scenarios.length) throw Error('CHAT_DUPLICATE_SCENARIO');
  if (fixture.scenarios.filter(s=>s.strictJson).length !== 1) throw Error('CHAT_STRICT_JSON_SCENARIO_COUNT');
  for (const s of fixture.scenarios) {
    if (!s.ability || s.criteria.length !== 4 || s.criteria.some(c=>!c.id || !c.axis || !c.requirement || !c.evidence || !c.excludes)
      || new Set(s.criteria.map(c=>c.id)).size !== 4 || !s.referenceChecks.length) throw Error('CHAT_RUBRIC_INVALID:'+s.id);
    if (Object.keys(s.turns).sort().join(',') !== 'cs,en' || s.turns.cs.length !== s.turns.en.length
      || s.turns.cs.length < 1 || s.turns.cs.length > 4) throw Error('CHAT_LANGUAGE_PAIR_INVALID:'+s.id);
    for (const language of ['cs','en']) {
      if (s.turns[language].some(t=>typeof t !== 'string' || !t.trim())) throw Error('CHAT_EMPTY_TURN');
      if (!s.positiveExample[language] || !s.negativeExample[language]) throw Error('CHAT_REFERENCE_MISSING');
    }
  }
  return true;
}
validateConversationFixture(CHAT_CONVERSATION_FIXTURE);
const fixture = CHAT_CONVERSATION_FIXTURE;
export const chatConversationDraft = Object.freeze({
  name:'chat_conversation_draft', version:fixture.version, roles:['CHAT'],
  status:fixture.status, decisionReady:false, measurementReady:false, notAHoldout:true,
  tests:Object.freeze(fixture.scenarios.flatMap(s=>['cs','en'].map(language=>({
    name:`${language}_${s.id}`, role:'CHAT', language, tier:'T4',
    independenceGroup:s.id, description:s.title[language],
    options:{num_ctx:16384,num_predict:2048,temperature:0.1,top_p:0.9,timeout:300000},
    rubric:s.criteria, formatRubric:s.strictJson?['Exactly the requested JSON, no surrounding prose.']:[],
    prompt:()=>({conversationTurns:s.turns[language].map(content=>({role:'user',content}))}),
    contractMaterial:{prompt:{kind:'live-conversation',language,turns:s.turns[language]},
      gradingInputs:{criteria:s.criteria,referenceChecks:s.referenceChecks,
        positiveExample:s.positiveExample[language],negativeExample:s.negativeExample[language],
        policy:fixture.rubricPolicy,strictJson:!!s.strictJson}},
    grade:()=>({valid:false,score:null,passed:false,detail:{reason:'CHAT_CONVERSATION_GRADER_NOT_ACCEPTED'}}),
  })))),
});
export const chatConversationDraftSha256=createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
