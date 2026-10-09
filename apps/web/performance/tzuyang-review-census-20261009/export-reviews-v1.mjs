import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
const project='https://aqlcofblfxdrjhhdmarw.supabase.co';
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
if(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==project||!env.SUPABASE_SERVICE_ROLE_KEY?.startsWith('sb_secret_'))throw Error('PROJECT_BINDING_DENIED');
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const privateRoot='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';mkdirSync(privateRoot,{recursive:true,mode:0o700});chmodSync(privateRoot,0o700);
const client=createClient(project,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(30000)})}});
const select='id,origin_name,approved_name,channel_name,status,youtube_link,youtube_meta,tzuyang_review,updated_at,updated_by_admin_id';
const rows=[],seen=new Set();let cursor=null,total=null,pages=0;
const startedAtUtc=new Date().toISOString();
for(let i=0;i<100;i++){
 let q=client.from('restaurants').select(select,{count:'exact'}).order('id',{ascending:true}).limit(500);if(cursor)q=q.gt('id',cursor);
 const r=await q;if(r.error||!Array.isArray(r.data))throw Error('REVIEW_EXPORT_READ_UNCONFIRMED');if(total===null)total=r.count;pages++;
 for(const row of r.data){if(seen.has(row.id))throw Error('REVIEW_EXPORT_DUPLICATE_ID');seen.add(row.id);rows.push({...row,updated_by_admin_id:undefined,adminLocked:row.updated_by_admin_id!=null,reviewSha256:hash(row.tzuyang_review??''),recordSha256:hash(row)});}
 if(r.data.length<500)break;cursor=r.data.at(-1).id;if(i===99)throw Error('REVIEW_EXPORT_PAGE_BOUND');
}
if(total!==rows.length)throw Error('REVIEW_EXPORT_COUNT_DRIFT');
const raw=JSON.stringify(rows)+'\n';const snapshotPath=privateRoot+'/restaurants-review-snapshot-v1.json';writeFileSync(snapshotPath,raw,{flag:'wx',mode:0o600});
const byStatus={},byChannel={};for(const r of rows){byStatus[r.status??'null']=(byStatus[r.status??'null']??0)+1;byChannel[r.channel_name??'null']=(byChannel[r.channel_name??'null']??0)+1;}
const nonempty=rows.filter(r=>typeof r.tzuyang_review==='string'&&r.tzuyang_review.trim());
const unique=new Set(nonempty.map(r=>r.reviewSha256));
const result={schemaVersion:1,startedAtUtc,endedAtUtc:new Date().toISOString(),project:'aqlcofblfxdrjhhdmarw',table:'restaurants',field:'tzuyang_review',scope:'all current rows, general user reviews excluded',count:rows.length,initialExactCount:total,pages,nonemptyReviews:nonempty.length,emptyReviews:rows.length-nonempty.length,uniqueReviewBodies:unique.size,byStatus,byChannel,sourceSnapshotSha256:hash(raw),sourceSnapshotBytes:Buffer.byteLength(raw),privateCustody:snapshotPath,publicEvidenceContainsReviewText:false,adminLockedRows:rows.filter(r=>r.adminLocked).length,operatingWrites:0,limitations:['Keyset pagination is not one database transaction; apply requires fresh per-record readback/CAS.','A repeated body can belong to multiple records; full coverage must retain every stable row ID.']};
writeFileSync(new URL('./export-manifest-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,privateCustody:undefined}));
