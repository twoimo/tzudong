import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureQuery,reviewFixtureQuery} from './fixture-query-v3.mjs';
const literal='한식, (별관). "서울" \\ 끝';
const quote=value=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

test('literal union matches exactly without comma/parenthesis injection',()=>{
    const rows=[{id:'one',approved_name:literal},{id:'two',approved_name:'other',road_address:'주소'}];
    const p=new URLSearchParams({or:'(approved_name.eq.'+quote(literal)+',road_address.eq.'+quote('주소')+')',select:'id'});
    assert.deepEqual(fixtureQuery(rows,p),{data:[{id:'one'},{id:'two'}],total:2});
    assert.throws(()=>fixtureQuery(rows,new URLSearchParams({or:'(unknown.eq."x")'})));
    assert.throws(()=>fixtureQuery(rows,new URLSearchParams({or:'(approved_name.eq."unterminated)'})));
});

test('cap keeps exact total separate from the returned body',()=>{
    const rows=Array.from({length:2000},(_,i)=>({id:String(i),approved_name:'same'}));
    const result=fixtureQuery(rows,new URLSearchParams({approved_name:'eq.same',select:'id'}));
    assert.equal(result.data.length,1000);assert.equal(result.total,2000);
});

test('review detail and legitimate like-count projection have distinct supported shapes',()=>{
    const rows=[{id:'r1',restaurant_id:'deleted',is_verified:true,is_pinned:false,created_at:'2026-09-01',like_count:2,content:'synthetic'}];
    const count=reviewFixtureQuery(rows,new URLSearchParams({restaurant_id:'in.("deleted")',select:'restaurant_id, like_count'}));
    assert.deepEqual(count.data,[{restaurant_id:'deleted',like_count:2}]);
    const detail=reviewFixtureQuery(rows,new URLSearchParams({restaurant_id:'in.("deleted")',is_verified:'eq.true',order:'is_pinned.desc,created_at.desc',offset:'0',limit:'15',select:'id,content'}));
    assert.deepEqual(detail.data,[{id:'r1',content:'synthetic'}]);
    assert.throws(()=>reviewFixtureQuery(rows,new URLSearchParams({user_id:'eq.unexpected'})));
});
