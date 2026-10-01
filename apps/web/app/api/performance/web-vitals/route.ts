import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { parseFieldVitalSample } from '@/lib/performance/field-vitals';
import { admitFieldRequest } from '@/lib/performance/field-admission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FieldRpcClient = {
  rpc: (name: 'record_app_web_vitals_bounded', args: {
    p_release: string;
    p_device: string;
    p_metric: string;
    p_navigation: string;
    p_bucket: number;
  }) => { abortSignal: (signal: AbortSignal) => PromiseLike<{ error: unknown; data: boolean | null }> };
};

function fixedFailure(status: number, code: string) {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  // Do not accept the bearer-origin bypass used by authenticated application APIs.
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin
    || request.headers.get('sec-fetch-site') !== 'same-origin') {
    return fixedFailure(403, 'field_origin_rejected');
  }
  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (process.env.VERCEL_ENV !== 'production' || !/^[a-f0-9]{40}$/.test(release)) {
    return fixedFailure(503, 'field_collection_unavailable');
  }
  // Vercel overwrites X-Forwarded-For. Behind another proxy this is a proxy
  // source, not a visitor identity. Non-Vercel deployments share a safe bucket.
  const source = process.env.VERCEL === '1' ? request.headers.get('x-forwarded-for') : null;
  if (!admitFieldRequest(source)) return fixedFailure(429, 'field_rate_limited');
  const parsed = await readBoundedJsonRequest(request, 512);
  if (!parsed.ok) return fixedFailure(400, 'field_request_invalid');
  const sample = parseFieldVitalSample(parsed.value);
  if (!sample) return fixedFailure(400, 'field_sample_invalid');
  // An old document posting after a deployment must not enter the new cohort.
  if (sample.release !== release) return fixedFailure(409, 'field_release_stale');
  try {
    const client = createSupabaseServiceRoleClient() as unknown as FieldRpcClient;
    const result = await client.rpc('record_app_web_vitals_bounded', {
      p_release: release,
      p_device: sample.device,
      p_metric: sample.metric,
      p_navigation: sample.navigation,
      p_bucket: sample.bucket,
    }).abortSignal(AbortSignal.timeout(2_000));
    if (result.error) return fixedFailure(503, 'field_collection_unavailable');
    if (result.data !== true) return fixedFailure(429, 'field_rate_limited');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fixedFailure(503, 'field_collection_unavailable');
  }
}
