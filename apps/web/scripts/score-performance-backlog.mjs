import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, link, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, parse as pathParse, relative, resolve, sep as pathSep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Finalization point: replace all three constants together after the contracts settle.
export const PINNED_RAW_SCHEMA_SHA256 = '1b9a7b84e08496ad5eeda2823b9f92524cbf02025c5d6177c787e2f826d3d11b';
export const PINNED_SCORED_SCHEMA_SHA256 = '04d50a9f126fe8cfca3c166c04f4b5ece121ba5617649a38e8f4a9619d5c4207';
export const PINNED_BUDGET_SHA256 = '7e563fc1c1c18cfa7878f45218768d13f400db364e75f06e482d2c858eeabb37';
const H=/^[a-f0-9]{64}$/, G=/^[a-f0-9]{40}$/, ID=/^[a-z0-9][a-z0-9._-]{0,127}$/, TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
const MiB=1024*1024, fail=m=>{throw Error(`performance backlog: ${m}`)}, hash=b=>createHash('sha256').update(b).digest('hex');
const GATES={duplicate_hot_query_count:'sanitized_query_summary',new_auth_rls_service_role_no_store_confirmation_readback_audit_violations:'sanitized_security_review',app_owned_invocation_errors:'function_summary',candidate_related_failed_production_deployments:'deployment_summary',required_cell_console_page_network_errors:'sanitized_browser_summary',required_manifest_validator_failures:'validator_summary'};
const EVIDENCE_FORMS=new Set(['benchmark_summary','browser_trace','build_manifest','deployment_summary','external_provider','field_cwv','function_summary','network_summary','rss_ndjson','sanitized_browser_summary','sanitized_network_summary','sanitized_query_summary','sanitized_security_review','sanitized_server_timing','server_timing','validator_summary']);
const INVENTORY=new Map(`cwv.lcp.p75_ms|public|route.root|public_critical
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
backend.peak_rss_mib|backend|backend.daily|publication`.split('\n').map(x=>{const [k,s,t,i]=x.split('|');return[k,{surfaceClass:s,targetId:t,impact:i}]}));
const own=(x,keys,n)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||keys.some(k=>!(k in x)))fail(`invalid ${n}`)};
const safePath=(p,n='path')=>{if(typeof p!=='string'||p.length>240||!/^[A-Za-z0-9._@/-]+$/.test(p)||p.startsWith('/')||p.endsWith('/')||p.includes('//')||p.includes('\\')||/(^|\/)\.{1,2}(\/|$)/.test(p))fail(`invalid ${n}`);return p};
/* JSON.parse cannot detect duplicate keys.  This lexer rejects them before parsing. */
function duplicateFreeJson(b,n){const s=b.toString('utf8');if(!Buffer.from(s).equals(b)||s.includes('\r')||s.charCodeAt(0)===0xfeff)fail(`${n} is not UTF-8/LF`);let i=0;const ws=()=>{while(/[ \n\t]/.test(s[i]))i++};const str=()=>{const start=i++;let out='';while(i<s.length){const c=s[i++];if(c==='"')return out;if(c==='\\'){const q=s[i++];if(!q)break;out+='\\'+q;if(q==='u')out+=s.slice(i,i+=4)}else out+=c}fail(`${n} string`)};const val=()=>{ws();if(s[i]==='{'){i++;const seen=new Set();ws();if(s[i]==='}'){i++;return}for(;;){ws();if(s[i]!=='"')fail(`${n} object`);const k=str();if(seen.has(k))fail(`${n} duplicate key`);seen.add(k);ws();if(s[i++]!==':')fail(`${n} object`);val();ws();if(s[i]==='}'){i++;return}if(s[i++]!==',')fail(`${n} object`)}}if(s[i]==='['){i++;ws();if(s[i]===']'){i++;return}for(;;){val();ws();if(s[i]===']'){i++;return}if(s[i++]!==',')fail(`${n} array`)}}if(s[i]==='"'){str();return}const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i));if(!m)fail(`${n} value`);i+=m[0].length};try{val();ws();if(i!==s.length)fail(`${n} trailing JSON`);return JSON.parse(s)}catch(e){if(e.message?.startsWith('performance backlog:'))throw e;fail(`${n} JSON`)}}
function deref(schema,root){return schema.$ref?schema.$ref.startsWith('#/$defs/')?root.$defs[schema.$ref.slice(8)]||fail('bad schema ref'):fail('external schema ref'):schema}
function identityFields(s,n){const f=s['x-arrayIdentity'];if(f===undefined)return null;if(!Array.isArray(f)||f.length===0||f.some(k=>typeof k!=='string'||k.length===0)||new Set(f).size!==f.length||(f.includes('$self')&&f.length!==1))fail(`invalid ${n} identity annotation`);return f}
function identityKey(x,f,n){if(f[0]==='$self'){if(x!==null&&typeof x==='object')fail(`invalid ${n} scalar identity`);return JSON.stringify(x)}if(!x||typeof x!=='object'||Array.isArray(x)||f.some(k=>!Object.prototype.hasOwnProperty.call(x,k)))fail(`invalid ${n} identity`);return JSON.stringify(f.map(k=>x[k]))}
function schemaMatches(value,schema,root){try{validate(value,schema,root);return true}catch{return false}}
const SCHEMA_PATTERNS=new Map();
function patternMatches(pattern,value){
  let expression=SCHEMA_PATTERNS.get(pattern);
  if(!expression){expression=new RegExp(pattern);SCHEMA_PATTERNS.set(pattern,expression)}
  return expression.test(value);
}
function validate(value,schema,root,name='value'){
  schema=deref(schema,root);
  if(schema.allOf)for(const branch of schema.allOf)validate(value,branch,root,name);
  if(schema.anyOf&&!schema.anyOf.some(branch=>schemaMatches(value,branch,root)))fail(`invalid ${name}`);
  if(schema.oneOf&&schema.oneOf.filter(branch=>schemaMatches(value,branch,root)).length!==1)fail(`invalid ${name}`);
  if(schema.not&&schemaMatches(value,schema.not,root))fail(`invalid ${name}`);
  if(schema.if){
    const branch=schemaMatches(value,schema.if,root)?schema.then:schema.else;
    if(branch)validate(value,branch,root,name);
  }
  if(Object.hasOwn(schema,'const')&&value!==schema.const)fail(`invalid ${name}`);
  if(schema.enum&&!schema.enum.some(expected=>expected===value))fail(`invalid ${name}`);
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    const matches=types.some(type=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?Boolean(value)&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isSafeInteger(value):typeof value===type);
    if(!matches)fail(`invalid ${name}`);
  }
  if(typeof value==='string'&&((schema.maxLength!==undefined&&value.length>schema.maxLength)||(schema.minLength!==undefined&&value.length<schema.minLength)||(schema.pattern&&!patternMatches(schema.pattern, value))))fail(`invalid ${name}`);
  if(typeof value==='number'&&(!Number.isSafeInteger(value)||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))fail(`invalid ${name}`);
  if(Array.isArray(value)){
    if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))fail(`invalid ${name}`);
    const fields=identityFields(schema,name),identities=new Set();
    for(let index=0;index<value.length;index++){
      validate(value[index],schema.items||{},root,`${name}[${index}]`);
      if(fields){
        const identity=identityKey(value[index],fields,name);
        if(identities.has(identity))fail(`duplicate ${name}`);
        identities.add(identity);
      }
    }
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    if(schema.required?.some(key=>!Object.hasOwn(value,key))||(schema.additionalProperties===false&&Object.keys(value).some(key=>!schema.properties?.[key])))fail(`invalid ${name}`);
    for(const [key,nested] of Object.entries(value))if(schema.properties?.[key])validate(nested,schema.properties[key],root,`${name}.${key}`);
  }
}
function canonicalString(v,s,root){
  s=deref(s,root);
  if(Array.isArray(v)){
    const values=[...v],fields=identityFields(s,'schema');
    if(fields)values.sort((left,right)=>{const l=identityKey(left,fields,'canonical identity'),r=identityKey(right,fields,'canonical identity');return l<r?-1:l>r?1:0});
    return `[${values.map(value=>canonicalString(value,s.items||{},root)).join(',')}]`;
  }
  if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(key=>`${JSON.stringify(key)}:${canonicalString(v[key],s.properties?.[key]||{},root)}`).join(',')}}`;
  return JSON.stringify(v);
}
function canonicalBytes(v,s,root){return Buffer.from(`${canonicalString(v,s,root)}\n`)}
function parseArtifact(b,s,root,n){const v=duplicateFreeJson(b,n);validate(v,s,root,n);if(!canonicalBytes(v,s,root).equals(b))fail(`${n} is not canonical`);return v}
function safeSize(size,limit){
  if(typeof size!=='bigint'||size<0n||size>BigInt(limit))fail('invalid artifact size');
  return Number(size);
}
function reserveAggregate(total,size){
  if(!total||!Number.isSafeInteger(total.n)||!Number.isSafeInteger(size)||size<0||total.n<0||total.n>64*MiB-size)fail('aggregate cap');
  total.n+=size;
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
function normalizeSystemRootAlias(value){
  if(process.platform!=='darwin')return value;
  if(value==='/tmp'||value.startsWith('/tmp/'))return `/private${value}`;
  if(value==='/var'||value.startsWith('/var/'))return `/private${value}`;
  return value;
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
async function readBounded(handle,size,limit){
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
async function readTrusted(root,relativePath,digest,limit,total){
  safePath(relativePath);
  if(!H.test(digest))fail('invalid artifact hash');
  const target=resolve(root,relativePath),within=relative(root,target);
  if(within.startsWith('..')||isAbsolute(within)||target!==resolve(root,relativePath))fail('artifact escapes root');
  await assertTrustedDirectory(dirname(target),'artifact escapes root');
  let handle;
  try{
    const pathBefore=await lstat(target,{bigint:true});
    if(!pathBefore.isFile()||pathBefore.isSymbolicLink())fail('invalid artifact');
    safeSize(pathBefore.size,limit);
    handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||!sameSnapshot(before,pathBefore))fail('artifact changed');
    const reservedSize=safeSize(before.size,limit);
    reserveAggregate(total,reservedSize);
    const bytes=await readBounded(handle,before.size,limit);
    const after=await handle.stat({bigint:true}),pathAfter=await lstat(target,{bigint:true});
    if(!after.isFile()||!pathAfter.isFile()||pathAfter.isSymbolicLink()||!sameSnapshot(after,before)||!sameSnapshot(pathAfter,before))fail('artifact changed');
    if(hash(bytes)!==digest)fail('artifact hash mismatch');
    return bytes;
  }finally{
    await handle?.close();
  }
}
/* Security amendment: the trusted map cannot self-attest, so its exact bytes require the out-of-band --artifact-map-sha256 pin. */
function cli(argv){const names=['--artifact-root','--artifact-map','--artifact-map-sha256','--release-id','--candidate-sha','--candidate-tree','--config-sha256','--data-profile-sha256','--frozen-as-of','--input','--output'];if(argv.length!==22)fail('invalid CLI');const a={};for(let i=0;i<argv.length;i+=2){if(!names.includes(argv[i])||a[argv[i]]||!argv[i+1])fail('invalid CLI');a[argv[i]]=argv[i+1]}if(names.some(k=>!a[k])||!isAbsolute(a['--artifact-root'])||!H.test(a['--artifact-map-sha256'])||!ID.test(a['--release-id'])||!G.test(a['--candidate-sha'])||!G.test(a['--candidate-tree'])||!H.test(a['--config-sha256'])||!H.test(a['--data-profile-sha256'])||!TS.test(a['--frozen-as-of']))fail('invalid protected CLI');safePath(a['--artifact-map']);safePath(a['--input']);safePath(a['--output']);return a}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);function bind(x,a,n){if(x.releaseId!==a['--release-id']||!same(x.candidate,{sha:a['--candidate-sha'],tree:a['--candidate-tree']})||x.configSha256!==a['--config-sha256']||x.dataProfileSha256!==a['--data-profile-sha256'])fail(`${n} binding`)}
function micros(t){if(!TS.test(t))fail('invalid timestamp');const [Y,M,D,h,m,s,u]=t.match(/\d+/g).map(Number);if(M<1||M>12||D<1||D>31||h>23||m>59||s>59)fail('invalid timestamp');const leap=Y%4===0&&(Y%100!==0||Y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(D>days[M-1])fail('invalid timestamp');let d=D-1;for(let q=1;q<M;q++)d+=days[q-1];const y=Y-1;return (BigInt((y*365+Math.floor(y/4)-Math.floor(y/100)+Math.floor(y/400)+d)*86400+h*3600+m*60+s)*1000000n)+BigInt(u)}
const half=(n,d)=>Number((n+d/2n)/d), median=a=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)/2)], bp=(n,d)=>{const numerator=BigInt(n),denominator=BigInt(d);return denominator===0n?100000:Math.min(100000,half(numerator*10000n,denominator))};
function ratioAtLeast(numerator,denominator,threshold){
  if(denominator===0)return numerator>0;
  return BigInt(numerator)*10000n>=BigInt(threshold)*BigInt(denominator);
}
const SEVERITY_ORDER={P0:1,P1:0},RISK_ORDER={low:0,medium:1,high:2},EFFORT_ORDER={small:0,medium:1,large:2};
function compareRankedItems(left,right,impactPoints){
  return right.score-left.score
    ||SEVERITY_ORDER[right.severity]-SEVERITY_ORDER[left.severity]
    ||impactPoints[right.impact]-impactPoints[left.impact]
    ||right.confidenceMarginBasisPoints-left.confidenceMarginBasisPoints
    ||RISK_ORDER[left.risk]-RISK_ORDER[right.risk]
    ||EFFORT_ORDER[left.effort]-EFFORT_ORDER[right.effort]
    ||(left.id<right.id?-1:left.id>right.id?1:0);
}
function budgets(value){
  own(value,['budgets','impactPolicy','manifestPolicy','resourceBounds','schemaVersion','scoreRubric','sha256','sha256Scope','units'],'budget');
  if(value.schemaVersion!=='performance-budgets.v2'||value.sha256Scope!=='canonical-json-without-sha256'||value.units!=='integer'||!H.test(value.sha256)||!Array.isArray(value.budgets)||value.budgets.length!==36)fail('invalid budget');
  const unsigned={...value};
  delete unsigned.sha256;
  if(hash(canonicalBytes(unsigned,{},{}))!==value.sha256)fail('budget self hash');
  const rubric=value.scoreRubric,points=value.impactPolicy?.points;
  if(!rubric||rubric.allArithmetic!=='BigInt'||rubric.severityPoints?.P0!==10000||rubric.severityPoints?.P1!==5000||rubric.riskPenalty?.low!==0||rubric.riskPenalty?.medium!==150||rubric.riskPenalty?.high!==400||rubric.effortPenalty?.small!==0||rubric.effortPenalty?.medium!==75||rubric.effortPenalty?.large!==200||rubric.thresholds?.p0MinimumOverageBasisPoints!==2500||rubric.thresholds?.p1MinimumOverageBasisPoints!==1000||rubric.ranking?.admitCount!==3)fail('invalid score rubric');
  if(!points||points.public_critical!==500||points.protected_production!==450||points.publication!==450||points.public_secondary!==425||points.admin_operator!==350||points.developer!==150)fail('invalid impact policy');
  const rows=new Map();
  let previous='';
  const rowKeys=['absoluteBudget','absoluteNoiseFloor','affectedPredicate','baselineComparator','direction','evidenceForms','impact','key','mediumConfidenceMarginBasisPoints','minWindowHours','ownershipThresholdBasisPoints','recencyHours','relativeThresholdBasisPoints','sampleMinimum','surfaceClass','targetId','unit'];
  for(const row of value.budgets){
    own(row,rowKeys,'budget row');
    const inventory=INVENTORY.get(row.key),identity=`${row.key}\0${row.surfaceClass}\0${row.targetId}`;
    if(!inventory||rows.has(row.key)||identity<=previous||row.surfaceClass!==inventory.surfaceClass||row.targetId!==inventory.targetId||row.impact!==inventory.impact)fail('invalid budget inventory');
    if(!['maximum','minimum'].includes(row.direction)||!ID.test(row.affectedPredicate)||!ID.test(row.baselineComparator)||!ID.test(row.unit))fail('invalid budget row');
    for(const field of ['absoluteBudget','absoluteNoiseFloor','mediumConfidenceMarginBasisPoints','minWindowHours','ownershipThresholdBasisPoints','recencyHours','relativeThresholdBasisPoints','sampleMinimum']){
      if(!Number.isSafeInteger(row[field])||row[field]<0)fail('invalid budget row');
    }
    if(row.absoluteBudget<1||row.mediumConfidenceMarginBasisPoints<1||row.mediumConfidenceMarginBasisPoints>50000||row.minWindowHours<1||row.ownershipThresholdBasisPoints>10000||row.recencyHours<1||row.sampleMinimum<1)fail('invalid budget row');
    if(!Array.isArray(row.evidenceForms)||!row.evidenceForms.length||new Set(row.evidenceForms).size!==row.evidenceForms.length||row.evidenceForms.some(form=>!EVIDENCE_FORMS.has(form)))fail('invalid evidence forms');
    rows.set(row.key,row);
    previous=identity;
  }
  if(rows.size!==INVENTORY.size)fail('budget inventory');
  Object.defineProperties(rows,{
    rubric:{value:rubric},
    impactPoints:{value:points},
    manifestPolicy:{value:value.manifestPolicy},
    resourceBounds:{value:value.resourceBounds},
  });
  return rows;
}
function productFile(path){
  if(['AGENTS.md','docs/product/DESIGN.md','README.md','README.ko.md','SECURITY.md'].includes(path))return false;
  return !/(^|\/)(?:tests?|tests-unit|fixtures|artifacts|evidence|generated)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(path);
}
const PROSE_ALLOWED=/^[A-Za-z0-9](?:[A-Za-z0-9 ,;!?()']|\.(?= |$))*$/;
const SAFE_PROSE=new Set(['Disable the candidate feature.','Reduce a bounded rendering delay without collecting private records.','Reduce the bounded candidate metric without collecting private records.','Restore backup.','Restore the previous batch.','Restore the previous deployment.','Revert the candidate commit.','Run the declared verification tests.','Stop and escalate on a trust failure.','Stop on a measured regression.','Stop on regression.','Stop writes.']);
const MANIFEST_FORBIDDEN=/[a-z][a-z0-9+.-]*:\/\/|www\.|[?&][a-z0-9_.-]+=|[a-z0-9._%+-]+@[a-z0-9.-]+|\b(?:select|insert|update|delete|merge|union|grant|revoke|execute|exec|call|values|from|where|join|having|into|authorization|bearer|cookie|token|secret|password|credential|trace|customer|restaurant|user|provider)\b|\b(?:x[-_ ]?)?api[-_ ]?key\b|\b(?:production|prod)[-_ ]?(?:id|sha|deployment|project|team|org)\b|\b(?:headers?|query|sql|payload|logs?)\s*[:=]|\braw[-_ ]?logs?\b|\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b[0-9a-f]{32,}\b|[a-z_][a-z0-9_.-]{1,40}\s*=|\b(?:gh[pousr]_|github_pat_|sk[-_](?:(?:proj|live)[-_])?|xox[a-z0-9-]*|akia|aiza|ya29\.)|\b[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|\b[a-z0-9_-]{32,}\b|\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b|\b(?:x-forwarded-for|forwarded|x-real-ip|client-ip|true-client-ip|cf-connecting-ip|via)\b|\b(?:drop|alter|create|truncate)\s+(?:table|database|schema|index|view|function|procedure)\b/i;
const SYMBOL_FORBIDDEN=/(?:^|[.$:#<>])(?:gh[pousr]_|github_pat_|sk[-_](?:(?:proj|live)[-_])?|xox[a-z0-9-]*|akia|aiza|ya29\.)|(?:^|[.$:#<>])[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}(?:$|[.$:#<>])|\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b|^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$|(?:^|[.$:#<>])(?=[a-z0-9_-]{32,}(?:$|[.$:#<>]))(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9_-]{32,}(?=$|[.$:#<>])/i;
const SYMBOL_ALLOWED=/^[A-Za-z0-9_.$:#<>-]+$/;
const safeProse=text=>typeof text==='string'&&SAFE_PROSE.has(text)&&PROSE_ALLOWED.test(text)&&!MANIFEST_FORBIDDEN.test(text);
const safeSymbol=symbol=>typeof symbol==='string'&&SYMBOL_ALLOWED.test(symbol)&&!SYMBOL_FORBIDDEN.test(symbol);
function manifest(value,item,context){
  bind(value,context,'manifest');
  if(value.schemaVersion!=='performance-design-manifest.v1'||value.candidateId!==item.id)fail('manifest binding');
  const prose=[value.hypothesis,...value.rollback.steps,...value.stopConditions.map(condition=>condition.condition)];
  if(prose.some(text=>!safeProse(text))||value.symbols.some(symbol=>!safeSymbol(symbol.symbol)))fail('unsafe manifest');
  const testIds=new Set(value.tests.map(test=>test.id));
  if(value.rollback.verificationTestIds.some(id=>!testIds.has(id)))fail('manifest rollback reference');
  const files=value.files.filter(file=>productFile(file.path));
  const productFiles=files.length,changedLoc=files.reduce((total,file)=>total+BigInt(file.addedNonTestLoc)+BigInt(file.deletedNonTestLoc),0n);
  const boundaries=value.boundaries;
  const privileged=boundaries.some(boundary=>boundary.mode==='privileged_write');
  const schema=boundaries.some(boundary=>boundary.boundary==='schema'||boundary.mode==='schema_or_rls');
  const high=boundaries.some(boundary=>['auth','schema'].includes(boundary.boundary)||boundary.mode==='privileged_write'||['schema_or_rls','deployment_or_rollback','batch_publication','sensitive_evidence'].includes(boundary.mode));
  const configurationBoundary=boundaries.some(boundary=>['schema','dependency','build','runtime','workflow'].includes(boundary.boundary)||['dependency_change','build_config_change','runtime_config_change','workflow_change','schema_or_rls'].includes(boundary.mode));
  const blocked=productFiles>5||changedLoc>1000n||schema||privileged;
  const medium=boundaries.some(boundary=>['data','dependency','build','runtime','workflow'].includes(boundary.boundary)||['dependency_change','build_config_change','runtime_config_change','workflow_change'].includes(boundary.mode));
  const risk=high?'high':medium?'medium':'low';
  const effort=blocked||changedLoc>500n||configurationBoundary?'large':productFiles<=2&&changedLoc<=150n?'small':'medium';
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
  const start=micros(value.window.start),end=micros(value.window.end),frozen=micros(context['--frozen-as-of']);
  if(end<=start||end>frozen)fail('measurement window');
  for(const observation of value.observations){
    const captured=micros(observation.capturedAt);
    if(captured<start||captured>end)fail('observation outside window');
  }
  for(const attestation of value.attestations){
    const captured=micros(attestation.capturedAt);
    if(captured<start||captured>end)fail('attestation outside window');
    if(attestation.evidenceForm==='external_provider'?!ID.test(attestation.providerId||''):attestation.providerId!==null)fail('attestation provider');
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
  const latest=candidate.reduce((current,observation)=>!current||micros(observation.capturedAt)>micros(current)?observation.capturedAt:current,null);
  if(latest&&(micros(latest)>frozen||frozen-micros(latest)>BigInt(budget.recencyHours)*3600000000n))return {reason:'stale'};
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
  const confidenceMarginBasisPoints=excess===0?0:denominator===0n?100000:bp(excess,denominator);
  const affectedCount=candidateValues.filter(sample=>budget.direction==='maximum'?sample>budget.absoluteBudget:sample<budget.absoluteBudget).length;
  return {
    observed,
    baseline:baselineMedian,
    sampleCount:candidateValues.length,
    affectedCount,
    eligibleCount:candidateValues.length,
    evidenceTimestamp:latest,
    confidenceMarginBasisPoints,
    confidence:confidenceMarginBasisPoints>=Math.min(100000,budget.mediumConfidenceMarginBasisPoints*2)?'high':confidenceMarginBasisPoints>=budget.mediumConfidenceMarginBasisPoints?'medium':'low',
  };
}
function derive(raw,rawRef,table,receipts,manifests,health,context){
  bind(raw,context,'raw');
  bind(health,context,'health');
  if(raw.schemaVersion!=='performance-backlog-raw.v2'||raw.frozenAsOf!==context['--frozen-as-of']||health.schemaVersion!=='performance-health-source.v1')fail('invalid raw/health');
  const healthStart=micros(health.window.start),healthEnd=micros(health.window.end),frozen=micros(context['--frozen-as-of']);
  if(healthEnd<=healthStart||healthEnd>frozen)fail('health window');
  const incidentCounts=new Map(Object.keys(GATES).map(gate=>[gate,0]));
  for(const incident of health.incidents){
    const captured=micros(incident.capturedAt);
    if(!incidentCounts.has(incident.gate)||captured<healthStart||captured>healthEnd)fail('health incident');
    incidentCounts.set(incident.gate,incidentCounts.get(incident.gate)+1);
  }
  if(health.coverage.length!==6||new Set(health.coverage.map(row=>row.gate)).size!==6)fail('health coverage');
  for(const row of health.coverage){
    if(GATES[row.gate]!==row.evidenceForm||row.count!==incidentCounts.get(row.gate))fail('health coverage');
  }
  const blocked=health.incidents.length>0;
  const items=[];
  for(const item of raw.items){
    const base={
      id:item.id,key:item.key,surfaceClass:item.surfaceClass,targetId:item.targetId,
      impact:null,risk:null,effort:null,severity:null,observed:null,baseline:null,
      sampleCount:0,affectedCount:0,eligibleCount:0,evidenceTimestamp:null,
      confidenceMarginBasisPoints:0,confidence:'low',scoreComponents:null,score:null,
    };
    const source=receipts.get(item.id),design=manifest(manifests.get(item.id),item,context);
    const envelope=measurementEnvelope(source,item,context);
    const budget=table.get(item.key);
    if(!budget){
      Object.assign(base,{risk:design.risk,effort:design.effort});
      items.push({...base,status:'not_rankable',decision:'not_eligible',reason:'unknown_budget_key',rank:null});
      continue;
    }
    if(budget.surfaceClass!==item.surfaceClass||budget.targetId!==item.targetId)fail('selector mismatch');
    const measurement=receipt(source,budget,envelope);
    const derived={...design,...measurement};
    Object.assign(base,{impact:budget.impact,risk:design.risk,effort:design.effort});
    if(derived.reason){
      items.push({...base,...derived,status:'not_rankable',decision:'not_eligible',reason:derived.reason,rank:null});
      continue;
    }
    const excess=budget.direction==='maximum'?Math.max(0,derived.observed-budget.absoluteBudget):Math.max(0,budget.absoluteBudget-derived.observed);
    const percentOverBudgetBasisPoints=bp(excess,budget.absoluteBudget);
    const affectedBasisPoints=bp(derived.affectedCount,derived.eligibleCount);
    const relativeExcess=budget.direction==='maximum'?Math.max(0,derived.observed-derived.baseline):Math.max(0,derived.baseline-derived.observed);
    let reason=null;
    if(excess===0)reason='below_absolute_budget';
    else if(excess<=budget.absoluteNoiseFloor)reason='at_or_below_noise_floor';
    else if(!ratioAtLeast(excess,budget.absoluteBudget,table.rubric.thresholds.p1MinimumOverageBasisPoints)||!ratioAtLeast(relativeExcess,derived.baseline,budget.relativeThresholdBasisPoints))reason='below_relative_threshold';
    else if(derived.confidence==='low')reason='confidence_below_medium';
    if(reason){
      items.push({...base,...derived,status:'not_rankable',decision:'not_eligible',reason,rank:null});
      continue;
    }
    const severity=ratioAtLeast(excess,budget.absoluteBudget,table.rubric.thresholds.p0MinimumOverageBasisPoints)&&budget.impact==='public_critical'&&derived.confidence==='high'?'P0':'P1';
    const severityPoints=table.rubric.severityPoints[severity],impactPoints=table.impactPoints[budget.impact],riskPenalty=table.rubric.riskPenalty[design.risk],effortPenalty=table.rubric.effortPenalty[design.effort];
    const clampedOver=Math.min(10000,percentOverBudgetBasisPoints),clampedAffected=Math.min(10000,affectedBasisPoints);
    const overTerm=(BigInt(clampedOver)*20n)/100n,affectedTerm=(BigInt(clampedAffected)*5n)/100n;
    const score=Number(BigInt(severityPoints+impactPoints-riskPenalty-effortPenalty)+(overTerm>2000n?2000n:overTerm)+(affectedTerm>500n?500n:affectedTerm));
    items.push({
      ...base,...derived,impact:budget.impact,risk:design.risk,effort:design.effort,severity,
      scoreComponents:{severity:severityPoints,impact:impactPoints,risk:riskPenalty,effort:effortPenalty,percentOverBudgetBasisPoints:clampedOver,affectedBasisPoints:clampedAffected},
      score,status:'rankable',decision:'deferred_rank_cap',reason:null,rank:null,
    });
  }
  const rankable=items.filter(item=>item.status==='rankable').sort((left,right)=>compareRankedItems(left,right,table.impactPoints));
  if(blocked){
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
    raw:rawRef,
    releaseBlocked:blocked,
    ranking:{
      eligibleCount:rankable.length,
      admittedIds:blocked?[]:rankable.slice(0,table.rubric.ranking.admitCount).map(item=>item.id),
      deferredIds:blocked?[]:rankable.slice(table.rubric.ranking.admitCount).map(item=>item.id),
    },
    items:items.sort((left,right)=>left.id<right.id?-1:left.id>right.id?1:0),
  };
}
/* The out-of-band map digest protects the closed map; the map itself must never appear as a self-referential entry. */
async function run(){
  const context=cli(process.argv.slice(2)),root=normalizeSystemRootAlias(resolve(context['--artifact-root']));
  await assertTrustedDirectory(root,'artifact root alias');
  const total={n:0};
  const mapBytes=await readTrusted(root,context['--artifact-map'],context['--artifact-map-sha256'],MiB,total);
  const map=duplicateFreeJson(mapBytes,'artifact map');
  if(!canonicalBytes(map,{},{}).equals(mapBytes))fail('artifact map is not canonical');
  own(map,['schemaVersion','releaseId','candidate','configSha256','dataProfileSha256','frozenAsOf','pins','artifacts'],'artifact map');
  if(map.schemaVersion!=='performance-trusted-artifacts.v1'||map.frozenAsOf!==context['--frozen-as-of'])fail('artifact map');
  bind(map,context,'artifact map');
  own(map.pins,['rawSchema','scoredSchema','budget'],'map pins');
  if(!map.artifacts||typeof map.artifacts!=='object'||Array.isArray(map.artifacts))fail('map artifacts');
  const references=[...Object.values(map.pins),...Object.entries(map.artifacts).map(([path,sha256])=>({path,sha256}))];
  const paths=new Set();
  for(const reference of references){
    own(reference,['path','sha256'],'map reference');
    safePath(reference.path);
    if(!H.test(reference.sha256)||paths.has(reference.path))fail('invalid map entries');
    paths.add(reference.path);
  }
  if(paths.has(context['--artifact-map'])||map.artifacts[context['--output']])fail('invalid map entries');
  const bindArtifact=(reference,name)=>{
    own(reference,['path','sha256'],name);
    safePath(reference.path);
    if(map.artifacts[reference.path]!==reference.sha256)fail(`unbound ${name}`);
    return reference.path;
  };
  const get=async(path,limit)=>{
    const digest=map.artifacts[path];
    if(!digest)fail('missing map artifact');
    return readTrusted(root,path,digest,limit,total);
  };
  const rawSchemaBytes=await readTrusted(root,map.pins.rawSchema.path,map.pins.rawSchema.sha256,MiB,total);
  const scoredSchemaBytes=await readTrusted(root,map.pins.scoredSchema.path,map.pins.scoredSchema.sha256,MiB,total);
  const budgetBytes=await readTrusted(root,map.pins.budget.path,map.pins.budget.sha256,MiB,total);
  const rawSchema=duplicateFreeJson(rawSchemaBytes,'raw schema'),scoredSchema=duplicateFreeJson(scoredSchemaBytes,'scored schema'),budgetValue=duplicateFreeJson(budgetBytes,'budget');
  if(!canonicalBytes(rawSchema,{},{}).equals(rawSchemaBytes)||!canonicalBytes(scoredSchema,{},{}).equals(scoredSchemaBytes)||!canonicalBytes(budgetValue,{},{}).equals(budgetBytes))fail('noncanonical contract');
  for(const [pin,digest] of [[PINNED_RAW_SCHEMA_SHA256,map.pins.rawSchema.sha256],[PINNED_SCORED_SCHEMA_SHA256,map.pins.scoredSchema.sha256],[PINNED_BUDGET_SHA256,map.pins.budget.sha256]]){
    if(pin!==digest)fail('pinned contract digest');
  }
  const budget=budgets(budgetValue);
  const raw=parseArtifact(await get(context['--input'],8*MiB),rawSchema,rawSchema,'raw');
  const healthPath=bindArtifact(raw.healthReceipt,'health reference');
  const itemReferences=raw.items.map(item=>({
    id:item.id,
    measurementPath:bindArtifact(item.measurement,'measurement reference'),
    manifestPath:bindArtifact(item.manifest,'manifest reference'),
  }));
  const required=new Set([context['--input'],healthPath,...itemReferences.flatMap(item=>[item.measurementPath,item.manifestPath])]);
  if(required.size!==2+raw.items.length*2||Object.keys(map.artifacts).length!==required.size||[...required].some(path=>!map.artifacts[path]))fail('unexpected map entries');
  const health=parseArtifact(await get(healthPath,2*MiB),rawSchema.$defs.healthReceipt,rawSchema,'health');
  const receipts=new Map(),manifests=new Map();
  for(const item of itemReferences){
    receipts.set(item.id,parseArtifact(await get(item.measurementPath,8*MiB),rawSchema.$defs.measurementReceipt,rawSchema,'measurement'));
    manifests.set(item.id,parseArtifact(await get(item.manifestPath,2*MiB),rawSchema.$defs.manifest,rawSchema,'manifest'));
  }
  const output=resolve(root,context['--output']),outputParent=dirname(output),outputWithin=relative(root,output);
  if(outputWithin.startsWith('..')||isAbsolute(outputWithin))fail('invalid canonical output');
  await assertTrustedDirectory(outputParent,'invalid canonical output');
  try{
    await lstat(output);
    fail('output exists');
  }catch(error){
    if(error.message?.startsWith('performance backlog:')||error.code!=='ENOENT')throw error;
  }
  const result=derive(raw,{path:context['--input'],sha256:map.artifacts[context['--input']]},budget,receipts,manifests,health,context);
  validate(result,scoredSchema,scoredSchema,'scored');
  const body=canonicalBytes(result,scoredSchema,scoredSchema);
  if(body.length>16*MiB)fail('scored cap');
  const temporary=resolve(outputParent,`.${pathParse(output).base}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`);
  try{
    await writeFile(temporary,body,{flag:'wx',mode:0o600});
    await link(temporary,output);
  }finally{
    await unlink(temporary).catch(()=>{});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))run().catch(error=>{const message=error?.message?.startsWith('performance backlog:')?error.message:'performance backlog: internal failure';process.stderr.write(`${message}\n`);process.exitCode=1});
export { assertTrustedDirectory, canonicalBytes, duplicateFreeJson, derive, budgets, compareRankedItems, reserveAggregate, sameArtifactPath, sameWindowsArtifactPath, stripWindowsVerbatimPrefix };
