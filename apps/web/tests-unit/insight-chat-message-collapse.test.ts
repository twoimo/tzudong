import { describe, expect, test } from 'bun:test';

import {
    CHAT_BUBBLE_COLLAPSE_THRESHOLD,
    getChatBubbleContentCollapseState,
} from '@/components/insight/InsightChatSection';

describe('insight chat message collapse helpers', () => {
    test('collapses long assistant text replies by default', () => {
        const message = {
            role: 'assistant',
            content: 'a'.repeat(CHAT_BUBBLE_COLLAPSE_THRESHOLD + 1),
            visualComponent: undefined,
        } as const;

        expect(getChatBubbleContentCollapseState({
            message,
            isExpanded: false,
        })).toMatchObject({
            isCollapsible: true,
            isCollapsed: true,
            shouldRenderToggle: true,
            isExpanded: false,
            toggleLabel: '더 보기',
            collapsedPreviewClassName: 'max-h-52',
        });
    });

    test('keeps long assistant content expanded when requested', () => {
        const message = {
            role: 'assistant',
            content: 'b'.repeat(CHAT_BUBBLE_COLLAPSE_THRESHOLD + 1),
            visualComponent: undefined,
        } as const;

        expect(getChatBubbleContentCollapseState({
            message,
            isExpanded: true,
        })).toMatchObject({
            isCollapsible: true,
            isCollapsed: false,
            isExpanded: true,
            shouldRenderToggle: true,
            toggleLabel: '접기',
            collapsedPreviewClassName: 'max-h-none',
        });
    });

    test('does not collapse short assistant replies', () => {
        const message = {
            role: 'assistant',
            content: '짧은 답변',
            visualComponent: undefined,
        } as const;

        expect(getChatBubbleContentCollapseState({
            message,
            isExpanded: false,
        })).toMatchObject({
            isCollapsible: false,
            isCollapsed: false,
            shouldRenderToggle: false,
            isExpanded: true,
            toggleLabel: '접기',
        });
    });

    test('does not collapse user messages regardless of length', () => {
        const message = {
            role: 'user',
            content: 'a'.repeat(CHAT_BUBBLE_COLLAPSE_THRESHOLD + 1),
            visualComponent: undefined,
        } as const;

        expect(getChatBubbleContentCollapseState({
            message,
            isExpanded: false,
        })).toMatchObject({
            isCollapsible: false,
            isCollapsed: false,
            shouldRenderToggle: false,
            isExpanded: true,
            toggleLabel: '접기',
        });
    });

    test('does not collapse treemap assistant messages', () => {
        const message = {
            role: 'assistant',
            content: 'a'.repeat(CHAT_BUBBLE_COLLAPSE_THRESHOLD + 1),
            visualComponent: 'treemap',
        } as const;

        expect(getChatBubbleContentCollapseState({
            message,
            isExpanded: false,
        })).toMatchObject({
            isCollapsible: false,
            isCollapsed: false,
            shouldRenderToggle: false,
            isExpanded: true,
            toggleLabel: '접기',
        });
    });
});
