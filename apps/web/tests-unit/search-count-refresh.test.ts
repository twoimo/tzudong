import { expect, test } from 'bun:test';
import { incrementSearchCount, shouldRefreshPopularAfterSearch } from '../lib/search-count';

test('disabled search analytics does not trigger a redundant popularity read', async () => {
    expect(shouldRefreshPopularAfterSearch(await incrementSearchCount('11111111-1111-4111-8111-111111111111'))).toBe(false);
});
test('only an applied counter mutation refreshes popularity', () => {
    expect(shouldRefreshPopularAfterSearch({ success: true, reason: 'updated' })).toBe(true);
    expect(shouldRefreshPopularAfterSearch({ success: false, reason: 'failed' })).toBe(false);
});
