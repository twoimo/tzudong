export function catalog(count) {
 return Array.from({length:count},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:`실험맛집${String(i).padStart(4,'0')}`,approved_name:`실험맛집${String(i).padStart(4,'0')}`,lat:count<=3?37.55+i*0.001:37.5+(i%40)*0.003,lng:count<=3?126.98:126.96+Math.floor(i/40)*0.003,road_address:`서울특별시 중구 실험로 ${i+1}`,jibun_address:`서울특별시 중구 실험동 ${i+1}`,categories:[i%2?'한식':'분식'],status:'approved',created_at:'2026-09-01T00:00:00Z',review_count:0,weekly_search_count:count-i,youtube_link:null,youtube_meta:null}));
}
