import 'server-only';

import {
  FEATURE_DATABASE_HELD,
  FEATURE_DATABASE_READY,
  type FeatureDatabaseReadiness,
} from '@/lib/runtime-feature-readiness-contract';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FeatureReadinessRpc = (
  name: 'get_feature_runtime_capability',
  args: { p_user_id: string },
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function readFeatureDatabaseReadiness({
  ownerId,
  rpc,
}: {
  ownerId: string;
  rpc?: FeatureReadinessRpc;
}): Promise<FeatureDatabaseReadiness> {
  if (!UUID.test(ownerId)) return FEATURE_DATABASE_HELD;
  try {
    const client = rpc ? null : createSupabaseServiceRoleClient();
    const invoke = rpc ?? (client!.rpc.bind(client) as unknown as FeatureReadinessRpc);
    const { data, error } = await invoke('get_feature_runtime_capability', { p_user_id: ownerId });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return FEATURE_DATABASE_HELD;
    const capability = data as Record<string, unknown>;
    return Object.keys(capability).length === 4
      && capability.schema_version === 1
      && capability.status === 'ready'
      && capability.code === 'FEATURE_DATABASE_READY'
      && capability.capability_version === 'review-media-feature-v1'
      ? FEATURE_DATABASE_READY
      : FEATURE_DATABASE_HELD;
  } catch {
    return FEATURE_DATABASE_HELD;
  }
}
