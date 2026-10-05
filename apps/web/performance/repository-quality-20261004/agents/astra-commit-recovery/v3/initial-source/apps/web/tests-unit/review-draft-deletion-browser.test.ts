import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Real IndexedDB in a fresh browser, using only synthetic text and local bundle
// interception. No app server, configured client, user profile or network API.
(existsSync(chrome) ? test : test.skip)('captured draft deletion is atomic, scoped, retryable and protects replacement rows', async () => {
    const fixtureSource = `
        import { saveDraft, getDraft, prepareDraftDeletion } from './lib/reviewDraftDB';
        const clock = Date.now(); let now = clock;
        Date.now = () => now;
        const draft = (userId = 'fixture-owner', restaurantId = 'fixture-restaurant', content = 'Synthetic draft text') => ({
            userId, restaurantId, currentStep: 3, visitedDate: '2026-10-04', visitedTime: '12:00', categories: ['한식'], content,
        });
        window.run = async () => {
            const result = {};
            await saveDraft(draft());
            const deletedAfterUnmount = await prepareDraftDeletion('fixture-owner', 'fixture-restaurant');
            result.knownCommitClearsCapturedRow = await deletedAfterUnmount() && await getDraft('fixture-owner', 'fixture-restaurant') === null;
            result.repeatedCleanupIsIdempotent = await deletedAfterUnmount();

            await saveDraft(draft());
            const oldCleanup = await prepareDraftDeletion('fixture-owner', 'fixture-restaurant');
            now++;
            await saveDraft(draft('fixture-owner', 'fixture-restaurant', 'Newer synthetic edited draft'));
            result.changedRowSurvives = await oldCleanup() && (await getDraft('fixture-owner', 'fixture-restaurant'))?.content === 'Newer synthetic edited draft';

            const sameTextCleanup = await prepareDraftDeletion('fixture-owner', 'fixture-restaurant');
            now++;
            await saveDraft(draft('fixture-owner', 'fixture-restaurant', 'Newer synthetic edited draft'));
            result.newerTimestampSurvives = await sameTextCleanup() && await getDraft('fixture-owner', 'fixture-restaurant') !== null;

            const absentCleanup = await prepareDraftDeletion('fixture-owner', 'fixture-new-restaurant');
            await saveDraft(draft('fixture-owner', 'fixture-new-restaurant'));
            result.newRowAtAbsentKeySurvives = await absentCleanup() && await getDraft('fixture-owner', 'fixture-new-restaurant') !== null;

            await saveDraft(draft('fixture-other-owner'));
            await saveDraft(draft('fixture-owner', 'fixture-other-restaurant'));
            const scopedCleanup = await prepareDraftDeletion('fixture-owner', 'fixture-restaurant');
            result.scopePreserved = await scopedCleanup()
                && await getDraft('fixture-owner', 'fixture-restaurant') === null
                && await getDraft('fixture-other-owner', 'fixture-restaurant') !== null
                && await getDraft('fixture-owner', 'fixture-other-restaurant') !== null;

            const rejectedCleanup = await prepareDraftDeletion('invalid identifier', 'fixture-restaurant');
            result.invalidScopeRejected = !await rejectedCleanup();
            await saveDraft({ ...draft(), verificationPhoto: new File(['synthetic'], 'fixture.jpg'), foodPhotos: [new File(['synthetic'], 'fixture.jpg')] });
            const read = await getDraft('fixture-owner', 'fixture-restaurant');
            result.textOnlySchemaPreserved = !!read && !('verificationPhoto' in read) && !('foodPhotos' in read)
                && Object.keys(read).sort().join(',') === 'categories,content,currentStep,restaurantId,savedAt,userId,visitedDate,visitedTime';
            return result;
        };
    `;
    const build = await Bun.build({
        entrypoints: ['review-draft-fixture.ts'], target: 'browser', minify: true,
        plugins: [{ name: 'offline-draft-fixture', setup(builder) {
            builder.onResolve({ filter: /^review-draft-fixture\.ts$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixtureSource, loader: 'ts', resolveDir: process.cwd() }));
        } }],
    });
    expect(build.success).toBe(true);
    const script = await build.outputs[0].text();
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
        const page = await browser.newPage();
        let externalRequests = 0;
        let pageErrors = 0;
        page.on('pageerror', () => { pageErrors++; });
        await page.route('**/*', route => {
            if (route.request().url() === 'https://draft-recovery.test/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
            if (route.request().url() === 'https://draft-recovery.test/') return route.fulfill({
                contentType: 'text/html', body: '<!doctype html><title>Synthetic draft regression</title><script src="/fixture.js"></script>',
            });
            externalRequests++;
            return route.abort();
        });
        await page.goto('https://draft-recovery.test/');
        const result = await page.evaluate(async () => (window as unknown as { run(): Promise<Record<string, boolean>> }).run());
        expect(Object.keys(result)).toHaveLength(8);
        for (const passed of Object.values(result)) expect(passed).toBe(true);
        expect(externalRequests).toBe(0); expect(pageErrors).toBe(0);
    } finally {
        await browser.close();
    }
}, 30_000);
