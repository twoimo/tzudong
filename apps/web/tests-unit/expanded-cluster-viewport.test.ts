import {describe,expect,test} from 'bun:test';
import {shouldRenderExpandedClusterMarker,normalizeNaverMarkerCoordinates} from '../lib/naver-map-render-plan';
import type {Restaurant} from '../types/restaurant';
const bounds={south:37.5,north:37.6,west:126.9,east:127};
const row=(id='a',lat=37.55,lng=126.95)=>({id,lat,lng} as Restaurant);
describe('expanded cluster provider visibility without changing candidates',()=>{
 test('inclusive viewport boundaries and offscreen culling',()=>{
  for(const [lat,lng,expected] of [[37.5,126.9,true],[37.6,127,true],[37.499,126.95,false],[37.601,126.95,false],[37.55,126.899,false],[37.55,127.001,false]])
   expect(shouldRenderExpandedClusterMarker(row('a',Number(lat),Number(lng)),null,null,bounds,true)).toBe(expected);
 });
 test('selected and searched IDs remain renderable outside the viewport',()=>{
  const outside=row('selected',36,128);
  expect(shouldRenderExpandedClusterMarker(outside,'selected',null,bounds,true)).toBe(true);
  expect(shouldRenderExpandedClusterMarker(outside,null,'selected',bounds,true)).toBe(true);
  expect(shouldRenderExpandedClusterMarker(outside,'other','other',bounds,true)).toBe(false);
 });
 test('unavailable projection or disabled culling keeps previous behavior',()=>{
  expect(shouldRenderExpandedClusterMarker(row('a',36,128),null,null,null,true)).toBe(true);
  expect(shouldRenderExpandedClusterMarker(row('a',36,128),null,null,bounds,false)).toBe(true);
 });
 test('pan back and changed coordinates reevaluate without a stale cache',()=>{
  const r=row('a',36,128),original={...r};
  expect(shouldRenderExpandedClusterMarker(r,null,null,bounds,true)).toBe(false);
  expect(shouldRenderExpandedClusterMarker(r,null,null,{south:35,north:37,west:127,east:129},true)).toBe(true);
  r.lat=37.55;r.lng=126.95;
  expect(shouldRenderExpandedClusterMarker(r,null,null,bounds,true)).toBe(true);
  expect(shouldRenderExpandedClusterMarker(original,null,null,bounds,true)).toBe(false);
 });
 test('large candidate input is unchanged, coordinates normalize before the predicate',()=>{
  const all=Array.from({length:2000},(_,i)=>row(String(i),i%2?36:37.55,126.95));
  const before=all.map(r=>({...r}));
  expect(all.filter(r=>shouldRenderExpandedClusterMarker(r,null,null,bounds,true))).toHaveLength(1000);
  expect(all).toEqual(before);
  const normalized=normalizeNaverMarkerCoordinates({id:'a',lat:'37.55',lng:'126.95'});
  expect(shouldRenderExpandedClusterMarker(normalized as unknown as Restaurant,null,null,bounds,true)).toBe(true);
  expect(normalizeNaverMarkerCoordinates({lat:'bad',lng:'126.95'})).toBeNull();
 });
});
