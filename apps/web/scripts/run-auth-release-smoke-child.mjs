import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const AUTH_COOKIE = 'sb-aqlcofblfxdrjhhdmarw-auth-token';
const MAX_SESSION_SECONDS = 2 * 60 * 60;
const MAX_STORAGE_STATE_BYTES = 128 * 1024;
const MAX_COOKIE_VALUE_BYTES = 32 * 1024;
const NAVIGATION_TIMEOUT_MS = 20_000;
const STABILITY_TIMEOUT_MS = 750;
const PROOF_FETCH_TIMEOUT_MS = 5_000;
const PROOF_PATH = '/api/admin/release-auth-proof';
const REASON_CODES = new Set(['CANARY_INTENTIONAL_FAILURE', 'INVALID_AUTH_STATE', 'CROSS_ORIGIN_REDIRECT', 'EXTERNAL_EGRESS', 'AUTH_PROOF_DENIED', 'AUTH_PROOF_FAILED', 'ADMIN_SHELL_MISSING', 'ADMIN_GEOMETRY_INVALID', 'ADMIN_ACCESSIBILITY_INVALID', 'ADMIN_ERROR_VISIBLE', 'NAVIGATION_FAILED', 'SESSION_REVOCATION_FAILED', 'INTERNAL_FAILURE']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
export function safeReason(error) { return REASON_CODES.has(error?.code) ? error.code : 'INTERNAL_FAILURE'; }
export function exactOrigin(value) { const url = new URL(value); if (url.toString() !== value || url.protocol !== 'https:' || url.username || url['password'] || url.port || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) fail('INVALID_AUTH_STATE'); return url; }
export function scrubBrowserEnvironment() { return { PATH: process.env.PATH || '', HOME: '', TMP: '', TEMP: '', TMPDIR: '' }; }
export function parseChildCli(argv = process.argv.slice(2)) { if (argv.length !== 2 || argv[0] !== '--origin' || !argv[1]) fail('INVALID_AUTH_STATE'); return exactOrigin(argv[1]); }

function decodeBase64Json(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_STORAGE_STATE_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('INVALID_AUTH_STATE');
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length || bytes.toString('base64') !== value) fail('INVALID_AUTH_STATE');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('INVALID_AUTH_STATE'); }
    try { return JSON.parse(text); } catch { fail('INVALID_AUTH_STATE'); }
}
export function parseSession(origin, encoded = process.env.RELEASE_AUTH_STORAGE_STATE_B64) {
    if (!encoded) fail('INVALID_AUTH_STATE'); const state = decodeBase64Json(encoded);
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join(',') !== 'cookies,origins' || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || state.origins.length !== 0 || state.cookies.length < 1 || state.cookies.length > 8) fail('INVALID_AUTH_STATE');
    const now = Math.floor(Date.now() / 1000); const names = new Set();
    for (const cookie of state.cookies) { if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie) || Object.keys(cookie).sort().join(',') !== 'domain,expires,httpOnly,name,path,sameSite,secure,value' || typeof cookie.name !== 'string' || !new RegExp(`^${AUTH_COOKIE}(?:\\.\\d+)?$`).test(cookie.name) || names.has(cookie.name) || cookie.domain !== origin.hostname || cookie.path !== '/' || typeof cookie.value !== 'string' || !cookie.value || Buffer.byteLength(cookie.value, 'utf8') > MAX_COOKIE_VALUE_BYTES || !Number.isInteger(cookie.expires) || cookie.expires <= now || cookie.expires > now + MAX_SESSION_SECONDS || cookie.httpOnly !== true || cookie.secure !== true || cookie.sameSite !== 'Lax') fail('INVALID_AUTH_STATE'); names.add(cookie.name); }
    const chunks = [...names].filter((name) => name !== AUTH_COOKIE).sort((a, b) => Number(a.slice(AUTH_COOKIE.length + 1)) - Number(b.slice(AUTH_COOKIE.length + 1)));
    if ((names.has(AUTH_COOKIE) && chunks.length) || (!names.has(AUTH_COOKIE) && (!chunks.length || !chunks.every((name, index) => name === `${AUTH_COOKIE}.${index}`)))) fail('INVALID_AUTH_STATE'); return state;
}

