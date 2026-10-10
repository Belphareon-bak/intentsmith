import fs from 'node:fs/promises';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.cwd(),directory=path.join(root,'intentsmith-ide/applications/electron'),output=path.join(root,'.intentsmith-artifacts/preview-completion-20261010/build-mouse-decoration');
const sha=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),clean=()=>execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='';
const sourceRevision=sha();if(!clean())throw Error('Clean source required');const commands=[];
async function run(kind,argv){const startedAt=new Date().toISOString(),logPath=path.join(output,kind+'.log'),log=await fs.open(logPath,'w',0o600);
 const child=spawn(argv[0],argv.slice(1),{cwd:directory,env:{...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH},detached:true,stdio:['ignore',log.fd,log.fd]});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});await log.close();
 let terminated=true;try{process.kill(-child.pid,0);terminated=false;}catch(e){if(e.code!=='ESRCH')throw e;}
 commands.push({kind,argv,startedAt,endedAt:new Date().toISOString(),exitCode:result.code,signal:result.signal,timedOut:false,cleanupTerminated:terminated,logSha256:createHash('sha256').update(await fs.readFile(logPath)).digest('hex')});
 if(result.code!==0||!terminated)throw Error('Build failure/leaked child: '+kind);
}
await run('STUDIO_BUILD',[path.join(root,'intentsmith-ide/node_modules/.bin/theia'),'build','--mode','production']);
await run('APPIMAGE_DIST',[path.join(root,'intentsmith-ide/node_modules/.bin/electron-builder'),'--linux','AppImage','--publish','never']);
if(sha()!==sourceRevision||!clean())throw Error('Source changed during build');
const artifact=path.join(directory,'dist/IntentSmith-0.1.0.AppImage'),bytes=await fs.readFile(artifact);
const studioSourceFiles=[];for(const p of execFileSync('git',['ls-files','-z','intentsmith-ide'],{encoding:'utf8'}).split('\0').filter(Boolean)){studioSourceFiles.push({path:p,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')});}
const receipt={status:'BUILD_PASS',sourceRevision,node:process.versions.node,commands,sourceCleanAfter:true,studioSourceFiles,artifact:{path:artifact,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
await fs.writeFile(path.join(output,'appimage-build.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,sourceRevision,artifact:receipt.artifact}));
