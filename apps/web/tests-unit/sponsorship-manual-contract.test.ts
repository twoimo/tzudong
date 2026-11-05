import { expect, test } from 'bun:test';
import { manualSponsorshipChanges, sponsorshipState, sponsorshipLabel, youtubeMetadataChanges } from '../lib/sponsorship-state';
import { parseRecordActionRequest, type RecordActionReceipt } from '../lib/admin/record-action-contract';
import { createRecordActionClient } from '../lib/admin/record-action-client';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const operation = '33333333-3333-4333-8333-333333333333';
const request = (meta: unknown) => ({ phase: 'preview', operationId: operation, action: 'restaurant.edit',
    targetIds: [id], payload: { changes: { youtube_meta: meta } } });

test('explicit manual DTO preserves whole names and cannot be inferred from fetched or legacy metadata', () => {
    expect(manualSponsorshipChanges('detected', 'Johnson and Johnson\n3M')).toEqual({
        sponsorship_confirmation: 'detected', is_ads: true, what_ads: ['Johnson and Johnson', '3M'],
    });
    expect(manualSponsorshipChanges('detected', '  ')).toBeNull();
    for (const decision of ['detected', 'confirmed_none'] as const) {
        const dto = manualSponsorshipChanges(decision, 'SavedCo');
        expect(parseRecordActionRequest(request(dto))).not.toBeNull();
        expect(youtubeMetadataChanges(dto)).not.toHaveProperty('sponsorship_confirmation');
    }
    const retained = { title: 'base', ads_info: { is_ads: true, what_ads: 'SavedCo', sponsor_analysis: {
        status: 'unknown', outcome: 'unknown', retained_previous: true,
    } } };
    expect(youtubeMetadataChanges(retained)).toEqual({ title: 'base' });
});

test('manual confirmation rejects nullable, contradictory, empty, arbitrary and unowned changes', () => {
    const positive = manualSponsorshipChanges('detected', 'SyntheticCo')!;
    for (const bad of [
        { ...positive, is_ads: null }, { ...positive, is_ads: false },
        { ...positive, what_ads: [] }, { ...positive, what_ads: [' '] }, { ...positive, what_ads: null },
        { sponsorship_confirmation: 'confirmed_none', what_ads: null },
        { sponsorship_confirmation: 'confirmed_none', is_ads: false, what_ads: ['Co'] },
        { ...positive, sponsorship_confirmation: 'unknown' }, { ...positive, sponsorship_confirmation: null },
        { ...positive, sponsor_analysis: { source: 'description_rules', status: 'completed' } },
        { ...positive, actor: other },
    ]) expect(parseRecordActionRequest(request(bad))).toBeNull();
    expect(parseRecordActionRequest({ ...request(positive), payload: { changes: {}, perTargetChanges: [
        { id: other, changes: { youtube_meta: positive } },
    ] } })).toBeNull();
});

test('manual provenance contract reads as confirmed and never as old retained UNKNOWN', () => {
    for (const outcome of ['detected', 'confirmed_none'] as const) {
        const ads = { is_ads: outcome === 'detected', what_ads: outcome === 'detected' ? 'SyntheticCo' : null,
            sponsor_analysis: { status: 'completed', outcome, source: 'manual_admin', version: 'manual-sponsorship-v1',
                reason: 'explicit_admin_confirmation', source_sha256: null } };
        expect(sponsorshipState(ads)).toBe(outcome);
        expect(sponsorshipLabel(ads)).toBe(outcome === 'detected' ? '광고 (SyntheticCo)' : '광고 아님');
    }
});

test('manual choice uses the immutable preview payload, confirmation and original-operation readback', async () => {
    const posts: ReturnType<typeof parseRecordActionRequest>[] = [];
    let reads = 0;
    let readbackAvailable = false;
    const receipt: RecordActionReceipt = { operationId: operation, action: 'restaurant.edit', state: 'applied', targetIds: [id],
        auditId: other, previewHash: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z',
        readback: [{ id, kind: 'restaurant', status: 'approved', fingerprint: 'b'.repeat(64) }], mediaCleanupPending: false };
    const client = createRecordActionClient({ uuid: () => operation, fetch: async (_url, init) => {
        if (init?.method === 'POST') {
            const parsed = parseRecordActionRequest(JSON.parse(String(init.body)));
            expect(parsed).not.toBeNull(); posts.push(parsed);
            if (parsed?.phase === 'preview') return Response.json({ success: true, receipt: { ...receipt, state: 'preview', auditId: null } });
            throw new Error('synthetic uncertain apply');
        }
        reads++;
        return readbackAvailable ? Response.json({ success: true, receipt })
            : Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 });
    } });
    const payload = { changes: { youtube_meta: manualSponsorshipChanges('confirmed_none')! } };
    const pending = client.run({ action: 'restaurant.edit', targetIds: [id], payload });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(client.getSnapshot().phase).toBe('confirming');
    expect(posts).toHaveLength(1);
    await client.apply('변경 적용');
    expect(client.getSnapshot().phase).toBe('uncertain');
    readbackAvailable = true;
    await client.readback();
    expect(await pending).toEqual(receipt);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.payload).toEqual(posts[1]?.payload);
    expect(posts[1]?.previewHash).toBe(receipt.previewHash);
    expect(posts.every(post => post?.operationId === operation)).toBe(true);
    expect(reads).toBe(2);
});
