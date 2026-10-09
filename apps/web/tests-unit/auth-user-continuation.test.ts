import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    buildDesktopStampHomeRedirectPath,
    buildHomeAuthLoginPath,
    buildHomePrivacyOnboardingPath,
    buildStampReviewContinuationPath,
    getSafeAuthNextPath,
    isHomePrivacyOnboardingRequest,
    resolveRequestedAuthRedirect,
} from '../lib/auth/auth-redirect';

const webRoot = path.resolve(import.meta.dir, '..');

describe('requested user login continuation', () => {
    test('keeps MY and review destinations while ordinary in-page login stays put', () => {
        expect(resolveRequestedAuthRedirect('mypage', '/mypage/reviews')).toBe('/mypage/reviews');
        expect(resolveRequestedAuthRedirect('review', '/feed')).toBe('/feed');
        expect(resolveRequestedAuthRedirect(null, '/mypage/profile')).toBeNull();
        expect(resolveRequestedAuthRedirect('privacy_onboarding', '/feed')).toBe('/feed');
        expect(resolveRequestedAuthRedirect('privacy_onboarding', '/admin')).toBeNull();
    });
    test('retains the administrator boundary and rejects unsafe destinations', () => {
        expect(resolveRequestedAuthRedirect('admin', '/admin/reviews')).toBe('/admin/reviews');
        expect(resolveRequestedAuthRedirect('review', '/admin/reviews')).toBeNull();
        expect(resolveRequestedAuthRedirect('mypage', '//attacker.example')).toBeNull();
        expect(resolveRequestedAuthRedirect('mypage', 'https://attacker.example')).toBeNull();
        expect(resolveRequestedAuthRedirect('review', '/feed\\evil')).toBeNull();
    });
    test('binds the resumed stamp composer to the selected public restaurant ID', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const next = buildStampReviewContinuationPath(id);
        expect(getSafeAuthNextPath(next)).toBe(`/stamp?restaurant=${id}&writeReview=1`);
        const parameters = new URL(buildHomeAuthLoginPath({ reason: 'review', next }), 'https://www.tzudong.app').searchParams;
        expect(parameters.get('next')).toBe(next);
        expect(parameters.get('auth')).toBe('login');
        expect(parameters.get('reason')).toBe('review');
        expect(buildStampReviewContinuationPath('../../private')).toBe('/stamp');
    });

    test('keeps a verified destination through exact privacy recovery URLs', () => {
        const next = '/mypage/reviews';
        const path = buildHomePrivacyOnboardingPath(next);
        const url = new URL(path, 'https://www.tzudong.app');

        expect(url.searchParams.get('next')).toBe(next);
        expect(isHomePrivacyOnboardingRequest({ pathname: url.pathname, search: url.search })).toBe(true);
        expect(buildHomePrivacyOnboardingPath('https://attacker.example')).toBe('/?auth=login&reason=privacy_onboarding');
        expect(isHomePrivacyOnboardingRequest({
            pathname: '/',
            search: '?auth=login&reason=privacy_onboarding&next=https%3A%2F%2Fattacker.example',
        })).toBe(false);
    });

    test('holds the desktop stamp route until its selected review continuation is consumed', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const continuationSearch = `?restaurant=${id}&writeReview=1`;

        expect(buildDesktopStampHomeRedirectPath(continuationSearch)).toBeNull();
        expect(buildDesktopStampHomeRedirectPath(`?restaurant=${id}`)).toBe(`/?restaurant=${id}&panel=stamp`);
        expect(readFileSync(path.join(webRoot, 'app/stamp/page.tsx'), 'utf8')).toContain(
            'buildDesktopStampHomeRedirectPath(window.location.search)',
        );
        expect(readFileSync(path.join(webRoot, 'app/stamp/page.tsx'), 'utf8')).toContain(
            'if (reviewContinuationHandled.current) return;',
        );
        expect(readFileSync(path.join(webRoot, 'app/stamp/page.tsx'), 'utf8')).toContain(
            'if (restaurantId !== reviewContinuationHandled.current)',
        );
    });

    test('keeps the new-password UI aligned with the server 72-character bound', () => {
        const modal = readFileSync(path.join(webRoot, 'components/auth/AuthModal.tsx'), 'utf8');
        const onboardingRoute = readFileSync(path.join(webRoot, 'app/api/privacy/onboarding/route.ts'), 'utf8');

        expect(modal).toContain('const MAX_SIGNUP_PASSWORD_LENGTH = 72;');
        expect(modal).toContain('password.length > MAX_SIGNUP_PASSWORD_LENGTH');
        expect(modal).toContain('8자 이상 72자 이하로 입력해주세요.');
        expect(modal.match(/maxLength=\{isExistingAccountRecovery \? undefined : MAX_SIGNUP_PASSWORD_LENGTH\}/g)).toHaveLength(4);
        expect(onboardingRoute).toContain('value.password.length <= 72');
        expect(modal).not.toContain('MAX_SIGNUP_PASSWORD_LENGTH = 12');
    });
});
