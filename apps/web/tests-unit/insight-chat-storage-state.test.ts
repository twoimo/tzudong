import { describe, expect, test } from 'bun:test';

import {
    duplicateConversationForSidebar,
    deserializeConversationList,
    buildConversationBackupExportPayload,
    mergeImportedConversations,
    buildLlmKeysExportPayload,
    parseConversationImportPayload,
    parseLlmKeysImportPayload,
    parseLlmKeyPayload,
    serializeConversationList,
    serializeLlmKeyPayload,
    sanitizeMemoryProfileNote,
    sanitizeStoredLlmKeys,
    sanitizeLlmKeyValue,
} from '@/components/insight/InsightChatSection';

const createDateString = (iso: string) => iso;

describe('insight chat conversation storage helpers', () => {
    describe('LLM key import/export helpers', () => {
        test('sanitizes raw key value by trimming control chars and whitespace', () => {
            expect(sanitizeLlmKeyValue('  ab cd\n123\t ')).toBe('abcd123');
            expect(sanitizeLlmKeyValue('\u0007abc')).toBe('abc');
            expect(sanitizeLlmKeyValue(123 as unknown)).toBe('');
        });

        test('serializes a sanitized export payload with configured timestamp', () => {
            const payload = serializeLlmKeyPayload(
                {
                    gemini: '  gem ',
                    openai: '\nopenai-key ',
                    anthropic: '',
                },
                { exportedAt: '2026-03-01T00:00:00.000Z' },
            );

            expect(payload.schemaVersion).toBe(1);
            expect(payload.exportedAt).toBe('2026-03-01T00:00:00.000Z');
            expect(payload.keys).toEqual({
                gemini: 'gem',
                openai: 'openai-key',
            });
        });

        test('parses envelope payload into sanitized key map', () => {
            const payload = parseLlmKeyPayload({
                schemaVersion: 1,
                keys: {
                    gemini: ' g1 ',
                    openai: 123,
                    nanobanana2: ' nano ',
                },
            });

            expect(payload).not.toBeNull();
            expect(payload?.keys).toEqual({
                gemini: 'g1',
                nanobanana2: 'nano',
            });
        });

        test('parses legacy payload shape with direct provider keys', () => {
            const payload = parseLlmKeyPayload({ gemini: ' abc ', openai: 'xyz' });
            expect(payload).not.toBeNull();
            expect(payload?.keys).toEqual({
                gemini: 'abc',
                openai: 'xyz',
            });
        });

        test('rejects unrelated payload without provider keys', () => {
            expect(parseLlmKeyPayload({ conversationId: 'conv-1', messages: [] })).toBeNull();
        });

        test('keeps legacy plain object parsing stable', () => {
            expect(parseLlmKeysImportPayload({})).toEqual({});
            expect(sanitizeStoredLlmKeys({})).toEqual({});
        });
    });

    test('sanitizes memory profile note', () => {
        expect(sanitizeMemoryProfileNote('  프로젝트\n핵심\t요약  ')).toBe('프로젝트 핵심 요약');
        expect(sanitizeMemoryProfileNote(undefined)).toBe('');
        expect(sanitizeMemoryProfileNote('x'.repeat(200))).toHaveLength(120);
    });

    test('serialize/deserialize roundtrip preserves memoryProfileNote with schema v6', () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const conversations = [
            {
                id: 'conv-1',
                title: '테스트 대화',
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user' as const,
                        content: '안녕',
                        createdAt: now,
                    },
                ],
                tags: ['tag'],
                createdAt: now.getTime(),
                updatedAt: now.getTime() + 1_000,
                isBooting: false,
                bootstrapFailed: false,
                contextWindowSize: 40,
                responseMode: 'fast',
                memoryMode: 'session',
                memoryProfileNote: '  프로젝트\n요약  ',
            },
        ];

        const payload = serializeConversationList(conversations, 'conv-1');
        const restored = deserializeConversationList(payload);

        expect(payload.version).toBe(6);
        expect(restored?.conversations[0]?.memoryProfileNote).toBe('프로젝트 요약');
        expect(restored?.activeConversationId).toBe('conv-1');
        expect(restored?.conversations[0]?.messages[0]?.createdAt).toBeInstanceOf(Date);
    });

    test('backward-compatible with schema v5 without memoryProfileNote', () => {
        const persisted = {
            version: 5,
            activeConversationId: 'conv-1',
            conversations: [
                {
                    id: 'conv-1',
                    title: '레거시 대화',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            content: '안녕',
                            createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                        },
                    ],
                    createdAt: 1,
                    updatedAt: 2,
                    memoryMode: 'pinned',
                    isBooting: true,
                    bootstrapFailed: false,
                    responseMode: 'deep',
                },
            ],
        } as const;

        const restored = deserializeConversationList(persisted);
        expect(restored?.conversations[0]?.memoryProfileNote).toBeUndefined();
        expect(restored?.conversations[0]?.memoryMode).toBe('pinned');
    });

    test('parses single conversation export payload for import', () => {
        const parsed = parseConversationImportPayload({
            schemaVersion: 6,
            exportedAt: '2026-02-28T00:00:00.000Z',
            conversation: {
                id: 'conv-import-1',
                title: ' 가져오기 테스트 ',
                createdAt: 10,
                updatedAt: 20,
                messages: [
                    {
                        id: 'msg-import-1',
                        role: 'user',
                        content: '안녕하세요',
                        createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                    },
                ],
                tags: [' A ', 'a', 'b'],
                memoryMode: 'session',
                memoryProfileNote: '  핵심 메모  ',
            },
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.conversations).toHaveLength(1);
        expect(parsed?.activeConversationId).toBe('conv-import-1');
        expect(parsed?.conversations[0]?.title).toBe('가져오기 테스트');
        expect(parsed?.conversations[0]?.tags).toEqual(['a', 'b']);
        expect(parsed?.conversations[0]?.memoryProfileNote).toBe('핵심 메모');
    });

    test('dedupes and sanitizes source asset/frame links while importing conversation payload', () => {
        const parsed = parseConversationImportPayload({
            schemaVersion: 6,
            exportedAt: '2026-02-28T00:00:00.000Z',
            conversation: {
                id: 'conv-import-with-links',
                title: '링크 테스트',
                createdAt: 10,
                updatedAt: 20,
                messages: [
                    {
                        id: 'msg-import-1',
                        role: 'assistant',
                        content: '피크 프레임 근거 테스트',
                        createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                        sources: [
                            {
                                videoTitle: '피크 구간',
                                youtubeLink: 'https://youtu.be/abc',
                                timestamp: '00:10',
                                text: '근거',
                                assetLink: ' https://drive.google.com/file/d/asset1 ',
                                frameLink: ' https://drive.google.com/file/d/frame1 ',
                            },
                            {
                                videoTitle: '피크 구간',
                                youtubeLink: 'https://youtu.be/abc',
                                timestamp: '00:10',
                                text: '근거',
                                assetLink: 'https://drive.google.com/file/d/asset1',
                                frameLink: 'https://drive.google.com/file/d/frame1',
                            },
                            {
                                videoTitle: '피크 구간',
                                youtubeLink: 'javascript:alert(1)',
                                timestamp: '00:20',
                                text: '근거2',
                                assetLink: ' https://drive.google.com/file/d/asset2 ',
                                frameLink: 'not-a-url',
                            },
                        ],
                    },
                ],
            },
        });

        expect(parsed).not.toBeNull();
        const sources = parsed?.conversations[0]?.messages[0]?.sources;

        expect(sources).toHaveLength(2);
        expect(sources?.[0]).toMatchObject({
            videoTitle: '피크 구간',
            youtubeLink: 'https://youtu.be/abc',
            assetLink: 'https://drive.google.com/file/d/asset1',
            frameLink: 'https://drive.google.com/file/d/frame1',
            text: '근거',
            timestamp: '00:10',
        });
        expect(sources?.[1]).toMatchObject({
            videoTitle: '피크 구간',
            youtubeLink: '',
            assetLink: 'https://drive.google.com/file/d/asset2',
            frameLink: '',
            text: '근거2',
            timestamp: '00:20',
        });
    });

    test('parses multi-conversation backup payload with active conversation id', () => {
        const parsed = parseConversationImportPayload({
            schemaVersion: 6,
            exportedAt: '2026-02-28T00:00:00.000Z',
            activeConversationId: 'conv-2',
            conversations: [
                {
                    id: 'conv-1',
                    title: '대화 1',
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            content: '첫 번째',
                            createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                        },
                    ],
                },
                {
                    id: 'conv-2',
                    title: '대화 2',
                    createdAt: 3,
                    updatedAt: 4,
                    messages: [
                        {
                            id: 'msg-2',
                            role: 'assistant',
                            content: '두 번째',
                            createdAt: createDateString('2026-01-02T00:00:00.000Z'),
                        },
                    ],
                    pinned: true,
                    tags: ['work'],
                },
            ],
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.conversations).toHaveLength(2);
        expect(parsed?.activeConversationId).toBe('conv-2');
        expect(parsed?.conversations[1]?.pinned).toBe(true);
        expect(parsed?.conversations[1]?.tags).toEqual(['work']);
    });

    test('falls back to the first conversation when activeConversationId is missing or invalid', () => {
        const parsed = parseConversationImportPayload({
            schemaVersion: 6,
            activeConversationId: 'not-found',
            conversations: [
                {
                    id: 'conv-1',
                    title: '복원 대화',
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            content: '내용',
                            createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                        },
                    ],
                },
            ],
        });

        expect(parsed).not.toBeNull();
        expect(parsed?.activeConversationId).toBe('conv-1');
    });

    test('rejects invalid import payload', () => {
        expect(parseConversationImportPayload({ schemaVersion: 6 })).toBeNull();
        expect(parseConversationImportPayload({ schemaVersion: 0, conversations: [] })).toBeNull();
        expect(parseConversationImportPayload({ conversation: { id: 1 } })).toBeNull();
    });

    test('merge import dedupes conversation/message ids and prioritizes imported items', () => {
        const existing = parseConversationImportPayload({
            schemaVersion: 6,
            conversations: [
                {
                    id: 'conv-1',
                    title: '기존 대화',
                    createdAt: 1,
                    updatedAt: 2,
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            content: 'existing',
                            createdAt: createDateString('2026-01-01T00:00:00.000Z'),
                        },
                    ],
                },
            ],
            activeConversationId: 'conv-1',
        });
        const imported = parseConversationImportPayload({
            schemaVersion: 6,
            conversations: [
                {
                    id: 'conv-1',
                    title: '가져온 대화',
                    createdAt: 3,
                    updatedAt: 4,
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'assistant',
                            content: 'imported-1',
                            createdAt: createDateString('2026-01-02T00:00:00.000Z'),
                        },
                        {
                            id: 'msg-1',
                            role: 'assistant',
                            content: 'imported-2',
                            createdAt: createDateString('2026-01-02T00:00:01.000Z'),
                        },
                    ],
                },
            ],
            activeConversationId: 'conv-1',
        });

        expect(existing).not.toBeNull();
        expect(imported).not.toBeNull();

        const merged = mergeImportedConversations(existing!.conversations, imported!.conversations);
        expect(merged).toHaveLength(2);
        expect(merged[0]?.id).not.toBe('conv-1');
        expect(merged[0]?.id.startsWith('conversation-')).toBe(true);
        expect(merged[1]?.id).toBe('conv-1');

        const mergedMessageIds = merged.flatMap((conversation) => conversation.messages.map((message) => message.id));
        expect(new Set(mergedMessageIds).size).toBe(mergedMessageIds.length);
    });

    test('supports backup payload built from serialized conversation state', () => {
        const persisted = serializeConversationList([
            {
                id: 'conv-1',
                title: '기존 대화',
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user',
                        content: '안녕하세요',
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                ],
                tags: ['tag-a'],
                createdAt: 1_700_000_000_000,
                updatedAt: 1_700_000_000_100,
                isBooting: false,
                bootstrapFailed: false,
                pinned: false,
                contextWindowSize: 80,
                responseMode: 'deep',
                memoryMode: 'session',
            },
            {
                id: 'conv-2',
                title: '백업 대화',
                messages: [
                    {
                        id: 'msg-2',
                        role: 'assistant',
                        content: '도움말',
                        createdAt: new Date('2026-01-02T00:00:00.000Z'),
                    },
                ],
                tags: [],
                createdAt: 1_700_000_000_200,
                updatedAt: 1_700_000_000_300,
                isBooting: false,
                bootstrapFailed: false,
                pinned: true,
                contextWindowSize: 100,
                responseMode: 'fast',
                memoryMode: 'off',
                memoryProfileNote: '   노트   ',
            },
        ], 'conv-2');

        const backupPayload = {
            schemaVersion: persisted.version,
            exportedAt: '2026-02-28T00:00:00.000Z',
            activeConversationId: persisted.activeConversationId,
            conversations: persisted.conversations,
        };
        const parsed = parseConversationImportPayload(backupPayload);

        expect(parsed).not.toBeNull();
        expect(parsed?.conversations).toHaveLength(2);
        expect(parsed?.activeConversationId).toBe('conv-2');
        expect(parsed?.conversations[0]?.id).toBe('conv-1');
        expect(parsed?.conversations[1]?.id).toBe('conv-2');
        expect(parsed?.conversations[1]?.memoryProfileNote).toBe('노트');
        expect(parsed?.conversations[1]?.pinned).toBe(true);
    });

    test('builds backup payload for all conversations using existing serialized schema', () => {
        const exportedAt = '2026-02-28T10:15:30.000Z';
        const payload = buildConversationBackupExportPayload(
            [
                {
                    id: 'conv-1',
                    title: '기존 대화',
                    messages: [
                        {
                            id: 'msg-1',
                            role: 'user',
                            content: '안녕하세요',
                            createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        },
                    ],
                    tags: ['tag-a'],
                    createdAt: 1_700_000_000_000,
                    updatedAt: 1_700_000_000_100,
                    isBooting: false,
                    bootstrapFailed: false,
                    pinned: false,
                    contextWindowSize: 80,
                    responseMode: 'deep',
                    memoryMode: 'session',
                },
                {
                    id: 'conv-2',
                    title: '백업 대화',
                    messages: [
                        {
                            id: 'msg-2',
                            role: 'assistant',
                            content: '도움말',
                            createdAt: new Date('2026-01-02T00:00:00.000Z'),
                        },
                    ],
                    tags: ['work'],
                    createdAt: 1_700_000_000_200,
                    updatedAt: 1_700_000_000_300,
                    isBooting: false,
                    bootstrapFailed: false,
                    pinned: true,
                    contextWindowSize: 100,
                    responseMode: 'fast',
                    memoryMode: 'off',
                    memoryProfileNote: '노트',
                },
            ],
            'conv-2',
            { exportedAt },
        );

        expect(payload).not.toBeNull();
        expect(payload?.schemaVersion).toBe(6);
        expect(payload?.version).toBe(6);
        expect(payload?.exportedAt).toBe(exportedAt);
        expect(payload?.activeConversationId).toBe('conv-2');
        expect(payload?.conversations).toHaveLength(2);
        expect(payload?.conversations[1]?.id).toBe('conv-2');
        expect(payload?.conversations[1]?.tags).toEqual(['work']);
        expect(payload?.conversations[1]?.pinned).toBe(true);

        const parsed = parseConversationImportPayload(payload);
        expect(parsed).not.toBeNull();
        expect(parsed?.conversations).toHaveLength(2);
        expect(parsed?.activeConversationId).toBe('conv-2');
    });

    test('duplicates conversation with deep-cloned structure and deduped ids', () => {
        const messageMeta = { source: 'local' as const, fallbackReason: 'empty_input' };
        const source = {
            id: 'conv-existing',
            title: '원본 대화',
            messages: [
                {
                    id: 'message-1',
                    role: 'user' as const,
                    content: '첫 메시지',
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    sources: [{ source: 'local', name: 'A', url: 'https://a.test' }],
                    followUpPrompts: [{ prompt: '요약해줘', label: '요약' }],
                    meta: messageMeta,
                },
                {
                    id: 'message-1',
                    role: 'assistant' as const,
                    content: '두 번째 메시지',
                    createdAt: new Date('2026-01-01T00:01:00.000Z'),
                    visualComponent: { type: 'chart', payload: { series: [1, 2, 3] } },
                },
            ],
            tags: ['analysis'],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
            isBooting: false,
            bootstrapFailed: false,
            responseMode: 'fast',
            memoryMode: 'session',
            contextWindowSize: 30,
            memoryProfileNote: '  메모  ',
            pinned: false,
        };

        const existing = [
            {
                id: 'conv-existing',
                title: '기존 대화',
                messages: [],
                tags: [],
                createdAt: 1_700_000_000_200,
                updatedAt: 1_700_000_000_300,
                isBooting: false,
                bootstrapFailed: false,
                responseMode: 'fast',
                memoryMode: 'off',
            },
        ];

        const duplicated = duplicateConversationForSidebar(source, existing);
        const duplicateIds = new Set<string>(duplicated.messages.map((message) => message.id));

        expect(duplicated.id).not.toBe(source.id);
        expect(duplicated.id).toMatch(/^conversation-/);
        expect(duplicated.messages).toHaveLength(2);
        expect(duplicated.messages[0]?.id).toMatch(/^user-/);
        expect(duplicated.messages[1]?.id).toMatch(/^assistant-/);

        expect(duplicated.messages[0]?.id).not.toBe(duplicated.messages[1]?.id);
        expect(duplicateIds.size).toBe(duplicated.messages.length);
        expect(duplicateIds).not.toContain('message-1');

        expect(duplicated.messages[0]).not.toBe(source.messages[0]);
        expect(duplicated.messages[1]).not.toBe(source.messages[1]);
        expect(duplicated.messages[0]?.sources).not.toBe(source.messages[0]?.sources);
        expect(duplicated.messages[0]?.followUpPrompts).not.toBe(source.messages[0]?.followUpPrompts);
        expect(duplicated.messages[1]?.visualComponent).not.toBe(source.messages[1]?.visualComponent);
        expect(duplicated.messages[0]?.meta).toEqual(messageMeta);
        expect(duplicated.messages[0]?.meta).not.toBe(messageMeta);
        expect(duplicated.title).toBe('원본 대화 복사본');
        expect(duplicated.createdAt).toBeGreaterThan(0);
        expect(duplicated.updatedAt).toBeGreaterThanOrEqual(duplicated.createdAt);
    });
});

