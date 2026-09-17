import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const caseId=id=>{if(!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id))throw new Error('Neplatné označení složky účetního.');return id;};
export async function privateDir(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw new Error('Účetní vyžaduje vlastní soukromý adresář s právy 700: '+dir);}
export async function readRegular(file,max=24*1024*1024,privateFile=false){
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await handle.stat();if(!st.isFile()||st.size>max||(privateFile&&(st.uid!==process.getuid()||(st.mode&0o077))))throw new Error('Neplatný nebo příliš velký soubor.');return await handle.readFile();}finally{await handle.close();}
}
export async function atomicWrite(file,bytes){const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,bytes,{mode:0o600,flag:'wx'});try{await fs.rename(tmp,file);}catch(e){await fs.unlink(tmp);throw e;}}
export class AccountingStore {
  constructor(root){this.root=path.resolve(root);}
  dir(id){return path.join(this.root,caseId(id));}
  async list(){await privateDir(this.root);return (await fs.readdir(this.root,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^[a-z0-9][a-z0-9-]{0,59}$/.test(e.name)).map(e=>e.name).sort();}
  async read(id){await privateDir(this.root);await privateDir(this.dir(id));const c=JSON.parse(await readRegular(path.join(this.dir(id),'case.json'),32*1024*1024,true));if(c.version!==1||c.id!==id)throw new Error('Neplatná verze účetní evidence.');return c;}
  async create({kind,year,month,id}){
    if(!['monthly','annual'].includes(kind)||!Number.isInteger(year)||year<2024||year>2030||(kind==='monthly'&&(!Number.isInteger(month)||month<1||month>12)))throw new Error('Neplatné období.');
    await privateDir(this.root);await privateDir(this.dir(id));
    const c={version:1,id,kind,year,month:month??null,revision:0,profile:{confirmed:false},answers:{},sources:[],documents:[],references:[],filings:{},audit:[],createdAt:new Date().toISOString()};
    await fs.writeFile(path.join(this.dir(id),'case.json'),JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'});return c;
  }
  async mutate(id,event,fn){
    await privateDir(this.dir(id));const lock=path.join(this.dir(id),'write.lock');let handle;
    try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Evidence je právě zamčená jiným zápisem. Po pádu ověř write.lock a běžící proces před odemčením.');throw e;}
    try{
      await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
      const c=await this.read(id),before=JSON.stringify(c),result=await fn(c);
      if(before!==JSON.stringify(c)){
        c.revision++;c.audit.push({revision:c.revision,event,at:new Date().toISOString()});
        const bytes=JSON.stringify(c,null,2)+'\n',revisions=path.join(this.dir(id),'revisions');await privateDir(revisions);
        await fs.writeFile(path.join(revisions,String(c.revision).padStart(6,'0')+'.json'),bytes,{mode:0o600,flag:'wx'});
        await atomicWrite(path.join(this.dir(id),'case.json'),bytes);
      }
      return {c,result};
    }finally{await handle.close();await fs.unlink(lock);}
  }
  async saveSource(id,bytes){
    const sha=hash(bytes),dir=path.join(this.dir(id),'sources');await privateDir(dir);const destination=path.join(dir,sha);
    try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await readRegular(destination,24*1024*1024,true))!==sha)throw new Error('SOURCE_HASH_CHANGED');}
    return sha;
  }
  async source(id,sha){if(!/^[a-f0-9]{64}$/.test(sha))throw new Error('SOURCE_ID_INVALID');const b=await readRegular(path.join(this.dir(id),'sources',sha),24*1024*1024,true);if(hash(b)!==sha)throw new Error('SOURCE_HASH_CHANGED');return b;}
}
