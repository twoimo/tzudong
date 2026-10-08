import { describe, expect, test } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { downloadReviewVerification } from '../lib/reviews/private-verification';
import { readPrivateVerificationImage, type VerificationImageDependencies } from '../lib/reviews/private-verification-handler';

const owner = '11111111-1111-4111-8111-111111111111';
const review = '22222222-2222-4222-8222-222222222222';
const key = `${owner}/reviews/${review}/verification/proof.webp`;
function fixture() {
    const counts = { read: 0, download: 0 };
    const deps: VerificationImageDependencies = {
        authorize: async () => ({ ok: true }),
        read: async () => { counts.read++; return { data: { user_id: owner, verification_photo: key }, error: null }; },
        download: async () => { counts.download++; return { data: new Blob(['fixture'], { type: 'image/webp' }), error: null }; },
    };
    return { counts, deps };
}
describe('private review verification image boundary', () => {
    test('authorization fails before database or Storage access', async () => {
        const { deps, counts } = fixture();
        deps.authorize = async () => ({ ok: false, response: Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) });
        const reply = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
        expect(reply.status).toBe(401); expect(reply.headers.get('cache-control')).toContain('no-store');
        expect(counts).toEqual({ read: 0, download: 0 });
    });
    test('invalid IDs and foreign owner, purpose, or arbitrary URL are rejected', async () => {
        const { deps, counts } = fixture();
        expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: '../other' }), deps)).status).toBe(400);
        expect(counts.read).toBe(0);
        for (const value of [key.replace(owner, review), key.replace('/verification/', '/food/'), 'https://untrusted.invalid/image.jpg']) {
            deps.read = async () => ({ data: { user_id: owner, verification_photo: value }, error: null });
            expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps)).status).toBe(404);
        }
        expect(counts.download).toBe(0);
    });
    test('authorized bounded image is delivered without caching or a signed URL', async () => {
        const { deps } = fixture();
        const response = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
        expect(response.status).toBe(200); expect(await response.text()).toBe('fixture');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('location')).toBeNull();
    });
    test('oversize, unsupported format and provider diagnostics stay bounded and fixed', async () => {
        for (const blob of [new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/webp' }), new Blob(['script'], { type: 'text/html' })]) {
            const { deps } = fixture(); deps.download = async () => ({ data: blob, error: null });
            expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps)).status).toBe(404);
        }
        const { deps } = fixture(); deps.read = async () => { throw new Error('private provider detail'); };
        const response = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
        expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: 'REVIEW_IMAGE_UNAVAILABLE' });
    });
    test('new canonical images never fall back to public Storage; legacy first tries private', async () => {
        const calls: string[] = [];
        const storage = { from: (bucket: string) => ({ download: async () => {
            calls.push(bucket); return { data: null, error: new Error('fixture') };
        } }) } as unknown as SupabaseClient<Database>['storage'];
        await downloadReviewVerification(storage, key);
        expect(calls).toEqual(['review-verifications']); calls.length = 0;
        await downloadReviewVerification(storage, `${owner}/1720000000000_verification_proof.jpg`);
        expect(calls).toEqual(['review-verifications', 'review-photos']);
    });
});
