import { requireAdmin } from '@/lib/auth/require-admin';
import { noStoreJson } from '@/lib/claim/http';
import { listAdminRestaurantClaims } from '@/lib/claim/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  return noStoreJson({ ok: true, claims: listAdminRestaurantClaims() });
}
