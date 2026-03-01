import { describe, expect, test } from 'bun:test';

import {
    getConversationDraftForConversation,
    getConversationDraftOnEditCancel,
    updateConversationDraftMap,
} from '@/components/insight/InsightChatSection';

describe('insight chat conversation draft helpers', () => {
    test('stores and restores drafts independently per conversation', () => {
        const map = {};
        const withConv1 = updateConversationDraftMap(map, 'conv-1', 'first draft');
        const withConv2 = updateConversationDraftMap(withConv1, 'conv-2', 'second draft');

        expect(withConv1['conv-1']).toBe('first draft');
        expect(withConv2['conv-1']).toBe('first draft');
        expect(withConv2['conv-2']).toBe('second draft');

        expect(getConversationDraftForConversation(withConv2, 'conv-1')).toBe('first draft');
        expect(getConversationDraftForConversation(withConv2, 'conv-2')).toBe('second draft');
        expect(getConversationDraftForConversation(withConv2, 'conv-3')).toBe('');
    });

    test('clears a draft when storing an empty value and preserves others', () => {
        const map = updateConversationDraftMap({}, 'conv-1', 'temp draft');
        const withConv2 = updateConversationDraftMap(map, 'conv-2', 'second');

        const cleared = updateConversationDraftMap(withConv2, 'conv-1', '');

        expect(cleared).toEqual({ 'conv-2': 'second' });
        expect(getConversationDraftForConversation(cleared, 'conv-1')).toBe('');
        expect(getConversationDraftForConversation(cleared, 'conv-2')).toBe('second');
    });

    test('ignores blank or whitespace conversation IDs as invalid keys', () => {
        const map = updateConversationDraftMap({ 'conv-1': 'keep me' }, '   ', 'ignored');
        const same = updateConversationDraftMap(map, '', 'ignored too');

        expect(same).toEqual(map);
        expect(getConversationDraftForConversation(map, '   ')).toBe('');
    });

    test('returns same map reference when draft value is unchanged', () => {
        const map = { 'conv-1': 'same draft' };
        const unchanged = updateConversationDraftMap(map, 'conv-1', 'same draft');
        expect(unchanged).toBe(map);
    });

    test('returns same map reference when clearing non-existent draft', () => {
        const map = { 'conv-1': 'keep me' };
        const unchanged = updateConversationDraftMap(map, 'conv-2', '');
        expect(unchanged).toBe(map);
    });

    test('normalizes conversation id lookup with surrounding whitespace', () => {
        const map = { 'conv-1': 'trimmed lookup draft' };
        expect(getConversationDraftForConversation(map, ' conv-1 ')).toBe('trimmed lookup draft');
    });

    test('restores last saved draft when edit is cancelled', () => {
        const map = updateConversationDraftMap({}, 'conv-1', 'typed before edit');
        const restored = getConversationDraftOnEditCancel({
            draftMap: map,
            conversationId: 'conv-1',
            fallbackDraft: '',
        });

        expect(restored).toBe('typed before edit');
    });
});
