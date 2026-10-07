import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../package.json',import.meta.url));
const parser=require('@babel/parser');
const here=new URL('./',import.meta.url),app=new URL('../../',here);
const result={diagnosticOnly:true,fullURLsOrStringLiteralsStored:false,runs:[]};
for(const r of JSON.parse(await readFile(new URL('allocation-attribution-v2/raw.json',here),'utf8')).runs){
 const tree=JSON.parse(await readFile(new URL(`allocation-attribution-v2/${r.allocationFile}`,here),'utf8'));
 const frames=[];
 function collect(n,anc=[]){if(n.selfSize>20e6&&n.sourceClass==='app')frames.push({estimatedSelfBytes:n.selfSize,stack:anc.slice(-4).concat(n).map(x=>({fn:x.functionName,chunk:x.appChunk,line:x.lineNumber,column:x.columnNumber}))});for(const c of n.children)collect(c,anc.concat(n));}collect(tree.head);
 const checks=[];
 for(const f of frames)for(const frame of f.stack){if(!frame.chunk||frame.chunk.startsWith('4bd1b696'))continue;if(checks.some(x=>x.chunk===frame.chunk&&x.line===frame.line&&x.column===frame.column))continue;
  const build=r.kind==='baseline'?'baseline-readiness-v1':'candidate-overseas-query-v1';
  const code=await readFile(new URL(`.next-real-sdk-${build}-20260930/static/chunks/${frame.chunk}`,app),'utf8');const ast=parser.parse(code,{sourceType:'unambiguous'});
  const lines=code.split('\n'),at=lines.slice(0,frame.line).reduce((a,v)=>a+v.length+1,0)+frame.column,containers=[];
  function find(n){if(!n||typeof n!=='object'||!(n.start<=at&&n.end>=at))return;if(/Function|Arrow/.test(n.type))containers.push(n);for(const [k,v]of Object.entries(n)){if(['loc','start','end','extra'].includes(k))continue;if(Array.isArray(v))v.forEach(find);else if(typeof v==='object')find(v);}}find(ast.program);const n=containers.at(-1);assert.ok(n);
  const members=new Set(),calls=new Set();function visit(v){if(!v||typeof v!=='object')return;if(v.type==='CallExpression')calls.add(v.callee?.name??v.callee?.property?.name??v.callee?.type);if(v.type==='MemberExpression'&&v.property?.name)members.add(v.property.name);for(const [k,x]of Object.entries(v)){if(['loc','start','end','extra'].includes(k))continue;if(Array.isArray(x))x.forEach(visit);else if(typeof x==='object')visit(x);}}visit(n);
  const mappedSource=members.has('displayRestaurants')&&members.has('seoulIndividualIds')?'lib/naver-map-render-plan.ts::buildRenderTargetIdsForSignature':calls.has('join')&&calls.has('filter')&&calls.has('sort')?'lib/map-render-guard.ts::makeDisplayIdsSignature':members.has('lat')&&members.has('lng')&&members.has('id')?'lib/naver-map-render-plan.ts::toRestaurantRenderToken':null;
  checks.push({...frame,functionRange:[n.start,n.end],calls:[...calls],members:[...members],chunkSha256:createHash('sha256').update(code).digest('hex'),mappedSource});
 }
 result.runs.push({sourceCommit:r.sourceCommit,frames,checks});
}
assert.ok(result.runs.every(r=>r.checks.some(x=>x.mappedSource==='lib/map-render-guard.ts::makeDisplayIdsSignature')&&r.checks.some(x=>x.mappedSource==='lib/naver-map-render-plan.ts::toRestaurantRenderToken')));
await writeFile(new URL('source-attribution-ast-v1.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,runs:result.runs.length}));
