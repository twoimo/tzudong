import { getOwnedReviewPhotoObjectPath } from '@/lib/review-photo-url';

export interface VerificationImageDependencies {
    authorize(): Promise<{ ok: true } | { ok: false; response: Response }>;
    read(reviewId: string): Promise<{ data: { user_id: string; verification_photo: string } | null; error: unknown }>;
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const failure = (status: number) => Response.json({ code: 'REVIEW_IMAGE_UNAVAILABLE' }, { status, headers });

export async function readPrivateVerificationImage(
    params: Promise<{ reviewId: string }>, deps: VerificationImageDependencies,
) {
    try {
        const auth = await deps.authorize();
        if (!auth.ok) {
            auth.response.headers.set('Cache-Control', 'private, no-store');
            return auth.response;
        }
        const { reviewId } = await params;
        if (!uuid.test(reviewId)) return failure(400);
        const row = await deps.read(reviewId);
        if (row.error || !row.data) return failure(404);
        const ownership = { ownerId: row.data.user_id, reviewId, purpose: 'verification' as const };
        const path = getOwnedReviewPhotoObjectPath(row.data.verification_photo, ownership);
        if (!path) return failure(404);
        const image = await deps.download(path);
        if (image.error || !image.data || image.data.size > 5 * 1024 * 1024 || !allowedTypes.has(image.data.type)) return failure(404);
        return new Response(image.data, { headers: { ...headers, 'Content-Type': image.data.type } });
    } catch { return failure(503); }
}
