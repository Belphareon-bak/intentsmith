// A real continuation uses this candidate's own earlier answers. Fixed
// assistant exemplars and grader references must never enter the conversation.
import { createHash } from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export async function captureConversation({ turns, model, artifact, options, call, onTurn = () => {} }) {
  if (!Array.isArray(turns) || turns.length<1 || turns.length>4
    || turns.some(t=>t.role!=='user' || typeof t.content!=='string' || !t.content.trim()
      || Object.keys(t).some(k=>!['role','content'].includes(k)))) throw Error('CONVERSATION_INPUT_INVALID');
  if (!/^[a-f0-9]{64}$/.test(artifact?.digestSha256 || '') || !artifact.providerVersion) throw Error('CONVERSATION_IDENTITY_REQUIRED');
  const messages=[], transcript=[], receipts=[];
  let result;
  for (const [index,user] of turns.entries()) {
    messages.push(structuredClone(user));
    await onTurn({turn:index+1,totalTurns:turns.length,status:'running'});
    const input=structuredClone(messages);
    try { result=await call(model,input,options,artifact); }
    catch(error) { result={content:'',error:error.code || error.message,doneReason:null}; }
    if (result.digestSha256 !== artifact.digestSha256 || result.providerVersion !== artifact.providerVersion) {
      result={...result,error:result.error || 'CONVERSATION_ARTIFACT_DRIFT'};
    }
    const response=typeof result.content==='string'?result.content:'';
    const captureStatus=result.error?'TRANSPORT_ERROR':result.doneReason==='length'?'OUTPUT_BUDGET_EXHAUSTED':'CAPTURED';
    transcript.push({...user},{role:'assistant',content:response});
    receipts.push({turn:index+1,inputSha256:sha(messages),responseSha256:sha(response),
      captureStatus,error:result.error || null,artifact:{digestSha256:result.digestSha256 || null,providerVersion:result.providerVersion || null},
      durationMs:result.durationMs ?? null,evalTokens:result.evalCount ?? null,promptEvalTokens:result.promptEvalCount ?? null,
      doneReason:result.doneReason || null});
    await onTurn({turn:index+1,totalTurns:turns.length,status:captureStatus});
    // A failed or truncated intermediate turn cannot be hidden by a later one.
    if(captureStatus!=='CAPTURED')break;
    messages.push({role:'assistant',content:response});
  }
  const last=receipts.at(-1);
  return {response:result.content || '',captureStatus:last.captureStatus,error:last.error,
    artifact:last.artifact,doneReason:last.doneReason,
    durationMs:receipts.every(r=>r.durationMs!==null)?receipts.reduce((n,r)=>n+r.durationMs,0):null,
    evalTokens:receipts.every(r=>r.evalTokens!==null)?receipts.reduce((n,r)=>n+r.evalTokens,0):null,
    promptEvalTokens:receipts.every(r=>r.promptEvalTokens!==null)?receipts.reduce((n,r)=>n+r.promptEvalTokens,0):null,
    conversation:{plannedTurns:turns.length,completedTurns:receipts.filter(r=>r.captureStatus==='CAPTURED').length,
      transcript,receipts,status:receipts.length===turns.length&&last.captureStatus==='CAPTURED'?'CAPTURED':'PARTIAL',
      transcriptSha256:sha(transcript)},gradingStatus:'NOT_GRADED'};
}
