// server-only: privileged database/storage transport is supplied only by guarded route handlers.
import { z } from 'zod';
import {hasRecordMediaAdmission,type RecordMediaAdmission} from './record-media-admission';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { isRecordActionReceipt, type RecordActionRequest, type RecordActionReceipt } from './record-action-contract';
if (typeof window !== 'undefined') throw new Error('RECORD_ACTION_SERVER_ONLY');

export type RecordActionRpc = (args: Record<string, unknown>) => PromiseLike<{data: unknown; error: {message?: string} | null}>;
export class RecordActionError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
const fixedCodes = new Set(['RECORD_ACTION_FORBIDDEN','RECORD_ACTION_NOT_FOUND','RECORD_ACTION_LIMIT','RECORD_ACTION_INVALID_RESTAURANT',
  'RECORD_ACTION_DUPLICATE','RECORD_ACTION_DUPLICATE_REVIEW','RECORD_ACTION_MEDIA_RETIRED','RECORD_ACTION_INVALID_PAYLOAD','RECORD_ACTION_STATE_CONFLICT','RECORD_ACTION_IDEMPOTENCY_CONFLICT',
  'RECORD_ACTION_PREVIEW_MISMATCH','RECORD_ACTION_PREVIEW_EXPIRED','RECORD_ACTION_PREVIEW_REQUIRED','RECORD_ACTION_STALE',
  'RECORD_ACTION_EVIDENCE_REQUIRED','RECORD_ACTION_DISTINCT_VIDEO','RECORD_ACTION_SUBMISSION_CONFLICT','RECORD_ACTION_MEDIA_PATH_INVALID']);
