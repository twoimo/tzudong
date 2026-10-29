import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyzeDisclosure, DISCLOSURE_VERSION } from '../lib/sponsorship-disclosure';
import { confirmedSponsorshipChanges } from '../lib/sponsorship-state';

const cases = JSON.parse(readFileSync(new URL('../../../backend/utils/tests/fixtures/sponsorship-disclosure.json', import.meta.url), 'utf8')) as {
    id: string; description: string | null; outcome: 'detected' | 'confirmed_none' | 'unknown'; names: string[] | null;
}[];

describe('offline first-party disclosure shared contract', () => {
    test('unfinished wrapped denials and company lists emit no attribution overwrite', () => {
        for (const description of ['This video is not sponsored\nby ACME.',
            'This video is sponsored by ACME\nand Beta.']) {
            const changes = confirmedSponsorshipChanges(analyzeDisclosure(description));
            expect(changes).toEqual({});
            const existing = { is_ads: true, what_ads: ['SavedCo'] };
            expect({ ...existing, ...changes }).toEqual(existing);
        }
    });
    test('fenced examples across paragraphs emit no attribution overwrite', () => {
        for (const statement of ['This video is not sponsored.', 'This video is sponsored by ACME.']) {
            for (const fence of ['```', '~~~']) {
                const changes = confirmedSponsorshipChanges(analyzeDisclosure(`${fence}\n\n${statement}\n\n${fence}`));
                expect(changes).toEqual({});
                for (const existing of [{ is_ads: true, what_ads: ['SavedCo'] }, { is_ads: false, what_ads: null }]) {
                    expect({ ...existing, ...changes }).toEqual(existing);
                }
            }
        }
    });
    for (const fixture of cases) {
        test(fixture.id, () => {
            const result = analyzeDisclosure(fixture.description);
            expect(result.what_ads).toEqual(fixture.names);
            expect(result.is_ads).toBe(fixture.outcome === 'detected' ? true : fixture.outcome === 'confirmed_none' ? false : null);
            expect(result.sponsor_analysis).toEqual({
                status: fixture.outcome === 'unknown' ? 'unknown' : 'completed',
                outcome: fixture.outcome,
                reason: expect.any(String),
                source: 'description_rules',
                version: DISCLOSURE_VERSION,
                source_sha256: fixture.description === null ? null : createHash('sha256').update(fixture.description).digest('hex'),
            });
        });
    }
});
