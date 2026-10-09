import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVerificationTransfer, applyVerificationTransfer } from './verification-transfer-controller.mjs';
const owner='11111111-1111-4111-8111-111111111111',review='22222222-2222-4222-8222-222222222222';
const key=owner+'/1720000000000_verification_proof.webp';
function fixture() {
  const bytes=new Uint8Array([1,2,3]);const publicFiles=new Map([[key,bytes]]),privateFiles=new Map();
  const state={removed:0,copyReply:'ok',removeReply:'ok',changed:false,corrupt:false};
  const files=b=>b==='review-photos'?publicFiles:privateFiles;
  return {state,publicFiles,privateFiles,deps:{
    references:async()=>[{id:review,user_id:owner,verification_photo:state.changed?key.replace('proof','changed'):key,food_photos:[]}],
    info:async(b,k)=>files(b).has(k)?{size:files(b).get(k).length,contentType:'image/webp'}:null,
    read:async(b,k)=>files(b).get(k),
    privateBucket:async()=>({public:false,file_size_limit:5*1024*1024}),
    copy:async k=>{if(state.copyReply==='before')throw Error('fixture');privateFiles.set(k,state.corrupt?new Uint8Array([3,2,1]):bytes);if(state.copyReply==='after')throw Error('fixture');},
    remove:async keys=>{state.removed++;if(state.removeReply==='before')throw Error('fixture');for(const k of keys)publicFiles.delete(k);if(state.removeReply==='after')throw Error('fixture');},
    publicStatus:async(b,k)=>b==='review-verifications'?403:publicFiles.has(k)?200:404,
  }};
}
test('exact private byte readback precedes public deletion',async()=>{
 const f=fixture(),p=await planVerificationTransfer(f.deps),r=await applyVerificationTransfer(f.deps,p);
 assert.equal(r.completed,true);assert.equal(r.byteEqualityVerified,1);assert.equal(f.state.removed,1);
});
test('copy response lost after commit is reconciled; no deletion after unanswered failed copy',async()=>{
 for(const mode of ['before','after']){const f=fixture(),p=await planVerificationTransfer(f.deps);f.state.copyReply=mode;
  if(mode==='before'){await assert.rejects(applyVerificationTransfer(f.deps,p),/COPY_UNCONFIRMED/);assert.equal(f.state.removed,0);}
  else assert.equal((await applyVerificationTransfer(f.deps,p)).completed,true);
 }
});
test('private corruption or reference change prevents every public removal',async()=>{
 for(const prop of ['corrupt','changed']){const f=fixture(),p=await planVerificationTransfer(f.deps);f.state[prop]=true;
  await assert.rejects(applyVerificationTransfer(f.deps,p),/BYTE_MISMATCH|REFERENCE_CHANGED/);assert.equal(f.state.removed,0);
 }
});
test('unknown remove outcome uses metadata readback and repeat does not remove twice',async()=>{
 const f=fixture(),p=await planVerificationTransfer(f.deps);f.state.removeReply='after';
 assert.equal((await applyVerificationTransfer(f.deps,p)).completed,true);
 assert.equal((await applyVerificationTransfer(f.deps,p)).completed,true);assert.equal(f.state.removed,1);
});
test('remaining public object is pending even when Storage remove was attempted',async()=>{
 const f=fixture(),p=await planVerificationTransfer(f.deps);f.state.removeReply='before';
 const r=await applyVerificationTransfer(f.deps,p);assert.equal(r.completed,false);assert.equal(r.publicMetadataRemaining,1);
 assert.equal(f.privateFiles.size,1);
});
test('a provider outage is not public denial proof',async()=>{
 const f=fixture(),p=await planVerificationTransfer(f.deps);f.deps.publicStatus=async()=>503;
 const r=await applyVerificationTransfer(f.deps,p);assert.equal(r.completed,false);assert.equal(r.inconclusivePublicChecks,1);
});
