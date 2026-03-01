import { describe, expect, test } from 'bun:test';

import {
    getChatBubbleActionState,
    getChatBubbleMoreMenuId,
} from '@/components/insight/InsightChatSection';

describe('insight chat bubble action helpers', () => {
    test('computes hidden and visible secondary actions correctly', () => {
        expect(
            getChatBubbleActionState({
                isUser: true,
                hasMessageMeta: false,
                canEdit: false,
                hasFeedbackHandler: false,
                hasFeedbackRating: false,
            }),
        ).toEqual({
            hasMetaAction: false,
            hasFeedbackButtons: false,
            hasFeedbackReasonInput: false,
            hasEditAction: false,
            hasMoreMenu: false,
        });

        expect(
            getChatBubbleActionState({
                isUser: true,
                hasMessageMeta: true,
                canEdit: true,
                hasFeedbackHandler: false,
                hasFeedbackRating: true,
            }),
        ).toEqual({
            hasMetaAction: true,
            hasFeedbackButtons: false,
            hasFeedbackReasonInput: false,
            hasEditAction: true,
            hasMoreMenu: true,
        });

        expect(
            getChatBubbleActionState({
                isUser: false,
                hasMessageMeta: false,
                canEdit: false,
                hasFeedbackHandler: true,
                hasFeedbackRating: false,
            }),
        ).toEqual({
            hasMetaAction: false,
            hasFeedbackButtons: true,
            hasFeedbackReasonInput: false,
            hasEditAction: false,
            hasMoreMenu: true,
        });
    });

    test('marks feedback reason control as a secondary action when rating exists', () => {
        expect(
            getChatBubbleActionState({
                isUser: false,
                hasMessageMeta: false,
                canEdit: false,
                hasFeedbackHandler: true,
                hasFeedbackRating: true,
            }),
        ).toMatchObject({
            hasFeedbackButtons: true,
            hasFeedbackReasonInput: true,
            hasMoreMenu: true,
        });
    });

    test('builds a stable and sanitized popover id', () => {
        expect(getChatBubbleMoreMenuId('msg:01/abc')).toBe('insight-chat-bubble-more-msg-01-abc');
        expect(getChatBubbleMoreMenuId('   ')).toBe('insight-chat-bubble-more-message');
        expect(getChatBubbleMoreMenuId('a-BC_12')).toBe('insight-chat-bubble-more-a-BC_12');
    });
});
