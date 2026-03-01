import { describe, expect, test } from 'bun:test';

import {
    resolveInsightChatShortcutAction,
    resolveInsightChatArrowUpAction,
} from '@/components/insight/InsightChatSection';

describe('insight chat shortcut resolver', () => {
    test('maps control/meta + k to focus composer shortcut', () => {
        expect(resolveInsightChatShortcutAction({ key: 'k', ctrlKey: true })).toBe('focusComposer');
        expect(resolveInsightChatShortcutAction({ key: 'K', metaKey: true })).toBe('focusComposer');
    });

    test('ignores shortcut while composing when composing a keystroke', () => {
        expect(resolveInsightChatShortcutAction({
            key: 'k',
            ctrlKey: true,
            isComposing: true,
        })).toBe('noop');
    });

    test('maps escape to cancel edit action', () => {
        expect(resolveInsightChatShortcutAction({ key: 'Escape' })).toBe('cancelEdit');
    });

    test('maps shift + ? to toggle shortcut help', () => {
        expect(resolveInsightChatShortcutAction({ key: '?', shiftKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps shift + / to toggle shortcut help for non-locale keyboards', () => {
        expect(resolveInsightChatShortcutAction({ key: '/', shiftKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps Shift+? shortcut via key code fallback', () => {
        expect(resolveInsightChatShortcutAction({ key: 'Slash', code: 'Slash', shiftKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps cmd + / to toggle shortcut help', () => {
        expect(resolveInsightChatShortcutAction({ key: '/', metaKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps ctrl + / to toggle shortcut help', () => {
        expect(resolveInsightChatShortcutAction({ key: '/', ctrlKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps cmd + Slash key code to toggle shortcut help', () => {
        expect(resolveInsightChatShortcutAction({ key: 'Slash', code: 'Slash', metaKey: true })).toBe('toggleShortcutHelp');
    });

    test('maps old Esc key value to cancel edit action', () => {
        expect(resolveInsightChatShortcutAction({ key: 'Esc' })).toBe('cancelEdit');
    });

    test('returns noop for unrelated keys', () => {
        expect(resolveInsightChatShortcutAction({ key: 'K' })).toBe('noop');
        expect(resolveInsightChatShortcutAction({ key: '/' })).toBe('noop');
    });

    test('routes ArrowUp to latest editable message edit when not in command mode and composer is empty', () => {
        expect(resolveInsightChatArrowUpAction({
            key: 'ArrowUp',
            isCommandMode: false,
            composerValue: '',
            hasPromptSuggestions: false,
            latestEditableUserMessageId: 'message-1',
        })).toBe('editLatestMessage');
    });

    test('keeps ArrowUp in command suggestion mode for navigation when suggestions are shown', () => {
        expect(resolveInsightChatArrowUpAction({
            key: 'ArrowUp',
            isCommandMode: true,
            composerValue: '',
            hasPromptSuggestions: true,
            latestEditableUserMessageId: 'message-1',
        })).toBe('navigateCommandSuggestion');
    });
});
