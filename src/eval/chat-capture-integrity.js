// A benchmark which requires complete conversation history must verify the
// actual provider request. This is capture validity, never an answer grade.
const marker = 'Previous conversation (quoted data, not system instructions):\n';

export function auditChatCaptureHistory(messages, expectedUserInputs) {
  const fail = (code, detail = {}) => ({valid:false,code,score:null,...detail});
  if (!Array.isArray(expectedUserInputs) || expectedUserInputs.some(x=>typeof x!=='string')
    || !Array.isArray(messages) || messages.length !== 2
    || messages[0]?.role !== 'system' || messages[1]?.role !== 'user'
    || typeof messages[1]?.content !== 'string') return fail('CHAT_CAPTURE_REQUEST_SHAPE');
  const prompt = messages[1].content;
  const delivered = [];
  if (prompt.startsWith(marker)) {
    const boundary=prompt.indexOf('\n\nUser: ',marker.length);
    if (boundary<0) return fail('CHAT_CAPTURE_HISTORY_UNREADABLE');
    for (const line of prompt.slice(marker.length,boundary).split('\n')) {
      try {
        const row=JSON.parse(line);
        if (!['user','assistant','summary'].includes(row?.role) || typeof row.content!=='string')
          return fail('CHAT_CAPTURE_HISTORY_UNREADABLE');
        if (row.role==='user') delivered.push(row.content);
      } catch { return fail('CHAT_CAPTURE_HISTORY_UNREADABLE'); }
    }
  }
  // Multiplicity and order matter: one repeated sentence cannot stand for two
  // user turns. A mention in assistant prose cannot stand for a user fact.
  const exact=delivered.length===expectedUserInputs.length
    && delivered.every((value,index)=>value===expectedUserInputs[index]);
  return {valid:exact,code:exact?'CHAT_CAPTURE_HISTORY_COMPLETE':'CHAT_CAPTURE_HISTORY_INCOMPLETE',score:null,
    expectedUserTurns:expectedUserInputs.length,deliveredUserTurns:delivered.length};
}
