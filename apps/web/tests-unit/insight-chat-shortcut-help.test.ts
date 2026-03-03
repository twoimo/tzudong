import { describe, expect, test } from 'bun:test';

import { getInsightChatShortcutHelpItems } from '@/components/insight/InsightChatSection';

describe('insight chat shortcut help items', () => {
    test('returns core shortcut help entries for popular chat interactions', () => {
        const items = getInsightChatShortcutHelpItems();

        expect(items).toEqual([
            { keys: 'Ctrl/Cmd + K', description: '입력창 포커스' },
            { keys: 'Ctrl/Cmd + /', description: '단축키 도움말 열기/닫기' },
            { keys: 'Shift + ?', description: '단축키 도움말 열기/닫기' },
            { keys: 'ArrowUp', description: '입력창이 비어 있으면 마지막 사용자 메시지 수정' },
            { keys: 'Esc', description: '메시지 수정 취소 또는 도움말 닫기' },
            { keys: 'Enter', description: '메시지 전송' },
            { keys: 'Shift + Enter', description: '줄바꿈' },
        ]);
    });
});
