import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { buildEvaluationCatalog, evaluationCatalogPage } from '@/lib/admin/evaluation-catalog';
import { normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';
import { filterEvaluationRecords, evaluationStats } from '@/lib/admin/evaluation-query';
import { parseAdminEvaluationPage } from '@/lib/admin/evaluation-page-client';
import { findSameVideoDuplicateWarningCandidates, formatSameVideoDuplicateWarning } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import type { EvaluationRecord } from '@/types/evaluation';

// Business-source replay is read-only; no raw row or payload is retained.
const inputPath = '/Users/twoimo/Documents/projects/tzudong/backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl';
const bytes = readFileSync(inputPath);
const rows = bytes.toString().split('\n').filter(Boolean).map((line,index) => {
  const row = JSON.parse(line);
  return { ...row, id:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,
    approved_name:row.approved_name??null, name:row.approved_name??row.origin_name??'',
    is_not_selected:row.is_not_selected??row.is_notSelected??false,
    created_at:row.created_at??'2026-01-01T00:00:00Z' };
});
const query = { searchQuery:'',evalFilters:{},deepLinkFilter:null };
const start = performance.now();
const catalog = buildEvaluationCatalog({revision:'1',records:rows});
const indexBuildMs = performance.now()-start;
const byId=new Map(rows.map(row=>[row.id,row]));
const observations=[];
for(let repeat=0;repeat<100;repeat++) {
  for(const implementation of repeat%2===0?['baseline','candidate']:['candidate','baseline']) {
    const started=performance.now();
    let payload, visible;
    if(implementation==='baseline') {
      payload=JSON.stringify({records:rows});
      const records=JSON.parse(payload).records.map(normalizeEvaluationRecord).filter(Boolean).map(withAdminEvaluationDisplayName);
      visible=filterEvaluationRecords(records,query).slice(0,50);
      evaluationStats(records);
    } else {
      const page=evaluationCatalogPage(catalog,query,50);
      const warnings=Object.fromEntries(page.records.map(record=>{
        const related=catalog.byVideo.get(extractVideoIdFromYoutubeLink(record.youtube_link)??'')??[];
        const candidates=findSameVideoDuplicateWarningCandidates(record,related);
        return [record.id,{sameVideo:{count:candidates.length,candidates:candidates.slice(0,3),message:formatSameVideoDuplicateWarning(candidates)},identity:findRestaurantIdentityWarnings(record,related)}];
      }));
      payload=JSON.stringify({...page,records:page.records.map(record=>summarizeEvaluationRecord(byId.get(record.id)!,record)),warnings});
      visible=parseAdminEvaluationPage(JSON.parse(payload)).records.map(normalizeEvaluationRecord).filter((record): record is EvaluationRecord => record !== null).map(withAdminEvaluationDisplayName);
    }
    const elapsed=performance.now()-started;
    const ids=visible.map((record:{id:string})=>record.id);
    observations.push({repeat,implementation,wallMs:elapsed,payloadBytes:Buffer.byteLength(payload),gzipBytes:gzipSync(payload).byteLength,
      visibleIdsSha256:createHash('sha256').update(JSON.stringify(ids)).digest('hex'),visibleRows:ids.length});
  }
}
for(let i=0;i<observations.length;i+=2) {
  if(observations[i].visibleIdsSha256!==observations[i+1].visibleIdsSha256) throw new Error('PAGE_ID_EQUIVALENCE_FAILED');
}
const directory='performance/pipeline-20261002';mkdirSync(directory,{recursive:true});
const output={kind:'local_api_serialization_and_client_processing_replay',liveEvidenceEligible:false,sourceSha256:createHash('sha256').update(bytes).digest('hex'),
  sourceRows:rows.length,indexBuildMs,samplesPerImplementation:100,omittedRows:0,duplicateRows:0,observations};
writeFileSync(`${directory}/admin-api-current-raw.json`,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({status:'passed',sourceRows:rows.length,samplesPerImplementation:100,firstPageIdsEquivalent:true,indexBuildMs}));
