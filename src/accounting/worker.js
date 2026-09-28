import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./document-worker.py',import.meta.url));
export const runtimeDir=()=>process.env.UCETNI_RUNTIME_DIR??path.join(os.homedir(),'.local/share/ucetni');
export function worker(request,{signal}={}){
  return new Promise((resolve,reject)=>{
    const python=path.join(runtimeDir(),'venv/bin/python'),proc=spawn(python,[script],{stdio:['pipe','pipe','pipe'],signal,env:{...process.env,OMP_THREAD_LIMIT:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    const chunks=[],errors=[];let size=0,errSize=0;const timer=setTimeout(()=>proc.kill('SIGKILL'),120000);
    proc.stdout.on('data',x=>{size+=x.length;if(size>150*1024*1024)proc.kill('SIGKILL');else chunks.push(x);});
    proc.stderr.on('data',x=>{if(errSize<4000){errors.push(x);errSize+=x.length;}});
    proc.once('error',e=>{clearTimeout(timer);reject(e.code==='ENOENT'?new Error('Chybí lokální OCR/PDF prostředí. Spusť scripts/install-ucetni.py.'):e);});
    proc.once('close',code=>{clearTimeout(timer);try{const value=JSON.parse(Buffer.concat(chunks).toString());if(code!==0||value.error)throw new Error(value.message??'Lokální zpracování selhalo.');resolve(value);}catch(e){reject(new Error('Zpracování dokumentu: '+(e instanceof SyntaxError?'proces skončil bez platného výsledku ('+code+').':e.message)));}});
    proc.stdin.on('error',()=>{});proc.stdin.end(JSON.stringify({...request,tessdata:path.join(runtimeDir(),'tessdata')}));
  });
}
