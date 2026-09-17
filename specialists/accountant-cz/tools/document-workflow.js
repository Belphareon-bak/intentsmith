// No filesystem or core imports: authority is a single invocation supplied by host.
export async function runDocumentWorkflow({input}, turn={}) {
  if(typeof turn.accounting!=='function')throw new Error('Účetní dokumenty vyžadují aktivní konverzaci ve Studiu.');
  return turn.accounting(input);
}
