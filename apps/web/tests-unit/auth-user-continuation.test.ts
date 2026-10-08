import { describe, expect, test } from 'bun:test';
import { buildHomeAuthLoginPath, buildStampReviewContinuationPath, getSafeAuthNextPath, resolveRequestedAuthRedirect } from '../lib/auth/auth-redirect';

describe('requested user login continuation', () => {
    test('keeps MY and review destinations while ordinary in-page login stays put', () => {
        expect(resolveRequestedAuthRedirect('mypage', '/mypage/reviews')).toBe('/mypage/reviews');
        expect(resolveRequestedAuthRedirect('review', '/feed')).toBe('/feed');
        expect(resolveRequestedAuthRedirect(null, '/mypage/profile')).toBeNull();
        expect(resolveRequestedAuthRedirect('privacy_onboarding', '/feed')).toBeNull();
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
});