describe('insight chat llm key payload helpers', () => {
    test('sanitizes llm keys and drops unknown providers', () => {
        const raw = {
            gemini: '   sk-gemini-123   ',
            openai: '\t',
            anthropic: '  sk-claude-456\r\n  ',
            nanobanana2: '  \u0000abc  ',
            unknown: 'should-not-appear',
            version: 1,
        };

        expect(sanitizeStoredLlmKeys(raw)).toEqual({
            gemini: 'sk-gemini-123',
            anthropic: 'sk-claude-456',
            nanobanana2: 'abc',
        });
    });

    test('serializes llm keys into import-ready payload', () => {
        const payload = buildLlmKeysExportPayload(
            {
                gemini: '   sk-gemini-123   ',
                openai: '  ',
                anthropic: '\u0001abc',
            },
            { exportedAt: '2026-03-01T00:00:00.000Z' },
        );

        expect(payload).toMatchObject({
            schemaVersion: 1,
            exportedAt: '2026-03-01T00:00:00.000Z',
            keys: {
                gemini: 'sk-gemini-123',
                anthropic: 'abc',
            },
        });
        expect(payload.keys.openai).toBeUndefined();
    });

    test('parses export payload', () => {
        const parsed = parseLlmKeysImportPayload({
            schemaVersion: 1,
            exportedAt: '2026-03-01T00:00:00.000Z',
            keys: {
                gemini: '   sk-gemini-123   ',
                openai: '\n',
            },
        });

        expect(parsed).toEqual({
            gemini: 'sk-gemini-123',
        });
    });

    test('parses legacy direct provider map payload', () => {
        const parsed = parseLlmKeysImportPayload({
            gemini: '   sk-gemini-123   ',
            openai: '\t',
            random: 'ignore-me',
        });

        expect(parsed).toEqual({
            gemini: 'sk-gemini-123',
        });
    });

    test('rejects malformed llm key payload', () => {
        expect(parseLlmKeysImportPayload({ random: 'not-a-key' })).toBeNull();
        expect(parseLlmKeysImportPayload([])).toBeNull();
        expect(parseLlmKeysImportPayload('bad')).toBeNull();
        expect(parseLlmKeysImportPayload({ schemaVersion: 1, keys: [] })).toBeNull();
    });
});
