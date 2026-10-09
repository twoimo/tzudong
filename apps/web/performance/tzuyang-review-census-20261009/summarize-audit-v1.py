"""Verify completed census coverage; publish hashes/codes, never review text."""
import json,hashlib,re,sys,datetime
from pathlib import Path
PUBLIC=Path(__file__).resolve().parent
PRIVATE=Path('/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009')
raw=(PRIVATE/'restaurants-review-snapshot-v1.json').read_bytes()
manifest=json.loads((PUBLIC/'export-manifest-v1.json').read_text())
if hashlib.sha256(raw).hexdigest()!=manifest['sourceSnapshotSha256']:raise SystemExit('CENSUS_SOURCE_HASH_DENIED')
source=json.loads(raw);seen=set();counts={};issues={};guarded=[];usage={};batches=[]
def normalized(value):
 return re.sub(r'\[\s*ts\s*:[^\[\]]*\]','',value or '',flags=re.I)
def numbers(value):
 return sorted(x.replace(',','').replace(' ','') for x in re.findall(r'[+-]?\d+(?:[.,]\d+)*(?:\s?(?:원|인분|인|개|kg|g|분|초|시간|년|월|일|퍼센트|%))?',normalized(value)))
for path in sorted((PRIVATE/'gemini-v3').glob('batch-*.json')):
 b=json.loads(path.read_text())
 if b['sourceSnapshotSha256']!=manifest['sourceSnapshotSha256'] or b['model']!='gemini-3.8-flash' or b['actualModelVersion']!='gemini-3.8-flash' or b['thinkingLevel']!='HIGH':raise SystemExit('CENSUS_MODEL_BINDING_DENIED')
 for k in ['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount']:usage[k]=usage.get(k,0)+b.get('usage',{}).get(k,0)
 for item in b['rows']:
  key=item['key'];idx=int(key[1:])
  if not re.fullmatch(r'r\d{4}',key) or idx>=len(source) or key in seen:raise SystemExit('CENSUS_COVERAGE_DENIED')
  seen.add(key);counts[item['status']]=counts.get(item['status'],0)+1
  for issue in item['issues']:issues[issue]=issues.get(issue,0)+1
  if item['status']=='fix':
   original=source[idx]['tzuyang_review'] or '';updated=item['revisedReview'];flags=[]
   if numbers(original)!=numbers(updated):flags.append('NUMERIC_PRESERVATION_REVIEW')
   if any(x in item['issues'] for x in ['CONTRADICTION','RECORD_MISMATCH','EMPTY_REVIEW','NEEDS_VIDEO_EVIDENCE']):flags.append('SOURCE_REVIEW_REQUIRED')
   if '[CONTACT]' in updated:flags.append('REDACTED_INPUT_REVIEW')
   if re.search(r'\[\s*ts\s*:|```|<think>',updated,re.I):flags.append('INTERNAL_ARTIFACT_REMAINS')
   for phrase in re.findall(r'세계 최고|무조건|완벽한|강력(?:히)? 추천',updated):
    if phrase not in original:flags.append('NEW_PROMOTIONAL_CLAIM')
   guarded.append({'key':key,'sourceReviewSha256':source[idx]['reviewSha256'],'proposalSha256':hashlib.sha256(updated.encode()).hexdigest(),'mechanicalFlags':sorted(set(flags)),'deletedRowPreserved':source[idx]['status']=='deleted','adminLocked':source[idx]['adminLocked'],'semanticApprovalNotEstablished':True})
 batches.append({'index':b['index'],'rows':len(b['rows']),'startedAtUtc':b['startedAtUtc'],'endedAtUtc':b['endedAtUtc'],'inputSha256':b['inputSha256']})
result={'schemaVersion':1,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'totalRows':len(source),'completedRows':len(seen),'remainingRows':len(source)-len(seen),'complete':len(seen)==len(source),'statusCounts':counts,'issueCounts':issues,'completedBatches':batches,'usageOfCompletedResponsesOnly':usage,'failedAttemptsUsageUnknown':True,'proposalMechanicalChecks':guarded,'model':'gemini-3.8-flash','thinkingLevel':'HIGH','operatingWrites':0,'rawReviewTextPersistedInPublicEvidence':False,'limitations':['Metadata/title is not a full video or transcript fact check.','Mechanical flags neither certify semantic equivalence nor authorize an automatic update.','Deleted states remain deleted; empty reviews are not fabricated.']}
label=sys.argv[1]
if not re.fullmatch(r'[a-z0-9-]+',label):raise SystemExit('CENSUS_LABEL_DENIED')
with (PUBLIC/f'census-progress-{label}.json').open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({k:result[k] for k in ['completedRows','remainingRows','complete','statusCounts','issueCounts','usageOfCompletedResponsesOnly']},ensure_ascii=False))