function metadata(reasonCode, extra = {}) { const result = { ok: reasonCode === 'OK', reasonCode, revocationReceipt: 'parent_required', authProofSha256: null, shellHeight: null, shellWidth: null, headingCount: null, navigationCount: null, status: null, finalUrl: null, capturedAt: null, ...extra }; process.stdout.write(`${JSON.stringify(result)}\n`); }
export function allowedBrowserRequest(request, origin) {
    let url;
    try { url = new URL(request.url()); } catch { return false; }
    return url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method());
}
async function installEgressGuard(context, origin) {
    const violations = new Set();
    await context.route('**/*', async (route) => {
        if (allowedBrowserRequest(route.request(), origin)) await route.continue();
        else {
            violations.add(route.request().url());
            await route.abort('blockedbyclient');
        }
    });
    return violations;
}
function installErrorMatrix(page, origin) { const errors = new Set(); page.on('console', (message) => { if (message.type() === 'error') errors.add('console'); if (/hydration|hydrated but|server-rendered html/i.test(message.text())) errors.add('hydration'); }); page.on('pageerror', () => errors.add('page')); page.on('requestfailed', (request) => { if (new URL(request.url()).origin === origin.origin) errors.add('request'); }); page.on('response', (response) => { if (new URL(response.url()).origin === origin.origin && response.status() >= 400 && !response.url().includes(PROOF_PATH)) errors.add('http'); }); return errors; }
async function validateAdminShell(page) { const shell = page.locator('main, [role="main"], [data-admin-console-content]').first(); if ((await shell.count()) !== 1 || !(await shell.isVisible())) fail('ADMIN_SHELL_MISSING'); const box = await shell.boundingBox(); if (!box || box.width < 320 || box.height < 240 || box.x < 0 || box.y < 0) fail('ADMIN_GEOMETRY_INVALID'); const headingCount = await page.getByRole('heading').count(); const navigation = page.getByRole('navigation', { name: '관리자 통합 메뉴' }); const sidebar = page.getByRole('complementary', { name: '관리자 콘솔 사이드바' }); const header = page.locator('header').first(); const current = page.locator('[aria-current="page"]'); const bottomNav = page.locator('[data-admin-bottom-nav], nav[aria-label*="하단"]'); if (headingCount < 1 || (await navigation.count()) < 1 || !(await navigation.first().isVisible()) || (await sidebar.count()) !== 1 || !(await sidebar.isVisible()) || (await header.count()) < 1 || !(await header.isVisible()) || (await current.count()) < 1 || (await bottomNav.count()) !== 0) fail('ADMIN_ACCESSIBILITY_INVALID'); const errors = page.locator('[role="alert"], [data-error], .error').filter({ hasText: /.+/ }); if ((await errors.count()) > 0) fail('ADMIN_ERROR_VISIBLE'); return { shellHeight: Math.round(box.height), shellWidth: Math.round(box.width), headingCount, navigationCount: await page.getByRole('navigation').count() }; }

