import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ReviewCard, type ReviewCardProps } from '../components/reviews/ReviewCard';
import {
    readPublicProfileSummariesLookup,
    resolvePublicReviewerDisplay,
} from '../lib/public-profile-read';
import { resolveProfileAvatarUrl } from '../lib/profile-avatar-url';

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_AVATAR = 'https://lh3.googleusercontent.com/a/synthetic-public-avatar';
const noop = () => {};
const router: AppRouterInstance = {
    back: noop, forward: noop, refresh: noop, push: noop, replace: noop,
    prefetch: noop, bfcacheId: 'avatar-unit-test',
};
const review: ReviewCardProps['review'] = {
    id: 'synthetic-review', userId: AUTHOR_ID, userName: '쯔동마스터',
    restaurantName: '테스트 식당', content: '테스트 리뷰', photos: [],
    visitedAt: '2026-11-01', submittedAt: '2026-11-01',
    likeCount: 0, isLikedByUser: false,
};

// SSR executes the real card and Radix fallback without a browser, image
// requests, module mocks, credentials, or a signed-in viewer.
function render(changes: Partial<ReviewCardProps['review']> = {}) {
    return renderToStaticMarkup(
        <AppRouterContext.Provider value={router}>
            <ReviewCard review={{ ...review, ...changes }} onLike={noop} />
        </AppRouterContext.Provider>,
    );
}

describe('review author avatar fallback', () => {
    for (const userAvatarUrl of [undefined, null, '']) {
        test(`missing reference (${String(userAvatarUrl)}) has a named, visible fallback`, () => {
            const html = render({ userAvatarUrl });
            expect(html).toContain('role="img" aria-label="쯔동마스터 프로필 사진 대체 표시"');
            expect(html).toContain('<span aria-hidden="true">쯔</span>');
            expect(html).not.toContain('<img');
        });
    }

    test('an empty nickname still has an accessible generic icon', () => {
        const html = render({ userName: '   ' });
        expect(html).toContain('aria-label="사용자 프로필 사진 대체 표시"');
        expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    });

    test('public summary keeps an allowed avatar for a signed-out review reader', async () => {
        const lookup = await readPublicProfileSummariesLookup({
            rpc: async () => ({
                data: [{ user_id: AUTHOR_ID, nickname: review.userName, avatar_url: PUBLIC_AVATAR }],
                error: null,
            }),
        }, [AUTHOR_ID]);
        const author = resolvePublicReviewerDisplay(AUTHOR_ID, lookup.summaries, lookup.ok);
        expect(author.avatarUrl).toBe(PUBLIC_AVATAR);
        expect(resolveProfileAvatarUrl(author.avatarUrl, AUTHOR_ID)).toBe(PUBLIC_AVATAR);
        // Radix initially renders the fallback until a real load succeeds.
        const html = render({ userName: author.nickname, userAvatarUrl: author.avatarUrl });
        expect(html).toContain('aria-label="쯔동마스터 프로필 사진 대체 표시"');
        expect(html).toContain('<span aria-hidden="true">쯔</span>');
    });

    test('an unapproved URL from a summary never becomes an image request', async () => {
        const unsafeAvatar = 'https://unapproved.example/private-avatar.jpg';
        const lookup = await readPublicProfileSummariesLookup({
            rpc: async () => ({
                data: [{ user_id: AUTHOR_ID, nickname: review.userName, avatar_url: unsafeAvatar }],
                error: null,
            }),
        }, [AUTHOR_ID]);
        const author = resolvePublicReviewerDisplay(AUTHOR_ID, lookup.summaries, lookup.ok);
        expect(resolveProfileAvatarUrl(author.avatarUrl, AUTHOR_ID)).toBeNull();
        const html = render({ userName: author.nickname, userAvatarUrl: author.avatarUrl });
        expect(html).not.toContain(unsafeAvatar);
        expect(html).not.toContain('<img');
        expect(html).toContain('<span aria-hidden="true">쯔</span>');
    });

    test('unavailable or deleted public profiles never reuse an avatar', async () => {
        for (const response of [
            { data: null, error: { code: 'offline-fixture' } },
            { data: [{ user_id: AUTHOR_ID, nickname: '탈퇴한 사용자', avatar_url: PUBLIC_AVATAR }], error: null },
            { data: [], error: null },
        ]) {
            const lookup = await readPublicProfileSummariesLookup({ rpc: async () => response }, [AUTHOR_ID]);
            const author = resolvePublicReviewerDisplay(AUTHOR_ID, lookup.summaries, lookup.ok);
            expect(author.avatarUrl).toBeNull();
            const html = render({ userName: author.nickname, userAvatarUrl: author.avatarUrl });
            expect(html).toContain(`aria-label="${author.nickname} 프로필 사진 대체 표시"`);
            expect(html).not.toContain(PUBLIC_AVATAR);
            expect(html).not.toContain('<img');
        }
    });
});
