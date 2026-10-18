import { mergeRestaurants } from '../../hooks/use-restaurants';
import { createPublishedPopularityLookup } from '../../lib/evidence-engineering/published-popularity';
const lookup=createPublishedPopularityLookup({schemaVersion:1,publicationVersion:'fixture-1',sourceRevision:'a'.repeat(40),entries:[{restaurantId:'public-a',tier:'fire'}]});
const rows=[{id:'public-a',approved_name:'동일 식당',categories:['한식'],road_address:'같은 공개 주소',lat:37.5,lng:127,review_count:1,youtube_meta:{publishedAt:'2026-01-01'}},{id:'public-z',approved_name:'동일 식당',categories:['한식'],road_address:'같은 공개 주소',lat:37.5,lng:127,review_count:1,youtube_meta:{publishedAt:'2026-10-01'}}];
const compact=rows.map(({youtube_meta:_,...row})=>row);
console.log(JSON.stringify({kind:'synthetic correctness reproduction',source:'db694a67fbd0707d49ce6d6d933574f40b2ffef0',compact:mergeRestaurants(compact,lookup).map(r=>({id:r.id,tier:r.popularity_tier})),full:mergeRestaurants(rows,lookup).map(r=>({id:r.id,tier:r.popularity_tier}))}));
