import { ideError, identifier, record, textField } from '../db/ide-store.js';

export function validateAccount(input) {
  record(input,['revision','name','provider','credentialEnv','recipient','enabled','events']);
  const provider=input.provider;
  if(!['telegram','discord'].includes(provider)||typeof input.enabled!=='boolean') throw ideError('IDE_ACCOUNT_INVALID');
  const credentialEnv=textField(input.credentialEnv,100);
  if(!new RegExp(`^INTENTSMITH_${provider.toUpperCase()}_[A-Z0-9_]+$`).test(credentialEnv)) throw ideError('IDE_CREDENTIAL_REFERENCE_INVALID');
  const recipient=textField(input.recipient,100);
  if(provider==='discord'?!/^[0-9]{6,25}$/.test(recipient):!/^(-?[0-9]{1,25}|@[a-zA-Z0-9_]{5,32})$/.test(recipient)) throw ideError('IDE_RECIPIENT_INVALID');
  if(!Array.isArray(input.events)||new Set(input.events).size!==input.events.length
    ||input.events.some(event=>!['worker','lifecycle'].includes(event))) throw ideError('IDE_EVENTS_INVALID');
  return {name:textField(input.name),provider,credentialEnv,recipient,enabled:input.enabled,events:input.events};
}
export function accountView(account,environment=process.env) {
  return {...account,credentialConfigured:typeof environment[account.credentialEnv]==='string'&&environment[account.credentialEnv].length>0,
    credentialPersistence:'environment_only',connectionStatus:'NOT_VERIFIED'};
}
// Fixed origins and fixed methods. Tokens never enter logs, DB or responses.
export async function deliverAccount(account,notification,{environment=process.env,fetch:transport}={}) {
  const token=environment[account.credentialEnv];
  if(!account.enabled) throw ideError('IDE_ACCOUNT_DISABLED',409);
  if(!token||typeof token!=='string'||/[\x00-\x20]/.test(token)) throw ideError('IDE_CREDENTIAL_MISSING',409);
  const text=`${notification.title}\n\n${notification.body||''}`;
  let url,body,headers={'content-type':'application/json'};
  if(account.provider==='telegram') {
    if(!/^[0-9]+:[A-Za-z0-9_-]+$/.test(token)) throw ideError('IDE_CREDENTIAL_INVALID',409);
    url=`https://api.telegram.org/bot${token}/sendMessage`;
    body={chat_id:account.recipient,text:text.slice(0,4096)};
  } else {
    url=`https://discord.com/api/v10/channels/${account.recipient}/messages`;
    headers.authorization=`Bot ${token}`;
    body={content:text.slice(0,2000),allowed_mentions:{parse:[]}};
  }
  try {
    const response=await transport(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
    const data=await response.json();
    if(!response.ok||account.provider==='telegram'&&data.ok!==true) throw ideError('IDE_CHANNEL_DELIVERY_FAILED',502);
    const messageId=account.provider==='telegram'?data.result?.message_id:data.id;
    if(messageId===undefined||messageId===null) throw ideError('IDE_CHANNEL_RESPONSE_INVALID',502);
    return {delivered:true,messageId:String(messageId),provider:account.provider};
  } catch(error) {
    // Transport exceptions can include URLs (Telegram credentials).
    throw ideError(error.code?.startsWith('OUTBOUND_')?error.code:'IDE_CHANNEL_DELIVERY_FAILED',502);
  }
}
export function registerAccountChannels(router,store,transport,environment=process.env) {
  if(!router) return;
  for(const [name] of router.channels) if(/^(telegram|discord)\.account\./.test(name)) router.channels.delete(name);
  for(const account of store.list('account')) {
    const name=`${account.provider}.account.${identifier(account.id)}`;
    router.registerChannel({name,async send(notification) {
      const current=store.get('account',account.id);
      if(!current) return {delivered:false,error:'IDE_ACCOUNT_NOT_FOUND'};
      // Background delivery needs an explicit event subscription. Manual send
      // is restricted to the account test endpoint with exact confirmation.
      if(!current.events.includes(notification.data?.eventType)) return {delivered:false,error:'IDE_EVENT_NOT_SUBSCRIBED'};
      try{return await deliverAccount(current,notification,{fetch:transport,environment});}
      catch(error){return {delivered:false,error:error.code};}
    },async verify(){return {ok:false,error:'Use the confirmed account test endpoint'};}});
  }
}
