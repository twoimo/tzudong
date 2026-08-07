import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dir, '..');
const read = (relativePath: string) => readFileSync(path.join(webRoot, relativePath), 'utf8');
const parent = read('scripts/run-auth-release-smoke.mjs');
const child = read('scripts/run-auth-release-smoke-child.mjs');
const visualSources = [
    read('scripts/run-release-visual-evidence.mjs'),
    read('scripts/assemble-release-visual-evidence.mjs'),
    read('scripts/verify-release-visual-evidence.mjs'),
];

test('authenticated release evidence has no recorder, storage file, or raw failure surface', () => {
    for (const source of [parent, child]) for (const forbidden of ['@playwright/test', 'trace', 'video', 'screenshot', 'recordHar', 'reporter', 'accessibility.snapshot', 'attachments:', 'writeFile']) expect(source).not.toContain(forbidden);
    expect(parent).toContain("stdio: ['ignore', 'pipe', 'pipe']");
    expect(parent).toContain('assertRestrictedEmptyDirectory');
    expect(parent).toContain('rm(directory, { recursive: true, force: true })');
    expect(parent).toContain('CHILD_TIMEOUT_MS');
    expect(parent).toContain('safeReason(error)');
    expect(parent).toContain("const SUPABASE_ORIGIN = 'https://aqlcofblfxdrjhhdmarw.supabase.co/'");
});

test('only strict CLI values bind release identity and the child receives no release trust material', () => {
    for (const forbidden of ['RELEASE_AUTH_CELL_ID', 'RELEASE_AUTH_ORIGIN', 'RELEASE_AUTH_TUPLE_RECEIPT_SHA256', 'RELEASE_AUTH_EXPECTED_SHA', 'RELEASE_AUTH_EXPECTED_ENVIRONMENT', 'RELEASE_AUTH_EXPECTED_ALIAS_HOST']) expect(parent).not.toContain(forbidden);
    expect(parent).toContain("const CLI_KEYS = new Set(['cell-id', 'origin', 'release-id', 'certification-id', 'challenge', 'issued-at', 'expires-at', 'expected-git-sha', 'expected-deployment-receipt-sha256'])");
    expect(parent).toContain("sha256('tzudong:deployment-receipt:v2\\n', receipt)");
    expect(parent).toContain("sha256('tzudong:release-auth-receipt:v1\\n', payload)");
    expect(parent).toContain('RELEASE_AUTH_TUPLE_RECEIPT_B64');
    expect(child).not.toContain('release-id');
    expect(child).not.toContain('expected-git-sha');
    expect(child).not.toContain('expected-deployment-receipt-sha256');
});

test('credentials only reach the Node consumer and browser descendants receive a scrubbed environment', () => {
    const canary = parent.slice(parent.indexOf("RELEASE_AUTH_CANARY_MODE: 'intentional_failure'"), parent.indexOf('if (canary.code'));
    expect(canary).toContain('fakeCanaryState(release.origin, canaryMarkers)');
    expect(canary).not.toContain('RELEASE_AUTH_SUPABASE_URL');
    expect(canary).not.toContain('RELEASE_AUTH_SUPABASE_ANON_KEY');
    expect(child).toContain('function scrubBrowserEnvironment()');
    expect(child).toContain('env: scrubBrowserEnvironment()');
    expect(child).toContain('maxRedirects: 0');
});

test('nested receipt is exact, independently hashable, and metadata remains private', () => {
    expect(parent).toContain('metadata: { receiptVersion: 1, receiptSha256, payload }');
    expect(parent).toContain("release: { releaseId: release.releaseId, certificationId: release.certificationId, gitSha: release.expectedGitSha, challenge: release.challenge, issuedAt: release.issuedAt, expiresAt: release.expiresAt }");
    expect(parent).toContain("const cellEnvironment = release.cellId === 'alias-admin-auth-smoke-metadata'");
    expect(parent).toContain("cell: { id: release.cellId, environment: cellEnvironment, route: '/admin', origin: release.origin.toString(), finalUrl: metadata.finalUrl }");
    expect(parent).toContain('result: { ok: metadata.ok, reasonCode: metadata.reasonCode, authProofSha256: metadata.authProofSha256, revocationOperationId: revocation.operationId');
    expect(parent).toContain('markers.some((marker) => JSON.stringify(value).includes(marker))');
    expect(child).toContain('finalUrl: null, capturedAt: null');
    expect(child).toContain('validateFinalAdminUrl(page.url(), origin)');
    expect(child).toContain('capturedAt: Math.floor(Date.now() / 1000)');
    expect(parent).toContain("new URL('/rest/v1/rpc/revoke_release_auth_session_family', SUPABASE_ORIGIN)");
    expect(parent).toContain("new URL('/rest/v1/rpc/read_release_auth_revocation', SUPABASE_ORIGIN)");
    expect(parent).toContain("status !== 'revoked_verified'");
    expect(child).not.toContain('RELEASE_AUTH_SUPABASE_SERVICE_ROLE');
});

test('late page failures and navigation timeouts remain fail-closed', () => {
    expect(child).toContain("await page.waitForLoadState('networkidle'");
    expect(child).toContain("catch { fail('NAVIGATION_FAILED'); }");
    expect(child).toContain('await page.waitForTimeout(STABILITY_TIMEOUT_MS)');
    expect(child).toContain("if (errorMatrix.size) fail('ADMIN_ERROR_VISIBLE')");
    expect(parent).toContain('AbortSignal.timeout(FETCH_TIMEOUT_MS)');
    expect(child).toContain('timeout: PROOF_FETCH_TIMEOUT_MS');
});
test('G009 visual entrypoints expose only sanitized errors and no symmetric trust root', () => {
    for (const source of visualSources) {
        expect(source).not.toContain('RELEASE_VISUAL_RECEIPT_CHANNEL_KEY');
        expect(source).not.toContain('createHmac');
        expect(source).toContain('G009');
        expect(source).toContain('FAILED');
    }
    expect(visualSources.join('\n')).toContain('issuerSignature');
    expect(visualSources.join('\n')).toContain('verificationNonce');
    expect(visualSources.join('\n')).toContain('fd0a3adcd714d800cc372274c51cd694515e7f2e6c8eab909f4c9d14fbc79040');
    expect(visualSources.join('\n')).toContain('G009_ISSUER_PUBLIC_KEY');
});
