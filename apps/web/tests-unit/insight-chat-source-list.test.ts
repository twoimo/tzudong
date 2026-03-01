import { describe, expect, test } from 'bun:test';

import { getSourceListVisibility, SOURCE_LIST_COLLAPSE_LIMIT } from '@/components/insight/InsightChatSection';
import type { InsightChatSource } from '@/types/insight';

describe('SourceList visibility helpers', () => {
    const makeSource = (idx: number): InsightChatSource => ({
        videoTitle: `source-${idx}`,
        youtubeLink: `https://example.com/${idx}`,
        timestamp: '00:00',
        text: `text-${idx}`,
    });

    test('returns all sources when list is within collapse limit', () => {
        const sources = [makeSource(1), makeSource(2)];

        const result = getSourceListVisibility({
            sources,
            isExpanded: false,
        });

        expect(result.visibleSources).toHaveLength(2);
        expect(result.visibleSources.map((source) => source.videoTitle)).toEqual(['source-1', 'source-2']);
        expect(result.collapsedCount).toBe(0);
        expect(result.hasMoreSources).toBeFalse();
    });

    test('returns first two sources and collapsed count when collapsed', () => {
        const sources = [makeSource(1), makeSource(2), makeSource(3), makeSource(4)];

        const result = getSourceListVisibility({
            sources,
            isExpanded: false,
        });

        expect(result.visibleSources.map((source) => source.videoTitle)).toEqual(['source-1', 'source-2']);
        expect(result.collapsedCount).toBe(2);
        expect(result.hasMoreSources).toBeTrue();
    });

    test('returns all sources when expanded', () => {
        const sources = [makeSource(1), makeSource(2), makeSource(3)];

        const result = getSourceListVisibility({
            sources,
            isExpanded: true,
        });

        expect(result.visibleSources.map((source) => source.videoTitle)).toEqual(['source-1', 'source-2', 'source-3']);
        expect(result.collapsedCount).toBe(0);
        expect(result.hasMoreSources).toBeTrue();
    });

    test('supports custom collapse limits', () => {
        const sources = [makeSource(1), makeSource(2), makeSource(3)];

        const result = getSourceListVisibility({
            sources,
            isExpanded: false,
            collapseLimit: 1,
        });

        expect(result.visibleSources.map((source) => source.videoTitle)).toEqual(['source-1']);
        expect(result.collapsedCount).toBe(2);
        expect(result.hasMoreSources).toBeTrue();
    });

    test('uses default collapse limit constant for empty lists', () => {
        const result = getSourceListVisibility({
            sources: [],
            isExpanded: false,
        });

        expect(result.visibleSources).toHaveLength(0);
        expect(result.collapsedCount).toBe(0);
        expect(result.hasMoreSources).toBeFalse();
        expect(SOURCE_LIST_COLLAPSE_LIMIT).toBe(2);
    });
});
