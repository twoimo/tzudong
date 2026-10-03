import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const app=new URL('../../',import.meta.url);
const receipt=JSON.parse(await readFile(new URL('build-candidate-logo-v6/receipt.json',import.meta.url),'utf8'));
let occupied=false;try{occupied=!!execFileSync('lsof',['-tiTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
if(occupied)throw Error('owned UI port occupied; existing runtime preserved');
const child=spawn('/opt/homebrew/opt/node@24/bin/node',[fileURLToPath(new URL(`${receipt.distDir}/standalone/apps/web/server.js`,app))],{cwd:fileURLToPath(app),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'3000'},stdio:'ignore'});
let closing=false;
const close=()=>{if(closing)return;closing=true;child.kill('SIGTERM');const guard=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},4000);child.once('exit',()=>{clearTimeout(guard);process.exit(0);});};
process.once('SIGTERM',close);process.once('SIGINT',close);
child.once('exit',code=>{if(!closing)process.exit(code??1);});
for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('owned UI runtime stopped');try{if((await fetch('http://localhost:3000/?__qa=ui-verify')).ok){console.log(JSON.stringify({ready:true,port:3000,productionBuild:true,buildId:receipt.buildId,poolCandidateIncluded:receipt.poolOrderCandidateIncluded}));break;}}catch{}await new Promise(r=>setTimeout(r,100));if(i===149)close();}
