import { describe, expect, test } from 'bun:test';

import {
    deleteConversationFromList,
    normalizeActiveConversationId,
    restoreConversationFromList,
} from '@/components/insight/InsightChatSection';

const buildMessage = (content: string) => ({
    id: `msg-${content}`,
    role: 'user' as const,
    content,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const buildConversation = (id: string, title: string) => ({
    id,
    title,
    messages: [buildMessage(`${title}-message`)],
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    isBooting: false,
    bootstrapFailed: false,
    contextWindowSize: 80,
    responseMode: 'fast',
    memoryMode: 'off',
});

describe('insight chat delete/undo pure helpers', () => {
    test('deleteConversationFromList removes target and moves active safely', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
            buildConversation('conv-3', '대화 3'),
        ];

        const result = deleteConversationFromList(conversations, 'conv-2', 'conv-2');
        expect(result.deleted).toMatchObject({
            conversation: { id: 'conv-2' },
            removedAtIndex: 1,
            wasActive: true,
        });
        expect(result.conversations.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-3']);
        expect(result.activeConversationId).toBe('conv-3');

        const fallback = deleteConversationFromList(conversations, 'missing', 'conv-2');
        expect(fallback.activeConversationId).toBe('conv-1');
    });

    test('deleteConversationFromList preserves active conversation when deleting another conversation', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
            buildConversation('conv-3', '대화 3'),
        ];

        const result = deleteConversationFromList(conversations, 'conv-2', 'conv-1');
        expect(result.deleted).toMatchObject({
            conversation: { id: 'conv-1' },
            removedAtIndex: 0,
            wasActive: false,
        });
        expect(result.activeConversationId).toBe('conv-2');
        expect(result.conversations.map((conversation) => conversation.id)).toEqual(['conv-2', 'conv-3']);
    });

    test('restoreConversationFromList reinserts snapshot and respects active target', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
            buildConversation('conv-3', '대화 3'),
        ];
        const deletion = deleteConversationFromList(conversations, 'conv-2', 'conv-2');
        if (!deletion.deleted) {
            throw new Error('deletion snapshot should exist');
        }

        const afterRestore = restoreConversationFromList([], deletion.activeConversationId, deletion.deleted);
        expect(afterRestore.conversations.map((conversation) => conversation.id)).toEqual(['conv-2']);
        expect(afterRestore.activeConversationId).toBe('conv-2');

        const preservingCurrentActive = deleteConversationFromList(conversations, 'conv-1', 'conv-2');
        if (!preservingCurrentActive.deleted) {
            throw new Error('deletion snapshot should exist');
        }

        const withOtherActive = restoreConversationFromList(
            preservingCurrentActive.conversations,
            'conv-3',
            preservingCurrentActive.deleted,
        );
        expect(withOtherActive.conversations.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2', 'conv-3']);
        expect(withOtherActive.activeConversationId).toBe('conv-3');
    });

    test('deleteConversationFromList keeps data unchanged when id does not exist', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
        ];

        const result = deleteConversationFromList(conversations, 'conv-1', 'missing');

        expect(result.deleted).toBeNull();
        expect(result.conversations).toHaveLength(2);
        expect(result.conversations).toEqual(conversations);
        expect(result.activeConversationId).toBe('conv-1');
    });

    test('restoreConversationFromList ignores restore when snapshot conversation already exists', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
        ];
        const deletedConversation = {
            conversation: buildConversation('conv-1', '대화 1'),
            removedAtIndex: 1,
            wasActive: true,
        };

        const restored = restoreConversationFromList(conversations, 'conv-2', deletedConversation);

        expect(restored.conversations.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2']);
        expect(restored.activeConversationId).toBe('conv-2');
    });

    test('restoreConversationFromList preserves max conversation count when insert would exceed limit', () => {
        const conversations = Array.from({ length: 30 }, (_, index) =>
            buildConversation(`conv-${String(index + 1)}`, `대화 ${index + 1}`),
        );
        const deletedConversation = {
            conversation: buildConversation('conv-archived', '보관 대화'),
            removedAtIndex: 1,
            wasActive: false,
        };

        const restored = restoreConversationFromList(conversations, 'conv-1', deletedConversation);

        expect(restored.conversations).toHaveLength(30);
        expect(restored.conversations[1]?.id).toBe('conv-archived');
        expect(restored.conversations.map((conversation) => conversation.id)).not.toContain('conv-30');
    });

    test('normalizeActiveConversationId falls back to first when id not found', () => {
        const conversations = [
            buildConversation('conv-1', '대화 1'),
            buildConversation('conv-2', '대화 2'),
        ];
        const fallback = normalizeActiveConversationId(conversations, 'missing');
        expect(fallback).toBe('conv-1');
    });
});
