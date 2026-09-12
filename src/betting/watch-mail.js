import nodemailer from 'nodemailer';
import {OutboundAuditRepository,outboundTargetDigest} from '../network/outbound-audit-repository.js';
import {renderWatchSignal,validateWatchPreferences} from '../../specialists/sazeni/engine/opportunities.js';
import {fortunaPages} from '../../specialists/sazeni/providers/fortuna-public.js';

export function validateWatchMail(config) {
  const fields=['host','port','user','from','to'];
  if(!config||typeof config!=='object'||Object.keys(config).sort().join(',')!==fields.sort().join(','))throw new Error('MAIL_CONFIG_INVALID');
  if(typeof config.host!=='string'||config.host.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(config.host)||![465,587].includes(config.port))throw new Error('MAIL_TLS_SERVER_INVALID');
  for(const k of ['from','to'])if(typeof config[k]!=='string'||config[k].length>254||!/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(config[k]))throw new Error('MAIL_SINGLE_ADDRESS_REQUIRED');
  if(typeof config.user!=='string'||!config.user.length||config.user.length>254||/[\r\n\0]/.test(config.user))throw new Error('MAIL_USER_INVALID');
  return Object.freeze({...config});
}
export function watchRecipientHash(config,preferences=null){return outboundTargetDigest(JSON.stringify({config:validateWatchMail(config),preferences:preferences===null?null:validateWatchPreferences(preferences)}));}
export async function sendWatchMail({store,config,password,signal,test=false,clock=Date.now,createTransport=options=>nodemailer.createTransport(options)}) {
  config=validateWatchMail(config);
  if(typeof password!=='string'||!password.length||password.length>4096)throw new Error('MAIL_PASSWORD_REQUIRED');
  if(!test&&(!signal||signal.contract!=='BettingWatchSignal'||signal.valueStatus!=='UNVERIFIED'||!['NEWLY_OBSERVED','PRICE_IMPROVED'].includes(signal.kind)||Date.parse(signal.quote?.expiresAt)<=clock()||!Number.isFinite(Date.parse(signal.quote?.expiresAt))))throw new Error('MAIL_SIGNAL_EXPIRED_OR_INVALID');
  const text=test?'Toto je vyžádaný test doručování ze Sázkaře. Neobsahuje sázkový tip. Automatický sběr ovládáš příkazy sazkar hlidat start / stop.':renderWatchSignal(signal)+'\n\n'+fortunaPages([signal.quote.competitionId])[0].url+'\n\nZastavení upozornění: sazkar hlidat stop';
  if(text.length>6000)throw new Error('MAIL_MESSAGE_LIMIT');
  const audit=new OutboundAuditRepository(store.database,{clock}),requestId=audit.createRequestId();
  const target={requestId,surface:'betting-notifications',scope:test?'sports.betting.email.test':'sports.betting.email.notify',method:'SMTP',targetOrigin:`smtps://${config.host}:${config.port}`,targetDigest:outboundTargetDigest(JSON.stringify({config,signalId:test?requestId:signal.id}))};
  // Operator-selected server and one recipient; no message-supplied routing,
  // attachments, URL fetches or inherited C3 SMTP environment.
  audit.append({...target,phase:'decision',decision:'allow',reasonCode:'BETTING_WATCH_USER_CONFIGURED'});
  const transport=createTransport({host:config.host,port:config.port,secure:config.port===465,requireTLS:true,ignoreTLS:false,
    auth:{user:config.user,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,
    disableFileAccess:true,disableUrlAccess:true,maxRecipients:1,dnsTimeout:10000,logger:false,debug:false});
  try {
    const result=await transport.sendMail({from:config.from,to:config.to,envelope:{from:config.from,to:[config.to]},
      subject:test?'[Sázkař] Test doručování':signal.kind==='PRICE_IMPROVED'?'[Sázkař] Zlepšení pozorovaného kurzu':'[Sázkař] Nově zachycená nabídka',text,
      messageId:`<sazkar-${test?requestId.replace(':','-'):signal.id}@local.invalid>`,disableFileAccess:true,disableUrlAccess:true});
    const accepted=result.accepted?.some(to=>String(to).toLowerCase()===config.to.toLowerCase())&&!result.rejected?.length;
    audit.append({...target,phase:'terminal',decision:accepted?'succeeded':'failed',reasonCode:accepted?'SMTP_ACCEPTED':'SMTP_NOT_ACCEPTED'});
    return {accepted:Boolean(accepted),messageId:typeof result.messageId==='string'?result.messageId:null,errorCode:accepted?null:'SMTP_NOT_ACCEPTED'};
  }catch{
    audit.append({...target,phase:'terminal',decision:'failed',reasonCode:'SMTP_OUTCOME_UNKNOWN'});
    return {accepted:false,messageId:null,errorCode:'SMTP_OUTCOME_UNKNOWN'};
  }finally{transport.close?.();}
}
