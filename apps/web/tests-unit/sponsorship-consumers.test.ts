import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { analyzeDisclosure } from '../lib/sponsorship-disclosure';
import { confirmedSponsorshipChanges, sponsorshipLabel, sponsorshipState, youtubeMetadataChanges } from '../lib/sponsorship-state';
import { parseYoutubeMeta } from '../lib/admin/normalize-evaluation-record';
import { parseRecordActionRequest } from '../lib/admin/record-action-contract';
import { submissionApprovalInput } from '../lib/admin/evaluation-record-actions';
import type { SubmissionRecord } from '../components/admin/SubmissionDetailView';

const base = { title: 'Synthetic video', publishedAt: '2026-10-01', duration: 300, is_shorts: false };
const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const parseChanges = (youtube_meta: unknown) => parseRecordActionRequest({ phase: 'preview', operationId: itemId,
    action: 'restaurant.edit', targetIds: [id], payload: { changes: { youtube_meta } } });

describe('sponsorship consumer write and display contract', () => {
    const fixtures = JSON.parse(readFileSync(new URL('../../../backend/utils/tests/fixtures/sponsorship-disclosure.json', import.meta.url), 'utf8')) as {
        id: string; description: string | null; outcome: string; names: string[] | null;
    }[];
    test('shared extraction cases project only permitted confirmed fields through the guarded DTO', () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(55);
        for (const fixture of fixtures) {
            const ads = analyzeDisclosure(fixture.description);
            const fields = confirmedSponsorshipChanges(ads);
            expect(fields).toEqual(fixture.outcome === 'unknown' ? {} : { is_ads: fixture.outcome === 'detected', what_ads: fixture.names });
            const dto = youtubeMetadataChanges({ ...base, ads_info: ads });
            expect(parseChanges(dto)).not.toBeNull();
            expect(dto).not.toHaveProperty('sponsor_analysis');
        }
    });

    test('basic metadata remains readable and writable without any sponsorship result', () => {
        const meta = parseYoutubeMeta(base)!;
        expect(meta.title).toBe(base.title);
        expect(meta.ads_info).toEqual({ is_ads: null, what_ads: null });
        const dto = youtubeMetadataChanges(meta)!;
        expect(dto).toEqual({ title: base.title, published_at: base.publishedAt, duration: 300, is_shorts: false });
        expect(parseChanges(dto)).not.toBeNull();
        expect(sponsorshipLabel(meta.ads_info)).toBe('광고 미확인');
    });

    test('retained unknown never emits fields that could overwrite either confirmed legacy value', () => {
        for (const is_ads of [true, false]) {
            const ads = { is_ads, what_ads: is_ads ? ['SavedCo'] : null, sponsor_analysis: { status: 'unknown', outcome: 'unknown', retained_previous: true } };
            const read = parseYoutubeMeta({ ...base, ads_info: ads })!;
            expect(read.ads_info).toEqual(ads);
            expect(confirmedSponsorshipChanges(read.ads_info)).toEqual({});
            expect(sponsorshipLabel(read.ads_info)).toBe('광고 미확인 (기존 판정 유지)');
            const dto = youtubeMetadataChanges(read)!;
            expect(Object.hasOwn(dto, 'is_ads')).toBe(false);
            expect(Object.hasOwn(dto, 'what_ads')).toBe(false);
        }
    });

    test('legacy confirmation, missing company and explicit no-ad remain distinct', () => {
        expect(sponsorshipLabel({ is_ads: true, what_ads: 'A, B' })).toBe('광고 (A, B)');
        expect(confirmedSponsorshipChanges({ is_ads: true, what_ads: null })).toEqual({ is_ads: true });
        expect(sponsorshipLabel({ is_ads: true, what_ads: null })).toBe('광고 (회사 미확인)');
        expect(sponsorshipLabel({ is_ads: false, what_ads: null })).toBe('광고 아님');
        expect(sponsorshipLabel({ is_ads: null, what_ads: null })).toBe('광고 미확인');
    });

    test('explicit boolean edits use the existing preview/apply contract; null/provenance cannot bypass it', () => {
        for (const is_ads of [true, false]) {
            const parsed = parseChanges({ is_ads, what_ads: is_ads ? ['Human confirmed'] : null });
            expect(parsed).not.toBeNull();
            expect(parsed!.payload).toEqual({ changes: { youtube_meta: { is_ads, what_ads: is_ads ? ['Human confirmed'] : null } } });
        }
        expect(parseChanges({ is_ads: null })).toBeNull();
        expect(parseChanges({ sponsor_analysis: { status: 'completed' } })).toBeNull();
    });

    test('submission approval of base-complete UNKNOWN does not invent false or clear advertisers', () => {
        const ads = analyzeDisclosure('광고 문의');
        const submission = { id, submission_type: 'new', items: [{ id: itemId, item_status: 'pending', youtube_link: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' }] } as SubmissionRecord;
        const input = submissionApprovalInput({ submission, approvalData: { lat: '37.5', lng: '127', jibun_address: 'synthetic avenue', road_address: 'synthetic avenue', english_address: '', address_elements: {} }, editableData: { name: 'Synthetic', address: 'synthetic avenue', phone: '', categories: ['한식'] }, forceApprove: false,
            itemDecisions: { [itemId]: { approved: true, rejectionReason: '', youtube_link: '', tzuyang_review: 'synthetic evidence', metaData: { ...base, ads_info: ads } } } });
        const meta = (input.payload as { items: { changes: { youtube_meta: object } }[] }).items[0].changes.youtube_meta;
        expect(meta).toEqual(youtubeMetadataChanges(base)!);
        expect(parseRecordActionRequest({ ...input, phase: 'preview', operationId: itemId })).not.toBeNull();
    });

    test('failed, malformed and contradictory supplement data stays UNKNOWN', () => {
        for (const value of [{ is_ads: false, what_ads: {} }, { is_ads: false, sponsor_analysis: null },
            { is_ads: true, what_ads: ['A'], sponsor_analysis: { status: 'completed', outcome: 'detected', retained_previous: 'false' } },
            { is_ads: true, what_ads: ['A'], sponsor_analysis: { status: 'failed' } }, { is_ads: false, what_ads: ['Contradiction'] }]) {
            expect(sponsorshipState(value)).toBe('unknown');
            expect(confirmedSponsorshipChanges(value)).toEqual({});
        }
    });
});
