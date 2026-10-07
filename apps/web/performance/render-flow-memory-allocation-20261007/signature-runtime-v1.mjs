import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {origin} from '../repository-quality-20261004/real-sdk-runtime-portable-v3.mjs';
export {origin,pageSetup,ready} from '../repository-quality-20261004/real-sdk-runtime-portable-v3.mjs';
const here=new URL('./',import.meta.url),app=new URL('../../',here);
export async function serve(kind){
 if(Number(process.versions.node.split(".")[0])!==24)throw Error("pinned Node24 driver required");
 let occupied=false;try{occupied=!!execFileSync('lsof',['-tiTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}if(occupied)throw Error('test port3000 already occupied; existing server is never reused');
 const receiptPath=kind==='baseline'?(process.env.SDK_BASELINE_RECEIPT_PATH||'../repository-quality-20261004/build-candidate-overseas-query-v1/receipt.json'):(process.env.SDK_CANDIDATE_RECEIPT_PATH||'./build-candidate-signature-values-v1/receipt.json');
 const receipt=JSON.parse(await readFile(new URL(receiptPath,here)));
 const server=spawn(process.env.TZUDONG_PERF_NODE24_EXECUTABLE||process.execPath,[fileURLToPath(new URL(`${receipt.distDir}/standalone/apps/web/server.js`,app))],{cwd:fileURLToPath(app),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'3000'},stdio:'ignore'});
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('server stopped');try{if((await fetch(origin)).ok)return {receipt,close:async()=>{if(server.exitCode!==null)return;const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}};}catch{}await new Promise(r=>setTimeout(r,100));}
 server.kill('SIGTERM');throw Error('server unavailable');
}
