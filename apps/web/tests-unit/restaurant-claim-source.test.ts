import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

const ADMIN_ROUTES = [
  'app/api/admin/claims/route.ts',
  'app/api/admin/claims/preview/route.ts',
  'app/api/admin/claims/apply/route.ts',
] as const;

const MUTATION_ROUTES = [
  'app/api/claim/start/route.ts',
  'app/api/claim/evidence/route.ts',
  'app/api/admin/claims/preview/route.ts',
  'app/api/admin/claims/apply/route.ts',
] as const;

const ALL_CLAIM_ROUTES = [
  'app/api/claim/status/route.ts',
  ...MUTATION_ROUTES,
  'app/api/admin/claims/route.ts',
] as const;

describe('restaurant claim source contract', () => {
  test('admin claim handlers call requireAdmin first and never use request.json', () => {
    for (const file of ADMIN_ROUTES) {
      const routeSource = source(file);
      expect(routeSource).toContain("from '@/lib/auth/require-admin'");
      expect(routeSource).toContain('const admin = await requireAdmin();');
      expect(routeSource).toContain('if (!admin.ok)');
      expect(routeSource).toContain('return admin.response');
      const handlerStart = routeSource.indexOf('export async function');
      const authIndex = routeSource.indexOf('await requireAdmin()', handlerStart);
      expect(authIndex).toBeGreaterThan(handlerStart);
      const workIndexes = ['readBoundedJsonRequest', 'listAdminRestaurantClaims(']
        .map((needle) => routeSource.indexOf(needle, handlerStart))
        .filter((index) => index >= 0);
      expect(workIndexes.length).toBeGreaterThan(0);
      expect(authIndex).toBeLessThan(Math.min(...workIndexes));
      expect(routeSource).not.toContain('request.json()');
      expect(routeSource).not.toContain('request.text()');
      expect(routeSource).not.toContain('createSupabaseServiceRoleClient');
      expect(routeSource).not.toContain('console.error');
    }
  });

  test('mutations use same-origin plus bounded JSON and fixed error codes', () => {
    for (const file of MUTATION_ROUTES) {
      const routeSource = source(file);
      expect(routeSource).toContain("from '@/lib/security/bounded-json-request'");
      expect(routeSource).toContain("from '@/lib/security/same-origin-mutation'");
      expect(routeSource).toContain('readBoundedJsonRequest(request, MAX_CLAIM_REQUEST_BYTES)');
      expect(routeSource).toContain('if (!isTrustedSameOriginMutation(request))');
      expect(routeSource).toContain('RESTAURANT_CLAIM_ERROR.untrustedOrigin');
      expect(routeSource).not.toContain('request.json()');
      expect(routeSource).not.toContain('error.message');
      expect(routeSource).not.toContain('stack');
    }
  });

  test('claim APIs return bounded JSON and never echo cookies, secrets, or raw license bytes', () => {
    const httpSource = source('lib/claim/http.ts');
    expect(httpSource).toContain("response.headers.set('Cache-Control', 'no-store')");
    expect(httpSource).toContain('{ ok: false, error }');

    for (const file of ALL_CLAIM_ROUTES) {
      const routeSource = source(file);
      expect(routeSource).toContain("export const runtime = 'nodejs'");
      expect(routeSource.includes('noStoreJson') || routeSource.includes('claimErrorResponse')).toBe(true);
      expect(routeSource).not.toContain('localStorage');
      expect(routeSource).not.toContain('document.cookie');
      expect(routeSource).not.toContain('service_role');
      expect(routeSource).not.toContain('arrayBuffer');
      expect(routeSource).not.toContain('formData');
      expect(routeSource).not.toMatch(/ocr/i);
    }

    const evidenceRoute = source('app/api/claim/evidence/route.ts');
    expect(evidenceRoute).toContain('assertPrivacySafe');
    expect(evidenceRoute).not.toContain('fileBytes');
    expect(evidenceRoute).not.toContain('licenseImage');

    const applyRoute = source('app/api/admin/claims/apply/route.ts');
    expect(applyRoute).toContain('confirmationText');
    expect(applyRoute).toContain('previewHash');
    expect(applyRoute).toContain('idempotencyKey');
    expect(applyRoute).toContain('readback');
    expect(applyRoute).not.toContain('rawBody');
  });

  test('confirmation text and e2e claim user header stay fail-closed', () => {
    const contract = source('lib/claim/contract.ts');
    expect(contract).toContain("RESTAURANT_CLAIM_CONFIRMATION_TEXT = '소유권 인증 승인'");
    expect(contract).toContain("E2E_CLAIM_USER_ID_HEADER = 'x-e2e-claim-user-id'");
    expect(contract).toContain("RESTAURANT_CLAIM_DOCUMENT_KIND = 'business_license'");
    expect(contract).not.toContain('cookie');
    expect(contract).not.toContain('localStorage');

    const auth = source('lib/claim/auth.ts');
    expect(auth).toContain('isE2EAdminRouteBypassEnvEnabled()');
    expect(auth).toContain('E2E_ADMIN_ROUTE_BYPASS_HEADER');
    expect(auth).toContain('E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER');
    expect(auth).toContain("requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1'");
    expect(auth).toContain('isLocalPlaywrightHost(requestHeaders.get(\'host\'))');

    const store = source('lib/claim/store.ts');
    expect(store).toContain('__tzudongRestaurantClaimLedger');
    expect(store).not.toContain('createSupabaseServiceRoleClient');
    expect(store).not.toContain('ocr');
    expect(store).toContain("status: 'evidence_submitted'");
    expect(store).toContain("ownerState: 'verified'");
  });

  test('pages expose the 5-step claim locators without dumping payloads', () => {
    const publicPanel = source('app/r/[restaurantId]/restaurant-claim-panel.tsx');
    expect(publicPanel).toContain('data-claim-owner-state={ownerState}');
    expect(publicPanel).toContain('data-claim-start="true"');
    expect(publicPanel).toContain('data-claim-license-input="true"');
    expect(publicPanel).toContain('data-claim-error={error}');
    expect(publicPanel).toContain("crypto.subtle.digest('SHA-256'");
    expect(publicPanel).toContain('overflow-x-hidden');
    expect(publicPanel).toContain('border-border');
    expect(publicPanel).not.toContain('localStorage');
    expect(publicPanel).not.toContain('document.cookie');

    const adminPage = source('app/admin/claims/page.tsx');
    expect(adminPage.startsWith('"use client";')).toBe(true);
    expect(adminPage).not.toMatch(/^export const (runtime|dynamic)/m);
    expect(adminPage).toContain('data-claim-guard-step={step}');
    expect(adminPage).toContain('Preview');
    expect(adminPage).toContain('Confirm');
    expect(adminPage).toContain('Apply');
    expect(adminPage).toContain('Readback');
    expect(adminPage).toContain('Audit');
    expect(adminPage).toContain("data-claim-readback={receipt.readback.passed ? 'passed' : 'failed'}");
    expect(adminPage).toContain('data-claim-audit="recorded"');
    expect(adminPage).not.toContain('JSON.stringify(receipt)');
    expect(adminPage).not.toContain('localStorage');

    const publicPage = source('app/r/[restaurantId]/page.tsx');
    expect(publicPage).not.toContain('"use client"');
    expect(publicPage).toContain("export const dynamic = 'force-dynamic'");
    expect(publicPage).not.toContain('AppRuntimeLayout');
  });

  test('Playwright admin bypass allowlist is exactly /admin and /admin/claims', () => {
    const proxy = source('proxy.ts');
    expect(proxy).toContain("normalizedPathname === '/admin' || normalizedPathname === '/admin/claims'");
    expect(proxy).toContain('function isPlaywrightRestaurantClaimApiBypassRequest');
    expect(proxy).toContain("normalizedPathname === '/api/admin/claims'");
    expect(proxy).toContain("normalizedPathname === '/api/admin/claims/preview'");
    expect(proxy).toContain("normalizedPathname === '/api/admin/claims/apply'");
    expect(proxy).not.toContain("normalizedPathname.startsWith('/admin/claims')");
    expect(proxy).not.toContain("normalizedPathname.startsWith('/api/admin/claims')");
  });
});
