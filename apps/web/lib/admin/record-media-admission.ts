// server-only: an operator binds a tested Storage/catalog release to this exact endpoint.
import { createHash } from 'node:crypto';
import compatibility from './record-media-compatibility.json';
if (typeof window !== 'undefined') throw new Error('RECORD_ACTION_SERVER_ONLY');

const admitted = Symbol('record-media-admitted');
export type RecordMediaAdmission = { readonly [admitted]: true };
export const RECORD_MEDIA_REQUIRED_CASES = [
  'standard_upload_claim_delete_physical_absence',
  'upsert_before_claim_protects_replacement',
  'claimed_path_rejects_user_and_service_upsert',
  'copy_rejects_retired_destination_allows_fresh_path',
  'resumable_upload_started_before_claim_cannot_replace_after_claim',
  'confirmed_delete_prevents_recreation_of_retired_path',
  'forged_tus_probe_cannot_commit_or_add_live_reference',
  'partial_s3_delete_never_reports_physical_success',
] as const;
type CompatibilityEvidence = {
  schema: string;
  status: string;
  storageImage: string;
  recordSqlSha256: string;
  completeCaseSet?: boolean;
  tests: ReadonlyArray<{name: string; passed: boolean}>;
};
export function recordMediaEvidenceHash(evidence: CompatibilityEvidence): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

/** Pure policy factory permits isolated unit fixtures; production uses only the bundled evidence below. */
export function createRecordMediaCleanupAdmitter(evidence: CompatibilityEvidence) {
  // Snapshot the proof decision so callers cannot change evidence after validating its digest.
  const digest=recordMediaEvidenceHash(evidence), image=evidence.storageImage, sql=evidence.recordSqlSha256;
  const complete=evidence.schema==='record-media-storage-compatibility-v1' && evidence.status==='passed'
    && evidence.completeCaseSet===true && /^[a-f0-9]{64}$/.test(sql)
    && /^supabase\/storage-api@sha256:[a-f0-9]{64}$/.test(image)
    && evidence.tests.length===RECORD_MEDIA_REQUIRED_CASES.length
    && RECORD_MEDIA_REQUIRED_CASES.every(name=>evidence.tests.filter(test=>test.name===name && test.passed===true).length===1);
  return (env: NodeJS.ProcessEnv = process.env): RecordMediaAdmission | null => {
    let endpoint: URL;
    try { endpoint=new URL(env.NEXT_PUBLIC_SUPABASE_URL??''); } catch { return null; }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/'
        || !['http:','https:'].includes(endpoint.protocol)) return null;
    if (!complete
        || env.ADMIN_RECORD_MEDIA_COMPATIBILITY_SHA256!==digest
        || env.ADMIN_RECORD_MEDIA_STORAGE_IMAGE!==image
        || env.ADMIN_RECORD_MEDIA_SQL_SHA256!==sql
        || env.ADMIN_RECORD_MEDIA_VERIFIED_ENDPOINT!==endpoint.origin) return null;
    return { [admitted]: true };
  };
}
/** A local proof cannot attest the deployed Storage version, catalog, or endpoint. */
export const admitRecordMediaCleanup=createRecordMediaCleanupAdmitter(compatibility);
export function hasRecordMediaAdmission(value: RecordMediaAdmission | undefined): boolean {
  return value?.[admitted]===true;
}
