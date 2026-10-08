import { describe, expect, test } from 'bun:test';
import { formatTzuyangReviewForDisplay } from '../lib/tzuyang-review-display';
import { collectTzuyangReviewEntries, collectRestaurantMergedMedia } from '../lib/restaurant-merged-media';
import type { Restaurant } from '../types/restaurant';

describe('public Tzuyang review display', () => {
    test('removes single and grouped source references without erasing sentences', () => {
        expect(formatTzuyangReviewForDisplay('맛을 설명합니다[ts:208, ts:315, ts:339, ts:353]. 다음 문장입니다[ts:534, ts:571, ts:679].'))
            .toBe('맛을 설명합니다. 다음 문장입니다.');
        expect(formatTzuyangReviewForDisplay('[ts:1]본문[ts:2][ts:3]')).toBe('본문');
    });
    test('handles case, whitespace, fractional seconds and compact lists', () => {
        expect(formatTzuyangReviewForDisplay('[ TS : 1.5, TS:2, 3 ]내용[ts:4,\n ts:5]')).toBe('내용');
    });
    test('preserves meaningful dates, times, brackets and paragraph structure', () => {
        const content = '2024.05.03 [추천 메뉴]\n\n영상 2:08에서 소개합니다. 가격 3,000원.';
        expect(formatTzuyangReviewForDisplay(content)).toBe(content);
        expect(formatTzuyangReviewForDisplay('첫 문장[ts:2].\n\n다음 문장[ts:3].')).toBe('첫 문장.\n\n다음 문장.');
        expect(formatTzuyangReviewForDisplay('[ts:알 수 없음] [기타:12]')).toBe('[ts:알 수 없음] [기타:12]');
    });
    test('leaves source review identity, visit count inputs and video metadata intact', () => {
        const source = { id:'fixture-restaurant', name:'검증 맛집', tzuyang_review:'본문[ts:1]',
            mergedTzuyangReviews:['본문[ts:1]', '본문[ts:2]'],
            youtube_meta:{title:'검증 영상',publishedAt:'2024-05-03'} } as Restaurant;
        const before = JSON.stringify(source);
        const entries = collectTzuyangReviewEntries(source);
        expect(entries.map(entry => formatTzuyangReviewForDisplay(entry.text))).toEqual(['본문','본문']);
        expect(collectRestaurantMergedMedia(source).tzuyangReviews).toEqual(['본문[ts:1]','본문[ts:2]']);
        expect(entries[0].title).toBe('검증 영상');
        expect(entries[0].publishedAt).toBe('2024-05-03');
        expect(JSON.stringify(source)).toBe(before);
    });
});
