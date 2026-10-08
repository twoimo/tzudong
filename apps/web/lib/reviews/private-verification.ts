import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const REVIEW_VERIFICATION_BUCKET = 'review-verifications';

/** Server-side transition support for pre-migration verification keys. The
 * caller must authorize the review and validate its authoritative object key.
 * New verification uploads always target the private bucket. */
export async function downloadReviewVerification(storage: SupabaseClient<Database>['storage'], path: string) {
    if (typeof window !== 'undefined') throw new Error('REVIEW_VERIFICATION_SERVER_ONLY');
    const privateReply = await storage.from(REVIEW_VERIFICATION_BUCKET).download(path);
    if (!privateReply.error || path.split('/').length !== 2) return privateReply;
    return storage.from('review-photos').download(path);
}