function actorId(actor: string) {
  if (!z.uuid().safeParse(actor).success) throw new RecordActionError('RECORD_ACTION_FORBIDDEN',403);
}
async function rpc(runner: RecordActionRpc, args: Record<string, unknown>): Promise<unknown> {
  let result;
  try { result = await runner(args); } catch { throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503); }
  if (result.error) {
    const code = result.error.message === 'REVIEW_AUTOMATION_OPERATOR_INVALID' ? 'RECORD_ACTION_FORBIDDEN' : result.error.message;
    if (typeof code === 'string' && fixedCodes.has(code)) throw new RecordActionError(code,code==='RECORD_ACTION_FORBIDDEN'?403:code==='RECORD_ACTION_NOT_FOUND'?404:409);
    // A provider/transport diagnostic is never returned or retried.
    throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503);
  }
  return result.data;
}
function checkPayloadPrivacy(value: unknown): void {
  // These exact schema fields are public business telephone data, not personal contact fields.
  // Only a bounded telephone spelling is exempted; every other value uses the central sanitizer.
  const stripBusinessPhone = (entry: unknown, path = ''): unknown => {
    if (Array.isArray(entry)) return entry.map((item,index)=>stripBusinessPhone(item,`${path}.${index}`));
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).map(([key, item]) => {
      if (((path === '.changes' || path === '.incomingChanges') && (key === 'phone' || key === 'restaurant_phone')) || (/^\.(items|perTargetChanges)\.\d+\.changes$/.test(path) && key === 'phone') || (/^\.additions\.\d+$/.test(path) && key === 'phone')) {
        if (item !== null && item !== '' && (typeof item !== 'string' || !/^[+0-9() .-]{3,40}$/.test(item))) throw new RecordActionError('RECORD_ACTION_INVALID_PAYLOAD',400);
        return ['businessTelephoneValidated',true];
      }
      return [key,stripBusinessPhone(item,`${path}.${key}`)];
    }));
  };
  try { assertPrivacySafe(stripBusinessPhone(value),{locationClass:'business',maxEntries:1000}); }
  catch (error) { if (error instanceof RecordActionError) throw error; throw new RecordActionError('RECORD_ACTION_PRIVACY_UNSAFE',400); }
}
export async function runRecordAction(runner: RecordActionRpc, actor: string, request: RecordActionRequest): Promise<RecordActionReceipt> {
  actorId(actor); checkPayloadPrivacy(request.payload);
  const data = await rpc(runner,{p_actor:actor,p_phase:request.phase,p_operation_id:request.operationId,p_action:request.action,
    p_target_ids:request.targetIds,p_payload:request.payload,p_preview_hash:request.previewHash??null});
  if (!isRecordActionReceipt(data) || data.operationId!==request.operationId || data.action!==request.action
    || (request.phase==='apply' && data.state!=='applied') || (request.previewHash && data.previewHash!==request.previewHash)) throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503);
  return data;
}
export async function readRecordAction(runner: RecordActionRpc, actor: string, operationId: string): Promise<RecordActionReceipt> {
  actorId(actor);
  if (!z.uuid().safeParse(operationId).success) throw new RecordActionError('RECORD_ACTION_INVALID_PAYLOAD',400);
  const data=await rpc(runner,{p_actor:actor,p_phase:'readback',p_operation_id:operationId});
  if (!isRecordActionReceipt(data) || data.operationId!==operationId) throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503);
  return data;
}
export type MediaCleanupTransport = {
  exists: (bucket: string, objectName: string) => Promise<boolean>;
  remove: (bucket: string, objectName: string) => Promise<void>;
};
type RecordStorageClient = {storage: {from: (bucket: string) => {
  list: (path: string, options: {search: string; limit: number}) => PromiseLike<{data: Array<{name: string}> | null; error: unknown}>;
  remove: (paths: string[]) => PromiseLike<{error: unknown}>;
}}};
/** Storage metadata readback is separate from the physical S3 compatibility evidence. */
export function createRecordMediaTransport(client: RecordStorageClient): MediaCleanupTransport {
  return {
    exists: async (bucket,path) => {
      const slash=path.lastIndexOf('/'),name=path.slice(slash+1);
      const {data,error}=await client.storage.from(bucket).list(path.slice(0,slash),{search:name,limit:100});
      if(error || !data || data.length>=100) throw new Error('MEDIA_READBACK_UNCERTAIN');
      return data.some(entry=>entry.name===name);
    },
    remove: async (bucket,path) => {
      const {error}=await client.storage.from(bucket).remove([path]);
      if(error) throw new Error('MEDIA_WRITE_UNCERTAIN');
    },
  };
}
export async function resumeRecordMediaCleanup(runner: RecordActionRpc, storage: MediaCleanupTransport, actor: string, operationId: string, admission?: RecordMediaAdmission) {
  if (!hasRecordMediaAdmission(admission)) throw new RecordActionError('RECORD_ACTION_MEDIA_NOT_ADMITTED',503);
  const receipt=await readRecordAction(runner,actor,operationId);
  if (receipt.state!=='applied' || receipt.action!=='review.delete') throw new RecordActionError('RECORD_ACTION_STATE_CONFLICT');
  const base={p_actor:actor,p_operation_id:operationId};
  const jobs=z.strictObject({jobs:z.array(z.strictObject({id:z.uuid(),bucket:z.literal('review-photos'),objectName:z.string().max(1024).regex(/^[0-9a-f-]{36}\/reviews\/[0-9a-f-]{36}\/(?:food|verification)\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.(?:avif|jpe?g|png|webp)$/),state:z.enum(['pending','inflight','uncertain'])})).max(25)}).safeParse(await rpc(runner,{...base,p_phase:'cleanup_read'}));
  if (!jobs.success) throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503);
  for (const job of jobs.data.jobs) {
    const payload={p_payload:{jobId:job.id}};
    // Read before every attempt. An inflight/uncertain attempt is NEVER automatically resent.
    let exists;
    try { exists=await storage.exists(job.bucket,job.objectName); } catch { throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503); }
    if (!exists) { await rpc(runner,{...base,...payload,p_phase:'cleanup_absent'}); continue; }
    if (job.state!=='pending') continue;
    const claim=await rpc(runner,{...base,...payload,p_phase:'cleanup_claim'});
    if (!claim || typeof claim!=='object' || !('claimed' in claim) || typeof claim.claimed!=='boolean') throw new RecordActionError('RECORD_ACTION_UNCERTAIN',503);
    if (!claim.claimed) continue;
    try { await storage.remove(job.bucket,job.objectName); } catch { /* Read back the uncertain effect below. */ }
    let absent=false;
    try { absent=!(await storage.exists(job.bucket,job.objectName)); } catch { /* Preserve uncertainty. */ }
    await rpc(runner,{...base,...payload,p_phase:absent?'cleanup_absent':'cleanup_uncertain'});
  }
  return readRecordAction(runner,actor,operationId);
}
