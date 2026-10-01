// CPU-only socket controls for the exact host and inner relay callbacks.
// Source extraction fails closed if their call sites move; no model endpoint is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OwnedRelayRequests } from './relay-owned.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const terminal = { model:'synthetic-code', done:true, done_reason:'stop',
  provider_version:'0.34.0', model_digest_sha256:'a'.repeat(64),
  message:{ content:'{"afterContent":"controlled bytes"}' } };
const listen = server => new Promise((resolve,reject) => {
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});
});
const wait = async (predicate,label) => {
  const deadline = Date.now()+2000;
  while (!predicate()) {
    assert.ok(Date.now()<deadline,label);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
};
function callbackSource(tier) {
  const source=fs.readFileSync(path.join(root,tier==='host'?'host.mjs':'probe.mjs'),'utf8');
  const marker=tier==='host'
    ? 'provider = http.createServer(async (incoming,outgoing)=>{'
    : 'const relay = http.createServer((incoming, outgoing) => {';
  const found=source.indexOf(marker);
  assert.ok(found>=0,'exact '+tier+' callback marker');
  const start=found+marker.indexOf(tier==='host'?'async (':'(incoming');
  const end=source.indexOf(tier==='host'
    ? '\n    });\n    await new Promise(resolve=>provider.listen'
    : '\n  });\n  await new Promise(resolve => relay.listen',start);
  assert.ok(end>start,'exact '+tier+' callback end');
  return source.slice(start,end)+'\n}';
}
async function run(tier,mode) {
  const requests=[], relayErrors=[];
  const owned=new OwnedRelayRequests();
  let seen=0, observedResponse=null, errorListenerObserved=false,
    downstreamClosed=false, downstreamBytes='';
  const upstream=http.createServer((incoming,outgoing)=>{
    seen++; incoming.resume(); incoming.once('end',()=>{
      outgoing.writeHead(200,{'Content-Type':'application/json'});
      if(mode==='complete') outgoing.end(JSON.stringify(terminal));
      else {outgoing.write('{"pending":');setTimeout(()=>outgoing.destroy(),30);}
    });
  });
  await listen(upstream);
  const text=callbackSource(tier);
  const context={assert,Buffer,sha,requests,relayErrors,
    options:{model:'synthetic-code'},upstreamRequests:owned,relayRequests:owned,
    loaded:false,runConfig:{providerSocket:'unused-controlled-socket'},
    http:{request:(options,callback)=>http.request({
      ...options,socketPath:undefined,hostname:'127.0.0.1',port:upstream.address().port,
    },response=>{observedResponse=response;callback(response);
      errorListenerObserved=response.listenerCount('error')>=1;})}};
  const callback=vm.runInNewContext('('+text+')',context);
  const relay=http.createServer(callback);
  await listen(relay);
  const client=http.request({hostname:'127.0.0.1',port:relay.address().port,
    path:'/api/chat',method:'POST'});
  client.on('error',()=>{});
  client.on('close',()=>{downstreamClosed=true;});
  client.on('response',response=>{
    response.on('error',()=>{});
    response.on('data',chunk=>{downstreamBytes+=chunk.toString();});
    response.resume();
  });
  client.end(JSON.stringify({model:'synthetic-code',stream:false}));
  try {
    await wait(()=>seen===1&&observedResponse!==null,'one controlled upstream response');
    await wait(()=>downstreamClosed&&owned.pending.size===0,'bounded downstream close and owned settlement');
    const drained=await owned.cancelAndSettle(500);
    assert.deepEqual(drained,{settled:true,cancelled:0,pending:0});
    assert.equal(errorListenerObserved,true,'upstream response error listener before failure');
    if(mode==='partial') {
      assert.equal(requests.length,tier==='host'?1:0);
      if(tier==='host') {
        assert.equal(requests[0].status,200);
        assert.match(requests[0].error,/aborted|closed|ECONNRESET|socket/i);
        assert.equal(requests[0].terminal,undefined);
      } else {
        assert.equal(relayErrors.length,1);
        assert.match(relayErrors[0],/aborted|closed|ECONNRESET|socket/i);
      }
    } else {
      assert.equal(downstreamBytes,JSON.stringify(terminal));
      assert.deepEqual(relayErrors,[]);
      if(tier==='host') {
        assert.equal(requests[0].error,undefined);
        assert.equal(requests[0].responseTruncated,false);
        assert.equal(JSON.stringify(requests[0].terminal),JSON.stringify(terminal));
      }
    }
    return {tier,mode,callbackSha256:sha(text),upstreamSeen:seen,
      downstreamClosedWithinTwoSeconds:downstreamClosed,ownedPending:owned.pending.size,
      upstreamResponseErrorListenerBeforeFailure:errorListenerObserved,
      hostRowError:tier==='host'?(requests[0]?.error??null):null,
      innerRelayErrors:tier==='inner'?relayErrors:[],
      noModelProviderCalled:true};
  } finally {
    client.destroy();
    relay.closeAllConnections();
    await new Promise(resolve=>relay.close(resolve));
    await owned.cancelAndSettle(500);
    upstream.closeAllConnections();
    await new Promise(resolve=>upstream.close(resolve));
  }
}
const results=[];
for(const tier of ['host','inner']) {
  results.push(await run(tier,'complete'));
  results.push(await run(tier,'partial'));
}
console.log(JSON.stringify({status:'PASS',results},null,2));
