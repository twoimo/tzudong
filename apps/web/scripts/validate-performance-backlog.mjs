import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, parse as pathParse, relative, resolve, sep as pathSep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This verifier deliberately owns its parser, canonicalizer, schema checks, and scoring.
export const PINNED_RAW_SCHEMA_SHA256 = '1b9a7b84e08496ad5eeda2823b9f92524cbf02025c5d6177c787e2f826d3d11b';
export const PINNED_SCORED_SCHEMA_SHA256 = '04d50a9f126fe8cfca3c166c04f4b5ece121ba5617649a38e8f4a9619d5c4207';
export const PINNED_BUDGET_SHA256 = '7e563fc1c1c18cfa7878f45218768d13f400db364e75f06e482d2c858eeabb37';
const H=/^[a-f0-9]{64}$/, G=/^[a-f0-9]{40}$/, ID=/^[a-z0-9][a-z0-9._-]{0,127}$/, TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
const gates=['duplicate_hot_query_count','new_auth_rls_service_role_no_store_confirmation_readback_audit_violations','app_owned_invocation_errors','candidate_related_failed_production_deployments','required_cell_console_page_network_errors','required_manifest_validator_failures'];
const evidenceForms=new Set(['benchmark_summary','browser_trace','build_manifest','deployment_summary','external_provider','field_cwv','function_summary','network_summary','rss_ndjson','sanitized_browser_summary','sanitized_network_summary','sanitized_query_summary','sanitized_security_review','sanitized_server_timing','server_timing','validator_summary']);
const inventory=`cwv.lcp.p75_ms|public|route.root|public_critical
cwv.inp.p75_ms|public|route.root|public_critical
cwv.cls.p75_milli|public|route.root|public_critical
browser.long_task.max_ms|public|route.root|public_critical
browser.long_task_total_p75_ms|public|route.root|public_critical
interaction.app_owned_p75_ms|public|route.root|public_critical
route.first_load_js.public_gzip_kib|public|route.root|public_critical
route.first_load_js.shell_gzip_kib|shell|app.shell|public_critical
route.first_load_js.admin_gzip_kib|admin|route.admin|admin_operator
route.first_load_js.creative_gzip_kib|creative|route.admin.creative|admin_operator
route.total_transfer_public_kib|public|route.root|public_critical
route.image_transfer_kib|public|route.root|public_critical
route.api_payload_public_kib|api|api.public_bounded|public_secondary
route.api_payload_admin_kib|admin|api.admin|admin_operator
route.server_public_p75_ms|public|route.root|public_critical
route.server_auth_p75_ms|shell|auth.recovery|public_critical
api.bounded_p95_ms|api|api.public_bounded|public_secondary
api.external_backed_p95_ms|api|api.external_backed|public_secondary
map.ready_p75_ms|map|route.root.map|public_critical
admin.shell_usable_p75_ms|admin|route.admin|admin_operator
admin.loaded_switch_p75_ms|admin|route.admin.loaded_switch|admin_operator
admin.lazy_ui_p75_ms|admin|route.admin.lazy_ui|admin_operator
supabase.query_p95_ms|supabase|supabase.public_read|public_secondary
supabase.rows_returned_per_request|supabase|supabase.public_read|public_secondary
supabase.response_kib_per_request|supabase|supabase.public_read|public_secondary
supabase.requests_per_user_action|supabase|supabase.public_action|public_secondary
vercel.function_package_mib|vercel|vercel.production_function|protected_production
vercel.function_cold_p95_ms|vercel|vercel.production_function|protected_production
vercel.function_warm_p95_ms|vercel|vercel.production_function|protected_production
vercel.function_peak_memory_mib|vercel|vercel.production_function|protected_production
typescript.native_cold_p75_ms|typescript|typescript.native|developer
typescript.native_warm_p75_ms|typescript|typescript.native|developer
typescript.native_peak_rss_mib|typescript|typescript.native|developer
backend.no_work_p75_ms|backend|backend.daily|publication
backend.delta_total_p75_ms|backend|backend.daily|publication
backend.peak_rss_mib|backend|backend.daily|publication`.split('\n').map(x=>x.split('|'));
const INV=new Map(inventory.map(([key,surfaceClass,targetId,impact])=>[key,{surfaceClass,targetId,impact}]));
const fail=m=>{throw Error(`performance backlog: ${m}`)}, hash=b=>createHash('sha256').update(b).digest('hex');
const own=(x,ks,n)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==ks.length||ks.some(k=>!(k in x)))fail(`invalid ${n}`)};
const safePath=p=>typeof p==='string'&&p.length<=240&&/^[A-Za-z0-9._@/-]+$/.test(p)&&!p.startsWith('/')&&!p.endsWith('/')&&!p.includes('//')&&!p.includes('\\')&&!/(^|\/)\.{1,2}(\/|$)/.test(p);
const PROSE_ALLOWED=/^[A-Za-z0-9](?:[A-Za-z0-9 ,;!?()']|\.(?= |$))*$/;
const SAFE_PROSE=new Set(['Disable the candidate feature.','Reduce a bounded rendering delay without collecting private records.','Reduce the bounded candidate metric without collecting private records.','Restore backup.','Restore the previous batch.','Restore the previous deployment.','Revert the candidate commit.','Run the declared verification tests.','Stop and escalate on a trust failure.','Stop on a measured regression.','Stop on regression.','Stop writes.']);
const MANIFEST_FORBIDDEN=/[a-z][a-z0-9+.-]*:\/\/|www\.|[?&][a-z0-9_.-]+=|[a-z0-9._%+-]+@[a-z0-9.-]+|\b(?:select|insert|update|delete|merge|union|grant|revoke|execute|exec|call|values|from|where|join|having|into|authorization|bearer|cookie|token|secret|password|credential|trace|customer|restaurant|user|provider)\b|\b(?:x[-_ ]?)?api[-_ ]?key\b|\b(?:production|prod)[-_ ]?(?:id|sha|deployment|project|team|org)\b|\b(?:headers?|query|sql|payload|logs?)\s*[:=]|\braw[-_ ]?logs?\b|\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b[0-9a-f]{32,}\b|[a-z_][a-z0-9_.-]{1,40}\s*=|\b(?:gh[pousr]_|github_pat_|sk[-_](?:(?:proj|live)[-_])?|xox[a-z0-9-]*|akia|aiza|ya29\.)|\b[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|\b[a-z0-9_-]{32,}\b|\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b|\b(?:x-forwarded-for|forwarded|x-real-ip|client-ip|true-client-ip|cf-connecting-ip|via)\b|\b(?:drop|alter|create|truncate)\s+(?:table|database|schema|index|view|function|procedure)\b/i;
const SYMBOL_FORBIDDEN=/(?:^|[.$:#<>])(?:gh[pousr]_|github_pat_|sk[-_](?:(?:proj|live)[-_])?|xox[a-z0-9-]*|akia|aiza|ya29\.)|(?:^|[.$:#<>])[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}(?:$|[.$:#<>])|\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b|^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$|(?:^|[.$:#<>])(?=[a-z0-9_-]{32,}(?:$|[.$:#<>]))(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]{32,}(?=$|[.$:#<>])/i;
const SYMBOL_ALLOWED=/^[A-Za-z0-9_.$:#<>-]+$/;
const safeProse=text=>typeof text==='string'&&SAFE_PROSE.has(text)&&PROSE_ALLOWED.test(text)&&!MANIFEST_FORBIDDEN.test(text);
const safeSymbol=symbol=>typeof symbol==='string'&&SYMBOL_ALLOWED.test(symbol)&&!SYMBOL_FORBIDDEN.test(symbol);
/* JSON.parse cannot report duplicate keys. This scanner is intentionally run first. */
function duplicateFree(s){let i=0; const ws=()=>{while(/[ \n\r\t]/.test(s[i]))i++}; const str=()=>{if(s[i++]!=='"')fail('invalid JSON');let r='';for(;i<s.length;){const c=s[i++];if(c==='"')return r;if(c==='\\'){const e=s[i++];if(!'"\\/bfnrtu'.includes(e))fail('invalid JSON');if(e==='u'){const h=s.slice(i,i+4);if(!/^[0-9a-f]{4}$/i.test(h))fail('invalid JSON');r+=String.fromCharCode(Number.parseInt(h,16));i+=4}else r+='?'}else {if(c<' ')fail('invalid JSON');r+=c}}fail('invalid JSON')};const val=()=>{ws();if(s[i]==='{'){i++;ws();const seen=new Set;if(s[i]==='}'){i++;return}for(;;){ws();const k=str();if(seen.has(k))fail('duplicate JSON key');seen.add(k);ws();if(s[i++]!==':')fail('invalid JSON');val();ws();if(s[i]==='}'){i++;return}if(s[i++]!==',')fail('invalid JSON')}}if(s[i]==='['){i++;ws();if(s[i]===']'){i++;return}for(;;){val();ws();if(s[i]===']'){i++;return}if(s[i++]!==',')fail('invalid JSON')}}if(s[i]==='"'){str();return}if(s.startsWith('true',i)){i+=4;return}if(s.startsWith('false',i)){i+=5;return}if(s.startsWith('null',i)){i+=4;return}const m=s.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!m)fail('invalid JSON');i+=m[0].length};val();ws();if(i!==s.length)fail('invalid JSON')}
function ref(schema,root){if(schema?.$ref){if(schema.$ref.startsWith('#/'))return schema.$ref.slice(2).split('/').reduce((x,k)=>x?.[k],root);fail('external schema reference')}return schema}
function identityFields(schema,n){const fields=schema['x-arrayIdentity'];if(fields===undefined)return null;if(!Array.isArray(fields)||fields.length===0||fields.some(f=>typeof f!=='string'||f.length===0))fail(`invalid array identity ${n}`);return fields}
function identityKey(value,fields,item,root,n){return fields.map(field=>{if(field==='$self')return canonical(value,item,root);if(!value||typeof value!=='object'||Array.isArray(value)||!(field in value))fail(`invalid array identity ${n}`);return canonical(value[field],{},root)}).join('\0')}
function canonical(v,schema,root){schema=ref(schema,root)||{};if(Array.isArray(v)){const item=schema.items||{},fields=identityFields(schema,'schema'),a=[...v];if(fields)a.sort((left,right)=>{const l=identityKey(left,fields,item,root,'schema'),r=identityKey(right,fields,item,root,'schema');return l<r?-1:l>r?1:0});return `[${a.map(x=>canonical(x,item,root)).join(',')}]`}if(v&&typeof v==='object'){return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k],schema.properties?.[k]||{},root)}`).join(',')}}`};return JSON.stringify(v)}
function firstDifference(left,right,path='scored'){if(Object.is(left,right))return null;if(Array.isArray(left)||Array.isArray(right)){if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return path;for(let index=0;index<left.length;index++){const difference=firstDifference(left[index],right[index],`${path}[${index}]`);if(difference)return difference}return null}if(left&&right&&typeof left==='object'&&typeof right==='object'){const leftKeys=Object.keys(left).sort(),rightKeys=Object.keys(right).sort();if(leftKeys.length!==rightKeys.length||leftKeys.some((key,index)=>key!==rightKeys[index]))return path;for(const key of leftKeys){const difference=firstDifference(left[key],right[key],`${path}.${key}`);if(difference)return difference}return null}return path}
function matches(v,schema,root){try{validate(v,schema,root);return true}catch{return false}}
const schemaPatterns=new Map();
function schemaPattern(pattern){let expression=schemaPatterns.get(pattern);if(!expression){expression=new RegExp(pattern);schemaPatterns.set(pattern,expression)}return expression}
function validate(v,schema,root,n='value'){schema=ref(schema,root);if(!schema)fail(`unknown schema ${n}`);if(schema.allOf)for(const s of schema.allOf)validate(v,s,root,n);if(schema.anyOf&&!schema.anyOf.some(s=>matches(v,s,root)))fail(`invalid ${n}`);if(schema.oneOf&&schema.oneOf.filter(s=>matches(v,s,root)).length!==1)fail(`invalid ${n}`);if(schema.not&&matches(v,schema.not,root))fail(`invalid ${n}`);if(schema.if){const branch=matches(v,schema.if,root)?schema.then:schema.else;if(branch)validate(v,branch,root,n)}if(schema.const!==undefined&&v!==schema.const)fail(`invalid ${n}`);if(schema.enum&&!schema.enum.some(x=>x===v))fail(`invalid ${n}`);const types=Array.isArray(schema.type)?schema.type:[schema.type];if(types[0]){const t=Array.isArray(v)?'array':v===null?'null':typeof v;if(!types.some(type => type === 'integer' ? Number.isSafeInteger(v) : type === t)||(t==='number'&&!Number.isFinite(v)))fail(`invalid ${n}`)}if(schema.pattern && typeof v === 'string' && !(schemaPattern(schema.pattern)).test(v))fail(`invalid ${n}`);if((schema.minLength!==undefined&&v.length<schema.minLength)||(schema.maxLength!==undefined&&v.length>schema.maxLength))fail(`invalid ${n}`);if(typeof v==='number'&&(!Number.isSafeInteger(v)||(schema.minimum!==undefined&&v<schema.minimum)||(schema.maximum!==undefined&&v>schema.maximum)))fail(`invalid ${n}`);if(Array.isArray(v)){if(v.length<(schema.minItems??0)||v.length>(schema.maxItems??Infinity))fail(`invalid ${n}`);const fields=identityFields(schema,n),ids=new Set;for(const x of v){validate(x,schema.items||{},root,n);if(fields){const k=identityKey(x,fields,schema.items||{},root,n);if(ids.has(k))fail(`duplicate ${n}`);ids.add(k)}}}if(v&&typeof v==='object'&&!Array.isArray(v)){if(schema.required?.some(k=>!(k in v))||(schema.additionalProperties===false&&Object.keys(v).some(k=>!schema.properties?.[k])))fail(`invalid ${n}`);for(const [k,x] of Object.entries(v))if(schema.properties?.[k])validate(x,schema.properties[k],root,`${n}.${k}`)}}
function parse(b,schema,root,n){let s;try{s=b.toString('utf8')}catch{fail(`${n} is not UTF-8`)}if(!Buffer.from(s).equals(b))fail(`${n} is not UTF-8`);try{duplicateFree(s)}catch(error){if(error?.message==='performance backlog: invalid JSON')fail(`${n} is not JSON`);throw error}let v;try{v=JSON.parse(s)}catch{fail(`${n} is not JSON`)};validate(v,schema,root,n);if(!Buffer.from(`${canonical(v,schema,root)}\n`).equals(b))fail(`${n} is not canonical`);return v}
function safeSize(size,limit){
  if(typeof size!=='bigint'||size<0n||size>BigInt(limit))fail('invalid artifact size');
  return Number(size);
}
function reserveTotal(total,size){
  if(!total)return;
  if(!Number.isSafeInteger(total.bytes)||!Number.isSafeInteger(size)||size<0||total.bytes<0||total.bytes>64*1024*1024-size)fail('aggregate artifact cap');
  total.bytes+=size;
}
function sameSnapshot(left,right){
  return left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeNs===right.mtimeNs&&left.ctimeNs===right.ctimeNs;
}
function stripWindowsVerbatimPrefix(path){
  return path.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'');
}
function sameWindowsArtifactPath(left,right){
  return stripWindowsVerbatimPrefix(left)===stripWindowsVerbatimPrefix(right);
}
function sameArtifactPath(left,right){
  return process.platform==='win32'?sameWindowsArtifactPath(left,right):left===right;
}
async function assertTrustedDirectory(path,message,filesystem={lstat,realpath}){
  let rootStats,canonical,canonicalStats;
  try{
    const pathRoot=pathParse(path).root,parts=relative(pathRoot,path).split(pathSep).filter(Boolean);
    let current=pathRoot;
    for(const part of parts){
      current=resolve(current,part);
      const stats=await filesystem.lstat(current,{bigint:true});
      if(!stats.isDirectory()||stats.isSymbolicLink())fail(message);
    }
    rootStats=await filesystem.lstat(path,{bigint:true});
    canonical=await filesystem.realpath(path);
    canonicalStats=await filesystem.lstat(canonical,{bigint:true});
  }catch(error){
    if(error?.message?.startsWith('performance backlog:'))throw error;
    fail(message);
  }
  if(!rootStats.isDirectory()||rootStats.isSymbolicLink()||!canonicalStats.isDirectory()||canonicalStats.isSymbolicLink()||!sameSnapshot(rootStats,canonicalStats))fail(message);
  return canonical;
}
async function boundedRead(handle,size,limit){
  const length=safeSize(size,limit);
  const buffer=Buffer.allocUnsafe(Math.min(limit+1,length+1));
  let offset=0;
  while(offset<buffer.length){
    const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);
    if(bytesRead===0)break;
    offset+=bytesRead;
  }
  if(offset!==length||offset>limit)fail('artifact changed');
  return buffer.subarray(0,offset);
}
async function read(root,path,digest,limit,cache,total){
  if(!safePath(path)||!H.test(digest))fail('invalid artifact reference');
  const target=resolve(root,path),within=relative(root,target);
  if(within.startsWith('..')||isAbsolute(within))fail('artifact escapes root');
  await assertTrustedDirectory(dirname(target),'artifact escapes root');
  const cacheKey=`${target}\0${digest}`;
  if(cache.has(cacheKey)){
    const cached=cache.get(cacheKey);
    if(cached.length>limit)fail('artifact exceeds role limit');
    return cached;
  }
  let handle;
  try{
    const pathBefore=await lstat(target,{bigint:true});
    if(!pathBefore.isFile()||pathBefore.isSymbolicLink())fail('invalid artifact');
    safeSize(pathBefore.size,limit);
    handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||!sameSnapshot(before,pathBefore))fail('artifact changed');
    const reservedSize=safeSize(before.size,limit);
    reserveTotal(total,reservedSize);
    const bytes=await boundedRead(handle,before.size,limit);
    const after=await handle.stat({bigint:true}),pathAfter=await lstat(target,{bigint:true});
    if(!after.isFile()||!pathAfter.isFile()||pathAfter.isSymbolicLink()||!sameSnapshot(after,before)||!sameSnapshot(pathAfter,before))fail('artifact changed');
    if(hash(bytes)!==digest)fail('artifact hash mismatch');
    cache.set(cacheKey,bytes);
    return bytes;
  }finally{
    await handle?.close();
  }
}
/* Security amendment: the trusted map cannot self-attest, so its exact bytes require the out-of-band --artifact-map-sha256 pin. */
function normalizeSystemRootAlias(value){
  if(process.platform!=='darwin')return value;
  if(value==='/tmp'||value.startsWith('/tmp/'))return `/private${value}`;
  if(value==='/var'||value.startsWith('/var/'))return `/private${value}`;
  return value;
}
function args(a){const names=['--artifact-root','--artifact-map','--artifact-map-sha256','--release-id','--candidate-sha','--candidate-tree','--config-sha256','--data-profile-sha256','--frozen-as-of','--input','--scored'];if(a.length!==22)fail('invalid CLI');const r={};for(let i=0;i<a.length;i+=2)if(!names.includes(a[i])||r[a[i]]||!a[i+1])fail('invalid CLI');else r[a[i]]=a[i+1];if(names.some(k=>!r[k])||!isAbsolute(r['--artifact-root'])||!safePath(r['--artifact-map'])||!safePath(r['--input'])||!safePath(r['--scored'])||!H.test(r['--artifact-map-sha256'])||!ID.test(r['--release-id'])||!G.test(r['--candidate-sha'])||!G.test(r['--candidate-tree'])||!H.test(r['--config-sha256'])||!H.test(r['--data-profile-sha256'])||!TS.test(r['--frozen-as-of']))fail('invalid protected CLI');return r}
const bind=(x,a,n)=>{if(x.releaseId!==a['--release-id']||x.candidate?.sha!==a['--candidate-sha']||x.candidate?.tree!==a['--candidate-tree']||x.configSha256!==a['--config-sha256']||x.dataProfileSha256!==a['--data-profile-sha256'])fail(`${n} binding`)};
function epoch(t){if(!TS.test(t))fail('invalid timestamp');const [Y,M,D,h,m,s,u]=t.match(/\d+/g).map(Number);const d=new Date(0);d.setUTCHours(h,m,s,0);d.setUTCFullYear(Y,M-1,D);if(d.getUTCFullYear()!==Y||d.getUTCMonth()!==M-1||d.getUTCDate()!==D||d.getUTCHours()!==h||d.getUTCMinutes()!==m||d.getUTCSeconds()!==s)fail('invalid timestamp');return BigInt(d.getTime())*1000n+BigInt(u)}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)/2)];const divRound=(n,d)=>Number((n+d/2n)/d);const bps=(n,d)=>{const numerator=BigInt(n),denominator=BigInt(d);return denominator===0n?100000:Math.min(100000,divRound(numerator*10000n,denominator))};
function meetsRatio(numerator,denominator,threshold){
  if(denominator===0)return numerator>0;
  return BigInt(numerator)*10000n>=BigInt(threshold)*BigInt(denominator);
}
function budgetTable(value){
  own(value,['budgets','impactPolicy','manifestPolicy','resourceBounds','schemaVersion','scoreRubric','sha256','sha256Scope','units'],'budget');
  if(value.schemaVersion!=='performance-budgets.v2'||value.sha256Scope!=='canonical-json-without-sha256'||value.units!=='integer'||!H.test(value.sha256)||!Array.isArray(value.budgets)||value.budgets.length!==36)fail('invalid budget');
  const unsigned={...value};
  delete unsigned.sha256;
  if(hash(Buffer.from(`${canonical(unsigned,{},value)}\n`))!==value.sha256)fail('budget self hash');
  const rubric=value.scoreRubric,points=value.impactPolicy?.points;
  if(!rubric||rubric.allArithmetic!=='BigInt'||rubric.severityPoints?.P0!==10000||rubric.severityPoints?.P1!==5000||rubric.riskPenalty?.low!==0||rubric.riskPenalty?.medium!==150||rubric.riskPenalty?.high!==400||rubric.effortPenalty?.small!==0||rubric.effortPenalty?.medium!==75||rubric.effortPenalty?.large!==200||rubric.thresholds?.p0MinimumOverageBasisPoints!==2500||rubric.thresholds?.p1MinimumOverageBasisPoints!==1000||rubric.ranking?.admitCount!==3)fail('invalid score rubric');
  if(!points||points.public_critical!==500||points.protected_production!==450||points.publication!==450||points.public_secondary!==425||points.admin_operator!==350||points.developer!==150)fail('invalid impact policy');
  const table=new Map();
  let previous='';
  const keys=['absoluteBudget','absoluteNoiseFloor','affectedPredicate','baselineComparator','direction','evidenceForms','impact','key','mediumConfidenceMarginBasisPoints','minWindowHours','ownershipThresholdBasisPoints','recencyHours','relativeThresholdBasisPoints','sampleMinimum','surfaceClass','targetId','unit'];
  for(const row of value.budgets){
    own(row,keys,'budget row');
    const expected=INV.get(row.key),identity=`${row.key}\0${row.surfaceClass}\0${row.targetId}`;
    if(!expected||table.has(row.key)||identity<=previous||row.surfaceClass!==expected.surfaceClass||row.targetId!==expected.targetId||row.impact!==expected.impact)fail('invalid budget inventory');
    if(!['maximum','minimum'].includes(row.direction)||!ID.test(row.affectedPredicate)||!ID.test(row.baselineComparator)||!ID.test(row.unit))fail('invalid budget row');
    for(const field of ['absoluteBudget','absoluteNoiseFloor','mediumConfidenceMarginBasisPoints','minWindowHours','ownershipThresholdBasisPoints','recencyHours','relativeThresholdBasisPoints','sampleMinimum']){
      if(!Number.isSafeInteger(row[field])||row[field]<0)fail('invalid budget row');
    }
    if(row.absoluteBudget<1||row.mediumConfidenceMarginBasisPoints<1||row.mediumConfidenceMarginBasisPoints>50000||row.minWindowHours<1||row.ownershipThresholdBasisPoints>10000||row.recencyHours<1||row.sampleMinimum<1)fail('invalid budget row');
    if(!Array.isArray(row.evidenceForms)||!row.evidenceForms.length||new Set(row.evidenceForms).size!==row.evidenceForms.length||row.evidenceForms.some(form=>!evidenceForms.has(form)))fail('invalid evidence forms');
    table.set(row.key,row);
    previous=identity;
  }
  if(table.size!==INV.size)fail('budget inventory');
  Object.defineProperties(table,{rubric:{value:rubric},points:{value:points},resourceBounds:{value:value.resourceBounds}});
  return table;
}
function isProductFile(path){
  return !['AGENTS.md','docs/product/DESIGN.md','README.md','README.ko.md','SECURITY.md'].includes(path)
    &&!/(^|\/)(?:tests?|tests-unit|fixtures|artifacts|evidence|generated)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(path);
}
function manifest(value,item,context){
  bind(value,context,'manifest');
  if(value.schemaVersion!=='performance-design-manifest.v1'||value.candidateId!==item.id)fail('manifest binding');
  const prose=[value.hypothesis,...value.rollback.steps,...value.stopConditions.map(condition=>condition.condition)];
  if(prose.some(text=>!safeProse(text))||value.symbols.some(symbol=>!safeSymbol(symbol.symbol)))fail('unsafe manifest');
  const tests=new Set(value.tests.map(test=>test.id));
  if(value.rollback.verificationTestIds.some(id=>!tests.has(id)))fail('manifest rollback reference');
  const files=value.files.filter(file=>isProductFile(file.path));
  const fileCount=files.length,loc=files.reduce((sum,file)=>sum+BigInt(file.addedNonTestLoc)+BigInt(file.deletedNonTestLoc),0n);
  const privileged=value.boundaries.some(boundary=>boundary.mode==='privileged_write');
  const schema=value.boundaries.some(boundary=>boundary.boundary==='schema'||boundary.mode==='schema_or_rls');
  const high=value.boundaries.some(boundary=>['auth','schema'].includes(boundary.boundary)||boundary.mode==='privileged_write'||['schema_or_rls','deployment_or_rollback','batch_publication','sensitive_evidence'].includes(boundary.mode));
  const configuration=value.boundaries.some(boundary=>['schema','dependency','build','runtime','workflow'].includes(boundary.boundary)||['dependency_change','build_config_change','runtime_config_change','workflow_change','schema_or_rls'].includes(boundary.mode));
  const blocked=fileCount>5||loc>1000n||privileged||schema;
  const medium=value.boundaries.some(boundary=>['data','dependency','build','runtime','workflow'].includes(boundary.boundary)||['dependency_change','build_config_change','runtime_config_change','workflow_change'].includes(boundary.mode));
  const risk=high?'high':medium?'medium':'low';
  const effort=blocked||loc>500n||configuration?'large':fileCount<=2&&loc<=150n?'small':'medium';
  return {risk,effort,...(blocked?{reason:'blocked_scope'}:{})};
}
function measurementEnvelope(value,item,context){
  bind(value,context,'measurement');
  if(value.schemaVersion!=='performance-measurement-source.v1'||value.key!==item.key||value.surfaceClass!==item.surfaceClass||value.targetId!==item.targetId)fail('measurement binding');
  if(value.availability.status==='available'){
    if(value.availability.reason!==null||!value.observations.length||!value.attestations.length)fail('availability');
  }else if(value.availability.status==='unavailable'){
    if(!['access_blocked','source_not_produced','source_redacted','collection_failed'].includes(value.availability.reason)||value.observations.length||value.attestations.length)fail('availability');
  }else fail('availability');
  const start=epoch(value.window.start),end=epoch(value.window.end),frozen=epoch(context['--frozen-as-of']);
  if(end<=start||end>frozen)fail('measurement window');
  for(const observation of value.observations){
    const captured=epoch(observation.capturedAt);
    if(captured<start||captured>end)fail('observation outside window');
  }
  for(const attestation of value.attestations){
    const captured=epoch(attestation.capturedAt);
    if(captured<start||captured>end)fail('attestation outside window');
    if(attestation.evidenceForm==='external_provider'?!ID.test(attestation.providerId||''):attestation.providerId!==null)fail('attestation');
  }
  return {start,end,frozen};
}
function receipt(value,budget,envelope){
  if(value.availability.status==='unavailable'){
    return {reason:{access_blocked:'source_unavailable_access_blocked',source_not_produced:'source_unavailable_not_produced',source_redacted:'source_unavailable_redacted',collection_failed:'source_unavailable_collection_failed'}[value.availability.reason]};
  }
  const {start,end,frozen}=envelope;
  const observations={candidate:[],baseline:[]};
  for(const observation of value.observations){
    if(observation.ownershipBasisPoints>=budget.ownershipThresholdBasisPoints)observations[observation.cohort].push(observation);
  }
  const candidate=observations.candidate,baseline=observations.baseline;
  const newest=candidate.reduce((latest,observation)=>!latest||epoch(observation.capturedAt)>epoch(latest)?observation.capturedAt:latest,null);
  if(newest&&(epoch(newest)>frozen||frozen-epoch(newest)>BigInt(budget.recencyHours)*3600000000n))return {reason:'stale'};
  if(end-start<BigInt(budget.minWindowHours)*3600000000n)return {reason:'window_too_short'};
  if(candidate.length<budget.sampleMinimum||baseline.length<budget.sampleMinimum)return {reason:'insufficient_samples'};
  const forms={candidate:new Set(),baseline:new Set()};
  for(const attestation of value.attestations)forms[attestation.cohort].add(attestation.evidenceForm);
  const required=[...budget.evidenceForms].sort().join('\0');
  if([...forms.candidate].sort().join('\0')!==required||[...forms.baseline].sort().join('\0')!==required)return {reason:'missing_evidence_form'};
  const candidateValues=candidate.map(observation=>observation.value),baselineValues=baseline.map(observation=>observation.value);
  const observed=median(candidateValues),baselineMedian=median(baselineValues),mad=median(candidateValues.map(sample=>Math.abs(sample-observed)));
  const excess=budget.direction==='maximum'?Math.max(0,observed-budget.absoluteBudget):Math.max(0,budget.absoluteBudget-observed);
  const denominator=BigInt(budget.absoluteNoiseFloor)>2n*BigInt(mad)?BigInt(budget.absoluteNoiseFloor):2n*BigInt(mad);
  const margin=excess===0?0:denominator===0n?100000:bps(excess,denominator);
  const affected=candidateValues.filter(sample=>budget.direction==='maximum'?sample>budget.absoluteBudget:sample<budget.absoluteBudget).length;
  return {observed,baseline:baselineMedian,sampleCount:candidateValues.length,eligibleCount:candidateValues.length,affectedCount:affected,evidenceTimestamp:newest,confidenceMarginBasisPoints:margin,confidence:margin>=Math.min(100000,budget.mediumConfidenceMarginBasisPoints*2)?'high':margin>=budget.mediumConfidenceMarginBasisPoints?'medium':'low'};
}
function recompute(raw,table,receipts,manifests,health,context){
  bind(raw,context,'raw');
  bind(health,context,'health');
  if(raw.schemaVersion!=='performance-backlog-raw.v2'||raw.frozenAsOf!==context['--frozen-as-of']||health.schemaVersion!=='performance-health-source.v1')fail('health contract');
  const start=epoch(health.window.start),end=epoch(health.window.end),frozen=epoch(context['--frozen-as-of']);
  if(end<=start||end>frozen)fail('health window');
  const counts=new Map(gates.map(gate=>[gate,0]));
  for(const incident of health.incidents){
    const captured=epoch(incident.capturedAt);
    if(!counts.has(incident.gate)||captured<start||captured>end)fail('health incident');
    counts.set(incident.gate,counts.get(incident.gate)+1);
  }
  if(health.coverage.length!==gates.length||new Set(health.coverage.map(row=>row.gate)).size!==gates.length)fail('health coverage');
  for(const row of health.coverage){
    const expectedForm={duplicate_hot_query_count:'sanitized_query_summary',new_auth_rls_service_role_no_store_confirmation_readback_audit_violations:'sanitized_security_review',app_owned_invocation_errors:'function_summary',candidate_related_failed_production_deployments:'deployment_summary',required_cell_console_page_network_errors:'sanitized_browser_summary',required_manifest_validator_failures:'validator_summary'}[row.gate];
    if(row.evidenceForm!==expectedForm||row.count!==counts.get(row.gate))fail('health coverage');
  }
  const releaseBlocked=health.incidents.length>0,items=[];
  for(const item of raw.items){
    const base={id:item.id,key:item.key,surfaceClass:item.surfaceClass,targetId:item.targetId,impact:null,risk:null,effort:null,severity:null,observed:null,baseline:null,sampleCount:0,affectedCount:0,eligibleCount:0,evidenceTimestamp:null,confidenceMarginBasisPoints:0,confidence:'low',scoreComponents:null,score:null};
    const source=receipts.get(item.id),designed=manifest(manifests.get(item.id),item,context);
    const envelope=measurementEnvelope(source,item,context);
    const budget=table.get(item.key);
    if(!budget){
      Object.assign(base,{risk:designed.risk,effort:designed.effort});
      items.push({...base,status:'not_rankable',decision:'not_eligible',reason:'unknown_budget_key',rank:null});
      continue;
    }
    if(budget.surfaceClass!==item.surfaceClass||budget.targetId!==item.targetId)fail('selector mismatch');
    const measured=receipt(source,budget,envelope),derived={...designed,...measured};
    Object.assign(base,{impact:budget.impact,risk:designed.risk,effort:designed.effort});
    if(derived.reason){
      items.push({...base,...derived,status:'not_rankable',decision:'not_eligible',reason:derived.reason,rank:null});
      continue;
    }
    const excess=budget.direction==='maximum'?Math.max(0,derived.observed-budget.absoluteBudget):Math.max(0,budget.absoluteBudget-derived.observed);
    const over=bps(excess,budget.absoluteBudget),affected=bps(derived.affectedCount,derived.eligibleCount);
    const relative=budget.direction==='maximum'?Math.max(0,derived.observed-derived.baseline):Math.max(0,derived.baseline-derived.observed);
    let reason=null;
    if(excess===0)reason='below_absolute_budget';
    else if(excess<=budget.absoluteNoiseFloor)reason='at_or_below_noise_floor';
    else if(!meetsRatio(excess,budget.absoluteBudget,table.rubric.thresholds.p1MinimumOverageBasisPoints)||!meetsRatio(relative,derived.baseline,budget.relativeThresholdBasisPoints))reason='below_relative_threshold';
    else if(derived.confidence==='low')reason='confidence_below_medium';
    if(reason){
      items.push({...base,...derived,status:'not_rankable',decision:'not_eligible',reason,rank:null});
      continue;
    }
    const severity=meetsRatio(excess,budget.absoluteBudget,table.rubric.thresholds.p0MinimumOverageBasisPoints)&&budget.impact==='public_critical'&&derived.confidence==='high'?'P0':'P1';
    const severityPoints=table.rubric.severityPoints[severity],impact=table.points[budget.impact],risk=table.rubric.riskPenalty[designed.risk],effort=table.rubric.effortPenalty[designed.effort];
    const clampedOver=Math.min(10000,over),clampedAffected=Math.min(10000,affected);
    const overTerm=(BigInt(clampedOver)*20n)/100n,affectedTerm=(BigInt(clampedAffected)*5n)/100n;
    const score=Number(BigInt(severityPoints+impact-risk-effort)+(overTerm>2000n?2000n:overTerm)+(affectedTerm>500n?500n:affectedTerm));
    items.push({...base,...derived,impact:budget.impact,risk:designed.risk,effort:designed.effort,severity,scoreComponents:{severity:severityPoints,impact,risk,effort,percentOverBudgetBasisPoints:clampedOver,affectedBasisPoints:clampedAffected},score,status:'rankable',decision:'deferred_rank_cap',reason:null,rank:null});
  }
  const severity={P0:1,P1:0},risk={low:0,medium:1,high:2},effort={small:0,medium:1,large:2};
  const rankable=items.filter(item=>item.status==='rankable').sort((left,right)=>
    right.score-left.score
    ||severity[right.severity]-severity[left.severity]
    ||table.points[right.impact]-table.points[left.impact]
    ||right.confidenceMarginBasisPoints-left.confidenceMarginBasisPoints
    ||risk[left.risk]-risk[right.risk]
    ||effort[left.effort]-effort[right.effort]
    ||(left.id<right.id?-1:left.id>right.id?1:0)
  );
  if(releaseBlocked){
    for(const item of items)Object.assign(item,{status:'release_blocked',decision:'blocked',reason:'health_gate_failed',rank:null});
  }else{
    rankable.forEach((item,index)=>Object.assign(item,index<table.rubric.ranking.admitCount?{decision:'admitted',reason:null,rank:index+1}:{decision:'deferred_rank_cap',reason:'rank_cap',rank:index+1}));
  }
  return {
    schemaVersion:'performance-backlog-scored.v2',
    releaseId:raw.releaseId,
    candidate:raw.candidate,
    configSha256:raw.configSha256,
    dataProfileSha256:raw.dataProfileSha256,
    frozenAsOf:raw.frozenAsOf,
    generatedAt:context['--frozen-as-of'],
    raw:{path:context['--input'],sha256:null},
    releaseBlocked,
    ranking:{eligibleCount:rankable.length,admittedIds:releaseBlocked?[]:rankable.slice(0,table.rubric.ranking.admitCount).map(item=>item.id),deferredIds:releaseBlocked?[]:rankable.slice(table.rubric.ranking.admitCount).map(item=>item.id)},
    items:items.sort((left,right)=>left.id<right.id?-1:left.id>right.id?1:0),
  };
}
async function main(){
  const a=args(process.argv.slice(2)),root=normalizeSystemRootAlias(resolve(a['--artifact-root'])),cache=new Map,total={bytes:0};
  await assertTrustedDirectory(root,'artifact root alias');
  const mapSchema={type:'object',additionalProperties:false,required:['schemaVersion','releaseId','candidate','configSha256','dataProfileSha256','frozenAsOf','pins','artifacts'],properties:{schemaVersion:{const:'performance-trusted-artifacts.v1'},releaseId:{type:'string',pattern:ID.source},candidate:{type:'object',additionalProperties:false,required:['sha','tree'],properties:{sha:{type:'string',pattern:G.source},tree:{type:'string',pattern:G.source}}},configSha256:{type:'string',pattern:H.source},dataProfileSha256:{type:'string',pattern:H.source},frozenAsOf:{type:'string',pattern:TS.source},pins:{type:'object'},artifacts:{type:'object'}}};
  const mapBytes=await read(root,a['--artifact-map'],a['--artifact-map-sha256'],1024*1024,cache,total);
  const map=parse(mapBytes,mapSchema,mapSchema,'artifact map');
  bind(map,a,'artifact map');
  if(map.frozenAsOf!==a['--frozen-as-of'])fail('artifact map binding');
  own(map.pins,['rawSchema','scoredSchema','budget'],'map pins');
  const paths=new Set;
  for(const pin of Object.values(map.pins)){own(pin,['path','sha256'],'map pin');if(!safePath(pin.path)||!H.test(pin.sha256)||paths.has(pin.path))fail('map pin');paths.add(pin.path)}
  if(!map.artifacts||typeof map.artifacts!=='object'||Array.isArray(map.artifacts))fail('map artifacts');
  for(const [path,digest] of Object.entries(map.artifacts))if(!safePath(path)||!H.test(digest)||paths.has(path))fail('map artifact');else paths.add(path);
  if(paths.has(a['--artifact-map']))fail('artifact map must not be mapped');
  const [rb,sb,bb]=await Promise.all([
    read(root,map.pins.rawSchema.path,map.pins.rawSchema.sha256,1024*1024,cache,total),
    read(root,map.pins.scoredSchema.path,map.pins.scoredSchema.sha256,1024*1024,cache,total),
    read(root,map.pins.budget.path,map.pins.budget.sha256,1024*1024,cache,total),
  ]);
  if(hash(rb)!==PINNED_RAW_SCHEMA_SHA256||hash(sb)!==PINNED_SCORED_SCHEMA_SHA256||hash(bb)!==PINNED_BUDGET_SHA256)fail('pinned contract digest');
  const rawSchema=parse(rb,{type:'object'},{type:'object'},'raw schema');
  const scoredSchema=parse(sb,{type:'object'},{type:'object'},'scored schema');
  const budget=budgetTable(parse(bb,{type:'object'},{type:'object'},'budget'));
  const getBytes=async(p,limit,n)=>{const digest=map.artifacts[p];if(!digest)fail(`map missing ${n}`);return read(root,p,digest,limit,cache,total)};
  const get=async(p,limit,n,s,r)=>parse(await getBytes(p,limit,n),s,r,n);
  const detached=`${a['--scored']}.sha256`;
  if(!safePath(detached))fail('invalid detached hash path');
  const raw=await get(a['--input'],8*1024*1024,'raw',rawSchema,rawSchema);
  const bindArtifact=(reference,name)=>{
    own(reference,['path','sha256'],name);
    if(!safePath(reference.path)||map.artifacts[reference.path]!==reference.sha256)fail(`unbound ${name}`);
    return reference.path;
  };
  const healthPath=bindArtifact(raw.healthReceipt,'health reference');
  const itemReferences=raw.items.map(item=>({
    id:item.id,
    measurementPath:bindArtifact(item.measurement,'measurement reference'),
    manifestPath:bindArtifact(item.manifest,'manifest reference'),
  }));
  const refs=new Set([a['--input'],a['--scored'],detached,healthPath,...itemReferences.flatMap(item=>[item.measurementPath,item.manifestPath])]);
  if(refs.size!==4+raw.items.length*2||Object.keys(map.artifacts).length!==refs.size||[...refs].some(path=>!map.artifacts[path]))fail('unexpected map artifact');
  const health=await get(healthPath,2*1024*1024,'health',rawSchema.$defs.healthReceipt,rawSchema);
  const receipts=new Map,manifests=new Map;
  for(const item of itemReferences){
    receipts.set(item.id,await get(item.measurementPath,8*1024*1024,'measurement',rawSchema.$defs.measurementReceipt,rawSchema));
    manifests.set(item.id,await get(item.manifestPath,2*1024*1024,'manifest',rawSchema.$defs.manifest,rawSchema));
  }
  const scoredBytes=await getBytes(a['--scored'],16*1024*1024,'scored');
  const detachedBytes=await getBytes(detached,1024,'detached scored hash');
  if(!Buffer.from(`${hash(scoredBytes)}\n`).equals(detachedBytes))fail('detached scored hash mismatch');
  const supplied=parse(scoredBytes,scoredSchema,scoredSchema,'scored');
  const expected=recompute(raw,budget,receipts,manifests,health,a);
  expected.raw.sha256=map.artifacts[a['--input']];
  const expectedBytes=Buffer.from(`${canonical(expected,scoredSchema,scoredSchema)}\n`);
  const expectedCanonical=canonical(expected,scoredSchema,scoredSchema),suppliedCanonical=canonical(supplied,scoredSchema,scoredSchema);
  const difference=firstDifference(JSON.parse(expectedCanonical),JSON.parse(suppliedCanonical));
  if(!expectedBytes.equals(scoredBytes)||difference){
    const match=/^scored\.items\[(\d+)\]/.exec(difference??'');
    const index=match?Number(match[1]):-1;
    const expectedObject=JSON.parse(expectedCanonical),suppliedObject=JSON.parse(suppliedCanonical);
    const expectedState=index>=0?expectedObject.items[index]:null,suppliedState=index>=0?suppliedObject.items[index]:null;
    const state=value=>`${value?.status??null}/${value?.reason??null}/${value?.rank??null}`;
    fail(`scored recomputation mismatch at ${(difference??'scored').slice(0,160)} expected=${state(expectedState)} supplied=${state(suppliedState)}`);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))main().catch(error=>{const message=error?.message?.startsWith('performance backlog:')?error.message:'performance backlog: internal failure';process.stderr.write(`${message}\n`);process.exitCode=1});
export { assertTrustedDirectory, budgetTable, canonical, recompute, sameArtifactPath, sameWindowsArtifactPath, stripWindowsVerbatimPrefix };
