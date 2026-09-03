import { adminJson, logAdminFixedError } from '@/lib/admin/admin-json';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { getAdminSystemStatus } = await import('@/lib/admin/system-status/status');
    const data = await getAdminSystemStatus();
    return adminJson(data);
  } catch {
    logAdminFixedError({
      menu: 'llm',
      action: 'system-status',
      code: 'ADMIN_SYSTEM_STATUS_UNAVAILABLE',
    });
    return adminJson({ error: 'ADMIN_SYSTEM_STATUS_UNAVAILABLE' }, 500);
  }
}