export function validateFinalAdminUrl(value, origin) { const url = new URL(value); if (url.toString() !== value || url.origin !== origin.origin || url.pathname !== '/admin' || url.search || url.hash) fail('CROSS_ORIGIN_REDIRECT'); return url.toString(); }
function sha256(domain, value) { return createHash('sha256').update(domain, 'utf8').update(value, 'utf8').digest('hex'); }
function isChallenge(value) { if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false; const bytes = Buffer.from(value, 'base64url'); return bytes.length === 32 && bytes.toString('base64url') === value; }
export function parseProofExpectation(environment = process.env) { const challenge = environment.RELEASE_AUTH_PROOF_CHALLENGE; const challengeSha256 = environment.RELEASE_AUTH_PROOF_CHALLENGE_SHA256; const identitySha256 = environment.RELEASE_AUTH_PROOF_IDENTITY_SHA256; if (typeof challenge !== 'string' || !isChallenge(challenge) || typeof challengeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(challengeSha256) || typeof identitySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(identitySha256) || challengeSha256 !== sha256('tzudong:release-auth-proof:challenge:v1\n', challenge)) fail('INVALID_AUTH_STATE'); return { challenge, challengeSha256, identitySha256 }; }
export function validateProof(value, expected) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'bindingSha256,challengeSha256,identitySha256,schemaVersion' || value.schemaVersion !== 1 || value.challengeSha256 !== expected.challengeSha256 || value.identitySha256 !== expected.identitySha256 || typeof value.bindingSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.bindingSha256) || value.bindingSha256 !== sha256('tzudong:release-auth-proof:binding:v1\n', `${value.challengeSha256}\n${value.identitySha256}`)) fail('AUTH_PROOF_FAILED'); return sha256('tzudong:release-auth-proof-receipt:v1\n', JSON.stringify(value)); }
export async function requestProof(context, origin, challenge) {
    const target = new URL(PROOF_PATH, origin);
    let response;
    try {
        response = await context.request.fetch(target.toString(), {
            method: 'POST',
            headers: { 'x-tzudong-release-auth-challenge': challenge },
            maxRedirects: 0,
            timeout: PROOF_FETCH_TIMEOUT_MS,
        });
        const body = await response.body();
        if (body.byteLength > 16 * 1024 || response.url() !== target.toString()) fail('AUTH_PROOF_FAILED');
        let json = null;
        try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch {}
        return { status: response.status(), cacheControl: response.headers()['cache-control'] || null, contentType: response.headers()['content-type'] || null, referrerPolicy: response.headers()['referrer-policy'] || null, contentTypeOptions: response.headers()['x-content-type-options'] || null, body: json };
    } catch (error) {
        if (error?.code) throw error;
        fail('AUTH_PROOF_FAILED');
    } finally {
        await response?.dispose().catch(() => {});
    }
}
async function assertProofDenied(context, origin, cookieValue) {
    if (cookieValue) await context.addCookies([{ name: AUTH_COOKIE, value: cookieValue, domain: origin.hostname, path: '/', expires: Math.floor(Date.now() / 1000) + 60, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const proof = await requestProof(context, origin, 'A'.repeat(43));
    if (![401, 403].includes(proof.status)) fail('AUTH_PROOF_DENIED');
}
async function validateCanary(origin) { const state = parseSession(origin); const markers = [process.env.RELEASE_AUTH_CANARY_FAKE_COOKIE, process.env.RELEASE_AUTH_CANARY_FAKE_TOKEN, process.env.RELEASE_AUTH_CANARY_FAKE_ADMIN_TEXT]; if (markers.some((marker) => typeof marker !== 'string' || marker.length < 16) || !markers.every((marker) => JSON.stringify(state).includes(marker))) fail('INTERNAL_FAILURE'); const browser = await chromium.launch({ headless: true, env: scrubBrowserEnvironment() }); try { const context = await browser.newContext({ storageState: state, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } }); try { const egress = await installEgressGuard(context, origin); const page = await context.newPage(); await page.goto(new URL('/admin', origin).toString(), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }); await page.waitForTimeout(STABILITY_TIMEOUT_MS); if (egress.size) fail('EXTERNAL_EGRESS'); } finally { await context.close(); } } finally { await browser.close(); } fail('CANARY_INTENTIONAL_FAILURE'); }

export async function main() {
    let terminalCode = 'INTERNAL_FAILURE'; let successMetadata; let primaryFailure;
    try {
        const origin = parseChildCli();
        if (process.env.RELEASE_AUTH_CANARY_MODE === 'intentional_failure') await validateCanary(origin);
        const state = parseSession(origin); const expectedProof = parseProofExpectation(); const browser = await chromium.launch({ headless: true, env: scrubBrowserEnvironment() });
        try {
            for (const invalidCookie of [null, 'invalid-release-auth-cookie']) { const control = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } }); try { await installEgressGuard(control, origin); await assertProofDenied(control, origin, invalidCookie); } finally { await control.close(); } }
            const context = await browser.newContext({ storageState: state, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
            try {
                const egress = await installEgressGuard(context, origin); const page = await context.newPage(); const errorMatrix = installErrorMatrix(page, origin); let crossOriginRedirect = false;
                page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame() && new URL(request.url()).origin !== origin.origin) crossOriginRedirect = true; });
                const response = await page.goto(new URL('/admin', origin).toString(), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }); if (!response) fail('NAVIGATION_FAILED');
                try { await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }); } catch { fail('NAVIGATION_FAILED'); }
                if (egress.size) fail('EXTERNAL_EGRESS'); if (crossOriginRedirect || new URL(page.url()).origin !== origin.origin) fail('CROSS_ORIGIN_REDIRECT'); if (errorMatrix.size) fail('ADMIN_ERROR_VISIBLE');
                const shell = await validateAdminShell(page);
                const proof = await requestProof(context, origin, expectedProof.challenge);
                if (proof.status !== 200 || proof.cacheControl !== 'no-store, max-age=0' || proof.contentType !== 'application/json; charset=utf-8' || proof.referrerPolicy !== 'no-referrer' || proof.contentTypeOptions !== 'nosniff') fail('AUTH_PROOF_FAILED');
                const authProofSha256 = validateProof(proof.body, expectedProof);
                await page.waitForTimeout(STABILITY_TIMEOUT_MS); if (egress.size) fail('EXTERNAL_EGRESS'); if (errorMatrix.size) fail('ADMIN_ERROR_VISIBLE'); if (crossOriginRedirect) fail('CROSS_ORIGIN_REDIRECT');
                successMetadata = { ...shell, authProofSha256, status: response.status(), finalUrl: validateFinalAdminUrl(page.url(), origin), capturedAt: Math.floor(Date.now() / 1000) }; terminalCode = 'OK';
            } finally { await context.close(); }
        } finally { await browser.close(); }
    } catch (error) { primaryFailure = safeReason(error); terminalCode = primaryFailure; }
    if (terminalCode === 'OK') metadata('OK', successMetadata); else metadata(terminalCode); return { terminalCode, primaryFailure, revocationReceipt: 'parent_required' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(({ terminalCode }) => { if (terminalCode !== 'OK') process.exitCode = terminalCode === 'CANARY_INTENTIONAL_FAILURE' ? 23 : 1; }).catch(() => { metadata('INTERNAL_FAILURE'); process.exitCode = 1; });
