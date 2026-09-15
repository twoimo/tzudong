import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { executeLocalCatalogEdit } from '@/lib/admin/local-catalog-edit';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'no-store');
    return auth.response;
  }
  const { restaurantId } = await context.params;
  return executeLocalCatalogEdit(request, restaurantId, auth.userId, (name, args) =>
    createSupabaseServiceRoleClient().rpc(name as never, args as never));
}
