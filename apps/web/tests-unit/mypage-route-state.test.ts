import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(path='/mypage/reviews', state: Record<string, unknown> = {__NA:true,tree:['preserve']}) {
  const history = {state,replaceState(next:Record<string,unknown>){history.state=next;}};
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/mypage-route-state.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,window:{history,location:{pathname:path,href:'https://fixture.test'+path}},Set,Number,Array,String});
  return {history,read:()=>exports.readMyPageRouteState(path),write:(patch:Record<string,unknown>)=>exports.writeMyPageRouteState(path,patch)};
}
test('presentation state keeps Next history fields and strips account or draft content on write/read',()=>{
  const f=fixture();f.write({scrollTop:120,reviewStatus:'approved',password:'never persist',content:'never persist'});
  expect(f.history.state.__NA).toBe(true);expect(f.history.state.tree).toEqual(['preserve']);
  expect(f.read()).toEqual({path:'/mypage/reviews',scrollTop:120});
  expect(f.history.state.tzudongMyPageView).not.toHaveProperty('reviewStatus');expect(f.history.state.tzudongMyPageView).not.toHaveProperty('password');expect(f.history.state.tzudongMyPageView).not.toHaveProperty('content');
});
test('a history entry cannot restore another route or unbounded/invalid values',()=>{
  const f=fixture('/mypage/bookmarks',{tzudongMyPageView:{path:'/mypage/reviews',scrollTop:900,reviewStatus:'approved'}});
  expect(f.read()).toEqual({path:'/mypage/bookmarks'});
  f.write({scrollTop:Infinity,bookmarkLimit:-1,reviewStatus:new String('approved')});
  expect(f.read()).toEqual({path:'/mypage/bookmarks'});
});
test('bookmark pagination and nested scroll survive an entry readback without changing the URL',()=>{
  const f=fixture('/mypage/bookmarks');f.write({bookmarkLimit:45,scrollTop:2200});
  expect(f.read()).toEqual({path:'/mypage/bookmarks',bookmarkLimit:45,scrollTop:2200});
});
test('unsupported paths never receive MyPage metadata',()=>{
  const f=fixture('/privacy');f.write({scrollTop:15});expect(f.history.state).not.toHaveProperty('tzudongMyPageView');
});
