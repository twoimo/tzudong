import 'server-only';
import { EvaluationCatalogCache } from './evaluation-catalog';
import type { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const caches = new WeakMap<Client, EvaluationCatalogCache>();
type Client = ReturnType<typeof createSupabaseServiceRoleClient>;
type ReadRpc = (name: 'admin_evaluation_revision' | 'admin_evaluation_catalog_snapshot') => PromiseLike<{ data: unknown; error: unknown }>;

export async function getEvaluationCatalog(supabase: Client) {
  // Source migration is deliberately pending; this narrow interface is removed
  // when generated database types include the two service-only read RPCs.
  let cache = caches.get(supabase);
  if (!cache) { cache = new EvaluationCatalogCache(); caches.set(supabase, cache); }
  const rpc = supabase.rpc.bind(supabase) as unknown as ReadRpc;
  const revision = await rpc('admin_evaluation_revision');
  if (revision.error || typeof revision.data !== 'string') throw new Error('EVALUATION_CATALOG_UNAVAILABLE');
  return cache.get(revision.data, async () => {
    const snapshot = await rpc('admin_evaluation_catalog_snapshot');
    if (snapshot.error) throw new Error('EVALUATION_CATALOG_UNAVAILABLE');
    return snapshot.data;
  });
}
