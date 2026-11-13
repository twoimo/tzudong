import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DESKTOP_MIN_WIDTH_QUERY } from '../lib/viewport-breakpoints';
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

    test('closing a resumed composer releases the viewport guard at integer and fractional breakpoints', () => {
        const source = readFileSync(path.join(webRoot, 'app/stamp/page.tsx'), 'utf8');
        const body = source.split('{/* 리뷰 모달 (Review Modal) */}')[1]
            .split('onClose={() => {')[1].split('}}\n                    restaurant=')[0];
        const close = new Function('window', 'DESKTOP_MIN_WIDTH_QUERY', 'reviewContinuationHandled',
            'setIsReviewModalOpen', 'router', 'buildDesktopStampHomeRedirectPath', body);
        const id = '11111111-1111-4111-8111-111111111111';
        for (const width of [390, 767.25, 767.75, 768, 820, 1279, 1279.25, 1279.75, 1280, 1440]) {
            const guard = { current: id as string | null };
            const redirects: string[] = [];
            let open = true;
            const search = `?restaurant=${id}`; // continuation already consumed writeReview
            close({
                matchMedia: (query: string) => {
                    expect(query).toBe('(min-width: 1280px)');
                    return { matches: width >= 1280 };
                },
                location: { search },
            }, DESKTOP_MIN_WIDTH_QUERY, guard,
                (value: boolean) => { open = value; }, { replace: (value: string) => redirects.push(value) },
                buildDesktopStampHomeRedirectPath);
            expect(open).toBe(false);
            expect(guard.current).toBeNull();
            expect(redirects).toEqual(width >= 1280 ? [`/?restaurant=${id}&panel=stamp`] : []);
            // The page's media-query listener can now route mobile/tablet back to the desktop panel.
            if (!guard.current) redirects.push(buildDesktopStampHomeRedirectPath(search)!);
            expect(redirects.at(-1)).toBe(`/?restaurant=${id}&panel=stamp`);
        }
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
