import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyzeDisclosure, DISCLOSURE_VERSION } from '../lib/sponsorship-disclosure';

const cases = JSON.parse(readFileSync(new URL('../../../backend/utils/tests/fixtures/sponsorship-disclosure.json', import.meta.url), 'utf8')) as {
    id: string; description: string | null; outcome: 'detected' | 'confirmed_none' | 'unknown'; names: string[] | null;
}[];

describe('offline first-party disclosure shared contract', () => {
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
