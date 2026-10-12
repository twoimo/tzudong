import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const kind=process.argv[2];
if(!['baseline','candidate'].includes(kind))throw Error('KIND_DENIED');
const receipt=JSON.parse(await readFile(new URL('build-receipts-v8.json',import.meta.url))).find(r=>r.kind===kind);
const {parse}=createRequire(receipt.root+'/package.json')('espree');
const profile=JSON.parse(await readFile(new URL(`profile-${kind}-sanitized-v7.json`,import.meta.url)));
const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
const parents=new Map();for(const node of nodes.values())for(const id of node.children)parents.set(id,node.id);
const callerCosts=new Map();
for(let i=0;i<profile.samples.length;i++) {
  const node=nodes.get(profile.samples[i]);
  if(!['getPropertyValue','getComputedStyle','querySelectorAll','getBoundingClientRect'].includes(node.callFrame.functionName))continue;
  const chain=[];let current=node;
  for(let depth=0;depth<5&&parents.has(current.id);depth++){current=nodes.get(parents.get(current.id));chain.push(current.callFrame);}
  const key=JSON.stringify({functionName:node.callFrame.functionName,chain});
  const cost=callerCosts.get(key)??{functionName:node.callFrame.functionName,chain,sampledSelfUs:0};
  cost.sampledSelfUs+=profile.timeDeltas[i];callerCosts.set(key,cost);
}
const files=new Map();
async function find(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())await find(file);else if(entry.name.endsWith('.js')){const inventory=files.get(entry.name)??[];inventory.push(file);files.set(entry.name,inventory);}}}
await find(receipt.root+'/'+receipt.distDir+'/static/chunks');
const diag=JSON.parse(await readFile(new URL(`diagnostic-${kind}-v7.json`,import.meta.url)));
const flags=['getPropertyValue','getComputedStyle','getBoundingClientRect','mergedYoutubeLinks','mergedRestaurants','tzuyang_review','setMap','setIcon','getIcon','querySelectorAll','getTzuyangVisitCount','MutationObserver','cluster_id','weekly_search_count','data-testid','isVerified','RESTAURANT_SEARCH_SELECT'];
const rows=[];
for(const frame of diag.profile.topSelfFrames.filter(f=>f.group==='application'&&f.asset)) {
  const inventory=files.get(frame.asset);if(inventory?.length!==1)continue;
  const code=await readFile(inventory[0],'utf8');
  const lines=code.split('\n');let offset=frame.column;for(let i=0;i<frame.line;i++)offset+=lines[i].length+1;
  const ast=parse(code,{ecmaVersion:'latest',sourceType:'module',range:true});
  const functions=[];
  function walk(node){if(!node?.type)return;if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)&&node.range[0]<=offset&&node.range[1]>=offset)functions.push(node);for(const [key,value]of Object.entries(node)){if(['range','loc'].includes(key))continue;if(Array.isArray(value))for(const child of value)walk(child);else if(value?.type)walk(value);}}
  walk(ast);
  const fn=functions.sort((a,b)=>(a.range[1]-a.range[0])-(b.range[1]-b.range[0]))[0];
  if(!fn)continue;
  const text=code.slice(fn.range[0],fn.range[1]);
  rows.push({frame,fileSha256:createHash('sha256').update(code).digest('hex'),functionBytes:Buffer.byteLength(text),matchedStaticFlags:flags.filter(flag=>text.includes(flag)),rawCodePersisted:false});
}
const result={kind,sourceCommit:receipt.sourceCommit,callers:[...callerCosts.values()].sort((a,b)=>b.sampledSelfUs-a.sampledSelfUs).slice(0,20),applicationRows:rows,rawCodePersisted:false};
await writeFile(new URL(`attribution-${kind}-v2.json`,import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
