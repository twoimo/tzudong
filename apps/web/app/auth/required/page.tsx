import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
    buildHomeAuthLoginPath,
    getSafeAuthNextPath,
} from '@/lib/auth/auth-redirect';

import { buildNoIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = buildNoIndexMetadata({
    title: '로그인이 필요합니다 - 쯔동여지도',
});

type AuthRequiredPageProps = {
    searchParams: Promise<{
        reason?: string;
        next?: string;
    }>;
};

export default async function AuthRequiredPage({ searchParams }: AuthRequiredPageProps) {
    const params = await searchParams;
    const isAdminReason = params.reason === 'admin';
    const isMyPageReason = params.reason === 'mypage';
    const isReviewReason = params.reason === 'review';
    const loginReason = isMyPageReason ? 'mypage' : isReviewReason ? 'review' : 'mypage';
    const nextPath = getSafeAuthNextPath(params.next);

    if (isAdminReason) {
        redirect(buildHomeAuthLoginPath({ reason: 'admin', next: nextPath }));
    }

    const loginPath = buildHomeAuthLoginPath({ reason: loginReason, next: nextPath });

    return (
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10">
            <div className="w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <h1 className="text-xl font-bold text-foreground">로그인이 필요합니다</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {isMyPageReason
                        ? '마이페이지는 로그인한 뒤 사용할 수 있습니다.'
                        : isReviewReason
                            ? '리뷰 작성과 피드 활동은 로그인한 뒤 사용할 수 있습니다.'
                            : '요청한 페이지는 로그인 후 사용할 수 있습니다.'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                    요청 경로: <span className="font-medium text-foreground">{nextPath}</span>
                </p>
                <div className="mt-6 grid gap-2">
                    <Button asChild>
                        <Link href={loginPath}>홈에서 로그인하기</Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/">홈으로 돌아가기</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
