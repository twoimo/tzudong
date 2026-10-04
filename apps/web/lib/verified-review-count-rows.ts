import { fetchSupabaseRows, postgrestIn } from './supabase-rest-client';

type ReviewCountRow = { restaurant_id: string | null };
type ReviewPageQuery = Array<[string, string | number | boolean]>;
type FetchReviewPage = (query: ReviewPageQuery) => Promise<unknown>;

const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read one ID chunk completely, even when the server's row cap is below PAGE_SIZE. */
export async function fetchVerifiedReviewCountRows(
    restaurantIds: readonly string[],
    fetchPage: FetchReviewPage = (query) => fetchSupabaseRows('reviews', query),
): Promise<ReviewCountRow[]> {
    // Snapshot the filter before awaiting so every page belongs to the same ID set.
    const requestedIds = new Set(restaurantIds);
    if (requestedIds.size === 0) return [];
    const restaurantFilter = postgrestIn([...requestedIds]);
    const rows: ReviewCountRow[] = [];
    let cursor: string | null = null;

    for (;;) {
        const query: ReviewPageQuery = [
            ['select', 'id,restaurant_id'],
            ['restaurant_id', restaurantFilter],
            ['is_verified', 'eq.true'],
            ['order', 'id.asc'],
            ['limit', PAGE_SIZE],
        ];
        if (cursor !== null) query.push(['id', `gt.${cursor}`]);

        let page: unknown;
        try {
            page = await fetchPage(query);
        } catch {
            // The transport may include provider response text in its error.
            throw new Error('VERIFIED_REVIEW_COUNT_UNAVAILABLE');
        }
        if (!Array.isArray(page) || page.length > PAGE_SIZE) {
            throw new Error('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
        }
        if (page.length === 0) return rows;

        for (const row of page) {
            if (
                !row || typeof row !== 'object'
                || typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
                || typeof row.restaurant_id !== 'string' || !requestedIds.has(row.restaurant_id)
            ) {
                throw new Error('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
            }
            const id = row.id.toLowerCase();
            if (cursor !== null && id <= cursor) {
                throw new Error('VERIFIED_REVIEW_COUNT_INVALID_PAGE');
            }
            cursor = id;
            // Distinct reviews for the same restaurant must each contribute one count.
            rows.push({ restaurant_id: row.restaurant_id });
        }
        // A short page may reflect a smaller server cap; only an empty page proves EOF.
        // UUID ordering avoids offset shifts, but does not provide a cross-request DB snapshot.
    }
}
