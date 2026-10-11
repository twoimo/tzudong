import { describe, expect, test } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageApiError } from '@supabase/supabase-js';
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
    test('canonical and legacy authoritative keys fall back to the pre-migration public bucket', async () => {
        const calls: string[] = [];
        const storage = { from: (bucket: string) => ({ download: async () => {
            calls.push(bucket); return { data: null, error: new StorageApiError('Object not found', 404, '404', 'storage', 'NoSuchKey') };
        } }) } as unknown as SupabaseClient<Database>['storage'];
        const canonical = await downloadReviewVerification(storage, key);
        expect(calls).toEqual(['review-verifications', 'review-photos']);
        expect(canonical.bucket).toBe('review-photos'); calls.length = 0;
        const legacy = await downloadReviewVerification(storage, `${owner}/1720000000000_verification_proof.jpg`);
        expect(calls).toEqual(['review-verifications', 'review-photos']);
        expect(legacy.bucket).toBe('review-photos');
    });
    test('private success keeps authoritative bytes; legacy missing-object errors alone permit fallback', async () => {
        const calls: string[] = [];
        const privateBytes = new Blob(['private-current'], { type: 'image/webp' });
        let privateError: StorageApiError | null = null;
        const storage = { from: (bucket: string) => ({ download: async () => {
            calls.push(bucket);
            return bucket === 'review-verifications'
                ? { data: privateError ? null : privateBytes, error: privateError }
                : { data: new Blob(['legacy']), error: null };
        } }) } as unknown as SupabaseClient<Database>['storage'];
        expect((await downloadReviewVerification(storage, key)).data).toBe(privateBytes);
        expect(calls).toEqual(['review-verifications']); calls.length = 0;
        privateError = new StorageApiError('Object not found', 400, '404');
        expect((await downloadReviewVerification(storage, key)).bucket).toBe('review-photos');
        expect(calls).toEqual(['review-verifications', 'review-photos']);
    });
    test('authorization, missing bucket, transient and unknown failures never read stale public bytes', async () => {
        for (const error of [
            new StorageApiError('fixture', 401, '401', 'storage', 'InvalidJWT'),
            new StorageApiError('fixture', 403, '403', 'storage', 'AccessDenied'),
            new StorageApiError('fixture', 404, '404', 'storage', 'NoSuchBucket'),
            new StorageApiError('fixture', 404, '404', 'storage', 'TenantNotFound'),
            new StorageApiError('fixture', 500, '500', 'storage', 'InternalError'),
            new StorageApiError('fixture', 503, '503', 'storage', 'NoSuchKey'),
            new StorageApiError('fixture', 504, '504', 'storage', 'DatabaseTimeout'),
            new Error('timeout fixture'),
        ]) {
            const calls: string[] = [];
            const storage = { from: (bucket: string) => ({ download: async () => {
                calls.push(bucket); return { data: null, error };
            } }) } as unknown as SupabaseClient<Database>['storage'];
            const reply = await downloadReviewVerification(storage, key);
            expect(reply.bucket).toBe('review-verifications'); expect(reply.error).toBe(error);
            expect(calls).toEqual(['review-verifications']);
        }
    });
    test('thrown private transport failure propagates without a public fallback', async () => {
        const calls: string[] = [];
        const storage = { from: (bucket: string) => ({ download: async () => {
            calls.push(bucket); throw new Error('transport fixture');
        } }) } as unknown as SupabaseClient<Database>['storage'];
        await expect(downloadReviewVerification(storage, key)).rejects.toThrow('transport fixture');
        expect(calls).toEqual(['review-verifications']);
    });
    test('normalizes the authoritative same-origin historical URL before download', async () => {
        const prior = process.env.NEXT_PUBLIC_SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
        try {
            const { deps } = fixture();
            const historicalUrl = `https://project-ref.supabase.co/storage/v1/object/public/review-photos/${key}`;
            let downloadedPath = '';
            deps.read = async () => ({ data: { user_id: owner, verification_photo: historicalUrl }, error: null });
            deps.download = async path => {
                downloadedPath = path;
                return { data: new Blob(['fixture'], { type: 'image/webp' }), error: null };
            };
            expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps)).status).toBe(200);
            expect(downloadedPath).toBe(key);
        } finally {
            if (prior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
            else process.env.NEXT_PUBLIC_SUPABASE_URL = prior;
        }
    });
    test('resolved database failures are unavailable rather than authoritative absence', async () => {
        const { deps, counts } = fixture();
        deps.read = async () => ({ data: null, error: { code: 'fixture-timeout' } });
        const response = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
        expect(response.status).toBe(503); expect(counts.download).toBe(0);
        expect(await response.json()).toEqual({ code: 'REVIEW_IMAGE_UNAVAILABLE' });
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
    test('only definitive object absence is 404; provider and credential failures are 503', async () => {
        for (const error of [
            new StorageApiError('fixture', 401, '401', 'storage', 'InvalidJWT'),
            new StorageApiError('fixture', 403, '403', 'storage', 'AccessDenied'),
            new StorageApiError('fixture', 404, '404', 'storage', 'NoSuchBucket'),
            new StorageApiError('fixture', 503, '503', 'storage', 'NoSuchKey'),
            new StorageApiError('fixture', 504, '504', 'storage', 'DatabaseTimeout'),
            new Error('fixture-timeout'),
        ]) {
            const { deps } = fixture(); deps.download = async () => ({ data: null, error });
            const response = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({ code: 'REVIEW_IMAGE_UNAVAILABLE' });
        }
        for (const error of [new StorageApiError('Object not found', 404, '404', 'storage', 'NoSuchKey'),
            new StorageApiError('Object not found', 400, '404')]) {
            const { deps } = fixture(); deps.download = async () => ({ data: null, error });
            expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps)).status).toBe(404);
        }
    });
    test('authoritative row absence stays 404 while an empty successful transport stays 503', async () => {
        const { deps } = fixture(); deps.read = async () => ({ data: null, error: null });
        expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps)).status).toBe(404);
        const other = fixture(); other.deps.download = async () => ({ data: null, error: null });
        expect((await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), other.deps)).status).toBe(503);
    });
});
