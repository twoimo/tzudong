// Inspect production AST without emitting any source text, literal data or keys.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [root,distDir,output]=process.argv.slice(2);
assert.ok(root?.startsWith('/Users/twoimo/.codex/worktrees/review-query-lifetime-20261012/'));
assert.match(distDir??'',/^\.next-query-owner-[a-z0-9-]+$/);
assert.ok(output?.startsWith('/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/'));
const {parse}=createRequire(root+'/package.json')('espree');
const rows=[];
async function scan(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=dir+'/'+entry.name;
    if(entry.isDirectory()){await scan(file);continue;}
    if(!entry.name.endsWith('.js'))continue;
    const code=await readFile(file,'utf8');if(!code.includes('queryFn'))continue;
    let ast;
    try{ast=parse(code,{ecmaVersion:'latest',sourceType:'module',range:true});}
    catch{throw Error('PRODUCTION_AST_PARSE_DENIED');}
    const hash=createHash('sha256').update(code).digest('hex');
    function walk(node,functions=0) {
      if(!node||typeof node!=='object')return;
      if(node.type==='Property'&&(node.key?.name??node.key?.value)==='queryFn') {
        const value=node.value,text=code.slice(value.range[0],value.range[1]);
        const member=value.callee?.type==='MemberExpression'?(value.callee.property?.name??value.callee.property?.value):null;
        const lookup={reviews:'detail-reviews',siblings:'sibling-reviews',search:'direct-search',popular:'popular-search'};
        const family=lookup[member]??(text.includes('search_restaurants_by_youtube_title')?'direct-search'
          :text.includes('리뷰 데이터 조회 중 오류')?'detail-reviews'
          :text.includes('주간 인기 검색어 조회 실패')?'popular-search'
          :text.includes('tzuyang_review')?'sibling-reviews':'other');
        if(family!=='other')rows.push({file:file.slice(root.length+1),sha256:hash,family,
          valueAstType:value.type,calleeAstType:value.callee?.type??null,ancestorFunctionCount:functions,
          inlineFunctionFactory:['ArrowFunctionExpression','FunctionExpression'].includes(value.callee?.type),
          opaqueFactoryMemberLookup:member!==null&&Object.hasOwn(lookup,member)});
      }
      const nested=functions+(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)?1:0);
      for(const [key,value]of Object.entries(node)) {
        if(['range','loc'].includes(key))continue;
        if(Array.isArray(value)){for(const child of value)if(child?.type)walk(child,nested);}
        else if(value?.type)walk(value,nested);
      }
    }
    walk(ast);
  }
}
await scan(root+'/'+distDir+'/static/chunks');
const result={distDir,rows,inlineFactoryRows:rows.filter(row=>row.inlineFunctionFactory).length,
  opaqueLookupRows:rows.filter(row=>row.opaqueFactoryMemberLookup).length,
  rawCodePersisted:false,envOrLiteralValuesPersisted:false,scope:'All compiled chunks. Unloaded routes may also appear; actual browser owner paths are separate evidence.'};
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({inlineFactoryRows:result.inlineFactoryRows,opaqueLookupRows:result.opaqueLookupRows,rawCodePersisted:false}));
