import { describe, expect, test } from 'bun:test';

import {
    buildAttachmentSelectionNotice,
    summarizeAttachmentSelection,
} from '@/components/insight/InsightChatSection';

describe('insight chat attachment selection summary helpers', () => {
    test('summarizes accepted and rejected files by category', () => {
        const summary = summarizeAttachmentSelection([
            {
                name: 'report.txt',
                accepted: true,
            },
            {
                name: 'bad.pdf',
                accepted: false,
                reason: 'extension',
            },
            {
                name: 'bad.xls',
                accepted: false,
                reason: 'mime',
            },
            {
                name: 'huge.csv',
                accepted: false,
                reason: 'size',
            },
            {
                name: 'empty.txt',
                accepted: false,
                reason: 'empty',
            },
            {
                name: 'overflow.txt',
                accepted: false,
                reason: 'max-count',
            },
        ]);

        expect(summary).toMatchObject({
            acceptedCount: 1,
            rejectedCount: 5,
            acceptedFileNames: ['report.txt'],
            rejectedFileNamesByReason: {
                extension: ['bad.pdf'],
                mime: ['bad.xls'],
                size: ['huge.csv'],
                empty: ['empty.txt'],
                'max-count': ['overflow.txt'],
            },
        });
    });

    test('builds inline notice with explicit reasons and accepted summary', () => {
        const notice = buildAttachmentSelectionNotice({
            acceptedCount: 2,
            rejectedCount: 2,
            acceptedFileNames: ['first.txt', 'notes.csv'],
            rejectedFileNamesByReason: {
                extension: ['bad.pdf'],
                mime: ['bad.bin'],
                size: [],
                empty: ['blank.txt'],
                'max-count': [],
            },
        });

        expect(notice).toContain('첨부됨 2개: first.txt, notes.csv');
        expect(notice).toContain('확장자 거부 (bad.pdf)');
        expect(notice).toContain('MIME 거부 (bad.bin)');
        expect(notice).toContain('비어 있음 거부 (blank.txt)');
    });

    test('returns blank notice when no accepted or rejected entries exist', () => {
        const summary = summarizeAttachmentSelection([]);

        expect(buildAttachmentSelectionNotice(summary)).toBe('');
        expect(summary).toEqual({
            acceptedCount: 0,
            rejectedCount: 0,
            acceptedFileNames: [],
            rejectedFileNamesByReason: {
                extension: [],
                mime: [],
                size: [],
                empty: [],
                'max-count': [],
            },
        });
    });
});
