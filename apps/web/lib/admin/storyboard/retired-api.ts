import { requireAdmin } from '@/lib/auth/require-admin';

/** Preserve admin authentication while disabling the previous LLM execution paths. */
export async function retiredStoryboardApi(_request?: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'private, no-store'); return auth.response; }
  return Response.json({ ok: false, error: 'STORYBOARD_WORKFLOW_RETIRED' }, {
    status: 410, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
