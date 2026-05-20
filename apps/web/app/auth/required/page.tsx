import Link from 'next/link';

import { Button } from '@/components/ui/button';

type AuthRequiredPageProps = {
    searchParams: Promise<{
        reason?: string;
        next?: string;
    }>;
};

export default async function AuthRequiredPage({ searchParams }: AuthRequiredPageProps) {
    const params = await searchParams;
    const isAdminReason = params.reason === 'admin';
    const nextPath = params.next?.startsWith('/') ? params.next : '/';

    return (
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10">
            <div className="w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl">
                    🔐
                </div>
                <h1 className="text-xl font-bold text-foreground">로그인이 필요합니다</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {isAdminReason
                        ? '관리자 콘솔은 관리자 계정으로 로그인한 뒤 사용할 수 있습니다.'
                        : '요청한 페이지는 로그인 후 사용할 수 있습니다.'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                    요청 경로: <span className="font-medium text-foreground">{nextPath}</span>
                </p>
                <div className="mt-6 grid gap-2">
                    <Button asChild>
                        <Link href="/">홈에서 로그인하기</Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/">홈으로 돌아가기</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
