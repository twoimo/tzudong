import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseStorageServerClient } from '@/lib/supabase/storage-server';
import { downloadReviewVerification } from '@/lib/reviews/private-verification';
import { readPrivateVerificationImage } from '@/lib/reviews/private-verification-handler';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ reviewId: string }> };

export async function GET(_request: Request, context: RouteContext) {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) {
            auth.response.headers.set('Cache-Control', 'private, no-store');
            return auth.response;
        }
        return readPrivateVerificationImage(context.params, {
            authorize: async () => auth,
            read: async (reviewId) => createSupabaseServiceRoleClient().from('reviews')
                .select('user_id,verification_photo').eq('id', reviewId).maybeSingle(),
            download: (path) => downloadReviewVerification(createSupabaseStorageServerClient(), path),
        });
    } catch {
        return Response.json({ code: 'REVIEW_IMAGE_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
}
