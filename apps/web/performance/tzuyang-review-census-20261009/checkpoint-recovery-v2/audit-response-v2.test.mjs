import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAuditRows} from './audit-response-v2.mjs';
const binding={offset:224,rows:2};
const rows=[{key:'r0224',status:'ok',issues:[],revisedReview:''},
  {key:'r0225',status:'fix',issues:['RAW_FORMATTING'],revisedReview:'기존 평가를 보존한 문장입니다.'}];

test('strings/null/arrays returned as rows are rejected without interrupting the remaining batch',()=>{
  for(const wrong of ['r0224',null,[],0])assert.equal(validateAuditRows([wrong,rows[1]],binding),false);
});
test('valid keys/coverage pass; missing, reordered and repeated keys never establish coverage',()=>{
  assert.equal(validateAuditRows(rows,binding),true);
  for(const wrong of [rows.slice(0,1),[rows[1],rows[0]],[rows[0],rows[0]]])assert.equal(validateAuditRows(wrong,binding),false);
});
test('unrequested fields, unrecognized statuses/issues and contradictory fix shapes fail closed',()=>{
  for(const wrong of [{...rows[0],debug:'fixture'},{...rows[0],status:'approved'},
    {...rows[0],issues:['UNKNOWN']},{...rows[0],revisedReview:'invented'},
    {...rows[1],revisedReview:''}])assert.equal(validateAuditRows([wrong,rows[1]],binding),false);
});
